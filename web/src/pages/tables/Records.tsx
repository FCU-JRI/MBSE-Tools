// 工作包 F 的表：決策（放行／喊卡與原因）、TPM 追蹤（各啟用節點的值與趨勢線）、候選方案（含被否決的與否決原因）、模型元素總表（為什麼、判定條件、被引用數）。
// 都由模型即時算出；CSV 與 Excel 匯出帶出同樣的欄位（server/export.ts）。
import type { Element } from "../../api.ts";
import { label, listOf } from "../../model.ts";
import type { Props } from "../../Deliverables.tsx";
import { DataTable } from "./DataTable.tsx";
import "./wp5a.css";
import type { Col } from "./DataTable.tsx";

const STRUCT = new Set(["System", "Subsystem", "Component", "ExternalEntity", "DesignAlternative"]);
const LAYER_ZH: Record<string, string> = { mission: "任務", system: "系統", subsystem: "次系統", component: "元件" };
const linkBtn = (e: Element, onSelect: (id: string) => void) => (
  <button type="button" className="link" onClick={(ev) => { ev.stopPropagation(); onSelect(e.id); }}>{e.shortName ?? e.name}</button>
);

export function Decisions({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const rows = listOf(a.elements, "DesignDecision");
  const targets = (d: Element) => a.relations.filter((r) => r.kind === "trace" && r.from === d.id).map((r) => byId.get(r.to)).filter((x): x is Element => !!x);
  const hold = (d: Element) => d.attrs.releaseStatus === "hold";
  const cols: Col<Element>[] = [
    { key: "id", title: "編號", text: (d) => d.shortName ?? "", cls: "id" },
    { key: "name", title: "名稱", text: (d) => d.name },
    { key: "layer", title: "層級", text: (d) => LAYER_ZH[d.attrs.layer ?? ""] ?? "" },
    { key: "to", title: "方案／選定", text: (d) => targets(d).map((x) => x.shortName ?? x.name).join("、"), render: (d) => <>{targets(d).map((x, i) => <span key={x.id}>{i > 0 && "、"}{linkBtn(x, onSelect)}</span>)}</> },
    { key: "by", title: "決策人", text: (d) => d.attrs.decidedBy ?? "" },
    { key: "on", title: "日期", text: (d) => d.attrs.decidedOn ?? "", cls: "id" },
    { key: "why", title: "理由", text: (d) => d.attrs.rationale ?? d.attrs.why ?? "" },
    { key: "gate", title: "放行／喊卡", text: (d) => (hold(d) ? "喊卡中" : "已放行"), render: (d) => (hold(d) ? <span className="tag danger">喊卡中</span> : <span className="tag done">已放行</span>) },
    { key: "hold", title: "喊卡原因", text: (d) => d.attrs.holdReason ?? "" },
  ];
  return (
    <DataTable name="決策" title="決策" book={{ id: view.project.id, ok: a.ok }} rows={rows} cols={cols} rowId={(d) => d.id} selectedId={selectedId} onSelect={(d) => onSelect(d.id)}
      hint="每個設計決策一列。喊卡只是警告：下一層可以寫，但會顯示警告，不擋迴圈與卡點。放行／喊卡與原因在右欄改。"
      chips={[{ id: "hold", label: "喊卡中", test: hold }, { id: "ok", label: "已放行", test: (d) => !hold(d) }]}
      empty="還沒有設計決策。" />
  );
}

/** TPM 各節點欄位（server/metamodel.ts 的 TPM_GATES） */
const GATES: [string, string, string][] = [["proposal", "atProposal", "提案"], ["mdr", "atMDR", "MDR"], ["pdr", "atPDR", "PDR"], ["cdr", "atCDR", "CDR"], ["trr", "atTRR", "TRR"], ["frr", "atFRR", "FRR"]];
const num = (s: string | undefined) => { const m = String(s ?? "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
export function tpmInfo(e: Element, enabled: string[]) {
  const gates = GATES.filter(([g]) => enabled.includes(g));
  const vals = gates.map(([, f]) => num(e.attrs[f]));
  const t = e.attrs.target ?? "", thr = num(t), dir = /≥|>=/.test(t) ? "ge" : "le";
  const last = [...vals].reverse().find((v) => v != null) ?? null;
  const margin = last == null || thr == null ? null : dir === "le" ? thr - last : last - thr;
  return { gates, vals, thr, dir, last, margin };
}

/** 趨勢線：各節點的值連成折線，虛線是門檻；超過門檻的點標紅 */
function Spark({ vals, thr, dir }: { vals: (number | null)[]; thr: number | null; dir: string }) {
  const pts = vals.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (!pts.length) return <span className="faint">—</span>;
  const all = [...pts.map((p) => p[1]), ...(thr != null ? [thr] : [])], lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const W = 96, H = 26, x = (i: number) => 4 + (vals.length > 1 ? (i * (W - 8)) / (vals.length - 1) : (W - 8) / 2), y = (v: number) => H - 4 - ((v - lo) * (H - 8)) / span;
  const bad = (v: number) => thr != null && (dir === "le" ? v > thr : v < thr);
  return (
    <svg className="tpm-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`趨勢 ${pts.map((p) => p[1]).join("、")}${thr != null ? `，門檻 ${thr}` : ""}`}>
      {thr != null && <line x1={2} x2={W - 2} y1={y(thr)} y2={y(thr)} className="tpm-thr" />}
      <polyline points={pts.map(([i, v]) => `${x(i)},${y(v)}`).join(" ")} className="tpm-line" />
      {pts.map(([i, v]) => <circle key={i} cx={x(i)} cy={y(v)} r={2.5} className={bad(v) ? "tpm-bad" : "tpm-pt"} />)}
    </svg>
  );
}

export function TpmTrack({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const rows = a.elements.filter((e) => e.tags.includes("TPM") && !e.shared);
  const info = (e: Element) => tpmInfo(e, view.project.gates);
  const gates = GATES.filter(([g]) => view.project.gates.includes(g));
  const ok = (e: Element) => { const m = info(e).margin; return m == null ? null : m >= 0; };
  const cols: Col<Element>[] = [
    { key: "id", title: "編號", text: (e) => e.shortName ?? "", cls: "id" },
    { key: "name", title: "TPM", text: (e) => e.name },
    { key: "owner", title: "所屬", text: (e) => byId.get(e.owner ?? "")?.name ?? "" },
    { key: "target", title: "門檻", text: (e) => e.attrs.target ?? "" },
    ...gates.map(([g, f, zh]): Col<Element> => ({ key: g, title: zh, text: (e) => e.attrs[f] ?? "", cls: "id", render: (e) => <>{e.attrs[f] ?? <span className="faint">—</span>}</> })),
    { key: "trend", title: "趨勢", text: (e) => info(e).vals.map((v) => v ?? "").join("→"), render: (e) => { const i = info(e); return <Spark vals={i.vals} thr={i.thr} dir={i.dir} />; } },
    { key: "margin", title: "餘裕", text: (e) => { const m = info(e).margin; return m == null ? "" : String(+m.toFixed(3)); }, cls: "id" },
    { key: "ok", title: "判定", text: (e) => (ok(e) == null ? "" : ok(e) ? "符合" : "不符合"), render: (e) => (ok(e) == null ? <span className="faint">—</span> : ok(e) ? <span className="tag done">符合</span> : <span className="tag danger">不符合</span>) },
  ];
  return (
    <DataTable name="TPM 追蹤" title="TPM 追蹤" book={{ id: view.project.id, ok: a.ok }} rows={rows} cols={cols} rowId={(e) => e.id} selectedId={selectedId} onSelect={(e) => onSelect(e.owner ?? e.id)}
      hint="每個 #tpm 屬性一列，欄是專案啟用的審查節點；餘裕＝門檻與最新值的差（≤ 的門檻為門檻 − 目前，≥ 為目前 − 門檻）。各節點的值在模型頁右欄填。專案沒啟用的節點不顯示，值仍保留在模型裡。"
      chips={[{ id: "bad", label: "不符合", test: (e) => ok(e) === false }, { id: "none", label: "還沒有值", test: (e) => info(e).last == null }]}
      empty="還沒有 TPM：在零件的屬性前加上 #tpm。" />
  );
}

interface VarRow { alt: Element; v: Element; state: "選定" | "否決" | "待決" }
export function Variants({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const decisions = listOf(a.elements, "DesignDecision");
  const chosen = new Set(a.relations.filter((r) => r.kind === "trace" && decisions.some((d) => d.id === r.from)).map((r) => r.to));
  const rows: VarRow[] = a.elements.filter((e) => e.category === "DesignAlternative" && e.kind === "PartDefinition").flatMap((alt) => {
    const vs = a.elements.filter((e) => e.owner === alt.id && e.kind === "PartUsage");
    const any = vs.some((v) => chosen.has(v.id));
    return vs.map((v): VarRow => ({ alt, v, state: chosen.has(v.id) ? "選定" : any ? "否決" : "待決" }));
  });
  const cols: Col<VarRow>[] = [
    { key: "alt", title: "方案", text: (r) => label(r.alt), render: (r) => linkBtn(r.alt, onSelect) },
    { key: "name", title: "候選", text: (r) => r.v.name },
    { key: "state", title: "狀態", text: (r) => r.state, render: (r) => <span className={`tag ${r.state === "選定" ? "done" : r.state === "否決" ? "danger" : ""}`}>{r.state}</span> },
    { key: "why", title: "否決原因", text: (r) => r.v.attrs.rejectWhy ?? "", render: (r) => <>{r.v.attrs.rejectWhy || (r.state === "否決" ? <span className="tag warn">沒寫</span> : <span className="faint">—</span>)}</> },
    { key: "layer", title: "層級", text: (r) => LAYER_ZH[r.alt.attrs.layer ?? ""] ?? "" },
  ];
  return (
    <DataTable name="候選方案" title="候選方案（含被否決的）" book={{ id: view.project.id, ok: a.ok }} rows={rows} cols={cols} rowId={(r) => r.v.id} selectedId={selectedId} onSelect={(r) => onSelect(r.v.id)}
      hint="每個設計方案底下的候選（variant）都列出，包括被否決的。選定看有沒有設計決策以 #trace 連到候選；否決原因在模型頁右欄寫。"
      chips={[{ id: "rej", label: "否決", test: (r) => r.state === "否決" }, { id: "nowhy", label: "否決但沒寫原因", test: (r) => r.state === "否決" && !r.v.attrs.rejectWhy }]}
      empty="還沒有設計方案。" />
  );
}

export function ElementsAll({ view, meta, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const cats = new Map(meta.categories.map((c) => [c.id, c.zh]));
  // 和框架的缺說明判定同一套規則：結構類（系統、次系統、元件、外部對象、設計方案）只列定義，其他只列用法
  const rows = a.elements.filter((e) => !e.shared && e.category && cats.has(e.category) && (STRUCT.has(e.category) ? e.kind === "PartDefinition" : /Usage$/.test(e.kind)));
  const refs = new Map<string, number>();
  for (const r of a.relations) refs.set(r.to, (refs.get(r.to) ?? 0) + 1);
  const missing = (e: Element) => !(e.attrs.why ?? "").trim() || !(e.attrs.judge ?? "").trim();
  const cols: Col<Element>[] = [
    { key: "id", title: "編號", text: (e) => e.shortName ?? "", cls: "id" },
    { key: "name", title: "名稱", text: (e) => e.name },
    { key: "cat", title: "類別", text: (e) => cats.get(e.category ?? "") ?? "" },
    { key: "why", title: "為什麼", text: (e) => e.attrs.why ?? "", render: (e) => <>{e.attrs.why || <span className="tag warn">缺</span>}</> },
    { key: "judge", title: "判定條件", text: (e) => e.attrs.judge ?? "", render: (e) => <>{e.attrs.judge || <span className="tag warn">缺</span>}</> },
    { key: "refs", title: "被引用數", text: (e) => String(refs.get(e.id) ?? 0).padStart(3, "0"), render: (e) => <>{refs.get(e.id) ?? 0}</>, cls: "id" },
  ];
  return (
    <DataTable name="模型元素總表" title="模型元素總表" book={{ id: view.project.id, ok: a.ok }} rows={rows} cols={cols} rowId={(e) => e.id} selectedId={selectedId} onSelect={(e) => onSelect(e.id)}
      hint="所有有類別的模型元素：為什麼這樣定、用什麼條件判定，以及被多少關係引用。缺說明只是提醒，不擋卡點。"
      chips={[{ id: "miss", label: "缺說明", test: missing }, { id: "orphan", label: "沒被引用", test: (e) => !refs.get(e.id) }]}
      filters={[{ id: "cat", label: "類別", options: [...new Set(rows.map((e) => e.category ?? ""))].map((c) => [c, cats.get(c) ?? c] as [string, string]), test: (e, v) => e.category === v }]}
      empty="還沒有模型元素。" />
  );
}
