import type { Express } from "express";
import * as board from "../board.ts";
import type { Op } from "../board.ts";
import { wrap, author, pid } from "./common.ts";

/** 討論白板：讀取整塊、送出一批修改（逐項合併）。唯讀身分的寫入由 auth.projectGuard 擋下。 */
export function mount(app: Express): void {
  app.get("/api/projects/:id/board", wrap(async (req, res) => res.json(await board.readBoard(pid(req)))));
  app.post("/api/projects/:id/board", wrap(async (req, res) => res.json(await board.saveBoard(pid(req), req.body?.ops as Op[], author(req)))));
}
