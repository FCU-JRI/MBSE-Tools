// 專案儲存：每個專案是一個獨立的 git 儲存庫，模型為 SysML v2 文字檔。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./engine.ts";
import type { Analysis, Source } from "./engine.ts";
import { GATES } from "./gates.ts";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const HOME_DIR = path.resolve(process.env.JRI_HOME ?? path.join(ROOT, "data"));
export const DATA_DIR = path.join(HOME_DIR, "projects");
const TEMPLATE_DIR = path.join(ROOT, "templates");
const LIBRARY = path.join(ROOT, "library", "JRI.sysml");

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
  /** blank 空白、sample 範本（附示範內容）、guided 流程範本（逐步引導，不可跳步） */
  template?: "blank" | "sample" | "guided";
  highPower?: boolean; // 高功率（H 級以上）：TRR／FRR 只有指導老師能核可
  manual: Record<string, boolean>;
  signoffs: Signoff[];
}

export class UserError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const FILE = /^[A-Za-z0-9_\-一-鿿]+\.sysml$/;

export function dirOf(id: string): string {
  if (!ID.test(id)) throw new UserError("專案代號只能用小寫英數與連字號。");
  return path.join(DATA_DIR, id);
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
      await run("git", ["push", "--follow-tags", "origin", "main"], { cwd: dir, windowsHide: true, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      await run("git", ["push", "origin", "--tags"], { cwd: dir, windowsHide: true, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      st.lastPushAt = new Date().toISOString(); st.error = null;
    } catch (e) {
      st.error = String((e as { stderr?: string }).stderr ?? (e as Error).message).split("\n").filter(Boolean).slice(-2).join(" ").slice(0, 300);
    } finally { st.pushing = false; }
  }, 1500);
}

const REMOTE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/;
export async function setRemote(id: string, url: string): Promise<SyncState> {
  const dir = dirOf(id);
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

async function writeProject(p: Project): Promise<void> {
  await fs.writeFile(path.join(dirOf(p.id), "project.json"), JSON.stringify(p, null, 2) + "\n", "utf8");
}

export async function createProject(input: { id: string; name: string; kind: "annual" | "small"; gates?: string[]; template?: string; author: string }): Promise<Project> {
  const template: Project["template"] = input.template === "blank" || input.template === "guided" ? input.template : "sample";
  const dir = dirOf(input.id);
  if (!input.name.trim()) throw new UserError("請填專案名稱。");
  if (await fs.stat(dir).catch(() => null)) throw new UserError("這個專案代號已經被使用。");
  const all = GATES.map((g) => g.id);
  const gates = input.kind === "annual" ? all : all.filter((g) => (input.gates ?? []).includes(g));
  if (gates.length === 0) throw new UserError("小型專案至少要保留一個節點。");

  await fs.mkdir(path.join(dir, "model"), { recursive: true });
  await fs.mkdir(path.join(dir, "lib"), { recursive: true });
  await fs.copyFile(path.join(TEMPLATE_DIR, template === "sample" ? "sounding-rocket" : "blank", "model.sysml"), path.join(dir, "model", "model.sysml"));
  await syncSkill(dir);
  await fs.copyFile(LIBRARY, path.join(dir, "lib", "JRI.sysml"));
  await fs.copyFile(path.join(TEMPLATE_DIR, "CLAUDE.md"), path.join(dir, "CLAUDE.md")).catch(() => {});
  const project: Project = { id: input.id, name: input.name.trim(), kind: input.kind, template, createdAt: new Date().toISOString(), gates, manual: {}, signoffs: [] };
  await writeProject(project);
  await git(dir, "init", "-b", "main");
  await repoConfig(dir);
  await commit(dir, input.author, `建立專案：${project.name}`);
  return project;
}

export async function listFiles(id: string): Promise<string[]> {
  const names = await fs.readdir(path.join(dirOf(id), "model"));
  return names.filter((n) => n.endsWith(".sysml") && !SHARED_FILE.test(n) && n !== "JRI.sysml").sort();
}

export async function readFile(id: string, file: string): Promise<string> {
  if (!FILE.test(file)) throw new UserError("檔名不合法。");
  return fs.readFile(path.join(dirOf(id), "model", file), "utf8");
}

const SHARED_DIR = path.join(HOME_DIR, "shared");
const SHARED_FILE = /^shared-[a-z0-9-]{1,40}\.sysml$/;

export async function listShared(): Promise<string[]> {
  const names = await fs.readdir(SHARED_DIR).catch(() => [] as string[]);
  return names.filter((n) => SHARED_FILE.test(n)).sort();
}
export async function readShared(file: string): Promise<string> {
  if (!SHARED_FILE.test(file)) throw new UserError("共用元件庫的檔名必須是 shared-名稱.sysml（小寫英數與連字號）。");
  return fs.readFile(path.join(SHARED_DIR, file), "utf8").catch(() => "");
}
/** 共用元件庫存檔前，連同元模型庫一起解析；有錯誤不寫入。 */
export async function saveShared(file: string, content: string): Promise<{ saved: boolean; analysis: Analysis }> {
  if (!SHARED_FILE.test(file)) throw new UserError("共用元件庫的檔名必須是 shared-名稱.sysml（小寫英數與連字號）。");
  const others: Source[] = [];
  for (const f of await listShared()) if (f !== file) others.push([f, await readShared(f)]);
  const analysis = await analyze([["JRI.sysml", await fs.readFile(LIBRARY, "utf8")], ...others, [file, content]], [...others.map(([n]) => n), file]);
  if (!analysis.ok) return { saved: false, analysis };
  await fs.mkdir(SHARED_DIR, { recursive: true });
  await fs.writeFile(path.join(SHARED_DIR, file), content, "utf8");
  return { saved: true, analysis };
}

export async function sources(id: string, override?: { file: string; content: string }): Promise<Source[]> {
  const dir = dirOf(id);
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
  for (const f of files) {
    out.push([f, override?.file === f ? override.content : await fs.readFile(path.join(dir, "model", f), "utf8")]);
  }
  return out;
}

export async function analyzeProject(id: string, override?: { file: string; content: string }): Promise<Analysis> {
  return analyze(await sources(id, override), await listShared());
}

/** 儲存前先解析；有錯誤就不寫入，回傳診斷讓使用者修正。 */
export async function saveFile(id: string, file: string, content: string, author: string, message: string): Promise<{ saved: boolean; analysis: Analysis; commit?: string }> {
  if (!FILE.test(file) || SHARED_FILE.test(file) || file === "JRI.sysml") throw new UserError("檔名不合法。");
  const analysis = await analyzeProject(id, { file, content });
  if (!analysis.ok) return { saved: false, analysis };
  const dir = dirOf(id);
  await fs.writeFile(path.join(dir, "model", file), content, "utf8");
  const sha = await commit(dir, author, message || `更新 ${file}`);
  return { saved: true, analysis, commit: sha };
}

export async function setManual(id: string, key: string, done: boolean, author: string): Promise<Project> {
  const p = await readProject(id);
  p.manual[key] = done;
  await writeProject(p);
  await commit(dirOf(id), author, `${done ? "確認" : "取消確認"}檢查項目 ${key}`);
  return p;
}

export async function signoff(id: string, input: Omit<Signoff, "at" | "commit">): Promise<Project> {
  const p = await readProject(id);
  if (!p.gates.includes(input.gate)) throw new UserError("這個專案沒有此節點。");
  if (!input.by.trim()) throw new UserError("請填簽核人姓名。");
  const dir = dirOf(id);
  const head = await git(dir, "rev-parse", "--short", "HEAD");
  p.signoffs.push({ ...input, at: new Date().toISOString(), commit: head });
  await writeProject(p);
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
  const p = await readProject(id);
  if (confirmName.trim() !== p.name) throw new UserError("輸入的專案名稱不符，未封存。");
  const archive = path.join(HOME_DIR, "archive");
  await fs.mkdir(archive, { recursive: true });
  const target = path.join(archive, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await fs.rename(dirOf(id), target);
  return target;
}

/** 還原最近一次提交，限於只動到模型檔的提交；還原後模型必須仍能解析。 */
export async function undoLast(id: string, author: string): Promise<void> {
  const dir = dirOf(id);
  await readProject(id);
  await repoConfig(dir);
  // 先把未提交的變更（例如圖的版面）存起來，再判斷上一步是什麼
  if (await git(dir, "status", "--porcelain")) await commit(dir, author, "儲存圖的版面");
  let target = "HEAD";
  // 版面的提交不算一步，往前找到最近一次模型修改
  for (let i = 0; i < 5; i++) {
    const names = (await git(dir, "show", "--name-only", "--pretty=format:", target)).split("\n").map((f) => f.trim()).filter(Boolean);
    if (names.length > 0 && names.every((f) => f === "layout.json" || f === "diagrams.json" || f.startsWith("lib/"))) target += "~1"; else break;
  }
  const files = (await git(dir, "show", "--name-only", "--pretty=format:", target)).split("\n").map((f) => f.trim()).filter(Boolean);
  const parents = (await git(dir, "rev-list", "--parents", "-n", "1", target)).split(" ").length - 1;
  if (parents !== 1) throw new UserError("上一步是建立專案或合併分支，不能復原。");
  if (files.length === 0 || !files.every((f) => f.startsWith("model/") || f.startsWith("lib/") || f === "layout.json" || f === "diagrams.json")) {
    throw new UserError("上一步不是模型的修改（可能是簽核、時程或模擬），不能在這裡復原。");
  }
  const subject = await git(dir, "log", "-1", "--pretty=%s", target);
  const name = author.trim() || "JRI MBSE";
  try {
    await git(dir, "-c", `user.name=${name}`, "-c", "user.email=mbse@jri.local", "revert", "--no-commit", target);
  } catch {
    await git(dir, "revert", "--abort").catch(() => "");
    throw new UserError("無法自動復原上一步。");
  }
  const a = await analyzeProject(id);
  if (!a.ok) {
    await git(dir, "revert", "--abort").catch(() => "");
    await git(dir, "checkout", "--", ".").catch(() => "");
    throw new UserError("復原後的模型會有錯誤，已取消。");
  }
  await git(dir, "-c", `user.name=${name}`, "-c", "user.email=mbse@jri.local", "commit", "-m", `復原：${subject}`.slice(0, 200));
  pushLater(dir);
}
