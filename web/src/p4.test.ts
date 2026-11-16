// P4：互連圖可以編輯（介面工具、JRI 介面可刪除）與圖 6「還缺什麼」。模型與數值都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyze, shutdown } from "../../server/engine.ts";
import { buildGraph, diagramsOf, LINK_TOOLS } from "./model.ts";
import { interfaceMissing } from "./method/interfaceMissing.ts";
import { ANALYSIS_VIEWS } from "./method/views.ts";
import type { Analysis } from "./api.ts";

after(() => shutdown());
const MODEL = `package Project {
    private import ScalarValues::*; private import ISQ::*; private import SI::*; private import JRI::*;
    port def Pwr :> InterfacePort { attribute v : ISQ::ElectricPotentialValue; }
    interface def PwrLink :> Interface { attribute :>> interfaceKind = JRI::InterfaceKind::electrical; end s : Pwr; end t : Pwr; assert constraint same { s.v == t.v } }
    interface def Loose :> Interface;
    part def Bat :> Subsystem { port p : Pwr { attribute :>> v = 5.0 [V]; } }
    part def Fc :> Subsystem { port p : Pwr { attribute :>> v = 5.0 [V]; } }
    part def Chute :> Subsystem;
    part def Rocket :> System { part bat : Bat; part fc : Fc; interface feed : PwrLink connect bat.p to fc.p; }
}`;
const load = async () => (await analyze([["JRI.sysml", await fs.readFile("library/JRI.sysml", "utf8")], ["m.sysml", MODEL]])) as unknown as Analysis;

test("互連圖有介面工具；JRI 的介面可以從圖上刪除", async () => {
  const a = await load();
  assert.equal(a.ok, true);
  assert.deepEqual(LINK_TOOLS.ibd.map((t) => t.kind), ["connect", "interface"]);
  const d = diagramsOf(a).find((x) => x.id === "ibd:Project::Rocket");
  assert.ok(d);
  const g = buildGraph(d, a);
  const e = g.edges.find((x) => x.label === "feed : PwrLink");
  assert.ok(e);
  assert.deepEqual(e.remove, { type: "element", id: "Project__Rocket__feed" });
  assert.ok(e.sourcePort && e.targetPort, "介面接在連接埠上");
});

test("圖 6 登記為第 6 張；還缺什麼", async () => {
  const a = await load();
  const v = ANALYSIS_VIEWS.find((x) => x.id === "interfaces");
  assert.equal(v?.order, 6);
  const miss = interfaceMissing(a).map((m) => m.text);
  assert.deepEqual(miss, ["「Chute」還沒有任何介面。", "介面「Loose」還沒有定種類。"]);
});
