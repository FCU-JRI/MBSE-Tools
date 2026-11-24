import type { NextFunction, Request, Response } from "express";
import { ROOT_PACKAGE } from "../engine.ts";
import { evaluateGates } from "../gates.ts";
import { CATEGORIES } from "../metamodel.ts";
import * as store from "../projects.ts";
import type { Element } from "../extract.ts";
import * as auth from "../auth.ts";
import * as versions from "../versions.ts";
import * as pm from "../pm.ts";
import { evaluateProcess, frameworkView, withFrameworkChecks } from "../process.ts";
import type { User } from "../auth.ts";

// 各路由檔共用的小工具與專案畫面資料
export const MAIN_FILE = "model.sysml";
export type An = Awaited<ReturnType<typeof store.analyzeProject>>;
/** 根套件 Project 所在的檔案；新元素預設寫在這裡。 */
export const rootFile = (a: An) => a.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE)?.file || MAIN_FILE;
export const inFile = (a: An, file: string) => a.elements.filter((e) => e.file === file);
export function editable(el: Element): Element {
  if (el.shared) throw new store.UserError("這是共用元件庫的內容，不能在專案內修改。請管理員到「管理」頁修改。");
  return el;
}
/** 使用者自己建的套件：專案內、不是根套件、也不是工具依類別自動建立的那幾個。 */
export const CAT_PKGS = new Set(CATEGORIES.map((c) => c.pkg));
export const isUserPackage = (e: Element | undefined): e is Element =>
  !!e && e.kind === "Package" && !e.shared && e.qualifiedName !== ROOT_PACKAGE && !(e.qualifiedName.split("::").length === 2 && CAT_PKGS.has(e.name));

export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};
export const me = (req: Request) => req.user as User;
// 修改紀錄的作者取自登入身分；只有這台電腦本機操作時才採用自填的名字
export const author = (req: Request) => {
  const u = me(req);
  const typed = String(req.body?.author ?? "").trim().slice(0, 60);
  return u.kind === "local" && typed ? typed : u.name;
};
export const pid = (req: Request) => String(req.params.id);

/** id 可以是分支的參照（代號@分支）。回傳的 project.id 是參照本身，網頁接著用它呼叫 API，才會一直留在同一個分支。 */
export async function view(id: string) {
  const project = { ...(await store.readProject(id)), id };
  const analysis = await store.analyzeProject(id);
  const plan = await pm.readPm(id);
  const framework = await frameworkView(id, project, analysis, plan.docs.length);
  const gates = withFrameworkChecks(evaluateGates(analysis, project.gates, project.manual, plan.tasks.length), framework, analysis);
  return { project, analysis, gates, framework, docs: plan.docs, milestones: plan.milestones, process: analysis.ok ? evaluateProcess(analysis) : [], history: await store.historyState(id), branch: await versions.branchState(id), warning: versions.syncWarning(id) };
}

// ───────── 管理：成員、唯讀連結、登入設定 ─────────
export const admin = auth.need(auth.can.admin, "只有總工程師以上或管理員可以操作。");
