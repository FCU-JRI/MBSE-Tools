// P1：需求的共同屬性、需求矩陣（比賽附件 10 的 VCRM 格式）與驗證矩陣（圖 8）的資料。
// 這個檔案不依賴 Node，伺服器（匯出、寫入）與網頁（驗證矩陣頁）共用（docs/IMPL-PLAN.md P1、METHOD.md 2.1 與第 8 節）。
//
// 模型裡的寫法（同一個概念只留一種寫法）：
//   驗證方法：標準庫的 @VerificationMethod { kind = VerificationMethodKind::test; }（可以多個：kind = (…::test, …::analyze);）
//   理由：標準庫的 @Rationale { text = "…"; }
//   其餘（驗證負責人、驗證層級、負責人、狀態、需求類型）：JRI 的 @RequirementInfo { … }

// ───────── 選項 ─────────

/** 驗證方法：值是標準庫 VerificationMethodKind 的列舉值；en 是比賽範本上的寫法 */
export const METHODS = [
  { id: "inspect", zh: "檢查", en: "Inspection" },
  { id: "demo", zh: "展示", en: "Demonstration" },
  { id: "analyze", zh: "分析", en: "Analysis" },
  { id: "test", zh: "測試", en: "Test" },
] as const;
/** 驗證層級：值是 JRI::VerificationLevelKind 的列舉值；en 是比賽範本上的寫法 */
export const LEVELS = [
  { id: "system", zh: "系統", en: "System" },
  { id: "subsystem", zh: "次系統", en: "Sub-system" },
  { id: "component", zh: "元件", en: "Element" },
] as const;
/** 狀態：值是 JRI::RequirementStatusKind 的列舉值；en 是比賽範本上的寫法 */
export const STATUSES = [
  { id: "pass", zh: "略過", en: "pass" },
  { id: "checked", zh: "已檢查", en: "checked" },
  { id: "tbc", zh: "待確認", en: "TBC" },
] as const;
/** 需求類型：值是 JRI::RequirementTypeKind 的列舉值；en 欄是比賽範本上的寫法（範本用中文） */
export const TYPES = [
  { id: "functional", zh: "功能", en: "功能需求" },
  { id: "performance", zh: "性能", en: "性能需求" },
  { id: "environmental", zh: "環境", en: "環境需求" },
  { id: "safety", zh: "安全", en: "安全需求" },
  { id: "configuration", zh: "型態", en: "型態需求" },
  { id: "quality", zh: "品質", en: "品質需求" },
  { id: "interfacing", zh: "介面", en: "介面需求" },
  { id: "operational", zh: "操作", en: "操作需求" },
] as const;

type Opt = { readonly id: string; readonly zh: string; readonly en: string };
const find = (list: readonly Opt[], id: string | undefined) => list.find((o) => o.id === id);

/** 需求類別（JRI 的 requirement def）。全部都有共同屬性 */
export const REQ_CATEGORIES = ["Expectation", "Need", "Goal", "Objective", "MOE", "MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP"];
/** 建立時就要填驗證方法的類別（METHOD.md 2.1：任務需求、系統需求、次系統需求，以及 MOE、MOP）。需要、目標不能驗證 */
export const VERIFIABLE = ["MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOE", "MOP"];
/** 驗證層級沒有填時，依類別推定 */
const DEFAULT_LEVEL: Record<string, string> = { MissionRequirement: "system", SystemRequirement: "system", SubsystemRequirement: "subsystem", ComponentRequirement: "component", MOE: "system", MOP: "system", Objective: "system", Expectation: "system" };

// ───────── 讀取 ─────────

/** 這一期用到的元素與關係欄位（伺服器的 Analysis 與網頁的 Analysis 都符合） */
export interface ReqElement { id: string; kind: string; category: string | null; name: string; shortName: string | null; qualifiedName: string; owner: string | null; doc: string; typeIds: string[]; attrs: Record<string, string>; tags: string[] }
export interface ReqAnalysis { elements: ReqElement[]; relations: { kind: string; from: string; to: string }[]; satisfaction: { requirement: string; status: string }[] }

export interface ReqInfo {
  /** 驗證方法（標準庫 VerificationMethodKind 的值），可以多個 */
  methods: string[];
  verificationLead: string;
  /** 寫在模型裡的驗證層級；沒寫是空字串 */
  verificationLevel: string;
  responsible: string;
  rationale: string;
  status: string;
  type: string;
}

const literal = (v: string | undefined) => (v ?? "").split("::").pop()?.replace(/^'|'$/g, "") ?? "";

/** 從元素的屬性讀出共同屬性（解析器把標記的欄位攤平在 attrs 裡） */
export function reqInfo(e: { attrs: Record<string, string>; tags: string[] }): ReqInfo {
  const a = e.attrs;
  return {
    methods: [...(a.kind ?? "").matchAll(/VerificationMethodKind::(\w+)/g)].map((m) => m[1]),
    verificationLead: a.verificationLead ?? "",
    verificationLevel: literal(a.verificationLevel),
    responsible: a.responsible ?? "",
    rationale: e.tags.includes("Rationale") ? a.text ?? "" : "",
    status: literal(a.reqStatus),
    type: literal(a.reqType),
  };
}

export const methodsZh = (ids: string[]) => ids.map((m) => find(METHODS, m)?.zh ?? m).join("、");
export const levelOf = (e: { category: string | null }, info: ReqInfo) => info.verificationLevel || DEFAULT_LEVEL[e.category ?? ""] || "";
export const optZh = (list: readonly Opt[], id: string) => find(list, id)?.zh ?? id;

// ───────── 寫入（產生 SysML v2 文字）─────────

export interface ReqInput { method?: string | string[]; verificationLead?: string; verificationLevel?: string; responsible?: string; rationale?: string; status?: string; type?: string }

const str = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
/** 舊的方法代號（byTest 等）也接受 */
const LEGACY: Record<string, string> = { byTest: "test", byAnalysis: "analyze", byInspection: "inspect", byDemonstration: "demo" };

export class ReqInputError extends Error {}

/** 檢查輸入，回傳整理過的值；不合法就丟 ReqInputError（訊息給使用者看） */
export function normalizeInput(category: string, input: ReqInput): Required<Omit<ReqInput, "method">> & { methods: string[] } {
  const raw = Array.isArray(input.method) ? input.method : input.method ? [input.method] : [];
  const methods: string[] = [];
  for (const m of raw.map((x) => String(x).trim()).filter(Boolean)) {
    const k = LEGACY[m] ?? m;
    if (!find(METHODS, k)) throw new ReqInputError(`驗證方法「${m}」不合法，只能是檢查、展示、分析、測試。`);
    if (!methods.includes(k)) methods.push(k);
  }
  if (VERIFIABLE.includes(category) && methods.length === 0) throw new ReqInputError("請填驗證方法（檢查、展示、分析、測試）。不知道怎麼驗證的需求，通常代表需求本身還沒寫好。");
  const pick = (list: readonly Opt[], v: string | undefined, zh: string) => {
    const s = String(v ?? "").trim();
    if (s && !find(list, s)) throw new ReqInputError(`${zh}「${s}」不合法。`);
    return s;
  };
  const text = (v: string | undefined, zh: string, max: number) => {
    const s = String(v ?? "").replace(/\r?\n/g, " ").trim();
    if (s.length > max) throw new ReqInputError(`${zh}最多 ${max} 個字。`);
    return s;
  };
  return {
    methods,
    verificationLead: text(input.verificationLead, "驗證負責人", 60),
    verificationLevel: pick(LEVELS, input.verificationLevel, "驗證層級"),
    responsible: text(input.responsible, "負責人", 60),
    rationale: text(input.rationale, "理由", 500),
    status: pick(STATUSES, input.status, "狀態"),
    type: pick(TYPES, input.type, "需求類型"),
  };
}

/** 三個標記各自的文字；空字串代表這個標記不寫（或要拿掉） */
export function metaTexts(n: ReturnType<typeof normalizeInput>): { VerificationMethod: string; Rationale: string; RequirementInfo: string } {
  const kinds = n.methods.map((m) => `VerificationMethodKind::${m}`);
  const info = [
    n.verificationLead && `verificationLead = ${str(n.verificationLead)};`,
    n.verificationLevel && `verificationLevel = VerificationLevelKind::${n.verificationLevel};`,
    n.responsible && `responsible = ${str(n.responsible)};`,
    n.status && `reqStatus = RequirementStatusKind::${n.status};`,
    n.type && `reqType = RequirementTypeKind::${n.type};`,
  ].filter(Boolean);
  return {
    VerificationMethod: kinds.length === 0 ? "" : `@VerificationMethod { kind = ${kinds.length === 1 ? kinds[0] : `(${kinds.join(", ")})`}; }`,
    Rationale: n.rationale ? `@Rationale { text = ${str(n.rationale)}; }` : "",
    RequirementInfo: info.length ? `@RequirementInfo { ${info.join(" ")} }` : "",
  };
}

// ───────── 需求矩陣（比賽附件 10 的 VCRM 格式）─────────

export interface VcrmRow {
  elementId: string;
  /** 需求編號；child 為真時放在範本的第二欄（例如 A.1.1 這種下一層的編號） */
  id: string;
  child: boolean;
  text: string;
  tracedFrom: string;
  owner: string;
  method: string;
  lead: string;
  level: string;
  rationale: string;
  status: string;
  type: string;
}
export interface VcrmSection { key: string; title: string; rows: VcrmRow[] }

/** 範本的欄位標題（第 2 列），順序即欄位順序；第一欄是段落名稱，需求編號佔兩欄 */
export const VCRM_HEADERS = ["", "需求編號\nRequirement ID", "", "需求內容\nRequirement text", "來源\nTraced from", "Owner", "Verification method", "Verification lead", "Verification level", "需求原因\nRationale", "狀態", "需求類型"];
export const VCRM_TITLE = "Verification Cross Reference Matrix (VCRM)";

const idOf = (e: ReqElement) => e.shortName ?? e.name;
const isUsage = (e: ReqElement) => /Usage$/.test(e.kind) && e.kind !== "ReferenceUsage";

/** 「REQ-SYS-001、REQ-SYS-002」寫成「REQ-SYS-001/002」（範本的 A.1/2/3 寫法） */
export function joinIds(ids: string[]): string {
  const out: string[] = [];
  let prefix: string | null = null;
  for (const id of ids) {
    const m = /^(.*[.\-_])([^.\-_]+)$/.exec(id);
    if (m && m[1] === prefix) out.push(m[2]);
    else { out.push(id); prefix = m ? m[1] : null; }
  }
  return out.join("/");
}

/** 模型的推導鏈依序匯出到範本的四段：任務宣言與概念、任務需求、系統需求、各次系統需求 */
export function vcrmSections(a: ReqAnalysis): VcrmSection[] {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const of = (...cats: string[]) => a.elements.filter((e) => e.category !== null && cats.includes(e.category) && isUsage(e));
  const outs = (e: ReqElement, ...kinds: string[]) => a.relations.filter((r) => r.from === e.id && kinds.includes(r.kind)).map((r) => byId.get(r.to)).filter((x): x is ReqElement => !!x);
  const ins = (e: ReqElement, ...kinds: string[]) => a.relations.filter((r) => r.to === e.id && kinds.includes(r.kind)).map((r) => byId.get(r.from)).filter((x): x is ReqElement => !!x);
  const sortById = (xs: ReqElement[]) => [...xs].sort((x, y) => idOf(x).localeCompare(idOf(y), "en", { numeric: true }));

  const row = (e: ReqElement, child: boolean): VcrmRow => {
    const info = reqInfo(e);
    // 沒有在需求上寫方法時，用驗證事件上的方法
    const methods = info.methods.length ? info.methods : [...new Set(ins(e, "verify").flatMap((v) => reqInfo(v).methods))];
    return {
      elementId: e.id,
      id: idOf(e),
      child,
      text: e.doc || e.name,
      tracedFrom: joinIds(outs(e, "derive", "refine", "trace").map(idOf)),
      owner: ins(e, "satisfy").map((x) => x.name).join("、"),
      method: methods.map((m) => find(METHODS, m)?.en ?? m).join("/"),
      lead: info.verificationLead,
      level: find(LEVELS, levelOf(e, info))?.en ?? "",
      rationale: info.rationale,
      status: find(STATUSES, info.status)?.en ?? "",
      type: find(TYPES, info.type)?.en ?? "",
    };
  };
  /** 同一段裡，衍生自段內另一條的排在它後面、放在第二欄 */
  const ordered = (xs: ReqElement[]): VcrmRow[] => {
    const set = new Set(xs.map((x) => x.id));
    const parentIn = (e: ReqElement) => outs(e, "derive", "refine").find((p) => set.has(p.id) && p.id !== e.id);
    const out: VcrmRow[] = [];
    const seen = new Set<string>();
    const visit = (e: ReqElement, child: boolean) => {
      if (seen.has(e.id)) return;
      seen.add(e.id);
      out.push(row(e, child));
      for (const c of sortById(xs.filter((x) => parentIn(x)?.id === e.id))) visit(c, true);
    };
    for (const e of sortById(xs.filter((x) => !parentIn(x)))) visit(e, false);
    for (const e of sortById(xs)) visit(e, false); // 循環衍生時保底
    return out;
  };

  // 1. 任務宣言與概念：目的，以及利害關係人給的外部硬條件（有出處的期望，METHOD.md 2.1）
  const sections: VcrmSection[] = [
    { key: "concept", title: "Mission statement & Concept", rows: [...ordered(of("Objective")), ...ordered(of("Expectation").filter((e) => e.attrs.sourceDoc))] },
    { key: "mission", title: "Mission requirements", rows: ordered(of("MissionRequirement")) },
    { key: "system", title: "System requirements", rows: ordered(of("SystemRequirement")) },
  ];

  // 4. 各次系統需求：依負責滿足它的次系統分段；元件負責的，歸到包含那個元件的次系統
  const subOf = (x: ReqElement | undefined): ReqElement | undefined => {
    for (let i = 0; x && i < 10; i++) {
      const def = x.category === "Subsystem" || x.category === "Component" ? (x.kind.endsWith("Usage") ? byId.get(x.typeIds[0] ?? "") ?? x : x) : undefined;
      if (!def) return undefined;
      if (def.category === "Subsystem") return def;
      // 元件：找以它為型別的零件，往上找它的擁有者
      const use = a.elements.find((u) => u.kind === "PartUsage" && u.typeIds.includes(def.id) && u.owner);
      x = use ? byId.get(use.owner as string) : undefined;
    }
    return undefined;
  };
  const subReqs = of("SubsystemRequirement", "ComponentRequirement");
  const groupOf = new Map<string, ReqElement | null>();
  const resolve = (e: ReqElement, depth = 0): ReqElement | null => {
    if (groupOf.has(e.id)) return groupOf.get(e.id) as ReqElement | null;
    let g: ReqElement | null = ins(e, "satisfy").map(subOf).find(Boolean) ?? null;
    if (!g && depth < 10) {
      // 沒有寫由誰滿足時，跟著它衍生自的次系統需求
      const parent = outs(e, "derive", "refine").find((p) => subReqs.includes(p));
      if (parent) g = resolve(parent, depth + 1);
    }
    groupOf.set(e.id, g);
    return g;
  };
  const groups = new Map<string, { sub: ReqElement | null; items: ReqElement[] }>();
  for (const e of subReqs) {
    const g = resolve(e);
    const k = g?.id ?? "";
    if (!groups.has(k)) groups.set(k, { sub: g, items: [] });
    groups.get(k)?.items.push(e);
  }
  const named = [...groups.values()].sort((x, y) => (x.sub ? 0 : 1) - (y.sub ? 0 : 1) || (x.sub?.name ?? "").localeCompare(y.sub?.name ?? "", "zh-Hant"));
  for (const g of named) sections.push({ key: `sub:${g.sub?.id ?? ""}`, title: g.sub ? `${g.sub.name} Subsystem Requirement` : "Unallocated Subsystem Requirement", rows: ordered(g.items) });
  return sections;
}

// ───────── 驗證矩陣（圖 8）─────────

export interface VerificationRow {
  element: ReqElement;
  info: ReqInfo;
  level: string;
  /** 驗證這條需求的驗證事件 */
  events: ReqElement[];
  /** 模型內限制的判定：holds | fails | undecided；沒有限制是空字串 */
  verdict: string;
  /** 缺什麼（空的代表齊全） */
  gaps: string[];
}

export function verificationRows(a: ReqAnalysis): VerificationRow[] {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const sat = new Map(a.satisfaction.map((s) => [s.requirement, s.status]));
  const order = (e: ReqElement) => VERIFIABLE.indexOf(e.category ?? "");
  return a.elements
    .filter((e) => e.category !== null && VERIFIABLE.includes(e.category) && isUsage(e))
    .sort((x, y) => order(x) - order(y) || idOf(x).localeCompare(idOf(y), "en", { numeric: true }))
    .map((e) => {
      const info = reqInfo(e);
      const events = a.relations.filter((r) => r.kind === "verify" && r.to === e.id).map((r) => byId.get(r.from)).filter((x): x is ReqElement => !!x);
      const gaps = [info.methods.length ? "" : "驗證方法", events.length ? "" : "驗證事件"].filter(Boolean);
      return { element: e, info, level: levelOf(e, info), events, verdict: sat.get(e.qualifiedName) ?? "", gaps };
    });
}
