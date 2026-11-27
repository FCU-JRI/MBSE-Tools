// 層級圖的 SVG 字串（G 包）：不依賴 React 與瀏覽器，伺服器的審查報告（MGT-04）與模型頁的「匯出 ▾」都用它。
// 幾何規則和畫面上的 LayerDiagram.tsx 相同（共用 edgePath）；配色固定用列印用的淺色（白底、圖例色），不含新增按鈕與協作標示。
import { anchor, clip, nodeH, WIDTH } from "./layout.ts";
import type { DEdge, DNode, Spec } from "./layout.ts";

export function edgePath(e: DEdge, N: Map<string, DNode>): { d: string; pts: [number, number][] } | null {
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

export function specHeight(spec: Spec): number {
  let H = 0;
  for (const n of spec.nodes) H = Math.max(H, n.y + nodeH(n));
  for (const z of spec.zones ?? []) H = Math.max(H, z.y + z.h);
  for (const e of spec.edges) for (const p of e.pts ?? []) H = Math.max(H, p[1] + 8);
  return H + 16;
}

const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const text = (x: number, y: number, s: string, cls: string, anchorAt = "middle") => `<text x="${x}" y="${y}" class="${cls}" text-anchor="${anchorAt}">${esc(s)}</text>`;

function nodeSvg(n: DNode): string {
  const h = nodeH(n), out: string[] = [];
  out.push(`<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${h}" rx="${n.frame || n.def ? 2 : 10}" class="n-${n.tone}" stroke-width="1.3"/>`);
  if (n.frame) { out.push(text(n.x + 10, n.y + 15, `${n.kw ?? ""}  ${n.name}`, "kw", "start")); return out.join(""); }
  const cx = n.x + n.w / 2, sy = n.y + (n.kw ? 32 : 20);
  if (n.kw) out.push(text(cx, n.y + 14, clip(n.kw, n.w + 10), "kw"));
  out.push(text(cx, n.y + (n.kw ? 27 : 15), clip(n.name, n.w), "nm"));
  if (n.lines.length) {
    out.push(`<line x1="${n.x}" x2="${n.x + n.w}" y1="${sy}" y2="${sy}" class="sep"/>`);
    n.lines.forEach((s, i) => { const m = s.startsWith("$ "); out.push(text(n.x + 8, sy + 15 + i * 15, m ? s.slice(2) : s, m ? "calc" : s.startsWith("→ ") ? "ln res" : "ln", "start")); });
  }
  if (n.blocks) {
    const blocks = n.blocks, cap = n.caption ?? [], by0 = n.y + 34, cols = n.w < 200 ? 2 : 3, gap = 6, bw = (n.w - 20 - (cols - 1) * gap) / cols, bh = 30;
    out.push(`<line x1="${n.x}" x2="${n.x + n.w}" y1="${by0}" y2="${by0}" class="sep"/>`);
    out.push(`<rect x="${n.x + 6}" y="${by0 + 6}" width="${n.w - 12}" height="${Math.ceil(Math.max(1, blocks.length) / cols) * (bh + gap) + 6}" rx="2" class="sk-frame"/>`);
    blocks.forEach((b, i) => {
      const bx = n.x + 10 + (i % cols) * (bw + gap), by = by0 + 10 + Math.floor(i / cols) * (bh + gap);
      out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" class="${b.hi ? "sk-hi" : "sk-b"}"/>`, text(bx + bw / 2, by + 13, clip(b.name, bw + 8), "sk-t"));
      if (b.sub) out.push(text(bx + bw / 2, by + 25, clip(b.sub, bw + 8), "sk-s"));
    });
    const cy = n.y + h - 10 - (cap.length - 1) * 14;
    cap.forEach((s, i) => out.push(text(n.x + 8, cy + i * 14, s, "ln", "start")));
  }
  if (n.badge) {
    const [t, c] = n.badge, bw = t.length * 11 + 14;
    out.push(`<rect x="${n.x + n.w - bw + 6}" y="${n.y - 9}" width="${bw}" height="17" rx="8" class="bd-${c}"/>`, text(n.x + n.w - bw / 2 + 6, n.y + 3, t, "bd-t"));
  }
  return out.join("");
}

function edgeSvg(e: DEdge, N: Map<string, DNode>): string {
  const p = edgePath(e, N);
  if (!p) return "";
  if (e.k === "trace") return `<path d="${p.d}" class="e trace"/>`;
  const dash = e.k === "derive" || e.k === "satisfy" || e.k === "dep";
  const marker = e.k === "comp" ? `marker-start="url(#x-dm)"` : e.k === "fb" ? `marker-end="url(#x-arf)"` : `marker-end="url(#x-${e.bad ? "arb" : "ar"})"`;
  const out = [`<path d="${p.d}" class="e${dash ? " dash" : ""}${e.k === "fb" ? " fb" : ""}${e.bad ? " bad" : ""}" ${marker}/>`];
  const pts = p.pts;
  if (e.k === "iface") for (const [x, y] of [pts[0], pts[pts.length - 1]]) out.push(`<rect x="${x - 4}" y="${y - 4}" width="8" height="8" class="port"/>`);
  if (e.label) {
    let best = 0, bi = 0;
    for (let i = 0; i < pts.length - 1; i++) { const d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (d > best) { best = d; bi = i; } }
    const [a, b] = [pts[bi], pts[bi + 1]], horiz = Math.abs(a[1] - b[1]) < 1;
    out.push(text(e.lx ?? (a[0] + b[0]) / 2 + (horiz ? 0 : 6), e.ly ?? (a[1] + b[1]) / 2 + (horiz ? -6 : 4), e.label, `elab${e.k === "fb" ? " fb" : ""}${e.bad ? " bad" : ""}`, e.la ?? (horiz ? "middle" : "start")));
  }
  return out.join("");
}

/** 整張層級圖的 SVG 字串（含 XML 宣告時給 xml: true，用來存檔）。 */
export function specToSvg(spec: Spec, opts: { xml?: boolean } = {}): string {
  const H = specHeight(spec), N = new Map(spec.nodes.map((n) => [n.id, n]));
  const mk = (id: string, cls: string, d = "M0,0 L10,5 L0,10") => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="${d}" class="${cls}"/></marker>`;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${H}" width="${WIDTH}" height="${H}" role="img" aria-label="${esc(spec.label)}">`,
    `<style>${EXPORT_CSS}</style>`,
    `<defs>${mk("x-ar", "mk")}${mk("x-arb", "mk bad")}${mk("x-arf", "mk fb")}<marker id="x-dm" viewBox="0 0 14 10" refX="1" refY="5" markerWidth="12" markerHeight="9" orient="auto-start-reverse"><path d="M1,5 L7,1 L13,5 L7,9 Z" class="mk-d"/></marker></defs>`,
    `<rect x="0" y="0" width="${WIDTH}" height="${H}" fill="#fff"/>`,
    ...(spec.zones ?? []).filter((z) => z.label).map((z) => `<rect x="8" y="${z.y}" width="${WIDTH - 16}" height="${z.h}" rx="6" class="zone"/>${text(20, z.y + 17, z.label, "zl", "start")}`),
    ...(spec.heads ?? []).map((h) => text(h.x, h.y, h.t, "zl", "start")),
    ...spec.edges.filter((e) => e.k === "trace").map((e) => edgeSvg(e, N)),
    ...spec.nodes.map(nodeSvg),
    ...spec.edges.filter((e) => e.k !== "trace").map((e) => edgeSvg(e, N)),
    "</svg>",
  ];
  return (opts.xml ? `<?xml version="1.0" encoding="UTF-8"?>\n` : "") + parts.join("");
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
