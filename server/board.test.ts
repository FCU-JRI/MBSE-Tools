// 討論白板：逐項合併、刪除、唯讀、分支、提交進專案儲存庫。執行：npm test
// 內容都是合成的。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyOps } from "./board.ts";
import type { Board, Item } from "./board.ts";

const PORT = 18827, PUB = 18828; // 和其他測試檔錯開
const I = `http://127.0.0.1:${PORT}`, P = `http://127.0.0.1:${PUB}`;
const M = `${I}/api/projects/b1`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(url, { method, redirect: "manual", headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data, cookies: r.headers.getSetCookie() };
}

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-board-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_BOARD_COMMIT_MS: "200" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const r = await call(`${I}/api/projects`, "POST", { id: "b1", name: "白板測試", kind: "annual", template: "blank" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
});

after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

const note = (id: string, extra: Partial<Item> = {}) => ({ id: `note:${id}`, kind: "note", x: 10, y: 20, w: 180, h: 110, text: "合成便利貼", color: "yellow", ...extra });

test("合併：兩人各改同一張便利貼的不同欄位，兩邊都保留；改同一欄以後送的為準", () => {
  const empty: Board = { items: [], by: "", at: "" };
  let b = applyOps(empty, [{ op: "put", item: note("a") }], "甲", "t1").board;
  const base = b.items[0];
  assert.equal(base.author, "甲");
  b = applyOps(b, [{ op: "put", base, item: { ...base, x: 300 } }], "甲", "t2").board; // 甲移動
  b = applyOps(b, [{ op: "put", base, item: { ...base, text: "乙改的字" } }], "乙", "t3").board; // 乙改字（還沒看到甲的移動）
  assert.equal(b.items[0].x, 300, "甲的移動沒被乙蓋掉");
  assert.equal(b.items[0].text, "乙改的字");
  assert.equal(b.items[0].author, "甲", "建立者不變");
  assert.equal(b.items[0].by, "乙");
  assert.equal(b.by, "乙");
  b = applyOps(b, [{ op: "put", base, item: { ...base, text: "丙改的字" } }], "丙", "t4").board;
  assert.equal(b.items[0].text, "丙改的字");
});

test("刪除：連線跟著刪；別人刪掉的項目不會因為舊的修改復活", () => {
  const empty: Board = { items: [], by: "", at: "" };
  let b = applyOps(empty, [{ op: "put", item: note("a") }, { op: "put", item: note("b") }, { op: "put", item: { id: "link:1", kind: "link", from: "note:a", to: "note:b", text: "" } }], "甲", "t1").board;
  assert.equal(b.items.length, 3);
  const base = b.items[0];
  b = applyOps(b, [{ op: "del", id: "note:a" }], "甲", "t2").board;
  assert.deepEqual(b.items.map((i) => i.id), ["note:b"]);
  const r = applyOps(b, [{ op: "put", base, item: { ...base, x: 999 } }], "乙", "t3");
  assert.deepEqual(r.skipped, ["note:a"]);
  assert.equal(r.board.items.length, 1);
  // 兩端不存在的連線不收
  assert.equal(applyOps(b, [{ op: "put", item: { id: "link:2", kind: "link", from: "note:b", to: "note:zz", text: "" } }], "甲").board.items.length, 1);
});

test("API：新增、移動、改字、連到元素、取消連結、框、連線、刪除；檔案提交進專案儲存庫", async () => {
  let r = await call(`${M}/board`, "POST", { ops: [note("n1", { text: "推進：合成測試排程" }), note("n2"), { id: "frame:f1", kind: "frame", x: 0, y: 200, w: 500, h: 200, text: "MDR 前要決定的事" }].map((item) => ({ op: "put", item })) });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  const n1 = r.data.board.items.find((i: Item) => i.id === "note:n1");
  r = await call(`${M}/board`, "POST", { ops: [
    { op: "put", base: n1, item: { ...n1, x: 400, y: 50, w: 240, h: 140, text: "改過的字", color: "blue", ref: "SR-004" } },
    { op: "put", item: { id: "link:l1", kind: "link", from: "note:n1", to: "frame:f1", text: "" } },
  ] });
  assert.equal(r.status, 200);
  const got = (await call(`${M}/board`)).data as Board;
  const m = got.items.find((i) => i.id === "note:n1")!;
  assert.deepEqual([m.x, m.y, m.w, m.h, m.text, m.color, m.ref], [400, 50, 240, 140, "改過的字", "blue", "SR-004"]);
  assert.ok(got.items.some((i) => i.id === "link:l1"));
  assert.ok(got.by && got.at, "有最後更新者與時間");

  // 取消連結
  r = await call(`${M}/board`, "POST", { ops: [{ op: "put", base: m, item: { ...m, ref: undefined } }] });
  assert.equal((r.data.board.items as Item[]).find((i) => i.id === "note:n1")!.ref, undefined);
  // 刪除框，連到它的線一起刪
  r = await call(`${M}/board`, "POST", { ops: [{ op: "del", id: "frame:f1" }] });
  assert.deepEqual((r.data.board.items as Item[]).map((i) => i.id).sort(), ["note:n1", "note:n2"]);
  // 格式不對的被拒絕
  assert.equal((await call(`${M}/board`, "POST", { ops: [{ op: "put", item: { id: "bad", kind: "note" } }] })).status, 400);

  // 停手後提交進專案儲存庫
  const dir = path.join(home, "projects", "b1");
  let log = "";
  for (let i = 0; i < 30 && !/白板/.test(log); i++) {
    await new Promise((res) => setTimeout(res, 200));
    log = execFileSync("git", ["log", "--pretty=%s", "-5", "--", "board.json"], { cwd: dir, encoding: "utf8" });
  }
  assert.match(log, /更新討論白板/);
  assert.equal(execFileSync("git", ["status", "--porcelain", "--", "board.json"], { cwd: dir, encoding: "utf8" }), "");
});

test("唯讀連結只能看白板", async () => {
  const made = await call(`${I}/api/admin/shares`, "POST", { project: "b1", label: "審查委員", days: 1 });
  assert.equal(made.status, 200);
  const opened = await call(P + made.data.path);
  const cookie = opened.cookies.map((c) => c.split(";")[0]).join("; ");
  assert.equal((await call(`${P}/api/projects/b1/board`, "GET", undefined, { cookie })).status, 200);
  assert.equal((await call(`${P}/api/projects/b1/board`, "POST", { ops: [{ op: "del", id: "note:n1" }] }, { cookie })).status, 403);
  assert.ok((await call(`${M}/board`)).data.items.some((i: Item) => i.id === "note:n1"));
});

test("分支上的白板只存在分支", async () => {
  const dir = path.join(home, "projects", "b1");
  execFileSync("git", ["branch", "feature/board"], { cwd: dir });
  const B = `${I}/api/projects/b1@feature~board`;
  assert.equal((await call(B)).status, 200);
  const r = await call(`${B}/board`, "POST", { ops: [{ op: "put", item: note("branch-only", { text: "分支上的便利貼" }) }] });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 200));
  assert.ok((await call(`${B}/board`)).data.items.some((i: Item) => i.id === "note:branch-only"));
  assert.ok(!(await call(`${M}/board`)).data.items.some((i: Item) => i.id === "note:branch-only"));
});
