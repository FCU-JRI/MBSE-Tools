// 模型頁中間（MOD-02）：左欄點了某層的類別，在這裡列出屬於該層的元素（可切換看全專案）；點元素在右欄打開。
import { useState } from "react";
import type { Meta, View } from "../../api.ts";
import { listOf } from "../../model.ts";
import type { ListSpec } from "./LayerTree.tsx";

interface Props {
  view: View; meta: Meta; spec: ListSpec; selectedId: string | null; readOnly?: boolean;
  onElement: (id: string) => void; onNew: (category: string) => void; onClose: () => void;
}

export function CategoryList({ view, meta, spec, selectedId, readOnly, onElement, onNew, onClose }: Props) {
  const category = spec.category;
  const cat = meta.categories.find((c) => c.id === category);
  const [whole, setWhole] = useState(false);
  const all = listOf(view.analysis.elements, category);
  const mine = spec.ids ? new Set(spec.ids) : null;
  const items = mine && !whole ? all.filter((e) => mine.has(e.id)) : all;
  const parentName = (id: string | null) => (id ? view.analysis.elements.find((e) => e.id === id)?.name ?? "" : "");
  return (
    <section className="cat-list" aria-label={`${cat?.zh ?? category}列表`} data-list={category} data-layer={spec.layer} data-scope={mine && !whole ? "layer" : "all"}>
      <div className="section-head">
        <h2 className="section-title">{cat?.zh ?? category}</h2><span className="label">{mine && !whole ? spec.layerZh : "全專案"} · {items.length}</span>
        <span className="grow" />
        {mine && <button className="tbtn" aria-pressed={whole} onClick={() => setWhole(!whole)} title="本層＝有 @LayerTag 標記或連到本層對象、需求、設計方案的元素（和本層 FMEA 同一套規則）">{whole ? `只看${spec.layerZh}` : `看全專案（${all.length}）`}</button>}
        <button className="tbtn" onClick={onClose}>回到圖</button>
      </div>
      {cat?.help && <p className="caption">{cat.help}</p>}
      {items.length === 0 ? <p className="body muted">還沒有{cat?.zh ?? category}。</p> : (
        <table className="cat-table">
          <thead><tr><th>編號</th><th>名稱</th><th>上層</th><th>說明</th></tr></thead>
          <tbody>{items.map((e) => (
            <tr key={e.id} aria-selected={e.id === selectedId} onClick={() => onElement(e.id)} tabIndex={0} onKeyDown={(ev) => { if (ev.key === "Enter") onElement(e.id); }}>
              <td className="data">{e.shortName ?? "—"}</td><td>{e.name}{e.shared && <span className="tid"> 共用</span>}</td><td className="caption">{parentName(e.owner)}</td><td className="caption">{e.doc.slice(0, 80)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {!readOnly && cat && !cat.special && <div className="tbtn-row" style={{ paddingLeft: 0, marginTop: 12 }}><button className="tbtn" onClick={() => onNew(category)}>＋ 新增{cat.zh}</button></div>}
    </section>
  );
}
