// P6 模型內公式：calc def 的新增與編輯、用到公式的屬性算出的數字、assert constraint 與需求的過或不過。
// 數字由解析器求值（伺服器 /calcs），網頁不自己算。
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { MethodPageProps } from "./registry.ts";

interface Param { name: string; type: string }
interface CalcDef { id: string; shortName: string | null; name: string; qualifiedName: string; doc: string; params: Param[]; returnType: string; expression: string; source: string }
interface Value { value: number | boolean | string | null; unit: string | null; text: string }
interface Result { owner: string; ownerName: string; attr: string; expression: string; value: Value | null; error: string | null }
interface Check { id: string; name: string; owner: string; subject: string | null; condition: string; status: "holds" | "fails" | "undecided"; error: string | null }
interface State { ok: boolean; defs: CalcDef[]; results: Result[]; checks: Check[]; satisfaction: { requirement: string; subject: string; status: string }[] }

const STATUS = { holds: ["過", ""], fails: ["不過", " danger"], undecided: ["未判定", " warn"] } as const;
const blank = { id: "", name: "", doc: "", params: "thrust : ForceValue, mass : MassValue", returnType: "Real", expression: "" };

export function FormulasPage({ view, user, onOpen }: MethodPageProps) {
  const id = view.project.id;
  const ro = !user.caps.edit;
  const [state, setState] = useState<State | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState(blank);
  const [expr, setExpr] = useState("");
  const [ctx, setCtx] = useState("Project");
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<State>(`/projects/${id}/calcs`).then(setState).catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, [id, view]);
  const name = (eid: string | null) => (eid ? view.analysis.elements.find((e) => e.id === eid)?.name ?? eid : "（定義的預設值）");

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const params = form.params.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const [n, t] = s.split(":").map((x) => x.trim()); return { name: n ?? "", type: t ?? "" }; });
      setState(await api<State>(`/projects/${id}/calcs`, "POST", { id: form.id || undefined, name: form.name, doc: form.doc, params, returnType: form.returnType, expression: form.expression }));
      setMsg({ ok: true, text: form.id ? "已修改公式。" : "已新增公式。" });
      setForm(blank);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  };
  const evaluate = async () => {
    try {
      const r = await api<{ value: Value | null; error: string | null }>(`/projects/${id}/calcs/eval`, "POST", { expression: expr, context: ctx });
      setOut(r.error ? `錯誤：${r.error}` : (r.value?.text ?? ""));
    } catch (e) { setOut(`錯誤：${(e as Error).message}`); }
  };

  if (!view.analysis.ok) return <div className="section"><p className="msg">模型目前有錯誤，請先到「原始碼」分頁修正。</p></div>;
  return (
    <div className="section">
      <div className="section-head"><h2 className="section-title">模型內公式</h2></div>
      <p className="caption">初步設計用寫在模型裡的公式（<code>calc def</code>）：推重比、Δv、粗估遠地點、穩定裕度等。屬性寫成 <code>attribute twr : Real = Calculations::TWR(thrust, mass);</code>，改了上游的數字，下游的結果與判定跟著變。設計定案後才用模擬確認。AI 提的公式由成員審查後才寫進模型，見 docs/TRADE-CALC.md。</p>
      {msg && <p className={`msg${msg.ok ? "" : " tag danger"}`} role="status">{msg.text}</p>}
      {!state && <p className="muted">計算中…</p>}
      {state && (
        <>
          <h3 className="label">公式（{state.defs.length}）</h3>
          <table className="data">
            <thead><tr><th>編號</th><th>名稱</th><th>輸入</th><th>結果</th><th>說明</th>{!ro && <th></th>}</tr></thead>
            <tbody>
              {state.defs.map((d) => (
                <tr key={d.id}>
                  <td className="id">{d.shortName}</td><td><button className="btn" onClick={() => onOpen(d.id)}>{d.name}</button></td>
                  <td>{d.params.map((p) => `${p.name} : ${p.type}`).join(", ")}</td>
                  <td><code>{d.expression}</code>{d.returnType && <> : {d.returnType}</>}</td><td>{d.doc}</td>
                  {!ro && <td><button className="tbtn" onClick={() => setForm({ id: d.id, name: d.name, doc: d.doc, params: d.params.map((p) => `${p.name} : ${p.type}`).join(", "), returnType: d.returnType || "Real", expression: d.expression })}>編輯</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!ro && (
            <div className="field" style={{ margin: "8px 0 16px" }}>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <input className="input" placeholder="公式名稱，例如 TWR" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                <input className="input" style={{ minWidth: 260 }} placeholder="輸入：名稱 : 型別, …" value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} />
                <input className="input" style={{ width: 120 }} placeholder="回傳型別" value={form.returnType} onChange={(e) => setForm({ ...form, returnType: e.target.value })} />
              </div>
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <input className="input" style={{ flex: 1 }} placeholder="運算式，例如 thrust / (mass * 9.80665 [m/s^2])；ln、sqrt、** 可用" value={form.expression} onChange={(e) => setForm({ ...form, expression: e.target.value })} />
                <input className="input" style={{ flex: 1 }} placeholder="出處與假設" value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })} />
                <button className="tbtn primary" disabled={busy || !form.name.trim() || !form.expression.trim()} onClick={save}>{form.id ? "儲存修改" : "新增公式"}</button>
                {form.id && <button className="tbtn" onClick={() => setForm(blank)}>取消</button>}
              </div>
            </div>
          )}

          <h3 className="label">算出來的數字（{state.results.length}）</h3>
          <table className="data">
            <thead><tr><th>元素</th><th>屬性</th><th>運算式</th><th>值</th></tr></thead>
            <tbody>{state.results.map((r, i) => (
              <tr key={i}><td><button className="btn" onClick={() => onOpen(r.owner)}>{r.ownerName}</button></td><td>{r.attr}</td><td><code>{r.expression}</code></td>
                <td>{r.error ? <span className="tag danger" title={r.error}>無法求值</span> : r.value?.text}</td></tr>
            ))}</tbody>
          </table>

          <h3 className="label">過或不過</h3>
          <table className="data">
            <thead><tr><th>判定</th><th>限制或需求</th><th>對象</th><th>條件</th></tr></thead>
            <tbody>
              {state.checks.map((c, i) => <tr key={`c${i}`}><td><span className={`tag${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span></td><td><button className="btn" onClick={() => onOpen(c.id)}>{c.name}</button></td><td>{name(c.subject)}</td><td><code>{c.condition}</code>{c.error && <span className="muted"> {c.error}</span>}</td></tr>)}
              {state.satisfaction.map((s, i) => { const st = (s.status in STATUS ? s.status : "undecided") as keyof typeof STATUS; return <tr key={`s${i}`}><td><span className={`tag${STATUS[st][1]}`}>{STATUS[st][0]}</span></td><td>{s.requirement}</td><td>{s.subject}</td><td className="muted">需求的限制（satisfy）</td></tr>; })}
            </tbody>
          </table>

          <h3 className="label">試算</h3>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="例如 Calculations::DeltaV(180.0, 20.0, 15.0)" value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void evaluate(); }} />
            <input className="input" style={{ width: 200 }} aria-label="求值的位置（套件）" value={ctx} onChange={(e) => setCtx(e.target.value)} />
            <button className="tbtn" disabled={!expr.trim()} onClick={evaluate}>求值</button>
          </div>
          {out && <p className="body"><code>{out}</code></p>}
        </>
      )}
    </div>
  );
}
