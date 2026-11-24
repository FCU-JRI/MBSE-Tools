// 送審紀錄（VER-08、ANA-12、VER-04、AI-02）：送審在工具內完成，不開 GitHub PR、不接 GitHub 審查（Mars 已定）。
// 紀錄存在專案儲存庫的 reviews/<分支>.json（分支名稱的斜線寫成 ~），和模型一起進版本紀錄；Claude 讀儲存庫就看得到。
// 紀錄隨分支提交；合併進 main 後留在 main，並補上核准者。
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { analyzeProject, commit, dirOf, git, lock, readProject, refOf, sources, readFile, UserError } from "./projects.ts";
import { analyzeAt, branchDiff, openBranch } from "./versions.ts";
import type { Change } from "./versions.ts";
import { buildVerdicts, massBudget } from "./calc.ts";
import { readCondition } from "./edits.ts";
import { detectConflicts } from "./conflicts.ts";
import { evaluateGates } from "./gates.ts";
import { frameworkView, withFrameworkChecks } from "./process.ts";
import { readPm } from "./pm.ts";
import * as sim from "./sim.ts";
import { levelOf, type User } from "./auth.ts";

export const REVIEW_DIR = "reviews";
export const APPROVERS_FILE = `${REVIEW_DIR}/approvers.json`;
/** reviews/<分支>.json（approvers.json 不是送審紀錄） */
export const REVIEW_FILE = /^reviews\/(?!approvers\.json$)[^/]+\.json$/;

export type ReviewStatus = "submitted" | "withdrawn" | "returned" | "merged";
export interface Comment { id: string; kind: "approve" | "return" | "comment"; by: string; rank: string; at: string; text: string }
export interface PreRun {
  at: string; commit: string;
  verdicts: { ok: boolean; total: number; holds: number; fails: number; undecided: number; failing: { requirement: string; name: string; note: string }[]; error?: string };
  conflicts: { ok: boolean; total: number; open: number; items: { name: string; condition: string; decided: boolean }[]; note?: string };
  framework: { ok: boolean; passed: number; total: number; failing: string[]; warnings: string[] };
  budget: { ok: boolean; rows: number; fails: { name: string; limitKg: number; sumKg: number }[]; error?: string };
  sim: { ran: boolean; engine?: string; at?: string; outputs?: { zh: string; value: number; unit: string }[]; note: string };
  changes: { added: number; changed: number; removed: number };
}
export interface Review {
  branch: string;
  status: ReviewStatus;
  submitted: { by: string; rank: string; at: string; note: string } | null;
  prerun: PreRun | null;
  comments: Comment[];
  /** 送審與撤回的歷程（每次送審一筆，保留先前的說明） */
  history: { action: "submit" | "withdraw" | "merge"; by: string; at: string; note: string }[];
  merged: { by: string; rank: string; at: string; commit: string; basis: string } | null;
}

const safe = (branch: string) => branch.replaceAll("/", "~");
export const fileOf = (branch: string) => `${REVIEW_DIR}/${safe(branch)}.json`;
const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const rankOf = (u: User) => u.rank ?? "";

export function emptyReview(branch: string): Review {
  return { branch, status: "withdrawn", submitted: null, prerun: null, comments: [], history: [], merged: null };
}

export function cleanReview(raw: unknown, branch: string): Review {
  if (!isObj(raw)) return emptyReview(branch);
  const st = ["submitted", "withdrawn", "returned", "merged"].includes(raw.status) ? raw.status as ReviewStatus : "withdrawn";
  const by = (v: any) => isObj(v) ? { by: text(v.by, 60), rank: text(v.rank, 20), at: text(v.at, 40) } : null;
  const sub = by(raw.submitted);
  return {
    branch, status: st,
    submitted: sub ? { ...sub, note: text(raw.submitted.note, 2000) } : null,
    prerun: isObj(raw.prerun) ? raw.prerun as PreRun : null,
    comments: (Array.isArray(raw.comments) ? raw.comments : []).filter(isObj).slice(-200).map((c: any) => ({
      id: text(c.id, 20) || randomBytes(4).toString("hex"), kind: ["approve", "return", "comment"].includes(c.kind) ? c.kind : "comment",
      by: text(c.by, 60), rank: text(c.rank, 20), at: text(c.at, 40), text: text(c.text, 2000),
    })),
    history: (Array.isArray(raw.history) ? raw.history : []).filter(isObj).slice(-100).map((h: any) => ({ action: ["submit", "withdraw", "merge"].includes(h.action) ? h.action : "submit", by: text(h.by, 60), at: text(h.at, 40), note: text(h.note, 2000) })),
    merged: isObj(raw.merged) ? { ...by(raw.merged)!, commit: text(raw.merged.commit, 40), basis: text(raw.merged.basis, 400) } : null,
  };
}

/** 讀某個參照（main 或分支工作目錄）裡的送審紀錄；沒有就是「未送審」。 */
export async function readReview(ref: string, branch: string): Promise<Review> {
  const raw = await fs.readFile(path.join(dirOf(ref), fileOf(branch)), "utf8").catch(() => "");
  try { return raw ? cleanReview(JSON.parse(raw), branch) : emptyReview(branch); } catch { return emptyReview(branch); }
}

async function writeReview(ref: string, r: Review): Promise<void> {
  const f = path.join(dirOf(ref), fileOf(r.branch));
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify(r, null, 2) + "\n", "utf8");
}

/** 從 git 讀某個分支提交裡的送審紀錄（不必先開啟分支）。 */
async function readFromGit(id: string, branch: string): Promise<Review | null> {
  const dir = dirOf(id);
  for (const rev of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const raw = await git(dir, "show", `${rev}:${fileOf(branch)}`).catch(() => "");
    if (raw) { try { return cleanReview(JSON.parse(raw), branch); } catch { /* 壞檔當作沒有 */ } }
  }
  return null;
}

/** 分支目前的送審狀態：分支上的最新紀錄和 main 上的（合併後補上核准者）取歷程較長的那份。 */
export async function reviewOf(id: string, branch: string): Promise<Review> {
  const mine = await readFromGit(id, branch);
  const main = await readReview(id, branch);
  return mine && mine.history.length >= main.history.length ? mine : main;
}

export async function listReviews(id: string): Promise<Review[]> {
  const names = new Set<string>();
  for (const n of await fs.readdir(path.join(dirOf(id), REVIEW_DIR)).catch(() => [] as string[])) if (n.endsWith(".json") && n !== "approvers.json") names.add(n.slice(0, -5).replaceAll("~", "/"));
  for (const n of (await git(dirOf(id), "for-each-ref", "--format=%(refname:short)", "refs/heads").catch(() => "")).split("\n")) if (n && n !== "main") names.add(n);
  const out: Review[] = [];
  for (const b of names) { const r = await reviewOf(id, b); if (r.history.length) out.push(r); }
  return out;
}

// ───────── 預跑（ANA-12）─────────

export async function prerun(ref: string, changes: Change[], who: string): Promise<PreRun> {
  const project = await readProject(ref);
  const a = await analyzeProject(ref);
  const sha = await git(dirOf(ref), "rev-parse", "--short", "HEAD");
  const out: PreRun = {
    at: new Date().toISOString(), commit: sha,
    verdicts: { ok: false, total: 0, holds: 0, fails: 0, undecided: 0, failing: [] },
    conflicts: { ok: false, total: 0, open: 0, items: [] },
    framework: { ok: false, passed: 0, total: 0, failing: [], warnings: [] },
    budget: { ok: false, rows: 0, fails: [] },
    sim: { ran: false, note: "未跑" },
    changes: { added: changes.filter((c) => c.type === "added").length, changed: changes.filter((c) => c.type === "changed").length, removed: changes.filter((c) => c.type === "removed").length },
  };
  if (!a.ok) {
    const e = a.diagnostics.find((d) => d.severity === "error");
    const msg = `模型有錯誤，未能預跑：${e ? `${e.file} 第 ${e.line} 行 ${e.message}` : ""}`;
    out.verdicts.error = msg; out.budget.error = msg; out.conflicts.note = msg; out.framework.warnings.push(msg);
    return out;
  }
  const guard = async <T>(fn: () => Promise<T>): Promise<T | string> => { try { return await fn(); } catch (e) { return `預跑失敗：${(e as Error).message}`.slice(0, 300); } };

  // constraint 判定
  const sim0 = await sim.readSim(ref);
  const src = await sources(ref);
  const contents = new Map<string, string>();
  const rows = await guard(() => buildVerdicts(src, {
    elements: a.elements, satisfaction: a.satisfaction, bindings: sim0.bindings,
    simAt: sim0.result ? { engine: sim0.result.engine, at: sim0.result.at } : null,
    readCondition: async (file, el) => {
      if (!contents.has(file)) contents.set(file, await readFile(ref, file));
      return readCondition(contents.get(file)!, el);
    },
  }));
  if (typeof rows === "string") out.verdicts.error = rows;
  else out.verdicts = {
    ok: true, total: rows.length, holds: rows.filter((r) => r.status === "holds").length, fails: rows.filter((r) => r.status === "fails").length, undecided: rows.filter((r) => r.status === "undecided").length,
    failing: rows.filter((r) => r.status === "fails").slice(0, 30).map((r) => ({ requirement: r.requirement, name: r.name, note: r.note })),
  };

  // 衝突
  const cf = await guard(() => detectConflicts(ref));
  if (typeof cf === "string") out.conflicts.note = cf;
  else out.conflicts = { ok: cf.ok, total: cf.conflicts.length, open: cf.conflicts.filter((c) => !c.decision).length, note: cf.note, items: cf.conflicts.slice(0, 30).map((c) => ({ name: c.name, condition: c.condition, decided: !!c.decision })) };

  // 框架檢查（只列警告，不擋）
  const fwr = await guard(async () => {
    const plan = await readPm(ref);
    const ev = await frameworkView(ref, project, a, plan.docs.length);
    const gates = withFrameworkChecks(evaluateGates(a, project.gates, project.manual, plan.tasks.length), ev, a);
    return { ev, checks: gates.flatMap((g) => g.framework) };
  });
  if (typeof fwr === "string") out.framework.warnings.push(fwr);
  else {
    const auto = fwr.checks.filter((c) => !c.manual);
    out.framework = {
      ok: true, passed: auto.filter((c) => c.pass).length, total: auto.length, failing: [...new Set(auto.filter((c) => !c.pass).map((c) => c.label))].slice(0, 30),
      warnings: [...(fwr.ev?.problems ?? []), ...(fwr.ev?.twoSources ?? []).slice(0, 10).map((t) => t.text), ...(fwr.ev?.holdPoints ?? []).filter((h) => h.open).map((h) => h.reason)].slice(0, 30),
    };
  }

  // 質量預算
  const kindOf = new Map(a.elements.map((e) => [e.id, e.kind]));
  const usages = a.elements.filter((e) => e.kind === "PartUsage" && !e.shared && e.owner && kindOf.get(e.owner) === "Package").map((e) => e.qualifiedName);
  const bud = await guard(() => massBudget(src, usages));
  if (typeof bud === "string") out.budget.error = bud;
  else out.budget = { ok: true, rows: bud.length, fails: bud.filter((b) => b.status === "FAIL").map((b) => ({ name: b.name, limitKg: b.limitKg, sumKg: b.sumKg })) };

  // 模擬：有 RocketPy 環境才跑
  const av = await sim.available();
  if (!av.ok) out.sim = { ran: false, note: "未跑（伺服器沒有 RocketPy 模擬環境）" };
  else {
    const s = await guard(() => sim.runSim(ref, who));
    if (typeof s === "string") out.sim = { ran: false, note: s };
    else out.sim = { ran: true, engine: s.result?.engine, at: s.result?.at, outputs: (s.result?.outputs ?? []).map((o) => ({ zh: o.zh, value: o.value, unit: o.unit })), note: "已跑" };
  }
  return out;
}

// ───────── 動作 ─────────

async function onBranch<T>(id: string, branch: string, who: string, message: string, fn: (ref: string) => Promise<T>): Promise<T> {
  const ref = refOf(id, branch);
  await openBranch(ref, false);
  const release = await lock(ref);
  try {
    const r = await fn(ref);
    await commit(dirOf(ref), who, message);
    return r;
  } finally { release(); }
}

export async function submit(id: string, branch: string, u: User, who: string, note: string): Promise<Review> {
  const diff = await branchDiff(id, branch);
  if (diff.changes.length === 0) throw new UserError("這個分支相對 main 沒有改動，不需要送審。");
  const cur = await reviewOf(id, branch);
  if (cur.status === "submitted") throw new UserError("這個分支已經送審中。要補充請先撤回送審再重新送審。");
  // 預跑可能要幾分鐘（有模擬環境時），不佔著分支的鎖；結果寫入前再取鎖
  const pre = await prerun(refOf(id, branch), diff.changes, who);
  const now = new Date().toISOString();
  return onBranch(id, branch, who, `送審 ${branch}`, async (ref) => {
    const r = await readReview(ref, branch);
    r.status = "submitted";
    r.submitted = { by: who, rank: rankOf(u), at: now, note: text(note, 2000) };
    r.prerun = pre;
    r.history.push({ action: "submit", by: who, at: now, note: text(note, 2000) });
    await writeReview(ref, r);
    return r;
  });
}

export async function withdraw(id: string, branch: string, u: User, who: string): Promise<Review> {
  const cur = await reviewOf(id, branch);
  if (cur.status !== "submitted" && cur.status !== "returned") throw new UserError("這個分支目前沒有送審。");
  const owner = cur.submitted?.by === who;
  if (!owner && levelOf(u) < 5) throw new UserError("只有送審的人或責任工程師以上可以撤回送審。");
  const now = new Date().toISOString();
  return onBranch(id, branch, who, `撤回送審 ${branch}`, async (ref) => {
    const r = await readReview(ref, branch);
    r.status = "withdrawn";
    r.history.push({ action: "withdraw", by: who, at: now, note: "" });
    await writeReview(ref, r);
    return r;
  });
}

export async function comment(id: string, branch: string, u: User, who: string, kind: string, body: string): Promise<Review> {
  if (!["approve", "return", "comment"].includes(kind)) throw new UserError("留言類型不正確。");
  const t = text(body, 2000);
  if (kind !== "approve" && !t) throw new UserError("請填留言內容。");
  const cur = await reviewOf(id, branch);
  if (cur.status !== "submitted" && cur.status !== "returned") throw new UserError("這個分支目前沒有送審。");
  if (kind !== "comment") {
    const a = await approverCheck(id, branch, u, who);
    if (!a.ok) throw new UserError(a.reason);
  }
  const now = new Date().toISOString();
  return onBranch(id, branch, who, `送審留言（${kind}）${branch}`, async (ref) => {
    const r = await readReview(ref, branch);
    r.comments.push({ id: randomBytes(4).toString("hex"), kind: kind as Comment["kind"], by: who, rank: rankOf(u), at: now, text: t });
    if (kind === "return") r.status = "returned";
    await writeReview(ref, r);
    return r;
  });
}

// ───────── 核准者（VER-04、TR-03）─────────

export type Approvers = Record<string, string[]>;

export async function readApprovers(id: string): Promise<Approvers> {
  const raw = await fs.readFile(path.join(dirOf(id), APPROVERS_FILE), "utf8").catch(() => "");
  try {
    const j = raw ? JSON.parse(raw) : {};
    const out: Approvers = {};
    if (isObj(j)) for (const [k, v] of Object.entries(j)) if (Array.isArray(v)) out[text(k, 60)] = v.map((x) => text(x, 80).toLowerCase()).filter(Boolean).slice(0, 20);
    return out;
  } catch { return {}; }
}

export async function saveApprovers(id: string, body: unknown, who: string): Promise<Approvers> {
  if (!isObj(body)) throw new UserError("格式不正確。");
  const out: Approvers = {};
  for (const [k, v] of Object.entries(body).slice(0, 50)) {
    const name = text(k, 60);
    if (!name || !Array.isArray(v)) continue;
    const list = [...new Set(v.map((x) => text(x, 80).toLowerCase()).filter(Boolean))].slice(0, 20);
    if (list.length) out[name] = list;
  }
  // 路由層（server/index.ts）已經替整個請求鎖住這個專案，這裡不能再取鎖
  const f = path.join(dirOf(id), APPROVERS_FILE);
  if (Object.keys(out).length === 0) await fs.rm(f, { force: true });
  else { await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, JSON.stringify(out, null, 2) + "\n", "utf8"); }
  await commit(dirOf(id), who, "更新送審核准者設定");
  return out;
}

/**
 * 分支改動所在的次系統：改動的元素（新增、修改、移除都算）若
 *  - 自己或往上的擁有者、
 *  - 它的型別、
 *  - 用追溯、衍生、滿足、分配等關係連到的另一端（含另一端的擁有者與型別）
 * 名稱和核准者設定的次系統名稱相同，就算受影響。連不到任何已設定次系統的改動不算（沿用職級門檻）。
 */
export async function affectedSubsystems(id: string, branch: string, configured: string[]): Promise<string[]> {
  if (configured.length === 0) return [];
  const { changes } = await branchDiff(id, branch);
  const dir = dirOf(id);
  const rev = (b: string) => git(dir, "rev-parse", "--verify", "--quiet", `refs/heads/${b}`).catch(() => git(dir, "rev-parse", `origin/${b}`));
  const head = await analyzeAt(dir, await rev(branch));
  const base = await analyzeAt(dir, await git(dir, "merge-base", "main", await rev(branch)));
  const hit = new Set<string>();
  for (const c of changes) {
    const key = c.key.split("::")[0];
    for (const a of [head, base]) {
      const byId = new Map(a.elements.map((e) => [e.id, e]));
      const names = (id0: string | null | undefined, out: Set<string>) => {
        let el = id0 ? byId.get(id0) : undefined;
        for (let i = 0; el && i < 30; i++) { out.add(el.name); for (const t of el.types) out.add(t); el = el.owner ? byId.get(el.owner) : undefined; }
      };
      const el = byId.get(key) ?? a.elements.find((e) => e.shortName === key || e.qualifiedName === key);
      if (!el) continue;
      const found = new Set<string>();
      names(el.id, found);
      for (const r of a.relations) {
        if (r.from === el.id) names(r.to, found);
        else if (r.to === el.id) names(r.from, found);
      }
      for (const n of configured) if (found.has(n)) hit.add(n);
    }
  }
  return [...hit];
}

export interface ApproverCheck { ok: boolean; reason: string; basis: string; subsystems: string[] }

/**
 * 誰可以核准（留言「核准」、合併）：
 *  - 專案沒設定核准者，或改動沒碰到設定過的次系統：沿用職級門檻（責任工程師以上）。
 *  - 碰到設定過的次系統：總工程師以上，或每個受影響次系統的負責人（名單內且責任工程師以上）。
 */
export async function approverCheck(id: string, branch: string, u: User, who: string): Promise<ApproverCheck> {
  if (!u.rank) return { ok: false, reason: "唯讀身分不能核准。", basis: "", subsystems: [] };
  const lvl = levelOf(u);
  const cfg = await readApprovers(id);
  const subs = await affectedSubsystems(id, branch, Object.keys(cfg));
  if (subs.length === 0) {
    const ok = lvl >= 5;
    return { ok, reason: ok ? "" : "合併分支需要責任工程師以上的權限。", basis: Object.keys(cfg).length ? "改動沒有碰到設定過核准者的次系統，沿用職級門檻（責任工程師以上）" : "專案沒有設定核准者，沿用職級門檻（責任工程師以上）", subsystems: [] };
  }
  if (lvl >= 7) return { ok: true, reason: "", basis: `受影響次系統：${subs.join("、")}；總工程師以上可核准`, subsystems: subs };
  const ids = [u.login, who, u.name].map((x) => x.toLowerCase());
  const missing = subs.filter((s) => !(cfg[s] ?? []).some((x) => ids.includes(x)));
  const ok = lvl >= 5 && missing.length === 0;
  return {
    ok, reason: ok ? "" : `這個分支改到次系統「${subs.join("、")}」，要這些次系統的負責人（${missing.join("、") || "責任工程師以上"}）或總工程師以上才能核准。`,
    basis: `受影響次系統：${subs.join("、")}；${ok ? "核准者是這些次系統的負責人" : ""}`, subsystems: subs,
  };
}

/** 合併成功後在 main 補上合併紀錄（核准者、依據）。分支沒有送審紀錄時也建一份，之後查得到誰核准。 */
export async function recordMerge(id: string, branch: string, u: User, who: string, check: ApproverCheck, mergeCommit: string): Promise<void> {
  // 路由層已鎖住這個專案（見 server/index.ts），不再取鎖
  const r = await readReview(id, branch);
  const now = new Date().toISOString();
  r.status = "merged";
  r.merged = { by: who, rank: rankOf(u), at: now, commit: mergeCommit, basis: check.basis.slice(0, 400) };
  r.history.push({ action: "merge", by: who, at: now, note: check.basis.slice(0, 400) });
  await writeReview(id, r);
  // 併入剛完成的合併提交（提交訊息不變）；推送是延後進行的，這裡改寫提交不會和推送衝突
  const dir = dirOf(id);
  await git(dir, "add", "--", fileOf(branch));
  await git(dir, "-c", `user.name=${who.trim() || "JRI MBSE"}`, "-c", "user.email=mbse@jri.local", "commit", "--amend", "--no-edit", "--quiet");
}
