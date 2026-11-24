// 計算器（ANA-09）：不自己寫算式，全部交給解析器的 instantiate 求值，連單位換算也由解析器做。
// 作法：把算式放進一個暫時的零件（scratch），instantiate 後讀屬性值。
import { parserConnection } from "./engine.ts";
import type { Source } from "./engine.ts";
import { UserError } from "./projects.ts";

export interface Quantity {
  /** 以模型宣告的單位表示的數值（例如 600 [cm] 為 600） */
  value: number;
  unit: string;
  /** 換成基本單位後的數值（質量以 g、長度以 m 為基準；僅供同量綱比較） */
  base: number;
  dim: string;
}
export type Val = Quantity | { kind: "number"; value: number } | { kind: "boolean"; value: boolean } | { kind: "string"; value: string };

const SCRATCH_FILE = "__scratch.sysml";
const IMPORTS = ["ScalarValues", "ISQ", "SI", "QuantityCalculations"];
const NAME = /^(?:[A-Za-z_][A-Za-z0-9_]*|'[^']+')(?:::(?:[A-Za-z_][A-Za-z0-9_]*|'[^']+'))*$/;

const unitName = (u: string) => u.replace(/^[A-Za-z]+::/, "").replace(/^'(.*)'$/, "$1");

/** 把解析器回傳的值整理成簡單的物件；不認得的種類回傳 null。 */
export function decode(v: any): Val | null {
  if (!v || typeof v !== "object") return null;
  const num = (m: any) => (m && (typeof m.value === "number" || typeof m.value === "bigint") ? Number(m.value) : null);
  if (v.kind === "quantity") {
    const value = num(v.magnitude);
    if (value === null) return null;
    const t = v.unitTerm;
    const scale = t ? Number(t.scaleNum) / Number(t.scaleDen || 1) : 1;
    return { value, unit: unitName(String(v.unit ?? "")), base: value * scale, dim: JSON.stringify((t?.factors ?? []).map((f: any) => [String(f.unitId).replace(/^SI::/, ""), f.exponent])) };
  }
  if (v.kind === "real" || v.kind === "integer") { const n = num(v); return n === null ? null : { kind: "number", value: n }; }
  if (v.kind === "boolean") return { kind: "boolean", value: !!v.value };
  if (v.kind === "string") return { kind: "string", value: String(v.value ?? "") };
  return null;
}

/** 質量換成 kg（算預算用）。不是質量就回傳 null。 */
export function massKg(v: Val | undefined): number | null {
  return v && "dim" in v && v.dim === JSON.stringify([["gram", 1]]) ? v.base / 1000 : null;
}

function diagMessages(model: any, file?: string): string[] {
  return (model.diagnostics as any[]).filter((d) => d.severity === "error" && (!file || d.file === file)).map((d) => String(d.message));
}

/** 取一個零件實例所有屬性的值（含單位換算）。找不到或有誤會丟 UserError。 */
export async function instanceValues(sources: readonly Source[], qualifiedName: string): Promise<Record<string, Val>> {
  const c = await parserConnection();
  const model = await c.parseSources(sources.map(([n, s]) => [n, s] as const));
  let tree;
  try { tree = await model.instantiate(qualifiedName); } catch (e) { throw new UserError(`找不到可求值的實例：${qualifiedName}（${(e as Error).message}）`); }
  return valuesOf(tree.root);
}
function valuesOf(inst: { features: ReadonlyMap<string, any> }): Record<string, Val> {
  const out: Record<string, Val> = {};
  for (const [k, f] of inst.features) {
    if (f?.kind !== "single") continue;
    const d = decode(f.value);
    if (d) out[k] = d;
  }
  return out;
}

/** 求一個算式的值。例：evalExpr(sources, "RailExit(50 ['m/s²'], 600 [cm])", ["Project"])。 */
export async function evalExpr(sources: readonly Source[], expr: string, imports: string[] = []): Promise<Val> {
  const text = expr.trim();
  if (!text || text.length > 500 || /[;{}]/.test(text)) throw new UserError("算式不能是空的、超過 500 字，也不能含分號或大括號。");
  if (imports.length > 20 || imports.some((i) => !NAME.test(i))) throw new UserError("匯入的套件名稱不合法。");
  const pkg = `package ScratchCalc {\n${[...IMPORTS, ...imports].map((i) => `  private import ${i}::*;`).join("\n")}\n  part scratch { attribute r = ${text}; }\n}\n`;
  const c = await parserConnection();
  const model = await c.parseSources([...sources.map(([n, s]) => [n, s] as const), [SCRATCH_FILE, pkg] as const]);
  const errs = diagMessages(model, SCRATCH_FILE);
  if (errs.length) throw new UserError(`算式有誤：${[...new Set(errs)].join("；")}`);
  const f = (await model.instantiate("ScratchCalc::scratch")).root.get("r");
  if (!f || f.kind === "error") throw new UserError(`算式無法求值：${f?.kind === "error" ? f.error : "沒有結果"}`);
  const d = f.kind === "single" ? decode(f.value) : null;
  if (!d) throw new UserError("算式的結果不是數值。");
  return d;
}

/** 用引數呼叫模型裡的 calc def。引數是 { value, unit }，單位寫法同 edits.ts 的 unitLiteral。 */
export async function evalCalc(sources: readonly Source[], calcName: string, args: { value: number; unit: string }[], imports: string[] = []): Promise<Val> {
  if (!NAME.test(calcName)) throw new UserError("calc 名稱不合法。");
  const parts = args.map((a) => {
    if (!Number.isFinite(a.value)) throw new UserError("引數必須是有限的數字。");
    return `${a.value}${unitText(a.unit)}`;
  });
  return evalExpr(sources, `${calcName}(${parts.join(", ")})`, imports);
}

function unitText(u: string): string {
  const t = u.trim();
  if (!t) return "";
  if (!/^[A-Za-z0-9/*^·⋅²³._-]{1,20}$/.test(t)) throw new UserError("單位寫法不合法，例如 kg、mm、m/s、N*s。");
  const n = t.replace(/[*·]/g, "⋅").replace(/\^2/g, "²").replace(/\^3/g, "³");
  return /[/⋅²³]/.test(n) ? ` ['${n}']` : ` [${n}]`;
}

// ───────── 條件判定（assert constraint） ─────────

export interface ConstraintVerdict { condition: string; status: "holds" | "fails" | "undecided" }
/** 檢查實例上所有 assert constraint；超過上限之類的情況會是 fails。 */
export async function checkInstance(sources: readonly Source[], qualifiedName: string): Promise<ConstraintVerdict[]> {
  const c = await parserConnection();
  const model = await c.parseSources(sources.map(([n, s]) => [n, s] as const));
  const v: any = await model.validateInstance(qualifiedName);
  const out: ConstraintVerdict[] = [];
  for (const x of v.verdicts ?? []) {
    const st = String(x.verdict?.status ?? x.verdict?.kind ?? "");
    out.push({ condition: String(x.verdict?.condition ?? ""), status: /holds|satisf/.test(st) ? "holds" : /viol|fail/.test(st) ? "fails" : "undecided" });
  }
  return out;
}

// ───────── 質量預算（ANA-11） ─────────

export interface BudgetRow {
  /** 持有上限的零件實例（完整限定名） */
  element: string;
  name: string;
  limitKg: number;
  /** 子項質量加總；子項沒有 mass 時用它自己的子項加總 */
  sumKg: number;
  marginKg: number;
  status: "PASS" | "FAIL";
  items: { name: string; massKg: number | null; note?: string }[];
}
const LIMIT_ATTRS = ["massLimit", "massBudget"];
const MASS_ATTRS = ["mass", "dryMass"];

/** 掃描所有頂層零件實例。零件有 massLimit（或 massBudget）屬性，就把它的子項質量（mass，沒有則 dryMass）加總，和上限比較；超過判 FAIL。 */
export async function massBudget(sources: readonly Source[], usages: string[]): Promise<BudgetRow[]> {
  const c = await parserConnection();
  const model = await c.parseSources(sources.map(([n, s]) => [n, s] as const));
  const rows: BudgetRow[] = [];
  for (const qn of usages) {
    let tree;
    try { tree = await model.instantiate(qn); } catch { continue; }
    const byId = new Map<string, any>();
    for (const i of tree.all) byId.set(String(i.id), i);
    byId.set(String(tree.root.id), tree.root);
    const label = (i: any) => String(i.typeId).split("::").pop() ?? "";
    const own = (i: any) => { const v = valuesOf(i); for (const k of MASS_ATTRS) { const m = massKg(v[k]); if (m !== null) return m; } return null; };
    const kids = (i: any): any[] => {
      const f = i.features.get("subparts");
      return f?.kind === "many" ? f.values.filter((v: any) => v.kind === "instance").map((v: any) => byId.get(String(v.id))).filter(Boolean) : [];
    };
    // 子項有自己的質量就用；沒有就往下加總它的子項
    const total = (i: any): { kg: number | null } => {
      const m = own(i);
      if (m !== null) return { kg: m };
      const ks = kids(i);
      const parts = ks.map((k) => total(k).kg).filter((x): x is number => x !== null);
      return { kg: parts.length ? parts.reduce((a, b) => a + b, 0) : null };
    };
    const walk = (i: any, path: string) => {
      const vals = valuesOf(i);
      const limit = LIMIT_ATTRS.map((k) => massKg(vals[k])).find((x) => x !== null) ?? null;
      if (limit !== null) {
        const items = kids(i).map((k) => { const t = total(k).kg; return { name: label(k), massKg: t, ...(t === null ? { note: "沒有質量，未計入" } : {}) }; });
        const sum = items.reduce((a, b) => a + (b.massKg ?? 0), 0);
        rows.push({ element: path, name: label(i), limitKg: limit, sumKg: sum, marginKg: limit - sum, status: sum <= limit ? "PASS" : "FAIL", items });
      }
      for (const k of kids(i)) walk(k, `${path}::${label(k)}`);
    };
    walk(tree.root, qn);
  }
  return rows;
}

// ───────── 判定總覽（ANA-06） ─────────

export interface VerdictTerm { attribute: string; op: string; threshold: string; value: number | null; unit: string; margin: number | null }
export interface VerdictRow {
  requirement: string; name: string; qualifiedName: string; subject: string;
  status: "holds" | "fails" | "undecided";
  /** 條件原文 */
  condition: string;
  terms: VerdictTerm[];
  /** 第一項的算出值與單位；沒有實例或算不出時是 null */
  value: number | null; unit: string;
  /** 各項中最小的餘裕（單位同算出值）；負值代表未達標 */
  margin: number | null;
  /** 算出值從哪裡來 */
  source: string;
  note: string;
}
export interface VerdictInput {
  elements: { id: string; kind: string; name: string; shortName: string | null; qualifiedName: string; file: string; line: number | null; endLine: number | null }[];
  satisfaction: { requirement: string; subject: string; status: string }[];
  readCondition: (file: string, el: any) => Promise<{ param: string; expr: string } | null>;
  /** 模擬的寫回對應與結果；用來標示數值來源 */
  bindings: { output: string; element: string; attribute: string }[];
  simAt: { engine: string; at: string } | null;
}
const TERM = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|>|<)\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?\s*(?:\[[^\]]+\]|\['[^']+'\])?)\s*$/;

export async function buildVerdicts(sources: readonly Source[], inp: VerdictInput): Promise<VerdictRow[]> {
  const rows: VerdictRow[] = [];
  const cache = new Map<string, Record<string, Val> | string>();
  const valuesOf2 = async (qn: string) => {
    if (!cache.has(qn)) cache.set(qn, await instanceValues(sources, qn).catch((e: Error) => e.message));
    return cache.get(qn)!;
  };
  for (const el of inp.elements) {
    if (!/RequirementUsage$/.test(el.kind)) continue;
    const cond = await inp.readCondition(el.file, el);
    if (!cond?.expr) continue;
    const sat = inp.satisfaction.find((x) => x.requirement === el.qualifiedName || x.requirement === el.id);
    const subject = sat?.subject ?? "";
    const row: VerdictRow = {
      requirement: el.shortName ?? el.name, name: el.name, qualifiedName: el.qualifiedName, subject,
      status: (sat?.status as VerdictRow["status"]) ?? "undecided", condition: cond.expr, terms: [], value: null, unit: "", margin: null, source: "", note: sat ? "" : "沒有滿足者（satisfy），無法判定",
    };
    const vals = subject ? await valuesOf2(subject) : undefined;
    for (const part of cond.expr.split(/\s+and\s+/)) {
      const m = TERM.exec(part.trim());
      if (!m) { row.note ||= "條件寫法較複雜，只顯示判定結果"; continue; }
      const [, , attribute, op, thText] = m;
      const term: VerdictTerm = { attribute, op, threshold: thText.replace(/\s+/g, " ").trim(), value: null, unit: "", margin: null };
      const got = typeof vals === "object" ? vals[attribute] : undefined;
      if (got && "unit" in got) {
        term.value = got.value; term.unit = got.unit;
        try {
          const th = await evalExpr(sources, thText);
          if ("dim" in th && th.dim === got.dim) {
            const scale = got.value !== 0 ? got.base / got.value : th.value !== 0 ? th.base / th.value : 1;
            const diff = op === ">=" || op === ">" ? got.base - th.base : op === "<=" || op === "<" ? th.base - got.base : -Math.abs(got.base - th.base);
            term.margin = diff / scale;
          }
        } catch { /* 門檻算不出來就不顯示餘裕 */ }
      } else if (typeof vals === "string") row.note ||= `取不到實例的值：${vals}`;
      row.terms.push(term);
    }
    const first = row.terms[0];
    if (first) { row.value = first.value; row.unit = first.unit; }
    const margins = row.terms.map((t) => t.margin).filter((x): x is number => x !== null);
    row.margin = margins.length ? Math.min(...margins) : null;
    if (first && subject) {
      const bound = inp.bindings.some((b) => b.element === subject && b.attribute === first.attribute);
      row.source = bound && inp.simAt ? `模擬（${inp.simAt.engine}，${inp.simAt.at.slice(0, 16).replace("T", " ")}）寫回 ${subject.split("::").pop()}.${first.attribute}` : `模型屬性 ${subject.split("::").pop()}.${first.attribute}`;
    }
    rows.push(row);
  }
  return rows;
}

// ───────── 約束圖（ANA-08） ─────────
// 約束線從需求的數值條件讀（用判定總覽的條件拆解），門檻交給解析器求值（含單位換算）。
// 約束圖是概念設計參考，不計入驗證矩陣；pass／fail 只由 constraint 與模擬決定。

export type ChartMetric = "apogee" | "accel" | "rail" | "q" | "speed";
export interface ChartLimit {
  metric: ChartMetric;
  op: ">=" | "<=";
  /** SI 基本單位的門檻（m、m/s²、m/s、Pa） */
  value: number;
  /** 模型裡寫的原文，例如 2850 [m] */
  text: string;
  requirement: string;
  name: string;
}
const METRIC_BY_ATTR: Record<string, ChartMetric> = {
  apogee: "apogee", maxapogee: "apogee", altitude: "apogee",
  maxacceleration: "accel", maxaccel: "accel", maxaxialacceleration: "accel",
  railexitspeed: "rail", railexitvelocity: "rail", railspeed: "rail", liftoffspeed: "rail",
  maxdynamicpressure: "q", maxq: "q", dynamicpressure: "q",
  maxspeed: "speed", maxvelocity: "speed",
};
const CHART_DIM: Record<ChartMetric, Record<string, number>> = {
  apogee: { metre: 1 }, accel: { metre: 1, second: -2 }, rail: { metre: 1, second: -1 }, speed: { metre: 1, second: -1 }, q: { gram: 1, metre: -1, second: -2 },
};
export const chartMetricOf = (attribute: string): ChartMetric | null => METRIC_BY_ATTR[attribute.toLowerCase()] ?? null;

/** 把判定總覽的條件項變成約束線；只收一維彈道會算的量（遠地點、加速度、離軌速度、動壓、最大速度）。 */
export async function chartLimits(sources: readonly Source[], rows: Pick<VerdictRow, "requirement" | "name" | "terms">[]): Promise<ChartLimit[]> {
  const out: ChartLimit[] = [];
  for (const r of rows) for (const t of r.terms) {
    const metric = chartMetricOf(t.attribute);
    const op = t.op === ">=" || t.op === ">" ? ">=" : t.op === "<=" || t.op === "<" ? "<=" : null;
    if (!metric || !op) continue;
    try {
      const th = await evalExpr(sources, t.threshold);
      if (!("dim" in th)) continue;
      // 量綱要符合：長度、加速度、速度、壓力。基本單位的質量用 g，壓力要換回 kg。（模型裡的 g 是公克，不是 g 力）
      const dims = Object.fromEntries(JSON.parse(th.dim) as [string, number][]);
      const norm = (o: Record<string, number>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
      if (norm(dims) !== norm(CHART_DIM[metric])) continue;
      const gram = dims.gram ?? 0;
      out.push({ metric, op, value: th.base / Math.pow(1000, gram), text: t.threshold, requirement: r.requirement, name: r.name });
    } catch { /* 門檻算不出來就不畫這條線 */ }
  }
  return out;
}
