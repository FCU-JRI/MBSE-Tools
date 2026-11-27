// 層級圖的繪製（C＋D）：把 layout.ts 排好的框與線畫成 SVG。固定版面、不可拖拉。
// 點框：元素框選取元素（右欄編輯）、零件框打開下一層、〔表〕框跳到對應的表。別人選了同一個元素時，框外多一圈他的顏色（F-38）。
import { forwardRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { usePeerColor, usePeersOn } from "../../presence.tsx";
import { anchor, clip, nodeH, WIDTH } from "./layout.ts";
import type { Add, DEdge, DNode, Go, Spec } from "./layout.ts";

interface Props { spec: Spec; selectedId: string | null; onGo: (g: Go) => void; onAdd?: (a: Add) => void }

/** 一個框（獨立元件，才能各自讀協作者的選取） */
function NodeG({ n, selected, onGo }: { n: DNode; selected: boolean; onGo: (g: Go) => void }) {
  const peer = usePeerColor(n.el ?? null);
  const peers = usePeersOn(n.el ?? null);
  const h = nodeH(n);
  const go = n.go;
  const act = go ? { className: "go", tabIndex: 0, role: "link", "aria-label": `${n.kw ?? ""} ${n.name}`.trim(), onClick: () => onGo(go), onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter") onGo(go); } } : {};
  if (n.frame) return <g><rect x={n.x} y={n.y} width={n.w} height={h} rx={2} className={`n-${n.tone}`} strokeWidth={1.3} /><text x={n.x + 10} y={n.y + 15} className="kw" textAnchor="start">{`${n.kw ?? ""}  ${n.name}`}</text></g>;
  const cx = n.x + n.w / 2, sy = n.y + (n.kw ? 32 : 20);
  return (
    <g {...act} data-el={n.el}>
      {peer && <rect x={n.x - 4} y={n.y - 4} width={n.w + 8} height={h + 8} rx={n.def ? 4 : 13} className="pz-ring" style={{ stroke: peer }}><title>{peers.map((p) => `${p.name} 正在看`).join("、")}</title></rect>}
      <rect x={n.x} y={n.y} width={n.w} height={h} rx={n.def ? 2 : 10} className={`n-${n.tone}${selected ? " is-sel" : ""}`} strokeWidth={1.3} />
      {n.kw && <text x={cx} y={n.y + 14} className="kw" textAnchor="middle">{clip(n.kw, n.w + 10)}</text>}
      <text x={cx} y={n.y + (n.kw ? 27 : 15)} className="nm" textAnchor="middle">{clip(n.name, n.w)}</text>
      {n.lines.length > 0 && <>
        <line x1={n.x} x2={n.x + n.w} y1={sy} y2={sy} className="sep" />
        {n.lines.map((s, i) => { const m = s.startsWith("$ "); return <text key={i} x={n.x + 8} y={sy + 15 + i * 15} className={m ? "calc" : s.startsWith("→ ") ? "ln res" : "ln"} textAnchor="start">{m ? s.slice(2) : s}</text>; })}
      </>}
      {n.blocks && <Blocks n={n} h={h} />}
      {n.badge && <Badge n={n} />}
    </g>
  );
}

/** 設計示意：外框是本層的定義，裡面是組成零件；這一輪改到的零件用橘框標出 */
function Blocks({ n, h }: { n: DNode; h: number }) {
  const blocks = n.blocks ?? [], cap = n.caption ?? [];
  const sy = n.y + 34, cols = n.w < 200 ? 2 : 3, gap = 6, bw = (n.w - 20 - (cols - 1) * gap) / cols, bh = 30;
  const cy = n.y + h - 10 - (cap.length - 1) * 14;
  return <>
    <line x1={n.x} x2={n.x + n.w} y1={sy} y2={sy} className="sep" />
    <rect x={n.x + 6} y={sy + 6} width={n.w - 12} height={Math.ceil(Math.max(1, blocks.length) / cols) * (bh + gap) + 6} rx={2} className="sk-frame" />
    {blocks.map((b, i) => {
      const bx = n.x + 10 + (i % cols) * (bw + gap), by = sy + 10 + Math.floor(i / cols) * (bh + gap);
      return <g key={i}><rect x={bx} y={by} width={bw} height={bh} rx={3} className={b.hi ? "sk-hi" : "sk-b"} />
        <text x={bx + bw / 2} y={by + 13} className="sk-t" textAnchor="middle">{clip(b.name, bw + 8)}</text>
        {b.sub && <text x={bx + bw / 2} y={by + 25} className="sk-s" textAnchor="middle">{clip(b.sub, bw + 8)}</text>}</g>;
    })}
    {cap.map((s, i) => <text key={i} x={n.x + 8} y={cy + i * 14} className="ln" textAnchor="start">{s}</text>)}
  </>;
}

function Badge({ n }: { n: DNode }) {
  const [t, c] = n.badge!, bw = t.length * 11 + 14;
  return <g><rect x={n.x + n.w - bw + 6} y={n.y - 9} width={bw} height={17} rx={8} className={`bd-${c}`} /><text x={n.x + n.w - bw / 2 + 6} y={n.y + 3} className="bd-t" textAnchor="middle">{t}</text></g>;
}

function edgePath(e: DEdge, N: Map<string, DNode>): { d: string; pts: [number, number][] } | null {
  let pts = e.pts;
  if (!pts) {
    const a = N.get(e.f ?? ""), b = N.get(e.t ?? "");
    if (!a || !b) return null;
    const [x1, y1] = anchor(a, e.fs, e.fo), [x2, y2] = anchor(b, e.ts, e.to);
    if (e.k === "trace") { const mx = (x1 + x2) / 2; return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, pts: [[x1, y1], [x2, y2]] }; }
    const lr = (s?: string) => s === "l" || s === "r";
    if (lr(e.fs) && lr(e.ts)) { const mx = e.mx ?? (x1 + x2) / 2; pts = Math.abs(y1 - y2) < 1 ? [[x1, y1], [x2, y2]] : [[x1, y1], [mx, y1], [mx, y2], [x2, y2]]; }
    else if (!lr(e.fs) && !lr(e.ts)) { const my = e.my ?? (y1 + y2) / 2; pts = Math.abs(x1 - x2) < 1 ? [[x1, y1], [x2, y2]] : [[x1, y1], [x1, my], [x2, my], [x2, y2]]; }
    else if (lr(e.fs)) pts = [[x1, y1], [x2, y1], [x2, y2]];
    else pts = [[x1, y1], [x1, y2], [x2, y2]];
  }
  return { d: "M" + pts.map((p) => p.join(",")).join(" L"), pts };
}

function Edge({ e, N }: { e: DEdge; N: Map<string, DNode> }) {
  const p = edgePath(e, N);
  if (!p) return null;
  if (e.k === "trace") return <path d={p.d} className="e trace" />;
  const dash = e.k === "derive" || e.k === "satisfy" || e.k === "dep";
  const marker = e.k === "comp" ? { markerStart: "url(#ld-dm)" } : e.k === "fb" ? { markerEnd: "url(#ld-arf)" } : { markerEnd: e.bad ? "url(#ld-arb)" : "url(#ld-ar)" };
  const pts = p.pts;
  let lab: ReactNode = null;
  if (e.label) {
    let best = 0, bi = 0;
    for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (d > best) { best = d; bi = i; } }
    const [a, b] = [pts[bi], pts[bi + 1]], horiz = Math.abs(a[1] - b[1]) < 1;
    const lx = e.lx ?? (a[0] + b[0]) / 2 + (horiz ? 0 : 6), ly = e.ly ?? (a[1] + b[1]) / 2 + (horiz ? -6 : 4);
    lab = <text x={lx} y={ly} className={`elab${e.k === "fb" ? " fb" : ""}${e.bad ? " bad" : ""}`} textAnchor={e.la ?? (horiz ? "middle" : "start")}>{e.label}</text>;
  }
  return <>
    <path d={p.d} className={`e${dash ? " dash" : ""}${e.k === "fb" ? " fb" : ""}${e.bad ? " bad" : ""}`} {...marker} />
    {e.k === "iface" && [pts[0], pts[pts.length - 1]].map(([x, y], i) => <rect key={i} x={x - 4} y={y - 4} width={8} height={8} className="port" />)}
    {lab}
  </>;
}

/** 整張圖。ref 指到 svg，匯出用。 */
export const LayerDiagram = forwardRef<SVGSVGElement, Props>(function LayerDiagram({ spec, selectedId, onGo, onAdd }, ref) {
  const N = new Map(spec.nodes.map((n) => [n.id, n]));
  let H = 0;
  for (const n of spec.nodes) H = Math.max(H, n.y + nodeH(n));
  for (const z of spec.zones ?? []) H = Math.max(H, z.y + z.h);
  for (const e of spec.edges) for (const p of e.pts ?? []) H = Math.max(H, p[1] + 8);
  H += 16;
  return (
    <svg ref={ref} className="ld" viewBox={`0 0 ${WIDTH} ${H}`} role="img" aria-label={spec.label} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="ld-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" className="mk" /></marker>
        <marker id="ld-arb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" className="mk bad" /></marker>
        <marker id="ld-arf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" className="mk fb" /></marker>
        <marker id="ld-dm" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="12" markerHeight="9" orient="auto-start-reverse"><path d="M1,5 L7,1 L13,5 L7,9 Z" className="mk-d" /></marker>
      </defs>
      <g>
        {(spec.zones ?? []).map((z, i) => (
          <g key={i}>
            {z.label && <rect x={8} y={z.y} width={WIDTH - 16} height={z.h} rx={6} className="zone" />}
            {z.label && <text x={20} y={z.y + 17} className="zl" textAnchor="start">{z.label}</text>}
            {onAdd && z.add && <ZoneAdds z={z} onAdd={onAdd} />}
          </g>
        ))}
        {(spec.heads ?? []).map((h, i) => <text key={i} x={h.x} y={h.y} className="zl" textAnchor="start">{h.t}</text>)}
      </g>
      <g>{spec.edges.filter((e) => e.k === "trace").map((e, i) => <Edge key={i} e={e} N={N} />)}</g>
      <g>{spec.nodes.map((n) => <NodeG key={n.id} n={n} selected={!!n.el && n.el === selectedId} onGo={onGo} />)}</g>
      <g>{spec.edges.filter((e) => e.k !== "trace").map((e, i) => <Edge key={i} e={e} N={N} />)}</g>
    </svg>
  );
});

/** 區帶右上角的「＋ 新增」 */
function ZoneAdds({ z, onAdd }: { z: { y: number; add?: Add[] }; onAdd: (a: Add) => void }) {
  let x = WIDTH - 20;
  const items = [...(z.add ?? [])].reverse().map((a) => { const w = 28 + a.label.length * 11.2; x -= w + 6; return { a, x: x + 6, w }; });
  return <>{items.map(({ a, x: ax, w }) => (
    <g key={a.category} className="ld-add" tabIndex={0} role="button" aria-label={`新增${a.label}`} data-export="skip"
      onClick={() => onAdd(a)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAdd(a); } }}>
      <rect x={ax} y={z.y + 4} width={w} height={18} rx={9} />
      <text x={ax + w / 2} y={z.y + 17} textAnchor="middle">＋ {a.label}</text>
    </g>
  ))}</>;
}

/** 匯出用：去掉新增按鈕與協作標示，套上列印用的淺色配色（白底黑線，配色同圖例）。 */
export function svgForExport(svg: SVGSVGElement): string {
  const c = svg.cloneNode(true) as SVGSVGElement;
  c.querySelectorAll('[data-export="skip"], .pz-ring').forEach((x) => x.remove());
  c.querySelectorAll(".is-sel").forEach((x) => x.classList.remove("is-sel"));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = EXPORT_CSS;
  c.insertBefore(style, c.firstChild);
  const vb = svg.viewBox.baseVal;
  c.setAttribute("width", String(vb.width)); c.setAttribute("height", String(vb.height));
  return `<?xml version="1.0" encoding="UTF-8"?>\n` + new XMLSerializer().serializeToString(c);
}
const EXPORT_CSS = `svg{background:#fff}text{font-family:"Noto Sans TC",sans-serif;fill:#1b2430}
.kw,.sk-s{font-family:ui-monospace,monospace;font-size:10.5px;fill:#5b6675}.nm{font-size:12.5px;font-weight:700}.ln{font-size:11px}.ln.res{font-weight:600}
.zl{font-size:11px;font-weight:600;fill:#5b6675}.zone{fill:#f7f9fb;stroke:#e1e6ec}.elab{font-size:10.5px;fill:#5b6675;paint-order:stroke;stroke:#fff;stroke-width:4px}
.elab.fb{fill:#c2410c}.elab.bad{fill:#b91c1c}.n-in{fill:#fff;stroke:#7d8896}.n-build{fill:#eaf5ef;stroke:#2f7d5b}.n-out{fill:#fdf3dc;stroke:#b7791f}
.n-table{fill:#eef3fa;stroke:#3b6ea8;stroke-dasharray:5 3}.n-frame{fill:none;stroke:#2f7d5b}.sep{stroke:#3f4a59;opacity:.3}.e{fill:none;stroke:#3f4a59;stroke-width:1.2}
.e.dash{stroke-dasharray:5 4}.e.fb{stroke:#c2410c;stroke-dasharray:5 4}.e.bad{stroke:#b91c1c}.e.trace{stroke-width:1;opacity:.35}.port{fill:#fff;stroke:#3f4a59}
.calc{font-family:ui-monospace,monospace;font-size:10.5px;fill:#3b6ea8}.sk-frame{fill:none;stroke:#3f4a59;stroke-dasharray:2 2;opacity:.6}.sk-b{fill:#fff;stroke:#7d8896}
.sk-hi{fill:#fdf3dc;stroke:#c2410c;stroke-width:1.8}.sk-t{font-size:10.5px;font-weight:600}.bd-hold{fill:#9f1239}.bd-ok{fill:#2f7d5b}.bd-pend{fill:#6b7785}.bd-bad{fill:#b91c1c}
.bd-t{fill:#fff;font-size:10px;font-weight:700}.mk{fill:none;stroke:#3f4a59;stroke-width:1.4}.mk.bad{stroke:#b91c1c}.mk.fb{stroke:#c2410c}.mk-d{fill:#3f4a59}`;
