import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Element, Me, Meta, Step, View } from "./api.ts";
import { label, listOf } from "./model.ts";

const METHODS: [string, string][] = [["byTest", "測試"], ["byAnalysis", "分析"], ["byInspection", "檢查"], ["byDemonstration", "展示"]];
const REL_ZH: Record<string, string> = { trace: "追溯到", derive: "衍生自", refine: "細化", allocate: "分配給", compose: "屬於", verify: "驗證" };

interface Props { view: View; meta: Meta; user: Me; onChanged: (v: View) => void; onOpen: (elementId: string, category: string | null) => void }

/** 流程：依 NASA-HDBK-1009A 的順序，一步一個問題，帶著使用者從利害關係人往下建立模型。 */
export function ProcessView({ view, meta, user, onChanged, onOpen }: Props) {
  const steps = view.process;
  const current = steps.find((s) => s.state === "current");
  const [stepId, setStepId] = useState(current?.id ?? steps[0]?.id ?? "");
  // 完成一步後自動前進到下一步
  useEffect(() => { if (current && steps.find((s) => s.id === stepId)?.state === "done" && stepId === prevOf(steps, current.id)) setStepId(current.id); }, [current, stepId, steps]);
  const step = steps.find((s) => s.id === stepId) ?? steps[0];
  if (!step) return <p className="body">模型有錯誤，請先到「原始碼」修正。</p>;
  const done = steps.filter((s) => s.state === "done").length;
  const guided = view.project.template === "guided";

  return (
    <div className="proc">
      <ol className="proc-steps" aria-label="分析步驟">
        <li className="proc-head"><span className="label">分析流程 · NASA-HDBK-1009A</span><span className="data">{done} / {steps.length}</span></li>
        {steps.map((s, i) => (
          <li key={s.id}>
            <button className={`proc-step ${s.state}`} aria-current={s.id === step.id} onClick={() => setStepId(s.id)}>
              <span className="label">{String(i + 1).padStart(2, "0")}</span>
              <span className="tn">{s.zh}</span>
              {s.state === "done" ? <span className="tag done">DONE</span> : s.state === "current" ? <span className="tag">現在</span> : <span className="tc">{s.count || ""}</span>}
            </button>
          </li>
        ))}
      </ol>
      <StepPanel key={step.id} step={step} index={steps.indexOf(step)} steps={steps} guided={guided} view={view} meta={meta} user={user} onChanged={onChanged} onOpen={onOpen} goTo={setStepId} />
    </div>
  );
}

const prevOf = (steps: Step[], id: string) => steps[steps.findIndex((s) => s.id === id) - 1]?.id;

function StepPanel({ step, index, steps, guided, view, meta, user, onChanged, onOpen, goTo }: Props & { step: Step; index: number; steps: Step[]; guided: boolean; goTo: (id: string) => void }) {
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
  const [method, setMethod] = useState("byTest");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [aiText, setAiText] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  const items = listOf(els, ...step.categories).filter((e) => !e.shared);
  const targets = useMemo(() => (step.link ? listOf(els, ...step.link.to).filter((e) => step.link?.kind !== "compose" || e.kind === "PartDefinition") : []), [els, step.link]);
  const parents = step.parent ? listOf(els, step.parent).filter((e) => !e.shared) : [];
  const locked = guided && step.state === "locked";
  const blocker = steps.find((s) => s.state === "current");
  const canEdit = user.caps.edit && !locked;
  const next = steps[index + 1];
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
      ...(isVerify ? { verifies: target?.qualifiedName, method: input.method ?? "byTest" } : {}),
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
    setAiOpen(true);
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

  return (
    <section className="proc-panel enter" key={step.id}>
      <div>
        <p className="label">步驟 {String(index + 1).padStart(2, "0")} · {step.zh} · 手冊 {step.nasa}</p>
        <h1 className="proc-question">{step.question}</h1>
        <p className="body muted">{step.why}</p>
        <p className="caption" style={{ marginTop: 8 }}>例：{step.example}</p>
      </div>

      {locked && <p className="msg"><span className="tag">鎖定</span>要先完成第 {steps.indexOf(blocker as Step) + 1} 步「{blocker?.zh}」，才能開始這一步。<button className="tbtn primary" onClick={() => blocker && goTo(blocker.id)}>前往</button></p>}

      {!locked && step.state === "done" && (
        <p className="msg"><span className="tag done">DONE</span>這一步完成了。{next && <button className="tbtn primary" onClick={() => goTo(next.id)}>下一步：{next.zh}</button>}</p>
      )}

      {!locked && step.issues.length > 0 && (
        <div className="section">
          <div className="section-head"><h2 className="section-title">還缺</h2><span className="label">{step.issues.length}</span></div>
          {step.issues.map((it, i) => (
            <div className="rel" key={i}><span className="tag">TODO</span><span className="rn">{it.text}</span>
              {it.id && <button className="tbtn" onClick={() => onOpen(it.id as string, els.find((e) => e.id === it.id)?.category ?? null)}>開啟</button>}</div>
          ))}
        </div>
      )}

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

      {canEdit && cat && (
        <form className="section" onSubmit={submit}>
          <div className="section-head"><h2 className="section-title">加入</h2></div>
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
            <button type="button" className="tbtn primary" onClick={copy}>複製給 AI 的提示</button>
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
    </section>
  );
}
