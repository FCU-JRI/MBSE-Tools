// 專案管理：時程（甘特圖）、成本、人員。資料存在專案儲存庫的 pm.json。
// 欄位與優先級依 AEAS-EXB-REG-1001 6.1.2、6.1.3。
import fs from "node:fs/promises";
import path from "node:path";
import { commit, dirOf, readProject, UserError } from "./projects.ts";

export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4", "P5"] as const;
export type Priority = (typeof PRIORITIES)[number];
/** 設定某個優先級所需的最低職級（AEAS Table 5）。 */
export const PRIORITY_LEVEL: Record<Priority, number> = { P0: 10, P1: 8, P2: 7, P3: 5, P4: 4, P5: 0 };
export const PRIORITY_ZH: Record<Priority, string> = { P0: "不計代價", P1: "最急", P2: "緊急", P3: "最優先", P4: "優先", P5: "普通" };

export interface Task { id: string; title: string; priority: Priority; re: string; start: string; end: string; deps: string[]; gate: string; links: string[]; subsystem: string; done: boolean }
export interface Cost { id: string; subsystem: string; item: string; planned: number; actual: number; status: string; note: string }
export interface Person { id: string; name: string; rank: string; subsystem: string; duty: string }
/** 來源文件：只存連結，檔案本身放在 Google Drive 等處。 */
export interface Doc { id: string; title: string; type: string; revision: string; url: string; note: string }
export interface Pm { tasks: Task[]; costs: Cost[]; people: Person[]; docs: Doc[]; milestones: Record<string, string> }
export type Kind = "tasks" | "costs" | "people" | "docs";

const file = (id: string) => path.join(dirOf(id), "pm.json");

export async function readPm(id: string): Promise<Pm> {
  await readProject(id);
  try {
    const p = JSON.parse(await fs.readFile(file(id), "utf8")) as Partial<Pm>;
    return { tasks: p.tasks ?? [], costs: p.costs ?? [], people: p.people ?? [], docs: p.docs ?? [], milestones: p.milestones ?? {} };
  } catch { return { tasks: [], costs: [], people: [], docs: [], milestones: {} }; }
}

const text = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const money = (v: unknown, name: string) => {
  const n = Number(v === "" || v == null ? 0 : v);
  if (!Number.isFinite(n) || n < 0) throw new UserError(`「${name}」必須是不小於 0 的數字。`);
  return Math.round(n);
};

function nextId(items: { id: string }[], prefix: string): string {
  const max = items.reduce((m, x) => Math.max(m, Number(x.id.match(/(\d+)$/)?.[1] ?? 0)), 0);
  return `${prefix}${max + 1}`;
}

function cleanTask(b: any, pm: Pm, level: number, old?: Task): Task {
  const title = text(b.title);
  if (!title) throw new UserError("請填任務名稱。");
  const priority = PRIORITIES.includes(b.priority) ? (b.priority as Priority) : "P5";
  // 只有調整優先級時才檢查權限，避免低職級成員無法更新別人設好的高優先任務進度
  if ((!old || old.priority !== priority) && level < PRIORITY_LEVEL[priority]) {
    throw new UserError(`你的職級不能設定 ${priority}（${PRIORITY_ZH[priority]}）。依 AEAS 規定需要職級 ${PRIORITY_LEVEL[priority]} 以上。`);
  }
  const start = text(b.start), end = text(b.end);
  if (!DATE.test(start) || !DATE.test(end)) throw new UserError("開始與結束日期請用 YYYY-MM-DD。");
  if (end < start) throw new UserError("結束日期不能早於開始日期。");
  const id = old?.id ?? (text(b.id, 20) || nextId(pm.tasks, "J"));
  if (!/^[A-Za-z0-9.\-]{1,20}$/.test(id)) throw new UserError("任務編號只能用英數、點與連字號。");
  if (!old && pm.tasks.some((t) => t.id === id)) throw new UserError(`任務編號 ${id} 已被使用。`);
  const deps = (Array.isArray(b.deps) ? b.deps : String(b.deps ?? "").split(/[,，、\s]+/)).map((d: unknown) => text(d, 20)).filter((d: string) => d && d !== id);
  for (const d of deps) if (!pm.tasks.some((t) => t.id === d)) throw new UserError(`找不到相依的任務 ${d}。`);
  const links = (Array.isArray(b.links) ? b.links : String(b.links ?? "").split(/[,，、\s]+/)).map((d: unknown) => text(d, 40)).filter(Boolean);
  return { id, title, priority, re: text(b.re, 60), start, end, deps, gate: text(b.gate, 20), links, subsystem: text(b.subsystem, 60), done: b.done === true };
}

function cleanCost(b: any, pm: Pm, old?: Cost): Cost {
  const item = text(b.item);
  if (!item) throw new UserError("請填項目名稱。");
  return { id: old?.id ?? nextId(pm.costs, "C"), subsystem: text(b.subsystem, 60), item, planned: money(b.planned, "預算"), actual: money(b.actual, "實支"), status: text(b.status, 20) || "規劃中", note: text(b.note) };
}

function cleanPerson(b: any, pm: Pm, old?: Person): Person {
  const name = text(b.name, 60);
  if (!name) throw new UserError("請填姓名。");
  return { id: old?.id ?? nextId(pm.people, "M"), name, rank: text(b.rank, 20), subsystem: text(b.subsystem, 60), duty: text(b.duty) };
}

function cleanDoc(b: any, pm: Pm, old?: Doc): Doc {
  const title = text(b.title);
  if (!title) throw new UserError("請填文件名稱。");
  const url = text(b.url, 600);
  // 只接受 https 連結，避免存入可執行的網址
  if (url && !/^https:\/\/[^\s<>"']+$/.test(url)) throw new UserError("連結必須是 https:// 開頭的網址。");
  const id = old?.id ?? (text(b.id, 31) || `DOC-${String(pm.docs.reduce((m, x) => Math.max(m, Number(x.id.match(/(\d+)$/)?.[1] ?? 0)), 0) + 1).padStart(3, "0")}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(id)) throw new UserError("文件編號只能用英數、點、底線與連字號。");
  if (!old && pm.docs.some((d) => d.id === id)) throw new UserError(`文件編號 ${id} 已被使用。`);
  return { id, title, type: text(b.type, 20) || "其他", revision: text(b.revision, 30), url, note: text(b.note) };
}

export async function setMilestone(id: string, gate: string, date: string, author: string): Promise<Pm> {
  const pm = await readPm(id);
  if (date && !DATE.test(date)) throw new UserError("日期請用 YYYY-MM-DD。");
  if (date) pm.milestones[gate.slice(0, 20)] = date; else delete pm.milestones[gate];
  await fs.writeFile(file(id), JSON.stringify(pm, null, 1) + "\n", "utf8");
  await commit(dirOf(id), author, `設定里程碑日期：${gate.toUpperCase()} ${date || "（清除）"}`);
  return pm;
}

export async function upsert(id: string, kind: Kind, body: any, level: number, author: string): Promise<Pm> {
  const pm = await readPm(id);
  const list = pm[kind] as { id: string }[];
  const old = body?.id ? list.find((x) => x.id === body.id) : undefined;
  const item = kind === "tasks" ? cleanTask(body, pm, level, old as Task | undefined) : kind === "costs" ? cleanCost(body, pm, old as Cost | undefined) : kind === "docs" ? cleanDoc(body, pm, old as Doc | undefined) : cleanPerson(body, pm, old as Person | undefined);
  if (old) list[list.indexOf(old)] = item; else list.push(item);
  if (kind === "tasks") pm.tasks.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  await fs.writeFile(file(id), JSON.stringify(pm, null, 1) + "\n", "utf8");
  const zh = { tasks: "任務", costs: "成本項目", people: "人員", docs: "文件" }[kind];
  await commit(dirOf(id), author, `${old ? "更新" : "新增"}${zh}：${(item as any).title ?? (item as any).item ?? (item as any).name}`);
  return pm;
}

export async function remove(id: string, kind: Kind, itemId: string, author: string): Promise<Pm> {
  const pm = await readPm(id);
  if (kind === "tasks" && pm.tasks.some((t) => t.deps.includes(itemId))) throw new UserError("還有其他任務相依於它，請先移除相依。");
  (pm[kind] as { id: string }[]) = (pm[kind] as { id: string }[]).filter((x) => x.id !== itemId) as any;
  await fs.writeFile(file(id), JSON.stringify(pm, null, 1) + "\n", "utf8");
  await commit(dirOf(id), author, `刪除${{ tasks: "任務", costs: "成本項目", people: "人員", docs: "文件" }[kind]} ${itemId}`);
  return pm;
}
