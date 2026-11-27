// 模型頁（C＋D）：從解析結果推出「層級圖」要用的資料。
// 一層一張圖：第 1 層任務定義、第 2 層任務剖面、每個系統、每個次系統、每個有組成零件的元件。
// 每個元素歸到一張圖：需求看滿足者、TPM 與介面看所在的定義，方案、風險、決策、衝突順著關係找到已歸屬的鄰居（同層優先）。
import type { Element, Relation, View } from "../../api.ts";

export type UKind = "source" | "stakeholder" | "concern" | "usecase" | "need" | "goal" | "moe" | "req" | "alt" | "trade" | "risk" | "decision" | "tpm" | "part" | "iface" | "conflict" | "action" | "state";
export type St = "ok" | "pend" | "bad";
export interface Variant { id: string; name: string; picked: boolean; rejectWhy: string; scores: Record<string, number>; adj: Record<string, number> }
export interface Crit { id: string; name: string; w: number; scale: string; key: string }
export interface Param { p: string; a: string; b: string; ok: boolean }
/** 圖上的一個元素（id 是解析器的元素 id；trade 是合成的：每個有準則的設計方案一張比較表） */
export interface U {
  id: string; sn: string; kind: UKind; layer: number; name: string; text: string; why: string; judge: string; el: Element;
  from: string[]; basis: string[]; sat: string | null; expr: string; st: St | null;
  variants: Variant[]; vkind: string; crit: Crit[]; alt: string | null; merged: string[]; dec: string | null; sens: string;
  L: number | null; C: number | null; L2: number | null; C2: number | null; mitig: string; fix: string; state: string; targets: string[];
  chosen: string; by: string; on: string; gate: "ok" | "hold"; holdWhy: string;
  vals: { gate: string; v: number }[]; thr: number | null; dir: "le" | "ge"; unit: string; req: string | null;
  alloc: number | null; mass: number | null; owner: string; parent: string | null; kids: string[];
  a: string | null; b: string | null; params: Param[]; type: string; agreeA: string; agreeB: string;
  seq: number; next: string | null; transitions: { to: string; on: string }[];
  stakeholder: string | null; actors: string[]; concerns: string[]; abnormal: boolean;
  moe: { min: string; full: string; ext: string; current: string; unit: string } | null;
}
export interface LView { k: string; layer: number; title: string; short: string; parent: string | null; owner: string | null }
export interface Model {
  U: Map<string, U>; list: U[]; views: LView[]; V: Map<string, LView>; viewOf: Map<string, string>;
  inView: (k: string) => U[]; back: Map<string, string[]>; systems: U[]; drillKids: (pid: string) => U[];
  /** 元素所在的圖（零件：上層定義的圖） */
  where: (id: string) => string | null;
}

const num = (s: string | undefined): number | null => { if (s == null) return null; const m = String(s).match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const REQ_LAYER: Record<string, number> = { MissionRequirement: 1, SystemRequirement: 3, SubsystemRequirement: 4, ComponentRequirement: 5 };
const LAYER_TAG: Record<string, number> = { mission: 2, system: 3, subsystem: 4, component: 5 };
/** 專案啟用的 TPM 節點欄位（server/metamodel.ts 的 TPM_GATES） */
const TPM_FIELDS: [string, string][] = [["proposal", "atProposal"], ["mdr", "atMDR"], ["pdr", "atPDR"], ["cdr", "atCDR"], ["trr", "atTRR"], ["frr", "atFRR"]];
export const GATE_ZH: Record<string, string> = { proposal: "提案", mdr: "MDR", pdr: "PDR", cdr: "CDR", trr: "TRR", frr: "FRR" };

function blank(e: Element, kind: UKind, layer: number): U {
  return {
    id: e.id, sn: e.shortName ?? "", kind, layer, name: e.name, text: e.doc ?? "", why: e.attrs.why ?? "", judge: e.attrs.judge ?? "", el: e,
    from: [], basis: [], sat: null, expr: "", st: null, variants: [], vkind: "", crit: [], alt: null, merged: [], dec: null, sens: "",
    L: null, C: null, L2: null, C2: null, mitig: "", fix: "", state: "", targets: [], chosen: "", by: "", on: "", gate: "ok", holdWhy: "",
    vals: [], thr: null, dir: "le", unit: "", req: null, alloc: null, mass: null, owner: "", parent: null, kids: [],
    a: null, b: null, params: [], type: "", agreeA: "", agreeB: "", seq: 0, next: null, transitions: [],
    stakeholder: null, actors: [], concerns: [], abnormal: false, moe: null,
  };
}

export function buildModel(view: View): Model {
  const a = view.analysis;
  const els = a.elements.filter((e) => !e.shared && e.file !== "JRI.sysml");
  const byId = new Map(els.map((e) => [e.id, e]));
  const rel = a.relations;
  const out = (id: string, kinds?: string[]) => rel.filter((r) => r.from === id && (!kinds || kinds.includes(r.kind)));
  const inn = (id: string, kinds?: string[]) => rel.filter((r) => r.to === id && (!kinds || kinds.includes(r.kind)));
  const U = new Map<string, U>();
  const put = (u: U) => { U.set(u.id, u); return u; };

  // 零件定義與組成
  const defs = els.filter((e) => e.kind === "PartDefinition" && ["System", "Subsystem", "Component"].includes(e.category ?? ""));
  const defIds = new Set(defs.map((d) => d.id));
  const childDefs = (d: Element) => els.filter((x) => x.owner === d.id && x.kind === "PartUsage").map((x) => x.typeIds.find((t) => defIds.has(t))).filter((t): t is string => !!t);
  const parentOf = new Map<string, string>();
  for (const d of defs) for (const c of childDefs(d)) if (!parentOf.has(c)) parentOf.set(c, d.id);
  for (const d of defs) {
    const u = put(blank(d, "part", d.category === "System" ? 3 : d.category === "Subsystem" ? 4 : 5));
    u.parent = parentOf.get(d.id) ?? null; u.kids = childDefs(d); u.mass = num(d.attrs.mass); u.alloc = num(d.attrs.massBudget ?? d.attrs.massLimit); u.owner = d.attrs.owner ?? "";
  }
  // 零件的層＝它自己那張圖的層：最上層依類別（系統 3、次系統 4、元件 5），往下每一層加一，最多到 5
  const CAT_LAYER: Record<string, number> = { System: 3, Subsystem: 4, Component: 5 };
  const layerOf = (id: string, n = 0): number => { const p = parentOf.get(id); return p && n < 20 ? Math.min(5, layerOf(p, n + 1) + 1) : CAT_LAYER[byId.get(id)?.category ?? ""] ?? 5; };
  for (const u of U.values()) if (u.kind === "part") u.layer = layerOf(u.id);

  const satisfier = (reqId: string) => inn(reqId, ["satisfy"]).map((r) => r.from).find((f) => defIds.has(f)) ?? null;
  const ports = els.filter((e) => e.kind === "PortUsage" && e.shortName);
  for (const e of els) {
    const c = e.category ?? "";
    let u: U | null = null;
    if (e.kind === "RequirementUsage" && !c) u = blank(e, "source", 1);
    else if (c === "Stakeholder" && /Usage$/.test(e.kind)) { u = blank(e, "stakeholder", 1); u.text = e.attrs.role ?? e.doc ?? ""; }
    else if (c === "Expectation") { u = blank(e, "concern", 1); u.stakeholder = out(e.id, ["trace"]).find((r) => r.form === "stakeholder")?.to ?? null; }
    else if (c === "UseCase" && /Usage$/.test(e.kind)) { u = blank(e, "usecase", 1); u.actors = out(e.id, ["trace"]).filter((r) => r.form === "actor").map((r) => r.to); u.abnormal = e.attrs.abnormal === "true"; }
    else if (c === "Need") u = blank(e, "need", 1);
    else if (c === "Goal" || c === "Objective") u = blank(e, "goal", 1);
    else if (c === "MOE") { u = blank(e, "moe", 1); u.moe = { min: e.attrs.threshold ?? "", full: e.attrs.goal ?? "", ext: e.attrs.stretch ?? "", current: e.attrs.current ?? "", unit: e.attrs.unit ?? "" }; u.req = out(e.id, ["refine"])[0]?.to ?? null; }
    else if (c in REQ_LAYER && e.kind === "RequirementUsage") {
      u = blank(e, "req", REQ_LAYER[c]); u.expr = e.attrs.condition ?? ""; u.sat = satisfier(e.id);
      const s = (e.attrs.verifyStatus ?? "").trim(); const sat = a.satisfaction.find((x) => x.requirement === e.qualifiedName.replace(/^Project::/, "") || x.requirement === e.qualifiedName);
      u.st = s === "ok" || s === "pend" || s === "bad" ? s : sat?.status === "holds" ? "ok" : sat?.status === "fails" ? "bad" : null;
    } else if (c === "DesignAlternative" && e.kind === "PartDefinition") { u = blank(e, "alt", LAYER_TAG[e.attrs.layer ?? ""] ?? 3); u.vkind = e.doc.includes("做法") ? "action" : "part"; u.sens = e.attrs.sensitivity ?? ""; }
    else if (c === "Risk") {
      u = blank(e, "risk", LAYER_TAG[e.attrs.layer ?? ""] ?? 3);
      u.L = num(e.attrs.likelihood); u.C = num(e.attrs.severity); u.L2 = num(e.attrs.residualLikelihood); u.C2 = num(e.attrs.residualSeverity);
      u.mitig = e.attrs.mitigation ?? ""; u.fix = e.attrs.fixNote ?? ""; u.state = e.attrs.status ?? ""; u.text = e.attrs.effect ?? e.doc;
      u.targets = out(e.id, ["trace", "fix"]).map((r) => r.to);
    } else if (c === "DesignDecision") {
      u = blank(e, "decision", LAYER_TAG[e.attrs.layer ?? ""] ?? 3);
      u.by = e.attrs.decidedBy ?? ""; u.on = e.attrs.decidedOn ?? ""; u.gate = e.attrs.releaseStatus === "hold" ? "hold" : "ok"; u.holdWhy = e.attrs.holdReason ?? "";
    } else if (e.kind === "ItemUsage" && !c && e.attrs.conflictState != null) { u = blank(e, "conflict", LAYER_TAG[e.attrs.layer ?? ""] ?? 3); u.state = e.attrs.conflictState; u.targets = out(e.id, ["trace"]).map((r) => r.to); }
    else if (e.tags.includes("TPM")) {
      u = blank(e, "tpm", 3);
      u.vals = TPM_FIELDS.filter(([g, f]) => view.project.gates.includes(g) && e.attrs[f] != null).map(([g, f]) => ({ gate: g, v: Number(e.attrs[f]) }));
      const t = e.attrs.target ?? ""; u.dir = /≥|>=/.test(t) ? "ge" : "le"; u.thr = num(t); u.unit = t.replace(/^[^\d-]*-?\d+(\.\d+)?\s*/, "").trim();
      u.req = out(e.id, ["trace"])[0]?.to ?? null;
    } else if (e.kind === "InterfaceUsage") {
      u = blank(e, "iface", 3); u.type = e.attrs.kind ?? "";
      const end = (side: string) => ports.find((p) => p.shortName === `${e.shortName}-${side}`)?.owner ?? null;
      u.a = end("A"); u.b = end("B"); u.agreeA = e.attrs.agreedA ?? ""; u.agreeB = e.attrs.agreedB ?? "";
      for (let i = 1; e.attrs[`param${i}`] != null; i++) u.params.push({ p: e.attrs[`param${i}`], a: e.attrs[`param${i}A`] ?? "", b: e.attrs[`param${i}B`] ?? "", ok: e.attrs[`param${i}Ok`] !== "false" });
    } else if (c === "MissionPhase" && e.kind === "ActionUsage") u = blank(e, "action", 2);
    else if (c === "Mode" && e.kind === "StateUsage") u = blank(e, "state", 2);
    if (u) put(u);
  }
  // 關係：derive、basis、需要／目標的來源、關注、決策
  for (const u of U.values()) {
    u.from = out(u.id, ["derive"]).map((r) => r.to).filter((t) => U.has(t));
    u.basis = out(u.id, ["basis"]).map((r) => r.to).filter((t) => U.has(t));
    if (u.kind === "concern") u.from.push(...out(u.id, ["trace"]).filter((r) => !r.form).map((r) => r.to).filter((t) => U.has(t)));
    if (u.kind === "usecase") u.concerns = out(u.id, ["trace"]).filter((r) => !r.form && U.get(r.to)?.kind === "concern").map((r) => r.to);
  }
  // 剖面節點的順序、模式的轉移
  const acts = [...U.values()].filter((u) => u.kind === "action");
  for (const u of acts) u.next = out(u.id, ["succession"]).map((r) => r.to).find((t) => U.has(t)) ?? null;
  const firsts = acts.filter((u) => !acts.some((x) => x.next === u.id));
  let seq = 0; for (const f of firsts) for (let cur: U | undefined = f, n = 0; cur && n < 50; cur = cur.next ? U.get(cur.next) : undefined, n++) if (!cur.seq) cur.seq = ++seq;
  for (const u of [...U.values()].filter((x) => x.kind === "state")) u.transitions = out(u.id, ["transition"]).filter((r) => U.has(r.to)).map((r) => ({ to: r.to, on: "" }));

  // 方案與比較：候選、準則（連到方案的需求）、分數、決策
  const decisions = [...U.values()].filter((u) => u.kind === "decision");
  for (const alt of [...U.values()].filter((u) => u.kind === "alt")) {
    const vs = els.filter((x) => x.owner === alt.id && x.kind === "PartUsage");
    const chosen = new Set(decisions.flatMap((d) => out(d.id, ["trace"]).map((r) => r.to)));
    alt.variants = vs.map((v) => ({ id: v.id, name: v.name, picked: chosen.has(v.id), rejectWhy: v.attrs.rejectWhy ?? "", scores: {}, adj: {} }));
    const critEls = out(alt.id, ["trace", "derive", "refine"]).map((r) => byId.get(r.to)).filter((x): x is Element => !!x && /Requirement|MOP/.test(x.category ?? "") && x.kind === "RequirementUsage");
    alt.crit = critEls.map((c) => ({ id: c.id, name: c.name, w: Number(c.attrs.weight ?? 1), key: (c.shortName ?? "").replace(/\W/g, "_"),
      scale: ["1", "3", "5"].filter((k) => c.attrs[`scale${k}`]).map((k) => `${k}＝${c.attrs[`scale${k}`]}`).join("；") }));
    for (const v of alt.variants) { const ve = byId.get(v.id)!; for (const c of alt.crit) { const s = num(ve.attrs[`score_${c.key}`]); if (s != null) v.scores[c.id] = s; const j = num(ve.attrs[`adjusted_${c.key}`]); if (j != null) v.adj[c.id] = j; } }
    const dec = decisions.find((d) => out(d.id, ["trace"]).some((r) => r.to === alt.id || alt.variants.some((v) => v.id === r.to)));
    if (dec) { dec.alt = alt.id; dec.chosen = alt.variants.find((v) => v.picked && out(dec.id, ["trace"]).some((r) => r.to === v.id))?.name ?? ""; }
    if (alt.crit.length) {
      // 比較表：示意寫法有一個套件（例如 TS-10）連到方案；沒有就用方案本身
      const pkg = inn(alt.id, ["trace"]).map((r) => byId.get(r.from)).find((x) => x?.kind === "Package");
      const t = blank(pkg ?? alt.el, "trade", alt.layer);
      t.id = `trade:${alt.id}`; t.alt = alt.id; t.crit = alt.crit; t.variants = alt.variants; t.dec = dec?.id ?? null; t.sens = alt.sens;
      t.name = pkg?.name ?? `${alt.name}比較`; t.sn = pkg?.shortName ?? "";
      t.merged = pkg ? out(pkg.id, ["trace"]).map((r) => r.to).filter((x) => U.get(x)?.kind === "req") : [];
      put(t);
    }
  }

  // ── 視圖 ──
  const views: LView[] = [
    { k: "L1", layer: 1, title: "第 1 層　任務定義", short: "任務定義", parent: null, owner: null },
    { k: "L2", layer: 2, title: "第 2 層　任務剖面", short: "任務剖面", parent: "L1", owner: null },
  ];
  const parts = [...U.values()].filter((u) => u.kind === "part");
  const hasView = (p: U) => p.layer === 3 || p.layer === 4 || (p.layer === 5 && p.kids.length > 0);
  const vk = (id: string) => `p:${id}`;
  const order = (p: U): string => (p.parent ? order(U.get(p.parent)!) + "/" : "") + p.name;
  for (const p of parts.filter(hasView).sort((x, y) => x.layer - y.layer || order(x).localeCompare(order(y)))) {
    const zh = p.layer === 3 ? "系統" : p.layer === 4 ? "次系統" : "元件";
    let parent: string | null = "L2";
    for (let q = p.parent; q; q = U.get(q)?.parent ?? null) if (hasView(U.get(q)!)) { parent = vk(q); break; }
    views.push({ k: vk(p.id), layer: p.layer, title: `第 ${p.layer} 層　${zh}：${p.name}`, short: p.name, parent, owner: p.id });
  }
  const V = new Map(views.map((v) => [v.k, v]));
  const viewOf = new Map<string, string>();
  const defView = (id: string | null): string | null => { for (let q = id; q; q = U.get(q)?.parent ?? null) if (V.has(vk(q))) return vk(q); return null; };
  const atLayer = (id: string | null, layer: number): string | null => {
    for (let q = id; q; q = U.get(q)?.parent ?? null) { const v = V.get(vk(q)); if (v && v.layer <= layer) return v.k; }
    return defView(id);
  };
  for (const u of U.values()) {
    if (["source", "stakeholder", "concern", "usecase", "need", "goal", "moe"].includes(u.kind) || (u.kind === "req" && u.layer === 1)) viewOf.set(u.id, "L1");
    else if (u.kind === "action" || u.kind === "state") viewOf.set(u.id, "L2");
    else if (u.kind === "conflict" && u.layer <= 2) viewOf.set(u.id, "L1");
    else if (u.kind === "req" && u.sat) { const v = atLayer(u.sat, u.layer); if (v) viewOf.set(u.id, v); }
    else if (u.kind === "tpm" || u.kind === "iface") { const v = defView(u.el.owner); if (v) viewOf.set(u.id, v); }
    else if (u.kind === "part" && V.has(vk(u.id))) viewOf.set(u.id, vk(u.id));
    else if (u.kind === "part") { const v = defView(u.parent); if (v) viewOf.set(u.id, v); }
    else if (["alt", "risk", "decision"].includes(u.kind) && u.layer <= 2) viewOf.set(u.id, "L2");
  }
  // 其餘（方案、比較、風險、決策、衝突、沒有滿足者的需求）：順著關係找已歸屬的鄰居，同層優先
  const nb = (id: string) => [...rel.filter((r) => r.from === id).map((r) => r.to), ...rel.filter((r) => r.to === id).map((r) => r.from)];
  const tradeOf = (u: U) => (u.kind === "trade" ? [u.alt!, ...u.merged] : []);
  // 同層找不到鄰居時：同層、而且套件相同的元素最多的那張圖（例如掛在系統層介面上的次系統風險，回到它所在次系統的圖）
  const pkgOf = (e: Element) => { const q = e.qualifiedName.split("::"); return q[0] === "Project" ? q.slice(0, 2).join("::") : q[0]; };
  const byPackage = (u: U): string | undefined => {
    const count = new Map<string, number>();
    for (const [id, k] of viewOf) { const x = U.get(id); if (x && V.get(k)!.layer === u.layer && pkgOf(x.el) === pkgOf(u.el)) count.set(k, (count.get(k) ?? 0) + 1); }
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const u of U.values()) {
      if (viewOf.has(u.id)) continue;
      const cands = [...nb(u.el.id), ...tradeOf(u), ...(u.kind === "alt" ? [`trade:${u.id}`] : [])].map((x) => viewOf.get(x)).filter((x): x is string => !!x);
      const same = cands.find((k) => V.get(k)!.layer === u.layer) ?? (round >= 3 ? byPackage(u) ?? cands[0] : undefined);
      if (same) { viewOf.set(u.id, same); changed = true; }
    }
    if (!changed && round >= 3) break;
  }
  // 被誰引用：所有指向它的關係（含 satisfy 的滿足者）
  const back = new Map<string, string[]>();
  for (const r of rel) if (U.has(r.from) && U.has(r.to)) back.set(r.to, [...(back.get(r.to) ?? []), r.from]);
  const list = [...U.values()];
  const inView = (k: string) => list.filter((u) => viewOf.get(u.id) === k);
  const systems = parts.filter((p) => !p.parent && p.layer === 3);
  const drillKids = (pid: string) => (U.get(pid)?.kids ?? []).map((k) => U.get(k)!).filter((p) => p && V.has(vk(p.id)));
  const where = (id: string) => { const u = U.get(id); if (!u) return null; if (u.kind === "part") return defView(u.parent) ?? viewOf.get(id) ?? null; return viewOf.get(id) ?? null; };
  return { U, list, views, V, viewOf, inView, back, systems, drillKids, where };
}

export const viewKeyOfPart = (id: string) => `p:${id}`;
export type { Relation };
