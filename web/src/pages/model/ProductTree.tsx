// 模型頁左欄（C＋D）：最上方搜尋，下面是依產品架構長成的樹。
// 第 1、2 層各一列；第 3 層每個系統可收合（可以有多個系統）；第 4 層次系統一律列出；次系統底下的第 5 層元件可收合。
// 打開某一層時，它的上層自動展開。收合狀態是每個人的偏好，存在瀏覽器。
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { Model } from "./views.ts";
import { viewKeyOfPart } from "./views.ts";

interface Props { M: Model; current: string; onView: (k: string) => void; onElement: (id: string) => void }

const KEY = "jri.modelTree";
const load = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; } };
const save = (o: Record<string, boolean>) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* 只在本次有效 */ } };

export function ProductTree({ M, current, onView, onElement }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>(load);
  const [q, setQ] = useState("");
  // 打開某層時，把它的上層都展開
  useEffect(() => {
    const v = M.V.get(current.startsWith("e:") ? M.where(current.slice(2)) ?? "" : current);
    if (!v?.owner) return;
    const add: Record<string, boolean> = {};
    for (let p = M.U.get(v.owner)?.parent; p; p = M.U.get(p)?.parent ?? null) if (open[p] !== true) add[p] = true;
    if (Object.keys(add).length) setOpen((o) => { const n = { ...o, ...add }; save(n); return n; });
  }, [current, M]); // eslint-disable-line react-hooks/exhaustive-deps
  const isOpen = (id: string, dflt: boolean) => open[id] ?? dflt;
  const toggle = (id: string, dflt: boolean) => setOpen((o) => { const n = { ...o, [id]: !(o[id] ?? dflt) }; save(n); return n; });

  const link = (k: string, label: string, cls = "") => (
    <button type="button" className={`pt-link ${cls}`} aria-current={current === k ? "page" : undefined} onClick={() => onView(k)}>{label}</button>
  );
  const row = (inner: ReactElement, t?: ReactElement | null) => <div className="pt-row">{t ?? <span className="pt-sp" />}{inner}</div>;

  const hits = q.trim() ? M.list.filter((u) => u.kind !== "trade" && `${u.sn} ${u.name}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 40) : [];
  return (
    <div className="pt">
      <div className="section">
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋名稱或編號" aria-label="搜尋模型元素" />
      </div>
      {q.trim()
        ? <div className="section" aria-label="搜尋結果">
            <div className="section-head"><h2 className="section-title">搜尋結果</h2><span className="label">{hits.length}</span></div>
            {hits.length === 0 && <p className="caption">沒有符合的元素。</p>}
            {hits.map((u) => <button key={u.id} type="button" className="pt-link pt-hit" onClick={() => onElement(u.id)}><span className="label">{u.sn}</span> {u.name}</button>)}
          </div>
        : <nav className="pt-tree" aria-label="依產品架構的圖">
            <h3 className="pt-h">圖（依產品架構）</h3>
            {row(link("map", "模型地圖", "pt-map"))}
            <div className="pt-lv">第 1 層</div>{row(link("L1", "任務定義"))}
            <div className="pt-lv">第 2 層</div>{row(link("L2", "任務剖面"))}
            <div className="pt-lv">第 3 層　系統</div>
            {M.systems.length === 0 && <p className="caption pt-empty">還沒有系統。到模型地圖或右欄新增「系統」。</p>}
            {M.systems.map((s) => {
              const so = isOpen(s.id, true);
              return (
                <div key={s.id}>
                  {row(link(viewKeyOfPart(s.id), s.name), <button type="button" className="pt-tg" aria-expanded={so} aria-label={`${so ? "收合" : "展開"}${s.name}`} onClick={() => toggle(s.id, true)}>{so ? "▾" : "▸"}</button>)}
                  {so && <div className="pt-child">
                    <div className="pt-lv">第 4 層　次系統</div>
                    {M.drillKids(s.id).map((sub) => {
                      const comps = M.drillKids(sub.id), co = isOpen(sub.id, false);
                      return <div key={sub.id}>
                        {row(link(viewKeyOfPart(sub.id), sub.name), comps.length ? <button type="button" className="pt-tg" aria-expanded={co} aria-label={`${co ? "收合" : "展開"}${sub.name}的元件`} onClick={() => toggle(sub.id, false)}>{co ? "▾" : "▸"}</button> : null)}
                        {co && comps.length > 0 && <div className="pt-child"><div className="pt-lv">第 5 層　元件</div>{comps.map((c) => <div key={c.id}>{row(link(viewKeyOfPart(c.id), c.name))}</div>)}</div>}
                      </div>;
                    })}
                  </div>}
                </div>
              );
            })}
          </nav>}
    </div>
  );
}
