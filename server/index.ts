import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ROOT_PACKAGE, shutdown } from "./engine.ts";
import { evaluateGates, GATES } from "./gates.ts";
import { CATEGORIES, PILLARS, RELATION_LABELS } from "./metamodel.ts";
import * as store from "./projects.ts";
import { deleteElementText, insertInside, insertInto, quote, relationSnippet, removeLocs, renameText, setAttrText, setDocText, snippetFor } from "./edits.ts";
import { exportWorkbook } from "./export.ts";
import type { Element } from "./extract.ts";
import * as auth from "./auth.ts";
import * as versions from "./versions.ts";
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
  const gates = evaluateGates(analysis, project.gates, project.manual);
  return { project, analysis, gates };
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
  const { id, name, kind, gates } = req.body ?? {};
  res.json(await store.createProject({ id: String(id ?? ""), name: String(name ?? ""), kind: kind === "small" ? "small" : "annual", gates, author: author(req) }));
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
  if (typeof b.name === "string" && b.name.trim() !== target.name) steps.push((c, el, an) => renameText(c, el, b.name, inFile(an, file), an.relations.filter((r) => r.file === file)));
  if (typeof b.doc === "string" && b.doc.trim() !== target.doc.trim()) steps.push((c, el) => setDocText(c, el, b.doc));
  for (const f of cat?.fields ?? []) {
    const v = b.attrs?.[f.name];
    if (typeof v === "string" && v.trim() !== (target.attrs[f.name] ?? "").trim()) steps.push((c, el) => setAttrText(c, el, f, v));
  }
  if (steps.length === 0) return res.json({ saved: true, ...(await view(id)) });
  let el: Element = target;
  for (const step of steps) {
    content = step(content, el, a);
    a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
    const again = findAgain(a.elements, el);
    if (!again) throw new store.UserError("修改後找不到這個元素，未儲存。請到「原始碼」分頁修改。");
    el = again;
  }
  const r = await store.saveFile(id, file, content, author(req), `修改${cat?.zh ?? "元素"}：${el.name}`);
  if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
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
  const next = deleteElementText(await store.readFile(id, file), el, before.elements, before.relations.filter((r) => r.file === file));
  const r = await store.saveFile(id, file, next, author(req), `刪除：${el.shortName ?? ""} ${el.name}`.trim());
  if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
  res.json({ saved: true, ...(await view(id)) });
}));

// 圖的版面（節點位置）。不影響模型，隨下一次儲存一併提交。
app.get("/api/projects/:id/layout", wrap(async (req, res) => res.json(await store.readLayout(pid(req)))));
app.put("/api/projects/:id/layout", wrap(async (req, res) => {
  await store.writeLayout(pid(req), req.body?.layout ?? {});
  res.json({ saved: true });
}));

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
  const buf = await exportWorkbook(v.project, v.analysis, v.gates);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${v.project.id}-mbse.xlsx"`);
  res.send(buf);
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
