// 模型：左欄依框架的層長出來（MOD-02，見 model/LayerTree.tsx），中間是圖或某類別的元素列表，原始碼收成下方抽屜，右欄只在選取時顯示。
// 圖上方名稱列有「匯出 ▾」（MOD-14）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { api } from "../api.ts";
import type { Diagrams, Meta, View } from "../api.ts";
import { diagramsOf } from "../model.ts";
import type { DiagramDef } from "../model.ts";
import { Diagram } from "../Diagram.tsx";
import type { DiagramHandle } from "../Diagram.tsx";
import { SourceTab } from "../SourceTab.tsx";
import { Columns, SelectionPane } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import { LayerTree } from "./model/LayerTree.tsx";
import { CategoryList } from "./model/CategoryList.tsx";
import "./model.css";

export function ModelPage(p: PageProps) {
  const { id, view, meta, readOnly } = p;
  // 自訂圖與標註。畫面先更新，稍後一次存檔，避免每打一個字就送出一次
  const [extra, setExtra] = useState<Diagrams>({ custom: [], notes: {} });
  const extraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { api<Diagrams>(`/projects/${id}/diagrams`).then(setExtra).catch(() => {}); }, [id]);
  const saveExtra = useCallback((next: Diagrams) => {
    setExtra(next);
    if (readOnly) return;
    if (extraTimer.current) clearTimeout(extraTimer.current);
    extraTimer.current = setTimeout(() => { api(`/projects/${id}/diagrams`, "PUT", { diagrams: next }).catch((e) => p.onNotice((e as Error).message)); }, 400);
  }, [id, readOnly, p.onNotice]);
  // 剛建好的自訂圖：直接跳出「選要放進來的項目」
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const addDiagram = (title: string) => {
    const did = `custom:${Date.now().toString(36)}`;
    setJustCreated(did);
    saveExtra({ ...extra, custom: [...extra.custom, { id: did, title: title.trim().slice(0, 60) || "自訂圖", members: [] }] });
    p.setSpot({ diagramId: did });
  };
  const diagrams = useMemo(() => diagramsOf(view.analysis, extra), [view, extra]);
  const def: DiagramDef = diagrams.find((d) => d.id === p.spot.diagramId) ?? diagrams[0];
  const selectedId = p.sel?.type === "element" ? p.sel.id : null;
  const selectElement = (eid: string | null) => p.setSel(eid ? { type: "element", id: eid } : null);
  const source = p.spot.source;

  // 左欄點了某層的類別：中間改列出這個類別的元素；換圖就回到圖
  const [listCat, setListCat] = useState<string | null>(null);
  const openDiagram = (d: string) => { setListCat(null); p.setSpot({ diagramId: d }); };
  const handle = useRef<DiagramHandle | null>(null);
  const left = <LayerTree view={view} meta={meta} diagrams={diagrams} diagramId={def.id} selectedId={selectedId} listCat={listCat} onAddDiagram={readOnly ? undefined : (t) => { setListCat(null); addDiagram(t); }}
    onDiagram={openDiagram} onList={setListCat} onCategory={(c) => p.setSel({ type: "new", category: c, parentId: null })} onElement={(eid) => p.setSel({ type: "element", id: eid })} />;

  return (
    <Columns left={left} right={p.sel ? <SelectionPane {...p} /> : undefined}>
      <div className="model-bar">
        <span className="label">{def.code}</span><span className="heading">{def.title}</span>
        <select className="input model-pick" value={def.id} onChange={(e) => openDiagram(e.target.value)} aria-label="切換圖" title="切換圖">
          {diagrams.map((d) => <option key={d.id} value={d.id}>{d.code} {d.title}</option>)}
        </select>
        {listCat && <span className="tag">列表中</span>}
        <span className="grow" />
        {!listCat && <ExportMenu handle={handle} />}
        <button className="tbtn" aria-pressed={source} onClick={() => p.setSpot({ source: !source })} title="SysML v2 文字原始碼">{"</>"} 原始碼</button>
      </div>
      <div className={`model-main ${source ? "with-source" : ""}`}>
        {listCat
          ? <CategoryList view={view} meta={meta} category={listCat} selectedId={selectedId} readOnly={readOnly} onElement={(eid) => p.setSel({ type: "element", id: eid })}
              onNew={(c) => p.setSel({ type: "new", category: c, parentId: null })} onClose={() => setListCat(null)} />
          : <Diagram readOnly={readOnly} view={view} meta={meta} def={def} extra={extra} pickOnOpen={def.id === justCreated} onPicked={() => setJustCreated(null)} onExtra={saveExtra} selectedId={selectedId} onSelectElement={selectElement}
              onSelectEdge={(e) => e && p.setSel({ type: "edge", edge: e })} onNew={(c, parentId) => p.setSel({ type: "new", category: c, parentId })}
              onChanged={(v: View) => { p.setView(v); p.onNotice(""); }} onError={p.onNotice} handle={handle} />}
      </div>
      {source && (
        <div className="source-drawer" role="region" aria-label="原始碼">
          <div className="tbtn-row source-drawer-head"><span className="grow" /><button className="tbtn" onClick={() => p.setSpot({ source: false })} aria-label="收起原始碼">收起 ▾</button></div>
          <div className="source-drawer-body"><SourceTab id={id} onSaved={p.reload} readOnly={readOnly} /></div>
        </div>
      )}
    </Columns>
  );
}

/** 名稱列的「匯出 ▾」：SVG／PNG；有草稿標註時可選要不要一起匯出（偏好存在瀏覽器）。 */
function ExportMenu({ handle }: { handle: RefObject<DiagramHandle | null> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => { try { return !!JSON.parse(localStorage.getItem("jri.export") ?? "{}").draft; } catch { return false; } });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const run = (kind: "svg" | "png") => { setOpen(false); handle.current?.exportAs(kind, draft); };
  const toggleDraft = () => setDraft((v) => { try { localStorage.setItem("jri.export", JSON.stringify({ draft: !v })); } catch { /* 只在本次有效 */ } return !v; });
  return (
    <div className="export-menu" ref={ref}>
      <button className="tbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="把這張圖匯出成檔案，放進審查報告">匯出 ▾</button>
      {open && (
        <div className="ctx-menu" role="menu">
          <button role="menuitem" onClick={() => run("svg")}>SVG（向量，可縮放）</button>
          <button role="menuitem" onClick={() => run("png")}>PNG（圖片）</button>
          {(handle.current?.notes ?? 0) > 0 && <label className="caption export-draft"><input type="checkbox" checked={draft} onChange={toggleDraft} /> 含草稿標註</label>}
        </div>
      )}
    </div>
  );
}
