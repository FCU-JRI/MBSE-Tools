// N² 矩陣：對角線是次系統，格子是兩個次系統之間的介面（InterfaceUsage；種類 attrs.kind、成熟度 attrs.maturity）。
// 介面兩端由連接埠（短名 IF-xxx-A／IF-xxx-B）所屬的次系統定義推出。
import { label } from "../../model.ts";
import type { Props } from "../../Deliverables.tsx";
import "./wp5a.css";

const MATURITY: Record<string, string> = { exists: "存在", tentative: "暫定", frozen: "凍結" };

export function N2({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const subs = a.elements.filter((e) => e.category === "Subsystem" && e.kind === "PartDefinition");
  const ifs = a.elements.filter((e) => e.kind === "InterfaceUsage");
  const end = (i: (typeof ifs)[number], side: "A" | "B") => a.elements.find((p) => p.kind === "PortUsage" && p.shortName === `${i.shortName}-${side}`)?.owner ?? null;
  const rows = ifs.map((i) => ({ i, a: end(i, "A"), b: end(i, "B") }));
  const at = (r: string, c: string) => rows.filter((x) => (x.a === r && x.b === c) || (x.a === c && x.b === r));
  const orphan = rows.filter((x) => !subs.some((s) => s.id === x.a) || !subs.some((s) => s.id === x.b));
  const chip = (i: (typeof ifs)[number]) => (
    <button key={i.id} type="button" className="tbtn cell" aria-current={selectedId === i.id} onClick={() => onSelect(i.id)}>
      {i.shortName ?? ""} {i.name}<div className="caption">{i.attrs.kind ?? "—"}・{MATURITY[i.attrs.maturity ?? ""] ?? i.attrs.maturity ?? "—"}</div>
    </button>
  );
  return (
    <div>
      <p className="body muted">對角線是次系統，格子是兩個次系統之間的介面，標種類與成熟度；介面沒有方向，所以對角線上下兩側相同（下側淡色）。點介面看右欄。新增介面在系統的右欄「介面」。</p>
      {subs.length === 0 ? <p className="body">還沒有次系統。</p> : (
        <div style={{ overflowX: "auto" }}>
          <table className="n2" aria-label="N² 矩陣">
            <thead><tr><th />{subs.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
            <tbody>
              {subs.map((r, ri) => (
                <tr key={r.id}>
                  <th>{r.name}</th>
                  {subs.map((c, ci) => ri === ci
                    ? <td key={c.id} className="diag" onClick={() => onSelect(r.id)}>{r.name}</td>
                    : <td key={c.id} className={ci < ri ? "mirror" : ""} data-cell={`${ri},${ci}`}>{at(r.id, c.id).map((x) => chip(x.i))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="caption" style={{ marginTop: 8 }}>共 {ifs.length} 個介面{orphan.length > 0 && <>；{orphan.length} 個的端點不是次系統，不在矩陣內：{orphan.map((x) => label(x.i)).join("、")}</>}</p>
    </div>
  );
}
