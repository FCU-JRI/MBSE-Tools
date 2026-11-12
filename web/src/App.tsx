import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api, getAuthor, setAuthor } from "./api.ts";
import type { Me, Meta, MeResponse, Project, View } from "./api.ts";
import { Admin } from "./Admin.tsx";
import { diagramsOf, label, listOf } from "./model.ts";
import type { DiagramDef } from "./model.ts";
import { Diagram } from "./Diagram.tsx";
import { Inspector } from "./Inspector.tsx";
import type { Selection } from "./Inspector.tsx";
import { GatesView, TableView } from "./Views.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { Deliverables } from "./Deliverables.tsx";
import type { DeliverTab } from "./Deliverables.tsx";
import { VersionsView } from "./Versions.tsx";
import { PlanView } from "./Plan.tsx";
import { SimView } from "./Sim.tsx";
import { SourceTab } from "./SourceTab.tsx";

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => new URLSearchParams(location.search).get("p") ?? lastProject());
  const [page, setPage] = useState<"home" | "admin">("home");
  const [author, setAuthorState] = useState(getAuthor);
  const [error, setError] = useState("");

  useEffect(() => {
    api<MeResponse>("/me").then((m) => { setMe(m); if (m.user) return api<Meta>("/meta").then(setMeta); }).catch((e) => setError(e.message));
  }, []);
  const open = (id: string | null) => { setProjectId(id); setPage("home"); rememberProject(id); history.pushState(null, "", id ? `?p=${id}` : location.pathname); };
  const [welcomed, setWelcomed] = useState(seenWelcome);
  const logout = async () => { await fetch("/auth/logout", { method: "POST" }); location.href = "/"; };

  if (error) return <div className="page"><p className="msg"><span className="tag danger">ERR</span>{error}</p></div>;
  if (!me) return <div className="page"><p className="label">載入中</p></div>;
  if (!me.user) return <Login github={me.githubLogin} />;
  if (!meta) return <div className="page"><p className="label">載入中</p></div>;
  const user = me.user;
  // 只有這台電腦本機操作時可以自填名字；其餘身分來自登入
  const who = user.kind === "local" && user.login === "local" ? (
    <label className="who"><span className="label">使用者</span>
      <input className="input" value={author} placeholder="你的名字" onChange={(e) => { setAuthorState(e.target.value); setAuthor(e.target.value); }} />
    </label>
  ) : (
    <span className="who"><span className="label">{user.name} · {user.rankZh}</span>{user.kind !== "local" && <button className="tbtn" onClick={logout}>登出</button>}</span>
  );

  if (!welcomed) return <Welcome name={user.name} role={user.rankZh} onDone={() => { markWelcome(); setWelcomed(true); }} />;
  if (projectId) return <Workspace id={projectId} meta={meta} user={user} onHome={() => open(null)} who={who} />;
  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => setPage("home")}>JRI MBSE</button><span className="label">噴射推進研究社</span><span className="grow" />
        {user.caps.admin && <nav className="seg" role="tablist"><button role="tab" aria-selected={page === "home"} onClick={() => setPage("home")}>專案</button><button role="tab" aria-selected={page === "admin"} onClick={() => setPage("admin")}>管理</button></nav>}
        {who}
      </header>
      {page === "admin" && user.caps.admin ? <Admin /> : <Home meta={meta} user={user} onOpen={open} />}
    </div>
  );
}

// 記住上次開啟的專案與是否已看過歡迎畫面；讀不到就當作沒有
function lastProject(): string | null { try { return localStorage.getItem("jri.last"); } catch { return null; } }
function rememberProject(id: string | null): void { try { if (id) localStorage.setItem("jri.last", id); else localStorage.removeItem("jri.last"); } catch { /* 無法儲存時略過 */ } }
function seenWelcome(): boolean { try { return sessionStorage.getItem("jri.welcome") === "1"; } catch { return true; } }
function markWelcome(): void { try { sessionStorage.setItem("jri.welcome", "1"); } catch { /* 略過 */ } }

/** 進站的歡迎畫面：一條線長出來，名字淡入，約兩秒後進入首頁。點一下或按任意鍵可跳過；每次開瀏覽器只出現一次。 */
function Welcome({ name, role, onDone }: { name: string; role: string; onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(onDone, reduce ? 900 : 2300);
    const key = () => onDone();
    window.addEventListener("keydown", key);
    return () => { clearTimeout(t); window.removeEventListener("keydown", key); };
  }, [onDone]);
  const d = new Date();
  const stamp = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getDay()]}`;
  return (
    <button className="welcome" onClick={onDone} aria-label="進入">
      <span className="welcome-brand">JRI MBSE</span>
      <span className="welcome-line" aria-hidden="true" />
      <span className="welcome-hello">歡迎，{name}</span>
      <span className="label welcome-meta">{role} · {stamp}</span>
    </button>
  );
}

function Login({ github }: { github: boolean }) {
  return (
    <div className="shell enter">
      <header className="topbar"><span className="brand">JRI MBSE</span><span className="label">噴射推進研究社</span></header>
      <main className="page login" style={{ width: "100%", maxWidth: 480 }}>
        <p className="welcome-brand" style={{ marginBottom: 8 }}>JRI MBSE</p>
        <span className="welcome-line" aria-hidden="true" style={{ display: "block", marginBottom: 32 }} />
        <section className="section">
          <div className="section-head"><h1 className="section-title">登入</h1></div>
          <p className="body" style={{ marginBottom: 16 }}>JRI 成員請用 GitHub 帳號登入。帳號要先由總工程師加入成員名單。</p>
          {github ? <a className="btn" href="/auth/github">用 GitHub 登入</a> : <p className="msg"><span className="tag">未設定</span>GitHub 登入尚未設定，請聯絡管理員。</p>}
          <p className="caption" style={{ marginTop: 24 }}>外部審查委員請直接開啟收到的唯讀連結。</p>
        </section>
      </main>
    </div>
  );
}

function Home({ meta, user, onOpen }: { meta: Meta; user: Me; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [form, setForm] = useState({ id: "", name: "", kind: "annual" as "annual" | "small", gates: ["mdr", "cdr", "trr"] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Project | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const archive = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!removing) return;
    setError("");
    try {
      await api(`/projects/${removing.id}/archive`, "POST", { confirm: confirmText });
      setProjects((ps) => (ps ?? []).filter((p) => p.id !== removing.id));
      setRemoving(null); setConfirmText("");
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { api<Project[]>("/projects").then(setProjects).catch((e) => setError(e.message)); }, []);
  const create = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true); setError("");
    try { onOpen((await api<Project>("/projects", "POST", form)).id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="page home" style={{ width: "100%" }}>
      <section className="section">
        <div className="section-head"><h1 className="section-title">專案</h1><span className="label">{projects?.length ?? 0}</span></div>
        {projects === null ? <p className="label">載入中</p> : projects.length === 0 ? <p className="body muted">{user.caps.createProject ? "還沒有專案。在右側建立第一個。" : "還沒有可以開啟的專案。"}</p> : projects.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button className="proj" onClick={() => onOpen(p.id)}>
              <span className="heading" style={{ flex: 1 }}>{p.name}</span>
              <span className="label">{p.kind === "annual" ? "年度計畫" : "小型專案"}</span>
              <span className="label">{p.gates.length} 節點</span>
              <span className="label">{p.id}</span>
            </button>
            {user.caps.admin && <button className="tbtn" onClick={() => { setRemoving(p); setConfirmText(""); setError(""); }}>刪除</button>}
          </div>
        ))}
        {removing && (
          <form onSubmit={archive} style={{ marginTop: 24 }}>
            <div className="section-head"><h2 className="section-title">刪除專案</h2><span className="tag danger">DELETE</span></div>
            <p className="body" style={{ marginBottom: 12 }}>「{removing.name}」會從列表移除，所有人都無法再開啟。資料會移到這台電腦的封存資料夾，需要時可以請管理員還原。</p>
            <label className="field"><span className="label">輸入專案名稱「{removing.name}」確認</span><input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus /></label>
            <div className="tbtn-row"><button className="tbtn primary" disabled={confirmText.trim() !== removing.name}>確定刪除</button><button type="button" className="tbtn" onClick={() => setRemoving(null)}>取消</button></div>
          </form>
        )}
      </section>
      {user.caps.createProject && <form className="section" onSubmit={create}>
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
      </form>}
    </main>
  );
}

type Mode = "home" | "diagram" | "table" | "deliver" | "gates" | "plan" | "sim" | "source" | "history";
const MODES: [Mode, string][] = [["home", "首頁"], ["diagram", "圖"], ["table", "表"], ["deliver", "產出物"], ["gates", "節點"], ["plan", "時程"], ["sim", "模擬"], ["source", "原始碼"], ["history", "版本"]];

function Workspace({ id, meta, user, onHome, who }: { id: string; meta: Meta; user: Me; onHome: () => void; who: React.ReactNode }) {
  const readOnly = !user.caps.edit;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("home");
  const [deliverTab, setDeliverTab] = useState<DeliverTab>("req");
  const [diagramId, setDiagramId] = useState("bdd");
  const [catId, setCatId] = useState("SystemRequirement");
  const [gateId, setGateId] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ type: "new", category: "SystemRequirement", parentId: null });
  const [panes, setPanes] = useState(loadPanes);
  const setPane = (p: Partial<Panes>) => setPanes((cur) => { const next = { ...cur, ...p }; savePanes(next); return next; });
  const reload = useCallback(() => api<View>(`/projects/${id}`).then(setView).catch((e) => setError(e.message)), [id]);
  useEffect(() => { reload(); }, [reload]);

  const diagrams = useMemo(() => (view ? diagramsOf(view.analysis) : []), [view]);
  if (error) return <div className="page"><p className="msg"><span className="tag danger">ERR</span>{error}</p><button className="tbtn primary" onClick={onHome}>回專案列表</button></div>;
  if (!view) return <div className="page"><p className="label">載入模型中</p></div>;

  const def: DiagramDef = diagrams.find((d) => d.id === diagramId) ?? diagrams[0];
  const errors = view.analysis.diagnostics.filter((d) => d.severity === "error");
  const selectedId = sel.type === "element" ? sel.id : null;
  const selectElement = (eid: string | null) => setSel(eid ? { type: "element", id: eid } : { type: "new", category: catId, parentId: null });
  const showSide = mode === "diagram" || mode === "table" || mode === "deliver" || mode === "gates";
  const showTree = mode !== "home";
  // 首頁各區塊點了之後前往對應的頁面
  const go = (m: string, arg?: string) => {
    if (m === "gates" && arg) setGateId(arg);
    if (m === "deliver" && arg) setDeliverTab(arg as DeliverTab);
    setMode(m as Mode);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={onHome}>JRI MBSE</button>
        {readOnly && <span className="tag">唯讀</span>}
        <span className="label crumb">{view.project.name}</span>
        <nav className="seg" role="tablist">{MODES.map(([m, zh]) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{zh}</button>)}</nav>
        <span className="grow" />
        <a className={`tbtn ${view.analysis.ok ? "" : "disabled"}`} href={view.analysis.ok ? `/api/projects/${id}/export.xlsx` : undefined}>匯出 Excel</a>
        {who}
      </header>
      <div className="work">
        {showTree && <aside className="side left" style={{ width: panes.leftOpen ? panes.left : 0 }} hidden={!panes.leftOpen}>
          <Tree view={view} meta={meta} diagrams={diagrams} mode={mode} diagramId={def.id} catId={catId} gateId={gateId} selectedId={selectedId}
            onDiagram={(d) => { setDiagramId(d); setMode("diagram"); }}
            onCategory={(c) => { setCatId(c); setMode("table"); setSel({ type: "new", category: c, parentId: null }); }}
            onElement={(eid, c) => { if (c) setCatId(c); setSel({ type: "element", id: eid }); if (mode !== "diagram" && mode !== "table") setMode("table"); }}
            onGate={(g) => { setGateId(g); setMode("gates"); }} />
        </aside>}
        {showTree && <Resizer side="left" open={panes.leftOpen} width={panes.left} onWidth={(w) => setPane({ left: w })} onToggle={() => setPane({ leftOpen: !panes.leftOpen })} />}
        <section className="center">
          {errors.length > 0 && mode !== "source" && (
            <div className="banner"><span className="tag danger">ERR</span><span className="body">模型有 {errors.length} 個錯誤，圖表暫時無法更新。</span><button className="tbtn primary" onClick={() => setMode("source")}>到原始碼修正</button></div>
          )}
          {notice && <div className="banner"><span className="tag danger">ERR</span><span className="body" style={{ flex: 1 }}>{notice}</span><button className="tbtn" onClick={() => setNotice("")}>關閉</button></div>}
          {mode === "diagram" && <Diagram readOnly={readOnly} view={view} meta={meta} def={def} selectedId={selectedId} onSelectElement={selectElement}
            onSelectEdge={(e) => e && setSel({ type: "edge", edge: e })} onNew={(c, parentId) => setSel({ type: "new", category: c, parentId })}
            onChanged={(v) => { setView(v); setNotice(""); }} onError={setNotice} />}
          {mode === "table" && <div className="center-scroll"><TableView view={view} meta={meta} catId={catId} selectedId={selectedId} onSelect={selectElement} /></div>}
          {mode === "home" && <div className="center-scroll enter"><Dashboard view={view} go={go} /></div>}
          {mode === "deliver" && <Deliverables view={view} meta={meta} user={user} tab={deliverTab} setTab={setDeliverTab} selectedId={selectedId} onSelect={(eid) => setSel({ type: "element", id: eid })} onChanged={setView} />}
          {mode === "gates" && <div className="center-scroll"><GatesView user={user} view={view} gateId={gateId ?? view.gates[0]?.id ?? ""} setView={setView} onSelect={(eid) => setSel({ type: "element", id: eid })} /></div>}
          {mode === "plan" && <div className="center-scroll"><PlanView view={view} meta={meta} user={user} /></div>}
          {mode === "sim" && <div className="center-scroll"><SimView view={view} user={user} onChanged={setView} /></div>}
          {mode === "source" && <div className="center-scroll" style={{ display: "flex", flexDirection: "column" }}><SourceTab id={id} onSaved={reload} readOnly={readOnly} /></div>}
          {mode === "history" && <div className="center-scroll"><VersionsView id={id} user={user} onChanged={setView} /></div>}
        </section>
        {showSide && <Resizer side="right" open={panes.rightOpen} width={panes.right} onWidth={(w) => setPane({ right: w })} onToggle={() => setPane({ rightOpen: !panes.rightOpen })} />}
        {showSide && <aside className="side right" style={{ width: panes.rightOpen ? panes.right : 0 }} hidden={!panes.rightOpen}><Inspector readOnly={readOnly} view={view} meta={meta} sel={sel} setSel={setSel} onChanged={setView} /></aside>}
      </div>
    </div>
  );
}

interface Panes { left: number; right: number; leftOpen: boolean; rightOpen: boolean }
const DEFAULT_PANES: Panes = { left: 272, right: 320, leftOpen: true, rightOpen: true };
// 側邊欄寬度是每個人自己的偏好，存在瀏覽器；讀不到就用預設值
function loadPanes(): Panes {
  try { return { ...DEFAULT_PANES, ...JSON.parse(localStorage.getItem("jri.panes") ?? "{}") }; } catch { return DEFAULT_PANES; }
}
function savePanes(p: Panes): void { try { localStorage.setItem("jri.panes", JSON.stringify(p)); } catch { /* 無法儲存時只在本次有效 */ } }

/** 側邊欄與中間區域之間的分隔條：拖曳調整寬度，按鈕收合或展開；也可用方向鍵調整。 */
function Resizer({ side, open, width, onWidth, onToggle }: { side: "left" | "right"; open: boolean; width: number; onWidth: (w: number) => void; onToggle: () => void }) {
  const clamp = (w: number) => Math.min(640, Math.max(180, Math.round(w)));
  const start = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!open || (ev.target as HTMLElement).closest("button")) return;
    ev.preventDefault();
    const x0 = ev.clientX, w0 = width;
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => onWidth(clamp(w0 + (side === "left" ? e.clientX - x0 : x0 - e.clientX)));
    const stop = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", stop); el.removeEventListener("pointercancel", stop); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", stop); el.addEventListener("pointercancel", stop);
  };
  const key = (e: React.KeyboardEvent) => {
    if (!open) return;
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (d) { e.preventDefault(); onWidth(clamp(width + (side === "left" ? d : -d))); }
  };
  const zh = side === "left" ? "左側欄" : "右側欄";
  const arrow = (side === "left") === open ? "‹" : "›";
  return (
    <div className={`resizer ${side} ${open ? "" : "closed"}`} role="separator" aria-orientation="vertical" aria-label={`調整${zh}寬度`} aria-valuenow={open ? width : 0} aria-valuemin={180} aria-valuemax={640} tabIndex={0} onPointerDown={start} onKeyDown={key}>
      <button className="resizer-toggle" onClick={onToggle} aria-label={open ? `收合${zh}` : `展開${zh}`} title={open ? `收合${zh}` : `展開${zh}`}>{arrow}</button>
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
                      <span className="tn">{e.name}</span>{e.shared && <span className="tid">共用</span>}{e.shortName && <span className="tid">{e.shortName}</span>}
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
