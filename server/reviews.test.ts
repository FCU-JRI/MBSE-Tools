// 送審與預跑（VER-08、ANA-12、VER-04、AI-02）：送審、撤回、留言、核准者、合併紀錄。資料皆為合成。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18977, PUB = 18978;
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
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-rev-"));
  process.env.JRI_HOME = home;
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

test("送審：開分支 → 改 → 送審（預跑）→ 留言 → 撤回 → 再送審 → 核准合併留紀錄", async () => {
  await call(`${I}/api/projects`, "POST", { id: "rv", name: "送審測試", kind: "annual", template: "sample" });
  const M = `${I}/api/projects/rv`, B = `${I}/api/projects/rv@feat~a`;
  await call(`${M}/branches/update`, "POST", {}).catch(() => 0);
  // 開分支：建立分支後在分支上改
  const { execFileSync } = await import("node:child_process");
  execFileSync("git", ["branch", "feat/a"], { cwd: path.join(home, "projects", "rv") });
  assert.equal((await call(B)).status, 200);

  assert.equal((await call(`${M}/reviews/one?branch=feat/a`)).data.review.status, "withdrawn", "沒送審＝未送審");
  const e = await call(`${B}/elements`, "POST", { category: "SystemRequirement", name: "合成需求乙", doc: "合成。" });
  assert.equal(e.status, 200, JSON.stringify(e.data).slice(0, 200));

  assert.equal((await call(`${M}/reviews/submit`, "POST", { branch: "feat/a", note: "合成送審說明" })).status, 200);
  let one = (await call(`${M}/reviews/one?branch=feat/a`)).data;
  assert.equal(one.review.status, "submitted");
  assert.equal(one.review.submitted.note, "合成送審說明");
  const p = one.review.prerun;
  assert.ok(p && p.verdicts && p.conflicts && p.framework && p.budget && p.sim, "預跑五項都有");
  assert.equal(p.changes.added >= 1, true);
  assert.equal(p.sim.ran, false, "測試環境沒有 RocketPy，標未跑");
  assert.match(p.sim.note, /未跑/);
  assert.ok((await call(`${M}/reviews`)).data.some((r: any) => r.branch === "feat/a" && r.status === "submitted"), "main 看得到送審中");
  const file = await fs.readFile(path.join(home, "branches", "rv", "feat~a", "reviews", "feat~a.json"), "utf8");
  assert.match(file, /合成送審說明/, "紀錄存在分支的儲存庫");
  assert.equal((await call(`${M}/reviews/submit`, "POST", { branch: "feat/a" })).status, 400, "重複送審被擋");

  assert.equal((await call(`${M}/reviews/comment`, "POST", { branch: "feat/a", kind: "return", text: "請補驗證" })).status, 200);
  one = (await call(`${M}/reviews/one?branch=feat/a`)).data;
  assert.equal(one.review.status, "returned");
  assert.equal(one.review.comments[0].kind, "return");
  assert.equal((await call(`${M}/reviews/comment`, "POST", { branch: "feat/a", kind: "comment", text: "" })).status, 400, "意見不能空");

  assert.equal((await call(`${M}/reviews/withdraw`, "POST", { branch: "feat/a" })).status, 200);
  assert.equal((await call(`${M}/reviews/one?branch=feat/a`)).data.review.status, "withdrawn");
  assert.equal((await call(`${M}/reviews/submit`, "POST", { branch: "feat/a", note: "第二次" })).status, 200);
  assert.equal((await call(`${M}/reviews/comment`, "POST", { branch: "feat/a", kind: "approve", text: "同意" })).status, 200);

  const m = await call(`${M}/branches/merge`, "POST", { name: "feat/a" });
  assert.equal(m.status, 200, JSON.stringify(m.data).slice(0, 200));
  const after = (await call(`${M}/reviews/one?branch=feat/a`)).data.review;
  assert.equal(after.status, "merged");
  assert.ok(after.merged.by && after.merged.basis, "合併紀錄寫入核准者");
  assert.equal(after.history.filter((h: any) => h.action === "submit").length, 2);
  assert.ok(after.comments.some((c: any) => c.kind === "approve"), "留言隨分支進 main");
  await fs.stat(path.join(home, "projects", "rv", "reviews", "feat~a.json"));
  const { execFileSync: ex } = await import("node:child_process");
  const last = ex("git", ["log", "-1", "--format=%s"], { cwd: path.join(home, "projects", "rv"), encoding: "utf8" });
  assert.match(last, /合併分支 feat\/a/, "合併提交訊息不變");
  const committed = JSON.parse(ex("git", ["show", "HEAD:reviews/feat~a.json"], { cwd: path.join(home, "projects", "rv"), encoding: "utf8" }));
  assert.equal(committed.status, "merged", "合併紀錄在同一個提交裡");
  assert.equal(ex("git", ["status", "--porcelain"], { cwd: path.join(home, "projects", "rv"), encoding: "utf8" }).trim(), "", "工作目錄乾淨");
});

test("核准者：設定負責人後，非負責人被擋、負責人與總工程師可以；沒設定沿用職級門檻", async () => {
  const { approverCheck, saveApprovers } = await import("./reviews.ts");
  const { execFileSync } = await import("node:child_process");
  const M = `${I}/api/projects/rv`, B = `${I}/api/projects/rv@feat~b`;
  execFileSync("git", ["branch", "feat/b"], { cwd: path.join(home, "projects", "rv") });
  await call(B);
  const sub = (await call(`${M}`)).data.analysis.elements.find((x: any) => x.category === "Subsystem");
  assert.ok(sub, "範本有次系統");
  // 新增一條需求，並用 #trace 連到這個次系統：它就屬於這個次系統
  const r = await call(`${B}/elements`, "POST", { category: "SubsystemRequirement", name: "合成次系統需求", doc: "合成。" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const rel = await call(`${B}/relations`, "POST", { kind: "trace", from: r.data.analysis.elements.find((x: any) => x.name === "合成次系統需求").id, to: sub.id });
  assert.equal(rel.status, 200, JSON.stringify(rel.data).slice(0, 200));
  const user = (rank: string, login: string) => ({ kind: "member", login, name: login, rank, subsystems: [], admin: false, project: null }) as any;

  // 沒設定：職級門檻
  assert.equal((await approverCheck("rv", "feat/b", user("O-V", "a@x"), "a")).ok, true);
  assert.equal((await approverCheck("rv", "feat/b", user("O-IV", "b@x"), "b")).ok, false);

  await saveApprovers("rv", { [sub.name]: ["lead@x"] }, "測試");
  const affected = await approverCheck("rv", "feat/b", user("O-V", "other@x"), "other");
  assert.deepEqual(affected.subsystems, [sub.name], "改動被歸到該次系統");
  assert.equal(affected.ok, false, "非負責人被擋");
  assert.match(affected.reason, new RegExp(sub.name));
  assert.equal((await approverCheck("rv", "feat/b", user("O-V", "lead@x"), "lead")).ok, true, "負責人可核准");
  assert.equal((await approverCheck("rv", "feat/b", user("D-VII", "chief@x"), "chief")).ok, true, "總工程師可核准");
  assert.equal((await approverCheck("rv", "feat/b", user("O-IV", "lead@x"), "lead")).ok, false, "負責人也要責任工程師以上");
  assert.equal((await approverCheck("rv", "feat/b", { ...user("O-V", "x@x"), rank: null }, "x")).ok, false, "唯讀身分不能核准");
  assert.deepEqual((await call(`${M}/reviews/approvers`)).data, { [sub.name]: ["lead@x"] });
});
