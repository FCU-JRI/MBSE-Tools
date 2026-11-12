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
  let r = await call(`${I}/api/projects/t1/elements/delete`, "POST", { id: find("推進次系統", "PartDefinition").id });
  assert.equal(r.status, 400);
  r = await call(`${I}/api/projects/t1/files/model.sysml`, "PUT", { content: "package Project { part def }" });
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
  assert.equal((await call(`${P}/api/projects/t1`, "GET", undefined, { cookie: cookie.slice(0, -1) + "x" })).status, 401);
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
