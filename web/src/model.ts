// 由模型資料推導出清單與標籤。圖在模型頁的層級圖（web/src/pages/model/），從模型自動產生、不另存。
import type { Element } from "./api.ts";

const STRUCTURAL = new Set(["System", "Subsystem", "Component", "ExternalEntity", "DesignAlternative"]);

export const label = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);

/** 與伺服器相同的規則：結構類別只列定義，其餘只列使用。 */
export function listOf(elements: Element[], ...cats: string[]): Element[] {
  return elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" &&
    (STRUCTURAL.has(e.category) ? e.kind === "PartDefinition" : e.kind.endsWith("Usage")));
}

/** SysML v2 的關鍵字：由元類別名稱得出，例如 PartDefinition → «part def»、UseCaseUsage → «use case»。 */
const KEYWORD: Record<string, string> = { VerificationCaseUsage: "verification", VerificationCaseDefinition: "verification def", Comment: "comment" };
export const stereotype = (e: Element) => {
  if (e.kind === "Package") return "package";
  const k = KEYWORD[e.kind] ?? e.kind.replace(/(Usage|Definition)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() + (e.kind.endsWith("Definition") ? " def" : "");
  return `«${k}»`;
};

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

/** 右欄選取的一條關係（Inspector 的「關係」面板用）。 */
export interface GEdge {
  id: string; source: string; target: string; kind: string; label: string;
  dashed: boolean;
  head: "open" | "typing" | "none";
  tail: "diamond" | "none";
  /** 刪除這條線時要做的事：刪關係，或刪掉代表它的元素。 */
  remove: { type: "relation"; kind: string; from: string; to: string } | { type: "element"; id: string } | null;
}
