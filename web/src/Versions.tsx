import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";
import type { Me, View } from "./api.ts";
import { HistoryView } from "./Views.tsx";

interface Sync { remote: string; lastPushAt: string | null; error: string | null; pushing: boolean }
interface Branch { name: string; remote: boolean; ahead: number; behind: number; author: string; date: string; subject: string; ok: boolean; errors: number; firstError: string }
interface Change { type: "added" | "removed" | "changed"; key: string; name: string; category: string | null; fields: { field: string; from: string; to: string }[] }
interface Baseline { ref: string; label: string; date: string; commit: string }

const TYPE_ZH = { added: "新增", removed: "移除", changed: "修改" } as const;
const when = (s: string) => new Date(s).toLocaleString("zh-TW", { hour12: false });

function Changes({ list }: { list: Change[] }) {
  if (list.length === 0) return <p className="caption">模型元素沒有差異。</p>;
  return (
    <table>
      <thead><tr><th>變更</th><th>編號</th><th>名稱</th><th>內容</th></tr></thead>
      <tbody>{list.map((c) => (
        <tr key={c.type + c.key}>
          <td><span className={`tag ${c.type === "added" ? "done" : ""}`}>{TYPE_ZH[c.type]}</span></td><td className="id">{c.key.includes("::") ? "—" : c.key}</td><td>{c.name}</td>
          <td>{c.fields.map((f, i) => <div key={i}><span className="faint">{f.field}　</span><span className="muted" style={{ textDecoration: "line-through" }}>{f.from || "（空）"}</span>　→　{f.to || "（空）"}</div>)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** 版本頁：GitHub 同步、分支審查與合併、基線比較、修改紀錄。 */
export function VersionsView({ id, user, onChanged }: { id: string; user: Me; onChanged: (v: View) => void }) {
  const [sync, setSync] = useState<Sync | null>(null);
  const [url, setUrl] = useState("");
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [open, setOpen] = useState<{ name: string; diff: string; changes: Change[] } | null>(null);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [cmp, setCmp] = useState({ from: "", to: "HEAD" });
  const [result, setResult] = useState<Change[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);

  const run = async (fn: () => Promise<void>, done?: string) => {
    setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const load = useCallback(() => run(async () => {
    const s = await api<Sync>(`/projects/${id}/sync`); setSync(s); setUrl(s.remote);
    const b = await api<Baseline[]>(`/projects/${id}/baselines`); setBaselines(b); setCmp((c) => ({ from: c.from || b[1]?.ref || "", to: c.to }));
    setBranches(await api<Branch[]>(`/projects/${id}/branches`));
  }), [id]);
  useEffect(() => { load(); }, [load]);

  const merge = (name: string) => run(async () => { onChanged(await api<View>(`/projects/${id}/branches/merge`, "POST", { name })); setOpen(null); await load(); setTick((t) => t + 1); }, `已合併 ${name}。`);

  return (
    <>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
      <section className="section">
        <div className="section-head"><h1 className="section-title">GitHub 同步</h1><span className="label">{!sync?.remote ? "未設定" : sync.pushing ? "推送中" : sync.error ? "ERR" : "已同步"}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>設定後，每次儲存都會自動推送到這個儲存庫。儲存庫要先在 GitHub 的 FCU-JRI 組織下建立（空的即可）。</p>
        {sync?.error && <p className="msg"><span className="tag danger">ERR</span>推送失敗：{sync.error}</p>}
        {sync?.lastPushAt && <p className="caption" style={{ marginBottom: 8 }}>上次推送　{when(sync.lastPushAt)}</p>}
        {user.caps.admin ? (
          <div className="row">
            <label className="field"><span className="label">儲存庫網址</span><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/FCU-JRI/專案代號" /></label>
            <div className="tbtn-row" style={{ marginBottom: 12 }}><button className="tbtn primary" onClick={() => run(async () => setSync(await api<Sync>(`/projects/${id}/remote`, "POST", { url })), "已儲存，開始推送。")}>儲存</button></div>
          </div>
        ) : <p className="caption">{sync?.remote || "尚未設定儲存庫。"}</p>}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">分支審查</h2><span className="label">{branches?.length ?? "…"}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>成員在自己的分支上修改（可以用自己的 Claude），推送後出現在這裡。工具會先檢查模型能不能解析，再由責任工程師以上審查合併。</p>
        {branches === null ? <p className="label">讀取中</p> : branches.length === 0 ? <p className="caption">目前沒有待審查的分支。</p> : (
          <table>
            <thead><tr><th>分支</th><th>作者</th><th>最後修改</th><th>提交</th><th>檢查</th><th></th></tr></thead>
            <tbody>{branches.map((b) => (
              <tr key={b.name}>
                <td className="id">{b.name}</td><td>{b.author}</td><td className="id">{when(b.date)}</td><td>{b.ahead} 筆<div className="caption">{b.subject}</div></td>
                <td>{b.ok ? <span className="tag done">PASS</span> : <><span className="tag danger">ERR</span><div className="caption">{b.firstError}</div></>}</td>
                <td><div className="tbtn-row">
                  <button className="tbtn" onClick={() => run(async () => setOpen({ name: b.name, ...(await api<{ diff: string; changes: Change[] }>(`/projects/${id}/branches/diff?name=${encodeURIComponent(b.name)}`)) }))}>看差異</button>
                  {user.caps.merge && b.ok && <button className="tbtn primary" onClick={() => merge(b.name)}>合併</button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {open && (
          <div style={{ marginTop: 16 }}>
            <div className="section-head"><h3 className="section-title">{open.name} 的變更</h3><button className="tbtn" onClick={() => setOpen(null)}>關閉</button></div>
            <Changes list={open.changes} />
            <pre className="code" style={{ maxHeight: 320, marginTop: 12 }}>{open.diff || "（沒有文字差異）"}</pre>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">基線比較</h2><span className="label">{Math.max(baselines.length - 1, 0)} 個基線</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>每次節點核可都會留下一個基線。選兩個版本，看這段期間模型改了什麼。</p>
        {baselines.length < 2 ? <p className="caption">還沒有基線。節點核可後才會出現。</p> : (
          <>
            <div className="row">
              <label className="field"><span className="label">從</span><select className="input" value={cmp.from} onChange={(e) => setCmp({ ...cmp, from: e.target.value })}>{baselines.map((b) => <option key={b.ref} value={b.ref}>{b.label}　{when(b.date)}</option>)}</select></label>
              <label className="field"><span className="label">到</span><select className="input" value={cmp.to} onChange={(e) => setCmp({ ...cmp, to: e.target.value })}>{baselines.map((b) => <option key={b.ref} value={b.ref}>{b.label}　{when(b.date)}</option>)}</select></label>
              <div className="tbtn-row" style={{ marginBottom: 12 }}><button className="tbtn primary" onClick={() => run(async () => setResult((await api<{ changes: Change[] }>(`/projects/${id}/compare?from=${encodeURIComponent(cmp.from)}&to=${encodeURIComponent(cmp.to)}`)).changes))}>比較</button></div>
            </div>
            {result && <Changes list={result} />}
          </>
        )}
      </section>

      <HistoryView key={tick} id={id} />
    </>
  );
}
