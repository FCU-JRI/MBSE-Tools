// P4：介面與 N² 矩陣（docs/IMPL-PLAN.md）。這一期的伺服器路由寫在這裡，路徑一律以 /api/projects/:id/ 開頭。
// 介面寫在模型裡（port def、interface def、assert constraint）；兩端負責人的同意紀錄在專案的 interfaces.json，和介面內容的雜湊綁在一起，內容一改就要重新同意。
import fs from "node:fs/promises";
import path from "node:path";
import type { Mount } from "./context.ts";
import type { Element } from "../extract.ts";
import type { Analysis } from "../engine.ts";
import { evaluate, ROOT_PACKAGE } from "../engine.ts";
import { insertInside, insertInto, nextShortName, replaceLoc } from "../edits.ts";
import * as P4 from "./p4-model.ts";
import type { Approval } from "./p4-model.ts";

const PKG = "Interfaces";
const MAIN_FILE = "model.sysml";
type Approvals = Record<string, { a?: Approval; b?: Approval }>;

export const mount: Mount = (app, ctx) => {
  const { wrap, pid, author, view, store } = ctx;
  const file = (id: string) => path.join(store.dirOf(id), "interfaces.json");
  const readApprovals = async (id: string): Promise<Approvals> => {
    try { return (JSON.parse(await fs.readFile(file(id), "utf8")) as { approvals?: Approvals }).approvals ?? {}; } catch { return {}; }
  };
  const textsOf = async (id: string) => {
    const src = new Map(await store.sources(id));
    return (e: Element) => (e.loc ? P4.sliceLoc(src.get(e.file) ?? "", e.loc) : "");
  };
  const build = async (id: string, a?: Analysis) => {
    a ??= await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
    const texts = await textsOf(id);
    const plan = P4.planEval(a, P4.portDefsOf(a), P4.interfaceDefsOf(a, texts));
    const results = await evaluate(await store.sources(id), plan.exprs);
    return { a, report: P4.report(a, texts, plan, results, await readApprovals(id)) };
  };
  const ready = async (id: string) => {
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
    return a;
  };
  const rootFile = (a: Analysis) => a.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE)?.file || MAIN_FILE;
  const own = (e: Element | undefined, what: string): Element => {
    if (!e) throw new store.UserError(`找不到這個${what}。`);
    if (e.shared) throw new store.UserError("這是共用元件庫的內容，不能在專案內修改。");
    return e;
  };
  /** 存檔並回傳整個專案畫面與介面報告 */
  const save = async (id: string, f: string, content: string, who: string, message: string, res: import("express").Response) => {
    const r = await store.saveFile(id, f, content, who, message);
    if (!r.saved) return res.status(422).json({ saved: false, diagnostics: r.analysis.diagnostics });
    res.json({ saved: true, ...((await view(id)) as object), interfaces: (await build(id)).report });
  };
  /** 主體裡只有這些東西時，才能整段重寫（其他內容要到原始碼改，免得被蓋掉） */
  const rewritable = (a: Analysis, el: Element, kinds: string[]) => {
    const extra = a.elements.filter((e) => e.owner === el.id && !kinds.includes(e.kind));
    if (extra.length) throw new store.UserError(`「${el.name}」裡還有表單以外的內容（${extra.slice(0, 3).map((e) => e.name).join("、")}），請到「原始碼」分頁修改。`);
    if (!el.loc) throw new store.UserError("找不到元素在檔案中的位置。");
  };

  app.get("/api/projects/:id/interfaces", wrap(async (req, res) => res.json((await build(pid(req))).report)));

  // 新增或修改連接埠定義（帶它要管的物理量）
  app.post("/api/projects/:id/interfaces/port-defs", wrap(async (req, res) => {
    const id = pid(req), a = await ready(id), b = req.body ?? {};
    if (b.id) {
      const el = own(a.elements.find((e) => e.id === b.id && e.kind === "PortDefinition"), "連接埠定義");
      rewritable(a, el, ["AttributeUsage", "ConjugatedPortDefinition"]);
      const indent = (await store.readFile(id, el.file)).split("\n")[(el.line ?? 1) - 1]?.match(/^\s*/)?.[0] ?? "";
      const text = P4.portDefText({ ...b, name: el.name }, el.shortName ?? nextShortName(a.elements, "IFP"), indent).trim();
      return save(id, el.file, replaceLoc(await store.readFile(id, el.file), el.loc!, text), author(req), `修改連接埠：${el.name}`, res);
    }
    const f = rootFile(a), content = await store.readFile(id, f);
    const next = insertInto(content, a.elements.filter((e) => e.file === f), ROOT_PACKAGE, PKG, (indent) => P4.portDefText(b, nextShortName(a.elements, "IFP"), indent));
    return save(id, f, next, author(req), `新增連接埠：${String(b.name ?? "").trim()}`, res);
  }));

  // 新增或修改介面定義：種類、兩端、限制、負責人、驗證欄位
  app.post("/api/projects/:id/interfaces/defs", wrap(async (req, res) => {
    const id = pid(req), a = await ready(id), b = req.body ?? {};
    const ports = P4.portDefsOf(a);
    if (b.id) {
      const el = own(a.elements.find((e) => e.id === b.id && e.kind === "InterfaceDefinition"), "介面定義");
      rewritable(a, el, ["PortUsage", "AssertConstraintUsage", "AttributeUsage"]);
      const indent = (await store.readFile(id, el.file)).split("\n")[(el.line ?? 1) - 1]?.match(/^\s*/)?.[0] ?? "";
      const text = P4.interfaceDefText({ ...b, name: el.name }, el.shortName ?? nextShortName(a.elements, "IF"), ports, indent).trim();
      return save(id, el.file, replaceLoc(await store.readFile(id, el.file), el.loc!, text), author(req), `修改介面：${el.name}`, res);
    }
    const f = rootFile(a), content = await store.readFile(id, f);
    const next = insertInto(content, a.elements.filter((e) => e.file === f), ROOT_PACKAGE, PKG, (indent) => P4.interfaceDefText(b, nextShortName(a.elements, "IF"), ports, indent));
    return save(id, f, next, author(req), `新增介面：${String(b.name ?? "").trim()}`, res);
  }));

  // 在次系統或元件的定義上新增連接埠（帶數字），或修改既有連接埠的數字
  app.post("/api/projects/:id/interfaces/ports", wrap(async (req, res) => {
    const id = pid(req), a = await ready(id), b = req.body ?? {};
    const ports = P4.portDefsOf(a);
    if (b.id) {
      const el = own(a.elements.find((e) => e.id === b.id && e.kind === "PortUsage"), "連接埠");
      rewritable(a, el, ["AttributeUsage"]);
      const pd = ports.find((p) => el.typeIds.includes(p.id));
      if (!pd) throw new store.UserError("這個連接埠的型別不是 JRI 的連接埠定義（InterfacePort），請到「原始碼」分頁修改。");
      const indent = (await store.readFile(id, el.file)).split("\n")[(el.line ?? 1) - 1]?.match(/^\s*/)?.[0] ?? "";
      const text = P4.portUsageText(el.name, pd, b.values ?? {}, indent).trim();
      return save(id, el.file, replaceLoc(await store.readFile(id, el.file), el.loc!, text), author(req), `修改連接埠數字：${el.name}`, res);
    }
    const owner = own(a.elements.find((e) => e.id === b.owner && e.kind === "PartDefinition"), "次系統或元件");
    const pd = ports.find((p) => p.id === b.portDef);
    if (!pd) throw new store.UserError("請選連接埠定義。");
    const name = String(b.name ?? "").trim();
    if (a.elements.some((e) => e.owner === owner.id && e.name === name)) throw new store.UserError(`「${owner.name}」裡已經有「${name}」。`);
    const next = insertInside(await store.readFile(id, owner.file), owner, (indent) => P4.portUsageText(name, pd, b.values ?? {}, indent));
    return save(id, owner.file, next, author(req), `新增連接埠：${owner.name}.${name}`, res);
  }));

  // 標成外部提供（#given）或取消：只管介面，規格當給定值
  app.post("/api/projects/:id/interfaces/given", wrap(async (req, res) => {
    const id = pid(req), a = await ready(id), b = req.body ?? {};
    const el = own(a.elements.find((e) => e.id === b.id && e.kind === "PartDefinition"), "次系統或元件");
    const content = await store.readFile(id, el.file);
    const lines = content.split("\n"), i = (el.line ?? 1) - 1, line = lines[i] ?? "";
    if (b.given && !P4.isGiven(el)) {
      if (!/^\s*part def\b/.test(line)) throw new store.UserError("這個定義的寫法無法自動標記，請到「原始碼」分頁在 part def 前面加上 #given。");
      lines[i] = line.replace(/^(\s*)part def\b/, "$1#given part def");
    } else if (!b.given && P4.isGiven(el)) {
      if (!/#given\s+/.test(line)) throw new store.UserError("找不到 #given 標記，請到「原始碼」分頁修改。");
      lines[i] = line.replace(/#given\s+/, "");
    } else return res.json({ saved: true, ...((await view(id)) as object), interfaces: (await build(id, a)).report });
    return save(id, el.file, lines.join("\n"), author(req), `${b.given ? "標為" : "取消"}外部提供：${el.name}`, res);
  }));

  // 在系統裡把兩個零件接起來（互連圖上拉線也走這裡）：自動找出兩邊對得上的連接埠與介面定義
  app.post("/api/projects/:id/interfaces/connect", wrap(async (req, res) => {
    const id = pid(req), a = await ready(id), b = req.body ?? {};
    const byId = new Map(a.elements.map((e) => [e.id, e]));
    let from = byId.get(b.from), to = byId.get(b.to);
    if (!from || !to || from.kind !== "PartUsage" || to.kind !== "PartUsage") throw new store.UserError("介面要接在兩個零件之間（互連圖上的方框）。");
    if (from.id === to.id) throw new store.UserError("不能把零件接到自己。");
    const owner = own(byId.get(from.owner ?? ""), "上層元素");
    if (owner.id !== to.owner) throw new store.UserError("兩端必須在同一個系統（上層元素）裡。");
    const ports = a.elements.filter((e) => e.kind === "PortDefinition");
    const texts = await textsOf(id);
    const defs = P4.interfaceDefsOf(a, texts).filter((d) => d.ends.length >= 2 && (!b.def || d.id === b.def));
    const portsOf = (part: Element) => a.elements.filter((e) => e.kind === "PortUsage" && (e.owner === part.id || part.typeIds.includes(e.owner ?? "")))
      .map((e) => ({ e, pd: e.typeIds.find((t) => ports.some((p) => p.id === t)) ?? null }));
    const pick = (x: Element, y: Element) => {
      for (const d of defs) for (const p of portsOf(x)) for (const q of portsOf(y)) {
        if (p.pd === d.ends[0].portDef && q.pd === d.ends[1].portDef && (!b.fromPort || p.e.id === b.fromPort) && (!b.toPort || q.e.id === b.toPort)) return { d, p: p.e, q: q.e };
      }
      return null;
    };
    let hit = pick(from, to);
    if (!hit && !b.fromPort && !b.toPort) { hit = pick(to, from); if (hit) [from, to] = [to, from]; }
    if (!hit) throw new store.UserError(`「${from.name}」和「${to.name}」身上沒有對得上任何介面定義兩端的連接埠。請先到「介面」頁建立介面定義，並在兩個次系統上加連接埠。`);
    const taken = new Set(a.elements.filter((e) => e.owner === owner.id).map((e) => e.name));
    let name = String(b.name ?? "").trim();
    if (!name) { let n = 1; while (taken.has(`${hit.d.name}${n}`)) n++; name = `${hit.d.name}${n}`; }
    if (taken.has(name)) throw new store.UserError(`「${owner.name}」裡已經有「${name}」。`);
    const next = insertInside(await store.readFile(id, owner.file), owner, (indent) => P4.interfaceUsageText(name, hit.d, [from.name, hit.p.name], [to.name, hit.q.name], indent));
    return save(id, owner.file, next, author(req), `新增介面：${from.name} ↔ ${to.name}（${hit.d.name}）`, res);
  }));

  // 修改單一介面（使用）上的負責人與成熟度：寫在介面的主體裡，蓋過介面定義的值
  app.post("/api/projects/:id/interfaces/usage", wrap(async (req, res) => {
    const id = pid(req), a = await ready(id), b = req.body ?? {};
    const el = own(a.elements.find((e) => e.id === b.id && e.kind === "InterfaceUsage"), "介面");
    const content = await store.readFile(id, el.file);
    const text = el.loc ? P4.sliceLoc(content, el.loc) : "";
    const head = text.replace(/\s*(\{[\s\S]*\}|;)\s*$/, "");
    if (!/\bconnect\b/.test(head) || a.elements.some((e) => e.owner === el.id && e.kind !== "AttributeUsage" && e.kind !== "PortUsage")) throw new store.UserError("這個介面的寫法無法自動修改，請到「原始碼」分頁修改。");
    if (b.maturity && !P4.MATURITY.includes(b.maturity)) throw new store.UserError("成熟度只能是存在、暫定、凍結。");
    const lines: string[] = [];
    for (const k of ["maturity", "ownerA", "ownerB"]) {
      const v = String(b[k] ?? "").trim().replace(/["\\\r\n]/g, "").slice(0, 60);
      if (v) lines.push(`attribute :>> ${k} = "${v}";`);
    }
    const indent = content.split("\n")[(el.line ?? 1) - 1]?.match(/^\s*/)?.[0] ?? "";
    const next = lines.length ? `${head} {\n${lines.map((l) => `${indent}    ${l}\n`).join("")}${indent}}` : `${head};`;
    return save(id, el.file, replaceLoc(content, el.loc!, next), author(req), `修改介面：${el.name}`, res);
  }));

  // 介面兩端負責人的同意：記下同意當時的內容雜湊；內容一改，先前的同意就失效，要兩端重新同意才定案
  app.post("/api/projects/:id/interfaces/approve", wrap(async (req, res) => {
    const id = pid(req), b = req.body ?? {};
    const side = b.side === "a" || b.side === "b" ? (b.side as "a" | "b") : null;
    if (!side) throw new store.UserError("請指定是哪一端（a 或 b）。");
    const { report: r } = await build(id);
    const i = r.interfaces.find((x) => x.id === b.id);
    if (!i) throw new store.UserError("找不到這個介面。");
    const owner = side === "a" ? i.ownerA : i.ownerB, who = author(req);
    if (!owner) throw new store.UserError(`請先填${side === "a" ? "第一" : "第二"}端（${i.ends[side === "a" ? 0 : 1].partDefName}）的負責人。`);
    if (owner.trim() !== who.trim()) throw new store.UserError(`這一端的負責人是「${owner}」，只有本人可以同意（目前登入的是「${who}」）。`);
    const all = await readApprovals(id);
    const cur = all[i.qualifiedName] ?? {};
    if (b.revoke) delete cur[side]; else cur[side] = { by: who, at: new Date().toISOString(), hash: i.hash };
    all[i.qualifiedName] = cur;
    await fs.writeFile(file(id), JSON.stringify({ approvals: all }, null, 2) + "\n", "utf8");
    await store.commit(store.dirOf(id), who, `${b.revoke ? "撤回" : ""}同意介面：${i.name}（${side === "a" ? i.ends[0].partDefName : i.ends[1].partDefName} 端）`);
    res.json({ saved: true, interfaces: (await build(id)).report });
  }));

  // 刪除單一介面（使用）沿用既有的 /elements/delete
};
