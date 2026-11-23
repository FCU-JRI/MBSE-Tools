// 專案管理：頂部指標 → 審查節點卡 → 甘特圖／任務 → 人員 → 成本圓環 → 專案設定。
import { useState } from "react";
import { PlanView } from "../Plan.tsx";
import type { Pm } from "../Plan.tsx";
import { Columns, SelectionPane } from "../layout.tsx";
import { listOf } from "../model.ts";
import type { PageProps } from "../workspace.ts";
import { GateCards } from "./manage/GateCards.tsx";
import { Metrics } from "./manage/Metrics.tsx";
import { Settings } from "./manage/Settings.tsx";
import "./manage.css";

export function ManagePage(p: PageProps) {
  const { view } = p;
  const [pm, setPm] = useState<Pm | null>(null);
  const subsystems = listOf(view.analysis.elements, "Subsystem").map((s) => s.name);
  const onSelect = (eid: string) => p.setSel({ type: "element", id: eid });
  return (
    <Columns right={p.sel ? <SelectionPane {...p} toModel /> : undefined}>
      <div className="center-scroll">
        <Metrics view={view} pm={pm} subsystems={subsystems} />
        <GateCards view={view} user={p.user} subsystems={subsystems} openId={p.spot.gateId} onOpen={(id) => p.setSpot({ gateId: id })} setView={p.setView} onSelect={onSelect} />
        <PlanView view={view} meta={p.meta} user={p.user} onPm={setPm} />
        <Settings view={view} meta={p.meta} user={p.user} setView={p.setView} />
      </div>
    </Columns>
  );
}
