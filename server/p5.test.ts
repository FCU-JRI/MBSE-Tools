// P5：FMEA、風險與圖表的測試（docs/IMPL-PLAN.md）。模型是合成的（fixtures/p5-fmea.sysml）。埠 18851／18852。
// 執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { analyze, shutdown } from "./engine.ts";
import { bySubsystem, fmeaRows, p5Issues, riskRows, sortRows, stageOf, threatenedRequirements } from "../web/src/method/p5/core.ts";
import type { FmeaRow } from "../web/src/method/p5/core.ts";

const read = (rel: string) => fs.readFile(new URL(rel, import.meta.url), "utf8");
const lib = await read("../library/JRI.sysml");
const fixture = await read("./fixtures/p5-fmea.sysml");
const model = async (src = fixture) => {
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", src]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.filter((d) => d.severity === "error")).slice(0, 300));
  return a;
};
const rowOf = (rows: FmeaRow[], fn: string) => rows.find((r) => r.fn.name.endsWith(fn)) as FmeaRow;

// ───────── 模型與計算 ─────────

test("既有的範本與合成模型加上 P5 的定義後照樣解析，Risk 的既有欄位不變", async () => {
  for (const f of ["../templates/sounding-rocket/model.sysml", "../templates/blank/model.sysml", "./fixtures/jri-extra.sysml"]) {
    const a = await analyze([["JRI.sysml", lib], ["model.sysml", await read(f)]]);
    assert.equal(a.ok, true, f);
  }
  const a = await model(await read("../templates/sounding-rocket/model.sysml"));
  const r = a.elements.find((e) => e.category === "Risk");
  assert.deepEqual([r?.attrs.severity, r?.attrs.likelihood], ["5", "2"]);
});

test("FMEA 的列由「次系統 × 功能」的分配產生，沒填的是骨架列", async () => {
  const rows = fmeaRows(await model());
  assert.equal(rows.length, 3, "三個分配各一列");
  const skeleton = rows.filter((r) => !r.fm);
  assert.equal(skeleton.length, 1);
  assert.match(skeleton[0].fn.name, /功能三/);
  assert.match(skeleton[0].subsystem.name, /次系統丙/, "分配到零件時顯示它的定義");
  assert.match(rowOf(rows, "功能一").fm?.name ?? "", /失效一/, "失效模式用 #trace 對上分配（連到定義也對得上零件）");
});

test("嚴重度建議值：依功能追到的目的與安全需求；人填的值優先，建議值與依據保留", async () => {
  const rows = fmeaRows(await model());
  const r1 = rowOf(rows, "功能一");
  assert.equal(r1.sSuggest.value, 3, "追到 1／2 個目的，預期還能完成 50%");
  assert.match(r1.sSuggest.basis, /1／2/);
  assert.equal(r1.sHuman, 9);
  assert.equal(r1.s, 9, "以人填的為準");
  const r2 = rowOf(rows, "功能二");
  assert.equal(r2.sHuman, null);
  assert.equal(r2.sSuggest.value, 9, "安全需求、有飛行中遙測可以預警");
  assert.equal(r2.s, 9);
  const r3 = rowOf(rows, "功能三");
  assert.equal(r3.sSuggest.value, 3, "經由 MOE 細化追到目的乙");
});

test("難檢度建議值：依驗證矩陣有沒有地面測試、飛試前檢查、遙測", async () => {
  const rows = fmeaRows(await model());
  assert.equal(rowOf(rows, "功能一").dSuggest.value, 4, "子需求有地面測試");
  assert.match(rowOf(rows, "功能一").dSuggest.basis, /地面測試/);
  assert.equal(rowOf(rows, "功能二").dSuggest.value, 7, "只有飛行中遙測");
  assert.equal(rowOf(rows, "功能三").dSuggest.value, 10, "沒有任何驗證");
  const ev = (name: string, doc = "", kind = "") => ({ id: "x", kind: "VerificationUsage", category: "VerificationEvent", name, shortName: null, qualifiedName: "", owner: null, doc, types: [], typeIds: [], attrs: { kind } });
  assert.equal(stageOf(ev("發射前 Go/No-Go 檢查")), "preflight");
  assert.equal(stageOf(ev("靜態點火", "", "VerificationMethodKind::test")), "ground");
  assert.equal(stageOf(ev("目視", "", "VerificationMethodKind::inspect")), "preflight");
  assert.equal(stageOf(ev("計算", "", "VerificationMethodKind::analyze")), null);
});

test("RPN = O × S × D；S ≥ 8 沒有矯正措施被標出；先排 S 再排 RPN", async () => {
  const a = await model();
  const rows = fmeaRows(a);
  const [first, second] = rows;
  assert.match(first.fm?.name ?? "", /失效二/, "S 同為 9，RPN 126 排在 108 前面");
  assert.equal(first.rpn, 2 * 9 * 7);
  assert.equal(second.rpn, 3 * 9 * 4);
  assert.equal(second.missingAction, true, "S = 9 沒寫矯正措施");
  assert.equal(first.missingAction, false);
  assert.equal(first.rpnAfter, 1 * 6 * 5);
  assert.equal(first.done, true);
  assert.ok(p5Issues(a).some((i) => /失效一.*一定要有矯正措施/.test(i.text)));
  // 排序規則本身
  const mk = (s: number, rpn: number, total: number) => ({ ...first, key: `${s}-${rpn}-${total}`, s, rpn, impact: { ...first.impact, total } });
  assert.deepEqual(sortRows([mk(7, 500, 0), mk(9, 10, 0), mk(9, 10, 5), mk(9, 90, 0)]).map((r) => r.key), ["9-90-0", "9-10-5", "9-10-0", "7-500-0"]);
});

test("影響範圍是獨立一欄：往下游數需求、介面、元件", async () => {
  const r1 = rowOf(fmeaRows(await model()), "功能一");
  assert.equal(r1.impact.requirements.length, 2, "需求甲與衍生的子需求甲");
  assert.equal(r1.impact.interfaces, 1, "p 到 q 的連結");
  assert.deepEqual(r1.impact.components, ["CMP-801 元件戊"]);
  assert.equal(r1.impact.total, 4);
});

test("風險：可能性 × 後果 1–5；威脅的需求、掛的層級、來源、緩解的需求與驗證", async () => {
  const a = await model();
  const [r1, r2] = riskRows(a);
  assert.equal(r1.risk.name, "風險一");
  assert.deepEqual([r1.likelihood, r1.consequence, r1.score, r1.level], [4, 4, 16, "high"]);
  assert.deepEqual([r1.residualLikelihood, r1.residualConsequence], [2, null]);
  assert.deepEqual(r1.threatens.map((e) => e.name), ["需求甲"]);
  assert.deepEqual(r1.attachedTo.map((e) => e.name), ["次系統丙"]);
  assert.deepEqual(r1.sources.map((e) => e.name), ["失效一"]);
  assert.deepEqual(r1.mitigationRequirements.map((e) => e.name), ["需求乙"], "緩解產生的需求以風險為來源");
  assert.deepEqual(r1.mitigationVerifications.map((e) => e.name), ["地面測試甲"], "緩解也可以是追加的驗證");
  assert.equal(r1.impact.total, 4, "需求 2、介面 1、元件 1");
  assert.equal(r2.level, "low");
  assert.ok(p5Issues(a).some((i) => /風險二.*威脅的需求/.test(i.text)));
  const t = threatenedRequirements(a);
  assert.equal(t.get(r1.threatens[0].id)?.level, "high", "需求被高風險威脅時查得到");
});

test("五種圖表都有資料：工作表、S × O、可能性 × 後果、嚴重度 × 影響範圍、依次系統彙整", async () => {
  const a = await model();
  const rows = fmeaRows(a), risks = riskRows(a);
  assert.ok(rows.some((r) => r.fm), "工作表");
  assert.ok(rows.some((r) => r.o !== null && r.s !== null && r.oAfter !== null), "S × O 熱圖有矯正前後");
  assert.ok(risks.some((r) => r.likelihood !== null && r.consequence !== null), "可能性 × 後果");
  assert.ok(risks.some((r) => r.consequence !== null && r.impact.total > 0), "嚴重度 × 影響範圍");
  const subs = bySubsystem(rows);
  const c = subs.find((s) => /次系統丙/.test(s.name));
  assert.deepEqual([c?.modes, c?.skeleton, c?.maxS, c?.missingActions, c?.openActions], [1, 1, 9, 1, 1]);
  assert.match(subs[0].name, /次系統/);
});

after(() => shutdown());

// ───────── 伺服器路由與匯出 ─────────

const PORT = 18851, PUB = 18852;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any; buf: ArrayBuffer | null }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  if ((r.headers.get("content-type") ?? "").includes("spreadsheet")) return { status: r.status, data: null, buf: await r.arrayBuffer() };
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data, buf: null };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p5-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/bin/false" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("路由：讀 FMEA、在骨架列建立失效模式、由風險產生緩解、匯出比賽格式", async () => {
  const base = `${I}/api/projects/p5`;
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "p5", name: "P5 合成專案", kind: "annual" })).status, 200);
  const put = await call(`${base}/files/model.sysml`, "PUT", { content: fixture, message: "合成模型" });
  assert.equal(put.status, 200, JSON.stringify(put.data).slice(0, 300));

  let s = await call(`${base}/fmea`);
  assert.equal(s.status, 200);
  assert.equal(s.data.rows.length, 3);
  assert.equal(s.data.scales.s.length, 10);
  const skeleton = s.data.rows.find((r: any) => !r.fm);

  // 骨架列 → 失效模式（連同兩條 #trace）
  let r = await call(`${base}/fmea/rows`, "POST", { function: skeleton.fn.id, subsystem: skeleton.subsystem.id, name: "失效三", attrs: { occurrenceRating: "4" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  s = await call(`${base}/fmea`);
  assert.equal(s.data.rows.length, 3, "骨架列被填上，不會多一列");
  const filled = s.data.rows.find((x: any) => x.fm?.name === "失效三");
  assert.ok(filled, "新的失效模式對上原本的分配");
  assert.equal(filled.o, 4);
  assert.equal(filled.s, 3, "沒填 S 時用建議值");

  // 人改 S：以人填的為準；清空後回到建議值
  r = await call(`${base}/elements`, "PATCH", { id: filled.fm.id, attrs: { severity: "8" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  s = await call(`${base}/fmea`);
  let row = s.data.rows.find((x: any) => x.fm?.name === "失效三");
  assert.deepEqual([row.s, row.sHuman, row.sSuggest.value, row.missingAction], [8, 8, 3, true]);
  await call(`${base}/elements`, "PATCH", { id: row.fm.id, attrs: { severity: "" } });
  row = (await call(`${base}/fmea`)).data.rows.find((x: any) => x.fm?.name === "失效三");
  assert.deepEqual([row.s, row.sHuman], [3, null]);

  // 由風險產生緩解的需求與追加的驗證：新元素追溯到風險
  const risk = s.data.risks.find((x: any) => x.risk.name === "風險二");
  r = await call(`${base}/risks/mitigation`, "POST", { risk: risk.risk.id, category: "SubsystemRequirement", name: "合成的緩解需求" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  r = await call(`${base}/risks/mitigation`, "POST", { risk: risk.risk.id, category: "VerificationEvent", name: "合成的追加測試", method: "test" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const r2 = (await call(`${base}/fmea`)).data.risks.find((x: any) => x.risk.name === "風險二");
  assert.deepEqual(r2.mitigationRequirements.map((e: any) => e.name), ["合成的緩解需求"]);
  assert.deepEqual(r2.mitigationVerifications.map((e: any) => e.name), ["合成的追加測試"]);
  assert.equal((await call(`${base}/risks/mitigation`, "POST", { risk: risk.risk.id, category: "Stakeholder", name: "x" })).status, 400, "緩解只能是需求或驗證");

  // 匯出：主表的標題與兩列表頭照附件 12 的格式
  const x = await call(`${base}/fmea.xlsx`);
  assert.equal(x.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(x.buf as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["失效模式效應分析表", "建議值與影響範圍", "風險指數評估參考定義", "風險登記"]);
  const ws = wb.getWorksheet("失效模式效應分析表")!;
  const text = (r: number) => Array.from({ length: 17 }, (_, i) => String(ws.getRow(r).getCell(i + 1).value ?? ""));
  assert.match(text(1)[0], /失效模式效應分析 \(Failure Mode and Effects Analysis, FMEA\)/);
  // 合併的儲存格讀回來每格都是同一個值
  assert.deepEqual([...new Set(text(2))], ["次系統", "功能", "潛在失效模式", "失效影響", "失效因素", "現狀控制", "矯正前", "建議矯正措施/狀態", "負責人/日期", "矯正結果"]);
  assert.deepEqual(text(3).slice(6, 10), ["發生度 (O)", "嚴重度 (S)", "難檢度 (D)", "風險優先數 (RPN)"]);
  assert.deepEqual(text(3).slice(12), ["完成校正", "發生度 (O)", "嚴重度 (S)", "難檢度 (D)", "風險優先數 (RPN)"]);
  const merges = (ws.model as { merges: string[] }).merges;
  for (const m of ["A1:Q1", "G2:J2", "M2:Q2", "A2:A3", "K2:K3", "L2:L3"]) assert.ok(merges.includes(m), `合併 ${m}`);
  // 資料列：三個失效模式，RPN = O × S × D
  const data = [4, 5, 6].map(text);
  assert.ok(data.every((d) => d[2]), "三列都有失效模式");
  for (const d of data) if (d[6] && d[7] && d[8]) assert.equal(Number(d[9]), Number(d[6]) * Number(d[7]) * Number(d[8]));
  assert.ok(data.some((d) => d[12] === "√"), "完成校正打勾");
  const scales = wb.getWorksheet("風險指數評估參考定義")!;
  let values = 0;
  scales.eachRow((r) => { if (typeof r.getCell(4).value === "number") values++; });
  assert.equal(values, 30, "三張尺度表各 10 級");
});
