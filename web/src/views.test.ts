// P2 分析圖骨架與中文化（METHOD.md 1.2 節、第 3 節；docs/IMPL-PLAN.md P2）。模型都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, shutdown } from "../../server/engine.ts";
import { analysisDiagrams, analysisPalette, bendKey, bendsOf, buildGraph, containerHead, insertAt, rocketLayout, stationOrder, withBends } from "./model.ts";
import { toSvg } from "./exportSvg.ts";
import { ANALYSIS_VIEWS } from "./method/views.ts";
import type { AnalysisView } from "./method/views.ts";
import { expandFirst, zhKeyword } from "./method/zh.ts";
import type { Analysis } from "./api.ts";

after(() => shutdown());
const here = path.dirname(fileURLToPath(import.meta.url));
const JRI = await fs.readFile(path.join(here, "../../library/JRI.sysml"), "utf8");
const load = async (src: string) => { const a = await analyze([["library/JRI.sysml", JRI], ["model/model.sysml", src]]); assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400)); return a as unknown as Analysis; };

const MODEL = `package Demo {
    private import ScalarValues::*;
    private import JRI::*;
    package Stakeholders {
        part <'STK-901'> '甲方' : Stakeholder;
        requirement <'EXP-901'> '期望甲' : Expectation { subject; stakeholder :> Demo::Stakeholders::'甲方'; }
    }
    package Requirements {
        requirement <'REQ-SYS-901'> '系統需求甲' : SystemRequirement;
        requirement <'REQ-SUB-901'> '次系統需求甲' : SubsystemRequirement;
        #derivation connection { end #derive ::> '次系統需求甲'; end #original ::> '系統需求甲'; }
    }
    package Structure {
        part def '測試箭' :> System {
            part '尾段' : '尾段次系統' { attribute station : Real = 2.0; }
            part '頭段' : '頭段次系統' { attribute station : Real = 0.0; }
            part '中段' : '中段次系統' { attribute station : Real = 1.0; }
        }
        part def '尾段次系統' :> Subsystem;
        part def '頭段次系統' :> Subsystem;
        part def '中段次系統' :> Subsystem;
        item def '雜項';
    }
}
`;
const view = (id: string) => ANALYSIS_VIEWS.find((v) => v.id === id)!;
const byName = (a: Analysis, name: string, kind?: string) => a.elements.find((e) => e.name === name && (!kind || e.kind === kind))!;

test("分析圖的清單依圖號由上而下排；十張都登記時順序是 1 到 10，圖號相同依登記順序", () => {
  const ten: AnalysisView[] = [7, 3, 10, 1, 5, 9, 2, 8, 6, 4].map((n) => ({ id: `v${n}`, order: n, zh: `圖${n}`, question: `問題 ${n}`, gate: "mdr", pinned: [] }));
  const list = analysisDiagrams({ views: { "view:v5": ["x"] } }, ten);
  assert.deepEqual(list.map((d) => d.view!.order), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(list.every((d) => d.kind === "analysis" && d.id === `view:${d.view!.id}` && d.title === `圖 ${d.view!.order} ${d.view!.zh}`));
  assert.deepEqual(list.find((d) => d.id === "view:v5")!.members, ["x"]);
  const tie = analysisDiagrams({}, [{ ...ten[0], id: "a", order: 4 }, { ...ten[0], id: "b", order: 4 }, { ...ten[0], id: "c", order: 1 }]);
  assert.deepEqual(tie.map((d) => d.view!.id), ["c", "a", "b"]);
  // P2 自己登記的四張：1、2、5、7，每張都有要回答的問題與釘選的類別；目前登記的整份清單由上而下
  const mine = ["stakeholders", "mission", "schematic", "subsystem-req"].map(view);
  assert.deepEqual(mine.map((v) => v.order), [1, 2, 5, 7]);
  assert.ok(mine.every((v) => v.question.length > 10 && v.pinned.length > 0 && v.missing));
  const real = analysisDiagrams({}).map((d) => d.view!.order);
  assert.deepEqual(real, [...real].sort((x, y) => x - y));
  assert.equal(new Set(ANALYSIS_VIEWS.map((v) => v.id)).size, ANALYSIS_VIEWS.length, "登記的 id 不重複");
});

test("新專案（空模型）每張分析圖都先建好、是空的，標出要回答的問題與還缺什麼", async () => {
  const a = await load("package Empty { private import JRI::*; }");
  for (const d of analysisDiagrams({})) {
    assert.equal(buildGraph(d, a).nodes.length, 0, d.title);
    assert.ok(d.view!.question);
    assert.ok((d.view!.missing?.(a) ?? []).length > 0, `${d.title} 應列出還缺什麼`);
  }
});

test("元素清單：釘選類別亮色，其餘 SysML v2 元素暗色；暗色元素照樣拉得進圖，也畫出成員之間的關係", async () => {
  const a = await load(MODEL);
  const d = analysisDiagrams({}).find((x) => x.id === "view:stakeholders")!;
  const p = analysisPalette(a, d.view!);
  assert.ok(p.pinned.some((e) => e.name === "甲方") && p.pinned.some((e) => e.name === "期望甲"));
  const misc = byName(a, "雜項");
  assert.ok(p.other.some((e) => e.id === misc.id), "沒有類別的 item def 也列在其他（暗色）");
  assert.ok(!p.pinned.some((e) => e.id === misc.id));
  assert.ok(p.other.some((e) => e.category === "SystemRequirement"), "別張圖的類別在這張圖是暗色");
  assert.ok(![...p.pinned, ...p.other].some((e) => e.kind === "Package" || e.shared), "不列套件與標準庫");
  // 拉進圖：釘選與暗色的一起
  const stk = byName(a, "甲方"), exp = byName(a, "期望甲", "RequirementUsage");
  const g = buildGraph({ ...d, members: [stk.id, exp.id, misc.id] }, a);
  assert.deepEqual(new Set(g.nodes.map((n) => n.id)), new Set([stk.id, exp.id, misc.id]));
  assert.ok(g.edges.some((e) => e.kind === "trace" && e.source === exp.id && e.target === stk.id), "期望追溯到利害關係人");
  assert.ok(g.edges.every((e) => e.key && !/:\d+$/.test(e.key) || e.key === e.id), "關係的連線有不含流水號的 key");
  // 已經在圖上的不再列出
  assert.ok(!analysisPalette(a, d.view!, [stk.id]).pinned.some((e) => e.id === stk.id));
});

test("還缺什麼：只是提示，補齊之後就不再列出", async () => {
  const a = await load(MODEL);
  const sub = view("subsystem-req").missing!(a);
  assert.ok(!sub.some((m) => m.text.includes("還沒有接到系統需求")), "衍生已經接上");
  assert.ok(sub.some((m) => m.id === byName(a, "次系統需求甲", "RequirementUsage").id && m.text.includes("負責的次系統")));
  const stk = view("stakeholders").missing!(a);
  assert.ok(!stk.some((m) => m.text.includes("甲方 還沒有期望")));
  assert.ok(stk.some((m) => m.text.includes("使用情境")));
  assert.ok(view("schematic").missing!(a).every((m) => !m.text.includes("還沒有系統")));
});

test("系統簡圖：系統畫成外框，零件照 station 由上而下緊貼著疊起來，像一枚火箭", async () => {
  const a = await load(MODEL);
  const d = analysisDiagrams({}).find((x) => x.id === "view:schematic")!;
  const rocket = byName(a, "測試箭");
  const g = buildGraph({ ...d, members: [rocket.id] }, a);
  assert.equal(g.arrange, "rocket");
  const box = g.nodes.find((n) => n.id === rocket.id)!;
  assert.equal(box.container, true);
  const kids = g.nodes.filter((n) => n.inside === rocket.id);
  assert.deepEqual(kids.map((n) => n.name), ["頭段", "中段", "尾段"], "照 station 排，不是宣告的順序");
  assert.deepEqual(stationOrder(a.elements.filter((e) => e.owner === rocket.id && e.kind === "PartUsage")).map((e) => e.name), ["頭段", "中段", "尾段"]);
  const pos = rocketLayout(g, {});
  const b = pos[rocket.id];
  let y = b.y + containerHead(box);
  for (const k of kids) {
    assert.equal(pos[k.id].y, y, `${k.name} 緊貼上一段`);
    assert.ok(pos[k.id].x >= b.x && pos[k.id].x + k.width <= b.x + b.w!, `${k.name} 在外框裡`);
    y += k.height;
  }
  assert.ok(b.h! >= y - b.y, "外框包得住所有零件");
  // 使用者拖過的不動
  const moved = rocketLayout(g, { [rocket.id]: { x: 500, y: 300, w: b.w, h: b.h }, [kids[0].id]: { x: 999, y: 999 } });
  assert.equal(moved[rocket.id], undefined);
  assert.equal(moved[kids[0].id], undefined);
  assert.ok(moved[kids[1].id].y >= 999 + kids[0].height);
});

test("手動連線：轉折點存進版面紀錄、讀得回來；拉直就清掉；加轉折點插在最近的一段", () => {
  const nodes = { a: { x: 0, y: 0 }, [bendKey("trace:x:y", 9)]: { x: 1, y: 1 } };
  const next = withBends(nodes, "trace:x:y", [{ x: 10.4, y: 20 }, { x: 30, y: 40 }]);
  assert.deepEqual(next.a, { x: 0, y: 0 }, "節點的位置不動");
  assert.deepEqual(bendsOf(next, "trace:x:y"), [{ x: 10, y: 20 }, { x: 30, y: 40 }]);
  assert.deepEqual(bendsOf(next, "trace:x"), [], "鍵不會誤配到別的連線");
  assert.deepEqual(bendsOf(withBends(next, "trace:x:y", []), "trace:x:y"), []);
  // 0,0 → 100,0 → 100,100：靠近第二段的點插在第 1 個位置
  assert.equal(insertAt([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { x: 95, y: 60 }), 1);
  assert.equal(insertAt([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], { x: 40, y: 3 }), 0);
});

test("匯出：有轉折點的連線照轉折點畫，系統簡圖的外框畫在零件下面", async () => {
  const a = await load(MODEL);
  const d = analysisDiagrams({}).find((x) => x.id === "view:schematic")!;
  const rocket = byName(a, "測試箭"), head = byName(a, "頭段次系統");
  const g = buildGraph({ ...d, members: [rocket.id, head.id] }, a);
  const pos: Record<string, { x: number; y: number; w?: number; h?: number }> = { ...rocketLayout(g, {}), [head.id]: { x: 600, y: 24 } };
  const placed = g.nodes.map((n) => ({ g: { ...n, width: pos[n.id].w ?? n.width, height: pos[n.id].h ?? n.height }, x: pos[n.id].x, y: pos[n.id].y }));
  const e = g.edges.find((x) => x.kind === "define" && x.target === head.id)!;
  assert.ok(e, "零件由誰定義的連線");
  const svg = toSvg("«view» 圖 5 系統簡圖 : GeneralView", placed, g.edges, true, false, [], new Map([[e.key ?? e.id, [{ x: 450, y: -40 }]]]), true);
  const noBends = toSvg("f", placed, g.edges, true, false, [], new Map(), true);
  const bent = /<path d="M-?[\d.]+ -?[\d.]+ L-?[\d.]+ -?[\d.]+ L-?[\d.]+ -?[\d.]+" fill="none" stroke="#111" stroke-width="1" /;
  assert.match(svg, bent, "有轉折點：起點、轉折點、終點三點的折線");
  assert.doesNotMatch(noBends, bent, "分析圖沒有轉折點時畫直線，不自動繞線");
  assert.ok(svg.indexOf("測試箭") < svg.indexOf("頭段"), "外框先畫，零件疊在上面");
});

test("中文化：關鍵字中文在前、英文在後；縮寫第一次出現就展開，之後保留縮寫", () => {
  assert.deepEqual(zhKeyword("part def"), { zh: "零件定義", en: "part def" });
  assert.deepEqual(zhKeyword("«requirement»"), { zh: "需求", en: "requirement" });
  assert.equal(zhKeyword("abstract part def").zh, "零件定義");
  const seen = new Set<string>();
  assert.equal(expandFirst("目的與 MOE，MOE 的數字", seen), "目的與 效能量度（Measure of Effectiveness, MOE），MOE 的數字");
  assert.equal(expandFirst("再看 MOE", seen), "再看 MOE", "同一個畫面第二段不再展開");
  assert.equal(expandFirst("MOPS 不是縮寫"), "MOPS 不是縮寫");
  assert.equal(expandFirst("效能量度（MOE）已經寫了"), "效能量度（MOE）已經寫了");
});

test("JRI 範本（探空火箭）：四張分析圖都建得出來，放入全部釘選元素後沒有錯誤", async () => {
  const src = await fs.readFile(path.join(here, "../../templates/sounding-rocket/model.sysml"), "utf8");
  const a = await load(src);
  for (const d of analysisDiagrams({})) {
    const p = analysisPalette(a, d.view!);
    const g = buildGraph({ ...d, members: p.pinned.map((e) => e.id) }, a);
    assert.ok(g.nodes.length >= p.pinned.length, d.title);
    if (d.view!.arrange === "rocket") assert.ok(g.nodes.some((n) => n.container), "火箭畫成外框");
    assert.doesNotThrow(() => d.view!.missing?.(a));
  }
});
