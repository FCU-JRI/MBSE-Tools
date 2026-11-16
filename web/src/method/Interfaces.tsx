// P4：介面與 N² 矩陣（METHOD.md 第 4 節、圖 6）。資料由伺服器從模型算出（GET /interfaces），這一頁只負責顯示與表單。
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";
import type { View } from "../api.ts";
import type { MethodPageProps } from "./registry.ts";

type Result = "pass" | "fail" | "unknown";
interface Val { name: string; value: number | boolean | string | null; unit: string; reason: string }
interface End { end: string; part: string | null; partName: string; partDef: string | null; partDefName: string; port: string | null; portName: string; portDef: string | null; given: boolean; values: Val[] }
interface Approval { by: string; at: string; hash: string }
interface Iface {
  id: string; name: string; qualifiedName: string; owner: string | null; ownerName: string; def: string | null; defName: string; kind: string; kindZh: string; maturity: string;
  ownerA: string; ownerB: string; ends: End[]; constraints: { name: string; text: string; result: Result; reason: string }[]; result: Result; hash: string;
  approvals: { a: Approval | null; b: Approval | null }; agreed: boolean;
}
interface PortDef { id: string; name: string; shortName: string | null; qualifiedName: string; doc: string; attrs: { name: string; type: string; unit: string }[]; shared: boolean }
interface IfDef { id: string; name: string; shortName: string | null; qualifiedName: string; doc: string; shared: boolean; kind: string; ends: { name: string; portDef: string | null }[]; constraints: { name: string; text: string }[]; attrs: Record<string, string> }
interface Row { id: string; name: string; source: "interface" | "given"; verificationMethod: string; verificationOwner: string; verificationLevel: string; owner: string; rationale: string; result: "pass" | "fail" | "open" }
interface Part { id: string; name: string; category: string | null; given: boolean; ports: { id: string; name: string; portDef: string | null; values: Record<string, string> }[] }
export interface InterfaceReport {
  kinds: Record<string, string>; maturity: string[]; methods: Record<string, string>; levels: string[]; portTypes: { id: string; zh: string; unit: string }[];
  portDefs: PortDef[]; interfaceDefs: IfDef[]; interfaces: Iface[]; parts: Part[];
  n2: { nodes: { id: string; name: string; category: string | null; given: boolean }[]; cells: Record<string, string[]> };
  verification: Row[]; warnings: { id: string | null; text: string }[];
}
type Saved = View & { interfaces?: InterfaceReport };

const fmt = (v: Val) => (v.value === null ? "—" : `${typeof v.value === "number" ? +v.value.toPrecision(6) : String(v.value)}${v.unit ? ` ${v.unit}` : ""}`);
const ResultTag = ({ r }: { r: Result | "open" }) => (r === "pass" ? <span className="tag done">OK</span> : r === "fail" ? <span className="tag danger">不符</span> : <span className="tag">未判定</span>);
const blankDef = (): Omit<IfDef, "id" | "shortName" | "qualifiedName" | "shared"> & { id: string } => ({ id: "", name: "", doc: "", kind: "electrical", ends: [{ name: "a", portDef: null }, { name: "b", portDef: null }], constraints: [], attrs: { maturity: "存在" } });

export function Interfaces({ view, user, onChanged, onOpen }: MethodPageProps) {
  const pid = view.project.id;
  const ro = !user.caps.edit;
  const [r, setR] = useState<InterfaceReport | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [def, setDef] = useState(blankDef);
  const [port, setPort] = useState<{ id: string; name: string; doc: string; attrs: { name: string; type: string }[] }>({ id: "", name: "", doc: "", attrs: [{ name: "", type: "ScalarValues::Real" }] });
  const [conn, setConn] = useState({ owner: "", from: "", to: "", def: "" });
  const [addPort, setAddPort] = useState({ owner: "", portDef: "", name: "", values: {} as Record<string, string> });
  const [editPort, setEditPort] = useState<{ id: string; values: Record<string, string> } | null>(null);
  const [usage, setUsage] = useState({ ownerA: "", ownerB: "", maturity: "" });

  const load = () => api<InterfaceReport>(`/projects/${pid}/interfaces`).then(setR, (e) => setMsg({ ok: false, text: (e as Error).message }));
  useEffect(() => { void load(); }, [pid, view.analysis]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<Saved | { interfaces: InterfaceReport }>, done?: string) => {
    setBusy(true); setMsg(null);
    try {
      const out = await fn();
      if ("analysis" in out) onChanged(out as View);
      if (out.interfaces) setR(out.interfaces);
      if (done) setMsg({ ok: true, text: done });
      return true;
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; } finally { setBusy(false); }
  };
  const post = (path: string, body: Record<string, unknown>) => api<Saved>(`/projects/${pid}/interfaces/${path}`, "POST", body);

  const current = r?.interfaces.find((i) => i.id === sel) ?? null;
  useEffect(() => { if (current) setUsage({ ownerA: current.ownerA, ownerB: current.ownerB, maturity: current.maturity }); }, [current?.id, current?.hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const els = view.analysis.elements;
  // 可以放介面的上層：裡面至少有兩個零件的定義
  const hosts = useMemo(() => els.filter((e) => e.kind === "PartDefinition" && els.filter((c) => c.owner === e.id && c.kind === "PartUsage").length >= 2), [els]);
  const partsIn = (owner: string) => els.filter((c) => c.owner === owner && c.kind === "PartUsage");

  if (!r) return <>{msg && <p className="msg" role="status"><span className="tag danger">ERR</span>{msg.text}</p>}<p className="label">讀取中</p></>;
  const byId = new Map(r.interfaces.map((i) => [i.id, i]));
  const portDefName = (id: string | null) => r.portDefs.find((p) => p.id === id)?.name ?? "—";

  const saveDef = (ev: FormEvent) => {
    ev.preventDefault();
    void run(() => post("defs", { id: def.id || undefined, name: def.name, doc: def.doc, kind: def.kind, ends: def.ends, constraints: def.constraints, ...def.attrs }), def.id ? "已更新介面定義。" : "已新增介面定義。").then((ok) => { if (ok) setDef(blankDef()); });
  };
  const savePort = (ev: FormEvent) => {
    ev.preventDefault();
    void run(() => post("port-defs", { id: port.id || undefined, name: port.name, doc: port.doc, attrs: port.attrs.filter((a) => a.name.trim()) }), port.id ? "已更新連接埠定義。" : "已新增連接埠定義。")
      .then((ok) => { if (ok) setPort({ id: "", name: "", doc: "", attrs: [{ name: "", type: "ScalarValues::Real" }] }); });
  };
  const approve = (i: Iface, side: "a" | "b", revoke = false) => run(() => post("approve", { id: i.id, side, revoke }), revoke ? "已撤回同意。" : "已記下同意。");

  return (
    <>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}

      <section className="section">
        <div className="section-head"><h1 className="section-title">N² 矩陣</h1><span className="label">{r.interfaces.length} 個介面</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>對角線是次系統（以及介面兩端用到的元件、外部對象）；格子（列，欄）是第一端在列、第二端在欄的介面，附種類、兩端數字的檢查與是否已經兩端同意。由模型自動產生。</p>
        {r.n2.nodes.length === 0 ? <p className="caption">還沒有次系統。先在結構裡建立次系統。</p> : (
          <div className="etable-wrap">
            <table aria-label="N² 矩陣" style={{ tableLayout: "fixed", minWidth: r.n2.nodes.length * 150 }}>
              <tbody>{r.n2.nodes.map((row) => (
                <tr key={row.id}>{r.n2.nodes.map((col) => {
                  if (row.id === col.id) return (
                    <td key={col.id} style={{ background: "var(--ink)", color: "var(--on-ink)", verticalAlign: "middle", textAlign: "center" }}>
                      <button className="tbtn" style={{ color: "inherit", fontWeight: 700 }} onClick={() => onOpen(row.id)}>{row.name}</button>
                      {row.given && <div className="caption" style={{ color: "inherit" }}>外部提供</div>}
                    </td>
                  );
                  const ids = r.n2.cells[`${row.id}|${col.id}`] ?? [];
                  return (
                    <td key={col.id} style={{ verticalAlign: "top" }}>
                      {ids.map((iid) => { const i = byId.get(iid) as Iface; return (
                        <button key={iid} className="tbtn" style={{ display: "block", height: "auto", textAlign: "left", padding: "4px 8px" }} aria-pressed={sel === iid} onClick={() => setSel(iid)}>
                          <span className="body">{i.name}</span> <span className="caption">{i.kindZh}</span>{" "}<ResultTag r={i.result} />{i.agreed && <span className="tag done">定案</span>}
                          <div className="caption">{i.ends[0].values.map((v, k) => `${v.name} ${fmt(v)} / ${fmt(i.ends[1].values[k] ?? v)}`).slice(0, 2).join("；")}</div>
                        </button>
                      ); })}
                    </td>
                  );
                })}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {r.warnings.length > 0 && (
        <section className="section">
          <div className="section-head"><h2 className="section-title">還缺什麼</h2><span className="label">{r.warnings.length}</span></div>
          <ul className="checks">{r.warnings.map((w, k) => (
            <li key={k}><span className="tag warn">待補</span><span className="body">{w.id && byId.has(w.id) ? <button className="tbtn" onClick={() => setSel(w.id)}>{w.text}</button> : w.text}</span></li>
          ))}</ul>
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2 className="section-title">介面</h2><span className="label">兩端數字對得上、兩端負責人都同意才定案</span></div>
        {r.interfaces.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>介面</th><th>第一端</th><th>第二端</th><th>種類</th><th>成熟度</th><th>檢查</th><th>同意</th></tr></thead>
            <tbody>{r.interfaces.map((i) => (
              <tr key={i.id} className="rowbtn" aria-selected={sel === i.id} onClick={() => setSel(i.id)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") setSel(i.id); }}>
                <td>{i.name}<div className="caption">{i.defName}（{i.ownerName}）</div></td>
                {i.ends.map((e, k) => <td key={k}>{e.partDefName || e.partName}{e.given && <span className="tag">外部</span>}<div className="caption">{e.partName}.{e.portName}</div></td>)}
                <td>{i.kindZh}</td><td>{i.maturity}</td><td><ResultTag r={i.result} /></td>
                <td>{i.agreed ? <span className="tag done">定案</span> : <span className="caption">{[i.approvals.a ? "一" : "", i.approvals.b ? "二" : ""].filter(Boolean).join("、") || "無"}</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {current && (
          <div style={{ border: "var(--stroke-hair) solid var(--line)", padding: 16, marginBottom: 16 }}>
            <div className="row" style={{ alignItems: "baseline" }}><span className="heading">{current.name}</span><span className="caption">{current.defName} · {current.kindZh} · {current.maturity}</span><ResultTag r={current.result} />
              <button className="tbtn" onClick={() => onOpen(current.id)}>在表中開啟</button><button className="tbtn" onClick={() => setSel(null)}>關閉</button></div>
            <table style={{ margin: "8px 0" }}>
              <thead><tr><th>數值</th><th>{current.ends[0].end}：{current.ends[0].partDefName}</th><th>{current.ends[1].end}：{current.ends[1].partDefName}</th></tr></thead>
              <tbody>{current.ends[0].values.map((v, k) => (
                <tr key={v.name}><td>{v.name}</td><td className="id" title={v.reason}>{fmt(v)}{current.ends[0].given && <span className="caption">（給定值）</span>}</td><td className="id" title={current.ends[1].values[k]?.reason}>{current.ends[1].values[k] ? fmt(current.ends[1].values[k]) : "—"}{current.ends[1].given && <span className="caption">（給定值）</span>}</td></tr>
              ))}</tbody>
            </table>
            <ul className="checks">{current.constraints.map((c) => <li key={c.name}><ResultTag r={c.result} /><span className="body">{c.name}：<code>{c.text}</code>{c.reason && <span className="caption"> {c.reason}</span>}</span></li>)}
              {current.constraints.length === 0 && <li><span className="tag">無</span><span className="caption">介面定義還沒有限制（assert constraint），兩端的數字無從檢查。</span></li>}</ul>
            <div className="row" style={{ marginTop: 8 }}>
              {(["a", "b"] as const).map((s, k) => { const ap = current.approvals[s], owner = k ? current.ownerB : current.ownerA; return (
                <div key={s} className="stack" style={{ minWidth: 220 }}>
                  <span className="label">第{k ? "二" : "一"}端負責人：{owner || "未填"}</span>
                  {ap ? <span className="caption">{ap.by} 已同意（{ap.at.slice(0, 10)}）</span> : <span className="caption">尚未同意目前的內容</span>}
                  {!ro && owner && (ap ? <button className="tbtn" disabled={busy} onClick={() => void approve(current, s, true)}>撤回同意</button> : <button className="tbtn primary" disabled={busy} onClick={() => void approve(current, s)}>我是 {owner}，同意</button>)}
                </div>
              ); })}
            </div>
            {!ro && (
              <form className="row" style={{ marginTop: 8 }} onSubmit={(ev) => { ev.preventDefault(); void run(() => post("usage", { id: current.id, ...usage }), "已更新這個介面。"); }}>
                <label className="field"><span className="label">第一端負責人</span><input className="input" value={usage.ownerA} onChange={(e) => setUsage({ ...usage, ownerA: e.target.value })} /></label>
                <label className="field"><span className="label">第二端負責人</span><input className="input" value={usage.ownerB} onChange={(e) => setUsage({ ...usage, ownerB: e.target.value })} /></label>
                <label className="field"><span className="label">成熟度</span><select className="input" value={usage.maturity} onChange={(e) => setUsage({ ...usage, maturity: e.target.value })}>{r.maturity.map((m) => <option key={m}>{m}</option>)}</select></label>
                <button className="tbtn primary" disabled={busy}>更新這個介面</button>
              </form>
            )}
          </div>
        )}
        {!ro && (
          <form onSubmit={(ev) => { ev.preventDefault(); void run(() => post("connect", { from: conn.from, to: conn.to, def: conn.def || undefined }), "已接上介面。"); }}>
            <div className="row">
              <label className="field"><span className="label">接起兩個零件：在哪個系統裡</span><select className="input" value={conn.owner} onChange={(e) => setConn({ owner: e.target.value, from: "", to: "", def: conn.def })}><option value="">選擇</option>{hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
              <label className="field"><span className="label">第一端</span><select className="input" value={conn.from} onChange={(e) => setConn({ ...conn, from: e.target.value })}><option value="">選擇</option>{partsIn(conn.owner).map((p) => <option key={p.id} value={p.id}>{p.name} : {p.types[0]}</option>)}</select></label>
              <label className="field"><span className="label">第二端</span><select className="input" value={conn.to} onChange={(e) => setConn({ ...conn, to: e.target.value })}><option value="">選擇</option>{partsIn(conn.owner).map((p) => <option key={p.id} value={p.id}>{p.name} : {p.types[0]}</option>)}</select></label>
              <label className="field"><span className="label">介面定義（不選就自動找）</span><select className="input" value={conn.def} onChange={(e) => setConn({ ...conn, def: e.target.value })}><option value="">自動</option>{r.interfaceDefs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            </div>
            <div className="tbtn-row"><button className="tbtn primary" disabled={busy || !conn.from || !conn.to}>接上介面</button><span className="caption">也可以在互連圖選「介面」工具，從一個零件拉到另一個零件。</span></div>
          </form>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">介面定義</h2><span className="label">interface def</span></div>
        {r.interfaceDefs.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>編號</th><th>名稱</th><th>種類</th><th>兩端</th><th>限制</th><th>負責人</th></tr></thead>
            <tbody>{r.interfaceDefs.map((d) => (
              <tr key={d.id} className="rowbtn" aria-selected={def.id === d.id} tabIndex={0} onClick={() => !d.shared && setDef({ id: d.id, name: d.name, doc: d.doc, kind: d.kind || "electrical", ends: d.ends.length === 2 ? d.ends : blankDef().ends, constraints: d.constraints, attrs: d.attrs })}>
                <td className="id">{d.shortName}</td><td>{d.name}</td><td>{r.kinds[d.kind] ?? "未定"}</td><td>{d.ends.map((e) => `${e.name} : ${portDefName(e.portDef)}`).join("、")}</td>
                <td>{d.constraints.map((c) => c.name).join("、") || "—"}</td><td>{[d.attrs.ownerA, d.attrs.ownerB].filter(Boolean).join("、") || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {!ro && (
          <form onSubmit={saveDef}>
            <div className="row">
              <label className="field" style={{ flex: 2 }}><span className="label">{def.id ? `修改介面定義 ${def.name}` : "新增介面定義"}</span><input className="input" required value={def.name} disabled={!!def.id} onChange={(e) => setDef({ ...def, name: e.target.value })} /></label>
              <label className="field"><span className="label">種類</span><select className="input" value={def.kind} onChange={(e) => setDef({ ...def, kind: e.target.value })}>{Object.entries(r.kinds).map(([k, z]) => <option key={k} value={k}>{z}</option>)}</select></label>
              <label className="field"><span className="label">成熟度</span><select className="input" value={def.attrs.maturity ?? ""} onChange={(e) => setDef({ ...def, attrs: { ...def.attrs, maturity: e.target.value } })}>{r.maturity.map((m) => <option key={m}>{m}</option>)}</select></label>
            </div>
            <div className="row">
              {def.ends.map((en, k) => (
                <div key={k} className="row" style={{ flex: 1 }}>
                  <label className="field"><span className="label">第{k ? "二" : "一"}端名稱</span><input className="input" required value={en.name} onChange={(e) => setDef({ ...def, ends: def.ends.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></label>
                  <label className="field"><span className="label">連接埠定義</span><select className="input" required value={en.portDef ?? ""} onChange={(e) => setDef({ ...def, ends: def.ends.map((x, j) => (j === k ? { ...x, portDef: e.target.value } : x)) })}><option value="">選擇</option>{r.portDefs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
                  <label className="field"><span className="label">負責人</span><input className="input" value={def.attrs[k ? "ownerB" : "ownerA"] ?? ""} onChange={(e) => setDef({ ...def, attrs: { ...def.attrs, [k ? "ownerB" : "ownerA"]: e.target.value } })} /></label>
                </div>
              ))}
            </div>
            <span className="label">兩端數字的檢查（assert constraint）：例如「{def.ends[0].name}.電壓 == {def.ends[1].name}.電壓」</span>
            {def.constraints.map((c, k) => (
              <div key={k} className="row">
                <label className="field"><span className="label">名稱</span><input className="input" value={c.name} onChange={(e) => setDef({ ...def, constraints: def.constraints.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></label>
                <label className="field" style={{ flex: 3 }}><span className="label">式子</span><input className="input" value={c.text} onChange={(e) => setDef({ ...def, constraints: def.constraints.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} /></label>
                <button type="button" className="tbtn" onClick={() => setDef({ ...def, constraints: def.constraints.filter((_, j) => j !== k) })}>移除</button>
              </div>
            ))}
            <div className="tbtn-row"><button type="button" className="tbtn" onClick={() => setDef({ ...def, constraints: [...def.constraints, { name: `檢查${def.constraints.length + 1}`, text: "" }] })}>加一條檢查</button></div>
            <div className="row">
              <label className="field"><span className="label">驗證方法</span><select className="input" value={def.attrs.verificationMethod ?? ""} onChange={(e) => setDef({ ...def, attrs: { ...def.attrs, verificationMethod: e.target.value } })}><option value="">待補</option>{Object.entries(r.methods).map(([k, z]) => <option key={k} value={k}>{z}</option>)}</select></label>
              <label className="field"><span className="label">驗證負責人</span><input className="input" value={def.attrs.verificationOwner ?? ""} onChange={(e) => setDef({ ...def, attrs: { ...def.attrs, verificationOwner: e.target.value } })} /></label>
              <label className="field"><span className="label">驗證層級</span><select className="input" value={def.attrs.verificationLevel ?? ""} onChange={(e) => setDef({ ...def, attrs: { ...def.attrs, verificationLevel: e.target.value } })}><option value="">（次系統）</option>{r.levels.map((l) => <option key={l}>{l}</option>)}</select></label>
              <label className="field" style={{ flex: 2 }}><span className="label">理由</span><input className="input" value={def.attrs.rationale ?? ""} onChange={(e) => setDef({ ...def, attrs: { ...def.attrs, rationale: e.target.value } })} /></label>
            </div>
            <label className="field"><span className="label">說明</span><input className="input" value={def.doc} onChange={(e) => setDef({ ...def, doc: e.target.value })} /></label>
            <div className="tbtn-row"><button className="tbtn primary" disabled={busy}>{def.id ? "更新介面定義" : "新增介面定義"}</button>{def.id && <button type="button" className="tbtn" onClick={() => setDef(blankDef())}>取消</button>}
              {def.id && <span className="caption">改了之後，用到它的介面要兩端重新同意。</span>}</div>
          </form>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">連接埠定義</h2><span className="label">port def，帶要管的物理量</span></div>
        {r.portDefs.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>編號</th><th>名稱</th><th>物理量</th></tr></thead>
            <tbody>{r.portDefs.map((p) => (
              <tr key={p.id} className="rowbtn" aria-selected={port.id === p.id} tabIndex={0} onClick={() => !p.shared && setPort({ id: p.id, name: p.name, doc: p.doc, attrs: p.attrs.map((a) => ({ name: a.name, type: a.type })) })}>
                <td className="id">{p.shortName}</td><td>{p.name}</td><td>{p.attrs.map((a) => `${a.name}${a.unit ? ` [${a.unit}]` : ""}`).join("、") || "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {!ro && (
          <form onSubmit={savePort}>
            <div className="row">
              <label className="field" style={{ flex: 2 }}><span className="label">{port.id ? `修改連接埠定義 ${port.name}` : "新增連接埠定義"}</span><input className="input" required disabled={!!port.id} value={port.name} onChange={(e) => setPort({ ...port, name: e.target.value })} /></label>
              <label className="field" style={{ flex: 3 }}><span className="label">說明</span><input className="input" value={port.doc} onChange={(e) => setPort({ ...port, doc: e.target.value })} /></label>
            </div>
            {port.attrs.map((a, k) => (
              <div key={k} className="row">
                <label className="field"><span className="label">物理量名稱</span><input className="input" value={a.name} onChange={(e) => setPort({ ...port, attrs: port.attrs.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} /></label>
                <label className="field"><span className="label">型別</span><select className="input" value={a.type} onChange={(e) => setPort({ ...port, attrs: port.attrs.map((x, j) => (j === k ? { ...x, type: e.target.value } : x)) })}>{r.portTypes.map((t) => <option key={t.id} value={t.id}>{t.zh}{t.unit ? `（${t.unit}）` : ""}</option>)}</select></label>
                <button type="button" className="tbtn" onClick={() => setPort({ ...port, attrs: port.attrs.filter((_, j) => j !== k) })}>移除</button>
              </div>
            ))}
            <div className="tbtn-row"><button type="button" className="tbtn" onClick={() => setPort({ ...port, attrs: [...port.attrs, { name: "", type: "ScalarValues::Real" }] })}>加一個物理量</button>
              <button className="tbtn primary" disabled={busy}>{port.id ? "更新連接埠定義" : "新增連接埠定義"}</button>{port.id && <button type="button" className="tbtn" onClick={() => setPort({ id: "", name: "", doc: "", attrs: [{ name: "", type: "ScalarValues::Real" }] })}>取消</button>}</div>
          </form>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">次系統的連接埠與數字</h2><span className="label">外部提供的只管介面，數字是給定值</span></div>
        <table style={{ marginBottom: 16 }}>
          <thead><tr><th>次系統／元件</th><th>外部提供</th><th>連接埠與數字</th></tr></thead>
          <tbody>{r.parts.map((p) => (
            <tr key={p.id}>
              <td>{p.name}<div className="caption">{p.category}</div></td>
              <td><label className="check"><input type="checkbox" disabled={ro || busy} checked={p.given} onChange={(e) => void run(() => post("given", { id: p.id, given: e.target.checked }))} /><span className="caption">{p.given ? "給定值" : "自製"}</span></label></td>
              <td>{p.ports.map((q) => {
                const pd = r.portDefs.find((x) => x.id === q.portDef);
                const editing = editPort?.id === q.id;
                return (
                  <div key={q.id} className="row" style={{ alignItems: "center" }}>
                    <span className="body">{q.name} : {pd?.name ?? "—"}</span>
                    {editing && pd ? pd.attrs.map((a) => <label key={a.name} className="field"><span className="label">{a.name}{a.unit ? ` [${a.unit}]` : ""}</span><input className="input" value={editPort.values[a.name] ?? ""} onChange={(e) => setEditPort({ ...editPort, values: { ...editPort.values, [a.name]: e.target.value } })} /></label>)
                      : <span className="caption">{Object.entries(q.values).map(([k, x]) => `${k} = ${x}`).join("、") || "還沒有數字"}</span>}
                    {!ro && pd && (editing
                      ? <><button className="tbtn primary" disabled={busy} onClick={() => void run(() => post("ports", { id: q.id, values: editPort.values }), "已更新數字。").then((ok) => { if (ok) setEditPort(null); })}>儲存</button><button className="tbtn" onClick={() => setEditPort(null)}>取消</button></>
                      : <button className="tbtn" onClick={() => setEditPort({ id: q.id, values: Object.fromEntries(pd.attrs.map((a) => [a.name, (q.values[a.name] ?? "").replace(/\s*\[.*\]$/, "")])) })}>改數字</button>)}
                  </div>
                );
              })}</td>
            </tr>
          ))}</tbody>
        </table>
        {!ro && (
          <form onSubmit={(ev) => { ev.preventDefault(); void run(() => post("ports", addPort), "已新增連接埠。").then((ok) => { if (ok) setAddPort({ owner: addPort.owner, portDef: "", name: "", values: {} }); }); }}>
            <div className="row">
              <label className="field"><span className="label">在哪個次系統加連接埠</span><select className="input" required value={addPort.owner} onChange={(e) => setAddPort({ ...addPort, owner: e.target.value })}><option value="">選擇</option>{r.parts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="field"><span className="label">連接埠定義</span><select className="input" required value={addPort.portDef} onChange={(e) => setAddPort({ ...addPort, portDef: e.target.value, values: {} })}><option value="">選擇</option>{r.portDefs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className="field"><span className="label">名稱</span><input className="input" required value={addPort.name} onChange={(e) => setAddPort({ ...addPort, name: e.target.value })} placeholder="pwr" /></label>
              {r.portDefs.find((p) => p.id === addPort.portDef)?.attrs.map((a) => (
                <label key={a.name} className="field"><span className="label">{a.name}{a.unit ? ` [${a.unit}]` : ""}</span><input className="input" value={addPort.values[a.name] ?? ""} onChange={(e) => setAddPort({ ...addPort, values: { ...addPort.values, [a.name]: e.target.value } })} /></label>
              ))}
            </div>
            <div className="tbtn-row"><button className="tbtn primary" disabled={busy}>新增連接埠</button><span className="caption">數字可以先暫定（PDR），CDR 時凍結。</span></div>
          </form>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">介面的驗證</h2><span className="label">列入驗證矩陣</span></div>
        {r.verification.length === 0 ? <p className="caption">還沒有介面。</p> : (
          <table>
            <thead><tr><th>項目</th><th>驗證方法</th><th>驗證負責人</th><th>驗證層級</th><th>負責人</th><th>理由</th><th>結果</th></tr></thead>
            <tbody>{r.verification.map((v) => (
              <tr key={`${v.source}:${v.id}`} className="rowbtn" tabIndex={0} onClick={() => (v.source === "interface" ? setSel(v.id) : onOpen(v.id))}>
                <td>{v.name}</td><td>{r.methods[v.verificationMethod] ?? <span className="tag warn">待補</span>}</td><td>{v.verificationOwner || "—"}</td><td>{v.verificationLevel}</td><td>{v.owner || "—"}</td><td className="caption">{v.rationale}</td>
                <td>{v.result === "pass" ? <span className="tag done">通過</span> : v.result === "fail" ? <span className="tag danger">不通過</span> : <span className="tag">待驗證</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
