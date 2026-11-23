import type { Express, Request } from "express";
import * as store from "../projects.ts";
import * as auth from "../auth.ts";
import * as pm from "../pm.ts";
import { wrap, me, author, pid, view } from "./common.ts";

/** 專案管理：時程、成本、人員、里程碑 */
export function mount(app: Express): void {
  // ───────── 專案管理：時程、成本、人員 ─────────
  const pmKind = (req: Request): pm.Kind => {
    const k = String(req.params.kind);
    if (k !== "tasks" && k !== "costs" && k !== "people" && k !== "docs") throw new store.UserError("未知的資料類型。");
    return k;
  };
  app.get("/api/projects/:id/pm", wrap(async (req, res) => res.json({ ...(await pm.readPm(pid(req))), priorities: pm.PRIORITIES.map((p) => ({ id: p, zh: pm.PRIORITY_ZH[p], level: pm.PRIORITY_LEVEL[p] })), myLevel: auth.levelOf(me(req)) })));
  app.post("/api/projects/:id/milestones", auth.need(auth.can.confirm, "設定里程碑日期需要責任工程師以上的權限。"), wrap(async (req, res) => {
    await pm.setMilestone(pid(req), String(req.body?.gate ?? ""), String(req.body?.date ?? ""), author(req));
    res.json(await view(pid(req)));
  }));
  app.post("/api/projects/:id/pm/:kind", wrap(async (req, res) => res.json(await pm.upsert(pid(req), pmKind(req), req.body ?? {}, auth.levelOf(me(req)), author(req)))));
  app.post("/api/projects/:id/pm/:kind/delete", wrap(async (req, res) => res.json(await pm.remove(pid(req), pmKind(req), String(req.body?.id ?? ""), author(req)))));
}
