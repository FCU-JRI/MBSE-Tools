// 方案比較表（唯讀）：每個設計方案（DesignAlternative）一張；欄是候選（variant），列是準則（連到的需求）。
// 準則＝與方案或候選有連結（satisfy／trace／refine／derive）的需求。權重與分數目前沒有專屬欄位，沿用下面說明的屬性寫法。
// 選定＝有設計決策（DesignDecision）以 #trace 連到候選；同一方案下其餘候選視為否決。
import type { Element } from "../../api.ts";
import { label } from "../../model.ts";
import type { Props } from "../../Deliverables.tsx";
import "./wp5a.css";

const REQ = /Requirement$|^MOP$/;
const LINKS = ["satisfy", "trace", "refine", "derive"];
const key = (r: Element) => `score_${(r.shortName ?? r.name).replace(/\W/g, "_")}`;
const numOf = (v: string | undefined) => { const n = parseFloat(v ?? ""); return Number.isFinite(n) ? n : null; };

const HOWTO = `在 Extra.sysml（或任何模型檔）：
variation part def <'ALT-001'> '回收方案' :> DesignAlternative {
    variant part <'ALT-001-1'> '單段傘' { attribute score_REQ_SYS_001 = 4; }
    variant part <'ALT-001-2'> '雙段傘' { attribute score_REQ_SYS_001 = 5; }
}
requirement <'REQ-SYS-001'> '遠地點高度' : SystemRequirement { attribute weight = 3; ... }
satisfy '遠地點高度' by '回收方案'::'雙段傘';        // 準則連回需求
item <'DEC-001'> '回收改用雙段開傘' : DesignDecision { ... }
#trace dependency from '回收改用雙段開傘' to '回收方案'::'雙段傘';   // 選定`;

export function Trade({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const alts = a.elements.filter((e) => e.category === "DesignAlternative" && e.kind === "PartDefinition");
  const decisions = a.elements.filter((e) => e.category === "DesignDecision");
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const pick = (id: string, e: Element) => <button type="button" className="link" aria-current={selectedId === e.id} onClick={() => onSelect(e.id)}>{id}</button>;

  return (
    <div className="trade">
      <p className="body muted">每個設計方案一張表：欄是候選（variant），列是準則（連到的需求）。選定看有沒有設計決策以 #trace 連到候選，同方案其餘候選為否決；沒有決策的標「待決」。這張表唯讀，要改請到模型頁的原始碼。</p>
      <details style={{ marginBottom: 12 }}>
        <summary>怎麼填</summary>
        <pre className="howto">{HOWTO}</pre>
        <p className="caption">準則的權重（weight）與候選的分數（score_需求編號，編號的 - 改成 _）是目前寫的約定，沒有表單可填；沒寫的權重當 1，沒寫分數的格子只標有沒有連結（●）。加權總分只在至少一格有分數時才算。</p>
      </details>
      {alts.length === 0 && <p className="body">還沒有設計方案。在模型頁新增「設計方案」（category DesignAlternative）並列出候選。</p>}
      {alts.map((alt) => {
        const variants = a.elements.filter((e) => e.owner === alt.id && e.kind === "PartUsage");
        const ids = new Set([alt.id, ...variants.map((v) => v.id)]);
        const chosenBy = (v: Element) => decisions.filter((d) => a.relations.some((r) => r.kind === "trace" && ((r.from === d.id && r.to === v.id) || (r.to === d.id && r.from === v.id))));
        const picked = variants.filter((v) => chosenBy(v).length > 0);
        const state = (v: Element) => (chosenBy(v).length ? "選定" : picked.length ? "否決" : "待決");
        const criteria = [...new Map(a.relations.filter((r) => LINKS.includes(r.kind)).flatMap((r) => [[r.from, r.to], [r.to, r.from]] as [string, string][]).filter(([x, y]) => ids.has(x) && REQ.test(byId.get(y)?.category ?? "")).map(([, y]) => [y, byId.get(y) as Element])).values()];
        const linked = (r: Element, v: Element) => a.relations.some((x) => LINKS.includes(x.kind) && ((x.from === v.id && x.to === r.id) || (x.to === v.id && x.from === r.id)));
        const w = (r: Element) => numOf(r.attrs.weight) ?? 1;
        const total = (v: Element) => criteria.reduce((s, r) => s + w(r) * (numOf(v.attrs[key(r)]) ?? 0), 0);
        const anyScore = variants.some((v) => criteria.some((r) => numOf(v.attrs[key(r)]) !== null));
        return (
          <section key={alt.id} className="section">
            <h3 className="section-title">{label(alt)}</h3>
            {alt.doc && <p className="caption">{alt.doc}</p>}
            {variants.length === 0 ? <p className="body">這個方案還沒有候選。</p> : (
              <table className="n2">
                <thead>
                  <tr><th>準則（需求）</th><th>權重</th>{variants.map((v) => <th key={v.id}>{pick(label(v), v)}<div className={`tag ${state(v) === "選定" ? "done" : state(v) === "否決" ? "danger" : ""}`}>{state(v)}</div></th>)}</tr>
                </thead>
                <tbody>
                  {criteria.map((r) => (
                    <tr key={r.id}>
                      <td>{pick(label(r), r)}</td>
                      <td>{r.attrs.weight ?? <span className="faint">（1）</span>}</td>
                      {variants.map((v) => { const sc = v.attrs[key(r)]; return <td key={v.id}>{sc !== undefined ? sc : linked(r, v) ? "●" : <span className="faint">·</span>}</td>; })}
                    </tr>
                  ))}
                  {criteria.length === 0 && <tr><td colSpan={2 + variants.length}><span className="faint">還沒有準則：用 satisfy／trace 把需求連到這個方案或它的候選。</span></td></tr>}
                  {anyScore && <tr><td><b>加權總分</b></td><td /> {variants.map((v) => <td key={v.id}><b>{total(v)}</b></td>)}</tr>}
                  <tr><td>設計決策</td><td />{variants.map((v) => <td key={v.id} className={state(v) === "選定" ? "sel" : ""}>{chosenBy(v).map((d) => <div key={d.id}>{pick(label(d), d)}<div className="caption">{[d.attrs.decidedBy, d.attrs.decidedOn].filter(Boolean).join(" ")}　{d.attrs.rationale ?? ""}</div></div>)}{!chosenBy(v).length && <span className="faint">—</span>}</td>)}</tr>
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}
