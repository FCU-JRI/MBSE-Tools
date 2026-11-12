import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Doc, Element, Me, Meta, View } from "./api.ts";
import { label, listOf, wrap } from "./model.ts";
import { methodZh } from "./Inspector.tsx";
import { RiskGrid } from "./Dashboard.tsx";

export type DeliverTab = "req" | "fmea" | "path" | "docs";
const TABS: [DeliverTab, string][] = [["req", "需求矩陣"], ["fmea", "FMEA 風險矩陣"], ["path", "開發路徑"], ["docs", "來源文件"]];
const REQ = ["SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP"];
const when = (s: string) => new Date(s).toLocaleDateString("zh-TW");

interface Props { view: View; meta: Meta; user: Me; tab: DeliverTab; setTab: (t: DeliverTab) => void; selectedId: string | null; onSelect: (id: string) => void; onChanged: (v: View) => void }

/** 產出物：每個專案都有、可瀏覽與匯出的三份文件，加上來源文件清單。 */
export function Deliverables(p: Props) {
  return (
    <>
      <div className="deliver-bar">
        <nav className="seg" role="tablist">{TABS.map(([t, zh]) => <button key={t} role="tab" aria-selected={p.tab === t} onClick={() => p.setTab(t)}>{zh}</button>)}</nav>
        <span style={{ flex: 1 }} />
        <a className={`tbtn ${p.view.analysis.ok ? "" : "disabled"}`} href={p.view.analysis.ok ? `/api/projects/${p.view.project.id}/export.xlsx` : undefined}>匯出 Excel</a>
        <button className="tbtn" onClick={() => window.print()}>列印／PDF</button>
      </div>
      <div className="center-scroll printable">
        <p className="print-title">{p.view.project.name}　{TABS.find(([t]) => t === p.tab)?.[1]}</p>
        {p.tab === "req" && <ReqMatrix {...p} />}
        {p.tab === "fmea" && <Fmea {...p} />}
        {p.tab === "path" && <Path {...p} />}
        {p.tab === "docs" && <Docs {...p} />}
      </div>
    </>
  );
}

function SourceCell({ e, docs }: { e: Element; docs: Doc[] }) {
  if (!e.attrs.sourceDoc) return <span className="faint">—</span>;
  const d = docs.find((x) => x.id === e.attrs.sourceDoc);
  const text = `${e.attrs.sourceDoc}${e.attrs.sourceRef ? ` §${e.attrs.sourceRef}` : ""}`;
  return d?.url ? <a href={d.url} target="_blank" rel="noreferrer noopener" title={d.title} onClick={(ev) => ev.stopPropagation()}>{text}</a> : <span title={d?.title}>{text}</span>;
}

function ReqMatrix({ view, meta, selectedId, onSelect }: Props) {
  const [level, setLevel] = useState("");
  const [gap, setGap] = useState(false);
  const a = view.analysis;
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const sat = new Map(a.satisfaction.map((s) => [s.requirement, s.status]));
  const outs = (e: Element, ...k: string[]) => a.relations.filter((r) => r.from === e.id && k.includes(r.kind)).map((r) => byId.get(r.to)).filter((x): x is Element => !!x);
  const ins = (e: Element, ...k: string[]) => a.relations.filter((r) => r.to === e.id && k.includes(r.kind)).map((r) => byId.get(r.from)).filter((x): x is Element => !!x);
  const all = listOf(a.elements, ...REQ);
  const missing = (e: Element) => (outs(e, "derive", "refine", "trace").length === 0 && !e.attrs.sourceDoc) || ins(e, "satisfy").length === 0 || ins(e, "verify").length === 0;
  const rows = all.filter((e) => (!level || e.category === level) && (!gap || missing(e)));
  const miss = <span className="tag danger">MISS</span>;
  const list = (xs: Element[]) => (xs.length ? xs.map((x) => <div key={x.id}>{label(x)}</div>) : miss);
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">需求矩陣</h1><span className="label">{rows.length} / {all.length} · 缺項 {all.filter(missing).length}</span></div>
      <div className="row no-print">
        <label className="field" style={{ flex: "0 0 12rem" }}><span className="label">層級</span>
          <select className="input" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">全部</option>{REQ.map((c) => <option key={c} value={c}>{meta.categories.find((x) => x.id === c)?.zh}</option>)}</select></label>
        <label className="check" style={{ marginBottom: 12 }}><input type="checkbox" checked={gap} onChange={(e) => setGap(e.target.checked)} /><span className="caption">只看有缺項的</span></label>
      </div>
      {rows.length === 0 ? <p className="body">{all.length ? "沒有符合條件的需求。" : "還沒有需求。到「圖」或「表」新增。"}</p> : (
        <table>
          <thead><tr><th>編號</th><th>層級</th><th>需求</th><th>出處</th><th>上層</th><th>滿足者</th><th>驗證</th><th>判定</th></tr></thead>
          <tbody>{rows.map((e) => {
            const ev = ins(e, "verify"), up = outs(e, "derive", "refine", "trace"), s = sat.get(e.qualifiedName);
            return (
              <tr key={e.id} className="rowbtn" aria-selected={e.id === selectedId} onClick={() => onSelect(e.id)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onSelect(e.id); }}>
                <td className="id">{e.shortName ?? "—"}</td>
                <td className="id">{meta.categories.find((c) => c.id === e.category)?.zh.replace("層需求", "")}</td>
                <td><div>{e.name}</div><div className="caption">{e.doc}</div></td>
                <td className="id"><SourceCell e={e} docs={view.docs} /></td>
                <td>{up.length ? up.map((x) => <div key={x.id}>{label(x)}</div>) : e.attrs.sourceDoc ? <span className="faint">見出處</span> : miss}</td>
                <td>{list(ins(e, "satisfy"))}</td>
                <td>{ev.length ? ev.map((x) => <div key={x.id}>{label(x)}{x.attrs.kind && <span className="faint">　{methodZh(x.attrs.kind)}</span>}</div>) : miss}</td>
                <td>{s === "holds" ? <span className="tag done">PASS</span> : s === "fails" ? <span className="tag danger">FAIL</span> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </section>
  );
}

function Fmea({ view, selectedId, onSelect }: Props) {
  const [residual, setResidual] = useState(false);
  const [pick, setPick] = useState<string[] | null>(null);
  const risks = listOf(view.analysis.elements, "Risk");
  const n = (e: Element, k: string) => Number(e.attrs[k]) || 0;
  const score = (e: Element) => n(e, "severity") * n(e, "likelihood");
  const rows = [...risks].filter((r) => !pick || pick.includes(r.id)).sort((x, y) => score(y) - score(x));
  const tag = (v: number) => (v >= 15 ? <span className="tag danger">{v}</span> : v >= 8 ? <span className="tag warn">{v}</span> : v > 0 ? <span className="tag">{v}</span> : <span className="faint">—</span>);
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">FMEA 風險矩陣</h1><span className="label">{risks.length} 項 · 高 {risks.filter((r) => score(r) >= 15).length} · 中 {risks.filter((r) => score(r) >= 8 && score(r) < 15).length}</span></div>
      <div className="fmea-top">
        <div>
          <nav className="seg no-print" role="tablist" style={{ gap: 16 }}>
            <button role="tab" aria-selected={!residual} onClick={() => setResidual(false)}>緩解前</button>
            <button role="tab" aria-selected={residual} onClick={() => setResidual(true)}>緩解後</button>
          </nav>
          <RiskGrid risks={risks} residual={residual} size={46} onPick={(ids) => setPick(ids)} />
          <p className="caption">橫軸　嚴重度 1–5　　縱軸　可能性 1–5</p>
        </div>
        <div className="stack">
          <p className="body muted">格子裡的數字是落在該處的風險件數，點格子只看那幾項。風險值＝嚴重度 × 可能性：15 以上為高，8 到 14 為中。</p>
          <p className="caption">RPN＝嚴重度 × 可能性 × 偵測度。偵測度越高代表越難在出事前發現。</p>
          {pick && <div><button className="tbtn primary" onClick={() => setPick(null)}>顯示全部</button></div>}
        </div>
      </div>
      {rows.length === 0 ? <p className="body">還沒有風險。到左側「風險與安全」新增。</p> : (
        <table>
          <thead><tr><th>編號</th><th>失效模式</th><th>影響</th><th>原因</th><th>S</th><th>O</th><th>D</th><th>風險值</th><th>RPN</th><th>緩解措施</th><th>緩解後</th><th>負責人</th><th>狀態</th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} className="rowbtn" aria-selected={e.id === selectedId} onClick={() => onSelect(e.id)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onSelect(e.id); }}>
              <td className="id">{e.shortName ?? "—"}</td><td>{e.attrs.failureMode || e.name}</td><td>{e.attrs.effect}</td><td>{e.attrs.cause}</td>
              <td className="id">{n(e, "severity") || "—"}</td><td className="id">{n(e, "likelihood") || "—"}</td><td className="id">{n(e, "detection") || "—"}</td>
              <td>{tag(score(e))}</td><td className="id">{score(e) * n(e, "detection") || "—"}</td>
              <td>{e.attrs.mitigation || <span className="tag danger">MISS</span>}</td>
              <td>{tag(n(e, "residualSeverity") * n(e, "residualLikelihood"))}</td><td>{e.attrs.owner}</td><td>{e.attrs.status || "開啟"}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

/** 推導鏈：從利害關係人一路到驗證，每一欄是一個層次，線是追溯關係。 */
function Chain({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const cols: { zh: string; items: Element[] }[] = [
    { zh: "利害關係人與期望", items: listOf(a.elements, "Stakeholder", "Expectation") },
    { zh: "需要與目標", items: listOf(a.elements, "Need", "Goal") },
    { zh: "目的與量度", items: listOf(a.elements, "Objective", "MOE") },
    { zh: "系統需求", items: listOf(a.elements, "SystemRequirement") },
    { zh: "次系統與元件需求", items: listOf(a.elements, "SubsystemRequirement", "ComponentRequirement", "MOP") },
  ];
  const reqIds = new Set(cols.flatMap((c) => c.items.map((e) => e.id)));
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const design = [...new Set(a.relations.filter((r) => r.kind === "satisfy" && reqIds.has(r.to)).map((r) => r.from))].map((i) => byId.get(i)).filter((e): e is Element => !!e);
  cols.push({ zh: "設計", items: design }, { zh: "驗證", items: listOf(a.elements, "VerificationEvent", "ValidationEvent") });
  const cw = 168, gap = 46, rh = 44, top = 30;
  const pos = new Map<string, { x: number; y: number; c: number }>();
  cols.forEach((c, ci) => c.items.forEach((e, ri) => pos.set(e.id, { x: ci * (cw + gap), y: top + ri * rh, c: ci })));
  const rowsMax = Math.max(1, ...cols.map((c) => c.items.length));
  const W = cols.length * (cw + gap) - gap, H = top + rowsMax * rh;
  const links = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind) && pos.has(r.from) && pos.has(r.to) && pos.get(r.from)?.c !== pos.get(r.to)?.c);
  const total = cols.reduce((s, c) => s + c.items.length, 0);
  if (total === 0) return <p className="body">還沒有內容可以畫推導鏈。</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: "none", display: "block" }} role="img" aria-label={`推導鏈：${cols.map((c) => `${c.zh} ${c.items.length} 項`).join("，")}，共 ${links.length} 條追溯。`}>
        {cols.map((c, ci) => <text key={ci} x={ci * (cw + gap)} y={12} fontSize="10" letterSpacing="1" fill="var(--ink-faint)">{c.zh}　{c.items.length}</text>)}
        {links.map((r, i) => {
          const p = pos.get(r.from) as { x: number; y: number; c: number }, q = pos.get(r.to) as { x: number; y: number; c: number };
          const [l, rr] = p.c < q.c ? [p, q] : [q, p];
          const x1 = l.x + cw, y1 = l.y + 17, x2 = rr.x, y2 = rr.y + 17, mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} fill="none" stroke="var(--ink)" strokeWidth={r.from === selectedId || r.to === selectedId ? 2 : 1} strokeDasharray={r.kind === "satisfy" || r.kind === "verify" ? undefined : "4 3"} opacity={selectedId && r.from !== selectedId && r.to !== selectedId ? 0.3 : 0.9} />;
        })}
        {cols.flatMap((c) => c.items).map((e) => {
          const p = pos.get(e.id) as { x: number; y: number };
          const sel = e.id === selectedId;
          return (
            <g key={e.id} onClick={() => onSelect(e.id)} style={{ cursor: "pointer" }} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onSelect(e.id); }} role="button" aria-label={label(e)}>
              <rect x={p.x + 0.5} y={p.y + 0.5} width={cw - 1} height={34} fill="var(--bg)" stroke={sel ? "var(--ink)" : "var(--line-strong)"} strokeWidth={sel ? 2 : 1} />
              <text x={p.x + 8} y={p.y + 14} fontSize="9.5" letterSpacing="0.5" fill="var(--ink-faint)">{e.shortName ?? ""}</text>
              <text x={p.x + 8} y={p.y + 28} fontSize="12" fill="var(--ink)" fontFamily="var(--font-sans)">{wrap(e.name, 24, 1)[0]}</text>
            </g>
          );
        })}
      </svg>
      <p className="caption" style={{ marginTop: 8 }}>虛線　衍生、細化、追溯　　實線　滿足、驗證　　點任一項會突顯它的來龍去脈</p>
    </div>
  );
}

function Path(p: Props) {
  const { view, user, onChanged } = p;
  const [error, setError] = useState("");
  const setDate = async (gate: string, date: string) => {
    setError("");
    try { onChanged(await api<View>(`/projects/${view.project.id}/milestones`, "POST", { gate, date })); } catch (e) { setError((e as Error).message); }
  };
  const last = (g: string) => [...view.project.signoffs].reverse().find((s) => s.gate === g && !s.subsystem);
  const today = new Date().toISOString().slice(0, 10);
  const firstOpen = view.gates.find((g) => last(g.id)?.decision !== "APPROVE")?.id;
  return (
    <>
      <section className="section">
        <div className="section-head"><h1 className="section-title">里程碑路徑</h1><span className="label">{view.gates.filter((g) => last(g.id)?.decision === "APPROVE").length} / {view.gates.length}</span></div>
        {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
        <div className="path-track">
          {view.gates.map((g) => {
            const so = last(g.id), ok = so?.decision === "APPROVE", plan = view.milestones[g.id] ?? "";
            const late = !ok && plan && plan < today;
            return (
              <div key={g.id} className={`path-step ${ok ? "ok" : ""} ${g.id === firstOpen ? "cur" : ""}`}>
                <span className="path-dot" aria-hidden="true" />
                <span className="heading">{g.zh}</span>
                <span className="label">{g.en}</span>
                <span className="meter"><span style={{ width: `${ok ? 100 : g.total ? (g.done / g.total) * 100 : 0}%` }} /></span>
                <span className="caption">{g.done} / {g.total} 項</span>
                <span>{ok ? <span className="tag done">DONE</span> : late ? <span className="tag danger">LATE</span> : g.id === firstOpen ? <span className="tag">進行中</span> : <span className="faint">—</span>}</span>
                {user.caps.confirm
                  ? <label className="field" style={{ margin: 0 }}><span className="label">預定</span><input className="input" style={{ height: 28, fontSize: 13 }} type="date" value={plan} onChange={(e) => setDate(g.id, e.target.value)} /></label>
                  : <span className="caption">預定　{plan || g.deadline || "—"}</span>}
                <span className="caption">{so && ok ? `核可　${when(so.at)}　${so.by}` : g.deadline ? `AEAS 期限　${g.deadline}` : ""}</span>
              </div>
            );
          })}
        </div>
      </section>
      <section className="section">
        <div className="section-head"><h2 className="section-title">推導鏈</h2><span className="label">需求是怎麼一步步來的</span></div>
        <Chain {...p} />
      </section>
    </>
  );
}

const blank: Doc = { id: "", title: "", type: "規則", revision: "", url: "", note: "" };
function Docs({ view, user, onChanged }: Props) {
  const id = view.project.id;
  const [form, setForm] = useState<Doc>(blank);
  const [error, setError] = useState("");
  const used = (d: Doc) => view.analysis.elements.filter((e) => e.attrs.sourceDoc === d.id).length;
  const reload = async () => onChanged(await api<View>(`/projects/${id}`));
  const save = async (ev: FormEvent) => {
    ev.preventDefault(); setError("");
    try { await api(`/projects/${id}/pm/docs`, "POST", { ...form }); setForm(blank); await reload(); } catch (e) { setError((e as Error).message); }
  };
  const del = async (d: Doc) => { setError(""); try { await api(`/projects/${id}/pm/docs/delete`, "POST", { id: d.id }); setForm(blank); await reload(); } catch (e) { setError((e as Error).message); } };
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">來源文件</h1><span className="label">{view.docs.length}</span></div>
      <p className="body muted" style={{ marginBottom: 12 }}>需求書、競賽規則、標準等。這裡只記連結，檔案本身放在 Google Drive。登記後，每個項目都可以在右側欄標註出處。</p>
      {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
      {view.docs.length > 0 && (
        <table style={{ marginBottom: 16 }}>
          <thead><tr><th>編號</th><th>名稱</th><th>類型</th><th>版次</th><th>連結</th><th>被引用</th></tr></thead>
          <tbody>{view.docs.map((d) => (
            <tr key={d.id} className="rowbtn" aria-selected={form.id === d.id} onClick={() => user.caps.edit && setForm(d)}>
              <td className="id">{d.id}</td><td>{d.title}<div className="caption">{d.note}</div></td><td>{d.type}</td><td className="id">{d.revision}</td>
              <td>{d.url ? <a href={d.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>開啟</a> : <span className="faint">—</span>}</td>
              <td className="id">{used(d)} 項</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {user.caps.edit && (
        <form onSubmit={save} className="no-print">
          <div className="row">
            <label className="field" style={{ flex: 2 }}><span className="label">{form.id ? `修改 ${form.id}` : "登記文件"}</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="2027 台灣盃火箭競賽規則" /></label>
            <label className="field"><span className="label">類型</span><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{["需求書", "規則", "標準", "會議紀錄", "報告", "其他"].map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field"><span className="label">版次</span><input className="input" value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} /></label>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 2 }}><span className="label">連結（https://）</span><input className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://drive.google.com/…" /></label>
            <label className="field"><span className="label">備註</span><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          <div className="tbtn-row"><button className="tbtn primary">{form.id ? "更新" : "登記"}</button>
            {form.id && <><button type="button" className="tbtn" onClick={() => setForm(blank)}>取消</button><button type="button" className="tbtn" disabled={used(form) > 0} title={used(form) > 0 ? "還有項目引用它" : ""} onClick={() => del(form)}>刪除</button></>}</div>
        </form>
      )}
    </section>
  );
}
