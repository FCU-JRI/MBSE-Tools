// P6 模型內公式（METHOD.md 第 5 節）：列出 calc def、把用到公式的屬性算出數字、判定 assert constraint 過或不過。
// 求值交給解析器（@openmbee/opensysml 0.11.0 的 eval、verifyConstraint），工具不自己算公式。
// 實測結果見 docs/TRADE-CALC.md 第 3 節。
import type { Analysis } from "../engine.ts";
import type { Element, Loc } from "../extract.ts";
import { nextShortName, quote } from "../edits.ts";
import { UserError } from "../projects.ts";

export const CALC_PACKAGE = "Calculations";
export const CALC_PREFIX = "CALC";
/** ln、exp 在解析器自己的套件；sqrt 在標準庫的 RealFunctions，標準庫沒有 ln（實測，docs/TRADE-CALC.md） */
export const MATH_IMPORT = "OpenSysMLMathFunctions";

export interface CalcParam { name: string; type: string }
export interface CalcDef {
  id: string; shortName: string | null; name: string; qualifiedName: string; doc: string; file: string;
  params: CalcParam[]; returnName: string; returnType: string; expression: string;
  /** calc def 的原始碼（整段） */
  source: string;
}
export interface Value { value: number | boolean | string | null; unit: string | null; text: string }
export interface CalcResult { owner: string; ownerName: string; ownerKind: string; attr: string; expression: string; value: Value | null; error: string | null }
export interface CalcCheck { id: string; name: string; owner: string; subject: string | null; condition: string; status: "holds" | "fails" | "undecided"; error: string | null }

const LITERAL = /^\s*(?:[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?(?:\s*\[[^\]]*\])?|"(?:[^"\\]|\\.)*"|true|false|null)\s*$/;
export const isLiteral = (expr: string) => LITERAL.test(expr);

/** 解析器的值 → 數字與單位 */
export function toValue(v: any): Value {
  if (!v || typeof v !== "object") return { value: null, unit: null, text: String(v) };
  switch (v.kind) {
    case "int": return num(Number(v.value), null);
    case "real": return num(v.value, null);
    case "rational": return num(Number(v.numerator) / Number(v.denominator), null);
    case "quantity": { const m = toValue(v.magnitude); return num(typeof m.value === "number" ? m.value : NaN, String(v.unit ?? "")); }
    case "boolean": return { value: v.value, unit: null, text: String(v.value) };
    case "string": return { value: v.value, unit: null, text: JSON.stringify(v.value) };
    case "sequence": return v.elements?.length === 1 ? toValue(v.elements[0]) : { value: null, unit: null, text: `（${v.elements?.length ?? 0} 個值）` };
    case "enum": return { value: String(v.value?.name ?? ""), unit: null, text: String(v.value?.name ?? "") };
    default: return { value: null, unit: null, text: `（${String(v.kind)}${v.reason ? `：${v.reason}` : ""}）` };
  }
}
function num(x: number, unit: string | null): Value {
  const text = Number.isFinite(x) ? `${Number(x.toPrecision(6))}${unit ? ` [${unit}]` : ""}` : "（無法換算成數字）";
  return { value: Number.isFinite(x) ? x : null, unit, text };
}

function sliceLoc(content: string, el: Element | { loc: Loc | null }): string {
  const loc = el.loc;
  if (!loc) return "";
  const lines = content.split("\n");
  const out: string[] = [];
  for (let l = loc.line; l <= loc.endLine; l++) {
    const t = lines[l - 1] ?? "";
    const b = Buffer.from(t, "utf8");
    const start = l === loc.line ? loc.col - 1 : 0;
    const end = l === loc.endLine ? loc.endCol - 1 : b.length;
    out.push(b.subarray(Math.max(0, start), Math.max(0, end)).toString("utf8"));
  }
  return out.join("\n");
}

const NAME = `(?:[A-Za-z_]\\w*|'(?:[^'\\\\]|\\\\.)*')`;
const unq = (s: string) => (s.startsWith("'") ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s);

/** 從 calc def 的原始碼讀出參數與回傳式。 */
export function parseCalcSource(source: string): { params: CalcParam[]; returnName: string; returnType: string; expression: string } {
  const body = source.replace(/doc\s*\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const params: CalcParam[] = [];
  for (const m of body.matchAll(new RegExp(`\\bin\\s+(?:attribute\\s+)?(${NAME})\\s*:\\s*([\\w:]+)`, "g"))) params.push({ name: unq(m[1]), type: m[2] });
  const r = new RegExp(`\\breturn\\s*(${NAME})?\\s*(?::\\s*([\\w:]+))?\\s*=\\s*([^;]*);`).exec(body);
  const r2 = r ? null : /}\s*$/.test(body) ? /([^;{}]+)\}\s*$/.exec(body) : null; // 結果式寫在最後、不帶 return 的寫法
  return { params, returnName: r?.[1] ? unq(r[1]) : "", returnType: r?.[2] ?? "", expression: (r?.[3] ?? r2?.[1] ?? "").trim() };
}

export function listCalcDefs(a: Analysis, contents: Map<string, string>): CalcDef[] {
  return a.elements.filter((e) => e.kind === "CalculationDefinition" && !e.shared).map((e) => {
    const source = sliceLoc(contents.get(e.file) ?? "", e);
    return { id: e.id, shortName: e.shortName, name: e.name, qualifiedName: e.qualifiedName, doc: e.doc, file: e.file, source, ...parseCalcSource(source) };
  });
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPE = /^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$/;
export interface CalcInput { name: string; shortName?: string; doc?: string; params: CalcParam[]; returnType: string; expression: string }

/** 新增或修改 calc def 時的原始碼。參數名與型別只收識別字，運算式不能有分號、大括號或換行（避免寫出別的東西）。 */
export function calcText(input: CalcInput, elements: Element[], indent: string, keepShortName?: string | null): string {
  const name = String(input.name ?? "").trim();
  if (!name) throw new UserError("請填公式名稱。");
  if (/[\r\n']/.test(name)) throw new UserError("公式名稱不能有換行或單引號。");
  const params = Array.isArray(input.params) ? input.params : [];
  if (!params.length) throw new UserError("公式至少要有一個輸入參數。");
  const seen = new Set<string>();
  for (const p of params) {
    if (!IDENT.test(String(p?.name ?? ""))) throw new UserError(`參數名稱「${p?.name ?? ""}」只能用英文字母、數字與底線，開頭不能是數字。`);
    if (!TYPE.test(String(p?.type ?? ""))) throw new UserError(`參數 ${p.name} 的型別不合法（例如 Real、MassValue、ISQ::ForceValue）。`);
    if (seen.has(p.name)) throw new UserError(`參數 ${p.name} 重複了。`);
    seen.add(p.name);
  }
  const rt = String(input.returnType ?? "").trim() || "Real";
  if (!TYPE.test(rt)) throw new UserError("回傳型別不合法（例如 Real、LengthValue）。");
  const expr = String(input.expression ?? "").trim();
  if (!expr) throw new UserError("請填公式的運算式。");
  if (/[;{}\r\n]|\/\*|\*\/|\/\//.test(expr) || expr.length > 500) throw new UserError("運算式不能有分號、大括號、註解或換行，長度在 500 字以內。");
  const sn = (keepShortName ?? (input.shortName?.trim() || nextShortName(elements, CALC_PREFIX))).replace(/'/g, "");
  if (!keepShortName && elements.some((e) => e.shortName === sn)) throw new UserError(`編號 ${sn} 已被使用。`);
  const doc = String(input.doc ?? "").trim().replace(/\*\//g, "* /").replace(/\r?\n/g, " ");
  const inner = indent + "    ";
  return [
    `${indent}calc def <'${sn}'> ${quote(name)} {`,
    ...(doc ? [`${inner}doc /* ${doc} */`] : []),
    ...params.map((p) => `${inner}in ${p.name} : ${p.type};`),
    `${inner}return : ${rt} = ${expr};`,
    `${indent}}`,
  ].join("\n") + "\n";
}

/** 新的 Calculations 套件（含求值需要的匯入） */
export function calcPackageText(indent: string, calc: string): string {
  const i = indent + "    ";
  return `${indent}package ${CALC_PACKAGE} {\n${i}private import ScalarValues::*;\n${i}private import ISQ::*;\n${i}private import SI::*;\n${i}private import RealFunctions::*;\n${i}private import ${MATH_IMPORT}::*;\n${calc}${indent}}\n`;
}

const byIdOf = (a: Analysis) => new Map([...a.elements, ...a.unnamed].map((e) => [e.id, e]));

/** 元素所在的套件，與從套件往下的路徑。 */
function pathOf(e: Element, byId: Map<string, Element>): { pkg: string; chain: Element[] } | null {
  const chain: Element[] = [e];
  let cur = byId.get(e.parent ?? e.owner ?? "");
  for (let i = 0; cur && i < 40; i++) {
    if (cur.kind === "Package") return { pkg: cur.qualifiedName.split("::").map(quote).join("::"), chain };
    chain.unshift(cur);
    cur = byId.get(cur.parent ?? cur.owner ?? "");
  }
  return null;
}

const HOLDERS = /^(Part|Item|Occurrence)(Definition|Usage)$/;

/** 要算的屬性：自己寫了運算式的，以及型別（定義）裡寫了運算式、這個使用沒有改寫的。 */
export function computedTargets(a: Analysis, contents: Map<string, string>): { el: Element; attr: string; expression: string; context: string; path: string }[] {
  const byId = byIdOf(a);
  const out: ReturnType<typeof computedTargets> = [];
  // 解析器輸出的字串值已經去掉引號，要回到原始碼看等號右邊是不是字串
  const literal = (e: Element, name: string) => {
    const loc = e.attrLoc?.[name], text = loc ? contents.get(e.file) : undefined;
    if (loc && text !== undefined) {
      const rhs = /=\s*([\s\S]*?)\s*;?\s*$/.exec(sliceLoc(text, { loc }))?.[1];
      if (rhs !== undefined) return isLiteral(rhs);
    }
    return isLiteral(e.attrs[name]);
  };
  const own = (e: Element) => Object.entries(e.attrs).filter(([n]) => !literal(e, n));
  const inherited = (e: Element, depth = 0): [string, string][] => {
    if (depth > 10) return [];
    return e.typeIds.flatMap((t) => { const d = byId.get(t); return d ? [...own(d), ...inherited(d, depth + 1)] : []; });
  };
  for (const e of a.elements) {
    if (e.shared || !HOLDERS.test(e.kind)) continue;
    const p = pathOf(e, byId);
    if (!p) continue;
    const isDef = e.kind.endsWith("Definition");
    const seen = new Set<string>();
    const list = [...own(e), ...(isDef ? [] : inherited(e))].filter(([n]) => (seen.has(n) ? false : (seen.add(n), !(n in e.attrs) || !literal(e, n))));
    for (const [attr, expression] of list) {
      const sep = isDef ? "::" : ".";
      // 定義：Pkg 內寫 Def::attr；使用：Pkg 內寫 a.b.attr
      const path = [...p.chain.map((x) => quote(x.name)), quote(attr)].join(sep);
      out.push({ el: e, attr, expression, context: p.pkg, path });
    }
  }
  return out;
}

export async function evaluateModel(model: any, a: Analysis, contents: Map<string, string>): Promise<{ results: CalcResult[]; checks: CalcCheck[] }> {
  const results: CalcResult[] = [];
  for (const t of computedTargets(a, contents)) {
    try {
      results.push({ owner: t.el.id, ownerName: t.el.shortName ? `${t.el.shortName} ${t.el.name}` : t.el.name, ownerKind: t.el.kind, attr: t.attr, expression: t.expression, value: toValue(await model.eval(t.path, { context: t.context })), error: null });
    } catch (err) {
      results.push({ owner: t.el.id, ownerName: t.el.name, ownerKind: t.el.kind, attr: t.attr, expression: t.expression, value: null, error: (err as Error).message });
    }
  }
  const byId = byIdOf(a);
  const checks: CalcCheck[] = [];
  for (const c of [...a.elements, ...a.unnamed]) {
    if (c.shared || c.kind !== "AssertConstraintUsage") continue;
    const owner = byId.get(c.parent ?? c.owner ?? "");
    if (!owner) continue;
    const subjects = owner.kind.endsWith("Usage") ? [owner]
      : a.elements.filter((u) => !u.shared && u.kind.endsWith("Usage") && u.typeIds.includes(owner.id));
    for (const s of subjects.length ? subjects : [null]) {
      try {
        const v = await model.verifyConstraint(c.qualifiedName, s ? { subject: s.qualifiedName } : {});
        const kind = String(v?.verdict?.kind ?? "");
        checks.push({ id: c.id, name: c.name, owner: owner.id, subject: s?.id ?? null, condition: String(v?.verdict?.condition ?? ""),
          status: kind === "holds" ? "holds" : kind === "fails" ? "fails" : "undecided", error: null });
      } catch (err) {
        checks.push({ id: c.id, name: c.name, owner: owner.id, subject: s?.id ?? null, condition: "", status: "undecided", error: (err as Error).message });
      }
    }
  }
  return { results, checks };
}
