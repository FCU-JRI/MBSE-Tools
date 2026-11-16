// SysML v2 圖形記法（規範 8.2.3）的繪製。畫面、PNG／SVG 匯出與審查報告共用這一份，確保三者一致。
import { PKG_TAB, wrap } from "./model.ts";
import type { GNode, Shape } from "./model.ts";
import type { Annotation } from "./api.ts";

export interface Palette { ink: string; bg: string; muted: string }
export const SCREEN: Palette = { ink: "var(--ink)", bg: "var(--bg)", muted: "var(--ink-muted)" };
export const PRINT: Palette = { ink: "#111111", bg: "#ffffff", muted: "#555555" };

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = `font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif"`;
const text = (x: number, y: number, s: string, size: number, fill: string, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${FONT} ${extra}>${esc(s)}</text>`;
const one = (s: string, units: number) => wrap(s, units, 1)[0] ?? "";
const textWidth = (s: string, cjk: number, latin: number) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? cjk : latin), 0);

/** 套件標籤頁的寬度（依名稱長度）。 */
export const pkgTabWidth = (name: string, w: number) => Math.min(w, Math.max(72, Math.ceil(textWidth(name, 13, 7.4) + 24)));

/** 隔間：一條橫線，標題置中斜體，其餘各列靠左。回傳畫完後的 y。 */
function compartmentsSvg(n: GNode, x: number, top: number, c: Palette): [string, number] {
  const w = n.width, cx = x + w / 2;
  let out = "", ty = top;
  for (const comp of n.compartments) {
    out += `<line x1="${x}" y1="${ty}" x2="${x + w}" y2="${ty}" stroke="${c.ink}" stroke-width="1"/>`;
    ty += 4;
    comp.forEach((l, i) => {
      ty += 16;
      if (i === 0) out += text(cx, ty - 3, l, 10, c.muted, `text-anchor="middle" font-style="italic"`);
      else out += text(x + 8, ty - 3, one(l, Math.floor((w - 16) / 6.2)), 10.5, c.ink);
    });
    ty += 5;
  }
  return [out, ty];
}
/** 不畫成員的套件，標籤頁的大小。 */
const BOX_TAB_W = 64, BOX_TAB_H = PKG_TAB / 2;

/** 連接埠與參數的小方塊（規範 8.2.3.12、8.2.3.17）。 */
export const PORT = 12;
/** 貼在節點左右邊上的小方塊：方塊的中心在外框線上，名稱寫在節點裡面。 */
function portsSvg(n: GNode, x: number, y: number, c: Palette): string {
  const half = Math.floor((n.width - 24) / 2 / 6.2);
  return (n.ports ?? []).map((p) => {
    const px = p.side === "left" ? x - PORT / 2 : x + n.width - PORT / 2;
    return `<rect x="${px}" y="${y + p.y - PORT / 2}" width="${PORT}" height="${PORT}" fill="${c.bg}" stroke="${c.ink}" stroke-width="1"/>` +
      (p.side === "left" ? text(x + 10, y + p.y + 4, one(p.label, half), 10.5, c.ink) : text(x + n.width - 10, y + p.y + 4, one(p.label, half), 10.5, c.ink, `text-anchor="end"`));
  }).join("");
}
/** 小方塊在畫布上的座標（連線的端點）。 */
export function portPoint(n: GNode, x: number, y: number, key: string | undefined): [number, number] | null {
  const p = key ? n.ports?.find((q) => q.key === key) : undefined;
  return p ? [p.side === "left" ? x - PORT / 2 : x + n.width + PORT / 2, y + p.y] : null;
}

type Rect = { x: number; y: number; w: number; h: number };
/**
 * 圖框的範圍，與貼在圖框邊上的節點的位置。圖框包住其餘的節點（四周留 pad，上方再加名稱隔間）；
 * 左邊的小方塊由上往下排在左框線上、右邊的排在右框線上，排不下時圖框往下長。畫面與匯出共用。
 */
export function frameLayout(inner: Rect[], edge: { id: string; boundary: "left" | "right"; width: number; height: number }[], pad: number): Rect & { places: Map<string, { x: number; y: number }> } {
  const base = inner.length ? inner : [{ x: 0, y: 0, w: 240, h: 80 }];
  const x = Math.min(...base.map((b) => b.x)) - pad, y = Math.min(...base.map((b) => b.y)) - pad - FRAME_HEAD;
  const right = Math.max(...base.map((b) => b.x + b.w)) + pad;
  let bottom = Math.max(...base.map((b) => b.y + b.h)) + pad;
  const places = new Map<string, { x: number; y: number }>();
  const row = { left: 0, right: 0 };
  for (const n of edge) {
    const cy = y + FRAME_HEAD + 24 + row[n.boundary]++ * 34;
    // 方塊的中心落在框線上
    places.set(n.id, { x: n.boundary === "left" ? x - n.width + PORT / 2 : right - PORT / 2, y: cy - n.height / 2 });
    bottom = Math.max(bottom, cy + 24);
  }
  return { x, y, w: right - x, h: bottom - y, places };
}

/** 在 (x, y) 畫出一個節點，大小取自節點本身。 */
export function nodeSvg(n: GNode, x: number, y: number, c: Palette, strokeWidth = 1): string {
  const { width: w, height: h } = n;
  const cx = x + w / 2;
  const sw = `stroke="${c.ink}" stroke-width="${strokeWidth}"`;
  switch (n.shape) {
    case "start":
      return `<circle cx="${cx}" cy="${y + h / 2}" r="9" fill="${c.ink}"/>`;
    case "done":
      return `<circle cx="${cx}" cy="${y + h / 2}" r="11" fill="${c.bg}" ${sw}/><circle cx="${cx}" cy="${y + h / 2}" r="6" fill="${c.ink}"/>`;
    case "package": {
      // 資料夾：名稱寫在標籤頁，成員畫在主體裡。主體不填色，才看得到也點得到裡面的節點。
      const tw = pkgTabWidth(n.name, w);
      return `<rect x="${x + 0.5}" y="${y + PKG_TAB - 0.5}" width="${w - 1}" height="${h - PKG_TAB}" fill="none" ${sw}/>` +
        `<rect x="${x + 0.5}" y="${y + 0.5}" width="${tw - 1}" height="${PKG_TAB - 1}" fill="${c.bg}" ${sw}/>` +
        text(x + 10, y + 17, one(n.name, Math.floor((tw - 16) / 6.5)), 12.5, c.ink, `font-weight="600"`);
    }
    case "pkgbox": {
      // 不畫成員的套件（規範 8.2.3.5 的 name-inside）：空的標籤頁，名稱寫在本體中央
      let out = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${BOX_TAB_W}" height="${BOX_TAB_H}" fill="${c.bg}" ${sw}/>` +
        `<rect x="${x + 0.5}" y="${y + BOX_TAB_H + 0.5}" width="${w - 1}" height="${h - BOX_TAB_H - 1}" fill="${c.bg}" ${sw}/>`;
      n.title.forEach((l, i) => { out += text(cx, y + BOX_TAB_H + 27 + i * 16, l, 12.5, c.ink, `text-anchor="middle" font-weight="600"`); });
      return out + compartmentsSvg(n, x, y + BOX_TAB_H + 22 + n.title.length * 16 + 6, c)[0];
    }
    case "param": {
      // 貼在圖框邊上的參數與連接埠（規範 8.2.3.12、8.2.3.17）：小方塊在圖框內側那一端，名稱寫在圖框外側
      const label = n.title[0] ?? n.name;
      return n.boundary === "right"
        ? `<rect x="${x + 0.5}" y="${y + h / 2 - PORT / 2}" width="${PORT}" height="${PORT}" fill="${c.bg}" ${sw}/>` + text(x + PORT + 6, y + h / 2 + 4, label, 11, c.ink)
        : `<rect x="${x + w - PORT - 0.5}" y="${y + h / 2 - PORT / 2}" width="${PORT}" height="${PORT}" fill="${c.bg}" ${sw}/>` + text(x + w - PORT - 6, y + h / 2 + 4, label, 11, c.ink, `text-anchor="end"`);
    }
    case "comment": {
      const f = 12; // 折角大小
      return `<path d="M${x + 0.5} ${y + 0.5} H${x + w - f} L${x + w - 0.5} ${y + f} V${y + h - 0.5} H${x + 0.5} Z" fill="${c.bg}" ${sw}/>` +
        `<path d="M${x + w - f} ${y + 0.5} V${y + f} H${x + w - 0.5}" fill="none" ${sw}/>` +
        text(cx, y + 16, n.keyword, 10.5, c.ink, `text-anchor="middle"`) +
        n.title.map((l, i) => text(x + 10, y + 36 + i * 16, l, 11.5, c.ink)).join("");
    }
    default: {
      // 定義為方角、使用為圓角：«關鍵字»、名稱、隔間
      // 參照的使用（ref）外框為虛線（規範 8.2.3.11）
      let out = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${n.shape === "usage" ? 10 : 0}" fill="${c.bg}" ${sw}${n.dashed ? ` stroke-dasharray="6 4"` : ""}/>`;
      out += text(cx, y + 17, n.keyword, 10.5, c.ink, `text-anchor="middle"`);
      n.title.forEach((l, i) => { out += text(cx, y + 34 + i * 16, l, 12.5, c.ink, `text-anchor="middle" font-weight="600"`); });
      out += portsSvg(n, x, y, c);
      return out + compartmentsSvg(n, x, y + 26 + n.title.length * 16 + 4 + (n.band ?? 0), c)[0];
    }
  }
}

/**
 * 連線端點的記號（規範 8.2.3.5、8.2.3.6、8.2.3.11）。畫面與匯出共用同一份形狀，只有顏色不同。
 * 座標系 viewBox 0 0 w h，線由左往右進來，尖端在 refX。
 */
export interface MarkerDef { id: string; w: number; h: number; refX: number; body: (c: Palette) => string }
const tri = (c: Palette) => `<path d="M10 1 L23 7 L10 13 Z" fill="${c.bg}" stroke="${c.ink}" stroke-width="1"/>`;
const dot = (cx: number, cy: number, c: Palette) => `<circle cx="${cx}" cy="${cy}" r="1.4" fill="${c.ink}"/>`;
export const MARKERS: Record<"diamond" | "hollow" | "typing" | "triangle" | "redefine" | "refsubset", MarkerDef> = {
  /** 組成：擁有者端實心菱形 */
  diamond: { id: "diamond", w: 20, h: 12, refX: 1, body: (c) => `<path d="M1 6 L10 1 L19 6 L10 11 Z" fill="${c.ink}" stroke="${c.ink}" stroke-width="1"/>` },
  /** 非組成（ref）：擁有者端空心菱形 */
  hollow: { id: "hollow", w: 20, h: 12, refX: 1, body: (c) => `<path d="M1 6 L10 1 L19 6 L10 11 Z" fill="${c.bg}" stroke="${c.ink}" stroke-width="1"/>` },
  /** defined by：空心三角形加兩個點 */
  typing: { id: "typing", w: 24, h: 14, refX: 23, body: (c) => dot(7, 3, c) + dot(7, 11, c) + tri(c) },
  /** 特化、子集：空心三角形 */
  triangle: { id: "triangle", w: 24, h: 14, refX: 23, body: (c) => tri(c) },
  /** 重定義：空心三角形加一條豎線 */
  redefine: { id: "redefine", w: 24, h: 14, refX: 23, body: (c) => `<path d="M6 1 V13" fill="none" stroke="${c.ink}" stroke-width="1.2"/>` + tri(c) },
  /** 參照子集：空心三角形加四個點（兩排） */
  refsubset: { id: "refsubset", w: 24, h: 14, refX: 23, body: (c) => dot(3, 3, c) + dot(3, 11, c) + dot(7, 3, c) + dot(7, 11, c) + tri(c) },
};
/** 一個 <marker>。prefix 用來區分畫面（jri-）與匯出檔；orient 沿用兩邊原本各自的設定。 */
export const markerSvg = (m: MarkerDef, prefix: string, c: Palette, orient: "auto" | "auto-start-reverse") =>
  `<marker id="${prefix}${m.id}" viewBox="0 0 ${m.w} ${m.h}" markerWidth="${m.w}" markerHeight="${m.h}" refX="${m.refX}" refY="${m.h / 2}" orient="${orient}" markerUnits="userSpaceOnUse">${m.body(c)}</marker>`;
/** 連線兩端要用哪個記號；沒有就是 null（開放箭頭另外處理）。 */
export const edgeMarkers = (e: { head: string; tail: string }): { start: MarkerDef | null; end: MarkerDef | null } => ({
  start: e.tail === "diamond" ? MARKERS.diamond : e.tail === "hollow" ? MARKERS.hollow : null,
  end: e.head === "typing" || e.head === "triangle" || e.head === "redefine" || e.head === "refsubset" ? MARKERS[e.head] : null,
});

/** 草稿標註（不進模型）：便箋、虛線外框、純文字。 */
export function annotationSvg(a: Annotation, x: number, y: number, c: Palette, strokeWidth = 1): string {
  const { w, h } = a;
  if (a.type === "frame") {
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="none" stroke="${c.muted}" stroke-width="${strokeWidth}" stroke-dasharray="5 4"/>` +
      text(x + 10, y + 19, one(a.text, Math.floor((w - 20) / 6.5)), 12.5, c.ink, `font-weight="500"`);
  }
  const lines = wrap(a.text, Math.max(4, Math.floor((w - 20) / 6.5)), Math.max(1, Math.floor((h - 14) / 17)));
  if (a.type === "text") return lines.map((l, i) => text(x + 2, y + 16 + i * 17, l, 13, c.ink)).join("");
  const f = 12;
  return `<path d="M${x + 0.5} ${y + 0.5} H${x + w - f} L${x + w - 0.5} ${y + f} V${y + h - 0.5} H${x + 0.5} Z" fill="${c.bg}" stroke="${c.muted}" stroke-width="${strokeWidth}" stroke-dasharray="5 4"/>` +
    lines.map((l, i) => text(x + 10, y + 21 + i * 17, l, 12, c.ink)).join("");
}

/** 工具列用的小圖示（24×24）。 */
export function iconSvg(shape: Shape | "select" | "line" | "dashed" | "diamond" | "note" | "frame" | "text", c: Palette): string {
  const s = `fill="none" stroke="${c.ink}" stroke-width="1.3"`;
  switch (shape) {
    case "comment": return `<path d="M3.5 4.5 H16 L20.5 9 V19.5 H3.5 Z" ${s} stroke-linejoin="round"/><path d="M16 4.5 V9 H20.5" ${s}/>`;
    case "note": return `<path d="M3.5 4.5 H16 L20.5 9 V19.5 H3.5 Z" ${s} stroke-linejoin="round" stroke-dasharray="3 2.5"/>`;
    case "package": case "pkgbox": return `<rect x="2.5" y="8.5" width="19" height="11" ${s}/><rect x="2.5" y="4.5" width="9" height="4" ${s}/>`;
    case "frame": return `<rect x="2.5" y="4.5" width="19" height="15" ${s} stroke-dasharray="3 2.5"/>`;
    case "text": return `<path d="M5 7 V5 H19 V7 M12 5 V19 M9.5 19 H14.5" ${s}/>`;
    case "select": return `<path d="M6 4 L6 19 L10 15 L13 21 L15 20 L12 14 L18 14 Z" ${s} stroke-linejoin="round"/>`;
    case "usage": return `<rect x="2.5" y="6.5" width="19" height="11" rx="4" ${s}/>`;
    case "line": return `<line x1="3" y1="18" x2="20" y2="6" ${s}/><path d="M14 6 L20 6 L20 12" ${s}/>`;
    case "dashed": return `<line x1="3" y1="18" x2="20" y2="6" ${s} stroke-dasharray="3 2.5"/><path d="M14 6 L20 6 L20 12" ${s}/>`;
    case "diamond": return `<line x1="9" y1="15" x2="21" y2="4" ${s}/><path d="M3 20 L5 14 L10 15 L8 20 Z" fill="${c.ink}" stroke="${c.ink}"/>`;
    default: return `<rect x="2.5" y="5.5" width="19" height="13" ${s}/>`;
  }
}

/**
 * 圖框（規範 8.2.3.26 view-frame）：圓角外框，左上角的名稱隔間寫「«view» 名稱 : 檢視定義」，隔間右下為圓角。
 */
export const FRAME_HEAD = 28;
export function frameSvg(label: string, x: number, y: number, w: number, h: number, p: Palette): string {
  const tw = Math.min(w, Math.ceil(textWidth(label, 13, 7.2) + 26));
  const r = 10;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none" stroke="${p.ink}" stroke-width="1"/>`
    + `<path d="M${x} ${y + r} Q${x} ${y} ${x + r} ${y} H${x + tw} V${y + FRAME_HEAD - 8} Q${x + tw} ${y + FRAME_HEAD} ${x + tw - 8} ${y + FRAME_HEAD} H${x} Z" fill="${p.bg}" stroke="${p.ink}" stroke-width="1"/>`
    + `<text x="${x + 12}" y="${y + 19}" font-size="13" fill="${p.ink}" ${FONT}>${esc(label)}</text>`;
}
