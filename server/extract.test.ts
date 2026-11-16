// 解析結果的測試。內容都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyze, shutdown } from "./engine.ts";
import { KINDS, PRELUDE } from "./fixtures/kinds.ts";

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

// ───────── 通用的元素與關係（F-71）─────────

test("只有一個檔案時，元素仍然標得出所在的檔案", async () => {
  // 解析器只在有兩個以上的檔案時才標示每個套件來自哪個檔
  const a = await analyze([["sub/only.sysml", "package Only {\n    part def A;\n}\n"]]);
  assert.equal(a.ok, true);
  assert.deepEqual(a.elements.map((e) => [e.name, e.file]), [["Only", "sub/only.sysml"], ["A", "sub/only.sysml"]]);
});

test("SysML v2 的每一種定義與使用都列得出來，元類別與關鍵字正確", async (t) => {
  const gaps: string[] = [];
  for (const r of KINDS) {
    const a = await analyze([["kinds.sysml", r.top ? `${r.source}\n` : `package K {${PRELUDE}    ${r.source}\n}\n`]]);
    const e = a.elements.find((x) => x.name === r.name);
    if (r.supported === false) {
      // 已知的缺口：解析器哪天接受了，這裡會失敗，提醒把這一列改回來
      assert.equal(a.ok, false, `${r.label}：解析器現在接受這個寫法了，請把 supported: false 拿掉`);
      gaps.push(`${r.label}：${a.diagnostics.find((d) => d.severity === "error")?.message}`);
      continue;
    }
    assert.equal(a.ok, true, `${r.label}：${JSON.stringify(a.diagnostics.filter((d) => d.severity === "error")).slice(0, 200)}`);
    assert.ok(e, `${r.label}：找不到 ${r.name}`);
    assert.deepEqual([e.kind, e.keyword, e.file], [r.kind, r.keyword, "kinds.sysml"], r.label);
    // 樹接得起來：每個元素往上都走得到最上層的套件
    const byId = new Map([...a.elements, ...a.unnamed].map((x) => [x.id, x]));
    for (const x of byId.values()) {
      let cur = x, steps = 0;
      while (cur.parent) { const up = byId.get(cur.parent); assert.ok(up, `${r.label}：${x.name} 的上層不在清單裡`); cur = up; assert.ok(++steps < 50); }
      assert.equal(cur.kind.endsWith("Package"), true, `${r.label}：${x.name} 的最上層不是套件`);
    }
  }
  t.diagnostic(`涵蓋 ${KINDS.length} 列，已知缺口 ${gaps.length} 列：${gaps.join("；")}`);
});

test("通用的關係與沒有名字的使用：特化、由誰定義、子集、重定義、參照、執行；對象在標準庫時帶名稱", async () => {
  const a = await analyze([["generic.sysml", await read("./fixtures/generic.sysml")]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 300));
  const all = [...a.elements, ...a.unnamed];
  const q = (id: string | null) => (id === null ? null : all.find((e) => e.id === id)?.qualifiedName);

  // 沒有名字的使用另外列，不混進 elements（現有的畫面與檢查只讀 elements）
  assert.equal(a.elements.some((e) => e.unnamed), false);
  assert.deepEqual(a.unnamed.map((e) => [e.keyword, e.name, q(e.parent ?? null)]), [
    ["part", "wheel", "G::Car"],
    ["attribute", "count", "G::Car"],
    ["perform", "spin", "G::Car"],
    ["require constraint", "require constraint { limit > 0 }", "G::Limit"],
  ]);
  // 擁有者沒有名字時，上層就是那個沒有名字的使用
  const pressure = a.elements.find((e) => e.name === "pressure");
  assert.equal(pressure?.parent, a.unnamed[0].id);
  assert.equal(a.elements.find((e) => e.name === "G")?.parent, null);
  assert.equal(a.elements.find((e) => e.name === "brake")?.keyword, "perform action");

  assert.deepEqual(a.links.map((l) => `${l.kind} ${q(l.from)} → ${l.to ? q(l.to) : `(${l.toName})`}`), [
    "subset G::Base::mass → (mass)",
    "type G::Base::count → (Integer)",
    "type G::Base::wheel → G::Wheel",
    "type G::Base::spin → G::Spin",
    "specialize G::Car → G::Base",
    "redefine G::Car::wheel → G::Base::wheel",
    "type G::Car::wheel::pressure → (Real)",
    "redefine G::Car::count → G::Base::count",
    "reference G::Car::spin → G::Base::spin",
    "type G::Car::brake → G::Spin",
    "type G::Limit::limit → (Real)",
    "type G::car → G::Car",
    "subset G::spare → G::car",
    "perform G::Car → G::Base::spin",
    "perform G::Car → G::Car::brake",
  ]);
  // 有列出來的對象，名稱也一併帶著
  assert.equal(a.links.find((l) => l.kind === "specialize")?.toName, "Base");
});
