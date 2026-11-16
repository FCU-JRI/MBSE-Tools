// P4：圖 6「介面」還缺什麼。只看解析結果（不求值）；兩端數字的檢查與同意狀態在「介面」頁（伺服器算）。
import type { Analysis } from "../api.ts";

export function interfaceMissing(a: Analysis): { id: string | null; text: string }[] {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const ifaces = (a.connectors ?? []).filter((c) => c.kind === "interface");
  const out: { id: string | null; text: string }[] = [];
  if (!ifaces.length) out.push({ id: null, text: "還沒有任何介面。次系統一分出來，就記下 A 和 B 之間有什麼介面，數字可以先暫定。" });
  // 介面兩端接到的零件的定義
  const used = new Set(ifaces.flatMap((c) => [c.fromChain[0], c.toChain[0]].map((p) => byId.get(p ?? "")?.typeIds[0]).filter(Boolean) as string[]));
  for (const s of a.elements.filter((e) => e.kind === "PartDefinition" && e.category === "Subsystem" && !used.has(e.id))) out.push({ id: s.id, text: `「${s.name}」還沒有任何介面。` });
  for (const d of a.elements.filter((e) => e.kind === "InterfaceDefinition" && e.category === "Interface" && !e.attrs.interfaceKind)) out.push({ id: d.id, text: `介面「${d.name}」還沒有定種類。` });
  return out;
}
