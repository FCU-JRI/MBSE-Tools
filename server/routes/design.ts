import type { Express } from "express";
import type { Element } from "../extract.ts";
import * as store from "../projects.ts";
import { deleteElementText, insertInside, interfaceText, nextShortName, quote, setInterfaceStatusText } from "../edits.ts";
import type { InterfaceParam } from "../edits.ts";
import { wrap, author, pid, view, editable } from "./common.ts";
import type { An } from "./common.ts";

/** 設計迴圈的元素：設計方案的候選（variant）、介面（兩端連接埠＋系統裡的 interface）。都在同一個檔案裡改，每一步重新解析，錯就不存。 */
export function mount(app: Express): void {
  const again = (a: An, el: Element) => a.elements.find((e) => e.qualifiedName === el.qualifiedName && e.kind === el.kind);
  const fail = (a: An) => ({ saved: false, diagnostics: a.diagnostics });

  // 設計方案：加一個候選（variant part）
  app.post("/api/projects/:id/variants", wrap(async (req, res) => {
    const id = pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const alt = a.elements.find((e) => e.id === req.body?.id);
    if (!alt || alt.category !== "DesignAlternative" || alt.kind !== "PartDefinition") throw new store.UserError("請選一個設計方案。");
    editable(alt);
    const name = String(req.body?.name ?? "").trim();
    if (!name || /[\r\n]/.test(name)) throw new store.UserError("請填候選方案的名稱。");
    const base = alt.shortName ?? nextShortName(a.elements, "ALT");
    const sn = nextShortName(a.elements, base);
    const content = insertInside(await store.readFile(id, alt.file), alt, (indent) => `${indent}variant part <'${sn}'> ${quote(name)};\n`);
    const b = await store.analyzeProject(id, { file: alt.file, content });
    if (!b.ok) return res.status(422).json(fail(b));
    const r = await store.saveFile(id, alt.file, content, author(req), `新增候選方案：${alt.name} › ${name}`);
    if (!r.saved) return res.status(422).json(fail(r.analysis));
    res.json({ saved: true, selected: again(b, alt)?.id, ...(await view(id)) });
  }));

  // 介面：在系統裡連接兩個零件；兩端的定義各加一個同名連接埠
  app.post("/api/projects/:id/interfaces", wrap(async (req, res) => {
    const id = pid(req);
    let a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const b0 = req.body ?? {};
    const sys = a.elements.find((e) => e.id === b0.system);
    if (!sys || sys.kind !== "PartDefinition") throw new store.UserError("請選介面所在的系統（或次系統）。");
    editable(sys);
    const parts = a.elements.filter((e) => e.kind === "PartUsage" && e.owner === sys.id);
    const pa = parts.find((e) => e.id === b0.a), pb = parts.find((e) => e.id === b0.b);
    if (!pa || !pb) throw new store.UserError(`兩端都要是「${sys.name}」裡的零件。`);
    if (pa.id === pb.id) throw new store.UserError("介面的兩端不能是同一個零件。");
    const defOf = (u: Element) => a.elements.find((e) => u.typeIds.includes(e.id) && e.kind === "PartDefinition");
    const da = defOf(pa), db = defOf(pb);
    if (!da || !db) throw new store.UserError("兩端的零件都要有定義（例如次系統）。");
    if (da.id === db.id) throw new store.UserError("兩端的零件是同一個定義，目前不支援，請到原始碼處理。");
    for (const d of [da, db]) if (editable(d).file !== sys.file) throw new store.UserError("系統與兩端的定義在不同檔案，請到模型頁的「原始碼」建立介面。");
    const file = sys.file;
    const sn = nextShortName(a.elements, "IF");
    const params: InterfaceParam[] = Array.isArray(b0.params) ? b0.params.slice(0, 10).map((p: Record<string, unknown>) => ({ name: String(p.name ?? ""), a: String(p.a ?? ""), b: String(p.b ?? ""), unit: String(p.unit ?? "") })) : [];
    let content = await store.readFile(id, file);
    const text = interfaceText(sn, String(b0.name ?? ""), String(b0.kind ?? ""), pa.name, pb.name, params, "");
    // 依序：A 端連接埠 → B 端連接埠 → 系統裡的介面；每步後重新解析並找回元素
    for (const [step, target] of [["A", da], ["B", db]] as const) {
      const t = again(a, target)!;
      content = insertInside(content, t, (indent) => `${indent}port <'${sn}-${step}'> ${quote(sn)} : InterfacePort;\n`);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return res.status(422).json(fail(a));
    }
    const s2 = again(a, sys)!;
    content = insertInside(content, s2, (indent) => text.split("\n").filter(Boolean).map((l) => indent + l).join("\n") + "\n");
    a = await store.analyzeProject(id, { file, content });
    if (!a.ok) return res.status(422).json(fail(a));
    const r = await store.saveFile(id, file, content, author(req), `新增介面：${sn} ${String(b0.name ?? "").trim()}（${pa.name} ↔ ${pb.name}）`);
    if (!r.saved) return res.status(422).json(fail(r.analysis));
    res.json({ saved: true, selected: a.elements.find((e) => e.shortName === sn && e.kind === "InterfaceUsage")?.id, ...(await view(id)) });
  }));

  // 介面狀態：成熟度、兩端同意
  app.post("/api/projects/:id/interfaces/status", wrap(async (req, res) => {
    const id = pid(req);
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = a.elements.find((e) => e.id === req.body?.id && e.kind === "InterfaceUsage");
    if (!el) throw new store.UserError("找不到這個介面。");
    editable(el);
    const b = req.body ?? {};
    const content = setInterfaceStatusText(await store.readFile(id, el.file), el, String(b.maturity ?? ""), String(b.agreedA ?? ""), String(b.agreedB ?? ""));
    const after = await store.analyzeProject(id, { file: el.file, content });
    if (!after.ok) return res.status(422).json(fail(after));
    const r = await store.saveFile(id, el.file, content, author(req), `更新介面狀態：${el.shortName ?? ""} ${el.name}`);
    if (!r.saved) return res.status(422).json(fail(r.analysis));
    res.json({ saved: true, selected: again(after, el)?.id, ...(await view(id)) });
  }));

  // 刪除介面：連同兩端的連接埠
  app.post("/api/projects/:id/interfaces/delete", wrap(async (req, res) => {
    const id = pid(req);
    let a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到模型頁的「原始碼」修正。");
    const el = a.elements.find((e) => e.id === req.body?.id && e.kind === "InterfaceUsage");
    if (!el || !el.shortName) throw new store.UserError("找不到這個介面。");
    editable(el);
    const file = el.file, sn = el.shortName;
    let content = await store.readFile(id, file);
    const targets = () => [a.elements.find((e) => e.kind === "InterfaceUsage" && e.shortName === sn), ...a.elements.filter((e) => e.kind === "PortUsage" && e.file === file && (e.shortName === `${sn}-A` || e.shortName === `${sn}-B`))].filter((x): x is Element => !!x);
    for (let i = 0; i < 3; i++) {
      const t = targets()[0];
      if (!t) break;
      content = deleteElementText(content, t, a.elements, a.relations);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return res.status(422).json(fail(a));
    }
    const r = await store.saveFile(id, file, content, author(req), `刪除介面：${sn} ${el.name}`);
    if (!r.saved) return res.status(422).json(fail(r.analysis));
    res.json({ saved: true, ...(await view(id)) });
  }));
}
