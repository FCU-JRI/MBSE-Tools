// 工作包 A：說明性欄位（為什麼／判定條件、否決原因、評分標準、敏感度、回頭修正、調整分數、喊卡、TPM 各節點值）。
// 解析讀得到、寫得回去、刪得掉；舊專案照常開啟、不自動填內容；缺說明只警告。全部是合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { upgradeText } from "./upgrade.ts";
import { GATES } from "./gates.ts";
import { META_SPEC } from "./metamodel.ts";

const PORT = 18997, PUB = 18998; // 和其他測試檔錯開
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;
let v: any;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
const model = () => fs.readFile(path.join(home, "projects", "wa", "model", "model.sysml"), "utf8");
const els = () => v.analysis.elements as any[];
const named = (n: string) => els().find((e) => e.name === n && e.kind !== "ReferenceUsage");
async function send(p: string, method: string, body: unknown, want = 200) {
  const r = await call(`${I}/api/projects/wa${p}`, method, body);
  assert.equal(r.status, want, JSON.stringify(r.data).slice(0, 400));
  if (r.data?.analysis) v = r.data;
  return r.data;
}
const reload = async () => { v = (await call(`${I}/api/projects/wa`)).data; };

// 合成的設計方案、準則、風險、決策：寫成一般原始碼，再由 API 補欄位
const SYNTH = `
    package WpA {
        variation part def <'ALT-901'> '合成方案' :> DesignAlternative {
            variant part <'ALT-901-1'> '合成甲';
            variant part <'ALT-901-2'> '合成乙';
        }
        requirement <'REQ-SYS-901'> '合成準則' : SystemRequirement;
        item <'RISK-901'> '合成風險' : Risk;
        item <'DEC-901'> '合成決策' : DesignDecision;
        #trace dependency from 'ALT-901' to 'REQ-SYS-901';
    }
`;
let original = "";

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-wpa-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "wa", name: "WP-A 測試", kind: "annual", template: "sample" })).status, 200);
  await reload();
  original = await model();
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("升級：既有專案沒有這些欄位照常開啟，不自動填內容；新寫法不被升級改動", async () => {
  assert.equal(v.analysis.ok, true, "範例專案在新的元模型庫下解析成功");
  for (const e of els()) for (const k of ["why", "judge", "rejectWhy", "scale1", "sensitivity", "fixNote", "releaseStatus", "holdReason", "atPDR"]) assert.equal(e.attrs[k], undefined, `${e.name} 不該自動有 ${k}`);
  assert.equal(await model(), original, "開啟不改模型檔");
  assert.doesNotMatch(original, /@DesignRationale|@Rejection|@CriterionScale|@TradeSensitivity|@TpmTrend|#fix/);
  const fresh = [
    "#fix dependency from 'RISK-1' to 'ALT-1'::'甲';",
    "@DesignRationale { why = \"合成理由\"; judge = \"合成條件\"; }",
    "@TpmTrend { atProposal = 7.9; atPDR = 7.2; }",
    "attribute adjusted_REQ_SYS_001 : TradeScore = 5.0;",
  ].join("\n");
  assert.equal(upgradeText(fresh), fresh, "新寫法原樣保留");
  const lib = await call(`${I}/api/meta`);
  assert.deepEqual(lib.data.meta.map((m: any) => m.id), ["DesignRationale", "Rejection", "CriterionScale", "TradeSensitivity", "TpmTrend"]);
});

test("解析：直接寫在原始碼裡的欄位都出現在元素與關係上", async () => {
  const text = original.replace(/\}\s*$/, `${SYNTH}}\n`)
    .replace("variant part <'ALT-901-2'> '合成乙';", "variant part <'ALT-901-2'> '合成乙' { @Rejection { rejectWhy = \"合成否決\"; } attribute score_REQ_SYS_901 : TradeScore = 2.0; attribute adjusted_REQ_SYS_901 : TradeScore = 4.0; }")
    .replace("requirement <'REQ-SYS-901'> '合成準則' : SystemRequirement;", "requirement <'REQ-SYS-901'> '合成準則' : SystemRequirement { @DesignRationale { why = \"合成為什麼\"; judge = \"合成判定\"; } @CriterionScale { scale1 = \"差\"; scale3 = \"可\"; scale5 = \"好\"; } }")
    .replace("item <'RISK-901'> '合成風險' : Risk;", "item <'RISK-901'> '合成風險' : Risk { :>> fixNote = \"改了合成乙\"; }\n        #fix dependency from 'RISK-901' to 'ALT-901'::'ALT-901-2';")
    .replace("item <'DEC-901'> '合成決策' : DesignDecision;", "item <'DEC-901'> '合成決策' : DesignDecision { :>> releaseStatus = \"hold\"; :>> holdReason = \"待合成秤重\"; }");
  const r = await call(`${I}/api/projects/wa/files/model.sysml`, "PUT", { content: text, message: "合成資料" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 400));
  await reload();
  assert.equal(named("合成乙").attrs.rejectWhy, "合成否決");
  assert.equal(named("合成乙").attrs.adjusted_REQ_SYS_901, "4.0");
  assert.ok(named("合成乙").tags.includes("Rejection"));
  const req = named("合成準則");
  assert.deepEqual([req.attrs.why, req.attrs.judge, req.attrs.scale1, req.attrs.scale3, req.attrs.scale5], ["合成為什麼", "合成判定", "差", "可", "好"]);
  assert.equal(named("合成風險").attrs.fixNote, "改了合成乙");
  assert.equal(named("合成決策").attrs.releaseStatus, "hold");
  assert.equal(named("合成決策").attrs.holdReason, "待合成秤重");
  assert.ok(v.analysis.relations.some((x: any) => x.kind === "fix" && x.from === named("合成風險").id && x.to === named("合成乙").id), "#fix 讀成 fix 關係");
  // 還原成沒有欄位的合成資料，給後面的寫回測試用
  const plain = original.replace(/\}\s*$/, `${SYNTH}}\n`);
  assert.equal((await call(`${I}/api/projects/wa/files/model.sysml`, "PUT", { content: plain, message: "合成資料" })).status, 200);
  await reload();
  assert.equal(named("合成乙").attrs.rejectWhy, undefined);
});

test("為什麼／判定條件：新增、只改一欄、拿掉；缺了只警告，不影響卡點", async () => {
  const holdBefore = JSON.stringify(v.framework.holdPoints);
  const passedBefore = JSON.stringify(v.framework.layers.map((l: any) => l.passed));
  assert.ok(v.framework.rationaleGaps.some((g: any) => g.id === named("合成準則").id && g.missing.join() === "why,judge"), "缺說明列在警告裡");
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { DesignRationale: { why: "合成理由一", judge: "合成條件一" } } });
  assert.equal(named("合成準則").attrs.why, "合成理由一");
  assert.match(await model(), /@DesignRationale \{ why = "合成理由一"; judge = "合成條件一"; \}/);
  assert.ok(!v.framework.rationaleGaps.some((g: any) => g.id === named("合成準則").id), "填了就不再警告");
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { DesignRationale: { judge: "合成條件二" } } });
  assert.equal(named("合成準則").attrs.why, "合成理由一", "沒帶的欄位保留");
  assert.equal(named("合成準則").attrs.judge, "合成條件二");
  assert.equal((await model()).match(/@DesignRationale/g)?.length, 1, "不會多出第二個標記");
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { DesignRationale: { why: "" } } });
  assert.equal(named("合成準則").attrs.why, undefined);
  assert.ok(v.framework.rationaleGaps.some((g: any) => g.id === named("合成準則").id && g.missing.join() === "why"));
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { DesignRationale: { judge: "" } } });
  assert.doesNotMatch(await model(), /@DesignRationale/, "全空就整個拿掉");
  // 結構元素（part def）也可以掛
  const sys = els().find((e) => e.category === "System");
  await send("/elements", "PATCH", { id: sys.id, meta: { DesignRationale: { why: "合成系統邊界" } } });
  assert.equal(named(sys.name).attrs.why, "合成系統邊界");
  assert.equal(JSON.stringify(v.framework.holdPoints), holdBefore, "卡點不受說明欄位影響");
  assert.equal(JSON.stringify(v.framework.layers.map((l: any) => l.passed)), passedBefore, "迴圈進度不受說明欄位影響");
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { Nope: { x: "1" } } }, 400);
});

test("否決原因、評分標準、權重敏感度：只能掛在對的元素上，可改可刪", async () => {
  await send("/elements", "PATCH", { id: named("合成乙").id, meta: { Rejection: { rejectWhy: "合成：重量超出配額" } } });
  assert.equal(named("合成乙").attrs.rejectWhy, "合成：重量超出配額");
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { Rejection: { rejectWhy: "x" } } }, 400);
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { CriterionScale: { scale1: "合成一", scale3: "合成三", scale5: "合成五" } } });
  assert.deepEqual([1, 3, 5].map((n) => named("合成準則").attrs[`scale${n}`]), ["合成一", "合成三", "合成五"]);
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { CriterionScale: { scale3: "" } } });
  assert.equal(named("合成準則").attrs.scale3, undefined);
  assert.equal(named("合成準則").attrs.scale5, "合成五");
  await send("/elements", "PATCH", { id: named("合成方案").id, meta: { TradeSensitivity: { sensitivity: "合成：權重 3→5 排序不變" } } });
  assert.equal(named("合成方案").attrs.sensitivity, "合成：權重 3→5 排序不變");
  await send("/elements", "PATCH", { id: named("合成乙").id, meta: { TradeSensitivity: { sensitivity: "x" } } }, 400);
  await send("/elements", "PATCH", { id: named("合成乙").id, meta: { Rejection: { rejectWhy: "" } } });
  await send("/elements", "PATCH", { id: named("合成方案").id, meta: { TradeSensitivity: { sensitivity: "" } } });
  assert.equal(named("合成乙").attrs.rejectWhy, undefined);
  assert.doesNotMatch(await model(), /@Rejection|@TradeSensitivity/);
});

test("調整分數：寫在候選上、改、刪；刪準則時一併拿掉", async () => {
  const body = { variant: named("合成甲").id, requirement: named("合成準則").id };
  await send("/trade/score", "POST", { ...body, score: "2" });
  await send("/trade/adjusted", "POST", { ...body, score: "5" });
  assert.equal(named("合成甲").attrs.score_REQ_SYS_901, "2.0");
  assert.equal(named("合成甲").attrs.adjusted_REQ_SYS_901, "5.0");
  assert.ok(!v.framework.rationaleGaps.some((g: any) => !v.analysis.elements.some((e: any) => e.id === g.id && e.category && !["TradeScore", "InterfacePort"].includes(e.category)) ), "分數屬性、連接埠不列在缺說明");
  await send("/trade/adjusted", "POST", { ...body, score: "4.5" });
  assert.equal(named("合成甲").attrs.adjusted_REQ_SYS_901, "4.5");
  await send("/trade/adjusted", "POST", { ...body, score: "abc" }, 400);
  await send("/trade/adjusted", "POST", { ...body, score: "" });
  assert.equal(named("合成甲").attrs.adjusted_REQ_SYS_901, undefined);
  assert.equal(named("合成甲").attrs.score_REQ_SYS_901, "2.0", "原始分數不受影響");
  await send("/trade/adjusted", "POST", { ...body, score: "3" });
  await send("/trade/criterion/delete", "POST", { alt: named("合成方案").id, requirement: named("合成準則").id });
  assert.equal(named("合成甲").attrs.adjusted_REQ_SYS_901, undefined);
  assert.equal(named("合成甲").attrs.score_REQ_SYS_901, undefined);
  await send("/trade/criterion", "POST", { alt: named("合成方案").id, requirement: named("合成準則").id }); // 還原準則
});

test("風險回頭修正：修正內容＋「修正了」關係；起點不是風險被拒絕", async () => {
  await send("/elements", "PATCH", { id: named("合成風險").id, attrs: { fixNote: "合成：改用折疊槳", residualSeverity: "2", residualLikelihood: "1" } });
  assert.equal(named("合成風險").attrs.fixNote, "合成：改用折疊槳");
  assert.equal(named("合成風險").attrs.residualLikelihood, "1");
  await send("/relations", "POST", { kind: "fix", from: named("合成風險").id, to: named("合成甲").id });
  assert.match(await model(), /#fix dependency from Project::WpA::'合成風險' to Project::WpA::'合成方案'::'合成甲';/);
  assert.ok(v.analysis.relations.some((x: any) => x.kind === "fix" && x.from === named("合成風險").id && x.to === named("合成甲").id));
  await send("/relations", "POST", { kind: "fix", from: named("合成決策").id, to: named("合成甲").id }, 400);
  await send("/relations/delete", "POST", { kind: "fix", from: named("合成風險").id, to: named("合成甲").id });
  assert.doesNotMatch(await model(), /#fix/);
  await send("/elements", "PATCH", { id: named("合成風險").id, attrs: { fixNote: "" } });
  assert.equal(named("合成風險").attrs.fixNote, undefined);
});

test("決策喊卡：切放行／喊卡與原因；不在清單的值被拒絕；喊卡只警告", async () => {
  await send("/elements", "PATCH", { id: named("合成決策").id, attrs: { releaseStatus: "hold", holdReason: "合成：待秤重。" } });
  assert.equal(named("合成決策").attrs.releaseStatus, "hold");
  assert.equal(named("合成決策").attrs.holdReason, "合成：待秤重。");
  const hd = v.framework.holdDecisions.find((d: any) => d.id === named("合成決策").id);
  assert.equal(hd?.text, "DEC-901 合成決策 喊卡中：合成：待秤重；下一層可以寫，但會顯示警告。");
  // 下一層照常可寫，回應帶警告；卡點與迴圈判定和放行時一樣
  const next = v.framework.holdPoints[0].category;
  const holdPointsHeld = JSON.stringify(v.framework.holdPoints), layersHeld = JSON.stringify(v.framework.layers.map((l: any) => l.passed));
  const made = await send("/elements", "POST", { category: next, name: "合成下一層" });
  assert.match(made.holdWarning, /DEC-901 合成決策 喊卡中：合成：待秤重/);
  await send("/elements/delete", "POST", { id: named("合成下一層").id });
  await send("/elements", "PATCH", { id: named("合成決策").id, attrs: { releaseStatus: "ok" } });
  assert.equal(named("合成決策").attrs.releaseStatus, "ok");
  assert.equal(v.framework.holdDecisions.length, 0, "放行後沒有喊卡警告");
  assert.equal(JSON.stringify(v.framework.holdPoints), holdPointsHeld, "喊卡不改卡點（FW-02 不變）");
  assert.equal(JSON.stringify(v.framework.layers.map((l: any) => l.passed)), layersHeld, "喊卡不改迴圈進度");
  const again = await send("/elements", "POST", { category: next, name: "合成下一層" });
  assert.doesNotMatch(again.holdWarning ?? "", /喊卡/);
  await send("/elements/delete", "POST", { id: named("合成下一層").id });
  const before = await model();
  await send("/elements", "PATCH", { id: named("合成決策").id, attrs: { releaseStatus: "maybe" } }, 400);
  assert.equal(await model(), before, "被拒絕時模型不變");
  await send("/elements", "PATCH", { id: named("合成決策").id, attrs: { releaseStatus: "", holdReason: "" } });
  assert.equal(named("合成決策").attrs.releaseStatus, undefined);
});

test("TPM 各節點的值：欄位跟著審查節點；寫、改一個節點、非數字被拒絕、專案沒啟用的節點值保留、清空", async () => {
  // 一個設計審查節點一個欄位（異常審查、計畫收束不更新 TPM 估計值）
  assert.deepEqual(META_SPEC.get("TpmTrend")!.fields.map((f) => f.gate), ["proposal", "mdr", "pdr", "cdr", "trr", "frr"]);
  for (const f of META_SPEC.get("TpmTrend")!.fields) assert.ok(GATES.some((g) => g.id === f.gate), `${f.gate} 是審查節點`);
  const lib = await fs.readFile(path.join(process.cwd(), "library", "JRI.sysml"), "utf8");
  for (const f of META_SPEC.get("TpmTrend")!.fields) assert.match(lib, new RegExp(`attribute ${f.name} : Real\\[0\\.\\.1\\];`), `JRI.sysml 宣告 ${f.name}`);
  const tpm = () => els().find((e) => e.name === "dryMass" && e.tags.includes("TPM"));
  assert.ok(tpm(), "範例專案有 #tpm 屬性");
  await send("/elements", "PATCH", { id: tpm().id, meta: { TpmTrend: { atProposal: "7.9", atMDR: "7.6", atPDR: "7.2", atFRR: "6.9" } } });
  assert.deepEqual([tpm().attrs.atProposal, tpm().attrs.atMDR, tpm().attrs.atPDR], ["7.9", "7.6", "7.2"]);
  assert.ok(tpm().tags.includes("TPM"), "仍是 TPM");
  await send("/elements", "PATCH", { id: tpm().id, meta: { TpmTrend: { atPDR: "7" } } });
  assert.equal(tpm().attrs.atPDR, "7.0");
  assert.equal(tpm().attrs.atProposal, "7.9");
  await send("/elements", "PATCH", { id: tpm().id, meta: { TpmTrend: { atCDR: "很重" } } }, 400);
  await send("/elements", "PATCH", { id: tpm().id, meta: { TpmTrend: { atSRR: "7" } } }, 400);
  await send("/elements", "PATCH", { id: named("合成準則").id, meta: { TpmTrend: { atProposal: "1" } } }, 400);
  // 改成只啟用 PDR 的小型專案：原始碼裡 FRR 等節點的值照樣解析、寫 PDR 時不會被丟掉
  assert.equal((await call(`${I}/api/projects/wa`, "PATCH", { kind: "small", gates: ["pdr"] })).status, 200);
  await reload();
  assert.deepEqual(v.project.gates, ["pdr"]);
  assert.equal(tpm().attrs.atFRR, "6.9");
  await send("/elements", "PATCH", { id: tpm().id, meta: { TpmTrend: { atPDR: "7.1" } } });
  assert.deepEqual([tpm().attrs.atPDR, tpm().attrs.atFRR, tpm().attrs.atProposal], ["7.1", "6.9", "7.9"]);
  assert.equal((await call(`${I}/api/projects/wa`, "PATCH", { kind: "annual" })).status, 200);
  await send("/elements", "PATCH", { id: tpm().id, meta: { TpmTrend: { atProposal: "", atMDR: "", atPDR: "", atFRR: "" } } });
  assert.equal(tpm().attrs.atPDR, undefined);
  assert.doesNotMatch(await model(), /@TpmTrend/);
});
