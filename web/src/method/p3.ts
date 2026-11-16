// P3：任務剖面、功能分配、MOE／MOP／TPM 的推導鏈（docs/METHOD.md 2.1、2.2，METHOD-NASA 第二部分第 1、5、6 點）。
// 只讀解析結果、不改模型；前端的圖與頁面、伺服器的路由（server/method/p3.ts）都用這裡的函式，算法只有一份。
//
// 推導鏈與模型裡的寫法（都是標準 SysML v2，加上 JRI.sysml 的 P3 區塊）：
//   任務需求（MissionRequirement，P1 新增的類別）
//     ← 任務剖面：任務階段（MissionPhase）以 #trace（或 satisfy、#refinement、衍生）連到它滿足的任務需求
//   任務階段 → 功能（Function）：功能寫在階段裡面，或以 #trace 連到階段
//   功能 → 系統（System，可以有好幾個）：allocate 功能 to 系統;
//   系統需求（SystemRequirement）→ 系統：satisfy 需求 by 系統;，或追溯到已分配給某系統的功能
//   系統需求 → 任務需求：#derivation（衍生自）
//   模式（Mode）的種類：@ModeKind { kind = "operational" | "failure" | "abort"; }
//   MOE 的三級成功判準：@SuccessLevels { full = …; partial = …; }
//   MOE → MOP：MOP 衍生自（或細化）MOE；TPM 是挑出來追蹤的 MOP，標 @TPMTrack，各節點記目前估計值
import type { Analysis, Element, Relation } from "../api.ts";

/** P1 新增的任務需求類別；P1 還沒合併前只用這個 id，不在這裡重複定義（docs/IMPL-PLAN.md）。 */
export const MISSION_REQUIREMENT = "MissionRequirement";

export const MODE_KINDS = [
  { id: "operational", zh: "正常操作" },
  { id: "failure", zh: "失效" },
  { id: "abort", zh: "中止" },
] as const;
export type ModeKindId = (typeof MODE_KINDS)[number]["id"];

/** 追蹤 TPM 的審查節點，順序就是趨勢圖的橫軸；代號和 server/gates.ts 相同。 */
export const TPM_GATES = [
  { id: "proposal", zh: "計畫提案" },
  { id: "mdr", zh: "MDR" },
  { id: "pdr", zh: "PDR" },
  { id: "cdr", zh: "CDR" },
  { id: "trr", zh: "TRR" },
  { id: "frr", zh: "FRR" },
] as const;

/** 網站上可以設定的標記與欄位（JRI.sysml 的 P3 區塊）。type 決定寫進模型的格式。 */
export const P3_META: Record<string, { zh: string; fields: { name: string; zh: string; type: "real" | "text" }[] }> = {
  ModeKind: { zh: "模式的種類", fields: [{ name: "kind", zh: "種類", type: "text" }] },
  SuccessLevels: { zh: "三級成功判準", fields: [
    { name: "full", zh: "完全成功", type: "real" }, { name: "partial", zh: "部分成功", type: "real" },
    { name: "unit", zh: "單位", type: "text" }, { name: "better", zh: "越大越好（higher）或越小越好（lower）", type: "text" },
    { name: "actual", zh: "實際值", type: "real" }] },
  TPMTrack: { zh: "TPM 追蹤", fields: [
    { name: "expected", zh: "預期值", type: "real" }, { name: "lower", zh: "下限", type: "real" }, { name: "upper", zh: "上限", type: "real" },
    { name: "unit", zh: "單位", type: "text" }, ...TPM_GATES.map((g) => ({ name: g.id, zh: `${g.zh} 估計值`, type: "real" as const }))] },
};

export interface Gap { id: string | null; text: string }

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const str = (s: string | undefined): string | null => (s === undefined ? null : s.replace(/^"(.*)"$/, "$1"));

/** 圖與頁面共用的索引 */
function index(a: Analysis) {
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const of = (cat: string) => a.elements.filter((e) => e.category === cat && e.kind !== "Package");
  // 兩端之間任何一種追溯（方向不拘）；succession、transition、connect 是行為與結構的連線，不算追溯
  const TRACE = new Set<Relation["kind"]>(["trace", "derive", "refine", "satisfy"] as Relation["kind"][]);
  const linked = new Map<string, Set<string>>();
  const add = (x: string, y: string) => { if (!linked.has(x)) linked.set(x, new Set()); linked.get(x)!.add(y); };
  for (const r of a.relations) if (TRACE.has(r.kind as Relation["kind"])) { add(r.from, r.to); add(r.to, r.from); }
  const near = (id: string) => linked.get(id) ?? new Set<string>();
  const ancestors = (e: Element): Element[] => {
    const out: Element[] = [];
    let cur = byId.get(e.parent ?? e.owner ?? "");
    for (let i = 0; cur && i < 40; i++) { out.push(cur); cur = byId.get(cur.parent ?? cur.owner ?? ""); }
    return out;
  };
  return { byId, of, near, ancestors };
}

/** 模式的種類；沒有標 @ModeKind 或值不認得時是 null */
export function modeKindOf(e: Element): ModeKindId | null {
  if (!e.tags.includes("ModeKind")) return null;
  const k = str(e.attrs.kind);
  return MODE_KINDS.some((m) => m.id === k) ? (k as ModeKindId) : null;
}

export interface Chain {
  missionRequirements: { id: string; phases: string[]; systemRequirements: string[] }[];
  phases: { id: string; missionRequirements: string[]; functions: string[] }[];
  modes: { id: string; kind: ModeKindId | null; container: boolean }[];
  functions: { id: string; phases: string[]; systems: string[] }[];
  /** 系統：part 使用以它的定義為準（火箭的定義和 rocket 這個使用算同一個系統） */
  systems: { id: string; functions: string[]; requirements: string[] }[];
  systemRequirements: { id: string; systems: string[]; functions: string[]; missionRequirements: string[] }[];
}

/** 任務需求 → 任務剖面 → 功能 → 分配到各系統 → 系統需求 */
export function chainOf(a: Analysis): Chain {
  const { byId, of, near, ancestors } = index(a);
  const systemEls = of("System");
  const systemKey = (e: Element): string => {
    if (e.kind.endsWith("Usage")) { const d = e.typeIds.map((t) => byId.get(t)).find((x) => x?.category === "System"); if (d) return d.id; }
    return e.id;
  };
  const isSystem = (id: string) => byId.get(id)?.category === "System";
  const mrs = of(MISSION_REQUIREMENT), phases = of("MissionPhase"), fns = of("Function"), srs = of("SystemRequirement"), modes = of("Mode");
  const mrSet = new Set(mrs.map((e) => e.id)), phaseSet = new Set(phases.map((e) => e.id));

  const phaseRows = phases.map((p) => ({ id: p.id, missionRequirements: [...near(p.id)].filter((x) => mrSet.has(x)), functions: [] as string[] }));
  const phaseRow = new Map(phaseRows.map((r) => [r.id, r]));

  const fnRows = fns.map((f) => {
    const own = ancestors(f).find((x) => phaseSet.has(x.id));
    const ph = new Set([...(own ? [own.id] : []), ...[...near(f.id)].filter((x) => phaseSet.has(x))]);
    const sys = new Set(a.relations.filter((r) => r.kind === "allocate" && r.from === f.id && isSystem(r.to)).map((r) => systemKey(byId.get(r.to)!)));
    for (const p of ph) phaseRow.get(p)?.functions.push(f.id);
    return { id: f.id, phases: [...ph], systems: [...sys] };
  });
  const fnRow = new Map(fnRows.map((r) => [r.id, r]));

  const srRows = srs.map((s) => {
    const fn = [...near(s.id)].filter((x) => fnRow.has(x));
    const direct = a.relations.filter((r) => r.kind === "satisfy" && r.to === s.id && isSystem(r.from)).map((r) => systemKey(byId.get(r.from)!));
    // 沒有直接寫 satisfy 時，以追溯到的功能分配到的系統為準
    const sys = new Set(direct.length ? direct : fn.flatMap((f) => fnRow.get(f)!.systems));
    return { id: s.id, systems: [...sys], functions: fn, missionRequirements: [...near(s.id)].filter((x) => mrSet.has(x)) };
  });

  const keys = [...new Set(systemEls.map(systemKey))];
  const systems = keys.map((k) => ({
    id: k,
    functions: fnRows.filter((f) => f.systems.includes(k)).map((f) => f.id),
    requirements: srRows.filter((s) => s.systems.includes(k)).map((s) => s.id),
  }));
  const modeSet = new Set(modes.map((m) => m.id));
  return {
    missionRequirements: mrs.map((m) => ({
      id: m.id,
      // 階段裡面的子階段也算在剖面裡：只要它或它的上層連到這條任務需求
      phases: phaseRows.filter((p) => p.missionRequirements.includes(m.id)).map((p) => p.id),
      systemRequirements: srRows.filter((s) => s.missionRequirements.includes(m.id)).map((s) => s.id),
    })),
    phases: phaseRows,
    modes: modes.map((m) => ({ id: m.id, kind: modeKindOf(m), container: modes.some((x) => (x.parent ?? x.owner) === m.id) || !ancestors(m).some((x) => modeSet.has(x.id)) })),
    functions: fnRows,
    systems,
    systemRequirements: srRows,
  };
}

export type Level = "full" | "partial" | "fail";
export const LEVEL_ZH: Record<Level, string> = { full: "完全成功", partial: "部分成功", fail: "不成功" };

export interface SuccessLevels { full: number | null; partial: number | null; unit: string | null; better: "higher" | "lower"; actual: number | null }
export interface TpmTrack { expected: number | null; lower: number | null; upper: number | null; unit: string | null; points: { gate: string; value: number }[] }

export interface Measures {
  moes: { id: string; levels: SuccessLevels | null; level: Level | null; mops: string[] }[];
  mops: { id: string; moes: string[]; tpm: boolean }[];
  tpms: { id: string; mop: string | null; track: TpmTrack; latest: { gate: string; value: number } | null; status: "within" | "out" | "unknown" }[];
}

export function levelsOf(e: Element): SuccessLevels | null {
  if (!e.tags.includes("SuccessLevels")) return null;
  return { full: num(e.attrs.full), partial: num(e.attrs.partial), unit: str(e.attrs.unit), better: str(e.attrs.better) === "lower" ? "lower" : "higher", actual: num(e.attrs.actual) };
}

/** 實際值落在哪一級；數字不齊時是 null */
export function levelOf(l: SuccessLevels, value: number | null = l.actual): Level | null {
  if (value === null || l.full === null || l.partial === null) return null;
  const ge = (x: number, y: number) => (l.better === "lower" ? x <= y : x >= y);
  return ge(value, l.full) ? "full" : ge(value, l.partial) ? "partial" : "fail";
}

export function trackOf(e: Element): TpmTrack {
  return {
    expected: num(e.attrs.expected), lower: num(e.attrs.lower), upper: num(e.attrs.upper), unit: str(e.attrs.unit),
    points: e.tags.includes("TPMTrack") ? TPM_GATES.flatMap((g) => { const v = num(e.attrs[g.id]); return v === null ? [] : [{ gate: g.id as string, value: v }]; }) : [],
  };
}

/** 目前估計值是否落在允許範圍內 */
export function tpmStatus(t: TpmTrack, value: number | null): "within" | "out" | "unknown" {
  if (value === null || (t.lower === null && t.upper === null)) return "unknown";
  return (t.lower === null || value >= t.lower) && (t.upper === null || value <= t.upper) ? "within" : "out";
}

/** MOE（三級成功判準）→ MOP → TPM（含各節點的估計值） */
export function measuresOf(a: Analysis): Measures {
  const { of, near } = index(a);
  const moes = of("MOE"), mops = of("MOP");
  const moeSet = new Set(moes.map((e) => e.id)), mopSet = new Set(mops.map((e) => e.id));
  // MOP 由 MOE 推出：MOP 衍生自或細化 MOE（方向不拘，兩種寫法都認）
  const mopsOf = (moe: string) => [...near(moe)].filter((x) => mopSet.has(x));
  // TPM：標 @TPMTrack 的 MOP；結構上標 #tpm 的屬性也算，以追溯連到 MOP
  const tracked = a.elements.filter((e) => e.tags.includes("TPMTrack") || e.tags.includes("TPM"));
  return {
    moes: moes.map((m) => { const l = levelsOf(m); return { id: m.id, levels: l, level: l ? levelOf(l) : null, mops: mopsOf(m.id) }; }),
    mops: mops.map((m) => ({ id: m.id, moes: [...near(m.id)].filter((x) => moeSet.has(x)), tpm: m.tags.includes("TPMTrack") })),
    tpms: tracked.map((e) => {
      const track = trackOf(e);
      const latest = track.points.at(-1) ?? null;
      return { id: e.id, mop: mopSet.has(e.id) ? e.id : [...near(e.id)].find((x) => mopSet.has(x)) ?? null, track, latest, status: tpmStatus(track, latest?.value ?? null) };
    }),
  };
}

const nameOf = (a: Analysis, id: string) => a.elements.find((e) => e.id === id)?.name ?? id;

/** 圖 3 任務剖面還缺什麼 */
export function profileGaps(a: Analysis): Gap[] {
  const c = chainOf(a);
  const out: Gap[] = [];
  if (c.missionRequirements.length === 0) out.push({ id: null, text: "還沒有任務需求：先寫任務要達成什麼、不能違反什麼（圖 2）。" });
  if (c.phases.length === 0) out.push({ id: null, text: "還沒有任務階段：用任務階段（MissionPhase）排出任務剖面。" });
  for (const m of c.missionRequirements) if (m.phases.length === 0) out.push({ id: m.id, text: `任務需求「${nameOf(a, m.id)}」還沒有任務階段滿足它（從階段追溯到它）。` });
  const kinds = new Set(c.modes.map((m) => m.kind));
  for (const k of MODE_KINDS) if (!kinds.has(k.id)) out.push({ id: null, text: `還沒有${k.zh}模式：在模式上標 @ModeKind { kind = "${k.id}"; }。` });
  const unmarked = c.modes.filter((m) => !m.container && m.kind === null);
  if (unmarked.length) out.push({ id: unmarked[0].id, text: `${unmarked.length} 個模式還沒標種類（正常操作、失效、中止）。` });
  return out;
}

/** 圖 4 功能與分配還缺什麼 */
export function allocationGaps(a: Analysis): Gap[] {
  const c = chainOf(a), m = measuresOf(a);
  const out: Gap[] = [];
  if (c.functions.length === 0) out.push({ id: null, text: "還沒有功能：要完成任務剖面，需要哪些功能？" });
  for (const f of c.functions) {
    if (f.phases.length === 0) out.push({ id: f.id, text: `功能「${nameOf(a, f.id)}」沒有接到任務階段。` });
    if (f.systems.length === 0) out.push({ id: f.id, text: `功能「${nameOf(a, f.id)}」還沒分配到系統。` });
  }
  for (const s of c.systems) if (s.functions.length && s.requirements.length === 0) out.push({ id: s.id, text: `系統「${nameOf(a, s.id)}」有分配到功能，但還沒有系統需求。` });
  for (const s of c.systemRequirements) {
    if (s.systems.length === 0) out.push({ id: s.id, text: `系統需求「${nameOf(a, s.id)}」不知道屬於哪個系統（satisfy 或追溯到已分配的功能）。` });
    if (s.missionRequirements.length === 0 && c.missionRequirements.length) out.push({ id: s.id, text: `系統需求「${nameOf(a, s.id)}」沒有衍生自任務需求。` });
  }
  for (const e of m.moes) {
    if (!e.levels) out.push({ id: e.id, text: `MOE「${nameOf(a, e.id)}」還沒寫三級成功判準（完全、部分成功的數字）。` });
    if (e.mops.length === 0) out.push({ id: e.id, text: `MOE「${nameOf(a, e.id)}」還沒有 MOP。` });
  }
  if (m.mops.length && !m.tpms.some((t) => t.mop)) out.push({ id: null, text: "還沒從 MOP 挑出 TPM：在要追蹤的 MOP 上標 @TPMTrack。" });
  for (const t of m.tpms) if (t.mop && !t.latest) out.push({ id: t.id, text: `TPM「${nameOf(a, t.id)}」還沒有任何節點的估計值。` });
  return out;
}
