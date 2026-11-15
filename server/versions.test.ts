// 資料檔（JSON）三方合併的單元測試。執行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3, resolveConflicts, resolveHunk } from "./versions.ts";

test("JSON 三方合併：各改各的都保留，刪除會生效，改到同一個值依 prefer", () => {
  const base = { bdd: { a: { x: 0, y: 0 }, gone: { x: 9, y: 9 } }, tasks: [{ id: "J1", title: "原本" }, { id: "J2", title: "會被刪" }], last: 1 };
  const ours = { bdd: { a: { x: 1, y: 0 }, gone: { x: 9, y: 9 } }, tasks: [{ id: "J1", title: "原本" }, { id: "J3", title: "我們加的" }], last: 2 };
  const theirs = { bdd: { a: { x: 0, y: 0 }, b: { x: 5, y: 5 } }, req: { c: { x: 7, y: 7 } }, tasks: [{ id: "J1", title: "對方改的" }, { id: "J2", title: "會被刪" }, { id: "J4", title: "對方加的" }], last: 3 };
  assert.deepEqual(merge3(base, ours, theirs, "ours"), {
    bdd: { a: { x: 1, y: 0 }, b: { x: 5, y: 5 } },
    req: { c: { x: 7, y: 7 } },
    tasks: [{ id: "J1", title: "對方改的" }, { id: "J3", title: "我們加的" }, { id: "J4", title: "對方加的" }],
    last: 2,
  });
  assert.equal((merge3(base, ours, theirs, "theirs") as { last: number }).last, 3);
});

test("JSON 三方合併：兩邊各自新建檔案（沒有共同的上一版）也能合併", () => {
  assert.deepEqual(merge3(undefined, { bdd: { a: { x: 1, y: 2 } } }, { bdd: { b: { x: 3, y: 4 } } }, "ours"), { bdd: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } } });
  assert.equal(merge3({ k: 1 }, undefined, { k: 1 }, "ours"), undefined, "一邊刪掉、另一邊沒動：刪掉");
});

// 以下的模型內容都是合成的
const T1 = "#trace dependency from S::'甲' to N::'總目標';", T2 = "#trace dependency from S::'乙' to N::'總目標';";
const PKG = "package '空的' { }";
const R1 = "#refine dependency from N::'子目標一' to N::'總目標';", R2 = "#refine dependency from N::'子目標二' to N::'總目標';";
const D1 = "#derive dependency from N::'子目標一' to N::'總目標';", D2 = "#derive dependency from N::'子目標二' to N::'另一個上位目標';";

test("模型衝突：一邊只刪了幾行，另一邊也刪了同樣幾行還多改了別的 → 採用改得多的那一邊", () => {
  const base = [T1, T2, PKG, R1, R2];
  assert.deepEqual(resolveHunk(base, [PKG, R1, R2], [D1, D2]), [D1, D2]);
  assert.deepEqual(resolveHunk(base, [D1, D2], [PKG, R1, R2]), [D1, D2], "哪一邊是自己、哪一邊是對方都一樣");
  assert.deepEqual(resolveHunk(["a", "a", "b"], ["a", "b"], ["b"]), ["b"], "重複的行按數量算");
});

test("模型衝突：需要人判斷的情況不自動解決", () => {
  assert.equal(resolveHunk([T1, R1], [R1], [T1.replace("#trace", "#derive"), R1]), null, "一邊刪掉、另一邊改寫同一行");
  assert.equal(resolveHunk([R1], [R1, T1], [R1, T2]), null, "兩邊各自新增不同的內容");
  assert.equal(resolveHunk([T1, T2, R1], [T1], [T2, R1, D2]), null, "一邊刪的，另一邊還留著");
  assert.equal(resolveHunk(["a", "a", "b"], ["a", "b"], ["a", "a"]), null);
});

test("模型衝突：整個檔案只有在每一段都能自動解決時才處理", () => {
  const hunk = (ours: string[], base: string[], theirs: string[]) => ["<<<<<<< HEAD", ...ours, "||||||| 1234abc", ...base, "=======", ...theirs, ">>>>>>> 5678def"];
  const okHunk = hunk([PKG, R1, R2], [T1, T2, PKG, R1, R2], [D1, D2]);
  const text = (lines: string[]) => ["package Project {", ...lines, "}", ""].join("\n");
  assert.deepEqual(resolveConflicts(text(okHunk)), { text: text([D1, D2]), resolved: 1 });
  assert.equal(resolveConflicts(text([...okHunk, "part x;", ...hunk([R1, T1], [R1], [R1, T2])])), null);
  assert.equal(resolveConflicts(text([R1])), null, "沒有衝突標記的檔案（例如一邊整個刪掉）不處理");
});
