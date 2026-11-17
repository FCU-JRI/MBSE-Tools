import { useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Element, View } from "./api.ts";
import { listOf } from "./model.ts";

interface Task { id: string; title: string; start: string; end: string; done: boolean; re: string }
interface Pm { tasks: Task[]; costs: { planned: number; actual: number }[] }
interface Sim { result: { outputs: { key: string; zh: string; value: number; unit: string }[] } | null }

export type Go = (mode: string, arg?: string) => void;
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

/** 專案首頁：像中控台一樣，用圖和數字呈現狀態，文字盡量少。每一區點了就前往對應的頁面。 */
export function Dashboard({ view, go }: { view: View; go: Go }) {
  const id = view.project.id;
  const [pm, setPm] = useState<Pm | null>(null);
  const [sim, setSim] = useState<Sim | null>(null);
  useEffect(() => {
    api<Pm>(`/projects/${id}/pm`).then(setPm).catch(() => setPm({ tasks: [], costs: [] }));
    api<Sim>(`/projects/${id}/sim`).then(setSim).catch(() => setSim({ result: null }));
  }, [id]);

  const a = view.analysis;
  const approved = (g: string) => [...view.project.signoffs].reverse().find((s) => s.gate === g && !s.subsystem)?.decision === "APPROVE";
  const current = view.gates.find((g) => !approved(g.id)) ?? view.gates[view.gates.length - 1];
  const reqs = listOf(a.elements, "SystemRequirement", "SubsystemRequirement", "ComponentRequirement");
  const has = (e: Element, dir: "in" | "out", ...k: string[]) => a.relations.some((r) => (dir === "in" ? r.to : r.from) === e.id && k.includes(r.kind));
  const risks = listOf(a.elements, "Risk");
  const openHigh = risks.filter((r) => num(r, "severity") * num(r, "likelihood") >= 15 && !/結案|closed/i.test(r.attrs.status ?? "")).length;
  const fails = a.satisfaction.filter((s) => s.status === "fails").length;
  const tasks = pm?.tasks ?? [];
  const late = tasks.filter((t) => !t.done && t.end < today());
  const next = tasks.filter((t) => !t.done).sort((x, y) => x.end.localeCompare(y.end)).slice(0, 5);
  const planned = (pm?.costs ?? []).reduce((s, c) => s + c.planned, 0), actual = (pm?.costs ?? []).reduce((s, c) => s + c.actual, 0);
  const apogee = sim?.result?.outputs.find((o) => o.key === "apogee");
  const margin = sim?.result?.outputs.find((o) => o.key === "staticMargin");
  const errors = a.diagnostics.filter((d) => d.severity === "error").length;

  return (
    <div className="dash">
      <section className="dash-hero">
        <button className="dash-now" onClick={() => go("gates", current?.id)}>
          <span className="label">現在的節點</span>
          <span className="readout">{current ? current.done : 0}<small> / {current ? current.total : 0}</small></span>
          <span className="heading">{current?.zh ?? "尚未設定節點"} <span className="label">{current?.en}</span></span>
        </button>
        <div className="dash-track" role="list" aria-label="審查節點進度">
          {view.gates.map((g) => {
            const ok = approved(g.id), cur = g.id === current?.id;
            return (
              <button key={g.id} role="listitem" className={`dash-gate ${ok ? "ok" : ""} ${cur ? "cur" : ""}`} onClick={() => go("gates", g.id)} aria-label={`${g.zh}：${ok ? "已核可" : `${g.done} / ${g.total}`}`}>
                <span className="meter"><span style={{ width: `${ok ? 100 : g.total ? (g.done / g.total) * 100 : 0}%` }} /></span>
                <span className="label">{g.en.replace("Project ", "").replace(" Review", "").toUpperCase()}</span>
                <span className="caption">{ok ? "DONE" : view.milestones[g.id]?.slice(5) ?? ""}</span>
              </button>
            );
          })}
        </div>
      </section>

      {errors > 0 && <button className="msg dash-alert" onClick={() => go("source")}><span className="tag danger">ERR</span>模型有 {errors} 個錯誤，圖表暫停更新。點此修正。</button>}

      <div className="dash-grid">
        <section className="section">
          <div className="section-head"><h2 className="section-title">需求</h2><span className="label">{reqs.length}</span><button className="tbtn" onClick={() => go("deliver", "req")}>矩陣</button></div>
          <Bar label="有來源" done={reqs.filter((e) => has(e, "out", "derive", "refine", "trace") || !!e.attrs.sourceDoc).length} total={reqs.length} onClick={() => go("deliver", "req")} />
          <Bar label="有滿足者" done={reqs.filter((e) => has(e, "in", "satisfy")).length} total={reqs.length} onClick={() => go("deliver", "req")} />
          <Bar label="有驗證" done={reqs.filter((e) => has(e, "in", "verify")).length} total={reqs.length} onClick={() => go("deliver", "req")} />
          <div className="dash-stats">
            <div><span className="label">計算判定</span><span className="data">{a.satisfaction.filter((s) => s.status === "holds").length} PASS {fails > 0 && <span className="tag danger">{fails} FAIL</span>}</span></div>
            <div><span className="label">模型元素</span><span className="data">{a.elements.filter((e) => e.category).length}</span></div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2 className="section-title">風險</h2><span className="label">{risks.length}</span><button className="tbtn" onClick={() => go("deliver", "fmea")}>FMEA</button></div>
          <div className="dash-risk">
            <RiskGrid risks={risks} onPick={() => go("deliver", "fmea")} />
            <div className="dash-stats col">
              <div><span className="label">高風險未結</span><span className="data">{openHigh > 0 ? <span className="tag danger">{openHigh}</span> : "0"}</span></div>
              <div><span className="label">已有緩解</span><span className="data">{risks.filter((r) => (r.attrs.mitigation ?? "").trim()).length} / {risks.length}</span></div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2 className="section-title">時程</h2><span className="label">{tasks.filter((t) => t.done).length} / {tasks.length}</span><button className="tbtn" onClick={() => go("plan")}>甘特圖</button></div>
          {late.length > 0 && <p className="msg"><span className="tag danger">LATE</span>{late.length} 項逾期</p>}
          {next.length === 0 ? <p className="caption">沒有進行中的任務。</p> : next.map((t) => (
            <button key={t.id} className="dash-task" onClick={() => go("plan")}>
              <span className="label">{t.end.slice(5)}</span><span className="body">{t.title}</span>{t.end < today() && <span className="tag danger">LATE</span>}
            </button>
          ))}
        </section>

        <section className="section">
          <div className="section-head"><h2 className="section-title">成本與性能</h2><button className="tbtn" onClick={() => go("sim")}>模擬</button></div>
          <Bar label="預算使用" done={actual} total={planned} onClick={() => go("plan")} />
          <div className="dash-stats">
            <div><span className="label">遠地點</span><span className="data">{apogee ? `${Math.round(apogee.value).toLocaleString("zh-TW")} m` : "—"}</span></div>
            <div><span className="label">穩定裕度</span><span className="data">{margin ? `${margin.value.toFixed(2)} cal` : "—"}</span></div>
          </div>
        </section>
      </div>
    </div>
  );
}
