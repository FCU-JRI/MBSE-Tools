import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Element, Me, Meta, Step, View } from "./api.ts";
import { label, listOf } from "./model.ts";

// 值是 SysML v2 標準庫 VerificationMethodKind 的列舉值
const METHODS: [string, string][] = [["test", "測試"], ["analyze", "分析"], ["inspect", "檢查"], ["demo", "展示"]];
const REL_ZH: Record<string, string> = { trace: "追溯到", derive: "衍生自", refine: "細化", allocate: "分配給", compose: "屬於", verify: "驗證" };

/** 伺服器的步驟另外帶指南文案（todo、how）與「數量不足」的計數；api.ts 的 Step 沒列，這裡補上。 */
export type GuideIssue = Step["issues"][number] & { count?: { category: string; zh: string; have: number; min: number } };
export type GuideStep = Omit<Step, "issues"> & { todo?: string; how?: string[]; issues: GuideIssue[]; ahead?: GuideIssue[] };

interface Props {
  view: View; meta: Meta; user: Me; onChanged: (v: View) => void; onOpen: (elementId: string, category: string | null) => void;
  /** 到模型頁打開某類別的新增表單 */
  onNew: (category: string, parentId: string | null) => void;
}

/** 流程指南：一列一步。做完的收成一行，正在做的那步自動展開；每步固定「要做什麼／怎麼做／還缺」。 */
export function ProcessView(p: Props) {
  const steps = p.view.process as GuideStep[];
  const current = steps.find((s) => s.state === "current");
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current.id] : []));
  const [all, setAll] = useState(false);
  // 一步完成後：收起剛完成的，展開新的「正在做」
  useEffect(() => {
    setOpen((o) => {
      const n = new Set([...o].filter((id) => steps.find((s) => s.id === id)?.state !== "done"));
      if (current) n.add(current.id);
      return n;
    });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (steps.length === 0) return <p className="body">模型有錯誤，請先到模型頁的「原始碼」修正。</p>;
  const done = steps.filter((s) => s.state === "done").length;
  const guided = p.view.project.template === "guided";
  const isOpen = (id: string) => all || open.has(id);
  const toggle = (id: string) => {
    if (all) { setAll(false); setOpen(new Set(steps.map((s) => s.id).filter((x) => x !== id))); return; }
    setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const goTo = (id: string) => { setOpen((o) => new Set([...o, id])); requestAnimationFrame(() => document.getElementById(`guide-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })); };

  return (
    <section className="guide" aria-label="流程指南">
      <div className="guide-head">
        <h1 className="heading">指南</h1>
        <span className="label">NASA-HDBK-1009A · {steps.length} 步 · 完成 <span className="data">{done}</span> 步</span>
        <span className="grow" />
        <button className="tbtn" aria-pressed={all} onClick={() => { setAll(!all); if (all) setOpen(new Set(current ? [current.id] : [])); }}>{all ? "收起" : "全部展開"}</button>
      </div>
      {done === steps.length && <p className="msg"><span className="tag done">DONE</span>全部步驟都完成了。接下來到「專案管理」看審查節點還缺什麼。</p>}
      <ol className="guide-list">
        {steps.map((s, i) => (
          <li key={s.id} id={`guide-${s.id}`} className={`guide-step ${s.state}`}>
            <button className="guide-row" aria-expanded={isOpen(s.id)} onClick={() => toggle(s.id)}>
              <span className="guide-mark" aria-hidden="true">{s.state === "done" ? "✓" : i + 1}</span>
              <span className="guide-name">{s.zh}</span>
              <span className="grow" />
              {s.state === "done" ? <span className="caption">{s.count} 項</span>
                : s.state === "current" ? <span className="tag">進行中</span>
                : <span className="caption">{s.count ? `${s.count} 項` : ""}</span>}
              <span className="guide-tw" aria-hidden="true">{isOpen(s.id) ? "−" : "+"}</span>
            </button>
            {isOpen(s.id) && <StepPanel {...p} key={s.id} step={s} index={i} steps={steps} guided={guided} goTo={goTo} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** 「到模型頁做這一步」要打開哪個類別：先挑還不夠數量的類別，否則第一個。 */
export function targetCategory(step: GuideStep): string {
  return [...step.issues, ...(step.ahead ?? [])].find((i) => i.count && step.categories.includes(i.count.category))?.count?.category ?? step.categories[0];
}

function StepPanel({ step, index, steps, guided, view, meta, user, onChanged, onOpen, onNew, goTo }: Props & { step: GuideStep; index: number; steps: GuideStep[]; guided: boolean; goTo: (id: string) => void }) {
  const pid = view.project.id;
  const els = view.analysis.elements;
  const cats = step.categories.map((c) => meta.categories.find((x) => x.id === c)).filter((c): c is NonNullable<typeof c> => !!c);
  const [catId, setCatId] = useState(cats[0]?.id ?? "");
  const cat = cats.find((c) => c.id === catId) ?? cats[0];
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [linkTo, setLinkTo] = useState("");
  const [parentId, setParentId] = useState("");
  const [method, setMethod] = useState("test");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiOpen, setAiOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [showExample, setShowExample] = useState(false);

  const items = listOf(els, ...step.categories).filter((e) => !e.shared);
  const targets = useMemo(() => (step.link ? listOf(els, ...step.link.to).filter((e) => step.link?.kind !== "compose" || e.kind === "PartDefinition") : []), [els, step.link]);
  const parents = step.parent ? listOf(els, step.parent).filter((e) => !e.shared) : [];
  const locked = guided && step.state === "locked";
  const blocker = steps.find((s) => s.state === "current");
  const canEdit = user.caps.edit && !locked;
  // 到模型頁新增：任務階段、功能要放在總任務裡（還沒有總任務時，第一個建立的就是總任務）
  const mission = step.parent ? parents.find((e) => !parents.some((q) => q.id === e.owner)) : undefined;
  const toModel = () => onNew(targetCategory(step), mission?.id ?? null);
  // 任務階段：還沒有總任務時，第一個建立的就是總任務
  const needsParent = step.parent && parents.length > 0;
  useEffect(() => { if (needsParent && !parentId) setParentId(parents[0].id); }, [needsParent, parentId, parents]);

  /** 建立一個項目並連到上一層。回傳更新後的畫面資料。 */
  const create = async (v: View, input: { category: string; name: string; doc: string; attrs?: Record<string, string>; linkTo?: string; parentId?: string; method?: string }): Promise<View> => {
    const target = input.linkTo ? v.analysis.elements.find((e) => e.id === input.linkTo) : undefined;
    const isVerify = step.link?.kind === "verify";
    const before = new Set(v.analysis.elements.map((e) => e.id));
    let nv = await api<View>(`/projects/${pid}/elements`, "POST", {
      category: input.category, name: input.name, doc: input.doc, attrs: input.attrs ?? {}, parentId: input.parentId || undefined,
      ...(isVerify ? { verifies: target?.qualifiedName, method: input.method ?? "test" } : {}),
    });
    const made = nv.analysis.elements.find((e) => !before.has(e.id) && e.name === input.name.trim());
    if (made && target && step.link && !isVerify) {
      const [from, to] = step.link.direction === "out" ? [made.id, target.id] : [target.id, made.id];
      nv = await api<View>(`/projects/${pid}/relations`, "POST", { kind: step.link.kind, from, to });
    }
    return nv;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true); setMsg(null);
    try {
      onChanged(await create(view, { category: cat.id, name, doc, attrs, linkTo, parentId: needsParent ? parentId : undefined, method }));
      setMsg({ ok: true, text: `已加入「${name}」。` });
      setName(""); setDoc(""); setAttrs({});
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  const prompt = () => {
    const upstream = targets.map((t) => `- ${label(t)}${t.doc ? `：${t.doc}` : ""}`).join("\n") || "（沒有）";
    const have = items.map((t) => `- ${label(t)}`).join("\n") || "（還沒有）";
    return [
      `你正在協助 JRI（學生火箭團隊）依 NASA-HDBK-1009A 建立系統模型。專案：${view.project.name}。`,
      `規則：分析從利害關係人開始逐步拆解；每一項都必須從上一層推導；不要編造數值或規範，不確定就先問我。`,
      ``,
      `現在是第 ${index + 1} 步「${step.zh}」（手冊 ${step.nasa}）。要回答的問題：${step.question}`,
      `說明：${step.why}`,
      `例：${step.example}`,
      ``,
      step.link ? `上一層可以連結的項目：\n${upstream}` : "",
      `這一步已經有的項目：\n${have}`,
      ``,
      `請先用上面的問題向我提問，一次一題。等我回答完，把結果整理成下面的 JSON 給我（只輸出 JSON）：`,
      `[{"name": "名稱", "doc": "內容，用繁體中文${cat?.keyword === "requirement" ? "，需求用「應」字且一條一件事" : ""}"${step.link ? `, "linkTo": "上一層項目的編號"` : ""}}]`,
    ].filter((l) => l !== "").join("\n");
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt()); setMsg({ ok: true, text: "已複製。貼到你的 AI，回答它的提問後，把它給的 JSON 貼回下面。" }); }
    catch { setMsg({ ok: false, text: "無法自動複製，請手動選取下方文字。" }); }
    setAiOpen(true); setFormOpen(true);
  };
  const importAi = async () => {
    setBusy(true); setMsg(null);
    try {
      const m = aiText.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("找不到 JSON 陣列。請貼上 AI 回覆中以 [ 開頭、] 結尾的部分。");
      const list = JSON.parse(m[0]) as { name?: unknown; doc?: unknown; linkTo?: unknown }[];
      if (!Array.isArray(list) || list.length === 0) throw new Error("沒有可匯入的項目。");
      if (list.length > 30) throw new Error("一次最多匯入 30 項。");
      let v = view, n = 0;
      for (const it of list) {
        const nm = String(it.name ?? "").trim();
        if (!nm) continue;
        const key = String(it.linkTo ?? "").trim();
        const t = key ? listOf(v.analysis.elements, ...(step.link?.to ?? [])).find((e) => e.shortName === key || e.name === key || label(e) === key) : undefined;
        if (step.link && key && !t) throw new Error(`「${nm}」要連結的「${key}」不存在。已匯入 ${n} 項。`);
        v = await create(v, { category: cat.id, name: nm, doc: String(it.doc ?? ""), linkTo: t?.id, parentId: needsParent ? parentId : undefined, method });
        onChanged(v); n++;
      }
      setAiText(""); setMsg({ ok: true, text: `已匯入 ${n} 項。請逐項檢查內容是否正確。` });
    } catch (e) { setMsg({ ok: false, text: e instanceof SyntaxError ? "JSON 格式不正確，請確認貼上的是完整的陣列。" : (e as Error).message }); }
    finally { setBusy(false); }
  };

  const gaps = step.state === "locked" ? step.ahead ?? [] : step.issues;
  const issueText = (it: GuideIssue) => it.count ? `${it.count.zh} ${it.count.have} 個（至少 ${it.count.min} 個）` : it.text;

  return (
    <div className="guide-body enter">
      <div className="guide-part">
        <h2 className="label">要做什麼</h2>
        <p className="body guide-todo">{step.todo ?? step.question}</p>
      </div>
      {(step.how ?? []).length > 0 && (
        <div className="guide-part">
          <h2 className="label">怎麼做</h2>
          <ol className="guide-how">{(step.how ?? []).map((h, i) => <li key={i} className="body">{h}</li>)}</ol>
        </div>
      )}
      <div className="guide-part">
        <h2 className="label">還缺</h2>
        {step.state === "locked" && <p className="body muted">{locked ? "要先完成" : "建議先完成"}第 {steps.indexOf(blocker as GuideStep) + 1} 步「{blocker?.zh}」{locked ? "，才能新增這一步的項目" : ""}。
          {blocker && <button className="tbtn" onClick={() => goTo(blocker.id)}>前往</button>}</p>}
        {locked ? null
          : gaps.length === 0 ? <p className="body muted">{step.state === "locked" ? "這一步本身不缺。" : "沒有，這一步完成了。"}</p>
          : <ul className="guide-missing">{gaps.map((it, i) => (
              <li key={i}><span className="body">{issueText(it)}</span>
                {it.id && <button className="tbtn" onClick={() => onOpen(it.id as string, els.find((e) => e.id === it.id)?.category ?? null)}>開啟</button>}</li>
            ))}</ul>}
      </div>
      <div className="tbtn-row guide-actions">
        <button className="btn" disabled={!canEdit} onClick={toModel} title={locked ? "流程範本專案要依序完成" : undefined}>到模型頁做這一步 →</button>
        {canEdit && <button type="button" className="tbtn primary" onClick={copy}>複製給 AI 的提示</button>}
        <button type="button" className="tbtn" aria-pressed={showExample} onClick={() => setShowExample(!showExample)}>看範例</button>
      </div>
      {msg && !formOpen && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
      {showExample && <p className="caption guide-example">例：{step.example}</p>}

      <div className="guide-more">
        <p className="caption">手冊 {step.nasa} · 要回答的問題：{step.question}</p>
        <p className="caption">為什麼：{step.why}</p>
      </div>

      <div className="section">
        <div className="section-head"><h2 className="section-title">已有的{step.zh}</h2><span className="label">{items.length}</span></div>
        {items.length === 0 ? <p className="caption">還沒有。</p> : items.map((e) => {
          const up = view.analysis.relations.filter((r) => r.from === e.id && ["trace", "derive", "refine", "allocate", "verify"].includes(r.kind)).map((r) => els.find((x) => x.id === r.to)).filter((x): x is Element => !!x);
          return (
            <button className="proc-item" key={e.id} onClick={() => onOpen(e.id, e.category)}>
              <span className="tid">{e.shortName ?? ""}</span>
              <span className="body">{e.name}{e.doc && <span className="muted">　{e.doc}</span>}</span>
              <span className="caption">{up.map((u) => u.shortName ?? u.name).join("、")}</span>
            </button>
          );
        })}
      </div>

      {canEdit && cat && !formOpen && <div><button className="tbtn" onClick={() => setFormOpen(true)}>在這裡直接加入（不離開流程頁）</button></div>}
      {canEdit && cat && formOpen && (
        <form className="section" onSubmit={submit}>
          <div className="section-head"><h2 className="section-title">在這裡直接加入</h2><button type="button" className="tbtn" onClick={() => setFormOpen(false)}>收起</button></div>
          <div className="row">
            {cats.length > 1 && <label className="field" style={{ flex: "0 0 10rem" }}><span className="label">類別</span><select className="input" value={cat.id} onChange={(e) => setCatId(e.target.value)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.zh}</option>)}</select></label>}
            <label className="field"><span className="label">名稱</span><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
            {step.link && (
              <label className="field"><span className="label">{step.link.zh}</span>
                <select className="input" required={targets.length > 0} value={linkTo} onChange={(e) => setLinkTo(e.target.value)}><option value="">請選擇</option>{targets.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}</select></label>
            )}
            {needsParent && <label className="field" style={{ flex: "0 0 12rem" }}><span className="label">放在哪個任務或階段內</span><select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
            {step.link?.kind === "verify" && <label className="field" style={{ flex: "0 0 8rem" }}><span className="label">方法</span><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, zh]) => <option key={k} value={k}>{zh}</option>)}</select></label>}
          </div>
          <label className="field"><span className="label">{cat.keyword === "requirement" ? "內容（需求用「應」字，一條只寫一件事）" : "說明"}</span><textarea className="input" rows={2} value={doc} onChange={(e) => setDoc(e.target.value)} /></label>
          {(cat.fields ?? []).length > 0 && <div className="row">{(cat.fields ?? []).map((f) => (
            <label className="field" key={f.name} style={{ minWidth: f.type === "text" ? "12rem" : "8rem" }}><span className="label">{f.zh}</span><input className="input" inputMode={f.type === "text" ? "text" : "decimal"} value={attrs[f.name] ?? ""} onChange={(e) => setAttrs({ ...attrs, [f.name]: e.target.value })} /></label>
          ))}</div>}
          {step.parent && parents.length === 0 && <p className="caption">第一個建立的會成為總任務，之後的階段加在它裡面。</p>}
          {step.link && targets.length === 0 && <p className="caption">上一層還沒有可以連結的項目。</p>}
          {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
          <div className="tbtn-row" style={{ paddingLeft: 0, marginTop: 8 }}>
            <button className="btn" disabled={busy}>{busy ? "寫入中" : "加入"}</button>
            <button type="button" className="tbtn" onClick={() => setAiOpen(!aiOpen)}>{aiOpen ? "收起" : "貼上 AI 的回覆"}</button>
          </div>
          {aiOpen && (
            <div style={{ marginTop: 12 }}>
              <p className="caption" style={{ marginBottom: 8 }}>把提示貼給你自己的 AI（任何一種都可以），它會用同一套方法向你提問。回答完後，把它輸出的 JSON 貼在這裡匯入。匯入前請自己看過內容。</p>
              <textarea className="input" rows={5} value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder='[{"name": "…", "doc": "…"}]' spellCheck={false} />
              <div className="tbtn-row"><button type="button" className="tbtn primary" disabled={busy || !aiText.trim()} onClick={importAi}>匯入</button>
                <details><summary className="tbtn">看提示內容</summary><pre className="code" style={{ maxHeight: 220, whiteSpace: "pre-wrap" }}>{prompt()}</pre></details></div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
