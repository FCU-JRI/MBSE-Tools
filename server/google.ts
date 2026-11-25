// Google 登入（OpenID Connect，授權碼流程）。
// 只要 openid、email、profile。id_token 驗證簽章（Google 的 JWKS）、iss、aud、exp、nonce 與 email_verified。
// 端點可用環境變數換掉，只給測試用假的 Google；正式環境不要設定。
import { createPublicKey, verify as verifySig } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

export const GOOGLE = {
  authorize: process.env.JRI_GOOGLE_AUTH_URL ?? "https://accounts.google.com/o/oauth2/v2/auth",
  token: process.env.JRI_GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token",
  jwks: process.env.JRI_GOOGLE_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs",
};
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_SEC = 60; // 容許的時鐘誤差

export interface GoogleIdentity { email: string; name: string; sub: string; picture?: string }

export class IdTokenError extends Error {}

type Jwk = JsonWebKey & { kid?: string };
let jwksCache: { keys: Jwk[]; until: number } | null = null;

async function fetchKeys(force: boolean): Promise<Jwk[]> {
  if (!force && jwksCache && jwksCache.until > Date.now()) return jwksCache.keys;
  const r = await fetch(GOOGLE.jwks);
  if (!r.ok) throw new IdTokenError(`無法取得 Google 的公鑰（HTTP ${r.status}）。`);
  const keys = ((await r.json()) as { keys?: Jwk[] }).keys ?? [];
  jwksCache = { keys, until: Date.now() + 3600_000 };
  return keys;
}
/** 找不到 kid 時重抓一次（Google 定期換鑰）。 */
export async function googleKey(kid: string): Promise<Jwk | undefined> {
  return (await fetchKeys(false)).find((k) => k.kid === kid) ?? (await fetchKeys(true)).find((k) => k.kid === kid);
}

const b64json = (s: string): Record<string, unknown> => {
  try { return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>; } catch { throw new IdTokenError("id_token 格式不正確。"); }
};

/** 驗證 id_token，回傳登入者。任何一項不符就丟 IdTokenError。 */
export async function verifyIdToken(idToken: string, opts: { clientId: string; nonce: string; now?: number; key?: (kid: string) => Promise<Jwk | undefined> }): Promise<GoogleIdentity> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new IdTokenError("id_token 格式不正確。");
  const [h, p, s] = parts;
  const header = b64json(h);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new IdTokenError("id_token 的簽章演算法不正確。");
  const jwk = await (opts.key ?? googleKey)(header.kid);
  if (!jwk) throw new IdTokenError("找不到簽署 id_token 的公鑰。");
  const ok = verifySig("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(s, "base64url"));
  if (!ok) throw new IdTokenError("id_token 簽章不符。");

  const c = b64json(p);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof c.iss !== "string" || !ISSUERS.has(c.iss)) throw new IdTokenError("id_token 的發行者不是 Google。");
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!opts.clientId || !aud.includes(opts.clientId)) throw new IdTokenError("id_token 不是發給本站的。");
  if (aud.length > 1 && c.azp !== opts.clientId) throw new IdTokenError("id_token 不是發給本站的。");
  if (typeof c.exp !== "number" || c.exp + SKEW_SEC < now) throw new IdTokenError("id_token 已過期，請重新登入。");
  if (typeof c.iat === "number" && c.iat - SKEW_SEC > now) throw new IdTokenError("id_token 的簽發時間不正確。");
  if (!opts.nonce || c.nonce !== opts.nonce) throw new IdTokenError("登入狀態不符，請重新登入。");
  if (c.email_verified !== true) throw new IdTokenError("這個 Google 帳號的 email 尚未驗證。");
  const email = typeof c.email === "string" ? c.email.trim().toLowerCase() : "";
  if (!email) throw new IdTokenError("無法取得 Google 帳號的 email。");
  return { email, name: typeof c.name === "string" ? c.name.trim().slice(0, 60) : "", sub: String(c.sub ?? ""), ...(typeof c.picture === "string" && c.picture ? { picture: c.picture } : {}) };
}

/** 用授權碼換 id_token（伺服器直接向 Google 要，不經瀏覽器）。 */
export async function exchangeCode(code: string, o: { clientId: string; clientSecret: string; redirectUri: string }): Promise<string> {
  const r = await fetch(GOOGLE.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ code, client_id: o.clientId, client_secret: o.clientSecret, redirect_uri: o.redirectUri, grant_type: "authorization_code" }),
  });
  const body = (await r.json().catch(() => ({}))) as { id_token?: string };
  if (!r.ok || typeof body.id_token !== "string") throw new IdTokenError("Google 沒有核發 id_token，請重新登入。");
  return body.id_token;
}
