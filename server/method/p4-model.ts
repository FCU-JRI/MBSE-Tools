// P4：介面與 N² 矩陣（METHOD.md 第 4 節）。從解析結果整理連接埠、介面、N² 矩陣與驗證清單，並產生新增與修改用的 SysML v2 文字。
// 這裡只有純函式；讀寫檔案與路由在 p4.ts。
import { createHash } from "node:crypto";
import type { Element, Loc } from "../extract.ts";
import type { Analysis, Evaluated } from "../engine.ts";
import { quote } from "../edits.ts";
import { UserError } from "../projects.ts";

/** 介面種類：InterfaceKind 的值 → 中文 */
export const INTERFACE_KINDS: Record<string, string> = { mechanical: "機械", thermal: "熱", electrical: "電", fluid: "流體", data: "資料", human: "人" };
/** 成熟度（METHOD.md 第 4 節）：MDR 時介面存在、PDR 時數字暫定、CDR 時凍結 */
export const MATURITY = ["存在", "暫定", "凍結"];
/** 驗證方法：和標準庫 VerificationMethodKind 的值相同 */
export const VERIFY_METHODS: Record<string, string> = { inspect: "檢查", demo: "展示", analyze: "分析", test: "測試" };
/** 驗證層級（和 P1 的需求屬性相同） */
export const VERIFY_LEVELS = ["系統", "次系統", "元件"];
/** 連接埠屬性可用的型別。unit 是預設單位（填數字時自動補上） */
export const PORT_TYPES: { id: string; zh: string; unit: string }[] = [
  { id: "ScalarValues::Real", zh: "實數", unit: "" },
  { id: "ScalarValues::Integer", zh: "整數", unit: "" },
  { id: "ScalarValues::Boolean", zh: "是／否", unit: "" },
  { id: "ScalarValues::String", zh: "文字", unit: "" },
  { id: "ISQ::LengthValue", zh: "長度", unit: "m" },
  { id: "ISQ::MassValue", zh: "質量", unit: "kg" },
  { id: "ISQ::ForceValue", zh: "力", unit: "N" },
  { id: "ISQ::TorqueValue", zh: "力矩", unit: "N*m" },
  { id: "ISQ::PressureValue", zh: "壓力", unit: "Pa" },
  { id: "ISQ::ThermodynamicTemperatureValue", zh: "溫度", unit: "K" },
  { id: "ISQ::PowerValue", zh: "功率", unit: "W" },
  { id: "ISQ::ElectricPotentialValue", zh: "電壓", unit: "V" },
  { id: "ISQ::ElectricCurrentValue", zh: "電流", unit: "A" },
  { id: "ISQ::TimeValue", zh: "時間", unit: "s" },
  { id: "ISQ::FrequencyValue", zh: "頻率", unit: "Hz" },
  { id: "ISQ::MassFlowRateValue", zh: "質量流率", unit: "kg/s" },
];
const TYPE_BY_NAME = new Map(PORT_TYPES.flatMap((t) => [[t.id, t], [t.id.split("::")[1], t]]));

export interface PortAttr { name: string; type: string; unit: string }
export interface PortDefInfo { id: string; name: string; shortName: string | null; qualifiedName: string; doc: string; attrs: PortAttr[]; shared: boolean }
export interface InterfaceDefInfo {
  id: string; name: string; shortName: string | null; qualifiedName: string; doc: string; shared: boolean;
  kind: string; ends: { name: string; portDef: string | null }[]; constraints: { name: string; text: string }[];
  attrs: Record<string, string>;
}
export interface Approval { by: string; at: string; hash: string }
export interface InterfaceEnd {
  /** 介面定義上的端點名稱 */
  end: string;
  /** 接到的零件（使用）與它的定義 */
  part: string | null; partName: string; partDef: string | null; partDefName: string;
  port: string | null; portName: string; portDef: string | null;
  given: boolean;
  values: { name: string; value: number | boolean | string | null; unit: string; reason: string }[];
}
export interface InterfaceInfo {
  id: string; name: string; qualifiedName: string; owner: string | null; ownerName: string;
  def: string | null; defName: string; kind: string; kindZh: string; maturity: string;
  ownerA: string; ownerB: string;
  ends: InterfaceEnd[];
  constraints: { name: string; text: string; result: "pass" | "fail" | "unknown"; reason: string }[];
  /** 兩端數字的檢查：pass 全部成立；fail 至少一條不成立；unknown 沒有限制或求不出來 */
  result: "pass" | "fail" | "unknown";
  hash: string;
  approvals: { a: Approval | null; b: Approval | null };
  /** 兩端負責人都同意了目前的內容 */
  agreed: boolean;
  verification: VerificationRow;
}
/** 驗證清單的一列。欄位名稱和 P1 的需求屬性相同 */
export interface VerificationRow {
  id: string; name: string; source: "interface" | "given";
  verificationMethod: string; verificationOwner: string; verificationLevel: string; owner: string; rationale: string;
  /** pass 通過、fail 不通過、open 待驗證 */
  result: "pass" | "fail" | "open";
}
export interface N2 {
  nodes: { id: string; name: string; category: string | null; given: boolean }[];
  /** key 是「列的 id|欄的 id」：列是 A 端（endA），欄是 B 端（endB） */
  cells: Record<string, string[]>;
}
export interface InterfaceReport {
  kinds: Record<string, string>; maturity: string[]; methods: Record<string, string>; levels: string[]; portTypes: typeof PORT_TYPES;
  portDefs: PortDefInfo[]; interfaceDefs: InterfaceDefInfo[]; interfaces: InterfaceInfo[];
  /** 次系統、元件與外部對象的定義，和它們身上的連接埠 */
  parts: { id: string; name: string; category: string | null; given: boolean; ports: { id: string; name: string; portDef: string | null; values: Record<string, string> }[] }[];
  n2: N2; verification: VerificationRow[]; warnings: { id: string | null; text: string }[];
}

const isA = (e: Element, cat: string) => e.category === cat;
const childrenOf = (a: Analysis, id: string) => a.elements.filter((e) => e.owner === id);
const kindOfValue = (v: string | undefined) => (v ?? "").split("::").pop() ?? "";
const clean = (v: string | undefined) => (v ?? "").replace(/^"|"$/g, "");

/** 某段原始碼（欄位是 UTF-8 位元組、從 1 起算） */
export function sliceLoc(content: string, loc: Loc): string {
  const lines = content.split("\n").slice(loc.line - 1, loc.endLine);
  if (!lines.length) return "";
  const b = (s: string) => Buffer.from(s, "utf8");
  if (lines.length === 1) return b(lines[0]).subarray(loc.col - 1, loc.endCol - 1).toString("utf8");
  lines[0] = b(lines[0]).subarray(loc.col - 1).toString("utf8");
  lines[lines.length - 1] = b(lines[lines.length - 1]).subarray(0, loc.endCol - 1).toString("utf8");
  return lines.join("\n");
}

/** 端點或連接埠的型別：寫成 ~X（共軛）時解析器不給型別，改從通用的關係讀名稱 */
function portDefOf(a: Analysis, e: Element, portDefs: Element[]): string | null {
  const direct = e.typeIds.find((t) => portDefs.some((p) => p.id === t));
  if (direct) return direct;
  const conj = a.elements.find((x) => e.typeIds.includes(x.id) && x.kind === "ConjugatedPortDefinition");
  if (conj?.owner) return conj.owner;
  const link = a.links.find((l) => l.from === e.id && l.kind === "type");
  const name = link?.toName.replace(/^~/, "").split("::").pop()?.replace(/^'|'$/g, "");
  return portDefs.find((p) => p.name === name)?.id ?? null;
}

export function portDefsOf(a: Analysis): PortDefInfo[] {
  return a.elements.filter((e) => e.kind === "PortDefinition" && isA(e, "InterfacePort")).map((e) => ({
    id: e.id, name: e.name, shortName: e.shortName, qualifiedName: e.qualifiedName, doc: e.doc, shared: e.shared,
    attrs: childrenOf(a, e.id).filter((c) => c.kind === "AttributeUsage").map((c) => {
      // 標準庫的型別不在解析結果的元素裡，名稱從通用的關係讀
      const written = c.types[0] ?? a.links.find((l) => l.from === c.id && l.kind === "type")?.toName ?? "";
      const t = TYPE_BY_NAME.get(written) ?? TYPE_BY_NAME.get(written.split("::").pop() ?? "");
      return { name: c.name, type: t?.id ?? written, unit: t?.unit ?? "" };
    }),
  }));
}

export function interfaceDefsOf(a: Analysis, texts: (e: Element) => string): InterfaceDefInfo[] {
  const ports = a.elements.filter((e) => e.kind === "PortDefinition");
  return a.elements.filter((e) => e.kind === "InterfaceDefinition" && isA(e, "Interface")).map((e) => {
    const kids = childrenOf(a, e.id);
    return {
      id: e.id, name: e.name, shortName: e.shortName, qualifiedName: e.qualifiedName, doc: e.doc, shared: e.shared,
      kind: kindOfValue(e.attrs.interfaceKind),
      ends: kids.filter((c) => c.kind === "PortUsage" && /\bend\b/.test(c.keyword ?? "")).map((c) => ({ name: c.name, portDef: portDefOf(a, c, ports) })),
      constraints: kids.filter((c) => c.kind === "AssertConstraintUsage").map((c) => {
        const t = texts(c);
        return { name: c.name, text: t.match(/\{([\s\S]*)\}\s*$/)?.[1]?.trim() ?? t };
      }),
      attrs: Object.fromEntries(Object.entries(e.attrs).map(([k, v]) => [k, clean(v)])),
    };
  });
}

/** 要請解析器求的值：每個介面的限制與兩端連接埠的每個屬性 */
export interface EvalPlan { exprs: { expr: string; subject: string }[]; index: { iface: string; what: "constraint" | "value"; end?: number; name: string }[] }

interface Usage { el: Element; owner: Element | undefined; def: InterfaceDefInfo | undefined; from: string[]; to: string[] }

function usagesOf(a: Analysis, defs: InterfaceDefInfo[]): Usage[] {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  return (a.connectors ?? []).filter((c) => c.kind === "interface" && c.id && byId.has(c.id)).map((c) => {
    const el = byId.get(c.id as string) as Element;
    return { el, owner: byId.get(el.owner ?? ""), def: defs.find((d) => el.typeIds.includes(d.id)), from: c.fromChain, to: c.toChain };
  }).filter((u) => u.def);
}

/** 介面所在的上層：定義或使用就當 subject，套件裡的用完整名稱 */
function scopeOf(u: Usage): { subject: string; prefix: string } {
  if (u.owner && u.owner.kind !== "Package" && u.owner.kind !== "LibraryPackage") return { subject: u.owner.qualifiedName, prefix: quote(u.el.name) };
  return { subject: "", prefix: u.el.qualifiedName.split("::").map(quote).join("::") };
}

export function planEval(a: Analysis, portDefs: PortDefInfo[], defs: InterfaceDefInfo[]): EvalPlan {
  const plan: EvalPlan = { exprs: [], index: [] };
  for (const u of usagesOf(a, defs)) {
    const d = u.def as InterfaceDefInfo;
    const { subject, prefix } = scopeOf(u);
    for (const c of d.constraints) {
      plan.exprs.push({ expr: `${prefix}.${quote(c.name)}`, subject });
      plan.index.push({ iface: u.el.id, what: "constraint", name: c.name });
    }
    d.ends.slice(0, 2).forEach((end, i) => {
      for (const attr of portDefs.find((p) => p.id === end.portDef)?.attrs ?? []) {
        plan.exprs.push({ expr: `${prefix}.${quote(end.name)}.${quote(attr.name)}`, subject });
        plan.index.push({ iface: u.el.id, what: "value", end: i, name: attr.name });
      }
    });
  }
  return plan;
}

const GIVEN = "GivenSpec";
export const isGiven = (e: Element | undefined) => !!e?.tags.includes(GIVEN);
const STRUCT = ["Subsystem", "Component", "ExternalEntity", "System"];

export function report(a: Analysis, texts: (e: Element) => string, plan: EvalPlan, results: Evaluated[], approvals: Record<string, { a?: Approval; b?: Approval }>): InterfaceReport {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const portDefs = portDefsOf(a);
  const defs = interfaceDefsOf(a, texts);
  const portEls = a.elements.filter((e) => e.kind === "PortDefinition");
  const interfaces: InterfaceInfo[] = usagesOf(a, defs).map((u) => {
    const d = u.def as InterfaceDefInfo;
    const mine = plan.index.map((x, i) => ({ ...x, r: results[i] })).filter((x) => x.iface === u.el.id);
    const constraints = d.constraints.map((c) => {
      const r = mine.find((x) => x.what === "constraint" && x.name === c.name)?.r;
      return { ...c, result: (r?.value === true ? "pass" : r?.value === false ? "fail" : "unknown") as "pass" | "fail" | "unknown", reason: r?.value === null ? r.reason : "" };
    });
    const endOf = (chain: string[], i: number): InterfaceEnd => {
      const part = byId.get(chain[0] ?? ""), port = byId.get(chain[chain.length - 1] ?? "");
      const pd = part ? byId.get(part.typeIds[0] ?? "") : undefined;
      return {
        end: d.ends[i]?.name ?? "", part: part?.id ?? null, partName: part?.name ?? "", partDef: pd?.id ?? null, partDefName: pd?.name ?? "",
        port: port?.id ?? null, portName: chain.length > 1 ? (port?.name ?? "") : "", portDef: port ? portDefOf(a, port, portEls) : null, given: isGiven(pd),
        values: mine.filter((x) => x.what === "value" && x.end === i).map((x) => ({ name: x.name, value: x.r?.value ?? null, unit: x.r?.unit ?? "", reason: x.r?.reason ?? "" })),
      };
    };
    const ends = [endOf(u.from, 0), endOf(u.to, 1)];
    const result = constraints.length === 0 || constraints.some((c) => c.result === "unknown") ? (constraints.some((c) => c.result === "fail") ? "fail" : "unknown")
      : constraints.every((c) => c.result === "pass") ? "pass" : "fail";
    // 變更的判斷：介面定義與這個介面的原始碼、兩端接到誰、兩端的數字。任何一項改了，先前的同意就失效
    const hash = createHash("sha256").update(JSON.stringify([d.id ? texts(byId.get(d.id) as Element) : "", texts(u.el), ends.map((e) => [e.partDef, e.portDef, e.values, e.port && byId.get(e.port) ? texts(byId.get(e.port) as Element) : ""])])).digest("hex").slice(0, 16);
    const ap = approvals[u.el.qualifiedName] ?? {};
    const okA = ap.a?.hash === hash ? ap.a : null, okB = ap.b?.hash === hash ? ap.b : null;
    const at = (k: string) => clean(u.el.attrs[k]) || d.attrs[k] || "";
    const kind = kindOfValue(u.el.attrs.interfaceKind) || d.kind;
    const verification: VerificationRow = {
      id: u.el.id, name: `${u.el.name}（${ends[0].partDefName || ends[0].partName} ↔ ${ends[1].partDefName || ends[1].partName}）`, source: "interface",
      verificationMethod: at("verificationMethod"), verificationOwner: at("verificationOwner"), verificationLevel: at("verificationLevel") || "次系統",
      owner: [at("ownerA"), at("ownerB")].filter(Boolean).join("、"), rationale: at("rationale"),
      result: result === "pass" ? "pass" : result === "fail" ? "fail" : "open",
    };
    return {
      id: u.el.id, name: u.el.name, qualifiedName: u.el.qualifiedName, owner: u.owner?.id ?? null, ownerName: u.owner?.name ?? "",
      def: d.id, defName: d.name, kind, kindZh: INTERFACE_KINDS[kind] ?? "未定", maturity: at("maturity") || "存在",
      ownerA: at("ownerA"), ownerB: at("ownerB"), ends, constraints, result, hash,
      approvals: { a: okA ?? null, b: okB ?? null }, agreed: !!(okA && okB), verification,
    };
  });

  const structural = a.elements.filter((e) => e.kind === "PartDefinition" && STRUCT.includes(e.category ?? ""));
  const parts = structural.filter((e) => e.category !== "System").map((e) => ({
    id: e.id, name: e.name, category: e.category, given: isGiven(e),
    ports: childrenOf(a, e.id).filter((c) => c.kind === "PortUsage").map((c) => ({ id: c.id, name: c.name, portDef: portDefOf(a, c, portEls), values: Object.fromEntries(Object.entries(c.attrs).map(([k, v]) => [k, clean(v)])) })),
  }));

  // N²：對角線是次系統（以及介面兩端出現的元件與外部對象），格子 (A, B) 是 A 端在 A、B 端在 B 的介面
  const used = new Set(interfaces.flatMap((i) => i.ends.map((e) => e.partDef).filter(Boolean) as string[]));
  const order = (e: Element) => ["Subsystem", "Component", "ExternalEntity", "System"].indexOf(e.category ?? "");
  const nodesEl = structural.filter((e) => e.category === "Subsystem" || used.has(e.id)).sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name, "zh-Hant"));
  const cells: Record<string, string[]> = {};
  for (const i of interfaces) {
    const [p, q] = i.ends.map((e) => e.partDef);
    if (!p || !q) continue;
    (cells[`${p}|${q}`] ??= []).push(i.id);
  }
  const n2: N2 = { nodes: nodesEl.map((e) => ({ id: e.id, name: e.name, category: e.category, given: isGiven(e) })), cells };

  // 外部提供的次系統：收到時檢查、確認適用於這次的用途與環境（SE Handbook 5.1.1.2.2）
  const givenRows: VerificationRow[] = structural.filter(isGiven).map((e) => ({
    id: e.id, name: `${e.name}：收到時檢查與適用性確認`, source: "given", verificationMethod: "inspect", verificationOwner: "", verificationLevel: "次系統",
    owner: clean(e.attrs.supplier), rationale: "外部提供：只管介面，規格當給定值；收到時檢查並確認適用於這次的用途與環境。", result: "open",
  }));

  const warnings: { id: string | null; text: string }[] = [];
  if (!interfaces.length) warnings.push({ id: null, text: "還沒有任何介面。次系統一分出來，就記下 A 和 B 之間有什麼介面，數字可以先暫定。" });
  for (const s of structural.filter((e) => e.category === "Subsystem" && !used.has(e.id))) warnings.push({ id: s.id, text: `「${s.name}」還沒有任何介面。` });
  for (const d of defs.filter((x) => !x.kind)) warnings.push({ id: d.id, text: `介面「${d.name}」還沒有定種類。` });
  for (const i of interfaces) {
    if (i.result === "fail") warnings.push({ id: i.id, text: `介面「${i.name}」兩端的數字對不上：${i.constraints.filter((c) => c.result === "fail").map((c) => c.name).join("、")}。` });
    if (!i.ownerA || !i.ownerB) warnings.push({ id: i.id, text: `介面「${i.name}」還沒有填兩端的負責人。` });
    else if (!i.agreed) warnings.push({ id: i.id, text: `介面「${i.name}」還沒有兩端都同意（${[!i.approvals.a && i.ownerA, !i.approvals.b && i.ownerB].filter(Boolean).join("、")} 待同意）。` });
  }
  // 外部提供的次系統只寫介面，不寫它的需求
  for (const g of structural.filter(isGiven)) {
    const reqs = a.relations.filter((r) => r.kind === "satisfy" && (r.from === g.id || byId.get(r.from)?.typeIds.includes(g.id)));
    if (reqs.length) warnings.push({ id: g.id, text: `「${g.name}」是外部提供的，只管介面、規格當給定值，不寫它的需求（目前有 ${reqs.length} 條滿足關係）。` });
  }

  return {
    kinds: INTERFACE_KINDS, maturity: MATURITY, methods: VERIFY_METHODS, levels: VERIFY_LEVELS, portTypes: PORT_TYPES,
    portDefs, interfaceDefs: defs, interfaces, parts, n2, verification: [...interfaces.map((i) => i.verification), ...givenRows], warnings,
  };
}

// ───────── 產生 SysML v2 文字 ─────────

const NAME_OK = (s: string, what: string) => {
  const t = String(s ?? "").trim();
  if (!t) throw new UserError(`請填${what}。`);
  if (/[\r\n'\\]/.test(t) || t.length > 80) throw new UserError(`${what}不能換行、不能有單引號或反斜線，最多 80 字。`);
  return t;
};
const str = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ").slice(0, 200)}"`;
const docLine = (s: string | undefined) => (s?.trim() ? [`doc /* ${s.replace(/\*\//g, "* /").trim()} */`] : []);
const qn = (q: string) => q.split("::").map(quote).join("::");

export interface PortDefInput { name: string; shortName?: string; doc?: string; attrs: { name: string; type: string }[] }
export function portDefText(n: PortDefInput, shortName: string, indent: string): string {
  const name = NAME_OK(n.name, "連接埠名稱");
  const seen = new Set<string>();
  const attrs = (n.attrs ?? []).map((x) => {
    const an = NAME_OK(x.name, "屬性名稱");
    if (seen.has(an)) throw new UserError(`屬性「${an}」重複。`);
    seen.add(an);
    const t = TYPE_BY_NAME.get(String(x.type ?? ""));
    if (!t) throw new UserError(`屬性「${an}」的型別不合法。`);
    return `attribute ${quote(an)} : ${t.id};`;
  });
  const body = [...docLine(n.doc), ...attrs];
  const head = `port def <'${shortName}'> ${quote(name)} :> InterfacePort`;
  return body.length ? `${indent}${head} {\n${body.map((l) => `${indent}    ${l}\n`).join("")}${indent}}\n` : `${indent}${head};\n`;
}

export interface InterfaceDefInput {
  name: string; doc?: string; kind: string; maturity?: string;
  ends: { name: string; portDef: string }[]; constraints?: { name: string; text: string }[];
  ownerA?: string; ownerB?: string; verificationMethod?: string; verificationOwner?: string; verificationLevel?: string; rationale?: string;
}
const EXPR_BAD = /[{};]|\/\*|\*\/|\/\//;
/** 式子裡的中文名稱自動加單引號（SysML v2 的名稱只有英文字母、數字、底線可以不加）；引號裡的不動 */
export function quoteNames(expr: string): string {
  return expr.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/).map((seg, i) =>
    i % 2 ? seg : seg.replace(/[\p{L}_][\p{L}\p{N}_]*/gu, (w) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(w) ? w : `'${w}'`))).join("");
}
export function interfaceDefText(n: InterfaceDefInput, shortName: string, portDefs: PortDefInfo[], indent: string): string {
  const name = NAME_OK(n.name, "介面名稱");
  if (!INTERFACE_KINDS[n.kind]) throw new UserError("請選介面種類（機械、熱、電、流體、資料、人）。");
  if ((n.ends ?? []).length !== 2) throw new UserError("介面要有兩端。");
  const ends = n.ends.map((e, i) => {
    const en = NAME_OK(e.name, `第 ${i + 1} 端的名稱`);
    const pd = portDefs.find((p) => p.id === e.portDef || p.qualifiedName === e.portDef);
    if (!pd) throw new UserError(`第 ${i + 1} 端要選一個連接埠定義。`);
    return `end ${quote(en)} : ${qn(pd.qualifiedName)};`;
  });
  if (n.ends[0].name.trim() === n.ends[1].name.trim()) throw new UserError("兩端的名稱不能相同。");
  if (n.maturity && !MATURITY.includes(n.maturity)) throw new UserError("成熟度只能是存在、暫定、凍結。");
  if (n.verificationMethod && !VERIFY_METHODS[n.verificationMethod]) throw new UserError("驗證方法只能是檢查、展示、分析、測試。");
  if (n.verificationLevel && !VERIFY_LEVELS.includes(n.verificationLevel)) throw new UserError("驗證層級只能是系統、次系統、元件。");
  const attrs: string[] = [`attribute :>> interfaceKind = JRI::InterfaceKind::${n.kind};`];
  for (const k of ["maturity", "ownerA", "ownerB", "verificationMethod", "verificationOwner", "verificationLevel", "rationale"] as const) {
    const v = String(n[k] ?? "").trim();
    // 成熟度與負責人寫成預設值，單一介面可以蓋過（SysML v2 的 = 是固定值，不能再重定義）
    if (v) attrs.push(`attribute :>> ${k} ${["maturity", "ownerA", "ownerB"].includes(k) ? "default " : ""}= ${str(v)};`);
  }
  const seen = new Set<string>();
  const cons = (n.constraints ?? []).filter((c) => String(c.text ?? "").trim()).map((c) => {
    const cn = NAME_OK(c.name, "限制名稱");
    if (seen.has(cn)) throw new UserError(`限制「${cn}」重複。`);
    seen.add(cn);
    const t = quoteNames(String(c.text).trim().replace(/\s+/g, " "));
    if (EXPR_BAD.test(t) || t.length > 300) throw new UserError(`限制「${cn}」的式子不能有大括號、分號或註解，最多 300 字。`);
    return `assert constraint ${quote(cn)} { ${t} }`;
  });
  const body = [...docLine(n.doc), ...attrs, ...ends, ...cons];
  return `${indent}interface def <'${shortName}'> ${quote(name)} :> Interface {\n${body.map((l) => `${indent}    ${l}\n`).join("")}${indent}}\n`;
}

/** 連接埠的使用（放在次系統或元件的定義裡），帶兩端要對的數字。數字沒寫單位時補上型別的預設單位 */
export function portUsageText(name: string, portDef: PortDefInfo, values: Record<string, string>, indent: string): string {
  const pn = NAME_OK(name, "連接埠名稱");
  const lines: string[] = [];
  for (const attr of portDef.attrs) {
    const raw = String(values?.[attr.name] ?? "").trim();
    if (!raw) continue;
    lines.push(`attribute :>> ${quote(attr.name)} = ${valueText(raw, attr)};`);
  }
  const head = `port ${quote(pn)} : ${qn(portDef.qualifiedName)}`;
  return lines.length ? `${indent}${head} {\n${lines.map((l) => `${indent}    ${l}\n`).join("")}${indent}}\n` : `${indent}${head};\n`;
}

export function valueText(raw: string, attr: PortAttr): string {
  const t = attr.type.split("::").pop();
  if (t === "String") return str(raw);
  if (t === "Boolean") {
    if (!/^(true|false)$/.test(raw)) throw new UserError(`「${attr.name}」只能填 true 或 false。`);
    return raw;
  }
  const m = raw.match(/^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(?:\[\s*([A-Za-z0-9*/^°·.\s]+?)\s*\])?$/);
  if (!m) throw new UserError(`「${attr.name}」要填數字${attr.unit ? `（單位預設 ${attr.unit}，也可以寫成 5 [${attr.unit}]）` : ""}。`);
  if (t === "Integer") {
    if (!/^-?\d+$/.test(m[1])) throw new UserError(`「${attr.name}」要填整數。`);
    return m[1];
  }
  const num = /[.eE]/.test(m[1]) ? m[1] : `${m[1]}.0`;
  const unit = m[2] ?? attr.unit;
  return unit ? `${num} [${unit}]` : num;
}

/** 介面的使用：在系統（或上層）定義裡把兩個零件的連接埠接起來 */
export function interfaceUsageText(name: string, def: InterfaceDefInfo, from: [string, string], to: [string, string], indent: string): string {
  const n = NAME_OK(name, "介面名稱");
  return `${indent}interface ${quote(n)} : ${qn(def.qualifiedName)} connect ${quote(from[0])}.${quote(from[1])} to ${quote(to[0])}.${quote(to[1])};\n`;
}
