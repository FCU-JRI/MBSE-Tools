// 資料檔（JSON）三方合併的單元測試。執行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { merge3 } from "./versions.ts";

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
