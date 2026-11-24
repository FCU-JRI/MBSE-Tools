// WP3 框架接上：迴圈進度（FW-03）、卡點（FW-02）、兩個來源（FW-04）、是否被解決（FW-07）、是否符合需求（FW-08）、
// 節點的框架檢查（MGT-02）、專案設定（PRJ-05）。全部是合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFramework } from "./framework.ts";

const PORT = 18927, PUB = 18928; // WP3 指定的測試埠
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
let home = "";
let server: ChildProcess;
let v: any;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: { "content-type": "application/json", origin: I }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
const els = () => v.analysis.elements as any[];
const named = (n: string, kind?: string) => els().find((e) => e.name === n && (!kind || e.kind === kind));
const layer = (id: string) => v.framework.layers.find((l: any) => l.id === id);
const hold = (cat: string) => v.framework.holdPoints.find((h: any) => h.category === cat);
function on(pid: string) {
  const base = `${I}/api/projects/${pid}`;
  return {
    async send(p: string, body: unknown, want = 200, method = "POST") {
      const r = await call(`${base}${p}`, method, body);
      assert.equal(r.status, want, `${p} ${JSON.stringify(body).slice(0, 120)} → ${JSON.stringify(r.data).slice(0, 300)}`);
      if (r.data?.analysis) v = r.data;
      return r.data;
    },
    async load() { v = (await call(base)).data; return v; },
    /** 新增後立刻刪掉，回傳卡點警告（卡點只警告不擋，照常建立） */
    async probe(category: string, name: string): Promise<string | undefined> {
      const x = await call(`${base}/elements`, "POST", { category, name });
      assert.equal(x.status, 200, JSON.stringify(x.data).slice(0, 200));
      const e = x.data.analysis.elements.find((q: any) => q.name === name);
      assert.equal((await call(`${base}/elements/delete`, "POST", { id: e.id })).status, 200);
      await this.load();
      return x.data.holdWarning;
    },
  };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-wp3-"));
  await fs.writeFile(path.join(home, "config.json"), JSON.stringify({ sessionSecret: "synthetic-session-secret-for-tests", publicUrl: P }));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/nonexistent-gh" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 還沒起來 */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 500));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("畫面資料帶框架執行結果：7 層、每個系統與次系統各有迴圈進度、設定預設值來自框架檔", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "w3s", name: "WP3 範本", kind: "annual", template: "sample" })).status, 200);
  const s = on("w3s");
  await s.load();
  const f = loadFramework();
  assert.equal(v.framework.layers.length, f.layers.length);
  assert.deepEqual(v.framework.layers.map((l: any) => l.zh), f.layers.map((l) => l.zh));
  const sys = layer("system");
  assert.deepEqual(sys.objects.map((o: any) => o.name), ["火箭"]);
  assert.equal(sys.objects[0].current, "proposal", "沒有設計方案時停在設計提案");
  assert.equal(sys.objects[0].steps.length, f.layers.find((l) => l.id === "system")?.loopSteps?.length);
  assert.deepEqual(layer("subsystem").objects.map((o: any) => o.name).sort(), ["回收次系統", "推進次系統", "航電次系統"].sort());
  assert.equal(v.framework.settings.fmeaThreshold, f.settings.find((x) => x.id === "fmeaThreshold")?.default);
  assert.equal(v.framework.settings.minAlternatives, f.settings.find((x) => x.id === "minAlternatives")?.default);
  assert.equal("enforceHoldPoint" in v.framework.settings, false, "卡點只警告，沒有強制開關");
  // 舊 17 步仍在（相容）
  assert.equal(v.process.length, 17);
  // FW-04：範本的次系統需求沒有 #basis
  const t = v.framework.twoSources.find((x: any) => x.name.includes("總衝量"));
  assert.ok(t && t.missing.includes("basis") && /缺設計產出來源/.test(t.text));
  // MGT-02：節點帶框架檢查，既有 done／total 不變
  const pdr = v.gates.find((g: any) => g.id === "pdr");
  assert.ok(pdr.framework.some((c: any) => /次系統層級」設計迴圈走完/.test(c.label) && c.pass === false));
  assert.ok(v.gates.find((g: any) => g.id === "proposal").framework.length > 0);
});

test("專案設定：可改 FMEA 門檻、預算餘裕、最少候選數、負責人；不合法的值被拒絕", async () => {
  const s = on("w3s");
  const meta = (await call(`${I}/api/meta`)).data;
  assert.ok(meta.framework.settings.some((x: any) => x.id === "fmeaThreshold"));
  assert.ok(meta.framework.owners.some((x: any) => x.key === "system.loop" && x.default === "chiefEngineer"));
  await s.send("", { settings: { fmeaThreshold: 12, budgetMargin: 10, minAlternatives: 3, owners: { "subsystem.loop": "componentLead" } } }, 200, "PATCH");
  assert.equal(v.framework.settings.fmeaThreshold, 12);
  assert.equal(v.framework.settings.budgetMargin, 10);
  assert.equal(v.framework.settings.minAlternatives, 3);
  assert.equal(layer("subsystem").objects[0].steps.find((x: any) => x.id === "proposal").owner, "componentLead");
  assert.equal(layer("subsystem").objects[0].steps.find((x: any) => x.id === "meets").owner, "reviewer", "寫死角色的步驟不跟著改");
  await s.send("", { settings: { fmeaThreshold: 99 } }, 400, "PATCH");
  await s.send("", { settings: { owners: { "nope.step": "chiefEngineer" } } }, 400, "PATCH");
  await s.send("", { settings: { owners: { "subsystem.loop": "wizard" } } }, 400, "PATCH");
  // 改回預設：不存多餘的值
  await s.send("", { settings: { fmeaThreshold: 15, budgetMargin: null, minAlternatives: 2, owners: { "subsystem.loop": "" } } }, 200, "PATCH");
  assert.deepEqual(v.project.settings, {});
});

test("範本專案：系統迴圈沒過時新增次系統需求照常建立但有卡點警告；迴圈走完（含是否被解決、是否符合需求）警告消失", async () => {
  const s = on("w3s");
  let w = await s.probe("SubsystemRequirement", "合成試探甲");
  assert.match(w ?? "", /卡點警告/);
  assert.match(w ?? "", /系統層級/);
  assert.match(w ?? "", /火箭/);

  // 設計提案：方案追溯到系統需求（variation 裡不能放 satisfy）
  await s.send("/elements", { category: "DesignAlternative", name: "合成構型方案" });
  await s.send("/relations", { kind: "trace", from: named("合成構型方案").id, to: named("遠地點高度").id });
  await s.load();
  assert.equal(layer("system").objects[0].current, "tradeStudy");
  // 方案分析：兩個候選＋有理由的決策
  await s.send("/variants", { id: named("合成構型方案").id, name: "合成單節" });
  await s.send("/variants", { id: named("合成構型方案").id, name: "合成雙節" });
  await s.send("/elements", { category: "DesignDecision", name: "合成選單節", attrs: { rationale: "合成理由", decidedBy: "總工程師", decidedOn: "2026-01-01" } });
  await s.send("/relations", { kind: "trace", from: named("合成選單節").id, to: named("合成構型方案").id });
  await s.load();
  assert.equal(layer("system").objects[0].current, "fmea");
  // FMEA：S×O 達門檻且未緩解 → 是否被解決＝否
  await s.send("/elements", { category: "Risk", name: "合成失效", attrs: { failureMode: "合成", severity: "5", likelihood: "4" } });
  await s.send("/relations", { kind: "trace", from: named("合成失效").id, to: named("合成構型方案").id });
  await s.load();
  const o = layer("system").objects[0];
  assert.equal(o.current, "resolved");
  assert.match(o.steps.find((x: any) => x.id === "resolved").issues[0].text, /S×O＝20/);
  w = await s.probe("SubsystemRequirement", "合成試探乙");
  assert.match(w ?? "", /是否被解決|停在/);
  // 緩解後降到門檻以下 → 解決
  await s.send("/elements", { id: named("合成失效").id, attrs: { mitigation: "合成緩解", residualSeverity: "5", residualLikelihood: "1" } }, 200, "PATCH");
  await s.load();
  assert.equal(layer("system").objects[0].current, "cad");
  await s.send("/elements", { id: named("火箭", "PartDefinition").id, cad: { url: "https://cad.example.invalid/doc/9", version: "v1", tool: "合成" } }, 200, "PATCH");
  await s.load();
  const cur = layer("system").objects[0].current;
  // 範本的遠地點需求有可計算的條件：算得出值就到「是否符合需求」，不通過就停在那
  assert.ok(["meets", null].includes(cur), `目前在 ${cur}：${JSON.stringify(layer("system").objects[0].steps.filter((x: any) => x.state === "current"))}`);
  if (cur === "meets") {
    // 讓條件必定通過（合成值），證明「全 PASS＋無未合併分支」才判是
    const req = named("遠地點高度");
    await s.send("/elements/condition", { id: req.id, subject: named("火箭", "PartDefinition").id, attribute: "apogee", op: ">=", value: "0", unit: "m" });
    await s.load();
  }
  // 是否符合需求：條件改成必定不通過（合成值）→ 停在 meets、卡點關上；改回後放行
  await s.send("/elements/condition", { id: named("遠地點高度").id, subject: named("火箭", "PartDefinition").id, attribute: "apogee", op: ">=", value: "99999999", unit: "m" });
  await s.load();
  assert.equal(layer("system").objects[0].current, "meets");
  assert.match(layer("system").objects[0].steps.find((x: any) => x.id === "meets").issues[0].text, /不通過/);
  assert.equal(hold("SubsystemRequirement").open, false);
  await s.send("/elements/condition", { id: named("遠地點高度").id, subject: named("火箭", "PartDefinition").id, attribute: "apogee", op: ">=", value: "0", unit: "m" });
  await s.load();
  assert.equal(layer("system").objects[0].current, null, JSON.stringify(layer("system").objects[0].steps.filter((x: any) => x.state === "current")));
  assert.equal(layer("system").objects[0].passed, true);
  assert.equal(hold("SubsystemRequirement").open, true);
  // 範本只有一個系統，走完就全部走完 → 沒有警告
  assert.equal(await s.probe("SubsystemRequirement", "合成試探丙"), undefined, "迴圈走完後沒有卡點警告");
  assert.ok(v.gates.find((g: any) => g.id === "mdr").framework.find((c: any) => /系統層級」設計迴圈走完/.test(c.label)).pass);
  // 上一層多個對象：只要有一個沒走完就警告（加第二個系統，它的迴圈沒走）
  await s.send("/elements", { category: "System", name: "合成第二系統" });
  const w2 = await s.probe("SubsystemRequirement", "合成試探丁");
  assert.match(w2 ?? "", /1／2 個走完/);
  assert.match(w2 ?? "", /合成第二系統/);
});

test("流程範本：任務剖面迴圈沒過，系統需求照常建立但有卡點警告並說明原因；走完後警告消失；跳步不再擋", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "w3g", name: "WP3 流程", kind: "annual", template: "guided" })).status, 200);
  const g = on("w3g");
  await g.load();
  const add = async (body: any) => { await g.send("/elements", body); return named(body.name); };
  const link = (kind: string, a: any, b: any) => g.send("/relations", { kind, from: a.id, to: b.id });
  // 舊教學順序 1～9 步（相容）
  const stk = await add({ category: "Stakeholder", name: "合成主辦方" });
  const exp = await add({ category: "Expectation", name: "合成期望" }); await link("trace", exp, stk);
  const need = await add({ category: "Need", name: "合成需要" }); await link("trace", need, exp);
  const goal = await add({ category: "Goal", name: "合成目標" }); await link("derive", goal, need);
  const obj = await add({ category: "Objective", name: "合成目的 100 m" }); await link("derive", obj, goal);
  const moe = await add({ category: "MOE", name: "合成量度" }); await link("refine", moe, obj);
  await add({ category: "System", name: "合成火箭" });
  await add({ category: "ExternalEntity", name: "合成發射架" });
  const uc = await add({ category: "UseCase", name: "合成情境" }); await link("trace", uc, named("合成主辦方"));
  const m = await add({ category: "MissionPhase", name: "合成任務" });
  await g.send("/elements", { category: "MissionPhase", name: "合成甲", parentId: m.id });
  await g.send("/elements", { category: "MissionPhase", name: "合成乙", parentId: named("合成任務").id });
  await link("succession", named("合成甲"), named("合成乙"));
  assert.equal(v.process.find((x: any) => x.id === "sysreqs").state, "current", "舊順序已到系統層需求");

  // 卡點：任務剖面迴圈沒過
  const w = await g.probe("SystemRequirement", "合成試探");
  assert.match(w ?? "", /卡點警告/);
  assert.match(w ?? "", /任務剖面/);
  // 任務剖面迴圈：任務需求 → 方案（追溯到任務需求）→ 兩候選＋決策 → FMEA 無超門檻 → 產出
  const mr = await add({ category: "MissionRequirement", name: "合成任務需求" });
  const alt = await add({ category: "DesignAlternative", name: "合成剖面方案" });
  await link("trace", alt, mr);
  await g.send("/variants", { id: named("合成剖面方案").id, name: "合成剖面一" });
  await g.send("/variants", { id: named("合成剖面方案").id, name: "合成剖面二" });
  const dec = await add({ category: "DesignDecision", name: "合成剖面決策", attrs: { rationale: "合成", decidedBy: "總工程師", decidedOn: "2026-01-01" } });
  await link("trace", dec, named("合成剖面方案"));
  const risk = await add({ category: "Risk", name: "合成剖面風險", attrs: { failureMode: "合成", severity: "3", likelihood: "2" } });
  await link("trace", risk, named("合成剖面方案"));
  assert.equal(layer("missionProfile").objects[0].passed, true, JSON.stringify(layer("missionProfile").objects[0].steps.filter((x: any) => x.state === "current")));
  const made = await g.send("/elements", { category: "SystemRequirement", name: "合成系統需求" });
  assert.equal(made.holdWarning, undefined, "任務剖面迴圈走完後沒有卡點警告");
  const sr = named("合成系統需求");
  // FW-04：新的系統需求沒有 #basis → 標缺設計產出來源；補上後消失
  assert.ok(v.framework.twoSources.some((x: any) => x.id === sr.id && x.missing.includes("basis")));
  await link("basis", named("合成系統需求"), named("合成剖面決策"));
  await link("derive", named("合成系統需求"), named("合成任務需求"));
  assert.ok(!v.framework.twoSources.some((x: any) => x.name.includes("合成系統需求")));
  // 次系統需求：系統迴圈沒過（還沒有設計方案）→ 有警告
  assert.match(await g.probe("SubsystemRequirement", "合成次系統試探") ?? "", /卡點警告.*系統層級/);

});
