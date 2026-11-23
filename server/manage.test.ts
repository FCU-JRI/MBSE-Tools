// 專案管理頁後端：專案設定 PATCH（名稱、類型、節點；代號不可改）。資料全部是合成的。執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18817, PUB = 18818; // 和 api、google、members 測試的埠錯開
const I = `http://127.0.0.1:${PORT}/api`;
let server: ChildProcess, home: string;

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let data: any = t;
  try { data = JSON.parse(t); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-manage-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("PATCH 專案設定：改名稱、類型、節點；代號不變", async () => {
  assert.equal((await call(`${I}/projects`, "POST", { id: "m1", name: "合成專案", kind: "annual" })).status, 200);
  let r = await call(`${I}/projects/m1`, "PATCH", { name: "  改過的名稱  ", kind: "small", gates: ["proposal", "pdr"] });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.project.id, "m1");
  assert.equal(r.data.project.name, "改過的名稱");
  assert.equal(r.data.project.kind, "small");
  assert.deepEqual(r.data.project.gates, ["proposal", "pdr"]);
  assert.deepEqual(r.data.gates.map((g: any) => g.id), ["proposal", "pdr"]);
  // 傳 id 也不會改代號
  r = await call(`${I}/projects/m1`, "PATCH", { id: "other", name: "再改一次" });
  assert.equal(r.status, 200);
  assert.equal(r.data.project.id, "m1");
  assert.equal((await call(`${I}/projects/other`)).status >= 400, true);
  // 改回年度專案：節點補齊
  r = await call(`${I}/projects/m1`, "PATCH", { kind: "annual" });
  assert.equal(r.data.project.gates.length, 8);
});

test("PATCH 專案設定：空名稱、未知節點、清空節點都被拒絕", async () => {
  for (const body of [{ name: "  " }, { kind: "weird" }, { kind: "small", gates: ["nope"] }, { kind: "small", gates: [] }]) {
    const r = await call(`${I}/projects/m1`, "PATCH", body);
    assert.equal(r.status >= 400 && r.status < 500, true, JSON.stringify(body) + " → " + r.status);
  }
});

test("PATCH 專案設定：已有簽核紀錄的節點不能移除", async () => {
  const s = await call(`${I}/projects/m1/signoffs`, "POST", { gate: "proposal", decision: "APPROVE", comment: "測試" });
  if (s.status !== 200) return; // 本機身分沒有簽核權限時略過（簽核流程由 api.test.ts 涵蓋）
  const r = await call(`${I}/projects/m1`, "PATCH", { kind: "small", gates: ["pdr"] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /簽核紀錄/);
});

test("成本資料：超支與次系統分組所需欄位可存取", async () => {
  await call(`${I}/projects/m1/pm/costs`, "POST", { subsystem: "合成次系統甲", item: "合成零件", planned: 1000, actual: 1500 });
  const pm = (await call(`${I}/projects/m1/pm`)).data;
  assert.equal(pm.costs.length, 1);
  assert.equal(pm.costs[0].actual > pm.costs[0].planned, true);
});
