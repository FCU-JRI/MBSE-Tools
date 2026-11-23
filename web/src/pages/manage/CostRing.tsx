// 成本圓環：外圈＝各次系統預算，內圈細環＝整體已支出，中央＝使用率。純 SVG。
import { nt } from "./util.ts";

export interface CostLike { subsystem: string; planned: number; actual: number }
interface Group { name: string; planned: number; actual: number }

export const groupCosts = (costs: CostLike[]): Group[] => {
  const m = new Map<string, Group>();
  for (const c of costs) {
    const name = c.subsystem || "未分類";
    const g = m.get(name) ?? { name, planned: 0, actual: 0 };
    g.planned += c.planned; g.actual += c.actual; m.set(name, g);
  }
  return [...m.values()];
};

const R1 = 92, W1 = 22, R2 = 64, W2 = 6, C = 120;
const circ = (r: number) => 2 * Math.PI * r;

export function CostRing({ costs, selected, onSelect }: { costs: CostLike[]; selected: string | null; onSelect: (name: string | null) => void }) {
  const groups = groupCosts(costs);
  const planned = groups.reduce((s, g) => s + g.planned, 0), actual = groups.reduce((s, g) => s + g.actual, 0);
  const rate = planned ? actual / planned : null;
  const L1 = circ(R1), L2 = circ(R2);
  let acc = 0;
  const segs = groups.map((g, i) => {
    const len = planned ? (g.planned / planned) * L1 : 0;
    const gap = groups.length > 1 && len > 3 ? 2 : 0;
    const seg = { g, i, len: Math.max(len - gap, 0), start: acc };
    acc += len;
    return seg;
  });
  const dim = (name: string) => selected !== null && selected !== name;
  return (
    <div className="mg-cost">
      <svg viewBox="0 0 240 240" className="mg-ring" role="img" aria-label={`成本圓環：使用率 ${rate === null ? "—" : Math.round(rate * 100) + "%"}`}>
        <circle cx={C} cy={C} r={R1} fill="none" stroke="var(--line)" strokeWidth={W1} />
        {segs.map(({ g, i, len, start }) => g.planned > 0 && (
          <circle key={g.name} className="mg-seg" data-sub={g.name} cx={C} cy={C} r={R1} fill="none" stroke={g.actual > g.planned ? "var(--danger)" : "var(--ink)"}
            strokeWidth={selected === g.name ? W1 + 4 : W1} strokeDasharray={`${len} ${L1 - len}`} strokeDashoffset={-start} transform={`rotate(-90 ${C} ${C})`}
            opacity={dim(g.name) ? 0.2 : 1 - (i % 4) * 0.18} tabIndex={0} role="button" aria-pressed={selected === g.name} aria-label={`${g.name}：預算 ${nt(g.planned)}，實支 ${nt(g.actual)}`}
            onClick={() => onSelect(selected === g.name ? null : g.name)} onKeyDown={(k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); onSelect(selected === g.name ? null : g.name); } }} />
        ))}
        <circle cx={C} cy={C} r={R2} fill="none" stroke="var(--line)" strokeWidth={W2} />
        {rate !== null && actual > 0 && <circle className="mg-inner" cx={C} cy={C} r={R2} fill="none" stroke={rate > 1 ? "var(--danger)" : "var(--ink)"} strokeWidth={W2} strokeDasharray={`${Math.min(rate, 1) * L2} ${L2}`} transform={`rotate(-90 ${C} ${C})`} />}
        <text x={C} y={C + 6} textAnchor="middle" fontSize="30" fontWeight="700" fill={rate !== null && rate > 1 ? "var(--danger)" : "var(--ink)"} fontFamily="var(--font-grotesk)">{rate === null ? "—" : `${Math.round(rate * 100)}%`}</text>
        <text x={C} y={C + 24} textAnchor="middle" fontSize="10" fill="var(--ink-faint)" letterSpacing="1">使用率</text>
      </svg>
      <table className="mg-cost-table">
        <thead><tr><th>次系統</th><th style={{ textAlign: "right" }}>預算</th><th style={{ textAlign: "right" }}>實支</th><th style={{ textAlign: "right" }}>使用率</th></tr></thead>
        <tbody>
          {groups.map((g) => {
            const over = g.actual > g.planned;
            return (
              <tr key={g.name} className={`rowbtn ${over ? "over" : ""}`} data-sub={g.name} aria-selected={selected === g.name} tabIndex={0} onClick={() => onSelect(selected === g.name ? null : g.name)} onKeyDown={(k) => { if (k.key === "Enter") onSelect(selected === g.name ? null : g.name); }}>
                <td>{g.name}</td><td className="id" style={{ textAlign: "right" }}>{nt(g.planned)}</td><td className="id" style={{ textAlign: "right" }}>{nt(g.actual)}</td>
                <td className="id" style={{ textAlign: "right" }}>{g.planned ? `${Math.round((g.actual / g.planned) * 100)}%` : g.actual ? "無預算" : "—"}{over && <> <span className="tag danger">OVER</span></>}</td>
              </tr>
            );
          })}
          {groups.length > 0 && <tr className={actual > planned ? "over total" : "total"}><td>合計</td><td className="id" style={{ textAlign: "right" }}>{nt(planned)}</td><td className="id" style={{ textAlign: "right" }}>{nt(actual)}</td><td className="id" style={{ textAlign: "right" }}>{rate === null ? "—" : `${Math.round(rate * 100)}%`}</td></tr>}
        </tbody>
      </table>
      {groups.length === 0 && <p className="body muted">還沒有成本項目。</p>}
    </div>
  );
}
