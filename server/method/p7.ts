// P7：火箭外形與模擬圖（docs/IMPL-PLAN.md）。這一期的伺服器路由寫在這裡，路徑一律以 /api/projects/:id/ 開頭。
//
// 模型是唯一的真實來源：外形、重心、壓力中心都從 @Geometry 標記算；模擬參數與 .ork 都由模型產生。
// OpenRocket 是選用的：匯出 .ork 改完再匯回，改動寫回模型的 @Geometry，版本由專案的 git 紀錄。
import JSZip from "jszip";
import type { Element } from "../extract.ts";
import * as sim from "../sim.ts";
import type { Mount } from "./context.ts";
import { replaceLoc } from "../edits.ts";
import { currentValues, diffOrk, geometryText, orkXmlFor, readOrk, rocketsFromElements } from "./p7-geometry.ts";
import type { OrkChange, RocketGeometry } from "./p7-geometry.ts";

/** RocketPy 腳本認得的鼻錐外形 */
const SIM_NOSE: Record<string, string> = { conical: "conical", ogive: "ogive", tangent: "tangent", vonKarman: "vonKarman", lvhaack: "lvhaack", parabolic: "parabolic", elliptical: "ogive" };
const r4 = (n: number) => Number(n.toFixed(4));

/**
 * 由模型幾何產生 RocketPy 的參數。引擎推力曲線、燃燒室尺寸、降落傘與發射條件沿用目前的模擬參數。
 * 寫了 geoPropellant 的段當作引擎：它的質量扣掉推進劑是引擎空重，其餘的段加起來是不含引擎的箭體。
 */
export function simInputsFrom(g: RocketGeometry, base: sim.SimInputs): { inputs: sim.SimInputs; notes: string[] } {
  const notes: string[] = [];
  const nose = g.sections.find((s) => s.kind === "nose");
  const fins = g.sections.find((s) => s.kind === "fins" && s.fin);
  if (!nose || !fins?.fin || !g.refDiameter) throw new Error("模型的幾何至少要有鼻錐、一組尾翼和外徑，才能產生模擬參數。");
  const motor = g.sections.filter((s) => s.propellant > 0);
  const body = g.sections.filter((s) => s.propellant <= 0);
  const bm = body.reduce((t, s) => t + s.mass, 0);
  if (!(bm > 0)) throw new Error("箭體（不含引擎）的質量是 0，請在各段寫 geoMass。");
  const inputs: sim.SimInputs = JSON.parse(JSON.stringify(base));
  inputs.rocket.radius_m = r4(g.refDiameter / 2);
  inputs.rocket.length_m = r4(g.length);
  inputs.rocket.mass_kg = r4(bm);
  inputs.rocket.cm_from_nose_m = r4(body.reduce((t, s) => t + s.mass * s.cg, 0) / bm);
  inputs.nose = { length_m: r4(nose.length), kind: SIM_NOSE[nose.shape ?? "ogive"] ?? "ogive" };
  inputs.fins = { n: fins.fin.n, root_chord_m: fins.fin.rootChord, tip_chord_m: fins.fin.tipChord, span_m: fins.fin.span, sweep_length_m: fins.fin.sweep, position_from_nose_m: r4(fins.position) };
  if (motor.length) {
    const prop = motor.reduce((t, s) => t + s.propellant, 0), all = motor.reduce((t, s) => t + s.mass, 0);
    inputs.motor.propellant_mass_kg = r4(prop);
    inputs.motor.dry_mass_kg = r4(Math.max(all - prop, 0.01));
    notes.push(`引擎取自：${motor.map((s) => s.name).join("、")}。推力曲線與燃燒室尺寸沿用目前的模擬參數。`);
  } else notes.push("模型裡沒有寫 geoPropellant 的段，引擎沿用目前的模擬參數。");
  if (inputs.motor.chamber_radius_m > inputs.rocket.radius_m) {
    inputs.motor.chamber_radius_m = r4(inputs.rocket.radius_m * 0.9);
    notes.push("燃燒室半徑大於箭體半徑，已縮成箭體半徑的 0.9 倍。");
  }
  if (g.sections.filter((s) => s.kind === "fins").length > 1) notes.push("有多組尾翼，RocketPy 參數只用第一組。");
  return { inputs, notes };
}

export const mount: Mount = (app, ctx) => {
  const { wrap, pid, author, store } = ctx;
  const rocketsOf = async (id: string) => {
    const a = await store.analyzeProject(id);
    return { a, rockets: rocketsFromElements(a.elements as Element[]) };
  };
  const pick = (rockets: RocketGeometry[], key: unknown): RocketGeometry => {
    const g = rockets.find((r) => r.key === String(key ?? "")) ?? (key === undefined || key === "" ? rockets[0] : undefined);
    if (!g) throw new store.UserError(rockets.length ? "找不到這枚火箭。" : "模型裡還沒有任何 @Geometry 幾何標記。");
    return g;
  };

  // 外形、重心、壓力中心，以及上一次的模擬結果（給模擬圖用）
  app.get("/api/projects/:id/rocket", wrap(async (req, res) => {
    const id = pid(req);
    const { a, rockets } = await rocketsOf(id);
    const s = await sim.readSim(id);
    res.json({ ok: a.ok, rockets, result: s.result, available: await sim.available() });
  }));

  // 用模型的幾何更新模擬參數（sim.json），之後在「模擬」分頁或這裡執行 RocketPy
  app.post("/api/projects/:id/rocket/to-sim", wrap(async (req, res) => {
    const id = pid(req);
    const { rockets } = await rocketsOf(id);
    const g = pick(rockets, req.body?.key);
    const s = await sim.readSim(id);
    let out: { inputs: sim.SimInputs; notes: string[] };
    try { out = simInputsFrom(g, s.inputs); } catch (e) { throw new store.UserError((e as Error).message); }
    const saved = await sim.saveInputs(id, out.inputs, author(req));
    res.json({ sim: saved, notes: out.notes });
  }));

  // 由模型產生 .ork（OpenRocket 選用）
  app.get("/api/projects/:id/rocket/export.ork", wrap(async (req, res) => {
    const id = pid(req);
    const project = await store.readProject(id);
    const { rockets } = await rocketsOf(id);
    const g = pick(rockets, req.query.key);
    const { xml, warnings } = orkXmlFor(project.name, g);
    const zip = new JSZip();
    zip.file("rocket.ork", xml);
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(id)}.ork"`);
    if (warnings.length) res.setHeader("X-JRI-Warnings", encodeURIComponent(warnings.join("；")));
    res.send(buf);
  }));

  // 匯回 OpenRocket 改過的 .ork：先列出會改哪些數字；apply 為 true 才寫回模型並提交
  app.post("/api/projects/:id/rocket/import-ork", wrap(async (req, res) => {
    const id = pid(req);
    const buf = Buffer.from(String(req.body?.base64 ?? ""), "base64");
    if (buf.length > 20 * 1024 * 1024) throw new store.UserError("檔案太大。");
    const xml = await sim.orkXml(buf);
    let parsed: ReturnType<typeof readOrk>;
    try { parsed = readOrk(xml); } catch (e) { throw new store.UserError((e as Error).message); }
    const { a, rockets } = await rocketsOf(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
    const g = pick(rockets, req.body?.key);
    const { changes, unmatched } = diffOrk(g, a.elements as Element[], parsed.parts);
    const notes = [...parsed.skipped.map((s) => `未匯入：${s}`), ...unmatched.map((n) => `模型裡沒有對應的段，未匯入：${n}（請先在模型新增這一段）`)];
    if (!req.body?.apply || changes.length === 0) return res.json({ applied: false, changes, notes });

    // 依檔案分組，每個元素重寫它的 @Geometry 標記；同一個檔由後往前改，位置才不會跑掉
    const byEl = new Map<string, OrkChange[]>();
    for (const c of changes) byEl.set(c.id, [...(byEl.get(c.id) ?? []), c]);
    const files = new Map<string, Element[]>();
    for (const eid of byEl.keys()) {
      const el = (a.elements as Element[]).find((e) => e.id === eid) as Element;
      if (el.shared) throw new store.UserError(`「${el.name}」在共用元件庫，不能在專案內修改。`);
      if (!el.metaLoc.Geometry) throw new store.UserError(`「${el.name}」的 @Geometry 不是寫在它自己的主體裡，無法自動改寫。`);
      files.set(el.file, [...(files.get(el.file) ?? []), el]);
    }
    const summary = changes.map((c) => `${c.name}.${c.field} ${c.from ?? "—"} → ${c.to}`);
    for (const [file, els] of files) {
      let content = await store.readFile(id, file);
      els.sort((x, y) => y.metaLoc.Geometry.line - x.metaLoc.Geometry.line || y.metaLoc.Geometry.col - x.metaLoc.Geometry.col);
      for (const el of els) {
        const values = currentValues(el);
        for (const c of byEl.get(el.id) ?? []) values[c.field] = c.to;
        content = replaceLoc(content, el.metaLoc.Geometry, geometryText(values));
      }
      const r = await store.saveFile(id, file, content, author(req), `從 OpenRocket 匯回幾何：${summary.join("；")}`.slice(0, 400));
      if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    }
    res.json({ applied: true, changes, notes, ...(await ctx.view(id) as object) });
  }));
};
