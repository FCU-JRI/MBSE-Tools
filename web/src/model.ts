// 由模型資料推導出樹、表與圖。圖不另存，永遠從模型產生。
import type { Analysis, Element } from "./api.ts";

const STRUCTURAL = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);

export const label = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);

/** 與伺服器相同的規則：結構類別只列定義，其餘只列使用。 */
export function listOf(elements: Element[], ...cats: string[]): Element[] {
  return elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" &&
    (STRUCTURAL.has(e.category) ? e.kind === "PartDefinition" : e.kind.endsWith("Usage")));
}

export type DiagramKind = "bdd" | "req" | "act" | "ibd" | "uc" | "stm";
export interface DiagramDef { id: string; kind: DiagramKind; code: string; title: string; context: string | null }

export interface GNode { id: string; el: Element; stereotype: string; lines: string[] }
export interface GEdge {
  id: string; source: string; target: string; kind: string; label: string;
  /** 刪除這條線時要做的事：刪關係，或刪掉代表它的元素（結構分解的零件）。 */
  remove: { type: "relation"; kind: string; from: string; to: string } | { type: "element"; id: string } | null;
}
export interface Graph { nodes: GNode[]; edges: GEdge[]; direction: "TB" | "BT" | "LR" | "RL" }

const REQ_CATS = ["Stakeholder", "Expectation", "Need", "Goal", "Objective", "MOE", "MOP", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement"];
const STEREO: Record<string, string> = {
  PartDefinition: "part def", PartUsage: "part", RequirementUsage: "requirement", RequirementDefinition: "requirement def",
  ActionUsage: "action", UseCaseUsage: "use case", StateUsage: "state", ActionDefinition: "action def", VerificationCaseUsage: "verification", ItemUsage: "item", AttributeUsage: "attribute",
};
export const stereotype = (e: Element) => `«${STEREO[e.kind] ?? e.kind.replace(/(Usage|Definition)$/, "").toLowerCase()}»`;

export function diagramsOf(a: Analysis): DiagramDef[] {
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
  return out;
}

export function buildGraph(d: DiagramDef, a: Analysis): Graph {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const node = (el: Element, lines: string[] = []): GNode => ({ id: el.id, el, stereotype: stereotype(el), lines });
  const relEdge = (r: Analysis["relations"][number], i: number, text: string): GEdge => ({
    id: `${r.kind}:${r.from}:${r.to}:${i}`, source: r.from, target: r.to, kind: r.kind, label: text,
    remove: { type: "relation", kind: r.kind, from: r.from, to: r.to },
  });

  if (d.kind === "bdd") {
    const defs = a.elements.filter((e) => e.kind === "PartDefinition");
    const ids = new Set(defs.map((e) => e.id));
    const nodes = defs.map((e) => node(e, a.elements.filter((x) => x.owner === e.id && x.kind === "AttributeUsage").map((x) => `${x.tags.includes("TPM") ? "«tpm» " : ""}${x.name}${x.types[0] ? " : " + x.types[0] : ""}`)));
    const edges: GEdge[] = [];
    for (const u of a.elements) {
      if (u.kind !== "PartUsage" || !u.owner || !ids.has(u.owner)) continue;
      const t = u.typeIds.find((x) => ids.has(x));
      if (t) edges.push({ id: `compose:${u.id}`, source: u.owner, target: t, kind: "compose", label: u.name, remove: { type: "element", id: u.id } });
    }
    return { nodes, edges, direction: "TB" };
  }

  if (d.kind === "req") {
    const rels = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind));
    const ids = new Set(listOf(a.elements, ...REQ_CATS).map((e) => e.id));
    for (const r of rels) if (ids.has(r.to) || ids.has(r.from)) { ids.add(r.from); ids.add(r.to); }
    const nodes = [...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => node(e, e.doc ? [e.doc] : []));
    return { nodes, edges: rels.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i, `«${r.kind}»`)), direction: "BT" };
  }

  if (d.kind === "uc") {
    const ucs = listOf(a.elements, "UseCase");
    const ids = new Set(ucs.map((e) => e.id));
    const rels = a.relations.filter((r) => r.kind === "trace" && (ids.has(r.from) || ids.has(r.to)));
    for (const r of rels) { ids.add(r.from); ids.add(r.to); }
    for (const s of listOf(a.elements, "Stakeholder")) ids.add(s.id);
    const nodes = [...ids].map((id) => byId.get(id)).filter((e): e is Element => !!e).map((e) => node(e, e.kind === "UseCaseUsage" && e.doc ? [e.doc] : []));
    return { nodes, edges: rels.map((r, i) => relEdge(r, i, "")), direction: "RL" };
  }

  const childKind = d.kind === "ibd" ? "PartUsage" : d.kind === "stm" ? "StateUsage" : "ActionUsage";
  const relKind = d.kind === "ibd" ? "connect" : d.kind === "stm" ? "transition" : "succession";
  const children = a.elements.filter((e) => e.owner === d.context && e.kind === childKind);
  const ids = new Set(children.map((e) => e.id));
  return {
    nodes: children.map((e) => node(e, d.kind === "ibd" && e.types[0] ? [`: ${e.types[0]}`] : [])),
    edges: a.relations.filter((r) => r.kind === relKind && ids.has(r.from) && ids.has(r.to)).map((r, i) => relEdge(r, i, "")),
    direction: "LR",
  };
}

/** 在這張圖上拉線時建立哪種關係。需求圖由工具列選擇。 */
export const CONNECT_KIND: Record<DiagramKind, string | null> = { bdd: "compose", ibd: "connect", act: "succession", req: null, uc: "trace", stm: "transition" };
export const REQ_LINK_KINDS = ["derive", "refine", "trace", "satisfy"];
export const PALETTE: Record<DiagramKind, string[]> = {
  bdd: ["System", "Subsystem", "Component", "ExternalEntity"],
  req: ["Need", "Goal", "Objective", "MOE", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "VerificationEvent"],
  act: ["MissionPhase", "Function"],
  ibd: [],
  uc: ["Stakeholder", "UseCase"],
  stm: ["Mode"],
};
