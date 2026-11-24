// 專案設定：名稱、類型、節點可改；代號是儲存庫名稱，不可改。
// 框架參數（PRJ-05）：FMEA 門檻、預算餘裕、最少候選數、方案權重、各步負責人；預設值來自框架檔（/api/meta 的 framework）。
import { useEffect, useState } from "react";
import { api, baseOf } from "../../api.ts";
import type { Me, Meta, View } from "../../api.ts";
import { fwOf } from "../../Process.tsx";

interface FwMeta {
  settings: { id: string; zh: string; type: string; default: unknown; note?: string }[];
  roles: { id: string; zh: string }[];
  owners: { key: string; layer: string; zh: string; default: string }[];
}
interface FwSet { fmeaThreshold: number; budgetMargin: number | null; minAlternatives: number; tradeWeights: boolean; owners: Record<string, string> }

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
      <FrameworkSettings view={view} meta={meta} ro={ro} setView={setView} />
    </section>
  );
}

function FrameworkSettings({ view, meta, ro, setView }: { view: View; meta: Meta; ro: boolean; setView: (v: View) => void }) {
  const fm = (meta as Meta & { framework?: FwMeta }).framework;
  const cur = fwOf(view)?.settings as FwSet | undefined;
  const [s, setS] = useState<FwSet | null>(cur ?? null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const key = JSON.stringify(cur ?? null);
  useEffect(() => { setS(cur ?? null); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fm || !s || !cur) return null;
  const zh = (id: string) => fm.settings.find((x) => x.id === id);
  const note = (id: string) => zh(id)?.note ? <span className="caption">{zh(id)?.note}</span> : null;
  const def = (id: string) => { const d = zh(id)?.default; return d === null || d === undefined ? "未設定" : String(d); };
  const dirty = JSON.stringify(s) !== key;
  const save = async (ev: React.FormEvent) => {
    ev.preventDefault(); setMsg(null);
    // 負責人：跟目前不同的才送；選回預設送空字串（清掉）
    const owners: Record<string, string> = {};
    for (const o of fm.owners) { const a = s.owners[o.key] ?? "", b = cur.owners[o.key] ?? ""; if (a !== b) owners[o.key] = a; }
    try {
      setView(await api<View>(`/projects/${view.project.id}`, "PATCH", { settings: { fmeaThreshold: s.fmeaThreshold, budgetMargin: s.budgetMargin, minAlternatives: s.minAlternatives, tradeWeights: s.tradeWeights, owners } }));
      setMsg({ ok: true, text: "已儲存框架參數。" });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const layers = [...new Set(fm.owners.map((o) => o.layer))];
  return (
    <form onSubmit={save} className="mg-settings" data-fw="settings" style={{ marginTop: 24 }}>
      <div className="section-head"><h2 className="section-title">框架參數</h2><span className="label">預設值來自 framework/jri.json</span></div>
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="row">
          <label className="field"><span className="label">{zh("fmeaThreshold")?.zh ?? "FMEA 門檻"}（預設 {def("fmeaThreshold")}）</span>
            <input className="input" name="fmeaThreshold" type="number" min={1} max={25} value={s.fmeaThreshold} onChange={(e) => setS({ ...s, fmeaThreshold: Number(e.target.value) })} />{note("fmeaThreshold")}</label>
          <label className="field"><span className="label">{zh("budgetMargin")?.zh ?? "預算餘裕"} %（預設 {def("budgetMargin")}）</span>
            <input className="input" name="budgetMargin" type="number" min={0} max={100} step="any" value={s.budgetMargin ?? ""} placeholder="不檢查" onChange={(e) => setS({ ...s, budgetMargin: e.target.value === "" ? null : Number(e.target.value) })} />{note("budgetMargin")}</label>
          <label className="field"><span className="label">{zh("minAlternatives")?.zh ?? "最少候選數"}（預設 {def("minAlternatives")}）</span>
            <input className="input" name="minAlternatives" type="number" min={1} max={10} value={s.minAlternatives} onChange={(e) => setS({ ...s, minAlternatives: Number(e.target.value) })} /></label>
        </div>
        <label className="check"><input type="checkbox" name="tradeWeights" checked={s.tradeWeights} onChange={(e) => setS({ ...s, tradeWeights: e.target.checked })} /><span className="caption">{zh("tradeWeights")?.zh ?? "方案比較要權重"}（預設 {def("tradeWeights") === "true" ? "要" : "可給可不給"}）</span></label>
        <details style={{ marginTop: 12 }}>
          <summary className="label">{zh("owners")?.zh ?? "各步負責人"}（{fm.owners.length} 項；預設照 AEAS 職級）</summary>
          {layers.map((ly) => (
            <div key={ly} style={{ marginTop: 8 }}>
              <p className="label">{ly}</p>
              <div className="row" style={{ flexWrap: "wrap" }}>
                {fm.owners.filter((o) => o.layer === ly).map((o) => (
                  <label key={o.key} className="field" style={{ flex: "0 0 13rem" }}><span className="caption">{o.zh}</span>
                    <select className="input" name={`owner:${o.key}`} value={s.owners[o.key] ?? ""} onChange={(e) => setS({ ...s, owners: { ...s.owners, [o.key]: e.target.value } })}>
                      <option value="">預設：{fm.roles.find((r) => r.id === o.default)?.zh ?? o.default}</option>
                      {fm.roles.filter((r) => r.id !== "gateApprover").map((r) => <option key={r.id} value={r.id}>{r.zh}</option>)}
                    </select></label>
                ))}
              </div>
            </div>
          ))}
        </details>
      </fieldset>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
      {!ro && <div className="tbtn-row"><button className="tbtn primary" disabled={!dirty}>儲存框架參數</button></div>}
    </form>
  );
}
