// 專案管理：審查節點（原「節點」頁與左欄節點進度）、里程碑路徑（原「產出物 › 開發路徑」）、時程甘特圖、人員、成本（原「時程」頁）。
import { GatesView } from "../Views.tsx";
import { Milestones } from "../Deliverables.tsx";
import { PlanView } from "../Plan.tsx";
import { Columns, SelectionPane } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import "./manage.css";

export function ManagePage(p: PageProps) {
  const { view } = p;
  const gateId = p.spot.gateId ?? view.gates[0]?.id ?? "";
  const onSelect = (eid: string) => p.setSel({ type: "element", id: eid });
  const selectedId = p.sel?.type === "element" ? p.sel.id : null;
  return (
    <Columns right={p.sel ? <SelectionPane {...p} toModel /> : undefined}>
      <div className="center-scroll">
        <section className="section">
          <div className="section-head"><h1 className="section-title">審查節點</h1><span className="label">{view.gates.length}</span></div>
          <ul className="tree manage-gates">{view.gates.map((g) => (
            <li key={g.id}><button className="tree-row gate-row" aria-current={g.id === gateId} onClick={() => p.setSpot({ gateId: g.id })}>
              <span className="tn">{g.zh}</span><span className="meter"><span style={{ width: `${g.total ? (g.done / g.total) * 100 : 0}%` }} /></span><span className="tc">{g.done} / {g.total}</span>
            </button></li>
          ))}</ul>
        </section>
        <GatesView user={p.user} view={view} gateId={gateId} setView={p.setView} onSelect={onSelect} />
        <Milestones view={view} meta={p.meta} user={p.user} selectedId={selectedId} onSelect={onSelect} onChanged={p.setView} />
        <PlanView view={view} meta={p.meta} user={p.user} />
      </div>
    </Columns>
  );
}
