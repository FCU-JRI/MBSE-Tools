// 流程頁（PROC-01、PROC-02）：照框架檔（framework/jri.json）的 7 層顯示。每層＝需求進來 → 設計迴圈 → 產出設計限制 → 推導下一層需求。
// 每一步固定「要做什麼／怎麼做／還缺」；進度、卡點、兩個來源都由伺服器從模型證據算出（view.framework），網頁不另外判斷。
import { useEffect, useState } from "react";
import type { Me, Meta, View } from "./api.ts";
import type { Page } from "./workspace.ts";

/** 伺服器 server/framework.ts 的 FrameworkEval（只列網頁用到的欄位） */
export interface FwIssue { id: string | null; text: string }
export interface FwStep {
  id: string; zh: string; where: string | null; owner: string | null; ownerZh: string; produces: string[]; gate: string | null;
  decision: boolean; holdPoint: boolean; check: string | null; checkZh: string; done: boolean | null; state: "done" | "current" | "todo" | "pending"; issues: FwIssue[]; onNo: string | null;
}
export interface FwObject { id: string | null; name: string; steps: FwStep[]; current: string | null; passed: boolean }
export interface FwLayer { id: string; order: number; zh: string; kind: "chain" | "loop"; subject: string; gate: string | null; outputsZh: string; steps: FwStep[]; before: FwStep[]; objects: FwObject[]; after: FwStep[]; passed: boolean }
export interface FwEval {
  name: string; version: number; layers: FwLayer[];
  settings: { fmeaThreshold: number; minAlternatives: number; budgetMargin: number | null; enforceHoldPoint: boolean };
  twoSources: { id: string; name: string; category: string; missing: string[]; text: string }[];
  holdPoints: { category: string; zh: string; fromLayer: string; fromLayerZh: string; open: boolean; reason: string }[];
  approval: { ok: boolean; detail: string };
}
export const fwOf = (v: View) => (v as View & { framework?: FwEval | null }).framework ?? null;

interface Props {
  view: View; meta: Meta; user: Me;
  onOpen: (elementId: string) => void;
  /** 到模型頁打開某類別的新增表單 */
  onNew: (category: string) => void;
  go: (page: Page) => void;
}

const WHERE: Record<string, { zh: string; page: Page | null }> = {
  model: { zh: "模型頁", page: "model" }, tables: { zh: "表格頁", page: "tables" }, analysis: { zh: "分析頁", page: "analysis" },
  manage: { zh: "專案管理頁", page: "manage" }, auto: { zh: "工具自動判定", page: null },
};

const mark = (s: { state: string; done: boolean | null }) => (s.done === true ? "✓" : s.state === "pending" ? "…" : s.state === "current" ? "●" : "");
const stateClass = (s: FwStep) => (s.done === true ? "done" : s.state === "current" ? "current" : "locked");

export function FrameworkView(p: Props) {
  const fw = fwOf(p.view);
  const firstOpen = fw?.layers.find((l) => !l.passed)?.id ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(firstOpen ? [firstOpen] : []));
  useEffect(() => { if (firstOpen) setOpen((o) => new Set([...o, firstOpen])); }, [firstOpen]);
  if (!fw) return <p className="body">模型有錯誤，請先到模型頁的「原始碼」修正。</p>;
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const passed = fw.layers.filter((l) => l.passed).length;
  const closed = fw.holdPoints.filter((h) => !h.open);

  return (
    <section className="guide" aria-label="流程" data-fw-version={fw.version}>
      <div className="guide-head">
        <h1 className="heading">流程</h1>
        <span className="label">{fw.name} · {fw.layers.length} 層 · 走完 <span className="data">{passed}</span> 層</span>
        <span className="grow" />
        <button className="tbtn" onClick={() => setOpen(open.size === fw.layers.length ? new Set(firstOpen ? [firstOpen] : []) : new Set(fw.layers.map((l) => l.id)))}>{open.size === fw.layers.length ? "收起" : "全部展開"}</button>
      </div>
      <p className="caption">需求與設計交替：每一層的設計迴圈沒走到「是否符合需求＝是」，不能推導下一層需求（卡點）。下一層需求要同時連到上一層需求（衍生自）與上一層的設計產出（#basis）。
        {fw.settings.enforceHoldPoint ? "本專案在伺服器強制卡點。" : "本專案沒有強制卡點（專案管理頁 › 專案設定可打開），下面仍會標出。"}</p>

      {closed.length > 0 && (
        <div className="section" data-fw="holdpoints">
          <div className="section-head"><h2 className="section-title">卡點</h2><span className="label">{closed.length}</span></div>
          <ul className="guide-missing">{closed.map((h) => <li key={h.category}><span className="body"><b>還不能新增{h.zh}</b>　{h.reason}</span></li>)}</ul>
        </div>
      )}
      {fw.twoSources.length > 0 && (
        <div className="section" data-fw="twosources">
          <div className="section-head"><h2 className="section-title">兩個來源不齊</h2><span className="label">{fw.twoSources.length}</span></div>
          <ul className="guide-missing">{fw.twoSources.map((t) => (
            <li key={t.id}><span className="body">{t.name}：{t.text}</span><button className="tbtn" onClick={() => p.onOpen(t.id)}>開啟</button></li>
          ))}</ul>
        </div>
      )}

      <ol className="guide-list">
        {fw.layers.map((l) => (
          <li key={l.id} id={`fw-${l.id}`} className={`guide-step ${l.passed ? "done" : l.id === firstOpen ? "current" : "locked"}`} data-layer={l.id}>
            <button className="guide-row" aria-expanded={open.has(l.id)} onClick={() => toggle(l.id)}>
              <span className="guide-mark" aria-hidden="true">{l.passed ? "✓" : l.order}</span>
              <span className="guide-name">{l.zh}</span>
              <span className="caption">{l.kind === "loop" ? "設計迴圈" : "依序"}{l.gate ? ` · 節點 ${l.gate.toUpperCase()}` : ""}</span>
              <span className="grow" />
              {l.kind === "loop" && <span className="caption">{l.objects.filter((o) => o.passed).length}／{l.objects.length} 個走完</span>}
              {!l.passed && l.id === firstOpen && <span className="tag">進行中</span>}
              <span className="guide-tw" aria-hidden="true">{open.has(l.id) ? "−" : "+"}</span>
            </button>
            {open.has(l.id) && <LayerBody {...p} layer={l} fw={fw} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

function LayerBody(p: Props & { layer: FwLayer; fw: FwEval }) {
  const l = p.layer;
  const out = p.fw.holdPoints.filter((h) => h.fromLayer === l.id);
  return (
    <div className="guide-body enter">
      {l.kind === "chain" ? <StepList {...p} steps={l.steps} /> : (<>
        {l.before.length > 0 && <><h2 className="label">需求進來</h2><StepList {...p} steps={l.before} /></>}
        <h2 className="label">設計迴圈{l.subject !== "mission" ? `（每個${p.meta.categories.find((c) => c.id === l.subject)?.zh ?? l.subject}各跑一次）` : ""}</h2>
        {l.objects.length === 0
          ? <p className="body muted">還沒有{p.meta.categories.find((c) => c.id === l.subject)?.zh ?? "對象"}。先完成上面的步驟，設計迴圈才會開始。</p>
          : l.objects.map((o) => <ObjectLoop key={o.id ?? "mission"} {...p} obj={o} />)}
        {l.outputsZh && <p className="caption">迴圈產出：{l.outputsZh}</p>}
        {out.map((h) => <p key={h.category} className="body" data-hold={h.category}>{h.open ? <span className="tag done">OPEN</span> : <span className="tag danger">HOLD</span>}　下一層「{h.zh}」{h.open ? "可以推導" : "還不能推導"}：{h.reason}</p>)}
        {l.after.length > 0 && <><h2 className="label">迴圈之後</h2><StepList {...p} steps={l.after} /></>}
      </>)}
    </div>
  );
}

function ObjectLoop(p: Props & { obj: FwObject }) {
  const o = p.obj;
  const [open, setOpen] = useState(!o.passed);
  const cur = o.steps.find((s) => s.id === o.current);
  return (
    <div className="section" data-object={o.name}>
      <button className="guide-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="body"><b>{o.name}</b></span>
        <span className="caption">{o.steps.map((s) => `${mark(s) || "○"}${s.zh}`).join(" → ")}</span>
        <span className="grow" />
        {o.passed ? <span className="tag done">走完</span> : <span className="tag" data-current={o.current ?? ""}>目前：{cur?.zh ?? "—"}</span>}
      </button>
      {open && <StepList {...p} steps={o.steps} />}
    </div>
  );
}

function StepList(p: Props & { steps: FwStep[] }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(p.steps.filter((s) => s.state === "current").map((s) => s.id)));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <ol className="guide-list">
      {p.steps.map((s, i) => (
        <li key={s.id} className={`guide-step ${stateClass(s)}`} data-step={s.id} data-state={s.state}>
          <button className="guide-row" aria-expanded={open.has(s.id)} onClick={() => toggle(s.id)}>
            <span className="guide-mark" aria-hidden="true">{mark(s) || i + 1}</span>
            <span className="guide-name">{s.zh}</span>
            {s.decision && <span className="caption">判斷</span>}
            {s.holdPoint && <span className="caption">卡點</span>}
            <span className="grow" />
            {s.ownerZh && <span className="caption">{s.ownerZh}</span>}
            {s.state === "current" ? <span className="tag">進行中</span> : s.state === "pending" ? <span className="caption">待接</span> : null}
            <span className="guide-tw" aria-hidden="true">{open.has(s.id) ? "−" : "+"}</span>
          </button>
          {open.has(s.id) && <StepBody {...p} step={s} />}
        </li>
      ))}
    </ol>
  );
}

function StepBody(p: Props & { step: FwStep; steps: FwStep[] }) {
  const s = p.step;
  const where = s.where ? WHERE[s.where] : null;
  const cat = (id: string) => p.meta.categories.find((c) => c.id === id);
  const creatable = s.produces.filter((c) => cat(c) && !cat(c)?.special);
  const back = s.onNo ? p.steps.find((x) => x.id === s.onNo)?.zh ?? s.onNo : null;
  return (
    <div className="guide-body enter">
      <div className="guide-part">
        <h2 className="label">要做什麼</h2>
        <p className="body guide-todo">{s.gate ? `通過審查節點 ${s.gate.toUpperCase()}。` : s.checkZh || s.zh}</p>
      </div>
      <div className="guide-part">
        <h2 className="label">怎麼做</h2>
        <ol className="guide-how">
          {s.gate && <li className="body">到專案管理頁的審查節點卡，看檢查清單並送審。</li>}
          {!s.gate && where && s.where !== "auto" && <li className="body">在{where.zh}{creatable.length ? `新增「${creatable.map((c) => cat(c)?.zh ?? c).join("、")}」` : "完成這一步"}{s.produces.includes("DesignAlternative") ? "，用「追溯」連到它要滿足的需求" : ""}{s.produces.includes("Risk") ? "，填嚴重度、可能性與緩解措施，並追溯到設計方案或對象" : ""}。</li>}
          {s.where === "auto" && <li className="body">工具依模型自動判定，不用手動勾選。{s.decision && back ? `答否時回到「${back}」修改。` : ""}</li>}
          {s.ownerZh && <li className="body">負責：{s.ownerZh}（專案設定可改）。</li>}
        </ol>
        <div className="tbtn-row guide-actions">
          {creatable.slice(0, 3).map((c) => <button key={c} className="btn" disabled={!p.user.caps.edit} onClick={() => p.onNew(c)}>到模型頁新增{cat(c)?.zh} →</button>)}
          {where?.page && where.page !== "model" && <button className="tbtn" onClick={() => p.go(where.page as Page)}>到{where.zh} →</button>}
          {s.gate && <button className="tbtn" onClick={() => p.go("manage")}>到專案管理頁 →</button>}
        </div>
      </div>
      <div className="guide-part">
        <h2 className="label">還缺</h2>
        {s.done === true ? <p className="body muted">沒有，這一步完成了。</p>
          : s.issues.length === 0 ? <p className="body muted">{s.gate ? "等節點核可。" : s.state === "pending" ? "待接：工具還沒有這項檢查，先人工確認。" : "前面的步驟完成後再看。"}</p>
          : <ul className="guide-missing">{s.issues.map((it, i) => (
              <li key={i}><span className="body">{it.text}</span>{it.id && <button className="tbtn" onClick={() => p.onOpen(it.id as string)}>開啟</button>}</li>
            ))}</ul>}
      </div>
    </div>
  );
}
