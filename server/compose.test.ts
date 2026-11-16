// 匯入的抽取與分解圖上的「加入零件」（階段 3b）。內容都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { analyze, shutdown } from "./engine.ts";
import type { Analysis } from "./engine.ts";
import { addPartText } from "./edits.ts";

after(() => shutdown());
const load = async (...sources: [string, string][]) => { const a = await analyze(sources); assert.equal(a.ok, true, JSON.stringify(a.diagnostics).slice(0, 400)); return a; };
const el = (a: Analysis, qn: string) => { const e = a.elements.find((x) => x.qualifiedName === qn); assert.ok(e, qn); return e; };

test("匯入的抽取：來源、對象、是不是 private、檔案與行號；標準庫的對象只留名稱", async () => {
  const a = await load(["a.sysml", `package A {
    private import B::*;
    public import B::E;
    private import ScalarValues::Real;
    package Sub { private import ISQ::*; private import B::**; }
    part def X;
}
package B {
    part def E;
    package Inner { part def F; }
    private import B::Inner::F;
}
`], ["b.sysml", "package C { private import A::X; }\n"]);
  const qn = (id: string | null) => (id ? a.elements.find((e) => e.id === id)?.qualifiedName ?? "?" : null);
  assert.deepEqual(a.imports.map((i) => [qn(i.from), qn(i.to), i.toName, i.member, i.recursive, i.private, i.file, i.line]), [
    ["A", "B", "B", false, false, true, "a.sysml", 2],
    ["A", "B::E", "B::E", true, false, false, "a.sysml", 3],
    ["A", null, "ScalarValues::Real", true, false, true, "a.sysml", 4],
    ["A::Sub", null, "ISQ", false, false, true, "a.sysml", 5],
    ["A::Sub", "B", "B", true, true, true, "a.sysml", 5],
    ["B", "B::Inner::F", "B::Inner::F", true, false, true, "a.sysml", 11],
    ["C", "A::X", "A::X", true, false, true, "b.sysml", 1],
  ]);
  assert.ok(a.imports.every((i) => i.loc && i.loc.line === i.line));
});

const VEHICLE = `package Vehicle {
    part def Car;
    part def Truck {
        attribute mass;
    }
}
`;
const PARTS = `package Propulsion {
    part def Engine;
    part def Wheel;
}
`;

test("加入零件：型別在別的套件時補 private import、用短名稱（零件名稱小寫開頭）；解析後型別指到正確的定義", async () => {
  const a = await load(["v.sysml", VEHICLE], ["p.sysml", PARTS]);
  const out = addPartText(VEHICLE, a.elements, a.imports, el(a, "Vehicle::Car"), el(a, "Propulsion::Engine"));
  assert.equal(out.imported, true);
  assert.match(out.content, /^package Vehicle \{\n    private import Propulsion::Engine;\n/);
  assert.match(out.content, /part def Car \{\n        part engine : Engine;\n    \}/);
  const b = await load(["v.sysml", out.content], ["p.sysml", PARTS]);
  const part = el(b, "Vehicle::Car::engine");
  assert.equal(part.kind, "PartUsage");
  assert.deepEqual(part.typeIds, [el(b, "Propulsion::Engine").id]);
  assert.ok(b.imports.some((i) => i.from === el(b, "Vehicle").id && i.to === el(b, "Propulsion::Engine").id && i.private));
});

test("加入零件：重複加入同一個型別不會重複 import；已經用 ::* 匯入的套件不再補", async () => {
  const a = await load(["v.sysml", VEHICLE], ["p.sysml", PARTS]);
  const once = addPartText(VEHICLE, a.elements, a.imports, el(a, "Vehicle::Car"), el(a, "Propulsion::Engine")).content;
  const b = await load(["v.sysml", once], ["p.sysml", PARTS]);
  const twice = addPartText(once, b.elements, b.imports, el(b, "Vehicle::Truck"), el(b, "Propulsion::Engine"));
  assert.equal(twice.imported, false);
  assert.equal(twice.content.match(/private import/g)?.length, 1);
  const c = await load(["v.sysml", twice.content], ["p.sysml", PARTS]);
  assert.deepEqual(el(c, "Vehicle::Truck::engine").typeIds, [el(c, "Propulsion::Engine").id]);

  const star = VEHICLE.replace("package Vehicle {\n", "package Vehicle {\n    private import Propulsion::*;\n");
  const d = await load(["v.sysml", star], ["p.sysml", PARTS]);
  const w = addPartText(star, d.elements, d.imports, el(d, "Vehicle::Car"), el(d, "Propulsion::Wheel"));
  assert.equal(w.imported, false);
  assert.equal(w.content.match(/private import/g)?.length, 1);
  const e = await load(["v.sysml", w.content], ["p.sysml", PARTS]);
  assert.deepEqual(el(e, "Vehicle::Car::wheel").typeIds, [el(e, "Propulsion::Wheel").id]);
});

test("加入零件：同一個套件照原本的寫法；短名稱會撞名或名稱沒有大小寫時不補 import、改寫完整名稱", async () => {
  const a = await load(["v.sysml", VEHICLE], ["p.sysml", PARTS]);
  const same = addPartText(VEHICLE, a.elements, a.imports, el(a, "Vehicle::Truck"), el(a, "Vehicle::Car"));
  assert.equal(same.imported, false);
  assert.match(same.content, /        part Car : Vehicle::Car;\n/);
  assert.doesNotMatch(same.content, /import/);

  const local = VEHICLE.replace("    part def Car;\n", "    part def Car;\n    part def Engine;\n");
  const b = await load(["v.sysml", local], ["p.sysml", PARTS]);
  const out = addPartText(local, b.elements, b.imports, el(b, "Vehicle::Car"), el(b, "Propulsion::Engine"));
  assert.equal(out.imported, false);
  assert.match(out.content, /part Engine : Propulsion::Engine;/);
  const c = await load(["v.sysml", out.content], ["p.sysml", PARTS]);
  assert.deepEqual(el(c, "Vehicle::Car::Engine").typeIds, [el(c, "Propulsion::Engine").id]);

  // 名稱開頭沒有大小寫（中文）：照「組成」的寫法，不補 import
  const zh = PARTS.replace("    part def Wheel;\n", "    part def Wheel;\n    part def '推進器';\n");
  const d = await load(["v.sysml", VEHICLE], ["p.sysml", zh]);
  const z = addPartText(VEHICLE, d.elements, d.imports, el(d, "Vehicle::Car"), el(d, "Propulsion::推進器"));
  assert.equal(z.imported, false);
  assert.match(z.content, /part '推進器' : Propulsion::'推進器';/);
  const f = await load(["v.sysml", z.content], ["p.sysml", zh]);
  assert.deepEqual(el(f, "Vehicle::Car::推進器").typeIds, [el(f, "Propulsion::推進器").id]);
});
