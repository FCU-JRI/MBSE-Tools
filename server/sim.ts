// 物理計算：把火箭參數交給 RocketPy 模擬，結果可回寫成模型的屬性值，
// 讓需求的數值條件自動判定。也支援 OpenRocket .ork 的幾何匯入與匯出。
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { commit, dirOf, git, HOME_DIR, readProject, UserError } from "./projects.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "sim", "run_sim.py");
const PYTHON = process.env.JRI_PYTHON ?? path.join(HOME_DIR, "pyenv", "Scripts", "python.exe");

export interface SimInputs {
  rocket: { radius_m: number; mass_kg: number; length_m: number; cm_from_nose_m: number; drag_cd: number };
  nose: { length_m: number; kind: string };
  fins: { n: number; root_chord_m: number; tip_chord_m: number; span_m: number; sweep_length_m: number; position_from_nose_m: number };
  motor: { thrust_curve: [number, number][]; propellant_mass_kg: number; dry_mass_kg: number; chamber_radius_m: number; chamber_height_m: number; nozzle_radius_m: number };
  chute: { cd_s_m2: number; lag_s: number };
  launch: { latitude: number; longitude: number; elevation_m: number; rail_length_m: number; inclination_deg: number; heading_deg: number };
}

export interface SimOutput { key: string; zh: string; value: number; unit: string }
export interface SimResult { at: string; by: string; commit: string; inputsHash: string; engine: string; outputs: SimOutput[]; trajectory: [number, number][]; warnings: string[] }
export interface Binding { output: string; element: string; attribute: string }
export interface SimFile { inputs: SimInputs; result: SimResult | null; bindings: Binding[] }

export const DEFAULT_INPUTS: SimInputs = {
  rocket: { radius_m: 0.065, mass_kg: 14, length_m: 2.6, cm_from_nose_m: 1.45, drag_cd: 0.5 },
  nose: { length_m: 0.55, kind: "vonKarman" },
  fins: { n: 4, root_chord_m: 0.24, tip_chord_m: 0.1, span_m: 0.13, sweep_length_m: 0.12, position_from_nose_m: 2.32 },
  motor: { thrust_curve: [[0, 0], [0.1, 2400], [0.5, 2300], [3.0, 2100], [3.6, 600], [3.9, 0]], propellant_mass_kg: 3.9, dry_mass_kg: 2.6, chamber_radius_m: 0.049, chamber_height_m: 0.7, nozzle_radius_m: 0.03 },
  chute: { cd_s_m2: 4.5, lag_s: 1.5 },
  launch: { latitude: 22.3, longitude: 120.9, elevation_m: 10, rail_length_m: 6, inclination_deg: 85, heading_deg: 90 },
};

const NOSE_KINDS = ["vonKarman", "ogive", "conical", "lvhaack", "tangent", "parabolic"];
const file = (id: string) => path.join(dirOf(id), "sim.json");

export async function readSim(id: string): Promise<SimFile> {
  await readProject(id);
  try {
    const s = JSON.parse(await fs.readFile(file(id), "utf8")) as Partial<SimFile>;
    return { inputs: s.inputs ?? DEFAULT_INPUTS, result: s.result ?? null, bindings: s.bindings ?? [] };
  } catch { return { inputs: DEFAULT_INPUTS, result: null, bindings: [] }; }
}
const writeSim = (id: string, s: SimFile) => fs.writeFile(file(id), JSON.stringify(s, null, 1) + "\n", "utf8");

function num(v: unknown, name: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new UserError(`「${name}」必須是 ${min} 到 ${max} 之間的數字。`);
  return n;
}

/** 檢查並整理輸入。範圍設得寬，目的是擋掉打錯單位（例如把公釐當公尺）。 */
export function cleanInputs(b: any): SimInputs {
  const curve: [number, number][] = (Array.isArray(b?.motor?.thrust_curve) ? b.motor.thrust_curve : []).map((p: any) => [Number(p?.[0]), Number(p?.[1])] as [number, number]);
  if (curve.length < 2 || curve.length > 5000) throw new UserError("推力曲線至少要有 2 個點。");
  for (let i = 0; i < curve.length; i++) {
    if (!Number.isFinite(curve[i][0]) || !Number.isFinite(curve[i][1]) || curve[i][1] < 0) throw new UserError(`推力曲線第 ${i + 1} 點不是有效的數字。`);
    if (i > 0 && curve[i][0] <= curve[i - 1][0]) throw new UserError(`推力曲線的時間必須遞增（第 ${i + 1} 點）。`);
  }
  if (curve[0][0] !== 0) curve.unshift([0, 0]);
  const r = b.rocket ?? {}, n = b.nose ?? {}, f = b.fins ?? {}, m = b.motor ?? {}, c = b.chute ?? {}, l = b.launch ?? {};
  const out: SimInputs = {
    rocket: { radius_m: num(r.radius_m, "箭體半徑", 0.01, 1), mass_kg: num(r.mass_kg, "不含引擎的質量", 0.1, 2000), length_m: num(r.length_m, "全長", 0.2, 30), cm_from_nose_m: num(r.cm_from_nose_m, "質心位置", 0.01, 30), drag_cd: num(r.drag_cd, "阻力係數", 0.05, 3) },
    nose: { length_m: num(n.length_m, "鼻錐長度", 0.01, 5), kind: NOSE_KINDS.includes(n.kind) ? n.kind : "vonKarman" },
    fins: { n: Math.round(num(f.n, "尾翼片數", 3, 8)), root_chord_m: num(f.root_chord_m, "翼根弦長", 0.01, 3), tip_chord_m: num(f.tip_chord_m, "翼尖弦長", 0, 3), span_m: num(f.span_m, "翼展", 0.01, 2), sweep_length_m: num(f.sweep_length_m ?? 0, "後掠長度", 0, 3), position_from_nose_m: num(f.position_from_nose_m, "尾翼位置", 0.01, 30) },
    motor: { thrust_curve: curve, propellant_mass_kg: num(m.propellant_mass_kg, "推進劑質量", 0.01, 1000), dry_mass_kg: num(m.dry_mass_kg, "引擎空重", 0.01, 1000), chamber_radius_m: num(m.chamber_radius_m, "燃燒室半徑", 0.005, 1), chamber_height_m: num(m.chamber_height_m, "燃燒室長度", 0.02, 10), nozzle_radius_m: num(m.nozzle_radius_m, "噴嘴出口半徑", 0.002, 1) },
    chute: { cd_s_m2: num(c.cd_s_m2, "降落傘 Cd·S", 0.01, 500), lag_s: num(c.lag_s ?? 0, "開傘延遲", 0, 30) },
    launch: { latitude: num(l.latitude, "緯度", -90, 90), longitude: num(l.longitude, "經度", -180, 180), elevation_m: num(l.elevation_m, "發射場海拔", -400, 6000), rail_length_m: num(l.rail_length_m, "發射軌長度", 0.5, 50), inclination_deg: num(l.inclination_deg, "發射仰角", 45, 90), heading_deg: num(l.heading_deg, "發射方位", 0, 360) },
  };
  if (out.rocket.cm_from_nose_m >= out.rocket.length_m) throw new UserError("質心位置不能超過全長。");
  if (out.fins.position_from_nose_m + out.fins.root_chord_m > out.rocket.length_m + 1e-6) throw new UserError("尾翼超出箭體尾端，請檢查尾翼位置與翼根弦長。");
  if (out.motor.chamber_radius_m > out.rocket.radius_m) throw new UserError("燃燒室半徑不能大於箭體半徑。");
  return out;
}

export async function saveInputs(id: string, body: unknown, author: string): Promise<SimFile> {
  const s = await readSim(id);
  s.inputs = cleanInputs(body);
  await writeSim(id, s);
  await commit(dirOf(id), author, "更新模擬參數");
  return s;
}

/** 解析推力曲線文字：RASP .eng，或兩欄的 CSV／空白分隔（時間 s、推力 N）。 */
export function parseThrust(text: string): [number, number][] {
  const out: [number, number][] = [];
  let header = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    const a = Number(parts[0]), b = Number(parts[1]);
    // .eng 的標頭列有 7 個欄位，第一欄是引擎名稱
    if (!header && (parts.length >= 6 || !Number.isFinite(a))) { header = true; continue; }
    if (parts.length >= 2 && Number.isFinite(a) && Number.isFinite(b)) out.push([a, b]);
  }
  if (out.length < 2) throw new UserError("讀不到推力資料。請貼上兩欄數字（時間 s、推力 N）或 .eng 檔內容。");
  return out;
}

// ───────── OpenRocket .ork ─────────

const ORK_MAX = 50 * 1024 * 1024;
async function orkXml(buf: Buffer): Promise<string> {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file("rocket.ork") ?? Object.values(zip.files).find((f) => !f.dir && /\.ork$|\.xml$/i.test(f.name));
    if (!entry) throw new UserError("這個 .ork 檔裡找不到火箭資料。");
    // 先看解壓後有多大，避免很小的壓縮檔展開成幾 GB
    if (Number((entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0) > ORK_MAX) throw new UserError("檔案解壓後太大。");
    const text = await entry.async("string");
    if (text.length > ORK_MAX) throw new UserError("檔案解壓後太大。");
    return text;
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const { gunzipSync } = await import("node:zlib");
    try { return gunzipSync(buf, { maxOutputLength: ORK_MAX }).toString("utf8"); } catch { throw new UserError("檔案無法解壓，或解壓後太大。"); }
  }
  return buf.toString("utf8");
}

const tag = (xml: string, name: string): string | null => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? null;
const block = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => m[1]);
const stripChildren = (s: string) => s.replace(/<subcomponents>[\s\S]*<\/subcomponents>/, "");
const numOf = (s: string | null) => { const n = Number(String(s ?? "").replace(/^auto\s*/, "")); return Number.isFinite(n) ? n : null; };

/** 從 .ork 讀出幾何（鼻錐、箭體、尾翼、降落傘）。質量與引擎資料 OpenRocket 是算出來的，不在檔案裡，需另外填。 */
export async function importOrk(id: string, buf: Buffer, author: string): Promise<{ sim: SimFile; imported: string[]; skipped: string[] }> {
  if (buf.length > 20 * 1024 * 1024) throw new UserError("檔案太大。");
  const xml = await orkXml(buf);
  if (!/<openrocket[\s>]/.test(xml)) throw new UserError("這不是 OpenRocket 的檔案。");
  const s = await readSim(id);
  const inp: SimInputs = JSON.parse(JSON.stringify(s.inputs));
  const imported: string[] = [], skipped: string[] = [];

  const nose = block(xml, "nosecone")[0];
  let length = 0;
  if (nose) {
    const own = stripChildren(nose);
    const len = numOf(tag(own, "length"));
    if (len) { inp.nose.length_m = len; length += len; imported.push("鼻錐長度"); }
    const shape = (tag(own, "shape") ?? "").toLowerCase();
    const map: Record<string, string> = { ogive: "ogive", conical: "conical", haack: "vonKarman", parabolic: "parabolic", ellipsoid: "tangent", power: "parabolic" };
    if (map[shape]) { inp.nose.kind = map[shape]; imported.push("鼻錐外形"); }
  } else skipped.push("鼻錐");

  const tubes = block(xml, "bodytube").map(stripChildren);
  let radius = 0;
  for (const t of tubes) {
    length += numOf(tag(t, "length")) ?? 0;
    radius = Math.max(radius, numOf(tag(t, "radius")) ?? 0);
  }
  if (!radius && nose) radius = numOf(tag(stripChildren(nose), "aftradius")) ?? 0;
  if (radius) { inp.rocket.radius_m = radius; imported.push("箭體半徑"); } else skipped.push("箭體半徑（設為自動，請手動填）");
  if (length) { inp.rocket.length_m = Number(length.toFixed(4)); imported.push("全長"); }

  const fin = block(xml, "trapezoidfinset")[0];
  if (fin) {
    const g = (n: string) => numOf(tag(fin, n));
    const root = g("rootchord"), tip = g("tipchord"), h = g("height"), count = g("fincount"), sweep = g("sweeplength");
    if (root) inp.fins.root_chord_m = root;
    if (tip !== null) inp.fins.tip_chord_m = tip;
    if (h) inp.fins.span_m = h;
    if (count) inp.fins.n = Math.min(8, Math.max(3, Math.round(count)));
    if (sweep !== null) inp.fins.sweep_length_m = sweep;
    if (root && length) inp.fins.position_from_nose_m = Number((length - root).toFixed(4));
    imported.push("尾翼（假設位於箭體尾端）");
  } else skipped.push("尾翼（只支援梯形尾翼）");

  const chute = block(xml, "parachute")[0];
  if (chute) {
    const d = numOf(tag(chute, "diameter")), cd = numOf(tag(chute, "cd")) ?? 0.8;
    if (d) { inp.chute.cd_s_m2 = Number((cd * Math.PI * (d / 2) ** 2).toFixed(4)); imported.push("降落傘"); }
  } else skipped.push("降落傘");

  skipped.push("質量與質心（OpenRocket 檔案不直接記錄，請依實測填入）", "引擎與推力曲線");
  if (inp.rocket.cm_from_nose_m >= inp.rocket.length_m) inp.rocket.cm_from_nose_m = Number((inp.rocket.length_m * 0.55).toFixed(3));
  s.inputs = cleanInputs(inp);
  await writeSim(id, s);
  await commit(dirOf(id), author, "從 OpenRocket 檔匯入幾何");
  return { sim: s, imported, skipped };
}

/** 匯出成 OpenRocket 可開啟的 .ork（幾何與質量；引擎需在 OpenRocket 內另選）。 */
export async function exportOrk(id: string): Promise<Buffer> {
  const project = await readProject(id);
  const { inputs: i } = await readSim(id);
  const body = Math.max(i.rocket.length_m - i.nose.length_m, 0.05);
  const shape: Record<string, string> = { vonKarman: "haack", lvhaack: "haack", ogive: "ogive", tangent: "ogive", conical: "conical", parabolic: "parabolic" };
  const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
  const d = Math.sqrt((4 * i.chute.cd_s_m2) / (0.8 * Math.PI));
  const xml = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.5" creator="JRI MBSE">
  <rocket>
    <name>${esc(project.name)}</name>
    <referencetype>maximum</referencetype>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <nosecone>
            <name>Nose cone</name>
            <finish>normal</finish>
            <material type="bulk" density="1250.0">Fiberglass</material>
            <length>${i.nose.length_m}</length>
            <thickness>0.002</thickness>
            <shape>${shape[i.nose.kind] ?? "ogive"}</shape>
            <shapeparameter>${i.nose.kind === "vonKarman" ? "0.0" : "1.0"}</shapeparameter>
            <aftradius>${i.rocket.radius_m}</aftradius>
          </nosecone>
          <bodytube>
            <name>Body tube</name>
            <finish>normal</finish>
            <material type="bulk" density="1250.0">Fiberglass</material>
            <length>${Number(body.toFixed(4))}</length>
            <thickness>0.002</thickness>
            <radius>${i.rocket.radius_m}</radius>
            <subcomponents>
              <trapezoidfinset>
                <name>Fins</name>
                <position type="bottom">0.0</position>
                <finish>normal</finish>
                <material type="bulk" density="1250.0">Fiberglass</material>
                <fincount>${i.fins.n}</fincount>
                <rotation>0.0</rotation>
                <thickness>0.003</thickness>
                <crosssection>square</crosssection>
                <cant>0.0</cant>
                <rootchord>${i.fins.root_chord_m}</rootchord>
                <tipchord>${i.fins.tip_chord_m}</tipchord>
                <sweeplength>${i.fins.sweep_length_m}</sweeplength>
                <height>${i.fins.span_m}</height>
              </trapezoidfinset>
              <parachute>
                <name>Parachute</name>
                <position type="top">0.1</position>
                <cd>0.8</cd>
                <material type="surface" density="0.067">Ripstop nylon</material>
                <deployevent>apogee</deployevent>
                <deploydelay>${i.chute.lag_s}</deploydelay>
                <diameter>${Number(d.toFixed(4))}</diameter>
                <linecount>6</linecount>
                <linelength>${Number((d * 1.2).toFixed(3))}</linelength>
              </parachute>
              <masscomponent>
                <name>Dry mass (from JRI MBSE)</name>
                <position type="top">${Number(Math.max(i.rocket.cm_from_nose_m - i.nose.length_m, 0).toFixed(4))}</position>
                <packedlength>0.05</packedlength>
                <packedradius>${Number((i.rocket.radius_m * 0.8).toFixed(4))}</packedradius>
                <mass>${i.rocket.mass_kg}</mass>
                <masscomponenttype>masscomponent</masscomponenttype>
              </masscomponent>
            </subcomponents>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
  <simulations/>
</openrocket>
`;
  const zip = new JSZip();
  zip.file("rocket.ork", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ───────── 執行模擬 ─────────

export async function available(): Promise<{ ok: boolean; reason: string }> {
  if (!(await fs.stat(PYTHON).catch(() => null))) return { ok: false, reason: "尚未安裝 Python 模擬環境。請管理員執行 scripts/setup-python.ps1。" };
  return { ok: true, reason: "" };
}

export async function runSim(id: string, author: string): Promise<SimFile> {
  const av = await available();
  if (!av.ok) throw new UserError(av.reason);
  const s = await readSim(id);
  const inputs = cleanInputs(s.inputs);
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = execFile(PYTHON, ["-I", SCRIPT], { timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, MPLBACKEND: "Agg", PYTHONIOENCODING: "utf-8" } }, (err, out, stderr) => {
      if (err) {
        const last = String(stderr).trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] ?? err.message;
        reject(new UserError(err.killed ? "模擬超過 3 分鐘，已中止。請檢查參數是否合理。" : `模擬失敗：${last.slice(0, 300)}`));
      } else resolve(out);
    });
    child.stdin?.end(JSON.stringify(inputs));
  });
  const line = stdout.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (!line) throw new UserError("模擬沒有回傳結果。");
  const r = JSON.parse(line) as { engine: string; outputs: SimOutput[]; trajectory: [number, number][]; warnings: string[] };
  s.inputs = inputs;
  s.result = {
    at: new Date().toISOString(), by: author, commit: await git(dirOf(id), "rev-parse", "--short", "HEAD"),
    inputsHash: createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 12), engine: r.engine, outputs: r.outputs, trajectory: r.trajectory, warnings: r.warnings ?? [],
  };
  await writeSim(id, s);
  await commit(dirOf(id), author, `執行飛行模擬（${r.engine}）`);
  return s;
}

export async function saveBindings(id: string, bindings: Binding[]): Promise<SimFile> {
  const s = await readSim(id);
  s.bindings = bindings.filter((b) => b.output && b.element && /^[A-Za-z_][A-Za-z0-9_]*$/.test(b.attribute));
  await writeSim(id, s);
  return s;
}
