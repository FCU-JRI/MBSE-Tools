// 模型：原「圖」加上左欄（篩選、圖依種類、模型元素），原「原始碼」收成下方抽屜，右欄只在選取時顯示。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.ts";
import type { Diagrams, Meta, View } from "../api.ts";
import { diagramsOf, label, listOf } from "../model.ts";
import type { DiagramDef, DiagramKind } from "../model.ts";
import { Diagram } from "../Diagram.tsx";
import { SourceTab } from "../SourceTab.tsx";
import { Columns, SelectionPane } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import "./model.css";

/** 圖依種類分組；沒有圖的種類不顯示。 */
const KINDS: { zh: string; kinds: DiagramKind[] }[] = [
  { zh: "一般檢視", kinds: ["bdd", "req", "uc"] },
  { zh: "內部連接圖", kinds: ["ibd"] },
  { zh: "活動圖", kinds: ["act"] },
  { zh: "狀態機圖", kinds: ["stm"] },
  { zh: "自訂圖", kinds: ["custom"] },
];

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
  const addDiagram = (title: string) => {
    const did = `custom:${Date.now().toString(36)}`;
    saveExtra({ ...extra, custom: [...extra.custom, { id: did, title: title.trim().slice(0, 60) || "自訂圖", members: [] }] });
    p.setSpot({ diagramId: did });
  };
  const diagrams = useMemo(() => diagramsOf(view.analysis, extra), [view, extra]);
  const def: DiagramDef = diagrams.find((d) => d.id === p.spot.diagramId) ?? diagrams[0];
  const selectedId = p.sel?.type === "element" ? p.sel.id : null;
  const selectElement = (eid: string | null) => p.setSel(eid ? { type: "element", id: eid } : null);
  const source = p.spot.source;

  const left = <ModelTree view={view} meta={meta} diagrams={diagrams} diagramId={def.id} selectedId={selectedId} onAddDiagram={readOnly ? undefined : addDiagram}
    onDiagram={(d) => p.setSpot({ diagramId: d })} onCategory={(c) => p.setSel({ type: "new", category: c, parentId: null })} onElement={(eid) => p.setSel({ type: "element", id: eid })} />;

  return (
    <Columns left={left} right={p.sel ? <SelectionPane {...p} /> : undefined}>
      <div className="model-bar">
        <span className="label">{def.code}</span><span className="heading">{def.title}</span>
        <span className="grow" />
        <button className="tbtn" aria-pressed={source} onClick={() => p.setSpot({ source: !source })} title="SysML v2 文字原始碼">{"</>"} 原始碼</button>
      </div>
      <div className={`model-main ${source ? "with-source" : ""}`}>
        <Diagram readOnly={readOnly} view={view} meta={meta} def={def} extra={extra} onExtra={saveExtra} selectedId={selectedId} onSelectElement={selectElement}
          onSelectEdge={(e) => e && p.setSel({ type: "edge", edge: e })} onNew={(c, parentId) => p.setSel({ type: "new", category: c, parentId })}
          onChanged={(v: View) => { p.setView(v); p.onNotice(""); }} onError={p.onNotice} />
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

interface TreeProps {
  view: View; meta: Meta; diagrams: DiagramDef[]; diagramId: string; selectedId: string | null;
  onDiagram: (id: string) => void; onAddDiagram?: (title: string) => void; onCategory: (id: string) => void; onElement: (id: string) => void;
}

/** 左欄：篩選、圖（依種類）、模型元素（支柱 → 類別 → 元素）。篩選時只留名稱或編號符合的項目，並全部展開。 */
function ModelTree({ view, meta, diagrams, onAddDiagram, diagramId, selectedId, onDiagram, onCategory, onElement }: TreeProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({ "k:一般檢視": true, "k:自訂圖": true, requirements: true, structure: true });
  const [q, setQ] = useState("");
  const [naming, setNaming] = useState(false);
  const els = view.analysis.elements;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const needle = q.trim().toLowerCase();
  const hit = (...s: (string | null | undefined)[]) => !needle || s.some((x) => (x ?? "").toLowerCase().includes(needle));
  // 選到的元素所在的支柱與類別自動展開，從別頁跳過來時看得到它
  const picked = selectedId ? els.find((e) => e.id === selectedId) : undefined;
  const pickedCat = picked?.category ? meta.categories.find((c) => c.id === picked.category) : undefined;
  const isOpen = (k: string) => !!needle || !!open[k] || (!!pickedCat && (k === pickedCat.pillar || k === `c:${pickedCat.id}`));
  const finish = (v: string) => { setNaming(false); if (v.trim()) onAddDiagram?.(v); };
  const shownDiagrams = diagrams.filter((d) => hit(d.title, d.code));
  return (
    <>
      <div className="section model-filter">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="篩選名稱或編號" aria-label="篩選圖與模型元素" />
      </div>
      <div className="section">
        <div className="section-head"><h2 className="section-title">圖</h2><span className="label">{shownDiagrams.length}</span></div>
        <ul className="tree">{KINDS.map((k) => {
          const list = shownDiagrams.filter((d) => k.kinds.includes(d.kind));
          const custom = k.kinds.includes("custom");
          if (list.length === 0 && !(custom && onAddDiagram && !needle)) return null;
          const key = `k:${k.zh}`;
          return (
            <li key={k.zh}>
              <button className="tree-row" aria-expanded={isOpen(key)} onClick={() => toggle(key)}><span className="tw">{isOpen(key) ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 500 }}>{k.zh}</span><span className="tc">{list.length}</span></button>
              {isOpen(key) && <ul>
                {list.map((d) => (
                  <li key={d.id}><button className="tree-row" aria-current={d.id === diagramId} onClick={() => onDiagram(d.id)}>
                    <span className="tid">{d.code}</span><span className="tn">{d.title}</span>
                  </button></li>
                ))}
                {custom && onAddDiagram && <li>{naming
                  ? <input className="input" autoFocus placeholder="圖的名稱，例如：任務總覽" maxLength={60} aria-label="新自訂圖的名稱"
                      onKeyDown={(e) => { if (e.key === "Enter") finish((e.target as HTMLInputElement).value); if (e.key === "Escape") setNaming(false); }} onBlur={(e) => finish(e.target.value)} />
                  : <button className="tbtn" onClick={() => setNaming(true)} title="自己決定放哪些項目的圖，任何類別都能放在一起">＋ 新增自訂圖</button>}</li>}
              </ul>}
            </li>
          );
        })}</ul>
      </div>
      <div className="section">
        <div className="section-head"><h2 className="section-title">模型元素</h2><span className="label">{els.filter((e) => e.category).length}</span></div>
        <ul className="tree">{Object.entries(meta.pillars).map(([pid, pzh]) => {
          const cats = meta.categories.filter((c) => c.pillar === pid).map((c) => ({ c, items: listOf(els, c.id).filter((e) => hit(e.name, e.shortName)) }))
            .filter(({ c, items }) => !needle || items.length > 0 || hit(c.zh));
          if (needle && cats.length === 0) return null;
          return (
            <li key={pid}>
              <button className="tree-row" aria-expanded={isOpen(pid)} onClick={() => toggle(pid)}><span className="tw">{isOpen(pid) ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 500 }}>{pzh}</span></button>
              {isOpen(pid) && <ul>{cats.map(({ c, items }) => {
                const k = `c:${c.id}`;
                return (
                  <li key={c.id}>
                    <div style={{ display: "flex" }}>
                      <button className="tree-row" style={{ width: 18 }} aria-label={isOpen(k) ? "收合" : "展開"} aria-expanded={isOpen(k)} onClick={() => toggle(k)} disabled={items.length === 0}><span className="tw">{items.length ? (isOpen(k) ? "−" : "+") : ""}</span></button>
                      <button className="tree-row" onClick={() => onCategory(c.id)} title={`新增${c.zh}`}><span className="tn">{c.zh}</span><span className="tc">{items.length}</span></button>
                    </div>
                    {isOpen(k) && <ul>{items.map((e) => (
                      <li key={e.id}><button className="tree-row" aria-current={e.id === selectedId} onClick={() => onElement(e.id)} title={label(e)}>
                        <span className="tn">{e.name}</span>{e.shared && <span className="tid">共用</span>}{e.shortName && <span className="tid">{e.shortName}</span>}
                      </button></li>
                    ))}</ul>}
                  </li>
                );
              })}</ul>}
            </li>
          );
        })}</ul>
      </div>
    </>
  );
}
