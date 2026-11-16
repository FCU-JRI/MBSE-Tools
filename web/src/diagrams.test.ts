// 套件內容圖與零件定義的分解圖（F-76）。內容都是合成的；Apollo 11 參考模型只用來檢查涵蓋範圍。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, shutdown } from "../../server/engine.ts";
import { buildGraph, diagramsOf, frameLabel, LINK_TOOLS, NODE_LIMIT, paletteOf, seedLayout, TOP_DIAGRAM, treeOf } from "./model.ts";
import type { DiagramDef, Graph } from "./model.ts";
import { toSvg } from "./exportSvg.ts";
import type { Analysis } from "./api.ts";

after(() => shutdown());
const load = async (...sources: [string, string][]) => { const a = await analyze(sources); assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400)); return a as unknown as Analysis; };
const here = path.dirname(fileURLToPath(import.meta.url));

const MODEL = `package Top {
    package Inner { part def Leaf; }
    part def Base { attribute mass; }
    part def Hub :> Base;
    part def Wheel :> Base {
        attribute radius;
        part hub : Hub;
    }
    part def Car :> Base {
        part wheel : Wheel;
        ref part spare : Wheel;
        part again : Car;
        attribute count;
        action spin { action inner; }
    }
    part def SportsCar :> Car {
        part :>> wheel;
        part extra : Wheel :> wheel;
    }
    item def Fuel;
    part car : Car;
    ref part other ::> car;
}
`;
const graphOf = (a: Analysis, id: string): Graph => {
  const d = diagramsOf(a).find((x) => x.id === id);
  assert.ok(d, `沒有 ${id} 這張圖`);
  return buildGraph(d, a);
};
const named = (a: Analysis, g: Graph) => {
  const q = new Map([...a.elements, ...a.unnamed].map((e) => [e.id, e.qualifiedName]));
  const node = (qn: string) => g.nodes.find((n) => n.el && !n.el.unnamed && q.get(n.id) === qn);
  const edges = (kind: string) => g.edges.filter((e) => e.kind === kind).map((e) => `${g.nodes.find((n) => n.id === e.source)?.title.join("")} → ${g.nodes.find((n) => n.id === e.target)?.title.join("")}`).sort();
  return { node, edges };
};

test("圖的清單：最上層一張、每個套件一張、每個擁有零件的零件定義一張；沒有舊的結構分解圖", async () => {
  const a = await load(["m.sysml", MODEL]);
  const defs = diagramsOf(a);
  assert.deepEqual(defs.filter((d) => d.kind === "pkg").map((d) => d.id), [TOP_DIAGRAM, "pkg:Top", "pkg:Top::Inner"]);
  assert.deepEqual(defs.filter((d) => d.kind === "decomp").map((d) => d.id), ["decomp:Top::Wheel", "decomp:Top::Car", "decomp:Top::SportsCar"]);
  assert.equal(defs.some((d) => (d.kind as string) === "bdd" || d.id === "bdd"), false);
  assert.ok(defs.filter((d) => d.kind === "pkg" || d.kind === "decomp").every((d) => d.viewDef === "GeneralView" && d.code === "GV"));
  assert.equal(frameLabel(defs.find((d) => d.id === "pkg:Top") as DiagramDef), "«view» Top : GeneralView");
  // 需求追溯、使用案例仍然在
  assert.deepEqual(defs.filter((d) => d.kind === "req" || d.kind === "uc").map((d) => d.id), ["req", "uc"]);
  // 最上層的圖：最上層的套件畫成不展開的資料夾
  const top = buildGraph(defs[0], a);
  assert.deepEqual(top.nodes.map((n) => [n.name, n.shape]), [["Top", "pkgbox"]]);
});

test("套件內容圖：成員是節點、下層列在隔間、零件畫成節點並接上組成與定義、連線記號依規範", async () => {
  const a = await load(["m.sysml", MODEL]);
  const g = graphOf(a, "pkg:Top");
  const { node, edges } = named(a, g);
  // 成員：子套件不展開；定義方角、使用圓角
  assert.equal(node("Top::Inner")?.shape, "pkgbox");
  assert.equal(node("Top::Inner::Leaf"), undefined, "子套件的成員在子套件自己的圖上");
  assert.deepEqual([node("Top::Car")?.shape, node("Top::Car")?.keyword], ["def", "«part def»"]);
  assert.deepEqual([node("Top::Fuel")?.shape, node("Top::Fuel")?.keyword], ["def", "«item def»"]);
  assert.deepEqual([node("Top::car")?.shape, node("Top::car")?.keyword, node("Top::car")?.dashed], ["usage", "«part»", undefined]);
  // 參照的使用：虛線外框
  assert.equal(node("Top::other")?.dashed, true);
  assert.equal(node("Top::Car::spare")?.dashed, true);
  // 隔間：屬性放 attributes，其餘的使用放 features，更下層的縮排；已經畫成節點的零件不再列
  const car = node("Top::Car");
  assert.deepEqual(car?.compartments, [["attributes", "count"], ["features", "action spin", "· action inner"]]);
  assert.deepEqual(node("Top::Base")?.compartments, [["attributes", "mass"]]);
  // 組成：擁有者端實心菱形；非組成：空心菱形
  assert.deepEqual(edges("compose"), ["Car :> Base → again : Car", "Car :> Base → wheel : Wheel", "SportsCar :> Car → :>> wheel", "SportsCar :> Car → extra : Wheel", "Wheel :> Base → hub : Hub"]);
  assert.ok(g.edges.filter((e) => e.kind === "compose").every((e) => e.tail === "diamond" && e.head === "none" && !e.dashed));
  assert.deepEqual(edges("refpart"), ["Car :> Base → spare : Wheel"]);
  assert.deepEqual(g.edges.filter((e) => e.kind === "refpart").map((e) => [e.tail, e.head, e.dashed]), [["hollow", "none", false]]);
  // 由誰定義：空心三角形加兩點。沒有名字的重定義零件沿著被重定義的零件找到定義
  assert.deepEqual(edges("define"), [":>> wheel → Wheel :> Base", "again : Car → Car :> Base", "car : Car → Car :> Base", "extra : Wheel → Wheel :> Base", "hub : Hub → Hub :> Base", "spare : Wheel → Wheel :> Base", "wheel : Wheel → Wheel :> Base"]);
  assert.ok(g.edges.filter((e) => e.kind === "define").every((e) => e.head === "typing" && e.tail === "none"));
  // 特化與子集：空心三角形；重定義：三角形加豎線；參照子集：三角形加四點
  assert.deepEqual(edges("specialize"), ["Car :> Base → Base", "Hub :> Base → Base", "SportsCar :> Car → Car :> Base", "Wheel :> Base → Base"]);
  // SportsCar 裡的 wheel 指的是它自己重定義的那一個
  assert.deepEqual(edges("subset"), ["extra : Wheel → :>> wheel"]);
  assert.deepEqual(edges("redefine"), [":>> wheel → wheel : Wheel"]);
  assert.deepEqual(edges("reference"), ["other ::> car → car : Car"]);
  const heads = (k: string) => [...new Set(g.edges.filter((e) => e.kind === k).map((e) => `${e.head}/${e.tail}/${e.dashed}`))];
  assert.deepEqual([heads("specialize"), heads("subset"), heads("redefine"), heads("reference")], [["triangle/none/false"], ["triangle/none/false"], ["redefine/none/false"], ["refsubset/none/false"]]);
  // 每個節點只出現一次
  assert.equal(new Set(g.nodes.map((n) => n.id)).size, g.nodes.length);
  // 組成線可以刪（刪掉零件）；特化等關係不能在圖上刪
  const wheel = node("Top::Car::wheel");
  assert.deepEqual(g.edges.find((e) => e.kind === "compose" && e.target === wheel?.id)?.remove, { type: "element", id: wheel?.id });
  assert.ok(g.edges.filter((e) => e.kind === "specialize").every((e) => e.remove === null));
});

test("匯出的 SVG：新的連線記號與虛線外框都畫得出來，只帶用到的記號", async () => {
  const a = await load(["m.sysml", MODEL]);
  const g = graphOf(a, "pkg:Top");
  const svg = toSvg("«view» Top : GeneralView", g.nodes.map((n, i) => ({ g: n, x: (i % 5) * 260, y: Math.floor(i / 5) * 200 })), g.edges);
  for (const id of ["diamond", "hollow", "typ", "triangle", "redefine", "refsubset"]) {
    assert.match(svg, new RegExp(`<marker id="${id}"`), id);
    assert.match(svg, new RegExp(`url\\(#${id}\\)`), id);
  }
  assert.match(svg, /rx="10" fill="#ffffff" stroke="#111111" stroke-width="1" stroke-dasharray="6 4"/, "ref 的使用是虛線外框");
  // 空心菱形與實心菱形只差在填色
  assert.match(svg, /<marker id="hollow"[^>]*><path d="M1 6 L10 1 L19 6 L10 11 Z" fill="#ffffff"/);
  assert.match(svg, /<marker id="diamond"[^>]*><path d="M1 6 L10 1 L19 6 L10 11 Z" fill="#111111"/);
  // 只有組成的圖不帶其他記號
  const d = graphOf(a, "decomp:Top::Wheel");
  const small = toSvg("x", d.nodes.map((n, i) => ({ g: n, x: i * 260, y: 0 })), d.edges);
  assert.deepEqual([...small.matchAll(/<marker id="([^"]+)"/g)].map((m) => m[1]), ["arr", "diamond", "typ"]);
});

test("分解圖：定義 → 零件 → 零件的定義往下展開，含重定義的零件；循環不會無限展開", async () => {
  const a = await load(["m.sysml", MODEL]);
  const car = graphOf(a, "decomp:Top::Car");
  const c = named(a, car);
  // Car → wheel → Wheel → hub → Hub；again 的型別就是 Car 自己，只接回去、不再展開
  assert.deepEqual(car.nodes.map((n) => n.title.join("")), ["Car :> Base", "wheel : Wheel", "Wheel :> Base", "spare : Wheel", "again : Car", "hub : Hub", "Hub :> Base"]);
  assert.equal(new Set(car.nodes.map((n) => n.id)).size, car.nodes.length);
  assert.deepEqual(c.edges("define"), ["again : Car → Car :> Base", "hub : Hub → Hub :> Base", "spare : Wheel → Wheel :> Base", "wheel : Wheel → Wheel :> Base"]);
  assert.deepEqual(c.edges("compose"), ["Car :> Base → again : Car", "Car :> Base → wheel : Wheel", "Wheel :> Base → hub : Hub"]);
  assert.deepEqual(c.edges("refpart"), ["Car :> Base → spare : Wheel"]);
  assert.deepEqual(c.edges("specialize"), [], "Base 不在這張圖上，不畫特化");
  assert.equal(car.folded, undefined);
  // 重定義的零件：沒有名字，寫成 :>> wheel，型別沿著被重定義的零件找到 Wheel
  const sports = graphOf(a, "decomp:Top::SportsCar");
  assert.deepEqual(sports.nodes.map((n) => n.title.join("")), ["SportsCar :> Car", ":>> wheel", "Wheel :> Base", "extra : Wheel", "hub : Hub", "Hub :> Base"]);
  assert.deepEqual(named(a, sports).edges("define"), [":>> wheel → Wheel :> Base", "extra : Wheel → Wheel :> Base", "hub : Hub → Hub :> Base"]);
  assert.deepEqual(sports.nodes[0].compartments, [], "沒有屬性就沒有隔間");
  assert.deepEqual(named(a, graphOf(a, "decomp:Top::Wheel")).node("Top::Wheel")?.compartments, [["attributes", "radius"]]);
});

test("節點上限：超過的成員與零件改列在隔間，並回報有幾個", async () => {
  const many = Array.from({ length: NODE_LIMIT + 10 }, (_, i) => `    part def D${i} { attribute a${i}; }`).join("\n");
  const parts = Array.from({ length: NODE_LIMIT + 10 }, (_, i) => `        part p${i} : Small;`).join("\n");
  const a = await load(["big.sysml", `package Big {\n${many}\n}\npackage Wide {\n    part def Small;\n    part def Huge {\n${parts}\n    }\n}\n`]);
  const g = graphOf(a, "pkg:Big");
  assert.equal(g.nodes.length, NODE_LIMIT + 1);
  assert.equal(g.folded, 10);
  const more = g.nodes[g.nodes.length - 1];
  assert.deepEqual([more.shape, more.el, more.compartments[0][0], more.compartments[0].length], ["pkgbox", null, "members", 1 + 20]);
  assert.deepEqual(more.compartments[0].slice(1, 3), [`part def D${NODE_LIMIT}`, `· attribute a${NODE_LIMIT}`]);
  const all = new Set(g.nodes.flatMap((n) => [n.id, ...(n.covers ?? [])]));
  for (const e of a.elements.filter((x) => x.qualifiedName.startsWith("Big::"))) assert.ok(all.has(e.id), `${e.qualifiedName} 不在圖上`);
  const d = graphOf(a, "decomp:Wide::Huge");
  assert.equal(d.nodes.length, NODE_LIMIT);
  // Huge 自己、Small 各占一個節點，其餘到上限為止的零件是節點，剩下 12 個列在 Huge 的 parts 隔間
  assert.equal(d.folded, 12);
  assert.deepEqual([d.nodes[0].compartments[0][0], d.nodes[0].compartments[0].length], ["parts", 13]);
  const shown = new Set(d.nodes.flatMap((n) => [n.id, ...(n.covers ?? [])]));
  for (const e of a.elements.filter((x) => x.kind === "PartUsage")) assert.ok(shown.has(e.id), `${e.name} 不在分解圖上`);
});

test("版面：新圖沒有紀錄時沿用舊結構分解圖（bdd）裡同一個節點的位置，舊紀錄不動", () => {
  const layout = { bdd: { A: { x: 10, y: 20 }, B: { x: 30, y: 40, w: 5, h: 6 }, Gone: { x: 1, y: 1 } }, "pkg:Has": { A: { x: 7, y: 8 } }, "pkg:Empty": {} };
  const before = JSON.stringify(layout);
  assert.deepEqual(seedLayout(layout, { id: "pkg:New", kind: "pkg" }, ["A", "B", "C"]), { A: { x: 10, y: 20 }, B: { x: 30, y: 40 } }, "對得上的沿用，C 交給自動排列");
  assert.deepEqual(seedLayout(layout, { id: "decomp:X", kind: "decomp" }, ["B"]), { B: { x: 30, y: 40 } });
  assert.deepEqual(seedLayout(layout, { id: "pkg:Empty", kind: "pkg" }, ["A"]), { A: { x: 10, y: 20 } }, "空的紀錄等於沒有");
  assert.equal(seedLayout(layout, { id: "pkg:Has", kind: "pkg" }, ["A", "B"]), layout["pkg:Has"], "已經有自己的紀錄就用自己的");
  assert.deepEqual(seedLayout(layout, { id: "req", kind: "req" }, ["A"]), {}, "其他的圖不沿用");
  assert.deepEqual(seedLayout({}, { id: "pkg:New", kind: "pkg" }, ["A"]), {});
  assert.equal(JSON.stringify(layout), before, "不改動原本的紀錄");
});

test("JRI 的範本專案：原本結構分解圖上的節點都在新圖上，仍可新增結構類別的元素與拉組成線", async () => {
  const read = (rel: string) => fs.readFile(path.join(here, rel), "utf8");
  const a = await load(["JRI.sysml", await read("../../library/JRI.sysml")], ["model.sysml", await read("../../templates/sounding-rocket/model.sysml")]);
  const defs = diagramsOf(a);
  const s = defs.find((d) => d.id === "pkg:Project::Structure") as DiagramDef;
  assert.ok(s);
  const g = buildGraph(s, a);
  // 舊圖的內容：所有零件定義，加上定義擁有、型別也是零件定義的零件
  const partDefs = a.elements.filter((e) => e.kind === "PartDefinition" && !e.shared);
  const oldParts = a.elements.filter((u) => u.kind === "PartUsage" && partDefs.some((d) => d.id === u.owner) && u.typeIds.some((x) => partDefs.some((d) => d.id === x)));
  assert.ok(partDefs.length >= 4 && oldParts.length >= 3);
  const everywhere = new Set(defs.filter((d) => d.kind === "pkg").flatMap((d) => buildGraph(d, a).nodes.map((n) => n.id)));
  for (const e of [...partDefs, ...oldParts]) assert.ok(everywhere.has(e.id), `${e.qualifiedName} 不是任何套件內容圖的節點`);
  assert.equal(g.edges.filter((e) => e.kind === "compose").length, oldParts.filter((u) => g.nodes.some((n) => n.id === u.id)).length);
  // 原本在 api.test.ts 檢查舊結構分解圖的內容：定義都是方角的 «part def»；組成至少 3 條，定義 ◆— 零件（使用）；零件以「defined by」指向它的定義
  assert.equal(frameLabel(s), "«view» Structure : GeneralView");
  assert.ok(g.nodes.filter((n) => n.shape === "def").every((n) => n.keyword === "«part def»"));
  const comp = g.edges.filter((e) => e.kind === "compose");
  assert.ok(comp.length >= 3 && comp.every((e) => e.tail === "diamond" && g.nodes.find((n) => n.id === e.target)?.keyword === "«part»"));
  assert.ok(g.edges.filter((e) => e.kind === "define").every((e) => e.head === "typing" && g.nodes.find((n) => n.id === e.target)?.shape === "def"));
  const svg = toSvg("«view» t : GeneralView", g.nodes.map((n, i) => ({ g: n, x: i * 240, y: 0 })), g.edges);
  assert.match(svg, /«view» t : GeneralView/);
  assert.match(svg, /rx="10"/);
  assert.match(svg, /url\(#typ\)/);
  // 工具：這個套件的類別，加上「組成」
  const cats = [{ id: "System", pkg: "Structure" }, { id: "Subsystem", pkg: "Structure" }, { id: "Component", pkg: "Structure" }, { id: "ExternalEntity", pkg: "Structure" }, { id: "SystemRequirement", pkg: "Requirements" }];
  assert.deepEqual(paletteOf(s, a, cats), ["System", "Subsystem", "Component", "ExternalEntity"]);
  assert.deepEqual(paletteOf(defs.find((d) => d.id === "pkg:Project::Requirements") as DiagramDef, a, cats), ["SystemRequirement"]);
  assert.deepEqual(paletteOf(defs[0], a, cats), []);
  assert.deepEqual([LINK_TOOLS.pkg.map((t) => t.kind), LINK_TOOLS.decomp.map((t) => t.kind)], [["compose"], ["compose"]]);
  // 畫面用的圖（含註解）不另外畫套件的框，節點也不重複
  const screen = buildGraph(s, a, { packages: new Set(["Structure"]), shown: new Set() });
  assert.equal(screen.nodes.some((n) => n.shape === "package"), false);
  assert.equal(new Set(screen.nodes.map((n) => n.id)).size, screen.nodes.length);
});

test("Apollo 11 參考模型：21 個定義都有分解圖且每個零件都在圖上；每個具名元素至少在一張圖上", async () => {
  const root = path.join(here, "../../reference/apollo-11-sysml-v2");
  const files = (await fs.readdir(root, { recursive: true })).filter((f) => f.endsWith(".sysml")).sort();
  const a = await load(...(await Promise.all(files.map(async (f) => [f.split(path.sep).join("/"), await fs.readFile(path.join(root, f), "utf8")] as [string, string]))));
  assert.equal(a.elements.length, 2188);
  const t = treeOf(a);
  const defs = diagramsOf(a);
  const pkgs = defs.filter((d) => d.kind === "pkg"), decomps = defs.filter((d) => d.kind === "decomp");
  assert.equal(pkgs.length, 1 + a.elements.filter((e) => e.kind === "Package" || e.kind === "LibraryPackage").length);
  assert.equal(decomps.length, 21);
  const seen = new Set<string>();
  for (const d of decomps) {
    const g = buildGraph(d, a);
    const ids = new Set(g.nodes.flatMap((n) => [n.id, ...(n.covers ?? [])]));
    assert.equal(new Set(g.nodes.map((n) => n.id)).size, g.nodes.length, `${d.id} 有重複的節點`);
    assert.ok(g.nodes.length <= NODE_LIMIT);
    const parts = (t.children.get(d.context) ?? []).filter((e) => e.kind === "PartUsage");
    assert.ok(parts.length > 0, d.id);
    for (const p of parts) assert.ok(ids.has(p.id), `${d.id}：零件 ${p.name} 不在圖上`);
    // 每個畫出來的零件都接著一條組成（或非組成）線
    for (const n of g.nodes) if (n.el?.kind === "PartUsage") assert.ok(g.edges.some((e) => (e.kind === "compose" || e.kind === "refpart") && e.target === n.id), `${d.id}：${n.name} 沒有接到擁有者`);
    ids.forEach((x) => seen.add(x));
  }
  for (const d of pkgs) {
    const g = buildGraph(d, a);
    assert.ok(g.nodes.length <= NODE_LIMIT + 1, d.id);
    for (const n of g.nodes) { seen.add(n.id); (n.covers ?? []).forEach((x) => seen.add(x)); }
  }
  const missing = a.elements.filter((e) => !seen.has(e.id));
  assert.deepEqual(missing.map((e) => e.qualifiedName), [], "不在任何一張圖上的具名元素");
  // 循環：MassedComponent 的 subcomponents 型別就是 MassedComponent
  const mc = buildGraph(decomps.find((d) => d.title === "MassedComponent") as DiagramDef, a);
  assert.deepEqual(mc.nodes.map((n) => n.name), ["MassedComponent", "subcomponents"]);
  assert.deepEqual(mc.edges.map((e) => e.kind).sort(), ["compose", "define"]);
});
