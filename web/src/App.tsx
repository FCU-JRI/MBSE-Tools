import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, baseOf, getAuthor, setAuthor } from "./api.ts";
import type { Diagrams, Element, Me, Meta, MeResponse, Project, View } from "./api.ts";
import { Admin } from "./Admin.tsx";
import { diagramsOf, isPackage, packageOf, TOP_DIAGRAM, treeOf } from "./model.ts";
import type { DiagramDef } from "./model.ts";
import { Diagram } from "./Diagram.tsx";
import { Inspector } from "./Inspector.tsx";
import type { Selection } from "./Inspector.tsx";
import { ElementTable, GatesView } from "./Views.tsx";
import { PackageTree } from "./PackageTree.tsx";
import { Dashboard } from "./Dashboard.tsx";
import { ProcessView } from "./Process.tsx";
import { Deliverables } from "./Deliverables.tsx";
import type { DeliverTab } from "./Deliverables.tsx";
import { VersionsView } from "./Versions.tsx";
import { PlanView } from "./Plan.tsx";
import { SimView } from "./Sim.tsx";
import { SourceTab } from "./SourceTab.tsx";
import { METHOD_PAGES } from "./method/registry.ts";

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
  if (projectId) return <Workspace key={projectId} id={projectId} meta={meta} user={user} onHome={() => open(null)} onOpen={open} who={who} />;
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

const TEMPLATES: { id: "blank" | "sample" | "guided"; zh: string; help: string }[] = [
  { id: "guided", zh: "流程範本專案", help: "從利害關係人開始，一步一個問題帶你完成分析。前一步沒完成不能跳到下一步。建議新專案使用。" },
  { id: "sample", zh: "範本專案", help: "附一份探空火箭的示範內容，可以對照著修改。適合想先看完整範例的人。" },
  { id: "blank", zh: "空白專案", help: "從空的模型開始，順序自己決定。適合已經熟悉方法的人。" },
];

function Home({ meta, user, onOpen }: { meta: Meta; user: Me; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [form, setForm] = useState({ id: "", name: "", kind: "annual" as "annual" | "small", gates: ["mdr", "cdr", "trr"], template: "guided" as "blank" | "sample" | "guided" });
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
              {p.reference ? <span className="tag">參考・唯讀</span> : <span className="label">{p.kind === "annual" ? "年度計畫" : "小型專案"}</span>}
              {!p.reference && <span className="label">{p.gates.length} 節點</span>}
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
        <fieldset className="choices">
          <legend className="label">建立方式</legend>
          {TEMPLATES.map((t) => (
            <label key={t.id} className={`choice ${form.template === t.id ? "on" : ""}`}>
              <input type="radio" name="template" checked={form.template === t.id} onChange={() => setForm({ ...form, template: t.id })} />
              <span><span className="heading">{t.zh}</span><span className="caption">{t.help}</span></span>
            </label>
          ))}
        </fieldset>
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

type Mode = "home" | "process" | "diagram" | "table" | "deliver" | "gates" | "plan" | "sim" | "source" | "history" | `m:${string}`;
const MODES: [Mode, string][] = [["home", "首頁"], ["process", "流程"], ["diagram", "圖"], ["table", "表"], ["deliver", "產出物"], ["gates", "節點"], ["plan", "時程"], ["sim", "模擬"], ["source", "原始碼"], ["history", "版本"],
  // METHOD.md 實作的頁面（web/src/method/registry.ts）
  ...METHOD_PAGES.map((p): [Mode, string] => [`m:${p.id}`, p.zh])];

/** id 是專案參照：main 或某個分支。分支和 main 用同一個畫面，所有分頁都能看、能改（F-33）。 */
function Workspace({ id, meta, user: me, onHome, onOpen, who }: { id: string; meta: Meta; user: Me; onHome: () => void; onOpen: (ref: string) => void; who: React.ReactNode }) {
  const [view, setView] = useState<View | null>(null);
  // 唯讀的專案（F-72）對任何身分都是唯讀：畫面上的編輯功能一律收起來，伺服器也會擋
  const user = useMemo<Me>(() => (view?.project.readOnly ? { ...me, caps: { ...me.caps, edit: false, confirm: false, merge: false } } : me), [me, view?.project.readOnly]);
  const readOnly = !user.caps.edit;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<Mode>("home");
  const [deliverTab, setDeliverTab] = useState<DeliverTab>("req");
  const [diagramId, setDiagramId] = useState(TOP_DIAGRAM);
  // 表列的是哪個套件（含底下各層）；null 是整個模型
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [sourceAt, setSourceAt] = useState<{ file: string; line: number } | null>(null);
  const [gateId, setGateId] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({ type: "new", category: "SystemRequirement", parentId: null });
  const [panes, setPanes] = useState(loadPanes);
  const setPane = (p: Partial<Panes>) => setPanes((cur) => { const next = { ...cur, ...p }; savePanes(next); return next; });
  const reload = useCallback(() => api<View>(`/projects/${id}`).then(setView).catch((e) => setError(e.message)), [id]);
  useEffect(() => { reload(); }, [reload]);
  // 流程範本專案在流程走完之前，開啟時直接進入流程
  const [autoMode, setAutoMode] = useState(false);
  useEffect(() => {
    if (!view || autoMode) return;
    setAutoMode(true);
    if (view.project.template === "guided" && view.process.some((s) => s.state !== "done")) setMode("process");
  }, [view, autoMode]);

  // 自訂圖與標註。畫面先更新，稍後一次存檔，避免每打一個字就送出一次
  const [extra, setExtra] = useState<Diagrams>({ custom: [], notes: {} });
  const extraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { api<Diagrams>(`/projects/${id}/diagrams`).then(setExtra).catch(() => {}); }, [id]);
  const saveExtra = useCallback((next: Diagrams) => {
    setExtra(next);
    if (readOnly) return;
    if (extraTimer.current) clearTimeout(extraTimer.current);
    extraTimer.current = setTimeout(() => { api(`/projects/${id}/diagrams`, "PUT", { diagrams: next }).catch((e) => setNotice((e as Error).message)); }, 400);
  }, [id, readOnly]);
  const addDiagram = (title: string) => {
    const did = `custom:${Date.now().toString(36)}`;
    saveExtra({ ...extra, custom: [...extra.custom, { id: did, title: title.trim().slice(0, 60) || "自訂圖", members: [] }] });
    setDiagramId(did); setMode("diagram");
  };
  const diagrams = useMemo(() => (view ? diagramsOf(view.analysis, extra) : []), [view, extra]);
  const tree = useMemo(() => (view ? treeOf(view.analysis) : null), [view]);
  if (error) return <div className="page"><p className="msg"><span className="tag danger">ERR</span>{error}</p><div className="tbtn-row">{id !== baseOf(id) && <button className="tbtn primary" onClick={() => onOpen(baseOf(id))}>回到 main</button>}<button className={`tbtn ${id === baseOf(id) ? "primary" : ""}`} onClick={onHome}>回專案列表</button></div></div>;
  if (!view) return <div className="page"><p className="label">載入模型中</p></div>;

  const def: DiagramDef = diagrams.find((d) => d.id === diagramId) ?? diagrams[0];
  const errors = view.analysis.diagnostics.filter((d) => d.severity === "error");
  const selectedId = sel.type === "element" ? sel.id : null;
  // 新增元素時預設的類別：正在看的套件若是某個類別的套件（例如 Requirements），就用那個類別
  const scopeName = scopeId ? tree?.byId.get(scopeId)?.name : undefined;
  const newCategory = meta.categories.find((c) => c.pkg === scopeName)?.id ?? "SystemRequirement";
  const selectElement = (eid: string | null) => setSel(eid ? { type: "element", id: eid } : { type: "new", category: newCategory, parentId: null });
  /** 從樹上點選：點套件，表就列出它底下的元素；點其他元素，選到它，表列出它所在的套件。 */
  const pick = (e: Element) => {
    if (isPackage(e)) {
      // 正在看圖時，點套件就切到它的套件內容圖（F-76）；其他時候表列出它底下的元素
      if (mode === "diagram") { setScopeId(e.id); setDiagramId(`pkg:${e.qualifiedName}`); return; }
      setScopeId(e.id);
      setSel({ type: "new", category: meta.categories.find((c) => c.pkg === e.name)?.id ?? "SystemRequirement", parentId: null });
      setMode("table");
      return;
    }
    if (tree) setScopeId(packageOf(tree, e.id));
    setSel({ type: "element", id: e.id });
    if (mode !== "diagram" && mode !== "table") setMode("table");
  };
  /** 從流程、節點等別的分頁開啟某個元素：切到表，並讓表列出它所在的套件。 */
  const openElement = (eid: string) => { const e = tree?.byId.get(eid); if (e) { if (tree) setScopeId(packageOf(tree, eid)); setSel({ type: "element", id: eid }); setMode("table"); } };
  const showSide = mode === "diagram" || mode === "table" || mode === "deliver" || mode === "gates";
  const showTree = mode !== "home" && mode !== "process";
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
          <Tree view={view} diagrams={diagrams} onAddDiagram={readOnly ? undefined : addDiagram} mode={mode} diagramId={def.id} scopeId={mode === "table" ? scopeId : null} gateId={gateId} selectedId={selectedId}
            onDiagram={(d) => { setDiagramId(d); setMode("diagram"); }}
            onPick={pick}
            onGate={(g) => { setGateId(g); setMode("gates"); }} />
        </aside>}
        {showTree && <Resizer side="left" open={panes.leftOpen} width={panes.left} onWidth={(w) => setPane({ left: w })} onToggle={() => setPane({ leftOpen: !panes.leftOpen })} />}
        <section className="center">
          {view.branch && <div className="banner"><span className="tag warn">分支</span><span className="body" style={{ flex: 1, maxWidth: "none" }}>正在{readOnly ? "瀏覽" : "編輯"}分支 <b>{view.branch.name}</b>。{readOnly ? "這裡的內容還沒有合併進 main。" : "這裡的修改只存在這個分支，合併後才會進入 main。"}</span><button className="tbtn" onClick={() => onOpen(baseOf(id))}>回到 main</button></div>}
          {view.project.reference && <div className="banner"><span className="tag">參考</span><span className="body" style={{ flex: 1, maxWidth: "none" }}>第三方的參考模型，唯讀、內容未經修改。{view.project.reference.name}，提交 <span className="data">{view.project.reference.commit.slice(0, 7)}</span>，授權 {view.project.reference.license}。</span><a className="tbtn" href={view.project.reference.source} target="_blank" rel="noreferrer">來源</a></div>}
          {view.warning && <div className="banner"><span className="tag danger">ERR</span><span className="body" style={{ maxWidth: "none" }}>{view.warning}</span></div>}
          {errors.length > 0 && mode !== "source" && (
            <div className="banner"><span className="tag danger">ERR</span><span className="body">模型有 {errors.length} 個錯誤，圖表暫時無法更新。</span><button className="tbtn primary" onClick={() => setMode("source")}>到原始碼修正</button></div>
          )}
          {notice && <div className="banner"><span className="tag danger">ERR</span><span className="body" style={{ flex: 1 }}>{notice}</span><button className="tbtn" onClick={() => setNotice("")}>關閉</button></div>}
          {mode === "diagram" && <Diagram readOnly={readOnly} view={view} meta={meta} def={def} extra={extra} onExtra={saveExtra} selectedId={selectedId} onSelectElement={selectElement}
            onSelectEdge={(e) => e && setSel({ type: "edge", edge: e })} onNew={(c, parentId) => setSel({ type: "new", category: c, parentId })}
            onChanged={(v) => { setView(v); setNotice(""); }} onError={setNotice} />}
          {mode === "table" && <div className="center-scroll"><ElementTable view={view} meta={meta} scopeId={scopeId} selectedId={selectedId} onSelect={selectElement} onScope={(sid) => { setScopeId(sid); setSel({ type: "new", category: newCategory, parentId: null }); }} /></div>}
          {mode === "home" && <div className="center-scroll enter"><Dashboard view={view} go={go} /></div>}
          {mode === "process" && <div className="center-scroll"><ProcessView view={view} meta={meta} user={user} onChanged={setView} onOpen={(eid) => openElement(eid)} /></div>}
          {mode === "deliver" && <Deliverables view={view} meta={meta} user={user} tab={deliverTab} setTab={setDeliverTab} selectedId={selectedId} onSelect={(eid) => setSel({ type: "element", id: eid })} onChanged={setView} />}
          {mode === "gates" && <div className="center-scroll"><GatesView user={user} view={view} gateId={gateId ?? view.gates[0]?.id ?? ""} setView={setView} onSelect={(eid) => setSel({ type: "element", id: eid })} /></div>}
          {mode === "plan" && <div className="center-scroll"><PlanView view={view} meta={meta} user={user} /></div>}
          {METHOD_PAGES.filter((p) => mode === `m:${p.id}`).map((p) => <div key={p.id} className="center-scroll"><p.Component view={view} meta={meta} user={user} onChanged={setView} onOpen={(eid) => openElement(eid)} /></div>)}
          {mode === "sim" && <div className="center-scroll"><SimView view={view} user={user} onChanged={setView} /></div>}
          {mode === "source" && <div className="center-scroll" style={{ display: "flex", flexDirection: "column" }}><SourceTab id={id} onSaved={reload} readOnly={readOnly} at={sourceAt} /></div>}
          {mode === "history" && <div className="center-scroll"><VersionsView id={id} user={user} branch={view.branch ?? null} onOpen={onOpen} onChanged={(v) => { setView(v); api<Diagrams>(`/projects/${id}/diagrams`).then(setExtra).catch(() => {}); }} /></div>}
        </section>
        {showSide && <Resizer side="right" open={panes.rightOpen} width={panes.right} onWidth={(w) => setPane({ right: w })} onToggle={() => setPane({ rightOpen: !panes.rightOpen })} />}
        {showSide && <aside className="side right" style={{ width: panes.rightOpen ? panes.right : 0 }} hidden={!panes.rightOpen}><Inspector readOnly={readOnly} view={view} meta={meta} sel={sel} setSel={setSel} onChanged={setView} onSource={(file, line) => { setSourceAt({ file, line }); setMode("source"); }} /></aside>}
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
  view: View; diagrams: DiagramDef[]; mode: Mode; diagramId: string; scopeId: string | null; gateId: string | null; selectedId: string | null;
  onDiagram: (id: string) => void; onAddDiagram?: (title: string) => void; onPick: (e: Element) => void; onGate: (id: string) => void;
}

/** 圖的清單分成幾組，各自可以收合（F-76）。 */
const DIAGRAM_GROUPS: [id: string, zh: string, kinds: DiagramDef["kind"][]][] = [
  ["pkg", "套件內容", ["pkg"]], ["decomp", "分解", ["decomp"]], ["fdecomp", "功能分解", ["fdecomp"]],
  ["req", "需求與使用案例", ["req", "uc"]], ["behavior", "動作與狀態機", ["act", "stm"]], ["ibd", "互連", ["ibd"]], ["occ", "個體與時間切片", ["occ"]], ["calc", "計算與分析", ["calc"]],
  ["custom", "自訂圖", ["custom"]],
];

/** 左側欄：圖、模型樹（依套件，F-74）、節點進度。 */
function Tree({ view, diagrams, onAddDiagram, mode, diagramId, scopeId, gateId, selectedId, onDiagram, onPick, onGate }: TreeProps) {
  const els = view.analysis.elements;
  const [naming, setNaming] = useState(false);
  const finish = (v: string) => { setNaming(false); if (v.trim()) onAddDiagram?.(v); };
  // 圖的清單分組收合；選擇記在瀏覽器裡
  const [open, setOpen] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem("jri.diagramGroups") ?? "{}"); } catch { return {}; } });
  const toggle = (gid: string, v: boolean) => setOpen((cur) => { const next = { ...cur, [gid]: v }; try { localStorage.setItem("jri.diagramGroups", JSON.stringify(next)); } catch { /* 無法儲存時只在本次有效 */ } return next; });
  return (
    <>
      <div className="section">
        <div className="section-head"><h2 className="section-title">圖</h2><span className="label">{diagrams.length}</span></div>
        {DIAGRAM_GROUPS.map(([gid, zh, kinds]) => {
          const list = diagrams.filter((d) => kinds.includes(d.kind));
          if (list.length === 0) return null;
          // 正在看的圖所在的那一組一定展開，其餘依使用者上次的選擇
          const current = mode === "diagram" && list.some((d) => d.id === diagramId);
          const expanded = open[gid] ?? (current || gid === "other" || gid === "custom");
          return (
            <div key={gid} className="diagram-group">
              <button className="tree-row group-row" aria-expanded={expanded} onClick={() => toggle(gid, !expanded)}>
                <span className="tid">{expanded ? "▾" : "▸"}</span><span className="tn">{zh}</span><span className="tc">{list.length}</span>
              </button>
              {expanded && <ul className="tree">{list.map((d) => (
                <li key={d.id}><button className="tree-row" aria-current={mode === "diagram" && d.id === diagramId} onClick={() => onDiagram(d.id)} title={d.id.includes(":") && d.kind !== "custom" ? d.id.slice(d.id.indexOf(":") + 1).replaceAll("::", " › ") || d.title : d.title}>
                  <span className="tid">{d.code}</span><span className="tn">{d.title}</span>
                </button></li>
              ))}</ul>}
            </div>
          );
        })}
        {onAddDiagram && (naming
          ? <input className="input" autoFocus placeholder="圖的名稱，例如：任務總覽" maxLength={60} aria-label="新自訂圖的名稱"
              onKeyDown={(e) => { if (e.key === "Enter") finish((e.target as HTMLInputElement).value); if (e.key === "Escape") setNaming(false); }} onBlur={(e) => finish(e.target.value)} />
          : <button className="tbtn" onClick={() => setNaming(true)} title="自己決定放哪些項目的圖，任何類別都能放在一起">＋ 新增自訂圖</button>)}
      </div>
      <div className="section">
        <div className="section-head"><h2 className="section-title">模型</h2><span className="label">{els.length}</span></div>
        <PackageTree analysis={view.analysis} selectedId={selectedId} scopeId={scopeId} onPick={onPick} />
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
