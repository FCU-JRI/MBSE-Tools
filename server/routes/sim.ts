import type { Express } from "express";
import * as store from "../projects.ts";
import * as sim from "../sim.ts";
import { setRawAttrText } from "../edits.ts";
import { wrap, author, pid, view, editable } from "./common.ts";

/** 物理計算：RocketPy 與 OpenRocket */
export function mount(app: Express): void {
  // ───────── 物理計算：RocketPy 與 OpenRocket ─────────
  // 各輸出回寫時嘗試的單位寫法；解析器接受哪一種就用哪一種，都不接受就不寫入
  const UNIT_FORMS: Record<string, string[]> = { m: ["[m]"], kg: ["[kg]"], s: ["[s]"], "m/s": ["['m/s']", "[m/s]"], "N*s": ["[N*s]", "['N⋅s']", "['N·s']"], "m/s^2": ["['m/s²']", "[m/s^2]", "['m/s^2']"], cal: [""], "": [""] };
  app.get("/api/projects/:id/sim", wrap(async (req, res) => res.json({ ...(await sim.readSim(pid(req))), available: await sim.available() })));
  app.put("/api/projects/:id/sim/inputs", wrap(async (req, res) => res.json(await sim.saveInputs(pid(req), req.body?.inputs, author(req), req.body?.links))));
  app.post("/api/projects/:id/sim/thrust", wrap(async (req, res) => res.json({ curve: sim.parseThrust(String(req.body?.text ?? "")) })));
  app.post("/api/projects/:id/sim/import-ork", wrap(async (req, res) => res.json(await sim.importOrk(pid(req), Buffer.from(String(req.body?.base64 ?? ""), "base64"), author(req)))));
  app.get("/api/projects/:id/sim/export.ork", wrap(async (req, res) => {
    const buf = await sim.exportOrk(pid(req));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${pid(req)}.ork"`);
    res.send(buf);
  }));
  app.post("/api/projects/:id/sim/run", wrap(async (req, res) => res.json({ ...(await sim.runSim(pid(req), author(req))), available: await sim.available() })));
  // 把模擬結果寫回模型的屬性，需求的數值條件就會用新值重新判定
  app.post("/api/projects/:id/sim/apply", wrap(async (req, res) => {
    const id = pid(req);
    const s = await sim.readSim(id);
    if (!s.result) throw new store.UserError("還沒有模擬結果。");
    const bindings: sim.Binding[] = Array.isArray(req.body?.bindings) ? req.body.bindings : [];
    // 空的對應表＝取消所有對應：只清掉對應，模型維持現狀（ANA-04，#35）
    if (bindings.length === 0) {
      await sim.saveBindings(id, []);
      return res.json({ saved: true, applied: [], cleared: true, ...(await view(id)) });
    }
    let a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const contents = new Map<string, string>();
    const applied: string[] = [];
    for (const b of bindings) {
      const out = s.result.outputs.find((o) => o.key === b.output);
      const el = a.elements.find((e) => e.qualifiedName === b.element);
      if (!out || !el) throw new store.UserError(`找不到要寫回的對象：${b.output} → ${b.element}`);
      const file = editable(el).file;
      const base = contents.get(file) ?? (await store.readFile(id, file));
      let done = false;
      for (const unit of UNIT_FORMS[out.unit] ?? [""]) {
        const next = setRawAttrText(base, el, b.attribute, `${out.value}${unit ? " " + unit : ""}`);
        const an = await store.analyzeProject(id, { file, content: next });
        if (an.ok) { contents.set(file, next); a = an; done = true; break; }
      }
      if (!done) throw new store.UserError(`無法把「${out.zh}」寫入 ${el.name}.${b.attribute}：屬性不存在，或單位與屬性的型別不合。`);
      applied.push(`${el.name}.${b.attribute} = ${out.value} ${out.unit}`.trim());
    }
    for (const [file, content] of contents) {
      const r = await store.saveFile(id, file, content, author(req), `寫回模擬結果（${s.result.engine}）：${applied.join("；")}`.slice(0, 400));
      if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    }
    await sim.saveBindings(id, bindings);
    res.json({ saved: true, applied, ...(await view(id)) });
  }));
}
