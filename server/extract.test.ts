// 解析結果的測試。內容都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyze, shutdown } from "./engine.ts";

const read = (rel: string) => fs.readFile(new URL(rel, import.meta.url), "utf8");
const lib = await read("../library/JRI.sysml");
after(() => shutdown());

// ───────── 前後比對：現有欄位不能因為之後的修改而改變 ─────────
// 基準檔 fixtures/golden.json 是在加入通用欄位（F-71）之前，用當時的程式產生的。
// 之後新增的欄位不在基準檔裡，不比對；基準檔裡有的欄位必須逐一相同。
const golden = JSON.parse(await read("./fixtures/golden.json")) as Record<string, { ok: boolean; elements: Record<string, unknown>[]; relations: unknown[]; satisfaction: unknown[] }>;
const MODELS: Record<string, string> = { "sounding-rocket": "../templates/sounding-rocket/model.sysml", blank: "../templates/blank/model.sysml", "jri-extra": "./fixtures/jri-extra.sysml" };

for (const [name, file] of Object.entries(MODELS)) {
  test(`前後比對：${name} 的現有欄位和基準檔相同`, async () => {
    const a = await analyze([["JRI.sysml", lib], ["model.sysml", await read(file)]]);
    const want = golden[name];
    assert.equal(a.ok, want.ok);
    assert.equal(a.elements.length, want.elements.length, "元素數量");
    a.elements.forEach((e, i) => {
      const w = want.elements[i];
      const got = Object.fromEntries(Object.keys(w).map((k) => [k, (e as unknown as Record<string, unknown>)[k]]));
      assert.deepEqual(JSON.parse(JSON.stringify(got)), w, `第 ${i} 個元素 ${String(w.name)}`);
    });
    assert.deepEqual(JSON.parse(JSON.stringify(a.relations)), want.relations, "關係");
    assert.deepEqual(JSON.parse(JSON.stringify(a.satisfaction)), want.satisfaction, "判定");
  });
}
