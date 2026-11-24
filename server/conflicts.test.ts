// WP4：衝突偵測、裁決、核可後變更。合成資料；伺服器用自己的埠與暫存目錄。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { canDecide } from "./routes/conflicts.ts";

const PORT = 18937, PUB = 18938;
const I = `http://127.0.0.1:${PORT}/api/projects/c4`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
const modelFile = () => path.join(home, "projects", "c4", "model", "model.sysml");

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-wp4-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await call(`http://127.0.0.1:${PORT}/api/projects`, "POST", { id: "c4", name: "WP4 測試", kind: "annual", template: "sample" })).status, 200);
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("只有總工程師以上能裁決", () => {
  for (const r of ["D-VII", "F-VIII", "R-VIII"]) assert.equal(canDecide(r), true);
  for (const r of ["O-VI", "O-V", "O-IV", "C-III", "C-II", null, undefined]) assert.equal(canDecide(r), false);
});

test("介面兩端數字一致時沒有衝突；故意改錯一端就出現一筆，預算超過也算", async () => {
  assert.deepEqual((await call(`${I}/conflicts`)).data.conflicts, []);
  const v = (await call(I)).data;
  const sys = v.analysis.elements.find((e: any) => e.name === "火箭" && e.kind === "PartDefinition");
  const part = (n: string) => v.analysis.elements.find((e: any) => e.name === n && e.kind === "PartUsage" && e.owner === sys.id).id;
  const r = await call(`${I}/interfaces`, "POST", { system: sys.id, a: part("推進"), b: part("回收"), name: "合成介面", kind: "機械", params: [{ name: "diameter", a: "100", b: "100", unit: "mm" }] });
  assert.equal(r.status, 200);
  assert.deepEqual((await call(`${I}/conflicts`)).data.conflicts, [], "兩端一致");
  await fs.writeFile(modelFile(), (await fs.readFile(modelFile(), "utf8")).replace("diameterB = 100.0 [mm]", "diameterB = 98.0 [mm]"));
  const c = (await call(`${I}/conflicts`)).data.conflicts;
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "interface");
  assert.equal(c[0].condition, "diameterA == diameterB");
  assert.equal(c[0].decision, null);
  await fs.writeFile(modelFile(), (await fs.readFile(modelFile(), "utf8")).replace("part '回收' : '回收次系統';", "part '回收' : '回收次系統';\n            attribute massA = 3.0 [kg];\n            attribute massB = 2.5 [kg];\n            attribute massTotal = massA + massB;\n            attribute massLimit = 5.0 [kg];\n            assert constraint { massTotal <= massLimit }"));
  assert.deepEqual((await call(`${I}/conflicts`)).data.conflicts.map((x: any) => x.kind).sort(), ["budget", "interface"]);
});

test("裁決：沒有理由或需求被拒絕；成功後留 DesignDecision、連到需求與衝突，衝突標已裁決", async () => {
  const c = (await call(`${I}/conflicts`)).data.conflicts.find((x: any) => x.kind === "interface");
  const req = (await call(I)).data.analysis.elements.find((e: any) => e.shortName === "NEED-001");
  const before = await fs.readFile(modelFile(), "utf8");
  assert.equal((await call(`${I}/conflicts/decide`, "POST", { key: c.key, rationale: "", requirements: [req.id] })).status, 400);
  assert.equal((await call(`${I}/conflicts/decide`, "POST", { key: c.key, rationale: "合成理由", requirements: [] })).status, 400, "有需求的專案要選需求");
  assert.equal((await call(`${I}/conflicts/decide`, "POST", { key: "0000000000", rationale: "x", requirements: [req.id] })).status, 400);
  assert.equal(await fs.readFile(modelFile(), "utf8"), before, "被拒絕時模型不變");
  const ok = await call(`${I}/conflicts/decide`, "POST", { key: c.key, rationale: "合成理由", requirements: [req.id] });
  assert.equal(ok.status, 200, JSON.stringify(ok.data).slice(0, 300));
  const text = await fs.readFile(modelFile(), "utf8");
  assert.match(text, new RegExp(`\\[conflict:${c.key}\\]`));
  assert.match(text, /decidedBy = "/);
  assert.match(text, /decidedOn = "\d{4}-\d{2}-\d{2}"/);
  assert.equal((text.match(/#trace dependency from Project::Decisions::/g) ?? []).length, 2, "連到介面與需求各一條");
  const after = (await call(`${I}/conflicts`)).data.conflicts;
  assert.equal(after.find((x: any) => x.key === c.key).decision.shortName, "DEC-001");
  assert.equal(after.filter((x: any) => !x.decision).length, 1, "預算衝突仍未裁決");
  assert.equal((await call(`${I}/conflicts/decide`, "POST", { key: c.key, rationale: "再一次", requirements: [req.id] })).status, 400, "不能重複裁決");
});

test("核可後變更：沒有核可時沒有基準；核可後基準含當時的需求與介面", async () => {
  assert.equal((await call(`${I}/change-control`)).data.approved, null);
  const s = await call(`${I}/signoffs`, "POST", { gate: "proposal", decision: "APPROVE", comment: "合成" });
  assert.equal(s.status, 200);
  const a = (await call(`${I}/change-control`)).data.approved;
  assert.equal(a.gate, "proposal");
  assert.ok(a.keys.includes("NEED-001") && a.keys.includes("IF-001"));
  assert.ok(!a.keys.includes("DEC-001"), "決策不是需求或介面");
});
