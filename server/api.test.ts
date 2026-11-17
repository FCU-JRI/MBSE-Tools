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
let fakeGh: string;

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
  // 假的 gh：記錄參數；擁有者 fail-owner 模擬未登入
  fakeGh = path.join(home, "fake-gh.sh");
  await fs.writeFile(fakeGh, `#!/bin/sh\necho "$@" >> "${path.join(home, "gh-calls.txt")}"\ncase "$3" in fail-owner/*) echo "HTTP 401: Bad credentials" >&2; exit 1;; esac\necho "https://github.com/$3"\n`, { mode: 0o755 });
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: fakeGh }, stdio: "ignore" });
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

const hasEl = (view: any, name: string) => view.analysis.elements.some((e: any) => e.name === name);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("分支可以像 main 一樣完整開啟並編輯；修改只留在分支，合併後才進 main（F-33）", async () => {
  await call(`${I}/api/projects`, "POST", { id: "tb", name: "分支測試", kind: "annual" });
  gitIn(path.join(home, "projects", "tb"), "branch", "feature/ws");
  const M = `${I}/api/projects/tb`, B = `${I}/api/projects/tb@feature~ws`;

  let r = await call(B);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(r.data.project.id, "tb@feature~ws", "回傳的專案參照帶著分支，網頁接下來的請求才會留在分支上");
  assert.deepEqual(r.data.branch, { name: "feature/ws", ahead: 0, behind: 0, warning: "" });
  assert.equal(r.data.gates.length, 8);
  assert.equal((await call(M)).data.branch, null);

  // 模型、時程、版面：改在分支，main 不受影響
  r = await call(`${B}/elements`, "POST", { category: "SystemRequirement", name: "分支上的需求", doc: "只在分支。" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(hasEl(r.data, "分支上的需求"));
  assert.equal(r.data.branch.ahead, 1);
  assert.equal(hasEl((await call(M)).data, "分支上的需求"), false);
  r = await call(`${B}/pm/tasks`, "POST", { title: "分支上的任務", start: "2026-09-01", end: "2026-09-02" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal((await call(`${M}/pm`)).data.tasks.length, 0);
  await call(`${B}/layout`, "PATCH", { diagram: "bdd", nodes: { b: { x: 3, y: 4 } } });
  assert.deepEqual((await call(`${M}/layout`)).data, {});
  assert.match((await call(`${B}/files/model.sysml`)).data.content, /分支上的需求/);
  assert.equal((await call(`${B}/export.xlsx`)).status, 200);
  assert.match((await call(`${B}/report?gate=proposal`)).data, /分支上的需求|分支測試/);

  // 復原與重做在分支上各自獨立
  r = await call(`${B}/undo`, "POST", {});
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal(hasEl(r.data, "分支上的需求"), false);
  r = await call(`${B}/redo`, "POST", {});
  assert.ok(hasEl(r.data, "分支上的需求"));

  // 整個專案的事不能在分支上做；不合法或不存在的分支被拒絕
  r = await call(`${B}/signoffs`, "POST", { gate: "proposal", decision: "APPROVE" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /只能在 main/);
  assert.equal((await call(`${B}/archive`, "POST", { confirm: "分支測試" })).status, 400);
  assert.equal((await call(`${B}/branches/merge`, "POST", { name: "feature/ws" })).status, 400);
  for (const bad of ["tb@main", "tb@no-such", "tb@a..b", "tb@feature%2Fws", "tb@-x"]) assert.equal((await call(`${I}/api/projects/${bad}`)).status, 400, bad);
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "tb@x", name: "不該建立", kind: "annual" })).status, 400);

  // main 往前走，而且排了同一張圖 → 分支把 main 的更新合併進來，兩邊的版面都留著
  await call(`${M}/layout`, "PATCH", { diagram: "bdd", nodes: { a: { x: 1, y: 2 } } });
  r = await call(`${M}/elements`, "POST", { category: "Stakeholder", name: "main 上的利害關係人", doc: "只在 main。" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.equal((await call(B)).data.branch.behind >= 1, true);
  r = await call(`${B}/branches/update`, "POST", {});
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.branch.behind, 0);
  assert.ok(hasEl(r.data, "main 上的利害關係人") && hasEl(r.data, "分支上的需求"));
  assert.deepEqual((await call(`${B}/layout`)).data, { bdd: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } } });
  assert.equal((await call(`${B}/branches/update`, "POST", {})).status, 400, "已經包含 main 的最新內容");

  // 分支列在 main 的版本頁；合併時連還沒提交的版面一起帶進 main
  const row = (await call(`${M}/branches`)).data.find((x: any) => x.name === "feature/ws");
  assert.equal(row?.ok, true);
  await call(`${B}/layout`, "PATCH", { diagram: "req", nodes: { c: { x: 5, y: 6 } } });
  r = await call(`${M}/branches/merge`, "POST", { name: "feature/ws" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.ok(hasEl(r.data, "分支上的需求"));
  assert.deepEqual((await call(`${M}/layout`)).data, { bdd: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }, req: { c: { x: 5, y: 6 } } });
  assert.equal((await call(`${M}/pm`)).data.tasks[0].title, "分支上的任務");
});

test("分支和 GitHub 同步：成員推上來的修改會接上，網頁上的修改推到同名分支，衝突時不硬合併", async () => {
  const dir = path.join(home, "projects", "tb");
  const bare = path.join(home, "remote-tb.git"), member = path.join(home, "member-tb");
  gitIn(home, "init", "-q", "--bare", "-b", "main", bare);
  gitIn(dir, "remote", "add", "origin", bare);
  gitIn(dir, "push", "-q", "origin", "main");
  gitIn(home, "clone", "-q", bare, member);
  gitIn(member, "checkout", "-q", "-b", "claude/fix");
  const model = path.join(member, "model", "model.sysml");
  const edit = async (from: string, to: string, message: string) => {
    const text = await fs.readFile(model, "utf8");
    assert.ok(text.includes(from), `成員的模型裡找不到「${from}」`);
    await fs.writeFile(model, text.replace(from, to), "utf8");
    gitIn(member, "commit", "-qam", message);
    gitIn(member, "push", "-q", "origin", "claude/fix");
  };
  await edit("package Requirements {", "package Requirements {\n        requirement <'REQ-SYS-901'> '成員推上來的需求' : SystemRequirement { doc /* 第一版。 */ }", "成員：新增需求");

  // 只存在 GitHub 上的分支也能直接開啟
  const B = `${I}/api/projects/tb@claude~fix`;
  let r = await call(B);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(hasEl(r.data, "成員推上來的需求"));

  // 網頁上的修改推到 GitHub 上的同名分支
  const opened = path.join(home, "branches", "tb", "claude~fix");
  const pushed = async () => {
    for (let i = 0; i < 60; i++) {
      if (gitIn(bare, "rev-parse", "refs/heads/claude/fix").trim() === gitIn(opened, "rev-parse", "HEAD").trim()) return true;
      await wait(200);
    }
    return false;
  };
  assert.equal((await call(`${B}/pm/tasks`, "POST", { title: "網頁上加的任務", start: "2026-09-03", end: "2026-09-04" })).status, 200);
  assert.ok(await pushed(), "網頁上的修改應該推到 GitHub");

  // 成員拉下來再推一版 → 網頁重新開啟時接上
  gitIn(member, "pull", "-q", "origin", "claude/fix");
  await edit("第一版。", "第二版。", "成員：修改說明");
  gitIn(dir, "fetch", "-q", "origin");
  r = await call(B);
  assert.equal(r.data.branch.warning, "");
  assert.match((await call(`${B}/files/model.sysml`)).data.content, /第二版。/);

  // 成員和網頁各改各的（不同檔案）→ 自動合併，再推上去
  await edit("第二版。", "第三版。", "成員：再改一次");
  assert.equal((await call(`${B}/pm/tasks`, "POST", { title: "同時加的任務", start: "2026-09-05", end: "2026-09-06" })).status, 200);
  gitIn(dir, "fetch", "-q", "origin");
  r = await call(B);
  assert.equal(r.data.branch.warning, "");
  assert.match((await call(`${B}/files/model.sysml`)).data.content, /第三版。/);
  assert.ok((await call(`${B}/pm`)).data.tasks.some((t: any) => t.title === "同時加的任務"));
  assert.ok(await pushed(), "合併後的結果應該推到 GitHub");
  assert.equal((await call(`${I}/api/projects/tb/branches`)).data.find((x: any) => x.name === "claude/fix")?.ok, true);

  // 兩邊改了模型的同一行 → 不硬合併：網頁上的內容不變，提示使用者
  gitIn(member, "pull", "-q", "origin", "claude/fix");
  await edit("第三版。", "成員版。", "成員：改同一行");
  const mine = (await call(`${B}/files/model.sysml`)).data.content.replace("第三版。", "網頁版。");
  assert.equal((await call(`${B}/files/model.sysml`, "PUT", { content: mine, message: "網頁：改同一行" })).status, 200);
  gitIn(dir, "fetch", "-q", "origin");
  r = await call(B);
  assert.match(r.data.branch.warning, /無法自動合併/);
  assert.equal(r.data.analysis.ok, true);
  assert.match((await call(`${B}/files/model.sysml`)).data.content, /網頁版。/);

  // 封存專案時收掉分支的工作目錄，分支本身留在儲存庫
  assert.equal((await call(`${I}/api/projects/tb/archive`, "POST", { confirm: "分支測試" })).status, 200);
  assert.equal(await fs.stat(path.join(home, "branches", "tb")).then(() => true, () => false), false);
  assert.equal((await call(B)).status, 400);
  const kept = (await fs.readdir(path.join(home, "archive"))).find((n) => n.startsWith("tb-")) as string;
  assert.match(gitIn(path.join(home, "archive", kept), "branch", "--list"), /claude\/fix/);
});

test("合併時的模型衝突：一邊的修改已包含另一邊會自動解決；一邊刪、一邊改同一行仍然要人處理（F-34）", async () => {
  await call(`${I}/api/projects`, "POST", { id: "tc", name: "衝突測試", kind: "annual" });
  const dir = path.join(home, "projects", "tc"), model = path.join(dir, "model", "model.sysml");
  const base = await fs.readFile(model, "utf8");
  const lineOf = (part: string) => { const l = base.split("\n").find((x) => x.includes(part)); assert.ok(l, `範本裡找不到 ${part}`); return l + "\n"; };
  const L1 = lineOf("#derivation connection { end #derive ::> '完成年度飛行任務'; end #original ::> '到達目標高度'; }"), L2 = lineOf("#derivation connection { end #derive ::> '遠地點達 3000 m'; end #original ::> '完成年度飛行任務'; }");
  assert.ok(base.includes(L1 + L2), "兩條關係要相鄰，才會讓 git 判定衝突");
  const commitOn = async (branch: string, content: string, message: string) => {
    if (branch !== "main") gitIn(dir, "checkout", "-q", "-b", branch);
    await fs.writeFile(model, content, "utf8");
    gitIn(dir, "commit", "-qam", message);
    gitIn(dir, "checkout", "-q", "main");
  };
  await commitOn("feature/superset", base.replace(L1 + L2, ""), "分支：刪掉兩條關係");
  await commitOn("feature/rewrite", base.replace(L1, L1.replace("#derivation connection", "#derivation connection d1")), "分支：改寫第一條關係");
  await commitOn("main", base.replace(L1, ""), "main：刪掉第一條關係");

  // main 刪掉的那一行，分支把它改寫了：真的意見不同，不自動處理，main 不變
  let r = await call(`${I}/api/projects/tc/branches/merge`, "POST", { name: "feature/rewrite" });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /衝突.*model\.sysml/);
  assert.equal((await fs.readFile(model, "utf8")), base.replace(L1, ""));

  // main 刪的那一條，分支也刪了，還多刪一條：分支的結果已經包含兩邊的修改
  r = await call(`${I}/api/projects/tc/branches/merge`, "POST", { name: "feature/superset" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.analysis.ok, true);
  assert.equal(await fs.readFile(model, "utf8"), base.replace(L1 + L2, ""));
  assert.match(gitIn(dir, "log", "-1", "--format=%B"), /自動解決的模型衝突.*model\.sysml 1 段/);
});

test("main 也會接上 GitHub 上的新提交：有人在 GitHub 合併後，網頁的修改仍然推得上去（F-35）", async () => {
  await call(`${I}/api/projects`, "POST", { id: "tm", name: "main 同步測試", kind: "annual" });
  const dir = path.join(home, "projects", "tm"), bare = path.join(home, "remote-tm.git"), member = path.join(home, "member-tm");
  gitIn(home, "init", "-q", "--bare", "-b", "main", bare);
  gitIn(dir, "remote", "add", "origin", bare);
  gitIn(dir, "push", "-q", "origin", "main");
  gitIn(home, "clone", "-q", bare, member);
  const model = path.join(member, "model", "model.sysml");
  // 模擬 GitHub 上的 main 多了提交（在 GitHub 按合併，或有人直接推送）
  const onGitHub = async (change: (text: string) => string, message: string) => {
    gitIn(member, "pull", "-q", "origin", "main");
    await fs.writeFile(model, change(await fs.readFile(model, "utf8")), "utf8");
    gitIn(member, "commit", "-qam", message);
    gitIn(member, "push", "-q", "origin", "main");
  };
  const M = `${I}/api/projects/tm`;
  const tips = () => [gitIn(dir, "rev-parse", "HEAD").trim(), gitIn(bare, "rev-parse", "refs/heads/main").trim()];
  const inSync = async () => {
    for (let i = 0; i < 75; i++) { const [a, b] = tips(); if (a === b) return true; await wait(200); }
    return false;
  };

  // GitHub 上多了一筆，網頁接著有人修改：推送被拒絕 → 自動接上 → 再推一次成功
  await onGitHub((t) => t.replace("package Requirements {", "package Requirements {\n        requirement <'REQ-SYS-950'> 'GitHub 上合併進來的需求' : SystemRequirement { doc /* 來自 GitHub。 */ }"), "GitHub：合併進 main");
  assert.equal((await call(`${M}/pm/tasks`, "POST", { title: "網頁上的任務", start: "2026-09-01", end: "2026-09-02" })).status, 200);
  assert.ok(await inSync(), "推送被拒絕後應該自動接上 GitHub 的提交並推送成功");
  let r = await call(M);
  assert.ok(hasEl(r.data, "GitHub 上合併進來的需求"));
  assert.equal(r.data.warning, "");
  assert.equal((await call(`${M}/sync`)).data.error, null);
  assert.equal((await call(`${M}/pm`)).data.tasks[0].title, "網頁上的任務");

  // 沒有人修改時，重新載入專案也會接上
  await onGitHub((t) => t.replace("來自 GitHub。", "GitHub 上又改了一次。"), "GitHub：再改一次");
  gitIn(dir, "fetch", "-q", "origin");
  r = await call(M);
  assert.equal(r.data.warning, "");
  assert.match((await call(`${M}/files/model.sysml`)).data.content, /GitHub 上又改了一次。/);
  // 工作目錄有還沒提交的檔案（這裡是共用元件庫的副本）時會先存起來再合併，所以不一定是快轉；結果要和 GitHub 一致
  assert.ok(await inSync(), "接上後兩邊應該一致");

  // GitHub 上的 main 模型壞了：不接，免得所有人的畫面一起壞掉，並提示
  await onGitHub((t) => t + "\npackage Oops { part def }\n", "GitHub：壞掉的模型");
  gitIn(dir, "fetch", "-q", "origin");
  r = await call(M);
  assert.match(r.data.warning, /無法解析/);
  assert.equal(r.data.analysis.ok, true);
  assert.notEqual(tips()[0], tips()[1]);
});

test("衍生、細化、驗證方法用 SysML v2 標準庫的寫法；舊寫法的專案與分支自動轉換（F-36）", async () => {
  await call(`${I}/api/projects`, "POST", { id: "tu", name: "轉換測試", kind: "annual" });
  const dir = path.join(home, "projects", "tu"), file = path.join(dir, "model", "model.sysml");
  const M = `${I}/api/projects/tu`;
  const count = (view: any, kind: string) => view.analysis.relations.filter((r: any) => r.kind === kind).length;
  const el = (view: any, name: string) => view.analysis.elements.find((e: any) => e.name === name);
  const fresh = (await call(M)).data;
  assert.deepEqual([count(fresh, "derive"), count(fresh, "refine"), count(fresh, "trace")], [4, 1, 2]);
  assert.equal(el(fresh, "飛行測試遠地點量測").attrs.kind, "VerificationMethodKind::test");

  // 把模型改回舊寫法並提交，模擬升級前就存在的專案
  const standard = await fs.readFile(file, "utf8");
  const legacy = standard
    .replace(/#derivation connection \{ end #derive ::> (.+?); end #original ::> (.+?); \}/g, "#derive dependency from $1 to $2;")
    .replace(/#refinement dependency/g, "#refine dependency")
    .replace("@VerificationMethod { kind = VerificationMethodKind::test; }", "@VVMethod { kind = Method::byTest; }");
  assert.equal((legacy.match(/#derive dependency/g) ?? []).length, 4);
  await fs.writeFile(file, legacy, "utf8");
  gitIn(dir, "commit", "-qam", "升級前的專案（舊寫法）");
  const legacySha = gitIn(dir, "rev-parse", "HEAD").trim();

  // 開啟就能解析，關係一條不少；檔案已經是標準寫法
  let r = await call(M);
  assert.equal(r.data.analysis.ok, true, JSON.stringify(r.data.analysis.diagnostics).slice(0, 300));
  assert.deepEqual([count(r.data, "derive"), count(r.data, "refine"), count(r.data, "trace")], [4, 1, 2]);
  assert.equal(el(r.data, "飛行測試遠地點量測").attrs.kind, "VerificationMethodKind::test");
  assert.equal(await fs.readFile(file, "utf8"), standard, "轉換結果和新專案的範本完全相同");
  // 轉換單獨提交成一筆，不和使用者的修改混在一起
  assert.equal(gitIn(dir, "log", "-1", "--format=%an｜%s").trim(), "JRI MBSE｜模型改用 SysML v2 標準庫與內建的寫法");
  assert.equal(gitIn(dir, "status", "--porcelain", "--", "model"), "");
  assert.equal(gitIn(dir, "show", "--stat", "--format=", "HEAD").trim().split("\n").length, 2, "這一筆只動到模型檔");

  // 新增的關係與驗證方法用標準寫法；衍生的兩端必須是需求
  const [need, sub] = [el(r.data, "到達目標高度"), el(r.data, "總衝量")];
  r = await call(`${M}/relations`, "POST", { kind: "derive", from: sub.id, to: need.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(count(r.data, "derive"), 5);
  assert.match(await fs.readFile(file, "utf8"), /#derivation connection \{ end #derive ::> .*'總衝量'; end #original ::> .*'到達目標高度'; \}/);
  r = await call(`${M}/relations`, "POST", { kind: "derive", from: el(r.data, "指導老師").id, to: need.id });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /衍生只能連接需求類/);
  r = await call(`${M}/relations/delete`, "POST", { kind: "derive", from: sub.id, to: need.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(count(r.data, "derive"), 4);
  r = await call(`${M}/elements`, "POST", { category: "VerificationEvent", name: "分析驗證", doc: "以分析驗證。", verifies: el(r.data, "遠地點高度").qualifiedName, method: "analyze" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(el(r.data, "分析驗證").attrs.kind, "VerificationMethodKind::analyze");
  r = await call(`${M}/elements`, "POST", { category: "VerificationEvent", name: "檢查驗證", doc: "舊的方法代號也收。", verifies: el(r.data, "遠地點高度").qualifiedName, method: "byInspection" });
  assert.equal(el(r.data, "檢查驗證").attrs.kind, "VerificationMethodKind::inspect");

  // 一條連結掛兩個子需求（手寫）：各算一條關係，刪掉其中一條時另一條還在
  const two = (await fs.readFile(file, "utf8")).replace("#derivation connection { end #derive ::> '總衝量'; end #original ::> '遠地點高度'; }",
    "#derivation connection { end #original ::> '遠地點高度'; end #derive ::> '總衝量'; end #derive ::> NGOs::'遠地點誤差'; }");
  r = await call(`${M}/files/model.sysml`, "PUT", { content: two, message: "手寫：一條連結兩個子需求" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  let v2 = (await call(M)).data;
  assert.equal(count(v2, "derive"), 5);
  r = await call(`${M}/relations/delete`, "POST", { kind: "derive", from: el(v2, "遠地點誤差").id, to: el(v2, "遠地點高度").id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(count(r.data, "derive"), 4);
  assert.ok(r.data.analysis.relations.some((x: any) => x.kind === "derive" && x.from === el(r.data, "總衝量").id && x.to === el(r.data, "遠地點高度").id));

  // 原始碼分頁貼上舊寫法：照樣收，存成標準寫法
  const pasted = (await fs.readFile(file, "utf8")).replace("package Risks {", "#refine dependency from Requirements::'總衝量' to NGOs::'遠地點誤差';\n    package Risks {");
  r = await call(`${M}/files/model.sysml`, "PUT", { content: pasted, message: "貼上舊寫法" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.match(await fs.readFile(file, "utf8"), /#refinement dependency from Requirements::'總衝量' to NGOs::'遠地點誤差';/);

  // 從升級前的版本開出來的分支（還是舊寫法，而且在既有的衍生關係旁邊加了新的）：列得出來、合併不衝突
  gitIn(dir, "checkout", "-q", "-b", "feature/legacy", legacySha);
  await fs.writeFile(file, legacy
    .replace("package Requirements {", "package Requirements {\n        requirement <'REQ-SYS-960'> '舊寫法分支的需求' : SystemRequirement { doc /* 由舊寫法的分支加入。 */ }")
    .replace("#derive dependency from '遠地點高度' to NGOs::'遠地點達 3000 m';", "#derive dependency from '遠地點高度' to NGOs::'遠地點達 3000 m';\n        #derive dependency from '舊寫法分支的需求' to NGOs::'遠地點達 3000 m';"), "utf8");
  gitIn(dir, "commit", "-qam", "分支：用舊寫法新增需求與衍生關係");
  gitIn(dir, "checkout", "-q", "main");
  const row = (await call(`${M}/branches`)).data.find((b: any) => b.name === "feature/legacy");
  assert.equal(row?.ok, true, row?.firstError);
  const d = (await call(`${M}/branches/diff?name=feature/legacy`)).data;
  assert.ok(d.changes.some((c: any) => c.type === "added" && c.key === "REQ-SYS-960"));
  r = await call(`${M}/branches/merge`, "POST", { name: "feature/legacy" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.analysis.ok, true);
  assert.ok(r.data.analysis.relations.some((x: any) => x.kind === "derive" && x.from === el(r.data, "舊寫法分支的需求").id && x.to === el(r.data, "遠地點達 3000 m").id));
  assert.ok(el(r.data, "分析驗證"), "main 這邊的修改還在");
  assert.ok(!/#derive\s+dependency|#refine\s+dependency|@VVMethod/.test(await fs.readFile(file, "utf8")), "合併後沒有殘留舊寫法");

  // 升級前的版本仍然可以拿來比較
  r = await call(`${M}/compare?from=${legacySha}&to=HEAD`);
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.ok(r.data.changes.some((c: any) => c.type === "added" && c.key === "REQ-SYS-960"));

  // 復原會把模型換回舊版本的文字，也要能解析
  r = await call(`${M}/undo`, "POST", {});
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.analysis.ok, true);
});

test("利害關係人與參與者用內建的 stakeholder、actor；使用案例可以包含；舊的 #trace 相依自動改寫（F-37）", async () => {
  await call(`${I}/api/projects`, "POST", { id: "tv", name: "參與者測試", kind: "annual" });
  const dir = path.join(home, "projects", "tv"), file = path.join(dir, "model", "model.sysml");
  const M = `${I}/api/projects/tv`;
  const el = (view: any, name: string) => view.analysis.elements.find((e: any) => e.name === name);
  const traces = (view: any) => view.analysis.relations.filter((r: any) => r.kind === "trace").map((r: any) => `${view.analysis.elements.find((e: any) => e.id === r.from)?.name}→${view.analysis.elements.find((e: any) => e.id === r.to)?.name}:${r.form ?? "相依"}`).sort();
  const fresh = (await call(M)).data;
  assert.deepEqual(traces(fresh), ["安全發射與回收→指導老師:stakeholder", "執行發射→指導老師:actor"].sort());
  const standard = await fs.readFile(file, "utf8");

  // 模擬升級前的專案：這兩條關係還是 #trace 相依
  const legacy = standard
    .replace("            subject;\n            stakeholder :> Project::Stakeholders::'指導老師';\n        }\n", "        }\n        #trace dependency from '安全發射與回收' to '指導老師';\n")
    .replace("            subject;\n            actor :> Project::Stakeholders::'指導老師';\n        }\n", "        }\n")
    .replace("            doc /* 回收團隊依落點預測與定位訊號尋回火箭。 */\n        }\n", "            doc /* 回收團隊依落點預測與定位訊號尋回火箭。 */\n        }\n        #trace dependency from '執行發射' to Stakeholders::'指導老師';\n");
  assert.equal((legacy.match(/#trace dependency/g) ?? []).length, 2);
  assert.ok(!/stakeholder :>|actor :>/.test(legacy));
  await fs.writeFile(file, legacy, "utf8");
  gitIn(dir, "commit", "-qam", "升級前的專案（#trace 相依）");
  const legacySha = gitIn(dir, "rev-parse", "HEAD").trim();

  // 開啟後自動改寫，單獨一筆提交；關係不變，檔案和新專案的範本相同
  let r = await call(M);
  assert.equal(r.data.analysis.ok, true, JSON.stringify(r.data.analysis.diagnostics).slice(0, 300));
  assert.deepEqual(traces(r.data), ["安全發射與回收→指導老師:stakeholder", "執行發射→指導老師:actor"].sort());
  assert.equal(await fs.readFile(file, "utf8"), standard);
  assert.equal(gitIn(dir, "log", "-1", "--format=%an｜%s").trim(), "JRI MBSE｜模型改用 SysML v2 標準庫與內建的寫法");
  assert.equal(gitIn(dir, "status", "--porcelain", "--", "model"), "");
  assert.equal((await call(`${M}/compare?from=${legacySha}&to=HEAD`)).data.changes.length, 0, "轉換前後模型內容相同");

  // 新增：期望 → 利害關係人寫成 stakeholder，使用案例 → 利害關係人寫成 actor；已經有 subject 的不重複補
  const [exp, uc1, uc2, host, teacher] = ["安全發射與回收", "執行發射", "尋回火箭", "競賽主辦方", "指導老師"].map((n) => el(r.data, n));
  r = await call(`${M}/relations`, "POST", { kind: "trace", from: exp.id, to: host.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  r = await call(`${M}/relations`, "POST", { kind: "trace", from: uc2.id, to: host.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.deepEqual(traces(r.data), ["安全發射與回收→指導老師:stakeholder", "安全發射與回收→競賽主辦方:stakeholder", "執行發射→指導老師:actor", "尋回火箭→競賽主辦方:actor"].sort());
  let text = await fs.readFile(file, "utf8");
  assert.match(text, /subject;\n\s+stakeholder :> Project::Stakeholders::'指導老師';\n\s+stakeholder :> Project::Stakeholders::'競賽主辦方';\n\s+\}/);
  assert.match(text, /use case <'UC-002'> '尋回火箭' : UseCase \{\n\s+doc [^\n]+\n\s+subject;\n\s+actor :> Project::Stakeholders::'競賽主辦方';\n\s+\}/);
  assert.equal((await call(`${M}/relations`, "POST", { kind: "trace", from: exp.id, to: host.id })).status, 400, "重複的關係被拒絕");

  // 包含：只能在使用案例之間
  r = await call(`${M}/relations`, "POST", { kind: "include", from: uc1.id, to: uc2.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.ok(r.data.analysis.relations.some((x: any) => x.kind === "include" && x.from === uc1.id && x.to === uc2.id));
  assert.match(await fs.readFile(file, "utf8"), /include Project::UseCases::'尋回火箭';/);
  assert.equal((await call(`${M}/relations`, "POST", { kind: "include", from: uc1.id, to: teacher.id })).status, 400);

  // 刪除關係、改名、刪除利害關係人
  r = await call(`${M}/relations/delete`, "POST", { kind: "trace", from: exp.id, to: host.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  r = await call(`${M}/relations/delete`, "POST", { kind: "include", from: uc1.id, to: uc2.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.deepEqual(traces(r.data), ["安全發射與回收→指導老師:stakeholder", "執行發射→指導老師:actor", "尋回火箭→競賽主辦方:actor"].sort());

  // 從升級前的版本開出來的分支，用舊寫法在旁邊加了新的期望：列得出來、合併不衝突、合併後是新寫法
  gitIn(dir, "checkout", "-q", "-b", "feature/old-trace", legacySha);
  await fs.writeFile(file, legacy.replace("        #trace dependency from '安全發射與回收' to '指導老師';\n",
    "        #trace dependency from '安全發射與回收' to '指導老師';\n        requirement <'EXP-090'> '分支上的期望' : Expectation { doc /* 用舊寫法加的。 */ }\n        #trace dependency from '分支上的期望' to '指導老師';\n"), "utf8");
  gitIn(dir, "commit", "-qam", "分支：用 #trace 相依新增期望");
  gitIn(dir, "checkout", "-q", "main");
  assert.equal((await call(`${M}/branches`)).data.find((b: any) => b.name === "feature/old-trace")?.ok, true);
  r = await call(`${M}/branches/merge`, "POST", { name: "feature/old-trace" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.analysis.ok, true);
  assert.deepEqual(traces(r.data), ["分支上的期望→指導老師:stakeholder", "安全發射與回收→指導老師:stakeholder", "執行發射→指導老師:actor", "尋回火箭→競賽主辦方:actor"].sort());
  assert.ok(!/#trace dependency/.test(await fs.readFile(file, "utf8")));

  // 利害關係人改名：寫在各個主體裡的引用跟著改；刪除利害關係人：指向它的 actor 一併拿掉
  r = await call(`${M}/elements`, "PATCH", { id: teacher.id, name: "社團指導老師" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.deepEqual(traces(r.data), ["分支上的期望→社團指導老師:stakeholder", "安全發射與回收→社團指導老師:stakeholder", "執行發射→社團指導老師:actor", "尋回火箭→競賽主辦方:actor"].sort());
  r = await call(`${M}/elements/delete`, "POST", { id: el(r.data, "競賽主辦方").id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.analysis.ok, true);
  assert.deepEqual(traces(r.data), ["分支上的期望→社團指導老師:stakeholder", "安全發射與回收→社團指導老師:stakeholder", "執行發射→社團指導老師:actor"].sort());
});

test("GitHub 儲存庫網址只接受 github.com", async () => {
  assert.equal((await call(`${I}/api/projects/t1/remote`, "POST", { url: "ext::sh -c whoami" })).status, 400);
  assert.equal((await call(`${I}/api/projects/t1/sync`)).data.remote, "");
});

test("新增專案自動建立 GitHub 儲存庫；失敗不擋專案建立，可在版本頁重試", { skip: process.platform === "win32" ? "假的 gh 是 shell 腳本，Windows 略過" : false }, async () => {
  const cfg = (body: unknown) => call(`${I}/api/admin/config`, "POST", { autoRepo: body });
  // 移除遠端，避免背景推送真的連到 GitHub
  const unlink = (id: string) => call(`${I}/api/projects/${id}/remote`, "POST", { url: "" });
  assert.equal((await cfg({ enabled: true, owner: "bad owner" })).status, 400, "擁有者名稱不合法要拒絕");
  assert.equal((await cfg({ enabled: true, owner: "" })).status, 400, "開啟時擁有者不能空白");
  assert.equal((await cfg({ enabled: true, owner: "jri-test", visibility: "private" })).status, 200);
  assert.deepEqual((await call(`${I}/api/admin/config`)).data.autoRepo, { enabled: true, owner: "jri-test", visibility: "private" });

  let r = await call(`${I}/api/projects`, "POST", { id: "t-auto", name: "自動建立測試", kind: "small", gates: ["mdr"], template: "blank" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let s = (await call(`${I}/api/projects/t-auto/sync`)).data;
  await unlink("t-auto");
  assert.equal(s.remote, "https://github.com/jri-test/t-auto");
  assert.equal(s.error, null);
  const calls = await fs.readFile(path.join(home, "gh-calls.txt"), "utf8");
  assert.match(calls, /^repo create jri-test\/t-auto --private --description 自動建立測試$/m);

  await cfg({ enabled: true, owner: "fail-owner", visibility: "public" });
  r = await call(`${I}/api/projects`, "POST", { id: "t-fail", name: "失敗測試", kind: "small", gates: ["mdr"], template: "blank" });
  assert.equal(r.status, 200, "gh 失敗時專案照樣建立");
  s = (await call(`${I}/api/projects/t-fail/sync`)).data;
  assert.equal(s.remote, "");
  assert.match(s.error, /自動建立 GitHub 儲存庫失敗.*Bad credentials/);

  await cfg({ enabled: false, owner: "jri-test" });
  r = await call(`${I}/api/projects/t-fail/remote/create`, "POST", {});
  await unlink("t-fail");
  assert.equal(r.status, 200);
  assert.equal(r.data.remote, "https://github.com/jri-test/t-fail", "關閉自動建立仍可手動重試");
  assert.match(await fs.readFile(path.join(home, "gh-calls.txt"), "utf8"), /^repo create jri-test\/t-fail --public /m);

  assert.equal((await call(`${I}/api/projects`, "POST", { id: "t-off", name: "關閉時", kind: "small", gates: ["mdr"], template: "blank" })).status, 200);
  assert.doesNotMatch(await fs.readFile(path.join(home, "gh-calls.txt"), "utf8"), /t-off/, "關閉時不呼叫 gh");
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
  assert.equal(undone.data.history.redo, true);
  const redone = await call(`${I}/api/projects/t6/redo`, "POST", {});
  assert.equal(count(redone.data), count(withRel), "重做把那一步做回來");
  assert.equal(redone.data.history.redo, false);
  assert.equal((await call(`${I}/api/projects/t6/redo`, "POST", {})).status, 400, "沒有可以重做的步驟");
});

test("圖的資料依 SysML v2 記法：定義方角、使用圓角、關鍵字與連線樣式", async () => {
  const { buildGraph, diagramsOf, frameLabel } = await import("../web/src/model.ts");
  const { toSvg } = await import("../web/src/exportSvg.ts");
  const a = (await call(`${I}/api/projects/t6`)).data.analysis;
  const name = (id: string) => a.elements.find((e: any) => e.id === id)?.name;
  const defs = diagramsOf(a);
  const g = (kind: string) => buildGraph(defs.find((d: any) => d.kind === kind) as any, a);
  // 圖框：«view» 名稱 : 標準檢視定義
  assert.equal(frameLabel(defs.find((d: any) => d.kind === "bdd") as any), "«view» 結構分解 : GeneralView");
  assert.deepEqual(["ibd", "act", "stm"].map((k) => defs.find((d: any) => d.kind === k)?.viewDef), ["InterconnectionView", "ActionFlowView", "StateTransitionView"]);
  const uc = g("uc");
  assert.ok(uc.nodes.some((n: any) => n.keyword === "«use case»" && n.shape === "usage"), "使用案例是圓角的 «use case»");
  // 參與者是使用案例的 actor 參數：節點標 «actor»，用沒有箭頭、沒有標籤的實線連到使用案例（8.2.3.21）；沒有參與任何使用案例的仍是 «part»
  const people = uc.nodes.filter((n: any) => / : Stakeholder$/.test(n.title.join("")));
  assert.ok(people.length >= 2);
  assert.equal(people.find((n: any) => n.name === "指導老師")?.keyword, "«actor»");
  for (const n of people) assert.equal(n.keyword, uc.edges.some((e: any) => e.target === n.id && e.head === "none") ? "«actor»" : "«part»", n.name);
  const tr = uc.edges.find((e: any) => name(e.source) === "執行發射");
  assert.deepEqual([tr?.kind, tr?.dashed, tr?.head, tr?.label], ["trace", false, "none", ""]);
  const req = g("req");
  const st = req.edges.find((e: any) => name(e.source) === "安全發射與回收" && name(e.target) === "指導老師");
  assert.deepEqual([st?.dashed, st?.head, st?.label, req.nodes.find((x: any) => x.name === "指導老師")?.keyword], [false, "none", "", "«stakeholder»"], "期望的利害關係人");
  assert.ok(req.edges.some((e: any) => e.label === "«#refinement»" && e.dashed && e.head === "open"), "相依為虛線開放箭頭");
  assert.ok(req.edges.some((e: any) => e.label === "«#derivation»" && !e.dashed && e.head === "open"), "需求衍生是連結，實線開放箭頭（8.2.3.13）");
  assert.ok(req.edges.some((e: any) => e.label === "«satisfy»" && !e.dashed) && req.edges.some((e: any) => e.label === "«verify»" && !e.dashed), "satisfy、verify 為實線");
  const r1 = req.nodes.find((n: any) => n.keyword === "«requirement»" && n.title.join("").startsWith("<REQ-"));
  assert.ok(r1 && r1.shape === "usage" && r1.compartments[0]?.[0] === "doc", "需求顯示編號與 doc 隔間");
  assert.ok(req.nodes.some((n: any) => n.keyword === "«verification»"));
  const bdd = g("bdd");
  assert.ok(bdd.nodes.filter((n: any) => n.shape === "def").every((n: any) => n.keyword === "«part def»"));
  // 組成：定義 ◆— 零件（使用），零件再以「defined by」指向它的定義
  const comp = bdd.edges.filter((e: any) => e.kind === "compose");
  assert.ok(comp.length >= 3 && comp.every((e: any) => e.tail === "diamond" && bdd.nodes.find((n: any) => n.id === e.target)?.keyword === "«part»"));
  assert.ok(bdd.edges.filter((e: any) => e.kind === "define").every((e: any) => e.head === "typing" && bdd.nodes.find((n: any) => n.id === e.target)?.shape === "def"));
  const act = g("act");
  assert.deepEqual([act.nodes[0].shape, act.nodes[act.nodes.length - 1].shape], ["start", "done"]);
  assert.ok(act.nodes.filter((n: any) => n.el).every((n: any) => n.keyword === "«action»" && n.shape === "usage"));
  const stm = g("stm");
  assert.ok(stm.nodes.some((n: any) => n.keyword === "«state»") && stm.nodes.some((n: any) => n.shape === "start"));
  const svg = toSvg("«view» t : GeneralView", bdd.nodes.map((n: any, i: number) => ({ g: n, x: i * 240, y: 0 })), bdd.edges);
  assert.match(svg, /«view» t : GeneralView/);
  assert.match(svg, /rx="10"/);
  assert.match(svg, /url\(#typ\)/);
});

test("套件：建立、搬進搬出、原有引用不受影響、版面識別碼跟著換", async () => {
  await call(`${I}/api/projects`, "POST", { id: "p1", name: "套件測試", kind: "annual", template: "sample" });
  const base = `${I}/api/projects/p1`;
  let r = await call(`${base}/packages`, "POST", { name: "JRI 團隊" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const pkg0 = r.data.created;
  assert.ok(pkg0);
  assert.equal((await call(`${base}/packages`, "POST", { name: "JRI 團隊" })).status, 400, "同名套件被拒絕");
  const els = () => call(base).then((x) => x.data.analysis.elements as any[]);
  const teacher = (await els()).find((e) => e.name === "指導老師");
  const sys = (await els()).find((e) => e.name === "火箭" && e.kind === "PartDefinition");
  // 版面與自訂圖裡記著舊的識別碼
  await call(`${base}/layout`, "PUT", { layout: { uc: { [teacher.id]: { x: 100, y: 200 }, [pkg0]: { x: 0, y: 0, w: 400, h: 300 } } } });
  await call(`${base}/diagrams`, "PUT", { diagrams: { custom: [{ id: "custom:c1", title: "總覽", members: [teacher.id, sys.id] }], notes: {} } });
  r = await call(`${base}/elements/move`, "POST", { ids: [teacher.id], packageId: pkg0 });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const moved = r.data.moved[teacher.id];
  const pkg = r.data.packageId;
  assert.ok(moved && moved !== teacher.id, "搬進套件後識別碼改變");
  const after = r.data.analysis.elements.find((e: any) => e.id === moved);
  assert.equal(after.qualifiedName, "Project::Stakeholders::JRI 團隊::指導老師", "空套件會搬到項目所在的套件底下");
  assert.equal(after.category, "Stakeholder");
  // 原本以名稱與「Stakeholders::名稱」引用它的兩條關係都還在
  assert.equal(r.data.analysis.relations.filter((q: any) => q.to === moved && q.kind === "trace").length, 2);
  assert.deepEqual(r.data.layout.uc[moved], { x: 100, y: 200 });
  assert.deepEqual(r.data.layout.uc[pkg], { x: 0, y: 0, w: 400, h: 300 });
  assert.deepEqual(r.data.diagrams.custom[0].members, [moved, sys.id]);
  const src = (await call(`${base}/files/model.sysml`)).data.content as string;
  assert.match(src, /public import 'JRI 團隊'::\*;\s+package 'JRI 團隊' \{\s+part <'STK-002'> '指導老師' : Stakeholder/);
  // 別的類別套件裡的項目放不進來；有成員的套件不能刪
  r = await call(`${base}/elements/move`, "POST", { ids: [sys.id], packageId: pkg });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /請另建一個套件/);
  r = await call(`${base}/elements/delete`, "POST", { id: pkg });
  assert.match(r.data.error, /裡面還有項目/);
  // 搬進套件之後才建立的關係會用完整名稱；移出時要一起改回來
  const uc2 = (await els()).find((e) => e.name === "尋回火箭");
  assert.equal((await call(`${base}/relations`, "POST", { kind: "trace", from: uc2.id, to: moved })).status, 200);
  // 改名：import 與引用一起改，位置不遺失
  r = await call(`${base}/elements`, "PATCH", { id: pkg, name: "團隊" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const pkg2 = r.data.selected;
  const lay = (await call(`${base}/layout`)).data;
  assert.deepEqual(lay.uc[pkg2], { x: 0, y: 0, w: 400, h: 300 });
  const moved2 = (await els()).find((e) => e.name === "指導老師").id;
  assert.deepEqual(lay.uc[moved2], { x: 100, y: 200 });
  // 移出
  r = await call(`${base}/elements/move`, "POST", { ids: [moved2], packageId: null });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.equal(r.data.moved[moved2], teacher.id, "移出後回到原本的識別碼");
  assert.equal(r.data.analysis.relations.filter((q: any) => q.to === teacher.id && q.kind === "trace").length, 3);
  assert.deepEqual(r.data.layout.uc[teacher.id], { x: 100, y: 200 });
  // 空套件可以刪，連同 import
  r = await call(`${base}/elements/delete`, "POST", { id: pkg2 });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  assert.doesNotMatch((await call(`${base}/files/model.sysml`)).data.content, /'團隊'/);
  // 工具依類別建立的套件不能刪
  const stk = (await els()).find((e) => e.kind === "Package" && e.name === "Stakeholders");
  assert.match((await call(`${base}/elements/delete`, "POST", { id: stk.id })).data.error, /不能刪除/);
});

test("註解寫進模型：comment about 對象，可修改與刪除", async () => {
  const base = `${I}/api/projects/p1`;
  const teacher = (await call(base)).data.analysis.elements.find((e: any) => e.name === "指導老師");
  let r = await call(`${base}/comments`, "POST", { text: "負責安全 */ 審查", aboutId: teacher.id });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  const c = r.data.analysis.elements.find((e: any) => e.id === r.data.created);
  assert.deepEqual([c.kind, c.about, c.doc], ["Comment", [teacher.id], "負責安全 * / 審查"]);
  assert.match((await call(`${base}/files/model.sysml`)).data.content, /comment Note1 about '指導老師' \/\* 負責安全 \* \/ 審查 \*\//);
  r = await call(`${base}/comments`, "PATCH", { id: c.id, text: "改過的內容" });
  assert.equal(r.data.analysis.elements.find((e: any) => e.id === c.id).doc, "改過的內容");
  // 沒有對象的註解寫在根套件
  r = await call(`${base}/comments`, "POST", { text: "整體說明" });
  const c2 = r.data.analysis.elements.find((e: any) => e.id === r.data.created);
  assert.deepEqual([c2.name, c2.about.length <= 1], ["Note2", true]);
  // 圖上：註解節點與虛線連到對象
  const { buildGraph, diagramsOf } = await import("../web/src/model.ts");
  const a = r.data.analysis;
  const g = buildGraph(diagramsOf(a).find((d: any) => d.kind === "uc") as any, a, { packages: new Set(["Stakeholders"]), shown: new Set() });
  assert.ok(g.nodes.some((n: any) => n.id === c.id && n.shape === "comment"));
  assert.ok(g.edges.some((e: any) => e.kind === "annotate" && e.source === c.id && e.target === teacher.id && e.dashed && e.head === "none"));
  r = await call(`${base}/elements/delete`, "POST", { id: c.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.analysis.elements.some((e: any) => e.id === c.id), false);
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

test("復原與重做：可以連續往回、往前；誤刪的項目回到原位；新的修改會清掉重做", async () => {
  await call(`${I}/api/projects`, "POST", { id: "u1", name: "復原測試", kind: "annual", template: "sample" });
  const base = `${I}/api/projects/u1`;
  const first = (await call(base)).data;
  const names = (d: any) => d.analysis.elements.map((e: any) => e.name);
  const find = (d: any, n: string) => d.analysis.elements.find((e: any) => e.name === n);
  const uc = find(first, "尋回火箭");
  const teacher = find(first, "指導老師");
  assert.ok(uc && teacher);
  await call(`${base}/layout`, "PUT", { layout: { uc: { [uc.id]: { x: 320, y: 480 } } } });
  // 三步：刪掉使用案例、建套件、把老師搬進套件
  assert.equal((await call(`${base}/elements/delete`, "POST", { id: uc.id })).status, 200);
  const pkg = (await call(`${base}/packages`, "POST", { name: "團隊" })).data.created;
  let r = await call(`${base}/elements/move`, "POST", { ids: [teacher.id], packageId: pkg });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.deepEqual(r.data.history, { undo: true, redo: false });
  // 往回三步：回到一開始
  r = await call(`${base}/undo`, "POST", {});
  assert.equal(find(r.data, "指導老師").id, teacher.id, "老師回到套件外");
  r = await call(`${base}/undo`, "POST", {});
  assert.ok(!names(r.data).includes("團隊"));
  r = await call(`${base}/undo`, "POST", {});
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok(names(r.data).includes("尋回火箭"), "誤刪的項目救回來");
  assert.deepEqual(r.data.layout.uc[uc.id], { x: 320, y: 480 }, "回到原本的位置");
  assert.equal(r.data.analysis.relations.length, first.analysis.relations.length);
  assert.equal(r.data.history.redo, true);
  // 往前兩步，再往回一步
  r = await call(`${base}/redo`, "POST", {});
  assert.ok(!names(r.data).includes("尋回火箭"));
  r = await call(`${base}/redo`, "POST", {});
  assert.ok(names(r.data).includes("團隊"));
  r = await call(`${base}/undo`, "POST", {});
  assert.ok(!names(r.data).includes("團隊") && !names(r.data).includes("尋回火箭"));
  // 做了新的修改：不能再重做；復原會先退掉這次修改，再往更早走
  r = await call(`${base}/comments`, "POST", { text: "新的修改" });
  assert.deepEqual(r.data.history, { undo: true, redo: false });
  assert.equal((await call(`${base}/redo`, "POST", {})).status, 400);
  r = await call(`${base}/undo`, "POST", {});
  assert.ok(!names(r.data).includes("Note1") && !names(r.data).includes("尋回火箭"));
  r = await call(`${base}/undo`, "POST", {});
  assert.ok(names(r.data).includes("尋回火箭"), "再往回是刪除之前，不是把復原過的步驟做回來");
  assert.equal(r.data.history.undo, false, "已經回到建立專案時");
  assert.equal((await call(`${base}/undo`, "POST", {})).status, 400);
});

test("主機名稱不符的請求被拒絕；修改會排隊；版面可以只存一張圖；回應有壓縮", async () => {
  const raw = (pathname: string, init: RequestInit = {}) => fetch(`${I}${pathname}`, init);
  // 別的網域指到這台電腦（DNS 重新綁定）時，Host 會是對方的名字
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const u = new URL(I);
    const r = request({ host: u.hostname, port: u.port, path: "/api/projects", headers: { host: "evil.example:8787" } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
    r.on("error", reject); r.end();
  });
  assert.equal(status, 421);
  assert.equal((await raw("/api/projects")).status, 200);

  await call(`${I}/api/projects`, "POST", { id: "q1", name: "排隊測試", kind: "annual", template: "sample" });
  const base = `${I}/api/projects/q1`;
  // 同時送出八個新增：全部都要成功，而且八個都在
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => call(`${base}/comments`, "POST", { text: `同時 ${i}` })));
  assert.deepEqual(rs.map((r) => r.status), Array(8).fill(200), String(JSON.stringify(rs.find((r) => r.status !== 200)?.data)).slice(0, 200));
  const els = (await call(base)).data.analysis.elements;
  assert.equal(els.filter((e: any) => e.kind === "Comment").length, 8);

  // 兩個人各存一張圖，互不影響
  await call(`${base}/layout`, "PATCH", { diagram: "uc", nodes: { a: { x: 1, y: 2 } } });
  await call(`${base}/layout`, "PATCH", { diagram: "req", nodes: { b: { x: 3, y: 4 } } });
  assert.deepEqual((await call(`${base}/layout`)).data, { uc: { a: { x: 1, y: 2 } }, req: { b: { x: 3, y: 4 } } });
  await call(`${base}/layout`, "PATCH", { diagram: "uc", nodes: null });
  assert.deepEqual(Object.keys((await call(`${base}/layout`)).data), ["req"]);

  const res = await raw("/api/projects/q1", { headers: { "accept-encoding": "gzip" } });
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal((await res.json()).project.id, "q1");
  assert.match(String(res.headers.get("content-security-policy")), /default-src 'self'/);
  assert.equal(res.headers.get("x-powered-by"), null);

  // 不存在的專案不會留下空資料夾
  assert.equal((await call(`${I}/api/projects/ghost-zz/elements/delete`, "POST", { id: "x" })).status, 400);
  assert.equal((await call(`${I}/api/projects`)).data.some((p: any) => p.id === "ghost-zz"), false);
});
