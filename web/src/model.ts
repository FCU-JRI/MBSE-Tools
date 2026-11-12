// 由模型資料推導出樹、表與圖。圖不另存，永遠從模型產生。
// 圖的記法依 OMG SysML 1.7（NASA-HDBK-1009A 所用版本）：
//   block／part 為矩形、actor 為火柴人、use case 為橢圓、action 與 state 為圓角矩形、
//   起始節點為實心圓、結束節點為牛眼；組成為實心菱形、相依為虛線開放箭頭並標 «deriveReqt» 等關鍵字。
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
/** members 只有自訂圖使用：這張圖放了哪些模型項目。 */
export interface DiagramDef { id: string; kind: DiagramKind; code: string; title: string; context: string | null; members?: string[] }

export type Shape = "block" | "part" | "requirement" | "testcase" | "actor" | "usecase" | "action" | "state" | "initial" | "final";
export interface GNode {
  id: string;
  el: Element | null; // 起始與結束節點沒有對應的模型元素
  shape: Shape;
  keyword: string; // «block»、«requirement»…；沒有就是空字串
  name: string;
  compartments: string[][];
  width: number;
  height: number;
}
export interface GEdge {
  id: string; source: string; target: string; kind: string; label: string;
  dashed: boolean;
  head: "open" | "none"; // 終點箭頭
  tail: "diamond" | "none"; // 起點記號
  /** 刪除這條線時要做的事：刪關係，或刪掉代表它的元素（結構分解的零件）。 */
  remove: { type: "relation"; kind: string; from: string; to: string } | { type: "element"; id: string } | null;
}
/** reverse：排版時要反向看待的連線種類（例如追溯是由下層指向上層，上層應排在上方）。 */
export interface Graph { nodes: GNode[]; edges: GEdge[]; direction: "TB" | "BT" | "LR" | "RL"; reverse?: string[] }

/** SysML 1.7 的關鍵字。 */
const KEYWORD: Record<string, string> = {
  PartDefinition: "«block»", RequirementUsage: "«requirement»", RequirementDefinition: "«requirement»",
  VerificationCaseUsage: "«testCase»", ItemUsage: "", PartUsage: "", ActionUsage: "", StateUsage: "", UseCaseUsage: "",
};
const EDGE_LABEL: Record<string, string> = { derive: "«deriveReqt»", refine: "«refine»", trace: "«trace»", satisfy: "«satisfy»", verify: "«verify»", allocate: "«allocate»" };
export const stereotype = (e: Element) => KEYWORD[e.kind] || `«${e.kind.replace(/(Usage|Definition)$/, "").toLowerCase()}»`;

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

function makeNode(el: Element, shape: Shape, compartments: string[][] = [], name = el.name): GNode {
  const comps = compartments.filter((c) => c.length > 0);
  const rows = comps.reduce((s, c) => s + c.length, 0);
  let width = 200, height = 56;
  if (shape === "actor") { width = 110; height = 104; }
  else if (shape === "usecase") { width = 190; height = 72; }
  else if (shape === "action" || shape === "state") { width = 170; height = 52 + (rows ? rows * 16 + 10 : 0); }
  else if (shape === "part") { width = 190; height = 52; }
  else { width = shape === "requirement" || shape === "testcase" ? 230 : 200; height = 50 + rows * 16 + comps.length * 9; }
  return { id: el.id, el, shape, keyword: shape === "actor" || shape === "usecase" || shape === "action" || shape === "state" || shape === "part" ? "" : KEYWORD[el.kind] ?? "", name, compartments: comps, width, height };
}
const pseudo = (id: string, shape: "initial" | "final"): GNode => ({ id, el: null, shape, keyword: "", name: "", compartments: [], width: 26, height: 26 });

const edge = (id: string, source: string, target: string, kind: string, text: string, remove: GEdge["remove"]): GEdge => ({
  id, source, target, kind, label: text, remove,
  dashed: ["derive", "refine", "trace", "satisfy", "verify", "allocate"].includes(kind),
  head: kind === "compose" || kind === "connect" || kind === "association" ? "none" : "open",
  tail: kind === "compose" ? "diamond" : "none",
});

const REQ_CATS = ["Expectation", "Need", "Goal", "Objective", "MOE", "MOP", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement"];

/** 需求圖上的節點：需求為 «requirement»，其餘依元素種類。 */
function reqNode(e: Element): GNode {
  if (e.category === "Stakeholder") return makeNode(e, "actor");
  if (e.kind === "RequirementUsage" || e.kind === "RequirementDefinition") return makeNode(e, "requirement", [[`id = "${e.shortName ?? ""}"`, ...wrap(`text = "${e.doc}"`, 30, 4)]]);
  if (e.kind === "VerificationCaseUsage") return makeNode(e, "testcase", e.shortName ? [[`id = "${e.shortName}"`]] : []);
  if (e.kind === "PartDefinition") return makeNode(e, "block");
  if (e.kind === "UseCaseUsage") return makeNode(e, "usecase");
  if (e.kind === "ActionUsage") return makeNode(e, "action");
  if (e.kind === "StateUsage") return makeNode(e, "state");
  return makeNode(e, "part", [], e.types[0] ? `${e.name} : ${e.types[0]}` : e.name);
}

export function diagramsOf(a: Analysis, extra?: Diagrams): DiagramDef[] {
  const out: DiagramDef[] = [
    { id: "bdd", kind: "bdd", code: "BDD", title: "結構分解", context: null },
    { id: "req", kind: "req", code: "REQ", title: "需求追溯", context: null },
    { id: "uc", kind: "uc", code: "UC", title: "使用案例", context: null },
  ];
  const byKind = (id: string | null) => a.elements.find((e) => e.id === id)?.kind;
  const kids = (id: string, kind: string) => a.elements.some((e) => e.owner === id && e.kind === kind);
  for (const e of a.elements) {
    if (e.kind === "PartDefinition" && kids(e.id, "PartUsage")) out.push({ id: `ibd:${e.qualifiedName}`, kind: "ibd", code: "IBD", title: e.name, context: e.id });
    if (e.kind === "StateUsage" && (kids(e.id, "StateUsage") || e.category === "Mode") && byKind(e.owner) !== "StateUsage") out.push({ id: `stm:${e.qualifiedName}`, kind: "stm", code: "STM", title: e.name, context: e.id });
    if (e.kind === "ActionUsage" && kids(e.id, "ActionUsage")) out.push({ id: `act:${e.qualifiedName}`, kind: "act", code: "ACT", title: e.name, context: e.id });
  }
  for (const c of extra?.custom ?? []) out.push({ id: c.id, kind: "custom", code: "自訂", title: c.title, context: null, members: c.members });
  return out;
}

export function buildGraph(d: DiagramDef, a: Analysis): Graph {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const relEdge = (r: Analysis["relations"][number], i: number, kind = r.kind): GEdge =>
    edge(`${r.kind}:${r.from}:${r.to}:${i}`, r.from, r.to, kind, EDGE_LABEL[kind] ?? "", { type: "relation", kind: r.kind, from: r.from, to: r.to });

  if (d.kind === "custom") {
    // 自訂圖：使用者挑選的任何模型項目，以及它們之間已存在的所有關係
    const ids = new Set((d.members ?? []).filter((id) => byId.has(id)));
    const nodes = [...ids].map((id) => reqNode(byId.get(id)!));
    const isUc = (id: string) => byId.get(id)?.kind === "UseCaseUsage";
    const isStk = (id: string) => byId.get(id)?.category === "Stakeholder";
    const edges = a.relations.filter((r) => ids.has(r.from) && ids.has(r.to))
      .map((r, i) => relEdge(r, i, r.kind === "trace" && ((isUc(r.from) && isStk(r.to)) || (isStk(r.from) && isUc(r.to))) ? "association" : r.kind));
    for (const u of a.elements) {
      if (u.kind !== "PartUsage" || !u.owner || !ids.has(u.owner)) continue;
      const t = u.typeIds.find((x) => ids.has(x));
      if (t) edges.push(edge(`compose:${u.id}`, u.owner, t, "compose", u.name, { type: "element", id: u.id }));
    }
    return { nodes, edges, direction: "TB", reverse: ["derive", "refine", "trace", "satisfy", "verify", "association"] };
  }

  if (d.kind === "bdd") {
    const defs = a.elements.filter((e) => e.kind === "PartDefinition");
    const ids = new Set(defs.map((e) => e.id));
    const nodes = defs.map((e) => {
      const values = a.elements.filter((x) => x.owner === e.id && x.kind === "AttributeUsage").map((x) => `${x.tags.includes("TPM") ? "«tpm» " : ""}${x.name}${x.types[0] ? " : " + x.types[0] : ""}`);
      return makeNode(e, "block", values.length ? [["values", ...values.slice(0, 6)]] : []);
    });
    const edges: GEdge[] = [];
    for (const u of a.elements) {
      if (u.kind !== "PartUsage" || !u.owner || !ids.has(u.owner)) continue;
      const t = u.typeIds.find((x) => ids.has(x));
      if (t) edges.push(edge(`compose:${u.id}`, u.owner, t, "compose", u.name, { type: "element", id: u.id }));
    }
    return { nodes, edges, direction: "TB" };
  }

  if (d.kind === "req") {
    const rels = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind));
    const ids = new Set(listOf(a.elements, ...REQ_CATS).map((e) => e.id));
    for (const r of rels) if (ids.has(r.to) || ids.has(r.from)) { ids.add(r.from); ids.add(r.to); }
    const nodes = [...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map(reqNode);
    return { nodes, edges: rels.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i)), direction: "BT" };
  }

  if (d.kind === "uc") {
    // 使用案例圖：所有利害關係人（actor）與使用案例；兩者之間的追溯畫成關聯（實線、無箭頭）
    const ids = new Set([...listOf(a.elements, "UseCase"), ...listOf(a.elements, "Stakeholder")].map((e) => e.id));
    const rels = a.relations.filter((r) => r.kind === "trace" && ids.has(r.from) && ids.has(r.to));
    const nodes = [...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => makeNode(e, e.kind === "UseCaseUsage" ? "usecase" : "actor"));
    const isUc = (id: string) => byId.get(id)?.kind === "UseCaseUsage";
    return { nodes, edges: rels.map((r, i) => relEdge(r, i, isUc(r.from) !== isUc(r.to) ? "association" : "trace")), direction: "RL" };
  }

  const childKind = d.kind === "ibd" ? "PartUsage" : d.kind === "stm" ? "StateUsage" : "ActionUsage";
  const relKind = d.kind === "ibd" ? "connect" : d.kind === "stm" ? "transition" : "succession";
  const children = a.elements.filter((e) => e.owner === d.context && e.kind === childKind);
  const ids = new Set(children.map((e) => e.id));
  const edges = a.relations.filter((r) => r.kind === relKind && ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i));
  if (d.kind === "ibd") return { nodes: children.map((e) => makeNode(e, "part", [], e.types[0] ? `${e.name} : ${e.types[0]}` : e.name)), edges, direction: "LR" };

  // 活動圖與狀態機圖：沒有前一步的節點接起始節點；沒有下一步的接結束節點（只在已有流程時）
  const nodes = children.map((e) => makeNode(e, d.kind === "stm" ? "state" : "action"));
  if (children.length > 0 && edges.length > 0) {
    const hasIn = new Set(edges.map((e) => e.target)), hasOut = new Set(edges.map((e) => e.source));
    nodes.unshift(pseudo(`${d.id}#initial`, "initial"));
    nodes.push(pseudo(`${d.id}#final`, "final"));
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
  { kind: "trace", zh: "追溯", en: "trace", hint: "從項目拉到它的來源（例如期望拉到利害關係人）" },
  { kind: "derive", zh: "衍生", en: "deriveReqt", hint: "從衍生出的需求拉到來源需求或目的" },
  { kind: "refine", zh: "細化", en: "refine", hint: "從細化者（例如量度）拉到被細化的項目" },
  { kind: "satisfy", zh: "滿足", en: "satisfy", hint: "從負責的系統或元件拉到需求" },
  { kind: "allocate", zh: "分配", en: "allocate", hint: "從功能拉到負責執行的次系統" },
  { kind: "compose", zh: "組成", en: "composition", hint: "從整體拉到部分（兩端都是系統、次系統或元件）" },
  { kind: "connect", zh: "連接器", en: "connector", hint: "在同一個系統內的兩個零件之間拉線" },
  { kind: "succession", zh: "控制流", en: "control flow", hint: "從前一步拉到下一步（同一個任務內）" },
  { kind: "transition", zh: "轉換", en: "transition", hint: "從原狀態拉到新狀態（同一個模式內）" },
];
/** 自訂圖第一層預設顯示的工具；使用者可以自行釘選。 */
export const CUSTOM_DEFAULT = { els: ["Stakeholder", "Expectation", "SystemRequirement", "Subsystem"], links: ["trace", "derive", "satisfy"] };
/** 每種圖可以用的連線工具（選了工具再從起點拉到終點）。 */
export const LINK_TOOLS: Record<DiagramKind, LinkTool[]> = {
  bdd: [{ kind: "compose", zh: "組成", en: "composition", hint: "從整體拉到部分" }],
  ibd: [{ kind: "connect", zh: "連接器", en: "connector", hint: "在兩個零件之間拉線" }],
  req: [
    { kind: "derive", zh: "衍生", en: "deriveReqt", hint: "從衍生出的需求拉到來源需求" },
    { kind: "refine", zh: "細化", en: "refine", hint: "從細化者拉到被細化的項目" },
    { kind: "satisfy", zh: "滿足", en: "satisfy", hint: "從負責的元件拉到需求" },
    { kind: "trace", zh: "追溯", en: "trace", hint: "從項目拉到它的來源" },
  ],
  uc: [{ kind: "trace", zh: "關聯", en: "association", hint: "從使用案例拉到參與的利害關係人" }],
  act: [{ kind: "succession", zh: "控制流", en: "control flow", hint: "從前一步拉到下一步" }],
  stm: [{ kind: "transition", zh: "轉換", en: "transition", hint: "從原狀態拉到新狀態" }],
  custom: ALL_LINKS,
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
/** 工具列上每個類別畫成哪種圖形。 */
export const CATEGORY_SHAPE: Record<string, Shape> = {
  System: "block", Subsystem: "block", Component: "block", ExternalEntity: "block", Stakeholder: "actor", UseCase: "usecase",
  MissionPhase: "action", Function: "action", Mode: "state", VerificationEvent: "testcase", ValidationEvent: "testcase",
};
