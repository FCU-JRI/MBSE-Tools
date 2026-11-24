// 層級：任務、系統、次系統、元件。優先用 @LayerTag（attrs.layer）；沒有就由元素連到的對象推出，推不出歸「未分層」。
import type { Analysis, Element } from "../../api.ts";

export const LAYERS: [id: string, zh: string][] = [["mission", "任務"], ["system", "系統"], ["subsystem", "次系統"], ["component", "元件"]];
const BY_CATEGORY: Record<string, string> = {
  MissionPhase: "mission", MissionRequirement: "mission", Goal: "mission", Objective: "mission", Need: "mission",
  System: "system", SystemRequirement: "system", ExternalEntity: "system",
  Subsystem: "subsystem", SubsystemRequirement: "subsystem",
  Component: "component", ComponentRequirement: "component",
};
const ORDER = ["component", "subsystem", "system", "mission"];

export interface LayerOf { layer: string; how: "標記" | "連結" | "所屬" | "" }

/** 元素本身的層級：標記 > 型別（零件實例看它的定義）> 沒有 */
function own(e: Element, byId: Map<string, Element>): string | null {
  const t = e.attrs.layer;
  if (t && LAYERS.some(([id]) => id === t.replaceAll('"', ""))) return t.replaceAll('"', "");
  if (e.category && BY_CATEGORY[e.category]) return BY_CATEGORY[e.category];
  for (const id of e.typeIds) { const c = byId.get(id)?.category; if (c && BY_CATEGORY[c]) return BY_CATEGORY[c]; }
  return null;
}

/** 推出一個元素（通常是風險）的層級。連到多個對象時取最低的層（元件 > 次系統 > 系統 > 任務）。 */
export function layerOf(e: Element, a: Pick<Analysis, "elements" | "relations">): LayerOf {
  const byId = new Map(a.elements.map((x) => [x.id, x]));
  const tag = e.attrs.layer?.replaceAll('"', "");
  if (tag && LAYERS.some(([id]) => id === tag)) return { layer: tag, how: "標記" };
  const linked = a.relations.filter((r) => r.from === e.id || r.to === e.id).map((r) => byId.get(r.from === e.id ? r.to : r.from)).filter((x): x is Element => !!x).map((x) => own(x, byId)).filter((x): x is string => !!x);
  const pick = (ls: string[]) => ORDER.find((l) => ls.includes(l)) ?? "";
  if (linked.length) return { layer: pick(linked), how: "連結" };
  const o = e.owner ? byId.get(e.owner) : undefined;
  const ol = o ? own(o, byId) : null;
  return ol ? { layer: ol, how: "所屬" } : { layer: "", how: "" };
}
