import type { Express } from "express";
import * as store from "../projects.ts";
import * as auth from "../auth.ts";
import { wrap, me, admin } from "./common.ts";

/** 管理：成員、唯讀連結、登入設定、共用元件庫 */
export function mount(app: Express): void {
  app.get("/api/admin/members", admin, wrap(async (_req, res) => res.json({ members: await auth.listMembers(), ranks: auth.RANKS.map((r) => ({ id: r, zh: auth.RANK_ZH[r] })) })));
  app.post("/api/admin/members", admin, wrap(async (req, res) => res.json({ members: await auth.saveMember(req.body ?? {}) })));
  // 批次加入成員（F-20a）：dryRun 只回傳每一行的結果，不寫入
  app.post("/api/admin/members/batch", admin, wrap(async (req, res) => res.json(await auth.importMembers(String(req.body?.text ?? ""), String(req.body?.rank ?? ""), req.body?.dryRun === false))));
  app.post("/api/admin/members/delete", admin, wrap(async (req, res) => res.json({ members: await auth.removeMember(String(req.body?.email || req.body?.login || "")) })));
  app.get("/api/admin/requests", admin, wrap(async (_req, res) => res.json({ requests: await auth.listRequests() })));
  app.post("/api/admin/requests/delete", admin, wrap(async (req, res) => res.json({ requests: await auth.dropRequest(String(req.body?.email ?? "")) })));
  app.get("/api/admin/shares", admin, wrap(async (_req, res) => res.json({ shares: await auth.listShares() })));
  app.post("/api/admin/shares", admin, wrap(async (req, res) => {
    if (String(req.body?.project ?? "").includes("@")) throw new store.UserError("唯讀連結以專案為單位，不能只給某個分支。");
    await store.readProject(String(req.body?.project ?? ""));
    const c = await auth.getConfig();
    const r = await auth.createShare(String(req.body.project), String(req.body.label ?? ""), Number(req.body.days), me(req).name);
    res.json({ ...r, path: `/s/${r.token}`, publicUrl: c.publicUrl });
  }));
  app.post("/api/admin/shares/delete", admin, wrap(async (req, res) => { await auth.revokeShare(String(req.body?.id ?? "")); res.json({ shares: await auth.listShares() }); }));
  app.get("/api/admin/config", admin, wrap(async (_req, res) => {
    const c = await auth.getConfig();
    res.json({ publicUrl: c.publicUrl, clientId: c.github.clientId, hasSecret: !!c.github.clientSecret, google: { clientId: c.google.clientId, hasSecret: !!c.google.clientSecret }, tailscaleAdmins: c.tailscaleAdmins, autoRepo: c.autoRepo });
  }));
  app.post("/api/admin/config", admin, wrap(async (req, res) => { await auth.updateConfig(req.body ?? {}); res.json({ saved: true }); }));

  // 共用元件庫（跨專案，以航電為主）
  app.get("/api/shared", wrap(async (_req, res) => {
    const files = await store.listShared();
    res.json({ files: await Promise.all(files.map(async (f) => ({ file: f, content: await store.readShared(f) }))) });
  }));
  app.put("/api/shared/:file", admin, wrap(async (req, res) => {
    const r = await store.saveShared(String(req.params.file), String(req.body?.content ?? ""));
    res.status(r.saved ? 200 : 422).json({ saved: r.saved, diagnostics: r.analysis.diagnostics });
  }));
}
