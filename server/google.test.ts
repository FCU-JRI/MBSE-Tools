// Google 登入（OIDC）：用假的 Google（本機 HTTP 伺服器 + 測試自己產生的 RSA 金鑰），全部是合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createSign, generateKeyPairSync } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { verifyIdToken } from "./google.ts";

const PORT = 18797, PUB = 18798; // 和 api.test.ts（18787/18788）錯開
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
const CLIENT_ID = "synthetic-client.apps.example.test";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "synthetic-kid-1";
const jwk = { ...publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims: Record<string, unknown>, opts: { key?: typeof privateKey; kid?: string; alg?: string } = {}): string {
  const head = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? KID, typ: "JWT" });
  const body = b64(claims);
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(opts.key ?? privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (nonce: string, extra: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "100000000000000000001", email: "member@example.test", email_verified: true,
  name: "合成成員", iat: now(), exp: now() + 600, nonce, ...extra,
});

// ───────── 假的 Google ─────────
let nextToken: (nonce: string) => string = (n) => idToken(claims(n));
let lastNonce = "";
const tokenCalls: URLSearchParams[] = [];
let google: http.Server;
let G = "";

let home = "";
let server: ChildProcess;

type Res = { status: number; text: string; cookies: string[]; location: string | null };
// /auth 每個來源每分鐘限 30 次；測試登入次數較多，每次登入換一個合成的來源位址
let source = 0;
async function call(url: string, init: { method?: string; body?: unknown; cookie?: string; from?: string } = {}): Promise<Res> {
  const r = await fetch(url, {
    method: init.method ?? "GET", redirect: "manual",
    headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...(init.cookie ? { cookie: init.cookie } : {}), ...(init.from ? { "x-forwarded-for": init.from } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: r.status, text: await r.text(), cookies: r.headers.getSetCookie(), location: r.headers.get("location") };
}
const jar = (cs: string[]) => cs.map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");

/** 走一次完整的 Google 登入，回傳 callback 的回應。 */
async function login(code = "synthetic-code"): Promise<Res> {
  const from = `192.0.2.${++source}`;
  const start = await call(`${P}/auth/google`, { from });
  assert.equal(start.status, 302);
  const to = new URL(start.location ?? "");
  lastNonce = to.searchParams.get("nonce") ?? "";
  return call(`${P}/auth/google/callback?code=${code}&state=${to.searchParams.get("state")}`, { cookie: jar(start.cookies), from });
}

before(async () => {
  google = http.createServer((req, res) => {
    if (req.url === "/certs") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ keys: [jwk] })); }
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const q = new URLSearchParams(raw);
        tokenCalls.push(q);
        res.setHeader("content-type", "application/json");
        if (q.get("code") === "bad-code") { res.statusCode = 400; return res.end(JSON.stringify({ error: "invalid_grant" })); }
        res.end(JSON.stringify({ access_token: "synthetic-access", id_token: nextToken(lastNonce), token_type: "Bearer" }));
      });
      return;
    }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => google.listen(0, "127.0.0.1", r));
  G = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;

  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-google-"));
  await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ sessionSecret: "synthetic-session-secret-for-tests", publicUrl: P, google: { clientId: CLIENT_ID, clientSecret: "synthetic-secret" } }));
  await fs.writeFile(path.join(home, "users.json"), JSON.stringify([
    { email: "member@example.test", name: "合成成員", rank: "C-II", subsystems: [], admin: false },
    { login: "legacy-gh", name: "舊格式成員", rank: "O-V", subsystems: [], admin: false }, // 舊格式：只有 GitHub 帳號
  ]));
  server = spawn(process.execPath, ["server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GOOGLE_AUTH_URL: `${G}/auth`, JRI_GOOGLE_TOKEN_URL: `${G}/token`, JRI_GOOGLE_JWKS_URL: `${G}/certs` },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${P}/api/me`)).ok) return; } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await new Promise<void>((r) => google.close(() => r()));
  await fs.rm(home, { recursive: true, force: true });
});

test("/api/me 告訴網頁 Google 登入已設定，GitHub 沒設定", async () => {
  const me = JSON.parse((await call(`${P}/api/me`)).text);
  assert.equal(me.user, null);
  assert.equal(me.googleLogin, true);
  assert.equal(me.githubLogin, false);
  assert.equal((await call(`${P}/auth/github`)).status, 503);
});

test("登入導向 Google：只要 openid email profile，帶 state、nonce 與公開埠的 callback", async () => {
  const r = await call(`${P}/auth/google`);
  assert.equal(r.status, 302);
  const to = new URL(r.location ?? "");
  assert.equal(`${to.origin}${to.pathname}`, `${G}/auth`);
  assert.equal(to.searchParams.get("scope"), "openid email profile");
  assert.equal(to.searchParams.get("response_type"), "code");
  assert.equal(to.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(to.searchParams.get("redirect_uri"), `${P}/auth/google/callback`);
  assert.match(to.searchParams.get("state") ?? "", /^[0-9a-f]{32}$/);
  assert.match(to.searchParams.get("nonce") ?? "", /^[0-9a-f]{32}$/);
  assert.match(r.cookies.join(";"), /jri_state=.*HttpOnly/);
});

test("名單上的 email 登入成功，取得公開埠的工作階段", async () => {
  nextToken = (n) => idToken(claims(n, { email: "Member@Example.test" })); // 大小寫不同也算同一人
  const r = await login();
  assert.equal(r.status, 302);
  assert.equal(r.location, "/");
  const sent = tokenCalls.at(-1);
  assert.equal(sent?.get("grant_type"), "authorization_code");
  assert.equal(sent?.get("client_secret"), "synthetic-secret");
  assert.equal(sent?.get("redirect_uri"), `${P}/auth/google/callback`);
  const cookie = jar(r.cookies);
  assert.match(cookie, /jri_session=/);
  const me = JSON.parse((await call(`${P}/api/me`, { cookie })).text);
  assert.equal(me.user.kind, "member");
  assert.equal(me.user.name, "合成成員");
  assert.equal(me.user.login, "member@example.test");
  assert.equal((await call(`${P}/api/projects`, { cookie })).status, 200);
});

test("state 不符、授權碼被拒時不登入", async () => {
  const start = await call(`${P}/auth/google`);
  assert.equal((await call(`${P}/auth/google/callback?code=x&state=wrong`, { cookie: jar(start.cookies) })).status, 400);
  assert.equal((await call(`${P}/auth/google/callback?code=x&state=${new URL(start.location ?? "").searchParams.get("state")}`)).status, 400, "沒有 state cookie");
  nextToken = (n) => idToken(claims(n));
  assert.equal((await login("bad-code")).status, 400);
});

test("id_token 驗證：簽章、iss、aud、exp、nonce、email_verified 任一不符都拒絕", async () => {
  const cases: [string, (n: string) => string][] = [
    ["別的金鑰簽的", (n) => idToken(claims(n), { key: other.privateKey })],
    ["發行者不是 Google", (n) => idToken(claims(n, { iss: "https://evil.example.test" }))],
    ["發給別的應用程式", (n) => idToken(claims(n, { aud: "someone-else" }))],
    ["已過期", (n) => idToken(claims(n, { exp: now() - 3600, iat: now() - 7200 }))],
    ["nonce 不符", () => idToken(claims("not-the-nonce"))],
    ["email 未驗證", (n) => idToken(claims(n, { email_verified: false }))],
    ["email_verified 是字串", (n) => idToken(claims(n, { email_verified: "true" }))],
    ["演算法不是 RS256", (n) => idToken(claims(n), { alg: "HS256" })],
  ];
  for (const [why, make] of cases) {
    nextToken = make;
    const r = await login();
    assert.equal(r.status, 400, why);
    assert.doesNotMatch(r.cookies.join(";"), /jri_session=[^;]/, why);
  }
});

test("名單外的人：不給登入，留下加入申請；管理員加入後申請消失，就能登入", async () => {
  nextToken = (n) => idToken(claims(n, { email: "newcomer@example.test", name: "合成新人" }));
  const r = await login();
  assert.equal(r.status, 403);
  assert.match(r.text, /加入申請/);
  assert.doesNotMatch(r.cookies.join(";"), /jri_session=[^;]/);

  // 內部埠的本機管理員看得到申請
  let reqs = JSON.parse((await call(`${I}/api/admin/requests`)).text).requests;
  assert.deepEqual(reqs.map((x: { email: string; name: string }) => [x.email, x.name]), [["newcomer@example.test", "合成新人"]]);
  // 公開埠未登入看不到
  assert.equal((await call(`${P}/api/admin/requests`)).status, 401);
  // 再登入一次不會重複
  await login();
  assert.equal(JSON.parse((await call(`${I}/api/admin/requests`)).text).requests.length, 1);

  const saved = await call(`${I}/api/admin/members`, { method: "POST", body: { email: "Newcomer@example.test", name: "合成新人", rank: "C-III", subsystems: ["結構"] } });
  assert.equal(saved.status, 200);
  reqs = JSON.parse((await call(`${I}/api/admin/requests`)).text).requests;
  assert.equal(reqs.length, 0, "核准後申請自動消失");
  const ok = await login();
  assert.equal(ok.status, 302);
  const me = JSON.parse((await call(`${P}/api/me`, { cookie: jar(ok.cookies) })).text);
  assert.equal(me.user.rank, "C-III");
});

test("忽略申請、移除成員後原本的工作階段失效", async () => {
  nextToken = (n) => idToken(claims(n, { email: "stranger@example.test" }));
  await login();
  const left = JSON.parse((await call(`${I}/api/admin/requests/delete`, { method: "POST", body: { email: "stranger@example.test" } })).text).requests;
  assert.ok(!left.some((x: { email: string }) => x.email === "stranger@example.test"));

  nextToken = (n) => idToken(claims(n, { email: "newcomer@example.test" }));
  const cookie = jar((await login()).cookies);
  assert.equal((await call(`${P}/api/projects`, { cookie })).status, 200);
  await call(`${I}/api/admin/members/delete`, { method: "POST", body: { email: "newcomer@example.test" } });
  assert.equal((await call(`${P}/api/projects`, { cookie })).status, 401);
});

test("成員名單以 email 為主鍵：格式檢查、改 email、舊格式補 email、GitHub 帳號不能重複", async () => {
  const save = (body: unknown) => call(`${I}/api/admin/members`, { method: "POST", body });
  assert.equal((await save({ email: "not-an-email", name: "x", rank: "C-II" })).status, 400);
  assert.equal((await save({ email: "a@example.test", github: "bad name!", name: "x", rank: "C-II" })).status, 400);
  assert.equal((await save({ email: "a@example.test", name: "x", rank: "X-0" })).status, 400);

  // 舊格式的成員可以補上 email（previous 是 GitHub 帳號）
  let list = JSON.parse((await save({ previous: "legacy-gh", email: "legacy@example.test", github: "legacy-gh", name: "舊格式成員", rank: "O-V" })).text).members;
  assert.equal(list.filter((m: { github?: string }) => m.github === "legacy-gh").length, 1);
  assert.ok(list.some((m: { email: string }) => m.email === "legacy@example.test"));
  // 改 email：舊的那筆被換掉，不會變兩筆
  list = JSON.parse((await save({ previous: "legacy@example.test", email: "legacy2@example.test", github: "legacy-gh", name: "舊格式成員", rank: "O-V" })).text).members;
  assert.ok(!list.some((m: { email: string }) => m.email === "legacy@example.test"));
  assert.equal(list.filter((m: { github?: string }) => m.github === "legacy-gh").length, 1);
  // 別人不能用同一個 GitHub 帳號
  assert.equal((await save({ email: "b@example.test", github: "legacy-gh", name: "y", rank: "C-II" })).status, 400);
});

test("verifyIdToken 單元：aud 為陣列時要求 azp；iat 在未來太遠拒絕", async () => {
  const key = async (kid: string) => (kid === KID ? jwk : undefined);
  const ok = await verifyIdToken(idToken(claims("n1")), { clientId: CLIENT_ID, nonce: "n1", key });
  assert.deepEqual(ok, { email: "member@example.test", name: "合成成員", sub: "100000000000000000001" });
  await assert.rejects(verifyIdToken(idToken(claims("n1", { aud: [CLIENT_ID, "x"] })), { clientId: CLIENT_ID, nonce: "n1", key }));
  assert.ok(await verifyIdToken(idToken(claims("n1", { aud: [CLIENT_ID, "x"], azp: CLIENT_ID })), { clientId: CLIENT_ID, nonce: "n1", key }));
  await assert.rejects(verifyIdToken(idToken(claims("n1", { iat: now() + 3600 })), { clientId: CLIENT_ID, nonce: "n1", key }));
  await assert.rejects(verifyIdToken(idToken(claims("n1"), { kid: "unknown" }), { clientId: CLIENT_ID, nonce: "n1", key }));
  await assert.rejects(verifyIdToken("a.b", { clientId: CLIENT_ID, nonce: "n1", key }));
  await assert.rejects(verifyIdToken(idToken(claims("n1")), { clientId: "", nonce: "n1", key }), "沒設定 clientId 一律拒絕");
});
