import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Category, Element, Meta, View } from "./api.ts";
import { label, listOf, stereotype } from "./model.ts";
import type { GEdge } from "./model.ts";

export type Selection =
  | { type: "element"; id: string }
  | { type: "new"; category: string; parentId: string | null }
  | { type: "edge"; edge: GEdge };

const METHODS: Record<string, string> = { byTest: "測試", byAnalysis: "分析", byInspection: "檢查", byDemonstration: "展示" };
export const methodZh = (v: string | undefined) => METHODS[(v ?? "").replace("Method::", "")] ?? "";

interface Props { readOnly?: boolean; view: View; meta: Meta; sel: Selection; setSel: (s: Selection) => void; onChanged: (v: View) => void }

/** 右側欄：選到元素時編輯它，否則新增。整個畫面唯一的主要按鈕在這裡。 */
export function Inspector(p: Props) {
  if (!p.view.analysis.ok) return <div className="section"><div className="section-head"><h2 className="section-title">屬性</h2></div><p className="caption">模型有錯誤，修正後才能編輯。</p></div>;
  if (p.readOnly) {
    const sel = p.sel;
    const el = sel.type === "element" ? p.view.analysis.elements.find((e) => e.id === sel.id) : undefined;
    return <ReadPanel {...p} el={el} />;
  }
  if (p.sel.type === "edge") return <EdgePanel {...p} edge={p.sel.edge} />;
  if (p.sel.type === "element") {
    const sel = p.sel;
    const el = p.view.analysis.elements.find((e) => e.id === sel.id);
    if (el) return el.shared ? <ReadPanel {...p} el={el} /> : <EditPanel key={el.id} {...p} el={el} />;
  }
  const s = p.sel.type === "new" ? p.sel : { category: "SystemRequirement", parentId: null };
  return <NewPanel key={`${s.category}:${s.parentId}`} {...p} category={s.category} parentId={s.parentId} />;
}

/** 唯讀：只顯示內容與關係。 */
function ReadPanel({ view, meta, setSel, el }: Props & { el: Element | undefined }) {
  if (!el) return <div className="section"><div className="section-head"><h2 className="section-title">屬性</h2></div><p className="caption">點選圖或表中的項目查看內容。</p></div>;
  const cat = meta.categories.find((c) => c.id === el.category);
  const byId = new Map(view.analysis.elements.map((e) => [e.id, e]));
  const rels = view.analysis.relations.filter((r) => r.kind !== "succession" && r.kind !== "connect");
  const list = [
    ...rels.filter((r) => r.from === el.id).map((r) => ({ zh: meta.relations[r.kind]?.zh ?? r.kind, o: byId.get(r.to) })),
    ...rels.filter((r) => r.to === el.id).map((r) => ({ zh: `被${meta.relations[r.kind]?.zh ?? r.kind}`, o: byId.get(r.from) })),
  ].filter((x) => x.o);
  return (
    <>
      <div className="section">
        <div className="section-head"><h2 className="section-title">屬性</h2><span className="label">{cat?.zh ?? stereotype(el)}</span></div>
        {el.shared && <p className="caption" style={{ marginBottom: 12 }}>來自共用元件庫，專案內不能修改。可以在結構分解圖把它拉進自己的系統。</p>}
        <div className="field"><span className="label">編號</span><span className="data">{el.shortName ?? "—"}</span></div>
        <div className="field"><span className="label">名稱</span><span className="heading">{el.name}</span></div>
        {el.doc && <div className="field"><span className="label">{cat?.keyword === "requirement" ? "內容" : "說明"}</span><p className="body">{el.doc}</p></div>}
        {(cat?.fields ?? []).filter((f) => el.attrs[f.name]).map((f) => <div className="field" key={f.name}><span className="label">{f.zh}</span><span className="body">{el.attrs[f.name]}</span></div>)}
        {el.attrs.kind && <div className="field"><span className="label">驗證方法</span><span className="data">{methodZh(el.attrs.kind)}</span></div>}
      </div>
      <div className="section">
        <div className="section-head"><h2 className="section-title">關係</h2><span className="label">{list.length}</span></div>
        {list.map((x, i) => <div className="rel" key={i}><span className="label">{x.zh}</span>
          <button className="tbtn rn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13, justifyContent: "flex-start" }} onClick={() => setSel({ type: "element", id: (x.o as Element).id })}>{label(x.o as Element)}</button></div>)}
        {list.length === 0 && <p className="caption">沒有關係。</p>}
      </div>
    </>
  );
}

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p className="msg" role="status">{!m.ok && <span className="tag danger">ERR</span>}<span>{m.text}</span></p>;
}

/** 出處：選一份已登記的文件，再填章節。 */
function SourceFields({ view, doc, section, onChange }: { view: View; doc: string; section: string; onChange: (doc: string, ref: string) => void }) {
  if (view.docs.length === 0) return <p className="caption" style={{ marginBottom: 12 }}>到「產出物 → 來源文件」登記文件後，這裡可以標註出處。</p>;
  return (
    <div className="row">
      <label className="field" style={{ flex: 2 }}><span className="label">出處</span>
        <select className="input" value={doc} onChange={(e) => onChange(e.target.value, e.target.value ? section : "")}><option value="">無</option>{view.docs.map((d) => <option key={d.id} value={d.id}>{d.id} {d.title}</option>)}</select></label>
      <label className="field"><span className="label">章節</span><input className="input" value={section} disabled={!doc} onChange={(e) => onChange(doc, e.target.value)} placeholder="3.2" /></label>
    </div>
  );
}

function Fields({ cat, attrs, setAttrs }: { cat: Category | undefined; attrs: Record<string, string>; setAttrs: (a: Record<string, string>) => void }) {
  return <>{(cat?.fields ?? []).map((f) => (
    <label key={f.name} className="field"><span className="label">{f.zh}</span>
      <input className="input" value={attrs[f.name] ?? ""} inputMode={f.type === "text" ? "text" : "decimal"} onChange={(e) => setAttrs({ ...attrs, [f.name]: e.target.value })} />
    </label>
  ))}</>;
}

function NewPanel({ view, meta, setSel, onChanged, category, parentId }: Props & { category: string; parentId: string | null }) {
  const cat = meta.categories.find((c) => c.id === category) ?? meta.categories[0];
  const [name, setName] = useState("");
  const [doc, setDoc] = useState("");
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [src, setSrc] = useState({ doc: "", ref: "" });
  const [verifies, setVerifies] = useState("");
  const [method, setMethod] = useState("byTest");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isVer = cat.keyword === "verification";
  const reqs = listOf(view.analysis.elements, "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP");
  const parent = parentId ? view.analysis.elements.find((e) => e.id === parentId) : undefined;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const before = new Set(view.analysis.elements.map((e) => e.id));
      const v = await api<View>(`/projects/${view.project.id}/elements`, "POST", { category: cat.id, name, doc, attrs, source: src.doc ? src : undefined, parentId: parentId ?? undefined, ...(isVer ? { verifies: verifies || undefined, method } : {}) });
      onChanged(v);
      const created = v.analysis.elements.find((e) => !before.has(e.id) && e.name === name.trim());
      if (created) setSel({ type: "element", id: created.id });
      else { setMsg({ ok: true, text: `已新增「${name}」。` }); setName(""); setDoc(""); setAttrs({}); }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  };

  return (
    <form className="section" onSubmit={submit}>
      <div className="section-head"><h2 className="section-title">新增</h2></div>
      <label className="field"><span className="label">類別</span>
        <select className="input" value={cat.id} onChange={(e) => setSel({ type: "new", category: e.target.value, parentId: null })}>
          {Object.entries(meta.pillars).map(([pid, pzh]) => (
            <optgroup key={pid} label={pzh}>{meta.categories.filter((c) => c.pillar === pid).map((c) => <option key={c.id} value={c.id}>{c.zh} {c.en}</option>)}</optgroup>
          ))}
        </select>
      </label>
      <p className="body" style={{ marginBottom: 8 }}>{cat.help}</p>
      <p className="caption" style={{ marginBottom: 16 }}>例：{cat.example}</p>
      {parent && <p className="caption" style={{ marginBottom: 16 }}>會加在「{parent.name}」之內。</p>}
      <label className="field"><span className="label">名稱</span><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span className="label">{cat.keyword === "requirement" ? "內容（用「應」字，一條一件事）" : "說明"}</span>
        <textarea className="input" rows={3} value={doc} onChange={(e) => setDoc(e.target.value)} />
      </label>
      <Fields cat={cat} attrs={attrs} setAttrs={setAttrs} />
      <SourceFields view={view} doc={src.doc} section={src.ref} onChange={(d, r) => setSrc({ doc: d, ref: r })} />
      {isVer && <>
        <label className="field"><span className="label">要驗證的需求</span>
          <select className="input" value={verifies} onChange={(e) => setVerifies(e.target.value)}>
            <option value="">稍後再指定</option>{reqs.map((r) => <option key={r.id} value={r.qualifiedName}>{label(r)}</option>)}
          </select>
        </label>
        <label className="field"><span className="label">方法</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </label>
      </>}
      <Msg m={msg} />
      <div style={{ marginTop: 8 }}><button className="btn" disabled={busy}>{busy ? "寫入中" : "新增"}</button></div>
      <p className="caption" style={{ marginTop: 12 }}>編號自動產生（{cat.prefix}-001 起），並寫入版本紀錄。</p>
    </form>
  );
}

function EditPanel({ view, meta, setSel, onChanged, el }: Props & { el: Element }) {
  const cat = meta.categories.find((c) => c.id === el.category);
  const pid = view.project.id;
  const els = view.analysis.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const [name, setName] = useState(el.name);
  const [sn, setSn] = useState(el.shortName ?? "");
  const [src, setSrc] = useState({ doc: el.attrs.sourceDoc ?? "", ref: el.attrs.sourceRef ?? "" });
  const [doc, setDoc] = useState(el.doc);
  const [attrs, setAttrs] = useState<Record<string, string>>({ ...el.attrs });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [relKind, setRelKind] = useState("derive");
  const [relTo, setRelTo] = useState("");
  useEffect(() => { setName(el.name); setSn(el.shortName ?? ""); setSrc({ doc: el.attrs.sourceDoc ?? "", ref: el.attrs.sourceRef ?? "" }); setDoc(el.doc); setAttrs({ ...el.attrs }); }, [el]);

  const dirty = name.trim() !== el.name || sn.trim() !== (el.shortName ?? "") || src.doc !== (el.attrs.sourceDoc ?? "") || src.ref.trim() !== (el.attrs.sourceRef ?? "") || doc.trim() !== el.doc.trim() || (cat?.fields ?? []).some((f) => (attrs[f.name] ?? "").trim() !== (el.attrs[f.name] ?? "").trim());
  const call = async (fn: () => Promise<View & { selected?: string }>, done?: string) => {
    setBusy(true); setMsg(null);
    try { const v = await fn(); onChanged(v); if (v.selected) setSel({ type: "element", id: v.selected }); if (done) setMsg({ ok: true, text: done }); return true; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  };
  const save = (ev: FormEvent) => { ev.preventDefault(); call(() => api(`/projects/${pid}/elements`, "PATCH", { id: el.id, name, shortName: sn, doc, attrs, source: src }), "已寫入。"); };
  const remove = async () => { if (await call(() => api(`/projects/${pid}/elements/delete`, "POST", { id: el.id }))) setSel({ type: "new", category: el.category ?? "SystemRequirement", parentId: null }); };

  const rels = view.analysis.relations.filter((r) => r.kind !== "succession" && r.kind !== "connect");
  const out = rels.filter((r) => r.from === el.id).map((r) => ({ r, zh: meta.relations[r.kind]?.zh ?? r.kind, other: byId.get(r.to) }));
  const inn = rels.filter((r) => r.to === el.id).map((r) => ({ r, zh: `被${meta.relations[r.kind]?.zh ?? r.kind}`, other: byId.get(r.from) }));
  const targets = els.filter((e) => e.category && e.kind !== "ReferenceUsage" && e.id !== el.id);
  const sat = view.analysis.satisfaction.find((s) => s.requirement === el.qualifiedName);

  return (
    <>
      <form className="section" onSubmit={save}>
        <div className="section-head"><h2 className="section-title">屬性</h2><span className="label">{cat?.zh ?? stereotype(el)}</span></div>
        <label className="field"><span className="label">編號</span><input className="input" value={sn} onChange={(e) => setSn(e.target.value)} placeholder={cat ? `${cat.prefix}-001` : ""} spellCheck={false} /></label>
        <label className="field"><span className="label">名稱</span><input className="input" required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span className="label">{cat?.keyword === "requirement" ? "內容" : "說明"}</span>
          <textarea className="input" rows={4} value={doc} onChange={(e) => setDoc(e.target.value)} />
        </label>
        <Fields cat={cat} attrs={attrs} setAttrs={setAttrs} />
        <SourceFields view={view} doc={src.doc} section={src.ref} onChange={(d, r) => setSrc({ doc: d, ref: r })} />
        {el.attrs.kind && <div className="field"><span className="label">驗證方法</span><span className="data">{methodZh(el.attrs.kind)}</span></div>}
        {sat && <div className="field"><span className="label">計算判定</span><span>{sat.status === "holds" ? <span className="tag done">PASS</span> : sat.status === "fails" ? <span className="tag danger">FAIL</span> : <span className="tag">未判定</span>}</span></div>}
        <Msg m={msg} />
        <div className="tbtn-row" style={{ paddingLeft: 0, marginTop: 8 }}>
          <button className="btn" disabled={busy || !dirty}>{busy ? "寫入中" : "寫入"}</button>
          {confirmDelete
            ? <><button type="button" className="tbtn primary" onClick={remove}>確定刪除</button><button type="button" className="tbtn" onClick={() => setConfirmDelete(false)}>取消</button></>
            : <button type="button" className="tbtn" onClick={() => setConfirmDelete(true)}>刪除</button>}
        </div>
        {confirmDelete && <p className="caption" style={{ marginTop: 8 }}>會連同指向它的關係一起刪除。可從版本紀錄找回。</p>}
      </form>

      <div className="section">
        <div className="section-head"><h2 className="section-title">關係</h2><span className="label">{out.length + inn.length}</span></div>
        {[...out, ...inn].filter((x) => x.other).map((x, i) => (
          <div className="rel" key={i}>
            <span className="label">{x.zh}</span>
            <button className="tbtn rn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13, justifyContent: "flex-start" }} onClick={() => setSel({ type: "element", id: (x.other as Element).id })}>{label(x.other as Element)}</button>
            {x.r.kind !== "verify" && <button className="tbtn" onClick={() => call(() => api(`/projects/${pid}/relations/delete`, "POST", { kind: x.r.kind, from: x.r.from, to: x.r.to }))}>移除</button>}
          </div>
        ))}
        {out.length + inn.length === 0 && <p className="caption">還沒有關係。</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <label className="field" style={{ flex: "0 0 5.5rem", minWidth: 0 }}><span className="label">類型</span>
            <select className="input" value={relKind} onChange={(e) => setRelKind(e.target.value)}>{["derive", "refine", "trace", "satisfy", "allocate"].map((k) => <option key={k} value={k}>{meta.relations[k]?.zh}</option>)}</select>
          </label>
          <label className="field"><span className="label">對象</span>
            <select className="input" value={relTo} onChange={(e) => setRelTo(e.target.value)}><option value="">請選擇</option>{targets.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}</select>
          </label>
        </div>
        <p className="caption">{meta.relations[relKind]?.help}</p>
        <div><button className="tbtn primary" disabled={!relTo || busy} onClick={async () => { if (await call(() => api(`/projects/${pid}/relations`, "POST", { kind: relKind, from: el.id, to: relTo }))) setRelTo(""); }}>加入關係</button></div>
      </div>
    </>
  );
}

function EdgePanel({ view, meta, setSel, onChanged, edge }: Props & { edge: GEdge }) {
  const byId = new Map(view.analysis.elements.map((e) => [e.id, e]));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const zh = meta.relations[edge.kind]?.zh ?? ({ compose: "包含", connect: "連接", succession: "之後是" } as Record<string, string>)[edge.kind] ?? edge.kind;
  const a = byId.get(edge.source), b = byId.get(edge.target);
  const remove = async () => {
    if (!edge.remove) return;
    try {
      const v = edge.remove.type === "relation"
        ? await api<View>(`/projects/${view.project.id}/relations/delete`, "POST", { kind: edge.remove.kind, from: edge.remove.from, to: edge.remove.to })
        : await api<View>(`/projects/${view.project.id}/elements/delete`, "POST", { id: edge.remove.id });
      onChanged(v); setSel({ type: "new", category: "SystemRequirement", parentId: null });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  return (
    <div className="section">
      <div className="section-head"><h2 className="section-title">關係</h2><span className="label">{zh}</span></div>
      <div className="stack">
        {a && <button className="tbtn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, justifyContent: "flex-start" }} onClick={() => setSel({ type: "element", id: a.id })}>{label(a)}</button>}
        <span className="label">{zh}{edge.kind === "compose" && edge.label ? `（零件 ${edge.label}）` : ""}</span>
        {b && <button className="tbtn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, justifyContent: "flex-start" }} onClick={() => setSel({ type: "element", id: b.id })}>{label(b)}</button>}
      </div>
      <Msg m={msg} />
      {edge.kind !== "verify" && <div style={{ marginTop: 12 }}><button className="tbtn primary" onClick={remove}>移除這條關係</button></div>}
      {edge.kind === "verify" && <p className="caption" style={{ marginTop: 12 }}>驗證關係寫在驗證事件裡，請到原始碼修改。</p>}
    </div>
  );
}
