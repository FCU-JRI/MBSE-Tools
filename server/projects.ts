// 專案儲存：每個專案是一個獨立的 git 儲存庫，模型為 SysML v2 文字檔。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./engine.ts";
import type { Analysis, Source } from "./engine.ts";
import { GATES } from "./gates.ts";
import { upgradeText } from "./upgrade.ts";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME_DIR = path.resolve(process.env.JRI_HOME ?? path.join(ROOT, "data"));
export const DATA_DIR = path.join(HOME_DIR, "projects");
const TEMPLATE_DIR = path.join(ROOT, "templates");
const LIBRARY = path.join(ROOT, "library", "JRI.sysml");
/** CoSMA 基礎庫（原封不動，F-82）與 JRI 附加庫（F-87）。只有 CoSMA 專案載入 */
const COSMA_DIR = path.join(ROOT, "library", "cosma");
const ADDON_FILE = path.join(ROOT, "library", "addon", "JRIAddonPackage.sysml");
const COSMA_FILES = ["CoSMAPackage.sysml", "CoSMAQuantitiesAndUnitsPackage.sysml", "CoSMAViewsPackage.sysml"];

export interface Signoff {
  gate: string;
  subsystem: string | null;
  decision: "APPROVE" | "DENY";
  by: string;
  role: string;
  comment: string;
  at: string;
  commit: string;
}

export interface Project {
  id: string;
  name: string;
  kind: "annual" | "small";
  createdAt: string;
  gates: string[];
  /** cosma CoSMA 範本（F-86，預設）；舊版 JRI 類別：blank 空白、sample 範本（附示範內容）、guided 流程範本（逐步引導，不可跳步） */
  template?: "blank" | "sample" | "guided" | "cosma";
  highPower?: boolean; // 高功率（H 級以上）：TRR／FRR 只有指導老師能核可
  manual: Record<string, boolean>;
  signoffs: Signoff[];
  /** 唯讀（F-72）：任何身分都不能改這個專案的內容 */
  readOnly?: boolean;
  /** 原封不動（F-72）：載入只讀檔，不加入 JRI.sysml 與共用元件庫，不轉換舊寫法，不寫入任何檔案 */
  pristine?: boolean;
  /** 參考專案的來源（F-73） */
  reference?: { name: string; source: string; commit: string; license: string };
}

export class UserError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const FILE = /^[A-Za-z0-9_\-一-鿿]+\.sysml$/;
const FOLDER = /^[A-Za-z0-9_\-一-鿿]+$/;
const MAX_DEPTH = 8;

/**
 * 模型檔的相對路徑（F-70）：`model/` 底下，可以有子資料夾，一律用正斜線。
 * 每一段只收英數、底線、連字號與中文字，所以 `..`、絕對路徑、反斜線、以點開頭的名稱都過不了。
 */
export function isModelPath(file: string): boolean {
  const parts = file.split("/");
  return parts.length <= MAX_DEPTH && FILE.test(parts[parts.length - 1]) && parts.slice(0, -1).every((p) => FOLDER.test(p));
}

/** 模型檔在磁碟上的位置。路徑上有符號連結、因而指到 `model/` 外面的一律拒絕。 */
async function modelFile(id: string, file: string): Promise<string> {
  if (!isModelPath(file)) throw new UserError("檔名不合法。");
  const model = path.join(dirOf(id), "model");
  const full = path.join(model, ...file.split("/"));
  // 檔案還不存在（新檔）時，檢查已經存在的那一段上層
  let probe = full;
  for (;;) {
    const real = await fs.realpath(probe).catch(() => null);
    if (real !== null) {
      const base = await fs.realpath(model).catch(() => null);
      const rest = path.relative(probe, full);
      const target = rest ? path.join(real, rest) : real;
      if (base === null || target !== path.join(base, ...file.split("/"))) throw new UserError("檔名不合法。");
      return full;
    }
    const up = path.dirname(probe);
    if (up === probe) throw new UserError("檔名不合法。");
    probe = up;
  }
}

const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,120}$/;
const BRANCH_DIR = path.join(HOME_DIR, "branches");

/**
 * 專案參照（F-33）：`代號` 是 main，`代號@分支` 是某個分支。分支名稱裡的斜線在參照中寫成 ~
 * （git 不允許分支名稱含 ~，不會混淆），參照才能直接放進網址路徑。
 * 每個分支有自己的工作目錄（git worktree），所以讀寫專案的功能不用另外寫一套就能用在分支上。
 */
export function parseRef(ref: string): { id: string; branch: string | null } {
  const at = ref.indexOf("@");
  const id = at < 0 ? ref : ref.slice(0, at);
  if (!ID.test(id)) throw new UserError("專案代號只能用小寫英數與連字號。");
  if (at < 0) return { id, branch: null };
  const raw = ref.slice(at + 1);
  const branch = raw.replaceAll("~", "/");
  if (!BRANCH.test(raw) || branch === "main" || /\.\.|\/\/|\/$|\.lock$|\/\./.test(branch)) throw new UserError("分支名稱不合法。");
  return { id, branch };
}
export const refOf = (id: string, branch: string | null): string => (branch ? `${id}@${branch.replaceAll("/", "~")}` : id);

export function dirOf(ref: string): string {
  const { id, branch } = parseRef(ref);
  return branch ? path.join(BRANCH_DIR, id, branch.replaceAll("/", "~")) : path.join(DATA_DIR, id);
}
/** 簽核、封存、儲存庫設定是整個專案的事，不能在分支上做。 */
function mainOnly(ref: string, what: string): string {
  if (parseRef(ref).branch) throw new UserError(`${what}只能在 main 進行。`);
  return ref;
}

// 同一個專案（或同一個分支）的修改一次只做一個。每個修改都是「讀檔 → 改 → 寫回 → 提交」，
// 兩個人同時送出時若不排隊，後寫的會蓋掉先寫的，Git 也會因為鎖定而失敗。
const queues = new Map<string, Promise<void>>();
/** 排隊：等前面的做完才輪到自己。回傳的函式用來放行下一個，一定要呼叫。 */
export function lock(ref: string): Promise<() => void> {
  const prev = queues.get(ref) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  const tail = prev.then(() => mine);
  queues.set(ref, tail);
  void tail.then(() => { if (queues.get(ref) === tail) queues.delete(ref); });
  return prev.then(() => release);
}

/** 和 git() 相同，但原樣回傳輸出（不去頭尾空白），用來讀檔案內容。 */
export async function gitRaw(dir: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
  return stdout;
}

export async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return stdout.trim();
}

// ───────── 推送到 GitHub：每次提交後在背景推送，不擋住使用者 ─────────
export interface SyncState { remote: string; lastPushAt: string | null; error: string | null; pushing: boolean }
const sync = new Map<string, SyncState>();
const pending = new Map<string, boolean>();

export async function syncState(id: string): Promise<SyncState> {
  const dir = dirOf(id);
  const remote = await git(dir, "remote", "get-url", "origin").catch(() => "");
  const cur = sync.get(dir) ?? { remote, lastPushAt: null, error: null, pushing: false };
  cur.remote = remote;
  sync.set(dir, cur);
  return cur;
}

// 推送因為 GitHub 上有這裡沒有的提交而被拒絕時要做的事（由 versions.ts 登記：接上那些提交再推一次）
let rejected: ((dir: string) => void) | null = null;
export function onPushRejected(fn: (dir: string) => void): void { rejected = fn; }
/** 從工作目錄反推專案參照；不是專案或分支的資料夾回傳 null。 */
export function refOfDir(dir: string): string | null {
  const p = path.relative(DATA_DIR, dir).split(path.sep);
  if (p.length === 1 && ID.test(p[0])) return p[0];
  const b = path.relative(BRANCH_DIR, dir).split(path.sep);
  return b.length === 2 && ID.test(b[0]) && BRANCH.test(b[1]) ? `${b[0]}@${b[1]}` : null;
}

export function pushLater(dir: string): void {
  if (pending.get(dir)) return;
  pending.set(dir, true);
  setTimeout(async () => {
    pending.set(dir, false);
    const remote = await git(dir, "remote", "get-url", "origin").catch(() => "");
    if (!remote) return;
    const st = sync.get(dir) ?? { remote, lastPushAt: null, error: null, pushing: false };
    st.remote = remote; st.pushing = true; sync.set(dir, st);
    try {
      // 分支的工作目錄推自己的分支；基線標籤只跟著 main 推
      const head = await git(dir, "rev-parse", "--abbrev-ref", "HEAD").catch(() => "");
      const branch = head && head !== "HEAD" ? head : "main";
      await run("git", ["push", "--follow-tags", "origin", branch], { cwd: dir, windowsHide: true, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      if (branch === "main") await run("git", ["push", "origin", "--tags"], { cwd: dir, windowsHide: true, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      st.lastPushAt = new Date().toISOString(); st.error = null;
    } catch (e) {
      const text = String((e as { stderr?: string }).stderr ?? (e as Error).message);
      st.error = text.split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300);
      if (/non-fast-forward|fetch first/.test(text)) rejected?.(dir);
    } finally { st.pushing = false; }
  }, 1500);
}

const REMOTE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;
export async function setRemote(id: string, url: string): Promise<SyncState> {
  const dir = dirOf(mainOnly(id, "儲存庫設定"));
  await readProject(id);
  const u = url.trim();
  if (u && !REMOTE.test(u)) throw new UserError("儲存庫網址必須是 https://github.com/組織/名稱 的形式。");
  const has = await git(dir, "remote", "get-url", "origin").catch(() => "");
  if (!u) { if (has) await git(dir, "remote", "remove", "origin"); }
  else if (has) await git(dir, "remote", "set-url", "origin", u);
  else await git(dir, "remote", "add", "origin", u);
  sync.delete(dir);
  if (u) pushLater(dir);
  return syncState(id);
}

// ───────── 自動建立 GitHub 儲存庫（F-23）─────────
// 用伺服器帳號已登入的 GitHub CLI（gh auth login）建立。憑證只存在 gh 自己的設定裡，工具不經手。
const GH = process.env.JRI_GH || "gh";
export const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
export interface AutoRepo { enabled: boolean; owner: string; visibility: "public" | "private" }
const errText = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message).split("\n").map((s) => s.trim()).filter(Boolean).slice(-2).join(" ").slice(0, 300);

/** 在 GitHub 建立 擁有者/專案代號 並設為推送目標。失敗不丟例外，錯誤記在同步狀態，「版本」頁會顯示。 */
export async function createRepo(id: string, description: string, opt: AutoRepo): Promise<SyncState> {
  const dir = dirOf(mainOnly(id, "儲存庫設定"));
  await readProject(id);
  try {
    if (!GITHUB_OWNER.test(opt.owner)) throw new Error("管理頁的 GitHub 擁有者名稱不合法。");
    if (await git(dir, "remote", "get-url", "origin").catch(() => "")) throw new Error("這個專案已經設定儲存庫。");
    const { stdout } = await run(GH, ["repo", "create", `${opt.owner}/${id}`, opt.visibility === "private" ? "--private" : "--public", "--description", description.slice(0, 200)],
      { windowsHide: true, timeout: 60_000, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } });
    const url = stdout.trim().split("\n").pop()?.trim() || `https://github.com/${opt.owner}/${id}`;
    return await setRemote(id, url);
  } catch (e) {
    const st = await syncState(id);
    st.error = `自動建立 GitHub 儲存庫失敗：${errText(e)}`;
    return st;
  }
}

export async function commit(dir: string, author: string, message: string): Promise<string> {
  await git(dir, "add", "-A");
  const status = await git(dir, "status", "--porcelain");
  if (status) {
    const name = author.trim() || "JRI MBSE";
    await git(dir, "-c", `user.name=${name}`, "-c", "user.email=mbse@jri.local", "commit", "-m", message);
    pushLater(dir);
  }
  return git(dir, "rev-parse", "--short", "HEAD");
}

/** 把分析方法（skill）放進專案儲存庫。成員用 Claude Code 開啟儲存庫時會自動載入，不需另外設定。 */
async function syncSkill(dir: string): Promise<void> {
  const src = await fs.readFile(path.join(TEMPLATE_DIR, "skill", "SKILL.md"), "utf8").catch(() => "");
  if (!src) return;
  const target = path.join(dir, ".claude", "skills", "jri-mbse", "SKILL.md");
  if ((await fs.readFile(target, "utf8").catch(() => "")) === src) return;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, src, "utf8");
}

/** 專案儲存庫一律不轉換換行字元：Windows 預設的 autocrlf 會在還原與合併時把檔案改成 CRLF，
 *  造成工作目錄被視為有變更，原始碼位置的計算也會跟著偏移。 */
export async function repoConfig(dir: string): Promise<void> {
  await git(dir, "config", "core.autocrlf", "false");
}

export async function listProjects(): Promise<Project[]> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const out: Project[] = [];
  for (const d of await fs.readdir(DATA_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    try {
      out.push(await readProject(d.name));
    } catch {
      // 不是專案資料夾就略過
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readProject(id: string): Promise<Project> {
  const raw = await fs.readFile(path.join(dirOf(id), "project.json"), "utf8").catch(() => {
    throw new UserError("找不到這個專案。");
  });
  return JSON.parse(raw) as Project;
}

async function writeProject(ref: string, p: Project): Promise<void> {
  await fs.writeFile(path.join(dirOf(ref), "project.json"), JSON.stringify(p, null, 2) + "\n", "utf8");
}

export async function createProject(input: { id: string; name: string; kind: "annual" | "small"; gates?: string[]; template?: string; author: string }): Promise<Project> {
  const template: Project["template"] = input.template === "blank" || input.template === "guided" || input.template === "cosma" ? input.template : "sample";
  const dir = dirOf(mainOnly(input.id, "建立專案"));
  if (!input.name.trim()) throw new UserError("請填專案名稱。");
  if (await fs.stat(dir).catch(() => null)) throw new UserError("這個專案代號已經被使用。");
  const all = GATES.map((g) => g.id);
  const gates = input.kind === "annual" ? all : all.filter((g) => (input.gates ?? []).includes(g));
  if (gates.length === 0) throw new UserError("小型專案至少要保留一個節點。");

  await fs.mkdir(path.join(dir, "model"), { recursive: true });
  await fs.mkdir(path.join(dir, "lib"), { recursive: true });
  if (template === "cosma") await fs.cp(path.join(TEMPLATE_DIR, "cosma"), path.join(dir, "model"), { recursive: true }); // 照 Apollo 的資料夾與套件（F-86）
  else await fs.copyFile(path.join(TEMPLATE_DIR, template === "sample" ? "sounding-rocket" : "blank", "model.sysml"), path.join(dir, "model", "model.sysml"));
  await syncSkill(dir);
  await fs.copyFile(LIBRARY, path.join(dir, "lib", "JRI.sysml"));
  await fs.copyFile(path.join(TEMPLATE_DIR, "CLAUDE.md"), path.join(dir, "CLAUDE.md")).catch(() => {});
  const project: Project = { id: input.id, name: input.name.trim(), kind: input.kind, template, createdAt: new Date().toISOString(), gates, manual: {}, signoffs: [] };
  await writeProject(input.id, project);
  await git(dir, "init", "-b", "main");
  await repoConfig(dir);
  await commit(dir, input.author, `建立專案：${project.name}`);
  return project;
}

/** 專案的模型檔，含子資料夾裡的（F-70），以相對於 `model/` 的路徑表示。符號連結與以點開頭的資料夾不列。 */
export async function listFiles(id: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
    for (const d of await fs.readdir(dir, { withFileTypes: true })) {
      const rel = prefix + d.name;
      if (d.isDirectory()) { if (depth < MAX_DEPTH && !d.name.startsWith(".")) await walk(path.join(dir, d.name), `${rel}/`, depth + 1); }
      else if (d.isFile() && d.name.endsWith(".sysml")) out.push(rel);
    }
  };
  await walk(path.join(dirOf(id), "model"), "", 1);
  // 元模型庫與共用元件庫的檔名保留給工具自己用
  return out.filter((n) => !SHARED_FILE.test(n) && n !== "JRI.sysml").sort();
}

export async function readFile(id: string, file: string): Promise<string> {
  return fs.readFile(await modelFile(id, file), "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT" || e.code === "EISDIR") throw new UserError(`找不到檔案 ${file}。`);
    throw e;
  });
}

const SHARED_DIR = path.join(HOME_DIR, "shared");
const SHARED_FILE = /^shared-[a-z0-9-]{1,40}\.sysml$/;

export async function listShared(): Promise<string[]> {
  const names = await fs.readdir(SHARED_DIR).catch(() => [] as string[]);
  return names.filter((n) => SHARED_FILE.test(n)).sort();
}
export async function readShared(file: string): Promise<string> {
  if (!SHARED_FILE.test(file)) throw new UserError("共用元件庫的檔名必須是 shared-名稱.sysml（小寫英數與連字號）。");
  return upgradeText(await fs.readFile(path.join(SHARED_DIR, file), "utf8").catch(() => ""));
}
/** 共用元件庫存檔前，連同元模型庫一起解析；有錯誤不寫入。 */
export async function saveShared(file: string, content: string): Promise<{ saved: boolean; analysis: Analysis }> {
  if (!SHARED_FILE.test(file)) throw new UserError("共用元件庫的檔名必須是 shared-名稱.sysml（小寫英數與連字號）。");
  const others: Source[] = [];
  for (const f of await listShared()) if (f !== file) others.push([f, await readShared(f)]);
  const analysis = await analyze([["JRI.sysml", await fs.readFile(LIBRARY, "utf8")], ...others, [file, upgradeText(content)]], [...others.map(([n]) => n), file]);
  if (!analysis.ok) return { saved: false, analysis };
  await fs.mkdir(SHARED_DIR, { recursive: true });
  await fs.writeFile(path.join(SHARED_DIR, file), upgradeText(content), "utf8");
  return { saved: true, analysis };
}

/**
 * CoSMA 基礎庫與附加庫，以共用元件庫的方式載入（F-82、F-87）。條件：模型檔提到 CoSMAPackage，而且模型自己沒有帶一份基礎庫
 * （例如原封不動的 Apollo 參考專案）。其他專案（包括 rtc-2027）回傳空的，解析結果完全不變。
 */
export async function frameworkSources(texts: readonly string[]): Promise<Source[]> {
  if (!texts.some((t) => /\bCoSMAPackage\b/.test(t)) || texts.some((t) => /\blibrary\s+package\s+CoSMAPackage\b/.test(t))) return [];
  const out: Source[] = [];
  for (const f of COSMA_FILES) out.push([`cosma:${f}`, await fs.readFile(path.join(COSMA_DIR, f), "utf8")]);
  out.push(["addon:JRIAddonPackage.sysml", await fs.readFile(ADDON_FILE, "utf8")]);
  return out;
}
/** 以共用元件庫方式載入的來源（專案內唯讀） */
export const isFrameworkSource = (name: string) => name.startsWith("cosma:") || name.startsWith("addon:");

export async function sources(id: string, override?: { file: string; content: string }): Promise<Source[]> {
  const dir = dirOf(id);
  const project = await readProject(id); // 專案不存在就到此為止，不要在下面替它建出空資料夾
  if (project.pristine) {
    // 原封不動的專案（F-72）：只讀模型檔，其餘什麼都不做
    const own = await listFiles(id);
    if (override && !own.includes(override.file)) own.push(override.file);
    return Promise.all(own.map(async (f): Promise<Source> => [f, override?.file === f ? override.content : await fs.readFile(path.join(dir, "model", f), "utf8")]));
  }
// 元模型庫以工具內的版本為準；專案內的副本（給 Claude 與離線閱讀用）不同時就更新，隨下一次儲存提交
  const lib = await fs.readFile(LIBRARY, "utf8");
  const copy = path.join(dir, "lib", "JRI.sysml");
  if ((await fs.readFile(copy, "utf8").catch(() => "")) !== lib) await fs.writeFile(copy, lib, "utf8").catch(() => {});
  await syncSkill(dir).catch(() => {});
  const out: Source[] = [["JRI.sysml", lib]];
  // 共用元件庫：所有專案都看得到，副本放進專案的 lib/ 讓儲存庫自給自足
  for (const f of await listShared()) {
    const text = await readShared(f);
    out.push([f, text]);
    if ((await fs.readFile(path.join(dir, "lib", f), "utf8").catch(() => "")) !== text) await fs.writeFile(path.join(dir, "lib", f), text, "utf8").catch(() => {});
  }
  const files = await listFiles(id);
  if (override && !files.includes(override.file)) files.push(override.file);
  const own: Source[] = [];
  for (const f of files) {
    if (override?.file === f) { own.push([f, upgradeText(override.content)]); continue; }
    // 舊寫法（#derive dependency 等）轉成標準庫的寫法並寫回檔案，隨下一次儲存提交（F-36）
    const text = await fs.readFile(path.join(dir, "model", f), "utf8");
    const next = upgradeText(text);
    if (next !== text) await fs.writeFile(path.join(dir, "model", f), next, "utf8").catch(() => {});
    own.push([f, next]);
  }
  // CoSMA 專案：基礎庫與附加庫的副本放進 lib/cosma/、lib/addon/，讓儲存庫自給自足（F-82）
  for (const [n, text] of await frameworkSources(own.map(([, t]) => t))) {
    out.push([n, text]);
    const copy = path.join(dir, "lib", n.startsWith("cosma:") ? "cosma" : "addon", n.slice(n.indexOf(":") + 1));
    if ((await fs.readFile(copy, "utf8").catch(() => "")) !== text) await fs.mkdir(path.dirname(copy), { recursive: true }).then(() => fs.writeFile(copy, text, "utf8")).catch(() => {});
  }
  return [...out, ...own];
}

export async function analyzeProject(id: string, override?: { file: string; content: string }): Promise<Analysis> {
  const list = await sources(id, override);
  return analyze(list, (await readProject(id)).pristine ? [] : [...await listShared(), ...list.map(([n]) => n).filter(isFrameworkSource)]);
}

/** 儲存前先解析；有錯誤就不寫入，回傳診斷讓使用者修正。 */
export async function saveFile(id: string, file: string, content: string, author: string, message: string): Promise<{ saved: boolean; analysis: Analysis; commit?: string }> {
  if (SHARED_FILE.test(file) || file === "JRI.sysml") throw new UserError("檔名不合法。");
  const target = await modelFile(id, file);
  content = upgradeText(content); // 手寫的舊寫法照樣收，存成標準庫的寫法
  const analysis = await analyzeProject(id, { file, content });
  if (!analysis.ok) return { saved: false, analysis };
  const dir = dirOf(id);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  const sha = await commit(dir, author, message || `更新 ${file}`);
  return { saved: true, analysis, commit: sha };
}

export async function setManual(id: string, key: string, done: boolean, author: string): Promise<Project> {
  const p = await readProject(id);
  p.manual[key] = done;
  await writeProject(id, p);
  await commit(dirOf(id), author, `${done ? "確認" : "取消確認"}檢查項目 ${key}`);
  return p;
}

export async function signoff(id: string, input: Omit<Signoff, "at" | "commit">): Promise<Project> {
  const p = await readProject(mainOnly(id, "節點簽核"));
  if (!p.gates.includes(input.gate)) throw new UserError("這個專案沒有此節點。");
  if (!input.by.trim()) throw new UserError("請填簽核人姓名。");
  const dir = dirOf(id);
  const head = await git(dir, "rev-parse", "--short", "HEAD");
  p.signoffs.push({ ...input, at: new Date().toISOString(), commit: head });
  await writeProject(id, p);
  await commit(dir, input.by, `${input.gate.toUpperCase()}${input.subsystem ? `（${input.subsystem}）` : ""} 簽核：${input.decision}`);
  if (input.decision === "APPROVE") {
    // 節點通過時打標籤作為基線
    const tag = `baseline/${input.gate}${input.subsystem ? "-" + Buffer.from(input.subsystem).toString("hex").slice(0, 12) : ""}-${Date.now()}`;
    await git(dir, "tag", tag);
    pushLater(dir);
  }
  return p;
}

export async function history(id: string): Promise<{ commit: string; author: string; date: string; message: string }[]> {
  const out = await git(dirOf(id), "log", "-n", "100", "--pretty=format:%h%x09%an%x09%aI%x09%s");
  return out.split("\n").filter(Boolean).map((l) => {
    const [c, author, date, ...m] = l.split("\t");
    return { commit: c, author, date, message: m.join("\t") };
  });
}

/** w、h 只有套件用：套件在圖上是一個可調大小的框。 */
export type Layout = Record<string, Record<string, { x: number; y: number; w?: number; h?: number }>>;

/**
 * 元素搬進或搬出套件後，它（與它裡面的東西）的識別碼會跟著完整名稱改變。
 * 把版面與自訂圖裡的舊識別碼換成新的，位置與成員才不會遺失。pairs：[舊, 新]，id 與完整名稱都可以。
 */
export async function remapIds(id: string, pairs: [string, string][], qnames: [string, string][]): Promise<void> {
  if (pairs.length === 0) return;
  const swap = (s: string, list: [string, string][], sep: string) => {
    for (const [a, b] of list) { if (s === a) return b; if (s.startsWith(a + sep)) return b + s.slice(a.length); }
    return s;
  };
  const node = (s: string) => swap(s, pairs, "__");
  const diagram = (s: string) => { const m = s.match(/^(ibd|stm|act):(.*)$/s); return m ? `${m[1]}:${swap(m[2], qnames, "::")}` : s; };
  const layout = await readLayout(id);
  const nextLayout: Layout = {};
  for (const [d, nodes] of Object.entries(layout)) nextLayout[diagram(d)] = Object.fromEntries(Object.entries(nodes).map(([n, p]) => [node(n), p]));
  await fs.writeFile(path.join(dirOf(id), "layout.json"), JSON.stringify(nextLayout, null, 1) + "\n", "utf8");
  const dg = await readDiagrams(id);
  const next: Diagrams = { custom: dg.custom.map((c) => ({ ...c, members: c.members.map(node) })), notes: Object.fromEntries(Object.entries(dg.notes).map(([d, list]) => [diagram(d), list])) };
  await fs.writeFile(path.join(dirOf(id), "diagrams.json"), JSON.stringify(next, null, 1) + "\n", "utf8");
}

export async function readLayout(id: string): Promise<Layout> {
  const raw = await fs.readFile(path.join(dirOf(id), "layout.json"), "utf8").catch(() => "{}");
  try { return JSON.parse(raw) as Layout; } catch { return {}; }
}

export async function writeLayout(id: string, layout: Layout): Promise<void> {
  await readProject(id);
  const clean: Layout = {};
  for (const [diagram, nodes] of Object.entries(layout ?? {})) {
    if (typeof nodes !== "object" || nodes === null) continue;
    clean[diagram] = {};
    for (const [node, pos] of Object.entries(nodes)) {
      if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) continue;
      clean[diagram][node] = { x: Math.round(pos.x), y: Math.round(pos.y) };
      if (Number.isFinite(pos.w) && Number.isFinite(pos.h)) Object.assign(clean[diagram][node], { w: Math.min(8000, Math.max(96, Math.round(pos.w as number))), h: Math.min(8000, Math.max(64, Math.round(pos.h as number))) });
    }
  }
  await fs.writeFile(path.join(dirOf(id), "layout.json"), JSON.stringify(clean, null, 1) + "\n", "utf8");
}

/** 自訂圖與圖上的標註。自訂圖只記錄「放了哪些模型項目」；標註（註解、外框、文字）只是說明，不進模型。 */
export interface Annotation { id: string; type: "note" | "frame" | "text"; x: number; y: number; w: number; h: number; text: string }
export interface Diagrams { custom: { id: string; title: string; members: string[] }[]; notes: Record<string, Annotation[]> }

export async function readDiagrams(id: string): Promise<Diagrams> {
  const raw = await fs.readFile(path.join(dirOf(id), "diagrams.json"), "utf8").catch(() => "{}");
  try { return cleanDiagrams(JSON.parse(raw)); } catch { return { custom: [], notes: {} }; }
}

function cleanDiagrams(input: unknown): Diagrams {
  const src = (input ?? {}) as { custom?: unknown; notes?: unknown };
  const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
  const num = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
  const out: Diagrams = { custom: [], notes: {} };
  const seen = new Set<string>();
  for (const c of Array.isArray(src.custom) ? src.custom.slice(0, 50) : []) {
    const cid = str(c?.id, 40);
    if (!/^custom:[A-Za-z0-9_-]{1,32}$/.test(cid) || seen.has(cid)) continue;
    seen.add(cid);
    const members = Array.isArray(c?.members) ? [...new Set<string>(c.members.filter((m: unknown) => typeof m === "string" && m.length <= 400))].slice(0, 500) : [];
    out.custom.push({ id: cid, title: str(c?.title, 60).trim() || "自訂圖", members });
  }
  if (src.notes && typeof src.notes === "object") {
    for (const [diagram, list] of Object.entries(src.notes as Record<string, unknown>).slice(0, 200)) {
      if (diagram.length > 400 || !Array.isArray(list)) continue;
      const ids = new Set<string>();
      const clean: Annotation[] = [];
      for (const n of list.slice(0, 200)) {
        const nid = str(n?.id, 40);
        if (!/^note:[A-Za-z0-9_-]{1,32}$/.test(nid) || ids.has(nid)) continue;
        if (n?.type !== "note" && n?.type !== "frame" && n?.type !== "text") continue;
        ids.add(nid);
        clean.push({ id: nid, type: n.type, x: num(n.x, -100000, 100000), y: num(n.y, -100000, 100000), w: num(n.w, 48, 4000), h: num(n.h, 24, 4000), text: str(n.text, 500) });
      }
      if (clean.length > 0) out.notes[diagram] = clean;
    }
  }
  return out;
}

export async function writeDiagrams(id: string, input: unknown): Promise<Diagrams> {
  await readProject(id);
  const clean = cleanDiagrams(input);
  await fs.writeFile(path.join(dirOf(id), "diagrams.json"), JSON.stringify(clean, null, 1) + "\n", "utf8");
  return clean;
}

/** 封存專案：整個資料夾移到 archive，不真的刪除。必須輸入專案名稱確認。 */
export async function archiveProject(id: string, confirmName: string): Promise<string> {
  const p = await readProject(mainOnly(id, "封存專案"));
  if (confirmName.trim() !== p.name) throw new UserError("輸入的專案名稱不符，未封存。");
  // 分支的工作目錄不跟著封存：還沒提交的變更先存進分支，再收掉。分支本身留在儲存庫裡
  const opened = path.join(BRANCH_DIR, id);
  for (const d of await fs.readdir(opened).catch(() => [] as string[])) await commit(path.join(opened, d), "JRI MBSE", "封存前儲存未提交的變更").catch(() => "");
  await fs.rm(opened, { recursive: true, force: true });
  await git(dirOf(id), "worktree", "prune").catch(() => "");
  const archive = path.join(HOME_DIR, "archive");
  await fs.mkdir(archive, { recursive: true });
  const target = path.join(archive, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await fs.rename(dirOf(id), target);
  return target;
}

// ───────── 復原與重做 ─────────
// 每一次對模型的修改都是一次提交。復原＝把 model/ 換回上一步的內容再提交一次，重做＝換回下一步。
// 歷史本身不會被改寫；走到哪一步記在 git 資料夾裡的 jri-undo.json（不進版本紀錄）。分支的工作目錄各有一份。
interface Hist { tip: string; snaps: string[]; pos: number }
const HIST_MAX = 200;
const histFile = async (dir: string) => path.join(await git(dir, "rev-parse", "--absolute-git-dir"), "jri-undo.json");
const lastModelCommit = (dir: string) => git(dir, "log", "-1", "--first-parent", "--pretty=%H", "HEAD", "--", "model").catch(() => "");

async function loadHist(dir: string): Promise<Hist> {
  const tip = await lastModelCommit(dir);
  let h: Hist | null = null;
  try { h = JSON.parse(await fs.readFile(await histFile(dir), "utf8")) as Hist; } catch { /* 還沒有紀錄 */ }
  if (h && h.tip === tip && h.snaps?.[h.pos]) return h;
  const list = async (...range: string[]) => (await git(dir, "log", "--first-parent", "--reverse", "--pretty=%H", ...range, "--", "model").catch(() => "")).split("\n").filter(Boolean);
  let snaps: string[];
  if (h && h.snaps?.[h.pos] && await git(dir, "merge-base", "--is-ancestor", h.tip, "HEAD").then(() => true, () => false)) {
    // 復原之後又做了新的修改：丟掉可以重做的部分，接上新的步驟
    snaps = [...h.snaps.slice(0, h.pos + 1), ...(await list(`${h.tip}..HEAD`))];
  } else snaps = await list("-n", String(HIST_MAX), "HEAD");
  snaps = snaps.slice(-HIST_MAX);
  const next = { tip, snaps, pos: snaps.length - 1 };
  await fs.writeFile(await histFile(dir), JSON.stringify(next), "utf8").catch(() => undefined);
  return next;
}

/** 目前能不能復原、重做。 */
export async function historyState(id: string): Promise<{ undo: boolean; redo: boolean }> {
  const h = await loadHist(dirOf(id)).catch(() => null);
  return { undo: !!h && h.pos > 0, redo: !!h && h.pos < h.snaps.length - 1 };
}

/** 復原（step = -1）或重做（step = 1）一步。只換 model/ 的內容；簽核、時程等其他資料不受影響。 */
export async function stepHistory(id: string, author: string, step: -1 | 1): Promise<void> {
  const dir = dirOf(id);
  await readProject(id);
  await repoConfig(dir);
  // 先把未提交的變更（例如圖的版面）存起來
  if (await git(dir, "status", "--porcelain")) await commit(dir, author, "儲存圖的版面");
  const h = await loadHist(dir);
  const tree = (rev: string) => git(dir, "rev-parse", `${rev}:model`).catch(() => "");
  const cur = await tree("HEAD");
  let to = h.pos + step;
  while (h.snaps[to] && (await tree(h.snaps[to])) === cur) to += step; // 內容相同的步驟直接跳過
  if (!h.snaps[to]) throw new UserError(step < 0 ? "沒有可以復原的步驟了。" : "沒有可以重做的步驟。");
  const subject = await git(dir, "log", "-1", "--pretty=%s", h.snaps[step < 0 ? to + 1 : to]);
  const before = { layout: await readLayout(id), diagrams: await readDiagrams(id) };
  const putBack = () => git(dir, "restore", "--source=HEAD", "--staged", "--worktree", "--", "model").catch(() => "");
  try { await git(dir, "restore", `--source=${h.snaps[to]}`, "--staged", "--worktree", "--", "model"); }
  catch { await putBack(); throw new UserError("無法回到那一步。"); }
  const a = await analyzeProject(id);
  if (!a.ok) { await putBack(); throw new UserError(`${step < 0 ? "復原" : "重做"}後的模型會有錯誤，已取消。`); }
  // 圖的位置與自訂圖的成員：保留現在的，只把那一步有、現在沒有的補回來（被刪掉又救回來的項目才會回到原位）
  const old = async <T>(file: string, fallback: T): Promise<T> => { try { return JSON.parse(await git(dir, "show", `${h.snaps[to]}:${file}`)) as T; } catch { return fallback; } };
  const layout = before.layout;
  for (const [d, nodes] of Object.entries(await old<Layout>("layout.json", {}))) {
    if (typeof nodes !== "object" || nodes === null) continue;
    layout[d] = { ...nodes, ...(layout[d] ?? {}) };
  }
  await writeLayout(id, layout);
  const ids = new Set(a.elements.map((e) => e.id));
  const was = new Map((await old<Partial<Diagrams>>("diagrams.json", {})).custom?.map((c) => [c.id, c.members ?? []]) ?? []);
  await writeDiagrams(id, { ...before.diagrams, custom: before.diagrams.custom.map((c) => ({ ...c, members: [...c.members, ...(was.get(c.id) ?? []).filter((m) => ids.has(m) && !c.members.includes(m))] })) });
  await commit(dir, author, `${step < 0 ? "復原" : "重做"}：${subject}`.slice(0, 200));
  await fs.writeFile(await histFile(dir), JSON.stringify({ tip: await lastModelCommit(dir), snaps: h.snaps, pos: to }), "utf8");
}
