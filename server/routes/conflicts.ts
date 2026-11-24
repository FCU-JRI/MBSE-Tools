import type { Express } from "express";
import { ROOT_PACKAGE } from "../engine.ts";
import { CATEGORY, } from "../metamodel.ts";
import * as store from "../projects.ts";
import { RANK_ZH } from "../auth.ts";
import { insertInto, nextShortName, relationSnippet, snippetFor } from "../edits.ts";
import { approvedBaseline, detectConflicts } from "../conflicts.ts";
import { wrap, author, pid, view, rootFile, inFile, me } from "./common.ts";

/** 互卡不讓次系統自己協調：裁決只有總工程師以上（D-VII、F-VIII、R-VIII）能做。 */
export const canDecide = (rank: string | null | undefined) => rank === "D-VII" || rank === "F-VIII" || rank === "R-VIII";

export function mount(app: Express): void {
  // 衝突清單：由解析器的 constraint 判定算出，不存成元素
  app.get("/api/projects/:id/conflicts", wrap(async (req, res) => {
    const r = await detectConflicts(pid(req));
    res.json({ ...r, canDecide: canDecide(me(req).rank) });
  }));

  // 裁決：建立 DesignDecision（理由、裁決者、日期），用 #trace 連到衝突的元素與受影響的需求
  app.post("/api/projects/:id/conflicts/decide", wrap(async (req, res) => {
    const id = pid(req);
    const u = me(req);
    if (!canDecide(u.rank)) return res.status(403).json({ error: "衝突要總工程師以上才能裁決。" });
    const key = String(req.body?.key ?? "");
    const rationale = String(req.body?.rationale ?? "").trim();
    const reqIds: string[] = Array.isArray(req.body?.requirements) ? req.body.requirements.map(String) : [];
    if (!rationale) throw new store.UserError("請填裁決的理由。");
    const found = (await detectConflicts(id)).conflicts.find((c) => c.key === key);
    if (!found) throw new store.UserError("找不到這個衝突（可能已經有人修正了），請重新整理。");
    if (found.decision) throw new store.UserError("這個衝突已經裁決過了。");
    const a = await store.analyzeProject(id);
    const target = found.elementId ? a.elements.find((e) => e.id === found.elementId) : undefined;
    const reqs = reqIds.map((r) => a.elements.find((e) => e.id === r && /RequirementUsage$/.test(e.kind)));
    if (reqs.some((r) => !r)) throw new store.UserError("受影響的需求裡有找不到的項目。");
    if (reqs.length === 0 && a.elements.some((e) => /RequirementUsage$/.test(e.kind))) throw new store.UserError("請至少選一條受影響的需求。");
    const cat = CATEGORY.get("DesignDecision")!;
    const sn = nextShortName(a.elements, cat.prefix);
    const name = `衝突裁決：${found.name}`;
    const who = `${author(req)}（${u.rank ? RANK_ZH[u.rank] : ""}）`;
    const today = new Date().toISOString().slice(0, 10);
    const doc = `[conflict:${key}] ${found.name} 不成立：${found.condition}。`;
    const file = rootFile(a);
    const decQn = `${ROOT_PACKAGE}::${cat.pkg}::${name}`;
    const links = [target, ...reqs].filter((x): x is NonNullable<typeof x> => !!x);
    const content = insertInto(await store.readFile(id, file), inFile(a, file), ROOT_PACKAGE, cat.pkg, (indent) =>
      snippetFor({ category: "DesignDecision", name, shortName: sn, doc, attrs: { rationale, decidedBy: who, decidedOn: today } }, a.elements, indent)
      + links.map((t) => relationSnippet({ kind: "trace", from: decQn, to: t.qualifiedName }, indent)).join(""));
    const r = await store.saveFile(id, file, content, author(req), `裁決衝突：${found.name}（${sn}）`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, decision: sn, ...(await view(id)) });
  }));

  // FW-09：最近一次節點核可時已存在的需求與介面；版本頁用它在差異上標「核可後變更」
  app.get("/api/projects/:id/change-control", wrap(async (req, res) => res.json({ approved: await approvedBaseline(pid(req)) })));
}
