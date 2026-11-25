// 流程頁下半：團隊討論白板。便利貼、框、連線；便利貼可以連到模型元素。
// 存在專案儲存庫的 board.json（server/board.ts）。每次修改只送改了的那幾項，伺服器逐項三方合併，多人同時改不會互相蓋掉。
// 畫面每 10 秒重讀一次；正在拖或正在打字的那一項先保留自己的版本。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { api } from "../api.ts";
import type { PageProps } from "../workspace.ts";
import "./board.css";
import { PeerMarks, usePeerColor, useReportCard } from "../presence.tsx";

type Kind = "note" | "frame" | "link";
type Color = "yellow" | "blue" | "green" | "pink" | "gray";
interface Item {
  id: string; kind: Kind; x?: number; y?: number; w?: number; h?: number; text: string;
  color?: Color; ref?: string; from?: string; to?: string;
  author: string; at: string; by: string; updated: string;
}
interface Board { items: Item[]; by: string; at: string }
type Op = { op: "put"; base: Item | null; item: Item } | { op: "del"; id: string };

const COLORS: [Color, string][] = [["yellow", "黃"], ["blue", "藍"], ["green", "綠"], ["pink", "粉"], ["gray", "灰"]];
const POLL_MS = 10_000;
const newId = (kind: Kind) => `${kind}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const box = (i: Item) => ({ x: i.x ?? 0, y: i.y ?? 0, w: i.w ?? 180, h: i.h ?? 110 });

/** 從方塊中心往另一點的方向，與方塊邊緣的交點（連線畫到邊上，不壓在字上）。 */
function edgePoint(b: { x: number; y: number; w: number; h: number }, tx: number, ty: number) {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return { x: cx, y: cy };
  const s = Math.min(Math.abs((b.w / 2) / (dx || 1e-9)), Math.abs((b.h / 2) / (dy || 1e-9)));
  return { x: cx + dx * s, y: cy + dy * s };
}

type Drag = { id: string; mode: "move" | "size"; sx: number; sy: number; orig: { x: number; y: number; w: number; h: number } };

export function BoardSection(p: PageProps) {
  const ref = p.id;
  const canEdit = !p.readOnly && p.user.caps.edit;
  const [items, setItems] = useState<Item[]>([]);
  const [meta, setMeta] = useState<{ by: string; at: string }>({ by: "", at: "" });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null | "pick">(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [picking, setPicking] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  /** 伺服器上次給的每一項（三方合併的 base） */
  const server = useRef(new Map<string, Item>());
  const queue = useRef<Op[]>([]);
  const sending = useRef(false);
  /** 正在拖或正在打字的項目：重讀時保留畫面上的版本 */
  const busy = useRef(new Set<string>());

  const adopt = useCallback((b: Board) => {
    server.current = new Map(b.items.map((i) => [i.id, i]));
    setMeta({ by: b.by, at: b.at });
    setItems((cur) => {
      if (queue.current.length || sending.current) return cur; // 還有沒送出的修改，等送完再換
      const local = new Map(cur.map((i) => [i.id, i]));
      return b.items.map((i) => (busy.current.has(i.id) && local.get(i.id)) || i);
    });
  }, []);

  const load = useCallback(async () => {
    try {
      adopt(await api<Board>(`/projects/${encodeURIComponent(ref)}/board`));
      setLoaded(true);
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, [ref, adopt]);

  useEffect(() => {
    setItems([]); server.current = new Map(); queue.current = []; setLoaded(false);
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const flush = useCallback(async () => {
    if (sending.current || !queue.current.length) return;
    sending.current = true;
    const ops = queue.current;
    queue.current = [];
    try {
      const r = await api<{ board: Board; skipped: string[] }>(`/projects/${encodeURIComponent(ref)}/board`, "POST", { ops });
      if (r.skipped.length) p.onNotice("有項目已被別人刪除，你的修改沒有套用。");
      sending.current = false;
      adopt(r.board);
    } catch (e) {
      sending.current = false;
      p.onNotice(`白板沒有存起來：${(e as Error).message}`);
      void load();
    }
    if (queue.current.length) void flush();
  }, [ref, adopt, load, p]);

  const send = useCallback((ops: Op[]) => { queue.current.push(...ops); void flush(); }, [flush]);

  /** 改一項：畫面先改，再送出（base 是伺服器上次的版本） */
  const put = useCallback((item: Item) => {
    setItems((cur) => cur.some((i) => i.id === item.id) ? cur.map((i) => i.id === item.id ? item : i) : [...cur, item]);
    send([{ op: "put", base: server.current.get(item.id) ?? null, item }]);
  }, [send]);

  const remove = useCallback((id: string) => {
    setItems((cur) => cur.filter((i) => i.id !== id && !(i.kind === "link" && (i.from === id || i.to === id))));
    setSel(null); setEditing(null);
    send([{ op: "del", id }]);
  }, [send]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const elements = useMemo(() => p.view.analysis.elements.filter((e) => e.category && !e.shared)
    .map((e) => ({ id: e.id, label: e.shortName ? `${e.shortName} ${e.name}` : e.name, short: e.shortName || e.name, cat: p.meta.categories.find((c) => c.id === e.category)?.zh ?? "" }))
    .sort((a, b) => a.cat.localeCompare(b.cat) || a.label.localeCompare(b.label)), [p.view, p.meta]);
  const elById = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);

  // 新項目放在目前看得到的範圍裡
  const spot = (w: number, h: number) => {
    const c = canvasRef.current;
    const n = items.filter((i) => i.kind !== "link").length;
    return { x: Math.round((c?.scrollLeft ?? 0) + 24 + (n % 6) * 24), y: Math.round((c?.scrollTop ?? 0) + 24 + (n % 6) * 20), w, h };
  };
  const addNote = () => {
    const it: Item = { id: newId("note"), kind: "note", ...spot(180, 110), text: "", color: "yellow", author: p.user.name, at: new Date().toISOString(), by: p.user.name, updated: new Date().toISOString() };
    put(it); setSel(it.id); setEditing(it.id); busy.current.add(it.id);
  };
  const addFrame = () => {
    const it: Item = { id: newId("frame"), kind: "frame", ...spot(420, 240), text: "新的框", author: p.user.name, at: new Date().toISOString(), by: p.user.name, updated: new Date().toISOString() };
    put(it); setSel(it.id);
  };
  const clickBox = (id: string) => {
    if (linkFrom === "pick") { setLinkFrom(id); return; }
    if (linkFrom) {
      if (linkFrom !== id && !items.some((i) => i.kind === "link" && ((i.from === linkFrom && i.to === id) || (i.from === id && i.to === linkFrom)))) {
        const it: Item = { id: newId("link"), kind: "link", from: linkFrom, to: id, text: "", author: p.user.name, at: "", by: "", updated: "" };
        put(it); setSel(it.id);
      }
      setLinkFrom(null);
      return;
    }
    setSel(id);
  };

  // 拖曳（移動與改大小）
  const startDrag = (e: RPointerEvent, it: Item, mode: Drag["mode"]) => {
    if (!canEdit || linkFrom || e.button !== 0) return;
    e.stopPropagation();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 拿不到也照樣拖，事件會冒泡到畫布 */ }
    busy.current.add(it.id);
    setSel(it.id);
    setDrag({ id: it.id, mode, sx: e.clientX, sy: e.clientY, orig: box(it) });
  };
  const moveDrag = (e: RPointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    const o = drag.orig;
    const min = byId.get(drag.id)?.kind === "note" ? [120, 64] : [160, 100];
    const next = drag.mode === "move" ? { x: Math.max(0, Math.round(o.x + dx)), y: Math.max(0, Math.round(o.y + dy)) } : { w: Math.max(min[0], Math.round(o.w + dx)), h: Math.max(min[1], Math.round(o.h + dy)) };
    setItems((cur) => cur.map((i) => i.id === drag.id ? { ...i, ...next } : i));
  };
  const endDrag = () => {
    if (!drag) return;
    const it = byId.get(drag.id);
    busy.current.delete(drag.id);
    setDrag(null);
    if (it) { const b = box(it); if (b.x !== drag.orig.x || b.y !== drag.orig.y || b.w !== drag.orig.w || b.h !== drag.orig.h) put(it); }
  };

  const finishText = (it: Item, text: string) => {
    busy.current.delete(it.id);
    setEditing(null);
    const s = server.current.get(it.id);
    if (!s || s.text !== text || it.text !== text) put({ ...it, text });
  };

  // 鍵盤：Delete 刪除選取，Esc 取消連線或選取
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!canvasRef.current?.contains(t) && t !== document.body) return;
      if (e.key === "Escape") { setLinkFrom(null); setSel(null); setPicking(false); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel && canEdit && !editing) { e.preventDefault(); remove(sel); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, canEdit, editing, remove]);

  const boxes = items.filter((i) => i.kind !== "link");
  const frames = boxes.filter((i) => i.kind === "frame");
  const notes = boxes.filter((i) => i.kind === "note");
  const links = items.filter((i) => i.kind === "link");
  const size = boxes.reduce((s, i) => { const b = box(i); return { w: Math.max(s.w, b.x + b.w + 200), h: Math.max(s.h, b.y + b.h + 120) }; }, { w: 1400, h: 560 });
  const selected = sel ? byId.get(sel) ?? null : null;
  useReportCard(selected && selected.kind !== "link" ? { kind: "card", id: selected.id, label: (selected.text || (selected.kind === "frame" ? "框" : "便利貼")).slice(0, 40) } : null);

  const openRef = (id: string) => { p.setSel({ type: "element", id }); p.go("model"); };

  return (
    <section className="section board" aria-label="討論白板">
      <div className="section-head board-head">
        <h2 className="section-title">討論白板</h2>
        <span className="caption">{meta.at ? `最後更新：${meta.by} · ${when(meta.at)}` : loaded ? "還沒有內容" : "載入中…"}</span>
        <span className="board-grow" />
        {canEdit ? <>
          <button className="tbtn primary" onClick={addNote}>＋便利貼</button>
          <button className="tbtn primary" aria-pressed={!!linkFrom} onClick={() => setLinkFrom(linkFrom ? null : sel && byId.get(sel)?.kind !== "link" ? sel : "pick")}>＋連線</button>
          <button className="tbtn primary" onClick={addFrame}>＋框</button>
        </> : <span className="tag">唯讀</span>}
      </div>
      <p className="caption board-hint">
        {linkFrom === "pick" ? "連線：先點起點的便利貼或框（Esc 取消）" : linkFrom ? "連線：再點終點（Esc 取消）"
          : canEdit ? "拖上緣移動、拖右下角改大小、雙擊改文字；選取後按 Delete 刪除。內容存在專案儲存庫，儲存庫公開時白板也公開。"
          : "唯讀：只能看。"}
        {p.view.branch ? `　目前在分支 ${p.view.branch.name}，這裡的修改只在這個分支。` : ""}
      </p>
      {error && <p className="msg"><span className="tag">錯誤</span>{error}</p>}

      {canEdit && selected && (
        <div className="board-tools" role="toolbar" aria-label="選取項目的操作">
          <span className="label">{selected.kind === "note" ? "便利貼" : selected.kind === "frame" ? "框" : "連線"}</span>
          {selected.kind === "note" && <>
            {COLORS.map(([c, zh]) => <button key={c} className={`board-swatch c-${c}`} aria-label={`顏色：${zh}`} aria-pressed={selected.color === c} onClick={() => put({ ...selected, color: c })} />)}
            {picking
              ? <select className="input board-pick" autoFocus defaultValue={selected.ref ?? ""} aria-label="連到模型元素" onChange={(e) => { setPicking(false); put({ ...selected, ref: e.target.value || undefined }); }} onBlur={() => setPicking(false)}>
                  <option value="">（不連結）</option>
                  {elements.map((e) => <option key={e.id} value={e.id}>{e.cat}　{e.label}</option>)}
                </select>
              : <button className="tbtn" onClick={() => setPicking(true)}>{selected.ref ? "改連結的模型元素" : "連到模型元素"}</button>}
            {selected.ref && !picking && <button className="tbtn" onClick={() => { const { ref: _drop, ...rest } = selected; put(rest as Item); }}>取消連結</button>}
            <button className="tbtn" onClick={() => { busy.current.add(selected.id); setEditing(selected.id); }}>改文字</button>
          </>}
          {selected.kind === "frame" && <button className="tbtn" onClick={() => setEditing(selected.id)}>改名稱</button>}
          <button className="tbtn" onClick={() => { setLinkFrom(selected.kind === "link" ? "pick" : selected.id); }} hidden={selected.kind === "link"}>從這裡連線</button>
          <button className="tbtn danger" onClick={() => remove(selected.id)}>刪除</button>
        </div>
      )}

      <div className={`board-canvas${linkFrom ? " linking" : ""}`} ref={canvasRef} tabIndex={-1}
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("board-plane")) { setSel(null); setPicking(false); } }}
        onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div className="board-plane" style={{ width: size.w, height: size.h }}>
          {frames.map((f) => {
            const b = box(f);
            return (
              <PeerBox key={f.id} id={f.id} className={`board-frame${sel === f.id ? " sel" : ""}${linkFrom === f.id ? " from" : ""}`} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                onPointerDown={(e) => { if (e.target === e.currentTarget) clickBox(f.id); }}>
                <div className="board-frame-title" onPointerDown={(e) => { clickBox(f.id); startDrag(e, f, "move"); }} onDoubleClick={() => canEdit && setEditing(f.id)}>
                  {editing === f.id
                    ? <input className="input" autoFocus defaultValue={f.text} maxLength={80} aria-label="框的名稱" onPointerDown={(e) => e.stopPropagation()}
                        onBlur={(e) => finishText(f, e.target.value.trim() || "框")} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setEditing(null); } }} />
                    : <span>框：{f.text}</span>}
                </div>
                {canEdit && <div className="board-resize" aria-hidden onPointerDown={(e) => startDrag(e, f, "size")} />}
              </PeerBox>
            );
          })}
          <svg className="board-links" width={size.w} height={size.h} aria-hidden>
            <defs><marker id="board-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker></defs>
            {links.map((l) => {
              const a = byId.get(l.from!), b = byId.get(l.to!);
              if (!a || !b) return null;
              const A = box(a), B = box(b);
              const s = edgePoint(A, B.x + B.w / 2, B.y + B.h / 2), t = edgePoint(B, A.x + A.w / 2, A.y + A.h / 2);
              return (
                <g key={l.id} className={sel === l.id ? "sel" : ""} data-id={l.id} onPointerDown={(e) => { e.stopPropagation(); if (!linkFrom) setSel(l.id); }}>
                  <line className="hit" x1={s.x} y1={s.y} x2={t.x} y2={t.y} />
                  <line className="ln" x1={s.x} y1={s.y} x2={t.x} y2={t.y} markerEnd="url(#board-arrow)" />
                </g>
              );
            })}
          </svg>
          {notes.map((n) => {
            const b = box(n);
            const el = n.ref ? elById.get(n.ref) : undefined;
            return (
              <PeerBox key={n.id} id={n.id} className={`board-note c-${n.color ?? "yellow"}${sel === n.id ? " sel" : ""}${linkFrom === n.id ? " from" : ""}`}
                style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
                onPointerDown={(e) => { if (editing !== n.id) { clickBox(n.id); startDrag(e, n, "move"); } }}
                onDoubleClick={() => { if (canEdit) { busy.current.add(n.id); setEditing(n.id); } }}>
                {editing === n.id
                  ? <textarea className="board-text" autoFocus defaultValue={n.text} maxLength={1000} aria-label="便利貼內容" onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => finishText(n, e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur(); }} />
                  : <div className="board-text">{n.text || <span className="faint">（空白，雙擊輸入）</span>}</div>}
                {n.ref && (
                  <button className="board-ref" onPointerDown={(e) => e.stopPropagation()} onClick={() => el && openRef(n.ref!)} disabled={!el} title={el ? `在模型頁開啟 ${el.label}` : "這個模型元素已不存在"}>
                    ↗ 連到 {el ? el.short : `${n.ref}（已不存在）`}
                  </button>
                )}
                <div className="board-by">{n.author}{n.at ? ` · ${when(n.at)}` : ""}{n.by && n.by !== n.author ? `（${n.by} 改過）` : ""}</div>
                {canEdit && <div className="board-resize" aria-hidden onPointerDown={(e) => startDrag(e, n, "size")} />}
              </PeerBox>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** 白板上的框或便利貼：別人選了它時用他的顏色描邊並掛小頭像（協作感知 F-38）。 */
function PeerBox({ id, className, style, children, ...rest }: { id: string; className: string; style: React.CSSProperties; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style" | "children">) {
  const peer = usePeerColor(id);
  return (
    <div {...rest} data-id={id} className={`${className}${peer ? " pz-on" : ""}`} style={peer ? { ...style, "--pz": peer } as React.CSSProperties : style}>
      <PeerMarks id={id} />
      {children}
    </div>
  );
}
