import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api, getAuthor, setAuthor } from "./api.ts";
import type { Meta, Project, View } from "./api.ts";
import { diagramsOf, label, listOf } from "./model.ts";
import type { DiagramDef } from "./model.ts";
import { Diagram } from "./Diagram.tsx";
import { Inspector } from "./Inspector.tsx";
import type { Selection } from "./Inspector.tsx";
import { GatesView, HistoryView, TableView, TraceView } from "./Views.tsx";
import { SourceTab } from "./SourceTab.tsx";

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => new URLSearchParams(location.search).get("p"));
  const [author, setAuthorState] = useState(getAuthor);
  const [error, setError] = useState("");

  useEffect(() => { api<Meta>("/meta").then(setMeta).catch((e) => setError(e.message)); }, []);
  const open = (id: string | null) => { setProjectId(id); history.pushState(null, "", id ? `?p=${id}` : location.pathname); };
  const who = (
    <label className="who"><span className="label">使用者</span>
      <input className="input" value={author} placeholder="你的名字" onChange={(e) => { setAuthorState(e.target.value); setAuthor(e.target.value); }} />
    </label>
  );

  if (error) return <div className="page"><p className="msg"><span className="tag danger">ERR</span>{error}</p></div>;
  if (!meta) return <div className="page"><p className="label">載入中</p></div>;
  if (projectId) return <Workspace id={projectId} meta={meta} onHome={() => open(null)} who={who} />;
  return (
    <div className="shell">
      <header className="topbar"><span className="brand">JRI MBSE</span><span className="label">噴射推進研究社</span><span className="grow" />{who}</header>
      <Home meta={meta} onOpen={open} />
    </div>
  );
}

function Home({ meta, onOpen }: { meta: Meta; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [form, setForm] = useState({ id: "", name: "", kind: "annual" as "annual" | "small", gates: ["mdr", "cdr", "trr"] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<Project[]>("/projects").then(setProjects).catch((e) => setError(e.message)); }, []);
  const create = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true); setError("");
    try { onOpen((await api<Project>("/projects", "POST", form)).id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="page home" style={{ width: "100%" }}>
      <section className="section">
        <div className="section-head"><h1 className="section-title">專案</h1><span className="label">{projects?.length ?? 0}</span></div>
        {projects === null ? <p className="label">載入中</p> : projects.length === 0 ? <p className="body muted">還沒有專案。在右側建立第一個。</p> : projects.map((p) => (
          <button key={p.id} className="proj" onClick={() => onOpen(p.id)}>
            <span className="heading" style={{ flex: 1 }}>{p.name}</span>
            <span className="label">{p.kind === "annual" ? "年度計畫" : "小型專案"}</span>
            <span className="label">{p.gates.length} 節點</span>
            <span className="label">{p.id}</span>
          </button>
        ))}
      </section>
      <form className="section" onSubmit={create}>
        <div className="section-head"><h2 className="section-title">建立專案</h2></div>
        <label className="field"><span className="label">名稱</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="2027 年度探空火箭" /></label>
        <label className="field"><span className="label">代號</span><input className="input" required value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} placeholder="sr-2027" pattern="[a-z0-9][a-z0-9\-]{1,40}" /></label>
        <p className="caption" style={{ marginBottom: 12 }}>小寫英數與連字號，會成為儲存庫名稱，之後不能改。</p>
        <label className="field"><span className="label">類型</span>
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "annual" | "small" })}>
            <option value="annual">年度計畫（全部節點）</option><option value="small">小型專案（自選節點）</option>
          </select>
        </label>
        {form.kind === "small" && meta.gates.map((g) => (
          <label key={g.id} className="check">
            <input type="checkbox" checked={form.gates.includes(g.id)} onChange={(e) => setForm({ ...form, gates: e.target.checked ? [...form.gates, g.id] : form.gates.filter((x) => x !== g.id) })} />
            <span>{g.zh}</span>
          </label>
        ))}
        {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
        <div style={{ marginTop: 12 }}><button className="btn" disabled={busy}>{busy ? "建立中" : "建立"}</button></div>
      </form>
    </main>
  );
}

type Mode = "diagram" | "table" | "trace" | "gates" | "source" | "history";
const MODES: [Mode, string][] = [["diagram", "圖"], ["table", "表"], ["trace", "追溯"], ["gates", "節點"], ["source", "原始碼"], ["history", "紀錄"]];

function Workspace({ id, meta, onHome, who }: { id: string; meta: Meta; onHome: () => void; who: React.ReactNode }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("diagram");
  const [diagramId, setDiagramId] = useState("bdd");
  const [catId, setCatId] = useState("SystemRequirement");
  const [gateId, setGateId] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ type: "new", category: "SystemRequirement", parentId: null });
  const reload = useCallback(() => api<View>(`/projects/${id}`).then(setView).catch((e) => setError(e.message)), [id]);
  useEffect(() => { reload(); }, [reload]);

  const diagrams = useMemo(() => (view ? diagramsOf(view.analysis) : []), [view]);
  if (error) return <div className="page"><p className="msg"><span className="tag danger">ERR</span>{error}</p><button className="tbtn primary" onClick={onHome}>回專案列表</button></div>;
  if (!view) return <div className="page"><p className="label">載入模型中</p></div>;

  const def: DiagramDef = diagrams.find((d) => d.id === diagramId) ?? diagrams[0];
  const errors = view.analysis.diagnostics.filter((d) => d.severity === "error");
  const selectedId = sel.type === "element" ? sel.id : null;
  const selectElement = (eid: string | null) => setSel(eid ? { type: "element", id: eid } : { type: "new", category: catId, parentId: null });
  const showSide = mode !== "source" && mode !== "history";

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={onHome}>JRI MBSE</button>
        <span className="label crumb">{view.project.name}</span>
        <nav className="seg" role="tablist">{MODES.map(([m, zh]) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{zh}</button>)}</nav>
        <span className="grow" />
        <a className={`tbtn ${view.analysis.ok ? "" : "disabled"}`} href={view.analysis.ok ? `/api/projects/${id}/export.xlsx` : undefined}>匯出 Excel</a>
        {who}
      </header>
      <div className="work" style={showSide ? undefined : { gridTemplateColumns: "272px minmax(0, 1fr)" }}>
        <aside className="side left">
          <Tree view={view} meta={meta} diagrams={diagrams} mode={mode} diagramId={def.id} catId={catId} gateId={gateId} selectedId={selectedId}
            onDiagram={(d) => { setDiagramId(d); setMode("diagram"); }}
            onCategory={(c) => { setCatId(c); setMode("table"); setSel({ type: "new", category: c, parentId: null }); }}
            onElement={(eid, c) => { if (c) setCatId(c); setSel({ type: "element", id: eid }); if (mode !== "diagram" && mode !== "table") setMode("table"); }}
            onGate={(g) => { setGateId(g); setMode("gates"); }} />
        </aside>
        <section className="center">
          {errors.length > 0 && mode !== "source" && (
            <div className="banner"><span className="tag danger">ERR</span><span className="body">模型有 {errors.length} 個錯誤，圖表暫時無法更新。</span><button className="tbtn primary" onClick={() => setMode("source")}>到原始碼修正</button></div>
          )}
          {notice && <div className="banner"><span className="tag danger">ERR</span><span className="body" style={{ flex: 1 }}>{notice}</span><button className="tbtn" onClick={() => setNotice("")}>關閉</button></div>}
          {mode === "diagram" && <Diagram view={view} meta={meta} def={def} selectedId={selectedId} onSelectElement={selectElement}
            onSelectEdge={(e) => e && setSel({ type: "edge", edge: e })} onNew={(c, parentId) => setSel({ type: "new", category: c, parentId })}
            onChanged={(v) => { setView(v); setNotice(""); }} onError={setNotice} />}
          {mode === "table" && <div className="center-scroll"><TableView view={view} meta={meta} catId={catId} selectedId={selectedId} onSelect={selectElement} /></div>}
          {mode === "trace" && <div className="center-scroll"><TraceView view={view} selectedId={selectedId} onSelect={selectElement} /></div>}
          {mode === "gates" && <div className="center-scroll"><GatesView view={view} gateId={gateId ?? view.gates[0]?.id ?? ""} setView={setView} onSelect={(eid) => setSel({ type: "element", id: eid })} /></div>}
          {mode === "source" && <div className="center-scroll" style={{ display: "flex", flexDirection: "column" }}><SourceTab id={id} onSaved={reload} /></div>}
          {mode === "history" && <div className="center-scroll"><HistoryView id={id} /></div>}
        </section>
        {showSide && <aside className="side right"><Inspector view={view} meta={meta} sel={sel} setSel={setSel} onChanged={setView} /></aside>}
      </div>
    </div>
  );
}

interface TreeProps {
  view: View; meta: Meta; diagrams: DiagramDef[]; mode: Mode; diagramId: string; catId: string; gateId: string | null; selectedId: string | null;
  onDiagram: (id: string) => void; onCategory: (id: string) => void; onElement: (id: string, category: string | null) => void; onGate: (id: string) => void;
}

/** 左側欄：圖、模型樹、節點進度。 */
function Tree({ view, meta, diagrams, mode, diagramId, catId, gateId, selectedId, onDiagram, onCategory, onElement, onGate }: TreeProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({ requirements: true, structure: true });
  const els = view.analysis.elements;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return (
    <>
      <div className="section">
        <div className="section-head"><h2 className="section-title">圖</h2><span className="label">{diagrams.length}</span></div>
        <ul className="tree">{diagrams.map((d) => (
          <li key={d.id}><button className="tree-row" aria-current={mode === "diagram" && d.id === diagramId} onClick={() => onDiagram(d.id)}>
            <span className="tid">{d.code}</span><span className="tn">{d.title}</span>
          </button></li>
        ))}</ul>
      </div>
      <div className="section">
        <div className="section-head"><h2 className="section-title">模型</h2><span className="label">{els.filter((e) => e.category).length}</span></div>
        <ul className="tree">{Object.entries(meta.pillars).map(([pid, pzh]) => (
          <li key={pid}>
            <button className="tree-row" aria-expanded={!!open[pid]} onClick={() => toggle(pid)}><span className="tw">{open[pid] ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 500 }}>{pzh}</span></button>
            {open[pid] && <ul>{meta.categories.filter((c) => c.pillar === pid).map((c) => {
              const items = listOf(els, c.id);
              const k = `c:${c.id}`;
              return (
                <li key={c.id}>
                  <div style={{ display: "flex" }}>
                    <button className="tree-row" style={{ width: 18 }} aria-label={open[k] ? "收合" : "展開"} aria-expanded={!!open[k]} onClick={() => toggle(k)} disabled={items.length === 0}><span className="tw">{items.length ? (open[k] ? "−" : "+") : ""}</span></button>
                    <button className="tree-row" aria-current={mode === "table" && c.id === catId && !selectedId} onClick={() => onCategory(c.id)}><span className="tn">{c.zh}</span><span className="tc">{items.length}</span></button>
                  </div>
                  {open[k] && <ul>{items.map((e) => (
                    <li key={e.id}><button className="tree-row" aria-current={e.id === selectedId} onClick={() => onElement(e.id, c.id)} title={label(e)}>
                      <span className="tn">{e.name}</span>{e.shortName && <span className="tid">{e.shortName}</span>}
                    </button></li>
                  ))}</ul>}
                </li>
              );
            })}</ul>}
          </li>
        ))}</ul>
      </div>
      <div className="section">
        <div className="section-head"><h2 className="section-title">節點</h2></div>
        <ul className="tree">{view.gates.map((g) => (
          <li key={g.id}><button className="tree-row gate-row" aria-current={mode === "gates" && g.id === (gateId ?? view.gates[0]?.id)} onClick={() => onGate(g.id)}>
            <span className="tn">{g.zh}</span><span className="meter"><span style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%` }} /></span><span className="tc">{g.done} / {g.total}</span>
          </button></li>
        ))}</ul>
      </div>
    </>
  );
}
