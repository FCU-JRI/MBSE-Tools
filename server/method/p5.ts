// P5：FMEA、風險與圖表（docs/IMPL-PLAN.md）。這一期的伺服器路由寫在這裡，路徑一律以 /api/projects/:id/ 開頭。
//   GET  fmea                 FMEA 列（含建議值與依據）、風險、依次系統彙整、圖 10 還缺什麼、三張尺度表
//   POST fmea/rows            在「次系統 × 功能」的骨架列上建立失效模式（連同兩條 #trace）
//   POST risks/mitigation     由風險產生緩解的需求或追加的驗證（新元素 #trace 到風險，來源就是風險）
//   GET  fmea.xlsx            照台灣盃附件 12 的格式匯出
import ExcelJS from "exceljs";
import type { Mount } from "./context.ts";
import type { Analysis } from "../engine.ts";
import type { Element } from "../extract.ts";
import { CATEGORY } from "../metamodel.ts";
import { insertInto, snippetFor } from "../edits.ts";
import { methodKind } from "../upgrade.ts";
import { SCALE_D, SCALE_O, SCALE_S, bySubsystem, fmeaRows, label, p5Issues, riskRows } from "../../web/src/method/p5/core.ts";
import type { FmeaRow, ScaleRow } from "../../web/src/method/p5/core.ts";

const ROOT = "Project";
const rootFile = (a: Analysis) => a.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT)?.file || "model.sysml";
const inFile = (a: Analysis, file: string) => a.elements.filter((e) => e.file === file);
const quote = (n: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
const qn = (q: string) => q.split("::").map(quote).join("::");
const STRUCT = new Set(["System", "Subsystem", "Component"]);

/** 失效模式要連到的次系統：分配到零件時連它的定義（名稱穩定、從套件外也引用得到）。 */
function structTarget(a: Analysis, e: Element): Element {
  if (e.kind !== "PartUsage") return e;
  return a.elements.find((d) => e.typeIds.includes(d.id) && STRUCT.has(d.category ?? "") && d.kind === "PartDefinition") ?? e;
}

export function summary(a: Analysis) {
  const rows = fmeaRows(a);
  return { rows, risks: riskRows(a), subsystems: bySubsystem(rows), issues: p5Issues(a), scales: { o: SCALE_O, s: SCALE_S, d: SCALE_D } };
}

/** 照比賽附件 12 的格式：標題一列、表頭兩列（矯正前、矯正結果合併），次系統欄依組合併。另附建議值與影響範圍、尺度定義、風險登記。 */
export async function fmeaWorkbook(projectName: string, a: Analysis): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "JRI MBSE";
  wb.created = new Date();
  const thin = { style: "thin" as const };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const ws = wb.addWorksheet("失效模式效應分析表", { views: [{ state: "frozen", ySplit: 3 }] });
  const widths = [14, 18, 24, 24, 22, 28, 9, 9, 9, 11, 30, 14, 9, 9, 9, 9, 11];
  ws.columns = widths.map((width) => ({ width }));
  ws.mergeCells("A1:Q1");
  ws.getCell("A1").value = "失效模式效應分析 (Failure Mode and Effects Analysis, FMEA)";
  ws.getCell("A1").font = { bold: true, size: 14 };
  const head2 = ["次系統", "功能", "潛在失效模式", "失效影響", "失效因素", "現狀控制", "矯正前", "", "", "", "建議矯正措施/狀態", "負責人/日期", "矯正結果", "", "", "", ""];
  const head3 = ["", "", "", "", "", "", "發生度 (O)", "嚴重度 (S)", "難檢度 (D)", "風險優先數 (RPN)", "", "", "完成校正", "發生度 (O)", "嚴重度 (S)", "難檢度 (D)", "風險優先數 (RPN)"];
  ws.getRow(2).values = head2;
  ws.getRow(3).values = head3;
  for (const c of ["A", "B", "C", "D", "E", "F", "K", "L"]) ws.mergeCells(`${c}2:${c}3`);
  ws.mergeCells("G2:J2");
  ws.mergeCells("M2:Q2");
  for (const r of [2, 3]) ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => { cell.font = { bold: true }; cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; cell.border = border; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8ECF1" } }; });

  // 只匯出已填的失效模式；依次系統成組（組的順序看最高的 S），組內先 S 再 RPN
  const rows = fmeaRows(a).filter((r) => r.fm);
  const groups = new Map<string, FmeaRow[]>();
  for (const r of rows) groups.set(r.subsystem.name, [...(groups.get(r.subsystem.name) ?? []), r]);
  let at = 4;
  const blank = (v: number | null) => (v === null ? "" : v);
  for (const [name, list] of groups) {
    const start = at;
    for (const r of list) {
      ws.getRow(at).values = [name, r.fn.name, r.mode, r.effect, r.cause, r.control, blank(r.o), blank(r.s), blank(r.d), blank(r.rpn), r.action,
        [r.owner, r.due].filter(Boolean).join("/"), r.done ? "√" : "", blank(r.oAfter), blank(r.sAfter), blank(r.dAfter), blank(r.rpnAfter)];
      ws.getRow(at).eachCell({ includeEmpty: true }, (cell, col) => { cell.border = border; cell.alignment = { vertical: "middle", wrapText: true, horizontal: col >= 7 && col !== 11 && col !== 12 ? "center" : "left" }; });
      at++;
    }
    if (at - start > 1) ws.mergeCells(`A${start}:A${at - 1}`);
    ws.getCell(`A${start}`).font = { bold: true };
  }

  // 比賽格式以外的欄位放另一張表，不動主表的欄位
  const extra = wb.addWorksheet("建議值與影響範圍");
  extra.columns = [["次系統", 16], ["功能", 18], ["潛在失效模式", 24], ["嚴重度 S", 9], ["S 來源", 8], ["S 建議值", 9], ["S 依據", 50], ["難檢度 D", 9], ["D 來源", 8], ["D 建議值", 9], ["D 依據", 50], ["影響範圍", 9], ["牽連的需求", 9], ["牽連的介面", 9], ["牽連的元件", 9], ["S ≥ 8 未矯正", 12]]
    .map(([header, width]) => ({ header: String(header), width: Number(width) }));
  extra.getRow(1).font = { bold: true };
  for (const r of fmeaRows(a)) extra.addRow([r.subsystem.name, r.fn.name, r.mode || "（尚未填）", blank(r.s), r.sHuman !== null ? "人填" : "建議", blank(r.sSuggest.value), r.sSuggest.basis,
    blank(r.d), r.dHuman !== null ? "人填" : "建議", blank(r.dSuggest.value), r.dSuggest.basis, r.impact.total, r.impact.requirements.length, r.impact.interfaces, r.impact.components.length, r.missingAction ? "要補" : ""]);
  extra.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });

  const scales = wb.addWorksheet("風險指數評估參考定義");
  scales.columns = [{ width: 22 }, { width: 70 }, { width: 14 }, { width: 8 }];
  const put = (title: string, head: string[], list: ScaleRow[]) => {
    const t = scales.addRow([title]);
    t.font = { bold: true };
    const h = scales.addRow(head);
    h.font = { bold: true };
    h.eachCell((c) => { c.border = border; });
    for (const s of list) scales.addRow([s.group, s.criterion, s.note ?? "", s.value]).eachCell({ includeEmpty: true }, (c) => { c.border = border; c.alignment = { wrapText: true, vertical: "middle" }; });
    scales.addRow([]);
  };
  put("失效模式效應分析(FMEA) 發生度(O)風險指數", ["可能性", "判定準則：在項目的可靠度／設計壽命內", "發生頻率", "等級"], SCALE_O);
  put("失效模式效應分析(FMEA) 嚴重度(S)風險指數", ["影響", "判定準則：影響嚴重性", "", "等級"], SCALE_S);
  put("失效模式效應分析(FMEA) 難檢度(D)風險指數", ["檢測機會", "判定準則", "檢測可能性", "等級"], SCALE_D);

  const risk = wb.addWorksheet("風險登記");
  risk.columns = [["編號", 12], ["名稱", 24], ["可能性 1–5", 10], ["後果 1–5", 10], ["風險值", 8], ["緩解後可能性", 10], ["緩解後後果", 10], ["掛在", 24], ["威脅的需求", 30], ["來源", 24], ["緩解措施", 30], ["緩解產生的需求", 30], ["追加的驗證", 30], ["影響範圍", 9], ["負責人", 12], ["狀態", 10]]
    .map(([header, width]) => ({ header: String(header), width: Number(width) }));
  risk.getRow(1).font = { bold: true };
  const names = (l: { shortName: string | null; name: string }[]) => l.map((e) => label(e as never)).join("\n");
  for (const r of riskRows(a)) risk.addRow([r.risk.shortName ?? "", r.risk.name, blank(r.likelihood), blank(r.consequence), blank(r.score), blank(r.residualLikelihood), blank(r.residualConsequence),
    names(r.attachedTo), names(r.threatens), [r.risk.attrs.source ?? "", names(r.sources)].filter(Boolean).join("\n"), r.risk.attrs.mitigation ?? "", names(r.mitigationRequirements), names(r.mitigationVerifications), r.impact.total, r.risk.attrs.owner ?? "", r.risk.attrs.status ?? ""]);
  risk.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });

  wb.title = `${projectName} FMEA`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const mount: Mount = (app, ctx) => {
  const { wrap, pid, author, view, store } = ctx;
  const ready = async (id: string) => {
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
    return a;
  };
  /** 先插入新元素，重新解析拿到它的完整名稱，再在根套件加上 #trace 相依，一次存檔。 */
  const createWithTraces = async (id: string, a: Analysis, category: string, body: Record<string, unknown>, traces: (q: string) => [string, string][], message: string, who: string) => {
    const cat = CATEGORY.get(category);
    if (!cat) throw new store.UserError("未知的元素類別。");
    const file = rootFile(a);
    let content = await store.readFile(id, file);
    const name = String(body.name ?? "").trim();
    content = insertInto(content, inFile(a, file), ROOT, cat.pkg, (indent) => snippetFor({ ...(body as object), category, name } as never, a.elements, indent));
    const mid = await store.analyzeProject(id, { file, content });
    if (!mid.ok) return { saved: false as const, diagnostics: mid.diagnostics };
    const before = new Set(a.elements.map((e) => e.id));
    const made = mid.elements.find((e) => !before.has(e.id) && e.category === category && e.name === name);
    if (!made) throw new store.UserError("新增後找不到這個元素，未儲存。");
    const lines = traces(made.qualifiedName);
    if (lines.length) content = insertInto(content, inFile(mid, file), ROOT, null, (indent) => lines.map(([f, t]) => `${indent}#trace dependency from ${qn(f)} to ${qn(t)};\n`).join(""));
    const r = await store.saveFile(id, file, content, who, message);
    if (!r.saved) return { saved: false as const, diagnostics: r.analysis.diagnostics };
    return { saved: true as const, id: made.id };
  };

  app.get("/api/projects/:id/fmea", wrap(async (req, res) => res.json(summary(await ready(pid(req))))));

  app.post("/api/projects/:id/fmea/rows", wrap(async (req, res) => {
    const id = pid(req);
    const a = await ready(id);
    const b = req.body ?? {};
    const fn = a.elements.find((e) => e.id === b.function);
    const target = a.elements.find((e) => e.id === b.subsystem);
    if (!fn && !target) throw new store.UserError("請指定功能或次系統。");
    if (!String(b.name ?? "").trim()) throw new store.UserError("請填潛在失效模式。");
    const tgt = target ? structTarget(a, target) : null;
    const r = await createWithTraces(id, a, "FailureMode", { name: b.name, shortName: b.shortName, doc: b.doc, attrs: b.attrs },
      (q) => [...(fn ? [[q, fn.qualifiedName] as [string, string]] : []), ...(tgt ? [[q, tgt.qualifiedName] as [string, string]] : [])],
      `新增失效模式：${String(b.name).trim()}（${[tgt?.name, fn?.name].filter(Boolean).join(" × ")}）`, author(req));
    if (!r.saved) return res.status(422).json(r);
    res.json({ saved: true, selected: r.id, ...(await view(id) as object) });
  }));

  app.post("/api/projects/:id/risks/mitigation", wrap(async (req, res) => {
    const id = pid(req);
    const a = await ready(id);
    const b = req.body ?? {};
    const risk = a.elements.find((e) => e.id === b.risk && (e.category === "Risk" || e.category === "FailureMode"));
    if (!risk) throw new store.UserError("找不到這個風險或失效模式。");
    const category = String(b.category ?? "");
    const cat = CATEGORY.get(category);
    const isVer = category === "VerificationEvent";
    if (!cat || !(isVer || cat.keyword === "requirement")) throw new store.UserError("緩解措施只能是需求或驗證事件。");
    if (!String(b.name ?? "").trim()) throw new store.UserError("請填名稱。");
    if (isVer && b.method && !methodKind(String(b.method))) throw new store.UserError("驗證方法不合法。");
    const verifies = isVer && b.verifies ? a.elements.find((e) => e.id === b.verifies)?.qualifiedName : undefined;
    const r = await createWithTraces(id, a, category, { name: b.name, doc: b.doc, attrs: b.attrs, method: isVer ? b.method : undefined, verifies },
      (q) => [[q, risk.qualifiedName]], `${isVer ? "追加驗證" : "緩解需求"}：${String(b.name).trim()}（來源 ${label(risk)}）`, author(req));
    if (!r.saved) return res.status(422).json(r);
    res.json({ saved: true, selected: r.id, ...(await view(id) as object) });
  }));

  app.get("/api/projects/:id/fmea.xlsx", wrap(async (req, res) => {
    const id = pid(req);
    const a = await ready(id);
    const p = await store.readProject(id.split("@")[0]);
    const buf = await fmeaWorkbook(p.name, a);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(id)}-fmea.xlsx"`);
    res.send(buf);
  }));
};
