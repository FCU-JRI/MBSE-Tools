// 版本畫面（修改 → 送審 → 核准）依賴的 API：分支相對 main 的變更項數、送審中清單。資料皆為合成。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18971, PUB = 18972;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let data: any = t;
  try { data = JSON.parse(t); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-vui-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("三步驟：分支沒改動 = 0 項；改了之後差異列出新增項，main 的送審中清單出現該分支", async () => {
  await call(`${I}/api/projects`, "POST", { id: "vu", name: "版本畫面測試", kind: "annual" });
  execFileSync("git", ["branch", "feature/ui"], { cwd: path.join(home, "projects", "vu") });
  const M = `${I}/api/projects/vu`, B = `${I}/api/projects/vu@feature~ui`;

  assert.equal((await call(B)).data.branch.ahead, 0);
  assert.equal((await call(`${M}/branches/diff?name=feature/ui`)).data.changes.length, 0, "①：還沒改");
  assert.equal((await call(`${M}/branches`)).data.filter((b: any) => b.ahead > 0).length, 0, "main 沒有送審中的分支");

  const r = await call(`${B}/elements`, "POST", { category: "SystemRequirement", name: "合成需求甲", doc: "合成。" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const d = (await call(`${M}/branches/diff?name=feature/ui`)).data;
  assert.ok(d.changes.length >= 1);
  assert.ok(d.changes.some((c: any) => c.type === "added" && c.name === "合成需求甲"));

  const row = (await call(`${M}/branches`)).data.find((b: any) => b.name === "feature/ui");
  assert.equal(row.ahead, 1);
  assert.equal(row.ok, true, "②：檢查通過");
  assert.equal((await call(`${M}/branches`)).data.filter((b: any) => b.ahead > 0).length, 1, "VersionButton 在 main 上的數字");

  assert.equal((await call(`${M}/branches/merge`, "POST", { name: "feature/ui" })).status, 200, "③：合併");
  assert.equal((await call(`${M}/branches`)).data.filter((b: any) => b.ahead > 0).length, 0);
});
