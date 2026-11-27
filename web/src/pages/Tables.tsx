// 表格：原「表」（各類別元素清單）加上原「產出物」的需求矩陣、FMEA、推導鏈、來源文件；匯出 Excel 從上方全域列搬到這裡。
import { useState } from "react";
import { TableView } from "../Views.tsx";
import { Chain, Docs, Fmea, ReqMatrix } from "../Deliverables.tsx";
import { listOf } from "../model.ts";
import { Columns, SelectionPane } from "../layout.tsx";
import { Formulas } from "./tables/Formulas.tsx";
import { Params, VerifyMatrix } from "./tables/Derived.tsx";
import { Conflicts } from "./tables/Conflicts.tsx";
import { Trade } from "./tables/Trade.tsx";
import { N2 } from "./tables/N2.tsx";
import { Decisions, ElementsAll, TpmTrack, Variants } from "./tables/Records.tsx";
import type { PageProps, TableGroup } from "../workspace.ts";
import "./tables.css";

/** 左欄的分組。每一項都有模型資料可列；沒有資料來源的表（風險登錄、N²、方案比較、發射前檢查表）不放空殼。
 *  作業與風險裡的類別清單直接連到該類別的表。模型元素清單依支柱列出全部類別。 */
const GROUPS: { zh: string; items: [TableGroup, string][] }[] = [
  { zh: "需求與驗證", items: [["req", "需求矩陣"], ["verify", "驗證矩陣"]] },
  { zh: "風險", items: [["fmea", "FMEA 表"], ["cat:SafetyFactor", "安全係數"], ["cat:Anomaly", "異常報告"]] },
  { zh: "設計", items: [["params", "設計參數表"], ["tpm", "TPM 追蹤"], ["trade", "方案比較"], ["variants", "候選方案（含被否決的）"], ["n2", "N² 矩陣"]] },
  { zh: "作業", items: [["cat:SOP", "標準作業程序"], ["cat:QCRecord", "加工 QC 紀錄"], ["cat:RosterEntry", "名冊"]] },
  { zh: "衝突與決策", items: [["conflicts", "衝突"], ["decisions", "決策"]] },
  { zh: "公式", items: [["formula", "constraint 與 calc"]] },
  { zh: "參考資料", items: [["docs", "來源文件"], ["elements", "模型元素總表"]] },
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
            <li key={t}><button className="tree-row" aria-current={table === t} onClick={() => setTable(t)}><span className="tn">{zh}</span>{t.startsWith("cat:") && <span className="tc">{listOf(els, t.slice(4)).length}</span>}{t === "verify" && <span className="tc">{listOf(els, "VerificationEvent", "ValidationEvent").length}</span>}{t === "req" && <span className="tc">{listOf(els, "SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP").length}</span>}{t === "fmea" && <span className="tc">{listOf(els, "Risk").length}</span>}{t === "docs" && <span className="tc">{view.docs.length}</span>}</button></li>
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
      <div className="center-scroll printable">
        <p className="print-title">{view.project.name}　{title}</p>
        {table === "req" && <>
          <ReqMatrix {...tp} />
          <section className="section">
            <div className="section-head"><h2 className="section-title">推導鏈</h2><span className="label">需求是怎麼一步步來的</span></div>
            <Chain {...tp} />
          </section>
        </>}
        {table === "verify" && <VerifyMatrix {...tp} />}
        {table === "fmea" && <Fmea {...tp} />}
        {table === "params" && <Params {...tp} />}
        {table === "trade" && <Trade {...tp} readOnly={p.readOnly} />}
        {table === "n2" && <N2 {...tp} />}
        {table === "tpm" && <TpmTrack {...tp} />}
        {table === "variants" && <Variants {...tp} />}
        {table === "decisions" && <Decisions {...tp} />}
        {table === "elements" && <ElementsAll {...tp} />}
        {table === "formula" && <Formulas view={view} selectedId={selectedId} onSelect={onSelect} />}
        {table === "conflicts" && <Conflicts {...tp} />}
        {table === "docs" && <Docs {...tp} />}
        {catId && <TableView view={view} meta={meta} catId={catId} selectedId={selectedId} onSelect={onSelect} />}
      </div>
    </Columns>
  );
}
