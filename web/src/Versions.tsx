import { useCallback, useEffect, useState } from "react";
import { api, baseOf, refOf } from "./api.ts";
import type { BranchState, Me, View } from "./api.ts";
import { HistoryView } from "./Views.tsx";

interface Sync { remote: string; lastPushAt: string | null; error: string | null; pushing: boolean }
interface Branch { name: string; remote: boolean; ahead: number; behind: number; author: string; date: string; subject: string; ok: boolean; errors: number; firstError: string }
interface Change { type: "added" | "removed" | "changed"; key: string; name: string; category: string | null; fields: { field: string; from: string; to: string }[] }
interface Baseline { ref: string; label: string; date: string; commit: string }

const TYPE_ZH = { added: "新增", removed: "移除", changed: "修改" } as const;
const when = (s: string) => new Date(s).toLocaleString("zh-TW", { hour12: false });

function Changes({ list, post }: { list: Change[]; post?: Set<string> }) {
  if (list.length === 0) return <p className="caption">模型元素沒有差異。</p>;
  const late = list.filter((c) => c.type !== "added" && post?.has(c.key)).length;
  return (
    <>
    {late > 0 && <p className="caption" role="alert"><span className="tag danger">核可後變更</span> 有 {late} 項需求或介面在節點核可之後被修改或移除，審查時請特別確認。</p>}
    <table>
      <thead><tr><th>變更</th><th>編號</th><th>名稱</th><th>內容</th></tr></thead>
      <tbody>{list.map((c) => (
        <tr key={c.type + c.key}>
          <td><span className={`tag ${c.type === "added" ? "done" : ""}`}>{TYPE_ZH[c.type]}</span></td><td className="id">{c.key.includes("::") ? "—" : c.key}</td><td>{c.name}{c.type !== "added" && post?.has(c.key) && <span className="tag danger" style={{ marginLeft: 6 }} title="節點核可後，這條需求或介面被修改">核可後變更</span>}</td>
          <td>{c.fields.map((f, i) => <div key={i}><span className="faint">{f.field}　</span><span className="muted" style={{ textDecoration: "line-through" }}>{f.from || "（空）"}</span>　→　{f.to || "（空）"}</div>)}</td>
        </tr>
      ))}</tbody>
    </table>
    </>
  );
}

const BRANCH_OK = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,120}$/;
const tally = (l: Change[]) => `新增 ${l.filter((c) => c.type === "added").length}、修改 ${l.filter((c) => c.type === "changed").length}、移除 ${l.filter((c) => c.type === "removed").length}`;

function Step({ n, title, state, children }: { n: string; title: string; state: "now" | "done" | "wait"; children: React.ReactNode }) {
  return (
    <div className={`vstep ${state}`} aria-current={state === "now" ? "step" : undefined}>
      <div className="vstep-head"><span className="vstep-n">{n}</span><span className="vstep-title">{title}</span>{state === "now" && <span className="tag warn">你在這裡</span>}{state === "done" && <span className="tag done">完成</span>}</div>
      <div className="vstep-body">{children}</div>
    </div>
  );
}

/** 版本頁：修改 → 送審 → 核准合併三格；版本歷史；進階（GitHub 同步、合併 main、修改紀錄）。 */
export function VersionsView({ id, user, branch, onOpen, onChanged }: { id: string; user: Me; branch: BranchState | null; onOpen: (ref: string) => void; onChanged: (v: View) => void }) {
  const [sync, setSync] = useState<Sync | null>(null);
  const [url, setUrl] = useState("");
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [mine, setMine] = useState<Change[] | null>(null);
  // FW-09：最近一次節點核可時已有的需求與介面；之後被修改或移除的在差異上標「核可後變更」
  const [post, setPost] = useState<{ keys: Set<string>; gate: string } | null>(null);
  const [showMine, setShowMine] = useState(false);
  const [open, setOpen] = useState<{ name: string; diff: string; changes: Change[] } | null>(null);
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [cmp, setCmp] = useState({ from: "", to: "HEAD" });
  const [result, setResult] = useState<Change[] | null>(null);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tick, setTick] = useState(0);
  const onBranch = !!branch;

  const run = async (fn: () => Promise<void>, done?: string) => {
    setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const load = useCallback(() => run(async () => {
    const s = await api<Sync>(`/projects/${id}/sync`); setSync(s); setUrl(s.remote);
    const b = await api<Baseline[]>(`/projects/${id}/baselines`); setBaselines(b); setCmp((c) => ({ from: c.from || b[1]?.ref || "", to: c.to }));
    setBranches(await api<Branch[]>(`/projects/${id}/branches`));
    const cc = await api<{ approved: { gate: string; keys: string[] } | null }>(`/projects/${id}/change-control`).catch(() => ({ approved: null }));
    setPost(cc.approved ? { keys: new Set(cc.approved.keys), gate: cc.approved.gate } : null);
    if (branch) setMine((await api<{ changes: Change[] }>(`/projects/${id}/branches/diff?name=${encodeURIComponent(branch.name)}`)).changes);
  }), [id, branch?.name]);
  useEffect(() => { load(); }, [load]);

  const update = () => run(async () => { onChanged(await api<View>(`/projects/${id}/branches/update`, "POST", {})); await load(); setTick((t) => t + 1); }, "已合併 main 的更新。");
  const merge = (name: string) => run(async () => { onChanged(await api<View>(`/projects/${id}/branches/merge`, "POST", { name })); setOpen(null); await load(); setTick((t) => t + 1); }, `已合併 ${name}。`);
  const me = branch && branches?.find((b) => b.name === branch.name);
  const changed = mine?.length ?? 0;
  const pending = (branches ?? []).filter((b) => b.ahead > 0);
  const nameOk = BRANCH_OK.test(newName);

  return (
    <>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}

      {branch ? (
        <section className="section">
          <div className="section-head"><h1 className="section-title">版本</h1><span className="label">{branch.name}</span></div>
          <div className="vsteps">
            <Step n="①" title="修改" state={changed === 0 ? "now" : "done"}>
              <p className="body">你在分支 <b>{branch.name}</b>，{mine === null ? "讀取中" : changed === 0 ? "還沒有改動。到模型、表格等頁修改後再回來。" : `改了 ${changed} 項（${tally(mine)}）`}。</p>
              {changed > 0 && <div className="tbtn-row"><button className="tbtn" aria-expanded={showMine} onClick={() => setShowMine(!showMine)}>{showMine ? "收起差異" : "看改了什麼"}</button></div>}
              {user.caps.edit && branch.behind > 0 && <p className="caption">main 有 {branch.behind} 筆更新還沒進來，可到下方「進階」合併。</p>}
            </Step>
            <Step n="②" title="送審" state={changed === 0 ? "wait" : "now"}>
              <p className="body">{branch.ahead} 筆提交存在這個分支（有設定 GitHub 時會自動推送）；責任工程師會在 main 的「送審中」清單看到它。</p>
              <p className="body">檢查：{!me ? "讀取中" : me.ok ? <span className="tag done">PASS</span> : <><span className="tag danger">ERR</span> {me.firstError}</>}</p>
              <div className="tbtn-row"><button className="tbtn primary" onClick={() => onOpen(baseOf(id))}>回到 main 看送審清單</button></div>
            </Step>
            <Step n="③" title="核准合併" state="wait">
              <p className="body">責任工程師以上在 main 審查並合併，之後才成為大家看到的版本。{user.caps.merge ? "你有合併權限，請回到 main 操作。" : "你沒有合併權限，等責任工程師處理。"}</p>
            </Step>
          </div>
          {showMine && mine && <Changes list={mine} post={post?.keys} />}
        </section>
      ) : (
        <section className="section">
          <div className="section-head"><h1 className="section-title">版本</h1><span className="label">main</span></div>
          <div className="vsteps">
            <Step n="①" title="修改" state="wait"><p className="body">在自己的分支上修改，不影響 main。下方可以開一個新分支。</p></Step>
            <Step n="②" title="送審" state={pending.length > 0 ? "done" : "wait"}><p className="body">推送後出現在下方「送審中」，工具先檢查模型能不能解析。</p></Step>
            <Step n="③" title="核准合併" state={pending.length > 0 ? "now" : "wait"}><p className="body">{pending.length > 0 ? `有 ${pending.length} 個分支等待審查。` : "目前沒有等待審查的分支。"}{user.caps.merge ? "按「合併」即可。" : "合併需要責任工程師以上的權限。"}</p></Step>
          </div>

          <div className="section-head" style={{ marginTop: 16 }}><h2 className="section-title">送審中</h2><span className="label">{branches?.length ?? "…"}</span></div>
          {branches === null ? <p className="label">讀取中</p> : branches.length === 0 ? <p className="caption">目前沒有送審中的分支。</p> : (
            <table>
              <thead><tr><th>分支</th><th>作者</th><th>最後修改</th><th>提交</th><th>預跑／檢查</th><th></th></tr></thead>
              <tbody>{branches.map((b) => (
                <tr key={b.name}>
                  <td className="id">{b.name}</td><td>{b.author}</td><td className="id">{when(b.date)}</td><td>{b.ahead} 筆<div className="caption">{b.subject}</div></td>
                  <td>{b.ok ? <span className="tag done">PASS</span> : <><span className="tag danger">ERR</span><div className="caption">{b.firstError}</div></>}</td>
                  <td><div className="tbtn-row">
                    <button className="tbtn" onClick={() => onOpen(refOf(id, b.name))}>開啟</button>
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
              <Changes list={open.changes} post={post?.keys} />
              <pre className="code" style={{ maxHeight: 320, marginTop: 12 }}>{open.diff || "（沒有文字差異）"}</pre>
            </div>
          )}
          {user.caps.edit && (
            <div className="row" style={{ marginTop: 16 }}>
              <label className="field"><span className="label">從 main 開新分支</span><input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="例如 回收傘" /></label>
              <div className="tbtn-row" style={{ marginBottom: 12 }}><button className="tbtn primary" disabled={!nameOk} onClick={() => onOpen(refOf(id, newName))}>開新分支</button></div>
            </div>
          )}
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2 className="section-title">版本歷史</h2><span className="label">{Math.max(baselines.length - 1, 0)} 個基線</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>每次節點核可都會留下一個基線。選兩個版本，看這段期間模型改了什麼。</p>
        {baselines.length < 2 ? <p className="caption">還沒有基線。節點核可後才會出現。</p> : (
          <>
            <table style={{ marginBottom: 12 }}>
              <thead><tr><th>基線</th><th>時間</th><th>版本</th></tr></thead>
              <tbody>{baselines.map((b) => <tr key={b.ref}><td>{b.label}</td><td className="id">{when(b.date)}</td><td className="id">{b.commit}</td></tr>)}</tbody>
            </table>
            <div className="row">
              <label className="field"><span className="label">從</span><select className="input" value={cmp.from} onChange={(e) => setCmp({ ...cmp, from: e.target.value })}>{baselines.map((b) => <option key={b.ref} value={b.ref}>{b.label}　{when(b.date)}</option>)}</select></label>
              <label className="field"><span className="label">到</span><select className="input" value={cmp.to} onChange={(e) => setCmp({ ...cmp, to: e.target.value })}>{baselines.map((b) => <option key={b.ref} value={b.ref}>{b.label}　{when(b.date)}</option>)}</select></label>
              <div className="tbtn-row" style={{ marginBottom: 12 }}><button className="tbtn primary" onClick={() => run(async () => setResult((await api<{ changes: Change[] }>(`/projects/${id}/compare?from=${encodeURIComponent(cmp.from)}&to=${encodeURIComponent(cmp.to)}`)).changes))}>比較差異</button></div>
            </div>
            {result && <Changes list={result} post={post?.keys} />}
          </>
        )}
      </section>

      <details className="section vadv">
        <summary className="section-head"><span className="section-title">進階：GitHub 同步、合併 main 的更新、修改紀錄</span></summary>
        <section className="section">
          <div className="section-head"><h2 className="section-title">GitHub 同步</h2><span className="label">{!sync?.remote ? "未設定" : sync.pushing ? "推送中" : sync.error ? "ERR" : "已同步"}</span></div>
          <p className="body muted" style={{ marginBottom: 12 }}>{onBranch ? "這個分支的每次儲存都會自動推送到 GitHub 上的同名分支；成員從自己的電腦推上來的修改，重新開啟時也會接上。" : "設定後，每次儲存都會自動推送到這個儲存庫。管理頁開啟「自動建立」時，新專案會自動建好；否則先在 GitHub 建立空的儲存庫再把網址填在這裡。"}</p>
          {sync?.error && <p className="msg"><span className="tag danger">ERR</span>{sync.error.startsWith("自動建立") ? sync.error : `推送失敗：${sync.error}`}</p>}
          {sync?.lastPushAt && <p className="caption" style={{ marginBottom: 8 }}>上次推送　{when(sync.lastPushAt)}</p>}
          {user.caps.admin && !onBranch ? (
            <div className="row">
              <label className="field"><span className="label">儲存庫網址</span><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/FCU-JRI/專案代號" /></label>
              <div className="tbtn-row" style={{ marginBottom: 12 }}><button className="tbtn primary" onClick={() => run(async () => setSync(await api<Sync>(`/projects/${id}/remote`, "POST", { url })), "已儲存，開始推送。")}>儲存</button>
                {!sync?.remote && <button className="tbtn" onClick={() => run(async () => { const s = await api<Sync>(`/projects/${id}/remote/create`, "POST", {}); setSync(s); setUrl(s.remote); if (s.error) throw new Error(s.error); }, "已在 GitHub 建立儲存庫，開始推送。")}>在 GitHub 建立</button>}</div>
            </div>
          ) : <p className="caption">{sync?.remote || "尚未設定儲存庫。"}</p>}
        </section>
        {branch && (
          <section className="section">
            <div className="section-head"><h2 className="section-title">合併 main 的更新</h2><span className="label">落後 {branch.behind} 筆</span></div>
            <p className="body muted" style={{ marginBottom: 12 }}>main 有更新時先合併進來，之後送審比較不會衝突。</p>
            <div className="tbtn-row">{user.caps.edit && <button className="tbtn primary" disabled={branch.behind === 0} onClick={update}>合併 main 的更新</button>}</div>
          </section>
        )}
        <HistoryView key={tick} id={id} />
      </details>
    </>
  );
}
