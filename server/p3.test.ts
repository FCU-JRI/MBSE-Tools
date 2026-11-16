// P3：任務剖面、功能分配、MOE／MOP／TPM（docs/IMPL-PLAN.md）。內容都是合成的。執行：npm test
// 先用解析器直接走一次推導鏈，再啟動一個伺服器（埠 18831／18832）測路由。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyze, shutdown } from "./engine.ts";
import { setMetaText } from "./method/p3.ts";
import { allocationGaps, chainOf, levelOf, measuresOf, profileGaps, tpmStatus } from "../web/src/method/p3.ts";
import type { Analysis } from "../web/src/api.ts";

const lib = await fs.readFile(new URL("../library/JRI.sysml", import.meta.url), "utf8");
/** 任務需求類別由 P1 新增。P1 還沒合併時，只在這裡的解析測試補一行定義，好走完整條鏈；伺服器的測試不補 */
const HAS_MR = /requirement\s+def\s+MissionRequirement\b/.test(lib);
const libForParse = HAS_MR ? lib : lib.replace(/\}\s*$/, "    requirement def MissionRequirement;\n}\n");

const model = (withMr: boolean) => `package Project {
    private import ScalarValues::*;
    private import JRI::*;
    package NGOs {
        requirement <'OBJ-001'> '送達高度' : Objective;
        requirement <'MOE-001'> '遠地點高度' : MOE {
            @SuccessLevels { full = 3000.0; partial = 2500.0; unit = "m"; actual = 2700.0; }
        }
        #refinement dependency from '遠地點高度' to '送達高度';
        requirement <'MOE-002'> '落點偏移' : MOE {
            @SuccessLevels { full = 500.0; partial = 1000.0; unit = "m"; better = "lower"; actual = 1200.0; }
        }
        requirement <'MOP-001'> '總衝量' : MOP {
            @TPMTrack { expected = 9000.0; lower = 8500.0; upper = 9500.0; unit = "N*s"; mdr = 8800.0; pdr = 9600.0; }
        }
        #derivation connection { end #derive ::> '總衝量'; end #original ::> '遠地點高度'; }
        requirement <'MOP-002'> '乾重' : MOP;
        #derivation connection { end #derive ::> '乾重'; end #original ::> '遠地點高度'; }
    }
${withMr ? `    package Mission {
        requirement <'MR-001'> '全程遙測' : MissionRequirement;
        requirement <'MR-002'> '落地後尋回' : MissionRequirement;
    }
` : ""}    package Systems {
        part def '火箭' :> System;
        part def '地面站' :> System;
        part rocket : '火箭';
        part gs : '地面站';
    }
    package Behavior {
        action '任務' : MissionPhase {
            action '上升' : MissionPhase {
                action '發送遙測' : Function;
            }
            action '回收' : MissionPhase;
            first '上升' then '回收';
        }
        action '接收遙測' : Function;
        #trace dependency from '接收遙測' to '任務'::'上升';
        action '尋找火箭' : Function;
        allocate '任務'.'上升'.'發送遙測' to Systems::rocket;
        allocate '接收遙測' to Systems::gs;
${withMr ? `        #trace dependency from '任務'::'上升' to Mission::'全程遙測';
` : ""}        state '飛行模式' : Mode {
            state '正常' : Mode { @ModeKind { kind = "operational"; } }
            state '主傘未開' : Mode { @ModeKind { kind = "failure"; } }
            state '中止發射' : Mode;
            entry; then '正常';
            transition first '正常' then '主傘未開';
        }
    }
    package Requirements {
        requirement <'REQ-SYS-001'> '火箭發送遙測' : SystemRequirement;
        requirement <'REQ-SYS-002'> '地面站接收遙測' : SystemRequirement;
        satisfy '火箭發送遙測' by Systems::rocket;
        #trace dependency from '火箭發送遙測' to Behavior::'任務'::'上升'::'發送遙測';
        #trace dependency from '地面站接收遙測' to Behavior::'接收遙測';
${withMr ? `        #derivation connection { end #derive ::> '火箭發送遙測'; end #original ::> Mission::'全程遙測'; }
        #derivation connection { end #derive ::> '地面站接收遙測'; end #original ::> Mission::'全程遙測'; }
` : ""}    }
}
`;

const PORT = 18831, PUB = 18832;
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | undefined;
let home = "";

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-p3-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home, JRI_GH: "/bin/false" }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) return; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("伺服器沒有啟動");
});
after(async () => {
  await shutdown();
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

const parse = async (text: string) => {
  const a = await analyze([["JRI.sysml", libForParse], ["model.sysml", text]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400));
  return a;
};
const byName = (a: { elements: { id: string; name: string }[] }, n: string) => { const e = a.elements.find((x) => x.name === n); assert.ok(e, n); return e.id; };

test("JRI.sysml 加上 P3 的標記後仍能解析", async () => {
  const a = await analyze([["JRI.sysml", lib]]);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400));
});

test("推導鏈：任務需求 → 剖面 → 功能 → 分配到兩個系統 → 系統需求", async () => {
  const raw = await parse(model(true));
  const a = raw as unknown as Analysis;
  const id = (n: string) => byName(a, n);
  const c = chainOf(a);
  // 任務需求 → 剖面
  const mr = c.missionRequirements.find((m) => m.id === id("全程遙測"));
  assert.deepEqual(mr?.phases, [id("上升")]);
  assert.deepEqual(new Set(mr?.systemRequirements), new Set([id("火箭發送遙測"), id("地面站接收遙測")]));
  // 剖面 → 功能：寫在階段裡面的、追溯到階段的都算
  assert.deepEqual(new Set(c.phases.find((p) => p.id === id("上升"))?.functions), new Set([id("發送遙測"), id("接收遙測")]));
  // 功能 → 系統：分配給 part 使用，算到它的定義
  assert.deepEqual(c.functions.find((f) => f.id === id("發送遙測"))?.systems, [id("火箭")]);
  assert.deepEqual(c.functions.find((f) => f.id === id("接收遙測"))?.systems, [id("地面站")]);
  assert.equal(c.systems.length, 2, "火箭的定義與 rocket 使用算同一個系統");
  // 系統 → 系統需求：直接 satisfy，或追溯到已分配的功能
  assert.deepEqual(c.systems.find((s) => s.id === id("火箭"))?.requirements, [id("火箭發送遙測")]);
  assert.deepEqual(c.systems.find((s) => s.id === id("地面站"))?.requirements, [id("地面站接收遙測")]);
  // 模式的種類
  assert.deepEqual(c.modes.map((m) => [a.elements.find((e) => e.id === m.id)?.name, m.kind, m.container]),
    [["飛行模式", null, true], ["正常", "operational", false], ["主傘未開", "failure", false], ["中止發射", null, false]]);
  // 還缺什麼
  const p = profileGaps(a).map((g) => g.text);
  assert.ok(p.some((t) => t.includes("落地後尋回")), "沒有剖面的任務需求要列出");
  assert.ok(p.some((t) => t.includes("中止模式")));
  assert.ok(p.some((t) => t.startsWith("1 個模式還沒標種類")));
  assert.ok(!p.some((t) => t.includes("全程遙測")));
  const g = allocationGaps(a).map((t) => t.text);
  assert.ok(g.some((t) => t.includes("「尋找火箭」沒有接到任務階段")));
  assert.ok(g.some((t) => t.includes("「尋找火箭」還沒分配到系統")));
  assert.ok(!g.some((t) => t.includes("發送遙測")));
  assert.ok(g.some((t) => t.includes("MOE「落點偏移」還沒有 MOP")));
});

test("MOE 三級成功判準與 TPM 趨勢", async () => {
  const a = (await parse(model(true))) as unknown as Analysis;
  const id = (n: string) => byName(a, n);
  const m = measuresOf(a);
  const apogee = m.moes.find((x) => x.id === id("遠地點高度"));
  assert.deepEqual(apogee?.levels, { full: 3000, partial: 2500, unit: "m", better: "higher", actual: 2700 });
  assert.equal(apogee?.level, "partial");
  assert.deepEqual(new Set(apogee?.mops), new Set([id("總衝量"), id("乾重")]));
  const drift = m.moes.find((x) => x.id === id("落點偏移"))!;
  assert.equal(drift.level, "fail", "越小越好：1200 m 超過部分成功的 1000 m");
  assert.equal(levelOf(drift.levels!, 400), "full");
  assert.equal(levelOf(drift.levels!, 800), "partial");
  assert.equal(levelOf(apogee!.levels!, 3000), "full", "剛好等於門檻算達到");
  // TPM：從 MOP 挑出，節點依序排，最後一個是目前估計值
  assert.deepEqual(m.mops.map((x) => [x.id, x.tpm]), [[id("總衝量"), true], [id("乾重"), false]]);
  const t = m.tpms.find((x) => x.id === id("總衝量"));
  assert.equal(t?.mop, id("總衝量"));
  assert.deepEqual(t?.track.points, [{ gate: "mdr", value: 8800 }, { gate: "pdr", value: 9600 }]);
  assert.deepEqual(t?.latest, { gate: "pdr", value: 9600 });
  assert.equal(t?.status, "out", "9600 超過上限 9500");
  assert.equal(tpmStatus(t!.track, 8800), "within");
  assert.equal(tpmStatus({ ...t!.track, lower: null, upper: null }, 8800), "unknown");
});

test("設定標記的文字：新增、修改欄位、清除", async () => {
  let text = model(true);
  let a = await parse(text);
  const el = (n: string) => a.elements.find((e) => e.name === n)!;
  // 沒有主體的 MOP：展開成大括號再加標記
  text = setMetaText(text, el("乾重"), "TPMTrack", { expected: 18, upper: 20, unit: "kg", mdr: 19.5 });
  a = await parse(text);
  assert.match(text, /@TPMTrack \{ expected = 18\.0; upper = 20\.0; unit = "kg"; mdr = 19\.5; \}/);
  // 已有標記：只改指定的欄位，其餘保留
  text = setMetaText(text, el("乾重"), "TPMTrack", { pdr: 20.4, mdr: null });
  a = await parse(text);
  assert.deepEqual(measuresOf(a as unknown as Analysis).tpms.find((t) => t.id === el("乾重").id)?.track.points, [{ gate: "pdr", value: 20.4 }]);
  assert.equal(el("乾重").attrs.unit, "kg", "沒有指定的欄位保留原值");
  // 模式的種類
  text = setMetaText(text, el("中止發射"), "ModeKind", { kind: "abort" });
  a = await parse(text);
  assert.equal(chainOf(a as unknown as Analysis).modes.find((m) => m.id === el("中止發射").id)?.kind, "abort");
  // 全部清掉時移除整個標記
  text = setMetaText(text, el("正常"), "ModeKind", { kind: null });
  a = await parse(text);
  assert.ok(!el("正常").tags.includes("ModeKind"));
  // 不合法的值
  assert.throws(() => setMetaText(text, el("中止發射"), "ModeKind", { kind: "panic" }), /模式的種類只能是/);
  assert.throws(() => setMetaText(text, el("總衝量"), "TPMTrack", { mdr: "很多" }), /必須是數字/);
  assert.throws(() => setMetaText(text, el("總衝量"), "TPMTrack", { nope: 1 }), /沒有「nope」/);
});

async function call(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) as any };
}

test("路由：讀推導鏈、記錄 TPM 估計值、標模式種類", async () => {
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "p3", name: "P3 測試", kind: "small", gates: ["mdr"], template: "blank" })).status, 200);
  const files = (await call(`${I}/api/projects/p3/files`)).data as string[];
  const file = files[0];
  let r = await call(`${I}/api/projects/p3/files/${file}`, "PUT", { content: model(HAS_MR), message: "合成模型" });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  r = await call(`${I}/api/projects/p3/p3`);
  assert.equal(r.status, 200);
  const els = (await call(`${I}/api/projects/p3`)).data.analysis.elements as { id: string; name: string }[];
  const id = (n: string) => byName({ elements: els }, n);
  assert.equal(r.data.chain.systems.length, 2);
  assert.deepEqual(r.data.chain.functions.find((f: any) => f.id === id("接收遙測")).systems, [id("地面站")]);
  if (HAS_MR) assert.deepEqual(r.data.chain.missionRequirements.find((m: any) => m.id === id("全程遙測")).phases, [id("上升")]);
  assert.ok(Array.isArray(r.data.gaps.profile) && Array.isArray(r.data.gaps.allocation));

  // 記錄 CDR 的估計值：寫回模型，趨勢多一個點
  r = await call(`${I}/api/projects/p3/p3/meta`, "POST", { element: id("總衝量"), meta: "TPMTrack", values: { cdr: 9400 } });
  assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
  r = await call(`${I}/api/projects/p3/p3`);
  const t = r.data.measures.tpms.find((x: any) => x.id === id("總衝量"));
  assert.deepEqual(t.track.points.map((p: any) => [p.gate, p.value]), [["mdr", 8800], ["pdr", 9600], ["cdr", 9400]]);
  assert.equal(t.status, "within");
  const src = (await call(`${I}/api/projects/p3/files/${file}`)).data.content as string;
  assert.match(src, /cdr = 9400\.0;/);

  // 模式的種類
  r = await call(`${I}/api/projects/p3/p3/meta`, "POST", { element: id("中止發射"), meta: "ModeKind", values: { kind: "abort" } });
  assert.equal(r.status, 200);
  assert.ok(!r.data.analysis.elements.some((e: any) => e.name === "中止發射" && !e.tags.includes("ModeKind")));

  // 不合法的請求：檔案不變
  for (const body of [
    { element: id("總衝量"), meta: "ModeKind", values: { kind: "abort" } }, // 不是模式
    { element: id("總衝量"), meta: "TPMTrack", values: { mdr: "abc" } },
    { element: id("總衝量"), meta: "Nope", values: {} },
    { element: "no-such", meta: "TPMTrack", values: { mdr: 1 } },
  ]) {
    const x = await call(`${I}/api/projects/p3/p3/meta`, "POST", body);
    assert.ok(x.status >= 400 && x.status < 500, `${JSON.stringify(body)} → ${x.status}`);
  }
  assert.match((await call(`${I}/api/projects/p3/files/${file}`)).data.content, /kind = "abort"/);
});
