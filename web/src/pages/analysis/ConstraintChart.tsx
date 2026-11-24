// 約束圖（ANA-08）：概念設計參考。滑桿預設值從模型讀（模擬輸入，已套用模型屬性）、約束線從需求的數值條件讀，
// 一維垂直彈道在瀏覽器即時算；有最新 RocketPy 結果時用它校正。不計入驗證矩陣，pass／fail 只由 constraint 與模擬決定。
// 物理與互動參考 Mars 的原型（ζ × T/W 版），預設軸改成「起飛質量 × 總衝量」。
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api.ts";
import type { View } from "../../api.ts";

const G0 = 9.80665;
type Metric = "apogee" | "accel" | "rail" | "q" | "speed";
interface Limit { metric: Metric; op: ">=" | "<="; value: number; text: string; requirement: string; name: string }
interface Target { id: string; element: string; attribute: string; exists: boolean }
interface Setup {
  ok: boolean; error?: string; limits: Limit[];
  sim: { inputs: { rocket: { radius_m: number; mass_kg: number; drag_cd: number }; motor: { thrust_curve: [number, number][]; propellant_mass_kg: number; dry_mass_kg: number }; launch: { rail_length_m: number } };
    linked: string[]; result: { at: string; engine: string; outputs: { key: string; value: number }[] } | null };
  targets: { mass: Target | null; impulse: Target | null };
}
interface Cons { id: string; metric: Metric; op: ">=" | "<="; value: number; label: string; src: "model" | "temp" }
interface Params { m0: number; d: number; cd: number; isp: number; L: number; tb: number }
interface Res { h: number; qm: number; am: number; vb: number; rail: number; tw: number; zeta: number; mp: number; m0: number }
type Mode = "mI" | "zT";

const METRIC: Record<Metric, { zh: string; unit: string; scale: number; color: string }> = {
  apogee: { zh: "遠地點", unit: "m", scale: 1, color: "#378add" },
  accel: { zh: "最大加速度", unit: "m/s²", scale: 1, color: "#7f77dd" },
  rail: { zh: "離軌速度", unit: "m/s", scale: 1, color: "#d85a30" },
  q: { zh: "最大動壓", unit: "kPa", scale: 1000, color: "#ba7517" },
  speed: { zh: "最大速度", unit: "m/s", scale: 1, color: "#888780" },
};
const val = (r: Res, m: Metric) => (m === "apogee" ? r.h : m === "accel" ? r.am * G0 : m === "rail" ? r.rail : m === "q" ? r.qm : r.vb);
const fmt = (n: number, d = 1) => n.toLocaleString("zh-TW", { maximumFractionDigits: d });

/** 一維垂直彈道：定推力、定 CD、指數大氣（標高 8.5 km）。T 為推力，mp 為推進劑質量，tb 為燃燒時間。 */
function flight(P: Params, m0: number, mp: number, T: number, tb: number): Res {
  const A = Math.PI * Math.pow(P.d / 200, 2), k = 0.5 * P.cd * A, md = mp / tb;
  let h = 0, v = 0, m = m0, qm = 0, am = 0, vmax = 0;
  const N = 120, dt = tb / N;
  for (let i = 0; i < N; i++) {
    const r = 1.225 * Math.exp(-h / 8500), D = k * r * v * v, q = 0.5 * r * v * v;
    if (q > qm) qm = q;
    const a = (T - D) / m; if (a / G0 > am) am = a / G0;
    v += (a - G0) * dt; h += v * dt; m -= md * dt;
    if (h < 0) { h = 0; if (v < 0) v = 0; }
    if (v > vmax) vmax = v;
  }
  let t = 0;
  while (v > 0 && t < 3000) {
    const r = 1.225 * Math.exp(-h / 8500), D = k * r * v * v, q = 0.5 * r * v * v;
    if (q > qm) qm = q;
    v += (-G0 - D / m) * 0.25; h += v * 0.25; t += 0.25;
  }
  const tw = T / (m0 * G0);
  return { h, qm, am, vb: vmax, rail: tw > 1 ? Math.sqrt(2 * (tw - 1) * G0 * P.L) : 0, tw, zeta: mp / m0, mp, m0 };
}
/** 由軸上的兩個座標算出一個設計點的結果。 */
function at(mode: Mode, P: Params, x: number, y: number): Res {
  if (mode === "mI") { const mp = y / (P.isp * G0); return mp >= x * 0.95 ? { ...flight(P, x, x * 0.01, 1, 1), h: 0, mp, zeta: mp / x, tw: y / P.tb / (x * G0) } : flight(P, x, mp, y / P.tb, P.tb); }
  const mp = x * P.m0, T = y * P.m0 * G0, md = T / (P.isp * G0);
  return flight(P, P.m0, mp, T, mp / md);
}
const trapz = (c: [number, number][]) => c.reduce((s, p, i) => (i ? s + ((p[1] + c[i - 1][1]) / 2) * (p[0] - c[i - 1][0]) : 0), 0);
const niceStep = (span: number) => { const raw = span / 6, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; };

const NX = 60, NY = 44;
interface Axis { min: number; max: number; log: boolean; zh: string; unit: string }

export function ConstraintChart({ view, onChanged }: { view: View; onChanged: (v: View) => void }) {
  const id = view.project.id;
  const [setup, setSetup] = useState<Setup | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<Mode>("mI");
  const [P, setP] = useState<Params | null>(null);
  const [temps, setTemps] = useState<Cons[]>([]);
  const [useCal, setUseCal] = useState(true);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tmp, setTmp] = useState<{ metric: Metric; op: ">=" | "<="; value: string }>({ metric: "accel", op: "<=", value: "" });
  const cv = useRef<HTMLCanvasElement>(null);
  const [dark, setDark] = useState(() => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia("(prefers-color-scheme: dark)"), f = () => setDark(mq.matches);
    mq.addEventListener("change", f); return () => mq.removeEventListener("change", f);
  }, []);

  // 約束線與預設值跟著模型走：需求條件或模擬輸入變動就重讀
  useEffect(() => {
    let live = true;
    api<Setup>(`/projects/${id}/calc/constraints`).then((s) => {
      if (!live) return;
      setSetup(s); setErr(s.ok ? "" : s.error ?? "讀取失敗");
      if (s.ok) {
        const i = s.sim.inputs, It = trapz(i.motor.thrust_curve), tb = Math.max(...i.motor.thrust_curve.map((p) => p[0]), 0.1);
        setP({ m0: i.rocket.mass_kg + i.motor.dry_mass_kg + i.motor.propellant_mass_kg, d: i.rocket.radius_m * 200, cd: i.rocket.drag_cd, isp: It / (i.motor.propellant_mass_kg * G0), L: i.launch.rail_length_m, tb });
      }
    }).catch((e: Error) => live && setErr(e.message));
    return () => { live = false; };
  }, [id, view.analysis]);

  const P0 = useMemo(() => {
    if (!setup?.ok) return null;
    const i = setup.sim.inputs, It = trapz(i.motor.thrust_curve);
    return { It, m0: i.rocket.mass_kg + i.motor.dry_mass_kg + i.motor.propellant_mass_kg, mp: i.motor.propellant_mass_kg };
  }, [setup]);
  const Pd = useMemo<Params | null>(() => {
    if (!setup?.ok || !P0) return null;
    const i = setup.sim.inputs, tb = Math.max(...i.motor.thrust_curve.map((p) => p[0]), 0.1);
    return { m0: P0.m0, d: i.rocket.radius_m * 200, cd: i.rocket.drag_cd, isp: P0.It / (i.motor.propellant_mass_kg * G0), L: i.launch.rail_length_m, tb };
  }, [setup, P0]);

  // 校正：用最新 RocketPy 結果除以同一設計點的一維結果
  const cal = useMemo(() => {
    const out: Partial<Record<Metric, number>> = {};
    if (!setup?.ok || !Pd || !P0) return out;
    const r = setup.sim.result; if (!r) return out;
    const base = flight(Pd, P0.m0, P0.mp, P0.It / Pd.tb, Pd.tb);
    const get = (k: string) => r.outputs.find((o) => o.key === k)?.value;
    const pairs: [Metric, string][] = [["apogee", "apogee"], ["accel", "maxAcceleration"], ["rail", "railExitSpeed"], ["speed", "maxSpeed"]];
    for (const [m, key] of pairs) { const rp = get(key), mine = val(base, m); if (rp && mine > 0 && Number.isFinite(rp)) out[m] = rp / mine; }
    return out;
  }, [setup, Pd, P0]);
  const calOn = useCal && Object.keys(cal).length > 0;
  const metricOf = (res: Res, m: Metric) => val(res, m) * (calOn ? cal[m] ?? 1 : 1);

  const cons = useMemo<Cons[]>(() => {
    const model = (setup?.limits ?? []).map<Cons>((l, i) => ({ id: `m${i}`, metric: l.metric, op: l.op, value: l.value, label: `${l.requirement} ${METRIC[l.metric].zh} ${l.op} ${l.text}`, src: "model" }));
    return [...model, ...temps];
  }, [setup, temps]);

  const axes = useMemo<{ x: Axis; y: Axis } | null>(() => {
    if (!P || !P0) return null;
    return mode === "mI"
      ? { x: { min: P0.m0 * 0.5, max: P0.m0 * 2, log: false, zh: "起飛質量", unit: "kg" }, y: { min: P0.It * 0.4, max: P0.It * 2.5, log: false, zh: "總衝量", unit: "N·s" } }
      : { x: { min: 0.2, max: 0.9, log: false, zh: "推進劑質量分數 ζ", unit: "" }, y: { min: 1.5, max: 40, log: true, zh: "起飛推重比 T/W", unit: "" } };
  }, [mode, P, P0]);
  const posOf = (a: Axis, f: number) => (a.log ? a.min * Math.pow(a.max / a.min, f) : a.min + f * (a.max - a.min));
  const fracOf = (a: Axis, v: number) => (a.log ? Math.log(v / a.min) / Math.log(a.max / a.min) : (v - a.min) / (a.max - a.min));

  /** 每格的結果與各約束是否滿足。實體限制：推重比要大於 1，推進劑要小於起飛質量的 90%。 */
  const grid = useMemo(() => {
    if (!P || !axes) return null;
    const cells: { res: Res; sat: boolean[]; phys: boolean }[] = [];
    let best = -1;
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const res = at(mode, P, posOf(axes.x, (i + 0.5) / NX), posOf(axes.y, (j + 0.5) / NY));
      const phys = res.tw > 1 && res.zeta < 0.9;
      const sat = cons.map((c) => { const v = metricOf(res, c.metric); return c.op === ">=" ? v >= c.value : v <= c.value; });
      cells.push({ res, sat, phys });
      if (phys && sat.every(Boolean) && (best < 0 || res.h > cells[best].res.h)) best = cells.length - 1;
    }
    return { cells, best };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [P, axes, mode, cons, calOn, cal]);

  /** 目前設計點（來自模型） */
  const design = useMemo(() => {
    if (!Pd || !P0 || !axes) return null;
    return mode === "mI" ? { x: P0.m0, y: P0.It } : { x: P0.mp / P0.m0, y: P0.It / Pd.tb / (P0.m0 * G0) };
  }, [Pd, P0, axes, mode]);

  useEffect(() => { setPin(null); setHover(null); }, [mode]);

  // 繪圖
  useEffect(() => {
    const c = cv.current; if (!c || !grid || !axes) return;
    const dpr = window.devicePixelRatio || 1, W = c.parentElement!.clientWidth, H = 380;
    c.width = W * dpr; c.height = H * dpr; c.style.width = W + "px"; c.style.height = H + "px";
    const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const ml = 58, mr = 12, mt = 10, mb = 40, pw = W - ml - mr, ph = H - mt - mb, cw = pw / NX, ch = ph / NY;
    const ink = dark ? "#e6e6e6" : "#2a2a2a", faint = dark ? "#8a8a8a" : "#605c54", ok = dark ? "#29b386" : "#1d9e75", line = dark ? "#34414e" : "#c2c9d1";
    const cell = (i: number, j: number) => grid.cells[i * NY + j];
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
      const k = cell(i, j), bad = k.sat.findIndex((s) => !s);
      g.globalAlpha = !k.phys ? 0.18 : bad < 0 ? 0.55 : 0.26;
      g.fillStyle = !k.phys ? faint : bad < 0 ? ok : METRIC[cons[bad].metric].color;
      g.fillRect(ml + i * cw, mt + ph - (j + 1) * ch, cw + 0.5, ch + 0.5);
    }
    g.globalAlpha = 1;
    // 約束線：相鄰兩格滿足與否不同的邊；臨時約束用虛線
    cons.forEach((cn, n) => {
      g.strokeStyle = METRIC[cn.metric].color; g.lineWidth = 2; g.setLineDash(cn.src === "temp" ? [5, 4] : []);
      g.beginPath();
      for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
        const s = cell(i, j).sat[n], x = ml + (i + 1) * cw, y = mt + ph - (j + 1) * ch;
        if (i + 1 < NX && cell(i + 1, j).sat[n] !== s) { g.moveTo(x, y); g.lineTo(x, y + ch); }
        if (j + 1 < NY && cell(i, j + 1).sat[n] !== s) { g.moveTo(x - cw, y); g.lineTo(x, y); }
      }
      g.stroke();
    });
    g.setLineDash([]);
    const X = (v: number) => ml + fracOf(axes.x, v) * pw, Y = (v: number) => mt + ph - fracOf(axes.y, v) * ph;
    g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = faint; g.strokeStyle = line; g.lineWidth = 1;
    const ticks = (a: Axis) => {
      if (a.log) return [1.5, 2, 3, 5, 7, 10, 15, 20, 30, 40].filter((t) => t >= a.min && t <= a.max);
      const st = niceStep(a.max - a.min), out: number[] = []; for (let t = Math.ceil(a.min / st) * st; t <= a.max + 1e-9; t += st) out.push(+t.toPrecision(6)); return out;
    };
    g.textAlign = "center"; for (const t of ticks(axes.x)) { g.fillText(String(t), X(t), mt + ph + 15); g.globalAlpha = 0.4; g.beginPath(); g.moveTo(X(t), mt); g.lineTo(X(t), mt + ph); g.stroke(); g.globalAlpha = 1; }
    g.textAlign = "right"; for (const t of ticks(axes.y)) { g.fillText(String(t), ml - 6, Y(t) + 4); g.globalAlpha = 0.4; g.beginPath(); g.moveTo(ml, Y(t)); g.lineTo(ml + pw, Y(t)); g.stroke(); g.globalAlpha = 1; }
    g.fillStyle = ink; g.font = '12px "Noto Sans TC", sans-serif'; g.textAlign = "center";
    g.fillText(`${axes.x.zh}${axes.x.unit ? `（${axes.x.unit}）` : ""}`, ml + pw / 2, H - 6);
    g.save(); g.translate(13, mt + ph / 2); g.rotate(-Math.PI / 2); g.fillText(`${axes.y.zh}${axes.y.unit ? `（${axes.y.unit}）` : ""}`, 0, 0); g.restore();
    const inside = (x: number, y: number) => x >= axes.x.min && x <= axes.x.max && y >= axes.y.min && y <= axes.y.max;
    const label = (t: string, x: number, y: number) => { g.fillStyle = ink; g.textAlign = x > W - 190 ? "right" : "left"; g.fillText(t, x + (x > W - 190 ? -10 : 10), y - 8); };
    if (grid.best >= 0) {
      const bi = Math.floor(grid.best / NY), bj = grid.best % NY, r = grid.cells[grid.best].res;
      g.fillStyle = ink; g.beginPath(); g.arc(ml + (bi + 0.5) * cw, mt + ph - (bj + 0.5) * ch, 5, 0, 7); g.fill();
      label(`可行域最高遠地點 ${fmt(r.h * (calOn ? cal.apogee ?? 1 : 1), 0)} m`, ml + (bi + 0.5) * cw, mt + ph - (bj + 0.5) * ch);
    } else { g.fillStyle = ink; g.textAlign = "center"; g.fillText("目前條件下沒有可行域，請放寬約束或調整參數", ml + pw / 2, mt + 22); }
    if (design && inside(design.x, design.y)) {
      g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.arc(X(design.x), Y(design.y), 7, 0, 7); g.stroke();
      label("目前設計點", X(design.x), Y(design.y) + 18);
    }
    if (pin) { g.strokeStyle = ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(pin.x) - 8, Y(pin.y)); g.lineTo(X(pin.x) + 8, Y(pin.y)); g.moveTo(X(pin.x), Y(pin.y) - 8); g.lineTo(X(pin.x), Y(pin.y) + 8); g.stroke(); }
  }, [grid, axes, cons, design, pin, dark, calOn, cal]);
  useEffect(() => {
    const f = () => setHover((h) => (h ? { ...h } : h));
    window.addEventListener("resize", f); return () => window.removeEventListener("resize", f);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = cv.current; if (!c || !axes) return null;
    const r = c.getBoundingClientRect(), ml = 58, mr = 12, mt = 10, mb = 40, pw = r.width - ml - mr, ph = 380 - mt - mb;
    const fx = (e.clientX - r.left - ml) / pw, fy = 1 - (e.clientY - r.top - mt) / ph;
    if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
    return { x: posOf(axes.x, fx), y: posOf(axes.y, fy) };
  };
  const shown = pin ?? hover;
  const shownRes = shown && P ? at(mode, P, shown.x, shown.y) : null;

  const target = setup?.targets;
  const writeBack = async () => {
    if (!pin || !P || !P0 || !target) return;
    const res = at(mode, P, pin.x, pin.y), It = res.mp * P.isp * G0;
    const ro = setup!.sim.inputs;
    // 有對應 rocket.mass_kg 時，寫的是不含發動機的結構質量；否則寫 dryMass／mass（起飛質量扣掉推進劑）
    const mass = setup!.sim.linked.includes("rocket.mass_kg") ? res.m0 - res.mp - ro.motor.dry_mass_kg : res.m0 - res.mp;
    if (!target.mass && !target.impulse) { setMsg("模型裡找不到可寫回的質量或總衝量屬性。"); return; }
    setBusy(true); setMsg("");
    try {
      let v: View | null = null;
      if (target.mass) v = await api<View>(`/projects/${id}/elements/attribute`, "POST", { id: target.mass.id, oldName: target.mass.attribute, name: target.mass.attribute, value: String(+mass.toFixed(3)), unit: "kg" });
      if (target.impulse) v = await api<View>(`/projects/${id}/elements/attribute`, "POST", { id: target.impulse.id, name: target.impulse.attribute, oldName: target.impulse.exists ? target.impulse.attribute : undefined, value: String(Math.round(It)), unit: "N*s" });
      if (v) onChanged(v);
      setMsg(`已寫回模型：${[target.mass && `${target.mass.element.split("::").pop()}.${target.mass.attribute} = ${fmt(mass, 2)} kg`, target.impulse && `${target.impulse.element.split("::").pop()}.${target.impulse.attribute} = ${fmt(It, 0)} N·s`].filter(Boolean).join("、")}。請照一般流程送審。`);
      setPin(null);
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  const addTemp = () => {
    const n = Number(tmp.value); if (!Number.isFinite(n) || tmp.value.trim() === "") return;
    const m = METRIC[tmp.metric];
    setTemps((t) => [...t, { id: `t${Date.now()}`, metric: tmp.metric, op: tmp.op, value: n * m.scale, label: `${m.zh} ${tmp.op} ${n} ${m.unit}（臨時，參考）`, src: "temp" }]);
    setTmp({ ...tmp, value: "" });
  };

  if (err) return <section className="section" data-cell="constraint"><div className="section-head"><h2 className="section-title">約束圖</h2></div><p className="msg"><span className="tag danger">ERR</span>{err}</p></section>;
  if (!setup || !P || !Pd || !axes || !grid) return <section className="section" data-cell="constraint"><div className="section-head"><h2 className="section-title">約束圖</h2></div><p className="muted">讀取中…</p></section>;

  const sliders: { k: keyof Params; zh: string; unit: string; hide?: boolean }[] = [
    { k: "m0", zh: "起飛質量", unit: "kg", hide: mode === "mI" }, { k: "d", zh: "直徑", unit: "cm" }, { k: "cd", zh: "阻力係數 CD", unit: "" },
    { k: "isp", zh: "比衝 Isp", unit: "s" }, { k: "L", zh: "發射軌長", unit: "m" }, { k: "tb", zh: "燃燒時間", unit: "s", hide: mode === "zT" },
  ];
  const rp = setup.sim.result;
  return (
    <section className="section cchart" data-cell="constraint">
      <div className="section-head"><h2 className="section-title">約束圖</h2><span className="label">ANA-08 · 概念設計參考</span></div>
      <p className="caption" data-note="ref">約束圖是概念設計參考，不計入驗證矩陣；pass／fail 只由 constraint 與模擬決定。只模擬一維垂直上升（定推力、定 CD、指數大氣），沒有風、馬赫數對阻力的影響、推力曲線形狀與穩定度。</p>
      <div className="cc-row">
        <span className="label">座標軸</span>
        <button className={`tbtn ${mode === "mI" ? "primary" : ""}`} aria-pressed={mode === "mI"} onClick={() => setMode("mI")}>起飛質量 × 總衝量</button>
        <button className={`tbtn ${mode === "zT" ? "primary" : ""}`} aria-pressed={mode === "zT"} onClick={() => setMode("zT")}>ζ × T/W</button>
        <button className="tbtn" onClick={() => { setP(Pd); setTemps([]); setPin(null); }}>恢復模型預設值</button>
      </div>
      <div className="cc-ctl">
        {sliders.filter((s) => !s.hide).map((s) => {
          const d = Pd[s.k], lo = d * 0.4, hi = d * 2.5, step = +(d / 100).toPrecision(1);
          return (
            <label key={s.k}><span>{s.zh}</span>
              <input type="range" data-param={s.k} min={lo} max={hi} step={step} value={P[s.k]} onChange={(e) => setP({ ...P, [s.k]: Number(e.target.value) })} />
              <output>{fmt(P[s.k], P[s.k] < 10 ? 2 : 1)}{s.unit ? ` ${s.unit}` : ""}</output></label>
          );
        })}
      </div>
      <p className="caption">{setup.sim.linked.length ? `滑桿預設值取自模型屬性（${setup.sim.linked.join("、")}）與模擬輸入。` : "滑桿預設值取自模擬輸入（尚未對應模型屬性）。"}　{rp ? <>RocketPy 結果 {rp.at.slice(0, 16).replace("T", " ")}：{calOn ? <label className="cc-inline"><input type="checkbox" checked={useCal} onChange={(e) => setUseCal(e.target.checked)} />已校正 {(Object.entries(cal) as [Metric, number][]).map(([m, f]) => `${METRIC[m].zh} ×${f.toFixed(3)}`).join("、")}</label> : "無法校正"}</> : "尚無 RocketPy 結果，未校正（一維彈道值）。"}</p>
      <ul className="cc-legend" aria-label="約束">
        {cons.map((c) => (
          <li key={c.id} data-src={c.src}><i style={{ background: METRIC[c.metric].color }} />{c.label}{c.src === "temp" ? <button className="tbtn" onClick={() => setTemps((t) => t.filter((x) => x.id !== c.id))}>移除</button> : <span className="tag">需求</span>}</li>
        ))}
        {cons.length === 0 && <li className="muted">需求裡還沒有遠地點、加速度、離軌速度、動壓的數值條件；可在下面臨時加（只存在這張圖上，標「參考」）。</li>}
        <li className="muted"><i style={{ background: "#888" }} />灰色：推重比 &lt; 1 或推進劑佔起飛質量 &gt; 90%（無法起飛）</li>
        <li><i style={{ background: "#1d9e75" }} />綠色：可行域</li>
      </ul>
      <div className="cc-row">
        <span className="label">臨時約束（參考）</span>
        <select className="input" value={tmp.metric} onChange={(e) => setTmp({ ...tmp, metric: e.target.value as Metric })} aria-label="量">{(Object.keys(METRIC) as Metric[]).map((m) => <option key={m} value={m}>{METRIC[m].zh}（{METRIC[m].unit}）</option>)}</select>
        <select className="input" value={tmp.op} onChange={(e) => setTmp({ ...tmp, op: e.target.value as ">=" | "<=" })} aria-label="方向"><option value="<=">≤</option><option value=">=">≥</option></select>
        <input className="input" inputMode="decimal" placeholder="數值" value={tmp.value} onChange={(e) => setTmp({ ...tmp, value: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addTemp()} aria-label="數值" />
        <button className="tbtn" onClick={addTemp}>加入</button>
      </div>
      <div className="cc-wrap"><canvas ref={cv} role="img" aria-label="約束圖：彩色為違反各約束的區域，綠色為可行域" onPointerMove={(e) => setHover(point(e))} onPointerLeave={() => setHover(null)} onPointerDown={(e) => { const p = point(e); if (p) setPin(p); }} /></div>
      <div className="cc-readout" aria-live="polite">
        {shownRes ? <>
          <span className="data">{axes.x.zh} {fmt(shown!.x, mode === "zT" ? 2 : 1)}{axes.x.unit}　{axes.y.zh} {fmt(shown!.y, mode === "zT" ? 1 : 0)}{axes.y.unit}{pin ? "（已選）" : ""}</span>
          <span className="data">{(Object.keys(METRIC) as Metric[]).map((m) => { const v = metricOf(shownRes, m) / METRIC[m].scale; return `${METRIC[m].zh} ${fmt(v, m === "apogee" ? 0 : 1)} ${METRIC[m].unit}`; }).join(" · ")} · T/W {fmt(shownRes.tw, 1)} · ζ {fmt(shownRes.zeta, 2)}</span>
          <span className="data">{cons.length === 0 ? "沒有約束" : cons.map((c) => { const v = metricOf(shownRes, c.metric), okc = c.op === ">=" ? v >= c.value : v <= c.value; return `${okc ? "✓" : "✗"} ${METRIC[c.metric].zh} ${c.op} ${fmt(c.value / METRIC[c.metric].scale, 1)}`; }).join("　")}</span>
        </> : <span className="muted">滑鼠移到圖上看該點的結果；點一下選點。</span>}
      </div>
      <div className="cc-row">
        <button className="tbtn primary" disabled={!pin || busy || (!target?.mass && !target?.impulse)} onClick={writeBack}>設為設計點</button>
        <span className="caption">{target?.mass || target?.impulse ? `寫回：${[target?.mass && `${target.mass.element.split("::").pop()}.${target.mass.attribute}`, target?.impulse && `${target.impulse.element.split("::").pop()}.${target.impulse.attribute}`].filter(Boolean).join("、")}（走一般的送審）` : "模型裡找不到質量或總衝量屬性，無法寫回。"}</span>
      </div>
      {msg && <p className="msg" data-msg="writeback">{msg}</p>}
    </section>
  );
}
