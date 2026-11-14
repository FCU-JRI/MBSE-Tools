// 版本：分支審查與合併（成員用自己的 Claude 在分支上修改後送審）、基線比較。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./engine.ts";
import type { Analysis, Source } from "./engine.ts";
import type { Element } from "./extract.ts";
import { commit, dirOf, git, listShared, pushLater, readProject, readShared, repoConfig, UserError } from "./projects.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = path.join(ROOT, "library", "JRI.sysml");
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,120}$/;

async function resolve(dir: string, ref: string): Promise<string> {
  if (!REF.test(ref) || ref.includes("..")) throw new UserError("版本名稱不合法。");
  return git(dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`).catch(() => { throw new UserError(`找不到版本 ${ref}。`); });
}

/** 解析某個版本（分支、標籤或提交）的模型，用目前的元模型庫與共用元件庫。 */
async function analyzeAt(dir: string, sha: string): Promise<Analysis> {
  const names = (await git(dir, "ls-tree", "--name-only", sha, "model/")).split("\n").map((n) => n.trim()).filter((n) => n.endsWith(".sysml"));
  const shared = await listShared();
  const sources: Source[] = [["JRI.sysml", await fs.readFile(LIBRARY, "utf8")]];
  for (const f of shared) sources.push([f, await readShared(f)]);
  for (const n of names) sources.push([path.posix.basename(n), await git(dir, "show", `${sha}:${n}`) + "\n"]);
  return analyze(sources, shared);
}

export interface BranchInfo { name: string; remote: boolean; ahead: number; behind: number; author: string; date: string; subject: string; ok: boolean; errors: number; firstError: string }

const fetched = new Map<string, number>();
export async function listBranches(id: string): Promise<BranchInfo[]> {
  const dir = dirOf(id);
  await readProject(id);
  // 向 GitHub 抓一次要一秒左右，一分鐘內不重抓
  if (Date.now() - (fetched.get(dir) ?? 0) > 60_000 && await git(dir, "remote", "get-url", "origin").catch(() => "")) {
    fetched.set(dir, Date.now());
    await git(dir, "fetch", "--prune", "origin").catch(() => "");
  }
  const raw = await git(dir, "for-each-ref", "--format=%(refname)\t%(objectname)\t%(authorname)\t%(authordate:iso-strict)\t%(subject)", "refs/heads", "refs/remotes/origin");
  const seen = new Set<string>();
  const out: BranchInfo[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [refname, sha, author, date, ...subj] = line.split("\t");
    const remote = refname.startsWith("refs/remotes/origin/");
    const name = refname.replace(/^refs\/(heads|remotes\/origin)\//, "");
    if (name === "main" || name === "HEAD" || seen.has(name)) continue;
    seen.add(name);
    const [behind, ahead] = (await git(dir, "rev-list", "--left-right", "--count", `main...${sha}`)).split(/\s+/).map(Number);
    if (!ahead) continue; // 已經合併的分支不列
    const a = await analyzeAt(dir, sha).catch(() => null);
    const errs = a ? a.diagnostics.filter((d) => d.severity === "error") : [];
    out.push({ name, remote, ahead, behind, author, date, subject: subj.join("\t"), ok: !!a?.ok, errors: a ? errs.length : 1, firstError: a ? (errs[0] ? `${errs[0].file} 第 ${errs[0].line} 行：${errs[0].message}` : "") : "無法讀取這個分支的模型" });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

const branchRef = async (dir: string, name: string) => {
  if (!REF.test(name) || name === "main") throw new UserError("分支名稱不合法。");
  const local = await git(dir, "rev-parse", "--verify", "--quiet", `refs/heads/${name}`).catch(() => "");
  return local || resolve(dir, `origin/${name}`);
};

export async function branchDiff(id: string, name: string): Promise<{ diff: string; changes: Change[] }> {
  const dir = dirOf(id);
  const sha = await branchRef(dir, name);
  const base = await git(dir, "merge-base", "main", sha);
  const diff = await git(dir, "diff", "--no-color", `${base}..${sha}`, "--", "model");
  return { diff: diff.slice(0, 200_000), changes: diffElements(await analyzeAt(dir, base), await analyzeAt(dir, sha)) };
}

/** 合併前先確認合併後的模型能解析；不能就取消，main 不會被弄壞。 */
export async function mergeBranch(id: string, name: string, author: string): Promise<{ commit: string }> {
  const dir = dirOf(id);
  const sha = await branchRef(dir, name);
  await repoConfig(dir);
  if (await git(dir, "status", "--porcelain")) await commit(dir, author, "合併前儲存未提交的變更");
  try {
    await git(dir, "-c", `user.name=${author || "JRI MBSE"}`, "-c", "user.email=mbse@jri.local", "merge", "--no-ff", "--no-commit", sha);
  } catch {
    await git(dir, "merge", "--abort").catch(() => "");
    throw new UserError("這個分支和目前的模型有衝突，無法自動合併。請分支作者先把 main 合併進自己的分支並解決衝突。");
  }
  const { analyzeProject } = await import("./projects.ts");
  const a = await analyzeProject(id);
  if (!a.ok) {
    await git(dir, "merge", "--abort").catch(() => "");
    const e = a.diagnostics.find((d) => d.severity === "error");
    throw new UserError(`合併後的模型有錯誤，已取消合併：${e ? `${e.file} 第 ${e.line} 行 ${e.message}` : ""}`);
  }
  await git(dir, "-c", `user.name=${author || "JRI MBSE"}`, "-c", "user.email=mbse@jri.local", "commit", "-m", `合併分支 ${name}`);
  pushLater(dir);
  return { commit: await git(dir, "rev-parse", "--short", "HEAD") };
}

export interface Baseline { ref: string; label: string; date: string; commit: string }

export async function listBaselines(id: string): Promise<Baseline[]> {
  const dir = dirOf(id);
  const project = await readProject(id);
  const raw = await git(dir, "for-each-ref", "--sort=-creatordate", "--format=%(refname:short)\t%(creatordate:iso-strict)\t%(objectname:short)", "refs/tags/baseline");
  const out: Baseline[] = [{ ref: "HEAD", label: "目前的模型", date: new Date().toISOString(), commit: await git(dir, "rev-parse", "--short", "HEAD") }];
  for (const line of raw.split("\n").filter(Boolean)) {
    const [ref, date, sha] = line.split("\t");
    const so = project.signoffs.find((s) => s.decision === "APPROVE" && sha.startsWith(s.commit.slice(0, 7)) || false);
    const gate = ref.split("/")[1]?.split("-")[0]?.toUpperCase() ?? "";
    out.push({ ref, label: `${gate} 核可${so?.subsystem ? `（${so.subsystem}）` : ""}`, date, commit: sha });
  }
  return out;
}

export interface Change { type: "added" | "removed" | "changed"; key: string; name: string; category: string | null; fields: { field: string; from: string; to: string }[] }

const keyOf = (e: Element) => e.shortName ?? e.qualifiedName;
const keep = (e: Element) => e.kind !== "ReferenceUsage" && e.kind !== "Package" && !e.shared;

function diffElements(a: Analysis, b: Analysis): Change[] {
  const A = new Map(a.elements.filter(keep).map((e) => [keyOf(e), e]));
  const B = new Map(b.elements.filter(keep).map((e) => [keyOf(e), e]));
  const relsOf = (an: Analysis, e: Element) => {
    const by = new Map(an.elements.map((x) => [x.id, x]));
    return an.relations.filter((r) => r.from === e.id).map((r) => `${r.kind}→${by.get(r.to) ? keyOf(by.get(r.to) as Element) : "?"}`).sort().join("、");
  };
  const out: Change[] = [];
  for (const [k, e] of B) if (!A.has(k)) out.push({ type: "added", key: k, name: e.name, category: e.category, fields: [] });
  for (const [k, e] of A) if (!B.has(k)) out.push({ type: "removed", key: k, name: e.name, category: e.category, fields: [] });
  for (const [k, x] of A) {
    const y = B.get(k);
    if (!y) continue;
    const fields: Change["fields"] = [];
    if (x.name !== y.name) fields.push({ field: "名稱", from: x.name, to: y.name });
    if (x.doc.trim() !== y.doc.trim()) fields.push({ field: "內容", from: x.doc, to: y.doc });
    for (const n of new Set([...Object.keys(x.attrs), ...Object.keys(y.attrs)])) {
      if ((x.attrs[n] ?? "") !== (y.attrs[n] ?? "")) fields.push({ field: n, from: x.attrs[n] ?? "", to: y.attrs[n] ?? "" });
    }
    const rx = relsOf(a, x), ry = relsOf(b, y);
    if (rx !== ry) fields.push({ field: "關係", from: rx, to: ry });
    if (fields.length) out.push({ type: "changed", key: k, name: y.name, category: y.category, fields });
  }
  return out.sort((p, q) => p.type.localeCompare(q.type) || p.key.localeCompare(q.key));
}

export async function compare(id: string, from: string, to: string): Promise<{ from: string; to: string; changes: Change[] }> {
  const dir = dirOf(id);
  await readProject(id);
  const [a, b] = [await resolve(dir, from), await resolve(dir, to)];
  const [x, y] = [await analyzeAt(dir, a), await analyzeAt(dir, b)];
  if (!x.ok || !y.ok) throw new UserError("其中一個版本的模型無法解析，不能比較。");
  return { from, to, changes: diffElements(x, y) };
}
