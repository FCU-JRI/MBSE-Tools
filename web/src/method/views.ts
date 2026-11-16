// METHOD.md 第 3 節的分析圖：每張圖代表一個階段，在圖的清單裡由上而下排（docs/IMPL-PLAN.md）。
// 圖的框架（排列、釘選亮色與其他暗色的元素清單、手動連線）由 P2 實作；各期在自己的區塊登記自己負責的圖。
import type { Analysis } from "../api.ts";
// [P5 FMEA、風險與圖表]
import { p5Issues } from "./p5/core.ts";
// [/P5]

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
  /** 這一步還缺什麼（空的清單代表完成） */
  missing?: (a: Analysis) => { id: string | null; text: string }[];
}

export const ANALYSIS_VIEWS: AnalysisView[] = [
  // [P1 需求屬性與需求矩陣]
  // [/P1]
  // [P2 分析圖骨架與中文化]
  // [/P2]
  // [P3 任務剖面、功能分配、MOE／MOP／TPM]
  // [/P3]
  // [P4 介面與 N² 矩陣]
  // [/P4]
  // [P5 FMEA、風險與圖表]
  {
    id: "risk-fmea", order: 10, zh: "風險與 FMEA", gate: "mdr",
    question: "哪些地方可能出錯？會威脅哪些需求？緩解措施產生了哪些新的需求、設計或驗證？",
    pinned: ["Risk", "FailureMode", "Function", "Subsystem", "Component", "MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "VerificationEvent"],
    missing: (a) => (a.ok ? p5Issues(a) : []),
  },
  // [/P5]
  // [P6 方案比較與模型內公式]
  // [/P6]
  // [P7 火箭外形與模擬圖]
  // [/P7]
];
