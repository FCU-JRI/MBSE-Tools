import type { Express } from "express";
import * as reviews from "../reviews.ts";
import { wrap, author, me, admin } from "./common.ts";

/** 送審：送審、撤回、留言（核准／退回／意見）、核准者設定與目前使用者能不能核准。唯讀身分的寫入由 projectGuard 擋下。 */
export function mount(app: Express): void {
  // 送審紀錄是整個專案的事：網頁在分支畫面時 id 帶 @分支，這裡一律取專案代號
  const base = (req: { params: { id?: unknown } }) => String(req.params.id).split("@")[0];
  const branchOf = (req: { query: Record<string, unknown>; body?: { branch?: unknown } }) => String(req.body?.branch ?? req.query.branch ?? "");
  app.get("/api/projects/:id/reviews", wrap(async (req, res) => res.json(await reviews.listReviews(base(req)))));
  app.get("/api/projects/:id/reviews/one", wrap(async (req, res) => {
    const b = branchOf(req);
    const r = await reviews.reviewOf(base(req), b);
    const can = await reviews.approverCheck(base(req), b, me(req), author(req)).catch(() => ({ ok: false, reason: "", basis: "", subsystems: [] as string[] }));
    res.json({ review: r, canApprove: can.ok, approveNote: can.ok ? can.basis : can.reason, subsystems: can.subsystems });
  }));
  app.post("/api/projects/:id/reviews/submit", wrap(async (req, res) => res.json(await reviews.submit(base(req), branchOf(req), me(req), author(req), String(req.body?.note ?? "")))));
  app.post("/api/projects/:id/reviews/withdraw", wrap(async (req, res) => res.json(await reviews.withdraw(base(req), branchOf(req), me(req), author(req)))));
  app.post("/api/projects/:id/reviews/comment", wrap(async (req, res) => res.json(await reviews.comment(base(req), branchOf(req), me(req), author(req), String(req.body?.kind ?? ""), String(req.body?.text ?? "")))));
  // 核准者設定：{ 次系統名稱: [登入帳號或姓名, ...] }；總工程師以上或管理員才能改
  app.get("/api/projects/:id/reviews/approvers", wrap(async (req, res) => res.json(await reviews.readApprovers(base(req)))));
  app.post("/api/projects/:id/reviews/approvers", admin, wrap(async (req, res) => res.json(await reviews.saveApprovers(base(req), req.body, author(req)))));
}
