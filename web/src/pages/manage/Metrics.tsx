// 專案管理頂部 4 指標：下一個節點、任務完成、預算使用、人員與次系統
import type { View } from "../../api.ts";
import type { Pm } from "../../Plan.tsx";
import { dayNum, gateApproved, nt, todayStr } from "./util.ts";

export function Metrics({ view, pm, subsystems }: { view: View; pm: Pm | null; subsystems: string[] }) {
  const next = view.gates.find((g) => !gateApproved(view, g.id, subsystems));
  const date = next ? view.milestones[next.id] ?? "" : "";
  const left = date ? dayNum(date) - dayNum(todayStr()) : null;
  const tasks = pm?.tasks ?? [], costs = pm?.costs ?? [], people = pm?.people ?? [];
  const late = tasks.filter((t) => !t.done && t.end < todayStr()).length;
  const planned = costs.reduce((s, c) => s + c.planned, 0), actual = costs.reduce((s, c) => s + c.actual, 0);
  const rate = planned ? Math.round((actual / planned) * 100) : null;
  return (
    <div className="mg-metrics" role="list" aria-label="專案指標">
      <div className="mg-metric" role="listitem" data-metric="next">
        <span className="label">下一個節點</span>
        {next ? <>
          <span className={`mg-big ${left !== null && left < 0 ? "bad" : ""}`}>{left === null ? "未設日期" : left < 0 ? `逾期 ${-left} 天` : left === 0 ? "今天" : `剩 ${left} 天`}</span>
          <span className="caption">{next.zh}{date ? `　${date}` : ""}</span>
        </> : <><span className="mg-big">全部核可</span><span className="caption">{view.gates.length} 個節點</span></>}
      </div>
      <div className="mg-metric" role="listitem" data-metric="tasks">
        <span className="label">任務完成</span>
        <span className="mg-big">{tasks.filter((t) => t.done).length} / {tasks.length}</span>
        <span className={`caption ${late ? "bad" : ""}`}>{late ? `${late} 項逾期` : "沒有逾期"}</span>
      </div>
      <div className="mg-metric" role="listitem" data-metric="budget">
        <span className="label">預算使用</span>
        <span className={`mg-big ${rate !== null && rate > 100 ? "bad" : ""}`}>{rate === null ? "—" : `${rate}%`}</span>
        <span className="caption">{nt(actual)} / {nt(planned)} 元</span>
      </div>
      <div className="mg-metric" role="listitem" data-metric="people">
        <span className="label">人員與次系統</span>
        <span className="mg-big">{people.length} 人</span>
        <span className="caption">{subsystems.length} 個次系統</span>
      </div>
    </div>
  );
}
