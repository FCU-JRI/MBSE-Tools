// 舊寫法 → 標準庫寫法的轉換（F-36）。內容都是合成的。執行：npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { methodKind, upgradeText } from "./upgrade.ts";

test("衍生：相依改成標準庫的衍生連結，縮排與其餘內容不變", () => {
  const before = [
    "package Project {",
    "    requirement <'R-1'> '母' : Need;",
    "    requirement <'R-2'> '子' : Need;",
    "    #derive dependency from '子' to '母';",
    "}", ""].join("\n");
  assert.equal(upgradeText(before), before.replace("#derive dependency from '子' to '母';", "#derivation connection { end #derive ::> '子'; end #original ::> '母'; }"));
});

test("衍生：完整名稱、名稱裡有 to 或引號、一句多個對象", () => {
  assert.equal(upgradeText("#derive dependency from Requirements::'遠地點高度' to NGOs::'遠地點達 3000 m';"),
    "#derivation connection { end #derive ::> Requirements::'遠地點高度'; end #original ::> NGOs::'遠地點達 3000 m'; }");
  assert.equal(upgradeText("#derive dependency from 'A to B' to 'it\\'s C';"), "#derivation connection { end #derive ::> 'A to B'; end #original ::> 'it\\'s C'; }");
  assert.equal(upgradeText("  #derive dependency from a, b to p;\n"),
    "  #derivation connection { end #derive ::> a; end #original ::> p; }\n  #derivation connection { end #derive ::> b; end #original ::> p; }\n");
  assert.equal(upgradeText("#derive   dependency\n    from a\n    to p ;"), "#derivation connection { end #derive ::> a; end #original ::> p; }", "跨行也認得");
});

test("細化與驗證方法", () => {
  assert.equal(upgradeText("#refine dependency from '量度' to '目的';"), "#refinement dependency from '量度' to '目的';");
  for (const [old, kind] of [["byTest", "test"], ["byAnalysis", "analyze"], ["byInspection", "inspect"], ["byDemonstration", "demo"]]) {
    assert.equal(upgradeText(`verification v { @VVMethod { kind = Method::${old}; } }`), `verification v { @VerificationMethod { kind = VerificationMethodKind::${kind}; } }`);
    assert.equal(methodKind(old), kind);
    assert.equal(methodKind(kind), kind);
  }
  assert.equal(methodKind("byMagic"), null);
});

test("不該動的不動：註解、說明、字串、其他標記、認不得的形狀", () => {
  const keep = [
    "// #derive dependency from a to b;",
    "doc /* 以前寫成 #derive dependency from a to b; 與 @VVMethod { kind = Method::byTest; } */",
    'attribute note = "#refine dependency from a to b;";',
    "requirement '#derive dependency from a to b;' : Need;",
    "#trace dependency from a to b;",
    "#tpm attribute m : Real;",
    "#derivation connection { end #derive ::> a; end #original ::> b; }",
    "#refinement dependency from a to b;",
    "#derive dependency d1 from a to b;", // 有名字的相依不猜
    "#derive dependency from a to b { doc /* 帶主體 */ }",
  ];
  for (const line of keep) assert.equal(upgradeText(line), line, line);
});

test("轉換過的內容再轉一次不會變", () => {
  const mixed = "package P {\n  #derive dependency from a to b;\n  /* 註解 */ #refine dependency from c to d;\n  verification v { @VVMethod { kind = Method::byAnalysis; } }\n}\n";
  const once = upgradeText(mixed);
  assert.notEqual(once, mixed);
  assert.equal(upgradeText(once), once);
  assert.ok(!/#derive\s+dependency|#refine\s+dependency|@VVMethod/.test(once));
});
