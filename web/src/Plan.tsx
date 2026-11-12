import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.ts";
import type { Me, Meta, View } from "./api.ts";
import { listOf } from "./model.ts";

interface Task { id: string; title: string; priority: string; re: string; start: string; end: string; deps: string[]; gate: string; links: string[]; subsystem: string; done: boolean }
interface Cost { id: string; subsystem: string; item: string; planned: number; actual: number; status: string; note: string }
interface Person { id: string; name: string; rank: string; subsystem: string; duty: string }
interface Pm { tasks: Task[]; costs: Cost[]; people: Person[]; priorities?: { id: string; zh: string; level: number }[]; myLevel?: number }

const today = () => new Date().toISOString().slice(0, 10);
const day = (s: string) => Math.round(new Date(s + "T00:00:00Z").getTime() / 86400_000);
const nt = (n: number) => n.toLocaleString("zh-TW");
const blankTask = (): Task => ({ id: "", title: "", priority: "P5", re: "", start: today(), end: today(), deps: [], gate: "", links: [], subsystem: "", done: false });
const blankCost = (): Cost => ({ id: "", subsystem: "", item: "", planned: 0, actual: 0, status: "規劃中", note: "" });
const blankPerson = (): Person => ({ id: "", name: "", rank: "C-II", subsystem: "", duty: "" });

function Gantt({ tasks, onPick }: { tasks: Task[]; onPick: (t: Task) => void }) {
  if (tasks.length === 0) return null;
  const min = Math.min(...tasks.map((t) => day(t.start))), max = Math.max(...tasks.map((t) => day(t.end))) + 1;
  const span = Math.max(max - min, 7);
  const labelW = 220, W = 900, rowH = 28, top = 26;
  const x = (d: number) => labelW + ((d - min) / span) * (W - labelW - 8);
  const months: { d: number; text: string }[] = [];
  const first = new Date(min * 86400_000);
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); m.getTime() / 86400_000 < max; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const d = Math.round(m.getTime() / 86400_000);
    if (d >= min) months.push({ d, text: `${String(m.getUTCMonth() + 1).padStart(2, "0")}` });
  }
  const now = day(today());
  const summary = `${tasks.length} 項任務，${tasks.filter((t) => t.done).length} 項完成，${tasks.filter((t) => !t.done && t.end < today()).length} 項逾期。`;
  return (
    <svg viewBox={`0 0 ${W} ${top + tasks.length * rowH + 8}`} style={{ width: "100%", display: "block", marginBottom: 16 }} role="img" aria-label={`甘特圖：${summary}`}>
      {months.map((m) => <g key={m.d}><line x1={x(m.d)} y1={top - 6} x2={x(m.d)} y2={top + tasks.length * rowH} stroke="var(--line)" /><text x={x(m.d) + 4} y={12} fontSize="10" fill="var(--ink-faint)" letterSpacing="1">{m.text}</text></g>)}
      {tasks.map((t, i) => {
        const y = top + i * rowH + rowH / 2;
        const late = !t.done && t.end < today();
        return (
          <g key={t.id} onClick={() => onPick(t)} style={{ cursor: "pointer" }}>
            <text x={0} y={y + 4} fontSize="10" fill="var(--ink-faint)" letterSpacing="0.5">{t.id}</text>
            <text x={44} y={y + 4} fontSize="12" fill={t.done ? "var(--ink-faint)" : "var(--ink)"} fontFamily="var(--font-sans)">{t.title.length > 14 ? t.title.slice(0, 13) + "…" : t.title}</text>
            <line x1={labelW} y1={y} x2={W - 8} y2={y} stroke="var(--line)" />
            <line x1={x(day(t.start))} y1={y} x2={x(day(t.end) + 1)} y2={y} stroke="var(--ink)" strokeWidth={t.done ? 1 : 3} strokeDasharray={t.done ? "3 3" : undefined} />
            <circle cx={x(day(t.end) + 1)} cy={y} r={3.5} fill={late ? "var(--danger)" : t.done ? "var(--bg)" : "var(--ink)"} stroke="var(--ink)" />
            {late && <text x={x(day(t.end) + 1) + 8} y={y + 4} fontSize="10" fill="var(--ink)" letterSpacing="1">LATE</text>}
          </g>
        );
      })}
      {now >= min && now <= max && <line x1={x(now)} y1={top - 6} x2={x(now)} y2={top + tasks.length * rowH} stroke="var(--ink)" strokeWidth="2" />}
    </svg>
  );
}

/** 時程、成本、人員。優先級的設定權限依 AEAS 職級。 */
export function PlanView({ view, meta, user }: { view: View; meta: Meta; user: Me }) {
  const id = view.project.id;
  const [pm, setPm] = useState<Pm | null>(null);
  const [extra, setExtra] = useState<{ priorities: { id: string; zh: string; level: number }[]; myLevel: number }>({ priorities: [], myLevel: 0 });
  const [task, setTask] = useState<Task>(blankTask);
  const [cost, setCost] = useState<Cost>(blankCost);
  const [person, setPerson] = useState<Person>(blankPerson);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const ro = !user.caps.edit;
  const subsystems = listOf(view.analysis.elements, "Subsystem").map((s) => s.name);

  const run = async (fn: () => Promise<void>) => { setMsg(null); try { await fn(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  useEffect(() => { run(async () => { const p = await api<Pm>(`/projects/${id}/pm`); setPm(p); setExtra({ priorities: p.priorities ?? [], myLevel: p.myLevel ?? 0 }); }); }, [id]);
  const save = (kind: "tasks" | "costs" | "people", body: object, reset: () => void) => (ev: FormEvent) => { ev.preventDefault(); run(async () => { setPm(await api<Pm>(`/projects/${id}/pm/${kind}`, "POST", { ...body })); reset(); }); };
  const del = (kind: "tasks" | "costs" | "people", itemId: string, reset: () => void) => run(async () => { setPm(await api<Pm>(`/projects/${id}/pm/${kind}/delete`, "POST", { id: itemId })); reset(); });

  if (!pm) return <p className="label">讀取中</p>;
  const planned = pm.costs.reduce((s, c) => s + c.planned, 0), actual = pm.costs.reduce((s, c) => s + c.actual, 0);
  const groups = [...new Set(pm.costs.map((c) => c.subsystem || "未分類"))];
  const sub = (v: string, on: (v: string) => void) => (
    <label className="field"><span className="label">次系統</span><input className="input" list="jri-subsystems" value={v} onChange={(e) => on(e.target.value)} /></label>
  );

  return (
    <>
      <datalist id="jri-subsystems">{subsystems.map((s) => <option key={s} value={s} />)}</datalist>
      {msg && <p className="msg" role="status">{!msg.ok && <span className="tag danger">ERR</span>}{msg.text}</p>}

      <section className="section">
        <div className="section-head"><h1 className="section-title">時程</h1><span className="label">{pm.tasks.filter((t) => t.done).length} / {pm.tasks.length}</span></div>
        <p className="body muted" style={{ marginBottom: 12 }}>AEAS 規定所有年度計畫都要有甘特圖。先設里程碑（各審查節點），再往回排任務。點任務可以修改。</p>
        <Gantt tasks={pm.tasks} onPick={setTask} />
        {pm.tasks.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>ID</th><th>任務</th><th>優先級</th><th>責任工程師</th><th>期間</th><th>相依</th><th>節點</th><th>狀態</th></tr></thead>
            <tbody>{pm.tasks.map((t) => {
              const late = !t.done && t.end < today();
              return (
                <tr key={t.id} className="rowbtn" aria-selected={task.id === t.id} onClick={() => setTask(t)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") setTask(t); }}>
                  <td className="id">{t.id}</td><td>{t.title}{t.links.length > 0 && <div className="caption">{t.links.join("、")}</div>}</td><td className="id">{t.priority}</td><td>{t.re}<div className="caption">{t.subsystem}</div></td>
                  <td className="id">{t.start.slice(5)} → {t.end.slice(5)}</td><td className="id">{t.deps.join(" ") || "—"}</td><td className="id">{t.gate.toUpperCase() || "—"}</td>
                  <td>{t.done ? <span className="tag done">DONE</span> : late ? <span className="tag danger">LATE</span> : <span className="tag">進行中</span>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {!ro && (
          <form onSubmit={save("tasks", task, () => setTask(blankTask()))}>
            <div className="row">
              <label className="field" style={{ flex: 3 }}><span className="label">{task.id ? `修改任務 ${task.id}` : "新增任務"}</span><input className="input" required value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} /></label>
              <label className="field"><span className="label">優先級</span>
                <select className="input" value={task.priority} onChange={(e) => setTask({ ...task, priority: e.target.value })}>
                  {extra.priorities.map((p) => <option key={p.id} value={p.id} disabled={p.level > extra.myLevel}>{p.id} {p.zh}{p.level > extra.myLevel ? "（職級不足）" : ""}</option>)}
                </select></label>
              <label className="field"><span className="label">責任工程師</span><input className="input" list="jri-people" value={task.re} onChange={(e) => setTask({ ...task, re: e.target.value })} /></label>
              {sub(task.subsystem, (v) => setTask({ ...task, subsystem: v }))}
            </div>
            <div className="row">
              <label className="field"><span className="label">開始</span><input className="input" type="date" required value={task.start} onChange={(e) => setTask({ ...task, start: e.target.value })} /></label>
              <label className="field"><span className="label">結束</span><input className="input" type="date" required value={task.end} onChange={(e) => setTask({ ...task, end: e.target.value })} /></label>
              <label className="field"><span className="label">相依的任務 ID</span><input className="input" value={task.deps.join(" ")} onChange={(e) => setTask({ ...task, deps: e.target.value.split(/[\s,，、]+/).filter(Boolean) })} /></label>
              <label className="field"><span className="label">對應節點</span><select className="input" value={task.gate} onChange={(e) => setTask({ ...task, gate: e.target.value })}><option value="">無</option>{meta.gates.map((g) => <option key={g.id} value={g.id}>{g.zh}</option>)}</select></label>
              <label className="field"><span className="label">連結的需求編號</span><input className="input" value={task.links.join(" ")} onChange={(e) => setTask({ ...task, links: e.target.value.split(/[\s,，、]+/).filter(Boolean) })} placeholder="REQ-SYS-001" /></label>
            </div>
            <div className="tbtn-row">
              <label className="check"><input type="checkbox" checked={task.done} onChange={(e) => setTask({ ...task, done: e.target.checked })} /><span className="caption">已完成</span></label>
              <button className="tbtn primary">{task.id ? "更新任務" : "新增任務"}</button>
              {task.id && <><button type="button" className="tbtn" onClick={() => setTask(blankTask())}>取消</button><button type="button" className="tbtn" onClick={() => del("tasks", task.id, () => setTask(blankTask()))}>刪除</button></>}
            </div>
          </form>
        )}
        <datalist id="jri-people">{pm.people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">成本</h2><span className="label">實支 {nt(actual)} / 預算 {nt(planned)}</span></div>
        {groups.map((g) => {
          const items = pm.costs.filter((c) => (c.subsystem || "未分類") === g);
          const p = items.reduce((s, c) => s + c.planned, 0), a = items.reduce((s, c) => s + c.actual, 0);
          return (
            <div key={g} style={{ display: "grid", gridTemplateColumns: "10rem 1fr 12rem", gap: 12, alignItems: "center", minHeight: 28 }}>
              <span className="body">{g}</span>
              <span className="meter"><span style={{ width: `${p ? Math.min(100, (a / p) * 100) : 0}%` }} /></span>
              <span className="data" style={{ textAlign: "right" }}>{nt(a)} / {nt(p)} {a > p && <span className="tag danger">OVER</span>}</span>
            </div>
          );
        })}
        {pm.costs.length > 0 && (
          <table style={{ margin: "12px 0 16px" }}>
            <thead><tr><th>編號</th><th>次系統</th><th>項目</th><th style={{ textAlign: "right" }}>預算</th><th style={{ textAlign: "right" }}>實支</th><th>狀態</th><th>備註</th></tr></thead>
            <tbody>{pm.costs.map((c) => (
              <tr key={c.id} className="rowbtn" aria-selected={cost.id === c.id} onClick={() => setCost(c)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") setCost(c); }}>
                <td className="id">{c.id}</td><td>{c.subsystem}</td><td>{c.item}</td><td className="id" style={{ textAlign: "right" }}>{nt(c.planned)}</td><td className="id" style={{ textAlign: "right" }}>{nt(c.actual)}</td><td>{c.status}</td><td>{c.note}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {!ro && (
          <form onSubmit={save("costs", cost, () => setCost(blankCost()))}>
            <div className="row">
              <label className="field" style={{ flex: 3 }}><span className="label">{cost.id ? `修改項目 ${cost.id}` : "新增採購或支出項目"}</span><input className="input" required value={cost.item} onChange={(e) => setCost({ ...cost, item: e.target.value })} /></label>
              {sub(cost.subsystem, (v) => setCost({ ...cost, subsystem: v }))}
              <label className="field"><span className="label">預算（元）</span><input className="input" inputMode="numeric" value={cost.planned || ""} onChange={(e) => setCost({ ...cost, planned: Number(e.target.value) || 0 })} /></label>
              <label className="field"><span className="label">實支（元）</span><input className="input" inputMode="numeric" value={cost.actual || ""} onChange={(e) => setCost({ ...cost, actual: Number(e.target.value) || 0 })} /></label>
              <label className="field"><span className="label">狀態</span><select className="input" value={cost.status} onChange={(e) => setCost({ ...cost, status: e.target.value })}>{["規劃中", "已請購", "已下單", "已到貨", "已核銷"].map((s) => <option key={s}>{s}</option>)}</select></label>
            </div>
            <div className="row"><label className="field"><span className="label">備註</span><input className="input" value={cost.note} onChange={(e) => setCost({ ...cost, note: e.target.value })} /></label></div>
            <div className="tbtn-row"><button className="tbtn primary">{cost.id ? "更新項目" : "新增項目"}</button>
              {cost.id && <><button type="button" className="tbtn" onClick={() => setCost(blankCost())}>取消</button><button type="button" className="tbtn" onClick={() => del("costs", cost.id, () => setCost(blankCost()))}>刪除</button></>}</div>
          </form>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">人員</h2><span className="label">{pm.people.length}</span></div>
        {pm.people.length > 0 && (
          <table style={{ marginBottom: 16 }}>
            <thead><tr><th>姓名</th><th>職級</th><th>次系統</th><th>職責</th><th>負責的任務</th></tr></thead>
            <tbody>{pm.people.map((p) => {
              const mine = pm.tasks.filter((t) => t.re === p.name);
              return (
                <tr key={p.id} className="rowbtn" aria-selected={person.id === p.id} onClick={() => setPerson(p)} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") setPerson(p); }}>
                  <td>{p.name}</td><td className="id">{p.rank}</td><td>{p.subsystem}</td><td>{p.duty}</td><td>{mine.filter((t) => !t.done).length} 項進行中<div className="caption">{mine.filter((t) => !t.done).map((t) => t.id).join(" ")}</div></td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {!ro && (
          <form onSubmit={save("people", person, () => setPerson(blankPerson()))}>
            <div className="row">
              <label className="field"><span className="label">{person.id ? "修改人員" : "新增人員"}</span><input className="input" required value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} /></label>
              <label className="field"><span className="label">AEAS 職級</span><select className="input" value={person.rank} onChange={(e) => setPerson({ ...person, rank: e.target.value })}>{["F-VIII", "R-VIII", "D-VII", "O-VI", "O-V", "O-IV", "C-III", "C-II"].map((r) => <option key={r}>{r}</option>)}</select></label>
              {sub(person.subsystem, (v) => setPerson({ ...person, subsystem: v }))}
              <label className="field" style={{ flex: 2 }}><span className="label">職責</span><input className="input" value={person.duty} onChange={(e) => setPerson({ ...person, duty: e.target.value })} /></label>
            </div>
            <div className="tbtn-row"><button className="tbtn primary">{person.id ? "更新人員" : "新增人員"}</button>
              {person.id && <><button type="button" className="tbtn" onClick={() => setPerson(blankPerson())}>取消</button><button type="button" className="tbtn" onClick={() => del("people", person.id, () => setPerson(blankPerson()))}>刪除</button></>}</div>
          </form>
        )}
      </section>
    </>
  );
}
