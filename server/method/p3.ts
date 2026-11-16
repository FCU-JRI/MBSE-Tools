// P3：任務剖面、功能分配、MOE／MOP／TPM（docs/IMPL-PLAN.md）。這一期的伺服器路由寫在這裡，路徑一律以 /api/projects/:id/ 開頭。
//   GET  /api/projects/:id/p3        推導鏈（任務需求 → 剖面 → 功能 → 系統 → 系統需求）、MOE／MOP／TPM 與各圖還缺什麼
//   POST /api/projects/:id/p3/meta   設定元素上的 P3 標記（@ModeKind、@SuccessLevels、@TPMTrack）的欄位；值為 null 代表清除
// 算法在 web/src/method/p3.ts，前端與這裡共用。
import type { Mount } from "./context.ts";
import type { Element } from "../extract.ts";
import type { Analysis as WebAnalysis } from "../../web/src/api.ts";
import { replaceLoc, insertInside } from "../edits.ts";
import { allocationGaps, chainOf, measuresOf, MODE_KINDS, P3_META, profileGaps } from "../../web/src/method/p3.ts";

const asWeb = (a: unknown) => a as WebAnalysis;

/** 一個欄位的值寫成 SysML v2 的字面值；不合法時丟出說明 */
function literal(meta: string, field: { name: string; zh: string; type: "real" | "text" }, value: unknown): string {
  if (field.type === "real") {
    const n = typeof value === "number" ? value : Number(String(value).trim());
    if (String(value).trim() === "" || !Number.isFinite(n)) throw new Error(`${field.zh}必須是數字。`);
    const s = String(n);
    return /[.eE]/.test(s) ? s : `${s}.0`;
  }
  const s = String(value).trim();
  if (/[\r\n"\\]/.test(s) || s.length > 60) throw new Error(`${field.zh}不能有換行、引號或反斜線，最長 60 個字。`);
  if (meta === "ModeKind" && !MODE_KINDS.some((k) => k.id === s)) throw new Error(`模式的種類只能是 ${MODE_KINDS.map((k) => `${k.id}（${k.zh}）`).join("、")}。`);
  if (field.name === "better" && s !== "higher" && s !== "lower") throw new Error("better 只能是 higher（越大越好）或 lower（越小越好）。");
  return JSON.stringify(s);
}

/**
 * 設定元素上某個 P3 標記的欄位，回傳新的原始碼。values 裡沒有的欄位保留原值，null 清除該欄位；
 * 全部欄位都清掉時移除整個標記。
 */
export function setMetaText(content: string, el: Element, meta: string, values: Record<string, unknown>): string {
  const def = P3_META[meta];
  if (!def) throw new Error("不認得的標記。");
  for (const k of Object.keys(values)) if (!def.fields.some((f) => f.name === k)) throw new Error(`${def.zh}沒有「${k}」這個欄位。`);
  const has = el.tags.includes(meta);
  const parts: string[] = [];
  for (const f of def.fields) {
    const v = f.name in values ? values[f.name] : has && el.attrs[f.name] !== undefined ? (f.type === "real" ? el.attrs[f.name] : el.attrs[f.name].replace(/^"(.*)"$/, "$1")) : undefined;
    if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) continue;
    parts.push(`${f.name} = ${literal(meta, f, v)};`);
  }
  const text = parts.length ? `@${meta} { ${parts.join(" ")} }` : "";
  const loc = el.metaLoc[meta];
  if (loc) return replaceLoc(content, loc, text);
  if (!text) return content;
  return insertInside(content, el, (indent) => `${indent}${text}\n`);
}

export const mount: Mount = (app, ctx) => {
  app.get("/api/projects/:id/p3", ctx.wrap(async (req, res) => {
    const a = asWeb(await ctx.store.analyzeProject(ctx.pid(req)));
    res.json({ chain: chainOf(a), measures: measuresOf(a), gaps: { profile: profileGaps(a), allocation: allocationGaps(a) } });
  }));

  app.post("/api/projects/:id/p3/meta", ctx.wrap(async (req, res) => {
    const id = ctx.pid(req);
    const b = req.body ?? {};
    const meta = String(b.meta ?? "");
    if (!P3_META[meta]) throw new ctx.store.UserError("不認得的標記。");
    const values = b.values && typeof b.values === "object" && !Array.isArray(b.values) ? (b.values as Record<string, unknown>) : null;
    if (!values) throw new ctx.store.UserError("請提供要設定的欄位（values）。");
    const a = await ctx.store.analyzeProject(id);
    if (!a.ok) throw new ctx.store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
    const el = a.elements.find((e) => e.id === b.element);
    if (!el) throw new ctx.store.UserError("找不到這個元素。");
    if (el.shared) throw new ctx.store.UserError("這是共用元件庫的內容，不能在專案內修改。");
    const want = meta === "ModeKind" ? "Mode" : meta === "SuccessLevels" ? "MOE" : null;
    if (want && el.category !== want) throw new ctx.store.UserError(`${P3_META[meta].zh}只能標在${want === "Mode" ? "模式" : "MOE"}上。`);
    let content = await ctx.store.readFile(id, el.file);
    try { content = setMetaText(content, el, meta, values); } catch (e) {
      if (e instanceof ctx.store.UserError) throw e;
      throw new ctx.store.UserError((e as Error).message);
    }
    const r = await ctx.store.saveFile(id, el.file, content, ctx.author(req), `設定${P3_META[meta].zh}：${el.name}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, selected: el.id, ...((await ctx.view(id)) as object) });
  }));
};
