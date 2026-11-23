import { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Element, View } from "./api.ts";
import type { Page } from "./workspace.ts";
import { listOf } from "./model.ts";

interface Task { id: string; title: string; start: string; end: string; done: boolean; re: string }
interface Pm { tasks: Task[]; costs: { planned: number; actual: number }[] }
interface Sim { result: { at?: string; outputs: { key: string; zh: string; value: number; unit: string }[] } | null }
interface Hist { commit: string; date: string; message: string }
interface Br { name: string; ahead: number }

export type Go = (page: Page, arg?: string) => void;
const today = () => new Date().toISOString().slice(0, 10);
const num = (e: Element, k: string) => Number(e.attrs[k]) || 0;

/** 5×5 風險矩陣。橫軸嚴重度、縱軸可能性；高風險區用警示色，並標出件數。 */
export function RiskGrid({ risks, residual = false, size = 30, onPick }: { risks: Element[]; residual?: boolean; size?: number; onPick?: (ids: string[]) => void }) {
  const s = (e: Element) => (residual ? num(e, "residualSeverity") || num(e, "severity") : num(e, "severity"));
  const l = (e: Element) => (residual ? num(e, "residualLikelihood") || num(e, "likelihood") : num(e, "likelihood"));
  const pad = 22, W = pad + size * 5 + 2, H = size * 5 + pad;
  const cells = [];
  for (let li = 5; li >= 1; li--) for (let si = 1; si <= 5; si++) {
    const here = risks.filter((r) => s(r) === si && l(r) === li);
    const score = si * li;
    const x = pad + (si - 1) * size, y = (5 - li) * size;
    const fill = here.length === 0 ? "none" : score >= 15 ? "var(--danger)" : score >= 8 ? "var(--warn)" : "var(--ink)";
    const ink = here.length === 0 ? "var(--ink-faint)" : score >= 15 ? "var(--on-danger)" : score >= 8 ? "var(--on-warn)" : "var(--on-ink)";
    cells.push(
      <g key={`${si}-${li}`} onClick={here.length && onPick ? () => onPick(here.map((r) => r.id)) : undefined} style={{ cursor: here.length && onPick ? "pointer" : "default" }}>
        <rect x={x + 0.5} y={y + 0.5} width={size - 1} height={size - 1} fill={fill} stroke={score >= 15 ? "var(--line-strong)" : "var(--line)"} />
        {here.length > 0 && <text x={x + size / 2} y={y + size / 2 + 4} textAnchor="middle" fontSize={size > 34 ? 13 : 11} fontWeight="700" fill={ink}>{here.length}</text>}
      </g>,
    );
  }
  const high = risks.filter((r) => s(r) * l(r) >= 15).length, mid = risks.filter((r) => s(r) * l(r) >= 8 && s(r) * l(r) < 15).length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: "100%", display: "block" }} role="img" aria-label={`風險矩陣${residual ? "（緩解後）" : ""}：共 ${risks.length} 項，高風險 ${high} 項，中風險 ${mid} 項。`}>
      {cells}
      {[1, 2, 3, 4, 5].map((i) => <text key={`x${i}`} x={pad + (i - 0.5) * size} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">{i}</text>)}
      {[1, 2, 3, 4, 5].map((i) => <text key={`y${i}`} x={pad - 8} y={(5 - i + 0.5) * size + 3} textAnchor="middle" fontSize="9" fill="var(--ink-faint)">{i}</text>)}
      <text x={pad + size * 2.5} y={H + 0} textAnchor="middle" fontSize="0" />
    </svg>
  );
}

/** 一條細線表示比例，數值寫在旁邊。 */
function Bar({ label, done, total, onClick }: { label: string; done: number; total: number; onClick?: () => void }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <button className="dash-bar" onClick={onClick} aria-label={`${label}：${done} / ${total}`}>
      <span className="body">{label}</span>
      <span className="meter"><span style={{ width: `${pct}%` }} /></span>
      <span className="data">{done} / {total}</span>
    </button>
  );
}

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} 分鐘前` : m < 1440 ? `${Math.round(m / 60)} 小時前` : `${Math.round(m / 1440)} 天前`;
};

/**
 * 專案首頁：由上到下是現在的節點、5 個指標、性能與風險與需求覆蓋、任務與最近變更、各次系統。
 * 每一格點了前往能處理它的頁。顏色只依計算結果；沒有資料的格子顯示空狀態，不畫沒有資料的圖。
 */
export function Dashboard({ view, go, id }: { view: View; go: Go; id: string }) {
  const [pm, setPm] = useState<Pm | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  const [hist, setHist] = useState<Hist[] | null>(null);
  const [branches, setBranches] = useState<Br[] | null>(null);
  const onBranch = !!view.branch;
  useEffect(() => {
    api<Pm>(`/projects/${id}/pm`).then(setPm).catch(() => setPm({ tasks: [], costs: [] }));
    api<Sim>(`/projects/${id}/sim`).then(setSim).catch(() => setSim({ result: null }));
    api<Hist[]>(`/projects/${id}/history`).then(setHist).catch(() => setHist(null));
    if (!onBranch) api<Br[]>(`/projects/${id}/branches`).then(setBranches).catch(() => setBranches(null));
  }, [id, onBranch]);

  const a = view.analysis;
  const approved = (g: string) => [...view.project.signoffs].reverse().find((s) => s.gate === g && !s.subsystem)?.decision === "APPROVE";
  const current = view.gates.find((g) => !approved(g.id)) ?? view.gates[view.gates.length - 1];
  const reqs = listOf(a.elements, "SystemRequirement", "SubsystemRequirement", "ComponentRequirement");
  const has = (e: Element, dir: "in" | "out", ...k: string[]) => a.relations.some((r) => (dir === "in" ? r.to : r.from) === e.id && k.includes(r.kind));
  const verified = reqs.filter((e) => has(e, "in", "verify")).length;
  const sourced = reqs.filter((e) => has(e, "out", "derive", "refine", "trace") || !!e.attrs.sourceDoc).length;
  const satisfied = reqs.filter((e) => has(e, "in", "satisfy")).length;
  const risks = listOf(a.elements, "Risk");
  const openHigh = risks.filter((r) => num(r, "severity") * num(r, "likelihood") >= 15 && !/結案|closed/i.test(r.attrs.status ?? "")).length;
  const pass = a.satisfaction.filter((s) => s.status === "holds").length;
  const fails = a.satisfaction.filter((s) => s.status === "fails").length;
  const tasks = pm?.tasks ?? [];
  const late = tasks.filter((t) => !t.done && t.end < today());
  const next = tasks.filter((t) => !t.done).sort((x, y) => x.end.localeCompare(y.end)).slice(0, 5);
  const planned = (pm?.costs ?? []).reduce((s, c) => s + c.planned, 0), actual = (pm?.costs ?? []).reduce((s, c) => s + c.actual, 0);
  const budgetPct = planned ? Math.round((actual / planned) * 100) : null;
  const errors = a.diagnostics.filter((d) => d.severity === "error").length;
  const outputs = sim?.result?.outputs ?? [];
  const days = current && view.milestones[current.id] ? Math.ceil((new Date(view.milestones[current.id]).getTime() - Date.now()) / 86400000) : null;
  const weekAgo = Date.now() - 7 * 86400000;
  const merged = (hist ?? []).filter((h) => h.message.startsWith("合併分支 ") && new Date(h.date).getTime() >= weekAgo).length;
  const subs = listOf(a.elements, "Subsystem");
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  return (
    <div className="dash">
      <section className="dash-hero" aria-label="現在的節點">
        <button className="dash-now" data-go="manage" onClick={() => go("manage", current?.id)}>
          <span className="label">現在的節點</span>
          <span className="heading">{current?.zh ?? "尚未設定節點"} <span className="label">{current?.en}</span></span>
          <span className="body muted">{days !== null ? (days >= 0 ? `還有 ${days} 天` : `已過 ${-days} 天`) : "未設日期"} · {current ? current.done : 0} / {current ? current.total : 0} 項完成</span>
        </button>
        <div className="dash-track" role="list" aria-label="審查節點進度">
          {view.gates.map((g) => {
            const ok = approved(g.id), cur = g.id === current?.id;
            return (
              <button key={g.id} role="listitem" data-go="manage" className={`dash-gate ${ok ? "ok" : ""} ${cur ? "cur" : ""}`} onClick={() => go("manage", g.id)} aria-label={`${g.zh}：${ok ? "已核可" : `${g.done} / ${g.total}`}`}>
                <span className="meter"><span style={{ width: `${ok ? 100 : g.total ? (g.done / g.total) * 100 : 0}%` }} /></span>
                <span className="label">{g.zh}</span>
                <span className="caption">{ok ? "已核可" : view.milestones[g.id]?.slice(5) ?? ""}</span>
              </button>
            );
          })}
        </div>
      </section>

      {errors > 0 && <button className="msg dash-alert" data-go="model" onClick={() => go("model", "source")}><span className="tag danger">ERR</span>模型有 {errors} 個錯誤，圖表暫停更新。點此修正。</button>}

      <div className="dash-kpis" aria-label="關鍵指標">
        <button className="kpi" data-go="tables:req" onClick={() => go("tables", "req")}>
          <span className="label">需求有驗證</span>
          <span className="readout">{reqs.length ? pct(verified, reqs.length) : "—"}{reqs.length > 0 && <small>%</small>}</span>
          <span className="meter"><span style={{ width: `${pct(verified, reqs.length)}%` }} /></span>
          <span className="caption">{verified} / {reqs.length}</span>
        </button>
        <button className="kpi" data-go="analysis" onClick={() => go("analysis")}>
          <span className="label">計算判定</span>
          <span className="readout">{pass}<small> PASS</small></span>
          <span className="caption">{fails > 0 ? <span className="tag danger">{fails} FAIL</span> : "0 FAIL"}</span>
        </button>
        <button className="kpi" data-go="tables:fmea" onClick={() => go("tables", "fmea")}>
          <span className="label">高風險未結</span>
          <span className="readout" style={openHigh > 0 ? { color: "var(--danger)" } : undefined}>{openHigh}</span>
          <span className="caption">共 {risks.length} 項風險</span>
        </button>
        <button className="kpi" data-go="manage" onClick={() => go("manage")}>
          <span className="label">逾期任務</span>
          <span className="readout" style={late.length > 0 ? { color: "var(--danger)" } : undefined}>{late.length}<small> / {tasks.length}</small></span>
          <span className="caption">{pm === null ? "載入中" : tasks.length === 0 ? "沒有任務" : `${tasks.filter((t) => t.done).length} 項已完成`}</span>
        </button>
        <button className="kpi" data-go="manage" onClick={() => go("manage")}>
          <span className="label">預算使用</span>
          <span className="readout" style={budgetPct !== null && budgetPct > 100 ? { color: "var(--danger)" } : undefined}>{budgetPct ?? "—"}{budgetPct !== null && <small>%</small>}</span>
          <span className="meter"><span style={{ width: `${Math.min(100, budgetPct ?? 0)}%` }} /></span>
          <span className="caption">{planned ? `${actual.toLocaleString("zh-TW")} / ${planned.toLocaleString("zh-TW")}` : "尚未設預算"}</span>
        </button>
      </div>

      <div className="dash-grid">
        {outputs.length > 0 && (
          <section className="section" data-cell="perf">
            <div className="section-head"><h2 className="section-title">性能對門檻</h2><button className="tbtn" data-go="analysis" onClick={() => go("analysis")}>分析</button></div>
            <div className="dash-stats">
              {outputs.slice(0, 6).map((o) => <div key={o.key}><span className="label">{o.zh}</span><span className="data">{Number.isInteger(o.value) ? o.value.toLocaleString("zh-TW") : o.value.toFixed(2)} {o.unit}</span></div>)}
            </div>
            <p className="caption" style={{ marginTop: 8 }}>門檻判定：{pass} PASS{fails > 0 ? <> · <span className="tag danger">{fails} FAIL</span></> : " · 0 FAIL"}</p>
          </section>
        )}

        <section className="section" data-cell="risk">
          <div className="section-head"><h2 className="section-title">S×O 風險熱圖</h2><span className="label">{risks.length}</span><button className="tbtn" data-go="tables:fmea" onClick={() => go("tables", "fmea")}>FMEA</button></div>
          {risks.length === 0 ? <p className="caption">還沒有風險項目。</p> : <RiskGrid risks={risks} onPick={() => go("tables", "fmea")} />}
        </section>

        <section className="section" data-cell="coverage">
          <div className="section-head"><h2 className="section-title">需求覆蓋</h2><span className="label">{reqs.length}</span><button className="tbtn" data-go="tables:req" onClick={() => go("tables", "req")}>矩陣</button></div>
          {reqs.length === 0 ? <p className="caption">還沒有需求。</p> : <>
            <Bar label="有來源" done={sourced} total={reqs.length} onClick={() => go("tables", "req")} />
            <Bar label="有滿足者" done={satisfied} total={reqs.length} onClick={() => go("tables", "req")} />
            <Bar label="有驗證" done={verified} total={reqs.length} onClick={() => go("tables", "req")} />
          </>}
        </section>

        <section className="section" data-cell="tasks">
          <div className="section-head"><h2 className="section-title">接下來的任務</h2><button className="tbtn" data-go="manage" onClick={() => go("manage")}>甘特圖</button></div>
          {next.length === 0 ? <p className="caption">沒有進行中的任務。</p> : next.map((t) => (
            <button key={t.id} className="dash-task" data-go="manage" onClick={() => go("manage")}>
              <span className="label">{t.end.slice(5)}</span><span className="body">{t.title}</span>{t.end < today() && <span className="tag danger">LATE</span>}
            </button>
          ))}
        </section>

        <section className="section" data-cell="changes">
          <div className="section-head"><h2 className="section-title">最近的變更</h2><button className="tbtn" data-go="versions" onClick={() => go("versions")}>版本</button></div>
          <div className="dash-stats">
            <button className="dash-stat" data-go="versions" onClick={() => go("versions")}><span className="label">{onBranch ? "尚未合併" : "送審中分支"}</span><span className="data">{onBranch ? view.branch!.ahead : branches ? branches.filter((b) => b.ahead > 0).length : "—"}</span></button>
            <button className="dash-stat" data-go="versions" onClick={() => go("versions")}><span className="label">本週合併</span><span className="data">{hist ? merged : "—"}</span></button>
            <button className="dash-stat" data-go="versions" onClick={() => go("versions")}><span className="label">最後更新</span><span className="data">{hist && hist[0] ? ago(hist[0].date) : "—"}</span></button>
          </div>
        </section>
      </div>

      <section className="section" data-cell="subsystems">
        <div className="section-head"><h2 className="section-title">各次系統狀態</h2><span className="label">{subs.length}</span><button className="tbtn" data-go="tables:cat:Subsystem" onClick={() => go("tables", "cat:Subsystem")}>清單</button></div>
        {subs.length === 0 ? <p className="caption">還沒有次系統。</p> : (
          <div className="dash-subs">
            {subs.map((s) => {
              const mine = a.satisfaction.filter((x) => x.subject === s.qualifiedName || x.subject === s.name || x.subject === s.id);
              const f = mine.filter((x) => x.status === "fails").length, h = mine.filter((x) => x.status === "holds").length;
              const parts = a.elements.filter((e) => e.category === "Component" && e.owner === s.id).length;
              return (
                <button key={s.id} className="dash-sub" data-go="tables:cat:Subsystem" onClick={() => go("tables", "cat:Subsystem")}>
                  <span className="heading">{s.name}</span>
                  <span className="caption">{parts} 個元件 · {h} PASS{f > 0 && <> · <span className="tag danger">{f} FAIL</span></>}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
