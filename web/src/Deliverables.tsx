import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Doc, Element, Me, Meta, View } from "./api.ts";
import { label, listOf, wrap } from "./model.ts";
import { methodZh } from "./Inspector.tsx";
import { RiskGrid } from "./Dashboard.tsx";
import { DataTable } from "./pages/tables/DataTable.tsx";
import type { Col } from "./pages/tables/DataTable.tsx";
import { LAYERS, layerOf } from "./pages/tables/layers.ts";

const bookOf = (v: View) => ({ id: v.project.id, ok: v.analysis.ok });

const REQ = ["MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP"];
const when = (s: string) => new Date(s).toLocaleDateString("zh-TW");

/** 表格頁與專案管理頁共用的參數。 */
export interface Props { view: View; meta: Meta; user: Me; selectedId: string | null; onSelect: (id: string) => void; onChanged: (v: View) => void }

// 原「產出物」頁的各份文件：需求矩陣、FMEA、推導鏈、來源文件放在表格頁；里程碑路徑放在專案管理頁。

function SourceCell({ e, docs }: { e: Element; docs: Doc[] }) {
  if (!e.attrs.sourceDoc) return <span className="faint">—</span>;
  const d = docs.find((x) => x.id === e.attrs.sourceDoc);
  const text = `${e.attrs.sourceDoc}${e.attrs.sourceRef ? ` §${e.attrs.sourceRef}` : ""}`;
  return d?.url ? <a href={d.url} target="_blank" rel="noreferrer noopener" title={d.title} onClick={(ev) => ev.stopPropagation()}>{text}</a> : <span title={d?.title}>{text}</span>;
}

export function ReqMatrix({ view, meta, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const sat = new Map(a.satisfaction.map((s) => [s.requirement, s.status]));
  const outs = (e: Element, ...k: string[]) => a.relations.filter((r) => r.from === e.id && k.includes(r.kind)).map((r) => byId.get(r.to)).filter((x): x is Element => !!x);
  const ins = (e: Element, ...k: string[]) => a.relations.filter((r) => r.to === e.id && k.includes(r.kind)).map((r) => byId.get(r.from)).filter((x): x is Element => !!x);
  const all = listOf(a.elements, ...REQ);
  const noUp = (e: Element) => outs(e, "derive", "refine", "trace").length === 0 && !e.attrs.sourceDoc;
  const noSat = (e: Element) => ins(e, "satisfy").length === 0;
  const noVer = (e: Element) => ins(e, "verify").length === 0;
  const verdict = (e: Element) => sat.get(e.qualifiedName);
  const miss = <span className="tag danger">MISS</span>;
  const list = (xs: Element[]) => (xs.length ? xs.map((x) => <div key={x.id}>{label(x)}</div>) : miss);
  const names = (xs: Element[]) => (xs.length ? xs.map(label).join("、") : "MISS");
  const cols: Col<Element>[] = [
    { key: "id", title: "編號", text: (e) => e.shortName ?? "", cls: "id" },
    { key: "level", title: "層級", text: (e) => meta.categories.find((c) => c.id === e.category)?.zh.replace("層需求", "") ?? "", cls: "id" },
    { key: "name", title: "需求", text: (e) => e.name, render: (e) => <><div>{e.name}</div><div className="caption">{e.doc}</div></> },
    { key: "doc", title: "內容", text: (e) => e.doc, hidden: true },
    { key: "source", title: "出處", text: (e) => (e.attrs.sourceDoc ? `${e.attrs.sourceDoc}${e.attrs.sourceRef ? ` §${e.attrs.sourceRef}` : ""}` : ""), render: (e) => <SourceCell e={e} docs={view.docs} />, cls: "id" },
    { key: "up", title: "上層", text: (e) => (noUp(e) ? "MISS" : outs(e, "derive", "refine", "trace").map(label).join("、") || "見出處"), render: (e) => (outs(e, "derive", "refine", "trace").length ? outs(e, "derive", "refine", "trace").map((x) => <div key={x.id}>{label(x)}</div>) : e.attrs.sourceDoc ? <span className="faint">見出處</span> : miss) },
    { key: "sat", title: "滿足者", text: (e) => names(ins(e, "satisfy")), render: (e) => list(ins(e, "satisfy")) },
    { key: "ver", title: "驗證", text: (e) => (noVer(e) ? "MISS" : ins(e, "verify").map((x) => `${label(x)}${x.attrs.kind ? `　${methodZh(x.attrs.kind)}` : ""}`).join("、")), render: (e) => (ins(e, "verify").length ? ins(e, "verify").map((x) => <div key={x.id}>{label(x)}{x.attrs.kind && <span className="faint">　{methodZh(x.attrs.kind)}</span>}</div>) : miss) },
    { key: "verdict", title: "判定", text: (e) => (verdict(e) === "holds" ? "PASS" : verdict(e) === "fails" ? "FAIL" : ""), render: (e) => (verdict(e) === "holds" ? <span className="tag done">PASS</span> : verdict(e) === "fails" ? <span className="tag danger">FAIL</span> : <span className="faint">—</span>) },
  ];
  return (
    <DataTable name="需求矩陣" title="需求矩陣" book={bookOf(view)} rows={all} cols={cols} rowId={(e) => e.id} selectedId={selectedId} onSelect={(e) => onSelect(e.id)}
      hint="每條需求要有出處或上層、滿足者與驗證。標 MISS 的是還沒補上的；點一列，右側顯示屬性。"
      chips={[
        { id: "noVer", label: "缺驗證", test: noVer }, { id: "noSat", label: "缺滿足者", test: noSat }, { id: "noUp", label: "缺上層", test: noUp },
        { id: "fail", label: "FAIL", test: (e) => verdict(e) === "fails" }, { id: "pass", label: "PASS", test: (e) => verdict(e) === "holds" },
      ]}
      filters={[{ id: "level", label: "層級", options: REQ.map((c) => [c, meta.categories.find((x) => x.id === c)?.zh ?? c]), test: (e, v) => e.category === v }]}
      empty="還沒有需求。到「模型」頁新增。" />
  );
}

export function Fmea({ view, selectedId, onSelect }: Props) {
  const [residual, setResidual] = useState(false);
  const [pick, setPick] = useState<string[] | null>(null);
  const risks = listOf(view.analysis.elements, "Risk");
  const n = (e: Element, k: string) => Number(e.attrs[k]) || 0;
  const score = (e: Element) => n(e, "severity") * n(e, "likelihood");
  const after = (e: Element) => n(e, "residualSeverity") * n(e, "residualLikelihood");
  const layerById = new Map(risks.map((e) => [e.id, layerOf(e, view.analysis)]));
  const layerZh = (e: Element) => LAYERS.find(([id]) => id === layerById.get(e.id)?.layer)?.[1] ?? "未分層";
  const sorted = [...risks].sort((x, y) => score(y) - score(x));
  const pre = useCallback((e: Element) => !pick || pick.includes(e.id), [pick]);
  const tag = (v: number) => (v >= 15 ? <span className="tag danger">{v}</span> : v >= 8 ? <span className="tag warn">{v}</span> : v > 0 ? <span className="tag">{v}</span> : <span className="faint">—</span>);
  const dash = (v: number) => (v ? String(v) : "");
  const cols: Col<Element>[] = [
    { key: "id", title: "編號", text: (e) => e.shortName ?? "", cls: "id" },
    { key: "layer", title: "層級", text: layerZh, render: (e) => <span title={layerById.get(e.id)?.how ? `由${layerById.get(e.id)?.how}推出` : "沒有標記也沒連到元素"}>{layerZh(e)}</span> },
    { key: "mode", title: "失效模式", text: (e) => e.attrs.failureMode || e.name },
    { key: "effect", title: "影響", text: (e) => e.attrs.effect ?? "" },
    { key: "cause", title: "原因", text: (e) => e.attrs.cause ?? "" },
    { key: "s", title: "S", text: (e) => dash(n(e, "severity")), cls: "id" },
    { key: "o", title: "O", text: (e) => dash(n(e, "likelihood")), cls: "id" },
    { key: "d", title: "D", text: (e) => dash(n(e, "detection")), cls: "id" },
    { key: "score", title: "風險值", text: (e) => dash(score(e)).padStart(3, "0"), render: (e) => tag(score(e)) },
    { key: "rpn", title: "RPN", text: (e) => dash(score(e) * n(e, "detection")).padStart(4, "0"), render: (e) => <>{score(e) * n(e, "detection") || "—"}</>, cls: "id" },
    { key: "mit", title: "緩解措施", text: (e) => e.attrs.mitigation ?? "MISS", render: (e) => <>{e.attrs.mitigation || <span className="tag danger">MISS</span>}</> },
    { key: "after", title: "緩解後", text: (e) => dash(after(e)).padStart(3, "0"), render: (e) => tag(after(e)) },
    { key: "owner", title: "負責人", text: (e) => e.attrs.owner ?? "" },
    { key: "status", title: "狀態", text: (e) => e.attrs.status || "開啟" },
  ];
  const grid = (
    <div className="fmea-top">
      <div>
        <nav className="seg no-print" role="tablist" style={{ gap: 16 }}>
          <button role="tab" aria-selected={!residual} onClick={() => setResidual(false)}>緩解前</button>
          <button role="tab" aria-selected={residual} onClick={() => setResidual(true)}>緩解後</button>
        </nav>
        <RiskGrid risks={risks} residual={residual} size={46} onPick={(ids) => setPick(ids)} />
        <p className="caption">橫軸　嚴重度 1–5　　縱軸　可能性 1–5</p>
      </div>
      <div className="stack">
        <p className="body muted">格子裡的數字是落在該處的風險件數，點格子只看那幾項。風險值＝嚴重度 × 可能性：15 以上為高，8 到 14 為中。</p>
        <p className="caption">RPN＝嚴重度 × 可能性 × 偵測度。偵測度越高代表越難在出事前發現。</p>
        {pick && <div><button className="tbtn primary" onClick={() => setPick(null)}>顯示全部</button></div>}
      </div>
    </div>
  );
  return (
    <DataTable name="FMEA" title="FMEA 風險矩陣" book={bookOf(view)} rows={sorted} cols={cols} rowId={(e) => e.id} selectedId={selectedId} onSelect={(e) => onSelect(e.id)} above={grid} preFilter={pre}
      hint="全專案一張，用「篩選」的層級看任務、系統、次系統、元件各自的風險。層級優先取風險上的 @LayerTag；沒有就由風險連到的元素推出（連到多個時取最低層），都沒有歸「未分層」。"
      filters={[{ id: "layer", label: "層級", options: [...LAYERS.map(([id, zh]): [string, string] => [id, `${zh}（${risks.filter((e) => layerById.get(e.id)?.layer === id).length}）`]), ["none", `未分層（${risks.filter((e) => !layerById.get(e.id)?.layer).length}）`]], test: (e, v) => (layerById.get(e.id)?.layer || "none") === v }]}
      chips={[
        { id: "high", label: "高（15 以上）", test: (e) => score(e) >= 15 }, { id: "mid", label: "中（8–14）", test: (e) => score(e) >= 8 && score(e) < 15 },
        { id: "noMit", label: "缺緩解", test: (e) => !e.attrs.mitigation }, { id: "open", label: "未結", test: (e) => (e.attrs.status || "開啟") !== "已結" },
      ]}
      empty="還沒有風險。到模型頁左欄「風險與安全」新增。" />
  );
}

/** 推導鏈：從利害關係人一路到驗證，每一欄是一個層次，線是追溯關係。 */
export function Chain({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const cols: { zh: string; items: Element[] }[] = [
    { zh: "利害關係人與期望", items: listOf(a.elements, "Stakeholder", "Expectation") },
    { zh: "需要與目標", items: listOf(a.elements, "Need", "Goal") },
    { zh: "目的與量度", items: listOf(a.elements, "Objective", "MOE") },
    { zh: "系統需求", items: listOf(a.elements, "SystemRequirement") },
    { zh: "次系統與元件需求", items: listOf(a.elements, "SubsystemRequirement", "ComponentRequirement", "MOP") },
  ];
  const reqIds = new Set(cols.flatMap((c) => c.items.map((e) => e.id)));
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const design = [...new Set(a.relations.filter((r) => r.kind === "satisfy" && reqIds.has(r.to)).map((r) => r.from))].map((i) => byId.get(i)).filter((e): e is Element => !!e);
  cols.push({ zh: "設計", items: design }, { zh: "驗證", items: listOf(a.elements, "VerificationEvent", "ValidationEvent") });
  const cw = 168, gap = 46, rh = 44, top = 30;
  const pos = new Map<string, { x: number; y: number; c: number }>();
  cols.forEach((c, ci) => c.items.forEach((e, ri) => pos.set(e.id, { x: ci * (cw + gap), y: top + ri * rh, c: ci })));
  const rowsMax = Math.max(1, ...cols.map((c) => c.items.length));
  const W = cols.length * (cw + gap) - gap, H = top + rowsMax * rh;
  const links = a.relations.filter((r) => ["derive", "refine", "trace", "satisfy", "verify"].includes(r.kind) && pos.has(r.from) && pos.has(r.to) && pos.get(r.from)?.c !== pos.get(r.to)?.c);
  const total = cols.reduce((s, c) => s + c.items.length, 0);
  if (total === 0) return <p className="body">還沒有內容可以畫推導鏈。</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: "none", display: "block" }} role="img" aria-label={`推導鏈：${cols.map((c) => `${c.zh} ${c.items.length} 項`).join("，")}，共 ${links.length} 條追溯。`}>
        {cols.map((c, ci) => <text key={ci} x={ci * (cw + gap)} y={12} fontSize="10" letterSpacing="1" fill="var(--ink-faint)">{c.zh}　{c.items.length}</text>)}
        {links.map((r, i) => {
          const p = pos.get(r.from) as { x: number; y: number; c: number }, q = pos.get(r.to) as { x: number; y: number; c: number };
          const [l, rr] = p.c < q.c ? [p, q] : [q, p];
          const x1 = l.x + cw, y1 = l.y + 17, x2 = rr.x, y2 = rr.y + 17, mx = (x1 + x2) / 2;
          return <path key={i} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} fill="none" stroke="var(--ink)" strokeWidth={r.from === selectedId || r.to === selectedId ? 2 : 1} strokeDasharray={r.kind === "satisfy" || r.kind === "verify" ? undefined : "4 3"} opacity={selectedId && r.from !== selectedId && r.to !== selectedId ? 0.3 : 0.9} />;
        })}
        {cols.flatMap((c) => c.items).map((e) => {
          const p = pos.get(e.id) as { x: number; y: number };
          const sel = e.id === selectedId;
          return (
            <g key={e.id} onClick={() => onSelect(e.id)} style={{ cursor: "pointer" }} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onSelect(e.id); }} role="button" aria-label={label(e)}>
              <rect x={p.x + 0.5} y={p.y + 0.5} width={cw - 1} height={34} fill="var(--bg)" stroke={sel ? "var(--ink)" : "var(--line-strong)"} strokeWidth={sel ? 2 : 1} />
              <text x={p.x + 8} y={p.y + 14} fontSize="9.5" letterSpacing="0.5" fill="var(--ink-faint)">{e.shortName ?? ""}</text>
              <text x={p.x + 8} y={p.y + 28} fontSize="12" fill="var(--ink)" fontFamily="var(--font-sans)">{wrap(e.name, 24, 1)[0]}</text>
            </g>
          );
        })}
      </svg>
      <p className="caption" style={{ marginTop: 8 }}>虛線　衍生、細化、追溯　　實線　滿足、驗證　　點任一項會突顯它的來龍去脈</p>
    </div>
  );
}

export function Milestones(p: Props) {
  const { view, user, onChanged } = p;
  const [error, setError] = useState("");
  const setDate = async (gate: string, date: string) => {
    setError("");
    try { onChanged(await api<View>(`/projects/${view.project.id}/milestones`, "POST", { gate, date })); } catch (e) { setError((e as Error).message); }
  };
  const last = (g: string) => [...view.project.signoffs].reverse().find((s) => s.gate === g && !s.subsystem);
  const today = new Date().toISOString().slice(0, 10);
  const firstOpen = view.gates.find((g) => last(g.id)?.decision !== "APPROVE")?.id;
  return (
    <>
      <section className="section">
        <div className="section-head"><h1 className="section-title">里程碑路徑</h1><span className="label">{view.gates.filter((g) => last(g.id)?.decision === "APPROVE").length} / {view.gates.length}</span></div>
        {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
        <div className="path-track">
          {view.gates.map((g) => {
            const so = last(g.id), ok = so?.decision === "APPROVE", plan = view.milestones[g.id] ?? "";
            const late = !ok && plan && plan < today;
            return (
              <div key={g.id} className={`path-step ${ok ? "ok" : ""} ${g.id === firstOpen ? "cur" : ""}`}>
                <span className="path-dot" aria-hidden="true" />
                <span className="heading">{g.zh}</span>
                <span className="label">{g.en}</span>
                <span className="meter"><span style={{ width: `${ok ? 100 : g.total ? (g.done / g.total) * 100 : 0}%` }} /></span>
                <span className="caption">{g.done} / {g.total} 項</span>
                <span>{ok ? <span className="tag done">DONE</span> : late ? <span className="tag danger">LATE</span> : g.id === firstOpen ? <span className="tag">進行中</span> : <span className="faint">—</span>}</span>
                {user.caps.confirm
                  ? <label className="field" style={{ margin: 0 }}><span className="label">預定</span><input className="input" style={{ height: 28, fontSize: 13 }} type="date" value={plan} onChange={(e) => setDate(g.id, e.target.value)} /></label>
                  : <span className="caption">預定　{plan || g.deadline || "—"}</span>}
                <span className="caption">{so && ok ? `核可　${when(so.at)}　${so.by}` : g.deadline ? `AEAS 期限　${g.deadline}` : ""}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

const blank: Doc = { id: "", title: "", type: "規則", revision: "", url: "", note: "" };
export function Docs({ view, user, onChanged }: Props) {
  const id = view.project.id;
  const [form, setForm] = useState<Doc>(blank);
  const [error, setError] = useState("");
  const used = (d: Doc) => view.analysis.elements.filter((e) => e.attrs.sourceDoc === d.id).length;
  const reload = async () => onChanged(await api<View>(`/projects/${id}`));
  const save = async (ev: FormEvent) => {
    ev.preventDefault(); setError("");
    try { await api(`/projects/${id}/pm/docs`, "POST", { ...form }); setForm(blank); await reload(); } catch (e) { setError((e as Error).message); }
  };
  const del = async (d: Doc) => { setError(""); try { await api(`/projects/${id}/pm/docs/delete`, "POST", { id: d.id }); setForm(blank); await reload(); } catch (e) { setError((e as Error).message); } };
  const docCols: Col<Doc>[] = [
    { key: "id", title: "編號", text: (d) => d.id, cls: "id" },
    { key: "title", title: "名稱", text: (d) => `${d.title} ${d.note}`, render: (d) => <>{d.title}<div className="caption">{d.note}</div></> },
    { key: "type", title: "類型", text: (d) => d.type },
    { key: "rev", title: "版次", text: (d) => d.revision, cls: "id" },
    { key: "url", title: "連結", text: (d) => d.url, render: (d) => (d.url ? <a href={d.url} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>開啟</a> : <span className="faint">—</span>) },
    { key: "used", title: "被引用", text: (d) => String(used(d)).padStart(4, "0"), render: (d) => <>{used(d)} 項</>, cls: "id" },
  ];
  return (
    <section className="section">
      <p className="body muted" style={{ marginBottom: 12 }}>需求書、競賽規則、標準等。這裡只記連結，檔案本身放在 Google Drive。登記後，每個項目都可以在右側欄標註出處。</p>
      {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
      <DataTable name="來源文件" title="來源文件" book={bookOf(view)} rows={view.docs} cols={docCols} rowId={(d) => d.id} selectedId={form.id} onSelect={(d) => user.caps.edit && setForm(d)} empty="還沒有登記文件。" />
      {user.caps.edit && (
        <form onSubmit={save} className="no-print">
          <div className="row">
            <label className="field" style={{ flex: 2 }}><span className="label">{form.id ? `修改 ${form.id}` : "登記文件"}</span><input className="input" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="2027 台灣盃火箭競賽規則" /></label>
            <label className="field"><span className="label">類型</span><select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{["需求書", "規則", "標準", "會議紀錄", "報告", "其他"].map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field"><span className="label">版次</span><input className="input" value={form.revision} onChange={(e) => setForm({ ...form, revision: e.target.value })} /></label>
          </div>
          <div className="row">
            <label className="field" style={{ flex: 2 }}><span className="label">連結（https://）</span><input className="input" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://drive.google.com/…" /></label>
            <label className="field"><span className="label">備註</span><input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          </div>
          <div className="tbtn-row"><button className="tbtn primary">{form.id ? "更新" : "登記"}</button>
            {form.id && <><button type="button" className="tbtn" onClick={() => setForm(blank)}>取消</button><button type="button" className="tbtn" disabled={used(form) > 0} title={used(form) > 0 ? "還有項目引用它" : ""} onClick={() => del(form)}>刪除</button></>}</div>
        </form>
      )}
    </section>
  );
}
