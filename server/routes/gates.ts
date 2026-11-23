import type { Express } from "express";
import { GATES } from "../gates.ts";
import * as store from "../projects.ts";
import * as auth from "../auth.ts";
import * as pm from "../pm.ts";
import * as sim from "../sim.ts";
import { buildReport, renderDocx, renderHtml } from "../report.ts";
import { wrap, me, author, pid, view } from "./common.ts";

/** 審查節點：人工確認、簽核、審查報告 */
export function mount(app: Express): void {
  app.post("/api/projects/:id/manual", auth.need(auth.can.confirm, "人工確認需要責任工程師以上的權限。"), wrap(async (req, res) => {
    await store.setManual(pid(req), String(req.body.key), req.body.done === true, author(req));
    res.json(await view(pid(req)));
  }));

  // 簽核：簽核人與職級取自登入身分，權限依 AEAS Table 3
  app.post("/api/projects/:id/signoffs", wrap(async (req, res) => {
    const b = req.body ?? {};
    const u = me(req);
    const project = await store.readProject(pid(req));
    const gate = String(b.gate);
    const subsystem = b.subsystem ? String(b.subsystem) : null;
    if (!auth.can.signoff(u, gate, project.highPower !== false, subsystem)) {
      const def = GATES.find((g) => g.id === gate);
      throw new store.UserError(`你的職級不能簽核這個節點。核可者：${def?.approver ?? "指定職級"}。`);
    }
    await store.signoff(pid(req), {
      gate, subsystem, decision: b.decision === "APPROVE" ? "APPROVE" : "DENY",
      by: u.name, role: u.rank ? `${auth.RANK_ZH[u.rank]} [${u.rank}]` : "", comment: String(b.comment ?? ""),
    });
    res.json(await view(pid(req)));
  }));

  // 審查報告：?gate=節點代號&format=html|docx。html 可用瀏覽器列印成 PDF。
  app.get("/api/projects/:id/report", wrap(async (req, res) => {
    const id = pid(req);
    const v = await view(id);
    if (!v.analysis.ok) throw new store.UserError("模型目前有錯誤，修正後才能產生報告。");
    const gate = String(req.query.gate ?? v.gates[0]?.id ?? "");
    const head = (await store.history(id))[0]?.commit ?? "";
    const report = buildReport(v.project, v.analysis, v.gates, await pm.readPm(id), await sim.readSim(id), gate, head);
    if (req.query.format === "docx") {
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${id}-${gate}-report.docx"`);
      return res.send(await renderDocx(report));
    }
    // 報告頁只有自己產生的內容與一個列印按鈕，不載入任何外部資源
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:");
    res.type("html").send(renderHtml(report));
  }));
}
