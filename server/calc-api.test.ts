// WP2（ANA-01／04／06／10／11）端對端：判定總覽、質量預算、模擬輸入讀自模型、取消最後一個對應。合成數值。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18917, PUB = 18918;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-calc-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  await call(`${I}/api/projects`, "POST", { id: "c1", name: "計算測試", kind: "annual", template: "blank" });
  const model = `package Project {
  private import ScalarValues::*; private import ISQ::*; private import SI::*; private import JRI::*; private import QuantityCalculations::*;
  calc def RailExit { in a : AccelerationValue; in L : LengthValue; return : SpeedValue = sqrt(2 * a * L); }
  part def Sub { attribute mass : MassValue; }
  part def Rk :> System {
    attribute massLimit : MassValue = 5.0 [kg];
    attribute length : LengthValue;
    attribute apogee : LengthValue;
    part a : Sub { :>> mass = 3.0 [kg]; }
    part b : Sub { :>> mass = 2.5 [kg]; }
  }
  part rk : Rk { :>> length = 260 [cm]; :>> apogee = 2900 [m]; }
  requirement <'REQ-T-001'> 'apogee window' : SystemRequirement {
    subject r : Rk;
    require constraint { r.apogee >= 2850 [m] and r.apogee <= 3150 [m] }
  }
  satisfy 'apogee window' by rk;
  requirement <'REQ-T-002'> 'apogee floor' : SystemRequirement {
    subject r : Rk;
    require constraint { r.apogee >= 3000 [m] }
  }
  satisfy 'apogee floor' by rk;
}`;
  const r = await call(`${I}/api/projects/c1/files/model.sysml`, "PUT", { content: model, message: "t" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 400));
});
after(async () => { server?.kill(); await new Promise((r) => setTimeout(r, 500)); await fs.rm(home, { recursive: true, force: true }).catch(() => {}); });

test("ANA-06 判定總覽：每條有條件的需求一列，算出值、門檻、餘裕、來源", async () => {
  const r = await call(`${I}/api/projects/c1/calc/verdicts`);
  assert.equal(r.status, 200);
  const rows = r.data.rows;
  assert.equal(rows.length, 2);
  const w = rows.find((x: any) => x.requirement === "REQ-T-001"), f = rows.find((x: any) => x.requirement === "REQ-T-002");
  assert.equal(w.status, "holds"); assert.equal(w.value, 2900); assert.equal(w.unit, "m");
  assert.equal(w.margin, 50, "距下限 2850 還有 50 m，距上限 150 m，取最小");
  assert.match(w.source, /模型屬性 rk\.apogee/);
  assert.equal(f.status, "fails"); assert.equal(f.margin, -100);
});

test("ANA-11 質量預算：子項 3.0 + 2.5 = 5.5 kg 超過上限 5.0 kg 判 FAIL", async () => {
  const r = await call(`${I}/api/projects/c1/calc/budget`);
  const b = r.data.rows.find((x: any) => x.name === "rk");
  assert.equal(b.status, "FAIL"); assert.equal(b.sumKg, 5.5); assert.equal(b.marginKg, -0.5);
});

test("ANA-09 算式求值 API：50 m/s²、600 cm → 24.49 m/s", async () => {
  const r = await call(`${I}/api/projects/c1/calc/eval`, "POST", { expr: "RailExit(50 ['m/s²'], 600 [cm])", imports: ["Project"] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(Math.abs(r.data.result.value - 24.4949) < 1e-3);
  assert.equal((await call(`${I}/api/projects/c1/calc/eval`, "POST", { expr: "1; x" })).status, 400);
});

test("ANA-10／01 模擬輸入讀自模型：改模型屬性後輸入跟著變，sim.json 不存該欄位", async () => {
  const link = { "rocket.length_m": { element: "Project::rk", attribute: "length" } };
  let s = (await call(`${I}/api/projects/c1/sim`)).data;
  assert.equal(s.inputs.rocket.length_m, 2.6, "沒對應時用預設");
  const put = await call(`${I}/api/projects/c1/sim/inputs`, "PUT", { inputs: { ...s.inputs, rocket: { ...s.inputs.rocket, length_m: 2.6, cm_from_nose_m: 1.45 } }, links: link });
  assert.equal(put.status, 200, JSON.stringify(put.data).slice(0, 300));
  assert.ok(Math.abs(put.data.inputs.rocket.length_m - 2.6) < 1e-9, "260 cm 換成 2.6 m");
  const file = path.join(home, "projects", "c1", "sim.json");
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(stored.inputs.rocket.length_m, undefined, "有對應的欄位不存在 sim.json");
  assert.equal(stored.inputs.rocket.mass_kg, 14, "模型沒有的設定仍存在");
  // 改模型
  const cur = await fs.readFile(path.join(home, "projects", "c1", "model", "model.sysml"), "utf8");
  const r2 = await call(`${I}/api/projects/c1/files/model.sysml`, "PUT", { content: cur.replace("260 [cm]", "300 [cm]"), message: "t" });
  assert.equal(r2.status, 200);
  s = (await call(`${I}/api/projects/c1/sim`)).data;
  assert.ok(Math.abs(s.inputs.rocket.length_m - 3) < 1e-9, `改成 300 cm 後應為 3 m，實際 ${s.inputs.rocket.length_m}`);
  // 量綱不符：長度欄位對到質量屬性 → 退回手填值並回報
  const bad = await call(`${I}/api/projects/c1/sim/inputs`, "PUT", { inputs: s.inputs, links: { "rocket.length_m": { element: "Project::rk", attribute: "massLimit" } } });
  assert.equal(bad.data.linkIssues.length, 1);
  assert.equal((await call(`${I}/api/projects/c1/sim/inputs`, "PUT", { inputs: s.inputs, links: { "launch.latitude": { element: "Project::rk", attribute: "length" } } })).status, 400, "角度與經緯度不開放對應");
});

test("ANA-04 取消對應：最後一個對應也能取消，且取消後不會自動帶回預設", async () => {
  const file = path.join(home, "projects", "c1", "sim.json");
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  stored.result = { at: new Date().toISOString(), by: "t", commit: "x", inputsHash: "x", engine: "RocketPy (fake)", outputs: [{ key: "apogee", zh: "遠地點", value: 2950, unit: "m" }], trajectory: [], warnings: [] };
  await fs.writeFile(file, JSON.stringify(stored));
  let r = await call(`${I}/api/projects/c1/sim/apply`, "POST", { bindings: [{ output: "apogee", element: "Project::rk", attribute: "apogee" }] });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal((await call(`${I}/api/projects/c1/sim`)).data.bindings.length, 1);
  const v = (await call(`${I}/api/projects/c1/calc/verdicts`)).data.rows.find((x: any) => x.requirement === "REQ-T-001");
  assert.equal(v.value, 2950); assert.match(v.source, /模擬/);
  r = await call(`${I}/api/projects/c1/sim/apply`, "POST", { bindings: [] });
  assert.equal(r.status, 200); assert.equal(r.data.cleared, true);
  const s = (await call(`${I}/api/projects/c1/sim`)).data;
  assert.deepEqual(s.bindings, []); assert.equal(s.bound, true);
});
