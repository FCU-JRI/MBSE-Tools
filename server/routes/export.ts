import type { Express } from "express";
import * as store from "../projects.ts";
import { exportWorkbook } from "../export.ts";
import * as pm from "../pm.ts";
import { wrap, pid, view } from "./common.ts";

/** 匯出 Excel */
export function mount(app: Express): void {
  app.get("/api/projects/:id/export.xlsx", wrap(async (req, res) => {
    const v = await view(pid(req));
    if (!v.analysis.ok) throw new store.UserError("模型目前有錯誤，修正後才能匯出。");
    const buf = await exportWorkbook(v.project, v.analysis, v.gates, await pm.readPm(pid(req)));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${v.project.id}-mbse.xlsx"`);
    res.send(buf);
  }));
}
