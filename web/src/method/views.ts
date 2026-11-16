// METHOD.md 第 3 節的分析圖：每張圖代表一個階段，在圖的清單裡由上而下排（docs/IMPL-PLAN.md）。
// 圖的框架（排列、釘選亮色與其他暗色的元素清單、手動連線）由 P2 實作；各期在自己的區塊登記自己負責的圖。
import type { Analysis } from "../api.ts";

export interface AnalysisView {
  /** 唯一的代號，例如 "stakeholders" */
  id: string;
  /** METHOD.md 第 3 節的圖號（1 到 10），決定由上而下的順序 */
  order: number;
  /** 圖的中文名稱 */
  zh: string;
  /** 這一步要回答的問題，顯示在圖上方 */
  question: string;
  /** 對應的審查節點，例如 "mdr" */
  gate: string;
  /** 預設釘選（亮色）的類別 id；其餘 SysML v2 元素以暗色列出，照樣可以拉進圖裡 */
  pinned: string[];
  /** 這一步還缺什麼（空的清單代表完成）。只是提示，不擋使用者往下做 */
  missing?: (a: Analysis) => { id: string | null; text: string }[];
  /** 工具列預設顯示的連線種類（model.ts 的 ALL_LINKS 的 kind）；不給就用一般的追溯、衍生、細化、滿足、分配。其餘連線在「全部工具」裡照樣可用 */
  links?: string[];
  /** 預設排法：tb 由上而下（預設）；rocket 是系統簡圖，零件照實際位置由上而下疊成一枚火箭 */
  arrange?: "tb" | "rocket";
}

// ───────── P2 的「還缺什麼」：只看模型，不寫入任何東西 ─────────
const STRUCT = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);
/** 某類別的元素：結構類別取定義，其餘取使用（和 model.ts 的 listOf 相同規則） */
const cat = (a: Analysis, id: string) => a.elements.filter((e) => e.category === id && e.kind !== "ReferenceUsage" && (STRUCT.has(id) ? e.kind === "PartDefinition" : e.kind.endsWith("Usage")));
const shown = (e: { shortName: string | null; name: string }) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);
/** 和 id 有某種關係、另一端屬於 cats 的元素存在嗎 */
function linked(a: Analysis, id: string, kind: string, cats: string[] | null): boolean {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  return a.relations.some((r) => r.kind === kind && (r.from === id || r.to === id) && (!cats || cats.includes(byId.get(r.from === id ? r.to : r.from)?.category ?? "")));
}
type Miss = { id: string | null; text: string };
const none = (a: Analysis, id: string, text: string): Miss[] => (cat(a, id).length ? [] : [{ id: null, text }]);
const each = (a: Analysis, id: string, ok: (eid: string) => boolean, text: (name: string) => string): Miss[] =>
  cat(a, id).filter((e) => !ok(e.id)).map((e) => ({ id: e.id, text: text(shown(e)) }));

export const ANALYSIS_VIEWS: AnalysisView[] = [
  // [P1 需求屬性與需求矩陣]
  // [/P1]
  // [P2 分析圖骨架與中文化]
  { id: "stakeholders", order: 1, zh: "利害關係人分析", gate: "proposal",
    question: "誰在乎這個任務？他們想看到什麼、怎麼使用這枚火箭？綜合起來要解決什麼問題（需要）？",
    pinned: ["Stakeholder", "Expectation", "UseCase", "Need"], links: ["trace", "include", "derive"],
    missing: (a) => [
      ...none(a, "Stakeholder", "還沒有利害關係人"),
      ...each(a, "Stakeholder", (id) => linked(a, id, "trace", ["Expectation"]), (n) => `${n} 還沒有期望（從期望拉「追溯」到他）`),
      ...none(a, "Expectation", "還沒有期望"),
      ...none(a, "UseCase", "還沒有使用情境（使用案例）"),
      ...none(a, "Need", "還沒有需要：一句話說明這個任務要解決的問題"),
    ] },
  { id: "mission", order: 2, zh: "任務定義", gate: "mdr",
    question: "想往哪個方向走（目標）？做到什麼才算成功（目的與 MOE，三級各有數字）？整個任務要達成什麼、不能違反什麼（任務需求）？",
    pinned: ["Need", "Goal", "Objective", "MOE", "MissionRequirement"], links: ["derive", "refine", "trace"],
    missing: (a) => [
      ...none(a, "Goal", "還沒有目標"),
      ...each(a, "Goal", (id) => linked(a, id, "derive", ["Need"]), (n) => `${n} 還沒有接到需要（衍生）`),
      ...none(a, "Objective", "還沒有目的"),
      ...each(a, "Objective", (id) => linked(a, id, "refine", ["MOE"]), (n) => `${n} 還沒有成功判準（MOE 細化這個目的）`),
      ...none(a, "MissionRequirement", "還沒有任務需求（「應」字句，有數字，可以驗證）"),
    ] },
  { id: "schematic", order: 5, zh: "系統簡圖", gate: "mdr", arrange: "rocket",
    question: "這個系統分成哪些次系統（包括外部提供的）與主要元件？各自在哪裡、誰包含誰？",
    pinned: ["System", "Subsystem", "Component", "ExternalEntity"], links: ["compose", "connect", "satisfy"],
    missing: (a) => [
      ...none(a, "System", "還沒有系統（例如火箭）"),
      ...each(a, "System", (id) => a.elements.some((e) => e.owner === id && e.kind === "PartUsage"), (n) => `${n} 還沒有零件（用「組成」拉到次系統）`),
      ...none(a, "Subsystem", "還沒有次系統"),
    ] },
  { id: "subsystem-req", order: 7, zh: "次系統需求", gate: "pdr",
    question: "系統需求拆給哪些次系統？每條次系統需求由哪個次系統負責？",
    pinned: ["SystemRequirement", "SubsystemRequirement", "Subsystem"], links: ["derive", "satisfy", "refine"],
    missing: (a) => [
      ...none(a, "SystemRequirement", "還沒有系統需求"),
      ...none(a, "SubsystemRequirement", "還沒有次系統需求"),
      ...each(a, "SubsystemRequirement", (id) => linked(a, id, "derive", ["SystemRequirement"]), (n) => `${n} 還沒有接到系統需求（衍生）`),
      ...each(a, "SubsystemRequirement", (id) => linked(a, id, "satisfy", null), (n) => `${n} 還沒有負責的次系統（滿足）`),
    ] },
  // [/P2]
  // [P3 任務剖面、功能分配、MOE／MOP／TPM]
  // [/P3]
  // [P4 介面與 N² 矩陣]
  // [/P4]
  // [P5 FMEA、風險與圖表]
  // [/P5]
  // [P6 方案比較與模型內公式]
  // [/P6]
  // [P7 火箭外形與模擬圖]
  // [/P7]
];
