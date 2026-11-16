// P6 圖 9 方案比較：決策矩陣（準則 × 候選方案）、加權結果、選定與否決。計算在 trade.ts，和伺服器共用。
import { useMemo, useState } from "react";
import { api } from "../api.ts";
import type { View } from "../api.ts";
import type { MethodPageProps } from "./registry.ts";
import { evaluateTrades, listCriteria, TRACE_TARGETS, DESIGN_TARGETS } from "./trade.ts";
import type { TradeMatrix } from "./trade.ts";

const KIND_ZH = { must: "必須", want: "加分", unknown: "未填" } as const;
const STATUS_ZH = { candidate: "評估中", selected: "選定", rejected: "否決", unknown: "未填" } as const;
const fmt = (x: number | null) => (x === null ? "—" : String(Number(x.toFixed(3))));

export function TradeStudiesPage({ view, user, onChanged, onOpen }: MethodPageProps) {
  const ro = !user.caps.edit;
  const matrices = useMemo(() => (view.analysis.ok ? evaluateTrades(view.analysis) : []), [view.analysis]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const id = view.project.id;
  const run = async (fn: () => Promise<View>, done: string) => {
    setBusy(true); setMsg(null);
    try { onChanged(await fn()); setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const add = (body: Record<string, unknown>) => api<View>(`/projects/${id}/elements`, "POST", body);
  const trace = (from: string, to: string) => api<View>(`/projects/${id}/relations`, "POST", { kind: "trace", from, to });

  const [newM, setNewM] = useState({ name: "", question: "" });
  const [newC, setNewC] = useState({ name: "", kind: "want", weight: "1", aspect: "performance", measure: "", traceTo: "" });
  const allCriteria = useMemo(() => (view.analysis.ok ? listCriteria(view.analysis) : []), [view.analysis]);
  const traceTargets = view.analysis.elements.filter((e) => TRACE_TARGETS.has(e.category ?? ""));

  if (!view.analysis.ok) return <div className="section"><p className="msg">模型目前有錯誤，請先到「原始碼」分頁修正。</p></div>;
  return (
    <div className="section">
      <div className="section-head"><h2 className="section-title">方案比較（圖 9）</h2></div>
      <p className="caption">每次要設計的地方都跑一次：系統層一次，每個次系統各一次。準則與權重由專案統一定義、追溯到需求／MOE／MOP；必須準則不通過的方案直接剔除，加分準則以「權重 × 分數（1 到 5）」加總。選定方案成為設計，否決方案留下理由。</p>
      {msg && <p className={`msg${msg.ok ? "" : " tag danger"}`} role="status">{msg.text}</p>}

      <h3 className="label">專案統一的評比準則（{allCriteria.length}）</h3>
      <table className="data">
        <thead><tr><th>編號</th><th>準則</th><th>種類</th><th>權重</th><th>面向</th><th>怎麼量</th><th>追溯到</th></tr></thead>
        <tbody>
          {allCriteria.map((c) => (
            <tr key={c.id}>
              <td className="id">{c.shortName}</td><td><button className="btn" onClick={() => onOpen(c.id)}>{c.name}</button></td>
              <td>{KIND_ZH[c.kind]}</td><td>{c.kind === "want" ? `${fmt(c.weight)}（${c.share === null ? "—" : `${Math.round(c.share * 100)}%`}）` : "—"}</td>
              <td>{c.aspect === "risk" ? <span className="tag warn">風險</span> : c.aspect || "—"}</td><td>{c.measure || "—"}</td>
              <td>{c.traces.length ? c.traces.map((t) => t.name).join("、") : <span className="tag danger">未追溯</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!ro && (
        <div className="row" style={{ flexWrap: "wrap", gap: 8, margin: "8px 0 16px" }}>
          <input className="input" placeholder="準則名稱" value={newC.name} onChange={(e) => setNewC({ ...newC, name: e.target.value })} />
          <select className="input" value={newC.kind} onChange={(e) => setNewC({ ...newC, kind: e.target.value })}><option value="must">必須 must</option><option value="want">加分 want</option></select>
          {newC.kind === "want" && <input className="input" style={{ width: 70 }} placeholder="權重" value={newC.weight} onChange={(e) => setNewC({ ...newC, weight: e.target.value })} />}
          <select className="input" value={newC.aspect} onChange={(e) => setNewC({ ...newC, aspect: e.target.value })}>
            {["performance", "cost", "schedule", "safety", "risk", "mission"].map((x) => <option key={x}>{x}</option>)}
          </select>
          <input className="input" placeholder="怎麼量（單位、門檻）" value={newC.measure} onChange={(e) => setNewC({ ...newC, measure: e.target.value })} />
          <select className="input" value={newC.traceTo} onChange={(e) => setNewC({ ...newC, traceTo: e.target.value })}>
            <option value="">追溯到哪條需求／MOE／MOP…</option>
            {traceTargets.map((t) => <option key={t.id} value={t.id}>{t.shortName} {t.name}</option>)}
          </select>
          <button className="tbtn primary" disabled={busy || !newC.name.trim() || !newC.traceTo} onClick={() => run(async () => {
            const v = await add({ category: "Criterion", name: newC.name, attrs: { kind: newC.kind, weight: newC.kind === "want" ? newC.weight : "", aspect: newC.aspect, measure: newC.measure } });
            const c = v.analysis.elements.find((e) => e.category === "Criterion" && e.name === newC.name.trim());
            return c ? trace(c.id, newC.traceTo) : v;
          }, "已新增準則。")}>新增準則</button>
        </div>
      )}

      {matrices.map((m) => <Matrix key={m.id} m={m} ro={ro} busy={busy} run={run} id={id} view={view} onOpen={onOpen} add={add} trace={trace} />)}

      {!ro && (
        <div className="row" style={{ gap: 8, marginTop: 16 }}>
          <input className="input" placeholder="新的方案比較，例如「推進方案比較」" value={newM.name} onChange={(e) => setNewM({ ...newM, name: e.target.value })} />
          <input className="input" placeholder="要決定什麼" value={newM.question} onChange={(e) => setNewM({ ...newM, question: e.target.value })} />
          <button className="tbtn primary" disabled={busy || !newM.name.trim()} onClick={() => run(() => add({ category: "DecisionMatrix", name: newM.name, attrs: { question: newM.question } }), "已新增方案比較。")}>新增方案比較</button>
        </div>
      )}
    </div>
  );
}

function Matrix({ m, ro, busy, run, id, view, onOpen, add, trace }: {
  m: TradeMatrix; ro: boolean; busy: boolean; id: string; view: View; onOpen: (id: string) => void;
  run: (fn: () => Promise<View>, done: string) => void; add: (b: Record<string, unknown>) => Promise<View>; trace: (f: string, t: string) => Promise<View>;
}) {
  const [altName, setAltName] = useState("");
  const [pick, setPick] = useState(m.selected ?? m.best ?? "");
  const [why, setWhy] = useState<Record<string, string>>(() => Object.fromEntries(m.alternatives.map((a) => [a.id, a.rationale])));
  const [design, setDesign] = useState("");
  const designs = view.analysis.elements.filter((e) => DESIGN_TARGETS.has(e.category ?? "") && !e.shared);
  const score = (alternative: string, criterion: string, value: string) => {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return;
    run(() => api<View>(`/projects/${id}/trades/score`, "POST", { alternative, criterion, score: value.trim() }), "已更新分數。");
  };
  const selected = m.alternatives.find((a) => a.id === m.selected);
  return (
    <div className="section" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <div className="section-head"><h3 className="section-title"><span className="id">{m.shortName}</span> {m.name}</h3></div>
      {m.question && <p className="body">要決定：{m.question}</p>}
      <table className="data">
        <thead>
          <tr><th>準則</th><th>種類</th><th>權重</th>{m.alternatives.map((a) => <th key={a.id}><button className="btn" onClick={() => onOpen(a.id)}>{a.name}</button><br /><span className={`tag${a.status === "selected" ? "" : a.status === "rejected" ? " danger" : ""}`}>{STATUS_ZH[a.status]}</span></th>)}</tr>
        </thead>
        <tbody>
          {m.criteria.map((c) => (
            <tr key={c.id}>
              <td>{c.shortName} {c.name}{c.aspect === "risk" && <> <span className="tag warn">風險</span></>}</td>
              <td>{KIND_ZH[c.kind]}</td><td>{c.kind === "want" ? fmt(c.weight) : "—"}</td>
              {m.alternatives.map((a) => {
                const s = a.scores[c.id];
                const failed = a.failedMust.includes(c.id);
                return (
                  <td key={a.id} className={failed ? "tag danger" : a.weaknesses.includes(c.id) ? "tag warn" : ""} title={s?.basis || undefined}>
                    {ro ? (s?.score ?? "—") : (
                      <input className="input" style={{ width: 56 }} aria-label={`${a.name} 在 ${c.name} 的分數`} defaultValue={s?.score ?? ""} placeholder={c.kind === "must" ? "1/0" : "1–5"}
                        onBlur={(e) => { if (e.target.value.trim() !== String(s?.score ?? "")) score(a.id, c.id, e.target.value); }} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr><td colSpan={3}><b>必須準則</b></td>{m.alternatives.map((a) => <td key={a.id}>{a.failedMust.length ? <span className="tag danger">剔除</span> : a.feasible ? "通過" : "未完成"}</td>)}</tr>
          <tr><td colSpan={3}><b>加權總分</b>（Σ 權重 × 分數）</td>{m.alternatives.map((a) => <td key={a.id}>{fmt(a.total)}</td>)}</tr>
          <tr><td colSpan={3}><b>正規化分數</b>（÷ Σ 權重，1 到 5）</td>{m.alternatives.map((a) => <td key={a.id}>{fmt(a.normalized)}{a.id === m.best && " ★"}</td>)}</tr>
          <tr><td colSpan={3}><b>名次</b></td>{m.alternatives.map((a) => <td key={a.id}>{a.rank ?? "—"}</td>)}</tr>
        </tbody>
      </table>
      {m.alternatives.some((a) => a.status === "rejected") && (
        <ul className="body">{m.alternatives.filter((a) => a.status === "rejected").map((a) => <li key={a.id}>否決 {a.name}：{a.rationale || <span className="tag danger">沒有理由</span>}</li>)}</ul>
      )}
      {selected && (
        <p className="body">選定 {selected.name}，成為設計：{selected.design.length ? selected.design.map((d) => d.name).join("、") : <span className="tag danger">還沒有連到設計元素</span>}
          {selected.weaknesses.length > 0 && <>；弱點（≤ 2 分，應登記為風險）：{selected.weaknesses.map((w) => m.criteria.find((c) => c.id === w)?.name).join("、")}</>}</p>
      )}
      {m.missing.length > 0 && (
        <div className="body"><b>還缺什麼</b><ul>{m.missing.map((x, i) => <li key={i}>{x.id ? <button className="btn" onClick={() => onOpen(x.id as string)}>{x.text}</button> : x.text}</li>)}</ul></div>
      )}
      {!ro && (
        <div className="field">
          <div className="row" style={{ gap: 8 }}>
            <input className="input" placeholder="新的候選方案" value={altName} onChange={(e) => setAltName(e.target.value)} />
            <button className="tbtn" disabled={busy || !altName.trim()} onClick={() => run(() => add({ category: "Alternative", name: altName, parentId: m.id, attrs: { status: "candidate" } }), "已新增候選方案。")}>新增候選方案</button>
          </div>
          {m.alternatives.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="label">選定</span>
                <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>{m.alternatives.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </div>
              {m.alternatives.map((a) => (
                <div className="row" key={a.id} style={{ gap: 8 }}>
                  <span className="label" style={{ minWidth: 120 }}>{a.id === pick ? "選定理由" : "否決理由"}：{a.name}</span>
                  <input className="input" style={{ flex: 1 }} value={why[a.id] ?? ""} onChange={(e) => setWhy({ ...why, [a.id]: e.target.value })} />
                </div>
              ))}
              <button className="tbtn primary" disabled={busy || !pick} onClick={() => run(() => api<View>(`/projects/${id}/trades/decide`, "POST", { matrix: m.id, selected: pick, rationale: why }), "已記錄決定。")}>記錄決定</button>
            </div>
          )}
          {selected && (
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <select className="input" value={design} onChange={(e) => setDesign(e.target.value)}>
                <option value="">把選定方案連到設計元素…</option>
                {designs.map((d) => <option key={d.id} value={d.id}>{d.shortName} {d.name}</option>)}
              </select>
              <button className="tbtn" disabled={busy || !design} onClick={() => run(() => trace(design, selected.id), "已連到設計。")}>連結</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
