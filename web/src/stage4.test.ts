// 階段 4：需求、使用案例、狀態機、動作、互連、個體、計算與分析的圖（F-77 到 F-81）。模型與數值都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { analyze, shutdown } from "../../server/engine.ts";
import { buildGraph, diagramsOf, NODE_LIMIT, seedLayout, transitionLabel } from "./model.ts";
import type { Graph } from "./model.ts";
import { toSvg } from "./exportSvg.ts";
import { frameLayout, PORT } from "./shapes.ts";
import type { Analysis } from "./api.ts";

after(() => shutdown());
const MODEL = `package Demo {
    package Reqs {
        part def Rover;
        part def Operator;
        requirement def MassLimit {
            doc /* The rover mass shall not exceed the limit. */
            subject rover : Rover;
            attribute limit;
            attribute actual;
            require constraint { actual <= limit }
        }
        requirement massReq : MassLimit;
        requirement group {
            requirement speedReq;
        }
        part myRover : Rover {
            satisfy massReq by myRover;
        }
        use case def Drive {
            subject rover : Rover;
            actor driver : Operator;
        }
        use case drive : Drive;
        use case park { include drive; }
    }
    package Behavior {
        item def Start;
        state def Modes {
            entry; then idle;
            state idle { do action blink; entry action warm; }
            state moving;
            transition go first idle accept Start if true do action beep then moving;
            transition stop first moving then idle;
        }
        action def Move {
            in speed;
            out distance;
            action accelerate { in target; }
            action cruise;
            first accelerate then cruise;
        }
        part def Driver {
            perform action move : Move;
        }
        action def Loop { action again : Loop; }
    }
    package Wiring {
        port def Plug;
        interface def Cable { end a : Plug; end b : ~Plug; }
        part def Box { port p : Plug; }
        part def Rack {
            port ext : Plug;
            part left : Box;
            part right : Box;
            interface cable : Cable connect left.p to right.p;
            connect left to right;
        }
    }
    package Mission {
        part def Craft { attribute fuel; }
        individual part def Craft1 :> Craft;
        individual part craft1 : Craft1 {
            timeslice launch {
                snapshot atLiftoff { attribute t = 0; }
            }
            then timeslice cruise;
        }
    }
    package Analysis {
        calc def Total { in a; in b; return r; }
        analysis def Budget {
            subject craft : Demo::Mission::Craft;
            calc total : Total;
            out margin;
        }
        analysis budget1 : Budget;
    }
}
`;
let cached: Analysis | undefined;
const load = async () => {
  if (cached) return cached;
  const a = await analyze([["m.sysml", MODEL]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400));
  return (cached = a as unknown as Analysis);
};
const graph = (a: Analysis, id: string): Graph => {
  const d = diagramsOf(a).find((x) => x.id === id);
  assert.ok(d, `沒有 ${id} 這張圖`);
  return buildGraph(d, a);
};
const title = (g: Graph, id: string) => g.nodes.find((n) => n.id === id)?.title.join("") ?? id;
const node = (g: Graph, t: string) => { const n = g.nodes.find((x) => x.title.join("") === t); assert.ok(n, `圖上沒有 ${t}`); return n; };
const edges = (g: Graph, kind: string) => g.edges.filter((e) => e.kind === kind).map((e) => `${title(g, e.source)} → ${title(g, e.target)}`).sort();
const svgOf = (g: Graph, frame = "f") => toSvg(frame, g.nodes.map((n, i) => ({ g: n, x: (i % 4) * 320, y: Math.floor(i / 4) * 360 })), g.edges);

test("圖的清單：需求與使用案例每個套件一張、整個模型各一張；狀態機、動作、功能分解、互連、個體、計算與分析", async () => {
  const a = await load();
  const ids = (kind: string) => diagramsOf(a).filter((d) => d.kind === kind).map((d) => d.id);
  assert.deepEqual(ids("req"), ["req", "req:Demo::Reqs"]);
  assert.deepEqual(ids("uc"), ["uc", "uc:Demo::Reqs"]);
  assert.deepEqual(ids("stm"), ["stm:Demo::Behavior::Modes"]);
  assert.deepEqual(ids("act"), ["act:Demo::Behavior::Move", "act:Demo::Behavior::Loop"]);
  assert.deepEqual(ids("fdecomp"), ["fdecomp:Demo::Behavior::Move", "fdecomp:Demo::Behavior::Loop"]);
  assert.deepEqual(ids("ibd"), ["ibd:Demo::Wiring::Rack"]);
  assert.deepEqual(ids("occ"), ["occ:Demo::Mission::craft1", "occ:Demo::Mission::craft1::launch"]);
  assert.deepEqual(ids("calc"), ["calc:Demo::Analysis::Total", "calc:Demo::Analysis::Budget", "calc:Demo::Analysis::budget1"]);
  const view = (id: string) => diagramsOf(a).find((d) => d.id === id)?.viewDef;
  assert.deepEqual(["req:Demo::Reqs", "stm:Demo::Behavior::Modes", "act:Demo::Behavior::Move", "ibd:Demo::Wiring::Rack", "occ:Demo::Mission::craft1", "calc:Demo::Analysis::Budget"].map(view),
    ["GeneralView", "StateTransitionView", "ActionFlowView", "InterconnectionView", "GeneralView", "GeneralView"]);
});

test("需求（F-77）：需求定義的 doc、subject、屬性、require constraint 隔間；滿足、組成、由誰定義的記號", async () => {
  const a = await load();
  const g = graph(a, "req:Demo::Reqs");
  const def = node(g, "MassLimit");
  assert.deepEqual([def.shape, def.keyword], ["def", "«requirement def»"]);
  assert.deepEqual(def.compartments.map((c) => c[0]), ["doc", "subject", "attributes", "require constraints"]);
  assert.deepEqual(def.compartments[1], ["subject", "rover : Rover"]);
  assert.deepEqual(def.compartments[3], ["require constraints", "require constraint { actual <= limit }"]);
  assert.deepEqual([node(g, "massReq : MassLimit").shape, node(g, "massReq : MassLimit").keyword], ["usage", "«requirement»"]);
  assert.deepEqual(edges(g, "satisfy"), ["myRover : Rover → massReq : MassLimit"]);
  const sat = g.edges.find((e) => e.kind === "satisfy");
  assert.deepEqual([sat?.label, sat?.dashed, sat?.head, sat?.tail], ["«satisfy»", false, "open", "none"]);
  assert.deepEqual(edges(g, "compose"), ["group → speedReq"]);
  assert.equal(g.edges.find((e) => e.kind === "compose")?.tail, "diamond");
  assert.deepEqual(edges(g, "define"), ["massReq : MassLimit → MassLimit"]);
  assert.equal(g.edges.find((e) => e.kind === "define")?.head, "typing");
  // 整個模型的「需求追溯」：需求（使用）與滿足者，和原本的圖相同的範圍
  assert.deepEqual(graph(a, "req").nodes.map((n) => n.title.join("")).sort(), ["group", "massReq : MassLimit", "myRover : Rover", "speedReq"]);
  const svg = svgOf(g);
  for (const s of ["«satisfy»", "require constraints", "subject", 'marker-end="url(#arr)"', 'marker-start="url(#diamond)"', 'marker-end="url(#typ)"']) assert.ok(svg.includes(s), `匯出的 SVG 有 ${s}`);
});

test("使用案例（F-77）：subject 與 actor 隔間、參與者標 «actor» 用實線連、包含是開放箭頭", async () => {
  const a = await load();
  const g = graph(a, "uc:Demo::Reqs");
  assert.deepEqual(node(g, "Drive").compartments, [["subject", "rover : Rover"], ["actors", "driver : Operator"]]);
  assert.equal(node(g, "Operator").keyword, "«actor»");
  const actor = g.edges.find((e) => e.kind === "trace");
  assert.deepEqual([title(g, actor!.source), title(g, actor!.target), actor?.head, actor?.dashed, actor?.label], ["Drive", "Operator", "none", false, ""]);
  assert.deepEqual(edges(g, "include"), ["park → drive : Drive"]);
  assert.equal(g.edges.find((e) => e.kind === "include")?.label, "«include»");
});

test("狀態機（F-78）：entry 畫成起始節點、do／entry action 列在隔間、轉換標觸發條件 [守衛] / 效果", async () => {
  const a = await load();
  const g = graph(a, "stm:Demo::Behavior::Modes");
  assert.deepEqual(g.nodes.map((n) => [n.shape, n.keyword, n.title.join("")]), [["start", "", ""], ["usage", "«state»", "idle"], ["usage", "«state»", "moving"]]);
  assert.deepEqual(node(g, "idle").compartments, [["actions", "do action blink", "entry action warm"]]);
  const lab = Object.fromEntries(g.edges.map((e) => [`${title(g, e.source)} → ${title(g, e.target)}`, e.label]));
  assert.deepEqual(lab, { "idle → moving": "Start [true] / beep", "moving → idle": "", " → idle": "" });
  assert.ok(g.edges.every((e) => e.kind === "transition" && e.head === "open" && !e.dashed));
  assert.equal(transitionLabel({ trigger: "", guard: "x > 1", effect: "" }), "[x > 1]");
  const svg = svgOf(g);
  assert.ok(svg.includes("Start [true] / beep") && svg.includes("<circle"), "匯出的 SVG 有轉換的標籤與起始節點");
});

test("動作（F-79）：這個動作的參數貼在圖框邊上（in 左、out 右）、子動作的參數貼在它的邊上、先後是開放箭頭；perform 有自己的隔間；功能分解不會無限展開", async () => {
  const a = await load();
  const g = graph(a, "act:Demo::Behavior::Move");
  assert.deepEqual(g.nodes.map((n) => [n.shape, n.keyword, n.title.join(""), n.boundary ?? null]), [["param", "«in»", "in speed", "left"], ["param", "«out»", "out distance", "right"], ["usage", "«action»", "accelerate", null], ["usage", "«action»", "cruise", null]]);
  const acc = node(g, "accelerate");
  assert.deepEqual([acc.compartments, acc.ports?.map((p) => [p.label, p.side])], [[], [["target", "left"]]], "子動作的參數不再列在隔間");
  assert.ok(acc.height >= 26 + 16 + 4 + (acc.band ?? 0) && (acc.band ?? 0) > 0, "名稱下方留出放方塊的高度");
  assert.deepEqual(edges(g, "succession"), ["accelerate → cruise"]);
  assert.equal(g.nodes.some((n) => n.shape === "start" || n.shape === "done"), false, "沒有寫起點的一般模型不補起始與完成節點");
  const f = graph(a, "fdecomp:Demo::Behavior::Move");
  assert.deepEqual(edges(f, "compose"), ["Move → accelerate", "Move → cruise"]);
  const loop = graph(a, "fdecomp:Demo::Behavior::Loop");
  assert.deepEqual(loop.nodes.map((n) => n.title.join("")), ["Loop", "again : Loop"]);
  assert.deepEqual(edges(loop, "define"), ["again : Loop → Loop"]);
  const pkg = graph(a, "pkg:Demo::Behavior");
  assert.deepEqual(node(pkg, "Driver").compartments, [["perform actions", "move : Move"]]);
  assert.ok(node(pkg, "Modes").compartments.some((c) => c[0] === "states"));
  assert.equal((svgOf(g).match(/width="12" height="12"/g) ?? []).length, 3, "匯出的 SVG 有 3 個方塊：圖框上的 speed、distance 與 accelerate 的 target");
});

test("互連（F-80）：連接埠是零件邊上的小方塊、介面接在方塊上、直接連零件的連結接在外框；定義自己的連接埠貼在圖框邊上", async () => {
  const a = await load();
  const g = graph(a, "ibd:Demo::Wiring::Rack");
  assert.deepEqual(g.nodes.map((n) => [n.shape, n.title.join(""), n.boundary ?? null]), [["param", "port ext : Plug", "left"], ["usage", "left : Box", null], ["usage", "right : Box", null]]);
  const left = node(g, "left : Box"), right = node(g, "right : Box");
  assert.deepEqual([left.compartments, right.compartments], [[], []], "連接埠不再列在 ports 隔間");
  assert.deepEqual(left.ports?.map((p) => [p.key, p.label, p.side]), [["Demo__Wiring__Box__p", "p", "right"]], "起點的連接埠在右邊");
  assert.deepEqual(right.ports?.map((p) => [p.key, p.label, p.side]), [["Demo__Wiring__Box__p", "p", "left"]], "終點的連接埠在左邊");
  const links = g.edges.map((e) => [title(g, e.source), e.sourcePort ?? null, title(g, e.target), e.targetPort ?? null, e.label, e.head, e.tail, e.dashed, e.remove?.type ?? null]);
  assert.deepEqual(links, [["left : Box", "Demo__Wiring__Box__p", "right : Box", "Demo__Wiring__Box__p", "cable : Cable", "none", "none", false, null], ["left : Box", null, "right : Box", null, "", "none", "none", false, "relation"]]);
  // 匯出：介面的線從 left 右邊的方塊水平出去，接到 right 左邊的方塊
  const placed = [{ g: g.nodes[0], x: 0, y: 0 }, { g: left, x: 100, y: 100 }, { g: right, x: 500, y: 100 }];
  const svg = toSvg("f", placed, g.edges);
  const py = 100 + (left.ports?.[0].y ?? 0);
  // 第一條連線（介面）的路徑；開放箭頭記號的 path 線寬是 1.2，連線是 1
  const path = svg.match(/<path d="M([\d.]+) ([\d.]+) L[^"]*L([\d.]+) ([\d.]+)" fill="none" stroke="#111" stroke-width="1" /);
  assert.ok(path, "介面的線是折線");
  assert.equal(Number(path[4]) - Number(path[2]), 0, "兩個方塊同高，折線的兩端同高");
  assert.equal(Number(path[3]) - Number(path[1]), 500 - 6 - (100 + left.width + 6), "兩端是方塊外側的中心");
  assert.ok(svg.includes("cable : Cable") && py > 100);
  const c = a.connectors?.find((x) => x.name === "cable");
  assert.deepEqual([c?.kind, c?.type, c?.fromPath, c?.toPath, c?.fromChain.length], ["interface", "Cable", "left.p", "right.p", 2]);
});

test("圖框：貼在框邊上的節點，方塊的中心在框線上，左右各自由上往下排，排不下時圖框往下長；畫面與匯出共用", () => {
  const fl = frameLayout([{ x: 100, y: 100, w: 200, h: 40 }], [
    { id: "a", boundary: "left", width: 80, height: 22 }, { id: "b", boundary: "left", width: 60, height: 22 }, { id: "c", boundary: "right", width: 70, height: 22 },
    { id: "d", boundary: "left", width: 50, height: 22 },
  ], 36);
  assert.deepEqual([fl.x, fl.w], [64, 272]);
  const center = (id: string, w: number, side: "left" | "right") => { const p = fl.places.get(id)!; return side === "left" ? p.x + w - PORT / 2 : p.x + PORT / 2; };
  assert.deepEqual([center("a", 80, "left"), center("b", 60, "left"), center("d", 50, "left"), center("c", 70, "right")], [64, 64, 64, 336]);
  const ys = ["a", "b", "d"].map((id) => fl.places.get(id)!.y);
  assert.deepEqual([ys[1] - ys[0], ys[2] - ys[1], fl.places.get("c")!.y], [34, 34, ys[0]]);
  assert.ok(fl.y + fl.h >= ys[2] + 22, "圖框長到包住最下面的方塊");
});

test("個體、時間切片與快照（F-81）：«timeslice»、«snapshot»，先後依 then", async () => {
  const a = await load();
  const g = graph(a, "occ:Demo::Mission::craft1");
  assert.deepEqual(g.nodes.map((n) => [n.keyword, n.title.join("")]), [["«timeslice»", "launch"], ["«timeslice»", "cruise"]]);
  assert.deepEqual(node(g, "launch").compartments[0], ["snapshots", "atLiftoff", "· attribute t"]);
  assert.deepEqual(edges(g, "succession"), ["launch → cruise"]);
  assert.deepEqual(graph(a, "occ:Demo::Mission::craft1::launch").nodes.map((n) => n.keyword), ["«snapshot»"]);
  assert.equal(node(graph(a, "pkg:Demo::Mission"), "craft1 : Craft1").keyword, "«part»", "套件內容圖照原本的元類別關鍵字");
});

test("計算與分析（F-81）：subject、參數完整列出，擁有的計算接組成線，定義接由誰定義", async () => {
  const a = await load();
  const g = graph(a, "calc:Demo::Analysis::Budget");
  assert.deepEqual(g.nodes.map((n) => [n.shape, n.keyword, n.title.join("")]), [["def", "«analysis def»", "Budget"], ["usage", "«calc»", "total : Total"], ["def", "«calc def»", "Total"]]);
  assert.deepEqual(node(g, "Budget").compartments, [["subject", "craft : Craft"], ["parameters", "out margin"]]);
  assert.deepEqual(edges(g, "compose"), ["Budget → total : Total"]);
  assert.deepEqual(edges(g, "define"), ["total : Total → Total"]);
  assert.deepEqual(edges(graph(a, "calc:Demo::Analysis::budget1"), "define"), ["budget1 : Budget → Budget"]);
  const svg = svgOf(g);
  assert.ok(svg.includes('<marker id="diamond"') && svg.includes('<marker id="typ"'));
});

test("版面：每個套件的需求圖、使用案例圖沿用整張需求追溯、使用案例的位置；狀態機等的識別碼不變，紀錄照用", async () => {
  const layout = { req: { A: { x: 1, y: 2 } }, uc: { B: { x: 3, y: 4 } }, "stm:X": { S: { x: 5, y: 6 } } };
  const before = JSON.stringify(layout);
  assert.deepEqual(seedLayout(layout, { id: "req:P", kind: "req" }, ["A", "Z"]), { A: { x: 1, y: 2 } });
  assert.deepEqual(seedLayout(layout, { id: "uc:P", kind: "uc" }, ["B"]), { B: { x: 3, y: 4 } });
  assert.equal(seedLayout(layout, { id: "req", kind: "req" }, ["A"]), layout.req);
  assert.equal(seedLayout(layout, { id: "stm:X", kind: "stm" }, ["S"]), layout["stm:X"]);
  assert.deepEqual(seedLayout(layout, { id: "calc:Y", kind: "calc" }, ["A"]), {});
  assert.equal(JSON.stringify(layout), before, "不改動原本的紀錄");
});

test("需求圖的節點超過上限時，其餘的列在一個節點的隔間並記下數量", async () => {
  const n = NODE_LIMIT + 3;
  const src = `package Many {\n${Array.from({ length: n }, (_, i) => `    requirement r${i};`).join("\n")}\n}\n`;
  const a = (await analyze([["many.sysml", src]])) as unknown as Analysis;
  assert.equal(a.ok, true);
  const g = graph(a, "req:Many");
  assert.equal(g.folded, 3);
  assert.equal(g.nodes.length, NODE_LIMIT + 1);
  const more = g.nodes[g.nodes.length - 1];
  assert.deepEqual([more.shape, more.compartments[0].length, more.covers?.length], ["pkgbox", 4, 3]);
});
