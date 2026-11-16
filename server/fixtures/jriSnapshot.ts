// 非 CoSMA 專案的前後比對（第 D 期，F-97）：用 templates/sounding-rocket 算節點檢查、Excel 匯出與每個節點的審查報告。
// jri-baseline.json 是第 C 期（PR #16，dbdb6f4）的程式用這個函式算出來的；cosmaGates.test.ts 用改之後的程式再算一次，兩者要完全相同。
// 改了這個函式就要用第 C 期的程式重新產生 jri-baseline.json，不能拿改之後的程式產生。
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { analyze } from "../engine.ts";
import { evaluateGates, GATES } from "../gates.ts";
import { exportWorkbook } from "../export.ts";
import { buildReport } from "../report.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export async function jriSnapshot(): Promise<unknown> {
  const lib = await fs.readFile(path.join(ROOT, "library", "JRI.sysml"), "utf8");
  const model = await fs.readFile(path.join(ROOT, "templates", "sounding-rocket", "model.sysml"), "utf8");
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", model]], []);
  const project = { id: "sr", name: "合成探空火箭", kind: "annual", template: "sample", createdAt: "2026-01-01T00:00:00.000Z", gates: GATES.map((g) => g.id), manual: { "mdr.vv-plan": true }, signoffs: [] } as any;
  const plan = { tasks: [], costs: [], people: [], docs: [], milestones: {} } as any;
  const gates = evaluateGates(a, project.gates, project.manual, 3);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await exportWorkbook(project, a, gates, plan) as any);
  const sheets: Record<string, unknown[]> = {};
  wb.eachSheet((ws) => { const rows: unknown[] = []; ws.eachRow((r) => rows.push(r.values)); sheets[ws.name] = rows; });
  const reports: Record<string, unknown> = {};
  for (const g of gates) {
    const r = buildReport(project, a, gates, plan, { inputs: {} as any, result: null, bindings: [] }, g.id, "HEAD");
    // 圖只比對內容的雜湊，fixture 才不會太大
    const sections = r.sections.map((x) => ({ ...x, svg: x.svg ? createHash("sha256").update(x.svg).digest("hex") : undefined }));
    reports[g.id] = { ...r, sections, meta: r.meta.filter(([k]) => k !== "產出時間") };
  }
  return JSON.parse(JSON.stringify({ ok: a.ok, elements: a.elements.length, relations: a.relations.length, gates, sheets, reports }));
}
