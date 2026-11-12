// SysML 1.7 圖形記法的繪製。畫面、PNG／SVG 匯出與審查報告共用這一份，確保三者一致。
import { wrap } from "./model.ts";
import type { GNode, Shape } from "./model.ts";

export interface Palette { ink: string; bg: string; muted: string }
export const SCREEN: Palette = { ink: "var(--ink)", bg: "var(--bg)", muted: "var(--ink-muted)" };
export const PRINT: Palette = { ink: "#111111", bg: "#ffffff", muted: "#555555" };

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = `font-family="'Noto Sans TC','Microsoft JhengHei',sans-serif"`;
const text = (x: number, y: number, s: string, size: number, fill: string, extra = "") => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${FONT} ${extra}>${esc(s)}</text>`;
const one = (s: string, units: number) => wrap(s, units, 1)[0] ?? "";

/** 火柴人（actor）。cx 為中心，y 為頂端，高約 64。 */
export function stickFigure(cx: number, y: number, c: Palette, scale = 1): string {
  const s = (v: number) => (v * scale).toFixed(1);
  return `<g fill="none" stroke="${c.ink}" stroke-width="1.2" stroke-linecap="round">` +
    `<circle cx="${cx}" cy="${y + 9 * scale}" r="${s(8)}" fill="${c.bg}"/>` +
    `<line x1="${cx}" y1="${y + 17 * scale}" x2="${cx}" y2="${y + 42 * scale}"/>` +
    `<line x1="${cx - 15 * scale}" y1="${y + 26 * scale}" x2="${cx + 15 * scale}" y2="${y + 26 * scale}"/>` +
    `<line x1="${cx}" y1="${y + 42 * scale}" x2="${cx - 13 * scale}" y2="${y + 62 * scale}"/>` +
    `<line x1="${cx}" y1="${y + 42 * scale}" x2="${cx + 13 * scale}" y2="${y + 62 * scale}"/></g>`;
}

/** 在 (x, y) 畫出一個節點，大小取自節點本身。 */
export function nodeSvg(n: GNode, x: number, y: number, c: Palette, strokeWidth = 1): string {
  const { width: w, height: h } = n;
  const cx = x + w / 2;
  const sw = `stroke="${c.ink}" stroke-width="${strokeWidth}"`;
  switch (n.shape) {
    case "initial":
      return `<circle cx="${cx}" cy="${y + h / 2}" r="9" fill="${c.ink}"/>`;
    case "final":
      return `<circle cx="${cx}" cy="${y + h / 2}" r="11" fill="${c.bg}" ${sw}/><circle cx="${cx}" cy="${y + h / 2}" r="6" fill="${c.ink}"/>`;
    case "actor": {
      const lines = wrap(n.name, 14, 2);
      return stickFigure(cx, y + 2, c) + lines.map((l, i) => text(cx, y + 82 + i * 15, l, 12.5, c.ink, `text-anchor="middle"`)).join("");
    }
    case "usecase": {
      const lines = wrap(n.name, 20, 2);
      const top = y + h / 2 + 4 - (lines.length - 1) * 8;
      return `<ellipse cx="${cx}" cy="${y + h / 2}" rx="${w / 2 - 1}" ry="${h / 2 - 1}" fill="${c.bg}" ${sw}/>` + lines.map((l, i) => text(cx, top + i * 16, l, 13, c.ink, `text-anchor="middle"`)).join("");
    }
    case "action":
    case "state": {
      let out = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="14" fill="${c.bg}" ${sw}/>`;
      const rows = n.compartments.flat();
      out += text(cx, rows.length ? y + 24 : y + h / 2 + 4.5, one(n.name, 20), 13, c.ink, `text-anchor="middle" font-weight="500"`);
      if (rows.length) {
        out += `<line x1="${x}" y1="${y + 36}" x2="${x + w}" y2="${y + 36}" stroke="${c.ink}" stroke-width="1"/>`;
        rows.forEach((l, i) => { out += text(x + 10, y + 52 + i * 16, one(l, 22), 10.5, c.muted); });
      }
      return out;
    }
    case "part":
      return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="${c.bg}" ${sw}/>` + text(cx, y + h / 2 + 4.5, one(n.name, 24), 12.5, c.ink, `text-anchor="middle"`);
    default: {
      // block、requirement、testCase：關鍵字、名稱、隔間
      let out = `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" fill="${c.bg}" ${sw}/>`;
      out += text(cx, y + 17, n.keyword, 10.5, c.ink, `text-anchor="middle"`);
      out += text(cx, y + 34, one(n.name, Math.floor(w / 8)), 13, c.ink, `text-anchor="middle" font-weight="600"`);
      let ty = y + 44;
      for (const comp of n.compartments) {
        out += `<line x1="${x}" y1="${ty}" x2="${x + w}" y2="${ty}" stroke="${c.ink}" stroke-width="1"/>`;
        ty += 4;
        comp.forEach((l, i) => {
          ty += 16;
          // 隔間標題（values）置中斜體，其餘靠左
          if (i === 0 && l === "values") out += text(cx, ty - 3, l, 10, c.muted, `text-anchor="middle" font-style="italic"`);
          else out += text(x + 8, ty - 3, one(l, Math.floor((w - 16) / 6.2)), 10.5, c.ink);
        });
        ty += 5;
      }
      return out;
    }
  }
}

/** 工具列用的小圖示（24×24）。 */
export function iconSvg(shape: Shape | "select" | "line" | "dashed" | "diamond", c: Palette): string {
  const s = `fill="none" stroke="${c.ink}" stroke-width="1.3"`;
  switch (shape) {
    case "select": return `<path d="M6 4 L6 19 L10 15 L13 21 L15 20 L12 14 L18 14 Z" ${s} stroke-linejoin="round"/>`;
    case "actor": return stickFigure(12, 1, c, 0.34).replace(/stroke-width="1.2"/, `stroke-width="1.3"`);
    case "usecase": return `<ellipse cx="12" cy="12" rx="10" ry="6" ${s}/>`;
    case "action": case "state": return `<rect x="2.5" y="6.5" width="19" height="11" rx="5" ${s}/>`;
    case "requirement": case "testcase": return `<rect x="2.5" y="4.5" width="19" height="15" ${s}/><line x1="2.5" y1="10" x2="21.5" y2="10" ${s}/>`;
    case "line": return `<line x1="3" y1="18" x2="20" y2="6" ${s}/><path d="M14 6 L20 6 L20 12" ${s}/>`;
    case "dashed": return `<line x1="3" y1="18" x2="20" y2="6" ${s} stroke-dasharray="3 2.5"/><path d="M14 6 L20 6 L20 12" ${s}/>`;
    case "diamond": return `<line x1="9" y1="15" x2="21" y2="4" ${s}/><path d="M3 20 L5 14 L10 15 L8 20 Z" fill="${c.ink}" stroke="${c.ink}"/>`;
    default: return `<rect x="2.5" y="5.5" width="19" height="13" ${s}/>`;
  }
}
