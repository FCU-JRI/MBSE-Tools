// WP1 第二部分：設計依據（#basis）、數值條件（預算配額與邊界）、設計方案（variant）、介面。建得出來、改得回去、刪得掉。合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18887, PUB = 18888; // 和其他測試檔錯開
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
let v: any;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
const model = () => fs.readFile(path.join(home, "projects", "w2", "model", "model.sysml"), "utf8");
const els = () => v.analysis.elements as any[];
const named = (n: string, kind?: string) => els().find((e) => e.name === n && (!kind || e.kind === kind));
const rels = (kind: string) => (v.analysis.relations as any[]).filter((r) => r.kind === kind);
async function send(p: string, body: unknown, want = 200, method = "POST") {
  const before = await model();
  const r = await call(`${I}/api/projects/w2${p}`, method, body);
  assert.equal(r.status, want, JSON.stringify(r.data).slice(0, 500));
  if (r.data?.analysis) v = r.data;
  if (want !== 200) assert.equal(await model(), before, "被拒絕時模型不變");
  else if (r.data?.analysis) assert.equal(v.analysis.ok, true);
  return r.data;
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-wp1b-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "w2", name: "WP1b 測試", kind: "annual", template: "sample" })).status, 200);
  v = (await call(`${I}/api/projects/w2`)).data;
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("設計依據：需求連到設計產出，可刪；起點不是需求會被拒絕", async () => {
  await send("/elements", { category: "DesignDecision", name: "合成推進選型", attrs: { rationale: "合成", decidedBy: "總工程師", decidedOn: "2026-01-01" } });
  const req = named("總衝量"), dec = named("合成推進選型");
  await send("/relations", { kind: "basis", from: req.id, to: dec.id });
  assert.ok(rels("basis").some((r) => r.from === named("總衝量").id && r.to === named("合成推進選型").id), "建得出來");
  assert.match(await model(), /#basis dependency from/);
  await send("/relations", { kind: "basis", from: named("合成推進選型").id, to: named("總衝量").id }, 400);
  await send("/relations/delete", { kind: "basis", from: named("總衝量").id, to: named("合成推進選型").id });
  assert.equal(rels("basis").length, 0, "刪得掉");
});

test("數值條件：設定、改值、清除；屬性不存在時被拒絕且模型不變", async () => {
  const req = named("總衝量"), sub = named("推進次系統", "PartDefinition");
  await send("/elements/condition", { id: req.id, subject: sub.id, attribute: "totalImpulse", op: ">=", value: "9000", unit: "N*s" });
  let c = (await call(`${I}/api/projects/w2/elements/condition?id=${named("總衝量").id}`)).data.condition;
  assert.match(c.expr, /s\.totalImpulse >= 9000\.0 \['N⋅s'\]/, "N*s 自動轉成解析器認得的 'N⋅s'");
  await send("/elements/condition", { id: named("總衝量").id, subject: sub.id, attribute: "totalImpulse", op: ">=", value: "9500", unit: "N*s" });
  c = (await call(`${I}/api/projects/w2/elements/condition?id=${named("總衝量").id}`)).data.condition;
  assert.match(c.expr, /9500\.0/, "改得回去");
  assert.equal((await model()).match(/require constraint \{ s\.totalImpulse/g)?.length, 1, "改值不會多一行");
  await send("/elements/condition", { id: named("總衝量").id, subject: sub.id, attribute: "noSuchAttr", op: "<=", value: "1", unit: "kg" }, 422);
  await send("/elements/condition", { id: named("總衝量").id, subject: "" });
  c = (await call(`${I}/api/projects/w2/elements/condition?id=${named("總衝量").id}`)).data.condition;
  assert.equal(c, null, "刪得掉");
});

test("預算配額：質量上限寫成數值條件，超過時判定不通過", async () => {
  // 判定要有實例：用頂層的 rocket（乾重 18.5 kg）滿足一條 15 kg 的配額
  await send("/elements", { category: "SystemRequirement", name: "合成乾重配額", doc: "火箭乾重應不超過合成上限" });
  const sys = named("火箭", "PartDefinition");
  await send("/elements/condition", { id: named("合成乾重配額").id, subject: sys.id, attribute: "dryMass", op: "<=", value: "15", unit: "kg" });
  await send("/relations", { kind: "satisfy", from: els().find((e) => e.name === "rocket" && e.kind === "PartUsage").id, to: named("合成乾重配額").id });
  const s = (v.analysis.satisfaction as any[]).find((x) => x.requirement === named("合成乾重配額").qualifiedName);
  assert.equal(s?.status, "fails", `18.5 kg 超過 15 kg 配額應判不通過：${JSON.stringify(v.analysis.satisfaction)}`);
  await send("/elements/condition", { id: named("合成乾重配額").id, subject: sys.id, attribute: "dryMass", op: "<=", value: "20", unit: "kg" });
  const s2 = (v.analysis.satisfaction as any[]).find((x) => x.requirement === named("合成乾重配額").qualifiedName);
  assert.equal(s2?.status, "holds", "放寬到 20 kg 後通過");
});

test("設計方案：建方案、加候選、改名、刪候選、刪方案", async () => {
  await send("/elements", { category: "DesignAlternative", name: "合成回收方案" });
  const alt = named("合成回收方案");
  assert.equal(alt.kind, "PartDefinition");
  assert.match(await model(), /variation part def <'ALT-\d+'> '合成回收方案' :> DesignAlternative/);
  await send("/variants", { id: alt.id, name: "單段傘" });
  await send("/variants", { id: named("合成回收方案").id, name: "雙段傘" });
  assert.ok(named("單段傘") && named("雙段傘"), "加得進候選");
  assert.match(await model(), /variant part <'ALT-\d+-001'> '單段傘';/);
  await send("/elements", { id: named("雙段傘").id, name: "雙段傘（含減速傘）" }, 200, "PATCH");
  assert.ok(named("雙段傘（含減速傘）"), "候選改得回去");
  await send("/elements/delete", { id: named("單段傘").id });
  assert.equal(named("單段傘"), undefined, "候選刪得掉");
  await send("/variants", { id: named("推進次系統", "PartDefinition").id, name: "不該成功" }, 400);
  await send("/elements/delete", { id: named("合成回收方案").id });
  assert.equal(named("合成回收方案"), undefined, "方案刪得掉");
});

test("介面：建立（兩端連接埠＋系統裡的介面）、改狀態、改數字、刪除連同連接埠", async () => {
  const sys = named("火箭", "PartDefinition");
  const pa = els().find((e) => e.kind === "PartUsage" && e.owner === sys.id && e.name === "推進");
  const pb = els().find((e) => e.kind === "PartUsage" && e.owner === sys.id && e.name === "回收");
  await send("/interfaces", { system: sys.id, a: pa.id, b: pb.id, name: "合成推進—回收接頭", kind: "機械", params: [{ name: "diameter", a: "100", b: "100", unit: "mm" }] });
  const iface = els().find((e) => e.kind === "InterfaceUsage" && e.name === "合成推進—回收接頭");
  assert.ok(iface, "建得出來");
  assert.equal(iface.category, "Interface");
  assert.equal(iface.attrs.kind, "機械");
  assert.equal(iface.attrs.maturity, "exists");
  assert.equal(els().filter((e) => e.kind === "PortUsage" && e.name === iface.shortName).length, 2, "兩端各一個連接埠");
  await send("/interfaces/status", { id: iface.id, maturity: "tentative", agreedA: "推進負責人", agreedB: "" });
  let f = els().find((e) => e.kind === "InterfaceUsage" && e.name === "合成推進—回收接頭");
  assert.equal(f.attrs.maturity, "tentative");
  assert.equal(f.attrs.agreedA, "推進負責人");
  await send("/interfaces/status", { id: f.id, maturity: "galaxy" }, 400);
  await send("/elements/attribute", { id: f.id, oldName: "diameterB", name: "diameterB", value: "98", unit: "mm" });
  f = els().find((e) => e.kind === "InterfaceUsage" && e.name === "合成推進—回收接頭");
  assert.match(f.attrs.diameterB, /^98/, "兩端數字改得回去");
  await send("/interfaces", { system: sys.id, a: pa.id, b: pa.id, name: "自己連自己", kind: "機械" }, 400);
  await send("/interfaces", { system: sys.id, a: pa.id, b: pb.id, name: "種類錯", kind: "魔法" }, 400);
  await send("/interfaces/delete", { id: f.id });
  assert.equal(els().find((e) => e.kind === "InterfaceUsage" && e.name === "合成推進—回收接頭"), undefined, "介面刪得掉");
  assert.equal(els().filter((e) => e.kind === "PortUsage" && e.name === iface.shortName).length, 0, "連接埠一起刪掉");
});
