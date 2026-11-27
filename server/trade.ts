// 方案比較的權重與分數：寫入文字的邏輯。準則＝連到方案（或候選）的需求；權重是需求上的 @TradeWeight，分數是候選上的 score_<需求編號> 屬性，
// 風險修正後的調整分數是候選上的 adjusted_<需求編號> 屬性（沒有調整就不寫）。
import type { Element } from "./extract.ts";
import { UserError } from "./projects.ts";
import { insertInside, replaceLoc } from "./edits.ts";

/** 需求編號轉成屬性名稱：REQ-SYS-001 → score_REQ_SYS_001 */
export function scoreKey(req: Element): string {
  if (!req.shortName) throw new UserError("這條需求沒有編號，無法當準則。請先到屬性欄填編號。");
  return `score_${req.shortName.replace(/\W/g, "_")}`;
}

/** 調整分數的屬性名稱：REQ-SYS-001 → adjusted_REQ_SYS_001 */
export const adjustedKey = (req: Element): string => scoreKey(req).replace(/^score_/, "adjusted_");

const real = (v: string, what: string): string => {
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) throw new UserError(`${what}必須是數字。`);
  const n = Number(t);
  if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new UserError(`${what}太大。`);
  return t.includes(".") ? t : `${t}.0`;
};

/** 準則權重：空字串＝拿掉（回到預設 1）。權重不能是負數。 */
export function setWeightText(content: string, req: Element, weight: string): string {
  const w = weight.trim();
  if (w && Number(real(w, "權重")) < 0) throw new UserError("權重不能是負數。");
  const text = w ? `@TradeWeight { weight = ${real(w, "權重")}; }` : "";
  const loc = req.metaLoc.TradeWeight;
  if (loc) return replaceLoc(content, loc, text);
  if (!text) return content;
  return insertInside(content, req, (indent) => `${indent}${text}\n`);
}

/** 候選對準則的分數：空字串＝刪除。adjusted＝寫調整分數（風險修正後）。 */
export function setScoreText(content: string, variant: Element, req: Element, score: string, adjusted = false): string {
  const key = adjusted ? adjustedKey(req) : scoreKey(req);
  const loc = variant.attrLoc[key];
  const s = score.trim();
  if (!s) return loc ? replaceLoc(content, loc, "") : content;
  const text = `attribute ${key} : TradeScore = ${real(s, "分數")};`;
  if (loc) return replaceLoc(content, loc, text);
  return insertInside(content, variant, (indent) => `${indent}${text}\n`);
}
