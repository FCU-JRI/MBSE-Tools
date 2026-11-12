// Excel 匯出：NASA-HDBK-1009A 第 8、9 章的表格，加上風險、安全、作業與品質的表格。
import ExcelJS from "exceljs";
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";
import { CATEGORY } from "./metamodel.ts";
import type { GateStatus } from "./gates.ts";
import type { Project } from "./projects.ts";
import type { Pm } from "./pm.ts";
import { PRIORITY_ZH } from "./pm.ts";

const METHOD: Record<string, string> = {
  "Method::byTest": "測試 Test",
  "Method::byAnalysis": "分析 Analysis",
  "Method::byInspection": "檢查 Inspection",
  "Method::byDemonstration": "展示 Demonstration",
};

export async function exportWorkbook(project: Project, a: Analysis, gates: GateStatus[], plan: Pm = { tasks: [], costs: [], people: [] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JRI MBSE";
  wb.created = new Date();

  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const label = (id: string) => {
    const e = byId.get(id);
    return e ? (e.shortName ? `${e.shortName} ${e.name}` : e.name) : "";
  };
  const structural = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);
  const of = (...cats: string[]) =>
    a.elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" &&
      (structural.has(e.category) ? e.kind === "PartDefinition" : /Usage$/.test(e.kind)));
  const outs = (e: Element, ...kinds: string[]) => a.relations.filter((r) => r.from === e.id && kinds.includes(r.kind)).map((r) => label(r.to)).join("\n");
  const ins = (e: Element, ...kinds: string[]) => a.relations.filter((r) => r.to === e.id && kinds.includes(r.kind)).map((r) => label(r.from)).join("\n");
  const catZh = (e: Element) => CATEGORY.get(e.category ?? "")?.zh ?? "";

  const sheet = (name: string, columns: [string, number][], rows: (string | number)[][]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = columns.map(([header, width]) => ({ header, width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF1" } };
    for (const r of rows) ws.addRow(r);
    ws.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  };

  sheet("利害關係人", [["編號", 12], ["名稱", 22], ["角色與關注點", 40], ["相關期望", 40]],
    of("Stakeholder").map((e) => [e.shortName ?? "", e.name, e.attrs.role ?? "", ins(e, "trace")]));

  sheet("期望與NGO", [["編號", 12], ["類別", 12], ["名稱", 24], ["內容", 50], ["來源（衍生／追溯）", 32], ["效能量度", 28]],
    of("Expectation", "Need", "Goal", "Objective", "MOE").map((e) => [e.shortName ?? "", catZh(e), e.name, e.doc, outs(e, "derive", "refine", "trace"), ins(e, "refine")]));

  const sat = new Map(a.satisfaction.map((s) => [s.requirement, s.status]));
  const satZh = (e: Element) => ({ holds: "滿足", fails: "不滿足", undecided: "未判定" } as Record<string, string>)[sat.get(e.qualifiedName) ?? ""] ?? "";
  const reqs = of("SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP");
  sheet("需求表", [["編號", 14], ["層級", 14], ["名稱", 22], ["需求內容", 50], ["衍生自", 30], ["滿足者", 22], ["驗證事件", 28], ["計算判定", 12]],
    reqs.map((e) => [e.shortName ?? "", catZh(e), e.name, e.doc, outs(e, "derive", "refine", "trace"), ins(e, "satisfy"), ins(e, "verify"), satZh(e)]));

  const vers = of("VerificationEvent", "ValidationEvent");
  const rvm: (string | number)[][] = [];
  for (const r of reqs) {
    const events = a.relations.filter((x) => x.kind === "verify" && x.to === r.id).map((x) => byId.get(x.from)).filter(Boolean) as Element[];
    if (events.length === 0) rvm.push([r.shortName ?? "", r.name, r.doc, "", "", "", "未規劃"]);
    for (const v of events) rvm.push([r.shortName ?? "", r.name, r.doc, v.shortName ?? "", v.name, METHOD[v.attrs.kind ?? ""] ?? "", v.doc]);
  }
  sheet("需求驗證矩陣", [["需求編號", 14], ["需求名稱", 22], ["需求內容", 44], ["驗證編號", 12], ["驗證事件", 26], ["方法", 16], ["驗證說明", 40]], rvm);

  sheet("驗證與確認事件", [["編號", 12], ["類別", 12], ["名稱", 26], ["方法", 16], ["說明", 44], ["驗證的需求", 32]],
    vers.map((e) => [e.shortName ?? "", catZh(e), e.name, METHOD[e.attrs.kind ?? ""] ?? "", e.doc, outs(e, "verify")]));

  sheet("結構分解", [["類別", 12], ["編號", 12], ["名稱", 24], ["上層", 24], ["屬性", 44]],
    of("System", "Subsystem", "Component", "ExternalEntity").map((e) => {
      const attrs = a.elements.filter((x) => x.owner === e.id && x.kind === "AttributeUsage").map((x) => `${x.name}${x.tags.includes("TPM") ? "（TPM）" : ""}`).join("\n");
      const parents = a.elements.filter((x) => x.kind === "PartUsage" && x.types.includes(e.name) && x.owner).map((x) => byId.get(x.owner as string)?.name ?? "").filter(Boolean);
      return [catZh(e), e.shortName ?? "", e.name, [...new Set(parents)].join("\n"), attrs];
    }));

  sheet("TPM", [["所屬", 24], ["名稱", 22], ["型別", 20]],
    a.elements.filter((e) => e.tags.includes("TPM")).map((e) => [byId.get(e.owner ?? "")?.name ?? "", e.name, e.types.join(", ")]));

  sheet("任務階段與功能", [["類別", 12], ["編號", 12], ["名稱", 24], ["上層", 20], ["下一步", 24], ["分配給", 24]],
    of("MissionPhase", "Function").map((e) => [catZh(e), e.shortName ?? "", e.name, byId.get(e.owner ?? "")?.kind === "ActionUsage" ? byId.get(e.owner as string)?.name ?? "" : "", outs(e, "succession"), outs(e, "allocate")]));

  sheet("風險", [["編號", 12], ["名稱", 22], ["失效模式", 26], ["影響", 26], ["原因", 26], ["嚴重度", 9], ["可能性", 9], ["風險值", 9], ["緩解措施", 36], ["負責人", 14]],
    of("Risk").map((e) => {
      const s = Number(e.attrs.severity) || 0, l = Number(e.attrs.likelihood) || 0;
      return [e.shortName ?? "", e.name, e.attrs.failureMode ?? "", e.attrs.effect ?? "", e.attrs.cause ?? "", s || "", l || "", s * l || "", e.attrs.mitigation ?? "", e.attrs.owner ?? ""];
    }));

  const generic = (name: string, cat: string) => {
    const c = CATEGORY.get(cat);
    if (!c) return;
    sheet(name, [["編號", 12], ["名稱", 24], ...(c.fields ?? []).map((f) => [f.zh, 24] as [string, number]), ["說明", 36]],
      of(cat).map((e) => [e.shortName ?? "", e.name, ...(c.fields ?? []).map((f) => e.attrs[f.name] ?? ""), e.doc]));
  };
  generic("安全係數", "SafetyFactor");
  generic("SOP", "SOP");
  generic("名冊", "RosterEntry");
  generic("異常報告", "Anomaly");
  generic("加工QC", "QCRecord");

  const gateRows: (string | number)[][] = [];
  for (const g of gates) for (const c of g.checks) gateRows.push([`${g.zh} ${g.en}`, c.label, c.pass ? "完成" : "未完成", c.detail, c.missing.map((m) => m.name).join("\n")]);
  sheet("節點完成度", [["節點", 24], ["檢查項目", 40], ["狀態", 10], ["說明", 30], ["缺少的項目", 40]], gateRows);

  sheet("簽核紀錄", [["節點", 12], ["次系統", 18], ["決議", 10], ["簽核人", 14], ["職級", 16], ["意見", 40], ["時間", 22], ["模型版本", 12]],
    project.signoffs.map((s) => [s.gate.toUpperCase(), s.subsystem ?? "", s.decision, s.by, s.role, s.comment, s.at, s.commit]));

  sheet("時程", [["ID", 10], ["任務", 34], ["優先級", 14], ["責任工程師", 16], ["次系統", 16], ["開始", 12], ["結束", 12], ["相依", 14], ["節點", 10], ["連結的模型元素", 24], ["狀態", 10]],
    plan.tasks.map((t) => [t.id, t.title, `${t.priority} ${PRIORITY_ZH[t.priority]}`, t.re, t.subsystem, t.start, t.end, t.deps.join("、"), t.gate.toUpperCase(), t.links.join("、"), t.done ? "完成" : "進行中"]));
  sheet("成本", [["編號", 10], ["次系統", 16], ["項目", 34], ["預算", 12], ["實支", 12], ["差額", 12], ["狀態", 12], ["備註", 30]],
    [...plan.costs.map((c) => [c.id, c.subsystem, c.item, c.planned, c.actual, c.planned - c.actual, c.status, c.note] as (string | number)[]),
      ["", "", "合計", plan.costs.reduce((s, c) => s + c.planned, 0), plan.costs.reduce((s, c) => s + c.actual, 0), plan.costs.reduce((s, c) => s + c.planned - c.actual, 0), "", ""]]);
  sheet("人員", [["編號", 10], ["姓名", 16], ["AEAS 職級", 14], ["次系統", 16], ["職責", 34], ["負責的任務", 40]],
    plan.people.map((p) => [p.id, p.name, p.rank, p.subsystem, p.duty, plan.tasks.filter((t) => t.re === p.name).map((t) => `${t.id} ${t.title}`).join("\n")]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
