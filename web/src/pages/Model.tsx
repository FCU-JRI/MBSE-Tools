// 模型（C＋D，照固定翼無人機框架示意重做）：預設打開「模型地圖」，一層一列；點框打開那一層的層級圖。
// 左欄是產品架構樹，中間是固定區帶、自動排版的層級圖或元素說明頁，右欄編輯，原始碼收成下方抽屜。
// 圖上不拉線、不拖拉；新增用各區帶右上的「＋」或右欄。名稱列「匯出 ▾」匯出目前這張層級圖（SVG／PNG）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { api } from "../api.ts";
import type { View } from "../api.ts";
import { SourceTab } from "../SourceTab.tsx";
import { Columns, SelectionPane } from "../layout.tsx";
import type { PageProps, TableGroup } from "../workspace.ts";
import { downloadPng, downloadSvg } from "../download.ts";
import { buildModel } from "./model/views.ts";
import type { Model } from "./model/views.ts";
import { specFor, viewStats } from "./model/layout.ts";
import type { Add, Go } from "./model/layout.ts";
import { LayerDiagram, svgForExport } from "./model/LayerDiagram.tsx";
import { ProductTree } from "./model/ProductTree.tsx";
import { ElementPage } from "./model/ElementPage.tsx";
import "./model.css";

/** spot.diagramId：map＝模型地圖、L1／L2／p:<零件定義 id>＝那一層、e:<元素 id>＝元素說明頁。其他（舊版的圖代號）一律回到模型地圖。 */
function current(M: Model, k: string): string {
  if (k === "map" || M.V.has(k)) return k;
  if (k.startsWith("e:") && M.U.has(k.slice(2))) return k;
  return "map";
}

export function ModelPage(p: PageProps) {
  const { id, view, readOnly } = p;
  const M = useMemo(() => buildModel(view), [view]);
  const k = current(M, p.spot.diagramId);
  const open = useCallback((to: string) => p.setSpot({ diagramId: to }), [p.setSpot]); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedId = p.sel?.type === "element" ? p.sel.id : null;
  const source = p.spot.source;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [busy, setBusy] = useState(false);

  const onGo = (g: Go) => {
    if ("view" in g) open(g.view);
    else if ("table" in g) p.go("tables", g.table as TableGroup);
    else p.setSel({ type: "element", id: g.el });
  };
  const onAdd = readOnly ? undefined : (a: Add) => p.setSel({ type: "new", category: a.category, parentId: null });
  const openElement = (eid: string) => { p.setSel({ type: "element", id: eid }); open(`e:${eid}`); };

  // 復原、重做（MOD-13）：名稱列的按鈕與 Ctrl+Z／Ctrl+Y
  const step = async (dir: "undo" | "redo") => {
    if (readOnly || busy || !view.history?.[dir]) return;
    setBusy(true);
    try { p.setView(await api<View>(`/projects/${id}/${dir}`, "POST", {})); p.onNotice(""); } catch (e) { p.onNotice((e as Error).message); } finally { setBusy(false); }
  };
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable],.cm-editor")) return;
      const key = e.key.toLowerCase(), dir = key === "z" ? (e.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
      if (!dir) return;
      e.preventDefault(); stepRef.current(dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const spec = k.startsWith("e:") ? null : specFor(M, k);
  const title = k === "map" ? "模型地圖" : k.startsWith("e:") ? M.U.get(k.slice(2))?.name ?? "" : M.V.get(k)?.title ?? "";
  const left = <ProductTree M={M} current={k} onView={open} onElement={openElement} />;
  return (
    <Columns left={left} right={p.sel ? <SelectionPane {...p} /> : undefined}>
      <div className="model-bar">
        <Crumbs M={M} k={k} onView={open} />
        <span className="grow" />
        {selectedId && !k.startsWith("e:") && <button className="tbtn" onClick={() => open(`e:${selectedId}`)} title="這個元素的為什麼、判定條件、欄位與被誰引用">說明頁 →</button>}
        {!readOnly && <>
          <button className="tbtn" disabled={busy || !view.history?.undo} onClick={() => step("undo")} title="回到上一步（對模型的修改），Ctrl+Z">↶ 復原</button>
          <button className="tbtn" disabled={busy || !view.history?.redo} onClick={() => step("redo")} title="把剛才復原的那一步做回來，Ctrl+Y">↷ 重做</button>
        </>}
        {spec && <ExportMenu svg={svgRef} name={title} />}
        <button className="tbtn" aria-pressed={source} onClick={() => p.setSpot({ source: !source })} title="SysML v2 文字原始碼">{"</>"} 原始碼</button>
      </div>
      <div className={`model-main ${source ? "with-source" : ""}`}>
        <div className="ld-scroll">
          {spec
            ? <>
                <h2 className="heading ld-title">{title}</h2>
                <p className="body muted ld-note">{note(M, k)}</p>
                <Legend />
                <div className="ld-canvas"><LayerDiagram ref={svgRef} spec={spec} selectedId={selectedId} onGo={onGo} onAdd={onAdd} /></div>
              </>
            : <ElementPage M={M} id={k.slice(2)} onElement={openElement} onView={open} />}
        </div>
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

/** 麵包屑：從「模型地圖」開始 */
function Crumbs({ M, k, onView }: { M: Model; k: string; onView: (k: string) => void }) {
  const el = k.startsWith("e:") ? M.U.get(k.slice(2)) : undefined;
  const vk = el ? M.where(el.id) : k === "map" ? null : k;
  const chain: { k: string; short: string }[] = [];
  for (let v = vk ? M.V.get(vk) : undefined; v; v = v.parent ? M.V.get(v.parent) : undefined) chain.unshift({ k: v.k, short: v.short });
  const items = [{ k: "map", short: "模型地圖" }, ...chain];
  return (
    <nav className="ld-crumb" aria-label="目前位置">
      {items.map((c, i) => {
        const last = i === items.length - 1 && !el;
        return <span key={c.k}>{i > 0 && " › "}{last ? <span aria-current="page">{c.short}</span> : <button type="button" className="ld-crumb-link" onClick={() => onView(c.k)}>{c.short}</button>}</span>;
      })}
      {el && <> › <span aria-current="page">{el.sn || el.name}</span></>}
    </nav>
  );
}

function note(M: Model, k: string): string {
  if (k === "map") return "整個模型依產品架構展開：上兩列是任務定義與任務剖面，下面是系統、次系統、元件。每個框標出該層需求數、待驗證數、決策狀態與質量配額；點框打開那一層。左欄是同一棵樹，可以收合。";
  if (k === "L1") return "從需求書萃取利害關係人與關注，經使用情境、需要、目標、MOE，推到任務需求（黃框，交給第 2 層）。細線是追溯關係。點框在右欄編輯。";
  if (k === "L2") return "剖面本身就是設計：候選剖面進方案比較與風險，風險回頭修正方案（橘虛線），決策放行後才展開成節點與模式。每個節點「要做到什麼」交給第 3 層寫系統需求。";
  const v = M.V.get(k)!, s = viewStats(M, k), drill = (M.U.get(v.owner ?? "")?.kids ?? []).some((c) => M.V.has(`p:${c}`));
  return `白框是上一層給的配額與需求。本層 ${s.reqs} 條需求（${s.pend} 條待驗證）${s.hold.length ? `，決策 ${s.hold.map((d) => d.sn || d.name).join("、")} 喊卡中` : ""}。點框在右欄編輯${drill ? "，點有「▸」的零件打開下一層" : ""}；〔表〕框跳到對應的表。`;
}

function Legend() {
  return (
    <div className="ld-legend">
      <span><i className="sw sw-in" />白：上一層給的</span><span><i className="sw sw-build" />綠：本層建構</span><span><i className="sw sw-out" />黃：往下一層的產出</span>
      <span><i className="sw sw-table" />〔表〕工具產生的表</span>
      <span>銳角＝定義　圓角＝用法　虛線＝相依（derive）　實線＝先後　◆＝組成　□─□＝有方向的介面　<span className="ld-fb">橘虛線＝風險回頭修正</span>　<span className="ld-bad">紅＝兩端不一致</span></span>
    </div>
  );
}

/** 名稱列的「匯出 ▾」：目前這張層級圖存成 SVG 或 PNG（MOD-12），白底、配色同圖例。 */
function ExportMenu({ svg, name }: { svg: RefObject<SVGSVGElement | null>; name: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const file = name.replace(/[\\/:*?"<>|\s]+/g, "_") || "層級圖";
  const run = (kind: "svg" | "png") => { setOpen(false); if (!svg.current) return; const s = svgForExport(svg.current); void (kind === "svg" ? downloadSvg(s, file) : downloadPng(s, file)); };
  return (
    <div className="export-menu" ref={ref}>
      <button className="tbtn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="把這張層級圖匯出成檔案，放進審查報告">匯出 ▾</button>
      {open && (
        <div className="ctx-menu" role="menu">
          <button role="menuitem" onClick={() => run("svg")}>SVG（向量，可縮放）</button>
          <button role="menuitem" onClick={() => run("png")}>PNG（圖片）</button>
        </div>
      )}
    </div>
  );
}
