// 工作包 C＋D：模型頁的層級圖資料（web/src/pages/model/views.ts、layout.ts）。全部是合成資料，不啟動伺服器。
// 檢查：一層一張圖、元素歸到對的圖、狀態標籤、風險回頭修正的橘線、介面兩端不一致標紅、模型地圖的統計、TPM 只取專案啟用的節點。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../web/src/pages/model/views.ts";
import { specArch, specL1, specL2, specMap } from "../web/src/pages/model/layout.ts";

let n = 0;
type Raw = { kind: string; category?: string | null; name: string; sn?: string; pkg: string; owner?: string; attrs?: Record<string, string>; tags?: string[]; typeIds?: string[]; doc?: string };
const els: any[] = [], rels: any[] = [];
const el = (r: Raw) => {
  const id = `e${++n}`;
  els.push({ id, kind: r.kind, category: r.category ?? null, name: r.name, shortName: r.sn ?? null, qualifiedName: `${r.pkg}::${r.name}`, owner: r.owner ?? r.pkg, doc: r.doc ?? "",
    types: [], typeIds: r.typeIds ?? [], file: "model.sysml", shared: false, attrs: { why: "合成", judge: "合成", ...(r.attrs ?? {}) }, tags: r.tags ?? [], line: null });
  return id;
};
const rel = (kind: string, from: string, to: string, form?: string) => rels.push({ kind, from, to, line: null, ...(form ? { form } : {}) });

// 結構：系統 S（次系統 A、B）；A 底下元件 C（C 底下元件 D）
const S = el({ kind: "PartDefinition", category: "System", name: "合成系統", sn: "SYS", pkg: "Project::Sys", attrs: { mass: "7 [kg]", massBudget: "8 [kg]" } });
const A = el({ kind: "PartDefinition", category: "Subsystem", name: "次甲", sn: "SUB-A", pkg: "Project::Sys", attrs: { mass: "3 [kg]", massBudget: "3.5 [kg]" } });
const B = el({ kind: "PartDefinition", category: "Subsystem", name: "次乙", sn: "SUB-B", pkg: "Project::Sys", attrs: { mass: "2 [kg]", massBudget: "2.5 [kg]" } });
const C = el({ kind: "PartDefinition", category: "Component", name: "元丙", sn: "CMP-C", pkg: "SubA", attrs: { mass: "1.2 [kg]", massBudget: "1 [kg]" } });
const D = el({ kind: "PartDefinition", category: "Component", name: "元丁", sn: "CMP-D", pkg: "SubA", attrs: { mass: "0.5 [kg]" } });
el({ kind: "PartUsage", name: "次甲", pkg: "x", owner: S, typeIds: [A] });
el({ kind: "PartUsage", name: "次乙", pkg: "x", owner: S, typeIds: [B] });
el({ kind: "PartUsage", name: "元丙", pkg: "x", owner: A, typeIds: [C] });
el({ kind: "PartUsage", name: "元丁", pkg: "x", owner: C, typeIds: [D] });
// 需求：各層一條，滿足者決定在哪張圖
const MR = el({ kind: "RequirementUsage", category: "MissionRequirement", name: "任務需求", sn: "MR-1", pkg: "Project::M" });
const SR = el({ kind: "RequirementUsage", category: "SystemRequirement", name: "系統需求", sn: "SR-1", pkg: "Project::Sys", attrs: { verifyStatus: "pend" } });
const SSR = el({ kind: "RequirementUsage", category: "SubsystemRequirement", name: "次系統需求", sn: "SSR-1", pkg: "SubA", attrs: { verifyStatus: "ok" } });
const CR = el({ kind: "RequirementUsage", category: "ComponentRequirement", name: "元件需求", sn: "CR-1", pkg: "SubA" });
rel("satisfy", S, SR); rel("satisfy", A, SSR); rel("satisfy", D, CR); rel("derive", SR, MR); rel("derive", SSR, SR);
// 次甲的迴圈：方案（兩個候選）、準則、分數、決策（喊卡）、風險回頭修正
const ALT = el({ kind: "PartDefinition", category: "DesignAlternative", name: "甲方案", sn: "ALT-A", pkg: "SubA", attrs: { layer: "subsystem" } });
const V1 = el({ kind: "PartUsage", name: "甲一", pkg: "x", owner: ALT, attrs: { score_K_1: "4.0", adjusted_K_1: "5.0" } });
el({ kind: "PartUsage", name: "甲二", pkg: "x", owner: ALT, attrs: { score_K_1: "3.0", rejectWhy: "合成否決" } });
const K = el({ kind: "RequirementUsage", category: "MOP", name: "準則", sn: "K-1", pkg: "SubA", attrs: { weight: "2.0" } });
rel("trace", ALT, K); rel("trace", ALT, SSR);
const DEC = el({ kind: "ItemUsage", category: "DesignDecision", name: "甲決策", sn: "DD-A", pkg: "SubA", attrs: { layer: "subsystem", releaseStatus: "hold", holdReason: "合成：待測" } });
rel("trace", DEC, ALT); rel("trace", DEC, V1);
const R1 = el({ kind: "ItemUsage", category: "Risk", name: "甲風險", sn: "R-A", pkg: "SubA", attrs: { layer: "subsystem", likelihood: "3", severity: "4", residualLikelihood: "1", residualSeverity: "4", fixNote: "改了元丙" } });
rel("fix", R1, ALT);
// 系統層介面：兩端由連接埠短名 IF-1-A／IF-1-B 推出，參數不一致
const IF1 = el({ kind: "InterfaceUsage", category: "Interface", name: "合成介面", sn: "IF-1", pkg: "x", owner: S, attrs: { kind: "資料", param1: "頻寬", param1A: "40", param1B: "30", param1Ok: "false" } });
el({ kind: "PortUsage", name: "IF-1", sn: "IF-1-A", pkg: "x", owner: A });
el({ kind: "PortUsage", name: "IF-1", sn: "IF-1-B", pkg: "x", owner: B });
// 掛在系統層介面上、但屬於次甲的風險：同層找不到鄰居時，回到同套件的次甲
const R2 = el({ kind: "ItemUsage", category: "Risk", name: "介面風險", sn: "R-B", pkg: "SubA", attrs: { layer: "subsystem", likelihood: "2", severity: "2" } });
rel("trace", R2, IF1);
// TPM：專案只啟用提案與 PDR，CDR 的值不顯示
const T = el({ kind: "AttributeUsage", name: "質量", sn: "TPM-1", pkg: "x", owner: A, tags: ["TPM"], attrs: { target: "≤ 3.5 kg", atProposal: "3.4", atPDR: "3.1", atCDR: "3.0" } });

const view: any = { project: { gates: ["proposal", "pdr"] }, analysis: { elements: els, relations: rels, satisfaction: [], diagnostics: [], ok: true } };
const M = buildModel(view);
const key = (id: string) => `p:${id}`;

test("一層一張圖：任務定義、任務剖面、系統、次系統、有組成零件的元件", () => {
  assert.deepEqual(M.views.map((v) => v.k).slice(0, 3), ["L1", "L2", key(S)]);
  assert.deepEqual(M.views.map((v) => v.k).slice(3).sort(), [key(A), key(B), key(C)].sort());
  assert.equal(M.V.get(key(C))!.layer, 5);
  assert.equal(M.V.get(key(C))!.parent, key(A), "元件圖的上一層是次系統圖");
  assert.equal(M.V.get(key(S))!.parent, "L2");
});

test("元素歸到對的圖：需求看滿足者、方案與決策順著關係、TPM 與介面看所在定義", () => {
  assert.equal(M.viewOf.get(MR), "L1");
  assert.equal(M.viewOf.get(SR), key(S));
  assert.equal(M.viewOf.get(SSR), key(A));
  assert.equal(M.viewOf.get(CR), key(C), "元件需求由更下層的元丁滿足，歸到元丙的圖");
  for (const x of [ALT, DEC, R1, `trade:${ALT}`, T]) assert.equal(M.viewOf.get(x), key(A), M.U.get(x)?.sn ?? x);
  assert.equal(M.viewOf.get(IF1), key(S));
  assert.equal(M.viewOf.get(R2), key(A), "系統層介面上的次系統風險回到同套件的次甲");
});

test("方案、比較表、決策：選定的候選、調整分數、喊卡", () => {
  const alt = M.U.get(ALT)!;
  assert.deepEqual(alt.variants.map((v) => [v.name, v.picked, v.rejectWhy]), [["甲一", true, ""], ["甲二", false, "合成否決"]]);
  const trade = M.U.get(`trade:${ALT}`)!;
  // 準則＝連到方案的需求（工具的既有規則）：合成的 MOP 準則，加上方案追溯到的次系統需求（沒有權重時算 1）
  assert.deepEqual(trade.crit.map((c) => [c.name, c.w]), [["準則", 2], ["次系統需求", 1]]);
  assert.equal(M.U.get(DEC)!.gate, "hold");
  assert.equal(M.U.get(DEC)!.chosen, "甲一");
});

test("次系統圖：狀態標籤、回頭修正橘線、計算框帶入模型值", () => {
  const s = specArch(M, key(A));
  const node = (id: string) => s.nodes.find((x) => x.id === id)!;
  assert.deepEqual(node(SSR).badge, ["通過", "ok"]);
  assert.deepEqual(node(DEC).badge, ["喊卡中", "hold"]);
  assert.ok(s.edges.some((e) => e.k === "fb"), "風險回頭修正有橘色虛線");
  assert.ok(s.nodes.some((x) => x.id === "it1" && x.name.includes("R-A")), "回頭修正多一版設計示意");
  const calc = node("calc").lines.join("\n");
  assert.match(calc, /質量 m\(次甲\) = Σ 子零件 ≤ 配額/);
  assert.match(calc, /2×5 \+ 1×0 = 10/, "加權總分用調整後分數");
  assert.match(calc, /3×4 = 12 → 1×4 = 4/);
  assert.equal(s.zones!.length, 3);
  assert.deepEqual(s.zones![0].add, [{ label: "需求", category: "SubsystemRequirement" }]);
});

test("系統圖：介面兩端不一致標紅；TPM 只取專案啟用的節點", () => {
  const s = specArch(M, key(S));
  const e = s.edges.find((x) => x.k === "iface")!;
  assert.equal(e.bad, true);
  assert.match(e.label!, /IF-1 合成介面 ⚠/);
  assert.deepEqual(M.U.get(T)!.vals.map((v) => [v.gate, v.v]), [["proposal", 3.4], ["pdr", 3.1]]);
});

test("模型地圖：一層一列，框上需求數、待驗證數、決策狀態、質量配額", () => {
  const s = specMap(M);
  const sys = s.nodes.find((x) => x.id === `s:${S}`)!;
  assert.ok(sys.lines.includes("需求 1 條（待驗證 1）"));
  assert.ok(sys.lines.some((l) => l.includes("質量 7／配額 8 kg")));
  assert.deepEqual(s.nodes.find((x) => x.id === `b:${A}`)!.badge, ["喊卡中", "hold"]);
  assert.ok(s.nodes.some((x) => x.id === `c:${C}`), "元件列出現元丙");
  assert.ok(s.edges.some((x) => x.f === `s:${S}` && x.t === `b:${A}` && x.k === "comp"));
  assert.equal(specL1(M).nodes.length, 1);
  assert.equal(specL2(M).nodes.filter((x) => x.id === "in").length, 1, "第 2 層有上一層的任務需求框");
});

test("框架：元件層只有有組成零件的元件才當迴圈對象（Mars 2026-11-27）", async () => {
  const { evaluateFramework, loadFramework, defaultSettings } = await import("./framework.ts");
  const f = loadFramework();
  const ev = evaluateFramework(f, { a: view.analysis, settings: defaultSettings(f), docs: 0, approval: { ok: true, detail: "", source: "branches" } });
  const comp = ev.layers.find((l: any) => l.subject === "Component" || l.id === "detailDesign")!;
  assert.deepEqual(comp.objects!.map((o: any) => o.name), ["元丙"], "元丙有組成零件（元丁），元丁沒有，不算");
});

test("喊卡範圍：只列同一棵子樹（所在層與上層鏈）的喊卡決策", async () => {
  const { holdScope } = await import("../web/src/pages/model/views.ts");
  assert.deepEqual(holdScope(M, SSR), [DEC], "次甲的需求看得到次甲的喊卡");
  assert.deepEqual(holdScope(M, CR), [DEC], "元丙（次甲的下層）也看得到");
  assert.deepEqual(holdScope(M, SR), [], "系統層不在次甲之下");
  assert.deepEqual(holdScope(M, B), [], "次乙不在同一棵子樹");
  assert.deepEqual(holdScope(M, C), [DEC], "元丙本身的圖在次甲之下");
});

test("框架：設計方案經由方案比較表（套件）連到本層需求，也算有設計提案（Mars 2026-11-27）", async () => {
  const { evaluateFramework, loadFramework, defaultSettings } = await import("./framework.ts");
  const xs: any[] = [], rs: any[] = [];
  const mk = (kind: string, category: string | null, name: string, owner: string | null = null, typeIds: string[] = []) => { const id = `x${xs.length + 1}`; xs.push({ id, kind, category, name, shortName: name, qualifiedName: `P::${name}`, owner, doc: "", types: [], typeIds, file: "m.sysml", shared: false, attrs: {}, tags: [], line: null }); return id; };
  const sys = mk("PartDefinition", "System", "S"), sub = mk("PartDefinition", "Subsystem", "B");
  mk("PartUsage", null, "b", sys, [sub]);
  const req = mk("RequirementUsage", "SubsystemRequirement", "SSR-B");
  rs.push({ kind: "satisfy", from: sub, to: req });
  const alt = mk("PartDefinition", "DesignAlternative", "ALT-B"); mk("PartUsage", null, "甲", alt); mk("PartUsage", null, "乙", alt);
  const crit = mk("RequirementUsage", "MOP", "TS-B-1");
  rs.push({ kind: "trace", from: alt, to: crit });
  const f = loadFramework();
  const run = () => evaluateFramework(f, { a: { ok: true, diagnostics: [], elements: xs, relations: rs, satisfaction: [] } as any, settings: defaultSettings(f), docs: 0, approval: { ok: true, detail: "", source: "branches" } });
  const proposal = () => run().layers.find((l: any) => l.id === "subsystem")!.objects![0].steps.find((s: any) => s.id === "proposal")!.done;
  assert.equal(proposal(), false, "方案只連到評分準則時，還不算");
  const pkg = mk("Package", null, "TS-B");
  rs.push({ kind: "trace", from: pkg, to: alt }, { kind: "trace", from: pkg, to: req });
  assert.equal(proposal(), true, "比較表套件連到方案與本層需求，算有設計提案");
});
