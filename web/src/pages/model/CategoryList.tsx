// 模型頁中間（MOD-02）：左欄點了某層的類別，在這裡列出該類別的全部元素；點元素在右欄打開。
import type { Meta, View } from "../../api.ts";
import { listOf } from "../../model.ts";

interface Props {
  view: View; meta: Meta; category: string; selectedId: string | null; readOnly?: boolean;
  onElement: (id: string) => void; onNew: (category: string) => void; onClose: () => void;
}

export function CategoryList({ view, meta, category, selectedId, readOnly, onElement, onNew, onClose }: Props) {
  const cat = meta.categories.find((c) => c.id === category);
  const items = listOf(view.analysis.elements, category);
  const parentName = (id: string | null) => (id ? view.analysis.elements.find((e) => e.id === id)?.name ?? "" : "");
  return (
    <section className="cat-list" aria-label={`${cat?.zh ?? category}列表`} data-list={category}>
      <div className="section-head">
        <h2 className="section-title">{cat?.zh ?? category}</h2><span className="label">{items.length}</span>
        <span className="grow" />
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
