// 模型頁左欄（路徑圖白板「網頁左側欄：建議」）：最上方搜尋 → 7 個階段 → 最下方「全部（依類型）」預設收合。
// 只有兩層：階段 → 類別（帶數量）。點類別，中間列出元素；不在左欄展開到元素。
import { useState } from "react";
import type { Gate, Meta, View } from "../../api.ts";
import { label, listOf } from "../../model.ts";
import type { DiagramDef, DiagramKind } from "../../model.ts";
import { MARK, METHOD_VIEWS, STAGES, THROUGHOUT, currentStage, isMethodId, methodId } from "./method.ts";
import type { Stage } from "./method.ts";

const KINDS: { zh: string; kinds: DiagramKind[] }[] = [
  { zh: "一般檢視", kinds: ["bdd", "req", "uc"] },
  { zh: "內部連接圖", kinds: ["ibd"] },
  { zh: "活動圖", kinds: ["act"] },
  { zh: "狀態機圖", kinds: ["stm"] },
  { zh: "自訂圖", kinds: ["custom"] },
];
const AUTO: DiagramKind[] = ["ibd", "act", "stm"];
const GATE_SHORT: Record<string, string> = { proposal: "計畫提案" };

export interface SidebarProps {
  view: View; meta: Meta; diagrams: DiagramDef[];
  /** 中間正在看的圖；正在看類別清單時為 null */
  diagramId: string | null;
  listCat: string | null;
  selectedId: string | null;
  onDiagram: (id: string) => void;
  onCategory: (cat: string) => void;
  onElement: (id: string) => void;
  onAddDiagram?: (title: string) => void;
}

const gateText = (g: Gate) => `${GATE_SHORT[g.id] ?? g.en} ${g.done}/${g.total}${g.done === g.total ? " ✓" : ""}`;

export function Sidebar(p: SidebarProps) {
  const { view, meta, diagrams, selectedId } = p;
  const els = view.analysis.elements;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const cur = currentStage(view);
  const picked = selectedId ? els.find((e) => e.id === selectedId) : undefined;
  const catZh = (c: string) => meta.categories.find((x) => x.id === c)?.zh ?? c;
  const stageOf = (cat: string | null | undefined) => [...STAGES, THROUGHOUT].find((s) => cat && s.categories.includes(cat))?.no;
  // 目前的階段、正在看的類別或分析圖所在的階段、選到的元素所在的階段：預設展開
  const viewing = p.diagramId && isMethodId(p.diagramId) ? [...STAGES, THROUGHOUT].filter((s) => s.views.some((v) => methodId(v.id) === p.diagramId)).map((s) => s.no) : [];
  const auto = new Set([cur, stageOf(p.listCat), stageOf(picked?.category), ...viewing].filter((x): x is number => x !== undefined));
  const isOpen = (k: string, dflt: boolean) => open[k] ?? dflt;
  const toggle = (k: string, dflt: boolean) => setOpen((o) => ({ ...o, [k]: !(o[k] ?? dflt) }));
  const needle = q.trim().toLowerCase();

  // 零件、活動、狀態機自動產生的圖：選到那個元素（或正在看它的圖）時才出現
  const ctxId = picked?.id ?? diagrams.find((d) => d.id === p.diagramId)?.context ?? null;
  const own = diagrams.filter((d) => AUTO.includes(d.kind) && d.context && (d.context === ctxId || d.id === p.diagramId));

  const stageBlock = (s: Stage) => {
    const key = `s:${s.no}`;
    const cats = s.categories.map((c) => ({ c, n: listOf(els, c).length }));
    const total = cats.reduce((n, x) => n + x.n, 0);
    const g = view.gates.find((x) => x.id === s.gate);
    const on = isOpen(key, auto.has(s.no));
    return (
      <li key={key} className="stage">
        <button className="tree-row stage-head" aria-expanded={on} onClick={() => toggle(key, auto.has(s.no))}>
          <span className="tw">{on ? "▾" : "▸"}</span>
          <span className="tn">{s.no ? `${s.no} ` : ""}{s.title}</span>
          {g && <span className={`tc ${g.done === g.total ? "ok" : ""}`}>{gateText(g)}</span>}
          {s.no === cur && <span className="tid">現在</span>}
          {total === 0 && s.no !== 0 && <span className="tid">還沒開始</span>}
        </button>
        {on && <ul>
          {cats.map(({ c, n }) => (
            <li key={c}><button className="tree-row" aria-current={p.listCat === c} onClick={() => p.onCategory(c)} title={`列出全部${catZh(c)}`}>
              <span className="tn">{catZh(c)}</span><span className="tc">{n}</span>
            </button></li>
          ))}
          {s.views.map((v) => {
            const m = METHOD_VIEWS.find((x) => x.id === v.id)!;
            const did = methodId(m.id);
            if (!diagrams.some((d) => d.id === did)) return null;
            return (
              <li key={`${v.id}${v.note ?? ""}`}><button className="tree-row view-row" aria-current={p.diagramId === did && !v.note} onClick={() => p.onDiagram(did)} title={m.question}>
                <span className="tid">圖</span><span className="tn">{MARK[m.no]} {m.title}{v.note && <span className="faint">（{v.note}）</span>}</span>
              </button></li>
            );
          })}
        </ul>}
      </li>
    );
  };

  return (
    <>
      <div className="section model-filter">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋任何元素（名稱或編號）" aria-label="搜尋模型元素與圖" />
      </div>
      {needle ? <SearchResults {...p} needle={needle} /> : <>
        {own.length > 0 && (
          <div className="section">
            <div className="section-head"><h2 className="section-title">這個元素的圖</h2></div>
            <ul className="tree">{own.map((d) => (
              <li key={d.id}><button className="tree-row" aria-current={d.id === p.diagramId} onClick={() => p.onDiagram(d.id)}><span className="tid">{d.code}</span><span className="tn">{d.title}</span></button></li>
            ))}</ul>
          </div>
        )}
        <div className="section">
          <ul className="tree stages">{STAGES.map(stageBlock)}{stageBlock(THROUGHOUT)}</ul>
        </div>
        <AllByKind {...p} open={isOpen("all", false)} onToggle={() => toggle("all", false)} />
      </>}
    </>
  );
}

function SearchResults(p: SidebarProps & { needle: string }) {
  const hit = (...s: (string | null | undefined)[]) => s.some((x) => (x ?? "").toLowerCase().includes(p.needle));
  const ds = p.diagrams.filter((d) => hit(d.title, d.code));
  const es = p.view.analysis.elements.filter((e) => e.category && e.kind !== "ReferenceUsage" && hit(e.name, e.shortName)).slice(0, 80);
  const catZh = (c: string | null) => p.meta.categories.find((x) => x.id === c)?.zh ?? "";
  return (
    <div className="section">
      <div className="section-head"><h2 className="section-title">搜尋結果</h2><span className="label">{ds.length + es.length}</span></div>
      {ds.length + es.length === 0 && <p className="caption">沒有符合的元素或圖。</p>}
      <ul className="tree">
        {ds.map((d) => <li key={d.id}><button className="tree-row" aria-current={d.id === p.diagramId} onClick={() => p.onDiagram(d.id)}><span className="tid">圖</span><span className="tn">{d.title}</span></button></li>)}
        {es.map((e) => <li key={e.id}><button className="tree-row" aria-current={e.id === p.selectedId} onClick={() => p.onElement(e.id)} title={label(e)}>
          {e.shortName && <span className="tid">{e.shortName}</span>}<span className="tn">{e.name}</span><span className="tc">{catZh(e.category)}</span>
        </button></li>)}
      </ul>
    </div>
  );
}

/** 最下方「全部（依類型，給熟手）」：圖依種類、模型元素依支柱與類別。 */
function AllByKind(p: SidebarProps & { open: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [naming, setNaming] = useState(false);
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const els = p.view.analysis.elements;
  const finish = (v: string) => { setNaming(false); if (v.trim()) p.onAddDiagram?.(v); };
  const plain = p.diagrams.filter((d) => !isMethodId(d.id));
  return (
    <div className="section">
      <button className="tree-row stage-head" aria-expanded={p.open} onClick={p.onToggle}><span className="tw">{p.open ? "▾" : "▸"}</span><span className="tn">全部（依類型，給熟手）</span></button>
      {p.open && <ul className="tree">
        <li><span className="label">圖</span></li>
        {KINDS.map((k) => {
          const list = plain.filter((d) => k.kinds.includes(d.kind));
          const custom = k.kinds.includes("custom");
          if (list.length === 0 && !(custom && p.onAddDiagram)) return null;
          const key = `k:${k.zh}`;
          return (
            <li key={k.zh}>
              <button className="tree-row" aria-expanded={!!open[key]} onClick={() => toggle(key)}><span className="tw">{open[key] ? "−" : "+"}</span><span className="tn">{k.zh}</span><span className="tc">{list.length}</span></button>
              {open[key] && <ul>
                {list.map((d) => <li key={d.id}><button className="tree-row" aria-current={d.id === p.diagramId} onClick={() => p.onDiagram(d.id)}><span className="tid">{d.code}</span><span className="tn">{d.title}</span></button></li>)}
                {custom && p.onAddDiagram && <li>{naming
                  ? <input className="input" autoFocus placeholder="圖的名稱，例如：任務總覽" maxLength={60} aria-label="新自訂圖的名稱"
                      onKeyDown={(e) => { if (e.key === "Enter") finish((e.target as HTMLInputElement).value); if (e.key === "Escape") setNaming(false); }} onBlur={(e) => finish(e.target.value)} />
                  : <button className="tbtn" onClick={() => setNaming(true)} title="自己決定放哪些項目的圖，任何類別都能放在一起">＋ 新增自訂圖</button>}</li>}
              </ul>}
            </li>
          );
        })}
        <li><span className="label">模型元素</span></li>
        {Object.entries(p.meta.pillars).map(([pid, pzh]) => (
          <li key={pid}>
            <button className="tree-row" aria-expanded={!!open[pid]} onClick={() => toggle(pid)}><span className="tw">{open[pid] ? "−" : "+"}</span><span className="tn">{pzh}</span></button>
            {open[pid] && <ul>{p.meta.categories.filter((c) => c.pillar === pid).map((c) => (
              <li key={c.id}><button className="tree-row" aria-current={p.listCat === c.id} onClick={() => p.onCategory(c.id)}><span className="tn">{c.zh}</span><span className="tc">{listOf(els, c.id).length}</span></button></li>
            ))}</ul>}
          </li>
        ))}
      </ul>}
    </div>
  );
}
