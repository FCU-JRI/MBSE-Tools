// 模型頁中間：類別的元素清單（取代畫布）、分析圖上方的「要回答什麼／還缺什麼」、N² 矩陣。
import { useMemo, useState } from "react";
import type { Meta, View } from "../../api.ts";
import { listOf } from "../../model.ts";
import { LAYERS, layerOf, n2Matrix } from "./method.ts";
import type { Layer, MethodView } from "./method.ts";

/** 點左欄的類別：中間列出這個類別的所有元素。 */
export function CategoryList({ view, meta, cat, selectedId, readOnly, onElement, onNew }: { view: View; meta: Meta; cat: string; selectedId: string | null; readOnly: boolean; onElement: (id: string) => void; onNew: () => void }) {
  const c = meta.categories.find((x) => x.id === cat);
  const items = listOf(view.analysis.elements, cat);
  return (
    <div className="center-scroll cat-list">
      <div className="section-head">
        <h2 className="section-title">{c?.zh ?? cat}<span className="faint"> {c?.en}</span></h2><span className="label">{items.length}</span>
        <span className="grow" />
        {!readOnly && <button className="tbtn" onClick={onNew}>＋ 新增{c?.zh}</button>}
      </div>
      {c && <p className="caption">{c.help}</p>}
      {items.length === 0 ? <p className="body muted">還沒有{c?.zh}。{readOnly ? "" : `按右上「＋ 新增${c?.zh}」建立第一個。`}</p> : (
        <table className="table">
          <thead><tr><th style={{ width: "8rem" }}>編號</th><th>名稱</th><th>{c?.keyword === "requirement" ? "內容" : "說明"}</th></tr></thead>
          <tbody>{items.map((e) => (
            <tr key={e.id} className={e.id === selectedId ? "is-selected" : ""} onClick={() => onElement(e.id)} style={{ cursor: "pointer" }}>
              <td className="data">{e.shortName ?? "—"}</td>
              <td><button className="linklike" onClick={(ev) => { ev.stopPropagation(); onElement(e.id); }}>{e.name}</button></td>
              <td className="caption">{e.doc.length > 90 ? e.doc.slice(0, 90) + "…" : e.doc}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

/** 分析圖上方：這一步要回答什麼、還缺什麼；方案比較與 FMEA 依層篩選；介面切換 N² 矩陣。 */
export function MethodHead({ view, m, layers, setLayers, mode, setMode, onElement }: {
  view: View; m: MethodView; layers: Set<Layer | "none">; setLayers: (s: Set<Layer | "none">) => void;
  mode: "diagram" | "n2"; setMode: (m: "diagram" | "n2") => void; onElement: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const miss = useMemo(() => (view.analysis.ok ? m.missing(view.analysis) : []), [view.analysis, m]);
  const shown = all ? miss : miss.slice(0, 4);
  const flip = (l: Layer | "none") => { const n = new Set(layers); if (n.has(l)) n.delete(l); else n.add(l); setLayers(n); };
  return (
    <div className="method-head" role="region" aria-label="這一步要回答什麼">
      <p className="body"><span className="label">這一步要回答什麼</span> {m.question}</p>
      <div className="method-miss">
        <span className="label">還缺什麼</span>
        {miss.length === 0 ? <span className="tag done">都有了</span> : <>
          {shown.map((x, i) => x.id
            ? <button key={i} className="linklike caption" onClick={() => onElement(x.id!)}>{x.text}</button>
            : <span key={i} className="caption">{x.text}</span>)}
          {miss.length > 4 && <button className="tbtn" onClick={() => setAll(!all)}>{all ? "收起" : `還有 ${miss.length - 4} 項`}</button>}
        </>}
      </div>
      {m.gap && <p className="caption"><span className="tag warn">待定</span> {m.gap}</p>}
      {(m.layered || m.n2) && (
        <div className="method-tools">
          {m.layered && <><span className="label">依層篩選</span>
            {[...LAYERS, { id: "none" as const, zh: "未分層" }].map((l) => <button key={l.id} className="tbtn" aria-pressed={layers.has(l.id)} onClick={() => flip(l.id)}>{l.zh}</button>)}
            {layers.size > 0 && <button className="tbtn" onClick={() => setLayers(new Set())}>全部</button>}
          </>}
          {m.n2 && <><span className="label">顯示</span>
            <button className="tbtn" aria-pressed={mode === "diagram"} onClick={() => setMode("diagram")}>圖</button>
            <button className="tbtn" aria-pressed={mode === "n2"} onClick={() => setMode("n2")}>N² 矩陣</button>
          </>}
        </div>
      )}
    </div>
  );
}

/** 依層篩選：沒有勾任何層就全部顯示。 */
export const layerFilter = (view: View, layers: Set<Layer | "none">) =>
  layers.size === 0 ? undefined : (id: string) => layers.has(layerOf(view.analysis, id) ?? "none");

/** N² 矩陣：由模型的連接自動產生，不手畫。 */
export function N2({ view, onElement }: { view: View; onElement: (id: string) => void }) {
  const { parts, cell } = useMemo(() => n2Matrix(view.analysis), [view.analysis]);
  if (parts.length === 0) return <div className="center-scroll"><p className="body muted">還沒有介面。在內部連接圖上把兩個零件連起來，這裡就會出現。</p></div>;
  return (
    <div className="center-scroll">
      <p className="caption">對角線是零件；格子（列 A、欄 B）是從 A 連到 B 的連接數。由模型自動產生。</p>
      <table className="table n2"><tbody>
        {parts.map((a) => (
          <tr key={a.id}>{parts.map((b) => a.id === b.id
            ? <th key={b.id} scope="row"><button className="linklike" onClick={() => onElement(a.id)}>{a.name}</button></th>
            : <td key={b.id} className="data">{cell(a.id, b.id) || ""}</td>)}
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}
