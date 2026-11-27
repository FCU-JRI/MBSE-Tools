// Excel 匯出：NASA-HDBK-1009A 第 8、9 章的表格，加上風險、安全、作業與品質的表格。
import ExcelJS from "exceljs";
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";
import { CATEGORY, TPM_GATES } from "./metamodel.ts";
import type { GateStatus } from "./gates.ts";
import type { Project } from "./projects.ts";
import type { Pm } from "./pm.ts";
import { PRIORITY_ZH } from "./pm.ts";
import { formulasOf } from "./routes/tables.ts";

const METHOD: Record<string, string> = {
  "VerificationMethodKind::test": "測試 Test",
  "VerificationMethodKind::analyze": "分析 Analysis",
  "VerificationMethodKind::inspect": "檢查 Inspection",
  "VerificationMethodKind::demo": "展示 Demonstration",
};

export async function exportWorkbook(project: Project, a: Analysis, gates: GateStatus[], plan: Pm = { tasks: [], costs: [], people: [], docs: [], milestones: {} }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JRI MBSE";
  wb.created = new Date();

  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const label = (id: string) => {
    const e = byId.get(id);
    return e ? (e.shortName ? `${e.shortName} ${e.name}` : e.name) : "";
  };
  const structural = new Set(["System", "Subsystem", "Component", "ExternalEntity", "DesignAlternative"]);
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
  const reqs = of("MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP");
const src = (e: Element) => { const d = plan.docs.find((x) => x.id === e.attrs.sourceDoc); return e.attrs.sourceDoc ? `${e.attrs.sourceDoc}${d ? " " + d.title : ""}${e.attrs.sourceRef ? " §" + e.attrs.sourceRef : ""}` : ""; };
  sheet("需求矩陣", [["編號", 14], ["層級", 14], ["名稱", 22], ["需求內容", 50], ["出處", 28], ["衍生自", 30], ["滿足者", 22], ["驗證方法", 12], ["驗證事件", 28], ["計算判定", 12]],
    reqs.map((e) => {
      const ev = a.relations.filter((x) => x.kind === "verify" && x.to === e.id).map((x) => byId.get(x.from)).filter(Boolean) as Element[];
      return [e.shortName ?? "", catZh(e), e.name, e.doc, src(e), outs(e, "derive", "refine", "trace"), ins(e, "satisfy"), [...new Set(ev.map((v) => METHOD[v.attrs.kind ?? ""] ?? ""))].filter(Boolean).join("、"), ins(e, "verify"), satZh(e)];
    }));
  sheet("文件", [["編號", 12], ["名稱", 36], ["類型", 12], ["版次", 12], ["連結", 60], ["備註", 30]], plan.docs.map((d) => [d.id, d.title, d.type, d.revision, d.url, d.note]));

  const vers = of("VerificationEvent", "ValidationEvent");
  const rvm: (string | number)[][] = [];
  for (const r of reqs) {
    const events = a.relations.filter((x) => x.kind === "verify" && x.to === r.id).map((x) => byId.get(x.from)).filter(Boolean) as Element[];
    if (events.length === 0) rvm.push([r.shortName ?? "", r.name, r.doc, "", "", "", "未規劃"]);
    for (const v of events) rvm.push([r.shortName ?? "", r.name, r.doc, v.shortName ?? "", v.name, METHOD[v.attrs.kind ?? ""] ?? "", v.doc]);
  }
  sheet("需求驗證矩陣", [["需求編號", 14], ["需求名稱", 22], ["需求內容", 44], ["驗證編號", 12], ["驗證事件", 26], ["方法", 16], ["驗證說明", 40]], rvm);

  // 驗證矩陣：需求 × 驗證／確認事件，● 表示該事件驗證該需求；與網頁表格頁的「驗證矩陣」相同
  const verifies = (ev: Element, r: Element) => a.relations.some((x) => x.kind === "verify" && ((x.from === ev.id && x.to === r.id) || (x.from === r.id && x.to === ev.id)));
  sheet("驗證矩陣", [["需求", 36], ...vers.map((v): [string, number] => [v.shortName ?? v.name, 12]), ["判定", 10], ["缺口", 10]],
    reqs.map((r) => [`${r.shortName ?? ""} ${r.name}`.trim(), ...vers.map((v) => (verifies(v, r) ? "●" : "")), { holds: "PASS", fails: "FAIL" }[sat.get(r.qualifiedName) ?? ""] ?? "", vers.some((v) => verifies(v, r)) ? "" : "缺驗證"]));

  const formulas = await formulasOf(project.id).catch(() => []);
  sheet("公式清單", [["種類", 16], ["名稱", 24], ["所屬", 34], ["算式", 60], ["輸入", 28], ["結果／判定", 12]],
    formulas.map((f) => [`${f.kind}${f.def ? " def" : ""}`, f.name || byId.get(f.selectId ?? "")?.name || "", f.owner.replace(/^Project::/, ""), f.expr, f.inputs.join("\n"), f.status === "holds" ? "PASS" : f.status === "fails" ? "FAIL" : f.status === "definition" ? "定義" : "未判定"]));

  sheet("驗證與確認事件", [["編號", 12], ["類別", 12], ["名稱", 26], ["方法", 16], ["說明", 44], ["驗證的需求", 32]],
    vers.map((e) => [e.shortName ?? "", catZh(e), e.name, METHOD[e.attrs.kind ?? ""] ?? "", e.doc, outs(e, "verify")]));

  sheet("結構分解", [["類別", 12], ["編號", 12], ["名稱", 24], ["上層", 24], ["屬性", 44]],
    of("System", "Subsystem", "Component", "ExternalEntity").map((e) => {
      const attrs = a.elements.filter((x) => x.owner === e.id && x.kind === "AttributeUsage").map((x) => `${x.name}${x.tags.includes("TPM") ? "（TPM）" : ""}`).join("\n");
      const parents = a.elements.filter((x) => x.kind === "PartUsage" && x.types.includes(e.name) && x.owner).map((x) => byId.get(x.owner as string)?.name ?? "").filter(Boolean);
      return [catZh(e), e.shortName ?? "", e.name, [...new Set(parents)].join("\n"), attrs];
    }));

  // TPM：專案啟用的審查節點各一欄（@TpmTrend），加門檻與餘裕（F 包）
  const tpmGates = TPM_GATES.filter(([g]) => project.gates.includes(g));
  const numOf = (v: string | undefined) => { const m = String(v ?? "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
  sheet("TPM", [["編號", 12], ["所屬", 24], ["名稱", 22], ["門檻", 14], ...tpmGates.map(([, , zh]): [string, number] => [zh, 10]), ["餘裕", 10], ["判定", 10], ["為什麼", 36], ["判定條件", 36]],
    a.elements.filter((e) => e.tags.includes("TPM") && !e.shared).map((e) => {
      const vals = tpmGates.map(([, f]) => numOf(e.attrs[`at${f}`]));
      const last = [...vals].reverse().find((v) => v != null) ?? null, thr = numOf(e.attrs.target), ge = /≥|>=/.test(e.attrs.target ?? "");
      const m = last == null || thr == null ? null : ge ? last - thr : thr - last;
      return [e.shortName ?? "", byId.get(e.owner ?? "")?.name ?? "", e.name, e.attrs.target ?? "", ...vals.map((v) => v ?? ""), m == null ? "" : +m.toFixed(3), m == null ? "" : m >= 0 ? "符合" : "不符合", e.attrs.why ?? "", e.attrs.judge ?? ""];
    }));

  sheet("任務階段與功能", [["類別", 12], ["編號", 12], ["名稱", 24], ["上層", 20], ["下一步", 24], ["分配給", 24]],
    of("MissionPhase", "Function").map((e) => [catZh(e), e.shortName ?? "", e.name, byId.get(e.owner ?? "")?.kind === "ActionUsage" ? byId.get(e.owner as string)?.name ?? "" : "", outs(e, "succession"), outs(e, "allocate")]));

  sheet("FMEA", [["編號", 12], ["名稱", 22], ["失效模式", 26], ["影響", 26], ["原因", 26], ["嚴重度 S", 9], ["可能性 O", 9], ["偵測度 D", 9], ["風險值 S×O", 10], ["RPN S×O×D", 11], ["緩解措施", 36], ["緩解後 S", 9], ["緩解後 O", 9], ["緩解後風險值", 12], ["回頭修正", 36], ["修正了", 24], ["負責人", 14], ["狀態", 10]],
    of("Risk").map((e) => {
      const n = (k: string) => Number(e.attrs[k]) || 0;
      const s = n("severity"), l = n("likelihood"), d = n("detection"), rs = n("residualSeverity"), rl = n("residualLikelihood");
      return [e.shortName ?? "", e.name, e.attrs.failureMode ?? "", e.attrs.effect ?? "", e.attrs.cause ?? "", s || "", l || "", d || "", s * l || "", s * l * d || "", e.attrs.mitigation ?? "", rs || "", rl || "", rs * rl || "", e.attrs.fixNote ?? "", outs(e, "fix"), e.attrs.owner ?? "", e.attrs.status ?? ""];
    }));

  // 方案比較（F 包）：每個準則一列，含權重、評分標準、各候選的分數與調整後分數；方案的權重敏感度
  const decisions = of("DesignDecision");
  const chosen = new Set(a.relations.filter((r) => r.kind === "trace" && decisions.some((d) => d.id === r.from)).map((r) => r.to));
  const alts = of("DesignAlternative");
  const variantsOf = (alt: Element) => a.elements.filter((e) => e.owner === alt.id && e.kind === "PartUsage");
  const scale = (r: Element) => ["1", "3", "5"].filter((k) => r.attrs[`scale${k}`]).map((k) => `${k}＝${r.attrs[`scale${k}`]}`).join("；");
  const tradeRows: (string | number)[][] = [];
  for (const alt of alts) {
    const crit = a.relations.filter((r) => r.kind === "trace" && r.from === alt.id).map((r) => byId.get(r.to)).filter((x): x is Element => !!x && x.kind === "RequirementUsage");
    for (const v of variantsOf(alt)) for (const c of crit) {
      const k = (c.shortName ?? "").replace(/\W/g, "_");
      tradeRows.push([label(alt.id), v.name, chosen.has(v.id) ? "選定" : variantsOf(alt).some((x) => chosen.has(x.id)) ? "否決" : "待決", label(c.id), Number(c.attrs.weight ?? 1), scale(c), v.attrs[`score_${k}`] ?? "", v.attrs[`adjusted_${k}`] ?? "", alt.attrs.sensitivity ?? ""]);
    }
  }
  sheet("方案比較", [["方案", 24], ["候選", 22], ["狀態", 8], ["準則", 24], ["權重", 8], ["評分標準", 40], ["分數", 8], ["調整後分數", 10], ["權重敏感度", 40]], tradeRows);
  sheet("候選方案", [["方案", 24], ["候選", 24], ["狀態", 8], ["否決原因", 44]],
    alts.flatMap((alt) => variantsOf(alt).map((v) => [label(alt.id), v.name, chosen.has(v.id) ? "選定" : variantsOf(alt).some((x) => chosen.has(x.id)) ? "否決" : "待決", v.attrs.rejectWhy ?? ""])));
  sheet("決策", [["編號", 12], ["名稱", 24], ["方案／選定", 30], ["決策人", 14], ["日期", 12], ["理由", 40], ["放行／喊卡", 10], ["喊卡原因", 40]],
    decisions.map((d) => [d.shortName ?? "", d.name, outs(d, "trace"), d.attrs.decidedBy ?? "", d.attrs.decidedOn ?? "", d.attrs.rationale ?? "", d.attrs.releaseStatus === "hold" ? "喊卡中" : "已放行", d.attrs.holdReason ?? ""]));
  const refCount = new Map<string, number>();
  for (const r of a.relations) refCount.set(r.to, (refCount.get(r.to) ?? 0) + 1);
  sheet("模型元素總表", [["編號", 14], ["名稱", 26], ["類別", 14], ["為什麼", 44], ["判定條件", 44], ["被引用數", 10]],
    of(...CATEGORY.keys()).filter((e) => !e.shared)
      .map((e) => [e.shortName ?? "", e.name, catZh(e), e.attrs.why ?? "", e.attrs.judge ?? "", refCount.get(e.id) ?? 0]));

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
