// 專案設定：名稱、類型、節點可改；代號是儲存庫名稱，不可改。
import { useEffect, useState } from "react";
import { api, baseOf } from "../../api.ts";
import type { Me, Meta, View } from "../../api.ts";

export function Settings({ view, meta, user, setView }: { view: View; meta: Meta; user: Me; setView: (v: View) => void }) {
  const p = view.project;
  const [name, setName] = useState(p.name);
  const [kind, setKind] = useState(p.kind);
  const [gates, setGates] = useState<string[]>(p.gates);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setName(p.name); setKind(p.kind); setGates(p.gates); }, [p.name, p.kind, p.gates.join()]);
  const ro = !user.caps.confirm;
  const dirty = name.trim() !== p.name || kind !== p.kind || (kind === "small" && gates.join() !== p.gates.join());
  const toggle = (id: string) => setGates((g) => meta.gates.map((x) => x.id).filter((x) => (x === id ? !g.includes(x) : g.includes(x))));
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null);
    try { setView(await api<View>(`/projects/${p.id}`, "PATCH", { name, kind, gates })); setMsg({ ok: true, text: "已儲存專案設定。" }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <section className="section">
      <div className="section-head"><h2 className="section-title">專案設定</h2></div>
      <form onSubmit={save} className="mg-settings">
        <div className="row">
          <label className="field"><span className="label">專案代號</span><input className="input" value={baseOf(p.id)} readOnly disabled aria-describedby="mg-code-why" /></label>
          <label className="field" style={{ flex: 2 }}><span className="label">專案名稱</span><input className="input" required value={name} disabled={ro} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span className="label">專案類型</span>
            <select className="input" value={kind} disabled={ro} onChange={(e) => setKind(e.target.value as "annual" | "small")}><option value="annual">年度專案（全部節點）</option><option value="small">小型專案（自選節點）</option></select></label>
        </div>
        <p id="mg-code-why" className="caption">代號不能改：它就是 GitHub 儲存庫與資料夾名稱，所有分支、PR、版本紀錄和分享連結都用它定位，改了會全部對不上。要換名請改「專案名稱」。</p>
        <fieldset className="mg-gate-pick" disabled={ro || kind === "annual"}>
          <legend className="label">審查節點{kind === "annual" ? "（年度專案固定全部）" : "　已有簽核紀錄的節點不能移除"}</legend>
          {meta.gates.map((g) => (
            <label key={g.id} className="check"><input type="checkbox" checked={kind === "annual" || gates.includes(g.id)} onChange={() => toggle(g.id)} /><span className="caption">{g.zh}</span></label>
          ))}
        </fieldset>
        {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
        {!ro && <div className="tbtn-row"><button className="tbtn primary" disabled={!dirty}>儲存設定</button></div>}
        {ro && <p className="caption">修改專案設定需要責任工程師以上的權限。</p>}
      </form>
    </section>
  );
}
