// 協作感知（F-38）：誰在線、停在哪個專案的哪一頁、選了哪個元素／哪一列／哪張白板卡片。
// 只放在記憶體：不寫檔、不進專案儲存庫、不推 GitHub；人離開（分頁關閉或 45 秒沒有回報）或伺服器重啟就消失。
// 頭像：登入時記下 Google／GitHub 的大頭照網址（avatars.json，在資料目錄，不進儲存庫）；
// 瀏覽器只向本站要圖（/api/presence/avatar/:key），由伺服器代抓並快取，網頁的 img-src 維持 'self'。
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import type { Express } from "express";
import { HOME_DIR } from "./projects.ts";
import { listMembers } from "./auth.ts";
import type { User } from "./auth.ts";

const AVATARS_FILE = path.join(HOME_DIR, "avatars.json");
const EXPIRE_MS = Number(process.env.JRI_PRESENCE_EXPIRE_MS ?? 45_000); // 測試時縮短
const PING_MS = 25_000;
const MAX_TABS = 500;

/** 每個人的顏色：依身分雜湊，同一人每次一樣。 */
const COLORS = ["#e5484d", "#f76b15", "#ffb224", "#30a46c", "#12a594", "#0090ff", "#3e63dd", "#8e4ec6", "#d6409f", "#978365"];

export interface Spot { project: string; page: string; pageZh: string; detail: string; target: { kind: string; id: string; label: string } | null }
interface Tab { tab: string; key: string; user: User; avatar: string | null; spot: Spot | null; at: number }
export interface Peer { key: string; name: string; role: string; color: string; avatar: boolean; spot: Spot | null; at: number }

const tabs = new Map<string, Tab>();
const streams = new Map<string, { res: Response; user: User; key: string }>();

export const keyOf = (u: User) => createHash("sha256").update(`${u.kind}:${u.login}`).digest("hex").slice(0, 16);
const colorOf = (key: string) => COLORS[parseInt(key.slice(0, 6), 16) % COLORS.length];

// ───────── 頭像網址 ─────────
/** 只接受 Google 與 GitHub 的大頭照主機（Tailscale 的頭像也是這兩家），其他一律不存、不抓。 */
export function safeAvatar(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 1000) return null;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    if (h.endsWith(".googleusercontent.com") || h === "avatars.githubusercontent.com") return u.toString();
  } catch { /* 不是網址 */ }
  return null;
}

async function readAvatars(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(AVATARS_FILE, "utf8")) as Record<string, string>; } catch { return {}; }
}
/** 登入成功時記下頭像。who 是成員名單裡的 email 或 GitHub 帳號（即 User.login）。 */
export async function rememberAvatar(who: string, url: unknown): Promise<void> {
  const safe = safeAvatar(url);
  if (!who || !safe) return;
  const all = await readAvatars();
  if (all[who] === safe) return;
  all[who] = safe;
  await fs.mkdir(HOME_DIR, { recursive: true });
  await fs.writeFile(AVATARS_FILE, JSON.stringify(all, null, 2), { mode: 0o600 });
}
/** 一個身分的頭像來源：Tailscale 標頭（每次請求都有）優先，其次是登入時記下的。 */
async function avatarFor(req: Request, u: User): Promise<string | null> {
  const ts = safeAvatar(req.headers["tailscale-user-profile-pic"]);
  if (ts) return ts;
  if (u.kind !== "member") return null;
  const all = await readAvatars();
  if (all[u.login]) return all[u.login];
  // 成員用另一種方式登入過（Google 記在 email、GitHub 記在帳號）
  const m = (await listMembers()).find((x) => (x.email || x.github) === u.login);
  return (m?.email && all[m.email]) || (m?.github && all[m.github]) || null;
}

// ───────── 在線狀態 ─────────
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
function cleanSpot(s: unknown): Spot | null {
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const project = clip(o.project, 200);
  if (!project) return null;
  const t = o.target as Record<string, unknown> | null | undefined;
  const target = t && typeof t === "object" && clip(t.id, 200) ? { kind: clip(t.kind, 20), id: clip(t.id, 200), label: clip(t.label, 120) } : null;
  return { project, page: clip(o.page, 20), pageZh: clip(o.pageZh, 20), detail: clip(o.detail, 120), target };
}
/** 唯讀連結（審查委員）只看得到同一個專案裡的人；其他身分看得到全部。 */
const visibleTo = (viewer: User) => (t: Tab) => !viewer.project || (t.spot?.project ?? "").split("@")[0] === viewer.project;
const roleOf = (u: User) => (u.kind === "viewer" ? "審查委員（唯讀）" : u.kind === "local" && u.login === "local" ? "本機" : u.rank ?? "");

function peersFor(viewer: User, viewerKey: string): Peer[] {
  const now = Date.now();
  const out: Peer[] = [];
  for (const t of tabs.values()) {
    if (now - t.at > EXPIRE_MS || t.key === viewerKey || !visibleTo(viewer)(t)) continue;
    out.push({ key: t.key, name: t.user.name, role: roleOf(t.user), color: colorOf(t.key), avatar: !!t.avatar, spot: t.spot, at: t.at });
  }
  return out;
}

function broadcast(): void {
  for (const s of streams.values()) s.res.write(`data: ${JSON.stringify({ peers: peersFor(s.user, s.key) })}\n\n`);
}
function sweep(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, t] of tabs) if (now - t.at > EXPIRE_MS) { tabs.delete(id); changed = true; }
  if (changed) broadcast();
}
setInterval(sweep, Math.min(10_000, Math.max(200, EXPIRE_MS / 2))).unref();
setInterval(() => { for (const s of streams.values()) s.res.write(": ping\n\n"); }, PING_MS).unref();

const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** 測試用：目前記憶體裡的分頁數。 */
export const tabCount = () => tabs.size;

export function mount(app: Express): void {
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

  /** 回報自己的位置；回傳其他人。前端在位置改變時與每 15 秒呼叫一次。 */
  app.post("/api/presence", wrap(async (req, res) => {
    const u = req.user as User;
    const tab = String(req.body?.tab ?? "");
    if (!TAB_ID.test(tab)) return res.status(400).json({ error: "分頁代號不正確。" });
    const key = keyOf(u);
    const old = tabs.get(tab);
    if (old && old.key !== key) return res.status(409).json({ error: "分頁代號已被使用。" });
    if (!old && tabs.size >= MAX_TABS) sweep();
    if (!old && tabs.size >= MAX_TABS) return res.status(503).json({ error: "在線人數已滿。" });
    let spot = cleanSpot(req.body?.spot);
    if (spot && u.project && spot.project.split("@")[0] !== u.project) spot = null; // 唯讀連結不能宣稱在別的專案
    tabs.set(tab, { tab, key, user: u, avatar: old?.avatar ?? (await avatarFor(req, u)), spot, at: Date.now() });
    broadcast();
    res.json({ me: key, color: colorOf(key), peers: peersFor(u, key) });
  }));

  /** 離開（分頁關閉時用 sendBeacon 送）。 */
  app.post("/api/presence/leave", (req, res) => {
    const u = req.user as User;
    const tab = String(req.body?.tab ?? "");
    const t = tabs.get(tab);
    if (t && t.key === keyOf(u)) { tabs.delete(tab); broadcast(); }
    res.json({ ok: true });
  });

  /** 即時推送（Server-Sent Events）：有人移動、加入或離開就送一份最新名單。 */
  app.get("/api/presence/stream", (req, res) => {
    const u = req.user as User;
    const tab = String(req.query.tab ?? "");
    if (!TAB_ID.test(tab)) { res.status(400).json({ error: "分頁代號不正確。" }); return; }
    const key = keyOf(u);
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(`retry: 5000\ndata: ${JSON.stringify({ peers: peersFor(u, key) })}\n\n`);
    const id = `${tab}:${Math.random().toString(36).slice(2)}`;
    streams.set(id, { res, user: u, key });
    req.on("close", () => {
      streams.delete(id);
      const t = tabs.get(tab);
      if (t && t.key === key) { tabs.delete(tab); broadcast(); }
    });
  });

  /** 頭像：只給目前在線的人；伺服器代抓並快取一天。 */
  const cache = new Map<string, { type: string; body: Buffer; until: number }>();
  app.get("/api/presence/avatar/:key", wrap(async (req, res) => {
    const key = String(req.params.key);
    let src: string | null = null;
    for (const t of tabs.values()) if (t.key === key && t.avatar) { src = t.avatar; break; }
    if (!src) return res.status(404).end();
    const hit = cache.get(src);
    if (hit && hit.until > Date.now()) return res.type(hit.type).set("cache-control", "private, max-age=3600").send(hit.body);
    const r = await fetch(src, { redirect: "error", signal: AbortSignal.timeout(8000) }).catch(() => null);
    const type = r?.headers.get("content-type") ?? "";
    if (!r || !r.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type.split(";")[0])) return res.status(404).end();
    const body = Buffer.from(await r.arrayBuffer());
    if (body.length > 512 * 1024) return res.status(404).end();
    if (cache.size > 300) cache.clear();
    cache.set(src, { type: type.split(";")[0], body, until: Date.now() + 86400_000 });
    res.type(type.split(";")[0]).set("cache-control", "private, max-age=3600").send(body);
  }));
}
