import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { Me, View } from "./api.ts";

type Inputs = Record<string, Record<string, any>>;
interface Output { key: string; zh: string; value: number; unit: string }
interface Result { at: string; by: string; commit: string; inputsHash: string; engine: string; outputs: Output[]; trajectory: [number, number][]; warnings: string[] }
interface Binding { output: string; element: string; attribute: string }
interface SimData { inputs: Inputs; result: Result | null; bindings: Binding[]; available: { ok: boolean; reason: string } }

const GROUPS: { key: string; zh: string; help: string; fields: [string, string][] }[] = [
  { key: "rocket", zh: "箭體", help: "位置都從鼻錐尖端量起，往尾端為正。質量不含引擎。", fields: [["radius_m", "半徑 m"], ["length_m", "全長 m"], ["mass_kg", "質量（不含引擎）kg"], ["cm_from_nose_m", "質心位置 m"], ["drag_cd", "阻力係數 Cd"]] },
  { key: "nose", zh: "鼻錐", help: "", fields: [["length_m", "長度 m"]] },
  { key: "fins", zh: "尾翼（梯形）", help: "位置是翼根前緣到鼻錐尖端的距離。", fields: [["n", "片數"], ["root_chord_m", "翼根弦長 m"], ["tip_chord_m", "翼尖弦長 m"], ["span_m", "翼展 m"], ["sweep_length_m", "後掠長度 m"], ["position_from_nose_m", "位置 m"]] },
  { key: "motor", zh: "引擎", help: "噴嘴出口位於箭體尾端。", fields: [["propellant_mass_kg", "推進劑質量 kg"], ["dry_mass_kg", "引擎空重 kg"], ["chamber_radius_m", "燃燒室半徑 m"], ["chamber_height_m", "燃燒室長度 m"], ["nozzle_radius_m", "噴嘴出口半徑 m"]] },
  { key: "chute", zh: "降落傘", help: "Cd·S 是阻力係數乘以傘面積。於遠地點開傘。", fields: [["cd_s_m2", "Cd·S m²"], ["lag_s", "開傘延遲 s"]] },
  { key: "launch", zh: "發射條件", help: "標準大氣、無風。", fields: [["latitude", "緯度"], ["longitude", "經度"], ["elevation_m", "海拔 m"], ["rail_length_m", "發射軌長度 m"], ["inclination_deg", "仰角 °"], ["heading_deg", "方位 °"]] },
];
const NOSES: [string, string][] = [["vonKarman", "von Kármán"], ["ogive", "卵形 ogive"], ["conical", "圓錐"], ["lvhaack", "LV-Haack"], ["tangent", "正切卵形"], ["parabolic", "拋物線"]];
const DEFAULT_ATTR: Record<string, string> = { apogee: "apogee", maxSpeed: "maxSpeed", railExitSpeed: "railExitSpeed", staticMargin: "staticMargin", maxAcceleration: "maxAcceleration", totalImpulse: "totalImpulse", liftoffMass: "liftoffMass", impactSpeed: "impactSpeed" };

function Curve({ points, label, unit }: { points: [number, number][]; label: string; unit: string }) {
  if (points.length < 2) return null;
  const W = 640, H = 150, pl = 4, pb = 16;
  const maxX = Math.max(...points.map((p) => p[0])) || 1, maxY = Math.max(...points.map((p) => p[1])) || 1;
  const x = (v: number) => pl + (v / maxX) * (W - pl - 60), y = (v: number) => H - pb - (Math.max(v, 0) / maxY) * (H - pb - 14);
  const peak = points.reduce((a, b) => (b[1] > a[1] ? b : a));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 640, display: "block" }} role="img" aria-label={`${label}：最大 ${peak[1].toFixed(0)} ${unit}，於 ${peak[0].toFixed(1)} 秒；全程 ${maxX.toFixed(1)} 秒。`}>
      <line x1={pl} y1={H - pb} x2={W - 60} y2={H - pb} stroke="var(--line)" />
      <polyline fill="none" stroke="var(--ink)" strokeWidth="1" points={points.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ")} />
      <circle cx={x(peak[0])} cy={y(peak[1])} r="3" fill="var(--ink)" />
      <text x={x(peak[0]) + 8} y={y(peak[1]) + 4} fontSize="12" fill="var(--ink)">{peak[1].toFixed(0)} {unit}</text>
      <text x={pl} y={H - 3} fontSize="10" fill="var(--ink-faint)" letterSpacing="1">0 S</text>
      <text x={W - 60} y={H - 3} fontSize="10" fill="var(--ink-faint)" letterSpacing="1" textAnchor="end">{maxX.toFixed(1)} S</text>
    </svg>
  );
}

/** 物理計算：參數 → RocketPy → 結果，並可把結果寫回模型屬性，讓需求自動判定。 */
export function SimView({ view, user, onChanged }: { view: View; user: Me; onChanged: (v: View) => void }) {
  const id = view.project.id;
  const ro = !user.caps.edit;
  const [data, setData] = useState<SimData | null>(null);
  const [inputs, setInputs] = useState<Inputs>({});
  const [thrustText, setThrustText] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [target, setTarget] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const usages = view.analysis.elements.filter((e) => e.kind === "PartUsage" && !e.shared && view.analysis.elements.find((o) => o.id === e.owner)?.kind === "Package");
  const attrsOf = (qn: string) => {
    const u = view.analysis.elements.find((e) => e.qualifiedName === qn);
    const defs = new Set(u?.typeIds ?? []);
    return [...new Set(view.analysis.elements.filter((e) => e.kind === "AttributeUsage" && e.owner && defs.has(e.owner)).map((e) => e.name))];
  };

  const run = async (label: string, fn: () => Promise<void>, done?: string) => {
    setBusy(label); setMsg(null);
    try { await fn(); if (done) setMsg({ ok: true, text: done }); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  const accept = (d: SimData) => {
    setData(d); setInputs(JSON.parse(JSON.stringify(d.inputs)));
    setPicked((p) => ({ ...Object.fromEntries(d.bindings.map((b) => [b.output, b.attribute])), ...p }));
    if (d.bindings[0]) setTarget((t) => t || d.bindings[0].element);
  };
  useEffect(() => { run("讀取", async () => accept(await api<SimData>(`/projects/${id}/sim`))); }, [id]);
  useEffect(() => { if (!target && usages[0]) setTarget(usages[0].qualifiedName); }, [usages, target]);

  if (!data) return <p className="label">讀取中</p>;
  const set = (g: string, k: string, v: string) => setInputs((i) => ({ ...i, [g]: { ...i[g], [k]: v === "" ? "" : Number.isNaN(Number(v)) ? v : Number(v) } }));
  const dirty = JSON.stringify(inputs) !== JSON.stringify(data.inputs);
  const saveInputs = async () => { const s = await api<SimData>(`/projects/${id}/sim/inputs`, "PUT", { inputs }); accept({ ...data, ...s }); };
  const simulate = () => run("模擬中", async () => { if (dirty) await saveInputs(); accept(await api<SimData>(`/projects/${id}/sim/run`, "POST", {})); }, "模擬完成。");
  const applyThrust = () => run("解析", async () => { const r = await api<{ curve: [number, number][] }>(`/projects/${id}/sim/thrust`, "POST", { text: thrustText }); setInputs((i) => ({ ...i, motor: { ...i.motor, thrust_curve: r.curve } })); setThrustText(""); }, "已讀入推力曲線，按「執行模擬」會一併儲存。");
  const importOrk = (f: File) => run("匯入", async () => {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(await f.arrayBuffer())));
    const r = await api<{ sim: SimData; imported: string[]; skipped: string[] }>(`/projects/${id}/sim/import-ork`, "POST", { base64: b64 });
    accept({ ...data, ...r.sim });
    setMsg({ ok: true, text: `已匯入：${r.imported.join("、")}。未匯入：${r.skipped.join("、")}。` });
  });
  const attrs = attrsOf(target);
  const chosen = (o: Output) => picked[o.key] ?? (attrs.includes(DEFAULT_ATTR[o.key] ?? "") ? DEFAULT_ATTR[o.key] : "");
  const apply = () => run("寫回", async () => {
    const bindings = (data.result?.outputs ?? []).map((o) => ({ output: o.key, element: target, attribute: chosen(o) })).filter((b) => b.attribute);
    if (bindings.length === 0) throw new Error("請先替至少一個結果選擇要寫入的屬性。");
    const v = await api<View & { applied: string[] }>(`/projects/${id}/sim/apply`, "POST", { bindings });
    onChanged(v);
    setMsg({ ok: true, text: `已寫回模型：${v.applied.join("；")}。到「追溯」看需求是否滿足。` });
  });
  const curve: [number, number][] = inputs.motor?.thrust_curve ?? [];
  const impulse = curve.reduce((s, p, i) => (i ? s + ((p[0] - curve[i - 1][0]) * (p[1] + curve[i - 1][1])) / 2 : 0), 0);

  return (
    <>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
      {!data.available.ok && <p className="msg"><span className="tag danger">ERR</span>{data.available.reason}</p>}

      <section className="section">
        <div className="section-head"><h1 className="section-title">飛行模擬</h1><span className="label">{data.result ? data.result.engine : "尚未執行"}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>填入火箭參數，由 RocketPy 計算飛行。結果可以寫回模型的屬性，需求裡的數值條件就會自動重新判定。</p>
        {!ro && (
          <div className="tbtn-row" style={{ paddingLeft: 0, marginBottom: 8 }}>
            <button className="btn" disabled={!!busy || !data.available.ok} onClick={simulate}>{busy === "模擬中" ? "模擬中" : "執行模擬"}</button>
            {dirty && <button className="tbtn primary" disabled={!!busy} onClick={() => run("儲存", saveInputs, "已儲存參數。")}>只儲存參數</button>}
            <button className="tbtn" disabled={!!busy} onClick={() => fileRef.current?.click()}>匯入 OpenRocket</button>
            <a className="tbtn" href={`/api/projects/${id}/sim/export.ork`}>匯出 .ork</a>
            <input ref={fileRef} type="file" accept=".ork" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importOrk(f); e.target.value = ""; }} />
          </div>
        )}
      </section>

      {data.result && (
        <section className="section">
          <div className="section-head"><h2 className="section-title">結果</h2><span className="label">{new Date(data.result.at).toLocaleString("zh-TW", { hour12: false })} · {data.result.by} · 模型 {data.result.commit} · 參數 {data.result.inputsHash}</span></div>
          {dirty && <p className="msg"><span className="tag warn">DUE</span>參數已修改，下面是上一次的結果。</p>}
          {data.result.warnings.map((w, i) => <p key={i} className="msg"><span className="tag warn">注意</span>{w}</p>)}
          <Curve points={data.result.trajectory} label="高度隨時間" unit="m" />
          {!ro && (
            <div className="row" style={{ marginTop: 12 }}>
              <label className="field" style={{ flex: "0 0 18rem" }}><span className="label">寫回到模型中的</span>
                <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>{usages.map((u) => <option key={u.id} value={u.qualifiedName}>{u.name}（{u.types[0] ?? "part"}）</option>)}</select></label>
            </div>
          )}
          <table>
            <thead><tr><th>項目</th><th style={{ textAlign: "right" }}>數值</th><th>單位</th>{!ro && <th>寫入屬性</th>}</tr></thead>
            <tbody>{data.result.outputs.map((o) => (
              <tr key={o.key}>
                <td>{o.zh}</td><td className="data" style={{ textAlign: "right" }}>{o.value.toLocaleString("zh-TW", { maximumFractionDigits: 2 })}</td><td className="id">{o.unit || "—"}</td>
                {!ro && <td><select className="input" style={{ height: 28, fontSize: 13 }} value={chosen(o)} onChange={(e) => setPicked({ ...picked, [o.key]: e.target.value })} aria-label={`${o.zh} 寫入的屬性`}><option value="">不寫入</option>{attrs.map((a) => <option key={a}>{a}</option>)}</select></td>}
              </tr>
            ))}</tbody>
          </table>
          {!ro && <div style={{ marginTop: 8 }}><button className="tbtn primary" disabled={!!busy || dirty} onClick={apply}>寫回模型</button>
            <p className="caption">只能寫入這個零件的定義裡已有的屬性。沒有對應的屬性時，先到結構分解加上（例如 attribute maxSpeed : SpeedValue）。</p></div>}
        </section>
      )}

      <section className="section">
        <div className="section-head"><h2 className="section-title">推力曲線</h2><span className="label">{curve.length} 點 · 總衝量 {impulse.toFixed(0)} N·s · 燃燒 {(curve[curve.length - 1]?.[0] ?? 0).toFixed(2)} s</span></div>
        <Curve points={curve} label="推力隨時間" unit="N" />
        {!ro && <>
          <label className="field" style={{ marginTop: 8 }}><span className="label">貼上實測資料或 .eng 檔內容（每行：時間 s、推力 N）</span>
            <textarea className="input" rows={3} value={thrustText} onChange={(e) => setThrustText(e.target.value)} placeholder={"0.0 0\n0.1 2400\n3.9 0"} /></label>
          <button className="tbtn primary" disabled={!thrustText.trim() || !!busy} onClick={applyThrust}>讀入曲線</button>
        </>}
      </section>

      {GROUPS.map((g) => (
        <section className="section" key={g.key}>
          <div className="section-head"><h2 className="section-title">{g.zh}</h2></div>
          {g.help && <p className="caption" style={{ marginBottom: 8 }}>{g.help}</p>}
          <div className="row">
            {g.fields.map(([k, zh]) => (
              <label className="field" key={k} style={{ minWidth: "9rem" }}><span className="label">{zh}</span>
                <input className="input" inputMode="decimal" readOnly={ro} value={inputs[g.key]?.[k] ?? ""} onChange={(e) => set(g.key, k, e.target.value)} /></label>
            ))}
            {g.key === "nose" && <label className="field"><span className="label">外形</span><select className="input" disabled={ro} value={inputs.nose?.kind ?? "vonKarman"} onChange={(e) => setInputs((i) => ({ ...i, nose: { ...i.nose, kind: e.target.value } }))}>{NOSES.map(([k, zh]) => <option key={k} value={k}>{zh}</option>)}</select></label>}
          </div>
        </section>
      ))}
    </>
  );
}
