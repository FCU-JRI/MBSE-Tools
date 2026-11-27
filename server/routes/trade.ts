import type { Express } from "express";
import type { Element } from "../extract.ts";
import { ROOT_PACKAGE } from "../engine.ts";
import * as store from "../projects.ts";
import { insertInto, quote, removeLocs } from "../edits.ts";
import { setScoreText, setWeightText } from "../trade.ts";
import { wrap, author, pid, view, editable, rootFile, inFile } from "./common.ts";
import type { An } from "./common.ts";

const REQ = /Requirement$|^MOP$/;
const LINKS = ["satisfy", "trace", "refine", "derive"];

/** 方案比較的填寫：加／改／刪準則（連到方案的需求＋權重）與候選的分數。每一步重新解析，錯就不存。 */
export function mount(app: Express): void {
  const ready = async (id: string): Promise<An> => {
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    return a;
  };
  const alt = (a: An, id: unknown): Element => {
    const e = a.elements.find((x) => x.id === id);
    if (!e || e.category !== "DesignAlternative" || e.kind !== "PartDefinition") throw new store.UserError("請選一個設計方案。");
    return editable(e);
  };
  const req = (a: An, id: unknown): Element => {
    const e = a.elements.find((x) => x.id === id);
    if (!e || !REQ.test(e.category ?? "") || e.kind !== "RequirementUsage") throw new store.UserError("準則必須是需求。");
    return e;
  };
  const variantsOf = (a: An, al: Element) => a.elements.filter((e) => e.owner === al.id && e.kind === "PartUsage");
  /** 方案或它的候選與需求之間，專案內寫的連結 */
  const linksOf = (a: An, al: Element, r: Element) => {
    const ids = new Set([al.id, ...variantsOf(a, al).map((v) => v.id)]);
    return a.relations.filter((x) => LINKS.includes(x.kind) && ((ids.has(x.from) && x.to === r.id) || (ids.has(x.to) && x.from === r.id)));
  };
  /** 依序改好幾個檔案：每步都用上一步存下的結果重新解析。 */
  type Step = (a: An) => { file: string; make: (content: string) => string } | null;
  const run = async (id: string, who: string, message: string, steps: Step[]): Promise<void> => {
    for (const step of steps) {
      const a = await ready(id);
      const s = step(a);
      if (!s) continue;
      const content = s.make(await store.readFile(id, s.file));
      if (content === (await store.readFile(id, s.file))) continue;
      const after = await store.analyzeProject(id, { file: s.file, content });
      if (!after.ok) throw new store.UserError(`修改後模型會有錯誤，未儲存：${after.diagnostics.find((d) => d.severity === "error")?.message ?? ""}`);
      const r = await store.saveFile(id, s.file, content, who, message);
      if (!r.saved) throw new store.UserError("儲存失敗。");
    }
  };
  const fresh = (a: An, e: Element) => a.elements.find((x) => x.qualifiedName === e.qualifiedName && x.kind === e.kind) as Element;
  const qn = (q: string) => q.split("::").map(quote).join("::");

  // 加準則：把需求連到方案（trace），可同時填權重
  app.post("/api/projects/:id/trade/criterion", wrap(async (req0, res) => {
    const id = pid(req0), b = req0.body ?? {};
    const a0 = await ready(id);
    const al0 = alt(a0, b.alt), r0 = req(a0, b.requirement);
    if (linksOf(a0, al0, r0).length) throw new store.UserError("這條需求已經是這個方案的準則。");
    const weight = String(b.weight ?? "");
    await run(id, author(req0), `方案比較：${al0.name} 加準則 ${r0.shortName ?? r0.name}`, [
      (a) => { const al = fresh(a, al0), r = fresh(a, r0); const file = rootFile(a); return { file, make: (c) => insertInto(c, inFile(a, file), ROOT_PACKAGE, null, (indent) => `${indent}#trace dependency from ${qn(al.qualifiedName)} to ${qn(r.qualifiedName)};\n`) }; },
      (a) => { const r = fresh(a, r0); return weight.trim() ? { file: editable(r).file, make: (c) => setWeightText(c, r, weight) } : null; },
    ]);
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 改權重（空字串＝拿掉）
  app.post("/api/projects/:id/trade/weight", wrap(async (req0, res) => {
    const id = pid(req0), b = req0.body ?? {};
    const r0 = req(await ready(id), b.requirement);
    await run(id, author(req0), `方案比較：${r0.shortName ?? r0.name} 權重`, [(a) => { const r = fresh(a, r0); return { file: editable(r).file, make: (c) => setWeightText(c, r, String(b.weight ?? "")) }; }]);
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 填、改、刪分數（空字串＝刪）。trade/adjusted 是風險修正後的調整分數，寫法相同
  for (const kind of ["score", "adjusted"] as const) app.post(`/api/projects/:id/trade/${kind}`, wrap(async (req0, res) => {
    const id = pid(req0), b = req0.body ?? {};
    const a0 = await ready(id);
    const v0 = a0.elements.find((x) => x.id === b.variant && x.kind === "PartUsage" && a0.elements.find((p) => p.id === x.owner)?.category === "DesignAlternative");
    if (!v0) throw new store.UserError("請選方案底下的候選。");
    const r0 = req(a0, b.requirement);
    const adj = kind === "adjusted";
    await run(id, author(req0), `方案比較：${v0.name} 對 ${r0.shortName ?? r0.name} 的${adj ? "調整" : ""}分數`, [(a) => { const v = fresh(a, v0); return { file: editable(v).file, make: (c) => setScoreText(c, v, fresh(a, r0), String(b.score ?? ""), adj) }; }]);
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 刪準則：拿掉連結、權重，以及各候選對它的分數
  app.post("/api/projects/:id/trade/criterion/delete", wrap(async (req0, res) => {
    const id = pid(req0), b = req0.body ?? {};
    const a0 = await ready(id);
    const al0 = alt(a0, b.alt), r0 = req(a0, b.requirement);
    const files = await store.listFiles(id);
    const mine = linksOf(a0, al0, r0).filter((x) => x.loc && files.includes(x.file) && x.kind === "trace");
    if (!mine.length && !linksOf(a0, al0, r0).length) throw new store.UserError("這條需求不是這個方案的準則。");
    const steps: Step[] = variantsOf(a0, al0).flatMap((v0) => [false, true].map((adj) => (a: An) => { const v = fresh(a, v0); return v.attrLoc[`${adj ? "adjusted" : "score"}_${(r0.shortName ?? "").replace(/\W/g, "_")}`] ? { file: editable(v).file, make: (c: string) => setScoreText(c, v, fresh(a, r0), "", adj) } : null; }));
    for (const link of mine) steps.push((a) => {
      const l = a.relations.find((x) => x.kind === "trace" && x.from === link.from && x.to === link.to && x.file === link.file);
      return l?.loc ? { file: l.file, make: (c) => removeLocs(c, [l.loc!]) } : null;
    });
    steps.push((a) => { const r = fresh(a, r0); return r.metaLoc.TradeWeight ? { file: editable(r).file, make: (c) => setWeightText(c, r, "") } : null; });
    await run(id, author(req0), `方案比較：${al0.name} 刪準則 ${r0.shortName ?? r0.name}`, steps);
    const left = linksOf(await ready(id), fresh(await ready(id), al0), r0).length;
    res.json({ saved: true, ...(left ? { note: "還有其他寫法的連結（滿足、細化、衍生）沒有刪，請到模型頁處理。" } : {}), ...(await view(id)) });
  }));
}
