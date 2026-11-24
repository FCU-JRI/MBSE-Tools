// 審查節點卡：一張卡一個節點（橫排）。點卡展開：還缺項目、審查報告、簽核紀錄、核可／退回（沿用 GatesView）。
import { useState } from "react";
import { api } from "../../api.ts";
import type { View } from "../../api.ts";
import type { Me } from "../../api.ts";
import { GatesView } from "../../Views.tsx";
import { gateApproved, todayStr } from "./util.ts";

/** 框架檢查（MGT-02，WP3）：由 framework/jri.json 產生，含各層設計迴圈是否走完；不算進既有的 done／total */
type FwCheck = { id: string; label: string; pass: boolean; pending: boolean; detail: string; missing: { id: string; name: string }[] };
const fwChecks = (g: View["gates"][number]) => ((g as typeof g & { framework?: FwCheck[] }).framework ?? []);

export function GateCards({ view, user, subsystems, openId, onOpen, setView, onSelect }: {
  view: View; user: Me; subsystems: string[]; openId: string | null; onOpen: (id: string | null) => void; setView: (v: View) => void; onSelect: (id: string) => void;
}) {
  const [error, setError] = useState("");
  const setDate = async (gate: string, date: string) => {
    setError("");
    try { setView(await api<View>(`/projects/${view.project.id}/milestones`, "POST", { gate, date })); } catch (e) { setError((e as Error).message); }
  };
  const firstOpen = view.gates.find((g) => !gateApproved(view, g.id, subsystems))?.id;
  const approvedCount = view.gates.filter((g) => gateApproved(view, g.id, subsystems)).length;
  const open = view.gates.find((g) => g.id === openId);
  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">審查節點</h1><span className="label">{approvedCount} / {view.gates.length} 已核可</span></div>
      {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
      <div className="mg-cards">
        {view.gates.map((g) => {
          const ok = gateApproved(view, g.id, subsystems), plan = view.milestones[g.id] ?? "";
          const late = !ok && plan !== "" && plan < todayStr();
          const missing = g.checks.filter((c) => !c.pass);
          return (
            <div key={g.id} className={`mg-card ${ok ? "ok" : ""} ${g.id === firstOpen ? "cur" : ""}`} data-gate={g.id}>
              <button className="mg-card-main" aria-expanded={g.id === openId} aria-controls="mg-gate-detail" onClick={() => onOpen(g.id === openId ? null : g.id)}>
                <span className="heading">{g.zh}</span>
                <span className="label">{g.en}</span>
                <span className="meter"><span style={{ width: `${ok ? 100 : g.total ? (g.done / g.total) * 100 : 0}%` }} /></span>
                <span className="caption">{g.done} / {g.total} 項完成</span>
                {fwChecks(g).length > 0 && <span className="caption" data-fw-gate={g.id}>框架檢查 {fwChecks(g).filter((c) => c.pass).length} / {fwChecks(g).length}</span>}
                <span className={`caption ${missing.length ? "" : "faint"}`}>{missing.length ? `還缺 ${missing.length} 項：${missing[0].label}${missing.length > 1 ? "…" : ""}` : "檢查項目齊全"}</span>
                <span>{ok ? <span className="tag done">DONE</span> : late ? <span className="tag danger">LATE</span> : g.id === firstOpen ? <span className="tag">進行中</span> : <span className="faint">—</span>}</span>
              </button>
              {user.caps.confirm
                ? <label className="field" style={{ margin: 0 }}><span className="label">預定日期</span><input className="input" style={{ height: 28, fontSize: 13 }} type="date" value={plan} onChange={(e) => setDate(g.id, e.target.value)} /></label>
                : <span className="caption">預定　{plan || g.deadline || "—"}</span>}
              {g.deadline && <span className="caption faint">AEAS 期限　{g.deadline}</span>}
            </div>
          );
        })}
      </div>
      {open && <div id="mg-gate-detail" className="mg-detail"><GatesView user={user} view={view} gateId={open.id} setView={setView} onSelect={onSelect} nested />
        {fwChecks(open).length > 0 && (
          <div className="section" data-fw="gate-checks">
            <div className="section-head"><h2 className="section-title">框架檢查</h2><span className="label">來自 framework/jri.json · 不計入上方完成數</span></div>
            <ul className="guide-missing">{fwChecks(open).map((c) => (
              <li key={c.id}><span className={c.pass ? "tag done" : c.pending ? "tag" : "tag danger"}>{c.pass ? "OK" : c.pending ? "待接" : "缺"}</span>
                <span className="body">{c.label}</span><span className="caption">{c.detail}</span>
                {c.missing.slice(0, 3).map((m) => <button key={m.id} className="tbtn" onClick={() => onSelect(m.id)}>{m.name}</button>)}</li>
            ))}</ul>
          </div>
        )}</div>}
    </section>
  );
}
