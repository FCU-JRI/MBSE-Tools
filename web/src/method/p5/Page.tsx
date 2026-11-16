// P5 的頁面「風險與 FMEA」（METHOD.md 第 7 節）：FMEA 工作表、四張圖、風險登記與尺度定義。
// 數字都從模型算（core.ts），改值直接寫回模型（PATCH /elements），以人填的為準。
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../../api.ts";
import type { View } from "../../api.ts";
import type { MethodPageProps } from "../registry.ts";
import { MUST_ACT, SCALE_D, SCALE_O, SCALE_S, bySubsystem, fmeaRows, label, riskRows } from "./core.ts";
import type { FmeaRow, RiskRow, ScaleRow } from "./core.ts";
import { HeatSO, RiskLC, RiskSI, SubsystemTable } from "./Charts.tsx";
import "./p5.css";

type Tab = "sheet" | "heat" | "lc" | "si" | "sub" | "risks" | "scales";
const TABS: [Tab, string][] = [["sheet", "FMEA 工作表"], ["heat", "S × O 熱圖"], ["lc", "風險：可能性 × 後果"], ["si", "風險：嚴重度 × 影響範圍"], ["sub", "依次系統彙整"], ["risks", "風險登記"], ["scales", "尺度定義"]];

export function RiskFmeaPage({ view, user, onChanged, onOpen }: MethodPageProps) {
  const [tab, setTab] = useState<Tab>("sheet");
  const [error, setError] = useState("");
  const a = view.analysis;
  const rows = useMemo(() => (a.ok ? fmeaRows(a) : []), [a]);
  const risks = useMemo(() => (a.ok ? riskRows(a) : []), [a]);
  const subs = useMemo(() => bySubsystem(rows), [rows]);
  const id = view.project.id;
  const canEdit = user.caps.edit && !view.project.readOnly;
  const run = async (fn: () => Promise<View>) => {
    setError("");
    try { onChanged(await fn()); } catch (e) { setError((e as Error).message); }
  };
  const patch = (elementId: string, attrs: Record<string, string>) => run(() => api<View>(`/projects/${id}/elements`, "PATCH", { id: elementId, attrs }));
  const filled = rows.filter((r) => r.fm);
  const missing = filled.filter((r) => r.missingAction).length;
  if (!a.ok) return <section className="section"><p className="body">模型目前有錯誤，修正後才算得出 FMEA。</p></section>;
  return (
    <section className="section p5">
      <div className="section-head">
        <h1 className="section-title">風險與 FMEA</h1>
        <span className="label">失效模式 {filled.length} · 骨架列 {rows.length - filled.length} · S ≥ {MUST_ACT} 未矯正 {missing} · 風險 {risks.length}</span>
        <span style={{ flex: 1 }} />
        <a className="tbtn" href={`/api/projects/${id}/fmea.xlsx`}>匯出比賽格式（附件 12）</a>
      </div>
      <nav className="seg no-print" role="tablist" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {TABS.map(([t, zh]) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{zh}</button>)}
      </nav>
      {error && <p className="body" role="alert" style={{ color: "var(--danger)" }}>{error}</p>}
      {tab === "sheet" && <Sheet rows={rows} canEdit={canEdit} patch={patch} onOpen={onOpen} create={(fn, sub, name) => run(() => api<View>(`/projects/${id}/fmea/rows`, "POST", { function: fn, subsystem: sub, name }))} />}
      {tab === "heat" && <HeatSO rows={rows} onPick={onOpen} />}
      {tab === "lc" && <RiskLC risks={risks} onPick={onOpen} />}
      {tab === "si" && <RiskSI risks={risks} onPick={onOpen} />}
      {tab === "sub" && <SubsystemTable list={subs} />}
      {tab === "risks" && <Risks risks={risks} canEdit={canEdit} onOpen={onOpen}
        mitigate={(risk, category, name) => run(() => api<View>(`/projects/${id}/risks/mitigation`, "POST", { risk, category, name, ...(category === "VerificationEvent" ? { method: "test" } : {}) }))} />}
      {tab === "scales" && <Scales />}
    </section>
  );
}

/** 一格可以改的值：離開欄位時才寫回模型。 */
function Cell({ value, placeholder, canEdit, onSave, num, wide }: { value: string; placeholder?: string; canEdit: boolean; onSave: (v: string) => void; num?: boolean; wide?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (!canEdit) return <>{value || <span className="faint">{placeholder ?? ""}</span>}</>;
  const v = draft ?? value;
  const commit = () => { if (draft !== null && draft.trim() !== value.trim()) onSave(draft.trim()); setDraft(null); };
  return num
    ? <input className="p5-num" inputMode="numeric" value={v} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} aria-label={placeholder} />
    : <textarea className={`p5-text${wide ? " wide" : ""}`} rows={2} value={v} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onBlur={commit} />;
}

function Sheet({ rows, canEdit, patch, onOpen, create }: { rows: FmeaRow[]; canEdit: boolean; patch: (id: string, attrs: Record<string, string>) => void; onOpen: (id: string) => void; create: (fn: string | null, sub: string | null, name: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [newName, setNewName] = useState<Record<string, string>>({});
  if (!rows.length) return <p className="body">還沒有「功能 → 次系統」的分配。到圖 4（功能與分配）把功能分配給次系統，這裡就會產生 FMEA 的列。</p>;
  const sd = (r: FmeaRow, k: "s" | "d") => {
    const human = k === "s" ? r.sHuman : r.dHuman, sug = k === "s" ? r.sSuggest : r.dSuggest, field = k === "s" ? "severity" : "detection";
    return (
      <div className="p5-sd" title={`建議值 ${sug.value ?? "—"}：${sug.basis}`}>
        <Cell num canEdit={canEdit && !!r.fm} value={human === null ? "" : String(human)} placeholder={sug.value === null ? "?" : String(sug.value)} onSave={(v) => patch(r.fm!.id, { [field]: v })} />
        {human === null ? <span className="tag">建議</span> : <span className="tag done">人填</span>}
      </div>
    );
  };
  const n = (v: number | null) => (v === null ? <span className="faint">—</span> : v);
  return (
    <div className="p5-scroll">
      <p className="caption">清單先依 S 由高到低，S 相同再依 RPN、再依影響範圍。S、D 空白時用建議值（滑過看依據，點「依據」展開），填了就以人填的為準。S ≥ {MUST_ACT} 一律要有矯正措施。</p>
      <table className="p5-sheet">
        <thead>
          <tr><th rowSpan={2}>次系統</th><th rowSpan={2}>功能</th><th rowSpan={2}>潛在失效模式</th><th rowSpan={2}>失效影響</th><th rowSpan={2}>失效因素</th><th rowSpan={2}>現狀控制</th>
            <th colSpan={4}>矯正前</th><th rowSpan={2}>建議矯正措施／狀態</th><th rowSpan={2}>負責人／日期</th><th colSpan={5}>矯正結果</th><th rowSpan={2}>影響範圍</th><th rowSpan={2}></th></tr>
          <tr><th>O</th><th>S</th><th>D</th><th>RPN</th><th>完成</th><th>O</th><th>S</th><th>D</th><th>RPN</th></tr>
        </thead>
        <tbody>{rows.map((r) => {
          const fm = r.fm;
          const save = (k: string) => (v: string) => fm && patch(fm.id, { [k]: v });
          const expanded = open === r.key;
          return [
            <tr key={r.key} className={r.missingAction ? "p5-alert" : undefined}>
              <td>{r.subsystem.name}</td><td>{r.fn.name}</td>
              <td>{fm ? <button className="linkish" onClick={() => onOpen(fm.id)}>{label(fm)}</button> : canEdit ? (
                <form onSubmit={(e) => { e.preventDefault(); const v = (newName[r.key] ?? "").trim(); if (v) { create(r.fn.id, r.subsystem.id, v); setNewName({ ...newName, [r.key]: "" }); } }} className="p5-new">
                  <input value={newName[r.key] ?? ""} placeholder="填潛在失效模式" onChange={(e) => setNewName({ ...newName, [r.key]: e.target.value })} aria-label={`${r.subsystem.name} × ${r.fn.name} 的潛在失效模式`} />
                  <button className="tbtn" type="submit">新增</button>
                </form>) : <span className="faint">（尚未填）</span>}</td>
              {fm ? <>
                <td><Cell canEdit={canEdit} value={r.effect} onSave={save("effect")} /></td>
                <td><Cell canEdit={canEdit} value={r.cause} onSave={save("cause")} /></td>
                <td><Cell canEdit={canEdit} value={r.control} onSave={save("control")} /></td>
                <td><Cell num canEdit={canEdit} value={r.o === null ? "" : String(r.o)} placeholder="O" onSave={save("occurrenceRating")} /></td>
                <td>{sd(r, "s")}</td><td>{sd(r, "d")}</td><td className="id">{n(r.rpn)}</td>
                <td><Cell wide canEdit={canEdit} value={r.action} placeholder={r.mustAct ? "S ≥ 8，必填" : ""} onSave={save("correctiveAction")} />{r.missingAction && <span className="tag danger">要矯正</span>}</td>
                <td><Cell canEdit={canEdit} value={r.owner} placeholder="負責人" onSave={save("owner")} /><Cell canEdit={canEdit} value={r.due} placeholder="日期" onSave={save("due")} /></td>
                <td>{canEdit ? <input type="checkbox" checked={r.done} onChange={(e) => patch(fm.id, { done: e.target.checked ? "是" : "" })} aria-label="完成校正" /> : r.done ? "√" : ""}</td>
                <td><Cell num canEdit={canEdit} value={r.oAfter === null ? "" : String(r.oAfter)} placeholder="O" onSave={save("occurrenceAfter")} /></td>
                <td><Cell num canEdit={canEdit} value={r.sAfter === null ? "" : String(r.sAfter)} placeholder="S" onSave={save("severityAfter")} /></td>
                <td><Cell num canEdit={canEdit} value={r.dAfter === null ? "" : String(r.dAfter)} placeholder="D" onSave={save("detectionAfter")} /></td>
                <td className="id">{n(r.rpnAfter)}</td>
              </> : <><td colSpan={3}></td><td className="faint" title={r.sSuggest.basis}>{r.sSuggest.value ?? "—"}</td><td className="faint" title={r.dSuggest.basis}>{r.dSuggest.value ?? "—"}</td><td colSpan={8}></td></>}
              <td className="id" title={`需求 ${r.impact.requirements.length}、介面 ${r.impact.interfaces}、元件 ${r.impact.components.length}`}>{r.impact.total}</td>
              <td><button className="tbtn" onClick={() => setOpen(expanded ? null : r.key)} aria-expanded={expanded}>依據</button></td>
            </tr>,
            expanded && <tr key={`${r.key}-why`} className="p5-why"><td colSpan={19}>
              <p className="body"><b>嚴重度建議 {r.sSuggest.value ?? "—"}</b>：{r.sSuggest.basis}{r.sHuman !== null && fm && canEdit && <> <button className="tbtn" onClick={() => patch(fm.id, { severity: "" })}>改用建議值</button></>}</p>
              <p className="body"><b>難檢度建議 {r.dSuggest.value ?? "—"}</b>：{r.dSuggest.basis}{r.dHuman !== null && fm && canEdit && <> <button className="tbtn" onClick={() => patch(fm.id, { detection: "" })}>改用建議值</button></>}</p>
              <p className="body"><b>影響範圍 {r.impact.total}</b>：需求 {r.impact.requirements.length}、介面 {r.impact.interfaces}、元件 {r.impact.components.length}{r.impact.components.length > 0 && `（${r.impact.components.join("、")}）`}</p>
            </td></tr>,
          ];
        })}</tbody>
      </table>
    </div>
  );
}

function Risks({ risks, canEdit, onOpen, mitigate }: { risks: RiskRow[]; canEdit: boolean; onOpen: (id: string) => void; mitigate: (risk: string, category: string, name: string) => void }) {
  const [draft, setDraft] = useState<Record<string, { category: string; name: string }>>({});
  if (!risks.length) return <p className="body">還沒有風險。到左側「風險與安全」新增；連到它威脅的需求用「追溯」（從風險連到需求）。</p>;
  const list = (l: { id: string; shortName: string | null; name: string }[], empty: ReactNode = <span className="faint">—</span>) => l.length ? l.map((e) => <div key={e.id}><button className="linkish" onClick={() => onOpen(e.id)}>{label(e as never)}</button></div>) : empty;
  const tag = (r: RiskRow) => r.score === null ? <span className="faint">—</span> : <span className={`tag ${r.level === "high" ? "danger" : r.level === "mid" ? "warn" : ""}`}>{r.score}</span>;
  return (
    <div className="p5-scroll">
      <p className="caption">風險用可能性 × 後果（各 1–5）。威脅的需求、掛在哪個層級、來源，都用「追溯」從風險連出去；緩解產生的需求與追加的驗證從它們連回風險（來源就是這個風險）。</p>
      <table>
        <thead><tr><th>風險</th><th>可能性</th><th>後果</th><th>分數</th><th>緩解後</th><th>掛在</th><th>威脅的需求</th><th>來源</th><th>緩解措施</th><th>緩解產生的需求</th><th>追加的驗證</th><th>影響範圍</th>{canEdit && <th>新增緩解</th>}</tr></thead>
        <tbody>{risks.map((r) => {
          const d = draft[r.risk.id] ?? { category: "SystemRequirement", name: "" };
          return (
            <tr key={r.risk.id}>
              <td><button className="linkish" onClick={() => onOpen(r.risk.id)}>{label(r.risk)}</button></td>
              <td className="id">{r.likelihood ?? "—"}</td><td className="id">{r.consequence ?? "—"}</td><td>{tag(r)}</td>
              <td className="id">{r.residualLikelihood || r.residualConsequence ? `${r.residualLikelihood ?? r.likelihood ?? "—"} × ${r.residualConsequence ?? r.consequence ?? "—"}` : "—"}</td>
              <td>{list(r.attachedTo)}</td><td>{list(r.threatens, <span className="tag warn">未連需求</span>)}</td>
              <td>{r.risk.attrs.source && <div>{r.risk.attrs.source}</div>}{list(r.sources, r.risk.attrs.source ? null : undefined)}</td>
              <td>{r.risk.attrs.mitigation || <span className="faint">—</span>}</td>
              <td>{list(r.mitigationRequirements)}</td><td>{list(r.mitigationVerifications)}</td>
              <td className="id" title={`需求 ${r.impact.requirements.length}、介面 ${r.impact.interfaces}、元件 ${r.impact.components.length}`}>{r.impact.total}</td>
              {canEdit && <td>
                <form className="p5-new" onSubmit={(e) => { e.preventDefault(); if (d.name.trim()) { mitigate(r.risk.id, d.category, d.name.trim()); setDraft({ ...draft, [r.risk.id]: { ...d, name: "" } }); } }}>
                  <select value={d.category} onChange={(e) => setDraft({ ...draft, [r.risk.id]: { ...d, category: e.target.value } })} aria-label="緩解的種類">
                    <option value="SystemRequirement">系統需求</option><option value="SubsystemRequirement">次系統需求</option><option value="ComponentRequirement">元件需求</option><option value="VerificationEvent">追加驗證（測試）</option>
                  </select>
                  <input value={d.name} placeholder="名稱" onChange={(e) => setDraft({ ...draft, [r.risk.id]: { ...d, name: e.target.value } })} aria-label="緩解的名稱" />
                  <button className="tbtn" type="submit">新增</button>
                </form>
              </td>}
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function ScaleTable({ title, head, list }: { title: string; head: [string, string, string]; list: ScaleRow[] }) {
  return (
    <div>
      <h2 className="section-title" style={{ fontSize: "1rem" }}>{title}</h2>
      <table><thead><tr><th>{head[0]}</th><th>{head[1]}</th>{head[2] && <th>{head[2]}</th>}<th>等級</th></tr></thead>
        <tbody>{list.map((s) => <tr key={s.value}><td>{s.group}</td><td>{s.criterion}</td>{head[2] && <td>{s.note}</td>}<td className="id">{s.value}</td></tr>)}</tbody></table>
    </div>
  );
}

function Scales() {
  return (
    <div className="stack">
      <p className="caption">照台灣盃火箭競賽附件 12 的三張定義表（只採格式與判定準則）。RPN = O × S × D。</p>
      <ScaleTable title="發生度 O" head={["可能性", "判定準則（在項目的可靠度／設計壽命內）", "發生頻率"]} list={SCALE_O} />
      <ScaleTable title="嚴重度 S" head={["影響", "判定準則：影響嚴重性", ""]} list={SCALE_S} />
      <ScaleTable title="難檢度 D" head={["檢測機會", "判定準則", "檢測可能性"]} list={SCALE_D} />
    </div>
  );
}
