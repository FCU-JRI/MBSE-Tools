import type { Express } from "express";
import type { Element } from "../extract.ts";
import { ROOT_PACKAGE } from "../engine.ts";
import { CATEGORIES, CATEGORY, RELATION_LABELS } from "../metamodel.ts";
import * as store from "../projects.ts";
import { evaluateProcess, holdPoint, stepOfCategory } from "../process.ts";
import * as pm from "../pm.ts";
import { paramLines, paramWord } from "../modernize.ts";
import { readCondition, setConditionText, attrForm, moveBlockText, setCategoryText, setCustomAttrText, setMethodText, setUsageTypeText, setVerifiesText, nextShortName } from "../edits.ts";
import { commentText, deletePackageText, insertBody, moveIntoPackage, moveOutOfPackage, packageText, setCommentText, deleteElementText, insertInside, insertInto, quote, relationSnippet, removeLocs, renameText, setAttrText, setDocText, setShortNameText, setSourceText, setCadText, setLayerText, snippetFor } from "../edits.ts";
import { wrap, author, pid, view, editable, rootFile, inFile, isUserPackage } from "./common.ts";
import type { An } from "./common.ts";
import type { NewRelation } from "../edits.ts";

const RELATION_ZH: Record<string, string> = { compose: "組成", connect: "連接", succession: "之後是", transition: "轉換到" };
const relZh = (kind: string) => RELATION_LABELS[kind]?.zh ?? RELATION_ZH[kind] ?? kind;

/** 新增關係要寫進哪個檔案、怎麼寫。新增與「改關係」共用，檢查規則只有一份。 */
function planRelation(before: An, kind: string, from: Element | undefined, to: Element | undefined): { file: string; kind: string; from: Element; to: Element; apply: (content: string) => string } {
  if (!from || !to) throw new store.UserError("找不到要連結的元素。");
  if (from.id === to.id) throw new store.UserError("不能把元素連到自己。");
  if (before.relations.some((r) => r.kind === kind && r.from === from.id && r.to === to.id)) throw new store.UserError("這條關係已經存在。");
  const kind0 = kind;
  // 標準庫的需求衍生連結兩端都必須是需求（F-36）
  if (kind0 === "derive" && !(/RequirementUsage$/.test(from.kind) && /RequirementUsage$/.test(to.kind))) throw new store.UserError("衍生只能連接需求類的項目（需要、目標、目的、量度、各層需求）。其他項目之間請用「追溯」。");
  if (kind0 === "basis" && !/RequirementUsage$/.test(from.kind)) throw new store.UserError("設計依據的起點必須是需求。");
  const owner0 = before.elements.find((x) => x.id === from.owner);
  // 寫進某個元素主體的關係用該元素的檔案，其餘寫在根套件
  // 追溯到利害關係人：需求用內建的 stakeholder、使用案例用 actor，寫在起點的主體裡（F-37）
  const param = kind0 === "trace" ? paramWord(from, to) : null;
  const file = kind0 === "compose" || kind0 === "include" || param || (kind0 === "satisfy" && /Definition$/.test(from.kind)) ? editable(from).file
    : ["connect", "succession", "transition"].includes(kind0) && owner0 ? editable(owner0).file : rootFile(before);
  const qn = (q: string) => q.split("::").map(quote).join("::");
  const ownerOf = (e: typeof from) => before.elements.find((x) => x.id === e.owner);
  let next: (content: string) => string;
  if (kind === "satisfy" && /Definition$/.test(from.kind)) {
    // satisfy 的滿足者必須是使用（usage）；若選的是定義，就把 satisfy 寫進該定義的主體
    next = (content) => insertInside(content, from, (indent) => `${indent}satisfy ${qn(to.qualifiedName)};\n`);
  } else if (kind === "allocate") {
    // 分配的兩端都必須是使用（usage）。巢狀在其他使用裡的要用點號路徑；選到定義時改用以它為型別的零件。
    const byId = new Map(before.elements.map((e) => [e.id, e]));
    const featureRef = (el: Element): string => {
      const chain: Element[] = [];
      for (let cur: Element | undefined = el; cur && cur.kind !== "Package"; cur = byId.get(cur.owner ?? "")) chain.unshift(cur);
      const pkg = chain[0] ? byId.get(chain[0].owner ?? "")?.qualifiedName ?? "" : "";
      let out = pkg.split("::").filter(Boolean).map(quote).join("::");
      chain.forEach((c, i) => { out += (i > 0 && /Usage$/.test(chain[i - 1].kind) ? "." : "::") + quote(c.name); });
      return out.replace(/^::/, "");
    };
    let target = to;
    if (/Definition$/.test(to.kind)) {
      const usage = before.elements.find((e) => e.kind === "PartUsage" && e.typeIds.includes(to.id));
      if (!usage) throw new store.UserError(`「${to.name}」還沒有放進系統的結構，無法分配。請先到結構分解圖把它加為某個系統的零件。`);
      target = usage;
    }
    // 零件若定義在某個系統定義裡，從外面無法直接引用，所以把分配寫進那個定義的主體
    const host = byId.get(target.owner ?? "");
    if (host && /Definition$/.test(host.kind)) {
      if (editable(host).file !== file) throw new store.UserError("功能與分配對象在不同檔案，請到模型頁的「原始碼」建立分配。");
      next = (content) => insertInside(content, host, (indent) => `${indent}allocate ${featureRef(from)} to ${quote(target.name)};
  `);
    } else {
      next = (content) => insertInto(content, inFile(before, file), ROOT_PACKAGE, null, (indent) => `${indent}allocate ${featureRef(from)} to ${featureRef(target)};
  `);
    }
  } else if (param) {
    next = (content) => insertInside(content, from, (indent) => paramLines(from, [to], param, indent));
  } else if (kind === "include") {
    if (from.kind !== "UseCaseUsage" || to.kind !== "UseCaseUsage") throw new store.UserError("「包含」只能連接兩個使用案例。");
    next = (content) => insertInside(content, from, (indent) => `${indent}include ${qn(to.qualifiedName)};\n`);
  } else if (kind === "compose") {
    // 結構分解：在上層定義內加入一個以下層定義為型別的零件
    if (from.kind !== "PartDefinition" || to.kind !== "PartDefinition") throw new store.UserError("結構分解只能連接兩個定義（part def）。");
    if (from.id === to.id) throw new store.UserError("不能把元素放進自己裡面。");
    next = (content) => insertInside(content, from, (indent) => `${indent}part ${quote(to.name)} : ${qn(to.qualifiedName)};\n`);
  } else if (kind === "connect" || kind === "succession" || kind === "transition") {
    const owner = ownerOf(from);
    if (!owner || owner.id !== to.owner) throw new store.UserError("兩端必須在同一個上層元素內。");
    if (kind === "succession" && !/^Action/.test(owner.kind)) throw new store.UserError("先後順序只能建立在同一個任務或活動之內。");
    if (kind === "transition" && !/^State/.test(owner.kind)) throw new store.UserError("狀態轉換只能建立在同一個模式之內。");
    const text = kind === "connect" ? `connect ${quote(from.name)} to ${quote(to.name)};`
      : kind === "transition" ? `transition first ${quote(from.name)} then ${quote(to.name)};`
      : `first ${quote(from.name)} then ${quote(to.name)};`;
    next = (content) => insertInside(content, owner, (indent) => `${indent}${text}\n`);
  } else {
    next = (content) => insertInto(content, inFile(before, file), ROOT_PACKAGE, null, (indent) =>
      relationSnippet({ kind: kind as NewRelation["kind"], from: from.qualifiedName, to: to.qualifiedName }, indent));
  }
  return { file, kind, from, to, apply: next };
}

type Rel = An["relations"][number];
/**
 * 修改前後比對關係：修改前的每一條（skip 是刻意移除的）在修改後都要找得到。
 * rename：搬移後完整名稱怎麼變。回傳對不上的關係（白話描述）。
 */
function lostRelations(before: An, after: An, rename: (qn: string) => string, skip: Rel[] = []): string[] {
  const qnB = new Map(before.elements.map((e) => [e.id, e.qualifiedName]));
  const qnA = new Map(after.elements.map((e) => [e.id, e.qualifiedName]));
  const name = new Map(before.elements.map((e) => [e.id, e.name]));
  const have = new Map<string, number>();
  for (const r of after.relations) { const k = `${r.kind}|${qnA.get(r.from)}|${qnA.get(r.to)}`; have.set(k, (have.get(k) ?? 0) + 1); }
  const lost: string[] = [];
  for (const r of before.relations) {
    if (skip.includes(r)) continue;
    const k = `${r.kind}|${rename(qnB.get(r.from) ?? "")}|${rename(qnB.get(r.to) ?? "")}`;
    const n = have.get(k) ?? 0;
    if (n > 0) have.set(k, n - 1);
    else lost.push(`${name.get(r.from) ?? "?"} ${relZh(r.kind)} ${name.get(r.to) ?? "?"}`);
  }
  return lost;
}

/** 模型元素、關係、套件、註解、復原與重做（改動 SysML 文字的入口） */
export function mount(app: Express): void {
  // 引導模式：新增元素
  app.post("/api/projects/:id/elements", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正後再新增。");
    const cat = CATEGORIES.find((c) => c.id === req.body.category);
    if (!cat) throw new store.UserError("未知的元素類別。");
    // 流程範本專案：前面的步驟沒完成，不能新增後面步驟的項目
    if ((await store.readProject(id)).template === "guided") {
      const step = stepOfCategory(cat.id);
      const status = evaluateProcess(before);
      const mine = step ? status.find((s) => s.id === step.id) : undefined;
      if (mine?.state === "locked") {
        const cur = status.find((s) => s.state === "current");
        throw new store.UserError(`還不能新增${cat.zh}。請先完成「${cur?.zh ?? "前面的步驟"}」：${cur?.issues[0]?.text ?? ""}`);
      }
    }
    // 框架卡點（FW-02）：上一層設計迴圈沒走完，不能新增下一層需求（專案設定 enforceHoldPoint）
    const hold = await holdPoint(id, await store.readProject(id), before, (await pm.readPm(id)).docs.length, cat.id);
    if (hold) throw new store.UserError(hold);
    const parent0 = req.body.parentId ? before.elements.find((e) => e.id === req.body.parentId) : undefined;
    const file = parent0 ? editable(parent0).file : rootFile(before);
    const content = await store.readFile(id, file);
    // 指定上層元素時（例如在活動圖內新增階段）寫進該元素的主體，否則放進類別對應的套件
    const parent = req.body.parentId ? before.elements.find((e) => e.id === req.body.parentId) : undefined;
    const next = parent
      ? insertInside(content, parent, (indent) => snippetFor(req.body, before.elements, indent))
      : insertInto(content, inFile(before, file), ROOT_PACKAGE, cat.pkg, (indent) => snippetFor(req.body, before.elements, indent));
    const r = await store.saveFile(id, file, next, author(req), `新增${cat.zh}：${String(req.body.name).trim()}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 引導模式：新增關係
  app.post("/api/projects/:id/relations", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正後再新增。");
    const from = before.elements.find((e) => e.id === req.body.from);
    const to = before.elements.find((e) => e.id === req.body.to);
    const plan = planRelation(before, String(req.body.kind), from, to);
    const next = plan.apply(await store.readFile(id, plan.file));
    const r = await store.saveFile(id, plan.file, next, author(req), `新增關係：${plan.from.name} ${relZh(plan.kind)} ${plan.to.name}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 刪除關係
  app.post("/api/projects/:id/relations/delete", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const rel = before.relations.find((r) => r.kind === req.body.kind && r.from === req.body.from && r.to === req.body.to);
    if (!rel?.loc) throw new store.UserError("找不到這條關係。");
    if (!(await store.listFiles(id)).includes(rel.file)) throw new store.UserError("這條關係在共用元件庫裡，不能在專案內修改。");
    const next = removeLocs(await store.readFile(id, rel.file), [rel.loc]);
    const r = await store.saveFile(id, rel.file, next, author(req), "刪除關係");
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...(await view(id)) });
  }));

  const findAgain = (els: Awaited<ReturnType<typeof store.analyzeProject>>["elements"], el: { shortName: string | null; line: number | null; kind: string }) =>
    els.find((e) => (el.shortName ? e.shortName === el.shortName : e.line === el.line && e.kind === el.kind));

  // 修改元素：名稱、說明、屬性。一次改一項並重新解析，確保每一步都合法。
  app.patch("/api/projects/:id/elements", wrap(async (req, res) => {
    const id = pid(req);
    let a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const target = a.elements.find((e) => e.id === req.body.id);
    if (!target) throw new store.UserError("找不到這個元素。");
    const file = editable(target).file;
    const cat = CATEGORIES.find((c) => c.id === target.category);
    let content = await store.readFile(id, file);
    const steps: ((c: string, el: Element, an: typeof a) => string)[] = [];
    const b = req.body ?? {};
    // 編號最後才改：前面的步驟靠原本的編號找回元素
    const newId = typeof b.shortName === "string" && b.shortName.trim() && b.shortName.trim() !== (target.shortName ?? "") ? b.shortName.trim() : null;
    if (typeof b.name === "string" && b.name.trim() !== target.name) steps.push((c, el, an) => renameText(c, el, b.name, inFile(an, file), an.relations.filter((r) => r.file === file)));
    if (typeof b.doc === "string" && b.doc.trim() !== target.doc.trim()) steps.push((c, el) => setDocText(c, el, b.doc));
    for (const f of cat?.fields ?? []) {
      const v = b.attrs?.[f.name];
      if (typeof v === "string" && v.trim() !== (target.attrs[f.name] ?? "").trim()) steps.push((c, el) => setAttrText(c, el, f, v));
    }
    if (b.source && typeof b.source === "object") {
      const d = String(b.source.doc ?? "").trim(), r = String(b.source.ref ?? "").trim();
      if (d !== (target.attrs.sourceDoc ?? "") || r !== (target.attrs.sourceRef ?? "")) steps.push((c, el) => setSourceText(c, el, d, r));
    }
    if (b.cad && typeof b.cad === "object") {
      const u = String(b.cad.url ?? "").trim(), v = String(b.cad.version ?? "").trim(), t = String(b.cad.tool ?? "").trim();
      if (u !== (target.attrs.cadUrl ?? "") || v !== (target.attrs.cadVersion ?? "") || t !== (target.attrs.cadTool ?? "")) steps.push((c, el) => setCadText(c, el, u, v, t));
    }
    if (typeof b.layer === "string" && b.layer.trim() !== (target.attrs.layer ?? "")) steps.push((c, el) => setLayerText(c, el, b.layer));
    if (steps.length === 0 && !newId) return res.json({ saved: true, ...(await view(id)) });
    let el: Element = target;
    for (const step of steps) {
      content = step(content, el, a);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
      const again = findAgain(a.elements, el);
      if (!again) throw new store.UserError("修改後找不到這個元素，未儲存。請到模型頁的「原始碼」修改。");
      el = again;
    }
    if (newId) {
      content = setShortNameText(content, el, newId, a.elements);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
      const again = a.elements.find((e) => e.shortName === newId && e.kind === el.kind);
      if (!again) throw new store.UserError("修改編號後找不到這個元素，未儲存。");
      el = again;
    }
    const r = await store.saveFile(id, file, content, author(req), `修改${cat?.zh ?? (target.kind === "Package" ? "套件" : "元素")}：${el.name}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    // 改名後識別碼會變，圖上的位置要跟著換
    if (el.id !== target.id) await store.remapIds(id, [[target.id, el.id]], [[target.qualifiedName, el.qualifiedName]]);
    res.json({ saved: true, selected: el.id, ...(await view(id)) });
  }));

  // 刪除元素，連同指向它的關係
  app.post("/api/projects/:id/elements/delete", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = before.elements.find((e) => e.id === req.body.id);
    if (!el) throw new store.UserError("找不到這個元素。");
    const file = editable(el).file;
    const outside = before.relations.filter((r) => (r.from === el.id || r.to === el.id) && r.file !== file);
    if (outside.length) throw new store.UserError(`還有 ${outside.length} 條寫在其他檔案（${[...new Set(outside.map((r) => r.file))].join("、")}）的關係指向它，請先移除。`);
    let next: string;
    if (el.kind === "Package") {
      if (!isUserPackage(el)) throw new store.UserError("這是工具依類別建立的套件，不能刪除。");
      if (before.elements.some((e) => e.owner === el.id)) throw new store.UserError(`「${el.name}」裡面還有項目，請先把它們移出來。`);
      next = deletePackageText(await store.readFile(id, file), el, before.elements.find((e) => e.id === el.owner));
    } else next = deleteElementText(await store.readFile(id, file), el, before.elements, before.relations.filter((r) => r.file === file));
    const r = await store.saveFile(id, file, next, author(req), `刪除：${el.shortName ?? ""} ${el.name}`.trim());
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 套件：建立。先放在根套件；第一次把項目拖進來時，會搬到那個項目所在的套件底下。
  app.post("/api/projects/:id/packages", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const file = rootFile(before);
    const root = before.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE);
    if (!root) throw new store.UserError(`模型中找不到根套件 ${ROOT_PACKAGE}。`);
    const name = String(req.body?.name ?? "").trim();
    if (before.elements.some((e) => e.kind === "Package" && e.name === name)) throw new store.UserError(`已經有叫「${name}」的套件。`);
    const next = insertBody(await store.readFile(id, file), root, (indent) => packageText(name, before.elements.filter((e) => e.owner === root.id), indent));
    const r = await store.saveFile(id, file, next, author(req), `新增套件：${name}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    const v = await view(id);
    res.json({ saved: true, created: v.analysis.elements.find((e) => e.kind === "Package" && e.name === name && e.owner === root.id)?.id ?? null, ...v });
  }));

  // 套件：把項目搬進（packageId）或搬出（packageId 為 null）。一次可搬多個，全部成功才儲存。
  app.post("/api/projects/:id/elements/move", wrap(async (req, res) => {
    const id = pid(req);
    let a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 200) : [];
    let pkgId: string | null = req.body?.packageId ? String(req.body.packageId) : null;
    const pairs: [string, string][] = [], qnames: [string, string][] = [];
    const find = (x: string | null | undefined) => a.elements.find((e) => e.id === x);
    const first = find(ids[0]);
    if (!first) throw new store.UserError("找不到要搬移的項目。");
    const file = editable(first).file;
    let content = await store.readFile(id, file);
    const step = async (next: string) => {
      content = next;
      a = await store.analyzeProject(id, { file, content });
      return a.ok;
    };
    const names: string[] = [];
    for (const eid of ids) {
      const el = find(eid);
      if (!el) throw new store.UserError("找不到要搬移的項目。");
      if (editable(el).file !== file) throw new store.UserError("要搬移的項目在不同檔案，請分次處理。");
      const owner = find(el.owner);
      if (owner?.kind !== "Package") throw new store.UserError(`「${el.name}」寫在「${owner?.name ?? "別的項目"}」裡面，不能單獨搬進套件。`);
      let target: Element;
      if (pkgId) {
        let pkg = find(pkgId);
        if (!isUserPackage(pkg)) throw new store.UserError("找不到這個套件。");
        if (pkg.file !== file) throw new store.UserError("套件和項目在不同檔案，請到模型頁的「原始碼」處理。");
        if (el.owner === pkg.id || el.id === pkg.id) continue;
        if (el.kind === "Package") throw new store.UserError("目前不支援把套件放進另一個套件，請到模型頁的「原始碼」處理。");
        // 項目原本所在的命名空間：若它已在某個使用者套件裡，取那個套件的上層
        const home = isUserPackage(owner) ? find(owner.owner) : owner;
        if (!home) throw new store.UserError("找不到項目所在的套件。");
        if (pkg.owner !== home.id) {
          const oldPkg: Element = pkg;
          if (a.elements.some((e) => e.owner === oldPkg.id)) {
            throw new store.UserError(`「${oldPkg.name}」在「${find(oldPkg.owner)?.name ?? ""}」裡，只能放同樣在那裡的項目。「${el.name}」在「${home.name}」裡，請另建一個套件。`);
          }
          // 空套件：搬到項目所在的命名空間底下
          if (!(await step(deletePackageText(content, oldPkg, find(oldPkg.owner))))) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
          const home2 = find(home.id);
          if (!home2) throw new store.UserError("搬移套件時找不到目的地，未儲存。");
          if (!(await step(insertBody(content, home2, (indent) => packageText(oldPkg.name, a.elements.filter((e) => e.owner === home2.id), indent))))) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
          pkg = a.elements.find((e) => e.kind === "Package" && e.name === oldPkg.name && e.owner === home.id);
          if (!pkg) throw new store.UserError("搬移套件後找不到它，未儲存。");
          pairs.push([oldPkg.id, pkg.id]); qnames.push([oldPkg.qualifiedName, pkg.qualifiedName]);
          pkgId = pkg.id;
        }
        const cur = find(el.id), parent = find(pkg.owner);
        if (!cur || !parent) throw new store.UserError("搬移時找不到項目，未儲存。");
        if (!(await step(moveIntoPackage(content, cur, pkg, parent)))) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
        target = pkg;
      } else {
        if (!isUserPackage(owner)) continue;
        const parent = find(owner.owner);
        if (!parent) throw new store.UserError("找不到上層套件。");
        if (!(await step(moveOutOfPackage(content, el, parent, owner)))) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
        target = parent;
      }
      const again = a.elements.find((e) => e.owner === target.id && e.name === el.name && e.kind === el.kind);
      if (!again) throw new store.UserError("搬移後找不到這個項目，未儲存。");
      pairs.push([el.id, again.id]); qnames.push([el.qualifiedName, again.qualifiedName]);
      names.push(el.name);
    }
    if (names.length === 0) return res.json({ saved: true, moved: {}, packageId: pkgId, layout: await store.readLayout(id), diagrams: await store.readDiagrams(id), ...(await view(id)) });
    const pkgName = pkgId ? find(pkgId)?.name ?? "" : "";
    const r = await store.saveFile(id, file, content, author(req), `${pkgId ? `放進套件「${pkgName}」` : "移出套件"}：${names.slice(0, 5).join("、")}${names.length > 5 ? ` 等 ${names.length} 項` : ""}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    await store.remapIds(id, pairs, qnames);
    res.json({ saved: true, moved: Object.fromEntries(pairs), packageId: pkgId, layout: await store.readLayout(id), diagrams: await store.readDiagrams(id), ...(await view(id)) });
  }));

  // 註解（SysML comment）：建立。有對象時寫在對象所在的地方，沒有就寫在根套件。
  app.post("/api/projects/:id/comments", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const about = req.body?.aboutId ? before.elements.find((e) => e.id === req.body.aboutId) : undefined;
    const host = (about ? before.elements.find((e) => e.id === about.owner) : undefined) ?? before.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE);
    if (!host) throw new store.UserError(`模型中找不到根套件 ${ROOT_PACKAGE}。`);
    const file = editable(host).file;
    const used = new Set(before.elements.map((e) => e.name));
    let n = 1;
    while (used.has(`Note${n}`)) n++;
    const name = `Note${n}`;
    const next = insertBody(await store.readFile(id, file), host, (indent) => commentText(name, about && about.owner === host.id ? about.name : null, String(req.body?.text ?? ""), indent));
    const r = await store.saveFile(id, file, next, author(req), `新增註解${about ? `：${about.name}` : ""}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    const v = await view(id);
    res.json({ saved: true, created: v.analysis.elements.find((e) => e.kind === "Comment" && e.name === name)?.id ?? null, ...v });
  }));

  // 註解：改內容
  app.patch("/api/projects/:id/comments", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = before.elements.find((e) => e.id === req.body?.id && e.kind === "Comment");
    if (!el) throw new store.UserError("找不到這則註解。");
    const file = editable(el).file;
    const r = await store.saveFile(id, file, setCommentText(await store.readFile(id, file), el, String(req.body?.text ?? "")), author(req), "修改註解");
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...(await view(id)) });
  }));

  // ───────── 閉環：建立之後能改（上層、類別、自訂屬性、驗證事件、關係） ─────────
  // 每一步都重新解析；有錯就不存。改完再比對關係，修改前的關係（扣掉刻意移除的）都要還在。

  /** 修改後模型有錯：回 422，附上白話說明與診斷。 */
  const broken = (res: Parameters<Parameters<typeof wrap>[0]>[1], a: An, what: string) =>
    res.status(422).json({ saved: false, error: `${what}後模型會有錯誤，未儲存：${a.diagnostics[0]?.message ?? ""}（第 ${a.diagnostics[0]?.line ?? "?"} 行）`, diagnostics: a.diagnostics });

  /** 上層：功能與階段放進任務（或回到行為套件）、狀態放進模式、零件放進另一個系統定義；定義（次系統、元件）改的是組成它的零件。 */
  const parentRule = (el: Element, ownerKind: string | undefined): { zh: string; ok: (t: Element) => boolean } | null => {
    const catPkg = (t: Element) => t.kind === "Package" && !!el.category && t.qualifiedName === `${ROOT_PACKAGE}::${CATEGORY.get(el.category)?.pkg ?? ""}`;
    if (el.kind === "ActionUsage") return { zh: "任務或活動", ok: (t) => t.kind === "ActionUsage" || catPkg(t) };
    if (el.kind === "StateUsage") return { zh: "模式", ok: (t) => t.kind === "StateUsage" || catPkg(t) };
    if (el.kind === "PartUsage" && ownerKind === "PartDefinition") return { zh: "系統定義", ok: (t) => t.kind === "PartDefinition" };
    if (el.kind === "PartDefinition") return { zh: "系統定義", ok: (t) => t.kind === "PartDefinition" };
    return null;
  };
  const LOCAL = ["succession", "connect", "transition"];

  app.post("/api/projects/:id/elements/reparent", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const find = (an: An, x: unknown) => an.elements.find((e) => e.id === x);
    let el = find(before, req.body?.id);
    if (!el) throw new store.UserError("找不到這個元素。");
    editable(el);
    const target = req.body?.parentId ? find(before, req.body.parentId) : undefined;
    // 定義的上層 = 組成它的零件所在的定義
    if (el.kind === "PartDefinition") {
      const def = el;
      const uses = before.elements.filter((u) => u.kind === "PartUsage" && u.typeIds.includes(def.id) && find(before, u.owner)?.kind === "PartDefinition");
      if (uses.length > 1) throw new store.UserError(`「${def.name}」被 ${uses.length} 個系統定義當成零件，請在結構分解圖上逐條修改組成線。`);
      if (!target) {
        if (!uses.length) return res.json({ saved: true, selected: def.id, ...(await view(id)) });
        const u = uses[0];
        const next = deleteElementText(await store.readFile(id, u.file), u, before.elements, before.relations.filter((r) => r.file === u.file));
        const r = await store.saveFile(id, u.file, next, author(req), `移除組成：${find(before, u.owner)?.name ?? ""} ◆ ${def.name}`);
        if (!r.saved) return broken(res, r.analysis, "移除組成");
        return res.json({ saved: true, selected: def.id, ...(await view(id)) });
      }
      if (target.kind !== "PartDefinition") throw new store.UserError("系統、次系統、元件的上層只能是另一個系統定義。");
      if (!uses.length) {
        const plan = planRelation(before, "compose", target, def);
        const r = await store.saveFile(id, plan.file, plan.apply(await store.readFile(id, plan.file)), author(req), `新增關係：${target.name} 組成 ${def.name}`);
        if (!r.saved) return broken(res, r.analysis, "加入組成");
        return res.json({ saved: true, selected: def.id, ...(await view(id)) });
      }
      if (uses[0].owner === target.id) return res.json({ saved: true, selected: def.id, ...(await view(id)) });
      el = uses[0]; // 搬組成它的那個零件
    }
    const rule = parentRule(el, find(before, el.owner)?.kind);
    if (!rule) throw new store.UserError("這類項目放在類別的套件裡，沒有上層可以換。要整理請用圖上的「套件」。");
    if (!target) throw new store.UserError("請選擇新的上層。");
    if (!rule.ok(target)) throw new store.UserError(`「${el.name}」的上層只能是${rule.zh}。`);
    editable(target);
    if (el.owner === target.id) return res.json({ saved: true, selected: req.body.id, ...(await view(id)) });
    if (el.file !== target.file) throw new store.UserError("新的上層在另一個檔案，請到模型頁的「原始碼」搬移。");
    const oldQN = el.qualifiedName, newQN = `${target.qualifiedName}::${el.name}`;
    if (target.qualifiedName === oldQN || target.qualifiedName.startsWith(oldQN + "::")) throw new store.UserError("不能把元素放進它自己底下。");
    if (before.elements.some((e) => e.owner === target.id && e.name === el!.name)) throw new store.UserError(`「${target.name}」裡已經有叫「${el.name}」的項目。`);
    const file = el.file;
    let content = await store.readFile(id, file);
    let a = before;
    // 先後順序、連接、轉換只能在同一個上層之內，搬走時一併移除
    const moving = el;
    const local = before.relations.filter((r) => LOCAL.includes(r.kind) && (r.from === moving.id || r.to === moving.id) && r.loc && r.file === file);
    if (local.length) {
      content = removeLocs(content, local.map((r) => r.loc as NonNullable<typeof r.loc>));
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return broken(res, a, "移除先後順序");
    }
    const el1 = a.elements.find((e) => e.qualifiedName === oldQN && e.kind === moving.kind);
    const t1 = a.elements.find((e) => e.qualifiedName === target.qualifiedName && e.kind === target.kind);
    if (!el1 || !t1) throw new store.UserError("搬移時找不到項目，未儲存。");
    content = moveBlockText(content, el1, t1);
    a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return broken(res, a, "搬移");
    const moved = a.elements.find((e) => e.qualifiedName === newQN && e.kind === moving.kind);
    if (!moved) throw new store.UserError("搬移後找不到這個項目，未儲存。");
    const rename = (q: string) => (q === oldQN || q.startsWith(oldQN + "::") ? newQN + q.slice(oldQN.length) : q);
    const lost = lostRelations(before, a, rename, local);
    if (lost.length) throw new store.UserError(`搬移後有 ${lost.length} 條關係對不上（${lost.slice(0, 3).join("、")}），未儲存。通常是別處用完整路徑引用它（例如分配），請先移除那些關係，搬完再加回。`);
    const r = await store.saveFile(id, file, content, author(req), `改上層：${moving.name} → ${target.name}${local.length ? `（移除 ${local.length} 條先後／連接）` : ""}`);
    if (!r.saved) return broken(res, r.analysis, "搬移");
    const pairs: [string, string][] = [], qnames: [string, string][] = [[oldQN, newQN]];
    for (const e of before.elements) {
      if (e.qualifiedName !== oldQN && !e.qualifiedName.startsWith(oldQN + "::")) continue;
      const again = a.elements.find((x) => x.qualifiedName === rename(e.qualifiedName) && x.kind === e.kind);
      if (again && again.id !== e.id) pairs.push([e.id, again.id]);
    }
    await store.remapIds(id, pairs, qnames);
    res.json({ saved: true, selected: req.body.id === moving.id ? moved.id : req.body.id, removed: local.length, layout: await store.readLayout(id), diagrams: await store.readDiagrams(id), ...(await view(id)) });
  }));

  // 改類別：只在同一個 SysML 關鍵字的類別之間互換（例如系統層需求 ↔ 次系統層需求），關係保留
  app.post("/api/projects/:id/elements/category", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = before.elements.find((e) => e.id === req.body?.id);
    if (!el) throw new store.UserError("找不到這個元素。");
    editable(el);
    const from = el.category ? CATEGORY.get(el.category) : undefined;
    const to = CATEGORY.get(String(req.body?.category ?? ""));
    if (!from || !to) throw new store.UserError("未知的元素類別。");
    if (from.id === to.id) return res.json({ saved: true, selected: el.id, ...(await view(id)) });
    if (from.keyword !== to.keyword) throw new store.UserError(`「${from.zh}」是 ${from.keyword}，「${to.zh}」是 ${to.keyword}。SysML 的關鍵字不同，換了會讓模型不合語法，所以不開放；請新增一個${to.zh}，再把關係連過去。`);
    const kept = new Set((to.fields ?? []).map((f) => f.name));
    const drop = (from.fields ?? []).filter((f) => el.attrs[f.name] && !kept.has(f.name));
    if (drop.length) throw new store.UserError(`「${to.zh}」沒有這些欄位：${drop.map((f) => f.zh).join("、")}。請先清空再改類別。`);
    const file = el.file;
    let content = setCategoryText(await store.readFile(id, file), el, from.id, to.id);
    let a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return broken(res, a, "改類別");
    let after = a.elements.find((e) => e.qualifiedName === el.qualifiedName && e.kind === el.kind);
    if (after?.category !== to.id) throw new store.UserError("改類別後辨識不到新類別，未儲存。請到模型頁的「原始碼」修改。");
    let renumbered = "";
    const re = new RegExp(`^${from.prefix.replace(/-/g, "\\-")}-\\d+$`);
    if (req.body?.renumber !== false && el.shortName && re.test(el.shortName)) {
      renumbered = nextShortName(a.elements, to.prefix);
      content = setShortNameText(content, after, renumbered, a.elements);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return broken(res, a, "改編號");
      after = a.elements.find((e) => e.qualifiedName === el.qualifiedName && e.kind === el.kind);
      if (!after) throw new store.UserError("改編號後找不到這個元素，未儲存。");
    }
    const lost = lostRelations(before, a, (q) => q);
    if (lost.length) throw new store.UserError(`改類別後有 ${lost.length} 條關係對不上（${lost.slice(0, 3).join("、")}），未儲存。`);
    const r = await store.saveFile(id, file, content, author(req), `改類別：${el.name} ${from.zh} → ${to.zh}${renumbered ? `（編號 ${el.shortName} → ${renumbered}）` : ""}`);
    if (!r.saved) return broken(res, r.analysis, "改類別");
    if (after.id !== el.id) await store.remapIds(id, [[el.id, after.id]], []);
    res.json({ saved: true, selected: after.id, ...(await view(id)) });
  }));

  // 自訂屬性：類別預設欄位以外的屬性（名稱、值、單位），可新增、修改、刪除
  app.post("/api/projects/:id/elements/attribute", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = before.elements.find((e) => e.id === req.body?.id);
    if (!el) throw new store.UserError("找不到這個元素。");
    editable(el);
    if (el.kind === "Package" || el.kind === "Comment") throw new store.UserError("套件與註解不能加屬性。");
    const b = req.body ?? {};
    const name = String(b.name ?? b.oldName ?? "").trim();
    const field = (el.category ? CATEGORY.get(el.category)?.fields ?? [] : []).find((f) => f.name === name || f.zh === name);
    if (field && !b.remove) throw new store.UserError(`「${field.zh}」是這個類別的預設欄位，請直接在上面的欄位修改。`);
    if (["kind", "sourceDoc", "sourceRef"].includes(name)) throw new store.UserError(`「${name}」是工具保留的名稱，請換一個。`);
    const file = el.file;
    const content = setCustomAttrText(await store.readFile(id, file), el, { oldName: b.oldName ? String(b.oldName) : undefined, name: b.name ? String(b.name) : undefined, value: String(b.value ?? ""), unit: String(b.unit ?? ""), remove: b.remove === true });
    const a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return broken(res, a, b.remove ? "刪除屬性" : "寫入屬性");
    const after = a.elements.find((e) => e.qualifiedName === el.qualifiedName && e.kind === el.kind);
    if (!after) throw new store.UserError("修改後找不到這個元素，未儲存。");
    if (!b.remove && after.attrs[name] === undefined) throw new store.UserError("寫入後讀不到這個屬性，未儲存。請到模型頁的「原始碼」修改。");
    const r = await store.saveFile(id, file, content, author(req), `${b.remove ? "刪除" : b.oldName ? "修改" : "新增"}屬性：${el.name}.${name}`);
    if (!r.saved) return broken(res, r.analysis, "寫入屬性");
    res.json({ saved: true, selected: after.id, ...(await view(id)) });
  }));

  // 需求的數值條件（預算配額、尺寸邊界都用它）：讀與寫。對象是結構定義；選到零件時用它的定義
  app.get("/api/projects/:id/elements/condition", wrap(async (req, res) => {
    const id = pid(req);
    const a = await store.analyzeProject(id);
    const el = a.elements.find((e) => e.id === String(req.query.id ?? ""));
    if (!el) throw new store.UserError("找不到這個元素。");
    res.json({ condition: readCondition(await store.readFile(id, el.file), el) });
  }));
  app.post("/api/projects/:id/elements/condition", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = before.elements.find((e) => e.id === req.body?.id);
    if (!el) throw new store.UserError("找不到這個元素。");
    editable(el);
    const b = req.body ?? {};
    let type = "";
    if (b.subject) {
      let s = before.elements.find((e) => e.id === b.subject);
      if (s && /Usage$/.test(s.kind)) s = before.elements.find((e) => s!.typeIds.includes(e.id) && /Definition$/.test(e.kind)) ?? s;
      if (!s || !/PartDefinition$/.test(s.kind)) throw new store.UserError("條件的對象要選系統、次系統或元件。");
      type = s.qualifiedName.split("::").map(quote).join("::");
    }
    const file = el.file;
    const content = setConditionText(await store.readFile(id, file), el, { type, attribute: String(b.attribute ?? ""), op: String(b.op ?? ""), value: String(b.value ?? ""), unit: String(b.unit ?? "") });
    const a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return broken(res, a, "寫入數值條件");
    const r = await store.saveFile(id, file, content, author(req), `${type ? "設定" : "清除"}數值條件：${el.name}`);
    if (!r.saved) return broken(res, r.analysis, "寫入數值條件");
    const after = a.elements.find((e) => e.qualifiedName === el.qualifiedName && e.kind === el.kind);
    res.json({ saved: true, selected: after?.id, ...(await view(id)) });
  }));

  // 驗證事件：改方法、增減要驗證的需求
  app.post("/api/projects/:id/verification", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = before.elements.find((e) => e.id === req.body?.id);
    if (!el || CATEGORY.get(el.category ?? "")?.keyword !== "verification") throw new store.UserError("找不到這個驗證事件。");
    editable(el);
    const file = el.file;
    let content = await store.readFile(id, file);
    let a = before, cur = el;
    const again = () => { const x = a.elements.find((e) => e.qualifiedName === el.qualifiedName && e.kind === el.kind); if (!x) throw new store.UserError("修改後找不到這個驗證事件，未儲存。"); return x; };
    const changes: string[] = [];
    if (typeof req.body.method === "string" && req.body.method !== (el.attrs.kind ?? "").split("::").pop()) {
      content = setMethodText(content, cur, req.body.method);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return broken(res, a, "改驗證方法");
      cur = again(); changes.push("方法");
    }
    let want: Set<string> | null = null;
    if (Array.isArray(req.body.verifies)) {
      const reqs = req.body.verifies.map((x: unknown) => before.elements.find((e) => e.id === x));
      if (reqs.some((x: Element | undefined) => !x || !/Requirement/.test(x.kind))) throw new store.UserError("要驗證的項目必須是需求。");
      want = new Set(reqs.map((x: Element) => x.qualifiedName));
      const have = new Set(before.relations.filter((r) => r.kind === "verify" && r.from === el.id).map((r) => before.elements.find((e) => e.id === r.to)?.qualifiedName));
      if (want.size !== have.size || [...want].some((q) => !have.has(q))) {
        content = setVerifiesText(content, cur, [...want]);
        a = await store.analyzeProject(id, { file, content });
        if (!a.ok) return broken(res, a, "改要驗證的需求");
        cur = again(); changes.push("要驗證的需求");
      }
    }
    if (!changes.length) return res.json({ saved: true, selected: el.id, ...(await view(id)) });
    if (want) {
      const got = new Set(a.relations.filter((r) => r.kind === "verify" && r.from === cur.id).map((r) => a.elements.find((e) => e.id === r.to)?.qualifiedName));
      if (got.size !== want.size || [...want].some((q) => !got.has(q))) throw new store.UserError("寫入後讀到的驗證對象和選的不一樣，未儲存。請到模型頁的「原始碼」修改。");
    }
    const lost = lostRelations(before, a, (q) => q, before.relations.filter((r) => r.kind === "verify" && r.from === el.id));
    if (lost.length) throw new store.UserError(`修改後有 ${lost.length} 條關係對不上（${lost.slice(0, 3).join("、")}），未儲存。`);
    const r = await store.saveFile(id, file, content, author(req), `修改驗證事件：${el.name}（${changes.join("、")}）`);
    if (!r.saved) return broken(res, r.analysis, "修改驗證事件");
    res.json({ saved: true, selected: cur.id, ...(await view(id)) });
  }));

  // 改關係：換對象或換類型。舊的拿掉、新的加上，一次存檔；檢查規則和新增關係相同
  const TRACE_LIKE = ["derive", "refine", "trace", "basis", "satisfy", "allocate"];
  app.post("/api/projects/:id/relations/change", wrap(async (req, res) => {
    const id = pid(req);
    const before = await store.analyzeProject(id);
    if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const b = req.body ?? {};
    const byId = (x: unknown) => before.elements.find((e) => e.id === x);
    const kind = String(b.kind ?? ""), newKind = String(b.newKind ?? kind);
    if (kind === "verify") throw new store.UserError("驗證關係寫在驗證事件裡，請選取驗證事件，在屬性欄改「要驗證的需求」。");
    if (kind === "compose") {
      // 組成線 = 上層定義裡的一個零件：換上層就搬零件，換下層就換零件的型別
      const u = byId(b.usage);
      if (!u || u.kind !== "PartUsage") throw new store.UserError("找不到這條組成線的零件。");
      editable(u);
      const owner = byId(u.owner), type = before.elements.find((e) => u.typeIds.includes(e.id) && e.kind === "PartDefinition");
      const nf = byId(b.newFrom ?? owner?.id), nt = byId(b.newTo ?? type?.id);
      if (!owner || !type || !nf || !nt) throw new store.UserError("找不到這條組成線的兩端。");
      if (nf.kind !== "PartDefinition" || nt.kind !== "PartDefinition") throw new store.UserError("組成線兩端都必須是系統定義（系統、次系統、元件、外部對象）。");
      if (nf.id === nt.id) throw new store.UserError("不能把元素放進自己裡面。");
      editable(nf);
      const file = u.file;
      let content = await store.readFile(id, file);
      let a = before, cur = u;
      if (nt.id !== type.id) {
        content = setUsageTypeText(content, cur, nt.qualifiedName);
        a = await store.analyzeProject(id, { file, content });
        if (!a.ok) return broken(res, a, "換下層");
        const x = a.elements.find((e) => e.qualifiedName === u.qualifiedName && e.kind === "PartUsage");
        if (!x) throw new store.UserError("換型別後找不到零件，未儲存。");
        cur = x;
      }
      let rename = (q: string) => q;
      if (nf.id !== owner.id) {
        if (nf.file !== file) throw new store.UserError("新的上層在另一個檔案，請到模型頁的「原始碼」搬移。");
        if (a.elements.some((e) => e.owner === nf.id && e.name === u.name)) throw new store.UserError(`「${nf.name}」裡已經有叫「${u.name}」的零件。`);
        const t1 = a.elements.find((e) => e.qualifiedName === nf.qualifiedName && e.kind === nf.kind);
        if (!t1) throw new store.UserError("找不到新的上層，未儲存。");
        content = moveBlockText(content, cur, t1);
        a = await store.analyzeProject(id, { file, content });
        if (!a.ok) return broken(res, a, "換上層");
        const oldQN = u.qualifiedName, newQN = `${nf.qualifiedName}::${u.name}`;
        rename = (q) => (q === oldQN || q.startsWith(oldQN + "::") ? newQN + q.slice(oldQN.length) : q);
      }
      const lost = lostRelations(before, a, rename);
      if (lost.length) throw new store.UserError(`修改後有 ${lost.length} 條關係對不上（${lost.slice(0, 3).join("、")}），未儲存。通常是別處用完整路徑引用這個零件（例如分配），請先移除那些關係。`);
      const r = await store.saveFile(id, file, content, author(req), `修改組成：${owner.name} ◆ ${type.name} → ${nf.name} ◆ ${nt.name}`);
      if (!r.saved) return broken(res, r.analysis, "修改組成");
      return res.json({ saved: true, ...(await view(id)) });
    }
    const rel = before.relations.find((r) => r.kind === kind && r.from === b.from && r.to === b.to);
    if (!rel?.loc) throw new store.UserError("找不到這條關係。");
    if (!(await store.listFiles(id)).includes(rel.file)) throw new store.UserError("這條關係在共用元件庫裡，不能在專案內修改。");
    if (newKind !== kind && !(TRACE_LIKE.includes(kind) && TRACE_LIKE.includes(newKind))) {
      throw new store.UserError(`「${relZh(kind)}」和「${relZh(newKind)}」在 SysML 裡是不同的寫法，不能直接互換。可以換對象；要換類型請移除後重新連線。`);
    }
    const nf = byId(b.newFrom ?? rel.from), nt = byId(b.newTo ?? rel.to);
    if (!nf || !nt) throw new store.UserError("找不到新的對象。");
    if (nf.id === rel.from && nt.id === rel.to && newKind === kind) return res.json({ saved: true, ...(await view(id)) });
    const file = rel.file;
    const content = removeLocs(await store.readFile(id, file), [rel.loc]);
    const a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return broken(res, a, "移除舊關係");
    const f1 = a.elements.find((e) => e.qualifiedName === nf.qualifiedName && e.kind === nf.kind);
    const t1 = a.elements.find((e) => e.qualifiedName === nt.qualifiedName && e.kind === nt.kind);
    const plan = planRelation(a, newKind, f1, t1);
    if (plan.file !== file) throw new store.UserError(`新的關係要寫在另一個檔案（${plan.file}），請先移除這條，再加入新的。`);
    const next = plan.apply(content);
    const r = await store.saveFile(id, file, next, author(req), `修改關係：${byId(rel.from)?.name ?? ""} ${relZh(kind)} ${byId(rel.to)?.name ?? ""} → ${nf.name} ${relZh(newKind)} ${nt.name}`);
    if (!r.saved) return broken(res, r.analysis, "修改關係");
    res.json({ saved: true, ...(await view(id)) });
  }));

  // 復原與重做：一步一步往回或往前。回傳版面與自訂圖，救回來的項目才會出現在原本的位置。
  for (const [name, step] of [["undo", -1], ["redo", 1]] as const) {
    app.post(`/api/projects/:id/${name}`, wrap(async (req, res) => {
      const id = pid(req);
      await store.stepHistory(id, author(req), step);
      res.json({ saved: true, ...(await view(id)), layout: await store.readLayout(id), diagrams: await store.readDiagrams(id) });
    }));
  }
}
