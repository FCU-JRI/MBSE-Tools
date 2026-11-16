// METHOD.md 實作的共用介面：各期的路由從這裡拿到 index.ts 的工具函式，不必改 index.ts（docs/IMPL-PLAN.md）。
import type { Express, NextFunction, Request, Response } from "express";
import type * as Store from "../projects.ts";

export interface MethodContext {
  /** 包住 async 路由，錯誤交給統一的錯誤處理 */
  wrap: (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => void;
  /** 網址上的專案參照 */
  pid: (req: Request) => string;
  /** 修改紀錄的作者 */
  author: (req: Request) => string;
  /** 專案的完整畫面資料（和 GET /api/projects/:id 相同） */
  view: (id: string) => Promise<unknown>;
  store: typeof Store;
}

export type Mount = (app: Express, ctx: MethodContext) => void;
