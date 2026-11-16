// P6：方案比較與模型內公式（docs/IMPL-PLAN.md）。這一期的伺服器路由寫在這裡，路徑一律以 /api/projects/:id/ 開頭。
// 工具不呼叫任何 AI、不經手任何憑證；求值交給解析器。說明見 docs/TRADE-CALC.md。
import type { Mount } from "./context.ts";
import type { Analysis } from "../engine.ts";
import { ROOT_PACKAGE, withModel } from "../engine.ts";
import type { Element } from "../extract.ts";
import { insertInside, insertInto, quote, replaceLoc, setRawAttrText } from "../edits.ts";
import { evaluateTrades } from "../../web/src/method/trade.ts";
import { CALC_PACKAGE, calcPackageText, calcText, evaluateModel, listCalcDefs, toValue } from "./calc.ts";

const str = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ")}"`;

export const mount: Mount = (app, ctx) => {
  const { wrap, pid, author, view, store } = ctx;
  const analysisOf = async (id: string) => {
    const a = await store.analyzeProject(id);
    if (!a.ok) throw new store.UserError("模型目前有錯誤，請先到「原始碼」分頁修正。");
    return a;
  };
  const rootFile = (a: Analysis) => a.elements.find((e) => e.kind === "Package" && e.qualifiedName === ROOT_PACKAGE && !e.shared)?.file || "model.sysml";
  const own = (a: Analysis, id: unknown, category?: string): Element => {
    const e = [...a.elements, ...a.unnamed].find((x) => x.id === id);
    if (!e || (category && e.category !== category)) throw new store.UserError("找不到這個元素。");
    if (e.shared) throw new store.UserError("這是共用元件庫的內容，不能在專案內修改。");
    return e;
  };
  /** 改一個檔案，存檔前解析；失敗回 422 與診斷 */
  const save = async (id: string, file: string, content: string, who: string, message: string) => {
    const r = await store.saveFile(id, file, content, who, message);
    return r.saved ? { saved: true as const } : { saved: false as const, diagnostics: r.analysis.diagnostics };
  };

  // ───────── 方案比較 ─────────

  app.get("/api/projects/:id/trades", wrap(async (req, res) => {
    const a = await store.analyzeProject(pid(req));
    res.json({ ok: a.ok, matrices: a.ok ? evaluateTrades(a) : [] });
  }));

  /** 打分：在候選方案裡新增或修改那一項準則的分數（item '準則編號' : CriterionScore） */
  app.post("/api/projects/:id/trades/score", wrap(async (req, res) => {
    const id = pid(req);
    const a = await analysisOf(id);
    const alt = own(a, req.body?.alternative, "Alternative");
    const crit = own(a, req.body?.criterion, "Criterion");
    const key = crit.shortName || crit.name;
    const raw = String(req.body?.score ?? "").trim();
    if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new store.UserError("分數必須是數字。");
    const score = raw.includes(".") ? raw : `${raw}.0`;
    const basis = String(req.body?.basis ?? "").trim();
    let content = await store.readFile(id, alt.file);
    const existing = [...a.elements, ...a.unnamed].find((e) => e.category === "CriterionScore" && (e.parent ?? e.owner) === alt.id && e.name === key);
    if (existing) {
      content = setRawAttrText(content, existing, "score", score);
      const a2 = await store.analyzeProject(id, { file: alt.file, content });
      const again = a2.elements.find((e) => e.category === "CriterionScore" && e.qualifiedName === existing.qualifiedName);
      if (!again) throw new store.UserError("修改後找不到這個分數，未儲存。");
      content = basis || again.attrs.basis ? setRawAttrText(content, again, "basis", str(basis)) : content;
    } else {
      content = insertInside(content, alt, (i) => `${i}item ${quote(key)} : CriterionScore { :>> score = ${score};${basis ? ` :>> basis = ${str(basis)};` : ""} }\n`);
    }
    const r = await save(id, alt.file, content, author(req), `方案比較打分：${alt.name} × ${crit.name} = ${raw}`);
    if (!r.saved) return res.status(422).json(r);
    const v = await view(id);
    res.json({ saved: true, ...(v as object), matrices: evaluateTrades((v as { analysis: Analysis }).analysis) });
  }));

  /** 決定：選定一個方案，其餘否決；每個方案的理由一起寫入 */
  app.post("/api/projects/:id/trades/decide", wrap(async (req, res) => {
    const id = pid(req);
    let a = await analysisOf(id);
    const m = own(a, req.body?.matrix, "DecisionMatrix");
    const alts = a.elements.filter((e) => e.category === "Alternative" && (e.parent ?? e.owner) === m.id);
    const selected = req.body?.selected ? own(a, req.body.selected, "Alternative") : null;
    if (selected && !alts.some((x) => x.id === selected.id)) throw new store.UserError("選定的方案不在這個方案比較裡。");
    const reasons = (req.body?.rationale ?? {}) as Record<string, unknown>;
    for (const x of alts) {
      const st = selected ? (x.id === selected.id ? "selected" : "rejected") : "candidate";
      if (st === "rejected" && !String(reasons[x.id] ?? "").trim() && !String(x.attrs.rationale ?? "").replace(/"/g, "").trim()) throw new store.UserError(`否決的方案「${x.name}」要寫理由。`);
    }
    let content = await store.readFile(id, m.file);
    const file = m.file;
    const steps: { qn: string; name: string; value: string }[] = [];
    for (const x of alts) {
      steps.push({ qn: x.qualifiedName, name: "status", value: str(selected ? (x.id === selected.id ? "selected" : "rejected") : "candidate") });
      const why = reasons[x.id];
      if (typeof why === "string") steps.push({ qn: x.qualifiedName, name: "rationale", value: str(why.trim()) });
    }
    if (typeof req.body?.decision === "string") steps.push({ qn: m.qualifiedName, name: "decision", value: str(req.body.decision.trim()) });
    for (const s of steps) {
      const el = a.elements.find((e) => e.qualifiedName === s.qn);
      if (!el) throw new store.UserError("修改後找不到元素，未儲存。");
      content = setRawAttrText(content, el, s.name, s.value);
      a = await store.analyzeProject(id, { file, content });
      if (!a.ok) return res.status(422).json({ saved: false, diagnostics: a.diagnostics });
    }
    const r = await save(id, file, content, author(req), `方案比較決定：${m.name}${selected ? ` → ${selected.name}` : "（重新評估）"}`);
    if (!r.saved) return res.status(422).json(r);
    const v = await view(id);
    res.json({ saved: true, ...(v as object), matrices: evaluateTrades((v as { analysis: Analysis }).analysis) });
  }));

  // ───────── 模型內公式 ─────────

  const calcState = async (id: string) => {
    const a = await store.analyzeProject(id);
    if (!a.ok) return { ok: false, defs: [], results: [], checks: [], satisfaction: [] };
    const sources = await store.sources(id);
    const contents = new Map(sources.map(([f, t]) => [f, t] as [string, string]));
    const defs = listCalcDefs(a, contents);
    const evaluated = await withModel(sources, (model) => evaluateModel(model, a, contents));
    return { ok: true, defs, results: evaluated?.results ?? [], checks: evaluated?.checks ?? [], satisfaction: a.satisfaction };
  };

  app.get("/api/projects/:id/calcs", wrap(async (req, res) => res.json(await calcState(pid(req)))));

  /** 新增（沒有 id）或修改（有 id）一條公式 */
  app.post("/api/projects/:id/calcs", wrap(async (req, res) => {
    const id = pid(req);
    const a = await analysisOf(id);
    const b = req.body ?? {};
    let file: string, content: string, message: string;
    if (b.id) {
      const el = own(a, b.id);
      if (el.kind !== "CalculationDefinition" || !el.loc) throw new store.UserError("這不是公式（calc def）。");
      file = el.file;
      content = await store.readFile(id, file);
      const indent = (content.split("\n")[el.loc.line - 1] ?? "").match(/^\s*/)?.[0] ?? "";
      const text = calcText(b, a.elements, indent, el.shortName ?? (b.shortName || null)).replace(/\n$/, "").slice(indent.length);
      content = replaceLoc(content, el.loc, text);
      message = `修改公式：${String(b.name).trim()}`;
    } else {
      file = rootFile(a);
      content = await store.readFile(id, file);
      const inFile = a.elements.filter((e) => e.file === file);
      const hasPkg = inFile.some((e) => e.kind === "Package" && e.qualifiedName === `${ROOT_PACKAGE}::${CALC_PACKAGE}`);
      content = hasPkg
        ? insertInto(content, inFile, ROOT_PACKAGE, CALC_PACKAGE, (i) => calcText(b, a.elements, i))
        : insertInto(content, inFile, ROOT_PACKAGE, null, (i) => calcPackageText(i, calcText(b, a.elements, i + "    ")));
      message = `新增公式：${String(b.name).trim()}`;
    }
    const r = await save(id, file, content, author(req), message);
    if (!r.saved) return res.status(422).json(r);
    res.json({ saved: true, ...(await calcState(id)) });
  }));

  /** 求一個運算式的值（不存檔），例如 Calculations::DeltaV(180.0, 20.0, 15.0) */
  app.post("/api/projects/:id/calcs/eval", wrap(async (req, res) => {
    const id = pid(req);
    await analysisOf(id);
    const expression = String(req.body?.expression ?? "").trim();
    if (!expression || expression.length > 500 || /[\r\n;{}]/.test(expression)) throw new store.UserError("運算式不能是空的，不能有分號、大括號或換行，長度在 500 字以內。");
    const context = String(req.body?.context ?? ROOT_PACKAGE).trim() || ROOT_PACKAGE;
    if (!/^[^\r\n;{}]{1,300}$/.test(context)) throw new store.UserError("求值的位置不合法。");
    const out = await withModel(await store.sources(id), async (model) => {
      try { return { value: toValue(await model.eval(expression, { context })), error: null }; } catch (err) { return { value: null, error: (err as Error).message }; }
    });
    res.json(out ?? { value: null, error: "模型有錯誤，無法求值。" });
  }));
};
