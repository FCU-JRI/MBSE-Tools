// P7：火箭外形與模擬圖（docs/IMPL-PLAN.md、METHOD.md 第 5 節）。
// 外形、重心、壓力中心都由伺服器從模型的 @Geometry 標記算出（GET /api/projects/:id/rocket）；這裡只負責畫。
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../api.ts";
import type { View } from "../api.ts";
import type { MethodPageProps } from "./registry.ts";

interface Fin { n: number; rootChord: number; tipChord: number; span: number; sweep: number }
export interface Section {
  id: string; name: string; qualifiedName: string; kind: "nose" | "body" | "transition" | "fins" | "mass";
  position: number; length: number; diameter: number | null; aftDiameter: number | null; shape: string | null; fin: Fin | null;
  mass: number; cg: number; propellant: number; cn: number; xcp: number | null; external: boolean;
}
interface MassState { mass: number; cg: number | null; margin: number | null }
export interface RocketGeometry { key: string; name: string; sections: Section[]; length: number; refDiameter: number | null; cn: number; cp: number | null; liftoff: MassState; burnout: MassState; warnings: string[] }
interface SimResult { at: string; by: string; commit: string; engine: string; trajectory: [number, number][]; warnings: string[]; series?: Record<string, number[]> }
interface RocketData { ok: boolean; rockets: RocketGeometry[]; result: SimResult | null; available: { ok: boolean; reason: string } }
interface Change { id: string; name: string; field: string; from: string | number | null; to: string | number }

const KIND_ZH: Record<Section["kind"], string> = { nose: "鼻錐", body: "箭體段", transition: "過渡段", fins: "尾翼組", mass: "質量項" };
const FIELD_ZH: Record<string, string> = { geoPosition: "位置", geoLength: "長度", geoDiameter: "外徑", geoAftDiameter: "後端外徑", geoShape: "外形", geoFinCount: "片數", geoRootChord: "翼根弦長", geoTipChord: "翼尖弦長", geoSpan: "翼展", geoSweep: "後掠長度", geoMass: "質量", geoCg: "重心", geoKind: "種類" };
const m3 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(3));
const EXAMPLE = `part '鼻錐' { @Geometry { geoKind = "nose"; geoPosition = 0; geoLength = 0.4; geoDiameter = 0.1; geoShape = "ogive"; geoMass = 0.4; } }
part '箭體' { @Geometry { geoKind = "body"; geoPosition = 0.4; geoLength = 1.1; geoDiameter = 0.1; geoMass = 1.5; } }
part '尾翼' { @Geometry { geoKind = "fins"; geoPosition = 1.3; geoFinCount = 4; geoRootChord = 0.2; geoTipChord = 0.1; geoSpan = 0.1; geoSweep = 0.1; geoMass = 0.3; } }
part '推進' : '推進次系統' { @Geometry { geoKind = "mass"; geoPosition = 1.0; geoLength = 0.5; geoMass = 2.0; geoPropellant = 1.0; } }`;

/** 鼻錐在 t（0 到 1，從尖端起）處的半徑比例；fineness 是長度除以底部半徑（正切卵形要用） */
export function noseRadius(shape: string | null, t: number, fineness: number): number {
  const haack = (c: number) => { const th = Math.acos(1 - 2 * t); return Math.sqrt(Math.max(th - Math.sin(2 * th) / 2 + c * Math.sin(th) ** 3, 0) / Math.PI); };
  switch (shape) {
    case "conical": return t;
    case "vonKarman": return haack(0);
    case "lvhaack": return haack(1 / 3);
    case "parabolic": return 2 * t - t * t;
    case "elliptical": return Math.sqrt(Math.max(1 - (1 - t) ** 2, 0));
    default: { // 正切卵形（ogive、tangent）：ρ = (R² + L²) / 2R，y = √(ρ² − (L − x)²) + R − ρ，以 R = 1 正規化
      const L = fineness, rho = (1 + L * L) / 2;
      return Math.max(Math.sqrt(Math.max(rho * rho - (L - t * L) ** 2, 0)) + 1 - rho, 0);
    }
  }
}

function niceStep(span: number): number {
  const raw = span / 8, p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((k) => k * p).find((s) => s >= raw) ?? p * 10;
}

/** 2D 側視圖：鼻尖在左，往右是尾端。外形取自模型的數字，重心與壓力中心標在中心線上。 */
export function RocketSideView({ g, onOpen }: { g: RocketGeometry; onOpen?: (id: string) => void }) {
  const outer = g.sections.filter((s) => s.kind !== "fins" && s.kind !== "mass");
  const fins = g.sections.filter((s) => s.kind === "fins" && s.fin);
  const masses = g.sections.filter((s) => s.kind === "mass");
  const L = Math.max(g.length, ...g.sections.map((s) => s.position + s.length), 0.01);
  const d = g.refDiameter ?? 0.1;
  const halfH = Math.max(d / 2, ...fins.map((f) => (f.fin?.span ?? 0) + d / 2));
  const W = 960, pad = 28;
  const k = (W - 2 * pad) / L;
  const top = 34, cy = top + halfH * k, bodyBottom = cy + halfH * k;
  const H = bodyBottom + 96;
  const X = (x: number) => pad + x * k, R = (r: number) => r * k;
  const hostR = (x: number) => { const h = outer.find((s) => x >= s.position - 1e-9 && x <= s.position + s.length + 1e-9); return ((h?.kind === "transition" ? h.aftDiameter : h?.diameter) ?? d) / 2; };
  const outline = (s: Section) => {
    if (s.kind === "nose") {
      const pts: string[] = [];
      for (let i = 0; i <= 32; i++) { const t = i / 32; pts.push(`${X(s.position + t * s.length).toFixed(1)},${(cy - R(noseRadius(s.shape, t, s.length / ((s.diameter ?? d) / 2)) * (s.diameter ?? d) / 2)).toFixed(1)}`); }
      for (let i = 32; i >= 0; i--) { const t = i / 32; pts.push(`${X(s.position + t * s.length).toFixed(1)},${(cy + R(noseRadius(s.shape, t, s.length / ((s.diameter ?? d) / 2)) * (s.diameter ?? d) / 2)).toFixed(1)}`); }
      return pts.join(" ");
    }
    const r1 = (s.diameter ?? d) / 2, r2 = s.kind === "transition" ? (s.aftDiameter ?? r1 * 2) / 2 : r1;
    const x1 = X(s.position), x2 = X(s.position + s.length);
    return `${x1},${cy - R(r1)} ${x2},${cy - R(r2)} ${x2},${cy + R(r2)} ${x1},${cy + R(r1)}`;
  };
  const finPath = (s: Section, dir: 1 | -1) => {
    const f = s.fin as Fin, r = hostR(s.position), y0 = cy - dir * R(r), y1 = cy - dir * R(r + f.span);
    return `${X(s.position)},${y0} ${X(s.position + f.sweep)},${y1} ${X(s.position + f.sweep + f.tipChord)},${y1} ${X(s.position + f.rootChord)},${y0}`;
  };
  const step = niceStep(L);
  const ticks: number[] = [];
  for (let t = 0; t <= L + 1e-9; t += step) ticks.push(Number(t.toFixed(6)));
  const rulerY = bodyBottom + 18;
  const cg = g.liftoff.cg, cgB = g.burnout.cg, cp = g.cp;
  const marker = (x: number, label: string, row: number, kind: "cg" | "cgb" | "cp") => {
    const px = X(x), r = 7;
    return (
      <g key={label}>
        <line x1={px} y1={cy - R(d / 2) - 6} x2={px} y2={rulerY + 22 + row * 16} stroke="var(--ink)" strokeWidth="1" strokeDasharray={kind === "cgb" ? "3 3" : undefined} />
        {kind === "cp"
          ? <><circle cx={px} cy={cy} r={r} fill="var(--bg)" stroke="var(--ink)" strokeWidth="2" /><circle cx={px} cy={cy} r={2.5} fill="var(--ink)" /></>
          : <><circle cx={px} cy={cy} r={r} fill="var(--bg)" stroke="var(--ink)" strokeWidth={kind === "cg" ? 2 : 1} />
              {kind === "cg" && <path d={`M${px},${cy} L${px + r},${cy} A${r},${r} 0 0,1 ${px},${cy + r} Z M${px},${cy} L${px - r},${cy} A${r},${r} 0 0,1 ${px},${cy - r} Z`} fill="var(--ink)" />}</>}
        <text x={px + 4} y={rulerY + 34 + row * 16} fontSize="12" fill="var(--ink)">{label} {x.toFixed(3)} m</text>
      </g>
    );
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block" }} role="img"
      aria-label={`${g.name} 側視圖：全長 ${m3(L)} m，參考直徑 ${m3(g.refDiameter)} m，重心 ${m3(cg)} m，壓力中心 ${m3(cp)} m，穩定裕度 ${g.liftoff.margin?.toFixed(2) ?? "—"} 倍徑。`}>
      <line x1={pad - 10} y1={cy} x2={X(L) + 10} y2={cy} stroke="var(--line)" strokeDasharray="6 4" />
      {outer.map((s) => (
        <g key={s.id} style={{ cursor: onOpen ? "pointer" : undefined }} onClick={() => onOpen?.(s.id)}>
          <title>{`${s.name}（${KIND_ZH[s.kind]}）位置 ${m3(s.position)} m、長 ${m3(s.length)} m、外徑 ${m3(s.diameter)} m、質量 ${s.mass} kg`}</title>
          <polygon points={outline(s)} fill="var(--surface-2)" stroke="var(--ink)" strokeWidth="1.5" />
          <text x={X(s.position + s.length / 2)} y={top - 12} fontSize="12" fill="var(--ink-muted)" textAnchor="middle">{s.name}</text>
          <line x1={X(s.position)} y1={top - 6} x2={X(s.position)} y2={cy - R((s.diameter ?? d) / 2)} stroke="var(--line)" />
        </g>
      ))}
      {fins.map((s) => (
        <g key={s.id} style={{ cursor: onOpen ? "pointer" : undefined }} onClick={() => onOpen?.(s.id)}>
          <title>{`${s.name}（尾翼 ${s.fin?.n} 片）翼根前緣 ${m3(s.position)} m、翼根 ${m3(s.fin?.rootChord)}、翼尖 ${m3(s.fin?.tipChord)}、翼展 ${m3(s.fin?.span)}、後掠 ${m3(s.fin?.sweep)} m`}</title>
          <polygon points={finPath(s, 1)} fill="var(--surface-2)" stroke="var(--ink)" strokeWidth="1.5" />
          <polygon points={finPath(s, -1)} fill="var(--surface-2)" stroke="var(--ink)" strokeWidth="1.5" />
        </g>
      ))}
      {masses.map((s, i) => {
        const r = hostR(s.position + s.length / 2) * 0.6, x1 = X(s.position), w = Math.max(R(s.length), 3);
        return (
          <g key={s.id} style={{ cursor: onOpen ? "pointer" : undefined }} onClick={() => onOpen?.(s.id)}>
            <title>{`${s.name}（質量項）位置 ${m3(s.position)} m、長 ${m3(s.length)} m、${s.mass} kg${s.propellant ? `（推進劑 ${s.propellant} kg）` : ""}`}</title>
            <rect x={s.length > 0 ? x1 : x1 - 1.5} y={cy - R(r)} width={w} height={R(2 * r)} fill="none" stroke="var(--ink-muted)" strokeDasharray="4 3" />
            <text x={x1 + w / 2} y={cy + R(r) + 12 + (i % 2) * 12} fontSize="11" fill="var(--ink-muted)" textAnchor="middle">{s.name}</text>
          </g>
        );
      })}
      <line x1={X(0)} y1={rulerY} x2={X(L)} y2={rulerY} stroke="var(--line-strong)" />
      {ticks.map((t) => <g key={t}><line x1={X(t)} y1={rulerY - 4} x2={X(t)} y2={rulerY + 4} stroke="var(--line-strong)" /><text x={X(t)} y={rulerY + 15} fontSize="10" fill="var(--ink-faint)" textAnchor="middle">{t.toFixed(step < 0.1 ? 2 : 1)}</text></g>)}
      {cg !== null && marker(cg, "重心", 0, "cg")}
      {cgB !== null && cg !== null && Math.abs(cgB - cg) > 1e-6 && marker(cgB, "燃畢重心", 1, "cgb")}
      {cp !== null && marker(cp, "壓力中心", 2, "cp")}
    </svg>
  );
}

/** 單一序列的折線圖：一條線、一個 y 軸，滑過顯示十字線與數值。 */
function LineChart({ t, y, title, unit, xLabel = "時間 s" }: { t: number[]; y: number[]; title: string; unit: string; xLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (t.length < 2 || y.length !== t.length) return null;
  const W = 460, H = 200, pl = 48, pr = 12, pt = 12, pb = 28;
  const x0 = Math.min(...t), x1 = Math.max(...t) || 1;
  let y0 = Math.min(0, ...y), y1 = Math.max(...y);
  if (y1 - y0 < 1e-9) y1 = y0 + 1;
  const X = (v: number) => pl + ((v - x0) / (x1 - x0 || 1)) * (W - pl - pr), Y = (v: number) => H - pb - ((v - y0) / (y1 - y0)) * (H - pb - pt);
  const ys = niceStep(y1 - y0) * 2;
  const yt: number[] = [];
  for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) yt.push(Number(v.toPrecision(6)));
  const peak = y.reduce((bi, v, i) => (v > y[bi] ? i : bi), 0);
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    const v = x0 + ((px - pl) / (W - pl - pr)) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < t.length; i++) if (Math.abs(t[i] - v) < Math.abs(t[best] - v)) best = i;
    setHover(best);
  };
  const fmt = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return (
    <figure style={{ margin: 0, flex: "1 1 22rem", minWidth: 0 }}>
      <figcaption className="label" style={{ marginBottom: 4 }}>{title}{unit && `（${unit}）`} · 最大 {fmt(y[peak])}，於 {t[peak].toFixed(1)} {xLabel.split(" ").pop()}</figcaption>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", touchAction: "none" }} onPointerMove={move} onPointerLeave={() => setHover(null)}
        role="img" aria-label={`${title}：最大 ${fmt(y[peak])} ${unit}，於 ${t[peak].toFixed(1)}；範圍 ${fmt(x0)} 到 ${fmt(x1)}。`}>
        {yt.map((v) => <g key={v}><line x1={pl} y1={Y(v)} x2={W - pr} y2={Y(v)} stroke="var(--line)" strokeWidth="1" /><text x={pl - 6} y={Y(v) + 4} fontSize="10" fill="var(--ink-faint)" textAnchor="end">{fmt(v)}</text></g>)}
        <line x1={pl} y1={H - pb} x2={W - pr} y2={H - pb} stroke="var(--line-strong)" />
        <text x={pl} y={H - 8} fontSize="10" fill="var(--ink-faint)">{fmt(x0)}</text>
        <text x={W - pr} y={H - 8} fontSize="10" fill="var(--ink-faint)" textAnchor="end">{fmt(x1)} · {xLabel}</text>
        <polyline fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" points={t.map((v, i) => `${X(v).toFixed(1)},${Y(y[i]).toFixed(1)}`).join(" ")} />
        {hover !== null && <g pointerEvents="none">
          <line x1={X(t[hover])} y1={pt} x2={X(t[hover])} y2={H - pb} stroke="var(--ink-muted)" strokeDasharray="3 3" />
          <circle cx={X(t[hover])} cy={Y(y[hover])} r="4" fill="var(--ink)" stroke="var(--bg)" strokeWidth="2" />
          <rect x={Math.min(X(t[hover]) + 8, W - 132)} y={pt} width="124" height="34" fill="var(--surface-1)" stroke="var(--line-strong)" />
          <text x={Math.min(X(t[hover]) + 14, W - 126)} y={pt + 14} fontSize="11" fill="var(--ink-muted)">{xLabel.split(" ")[0]} {fmt(t[hover])}</text>
          <text x={Math.min(X(t[hover]) + 14, W - 126)} y={pt + 28} fontSize="12" fill="var(--ink)">{fmt(y[hover])} {unit}</text>
        </g>}
      </svg>
    </figure>
  );
}

/** RocketPy 的模擬圖：有時間序列就畫全部；舊的結果只有高度。 */
function SimCharts({ result }: { result: SimResult }) {
  const s = result.series;
  const t = s?.t ?? result.trajectory.map((p) => p[0]);
  const alt = s?.altitude ?? result.trajectory.map((p) => p[1]);
  const charts: { key: string; title: string; unit: string }[] = [
    { key: "speed", title: "速度", unit: "m/s" }, { key: "acceleration", title: "加速度", unit: "m/s²" },
    { key: "stability", title: "穩定裕度", unit: "倍徑" }, { key: "mach", title: "馬赫數", unit: "" },
  ];
  const range = s?.x && s?.y ? s.x.map((x, i) => Math.hypot(x, s.y[i])) : null;
  return (
    <>
      <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
        <LineChart t={t} y={alt} title="高度（離地）" unit="m" />
        {range && <LineChart t={range} y={alt} title="軌跡：高度對水平距離" unit="m" xLabel="水平距離 m" />}
        {charts.filter((c) => s?.[c.key]).map((c) => <LineChart key={c.key} t={t} y={s![c.key]} title={c.title} unit={c.unit} />)}
      </div>
      {!s && <p className="caption">這是舊版的結果，只有高度。重新執行模擬就會有速度、加速度、穩定裕度等圖。</p>}
    </>
  );
}

/** P7 頁面：火箭外形（側視圖與數字）、模型 → 模擬參數、RocketPy 模擬圖、OpenRocket 匯出與匯回。 */
export function RocketPage({ view, user, onChanged, onOpen }: MethodPageProps) {
  const id = view.project.id;
  const ro = !user.caps.edit;
  const [data, setData] = useState<RocketData | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, setPending] = useState<{ base64: string; changes: Change[]; notes: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const load = async () => setData(await api<RocketData>(`/projects/${id}/rocket`));
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setMsg(null);
    try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(""); }
  };
  // 模型一改（view 換新）就重新計算
  useEffect(() => { void run("讀取", load); }, [id, view.analysis]);
  if (!data) return <p className="label">讀取中</p>;
  const g = data.rockets.find((r) => r.key === key) ?? data.rockets[0];

  const toSim = () => run("參數", async () => {
    const r = await api<{ notes: string[] }>(`/projects/${id}/rocket/to-sim`, "POST", { key: g.key });
    setMsg({ ok: true, text: `已用模型的幾何更新模擬參數。${r.notes.join("")}` });
  });
  const simulate = () => run("模擬中", async () => {
    await api(`/projects/${id}/rocket/to-sim`, "POST", { key: g.key });
    await api(`/projects/${id}/sim/run`, "POST", {});
    await load();
    setMsg({ ok: true, text: "模擬完成：參數由模型的幾何產生。" });
  });
  const pickOrk = (f: File) => run("匯入", async () => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const base64 = btoa(bin);
    const r = await api<{ changes: Change[]; notes: string[] }>(`/projects/${id}/rocket/import-ork`, "POST", { base64, key: g.key });
    setPending({ base64, ...r });
    if (r.changes.length === 0) setMsg({ ok: true, text: "這個 .ork 和模型的數字相同，沒有要改的。" });
  });
  const applyOrk = () => run("寫回", async () => {
    if (!pending) return;
    const r = await api<View & { changes: Change[] }>(`/projects/${id}/rocket/import-ork`, "POST", { base64: pending.base64, key: g.key, apply: true });
    setPending(null);
    onChanged(r);
    setMsg({ ok: true, text: `已把 ${r.changes.length} 個數字寫回模型，並留下一筆提交。到「版本」可以看差異。` });
  });

  return (
    <>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}
      <section className="section">
        <div className="section-head">
          <h1 className="section-title">火箭外形</h1>
          {data.rockets.length > 1 && <select className="input" style={{ width: "auto" }} value={g?.key ?? ""} onChange={(e) => setKey(e.target.value)} aria-label="選擇火箭">{data.rockets.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select>}
        </div>
        <p className="body muted" style={{ marginBottom: 12 }}>外形、重心和壓力中心都從模型裡各零件的 <code>@Geometry</code> 數字算出來；系統簡圖用的也是同一份數字。要改外形就改模型（或用 OpenRocket 改完匯回），不要另外維護一份。</p>
        {!g ? (
          <>
            <p className="msg"><span className="tag warn">DUE</span>模型裡還沒有任何幾何標記。在火箭（系統）底下的零件加上 <code>@Geometry</code>，例如：</p>
            <pre className="caption" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{EXAMPLE}</pre>
            <p className="caption">位置從鼻錐尖端量起，往尾端為正，單位 m、kg。geoKind：nose 鼻錐、body 箭體段、transition 過渡段、fins 尾翼組、mass 只有質量。寫了 geoPropellant 的段當作引擎。</p>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 24, marginBottom: 8 }}>
              <div><span className="label">全長</span><div className="data">{m3(g.length)} m</div></div>
              <div><span className="label">參考直徑</span><div className="data">{m3(g.refDiameter)} m</div></div>
              <div><span className="label">起飛質量</span><div className="data">{g.liftoff.mass.toFixed(2)} kg</div></div>
              <div><span className="label">重心（起飛／燃畢）</span><div className="data">{m3(g.liftoff.cg)} ／ {m3(g.burnout.cg)} m</div></div>
              <div><span className="label">壓力中心</span><div className="data">{m3(g.cp)} m</div></div>
              <div><span className="label">靜態穩定裕度（起飛／燃畢）</span><div className="data">{g.liftoff.margin?.toFixed(2) ?? "—"} ／ {g.burnout.margin?.toFixed(2) ?? "—"} 倍徑</div></div>
            </div>
            {g.warnings.map((w, i) => <p key={i} className="msg"><span className="tag warn">注意</span>{w}</p>)}
            <RocketSideView g={g} onOpen={onOpen} />
            <p className="caption">壓力中心以 Barrowman 法估算（次音速、小攻角，只計鼻錐、過渡段與尾翼）。實心半圓是起飛重心，虛線是燃畢重心，圓中一點是壓力中心。點一下零件可以打開它。</p>
            <table>
              <thead><tr><th>零件</th><th>種類</th><th style={{ textAlign: "right" }}>位置 m</th><th style={{ textAlign: "right" }}>長度 m</th><th style={{ textAlign: "right" }}>外徑 m</th><th style={{ textAlign: "right" }}>質量 kg</th><th style={{ textAlign: "right" }}>重心 m</th><th style={{ textAlign: "right" }}>CNα</th><th style={{ textAlign: "right" }}>壓力中心 m</th></tr></thead>
              <tbody>{g.sections.map((s) => (
                <tr key={s.id} onClick={() => onOpen(s.id)} style={{ cursor: "pointer" }}>
                  <td>{s.name}</td><td>{KIND_ZH[s.kind]}{s.kind === "fins" && s.fin ? ` ${s.fin.n} 片` : ""}{s.shape ? ` ${s.shape}` : ""}</td>
                  <td className="data" style={{ textAlign: "right" }}>{m3(s.position)}</td><td className="data" style={{ textAlign: "right" }}>{m3(s.length)}</td>
                  <td className="data" style={{ textAlign: "right" }}>{s.kind === "transition" ? `${m3(s.diameter)}→${m3(s.aftDiameter)}` : m3(s.diameter)}</td>
                  <td className="data" style={{ textAlign: "right" }}>{s.mass ? `${s.mass}${s.propellant ? `（推進劑 ${s.propellant}）` : ""}` : "—"}</td>
                  <td className="data" style={{ textAlign: "right" }}>{s.mass ? m3(s.cg) : "—"}</td>
                  <td className="data" style={{ textAlign: "right" }}>{s.cn ? s.cn.toFixed(3) : "—"}</td><td className="data" style={{ textAlign: "right" }}>{m3(s.xcp)}</td>
                </tr>
              ))}</tbody>
            </table>
          </>
        )}
      </section>

      {g && (
        <section className="section">
          <div className="section-head"><h2 className="section-title">模擬（RocketPy）</h2><span className="label">{data.result ? `${data.result.engine} · ${new Date(data.result.at).toLocaleString("zh-TW", { hour12: false })} · 模型 ${data.result.commit}` : "尚未執行"}</span></div>
          <p className="body muted" style={{ marginBottom: 8 }}>模擬參數由上面的幾何產生；推力曲線、降落傘與發射條件在「模擬」分頁設定。</p>
          {!data.available.ok && <p className="msg"><span className="tag danger">ERR</span>{data.available.reason}</p>}
          {!ro && <div className="tbtn-row" style={{ paddingLeft: 0, marginBottom: 8 }}>
            <button className="btn" disabled={!!busy || !data.available.ok} onClick={simulate}>{busy === "模擬中" ? "模擬中（樹莓派上可能要幾分鐘）" : "用模型幾何執行模擬"}</button>
            <button className="tbtn" disabled={!!busy} onClick={toSim}>只更新模擬參數</button>
          </div>}
          {data.result ? <SimCharts result={data.result} /> : <p className="caption">還沒有模擬結果。</p>}
          {data.result?.warnings.map((w, i) => <p key={i} className="msg"><span className="tag warn">注意</span>{w}</p>)}
        </section>
      )}

      {g && (
        <section className="section">
          <div className="section-head"><h2 className="section-title">OpenRocket（選用）</h2></div>
          <p className="body muted" style={{ marginBottom: 8 }}>從模型匯出 .ork，在 OpenRocket 裡調整外形後再匯回。匯回會先列出要改的數字，確認後寫進模型並留下一筆提交，版本由 git 管，不必再手動同步檔案。模型裡沒有的零件不會自動新增。</p>
          <div className="tbtn-row" style={{ paddingLeft: 0, marginBottom: 8 }}>
            <a className="tbtn" href={`/api/projects/${id}/rocket/export.ork?key=${encodeURIComponent(g.key)}`}>匯出 .ork</a>
            {!ro && <button className="tbtn" disabled={!!busy} onClick={() => fileRef.current?.click()}>匯回 .ork</button>}
            <input ref={fileRef} type="file" accept=".ork" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) pickOrk(f); e.target.value = ""; }} />
          </div>
          {pending && (pending.changes.length > 0 || pending.notes.length > 0) && (
            <>
              {pending.notes.map((n, i) => <p key={i} className="msg"><span className="tag warn">注意</span>{n}</p>)}
              {pending.changes.length > 0 && <>
                <table>
                  <thead><tr><th>零件</th><th>欄位</th><th style={{ textAlign: "right" }}>模型</th><th style={{ textAlign: "right" }}>.ork</th></tr></thead>
                  <tbody>{pending.changes.map((c, i) => <tr key={i}><td>{c.name}</td><td>{FIELD_ZH[c.field] ?? c.field} <span className="id">{c.field}</span></td><td className="data" style={{ textAlign: "right" }}>{c.from ?? "—"}</td><td className="data" style={{ textAlign: "right" }}>{c.to}</td></tr>)}</tbody>
                </table>
                <div className="tbtn-row" style={{ paddingLeft: 0, marginTop: 8 }}>
                  <button className="tbtn primary" disabled={!!busy} onClick={applyOrk}>寫回模型（{pending.changes.length} 項）</button>
                  <button className="tbtn" disabled={!!busy} onClick={() => setPending(null)}>取消</button>
                </div>
              </>}
            </>
          )}
        </section>
      )}
    </>
  );
}
