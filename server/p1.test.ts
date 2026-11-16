// P1：需求屬性、必填的驗證方法、需求矩陣（比賽附件 10 格式）與驗證矩陣。資料全部是合成的。
// 埠 18811／18812（docs/IMPL-PLAN.md 第 5 節）。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { analyze, shutdown } from "./engine.ts";
import { joinIds, metaTexts, normalizeInput, ReqInputError, reqInfo, VCRM_HEADERS, VCRM_TITLE, vcrmSections, verificationRows, VERIFIABLE } from "./method/p1-req.ts";
import { setMetaTexts } from "./method/p1.ts";

const PORT = 18811, PUB = 18812;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
const lib = await fs.readFile(new URL("../library/JRI.sysml", import.meta.url), "utf8");

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await r.arrayBuffer());
  let data: any = buf;
  try { data = JSON.parse(buf.toString("utf8")); } catch { /* xlsx */ }
  return { status: r.status, data, type: r.headers.get("content-type") ?? "" };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p1-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/bin/false" }, stdio: "ignore" });
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

// 合成模型：一個目的、一條有出處的期望、任務需求、系統需求、兩個次系統的需求（其中一條衍生出元件需求）、MOE、MOP
const MODEL = `package Project {
  private import JRI::*;
  package Stakeholders {
    part <'STK-001'> sponsor : Stakeholder;
    requirement <'EXP-001'> hard : Expectation { doc /* 合成的外部硬條件。 */ @Source { sourceDoc = "DOC-001"; } }
    requirement <'EXP-002'> soft : Expectation { doc /* 沒有出處的期望不進第一段。 */ }
  }
  package NGOs {
    requirement <'OBJ-001'> reach : Objective { doc /* 合成目的：到達 100 m。 */ }
    #trace dependency from Stakeholders::hard to Stakeholders::sponsor;
  }
  package Structure {
    part def <'SYS-001'> Vehicle :> System { part a : Alpha; part b : Beta; }
    part def <'SUB-001'> Alpha :> Subsystem { part c : Gizmo; }
    part def <'SUB-002'> Beta :> Subsystem;
    part def <'CMP-001'> Gizmo :> Component;
    part vehicle : Vehicle;
    part alpha : Alpha;
    part beta : Beta;
  }
  package Requirements {
    requirement <'REQ-MIS-001'> m1 : MissionRequirement {
      doc /* 任務應到達 100 m。 */
      @VerificationMethod { kind = VerificationMethodKind::demo; }
      @Rationale { text = "合成理由一"; }
      @RequirementInfo { reqStatus = RequirementStatusKind::checked; reqType = RequirementTypeKind::performance; verificationLead = "甲"; }
    }
    requirement <'REQ-MIS-002'> m2 : MissionRequirement { doc /* 任務應回收箭體。 */ @VerificationMethod { kind = (VerificationMethodKind::inspect, VerificationMethodKind::test); } }
    requirement <'REQ-SYS-001'> s1 : SystemRequirement { doc /* 系統應到達 100 m。 */ @VerificationMethod { kind = VerificationMethodKind::analyze; } }
    requirement <'REQ-SUB-001'> a1 : SubsystemRequirement { doc /* 甲次系統應提供 10 N。 */ @VerificationMethod { kind = VerificationMethodKind::test; } }
    requirement <'REQ-CMP-001'> c1 : ComponentRequirement { doc /* 小元件應承受 2 N。 */ @VerificationMethod { kind = VerificationMethodKind::test; } @RequirementInfo { reqStatus = RequirementStatusKind::tbc; } }
    requirement <'REQ-SUB-002'> b1 : SubsystemRequirement { doc /* 乙次系統應重於 1 kg。 */ }
    requirement <'REQ-SUB-003'> x1 : SubsystemRequirement { doc /* 沒有分配的次系統需求。 */ }
    requirement <'MOP-001'> p1 : MOP { doc /* 合成性能量度。 */ }
    #derivation connection { end #derive ::> m1; end #original ::> NGOs::reach; }
    #derivation connection { end #derive ::> m2; end #original ::> NGOs::reach; }
    #derivation connection { end #derive ::> s1; end #original ::> m1; }
    #derivation connection { end #derive ::> s1; end #original ::> m2; }
    #derivation connection { end #derive ::> a1; end #original ::> s1; }
    #derivation connection { end #derive ::> c1; end #original ::> a1; }
    #derivation connection { end #derive ::> b1; end #original ::> s1; }
    satisfy s1 by Structure::vehicle;
    satisfy a1 by Structure::alpha;
    satisfy b1 by Structure::beta;
  }
  package Verification {
    verification <'VER-001'> v1 : VerificationEvent { objective { verify Requirements::s1; } @VerificationMethod { kind = VerificationMethodKind::analyze; } }
  }
}`;

test("標準的 @VerificationMethod、@Rationale 與 @RequirementInfo 可以標在需求上，解析後讀得到", async () => {
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", MODEL]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
  const m1 = a.elements.find((e) => e.shortName === "REQ-MIS-001");
  assert.equal(m1?.category, "MissionRequirement");
  const i = reqInfo(m1 as any);
  assert.deepEqual(i.methods, ["demo"]);
  assert.equal(i.rationale, "合成理由一");
  assert.equal(i.status, "checked");
  assert.equal(i.type, "performance");
  assert.equal(i.verificationLead, "甲");
  assert.deepEqual(reqInfo(a.elements.find((e) => e.shortName === "REQ-MIS-002") as any).methods, ["inspect", "test"]);
});

test("需求矩陣依推導鏈分成四段，欄位照比賽範本", async () => {
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", MODEL]]);
  const s = vcrmSections(a);
  assert.deepEqual(s.map((x) => x.title), ["Mission statement & Concept", "Mission requirements", "System requirements", "Alpha Subsystem Requirement", "Beta Subsystem Requirement", "Unallocated Subsystem Requirement"]);
  assert.deepEqual(s[0].rows.map((r) => r.id), ["OBJ-001", "EXP-001"], "第一段：目的與有出處的期望");
  assert.equal(s[0].rows[1].tracedFrom, "STK-001");
  const m1 = s[1].rows[0];
  assert.deepEqual([m1.id, m1.text, m1.tracedFrom, m1.method, m1.level, m1.rationale, m1.status, m1.type, m1.lead], ["REQ-MIS-001", "任務應到達 100 m。", "OBJ-001", "Demonstration", "System", "合成理由一", "checked", "性能需求", "甲"]);
  assert.equal(s[1].rows[1].method, "Inspection/Test");
  const s1 = s[2].rows[0];
  assert.equal(s1.tracedFrom, "REQ-MIS-001/002");
  assert.equal(s1.owner, "vehicle");
  // 甲次系統：元件需求衍生自段內的次系統需求，排在後面、放第二欄
  assert.deepEqual(s[3].rows.map((r) => [r.id, r.child, r.level]), [["REQ-SUB-001", false, "Sub-system"], ["REQ-CMP-001", true, "Element"]]);
  assert.equal(s[3].rows[1].status, "TBC");
  // 乙次系統的需求沒寫方法，也沒有驗證事件：方法欄空白
  assert.equal(s[4].rows[0].method, "");
  assert.equal(joinIds(["A.1", "A.2", "B.1"]), "A.1/2/B.1");
});

test("驗證矩陣：每條需求的驗證方法、驗證事件、缺項", async () => {
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", MODEL]]);
  const rows = verificationRows(a);
  assert.ok(rows.every((r) => VERIFIABLE.includes(r.element.category as string)));
  assert.equal(rows[0].element.category, "MissionRequirement", "任務需求排在最前面");
  const s1 = rows.find((r) => r.element.shortName === "REQ-SYS-001");
  assert.deepEqual(s1?.events.map((e) => e.shortName), ["VER-001"]);
  assert.deepEqual(s1?.gaps, []);
  assert.deepEqual(rows.find((r) => r.element.shortName === "MOP-001")?.gaps, ["驗證方法", "驗證事件"]);
});

test("驗證方法必填：需要驗證的類別沒填就擋下；需要、目標可以不填", () => {
  for (const c of VERIFIABLE) assert.throws(() => normalizeInput(c, {}), ReqInputError, c);
  assert.doesNotThrow(() => normalizeInput("Need", {}));
  assert.deepEqual(normalizeInput("SystemRequirement", { method: ["byTest", "analyze", "test"] }).methods, ["test", "analyze"]);
  assert.throws(() => normalizeInput("SystemRequirement", { method: "guess" }), ReqInputError);
  assert.throws(() => normalizeInput("SystemRequirement", { method: "test", status: "done" }), ReqInputError);
  assert.throws(() => normalizeInput("SystemRequirement", { method: "test", type: "cost" }), ReqInputError);
});

test("修改共同屬性：取代既有的標記，沒有的接在後面", async () => {
  const src = `package Project {
  private import JRI::*;
  package Requirements {
    requirement <'REQ-SYS-001'> s1 : SystemRequirement {
        doc /* 合成。 */
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }
    requirement <'REQ-SYS-002'> s2 : SystemRequirement;
  }
}`;
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", src]]);
  const el = (sn: string, an = a) => an.elements.find((e) => e.shortName === sn) as any;
  let next = setMetaTexts(src, el("REQ-SYS-001"), metaTexts(normalizeInput("SystemRequirement", { method: ["analyze"], rationale: "合成理由", status: "pass", type: "safety", verificationLevel: "component" })));
  let b = await analyze([["JRI.sysml", lib], ["model.sysml", next]]);
  assert.equal(b.ok, true, JSON.stringify(b.diagnostics) + next);
  assert.deepEqual(reqInfo(el("REQ-SYS-001", b)), { methods: ["analyze"], verificationLead: "", verificationLevel: "component", responsible: "", rationale: "合成理由", status: "pass", type: "safety" });
  // 沒有主體的需求展開成大括號
  next = setMetaTexts(next, el("REQ-SYS-002", b), metaTexts(normalizeInput("SystemRequirement", { method: "inspect", responsible: "乙" })));
  b = await analyze([["JRI.sysml", lib], ["model.sysml", next]]);
  assert.equal(b.ok, true, next);
  assert.deepEqual([reqInfo(el("REQ-SYS-002", b)).methods, reqInfo(el("REQ-SYS-002", b)).responsible], [["inspect"], "乙"]);
  // 清掉理由與其他屬性
  next = setMetaTexts(next, el("REQ-SYS-001", b), metaTexts(normalizeInput("SystemRequirement", { method: "analyze" })));
  b = await analyze([["JRI.sysml", lib], ["model.sysml", next]]);
  assert.deepEqual(el("REQ-SYS-001", b).tags, ["VerificationMethod"]);
});

test("API：五種需求各建一條，必填檢查有效，匯出的欄位與段落和範本格式一致", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "p1", name: "P1 合成", kind: "annual", template: "blank" })).status, 200);
  const base = `${I}/api/projects/p1`;
  // 沒填驗證方法：擋下
  const no = await call(`${base}/requirements`, "POST", { category: "MissionRequirement", name: "沒有方法" });
  assert.equal(no.status, 400);
  assert.match(no.data.error, /驗證方法/);
  // 不是需求類別：擋下
  assert.equal((await call(`${base}/requirements`, "POST", { category: "Risk", name: "x", method: "test" })).status, 400);
  const kinds: [string, string][] = [["MissionRequirement", "demo"], ["SystemRequirement", "analyze"], ["SubsystemRequirement", "test"], ["ComponentRequirement", "inspect"], ["MOE", "analyze"], ["MOP", "test"]];
  let v: any;
  for (const [category, method] of kinds) {
    const r = await call(`${base}/requirements`, "POST", { category, name: `合成${category}`, doc: `${category} 應達到 1 個合成單位。`, method, type: "functional", status: "tbc", rationale: "合成", verificationLead: "丙" });
    assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
    v = r.data;
  }
  // 需要不必填驗證方法
  assert.equal((await call(`${base}/requirements`, "POST", { category: "Need", name: "合成需要" })).status, 200);
  v = (await call(base)).data;
  for (const [category, method] of kinds) {
    const e = v.analysis.elements.find((x: any) => x.category === category && x.kind === "RequirementUsage");
    assert.ok(e, category);
    assert.deepEqual(reqInfo(e).methods, [method], category);
    assert.equal(reqInfo(e).type, "functional");
  }
  const mr = v.analysis.elements.find((x: any) => x.category === "MissionRequirement");
  assert.equal(mr.shortName, "REQ-MIS-001");

  // 修改屬性
  const upd = await call(`${base}/requirements/info`, "POST", { id: mr.id, method: ["demo", "test"], status: "checked", type: "safety", rationale: "改過的合成理由" });
  assert.equal(upd.status, 200, JSON.stringify(upd.data).slice(0, 300));
  const mr2 = upd.data.analysis.elements.find((x: any) => x.shortName === "REQ-MIS-001");
  assert.deepEqual(reqInfo(mr2), { methods: ["demo", "test"], verificationLead: "", verificationLevel: "", responsible: "", rationale: "改過的合成理由", status: "checked", type: "safety" });
  assert.equal((await call(`${base}/requirements/info`, "POST", { id: mr.id })).status, 400, "修改時也不能把驗證方法清空");

  // 匯出
  const x = await call(`${base}/requirements/vcrm.xlsx`);
  assert.equal(x.status, 200);
  assert.match(x.type, /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.data);
  const ws = wb.getWorksheet("Requirements document");
  assert.ok(ws);
  assert.equal(ws.getCell("A1").value, VCRM_TITLE);
  assert.ok(ws.model.merges.includes("A1:L1"));
  assert.ok(ws.model.merges.includes("B2:C2"));
  assert.equal(VCRM_HEADERS.length, 12);
  assert.deepEqual(["B2", "D2", "E2", "F2", "G2", "H2", "I2", "J2", "K2", "L2"].map((c) => String(ws.getCell(c).value).replace(/\n/g, " ")),
    ["需求編號 Requirement ID", "需求內容 Requirement text", "來源 Traced from", "Owner", "Verification method", "Verification lead", "Verification level", "需求原因 Rationale", "狀態", "需求類型"]);
  const titles: string[] = [];
  ws.eachRow((row) => { const t = row.getCell(1).value; if (t && row.number > 2 && !titles.includes(String(t))) titles.push(String(t)); });
  assert.deepEqual(titles, ["Mission statement & Concept", "Mission requirements", "System requirements", "Unallocated Subsystem Requirement"]);
  const rowOf = (id: string) => { let n = 0; ws.eachRow((row) => { if (row.getCell(2).value === id || row.getCell(3).value === id) n = row.number; }); return ws.getRow(n); };
  const m = rowOf("REQ-MIS-001");
  assert.deepEqual([4, 7, 9, 10, 11, 12].map((c) => m.getCell(c).value), ["MissionRequirement 應達到 1 個合成單位。", "Demonstration/Test", "System", "改過的合成理由", "checked", "安全需求"]);
  assert.equal(rowOf("REQ-SUB-001").getCell(9).value, "Sub-system");
  assert.equal(rowOf("REQ-CMP-001").getCell(9).value, "Element");
  // 段落之間空一行
  const mis = rowOf("REQ-MIS-001").number;
  assert.equal(ws.getRow(mis + 1).getCell(2).value ?? null, null);
  assert.equal(ws.getRow(mis + 2).getCell(1).value, "System requirements");
});
