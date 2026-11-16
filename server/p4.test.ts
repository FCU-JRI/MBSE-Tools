// P4 介面與 N² 矩陣（docs/IMPL-PLAN.md）：在網站上建連接埠、介面、兩端數字的檢查、N² 矩陣、兩端同意與驗證清單。
// 模型與數值都是合成的。埠 18841／18842（IMPL-PLAN 第 5 節）。執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { quoteNames, valueText } from "./method/p4-model.ts";
import { analyze, evaluate, shutdown } from "./engine.ts";

const PORT = 18841, PUB = 18842;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 保留原文 */ }
  return { status: r.status, data };
}
let v: any;
let ifr: any;
async function ok(p: string, method: string, body?: unknown) {
  const r = await call(`${I}/api/projects/p4${p}`, method, body);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 400));
  if (r.data.analysis) v = r.data;
  if (r.data.interfaces) ifr = r.data.interfaces;
  return r.data;
}
const el = (name: string, kind?: string) => v.analysis.elements.find((e: any) => e.name === name && (!kind || e.kind === kind));

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p4-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await shutdown();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("式子裡的中文名稱自動加引號；數字補單位", () => {
  assert.equal(quoteNames("供電端.電壓 == load.'電壓' and x <= 2"), "'供電端'.'電壓' == load.'電壓' and x <= 2");
  assert.equal(quoteNames(`a == "中文"`), `a == "中文"`);
  assert.equal(valueText("7.4", { name: "v", type: "ISQ::ElectricPotentialValue", unit: "V" }), "7.4 [V]");
  assert.equal(valueText("5 [mV]", { name: "v", type: "ISQ::ElectricPotentialValue", unit: "V" }), "5.0 [mV]");
  assert.equal(valueText("3", { name: "n", type: "ScalarValues::Integer", unit: "" }), "3");
  assert.throws(() => valueText("abc", { name: "n", type: "ScalarValues::Real", unit: "" }));
});

test("解析器直接求介面的 assert constraint（定義當 subject）", async () => {
  const lib = await fs.readFile("library/JRI.sysml", "utf8");
  const model = (va: string) => `package Project {
    private import ScalarValues::*; private import ISQ::*; private import SI::*; private import JRI::*;
    port def P :> InterfacePort { attribute v : ISQ::ElectricPotentialValue; }
    interface def L :> Interface { attribute :>> interfaceKind = JRI::InterfaceKind::electrical; end s : P; end t : P; assert constraint same { s.v == t.v } }
    part def A :> Subsystem { port p : P { attribute :>> v = ${va} [V]; } }
    part def B :> Subsystem { port p : P { attribute :>> v = 5.0 [V]; } }
    part def R :> System { part a : A; part b : B; interface l : L connect a.p to b.p; }
  }`;
  for (const [va, want] of [["7.4", false], ["5.0", true]] as const) {
    const src = [["JRI.sysml", lib], ["m.sysml", model(va)]] as const;
    assert.equal((await analyze(src)).ok, true);
    const [r, s] = await evaluate(src, [{ expr: "l.same", subject: "Project::R" }, { expr: "l.s.v", subject: "Project::R" }]);
    assert.equal(r.value, want);
    assert.deepEqual([s.value, s.unit], [Number(va), "V"], "第一端接到 connect 的第一個零件");
  }
});

test("建立專案與兩個次系統", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "p4", name: "介面測試", kind: "annual", template: "blank" })).status, 200);
  await ok("/elements", "POST", { category: "System", name: "合成火箭" });
  await ok("/elements", "POST", { category: "Subsystem", name: "電源次系統" });
  await ok("/elements", "POST", { category: "Subsystem", name: "航電次系統" });
  await ok("/elements", "POST", { category: "Subsystem", name: "回收次系統" });
  await ok("/parts", "POST", { owner: el("合成火箭").id, type: el("電源次系統").id, name: "power" });
  await ok("/parts", "POST", { owner: el("合成火箭").id, type: el("航電次系統").id, name: "avionics" });
  assert.equal(v.analysis.ok, true);
  const r = await ok("/interfaces", "GET");
  assert.equal(r.interfaces.length, 0);
  assert.ok(r.warnings.some((w: any) => w.text.includes("還沒有任何介面")));
  assert.deepEqual(r.n2.nodes.map((n: any) => n.name).sort(), ["回收次系統", "航電次系統", "電源次系統"].sort(), "對角線是次系統");
});

test("新增帶物理量的連接埠與電介面", async () => {
  await ok("/interfaces/port-defs", "POST", { name: "電源埠", attrs: [{ name: "電壓", type: "ISQ::ElectricPotentialValue" }, { name: "最大電流", type: "ISQ::ElectricCurrentValue" }] });
  const port = el("電源埠", "PortDefinition");
  assert.equal(port.category, "InterfacePort");
  assert.equal(port.shortName, "IFP-001");
  await ok("/interfaces/defs", "POST", {
    name: "供電介面", kind: "electrical", maturity: "暫定", ownerA: "甲", ownerB: "乙", methods: ["test"], verificationLead: "丙", verificationLevel: "subsystem", rationale: "合成的理由",
    ends: [{ name: "供電端", portDef: port.id }, { name: "用電端", portDef: port.id }],
    constraints: [{ name: "電壓相符", text: "供電端.電壓 == 用電端.電壓" }, { name: "電流足夠", text: "用電端.最大電流 <= 供電端.最大電流" }],
  });
  const d = el("供電介面", "InterfaceDefinition");
  assert.equal(d.category, "Interface");
  const info = ifr.interfaceDefs.find((x: any) => x.id === d.id);
  assert.equal(info.kind, "electrical");
  assert.deepEqual(info.ends.map((e: any) => e.portDef), [port.id, port.id]);
  assert.deepEqual(info.constraints.map((c: any) => c.name), ["電壓相符", "電流足夠"]);
  assert.equal(info.attrs.ownerA, "甲");
  // 驗證方法與理由用標準庫的標記（和 P1 的需求相同）
  assert.deepEqual([info.methods, info.rationale], [["test"], "合成的理由"]);
  assert.ok(el("供電介面", "InterfaceDefinition").tags.includes("VerificationMethod"));
  // 種類不合法、兩端不齊時不寫入
  assert.equal((await call(`${I}/api/projects/p4/interfaces/defs`, "POST", { name: "X", kind: "magic", ends: [] })).status, 400);
});

test("數字不符時判定不過、符合時通過；N² 矩陣正確", async () => {
  const port = el("電源埠", "PortDefinition");
  await ok("/interfaces/ports", "POST", { owner: el("電源次系統").id, portDef: port.id, name: "pwr", values: { 電壓: "7.4", 最大電流: "3" } });
  await ok("/interfaces/ports", "POST", { owner: el("航電次系統").id, portDef: port.id, name: "pwr", values: { 電壓: "5", 最大電流: "0.5" } });
  const sys = el("合成火箭");
  const parts = v.analysis.elements.filter((e: any) => e.owner === sys.id && e.kind === "PartUsage");
  // 在互連圖上從電源拉到航電：自動找出兩邊的電源埠與供電介面
  await ok("/interfaces/connect", "POST", { from: parts.find((p: any) => p.name === "power").id, to: parts.find((p: any) => p.name === "avionics").id });
  assert.equal(ifr.interfaces.length, 1);
  let i = ifr.interfaces[0];
  assert.equal(i.kindZh, "電");
  assert.deepEqual(i.ends.map((e: any) => e.partDefName), ["電源次系統", "航電次系統"]);
  assert.deepEqual(i.ends[0].values.map((x: any) => [x.name, x.value, x.unit]), [["電壓", 7.4, "V"], ["最大電流", 3, "A"]], JSON.stringify(i.ends[0].values));
  assert.equal(i.result, "fail");
  assert.deepEqual(i.constraints.map((c: any) => c.result), ["fail", "pass"]);
  assert.ok(ifr.warnings.some((w: any) => w.text.includes("對不上")));
  // N²：列是第一端、欄是第二端
  const a = el("電源次系統").id, b = el("航電次系統").id;
  assert.deepEqual(ifr.n2.cells[`${a}|${b}`], [i.id]);
  assert.equal(ifr.n2.cells[`${b}|${a}`], undefined);
  assert.equal(Object.keys(ifr.n2.cells).length, 1);
  assert.ok(ifr.warnings.some((w: any) => w.text.includes("「回收次系統」還沒有任何介面")));
  // 驗證清單：欄位和 P1 的 reqInfo 同名
  const row = ifr.verification.find((r: any) => r.id === i.id);
  assert.deepEqual([row.type, row.methods, row.verificationLead, row.verificationLevel, row.responsible, row.rationale, row.result], ["interfacing", ["test"], "丙", "subsystem", "甲、乙", "合成的理由", "fail"]);

  // 改成 5 V：兩條限制都成立
  const pwr = v.analysis.elements.find((e: any) => e.kind === "PortUsage" && e.owner === a);
  await ok("/interfaces/ports", "POST", { id: pwr.id, values: { 電壓: "5.0", 最大電流: "3" } });
  i = ifr.interfaces[0];
  assert.equal(i.result, "pass");
  assert.equal(ifr.verification.find((r: any) => r.id === i.id).result, "pass");
});

test("介面變更要兩端負責人都同意才定案", async () => {
  let i = ifr.interfaces[0];
  assert.equal(i.agreed, false);
  // 不是負責人不能同意
  const bad = await call(`${I}/api/projects/p4/interfaces/approve`, "POST", { id: i.id, side: "b", author: "甲" });
  assert.equal(bad.status, 400);
  await ok("/interfaces/approve", "POST", { id: i.id, side: "a", author: "甲" });
  assert.equal(ifr.interfaces[0].agreed, false, "只有一端同意還不算定案");
  await ok("/interfaces/approve", "POST", { id: i.id, side: "b", author: "乙" });
  i = ifr.interfaces[0];
  assert.equal(i.agreed, true);
  assert.equal(i.approvals.a.by, "甲");
  // 改了一端的數字：先前的同意失效
  const pwr = v.analysis.elements.find((e: any) => e.kind === "PortUsage" && e.owner === el("航電次系統").id);
  await ok("/interfaces/ports", "POST", { id: pwr.id, values: { 電壓: "5", 最大電流: "0.8" } });
  i = ifr.interfaces[0];
  assert.equal(i.agreed, false);
  assert.equal(i.approvals.a, null);
  // 同意紀錄存在專案的 interfaces.json，跟著 git 提交
  const saved = JSON.parse(await fs.readFile(path.join(home, "projects", "p4", "interfaces.json"), "utf8"));
  assert.ok(saved.approvals[i.qualifiedName].a.hash);
});

test("外部提供的次系統：只管介面、規格當給定值，列出收到時的檢查", async () => {
  await ok("/interfaces/given", "POST", { id: el("電源次系統").id, given: true });
  assert.ok(el("電源次系統").tags.includes("GivenSpec"));
  assert.equal(ifr.parts.find((p: any) => p.name === "電源次系統").given, true);
  assert.equal(ifr.interfaces[0].ends[0].given, true);
  assert.ok(ifr.verification.some((r: any) => r.source === "given" && r.name.startsWith("電源次系統")));
  await ok("/interfaces/given", "POST", { id: el("電源次系統").id, given: false });
  assert.equal(el("電源次系統").tags.includes("GivenSpec"), false);
});

test("修改介面定義與單一介面的負責人；可從互連圖刪除", async () => {
  const d = el("供電介面", "InterfaceDefinition");
  const info = ifr.interfaceDefs.find((x: any) => x.id === d.id);
  await ok("/interfaces/defs", "POST", { ...info.attrs, id: d.id, kind: "electrical", methods: info.methods, rationale: info.rationale, ends: info.ends, constraints: [...info.constraints, { name: "電壓上限", text: "供電端.電壓 <= 12 [V]" }] });
  assert.equal(ifr.interfaceDefs.find((x: any) => x.id === d.id).constraints.length, 3);
  assert.deepEqual(ifr.interfaceDefs.find((x: any) => x.id === d.id).methods, ["test"], "修改時保留驗證方法");
  assert.equal(ifr.interfaces[0].result, "pass");
  const i = ifr.interfaces[0];
  await ok("/interfaces/usage", "POST", { id: i.id, ownerA: "丁", ownerB: "乙", maturity: "凍結" });
  assert.deepEqual([ifr.interfaces[0].ownerA, ifr.interfaces[0].maturity], ["丁", "凍結"]);
  // 新增元素的通用表單也能建連接埠與介面定義
  await ok("/elements", "POST", { category: "InterfacePort", name: "資料埠" });
  assert.equal(el("資料埠", "PortDefinition").category, "InterfacePort");
  await ok("/elements/delete", "POST", { id: i.id });
  const r = await ok("/interfaces", "GET");
  assert.equal(r.interfaces.length, 0);
});
