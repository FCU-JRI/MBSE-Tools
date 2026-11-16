// P2 中文化（METHOD.md 1.2 節第 4 點）：畫面上中文在前、英文小字在後；縮寫第一次出現就展開。
// 只是顯示用的對照表，模型與圖上的 SysML v2 記號（«part def» 等）照標準不改。

/** SysML v2 關鍵字的中文。 */
export const KEYWORD_ZH: Record<string, string> = {
  package: "套件", "library package": "程式庫套件", comment: "註解", doc: "說明", import: "匯入", alias: "別名", dependency: "相依",
  "part def": "零件定義", part: "零件", "ref part": "參照零件", "item def": "物件定義", item: "物件",
  "attribute def": "屬性定義", attribute: "屬性", "enum def": "列舉定義", enum: "列舉",
  "port def": "連接埠定義", port: "連接埠", "interface def": "介面定義", interface: "介面",
  "connection def": "連結定義", connection: "連結", connect: "連接", bind: "繫結", flow: "流",
  "allocation def": "分配定義", allocation: "分配", allocate: "分配",
  "action def": "動作定義", action: "動作", "perform action": "執行動作", perform: "執行", succession: "先後", first: "先", then: "然後",
  "state def": "狀態定義", state: "狀態", "exhibit state": "展現狀態", transition: "轉換", entry: "進入", exit: "離開", do: "進行",
  "calc def": "計算定義", calc: "計算", "constraint def": "限制定義", constraint: "限制", "assert constraint": "斷言限制", assert: "斷言",
  "requirement def": "需求定義", requirement: "需求", "concern def": "關注定義", concern: "關注",
  satisfy: "滿足", verify: "驗證", subject: "主體", actor: "參與者", stakeholder: "利害關係人", objective: "目的",
  "use case def": "使用案例定義", "use case": "使用案例", include: "包含",
  "analysis def": "分析定義", analysis: "分析", "verification def": "驗證定義", verification: "驗證",
  "view def": "檢視定義", view: "檢視", "viewpoint def": "觀點定義", viewpoint: "觀點", "rendering def": "呈現定義", rendering: "呈現",
  "occurrence def": "個體定義", occurrence: "個體", individual: "個別", snapshot: "快照", timeslice: "時間切片",
  "metadata def": "標記定義", metadata: "標記", in: "輸入", out: "輸出", inout: "輸入輸出", return: "回傳",
  specialize: "特化", subset: "子集", redefine: "重定義", reference: "參照", type: "由…定義",
};

/** 中文在前、英文在後的兩段，給畫面分開排版（英文用小字）。沒有對照的直接回英文。 */
export function zhKeyword(keyword: string | undefined | null): { zh: string; en: string } {
  const k = (keyword ?? "").replace(/^«|»$/g, "").trim();
  const bare = k.replace(/^(abstract|variation|individual|public|private|protected)\s+/, "");
  return { zh: KEYWORD_ZH[k] ?? KEYWORD_ZH[bare] ?? "", en: k };
}

/** 工具依類別自動建立的套件（metamodel.ts 的 pkg）的中文。 */
export const PACKAGE_ZH: Record<string, string> = {
  Stakeholders: "利害關係人", NGOs: "需要、目標與目的", Requirements: "需求", Structure: "結構", Behavior: "行為", UseCases: "使用案例",
  Verification: "驗證與確認", Risks: "風險", Safety: "安全", Operations: "作業", Anomalies: "異常", Quality: "品質", Interfaces: "介面",
};

/** 縮寫的展開：第一次出現時寫成「中文（English, ABBR）」。 */
export const ABBR: Record<string, { zh: string; en: string }> = {
  MOE: { zh: "效能量度", en: "Measure of Effectiveness" }, MOP: { zh: "性能量度", en: "Measure of Performance" },
  TPM: { zh: "技術性能量度", en: "Technical Performance Measure" }, NGOs: { zh: "需要、目標與目的", en: "Needs, Goals, Objectives" },
  MDR: { zh: "任務定義審查", en: "Mission Definition Review" }, SDR: { zh: "系統定義審查", en: "System Definition Review" },
  PDR: { zh: "初步設計審查", en: "Preliminary Design Review" }, CDR: { zh: "關鍵設計審查", en: "Critical Design Review" },
  TRR: { zh: "測試準備審查", en: "Test Readiness Review" }, FMEA: { zh: "失效模式與影響分析", en: "Failure Mode and Effects Analysis" },
  RPN: { zh: "風險優先數", en: "Risk Priority Number" }, ConOps: { zh: "操作概念", en: "Concept of Operations" },
  "N²": { zh: "N 平方矩陣", en: "N-squared diagram" }, "V&V": { zh: "驗證與確認", en: "Verification and Validation" },
  GV: { zh: "一般檢視", en: "General View" }, IV: { zh: "互連檢視", en: "Interconnection View" },
  AFV: { zh: "動作流程檢視", en: "Action Flow View" }, STV: { zh: "狀態轉換檢視", en: "State Transition View" },
  SOP: { zh: "標準作業程序", en: "Standard Operating Procedure" }, QC: { zh: "品質管制", en: "Quality Control" },
};
export const expand = (abbr: string) => { const a = ABBR[abbr]; return a ? `${a.zh}（${a.en}, ${abbr}）` : abbr; };

/**
 * 把一段文字裡第一次出現的縮寫展開，之後出現的保留縮寫。seen 讓同一個畫面上的多段文字共用「第一次」。
 * 只展開整個字（前後不是英數字），避免把 MOPS 之類的字拆開。
 */
export function expandFirst(text: string, seen: Set<string> = new Set()): string {
  let out = text;
  for (const abbr of Object.keys(ABBR).sort((a, b) => b.length - a.length)) {
    if (seen.has(abbr)) continue;
    const re = new RegExp(`(^|[^A-Za-z0-9])(${abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![A-Za-z0-9])`);
    const m = out.match(re);
    if (!m || m.index === undefined) continue;
    // 已經寫成「中文（…）」的不重複展開
    if (out.includes(ABBR[abbr].zh)) { seen.add(abbr); continue; }
    const at = m.index + m[1].length;
    out = `${out.slice(0, at)}${expand(abbr)}${out.slice(at + abbr.length)}`;
    seen.add(abbr);
  }
  return out;
}
