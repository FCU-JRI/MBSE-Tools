import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "./api.ts";
import type { Element, Gate, Me, Meta, View } from "./api.ts";
import { label, listOf } from "./model.ts";
import { methodZh } from "./Inspector.tsx";
import { DataTable } from "./pages/tables/DataTable.tsx";
import type { Col } from "./pages/tables/DataTable.tsx";


export function TableView({ view, meta, catId, selectedId, onSelect }: { view: View; meta: Meta; catId: string; selectedId: string | null; onSelect: (id: string) => void }) {
  const cat = meta.categories.find((c) => c.id === catId) ?? meta.categories[0];
  const els = view.analysis.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const rows = listOf(els, cat.id);
  const rel = (e: Element) => [
    ...view.analysis.relations.filter((r) => r.from === e.id && r.kind !== "succession" && r.kind !== "connect").map((r) => ({ zh: meta.relations[r.kind]?.zh ?? r.kind, o: byId.get(r.to) })),
    ...view.analysis.relations.filter((r) => r.to === e.id && r.kind !== "succession" && r.kind !== "connect").map((r) => ({ zh: `被${meta.relations[r.kind]?.zh ?? r.kind}`, o: byId.get(r.from) })),
  ].filter((x) => x.o);
  const fields = (e: Element) => (cat.fields ?? []).filter((f) => e.attrs[f.name]);
  const cols: Col<Element>[] = [
    { key: "id", title: "編號", text: (e) => e.shortName ?? "", cls: "id" },
    { key: "name", title: "名稱", text: (e) => e.name },
    { key: "content", title: "內容", text: (e) => [e.doc, ...fields(e).map((f) => `${f.zh} ${e.attrs[f.name]}`), e.attrs.kind ? `方法 ${methodZh(e.attrs.kind)}` : ""].filter(Boolean).join("；"),
      render: (e) => <>
        {e.doc && <div>{e.doc}</div>}
        {fields(e).map((f) => <div key={f.name}><span className="faint">{f.zh}　</span>{e.attrs[f.name]}</div>)}
        {e.attrs.kind && <div><span className="faint">方法　</span>{methodZh(e.attrs.kind)}</div>}
      </> },
    { key: "rel", title: "關係", text: (e) => rel(e).map((r) => `${r.zh} ${label(r.o as Element)}`).join("；"), render: (e) => <>{rel(e).map((r, i) => <div key={i}><span className="faint">{r.zh}　</span>{label(r.o as Element)}</div>)}</> },
  ];
  return <DataTable name={cat.zh} title={cat.zh} hint={cat.help} book={{ id: view.project.id, ok: view.analysis.ok }} rows={rows} cols={cols} rowId={(e) => e.id} selectedId={selectedId} onSelect={(e) => onSelect(e.id)} empty={`還沒有${cat.zh}。到「模型」頁新增第一個。`} />;
}

export function TraceView({ view, selectedId, onSelect }: { view: View; selectedId: string | null; onSelect: (id: string) => void }) {
  const els = view.analysis.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const reqs = listOf(els, "SystemRequirement", "SubsystemRequirement", "ComponentRequirement");
  const sat = new Map(view.analysis.satisfaction.map((s) => [s.requirement, s.status]));
  const cell = (list: (Element | undefined)[]): ReactNode => (list.length ? list.map((e, i) => e && <div key={i}>{label(e)}</div>) : <span className="tag danger">MISS</span>);
  const outs = (e: Element, ...k: string[]) => view.analysis.relations.filter((r) => r.from === e.id && k.includes(r.kind)).map((r) => byId.get(r.to));
  const ins = (e: Element, ...k: string[]) => view.analysis.relations.filter((r) => r.to === e.id && k.includes(r.kind)).map((r) => byId.get(r.from));
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">需求追溯</h1><span className="label">{reqs.length}</span></div>
      <p className="body muted" style={{ marginBottom: 16 }}>每條需求都要有來源、滿足者與驗證事件。標 MISS 的是還沒補上的。</p>
      {reqs.length === 0 ? <p className="body">還沒有需求。</p> : (
        <table>
          <thead><tr><th>編號</th><th>需求</th><th>衍生自</th><th>滿足者</th><th>驗證事件</th><th>計算判定</th></tr></thead>
          <tbody>{reqs.map((e) => {
            const s = sat.get(e.qualifiedName);
            return (
              <tr key={e.id} className="rowbtn" aria-selected={e.id === selectedId} onClick={() => onSelect(e.id)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onSelect(e.id); }}>
                <td className="id">{e.shortName ?? "—"}</td>
                <td><div>{e.name}</div><div className="caption">{e.doc}</div></td>
                <td>{cell(outs(e, "derive", "refine", "trace"))}</td>
                <td>{cell(ins(e, "satisfy"))}</td>
                <td>{cell(ins(e, "verify"))}</td>
                <td>{s === "holds" ? <span className="tag done">PASS</span> : s === "fails" ? <span className="tag danger">FAIL</span> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      <p className="caption" style={{ marginTop: 12 }}>計算判定由模型中的數值條件與設計值算出，帶單位檢查。沒有數值條件的需求不判定。</p>
    </section>
  );
}

export function GatesView({ user, view, gateId, setView, onSelect }: { user: Me; view: View; gateId: string; setView: (v: View) => void; onSelect: (id: string) => void }) {
  const gate = view.gates.find((g) => g.id === gateId) ?? view.gates[0];
  const [error, setError] = useState("");
  if (!gate) return <p className="body">這個專案沒有設定節點。</p>;
  const toggle = async (key: string, done: boolean) => {
    setError("");
    try { setView(await api<View>(`/projects/${view.project.id}/manual`, "POST", { key, done })); } catch (e) { setError((e as Error).message); }
  };
  return (
    <>
      <section className="section">
        <div className="section-head"><h1 className="section-title">{gate.zh}</h1><span className="label">{gate.en} · {gate.done} / {gate.total}</span></div>
        <p className="body">{gate.purpose}</p>
        <div className="tbtn-row" style={{ margin: "8px 0" }}>
          <span className="label">審查報告</span>
          <a className="tbtn primary" href={`/api/projects/${view.project.id}/report?gate=${gate.id}`} target="_blank" rel="noreferrer">開啟（可列印成 PDF）</a>
          <a className="tbtn" href={`/api/projects/${view.project.id}/report?gate=${gate.id}&format=docx`}>下載 Word</a>
        </div>
        <p className="caption" style={{ margin: "8px 0 16px" }}>核可者　{gate.approver}{gate.deadline ? `　　期限　${gate.deadline}` : ""}{gate.perSubsystem ? "　　各次系統分場審查" : ""}</p>
        {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
        <ul className="checks">{gate.checks.map((c) => (
          <li key={c.id}>
            <span>{c.pass ? <span className="tag done">DONE</span> : <span className="tag">TODO</span>}</span>
            <div>
              <div className="what">{c.label}　<span className="faint">{c.detail}</span></div>
              {!c.pass && <div className="caption" style={{ marginTop: 4 }}>怎麼做　{c.hint}</div>}
              {c.missing.length > 0 && <div className="tbtn-row" style={{ paddingLeft: 8 }}><span className="label">還缺</span>{c.missing.map((m) => <button key={m.id} className="tbtn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 12 }} onClick={() => onSelect(m.id)}>{m.name}</button>)}</div>}
              {c.manual && user.caps.confirm && <label className="check"><input type="checkbox" checked={c.pass} onChange={(e) => toggle(c.id, e.target.checked)} /><span className="caption">我已確認這一項</span></label>}
            </div>
          </li>
        ))}</ul>
      </section>
      <Signoff user={user} view={view} gate={gate} setView={setView} />
    </>
  );
}

/** 簽核紀錄。撤回（REVOKE）是另一筆紀錄，原紀錄不刪；api.ts 的型別只有 APPROVE／DENY，這裡放寬讀取。 */
type SignRec = Omit<View["project"]["signoffs"][number], "decision"> & { decision: string; revokes?: string };

function Signoff({ user, view, gate, setView }: { user: Me; view: View; gate: Gate; setView: (v: View) => void }) {
  const subsystems = listOf(view.analysis.elements, "Subsystem");
  const [form, setForm] = useState({ subsystem: "", comment: "" });
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const records = (view.project.signoffs as SignRec[]).filter((s) => s.gate === gate.id);
  const revokedBy = new Map(records.filter((s) => s.decision === "REVOKE" && s.revokes).map((s) => [s.revokes as string, s]));
  // 只能撤回同一節點（與次系統）最新一筆、尚未撤回的簽核
  const latest = new Set<string>(), seen = new Set<string>();
  for (const s of [...records].reverse()) {
    const k = s.subsystem ?? "";
    if (s.decision === "REVOKE" || revokedBy.has(s.at) || seen.has(k)) continue;
    seen.add(k); latest.add(s.at);
  }
  const at = (t: string) => new Date(t).toLocaleString("zh-TW", { hour12: false });
  const submit = async (decision: "APPROVE" | "DENY") => {
    setError("");
    if (gate.perSubsystem && !form.subsystem) return setError("請選擇這次審查的次系統。");
    try {
      setView(await api<View>(`/projects/${view.project.id}/signoffs`, "POST", { gate: gate.id, decision, subsystem: form.subsystem || null, comment: form.comment }));
      setForm({ ...form, comment: "" });
    } catch (e) { setError((e as Error).message); }
  };
  const revoke = async (t: string) => {
    setError("");
    try { setView(await api<View>(`/projects/${view.project.id}/signoffs/revoke`, "POST", { at: t, comment: reason })); setRevoking(null); setReason(""); }
    catch (e) { setError((e as Error).message); }
  };
  const canRevoke = !!user.rank && !view.branch;
  const tag = (d: string) => d === "APPROVE" ? "done" : d === "REVOKE" ? "" : "danger";
  return (
    <section className="section">
      <div className="section-head"><h2 className="section-title">簽核</h2><span className="label">{records.length}</span></div>
      {records.length > 0 && (
        <table style={{ marginBottom: 16 }}>
          <thead><tr><th>決議</th><th>次系統</th><th>簽核人</th><th>意見</th><th>時間</th><th>版本</th><th></th></tr></thead>
          <tbody>{records.map((s, i) => {
            const rv = revokedBy.get(s.at);
            const orig = s.decision === "REVOKE" ? records.find((r) => r.at === s.revokes) : undefined;
            return (
              <tr key={i}>
                <td><span className={`tag ${tag(s.decision)}`} style={rv ? { textDecoration: "line-through" } : undefined}>{s.decision === "REVOKE" ? "撤回" : s.decision}</span></td>
                <td>{s.subsystem ?? "—"}</td><td>{s.by}<div className="caption">{s.role}</div></td>
                <td>{s.decision === "REVOKE" ? <>撤回 {orig ? `${orig.by} 於 ${at(orig.at)} 的 ${orig.decision}` : "一筆簽核"}{s.comment ? `：${s.comment}` : ""}</> : s.comment}
                  {rv && <div className="caption">已由 {rv.by} 於 {at(rv.at)} 撤回</div>}</td>
                <td className="id">{at(s.at)}</td><td className="id">{s.commit}</td>
                <td>{canRevoke && latest.has(s.at) && (revoking === s.at
                  ? <div className="stack"><input className="input" placeholder="撤回原因（選填）" aria-label="撤回原因" value={reason} onChange={(e) => setReason(e.target.value)} />
                      <div className="tbtn-row" style={{ paddingLeft: 0 }}><button className="tbtn primary" onClick={() => revoke(s.at)}>確定撤回</button><button className="tbtn" onClick={() => setRevoking(null)}>取消</button></div></div>
                  : <button className="tbtn" onClick={() => { setRevoking(s.at); setReason(""); }} title="按錯時用。原紀錄保留，另記一筆誰在何時撤回">撤回</button>)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
      {records.some((s) => s.decision === "REVOKE") && <p className="caption" style={{ marginBottom: 12 }}>撤回不會刪掉原紀錄，也不會刪除核可時打的基線標籤；撤回後這個節點視為尚未簽核，要重新簽。</p>}
      {view.branch && <p className="caption">節點簽核只能在 main 進行。這個分支合併進 main 之後，再到 main 簽核。</p>}
      {user.rank && !view.branch && <>
      <div className="row">
        {gate.perSubsystem && <label className="field"><span className="label">次系統</span><select className="input" value={form.subsystem} onChange={(e) => setForm({ ...form, subsystem: e.target.value })}><option value="">請選擇</option>{subsystems.map((s) => <option key={s.id}>{s.name}</option>)}</select></label>}
        <label className="field" style={{ flex: 2 }}><span className="label">意見</span><input className="input" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label>
      </div>
      {gate.done < gate.total && <p className="caption">還有 {gate.total - gate.done} 項未完成。仍可簽核，請在意見中說明。</p>}
      {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
      <div className="tbtn-row"><button className="tbtn primary" onClick={() => submit("APPROVE")}>核可 · APPROVE</button><button className="tbtn" onClick={() => submit("DENY")}>退回 · DENY</button></div>
      <p className="caption">以 {user.name}（{user.rankZh}）的身分簽核；職級不符會被拒絕。核可時在版本紀錄打上基線標籤。按錯可以撤回最新一筆，會留下撤回紀錄。</p>
      </>}
    </section>
  );
}

export function HistoryView({ id }: { id: string }) {
  const [rows, setRows] = useState<{ commit: string; author: string; date: string; message: string }[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<typeof rows>(`/projects/${id}/history`).then(setRows).catch((e) => setError(e.message)); }, [id]);
  if (error) return <p className="msg"><span className="tag danger">ERR</span>{error}</p>;
  if (!rows) return <p className="label">載入中</p>;
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">修改紀錄</h1><span className="label">{rows.length}</span></div>
      <table>
        <thead><tr><th>版本</th><th>時間</th><th>修改者</th><th>內容</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.commit}><td className="id">{r.commit}</td><td className="id">{new Date(r.date).toLocaleString("zh-TW", { hour12: false })}</td><td>{r.author}</td><td>{r.message}</td></tr>)}</tbody>
      </table>
    </section>
  );
}
