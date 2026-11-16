// 參考專案（F-73）：放在 reference/ 的第三方模型，原封不動建成唯讀的專案。
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commit, dirOf, git, isModelPath, repoConfig, UserError } from "./projects.ts";
import type { Project } from "./projects.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REFERENCE_DIR = path.join(ROOT, "reference");

export interface Manifest { name: string; source: string; commit: string; license: string; files: Record<string, string> }
/** id：建出來的專案代號；folder：reference/ 底下的資料夾，清單檔是「資料夾名.manifest.json」。 */
const REFERENCES = [{ id: "apollo-11", zh: "Apollo 11（CoSMA 參考模型）", folder: "apollo-11-sysml-v2" }];

const sha256 = async (file: string) => createHash("sha256").update(await fs.readFile(file)).digest("hex");
const readManifest = async (folder: string) => JSON.parse(await fs.readFile(path.join(REFERENCE_DIR, `${folder}.manifest.json`), "utf8")) as Manifest;
/** 模型檔放進專案的 model/，其餘（授權檔等）放在專案根目錄。 */
const placeOf = (rel: string) => (rel.endsWith(".sysml") ? path.join("model", ...rel.split("/")) : rel);

/**
 * 逐一核對清單上的檔案。at：清單上的路徑 → 實際的檔案位置。回傳不符的項目；空的表示完全相同。
 * extra：資料夾裡不在清單上的檔案（給放在儲存庫裡的那一份用，避免有人多放了東西）。
 */
export async function verify(manifest: Manifest, at: (rel: string) => string, extra?: string): Promise<string[]> {
  const problems: string[] = [];
  for (const [rel, want] of Object.entries(manifest.files)) {
    const got = await sha256(at(rel)).catch(() => null);
    if (got === null) problems.push(`缺少 ${rel}`);
    else if (got !== want) problems.push(`內容不同 ${rel}`);
  }
  if (extra) {
    const walk = async (dir: string, prefix: string): Promise<void> => {
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        const rel = prefix + d.name;
        if (d.isDirectory()) await walk(path.join(dir, d.name), `${rel}/`);
        else if (!(rel in manifest.files)) problems.push(`清單上沒有 ${rel}`);
      }
    };
    await walk(extra, "");
  }
  return problems;
}

export interface ReferenceInfo { id: string; zh: string; name: string; source: string; commit: string; license: string; files: number; installed: boolean; problems: string[] }

export async function listReferences(): Promise<ReferenceInfo[]> {
  const out: ReferenceInfo[] = [];
  for (const r of REFERENCES) {
    const m = await readManifest(r.folder);
    const dir = dirOf(r.id);
    const installed = !!(await fs.stat(path.join(dir, "project.json")).catch(() => null));
    // 已經建立的，核對專案裡的檔案有沒有被動過；還沒建立的，核對儲存庫裡的那一份
    const problems = installed ? await verify(m, (rel) => path.join(dir, placeOf(rel))) : await verify(m, (rel) => path.join(REFERENCE_DIR, r.folder, ...rel.split("/")), path.join(REFERENCE_DIR, r.folder));
    out.push({ id: r.id, zh: r.zh, name: m.name, source: m.source, commit: m.commit, license: m.license, files: Object.keys(m.files).length, installed, problems });
  }
  return out;
}

/** 把參考模型建成唯讀、原封不動的專案。檔案和清單不符就不建立。 */
export async function installReference(id: string, author: string): Promise<Project> {
  const r = REFERENCES.find((x) => x.id === id);
  if (!r) throw new UserError("沒有這個參考專案。");
  const m = await readManifest(r.folder);
  const src = (rel: string) => path.join(REFERENCE_DIR, r.folder, ...rel.split("/"));
  const problems = await verify(m, src, path.join(REFERENCE_DIR, r.folder));
  if (problems.length) throw new UserError(`參考模型的檔案和清單不符，沒有建立：${problems.slice(0, 5).join("、")}`);
  const bad = Object.keys(m.files).find((rel) => (rel.endsWith(".sysml") ? !isModelPath(rel) : rel.includes("/") || rel.includes("\\") || rel === "project.json"));
  if (bad) throw new UserError(`參考模型的檔名不合法：${bad}`);
  const dir = dirOf(r.id);
  if (await fs.stat(dir).catch(() => null)) throw new UserError("這個參考專案已經建立。");
  await fs.mkdir(path.join(dir, "model"), { recursive: true });
  for (const rel of Object.keys(m.files)) {
    const target = path.join(dir, placeOf(rel));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(src(rel), target);
  }
  await fs.copyFile(path.join(REFERENCE_DIR, `${r.folder}.md`), path.join(dir, "SOURCE.md")).catch(() => {});
  const project: Project = {
    id: r.id, name: r.zh, kind: "small", createdAt: new Date().toISOString(), gates: [], manual: {}, signoffs: [],
    readOnly: true, pristine: true, reference: { name: m.name, source: m.source, commit: m.commit, license: m.license },
  };
  await fs.writeFile(path.join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n", "utf8");
  await git(dir, "init", "-b", "main");
  await repoConfig(dir);
  // 參考模型逐位元組保留：不讓 git 依使用者的全域設定轉換換行字元
  await fs.writeFile(path.join(dir, ".gitattributes"), "* -text\n", "utf8");
  await commit(dir, author, `建立參考專案：${m.name}（${m.commit.slice(0, 7)}，${m.license}）`);
  return project;
}
