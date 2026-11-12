import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api.ts";
import type { Diagnostic } from "./api.ts";

/** 專家模式：直接編輯 SysML v2 原始碼，輸入時即時檢查，有錯誤不能儲存。 */
export function SourceTab({ id, onSaved }: { id: string; onSaved: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState("model.sysml");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState("");
  const [diags, setDiags] = useState<Diagnostic[]>([]);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { api<string[]>(`/projects/${id}/files`).then(setFiles).catch(() => setFiles(["model.sysml"])); }, [id]);
  useEffect(() => {
    api<{ content: string }>(`/projects/${id}/files/${encodeURIComponent(file)}`)
      .then((r) => { setContent(r.content); setSaved(r.content); setDiags([]); })
      .catch((e) => setStatus({ ok: false, text: e.message }));
  }, [id, file]);

  // 停止輸入 0.6 秒後檢查
  useEffect(() => {
    if (content === saved) return;
    setChecking(true);
    const t = setTimeout(() => {
      api<{ ok: boolean; diagnostics: Diagnostic[] }>(`/projects/${id}/validate`, "POST", { file, content })
        .then((r) => setDiags(r.diagnostics.filter((d) => !d.file || d.file === file)))
        .catch(() => undefined)
        .finally(() => setChecking(false));
    }, 600);
    return () => clearTimeout(t);
  }, [content, saved, id, file]);

  const dirty = content !== saved;
  const errors = diags.filter((d) => d.severity === "error");

  const save = async () => {
    setStatus(null);
    try {
      const r = await api<{ saved: boolean; commit: string }>(`/projects/${id}/files/${encodeURIComponent(file)}`, "PUT", { content, message });
      setSaved(content); setMessage(""); setStatus({ ok: true, text: `已儲存（版本 ${r.commit}）。` });
      onSaved();
    } catch (e) {
      const err = e as ApiError;
      if (err.diagnostics.length) setDiags(err.diagnostics);
      setStatus({ ok: false, text: err.message });
    }
  };

  const goto = (line: number) => {
    const el = area.current;
    if (!el) return;
    const pos = content.split("\n").slice(0, line - 1).join("\n").length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(pos, pos + (content.split("\n")[line - 1]?.length ?? 0));
    el.scrollTop = Math.max(0, (line - 5) * 20);
  };

  return (
    <section className="section" style={{ flex: 1, minHeight: 0 }}>
      <div className="section-head"><h1 className="section-title">原始碼</h1><span className="label">SYSML V2</span></div>
      <p className="caption" style={{ marginBottom: 12 }}>模型的原始文字，支援完整 SysML v2 語法。有錯誤時不會儲存。</p>
      <div className="row">
        <label className="field" style={{ flex: "0 0 12rem" }}><span className="label">檔案</span><select className="input" value={file} onChange={(e) => setFile(e.target.value)} disabled={dirty}>{files.map((f) => <option key={f}>{f}</option>)}</select></label>
        <label className="field" style={{ flex: 1 }}><span className="label">修改說明</span><input className="input" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="這次改了什麼" /></label>
        <div className="tbtn-row" style={{ marginBottom: 12 }}>
          <button className="btn" disabled={!dirty || errors.length > 0 || checking} onClick={save}>寫入</button>
          <button className="tbtn" disabled={!dirty} onClick={() => { setContent(saved); setDiags([]); }}>放棄修改</button>
        </div>
      </div>
      {status && <p className="msg">{!status.ok && <span className="tag danger">ERR</span>}{status.text}</p>}
      <textarea ref={area} className="code" spellCheck={false} value={content} onChange={(e) => setContent(e.target.value)} aria-label="SysML v2 原始碼" />
      <div style={{ marginTop: 8 }}>
        {checking ? <span className="label">檢查中</span> : diags.length === 0 ? <span className="label">{dirty ? "沒有錯誤，可以寫入" : "沒有未儲存的修改"}</span> : (
          <div className="stack">{diags.map((d, i) => (
            <div key={i} className="msg" style={{ margin: 0 }}><button className="tbtn" onClick={() => goto(d.line)}>第 {d.line} 行</button>{d.severity === "error" && <span className="tag danger">ERR</span>}<span>{d.message}</span></div>
          ))}</div>
        )}
      </div>
    </section>
  );
}
