// 身分與權限。
// 兩個連接埠：內部埠（本機與 Tailscale 私人網路）與公開埠（Funnel）。
// 公開埠一律要 GitHub 登入或唯讀連結，不信任任何代理標頭。
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.resolve(process.env.JRI_HOME ?? path.join(ROOT, "data"));
const CONFIG_FILE = path.join(DATA, "config.json");
const USERS_FILE = path.join(DATA, "users.json");
const SHARES_FILE = path.join(DATA, "shares.json");

export const INTERNAL_PORT = Number(process.env.PORT ?? 8787);
export const PUBLIC_PORT = Number(process.env.PUBLIC_PORT ?? 8788);

/** AEAS 職級（AEAS-EXB-REG-1001 Table 1）。 */
export const RANKS = ["F-VIII", "R-VIII", "D-VII", "O-VI", "O-V", "O-IV", "C-III", "C-II"] as const;
export type Rank = (typeof RANKS)[number];
export const RANK_ZH: Record<Rank, string> = {
  "F-VIII": "指導老師", "R-VIII": "管制官", "D-VII": "總工程師", "O-VI": "營運長", "O-V": "責任工程師", "O-IV": "核心成員", "C-III": "組員", "C-II": "組員",
};
const LEVEL: Record<Rank, number> = { "F-VIII": 8, "R-VIII": 8, "D-VII": 7, "O-VI": 6, "O-V": 5, "O-IV": 4, "C-III": 3, "C-II": 2 };

export interface Member {
  login: string; // GitHub 帳號（小寫）
  name: string;
  rank: Rank;
  subsystems: string[];
  admin: boolean;
  tailscale?: string; // Tailscale 登入名稱，私人網路內免登入
}

export interface Share { id: string; hash: string; project: string; label: string; createdBy: string; createdAt: string; expiresAt: string }

export interface Config {
  sessionSecret: string;
  publicUrl: string; // 公開網址，例如 https://jri-mbse.xxx.ts.net:8443
  github: { clientId: string; clientSecret: string };
  tailscaleAdmins: string[]; // 這些 Tailscale 登入視為管理員
}

export interface User {
  kind: "local" | "member" | "viewer";
  login: string;
  name: string;
  rank: Rank | null;
  subsystems: string[];
  admin: boolean;
  project: string | null; // 唯讀連結限定的專案
}

declare module "express-serve-static-core" {
  interface Request { user?: User; isPublic?: boolean }
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, "utf8")) as T; } catch { return fallback; }
}
async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(DATA, { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

let config: Config | undefined;
export async function getConfig(): Promise<Config> {
  if (config) return config;
  const c = await readJson<Partial<Config>>(CONFIG_FILE, {});
  config = {
    sessionSecret: c.sessionSecret || randomBytes(32).toString("hex"),
    publicUrl: c.publicUrl ?? "",
    github: { clientId: c.github?.clientId ?? "", clientSecret: c.github?.clientSecret ?? "" },
    tailscaleAdmins: c.tailscaleAdmins ?? [],
  };
  if (!c.sessionSecret) await writeJson(CONFIG_FILE, config);
  return config;
}
export async function updateConfig(patch: { publicUrl?: string; clientId?: string; clientSecret?: string }): Promise<void> {
  const c = await getConfig();
  if (typeof patch.publicUrl === "string") c.publicUrl = patch.publicUrl.trim().replace(/\/+$/, "");
  if (typeof patch.clientId === "string") c.github.clientId = patch.clientId.trim();
  if (typeof patch.clientSecret === "string" && patch.clientSecret.trim()) c.github.clientSecret = patch.clientSecret.trim();
  await writeJson(CONFIG_FILE, c);
}

export const listMembers = () => readJson<Member[]>(USERS_FILE, []);
export async function saveMember(m: Member): Promise<Member[]> {
  const login = m.login.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(login)) throw new AuthError(400, "GitHub 帳號格式不正確。");
  if (!RANKS.includes(m.rank)) throw new AuthError(400, "職級不正確。");
  const all = (await listMembers()).filter((x) => x.login !== login);
  all.push({ login, name: m.name.trim() || login, rank: m.rank, subsystems: (m.subsystems ?? []).map((s) => s.trim()).filter(Boolean), admin: m.admin === true, tailscale: m.tailscale?.trim() || undefined });
  all.sort((a, b) => LEVEL[b.rank] - LEVEL[a.rank] || a.login.localeCompare(b.login));
  await writeJson(USERS_FILE, all);
  return all;
}
export async function removeMember(login: string): Promise<Member[]> {
  const all = (await listMembers()).filter((x) => x.login !== login.toLowerCase());
  await writeJson(USERS_FILE, all);
  return all;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export async function listShares(): Promise<Omit<Share, "hash">[]> {
  return (await readJson<Share[]>(SHARES_FILE, [])).map(({ hash: _h, ...s }) => s);
}
/** 建立唯讀連結。權杖只在這時回傳一次，檔案裡只存雜湊。 */
export async function createShare(project: string, label: string, days: number, by: string): Promise<{ token: string; share: Omit<Share, "hash"> }> {
  const d = Math.min(Math.max(Math.round(days) || 14, 1), 180);
  const token = randomBytes(24).toString("base64url");
  const share: Share = { id: randomBytes(6).toString("hex"), hash: sha(token), project, label: label.trim().slice(0, 80), createdBy: by, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + d * 86400_000).toISOString() };
  await writeJson(SHARES_FILE, [...(await readJson<Share[]>(SHARES_FILE, [])), share]);
  const { hash: _h, ...rest } = share;
  return { token, share: rest };
}
export async function revokeShare(id: string): Promise<void> {
  await writeJson(SHARES_FILE, (await readJson<Share[]>(SHARES_FILE, [])).filter((s) => s.id !== id));
}
async function shareFor(token: string): Promise<Share | undefined> {
  const h = sha(token);
  return (await readJson<Share[]>(SHARES_FILE, [])).find((s) => s.hash === h && new Date(s.expiresAt).getTime() > Date.now());
}

// ───────── 工作階段：簽章的 cookie，不存伺服器狀態 ─────────

function sign(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}
function verify<T>(value: string | undefined, secret: string): T | null {
  if (!value) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expect = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expect.length || !timingSafeEqual(got, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    return typeof p.exp === "number" && p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res: Response, name: string, value: string, maxAgeSec: number, secure: boolean): void {
  res.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`);
}

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Tailscale 會把非 ASCII 的名字用 RFC 2047 編碼（=?UTF-8?Q?...?= 或 ?B?）放進標頭，這裡還原。 */
export function decodeHeader(v: string): string {
  try {
    // 相鄰的編碼段之間的空白依規範要去掉
    return v.replace(/\?=\s+=\?/g, "?==?").replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_m, _charset: string, enc: string, text: string) => {
      if (enc.toUpperCase() === "B") return Buffer.from(text, "base64").toString("utf8");
      const bytes: number[] = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "_") bytes.push(0x20);
        else if (text[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
        else bytes.push(text.charCodeAt(i) & 0xff);
      }
      return Buffer.from(bytes).toString("utf8");
    }).trim().slice(0, 60);
  } catch { return v.slice(0, 60); }
}

const memberUser = (m: Member): User => ({ kind: "member", login: m.login, name: m.name, rank: m.rank, subsystems: m.subsystems, admin: m.admin || LEVEL[m.rank] >= 7, project: null });

async function identify(req: Request): Promise<User | null> {
  const c = await getConfig();
  const ck = cookies(req);
  const members = await listMembers();
  req.isPublic = req.socket.localPort === PUBLIC_PORT;

  if (!req.isPublic) {
    // 內部埠。沒有經過代理（無 X-Forwarded-For）就是這台電腦本機。
    if (!req.headers["x-forwarded-for"]) {
      const name = decodeURIComponent(String(req.headers["x-author"] ?? "")).slice(0, 60) || "本機管理員";
      return { kind: "local", login: "local", name, rank: "D-VII", subsystems: [], admin: true, project: null };
    }
    // 經 Tailscale Serve：標頭由 Tailscale 填入登入者
    const ts = String(req.headers["tailscale-user-login"] ?? "").toLowerCase();
    if (ts) {
      const m = members.find((x) => x.tailscale?.toLowerCase() === ts);
      if (m) return memberUser(m);
      if (c.tailscaleAdmins.map((x) => x.toLowerCase()).includes(ts)) {
        return { kind: "local", login: ts, name: decodeHeader(String(req.headers["tailscale-user-name"] ?? "")) || ts, rank: "D-VII", subsystems: [], admin: true, project: null };
      }
    }
  }

  const session = verify<{ login: string }>(ck.jri_session, c.sessionSecret);
  if (session) {
    const m = members.find((x) => x.login === session.login);
    if (m) return memberUser(m);
  }
  const shared = verify<{ token: string }>(ck.jri_share, c.sessionSecret);
  if (shared) {
    const s = await shareFor(shared.token);
    if (s) return { kind: "viewer", login: `share:${s.id}`, name: s.label || "審查委員", rank: null, subsystems: [], admin: false, project: s.project };
  }
  return null;
}

/** 掛在 /api 之前：辨識身分。未登入者只能呼叫 /api/me。 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  identify(req).then((u) => {
    req.user = u ?? undefined;
    if (!u && req.path !== "/me") { res.status(401).json({ error: "請先登入。" }); return; }
    // 寫入請求必須來自本站頁面，防止其他網站代發請求
    if (req.method !== "GET" && req.method !== "HEAD") {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) { res.status(403).json({ error: "來源不符。" }); return; }
    }
    next();
  }).catch(next);
}

export const levelOf = (u: User): number => (u.rank ? LEVEL[u.rank] : 0);

export const can = {
  edit: (u: User) => u.kind !== "viewer",
  createProject: (u: User) => u.admin,
  confirm: (u: User) => u.rank !== null && LEVEL[u.rank] >= 5,
  merge: (u: User) => u.rank !== null && LEVEL[u.rank] >= 5,
  admin: (u: User) => u.admin,
  /** 簽核權限依 AEAS Table 3。 */
  signoff(u: User, gate: string, highPower: boolean, subsystem: string | null): boolean {
    if (!u.rank) return false;
    const advisor = u.rank === "F-VIII" || u.rank === "R-VIII";
    if (gate === "trr" || gate === "frr") return highPower ? u.rank === "F-VIII" : advisor;
    if (gate === "proposal" || gate === "closeout") return advisor || u.rank === "D-VII";
    if (gate === "pdr" && subsystem && u.rank === "D-VII") return true; // 次系統整合：總工程師
    return advisor;
  },
};

export function describe(u: User) {
  return {
    kind: u.kind, login: u.login, name: u.name, rank: u.rank, rankZh: u.rank ? RANK_ZH[u.rank] : "審查委員（唯讀）", subsystems: u.subsystems, project: u.project,
    caps: { edit: can.edit(u), createProject: can.createProject(u), confirm: can.confirm(u), merge: can.merge(u), admin: can.admin(u) },
  };
}

/** 專案層級的檢查：唯讀連結只能看指定專案，且不能寫入。 */
export function projectGuard(req: Request, res: Response, next: NextFunction): void {
  const u = req.user as User;
  if (u.project && u.project !== req.params.id) { res.status(403).json({ error: "這個連結不能開啟此專案。" }); return; }
  const readOnlyPost = req.method === "POST" && /\/validate$/.test(req.path);
  if (req.method !== "GET" && !readOnlyPost && !can.edit(u)) { res.status(403).json({ error: "唯讀連結不能修改內容。" }); return; }
  next();
}

export function need(check: (u: User) => boolean, message: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!check(req.user as User)) { res.status(403).json({ error: message }); return; }
    next();
  };
}

// ───────── 路由：GitHub 登入與唯讀連結 ─────────

export function mountAuthRoutes(app: import("express").Express): void {
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const isSecure = (req: Request) => req.socket.localPort === PUBLIC_PORT || !!req.headers["x-forwarded-for"];

  app.get("/auth/github", wrap(async (req, res) => {
    const c = await getConfig();
    if (!c.github.clientId || !c.publicUrl) return res.status(503).send("尚未設定 GitHub 登入。請管理員到「管理」頁設定。");
    const state = randomBytes(16).toString("hex");
    setCookie(res, "jri_state", sign({ state, exp: Date.now() + 600_000 }, c.sessionSecret), 600, isSecure(req));
    const q = new URLSearchParams({ client_id: c.github.clientId, redirect_uri: `${c.publicUrl}/auth/github/callback`, scope: "read:user", state });
    res.redirect(`https://github.com/login/oauth/authorize?${q}`);
  }));

  app.get("/auth/github/callback", wrap(async (req, res) => {
    const c = await getConfig();
    const saved = verify<{ state: string }>(cookies(req).jri_state, c.sessionSecret);
    if (!saved || saved.state !== req.query.state || typeof req.query.code !== "string") return res.status(400).send("登入逾時或狀態不符，請重新登入。");
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST", headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: c.github.clientId, client_secret: c.github.clientSecret, code: req.query.code, redirect_uri: `${c.publicUrl}/auth/github/callback` }),
    });
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) return res.status(400).send("GitHub 沒有核發權杖，請重新登入。");
    const me = (await (await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${token.access_token}`, "user-agent": "jri-mbse", accept: "application/vnd.github+json" } })).json()) as { login?: string };
    const login = String(me.login ?? "").toLowerCase();
    if (!login) return res.status(400).send("無法取得 GitHub 帳號。");
    if (!(await listMembers()).some((m) => m.login === login)) {
      return res.status(403).send(`GitHub 帳號 ${login} 還不在成員名單中。請把這個帳號告訴總工程師，由他加入後再登入。`);
    }
    setCookie(res, "jri_session", sign({ login, exp: Date.now() + 30 * 86400_000 }, c.sessionSecret), 30 * 86400, isSecure(req));
    setCookie(res, "jri_state", "", 0, isSecure(req));
    res.redirect("/");
  }));

  app.post("/auth/logout", (req, res) => {
    setCookie(res, "jri_session", "", 0, isSecure(req));
    setCookie(res, "jri_share", "", 0, isSecure(req));
    res.json({ ok: true });
  });

  // 唯讀連結：換成 cookie 後導向專案，網址列不再留權杖
  app.get("/s/:token", wrap(async (req, res) => {
    const c = await getConfig();
    const s = await shareFor(String(req.params.token));
    if (!s) return res.status(404).send("這個連結無效或已過期。");
    const left = Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 1000);
    setCookie(res, "jri_share", sign({ token: String(req.params.token), exp: new Date(s.expiresAt).getTime() }, c.sessionSecret), left, isSecure(req));
    res.setHeader("Referrer-Policy", "no-referrer");
    res.redirect(`/?p=${encodeURIComponent(s.project)}`);
  }));
}
