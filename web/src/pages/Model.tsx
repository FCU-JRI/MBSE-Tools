// 模型：左欄依分析流程排（搜尋 → 7 個階段 → 全部依類型），中間是圖或某個類別的元素清單，
// 原「原始碼」收成下方抽屜，右欄只在選取時顯示。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import type { Diagrams, View } from "../api.ts";
import { diagramsOf } from "../model.ts";
import type { DiagramDef } from "../model.ts";
import { Diagram } from "../Diagram.tsx";
import { SourceTab } from "../SourceTab.tsx";
import { Columns, SelectionPane } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import { Sidebar } from "./model/Sidebar.tsx";
import { CategoryList, MethodHead, N2, layerFilter } from "./model/Center.tsx";
import { MARK, METHOD_VIEWS, STAGES, currentStage, VIEW_BY_DIAGRAM, methodId, persisted, withMethod } from "./model/method.ts";
import type { Layer } from "./model/method.ts";
import "./model.css";

const loadDraft = () => { try { return JSON.parse(localStorage.getItem("jri.export") ?? "{}").draft === true; } catch { return false; } };
const saveDraft = (v: boolean) => { try { localStorage.setItem("jri.export", JSON.stringify({ draft: v })); } catch { /* 只在本次有效 */ } };

/** 這次瀏覽中自己挑過圖的專案；沒挑過的，打開模型頁時先看目前階段的第一張分析圖 */
const picked = new Set<string>();

export function ModelPage(p: PageProps) {
  const { id, view, meta, readOnly } = p;
  // 存檔裡的自訂圖與標註。分析圖沒有存過的，畫面上補空白的，第一次修改時才寫入
  const [stored, setStored] = useState<Diagrams>({ custom: [], notes: {} });
  const storedRef = useRef(stored); storedRef.current = stored;
  const [skeleton, setSkeleton] = useState<string[] | null>(null);
  const extraTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    api<Diagrams>(`/projects/${id}/diagrams`).then(setStored).catch(() => {});
    api<{ views: string[] | null }>(`/projects/${id}/analysis-views`).then((r) => setSkeleton(r.views)).catch(() => setSkeleton(null));
  }, [id]);
  const extra = useMemo(() => withMethod(stored, skeleton), [stored, skeleton]);
  const saveExtra = useCallback((next: Diagrams) => {
    const keep = persisted(next, storedRef.current);
    // 只是打開、沒有改到的空白分析圖不寫檔
    if (JSON.stringify(keep) === JSON.stringify(storedRef.current)) return;
    setStored(keep); storedRef.current = keep;
    if (readOnly) return;
    if (extraTimer.current) clearTimeout(extraTimer.current);
    extraTimer.current = setTimeout(() => { api(`/projects/${id}/diagrams`, "PUT", { diagrams: storedRef.current }).catch((e) => p.onNotice((e as Error).message)); }, 400);
  }, [id, readOnly, p.onNotice]);
  // 剛建好的自訂圖：直接跳出「選要放進來的項目」
  const [justCreated, setJustCreated] = useState<string | null>(null);
  const addDiagram = (title: string) => {
    const did = `custom:${Date.now().toString(36)}`;
    setJustCreated(did);
    saveExtra({ ...extra, custom: [...extra.custom, { id: did, title: title.trim().slice(0, 60) || "自訂圖", members: [] }] });
    setListCat(null);
    p.setSpot({ diagramId: did });
  };
  const diagrams = useMemo(() => diagramsOf(view.analysis, extra).map((d): DiagramDef => {
    const m = VIEW_BY_DIAGRAM.get(d.id);
    return m ? { ...d, title: `${MARK[m.no]} ${m.title}` } : d;
  }), [view, extra]);
  // 沒指定或找不到的圖：第一張分析圖
  const first = diagrams.find((d) => d.id === methodId(METHOD_VIEWS[0].id)) ?? diagrams[0];
  const def: DiagramDef = diagrams.find((d) => d.id === p.spot.diagramId) ?? first;
  const m = VIEW_BY_DIAGRAM.get(def.id);
  const selectedId = p.sel?.type === "element" ? p.sel.id : null;
  const selectElement = (eid: string | null) => p.setSel(eid ? { type: "element", id: eid } : null);
  const source = p.spot.source;
  // 點左欄的類別：中間改成元素清單；點圖回到畫布
  const [listCat, setListCat] = useState<string | null>(null);
  const [layers, setLayers] = useState<Set<Layer | "none">>(new Set());
  const [mode, setMode] = useState<"diagram" | "n2">("diagram");
  useEffect(() => { setLayers(new Set()); setMode("diagram"); }, [def.id]);
  const memberFilter = useMemo(() => (m?.layered ? layerFilter(view, layers) : undefined), [m, view, layers]);
  const method = useMemo(() => (m ? { pinned: m.pinned, links: m.links } : undefined), [m]);
  useEffect(() => {
    if (picked.has(id) || p.spot.diagramId !== "bdd") return; // "bdd" 是工作區的預設值
    const v = STAGES.find((s) => s.no === currentStage(view))?.views[0]?.id ?? METHOD_VIEWS[0].id;
    p.setSpot({ diagramId: methodId(v) });
    // 只在打開模型頁時決定一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const exportRef = useRef<{ run: (kind: "svg" | "png", withDraft: boolean) => void; notes: number } | null>(null);

  const left = <Sidebar view={view} meta={meta} diagrams={diagrams} diagramId={listCat ? null : def.id} listCat={listCat} selectedId={selectedId} onAddDiagram={readOnly ? undefined : addDiagram}
    onDiagram={(d) => { picked.add(id); setListCat(null); p.setSpot({ diagramId: d }); }} onCategory={setListCat} onElement={(eid) => p.setSel({ type: "element", id: eid })} />;
  const cat = listCat ? meta.categories.find((c) => c.id === listCat) : undefined;

  return (
    <Columns left={left} right={p.sel ? <SelectionPane {...p} /> : undefined}>
      <div className="model-bar">
        {listCat
          ? <><span className="label">清單</span><span className="heading">{cat?.zh ?? listCat}</span><span className="grow" /><button className="tbtn" onClick={() => setListCat(null)}>回到圖：{def.title}</button></>
          : <><span className="label">{def.code}</span><span className="heading">{def.title}</span><span className="grow" /><ExportMenu onRun={(k, d) => exportRef.current?.run(k, d)} notes={() => exportRef.current?.notes ?? 0} /></>}
        <button className="tbtn" aria-pressed={source} onClick={() => p.setSpot({ source: !source })} title="SysML v2 文字原始碼">{"</>"} 原始碼</button>
      </div>
      {!listCat && m && <MethodHead view={view} m={m} layers={layers} setLayers={setLayers} mode={mode} setMode={setMode} onElement={(eid) => selectElement(eid)} />}
      <div className={`model-main ${source ? "with-source" : ""}`}>
        {listCat
          ? <CategoryList view={view} meta={meta} cat={listCat} selectedId={selectedId} readOnly={readOnly} onElement={(eid) => selectElement(eid)} onNew={() => p.setSel({ type: "new", category: listCat, parentId: null })} />
          : m?.n2 && mode === "n2" ? <N2 view={view} onElement={(eid) => selectElement(eid)} />
          : <Diagram readOnly={readOnly} view={view} meta={meta} def={def} extra={extra} pickOnOpen={def.id === justCreated} onPicked={() => setJustCreated(null)} onExtra={saveExtra} selectedId={selectedId} onSelectElement={selectElement}
              onSelectEdge={(e) => e && p.setSel({ type: "edge", edge: e })} onNew={(c, parentId) => p.setSel({ type: "new", category: c, parentId })}
              onChanged={(v: View) => { p.setView(v); p.onNotice(""); }} onError={p.onNotice} method={method} memberFilter={memberFilter} exportRef={exportRef} />}
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

/** 圖上方名稱列的「匯出 ▾」：PNG、SVG，草稿標註預設不輸出。 */
function ExportMenu({ onRun, notes }: { onRun: (kind: "svg" | "png", withDraft: boolean) => void; notes: () => number }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(loadDraft);
  const run = (k: "svg" | "png") => { setOpen(false); onRun(k, draft); };
  return (
    <span className="menu-wrap">
      <button className="tbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>匯出 ▾</button>
      {open && (
        <div className="ctx-menu export-menu" role="menu" onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}>
          <button role="menuitem" onClick={() => run("png")}>PNG 圖檔</button>
          <button role="menuitem" onClick={() => run("svg")}>SVG 向量圖</button>
          {notes() > 0 && <label className="caption" style={{ display: "flex", gap: 6, alignItems: "center", padding: "4px 8px" }}>
            <input type="checkbox" checked={draft} onChange={(e) => { setDraft(e.target.checked); saveDraft(e.target.checked); }} />含草稿標註
          </label>}
        </div>
      )}
    </span>
  );
}
