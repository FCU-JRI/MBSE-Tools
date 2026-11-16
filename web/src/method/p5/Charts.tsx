// P5 的四張圖（METHOD.md 7.3）：S × O 熱圖、風險散布圖兩種、依次系統彙整。SVG 自己畫，配色沿用網站的墨色、警示與危險色。
import type { FmeaRow, RiskRow, SubsystemSummary } from "./core.ts";
import { MUST_ACT } from "./core.ts";

const short = (e: { shortName: string | null; name: string } | null | undefined) => (e ? e.shortName ?? e.name : "");
/** 同一格有好幾個點時，繞著格子中心排開。 */
function spread<T>(items: T[], key: (t: T) => string, r: number): Map<T, [number, number]> {
  const groups = new Map<string, T[]>();
  for (const t of items) groups.set(key(t), [...(groups.get(key(t)) ?? []), t]);
  const out = new Map<T, [number, number]>();
  for (const g of groups.values()) g.forEach((t, i) => {
    if (g.length === 1) return out.set(t, [0, 0]);
    const a = (i / g.length) * Math.PI * 2;
    out.set(t, [Math.cos(a) * r, Math.sin(a) * r]);
  });
  return out;
}

/** S × O 熱圖：橫軸發生度、縱軸嚴重度（1–10）。實心點是矯正前、空心點是矯正後，用箭頭連起來。S ≥ 8 的帶狀區是一定要矯正的區域。 */
export function HeatSO({ rows, onPick }: { rows: FmeaRow[]; onPick?: (id: string) => void }) {
  const cell = 34, pad = 34, W = pad + cell * 10 + 8, H = cell * 10 + pad;
  const x = (o: number) => pad + (o - 0.5) * cell, y = (s: number) => (10 - s + 0.5) * cell;
  const plotted = rows.filter((r) => r.fm && r.o !== null && r.s !== null);
  const off = spread(plotted, (r) => `${r.o}-${r.s}`, 8);
  const missing = rows.filter((r) => r.fm && (r.o === null || r.s === null)).length;
  const cells = [];
  for (let s = 1; s <= 10; s++) for (let o = 1; o <= 10; o++) {
    const v = s * o;
    const fill = s >= MUST_ACT ? "var(--danger)" : v >= 40 ? "var(--warn)" : "none";
    cells.push(<rect key={`${s}-${o}`} x={pad + (o - 1) * cell + 0.5} y={(10 - s) * cell + 0.5} width={cell - 1} height={cell - 1} fill={fill} fillOpacity={fill === "none" ? 0 : s >= MUST_ACT ? 0.16 : 0.22} stroke="var(--line)" />);
  }
  return (
    <figure className="p5-figure">
      <svg viewBox={`0 0 ${W} ${H + 4}`} style={{ width: W, maxWidth: "100%", display: "block" }} role="img" aria-label={`S × O 熱圖：畫出 ${plotted.length} 個失效模式，嚴重度 8 以上 ${plotted.filter((r) => (r.s ?? 0) >= MUST_ACT).length} 個。`}>
        <defs><marker id="p5-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink)" /></marker></defs>
        {cells}
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => <text key={`x${i}`} x={x(i)} y={H - 18} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{i}</text>)}
        {Array.from({ length: 10 }, (_, i) => i + 1).map((i) => <text key={`y${i}`} x={pad - 10} y={y(i) + 3} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{i}</text>)}
        <text x={pad + cell * 5} y={H - 2} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">發生度 O</text>
        <text x={10} y={cell * 5} textAnchor="middle" fontSize="11" fill="var(--ink-muted)" transform={`rotate(-90 10 ${cell * 5})`}>嚴重度 S</text>
        <line x1={pad} x2={pad + cell * 10} y1={(10 - MUST_ACT + 1) * cell} y2={(10 - MUST_ACT + 1) * cell} stroke="var(--danger)" strokeWidth="1.5" strokeDasharray="4 3" />
        {plotted.map((r) => {
          const [dx, dy] = off.get(r) ?? [0, 0];
          const x0 = x(r.o!) + dx, y0 = y(r.s!) + dy;
          const after = r.oAfter !== null || r.sAfter !== null;
          const x1 = x(r.oAfter ?? r.o!) + dx, y1 = y(r.sAfter ?? r.s!) + dy;
          return (
            <g key={r.key} onClick={onPick && r.fm ? () => onPick(r.fm!.id) : undefined} style={{ cursor: onPick ? "pointer" : "default" }}>
              <title>{`${short(r.fm)} ${r.mode}：O ${r.o}、S ${r.s}${after ? ` → O ${r.oAfter ?? r.o}、S ${r.sAfter ?? r.s}` : "（尚未矯正）"}`}</title>
              {after && (x0 !== x1 || y0 !== y1) && <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink)" strokeWidth="1.2" markerEnd="url(#p5-arrow)" />}
              <circle cx={x0} cy={y0} r={5} fill={r.missingAction ? "var(--danger)" : "var(--ink)"} stroke="var(--bg)" />
              {after && <circle cx={x1} cy={y1} r={5} fill="var(--bg)" stroke="var(--ink)" strokeWidth="1.5" />}
            </g>
          );
        })}
      </svg>
      <figcaption className="caption">實心點＝矯正前，空心點＝矯正後，箭頭表示矯正把它移到哪裡。虛線以上（S ≥ {MUST_ACT}）一律要有矯正措施；紅點是還沒寫矯正措施的。{missing > 0 && `另有 ${missing} 項缺 O 或 S，沒有畫出來。`}</figcaption>
    </figure>
  );
}

/** 風險散布圖（可能性 × 後果）：5 × 5，格子依分數上色；有緩解後的值時畫箭頭。 */
export function RiskLC({ risks, onPick }: { risks: RiskRow[]; onPick?: (id: string) => void }) {
  const cell = 56, pad = 34, W = pad + cell * 5 + 8, H = cell * 5 + pad;
  const x = (l: number) => pad + (l - 0.5) * cell, y = (c: number) => (5 - c + 0.5) * cell;
  const plotted = risks.filter((r) => r.score !== null);
  const off = spread(plotted, (r) => `${r.likelihood}-${r.consequence}`, 14);
  const cells = [];
  for (let c = 1; c <= 5; c++) for (let l = 1; l <= 5; l++) {
    const v = c * l;
    const fill = v >= 15 ? "var(--danger)" : v >= 8 ? "var(--warn)" : "none";
    cells.push(<rect key={`${c}-${l}`} x={pad + (l - 1) * cell + 0.5} y={(5 - c) * cell + 0.5} width={cell - 1} height={cell - 1} fill={fill} fillOpacity={fill === "none" ? 0 : 0.2} stroke="var(--line)" />);
  }
  return (
    <figure className="p5-figure">
      <svg viewBox={`0 0 ${W} ${H + 4}`} style={{ width: W, maxWidth: "100%", display: "block" }} role="img" aria-label={`風險散布圖（可能性 × 後果）：${plotted.length} 個風險，高風險 ${plotted.filter((r) => r.level === "high").length} 個。`}>
        <defs><marker id="p5-arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink)" /></marker></defs>
        {cells}
        {[1, 2, 3, 4, 5].map((i) => <text key={`x${i}`} x={x(i)} y={H - 18} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{i}</text>)}
        {[1, 2, 3, 4, 5].map((i) => <text key={`y${i}`} x={pad - 10} y={y(i) + 3} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{i}</text>)}
        <text x={pad + cell * 2.5} y={H - 2} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">可能性</text>
        <text x={10} y={cell * 2.5} textAnchor="middle" fontSize="11" fill="var(--ink-muted)" transform={`rotate(-90 10 ${cell * 2.5})`}>後果</text>
        {plotted.map((r) => {
          const [dx, dy] = off.get(r) ?? [0, 0];
          const x0 = x(r.likelihood!) + dx, y0 = y(r.consequence!) + dy;
          const res = r.residualLikelihood !== null || r.residualConsequence !== null;
          const x1 = x(r.residualLikelihood ?? r.likelihood!) + dx, y1 = y(r.residualConsequence ?? r.consequence!) + dy;
          return (
            <g key={r.risk.id} onClick={onPick ? () => onPick(r.risk.id) : undefined} style={{ cursor: onPick ? "pointer" : "default" }}>
              <title>{`${short(r.risk)} ${r.risk.name}：可能性 ${r.likelihood}、後果 ${r.consequence}（${r.score}）`}</title>
              {res && (x0 !== x1 || y0 !== y1) && <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="var(--ink)" strokeWidth="1.2" markerEnd="url(#p5-arrow2)" />}
              <circle cx={x0} cy={y0} r={6} fill="var(--ink)" stroke="var(--bg)" />
              <text x={x0 + 8} y={y0 - 6} fontSize="9" fill="var(--ink)">{short(r.risk)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="caption">每個點是一個風險：橫軸可能性、縱軸後果（各 1–5）。分數 15 以上是高（紅）、8 到 14 是中（黃）。有緩解後的值時，箭頭指向緩解後的位置。</figcaption>
    </figure>
  );
}

/** 風險散布圖（嚴重度 × 影響範圍）：橫軸是模型數出來的牽連（需求、介面、元件），縱軸是後果。右上角是「嚴重又牽連很廣」。 */
export function RiskSI({ risks, onPick }: { risks: RiskRow[]; onPick?: (id: string) => void }) {
  const plotted = risks.filter((r) => r.consequence !== null);
  const maxI = Math.max(4, ...plotted.map((r) => r.impact.total));
  const pad = 34, w = 380, h = 260, W = pad + w + 12, H = h + pad;
  const x = (i: number) => pad + (i / maxI) * w, y = (c: number) => (5 - c + 0.5) * (h / 5);
  const sorted = plotted.map((r) => r.impact.total).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const off = spread(plotted, (r) => `${r.impact.total}-${r.consequence}`, 10);
  const ticks = Array.from(new Set([0, Math.round(maxI / 4), Math.round(maxI / 2), Math.round((3 * maxI) / 4), maxI]));
  return (
    <figure className="p5-figure">
      <svg viewBox={`0 0 ${W} ${H + 4}`} style={{ width: W, maxWidth: "100%", display: "block" }} role="img" aria-label={`風險散布圖（嚴重度 × 影響範圍）：${plotted.length} 個風險。`}>
        <rect x={x(median)} y={0} width={Math.max(0, pad + w - x(median))} height={y(4) + h / 10} fill="var(--danger)" fillOpacity="0.12" />
        {[1, 2, 3, 4, 5].map((c) => <line key={c} x1={pad} x2={pad + w} y1={y(c)} y2={y(c)} stroke="var(--line)" />)}
        <line x1={pad} x2={pad} y1={0} y2={h} stroke="var(--line-strong)" />
        <line x1={pad} x2={pad + w} y1={h} y2={h} stroke="var(--line-strong)" />
        {ticks.map((t) => <text key={t} x={x(t)} y={h + 14} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{t}</text>)}
        {[1, 2, 3, 4, 5].map((c) => <text key={c} x={pad - 10} y={y(c) + 3} textAnchor="middle" fontSize="10" fill="var(--ink-muted)">{c}</text>)}
        <text x={pad + w / 2} y={H - 2} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">影響範圍（牽連的需求＋介面＋元件）</text>
        <text x={10} y={h / 2} textAnchor="middle" fontSize="11" fill="var(--ink-muted)" transform={`rotate(-90 10 ${h / 2})`}>嚴重度（後果）</text>
        {plotted.map((r) => {
          const [dx, dy] = off.get(r) ?? [0, 0];
          const cx = x(r.impact.total) + dx, cy = y(r.consequence!) + dy;
          return (
            <g key={r.risk.id} onClick={onPick ? () => onPick(r.risk.id) : undefined} style={{ cursor: onPick ? "pointer" : "default" }}>
              <title>{`${short(r.risk)} ${r.risk.name}：後果 ${r.consequence}；牽連需求 ${r.impact.requirements.length}、介面 ${r.impact.interfaces}、元件 ${r.impact.components.length}`}</title>
              <circle cx={cx} cy={cy} r={6} fill={r.level === "high" ? "var(--danger)" : "var(--ink)"} stroke="var(--bg)" />
              <text x={cx + 8} y={cy - 6} fontSize="9" fill="var(--ink)">{short(r.risk)}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="caption">每個點是一個風險。淺紅區是後果 4 以上、而且牽連達到中位數（{median}）以上的風險：嚴重又牽連很廣，優先處理。紅點是可能性 × 後果為高的風險。</figcaption>
    </figure>
  );
}

/** 依次系統彙整：給組長看的一張表，加上最高 S 的長條。 */
export function SubsystemTable({ list }: { list: SubsystemSummary[] }) {
  if (!list.length) return <p className="body">還沒有「功能 → 次系統」的分配，沒有東西可以彙整。</p>;
  return (
    <table>
      <thead><tr><th>次系統</th><th>失效模式</th><th>還沒填的列</th><th>最高 S</th><th style={{ width: 180 }}></th><th>最高 RPN</th><th>未完成的矯正</th><th>S ≥ {MUST_ACT} 沒寫矯正</th></tr></thead>
      <tbody>{list.map((s) => (
        <tr key={s.name}>
          <td>{s.name}</td><td className="id">{s.modes}</td><td className="id">{s.skeleton || "—"}</td>
          <td className="id">{s.maxS ?? "—"}</td>
          <td><svg viewBox="0 0 100 10" style={{ width: 160, height: 10 }} aria-hidden="true"><rect x="0" y="2" width="100" height="6" fill="none" stroke="var(--line)" /><rect x="0" y="2" width={(s.maxS ?? 0) * 10} height="6" fill={(s.maxS ?? 0) >= MUST_ACT ? "var(--danger)" : "var(--ink)"} /></svg></td>
          <td className="id">{s.maxRpn ?? "—"}</td><td className="id">{s.openActions || "—"}</td>
          <td>{s.missingActions ? <span className="tag danger">{s.missingActions}</span> : <span className="faint">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}
