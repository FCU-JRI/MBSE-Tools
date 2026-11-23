// 批次加入成員（F-20a）：全部是合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18807, PUB = 18808; // 和 api.test.ts、google.test.ts 錯開
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
let home = "";
let server: ChildProcess;

type Row = { line: number; status: string; reason?: string; member?: { email: string; name: string; rank: string; subsystems: string[]; github?: string; admin: boolean } };
type Batch = { rows: Row[]; added: number; members: { email: string; github?: string; rank: string; admin: boolean }[] };
async function batch(text: string, rank = "C-II", dryRun = true, base = I): Promise<{ status: number; body: Batch & { error?: string } }> {
  const r = await fetch(`${base}/api/admin/members/batch`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ text, rank, dryRun }) });
  return { status: r.status, body: await r.json() };
}
const users = async () => JSON.parse(await fs.readFile(path.join(home, "users.json"), "utf8")) as { email?: string; login?: string; rank: string; admin: boolean }[];

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-members-"));
  await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ sessionSecret: "synthetic-session-secret-for-tests", publicUrl: P }));
  await fs.writeFile(path.join(home, "users.json"), JSON.stringify([
    { email: "existing@example.test", name: "既有成員", rank: "O-V", subsystems: ["結構"], admin: false },
    { login: "legacy-gh", name: "舊格式成員", rank: "C-III", subsystems: [], admin: false },
  ]));
  await fs.writeFile(path.join(home, "requests.json"), JSON.stringify([{ email: "applicant@example.test", name: "申請者", requestedAt: "2026-11-01T00:00:00.000Z" }]));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await fs.rm(home, { recursive: true, force: true });
});

test("F-20a 預覽：逐行回報，不寫入", async () => {
  const before = await fs.readFile(path.join(home, "users.json"), "utf8");
  const text = [
    "# 註解行會略過",
    "New1@Example.test, 合成甲, C-III, 結構、航電, Synth-One",
    "new2@example.test\t合成乙\t組員\t\t", // Tab 分隔；「組員」對到兩個職級
    "new3@example.test",
    "existing@example.test, 改名, C-II",
    "not-an-email, 錯",
    "new4@example.test, 合成丁, D-VII",
    "new1@example.test, 重複",
    "",
  ].join("\n");
  const r = await batch(text);
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.rows.map((x) => [x.line, x]));
  assert.equal(r.body.rows.length, 7, "空行與註解行不算");
  assert.equal(by[2].status, "add");
  assert.deepEqual({ ...by[2].member, admin: by[2].member?.admin }, { email: "new1@example.test", github: "synth-one", name: "合成甲", rank: "C-III", subsystems: ["結構", "航電"], admin: false });
  assert.equal(by[3].status, "error", "中文職級對到不只一個就要寫代號");
  assert.equal(by[4].status, "add");
  assert.equal(by[4].member?.rank, "C-II", "職級空白用預設");
  assert.equal(by[4].member?.name, "new3", "姓名空白用 email 前段");
  assert.equal(by[5].status, "exists", "已在名單的人不改");
  assert.equal(by[6].status, "error");
  assert.equal(by[7].status, "error", "總工程師以上不能批次加入");
  assert.equal(by[8].status, "error", "同一批 email 重複");
  assert.equal(r.body.added, 0);
  assert.equal(await fs.readFile(path.join(home, "users.json"), "utf8"), before, "預覽不寫入");
});

test("F-20a 有錯的行就整批不寫入", async () => {
  const before = await fs.readFile(path.join(home, "users.json"), "utf8");
  const r = await batch("ok@example.test\nbad-line", "C-II", false);
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 0);
  assert.equal(await fs.readFile(path.join(home, "users.json"), "utf8"), before);
});

test("F-20a 加入：寫入新成員、保留舊資料、清掉對應的加入申請", async () => {
  const r = await batch("applicant@example.test, 申請者, C-III\nfresh@example.test, 合成新人, , 推進\nexisting@example.test, 改名, C-II", "O-IV", false);
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 2);
  const all = await users();
  assert.equal(all.length, 4);
  const fresh = all.find((u) => u.email === "fresh@example.test");
  assert.equal(fresh?.rank, "O-IV");
  assert.equal(fresh?.admin, false);
  const existing = all.find((u) => u.email === "existing@example.test") as { name?: string; rank: string };
  assert.deepEqual([existing.name, existing.rank], ["既有成員", "O-V"], "既有成員沒有被改");
  assert.ok(all.some((u) => (u as { github?: string }).github === "legacy-gh"), "舊格式成員還在");
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, "requests.json"), "utf8")), [], "已加入的人的申請被清掉");
});

test("F-20a GitHub 帳號已屬於別人、預設職級過高、超過行數上限都拒絕", async () => {
  const taken = await batch("other@example.test, 他人, C-II, , legacy-gh");
  assert.equal(taken.body.rows[0].status, "error");
  assert.equal((await batch("a@example.test", "D-VII")).status, 400);
  assert.equal((await batch(Array.from({ length: 201 }, (_, i) => `u${i}@example.test`).join("\n"))).status, 400);
  assert.equal((await batch("   \n# 只有註解")).status, 400);
});

test("F-20a 公開埠沒有登入不能用", async () => {
  const r = await batch("x@example.test", "C-II", false, P);
  assert.ok(r.status === 401 || r.status === 403, `狀態 ${r.status}`);
  assert.ok(!(await users()).some((u) => u.email === "x@example.test"));
});
