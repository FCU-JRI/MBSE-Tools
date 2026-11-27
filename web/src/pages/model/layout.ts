// 層級圖的自動排版（C＋D）：固定區帶、不可拖拉。版面規則照固定翼無人機框架示意（Mars 認可，2026-11-26）。
// 需求帶（上一層輸入＋本層需求）、設計迴圈帶（提案 → 方案分析 → FMEA → 是否解決 → CAD／示意 → 計算 → 是否符合需求）、架構帶（組成、配額、方向性介面）。
// 顏色：in＝上一層給的（白）、build＝本層建的（綠）、out＝往下一層交的（黃）、table＝工具產生的表（藍虛線）。
import type { TableGroup } from "../../workspace.ts";
import type { Model, U } from "./views.ts";
import { GATE_ZH, viewKeyOfPart } from "./views.ts";

export type Tone = "in" | "build" | "out" | "table" | "frame";
export type Go = { view: string } | { el: string } | { table: TableGroup };
export interface Block { name: string; sub: string; hi: boolean }
export interface DNode {
  id: string; x: number; y: number; w: number; h?: number; hfix?: number; kw?: string; name: string; lines: string[]; tone: Tone;
  def?: boolean; frame?: boolean; badge?: [string, string] | null; blocks?: Block[]; caption?: string[]; go?: Go; el?: string;
  /** 設計示意這一版的 CAD（@CadLink）：圖片網址就畫縮圖，其他給連結 */
  cad?: { url: string; version: string; image: boolean };
}
export interface DEdge {
  f?: string; t?: string; fs?: Side; ts?: Side; fo?: number; to?: number; k: "rel" | "flow" | "derive" | "trace" | "fb" | "comp" | "iface" | "satisfy" | "dep";
  label?: string; pts?: [number, number][]; mx?: number; my?: number; bad?: boolean; lx?: number; ly?: number; la?: "start" | "middle" | "end";
}
type Side = "l" | "r" | "t" | "b";
/** 區帶右上角的「新增」：要新增的類別（右欄打開新增表單） */
export interface Add { label: string; category: string }
export interface Zone { y: number; h: number; label: string; add?: Add[] }
export interface Spec { label: string; nodes: DNode[]; edges: DEdge[]; zones?: Zone[]; heads?: { x: number; y: number; t: string }[] }

export const WIDTH = 1200;
const cw = (ch: string) => (/[⺀-￯]/.test(ch) ? 11.2 : 6.3);
export function wrap(s: string, w: number, max?: number): string[] {
  const out: string[] = []; let cur = "", width = 0;
  for (const ch of String(s ?? "")) { const d = cw(ch); if (width + d > w - 16) { out.push(cur); cur = ""; width = 0; } cur += ch; width += d; }
  if (cur) out.push(cur);
  if (max && out.length > max) { out.length = max; out[max - 1] = out[max - 1].slice(0, -1) + "…"; }
  return out;
}
export const clip = (s: string, w: number) => wrap(s, w, 1)[0] ?? "";
export function nodeH(n: DNode): number {
  if (n.hfix) return n.hfix;
  const head = n.kw ? 32 : 20;
  return head + (n.lines.length ? 8 + n.lines.length * 15 : 4);
}
export function anchor(n: DNode, s: Side = "b", o = 0.5): [number, number] {
  const h = nodeH(n);
  if (s === "r") return [n.x + n.w, n.y + h * o];
  if (s === "l") return [n.x, n.y + h * o];
  if (s === "t") return [n.x + n.w * o, n.y];
  return [n.x + n.w * o, n.y + h];
}

const score = (L: number | null, C: number | null) => (L == null || C == null ? null : L * C);
const fixApplies = (r: U) => !!r.fix.trim() && !/^(待|無|暫不改)/.test(r.fix.trim());
export const stBadge = (st: U["st"]): [string, string] | null => (st ? ({ ok: ["通過", "ok"], pend: ["待驗證", "pend"], bad: ["不通過", "bad"] } as const)[st] as [string, string] : null);
const label = (u: U) => (u.sn ? `${u.sn} ` : "");
const tradeTotal = (t: U, v: { scores: Record<string, number>; adj: Record<string, number> }, adj: boolean) =>
  t.crit.reduce((a, c) => a + c.w * ((adj ? v.adj[c.id] ?? v.scores[c.id] : v.scores[c.id]) ?? 0), 0);
const tpmOk = (t: U) => { const cur = t.vals[t.vals.length - 1]?.v; return cur == null || t.thr == null ? null : t.dir === "le" ? cur <= t.thr : cur >= t.thr; };
const fmt = (n: number | null | undefined) => (n == null ? "—" : String(+n.toFixed(3)));

/** 一個元素的框 */
export function box(M: Model, e: U, x: number, y: number, w: number, o: { tone?: Tone; lines?: string[] } = {}): DNode {
  const n: DNode = { id: e.id, x, y, w, name: e.name, lines: [], tone: o.tone ?? "build", go: { el: e.el.id }, el: e.el.id };
  const L = n.lines, W = (s: string, m = 2) => L.push(...wrap(s, w, m)), name = (id: string) => M.U.get(id)?.sn || M.U.get(id)?.name || "";
  switch (e.kind) {
    case "req":
      n.kw = "«requirement» " + e.sn; W(e.text, 2); if (e.expr) L.push("$ " + clip(e.expr, w));
      if (e.from.length) L.push(clip("← «derive» " + e.from.map(name).join("、"), w)); if (e.basis.length) L.push(clip("#basis " + e.basis.map(name).join("、"), w));
      n.badge = stBadge(e.st); break;
    case "alt": n.kw = `«variation ${e.vkind || "part"} def» ${e.sn}`; n.def = true; e.variants.forEach((v) => L.push(clip((v.picked ? "✓ " : "✗ ") + v.name, w))); break;
    case "trade": n.kw = "〔表〕方案比較 " + e.sn; n.tone = "table"; n.go = { table: "trade" };
      e.variants.forEach((v) => { const t0 = tradeTotal(e, v, false), t1 = Object.keys(v.adj).length ? tradeTotal(e, v, true) : null; L.push(clip(`${v.name}：${fmt(t0)}${t1 != null ? " → " + fmt(t1) : ""}`, w)); });
      if (e.merged.length) L.push(clip("歸併 " + e.merged.map(name).join("、"), w)); break;
    case "risk": { n.kw = "〔表〕風險 " + e.sn; n.tone = "table"; n.go = { table: "fmea" }; const s0 = score(e.L, e.C), s1 = score(e.L2, e.C2); L.push(`分數 ${s0 ?? "?"} → ${s1 ?? "?"}　${e.state}`); W("緩解：" + e.mitig, 2); break; }
    case "decision": n.kw = "«@DesignDecision» " + e.sn; if (e.chosen) W("選 " + e.chosen, 2); if (e.by) L.push("decidedBy " + e.by); if (e.on) L.push("decidedOn " + e.on);
      if (e.gate === "hold") W("喊卡：" + e.holdWhy, 2); n.badge = e.gate === "ok" ? ["已放行", "ok"] : ["喊卡中", "hold"]; break;
    case "conflict": n.kw = "〔表〕衝突 " + e.sn; n.tone = "table"; n.go = { table: "conflicts" }; W(e.text, 2); L.push(clip(e.state, w)); break;
    case "part": n.kw = "«part» " + e.sn; n.tone = "out"; L.push(`配額 ${fmt(e.alloc)}／目前 ${fmt(e.mass)} kg`); if (e.owner) L.push(clip("負責 " + e.owner, w));
      if (M.V.has(viewKeyOfPart(e.id))) { L.push("▸ 打開下一層"); n.go = { view: viewKeyOfPart(e.id) }; } break;
    case "action": n.kw = "«action» " + e.sn; n.tone = "out"; W(e.text, 3); break;
    case "state": n.kw = "«state» " + e.sn; W(e.text, 2); e.transitions.forEach((t) => L.push(clip("→ " + (M.U.get(t.to)?.name ?? "") + (t.on ? "：" + t.on : ""), w))); break;
    case "moe": n.kw = "«requirement» @MOE " + e.sn; if (e.moe) L.push(`最低 ${e.moe.min}／完全 ${e.moe.full}／延伸 ${e.moe.ext}`, `目前 ${e.moe.current} ${e.moe.unit}`); break;
    case "usecase": n.kw = "«use case» " + e.sn + (e.abnormal ? "（異常）" : ""); n.def = true; W(e.text, 2); break;
    case "source": n.kw = "需求書 " + e.sn; n.tone = "in"; W(e.text, 1); break;
    case "stakeholder": n.kw = "«stakeholder» " + e.sn; n.def = true; W(e.text, 1); break;
    case "concern": n.kw = "«concern» " + e.sn; W(e.text, 2); break;
    default: n.kw = `«${e.kind}» ${e.sn}`; W(e.text, 2);
  }
  if (o.lines) n.lines = o.lines;
  return n;
}
function column(items: U[], x: number, y0: number, w: number, gy: number, mk: (e: U, x: number, y: number, w: number) => DNode) {
  const nodes: DNode[] = []; let y = y0;
  for (const e of items) { const n = mk(e, x, y, w); nodes.push(n); y += nodeH(n) + gy; }
  return { nodes, bottom: items.length ? y - gy : y0 };
}
function grid(items: U[], x0: number, y0: number, cols: number, w: number, gx: number, gy: number, mk: (e: U, x: number, y: number, w: number) => DNode) {
  const nodes: DNode[] = []; let y = y0;
  for (let i = 0; i < items.length; i += cols) {
    const row = items.slice(i, i + cols).map((e, j) => mk(e, x0 + j * (w + gx), y, w));
    const h = Math.max(...row.map(nodeH)); row.forEach((n) => (n.hfix = h)); nodes.push(...row); y += h + gy;
  }
  return { nodes, bottom: items.length ? y - gy : y0 };
}

/** 伺服器算的真值（E 包）：計算引擎的質量預算（ANA-11）與需求判定（ANA-09）、版本紀錄（VER-06）、專案的 FMEA 門檻（PRJ-05）。沒有時退回只用模型值。 */
export interface Live {
  budget: { element: string; name: string; limitKg: number; sumKg: number; marginKg: number; status: "PASS" | "FAIL"; items: { name: string; massKg: number | null }[] }[];
  verdicts: { qualifiedName: string; requirement: string; condition: string; status: "holds" | "fails" | "undecided"; terms: { attribute: string; op: string; threshold: string; value: number | null; unit: string; margin: number | null }[]; note: string }[];
  iterations: { commit: string; date: string; author: string; message: string; touched: string[]; cad: { part: string; url: string; version: string }[] }[];
  fmeaThreshold: number | null;
}
interface Ctx { owner?: string; blocks?: () => { id: string; sn: string; name: string; sub: string }[]; live?: Live | null }
/** 設計迴圈帶：方案 → 比較表 → 風險（回頭修正用橘虛線）→ 決策 → TPM；下半排是設計示意與計算 */
function loopBand(M: Model, y0: number, els: U[], ctx: Ctx) {
  const alt = els.find((e) => e.kind === "alt"), trade = els.find((e) => e.kind === "trade" && e.alt === alt?.id) ?? els.find((e) => e.kind === "trade");
  const dec = els.find((e) => e.kind === "decision" && e.alt === alt?.id) ?? els.find((e) => e.kind === "decision");
  const risks = els.filter((e) => e.kind === "risk"), tpms = els.filter((e) => e.kind === "tpm"), confs = els.filter((e) => e.kind === "conflict");
  const nodes: DNode[] = [], edges: DEdge[] = []; let bottom = y0;
  const push = (n: DNode) => { nodes.push(n); bottom = Math.max(bottom, n.y + nodeH(n)); return n; };
  const nA = alt ? push(box(M, alt, 24, y0, 250)) : null;
  const nT = trade ? push(box(M, trade, 310, y0, 235)) : null;
  const rc = column(risks, 310, (nT ? nT.y + nodeH(nT) : y0) + 16, 235, 12, (e, x, y, w) => box(M, e, x, y, w));
  rc.nodes.forEach(push);
  const nD = dec ? push(box(M, dec, 585, y0, 215)) : null;
  if (tpms.length) {
    const tl = tpms.map((t) => { const cur = t.vals[t.vals.length - 1]; const ok = tpmOk(t); return clip(`${label(t)}${t.name} ${cur ? `${cur.v}（${GATE_ZH[cur.gate]}）` : "—"}／${fmt(t.thr)} ${t.unit} ${ok == null ? "" : ok ? "✓" : "✗"}`, 190); });
    push({ id: "tpm", x: 835, y: y0, w: 190, kw: "«attribute» #tpm", name: "TPM", lines: tl, tone: "build", go: { table: "params" } });
    if (nD) edges.push({ f: nD.id, fs: "r", fo: 0.3, t: "tpm", ts: "l", to: 0.4, k: "rel", label: "定 TPM" });
  }
  column(confs, 1045, y0, 140, 12, (e, x, y, w) => box(M, e, x, y, w)).nodes.forEach(push);
  if (nA && nT) edges.push({ f: nA.id, fs: "r", fo: 0.3, t: nT.id, ts: "l", to: 0.3, k: "rel", label: "評分" });
  rc.nodes.forEach((n, i) => {
    if (nA) edges.push({ f: nA.id, fs: "r", fo: 0.6 + 0.3 * (i / Math.max(1, rc.nodes.length - 1)), t: n.id, ts: "l", to: 0.25, k: "rel", mx: 292 });
    if (nD) edges.push({ f: n.id, fs: "r", fo: 0.5, t: nD.id, ts: "l", to: Math.min(0.9, 0.55 + 0.1 * i), k: "rel", mx: 565 + i * 4 });
  });
  // 風險回頭修正（#fix）：橘色虛線回到方案
  rc.nodes.filter((n) => fixApplies(M.U.get(n.id)!)).forEach((n, i) => {
    if (!nA) return;
    const [x1, y1] = anchor(n, "l", 0.8), bx = nA.x + 30 + i * 40, abot = nA.y + nodeH(nA);
    if (y1 > abot + 8) edges.push({ k: "fb", pts: [[x1, y1], [bx, y1], [bx, abot]], label: i === 0 ? "回頭修正" : "", lx: bx + 6, ly: y1 - 6, la: "start" });
  });
  if (nT && nD) edges.push({ f: nT.id, fs: "r", fo: 0.4, t: nD.id, ts: "l", to: 0.3, k: "rel" });
  const R2 = designRow(M, bottom + 50, els, ctx, { nT, nD, risks: rc.nodes });
  nodes.push(...R2.nodes); edges.push(...R2.edges);
  return { nodes, edges, bottom: Math.max(bottom, R2.bottom), dec: nD, adopt: R2.adopt ?? nD };
}

/** 迴圈下半排：每一輪的設計示意，加上計算框。有版本紀錄時一次提交一版（E 包）；沒有時退回「初始提案＋每個回頭修正的風險各一版」的方塊配置圖。 */
function designRow(M: Model, y: number, els: U[], ctx: Ctx, k: { nT: DNode | null; nD: DNode | null; risks: DNode[] }) {
  const nodes: DNode[] = [], edges: DEdge[] = [];
  const alt = els.find((e) => e.kind === "alt");
  if (!alt || !ctx.blocks) return { nodes, edges, bottom: y, adopt: null as DNode | null };
  const picked = alt.variants.find((v) => v.picked)?.name ?? "";
  const base = ctx.blocks();
  const hit = (txt: string, b: { sn: string; name: string }) => !!txt && ((!!b.sn && txt.includes(b.sn)) || (b.name.length >= 2 && txt.includes(b.name)));
  const fixes = els.filter((e) => e.kind === "risk" && fixApplies(e));
  // 有版本紀錄就用它（E 包）：改到本層定義或組成零件的提交，各一版（最近 5 版）；這一版改到的零件、#fix 的目標用橘框；有 CAD 就附連結或縮圖
  const owner = ctx.owner ? M.U.get(ctx.owner) : undefined;
  const keys = (u: { sn: string; name: string }) => [u.sn, u.name].filter(Boolean);
  const fixTargets = new Set(M.list.filter((r) => r.kind === "risk" && fixApplies(r)).flatMap((r) => r.targets));
  const mine = owner && ctx.live ? ctx.live.iterations.filter((it) => [owner, ...owner.kids.map((c) => M.U.get(c)!).filter(Boolean)].some((u) => keys(u).some((k) => it.touched.includes(k)))).slice(-5) : [];
  type It = { id: string; ver: string; title: string; cap: string; touched: string[]; go: Go; rid: string; cad?: { url: string; version: string } };
  const its: It[] = mine.length
    ? mine.map((it, i) => ({ id: `it${i}`, ver: `v${i + 1}`, title: `${it.date.slice(0, 10)} ${it.commit}`, cap: it.message, touched: it.touched, go: { el: owner!.el.id } as Go, rid: it.commit,
        cad: it.cad.filter((c) => keys(owner!).includes(c.part)).pop() }))
    : [{ id: "it0", ver: "v1", title: "初始提案", cap: picked ? "選定 " + picked : "還沒有選定", touched: [], go: { el: alt.el.id } as Go, rid: "" },
      ...fixes.map((r, i) => ({ id: `it${i + 1}`, ver: `v${i + 2}`, title: `${label(r)}修正後`, cap: r.fix, touched: [] as string[], go: { el: r.el.id } as Go, rid: r.sn, txt: r.fix }))];
  // 目前這一版的 CAD：本層定義上的 @CadLink（沒有就看版本紀錄裡最後寫入的）
  const curCad = owner?.el.attrs.cadUrl ? { url: owner.el.attrs.cadUrl, version: owner.el.attrs.cadVersion ?? "" } : undefined;
  if (its.length && curCad) its[its.length - 1].cad = curCad;
  const calcW = 400, avail = 1185 - 24 - calcW - 40, n = its.length, gap = 22;
  const w = Math.min(250, (avail - (n - 1) * gap) / n), cols = w < 200 ? 2 : 3, rows = Math.max(1, Math.ceil(base.length / cols));
  const caps = its.map((it) => [...wrap(it.cap, w, it.cad ? 2 : 3), ...(it.cad ? [clip(`CAD ${it.cad.version}`, w)] : [])]), capN = Math.max(...caps.map((c) => c.length));
  const h = 34 + 10 + rows * 36 + 10 + capN * 14 + 4;
  its.forEach((it, i) => {
    const last = i === n - 1;
    const txt = (it as It & { txt?: string }).txt ?? "";
    const changed = (b: { id: string; sn: string; name: string }) => keys(b).some((k) => it.touched.includes(k)) || (mine.length > 0 && fixTargets.has(b.id) && keys(b).some((k) => it.touched.includes(k))) || hit(txt, b);
    nodes.push({ id: it.id, x: 24 + i * (w + gap), y, w, hfix: h, kw: `設計示意 ${it.ver}${last ? "（目前）" : ""}${mine.length ? "・版本紀錄" : ""}`, name: it.title, lines: [],
      blocks: base.map((b) => ({ name: b.name, sub: last ? b.sub : "", hi: changed(b) })), caption: caps[i], tone: last ? "build" : "in", go: it.go,
      ...(it.cad ? { cad: { ...it.cad, image: /\.(png|jpe?g|gif|svg|webp)(\?|$)/i.test(it.cad.url) } } : {}) });
    if (i) edges.push({ f: its[i - 1].id, fs: "r", t: it.id, ts: "l", k: "flow", label: it.rid });
  });
  const rowsC = calcRows(M, els, ctx);
  const cl = rowsC.flatMap((r) => [clip(r.t + (r.ok === true ? "　✓" : r.ok === false ? "　✗" : ""), calcW), ...wrap(r.s, calcW, 2).map((s) => "$ " + s)]);
  const bad = rowsC.some((r) => r.ok === false);
  const cn: DNode = { id: "calc", x: 1185 - calcW, y, w: calcW, kw: ctx.live ? "«calc» 計算（計算引擎＋模型值）" : "«calc» 計算（帶入模型值）", name: "計算與判定", lines: cl, tone: "build", badge: rowsC.length ? (bad ? ["有不符合", "bad"] : ["全部符合", "ok"]) : null, go: { table: "formula" } };
  nodes.push(cn);
  const src = k.risks.length ? k.risks[k.risks.length - 1] : k.nT;
  if (src) edges.push({ f: src.id, fs: "b", t: "it0", ts: "t", k: "rel", label: "是否解決 → CAD／示意", my: y - 28 });
  edges.push({ f: its[n - 1].id, fs: "r", fo: 0.3, t: "calc", ts: "l", to: 0.15, k: "flow", label: "帶入" });
  if (k.nD) edges.push({ f: "calc", fs: "t", fo: 0.15, t: k.nD.id, ts: "b", to: 0.5, k: "rel", label: "是否符合需求", my: y - 14 });
  return { nodes, edges, bottom: y + Math.max(h, nodeH(cn)), adopt: cn as DNode | null };
}

/** 計算：用模型裡已有的值帶入（質量加總、加權總分、風險分數、TPM 餘裕） */
export function calcRows(M: Model, els: U[], ctx: Ctx): { t: string; s: string; ok?: boolean }[] {
  const out: { t: string; s: string; ok?: boolean }[] = [];
  const o = ctx.owner ? M.U.get(ctx.owner) : undefined;
  // 質量預算：計算引擎（ANA-11）對頂層實例算出的那一列；用組成零件的名稱對到本層的定義
  const usageNames = o ? M.list.filter((x) => x.kind === "part" && o.kids.includes(x.id)).map((x) => x.name) : [];
  const brow = o && ctx.live ? ctx.live.budget.map((r) => ({ r, hit: r.items.filter((i) => usageNames.includes(i.name)).length })).filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit)[0]?.r : undefined;
  if (o && brow) {
    const items = brow.items.filter((i) => i.massKg != null);
    out.push({ t: `質量 Σ m(子零件) ≤ m 配額（${o.name}，計算引擎）`, s: `${items.map((i) => (i.massKg ?? 0).toFixed(2)).join(" + ")} = ${brow.sumKg.toFixed(2)} kg ≤ ${+brow.limitKg.toFixed(3)} kg（餘裕 ${brow.marginKg.toFixed(2)}）`, ok: brow.status === "PASS" });
  } else if (o) {
    const ks = o.kids.map((k) => M.U.get(k)!).filter((k) => k && k.mass != null);
    if (ks.length) {
      const sum = ks.reduce((a, c) => a + (c.mass ?? 0), 0), ok = o.alloc == null || sum <= o.alloc + 1e-9;
      out.push({ t: `質量 m(${o.name}) = Σ 子零件 ≤ 配額（模型值）`, s: `${ks.map((c) => (c.mass ?? 0).toFixed(2)).join(" + ")} = ${sum.toFixed(2)} kg ≤ ${fmt(o.alloc)}${o.alloc != null ? `（餘裕 ${(o.alloc - sum).toFixed(2)}）` : ""}`, ok });
    }
  }
  for (const t of els.filter((e) => e.kind === "trade")) {
    const tot = (v: U["variants"][number]) => tradeTotal(t, v, true);
    const pick = t.variants.find((v) => v.picked) ?? t.variants[0];
    if (!pick) continue;
    const others = t.variants.filter((v) => v !== pick).map(tot), lead = others.length ? tot(pick) - Math.max(...others) : null;
    out.push({ t: `${label(t)}加權總分 Σ wᵢ·sᵢ（${pick.name}）`, s: `${t.crit.map((c) => `${c.w}×${pick.adj[c.id] ?? pick.scores[c.id] ?? 0}`).join(" + ")} = ${fmt(tot(pick))}${lead != null ? `，領先第二名 ${fmt(lead)}` : ""}`, ok: lead == null ? undefined : lead > 0 });
  }
  // 需求判定：計算引擎對 require constraint 求值（ANA-09），每項寫 條件 → 帶入值 → 餘裕
  const reqQn = new Set(els.filter((e) => e.kind === "req").map((e) => e.el.qualifiedName));
  for (const v of ctx.live?.verdicts ?? []) {
    if (!reqQn.has(v.qualifiedName)) continue;
    const terms = v.terms.map((t) => `${t.attribute} = ${t.value ?? "?"}${t.unit ? " " + t.unit : ""}（${t.op} ${t.threshold}${t.margin != null ? `，餘裕 ${+t.margin.toFixed(3)}` : ""}）`).join("；");
    out.push({ t: `${v.requirement} ${v.condition}`, s: terms || v.note || "條件寫法較複雜，只顯示判定結果", ok: v.status === "holds" ? true : v.status === "fails" ? false : undefined });
  }
  // 殘餘風險門檻讀專案設定（PRJ-05）
  const thr = ctx.live?.fmeaThreshold ?? 4, thrZh = ctx.live?.fmeaThreshold != null ? "專案設定" : "預設";
  for (const r of els.filter((e) => e.kind === "risk")) {
    const s0 = score(r.L, r.C), s1 = score(r.L2, r.C2);
    out.push({ t: `${label(r)}風險分數 L×C（殘餘門檻 ≤ ${thr}，${thrZh}）`, s: `${r.L ?? "?"}×${r.C ?? "?"} = ${s0 ?? "?"} → ${s1 == null ? "緩解後待重評" : `${r.L2}×${r.C2} = ${s1}`}`, ok: s1 == null ? undefined : s1 <= thr });
  }
  for (const t of els.filter((e) => e.kind === "tpm")) {
    const cur = t.vals[t.vals.length - 1]?.v; if (cur == null || t.thr == null) continue;
    const m = t.dir === "le" ? t.thr - cur : cur - t.thr;
    out.push({ t: `${label(t)}${t.name} 餘裕 = ${t.dir === "le" ? "門檻 − 目前" : "目前 − 門檻"}`, s: `${t.dir === "le" ? `${t.thr} − ${cur}` : `${cur} − ${t.thr}`} = ${fmt(m)} ${t.unit}`, ok: m >= 0 });
  }
  return out;
}

/** 架構帶：本層的定義、下方組成零件、零件之間有方向的介面（走下方通道，兩端不一致標紅） */
function archBand(M: Model, y0: number, ownerId: string, decNode: DNode | null, ifs: U[], adoptNode: DNode | null) {
  const ow = M.U.get(ownerId)!, ch = ow.kids.map((k) => M.U.get(k)!).filter(Boolean), nodes: DNode[] = [], edges: DEdge[] = [];
  const ext = M.list.filter((e) => e.kind === "iface" && (e.a === ownerId || e.b === ownerId));
  const nm = (id: string | null) => (id ? M.U.get(id)?.name ?? "" : "");
  const ol = [`mass = ${fmt(ow.mass)} [kg]（配額 ${fmt(ow.alloc)}）`, ...ext.map((f) => clip(`port ${f.sn} ${f.a === ownerId ? "→ " + nm(f.b) : "← " + nm(f.a)}（${f.name}）`, 360))];
  const on = box(M, ow, 420, y0, 360, { lines: ol }); on.def = true; on.kw = "«part def» " + ow.sn; on.go = { el: ow.el.id };
  nodes.push(on);
  const py = y0 + nodeH(on) + 56, n = ch.length || 1, gap = 18, w = Math.min(230, (1150 - (n - 1) * gap) / n), x0 = 600 - (n * w + (n - 1) * gap) / 2;
  const row = ch.map((p, i) => box(M, p, x0 + i * (w + gap), py, w));
  const rh = Math.max(40, ...row.map(nodeH)); row.forEach((r) => (r.hfix = rh)); nodes.push(...row);
  row.forEach((r) => edges.push({ f: on.id, fs: "b", t: r.id, ts: "t", k: "comp", my: py - 24 }));
  if (decNode) edges.push({ f: (adoptNode ?? decNode).id, fs: "b", fo: 0.5, t: on.id, ts: "t", to: 0.15, k: "rel", label: "採用 " + (M.U.get(decNode.id)?.sn ?? ""), my: y0 - 18 });
  const R = new Map(row.map((r) => [r.id, r]));
  const used = new Map<string, number>(); const slot = (id: string) => { used.set(id, (used.get(id) ?? 0) + 1); return used.get(id)!; };
  let lane = py + rh + 22;
  for (const f of ifs.filter((f) => f.a && f.b && R.has(f.a) && R.has(f.b))) {
    const a = R.get(f.a!)!, b = R.get(f.b!)!, bad = f.params.some((p) => !p.ok);
    const sa = slot(f.a!), sb = slot(f.b!);
    const xa = a.x + Math.min(a.w - 12, 14 + sa * 22), xb = b.x + b.w - Math.min(b.w - 12, 14 + sb * 22);
    edges.push({ k: "iface", bad, pts: [[xa, a.y + rh], [xa, lane], [xb, lane], [xb, b.y + rh]], label: `${f.sn} ${f.name}${bad ? " ⚠" : ""}`, lx: (xa + xb) / 2, ly: lane - 5 });
    lane += 24;
  }
  return { nodes, edges, bottom: lane };
}

const REQ_CAT: Record<number, string> = { 3: "SystemRequirement", 4: "SubsystemRequirement", 5: "ComponentRequirement" };
const LOOP_ADD: Add[] = [{ label: "方案", category: "DesignAlternative" }, { label: "風險", category: "Risk" }, { label: "決策", category: "DesignDecision" }];
const loopLabel = "設計迴圈（提案 → 方案分析 → FMEA → 是否解決 → CAD／示意 → 計算 → 是否符合需求）";

/** 第 1 層：追溯欄位圖 */
export function specL1(M: Model): Spec {
  const els = M.inView("L1");
  const cols: [string, U[], number][] = [
    ["需求書", els.filter((e) => e.kind === "source"), 150],
    ["利害關係人・關注", els.filter((e) => e.kind === "stakeholder" || e.kind === "concern"), 185],
    ["使用情境", els.filter((e) => e.kind === "usecase"), 185],
    ["需要・目標", els.filter((e) => e.kind === "need" || e.kind === "goal"), 185],
    ["MOE", els.filter((e) => e.kind === "moe"), 180],
    ["任務需求・衝突", els.filter((e) => e.kind === "req" || e.kind === "conflict"), 190],
  ];
  const nodes: DNode[] = [], heads: Spec["heads"] = [], col = new Map<string, number>(); let x = 20;
  cols.forEach(([t, items, w], ci) => {
    heads!.push({ x, y: 26, t });
    column(items, x, 40, w, 10, (e, xx, yy, ww) => { col.set(e.id, ci); return box(M, e, xx, yy, ww, { tone: ci === 5 && e.kind === "req" ? "out" : undefined }); }).nodes.forEach((n) => nodes.push(n));
    x += w + 13;
  });
  const edges: DEdge[] = [];
  for (const e of els) for (const r of [...e.from, ...e.concerns, ...(e.stakeholder ? [e.stakeholder] : []), ...(e.req ? [e.req] : [])]) {
    const a = col.get(r), b = col.get(e.id);
    if (a == null || b == null || a === b) continue;
    const [L, R] = a < b ? [r, e.id] : [e.id, r];
    edges.push({ f: L, fs: "r", t: R, ts: "l", k: "trace" });
  }
  const bottom = Math.max(60, ...nodes.map((n) => n.y + nodeH(n)));
  return { label: "第 1 層　任務定義", nodes, edges, heads, zones: [{ y: 6, h: bottom + 4, label: "", add: [{ label: "利害關係人", category: "Stakeholder" }, { label: "期望", category: "Expectation" }, { label: "使用案例", category: "UseCase" }, { label: "需要", category: "Need" }, { label: "目標", category: "Goal" }, { label: "MOE", category: "MOE" }, { label: "任務需求", category: "MissionRequirement" }] }] };
}

/** 第 2 層：設計迴圈＋剖面節點＋模式 */
export function specL2(M: Model, live: Live | null = null): Spec {
  const els = M.inView("L2"), nodes: DNode[] = [], edges: DEdge[] = [];
  const mrs = M.list.filter((e) => e.kind === "req" && e.layer === 1);
  const acts = els.filter((e) => e.kind === "action").sort((a, b) => a.seq - b.seq);
  const L = loopBand(M, 45, els, { live, blocks: () => acts.map((a) => ({ id: a.id, sn: a.sn, name: `${label(a)}${a.name}`, sub: "" })) });
  nodes.push(...L.nodes); edges.push(...L.edges);
  const inp: DNode = { id: "in", x: 835, y: L.nodes.some((n) => n.id === "tpm") ? 160 : 45, w: 190, kw: "上一層", name: "任務需求", lines: mrs.map((m) => clip(`${label(m)}${m.text || m.name}`, 190)), tone: "in", go: { view: "L1" } };
  nodes.push(inp);
  const loopBottom = Math.max(L.bottom, inp.y + nodeH(inp)) + 24;
  const ay = loopBottom + 40, aw = 172, ag = acts.length > 1 ? (1150 - acts.length * aw) / (acts.length - 1) : 0;
  const an = acts.map((e, i) => box(M, e, 24 + i * (aw + Math.max(8, ag)), ay, aw));
  const ah = Math.max(40, ...an.map(nodeH)); an.forEach((n) => (n.hfix = ah)); nodes.push(...an);
  for (let i = 0; i < an.length - 1; i++) edges.push({ f: an[i].id, fs: "r", t: an[i + 1].id, ts: "l", k: "flow", label: i === 0 ? "then" : "" });
  if (L.adopt && an.length) edges.push({ f: L.adopt.id, fs: "b", t: an[Math.min(3, an.length - 1)].id, ts: "t", to: 0.5, k: "rel", label: "放行後展開", my: ay - 18 });
  const sts = els.filter((e) => e.kind === "state");
  const sy = ay + ah + 70, sw = 330, sg = sts.length > 1 ? (1100 - sts.length * sw) / (sts.length - 1) : 0;
  const sn = sts.map((e, i) => box(M, e, 50 + i * (sw + Math.max(8, sg)), sy, sw));
  const sh = Math.max(40, ...sn.map(nodeH)); sn.forEach((n) => (n.hfix = sh));
  if (sts.length) nodes.push({ id: "mdf", x: 30, y: sy - 30, w: 1140, hfix: sh + 50 + 14 * 2, frame: true, kw: "«state def»", name: "模式", lines: [], tone: "frame" });
  nodes.push(...sn);
  const S = new Map(sn.map((n) => [n.id, n]));
  let off = 0;
  for (const s of sts) for (const t of s.transitions) {
    const a = S.get(s.id), b = S.get(t.to); if (!a || !b) continue;
    const fwd = b.x > a.x, yb = sy + sh + 14 + (off++ % 3) * 9;
    const xa = a.x + a.w * (fwd ? 0.7 : 0.3), xb = b.x + b.w * (fwd ? 0.3 : 0.7);
    edges.push(fwd ? { k: "flow", pts: [[xa, sy], [xa, sy - 10 - off * 3], [xb, sy - 10 - off * 3], [xb, sy]] } : { k: "flow", pts: [[xa, sy + sh], [xa, yb], [xb, yb], [xb, sy + sh]] });
  }
  return { label: "第 2 層　任務剖面", nodes, edges, zones: [
    { y: 10, h: loopBottom - 10, label: loopLabel, add: LOOP_ADD },
    { y: loopBottom + 10, h: sy + sh + 50 - loopBottom, label: "任務剖面（決策後展開）：每個節點要做到什麼・模式", add: [{ label: "剖面節點", category: "MissionPhase" }, { label: "模式", category: "Mode" }] },
  ] };
}

/** 第 3–5 層：需求帶＋設計迴圈帶＋架構帶 */
export function specArch(M: Model, k: string, live: Live | null = null): Spec {
  const v = M.V.get(k)!, els = M.inView(k), nodes: DNode[] = [], edges: DEdge[] = [];
  const reqs = els.filter((e) => e.kind === "req");
  const up = [...new Set(reqs.flatMap((r) => r.from))].filter((id) => M.viewOf.get(id) !== k);
  const ow = M.U.get(v.owner!)!;
  const pv = v.parent ? M.V.get(v.parent) : undefined;
  const inl = [`配額 ≤ ${fmt(ow.alloc)} kg`, ...up.map((id) => { const u = M.U.get(id)!; return clip(`${label(u)}${u.text || u.name}`, 200); })];
  const inp: DNode = { id: "in", x: 20, y: 45, w: 200, kw: "上一層", name: `${pv?.short ?? ""} 給的`, lines: inl, tone: "in", go: { view: v.parent ?? "L2" } };
  nodes.push(inp);
  const G = grid(reqs, 240, 45, 4, 228, 12, 14, (e, x, y, w) => box(M, e, x, y, w));
  nodes.push(...G.nodes);
  if (G.nodes[0]) edges.push({ f: G.nodes[0].id, fs: "l", fo: 0.4, t: "in", ts: "r", to: 0.3, k: "derive", label: "«derive»" });
  const rb = Math.max(G.bottom, inp.y + nodeH(inp)) + 20;
  const L = loopBand(M, rb + 40, els, { owner: v.owner!, live, blocks: () => ow.kids.map((c) => M.U.get(c)!).filter(Boolean).map((c) => ({ id: c.id, sn: c.sn, name: c.name, sub: c.mass != null ? c.mass.toFixed(2) + " kg" : "" })) });
  nodes.push(...L.nodes); edges.push(...L.edges);
  const lb = L.bottom + 24;
  const A = archBand(M, lb + 50, v.owner!, L.dec, els.filter((e) => e.kind === "iface"), L.adopt);
  nodes.push(...A.nodes); edges.push(...A.edges);
  const zh = v.layer === 3 ? "系統需求（依剖面節點寫）" : v.layer === 4 ? "次系統需求（«derive» 上層需求＋#basis）" : "元件需求";
  return { label: v.title, nodes, edges, zones: [
    { y: 10, h: rb - 10, label: zh, add: [{ label: "需求", category: REQ_CAT[v.layer] ?? "ComponentRequirement" }] },
    { y: rb + 10, h: lb - rb - 10, label: loopLabel, add: LOOP_ADD },
    { y: lb + 10, h: A.bottom - lb + 6, label: "架構・介面・配額（決策後展開）", add: [{ label: v.layer >= 4 ? "元件" : "次系統", category: v.layer >= 4 ? "Component" : "Subsystem" }] },
  ] };
}

/** 一張圖的統計：需求數、待驗證數、決策狀態 */
export function viewStats(M: Model, k: string) {
  const els = M.inView(k), reqs = els.filter((e) => e.kind === "req"), pend = reqs.filter((r) => r.st === "pend").length;
  const decs = els.filter((e) => e.kind === "decision"), hold = decs.filter((d) => d.gate !== "ok");
  const lines = [`需求 ${reqs.length} 條（待驗證 ${pend}）`];
  if (decs.length) lines.push(clip("決策 " + decs.map((d) => d.chosen || d.name).join("、"), 230));
  return { lines, badge: (!decs.length ? null : hold.length ? ["喊卡中", "hold"] : ["已放行", "ok"]) as [string, string] | null, reqs: reqs.length, pend, hold };
}

/** 模型地圖：一層一列，系統 → 次系統 → 元件，點框打開那一層 */
export function specMap(M: Model): Spec {
  const nodes: DNode[] = [], edges: DEdge[] = [], heads: Spec["heads"] = [], W = 230;
  const vnode = (id: string, k: string, x: number, y: number, kw: string, name: string, tone: Tone, extra: string[] = []) => {
    const s = viewStats(M, k); const n: DNode = { id, x, y, w: W, kw, name, lines: [...s.lines, ...extra], tone, badge: s.badge, go: { view: k } }; nodes.push(n); return n;
  };
  const subs = M.systems.flatMap((s) => M.drillKids(s.id).map((p) => [s, p] as const));
  const n = Math.max(1, subs.length), gap = 34, x0 = 600 - (n * W + (n - 1) * gap) / 2 + 30;
  const Y = [40, 160, 290, 450, 640];
  ["第 1 層　任務定義", "第 2 層　任務剖面", "第 3 層　系統", "第 4 層　次系統", "第 5 層　元件"].forEach((t, i) => heads!.push({ x: 20, y: Y[i] - 12, t }));
  vnode("m1", "L1", 600 - W / 2 + 30, Y[0], "任務定義", "需求書 → 任務需求", "build");
  vnode("m2", "L2", 600 - W / 2 + 30, Y[1], "任務剖面", "剖面候選 → 節點與模式", "build");
  edges.push({ f: "m1", fs: "b", t: "m2", ts: "t", k: "flow", label: "任務需求" });
  const subX = new Map<string, number>(); subs.forEach(([, p], i) => subX.set(p.id, x0 + i * (W + gap)));
  M.systems.forEach((s, si) => {
    const xs = M.drillKids(s.id).map((p) => subX.get(p.id)!);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs) + W) / 2 - W / 2 : 600 - W / 2 + 30 + si * (W + gap);
    vnode("s:" + s.id, viewKeyOfPart(s.id), cx, Y[2], "«part def» " + s.sn, s.name, "out", [`質量 ${fmt(s.mass)}／配額 ${fmt(s.alloc)} kg`]);
    edges.push({ f: "m2", fs: "b", t: "s:" + s.id, ts: "t", k: "flow", label: "剖面產出" });
  });
  subs.forEach(([s, p]) => {
    const others = p.kids.filter((c) => !M.V.has(viewKeyOfPart(c))).length;
    vnode("b:" + p.id, viewKeyOfPart(p.id), subX.get(p.id)!, Y[3], "«part» " + p.sn, p.name, "out", [`質量 ${fmt(p.mass)}／配額 ${fmt(p.alloc)} kg`, `其他零件 ${others} 個`]);
    edges.push({ f: "s:" + s.id, fs: "b", t: "b:" + p.id, ts: "t", k: "comp", my: Y[3] - 26 });
    M.drillKids(p.id).forEach((c, j) => {
      vnode("c:" + c.id, viewKeyOfPart(c.id), subX.get(p.id)!, Y[4] + j * 130, "«part» " + c.sn, c.name, "out", [`質量 ${fmt(c.mass)}／配額 ${fmt(c.alloc)} kg`]);
      edges.push({ f: "b:" + p.id, fs: "b", t: "c:" + c.id, ts: "t", k: "comp" });
    });
  });
  return { label: "模型地圖", nodes, edges, heads };
}

export function specFor(M: Model, k: string, live: Live | null = null): Spec | null {
  if (k === "map") return specMap(M);
  if (k === "L1") return specL1(M);
  if (k === "L2") return specL2(M, live);
  return M.V.has(k) ? specArch(M, k, live) : null;
}
