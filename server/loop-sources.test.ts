// 工作包 E：迴圈旁的設計示意讀版本紀錄、計算框讀計算引擎與專案的 FMEA 門檻。合成資料。
import { test } from "node:test";
import assert from "node:assert/strict";
import { defKeys, parseLog } from "./iterations.ts";
import { buildModel } from "../web/src/pages/model/views.ts";
import { calcRows, specArch } from "../web/src/pages/model/layout.ts";
import type { Live } from "../web/src/pages/model/layout.ts";

test("版本紀錄：每次提交改到哪些零件定義、寫入的 CAD 版本", () => {
  assert.deepEqual(defKeys("    part def <'af-wing'> '主翼' :> Component {"), ["af-wing", "主翼"]);
  assert.deepEqual(defKeys("part def Plain :> System;"), ["Plain"]);
  const log = [
    "@@@aaa1111\t2027-01-01T10:00:00+08:00\t甲\t加主翼配額",
    "diff --git a/model/a.sysml b/model/a.sysml",
    "--- a/model/a.sysml", "+++ b/model/a.sysml",
    "@@ -10,3 +10,3 @@     part def <'af-wing'> '主翼' :> Component {",
    "-        attribute massBudget : MassValue = 1.1 [kg];",
    "+        attribute massBudget : MassValue = 1.15 [kg];",
    "+        @CadLink { cadUrl = \"https://cad.example/wing.png\"; cadVersion = \"v3\"; }",
    "@@@bbb2222\t2027-01-02T10:00:00+08:00\t乙\t新增元件",
    "@@ -40,0 +41,3 @@ package X {",
    "+    part def <'af-new'> '新件' :> Component {",
    "+        attribute mass : MassValue = 0.1 [kg];",
    "+    }",
    "@@@ccc3333\t2027-01-03T10:00:00+08:00\t丙\t只改套件層級的關係",
    "@@ -1,1 +1,1 @@ package X {",
    "-    #trace dependency from a to b;",
    "+    #trace dependency from a to c;",
  ].join("\n");
  const it = parseLog(log);
  assert.deepEqual(it.map((x) => [x.commit, x.touched]), [["aaa1111", ["af-wing", "主翼"]], ["bbb2222", ["af-new", "新件"]], ["ccc3333", []]]);
  assert.deepEqual(it[0].cad, [{ part: "af-wing", url: "https://cad.example/wing.png", version: "v3" }]);
  assert.deepEqual(it.map((x) => x.marked), [false, false, false]);
  assert.equal(parseLog("@@@ddd4444\t2027-01-04T10:00:00+08:00\t丁\t設計：主翼改兩段")[0].marked, true, "「設計：」開頭是設計標記");
  assert.equal(parseLog("@@@eee5555\t2027-01-04T10:00:00+08:00\t丁\t設計:半形冒號也可以")[0].marked, true);
});

// 合成模型：次系統 A（兩個元件）、一個方案、一個風險、一條需求
let n = 0;
const els: any[] = [], rels: any[] = [];
const el = (kind: string, category: string | null, name: string, sn: string | null, owner: string | null, attrs: Record<string, string> = {}, typeIds: string[] = []) => {
  const id = `e${++n}`;
  els.push({ id, kind, category, name, shortName: sn, qualifiedName: `P::${name}`, owner, doc: "", types: [], typeIds, file: "m.sysml", shared: false, attrs: { why: "w", judge: "j", ...attrs }, tags: [], line: null });
  return id;
};
const S = el("PartDefinition", "System", "系統", "SYS", null);
const A = el("PartDefinition", "Subsystem", "次甲", "SUB-A", null, { massBudget: "3 [kg]", cadUrl: "https://cad.example/a.step", cadVersion: "v7" });
const C1 = el("PartDefinition", "Component", "元一", "c1", null, { mass: "1 [kg]" });
const C2 = el("PartDefinition", "Component", "元二", "c2", null, { mass: "1.5 [kg]" });
el("PartUsage", null, "次甲", null, S, {}, [A]); el("PartUsage", null, "元一", null, A, {}, [C1]); el("PartUsage", null, "元二", null, A, {}, [C2]);
const R = el("RequirementUsage", "SubsystemRequirement", "次甲質量", "SSR-1", null);
rels.push({ kind: "satisfy", from: A, to: R });
const ALT = el("PartDefinition", "DesignAlternative", "甲方案", "ALT-A", null, { layer: "subsystem" });
el("PartUsage", null, "候選", null, ALT);
rels.push({ kind: "trace", from: ALT, to: R });
const RISK = el("ItemUsage", "Risk", "甲風險", "R-1", null, { layer: "subsystem", likelihood: "2", severity: "3", residualLikelihood: "1", residualSeverity: "5", fixNote: "改了元二" });
rels.push({ kind: "fix", from: RISK, to: C2 });
const M = buildModel({ project: { gates: ["proposal", "pdr"] }, analysis: { elements: els, relations: rels, satisfaction: [], diagnostics: [], ok: true } } as any);
const live: Live = {
  budget: [{ element: "P::inst::次甲", name: "次甲", limitKg: 3, sumKg: 2.5, marginKg: 0.5, status: "PASS", items: [{ name: "元一", massKg: 1 }, { name: "元二", massKg: 1.5 }, { name: "某介面", massKg: null }] }],
  verdicts: [{ qualifiedName: "P::次甲質量", requirement: "SSR-1", condition: "a.mass <= 3 [kg]", status: "holds", terms: [{ attribute: "mass", op: "<=", threshold: "3 [kg]", value: 2.5, unit: "kg", margin: 0.5 }], note: "" }],
  iterations: [
    { commit: "aaa1111", date: "2027-01-01T10:00:00+08:00", author: "甲", message: "設計：加元一", touched: ["c1", "元一"], cad: [], marked: true },
    { commit: "zzz9999", date: "2027-01-01T11:00:00+08:00", author: "甲", message: "設計：別的次系統", touched: ["x-other"], cad: [], marked: true },
    { commit: "ccc3333", date: "2027-01-01T12:00:00+08:00", author: "甲", message: "改元一的屬性值", touched: ["c1"], cad: [], marked: false },
    { commit: "bbb2222", date: "2027-01-02T10:00:00+08:00", author: "乙", message: "R-1 改了元二", touched: ["c2"], cad: [{ part: "SUB-A", url: "https://cad.example/a.png", version: "v6" }], marked: false },
  ],
  fmeaThreshold: 6,
};

test("計算框：質量讀計算引擎、需求判定讀 require constraint、殘餘風險門檻讀專案設定", () => {
  const rows = calcRows(M, M.inView(`p:${A}`), { owner: A, live });
  const t = rows.map((r) => `${r.t} | ${r.s} | ${r.ok}`).join("\n");
  assert.match(t, /質量 Σ m\(子零件\) ≤ m 配額（次甲，計算引擎） \| 1\.00 \+ 1\.50 = 2\.50 kg ≤ 3 kg（餘裕 0\.50） \| true/);
  assert.match(t, /SSR-1 a\.mass <= 3 \[kg\] \| mass = 2\.5 kg（<= 3 \[kg\]，餘裕 0\.5） \| true/);
  assert.match(t, /R-1 風險分數 L×C（殘餘門檻 ≤ 6，專案設定） \| 2×3 = 6 → 1×5 = 5 \| true/, "門檻 6 時殘餘 5 通過（寫死 4 會不通過）");
  const noLive = calcRows(M, M.inView(`p:${A}`), { owner: A }).map((r) => r.t).join("\n");
  assert.match(noLive, /（模型值）/); assert.match(noLive, /殘餘門檻 ≤ 4，預設/);
});

test("設計示意：只算有 CAD 版本變更或「設計：」標記的提交，標出改到的零件，附 CAD", () => {
  const s = specArch(M, `p:${A}`, live);
  const its = s.nodes.filter((x) => /^it\d$/.test(x.id));
  assert.deepEqual(its.map((x) => x.name), ["2027-01-01 aaa1111", "2027-01-02 bbb2222"], "只算有設計標記（且改到本層）或寫入本層 CAD 版本的提交；別的次系統、沒標記的一般修改都不算");
  assert.deepEqual(its[0].blocks!.map((b) => [b.name, b.hi]), [["元一", true], ["元二", false]]);
  assert.deepEqual(its[1].blocks!.map((b) => [b.name, b.hi]), [["元一", false], ["元二", true]]);
  assert.deepEqual(its[1].cad, { url: "https://cad.example/a.step", version: "v7", image: false }, "目前這一版用定義上的 @CadLink");
  assert.ok(its[1].caption!.some((c) => c.includes("CAD v7")));
  // 沒有版本紀錄：退回方塊配置圖（初始提案＋回頭修正）
  const old = specArch(M, `p:${A}`, { ...live, iterations: [] }).nodes.filter((x) => /^it\d$/.test(x.id));
  assert.deepEqual(old.map((x) => x.name), ["初始提案", "R-1 修正後"]);
});

test("satisfy 需求 by 實例.零件：滿足者是鏈上最後一段的零件，require constraint 判定得出來（範例判定式，Mars 2026-11-27）", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { analyze } = await import("./engine.ts");
  const lib = fs.readFileSync(path.join(import.meta.dirname, "..", "library", "JRI.sysml"), "utf8");
  const src = `package Project {
    private import ScalarValues::*; private import ISQ::*; private import SI::*; private import JRI::*;
    part def '合成機' :> System { attribute mtow : MassValue = 7.2 [kg]; part '合成甲' : '合成次甲'; }
    part def '合成次甲' :> Subsystem { attribute mass : MassValue = 3.1 [kg]; attribute endurance : DurationValue; }
    requirement <'R-1'> '起飛重' : SystemRequirement { subject subj : '合成機'; require constraint { subj.mtow <= 8.0 [kg] } }
    requirement <'R-2'> '甲質量' : SubsystemRequirement { subject subj : '合成次甲'; require constraint { subj.mass <= 2.8 [kg] } }
    requirement <'R-3'> '甲航時' : SubsystemRequirement { subject subj : '合成次甲'; require constraint { subj.endurance >= 60.0 [min] } }
    part inst : '合成機';
    satisfy '起飛重' by inst;
    satisfy '甲質量' by inst.'合成甲';
    satisfy '甲航時' by inst.'合成甲';
  }`;
  const a = await analyze([["JRI.sysml", lib], ["model.sysml", src]], []);
  assert.ok(a.ok, JSON.stringify(a.diagnostics.slice(0, 2)));
  const el = (sn: string) => a.elements.find((e: any) => e.shortName === sn)!;
  const from = (sn: string) => a.elements.find((e: any) => e.id === a.relations.find((r: any) => r.kind === "satisfy" && r.to === el(sn).id)?.from);
  assert.equal(from("R-1")?.name, "inst");
  assert.deepEqual([from("R-2")?.kind, from("R-2")?.name], ["PartUsage", "合成甲"], "鏈上最後一段的零件，不是套件");
  const st = (sn: string) => a.satisfaction.find((x: any) => x.requirement === el(sn).qualifiedName)?.status;
  assert.deepEqual([st("R-1"), st("R-2"), st("R-3")], ["holds", "fails", "undecided"], "有值才判定；沒有值的維持未判定");
  // 層級圖的滿足者順著型別對到定義
  const M = buildModel({ project: { gates: ["pdr"] }, analysis: a } as any);
  assert.equal(M.U.get(el("R-2").id)!.sat, a.elements.find((e: any) => e.name === "合成次甲" && e.kind === "PartDefinition")!.id);
});
