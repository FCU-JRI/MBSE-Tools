// 版本：分支審查與合併（成員用自己的 Claude 在分支上修改後送審）、基線比較。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./engine.ts";
import type { Analysis, Source } from "./engine.ts";
import type { Element } from "./extract.ts";
import os from "node:os";
import { upgradeText } from "./upgrade.ts";
import { embeddable, embedStakeholders, sameRelations } from "./modernize.ts";
import { analyzeProject, commit, dirOf, git, gitRaw, listFiles, listShared, lock, onPushRejected, parseRef, pushLater, readProject, readShared, refOf, refOfDir, repoConfig, sources, UserError } from "./projects.ts";

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
  const list: Source[] = [["JRI.sysml", await fs.readFile(LIBRARY, "utf8")]];
  for (const f of shared) list.push([f, await readShared(f)]);
  // 舊版本可能還是舊寫法，先在記憶體裡轉換才解析得了（不動到版本紀錄）
  for (const n of names) list.push([path.posix.basename(n), upgradeText(await git(dir, "show", `${sha}:${n}`) + "\n")]);
  return analyze(list, shared);
}

export interface BranchInfo { name: string; remote: boolean; ahead: number; behind: number; author: string; date: string; subject: string; ok: boolean; errors: number; firstError: string }

const fetched = new Map<string, number>();
/** 向 GitHub 抓一次要一秒左右，一分鐘內不重抓。 */
async function fetchOnce(dir: string): Promise<void> {
  if (Date.now() - (fetched.get(dir) ?? 0) <= 60_000 || !(await git(dir, "remote", "get-url", "origin").catch(() => ""))) return;
  fetched.set(dir, Date.now());
  await git(dir, "fetch", "--prune", "origin").catch(() => "");
}

/** 不論從 main 還是從分支的畫面呼叫，列的都是整個專案的分支。 */
export async function listBranches(ref: string): Promise<BranchInfo[]> {
  const { id } = parseRef(ref);
  const dir = dirOf(id);
  await readProject(id);
  await fetchOnce(dir);
  // 在網頁上開過的分支有本機的一份；成員之後推到 GitHub 的新提交先接上來，列出來的才是最新的
  const names = (await git(dir, "for-each-ref", "--format=%(refname:short)", "refs/heads")).split("\n").filter((n) => n && n !== "main");
  for (const n of names) await syncBranch(id, n).catch(() => "");
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

export async function branchDiff(ref: string, name: string): Promise<{ diff: string; changes: Change[] }> {
  const dir = dirOf(parseRef(ref).id);
  const sha = await branchRef(dir, name);
  const base = await git(dir, "merge-base", "main", sha);
  const diff = await git(dir, "diff", "--no-color", `${base}..${sha}`, "--", "model");
  return { diff: diff.slice(0, 200_000), changes: diffElements(await analyzeAt(dir, base), await analyzeAt(dir, sha)) };
}

// ───────── 合併 ─────────
const who = (author: string) => ["-c", `user.name=${author || "JRI MBSE"}`, "-c", "user.email=mbse@jri.local"];
const exists = (p: string) => fs.stat(p).then(() => true, () => false);
const isAncestor = (dir: string, a: string, b: string) => git(dir, "merge-base", "--is-ancestor", a, b).then(() => true, () => false);

// 工具自己維護的資料檔是 JSON。兩邊都改過（例如各自拖過圖）時 git 會當成文字衝突，這裡改成逐欄位合併。
const DATA_FILES = new Map([["layout.json", 1], ["diagrams.json", 1], ["pm.json", 1], ["sim.json", 1], ["project.json", 2]]);
// 工具放進儲存庫的副本（元模型庫、分析方法），每次讀專案都會更新成工具內的版本，衝突時留哪一邊都一樣
const TOOL_COPY = /^(lib|\.claude)\//;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyed = (v: unknown): v is { id: string }[] => Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === "string");

/**
 * JSON 的三方合併：只有一邊改過的欄位採用改過的那邊；物件逐欄位、帶 id 的清單逐項目往下比。
 * 兩邊把同一個值改成不同內容時依 prefer 決定。回傳 undefined 表示這個欄位被刪掉了。
 */
export function merge3(base: unknown, ours: unknown, theirs: unknown, prefer: "ours" | "theirs"): unknown {
  if (same(ours, theirs) || same(theirs, base)) return ours;
  if (same(ours, base)) return theirs;
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const v = merge3(b[k], ours[k], theirs[k], prefer);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (keyed(ours) && keyed(theirs)) {
    const by = (list: { id: string }[]) => new Map(list.map((x) => [x.id, x]));
    const [b, o, t] = [by(keyed(base) ? base : []), by(ours), by(theirs)];
    const out: unknown[] = [];
    for (const k of new Set([...o.keys(), ...t.keys()])) {
      const v = merge3(b.get(k), o.get(k), t.get(k), prefer);
      if (v !== undefined) out.push(v);
    }
    return out;
  }
  return prefer === "ours" ? ours : theirs;
}

// 模型檔的衝突（F-34）。git 只要兩邊改到相鄰的幾行就算衝突，其中一種其實不需要人判斷：
// 一邊只刪了東西，而另一邊把同樣的東西也刪了、另外還多改了一些。這時「多改的那一邊」已經包含兩邊的修改。
const MODEL_FILE = /^model\/[^/]+\.sysml$/;
const HUNK = /^<{7} [^\n]*\n([\s\S]*?)^\|{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7} [^\n]*\n/gm;
const tally = (list: string[]) => { const m = new Map<string, number>(); for (const l of list) m.set(l, (m.get(l) ?? 0) + 1); return m; };
/** 兩行文字有多像（0 到 1）：相鄰兩個字的組合有多少是共有的。 */
function alike(a: string, b: string): number {
  const grams = (s: string) => { const t = s.trim(); return tally(Array.from({ length: Math.max(t.length - 1, 0) }, (_, i) => t.slice(i, i + 2))); };
  const [x, y] = [grams(a), grams(b)];
  let both = 0, total = 0;
  for (const [g, n] of x) { both += Math.min(n, y.get(g) ?? 0); total += n; }
  for (const n of y.values()) total += n;
  return total ? (2 * both) / total : 0;
}

/**
 * 判斷一段衝突能不能自動解決。base 是兩邊共同的上一版，回傳合併後的內容；需要人判斷時回傳 null。
 * 條件：x 只刪了幾行（沒有新增或修改），這幾行 y 也都刪了；而且 y 新寫的內容不是在改寫 x 刪掉的那幾行
 * （一邊刪掉、另一邊修改同一行，是真的意見不同，要留給人決定）。成立時採用 y。
 */
export function resolveHunk(base: string[], ours: string[], theirs: string[]): string[] | null {
  const cb = tally(base);
  const covers = (x: string[], y: string[]): boolean => {
    let i = 0;
    for (const l of base) if (i < x.length && x[i] === l) i++;
    if (i !== x.length) return false; // x 有新增或改寫
    const [cx, cy] = [tally(x), tally(y)];
    const gone = (c: Map<string, number>, l: string) => Math.max(0, (cb.get(l) ?? 0) - (c.get(l) ?? 0));
    const byX = [...cb.keys()].filter((l) => gone(cx, l) > 0);
    if (byX.some((l) => gone(cx, l) > gone(cy, l))) return false; // x 刪的有些 y 還留著
    const onlyY = [...cb.keys()].filter((l) => gone(cy, l) > gone(cx, l));
    const best = (line: string, among: string[]) => among.reduce((m, l) => Math.max(m, alike(line, l)), 0);
    for (const [line, n] of cy) {
      if (n <= (cb.get(line) ?? 0)) continue; // 不是 y 新寫的
      const s = best(line, byX);
      if (s >= 0.6 && s > best(line, onlyY)) return false; // 看起來是在改寫 x 刪掉的那一行
    }
    return true;
  };
  if (covers(ours, theirs)) return theirs;
  if (covers(theirs, ours)) return ours;
  return null;
}

/** 解決一個檔案裡的所有衝突段落（要用 diff3 樣式，才有共同的上一版）。只要有一段需要人判斷就回傳 null。 */
export function resolveConflicts(text: string): { text: string; resolved: number } | null {
  const lines = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));
  let resolved = 0, stuck = false;
  const out = text.replace(HUNK, (all: string, ours: string, base: string, theirs: string) => {
    const r = resolveHunk(lines(base), lines(ours), lines(theirs));
    if (!r) { stuck = true; return all; }
    resolved++;
    return r.map((l) => l + "\n").join("");
  });
  return stuck || resolved === 0 || /^(<{7}|>{7}) /m.test(out) ? null : { text: out, resolved };
}

/**
 * 把 sha 合併進 ref 的工作目錄。合併後先確認模型能解析，不能就取消，原本的內容不會被弄壞。
 * 模型檔的衝突只自動解決 resolveHunk 認得的那一種，其餘不猜，取消並回報 conflict 的說明；
 * prefer 是資料檔兩邊改到同一欄位時採用的那一邊。
 */
/** 三方合併一個檔案的文字。合得起來回傳結果；有衝突時回傳帶 diff3 樣式衝突標記的文字。 */
async function mergeFile(ours: string, base: string, theirs: string): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jri-merge-"));
  try {
    const files = await Promise.all([["ours", ours], ["base", base], ["theirs", theirs]].map(async ([n, text]) => { const f = path.join(tmp, n); await fs.writeFile(f, text, "utf8"); return f; }));
    // 有衝突時 git merge-file 的結束碼是衝突的段數，內容照樣印在標準輸出
    return await gitRaw(tmp, ["merge-file", "-p", "--diff3", "-L", "HEAD", "-L", "base", "-L", "incoming", ...files])
      .catch((e: { stdout?: string; code?: number }) => { if (typeof e.stdout === "string" && typeof e.code === "number" && e.code > 0 && e.code < 127) return e.stdout; throw e; });
  } finally { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

/**
 * 要合併進來的版本如果還是舊寫法，先替它接一筆「轉成標準庫寫法」的提交，再合併那一筆。
 * 這邊已經轉換過、對方還沒，直接合併的話兩邊改到同一批關係，幾乎一定衝突；兩邊都轉換過，相同的修改就會自動合在一起。
 * 只在物件庫裡多一筆提交，不動對方的分支，也不動任何工作目錄。
 */
async function upgradedCommit(dir: string, sha: string): Promise<string> {
  const changed = [...(await modernAt(dir, sha))].filter(([, [before, after]]) => before !== after).map(([n, [, after]]): [string, string] => [n, after]);
  if (changed.length === 0) return sha;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jri-upgrade-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
    await gitRaw(dir, ["read-tree", sha], env);
    for (const [n, text] of changed) {
      const file = path.join(tmp, "blob");
      await fs.writeFile(file, text, "utf8");
      const blob = (await gitRaw(dir, ["hash-object", "-w", "--no-filters", file])).trim();
      await gitRaw(dir, ["update-index", "--cacheinfo", `100644,${blob},${n}`], env);
    }
    const tree = (await gitRaw(dir, ["write-tree"], env)).trim();
    return (await gitRaw(dir, [...who("JRI MBSE"), "commit-tree", tree, "-p", sha, "-m", UPGRADE_MESSAGE])).trim();
  } finally { await fs.rm(tmp, { recursive: true, force: true }).catch(() => {}); }
}

// ───────── 把模型轉成目前的寫法（F-36、F-37）─────────
const UPGRADE_MESSAGE = "模型改用 SysML v2 標準庫與內建的寫法";

/**
 * 依解析結果把利害關係人與參與者改成內建的 stakeholder／actor（F-37）。fixed：元模型庫與共用元件庫；texts：專案的模型檔。
 * 改完重新解析，只要元素或關係和原本有任何不同就放棄，回傳原本的文字。
 */
async function embedChecked(fixed: Source[], texts: Map<string, string>, shared: string[]): Promise<Map<string, string>> {
  const all = (m: Map<string, string>): Source[] => [...fixed, ...[...m].map(([n, t]): Source => [n, t])];
  const a = await analyze(all(texts), shared);
  if (!a.ok || embeddable(a, texts.keys()).length === 0) return texts;
  let changed: Map<string, string>;
  try { changed = embedStakeholders(texts, a); } catch { return texts; }
  const next = new Map([...texts, ...changed]);
  const b = await analyze(all(next), shared);
  return b.ok && sameRelations(a, b) ? next : texts;
}

const fixedSources = async (shared: string[]): Promise<Source[]> => {
  const list: Source[] = [["JRI.sysml", await fs.readFile(LIBRARY, "utf8")]];
  for (const f of shared) list.push([f, await readShared(f)]);
  return list;
};

/** 某個版本的模型檔轉成目前寫法後的內容：路徑 → [原本的內容, 轉換後的內容]。只在記憶體裡算，不動版本紀錄。 */
async function modernAt(dir: string, sha: string): Promise<Map<string, [before: string, after: string]>> {
  const names = (await git(dir, "-c", "core.quotepath=false", "ls-tree", "--name-only", sha, "model/")).split("\n").map((n) => n.trim()).filter((n) => MODEL_FILE.test(n));
  const shared = await listShared();
  const raw = new Map<string, string>();
  for (const n of names) raw.set(n, await gitRaw(dir, ["show", `${sha}:${n}`]));
  const texts = new Map(names.map((n) => [path.posix.basename(n), upgradeText(raw.get(n) as string)]));
  const next = await embedChecked(await fixedSources(shared), texts, shared);
  return new Map(names.map((n) => [n, [raw.get(n) as string, next.get(path.posix.basename(n)) as string]]));
}

/** 把工作目錄裡的模型檔轉成目前的寫法並寫回。模型檔因此有未提交的變更時回傳 true。呼叫的人要自己排隊（lock）。 */
async function modernizeWorktree(ref: string): Promise<boolean> {
  const dir = dirOf(ref);
  const list = await sources(ref); // 文字層的舊寫法（F-36）在這裡轉換並寫回
  const shared = await listShared();
  const own = new Set(await listFiles(ref));
  const texts = new Map(list.filter(([n]) => own.has(n)).map(([n, t]) => [n, t]));
  const next = await embedChecked(list.filter(([n]) => !own.has(n)), texts, shared);
  for (const [n, t] of next) if (t !== texts.get(n)) await fs.writeFile(path.join(dir, "model", n), t, "utf8");
  return !!(await git(dir, "status", "--porcelain", "--", "model"));
}

async function mergeInto(ref: string, sha: string, author: string, message: string, prefer: "ours" | "theirs", conflict: string): Promise<void> {
  const dir = dirOf(ref);
  await repoConfig(dir);
  await modernizeWorktree(ref).catch(() => false); // 這一邊若還是舊寫法，先轉換（寫回檔案），下面會一起提交
  sha = await upgradedCommit(dir, sha);
  if (await git(dir, "status", "--porcelain")) await commit(dir, author, "合併前儲存未提交的變更");
  const abort = () => git(dir, "merge", "--abort").catch(() => "");
  const auto: string[] = [];
  let modernBase: Map<string, [string, string]> | undefined;
  try {
    await git(dir, ...who(author), "-c", "merge.conflictStyle=diff3", "merge", "--no-ff", "--no-commit", sha);
  } catch {
    const files = (await git(dir, "-c", "core.quotepath=false", "diff", "--name-only", "--diff-filter=U").catch(() => "")).split("\n").filter(Boolean);
    const stop = async (f?: string) => { await abort(); throw new UserError(f ? `${conflict}（衝突的檔案：${f}）` : conflict); };
    if (files.length === 0) await stop();
    for (const f of files) {
      if (MODEL_FILE.test(f)) {
        // 三邊都先轉成目前的寫法再合併一次：共同的上一版若還是舊寫法，兩邊做的相同轉換會被當成各自的修改而互相衝突（F-36、F-37）
        const side = (n: number) => gitRaw(dir, ["show", `:${n}:${f}`]).then(upgradeText, () => null);
        modernBase ??= await git(dir, "merge-base", "HEAD", "MERGE_HEAD").then((b) => modernAt(dir, b.split("\n")[0])).catch(() => new Map());
        const [base, ours, theirs] = [modernBase.get(f)?.[1] ?? await side(1), await side(2), await side(3)];
        const merged = base === null || ours === null || theirs === null ? null : await mergeFile(ours, base, theirs);
        const r = merged === null ? null : /^<{7} /m.test(merged) ? resolveConflicts(merged) : { text: merged, resolved: 0 };
        if (!r) { await stop(f); continue; }
        await fs.writeFile(path.join(dir, f), r.text, "utf8");
        if (r.resolved) auto.push(`${path.posix.basename(f)} ${r.resolved} 段`);
      } else if (!DATA_FILES.has(f) && !TOOL_COPY.test(f)) await stop(f);
      else if (DATA_FILES.has(f)) {
        const stage = async (n: number): Promise<unknown> => { try { return JSON.parse(await git(dir, "show", `:${n}:${f}`)); } catch { return undefined; } };
        const merged = merge3(await stage(1), await stage(2), await stage(3), prefer);
        if (merged === undefined) { await git(dir, "rm", "-q", "-f", "--", f); continue; }
        await fs.writeFile(path.join(dir, f), JSON.stringify(merged, null, DATA_FILES.get(f)) + "\n", "utf8");
      } else await git(dir, "checkout", "--ours", "--", f);
      await git(dir, "add", "--", f);
    }
  }
  const a = await analyzeProject(ref);
  if (!a.ok) {
    await abort();
    const e = a.diagnostics.find((d) => d.severity === "error");
    throw new UserError(`合併後的模型有錯誤，已取消合併：${e ? `${e.file} 第 ${e.line} 行 ${e.message}` : ""}`);
  }
  // 自動解決的衝突寫進提交訊息，之後查得到
  await git(dir, ...who(author), "commit", "-m", auto.length ? `${message}\n\n自動解決的模型衝突（一邊的修改已包含另一邊）：${auto.join("、")}` : message);
  pushLater(dir);
}

/** 把分支合併進 main。 */
export async function mergeBranch(id: string, name: string, author: string): Promise<{ commit: string }> {
  if (parseRef(id).branch) throw new UserError("合併分支只能在 main 進行。");
  const dir = dirOf(id);
  await branchRef(dir, name);
  // 分支在網頁上開著時，還沒提交的變更（例如剛排好的圖）先存進分支，才會一起合併進來
  const opened = refOf(id, name);
  if (await exists(path.join(dirOf(opened), ".git"))) {
    const release = await lock(opened);
    try { if (await git(dirOf(opened), "status", "--porcelain")) await commit(dirOf(opened), author, "儲存圖的版面"); } finally { release(); }
  }
  await mergeInto(id, await branchRef(dir, name), author, `合併分支 ${name}`, "theirs", "這個分支和目前的模型有衝突，無法自動合併。請分支作者先把 main 合併進自己的分支並解決衝突。");
  return { commit: await git(dir, "rev-parse", "--short", "HEAD") };
}

// ───────── 開啟分支（F-33）─────────
// 分支的內容放在它自己的工作目錄，網頁上看到、改到的都是那一份；每次修改提交到該分支並推送。
const warnings = new Map<string, string>();

/**
 * 讓本機的分支跟上 GitHub 上同名的分支；branch 為 null 表示 main（有人在 GitHub 上合併或直接推送時，這裡也要接上，
 * 否則之後每次推送都會被拒絕）。回傳空字串，或無法接上時給使用者看的說明。
 */
async function syncBranch(id: string, branch: string | null): Promise<string> {
  const main = dirOf(id), ref = refOf(id, branch), dir = dirOf(ref), name = branch ?? "main";
  const rev = (r: string) => git(main, "rev-parse", "--verify", "--quiet", r).catch(() => "");
  const [local, remote] = [await rev(`refs/heads/${name}`), await rev(`refs/remotes/origin/${name}`)];
  if (!local || !remote || local === remote || await isAncestor(main, remote, local)) return "";
  if (!(await exists(path.join(dir, ".git")))) {
    // 沒有開著的分支只要移動指標；兩邊各有修改的留到開啟時再合併
    if (await isAncestor(main, local, remote) && await git(main, "rev-parse", "--abbrev-ref", "HEAD") !== name) await git(main, "update-ref", `refs/heads/${name}`, remote, local);
    return "";
  }
  // main 是大家共用的：GitHub 上的模型不能解析就不接，免得所有人的畫面一起壞掉
  if (!branch && !(await analyzeAt(main, remote).catch(() => null))?.ok) return "GitHub 上的 main 模型無法解析，網頁沒有接上這些修改，之後的修改也推不上去。請在 GitHub 上修正，或請管理員處理。";
  const release = await lock(ref);
  try {
    if (await git(dir, "status", "--porcelain")) await commit(dir, "JRI MBSE", "儲存圖的版面");
    if (await isAncestor(dir, "HEAD", remote)) { await git(dir, "merge", "--ff-only", remote); return ""; }
    await mergeInto(ref, remote, "JRI MBSE", `合併 GitHub 上的 ${name}`, "ours", "衝突");
    return "";
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    return `${branch ? "這個分支" : "main "}在網頁上和 GitHub 上各有不同的修改，無法自動合併。網頁上的修改暫時推不上 GitHub，請${branch ? "分支作者在自己的電腦上" : "管理員"}處理。`;
  } finally { release(); }
}

// 推送被拒絕（GitHub 上有這裡沒有的提交）：馬上抓下來接上，接得上就會再推一次
onPushRejected((dir) => {
  void (async () => {
    const ref = refOfDir(dir);
    if (!ref) return;
    const { id, branch } = parseRef(ref);
    fetched.delete(dirOf(id));
    await fetchOnce(dirOf(id));
    warnings.set(dir, await syncBranch(id, branch));
  })().catch(() => undefined);
});

/**
 * 模型檔若還是舊寫法，轉成目前的寫法並單獨提交一筆（F-36、F-37）。
 * 不和使用者的下一次儲存混在一起，版本紀錄才看得出這一筆是工具做的轉換。
 */
async function commitUpgrade(ref: string): Promise<void> {
  const dir = dirOf(ref), model = path.join(dir, "model");
  const names = (await fs.readdir(model).catch(() => [] as string[])).filter((n) => n.endsWith(".sysml"));
  const legacy = async (n: string) => { const t = await fs.readFile(path.join(model, n), "utf8").catch(() => ""); return upgradeText(t) !== t; };
  // 先不排隊看一眼需不需要轉換；大多數時候不需要，不必為此擋住別人的修改
  if (!(await Promise.all(names.map(legacy))).some(Boolean)) {
    const a = await analyzeProject(ref);
    if (!a.ok || embeddable(a, await listFiles(ref)).length === 0) return;
  }
  const release = await lock(ref);
  try {
    if (!(await modernizeWorktree(ref))) return;
    await git(dir, "add", "--", "model");
    if (await git(dir, "diff", "--cached", "--name-only", "--", "model")) {
      await git(dir, ...who("JRI MBSE"), "commit", "-m", UPGRADE_MESSAGE, "--", "model");
      pushLater(dir);
    }
  } finally { release(); }
}

/**
 * 開啟專案或分支。分支第一次開啟時建立它的工作目錄；sync 為真（載入整個專案）時，main 和分支都順便跟上 GitHub 上的新提交。
 */
export async function openBranch(ref: string, sync: boolean): Promise<void> {
  const { id, branch } = parseRef(ref);
  const main = dirOf(id), dir = dirOf(ref);
  if (!branch && !sync) return;
  await readProject(id);
  const has = await exists(path.join(dir, ".git"));
  if (has && !sync) return;
  await fetchOnce(main);
  if (!has && branch) {
    const release = await lock(ref);
    try {
      if (!(await exists(path.join(dir, ".git")))) {
        const rev = (r: string) => git(main, "rev-parse", "--verify", "--quiet", r).catch(() => "");
        const from = await rev(`refs/heads/${branch}`) ? [dir, branch] : await rev(`refs/remotes/origin/${branch}`) ? ["-b", branch, dir, `origin/${branch}`] : null;
        if (!from) throw new UserError(`找不到分支 ${branch}。`);
        await fs.mkdir(path.dirname(dir), { recursive: true });
        await git(main, "worktree", "prune").catch(() => "");
        await git(main, "worktree", "add", ...from).catch(() => { throw new UserError(`無法開啟分支 ${branch}：它可能正在伺服器的其他位置使用中。`); });
      }
    } finally { release(); }
  }
  await commitUpgrade(ref).catch(() => undefined); // 轉換失敗不擋開啟，模型若因此無法解析，畫面上會顯示錯誤
  warnings.set(dir, await syncBranch(id, branch));
}

/** 上次和 GitHub 同步時留下的說明（接不上時才有）。 */
export const syncWarning = (ref: string): string => warnings.get(dirOf(ref)) ?? "";

export interface BranchState { name: string; ahead: number; behind: number; warning: string }
/** 分支相對於 main 的位置；main 回傳 null。 */
export async function branchState(ref: string): Promise<BranchState | null> {
  const { branch } = parseRef(ref);
  if (!branch) return null;
  const dir = dirOf(ref);
  const [behind, ahead] = (await git(dir, "rev-list", "--left-right", "--count", "main...HEAD")).split(/\s+/).map(Number);
  return { name: branch, ahead, behind, warning: warnings.get(dir) ?? "" };
}

/** 把 main 的更新合併進分支，分支才不會離 main 越來越遠，之後合併回 main 也比較不會衝突。 */
export async function mergeMain(ref: string, author: string): Promise<void> {
  if (!parseRef(ref).branch) throw new UserError("這個功能只用在分支上。");
  const dir = dirOf(ref);
  const sha = await git(dir, "rev-parse", "main");
  if (await isAncestor(dir, sha, "HEAD")) throw new UserError("這個分支已經包含 main 的最新內容。");
  await mergeInto(ref, sha, author, "合併 main 的更新", "ours", "main 的更新和這個分支的修改有衝突，無法自動合併。請分支作者在自己的電腦上把 main 合併進來並解決衝突。");
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
