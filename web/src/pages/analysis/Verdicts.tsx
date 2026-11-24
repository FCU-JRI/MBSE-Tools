// 判定總覽（ANA-06）與質量預算（ANA-11）。資料全由伺服器用解析器算出。
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { View } from "../../api.ts";

interface Term { attribute: string; op: string; threshold: string; value: number | null; unit: string; margin: number | null }
interface Row { requirement: string; name: string; qualifiedName: string; status: "holds" | "fails" | "undecided"; condition: string; terms: Term[]; value: number | null; unit: string; margin: number | null; source: string; note: string }
interface Budget { element: string; name: string; limitKg: number; sumKg: number; marginKg: number; status: "PASS" | "FAIL"; items: { name: string; massKg: number | null; note?: string }[] }

const fmt = (n: number | null, d = 2) => (n === null ? "—" : n.toLocaleString("zh-TW", { maximumFractionDigits: d }));
const STATUS = { holds: ["PASS", "done"], fails: ["FAIL", "danger"], undecided: ["未判定", "warn"] } as const;

export function Verdicts({ view }: { view: View }) {
  const id = view.project.id;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [budget, setBudget] = useState<Budget[] | null>(null);
  const [err, setErr] = useState("");
  // 模型或判定變動（寫回、編輯）後重新取值
  useEffect(() => {
    let live = true;
    setErr("");
    Promise.all([api<{ rows: Row[]; error?: string }>(`/projects/${id}/calc/verdicts`), api<{ rows: Budget[] }>(`/projects/${id}/calc/budget`)])
      .then(([v, b]) => { if (!live) return; setRows(v.rows); setBudget(b.rows); if (v.error) setErr(v.error); })
      .catch((e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [id, view.analysis]);

  return (
    <>
      <section className="section">
        <div className="section-head"><h2 className="section-title">判定總覽</h2><span className="label">{rows ? `${rows.length} 條需求` : "讀取中"}</span></div>
        <p className="caption" style={{ marginBottom: 8 }}>每條有數值條件的需求一列。算出值與餘裕由解析器求值，pass／fail 只看條件與模型，不含任何人為判斷。</p>
        {err && <p className="msg"><span className="tag danger">ERR</span>{err}</p>}
        {rows && rows.length === 0 && !err && <p className="muted">還沒有帶數值條件的需求。到模型頁選一條需求，在右欄設定「數值條件」。</p>}
        {rows && rows.length > 0 && (
          <table>
            <thead><tr><th>需求</th><th>條件（門檻）</th><th style={{ textAlign: "right" }}>算出值</th><th style={{ textAlign: "right" }}>餘裕</th><th>判定</th><th>來源</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.qualifiedName}>
                <td><span className="id">{r.requirement}</span> {r.name}</td>
                <td className="data">{r.terms.length ? r.terms.map((t) => `${t.attribute} ${t.op} ${t.threshold}`).join("　且　") : r.condition}</td>
                <td className="data" style={{ textAlign: "right" }}>{r.value === null ? "—" : `${fmt(r.value)} ${r.unit}`}</td>
                <td className="data" style={{ textAlign: "right" }}>{r.margin === null ? "—" : `${r.margin >= 0 ? "+" : ""}${fmt(r.margin)} ${r.unit}`}</td>
                <td><span className={`tag ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span>{r.note && <span className="caption"> {r.note}</span>}</td>
                <td className="caption">{r.source || "—"}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">質量預算</h2><span className="label">{budget ? `${budget.length} 項` : "讀取中"}</span></div>
        <p className="caption" style={{ marginBottom: 8 }}>零件有 massLimit 屬性時，把子項的 mass 加總和上限比較，超過判 FAIL。子項沒有 mass 時往下加總它的子項。</p>
        {budget && budget.length === 0 && <p className="muted">還沒有設定質量上限。在零件定義加上 attribute massLimit : MassValue = 20 [kg]; 並讓子零件有 mass 屬性。</p>}
        {budget && budget.length > 0 && (
          <table>
            <thead><tr><th>零件</th><th style={{ textAlign: "right" }}>子項加總 kg</th><th style={{ textAlign: "right" }}>上限 kg</th><th style={{ textAlign: "right" }}>餘裕 kg</th><th>判定</th><th>子項</th></tr></thead>
            <tbody>{budget.map((b) => (
              <tr key={b.element}>
                <td>{b.name}<div className="caption">{b.element}</div></td>
                <td className="data" style={{ textAlign: "right" }}>{fmt(b.sumKg, 3)}</td><td className="data" style={{ textAlign: "right" }}>{fmt(b.limitKg, 3)}</td>
                <td className="data" style={{ textAlign: "right" }}>{b.marginKg >= 0 ? "+" : ""}{fmt(b.marginKg, 3)}</td>
                <td><span className={`tag ${b.status === "PASS" ? "done" : "danger"}`}>{b.status}</span></td>
                <td className="caption">{b.items.map((i) => `${i.name} ${i.massKg === null ? "（無質量）" : fmt(i.massKg, 3)}`).join("、")}</td>
              </tr>))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}
