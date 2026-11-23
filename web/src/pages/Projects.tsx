// 專案列表：開啟、建立、刪除（封存）專案。
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api.ts";
import type { Me, Meta, Project } from "../api.ts";
import "./projects.css";

const TEMPLATES: { id: "blank" | "sample" | "guided"; zh: string; help: string }[] = [
  { id: "guided", zh: "流程範本專案", help: "從利害關係人開始，一步一個問題帶你完成分析。前一步沒完成不能跳到下一步。建議新專案使用。" },
  { id: "sample", zh: "範本專案", help: "附一份探空火箭的示範內容，可以對照著修改。適合想先看完整範例的人。" },
  { id: "blank", zh: "空白專案", help: "從空的模型開始，順序自己決定。適合已經熟悉方法的人。" },
];

export function ProjectsPage({ meta, user, onOpen }: { meta: Meta; user: Me; onOpen: (id: string) => void }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [form, setForm] = useState({ id: "", name: "", kind: "annual" as "annual" | "small", gates: ["mdr", "cdr", "trr"], template: "guided" as "blank" | "sample" | "guided" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Project | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const archive = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!removing) return;
    setError("");
    try {
      await api(`/projects/${removing.id}/archive`, "POST", { confirm: confirmText });
      setProjects((ps) => (ps ?? []).filter((p) => p.id !== removing.id));
      setRemoving(null); setConfirmText("");
    } catch (e) { setError((e as Error).message); }
  };
  useEffect(() => { api<Project[]>("/projects").then(setProjects).catch((e) => setError(e.message)); }, []);
  const create = async (ev: FormEvent) => {
    ev.preventDefault(); setBusy(true); setError("");
    try { onOpen((await api<Project>("/projects", "POST", form)).id); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="page proj-page">
      <div className="fluid-bg" aria-hidden="true"><i /><i /><i /><i /></div>
      <div className="proj-col">
      <section className="section proj-card">
        <div className="section-head"><h1 className="section-title">專案</h1><span className="label">{projects?.length ?? 0}</span></div>
        {projects === null ? <p className="label">載入中</p> : projects.length === 0 ? <p className="body muted">{user.caps.createProject ? "還沒有專案。在右側建立第一個。" : "還沒有可以開啟的專案。"}</p> : projects.map((p) => (
          <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button className="proj" onClick={() => onOpen(p.id)}>
              <span className="heading" style={{ flex: 1 }}>{p.name}</span>
              <span className="label">{p.kind === "annual" ? "年度計畫" : "小型專案"}</span>
              <span className="label">{p.gates.length} 節點</span>
              <span className="label">{p.id}</span>
            </button>
            {user.caps.admin && <button className="tbtn" onClick={() => { setRemoving(p); setConfirmText(""); setError(""); }}>刪除</button>}
          </div>
        ))}
        {removing && (
          <form onSubmit={archive} style={{ marginTop: 24 }}>
            <div className="section-head"><h2 className="section-title">刪除專案</h2><span className="tag danger">DELETE</span></div>
            <p className="body" style={{ marginBottom: 12 }}>「{removing.name}」會從列表移除，所有人都無法再開啟。資料會移到這台電腦的封存資料夾，需要時可以請管理員還原。</p>
            <label className="field"><span className="label">輸入專案名稱「{removing.name}」確認</span><input className="input" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoFocus /></label>
            <div className="tbtn-row"><button className="tbtn primary" disabled={confirmText.trim() !== removing.name}>確定刪除</button><button type="button" className="tbtn" onClick={() => setRemoving(null)}>取消</button></div>
          </form>
        )}
      </section>
      {user.caps.createProject && <form className="section proj-card" onSubmit={create}>
        <div className="section-head"><h2 className="section-title">建立專案</h2></div>
        <label className="field"><span className="label">名稱</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="2027 年度探空火箭" /></label>
        <label className="field"><span className="label">代號</span><input className="input" required value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value.toLowerCase() })} placeholder="sr-2027" pattern="[a-z0-9][a-z0-9\-]{1,40}" /></label>
        <p className="caption" style={{ marginBottom: 12 }}>小寫英數與連字號，會成為儲存庫名稱，之後不能改。</p>
        <fieldset className="choices">
          <legend className="label">建立方式</legend>
          {TEMPLATES.map((t) => (
            <label key={t.id} className={`choice ${form.template === t.id ? "on" : ""}`}>
              <input type="radio" name="template" checked={form.template === t.id} onChange={() => setForm({ ...form, template: t.id })} />
              <span><span className="heading">{t.zh}</span><span className="caption">{t.help}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="field"><span className="label">類型</span>
          <select className="input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "annual" | "small" })}>
            <option value="annual">年度計畫（全部節點）</option><option value="small">小型專案（自選節點）</option>
          </select>
        </label>
        {form.kind === "small" && meta.gates.map((g) => (
          <label key={g.id} className="check">
            <input type="checkbox" checked={form.gates.includes(g.id)} onChange={(e) => setForm({ ...form, gates: e.target.checked ? [...form.gates, g.id] : form.gates.filter((x) => x !== g.id) })} />
            <span>{g.zh}</span>
          </label>
        ))}
        {error && <p className="msg"><span className="tag danger">ERR</span>{error}</p>}
        <div style={{ marginTop: 12 }}><button className="btn" disabled={busy}>{busy ? "建立中" : "建立"}</button></div>
      </form>}
      </div>
    </main>
  );
}
