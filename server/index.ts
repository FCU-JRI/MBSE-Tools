import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ROOT_PACKAGE, shutdown } from "./engine.ts";
import { evaluateGates, GATES } from "./gates.ts";
import { CATEGORIES, PILLARS, RELATION_LABELS } from "./metamodel.ts";
import * as store from "./projects.ts";
import { commentText, deletePackageText, insertBody, moveIntoPackage, moveOutOfPackage, packageText, setCommentText, deleteElementText, insertInside, insertInto, quote, relationSnippet, removeLocs, renameText, setAttrText, setDocText, setRawAttrText, setShortNameText, setSourceText, snippetFor } from "./edits.ts";
import { exportWorkbook } from "./export.ts";
import type { Element } from "./extract.ts";
import * as auth from "./auth.ts";
import * as versions from "./versions.ts";
import * as pm from "./pm.ts";
import * as sim from "./sim.ts";
import { evaluateProcess, stepOfCategory } from "./process.ts";
import { buildReport, renderDocx, renderHtml } from "./report.ts";
import type { User } from "./auth.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_FILE = "model.sysml";
type An = Awaited<ReturnType<typeof store.analyzeProject>>;
/** 根套件 Project 所在的檔案；新元素預設寫在這裡。 */
const rootFile = (a: An) => a.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE)?.file || MAIN_FILE;
const inFile = (a: An, file: string) => a.elements.filter((e) => e.file === file);
function editable(el: Element): Element {
  if (el.shared) throw new store.UserError("這是共用元件庫的內容，不能在專案內修改。請管理員到「管理」頁修改。");
  return el;
}
/** 使用者自己建的套件：專案內、不是根套件、也不是工具依類別自動建立的那幾個。 */
const CAT_PKGS = new Set(CATEGORIES.map((c) => c.pkg));
const isUserPackage = (e: Element | undefined): e is Element =>
  !!e && e.kind === "Package" && !e.shared && e.qualifiedName !== ROOT_PACKAGE && !(e.qualifiedName.split("::").length === 2 && CAT_PKGS.has(e.name));
const app = express();
app.use(express.json({ limit: "5mb" }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
const me = (req: Request) => req.user as User;
// 修改紀錄的作者取自登入身分；只有這台電腦本機操作時才採用自填的名字
const author = (req: Request) => {
  const u = me(req);
  const typed = String(req.body?.author ?? "").trim().slice(0, 60);
  return u.kind === "local" && typed ? typed : u.name;
};
const pid = (req: Request) => String(req.params.id);

async function view(id: string) {
  const project = await store.readProject(id);
  const analysis = await store.analyzeProject(id);
  const plan = await pm.readPm(id);
  const gates = evaluateGates(analysis, project.gates, project.manual, plan.tasks.length);
  return { project, analysis, gates, docs: plan.docs, milestones: plan.milestones, process: analysis.ok ? evaluateProcess(analysis) : [], history: await store.historyState(id) };
}

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
auth.mountAuthRoutes(app);
app.use("/api", auth.authenticate);
app.use("/api/projects/:id", auth.projectGuard);

app.get("/api/me", wrap(async (req, res) => {
  const c = await auth.getConfig();
  res.json({ user: req.user ? auth.describe(req.user) : null, githubLogin: !!(c.github.clientId && c.github.clientSecret && c.publicUrl), public: req.isPublic === true });
}));

// ───────── 管理：成員、唯讀連結、登入設定 ─────────
const admin = auth.need(auth.can.admin, "只有總工程師以上或管理員可以操作。");
app.get("/api/admin/members", admin, wrap(async (_req, res) => res.json({ members: await auth.listMembers(), ranks: auth.RANKS.map((r) => ({ id: r, zh: auth.RANK_ZH[r] })) })));
app.post("/api/admin/members", admin, wrap(async (req, res) => res.json({ members: await auth.saveMember(req.body ?? {}) })));
app.post("/api/admin/members/delete", admin, wrap(async (req, res) => res.json({ members: await auth.removeMember(String(req.body?.login ?? "")) })));
app.get("/api/admin/shares", admin, wrap(async (_req, res) => res.json({ shares: await auth.listShares() })));
app.post("/api/admin/shares", admin, wrap(async (req, res) => {
  await store.readProject(String(req.body?.project ?? ""));
  const c = await auth.getConfig();
  const r = await auth.createShare(String(req.body.project), String(req.body.label ?? ""), Number(req.body.days), me(req).name);
  res.json({ ...r, path: `/s/${r.token}`, publicUrl: c.publicUrl });
}));
app.post("/api/admin/shares/delete", admin, wrap(async (req, res) => { await auth.revokeShare(String(req.body?.id ?? "")); res.json({ shares: await auth.listShares() }); }));
app.get("/api/admin/config", admin, wrap(async (_req, res) => {
  const c = await auth.getConfig();
  res.json({ publicUrl: c.publicUrl, clientId: c.github.clientId, hasSecret: !!c.github.clientSecret, tailscaleAdmins: c.tailscaleAdmins });
}));
app.post("/api/admin/config", admin, wrap(async (req, res) => { await auth.updateConfig(req.body ?? {}); res.json({ saved: true }); }));

// 共用元件庫（跨專案，以航電為主）
app.get("/api/shared", wrap(async (_req, res) => {
  const files = await store.listShared();
  res.json({ files: await Promise.all(files.map(async (f) => ({ file: f, content: await store.readShared(f) }))) });
}));
app.put("/api/shared/:file", admin, wrap(async (req, res) => {
  const r = await store.saveShared(String(req.params.file), String(req.body?.content ?? ""));
  res.status(r.saved ? 200 : 422).json({ saved: r.saved, diagnostics: r.analysis.diagnostics });
}));

app.get("/api/meta", (_req, res) => {
  res.json({
    categories: CATEGORIES,
    pillars: PILLARS,
    relations: RELATION_LABELS,
    gates: GATES.map((g) => ({ id: g.id, zh: g.zh, en: g.en, deadline: g.deadline, approver: g.approver, purpose: g.purpose, perSubsystem: g.perSubsystem })),
  });
});

app.get("/api/projects", wrap(async (req, res) => {
  const all = await store.listProjects();
  const only = me(req).project;
  res.json(only ? all.filter((p) => p.id === only) : all);
}));

app.post("/api/projects", auth.need(auth.can.createProject, "建立專案需要總工程師以上的權限。"), wrap(async (req, res) => {
  const { id, name, kind, gates, template } = req.body ?? {};
  res.json(await store.createProject({ id: String(id ?? ""), name: String(name ?? ""), kind: kind === "small" ? "small" : "annual", gates, template: String(template ?? "sample"), author: author(req) }));
}));

// 封存專案（管理員）。資料移到 archive 資料夾，可手動移回來還原。
app.post("/api/projects/:id/archive", admin, wrap(async (req, res) => {
  await store.archiveProject(pid(req), String(req.body?.confirm ?? ""));
  res.json({ archived: true });
}));

app.get("/api/projects/:id", wrap(async (req, res) => res.json(await view(pid(req)))));

app.get("/api/projects/:id/files", wrap(async (req, res) => res.json(await store.listFiles(pid(req)))));

app.get("/api/projects/:id/files/:file", wrap(async (req, res) => {
  res.json({ content: await store.readFile(pid(req), String(req.params.file)) });
}));

// 只檢查、不儲存：原始碼編輯器即時顯示錯誤用
app.post("/api/projects/:id/validate", wrap(async (req, res) => {
  const a = await store.analyzeProject(pid(req), { file: String(req.body.file), content: String(req.body.content ?? "") });
  res.json({ ok: a.ok, diagnostics: a.diagnostics });
}));

app.put("/api/projects/:id/files/:file", wrap(async (req, res) => {
  const r = await store.saveFile(pid(req), String(req.params.file), String(req.body.content ?? ""), author(req), String(req.body.message ?? ""));
  res.status(r.saved ? 200 : 422).json({ saved: r.saved, commit: r.commit, diagnostics: r.analysis.diagnostics });
}));

// 引導模式：新增元素
app.post("/api/projects/:id/elements", wrap(async (req, res) => {
  const id = pid(req);
  const before = await store.analyzeProject(id);
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正後再新增。");
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
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正後再新增。");
  const from = before.elements.find((e) => e.id === req.body.from);
  const to = before.elements.find((e) => e.id === req.body.to);
  if (!from || !to) throw new store.UserError("找不到要連結的元素。");
  if (from.id === to.id) throw new store.UserError("不能把元素連到自己。");
  if (before.relations.some((r) => r.kind === req.body.kind && r.from === from.id && r.to === to.id)) throw new store.UserError("這條關係已經存在。");
  const kind0 = String(req.body.kind);
  const owner0 = before.elements.find((x) => x.id === from.owner);
  // 寫進某個元素主體的關係用該元素的檔案，其餘寫在根套件
  const file = kind0 === "compose" || (kind0 === "satisfy" && /Definition$/.test(from.kind)) ? editable(from).file
    : ["connect", "succession", "transition"].includes(kind0) && owner0 ? editable(owner0).file : rootFile(before);
  const content = await store.readFile(id, file);
  const kind = String(req.body.kind);
  const qn = (q: string) => q.split("::").map(quote).join("::");
  const ownerOf = (e: typeof from) => before.elements.find((x) => x.id === e.owner);
  let next: string;
  if (kind === "satisfy" && /Definition$/.test(from.kind)) {
    // satisfy 的滿足者必須是使用（usage）；若選的是定義，就把 satisfy 寫進該定義的主體
    next = insertInside(content, from, (indent) => `${indent}satisfy ${qn(to.qualifiedName)};\n`);
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
      if (editable(host).file !== file) throw new store.UserError("功能與分配對象在不同檔案，請到「原始碼」分頁建立分配。");
      next = insertInside(content, host, (indent) => `${indent}allocate ${featureRef(from)} to ${quote(target.name)};
`);
    } else {
      next = insertInto(content, inFile(before, file), ROOT_PACKAGE, null, (indent) => `${indent}allocate ${featureRef(from)} to ${featureRef(target)};
`);
    }
  } else if (kind === "compose") {
    // 結構分解：在上層定義內加入一個以下層定義為型別的零件
    if (from.kind !== "PartDefinition" || to.kind !== "PartDefinition") throw new store.UserError("結構分解只能連接兩個定義（part def）。");
    if (from.id === to.id) throw new store.UserError("不能把元素放進自己裡面。");
    next = insertInside(content, from, (indent) => `${indent}part ${quote(to.name)} : ${qn(to.qualifiedName)};\n`);
  } else if (kind === "connect" || kind === "succession" || kind === "transition") {
    const owner = ownerOf(from);
    if (!owner || owner.id !== to.owner) throw new store.UserError("兩端必須在同一個上層元素內。");
    if (kind === "succession" && !/^Action/.test(owner.kind)) throw new store.UserError("先後順序只能建立在同一個任務或活動之內。");
    if (kind === "transition" && !/^State/.test(owner.kind)) throw new store.UserError("狀態轉換只能建立在同一個模式之內。");
    const text = kind === "connect" ? `connect ${quote(from.name)} to ${quote(to.name)};`
      : kind === "transition" ? `transition first ${quote(from.name)} then ${quote(to.name)};`
      : `first ${quote(from.name)} then ${quote(to.name)};`;
    next = insertInside(content, owner, (indent) => `${indent}${text}\n`);
  } else {
    next = insertInto(content, inFile(before, file), ROOT_PACKAGE, null, (indent) =>
      relationSnippet({ kind: req.body.kind, from: from.qualifiedName, to: to.qualifiedName }, indent));
  }
  const zh = RELATION_LABELS[kind]?.zh ?? ({ compose: "包含", connect: "連接", succession: "之後是", transition: "轉換到" } as Record<string, string>)[kind] ?? kind;
  const r = await store.saveFile(id, file, next, author(req), `新增關係：${from.name} ${zh} ${to.name}`);
  if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
  res.json({ saved: true, ...(await view(id)) });
}));

// 刪除關係
app.post("/api/projects/:id/relations/delete", wrap(async (req, res) => {
  const id = pid(req);
  const before = await store.analyzeProject(id);
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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
  if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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
  if (steps.length === 0 && !newId) return res.json({ saved: true, ...(await view(id)) });
  let el: Element = target;
  for (const step of steps) {
    content = step(content, el, a);
    a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
    const again = findAgain(a.elements, el);
    if (!again) throw new store.UserError("修改後找不到這個元素，未儲存。請到「原始碼」分頁修改。");
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
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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
  if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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
      if (pkg.file !== file) throw new store.UserError("套件和項目在不同檔案，請到「原始碼」分頁處理。");
      if (el.owner === pkg.id || el.id === pkg.id) continue;
      if (el.kind === "Package") throw new store.UserError("目前不支援把套件放進另一個套件，請到「原始碼」分頁處理。");
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
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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
  if (!before.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
  const el = before.elements.find((e) => e.id === req.body?.id && e.kind === "Comment");
  if (!el) throw new store.UserError("找不到這則註解。");
  const file = editable(el).file;
  const r = await store.saveFile(id, file, setCommentText(await store.readFile(id, file), el, String(req.body?.text ?? "")), author(req), "修改註解");
  if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
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

// 圖的版面（節點位置）。不影響模型，隨下一次儲存一併提交。
app.get("/api/projects/:id/layout", wrap(async (req, res) => res.json(await store.readLayout(pid(req)))));
app.put("/api/projects/:id/layout", wrap(async (req, res) => {
  await store.writeLayout(pid(req), req.body?.layout ?? {});
  res.json({ saved: true });
}));
app.get("/api/projects/:id/diagrams", wrap(async (req, res) => res.json(await store.readDiagrams(pid(req)))));
app.put("/api/projects/:id/diagrams", wrap(async (req, res) => res.json(await store.writeDiagrams(pid(req), req.body?.diagrams))));

app.post("/api/projects/:id/manual", auth.need(auth.can.confirm, "人工確認需要責任工程師以上的權限。"), wrap(async (req, res) => {
  await store.setManual(pid(req), String(req.body.key), req.body.done === true, author(req));
  res.json(await view(pid(req)));
}));

// 簽核：簽核人與職級取自登入身分，權限依 AEAS Table 3
app.post("/api/projects/:id/signoffs", wrap(async (req, res) => {
  const b = req.body ?? {};
  const u = me(req);
  const project = await store.readProject(pid(req));
  const gate = String(b.gate);
  const subsystem = b.subsystem ? String(b.subsystem) : null;
  if (!auth.can.signoff(u, gate, project.highPower !== false, subsystem)) {
    const def = GATES.find((g) => g.id === gate);
    throw new store.UserError(`你的職級不能簽核這個節點。核可者：${def?.approver ?? "指定職級"}。`);
  }
  await store.signoff(pid(req), {
    gate, subsystem, decision: b.decision === "APPROVE" ? "APPROVE" : "DENY",
    by: u.name, role: u.rank ? `${auth.RANK_ZH[u.rank]} [${u.rank}]` : "", comment: String(b.comment ?? ""),
  });
  res.json(await view(pid(req)));
}));

// ───────── 專案管理：時程、成本、人員 ─────────
const pmKind = (req: Request): pm.Kind => {
  const k = String(req.params.kind);
  if (k !== "tasks" && k !== "costs" && k !== "people" && k !== "docs") throw new store.UserError("未知的資料類型。");
  return k;
};
app.get("/api/projects/:id/pm", wrap(async (req, res) => res.json({ ...(await pm.readPm(pid(req))), priorities: pm.PRIORITIES.map((p) => ({ id: p, zh: pm.PRIORITY_ZH[p], level: pm.PRIORITY_LEVEL[p] })), myLevel: auth.levelOf(me(req)) })));
app.post("/api/projects/:id/milestones", auth.need(auth.can.confirm, "設定里程碑日期需要責任工程師以上的權限。"), wrap(async (req, res) => {
  await pm.setMilestone(pid(req), String(req.body?.gate ?? ""), String(req.body?.date ?? ""), author(req));
  res.json(await view(pid(req)));
}));
app.post("/api/projects/:id/pm/:kind", wrap(async (req, res) => res.json(await pm.upsert(pid(req), pmKind(req), req.body ?? {}, auth.levelOf(me(req)), author(req)))));
app.post("/api/projects/:id/pm/:kind/delete", wrap(async (req, res) => res.json(await pm.remove(pid(req), pmKind(req), String(req.body?.id ?? ""), author(req)))));

// ───────── 物理計算：RocketPy 與 OpenRocket ─────────
// 各輸出回寫時嘗試的單位寫法；解析器接受哪一種就用哪一種，都不接受就不寫入
const UNIT_FORMS: Record<string, string[]> = { m: ["[m]"], kg: ["[kg]"], s: ["[s]"], "m/s": ["['m/s']", "[m/s]"], "N*s": ["[N*s]", "['N⋅s']", "['N·s']"], "m/s^2": ["['m/s²']", "[m/s^2]", "['m/s^2']"], cal: [""], "": [""] };
app.get("/api/projects/:id/sim", wrap(async (req, res) => res.json({ ...(await sim.readSim(pid(req))), available: await sim.available() })));
app.put("/api/projects/:id/sim/inputs", wrap(async (req, res) => res.json(await sim.saveInputs(pid(req), req.body?.inputs, author(req)))));
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
  let a = await store.analyzeProject(id);
  if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
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

// ───────── 版本：GitHub 同步、分支審查、基線比較 ─────────
app.get("/api/projects/:id/sync", wrap(async (req, res) => res.json(await store.syncState(pid(req)))));
app.post("/api/projects/:id/remote", admin, wrap(async (req, res) => res.json(await store.setRemote(pid(req), String(req.body?.url ?? "")))));
app.get("/api/projects/:id/branches", wrap(async (req, res) => res.json(await versions.listBranches(pid(req)))));
app.get("/api/projects/:id/branches/diff", wrap(async (req, res) => res.json(await versions.branchDiff(pid(req), String(req.query.name ?? "")))));
app.post("/api/projects/:id/branches/merge", auth.need(auth.can.merge, "合併分支需要責任工程師以上的權限。"), wrap(async (req, res) => {
  const r = await versions.mergeBranch(pid(req), String(req.body?.name ?? ""), author(req));
  res.json({ ...r, ...(await view(pid(req))) });
}));
app.get("/api/projects/:id/baselines", wrap(async (req, res) => res.json(await versions.listBaselines(pid(req)))));
app.get("/api/projects/:id/compare", wrap(async (req, res) => res.json(await versions.compare(pid(req), String(req.query.from ?? ""), String(req.query.to ?? "")))));

app.get("/api/projects/:id/history", wrap(async (req, res) => res.json(await store.history(pid(req)))));

app.get("/api/projects/:id/export.xlsx", wrap(async (req, res) => {
  const v = await view(pid(req));
  if (!v.analysis.ok) throw new store.UserError("模型目前有錯誤，修正後才能匯出。");
  const buf = await exportWorkbook(v.project, v.analysis, v.gates, await pm.readPm(pid(req)));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${v.project.id}-mbse.xlsx"`);
  res.send(buf);
}));

// 審查報告：?gate=節點代號&format=html|docx。html 可用瀏覽器列印成 PDF。
app.get("/api/projects/:id/report", wrap(async (req, res) => {
  const id = pid(req);
  const v = await view(id);
  if (!v.analysis.ok) throw new store.UserError("模型目前有錯誤，修正後才能產生報告。");
  const gate = String(req.query.gate ?? v.gates[0]?.id ?? "");
  const head = (await store.history(id))[0]?.commit ?? "";
  const report = buildReport(v.project, v.analysis, v.gates, await pm.readPm(id), await sim.readSim(id), gate, head);
  if (req.query.format === "docx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${id}-${gate}-report.docx"`);
    return res.send(await renderDocx(report));
  }
  // 報告頁只有自己產生的內容與一個列印按鈕，不載入任何外部資源
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
  res.type("html").send(renderHtml(report));
}));

const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof store.UserError) return res.status(400).json({ error: err.message });
  if (err instanceof auth.AuthError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "伺服器發生錯誤，請查看伺服器紀錄。" });
});

// 內部埠給本機與 Tailscale 私人網路；公開埠給 Funnel，必須登入。兩者都只綁在本機。
const servers = [
  app.listen(auth.INTERNAL_PORT, "127.0.0.1", () => console.log(`JRI MBSE 內部埠：http://127.0.0.1:${auth.INTERNAL_PORT}`)),
  app.listen(auth.PUBLIC_PORT, "127.0.0.1", () => console.log(`JRI MBSE 公開埠（需登入）：http://127.0.0.1:${auth.PUBLIC_PORT}`)),
];
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { for (const sv of servers) sv.close(); shutdown().finally(() => process.exit(0)); });
}
