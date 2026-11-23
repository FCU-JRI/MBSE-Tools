import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Project } from "./api.ts";

interface Member { email: string; github?: string; name: string; rank: string; subsystems: string[]; admin: boolean; tailscale?: string }
interface JoinRequest { email: string; name: string; requestedAt: string }
interface BatchRow { line: number; text: string; status: "add" | "exists" | "error"; reason?: string; member?: Member }
/** previous：修改前的主鍵（email，舊資料則是 GitHub 帳號），改 email 時用來換掉舊的那筆 */
type MemberForm = Member & { previous?: string };
interface Share { id: string; project: string; label: string; createdBy: string; createdAt: string; expiresAt: string }
interface AutoRepo { enabled: boolean; owner: string; visibility: "public" | "private" }
interface Cfg { publicUrl: string; clientId: string; hasSecret: boolean; google: { clientId: string; hasSecret: boolean }; autoRepo: AutoRepo }

const blank: MemberForm = { email: "", github: "", name: "", rank: "C-II", subsystems: [], admin: false };

/** 管理頁：成員與職級、加入申請、唯讀連結、登入設定（Google，GitHub 為第二選項）。 */
export function Admin() {
  const [members, setMembers] = useState<Member[]>([]);
  const [ranks, setRanks] = useState<{ id: string; zh: string }[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [cfg, setCfg] = useState<Cfg>({ publicUrl: "", clientId: "", hasSecret: false, google: { clientId: "", hasSecret: false }, autoRepo: { enabled: false, owner: "", visibility: "public" } });
  const [secret, setSecret] = useState("");
  const [googleSecret, setGoogleSecret] = useState("");
  const [form, setForm] = useState<MemberForm>(blank);
  const [batch, setBatch] = useState({ text: "", rank: "C-II" });
  const [preview, setPreview] = useState<BatchRow[] | null>(null);
  const [share, setShare] = useState({ project: "", label: "", days: "14" });
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sharedFiles, setSharedFiles] = useState<{ file: string; content: string }[]>([]);
  const [lib, setLib] = useState({ file: "shared-avionics.sysml", content: "" });

  const run = async (fn: () => Promise<void>, done?: string) => {
    setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  useEffect(() => {
    run(async () => {
      const m = await api<{ members: Member[]; ranks: { id: string; zh: string }[] }>("/admin/members");
      setMembers(m.members); setRanks(m.ranks);
      setRequests((await api<{ requests: JoinRequest[] }>("/admin/requests")).requests);
      setShares((await api<{ shares: Share[] }>("/admin/shares")).shares);
      const ps = await api<Project[]>("/projects");
      setProjects(ps); setShare((s) => ({ ...s, project: ps[0]?.id ?? "" }));
      setCfg(await api<Cfg>("/admin/config"));
      const sh = (await api<{ files: { file: string; content: string }[] }>("/shared")).files;
      setSharedFiles(sh);
      if (sh[0]) setLib(sh[0]);
      else setLib({ file: "shared-avionics.sysml", content: "package SharedAvionics {\n    private import JRI::*;\n\n    // 例：part def <'AVX-001'> '飛行電腦' :> Component;\n}\n" });
    });
  }, []);

  const saveMember = (ev: FormEvent) => { ev.preventDefault(); run(async () => {
    setMembers((await api<{ members: Member[] }>("/admin/members", "POST", { ...form })).members); setForm(blank);
    setRequests((await api<{ requests: JoinRequest[] }>("/admin/requests")).requests); // 核准後申請會自動消失
  }, "已儲存成員。"); };
  // 批次加入：先預覽每一行的結果，確認後才寫入；有任何一行不對就整批不寫入
  const previewBatch = (ev: FormEvent) => { ev.preventDefault(); run(async () => setPreview((await api<{ rows: BatchRow[] }>("/admin/members/batch", "POST", { ...batch, dryRun: true })).rows)); };
  const applyBatch = () => run(async () => {
    const r = await api<{ rows: BatchRow[]; added: number; members: Member[] }>("/admin/members/batch", "POST", { ...batch, dryRun: false });
    setMembers(r.members);
    if (r.added > 0) { setPreview(null); setBatch({ ...batch, text: "" }); setRequests((await api<{ requests: JoinRequest[] }>("/admin/requests")).requests); }
    else setPreview(r.rows);
  }, "已批次加入成員。");
  const dismissRequest = (email: string) => run(async () => setRequests((await api<{ requests: JoinRequest[] }>("/admin/requests/delete", "POST", { email })).requests));
  const makeShare = (ev: FormEvent) => {
    ev.preventDefault();
    run(async () => {
      const r = await api<{ path: string; publicUrl: string; share: Share }>("/admin/shares", "POST", { project: share.project, label: share.label, days: Number(share.days) });
      setLink(`${r.publicUrl || location.origin}${r.path}`);
      setShares((s) => [...s, r.share]);
    });
  };
  const saveCfg = (ev: FormEvent) => { ev.preventDefault(); run(async () => { await api("/admin/config", "POST", { publicUrl: cfg.publicUrl, googleClientId: cfg.google.clientId, googleClientSecret: googleSecret, clientId: cfg.clientId, clientSecret: secret }); setSecret(""); setGoogleSecret(""); setCfg(await api<Cfg>("/admin/config")); }, "已儲存登入設定。"); };
  const saveLib = (ev: FormEvent) => { ev.preventDefault(); run(async () => {
    await api(`/shared/${encodeURIComponent(lib.file)}`, "PUT", { content: lib.content });
    setSharedFiles((await api<{ files: { file: string; content: string }[] }>("/shared")).files);
  }, "已儲存共用元件庫。所有專案立即可用。"); };
  const rankZh = (id: string) => ranks.find((r) => r.id === id)?.zh ?? id;
  const repo = cfg.autoRepo;
  const setRepo = (patch: Partial<AutoRepo>) => setCfg({ ...cfg, autoRepo: { ...repo, ...patch } });
  const saveRepo = (ev: FormEvent) => { ev.preventDefault(); run(async () => { await api("/admin/config", "POST", { autoRepo: repo }); setCfg(await api<Cfg>("/admin/config")); }, "已儲存儲存庫設定。"); };
  const base = cfg.publicUrl || "（先填公開網址）";
  const googleReady = !!(cfg.google.clientId && cfg.google.hasSecret && cfg.publicUrl), githubReady = !!(cfg.clientId && cfg.hasSecret && cfg.publicUrl);

  return (
    <main className="page" style={{ width: "100%" }}>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}

      <section className="section">
        <div className="section-head"><h1 className="section-title">成員</h1><span className="label">{members.length}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>只有名單上的 Google 帳號（email）能從公開網址登入；有填 GitHub 帳號的成員也可以改用 GitHub 登入。職級決定能做什麼：組員可編輯模型，責任工程師以上可做人工確認，簽核依 AEAS 規定的職級。</p>
        {members.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Google email</th><th>GitHub 帳號</th><th>姓名</th><th>職級</th><th>次系統</th><th>管理員</th><th></th></tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.email || `github:${m.github}`}>
                <td className="id">{m.email || <span className="tag">待補</span>}</td><td className="id">{m.github || "—"}</td><td>{m.name}</td><td>{rankZh(m.rank)} <span className="faint">[{m.rank}]</span></td><td>{m.subsystems.join("、") || "—"}</td><td>{m.admin ? "是" : "—"}</td>
                <td><div className="tbtn-row"><button className="tbtn" onClick={() => setForm({ ...m, github: m.github ?? "", previous: m.email || m.github })}>修改</button><button className="tbtn" onClick={() => run(async () => setMembers((await api<{ members: Member[] }>("/admin/members/delete", "POST", m.email ? { email: m.email } : { login: m.github })).members))}>移除</button></div></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {requests.length > 0 && (<>
          <h3 className="label" style={{ margin: "8px 0" }}>加入申請（{requests.length}）</h3>
          <p className="caption" style={{ marginBottom: 8 }}>名單外的人用 Google 登入後會出現在這裡。按「核准」帶入下方表單，設定職級後儲存即加入；不認識的就按「忽略」。</p>
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>Google email</th><th>Google 上的名字</th><th>申請時間</th><th></th></tr></thead>
            <tbody>{requests.map((r) => (
              <tr key={r.email}><td className="id">{r.email}</td><td>{r.name || "—"}</td><td className="id">{new Date(r.requestedAt).toLocaleString("zh-TW")}</td>
                <td><div className="tbtn-row"><button className="tbtn" onClick={() => setForm({ ...blank, email: r.email, name: r.name })}>核准</button><button className="tbtn" onClick={() => dismissRequest(r.email)}>忽略</button></div></td></tr>
            ))}</tbody>
          </table>
        </>)}
        <form onSubmit={saveMember}>
          <div className="row">
            <label className="field"><span className="label">Google email</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span className="label">GitHub 帳號（選填）</span><input className="input" value={form.github ?? ""} onChange={(e) => setForm({ ...form, github: e.target.value })} /></label>
            <label className="field"><span className="label">姓名</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span className="label">職級</span><select className="input" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })}>{ranks.map((r) => <option key={r.id} value={r.id}>{r.zh} [{r.id}]</option>)}</select></label>
            <label className="field"><span className="label">次系統（用頓號分隔）</span><input className="input" value={form.subsystems.join("、")} onChange={(e) => setForm({ ...form, subsystems: e.target.value.split(/[、,，]/) })} /></label>
          </div>
          <div className="tbtn-row"><label className="check"><input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} /><span className="caption">管理員（可管理成員與連結）</span></label>
            <button className="tbtn primary">儲存成員</button></div>
        </form>

        <h3 className="label" style={{ margin: "20px 0 8px" }}>批次加入</h3>
        <p className="body muted" style={{ marginBottom: 8 }}>一行一位：email、姓名、職級、次系統、GitHub 帳號，用逗號或 Tab 分隔，可以直接從試算表複製。只有 email 必填；職級空白時用下面的預設職級，次系統之間用頓號。已在名單的人不會被改動。批次加入的人都不是管理員，總工程師以上的職級請用上面的表單一個一個加。</p>
        <form onSubmit={previewBatch}>
          <textarea className="input" rows={6} style={{ width: "100%", fontFamily: "var(--mono, monospace)" }} placeholder={"a@example.com, 王小明, C-III, 結構、航電\nb@example.com, 李小華"} value={batch.text} onChange={(e) => { setBatch({ ...batch, text: e.target.value }); setPreview(null); }} />
          <div className="tbtn-row" style={{ marginTop: 8 }}>
            <label className="field"><span className="label">預設職級</span><select className="input" value={batch.rank} onChange={(e) => { setBatch({ ...batch, rank: e.target.value }); setPreview(null); }}>{ranks.filter((r) => !["F-VIII", "R-VIII", "D-VII"].includes(r.id)).map((r) => <option key={r.id} value={r.id}>{r.zh} [{r.id}]</option>)}</select></label>
            <button className="tbtn">預覽</button>
          </div>
        </form>
        {preview && (() => {
          const adds = preview.filter((r) => r.status === "add").length, errs = preview.filter((r) => r.status === "error").length;
          return <>
            <table style={{ margin: "12px 0" }}>
              <thead><tr><th>行</th><th>結果</th><th>email</th><th>姓名</th><th>職級</th><th>次系統</th><th>GitHub</th></tr></thead>
              <tbody>{preview.map((r) => (
                <tr key={r.line}><td className="id">{r.line}</td>
                  <td>{r.status === "add" ? "加入" : r.status === "exists" ? <span className="faint">已在名單，不改</span> : <span className="tag">{r.reason}</span>}</td>
                  {r.member ? <><td className="id">{r.member.email}</td><td>{r.member.name}</td><td>{rankZh(r.member.rank)} <span className="faint">[{r.member.rank}]</span></td><td>{r.member.subsystems.join("、") || "—"}</td><td className="id">{r.member.github || "—"}</td></>
                    : <td colSpan={5} className="id faint">{r.text}</td>}
                </tr>))}</tbody>
            </table>
            <div className="tbtn-row">
              {errs > 0 ? <span className="caption">有 {errs} 行要修正，修正後重新預覽才能加入。</span>
                : adds > 0 ? <button className="tbtn primary" onClick={applyBatch}>加入 {adds} 位成員</button>
                : <span className="caption">沒有要加入的人。</span>}
            </div>
          </>;
        })()}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">唯讀連結</h2><span className="label">{shares.length}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>給外部審查委員用。拿到連結的人不需註冊，可以瀏覽指定專案的全部內容並匯出，但不能修改。到期自動失效，也可以隨時撤銷。</p>
        {shares.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>對象</th><th>專案</th><th>建立者</th><th>到期</th><th></th></tr></thead>
            <tbody>{shares.map((s) => {
              const expired = new Date(s.expiresAt).getTime() < Date.now();
              return <tr key={s.id}><td>{s.label || "—"}</td><td className="id">{s.project}</td><td>{s.createdBy}</td><td className="id">{new Date(s.expiresAt).toLocaleDateString("zh-TW")} {expired && <span className="tag">已過期</span>}</td>
                <td><button className="tbtn" onClick={() => run(async () => setShares((await api<{ shares: Share[] }>("/admin/shares/delete", "POST", { id: s.id })).shares))}>撤銷</button></td></tr>;
            })}</tbody>
          </table>
        )}
        <form onSubmit={makeShare}>
          <div className="row">
            <label className="field"><span className="label">專案</span><select className="input" required value={share.project} onChange={(e) => setShare({ ...share, project: e.target.value })}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="field"><span className="label">對象（例：CDR 審查委員）</span><input className="input" value={share.label} onChange={(e) => setShare({ ...share, label: e.target.value })} /></label>
            <label className="field" style={{ flex: "0 0 6rem" }}><span className="label">有效天數</span><input className="input" inputMode="numeric" value={share.days} onChange={(e) => setShare({ ...share, days: e.target.value })} /></label>
          </div>
          <button className="tbtn primary" disabled={!share.project}>建立連結</button>
        </form>
        {link && <div style={{ marginTop: 12 }}><p className="caption">連結只顯示這一次，請現在複製：</p><input className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="唯讀連結" /></div>}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">共用元件庫</h2><span className="label">{sharedFiles.length}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>跨專案共用的元件（例如航電）。這裡定義的元件每個專案都看得到、可以放進自己的結構，但只能在這裡修改。以 SysML v2 撰寫，有錯誤不會儲存。</p>
        <form onSubmit={saveLib}>
          <div className="row">
            {sharedFiles.length > 0 && <label className="field" style={{ flex: "0 0 14rem" }}><span className="label">開啟</span>
              <select className="input" value={lib.file} onChange={(e) => { const f = sharedFiles.find((x) => x.file === e.target.value); if (f) setLib(f); }}>{sharedFiles.map((f) => <option key={f.file}>{f.file}</option>)}</select></label>}
            <label className="field"><span className="label">檔名（shared-名稱.sysml）</span><input className="input" required value={lib.file} onChange={(e) => setLib({ ...lib, file: e.target.value })} /></label>
          </div>
          <textarea className="code" style={{ minHeight: 220 }} spellCheck={false} value={lib.content} onChange={(e) => setLib({ ...lib, content: e.target.value })} aria-label="共用元件庫原始碼" />
          <div><button className="tbtn primary">儲存共用元件庫</button></div>
        </form>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">登入設定</h2><span className="label">Google {googleReady ? "已設定" : "未設定"} · GitHub {githubReady ? "已設定" : "未設定"}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>成員從公開網址登入時使用。Google 為主要登入方式：到 Google Cloud Console → API 和服務 → 憑證，建立「OAuth 用戶端 ID」（網頁應用程式），「已授權的重新導向 URI」填下面 Google 那一行。GitHub 為第二選項，可不設定：到 GitHub → Settings → Developer settings → OAuth Apps 建立 App，Authorization callback URL 填 GitHub 那一行。Client secret 只存在這台電腦。</p>
        <p className="caption">Google 重新導向 URI　<span className="data">{base}/auth/google/callback</span></p>
        <p className="caption" style={{ marginBottom: 12 }}>GitHub callback URL　<span className="data">{base}/auth/github/callback</span></p>
        <form onSubmit={saveCfg}>
          <div className="row">
            <label className="field"><span className="label">公開網址</span><input className="input" value={cfg.publicUrl} onChange={(e) => setCfg({ ...cfg, publicUrl: e.target.value })} placeholder="https://…ts.net:8443" /></label>
          </div>
          <div className="row">
            <label className="field"><span className="label">Google Client ID</span><input className="input" value={cfg.google.clientId} onChange={(e) => setCfg({ ...cfg, google: { ...cfg.google, clientId: e.target.value } })} /></label>
            <label className="field"><span className="label">Google Client secret{cfg.google.hasSecret ? "（已儲存，留空不變）" : ""}</span><input className="input" type="password" autoComplete="off" value={googleSecret} onChange={(e) => setGoogleSecret(e.target.value)} /></label>
          </div>
          <div className="row">
            <label className="field"><span className="label">GitHub Client ID（選填）</span><input className="input" value={cfg.clientId} onChange={(e) => setCfg({ ...cfg, clientId: e.target.value })} /></label>
            <label className="field"><span className="label">GitHub Client secret{cfg.hasSecret ? "（已儲存，留空不變）" : ""}</span><input className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
          </div>
          <button className="tbtn primary">儲存設定</button>
        </form>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">專案儲存庫</h2><span className="label">{repo.enabled ? "自動建立" : "手動"}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>開啟後，新增專案時會在 GitHub 的擁有者底下建立同名儲存庫（github.com/擁有者/專案代號），並設為推送目標。需要這台電腦上執行網站的帳號先用 <span className="data">gh auth login</span> 登入該擁有者，並執行 <span className="data">gh auth setup-git</span>。建立失敗不影響專案，錯誤會顯示在專案的「版本」頁。</p>
        <form onSubmit={saveRepo}>
          <div className="row">
            <label className="field"><span className="label">GitHub 擁有者</span><input className="input" value={repo.owner} onChange={(e) => setRepo({ owner: e.target.value })} placeholder="FCU-JRI" /></label>
            <label className="field" style={{ flex: "0 0 10rem" }}><span className="label">可見性</span><select className="input" value={repo.visibility} onChange={(e) => setRepo({ visibility: e.target.value === "private" ? "private" : "public" })}><option value="public">公開</option><option value="private">私人</option></select></label>
          </div>
          <div className="tbtn-row"><label className="check"><input type="checkbox" checked={repo.enabled} onChange={(e) => setRepo({ enabled: e.target.checked })} /><span className="caption">新增專案時自動建立儲存庫</span></label>
            <button className="tbtn primary">儲存設定</button></div>
        </form>
      </section>
    </main>
  );
}
