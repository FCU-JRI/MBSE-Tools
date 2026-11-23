import type { Express } from "express";
import * as store from "../projects.ts";
import * as auth from "../auth.ts";
import * as versions from "../versions.ts";
import { wrap, author, pid, view, admin } from "./common.ts";

/** 版本：GitHub 同步、分支審查、基線比較 */
export function mount(app: Express): void {
  // ───────── 版本：GitHub 同步、分支審查、基線比較 ─────────
  app.get("/api/projects/:id/sync", wrap(async (req, res) => res.json(await store.syncState(pid(req)))));
  app.post("/api/projects/:id/remote", admin, wrap(async (req, res) => res.json(await store.setRemote(pid(req), String(req.body?.url ?? "")))));
  app.post("/api/projects/:id/remote/create", admin, wrap(async (req, res) => {
    const { autoRepo } = await auth.getConfig();
    if (!autoRepo.owner) throw new store.UserError("請先到「管理」頁填 GitHub 擁有者。");
    const p = await store.readProject(pid(req));
    res.json(await store.createRepo(p.id, p.name, autoRepo));
  }));
  app.get("/api/projects/:id/branches", wrap(async (req, res) => res.json(await versions.listBranches(pid(req)))));
  app.get("/api/projects/:id/branches/diff", wrap(async (req, res) => res.json(await versions.branchDiff(pid(req), String(req.query.name ?? "")))));
  app.post("/api/projects/:id/branches/merge", auth.need(auth.can.merge, "合併分支需要責任工程師以上的權限。"), wrap(async (req, res) => {
    const r = await versions.mergeBranch(pid(req), String(req.body?.name ?? ""), author(req));
    res.json({ ...r, ...(await view(pid(req))) });
  }));
  // 把 main 的更新合併進目前開啟的分支
  app.post("/api/projects/:id/branches/update", wrap(async (req, res) => {
    await versions.mergeMain(pid(req), author(req));
    res.json(await view(pid(req)));
  }));
  app.get("/api/projects/:id/baselines", wrap(async (req, res) => res.json(await versions.listBaselines(pid(req)))));
  app.get("/api/projects/:id/compare", wrap(async (req, res) => res.json(await versions.compare(pid(req), String(req.query.from ?? ""), String(req.query.to ?? "")))));

  app.get("/api/projects/:id/history", wrap(async (req, res) => res.json(await store.history(pid(req)))));
}
