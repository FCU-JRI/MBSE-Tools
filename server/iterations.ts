// 工作包 E：迴圈旁的「設計示意」改讀版本紀錄（VER-06）。
// 一次讀 git log -p（最近 100 次提交，只看 model/），用 part def 當 hunk 標頭，找出每次提交改到哪些零件定義、加了哪個 CAD 版本。
// 只做文字比對，不逐版解析模型，所以很快；判斷「改到哪個零件」靠 hunk 所在的 part def 與改動行裡出現的 short name／名稱。
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dirOf, git, readProject } from "./projects.ts";

export interface Iteration {
  commit: string; date: string; author: string; message: string;
  /** 這次提交改到的零件定義（名稱或 short name，呼叫端再對到元素） */
  touched: string[];
  /** 這次提交寫入的 CAD 連結與版本（@CadLink），依零件 */
  cad: { part: string; url: string; version: string }[];
}

const FUNC = "^[ \\t]*((variation[ \\t]+)?part[ \\t]+def[ \\t].*)$";
let attrsFile: string | null = null;
async function attributes(): Promise<string> {
  if (attrsFile) return attrsFile;
  const f = path.join(os.tmpdir(), `jri-sysml-attrs-${process.pid}`);
  await fs.writeFile(f, "*.sysml diff=sysml\n", "utf8");
  return (attrsFile = f);
}

/** part def 那一行的 short name 與名稱：part def <'af-wing'> '主翼' :> Component { → ["af-wing", "主翼"] */
export function defKeys(line: string): string[] {
  const m = line.match(/part\s+def\s+(?:<'((?:[^'\\]|\\.)*)'>\s*)?(?:'((?:[^'\\]|\\.)*)'|([A-Za-z_][\w]*))/);
  if (!m) return [];
  return [m[1], m[2] ?? m[3]].filter((x): x is string => !!x).map((x) => x.replace(/\\'/g, "'"));
}

/** 解析 git log -p 的輸出（--format=@@@%h%x09%aI%x09%an%x09%s）。 */
export function parseLog(text: string): Iteration[] {
  const out: Iteration[] = [];
  let cur: Iteration | null = null, scope: string[] = [];
  const touch = (keys: string[]) => { if (cur) for (const k of keys) if (!cur.touched.includes(k)) cur.touched.push(k); };
  for (const line of text.split("\n")) {
    if (line.startsWith("@@@")) {
      const [commit, date, author, ...msg] = line.slice(3).split("\t");
      cur = { commit, date, author, message: msg.join("\t"), touched: [], cad: [] };
      out.push(cur); scope = []; continue;
    }
    if (!cur) continue;
    if (line.startsWith("@@ ")) { scope = defKeys(line.replace(/^@@[^@]*@@/, "")); continue; }
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      const body = line.slice(1);
      const d = defKeys(body);
      if (d.length) { scope = d; touch(d); continue; }
      touch(scope);
      const cad = body.match(/cadUrl\s*=\s*"([^"]*)"[^}]*cadVersion\s*=\s*"([^"]*)"/);
      if (cad && line.startsWith("+") && scope.length) cur.cad.push({ part: scope[0], url: cad[1], version: cad[2] });
    }
  }
  return out;
}

/** 專案最近 100 次提交，每次改到哪些零件定義（舊到新）。 */
export async function iterations(ref: string): Promise<Iteration[]> {
  await readProject(ref);
  const dir = dirOf(ref);
  const text = await git(dir, "-c", `core.attributesFile=${await attributes()}`, "-c", `diff.sysml.xfuncname=${FUNC}`,
    "log", "-n", "100", "-p", "--no-color", "--format=@@@%h%x09%aI%x09%an%x09%s", "--", "model/").catch(() => "");
  return parseLog(text).filter((x) => x.touched.length).reverse();
}
