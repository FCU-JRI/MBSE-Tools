// 方案比較表（唯讀）：每個設計方案（DesignAlternative）一張；欄是候選（variant），列是準則（連到的需求）。
// 準則＝與方案或候選有連結（satisfy／trace／refine／derive）的需求。權重與分數目前沒有專屬欄位，沿用下面說明的屬性寫法。
// 選定＝有設計決策（DesignDecision）以 #trace 連到候選；同一方案下其餘候選視為否決。
// F 包：每條準則附評分標準（@CriterionScale）；每格可填調整後分數（風險緩解後重算，adjusted_<需求編號>）；方案下方列權重敏感度（@TradeSensitivity）；否決的候選列否決原因（@Rejection）。
import { useState } from "react";
import { api } from "../../api.ts";
import type { Element, View } from "../../api.ts";
import { label } from "../../model.ts";
import type { Props } from "../../Deliverables.tsx";
import "./wp5a.css";

const REQ = /Requirement$|^MOP$/;
const LINKS = ["satisfy", "trace", "refine", "derive"];
const key = (r: Element) => `score_${(r.shortName ?? r.name).replace(/\W/g, "_")}`;
const adjKey = (r: Element) => key(r).replace(/^score_/, "adjusted_");
/** 評分標準：1／3／5 分各代表什麼 */
export const scaleText = (r: Element) => ["1", "3", "5"].filter((k) => r.attrs[`scale${k}`]).map((k) => `${k}＝${r.attrs[`scale${k}`]}`).join("；");
const numOf = (v: string | undefined) => { const n = parseFloat(v ?? ""); return Number.isFinite(n) ? n : null; };

/** 填一個數字；離開欄位或按 Enter 時存，清空就刪除。 */
function Num({ value, label: aria, onSave, disabled }: { value: string; label: string; onSave: (v: string) => void; disabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const commit = () => { if (draft !== null && draft.trim() !== value.trim()) onSave(draft.trim()); setDraft(null); };
  return <input className="input num" inputMode="decimal" aria-label={aria} value={shown} disabled={disabled} style={{ width: "4.5rem" }}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setDraft(null); }} />;
}

export function Trade({ view, selectedId, onSelect, onChanged, readOnly }: Props & { readOnly?: boolean }) {
  const a = view.analysis;
  const pid = view.project.id;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [add, setAdd] = useState<Record<string, { req: string; weight: string }>>({});
  const send = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setErr("");
    try { const r = await api<View & { note?: string }>(`/projects/${pid}/trade/${path}`, "POST", body); onChanged(r); if (r.note) setErr(r.note); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const off = busy || !!readOnly;
  const alts = a.elements.filter((e) => e.category === "DesignAlternative" && e.kind === "PartDefinition");
  const decisions = a.elements.filter((e) => e.category === "DesignDecision");
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const allReqs = a.elements.filter((e) => REQ.test(e.category ?? "") && e.kind === "RequirementUsage" && !e.shared);
  const pick = (id: string, e: Element) => <button type="button" className="link" aria-current={selectedId === e.id} onClick={() => onSelect(e.id)}>{id}</button>;

  return (
    <div className="trade">
      <p className="body muted">每個設計方案一張表：欄是候選（variant），列是準則（連到方案的需求）。準則的權重和各候選的分數直接在表上填，離開欄位或按 Enter 就存，清空就刪除。選定看有沒有設計決策以 #trace 連到候選，同方案其餘候選為否決；沒有決策的標「待決」。</p>
      <details style={{ marginBottom: 12 }}>
        <summary>怎麼填、存在哪裡</summary>
        <p className="caption">① 在方案底下「加準則」選一條需求（可同時填權重）。② 在格子裡填各候選對這條準則的分數（越高越好，數字不限範圍）。③ 加權總分＝Σ（權重 × 分數），沒填權重當 1，沒填分數當 0。④ 選定不在這裡填：新增設計決策並以 #trace 連到候選。</p>
        <p className="caption">⑤ 風險緩解後要重算的格子，在「調整」填調整後分數；調整後加權總分會另列一行。評分標準與權重敏感度在模型頁右欄寫（準則需求的「評分標準」、設計方案的「權重敏感度」）。</p>
        <p className="caption">模型裡的寫法：需求上 <code>@TradeWeight {"{ weight = 3.0; }"}</code>、<code>@CriterionScale {"{ scale1 = \"…\"; scale3 = \"…\"; scale5 = \"…\"; }"}</code>；候選上 <code>attribute score_REQ_SYS_001 : TradeScore = 4.0;</code>、<code>attribute adjusted_REQ_SYS_001 : TradeScore = 5.0;</code>；準則連結是 <code>#trace dependency from 方案 to 需求;</code>。</p>
      </details>
      {err && <p className="msg"><span className="tag danger">ERR</span>{err}</p>}
      {alts.length === 0 && <p className="body">還沒有設計方案。在模型頁新增「設計方案」（category DesignAlternative）並列出候選。</p>}
      {alts.map((alt) => {
        const variants = a.elements.filter((e) => e.owner === alt.id && e.kind === "PartUsage");
        const ids = new Set([alt.id, ...variants.map((v) => v.id)]);
        const chosenBy = (v: Element) => decisions.filter((d) => a.relations.some((r) => r.kind === "trace" && ((r.from === d.id && r.to === v.id) || (r.to === d.id && r.from === v.id))));
        const picked = variants.filter((v) => chosenBy(v).length > 0);
        const state = (v: Element) => (chosenBy(v).length ? "選定" : picked.length ? "否決" : "待決");
        const criteria = [...new Map(a.relations.filter((r) => LINKS.includes(r.kind)).flatMap((r) => [[r.from, r.to], [r.to, r.from]] as [string, string][]).filter(([x, y]) => ids.has(x) && REQ.test(byId.get(y)?.category ?? "")).map(([, y]) => [y, byId.get(y) as Element])).values()];
        const w = (r: Element) => numOf(r.attrs.weight) ?? 1;
        const total = (v: Element) => criteria.reduce((sum, r) => sum + w(r) * (numOf(v.attrs[key(r)]) ?? 0), 0);
        const totals = variants.map(total);
        // 調整後：有調整分數的格子用調整值，其餘用原分數
        const hasAdj = variants.some((v) => criteria.some((r) => v.attrs[adjKey(r)] !== undefined));
        const adjTotal = (v: Element) => criteria.reduce((sum, r) => sum + w(r) * (numOf(v.attrs[adjKey(r)]) ?? numOf(v.attrs[key(r)]) ?? 0), 0);
        const adjTotals = variants.map(adjTotal);
        const adjBest = Math.max(...adjTotals);
        const best = Math.max(...totals);
        const addable = allReqs.filter((r) => r.shortName && !criteria.some((c) => c.id === r.id));
        const draft = add[alt.id] ?? { req: "", weight: "" };
        return (
          <section key={alt.id} className="section">
            <h3 className="section-title">{label(alt)}</h3>
            {alt.doc && <p className="caption">{alt.doc}</p>}
            {alt.attrs.sensitivity && <p className="body trade-sens"><span className="label">權重敏感度</span>　{alt.attrs.sensitivity}</p>}
            {variants.length === 0 ? <p className="body">這個方案還沒有候選。到模型頁右欄「候選方案」新增。</p> : (
              <table className="n2">
                <thead>
                  <tr><th>準則（需求）</th><th>權重</th>{variants.map((v) => <th key={v.id}>{pick(label(v), v)}<div className={`tag ${state(v) === "選定" ? "done" : state(v) === "否決" ? "danger" : ""}`}>{state(v)}</div>{state(v) === "否決" && v.attrs.rejectWhy && <div className="caption trade-reject">否決原因：{v.attrs.rejectWhy}</div>}</th>)}<th /></tr>
                </thead>
                <tbody>
                  {criteria.map((r) => (
                    <tr key={r.id}>
                      <td>{pick(label(r), r)}{scaleText(r) && <div className="caption trade-scale">評分標準：{scaleText(r)}</div>}</td>
                      <td><Num value={r.attrs.weight ?? ""} label={`${label(r)} 的權重`} disabled={off} onSave={(v) => send("weight", { requirement: r.id, weight: v })} />{r.attrs.weight === undefined && <span className="faint">（1）</span>}</td>
                      {variants.map((v) => <td key={v.id}>
                        <Num value={v.attrs[key(r)] ?? ""} label={`${label(v)} 對 ${label(r)} 的分數`} disabled={off || !r.shortName} onSave={(x) => send("score", { variant: v.id, requirement: r.id, score: x })} />
                        <div className="trade-adj"><span className="caption">調整</span><Num value={v.attrs[adjKey(r)] ?? ""} label={`${label(v)} 對 ${label(r)} 的調整後分數`} disabled={off || !r.shortName} onSave={(x) => send("adjusted", { variant: v.id, requirement: r.id, score: x })} /></div>
                      </td>)}
                      <td><button type="button" className="tbtn" disabled={off} title="拿掉這條準則，連同權重與各候選的分數" onClick={() => send("criterion/delete", { alt: alt.id, requirement: r.id })}>刪準則</button></td>
                    </tr>
                  ))}
                  {criteria.length === 0 && <tr><td colSpan={3 + variants.length}><span className="faint">還沒有準則：在下方「加準則」選需求。</span></td></tr>}
                  {criteria.length > 0 && <tr><td><b>加權總分</b></td><td />{variants.map((v, i) => <td key={v.id} className={totals[i] === best && best > 0 && !hasAdj ? "sel" : ""}><b>{+totals[i].toFixed(3)}</b></td>)}<td /></tr>}
                  {criteria.length > 0 && hasAdj && <tr><td><b>調整後加權總分</b><div className="caption">有調整分數的格子用調整值</div></td><td />{variants.map((v, i) => <td key={v.id} className={adjTotals[i] === adjBest && adjBest > 0 ? "sel" : ""}><b>{+adjTotals[i].toFixed(3)}</b></td>)}<td /></tr>}
                  <tr><td>設計決策</td><td />{variants.map((v) => <td key={v.id} className={state(v) === "選定" ? "sel" : ""}>{chosenBy(v).map((d) => <div key={d.id}>{pick(label(d), d)}<div className="caption">{[d.attrs.decidedBy, d.attrs.decidedOn].filter(Boolean).join(" ")}　{d.attrs.rationale ?? ""}</div></div>)}{!chosenBy(v).length && <span className="faint">—</span>}</td>)}<td /></tr>
                </tbody>
              </table>
            )}
            {!readOnly && (
              <div className="row" style={{ marginTop: 8, alignItems: "center", gap: 8 }}>
                <select className="input" aria-label={`${alt.name} 加準則：需求`} value={draft.req} disabled={off} onChange={(e) => setAdd({ ...add, [alt.id]: { ...draft, req: e.target.value } })}>
                  <option value="">加準則：選一條需求…</option>
                  {addable.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}
                </select>
                <input className="input" aria-label={`${alt.name} 加準則：權重`} placeholder="權重（選填）" style={{ width: "7rem" }} value={draft.weight} disabled={off} onChange={(e) => setAdd({ ...add, [alt.id]: { ...draft, weight: e.target.value } })} />
                <button type="button" className="tbtn primary" disabled={off || !draft.req} onClick={async () => { await send("criterion", { alt: alt.id, requirement: draft.req, weight: draft.weight }); setAdd({ ...add, [alt.id]: { req: "", weight: "" } }); }}>加準則</button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
