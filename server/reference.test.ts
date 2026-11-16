// 參考模型（F-73）：放在 reference/ 的檔案沒有被動過；用它驗收「任何標準模型都看得到全部元素」。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, shutdown } from "./engine.ts";
import { verify } from "./reference.ts";
import type { Manifest } from "./reference.ts";

const DIR = fileURLToPath(new URL("../reference/apollo-11-sysml-v2", import.meta.url));
const manifest = JSON.parse(await fs.readFile(`${DIR}.manifest.json`, "utf8")) as Manifest;
const at = (dir: string) => (rel: string) => path.join(dir, ...rel.split("/"));
const models = Object.keys(manifest.files).filter((f) => f.endsWith(".sysml")).sort();
after(() => shutdown());

test("參考模型的檔案和清單逐一相同，沒有多也沒有少；授權檔與版權聲明都在", async () => {
  assert.deepEqual(await verify(manifest, at(DIR), DIR), []);
  assert.equal(models.length, 28);
  assert.equal(manifest.commit, "0e8a7d6790cfa7e15b991eb745e9a38f9bed0474");
  assert.match(await fs.readFile(path.join(DIR, "LICENSE.md"), "utf8"), /Mozilla Public License Version 2\.0/);
  for (const f of models) assert.match(await fs.readFile(at(DIR)(f), "utf8"), /Copyright \(c\) 2026 AIRBUS[\s\S]{0,200}Mozilla Public/, `${f} 開頭的版權聲明`);
});

test("清單核對：內容被改、檔案不見、多出檔案都查得出來", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "jri-ref-"));
  try {
    await fs.cp(DIR, tmp, { recursive: true });
    assert.deepEqual(await verify(manifest, at(tmp), tmp), []);
    await fs.appendFile(at(tmp)("CoSMA/CoSMAPackage.sysml"), "\n");
    await fs.rm(at(tmp)("Apollo11Model.sysml"));
    await fs.writeFile(path.join(tmp, "Purpose", "extra.sysml"), "package Extra { }\n", "utf8");
    assert.deepEqual((await verify(manifest, at(tmp), tmp)).sort(), ["內容不同 CoSMA/CoSMAPackage.sysml", "清單上沒有 Purpose/extra.sysml", "缺少 Apollo11Model.sysml"].sort());
  } finally { await fs.rm(tmp, { recursive: true, force: true }); }
});

test("驗收：Apollo 11 模型 28 個檔案解析沒有錯誤，2,188 個具名元素與 330 個沒有名字的使用都列得出來，樹接得起來", async () => {
  const a = await analyze(await Promise.all(models.map(async (f) => [f, await fs.readFile(at(DIR)(f), "utf8")] as const)));
  assert.equal(a.ok, true);
  assert.equal(a.diagnostics.filter((d) => d.severity === "error").length, 0);
  assert.equal(a.elements.length, 2188);
  assert.equal(a.unnamed.length, 330);
  assert.equal(new Set(a.elements.map((e) => e.file)).size, 28, "每個檔案都有元素");
  const count = (kind: string) => a.elements.filter((e) => e.kind === kind).length;
  assert.deepEqual(["RequirementDefinition", "RequirementUsage", "PartDefinition", "ActionDefinition", "StateDefinition", "PortDefinition", "InterfaceDefinition", "Package", "LibraryPackage"].map(count), [296, 294, 194, 110, 16, 8, 8, 25, 3]);

  // 樹：28 個最上層套件；每個元素恰好一個上層，往上都走得到最上層；沒有重複的識別碼
  const all = [...a.elements, ...a.unnamed];
  const byId = new Map(all.map((e) => [e.id, e]));
  assert.equal(byId.size, all.length, "識別碼不重複");
  const roots = all.filter((e) => e.parent === null);
  assert.equal(roots.length, 28);
  assert.equal(roots.every((e) => e.kind.endsWith("Package")), true);
  for (const e of all) {
    let cur = e, steps = 0;
    while (cur.parent) { const up = byId.get(cur.parent); assert.ok(up, `${e.qualifiedName} 的上層不在清單裡`); cur = up; assert.ok(++steps < 50, "上層不能繞圈"); }
  }
  // 每個元素都有關鍵字；通用關係抽得出來
  assert.equal(all.every((e) => !!e.keyword), true);
  const links = (kind: string) => a.links.filter((l) => l.kind === kind).length;
  assert.deepEqual(["specialize", "perform"].map(links), [354, 104]);
  assert.equal(a.links.filter((l) => l.kind === "specialize" && l.to).length, 348, "兩端都在專案內的特化");
});
