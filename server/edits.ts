// 引導模式的編輯：把表單內容轉成 SysML v2 文字，插入模型檔的對應套件。
// 只做局部插入，不重排檔案其他內容。
import type { Element } from "./extract.ts";
import { CATEGORY } from "./metamodel.ts";
import { UserError } from "./projects.ts";

/** 名稱若不是基本識別字就加單引號。 */
export function quote(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
const qname = (qualified: string) => qualified.split("::").map(quote).join("::");
const str = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;
const docText = (s: string) => s.replace(/\*\//g, "* /").trim();

export interface NewElement {
  category: string;
  name: string;
  shortName?: string;
  doc?: string;
  attrs?: Record<string, string>;
  source?: { doc?: string; ref?: string }; // 出處
  verifies?: string; // 驗證事件：被驗證需求的完整名稱
  method?: string; // byTest | byAnalysis | byInspection | byDemonstration
  parent?: string; // 結構元素：上層定義的完整名稱
}

export function nextShortName(elements: Element[], prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[-]/g, "\\-")}-(\\d+)$`);
  const max = elements.reduce((m, e) => Math.max(m, Number(e.shortName?.match(re)?.[1] ?? 0)), 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

export function snippetFor(n: NewElement, elements: Element[], indent: string): string {
  const cat = CATEGORY.get(n.category);
  if (!cat) throw new UserError("未知的元素類別。");
  const name = n.name.trim();
  if (!name) throw new UserError("請填名稱。");
  if (/[\r\n]/.test(name)) throw new UserError("名稱不能換行。");
  const sn = (n.shortName?.trim() || nextShortName(elements, cat.prefix)).replace(/'/g, "");
  if (elements.some((e) => e.shortName === sn)) throw new UserError(`編號 ${sn} 已被使用。`);

  const body: string[] = [];
  if (n.doc?.trim()) body.push(`doc /* ${docText(n.doc)} */`);
  for (const f of cat.fields ?? []) {
    const v = n.attrs?.[f.name]?.trim();
    if (!v) continue;
    if (f.type === "text") body.push(`:>> ${f.name} = ${str(v)};`);
    else if (!/^-?\d+(\.\d+)?$/.test(v)) throw new UserError(`「${f.zh}」必須是數字。`);
    else body.push(`:>> ${f.name} = ${f.type === "real" && !v.includes(".") ? v + ".0" : v};`);
  }
  if (n.source?.doc?.trim()) body.push(sourceText(n.source.doc, n.source.ref ?? ""));
  if (cat.keyword === "verification") {
    if (n.verifies) body.push(`objective { verify ${qname(n.verifies)}; }`);
    if (n.method) {
      if (!/^by(Test|Analysis|Inspection|Demonstration)$/.test(n.method)) throw new UserError("驗證方法不合法。");
      body.push(`@VVMethod { kind = Method::${n.method}; }`);
    }
  }
  const head =
    cat.keyword === "part def"
      ? `part def <'${sn}'> ${quote(name)} :> ${cat.id}`
      : `${cat.keyword} <'${sn}'> ${quote(name)} : ${cat.id}`;
  if (body.length === 0) return `${indent}${head};\n`;
  return `${indent}${head} {\n${body.map((l) => `${indent}    ${l}\n`).join("")}${indent}}\n`;
}

export interface NewRelation {
  kind: "derive" | "refine" | "trace" | "satisfy" | "allocate";
  from: string; // 完整名稱
  to: string;
}

export function relationSnippet(r: NewRelation, indent: string): string {
  const a = qname(r.from);
  const b = qname(r.to);
  switch (r.kind) {
    case "derive":
    case "refine":
    case "trace":
      return `${indent}#${r.kind} dependency from ${a} to ${b};\n`;
    case "satisfy":
      // from = 負責滿足的系統或元件，to = 需求
      return `${indent}satisfy ${b} by ${a};\n`;
    case "allocate":
      return `${indent}allocate ${a} to ${b};\n`;
    default:
      throw new UserError("不支援的關係類型。");
  }
}

/** 在指定套件的結尾大括號前插入文字；套件不存在時在根套件內新增。 */
export function insertInto(content: string, elements: Element[], rootPackage: string, pkg: string | null, make: (indent: string) => string): string {
  const lines = content.split("\n");
  const root = elements.find((e) => e.kind === "Package" && e.qualifiedName === rootPackage);
  if (!root?.endLine) throw new UserError(`模型中找不到根套件 ${rootPackage}。`);
  const target = pkg ? elements.find((e) => e.kind === "Package" && e.qualifiedName === `${rootPackage}::${pkg}`) : root;
  if (target?.endLine) {
    const closing = lines[target.endLine - 1] ?? "";
    const base = closing.match(/^\s*/)?.[0] ?? "";
    lines.splice(target.endLine - 1, 0, make(base + "    ").replace(/\n$/, ""));
    return lines.join("\n");
  }
  const base = (lines[root.endLine - 1] ?? "").match(/^\s*/)?.[0] ?? "";
  const i1 = base + "    ";
  const block = `\n${i1}package ${quote(pkg as string)} {\n${make(i1 + "    ")}${i1}}`;
  lines.splice(root.endLine - 1, 0, block);
  return lines.join("\n");
}

/** 在某個元素的主體內插入一行；元素若以分號結尾（沒有主體）就先展開成大括號。 */
export function insertInside(content: string, target: Element, make: (indent: string) => string): string {
  if (!target.endLine) throw new UserError("找不到元素在檔案中的位置。");
  const lines = content.split("\n");
  const i = target.endLine - 1;
  const last = lines[i] ?? "";
  const startIndent = (lines[(target.line ?? target.endLine) - 1] ?? "").match(/^\s*/)?.[0] ?? "";
  const body = make(startIndent + "    ").replace(/\n$/, "");
  if (/^\s*\}\s*$/.test(last)) {
    lines.splice(i, 0, body);
  } else if (/;\s*$/.test(last)) {
    lines[i] = last.replace(/;\s*$/, " {");
    lines.splice(i + 1, 0, body, `${startIndent}}`);
  } else {
    throw new UserError("這個元素的寫法無法自動插入，請到「原始碼」分頁手動修改。");
  }
  return lines.join("\n");
}

// ───────── 修改與刪除 ─────────
import type { Loc, Relation } from "./extract.ts";

/** 位元組欄位（從 1 起算）轉成該行字串的索引。 */
function charIndex(lineText: string, byteCol: number): number {
  return Buffer.from(lineText, "utf8").subarray(0, Math.max(0, byteCol - 1)).toString("utf8").length;
}

/** 以新文字取代一段原始碼；取代後若整行只剩空白就移除該行。 */
export function replaceLoc(content: string, loc: Loc, text: string): string {
  const lines = content.split("\n");
  const first = lines[loc.line - 1] ?? "";
  const last = lines[loc.endLine - 1] ?? "";
  const merged = first.slice(0, charIndex(first, loc.col)) + text + last.slice(charIndex(last, loc.endCol));
  if (merged.trim() === "") lines.splice(loc.line - 1, loc.endLine - loc.line + 1);
  else lines.splice(loc.line - 1, loc.endLine - loc.line + 1, merged);
  return lines.join("\n");
}

const within = (inner: Loc, outer: Loc) =>
  (inner.line > outer.line || (inner.line === outer.line && inner.col >= outer.col)) &&
  (inner.endLine < outer.endLine || (inner.endLine === outer.endLine && inner.endCol <= outer.endCol));

/** 由後往前移除多段原始碼，避免位置位移；被其他段包住的段落略過。 */
export function removeLocs(content: string, locs: Loc[]): string {
  const uniq = locs.filter((l, i) => !locs.some((o, j) => j !== i && within(l, o) && !(within(o, l) && j > i)));
  uniq.sort((a, b) => b.line - a.line || b.col - a.col);
  return uniq.reduce((c, l) => replaceLoc(c, l, ""), content);
}

export function deleteElementText(content: string, el: Element, elements: Element[], relations: Relation[]): string {
  if (!el.loc) throw new UserError("找不到元素在檔案中的位置。");
  const inside = (x: Element, outer: Element) => !!(x.loc && outer.loc && within(x.loc, outer.loc));
  const users = elements.filter((x) => x.id !== el.id && x.file === el.file && x.typeIds.includes(el.id) && !inside(x, el));
  // 以它為型別的實例（例如 part rocket : 火箭）在樹與圖上看不到，使用者無從先刪，所以一併刪除。
  // 但寫在別的元素裡面的引用（例如需求的 subject）不能默默拿掉，要請使用者先處理那個元素。
  const instances = users.filter((x) => x.kind !== "ReferenceUsage" && x.loc);
  const blocking = users.filter((x) => !instances.includes(x) && !instances.some((i) => inside(x, i)));
  if (blocking.length) {
    const where = blocking.slice(0, 3).map((u) => { const o = elements.find((e) => e.id === u.owner); return o ? `${o.shortName ?? ""} ${o.name}`.trim() : u.name; });
    throw new UserError(`還有 ${blocking.length} 處引用它（在 ${where.join("、")} 裡），請先刪除或修改那些項目。`);
  }
  const removed = [el, ...instances];
  const ids = new Set(removed.map((x) => x.id));
  for (const x of elements) if (removed.some((r) => r.id !== x.id && inside(x, r))) ids.add(x.id);
  const rel = relations.filter((r) => (ids.has(r.from) || ids.has(r.to)) && r.loc).map((r) => r.loc as Loc);
  return removeLocs(content, [...removed.map((x) => x.loc as Loc), ...rel]);
}

export function setDocText(content: string, el: Element, doc: string): string {
  const text = doc.trim() ? `doc /* ${docText(doc)} */` : "";
  if (el.docLoc) return replaceLoc(content, el.docLoc, text);
  if (!text) return content;
  return insertInside(content, el, (indent) => `${indent}${text}\n`);
}

export function setAttrText(content: string, el: Element, field: { name: string; zh: string; type: string }, value: string): string {
  const v = value.trim();
  let literal = "";
  if (v) {
    if (field.type === "text") literal = str(v);
    else if (!/^-?\d+(\.\d+)?$/.test(v)) throw new UserError(`「${field.zh}」必須是數字。`);
    else literal = field.type === "real" && !v.includes(".") ? v + ".0" : v;
  }
  const text = literal ? `:>> ${field.name} = ${literal};` : "";
  const loc = el.attrLoc[field.name];
  if (loc) return replaceLoc(content, loc, text);
  if (!text) return content;
  return insertInside(content, el, (indent) => `${indent}${text}\n`);
}

/** 改名：只改宣告所在行，以及引用它的關係與使用所在的行。 */
export function renameText(content: string, el: Element, newName: string, elements: Element[], relations: Relation[]): string {
  const name = newName.trim();
  if (!name) throw new UserError("請填名稱。");
  if (/[\r\n]/.test(name)) throw new UserError("名稱不能換行。");
  const oldTok = quote(el.name);
  const newTok = quote(name);
  const lineSet = new Set<number>();
  if (el.line) lineSet.add(el.line);
  for (const r of relations) if ((r.from === el.id || r.to === el.id) && r.loc) for (let l = r.loc.line; l <= r.loc.endLine; l++) lineSet.add(l);
  for (const x of elements) if (x.typeIds.includes(el.id) && x.line) lineSet.add(x.line);
  const escaped = oldTok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = oldTok.startsWith("'") ? new RegExp(escaped, "g") : new RegExp(`(?<![A-Za-z0-9_'])${escaped}(?![A-Za-z0-9_'])`, "g");
  const lines = content.split("\n");
  for (const l of lineSet) if (lines[l - 1] !== undefined) lines[l - 1] = lines[l - 1].replace(re, () => newTok);
  return lines.join("\n");
}

/** 直接設定某個屬性的值（原樣寫入運算式，例如 3012.4 [m]）。模擬結果回寫用。 */
export function setRawAttrText(content: string, el: Element, name: string, expression: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new UserError("屬性名稱不合法。");
  const text = `:>> ${name} = ${expression};`;
  const loc = el.attrLoc[name];
  return loc ? replaceLoc(content, loc, text) : insertInside(content, el, (indent) => `${indent}${text}\n`);
}

/** 修改編號（短名稱 <'...'>）。只改宣告那一行；原本沒有編號就加在名稱前面。 */
export function setShortNameText(content: string, el: Element, shortName: string, elements: Element[]): string {
  const sn = shortName.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(sn)) throw new UserError("編號只能用英數、點、底線與連字號，最長 31 個字，且以英數開頭。");
  if (elements.some((e) => e.id !== el.id && e.shortName === sn)) throw new UserError(`編號 ${sn} 已被使用。`);
  if (!el.line) throw new UserError("找不到元素在檔案中的位置。");
  const lines = content.split("\n");
  const line = lines[el.line - 1] ?? "";
  const tok = quote(el.name);
  let next: string;
  if (el.shortName) {
    const old = `<'${el.shortName}'>`, bare = `<${el.shortName}>`;
    if (line.includes(old)) next = line.replace(old, () => `<'${sn}'>`);
    else if (line.includes(bare)) next = line.replace(bare, () => `<'${sn}'>`);
    else throw new UserError("這個元素的編號寫法無法自動修改，請到「原始碼」分頁修改。");
  } else {
    const i = line.indexOf(tok);
    if (i < 0) throw new UserError("這個元素的寫法無法自動加上編號，請到「原始碼」分頁修改。");
    next = line.slice(0, i) + `<'${sn}'> ` + line.slice(i);
  }
  lines[el.line - 1] = next;
  return lines.join("\n");
}

function sourceText(doc: string, ref: string): string {
  const d = doc.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,30}$/.test(d)) throw new UserError("文件編號不合法。");
  return `@Source { sourceDoc = ${str(d)};${ref.trim() ? ` sourceRef = ${str(ref.trim().slice(0, 80))};` : ""} }`;
}

/** 設定或清除出處（@Source）。 */
export function setSourceText(content: string, el: Element, doc: string, ref: string): string {
  const text = doc.trim() ? sourceText(doc, ref) : "";
  const loc = el.metaLoc.Source;
  if (loc) return replaceLoc(content, loc, text);
  if (!text) return content;
  return insertInside(content, el, (indent) => `${indent}${text}\n`);
}
