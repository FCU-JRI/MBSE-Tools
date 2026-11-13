// 由模型資料推導出樹、表與圖。圖不另存，永遠從模型產生。
// 圖的記法依 OMG SysML v2（8.2.3 Graphical Notation）：
//   定義（part def 等）為方角矩形、使用（part、requirement、action、state、use case…）為圓角矩形，
//   名稱隔間第一行是 «關鍵字»，第二行是「<編號> 名稱 : 型別」；套件為帶標籤頁的資料夾；註解為折角便箋。
//   相依（dependency）為虛線開放箭頭；satisfy、verify、allocate 為實線開放箭頭加 «關鍵字»；
//   組成（composite feature membership）在擁有者一端畫實心菱形、另一端是零件（使用）；
//   「零件由哪個定義所定義」為實線、定義端空心三角形加兩點；起始為實心圓、完成為牛眼。
import type { Analysis, Diagrams, Element } from "./api.ts";

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

export type DiagramKind = "bdd" | "req" | "act" | "ibd" | "uc" | "stm" | "custom";
/**
 * code／viewDef：SysML v2 標準檢視定義的短名稱與名稱（StandardViewDefinitions）。
 * members 只有自訂圖使用：這張圖放了哪些模型項目。
 */
export interface DiagramDef { id: string; kind: DiagramKind; code: string; viewDef: string; title: string; context: string | null; members?: string[] }
const VIEW: Record<DiagramKind, [code: string, viewDef: string]> = {
  bdd: ["GV", "GeneralView"], req: ["GV", "GeneralView"], uc: ["GV", "GeneralView"], custom: ["GV", "GeneralView"],
  ibd: ["IV", "InterconnectionView"], act: ["AFV", "ActionFlowView"], stm: ["STV", "StateTransitionView"],
};
/** 圖框標籤：«view» 名稱 : 檢視定義。 */
export const frameLabel = (d: DiagramDef) => `«view» ${d.title} : ${d.viewDef}`;

export type Shape = "def" | "usage" | "package" | "comment" | "start" | "done";
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
}
export interface GEdge {
  id: string; source: string; target: string; kind: string; label: string;
  dashed: boolean;
  head: "open" | "typing" | "none"; // 終點記號：開放箭頭、空心三角形加兩點（defined by）
  tail: "diamond" | "none"; // 起點記號
  /** 刪除這條線時要做的事：刪關係，或刪掉代表它的元素。 */
  remove: { type: "relation"; kind: string; from: string; to: string } | { type: "element"; id: string } | null;
}
/** reverse：排版時要反向看待的連線種類（例如追溯是由下層指向上層，上層應排在上方）。 */
export interface Graph { nodes: GNode[]; edges: GEdge[]; direction: "TB" | "BT" | "LR" | "RL"; reverse?: string[] }

/** SysML v2 的關鍵字：由元類別名稱得出，例如 PartDefinition → «part def»、UseCaseUsage → «use case»。 */
const KEYWORD: Record<string, string> = { VerificationCaseUsage: "verification", VerificationCaseDefinition: "verification def", Comment: "comment" };
export const stereotype = (e: Element) => {
  if (e.kind === "Package") return "package";
  const k = KEYWORD[e.kind] ?? e.kind.replace(/(Usage|Definition)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() + (e.kind.endsWith("Definition") ? " def" : "");
  return `«${k}»`;
};
const EDGE_LABEL: Record<string, string> = { derive: "«derive»", refine: "«refine»", trace: "«trace»", satisfy: "«satisfy»", verify: "«verify»", allocate: "«allocate»" };

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
  const sn = el.shortName ? `<${el.shortName}> ` : "";
  const t = el.types[0];
  return `${sn}${el.name}${t ? (el.kind.endsWith("Definition") ? ` :> ${t}` : ` : ${t}`) : ""}`;
}

function makeNode(el: Element, compartments: string[][] = []): GNode {
  const comps = compartments.filter((c) => c.length > 1);
  const title = wrap(nameOf(el), Math.floor((NODE_W - 20) / 6.6), 3);
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
  dashed: ["derive", "refine", "trace", "annotate"].includes(kind),
  head: kind === "define" ? "typing" : ["compose", "connect", "annotate"].includes(kind) ? "none" : "open",
  tail: kind === "compose" ? "diamond" : "none",
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

export function diagramsOf(a: Analysis, extra?: Diagrams): DiagramDef[] {
  const def = (id: string, kind: DiagramKind, title: string, context: string | null, members?: string[]): DiagramDef => ({ id, kind, code: VIEW[kind][0], viewDef: VIEW[kind][1], title, context, members });
  const out: DiagramDef[] = [def("bdd", "bdd", "結構分解", null), def("req", "req", "需求追溯", null), def("uc", "uc", "使用案例", null)];
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
  // 套件：有成員在這張圖上，或剛在這張圖上建立
  for (const p of a.elements) {
    if (!isUserPackage(p, opts.packages)) continue;
    const members = g.nodes.filter((n) => n.el?.owner === p.id);
    if (members.length === 0 && !opts.shown.has(p.id)) continue;
    for (const m of members) m.parent = p.id;
    g.nodes.unshift(pkgNode(p));
  }
  // 註解：說明的對象在這張圖上，或剛在這張圖上建立
  for (const c of a.elements) {
    if (c.kind !== "Comment" || c.shared) continue;
    const about = (c.about ?? []).filter((x) => ids.has(x));
    if (about.length === 0 && !opts.shown.has(c.id)) continue;
    g.nodes.push(commentNode(c));
    about.forEach((x) => g.edges.push(edge(`annotate:${c.id}:${x}`, c.id, x, "annotate", "", null)));
  }
  return g;
}

function baseGraph(d: DiagramDef, a: Analysis): Graph {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const relEdge = (r: Analysis["relations"][number], i: number): GEdge =>
    edge(`${r.kind}:${r.from}:${r.to}:${i}`, r.from, r.to, r.kind, EDGE_LABEL[r.kind] ?? "", { type: "relation", kind: r.kind, from: r.from, to: r.to });
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
    const nodes = [...ids].map((id) => node(byId.get(id)!, a));
    const edges = a.relations.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i));
    composition(ids, nodes, edges);
    return { nodes, edges, direction: "TB", reverse: ["derive", "refine", "trace", "satisfy", "verify"] };
  }

  if (d.kind === "bdd") {
    const defs = a.elements.filter((e) => e.kind === "PartDefinition");
    const nodes = defs.map((e) => node(e, a));
    const edges: GEdge[] = [];
    composition(new Set(defs.map((e) => e.id)), nodes, edges);
    return { nodes, edges, direction: "TB" };
  }

  if (d.kind === "req") {
    const rels = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind));
    const ids = new Set(listOf(a.elements, ...REQ_CATS).map((e) => e.id));
    for (const r of rels) if (ids.has(r.to) || ids.has(r.from)) { ids.add(r.from); ids.add(r.to); }
    const nodes = [...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => node(e, a));
    return { nodes, edges: rels.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i)), direction: "BT" };
  }

  if (d.kind === "uc") {
    // 使用案例與利害關係人；兩者之間目前以 «trace» 相依表示
    const ids = new Set([...listOf(a.elements, "UseCase"), ...listOf(a.elements, "Stakeholder")].map((e) => e.id));
    const rels = a.relations.filter((r) => r.kind === "trace" && ids.has(r.from) && ids.has(r.to));
    const nodes = [...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => node(e, a));
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

export interface LinkTool { kind: string; zh: string; en: string; hint: string }
/** 所有連線種類。 */
export const ALL_LINKS: LinkTool[] = [
  { kind: "trace", zh: "追溯", en: "#trace dependency", hint: "從項目拉到它的來源（例如期望拉到利害關係人）" },
  { kind: "derive", zh: "衍生", en: "#derive dependency", hint: "從衍生出的需求拉到來源需求或目的" },
  { kind: "refine", zh: "細化", en: "#refine dependency", hint: "從細化者（例如量度）拉到被細化的項目" },
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
  bdd: link("compose"), ibd: link("connect"), req: link("derive", "refine", "satisfy", "trace"),
  uc: [{ kind: "trace", zh: "追溯", en: "#trace dependency", hint: "從使用案例拉到參與的利害關係人" }],
  act: link("succession"), stm: link("transition"), custom: ALL_LINKS,
};
export const PALETTE: Record<DiagramKind, string[]> = {
  bdd: ["System", "Subsystem", "Component", "ExternalEntity"],
  req: ["Need", "Goal", "Objective", "MOE", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "VerificationEvent"],
  act: ["MissionPhase", "Function"],
  ibd: [],
  uc: ["Stakeholder", "UseCase"],
  stm: ["Mode"],
  custom: [],
};
/** 工具列上每個類別畫成哪種圖形：結構類別是定義（方角），其餘是使用（圓角）。 */
export const CATEGORY_SHAPE: Record<string, Shape> = { System: "def", Subsystem: "def", Component: "def", ExternalEntity: "def" };
