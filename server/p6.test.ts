// P6 方案比較與模型內公式的測試。資料全部是合成的，不是真實的設計參數。
// 端對端測試用埠 18861（公開埠 18862），見 docs/IMPL-PLAN.md 第 5 節。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyze, shutdown, withModel } from "./engine.ts";
import { evaluateModel, listCalcDefs, parseCalcSource, calcText, isLiteral } from "./method/calc.ts";
import { evaluateTrades, listCriteria } from "../web/src/method/trade.ts";

const LIB = await fs.readFile(new URL("../library/JRI.sysml", import.meta.url), "utf8");

// ───────── 合成模型 ─────────
const TRADE = `package Project {
    private import ScalarValues::*;
    private import JRI::*;
    package Requirements {
        requirement <'REQ-SYS-901'> '起飛推重比' : SystemRequirement;
        requirement <'MOP-901'> '總衝量' : MOP;
    }
    package Structure {
        part def <'SUB-901'> '推進次系統' :> Subsystem;
    }
    package TradeStudies {
        item <'CRIT-901'> '推重比下限' : Criterion { :>> kind = "must"; :>> aspect = "performance"; :>> measure = "TWR >= 5"; }
        item <'CRIT-902'> '性能' : Criterion { :>> kind = "want"; :>> weight = 3.0; :>> aspect = "performance"; }
        item <'CRIT-903'> '技術風險' : Criterion { :>> kind = "want"; :>> weight = 2.0; :>> aspect = "risk"; }
        item <'CRIT-904'> '成本' : Criterion { :>> kind = "want"; :>> weight = 1.0; :>> aspect = "cost"; }
        #trace dependency from 'CRIT-901' to Requirements::'REQ-SYS-901';
        #trace dependency from 'CRIT-902' to Requirements::'MOP-901';
        #trace dependency from 'CRIT-903' to Requirements::'REQ-SYS-901';
        item <'TRD-901'> '合成方案比較' : DecisionMatrix {
            :>> question = "合成的選擇題";
            item <'ALT-901'> '甲' : Alternative {
                :>> status = "selected";
                item 'CRIT-901' : CriterionScore { :>> score = 1.0; }
                item 'CRIT-902' : CriterionScore { :>> score = 4.0; :>> basis = "合成"; }
                item 'CRIT-903' : CriterionScore { :>> score = 3.0; }
                item 'CRIT-904' : CriterionScore { :>> score = 2.0; }
            }
            item <'ALT-902'> '乙' : Alternative {
                :>> status = "rejected";
                :>> rationale = "合成的否決理由";
                item 'CRIT-901' : CriterionScore { :>> score = 1.0; }
                item 'CRIT-902' : CriterionScore { :>> score = 3.0; }
                item 'CRIT-903' : CriterionScore { :>> score = 4.0; }
                item 'CRIT-904' : CriterionScore { :>> score = 5.0; }
            }
            item <'ALT-903'> '丙' : Alternative {
                :>> status = "rejected";
                item 'CRIT-901' : CriterionScore { :>> score = 0.0; }
                item 'CRIT-902' : CriterionScore { :>> score = 5.0; }
                item 'CRIT-903' : CriterionScore { :>> score = 5.0; }
                item 'CRIT-904' : CriterionScore { :>> score = 5.0; }
            }
        }
        #trace dependency from Structure::'SUB-901' to 'TRD-901'::'ALT-901';
    }
}`;

const CALC = (mass: string) => `package Project {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import JRI::*;
    package Calculations {
        private import ScalarValues::*;
        private import ISQ::*;
        private import SI::*;
        private import RealFunctions::*;
        private import OpenSysMLMathFunctions::*;
        calc def <'CALC-901'> TWR {
            doc /* 推重比 = 推力 / 重量 */
            in thrust : ForceValue;
            in mass : MassValue;
            return : Real = thrust / (mass * 9.80665 [m/s^2]);
        }
        calc def <'CALC-902'> DeltaV { in isp : Real; in m0 : Real; in mf : Real; return : Real = isp * 9.80665 * ln(m0 / mf); }
        calc def <'CALC-903'> Hyp { in a : Real; in b : Real; return : Real = sqrt(a * a + b * b); }
        calc def <'CALC-904'> Twice { in a : Real; in b : Real; return : Real = 2.0 * Hyp(a, b); }
    }
    package Structure {
        part def '合成火箭' :> System {
            attribute thrust : ForceValue default = 1200.0 [N];
            attribute mass : MassValue default = 20.0 [kg];
            attribute twr : Real = Calculations::TWR(thrust, mass);
            attribute dv : Real = Calculations::DeltaV(180.0, 20.0, 15.0);
            attribute chain : Real = Calculations::Twice(3.0, 4.0);
            assert constraint '推重比下限' { twr >= 5.0 }
        }
        part rocket : '合成火箭' { attribute :>> mass = ${mass}; }
    }
}`;

const close = (a: number | null, b: number, msg?: string) => assert.ok(a !== null && Math.abs(a - b) < 1e-6, `${msg ?? ""} 期望 ${b}，得到 ${a}`);

test("P6 方案比較：合成的決策矩陣算出正確的加權分數與名次", async () => {
  const a = await analyze([["JRI.sysml", LIB], ["model.sysml", TRADE]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
  const [m] = evaluateTrades(a);
  assert.equal(m.name, "合成方案比較");
  assert.equal(m.question, "合成的選擇題");
  assert.equal(m.criteria.length, 4);
  const by = (n: string) => m.alternatives.find((x) => x.name === n)!;
  // 甲：3×4 + 2×3 + 1×2 = 20；正規化 20 / 6
  close(by("甲").total, 20); close(by("甲").normalized, 20 / 6);
  // 乙：3×3 + 2×4 + 1×5 = 22；正規化 22 / 6
  close(by("乙").total, 22); close(by("乙").normalized, 22 / 6);
  // 丙：必須準則不通過 → 剔除，不計分
  assert.equal(by("丙").feasible, false);
  assert.equal(by("丙").total, null);
  assert.deepEqual(by("丙").failedMust.length, 1);
  assert.equal(by("乙").rank, 1); assert.equal(by("甲").rank, 2); assert.equal(by("丙").rank, null);
  assert.equal(m.best, by("乙").id);
  assert.equal(m.selected, by("甲").id);
  // 權重占比
  close(m.criteria.find((c) => c.shortName === "CRIT-902")!.share, 0.5);
  // 選定方案連到設計；弱點 = 選定方案 ≤ 2 分的加分準則（成本 2 分）
  assert.deepEqual(by("甲").design.map((d) => d.name), ["SUB-901 推進次系統"]);
  assert.deepEqual(by("甲").weaknesses.map((w) => m.criteria.find((c) => c.id === w)!.name), ["成本"]);
  const texts = m.missing.map((x) => x.text);
  assert.ok(texts.some((t) => t.includes("丙") && t.includes("理由")), "否決的丙沒有理由要標出");
  assert.ok(texts.some((t) => t.includes("甲") && t.includes("不是分數最高")), "選定的不是最高分又沒理由要標出");
  assert.ok(texts.some((t) => t.includes("成本") && t.includes("沒有追溯")), "成本準則沒有追溯要標出");
  assert.ok(!texts.some((t) => t.includes("風險準則")), "已有風險準則");
  assert.equal(listCriteria(a).length, 4);
});

test("P6 方案比較：缺風險準則、必須準則分數不合法、選定的方案沒通過必須準則都會標出", async () => {
  const src = TRADE.replace(`:>> aspect = "risk"`, `:>> aspect = "safety"`)
    .replace(`item 'CRIT-901' : CriterionScore { :>> score = 0.0; }`, `item 'CRIT-901' : CriterionScore { :>> score = 0.5; }`)
    .replace(`:>> status = "selected";`, `:>> status = "candidate";`)
    .replace(`'丙' : Alternative {\n                :>> status = "rejected";`, `'丙' : Alternative {\n                :>> status = "selected";`);
  const a = await analyze([["JRI.sysml", LIB], ["model.sysml", src]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
  const texts = evaluateTrades(a)[0].missing.map((x) => x.text);
  assert.ok(texts.some((t) => t.includes("風險準則")));
  assert.ok(texts.some((t) => t.includes("丙") && t.includes("1（通過）或 0")));
  assert.ok(texts.some((t) => t.includes("丙") && t.includes("還沒有連到設計")));
});

test("P6 公式：解析器能求值 calc def（ln、開根號、串接、單位），改上游數字判定跟著變", async () => {
  for (const [mass, twr, status] of [["30.0 [kg]", 1200 / (30 * 9.80665), "fails"], ["20.0 [kg]", 1200 / (20 * 9.80665), "holds"]] as const) {
    const sources = [["JRI.sysml", LIB], ["model.sysml", CALC(mass)]] as const;
    const a = await analyze(sources);
    assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
    const defs = listCalcDefs(a, new Map([["model.sysml", CALC(mass)]]));
    assert.deepEqual(defs.map((d) => d.name), ["TWR", "DeltaV", "Hyp", "Twice"]);
    assert.deepEqual(defs[0].params, [{ name: "thrust", type: "ForceValue" }, { name: "mass", type: "MassValue" }]);
    assert.equal(defs[0].expression, "thrust / (mass * 9.80665 [m/s^2])");
    assert.equal(defs[0].doc, "推重比 = 推力 / 重量");
    const out = await withModel(sources, (model) => evaluateModel(model, a, new Map(sources)));
    assert.ok(out);
    const r = (owner: string, attr: string) => out.results.find((x) => x.attr === attr && x.ownerName === owner);
    close(r("rocket", "twr")?.value?.value as number, twr, "rocket.twr");
    close(r("合成火箭", "twr")?.value?.value as number, 1200 / (20 * 9.80665), "定義的預設值");
    close(r("rocket", "dv")?.value?.value as number, 180 * 9.80665 * Math.log(20 / 15), "Δv 用 ln");
    close(r("rocket", "chain")?.value?.value as number, 10, "串接與開根號");
    assert.ok(!out.results.some((x) => x.attr === "mass" || x.attr === "thrust"), "寫死的數字不算公式");
    const check = out.checks.find((c) => c.name === "推重比下限" && c.subject);
    assert.equal(check?.status, status);
  }
});

test("P6 公式：產生的 calc def 文字與輸入檢查", () => {
  const t = calcText({ name: "TWR", params: [{ name: "thrust", type: "ForceValue" }, { name: "mass", type: "MassValue" }], returnType: "Real", expression: "thrust / (mass * 9.80665 [m/s^2])", doc: "合成" }, [], "    ");
  assert.equal(t, "    calc def <'CALC-001'> TWR {\n        doc /* 合成 */\n        in thrust : ForceValue;\n        in mass : MassValue;\n        return : Real = thrust / (mass * 9.80665 [m/s^2]);\n    }\n");
  assert.deepEqual(parseCalcSource(t.trim()).params.length, 2);
  assert.throws(() => calcText({ name: "X", params: [{ name: "a", type: "Real" }], returnType: "Real", expression: "a; part evil" }, [], ""), /分號/);
  assert.throws(() => calcText({ name: "X", params: [{ name: "1a", type: "Real" }], returnType: "Real", expression: "a" }, [], ""), /參數名稱/);
  assert.ok(isLiteral("1200.0 [N]") && isLiteral('"文字"') && !isLiteral("TWR(thrust, mass)"));
});

// ───────── 端對端：網站的路由 ─────────
const PORT = 18861, PUB = 18862;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
async function call(p: string, method = "GET", body?: unknown) {
  const r = await fetch(`${I}/api/projects/p6${p}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
async function ok(p: string, method = "GET", body?: unknown) {
  const r = await call(p, method, body);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 400));
  return r.data;
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p6-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/bin/false" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});

after(async () => {
  server?.kill();
  await shutdown();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("P6 端對端：建立準則、方案比較、打分、決定；新增、修改、求值公式", async () => {
  const created = await fetch(`${I}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "p6", name: "P6 合成專案", kind: "annual" }) });
  assert.equal(created.status, 200);
  let v = await ok("");
  const req = v.analysis.elements.find((e: any) => e.category === "SystemRequirement");
  const sub = v.analysis.elements.find((e: any) => e.category === "Subsystem");
  assert.ok(req && sub);
  const el = (cat: string, name: string) => v.analysis.elements.find((e: any) => e.category === cat && e.name === name);

  v = await ok("/elements", "POST", { category: "Criterion", name: "合成必須", attrs: { kind: "must", aspect: "performance", measure: "合成門檻" } });
  v = await ok("/elements", "POST", { category: "Criterion", name: "合成性能", attrs: { kind: "want", weight: "2", aspect: "performance" } });
  v = await ok("/elements", "POST", { category: "Criterion", name: "合成風險", attrs: { kind: "want", weight: "1", aspect: "risk" } });
  for (const n of ["合成必須", "合成性能", "合成風險"]) v = await ok("/relations", "POST", { kind: "trace", from: el("Criterion", n).id, to: req.id });
  v = await ok("/elements", "POST", { category: "DecisionMatrix", name: "合成比較", attrs: { question: "合成問題" } });
  const m = el("DecisionMatrix", "合成比較");
  v = await ok("/elements", "POST", { category: "Alternative", name: "方案一", parentId: m.id, attrs: { status: "candidate" } });
  v = await ok("/elements", "POST", { category: "Alternative", name: "方案二", parentId: m.id, attrs: { status: "candidate" } });
  const [a1, a2] = [el("Alternative", "方案一"), el("Alternative", "方案二")];
  const [c1, c2, c3] = ["合成必須", "合成性能", "合成風險"].map((n) => el("Criterion", n));
  const scores: [any, any, string][] = [[a1, c1, "1"], [a1, c2, "5"], [a1, c3, "2"], [a2, c1, "1"], [a2, c2, "3"], [a2, c3, "4"]];
  for (const [a, c, s] of scores) v = await ok("/trades/score", "POST", { alternative: a.id, criterion: c.id, score: s, basis: "合成依據" });
  // 改分數：方案一的風險 2 → 3（覆寫，不新增第二筆）
  v = await ok("/trades/score", "POST", { alternative: a1.id, criterion: c3.id, score: "3" });
  let t = (await ok("/trades")).matrices.find((x: any) => x.name === "合成比較");
  const alt = (n: string) => t.alternatives.find((x: any) => x.name === n);
  // 方案一：2×5 + 1×3 = 13；方案二：2×3 + 1×4 = 10
  close(alt("方案一").total, 13); close(alt("方案二").total, 10);
  close(alt("方案一").normalized, 13 / 3);
  assert.equal(t.best, alt("方案一").id);
  assert.equal(alt("方案一").scores[c3.id].score, 3);
  assert.equal(alt("方案一").scores[c2.id].basis, "合成依據");

  // 否決沒有理由 → 擋下
  const bad = await call("/trades/decide", "POST", { matrix: m.id, selected: a1.id, rationale: {} });
  assert.equal(bad.status, 400, JSON.stringify(bad.data));
  const d = await ok("/trades/decide", "POST", { matrix: m.id, selected: a1.id, rationale: { [a1.id]: "分數最高", [a2.id]: "合成的否決理由" }, decision: "選方案一" });
  t = d.matrices.find((x: any) => x.name === "合成比較");
  assert.equal(t.selected, alt("方案一").id);
  assert.equal(t.decision, "選方案一");
  assert.equal(t.alternatives.find((x: any) => x.name === "方案二").status, "rejected");
  assert.equal(t.alternatives.find((x: any) => x.name === "方案二").rationale, "合成的否決理由");
  v = d;
  v = await ok("/relations", "POST", { kind: "trace", from: sub.id, to: el("Alternative", "方案一").id });
  t = (await ok("/trades")).matrices.find((x: any) => x.name === "合成比較");
  assert.equal(t.alternatives.find((x: any) => x.name === "方案一").design.length, 1);
  assert.deepEqual(t.missing, [], JSON.stringify(t.missing));

  // 公式：新增 → 求值 → 修改
  let c = await ok("/calcs", "POST", { name: "DeltaV", doc: "合成：理想火箭方程式", params: [{ name: "isp", type: "Real" }, { name: "m0", type: "Real" }, { name: "mf", type: "Real" }], returnType: "Real", expression: "isp * 9.80665 * ln(m0 / mf)" });
  const dv = c.defs.find((x: any) => x.name === "DeltaV");
  assert.equal(dv.expression, "isp * 9.80665 * ln(m0 / mf)");
  let e = await ok("/calcs/eval", "POST", { expression: "Calculations::DeltaV(200.0, 10.0, 8.0)" });
  close(e.value.value, 200 * 9.80665 * Math.log(10 / 8));
  c = await ok("/calcs", "POST", { id: dv.id, name: "DeltaV", params: [{ name: "isp", type: "Real" }, { name: "m0", type: "Real" }, { name: "mf", type: "Real" }], returnType: "Real", expression: "isp * 9.80665 * ln(m0 / mf) * 0.5" });
  assert.equal(c.defs.filter((x: any) => x.name === "DeltaV").length, 1);
  assert.equal(c.defs[0].shortName, dv.shortName);
  e = await ok("/calcs/eval", "POST", { expression: "Calculations::DeltaV(200.0, 10.0, 8.0)" });
  close(e.value.value, 0.5 * 200 * 9.80665 * Math.log(10 / 8));
  // 第二條公式放進同一個套件
  c = await ok("/calcs", "POST", { name: "Hyp", params: [{ name: "a", type: "Real" }, { name: "b", type: "Real" }], expression: "sqrt(a * a + b * b)" });
  assert.equal(c.defs.length, 2);
  e = await ok("/calcs/eval", "POST", { expression: "Calculations::Hyp(3.0, 4.0)" });
  close(e.value.value, 5);
  // 錯誤的運算式不存檔，回傳診斷
  const broken = await call("/calcs", "POST", { name: "Broken", params: [{ name: "a", type: "Real" }], expression: "a + undefinedName" });
  assert.equal(broken.status, 422);
  const st = await ok("/calcs");
  assert.ok(!st.results.some((x: any) => ["role", "kind", "aspect", "question", "status"].includes(x.attr)), "字串屬性不算公式：" + JSON.stringify(st.results.map((x: any) => x.attr)));
  e = await ok("/calcs/eval", "POST", { expression: "undefinedName + 1" });
  assert.match(e.error, /unresolved/);
});
