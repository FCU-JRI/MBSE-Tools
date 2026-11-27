// 框架定義（framework/jri.json）：JRI 的系統工程流程寫成資料，工具讀它執行卡點與檢查。
// 改流程改那份檔案，不改程式。這裡只負責讀檔與檢查檔案本身前後一致；接上流程頁與卡點是下一步。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";
import { CATEGORIES } from "./metamodel.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FRAMEWORK_FILE = path.join(ROOT, "framework", "jri.json");

export interface Check { check: string; zh: string }
export interface Step {
  id: string; zh: string;
  produces?: string[]; metadata?: string[]; where?: string; owner?: string;
  done?: Check; decision?: boolean; holdPoint?: boolean; onNo?: string; onNoZh?: string;
  gate?: string | null; derivedFrom?: string[]; basisFrom?: string;
}
export interface Layer {
  id: string; order: number; zh: string; kind: "chain" | "loop"; subject: string; forEach?: boolean;
  steps?: Step[]; before?: Step[]; after?: Step[]; inputs?: string[];
  loopSteps?: string[]; loopProduces?: string[]; loopOwner?: string; extraMeets?: Check; outputsZh?: string;
  gate?: string | null; onGateFail?: string;
}
export interface Framework {
  version: number; name: string; source: string;
  principles: { id: string; zh: string }[];
  roles: { id: string; zh: string; defaultRank: string | null; note?: string }[];
  settings: { id: string; zh: string; type: string; default: unknown; note?: string }[];
  elementTypes: { id: string; zh?: string; status: "existing" | "planned" | "record"; sysml?: string; planned?: string; note?: string }[];
  metadata: { id: string; zh: string }[];
  designLoop: { id: string; zh: string; steps: Step[] };
  layers: Layer[];
  crossCutting: { id: string; zh: string; resolver?: string; blocks?: string; record?: string; produces?: string[] }[];
  open: string[];
}

export function loadFramework(file = FRAMEWORK_FILE): Framework {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Framework;
}

/** 這一層實際要走的所有步驟（含迴圈前、迴圈、迴圈後）。 */
export function stepsOf(f: Framework, layer: Layer): Step[] {
  if (layer.kind === "chain") return layer.steps ?? [];
  const loop = (layer.loopSteps ?? []).map((id) => f.designLoop.steps.find((s) => s.id === id)).filter((s): s is Step => !!s);
  return [...(layer.before ?? []), ...loop, ...(layer.after ?? [])];
}

export interface Known { categories: string[]; gates: string[]; ranks: string[] }

/** 檢查框架檔前後一致：引用的類別、節點、角色、步驟都存在，且「下一層需求要有兩個來源」等原則有寫進資料。回傳問題清單，空的就是沒問題。 */
export function validateFramework(f: Framework, known: Known): string[] {
  const problems: string[] = [];
  const types = new Set(f.elementTypes.map((t) => t.id));
  const roles = new Set(f.roles.map((r) => r.id));
  const meta = new Set(f.metadata.map((m) => m.id));
  const loopIds = new Set(f.designLoop.steps.map((s) => s.id));
  const gates = new Set(known.gates);
  const where = new Set(["model", "tables", "analysis", "manage", "auto"]);

  for (const t of f.elementTypes) if (t.status === "existing" && !known.categories.includes(t.id)) problems.push(`elementTypes：${t.id} 標為 existing，但元模型沒有這個類別`);
  for (const r of f.roles) if (r.defaultRank !== null && !known.ranks.includes(r.defaultRank)) problems.push(`roles：${r.id} 的 defaultRank ${r.defaultRank} 不是有效職級`);

  const checkStep = (s: Step, where_: string, owners: Set<string>) => {
    for (const p of [...(s.produces ?? []), ...(s.derivedFrom ?? [])]) if (!types.has(p)) problems.push(`${where_}：${s.id} 引用了未定義的元素類型 ${p}`);
    for (const m of s.metadata ?? []) if (!meta.has(m)) problems.push(`${where_}：${s.id} 引用了未定義的標記 ${m}`);
    if (s.owner && !owners.has(s.owner)) problems.push(`${where_}：${s.id} 的負責人 ${s.owner} 不存在`);
    if (s.where && !where.has(s.where)) problems.push(`${where_}：${s.id} 的位置 ${s.where} 不存在`);
    if (s.gate && !gates.has(s.gate)) problems.push(`${where_}：${s.id} 的節點 ${s.gate} 不存在`);
    if (!s.gate && !s.done && !s.decision && where_ !== "designLoop" && s.where !== "manage") problems.push(`${where_}：${s.id} 沒有完成條件`);
  };
  const loopOwners = new Set([...roles, "layerOwner"]);
  for (const s of f.designLoop.steps) {
    checkStep(s, "designLoop", loopOwners);
    if (s.onNo && !loopIds.has(s.onNo)) problems.push(`designLoop：${s.id} 答否時回到 ${s.onNo}，但迴圈沒有這一步`);
  }
  if (!f.designLoop.steps.some((s) => s.holdPoint)) problems.push("designLoop：沒有卡點（holdPoint）");

  const orders = f.layers.map((l) => l.order);
  if (orders.some((o, i) => o !== i + 1)) problems.push("layers：order 必須從 1 開始連續排列");
  const layerIds = new Set<string>();
  for (const l of f.layers) {
    for (const s of [...(l.steps ?? []), ...(l.before ?? []), ...(l.after ?? [])]) checkStep(s, `layers.${l.id}`, roles);
    for (const p of [...(l.inputs ?? []), ...(l.loopProduces ?? [])]) if (!types.has(p)) problems.push(`layers.${l.id}：引用了未定義的元素類型 ${p}`);
    if (l.gate && !gates.has(l.gate)) problems.push(`layers.${l.id}：節點 ${l.gate} 不存在`);
    if (l.kind === "loop") {
      if (!l.loopSteps?.length) problems.push(`layers.${l.id}：迴圈層沒有 loopSteps`);
      for (const id of l.loopSteps ?? []) if (!loopIds.has(id)) problems.push(`layers.${l.id}：loopSteps 的 ${id} 不在設計迴圈裡`);
      if (!(l.loopSteps ?? []).includes("outputs")) problems.push(`layers.${l.id}：迴圈沒有走到「產出設計限制」卡點`);
      if (l.loopOwner && !roles.has(l.loopOwner)) problems.push(`layers.${l.id}：loopOwner ${l.loopOwner} 不存在`);
      if (l.onGateFail && !(l.loopSteps ?? []).includes(l.onGateFail)) problems.push(`layers.${l.id}：節點未通過時回到 ${l.onGateFail}，但迴圈沒有這一步`);
    }
    // 原則「下一層需求有兩個來源」：第 3 層起，產生需求的步驟一定要寫 basisFrom，且指向更早、跑過設計迴圈的層
    if (l.order >= 3) {
      for (const s of [...(l.before ?? []), ...(l.after ?? []), ...(l.steps ?? [])]) {
        const makesReq = (s.produces ?? []).some((p) => /Requirement$/.test(p));
        if (!makesReq) continue;
        if (!s.basisFrom) { problems.push(`layers.${l.id}：${s.id} 產生需求，但沒有寫 basisFrom（設計產出來源）`); continue; }
        const from = f.layers.find((x) => x.id === s.basisFrom);
        if (!from) problems.push(`layers.${l.id}：${s.id} 的 basisFrom ${s.basisFrom} 不存在`);
        else if (from.kind !== "loop") problems.push(`layers.${l.id}：${s.id} 的 basisFrom ${s.basisFrom} 不是設計迴圈層`);
        else if (from.order > l.order) problems.push(`layers.${l.id}：${s.id} 的 basisFrom ${s.basisFrom} 在後面的層`);
      }
    }
    // 鏈狀層的「答否」只能回到同層的步驟或某個節點
    const own = new Set((l.steps ?? []).map((s) => s.id));
    for (const s of l.steps ?? []) if (s.onNo && !own.has(s.onNo) && !gates.has(s.onNo)) problems.push(`layers.${l.id}：${s.id} 答否時回到 ${s.onNo}，找不到`);
    layerIds.add(l.id);
  }
  for (const c of f.crossCutting) {
    if (c.resolver && !roles.has(c.resolver)) problems.push(`crossCutting：${c.id} 的裁決者 ${c.resolver} 不存在`);
    if (c.blocks && !loopIds.has(c.blocks)) problems.push(`crossCutting：${c.id} 擋的步驟 ${c.blocks} 不在設計迴圈裡`);
    if (c.record && !types.has(c.record)) problems.push(`crossCutting：${c.id} 的紀錄類型 ${c.record} 未定義`);
    for (const p of c.produces ?? []) if (!types.has(p)) problems.push(`crossCutting：${c.id} 引用了未定義的元素類型 ${p}`);
  }
  return problems;
}

// ───────── 執行框架（WP3）：由模型證據算出每層每個對象走到哪一步、卡點、兩個來源 ─────────
// 狀態不另外存：每次都從模型、專案設定、來源文件與分支狀態重算。

/** 專案設定（PRJ-05）。預設值來自框架檔 settings。卡點只警告不擋（Mars 決定），所以沒有強制開關。 */
export interface FwSettings {
  fmeaThreshold: number;
  budgetMargin: number | null;
  minAlternatives: number;
  tradeWeights: boolean;
  /** 「層.步」→ 角色 id；沒寫的用框架檔的 owner */
  owners: Record<string, string>;
}

export function defaultSettings(f: Framework, _template?: string): FwSettings {
  const d = (id: string) => f.settings.find((s) => s.id === id)?.default;
  const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? v : fb);
  return {
    fmeaThreshold: num(d("fmeaThreshold"), 15),
    budgetMargin: typeof d("budgetMargin") === "number" ? (d("budgetMargin") as number) : null,
    minAlternatives: num(d("minAlternatives"), 2),
    tradeWeights: d("tradeWeights") === true,
    owners: {},
  };
}

export class SettingsError extends Error {}

/** 把使用者送來的設定併到現有設定上並檢查範圍；不合法就丟錯。 */
export function normalizeSettings(f: Framework, base: FwSettings, input: unknown): FwSettings {
  if (input === null || typeof input !== "object") throw new SettingsError("設定格式不正確。");
  const b = input as Record<string, unknown>;
  const out: FwSettings = { ...base, owners: { ...base.owners } };
  const int = (v: unknown, lo: number, hi: number, zh: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new SettingsError(`${zh}要是 ${lo}～${hi} 的整數。`);
    return n;
  };
  if (b.fmeaThreshold !== undefined) out.fmeaThreshold = int(b.fmeaThreshold, 1, 25, "FMEA 門檻（S×O）");
  if (b.minAlternatives !== undefined) out.minAlternatives = int(b.minAlternatives, 1, 10, "方案分析最少候選數");
  if (b.budgetMargin !== undefined) {
    if (b.budgetMargin === null || b.budgetMargin === "") out.budgetMargin = null;
    else {
      const n = Number(b.budgetMargin);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new SettingsError("預算餘裕要是 0～100 的百分比，或留空不檢查。");
      out.budgetMargin = n;
    }
  }
  if (b.tradeWeights !== undefined) out.tradeWeights = b.tradeWeights === true;
  if (b.owners !== undefined) {
    if (b.owners === null || typeof b.owners !== "object") throw new SettingsError("各步負責人格式不正確。");
    const keys = new Set(ownerSlots(f).map((s) => s.key));
    const roles = new Set(f.roles.map((r) => r.id));
    for (const [k, v] of Object.entries(b.owners as Record<string, unknown>)) {
      if (!keys.has(k)) throw new SettingsError(`沒有「${k}」這一步。`);
      if (v === "" || v === null) { delete out.owners[k]; continue; }
      if (!roles.has(String(v))) throw new SettingsError(`沒有「${String(v)}」這個角色。`);
      out.owners[k] = String(v);
    }
  }
  return out;
}

/** 可以指定負責人的步驟：鏈狀層的每一步、迴圈層的迴圈前後步驟與整個迴圈（key＝層.loop）。預設值來自框架檔。 */
export function ownerSlots(f: Framework): { key: string; layer: string; zh: string; default: string }[] {
  const out: { key: string; layer: string; zh: string; default: string }[] = [];
  for (const l of f.layers) {
    const plain = [...(l.steps ?? []), ...(l.before ?? [])];
    for (const s of plain) if (s.owner) out.push({ key: `${l.id}.${s.id}`, layer: l.zh, zh: s.zh, default: s.owner });
    if (l.kind === "loop" && l.loopOwner) out.push({ key: `${l.id}.loop`, layer: l.zh, zh: "設計迴圈", default: l.loopOwner });
    for (const s of l.after ?? []) if (s.owner) out.push({ key: `${l.id}.${s.id}`, layer: l.zh, zh: s.zh, default: s.owner });
  }
  return out;
}

export interface FwIssue { id: string | null; text: string }
export interface StepResult {
  id: string; zh: string; where: string | null; owner: string | null; ownerZh: string;
  produces: string[]; gate: string | null; decision: boolean; holdPoint: boolean;
  check: string | null; checkZh: string;
  /** true 完成、false 未完成、null 工具還沒接上這項檢查（待接） */
  done: boolean | null;
  state: "done" | "current" | "todo" | "pending";
  issues: FwIssue[];
  onNo: string | null;
}
export interface ObjectLoop { id: string | null; name: string; steps: StepResult[]; current: string | null; passed: boolean }
export interface LayerResult {
  id: string; order: number; zh: string; kind: "chain" | "loop"; subject: string; gate: string | null; outputsZh: string;
  steps: StepResult[]; before: StepResult[]; objects: ObjectLoop[]; after: StepResult[];
  /** 迴圈層：至少一個對象、且每個對象的迴圈都走到「產出設計限制」；鏈狀層：每一步都完成 */
  passed: boolean;
  /** 本層產生的各類別、屬於本層的元素 id（MOD-02 左欄用，見 layerMembers）；來源文件不是模型元素，只給數量 */
  members?: Record<string, string[]>;
}
export interface TwoSourcesIssue { id: string; name: string; category: string; missing: ("derivation" | "basis")[]; text: string }
export interface HoldPoint { category: string; zh: string; fromLayer: string; fromLayerZh: string; open: boolean; reason: string }
export interface Approval { ok: boolean; detail: string; source: "branches" }
/** 缺「為什麼／判定條件」（@DesignRationale）的元素。只是警告：不影響迴圈進度、卡點與節點檢查。 */
export interface RationaleGap { id: string; name: string; category: string; missing: ("why" | "judge")[]; text: string }
/** 喊卡中的設計決策（releaseStatus = "hold"，Mars 2026-11-27 決定只警告）：下一層照常可寫，但顯示這則警告；不擋迴圈、卡點與節點檢查。 */
export interface HoldDecision { id: string; name: string; reason: string; text: string }
export interface FrameworkEval {
  name: string; version: number; settings: FwSettings; layers: LayerResult[];
  twoSources: TwoSourcesIssue[]; holdPoints: HoldPoint[]; approval: Approval; problems: string[];
  rationaleGaps: RationaleGap[]; holdDecisions: HoldDecision[];
}
export interface FwContext { a: Analysis; settings: FwSettings; docs: number; approval: Approval; catZh?: (id: string) => string }

const REQ = /Requirement$/;
const LOOSE = ["trace", "derive", "refine"];
const STRUCT = new Set(["System", "Subsystem", "Component", "ExternalEntity", "DesignAlternative"]);
const LAYER_TAG: Record<string, string> = { mission: "mission", System: "system", Subsystem: "subsystem", Component: "component" };
/** 迴圈層的對象往下一層的類別（功能分配時，分配到更下層也算） */
const DEEPER: Record<string, string[]> = { System: ["System", "Subsystem", "Component"], Subsystem: ["Subsystem", "Component"], Component: ["Component"] };

type Scope = { layer: Layer; step: Step; object: Element | null; reqs: Element[] };
type CheckFn = (c: Helpers, s: Scope) => FwIssue[];

interface Helpers {
  a: Analysis; ctx: FwContext;
  of: (...cats: string[]) => Element[];
  byId: Map<string, Element>;
  name: (e: Element) => string;
  out: (e: Element, kinds: string[], cats?: string[]) => Element[];
  inn: (e: Element, kinds: string[], cats?: string[]) => Element[];
  linked: (e: Element, ids: Set<string>) => boolean;
}

function helpers(ctx: FwContext): Helpers {
  const a = ctx.a;
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const of = (...cats: string[]) => a.elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" && !e.shared
    && (STRUCT.has(e.category) ? e.kind === "PartDefinition" : /Usage$/.test(e.kind)));
  const out = (e: Element, kinds: string[], cats?: string[]) => a.relations.filter((r) => r.from === e.id && kinds.includes(r.kind)).map((r) => byId.get(r.to)).filter((x): x is Element => !!x && (!cats || cats.includes(x.category ?? "")));
  const inn = (e: Element, kinds: string[], cats?: string[]) => a.relations.filter((r) => r.to === e.id && kinds.includes(r.kind)).map((r) => byId.get(r.from)).filter((x): x is Element => !!x && (!cats || cats.includes(x.category ?? "")));
  const linked = (e: Element, ids: Set<string>) => a.relations.some((r) => (r.from === e.id && ids.has(r.to)) || (r.to === e.id && ids.has(r.from)));
  return { a, ctx, of, byId, name: (e) => (e.shortName ? `${e.shortName} ${e.name}` : e.name), out, inn, linked };
}

/** 對象本身＋型別是它的零件（usage）＋放在它裡面的元素：判斷「跟這個對象有關」用。 */
function objectIds(h: Helpers, obj: Element): Set<string> {
  const ids = new Set([obj.id]);
  for (const e of h.a.elements) if (e.typeIds.includes(obj.id) || e.owner === obj.id) ids.add(e.id);
  return ids;
}

const riskScore = (e: Element) => ({ s: Number(e.attrs.severity) || 0, o: Number(e.attrs.likelihood) || 0, rs: Number(e.attrs.residualSeverity) || 0, ro: Number(e.attrs.residualLikelihood) || 0 });
/** 「未緩解」：沒寫緩解措施；或寫了緩解後的嚴重度與可能性，相乘仍達門檻。已結案的不算。 */
export function openRisk(e: Element, threshold: number): boolean {
  if (/結案|closed/i.test(e.attrs.status ?? "")) return false;
  const { s, o, rs, ro } = riskScore(e);
  if (s * o < threshold) return false;
  if (!(e.attrs.mitigation ?? "").trim()) return true;
  return rs > 0 && ro > 0 && rs * ro >= threshold;
}

/** 本層這個對象的 FMEA 列：追溯到對象（或它的零件）、它的需求、它的設計方案與候選、分配給它的功能；沒有任何連結的風險看 #layer 標記。 */
function objectRisks(h: Helpers, s: Scope): Element[] {
  const tag = LAYER_TAG[s.layer.subject];
  const ids = s.object ? objectIds(h, s.object) : new Set<string>();
  for (const r of s.reqs) ids.add(r.id);
  for (const alt of objectAlternatives(h, s)) { ids.add(alt.id); for (const v of variantsOf(h, alt)) ids.add(v.id); }
  for (const fn of h.of("Function")) if (h.out(fn, ["allocate"]).some((t) => ids.has(t.id))) ids.add(fn.id);
  const loose = (r: Element) => !h.a.relations.some((x) => x.from === r.id || x.to === r.id);
  return h.of("Risk").filter((r) => h.linked(r, ids) || (loose(r) && (r.attrs.layer ?? "") === tag));
}

function objectAlternatives(h: Helpers, s: Scope): Element[] {
  const ids = s.object ? objectIds(h, s.object) : new Set<string>();
  for (const r of s.reqs) ids.add(r.id);
  return h.of("DesignAlternative").filter((alt) => {
    const mine = new Set([alt.id, ...h.a.elements.filter((e) => e.owner === alt.id).map((e) => e.id)]);
    return [...mine].some((m) => h.linked(h.byId.get(m) as Element, ids)) || (s.object !== null && alt.owner === s.object.id);
  });
}
const variantsOf = (h: Helpers, alt: Element) => h.a.elements.filter((e) => e.owner === alt.id && /Usage$/.test(e.kind) && e.kind !== "ReferenceUsage" && e.kind !== "AttributeUsage");

const atLeast = (h: Helpers, cat: string, n = 1): FwIssue[] => (h.of(cat).length >= n ? [] : [{ id: null, text: `至少要有 ${n} 個${h.ctx.catZh?.(cat) ?? cat}。` }]);

const CHECKS: Partial<Record<string, CheckFn>> = {
  hasDoc: (h) => (h.ctx.docs > 0 ? [] : [{ id: null, text: "還沒有登記任何來源文件（表格頁「來源文件」）。" }]),
  expectationTracesStakeholder: (h) => [
    ...atLeast(h, "Expectation"),
    ...h.of("Expectation").filter((e) => h.out(e, LOOSE, ["Stakeholder"]).length === 0).map((e) => ({ id: e.id, text: `${h.name(e)} 沒有追溯到提出它的利害關係人。` })),
  ],
  stakeholderInUseCase: (h) => [
    ...atLeast(h, "UseCase"),
    ...h.of("Stakeholder").filter((st) => h.inn(st, LOOSE, ["UseCase"]).length === 0).map((e) => ({ id: e.id, text: `${h.name(e)} 沒有參與任何使用情境。` })),
  ],
  objectiveMeasurable: (h) => [
    ...atLeast(h, "Objective"),
    ...h.of("Objective").filter((o) => !/\d/.test(`${o.name}${o.doc}`) && h.inn(o, LOOSE, ["MOE"]).length === 0).map((e) => ({ id: e.id, text: `${h.name(e)} 沒有數字，也沒有效能量度，量不出來。` })),
  ],
  moeThreeLevels: (h) => [
    ...h.of("Objective").filter((o) => h.inn(o, LOOSE, ["MOE"]).length === 0).map((e) => ({ id: e.id, text: `目的「${e.name}」還沒有成功判準（MOE）。` })),
    ...h.of("MOE").filter((m) => !(m.attrs.successLevel ?? "").trim()).map((e) => ({ id: e.id, text: `${h.name(e)} 沒有標出等級（最低／完全／額外）。` })),
  ],
  tracedAndVerifiable: (h, s) => {
    const cats = (s.step.produces ?? []).filter((p) => REQ.test(p));
    const up = (s.step.derivedFrom ?? []).filter((p) => p !== "Doc");
    const reqs = h.of(...cats);
    return [
      ...(reqs.length ? [] : [{ id: null, text: `至少要有一條${h.ctx.catZh?.(cats[0]) ?? cats[0]}。` }]),
      ...reqs.filter((r) => h.out(r, LOOSE, up).length === 0 && !((s.step.derivedFrom ?? []).includes("Doc") && (r.attrs.sourceDoc ?? "").trim()))
        .map((r) => ({ id: r.id, text: `${h.name(r)} 沒有追溯到上一層（${up.map((u) => h.ctx.catZh?.(u) ?? u).join("、")}${(s.step.derivedFrom ?? []).includes("Doc") ? "或來源文件" : ""}）。` })),
      ...reqs.filter((r) => h.inn(r, ["verify"]).length === 0).map((r) => ({ id: r.id, text: `${h.name(r)} 還沒有驗證方法（驗證事件）。` })),
    ];
  },
  phaseHasFunction: (h) => {
    const phases = h.of("MissionPhase");
    const leaf = phases.filter((p) => !phases.some((q) => q.owner === p.id));
    return [
      ...(leaf.length ? [] : [{ id: null, text: "還沒有任務階段。" }]),
      ...leaf.filter((p) => !h.of("Function").some((f) => f.owner === p.id)).map((p) => ({ id: p.id, text: `階段「${p.name}」還沒有功能。` })),
    ];
  },
  functionAllocated: (h, s) => {
    const to = DEEPER[s.layer.subject] ?? ["System", "Subsystem", "Component"];
    const fns = h.of("Function");
    return [
      ...(fns.length ? [] : [{ id: null, text: "還沒有功能。" }]),
      ...fns.filter((f) => h.out(f, ["allocate"], to).length === 0).map((f) => ({ id: f.id, text: `${h.name(f)} 還沒有分配到${to.map((t) => h.ctx.catZh?.(t) ?? t).join("／")}。` })),
    ];
  },
  twoSources: (h, s) => {
    const cats = (s.step.produces ?? []).filter((p) => REQ.test(p));
    const reqs = h.of(...cats);
    return [
      ...(reqs.length ? [] : [{ id: null, text: `至少要有一條${h.ctx.catZh?.(cats[0]) ?? cats[0]}。` }]),
      ...reqs.flatMap((r) => {
        const miss: FwIssue[] = [];
        if (h.out(r, ["derive"], s.step.derivedFrom).length === 0) miss.push({ id: r.id, text: `${h.name(r)} 缺上一層需求來源（衍生自）。` });
        if (h.out(r, ["basis"]).length === 0) miss.push({ id: r.id, text: `${h.name(r)} 缺設計產出來源（#basis）。` });
        if (h.inn(r, ["verify"]).length === 0) miss.push({ id: r.id, text: `${h.name(r)} 還沒有驗證方法。` });
        return miss;
      }),
    ];
  },
  interfacesAgreed: (h) => {
    const ifs = h.a.elements.filter((e) => e.category === "Interface" && !e.shared && e.kind === "InterfaceUsage");
    return [
      ...(ifs.length ? [] : [{ id: null, text: "還沒有介面。" }]),
      ...ifs.filter((e) => !((e.attrs.agreedA ?? "").trim() && (e.attrs.agreedB ?? "").trim())).map((e) => ({ id: e.id, text: `${h.name(e)} 還沒有兩端都同意。` })),
    ];
  },
  requirementHasEvent: (h) => h.of("SystemRequirement", "SubsystemRequirement", "ComponentRequirement").filter((r) => h.inn(r, ["verify"]).length === 0).map((r) => ({ id: r.id, text: `${h.name(r)} 還沒有驗證事件。` })),

  // ── 設計迴圈 ──
  hasAlternative: (h, s) => {
    const alts = objectAlternatives(h, s);
    return alts.length ? [] : [{ id: s.object?.id ?? null, text: `還沒有設計提案：新增「設計方案」，並用「追溯」連到它要滿足的${s.object ? `「${s.object.name}」` : "本層"}需求。` }];
  },
  tradeSelected: (h, s) => {
    const alts = objectAlternatives(h, s);
    if (!alts.length) return [{ id: null, text: "還沒有設計提案。" }];
    const issues: FwIssue[] = [];
    for (const alt of alts) {
      const vs = variantsOf(h, alt);
      if (vs.length < h.ctx.settings.minAlternatives) issues.push({ id: alt.id, text: `${h.name(alt)} 只有 ${vs.length} 個候選（專案設定至少 ${h.ctx.settings.minAlternatives} 個）。` });
      const ids = new Set([alt.id, ...vs.map((v) => v.id)]);
      const decs = h.of("DesignDecision").filter((d) => h.linked(d, ids) || h.a.relations.some((r) => r.kind === "basis" && r.to === d.id && s.reqs.some((q) => q.id === r.from)));
      if (!decs.length) issues.push({ id: alt.id, text: `${h.name(alt)} 還沒有設計決策（選定哪個候選、為什麼）。` });
      else if (!decs.some((d) => (d.attrs.rationale ?? "").trim())) issues.push({ id: decs[0].id, text: `${h.name(decs[0])} 沒有寫選定與否決的理由。` });
    }
    return issues;
  },
  fmeaCoversLayer: (h, s) => {
    const risks = objectRisks(h, s);
    if (!risks.length) return [{ id: s.object?.id ?? null, text: `${s.object ? `「${s.object.name}」` : "本層"}還沒有 FMEA 失效模式列（新增風險並追溯到它，或標層級）。` }];
    return risks.filter((r) => !(Number(r.attrs.severity) && Number(r.attrs.likelihood))).map((r) => ({ id: r.id, text: `${h.name(r)} 還缺嚴重度或可能性。` }));
  },
  noOpenRiskAboveThreshold: (h, s) => objectRisks(h, s).filter((r) => openRisk(r, h.ctx.settings.fmeaThreshold)).map((r) => {
    const { s: sv, o } = riskScore(r);
    return { id: r.id, text: `${h.name(r)}：S×O＝${sv * o}，達到門檻 ${h.ctx.settings.fmeaThreshold} 且未緩解。` };
  }),
  hasCadLink: (_h, s) => (!s.object ? [] : (s.object.attrs.cadUrl ?? "").trim() && (s.object.attrs.cadVersion ?? "").trim() ? [] : [{ id: s.object.id, text: `「${s.object.name}」還沒有 CAD 連結與版本。` }]),
  requirementsHaveValues: (h, s) => {
    const verdicts = verdictsOf(h, s);
    if (!verdicts.length) return [{ id: s.object?.id ?? null, text: "本層需求還沒有任何可計算的數值條件（require constraint＋滿足關係）。" }];
    return verdicts.filter((v) => v.status !== "holds" && v.status !== "fails").map((v) => ({ id: reqByQn(h, v.requirement)?.id ?? null, text: `${reqByQn(h, v.requirement)?.name ?? v.requirement} 算不出值（未判定）。` }));
  },
  constraintsPassAndApproved: (h, s) => [
    ...verdictsOf(h, s).filter((v) => v.status !== "holds").map((v) => ({ id: reqByQn(h, v.requirement)?.id ?? null, text: `${reqByQn(h, v.requirement)?.name ?? v.requirement}：${v.status === "fails" ? "不通過" : "未判定"}。` })),
    ...(verdictsOf(h, s).length ? [] : [{ id: null, text: "沒有可判定的數值條件，無法判定是否符合需求。" }]),
    ...(h.ctx.approval.ok ? [] : [{ id: null, text: `組長核准：${h.ctx.approval.detail}` }]),
  ],
};

const reqByQn = (h: Helpers, qn: string) => h.a.elements.find((e) => e.qualifiedName === qn);
function verdictsOf(h: Helpers, s: Scope) {
  const qns = new Set(s.reqs.map((r) => r.qualifiedName));
  return h.a.satisfaction.filter((v) => qns.has(v.requirement));
}

/** 迴圈層的需求類別：迴圈前步驟產生的需求，或 inputs 裡的需求 */
export function layerReqCats(l: Layer): string[] {
  const made = (l.before ?? []).flatMap((s) => (s.produces ?? []).filter((p) => REQ.test(p)));
  return made.length ? made : (l.inputs ?? []).filter((p) => REQ.test(p));
}

function objectsOf(h: Helpers, l: Layer): (Element | null)[] {
  if (l.subject === "mission" || !l.forEach) return [null];
  return h.of(l.subject);
}

function reqsOf(h: Helpers, l: Layer, obj: Element | null, objs: (Element | null)[]): Element[] {
  const reqs = h.of(...layerReqCats(l));
  if (!obj) return reqs;
  const ids = objectIds(h, obj);
  const mine = reqs.filter((r) => h.inn(r, ["satisfy"]).some((x) => ids.has(x.id)));
  // 只有一個對象時，本層所有需求都算它的
  return objs.length === 1 ? reqs : mine;
}

function ownerOf(f: Framework, set: FwSettings, l: Layer, s: Step, inLoop: boolean): string | null {
  const key = inLoop ? `${l.id}.loop` : `${l.id}.${s.id}`;
  // 迴圈裡寫 layerOwner 的步驟跟著該層負責人（可在專案設定改）；寫死角色的（組長、總工程師）不變
  const own = inLoop ? (s.owner === "layerOwner" ? set.owners[key] ?? l.loopOwner : s.owner) : set.owners[key] ?? s.owner;
  return own ?? null;
}

function runStep(f: Framework, h: Helpers, l: Layer, s: Step, obj: Element | null, reqs: Element[], inLoop: boolean): StepResult {
  const owner = ownerOf(f, h.ctx.settings, l, s, inLoop);
  const base = {
    id: s.id, zh: s.zh, where: s.where ?? null, owner, ownerZh: f.roles.find((r) => r.id === owner)?.zh ?? "",
    produces: s.produces ?? [], gate: s.gate ?? null, decision: !!s.decision, holdPoint: !!s.holdPoint, onNo: s.onNo ?? null,
  };
  if (s.gate) return { ...base, check: null, checkZh: "節點核可（專案管理頁）", done: null, state: "pending", issues: [] };
  const name = s.done?.check ?? null;
  if (!name) return { ...base, check: null, checkZh: "", done: null, state: "pending", issues: [] };
  if (name === "meetsIsYes") return { ...base, check: name, checkZh: s.done?.zh ?? "", done: true, state: "done", issues: [] }; // 由 runLoop 依前面步驟決定
  const [fn, arg] = name.split(":");
  const scope: Scope = { layer: l, step: s, object: obj, reqs };
  const impl = fn === "atLeastOne" ? (hh: Helpers) => atLeast(hh, arg) : CHECKS[fn];
  if (!impl) return { ...base, check: name, checkZh: s.done?.zh ?? "", done: null, state: "pending", issues: [{ id: null, text: `待接：工具還沒有實作檢查「${name}」，先人工確認。` }] };
  const issues = impl(h, scope);
  return { ...base, check: name, checkZh: s.done?.zh ?? "", done: issues.length === 0, state: issues.length === 0 ? "done" : "todo", issues: issues.slice(0, 12) };
}

/** 一個對象的設計迴圈：依序走，第一個沒完成的步驟就是目前步驟；判斷步驟答否時標出回到哪一步。 */
function runLoop(f: Framework, h: Helpers, l: Layer, obj: Element | null, reqs: Element[]): ObjectLoop {
  const steps = (l.loopSteps ?? []).map((id) => f.designLoop.steps.find((s) => s.id === id)).filter((s): s is Step => !!s);
  const out: StepResult[] = [];
  let open = true, current: string | null = null;
  for (const s of steps) {
    let r = runStep(f, h, l, s, obj, reqs, true);
    if (s.id === "meets" && l.extraMeets) {
      const impl: CheckFn | undefined = CHECKS[l.extraMeets.check];
      const extra = impl ? impl(h, { layer: l, step: s, object: obj, reqs }) : [{ id: null, text: `待接：${l.extraMeets.zh}（衝突偵測由 WP4 提供）` }];
      if (impl && extra.length) r = { ...r, done: false, state: "todo", issues: [...r.issues, ...extra] };
      else if (!impl) r = { ...r, issues: [...r.issues, ...extra] };
    }
    if (s.done?.check === "meetsIsYes") {
      r = open ? { ...r, done: true, state: "done", issues: [] } : { ...r, done: false, state: "todo", issues: [{ id: null, text: "前面的步驟還沒走完（「是否符合需求」要為是），還不能產出設計限制、推導下一層需求。" }] };
    }
    if (!open && r.state !== "pending") r = { ...r, state: "todo" };
    if (open && r.done === false) { open = false; current = s.id; r = { ...r, state: "current" }; }
    out.push(r);
  }
  return { id: obj?.id ?? null, name: obj?.name ?? "任務", steps: out, current, passed: open };
}

/** 全部重算：每層、每個對象的進度，兩個來源，卡點。 */
export function evaluateFramework(f: Framework, ctx: FwContext): FrameworkEval {
  const h = helpers(ctx);
  const layers: LayerResult[] = [];
  for (const l of f.layers) {
    const objs = l.kind === "loop" ? objectsOf(h, l) : [];
    const chainOrBefore = (list: Step[] | undefined) => (list ?? []).map((s) => runStep(f, h, l, s, null, [], false));
    const res: LayerResult = {
      id: l.id, order: l.order, zh: l.zh, kind: l.kind, subject: l.subject, gate: l.gate ?? null, outputsZh: l.outputsZh ?? "",
      steps: chainOrBefore(l.steps), before: chainOrBefore(l.before),
      objects: objs.map((o) => runLoop(f, h, l, o, reqsOf(h, l, o, objs))), after: chainOrBefore(l.after), passed: false,
    };
    // 鏈狀層：依序走；節點步驟與待接的不擋
    let open = true;
    for (const list of [res.steps, res.before, res.after]) for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.state === "pending") continue;
      if (!open) list[i] = { ...r, state: r.done ? "done" : "todo" };
      else if (!r.done) { open = false; list[i] = { ...r, state: "current" }; }
    }
    // 鏈狀層：每一步都要確定完成（待接的、節點核可都還不算）
    res.passed = l.kind === "loop" ? res.objects.length > 0 && res.objects.every((o) => o.passed) : res.steps.length > 0 && res.steps.every((s) => s.done === true);
    layers.push(res);
  }

  // 兩個來源（FW-04）：產生需求、且寫了 basisFrom 的步驟，其需求要有 #derivation 與 #basis
  const twoSources: TwoSourcesIssue[] = [];
  const holdPoints: HoldPoint[] = [];
  for (const l of f.layers) for (const s of [...(l.before ?? []), ...(l.after ?? []), ...(l.steps ?? [])]) {
    if (!s.basisFrom) continue;
    const cats = (s.produces ?? []).filter((p) => REQ.test(p));
    for (const r of h.of(...cats)) {
      const missing: ("derivation" | "basis")[] = [];
      if (h.out(r, ["derive"], s.derivedFrom).length === 0) missing.push("derivation");
      if (h.out(r, ["basis"]).length === 0) missing.push("basis");
      if (missing.length) twoSources.push({ id: r.id, name: h.name(r), category: r.category ?? "", missing,
        text: missing.map((m) => (m === "basis" ? "缺設計產出來源" : "缺上一層需求來源")).join("、") });
    }
    // 卡點（FW-02）：上一層（basisFrom）的迴圈沒有任何對象走完，不能新增這一層的需求
    const from = layers.find((x) => x.id === s.basisFrom);
    const src = f.layers.find((x) => x.id === s.basisFrom);
    if (!from || !src) continue;
    // 上一層每個對象都走完才算開（多個對象也只警告，不擋）
    const passed = from.objects.filter((o) => o.passed);
    const allPassed = from.objects.length > 0 && passed.length === from.objects.length;
    const blocking = from.objects.filter((o) => !o.passed).map((o) => `「${o.name}」停在「${o.steps.find((x) => x.id === o.current)?.zh ?? "—"}」`);
    for (const c of cats) holdPoints.push({
      category: c, zh: ctx.catZh?.(c) ?? c, fromLayer: from.id, fromLayerZh: from.zh, open: allPassed,
      reason: allPassed ? `${from.zh}每個對象的設計迴圈都走完了。`
        : from.objects.length === 0 ? `第 ${from.order} 層「${from.zh}」還沒有任何${src.subject === "mission" ? "對象" : ctx.catZh?.(src.subject) ?? src.subject}，設計迴圈沒有開始。`
        : `第 ${from.order} 層「${from.zh}」的設計迴圈還沒全部走到「是否符合需求＝是」${passed.length ? `（${passed.length}／${from.objects.length} 個走完）` : ""}：${blocking.join("；")}。`,
    });
  }
  return { name: f.name, version: f.version, settings: ctx.settings, layers, twoSources, holdPoints, approval: ctx.approval, problems: [], rationaleGaps: rationaleGaps(h), holdDecisions: holdDecisions(h) };
}

/** 元模型類別（server/metamodel.ts 的 CATEGORIES）的元素，缺 why 或 judge 的列出來（只警告）。
 * 連接埠（InterfacePort）、分數屬性（TradeScore）這類輔助元素不是使用者寫說明的對象，不列。 */
function rationaleGaps(h: Helpers): RationaleGap[] {
  const cats = CATEGORIES.map((c) => c.id);
  const out: RationaleGap[] = [];
  for (const e of h.of(...cats)) {
    const missing = (["why", "judge"] as const).filter((k) => !(e.attrs[k] ?? "").trim());
    if (missing.length) out.push({ id: e.id, name: h.name(e), category: e.category ?? "", missing: [...missing],
      text: missing.map((m) => (m === "why" ? "缺「為什麼」" : "缺「判定條件」")).join("、") });
  }
  return out;
}

/** 喊卡中的設計決策（只警告）。 */
function holdDecisions(h: Helpers): HoldDecision[] {
  return h.of("DesignDecision").filter((e) => (e.attrs.releaseStatus ?? "").trim() === "hold").map((e) => {
    const reason = (e.attrs.holdReason ?? "").trim();
    return { id: e.id, name: h.name(e), reason, text: `${h.name(e)} 喊卡中：${reason.replace(/[。；]+$/, "") || "（沒寫原因）"}；下一層可以寫，但會顯示警告。` };
  });
}

/** 新增某類別的元素時，喊卡中的決策警告（不擋）。只在新增的是下一層的類別（有卡點的類別）時帶；null＝沒有。 */
export function holdDecisionNote(ev: FrameworkEval, category: string): string | null {
  if (!ev.holdDecisions.length || !ev.holdPoints.some((x) => x.category === category)) return null;
  return ev.holdDecisions.map((d) => d.text).join("\n");
}

/** 新增某類別的元素時的卡點警告（不擋）。null＝沒有卡點。 */
export function holdPointBlock(ev: FrameworkEval, category: string): string | null {
  const hp = ev.holdPoints.find((x) => x.category === category);
  if (!hp || hp.open) return null;
  return `卡點警告：已新增${hp.zh}，但上一層設計迴圈還沒走完，下一層需求應從上一層設計迴圈的產出推導。${hp.reason}`;
}

/** 審查節點的框架檢查（MGT-02）：節點前該層的步驟，以及迴圈層每個對象的迴圈是否走完。 */
export interface FwGateCheck { id: string; label: string; hint: string; manual: boolean; pass: boolean; detail: string; missing: { id: string; name: string }[]; pending: boolean }
export function gateChecks(ev: FrameworkEval, gate: string, nameOf: (id: string) => string): FwGateCheck[] {
  const out: FwGateCheck[] = [];
  const add = (l: LayerResult, r: StepResult) => {
    if (r.gate || !r.checkZh) return;
    out.push({ id: `${gate}.fw.${l.id}.${r.id}`, label: `第 ${l.order} 層 ${r.zh}：${r.checkZh}`, hint: r.ownerZh ? `負責：${r.ownerZh}` : "", manual: false,
      pass: r.done === true, pending: r.done === null, detail: r.done === null ? "待接：先人工確認" : r.done ? "完成" : (r.issues[0]?.text ?? "未完成"),
      missing: r.issues.filter((i) => i.id).map((i) => ({ id: i.id as string, name: nameOf(i.id as string) })) });
  };
  for (const l of ev.layers) {
    if (l.kind === "chain") {
      const at = l.steps.findIndex((s) => s.gate === gate);
      if (at < 0) continue;
      let from = at - 1;
      while (from >= 0 && !l.steps[from].gate) from--;
      for (const r of l.steps.slice(from + 1, at)) add(l, r);
    } else if (l.gate === gate) {
      for (const r of l.before) add(l, r);
      const passed = l.objects.filter((o) => o.passed);
      out.push({ id: `${gate}.fw.${l.id}.loop`, label: `第 ${l.order} 層「${l.zh}」設計迴圈走完`, hint: "每個對象都要到「是否符合需求＝是」", manual: false, pending: false,
        pass: l.objects.length > 0 && passed.length === l.objects.length,
        detail: l.objects.length === 0 ? "還沒有對象" : `${passed.length}／${l.objects.length} 個走完`,
        missing: l.objects.filter((o) => !o.passed && o.id).map((o) => ({ id: o.id as string, name: o.name })) });
      for (const r of l.after) add(l, r);
    }
  }
  return out;
}

/** 一層會產生的類別（框架檔順序、不重複）：鏈狀步驟／迴圈前步驟 → 迴圈產出 → 迴圈各步 → 迴圈後步驟。 */
export function layerProduces(f: Framework, l: Layer): string[] {
  const loop = l.kind === "loop" ? f.designLoop.steps.filter((s) => (l.loopSteps ?? []).includes(s.id)) : [];
  const list = [...(l.steps ?? []), ...(l.before ?? [])].flatMap((s) => s.produces ?? [])
    .concat(l.loopProduces ?? [], loop.flatMap((s) => s.produces ?? []), (l.after ?? []).flatMap((s) => s.produces ?? []));
  return [...new Set(list)];
}

/**
 * 分層歸屬（MOD-02）：每層產生的類別裡，哪些元素屬於這一層。規則和本層 FMEA（objectRisks）同一套：
 * 只有一層產生的類別全部算該層；好幾層都產生的類別（風險、設計方案、性能量度…），有 @LayerTag 就照標記，
 * 沒有就看是否連到本層的對象（或它的零件）、本層需求、本層設計方案與候選、分配給本層對象的功能。
 */
export function layerMembers(f: Framework, ctx: FwContext): Record<string, Record<string, string[]>> {
  const h = helpers(ctx);
  const made = new Map(f.layers.map((l) => [l.id, layerProduces(f, l)]));
  const owners = new Map<string, number>();
  for (const cats of made.values()) for (const c of cats) owners.set(c, (owners.get(c) ?? 0) + 1);
  const out: Record<string, Record<string, string[]>> = {};
  for (const l of f.layers) {
    const tag = LAYER_TAG[l.subject];
    const objs = l.kind === "loop" ? objectsOf(h, l) : [];
    const ids = new Set<string>();
    for (const o of objs) {
      const reqs = reqsOf(h, l, o, objs);
      const s: Scope = { layer: l, step: f.designLoop.steps[0], object: o, reqs };
      if (o) for (const x of objectIds(h, o)) ids.add(x);
      for (const r of reqs) ids.add(r.id);
      for (const alt of objectAlternatives(h, s)) { ids.add(alt.id); for (const v of variantsOf(h, alt)) ids.add(v.id); }
    }
    for (const fn of h.of("Function")) if (h.out(fn, ["allocate"]).some((t) => ids.has(t.id))) ids.add(fn.id);
    const members: Record<string, string[]> = {};
    for (const c of made.get(l.id) ?? []) {
      if (c === "Doc") continue;
      const els = h.of(c);
      members[c] = ((owners.get(c) ?? 0) <= 1 ? els
        : els.filter((e) => ((e.attrs.layer ?? "").trim() ? e.attrs.layer === tag : ids.has(e.id) || h.linked(e, ids)))).map((e) => e.id);
    }
    out[l.id] = members;
  }
  return out;
}
