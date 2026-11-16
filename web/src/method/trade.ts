// P6 方案比較（METHOD.md 第 6 節、NASA SE Handbook 6.8）：由模型算出決策矩陣。純函式，伺服器與網頁共用。
//
// 模型的寫法（library/JRI.sysml 的 P6 區塊）：
//   item <'TRD-001'> '推進方案比較' : DecisionMatrix {
//       :>> question = "...";
//       item <'ALT-001'> '固態馬達' : Alternative {
//           :>> status = "selected";
//           item 'CRIT-001' : CriterionScore { :>> score = 1.0; :>> basis = "..."; }
//       }
//   }
//   item <'CRIT-001'> '推重比' : Criterion { :>> kind = "must"; :>> aspect = "performance"; }
//   #trace dependency from 'CRIT-001' to 'REQ-SYS-001';
//
// 規則：
// - 準則是專案統一的。決策矩陣以 #trace 連到準則時只用那幾項；沒有連時用專案全部的準則。
// - 必須（must）準則：分數 1 = 通過、0 = 不通過；任何一項不通過，方案就剔除，不計加權分數。
// - 加分（want）準則：分數 1 到 5；加權總分 = Σ 權重 × 分數；正規化分數 = 加權總分 ÷ Σ 權重（仍是 1 到 5）。
// - 每項準則要追溯到需求、MOE 或 MOP；矩陣裡至少要有一項風險準則（aspect = risk）。
// - 選定方案（status = selected）恰好一個、要通過所有必須準則、要連到設計元素；否決方案（rejected）要有理由。
// - 選定方案在加分準則上 ≤ 2 分的項目是弱點，應登記為風險（METHOD.md 第 6 節第 4 點）。

interface El { id: string; category: string | null; name: string; shortName: string | null; attrs: Record<string, string>; parent?: string | null; owner: string | null; kind: string }
interface Rel { kind: string; from: string; to: string }
export interface TradeInput { elements: El[]; relations: Rel[]; unnamed?: El[] }

export const TRACE_TARGETS = new Set(["Objective", "MOE", "MOP", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MissionRequirement", "Expectation", "Need", "Goal"]);
export const DESIGN_TARGETS = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);
const DESIGN_KINDS = /^(Part|Item|Port|Interface|Connection|Action|State)(Definition|Usage)$/;

export interface TradeCriterion {
  id: string; shortName: string | null; name: string;
  kind: "must" | "want" | "unknown"; weight: number | null; aspect: string; measure: string;
  /** 權重 ÷ 加分準則權重總和（只有加分準則有） */
  share: number | null;
  /** 追溯到的需求、MOE、MOP */
  traces: { id: string; name: string; category: string | null }[];
}
export interface TradeScore { id: string; score: number | null; basis: string }
export interface TradeAlternative {
  id: string; shortName: string | null; name: string;
  status: "candidate" | "selected" | "rejected" | "unknown"; rationale: string;
  /** 準則 id → 分數；沒打分是 null */
  scores: Record<string, TradeScore | null>;
  /** 不通過的必須準則 id */
  failedMust: string[];
  /** 必須準則全部有分數而且都通過 */
  feasible: boolean;
  /** Σ 權重 × 分數（加分準則有缺分數或方案被剔除時是 null） */
  total: number | null;
  /** 加權總分 ÷ Σ 權重 */
  normalized: number | null;
  /** 名次（1 起算），只排可行而且分數齊全的方案 */
  rank: number | null;
  /** 選定方案在加分準則上 ≤ 2 分的準則 id */
  weaknesses: string[];
  /** 連到的設計元素 */
  design: { id: string; name: string }[];
}
export interface TradeMatrix {
  id: string; shortName: string | null; name: string; question: string; decision: string;
  criteria: TradeCriterion[];
  alternatives: TradeAlternative[];
  /** 分數最高的可行方案 */
  best: string | null;
  selected: string | null;
  missing: { id: string | null; text: string }[];
}

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*$/.exec(s);
  return m ? Number(m[1]) : null;
};
const text = (s: string | undefined): string => {
  if (s === undefined) return "";
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\") : t;
};
const parentOf = (e: El) => e.parent ?? e.owner;
const label = (e: { shortName: string | null; name: string }) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);
/** 決定比較時用的數字：浮點誤差收斂到 1e-9 */
const round = (x: number) => Math.round(x * 1e9) / 1e9;

export function criterionOf(e: El, wantTotal: number, byId: Map<string, El>, relations: Rel[]): TradeCriterion {
  const kind = text(e.attrs.kind).toLowerCase();
  const weight = num(e.attrs.weight);
  const traces = relations.filter((r) => r.kind === "trace" && r.from === e.id).map((r) => byId.get(r.to)).filter((t): t is El => !!t && TRACE_TARGETS.has(t.category ?? ""));
  return {
    id: e.id, shortName: e.shortName, name: e.name,
    kind: kind === "must" ? "must" : kind === "want" ? "want" : "unknown",
    weight, aspect: text(e.attrs.aspect).toLowerCase(), measure: text(e.attrs.measure),
    share: kind === "want" && weight !== null && wantTotal > 0 ? round(weight / wantTotal) : null,
    traces: traces.map((t) => ({ id: t.id, name: label(t), category: t.category })),
  };
}

/** 專案全部的評比準則（權重占比以全部的加分準則計） */
export function listCriteria(a: TradeInput): TradeCriterion[] {
  const all = [...a.elements, ...(a.unnamed ?? [])];
  const byId = new Map(all.map((e) => [e.id, e]));
  const els = a.elements.filter((e) => e.category === "Criterion");
  const wantTotal = els.reduce((s, c) => s + (text(c.attrs.kind).toLowerCase() === "want" ? Math.max(0, num(c.attrs.weight) ?? 0) : 0), 0);
  return els.map((c) => criterionOf(c, wantTotal, byId, a.relations));
}

export function evaluateTrades(a: TradeInput): TradeMatrix[] {
  const all = [...a.elements, ...(a.unnamed ?? [])];
  const byId = new Map(all.map((e) => [e.id, e]));
  const allCriteria = a.elements.filter((e) => e.category === "Criterion");
  const matrices = a.elements.filter((e) => e.category === "DecisionMatrix");
  return matrices.map((m) => {
    const linked = a.relations.filter((r) => r.kind === "trace" && r.from === m.id).map((r) => byId.get(r.to)).filter((c): c is El => c?.category === "Criterion");
    const critEls = linked.length ? linked : allCriteria;
    const wantTotal = critEls.reduce((s, c) => s + (text(c.attrs.kind).toLowerCase() === "want" ? Math.max(0, num(c.attrs.weight) ?? 0) : 0), 0);
    const criteria = critEls.map((c) => criterionOf(c, wantTotal, byId, a.relations));
    const missing: TradeMatrix["missing"] = [];

    const altEls = a.elements.filter((e) => e.category === "Alternative" && parentOf(e) === m.id);
    const alternatives: TradeAlternative[] = altEls.map((alt) => {
      const scoreEls = all.filter((e) => e.category === "CriterionScore" && parentOf(e) === alt.id);
      const scores: Record<string, TradeScore | null> = {};
      for (const c of criteria) {
        const s = scoreEls.find((x) => x.name === c.shortName || x.name === c.name);
        scores[c.id] = s ? { id: s.id, score: num(s.attrs.score), basis: text(s.attrs.basis) } : null;
      }
      const st = text(alt.attrs.status).toLowerCase();
      const status: TradeAlternative["status"] = st === "selected" || st === "rejected" || st === "candidate" ? st : st === "" ? "candidate" : "unknown";
      const must = criteria.filter((c) => c.kind === "must");
      const want = criteria.filter((c) => c.kind === "want");
      const failedMust = must.filter((c) => scores[c.id]?.score === 0).map((c) => c.id);
      const feasible = failedMust.length === 0 && must.every((c) => scores[c.id]?.score === 1);
      const wantComplete = want.every((c) => typeof scores[c.id]?.score === "number" && c.weight !== null);
      const total = feasible && wantComplete && want.length ? round(want.reduce((s, c) => s + (c.weight as number) * (scores[c.id]?.score as number), 0)) : null;
      const normalized = total !== null && wantTotal > 0 ? round(total / wantTotal) : null;
      const design = a.relations.filter((r) => r.kind === "trace" && (r.from === alt.id || r.to === alt.id))
        .map((r) => byId.get(r.from === alt.id ? r.to : r.from))
        .filter((d): d is El => !!d && (DESIGN_TARGETS.has(d.category ?? "") || (d.category === null && DESIGN_KINDS.test(d.kind))))
        .map((d) => ({ id: d.id, name: label(d) }));
      const weaknesses = status === "selected" ? want.filter((c) => { const s = scores[c.id]?.score; return typeof s === "number" && s <= 2; }).map((c) => c.id) : [];
      return { id: alt.id, shortName: alt.shortName, name: alt.name, status, rationale: text(alt.attrs.rationale), scores, failedMust, feasible, total, normalized, rank: null, weaknesses, design };
    });

    // 名次：可行而且分數齊全的方案依正規化分數排；同分同名次
    const ranked = alternatives.filter((x) => x.normalized !== null).sort((p, q) => (q.normalized as number) - (p.normalized as number));
    ranked.forEach((x, i) => { x.rank = i > 0 && ranked[i - 1].normalized === x.normalized ? ranked[i - 1].rank : i + 1; });
    const best = ranked[0]?.id ?? null;
    const selectedAll = alternatives.filter((x) => x.status === "selected");
    const selected = selectedAll.length === 1 ? selectedAll[0].id : null;

    // ───────── 還缺什麼 ─────────
    if (!criteria.length) missing.push({ id: m.id, text: "還沒有評比準則。準則由專案統一定義（評比準則類別）。" });
    if (criteria.length && !criteria.some((c) => c.kind === "must")) missing.push({ id: m.id, text: "沒有必須（must）準則：哪些條件不滿足就直接剔除？" });
    if (criteria.length && !criteria.some((c) => c.aspect === "risk")) missing.push({ id: m.id, text: "沒有風險準則（aspect = risk）。風險是評比之前的準則之一。" });
    for (const c of criteria) {
      if (c.kind === "unknown") missing.push({ id: c.id, text: `準則 ${label(c)} 的種類要填 must（必須）或 want（加分）。` });
      if (c.kind === "want" && (c.weight === null || c.weight <= 0)) missing.push({ id: c.id, text: `加分準則 ${label(c)} 的權重要是正數。` });
      if (!c.traces.length) missing.push({ id: c.id, text: `準則 ${label(c)} 沒有追溯到需求、MOE 或 MOP，不能憑空訂。` });
    }
    if (alternatives.length === 0) missing.push({ id: m.id, text: "還沒有候選方案。" });
    else if (alternatives.length === 1) missing.push({ id: m.id, text: "只有一個候選方案。至少要有一個、最好有多個；只有一個可行方案時也要留下這個矩陣與理由。" });
    for (const x of alternatives) {
      for (const c of criteria) {
        const s = x.scores[c.id];
        if (!s || s.score === null) missing.push({ id: x.id, text: `${label(x)} 在準則 ${label(c)} 還沒有分數。` });
        else if (c.kind === "must" && s.score !== 0 && s.score !== 1) missing.push({ id: s.id, text: `${label(x)} 在必須準則 ${label(c)} 的分數只能是 1（通過）或 0（不通過）。` });
        else if (c.kind === "want" && (s.score < 1 || s.score > 5)) missing.push({ id: s.id, text: `${label(x)} 在加分準則 ${label(c)} 的分數要在 1 到 5 之間。` });
      }
      if (x.status === "unknown") missing.push({ id: x.id, text: `${label(x)} 的狀態要填 candidate、selected 或 rejected。` });
      if (x.status === "rejected" && !x.rationale) missing.push({ id: x.id, text: `否決的方案 ${label(x)} 要寫理由，之後才查得到為什麼不用它。` });
    }
    if (alternatives.length && selectedAll.length === 0) missing.push({ id: m.id, text: "還沒有選定方案。" });
    if (selectedAll.length > 1) missing.push({ id: m.id, text: `選定了 ${selectedAll.length} 個方案，只能選一個。` });
    for (const x of selectedAll) {
      if (x.failedMust.length) missing.push({ id: x.id, text: `選定的 ${label(x)} 沒有通過必須準則，應該剔除。` });
      if (!x.design.length) missing.push({ id: x.id, text: `選定的 ${label(x)} 還沒有連到設計元素（系統、次系統或元件），用 trace 連起來。` });
      if (best && x.id !== best && !x.rationale) missing.push({ id: x.id, text: `選定的 ${label(x)} 不是分數最高的方案，要寫理由。` });
    }
    return { id: m.id, shortName: m.shortName, name: m.name, question: text(m.attrs.question), decision: text(m.attrs.decision), criteria, alternatives, best, selected, missing };
  });
}
