// 協作感知（F-38）：全部是合成身分與合成專案代號。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18987, PUB = 18988; // 和其他測試錯開
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
const EXPIRE = 1500;
const SHARE_TOKEN = "synthetic-share-token-for-presence-test";
let home = "";
let server: ChildProcess;

type Peer = { key: string; name: string; color: string; avatar: boolean; spot: { project: string; page: string; target: { id: string } | null } | null };
type Who = { base: string; headers: Record<string, string> };
const A: Who = { base: I, headers: { "x-author": encodeURIComponent("合成甲") } }; // 本機
const B: Who = { base: I, headers: { "x-forwarded-for": "100.64.0.2", "tailscale-user-login": "synth-b@example.test", "tailscale-user-name": "SynthB", "tailscale-user-profile-pic": "https://lh3.googleusercontent.com/a/synthetic-b" } };
let V: Who; // 唯讀連結（proj-a）

const spot = (project: string, target: string | null = null) => ({ project, page: "model", pageZh: "模型", detail: "bdd", target: target ? { kind: "element", id: target, label: target } : null });
async function report(w: Who, tab: string, s: unknown): Promise<{ status: number; body: { me?: string; peers?: Peer[]; error?: string } }> {
  const r = await fetch(`${w.base}/api/presence`, { method: "POST", headers: { ...w.headers, "content-type": "application/json" }, body: JSON.stringify({ tab, spot: s }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-presence-"));
  await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ sessionSecret: "synthetic-session-secret-for-tests", publicUrl: P, tailscaleAdmins: ["synth-b@example.test"] }));
  await fs.writeFile(path.join(home, "users.json"), "[]");
  await fs.writeFile(path.join(home, "shares.json"), JSON.stringify([{ id: "s1", hash: createHash("sha256").update(SHARE_TOKEN).digest("hex"), project: "proj-a", label: "合成委員", createdBy: "test", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() }]));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_PRESENCE_EXPIRE_MS: String(EXPIRE) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const r = await fetch(`${P}/s/${SHARE_TOKEN}`, { redirect: "manual" });
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  assert.match(cookie, /^jri_share=/, "唯讀連結要換到 cookie");
  V = { base: P, headers: { cookie } };
});
after(async () => {
  server?.kill();
  await fs.rm(home, { recursive: true, force: true });
});

test("F-38 兩個人互相看得到位置，看不到自己", async () => {
  const a = await report(A, "tab-aaaaaaaa", spot("proj-a", "elem-1"));
  assert.equal(a.status, 200);
  const b = await report(B, "tab-bbbbbbbb", spot("proj-b", "elem-2"));
  assert.equal(b.status, 200);
  assert.equal(b.body.peers!.length, 1);
  const seenByB = b.body.peers![0];
  assert.equal(seenByB.name, "合成甲");
  assert.equal(seenByB.spot!.target!.id, "elem-1");
  assert.equal(seenByB.avatar, false, "本機沒有頭像，前端用縮寫");
  const a2 = await report(A, "tab-aaaaaaaa", spot("proj-a", "elem-1"));
  const seenByA = a2.body.peers!.find((p) => p.name === "SynthB")!;
  assert.ok(seenByA, "A 看得到 B");
  assert.equal(seenByA.avatar, true, "Tailscale 帶來的頭像");
  assert.match(seenByA.color, /^#[0-9a-f]{6}$/);
  assert.ok(!a2.body.peers!.some((p) => p.key === a2.body.me), "看不到自己");
});

test("F-38 即時推送：對方移動時 SSE 立刻送新位置", async () => {
  const ctl = new AbortController();
  const r = await fetch(`${I}/api/presence/stream?tab=tab-aaaaaaaa`, { headers: A.headers, signal: ctl.signal });
  assert.equal(r.headers.get("content-type")?.split(";")[0], "text/event-stream");
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const wait = (pred: (peers: Peer[]) => boolean) => (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("推送提早結束");
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (line && pred((JSON.parse(line.slice(6)) as { peers: Peer[] }).peers)) return;
      }
    }
  })();
  const moved = wait((peers) => peers.some((p) => p.name === "SynthB" && p.spot?.target?.id === "elem-9"));
  await report(B, "tab-bbbbbbbb", spot("proj-b", "elem-9"));
  await Promise.race([moved, new Promise((_, rej) => setTimeout(() => rej(new Error("2 秒內沒收到推送")), 2000))]);
  ctl.abort();
});

test("F-38 唯讀連結只看得到同一個專案的人，也不能宣稱在別的專案", async () => {
  await report(A, "tab-aaaaaaaa", spot("proj-a", "elem-1"));
  await report(B, "tab-bbbbbbbb", spot("proj-b", "elem-2"));
  const v = await report(V, "tab-vvvvvvvv", spot("proj-a"));
  assert.equal(v.status, 200);
  const names = v.body.peers!.map((p) => p.name);
  assert.ok(names.includes("合成甲"), "同專案看得到");
  assert.ok(!names.includes("SynthB"), "別的專案看不到");
  await report(V, "tab-vvvvvvvv", spot("proj-b", "elem-2"));
  const b = await report(B, "tab-bbbbbbbb", spot("proj-b", "elem-2"));
  const vSeen = b.body.peers!.find((p) => p.name === "合成委員");
  assert.ok(vSeen, "委員本身仍算在線");
  assert.equal(vSeen!.spot, null, "宣稱在別的專案時位置被清掉");
});

test("F-38 離開或逾時就消失；只放記憶體，不寫檔", async () => {
  await report(A, "tab-aaaaaaaa", spot("proj-a"));
  await fetch(`${I}/api/presence/leave`, { method: "POST", headers: { ...A.headers, "content-type": "application/json" }, body: JSON.stringify({ tab: "tab-aaaaaaaa" }) });
  let b = await report(B, "tab-bbbbbbbb", spot("proj-b"));
  assert.ok(!b.body.peers!.some((p) => p.name === "合成甲"), "離開後消失");
  await report(A, "tab-aaaaaaaa", spot("proj-a"));
  await new Promise((r) => setTimeout(r, EXPIRE + 800));
  b = await report(B, "tab-bbbbbbbb", spot("proj-b"));
  assert.ok(!b.body.peers!.some((p) => p.name === "合成甲"), "逾時後消失");
  const files = await fs.readdir(home);
  assert.ok(!files.some((f) => /presence/i.test(f)), `資料目錄不該有在線紀錄：${files.join(", ")}`);
});

test("F-38 未登入拿不到在線名單；分頁代號與頭像要合法", async () => {
  assert.equal((await report({ base: P, headers: {} }, "tab-xxxxxxxx", spot("proj-a"))).status, 401);
  assert.equal((await fetch(`${P}/api/presence/stream?tab=tab-xxxxxxxx`)).status, 401);
  assert.equal((await fetch(`${P}/api/presence/avatar/0123456789abcdef`)).status, 401);
  assert.equal((await report(A, "bad tab!", spot("proj-a"))).status, 400);
  // 別人的分頁代號不能拿來用
  await report(B, "tab-bbbbbbbb", spot("proj-b"));
  assert.equal((await report(A, "tab-bbbbbbbb", spot("proj-a"))).status, 409);
  assert.equal((await fetch(`${I}/api/presence/avatar/0123456789abcdef`, { headers: A.headers })).status, 404, "不在線的人沒有頭像");
});

test("F-38 頭像只接受 Google 與 GitHub 的 https 網址", async () => {
  const { safeAvatar } = await import("./presence.ts");
  assert.ok(safeAvatar("https://lh3.googleusercontent.com/a/x=s96-c"));
  assert.ok(safeAvatar("https://avatars.githubusercontent.com/u/1?v=4"));
  for (const bad of ["http://lh3.googleusercontent.com/a/x", "https://evil.example/a.png", "https://googleusercontent.com.evil.example/a", "https://u:p@avatars.githubusercontent.com/u/1", "https://avatars.githubusercontent.com:444/u/1", "javascript:alert(1)", 42])
    assert.equal(safeAvatar(bad), null, String(bad));
});
