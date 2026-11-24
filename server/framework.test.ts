// 框架定義檔 framework/jri.json 的一致性檢查。不啟動伺服器。
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadFramework, stepsOf, validateFramework } from "./framework.ts";
import type { Framework } from "./framework.ts";
import { CATEGORIES } from "./metamodel.ts";
import { GATES } from "./gates.ts";
import { RANKS } from "./auth.ts";

const known = { categories: CATEGORIES.map((c) => c.id), gates: GATES.map((g) => g.id), ranks: [...RANKS] };
const fresh = (): Framework => loadFramework();

test("框架檔：引用的類別、節點、角色、步驟都存在", () => {
  assert.deepEqual(validateFramework(fresh(), known), []);
});

test("框架檔：7 層依序，第 3～5 層是設計迴圈並以 MDR、PDR、CDR 收尾", () => {
  const f = fresh();
  assert.deepEqual(f.layers.map((l) => l.order), [1, 2, 3, 4, 5, 6, 7]);
  const loops = f.layers.filter((l) => l.kind === "loop" && l.gate).map((l) => [l.id, l.gate]);
  assert.deepEqual(loops, [["system", "mdr"], ["subsystem", "pdr"], ["detailDesign", "cdr"]]);
});

test("框架檔：每個迴圈層都走到卡點，且答否都回到方案分析", () => {
  const f = fresh();
  for (const l of f.layers.filter((x) => x.kind === "loop")) assert.ok(stepsOf(f, l).some((s) => s.holdPoint), `${l.id} 沒有卡點`);
  for (const s of f.designLoop.steps.filter((x) => x.decision)) assert.equal(s.onNo, "tradeStudy", s.id);
});

test("框架檔：次系統需求的來源是系統設計迴圈，不是直接從系統需求拆", () => {
  const f = fresh();
  const sub = f.layers.find((l) => l.id === "subsystem")!;
  const reqs = sub.before!.find((s) => s.id === "subsystemReqs")!;
  assert.deepEqual(reqs.derivedFrom, ["SystemRequirement"]);
  assert.equal(reqs.basisFrom, "system");
});

test("檢查會抓到：產生需求卻沒有設計產出來源", () => {
  const f = fresh();
  delete f.layers.find((l) => l.id === "subsystem")!.before!.find((s) => s.id === "subsystemReqs")!.basisFrom;
  assert.ok(validateFramework(f, known).some((p) => p.includes("subsystemReqs") && p.includes("basisFrom")));
});

test("檢查會抓到：設計產出來源指向後面的層", () => {
  const f = fresh();
  f.layers.find((l) => l.id === "system")!.before!.find((s) => s.id === "systemReqs")!.basisFrom = "subsystem";
  assert.ok(validateFramework(f, known).some((p) => p.includes("systemReqs") && p.includes("後面的層")));
});

test("檢查會抓到：不存在的節點、類別、角色、迴圈步驟", () => {
  const f = fresh();
  f.layers.find((l) => l.id === "system")!.gate = "xdr";
  f.elementTypes.push({ id: "NoSuchCategory", status: "existing" });
  f.layers.find((l) => l.id === "subsystem")!.loopOwner = "nobody";
  f.layers.find((l) => l.id === "detailDesign")!.loopSteps!.push("dance");
  const p = validateFramework(f, known);
  assert.ok(p.some((x) => x.includes("xdr")));
  assert.ok(p.some((x) => x.includes("NoSuchCategory")));
  assert.ok(p.some((x) => x.includes("nobody")));
  assert.ok(p.some((x) => x.includes("dance")));
});

test("檢查會抓到：迴圈拿掉卡點", () => {
  const f = fresh();
  const l = f.layers.find((x) => x.id === "system")!;
  l.loopSteps = l.loopSteps!.filter((s) => s !== "outputs");
  assert.ok(validateFramework(f, known).some((x) => x.includes("system") && x.includes("卡點")));
});
