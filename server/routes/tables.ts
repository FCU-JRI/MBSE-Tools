import type { Express } from "express";
import { createHash } from "node:crypto";
import { connect } from "@openmbee/opensysml";
import * as store from "../projects.ts";
import { wrap, pid } from "./common.ts";

/** 表格頁「公式」：模型裡的 constraint 與 calc（含寫在需求裡、沒有名字的 require constraint）。唯讀。 */
export interface Formula {
  id: string;
  kind: "constraint" | "calc";
  /** true：定義（constraint def / calc def），沒有代入設計值，不判定 */
  def: boolean;
  name: string;
  /** 所屬元素（需求或套件）的完整名稱 */
  owner: string;
  /** 右欄要顯示屬性的元素 id：有名字的就是它自己，沒名字的用所屬元素；找不到為 null */
  selectId: string | null;
  expr: string;
  inputs: string[];
  /** holds | fails | undecided | definition */
  status: string;
}

type Raw = Record<string, any>;
const ref = (v: any): string | null => (v && typeof v === "object" && "@id" in v ? v["@id"] : null);
const refs = (v: any): string[] => (Array.isArray(v) ? v.map(ref).filter(Boolean) as string[] : ref(v) ? [ref(v) as string] : []);
const KINDS: Record<string, [Formula["kind"], boolean]> = { ConstraintUsage: ["constraint", false], ConstraintDefinition: ["constraint", true], CalculationUsage: ["calc", false], CalculationDefinition: ["calc", true] };

let conn: Awaited<ReturnType<typeof connect>> | undefined;
const cache = new Map<string, Formula[]>();

/** 解析器回報的欄位以 UTF-8 位元組計、從 1 起算 */
function slice(lines: string[], l: { line: number; col: number; endLine: number; endCol: number }): string {
  const out: string[] = [];
  for (let n = l.line; n <= l.endLine; n++) {
    const b = Buffer.from(lines[n - 1] ?? "", "utf8");
    out.push(b.subarray(n === l.line ? l.col - 1 : 0, n === l.endLine ? l.endCol - 1 : b.length).toString("utf8"));
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

export async function formulasOf(id: string): Promise<Formula[]> {
  const analysis = await store.analyzeProject(id);
  if (!analysis.ok) return [];
  const sources = await store.sources(id);
  const key = createHash("sha256").update(JSON.stringify(sources)).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;
  conn ??= await connect();
  const model = await conn.parseSources(sources.map(([n, s]) => [n, s] as const));
  const raw = (JSON.parse((await model.toApiJson()).content) as Raw[]).map((e) => e.payload ?? e);
  const byId = new Map(raw.map((e) => [e["@id"], e]));
  const lines = new Map(sources.map(([n, s]) => [n, s.split("\n")]));
  const fileOf = (e: Raw | undefined): string => { for (let i = 0; e && i < 40; i++) { if (e["sysx:sourceDocument"]) return String(e["sysx:sourceDocument"]); e = byId.get(ref(e.owner) ?? ""); } return ""; };
  const locOf = (e: Raw) => (e["sysx:sourceLine"] && e["sysx:sourceEndLine"] ? { line: e["sysx:sourceLine"], col: e["sysx:sourceColumn"] ?? 1, endLine: e["sysx:sourceEndLine"], endCol: e["sysx:sourceEndColumn"] ?? 1 } : null);
  const named = new Map(analysis.elements.map((e) => [e.id, e]));
  const sat = new Map(analysis.satisfaction.map((s) => [s.requirement, s.status]));
  /** 算式裡出現的輸入：特徵參照與鏈（r.apogee），不含 [m] 後面的單位 */
  const inputsOf = (id: string, out: Set<string>, unit = false): void => {
    const e = byId.get(id);
    if (!e) return;
    const t = e["@type"];
    if (t === "FeatureChainExpression" || t === "FeatureReferenceExpression") { if (!unit && e["sysx:sourceText"]) out.add(String(e["sysx:sourceText"])); return; }
    const args = refs(e.argument);
    args.forEach((a, i) => inputsOf(a, out, e.operator === "[" && i === 1));
  };
  const out: Formula[] = [];
  for (const e of raw) {
    const k = KINDS[e["@type"]];
    if (!k) continue;
    const file = fileOf(e), l = locOf(e);
    if (!file || !l || file === "JRI.sysml" || !analysis.elements.some((x) => x.file === file && !x.shared) && !named.has(e["@id"])) continue;
    const ownerId = ref(e.owner) ?? "";
    const own = named.get(ownerId);
    if (own?.shared) continue;
    const self = named.get(e["@id"]);
    const inputs = new Set<string>();
    // 用法：從結果運算式取輸入；定義：取 in 參數
    for (const m of refs(e.ownedMember)) {
      const c = byId.get(m);
      if (c?.direction === "in" && c.declaredName) inputs.add(String(c.declaredName));
    }
    for (const m of refs(e.ownedRelationship)) {
      const r = byId.get(m);
      if (r?.["@type"] === "ResultExpressionMembership") for (const x of refs(r.ownedMemberElement)) inputsOf(x, inputs);
    }
    const ownerStatus = own ? sat.get(own.qualifiedName) : undefined;
    out.push({
      id: e["@id"], kind: k[0], def: k[1], name: self?.name ?? "", owner: own?.qualifiedName ?? "",
      selectId: self?.id ?? own?.id ?? null,
      expr: slice(lines.get(file) ?? [], l), inputs: [...inputs],
      status: k[1] ? "definition" : k[0] === "constraint" ? ownerStatus ?? "undecided" : "undecided",
    });
  }
  if (cache.size > 50) cache.clear();
  cache.set(key, out);
  return out;
}

export function mount(app: Express): void {
  app.get("/api/projects/:id/formulas", wrap(async (req, res) => res.json({ formulas: await formulasOf(pid(req)) })));
}
