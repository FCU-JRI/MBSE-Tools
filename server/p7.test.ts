// P7 火箭外形與模擬圖的測試。幾何全部是合成的數字，不是真實設計參數。執行：npm test
// 端對端的部分用自己的埠 18871／18872（docs/IMPL-PLAN.md 第 5 節）。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { analyze, shutdown } from "./engine.ts";
import { computeRocket, finCn, geoNumber, readOrk, rocketsFromElements } from "./method/p7-geometry.ts";
import type { Section } from "./method/p7-geometry.ts";

const lib = await fs.readFile(new URL("../library/JRI.sysml", import.meta.url), "utf8");

/*
 * 合成火箭（手算用）：
 *   鼻錐  圓錐  0.0–0.4 m  外徑 0.1  0.4 kg（重心取中點 0.2）
 *   箭體        0.4–1.5 m  外徑 0.1  1.5 kg（0.95）
 *   尾翼  4 片  翼根前緣 1.3 m，翼根 0.2、翼尖 0.1、翼展 0.1、後掠 0.1  0.3 kg（1.4）
 *   引擎  質量項 1.0 m 起、長 0.5，2.0 kg 其中推進劑 1.0 kg（1.25）
 *   航電  質量點 0.6 m  0.5 kg
 */
const MODEL = `package Project {
    private import ScalarValues::*;
    private import SI::*;
    private import JRI::*;
    package Structure {
        part def '合成火箭' :> System {
            part '鼻錐' { @Geometry { geoKind = "nose"; geoPosition = 0; geoLength = 0.4; geoDiameter = 0.1; geoShape = "conical"; geoMass = 0.4; } }
            part '箭體' { @Geometry { geoKind = "body"; geoPosition = 0.4; geoLength = 1.1; geoDiameter = 100 [mm]; geoMass = 1.5; } }
            part '尾翼' { @Geometry { geoKind = "fins"; geoPosition = 1.3; geoFinCount = 4; geoRootChord = 0.2; geoTipChord = 0.1; geoSpan = 0.1; geoSweep = 0.1; geoMass = 0.3; } }
            part '推進' : '推進次系統' { @Geometry { geoKind = "mass"; geoPosition = 1.0; geoLength = 0.5; geoMass = 2.0; geoPropellant = 1.0; } }
            part '航電' : '航電次系統' { @Geometry { geoKind = "mass"; geoPosition = 0.6; geoMass = 500 [g]; } }
        }
        part def '推進次系統' :> Subsystem;
        part def '航電次系統' :> Subsystem;
        part rocket : '合成火箭';
    }
}
`;

// 手算（Barrowman，參考直徑 0.1 m）
const HAND = (() => {
  const cr = 0.2, ct = 0.1, s = 0.1, xr = 0.1, n = 4, d = 0.1, r = 0.05;
  const lf = Math.sqrt(0.1 ** 2 + 0.05 ** 2); // √(S² + (Xr + Ct/2 − Cr/2)²) = √0.0125
  const cnF = (1 + r / (s + r)) * (4 * n * (s / d) ** 2) / (1 + Math.sqrt(1 + ((2 * lf) / (cr + ct)) ** 2)); // ≈ 9.4932
  const xF = 1.3 + (xr * 0.4) / 0.9 + (0.3 - 0.02 / 0.3) / 6; // ≈ 1.38333
  const cp = (2 * (0.4 * 2 / 3) + cnF * xF) / (2 + cnF); // ≈ 1.18902
  const cg = (0.4 * 0.2 + 1.5 * 0.95 + 0.3 * 1.4 + 2.0 * 1.25 + 0.5 * 0.6) / 4.7; // ≈ 1.00532
  const cgB = (0.4 * 0.2 + 1.5 * 0.95 + 0.3 * 1.4 + 1.0 * 1.25 + 0.5 * 0.6) / 3.7; // ≈ 0.93919
  return { cnF, xF, cp, cg, cgB, margin: (cp - cg) / 0.1, marginB: (cp - cgB) / 0.1 };
})();
const near = (a: number | null, b: number, tol = 1e-6, msg = "") => assert.ok(a !== null && Math.abs(a - b) < tol, `${msg} 得到 ${a}，手算 ${b}`);

after(() => shutdown());

test("P7 幾何：數字的寫法（m、mm、g）", () => {
  assert.equal(geoNumber("0.55"), 0.55);
  assert.equal(geoNumber("550 [mm]"), 0.55);
  assert.equal(geoNumber("500 [g]"), 0.5);
  assert.equal(geoNumber("2 [ft]"), null, "不認得的單位不猜");
  assert.equal(geoNumber("abc"), null);
});

test("P7 幾何：尾翼的 Barrowman 數值和手算一致", () => {
  const f = finCn({ n: 4, rootChord: 0.2, tipChord: 0.1, span: 0.1, sweep: 0.1 }, 0.1, 0.05, 1.3);
  near(f.cn, 9.49321, 1e-4, "尾翼 CN");
  near(f.xcp, 1.383333, 1e-5, "尾翼 Xcp");
});

test("P7 幾何：合成火箭的重心、壓力中心、穩定裕度和手算一致", async () => {
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", MODEL]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
  const rockets = rocketsFromElements(a.elements);
  assert.equal(rockets.length, 1);
  const g = rockets[0];
  assert.equal(g.name, "合成火箭");
  assert.deepEqual(g.sections.map((s) => s.name), ["鼻錐", "箭體", "航電", "推進", "尾翼"], "依位置排序");
  near(g.length, 1.5, 1e-9, "全長");
  near(g.refDiameter, 0.1, 1e-9, "參考直徑（mm 換算）");
  near(g.sections.find((s) => s.kind === "nose")!.xcp, 0.4 * 2 / 3, 1e-9, "鼻錐 Xcp");
  near(g.cp, HAND.cp, 1e-6, "壓力中心");
  near(g.liftoff.mass, 4.7, 1e-9, "起飛質量");
  near(g.liftoff.cg, HAND.cg, 1e-9, "起飛重心");
  near(g.liftoff.margin, HAND.margin, 1e-6, "起飛穩定裕度");
  near(g.burnout.mass, 3.7, 1e-9, "燃畢質量");
  near(g.burnout.cg, HAND.cgB, 1e-9, "燃畢重心");
  near(g.burnout.margin, HAND.marginB, 1e-6, "燃畢穩定裕度");
  assert.deepEqual(g.warnings, [], "首尾相接、裕度足夠，不應有警告");
});

test("P7 幾何：過渡段的 Barrowman 數值、空隙與缺欄位會提出警告", () => {
  const sec = (o: Partial<Section>): Section => ({ id: o.name!, name: o.name!, qualifiedName: o.name!, file: "m", kind: "body", position: 0, length: 0, diameter: null, aftDiameter: null, shape: null, fin: null, mass: 0, cg: 0, propellant: 0, cn: 0, xcp: null, external: true, ...o });
  const g = computeRocket("k", "T", [
    sec({ name: "N", kind: "nose", position: 0, length: 0.5, diameter: 0.1, shape: "ogive", mass: 1, cg: 0.3 }),
    sec({ name: "B1", position: 0.5, length: 1.0, diameter: 0.1 }),
    sec({ name: "T", kind: "transition", position: 1.5, length: 0.1, diameter: 0.1, aftDiameter: 0.12 }),
    sec({ name: "B2", position: 1.61, length: 0.5, diameter: 0.12 }),
  ]);
  near(g.refDiameter, 0.12, 1e-12, "參考直徑取最大外徑");
  const t = g.sections.find((s) => s.name === "T")!;
  // CN = 2[(d2/d)² − (d1/d)²]；Xcp = Xp + L/3·[1 + (1 − d1/d2)/(1 − (d1/d2)²)]
  near(t.cn, 2 * (1 - (0.1 / 0.12) ** 2), 1e-9, "過渡段 CN");
  near(t.xcp, 1.5 + (0.1 / 3) * (1 + (1 - 0.1 / 0.12) / (1 - (0.1 / 0.12) ** 2)), 1e-9, "過渡段 Xcp");
  near(g.sections[0].cn, 2 * (0.1 / 0.12) ** 2, 1e-9, "鼻錐 CN 以參考直徑正規化");
  assert.ok(g.warnings.some((w) => /空隙/.test(w)), "B2 與過渡段之間有 10 mm 空隙");
});

test("P7 幾何：.ork 讀取器能算出各零件從鼻尖量起的位置", () => {
  const xml = `<?xml version='1.0'?><openrocket version="1.5"><rocket><subcomponents><stage><subcomponents>
    <nosecone><name>N</name><length>0.3</length><shape>haack</shape><shapeparameter>0.0</shapeparameter><aftradius>0.04</aftradius></nosecone>
    <bodytube><name>B</name><length>1.0</length><radius>auto</radius><subcomponents>
      <trapezoidfinset><name>F</name><position type="bottom">0.0</position><fincount>3</fincount><rootchord>0.15</rootchord><tipchord>0.05</tipchord><height>0.08</height><sweeplength>0.1</sweeplength></trapezoidfinset>
      <masscomponent><name>M &amp; X</name><position type="top">0.2</position><packedlength>0.1</packedlength><mass>0.25</mass></masscomponent>
      <launchlug><name>L</name></launchlug>
    </subcomponents></bodytube></subcomponents></stage></subcomponents></rocket></openrocket>`;
  const { parts, skipped } = readOrk(xml);
  assert.deepEqual(parts.map((p) => [p.name, p.values.geoPosition]), [["N", 0], ["B", 0.3], ["F", 1.15], ["M & X", 0.5]]);
  assert.equal(parts[0].values.geoShape, "vonKarman");
  assert.equal(parts[1].values.geoDiameter, 0.08, "radius auto 沿用前一段");
  assert.deepEqual(skipped, ["L（launchlug，不支援）"]);
  assert.throws(() => readOrk("<html/>"), /OpenRocket/);
});

// ───────── 端對端：路由 ─────────

const PORT = 18871, PUB = 18872;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data, headers: r.headers };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p7-test-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("P7 路由：外形與重心、產生模擬參數、匯出 .ork 改完再匯回模型", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "p7", name: "P7 合成", kind: "annual" })).status, 200);
  const base = `${I}/api/projects/p7`;
  const empty = await call(`${base}/rocket`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.rockets, [], "範本沒有 @Geometry，不應有火箭");
  assert.equal((await call(`${base}/rocket/to-sim`, "POST", {})).status, 400);

  const put = await call(`${base}/files/model.sysml`, "PUT", { content: MODEL, message: "合成火箭幾何" });
  assert.equal(put.status, 200, JSON.stringify(put.data).slice(0, 300));
  const r = (await call(`${base}/rocket`)).data;
  assert.equal(r.rockets.length, 1);
  near(r.rockets[0].cp, HAND.cp, 1e-6, "API 壓力中心");
  near(r.rockets[0].liftoff.cg, HAND.cg, 1e-9, "API 重心");

  // 模型 → RocketPy 參數：引擎是寫了推進劑的那一段，其餘是箭體
  const ts = await call(`${base}/rocket/to-sim`, "POST", { key: r.rockets[0].key });
  assert.equal(ts.status, 200, JSON.stringify(ts.data).slice(0, 300));
  const inp = ts.data.sim.inputs;
  assert.equal(inp.rocket.radius_m, 0.05);
  assert.equal(inp.rocket.length_m, 1.5);
  assert.equal(inp.rocket.mass_kg, 2.7);
  assert.equal(inp.rocket.cm_from_nose_m, Number(((0.4 * 0.2 + 1.5 * 0.95 + 0.3 * 1.4 + 0.5 * 0.6) / 2.7).toFixed(4)));
  assert.deepEqual([inp.motor.propellant_mass_kg, inp.motor.dry_mass_kg], [1, 1]);
  assert.deepEqual(inp.fins, { n: 4, root_chord_m: 0.2, tip_chord_m: 0.1, span_m: 0.1, sweep_length_m: 0.1, position_from_nose_m: 1.3 });
  assert.equal(inp.nose.kind, "conical");

  // 匯出 .ork：每一段以模型名稱命名，質量用覆寫值
  const res = await fetch(`${base}/rocket/export.ork`);
  assert.equal(res.status, 200);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  const xml = await (await JSZip.loadAsync(buf)).file("rocket.ork")!.async("string");
  for (const n of ["鼻錐", "箭體", "尾翼", "推進", "航電"]) assert.match(xml, new RegExp(`<name>${n}</name>`));
  assert.match(xml, /<overridemass>0.4<\/overridemass>/);

  // 原樣匯回：沒有任何修改
  const same = await call(`${base}/rocket/import-ork`, "POST", { base64: buf.toString("base64") });
  assert.equal(same.status, 200, JSON.stringify(same.data).slice(0, 300));
  assert.deepEqual(same.data.changes, [], "原樣匯回不應有差異：" + JSON.stringify(same.data.changes));

  // 在 OpenRocket 裡改了鼻錐長度與翼展（以改 XML 模擬）
  const edited = xml.replace("<length>0.4</length>", "<length>0.45</length>").replace("<height>0.1</height>", "<height>0.12</height>");
  const zip = new JSZip();
  zip.file("rocket.ork", edited);
  const b64 = (await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
  const preview = await call(`${base}/rocket/import-ork`, "POST", { base64: b64 });
  assert.equal(preview.data.applied, false);
  const fields = preview.data.changes.map((c: any) => `${c.name}.${c.field}=${c.to}`).sort();
  // 鼻錐變長，後面的箭體跟著往後移 0.05 m（尾翼、質量項的位置在 .ork 裡相對於箭體）
  assert.ok(fields.includes("鼻錐.geoLength=0.45") && fields.includes("尾翼.geoSpan=0.12") && fields.includes("箭體.geoPosition=0.45"), fields.join(" "));
  const before = (await call(`${base}/files/model.sysml`)).data.content;
  assert.equal(before, MODEL, "預覽不能改模型");

  const ap = await call(`${base}/rocket/import-ork`, "POST", { base64: b64, apply: true });
  assert.equal(ap.status, 200, JSON.stringify(ap.data).slice(0, 300));
  assert.equal(ap.data.applied, true);
  assert.equal(ap.data.analysis.ok, true);
  const after = (await call(`${base}/files/model.sysml`)).data.content as string;
  assert.match(after, /part '鼻錐' \{ @Geometry \{ geoKind = "nose"; geoPosition = 0; geoLength = 0\.45; geoDiameter = 0\.1; geoShape = "conical"; geoMass = 0\.4; \} \}/);
  assert.match(after, /geoSpan = 0\.12;/);
  const r2 = (await call(`${base}/rocket`)).data.rockets[0];
  near(r2.sections.find((s: any) => s.name === "鼻錐").length, 0.45, 1e-9, "匯回後的鼻錐長度");
  // 版本由 git 管：匯回是一筆提交
  const hist = (await call(`${base}/history`)).data;
  const list = Array.isArray(hist) ? hist : hist.commits ?? hist.history ?? [];
  assert.ok(JSON.stringify(list).includes("從 OpenRocket 匯回幾何"), "應有匯回的提交紀錄");

  assert.equal((await call(`${base}/rocket/import-ork`, "POST", { base64: Buffer.from("not a rocket").toString("base64") })).status, 400);
});

test("P7 路由：由模型產生參數後跑 RocketPy，結果帶時間序列", { skip: !process.env.JRI_PYTHON && "未設定 JRI_PYTHON，略過模擬測試" }, async () => {
  const base = `${I}/api/projects/p7`;
  const run = await call(`${base}/sim/run`, "POST", {});
  assert.equal(run.status, 200, JSON.stringify(run.data).slice(0, 300));
  const s = run.data.result.series;
  assert.ok(s && s.t.length > 10 && s.altitude.length === s.t.length, "應有高度序列");
  const r = (await call(`${base}/rocket`)).data;
  assert.ok(r.result.series.speed, "GET /rocket 帶出上一次的結果");
});
