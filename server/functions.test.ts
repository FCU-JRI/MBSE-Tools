// 功能清單 framework/functions.json 的一致性與覆蓋檢查。不啟動伺服器。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFramework } from "./framework.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
interface Fn { id: string; zh: string; area: string; reads: string[]; writes: string[]; status: string; sources: string; framework: string; verify: string; note: string }
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "framework", "functions.json"), "utf8")) as { stores: { id: string }[]; functions: Fn[]; flows: { id: string; steps: string[]; gaps: string[] }[]; statusZh: Record<string, string> };
const ids = new Set(doc.functions.map((f) => f.id));

test("功能清單：編號不重複、狀態有效、讀寫的資料都有定義", () => {
  assert.equal(ids.size, doc.functions.length, "編號重複");
  const stores = new Set(doc.stores.map((s) => s.id));
  for (const f of doc.functions) {
    assert.ok(f.status in doc.statusZh, `${f.id} 狀態 ${f.status} 無效`);
    for (const s of [...f.reads, ...f.writes]) assert.ok(stores.has(s), `${f.id} 用了未定義的資料 ${s}`);
  }
});

test("功能清單：每項都有依據（無依據的標 orphan）、未完成的都寫了原因或驗收", () => {
  for (const f of doc.functions) {
    if (f.status !== "orphan") assert.ok(f.sources.trim(), `${f.id} 沒有依據`);
    if (f.status === "wrong" || f.status === "partial") assert.ok(f.note.trim(), `${f.id} 是 ${f.status} 卻沒寫原因`);
    if (f.status === "missing") assert.ok(f.verify.trim() || f.note.trim(), `${f.id} 缺驗收方式`);
  }
});

test("功能清單：跨頁流程引用的功能都存在，缺口都是未完成的功能", () => {
  for (const fl of doc.flows) {
    for (const s of fl.steps) assert.ok(ids.has(s), `${fl.id} 引用不存在的 ${s}`);
    for (const g of fl.gaps) {
      assert.ok(fl.steps.includes(g), `${fl.id} 的缺口 ${g} 不在流程裡`);
      const st = doc.functions.find((f) => f.id === g)!.status;
      assert.ok(st !== "ok", `${fl.id} 把 ${g} 列為缺口，但它的狀態是 ok`);
    }
  }
});

test("覆蓋：框架的每個迴圈步驟與貫穿全程項目，至少有一個功能對應", () => {
  const fw = loadFramework();
  const refs = doc.functions.map((f) => f.framework).join(" ");
  for (const s of fw.designLoop.steps) assert.ok(refs.includes(`designLoop.${s.id}`), `迴圈步驟 ${s.id} 沒有功能對應`);
  for (const c of fw.crossCutting) assert.ok(refs.includes(`crossCutting.${c.id}`), `貫穿全程 ${c.id} 沒有功能對應`);
});
