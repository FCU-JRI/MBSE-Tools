// ANA-09／ANA-11：計算器與質量預算。全部用合成數值，直接測解析器的求值結果。
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { evalCalc, evalExpr, instanceValues, checkInstance, massBudget, massKg } from "./calc.ts";
import { shutdown } from "./engine.ts";

after(() => shutdown());

const MODEL = `package P {
  private import ScalarValues::*; private import ISQ::*; private import SI::*; private import QuantityCalculations::*;
  calc def RailExit { in a : AccelerationValue; in L : LengthValue; return : SpeedValue = sqrt(2 * a * L); }
  calc def Impulse { in F : ForceValue; in t : DurationValue; return : ImpulseValue = F * t; }
  calc def Twr { in thrust : ForceValue; in m : MassValue; in g : AccelerationValue; return : Real = thrust / (m * g); }
  part def Sub { attribute mass : MassValue; }
  part def Rk {
    attribute massLimit : MassValue = 5.0 [kg];
    part a : Sub { :>> mass = 3.0 [kg]; }
    part b : Sub { :>> mass = 2.5 [kg]; }
    attribute total : MassValue = a.mass + b.mass;
    assert constraint { total <= massLimit }
  }
  part rk : Rk;
  part def Ok { attribute massLimit : MassValue = 6 [kg]; part a : Sub { :>> mass = 3000 [g]; } part b : Sub { :>> mass = 2.5 [kg]; } }
  part ok : Ok;
}`;
const S = [["m.sysml", MODEL]] as const;
const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} 與 ${b} 差太多`);
const q = (v: any) => { assert.ok("unit" in v, JSON.stringify(v)); return v; };

test("calc：離軌速度 √(2·a·L)，50 m/s²、600 cm → 24.49 m/s（cm 自動換算）", async () => {
  const r = q(await evalCalc(S, "RailExit", [{ value: 50, unit: "m/s^2" }, { value: 600, unit: "cm" }], ["P"]));
  near(r.value, Math.sqrt(600), 1e-6);
  assert.equal(r.unit, "m/s");
  const r2 = q(await evalCalc(S, "RailExit", [{ value: 50, unit: "m/s^2" }, { value: 6, unit: "m" }], ["P"]));
  near(r2.value, r.value, 1e-9);
});

test("calc：總衝量 F·t，2000 N × 3 s → 6000 N·s；推重比 無因次", async () => {
  const r = q(await evalCalc(S, "Impulse", [{ value: 2000, unit: "N" }, { value: 3, unit: "s" }], ["P"]));
  near(r.value, 6000);
  const r2 = await evalCalc(S, "Twr", [{ value: 2400, unit: "N" }, { value: 14, unit: "kg" }, { value: 9.8, unit: "m/s^2" }], ["P"]);
  near((r2 as any).value, 2400 / (14 * 9.8), 1e-6);
});

test("evalExpr：單位換算 1 km + 500 m = 1500 m；錯誤算式丟出可讀訊息", async () => {
  const r = q(await evalExpr(S, "1 [km] + 500 [m]"));
  near(r.base, 1500);
  await assert.rejects(() => evalExpr(S, "nonsense_fn(1)"), /算式/);
  await assert.rejects(() => evalExpr(S, "1; part x"), /分號/);
});

test("instanceValues：衍生屬性 total = 3.0 + 2.5 kg", async () => {
  const v = await instanceValues(S, "P::rk");
  near(massKg(v.total)!, 5.5);
  near(massKg(v.massLimit)!, 5);
});

test("checkInstance：加總 5.5 kg 超過上限 5.0 kg 判 fails", async () => {
  const r = await checkInstance(S, "P::rk");
  assert.ok(r.some((x) => x.status === "fails"), JSON.stringify(r));
});

test("質量預算：5.5 > 5.0 判 FAIL、餘裕 -0.5；5.5（含 3000 g）≤ 6 判 PASS、餘裕 0.5", async () => {
  const rows = await massBudget(S, ["P::rk", "P::ok"]);
  const rk = rows.find((r) => r.element === "P::rk")!, ok = rows.find((r) => r.element === "P::ok")!;
  assert.equal(rk.status, "FAIL"); near(rk.sumKg, 5.5); near(rk.marginKg, -0.5); assert.equal(rk.items.length, 2);
  assert.equal(ok.status, "PASS"); near(ok.sumKg, 5.5); near(ok.marginKg, 0.5);
});
