// 依套件瀏覽的樹（F-74、F-75）。內容都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyze, shutdown } from "../../server/engine.ts";
import { ancestorsOf, descendantsOf, packageOf, treeOf } from "./model.ts";
import type { Analysis } from "./api.ts";

const read = (rel: string) => fs.readFile(new URL(rel, import.meta.url), "utf8");
after(() => shutdown());
// 伺服器的解析結果就是畫面拿到的資料
const load = async (...sources: [string, string][]) => { const a = await analyze(sources); assert.equal(a.ok, true); return a as unknown as Analysis; };

test("套件樹：每個元素恰好出現一次，依擁有關係往下，同一層依行號排", async () => {
  const a = await load(["generic.sysml", await read("../../server/fixtures/generic.sysml")]);
  const t = treeOf(a);
  assert.equal(t.all.length, a.elements.length + a.unnamed.length);
  assert.equal(new Set(t.all.map((e) => e.id)).size, t.all.length, "沒有重複");
  const q = (id: string | null | undefined) => (id == null ? null : t.byId.get(id)?.qualifiedName);
  const kids = (name: string | null) => (t.children.get(name === null ? null : (t.all.find((e) => e.qualifiedName === name)?.id as string)) ?? []).map((e) => `${e.keyword} ${e.name}`);
  assert.deepEqual(kids(null), ["package G"]);
  assert.deepEqual(kids("G"), ["part def Base", "part def Wheel", "action def Spin", "part def Car", "requirement def Limit", "part car", "part spare"]);
  // 沒有名字的使用排在它寫的位置，不是全部擠在最後
  assert.deepEqual(kids("G::Car"), ["part wheel", "attribute count", "perform spin", "perform action brake"]);
  assert.deepEqual(kids("G::Limit"), ["attribute limit", "require constraint require constraint { limit > 0 }"]);
  // 擁有者沒有名字時，掛在那個沒有名字的使用底下
  const pressure = t.all.find((e) => e.name === "pressure");
  assert.ok(pressure);
  assert.deepEqual(ancestorsOf(t, pressure.id).map(q), ["G::Car::wheel", "G::Car", "G"]);
  assert.equal(q(packageOf(t, pressure.id)), "G");
  const g = t.all.find((e) => e.name === "G");
  assert.ok(g);
  assert.equal(packageOf(t, g.id), g.id);
  // 底下一共有幾個、列出來的順序
  assert.equal(t.size.get(g.id), t.all.length - 1);
  const car = t.all.find((e) => e.qualifiedName === "G::Car" && !e.unnamed);
  assert.ok(car);
  assert.deepEqual(descendantsOf(t, car.id).map((e) => e.name), ["wheel", "pressure", "count", "spin", "brake"]);
  assert.equal(descendantsOf(t, null).length, t.all.length);
});

test("套件樹：多個檔案、多個最上層套件；JRI 的範本專案也是同一棵樹", async () => {
  const two = treeOf(await load(["b/second.sysml", "package Second {\n    part def B;\n}\n"], ["a/first.sysml", "package First {\n    package Inner { part def A; }\n}\n"]));
  assert.deepEqual((two.children.get(null) ?? []).map((e) => e.name), ["First", "Second"], "最上層依檔案路徑排");
  assert.deepEqual(two.all.map((e) => e.name), ["First", "Inner", "A", "Second", "B"]);

  const lib = await read("../../library/JRI.sysml");
  const a = await load(["JRI.sysml", lib], ["model.sysml", await read("../../templates/sounding-rocket/model.sysml")]);
  const t = treeOf(a);
  // 元模型庫不在樹上；範本的元素全部在根套件 Project 底下，原本依類別看得到的每一個都找得到
  assert.deepEqual((t.children.get(null) ?? []).map((e) => e.name), ["Project"]);
  assert.equal(t.all.filter((e) => !e.unnamed).length, a.elements.length);
  const project = t.all[0];
  for (const e of a.elements.filter((x) => x.category)) assert.ok(e.id === project.id || ancestorsOf(t, e.id).includes(project.id), `${e.name} 不在 Project 底下`);
  assert.deepEqual((t.children.get(project.id) ?? []).filter((e) => e.kind === "Package").map((e) => e.name), ["Stakeholders", "NGOs", "Structure", "Behavior", "UseCases", "Requirements", "Verification", "Risks"], "和範本檔裡寫的順序相同");
});
