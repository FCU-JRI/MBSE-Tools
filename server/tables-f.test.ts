// 工作包 F：Excel 匯出帶出新欄位（評分標準、調整後分數、權重敏感度、否決原因、回頭修正、喊卡、TPM 各啟用節點、為什麼／判定條件、被引用數）。
// 合成資料，直接呼叫 exportWorkbook，不啟動伺服器。
import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { exportWorkbook } from "./export.ts";

let n = 0;
const els: any[] = [], rels: any[] = [];
const el = (kind: string, category: string | null, name: string, sn: string | null, attrs: Record<string, string> = {}, owner: string | null = null, tags: string[] = []) => {
  const id = `e${++n}`;
  els.push({ id, kind, category, name, shortName: sn, qualifiedName: `P::${name}`, owner, doc: "", types: [], typeIds: [], file: "model.sysml", shared: false, attrs, tags, line: null });
  return id;
};
const SYS = el("PartDefinition", "System", "合成系統", "SYS");
const ALT = el("PartDefinition", "DesignAlternative", "合成方案", "ALT-9", { sensitivity: "權重換了排序不變" });
const V1 = el("PartUsage", null, "甲", null, { score_K_9: "4.0", adjusted_K_9: "5.0" }, ALT);
el("PartUsage", null, "乙", null, { score_K_9: "3.0", rejectWhy: "合成否決原因" }, ALT);
const K = el("RequirementUsage", "MOP", "合成準則", "K-9", { weight: "2.0", scale1: "很差", scale5: "很好", why: "為什麼甲", judge: "判定甲" });
const DD = el("ItemUsage", "DesignDecision", "合成決策", "DD-9", { decidedBy: "總工程師", decidedOn: "2027-01-01", releaseStatus: "hold", holdReason: "合成喊卡原因" });
const R = el("ItemUsage", "Risk", "合成風險", "R-9", { severity: "4", likelihood: "3", fixNote: "合成：改了甲" });
el("AttributeUsage", null, "合成質量", "TPM-9", { target: "≤ 8 kg", atProposal: "7.9", atMDR: "7.6", atPDR: "7.2", atCDR: "6.9" }, SYS, ["TPM"]);
rels.push({ kind: "trace", from: ALT, to: K }, { kind: "trace", from: DD, to: V1 }, { kind: "fix", from: R, to: ALT });

test("Excel：新欄位都帶出來", async () => {
  const project: any = { id: "f", name: "F", kind: "small", gates: ["proposal", "pdr"], manual: {}, signoffs: [], createdAt: "" };
  const buf = await exportWorkbook(project, { ok: true, diagnostics: [], elements: els, relations: rels, satisfaction: [] } as any, []);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const rows = (name: string) => { const ws = wb.getWorksheet(name); assert.ok(ws, `有 ${name} 工作表`); const out: string[][] = []; ws!.eachRow((r) => out.push((r.values as any[]).slice(1).map((v) => String(v ?? "")))); return out; };

  const trade = rows("方案比較");
  assert.deepEqual(trade[0], ["方案", "候選", "狀態", "準則", "權重", "評分標準", "分數", "調整後分數", "權重敏感度"]);
  assert.deepEqual(trade[1], ["ALT-9 合成方案", "甲", "選定", "K-9 合成準則", "2", "1＝很差；5＝很好", "4.0", "5.0", "權重換了排序不變"]);
  assert.equal(trade[2][2], "否決");

  assert.deepEqual(rows("候選方案")[2], ["ALT-9 合成方案", "乙", "否決", "合成否決原因"]);
  const dec = rows("決策")[1];
  assert.equal(dec[6], "喊卡中"); assert.equal(dec[7], "合成喊卡原因");

  const fmea = rows("FMEA");
  const h = fmea[0];
  assert.equal(fmea[1][h.indexOf("回頭修正")], "合成：改了甲");
  assert.equal(fmea[1][h.indexOf("修正了")], "ALT-9 合成方案");

  const tpm = rows("TPM");
  assert.deepEqual(tpm[0].slice(0, 6), ["編號", "所屬", "名稱", "門檻", "提案", "PDR"], "只列專案啟用的節點");
  assert.ok(!tpm[0].includes("MDR") && !tpm[0].includes("CDR"));
  assert.deepEqual(tpm[1].slice(4, 8), ["7.9", "7.2", "0.8", "符合"]);

  const all = rows("模型元素總表");
  const k = all.find((r) => r[0] === "K-9")!;
  assert.deepEqual(k.slice(3), ["為什麼甲", "判定甲", "1"]);
});
