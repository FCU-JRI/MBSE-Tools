// WP1 元素基礎：任務需求、設計決策、成功判準等級、風險種類、CAD 連結、層級標記。建得出來、改得回去、刪得掉。合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18877, PUB = 18878; // 和其他測試檔錯開
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
let v: any;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
const model = () => fs.readFile(path.join(home, "projects", "w1", "model", "model.sysml"), "utf8");
const els = () => v.analysis.elements as any[];
const byName = (n: string) => els().find((e) => e.name === n && e.category);
async function send(p: string, method: string, body: unknown, want = 200) {
  const r = await call(`${I}/api/projects/w1${p}`, method, body);
  assert.equal(r.status, want, JSON.stringify(r.data).slice(0, 400));
  if (r.data?.analysis) v = r.data;
  return r.data;
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-wp1-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "w1", name: "WP1 測試", kind: "annual", template: "sample" })).status, 200);
  v = (await call(`${I}/api/projects/w1`)).data;
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("任務需求：新增、改名、刪除", async () => {
  await send("/elements", "POST", { category: "MissionRequirement", name: "合成任務需求甲", doc: "任務應將合成酬載送達合成高度" });
  const e = byName("合成任務需求甲");
  assert.ok(e, "建得出來");
  assert.equal(e.category, "MissionRequirement");
  assert.match(e.shortName, /^REQ-MSN-/);
  await send("/elements", "PATCH", { id: e.id, name: "合成任務需求乙" });
  assert.ok(byName("合成任務需求乙"), "改得回去");
  await send("/elements/delete", "POST", { id: byName("合成任務需求乙").id });
  assert.equal(byName("合成任務需求乙"), undefined, "刪得掉");
});

test("設計決策：欄位可填、可改、可清", async () => {
  await send("/elements", "POST", { category: "DesignDecision", name: "合成決策", attrs: { rationale: "合成理由一", decidedBy: "總工程師", decidedOn: "2026-01-01" } });
  let e = byName("合成決策");
  assert.equal(e.attrs.rationale, "合成理由一");
  await send("/elements", "PATCH", { id: e.id, attrs: { rationale: "合成理由二" } });
  e = byName("合成決策");
  assert.equal(e.attrs.rationale, "合成理由二");
  await send("/elements/delete", "POST", { id: e.id });
  assert.equal(byName("合成決策"), undefined);
});

test("成功判準等級與風險種類：欄位可填可改", async () => {
  const moe = els().find((e) => e.category === "MOE");
  await send("/elements", "PATCH", { id: moe.id, attrs: { successLevel: "完全" } });
  assert.equal(els().find((e) => e.id === moe.id || e.name === moe.name && e.category === "MOE").attrs.successLevel, "完全");
  const risk = els().find((e) => e.category === "Risk");
  await send("/elements", "PATCH", { id: risk.id, attrs: { riskKind: "時程" } });
  assert.equal(els().find((e) => e.name === risk.name && e.category === "Risk").attrs.riskKind, "時程");
});

test("CAD 連結：設定、改版本、清除；不合法的網址被拒絕且模型不變", async () => {
  const sys = els().find((e) => e.category === "System");
  await send("/elements", "PATCH", { id: sys.id, cad: { url: "https://cad.example.invalid/doc/1", version: "v1", tool: "Onshape" } });
  let e = byName(sys.name);
  assert.equal(e.attrs.cadUrl, "https://cad.example.invalid/doc/1");
  assert.equal(e.attrs.cadVersion, "v1");
  assert.match(await model(), /@CadLink \{ cadUrl = "https:\/\/cad\.example\.invalid\/doc\/1"; cadVersion = "v1"; cadTool = "Onshape"; \}/);
  await send("/elements", "PATCH", { id: e.id, cad: { url: e.attrs.cadUrl, version: "v2", tool: "Onshape" } });
  e = byName(sys.name);
  assert.equal(e.attrs.cadVersion, "v2", "改得回去");
  assert.equal((await model()).match(/@CadLink/g)?.length, 1, "改版本不會多出第二個標記");
  const before = await model();
  await send("/elements", "PATCH", { id: e.id, cad: { url: "ftp://x", version: "v3" } }, 400);
  assert.equal(await model(), before, "被拒絕時模型不變");
  await send("/elements", "PATCH", { id: e.id, cad: { url: "", version: "" } });
  e = byName(sys.name);
  assert.equal(e.attrs.cadUrl, undefined, "刪得掉");
  assert.doesNotMatch(await model(), /@CadLink \{/);
});

test("層級標記：設定、改、清除；不在清單裡的值被拒絕", async () => {
  const r = els().find((e) => e.category === "SystemRequirement");
  await send("/elements", "PATCH", { id: r.id, layer: "system" });
  assert.equal(byName(r.name).attrs.layer, "system");
  await send("/elements", "PATCH", { id: byName(r.name).id, layer: "subsystem" });
  assert.equal(byName(r.name).attrs.layer, "subsystem");
  await send("/elements", "PATCH", { id: byName(r.name).id, layer: "galaxy" }, 400);
  await send("/elements", "PATCH", { id: byName(r.name).id, layer: "" });
  assert.equal(byName(r.name).attrs.layer, undefined);
  assert.doesNotMatch(await model(), /@LayerTag \{/);
});
