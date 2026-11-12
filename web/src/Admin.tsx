import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Project } from "./api.ts";

interface Member { login: string; name: string; rank: string; subsystems: string[]; admin: boolean; tailscale?: string }
interface Share { id: string; project: string; label: string; createdBy: string; createdAt: string; expiresAt: string }
interface Cfg { publicUrl: string; clientId: string; hasSecret: boolean }

const blank: Member = { login: "", name: "", rank: "C-II", subsystems: [], admin: false };

/** 管理頁：成員與職級、唯讀連結、GitHub 登入設定。 */
export function Admin() {
  const [members, setMembers] = useState<Member[]>([]);
  const [ranks, setRanks] = useState<{ id: string; zh: string }[]>([]);
  const [shares, setShares] = useState<Share[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cfg, setCfg] = useState<Cfg>({ publicUrl: "", clientId: "", hasSecret: false });
  const [secret, setSecret] = useState("");
  const [form, setForm] = useState<Member>(blank);
  const [share, setShare] = useState({ project: "", label: "", days: "14" });
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  useEffect(() => {
    run(async () => {
      const m = await api<{ members: Member[]; ranks: { id: string; zh: string }[] }>("/admin/members");
      setMembers(m.members); setRanks(m.ranks);
      setShares((await api<{ shares: Share[] }>("/admin/shares")).shares);
      const ps = await api<Project[]>("/projects");
      setProjects(ps); setShare((s) => ({ ...s, project: ps[0]?.id ?? "" }));
      setCfg(await api<Cfg>("/admin/config"));
    });
  }, []);

  const saveMember = (ev: FormEvent) => { ev.preventDefault(); run(async () => { setMembers((await api<{ members: Member[] }>("/admin/members", "POST", { ...form })).members); setForm(blank); }, "已儲存成員。"); };
  const makeShare = (ev: FormEvent) => {
    ev.preventDefault();
    run(async () => {
      const r = await api<{ path: string; publicUrl: string; share: Share }>("/admin/shares", "POST", { project: share.project, label: share.label, days: Number(share.days) });
      setLink(`${r.publicUrl || location.origin}${r.path}`);
      setShares((s) => [...s, r.share]);
    });
  };
  const saveCfg = (ev: FormEvent) => { ev.preventDefault(); run(async () => { await api("/admin/config", "POST", { publicUrl: cfg.publicUrl, clientId: cfg.clientId, clientSecret: secret }); setSecret(""); setCfg(await api<Cfg>("/admin/config")); }, "已儲存登入設定。"); };
  const rankZh = (id: string) => ranks.find((r) => r.id === id)?.zh ?? id;
  const callback = `${cfg.publicUrl || "（先填公開網址）"}/auth/github/callback`;

  return (
    <main className="page" style={{ width: "100%" }}>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}

      <section className="section">
        <div className="section-head"><h1 className="section-title">成員</h1><span className="label">{members.length}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>只有名單上的 GitHub 帳號能登入。職級決定能做什麼：組員可編輯模型，責任工程師以上可做人工確認，簽核依 AEAS 規定的職級。</p>
        {members.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>GitHub 帳號</th><th>姓名</th><th>職級</th><th>次系統</th><th>管理員</th><th></th></tr></thead>
            <tbody>{members.map((m) => (
              <tr key={m.login}>
                <td className="id">{m.login}</td><td>{m.name}</td><td>{rankZh(m.rank)} <span className="faint">[{m.rank}]</span></td><td>{m.subsystems.join("、") || "—"}</td><td>{m.admin ? "是" : "—"}</td>
                <td><div className="tbtn-row"><button className="tbtn" onClick={() => setForm({ ...m })}>修改</button><button className="tbtn" onClick={() => run(async () => setMembers((await api<{ members: Member[] }>("/admin/members/delete", "POST", { login: m.login })).members))}>移除</button></div></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <form onSubmit={saveMember}>
          <div className="row">
            <label className="field"><span className="label">GitHub 帳號</span><input className="input" required value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} /></label>
            <label className="field"><span className="label">姓名</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="field"><span className="label">職級</span><select className="input" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value })}>{ranks.map((r) => <option key={r.id} value={r.id}>{r.zh} [{r.id}]</option>)}</select></label>
            <label className="field"><span className="label">次系統（用頓號分隔）</span><input className="input" value={form.subsystems.join("、")} onChange={(e) => setForm({ ...form, subsystems: e.target.value.split(/[、,，]/) })} /></label>
          </div>
          <div className="tbtn-row"><label className="check"><input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} /><span className="caption">管理員（可管理成員與連結）</span></label>
            <button className="tbtn primary">儲存成員</button></div>
        </form>
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
        <div className="section-head"><h2 className="section-title">GitHub 登入</h2><span className="label">{cfg.clientId && cfg.hasSecret && cfg.publicUrl ? "已設定" : "未設定"}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>成員從公開網址登入時使用。到 GitHub → Settings → Developer settings → OAuth Apps 建立一個 App，Authorization callback URL 填下面那一行，再把 Client ID 與 Client secret 貼到這裡。</p>
        <p className="caption" style={{ marginBottom: 12 }}>Callback URL　<span className="data">{callback}</span></p>
        <form onSubmit={saveCfg}>
          <div className="row">
            <label className="field"><span className="label">公開網址</span><input className="input" value={cfg.publicUrl} onChange={(e) => setCfg({ ...cfg, publicUrl: e.target.value })} placeholder="https://…ts.net:8443" /></label>
            <label className="field"><span className="label">Client ID</span><input className="input" value={cfg.clientId} onChange={(e) => setCfg({ ...cfg, clientId: e.target.value })} /></label>
            <label className="field"><span className="label">Client secret{cfg.hasSecret ? "（已儲存，留空不變）" : ""}</span><input className="input" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></label>
          </div>
          <button className="tbtn primary">儲存設定</button>
        </form>
      </section>
    </main>
  );
}
