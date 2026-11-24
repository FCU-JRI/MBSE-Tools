// 流程指南（第 3 波 3A）：每步的「要做什麼／怎麼做」文案，與「還缺」的計數。全部是合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { STEPS } from "./process.ts";

const PORT = 18847, PUB = 18848; // 和其他測試檔錯開（api 18787、google 18797、members 18807、closure 18817）
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
let home = "";
let server: ChildProcess;

type Issue = { id: string | null; text: string; count?: { category: string; zh: string; have: number; min: number } };
type Step = { id: string; state: string; ahead: Issue[]; todo: string; how: string[]; categories: string[]; issues: Issue[]; question: string; why: string; nasa: string };
async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json", origin: I }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-guide-"));
  await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ sessionSecret: "synthetic-session-secret-for-tests", publicUrl: P }));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/nonexistent-gh" }, stdio: "ignore" });
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

test("每一步都有「要做什麼」一句話與「怎麼做」步驟；既有欄位保留", () => {
  for (const s of STEPS) {
    assert.ok(s.todo.trim().length > 0, `${s.id} 缺 todo`);
    assert.ok(!/\n/.test(s.todo), `${s.id} 的 todo 應是一句話`);
    assert.ok(s.how.length > 0 && s.how.every((h) => h.trim()), `${s.id} 缺 how`);
    assert.ok(s.question && s.why && s.nasa && s.example && s.categories.length > 0, `${s.id} 既有欄位不可少`);
  }
});

test("流程範本：API 帶指南文案；還缺附計數並即時更新；跳步不再擋", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "gd1", name: "指南合成", kind: "annual", template: "guided" })).status, 200);
  const base = `${I}/api/projects/gd1`;
  let v = (await call(base)).data;
  const step = (id: string) => (v.process as Step[]).find((s) => s.id === id) as Step;
  assert.equal(v.process.length, STEPS.length);
  for (const s of v.process as Step[]) { assert.ok(s.todo); assert.ok(s.how.length > 0); }

  // 第 1 步：利害關係人 0 個（至少 1 個）
  assert.equal(step("stakeholders").state, "current");
  assert.deepEqual(step("stakeholders").issues[0].count, { category: "Stakeholder", zh: "利害關係人", have: 0, min: 1 });
  assert.deepEqual(step("expectations").issues, [], "鎖定的步驟 issues 維持空（伺服器順序檢查用）");
  assert.deepEqual(step("context").ahead.map((i) => i.count?.category), ["System", "ExternalEntity"], "鎖定步驟本身的還缺放在 ahead");

  // 舊順序鎖已拿掉（Mars 2026-11-24）：跳步照常建立；期望不是下一層需求，框架沒有卡點警告。建完刪掉，後面的斷言不受影響
  {
    const j = await call(`${base}/elements`, "POST", { category: "Expectation", name: "跳步的期望" });
    assert.equal(j.status, 200);
    assert.equal(j.data.holdWarning, undefined);
    const e = j.data.analysis.elements.find((x: any) => x.name === "跳步的期望");
    assert.equal((await call(`${base}/elements/delete`, "POST", { id: e.id })).status, 200);
  }

  // 加一位利害關係人：第 1 步完成，第 2 步的還缺改成指向元素
  let r = await call(`${base}/elements`, "POST", { category: "Stakeholder", name: "合成主辦方" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  v = r.data;
  assert.equal(step("stakeholders").state, "done");
  assert.equal(step("stakeholders").issues.length, 0);
  assert.equal(step("expectations").state, "current");
  const stk = v.analysis.elements.find((e: any) => e.name === "合成主辦方");
  assert.ok(step("expectations").issues.some((i) => i.id === stk.id && !i.count));
});

test("範本專案：數量類條件的計數與實際元素數一致", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "gd2", name: "範本合成", kind: "annual", template: "sample" })).status, 200);
  const v = (await call(`${I}/api/projects/gd2`)).data;
  for (const s of v.process as Step[]) {
    assert.ok(s.todo && s.how.length > 0);
    if (s.state !== "locked") assert.deepEqual(s.ahead, []);
    for (const i of [...s.issues, ...s.ahead]) if (i.count) {
      assert.ok(i.count.have < i.count.min, `${s.id}：${i.count.zh} ${i.count.have}/${i.count.min}`);
      assert.ok(s.categories.includes(i.count.category), `${s.id} 的計數類別要屬於這一步`);
    }
  }
});
