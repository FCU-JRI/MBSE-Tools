// 閉環：建立之後能改（上層、類別、自訂屬性、驗證事件、關係、簽核撤回）。合成的範本專案。
// 執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18817, PUB = 18818; // 和 api.test.ts、google.test.ts、members.test.ts 錯開
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
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-closure-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const r = await call(`${I}/api/projects`, "POST", { id: "c1", name: "閉環測試", kind: "annual", template: "sample" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  v = (await call(`${I}/api/projects/c1`)).data;
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

let v: any;
const els = () => v.analysis.elements as any[];
const find = (name: string, kind?: string) => els().find((e) => e.name === name && (!kind || e.kind === kind));
const rels = (kind: string) => (v.analysis.relations as any[]).filter((r) => r.kind === kind);
/** 名稱可能重複（例如階段「回收」與零件「回收」），兩端用名稱比對所有同名元素 */
const has = (kind: string, from: string, to: string) => rels(kind).some((r) => els().some((e) => e.id === r.from && e.name === from) && els().some((e) => e.id === r.to && e.name === to));
const model = () => fs.readFile(path.join(home, "projects", "c1", "model", "model.sysml"), "utf8");
async function ok(p: string, body: unknown) {
  const r = await call(`${I}/api/projects/c1${p}`, "POST", body);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 400));
  if (r.data.analysis) v = r.data;
  assert.equal(v.analysis.ok, true);
  return r.data;
}
/** 應被拒絕，而且模型檔一個字都沒改。 */
async function refused(p: string, body: unknown, re?: RegExp) {
  const text = await model();
  const r = await call(`${I}/api/projects/c1${p}`, "POST", body);
  assert.notEqual(r.status, 200, `應被拒絕：${JSON.stringify(body)}`);
  if (re) assert.match(String(r.data.error ?? ""), re);
  assert.equal(await model(), text, "被拒絕時不得改動模型檔");
  return r.data;
}

test("改上層：功能與階段可換任務，搬走時移除舊任務內的先後順序", async () => {
  const succ = rels("succession").length;
  await ok("/elements", { category: "MissionPhase", name: "地面作業" });
  const data = await ok("/elements/reparent", { id: find("滑行", "ActionUsage").id, parentId: find("地面作業").id });
  assert.equal(data.removed, 2, "滑行前後各一條先後順序");
  assert.equal(find("滑行", "ActionUsage").owner, find("地面作業").id);
  assert.equal(rels("succession").length, succ - 2);
  // 搬回行為套件
  await ok("/elements/reparent", { id: find("滑行", "ActionUsage").id, parentId: find("Behavior", "Package").id });
  assert.equal(find("滑行", "ActionUsage").owner, find("Behavior", "Package").id);
  // 不能放進自己底下、不能放到不相容的上層
  await refused("/elements/reparent", { id: find("任務", "ActionUsage").id, parentId: find("發射", "ActionUsage").id }, /自己底下/);
  await refused("/elements/reparent", { id: find("發射", "ActionUsage").id, parentId: find("火箭").id }, /只能是任務或活動/);
  await refused("/elements/reparent", { id: find("遠地點高度").id, parentId: find("NGOs", "Package").id }, /套件/);
});

test("改上層：次系統換組成它的系統定義，關係保留；被完整路徑引用時拒絕", async () => {
  await ok("/elements", { category: "System", name: "地面站" });
  await ok("/elements/reparent", { id: find("回收次系統").id, parentId: find("地面站", "PartDefinition").id });
  const u = els().find((e) => e.kind === "PartUsage" && e.name === "回收");
  assert.equal(u.owner, find("地面站", "PartDefinition").id);
  assert.ok(has("satisfy", "rocket", "遠地點高度"), "satisfy 保留");
  // 沒有上層的定義：選上層 = 加組成
  await ok("/elements/reparent", { id: find("地面站", "PartDefinition").id, parentId: find("火箭").id });
  assert.ok(els().some((e) => e.kind === "PartUsage" && e.owner === find("火箭").id && e.typeIds.includes(find("地面站", "PartDefinition").id)));
  // 分配用完整路徑引用功能：搬走功能會讓引用失效，必須拒絕
  await ok("/elements", { category: "Function", name: "點火", parentId: find("任務", "ActionUsage").id });
  await ok("/relations", { kind: "allocate", from: find("點火").id, to: find("推進次系統").id });
  await refused("/elements/reparent", { id: find("點火").id, parentId: find("Behavior", "Package").id });
});

test("改類別：同關鍵字可換、關係保留、編號跟著換；跨關鍵字不開放", async () => {
  const rel = () => ["derive", "satisfy", "verify"].map((k) => rels(k).length).join(",");
  const before = rel();
  await ok("/elements/category", { id: find("遠地點高度").id, category: "SubsystemRequirement" });
  const e = find("遠地點高度");
  assert.equal(e.category, "SubsystemRequirement");
  assert.equal(e.shortName, "REQ-SUB-001");
  assert.equal(rel(), before, "衍生、滿足、驗證都保留");
  assert.ok(has("derive", "總衝量", "遠地點高度"));
  assert.ok(has("verify", "飛行測試遠地點量測", "遠地點高度"));
  // 不換編號
  await ok("/elements/category", { id: find("遠地點高度").id, category: "SystemRequirement", renumber: false });
  assert.equal(find("遠地點高度").shortName, "REQ-SUB-001");
  // 階段 ↔ 功能、驗證 ↔ 確認
  await ok("/elements/category", { id: find("發射", "ActionUsage").id, category: "Function" });
  assert.equal(find("發射", "ActionUsage").category, "Function");
  await ok("/elements/category", { id: find("飛行測試遠地點量測").id, category: "ValidationEvent" });
  assert.equal(find("飛行測試遠地點量測").category, "ValidationEvent");
  await ok("/elements/category", { id: find("飛行測試遠地點量測").id, category: "VerificationEvent" });
  // 跨關鍵字：需要（requirement）→ 系統（part def）
  await refused("/elements/category", { id: find("到達目標高度").id, category: "System" }, /關鍵字不同/);
  // 風險有失效模式等欄位，SOP 沒有：先清空才能換
  await refused("/elements/category", { id: find("降落傘未展開").id, category: "SOP" }, /先清空/);
});

test("自訂屬性：新增、改值、改名、刪除；單位錯誤或沿用的屬性改名時拒絕", async () => {
  const id = () => find("推進次系統").id;
  await ok("/elements/attribute", { id: id(), name: "mass", value: "2.5", unit: "kg" });
  assert.equal(find("推進次系統").attrs.mass, "2.5 [kg]");
  await ok("/elements/attribute", { id: id(), oldName: "mass", name: "mass", value: "3", unit: "kg" });
  assert.equal(find("推進次系統").attrs.mass, "3 [kg]");
  await ok("/elements/attribute", { id: id(), oldName: "mass", name: "wetMass", value: "3.2", unit: "kg" });
  assert.equal(find("推進次系統").attrs.mass, undefined);
  assert.equal(find("推進次系統").attrs.wetMass, "3.2 [kg]");
  await ok("/elements/attribute", { id: id(), name: "vendor", value: "合成廠商 A" });
  assert.equal(find("推進次系統").attrs.vendor, "合成廠商 A");
  await ok("/elements/attribute", { id: id(), oldName: "vendor", remove: true });
  assert.equal(find("推進次系統").attrs.vendor, undefined);
  // 需求上也能加
  await ok("/elements/attribute", { id: find("總衝量").id, name: "margin", value: "0.1" });
  assert.equal(find("總衝量").attrs.margin, "0.1");
  await refused("/elements/attribute", { id: id(), name: "x", value: "1", unit: "kgg" });
  await refused("/elements/attribute", { id: id(), name: "y", value: "abc", unit: "kg" }, /必須是數字/);
  await refused("/elements/attribute", { id: id(), name: "wetMass", value: "1" }, /已經有/);
  await refused("/elements/attribute", { id: find("rocket").id, oldName: "apogee", name: "apogee2", value: "1", unit: "m" }, /不能改名/);
  await refused("/elements/attribute", { id: find("降落傘未展開").id, name: "severity", value: "3" }, /預設欄位/);
});

test("驗證事件：方法可改、要驗證的需求可增減", async () => {
  const ver = () => find("飛行測試遠地點量測");
  await ok("/verification", { id: ver().id, method: "analyze" });
  assert.match(ver().attrs.kind, /analyze$/);
  await ok("/verification", { id: ver().id, verifies: [find("遠地點高度").id, find("總衝量").id] });
  assert.ok(has("verify", "飛行測試遠地點量測", "遠地點高度"));
  assert.ok(has("verify", "飛行測試遠地點量測", "總衝量"));
  await ok("/verification", { id: ver().id, verifies: [find("總衝量").id] });
  assert.ok(!has("verify", "飛行測試遠地點量測", "遠地點高度"));
  await ok("/verification", { id: ver().id, verifies: [] });
  assert.equal(rels("verify").filter((r) => r.from === ver().id).length, 0);
  assert.doesNotMatch(await model(), /objective \{\s*\}/, "空的 objective 一併拿掉");
  await ok("/verification", { id: ver().id, verifies: [find("遠地點高度").id], method: "test" });
  assert.ok(has("verify", "飛行測試遠地點量測", "遠地點高度"));
  assert.match(ver().attrs.kind, /test$/);
  await refused("/verification", { id: ver().id, verifies: [find("火箭").id] }, /必須是需求/);
});

test("改關係：換對象、換類型；先後順序可換對象；組成線可換上下層；不同寫法不能互換", async () => {
  const moe = find("遠地點誤差").id, obj = find("遠地點達 3000 m").id;
  await ok("/relations/change", { kind: "refine", from: moe, to: obj, newKind: "trace" });
  assert.ok(has("trace", "遠地點誤差", "遠地點達 3000 m"));
  assert.ok(!has("refine", "遠地點誤差", "遠地點達 3000 m"));
  await ok("/relations/change", { kind: "trace", from: moe, to: obj, newTo: find("完成年度飛行任務").id });
  assert.ok(has("trace", "遠地點誤差", "完成年度飛行任務"));
  // 衍生：換母需求
  await ok("/relations/change", { kind: "derive", from: find("總衝量").id, to: find("遠地點高度").id, newTo: find("遠地點達 3000 m").id });
  assert.ok(has("derive", "總衝量", "遠地點達 3000 m"));
  assert.ok(!has("derive", "總衝量", "遠地點高度"));
  // 衍生的兩端必須是需求
  await refused("/relations/change", { kind: "derive", from: find("總衝量").id, to: find("遠地點達 3000 m").id, newTo: find("火箭").id }, /衍生只能/);
  // 先後順序：換下一步
  await ok("/relations/change", { kind: "succession", from: find("發射", "ActionUsage").id, to: find("動力飛行").id, newTo: find("回收", "ActionUsage").id });
  assert.ok(has("succession", "發射", "回收"));
  await refused("/relations/change", { kind: "succession", from: find("發射", "ActionUsage").id, to: find("回收", "ActionUsage").id, newKind: "trace" }, /不同的寫法/);
  // 組成線：火箭 ◆ 航電次系統 → 火箭 ◆ 回收次系統（換型別），再換上層到地面站
  const u = () => els().find((e) => e.kind === "PartUsage" && e.name === "航電");
  await ok("/relations/change", { kind: "compose", usage: u().id, newTo: find("回收次系統").id });
  assert.ok(u().typeIds.includes(find("回收次系統").id));
  await ok("/relations/change", { kind: "compose", usage: u().id, newFrom: find("地面站", "PartDefinition").id });
  assert.equal(u().owner, find("地面站", "PartDefinition").id);
  // 驗證線在驗證事件改
  await refused("/relations/change", { kind: "verify", from: find("飛行測試遠地點量測").id, to: find("遠地點高度").id, newTo: find("總衝量").id }, /要驗證的需求/);
});

test("簽核撤回：留下撤回紀錄，不刪原紀錄；只能撤回最新一筆", async () => {
  let r = await call(`${I}/api/projects/c1/signoffs`, "POST", { gate: "proposal", decision: "APPROVE", comment: "合成測試" });
  assert.equal(r.status, 200);
  const first = r.data.project.signoffs[0];
  r = await call(`${I}/api/projects/c1/signoffs/revoke`, "POST", { at: first.at, comment: "按錯" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const list = r.data.project.signoffs;
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], first, "原紀錄原封不動");
  assert.equal(list[1].decision, "REVOKE");
  assert.equal(list[1].revokes, first.at);
  assert.ok(list[1].by && list[1].at && list[1].role);
  assert.equal(list[1].comment, "按錯");
  r = await call(`${I}/api/projects/c1/signoffs/revoke`, "POST", { at: first.at });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /已經撤回/);
  // 再簽兩筆，只能撤回最新那筆
  await call(`${I}/api/projects/c1/signoffs`, "POST", { gate: "proposal", decision: "DENY" });
  r = await call(`${I}/api/projects/c1/signoffs`, "POST", { gate: "proposal", decision: "APPROVE" });
  const [deny, approve] = r.data.project.signoffs.slice(-2);
  assert.equal((await call(`${I}/api/projects/c1/signoffs/revoke`, "POST", { at: deny.at })).status, 400);
  assert.equal((await call(`${I}/api/projects/c1/signoffs/revoke`, "POST", { at: approve.at })).status, 200);
  const hist = (await call(`${I}/api/projects/c1/history`)).data;
  assert.match(hist[0].message, /撤回簽核/);
});
