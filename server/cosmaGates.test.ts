// 第 D 期（F-90 到 F-97）：附加庫、CoSMA 專案的節點檢查、匯出與報告的分流。測試資料全部是合成的。
// 執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { analyze, shutdown } from "./engine.ts";
import type { Source } from "./engine.ts";
import { frameworkSources } from "./projects.ts";
import { evaluateGates, GATES } from "./gates.ts";
import type { GateStatus } from "./gates.ts";
import { exportWorkbook } from "./export.ts";
import { buildReport } from "./report.ts";
import { jriSnapshot } from "./fixtures/jriSnapshot.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ALL = GATES.map((g) => g.id);

async function readTree(dir: string): Promise<Source[]> {
  const out: Source[] = [];
  const walk = async (d: string, p: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(d, e.name), `${p}${e.name}/`);
      else if (e.name.endsWith(".sysml")) out.push([p + e.name, await fs.readFile(path.join(d, e.name), "utf8")]);
    }
  };
  await walk(dir, "");
  return out.sort(([a], [b]) => a.localeCompare(b));
}
const template = () => readTree(path.join(ROOT, "templates", "cosma"));
/** 和 projects.ts 的 sources() 相同：JRI.sysml 一律載入，CoSMA 專案另外載入基礎庫與附加庫 */
async function analyzeOwn(own: Source[]) {
  const fw = await frameworkSources(own.map(([, t]) => t));
  const lib: Source = ["JRI.sysml", await fs.readFile(path.join(ROOT, "library", "JRI.sysml"), "utf8")];
  return analyze([lib, ...fw, ...own], fw.map(([n]) => n));
}
/** 改範本裡的一個檔：find 一定要找得到，免得測試在沒改到的情況下誤過 */
function edit(own: Source[], file: string, find: string, replace: string): Source[] {
  return own.map(([n, t]) => {
    if (n !== file) return [n, t];
    assert.ok(t.includes(find), `${file} 裡找不到：${find}`);
    return [n, t.replace(find, replace)];
  });
}
const check = (gates: GateStatus[], id: string) => {
  const c = gates.flatMap((g) => g.checks).find((x) => x.id === id);
  assert.ok(c, `沒有這個檢查項目：${id}`);
  return c;
};

after(() => shutdown());

// ───────── F-91：CoSMA 專案逐項跑節點檢查 ─────────

test("F-91 範本建的 CoSMA 專案：逐項的節點檢查結果符合預期", async () => {
  const a = await analyzeOwn(await template());
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  const gates = evaluateGates(a, ALL, { "mdr.vv-plan": true }, 2);
  const got = Object.fromEntries(gates.flatMap((g) => g.checks).map((c) => [c.id, c.pass]));
  assert.deepEqual(got, {
    "proposal.stakeholders": true, "proposal.concerns": true, "proposal.concern-owner": true, "proposal.needs-capabilities": true,
    "mdr.purpose-refine": true, "mdr.moe": true, "mdr.context": true, "mdr.operations": true, "mdr.phases": true, "mdr.func-req": true,
    "mdr.func-req-refine": true, "mdr.risk": false, "mdr.gantt": true, "mdr.vv-plan": true,
    "pdr.components": true, "pdr.tech-req": true, "pdr.tech-req-refine": true, "pdr.functions": true, "pdr.tpm": false, "pdr.fos": false,
    "pdr.risk-mitigation": false, "pdr.interfaces": false,
    "cdr.satisfy": true, "cdr.verify": false, "cdr.method": false, "cdr.fos-final": false, "cdr.risk-final": false, "cdr.drawings": false,
    "trr.sop": false, "trr.roster": false, "trr.qc": true, "trr.prereq": false,
    "frr.anomalies": true, "frr.satisfied": true, "frr.launch-proc": false, "frr.range": false,
    "anomaly.root-cause": true, "closeout.validation": false, "closeout.whitepaper": false,
  });
  // 三個改寫的項目（第 10 節）的文字
  assert.equal(check(gates, "proposal.needs-capabilities").label, "定義需要、能力、目標、任務需求");
  assert.equal(check(gates, "proposal.needs-capabilities").detail, "需要 1、能力 1、目標 1、任務需求 1");
  assert.equal(check(gates, "mdr.moe").label, "每條任務需求至少有一個 #moe");
  assert.equal(check(gates, "mdr.operations").label, "定義作業，每個作業有參與者");
  // 沒有 CoSMA 對應的 JRI 項目不出現（期望、目的、使用案例、次系統）
  assert.equal(gates.flatMap((g) => g.checks).some((c) => /ngos|usecases|subsystems|expectation/.test(c.id)), false);
  // 需求驗證缺少的項目列出功能需求與技術需求
  assert.deepEqual(check(gates, "cdr.verify").missing.map((m) => m.name).sort(), ["CLR-R001 MotorImpulseRequirement", "FLR-R001 ThrustRequirement"]);
  // 節點的數量、順序、核可者和 JRI 相同
  assert.deepEqual(gates.map((g) => [g.id, g.approver, g.checks.length]), GATES.map((g) => [g.id, g.approver, g.checks.length]));
});

test("F-92 計畫提案「定義需要、能力、目標、任務需求」：少了能力就不通過", async () => {
  const own = edit(await template(), "Purpose/CapabilitiesPackage.sysml", ":> Capability", "");
  const a = await analyzeOwn(own);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  const c = check(evaluateGates(a, ALL, {}), "proposal.needs-capabilities");
  assert.equal(c.pass, false);
  assert.equal(c.detail, "需要 1、能力 0、目標 1、任務需求 1");
});

test("F-92 MDR「每條任務需求至少有一個 #moe」：多一條沒有 MOE 的任務需求就不通過，並列出它", async () => {
  const extra = `
    requirement def <'HLR-R002'> RecoverVehicle {
        doc /* 合成：飛行器應能回收。 */
        #refinement dependency 'HLR-R002' to CapabilitiesPackage::SuborbitalLaunch;
    }
}`;
  const file = "Requirements/MissionRequirementsPackage.sysml";
  const base = await template();
  const text = (base.find(([n]) => n === file) as Source)[1];
  const own = base.map(([n, t]): Source => (n === file ? [n, t.slice(0, t.lastIndexOf("}")) + extra + "\n"] : [n, t]));
  assert.notEqual(text, (own.find(([n]) => n === file) as Source)[1]);
  const a = await analyzeOwn(own);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  const c = check(evaluateGates(a, ALL, {}), "mdr.moe");
  assert.equal(c.pass, false);
  assert.equal(c.detail, "1／2 項缺少 #moe");
  assert.deepEqual(c.missing.map((m) => m.name), ["HLR-R002 RecoverVehicle"]);
  // 把 MOE 標記拿掉，它就只是另一條任務需求：三條都沒有 MOE
  const noTag = edit(own, file, "#moe requirement def", "requirement def");
  const c2 = check(evaluateGates(await analyzeOwn(noTag), ALL, {}), "mdr.moe");
  assert.equal(c2.pass, false);
  assert.equal(c2.detail, "3／3 項缺少 #moe");
});

test("F-92 MDR「定義作業，每個作業有參與者」：沒有參與者的作業不通過；沒有作業也不通過", async () => {
  const file = "Operation/OperationsPackage.sysml";
  const own = edit(await template(), file, "\n}", `
    action def CountDown :> Operation {
        doc /* 合成：沒有參與者的作業。 */
    }
}`);
  const a = await analyzeOwn(own);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  const c = check(evaluateGates(a, ALL, {}), "mdr.operations");
  assert.equal(c.pass, false);
  assert.equal(c.detail, "1／2 個作業沒有參與者");
  assert.deepEqual(c.missing.map((m) => m.name), ["CountDown"]);
  // 作業不再特化 Operation：沒有作業
  const none = edit(await template(), file, "action def IgniteMotor :> Operation", "action def IgniteMotor");
  const c2 = check(evaluateGates(await analyzeOwn(none), ALL, {}), "mdr.operations");
  assert.equal(c2.pass, false);
  assert.equal(c2.detail, "尚未建立作業");
});

// ───────── F-90：附加庫 ─────────

const ADDON_MODEL: Source = ["Addon/JRIRecordsPackage.sysml", `/* 合成：附加庫的元素在 CoSMA 專案裡使用。數值都是假的。 */
package JRIRecordsPackage {
    private import ScalarValues::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import FunctionalRequirementsPackage::*;
    private import TechnicalRequirementsPackage::*;
    private import TechnicalComponentsPackage::*;

    part def TestMotor :> HardwareComponent {
        #tpm attribute peakThrust : Real;
    }
    verification <'VER-001'> thrustTest : VerificationEvent {
        objective { verify requirement : MotorImpulseRequirement; verify requirement : ThrustRequirement; }
        @VerificationMethod { kind = VerificationMethodKind::test; }
    }
    verification <'VAL-001'> flightReview : ValidationEvent;
    item <'RISK-001'> chuteFailure : Risk { :>> severity = 4; :>> likelihood = 2; :>> mitigation = "合成"; }
    item <'FOS-001'> caseBurst : SafetyFactor { :>> required = 1.5; :>> actual = 2.0; }
    item <'SOP-001'> staticFire : SOP { :>> documentRef = "SYN-001"; }
    item <'ROS-001'> igniter : RosterEntry { :>> person = "合成"; :>> duty = "點火"; }
    item <'QC-001'> nozzle : QCRecord { :>> finalSignOff = "合成"; }
    item <'ANM-001'> delay : Anomaly { :>> status = "結案"; :>> rootCause = "合成"; :>> correction = "合成"; }
    requirement def <'TR-900'> SourcedRequirement {
        @Source { sourceDoc = "DOC-001"; sourceRef = "1.2"; }
    }
}
`];

test("F-90 附加庫的元素在 CoSMA 專案裡可以用，歸為附加庫一區、不在五層", async () => {
  const a = await analyzeOwn([...await template(), ADDON_MODEL]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  const by = (name: string) => a.elements.find((e) => e.name === name && e.file === ADDON_MODEL[0]);
  const want: [string, string][] = [["thrustTest", "VerificationEvent"], ["flightReview", "ValidationEvent"], ["chuteFailure", "Risk"], ["caseBurst", "SafetyFactor"],
    ["staticFire", "SOP"], ["igniter", "RosterEntry"], ["nozzle", "QCRecord"], ["delay", "Anomaly"]];
  for (const [name, cat] of want) {
    assert.equal(by(name)?.category, cat, name);
    assert.equal(by(name)?.layer, "addon", name);
  }
  assert.deepEqual(by("peakThrust")?.tags, ["TPM"]);
  assert.equal(by("SourcedRequirement")?.attrs.sourceDoc, "\"DOC-001\"".replace(/"/g, "") === by("SourcedRequirement")?.attrs.sourceDoc ? "DOC-001" : by("SourcedRequirement")?.attrs.sourceDoc);
  assert.match(by("SourcedRequirement")?.attrs.sourceDoc ?? "", /DOC-001/);
  assert.match(by("thrustTest")?.attrs.kind ?? "", /test/);
  // 附加庫本身是共用的、不在五層
  const lib = a.elements.filter((e) => e.qualifiedName.startsWith("JRIAddonPackage::"));
  assert.ok(lib.length > 0 && lib.every((e) => e.shared && e.layer === "addon"));
  // 節點檢查看得到附加庫的項目
  const gates = evaluateGates(a, ALL, {});
  for (const id of ["mdr.risk", "pdr.tpm", "pdr.fos", "pdr.risk-mitigation", "cdr.verify", "cdr.method", "cdr.fos-final", "trr.sop", "trr.roster", "trr.qc", "frr.anomalies", "anomaly.root-cause", "closeout.validation"]) {
    assert.equal(check(gates, id).pass, true, `${id}：${check(gates, id).detail}`);
  }
  assert.equal(check(gates, "cdr.risk-final").pass, true);
});

test("F-90 附加庫與 JRI.sysml 同名的標記：一個套件只匯入一個就不衝突；兩個都匯入時解析器明確回報", async () => {
  const one: Source = ["M.sysml", `package M {
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import ScalarValues::*;
    part def Motor :> HardwareComponent { #tpm attribute thrust : Real; }
}`];
  const a = await analyzeOwn([one]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  assert.deepEqual(a.elements.find((e) => e.name === "thrust")?.tags, ["TPM"]);
  const both: Source = ["M.sysml", one[1].replace("private import JRIAddonPackage::*;", "private import JRIAddonPackage::*;\n    private import JRI::*;")];
  const b = await analyzeOwn([both]);
  assert.equal(b.ok, false);
  assert.ok(b.diagnostics.some((d) => /JRI::TPM/.test(d.message) && /JRIAddonPackage::TPM/.test(d.message)), JSON.stringify(b.diagnostics.slice(0, 2)));
  // 非 CoSMA 專案不載入附加庫：JRI.sysml 的內容照舊
  const jri = await analyzeOwn([["model.sysml", await fs.readFile(path.join(ROOT, "templates", "sounding-rocket", "model.sysml"), "utf8")]]);
  assert.equal(jri.elements.some((e) => e.qualifiedName.startsWith("JRIAddonPackage")), false);
  // JRI.sysml 沒有改（第 C 期的內容）
  assert.match(await fs.readFile(path.join(ROOT, "library", "JRI.sysml"), "utf8"), /metadata def <tpm> TPM/);
});

// ───────── F-94、F-95：匯出與報告 ─────────

test("F-94 F-95 CoSMA 專案的匯出與報告用 CoSMA 元素與五層", async () => {
  const a = await analyzeOwn([...await template(), ADDON_MODEL]);
  const project = { id: "cs", name: "合成 CoSMA", kind: "annual", template: "cosma", createdAt: "2026-01-01T00:00:00.000Z", gates: ALL, manual: {}, signoffs: [] } as any;
  const plan = { tasks: [], costs: [], people: [], docs: [], milestones: {} } as any;
  const gates = evaluateGates(a, ALL, {});
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportWorkbook(project, a, gates, plan) as any);
  const rows = (name: string) => { const ws = wb.getWorksheet(name); assert.ok(ws, `沒有工作表：${name}`); const out: string[][] = []; ws.eachRow((r) => out.push((r.values as unknown[]).slice(1).map((v) => String(v ?? "")))); return out; };
  const names = wb.worksheets.map((w) => w.name);
  for (const n of ["Purpose", "五層", "邏輯與技術元件", "任務階段作業與功能"]) assert.ok(names.includes(n), n);
  for (const n of ["期望與NGO", "結構分解", "任務階段與功能"]) assert.ok(!names.includes(n), n);
  // 附加庫與專案管理的表照舊
  for (const n of ["FMEA", "安全係數", "SOP", "名冊", "異常報告", "加工QC", "節點完成度", "需求驗證矩陣", "驗證與確認事件", "TPM"]) assert.ok(names.includes(n), n);
  const req = rows("需求矩陣");
  assert.equal(req[0][5], "細化到");
  for (const [id, zh] of [["FLR-R001", "功能需求"], ["CLR-R001", "技術需求"], ["MOP-001", "性能量度"]]) assert.ok(req.some((r) => r[0] === id && r[1] === zh), id);
  assert.ok(!req.some((r) => r[0] === "HLR-R001" || r[0] === "MOE-001"), "任務需求與 MOE 在 Purpose 表，不在需求矩陣");
  const flr = req.find((r) => r[0] === "FLR-R001") as string[];
  assert.equal(flr[5], "HLR-R001 ReachTargetAltitude");
  assert.equal(flr[7], "測試 Test");
  assert.equal(flr[8], "VER-001 thrustTest");
  assert.ok(rows("五層").slice(1).every((r) => /^(Purpose|Operational|Functional|Logical|Technical) /.test(r[0])));
  assert.ok(rows("五層").some((r) => r[1] === "作業" && r[3] === "IgniteMotor"));
  assert.ok(!rows("五層").some((r) => r[3] === "chuteFailure"), "附加庫的元素不在五層");
  assert.deepEqual(rows("任務階段作業與功能").find((r) => r[2] === "IgniteMotor")?.[4], "launchTeam\nlaunchRail");
  assert.equal(rows("任務階段作業與功能").find((r) => r[2] === "ProvideThrust")?.[6], "PropulsionChain");
  assert.ok(rows("FMEA").some((r) => r[0] === "RISK-001"));
  assert.ok(rows("TPM").some((r) => r[1] === "peakThrust"));
  assert.ok(rows("需求驗證矩陣").some((r) => r[0] === "CLR-R001" && r[3] === "VER-001"));

  const r = buildReport(project, a, gates, plan, { inputs: {} as any, result: null, bindings: [] }, "mdr", "HEAD");
  const heads = r.sections.map((s) => s.heading);
  for (const h of ["2　Purpose：利害關係人與任務目標", "2.3　作業", "3　五層架構", "3.1　五層元素數量", "4.1　需求表", "4.2　需求驗證矩陣", "5.1　風險評估"]) assert.ok(heads.includes(h), h);
  for (const h of ["2.3　使用案例", "3.1　結構分解", "2.2　期望、需要、目標、目的與效能量度"]) assert.ok(!heads.includes(h), h);
  const layers = r.sections.find((s) => s.heading === "3.1　五層元素數量")?.table?.rows ?? [];
  assert.deepEqual(layers.map((x) => x[0]), ["Purpose 為什麼", "Operational 何時", "Functional 做什麼", "Logical 誰負責", "Technical 怎麼做出來"]);
  assert.ok(layers.every((x) => Number(x[1]) > 0));
  const ops = r.sections.find((s) => s.heading === "2.3　作業")?.table?.rows ?? [];
  assert.deepEqual(ops.map((x) => [x[1], x[3]]), [["IgniteMotor", "launchTeam；launchRail"]]);
  const checks = r.sections.find((s) => s.heading === "1.1　節點檢查")?.table?.rows.map((x) => x[0]);
  assert.ok(checks?.includes("每條任務需求至少有一個 #moe"));
});

// ───────── F-97：非 CoSMA 專案前後一致 ─────────

test("F-97 非 CoSMA 專案（templates/sounding-rocket）的節點檢查、匯出與報告和第 C 期完全相同", async () => {
  const baseline = JSON.parse(await fs.readFile(path.join(ROOT, "server", "fixtures", "jri-baseline.json"), "utf8"));
  const now = await jriSnapshot() as typeof baseline;
  assert.deepEqual(now.gates, baseline.gates);
  assert.deepEqual(now.sheets, baseline.sheets);
  assert.deepEqual(now.reports, baseline.reports);
  assert.deepEqual([now.ok, now.elements, now.relations], [baseline.ok, baseline.elements, baseline.relations]);
});
