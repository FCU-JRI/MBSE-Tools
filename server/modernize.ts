// 利害關係人與使用案例參與者改用語言內建的寫法（F-37）。
// 以前「期望 → 利害關係人」「使用案例 → 利害關係人」都用 #trace 相依表示；SysML v2 本身就有這兩個概念：
//   requirement <'EXP-001'> '期望' : Expectation { subject; stakeholder :> '利害關係人'; }
//   use case <'UC-001'> '使用案例' : UseCase { subject; actor :> '利害關係人'; }
// 舊寫法仍然是合法的模型（只是別的工具看不出它的意思），所以這裡是依解析結果改寫，不像 upgrade.ts 只看文字。
import type { Analysis } from "./engine.ts";
import type { Element, Relation } from "./extract.ts";
import { canInsertInside, insertInside, quote, removeLocs } from "./edits.ts";

const qname = (qualified: string) => qualified.split("::").map(quote).join("::");
const isStakeholder = (e: Element | undefined): e is Element => !!e && e.category === "Stakeholder" && e.kind === "PartUsage";
/** 這個元素能不能用內建的寫法指向利害關係人：需求（含期望）用 stakeholder，使用案例用 actor。 */
export const paramWord = (from: Element, to: Element | undefined): "stakeholder" | "actor" | null =>
  !isStakeholder(to) ? null : from.kind === "UseCaseUsage" ? "actor" : from.kind === "RequirementUsage" ? "stakeholder" : null;
/** 寫進元素主體的那幾行。subject 必須是第一個參數，所以還沒有的話一併補上。 */
export const paramLines = (from: Element, targets: Element[], word: string, indent: string) =>
  `${from.hasSubject ? "" : `${indent}subject;\n`}${targets.map((t) => `${indent}${word} :> ${qname(t.qualifiedName)};\n`).join("")}`;

interface Candidate { rel: Relation; from: Element; to: Element; word: string }
/** 還用 #trace 相依表示、可以改成內建寫法的關係。files：可以修改的檔案（專案自己的模型檔）。 */
export function embeddable(a: Analysis, files: Iterable<string>): Candidate[] {
  const own = new Set(files);
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const out: Candidate[] = [];
  for (const rel of a.relations) {
    if (rel.kind !== "trace" || rel.form || !rel.loc || !own.has(rel.file)) continue;
    const from = byId.get(rel.from), to = byId.get(rel.to);
    const word = from && paramWord(from, to);
    if (from && to && word && own.has(from.file) && from.endLine) out.push({ rel, from, to, word });
  }
  return out;
}

/**
 * 把 embeddable() 找到的相依改寫成內建的 stakeholder／actor。texts：檔名 → 內容。
 * 回傳改過的檔案；形狀特殊、無法安全插入的元素跳過，維持原本的相依。
 */
export function embedStakeholders(texts: Map<string, string>, a: Analysis): Map<string, string> {
  const already = new Set(a.relations.filter((r) => r.form).map((r) => `${r.from}|${r.to}`));
  const groups = new Map<string, { from: Element; word: string; targets: Element[]; rels: Relation[] }>();
  for (const c of embeddable(a, texts.keys())) {
    const text = texts.get(c.from.file);
    // 相依和元素的結尾在同一行時，兩個修改會互相干擾，不處理
    if (text === undefined || !canInsertInside(text, c.from) || (c.rel.file === c.from.file && c.rel.loc!.line <= c.from.endLine! && c.rel.loc!.endLine >= c.from.endLine!)) continue;
    const g = groups.get(c.from.id) ?? { from: c.from, word: c.word, targets: [], rels: [] };
    if (!already.has(`${c.from.id}|${c.to.id}`) && !g.targets.some((t) => t.id === c.to.id)) g.targets.push(c.to);
    g.rels.push(c.rel);
    groups.set(c.from.id, g);
  }
  // 每個檔案的修改由下往上做，上面的位置才不會跟著跑掉
  const edits = new Map<string, { line: number; apply: (content: string) => string }[]>();
  const add = (file: string, line: number, apply: (content: string) => string) => edits.set(file, [...(edits.get(file) ?? []), { line, apply }]);
  for (const g of groups.values()) {
    if (g.targets.length) add(g.from.file, g.from.endLine!, (content) => insertInside(content, g.from, (indent) => paramLines(g.from, g.targets, g.word, indent)));
    for (const r of g.rels) add(r.file, r.loc!.line, (content) => removeLocs(content, [r.loc!]));
  }
  const out = new Map<string, string>();
  for (const [file, list] of edits) {
    let content = texts.get(file) as string;
    for (const e of list.sort((x, y) => y.line - x.line)) content = e.apply(content);
    out.set(file, content);
  }
  return out;
}

/** 兩份解析結果的關係是不是完全相同（不看寫法與位置）。轉換前後用它確認內容沒有變。 */
export function sameRelations(a: Analysis, b: Analysis): boolean {
  const key = (x: Analysis) => x.relations.map((r) => `${r.kind}|${r.from}|${r.to}`).sort().join("\n");
  return key(a) === key(b) && a.elements.length === b.elements.length;
}
