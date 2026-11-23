// 各頁共用的版面：左欄、中間、右欄三欄，側欄可拖曳寬度與收合。
import { useState } from "react";
import type { ReactNode } from "react";
import { Inspector } from "./Inspector.tsx";
import type { PageProps } from "./workspace.ts";

interface Panes { left: number; right: number; leftOpen: boolean; rightOpen: boolean }
const DEFAULT_PANES: Panes = { left: 272, right: 320, leftOpen: true, rightOpen: true };
// 側邊欄寬度是每個人自己的偏好，存在瀏覽器；讀不到就用預設值
function loadPanes(): Panes {
  try { return { ...DEFAULT_PANES, ...JSON.parse(localStorage.getItem("jri.panes") ?? "{}") }; } catch { return DEFAULT_PANES; }
}
function savePanes(p: Panes): void { try { localStorage.setItem("jri.panes", JSON.stringify(p)); } catch { /* 無法儲存時只在本次有效 */ } }

/** 三欄版面。left、right 沒給就不顯示那一欄。 */
export function Columns({ left, right, children }: { left?: ReactNode; right?: ReactNode; children: ReactNode }) {
  const [panes, setPanes] = useState(loadPanes);
  const setPane = (p: Partial<Panes>) => setPanes((cur) => { const next = { ...cur, ...p }; savePanes(next); return next; });
  return (
    <div className="work">
      {left && <aside className="side left" style={{ width: panes.leftOpen ? panes.left : 0 }} hidden={!panes.leftOpen}>{left}</aside>}
      {left && <Resizer side="left" open={panes.leftOpen} width={panes.left} onWidth={(w) => setPane({ left: w })} onToggle={() => setPane({ leftOpen: !panes.leftOpen })} />}
      <section className="center">{children}</section>
      {right && <Resizer side="right" open={panes.rightOpen} width={panes.right} onWidth={(w) => setPane({ right: w })} onToggle={() => setPane({ rightOpen: !panes.rightOpen })} />}
      {right && <aside className="side right" style={{ width: panes.rightOpen ? panes.right : 0 }} hidden={!panes.rightOpen}>{right}</aside>}
    </div>
  );
}

/** 只有中間一欄、可往下捲的頁面。 */
export function Scroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <Columns><div className={`center-scroll ${className}`}>{children}</div></Columns>;
}

/** 右欄：選了東西才顯示。toModel 給了就在上方多一顆「在模型中開啟」。 */
export function SelectionPane(p: PageProps & { toModel?: boolean }) {
  if (!p.sel) return null;
  const sel = p.sel;
  return (
    <>
      <div className="tbtn-row pane-head">
        {p.toModel && sel.type === "element" && <button className="tbtn" onClick={() => p.go("model")}>在模型中開啟 →</button>}
        <span className="grow" />
        <button className="tbtn" onClick={() => p.setSel(null)} aria-label="關閉右側欄" title="關閉">✕</button>
      </div>
      <Inspector readOnly={p.readOnly} view={p.view} meta={p.meta} sel={sel} setSel={p.setSel} onChanged={p.setView} />
    </>
  );
}

/** 側邊欄與中間區域之間的分隔條：拖曳調整寬度，按鈕收合或展開；也可用方向鍵調整。 */
export function Resizer({ side, open, width, onWidth, onToggle }: { side: "left" | "right"; open: boolean; width: number; onWidth: (w: number) => void; onToggle: () => void }) {
  const clamp = (w: number) => Math.min(640, Math.max(180, Math.round(w)));
  const start = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!open || (ev.target as HTMLElement).closest("button")) return;
    ev.preventDefault();
    const x0 = ev.clientX, w0 = width;
    const el = ev.currentTarget;
    el.setPointerCapture(ev.pointerId);
    const move = (e: PointerEvent) => onWidth(clamp(w0 + (side === "left" ? e.clientX - x0 : x0 - e.clientX)));
    const stop = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", stop); el.removeEventListener("pointercancel", stop); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", stop); el.addEventListener("pointercancel", stop);
  };
  const key = (e: React.KeyboardEvent) => {
    if (!open) return;
    const d = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (d) { e.preventDefault(); onWidth(clamp(width + (side === "left" ? d : -d))); }
  };
  const zh = side === "left" ? "左側欄" : "右側欄";
  const arrow = (side === "left") === open ? "‹" : "›";
  return (
    <div className={`resizer ${side} ${open ? "" : "closed"}`} role="separator" aria-orientation="vertical" aria-label={`調整${zh}寬度`} aria-valuenow={open ? width : 0} aria-valuemin={180} aria-valuemax={640} tabIndex={0} onPointerDown={start} onKeyDown={key}>
      <button className="resizer-toggle" onClick={onToggle} aria-label={open ? `收合${zh}` : `展開${zh}`} title={open ? `收合${zh}` : `展開${zh}`}>{arrow}</button>
    </div>
  );
}
