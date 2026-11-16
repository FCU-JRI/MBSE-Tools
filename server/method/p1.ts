// P1：需求屬性與需求矩陣（docs/IMPL-PLAN.md）。這一期的伺服器路由寫在這裡，路徑一律以 /api/projects/:id/ 開頭。
//   POST /api/projects/:id/requirements        新增需求；需要驗證的類別必填驗證方法（METHOD.md 2.1）
//   POST /api/projects/:id/requirements/info   修改需求的共同屬性（驗證方法、驗證負責人、驗證層級、負責人、理由、狀態、需求類型）
//   GET  /api/projects/:id/requirements/vcrm.xlsx  需求矩陣，比賽附件 10 的格式（METHOD.md 第 8 節）
import ExcelJS from "exceljs";
import type { Mount } from "./context.ts";
import { ROOT_PACKAGE } from "../engine.ts";
import type { Analysis } from "../engine.ts";
import type { Element, Loc } from "../extract.ts";
import { insertInside, insertInto, replaceLoc, snippetFor } from "../edits.ts";
import { CATEGORY } from "../metamodel.ts";
import { evaluateProcess, stepOfCategory } from "../process.ts";
import { UserError } from "../projects.ts";
import { metaTexts, normalizeInput, REQ_CATEGORIES, ReqInputError, VCRM_HEADERS, VCRM_TITLE, vcrmSections } from "./p1-req.ts";
import type { ReqInput } from "./p1-req.ts";

type Texts = ReturnType<typeof metaTexts>;
const META_NAMES = ["VerificationMethod", "Rationale", "RequirementInfo"] as const;

function normalize(category: string, body: ReqInput) {
  try { return normalizeInput(category, body ?? {}); }
  catch (e) { if (e instanceof ReqInputError) throw new UserError(e.message); throw e; }
}

/** 在 snippetFor 產生的宣告裡加上標記（沒有主體就展開成大括號） */
export function withMeta(snippet: string, indent: string, lines: string[]): string {
  if (lines.length === 0) return snippet;
  const body = lines.map((l) => `${indent}    ${l}\n`).join("");
  if (/;\n$/.test(snippet) && !snippet.slice(0, -1).includes("\n")) return snippet.replace(/;\n$/, ` {\n${body}${indent}}\n`);
  const closing = `${indent}}\n`;
  if (!snippet.endsWith(closing)) throw new UserError("無法寫入需求的屬性。");
  return snippet.slice(0, -closing.length) + body + closing;
}

const before = (x: Loc, y: Loc) => x.line - y.line || x.col - y.col;

/** 把元素主體裡的三個標記換成新的文字；原本沒有的接在最後一個既有標記之後，都沒有就插進主體 */
export function setMetaTexts(content: string, el: Element, texts: Texts): string {
  const existing = META_NAMES.filter((k) => el.metaLoc[k]).sort((x, y) => before(el.metaLoc[y], el.metaLoc[x]));
  const missing = META_NAMES.filter((k) => !el.metaLoc[k] && texts[k]).map((k) => texts[k]);
  if (existing.length === 0) return missing.length ? insertInside(content, el, (indent) => missing.map((t) => `${indent}${t}\n`).join("")) : content;
  let c = content;
  existing.forEach((k, i) => {
    const loc = el.metaLoc[k];
    let t = texts[k];
    if (i === 0 && missing.length) {
      const indent = c.split("\n")[loc.line - 1]?.match(/^\s*/)?.[0] ?? "";
      t = [t, ...missing].filter(Boolean).join(`\n${indent}`);
    }
    c = replaceLoc(c, loc, t);
  });
  return c;
}

/** 需求矩陣：比賽附件 10（Verification Cross Reference Matrix）的格式，只用格式、不含範例內容 */
export async function vcrmWorkbook(a: Analysis): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JRI MBSE";
  wb.created = new Date();
  const ws = wb.addWorksheet("Requirements document", { views: [{ state: "frozen", ySplit: 2 }] });
  const widths = [18, 9, 9, 43, 15, 14, 15, 15, 15, 27, 9, 11];
  ws.columns = widths.map((width) => ({ width }));
  const last = VCRM_HEADERS.length;
  const head = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } } as const;
  const thin = { style: "thin" } as const;
  const border = { top: thin, left: thin, bottom: thin, right: thin };

  ws.getCell(1, 1).value = VCRM_TITLE;
  ws.mergeCells(1, 1, 1, last);
  ws.getRow(1).font = { bold: true, size: 14 };
  ws.getCell(1, 1).fill = head;
  ws.getCell(1, 1).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).values = VCRM_HEADERS;
  ws.mergeCells(2, 2, 2, 3);
  for (let c = 1; c <= last; c++) {
    const cell = ws.getCell(2, c);
    cell.font = { bold: true };
    cell.fill = head;
    cell.border = border;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  let r = 3;
  for (const s of vcrmSections(a)) {
    // 前三段一定列出；次系統的段落有需求才列
    if (s.rows.length === 0 && s.key.startsWith("sub:")) continue;
    const start = r;
    ws.getCell(start, 1).value = s.title;
    for (const x of s.rows.length ? s.rows : [null]) {
      const values = x ? [x.child ? "" : x.id, x.child ? x.id : "", x.text, x.tracedFrom, x.owner, x.method, x.lead, x.level, x.rationale, x.status, x.type] : [];
      values.forEach((v, i) => { ws.getCell(r, i + 2).value = v; });
      for (let c = 1; c <= last; c++) {
        const cell = ws.getCell(r, c);
        cell.border = border;
        cell.alignment = { vertical: "top", wrapText: true };
      }
      r++;
    }
    if (r - 1 > start) ws.mergeCells(start, 1, r - 1, 1);
    ws.getCell(start, 1).font = { bold: true };
    ws.getCell(start, 1).alignment = { vertical: "middle", wrapText: true };
    r++; // 範本：編完一段空一行
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const rootFile = (a: Analysis) => a.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE)?.file || "model.sysml";

export const mount: Mount = (app, ctx) => {
  const { store } = ctx;

  app.post("/api/projects/:id/requirements", ctx.wrap(async (req, res) => {
    const id = ctx.pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new UserError("模型目前有錯誤，請先到「原始碼」分頁修正後再新增。");
    const cat = CATEGORY.get(String(req.body?.category ?? ""));
    if (!cat || !REQ_CATEGORIES.includes(cat.id)) throw new UserError("這裡只能新增需求類別。");
    const n = normalize(cat.id, req.body);
    // 流程範本專案：前面的步驟沒完成，不能新增後面步驟的項目（和新增元素相同）
    if ((await store.readProject(id)).template === "guided") {
      const step = stepOfCategory(cat.id);
      const status = evaluateProcess(a);
      if (step && status.find((s) => s.id === step.id)?.state === "locked") {
        const cur = status.find((s) => s.state === "current");
        throw new UserError(`還不能新增${cat.zh}。請先完成「${cur?.zh ?? "前面的步驟"}」：${cur?.issues[0]?.text ?? ""}`);
      }
    }
    const parent = req.body.parentId ? a.elements.find((e) => e.id === req.body.parentId) : undefined;
    if (parent?.shared) throw new UserError("這是共用元件庫的內容，不能在專案內修改。請管理員到「管理」頁修改。");
    const file = parent ? parent.file : rootFile(a);
    const content = await store.readFile(id, file);
    const t = metaTexts(n);
    const lines = META_NAMES.map((k) => t[k]).filter(Boolean);
    const input = { category: cat.id, name: String(req.body.name ?? ""), shortName: req.body.shortName, doc: req.body.doc, source: req.body.source };
    const make = (indent: string) => withMeta(snippetFor(input, a.elements, indent), indent, lines);
    const next = parent ? insertInside(content, parent, make) : insertInto(content, a.elements.filter((e) => e.file === file), ROOT_PACKAGE, cat.pkg, make);
    const r = await store.saveFile(id, file, next, ctx.author(req), `新增${cat.zh}：${input.name.trim()}`);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...((await ctx.view(id)) as object) });
  }));

  app.post("/api/projects/:id/requirements/info", ctx.wrap(async (req, res) => {
    const id = ctx.pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new UserError("模型目前有錯誤，請先到「原始碼」分頁修正後再修改。");
    const el = a.elements.find((e) => e.id === req.body?.id);
    if (!el || !REQ_CATEGORIES.includes(el.category ?? "")) throw new UserError("找不到這條需求。");
    if (el.shared) throw new UserError("這是共用元件庫的內容，不能在專案內修改。請管理員到「管理」頁修改。");
    const n = normalize(el.category as string, req.body);
    const content = await store.readFile(id, el.file);
    const next = setMetaTexts(content, el, metaTexts(n));
    if (next === content) return res.json({ saved: true, ...((await ctx.view(id)) as object) });
    const r = await store.saveFile(id, el.file, next, ctx.author(req), `修改需求屬性：${el.shortName ?? ""} ${el.name}`.trim());
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...((await ctx.view(id)) as object) });
  }));

  app.get("/api/projects/:id/requirements/vcrm.xlsx", ctx.wrap(async (req, res) => {
    const id = ctx.pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new UserError("模型目前有錯誤，修正後才能匯出。");
    const buf = await vcrmWorkbook(a);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${id.replace(/[^A-Za-z0-9._-]/g, "_")}-vcrm.xlsx"`);
    res.send(buf);
  }));
};
