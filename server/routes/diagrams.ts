import type { Express } from "express";
import * as store from "../projects.ts";
import { wrap, pid } from "./common.ts";

/** 圖的版面與自訂圖 */
export function mount(app: Express): void {
  // 圖的版面（節點位置）。不影響模型，隨下一次儲存一併提交。
  app.get("/api/projects/:id/layout", wrap(async (req, res) => res.json(await store.readLayout(pid(req)))));
  app.put("/api/projects/:id/layout", wrap(async (req, res) => {
    await store.writeLayout(pid(req), req.body?.layout ?? {});
    res.json({ saved: true });
  }));
  // 只存一張圖的位置：不同的人各自排不同的圖時，不會互相蓋掉
  app.patch("/api/projects/:id/layout", wrap(async (req, res) => {
    const diagram = String(req.body?.diagram ?? "");
    if (!diagram || diagram.length > 400) throw new store.UserError("沒有指定是哪一張圖。");
    const all = await store.readLayout(pid(req));
    if (req.body?.nodes && typeof req.body.nodes === "object") all[diagram] = req.body.nodes; else delete all[diagram];
    await store.writeLayout(pid(req), all);
    res.json({ saved: true });
  }));
  app.get("/api/projects/:id/diagrams", wrap(async (req, res) => res.json(await store.readDiagrams(pid(req)))));
  app.put("/api/projects/:id/diagrams", wrap(async (req, res) => res.json(await store.writeDiagrams(pid(req), req.body?.diagrams))));
}
