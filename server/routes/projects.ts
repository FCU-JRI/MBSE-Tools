import type { Express } from "express";
import { GATES } from "../gates.ts";
import { CATEGORIES, PILLARS, RELATION_LABELS } from "../metamodel.ts";
import * as store from "../projects.ts";
import * as auth from "../auth.ts";
import { wrap, me, author, pid, view, admin } from "./common.ts";

/** 專案：列表、建立、封存、載入、原始碼檔案 */
export function mount(app: Express): void {
  app.get("/api/meta", (_req, res) => {
    res.json({
      categories: CATEGORIES,
      pillars: PILLARS,
      relations: RELATION_LABELS,
      gates: GATES.map((g) => ({ id: g.id, zh: g.zh, en: g.en, deadline: g.deadline, approver: g.approver, purpose: g.purpose, perSubsystem: g.perSubsystem })),
    });
  });

  app.get("/api/projects", wrap(async (req, res) => {
    const all = await store.listProjects();
    const only = me(req).project;
    res.json(only ? all.filter((p) => p.id === only) : all);
  }));

  app.post("/api/projects", auth.need(auth.can.createProject, "建立專案需要總工程師以上的權限。"), wrap(async (req, res) => {
    const { id, name, kind, gates, template } = req.body ?? {};
    const project = await store.createProject({ id: String(id ?? ""), name: String(name ?? ""), kind: kind === "small" ? "small" : "annual", gates, template: String(template ?? "sample"), author: author(req) });
    // 自動建立 GitHub 儲存庫：失敗不影響專案建立，錯誤顯示在版本畫面
    const { autoRepo } = await auth.getConfig();
    if (autoRepo.enabled) await store.createRepo(project.id, project.name, autoRepo);
    res.json(project);
  }));

  // 封存專案（管理員）。資料移到 archive 資料夾，可手動移回來還原。
  app.post("/api/projects/:id/archive", admin, wrap(async (req, res) => {
    await store.archiveProject(pid(req), String(req.body?.confirm ?? ""));
    res.json({ archived: true });
  }));

  app.get("/api/projects/:id", wrap(async (req, res) => res.json(await view(pid(req)))));

  // 專案設定：名稱、類型、節點。代號（儲存庫名稱）不能改。
  app.patch("/api/projects/:id", auth.need(auth.can.confirm, "修改專案設定需要責任工程師以上的權限。"), wrap(async (req, res) => {
    const b = req.body ?? {};
    await store.updateProject(pid(req), { name: b.name, kind: b.kind, gates: b.gates, author: author(req) });
    res.json(await view(pid(req)));
  }));

  app.get("/api/projects/:id/files", wrap(async (req, res) => res.json(await store.listFiles(pid(req)))));

  app.get("/api/projects/:id/files/:file", wrap(async (req, res) => {
    res.json({ content: await store.readFile(pid(req), String(req.params.file)) });
  }));

  // 只檢查、不儲存：原始碼編輯器即時顯示錯誤用
  app.post("/api/projects/:id/validate", wrap(async (req, res) => {
    const a = await store.analyzeProject(pid(req), { file: String(req.body.file), content: String(req.body.content ?? "") });
    res.json({ ok: a.ok, diagnostics: a.diagnostics });
  }));

  app.put("/api/projects/:id/files/:file", wrap(async (req, res) => {
    const r = await store.saveFile(pid(req), String(req.params.file), String(req.body.content ?? ""), author(req), String(req.body.message ?? ""));
    res.status(r.saved ? 200 : 422).json({ saved: r.saved, commit: r.commit, diagnostics: r.analysis.diagnostics });
  }));
}
