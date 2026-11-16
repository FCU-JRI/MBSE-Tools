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

export type DiagramKind = "pkg" | "decomp" | "req" | "act" | "ibd" | "uc" | "stm" | "custom";
/**
 * code／viewDef：SysML v2 標準檢視定義的短名稱與名稱（StandardViewDefinitions）。
 * members 只有自訂圖使用：這張圖放了哪些模型項目。
 */
export interface DiagramDef { id: string; kind: DiagramKind; code: string; viewDef: string; title: string; context: string | null; members?: string[] }
const VIEW: Record<DiagramKind, [code: string, viewDef: string]> = {
  pkg: ["GV", "GeneralView"], decomp: ["GV", "GeneralView"], req: ["GV", "GeneralView"], uc: ["GV", "GeneralView"], custom: ["GV", "GeneralView"],
  ibd: ["IV", "InterconnectionView"], act: ["AFV", "ActionFlowView"], stm: ["STV", "StateTransitionView"],
};
/** 圖框標籤：«view» 名稱 : 檢視定義。 */
export const frameLabel = (d: DiagramDef) => `«view» ${d.title} : ${d.viewDef}`;

/** pkgbox：不畫成員的套件，名稱寫在資料夾本體中央（一般的節點，不是可以把項目拖進去的框）。 */
export type Shape = "def" | "usage" | "package" | "pkgbox" | "comment" | "start" | "done";
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
}
export interface GEdge {
  id: string; source: string; target: string; kind: string; label: string;
  dashed: boolean;
  // 終點記號：開放箭頭、空心三角形加兩點（defined by）、空心三角形（特化、子集）、三角形加豎線（重定義）、三角形加四點（參照子集）
  head: "open" | "typing" | "triangle" | "redefine" | "refsubset" | "none";
  tail: "diamond" | "hollow" | "none"; // 起點記號：實心菱形（組成）、空心菱形（非組成）
  /** 刪除這條線時要做的事：刪關係，或刪掉代表它的元素。 */
  remove: { type: "relation"; kind: string; from: string; to: string } | { type: "element"; id: string } | null;
}
/** reverse：排版時要反向看待的連線種類（例如追溯是由下層指向上層，上層應排在上方）。 */
export interface Graph { nodes: GNode[]; edges: GEdge[]; direction: "TB" | "BT" | "LR" | "RL"; reverse?: string[];
  /** 節點超過上限時，有幾個元素改列在隔間裡 */
  folded?: number }

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

export function diagramsOf(a: Analysis, extra?: Diagrams): DiagramDef[] {
  const def = (id: string, kind: DiagramKind, title: string, context: string | null, members?: string[]): DiagramDef => ({ id, kind, code: VIEW[kind][0], viewDef: VIEW[kind][1], title, context, members });
  // 套件內容圖：最上層一張，每個套件一張；分解圖：每個擁有零件的零件定義一張（F-76）
  const t = treeOf(a);
  const out: DiagramDef[] = [def(TOP_DIAGRAM, "pkg", "模型", null)];
  for (const e of t.all) if (isPackage(e)) out.push(def(`pkg:${e.qualifiedName}`, "pkg", e.name, e.id));
  for (const e of t.all) if (e.kind === "PartDefinition" && !e.unnamed && (t.children.get(e.id) ?? []).some((c) => c.kind === "PartUsage")) out.push(def(`decomp:${e.qualifiedName}`, "decomp", e.name, e.id));
  out.push(def("req", "req", "需求追溯", null), def("uc", "uc", "使用案例", null));
  const byKind = (id: string | null) => a.elements.find((e) => e.id === id)?.kind;
  const kids = (id: string, kind: string) => a.elements.some((e) => e.owner === id && e.kind === kind);
  for (const e of a.elements) {
    if (e.kind === "PartDefinition" && kids(e.id, "PartUsage")) out.push(def(`ibd:${e.qualifiedName}`, "ibd", e.name, e.id));
    if (e.kind === "StateUsage" && (kids(e.id, "StateUsage") || e.category === "Mode") && byKind(e.owner) !== "StateUsage") out.push(def(`stm:${e.qualifiedName}`, "stm", e.name, e.id));
    if (e.kind === "ActionUsage" && kids(e.id, "ActionUsage")) out.push(def(`act:${e.qualifiedName}`, "act", e.name, e.id));
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
  const structural = d.kind === "pkg" || d.kind === "decomp";
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
    const e = edge(`${r.kind}:${r.from}:${r.to}:${i}`, r.from, r.to, r.kind, EDGE_LABEL[r.kind] ?? "", { type: "relation", kind: r.kind, from: r.from, to: r.to });
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

  if (d.kind === "pkg") return packageGraph(d, a);
  if (d.kind === "decomp") return decompositionGraph(d, a);

  if (d.kind === "req") {
    const rels = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind));
    const ids = new Set(listOf(a.elements, ...REQ_CATS).map((e) => e.id));
    for (const r of rels) if (ids.has(r.to) || ids.has(r.from)) { ids.add(r.from); ids.add(r.to); }
    const shown = rels.filter((r) => ids.has(r.from) && ids.has(r.to));
    const nodes = roles([...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => node(e, a)), shown, "stakeholder");
    return { nodes, edges: shown.map((r, i) => relEdge(r, i)), direction: "BT" };
  }

  if (d.kind === "uc") {
    // 使用案例與利害關係人。參與者是使用案例的 actor 參數（舊模型可能還是 «#trace» 相依）；使用案例之間可以互相包含
    const ids = new Set([...listOf(a.elements, "UseCase"), ...listOf(a.elements, "Stakeholder")].map((e) => e.id));
    const rels = a.relations.filter((r) => (r.kind === "trace" || r.kind === "include") && ids.has(r.from) && ids.has(r.to));
    const nodes = roles([...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => node(e, a)), rels, "actor");
    return { nodes, edges: rels.map((r, i) => relEdge(r, i)), direction: "RL" };
  }

  const childKind = d.kind === "ibd" ? "PartUsage" : d.kind === "stm" ? "StateUsage" : "ActionUsage";
  const relKind = d.kind === "ibd" ? "connect" : d.kind === "stm" ? "transition" : "succession";
  const children = a.elements.filter((e) => e.owner === d.context && e.kind === childKind);
  const ids = new Set(children.map((e) => e.id));
  const edges = a.relations.filter((r) => r.kind === relKind && ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i));
  const nodes = children.map((e) => node(e, a));
  if (d.kind === "ibd") return { nodes, edges, direction: "LR" };

  // 動作流與狀態轉換：沒有前一步的節點接起始節點；沒有下一步的接完成節點（只在已有流程時）
  if (children.length > 0 && edges.length > 0) {
    const hasIn = new Set(edges.map((e) => e.target)), hasOut = new Set(edges.map((e) => e.source));
    nodes.unshift(pseudo(`${d.id}#initial`, "start"));
    nodes.push(pseudo(`${d.id}#final`, "done"));
    for (const c of children) {
      if (!hasIn.has(c.id) && hasOut.has(c.id)) edges.push(edge(`initial:${c.id}`, `${d.id}#initial`, c.id, relKind, "", null));
      if (!hasOut.has(c.id) && hasIn.has(c.id)) edges.push(edge(`final:${c.id}`, c.id, `${d.id}#final`, relKind, "", null));
    }
  }
  return { nodes, edges, direction: "LR" };
}

// ───────── 套件內容圖與分解圖（F-76）─────────
const isRef = (e: Element) => e.kind === "ReferenceUsage" || /(^|\s)ref(\s|$)/.test(e.keyword ?? "");
/** 隔間的標題（規範 8.2.3.6）：屬性、零件、項目各有自己的隔間，其餘的使用放 features，不是使用的放 members。 */
const COMPARTMENT: Record<string, [title: string, keyword: string]> = { AttributeUsage: ["attributes", "attribute"], PartUsage: ["parts", "part"], ItemUsage: ["items", "item"] };
const COMPARTMENT_ORDER = ["attributes", "parts", "items", "features", "members"];

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
    const [title, implied] = COMPARTMENT[c.kind] ?? [c.kind.endsWith("Usage") ? "features" : "members", ""];
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
  const order: Element[] = [root], seen = new Set([root.id]), edges: GEdge[] = [];
  const extra = new Map<string, Element[]>(); // 超過上限、改列在擁有者隔間裡的零件
  let folded = 0;
  for (let i = 0; i < order.length; i++) {
    const o = order[i];
    for (const u of s.t.children.get(o.id) ?? []) {
      if (u.kind !== "PartUsage" || seen.has(u.id)) continue;
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
      ["parts", ...parts.map((c) => rowOf(s, c, "part"))],
    ];
    return { ...makeNode(e, comps, titleOf(s, e)), covers: parts.map((c) => c.id), ...(isRef(e) ? { dashed: true } : {}) };
  });
  linkEdges(a, seen, edges);
  return { nodes, edges, direction: "TB", reverse: GENERAL, ...(folded ? { folded } : {}) };
}

/**
 * 新圖還沒有位置紀錄時，沿用舊「結構分解」圖（layout.json 的 bdd）裡識別碼相同的節點位置；其餘的由畫面自動安排。
 * 舊的 bdd 紀錄不刪，退回舊版時還用得到。
 */
export function seedLayout(layout: Layout, d: Pick<DiagramDef, "id" | "kind">, nodeIds: string[]): Layout[string] {
  const own = layout[d.id];
  if (own && Object.keys(own).length > 0) return own;
  if (d.kind !== "pkg" && d.kind !== "decomp") return own ?? {};
  const old = layout.bdd ?? {};
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
  pkg: link("compose"), decomp: link("compose"), ibd: link("connect"), req: link("derive", "refine", "satisfy", "trace"),
  uc: [{ kind: "trace", zh: "參與者", en: "actor", hint: "從使用案例拉到參與的利害關係人" }, ...link("include")],
  act: link("succession"), stm: link("transition"), custom: ALL_LINKS,
};
export const PALETTE: Record<DiagramKind, string[]> = {
  pkg: [], // 依套件而定，見 paletteOf
  decomp: [],
  req: ["Need", "Goal", "Objective", "MOE", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "VerificationEvent"],
  act: ["MissionPhase", "Function"],
  ibd: [],
  uc: ["Stakeholder", "UseCase"],
  stm: ["Mode"],
  custom: [],
};
/** 工具列上每個類別畫成哪種圖形：結構類別是定義（方角），其餘是使用（圓角）。 */
export const CATEGORY_SHAPE: Record<string, Shape> = { System: "def", Subsystem: "def", Component: "def", ExternalEntity: "def" };
