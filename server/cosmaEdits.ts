// CoSMA 專案的新增元素與關係（第 C 期，F-85、F-86）。寫法照 Apollo 11 參考模型。
import type { Element, Import } from "./extract.ts";
import { insertInside, quote } from "./edits.ts";
import { ADDON_PACKAGE, COSMA_CATEGORY, topPackageOf } from "./cosma.ts";

import { UserError as CosmaError } from "./projects.ts";
const C = "CoSMA.";

// ───────── 新增元素 ─────────

export interface CosmaNew { category: string; name: string; doc?: string; parentId?: string | null }
const docText = (s: string) => s.replace(/\*\//g, "* /").trim();

/** 下一個編號：Apollo 的寫法是前綴直接接三位數字（HLR-R001、MOE-001）。 */
export function nextNumber(elements: Element[], prefix: string): string {
  const re = new RegExp(`^${prefix.replace(/[-]/g, "\\-")}(\\d+)$`);
  const max = elements.reduce((m, e) => Math.max(m, Number(e.shortName?.match(re)?.[1] ?? 0)), 0);
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

export function cosmaSnippet(n: CosmaNew, elements: Element[], indent: string): string {
  const c = COSMA_CATEGORY.get(n.category);
  if (!c) throw new CosmaError("未知的元素類別。");
  if (!c.head) throw new CosmaError(`${c.zh}請到「原始碼」分頁撰寫（需要先選定它是哪個設計的實物）。`);
  const name = n.name.trim();
  if (!name) throw new CosmaError("請填名稱。");
  if (/[\r\n]/.test(name)) throw new CosmaError("名稱不能換行。");
  const sn = c.sn ? nextNumber(elements, c.sn) : null;
  const head = c.head(name, sn);
  const doc = n.doc?.trim() ? `doc /* ${docText(n.doc)} */` : "";
  return doc ? `${indent}${head} {\n${indent}    ${doc}\n${indent}}\n` : `${indent}${head};\n`;
}

/** 新套件檔的內容（範本的套件被刪掉時）：照 Apollo 的套件開頭匯入 CoSMA 與附加庫。 */
export function newPackageFile(pkg: string, body: string): string {
  return `package ${quote(pkg)} {\n${STD_IMPORTS.map((i) => `    private import ${i};\n`).join("")}\n${body}}\n`;
}
const STD_IMPORTS = ["ScalarValues::*", "ISQ::*", "SI::*", "ModelingMetadata::*", "CoSMAPackage::*", `${ADDON_PACKAGE}::*`];

/**
 * 套件缺少某個匯入時補上（插在套件開頭那一行的下一行）。呼叫的人要先寫完在套件後面的內容，再補匯入，行號才不會亂。
 * 已經匯入（`X::*`）就不動。
 */
export function ensureImport(content: string, pkg: Element, imports: Import[], target: string): string {
  if (imports.some((i) => i.from === pkg.id && !i.member && i.toName === target)) return content;
  const lines = content.split("\n");
  const at = (pkg.line ?? 0) - 1;
  if (at < 0 || !/\{\s*$/.test(lines[at] ?? "")) return content;
  if (lines.slice(at + 1, (pkg.endLine ?? lines.length)).some((l) => new RegExp(`import\\s+${target}::\\*`).test(l))) return content;
  lines.splice(at + 1, 0, `${(lines[at].match(/^\s*/)?.[0] ?? "")}    private import ${target}::*;`);
  return lines.join("\n");
}

/** 新元素要用到的匯入：CoSMA 基礎庫；MOE／MOP 再加附加庫 */
export function importsFor(category: string): string[] {
  return category === C + "MOE" || category === C + "MOP" ? ["CoSMAPackage", ADDON_PACKAGE] : ["CoSMAPackage"];
}

// ───────── 新增關係 ─────────

const qn = (q: string) => q.split("::").map(quote).join("::");
const lowerFirst = (s: string) => (/^[A-Za-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const refName = (e: Element) => (e.shortName ? quote(e.shortName) : quote(e.name));

export interface RelationEdit { file: string; content: string; message: string }
interface Ctx { elements: Element[]; imports: Import[]; read: (file: string) => Promise<string> }

/** 建立 CoSMA 的關係，回傳要寫入的檔案與內容。檢查不通過丟 CosmaError。 */
export async function cosmaRelation(kind: string, from: Element, to: Element, ctx: Ctx): Promise<RelationEdit> {
  const byId = new Map(ctx.elements.map((e) => [e.id, e]));
  const isDef = (e: Element) => /Definition$/.test(e.kind);
  if (from.shared) throw new CosmaError("起點在基礎庫或共用元件庫裡，不能修改。");
  const top = topPackageOf(from, byId);
  const withImport = async (content: string, target: string) => (top ? ensureImport(content, top, ctx.imports, target) : content);
  switch (kind) {
    case "refine": {
      if (!isDef(from)) throw new CosmaError("細化寫在定義裡：起點要是一個定義（需求定義、能力、功能等）。");
      let content = insertInside(await ctx.read(from.file), from, (i) => `${i}#refinement dependency ${refName(from)} to ${qn(to.qualifiedName)};\n`);
      content = await withImport(content, "ModelingMetadata");
      return { file: from.file, content, message: `新增細化：${from.name} 細化 ${to.name}` };
    }
    case "perform": {
      if (from.kind !== "PartDefinition") throw new CosmaError("執行的起點要是零件定義（邏輯元件）。");
      if (to.kind !== "ActionDefinition") throw new CosmaError("執行的終點要是動作定義（功能）。");
      const nm = lowerFirst(to.name);
      if (ctx.elements.some((e) => e.owner === from.id && e.name === nm)) throw new CosmaError(`「${from.name}」裡已經有名為「${nm}」的元素。`);
      return { file: from.file, content: insertInside(await ctx.read(from.file), from, (i) => `${i}perform action ${quote(nm)} : ${qn(to.qualifiedName)};\n`), message: `新增執行：${from.name} 執行 ${to.name}` };
    }
    case "participant": {
      if (from.category !== C + "Operation") throw new CosmaError("參與者的起點要是作業。");
      const nm = lowerFirst(to.name);
      if (ctx.elements.some((e) => e.owner === from.id && e.name === nm)) throw new CosmaError(`「${from.name}」裡已經有名為「${nm}」的元素。`);
      const typing = isDef(to) ? `: ${qn(to.qualifiedName)}` : `:> ${qn(to.qualifiedName)}`;
      return { file: from.file, content: insertInside(await ctx.read(from.file), from, (i) => `${i}ref part ${quote(nm)} ${typing};\n`), message: `新增參與者：${from.name} 由 ${to.name} 參與` };
    }
    case "specialize": {
      if (!isDef(from) || !isDef(to)) throw new CosmaError("特化的兩端都要是定義。");
      const lines = (await ctx.read(from.file)).split("\n");
      const at = (from.line ?? 0) - 1;
      const line = lines[at] ?? "";
      const m = line.match(/^(.*?)(\s*)(\{.*|;\s*)$/);
      if (!m || !new RegExp(`\\b${from.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b|'`).test(m[1])) throw new CosmaError("這個定義的宣告寫在好幾行，請到「原始碼」分頁加上 :>。");
      const target = qn(to.qualifiedName);
      const sep = m[3].startsWith("{") ? " " : "";
      lines[at] = /:>(?!>)/.test(m[1]) ? `${m[1]}, ${target}${sep}${m[3]}` : `${m[1]} :> ${target}${sep}${m[3]}`;
      return { file: from.file, content: lines.join("\n"), message: `新增特化：${from.name} 特化 ${to.name}` };
    }
    case "satisfy": {
      // from：負責的定義；to：需求定義。寫進以 from（或以 from 為型別的直接零件）為對象的規格
      if (to.kind !== "RequirementDefinition") throw new CosmaError("滿足的終點要是需求定義。");
      const specs = ctx.elements.filter((e) => /Specification$/.test(e.category ?? "") && e.kind === "RequirementUsage" && !e.shared);
      // 先找對象就是 from 的規格，找不到再找對象裡有一個以 from 為型別的零件的規格
      const candidates: [Element, string][] = [];
      for (const pass of [0, 1]) for (const spec of specs) {
        const subject = ctx.elements.find((e) => e.owner === spec.id && e.keyword === "subject");
        if (!subject) continue;
        if (pass === 0 && subject.typeIds.includes(from.id)) candidates.push([spec, quote(subject.name)]);
        if (pass === 1) {
          const part = ctx.elements.find((e) => subject.typeIds.includes(e.owner ?? "") && /Usage$/.test(e.kind) && e.typeIds.includes(from.id));
          if (part) candidates.push([spec, `${quote(subject.name)}.${quote(part.name)}`]);
        }
      }
      for (const [spec, by] of candidates) {
        let content = await ctx.read(spec.file);
        let member = ctx.elements.find((e) => e.owner === spec.id && e.kind === "RequirementUsage" && e.typeIds.includes(to.id));
        const memberName = member ? member.name : (to.shortName ?? to.name).toLowerCase().replace(/^([a-z]+-[a-z])/, (s) => s.slice(0, -1) + s.slice(-1).toUpperCase());
        if (!member) content = insertInside(content, spec, (i) => `${i}requirement ${quote(memberName)} : ${qn(to.qualifiedName)};\n`);
        // 再插一行 satisfy：spec 的結尾行號因為上一行插入往下一行
        const shifted: Element = member ? spec : { ...spec, endLine: (spec.endLine ?? 0) + 1 };
        content = insertInside(content, shifted, (i) => `${i}satisfy ${quote(memberName)} by ${by};\n`);
        return { file: spec.file, content, message: `新增滿足：${from.name} 滿足 ${to.name}（${spec.name}）` };
      }
      throw new CosmaError(`找不到以「${from.name}」為對象（subject）的規格。請先建立規格並在裡面寫 subject。`);
    }
    default:
      throw new CosmaError("CoSMA 專案的關係只有細化、滿足、執行、特化與參與者。");
  }
}


/**
 * 新增一個 CoSMA 元素（F-85）：放進類別對應的套件（照 Apollo 的套件名稱），或放進指定的上層元素（Concern、Goal）。
 * 套件不存在時建立新檔（資料夾照 Apollo）。用到的匯入（CoSMAPackage、附加庫）缺少時補上。
 */
export async function cosmaAddElement(n: CosmaNew, a: { elements: Element[]; imports: Import[] }, read: (file: string) => Promise<string>, files: string[]): Promise<RelationEdit> {
  const c = COSMA_CATEGORY.get(n.category);
  if (!c) throw new CosmaError("未知的元素類別。");
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const name = n.name.trim();
  const message = `新增${c.zh}：${name}`;
  let host: Element | null = null;
  if (c.parent) {
    const p = n.parentId ? byId.get(n.parentId) : undefined;
    const pc = COSMA_CATEGORY.get(c.parent);
    if (!p || p.category !== c.parent) throw new CosmaError(`${c.zh}要放在某個${pc?.zh ?? "上層元素"}裡面，請先選擇是哪一個。`);
    host = p;
  } else {
    host = a.elements.find((e) => e.kind === "Package" && e.qualifiedName === c.pkg && !e.shared) ?? null;
  }
  if (host?.shared) throw new CosmaError("不能加在基礎庫或共用元件庫裡。");
  if (host && a.elements.some((e) => e.owner === host.id && e.name === name)) throw new CosmaError(`「${host.name}」裡已經有名為「${name}」的元素。`);
  if (!host) {
    const file = `${c.dir}/${c.pkg}.sysml`;
    if (files.includes(file)) throw new CosmaError(`檔案 ${file} 已經存在，但裡面沒有套件 ${c.pkg}。請到「原始碼」分頁檢查。`);
    return { file, content: newPackageFile(c.pkg, cosmaSnippet(n, a.elements, "    ")), message };
  }
  let content = insertInside(await read(host.file), host, (indent) => cosmaSnippet(n, a.elements, indent));
  const top = topPackageOf(host, byId);
  if (top) for (const imp of importsFor(c.id)) content = ensureImport(content, top, a.imports, imp);
  return { file: host.file, content, message };
}
