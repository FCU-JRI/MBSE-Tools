// 套件內容圖上的匯入線（階段 3b，規範 8.2.3.5）。內容都是合成的；Apollo 11 參考模型只用來檢查涵蓋範圍。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, shutdown } from "../../server/engine.ts";
import { buildGraph, diagramsOf, TOP_DIAGRAM } from "./model.ts";
import { toSvg } from "./exportSvg.ts";
import type { Analysis } from "./api.ts";

after(() => shutdown());
const load = async (...sources: [string, string][]) => { const a = await analyze(sources); assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400)); return a as unknown as Analysis; };
const here = path.dirname(fileURLToPath(import.meta.url));
const graphOf = (a: Analysis, id: string) => { const d = diagramsOf(a).find((x) => x.id === id); assert.ok(d, id); return buildGraph(d, a); };

const MODEL = `package A {
    private import B::*;
    public import B::E;
    private import B::Inner::F;
    private import ScalarValues::Real;
    private import A::X;
    part def X;
}
package B {
    part def E;
    package Inner { part def F; }
    private import B::Inner::F;
}
package C {
    private import A::*;
    package D { private import C::*; private import B::E; }
}
`;

test("匯入線：兩端都在圖上才畫；匯入成員時接到它所在的套件；同一對只畫一條；虛線開放箭頭標 «import»", async () => {
  const a = await load(["m.sysml", MODEL]);
  const name = (id: string) => a.elements.find((e) => e.id === id)?.qualifiedName ?? id;
  const top = graphOf(a, TOP_DIAGRAM);
  const imp = top.edges.filter((e) => e.kind === "import");
  // A→B 有三條匯入（B::*、B::E、B::Inner::F）只畫一條；匯入自己的成員、標準庫、B 匯入自己的子套件都不畫
  assert.deepEqual(imp.map((e) => [name(e.source), name(e.target)]), [["A", "B"], ["C", "A"]]);
  const nodes = new Set(top.nodes.map((n) => n.id));
  for (const e of imp) {
    assert.ok(nodes.has(e.source) && nodes.has(e.target));
    assert.deepEqual([e.dashed, e.head, e.tail, e.label, e.remove], [true, "open", "none", "«import»", null]);
  }
  // C 的套件內容圖：D 匯入 C（D 的上層，不在圖上）與 B::E（B 不在圖上）都不畫
  assert.equal(graphOf(a, "pkg:C").edges.filter((e) => e.kind === "import").length, 0);
  // 匯出的 SVG 有虛線、開放箭頭與標籤
  const svg = toSvg("x", top.nodes.map((n, i) => ({ g: n, x: i * 260, y: 0 })), top.edges);
  assert.equal(svg.match(/stroke-dasharray="6 4"\s+marker-end="url\(#arr\)"/g)?.length, 2);
  assert.equal(svg.match(/>«import»</g)?.length, 2);
});

test("Apollo 11 參考模型：最上層套件內容圖有匯入線，每條的兩端都是套件節點", async () => {
  const root = path.join(here, "../../reference/apollo-11-sysml-v2");
  const files = (await fs.readdir(root, { recursive: true })).filter((f) => f.endsWith(".sysml")).sort();
  const a = await load(...(await Promise.all(files.map(async (f) => [f.split(path.sep).join("/"), await fs.readFile(path.join(root, f), "utf8")] as [string, string]))));
  assert.ok((a.imports ?? []).length > 0);
  const g = graphOf(a, TOP_DIAGRAM);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const imp = g.edges.filter((e) => e.kind === "import");
  assert.ok(imp.length > 0);
  for (const e of imp) {
    for (const end of [e.source, e.target]) assert.ok(/Package$/.test(byId.get(end)?.el?.kind ?? ""), `${e.id} 的端點不是套件節點`);
  }
  assert.equal(new Set(imp.map((e) => `${e.source}|${e.target}`)).size, imp.length, "同一對節點只畫一條");
  console.log(`Apollo 最上層：${g.nodes.length} 個節點、${imp.length} 條匯入線（匯入共 ${a.imports?.length} 句）`);
});
