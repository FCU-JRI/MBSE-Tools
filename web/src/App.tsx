import { useCallback, useEffect, useState } from "react";
import { api, baseOf, getAuthor, setAuthor } from "./api.ts";
import type { Me, Meta, MeResponse, View } from "./api.ts";
import { Admin } from "./Admin.tsx";
import type { Selection } from "./Inspector.tsx";
import { PAGES } from "./workspace.ts";
import type { Page, PageProps, Spot, TableGroup } from "./workspace.ts";
import { Login, Welcome } from "./pages/Login.tsx";
import { ProjectsPage } from "./pages/Projects.tsx";
import { HomePage } from "./pages/Home.tsx";
import { ProcessPage } from "./pages/Process.tsx";
import { ModelPage } from "./pages/Model.tsx";
import { TablesPage } from "./pages/Tables.tsx";
import { AnalysisPage } from "./pages/Analysis.tsx";
import { ManagePage } from "./pages/Manage.tsx";
import { VersionsPage } from "./pages/Versions.tsx";

// 這個檔只負責導覽：登入、專案列表與專案工作區之間的切換，以及工作區上方的分頁列。各頁內容在 pages/*.tsx。

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
  if (!me.user) return <Login google={me.googleLogin} github={me.githubLogin} />;
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
      {page === "admin" && user.caps.admin ? <Admin /> : <ProjectsPage meta={meta} user={user} onOpen={open} />}
    </div>
  );
}

// 記住上次開啟的專案與是否已看過歡迎畫面；讀不到就當作沒有
function lastProject(): string | null { try { return localStorage.getItem("jri.last"); } catch { return null; } }
function rememberProject(id: string | null): void { try { if (id) localStorage.setItem("jri.last", id); else localStorage.removeItem("jri.last"); } catch { /* 無法儲存時略過 */ } }
function seenWelcome(): boolean { try { return sessionStorage.getItem("jri.welcome") === "1"; } catch { return true; } }
function markWelcome(): void { try { sessionStorage.setItem("jri.welcome", "1"); } catch { /* 略過 */ } }

/** 每一頁的元件。 */
const VIEWS: Record<Page, (p: PageProps) => React.ReactNode> = {
  home: HomePage, process: ProcessPage, model: ModelPage, tables: TablesPage, analysis: AnalysisPage, manage: ManagePage, versions: VersionsPage,
};

/** id 是專案參照：main 或某個分支。分支和 main 用同一個畫面，所有分頁都能看、能改（F-33）。 */
function Workspace({ id, meta, user, onHome, onOpen, who }: { id: string; meta: Meta; user: Me; onHome: () => void; onOpen: (ref: string) => void; who: React.ReactNode }) {
  const readOnly = !user.caps.edit;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState<Page>("home");
  const [sel, setSel] = useState<Selection | null>(null);
  const [spot, setSpotState] = useState<Spot>({ diagramId: "bdd", table: "req", gateId: null, source: false });
  const setSpot = useCallback((s: Partial<Spot>) => setSpotState((cur) => ({ ...cur, ...s })), []);
  const reload = useCallback(() => api<View>(`/projects/${id}`).then(setView).catch((e) => setError(e.message)), [id]);
  useEffect(() => { reload(); }, [reload]);

  if (error) return <div className="page"><p className="msg"><span className="tag danger">ERR</span>{error}</p><div className="tbtn-row">{id !== baseOf(id) && <button className="tbtn primary" onClick={() => onOpen(baseOf(id))}>回到 main</button>}<button className={`tbtn ${id === baseOf(id) ? "primary" : ""}`} onClick={onHome}>回專案列表</button></div></div>;
  if (!view) return <div className="page"><p className="label">載入模型中</p></div>;

  const errors = view.analysis.diagnostics.filter((d) => d.severity === "error");
  const go = (to: Page, arg?: string) => {
    if (to === "manage" && arg) setSpot({ gateId: arg });
    if (to === "tables" && arg) setSpot({ table: arg as TableGroup });
    if (to === "model" && arg === "source") setSpot({ source: true });
    // 只有模型、表格、專案管理頁有右欄；換到其他頁時清掉選取
    if (to !== "model" && to !== "tables" && to !== "manage") setSel(null);
    setPage(to);
  };
  // 點上方分頁是換一件事做，右欄的選取不帶過去；頁內的「在模型中開啟」等跳轉才保留選取
  const switchTab = (to: Page) => { setSel(null); go(to); };
  const props: PageProps = { id, view, meta, user, readOnly, setView, reload, onNotice: setNotice, sel, setSel, spot, setSpot, go, onOpenRef: onOpen };
  const Current = VIEWS[page];

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={onHome}>JRI MBSE</button>
        {readOnly && <span className="tag">唯讀</span>}
        <span className="label crumb">{view.project.name}</span>
        <nav className="seg" role="tablist">{PAGES.map(([m, zh]) => <button key={m} role="tab" aria-selected={page === m} onClick={() => switchTab(m)}>{zh}</button>)}</nav>
        <span className="grow" />
        <VersionButton id={id} view={view} active={page === "versions"} onClick={() => switchTab("versions")} />
        {who}
      </header>
      <div className="ws-main">
        {view.branch && <div className="banner"><span className="tag warn">分支</span><span className="body" style={{ flex: 1, maxWidth: "none" }}>正在{readOnly ? "瀏覽" : "編輯"}分支 <b>{view.branch.name}</b>。{readOnly ? "這裡的內容還沒有合併進 main。" : "這裡的修改只存在這個分支，合併後才會進入 main。"}</span><button className="tbtn" onClick={() => onOpen(baseOf(id))}>回到 main</button></div>}
        {view.warning && <div className="banner"><span className="tag danger">ERR</span><span className="body" style={{ maxWidth: "none" }}>{view.warning}</span></div>}
        {errors.length > 0 && !(page === "model" && spot.source) && (
          <div className="banner"><span className="tag danger">ERR</span><span className="body">模型有 {errors.length} 個錯誤，圖表暫時無法更新。</span><button className="tbtn primary" onClick={() => go("model", "source")}>到原始碼修正</button></div>
        )}
        {notice && <div className="banner"><span className="tag danger">ERR</span><span className="body" style={{ flex: 1 }}>{notice}</span><button className="tbtn" onClick={() => setNotice("")}>關閉</button></div>}
        <Current {...props} />
      </div>
    </div>
  );
}

/**
 * 右上的版本按鈕。「未送審」的定義：
 *  - 在分支上：這個分支相對 main 的變更項數（新增＋修改＋移除的模型元素），0 顯示「沒有改動」。
 *  - 在 main 上：送審中的分支數（有領先 main 提交的分支）。
 * 點開是版本畫面（修改 → 送審 → 核准）。
 */
function VersionButton({ id, view, active, onClick }: { id: string; view: View; active: boolean; onClick: () => void }) {
  const [count, setCount] = useState<number | null>(null);
  const bname = view.branch?.name, bahead = view.branch?.ahead;
  useEffect(() => {
    setCount(null);
    const q = bname
      ? api<{ changes: unknown[] }>(`/projects/${id}/branches/diff?name=${encodeURIComponent(bname)}`).then((d) => d.changes.length)
      : api<{ ahead: number }[]>(`/projects/${id}/branches`).then((b) => b.filter((x) => x.ahead > 0).length);
    q.then(setCount).catch(() => setCount(null));
  }, [id, bname, bahead]);
  const note = count === null ? "" : bname ? (count === 0 ? " · 沒有改動" : ` · ${count} 項未送審`) : ` · ${count} 個送審中`;
  return <button className="tbtn version-btn" aria-pressed={active} onClick={onClick} title="版本：修改 → 送審 → 核准合併">{bname ?? "main"}{note} ▾</button>;
}
