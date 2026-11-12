// AEAS 審查節點與各節點應完成的 NASA-HDBK-1009A 產出物。
// 每個檢查回報是否通過，以及缺少的項目，讓成員知道還差什麼。
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";

export interface CheckResult {
  id: string;
  label: string;
  hint: string;
  manual: boolean;
  pass: boolean;
  detail: string;
  missing: { id: string; name: string }[];
}

export interface GateDef {
  id: string;
  zh: string;
  en: string;
  deadline: string | null;
  approver: string;
  purpose: string;
  perSubsystem: boolean;
  checks: Check[];
}

interface Check {
  id: string;
  label: string;
  hint: string;
  manual?: boolean;
  run?: (ctx: Ctx) => { pass: boolean; detail: string; missing?: Element[] };
}

interface Ctx {
  a: Analysis;
  tasks: number; // 甘特圖上的任務數
  of: (...categories: string[]) => Element[];
  hasOut: (e: Element, ...kinds: string[]) => boolean; // e 是關係的起點
  hasIn: (e: Element, ...kinds: string[]) => boolean; // e 是關係的終點
}

const REQS = ["SystemRequirement", "SubsystemRequirement", "ComponentRequirement"];

const atLeastOne = (label: string, ...cats: string[]) => (c: Ctx) => {
  const n = c.of(...cats).length;
  return { pass: n > 0, detail: n > 0 ? `已有 ${n} 項` : `尚未建立${label}` };
};

const every = (cats: string[], ok: (c: Ctx, e: Element) => boolean, need: string) => (c: Ctx) => {
  const all = c.of(...cats);
  const missing = all.filter((e) => !ok(c, e));
  if (all.length === 0) return { pass: false, detail: "尚無項目可檢查" };
  return {
    pass: missing.length === 0,
    detail: missing.length === 0 ? `${all.length} 項全部完成` : `${missing.length}／${all.length} 項缺少${need}`,
    missing,
  };
};

const attrFilled = (cats: string[], attrs: string[], need: string) =>
  every(cats, (_c, e) => attrs.every((k) => (e.attrs[k] ?? "").trim() !== ""), need);

export const GATES: GateDef[] = [
  {
    id: "proposal", zh: "計畫提案", en: "Project Proposal", deadline: "9/1 前", approver: "總工程師 [D-VII]", perSubsystem: false,
    purpose: "回應任務需求：說清楚為誰做、為什麼做、要達成什麼。",
    checks: [
      { id: "stakeholders", label: "列出利害關係人", hint: "到「需求」分頁新增利害關係人。", run: atLeastOne("利害關係人", "Stakeholder") },
      { id: "expectations", label: "寫下利害關係人期望", hint: "新增期望，並追溯到提出它的利害關係人。", run: atLeastOne("期望", "Expectation") },
      { id: "expectation-trace", label: "每項期望都追溯到利害關係人", hint: "在期望上建立「追溯到」關係。",
        run: every(["Expectation"], (c, e) => c.hasOut(e, "trace"), "追溯對象") },
      { id: "ngos", label: "定義需要、目標、目的", hint: "三者各至少一項，由上而下推導。",
        run: (c) => {
          const n = [c.of("Need").length, c.of("Goal").length, c.of("Objective").length];
          const pass = n.every((x) => x > 0);
          return { pass, detail: `需要 ${n[0]}、目標 ${n[1]}、目的 ${n[2]}` };
        } },
    ],
  },
  {
    id: "mdr", zh: "任務定義審查", en: "MDR", deadline: "9/15 前", approver: "管制官 [R-VIII]", perSubsystem: false,
    purpose: "確認任務概念可行、目標清楚，才能進入設計。",
    checks: [
      { id: "ngo-derive", label: "目標與目的都有上層來源", hint: "在目標、目的上建立「衍生自」關係。",
        run: every(["Goal", "Objective"], (c, e) => c.hasOut(e, "derive", "refine", "trace"), "上層來源") },
      { id: "moe", label: "每個目的都有效能量度（MOE）", hint: "新增 MOE 並以「細化」連到目的。",
        run: every(["Objective"], (c, e) => c.hasIn(e, "refine"), " MOE") },
      { id: "context", label: "定義系統與外部對象（系統脈絡）", hint: "到「結構」分頁新增系統與外部對象。", run: atLeastOne("系統", "System") },
      { id: "usecases", label: "定義使用案例", hint: "到「行為」新增使用案例，並追溯到相關的利害關係人。", run: atLeastOne("使用案例", "UseCase") },
      { id: "phases", label: "定義任務階段（執行概念）", hint: "到「行為」分頁新增任務階段並排出先後。", run: atLeastOne("任務階段", "MissionPhase") },
      { id: "sys-req", label: "建立系統層需求", hint: "到「需求」分頁新增系統層需求。", run: atLeastOne("系統層需求", "SystemRequirement") },
      { id: "sys-req-derive", label: "每條系統層需求都有來源", hint: "建立「衍生自」關係，連到目的或 MOE。",
        run: every(["SystemRequirement"], (c, e) => c.hasOut(e, "derive", "refine", "trace"), "來源") },
      { id: "risk", label: "初步風險評估", hint: "到「AEAS 項目」新增風險。", run: atLeastOne("風險", "Risk") },
      { id: "gantt", label: "任務時程與里程碑（甘特圖）", hint: "到「時程」分頁建立任務。AEAS 規定所有年度計畫都要有甘特圖。",
        run: (c) => ({ pass: c.tasks > 0, detail: c.tasks > 0 ? `已有 ${c.tasks} 項任務` : "尚未建立任務" }) },
      { id: "vv-plan", label: "驗證與確認計畫", hint: "由總工程師確認已說明各需求打算如何驗證。", manual: true },
    ],
  },
  {
    id: "pdr", zh: "初步設計審查", en: "PDR", deadline: null, approver: "管制官 [R-VIII]", perSubsystem: true,
    purpose: "確認初步設計能滿足需求、風險可接受。各次系統分場審查。",
    checks: [
      { id: "subsystems", label: "完成次系統分解", hint: "到「結構」分頁新增次系統。", run: atLeastOne("次系統", "Subsystem") },
      { id: "sub-req", label: "需求已分配到次系統", hint: "新增次系統層需求，並衍生自系統層需求。", run: atLeastOne("次系統層需求", "SubsystemRequirement") },
      { id: "sub-req-derive", label: "每條次系統層需求都有上層需求", hint: "建立「衍生自」關係。",
        run: every(["SubsystemRequirement"], (c, e) => c.hasOut(e, "derive"), "上層需求") },
      { id: "functions", label: "功能分解", hint: "到「行為」分頁新增功能。", run: atLeastOne("功能", "Function") },
      { id: "tpm", label: "識別技術性能量度（TPM）", hint: "在結構的屬性前加上 #tpm 標記。",
        run: (c) => { const n = c.a.elements.filter((e) => e.tags.includes("TPM")).length; return { pass: n > 0, detail: n ? `已標記 ${n} 項` : "尚未標記任何 TPM" }; } },
      { id: "fos", label: "初步安全係數評估", hint: "到「AEAS 項目」新增安全係數。", run: atLeastOne("安全係數", "SafetyFactor") },
      { id: "risk-mitigation", label: "每項風險都有緩解措施", hint: "補上風險的緩解措施與負責人。",
        run: attrFilled(["Risk"], ["mitigation"], "緩解措施") },
      { id: "interfaces", label: "高層架構與介面", hint: "由責任工程師確認介面已定義。", manual: true },
    ],
  },
  {
    id: "cdr", zh: "關鍵設計審查", en: "CDR", deadline: null, approver: "管制官 [R-VIII]", perSubsystem: false,
    purpose: "確認詳細設計成熟完整，可以開始製造。",
    checks: [
      { id: "satisfy", label: "每條需求都有負責滿足的系統或元件", hint: "在需求上建立「滿足」關係。",
        run: every(REQS, (c, e) => c.hasIn(e, "satisfy"), "滿足者") },
      { id: "verify", label: "每條需求都有驗證事件", hint: "到「驗證」分頁新增驗證事件並指定要驗證的需求。",
        run: every(REQS, (c, e) => c.hasIn(e, "verify"), "驗證事件") },
      { id: "method", label: "每個驗證事件都指定方法", hint: "測試、分析、檢查、展示四選一。",
        run: attrFilled(["VerificationEvent"], ["kind"], "驗證方法") },
      { id: "fos-final", label: "最終安全係數達到要求", hint: "補上實際值；實際值不得低於要求值。",
        run: every(["SafetyFactor"], (_c, e) => Number(e.attrs.actual) >= Number(e.attrs.required), "達標的實際值") },
      { id: "risk-final", label: "風險評估定案", hint: "嚴重度、可能性、緩解措施都要填。",
        run: attrFilled(["Risk"], ["severity", "likelihood", "mitigation"], "完整評估") },
      { id: "drawings", label: "工程圖與製造計畫", hint: "由責任工程師確認圖面含單位、公差與關鍵尺寸。", manual: true },
    ],
  },
  {
    id: "trr", zh: "測試準備審查", en: "TRR", deadline: null, approver: "高功率：指導老師 [F-VIII]；低功率：管制官 [R-VIII]", perSubsystem: false,
    purpose: "確認測試物、設施、人員與程序都準備好。這是安全協議的一部分，必須執行。",
    checks: [
      { id: "sop", label: "測試 SOP、安全協議與緊急程序", hint: "到「AEAS 項目」新增 SOP 並附文件連結。",
        run: attrFilled(["SOP"], ["documentRef"], "文件連結") },
      { id: "roster", label: "測試名冊", hint: "新增名冊成員。核可後不得更改。", run: attrFilled(["RosterEntry"], ["person", "duty"], "姓名或職責") },
      { id: "qc", label: "加工零件 QC 完成", hint: "每筆 QC 紀錄都要有最終簽核。",
        run: (c) => { const all = c.of("QCRecord"); const miss = all.filter((e) => !(e.attrs.finalSignOff ?? "").trim());
          return { pass: miss.length === 0, detail: all.length ? `${all.length - miss.length}／${all.length} 筆已最終簽核` : "沒有 QC 紀錄", missing: miss }; } },
      { id: "prereq", label: "先前審查皆已通過", hint: "CDR 必須已核可。", manual: true },
    ],
  },
  {
    id: "frr", zh: "飛行準備審查", en: "FRR", deadline: null, approver: "高功率：指導老師 [F-VIII]；低功率：管制官 [R-VIII]", perSubsystem: false,
    purpose: "確認所有系統、人員與支援設備都做好飛行準備，做出最終執行與否的決定。",
    checks: [
      { id: "anomalies", label: "沒有未結案的異常", hint: "把異常報告的狀態改為「結案」。",
        run: (c) => { const open = c.of("Anomaly").filter((e) => !/結案|closed/i.test(e.attrs.status ?? ""));
          return { pass: open.length === 0, detail: open.length ? `${open.length} 項未結案` : "無未結案異常", missing: open }; } },
      { id: "satisfied", label: "可計算的需求皆已滿足", hint: "模型中的數值不符合需求條件，請檢查設計值或需求。",
        run: (c) => { const bad = c.a.satisfaction.filter((s) => s.status === "fails");
          return { pass: bad.length === 0, detail: `${c.a.satisfaction.length} 項判定，${bad.length} 項不滿足` }; } },
      { id: "launch-proc", label: "發射程序、倒數程序與應變計畫", hint: "由總工程師確認。", manual: true },
      { id: "range", label: "發射場安全與法規", hint: "由指導老師確認。", manual: true },
    ],
  },
  {
    id: "anomaly", zh: "異常審查", en: "Anomaly Review", deadline: "測試後", approver: "管制官 [R-VIII]", perSubsystem: false,
    purpose: "有系統地記錄、分析並矯正測試中的異常。",
    checks: [
      { id: "root-cause", label: "每項異常都有根因與矯正措施", hint: "補上根本原因、矯正措施與預防措施。",
        run: (c) => { const all = c.of("Anomaly"); const miss = all.filter((e) => !["rootCause", "correction"].every((k) => (e.attrs[k] ?? "").trim()));
          return { pass: miss.length === 0, detail: all.length ? `${all.length - miss.length}／${all.length} 項完成` : "沒有異常紀錄", missing: miss }; } },
    ],
  },
  {
    id: "closeout", zh: "計畫收束", en: "Project Convergence", deadline: "6/1 前", approver: "總工程師 [D-VII]", perSubsystem: false,
    purpose: "確認成果符合期望，整理成白皮書。",
    checks: [
      { id: "validation", label: "完成確認事件", hint: "到「驗證」分頁新增確認事件。", run: atLeastOne("確認事件", "ValidationEvent") },
      { id: "whitepaper", label: "白皮書", hint: "由總工程師確認已撰寫。", manual: true },
    ],
  },
];

export interface GateStatus {
  id: string; zh: string; en: string; deadline: string | null; approver: string; purpose: string; perSubsystem: boolean;
  checks: CheckResult[];
  done: number;
  total: number;
}

export function evaluateGates(a: Analysis, enabled: string[], manualDone: Record<string, boolean>, tasks = 0): GateStatus[] {
  const out = new Set(a.relations.map((r) => `${r.from}|${r.kind}`));
  const inn = new Set(a.relations.map((r) => `${r.to}|${r.kind}`));
  const ctx: Ctx = {
    a,
    tasks,
    of: () => [],
    hasOut: (e, ...kinds) => kinds.some((k) => out.has(`${e.id}|${k}`)),
    hasIn: (e, ...kinds) => kinds.some((k) => inn.has(`${e.id}|${k}`)),
  };
  // 結構類別同時有定義與使用（part def 與 part），計數時只算定義，避免重複。
  const structural = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);
  ctx.of = (...cats) =>
    a.elements.filter((e) => {
      if (e.category === null || !cats.includes(e.category)) return false;
      if (e.kind === "ReferenceUsage") return false;
      return structural.has(e.category) ? e.kind === "PartDefinition" : /Usage$/.test(e.kind);
    });

  return GATES.filter((g) => enabled.includes(g.id)).map((g) => {
    const checks: CheckResult[] = g.checks.map((c) => {
      const key = `${g.id}.${c.id}`;
      if (c.manual || !c.run) {
        const pass = manualDone[key] === true;
        return { id: key, label: c.label, hint: c.hint, manual: true, pass, detail: pass ? "已人工確認" : "待人工確認", missing: [] };
      }
      const r = c.run(ctx);
      return { id: key, label: c.label, hint: c.hint, manual: false, pass: r.pass, detail: r.detail,
        missing: (r.missing ?? []).map((e) => ({ id: e.id, name: e.shortName ? `${e.shortName} ${e.name}` : e.name })) };
    });
    return { id: g.id, zh: g.zh, en: g.en, deadline: g.deadline, approver: g.approver, purpose: g.purpose, perSubsystem: g.perSubsystem,
      checks, done: checks.filter((c) => c.pass).length, total: checks.length };
  });
}
