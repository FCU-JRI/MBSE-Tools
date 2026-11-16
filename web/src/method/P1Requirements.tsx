// P1：驗證矩陣頁（METHOD.md 第 3 節圖 8）與需求共同屬性的表單（docs/IMPL-PLAN.md P1）。
import { useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api.ts";
import type { Element, View } from "../api.ts";
import type { MethodPageProps } from "./registry.ts";
import { LEVELS, METHODS, methodsZh, optZh, reqInfo, STATUSES, TYPES, verificationRows, VERIFIABLE } from "../../../server/method/p1-req.ts";
import type { ReqInput } from "../../../server/method/p1-req.ts";

const VERDICT: Record<string, ReactNode> = {
  holds: <span className="tag done">通過</span>,
  fails: <span className="tag danger">不通過</span>,
};
const CAT_ZH: Record<string, string> = { MissionRequirement: "任務", SystemRequirement: "系統", SubsystemRequirement: "次系統", ComponentRequirement: "元件", MOE: "MOE", MOP: "MOP" };

export interface ReqForm { method: string[]; verificationLead: string; verificationLevel: string; responsible: string; rationale: string; status: string; type: string }
export const emptyReqForm = (): ReqForm => ({ method: [], verificationLead: "", verificationLevel: "", responsible: "", rationale: "", status: "", type: "" });
const formOf = (e: Element): ReqForm => { const i = reqInfo(e); return { method: i.methods, verificationLead: i.verificationLead, verificationLevel: i.verificationLevel, responsible: i.responsible, rationale: i.rationale, status: i.status, type: i.type }; };
export const toInput = (f: ReqForm): ReqInput => ({ ...f });

/** 需求的共同屬性欄位。需要驗證的類別，驗證方法必填（METHOD.md 2.1） */
export function RequirementFields({ category, value, onChange }: { category: string; value: ReqForm; onChange: (v: ReqForm) => void }) {
  const need = VERIFIABLE.includes(category);
  const set = (k: keyof ReqForm, v: string) => onChange({ ...value, [k]: v });
  const toggle = (m: string) => onChange({ ...value, method: value.method.includes(m) ? value.method.filter((x) => x !== m) : [...value.method, m] });
  const select = (k: "verificationLevel" | "status" | "type", zh: string, list: readonly { id: string; zh: string }[], hint = "未填") => (
    <label className="field"><span className="label">{zh}</span>
      <select className="input" value={value[k]} onChange={(e) => set(k, e.target.value)}><option value="">{hint}</option>{list.map((o) => <option key={o.id} value={o.id}>{o.zh}</option>)}</select>
    </label>
  );
  return (
    <>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend className="label">驗證方法{need ? "（必填，可複選）" : "（可複選）"}</legend>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          {METHODS.map((m) => <label key={m.id} className="check"><input type="checkbox" checked={value.method.includes(m.id)} onChange={() => toggle(m.id)} /><span className="caption">{m.zh} {m.en}</span></label>)}
        </div>
        {need && value.method.length === 0 && <p className="caption"><span className="tag warn">必填</span> 不知道怎麼驗證的需求，通常代表需求本身還沒寫好。</p>}
      </fieldset>
      {select("type", "需求類型", TYPES)}
      {select("verificationLevel", "驗證層級", LEVELS, "依類別推定")}
      <label className="field"><span className="label">驗證負責人</span><input className="input" value={value.verificationLead} onChange={(e) => set("verificationLead", e.target.value)} /></label>
      <label className="field"><span className="label">負責人</span><input className="input" value={value.responsible} onChange={(e) => set("responsible", e.target.value)} /></label>
      <label className="field"><span className="label">理由 Rationale</span><input className="input" value={value.rationale} onChange={(e) => set("rationale", e.target.value)} /></label>
      {select("status", "狀態", STATUSES.map((s) => ({ id: s.id, zh: `${s.en}（${s.zh}）` })))}
    </>
  );
}

/** 圖 8 驗證矩陣：每條需求、驗證方法、驗證事件、結果 */
export function VerificationMatrix({ view, user, onChanged, onOpen }: MethodPageProps) {
  const a = view.analysis;
  const [gap, setGap] = useState(false);
  const [editing, setEditing] = useState<{ id: string; form: ReqForm } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!a.ok) return <section className="section"><h1 className="section-title">驗證矩陣</h1><p className="caption">模型有錯誤，修正後才能顯示。</p></section>;
  const all = verificationRows(a);
  const rows = all.filter((r) => !gap || r.gaps.length);
  const pid = view.project.id;
  const save = async () => {
    if (!editing) return;
    setBusy(true); setMsg(null);
    try { onChanged(await api<View>(`/projects/${pid}/requirements/info`, "POST", { id: editing.id, ...toInput(editing.form) })); setEditing(null); setMsg({ ok: true, text: "已寫入。" }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const label = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">驗證矩陣</h1><span className="label">{all.length} 條 · 缺驗證方法 {all.filter((r) => !r.info.methods.length).length} · 缺驗證事件 {all.filter((r) => !r.events.length).length}</span></div>
      <p className="caption" style={{ marginBottom: 12 }}>每條需求要怎麼證明有做到？結果如何？驗證方法在建立需求時就要填；驗證事件到「表」新增「驗證事件」並指定要驗證的需求。</p>
      <div className="row no-print" style={{ alignItems: "center", gap: 16 }}>
        <label className="check"><input type="checkbox" checked={gap} onChange={(e) => setGap(e.target.checked)} /><span className="caption">只看有缺項的</span></label>
        <span style={{ flex: 1 }} />
        <a className="tbtn" href={`/api/projects/${pid}/requirements/vcrm.xlsx`}>匯出需求矩陣（比賽格式）</a>
      </div>
      {msg && <p className="msg">{msg.ok ? <span className="tag done">OK</span> : <span className="tag danger">ERR</span>}{msg.text}</p>}
      {rows.length === 0 ? <p className="body">{all.length ? "沒有符合條件的需求。" : "還沒有需求。到「表」新增任務需求或系統需求。"}</p> : (
        <table>
          <thead><tr><th>編號</th><th>類別</th><th>需求</th><th>驗證方法</th><th>層級</th><th>驗證負責人</th><th>驗證事件</th><th>結果</th><th>狀態</th><th>類型</th><th className="no-print" /></tr></thead>
          <tbody>{rows.map((r) => {
            const e = r.element as Element;
            const open = editing?.id === e.id;
            return [
              <tr key={e.id} className="rowbtn" onClick={() => onOpen(e.id)}>
                <td className="id">{e.shortName ?? "—"}</td>
                <td className="id">{CAT_ZH[e.category ?? ""] ?? ""}</td>
                <td><div>{e.name}</div><div className="caption">{e.doc}</div>{r.info.rationale && <div className="faint">理由：{r.info.rationale}</div>}</td>
                <td>{r.info.methods.length ? methodsZh(r.info.methods) : <span className="tag danger">缺</span>}</td>
                <td>{r.level ? optZh(LEVELS, r.level) : "—"}</td>
                <td>{r.info.verificationLead || <span className="faint">—</span>}</td>
                <td>{r.events.length ? r.events.map((v) => <div key={v.id}>{label(v as Element)}{reqInfo(v).methods.length > 0 && <span className="faint">　{methodsZh(reqInfo(v).methods)}</span>}</div>) : <span className="tag danger">缺</span>}</td>
                <td>{VERDICT[r.verdict] ?? <span className="faint">未判定</span>}</td>
                <td>{r.info.status ? STATUSES.find((s) => s.id === r.info.status)?.en : <span className="faint">—</span>}</td>
                <td>{r.info.type ? optZh(TYPES, r.info.type) : <span className="faint">—</span>}</td>
                <td className="no-print">{user.caps.edit && !view.project.readOnly && <button className="tbtn" onClick={(ev) => { ev.stopPropagation(); setMsg(null); setEditing(open ? null : { id: e.id, form: formOf(e) }); }}>{open ? "取消" : "編輯"}</button>}</td>
              </tr>,
              open && editing && <tr key={`${e.id}:edit`}><td colSpan={11}>
                <div style={{ maxWidth: 520, padding: "8px 0" }}>
                  <RequirementFields category={e.category ?? ""} value={editing.form} onChange={(form) => setEditing({ id: e.id, form })} />
                  <button className="btn" disabled={busy} onClick={save}>{busy ? "寫入中" : "寫入"}</button>
                </div>
              </td></tr>,
            ];
          })}</tbody>
        </table>
      )}
    </section>
  );
}
