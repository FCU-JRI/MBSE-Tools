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

// 值是 SysML v2 標準庫 VerificationMethodKind 的列舉值
const METHODS: Record<string, string> = { test: "測試", analyze: "分析", inspect: "檢查", demo: "展示" };
export const methodZh = (v: string | undefined) => METHODS[(v ?? "").split("::").pop() ?? ""] ?? "";

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
  if (view.docs.length === 0) return <p className="caption" style={{ marginBottom: 12 }}>到「表格 → 來源文件」登記文件後，這裡可以標註出處。</p>;
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
  const [method, setMethod] = useState("test");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const isVer = cat.keyword === "verification";
  const reqs = listOf(view.analysis.elements, "MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP");
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
  const call: Call = async (fn, done) => {
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

      <div className="section closure">
        <CategoryField view={view} meta={meta} el={el} cat={cat} busy={busy} call={call} />
        <ParentField view={view} meta={meta} el={el} busy={busy} call={call} />
        {cat?.keyword === "verification" && <VerifyFields view={view} el={el} busy={busy} call={call} setSel={setSel} />}
        <CustomAttrs view={view} el={el} cat={cat} busy={busy} call={call} />
        <DesignTags view={view} el={el} cat={cat} busy={busy} call={call} />
      </div>

      <div className="section">
        <div className="section-head"><h2 className="section-title">關係</h2><span className="label">{out.length + inn.length}</span></div>
        {[...out, ...inn].filter((x) => x.other).map((x, i) => (
          <RelRow key={`${x.r.kind}:${x.r.from}:${x.r.to}:${i}`} view={view} meta={meta} el={el} r={x.r} zh={x.zh} other={x.other as Element} busy={busy} call={call} setSel={setSel} />
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
  const [busy, setBusy] = useState(false);
  const zh = meta.relations[edge.kind]?.zh ?? ({ compose: "包含", connect: "連接", succession: "之後是", transition: "轉換到" } as Record<string, string>)[edge.kind] ?? edge.kind;
  const a = byId.get(edge.source), b = byId.get(edge.target);
  const pid = view.project.id;
  const call: Call = async (fn, done) => {
    setBusy(true); setMsg(null);
    try { const v = await fn(); onChanged(v); if (done) setMsg({ ok: true, text: done }); return true; }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); return false; }
    finally { setBusy(false); }
  };
  // 驗證線寫在驗證事件的 objective 裡：移除 = 從要驗證的需求拿掉
  const verifiesOf = (vid: string) => view.analysis.relations.filter((r) => r.kind === "verify" && r.from === vid).map((r) => r.to);
  const remove = async () => {
    if (edge.kind === "verify" && a && b) {
      if (await call(() => api(`/projects/${pid}/verification`, "POST", { id: a.id, verifies: verifiesOf(a.id).filter((x) => x !== b.id) }))) setSel({ type: "new", category: "SystemRequirement", parentId: null });
      return;
    }
    if (!edge.remove) return;
    const r = edge.remove;
    const ok = await call(() => r.type === "relation"
      ? api<View>(`/projects/${pid}/relations/delete`, "POST", { kind: r.kind, from: r.from, to: r.to })
      : api<View>(`/projects/${pid}/elements/delete`, "POST", { id: r.id }));
    if (ok) setSel({ type: "new", category: "SystemRequirement", parentId: null });
  };
  const usage = edge.kind === "compose" && edge.remove?.type === "element" ? byId.get(edge.remove.id) : undefined;
  // 組成線的兩端：上層定義 ◆ 零件 → 零件的型別（下層定義）
  const lower = usage ? view.analysis.elements.find((e) => usage.typeIds.includes(e.id) && e.kind === "PartDefinition") : undefined;
  const changeable = edge.kind === "verify" || edge.kind === "compose" || (edge.remove?.type === "relation" && CHANGE_KINDS.includes(edge.kind));
  return (
    <div className="section">
      <div className="section-head"><h2 className="section-title">關係</h2><span className="label">{zh}</span></div>
      <div className="stack">
        {a && <button className="tbtn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, justifyContent: "flex-start" }} onClick={() => setSel({ type: "element", id: a.id })}>{label(a)}</button>}
        <span className="label">{zh}{edge.kind === "compose" && edge.label ? `（零件 ${edge.label}）` : ""}</span>
        {b && <button className="tbtn" style={{ textTransform: "none", letterSpacing: 0, fontSize: 14, justifyContent: "flex-start" }} onClick={() => setSel({ type: "element", id: b.id })}>{label(b)}</button>}
      </div>
      <Msg m={msg} />
      {(edge.remove || edge.kind === "verify") && <div style={{ marginTop: 12 }}><button className="tbtn primary" disabled={busy} onClick={remove}>移除這條關係</button></div>}
      {changeable && a && b && <EdgeChange view={view} meta={meta} edge={edge} a={a} b={b} usage={usage} lower={lower} busy={busy} call={call} verifiesOf={verifiesOf} onDone={() => setSel({ type: "element", id: a.id })} />}
      {!changeable && edge.kind === "define" && <p className="caption" style={{ marginTop: 12 }}>這條是零件的型別線，跟著組成線走：選上面那條組成線（菱形）就能改。</p>}
    </div>
  );
}

// ───────── 閉環：建立之後能改（類別、上層、驗證、自訂屬性、關係） ─────────
// 做不到的地方直接在畫面上說明原因，不讓人存了才發現。

type Call = (fn: () => Promise<View & { selected?: string }>, done?: string) => Promise<boolean>;
const TRACE_LIKE = ["derive", "refine", "trace", "satisfy", "allocate"];
const LOCAL_KINDS = ["succession", "connect", "transition"];
const CHANGE_KINDS = [...TRACE_LIKE, "include", ...LOCAL_KINDS];
const KIND_ZH: Record<string, string> = { compose: "組成", connect: "連接", succession: "先後順序", transition: "狀態轉換", include: "包含", verify: "驗證" };
const relName = (meta: Meta, k: string) => meta.relations[k]?.zh ?? KIND_ZH[k] ?? k;
const REQ_ALL = ["Expectation", "Need", "Goal", "Objective", "MOE", "MissionRequirement", "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP"];
const linkStyle = { textTransform: "none" as const, letterSpacing: 0, fontSize: 13, justifyContent: "flex-start" as const };

/** 類別：只列同一個 SysML 關鍵字的類別。 */
function CategoryField({ view, meta, el, cat, busy, call }: { view: View; meta: Meta; el: Element; cat: Category | undefined; busy: boolean; call: Call }) {
  const [to, setTo] = useState(cat?.id ?? "");
  const [renumber, setRenumber] = useState(true);
  useEffect(() => setTo(cat?.id ?? ""), [cat?.id]);
  if (!cat) return null;
  const same = meta.categories.filter((c) => c.keyword === cat.keyword);
  const target = meta.categories.find((c) => c.id === to);
  const numbered = !!el.shortName && new RegExp(`^${cat.prefix.replace(/-/g, "\\-")}-\\d+$`).test(el.shortName);
  const lost = (cat.fields ?? []).filter((f) => el.attrs[f.name] && !(target?.fields ?? []).some((x) => x.name === f.name));
  return (
    <div className="field">
      <span className="label">類別</span>
      {same.length > 1
        ? <div className="inline-edit">
            <select className="input" aria-label="改類別" value={to} onChange={(e) => setTo(e.target.value)}>{same.map((c) => <option key={c.id} value={c.id}>{c.zh} {c.en}</option>)}</select>
            <button type="button" className="tbtn" disabled={busy || to === cat.id || lost.length > 0}
              onClick={() => call(() => api(`/projects/${view.project.id}/elements/category`, "POST", { id: el.id, category: to, renumber }), `已改為${target?.zh ?? ""}，關係都保留。`)}>改類別</button>
          </div>
        : <span className="data">{cat.zh}</span>}
      {to !== cat.id && numbered && target && <label className="check"><input type="checkbox" checked={renumber} onChange={(e) => setRenumber(e.target.checked)} /><span className="caption">編號一起換成 {target.prefix}-xxx</span></label>}
      {to !== cat.id && lost.length > 0 && <p className="caption">「{target?.zh}」沒有這些欄位：{lost.map((f) => f.zh).join("、")}。請先清空再改類別。</p>}
      <p className="caption">
        {same.length > 1 ? `只能換成同樣寫成 «${cat.keyword}» 的類別，關係會保留。` : `這個類別在 SysML 裡寫成 «${cat.keyword}»，沒有同關鍵字的其他類別可以換。`}
        其他類別的 SysML 關鍵字不同，直接換會讓模型不合語法，所以不開放；要換請新增一個，再把關係連過去。
      </p>
    </div>
  );
}

/** 上層：功能與階段在任務之間搬、狀態在模式之間搬、零件在系統定義之間搬；定義換的是組成它的零件。 */
function ParentField({ view, meta, el, busy, call }: { view: View; meta: Meta; el: Element; busy: boolean; call: Call }) {
  const els = view.analysis.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const owner = el.owner ? byId.get(el.owner) : undefined;
  const defs = els.filter((x) => x.kind === "PartDefinition" && !x.shared && x.id !== el.id);
  const uses = el.kind === "PartDefinition" ? els.filter((u) => u.kind === "PartUsage" && u.typeIds.includes(el.id) && byId.get(u.owner ?? "")?.kind === "PartDefinition") : [];
  const moving = el.kind === "PartDefinition" ? uses[0] : el;
  const current = el.kind === "PartDefinition" ? uses[0]?.owner ?? "" : el.owner ?? "";
  const [to, setTo] = useState(current);
  useEffect(() => setTo(current), [current]);
  let options: Element[] | null = null, none = false, what = "";
  if (el.kind === "ActionUsage" || el.kind === "StateUsage") {
    const pkgName = meta.categories.find((c) => c.id === el.category)?.pkg;
    const inside = (x: Element) => x.qualifiedName === el.qualifiedName || x.qualifiedName.startsWith(el.qualifiedName + "::");
    const pkg = els.find((x) => x.kind === "Package" && x.name === pkgName && x.qualifiedName.split("::").length === 2);
    options = [...(pkg ? [pkg] : []), ...els.filter((x) => x.kind === el.kind && !x.shared && !inside(x))];
    what = el.kind === "ActionUsage" ? "任務或活動" : "模式";
  } else if (el.kind === "PartUsage" && owner?.kind === "PartDefinition") {
    options = defs; what = "系統定義";
  } else if (el.kind === "PartDefinition" && uses.length <= 1) {
    options = defs; none = true; what = "系統定義（組成）";
  }
  if (!options) {
    return (
      <div className="field"><span className="label">上層</span>
        <span className="data">{owner ? (owner.kind === "Package" ? `套件 ${owner.name}` : label(owner)) : "—"}</span>
        <p className="caption">{el.kind === "PartDefinition"
          ? `「${el.name}」被 ${uses.length} 個系統定義當成零件，請在結構分解圖上選那幾條組成線（菱形）逐條修改。`
          : "這類項目依類別放在套件裡，沒有上層可以換；要整理分組請用圖上的「套件」。"}</p>
      </div>
    );
  }
  const local = moving ? view.analysis.relations.filter((r) => LOCAL_KINDS.includes(r.kind) && (r.from === moving.id || r.to === moving.id)).length : 0;
  const nm = (x: Element) => (x.kind === "Package" ? `套件 ${x.name}（不放在任何${what}裡）` : label(x));
  return (
    <div className="field"><span className="label">上層</span>
      <div className="inline-edit">
        <select className="input" aria-label="上層" value={to} onChange={(e) => setTo(e.target.value)}>
          {none && <option value="">（無）</option>}
          {!none && !options.some((x) => x.id === current) && <option value={current}>{owner?.name ?? "—"}</option>}
          {options.map((x) => <option key={x.id} value={x.id}>{nm(x)}</option>)}
        </select>
        <button type="button" className="tbtn" disabled={busy || to === current}
          onClick={() => call(() => api(`/projects/${view.project.id}/elements/reparent`, "POST", { id: el.id, parentId: to || null }), to ? `已放到「${byId.get(to)?.name ?? ""}」底下。` : "已移除組成。")}>搬移</button>
      </div>
      <p className="caption">
        {el.kind === "PartDefinition" ? "上層是把它當成零件的系統定義；搬移會把那個零件搬過去，選「無」會拿掉組成。" : `可以放到另一個${what}底下。`}
        {local > 0 && to !== current ? ` 會一併移除 ${local} 條先後順序／連接／轉換（這些只能連同一個上層裡的項目）。` : ""}
        別處用完整路徑引用它（例如分配）時，搬了會對不上，系統會拒絕並說明。
      </p>
    </div>
  );
}

/** 驗證事件：方法可改，要驗證的需求可增減。 */
function VerifyFields({ view, el, busy, call, setSel }: { view: View; el: Element; busy: boolean; call: Call; setSel: (s: Selection) => void }) {
  const pid = view.project.id;
  const byId = new Map(view.analysis.elements.map((e) => [e.id, e]));
  const method = (el.attrs.kind ?? "").split("::").pop() ?? "";
  const targets = view.analysis.relations.filter((r) => r.kind === "verify" && r.from === el.id).map((r) => r.to);
  const reqs = listOf(view.analysis.elements, ...REQ_ALL).filter((r) => !targets.includes(r.id));
  const [add, setAdd] = useState("");
  const set = (ids: string[], done: string) => call(() => api(`/projects/${pid}/verification`, "POST", { id: el.id, verifies: ids }), done);
  return (
    <>
      <label className="field"><span className="label">驗證方法</span>
        <select className="input" value={method} disabled={busy} onChange={(e) => call(() => api(`/projects/${pid}/verification`, "POST", { id: el.id, method: e.target.value }), "已改驗證方法。")}>
          <option value="">未指定</option>{Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <div className="field"><span className="label">要驗證的需求</span>
        {targets.map((t) => { const r = byId.get(t); return r && (
          <div className="rel" key={t}>
            <button type="button" className="tbtn rn" style={linkStyle} onClick={() => setSel({ type: "element", id: t })}>{label(r)}</button>
            <button type="button" className="tbtn" disabled={busy} onClick={() => set(targets.filter((x) => x !== t), `已移除「${r.name}」。`)}>移除</button>
          </div>
        ); })}
        {targets.length === 0 && <p className="caption">還沒指定。</p>}
        <div className="inline-edit">
          <select className="input" aria-label="加入要驗證的需求" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">選擇需求</option>{reqs.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</select>
          <button type="button" className="tbtn" disabled={busy || !add} onClick={async () => { if (await set([...targets, add], "已加入。")) setAdd(""); }}>加入</button>
        </div>
      </div>
    </>
  );
}

/** 數值的單位寫在方括號裡：3.2 [kg] */
const splitUnit = (v: string) => { const m = /^(.*?)\s*\[([^\]]+)\]$/.exec(v); return m ? { value: m[1], unit: m[2] } : { value: v, unit: "" }; };

/** 自訂屬性：類別預設欄位以外的屬性（名稱、值、單位），放在屬性欄最下面。 */
const LAYER_ZH: [string, string][] = [["", "（自動判斷）"], ["mission", "任務"], ["system", "系統"], ["subsystem", "次系統"], ["component", "元件"]];

/** 設計資料標記：結構元素的 CAD 連結（設計迴圈第 5 步），需求、風險、決策的層級（推不出層級時才手填）。 */
function DesignTags({ view, el, cat, busy, call }: { view: View; el: Element; cat: Category | undefined; busy: boolean; call: Call }) {
  const pid = view.project.id;
  const [cad, setCad] = useState({ url: el.attrs.cadUrl ?? "", version: el.attrs.cadVersion ?? "", tool: el.attrs.cadTool ?? "" });
  const [layer, setLayer] = useState(el.attrs.layer ?? "");
  useEffect(() => { setCad({ url: el.attrs.cadUrl ?? "", version: el.attrs.cadVersion ?? "", tool: el.attrs.cadTool ?? "" }); setLayer(el.attrs.layer ?? ""); }, [el]);
  if (!cat) return null;
  const structural = cat.keyword === "part def";
  const layered = cat.keyword === "requirement" || cat.id === "Risk" || cat.id === "DesignDecision";
  if (!structural && !layered) return null;
  const cadDirty = cad.url.trim() !== (el.attrs.cadUrl ?? "") || cad.version.trim() !== (el.attrs.cadVersion ?? "") || cad.tool.trim() !== (el.attrs.cadTool ?? "");
  const patch = (body: Record<string, unknown>, done: string) => call(() => api(`/projects/${pid}/elements`, "PATCH", { id: el.id, ...body }), done);
  return (
    <>
      {structural && <div className="field">
        <span className="label">CAD 連結</span>
        <input className="input" value={cad.url} onChange={(e) => setCad({ ...cad, url: e.target.value })} placeholder="https://…" aria-label="CAD 網址" spellCheck={false} />
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <input className="input" style={{ flex: 1 }} value={cad.version} onChange={(e) => setCad({ ...cad, version: e.target.value })} placeholder="版本，例如 v3" aria-label="CAD 版本" />
          <input className="input" style={{ flex: 1 }} value={cad.tool} onChange={(e) => setCad({ ...cad, tool: e.target.value })} placeholder="工具，例如 Onshape" aria-label="CAD 工具" />
        </div>
        <div className="tbtn-row" style={{ paddingLeft: 0 }}>
          <button type="button" className="tbtn" disabled={busy || !cadDirty} onClick={() => patch({ cad }, cad.url.trim() ? "已寫入 CAD 連結。" : "已拿掉 CAD 連結。")}>寫入 CAD 連結</button>
          {el.attrs.cadUrl && <button type="button" className="tbtn" disabled={busy} onClick={() => patch({ cad: { url: "", version: "", tool: "" } }, "已拿掉 CAD 連結。")}>拿掉</button>}
        </div>
        <span className="caption">只放連結與版本，不附檔。設計迴圈的「CAD 建模」靠這裡判定完成。</span>
      </div>}
      {layered && <label className="field">
        <span className="label">層級</span>
        <select className="input" value={layer} disabled={busy} onChange={(e) => { setLayer(e.target.value); patch({ layer: e.target.value }, "已更新層級。"); }}>
          {LAYER_ZH.map(([v, zh]) => <option key={v} value={v}>{zh}</option>)}
        </select>
        <span className="caption">FMEA 與方案比較依層篩選用；推得出層級時不用填。</span>
      </label>}
    </>
  );
}

function CustomAttrs({ view, el, cat, busy, call }: { view: View; el: Element; cat: Category | undefined; busy: boolean; call: Call }) {
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState({ name: "", value: "", unit: "" });
  if (el.kind === "Package" || el.kind === "Comment") return null;
  const locs = (el as Element & { attrLoc?: Record<string, unknown> }).attrLoc ?? {};
  const fixed = new Set((cat?.fields ?? []).map((f) => f.name));
  const names = Object.keys(el.attrs).filter((n) => n in locs && !fixed.has(n));
  const pid = view.project.id;
  return (
    <div className="field"><span className="label">自訂屬性</span>
      {names.map((n) => <AttrRow key={`${n}=${el.attrs[n]}`} pid={pid} el={el} name={n} value={el.attrs[n]} busy={busy} call={call} />)}
      {adding
        ? <div className="attr-row">
            <input className="input" placeholder="名稱，例如 mass" aria-label="屬性名稱" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} spellCheck={false} />
            <input className="input" placeholder="值" aria-label="屬性的值" value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} />
            <input className="input" placeholder="單位" aria-label="單位" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} spellCheck={false} />
            <button type="button" className="tbtn primary" disabled={busy || !d.name.trim() || !d.value.trim()}
              onClick={async () => { if (await call(() => api(`/projects/${pid}/elements/attribute`, "POST", { id: el.id, ...d }), `已加入「${d.name}」。`)) { setD({ name: "", value: "", unit: "" }); setAdding(false); } }}>加入</button>
            <button type="button" className="tbtn" onClick={() => setAdding(false)}>取消</button>
          </div>
        : <div><button type="button" className="tbtn" onClick={() => setAdding(true)}>＋ 自訂屬性</button></div>}
      <p className="caption">單位用 SI 符號，例如 kg、m、m/s、N*s；沒有單位的值可以是數字或文字。</p>
    </div>
  );
}

function AttrRow({ pid, el, name, value, busy, call }: { pid: string; el: Element; name: string; value: string; busy: boolean; call: Call }) {
  const init = { name, ...splitUnit(value) };
  const [d, setD] = useState(init);
  const [confirm, setConfirm] = useState(false);
  const dirty = d.name.trim() !== init.name || d.value.trim() !== init.value || d.unit.trim() !== init.unit;
  return (
    <div className="attr-row">
      <input className="input" aria-label="屬性名稱" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} spellCheck={false} />
      <input className="input" aria-label={`${name} 的值`} value={d.value} onChange={(e) => setD({ ...d, value: e.target.value })} />
      <input className="input" aria-label={`${name} 的單位`} placeholder="單位" value={d.unit} onChange={(e) => setD({ ...d, unit: e.target.value })} spellCheck={false} />
      <button type="button" className="tbtn" disabled={busy || !dirty} onClick={() => call(() => api(`/projects/${pid}/elements/attribute`, "POST", { id: el.id, oldName: name, ...d }), "已寫入。")}>寫入</button>
      {confirm
        ? <button type="button" className="tbtn primary" disabled={busy} onClick={() => call(() => api(`/projects/${pid}/elements/attribute`, "POST", { id: el.id, oldName: name, remove: true }), `已刪除「${name}」。`)}>確定刪除</button>
        : <button type="button" className="tbtn" onClick={() => setConfirm(true)}>刪除</button>}
    </div>
  );
}

/** 屬性欄的關係列：移除，或改對象／改類型。 */
function RelRow({ view, meta, el, r, zh, other, busy, call, setSel }: { view: View; meta: Meta; el: Element; r: View["analysis"]["relations"][number]; zh: string; other: Element; busy: boolean; call: Call; setSel: (s: Selection) => void }) {
  const [edit, setEdit] = useState(false);
  const [kind, setKind] = useState(r.kind);
  const [target, setTarget] = useState(other.id);
  const pid = view.project.id;
  const outgoing = r.from === el.id;
  const kinds = TRACE_LIKE.includes(r.kind) ? TRACE_LIKE : [r.kind];
  const els = view.analysis.elements;
  const cands = LOCAL_KINDS.includes(r.kind) || r.kind === "include"
    ? els.filter((x) => x.owner === other.owner && x.kind === other.kind && x.id !== el.id)
    : els.filter((x) => x.category && x.kind !== "ReferenceUsage" && x.id !== el.id);
  if (r.kind === "verify") {
    return (
      <div className="rel"><span className="label">{zh}</span>
        <button className="tbtn rn" style={linkStyle} onClick={() => setSel({ type: "element", id: other.id })}>{label(other)}</button>
        {!outgoing && <button className="tbtn" title="驗證關係寫在驗證事件裡" onClick={() => setSel({ type: "element", id: other.id })}>到驗證事件改</button>}
      </div>
    );
  }
  return (
    <>
      <div className="rel"><span className="label">{zh}</span>
        <button className="tbtn rn" style={linkStyle} onClick={() => setSel({ type: "element", id: other.id })}>{label(other)}</button>
        <button className="tbtn" disabled={busy} onClick={() => setEdit(!edit)} aria-expanded={edit}>改</button>
        <button className="tbtn" disabled={busy} onClick={() => call(() => api(`/projects/${pid}/relations/delete`, "POST", { kind: r.kind, from: r.from, to: r.to }))}>移除</button>
      </div>
      {edit && (
        <div className="rel-edit">
          <div className="row">
            <label className="field" style={{ flex: "0 0 6rem", minWidth: 0 }}><span className="label">類型</span>
              <select className="input" value={kind} disabled={kinds.length === 1} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{relName(meta, k)}</option>)}</select>
            </label>
            <label className="field"><span className="label">{outgoing ? "對象" : "起點"}</span>
              <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>{cands.map((t) => <option key={t.id} value={t.id}>{label(t)}</option>)}</select>
            </label>
          </div>
          {kinds.length === 1 && <p className="caption">「{relName(meta, r.kind)}」和其他類型在 SysML 裡寫法不同，只能換對象；要換類型請移除後重新連線。</p>}
          <div className="tbtn-row" style={{ paddingLeft: 0 }}>
            <button className="tbtn primary" disabled={busy || (kind === r.kind && target === other.id)}
              onClick={async () => { if (await call(() => api(`/projects/${pid}/relations/change`, "POST", { kind: r.kind, from: r.from, to: r.to, newKind: kind, ...(outgoing ? { newTo: target } : { newFrom: target }) }), "已修改關係。")) setEdit(false); }}>確定修改</button>
            <button className="tbtn" onClick={() => { setEdit(false); setKind(r.kind); setTarget(other.id); }}>取消</button>
          </div>
        </div>
      )}
    </>
  );
}

/** 圖上選到的線：改兩端或類型。組成線改的是零件的上層與型別；驗證線改的是驗證事件的 objective。 */
function EdgeChange({ view, meta, edge, a, b, usage, lower, busy, call, verifiesOf, onDone }: { view: View; meta: Meta; edge: GEdge; a: Element; b: Element; usage?: Element; lower?: Element; busy: boolean; call: Call; verifiesOf: (id: string) => string[]; onDone: () => void }) {
  const els = view.analysis.elements;
  const pid = view.project.id;
  const startTo = edge.kind === "compose" ? lower?.id ?? "" : b.id;
  const [kind, setKind] = useState(edge.kind);
  const [from, setFrom] = useState(a.id);
  const [to, setTo] = useState(startTo);
  const defs = els.filter((x) => x.kind === "PartDefinition" && !x.shared);
  const local = LOCAL_KINDS.includes(edge.kind) || edge.kind === "include";
  const any = els.filter((x) => x.category && x.kind !== "ReferenceUsage");
  const fromOpts = edge.kind === "verify" ? [a] : edge.kind === "compose" ? defs : local ? els.filter((x) => x.owner === a.owner && x.kind === a.kind) : any;
  const toOpts = edge.kind === "verify" ? listOf(els, ...REQ_ALL) : edge.kind === "compose" ? defs : local ? els.filter((x) => x.owner === b.owner && x.kind === b.kind) : any;
  const kinds = TRACE_LIKE.includes(edge.kind) ? TRACE_LIKE : [edge.kind];
  const same = kind === edge.kind && from === a.id && to === startTo;
  const submit = () => {
    if (edge.kind === "verify") return call(() => api(`/projects/${pid}/verification`, "POST", { id: a.id, verifies: [...verifiesOf(a.id).filter((x) => x !== b.id && x !== to), to] }), "已修改驗證對象。");
    if (edge.kind === "compose") return call(() => api(`/projects/${pid}/relations/change`, "POST", { kind: "compose", usage: usage?.id, newFrom: from, newTo: to }), "已修改組成。");
    const r = edge.remove?.type === "relation" ? edge.remove : null;
    if (!r) return Promise.resolve(false);
    return call(() => api(`/projects/${pid}/relations/change`, "POST", { kind: r.kind, from: r.from, to: r.to, newKind: kind, newFrom: from, newTo: to }), "已修改關係。");
  };
  const note = edge.kind === "compose" ? "組成線＝上層定義裡的一個零件：換上層會把零件搬過去，換下層會換零件的型別。"
    : edge.kind === "verify" ? "驗證線寫在驗證事件的 objective 裡，起點固定是驗證事件。"
    : local ? `「${relName(meta, edge.kind)}」只能連同一個上層裡的項目，也不能換成其他類型（SysML 寫法不同）；要換類型請移除後重新連線。` : "";
  return (
    <div className="rel-edit" style={{ marginTop: 16 }}>
      <span className="label">改這條線</span>
      <label className="field"><span className="label">類型</span>
        <select className="input" value={kind} disabled={kinds.length === 1} onChange={(e) => setKind(e.target.value)}>{kinds.map((k) => <option key={k} value={k}>{relName(meta, k)}</option>)}</select>
      </label>
      <label className="field"><span className="label">{edge.kind === "compose" ? "上層（整體）" : "起點"}</span>
        <select className="input" value={from} disabled={fromOpts.length <= 1} onChange={(e) => setFrom(e.target.value)}>{fromOpts.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</select>
      </label>
      <label className="field"><span className="label">{edge.kind === "compose" ? "下層（零件的型別）" : "終點"}</span>
        <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>{toOpts.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>)}</select>
      </label>
      {note && <p className="caption">{note}</p>}
      <div><button className="tbtn primary" disabled={busy || same} onClick={async () => { if (await submit()) onDone(); }}>確定修改</button></div>
    </div>
  );
}
