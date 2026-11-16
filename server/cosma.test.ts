// 第 C 期（F-82 到 F-89）：CoSMA 基礎庫、CoSMA 專案的判斷、五層的類別、範本、新增修改刪除與四種關係。測試資料全部是合成的。
// 執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, shutdown } from "./engine.ts";
import type { Source } from "./engine.ts";
import { frameworkSources } from "./projects.ts";
import { applyCosma, classify, COSMA_CATEGORIES, isCosmaProject } from "./cosma.ts";
import { verify } from "./reference.ts";
import type { Manifest } from "./reference.ts";
import { STEPS } from "./process.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const APOLLO = path.join(ROOT, "reference", "apollo-11-sysml-v2");
const LAYERS = ["purpose", "operational", "functional", "logical", "technical"];

async function readTree(dir: string): Promise<Source[]> {
  const out: Source[] = [];
  const walk = async (d: string, p: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      if (e.isDirectory()) await walk(path.join(d, e.name), `${p}${e.name}/`);
      else if (e.name.endsWith(".sysml")) out.push([p + e.name, await fs.readFile(path.join(d, e.name), "utf8")]);
    }
  };
  await walk(dir, "");
  return out.sort(([a], [b]) => a.localeCompare(b));
}
const jri = async (): Promise<Source> => ["JRI.sysml", await fs.readFile(path.join(ROOT, "library", "JRI.sysml"), "utf8")];
async function analyzeOwn(own: Source[]) {
  const fw = await frameworkSources(own.map(([, t]) => t));
  return analyze([await jri(), ...fw, ...own], fw.map(([n]) => n));
}

// ───────── 伺服器（自己的埠，不和 api.test.ts 共用） ─────────
const PORT = 18797, PUB = 18798;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-cosma-"));
  server = spawn(process.execPath, ["server/index.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  server?.kill();
  await shutdown();
  await new Promise((r) => setTimeout(r, 500));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

let v: any;
/** 同名時取有類別的（作業裡的 ref part 和利害關係人同名） */
const el = (name: string) => v.analysis.elements.find((e: any) => e.name === name && e.category) ?? v.analysis.elements.find((e: any) => e.name === name);
async function ok(pid: string, sub: string, method: string, body: unknown) {
  const r = await call(`${I}/api/projects/${pid}${sub}`, method, body);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 400));
  if (r.data.analysis) v = r.data;
  assert.equal(v.analysis.ok, true);
  return r;
}

// ───────── F-82 基礎庫 ─────────

test("F-82：library/cosma/ 和 Apollo 參考模型的 CoSMA 資料夾逐位元組相同，保留 MPL-2.0 授權", async () => {
  const manifest = JSON.parse(await fs.readFile(`${APOLLO}.manifest.json`, "utf8")) as Manifest;
  assert.equal(manifest.commit.slice(0, 7), "0e8a7d6");
  const cosma: Manifest = { ...manifest, files: Object.fromEntries(Object.entries(manifest.files).filter(([f]) => f.startsWith("CoSMA/")).map(([f, h]) => [f.slice(6), h])) };
  assert.equal(Object.keys(cosma.files).length, 3);
  const dir = path.join(ROOT, "library", "cosma");
  assert.deepEqual(await verify(cosma, (rel) => path.join(dir, rel)), []);
  assert.match(await fs.readFile(path.join(dir, "LICENSE.md"), "utf8"), /Mozilla Public License Version 2\.0/);
  for (const f of Object.keys(cosma.files)) assert.match(await fs.readFile(path.join(dir, f), "utf8"), /Copyright \(c\) 2026 AIRBUS[\s\S]{0,200}Mozilla Public/);
});

// ───────── F-83 適用範圍 ─────────

test("F-83：JRI 的範本（sounding-rocket）判斷為非 CoSMA，不載入基礎庫，解析結果沒有任何 CoSMA 的類別或層", async () => {
  const own: Source[] = [["model.sysml", await fs.readFile(path.join(ROOT, "templates", "sounding-rocket", "model.sysml"), "utf8")]];
  assert.deepEqual(await frameworkSources(own.map(([, t]) => t)), []);
  const a = await analyzeOwn(own);
  assert.equal(a.ok, true);
  assert.equal(isCosmaProject(a), false);
  assert.equal(applyCosma(a), false);
  assert.ok(a.elements.every((e) => e.layer === undefined && !(e.category ?? "").startsWith("CoSMA.")));
  assert.ok(a.elements.some((e) => e.category === "SystemRequirement"));
});

test("F-83：用 JRI 範本建的專案，畫面資料照舊（非 CoSMA、流程是 NASA 的步驟）；不能新增 CoSMA 的元素", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "jri1", name: "JRI 範本", kind: "annual", template: "sample" })).status, 200);
  v = (await call(`${I}/api/projects/jri1`)).data;
  assert.equal(v.cosma, false);
  assert.deepEqual(v.process.map((s: any) => s.id), STEPS.map((s) => s.id));
  assert.ok(v.analysis.elements.every((e: any) => e.layer === undefined));
  const files = (await call(`${I}/api/projects/jri1/files`)).data;
  assert.deepEqual(files, ["model.sysml"]);
  await assert.rejects(fs.stat(path.join(home, "projects", "jri1", "lib", "cosma")));
  const r = await call(`${I}/api/projects/jri1/elements`, "POST", { category: "CoSMA.Function", name: "X" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /還沒有轉成 CoSMA/);
});

// ───────── F-86 範本 ─────────

test("F-86：CoSMA 範本照 Apollo 的資料夾與套件，可以解析；五層都有元素；MOE、MOP 是標記過的需求定義並細化到需求", async () => {
  const own = await readTree(path.join(ROOT, "templates", "cosma"));
  for (const d of ["Program", "Purpose", "Requirements", "Operation", "Function", "Logical", "Technical"]) assert.ok(own.some(([f]) => f.startsWith(`${d}/`)), `缺少資料夾 ${d}`);
  const apollo = new Set((await readTree(APOLLO)).map(([f]) => path.basename(f)));
  for (const [f] of own) if (f !== "Model.sysml") assert.ok(apollo.has(path.basename(f)) || f === "Execution/MissionExecutionPackage.sysml", `${f} 不是 Apollo 的套件名稱`);
  const a = await analyzeOwn(own);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 3)));
  assert.equal(isCosmaProject(a), true);
  for (const l of LAYERS) assert.ok(a.elements.some((e) => e.layer === l && e.category), `${l} 沒有元素`);
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  for (const [cat, target] of [["CoSMA.MOE", "CoSMA.MissionRequirement"], ["CoSMA.MOP", "CoSMA.TechnicalRequirement"]]) {
    const m = a.elements.filter((e) => e.category === cat);
    assert.equal(m.length, 1);
    assert.equal(m[0].kind, "RequirementDefinition");
    assert.ok(a.relations.some((r) => r.kind === "refine" && r.from === m[0].id && byId.get(r.to)?.category === target));
  }
  // 範本的內容只有合成的示範：不帶 rtc-2027 或真實的設計名稱
  for (const [, t] of own) assert.doesNotMatch(t, /rtc-2027|RTC|2027/);
});

// ───────── F-84 Apollo 每個元素都歸類 ─────────

test("F-84：Apollo 參考模型的每個具名元素都歸到五層之一，或標為基礎庫；模型的根套件 Apollo11Model 歸 Purpose", async () => {
  const a = await analyze(await readTree(APOLLO));
  assert.equal(a.ok, true);
  assert.equal(a.elements.length, 2188);
  assert.equal(isCosmaProject(a), true);
  // 解析時（engine 的 applyCosma）已經寫上層；和直接呼叫 classify（含沒有名字的使用，樹才接得起來）結果相同
  const places = classify([...a.elements, ...a.unnamed]);
  assert.ok(a.elements.every((e) => e.layer === places.get(e.id)?.place));
  const outside = a.elements.filter((e) => ![...LAYERS, "library", "addon"].includes(e.layer ?? ""));
  assert.deepEqual(outside.map((e) => `${e.kind} ${e.qualifiedName}`), []);
  assert.equal(a.elements.find((e) => e.qualifiedName === "Apollo11Model")?.layer, "purpose");
  assert.equal(a.elements.filter((e) => e.layer === "library").length, 90);
  for (const l of LAYERS) assert.ok(a.elements.some((e) => e.layer === l), `${l} 沒有元素`);
  // 需求定義依套件分成任務、功能、技術需求與需要
  const count = (c: string) => a.elements.filter((e) => e.category === c).length;
  assert.equal(count("CoSMA.MissionRequirement"), 43);
  assert.equal(count("CoSMA.FunctionalRequirement"), 112);
  assert.equal(count("CoSMA.TechnicalRequirement"), 117);
  assert.equal(count("CoSMA.StakeholderNeed"), 22);
  // 每個類別都對應到 Apollo 裡至少一個元素（MOE、MOP 是 JRI 的附加庫，Apollo 沒有）
  for (const c of COSMA_CATEGORIES) if (!["CoSMA.MOE", "CoSMA.MOP"].includes(c.id)) assert.ok(count(c.id) > 0, `Apollo 沒有 ${c.id}`);
});

// ───────── F-85 新增、修改、刪除；四種關係 ─────────

test("F-85：CoSMA 範本建專案；五層各新增、修改、刪除一個元素，每一步模型都能解析", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "c1", name: "CoSMA 合成", kind: "annual", template: "cosma" })).status, 200);
  v = (await call(`${I}/api/projects/c1`)).data;
  assert.equal(v.cosma, true);
  assert.equal(v.analysis.ok, true);
  assert.equal(v.process[0].id, "c-stakeholders");
  assert.ok((await fs.readdir(path.join(home, "projects", "c1", "lib", "cosma"))).includes("CoSMAPackage.sysml"));
  const cases: [string, string, string][] = [
    ["purpose", "CoSMA.MissionRequirement", "ReachOrbitTest"],
    ["operational", "CoSMA.Operation", "RecoverVehicle"],
    ["functional", "CoSMA.Function", "DeployParachute"],
    ["logical", "CoSMA.LogicalComponent", "RecoveryChain"],
    ["technical", "CoSMA.TechnicalComponent", "DemoParachute"],
  ];
  for (const [layer, category, name] of cases) {
    await ok("c1", "/elements", "POST", { category, name, doc: "合成的示範項目。" });
    const made = el(name);
    assert.ok(made, `${name} 沒有建立`);
    assert.equal(made.category, category);
    assert.equal(made.layer, layer);
    await ok("c1", "/elements", "PATCH", { id: made.id, name: `${name}2`, doc: "改過的說明。" });
    const changed = el(`${name}2`);
    assert.ok(changed);
    assert.equal(changed.doc, "改過的說明。");
    await ok("c1", "/elements/delete", "POST", { id: changed.id });
    assert.equal(el(`${name}2`), undefined);
  }
  // 編號照 Apollo：前綴直接接三位數字
  await ok("c1", "/elements", "POST", { category: "CoSMA.MissionRequirement", name: "SecondRequirement" });
  assert.equal(el("SecondRequirement").shortName, "HLR-R002");
});

test("F-85：Concern 放在利害關係人裡、Goal 放在任務裡；MOE 是標上 #moe 的需求定義", async () => {
  const r = await call(`${I}/api/projects/c1/elements`, "POST", { category: "CoSMA.Concern", name: "noise" });
  assert.equal(r.status, 400);
  await ok("c1", "/elements", "POST", { category: "CoSMA.Concern", name: "noise", doc: "噪音不得影響附近居民。", parentId: el("launchTeam").id });
  assert.equal(el("noise").owner, el("launchTeam").id);
  assert.equal(el("noise").category, "CoSMA.Concern");
  await ok("c1", "/elements", "POST", { category: "CoSMA.Goal", name: "recoverIntact", parentId: el("DemoMission").id });
  assert.equal(el("recoverIntact").owner, el("DemoMission").id);
  await ok("c1", "/elements", "POST", { category: "CoSMA.MOE", name: "RecoveryRate" });
  const moe = el("RecoveryRate");
  assert.equal(moe.kind, "RequirementDefinition");
  assert.equal(moe.shortName, "MOE-002");
  assert.ok(moe.tags.includes("MeasureOfEffectiveness"));
  const text = (await call(`${I}/api/projects/c1/files/Requirements/MissionRequirementsPackage.sysml`)).data.content as string;
  assert.match(text, /#moe requirement def <'MOE-002'> RecoveryRate;/);
});

test("F-85：四種關係（細化、滿足、執行、特化）與作業的參與者都能建立，寫法照 Apollo", async () => {
  const id = (n: string) => el(n).id;
  const rel = (kind: string, from: string, to: string) => ok("c1", "/relations", "POST", { kind, from: id(from), to: id(to) });
  await rel("refine", "SecondRequirement", "SuborbitalLaunch");
  assert.ok(v.analysis.relations.some((r: any) => r.kind === "refine" && r.from === id("SecondRequirement") && r.to === id("SuborbitalLaunch")));
  const req = (await call(`${I}/api/projects/c1/files/Requirements/MissionRequirementsPackage.sysml`)).data.content as string;
  assert.match(req, /#refinement dependency 'HLR-R002' to CapabilitiesPackage::SuborbitalLaunch;/);

  await rel("satisfy", "DemoMissionSystem", "SecondRequirement");
  const spec = (await call(`${I}/api/projects/c1/files/Technical/SystemSpecificationPackage.sysml`)).data.content as string;
  assert.match(spec, /requirement 'hlr-R002' : MissionRequirementsPackage::SecondRequirement;/);
  assert.match(spec, /satisfy 'hlr-R002' by demoMissionSystem;/);
  assert.ok(v.analysis.relations.filter((r: any) => r.kind === "satisfy").length >= 3);

  await ok("c1", "/elements", "POST", { category: "CoSMA.Function", name: "TransmitTelemetry" });
  await rel("perform", "PropulsionChain", "TransmitTelemetry");
  // 執行的連結：起點是邏輯元件，終點是以功能為型別的 perform action
  const performs = v.analysis.links.filter((l: any) => l.kind === "perform" && l.from === id("PropulsionChain")).map((l: any) => v.analysis.elements.find((e: any) => e.id === l.to));
  assert.ok(performs.some((p: any) => p?.typeIds.includes(id("TransmitTelemetry"))));

  await ok("c1", "/elements", "POST", { category: "CoSMA.TechnicalComponent", name: "DemoMotorB" });
  await rel("specialize", "DemoMotorB", "DemoMotor");
  assert.ok(v.analysis.links.some((l: any) => l.kind === "specialize" && l.from === id("DemoMotorB") && l.to === id("DemoMotor")));
  assert.equal(el("DemoMotorB").category, "CoSMA.TechnicalComponent");

  await ok("c1", "/elements", "POST", { category: "CoSMA.Operation", name: "TrackVehicle" });
  await rel("participant", "TrackVehicle", "competitionOrganizer");
  const part = v.analysis.elements.find((e: any) => e.owner === id("TrackVehicle") && e.name === "competitionOrganizer");
  assert.ok(part);
  assert.ok((part.keyword as string).startsWith("ref"));

  // JRI 的關係（衍生、分配）在 CoSMA 專案不能用
  const bad = await call(`${I}/api/projects/c1/relations`, "POST", { kind: "derive", from: id("SecondRequirement"), to: id("ReachTargetAltitude") });
  assert.equal(bad.status, 400);
});

test("F-88：CoSMA 專案的流程引導照五層排；範本本身已經走完的步驟是完成", async () => {
  v = (await call(`${I}/api/projects/c1`)).data;
  const layers = v.process.map((s: any) => s.nasa);
  assert.ok(layers.includes("Purpose") && layers.includes("Operational") && layers.includes("Functional") && layers.includes("Logical") && layers.includes("Technical"));
  for (const s of ["c-stakeholders", "c-needs", "c-mission", "c-goals", "c-context", "c-phases", "c-logical", "c-specs"]) assert.equal(v.process.find((x: any) => x.id === s).state, "done", s);
  // 新加的作業沒有參與者以外，TrackVehicle 已經有參與者，不會出現在問題裡
  assert.ok(!v.process.find((x: any) => x.id === "c-operations").issues.some((i: any) => /TrackVehicle/.test(i.text)));
  const meta = (await call(`${I}/api/meta`)).data;
  assert.equal(meta.cosma.categories.length, COSMA_CATEGORIES.length);
  assert.deepEqual(Object.keys(meta.cosma.layers), LAYERS);
  // JRI 的類別清單沒有變
  assert.ok(meta.categories.every((c: any) => !c.id.startsWith("CoSMA.")));
});
