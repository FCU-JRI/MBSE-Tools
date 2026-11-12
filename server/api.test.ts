// 端對端測試：啟動一個用暫存資料夾的伺服器，走過主要流程。
// 執行：npm test
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 18787, PUB = 18788;
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
let server: ChildProcess;
let home: string;

type Res = { status: number; data: any; cookies: string[]; location: string | null };
async function call(url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const r = await fetch(url, { method, redirect: "manual", headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON 回應保留原文 */ }
  return { status: r.status, data, cookies: r.headers.getSetCookie(), location: r.headers.get("location") };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-test-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

let v: any;
const find = (name: string, kind?: string) => v.analysis.elements.find((e: any) => e.name === name && (!kind || e.kind === kind));
async function ok(path: string, method: string, body: unknown) {
  const r = await call(`${I}/api/projects/t1${path}`, method, body);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  if (r.data.analysis) v = r.data;
  return r;
}

test("建立專案，範本模型可解析且各類別齊全", async () => {
  const r = await call(`${I}/api/projects`, "POST", { id: "t1", name: "測試專案", kind: "annual" });
  assert.equal(r.status, 200);
  v = (await call(`${I}/api/projects/t1`)).data;
  assert.equal(v.analysis.ok, true);
  for (const c of ["Stakeholder", "Need", "Goal", "Objective", "MOE", "SystemRequirement", "SubsystemRequirement", "System", "Subsystem", "MissionPhase", "UseCase", "Mode", "VerificationEvent", "Risk"]) {
    assert.ok(v.analysis.elements.some((e: any) => e.category === c), `缺少類別 ${c}`);
  }
  const kinds = new Set(v.analysis.relations.map((x: any) => x.kind));
  for (const k of ["derive", "refine", "trace", "satisfy", "verify", "succession", "transition"]) assert.ok(kinds.has(k), `缺少關係 ${k}`);
  assert.equal(v.gates.length, 8);
  assert.equal(v.gates[0].done, v.gates[0].total, "範本應通過計畫提案的所有檢查");
});

test("需求的數值條件會帶單位自動判定", () => {
  const s = v.analysis.satisfaction.find((x: any) => x.requirement.endsWith("遠地點高度"));
  assert.equal(s?.status, "holds");
});

test("新增元素並自動編號", async () => {
  await ok("/elements", "POST", { category: "SafetyFactor", name: "燃燒室爆破安全係數", doc: "依 NASA-STD-5012B。", attrs: { required: "2", actual: "2.4", basis: "水壓測試" } });
  const e = find("燃燒室爆破安全係數");
  assert.equal(e.shortName, "FOS-001");
  assert.deepEqual([e.attrs.required, e.attrs.actual], ["2.0", "2.4"]);
});

test("修改名稱、說明與屬性；改名會更新引用處", async () => {
  await ok("/elements", "PATCH", { id: find("遠地點高度").id, name: "遠地點", doc: "火箭應到達 3000 m ± 200 m 的遠地點高度。" });
  const e = find("遠地點");
  assert.match(e.doc, /200 m/);
  assert.ok(v.analysis.relations.some((x: any) => x.kind === "verify" && x.to === e.id));
  await ok("/elements", "PATCH", { id: find("降落傘未展開").id, attrs: { severity: "4", mitigation: "" } });
  assert.equal(find("降落傘未展開").attrs.severity, "4");
  assert.equal(find("降落傘未展開").attrs.mitigation, undefined);
  await ok("/elements", "PATCH", { id: find("回收次系統", "PartDefinition").id, name: "回收與降落次系統" });
  assert.deepEqual(find("回收", "PartUsage").types, ["回收與降落次系統"]);
});

test("圖上的操作：加入零件、連接、先後、狀態轉換、使用案例參與者", async () => {
  await ok("/elements", "POST", { category: "Component", name: "飛行電腦" });
  await ok("/relations", "POST", { kind: "compose", from: find("航電次系統", "PartDefinition").id, to: find("飛行電腦", "PartDefinition").id });
  assert.ok(find("飛行電腦", "PartUsage"));
  await ok("/relations", "POST", { kind: "connect", from: find("推進", "PartUsage").id, to: find("航電", "PartUsage").id });
  assert.equal(v.analysis.relations.filter((x: any) => x.kind === "connect").length, 1);
  await ok("/elements", "POST", { category: "MissionPhase", name: "開傘", parentId: find("任務").id });
  await ok("/relations", "POST", { kind: "succession", from: find("滑行").id, to: find("開傘").id });
  await ok("/elements", "POST", { category: "Mode", name: "異常中止", parentId: find("飛行模式").id });
  const before = v.analysis.relations.filter((x: any) => x.kind === "transition").length;
  await ok("/relations", "POST", { kind: "transition", from: find("上升").id, to: find("異常中止").id });
  assert.equal(v.analysis.relations.filter((x: any) => x.kind === "transition").length, before + 1);
  await ok("/relations", "POST", { kind: "trace", from: find("尋回火箭").id, to: find("競賽主辦方").id });
});

test("不合法的操作會被拒絕且不寫入", async () => {
  const head = (await call(`${I}/api/projects/t1/history`)).data[0].commit;
let r = await call(`${I}/api/projects/t1/files/model.sysml`, "PUT", { content: "package Project { part def }" });
  assert.equal(r.status, 422);
  assert.ok(r.data.diagnostics.length > 0);
  r = await call(`${I}/api/projects/t1/relations`, "POST", { kind: "succession", from: find("滑行").id, to: find("推進", "PartUsage").id });
  assert.equal(r.status, 400);
  assert.equal((await call(`${I}/api/projects/t1/history`)).data[0].commit, head);
});

test("刪除元素會連同關係一起移除，模型仍合法", async () => {
  const id = find("遠地點").id;
  await ok("/elements/delete", "POST", { id });
  assert.equal(find("遠地點"), undefined);
  assert.equal(v.analysis.ok, true);
  assert.ok(!v.analysis.relations.some((x: any) => x.from === id || x.to === id));
});

test("簽核權限依 AEAS：總工程師不能核可 TRR，可以核可計畫提案", async () => {
  let r = await call(`${I}/api/projects/t1/signoffs`, "POST", { gate: "trr", decision: "APPROVE" });
  assert.equal(r.status, 400);
  r = await call(`${I}/api/projects/t1/signoffs`, "POST", { gate: "proposal", decision: "APPROVE", comment: "ok" });
  assert.equal(r.status, 200);
  assert.equal(r.data.project.signoffs.length, 1);
  assert.match(r.data.project.signoffs[0].role, /D-VII/);
});

test("Excel 匯出", async () => {
  const r = await fetch(`${I}/api/projects/t1/export.xlsx`);
  assert.equal(r.status, 200);
  assert.ok((await r.arrayBuffer()).byteLength > 10_000);
});

test("公開埠：未登入一律被擋，偽造標頭無效", async () => {
  assert.equal((await call(`${P}/api/me`)).data.user, null);
  for (const [m, p] of [["GET", "/api/projects"], ["GET", "/api/projects/t1"], ["GET", "/api/admin/members"], ["GET", "/api/projects/t1/export.xlsx"]] as const) {
    assert.equal((await call(P + p, m)).status, 401, p);
  }
  assert.equal((await call(`${P}/api/projects/t1/elements`, "POST", { category: "Need", name: "x" })).status, 401);
  assert.equal((await call(`${P}/api/projects`, "GET", undefined, { "tailscale-user-login": "a@b.c", "x-author": "x" })).status, 401);
});

test("唯讀連結：可看可匯出，不能改，不能看其他專案，可撤銷", async () => {
  const made = await call(`${I}/api/admin/shares`, "POST", { project: "t1", label: "審查委員", days: 7 });
  assert.equal(made.status, 200);
  const opened = await call(P + made.data.path);
  assert.equal(opened.status, 302);
  const cookie = opened.cookies.map((c) => c.split(";")[0]).join("; ");
  assert.match(opened.cookies.join(";"), /HttpOnly/);
  assert.equal((await call(`${P}/api/projects/t1`, "GET", undefined, { cookie })).status, 200);
  assert.equal((await call(`${P}/api/projects/t1/export.xlsx`, "GET", undefined, { cookie })).status, 200);
  assert.equal((await call(`${P}/api/projects/t1/elements`, "POST", { category: "Need", name: "x" }, { cookie })).status, 403);
  assert.equal((await call(`${P}/api/projects/t1/signoffs`, "POST", { gate: "mdr", decision: "APPROVE" }, { cookie })).status, 403);
  assert.equal((await call(`${P}/api/projects/other`, "GET", undefined, { cookie })).status, 403);
  assert.equal((await call(`${P}/api/admin/members`, "GET", undefined, { cookie })).status, 403);
  // 竄改簽章中段的一個字元（最後一個字元含填充位元，改了可能解出相同的簽章）
  const mid = cookie.length - 20;
  const tampered = cookie.slice(0, mid) + (cookie[mid] === "A" ? "B" : "A") + cookie.slice(mid + 1);
  assert.equal((await call(`${P}/api/projects/t1`, "GET", undefined, { cookie: tampered })).status, 401);
  await call(`${I}/api/admin/shares/delete`, "POST", { id: made.data.share.id });
  assert.equal((await call(`${P}/api/projects/t1`, "GET", undefined, { cookie })).status, 401);
  assert.equal((await call(`${P}/s/not-a-token`)).status, 404);
});

test("跨站寫入請求被拒絕", async () => {
  const r = await call(`${I}/api/projects/t1/elements`, "POST", { category: "Need", name: "x" }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
});

test("多檔案：元素寫回它所在的檔案", async () => {
  const extra = `package Project_Extra {
    private import JRI::*;
    part def <'CMP-900'> '遙測發射機' :> Component;
}
`;
  let r = await call(`${I}/api/projects/t1/files/extra.sysml`, "PUT", { content: extra });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  v = (await call(`${I}/api/projects/t1`)).data;
  const e = find("遙測發射機");
  assert.equal(e.file, "extra.sysml");
  await ok("/elements", "PATCH", { id: e.id, doc: "S 頻段遙測。" });
  assert.match((await call(`${I}/api/projects/t1/files/extra.sysml`)).data.content, /S 頻段遙測/);
  assert.doesNotMatch((await call(`${I}/api/projects/t1/files/model.sysml`)).data.content, /S 頻段遙測/);
});

test("共用元件庫：所有專案可見，專案內唯讀", async () => {
  const lib = `package SharedAvionics {
    private import JRI::*;
    part def <'AVX-001'> '共用飛行電腦' :> Component;
}
`;
  let r = await call(`${I}/api/shared/shared-avionics.sysml`, "PUT", { content: lib });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call(`${I}/api/shared/shared-avionics.sysml`, "PUT", { content: "package Broken { part def }" });
  assert.equal(r.status, 422);
  v = (await call(`${I}/api/projects/t1`)).data;
  const e = find("共用飛行電腦");
  assert.equal(e.shared, true);
  r = await call(`${I}/api/projects/t1/elements`, "PATCH", { id: e.id, name: "改名" });
  assert.equal(r.status, 400);
  r = await call(`${I}/api/projects/t1/elements/delete`, "POST", { id: e.id });
  assert.equal(r.status, 400);
  // 專案可以把共用元件放進自己的結構
  await ok("/relations", "POST", { kind: "compose", from: find("航電次系統", "PartDefinition").id, to: e.id });
  assert.ok(find("共用飛行電腦", "PartUsage"));
});

import { execFileSync } from "node:child_process";
const gitIn = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=成員", "-c", "user.email=m@jri.local", ...args], { cwd: dir, encoding: "utf8" });

test("分支審查：合法的分支可合併，有錯誤的分支被標示且不能合併", async () => {
  const dir = path.join(home, "projects", "t1");
  const model = path.join(dir, "model", "model.sysml");
  const original = await fs.readFile(model, "utf8");

  gitIn(dir, "checkout", "-q", "-b", "feature/add-req");
  await fs.writeFile(model, original.replace("package Requirements {", "package Requirements {\n        requirement <'REQ-SYS-777'> '分支新增的需求' : SystemRequirement { doc /* 由分支加入。 */ }"), "utf8");
  gitIn(dir, "commit", "-qam", "分支：新增需求");
  gitIn(dir, "checkout", "-q", "main");
  gitIn(dir, "checkout", "-q", "-b", "feature/broken");
  await fs.writeFile(model, original + "\npackage Oops { part def }\n", "utf8");
  gitIn(dir, "commit", "-qam", "分支：壞掉的模型");
  gitIn(dir, "checkout", "-q", "main");

  const list = (await call(`${I}/api/projects/t1/branches`)).data;
  const good = list.find((b: any) => b.name === "feature/add-req"), bad = list.find((b: any) => b.name === "feature/broken");
  assert.equal(good.ok, true);
  assert.equal(bad.ok, false);
  assert.ok(bad.firstError.length > 0);

  const d = (await call(`${I}/api/projects/t1/branches/diff?name=feature/add-req`)).data;
  assert.match(d.diff, /REQ-SYS-777/);
  assert.ok(d.changes.some((c: any) => c.type === "added" && c.key === "REQ-SYS-777"));

  let r = await call(`${I}/api/projects/t1/branches/merge`, "POST", { name: "feature/broken" });
  assert.equal(r.status, 400);
  assert.equal((await call(`${I}/api/projects/t1`)).data.analysis.ok, true, "失敗的合併不應影響 main");
  r = await call(`${I}/api/projects/t1/branches/merge`, "POST", { name: "feature/add-req" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(r.data.analysis.elements.some((e: any) => e.shortName === "REQ-SYS-777"));
});

test("基線比較：列出節點核可後的變更", async () => {
  const list = (await call(`${I}/api/projects/t1/baselines`)).data;
  assert.ok(list.length >= 2);
  const base = list.find((b: any) => b.ref.startsWith("baseline/proposal"));
  const r = await call(`${I}/api/projects/t1/compare?from=${encodeURIComponent(base.ref)}&to=HEAD`);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(r.data.changes.some((c: any) => c.type === "added" && c.key === "REQ-SYS-777"));
  assert.equal((await call(`${I}/api/projects/t1/compare?from=HEAD&to=--upload-pack=x`)).status, 400);
});

test("GitHub 儲存庫網址只接受 github.com", async () => {
  assert.equal((await call(`${I}/api/projects/t1/remote`, "POST", { url: "ext::sh -c whoami" })).status, 400);
  assert.equal((await call(`${I}/api/projects/t1/sync`)).data.remote, "");
});

test("專案管理：任務、成本、人員；優先級依職級限制", async () => {
  const base = `${I}/api/projects/t1/pm`;
  let r = await call(`${base}/tasks`, "POST", { title: "完成 MDR 文件", priority: "P2", re: "王小明", start: "2026-09-01", end: "2026-09-14", gate: "mdr", links: ["REQ-SYS-777"] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.tasks[0].id, "J1");
  r = await call(`${base}/tasks`, "POST", { title: "不可能的優先級", priority: "P1", start: "2026-09-01", end: "2026-09-02" });
  assert.equal(r.status, 400, "總工程師（7 級）不能設定 P1");
  r = await call(`${base}/tasks`, "POST", { title: "日期顛倒", start: "2026-09-10", end: "2026-09-01" });
  assert.equal(r.status, 400);
  r = await call(`${base}/tasks`, "POST", { title: "靜態推力測試", start: "2026-12-01", end: "2026-12-05", deps: ["J1"] });
  assert.equal(r.data.tasks.length, 2);
  assert.equal((await call(`${base}/tasks/delete`, "POST", { id: "J1" })).status, 400, "被相依的任務不能刪");
  r = await call(`${base}/costs`, "POST", { item: "氧化劑", subsystem: "推進次系統", planned: 12000, actual: 13500 });
  assert.equal(r.data.costs[0].actual, 13500);
  assert.equal((await call(`${base}/costs`, "POST", { item: "x", planned: -5 })).status, 400);
  r = await call(`${base}/people`, "POST", { name: "王小明", rank: "O-V", subsystem: "推進次系統", duty: "推進組責任工程師" });
  assert.equal(r.data.people.length, 1);
  const v2 = (await call(`${I}/api/projects/t1`)).data;
  const gantt = v2.gates.find((g: any) => g.id === "mdr").checks.find((c: any) => c.id === "mdr.gantt");
  assert.equal(gantt.pass, true, "有任務後 MDR 的甘特圖檢查應自動通過");
});

test("飛行模擬：執行、結果回寫模型後需求重新判定、OpenRocket 匯出再匯入", { skip: !process.env.JRI_PYTHON && "未設定 JRI_PYTHON，略過模擬測試" }, async () => {
  await call(`${I}/api/projects`, "POST", { id: "t2", name: "模擬測試", kind: "annual" });
  const base = `${I}/api/projects/t2/sim`;
  let s = (await call(base)).data;
  assert.equal(s.available.ok, true);
  assert.equal((await call(`${base}/inputs`, "PUT", { inputs: { ...s.inputs, rocket: { ...s.inputs.rocket, radius_m: 65 } } })).status, 400, "把公釐當公尺應被擋下");
  const curve = (await call(`${base}/thrust`, "POST", { text: "; test\nJ1 98 700 0 3.9 6.5 JRI\n0.1 2400\n3.0 2100\n3.9 0\n;" })).data.curve;
  assert.deepEqual(curve[0], [0.1, 2400]);
  const run = await call(`${base}/run`, "POST", {});
  assert.equal(run.status, 200, JSON.stringify(run.data).slice(0, 300));
  const apogee = run.data.result.outputs.find((o: any) => o.key === "apogee").value;
  assert.ok(apogee > 1000 && apogee < 10000, `遠地點 ${apogee} 不合理`);
  assert.match(run.data.result.engine, /RocketPy/);
  // 範本的需求是 3000 ± 150 m；模擬值寫回後應重新判定
  const ap = await call(`${base}/apply`, "POST", { bindings: [{ output: "apogee", element: "Project::Structure::rocket", attribute: "apogee" }] });
  assert.equal(ap.status, 200, JSON.stringify(ap.data).slice(0, 300));
  const rocket = ap.data.analysis.elements.find((e: any) => e.qualifiedName === "Project::Structure::rocket");
  assert.match(rocket.attrs.apogee, new RegExp(String(apogee).slice(0, 6)));
  const verdict = ap.data.analysis.satisfaction.find((x: any) => x.requirement.endsWith("遠地點高度")).status;
  assert.equal(verdict, apogee >= 2850 && apogee <= 3150 ? "holds" : "fails");
  assert.equal((await call(`${base}/apply`, "POST", { bindings: [{ output: "apogee", element: "Project::Structure::rocket", attribute: "nope" }] })).status, 400);

  const ork = Buffer.from(await (await fetch(`${base}/export.ork`)).arrayBuffer());
  assert.equal(ork.subarray(0, 2).toString(), "PK");
  s = (await call(base)).data;
  await call(`${base}/inputs`, "PUT", { inputs: { ...s.inputs, fins: { ...s.inputs.fins, n: 3, span_m: 0.2 }, nose: { ...s.inputs.nose, length_m: 0.4 } } });
  const imp = await call(`${base}/import-ork`, "POST", { base64: ork.toString("base64") });
  assert.equal(imp.status, 200, JSON.stringify(imp.data).slice(0, 300));
  assert.equal(imp.data.sim.inputs.fins.n, 4);
  assert.equal(imp.data.sim.inputs.fins.span_m, 0.13);
  assert.equal(imp.data.sim.inputs.nose.length_m, 0.55);
  assert.equal((await call(`${base}/import-ork`, "POST", { base64: Buffer.from("not a rocket").toString("base64") })).status, 400);
});

test("審查報告：網頁版含圖與表，Word 版可下載，內容有跳脫", async () => {
  await call(`${I}/api/projects`, "POST", { id: "t3", name: "報告 <b>測試</b>", kind: "annual" });
  const html = await (await fetch(`${I}/api/projects/t3/report?gate=cdr`)).text();
  assert.match(html, /關鍵設計審查/);
  assert.match(html, /需求驗證矩陣/);
  assert.match(html, /REQ-SYS-001/);
  assert.ok((html.match(/<svg/g) ?? []).length >= 3, "應內嵌結構、需求、活動等圖");
  assert.ok(!html.includes("<b>測試</b>"), "專案名稱必須跳脫");
  assert.match(html, /報告 &lt;b&gt;測試&lt;\/b&gt;/);
  const docx = await fetch(`${I}/api/projects/t3/report?gate=cdr&format=docx`);
  assert.equal(docx.status, 200);
  const buf = Buffer.from(await docx.arrayBuffer());
  assert.equal(buf.subarray(0, 2).toString(), "PK");
  assert.ok(buf.length > 8000);
});

test("封存專案：名稱不符不動作，封存後從列表消失且資料保留", async () => {
  await call(`${I}/api/projects`, "POST", { id: "t9", name: "要封存的", kind: "annual" });
  assert.equal((await call(`${I}/api/projects/t9/archive`, "POST", { confirm: "打錯" })).status, 400);
  assert.equal((await call(`${I}/api/projects/t9`)).status, 200);
  assert.equal((await call(`${I}/api/projects/t9/archive`, "POST", { confirm: "要封存的" })).status, 200);
  assert.equal((await call(`${I}/api/projects/t9`)).status, 400);
  assert.ok(!(await call(`${I}/api/projects`)).data.some((p: any) => p.id === "t9"));
  const kept = (await fs.readdir(path.join(home, "archive"))).find((n) => n.startsWith("t9-"));
  assert.ok(kept && (await fs.stat(path.join(home, "archive", kept, "model", "model.sysml"))).isFile());
});

test("刪除定義會連同看不到的實例一起刪；被其他元素引用時說明在哪裡", async () => {
  await call(`${I}/api/projects`, "POST", { id: "t5", name: "刪除測試", kind: "annual" });
  let v5 = (await call(`${I}/api/projects/t5`)).data;
  const f5 = (name: string, kind?: string) => v5.analysis.elements.find((e: any) => e.name === name && (!kind || e.kind === kind));
  // 火箭被需求的 subject 引用：要先處理需求
  let r = await call(`${I}/api/projects/t5/elements/delete`, "POST", { id: f5("火箭", "PartDefinition").id });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /REQ-SYS-001/);
  r = await call(`${I}/api/projects/t5/elements/delete`, "POST", { id: f5("遠地點高度").id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  v5 = r.data;
  // 現在只剩實例 rocket 與零件引用：刪定義時一併刪除
  r = await call(`${I}/api/projects/t5/elements/delete`, "POST", { id: f5("火箭", "PartDefinition").id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  v5 = r.data;
  assert.equal(v5.analysis.ok, true);
  assert.equal(f5("火箭"), undefined);
  assert.equal(f5("rocket"), undefined);
  // 次系統定義原本被火箭的零件引用，火箭刪掉後可以直接刪
  r = await call(`${I}/api/projects/t5/elements/delete`, "POST", { id: f5("推進次系統", "PartDefinition").id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
});

test("重複的關係被拒絕；復原上一步會還原模型修改", async () => {
  await call(`${I}/api/projects`, "POST", { id: "t6", name: "復原測試", kind: "annual" });
  let v6 = (await call(`${I}/api/projects/t6`)).data;
  const f6 = (name: string) => v6.analysis.elements.find((e: any) => e.name === name);
  const body = { kind: "trace", from: f6("尋回火箭").id, to: f6("競賽主辦方").id };
  assert.equal((await call(`${I}/api/projects/t6/relations`, "POST", body)).status, 200);
  const dup = await call(`${I}/api/projects/t6/relations`, "POST", body);
  assert.equal(dup.status, 400);
  assert.match(dup.data.error, /已經存在/);
  const count = (v: any) => v.analysis.relations.filter((r: any) => r.kind === "trace").length;
  const withRel = (await call(`${I}/api/projects/t6`)).data;
  const undone = await call(`${I}/api/projects/t6/undo`, "POST", {});
  assert.equal(undone.status, 200, JSON.stringify(undone.data).slice(0, 200));
  assert.equal(count(undone.data), count(withRel) - 1);
  const redone = await call(`${I}/api/projects/t6/undo`, "POST", {});
  assert.equal(count(redone.data), count(withRel), "再按一次會還原這次的還原");
});

test("圖的資料：使用案例圖畫出利害關係人之間與案例的連線，活動圖有起訖節點", async () => {
  const { buildGraph, diagramsOf } = await import("../web/src/model.ts");
  const { toSvg } = await import("../web/src/exportSvg.ts");
  const a = (await call(`${I}/api/projects/t6`)).data.analysis;
  const name = (id: string) => a.elements.find((e: any) => e.id === id)?.name;
  const g = (kind: string) => buildGraph(diagramsOf(a).find((d: any) => d.kind === kind) as any, a);
  const uc = g("uc");
  assert.ok(uc.nodes.filter((n: any) => n.shape === "actor").length >= 2, "利害關係人應畫成火柴人");
  assert.ok(uc.nodes.some((n: any) => n.shape === "usecase"), "使用案例應畫成橢圓");
  const assoc = uc.edges.find((e: any) => name(e.source) === "執行發射");
  assert.deepEqual([assoc?.kind, assoc?.dashed, assoc?.head], ["association", false, "none"]);
  const req = g("req");
  assert.ok(req.edges.some((e: any) => e.label === "«deriveReqt»" && e.dashed && e.head === "open"));
  assert.ok(req.edges.some((e: any) => e.label === "«satisfy»") && req.edges.some((e: any) => e.label === "«verify»"));
  assert.ok(req.nodes.some((n: any) => n.keyword === "«requirement»" && n.compartments[0]?.[0].startsWith('id = "REQ-')));
  assert.ok(req.nodes.some((n: any) => n.keyword === "«testCase»"));
  const bdd = g("bdd");
  assert.ok(bdd.nodes.every((n: any) => n.keyword === "«block»"));
  assert.ok(bdd.edges.every((e: any) => e.tail === "diamond" && !e.dashed));
  const act = g("act");
  assert.deepEqual([act.nodes[0].shape, act.nodes[act.nodes.length - 1].shape], ["initial", "final"]);
  assert.ok(act.nodes.filter((n: any) => n.el).every((n: any) => n.shape === "action"));
  const stm = g("stm");
  assert.ok(stm.nodes.some((n: any) => n.shape === "state") && stm.nodes.some((n: any) => n.shape === "initial"));
  const svg = toSvg("t", uc.nodes.map((n: any, i: number) => ({ g: n, x: i * 220, y: 0 })), uc.edges);
  assert.match(svg, /<ellipse/);
  assert.ok((svg.match(/<circle/g) ?? []).length >= 2, "火柴人的頭");
});

test("編號可以自訂：修改、補上、格式與重複檢查", async () => {
  await call(`${I}/api/projects`, "POST", { id: "t7", name: "編號測試", kind: "annual" });
  let v7 = (await call(`${I}/api/projects/t7`)).data;
  const f7 = (name: string, kind?: string) => v7.analysis.elements.find((e: any) => e.name === name && (!kind || e.kind === kind));
  const patch = async (body: any) => { const r = await call(`${I}/api/projects/t7/elements`, "PATCH", body); if (r.data.analysis) v7 = r.data; return r; };
  let r = await patch({ id: f7("遠地點高度").id, shortName: "RTC-REQ-010", doc: "火箭應到達 3000 m ± 100 m。" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(f7("遠地點高度").shortName, "RTC-REQ-010");
  assert.match(f7("遠地點高度").doc, /100 m/);
  assert.ok(v7.analysis.relations.some((x: any) => x.kind === "verify" && x.to === f7("遠地點高度").id), "關係不受編號影響");
  r = await patch({ id: f7("火箭", "PartDefinition").id, shortName: "SYS-001" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(f7("火箭", "PartDefinition").shortName, "SYS-001");
  assert.equal((await patch({ id: f7("總衝量").id, shortName: "RTC-REQ-010" })).status, 400, "重複");
  assert.equal((await patch({ id: f7("總衝量").id, shortName: "有 空白" })).status, 400, "格式");
});

test("來源文件只存連結；元素可標註出處並寫進模型", async () => {
  await call(`${I}/api/projects`, "POST", { id: "t8", name: "出處測試", kind: "annual" });
  const base = `${I}/api/projects/t8`;
  assert.equal((await call(`${base}/pm/docs`, "POST", { title: "壞連結", url: "javascript:alert(1)" })).status, 400);
  assert.equal((await call(`${base}/pm/docs`, "POST", { title: "壞連結", url: "http://example.com/a" })).status, 400);
  let r = await call(`${base}/pm/docs`, "POST", { title: "TASA RTC 競賽規則", type: "規則", revision: "2027", url: "https://drive.google.com/file/d/abc/view" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.docs[0].id, "DOC-001");
  let v8 = (await call(base)).data;
  assert.equal(v8.docs.length, 1);
  const req = v8.analysis.elements.find((e: any) => e.name === "遠地點高度");
  r = await call(`${base}/elements`, "PATCH", { id: req.id, source: { doc: "DOC-001", ref: "3.2" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  let e = r.data.analysis.elements.find((x: any) => x.name === "遠地點高度");
  assert.deepEqual([e.attrs.sourceDoc, e.attrs.sourceRef], ["DOC-001", "3.2"]);
  assert.match((await call(`${base}/files/model.sysml`)).data.content, /@Source \{ sourceDoc = "DOC-001"; sourceRef = "3.2"; \}/);
  r = await call(`${base}/elements`, "PATCH", { id: e.id, source: { doc: "DOC-001", ref: "4.1" } });
  e = r.data.analysis.elements.find((x: any) => x.name === "遠地點高度");
  assert.equal(e.attrs.sourceRef, "4.1");
  assert.equal(((await call(`${base}/files/model.sysml`)).data.content.match(/@Source/g) ?? []).length, 1, "修改出處不應重複加入");
  r = await call(`${base}/elements`, "PATCH", { id: e.id, source: { doc: "", ref: "" } });
  assert.equal(r.data.analysis.elements.find((x: any) => x.name === "遠地點高度").attrs.sourceDoc, undefined);
  r = await call(`${base}/elements`, "POST", { category: "Need", name: "符合競賽規則", doc: "火箭需符合規則。", source: { doc: "DOC-001", ref: "1" } });
  assert.equal(r.data.analysis.elements.find((x: any) => x.name === "符合競賽規則").attrs.sourceDoc, "DOC-001");
  r = await call(`${base}/milestones`, "POST", { gate: "mdr", date: "2026-09-15" });
  assert.equal(r.data.milestones.mdr, "2026-09-15");
  r = await call(`${base}/elements`, "PATCH", { id: r.data.analysis.elements.find((x: any) => x.name === "降落傘未展開").id, attrs: { detection: "3", residualSeverity: "5", residualLikelihood: "1" } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.analysis.elements.find((x: any) => x.name === "降落傘未展開").attrs.detection, "3");
});

test("三種建立方式：空白、範本、流程範本；流程範本不可跳步，照順序可以走完前幾步", async () => {
  await call(`${I}/api/projects`, "POST", { id: "g-blank", name: "空白", kind: "annual", template: "blank" });
  let b = (await call(`${I}/api/projects/g-blank`)).data;
  assert.equal(b.analysis.ok, true);
  assert.equal(b.analysis.elements.filter((e: any) => e.category && !e.shared).length, 0, "空白專案除了共用元件庫之外沒有內容");
  assert.equal(b.process[0].state, "current");
  // 空白專案不強制順序
  assert.equal((await call(`${I}/api/projects/g-blank/elements`, "POST", { category: "SystemRequirement", name: "直接寫需求" })).status, 200);

  const sample = (await call(`${I}/api/projects/t1`)).data;
  assert.equal(sample.process.length, 17);

  await call(`${I}/api/projects`, "POST", { id: "g1", name: "流程", kind: "annual", template: "guided" });
  const base = `${I}/api/projects/g1`;
  let v = (await call(base)).data;
  assert.equal(v.project.template, "guided");
  assert.deepEqual(v.process.slice(0, 3).map((s: any) => s.state), ["current", "locked", "locked"]);
  let r = await call(`${base}/elements`, "POST", { category: "SystemRequirement", name: "跳步的需求" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /利害關係人/);
  r = await call(`${base}/elements`, "POST", { category: "Expectation", name: "跳步的期望" });
  assert.equal(r.status, 400);

  const add = async (body: any) => { const x = await call(`${base}/elements`, "POST", body); assert.equal(x.status, 200, JSON.stringify(x.data).slice(0, 200)); v = x.data; return v.analysis.elements.find((e: any) => e.name === body.name); };
  const link = async (kind: string, from: any, to: any) => { const x = await call(`${base}/relations`, "POST", { kind, from: from.id, to: to.id }); assert.equal(x.status, 200, JSON.stringify(x.data).slice(0, 200)); v = x.data; };
  const state = (id: string) => v.process.find((s: any) => s.id === id).state;

  const stk = await add({ category: "Stakeholder", name: "主辦方" });
  assert.deepEqual([state("stakeholders"), state("expectations"), state("needs")], ["done", "current", "locked"]);
  const exp = await add({ category: "Expectation", name: "安全", doc: "不得危及人員。" });
  assert.equal(state("expectations"), "current", "期望還沒指出是誰的");
  assert.match(v.process[1].issues[0].text, /誰的期望|任何期望/);
  await link("trace", exp, stk);
  assert.deepEqual([state("expectations"), state("needs")], ["done", "current"]);
  const need = await add({ category: "Need", name: "安全的火箭" }); await link("trace", need, exp);
  const goal = await add({ category: "Goal", name: "完成飛行" }); await link("derive", goal, need);
  const obj = await add({ category: "Objective", name: "到達 3000 m" }); await link("derive", obj, goal);
  assert.equal(state("moes"), "current");
  const moe = await add({ category: "MOE", name: "高度偏差" }); await link("refine", moe, obj);
  assert.deepEqual([state("moes"), state("context"), state("usecases")], ["done", "current", "locked"]);
  assert.equal((await call(`${base}/elements`, "POST", { category: "UseCase", name: "跳步" })).status, 400);
  // 功能分配的關係要能被辨識（第 12 步的完成條件）
  const s1 = (await call(`${I}/api/projects/t1`)).data;
  const fnHost = s1.analysis.elements.find((e: any) => e.name === "任務");
  let x = await call(`${I}/api/projects/t1/elements`, "POST", { category: "Function", name: "偵測遠地點", parentId: fnHost.id });
  assert.equal(x.status, 200, JSON.stringify(x.data).slice(0, 200));
  const fn = x.data.analysis.elements.find((e: any) => e.name === "偵測遠地點");
  const sub = x.data.analysis.elements.find((e: any) => e.name === "航電次系統" && e.kind === "PartDefinition");
  x = await call(`${I}/api/projects/t1/relations`, "POST", { kind: "allocate", from: fn.id, to: sub.id });
  assert.equal(x.status, 200, JSON.stringify(x.data).slice(0, 300));
  const al = x.data.analysis.relations.find((q: any) => q.kind === "allocate" && q.from === fn.id);
  assert.ok(al, "分配關係應被辨識");
  assert.equal(x.data.analysis.elements.find((e: any) => e.id === al.to).category, "Subsystem", "分配對象是該次系統的零件");
  assert.equal(x.data.process.find((s: any) => s.id === "functions").issues.some((i: any) => /偵測遠地點/.test(i.text)), false);
  // 分析方法（skill）隨專案儲存庫提供
  const skill = await fs.readFile(path.join(home, "projects", "g1", ".claude", "skills", "jri-mbse", "SKILL.md"), "utf8");
  assert.match(skill, /從利害關係人開始/);
});

test("自訂圖與標註：可儲存讀回，不合格的內容會被濾掉", async () => {
  const base = `${I}/api/projects/t1/diagrams`;
  assert.deepEqual((await call(base)).data, { custom: [], notes: {} });
  const r = await call(base, "PUT", { diagrams: {
    custom: [{ id: "custom:a1", title: " 總覽 ", members: ["x", "x", "y", 5] }, { id: "bad id", title: "x", members: [] }],
    notes: { "custom:a1": [{ id: "note:n1", type: "frame", x: 10.4, y: 20, w: 5, h: 99999, text: "提案委員會" }, { id: "note:n2", type: "script", x: 0, y: 0, w: 100, h: 100, text: "" }] },
  } });
  assert.equal(r.status, 200);
  const d = (await call(base)).data;
  assert.deepEqual(d.custom, [{ id: "custom:a1", title: "總覽", members: ["x", "y"] }]);
  assert.deepEqual(d.notes["custom:a1"], [{ id: "note:n1", type: "frame", x: 10, y: 20, w: 48, h: 4000, text: "提案委員會" }]);
});
