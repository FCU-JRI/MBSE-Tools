// 模型頁左欄（MOD-02）：最上方搜尋 → 框架檔的各層（由上而下）→ 最下方「全部（依類型）」。
// 每層標題帶該層的進度、審查節點進度與「現在」；層底下只有兩層：該層會產生的類別（點了在中間列出元素）＋該層設計迴圈的對象。
// 層名、順序、類別都來自框架檔；進度、對象走到第幾步、卡點警告都用伺服器算好的 view.framework。
import { useEffect, useState } from "react";
import type { Meta, View } from "../../api.ts";
import { label, listOf } from "../../model.ts";
import type { DiagramDef, DiagramKind } from "../../model.ts";
import { fwOf } from "../../Process.tsx";
import type { FwLayer, FwObject } from "../../Process.tsx";
import { fileLayers, layerProduces } from "./framework.ts";

/** 「全部（依類型）」裡的圖依種類分組；沒有圖的種類不顯示。 */
const KINDS: { zh: string; kinds: DiagramKind[] }[] = [
  { zh: "一般檢視", kinds: ["bdd", "req", "uc"] },
  { zh: "內部連接圖", kinds: ["ibd"] },
  { zh: "活動圖", kinds: ["act"] },
  { zh: "狀態機圖", kinds: ["stm"] },
  { zh: "自訂圖", kinds: ["custom"] },
];

export interface ListSpec { category: string; layer: string; layerZh: string; ids: string[] | null }

export interface TreeProps {
  view: View; meta: Meta; diagrams: DiagramDef[]; diagramId: string; selectedId: string | null;
  /** 中間正在列出的類別（ids＝本層的元素；null＝全專案） */
  listCat: ListSpec | null;
  onDiagram: (id: string) => void; onAddDiagram?: (title: string) => void;
  onList: (spec: ListSpec) => void; onCategory: (id: string) => void; onElement: (id: string) => void;
}

/** 對象的迴圈進度：第幾步／共幾步與步驟名稱；走完時回傳 null */
function loopStep(o: FwObject) {
  const i = o.steps.findIndex((s) => s.id === o.current);
  if (o.passed || i < 0) return null;
  return { n: i + 1, total: o.steps.length, zh: o.steps[i].zh, issues: o.steps[i].issues };
}

export function LayerTree(p: TreeProps) {
  const { view, meta } = p;
  const fw = fwOf(view);
  const els = view.analysis.elements;
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  // 層的資料：有 view.framework 用它（含進度），模型有錯時只用框架檔的層名
  const layers: (FwLayer | { id: string; order: number; zh: string; kind: "chain" | "loop"; objects?: undefined })[] = fw ? fw.layers : fileLayers();
  const current = fw?.layers.find((l) => !l.passed)?.id ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current] : []));
  useEffect(() => { if (current) setOpen((o) => (o.has(current) ? o : new Set([...o, current]))); }, [current]);
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const catZh = (c: string) => meta.categories.find((x) => x.id === c)?.zh ?? c;

  return (
    <>
      <div className="section model-filter">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名稱或編號" aria-label="搜尋圖與模型元素" />
      </div>
      {needle ? <SearchResults {...p} needle={needle} /> : <>
        <div className="section model-layers" aria-label="依框架的層">
          <ul className="tree">{layers.map((l) => {
            const fl = fw ? (l as FwLayer) : null;
            // 數量照層級只算本層（伺服器 layerMembers，和本層 FMEA 同一套規則）；模型有錯時才退回全專案數量
            const members = (fl as (FwLayer & { members?: Record<string, string[]> }) | null)?.members;
            const cats = layerProduces(l.id).filter((c) => meta.categories.some((x) => x.id === c)).map((c) => ({ c, n: members ? members[c]?.length ?? 0 : listOf(els, c).length }));
            const objs = fl?.objects ?? [];
            // 還沒開始：迴圈層看有沒有對象；鏈狀層看本層產生的類別有沒有元素
            const empty = l.kind === "loop" && fl ? objs.every((o) => !o.id) && (objs.length === 0 || cats.every((x) => x.n === 0)) : cats.every((x) => x.n === 0);
            const isOpen = open.has(l.id);
            const holds = (fw?.holdPoints ?? []).filter((h) => h.fromLayer === l.id && !h.open);
            const gate = fl?.gate ? view.gates.find((g) => g.id === fl.gate) : undefined;
            const progress = !fl ? "" : fl.kind === "loop"
              ? (objs.length ? `走完 ${objs.filter((o) => o.passed).length}／${objs.length}` : "")
              : `步驟 ${fl.steps.filter((s) => s.done === true).length}／${fl.steps.length}`;
            const nowStep = fl && fl.kind === "chain" ? fl.steps.find((s) => s.state === "current") : undefined;
            return (
              <li key={l.id} className={`model-layer ${l.id === current ? "now" : ""}`} data-layer={l.id} data-empty={empty || undefined}>
                <button className="tree-row layer-row" aria-expanded={isOpen} onClick={() => toggle(l.id)}>
                  <span className="tw">{isOpen ? "−" : "+"}</span>
                  <span className="tn"><span className="tid">{l.order}</span> {l.zh}</span>
                  {l.id === current && <span className="tag done" data-now>現在</span>}
                  {fl?.passed && <span className="tc" title="這層已走完">✓</span>}
                </button>
                <div className="layer-meta caption">
                  {empty ? <span className="muted" data-not-started>還沒開始</span> : progress && <span className="data">{progress}</span>}
                  {gate && <span className="data" title={`${gate.zh}（${gate.en}）的檢查項目`} data-gate={gate.id}>{gate.en} {gate.done}／{gate.total}</span>}
                </div>
                {isOpen && <ul>
                  {holds.map((h) => <li key={h.category} className="layer-warn caption" data-hold={h.category} title={h.reason}><span className="tag warn">卡點</span> 新增{h.zh}會有警告</li>)}
                  {nowStep && <li className="caption layer-now">現在：{nowStep.zh}{nowStep.issues.length ? <span className="muted">（還缺 {nowStep.issues.length} 項）</span> : null}</li>}
                  {cats.length > 0 && <li className="layer-group" data-group="categories">
                    <span className="label">類別</span>
                    <ul>{cats.map(({ c, n }) => (
                      <li key={c}><button className="tree-row" aria-current={p.listCat?.category === c && p.listCat.layer === l.id} onClick={() => p.onList({ category: c, layer: l.id, layerZh: l.zh, ids: members?.[c] ?? null })} title={`本層的${catZh(c)}：${n} 個，點了在中間列出`} data-cat={c}>
                        <span className="tn">{catZh(c)}</span><span className="tc">{n}</span>
                      </button></li>
                    ))}</ul>
                  </li>}
                  {objs.length > 0 && <li className="layer-group" data-group="objects">
                    <span className="label">設計迴圈</span>
                    <ul>{objs.map((o, i) => {
                      const st = loopStep(o);
                      return (
                        <li key={o.id ?? `mission:${i}`} data-object={o.id ?? "mission"}>
                          <button className="tree-row" aria-current={!!o.id && o.id === p.selectedId} disabled={!o.id} onClick={() => o.id && p.onElement(o.id)}
                            title={st ? `走到第 ${st.n} 步「${st.zh}」` : "迴圈已走完（是否符合需求＝是）"}>
                            <span className="tn">{o.name}</span>
                            <span className="tid" data-step={st ? st.n : "done"}>{st ? `${st.n}／${st.total} ${st.zh}` : "✓ 走完"}</span>
                          </button>
                          {st && st.issues.length > 0 && <p className="caption loop-warn" data-warn={st.issues.length} title={st.issues.map((x) => x.text).join("\n")}>
                            <span className="tag warn">⚠ {st.issues.length}</span> {st.issues[0].text}
                          </p>}
                        </li>
                      );
                    })}</ul>
                  </li>}
                </ul>}
              </li>
            );
          })}</ul>
        </div>
        <AllByType {...p} open={open.has("all")} onToggle={() => toggle("all")} />
      </>}
    </>
  );
}

/** 搜尋：圖與元素一起列，點了就打開 */
function SearchResults(p: TreeProps & { needle: string }) {
  const hit = (...s: (string | null | undefined)[]) => s.some((x) => (x ?? "").toLowerCase().includes(p.needle));
  const ds = p.diagrams.filter((d) => hit(d.title, d.code));
  const es = p.view.analysis.elements.filter((e) => e.category && hit(e.name, e.shortName));
  const catZh = (c: string | null) => p.meta.categories.find((x) => x.id === c)?.zh ?? "";
  return (
    <div className="section" aria-label="搜尋結果">
      <div className="section-head"><h2 className="section-title">搜尋結果</h2><span className="label">{ds.length + es.length}</span></div>
      {ds.length + es.length === 0 && <p className="caption muted">沒有符合的項目。</p>}
      <ul className="tree">
        {ds.map((d) => <li key={d.id}><button className="tree-row" aria-current={d.id === p.diagramId} onClick={() => p.onDiagram(d.id)}><span className="tid">{d.code}</span><span className="tn">{d.title}</span><span className="tc">圖</span></button></li>)}
        {es.slice(0, 200).map((e) => <li key={e.id}><button className="tree-row" aria-current={e.id === p.selectedId} onClick={() => p.onElement(e.id)} title={label(e)}>
          {e.shortName && <span className="tid">{e.shortName}</span>}<span className="tn">{e.name}</span><span className="tc">{catZh(e.category)}</span>
        </button></li>)}
      </ul>
    </div>
  );
}

/** 最下方「全部（依類型）」：圖（依種類）與模型元素（支柱 → 類別 → 元素）。預設收合。 */
function AllByType({ view, meta, diagrams, onAddDiagram, diagramId, selectedId, onDiagram, onCategory, onElement, open: allOpen, onToggle }: TreeProps & { open: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({ "k:一般檢視": true, "k:自訂圖": true });
  const [naming, setNaming] = useState(false);
  const els = view.analysis.elements;
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const finish = (v: string) => { setNaming(false); if (v.trim()) onAddDiagram?.(v); };
  return (
    <div className="section model-all" data-group="all">
      <button className="tree-row layer-row" aria-expanded={allOpen} onClick={onToggle}><span className="tw">{allOpen ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 600 }}>全部（依類型）</span><span className="tc">{els.filter((e) => e.category).length}</span></button>
      {allOpen && <ul className="tree">
        <li><span className="label">圖</span>
          <ul>{KINDS.map((k) => {
            const list = diagrams.filter((d) => k.kinds.includes(d.kind));
            const custom = k.kinds.includes("custom");
            if (list.length === 0 && !(custom && onAddDiagram)) return null;
            const key = `k:${k.zh}`;
            return (
              <li key={k.zh}>
                <button className="tree-row" aria-expanded={!!open[key]} onClick={() => toggle(key)}><span className="tw">{open[key] ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 500 }}>{k.zh}</span><span className="tc">{list.length}</span></button>
                {open[key] && <ul>
                  {list.map((d) => (
                    <li key={d.id}><button className="tree-row" aria-current={d.id === diagramId} onClick={() => onDiagram(d.id)}><span className="tid">{d.code}</span><span className="tn">{d.title}</span></button></li>
                  ))}
                  {custom && onAddDiagram && <li>{naming
                    ? <input className="input" autoFocus placeholder="圖的名稱，例如：任務總覽" maxLength={60} aria-label="新自訂圖的名稱"
                        onKeyDown={(e) => { if (e.key === "Enter") finish((e.target as HTMLInputElement).value); if (e.key === "Escape") setNaming(false); }} onBlur={(e) => finish(e.target.value)} />
                    : <button className="tbtn" onClick={() => setNaming(true)} title="自己決定放哪些項目的圖，任何類別都能放在一起">＋ 新增自訂圖</button>}</li>}
                </ul>}
              </li>
            );
          })}</ul>
        </li>
        <li><span className="label">模型元素</span>
          <ul>{Object.entries(meta.pillars).map(([pid, pzh]) => {
            const cats = meta.categories.filter((c) => c.pillar === pid).map((c) => ({ c, items: listOf(els, c.id) }));
            return (
              <li key={pid}>
                <button className="tree-row" aria-expanded={!!open[pid]} onClick={() => toggle(pid)}><span className="tw">{open[pid] ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 500 }}>{pzh}</span></button>
                {open[pid] && <ul>{cats.map(({ c, items }) => {
                  const k = `c:${c.id}`;
                  return (
                    <li key={c.id}>
                      <div style={{ display: "flex" }}>
                        <button className="tree-row" style={{ width: 18 }} aria-label={open[k] ? "收合" : "展開"} aria-expanded={!!open[k]} onClick={() => toggle(k)} disabled={items.length === 0}><span className="tw">{items.length ? (open[k] ? "−" : "+") : ""}</span></button>
                        <button className="tree-row" onClick={() => onCategory(c.id)} title={`新增${c.zh}`}><span className="tn">{c.zh}</span><span className="tc">{items.length}</span></button>
                      </div>
                      {open[k] && <ul>{items.map((e) => (
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
        </li>
      </ul>}
    </div>
  );
}
