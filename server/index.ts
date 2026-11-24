import express from "express";
import type { NextFunction, Request, Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { shutdown } from "./engine.ts";
import * as store from "./projects.ts";
import * as auth from "./auth.ts";
import * as versions from "./versions.ts";
import { wrap } from "./routes/common.ts";
import { mount as admin } from "./routes/admin.ts";
import { mount as projects } from "./routes/projects.ts";
import { mount as elements } from "./routes/elements.ts";
import { mount as diagrams } from "./routes/diagrams.ts";
import { mount as gates } from "./routes/gates.ts";
import { mount as pm } from "./routes/pm.ts";
import { mount as sim } from "./routes/sim.ts";
import { mount as versionRoutes } from "./routes/versions.ts";
import { mount as xlsx } from "./routes/export.ts";
import { mount as tables } from "./routes/tables.ts";
import { mount as board } from "./routes/board.ts";
import { mount as design } from "./routes/design.ts";

// 這個檔只負責共用的中介層、靜態檔與啟動；各功能的 API 在 server/routes/*.ts
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.disable("x-powered-by");
app.use(auth.hostGuard);
app.use(express.json({ limit: "5mb" }));

// 壓縮 API 的回應（JSON 與報告的 HTML）。靜態檔另外處理，壓一次就記住。
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""))) return next();
  const send = res.send.bind(res);
  res.send = ((body?: unknown) => {
    const type = String(res.getHeader("Content-Type") ?? "");
    if ((typeof body === "string" || Buffer.isBuffer(body)) && !res.getHeader("Content-Encoding") && /json|text\/|javascript|xml/.test(type)) {
      const buf = Buffer.from(body as string);
      if (buf.length > 1024) {
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Vary", "Accept-Encoding");
        res.removeHeader("Content-Length");
        return send(gzipSync(buf));
      }
    }
    return send(body);
  }) as typeof res.send;
  next();
});

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  // 只載入自己的程式與 Google Fonts 的字型；報告頁另有更嚴格的設定
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  next();
});
auth.mountAuthRoutes(app);
app.use("/api", auth.authenticate);
app.use("/api/projects/:id", auth.projectGuard);

// 分支（F-33）：參照是「代號@分支」，第一次開啟時建立它的工作目錄。載入整個專案時，main 和分支都順便跟上 GitHub 上的新提交。
app.use("/api/projects/:id", (req, _res, next) => {
  versions.openBranch(String(req.params.id), req.method === "GET" && req.path === "/").then(() => next(), next);
});

// 同一個專案（或同一個分支）的修改一次只做一個，見 store.lock。
app.use("/api/projects/:id", (req, res, next) => {
  // 只讀的請求不用排；模擬要跑很久，也不排（它只在最後寫自己的結果檔）
  if (req.method === "GET" || req.method === "HEAD" || /\/(validate|sim\/run|sim\/thrust)$/.test(req.path)) return next();
  let release: (() => void) | null = null, over = false;
  const done = () => { clearTimeout(timer); over = true; release?.(); };
  const timer = setTimeout(done, 120_000); // 保險：回應卡住也不會永遠擋住後面的人
  res.once("finish", done);
  res.once("close", done);
  void store.lock(String(req.params.id)).then((r) => { release = r; if (over) r(); next(); });
});

app.get("/api/me", wrap(async (req, res) => {
  const c = await auth.getConfig();
  res.json({ user: req.user ? auth.describe(req.user) : null, googleLogin: !!(c.google.clientId && c.google.clientSecret && c.publicUrl), githubLogin: !!(c.github.clientId && c.github.clientSecret && c.publicUrl), public: req.isPublic === true });
}));

// 各功能的路由，依原本的順序掛上
for (const m of [admin, projects, elements, diagrams, gates, pm, sim, versionRoutes, xlsx, tables, board, design]) m(app);

const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  // 打包出來的檔名帶有內容雜湊，可以永久快取；壓縮一次後留在記憶體
  const packed = new Map<string, Buffer>();
  app.get("/assets/:name", (req, res, next) => {
    const name = String(req.params.name);
    const file = path.join(dist, "assets", name);
    if (!/^[\w.-]+\.(js|css)$/.test(name) || !fs.existsSync(file)) return next();
    const accept = String(req.headers["accept-encoding"] ?? "");
    const enc = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : "";
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Vary", "Accept-Encoding");
    res.type(path.extname(name));
    if (!enc) return res.end(fs.readFileSync(file));
    let body = packed.get(`${enc}:${name}`);
    if (!body) {
      const raw = fs.readFileSync(file);
      body = enc === "br" ? brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 9, [zc.BROTLI_PARAM_SIZE_HINT]: raw.length } }) : gzipSync(raw);
      packed.set(`${enc}:${name}`, body);
    }
    res.setHeader("Content-Encoding", enc);
    res.end(body);
  });
  // 首頁每次都要重新確認，才拿得到新版的檔名
  const noCache = (res: Response) => res.setHeader("Cache-Control", "no-cache");
  app.use(express.static(dist, { setHeaders: (res, file) => { if (file.endsWith(".html")) noCache(res as Response); } }));
  app.get(/^(?!\/api\/).*/, (_req, res) => { noCache(res); res.sendFile(path.join(dist, "index.html")); });
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof store.UserError) return res.status(400).json({ error: err.message });
  if (err instanceof auth.AuthError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "伺服器發生錯誤，請查看伺服器紀錄。" });
});

// 內部埠給本機與 Tailscale 私人網路；公開埠給 Funnel，必須登入。兩者都只綁在本機。
const servers = [
  app.listen(auth.INTERNAL_PORT, "127.0.0.1", () => console.log(`JRI MBSE 內部埠：http://127.0.0.1:${auth.INTERNAL_PORT}`)),
  app.listen(auth.PUBLIC_PORT, "127.0.0.1", () => console.log(`JRI MBSE 公開埠（需登入）：http://127.0.0.1:${auth.PUBLIC_PORT}`)),
];
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { for (const sv of servers) sv.close(); shutdown().finally(() => process.exit(0)); });
}
