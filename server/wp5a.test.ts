// WP5a：性能對門檻（餘裕）、Excel 的公式清單與驗證矩陣、FMEA 分層推導、關係改對象與類型（MOD-20）。合成資料。
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { layerOf } from "../web/src/pages/tables/layers.ts";

const PORT = 18947, PUB = 18948; // 和其他測試檔錯開
const I = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
let home: string;

async function call(url: string, method = "GET", body?: unknown): Promise<{ status: number; data: any }> {
  const r = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, data };
}
const P = `${I}/api/projects/w5`;
const view = async () => (await call(P)).data.analysis;
const modelFile = () => path.join(home, "projects", "w5", "model", "model.sysml");

before(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "jri-wp5a-"));
  server = spawn(process.execPath, ["server/index.ts"], { env: { ...process.env, PORT: String(PORT), PUBLIC_PORT: String(PUB), JRI_HOME: home }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${I}/api/me`)).ok) break; } catch { /* 尚未啟動 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal((await call(`${I}/api/projects`, "POST", { id: "w5", name: "WP5a 測試", kind: "annual", template: "sample" })).status, 200);
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 800));
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
});

test("HOME-02：門檻、算出值、餘裕", async () => {
  const { status, data } = await call(`${P}/margins`);
  assert.equal(status, 200);
  const m = data.margins.find((x: any) => x.shortName === "REQ-SYS-001");
  assert.ok(m, JSON.stringify(data));
  assert.equal(m.attribute, "apogee");
  assert.equal(m.value, 2900); assert.equal(m.lo, 2850); assert.equal(m.hi, 3150);
  assert.equal(m.margin, 50); // 離下限 50 m，離上限 250 m，取近的
  assert.equal(m.unit, "m"); assert.equal(m.status, "holds");
});

test("TAB-11：Excel 含公式清單與驗證矩陣", async () => {
  const r = await fetch(`${P}/export.xlsx`);
  assert.equal(r.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
  const f = wb.getWorksheet("公式清單"), v = wb.getWorksheet("驗證矩陣");
  assert.ok(f && v);
  assert.match(String(f.getRow(2).getCell(4).value), /r\.apogee >= 2850/);
  assert.equal(f.getRow(2).getCell(6).value, "PASS");
  assert.equal(v.getRow(2).getCell(2).value, "●"); // REQ-SYS-001 被 VER-001 驗證
  assert.equal(v.getRow(3).getCell(4).value, "缺驗證"); // REQ-PROP-001 沒有驗證
});

test("TAB-04：風險層級優先取標記，其次由連結推出，推不出為空", async () => {
  const a = { elements: [
    { id: "r1", kind: "ItemUsage", category: "Risk", attrs: { layer: "mission" }, typeIds: [], owner: null },
    { id: "r2", kind: "ItemUsage", category: "Risk", attrs: {}, typeIds: [], owner: null },
    { id: "r3", kind: "ItemUsage", category: "Risk", attrs: {}, typeIds: [], owner: null },
    { id: "r4", kind: "ItemUsage", category: "Risk", attrs: {}, typeIds: [], owner: null },
    { id: "s", kind: "PartDefinition", category: "Subsystem", attrs: {}, typeIds: [], owner: null },
    { id: "c", kind: "PartDefinition", category: "Component", attrs: {}, typeIds: [], owner: null },
  ], relations: [{ kind: "trace", from: "r2", to: "s" }, { kind: "trace", from: "r2", to: "c" }] } as any;
  assert.deepEqual(layerOf(a.elements[0], a), { layer: "mission", how: "標記" });
  assert.deepEqual(layerOf(a.elements[1], a), { layer: "component", how: "連結" }); // 連到多個取最低層
  assert.equal(layerOf(a.elements[3], a).layer, "");
});

test("MOD-20：換對象、換類型（追溯／細化／滿足／分配）、狀態轉換、先後順序", async () => {
  let text = await fs.readFile(modelFile(), "utf8");
  text += `
package Extra {
    private import JRI::*;
    private import Project::Structure::*;
    #trace dependency from Project::Requirements::'總衝量' to Project::Requirements::'遠地點高度';
    allocate Project::Behavior::'任務'.'發射' to Project::Structure::rocket.'推進';
}
`;
  await fs.writeFile(modelFile(), text);
  const change = async (b: any) => { const r = await call(`${P}/relations/change`, "POST", b); assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300)); return r.data.analysis; };
  const find = (a: any, kind: string, from: string, to: string) => a.relations.find((r: any) => r.kind === kind && a.elements.find((e: any) => e.id === r.from)?.name === from && a.elements.find((e: any) => e.id === r.to)?.name === to);
  const id = (a: any, name: string, kind?: string) => a.elements.find((e: any) => e.name === name && (!kind || e.kind === kind)).id;

  let a = await view();
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics));
  const t = find(a, "trace", "總衝量", "遠地點高度");
  assert.ok(t);
  a = await change({ kind: "trace", from: t.from, to: t.to, newKind: "refine" });
  assert.ok(find(a, "refine", "總衝量", "遠地點高度"));
  a = await change({ kind: "refine", from: id(a, "總衝量"), to: id(a, "遠地點高度"), newKind: "trace", newTo: id(a, "遠地點達 3000 m") });
  assert.ok(find(a, "trace", "總衝量", "遠地點達 3000 m"));

  const al = find(a, "allocate", "發射", "推進");
  assert.ok(al);
  a = await change({ kind: "allocate", from: al.from, to: al.to, newTo: id(a, "航電", "PartUsage") });
  assert.ok(find(a, "allocate", "發射", "航電"));

  const tr = find(a, "transition", "待命", "上升");
  a = await change({ kind: "transition", from: tr.from, to: tr.to, newTo: id(a, "落地") });
  assert.ok(find(a, "transition", "待命", "落地"));
  const su = find(a, "succession", "發射", "動力飛行");
  a = await change({ kind: "succession", from: su.from, to: su.to, newTo: id(a, "滑行") });
  assert.ok(find(a, "succession", "發射", "滑行"));
  assert.equal(a.ok, true);
});
