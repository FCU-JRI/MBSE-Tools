// JRI 類別（對應 library/JRI.sysml）的顯示名稱、說明與新增元素時的寫法。
// 說明文字給沒有系統工程背景的成員看，力求白話。

/** options：只能填這幾個值（下拉選單），空字串＝不寫 */
/** gate：TPM 各節點的值專用，對應的審查節點 id（右欄只顯示專案啟用的節點） */
export interface Field { name: string; zh: string; type: "text" | "int" | "real"; options?: { value: string; zh: string }[]; gate?: string }

export interface Category {
  id: string;
  zh: string;
  en: string;
  pillar: "requirements" | "structure" | "behavior" | "parametrics" | "vv" | "risk" | "ops";
  prefix: string; // 編號前綴，例如 REQ-SYS
  pkg: string; // 新增時放進哪個套件
  keyword: string; // SysML v2 關鍵字
  help: string;
  example: string;
  fields?: Field[];
  /** 不用一般的新增表單建立（例如介面要選兩端），由專門的入口建立 */
  special?: boolean;
}

export const PILLARS: Record<Category["pillar"], string> = {
  requirements: "需求 Requirements",
  structure: "結構 Structure",
  behavior: "行為 Behavior",
  parametrics: "參數 Parametrics",
  vv: "驗證與確認 V&V",
  risk: "風險與安全 Risk & Safety",
  ops: "作業與品質 Operations & Quality",
};

export const CATEGORIES: Category[] = [
  { id: "Stakeholder", zh: "利害關係人", en: "Stakeholder", pillar: "requirements", prefix: "STK", pkg: "Stakeholders", keyword: "part",
    help: "會影響這個專案、或被專案影響的人與單位。先列出他們，才知道要滿足誰的期望。", example: "競賽主辦方、指導老師、場地管理單位",
    fields: [{ name: "role", zh: "角色與關注點", type: "text" }] },
  { id: "Expectation", zh: "期望", en: "Stakeholder Expectation", pillar: "requirements", prefix: "EXP", pkg: "Stakeholders", keyword: "requirement",
    help: "利害關係人希望看到的結果，用他們的話寫，不必是工程語言。", example: "火箭的發射與回收全程不得危及人員與場地。" },
  { id: "Need", zh: "需要", en: "Need", pillar: "requirements", prefix: "NEED", pkg: "NGOs", keyword: "requirement",
    help: "為什麼要做這個專案：一句話說明要解決的問題。", example: "團隊需要一枚能把酬載送到目標高度並安全回收的探空火箭。" },
  { id: "Goal", zh: "目標", en: "Goal", pillar: "requirements", prefix: "GOAL", pkg: "NGOs", keyword: "requirement",
    help: "為了滿足需要，專案想達成的方向。可以是定性的。", example: "於本年度完成一次成功的飛行測試。" },
  { id: "Objective", zh: "目的", en: "Objective", pillar: "requirements", prefix: "OBJ", pkg: "NGOs", keyword: "requirement",
    help: "把目標變成可以衡量的具體結果。", example: "火箭遠地點高度達到 3000 m。" },
  { id: "MOE", zh: "效能量度", en: "Measure of Effectiveness", pillar: "parametrics", prefix: "MOE", pkg: "NGOs", keyword: "requirement",
    help: "從任務角度衡量「做得好不好」的指標，對應到某個目的。成功判準分三級：最低、完全、額外。", example: "實際遠地點與目標高度的偏差百分比。",
    fields: [{ name: "successLevel", zh: "成功判準等級（最低／完全／額外）", type: "text" }] },
  { id: "MissionRequirement", zh: "任務需求", en: "Mission Requirement", pillar: "requirements", prefix: "REQ-MSN", pkg: "Requirements", keyword: "requirement",
    help: "整個任務「應」達成的事，來自成功判準或來源文件的硬條件。之後的任務剖面、系統需求都從這裡推導。", example: "任務應將酬載送達 3000 m 並完整回收。" },
  { id: "SystemRequirement", zh: "系統層需求", en: "System Requirement", pillar: "requirements", prefix: "REQ-SYS", pkg: "Requirements", keyword: "requirement",
    help: "整枚火箭「應」做到的事。一條只寫一件事，要能被驗證，用「應」字。", example: "火箭應到達 3000 m ± 150 m 的遠地點高度。" },
  { id: "SubsystemRequirement", zh: "次系統層需求", en: "Subsystem Requirement", pillar: "requirements", prefix: "REQ-SUB", pkg: "Requirements", keyword: "requirement",
    help: "由系統層需求分配給某個次系統的需求。", example: "推進次系統應提供不低於 9000 N·s 的總衝量。" },
  { id: "ComponentRequirement", zh: "元件層需求", en: "Component Requirement", pillar: "requirements", prefix: "REQ-CMP", pkg: "Requirements", keyword: "requirement",
    help: "再往下分配到單一元件的需求。", example: "燃燒室應承受 6 MPa 的最大工作壓力。" },
  { id: "MOP", zh: "性能量度", en: "Measure of Performance", pillar: "parametrics", prefix: "MOP", pkg: "Requirements", keyword: "requirement",
    help: "從工程角度衡量系統性能的指標，用來支撐效能量度與需求。", example: "引擎總衝量（N·s）。" },
  { id: "System", zh: "系統", en: "System", pillar: "structure", prefix: "SYS", pkg: "Structure", keyword: "part def",
    help: "要開發的整體，例如整枚火箭。", example: "火箭" },
  { id: "Subsystem", zh: "次系統", en: "Subsystem", pillar: "structure", prefix: "SUB", pkg: "Structure", keyword: "part def",
    help: "系統底下的主要分工單位，通常對應一個組。", example: "推進次系統、航電次系統、回收次系統" },
  { id: "Component", zh: "元件", en: "Component", pillar: "structure", prefix: "CMP", pkg: "Structure", keyword: "part def",
    help: "次系統底下可以單獨設計、製造或採購的東西。", example: "燃燒室、噴嘴、飛行電腦" },
  { id: "ExternalEntity", zh: "外部對象", en: "External Entity", pillar: "structure", prefix: "EXT", pkg: "Structure", keyword: "part def",
    help: "不屬於系統、但會與系統互動的東西，用來畫系統脈絡。", example: "發射架、地面站、大氣環境" },
  { id: "DesignAlternative", zh: "設計方案", en: "Design Alternative", pillar: "structure", prefix: "ALT", pkg: "Design", keyword: "variation part def",
    help: "設計迴圈的提案與方案分析：列出要比較的候選方案（variant）。選定哪一個寫成設計決策。", example: "回收方案：單段傘、雙段傘" },
  { id: "Interface", zh: "介面", en: "Interface", pillar: "structure", prefix: "IF", pkg: "Structure", keyword: "interface", special: true,
    help: "兩個次系統之間的連接，由系統的設計迴圈產出。在系統的右欄「介面」新增：選兩端、種類與關鍵數字。", example: "推進—結構 接頭" },
  { id: "MissionPhase", zh: "任務階段", en: "Mission Phase", pillar: "behavior", prefix: "PH", pkg: "Behavior", keyword: "action",
    help: "任務從開始到結束依序經過的階段。", example: "發射、動力飛行、滑行、回收" },
  { id: "Function", zh: "功能", en: "Function", pillar: "behavior", prefix: "FN", pkg: "Behavior", keyword: "action",
    help: "系統在某個階段要做的動作，之後分配給次系統。", example: "偵測遠地點、觸發開傘" },
  { id: "UseCase", zh: "使用案例", en: "Use Case", pillar: "behavior", prefix: "UC", pkg: "UseCases", keyword: "use case",
    help: "某個利害關係人為了達成目的，會怎麼使用這個系統。一個案例寫一件事。", example: "發射團隊執行發射程序、回收團隊尋回火箭" },
  { id: "Mode", zh: "模式", en: "Mode / State", pillar: "behavior", prefix: "MODE", pkg: "Behavior", keyword: "state",
    help: "系統在某段時間所處的狀態。先建一個總模式，再在它裡面加入各個狀態並排出轉換。", example: "待命、上升、滑行、開傘下降、落地" },
  { id: "VerificationEvent", zh: "驗證事件", en: "Verification Event", pillar: "vv", prefix: "VER", pkg: "Verification", keyword: "verification",
    help: "用測試、分析、檢查或展示，證明某條需求有被做到。", example: "以飛行電腦氣壓計紀錄遠地點高度。" },
  { id: "ValidationEvent", zh: "確認事件", en: "Validation Event", pillar: "vv", prefix: "VAL", pkg: "Verification", keyword: "verification",
    help: "確認做出來的系統真的符合利害關係人的期望（做對的東西）。", example: "飛行後與指導老師檢視任務是否達成目的。" },
  { id: "Risk", zh: "風險", en: "Risk (FMEA)", pillar: "risk", prefix: "RISK", pkg: "Risks", keyword: "item",
    help: "可能出錯的事。嚴重度與可能性各評 1–5，並寫下緩解方式。", example: "降落傘未展開",
    fields: [
      { name: "failureMode", zh: "失效模式", type: "text" }, { name: "effect", zh: "影響", type: "text" },
      { name: "cause", zh: "原因", type: "text" }, { name: "severity", zh: "嚴重度 1–5", type: "int" },
      { name: "likelihood", zh: "可能性 1–5", type: "int" }, { name: "detection", zh: "偵測度 1–5（越難發現越高）", type: "int" },
      { name: "mitigation", zh: "緩解措施", type: "text" }, { name: "residualSeverity", zh: "緩解後嚴重度 1–5", type: "int" },
      { name: "residualLikelihood", zh: "緩解後可能性 1–5", type: "int" }, { name: "owner", zh: "負責人", type: "text" },
      { name: "status", zh: "狀態（開啟／結案）", type: "text" }, { name: "riskKind", zh: "種類（技術／時程／預算／場地／人員）", type: "text" },
      { name: "fixNote", zh: "回頭修正（改了模型哪裡；被修正的元素用「修正了」關係指過去）", type: "text" } ] },
  { id: "DesignDecision", zh: "設計決策", en: "Design Decision", pillar: "parametrics", prefix: "DEC", pkg: "Decisions", keyword: "item",
    help: "方案選定或衝突裁決的紀錄：選了什麼、為什麼、誰決定、何時。下一屆看得懂為什麼這樣設計。", example: "回收改用雙段開傘",
    fields: [{ name: "rationale", zh: "理由", type: "text" }, { name: "decidedBy", zh: "裁決者", type: "text" }, { name: "decidedOn", zh: "日期", type: "text" },
      { name: "releaseStatus", zh: "放行／喊卡", type: "text", options: [{ value: "ok", zh: "放行" }, { value: "hold", zh: "喊卡" }] },
      { name: "holdReason", zh: "喊卡原因與放行條件", type: "text" }] },
  { id: "SafetyFactor", zh: "安全係數", en: "Factor of Safety", pillar: "risk", prefix: "FOS", pkg: "Safety", keyword: "item",
    help: "結構或壓力元件的實際安全係數與要求值。", example: "燃燒室爆破安全係數",
    fields: [
      { name: "required", zh: "要求值", type: "real" }, { name: "actual", zh: "實際值", type: "real" },
      { name: "basis", zh: "計算依據", type: "text" } ] },
  { id: "SOP", zh: "標準作業程序", en: "SOP", pillar: "ops", prefix: "SOP", pkg: "Operations", keyword: "item",
    help: "測試或發射要照著做的步驟文件。TRR 必須附上。", example: "靜態推力測試 SOP",
    fields: [{ name: "documentRef", zh: "文件連結或編號", type: "text" }, { name: "revision", zh: "版次", type: "text" }] },
  { id: "RosterEntry", zh: "名冊", en: "Roster", pillar: "ops", prefix: "ROS", pkg: "Operations", keyword: "item",
    help: "測試或飛行當天的人員與職責。TRR 核可後不得更改。", example: "點火官",
    fields: [
      { name: "person", zh: "姓名", type: "text" }, { name: "duty", zh: "職責", type: "text" },
      { name: "rank", zh: "AEAS 職級", type: "text" } ] },
  { id: "Anomaly", zh: "異常報告", en: "Anomaly", pillar: "risk", prefix: "ANM", pkg: "Anomalies", keyword: "item",
    help: "測試中發生的非預期狀況，以及根因與矯正措施。", example: "點火延遲 2 秒",
    fields: [
      { name: "observed", zh: "現象", type: "text" }, { name: "rootCause", zh: "根本原因", type: "text" },
      { name: "severity", zh: "嚴重度 1–5", type: "int" }, { name: "correction", zh: "矯正措施", type: "text" },
      { name: "prevention", zh: "預防措施", type: "text" }, { name: "status", zh: "狀態（開啟／結案）", type: "text" } ] },
  { id: "QCRecord", zh: "加工 QC 紀錄", en: "QC Record", pillar: "ops", prefix: "QC", pkg: "Quality", keyword: "item",
    help: "加工零件的簽核紀錄：設計者 → 加工前簽核 → 加工者 → 加工後簽核 → 最終簽核。", example: "噴嘴喉部加工",
    fields: [
      { name: "drawingRef", zh: "工程圖編號", type: "text" }, { name: "designer", zh: "設計者", type: "text" },
      { name: "preSignOff", zh: "加工前簽核", type: "text" }, { name: "machinist", zh: "加工者", type: "text" },
      { name: "postSignOff", zh: "加工後簽核", type: "text" }, { name: "finalSignOff", zh: "最終簽核（總工程師）", type: "text" },
      { name: "status", zh: "狀態", type: "text" } ] },
];

export const CATEGORY = new Map(CATEGORIES.map((c) => [c.id, c]));

export const RELATION_LABELS: Record<string, { zh: string; help: string }> = {
  derive: { zh: "衍生自", help: "這條需求是從哪一條上層需求或目的推導出來的。" },
  refine: { zh: "細化", help: "這個量度或需求把哪一個上層項目說得更具體。" },
  trace: { zh: "追溯到", help: "一般性的關聯。連到利害關係人時，期望會寫成 stakeholder、使用案例會寫成 actor（SysML v2 內建的寫法）。" },
  basis: { zh: "設計依據", help: "這條需求是根據上一層設計迴圈的哪個產出推出來的：介面、尺寸或質量邊界、預算配額、選定方案或設計決策。下一層需求要同時有「衍生自」與「設計依據」。" },
  satisfy: { zh: "滿足", help: "哪個系統或元件負責做到這條需求。" },
  verify: { zh: "驗證", help: "哪個驗證事件用來證明這條需求。" },
  allocate: { zh: "分配給", help: "這個功能由哪個次系統或元件執行。" },
  include: { zh: "包含", help: "這個使用案例進行時會用到另一個使用案例。" },
  fix: { zh: "修正了", help: "風險的回頭修正：為了這個風險改了哪個元素（候選、零件、需求…）。修正內容寫在風險的「回頭修正」欄。" },
};

/**
 * 說明性標記（library/JRI.sysml）：右欄可編，寫成 @名稱 { 欄位 = 值; }。欄位值會出現在 Element.attrs，位置在 metaLoc[名稱]。
 * for：掛在哪種元素上（any＝任何元素；variant＝設計方案底下的候選；criterion＝需求；alternative＝設計方案；tpm＝有 #tpm 的屬性）。
 */
/** TPM 各節點的值：一個設計審查節點一個欄位，id 對應 server/gates.ts 的 GATES（Mars 2026-11-27 決定跟著審查節點走；異常審查、計畫收束不更新估計值）。
 * library/JRI.sysml 的 TpmTrend 要宣告同樣的欄位；專案沒啟用的節點，原始碼裡的值照樣解析、保留。 */
export const TPM_GATES: [gate: string, suffix: string, zh: string][] = [
  ["proposal", "Proposal", "提案"], ["mdr", "MDR", "MDR"], ["pdr", "PDR", "PDR"], ["cdr", "CDR", "CDR"], ["trr", "TRR", "TRR"], ["frr", "FRR", "FRR"],
];
export interface MetaSpec { id: string; zh: string; for: "any" | "variant" | "criterion" | "alternative" | "tpm"; fields: Field[] }
export const META: MetaSpec[] = [
  { id: "DesignRationale", zh: "說明", for: "any", fields: [{ name: "why", zh: "為什麼這樣定", type: "text" }, { name: "judge", zh: "判定條件（用什麼條件判定通過）", type: "text" }] },
  { id: "Rejection", zh: "否決原因", for: "variant", fields: [{ name: "rejectWhy", zh: "否決原因（選定的不用寫）", type: "text" }] },
  { id: "CriterionScale", zh: "評分標準", for: "criterion", fields: [{ name: "scale1", zh: "1 分", type: "text" }, { name: "scale3", zh: "3 分", type: "text" }, { name: "scale5", zh: "5 分", type: "text" }] },
  { id: "TradeSensitivity", zh: "權重敏感度", for: "alternative", fields: [{ name: "sensitivity", zh: "權重敏感度說明", type: "text" }] },
  { id: "TpmTrend", zh: "各節點的值", for: "tpm", fields: TPM_GATES.map(([gate, suffix, zh]) => ({ name: `at${suffix}`, zh, type: "real" as const, gate })) },
];
export const META_SPEC = new Map(META.map((m) => [m.id, m]));
