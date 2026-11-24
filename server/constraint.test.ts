// ANA-08：約束圖的約束線來自需求條件。全部用合成數值，直接測解析器的單位換算與量綱檢查。
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chartLimits, chartMetricOf } from "./calc.ts";
import fs from "node:fs";
import { LIBRARY_FILE, shutdown } from "./engine.ts";

after(() => shutdown());
const LIB = [[LIBRARY_FILE, fs.readFileSync(new URL("../library/JRI.sysml", import.meta.url), "utf8")]] as const;
const term = (attribute: string, op: string, threshold: string) => ({ attribute, op, threshold, value: null, unit: "", margin: null });
const req = (terms: ReturnType<typeof term>[]) => ({ requirement: "R-1", name: "合成需求", terms });

test("約束線：範圍型（2.85 km–3150 m）變成上下兩條，單位換成 m", async () => {
  const l = await chartLimits(LIB, [req([term("apogee", ">=", "2.85 [km]"), term("apogee", "<=", "3150 [m]")])]);
  assert.deepEqual(l.map((x) => [x.metric, x.op, x.value]), [["apogee", ">=", 2850], ["apogee", "<=", 3150]]);
});

test("約束線：加速度、離軌速度、動壓各自換成 SI（kPa；質量基準 g 要換回 kg）", async () => {
  const l = await chartLimits(LIB, [req([term("maxAcceleration", "<=", "120 ['m/s²']"), term("railExitSpeed", ">=", "30 ['m/s']"), term("maxDynamicPressure", "<=", "300 [kPa]")])]);
  assert.deepEqual(l.map((x) => [x.metric, x.value]), [["accel", 120], ["rail", 30], ["q", 300000]]);
});

test("約束線：量綱不符、不認得的屬性、== 都不畫（g 在這裡是公克，不是 g 力）", async () => {
  const l = await chartLimits(LIB, [req([term("maxAcceleration", "<=", "12 [g]"), term("apogee", "<=", "30 ['m/s']"), term("mass", "<=", "5 [kg]"), term("apogee", "==", "3000 [m]")])]);
  assert.equal(l.length, 0);
  assert.equal(chartMetricOf("mass"), null);
  assert.equal(chartMetricOf("MaxQ"), "q");
});
