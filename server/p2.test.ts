// P2 分析圖骨架（docs/IMPL-PLAN.md）：分析圖的成員與手動連線存檔後重開還在；舊的 JRI 範本專案開得起來。
// 埠 18821／18822（IMPL-PLAN 第 5 節）。資料都是合成的。執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analysisDiagrams, analysisPalette, bendKey, bendsOf, buildGraph } from "../web/src/model.ts";

const PORT = 18821, PUB = 18822;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;
let home: string;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
async function start() {
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/bin/false" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
}
async function stop() {
  if (!server) return;
  const s = server; server = null;
  await new Promise<void>((r) => { s.once("exit", () => r()); s.kill(); setTimeout(r, 3000); });
}

before(async () => { home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p2-")); await start(); });
after(async () => { await stop(); await fs.rm(home, { recursive: true, force: true }).catch(() => {}); });

const D = "view:stakeholders";

test("舊的 JRI 範本專案開得起來：模型沒有錯誤，十張以內的分析圖都列得出來、各有問題", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "p2a", name: "分析圖測試", kind: "annual" })).status, 200);
  const v = (await call(`${I}/api/projects/p2a`)).data;
  assert.equal(v.analysis.ok, true);
  const dg = (await call(`${I}/api/projects/p2a/diagrams`)).data;
  assert.deepEqual(dg.views ?? {}, {}, "舊的 diagrams.json 沒有 views，讀得進來");
  const list = analysisDiagrams(dg);
  assert.ok(list.length >= 4 && list.length <= 10);
  for (const d of list) {
    assert.ok(d.view!.question);
    assert.doesNotThrow(() => buildGraph(d, v.analysis));
    assert.doesNotThrow(() => d.view!.missing?.(v.analysis));
  }
});

test("分析圖的成員與手動連線（轉折點）存檔後，伺服器重開還在", async () => {
  const v = (await call(`${I}/api/projects/p2a`)).data;
  const d = analysisDiagrams({}).find((x) => x.id === D)!;
  const pal = analysisPalette(v.analysis, d.view!);
  const stk = pal.pinned.find((e) => e.category === "Stakeholder" && e.name === "指導老師")!;
  const exp = pal.pinned.find((e) => e.category === "Expectation")!;
  const dim = pal.other.find((e) => e.category === "SystemRequirement")!; // 暗色的元素照樣拉得進來
  assert.ok(stk && exp && dim);
  const dg = (await call(`${I}/api/projects/p2a/diagrams`)).data;
  const put = await call(`${I}/api/projects/p2a/diagrams`, "PUT", { diagrams: { ...dg, views: { [D]: [stk.id, exp.id, dim.id, stk.id], "view:bad id": ["x"], "notview:x": ["y"] } } });
  assert.equal(put.status, 200);
  assert.deepEqual(put.data.views, { [D]: [stk.id, exp.id, dim.id] }, "重複的成員與不合規的識別碼不存");
  const g = buildGraph({ ...d, members: put.data.views[D] }, v.analysis);
  const e = g.edges.find((x) => x.kind === "trace" && x.source === exp.id && x.target === stk.id)!;
  assert.ok(e, "期望追溯到利害關係人的連線");
  const key = e.key ?? e.id;
  const nodes = { [stk.id]: { x: 24, y: 24 }, [exp.id]: { x: 24, y: 240 }, [dim.id]: { x: 400, y: 240 }, [bendKey(key, 0)]: { x: 300, y: 200 }, [bendKey(key, 1)]: { x: 300, y: 72 } };
  assert.equal((await call(`${I}/api/projects/p2a/layout`, "PATCH", { diagram: D, nodes })).status, 200);

  await stop(); await start();
  const layout = (await call(`${I}/api/projects/p2a/layout`)).data;
  assert.deepEqual(bendsOf(layout[D], key), [{ x: 300, y: 200 }, { x: 300, y: 72 }]);
  assert.deepEqual(layout[D][dim.id], { x: 400, y: 240 });
  const again = (await call(`${I}/api/projects/p2a/diagrams`)).data;
  assert.deepEqual(again.views[D], [stk.id, exp.id, dim.id]);
});

test("元素搬進別的套件後，分析圖的成員跟著換成新的識別碼", async () => {
  const v = (await call(`${I}/api/projects/p2a`)).data;
  const before = (await call(`${I}/api/projects/p2a/diagrams`)).data.views[D] as string[];
  const stk = v.analysis.elements.find((e: any) => e.name === "指導老師" && e.category === "Stakeholder");
  const pkg = await call(`${I}/api/projects/p2a/packages`, "POST", { name: "校內" });
  assert.equal(pkg.status, 200, JSON.stringify(pkg.data).slice(0, 300));
  const moved = await call(`${I}/api/projects/p2a/elements/move`, "POST", { ids: [stk.id], packageId: pkg.data.created });
  assert.equal(moved.status, 200, JSON.stringify(moved.data).slice(0, 300));
  const nid = moved.data.moved[stk.id];
  assert.ok(nid && nid !== stk.id);
  const after = moved.data.diagrams.views[D] as string[];
  assert.ok(after.includes(nid) && !after.includes(stk.id));
  assert.equal(after.length, before.length);
});
