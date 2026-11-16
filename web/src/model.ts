// 由模型資料推導出樹、表與圖。圖不另存，永遠從模型產生。
// 圖的記法依 OMG SysML v2（8.2.3 Graphical Notation）：
//   定義（part def 等）為方角矩形、使用（part、requirement、action、state、use case…）為圓角矩形，
//   名稱隔間第一行是 «關鍵字»，第二行是「<編號> 名稱 : 型別」；套件為帶標籤頁的資料夾；註解為折角便箋。
//   相依（dependency，含 #trace、#refinement）為虛線開放箭頭；satisfy、verify、allocate 為實線開放箭頭加 «關鍵字»；
//   需求衍生是連結（#derivation connection，8.2.3.13），畫成實線開放箭頭，從子需求指向母需求，標 «#derivation»；
//   組成（composite feature membership）在擁有者一端畫實心菱形、另一端是零件（使用）；
//   「零件由哪個定義所定義」為實線、定義端空心三角形加兩點；起始為實心圓、完成為牛眼。
//   特化與子集為實線、上位端空心三角形；重定義在三角形後加一條豎線；參照子集在三角形後加四個點（8.2.3.5、8.2.3.6）；
//   非組成的零件（ref part）在擁有者一端畫空心菱形，節點外框為虛線（8.2.3.11）；
//   套件不畫成員時名稱寫在資料夾本體中央（8.2.3.5）。
import type { Analysis, Diagrams, Element, Layout } from "./api.ts";
import { ANALYSIS_VIEWS } from "./method/views.ts";
import type { AnalysisView } from "./method/views.ts";

const STRUCTURAL = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);

export const label = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);

/** 與伺服器相同的規則：結構類別只列定義，其餘只列使用。 */
export function listOf(elements: Element[], ...cats: string[]): Element[] {
  return elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" &&
    (STRUCTURAL.has(e.category) ? e.kind === "PartDefinition" : e.kind.endsWith("Usage")));
}

/** 可以放進圖裡的模型項目：有類別的元素；結構類別只取定義，其餘只取使用。 */
export function modelItems(elements: Element[]): Element[] {
  return elements.filter((e) => e.category !== null && e.kind !== "ReferenceUsage" && (STRUCTURAL.has(e.category) ? e.kind === "PartDefinition" : e.kind.endsWith("Usage")));
}

// ───────── 依套件瀏覽（F-74、F-75）─────────
export const isPackage = (e: Element) => e.kind === "Package" || e.kind === "LibraryPackage";
/** all：依樹的順序（先上層、再下層）；children 的鍵是上層的識別碼，最上層是 null；size：底下一共有幾個元素。 */
export interface TreeIndex { all: Element[]; byId: Map<string, Element>; children: Map<string | null, Element[]>; size: Map<string, number>;
  /** 底下具名的元素有幾個（畫面上顯示的數字） */
  named: Map<string, number> }

/** 把具名的元素與沒有名字的使用依擁有關係接成樹。每個元素恰好出現一次。同一層依檔案與行號排，沒有名字的排在同一行的後面。 */
export function treeOf(a: Pick<Analysis, "elements" | "unnamed">): TreeIndex {
  const list = [...a.elements, ...(a.unnamed ?? [])];
  const byId = new Map(list.map((e) => [e.id, e]));
  const children = new Map<string | null, Element[]>();
  list.forEach((e) => {
    // 上層不在清單裡（不應該發生）就放到最上層，不要讓元素消失
    const p = e.parent != null && byId.has(e.parent) && e.parent !== e.id ? e.parent : null;
    children.set(p, [...(children.get(p) ?? []), e]);
  });
  const order = new Map(list.map((e, i) => [e.id, i]));
  for (const kids of children.values()) kids.sort((x, y) => x.file.localeCompare(y.file) || (x.line ?? 1e9) - (y.line ?? 1e9) || (order.get(x.id) as number) - (order.get(y.id) as number));
  const all: Element[] = [], size = new Map<string, number>(), named = new Map<string, number>();
  const walk = (parent: string | null, seen: Set<string>): [number, number] => {
    let n = 0, m = 0;
    for (const e of children.get(parent) ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id); all.push(e);
      const [below, belowNamed] = walk(e.id, seen);
      size.set(e.id, below); named.set(e.id, belowNamed);
      n += 1 + below; m += (e.unnamed ? 0 : 1) + belowNamed;
    }
    return [n, m];
  };
  walk(null, new Set());
  return { all, byId, children, size, named };
}
/** 由近到遠的上層。 */
export function ancestorsOf(t: TreeIndex, id: string): string[] {
  const out: string[] = [];
  for (let cur = t.byId.get(id); cur?.parent != null && t.byId.has(cur.parent) && out.length < 60; cur = t.byId.get(cur.parent)) out.push(cur.parent);
  return out;
}
/** 某個元素底下的全部元素（不含它自己），依樹的順序；id 是 null 表示整個模型。 */
export function descendantsOf(t: TreeIndex, id: string | null): Element[] {
  if (id === null) return t.all;
  const i = t.all.findIndex((e) => e.id === id);
  return i < 0 ? [] : t.all.slice(i + 1, i + 1 + (t.size.get(id) ?? 0));
}
/** 元素所在的套件（它自己是套件就是自己）；沒有就是 null。 */
export function packageOf(t: TreeIndex, id: string): string | null {
  const self = t.byId.get(id);
  if (!self) return null;
  if (isPackage(self)) return id;
  return ancestorsOf(t, id).find((x) => isPackage(t.byId.get(x) as Element)) ?? null;
}
/** 型別一欄的寫法，和 SysML v2 文字記法一致。 */
export const LINK_SYMBOL: Record<string, string> = { type: ":", specialize: ":>", subset: ":>", redefine: ":>>", reference: "::>" };
export const LINK_ZH: Record<string, string> = { specialize: "特化", type: "由…定義", subset: "子集", redefine: "重定義", reference: "參照", perform: "執行" };

/**
 * pkg 套件內容、decomp 零件分解（F-76）；req 需求、uc 使用案例（F-77）；stm 狀態機（F-78）；act 動作流程、fdecomp 功能分解（F-79）；
 * ibd 互連（F-80）；occ 個體、時間切片與快照、calc 計算與分析（F-81）；custom 自訂圖；
 * analysis 分析圖（METHOD.md 第 3 節，P2）：一個階段一張，跨套件放任何元素。
 */
export type DiagramKind = "pkg" | "decomp" | "fdecomp" | "req" | "act" | "ibd" | "uc" | "stm" | "occ" | "calc" | "custom" | "analysis";
/** 內容完全由模型的擁有關係決定的圖：不畫使用者套件的框，也不提供「新增套件」。 */
export const STRUCTURAL_KINDS = new Set<DiagramKind>(["pkg", "decomp", "fdecomp", "occ", "calc"]);
/**
 * code／viewDef：SysML v2 標準檢視定義的短名稱與名稱（StandardViewDefinitions）。
 * members 只有自訂圖與分析圖使用：這張圖放了哪些模型項目。view：分析圖在 method/views.ts 的登記。
 */
export interface DiagramDef { id: string; kind: DiagramKind; code: string; viewDef: string; title: string; context: string | null; members?: string[]; view?: AnalysisView }
const VIEW: Record<DiagramKind, [code: string, viewDef: string]> = {
  pkg: ["GV", "GeneralView"], decomp: ["GV", "GeneralView"], fdecomp: ["GV", "GeneralView"], req: ["GV", "GeneralView"], uc: ["GV", "GeneralView"], custom: ["GV", "GeneralView"], analysis: ["GV", "GeneralView"],
  occ: ["GV", "GeneralView"], calc: ["GV", "GeneralView"],
  ibd: ["IV", "InterconnectionView"], act: ["AFV", "ActionFlowView"], stm: ["STV", "StateTransitionView"],
};
/** 圖框標籤：«view» 名稱 : 檢視定義。 */
export const frameLabel = (d: DiagramDef) => `«view» ${d.title} : ${d.viewDef}`;

/** pkgbox：不畫成員的套件，名稱寫在資料夾本體中央（一般的節點，不是可以把項目拖進去的框）。 */
/** param：動作的參數與零件邊上的連接埠，小方塊加名稱（規範 8.2.3.12、8.2.3.17）。 */
export type Shape = "def" | "usage" | "package" | "pkgbox" | "comment" | "start" | "done" | "param";
export interface GNode {
  id: string;
  el: Element | null; // 起始與完成節點沒有對應的模型元素
  shape: Shape;
  keyword: string; // «part def»、«requirement»…；沒有就是空字串
  name: string;
  title: string[]; // 名稱依寬度折行後的結果
  compartments: string[][]; // 每個隔間的第一列是標題（斜體置中）
  width: number;
  height: number;
  /** 所在的使用者套件（也在這張圖上時才有） */
  parent?: string;
  /** 外框畫成虛線：參照的使用（ref），不是組成的一部分 */
  dashed?: boolean;
  /** 列在這個節點隔間裡的元素（套件內容圖與分解圖才有） */
  covers?: string[];
  /**
   * 貼在節點左右邊上的小方塊（階段 4，規範 8.2.3.12 的連接埠、8.2.3.17 的參數）。y 是方塊中心到節點頂端的距離；
   * key 用來讓連線接在這個方塊上（GEdge 的 sourcePort／targetPort）。
   */
  ports?: NodePort[];
  /** 名稱與隔間之間留給 ports 的高度 */
  band?: number;
  /** 貼在圖框邊上的節點（這張圖的動作自己的參數、這個定義自己的連接埠）：位置由圖框決定，不能拖曳 */
  boundary?: "left" | "right";
  /** P2 系統簡圖：包住零件的外框（大小由版面決定，可以拉大小）；inside 是這個節點所在的外框 */
  container?: boolean;
  inside?: string;
}
export interface NodePort { key: string; label: string; side: "left" | "right"; y: number }
export interface GEdge {
  id: string; source: string; target: string; kind: string; label: string;
  dashed: boolean;
  // 終點記號：開放箭頭、空心三角形加兩點（defined by）、空心三角形（特化、子集）、三角形加豎線（重定義）、三角形加四點（參照子集）
  head: "open" | "typing" | "triangle" | "redefine" | "refsubset" | "none";
  tail: "diamond" | "hollow" | "none"; // 起點記號：實心菱形（組成）、空心菱形（非組成）
  /** 刪除這條線時要做的事：刪關係，或刪掉代表它的元素。 */
  remove: { type: "relation"; kind: string; from: string; to: string } | { type: "element"; id: string } | null;
  /** 接在端點節點的哪一個小方塊（NodePort 的 key）上；沒有就接在節點的外框 */
  sourcePort?: string; targetPort?: string;
  /** 存轉折點用的識別碼（P2）：關係的連線不含流水號，模型增減別的關係時不會跑掉；沒有就用 id */
  key?: string;
}
/** reverse：排版時要反向看待的連線種類（例如追溯是由下層指向上層，上層應排在上方）。 */
export interface Graph { nodes: GNode[]; edges: GEdge[]; direction: "TB" | "BT" | "LR" | "RL"; reverse?: string[];
  /** 節點超過上限時，有幾個元素改列在隔間裡 */
  folded?: number;
  /** P2：rocket 是系統簡圖，外框裡的零件照實際位置由上而下疊起來 */
  arrange?: "tb" | "rocket" }

/** SysML v2 的關鍵字：由元類別名稱得出，例如 PartDefinition → «part def»、UseCaseUsage → «use case»。 */
const KEYWORD: Record<string, string> = { VerificationCaseUsage: "verification", VerificationCaseDefinition: "verification def", Comment: "comment" };
export const stereotype = (e: Element) => {
  if (e.kind === "Package") return "package";
  const k = KEYWORD[e.kind] ?? e.kind.replace(/(Usage|Definition)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() + (e.kind.endsWith("Definition") ? " def" : "");
  return `«${k}»`;
};
const EDGE_LABEL: Record<string, string> = { derive: "«#derivation»", refine: "«#refinement»", trace: "«#trace»", satisfy: "«satisfy»", verify: "«verify»", allocate: "«allocate»", include: "«include»" };

/** 依寬度折行：中日韓字算 2、其餘算 1。 */
export function wrap(text: string, units: number, maxLines: number): string[] {
  const out: string[] = [];
  let line = "", w = 0;
  for (const ch of text.replace(/\s+/g, " ").trim()) {
    const cw = ch.charCodeAt(0) > 0x2e7f ? 2 : 1;
    if (w + cw > units && line) { out.push(line); line = ""; w = 0; }
    line += ch; w += cw;
  }
  if (line) out.push(line);
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] = out[maxLines - 1].slice(0, -1) + "…"; }
  return out;
}

const NODE_W = 220;
/** 名稱隔間的寫法：<編號> 名稱 : 型別（定義則為 :> 上層定義）。 */
function nameOf(el: Element): string {
  if (el.unnamed) return el.name;
  const sn = el.shortName ? `<${el.shortName}> ` : "";
  const t = el.types[0];
  return `${sn}${el.name}${t ? (el.kind.endsWith("Definition") ? ` :> ${t}` : ` : ${t}`) : ""}`;
}

function makeNode(el: Element, compartments: string[][] = [], text = nameOf(el)): GNode {
  const comps = compartments.filter((c) => c.length > 1);
  const title = wrap(text, Math.floor((NODE_W - 20) / 6.6), 3);
  const height = 26 + title.length * 16 + 8 + comps.reduce((s, c) => s + c.length * 16 + 9, 0);
  return { id: el.id, el, shape: el.kind.endsWith("Definition") ? "def" : "usage", keyword: stereotype(el), name: el.name, title, compartments: comps, width: NODE_W, height };
}
/** 隔間佔的高度（和 makeNode 的算法相同）。 */
const heightOf = (comps: string[][]) => comps.reduce((h, c) => h + c.length * 16 + 9, 0);
const pseudo = (id: string, shape: "start" | "done"): GNode => ({ id, el: null, shape, keyword: "", name: "", title: [], compartments: [], width: 26, height: 26 });

/** 套件節點：大小由版面決定，這裡給預設值。 */
export const PKG_TAB = 24;
const pkgNode = (el: Element): GNode => ({ id: el.id, el, shape: "package", keyword: "", name: el.name, title: [el.name], compartments: [], width: 360, height: 240 });
function commentNode(el: Element): GNode {
  const lines = wrap(el.doc || "（空白）", 24, 8);
  return { id: el.id, el, shape: "comment", keyword: "«comment»", name: el.name, title: lines, compartments: [], width: 190, height: 34 + lines.length * 16 };
}

const edge = (id: string, source: string, target: string, kind: string, text: string, remove: GEdge["remove"]): GEdge => ({
  id, source, target, kind, label: text, remove,
  dashed: ["refine", "trace", "annotate", "import"].includes(kind),
  head: kind === "define" ? "typing" : kind === "specialize" || kind === "subset" ? "triangle" : kind === "redefine" ? "redefine" : kind === "reference" ? "refsubset"
    : ["compose", "refpart", "connect", "annotate"].includes(kind) ? "none" : "open",
  tail: kind === "compose" ? "diamond" : kind === "refpart" ? "hollow" : "none",
});

const REQ_CATS = ["Expectation", "Need", "Goal", "Objective", "MOE", "MOP", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement"];

/** 一般的節點：需求顯示 doc 隔間，定義顯示 attributes 隔間。 */
function node(e: Element, a: Analysis): GNode {
  if (e.kind === "RequirementUsage" || e.kind === "RequirementDefinition") return makeNode(e, e.doc ? [["doc", ...wrap(e.doc, 32, 4)]] : []);
  if (e.kind === "PartDefinition") {
    const attrs = a.elements.filter((x) => x.owner === e.id && x.kind === "AttributeUsage").map((x) => `${x.tags.includes("TPM") ? "#tpm " : ""}${x.name}${x.types[0] ? " : " + x.types[0] : ""}`);
    return makeNode(e, [["attributes", ...attrs.slice(0, 6)]]);
  }
  return makeNode(e);
}

/** 最上層的套件內容圖。 */
export const TOP_DIAGRAM = "pkg:";
/** 一張圖最多畫幾個節點；超過的改列在隔間裡（F-76）。只是防止極端的模型拖垮瀏覽器的保險，一般的模型不會碰到。 */
export const NODE_LIMIT = 500;

const isAction = (e: Element) => /ActionUsage$/.test(e.kind);
const isRequirement = (e: Element) => e.kind === "RequirementUsage" || e.kind === "RequirementDefinition";
const isUseCase = (e: Element) => e.kind === "UseCaseUsage" || e.kind === "UseCaseDefinition";
const STATE_KINDS = new Set(["StateDefinition", "StateUsage", "ExhibitStateUsage"]);
const CALC_KINDS = new Set(["CalculationDefinition", "CalculationUsage", "AnalysisCaseDefinition", "AnalysisCaseUsage"]);
/** 時間切片與快照（規範 8.2.3.9）。 */
const isPortion = (e: Element) => /^(snapshot|timeslice)$/.test(e.keyword ?? "");

export function diagramsOf(a: Analysis, extra?: Diagrams): DiagramDef[] {
  const def = (id: string, kind: DiagramKind, title: string, context: string | null, members?: string[]): DiagramDef => ({ id, kind, code: VIEW[kind][0], viewDef: VIEW[kind][1], title, context, members });
  // 套件內容圖：最上層一張，每個套件一張；分解圖：每個擁有零件的零件定義一張（F-76）
  const t = treeOf(a);
  const out: DiagramDef[] = [def(TOP_DIAGRAM, "pkg", "模型", null)];
  for (const e of t.all) if (isPackage(e)) out.push(def(`pkg:${e.qualifiedName}`, "pkg", e.name, e.id));
  for (const e of t.all) if (e.kind === "PartDefinition" && !e.unnamed && (t.children.get(e.id) ?? []).some((c) => c.kind === "PartUsage")) out.push(def(`decomp:${e.qualifiedName}`, "decomp", e.name, e.id));
  // 功能分解（F-79）：每個擁有動作的動作定義一張
  const kidsOf = (e: Element) => t.children.get(e.id) ?? [];
  for (const e of t.all) if (e.kind === "ActionDefinition" && !e.unnamed && !e.shared && kidsOf(e).some(isAction)) out.push(def(`fdecomp:${e.qualifiedName}`, "fdecomp", e.name, e.id));
  // 需求與使用案例（F-77）：整個模型各一張（原本的圖，版面紀錄沿用），再加上每個有需求、使用案例的套件一張
  out.push(def("req", "req", "需求追溯", null), def("uc", "uc", "使用案例", null));
  for (const p of t.all) {
    if (!isPackage(p) || p.shared) continue;
    const inside = descendantsOf(t, p.id).filter((e) => !e.shared && packageOf(t, e.id) === p.id);
    if (inside.some(isRequirement)) out.push(def(`req:${p.qualifiedName}`, "req", `需求 ${p.name}`, p.id));
    if (inside.some(isUseCase)) out.push(def(`uc:${p.qualifiedName}`, "uc", `使用案例 ${p.name}`, p.id));
  }
  const byKind = (id: string | null) => a.elements.find((e) => e.id === id)?.kind;
  const kids = (id: string, kind: string) => a.elements.some((e) => e.owner === id && e.kind === kind);
  const own = (e: Element) => !e.shared && !e.unnamed;
  for (const e of a.elements) {
    if (e.kind === "PartDefinition" && kids(e.id, "PartUsage")) out.push(def(`ibd:${e.qualifiedName}`, "ibd", e.name, e.id));
    // 狀態機（F-78）：原本的模式之外，任何擁有狀態的狀態定義、狀態、exhibit state
    const oldStm = e.kind === "StateUsage" && (kids(e.id, "StateUsage") || e.category === "Mode") && byKind(e.owner) !== "StateUsage";
    if (oldStm || (own(e) && STATE_KINDS.has(e.kind) && kidsOf(e).some((c) => STATE_KINDS.has(c.kind) && c.kind !== "StateDefinition"))) out.push(def(`stm:${e.qualifiedName}`, "stm", e.name, e.id));
    // 動作流程（F-79）：原本的任務與功能之外，任何擁有動作的動作定義與動作
    const oldAct = e.kind === "ActionUsage" && kids(e.id, "ActionUsage");
    if (oldAct || (own(e) && (e.kind === "ActionDefinition" || isAction(e)) && kidsOf(e).some(isAction))) out.push(def(`act:${e.qualifiedName}`, "act", e.name, e.id));
    // 個體、時間切片與快照（F-81）
    if (own(e) && kidsOf(e).some(isPortion)) out.push(def(`occ:${e.qualifiedName}`, "occ", e.name, e.id));
    // 計算與分析（F-81）：不在另一個計算或分析裡的
    if (own(e) && CALC_KINDS.has(e.kind) && !CALC_KINDS.has(t.byId.get(e.parent ?? "")?.kind ?? "")) out.push(def(`calc:${e.qualifiedName}`, "calc", e.name, e.id));
  }
  for (const c of extra?.custom ?? []) out.push(def(c.id, "custom", c.title, null, c.members));
  return out;
}

/** 使用者自己建的套件：專案內、不是根套件、也不是工具依類別自動建立的那幾個。 */
export function isUserPackage(e: Element | undefined, categoryPackages: Set<string>): boolean {
  if (!e || e.kind !== "Package" || e.shared) return false;
  const depth = e.qualifiedName.split("::").length;
  return depth > 1 && !(depth === 2 && categoryPackages.has(e.name));
}

/**
 * packages：工具依類別建立的套件名稱（用來分辨哪些是使用者自己建的套件）。
 * shown：即使沒有成員或對象也要畫出來的套件與註解（剛在這張圖上建立的）。
 * 不給 opts 時不畫套件與註解（審查報告用）。
 */
export function buildGraph(d: DiagramDef, a: Analysis, opts?: { packages: Set<string>; shown: Set<string> }): Graph {
  const g = baseGraph(d, a);
  if (!opts) return g;
  const ids = new Set(g.nodes.map((n) => n.id));
  // 套件內容圖與分解圖由模型的擁有關係決定內容，不另外畫套件的框
  const structural = STRUCTURAL_KINDS.has(d.kind);
  // 套件：有成員在這張圖上，或剛在這張圖上建立
  for (const p of a.elements) {
    if (structural || !isUserPackage(p, opts.packages)) continue;
    const members = g.nodes.filter((n) => n.el?.owner === p.id);
    if (members.length === 0 && !opts.shown.has(p.id)) continue;
    for (const m of members) m.parent = p.id;
    g.nodes.unshift(pkgNode(p));
  }
  // 註解：說明的對象在這張圖上，或剛在這張圖上建立
  for (const c of a.elements) {
    if (c.kind !== "Comment" || c.shared) continue;
    const about = (c.about ?? []).filter((x) => ids.has(x));
    if (about.length === 0 && (structural || !opts.shown.has(c.id))) continue;
    if (!ids.has(c.id)) g.nodes.push(commentNode(c));
    about.forEach((x) => g.edges.push(edge(`annotate:${c.id}:${x}`, c.id, x, "annotate", "", null)));
  }
  return g;
}

function baseGraph(d: DiagramDef, a: Analysis): Graph {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const relEdge = (r: Analysis["relations"][number], i: number): GEdge => {
    const e = { ...edge(`${r.kind}:${r.from}:${r.to}:${i}`, r.from, r.to, r.kind, EDGE_LABEL[r.kind] ?? "", { type: "relation", kind: r.kind, from: r.from, to: r.to }), key: `${r.kind}:${r.from}:${r.to}` };
    // 內建的 stakeholder、actor 是需求或使用案例的參數，規範 8.2.3.21 畫成一條沒有箭頭、沒有標籤的實線
    return r.form ? { ...e, dashed: false, head: "none", label: "" } : e;
  };
  /**
   * 被當成參與者或利害關係人連上的節點，關鍵字改成 «actor»、«stakeholder»（規範 8.2.3.21）。
   * 同一位利害關係人在一張圖上同時有兩種身分時，用這張圖的主題決定（prefer）；自訂圖沒有主題，就維持原本的 «part»。
   */
  const roles = (nodes: GNode[], rels: Analysis["relations"], prefer?: "stakeholder" | "actor"): GNode[] => nodes.map((n) => {
    const forms = new Set(rels.filter((r) => r.form && r.to === n.id).map((r) => r.form));
    const role = prefer && forms.has(prefer) ? prefer : forms.size === 1 ? [...forms][0] : null;
    return role ? { ...n, keyword: `«${role}»` } : n;
  });
  /** 結構分解：定義擁有零件（實心菱形在定義端），零件再指向定義它的定義。 */
  const composition = (ids: Set<string>, nodes: GNode[], edges: GEdge[]) => {
    for (const u of a.elements) {
      if (u.kind !== "PartUsage" || !u.owner || !ids.has(u.owner)) continue;
      const t = u.typeIds.find((x) => ids.has(x));
      if (!t) continue;
      nodes.push(makeNode(u));
      edges.push(edge(`compose:${u.id}`, u.owner, u.id, "compose", "", { type: "element", id: u.id }));
      edges.push(edge(`define:${u.id}`, u.id, t, "define", "", null));
    }
  };

  if (d.kind === "custom") {
    // 自訂圖：使用者挑選的任何模型項目，以及它們之間已存在的所有關係
    const ids = new Set((d.members ?? []).filter((id) => byId.has(id)));
    const rels = a.relations.filter((r) => ids.has(r.from) && ids.has(r.to));
    const nodes = roles([...ids].map((id) => node(byId.get(id)!, a)), rels);
    const edges = rels.map((r, i) => relEdge(r, i));
    composition(ids, nodes, edges);
    return { nodes, edges, direction: "TB", reverse: ["derive", "refine", "trace", "satisfy", "verify"] };
  }

  if (d.kind === "analysis") {
    // 分析圖（P2）：使用者放進來的任何元素，以及它們之間已存在的所有關係。系統簡圖另外把零件定義畫成外框、零件疊在裡面
    const ids = new Set((d.members ?? []).filter((id) => byId.has(id)));
    const rocket = d.view?.arrange === "rocket";
    const nodes: GNode[] = [];
    const edges: GEdge[] = [];
    const inside = new Set<string>();
    for (const id of ids) {
      const e = byId.get(id)!;
      const parts = rocket && e.kind === "PartDefinition" ? stationOrder(a.elements.filter((u) => u.owner === e.id && u.kind === "PartUsage")) : [];
      if (parts.length === 0) { nodes.push(node(e, a)); continue; }
      const box = containerNode(e, parts.map((u) => makeNode(u)));
      nodes.push(box.node);
      for (const n of box.parts) if (!ids.has(n.id)) { nodes.push(n); inside.add(n.id); }
    }
    const all = new Set([...ids, ...inside]);
    const rels = a.relations.filter((r) => all.has(r.from) && all.has(r.to));
    edges.push(...rels.map((r, i) => relEdge(r, i)));
    if (!rocket) composition(ids, nodes, edges);
    linkEdges(a, all, edges);
    return { nodes: roles(nodes, rels), edges, direction: "TB", reverse: ["derive", "refine", "trace", "satisfy", "verify"], arrange: rocket ? "rocket" : "tb" };
  }
  if (d.kind === "pkg") return packageGraph(d, a);
  if (d.kind === "decomp" || d.kind === "fdecomp") return decompositionGraph(d, a);
  if (d.kind === "req") return requirementGraph(d, a, relEdge, roles);
  if (d.kind === "uc") return useCaseGraph(d, a, relEdge, roles);
  if (d.kind === "stm") return stateGraph(d, a, relEdge);
  if (d.kind === "act") return actionGraph(d, a, relEdge);
  if (d.kind === "ibd") return interconnectionGraph(d, a, relEdge);
  if (d.kind === "occ") return occurrenceGraph(d, a, relEdge);
  return calculationGraph(d, a);
}

// ───────── 套件內容圖與分解圖（F-76）─────────
const isRef = (e: Element) => e.kind === "ReferenceUsage" || /(^|\s)ref(\s|$)/.test(e.keyword ?? "");
/**
 * 隔間的標題（規範 8.2.3.6，階段 4 起依 8.2.3.12、8.2.3.17、8.2.3.18、8.2.3.20、8.2.3.9 分出連接埠、動作、狀態、限制等專屬的隔間）。
 * 第二個值是這個隔間已經表示的關鍵字，列的時候不再寫。其餘的使用放 features，不是使用的放 members。
 */
const COMPARTMENT: Record<string, [title: string, keyword: string]> = {
  AttributeUsage: ["attributes", "attribute"], PartUsage: ["parts", "part"], ItemUsage: ["items", "item"], PortUsage: ["ports", "port"],
  ActionUsage: ["actions", "action"], PerformActionUsage: ["perform actions", "perform action"], AcceptActionUsage: ["actions", ""], SendActionUsage: ["actions", ""],
  StateUsage: ["states", "state"], ExhibitStateUsage: ["exhibit states", "exhibit state"],
  ConstraintUsage: ["constraints", "constraint"], AssertConstraintUsage: ["constraints", ""], RequirementUsage: ["requirements", "requirement"],
  ConnectionUsage: ["connections", "connection"], InterfaceUsage: ["interfaces", "interface"], CalculationUsage: ["calcs", "calc"], AnalysisCaseUsage: ["analyses", "analysis"],
  UseCaseUsage: ["use cases", "use case"],
};
/** 依關鍵字決定的隔間：需求與案例的角色、限制的種類、狀態的動作、時間切片與快照。 */
const KEYWORD_COMPARTMENT: Record<string, [title: string, keyword: string]> = {
  subject: ["subject", "subject"], actor: ["actors", "actor"], stakeholder: ["stakeholders", "stakeholder"], objective: ["objective", "objective"],
  "require constraint": ["require constraints", "require constraint"], "assume constraint": ["assume constraints", "assume constraint"],
  "entry action": ["actions", ""], "do action": ["actions", ""], "exit action": ["actions", ""],
  snapshot: ["snapshots", "snapshot"], timeslice: ["timeslices", "timeslice"],
};
const COMPARTMENT_ORDER = ["subject", "actors", "stakeholders", "objective", "parameters", "attributes", "ports", "parts", "items", "actions", "perform actions", "states", "exhibit states",
  "require constraints", "assume constraints", "constraints", "requirements", "use cases", "connections", "interfaces", "calcs", "analyses", "timeslices", "snapshots", "features", "members"];
/** 行為（動作、計算、狀態、需求、案例）的 in／out／inout 特徵是參數（規範 8.2.3.17）。 */
const BEHAVIOR = /(Action|Calculation|AnalysisCase|VerificationCase|UseCase|State|Requirement|Constraint)(Usage|Definition)$/;
function compartmentOf(owner: Element, c: Element): [title: string, keyword: string] {
  const kw = c.keyword ?? "";
  if (KEYWORD_COMPARTMENT[kw]) return KEYWORD_COMPARTMENT[kw];
  if (/^(in|out|inout)\b/.test(kw) && BEHAVIOR.test(owner.kind)) return ["parameters", ""];
  return COMPARTMENT[c.kind] ?? [c.kind.endsWith("Usage") ? "features" : "members", ""];
}

interface Structure { t: TreeIndex; redefines: Map<string, string[]>; a: Analysis;
  /** 元素的第一個型別是用哪種關係寫的（「元素|對象名稱」→ 關係種類），決定寫成 :、:>、:>> 或 ::> */
  how: Map<string, string> }
function structureOf(a: Analysis): Structure {
  const redefines = new Map<string, string[]>();
  for (const l of a.links ?? []) if (l.kind === "redefine" && l.to) redefines.set(l.from, [...(redefines.get(l.from) ?? []), l.to]);
  const how = new Map<string, string>();
  for (const l of a.links ?? []) if (!how.has(`${l.from}|${l.toName}`)) how.set(`${l.from}|${l.toName}`, l.kind);
  return { t: treeOf(a), redefines, a, how };
}
/** 零件是由哪些定義所定義。重定義而沒有另外寫型別的零件，沿著被重定義的特徵往上找。 */
function definitionsOf(s: Structure, id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const e = s.t.byId.get(id);
  if (!e) return [];
  const out: string[] = [];
  for (const x of [...e.typeIds, ...(s.redefines.get(id) ?? [])]) {
    const te = s.t.byId.get(x);
    if (!te) continue;
    for (const d of te.kind.endsWith("Definition") ? [x] : definitionsOf(s, x, seen)) if (!out.includes(d)) out.push(d);
  }
  return out;
}
/** 名稱的寫法。沒有名字而重定義別的特徵的使用寫成「:>> 名稱」。 */
function titleOf(s: Structure, e: Element): string {
  return e.unnamed ? (s.redefines.has(e.id) ? `:>> ${e.name}` : e.name) : `${e.shortName ? `<${e.shortName}> ` : ""}${typed(s, e)}`;
}
/** 「名稱 : 型別」，符號和 SysML v2 文字記法一致。 */
function typed(s: Structure, e: Element): string {
  const t = e.types[0];
  if (!t) return e.name;
  return `${e.name} ${LINK_SYMBOL[s.how.get(`${e.id}|${t}`) ?? ""] ?? (e.kind.endsWith("Definition") ? ":>" : ":")} ${t}`;
}
/** 隔間裡的一列。implied：這個隔間本身已經表示的關鍵字（例如 parts 隔間裡的 part 不必再寫）。 */
function rowOf(s: Structure, e: Element, implied = ""): string {
  const kw = e.keyword ?? "";
  if (e.unnamed) { const n = titleOf(s, e); return !kw || n.startsWith(kw) ? n : `${kw} ${n}`; }
  const text = `${e.tags.includes("TPM") ? "#tpm " : ""}${typed(s, e)}`;
  return !kw || kw === implied ? text : `${kw} ${text}`;
}
/** 元素底下各層的內容排成隔間：直接的下層依種類分隔間，更下層的縮排列在它的上層後面。套件有自己的圖，不再往下列。 */
function compartmentsOf(s: Structure, e: Element, skip: Set<string> = new Set()): { compartments: string[][]; covers: string[] } {
  const groups = new Map<string, string[]>(), covers: string[] = [];
  const below = (p: Element, depth: number, rows: string[]) => {
    if (isPackage(p)) return;
    for (const c of s.t.children.get(p.id) ?? []) { rows.push(`${"· ".repeat(depth)}${rowOf(s, c)}`); covers.push(c.id); below(c, depth + 1, rows); }
  };
  for (const c of s.t.children.get(e.id) ?? []) {
    if (skip.has(c.id)) continue;
    const [title, implied] = compartmentOf(e, c);
    const rows = groups.get(title) ?? [];
    rows.push(rowOf(s, c, implied)); covers.push(c.id);
    below(c, 1, rows);
    groups.set(title, rows);
  }
  return { compartments: COMPARTMENT_ORDER.filter((k) => groups.has(k)).map((k) => [k, ...(groups.get(k) as string[])]), covers };
}
/** 不畫成員的套件（name-inside）；rows 有內容時加一個 members 隔間（節點超過上限時用）。 */
function packageBox(id: string, el: Element | null, name: string, rows: string[] = [], covers: string[] = []): GNode {
  const title = wrap(name, Math.floor((NODE_W - 20) / 6.6), 3);
  const compartments = rows.length ? [["members", ...rows]] : [];
  return { id, el, shape: "pkgbox", keyword: "", name, title, compartments, covers, width: NODE_W, height: PKG_TAB / 2 + 22 + title.length * 16 + 10 + compartments.reduce((n, c) => n + c.length * 16 + 9, 0) };
}
/** 套件內容圖與分解圖上的一個節點：名稱、各層內容的隔間；參照的使用外框為虛線。 */
function structureNode(s: Structure, e: Element, skip?: Set<string>): GNode {
  if (isPackage(e)) return packageBox(e.id, e, e.name);
  if (e.kind === "Comment") return commentNode(e);
  const { compartments, covers } = compartmentsOf(s, e, skip);
  const doc = (e.kind === "RequirementUsage" || e.kind === "RequirementDefinition") && e.doc ? [["doc", ...wrap(e.doc, 32, 4)]] : [];
  return { ...makeNode(e, [...doc, ...compartments], titleOf(s, e)), covers, ...(isRef(e) ? { dashed: true } : {}) };
}
const GENERAL = ["specialize", "subset", "redefine", "reference"];
/** 兩端都在圖上的特化、子集、重定義、參照子集，以及「由誰定義」（已經畫過的不重複）。 */
function linkEdges(a: Analysis, ids: Set<string>, edges: GEdge[]): void {
  const have = new Set(edges.map((e) => `${e.kind}|${e.source}|${e.target}`));
  for (const l of a.links ?? []) {
    const kind = l.kind === "type" ? "define" : l.kind;
    if (!l.to || l.from === l.to || !ids.has(l.from) || !ids.has(l.to) || !(kind === "define" || GENERAL.includes(kind))) continue;
    const key = `${kind}|${l.from}|${l.to}`;
    if (have.has(key)) continue;
    have.add(key);
    edges.push(edge(`${kind}:${l.from}:${l.to}`, l.from, l.to, kind, "", null));
  }
}
/**
 * 匯入（階段 3b，規範 8.2.3.5）：虛線開放箭頭、標 «import»，由匯入的一方指向被匯入的一方。
 * 匯入某個成員（或對象不在圖上）時，線接到對象所在、且在圖上的最近一層套件；同一對節點之間只畫一條。
 */
export function importEdges(a: Analysis, t: TreeIndex, ids: Set<string>, edges: GEdge[]): void {
  const seen = new Set<string>();
  const onGraph = (id: string): string | null => {
    if (ids.has(id)) return id;
    for (const up of ancestorsOf(t, id)) { const e = t.byId.get(up); if (e && isPackage(e) && ids.has(up)) return up; }
    return null;
  };
  for (const i of a.imports ?? []) {
    if (!i.to || !ids.has(i.from)) continue;
    const to = onGraph(i.to);
    if (!to || to === i.from || seen.has(`${i.from}|${to}`)) continue;
    seen.add(`${i.from}|${to}`);
    edges.push(edge(`import:${i.from}:${to}`, i.from, to, "import", "«import»", null));
  }
}
/**
 * 「加入零件」的建議名稱（使用者可以改）：英文大寫開頭改成小寫開頭（Apollo 11 的寫法，例如 engine : Engine）；
 * 其餘（中文等）在後面加編號。和型別同名、或和擁有者裡已有的名稱重複時，往後加編號。
 */
export function suggestPartName(typeName: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const lower = typeName.charAt(0).toLowerCase() + typeName.slice(1);
  const base = lower !== typeName ? lower : typeName;
  if (base !== typeName && !used.has(base)) return base;
  for (let i = 1; ; i++) if (!used.has(`${base}${i}`)) return `${base}${i}`;
}

const ownEdge = (owner: string, u: Element): GEdge => edge(`compose:${u.id}`, owner, u.id, isRef(u) ? "refpart" : "compose", "", u.unnamed ? null : { type: "element", id: u.id });

/**
 * 套件內容圖：套件的成員是節點（子套件畫成不展開的資料夾），成員底下各層列在隔間。
 * 定義擁有的零件，型別也在這張圖上時畫成節點，接上組成線與「由誰定義」。context 是 null 時畫最上層。
 */
function packageGraph(d: DiagramDef, a: Analysis): Graph {
  const s = structureOf(a);
  const members = s.t.children.get(d.context) ?? [];
  const shown = members.slice(0, NODE_LIMIT), rest = members.slice(NODE_LIMIT);
  const ids = new Set(shown.map((e) => e.id));
  // 先決定哪些零件要畫成節點，擁有者的隔間就不再列它
  const promoted = new Map<string, { u: Element; type: string }[]>();
  let count = shown.length;
  for (const m of shown) {
    if (!m.kind.endsWith("Definition")) continue;
    for (const u of s.t.children.get(m.id) ?? []) {
      if (u.kind !== "PartUsage" || count >= NODE_LIMIT) continue;
      const type = definitionsOf(s, u.id).find((x) => ids.has(x));
      if (!type) continue;
      promoted.set(m.id, [...(promoted.get(m.id) ?? []), { u, type }]);
      count++;
    }
  }
  const nodes: GNode[] = [], edges: GEdge[] = [];
  for (const m of shown) nodes.push(structureNode(s, m, new Set((promoted.get(m.id) ?? []).map((x) => x.u.id))));
  for (const [owner, list] of promoted) for (const { u, type } of list) {
    nodes.push(structureNode(s, u));
    edges.push(ownEdge(owner, u), edge(`define:${u.id}`, u.id, type, "define", "", null));
  }
  let folded = 0;
  if (rest.length) {
    const rows: string[] = [], covers: string[] = [];
    for (const m of rest) {
      rows.push(rowOf(s, m)); covers.push(m.id);
      for (const c of isPackage(m) ? [] : descendantsOf(s.t, m.id)) { rows.push(`${"· ".repeat(ancestorsOf(s.t, c.id).indexOf(m.id) + 1)}${rowOf(s, c)}`); covers.push(c.id); }
    }
    folded = rest.length;
    nodes.push(packageBox(`${d.id}#more`, null, `${d.title}（其餘 ${rest.length} 個成員）`, rows, covers));
  }
  const drawn = new Set(nodes.map((n) => n.id));
  linkEdges(a, drawn, edges);
  importEdges(a, s.t, drawn, edges);
  return { nodes, edges, direction: "TB", reverse: GENERAL, ...(folded ? { folded } : {}) };
}

/**
 * 分解圖：從一個零件定義出發，定義 ◆— 零件 —▷: 零件的定義，再往下展開。
 * 每個元素只畫一次，所以循環（例如零件的型別就是擁有它的定義）不會無限展開。
 */
function decompositionGraph(d: DiagramDef, a: Analysis): Graph {
  const s = structureOf(a);
  const root = d.context ? s.t.byId.get(d.context) : undefined;
  if (!root) return { nodes: [], edges: [], direction: "TB" };
  // 零件分解：零件；功能分解（F-79）：動作（含 perform、accept 等）
  const functional = d.kind === "fdecomp";
  const isChild = (u: Element) => (functional ? isAction(u) : u.kind === "PartUsage");
  const order: Element[] = [root], seen = new Set([root.id]), edges: GEdge[] = [];
  const extra = new Map<string, Element[]>(); // 超過上限、改列在擁有者隔間裡的零件
  let folded = 0;
  for (let i = 0; i < order.length; i++) {
    const o = order[i];
    for (const u of s.t.children.get(o.id) ?? []) {
      if (!isChild(u) || seen.has(u.id)) continue;
      if (order.length >= NODE_LIMIT) { extra.set(o.id, [...(extra.get(o.id) ?? []), u]); folded++; continue; }
      seen.add(u.id); order.push(u);
      edges.push(ownEdge(o.id, u));
      for (const type of definitionsOf(s, u.id)) {
        if (!seen.has(type)) {
          if (order.length >= NODE_LIMIT) continue;
          seen.add(type); order.push(s.t.byId.get(type) as Element);
        }
        edges.push(edge(`define:${u.id}:${type}`, u.id, type, "define", "", null));
      }
    }
  }
  const nodes = order.map((e): GNode => {
    const attrs = (s.t.children.get(e.id) ?? []).filter((c) => c.kind === "AttributeUsage" && !c.unnamed);
    const parts = extra.get(e.id) ?? [];
    const comps = [
      ...(e.kind.endsWith("Definition") ? [["attributes", ...attrs.slice(0, 6).map((c) => rowOf(s, c, "attribute")), ...(attrs.length > 6 ? ["..."] : [])]] : []),
      functional ? ["actions", ...parts.map((c) => rowOf(s, c, "action"))] : ["parts", ...parts.map((c) => rowOf(s, c, "part"))],
    ];
    return { ...makeNode(e, comps, titleOf(s, e)), covers: parts.map((c) => c.id), ...(isRef(e) ? { dashed: true } : {}) };
  });
  linkEdges(a, seen, edges);
  return { nodes, edges, direction: "TB", reverse: GENERAL, ...(folded ? { folded } : {}) };
}

// ───────── 需求、使用案例、狀態機、動作、互連、個體、計算與分析（階段 4，F-77 到 F-81）─────────
type RelEdge = (r: Analysis["relations"][number], i: number) => GEdge;
type Roles = (nodes: GNode[], rels: Analysis["relations"], prefer?: "stakeholder" | "actor") => GNode[];
/** 這幾類圖上的節點，每個隔間最多列幾列；其餘寫 ...（完整的內容在套件內容圖上）。 */
const ROWS = 6;
/**
 * 一般的節點：名稱、關鍵字照原始碼（«perform action»、«exhibit state»、«individual part»…）、需求的 doc，與各層內容的隔間。
 * extra：另外加的隔間（例如零件的定義上的連接埠），同名的隔間合併。
 */
function richNode(s: Structure, e: Element, extra: string[][] = []): GNode {
  const { compartments } = compartmentsOf(s, e);
  const merged: string[][] = compartments.map((c) => [...c]);
  for (const x of extra) {
    if (x.length < 2) continue;
    const same = merged.find((c) => c[0] === x[0]);
    if (same) same.push(...x.slice(1).filter((r) => !same.includes(r))); else merged.push([...x]);
  }
  merged.sort((p, q) => COMPARTMENT_ORDER.indexOf(p[0]) - COMPARTMENT_ORDER.indexOf(q[0]));
  const cap = (c: string[]) => (c.length > ROWS + 1 ? [...c.slice(0, ROWS + 1), "..."] : c);
  const doc = isRequirement(e) && e.doc ? [["doc", ...wrap(e.doc, 32, 4)]] : [];
  const n = makeNode(e, [...doc, ...merged.map(cap)], titleOf(s, e));
  return { ...n, keyword: e.keyword ? `«${e.keyword}»` : n.keyword, ...(isRef(e) ? { dashed: true } : {}) };
}
/** 貼在圖框邊上的參數與連接埠：小方塊在圖框的線上，名稱寫在圖框外側（規範 8.2.3.12、8.2.3.17）。 */
function paramNode(s: Structure, e: Element, side: "left" | "right"): GNode {
  const title = wrap(rowOf(s, e), 34, 1);
  return { id: e.id, el: e, shape: "param", keyword: e.keyword ? `«${e.keyword}»` : "", name: e.name, title, compartments: [], width: Math.min(260, 24 + [...title[0]].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 11 : 6.2), 0)), height: 22, boundary: side };
}
/** 參數的方向決定貼在哪一邊：in 在左，out、inout 在右。 */
const sideOf = (e: Element): "left" | "right" => (/^in\b(?!out)/.test(e.keyword ?? "") ? "left" : "right");
/** 把小方塊排在節點的左右兩邊：名稱下方留一段高度，左右各自由上往下排。 */
const PORT_ROW = 20;
export function withPorts(n: GNode, list: Omit<NodePort, "y">[]): GNode {
  if (!list.length) return n;
  const top = 26 + n.title.length * 16 + 4 + 12;
  const count = { left: 0, right: 0 };
  const ports = list.map((p) => ({ ...p, y: top + (count[p.side]++) * PORT_ROW }));
  const band = Math.max(count.left, count.right) * PORT_ROW + 8;
  return { ...n, ports, band, height: n.height + band };
}
/** 節點超過上限時，其餘的列在一個節點的隔間裡（和套件內容圖相同）。 */
function foldRest(s: Structure, d: DiagramDef, list: Element[]): { shown: Element[]; more: GNode | null; folded: number } {
  if (list.length <= NODE_LIMIT) return { shown: list, more: null, folded: 0 };
  const rest = list.slice(NODE_LIMIT);
  return { shown: list.slice(0, NODE_LIMIT), more: packageBox(`${d.id}#more`, null, `${d.title}（其餘 ${rest.length} 個）`, rest.map((e) => rowOf(s, e)), rest.map((e) => e.id)), folded: rest.length };
}
const uniq = (list: Element[]) => [...new Map(list.map((e) => [e.id, e])).values()];
const inPackage = (s: Structure, pkg: string, keep: (e: Element) => boolean) => descendantsOf(s.t, pkg).filter((e) => keep(e) && !e.shared && !e.unnamed && packageOf(s.t, e.id) === pkg);
/** 兩端都在圖上、擁有者也是節點的元素，畫組成線（需求群組裡的需求、分析裡的計算）。 */
function nestEdges(nodes: GNode[], edges: GEdge[]): void {
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) if (n.el?.parent && ids.has(n.el.parent) && !edges.some((e) => e.kind === "compose" && e.target === n.id)) edges.push(ownEdge(n.el.parent, n.el));
}

/**
 * 需求的圖（F-77，規範 8.2.3.20、8.2.3.3）：需求定義與需求、它們的 subject、require／assume constraint、屬性列在隔間；
 * 細化、滿足、衍生、追溯、驗證連到另一端；利害關係人標 «stakeholder»。context 是 null 時是整個模型（原本的「需求追溯」）。
 */
function requirementGraph(d: DiagramDef, a: Analysis, relEdge: RelEdge, roles: Roles): Graph {
  const s = structureOf(a);
  const base = d.context === null
    ? uniq([...listOf(a.elements, ...REQ_CATS), ...a.elements.filter((e) => e.kind === "RequirementUsage" && !e.shared && !e.unnamed)])
    : inPackage(s, d.context, isRequirement);
  const rels = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind));
  const ids = new Set(base.map((e) => e.id));
  for (const r of rels) if (ids.has(r.to) || ids.has(r.from)) { ids.add(r.from); ids.add(r.to); }
  const list = [...ids].map((id) => s.t.byId.get(id)).filter((e): e is Element => !!e);
  const { shown, more, folded } = foldRest(s, d, list);
  const on = new Set(shown.map((e) => e.id));
  const drawn = rels.filter((r) => on.has(r.from) && on.has(r.to));
  const nodes = roles(shown.map((e) => richNode(s, e)), drawn, "stakeholder");
  const edges = drawn.map((r, i) => relEdge(r, i));
  nestEdges(nodes, edges);
  linkEdges(a, on, edges);
  if (more) nodes.push(more);
  return { nodes, edges, direction: "BT", reverse: GENERAL, ...(folded ? { folded } : {}) };
}

/** 使用案例（F-77，規範 8.2.3.21）：使用案例與參與者（actor 參數），使用案例之間的包含。 */
function useCaseGraph(d: DiagramDef, a: Analysis, relEdge: RelEdge, roles: Roles): Graph {
  const s = structureOf(a);
  const base = d.context === null
    ? uniq([...listOf(a.elements, "UseCase"), ...listOf(a.elements, "Stakeholder"), ...a.elements.filter((e) => e.kind === "UseCaseUsage" && !e.shared && !e.unnamed)])
    : inPackage(s, d.context, isUseCase);
  const ids = new Set(base.map((e) => e.id));
  const all = a.relations.filter((r) => r.kind === "trace" || r.kind === "include");
  // 每個套件的圖：參與者與被包含的使用案例不在這個套件時也畫出來
  if (d.context !== null) for (const r of all) if (ids.has(r.from) && (r.form === "actor" || r.kind === "include")) ids.add(r.to);
  const list = [...ids].map((id) => s.t.byId.get(id)).filter((e): e is Element => !!e);
  const { shown, more, folded } = foldRest(s, d, list);
  const on = new Set(shown.map((e) => e.id));
  const rels = all.filter((r) => on.has(r.from) && on.has(r.to));
  const nodes = roles(shown.map((e) => richNode(s, e)), rels, "actor");
  if (more) nodes.push(more);
  return { nodes, edges: rels.map((r, i) => relEdge(r, i)), direction: "RL", ...(folded ? { folded } : {}) };
}

/** 轉換的標籤（規範 8.2.3.18）：觸發條件 [守衛] / 效果。 */
export function transitionLabel(t: { trigger: string; guard: string; effect: string } | undefined): string {
  if (!t) return "";
  return [t.trigger, t.guard ? `[${t.guard}]` : "", t.effect ? `/ ${t.effect}` : ""].filter(Boolean).join(" ");
}
/** 沒有寫起點的舊模型（JRI 的任務與模式）：沒有前一步的接起始節點，沒有下一步的接完成節點（和原本的圖相同）。 */
function legacyEnds(d: DiagramDef, children: Element[], edges: GEdge[], nodes: GNode[], relKind: string): void {
  if (children.length === 0 || edges.length === 0) return;
  const hasIn = new Set(edges.map((e) => e.target)), hasOut = new Set(edges.map((e) => e.source));
  nodes.unshift(pseudo(`${d.id}#initial`, "start"));
  nodes.push(pseudo(`${d.id}#final`, "done"));
  for (const c of children) {
    if (!hasIn.has(c.id) && hasOut.has(c.id)) edges.push(edge(`initial:${c.id}`, `${d.id}#initial`, c.id, relKind, "", null));
    if (!hasOut.has(c.id) && hasIn.has(c.id)) edges.push(edge(`final:${c.id}`, c.id, `${d.id}#final`, relKind, "", null));
  }
}

/**
 * 狀態機（F-78，規範 8.2.3.18）：狀態是圓角矩形，entry／do／exit 動作列在 actions 隔間；
 * 轉換是實線開放箭頭，標「觸發條件 [守衛] / 效果」；`entry; then X;` 畫成起始節點（實心圓）指向 X。
 */
function stateGraph(d: DiagramDef, a: Analysis, relEdge: RelEdge): Graph {
  const s = structureOf(a);
  const ctx = s.t.byId.get(d.context ?? "");
  if (!ctx) return { nodes: [], edges: [], direction: "LR" };
  const children = (s.t.children.get(ctx.id) ?? []).filter((c) => c.kind === "StateUsage" || c.kind === "ExhibitStateUsage");
  const ids = new Set(children.map((c) => c.id));
  const nodes = children.map((c) => richNode(s, c));
  const info = a.transitions ?? [];
  const edges = a.relations.filter((r) => r.kind === "transition" && ids.has(r.from) && ids.has(r.to)).map((r, i) => {
    const t = info.find((x) => x.from === r.from && x.to === r.to && x.line === r.line);
    return { ...relEdge(r, i), label: transitionLabel(t) };
  });
  const entries = (a.entries ?? []).filter((x) => x.owner === ctx.id && ids.has(x.to));
  if (entries.length) {
    nodes.unshift(pseudo(`${d.id}#initial`, "start"));
    for (const x of entries) edges.push(edge(`initial:${x.to}`, `${d.id}#initial`, x.to, "transition", "", null));
  } else if (ctx.category !== null) legacyEnds(d, children, edges, nodes, "transition");
  return { nodes, edges, direction: "LR" };
}

/**
 * 動作流程（F-79，規範 8.2.3.17）：子動作（含 perform、accept、send）是節點，參數列在 parameters 隔間；
 * 這個動作自己的參數畫成小方塊；先後（succession）是實線開放箭頭。
 */
function actionGraph(d: DiagramDef, a: Analysis, relEdge: RelEdge): Graph {
  const s = structureOf(a);
  const ctx = s.t.byId.get(d.context ?? "");
  if (!ctx) return { nodes: [], edges: [], direction: "LR" };
  const kids = s.t.children.get(ctx.id) ?? [];
  const children = kids.filter(isAction);
  const params = kids.filter((c) => /^(in|out|inout)\b/.test(c.keyword ?? ""));
  const ids = new Set(children.map((c) => c.id));
  // 子動作的參數是貼在它邊上的小方塊（in 在左、out 在右），不再列在隔間
  const pins = (c: Element) => (s.t.children.get(c.id) ?? []).filter((x) => /^(in|out|inout)\b/.test(x.keyword ?? "")).map((x) => ({ key: x.id, label: rowOf(s, x).replace(/^(in|out|inout) /, ""), side: sideOf(x) }));
  const actionNode = (c: Element) => { const n = richNode(s, c); return withPorts({ ...n, compartments: n.compartments.filter((x) => x[0] !== "parameters"), height: n.height - heightOf(n.compartments.filter((x) => x[0] === "parameters")) }, pins(c)); };
  const nodes = [...params.map((p) => paramNode(s, p, sideOf(p))), ...children.map(actionNode)];
  const edges = a.relations.filter((r) => r.kind === "succession" && ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i));
  if (ctx.category !== null) legacyEnds(d, children, edges, nodes, "succession");
  return { nodes, edges, direction: "LR" };
}

/**
 * 互連（F-80，規範 8.2.3.12 到 8.2.3.14）：零件是節點，它和它的定義上的連接埠列在 ports 隔間；
 * 這個定義自己的連接埠畫成小方塊；連結與介面是實線，標「名稱 : 型別」，接在端點所在的零件（或連接埠）上。
 */
function interconnectionGraph(d: DiagramDef, a: Analysis, relEdge: RelEdge): Graph {
  const s = structureOf(a);
  const ctx = s.t.byId.get(d.context ?? "");
  if (!ctx) return { nodes: [], edges: [], direction: "LR" };
  const kids = s.t.children.get(ctx.id) ?? [];
  const parts = kids.filter((c) => c.kind === "PartUsage");
  const own = kids.filter((c) => c.kind === "PortUsage");
  const partIds = new Set(parts.map((u) => u.id)), ownIds = new Set(own.map((p) => p.id));
  // 每個零件邊上的小方塊：它自己與它的定義上的連接埠，加上連結的端點在更深一層時（a.b.p）剩下的那一段
  const ports = new Map<string, Omit<NodePort, "y">[]>(parts.map((u) => [u.id, []]));
  // used：連結用到的端點。同一個連接埠既是起點又是終點時放右邊；沒有連結用到的只補上，不改已經決定的那一邊
  const addPort = (part: string, key: string, label: string, side: "left" | "right", used: boolean) => {
    const list = ports.get(part) as Omit<NodePort, "y">[];
    const had = list.find((p) => p.key === key);
    if (!had) list.push({ key, label, side });
    else if (used && side === "right") had.side = "right";
  };
  type End = { node: string; port?: string };
  const endOf = (chain: string[], path: string): End | null => {
    const i = chain.findIndex((x) => partIds.has(x) || ownIds.has(x));
    if (i < 0) return null;
    const node = chain[i], rest = chain.slice(i + 1);
    if (!rest.length || !partIds.has(node)) return { node };
    const segs = path.split(".");
    const label = segs.length === chain.length ? segs.slice(i + 1).join(".") : rest.map((x) => s.t.byId.get(x)?.name ?? x).join(".");
    return { node, port: rest.join(".") + "|" + label };
  };
  const conns = (a.connectors ?? []).map((c, i) => ({ c, i, from: endOf(c.fromChain, c.fromPath), to: endOf(c.toChain, c.toPath) }))
    .filter((x): x is { c: typeof x.c; i: number; from: End; to: End } => !!x.from && !!x.to && (x.from.node !== x.to.node || x.from.port !== x.to.port));
  // 先放連結用到的（起點在右、終點在左），再放其餘的連接埠（右邊）
  for (const { from, to } of conns) {
    if (from.port) addPort(from.node, from.port.split("|")[0], from.port.split("|")[1], "right", true);
    if (to.port) addPort(to.node, to.port.split("|")[0], to.port.split("|")[1], "left", true);
  }
  for (const u of parts) {
    const all = [...(s.t.children.get(u.id) ?? []), ...definitionsOf(s, u.id).flatMap((t) => s.t.children.get(t) ?? [])].filter((c) => c.kind === "PortUsage");
    for (const c of all) addPort(u.id, c.id, rowOf(s, c, "port"), "right", false);
  }
  const partNode = (u: Element) => {
    const n = richNode(s, u);
    const kept = n.compartments.filter((x) => x[0] !== "ports");
    return withPorts({ ...n, compartments: kept, height: n.height - heightOf(n.compartments.filter((x) => x[0] === "ports")) }, ports.get(u.id) ?? []);
  };
  const nodes = [...own.map((p) => paramNode(s, p, "left")), ...parts.map(partNode)];
  const edges: GEdge[] = [];
  if (a.connectors) {
    for (const { c, i, from, to } of conns) {
      const label = `${c.name}${c.type ? ` : ${c.type}` : ""}`.trim();
      // 直接連兩個零件的連結可以照原本的方式刪除；JRI 的介面（P4，型別特化 JRI::Interface）當元素刪除；其餘要改原始碼
      const direct = c.fromChain.length === 1 && c.toChain.length === 1;
      const named = c.kind === "interface" && c.id && s.t.byId.get(c.id)?.category === "Interface" ? { type: "element" as const, id: c.id } : null;
      edges.push({
        ...edge(`connect:${from.node}:${to.node}:${i}`, from.node, to.node, "connect", label, direct ? { type: "relation", kind: "connect", from: from.node, to: to.node } : named),
        ...(from.port ? { sourcePort: from.port.split("|")[0] } : {}), ...(to.port ? { targetPort: to.port.split("|")[0] } : {}),
      });
    }
  } else {
    const ids = new Set(nodes.map((n) => n.id));
    edges.push(...a.relations.filter((r) => r.kind === "connect" && ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i)));
  }
  return { nodes, edges, direction: "LR" };
}

/** 個體、時間切片與快照（F-81，規範 8.2.3.9）：時間切片與快照是節點（«timeslice»、«snapshot»），先後依 then。 */
function occurrenceGraph(d: DiagramDef, a: Analysis, relEdge: RelEdge): Graph {
  const s = structureOf(a);
  const children = (s.t.children.get(d.context ?? "") ?? []).filter(isPortion);
  const ids = new Set(children.map((c) => c.id));
  const nodes = children.map((c) => richNode(s, c));
  const edges = a.relations.filter((r) => r.kind === "succession" && ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i));
  return { nodes, edges, direction: "LR" };
}

/**
 * 計算與分析（F-81，規範 8.2.3.19、8.2.3.23）：計算或分析本身畫成一個節點，subject、參數、objective、限制完整列在隔間；
 * 它擁有的計算、分析與動作畫成節點並接組成線；在圖上的定義接「由誰定義」。
 */
function calculationGraph(d: DiagramDef, a: Analysis): Graph {
  const s = structureOf(a);
  const ctx = s.t.byId.get(d.context ?? "");
  if (!ctx) return { nodes: [], edges: [], direction: "TB" };
  const kids = (s.t.children.get(ctx.id) ?? []).filter((c) => CALC_KINDS.has(c.kind) || isAction(c));
  const skip = new Set(kids.map((c) => c.id));
  // 已經畫成節點的不再列在主體的隔間裡；主體的隔間不省略
  const { compartments } = compartmentsOf(s, ctx, skip);
  const doc = ctx.doc ? [["doc", ...wrap(ctx.doc, 32, 4)]] : [];
  const main = { ...makeNode(ctx, [...doc, ...compartments], titleOf(s, ctx)), keyword: ctx.keyword ? `«${ctx.keyword}»` : stereotype(ctx) };
  const nodes: GNode[] = [main, ...kids.map((c) => richNode(s, c))];
  const edges: GEdge[] = kids.map((c) => ownEdge(ctx.id, c));
  for (const e of [ctx, ...kids]) for (const t of definitionsOf(s, e.id)) {
    const te = s.t.byId.get(t);
    if (!te || te.shared) continue;
    if (!nodes.some((n) => n.id === t)) nodes.push(richNode(s, te));
    edges.push(edge(`define:${e.id}:${t}`, e.id, t, "define", "", null));
  }
  return { nodes, edges, direction: "TB", reverse: GENERAL };
}

/**
 * 新圖還沒有位置紀錄時，沿用舊「結構分解」圖（layout.json 的 bdd）裡識別碼相同的節點位置；其餘的由畫面自動安排。
 * 舊的 bdd 紀錄不刪，退回舊版時還用得到。
 */
export function seedLayout(layout: Layout, d: Pick<DiagramDef, "id" | "kind">, nodeIds: string[]): Layout[string] {
  const own = layout[d.id];
  if (own && Object.keys(own).length > 0) return own;
  // 階段 4：每個套件的需求圖、使用案例圖沿用原本整張「需求追溯」（req）、「使用案例」（uc）的位置
  const from = d.kind === "pkg" || d.kind === "decomp" ? "bdd" : (d.kind === "req" || d.kind === "uc") && d.id !== d.kind ? d.kind : null;
  if (!from) return own ?? {};
  const old = layout[from] ?? {};
  return Object.fromEntries(nodeIds.filter((id) => old[id]).map((id) => [id, { x: old[id].x, y: old[id].y }]));
}

/** 這張圖的工具列可以新增哪些類別。套件內容圖：新增時會放進這個套件的類別。 */
export function paletteOf(d: DiagramDef, a: Analysis, categories: { id: string; pkg: string }[]): string[] {
  if (d.kind !== "pkg") return PALETTE[d.kind];
  const name = a.elements.find((e) => e.id === d.context)?.name;
  return categories.filter((c) => c.pkg === name).map((c) => c.id);
}

export interface LinkTool { kind: string; zh: string; en: string; hint: string }
/** 所有連線種類。 */
export const ALL_LINKS: LinkTool[] = [
  { kind: "trace", zh: "追溯", en: "#trace／stakeholder／actor", hint: "從項目拉到它的來源。拉到利害關係人時，期望寫成 stakeholder、使用案例寫成 actor" },
  { kind: "include", zh: "包含", en: "include", hint: "從使用案例拉到它會用到的另一個使用案例" },
  { kind: "derive", zh: "衍生", en: "#derivation connection", hint: "從衍生出的需求拉到來源需求或目的" },
  { kind: "refine", zh: "細化", en: "#refinement dependency", hint: "從細化者（例如量度）拉到被細化的項目" },
  { kind: "satisfy", zh: "滿足", en: "satisfy", hint: "從負責的系統或元件拉到需求" },
  { kind: "allocate", zh: "分配", en: "allocate", hint: "從功能拉到負責執行的次系統" },
  { kind: "compose", zh: "組成", en: "part", hint: "從整體拉到部分（兩端都是系統、次系統或元件的定義）；會在整體裡建立一個零件" },
  { kind: "connect", zh: "連接", en: "connect", hint: "在同一個系統內的兩個零件之間拉線" },
  { kind: "succession", zh: "先後", en: "succession", hint: "從前一步拉到下一步（同一個任務內）" },
  { kind: "transition", zh: "轉換", en: "transition", hint: "從原狀態拉到新狀態（同一個模式內）" },
];
const link = (...kinds: string[]) => kinds.map((k) => ALL_LINKS.find((t) => t.kind === k)!);
/** 自訂圖第一層預設顯示的工具；使用者可以自行釘選。 */
export const CUSTOM_DEFAULT = { els: ["Stakeholder", "Expectation", "SystemRequirement", "Subsystem"], links: ["trace", "derive", "satisfy"] };
/** 每種圖可以用的連線工具（選了工具再從起點拉到終點）。 */
export const LINK_TOOLS: Record<DiagramKind, LinkTool[]> = {
  pkg: link("compose"), decomp: link("compose"), req: link("derive", "refine", "satisfy", "trace"),
  uc: [{ kind: "trace", zh: "參與者", en: "actor", hint: "從使用案例拉到參與的利害關係人" }, ...link("include")],
  act: link("succession"), stm: link("transition"), custom: ALL_LINKS, analysis: ALL_LINKS,
  // 階段 4 新增的圖只顯示模型，不提供連線工具
  fdecomp: [], occ: [], calc: [],
  // P4：互連圖可以編輯，介面工具從一個零件拉到另一個零件，自動找兩邊對得上的連接埠與介面定義
  ibd: [...link("connect"), { kind: "interface", zh: "介面", en: "interface", hint: "從一個零件拉到另一個零件（同一個系統內）；自動找兩邊對得上的連接埠與介面定義。先到「介面」頁建連接埠與介面定義" }],
};
export const PALETTE: Record<DiagramKind, string[]> = {
  pkg: [], // 依套件而定，見 paletteOf
  decomp: [],
  req: ["Need", "Goal", "Objective", "MOE", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "VerificationEvent"],
  act: ["MissionPhase", "Function"],
  ibd: [],
  uc: ["Stakeholder", "UseCase"],
  stm: ["Mode"],
  custom: [], analysis: [],
  fdecomp: [], occ: [], calc: [],
};
/** 工具列上每個類別畫成哪種圖形：結構類別是定義（方角），其餘是使用（圓角）。 */
export const CATEGORY_SHAPE: Record<string, Shape> = { System: "def", Subsystem: "def", Component: "def", ExternalEntity: "def" };

// ───────── 分析圖（METHOD.md 第 3 節，P2）─────────
/** 分析圖的識別碼前綴：版面紀錄與自訂圖資料都用 view:<登記的 id> */
export const ANALYSIS_PREFIX = "view:";
/** 分析圖的連線工具列預設顯示的種類 */
export const ANALYSIS_LINKS = ["trace", "derive", "refine", "satisfy", "allocate"];
/** 一張分析圖的中文標題：圖號加名稱 */
export const analysisTitle = (v: Pick<AnalysisView, "order" | "zh">) => `圖 ${v.order} ${v.zh}`;
/**
 * 登記在 method/views.ts 的分析圖，依圖號由上而下排；圖號相同時依登記的先後。每個專案（包括新專案）都有，空的也列出來。
 * members 存在 diagrams.json 的 views（P2）。和 diagramsOf 分開，審查報告與既有的圖清單不受影響。
 */
export function analysisDiagrams(extra?: Pick<Diagrams, "views">, views: AnalysisView[] = ANALYSIS_VIEWS): DiagramDef[] {
  return views.map((v, i) => ({ v, i })).sort((x, y) => x.v.order - y.v.order || x.i - y.i).map(({ v }) => ({
    id: `${ANALYSIS_PREFIX}${v.id}`, kind: "analysis" as const, code: VIEW.analysis[0], viewDef: VIEW.analysis[1], title: analysisTitle(v), context: null,
    members: extra?.views?.[`${ANALYSIS_PREFIX}${v.id}`] ?? [], view: v,
  }));
}
/** 這張分析圖的元素清單：釘選類別的元素（亮色）與其他所有元素（暗色）。SysML v2 的任何元素都列，標準庫的與套件本身除外。 */
export function analysisPalette(a: Pick<Analysis, "elements">, v: Pick<AnalysisView, "pinned">, members: Iterable<string> = []): { pinned: Element[]; other: Element[] } {
  const on = new Set(members);
  const pin = new Set(v.pinned);
  const list = a.elements.filter((e) => !e.shared && !isPackage(e) && e.kind !== "Comment" && !on.has(e.id));
  const items = new Set(modelItems(list).map((e) => e.id));
  // 釘選：釘選類別、而且是可以放進圖裡的那一層（結構類別取定義，其餘取使用）
  return { pinned: list.filter((e) => e.category !== null && pin.has(e.category) && items.has(e.id)), other: list.filter((e) => !(e.category !== null && pin.has(e.category) && items.has(e.id))) };
}

/** 零件照實際位置由上而下：有 station 或 position 屬性（自鼻錐尖端起算）就照它排，沒有就照模型裡的順序。 */
export function stationOrder(parts: Element[]): Element[] {
  const at = (e: Element) => { const v = parseFloat(e.attrs?.station ?? e.attrs?.position ?? ""); return Number.isFinite(v) ? v : null; };
  return parts.map((e, i) => ({ e, i, s: at(e) })).sort((x, y) => (x.s ?? Infinity) - (y.s ?? Infinity) || (x.e.line ?? 0) - (y.e.line ?? 0) || x.i - y.i).map((x) => x.e);
}
/** 外框的上方留給名稱，零件之間不留空隙，疊起來像一枚火箭的箭體。 */
export const CONTAINER_PAD = 24;
function containerNode(e: Element, parts: GNode[]): { node: GNode; parts: GNode[] } {
  const base = makeNode(e);
  const head = 26 + base.title.length * 16 + 8;
  const w = Math.max(base.width, ...parts.map((p) => p.width)) + CONTAINER_PAD * 2;
  const h = head + parts.reduce((s, p) => s + p.height, 0) + CONTAINER_PAD;
  return { node: { ...base, compartments: [], width: w, height: h, container: true }, parts: parts.map((p) => ({ ...p, inside: e.id })) };
}
/** 外框上方名稱區的高度 */
export const containerHead = (n: GNode) => 26 + n.title.length * 16 + 8;

type Spot = { x: number; y: number; w?: number; h?: number };
/**
 * 系統簡圖的預設排法：外框由左而右並排，外框裡的零件由上而下緊貼著疊起來、置中。
 * 只替還沒有位置的節點找位置；已經排過的（使用者拖過的）一律不動。其餘的節點交給一般的排法。
 */
export function rocketLayout(g: Pick<Graph, "nodes">, known: Record<string, Spot>): Record<string, Spot> {
  const out: Record<string, Spot> = {};
  const boxes = g.nodes.filter((n) => n.container);
  let x = Math.min(24, ...Object.values(known).map((p) => p.x));
  const right = Math.max(-Infinity, ...g.nodes.filter((n) => known[n.id]).map((n) => known[n.id].x + (known[n.id].w ?? n.width)));
  if (Number.isFinite(right)) x = right + 72;
  for (const b of boxes) {
    const kids = g.nodes.filter((n) => n.inside === b.id);
    let at = known[b.id];
    if (!at) { at = { x, y: 24, w: b.width, h: b.height }; out[b.id] = at; x += b.width + 72; }
    const w = at.w ?? b.width;
    let y = Math.max(at.y + containerHead(b), ...kids.filter((k) => known[k.id]).map((k) => known[k.id].y + k.height));
    for (const k of kids) {
      if (known[k.id]) continue;
      out[k.id] = { x: Math.round(at.x + (w - k.width) / 2), y: Math.round(y) };
      y += k.height;
    }
    // 零件超出外框時把外框拉長（只改這一次新排的外框）
    if (out[b.id]) out[b.id] = { ...out[b.id], h: Math.max(b.height, y - at.y + CONTAINER_PAD) };
  }
  return out;
}

/** 手動連線的轉折點存在版面紀錄裡（layout.json 這張圖的底下），鍵是 bend|<連線>|<序號>。 */
export const BEND = "bend|";
export const bendKey = (edgeKey: string, i: number) => `${BEND}${edgeKey}|${i}`;
export function bendsOf(nodes: Record<string, Spot> | undefined, edgeKey: string): { x: number; y: number }[] {
  const pre = `${BEND}${edgeKey}|`;
  return Object.entries(nodes ?? {}).filter(([k]) => k.startsWith(pre)).map(([k, p]) => ({ i: Number(k.slice(pre.length)), x: p.x, y: p.y }))
    .filter((p) => Number.isInteger(p.i)).sort((a, b) => a.i - b.i).map(({ x, y }) => ({ x, y }));
}
/** 換掉某條連線的轉折點（list 是空的就是拉直），其餘的位置不動。 */
export function withBends(nodes: Record<string, Spot> | undefined, edgeKey: string, list: { x: number; y: number }[]): Record<string, Spot> {
  const pre = `${BEND}${edgeKey}|`;
  const next = Object.fromEntries(Object.entries(nodes ?? {}).filter(([k]) => !k.startsWith(pre)));
  list.forEach((p, i) => { next[bendKey(edgeKey, i)] = { x: Math.round(p.x), y: Math.round(p.y) }; });
  return next;
}
/** 在折線上離 p 最近的那一段插入新的轉折點，回傳插入的位置。pts 含兩端點。 */
export function insertAt(pts: { x: number; y: number }[], p: { x: number; y: number }): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    const d = (a.x + t * dx - p.x) ** 2 + (a.y + t * dy - p.y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best; // 插在 bends 的第 best 個之前（pts 的第 best 段）
}
