// 衝突偵測（FW-05）與核可後變更（FW-09）。衝突不存成元素：每次對頂層零件實例跑解析器的 validateInstance，
// 把判為不成立的 assert constraint 整理成清單；介面兩端不合與預算超過都是這種 assert。
// 裁決（FW-06）留成 DesignDecision，doc 裡帶 [conflict:鍵]，並用 #trace 連到衝突的介面（或零件）與受影響的需求。
import { createHash } from "node:crypto";
import { connect } from "@openmbee/opensysml";
import { analyze } from "./engine.ts";
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";
import * as store from "./projects.ts";
import { analyzeAt } from "./versions.ts";

export interface Conflict {
  key: string;
  kind: "interface" | "budget";
  /** 衝突所在的元素（介面或有預算的零件）；找不到對應元素時為 null */
  elementId: string | null;
  name: string;
  shortName: string | null;
  top: string; // 判出衝突的頂層零件實例
  condition: string; // 不成立的式子，例如 diameterA == diameterB
  values: { name: string; value: string }[]; // 式子裡用到的屬性與現值
  suggestions: string[]; // 建議連結的需求（與衝突元素有關係的需求）的 id
  decision: { id: string; name: string; shortName: string | null; decidedBy: string; decidedOn: string; rationale: string } | null;
}

let connection: Awaited<ReturnType<typeof connect>> | undefined;
const conn = async () => (connection ??= await connect());

const isReq = (e: Element) => /RequirementUsage$/.test(e.kind);
export const conflictKey = (qn: string, condition: string, values: string) => createHash("sha1").update(`${qn}|${condition}|${values}`).digest("hex").slice(0, 10);
const MARK = /\[conflict:([0-9a-f]{10})\]/;

/** 頂層零件實例：直接放在套件裡的 part usage（非共用元件庫）。次系統的判定都包含在頂層實例裡。 */
const tops = (a: Analysis) => a.elements.filter((e) => e.kind === "PartUsage" && !e.shared && a.elements.find((o) => o.id === e.owner)?.kind === "Package");

/** 對每個頂層零件實例跑 validateInstance，回傳不成立的 assert constraint 整理成的衝突清單（含已裁決者）。 */
export async function detectConflicts(id: string): Promise<{ ok: boolean; conflicts: Conflict[]; note?: string }> {
  const srcs = await store.sources(id);
  const a = await analyze(srcs, await store.listShared());
  if (!a.ok) return { ok: false, conflicts: [], note: "模型目前有錯誤，無法判定衝突。" };
  const model = await (await conn()).parseSources(srcs.map(([n, s]) => [n, s] as const));
  const byQn = new Map(a.elements.map((e) => [e.qualifiedName, e]));
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const decided = new Map<string, Element>();
  for (const e of a.elements) if (e.category === "DesignDecision") { const m = e.doc.match(MARK); if (m) decided.set(m[1], e); }
  const out = new Map<string, Conflict>();
  for (const top of tops(a)) {
    let v;
    try { v = await model.validateInstance(top.qualifiedName); } catch { continue; }
    for (const { verdict } of v.verdicts as any[]) {
      if (normalize(String(verdict?.status ?? verdict?.kind ?? "")) !== "fails") continue;
      const qn = String(verdict.subject?.instanceTypeId ?? "");
      const condition = String(verdict.condition ?? "");
      const el = byQn.get(qn) ?? null;
      const values = el ? valuesOf(el, condition, byId) : [];
      const key = conflictKey(qn, condition, values.map((x) => `${x.name}=${x.value}`).join(","));
      if (out.has(key)) continue;
      const kind = el?.kind === "InterfaceUsage" ? "interface" : "budget";
      const d = decided.get(key);
      out.set(key, {
        key, kind, elementId: el?.id ?? null, name: el?.name ?? qn.split("::").pop() ?? qn, shortName: el?.shortName ?? null, top: top.name, condition, values,
        suggestions: el ? related(a, el) : [],
        decision: d ? { id: d.id, name: d.name, shortName: d.shortName, decidedBy: d.attrs.decidedBy ?? "", decidedOn: d.attrs.decidedOn ?? "", rationale: d.attrs.rationale ?? "" } : null,
      });
    }
  }
  return { ok: true, conflicts: [...out.values()] };
}

function normalize(s: string): string {
  return s === "violated" || s === "fails" || s === "failed" ? "fails" : s;
}

/** 式子裡出現的名稱，到衝突元素（或它的上一層）的屬性找現值。 */
function valuesOf(el: Element, condition: string, byId: Map<string, Element>): { name: string; value: string }[] {
  const names = [...new Set(condition.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])];
  const scopes = [el, ...el.typeIds.map((t) => byId.get(t)), byId.get(el.owner ?? "")].filter((x): x is Element => !!x);
  return names.flatMap((n) => { const s = scopes.find((x) => x.attrs[n] !== undefined); return s ? [{ name: n, value: s.attrs[n] }] : []; });
}

/** 與衝突元素（含上一層、介面兩端的零件）有關係的需求。 */
function related(a: Analysis, el: Element): string[] {
  const own = new Set([el.id, el.owner ?? ""]);
  for (const r of a.relations) if (r.kind === "connect" && (r.from === el.id || r.to === el.id)) { own.add(r.from); own.add(r.to); }
  const reqs = new Set(a.elements.filter(isReq).map((e) => e.id));
  const out = new Set<string>();
  for (const r of a.relations) {
    if (own.has(r.from) && reqs.has(r.to)) out.add(r.to);
    if (own.has(r.to) && reqs.has(r.from)) out.add(r.from);
  }
  return [...out];
}

/** FW-09：最近一次未撤回的節點核可，當時已存在的需求與介面的鍵。送審差異裡這些項目被修改或移除就標「核可後變更」。 */
export async function approvedBaseline(id: string): Promise<{ gate: string; at: string; by: string; keys: string[] } | null> {
  const p = await store.readProject(id.split("@")[0]);
  const revoked = new Set(p.signoffs.filter((s) => s.decision === "REVOKE").map((s) => s.revokes));
  const last = [...p.signoffs].reverse().find((s) => s.decision === "APPROVE" && !revoked.has(s.at));
  if (!last) return null;
  const an = await analyzeAt(store.dirOf(id.split("@")[0]), last.commit).catch(() => null);
  if (!an?.ok) return null;
  const keys = an.elements.filter((e) => !e.shared && (isReq(e) || e.kind === "InterfaceUsage")).map((e) => e.shortName ?? e.qualifiedName);
  return { gate: last.gate, at: last.at, by: last.by, keys };
}
