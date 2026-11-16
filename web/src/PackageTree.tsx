import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Analysis, Element } from "./api.ts";
import { ancestorsOf, isPackage, treeOf } from "./model.ts";
import { PACKAGE_ZH, zhKeyword } from "./method/zh.ts";

/**
 * 依套件瀏覽的樹（F-74）：最上層套件 → 成員，依擁有關係往下展開。
 * 只畫出展開的部分，幾千個元素的模型也不會一次全畫。
 * scopeId：表目前列的是哪個套件；selectedId：目前選到的元素。
 */
export function PackageTree({ analysis, selectedId, scopeId, onPick }: { analysis: Analysis; selectedId: string | null; scopeId: string | null; onPick: (e: Element) => void }) {
  const tree = useMemo(() => treeOf(analysis), [analysis]);
  const roots = tree.children.get(null) ?? [];
  // 最上層只有一兩個套件時先展開一層，不然一進來只看到一列
  const [open, setOpen] = useState<Set<string>>(() => new Set(roots.length <= 3 ? roots.map((r) => r.id) : []));
  const [q, setQ] = useState("");
  // 從表、圖或搜尋選到元素時，把它的上層展開，樹上才看得到它
  useEffect(() => {
    if (!selectedId) return;
    const up = ancestorsOf(tree, selectedId);
    setOpen((o) => (up.every((id) => o.has(id)) ? o : new Set([...o, ...up])));
  }, [selectedId, tree]);
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // 中文化（P2）：關鍵字中文在前、英文小字在後；工具建立的套件加上中文名稱
  const kw = (e: Element) => { const k = zhKeyword(e.keyword); return k.zh ? <>{k.zh} <small className="en">{k.en}</small></> : e.keyword; };
  const pkgZh = (e: Element) => (isPackage(e) && e.qualifiedName.split("::").length === 2 ? PACKAGE_ZH[e.name] : undefined);
  const row = (e: Element, hint?: string): ReactNode => (
    <button className={`tree-row ${e.unnamed ? "unnamed" : ""}`} aria-current={e.id === selectedId || (!selectedId && e.id === scopeId)} onClick={() => onPick(e)} title={`${e.keyword ?? ""} ${e.qualifiedName}`}>
      <span className="tid">{kw(e)}</span><span className="tn">{pkgZh(e) ? <>{pkgZh(e)} <small className="faint">{e.name}</small></> : e.name}{hint && <span className="faint">　{hint}</span>}</span>
      {e.shared && <span className="tid">共用</span>}{e.shortName && <span className="tid">{e.shortName}</span>}{isPackage(e) && <span className="tc">{tree.named.get(e.id) ?? 0}</span>}
    </button>
  );
  const level = (parent: string | null): ReactNode => (
    <ul className={parent === null ? "tree" : undefined}>{(tree.children.get(parent) ?? []).map((e) => {
      const kids = tree.children.get(e.id)?.length ?? 0;
      return (
        <li key={e.id}>
          <div style={{ display: "flex" }}>
            <button className="tree-row" style={{ width: 18 }} aria-label={open.has(e.id) ? "收合" : "展開"} aria-expanded={open.has(e.id)} onClick={() => toggle(e.id)} disabled={kids === 0}><span className="tw">{kids ? (open.has(e.id) ? "−" : "+") : ""}</span></button>
            {row(e)}
          </div>
          {kids > 0 && open.has(e.id) && level(e.id)}
        </li>
      );
    })}</ul>
  );

  const text = q.trim().toLowerCase();
  const hits = text ? tree.all.filter((e) => e.name.toLowerCase().includes(text) || (e.shortName ?? "").toLowerCase().includes(text)) : [];
  return (
    <>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名稱或編號" aria-label="搜尋模型元素" style={{ marginBottom: 8 }} />
      {text ? (
        <>
          <p className="caption" style={{ marginBottom: 4 }}>{hits.length} 個符合{hits.length > 100 ? "，顯示前 100 個" : ""}</p>
          <ul className="tree">{hits.slice(0, 100).map((e) => <li key={e.id}>{row(e, tree.byId.get(e.parent ?? "")?.name)}</li>)}</ul>
        </>
      ) : level(null)}
    </>
  );
}
