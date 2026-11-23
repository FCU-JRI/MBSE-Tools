// METHOD.md 第 3 節的 10 張分析圖，以及模型頁左欄的 7 個階段（Mars 定案的路徑圖白板）。
// 分析圖存成自訂圖（diagrams.json 的 custom），代號固定為 custom:m-<id>；
// 既有專案沒有這些項目時由畫面補上空白的圖，使用者第一次在圖上修改時才寫進檔案。
import type { Analysis, Diagrams, Element, View } from "../../api.ts";
import { listOf } from "../../model.ts";

export type Layer = "mission" | "system" | "subsystem" | "component";
export const LAYERS: { id: Layer; zh: string }[] = [
  { id: "mission", zh: "任務" }, { id: "system", zh: "系統" }, { id: "subsystem", zh: "次系統" }, { id: "component", zh: "元件" },
];

export interface Miss { id: string | null; text: string }
export interface MethodView {
  id: string;
  /** METHOD.md 第 3 節的圖號 */
  no: number;
  title: string;
  /** 這一步要回答的問題 */
  question: string;
  /** 預設釘選（亮色）的類別；其餘類別暗色，照樣可以拉進來 */
  pinned: string[];
  /** 工具列「連線」預設的連線種類 */
  links: string[];
  /** 方案比較、FMEA：全專案一張，圖上依層篩選 */
  layered?: boolean;
  /** 介面：另有 N² 矩陣 */
  n2?: boolean;
  /** 這一步還缺什麼；只是提示，不擋使用者往下做 */
  missing: (a: Analysis) => Miss[];
  /** 工具目前做不到、要 Mars 決定的地方，照實寫在圖上方 */
  gap?: string;
}

export const MARK = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
export const methodId = (id: string) => `custom:m-${id}`;
export const isMethodId = (id: string) => id.startsWith("custom:m-");

const shown = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);
/** id 有沒有某種關係，另一端屬於 cats（不給 cats 就不限） */
function linked(a: Analysis, id: string, kinds: string[], cats?: string[]): boolean {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  return a.relations.some((r) => kinds.includes(r.kind) && (r.from === id || r.to === id) && (!cats || cats.includes(byId.get(r.from === id ? r.to : r.from)?.category ?? "")));
}
const none = (a: Analysis, cat: string, text: string): Miss[] => (listOf(a.elements, cat).length ? [] : [{ id: null, text }]);
const each = (a: Analysis, cat: string, ok: (e: Element) => boolean, text: (n: string) => string): Miss[] =>
  listOf(a.elements, cat).filter((e) => !ok(e)).map((e) => ({ id: e.id, text: text(shown(e)) }));
const REQS = ["SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOE", "MOP"];

export const METHOD_VIEWS: MethodView[] = [
  { id: "stakeholders", no: 1, title: "利害關係人分析",
    question: "誰在乎這個任務？他們想看到什麼、怎麼使用這枚火箭？綜合起來要解決什麼問題（需要）？",
    pinned: ["Stakeholder", "Expectation", "UseCase", "Need"], links: ["trace", "include", "derive"],
    missing: (a) => [
      ...none(a, "Stakeholder", "還沒有利害關係人"),
      ...each(a, "Stakeholder", (e) => linked(a, e.id, ["trace"], ["Expectation"]), (n) => `${n} 還沒有期望（從期望拉「追溯」到他）`),
      ...none(a, "Expectation", "還沒有期望"),
      ...none(a, "UseCase", "還沒有使用情境（使用案例）"),
      ...none(a, "Need", "還沒有需要：一句話說明這個任務要解決的問題"),
    ] },
  { id: "mission", no: 2, title: "任務定義",
    question: "想往哪個方向走（目標）？做到什麼才算成功（目的與成功判準 MOE，三級各有數字）？整個任務要達成什麼、不能違反什麼（任務需求）？",
    pinned: ["Need", "Goal", "Objective", "MOE"], links: ["derive", "refine", "trace"],
    gap: "任務需求目前沒有專屬的類別，暫時無法釘選。",
    missing: (a) => [
      ...none(a, "Goal", "還沒有目標"),
      ...each(a, "Goal", (e) => linked(a, e.id, ["derive", "trace"], ["Need"]), (n) => `${n} 還沒有接到需要（衍生）`),
      ...none(a, "Objective", "還沒有目的"),
      ...each(a, "Objective", (e) => linked(a, e.id, ["refine"], ["MOE"]), (n) => `${n} 還沒有成功判準（MOE 細化這個目的）`),
    ] },
  { id: "profile", no: 3, title: "任務剖面",
    question: "為了滿足任務需求，任務怎麼進行？依序經過哪些階段，有哪些正常操作、失效、中止的模式？",
    pinned: ["MissionPhase", "Mode", "Objective"], links: ["succession", "transition", "trace"],
    missing: (a) => {
      const phases = listOf(a.elements, "MissionPhase");
      return [
        ...none(a, "MissionPhase", "還沒有任務階段"),
        ...(phases.length > 1 && !a.relations.some((r) => r.kind === "succession" && phases.some((p) => p.id === r.from)) ? [{ id: null, text: "任務階段還沒有排出先後" }] : []),
        ...none(a, "Mode", "還沒有模式（正常操作、失效、中止）"),
      ];
    } },
  { id: "allocation", no: 4, title: "功能與分配",
    question: "要完成這個剖面需要哪些功能？每個功能分配到哪個系統（火箭、地面站⋯）？各系統因此有哪些系統需求？MOE 推出哪些 MOP，挑哪些當 TPM 追蹤？",
    pinned: ["Function", "System", "SystemRequirement", "MOE", "MOP"], links: ["allocate", "derive", "refine", "satisfy"],
    missing: (a) => [
      ...none(a, "Function", "還沒有功能"),
      ...each(a, "Function", (e) => linked(a, e.id, ["allocate"]), (n) => `${n} 還沒有分配到系統`),
      ...none(a, "System", "還沒有系統（例如火箭、地面站）"),
      ...none(a, "SystemRequirement", "還沒有系統需求"),
      ...each(a, "SystemRequirement", (e) => linked(a, e.id, ["derive", "refine", "trace"]), (n) => `${n} 還沒有來源（衍生自目的或 MOE）`),
      ...none(a, "MOP", "還沒有性能量度（MOP）"),
    ] },
  { id: "schematic", no: 5, title: "系統簡圖",
    question: "這個系統分成哪些次系統（包括外部提供的）與主要元件？各自在哪裡、誰包含誰？",
    pinned: ["System", "Subsystem", "Component", "ExternalEntity"], links: ["compose"],
    missing: (a) => [
      ...none(a, "System", "還沒有系統"),
      ...each(a, "System", (e) => a.elements.some((x) => x.owner === e.id && x.kind === "PartUsage"), (n) => `${n} 還沒有零件（用「組成」拉到次系統）`),
      ...none(a, "Subsystem", "還沒有次系統"),
    ] },
  { id: "interfaces", no: 6, title: "介面",
    question: "次系統之間交換什麼（機械、熱、電、流體、資料、人）？兩端的數字對得上嗎？",
    pinned: ["Subsystem", "Component", "ExternalEntity", "System"], links: ["connect", "compose"], n2: true,
    gap: "連接埠與介面目前沒有專屬的類別；N² 矩陣先由零件之間的連接（connect）產生。",
    missing: (a) => (a.relations.some((r) => r.kind === "connect") ? [] : [{ id: null, text: "還沒有介面：在內部連接圖上把兩個零件連起來" }]) },
  { id: "subreq", no: 7, title: "次系統需求",
    question: "系統需求拆給哪些次系統？每條次系統需求由哪個次系統負責？",
    pinned: ["SystemRequirement", "SubsystemRequirement", "Subsystem"], links: ["derive", "satisfy", "refine"],
    missing: (a) => [
      ...none(a, "SubsystemRequirement", "還沒有次系統需求"),
      ...each(a, "SubsystemRequirement", (e) => linked(a, e.id, ["derive"], ["SystemRequirement"]), (n) => `${n} 還沒有接到系統需求（衍生）`),
      ...each(a, "SubsystemRequirement", (e) => linked(a, e.id, ["satisfy"]), (n) => `${n} 還沒有負責的次系統（滿足）`),
    ] },
  { id: "verification", no: 8, title: "驗證矩陣",
    question: "每一條需求要怎麼證明有做到？用什麼驗證事件？結果如何？",
    pinned: [...REQS, "VerificationEvent"], links: [],
    missing: (a) => {
      const reqs = listOf(a.elements, ...REQS);
      if (!reqs.length) return [{ id: null, text: "還沒有任何需求。每條需求建立時就要填驗證方法。" }];
      return reqs.filter((e) => !linked(a, e.id, ["verify"])).map((e) => ({ id: e.id, text: `${shown(e)} 還沒有驗證事件（在右欄的驗證事件裡指定）` }));
    } },
  { id: "trade", no: 9, title: "方案比較", layered: true,
    question: "這次設計有哪些候選方案？用專案統一的準則與權重比下來選哪一個、為什麼不用其他的？",
    pinned: ["SystemRequirement", "SubsystemRequirement", "MOE", "MOP", "Risk", "Subsystem", "Component"], links: ["trace", "derive"],
    gap: "方案比較還沒有資料模型（評比準則、權重、候選方案、分數、選定與否決），要 Mars 決定。目前可以先把相關的需求與元素放上來，用便箋整理。",
    missing: () => [{ id: null, text: "還沒有方案比較。每次要設計的地方（系統層、各次系統）都要跑一次。" }] },
  { id: "risk", no: 10, title: "風險與 FMEA", layered: true,
    question: "哪些地方可能出錯？會威脅哪些需求？緩解措施產生了哪些新的需求、設計或驗證？",
    pinned: ["Risk", "Function", "Subsystem", "Component", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "VerificationEvent"], links: ["trace", "derive"],
    missing: (a) => [
      ...none(a, "Risk", "還沒有風險"),
      ...each(a, "Risk", (e) => linked(a, e.id, ["trace", "derive", "refine", "satisfy", "allocate"]), (n) => `${n} 還沒有連到受威脅的需求或元素`),
      ...each(a, "Risk", (e) => (e.attrs.severity ?? "").trim() !== "", (n) => `${n} 還沒有嚴重度`),
    ] },
];
export const VIEW_BY_DIAGRAM = new Map(METHOD_VIEWS.map((m) => [methodId(m.id), m]));

/** 分析圖在自訂圖清單裡的項目（空的）。 */
export const skeletonEntry = (m: MethodView) => ({ id: methodId(m.id), title: `${MARK[m.no]} ${m.title}`, members: [] as string[] });

/**
 * 畫面用的自訂圖：存檔裡沒有的分析圖補上空白的。
 * ids：這個專案有哪些分析圖（建立專案時的骨架）；沒有骨架的舊專案用全部 10 張。
 */
export function withMethod(stored: Diagrams, ids?: string[] | null): Diagrams {
  const have = new Set(stored.custom.map((c) => c.id));
  const want = METHOD_VIEWS.filter((m) => !ids || ids.includes(m.id));
  return { ...stored, custom: [...stored.custom, ...want.filter((m) => !have.has(methodId(m.id))).map(skeletonEntry)] };
}

/** 要寫進檔案的部分：補上的空白分析圖，沒有被修改過就不寫（既有專案不因為打開就被改檔案）。 */
export function persisted(next: Diagrams, stored: Diagrams): Diagrams {
  const was = new Set(stored.custom.map((c) => c.id));
  return { ...next, custom: next.custom.filter((c) => !isMethodId(c.id) || was.has(c.id) || c.members.length > 0 || (next.notes[c.id]?.length ?? 0) > 0) };
}

const CAT_LAYER: Record<string, Layer> = {
  Stakeholder: "mission", Expectation: "mission", Need: "mission", Goal: "mission", Objective: "mission", MOE: "mission", UseCase: "mission", MissionPhase: "mission", Mode: "mission",
  System: "system", SystemRequirement: "system", MOP: "system", Function: "system", ExternalEntity: "system",
  Subsystem: "subsystem", SubsystemRequirement: "subsystem",
  Component: "component", ComponentRequirement: "component",
};
const DEPTH: Record<Layer, number> = { mission: 0, system: 1, subsystem: 2, component: 3 };

/**
 * 元素屬於哪一層：需求、結構、任務類別直接看類別；風險等其他元素看它連到（或所在）的元素，取最細的一層。
 * 判斷不出來的回傳 null（「未分層」）。
 */
export function layerOf(a: Analysis, id: string): Layer | null {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const direct = (eid: string | null | undefined): Layer | null => {
    let e = eid ? byId.get(eid) : undefined;
    for (let i = 0; e && i < 8; i++) {
      if (e.category && CAT_LAYER[e.category]) return CAT_LAYER[e.category];
      // 零件（使用）看它的定義
      const t = e.typeIds.map((x) => byId.get(x)).find((x) => x?.category && CAT_LAYER[x.category]);
      if (t) return CAT_LAYER[t.category!];
      e = e.owner ? byId.get(e.owner) : undefined;
    }
    return null;
  };
  const own = byId.get(id);
  if (own?.category && CAT_LAYER[own.category]) return CAT_LAYER[own.category];
  const near = a.relations.filter((r) => r.from === id || r.to === id).map((r) => direct(r.from === id ? r.to : r.from));
  near.push(direct(own?.owner));
  const found = near.filter((x): x is Layer => !!x);
  return found.length ? found.sort((x, y) => DEPTH[y] - DEPTH[x])[0] : null;
}

/** N² 矩陣：對角線是有連接（或屬於系統定義）的零件，格子 (A, B) 是 A 到 B 的連接。 */
export function n2Matrix(a: Analysis): { parts: Element[]; cell: (from: string, to: string) => number } {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const conns = a.relations.filter((r) => r.kind === "connect");
  const ids = new Set<string>();
  for (const r of conns) { ids.add(r.from); ids.add(r.to); }
  const parts = [...ids].map((x) => byId.get(x)).filter((e): e is Element => !!e).sort((x, y) => x.qualifiedName.localeCompare(y.qualifiedName));
  return { parts, cell: (from, to) => conns.filter((r) => r.from === from && r.to === to).length };
}

export interface Stage {
  no: number; title: string;
  /** 審查節點（標題右邊的進度）；沒有就不顯示 */
  gate: string | null;
  categories: string[];
  /** 左欄列出的分析圖：圖的代號與附註 */
  views: { id: string; note?: string }[];
}
/** 路徑圖白板的 7 個階段；「貫穿全程」放在最後。 */
export const STAGES: Stage[] = [
  { no: 1, title: "任務定義", gate: "proposal", categories: ["Stakeholder", "Expectation", "UseCase", "Need", "Goal", "Objective", "MOE"], views: [{ id: "stakeholders" }, { id: "mission" }] },
  { no: 2, title: "任務剖面", gate: null, categories: ["MissionPhase", "Mode"], views: [{ id: "profile" }] },
  { no: 3, title: "系統層級", gate: "mdr", categories: ["Function", "System", "ExternalEntity", "SystemRequirement", "MOP"], views: [{ id: "allocation" }, { id: "schematic" }, { id: "interfaces" }] },
  { no: 4, title: "次系統層級", gate: "pdr", categories: ["Subsystem", "SubsystemRequirement"], views: [{ id: "subreq" }] },
  { no: 5, title: "細部設計", gate: "cdr", categories: ["Component", "ComponentRequirement"], views: [{ id: "schematic", note: "細化到元件層級" }, { id: "interfaces", note: "介面數字凍結" }] },
  { no: 6, title: "製造與測試", gate: "trr", categories: ["VerificationEvent", "ValidationEvent", "QCRecord"], views: [{ id: "verification", note: "填入結果" }] },
  { no: 7, title: "發射與收束", gate: "frr", categories: ["SOP", "RosterEntry", "Anomaly"], views: [] },
];
export const THROUGHOUT: Stage = { no: 0, title: "貫穿全程", gate: null, categories: ["Risk", "SafetyFactor"], views: [{ id: "verification" }, { id: "trade" }, { id: "risk" }] };

/** 目前所在的階段：第一個節點還沒完成的階段；任務剖面還沒有內容而 MDR 未完成時是任務剖面。 */
export function currentStage(view: View): number {
  const gate = (id: string | null) => view.gates.find((g) => g.id === id);
  const count = (s: Stage) => s.categories.reduce((n, c) => n + listOf(view.analysis.elements, c).length, 0);
  for (const s of STAGES) {
    if (s.no === 2) { const mdr = gate("mdr"); if (mdr && mdr.done < mdr.total && count(s) === 0) return 2; continue; }
    const g = gate(s.gate);
    if (g && g.done < g.total) return s.no;
  }
  return 7;
}

