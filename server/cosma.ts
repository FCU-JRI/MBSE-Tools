// CoSMA 框架（第 C 期，F-82 到 F-89）：五層的類別、專案是不是 CoSMA 專案、元素歸類、新增元素與關係的寫法、流程引導。
// 寫法照 Airbus 的 Apollo 11 參考模型（reference/apollo-11-sysml-v2）：幾乎都是定義；需求的定義與規格分開；
// 追溯（#refinement dependency）寫在需求定義裡面；利害關係人擁有 Concern；目標放在 Mission 裡面；階段是 state def。
import type { Category } from "./metamodel.ts";
import type { Element, Extracted, Link, Relation } from "./extract.ts";
import type { StepDef, StepStatus } from "./process.ts";
/** 和 edits.ts 的 quote 相同（這個檔不匯入 edits.ts，避免 engine → edits → projects → engine 的循環） */
const quote = (name: string): string => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);

/** CoSMA 基礎庫的三個套件（library/cosma/，原封不動）。 */
export const COSMA_PACKAGES = ["CoSMAPackage", "CoSMAQuantitiesAndUnitsPackage", "CoSMAViewsPackage"];
/** JRI 附加庫（library/addon/JRIAddonPackage.sysml）：#moe、#mop。 */
export const ADDON_PACKAGE = "JRIAddonPackage";
/** 共用元件庫方式載入時的來源名稱前綴。冒號不是合法的模型檔名，不會和專案的檔案撞名。 */
export const COSMA_SOURCE = "cosma:";
export const ADDON_SOURCE = "addon:";

export type Layer = "purpose" | "operational" | "functional" | "logical" | "technical";
/** 五層以外：CoSMA 基礎庫與共用元件庫（library）、JRI 附加庫（addon）、整個模型的根套件（root） */
export type Place = Layer | "library" | "addon" | "root";

export const LAYERS: Record<Layer, string> = {
  purpose: "Purpose 為什麼",
  operational: "Operational 何時",
  functional: "Functional 做什麼",
  logical: "Logical 誰負責",
  technical: "Technical 怎麼做出來",
};
export const PLACES: Record<Exclude<Place, Layer>, string> = { library: "標準庫與基礎庫", addon: "附加庫", root: "模型根套件" };

export interface CosmaCategory extends Omit<Category, "pillar"> {
  pillar: Layer;
  layer: Layer;
  /** 新增時的寫法；null 表示只用來歸類，工具不提供新增（個體、執行紀錄、人員） */
  head: ((name: string, sn: string | null) => string) | null;
  /** 有編號的類別（需求定義）的編號前綴，例如 HLR-R → HLR-R001 */
  sn?: string;
  /** 必須放在哪一類的元素裡面（Concern 放在利害關係人裡、Goal 放在 Mission 裡） */
  parent?: string;
  /** 套件不存在時，新檔放在哪個資料夾（照 Apollo 的資料夾） */
  dir: string;
}

const C = "CoSMA.";
const cat = (id: string, zh: string, en: string, layer: Layer, pkg: string, dir: string, keyword: string, help: string, example: string,
  head: CosmaCategory["head"], extra: Partial<CosmaCategory> = {}): CosmaCategory =>
  ({ id: C + id, zh, en, pillar: layer, layer, prefix: extra.sn ?? "", pkg, dir, keyword, help, example, head, ...extra });

const sub = (base: string) => (n: string) => `${base} ${quote(n)}`;
const reqDef = (tag: string) => (n: string, sn: string | null) => `${tag}requirement def <'${sn}'> ${quote(n)}`;

/** 第 3 節與第 4.1 節的 CoSMA 元素。id 一律以 CoSMA. 開頭，和 JRI 的類別分開（第 D 期的節點檢查用這些 id）。 */
export const COSMA_CATEGORIES: CosmaCategory[] = [
  // ── Purpose ──
  cat("Program", "計畫", "Program", "purpose", "ProgramPackage", "Program", "part def", "整個計畫，裡面列出它的各次任務。", "年度探空火箭計畫",
    (n) => `${sub("part def")(n)} :> Program`),
  cat("Stakeholder", "利害關係人", "Stakeholder", "purpose", "StakeholderPackage", "Purpose", "part", "會影響這個專案、或被專案影響的人與單位。關注事項放在它裡面。", "競賽主辦方、指導老師",
    (n) => `part ${quote(n)} : Stakeholder`),
  cat("Concern", "關注事項", "Concern", "purpose", "StakeholderPackage", "Purpose", "item", "利害關係人在意的事，用他們的話寫。放在某位利害關係人裡面。", "發射全程不得危及人員",
    (n) => `item ${quote(n)} : Concern :> concerns`, { parent: C + "Stakeholder" }),
  cat("StakeholderNeed", "利害關係人的需要", "Stakeholder Need", "purpose", "StakeholderNeedsPackage", "Requirements", "requirement def", "利害關係人的需要，寫成需求定義。", "任務應安全地完成",
    (n, sn) => `requirement def <'${sn}'> ${quote(n)} :> StakeholderNeed`, { sn: "SHN-N" }),
  cat("Capability", "能力", "Capability", "purpose", "CapabilitiesPackage", "Purpose", "part def", "為了滿足需要，要具備的能力。用細化連到它滿足的需要。", "次軌道發射能力",
    (n) => `${sub("part def")(n)} :> Capability`),
  cat("Mission", "任務", "Mission", "purpose", "MissionPackage", "Purpose", "part def", "一次任務。目標、任務系統、脈絡與任務階段都寫在它裡面。", "年度飛行測試任務",
    (n) => `${sub("part def")(n)} :> Mission`),
  cat("Goal", "目標", "Goal", "purpose", "MissionPackage", "Purpose", "requirement", "任務想達成的方向，放在任務裡面。", "完成一次成功的飛行測試",
    (n) => `requirement ${quote(n)} : Goal :> goals`, { parent: C + "Mission" }),
  cat("MissionRequirement", "任務需求", "Mission Requirement", "purpose", "MissionRequirementsPackage", "Requirements", "requirement def", "任務「應」做到的事。用細化連到它來自的能力；可量化的寫成屬性加 require constraint。", "飛行器應到達目標遠地點高度",
    reqDef(""), { sn: "HLR-R" }),
  cat("MOE", "效能量度", "Measure of Effectiveness", "purpose", "MissionRequirementsPackage", "Requirements", "requirement def", "從任務角度衡量做得好不好。是一條標上 #moe 的需求定義，用細化連到它量測的任務需求。", "遠地點與目標高度的偏差",
    reqDef("#moe "), { sn: "MOE-" }),
  cat("MissionSpecification", "任務規格", "Mission Specification", "purpose", "MissionSpecificationPackage", "Purpose", "requirement", "列出任務包含哪些任務需求、對象是誰。", "年度飛行測試任務規格",
    sub("requirement")),
  cat("Context", "脈絡", "Context", "purpose", "ContextPackage", "Purpose", "part def", "任務所處的環境，外部系統放在它裡面。", "發射場脈絡",
    (n) => `${sub("part def")(n)} :> Context`),
  cat("ExternalSystem", "外部系統", "External System", "purpose", "ContextPackage", "Purpose", "part def", "不屬於任務系統、但會與它互動的東西。", "發射架、地面站、大氣環境",
    (n) => `${sub("part def")(n)} :> System`),
  // ── Operational ──
  cat("Phase", "任務階段", "Mission Phase", "operational", "MissionPhasesPackage", "Purpose", "state def", "任務依序經過的階段，寫成狀態定義；階段裡用 do action 放要執行的作業。", "發射、回收",
    (n) => `${sub("state def")(n)} :> Phase`),
  cat("Operation", "作業", "Operation", "operational", "OperationsPackage", "Operation", "action def", "人或系統在某個階段要做的事。參與者寫成作業裡的 ref part。", "發射團隊執行發射程序",
    (n) => `${sub("action def")(n)} :> Operation`),
  cat("Execution", "執行紀錄", "Mission Execution", "operational", "MissionExecutionPackage", "Execution", "individual part def", "某次實際執行的紀錄（個體、時間切片、快照）。", "第一次飛行", null),
  // ── Functional ──
  cat("Function", "功能", "Function", "functional", "FunctionsPackage", "Function", "action def", "系統要做的事。用細化連到它支援的作業。", "提供推力",
    (n) => `${sub("action def")(n)} :> Function`),
  cat("FunctionalRequirement", "功能需求", "Functional Requirement", "functional", "FunctionalRequirementsPackage", "Requirements", "requirement def", "功能「應」做到的事，用細化連到任務需求。", "推進功能應提供足夠的推力",
    reqDef(""), { sn: "FLR-R" }),
  cat("FunctionSpecification", "功能規格", "Function Specification", "functional", "FunctionSpecificationPackage", "Function", "requirement", "列出功能包含哪些功能需求，誰滿足哪一條。", "飛行功能規格",
    sub("requirement")),
  cat("Item", "項目", "Item", "functional", "FunctionsPackage", "Function", "item def", "功能之間流動的東西（資料、能量、物質）。", "飛行器狀態", sub("item def")),
  // ── Logical ──
  cat("LogicalComponent", "邏輯元件", "Logical Component", "logical", "LogicalComponentsPackage", "Logical", "part def", "抽象的組成，用 perform 執行功能。", "推進鏈",
    (n) => `${sub("part def")(n)} :> LogicalComponent`),
  // ── Technical ──
  cat("MissionSystem", "任務系統", "Mission System", "technical", "SystemPackage", "Technical", "part def", "要開發的整體系統。", "探空火箭任務系統",
    (n) => `${sub("part def")(n)} :> System`),
  cat("TechnicalComponent", "技術元件", "Technical Component", "technical", "TechnicalComponentsPackage", "Technical", "part def", "實際的硬體或軟體，帶質量、推力、功率等屬性。", "固態馬達、飛行電腦",
    (n) => `${sub("part def")(n)} :> HardwareComponent`),
  cat("TechnicalRequirement", "技術需求", "Technical Requirement", "technical", "TechnicalRequirementsPackage", "Requirements", "requirement def", "技術元件「應」做到的事，用細化連到功能需求。", "馬達應提供不低於規定值的總衝量",
    reqDef(""), { sn: "CLR-R" }),
  cat("MOP", "性能量度", "Measure of Performance", "technical", "TechnicalRequirementsPackage", "Requirements", "requirement def", "從工程角度衡量系統性能。是一條標上 #mop 的需求定義，用細化連到它量測的技術需求。", "馬達總衝量",
    reqDef("#mop "), { sn: "MOP-" }),
  cat("SystemSpecification", "系統規格", "System Specification", "technical", "SystemSpecificationPackage", "Technical", "requirement", "列出系統包含哪些技術需求，誰滿足哪一條。", "任務系統規格",
    sub("requirement")),
  cat("PortDef", "連接埠定義", "Port Definition", "technical", "TechnicalPortsPackage", "Technical", "port def", "元件之間交換東西的接點。", "資料埠", sub("port def")),
  cat("InterfaceDef", "介面定義", "Interface Definition", "technical", "TechnicalPortsPackage", "Technical", "interface def", "兩個連接埠之間的介面。", "箭體與酬載的介面", sub("interface def")),
  cat("Calculation", "計算", "Calculation", "technical", "CalculationsPackage", "Analysis", "calc def", "由屬性算出另一個值。", "推重比", sub("calc def")),
  cat("Analysis", "分析", "Analysis", "technical", "AnalysisPackage", "Analysis", "analysis def", "對系統的質量、功率、成本等做的分析。", "質量分析", sub("analysis def")),
  cat("Individual", "個體", "Individual", "technical", "TechnicalIndividualsPackage", "Technical", "individual part def", "實際製造的那一個（設計是 part def，實物是 individual part def）。", "一號機", null),
];
export const COSMA_CATEGORY = new Map(COSMA_CATEGORIES.map((c) => [c.id, c]));

export const COSMA_RELATIONS: Record<string, { zh: string; help: string }> = {
  refine: { zh: "細化", help: "寫在起點的定義裡：#refinement dependency 起點 to 終點。需求細化上層需求、能力細化需要、功能細化作業、MOE／MOP 細化它量測的需求。" },
  satisfy: { zh: "滿足", help: "從負責的定義拉到需求定義。寫進以它為對象的規格：規格裡沒有這條需求時先加入，再寫 satisfy … by …。" },
  perform: { zh: "執行", help: "邏輯元件執行功能：在起點的定義裡寫 perform action。" },
  specialize: { zh: "特化", help: "起點的定義特化終點的定義：在宣告上加 :> 終點。" },
  participant: { zh: "參與者", help: "作業的參與者：在作業裡寫 ref part，指向利害關係人或外部系統。" },
};
export const COSMA_RELATION_KINDS = ["refine", "satisfy", "perform", "specialize", "participant"];

/** CoSMA 基礎庫的定義名稱 → 類別。由近到遠找一般化，第一個碰到的決定類別（Context :> System 先碰到 Context）。 */
const BY_LIBRARY: Record<string, string> = {
  Program: "Program", Mission: "Mission", MannedSpaceMission: "Mission", Capability: "Capability", Stakeholder: "Stakeholder", Concern: "Concern",
  StakeholderNeed: "StakeholderNeed", Goal: "Goal", Context: "Context", Phase: "Phase", Operation: "Operation", Function: "Function",
  LogicalComponent: "LogicalComponent", System: "MissionSystem", SystemOfSystems: "MissionSystem", ConstituentSystem: "MissionSystem", SystemOfInterest: "MissionSystem",
  TechnicalComponent: "TechnicalComponent", HardwareComponent: "TechnicalComponent", SoftwareComponent: "TechnicalComponent", PowerProvider: "TechnicalComponent",
  PowerConsumer: "TechnicalComponent", MassedComponent: "TechnicalComponent",
};
/** 使用（usage）只有這幾類本身就是使用，其餘的使用只記層、不給類別，免得同一個東西在表上出現兩次 */
const USAGE_CATEGORIES = new Set(["Stakeholder", "Concern", "Goal"]);
/** 套件名稱 → 層。Apollo 的套件名稱；其他模型照關鍵字。順序有意義（MissionPhasesPackage 是 Operational） */
const PACKAGE_LAYER: [RegExp, Layer][] = [
  [/Phase|Operation|Execution/, "operational"],
  [/Function/, "functional"],
  [/Logical/, "logical"],
  [/Technical|System|Astronaut|Analysis|Calculation|Port|Interface|Individual/, "technical"],
  [/Stakeholder|Mission|Capabilit|Context|Program|Purpose|Need|Goal/, "purpose"],
];

const isLibraryName = (q: string) => COSMA_PACKAGES.some((p) => q === p || q.startsWith(`${p}::`));
const isAddonName = (q: string) => q === ADDON_PACKAGE || q.startsWith(`${ADDON_PACKAGE}::`);

/** 一般化（型別、父定義、子集、重定義）往上找，第一個碰到的 CoSMA 基礎庫定義。 */
function libraryAncestor(e: Element, byId: Map<string, Element>): string | null {
  const seen = new Set<string>([e.id]);
  const queue = [...e.typeIds];
  while (queue.length) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const g = byId.get(id);
    if (!g) continue;
    const parts = g.qualifiedName.split("::");
    if (parts.length === 2 && parts[0] === "CoSMAPackage" && BY_LIBRARY[parts[1]]) return BY_LIBRARY[parts[1]];
    queue.push(...g.typeIds);
  }
  return null;
}

/** 這個專案是不是 CoSMA 專案：模型（不含基礎庫本身）裡有元素特化 CoSMA 套件的定義（第 7 節適用範圍）。不看 project.json。 */
export function isCosmaProject(a: Pick<Extracted, "elements">): boolean {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  return a.elements.some((e) => !isLibraryName(e.qualifiedName) && !e.file.startsWith(COSMA_SOURCE) && /Definition$|Usage$/.test(e.kind) && libraryAncestor(e, byId) !== null);
}

/** 樹上的上層：有列出來的擁有者（F-71 的 parent），沒有就用 owner */
const upOf = (e: Element, byId: Map<string, Element>): Element | undefined => byId.get(e.parent ?? "") ?? byId.get(e.owner ?? "");
export const topPackageOf = (e: Element, byId: Map<string, Element>): Element | null => {
  let top: Element | null = null;
  for (let cur: Element | undefined = e, i = 0; cur && i < 60; cur = upOf(cur, byId), i++) if (cur.kind === "Package") top = cur;
  return top;
};
const nearestPackageOf = (e: Element, byId: Map<string, Element>): Element | null => {
  for (let cur = upOf(e, byId), i = 0; cur && i < 60; cur = upOf(cur, byId), i++) if (cur.kind === "Package") return cur;
  return null;
};
const layerOfPackage = (name: string): Layer | null => PACKAGE_LAYER.find(([re]) => re.test(name))?.[1] ?? null;

/** 歸類一個元素：CoSMA 的類別（可能沒有）與它屬於五層的哪一層（或基礎庫、附加庫、根套件）。 */
export function classify(elements: Element[]): Map<string, { category: string | null; place: Place }> {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const out = new Map<string, { category: string | null; place: Place }>();
  const own = (e: Element): string | null => {
    const isDef = /Definition$/.test(e.kind);
    if (e.keyword?.startsWith("individual")) {
      if (!isDef) return null;
      const lib = libraryAncestor(e, byId);
      return lib === "Mission" ? "Execution" : "Individual";
    }
    const pkg = nearestPackageOf(e, byId)?.name ?? "";
    const owner = upOf(e, byId);
    const lib = libraryAncestor(e, byId);
    if (isDef && e.kind === "PartDefinition" && /Context/.test(pkg) && lib !== "Context") return "ExternalSystem";
    if (lib && isDef) return lib;
    // 使用：利害關係人只算直接放在套件裡的（作業裡的 ref part 是參與者，不是另一位利害關係人）；Concern、Goal 本身就是使用
    if (lib && USAGE_CATEGORIES.has(lib) && e.kind !== "ReferenceUsage" && !(e.keyword ?? "").startsWith("ref") && (lib !== "Stakeholder" || owner?.kind === "Package")) return lib;
    if (e.kind === "RequirementDefinition") {
      if (e.tags.includes("MeasureOfEffectiveness")) return "MOE";
      if (e.tags.includes("MeasureOfPerformance")) return "MOP";
      if (/Function/.test(pkg)) return "FunctionalRequirement";
      if (/Technical|System/.test(pkg)) return "TechnicalRequirement";
      if (/Mission|Requirement/.test(pkg)) return "MissionRequirement";
      return null;
    }
    // 規格：直接放在套件裡的需求使用
    if (e.kind === "RequirementUsage" && owner?.kind === "Package") {
      if (/Function/.test(pkg)) return "FunctionSpecification";
      if (/System|Technical/.test(pkg)) return "SystemSpecification";
      if (/Mission/.test(pkg)) return "MissionSpecification";
      return null;
    }
    if (e.kind === "PortDefinition") return "PortDef";
    if (e.kind === "InterfaceDefinition") return "InterfaceDef";
    if (e.kind === "CalculationDefinition") return "Calculation";
    if (e.kind === "AnalysisCaseDefinition") return "Analysis";
    if (e.kind === "ItemDefinition") return "Item";
    return null;
  };
  const visit = (e: Element): { category: string | null; place: Place } => {
    const hit = out.get(e.id);
    if (hit) return hit;
    let r: { category: string | null; place: Place };
    if (isLibraryName(e.qualifiedName) || e.file.startsWith(COSMA_SOURCE)) r = { category: null, place: "library" };
    else if (isAddonName(e.qualifiedName) || e.file.startsWith(ADDON_SOURCE) || e.file === "JRI.sysml" || (e.category !== null && !e.category.startsWith(C))) r = { category: null, place: "addon" };
    else if (e.shared) r = { category: null, place: "library" };
    else {
      const c = own(e);
      const owner = upOf(e, byId);
      // 項目定義跟著所在的套件（功能之間的流動放 Functional，連接埠交換的放 Technical）
      if (c) r = { category: C + c, place: (c === "Item" ? layerOfPackage(nearestPackageOf(e, byId)?.name ?? "") : null) ?? (COSMA_CATEGORY.get(C + c) as CosmaCategory).layer };
      else if (owner && owner.kind !== "Package") r = { category: null, place: visit(owner).place };
      else {
        const byName = layerOfPackage(e.kind === "Package" ? e.name : nearestPackageOf(e, byId)?.name ?? "");
        const top = topPackageOf(e, byId);
        r = { category: null, place: byName ?? (top && top.id !== e.id ? visit(top).place : "root") };
      }
    }
    out.set(e.id, r);
    return r;
  };
  for (const e of elements) visit(e);
  return out;
}

/** CoSMA 專案：把 CoSMA 的類別與層寫進元素。JRI 類別（附加庫）已經有類別的元素不動。非 CoSMA 專案什麼都不改。 */
export function applyCosma(x: Extracted): boolean {
  if (!isCosmaProject(x)) return false;
  const all = [...x.elements, ...x.unnamed];
  const r = classify(all);
  for (const e of all) {
    const c = r.get(e.id);
    if (!c) continue;
    e.layer = c.place;
    if (e.category === null && c.category) e.category = c.category;
  }
  return true;
}

// ───────── 流程引導 ─────────

export const COSMA_STEPS: (StepDef & { layer: Layer })[] = [
  { id: "c-stakeholders", layer: "purpose", zh: "利害關係人", nasa: "Purpose", categories: [C + "Stakeholder"], question: "誰會影響這個任務，或被它影響？", why: "CoSMA 從利害關係人開始；關注事項與需要都屬於他們。", example: "競賽主辦方、指導老師" },
  { id: "c-concerns", layer: "purpose", zh: "關注事項", nasa: "Purpose", categories: [C + "Concern"], parent: C + "Stakeholder", question: "每一位利害關係人在意什麼？", why: "關注事項放在利害關係人裡面（item … : Concern）。", example: "發射全程不得危及人員" },
  { id: "c-needs", layer: "purpose", zh: "需要", nasa: "Purpose", categories: [C + "StakeholderNeed"], question: "綜合這些關注，利害關係人需要什麼？", why: "需要寫成需求定義（:> StakeholderNeed）。", example: "任務應安全地完成" },
  { id: "c-capabilities", layer: "purpose", zh: "能力", nasa: "Purpose", categories: [C + "Capability"], link: { kind: "refine", to: [C + "StakeholderNeed"], zh: "細化哪一項需要", direction: "out" }, question: "要滿足這些需要，得具備哪些能力？", why: "能力細化需要，任務需求再細化能力。", example: "次軌道發射能力" },
  { id: "c-mission", layer: "purpose", zh: "任務", nasa: "Purpose", categories: [C + "Mission"], question: "這次任務是什麼？", why: "目標、任務系統、脈絡與任務階段都寫在任務裡。", example: "年度飛行測試任務" },
  { id: "c-goals", layer: "purpose", zh: "目標", nasa: "Purpose", categories: [C + "Goal"], parent: C + "Mission", question: "任務想達成哪些方向？", why: "目標放在任務裡面（requirement … : Goal）。", example: "完成一次成功的飛行測試" },
  { id: "c-missionreqs", layer: "purpose", zh: "任務需求", nasa: "Purpose", categories: [C + "MissionRequirement"], link: { kind: "refine", to: [C + "Capability"], zh: "細化哪一項能力", direction: "out" }, question: "任務「應」做到什麼？", why: "任務需求細化能力，是功能需求的來源。", example: "飛行器應到達目標遠地點高度" },
  { id: "c-moes", layer: "purpose", zh: "效能量度", nasa: "Purpose", categories: [C + "MOE"], link: { kind: "refine", to: [C + "MissionRequirement"], zh: "量測哪一條任務需求", direction: "out" }, question: "用什麼指標衡量任務做得好不好？", why: "MOE 是標上 #moe 的需求定義，細化它量測的任務需求。", example: "遠地點與目標高度的偏差" },
  { id: "c-context", layer: "purpose", zh: "脈絡與外部系統", nasa: "Purpose", categories: [C + "Context", C + "ExternalSystem"], question: "任務在什麼環境裡？會和外界哪些東西互動？", why: "外部系統放在脈絡裡。", example: "發射場、地面站" },
  { id: "c-phases", layer: "operational", zh: "任務階段", nasa: "Operational", categories: [C + "Phase"], question: "任務從開始到結束，依序經過哪些階段？", why: "階段是狀態定義；任務裡用 exhibit state 與 transition 排出順序。", example: "發射、回收" },
  { id: "c-operations", layer: "operational", zh: "作業", nasa: "Operational", categories: [C + "Operation"], question: "每個階段，人或系統要做哪些事？誰參與？", why: "作業取代使用案例；參與者寫成作業裡的 ref part。", example: "發射團隊執行發射程序" },
  { id: "c-functions", layer: "functional", zh: "功能", nasa: "Functional", categories: [C + "Function"], link: { kind: "refine", to: [C + "Operation"], zh: "細化哪一個作業", direction: "out" }, question: "系統要做哪些事，才能完成這些作業？", why: "每個功能細化一個作業。", example: "提供推力" },
  { id: "c-funcreqs", layer: "functional", zh: "功能需求", nasa: "Functional", categories: [C + "FunctionalRequirement"], link: { kind: "refine", to: [C + "MissionRequirement"], zh: "細化哪一條任務需求", direction: "out" }, question: "功能「應」做到什麼？", why: "功能需求細化任務需求。", example: "推進功能應提供足夠的推力" },
  { id: "c-logical", layer: "logical", zh: "邏輯元件", nasa: "Logical", categories: [C + "LogicalComponent"], question: "哪個抽象的組成負責哪些功能？", why: "邏輯元件用 perform 執行功能。", example: "推進鏈" },
  { id: "c-system", layer: "technical", zh: "任務系統與技術元件", nasa: "Technical", categories: [C + "MissionSystem", C + "TechnicalComponent"], question: "實際要做出來的系統由哪些硬體與軟體組成？", why: "技術元件帶質量、推力、功率等屬性。", example: "固態馬達、飛行電腦" },
  { id: "c-techreqs", layer: "technical", zh: "技術需求", nasa: "Technical", categories: [C + "TechnicalRequirement"], link: { kind: "refine", to: [C + "FunctionalRequirement"], zh: "細化哪一條功能需求", direction: "out" }, question: "技術元件「應」做到什麼？", why: "技術需求細化功能需求。", example: "馬達應提供不低於規定值的總衝量" },
  { id: "c-mops", layer: "technical", zh: "性能量度", nasa: "Technical", categories: [C + "MOP"], link: { kind: "refine", to: [C + "TechnicalRequirement"], zh: "量測哪一條技術需求", direction: "out" }, question: "用哪些工程指標追蹤性能？", why: "MOP 是標上 #mop 的需求定義，細化它量測的技術需求。", example: "馬達總衝量" },
  { id: "c-specs", layer: "technical", zh: "規格", nasa: "Purpose／Functional／Technical", categories: [C + "MissionSpecification", C + "FunctionSpecification", C + "SystemSpecification"], question: "任務、功能、系統各包含哪些需求？誰滿足哪一條？", why: "規格是一個需求使用，列出包含的需求並寫 satisfy … by …。", example: "任務系統規格" },
];

/** CoSMA 專案的流程（引導用，不是節點檢查；節點檢查是第 D 期）。每一步都開放，不擋跳步。 */
export function evaluateCosmaProcess(a: { elements: Element[]; relations: Relation[]; links?: Link[] }): StepStatus[] {
  const own = a.elements.filter((e) => !e.shared && e.kind !== "ReferenceUsage");
  const of = (...cats: string[]) => own.filter((e) => e.category !== null && cats.includes(e.category));
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const name = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);
  const refinesTo = (e: Element, cat: string) => a.relations.some((r) => r.kind === "refine" && r.from === e.id && byId.get(r.to)?.category === cat);
  const needOne = (cat: string, text: string) => (of(cat).length < 1 ? [{ id: null, text }] : []);
  const refineIssues = (cat: string, to: string, zh: string) => of(cat).filter((e) => !refinesTo(e, to)).map((e) => ({ id: e.id, text: `${name(e)} 還沒有細化${zh}。` }));
  const check: Record<string, () => { id: string | null; text: string }[]> = {
    "c-stakeholders": () => needOne(C + "Stakeholder", "至少列出一位利害關係人。"),
    "c-concerns": () => of(C + "Stakeholder").filter((s) => s.kind === "PartUsage" && !own.some((c) => c.owner === s.id && c.category === C + "Concern")).map((s) => ({ id: s.id, text: `${s.name} 還沒有任何關注事項。` })),
    "c-needs": () => needOne(C + "StakeholderNeed", "至少寫出一項需要。"),
    "c-capabilities": () => [...needOne(C + "Capability", "至少列出一項能力。"), ...refineIssues(C + "Capability", C + "StakeholderNeed", "任何需要")],
    "c-mission": () => needOne(C + "Mission", "定義任務。"),
    "c-goals": () => of(C + "Mission").filter((m) => !own.some((g) => g.owner === m.id && g.category === C + "Goal")).map((m) => ({ id: m.id, text: `任務「${m.name}」還沒有目標。` })),
    "c-missionreqs": () => [...needOne(C + "MissionRequirement", "至少寫出一條任務需求。"), ...refineIssues(C + "MissionRequirement", C + "Capability", "任何能力")],
    "c-moes": () => refineIssues(C + "MOE", C + "MissionRequirement", "任務需求"),
    "c-context": () => [...needOne(C + "Context", "定義脈絡。"), ...needOne(C + "ExternalSystem", "至少列出一個外部系統。")],
    "c-phases": () => needOne(C + "Phase", "至少定義一個任務階段。"),
    "c-operations": () => [...needOne(C + "Operation", "至少定義一個作業。"),
      ...of(C + "Operation").filter((o) => !a.elements.some((p) => p.owner === o.id && (p.keyword ?? "").startsWith("ref"))).map((o) => ({ id: o.id, text: `${name(o)} 沒有參與者（ref part）。` }))],
    "c-functions": () => [...needOne(C + "Function", "至少定義一個功能。"), ...refineIssues(C + "Function", C + "Operation", "任何作業")],
    "c-funcreqs": () => [...needOne(C + "FunctionalRequirement", "至少寫出一條功能需求。"), ...refineIssues(C + "FunctionalRequirement", C + "MissionRequirement", "任何任務需求")],
    "c-logical": () => [...needOne(C + "LogicalComponent", "至少定義一個邏輯元件。"),
      ...of(C + "LogicalComponent").filter((l) => !(a.links ?? []).some((k) => k.kind === "perform" && k.from === l.id)).map((l) => ({ id: l.id, text: `${l.name} 還沒有執行任何功能。` }))],
    "c-system": () => [...needOne(C + "MissionSystem", "定義任務系統。"), ...needOne(C + "TechnicalComponent", "至少定義一個技術元件。")],
    "c-techreqs": () => [...needOne(C + "TechnicalRequirement", "至少寫出一條技術需求。"), ...refineIssues(C + "TechnicalRequirement", C + "FunctionalRequirement", "任何功能需求")],
    "c-mops": () => refineIssues(C + "MOP", C + "TechnicalRequirement", "技術需求"),
    "c-specs": () => needOne(C + "SystemSpecification", "至少建立一份系統規格。"),
  };
  return COSMA_STEPS.map((s) => {
    const issues = check[s.id]();
    const state: StepStatus["state"] = issues.length === 0 ? "done" : "current";
    return { id: s.id, zh: s.zh, nasa: s.nasa, question: s.question, why: s.why, example: s.example, categories: s.categories, link: s.link ?? null, parent: s.parent ?? null, state, count: of(...s.categories).length, issues: issues.slice(0, 12) };
  });
}

// ───────── 節點檢查、匯出與報告共用（第 D 期，F-91 到 F-95） ─────────

/** CoSMA 專案的元素篩選：自己的（不含基礎庫、附加庫本身）、不是 ref 使用。CoSMA 類別由 classify 決定、不會重複；
 * 利害關係人只算使用（人或單位本身，不算 part def）；附加庫沿用的 JRI 類別（風險、驗證……）照 JRI 的規則只算使用。 */
export const cosmaOf = (elements: Element[]) => (...cats: string[]): Element[] =>
  elements.filter((e) => {
    if (e.category === null || !cats.includes(e.category) || e.shared || e.kind === "ReferenceUsage") return false;
    if (e.category === C + "Stakeholder") return e.kind === "PartUsage";
    return e.category.startsWith(C) || /Usage$/.test(e.kind);
  });

/** 指向需求定義 d 的關係：直接指向 d，或指向型別是 d 的需求使用（規格裡的 satisfy、verify requirement : d）。 */
export function relationsTo(a: { elements: Element[]; relations: Relation[] }, d: Element, kind: string, byId = new Map(a.elements.map((e) => [e.id, e]))): Relation[] {
  return a.relations.filter((r) => r.kind === kind && (r.to === d.id || (byId.get(r.to)?.kind === "RequirementUsage" && (byId.get(r.to)?.typeIds ?? []).includes(d.id))));
}

/** 作業的參與者：作業裡的 ref part（第 10 節第 2 項） */
export const participantsOf = (elements: Element[], o: Element): Element[] => elements.filter((p) => p.owner === o.id && (p.keyword ?? "").startsWith("ref"));

/** 執行這個功能的邏輯元件：perform 的目標是型別為 f 的動作使用 */
export function performersOf(a: { elements: Element[]; links?: Link[] }, f: Element, byId = new Map(a.elements.map((e) => [e.id, e]))): Element[] {
  return (a.links ?? []).filter((k) => k.kind === "perform" && k.to && (k.to === f.id || (byId.get(k.to)?.typeIds ?? []).includes(f.id)))
    .map((k) => byId.get(k.from)).filter((e): e is Element => !!e && e.category === C + "LogicalComponent");
}

/** 類別的中文名稱：CoSMA 類別或附加庫沿用的 JRI 類別 */
export const cosmaZh = (cat: string | null, jri: Map<string, { zh: string }>): string => (cat ? COSMA_CATEGORY.get(cat)?.zh ?? jri.get(cat)?.zh ?? "" : "");
