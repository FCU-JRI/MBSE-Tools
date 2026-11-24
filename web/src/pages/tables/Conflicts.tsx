// 衝突表（TAB-14、FW-06）：解析器對頂層零件實例判出不成立的 assert constraint（介面兩端不合、預算超過）。
// 衝突不存成元素；總工程師以上可以裁決，裁決會留下 DesignDecision 並連到受影響的需求。
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { View } from "../../api.ts";
import { listOf } from "../../model.ts";
import type { Props } from "../../Deliverables.tsx";
import { DataTable } from "./DataTable.tsx";
import type { Col } from "./DataTable.tsx";

interface Conflict {
  key: string; kind: "interface" | "budget"; elementId: string | null; name: string; shortName: string | null; top: string; condition: string;
  values: { name: string; value: string }[]; suggestions: string[];
  decision: { id: string; name: string; shortName: string | null; decidedBy: string; decidedOn: string; rationale: string } | null;
}
interface Result { ok: boolean; conflicts: Conflict[]; note?: string; canDecide: boolean }
const KIND_ZH = { interface: "介面不合", budget: "預算超過" };

export function Conflicts({ view, selectedId, onSelect, onChanged }: Props) {
  const id = view.project.id;
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Conflict | null>(null);
  const [why, setWhy] = useState("");
  const [reqs, setReqs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setErr("");
    api<Result>(`/projects/${id}/conflicts`).then((r) => live && setRes(r), (e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [id, view.analysis]);

  const allReqs = listOf(view.analysis.elements, "MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP");
  const reqName = (rid: string) => { const r = allReqs.find((x) => x.id === rid); return r ? `${r.shortName ?? ""} ${r.name}`.trim() : rid; };
  const open = (c: Conflict) => { setPick(c); setWhy(""); setReqs(c.suggestions); setErr(""); };
  const decide = async () => {
    if (!pick) return;
    setBusy(true); setErr("");
    try {
      const v = await api<View & { saved: boolean }>(`/projects/${id}/conflicts/decide`, "POST", { key: pick.key, rationale: why, requirements: reqs });
      setPick(null); onChanged(v);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const cols: Col<Conflict>[] = [
    { key: "kind", title: "種類", text: (c) => KIND_ZH[c.kind], render: (c) => <span className="tag danger">{KIND_ZH[c.kind]}</span> },
    { key: "name", title: "發生處", text: (c) => `${c.shortName ?? ""} ${c.name}`.trim(), render: (c) => <><span className="id">{c.shortName ?? "—"}</span><div className="caption">{c.name}</div></> },
    { key: "top", title: "頂層零件", text: (c) => c.top },
    { key: "cond", title: "不成立的式子", text: (c) => c.condition, cls: "id" },
    { key: "vals", title: "現值", text: (c) => c.values.map((v) => `${v.name}=${v.value}`).join("　") },
    { key: "state", title: "裁決", text: (c) => (c.decision ? `已裁決 ${c.decision.shortName ?? ""}` : "未裁決"),
      render: (c) => c.decision ? <span className="tag done" title={`${c.decision.decidedBy} ${c.decision.decidedOn}：${c.decision.rationale}`}>已裁決 {c.decision.shortName}</span>
        : res?.canDecide ? <button className="tbtn" onClick={(e) => { e.stopPropagation(); open(c); }}>裁決</button> : <span className="tag warn" title="只有總工程師以上能裁決">待總工程師</span> },
  ];
  const rows = res?.conflicts ?? [];
  return (
    <>
      <DataTable name="衝突" title="衝突" book={{ id, ok: view.analysis.ok }} rows={rows} cols={cols} rowId={(c) => c.key} selectedId={selectedId} onSelect={(c) => (c.decision ? onSelect(c.decision.id) : c.elementId && onSelect(c.elementId))}
        hint="由解析器對每個頂層零件實例判定：介面兩端的數字對不上，或預算加總超過配額，都算衝突。衝突不存成元素；次系統不自己協調，交總工程師裁決。"
        chips={[{ id: "open", label: "未裁決", test: (c) => !c.decision }, { id: "done", label: "已裁決", test: (c) => !!c.decision }]}
        empty={res === null ? "判定中…" : res.ok ? "目前沒有衝突。" : res.note} />
      {err && !pick && <p className="caption" role="alert">{err}</p>}
      {pick && (
        <section className="section" aria-label="裁決衝突">
          <div className="section-head"><h2 className="section-title">裁決：{pick.name}</h2><span className="label">{pick.condition}</span></div>
          <p className="body">理由會留成設計決策（DesignDecision），裁決者與日期自動記錄；決策用 #trace 連到這個衝突與下面勾選的需求。</p>
          <label className="label" htmlFor="why">理由</label>
          <textarea id="why" value={why} onChange={(e) => setWhy(e.target.value)} rows={3} style={{ width: "100%" }} />
          <p className="label" style={{ marginTop: 8 }}>受影響的需求{pick.suggestions.length > 0 ? "（已勾選與這個衝突有關係的需求）" : ""}</p>
          <div style={{ maxHeight: 180, overflow: "auto" }}>{allReqs.map((r) => (
            <label key={r.id} style={{ display: "block" }}><input type="checkbox" checked={reqs.includes(r.id)} onChange={(e) => setReqs((l) => (e.target.checked ? [...l, r.id] : l.filter((x) => x !== r.id)))} /> {reqName(r.id)}</label>
          ))}</div>
          {err && <p className="caption" role="alert">{err}</p>}
          <div className="tbtn-row"><button className="tbtn primary" disabled={busy || !why.trim()} onClick={decide}>送出裁決</button><button className="tbtn" onClick={() => setPick(null)}>取消</button></div>
        </section>
      )}
    </>
  );
}
