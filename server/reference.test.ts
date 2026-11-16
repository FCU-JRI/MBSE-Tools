// 參考模型（F-73）：放在 reference/ 的檔案沒有被動過；用它驗收「任何標準模型都看得到全部元素」。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, shutdown } from "./engine.ts";
import { verify } from "./reference.ts";
import type { Manifest } from "./reference.ts";

const DIR = fileURLToPath(new URL("../reference/apollo-11-sysml-v2", import.meta.url));
const manifest = JSON.parse(await fs.readFile(`${DIR}.manifest.json`, "utf8")) as Manifest;
const at = (dir: string) => (rel: string) => path.join(dir, ...rel.split("/"));
const models = Object.keys(manifest.files).filter((f) => f.endsWith(".sysml")).sort();
after(() => shutdown());

test("參考模型的檔案和清單逐一相同，沒有多也沒有少；授權檔與版權聲明都在", async () => {
  assert.deepEqual(await verify(manifest, at(DIR), DIR), []);
  assert.equal(models.length, 28);
  assert.equal(manifest.commit, "0e8a7d6790cfa7e15b991eb745e9a38f9bed0474");
  assert.match(await fs.readFile(path.join(DIR, "LICENSE.md"), "utf8"), /Mozilla Public License Version 2\.0/);
  for (const f of models) assert.match(await fs.readFile(at(DIR)(f), "utf8"), /Copyright \(c\) 2026 AIRBUS[\s\S]{0,200}Mozilla Public/, `${f} 開頭的版權聲明`);
});

test("清單核對：內容被改、檔案不見、多出檔案都查得出來", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jri-ref-"));
  try {
    await fs.cp(DIR, tmp, { recursive: true });
    assert.deepEqual(await verify(manifest, at(tmp), tmp), []);
    await fs.appendFile(at(tmp)("CoSMA/CoSMAPackage.sysml"), "\n");
    await fs.rm(at(tmp)("Apollo11Model.sysml"));
    await fs.writeFile(path.join(tmp, "Purpose", "extra.sysml"), "package Extra { }\n", "utf8");
    assert.deepEqual((await verify(manifest, at(tmp), tmp)).sort(), ["內容不同 CoSMA/CoSMAPackage.sysml", "清單上沒有 Purpose/extra.sysml", "缺少 Apollo11Model.sysml"].sort());
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test("驗收：Apollo 11 模型 28 個檔案解析沒有錯誤，2,188 個具名元素與 330 個沒有名字的使用都列得出來，樹接得起來", async () => {
  const a = await analyze(await Promise.all(models.map(async (f) => [f, await fs.readFile(at(DIR)(f), "utf8")] as const)));
  assert.equal(a.ok, true);
  assert.equal(a.diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.equal(a.elements.length, 2188);
  assert.equal(a.unnamed.length, 330);
  assert.equal(new Set(a.elements.map((e) => e.file)).size, 28, "每個檔案都有元素");
  const count = (kind: string) => a.elements.filter((e) => e.kind === kind).length;
  assert.deepEqual(["RequirementDefinition", "RequirementUsage", "PartDefinition", "ActionDefinition", "StateDefinition", "PortDefinition", "InterfaceDefinition", "Package", "LibraryPackage"].map(count), [296, 294, 194, 110, 16, 8, 8, 25, 3]);

  // 樹：28 個最上層套件；每個元素恰好一個上層，往上都走得到最上層；沒有重複的識別碼
  const all = [...a.elements, ...a.unnamed];
  const byId = new Map(all.map((e) => [e.id, e]));
  assert.equal(byId.size, all.length, "識別碼不重複");
  const roots = all.filter((e) => e.parent === null);
  assert.equal(roots.length, 28);
  assert.equal(roots.every((e) => e.kind.endsWith("Package")), true);
  for (const e of all) {
    let cur = e, steps = 0;
    while (cur.parent) { const up = byId.get(cur.parent); assert.ok(up, `${e.qualifiedName} 的上層不在清單裡`); cur = up; assert.ok(++steps < 50, "上層不能繞圈"); }
  }
  // 每個元素都有關鍵字；通用關係抽得出來
  assert.equal(all.every((e) => !!e.keyword), true);
  const links = (kind: string) => a.links.filter((l) => l.kind === kind).length;
  assert.deepEqual(["specialize", "perform"].map(links), [354, 104]);
  assert.equal(a.links.filter((l) => l.kind === "specialize" && l.to).length, 348, "兩端都在專案內的特化");
});

// ───────── 階段 4（A-8）：Apollo 的圖的驗收（F-76 到 F-81）─────────
test("驗收：Apollo 每一層都有對應的圖，每張圖都建得出來，每個具名元素至少在一張圖上", async () => {
  const { buildGraph, diagramsOf, NODE_LIMIT } = await import("../web/src/model.ts");
  const a = (await analyze(await Promise.all(models.map(async (f) => [f, await fs.readFile(at(DIR)(f), "utf8")] as const)))) as any;
  const defs = diagramsOf(a);
  const count = (kind: string) => defs.filter((d) => d.kind === kind).length;
  assert.deepEqual(Object.fromEntries(["pkg", "decomp", "fdecomp", "req", "uc", "stm", "act", "ibd", "occ", "calc"].map((k) => [k, count(k)])),
    { pkg: 29, decomp: 21, fdecomp: 18, req: 11, uc: 1, stm: 1, act: 31, ibd: 21, occ: 43, calc: 23 });
  const byId = new Map<string, any>(a.elements.map((e: any) => [e.id, e]));
  const graphs = new Map(defs.map((d) => [d.id, buildGraph(d, a)]));
  // 每張圖都建得出來、不超過上限；每個具名元素至少在一張圖上（節點，或某個節點隔間裡的一列）
  const seen = new Set<string>();
  for (const [id, g] of graphs) {
    assert.ok(g.nodes.length <= NODE_LIMIT + 1, `${id} 的節點數 ${g.nodes.length}`);
    for (const n of g.nodes) { seen.add(n.id); for (const c of n.covers ?? []) seen.add(c); }
  }
  assert.deepEqual(a.elements.filter((e: any) => !seen.has(e.id)).map((e: any) => e.qualifiedName), [], "每個具名元素都在圖上");

  // 每一層（最上層的資料夾）有哪幾類圖
  const layer = (d: { context: string | null }) => (d.context ? String(byId.get(d.context)?.file ?? "").split("/")[0] : "");
  const kinds = (l: string) => [...new Set(defs.filter((d) => layer(d) === l).map((d) => d.kind))].sort();
  assert.deepEqual(kinds("Requirements"), ["pkg", "req"]);
  for (const p of a.elements.filter((e: any) => e.kind === "Package" && e.file.startsWith("Requirements/"))) assert.ok(graphs.has(`req:${p.qualifiedName}`), `${p.name} 有需求圖`);
  assert.deepEqual(kinds("Purpose"), ["act", "decomp", "ibd", "pkg", "req", "stm"]);
  assert.deepEqual(kinds("Function"), ["act", "fdecomp", "pkg", "req"]);
  assert.deepEqual(kinds("Technical"), ["decomp", "ibd", "pkg", "req"]);
  assert.deepEqual(kinds("Execution"), ["occ", "pkg"]);
  assert.deepEqual(kinds("Analysis"), ["calc", "pkg"]);
  for (const l of ["Logical", "Operation", "Program", "CoSMA", "Apollo11Model.sysml"]) assert.ok(kinds(l).includes("pkg"), `${l} 有套件內容圖`);

  // 需求（F-77）：技術需求的套件圖上有 doc 隔間與滿足、細化的線
  const tr = graphs.get("req:TechnicalRequirementsPackage")!;
  assert.ok(tr.nodes.some((n) => n.compartments[0]?.[0] === "doc"));
  // 滿足（272 條，需求之間）與細化（需求定義之間，虛線）都畫在需求圖上
  const reqEdges = [...graphs].filter(([id]) => id === "req" || id.startsWith("req:")).flatMap(([, g]) => g.edges);
  assert.ok(reqEdges.some((e) => e.kind === "satisfy" && e.label === "«satisfy»") && reqEdges.some((e) => e.kind === "refine" && e.dashed));
  // 狀態機（F-78）：15 個狀態、14 條轉換，13 條有觸發條件
  const stm = graphs.get("stm:MissionPackage::Apollo11Mission::apollo11Phases")!;
  assert.deepEqual([stm.nodes.length, stm.edges.length, stm.edges.filter((e) => e.label).length], [15, 14, 13]);
  const name = (g: typeof stm, id: string) => g.nodes.find((n) => n.id === id)?.name;
  assert.equal(stm.edges.find((e) => name(stm, e.source) === "preparation" && name(stm, e.target) === "launch")?.label, "PreparationPhaseCompletedNotification");
  // 動作（F-79）：任務階段的作業有先後（28 條）；功能的參數畫成小方塊；邏輯元件的 perform 列在 perform actions 隔間
  const acts = [...graphs].filter(([id]) => id.startsWith("act:"));
  assert.equal(acts.filter(([d]) => layer(defs.find((x) => x.id === d)!) === "Purpose").flatMap(([, g]) => g.edges).filter((e) => e.kind === "succession").length, 28);
  assert.ok(graphs.get("act:FunctionsPackage::TraverseToEarth")!.nodes.some((n) => n.shape === "param" && n.keyword === "«in»"));
  assert.ok(graphs.get("pkg:LogicalComponentsPackage")!.nodes.some((n) => n.compartments.some((c) => c[0] === "perform actions")));
  // 互連（F-80）：10 條介面（9 條有名字、1 條沒有）都畫出來，標「名稱 : 型別」或「: 型別」
  const ibd = [...graphs].filter(([id]) => id.startsWith("ibd:")).flatMap(([, g]) => g.edges);
  assert.equal(ibd.filter((e) => /(^| ): \S/.test(e.label)).length, 10);
  const lv = graphs.get("ibd:SystemPackage::Apollo11MissionSystem")!.edges.find((e) => e.label === "lvToPayload : LVPayloadInterface");
  assert.deepEqual([lv && name(graphs.get("ibd:SystemPackage::Apollo11MissionSystem")!, lv.source), lv && name(graphs.get("ibd:SystemPackage::Apollo11MissionSystem")!, lv.target)], ["launchVehicle", "spacecraft"]);
  // 個體與時間切片（F-81）：14 個時間切片依 then 串起來
  const occ = graphs.get("occ:Apollo11MissionExecutionPackage::apollo11MissionIndividual")!;
  assert.deepEqual([occ.nodes.length, occ.nodes.every((n) => n.keyword === "«timeslice»"), occ.edges.filter((e) => e.kind === "succession").length], [14, true, 13]);
  // 計算與分析（F-81）：分析定義列出 subject 與參數
  const power = graphs.get("calc:AnalysisPackage::SystemPowerAnalysis")!;
  assert.deepEqual(power.nodes[0].compartments.filter((c) => c[0] === "subject" || c[0] === "parameters").map((c) => c[0]), ["subject", "parameters"]);
});
