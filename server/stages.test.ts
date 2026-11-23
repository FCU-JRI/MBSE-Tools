// 模型頁依分析流程重整：分析圖的骨架、既有專案不被改檔案、7 個階段涵蓋所有類別、依層篩選、N² 矩陣。合成的專案。
// 執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18867, PUB = 18868; // 和其他測試檔錯開
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON 回應保留原文 */ }
  return { status: r.status, data };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-stages-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const [id, template] of [["s1", "sample"], ["b1", "blank"]]) {
    const r = await call(`${I}/api/projects`, "POST", { id, name: `階段測試 ${id}`, kind: "annual", template });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("新專案建立時建好 10 張分析圖的骨架，順序照 METHOD.md 第 3 節", async () => {
  const { METHOD_VIEWS } = await import("../web/src/pages/model/method.ts");
  const want = [...METHOD_VIEWS].sort((a, b) => a.no - b.no).map((m) => m.id);
  for (const id of ["s1", "b1"]) {
    const r = await call(`${I}/api/projects/${id}/analysis-views`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.data.views, want);
    // 骨架有進版本紀錄
    const raw = JSON.parse(await fs.readFile(path.join(home, "projects", id, "analysis.json"), "utf8"));
    assert.deepEqual(raw.views, want);
  }
  assert.deepEqual(METHOD_VIEWS.map((m) => m.no).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("既有專案（沒有骨架）：讀取不會替它補寫任何檔案", async () => {
  const dir = path.join(home, "projects", "s1");
  await fs.rm(path.join(dir, "analysis.json"));
  const before = (await fs.readdir(dir)).sort();
  const r = await call(`${I}/api/projects/s1/analysis-views`);
  assert.deepEqual(r.data, { views: null });
  await call(`${I}/api/projects/s1/diagrams`);
  await call(`${I}/api/projects/s1`);
  assert.deepEqual((await fs.readdir(dir)).sort(), before);
});

test("分析圖：補上的空白圖不寫檔，第一次在圖上修改才寫", async () => {
  const { withMethod, persisted, methodId, METHOD_VIEWS } = await import("../web/src/pages/model/method.ts");
  const stored = { custom: [{ id: "custom:c1", title: "總覽", members: ["a"] }], notes: {} };
  const shown = withMethod(stored, null);
  assert.equal(shown.custom.length, 1 + METHOD_VIEWS.length);
  // 什麼都沒改：存檔內容和原本一樣
  assert.deepEqual(persisted(shown, stored), stored);
  // 在利害關係人分析圖放進一個元素：只多寫這一張
  const sid = methodId("stakeholders");
  const next = { ...shown, custom: shown.custom.map((c) => (c.id === sid ? { ...c, members: ["x"] } : c)) };
  const keep = persisted(next, stored);
  assert.deepEqual(keep.custom.map((c) => c.id), ["custom:c1", sid]);
  // 只加草稿標註也算修改
  const noted = persisted({ ...shown, notes: { [methodId("risk")]: [{ id: "note:a", type: "note", x: 0, y: 0, w: 100, h: 50, text: "t" }] } }, stored);
  assert.ok(noted.custom.some((c) => c.id === methodId("risk")));
  // 伺服器接受分析圖的代號（和一般自訂圖同一種格式）
  const r = await call(`${I}/api/projects/b1/diagrams`, "PUT", { diagrams: keep });
  assert.deepEqual(r.data.custom.map((c: any) => c.id), ["custom:c1", sid]);
  // 骨架只列一部分時只補那幾張
  assert.equal(withMethod({ custom: [], notes: {} }, ["stakeholders", "risk"]).custom.length, 2);
});

test("7 個階段加上貫穿全程，涵蓋每一個類別、各一次；每張分析圖都掛在某個階段", async () => {
  const { STAGES, THROUGHOUT, METHOD_VIEWS } = await import("../web/src/pages/model/method.ts");
  const meta = (await call(`${I}/api/meta`)).data;
  const all = [...STAGES, THROUGHOUT].flatMap((s) => s.categories);
  assert.deepEqual([...all].sort(), meta.categories.map((c: any) => c.id).sort());
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(STAGES.map((s) => s.title), ["任務定義", "任務剖面", "系統層級", "次系統層級", "細部設計", "製造與測試", "發射與收束"]);
  const hung = new Set([...STAGES, THROUGHOUT].flatMap((s) => s.views.map((v) => v.id)));
  for (const m of METHOD_VIEWS) assert.ok(hung.has(m.id), `${m.title} 沒有掛到階段`);
  // 釘選的類別都存在
  for (const m of METHOD_VIEWS) for (const c of m.pinned) assert.ok(meta.categories.some((x: any) => x.id === c), `${m.title} 釘選了不存在的類別 ${c}`);
  // 方案比較、FMEA 全專案一張但要分層
  assert.deepEqual(METHOD_VIEWS.filter((m) => m.layered).map((m) => m.id).sort(), ["risk", "trade"]);
});

test("範本專案：還缺什麼、依層判斷、目前所在的階段", async () => {
  const { METHOD_VIEWS, layerOf, n2Matrix, currentStage } = await import("../web/src/pages/model/method.ts");
  const v = (await call(`${I}/api/projects/s1`)).data;
  const a = v.analysis;
  assert.equal(a.ok, true);
  for (const m of METHOD_VIEWS) assert.ok(Array.isArray(m.missing(a)), m.id);
  const blank = (await call(`${I}/api/projects/b1`)).data.analysis;
  // 空白專案：每張分析圖都標出還缺什麼
  for (const m of METHOD_VIEWS) assert.ok(m.missing(blank).length > 0, `${m.title} 在空白專案應該有缺項`);
  const of = (cat: string) => a.elements.find((e: any) => e.category === cat && (e.kind === "PartDefinition" || e.kind.endsWith("Usage")));
  for (const [cat, layer] of [["Objective", "mission"], ["SystemRequirement", "system"], ["Subsystem", "subsystem"]]) {
    const e = of(cat);
    if (e) assert.equal(layerOf(a, e.id), layer, cat);
  }
  const { parts, cell } = n2Matrix(a);
  for (const p of parts) assert.equal(cell(p.id, p.id), 0);
  assert.ok(currentStage(v) >= 1 && currentStage(v) <= 7);
  assert.equal(currentStage((await call(`${I}/api/projects/b1`)).data), 1); // 空白專案從任務定義開始
});
