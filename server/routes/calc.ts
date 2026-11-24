import type { Express } from "express";
import * as store from "../projects.ts";
import * as sim from "../sim.ts";
import { buildVerdicts, evalExpr, massBudget } from "../calc.ts";
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
}
