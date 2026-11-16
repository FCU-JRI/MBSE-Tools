// P5：FMEA、風險與圖表的計算（METHOD.md 第 7 節）。只讀模型、不改模型；網頁與伺服器共用（伺服器的匯出與測試也用這裡）。
// 不依賴 React 或瀏覽器，輸入是解析結果的最小子集。
//
// 模型裡的寫法（library/JRI.sysml 的 P5 區塊）：
//   失效模式（FailureMode）→ 功能、→ 次系統：#trace dependency，表示這一列屬於哪個「次系統 × 功能」的分配
//   風險 → 需求：威脅的需求；風險 → 失效模式：來源；風險 → 其他元素：掛在哪個層級
//   需求 → 風險：緩解措施產生的需求（來源是風險）；驗證事件 → 風險或失效模式：追加的驗證

export interface P5Element {
  id: string; kind: string; category: string | null; name: string; shortName: string | null; qualifiedName: string;
  owner: string | null; doc: string; types: string[]; typeIds: string[]; attrs: Record<string, string>;
}
export interface P5Relation { kind: string; from: string; to: string }
export interface P5Connector { fromChain: string[]; toChain: string[] }
export interface P5Analysis { elements: P5Element[]; relations: P5Relation[]; connectors?: P5Connector[] }

// ───────── 比賽附件 12 的三張尺度定義表（只取格式與判定準則，不含範例內容）─────────

export interface ScaleRow { value: number; group: string; criterion: string; note?: string }

/** 發生度 O：在項目的可靠度／設計壽命內的發生頻率。 */
export const SCALE_O: ScaleRow[] = [
  { value: 10, group: "很高", criterion: "新技術或新設計，沒有前例也沒有用相似設計測試過；可能持續發生", note: "≥ 1/10" },
  { value: 9, group: "高", criterion: "新設計、新應用或變更，失效較少掌握，未用相似設計測試過", note: "≥ 1/20" },
  { value: 8, group: "高", criterion: "新設計、新應用或變更，評估有機會發生，未用相似設計測試過", note: "≥ 1/50" },
  { value: 7, group: "高", criterion: "新設計、新應用或變更，評估不容易發生，但未用相似設計測試過", note: "≥ 1/100" },
  { value: 6, group: "中", criterion: "相似設計或模擬／測試時頻繁失效", note: "≥ 1/500" },
  { value: 5, group: "中", criterion: "相似設計或模擬／測試時偶爾失效", note: "≥ 1/2,000" },
  { value: 4, group: "中", criterion: "相似設計或模擬／測試時個別失效", note: "≥ 1/10,000" },
  { value: 3, group: "低", criterion: "幾乎相同的設計或模擬／測試時僅個別失效", note: "≥ 1/100,000" },
  { value: 2, group: "低", criterion: "幾乎相同的設計或模擬／測試時沒有察覺失效", note: "≥ 1/1,000,000" },
  { value: 1, group: "很低", criterion: "已由預防控制消除失效", note: "清除失效" },
];

/** 嚴重度 S：失效的影響。 */
export const SCALE_S: ScaleRow[] = [
  { value: 10, group: "不符合安全性或法規", criterion: "影響火箭安全運行或不符法規，發生前無法預警" },
  { value: 9, group: "不符合安全性或法規", criterion: "影響火箭安全運行或不符法規，發生前可以預警" },
  { value: 8, group: "基本功能喪失或降低", criterion: "基本功能喪失，全箭系統不能運作，無安全問題" },
  { value: 7, group: "基本功能喪失或降低", criterion: "基本功能部分喪失，全箭系統無法有效運作，無安全問題" },
  { value: 6, group: "次要功能喪失或降低", criterion: "次要功能喪失，只剩基本功能可運作，無安全問題" },
  { value: 5, group: "次要功能喪失或降低", criterion: "次要功能部分喪失，運作能力降低，無安全問題" },
  { value: 4, group: "干擾", criterion: "功能正常但不合主要任務要求，預期只能完成 25% 的任務目標" },
  { value: 3, group: "干擾", criterion: "功能正常但不合主要任務要求，預期只能完成 50% 的任務目標" },
  { value: 2, group: "干擾", criterion: "功能正常但不合主要任務要求，預期只能完成 75% 的任務目標" },
  { value: 1, group: "沒有影響", criterion: "沒有可識別的影響" },
];

/** 難檢度 D：在哪個階段發現得了。 */
export const SCALE_D: ScaleRow[] = [
  { value: 10, group: "無", criterion: "失效後沒有任何數據、影像與殘骸：無法檢測或分析", note: "不可能" },
  { value: 9, group: "任何階段不易檢測", criterion: "失效後沒有數據與殘骸，但有影像：不易檢測或分析", note: "很微小" },
  { value: 8, group: "飛試階段檢測", criterion: "通訊中斷、沒有數據，但有殘骸或地面影像紀錄", note: "微小" },
  { value: 7, group: "飛試階段檢測", criterion: "飛試過程中由箭上感測器、影像紀錄等發現", note: "很低" },
  { value: 6, group: "飛試準備階段檢測", criterion: "飛試備便的檢測過程中由箭上感測器、影像等發現（Go/No-Go）", note: "低" },
  { value: 5, group: "飛試準備階段檢測", criterion: "備便過程由操作員量測或工站自動控制發現異常並通知", note: "中等" },
  { value: 4, group: "錯誤偵測", criterion: "自動控制主動偵測異常並鎖定在可承受範圍內", note: "中等偏高" },
  { value: 3, group: "錯誤偵測", criterion: "自動控制主動偵測錯誤異常並剔除", note: "高" },
  { value: 2, group: "錯誤偵測或問題預防", criterion: "在治工具、機械、零件或軟體設計中已設計防錯機制", note: "很高" },
  { value: 1, group: "標準缺失預防設計", criterion: "已驗證的設計標準充分預防，失效無法發生", note: "幾乎確定" },
];

/** 嚴重度達到這個值就一定要有矯正措施（Mars，2026-11-17）。 */
export const MUST_ACT = 8;

// ───────── 共用的小工具 ─────────

const isReq = (e: P5Element | undefined) => !!e && e.kind === "RequirementUsage";
const isVer = (e: P5Element | undefined) => !!e && (e.category === "VerificationEvent" || e.category === "ValidationEvent") && /Usage$/.test(e.kind);
const STRUCT = new Set(["System", "Subsystem", "Component"]);
export const label = (e: P5Element | undefined) => (e ? (e.shortName ? `${e.shortName} ${e.name}` : e.name) : "");
/** 1 到 max 的整數；其他都是 null。 */
export function score(v: string | undefined, max: number): number | null {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}
export const isDone = (v: string | undefined) => /^(是|√|✓|v|y|yes|true|1|完成|已完成|done)$/i.test(String(v ?? "").trim());

class Index {
  byId: Map<string, P5Element>;
  out = new Map<string, P5Relation[]>();
  inn = new Map<string, P5Relation[]>();
  a: P5Analysis;
  constructor(a: P5Analysis) {
    this.a = a;
    this.byId = new Map(a.elements.map((e) => [e.id, e]));
    for (const r of a.relations) {
      (this.out.get(r.from) ?? this.out.set(r.from, []).get(r.from)!).push(r);
      (this.inn.get(r.to) ?? this.inn.set(r.to, []).get(r.to)!).push(r);
    }
  }
  outs(id: string, kind?: string) { return (this.out.get(id) ?? []).filter((r) => !kind || r.kind === kind); }
  ins(id: string, kind?: string) { return (this.inn.get(id) ?? []).filter((r) => !kind || r.kind === kind); }
  get(id: string | null | undefined) { return id ? this.byId.get(id) : undefined; }
  /** 一個使用的型別定義（零件的 part def） */
  defsOf(e: P5Element) { return e.typeIds.map((t) => this.byId.get(t)).filter((x): x is P5Element => !!x); }
  /** 同一個東西的使用與定義都算：零件與它的 part def */
  same(e: P5Element): string[] { return [e.id, ...this.defsOf(e).map((d) => d.id)]; }
  /** 往下游走：衍生、細化、追溯指向它的需求（子需求） */
  downstream(reqs: Iterable<string>): Set<string> {
    const seen = new Set<string>(), queue = [...reqs];
    while (queue.length) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of this.ins(id)) if (["derive", "refine", "trace"].includes(r.kind) && isReq(this.get(r.from))) queue.push(r.from);
    }
    return seen;
  }
  /** 往上游走到目的：衍生、細化、追溯 */
  upstream(reqs: Iterable<string>): Set<string> {
    const seen = new Set<string>(), queue = [...reqs];
    while (queue.length) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const r of this.outs(id)) if (["derive", "refine", "trace"].includes(r.kind) && isReq(this.get(r.to))) queue.push(r.to);
    }
    return seen;
  }
  /** 一個零件或定義底下所有的零件（往下展開型別），不含自己 */
  partsBelow(e: P5Element): P5Element[] {
    const out: P5Element[] = [], seen = new Set<string>(), queue = [...this.same(e)];
    while (queue.length) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const c of this.a.elements) if (c.owner === id && c.kind === "PartUsage") { out.push(c); queue.push(c.id, ...c.typeIds); }
    }
    return out;
  }
}

// ───────── 影響範圍 ─────────

export interface Impact { requirements: string[]; interfaces: number; components: string[]; total: number }

function impactOf(ix: Index, reqs: Iterable<string>, parts: P5Element[]): Impact {
  const r = [...ix.downstream(reqs)];
  const below = parts.flatMap((p) => [p, ...ix.partsBelow(p)]);
  const ids = new Set(below.flatMap((p) => ix.same(p)));
  // 掛在定義上時，以它為型別的零件（介面的端點）也算
  for (const e of ix.a.elements) if (e.kind === "PartUsage" && e.typeIds.some((t) => ids.has(t))) ids.add(e.id);
  const comps = [...new Set(below.filter((p) => p.category === "Component" || ix.defsOf(p).some((d) => d.category === "Component")).map((p) => label(ix.defsOf(p)[0] ?? p)))];
  // 連結與介面（階段 4 的 connectors 已包含 connect）；舊的伺服器沒有 connectors 時改數 connect 關係
  const interfaces = ix.a.connectors
    ? ix.a.connectors.filter((c) => [...c.fromChain, ...c.toChain].some((x) => ids.has(x))).length
    : ix.a.relations.filter((x) => x.kind === "connect" && (ids.has(x.from) || ids.has(x.to))).length;
  return { requirements: r, interfaces, components: comps, total: r.length + interfaces + comps.length };
}

// ───────── 建議值 ─────────

export interface Suggestion { value: number | null; basis: string }

/** 功能牽涉到的需求：和功能直接有關係的需求；沒有的話，用負責執行的次系統所滿足的需求。 */
function requirementsOf(ix: Index, fn: P5Element | undefined, target: P5Element | undefined): { ids: string[]; via: "function" | "subsystem" | "none" } {
  const direct = fn ? [...ix.outs(fn.id), ...ix.ins(fn.id)].map((r) => (r.from === fn.id ? r.to : r.from)).filter((id) => isReq(ix.get(id))) : [];
  if (direct.length) return { ids: [...new Set(direct)], via: "function" };
  const sat = target ? ix.same(target).flatMap((id) => ix.outs(id, "satisfy").map((r) => r.to)).filter((id) => isReq(ix.get(id))) : [];
  if (sat.length) return { ids: [...new Set(sat)], via: "subsystem" };
  return { ids: [], via: "none" };
}

const SAFETY = /安全|safety|危及|人員|場地/i;

export function suggestSeverity(a: P5Analysis, fnId: string | null, targetId: string | null, detection: number | null = null, ix = new Index(a)): Suggestion {
  const fn = ix.get(fnId), target = ix.get(targetId);
  const req = requirementsOf(ix, fn, target);
  if (req.via === "none") return { value: null, basis: "這個功能追不到任何需求，請人評嚴重度。" };
  const up = ix.upstream(req.ids);
  const via = req.via === "function" ? "功能直接連到的需求" : "次系統滿足的需求（功能本身沒有連到需求）";
  const safety = [...up].map((id) => ix.get(id)!).filter((e) => SAFETY.test(`${e.name} ${e.doc} ${e.attrs.requirementType ?? ""} ${e.attrs.reqType ?? ""}`) || e.category === "Expectation" && SAFETY.test(e.doc));
  if (safety.length) {
    const warn = detection !== null && detection <= 8;
    return { value: warn ? 9 : 10, basis: `${via}追到安全相關的項目（${safety.slice(0, 3).map(label).join("、")}）；${warn ? "驗證矩陣有辦法在事前或飛行中發現，可以預警，給 9" : "事前發現不了，無法預警，給 10"}。` };
  }
  // 目的的三級成功判準（MOE）：沿推導鏈往上，看這個功能失效會讓幾個目的做不到
  const objectives = a.elements.filter((e) => e.category === "Objective" && e.kind === "RequirementUsage");
  const hit = new Set([...up].filter((id) => ix.get(id)?.category === "Objective"));
  // 量度（MOE）細化目的：追到 MOE 也算追到它細化的目的
  for (const id of up) if (ix.get(id)?.category === "MOE") for (const r of ix.outs(id)) if (ix.get(r.to)?.category === "Objective") hit.add(r.to);
  if (!objectives.length || !hit.size) return { value: 5, basis: `${via}追不到任何目的：視為次要功能部分喪失，給 5。` };
  const remain = 1 - hit.size / objectives.length;
  const names = [...hit].map((id) => label(ix.get(id))).join("、");
  if (remain <= 0) return { value: 8, basis: `${via}追到所有的目的（${names}）：這個功能失效，任務的目的都做不到，基本功能喪失，給 8。` };
  const v = remain <= 0.25 ? 4 : remain <= 0.5 ? 3 : 2;
  return { value: v, basis: `${via}追到 ${hit.size}／${objectives.length} 個目的（${names}）：失效後預期還能完成約 ${Math.round(remain * 100)}% 的任務目標，給 ${v}。` };
}

export type DetectStage = "ground" | "preflight" | "flight";
const STAGE_D: Record<DetectStage, number> = { ground: 4, preflight: 6, flight: 7 };
const STAGE_ZH: Record<DetectStage, string> = { ground: "地面測試", preflight: "飛試前檢查", flight: "飛行中遙測" };

/** 驗證事件屬於哪個發現階段：名稱與說明的關鍵字優先，其次看驗證方法。 */
export function stageOf(e: P5Element): DetectStage | null {
  const t = `${e.name} ${e.doc}`, kind = e.attrs.kind ?? "";
  if (/遙測|telemetry|飛行中|in-?flight|下傳|飛行測試|飛試量測|flight test/i.test(t)) return "flight";
  if (/飛試前|發射前|備便|pre-?flight|go\s*\/\s*no-?go|檢查表|checklist|上架/i.test(t)) return "preflight";
  if (/地面|靜態|台架|bench|ground|static/i.test(t) || /::test$/.test(kind)) return "ground";
  if (/::inspect$/.test(kind)) return "preflight";
  return null;
}

export function suggestDetection(a: P5Analysis, fnId: string | null, targetId: string | null, fmId: string | null = null, ix = new Index(a)): Suggestion {
  const fn = ix.get(fnId), target = ix.get(targetId);
  const req = requirementsOf(ix, fn, target);
  const reqs = ix.downstream(req.ids);
  const events = new Set<string>();
  for (const id of reqs) for (const r of ix.ins(id, "verify")) if (isVer(ix.get(r.from))) events.add(r.from);
  // 因為這個失效模式追加的驗證
  if (fmId) for (const r of ix.ins(fmId)) if (isVer(ix.get(r.from))) events.add(r.from);
  const found = [...events].map((id) => ({ e: ix.get(id)!, s: stageOf(ix.get(id)!) })).filter((x): x is { e: P5Element; s: DetectStage } => x.s !== null);
  if (!found.length) return { value: 10, basis: events.size ? `驗證矩陣有 ${events.size} 個驗證事件，但沒有地面測試、飛試前檢查或飛行中遙測，給 10。` : "驗證矩陣裡沒有任何能發現這個失效的驗證事件，給 10。" };
  const best = found.reduce((m, x) => (STAGE_D[x.s] < STAGE_D[m.s] ? x : m));
  const stages = [...new Set(found.map((x) => STAGE_ZH[x.s]))].join("、");
  return { value: STAGE_D[best.s], basis: `驗證矩陣有${stages}；最早在${STAGE_ZH[best.s]}（${label(best.e)}）就發現得了，給 ${STAGE_D[best.s]}。` };
}

// ───────── FMEA 工作表 ─────────

export interface FmeaRow {
  key: string;
  /** 失效模式元素；null 是模型產生的骨架列，還沒填 */
  fm: P5Element | null;
  subsystem: { id: string | null; name: string };
  fn: { id: string | null; name: string };
  mode: string; effect: string; cause: string; control: string;
  o: number | null; s: number | null; d: number | null; rpn: number | null;
  sSuggest: Suggestion; dSuggest: Suggestion;
  /** 人填的值；null 代表目前用的是建議值 */
  sHuman: number | null; dHuman: number | null;
  action: string; owner: string; due: string; done: boolean;
  oAfter: number | null; sAfter: number | null; dAfter: number | null; rpnAfter: number | null;
  /** S ≥ 8：一定要有矯正措施 */
  mustAct: boolean;
  /** S ≥ 8 卻沒有矯正措施 */
  missingAction: boolean;
  impact: Impact;
}

const rpnOf = (o: number | null, s: number | null, d: number | null) => (o && s && d ? o * s * d : null);
/** 次系統欄顯示的名稱：分配到零件時用它的定義名稱 */
const subsystemName = (ix: Index, e: P5Element | undefined) => (e ? label(ix.defsOf(e).find((d) => STRUCT.has(d.category ?? "")) ?? e) : "（未指定次系統）");

export function fmeaRows(a: P5Analysis): FmeaRow[] {
  const ix = new Index(a);
  const fms = a.elements.filter((e) => e.category === "FailureMode" && /Usage$/.test(e.kind));
  const isFn = (e: P5Element | undefined) => !!e && (e.category === "Function" || e.category === "MissionPhase" || e.kind === "ActionUsage");
  const isStruct = (e: P5Element | undefined) => !!e && (STRUCT.has(e.category ?? "") || e.kind === "PartUsage" || e.kind === "PartDefinition");
  // 骨架：每個「功能 × 分配的對象」一組
  const pairs: { fn: string; target: string }[] = [];
  for (const r of a.relations) if (r.kind === "allocate" && isFn(ix.get(r.from)) && isStruct(ix.get(r.to)) && !pairs.some((p) => p.fn === r.from && p.target === r.to)) pairs.push({ fn: r.from, target: r.to });
  const linked = (fm: P5Element) => {
    const outs = ix.outs(fm.id, "trace").map((r) => ix.get(r.to)).filter((x): x is P5Element => !!x);
    return { fn: outs.find(isFn) ?? null, target: outs.find(isStruct) ?? null };
  };
  // 失效模式連到定義、分配連到使用（或反過來）都對得上
  const sameThing = (x: P5Element | null, id: string) => !!x && (x.id === id || ix.same(ix.get(id)!).includes(x.id) || ix.same(x).includes(id));
  const used = new Set<string>();
  const rows: FmeaRow[] = [];
  const make = (fnId: string | null, targetId: string | null, fm: P5Element | null): FmeaRow => {
    const fn = ix.get(fnId), target = ix.get(targetId);
    const n = (k: string) => (fm ? score(fm.attrs[k], 10) : null);
    const dSuggest = suggestDetection(a, fnId, targetId, fm?.id ?? null, ix);
    const dHuman = n("detection");
    const d = dHuman ?? dSuggest.value;
    const sSuggest = suggestSeverity(a, fnId, targetId, d, ix);
    const sHuman = n("severity");
    const s = sHuman ?? sSuggest.value;
    const o = n("occurrenceRating");
    const oA = n("occurrenceAfter"), sA = n("severityAfter"), dA = n("detectionAfter");
    const action = (fm?.attrs.correctiveAction ?? "").trim();
    const reqs = requirementsOf(ix, fn, target).ids;
    return {
      key: fm?.id ?? `${fnId}|${targetId}`, fm,
      subsystem: { id: targetId, name: subsystemName(ix, target) }, fn: { id: fnId, name: fn ? label(fn) : "（未指定功能）" },
      mode: fm?.name ?? "", effect: fm?.attrs.effect ?? "", cause: fm?.attrs.cause ?? "", control: fm?.attrs.control ?? "",
      o, s, d, rpn: rpnOf(o, s, d), sSuggest, dSuggest, sHuman, dHuman,
      action, owner: fm?.attrs.owner ?? "", due: fm?.attrs.due ?? "", done: isDone(fm?.attrs.done),
      oAfter: oA, sAfter: sA, dAfter: dA, rpnAfter: rpnOf(oA, sA, dA),
      mustAct: (s ?? 0) >= MUST_ACT, missingAction: !!fm && (s ?? 0) >= MUST_ACT && !action,
      impact: impactOf(ix, reqs, target ? [target] : []),
    };
  };
  for (const p of pairs) {
    const mine = fms.filter((fm) => { const l = linked(fm); return sameThing(l.fn, p.fn) && sameThing(l.target, p.target); });
    for (const fm of mine) { used.add(fm.id); rows.push(make(p.fn, p.target, fm)); }
    if (!mine.length) rows.push(make(p.fn, p.target, null));
  }
  // 沒有對上分配的失效模式照樣列出
  for (const fm of fms) if (!used.has(fm.id)) { const l = linked(fm); rows.push(make(l.fn?.id ?? null, l.target?.id ?? null, fm)); }
  return sortRows(rows);
}

/** 先依 S 由高到低，S 相同再依 RPN；再相同依影響範圍（METHOD.md 7.3）。骨架列排在已填的後面。 */
export function sortRows(rows: FmeaRow[]): FmeaRow[] {
  return [...rows].sort((x, y) => Number(!!y.fm) - Number(!!x.fm) || (y.s ?? 0) - (x.s ?? 0) || (y.rpn ?? 0) - (x.rpn ?? 0) || y.impact.total - x.impact.total || x.subsystem.name.localeCompare(y.subsystem.name) || x.fn.name.localeCompare(y.fn.name));
}

// ───────── 風險 ─────────

export interface RiskRow {
  risk: P5Element;
  likelihood: number | null; consequence: number | null; score: number | null;
  residualLikelihood: number | null; residualConsequence: number | null;
  level: "high" | "mid" | "low" | "none";
  threatens: P5Element[];
  attachedTo: P5Element[];
  sources: P5Element[];
  mitigationRequirements: P5Element[];
  mitigationVerifications: P5Element[];
  impact: Impact;
}

/** 5 × 5 的分級：15 以上高、8 到 14 中，和既有的風險矩陣相同。 */
export const levelOf = (s: number | null): RiskRow["level"] => (s === null ? "none" : s >= 15 ? "high" : s >= 8 ? "mid" : "low");

export function riskRows(a: P5Analysis): RiskRow[] {
  const ix = new Index(a);
  const risks = a.elements.filter((e) => e.category === "Risk" && /Usage$/.test(e.kind));
  return risks.map((risk) => {
    const outs = ix.outs(risk.id, "trace").map((r) => ix.get(r.to)).filter((x): x is P5Element => !!x);
    const ins = ix.ins(risk.id).map((r) => ix.get(r.from)).filter((x): x is P5Element => !!x);
    const threatens = outs.filter(isReq);
    const sources = outs.filter((e) => e.category === "FailureMode");
    const attachedTo = outs.filter((e) => !isReq(e) && e.category !== "FailureMode");
    const l = score(risk.attrs.likelihood, 5), c = score(risk.attrs.severity, 5);
    const sc = l && c ? l * c : null;
    // 掛在功能上的風險：牽連算到負責執行的次系統
    const parts = attachedTo.flatMap((e) => (e.kind === "PartUsage" || e.kind === "PartDefinition" ? [e] : ix.outs(e.id, "allocate").map((r) => ix.get(r.to)).filter((x): x is P5Element => !!x)));
    const attachedReqs = attachedTo.flatMap((e) => requirementsOf(ix, e.kind === "ActionUsage" ? e : undefined, e.kind === "ActionUsage" ? undefined : e).ids);
    return {
      risk, likelihood: l, consequence: c, score: sc,
      residualLikelihood: score(risk.attrs.residualLikelihood, 5), residualConsequence: score(risk.attrs.residualSeverity, 5),
      level: levelOf(sc), threatens, attachedTo, sources,
      mitigationRequirements: ins.filter(isReq), mitigationVerifications: ins.filter(isVer),
      impact: impactOf(ix, [...threatens.map((t) => t.id), ...attachedReqs], parts),
    };
  }).sort((x, y) => (y.score ?? 0) - (x.score ?? 0) || y.impact.total - x.impact.total);
}

/** 受威脅的需求：需求 id → 威脅它的風險中最高的分數（給需求矩陣與驗證矩陣標示）。 */
export function threatenedRequirements(a: P5Analysis): Map<string, { risks: string[]; worst: number | null; level: RiskRow["level"] }> {
  const out = new Map<string, { risks: string[]; worst: number | null; level: RiskRow["level"] }>();
  for (const r of riskRows(a)) for (const t of r.threatens) {
    const cur = out.get(t.id) ?? { risks: [], worst: null, level: "none" as RiskRow["level"] };
    cur.risks.push(r.risk.id);
    if (r.score !== null && (cur.worst === null || r.score > cur.worst)) { cur.worst = r.score; cur.level = levelOf(r.score); }
    out.set(t.id, cur);
  }
  return out;
}

// ───────── 依次系統彙整 ─────────

export interface SubsystemSummary { name: string; id: string | null; modes: number; skeleton: number; maxS: number | null; openActions: number; missingActions: number; maxRpn: number | null }

export function bySubsystem(rows: FmeaRow[]): SubsystemSummary[] {
  const m = new Map<string, SubsystemSummary>();
  for (const r of rows) {
    const k = r.subsystem.name;
    const cur = m.get(k) ?? { name: k, id: r.subsystem.id, modes: 0, skeleton: 0, maxS: null, openActions: 0, missingActions: 0, maxRpn: null };
    if (!r.fm) { cur.skeleton++; m.set(k, cur); continue; }
    cur.modes++;
    if (r.s !== null) cur.maxS = Math.max(cur.maxS ?? 0, r.s);
    if (r.rpn !== null) cur.maxRpn = Math.max(cur.maxRpn ?? 0, r.rpn);
    if ((r.action || r.mustAct) && !r.done) cur.openActions++;
    if (r.missingAction) cur.missingActions++;
    m.set(k, cur);
  }
  return [...m.values()].sort((x, y) => (y.maxS ?? 0) - (x.maxS ?? 0) || y.missingActions - x.missingActions || x.name.localeCompare(y.name));
}

// ───────── 圖 10 還缺什麼 ─────────

export function p5Issues(a: P5Analysis): { id: string | null; text: string }[] {
  const rows = fmeaRows(a);
  const issues: { id: string | null; text: string }[] = [];
  if (!a.relations.some((r) => r.kind === "allocate")) issues.push({ id: null, text: "還沒有「功能 → 次系統」的分配，FMEA 的列產生不出來（圖 4）。" });
  for (const r of rows) {
    if (!r.fm) issues.push({ id: r.fn.id, text: `${r.subsystem.name} × ${r.fn.name}：還沒填失效模式。` });
    else if (r.missingAction) issues.push({ id: r.fm.id, text: `${label(r.fm)}：嚴重度 ${r.s}，一定要有矯正措施。` });
    else if (r.o === null) issues.push({ id: r.fm.id, text: `${label(r.fm)}：發生度（O）要由人評。` });
  }
  for (const r of riskRows(a)) {
    if (r.score === null) issues.push({ id: r.risk.id, text: `${label(r.risk)}：還缺可能性或後果（1–5）。` });
    if (!r.threatens.length) issues.push({ id: r.risk.id, text: `${label(r.risk)}：還沒連到它威脅的需求。` });
  }
  return issues;
}
