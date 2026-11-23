// 表格：原「表」（各類別元素清單）加上原「產出物」的需求矩陣、FMEA、推導鏈、來源文件；匯出 Excel 從上方全域列搬到這裡。
import { useState } from "react";
import { TableView } from "../Views.tsx";
import { Chain, Docs, Fmea, ReqMatrix } from "../Deliverables.tsx";
import { listOf } from "../model.ts";
import { Columns, SelectionPane } from "../layout.tsx";
import type { PageProps, TableGroup } from "../workspace.ts";
import "./tables.css";

/** 左欄的分組。模型元素清單依支柱列出各類別。 */
const GROUPS: { zh: string; items: [TableGroup, string][] }[] = [
  { zh: "需求與驗證", items: [["req", "需求矩陣"]] },
  { zh: "風險", items: [["fmea", "FMEA 表"]] },
  { zh: "參考資料", items: [["docs", "來源文件"]] },
];

export function TablesPage(p: PageProps) {
  const { view, meta } = p;
  const table = p.spot.table;
  const setTable = (t: TableGroup) => p.setSpot({ table: t });
  const selectedId = p.sel?.type === "element" ? p.sel.id : null;
  const onSelect = (eid: string) => p.setSel({ type: "element", id: eid });
  const tp = { view, meta, user: p.user, selectedId, onSelect, onChanged: p.setView };
  const catId = table.startsWith("cat:") ? table.slice(4) : null;
  const els = view.analysis.elements;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const title = catId ? meta.categories.find((c) => c.id === catId)?.zh ?? catId : GROUPS.flatMap((g) => g.items).find(([t]) => t === table)?.[1] ?? "";

  const left = (
    <>
      {GROUPS.map((g) => (
        <div className="section" key={g.zh}>
          <div className="section-head"><h2 className="section-title">{g.zh}</h2></div>
          <ul className="tree">{g.items.map(([t, zh]) => (
            <li key={t}><button className="tree-row" aria-current={table === t} onClick={() => setTable(t)}><span className="tn">{zh}</span>{t === "req" && <span className="tc">{listOf(els, "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP").length}</span>}{t === "fmea" && <span className="tc">{listOf(els, "Risk").length}</span>}{t === "docs" && <span className="tc">{view.docs.length}</span>}</button></li>
          ))}</ul>
        </div>
      ))}
      <div className="section">
        <div className="section-head"><h2 className="section-title">模型元素清單</h2><span className="label">{meta.categories.length} 類</span></div>
        <ul className="tree">{Object.entries(meta.pillars).map(([pid, pzh]) => (
          <li key={pid}>
            <button className="tree-row" aria-expanded={!!open[pid]} onClick={() => setOpen((o) => ({ ...o, [pid]: !o[pid] }))}><span className="tw">{open[pid] ? "−" : "+"}</span><span className="tn" style={{ fontWeight: 500 }}>{pzh}</span></button>
            {open[pid] && <ul>{meta.categories.filter((c) => c.pillar === pid).map((c) => (
              <li key={c.id}><button className="tree-row" aria-current={catId === c.id} onClick={() => setTable(`cat:${c.id}`)}><span className="tn">{c.zh}</span><span className="tc">{listOf(els, c.id).length}</span></button></li>
            ))}</ul>}
          </li>
        ))}</ul>
      </div>
    </>
  );

  return (
    <Columns left={left} right={p.sel ? <SelectionPane {...p} toModel /> : undefined}>
      <div className="deliver-bar">
        <span className="heading">{title}</span>
        <span style={{ flex: 1 }} />
        <a className={`tbtn ${view.analysis.ok ? "" : "disabled"}`} href={view.analysis.ok ? `/api/projects/${view.project.id}/export.xlsx` : undefined}>匯出 Excel</a>
        <button className="tbtn" onClick={() => window.print()}>列印／PDF</button>
      </div>
      <div className="center-scroll printable">
        <p className="print-title">{view.project.name}　{title}</p>
        {table === "req" && <>
          <ReqMatrix {...tp} />
          <section className="section">
            <div className="section-head"><h2 className="section-title">推導鏈</h2><span className="label">需求是怎麼一步步來的</span></div>
            <Chain {...tp} />
          </section>
        </>}
        {table === "fmea" && <Fmea {...tp} />}
        {table === "docs" && <Docs {...tp} />}
        {catId && <TableView view={view} meta={meta} catId={catId} selectedId={selectedId} onSelect={onSelect} />}
      </div>
    </Columns>
  );
}
