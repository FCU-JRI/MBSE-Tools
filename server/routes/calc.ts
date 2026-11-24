import type { Express } from "express";
import * as store from "../projects.ts";
import * as sim from "../sim.ts";
import { buildVerdicts, chartLimits, evalExpr, massBudget } from "../calc.ts";
import { readCondition } from "../edits.ts";
import { wrap, pid } from "./common.ts";

/** 計算與判定：算式求值、判定總覽、質量預算（ANA-09／06／11）。全部唯讀，只讀模型。 */
export function mount(app: Express): void {
  app.get("/api/projects/:id/calc/verdicts", wrap(async (req, res) => {
    const id = pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) return res.json({ ok: false, rows: [], error: "模型目前有錯誤，請先修正。" });
    const s = await sim.readSim(id);
    const contents = new Map<string, string>();
    const rows = await buildVerdicts(await store.sources(id), {
      elements: a.elements, satisfaction: a.satisfaction, bindings: s.bindings,
      simAt: s.result ? { engine: s.result.engine, at: s.result.at } : null,
      readCondition: async (file, el) => {
        if (!contents.has(file)) contents.set(file, await store.readFile(id, file));
        return readCondition(contents.get(file)!, el);
      },
    });
    res.json({ ok: true, rows });
  }));

  app.get("/api/projects/:id/calc/budget", wrap(async (req, res) => {
    const id = pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) return res.json({ ok: false, rows: [], error: "模型目前有錯誤，請先修正。" });
    // 頂層零件實例：直接放在套件裡的 PartUsage
    const kindOf = new Map(a.elements.map((e) => [e.id, e.kind]));
    const usages = a.elements.filter((e) => e.kind === "PartUsage" && !e.shared && e.owner && kindOf.get(e.owner) === "Package").map((e) => e.qualifiedName);
    res.json({ ok: true, rows: await massBudget(await store.sources(id), usages) });
  }));

  // 算式求值（含單位換算）。POST 但不改任何東西。
  app.post("/api/projects/:id/calc/eval", wrap(async (req, res) => {
    const id = pid(req);
    const imports = Array.isArray(req.body?.imports) ? req.body.imports.map(String) : [];
    res.json({ result: await evalExpr(await store.sources(id), String(req.body?.expr ?? ""), imports) });
  }));

  // 約束圖（ANA-08）：約束線來自需求的數值條件；滑桿預設值與校正資料來自模擬輸入（已套用模型屬性）與最新結果。唯讀。
  app.get("/api/projects/:id/calc/constraints", wrap(async (req, res) => {
    const id = pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) return res.json({ ok: false, error: "模型目前有錯誤，請先修正。" });
    const s = await sim.readSim(id);
    const src = await store.sources(id);
    const contents = new Map<string, string>();
    const rows = await buildVerdicts(src, {
      elements: a.elements, satisfaction: a.satisfaction, bindings: s.bindings,
      simAt: s.result ? { engine: s.result.engine, at: s.result.at } : null,
      readCondition: async (file, el) => {
        if (!contents.has(file)) contents.set(file, await store.readFile(id, file));
        return readCondition(contents.get(file)!, el);
      },
    });
    const idOf = (qn: string) => a.elements.find((e) => e.qualifiedName === qn)?.id ?? null;
    // 寫回目標：有對應的模擬輸入就用它；否則找模型裡叫 dryMass／mass、totalImpulse 的屬性
    const withAttr = (...names: string[]) => { for (const e of a.elements) { const n = names.find((x) => e.attrs[x] !== undefined); if (n && !e.shared && e.kind === "PartUsage") return { id: e.id, element: e.qualifiedName, attribute: n, exists: true }; } return null; };
    // 屬性只宣告在定義上（沒有值）時，寫到第一個用這個定義的零件上
    const viaDef = (name: string) => {
      const def = a.elements.find((d) => d.kind === "AttributeUsage" && d.name === name && a.elements.find((o) => o.id === d.owner)?.kind === "PartDefinition");
      const owner = def && a.elements.find((o) => o.id === def.owner);
      const u = owner && a.elements.find((e) => e.kind === "PartUsage" && !e.shared && e.types.includes(owner.name));
      return u ? { id: u.id, element: u.qualifiedName, attribute: name, exists: false } : null;
    };
    const ml = s.links["rocket.mass_kg"];
    const massTarget = ml && idOf(ml.element) ? { id: idOf(ml.element)!, element: ml.element, attribute: ml.attribute, exists: true } : withAttr("dryMass", "mass");
    const impulseTarget = withAttr("totalImpulse") ?? viaDef("totalImpulse");
    res.json({
      ok: true,
      limits: await chartLimits(src, rows),
      sim: { inputs: s.inputs, linked: Object.keys(s.links), result: s.result ? { at: s.result.at, engine: s.result.engine, outputs: s.result.outputs } : null },
      targets: { mass: massTarget, impulse: impulseTarget },
    });
  }));
}
