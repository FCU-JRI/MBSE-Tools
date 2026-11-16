// P3 的頁面「剖面與分配」：任務需求 → 任務剖面 → 功能 → 分配到各系統 → 系統需求，以及 MOE（三級成功判準）→ MOP → TPM 趨勢。
// 資料都從解析結果算（web/src/method/p3.ts）；修改標記走 POST /api/projects/:id/p3/meta，寫回模型。
import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import type { Element, View } from "../api.ts";
import type { MethodPageProps } from "./registry.ts";
import { allocationGaps, chainOf, LEVEL_ZH, measuresOf, MODE_KINDS, P3_META, profileGaps, tpmStatus, TPM_GATES } from "./p3.ts";
import type { Gap, TpmTrack } from "./p3.ts";

const fmt = (n: number | null, unit?: string | null) => (n === null ? "—" : `${n}${unit ? ` ${unit}` : ""}`);

export function P3Page({ view, user, onChanged, onOpen }: MethodPageProps) {
  const a = view.analysis;
  const chain = useMemo(() => chainOf(a), [a]);
  const measures = useMemo(() => measuresOf(a), [a]);
  const gaps = useMemo(() => ({ profile: profileGaps(a), allocation: allocationGaps(a) }), [a]);
  const byId = useMemo(() => new Map(a.elements.map((e) => [e.id, e])), [a]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = user.caps.edit && !view.project.readOnly;

  const name = (id: string): ReactNode => {
    const e = byId.get(id);
    if (!e) return id;
    return <button className="tbtn" style={{ textTransform: "none", letterSpacing: 0 }} onClick={() => onOpen(id)} title={e.qualifiedName}>{e.shortName ? `${e.shortName} ` : ""}{e.name}</button>;
  };
  const names = (ids: string[]) => (ids.length ? <span className="stack" style={{ gap: 0 }}>{ids.map((i) => <span key={i}>{name(i)}</span>)}</span> : <span className="faint">—</span>);

  const save = async (element: string, meta: string, values: Record<string, unknown>) => {
    setError("");
    try {
      onChanged(await api<View>(`/projects/${view.project.id}/p3/meta`, "POST", { element, meta, values }));
      setEditing(null);
    } catch (e) { setError((e as Error).message); }
  };

  const systemsOf = (f: string) => chain.functions.find((x) => x.id === f)?.systems ?? [];
  const mrOfPhases = (phases: string[]) => [...new Set(phases.flatMap((p) => chain.phases.find((x) => x.id === p)?.missionRequirements ?? []))];

  return (
    <div>
      {error && <p className="body" style={{ color: "var(--danger)" }}>{error}</p>}

      <section className="section">
        <div className="section-head"><h1 className="section-title">任務需求 → 任務剖面（圖 3）</h1><span className="label">{chain.missionRequirements.length} 條任務需求 · {chain.phases.length} 個階段</span></div>
        <p className="caption">任務需求只寫任務要達成什麼、不能違反什麼；剖面（階段、模式）是我們為了滿足它規劃的做法。在階段上用「追溯到」連到它滿足的任務需求。</p>
        <Gaps gaps={gaps.profile} onOpen={onOpen} />
        <table className="etable" style={{ minWidth: 0 }}>
          <thead><tr><th>任務需求</th><th>滿足它的任務階段</th><th>衍生的系統需求</th></tr></thead>
          <tbody>{chain.missionRequirements.map((m) => <tr key={m.id}><td>{name(m.id)}</td><td>{names(m.phases)}</td><td>{names(m.systemRequirements)}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="section">
        <div className="section-head"><h1 className="section-title">模式</h1><span className="label">{chain.modes.length}</span></div>
        <table className="etable" style={{ minWidth: 0 }}>
          <thead><tr><th>模式</th><th>種類</th></tr></thead>
          <tbody>{chain.modes.map((m) => (
            <tr key={m.id}><td>{name(m.id)}</td><td>
              {canEdit ? (
                <select className="input" value={m.kind ?? ""} onChange={(ev) => void save(m.id, "ModeKind", { kind: ev.target.value || null })}>
                  <option value="">{m.container ? "（總模式，可不標）" : "未標"}</option>
                  {MODE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.zh}（{k.id}）</option>)}
                </select>
              ) : (MODE_KINDS.find((k) => k.id === m.kind)?.zh ?? "未標")}
            </td></tr>))}
          </tbody>
        </table>
      </section>

      <section className="section">
        <div className="section-head"><h1 className="section-title">功能與分配（圖 4）</h1><span className="label">{chain.functions.length} 個功能 · {chain.systems.length} 個系統</span></div>
        <p className="caption">功能寫在任務階段裡面，或追溯到階段；以「分配給」連到系統。同一條任務需求可以拆到不同系統（例如遙測：火箭發送、地面站接收）。</p>
        <Gaps gaps={gaps.allocation} onOpen={onOpen} />
        <div className="etable-wrap"><table className="etable" style={{ minWidth: 0 }}>
          <thead><tr><th>任務需求</th><th>任務階段</th><th>功能</th>{chain.systems.map((s) => <th key={s.id}>{name(s.id)}</th>)}<th>系統需求</th></tr></thead>
          <tbody>{chain.functions.map((f) => (
            <tr key={f.id}>
              <td>{names(mrOfPhases(f.phases))}</td><td>{names(f.phases)}</td><td>{name(f.id)}</td>
              {chain.systems.map((s) => <td key={s.id} style={{ textAlign: "center" }}>{systemsOf(f.id).includes(s.id) ? "●" : ""}</td>)}
              <td>{names(chain.systemRequirements.filter((r) => r.functions.includes(f.id)).map((r) => r.id))}</td>
            </tr>))}
          </tbody>
        </table></div>
      </section>

      <section className="section">
        <div className="section-head"><h1 className="section-title">各系統的系統需求</h1></div>
        <table className="etable" style={{ minWidth: 0 }}>
          <thead><tr><th>系統</th><th>分配到的功能</th><th>系統需求</th></tr></thead>
          <tbody>{chain.systems.map((s) => <tr key={s.id}><td>{name(s.id)}</td><td>{names(s.functions)}</td><td>{names(s.requirements)}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="section">
        <div className="section-head"><h1 className="section-title">MOE 三級成功判準</h1><span className="label">{measures.moes.length}</span></div>
        <p className="caption">成功判準就是 MOE。達到「完全成功」的數字算完全成功，達到「部分成功」的數字算部分成功，都沒達到是不成功。</p>
        <table className="etable" style={{ minWidth: 0 }}>
          <thead><tr><th>MOE</th><th>完全成功</th><th>部分成功</th><th>方向</th><th>實際值</th><th>判定</th><th>MOP</th>{canEdit && <th />}</tr></thead>
          <tbody>{measures.moes.map((m) => {
            const l = m.levels;
            const key = `moe:${m.id}`;
            return (
              <Fragment key={m.id}>
                <tr>
                  <td>{name(m.id)}</td>
                  <td>{l ? `${l.better === "lower" ? "≤" : "≥"} ${fmt(l.full, l.unit)}` : "—"}</td>
                  <td>{l ? `${l.better === "lower" ? "≤" : "≥"} ${fmt(l.partial, l.unit)}` : "—"}</td>
                  <td>{l ? (l.better === "lower" ? "越小越好" : "越大越好") : "—"}</td>
                  <td>{l ? fmt(l.actual, l.unit) : "—"}</td>
                  <td>{m.level ? LEVEL_ZH[m.level] : <span className="faint">—</span>}</td>
                  <td>{names(m.mops)}</td>
                  {canEdit && <td><button className="tbtn" onClick={() => setEditing(editing === key ? null : key)}>{editing === key ? "取消" : "編輯"}</button></td>}
                </tr>
                {editing === key && <tr><td colSpan={8}><MetaForm el={byId.get(m.id)!} meta="SuccessLevels" onSave={(v) => void save(m.id, "SuccessLevels", v)} /></td></tr>}
              </Fragment>
            );
          })}</tbody>
        </table>
      </section>

      <section className="section">
        <div className="section-head"><h1 className="section-title">MOP 與 TPM 趨勢</h1><span className="label">{measures.mops.length} 個 MOP · {measures.tpms.length} 個 TPM</span></div>
        <p className="caption">MOP 由 MOE 推出（衍生自或細化 MOE）；TPM 是從 MOP 中挑出、每個審查節點都要記目前估計值的那幾個（在 MOP 上標 @TPMTrack）。</p>
        <table className="etable" style={{ minWidth: 0 }}>
          <thead><tr><th>MOP</th><th>支撐的 MOE</th><th>TPM</th></tr></thead>
          <tbody>{measures.mops.map((m) => (
            <tr key={m.id}><td>{name(m.id)}</td><td>{names(m.moes)}</td><td>
              {m.tpm ? "追蹤中" : canEdit ? <button className="tbtn" onClick={() => setEditing(`tpm:${m.id}`)}>挑為 TPM</button> : "—"}
            </td></tr>))}
          </tbody>
        </table>
        {editing?.startsWith("tpm:") && !measures.tpms.some((t) => `tpm:${t.id}` === editing) && (
          <MetaForm el={byId.get(editing.slice(4))!} meta="TPMTrack" onSave={(v) => void save(editing.slice(4), "TPMTrack", v)} />
        )}
        {measures.tpms.map((t) => {
          const el = byId.get(t.id);
          if (!el) return null;
          const key = `tpm:${t.id}`;
          return (
            <div key={t.id} style={{ marginTop: 16 }}>
              <div className="row" style={{ alignItems: "center" }}>
                <span className="heading">{name(t.id)}</span>
                <span className="caption">MOP：{t.mop ? byId.get(t.mop)?.name : "（沒有接到 MOP）"}</span>
                <span className="caption">目前 {t.latest ? `${fmt(t.latest.value, t.track.unit)}（${TPM_GATES.find((g) => g.id === t.latest!.gate)?.zh}）` : "—"}</span>
                <span className="tag" style={t.status === "out" ? { color: "var(--danger)" } : undefined}>{t.status === "within" ? "在範圍內" : t.status === "out" ? "超出範圍" : "沒有範圍"}</span>
                {canEdit && <button className="tbtn" onClick={() => setEditing(editing === key ? null : key)}>{editing === key ? "取消" : "記錄估計值"}</button>}
              </div>
              <Trend track={t.track} />
              {editing === key && <MetaForm el={el} meta="TPMTrack" onSave={(v) => void save(t.id, "TPMTrack", v)} />}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Gaps({ gaps, onOpen }: { gaps: Gap[]; onOpen: (id: string) => void }) {
  if (!gaps.length) return <p className="caption">這一步沒有缺的項目。</p>;
  return (
    <ul className="checks" style={{ marginBottom: 12 }}>
      {gaps.map((g, i) => <li key={i}><span className="label" style={{ color: "var(--warn)" }}>還缺</span><span className="what">{g.id ? <button className="tbtn" style={{ textTransform: "none", letterSpacing: 0 }} onClick={() => onOpen(g.id!)}>{g.text}</button> : g.text}</span></li>)}
    </ul>
  );
}

/** 某個 P3 標記的所有欄位；空白代表清除 */
function MetaForm({ el, meta, onSave }: { el: Element; meta: string; onSave: (values: Record<string, string | null>) => void }) {
  const def = P3_META[meta];
  const has = el.tags.includes(meta);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(def.fields.map((f) => [f.name, has ? (el.attrs[f.name] ?? "").replace(/^"(.*)"$/, "$1") : ""])));
  return (
    <form className="row" style={{ marginTop: 8 }} onSubmit={(ev) => { ev.preventDefault(); onSave(Object.fromEntries(def.fields.map((f) => [f.name, vals[f.name]?.trim() ? vals[f.name].trim() : null]))); }}>
      {def.fields.map((f) => (
        <label key={f.name} className="field" style={{ flex: "0 0 9rem" }}><span className="label">{f.zh}</span>
          {f.name === "better"
            ? <select className="input" value={vals.better} onChange={(ev) => setVals({ ...vals, better: ev.target.value })}><option value="">越大越好（預設）</option><option value="higher">越大越好</option><option value="lower">越小越好</option></select>
            : <input className="input" inputMode={f.type === "real" ? "decimal" : undefined} value={vals[f.name]} onChange={(ev) => setVals({ ...vals, [f.name]: ev.target.value })} />}
        </label>))}
      <button className="btn" type="submit">儲存</button>
    </form>
  );
}

/** TPM 隨審查節點變化的趨勢：橫軸是節點，灰帶是允許範圍，虛線是預期值 */
export function Trend({ track }: { track: TpmTrack }) {
  const W = 480, H = 160, L = 56, R = 16, T = 12, B = 28;
  const ys = [...track.points.map((p) => p.value), track.expected, track.lower, track.upper].filter((v): v is number => v !== null);
  if (!ys.length) return <p className="caption">還沒有任何節點的估計值。</p>;
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const x = (i: number) => L + ((W - L - R) * i) / (TPM_GATES.length - 1);
  const y = (v: number) => T + ((H - T - B) * (hi - v)) / (hi - lo);
  const gi = (g: string) => TPM_GATES.findIndex((x) => x.id === g);
  const pts = track.points.map((p) => ({ ...p, cx: x(gi(p.gate)), cy: y(p.value), st: tpmStatus(track, p.value) }));
  const bandTop = y(track.upper ?? hi), bandBottom = y(track.lower ?? lo);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: W, display: "block" }} role="img" aria-label="TPM 趨勢">
      {(track.lower !== null || track.upper !== null) && <rect x={L} y={bandTop} width={W - L - R} height={Math.max(0, bandBottom - bandTop)} fill="var(--line)" opacity={0.5} />}
      <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--line-strong)" strokeWidth={1} />
      {[hi, (hi + lo) / 2, lo].map((v, i) => <text key={i} x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--ink-faint)">{Number(v.toPrecision(4))}</text>)}
      {TPM_GATES.map((g, i) => <text key={g.id} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-faint)">{g.zh}</text>)}
      {track.expected !== null && <line x1={L} y1={y(track.expected)} x2={W - R} y2={y(track.expected)} stroke="var(--ink-muted)" strokeDasharray="4 3" strokeWidth={1} />}
      {pts.length > 1 && <polyline points={pts.map((p) => `${p.cx},${p.cy}`).join(" ")} fill="none" stroke="var(--ink)" strokeWidth={2} />}
      {pts.map((p) => (
        <g key={p.gate}>
          <circle cx={p.cx} cy={p.cy} r={4} fill={p.st === "out" ? "var(--danger)" : "var(--ink)"} />
          <text x={p.cx} y={p.cy - 8} textAnchor="middle" fontSize={10} fill="var(--ink)">{p.value}</text>
        </g>))}
      {track.unit && <text x={4} y={T + 4} fontSize={10} fill="var(--ink-faint)">{track.unit}</text>}
    </svg>
  );
}
