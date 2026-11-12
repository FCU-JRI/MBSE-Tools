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
export const DATA_DIR = path.resolve(process.env.JRI_DATA ?? path.join(ROOT, "data", "projects"));
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
  manual: Record<string, boolean>;
  signoffs: Signoff[];
}

export class UserError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const FILE = /^[A-Za-z0-9_\-一-鿿]+\.sysml$/;

function dirOf(id: string): string {
  if (!ID.test(id)) throw new UserError("專案代號只能用小寫英數與連字號。");
  return path.join(DATA_DIR, id);
}

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd: dir, windowsHide: true });
  return stdout.trim();
}

async function commit(dir: string, author: string, message: string): Promise<string> {
  await git(dir, "add", "-A");
  const status = await git(dir, "status", "--porcelain");
  if (status) {
    const name = author.trim() || "JRI MBSE";
    await git(dir, "-c", `user.name=${name}`, "-c", "user.email=mbse@jri.local", "commit", "-m", message);
  }
  return git(dir, "rev-parse", "--short", "HEAD");
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

export async function createProject(input: { id: string; name: string; kind: "annual" | "small"; gates?: string[]; author: string }): Promise<Project> {
  const dir = dirOf(input.id);
  if (!input.name.trim()) throw new UserError("請填專案名稱。");
  if (await fs.stat(dir).catch(() => null)) throw new UserError("這個專案代號已經被使用。");
  const all = GATES.map((g) => g.id);
  const gates = input.kind === "annual" ? all : all.filter((g) => (input.gates ?? []).includes(g));
  if (gates.length === 0) throw new UserError("小型專案至少要保留一個節點。");

  await fs.mkdir(path.join(dir, "model"), { recursive: true });
  await fs.mkdir(path.join(dir, "lib"), { recursive: true });
  await fs.copyFile(path.join(TEMPLATE_DIR, "sounding-rocket", "model.sysml"), path.join(dir, "model", "model.sysml"));
  await fs.copyFile(LIBRARY, path.join(dir, "lib", "JRI.sysml"));
  await fs.copyFile(path.join(TEMPLATE_DIR, "CLAUDE.md"), path.join(dir, "CLAUDE.md")).catch(() => {});
  const project: Project = { id: input.id, name: input.name.trim(), kind: input.kind, createdAt: new Date().toISOString(), gates, manual: {}, signoffs: [] };
  await writeProject(project);
  await git(dir, "init", "-b", "main");
  await commit(dir, input.author, `建立專案：${project.name}`);
  return project;
}

export async function listFiles(id: string): Promise<string[]> {
  const names = await fs.readdir(path.join(dirOf(id), "model"));
  return names.filter((n) => n.endsWith(".sysml")).sort();
}

export async function readFile(id: string, file: string): Promise<string> {
  if (!FILE.test(file)) throw new UserError("檔名不合法。");
  return fs.readFile(path.join(dirOf(id), "model", file), "utf8");
}

export async function sources(id: string, override?: { file: string; content: string }): Promise<Source[]> {
  const dir = dirOf(id);
  const out: Source[] = [["JRI.sysml", await fs.readFile(path.join(dir, "lib", "JRI.sysml"), "utf8")]];
  const files = await listFiles(id);
  if (override && !files.includes(override.file)) files.push(override.file);
  for (const f of files) {
    out.push([f, override?.file === f ? override.content : await fs.readFile(path.join(dir, "model", f), "utf8")]);
  }
  return out;
}

export async function analyzeProject(id: string, override?: { file: string; content: string }): Promise<Analysis> {
  return analyze(await sources(id, override));
}

/** 儲存前先解析；有錯誤就不寫入，回傳診斷讓使用者修正。 */
export async function saveFile(id: string, file: string, content: string, author: string, message: string): Promise<{ saved: boolean; analysis: Analysis; commit?: string }> {
  if (!FILE.test(file)) throw new UserError("檔名不合法。");
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

export type Layout = Record<string, Record<string, { x: number; y: number }>>;

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
      if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) clean[diagram][node] = { x: Math.round(pos.x), y: Math.round(pos.y) };
    }
  }
  await fs.writeFile(path.join(dirOf(id), "layout.json"), JSON.stringify(clean, null, 1) + "\n", "utf8");
}
