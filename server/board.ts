// 討論白板：便利貼、框、連線。存在專案儲存庫的 board.json，和模型一起進版本紀錄（分支上的白板只在分支上）。
// 多人同時編輯：網頁只送「改了哪幾項」，每一項都和伺服器上的現況做三方合併，各改各的不會互相蓋掉。
import fs from "node:fs/promises";
import path from "node:path";
import { commit, dirOf, git, lock, readProject, UserError } from "./projects.ts";
import { merge3 } from "./versions.ts";

export const BOARD_FILE = "board.json";
export const COLORS = ["yellow", "blue", "green", "pink", "gray"] as const;
export type Color = typeof COLORS[number];
export type Kind = "note" | "frame" | "link";

/** 白板上的一項。note、frame 有位置與大小；link 只有兩端（from、to 是便利貼或框的 id）。 */
export interface Item {
  id: string; kind: Kind;
  x?: number; y?: number; w?: number; h?: number;
  text: string;
  color?: Color;
  /** 便利貼連到的模型元素 id */
  ref?: string;
  from?: string; to?: string;
  /** 建立者與建立時間；最後修改者與時間 */
  author: string; at: string; by: string; updated: string;
}
export interface Board { items: Item[]; by: string; at: string }

export type Op = { op: "put"; base?: unknown; item: unknown } | { op: "del"; id: string };

const MAX_ITEMS = 500;
const ID = /^(note|frame|link):[A-Za-z0-9_-]{1,32}$/;
const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 整理一項的內容；不合法的回傳 null。作者與時間由伺服器填，這裡只照抄。 */
export function cleanItem(raw: unknown): Item | null {
  if (!isObj(raw)) return null;
  const id = str(raw.id, 40);
  const kind = raw.kind;
  if (!ID.test(id) || (kind !== "note" && kind !== "frame" && kind !== "link") || !id.startsWith(`${kind}:`)) return null;
  const meta = { author: str(raw.author, 60), at: str(raw.at, 40), by: str(raw.by, 60), updated: str(raw.updated, 40) };
  if (kind === "link") {
    const from = str(raw.from, 40), to = str(raw.to, 40);
    if (!ID.test(from) || !ID.test(to) || from === to || from.startsWith("link:") || to.startsWith("link:")) return null;
    return { id, kind, from, to, text: str(raw.text, 80), ...meta };
  }
  const item: Item = {
    id, kind,
    x: num(raw.x, -20000, 20000, 0), y: num(raw.y, -20000, 20000, 0),
    w: num(raw.w, kind === "note" ? 120 : 160, 4000, kind === "note" ? 180 : 420),
    h: num(raw.h, kind === "note" ? 64 : 100, 4000, kind === "note" ? 110 : 240),
    text: str(raw.text, kind === "note" ? 1000 : 80),
    ...meta,
  };
  if (kind === "note") {
    item.color = (COLORS as readonly string[]).includes(String(raw.color)) ? raw.color as Color : "yellow";
    const ref = str(raw.ref, 400);
    if (ref) item.ref = ref;
  }
  return item;
}

/** 連線兩端都要存在；不存在的連線丟掉。 */
function tidy(items: Item[]): Item[] {
  const boxes = new Set(items.filter((i) => i.kind !== "link").map((i) => i.id));
  const seen = new Set<string>();
  return items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return i.kind !== "link" || (boxes.has(i.from!) && boxes.has(i.to!));
  }).slice(0, MAX_ITEMS);
}

export function cleanBoard(raw: unknown): Board {
  const src = isObj(raw) ? raw : {};
  const items = (Array.isArray(src.items) ? src.items : []).map(cleanItem).filter((i): i is Item => !!i);
  return { items: tidy(items), by: str(src.by, 60), at: str(src.at, 40) };
}

export async function readBoard(ref: string): Promise<Board> {
  await readProject(ref);
  const raw = await fs.readFile(path.join(dirOf(ref), BOARD_FILE), "utf8").catch(() => "");
  if (!raw) return { items: [], by: "", at: "" };
  try { return cleanBoard(JSON.parse(raw)); } catch { return { items: [], by: "", at: "" }; }
}

/**
 * 套用一批修改。put 帶 base（網頁上次從伺服器拿到的那一項），和伺服器現況做三方合併：
 * 只有一邊改過的欄位採用改過的那邊，兩邊改同一個欄位時以這次送來的為準。
 * 別人已經刪掉的項目，這次的修改略過（不會讓它復活），回傳在 skipped。
 */
export function applyOps(board: Board, ops: Op[], who: string, now = new Date().toISOString()): { board: Board; skipped: string[] } {
  const map = new Map(board.items.map((i) => [i.id, i]));
  const skipped: string[] = [];
  for (const op of ops.slice(0, 200)) {
    if (!isObj(op)) continue;
    if (op.op === "del") {
      const id = str(op.id, 40);
      if (!map.delete(id)) continue;
      for (const [k, v] of map) if (v.kind === "link" && (v.from === id || v.to === id)) map.delete(k);
      continue;
    }
    if (op.op !== "put") continue;
    const incoming = cleanItem(op.item);
    if (!incoming) throw new UserError("白板的項目格式不正確。");
    const cur = map.get(incoming.id);
    const base = op.base === undefined || op.base === null ? null : cleanItem(op.base);
    if (!cur && base) { skipped.push(incoming.id); continue; } // 別人刪掉了
    if (!cur) {
      if (map.size >= MAX_ITEMS) throw new UserError(`白板最多 ${MAX_ITEMS} 項。`);
      map.set(incoming.id, { ...incoming, author: who, at: now, by: who, updated: now });
      continue;
    }
    const strip = (i: Item | null) => i && Object.fromEntries(Object.entries(i).filter(([k]) => !["author", "at", "by", "updated"].includes(k)));
    const merged = cleanItem({ ...(merge3(strip(base) ?? strip(cur), strip(cur), strip(incoming), "theirs") as object), id: cur.id, kind: cur.kind });
    if (!merged) continue;
    const changed = JSON.stringify(strip(merged)) !== JSON.stringify(strip(cur));
    map.set(cur.id, { ...merged, author: cur.author, at: cur.at, by: changed ? who : cur.by, updated: changed ? now : cur.updated });
  }
  const items = tidy([...map.values()]);
  const changed = JSON.stringify(items) !== JSON.stringify(board.items);
  return { board: { items, by: changed ? who : board.by, at: changed ? now : board.at }, skipped };
}

// 每拖一次就提交一次，版本紀錄會很雜；改成停手一段時間後一起提交。檔案本身是立即寫入的。
const COMMIT_DELAY = Number(process.env.JRI_BOARD_COMMIT_MS ?? 15_000);
const pending = new Map<string, { timer: NodeJS.Timeout; who: Set<string>; count: number }>();

async function commitBoard(ref: string): Promise<void> {
  const p = pending.get(ref);
  if (!p) return;
  pending.delete(ref);
  clearTimeout(p.timer);
  const release = await lock(ref);
  try {
    const dir = dirOf(ref);
    if (!(await git(dir, "status", "--porcelain", "--", BOARD_FILE).catch(() => ""))) return;
    const names = [...p.who];
    await commit(dir, names[names.length - 1] ?? "JRI MBSE", `更新討論白板（${p.count} 處修改${names.length > 1 ? `，${names.join("、")}` : ""}）`.slice(0, 200));
  } finally { release(); }
}

function scheduleCommit(ref: string, who: string): void {
  const p = pending.get(ref) ?? { timer: setTimeout(() => undefined, 0), who: new Set<string>(), count: 0 };
  clearTimeout(p.timer);
  p.who.delete(who); p.who.add(who); p.count++;
  p.timer = setTimeout(() => { void commitBoard(ref).catch((e) => console.error("白板提交失敗", e)); }, COMMIT_DELAY);
  pending.set(ref, p);
}

/** 呼叫端要先拿到這個專案（或分支）的鎖；server/index.ts 對所有寫入請求都會排隊。 */
export async function saveBoard(ref: string, ops: Op[], who: string): Promise<{ board: Board; skipped: string[] }> {
  if (!Array.isArray(ops)) throw new UserError("沒有要儲存的修改。");
  const cur = await readBoard(ref);
  const r = applyOps(cur, ops, who);
  if (r.board.at !== cur.at) {
    await fs.writeFile(path.join(dirOf(ref), BOARD_FILE), JSON.stringify(r.board, null, 1) + "\n", "utf8");
    scheduleCommit(ref, who);
  }
  return r;
}
