// 把圖匯出成 SVG／PNG，放進審查報告用。固定用白底黑線，列印時清楚。
import type { GEdge, GNode } from "./model.ts";
import { esc, nodeSvg, PRINT } from "./shapes.ts";

export interface Placed { g: GNode; x: number; y: number }

/** 從節點中心往另一點的方向，求與節點外框的交點。橢圓與圓用橢圓公式，其餘用矩形。 */
function edgePoint(n: Placed, tx: number, ty: number): [number, number] {
  const w = n.g.width, h = n.g.height;
  const cx = n.x + w / 2, cy = n.y + h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  if (n.g.shape === "usecase" || n.g.shape === "initial" || n.g.shape === "final") {
    const k = 1 / Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
    return [cx + dx * k, cy + dy * k];
  }
  const k = Math.min(Math.abs(w / 2 / (dx || 1e-9)), Math.abs(h / 2 / (dy || 1e-9)));
  return [cx + dx * k, cy + dy * k];
}

export function toSvg(title: string, nodes: Placed[], edges: GEdge[]): string {
  const pad = 32, head = 40;
  const minX = Math.min(...nodes.map((n) => n.x)), minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.g.width)), maxY = Math.max(...nodes.map((n) => n.y + n.g.height));
  const W = Math.ceil(maxX - minX + pad * 2), H = Math.ceil(maxY - minY + pad * 2 + head);
  const ox = pad - minX, oy = pad + head - minY;
  const by = new Map(nodes.map((n) => [n.g.id, n]));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#111" stroke-width="1.2"/></marker>`);
  out.push(`<marker id="dia" viewBox="0 0 20 12" refX="1" refY="6" markerWidth="18" markerHeight="11" orient="auto"><path d="M1 6 L10 1 L19 6 L10 11 Z" fill="#111"/></marker></defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  out.push(`<text x="${pad}" y="${pad + 4}" font-size="13" font-weight="600" fill="#111" letter-spacing="1" font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif">${esc(title)}</text>`);
  for (const e of edges) {
    const a = by.get(e.source), b = by.get(e.target);
    if (!a || !b) continue;
    const [x1, y1] = edgePoint(a, b.x + b.g.width / 2, b.y + b.g.height / 2);
    const [x2, y2] = edgePoint(b, a.x + a.g.width / 2, a.y + a.g.height / 2);
    const marks = `${e.tail === "diamond" ? `marker-start="url(#dia)"` : ""} ${e.head === "open" ? `marker-end="url(#arr)"` : ""}`;
    out.push(`<line x1="${(x1 + ox).toFixed(1)}" y1="${(y1 + oy).toFixed(1)}" x2="${(x2 + ox).toFixed(1)}" y2="${(y2 + oy).toFixed(1)}" stroke="#111" stroke-width="1" ${e.dashed ? `stroke-dasharray="6 4"` : ""} ${marks}/>`);
    if (e.label) {
      const mx = (x1 + x2) / 2 + ox, my = (y1 + y2) / 2 + oy;
      const tw = [...e.label].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e7f ? 11 : 6), 0) + 8;
      out.push(`<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${tw}" height="14" fill="#fff"/>`);
      out.push(`<text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" font-size="10" fill="#333" text-anchor="middle" font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif">${esc(e.label)}</text>`);
    }
  }
  for (const n of nodes) out.push(nodeSvg(n.g, n.x + ox, n.y + oy, PRINT));
  out.push(`</svg>`);
  return out.join("");
}

function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadSvg(svg: string, name: string): void {
  save(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
}

export async function downloadPng(svg: string, name: string): Promise<void> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("無法產生圖片。")); img.src = url; });
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = img.width * scale; c.height = img.height * scale;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("瀏覽器不支援匯出圖片。");
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("無法產生圖片。");
    save(blob, `${name}.png`);
  } finally { URL.revokeObjectURL(url); }
}
