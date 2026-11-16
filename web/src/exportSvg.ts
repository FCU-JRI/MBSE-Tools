// 把圖匯出成 SVG／PNG，放進審查報告用。固定用白底黑線，列印時清楚。
import type { GEdge, GNode } from "./model.ts";
import { annotationSvg, edgeMarkers, esc, frameLayout, frameSvg, MARKERS, markerSvg, nodeSvg, portPoint, PRINT } from "./shapes.ts";
import type { Annotation } from "./api.ts";

export interface Placed { g: GNode; x: number; y: number }

/** 從節點中心往另一點的方向，求與節點外框的交點。橢圓與圓用橢圓公式，其餘用矩形。 */
function edgePoint(n: Placed, tx: number, ty: number): [number, number] {
  const w = n.g.width, h = n.g.height;
  const cx = n.x + w / 2, cy = n.y + h / 2;
  const dx = tx - cx, dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  if (n.g.shape === "start" || n.g.shape === "done") {
    const k = 1 / Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
    return [cx + dx * k, cy + dy * k];
  }
  const k = Math.min(Math.abs(w / 2 / (dx || 1e-9)), Math.abs(h / 2 / (dy || 1e-9)));
  return [cx + dx * k, cy + dy * k];
}

/** 直角折線：和畫面相同的規則。階層圖由上方節點的底邊接到下方節點的頂邊，流程圖由左方節點的右邊接到右方節點的左邊；該方向上重疊時改用另一軸。回傳路徑點與標籤位置，兩軸都重疊時回傳 null。 */
function ortho(a: Placed, b: Placed, vertical: boolean): { pts: [number, number][]; label: [number, number] } | null {
  const acx = a.x + a.g.width / 2, acy = a.y + a.g.height / 2, bcx = b.x + b.g.width / 2, bcy = b.y + b.g.height / 2;
  const v = (): { pts: [number, number][]; label: [number, number] } | null => {
    const down = b.y >= a.y + a.g.height, up = a.y >= b.y + b.g.height;
    if (!down && !up) return null;
    const y1 = down ? a.y + a.g.height : a.y, y2 = down ? b.y : b.y + b.g.height, m = (y1 + y2) / 2;
    return { pts: [[acx, y1], [acx, m], [bcx, m], [bcx, y2]], label: [(acx + bcx) / 2, m] };
  };
  const h = (): { pts: [number, number][]; label: [number, number] } | null => {
    const right = b.x >= a.x + a.g.width, left = a.x >= b.x + b.g.width;
    if (!right && !left) return null;
    const x1 = right ? a.x + a.g.width : a.x, x2 = right ? b.x : b.x + b.g.width, m = (x1 + x2) / 2;
    return { pts: [[x1, acy], [m, acy], [m, bcy], [x2, bcy]], label: [m, (acy + bcy) / 2] };
  };
  return vertical ? v() ?? h() : h() ?? v();
}

/** 至少一端接在小方塊上的連線：端點是方塊的外側中心，水平出去、中間折成直角。 */
function viaPorts(a: Placed, b: Placed, pa: [number, number] | null, pb: [number, number] | null): { pts: [number, number][]; label: [number, number] } {
  const s = pa ?? [b.x + b.g.width / 2 < a.x + a.g.width / 2 ? a.x : a.x + a.g.width, a.y + a.g.height / 2] as [number, number];
  const t = pb ?? [a.x + a.g.width / 2 < b.x + b.g.width / 2 ? b.x : b.x + b.g.width, b.y + b.g.height / 2] as [number, number];
  const mx = (s[0] + t[0]) / 2;
  return { pts: [s, [mx, s[1]], [mx, t[1]], t], label: [mx, (s[1] + t[1]) / 2] };
}

export function toSvg(frame: string, placed: Placed[], edges: GEdge[], vertical = true, straight = false, notes: Annotation[] = []): string {
  const m = 12;
  // 圖框包住一般的節點與標註；貼在圖框邊上的節點（參數、連接埠）由圖框決定位置，和畫面相同（shapes.ts 的 frameLayout）
  const inner = placed.filter((n) => !n.g.boundary);
  const fl = frameLayout([...inner.map((n) => ({ x: n.x, y: n.y, w: n.g.width, h: n.g.height })), ...notes], placed.filter((n) => n.g.boundary).map((n) => ({ id: n.g.id, boundary: n.g.boundary!, width: n.g.width, height: n.g.height })), 32);
  const nodes = placed.map((n) => (n.g.boundary ? { ...n, ...fl.places.get(n.g.id)! } : n));
  // 畫布：圖框，加上伸出框外的參數名稱與連接埠的方塊
  const ext = [{ x: fl.x, y: fl.y, w: fl.w, h: fl.h }, ...nodes.map((n) => ({ x: n.x - 8, y: n.y, w: n.g.width + 16, h: n.g.height }))];
  const minX = Math.min(...ext.map((b) => b.x)), minY = Math.min(...ext.map((b) => b.y));
  const W = Math.ceil(Math.max(...ext.map((b) => b.x + b.w)) - minX + m * 2), H = Math.ceil(Math.max(...ext.map((b) => b.y + b.h)) - minY + m * 2);
  const ox = m - minX, oy = m - minY;
  const by = new Map(nodes.map((n) => [n.g.id, n]));
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  out.push(`<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" orient="auto"><path d="M1 1 L9 5 L1 9" fill="none" stroke="#111" stroke-width="1.2"/></marker>`);
  // 只放這張圖用到的記號；形狀和畫面上的相同（shapes.ts 的 MARKERS）
  const used = new Set(edges.flatMap((e) => { const k = edgeMarkers(e); return [k.start?.id, k.end?.id]; }));
  // 「由誰定義」的記號沿用原本的識別碼 typ
  const mid = (id: string) => (id === "typing" ? "typ" : id);
  out.push(Object.values(MARKERS).filter((k) => used.has(k.id)).map((k) => markerSvg({ ...k, id: mid(k.id) }, "", PRINT, "auto")).join("") + `</defs>`);
  out.push(`<rect width="${W}" height="${H}" fill="#fff"/>`);
  out.push(frameSvg(frame, fl.x + ox, fl.y + oy, fl.w, fl.h, PRINT));
  for (const a of notes) if (a.type === "frame") out.push(annotationSvg(a, a.x + ox, a.y + oy, PRINT));
  // 套件畫在最底層，成員與連線疊在上面
  for (const n of nodes) if (n.g.shape === "package") out.push(nodeSvg(n.g, n.x + ox, n.y + oy, PRINT));
  for (const e of edges) {
    const a = by.get(e.source), b = by.get(e.target);
    if (!a || !b) continue;
    // 接在小方塊上的連線：從方塊水平出去，中間折一次
    const pa = portPoint(a.g, a.x, a.y, e.sourcePort), pb = portPoint(b.g, b.x, b.y, e.targetPort);
    const o = pa || pb ? viaPorts(a, b, pa, pb) : straight ? null : ortho(a, b, vertical);
    const [x1, y1] = edgePoint(a, b.x + b.g.width / 2, b.y + b.g.height / 2);
    const [x2, y2] = edgePoint(b, a.x + a.g.width / 2, a.y + a.g.height / 2);
    const k = edgeMarkers(e);
    const marks = `${k.start ? `marker-start="url(#${mid(k.start.id)})"` : ""} ${e.head === "open" ? `marker-end="url(#arr)"` : k.end ? `marker-end="url(#${mid(k.end.id)})"` : ""}`;
    if (o) out.push(`<path d="${o.pts.map(([x, y], i) => `${i ? "L" : "M"}${(x + ox).toFixed(1)} ${(y + oy).toFixed(1)}`).join(" ")}" fill="none" stroke="#111" stroke-width="1" ${e.dashed ? `stroke-dasharray="6 4"` : ""} ${marks}/>`);
    else out.push(`<line x1="${(x1 + ox).toFixed(1)}" y1="${(y1 + oy).toFixed(1)}" x2="${(x2 + ox).toFixed(1)}" y2="${(y2 + oy).toFixed(1)}" stroke="#111" stroke-width="1" ${e.dashed ? `stroke-dasharray="6 4"` : ""} ${marks}/>`);
    if (e.label) {
      const mx = (o ? o.label[0] : (x1 + x2) / 2) + ox, my = (o ? o.label[1] : (y1 + y2) / 2) + oy;
      const tw = [...e.label].reduce((s, ch) => s + (ch.charCodeAt(0) > 0x2e7f ? 11 : 6), 0) + 8;
      out.push(`<rect x="${(mx - tw / 2).toFixed(1)}" y="${(my - 8).toFixed(1)}" width="${tw}" height="14" fill="#fff"/>`);
      out.push(`<text x="${mx.toFixed(1)}" y="${(my + 3).toFixed(1)}" font-size="10" fill="#333" text-anchor="middle" font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif">${esc(e.label)}</text>`);
    }
  }
  for (const n of nodes) if (n.g.shape !== "package") out.push(nodeSvg(n.g, n.x + ox, n.y + oy, PRINT));
  for (const a of notes) if (a.type !== "frame") out.push(annotationSvg(a, a.x + ox, a.y + oy, PRINT));
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
