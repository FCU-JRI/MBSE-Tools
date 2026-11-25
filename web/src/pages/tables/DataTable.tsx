// 表格頁共用的資料表：統一的搜尋、快速篩選標籤、篩選、欄位顯示、匯出（Excel 整本／這張表 CSV）、列印，表頭可點排序。
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { PeerMarks, usePeerColor } from "../../presence.tsx";

export interface Col<R> {
  key: string; title: string;
  /** 純文字：搜尋、排序、CSV 都用它 */
  text: (r: R) => string;
  render?: (r: R) => ReactNode;
  /** 預設不顯示 */
  hidden?: boolean;
  cls?: string;
}
export interface Chip<R> { id: string; label: string; test: (r: R) => boolean }
export interface Filter<R> { id: string; label: string; options: [value: string, label: string][]; test: (r: R, value: string) => boolean }
export interface Book { id: string; ok: boolean }

interface Props<R> {
  name: string; title: string; hint?: string;
  rows: R[]; cols: Col<R>[]; rowId: (r: R) => string;
  selectedId?: string | null; onSelect?: (r: R) => void;
  chips?: Chip<R>[]; filters?: Filter<R>[];
  book: Book;
  empty?: ReactNode;
  /** 工具列之下、表格之上（FMEA 熱圖等） */
  above?: ReactNode;
  /** 外部再加一道列篩選（例如熱圖點格子） */
  preFilter?: (r: R) => boolean;
  rowClass?: (r: R) => string | undefined;
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

export function downloadCsv(name: string, head: string[], rows: string[][]): void {
  const body = [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${name}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DataTable<R>(p: Props<R>) {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState("");
  const [fv, setFv] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [panel, setPanel] = useState<"" | "filter" | "cols">("");
  const shown = (c: Col<R>) => (off[c.key] ?? !!c.hidden) ? false : true;
  const cols = p.cols.filter(shown);
  const base = useMemo(() => (p.preFilter ? p.rows.filter(p.preFilter) : p.rows), [p.rows, p.preFilter]);
  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const act = (p.filters ?? []).filter((f) => fv[f.id]);
    let out = base.filter((r) =>
      (!needle || p.cols.some((c) => c.text(r).toLowerCase().includes(needle))) &&
      (!chip || (p.chips ?? []).find((c) => c.id === chip)?.test(r) !== false) &&
      act.every((f) => f.test(r, fv[f.id])));
    if (sort) {
      const c = p.cols.find((x) => x.key === sort.key);
      if (c) out = [...out].sort((a, b) => sort.dir * c.text(a).localeCompare(c.text(b), "zh-Hant", { numeric: true }));
    }
    return out;
  }, [base, needle, chip, fv, sort, p.cols, p.chips, p.filters]);
  const nFilter = Object.values(fv).filter(Boolean).length;
  const hiddenCount = p.cols.filter((c) => !shown(c)).length;
  const toggleSort = (key: string) => setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  const exportCsv = () => downloadCsv(`${p.book.id}-${p.name}`, cols.map((c) => c.title), rows.map((r) => cols.map((c) => c.text(r))));

  return (
    <section className="section">
      <div className="section-head"><h1 className="section-title">{p.title}</h1><span className="label">{rows.length} / {p.rows.length}</span></div>
      {p.hint && <p className="body muted" style={{ marginBottom: 12 }}>{p.hint}</p>}
      <div className="tbar no-print" role="toolbar" aria-label={`${p.title}工具列`}>
        <input className="input tbar-search" type="search" placeholder="搜尋這張表" aria-label="搜尋" value={q} onChange={(e) => setQ(e.target.value)} />
        {(p.filters?.length ?? 0) > 0 && <button className="tbtn" aria-expanded={panel === "filter"} onClick={() => setPanel(panel === "filter" ? "" : "filter")}>篩選{nFilter ? `（${nFilter}）` : ""} ▾</button>}
        <button className="tbtn" aria-expanded={panel === "cols"} onClick={() => setPanel(panel === "cols" ? "" : "cols")}>欄位{hiddenCount ? `（隱藏 ${hiddenCount}）` : ""} ▾</button>
        <span className="grow" />
        <button className="tbtn" onClick={exportCsv} disabled={rows.length === 0}>匯出這張表 CSV</button>
        <a className={`tbtn ${p.book.ok ? "" : "disabled"}`} href={p.book.ok ? `/api/projects/${p.book.id}/export.xlsx` : undefined} title={p.book.ok ? "整份專案一個 Excel 檔，每類一個工作表" : "模型目前有錯誤，修正後才能匯出"}>匯出 Excel（整本）</a>
        <button className="tbtn" onClick={() => window.print()}>列印／PDF</button>
      </div>
      {panel === "filter" && (
        <div className="tpanel no-print">
          {(p.filters ?? []).map((f) => (
            <label className="field" key={f.id}><span className="label">{f.label}</span>
              <select className="input" value={fv[f.id] ?? ""} onChange={(e) => setFv({ ...fv, [f.id]: e.target.value })}><option value="">全部</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          ))}
          {nFilter > 0 && <button className="tbtn" onClick={() => setFv({})}>清除篩選</button>}
        </div>
      )}
      {panel === "cols" && (
        <div className="tpanel no-print">
          {p.cols.map((c) => <label className="check" key={c.key}><input type="checkbox" checked={shown(c)} onChange={(e) => setOff({ ...off, [c.key]: !e.target.checked })} /><span className="caption">{c.title}</span></label>)}
        </div>
      )}
      {(p.chips?.length ?? 0) > 0 && (
        <div className="tchips no-print" role="group" aria-label="快速篩選">
          {[{ id: "", label: "全部", test: () => true } as Chip<R>, ...(p.chips ?? [])].map((c) => (
            <button key={c.id} className="tchip" aria-pressed={chip === c.id} onClick={() => setChip(c.id)}>{c.label}<span className="tc">{base.filter((r) => c.test(r)).length}</span></button>
          ))}
        </div>
      )}
      {p.above}
      {p.rows.length === 0 ? <div className="body">{p.empty ?? "沒有資料。"}</div> : rows.length === 0 ? <p className="body">沒有符合搜尋或篩選條件的列。</p> : (
        <div className="tscroll">
          <table>
            <thead><tr>{cols.map((c) => (
              <th key={c.key} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                <button className="th-sort" onClick={() => toggleSort(c.key)} title="點一下排序">{c.title}<span aria-hidden="true">{sort?.key === c.key ? (sort.dir === 1 ? " ▴" : " ▾") : ""}</span></button>
              </th>))}</tr></thead>
            <tbody>{rows.map((r) => {
              const id = p.rowId(r);
              return (
                <PeerRow key={id} id={id} className={`rowbtn ${p.rowClass?.(r) ?? ""}`} selected={id === p.selectedId} onSelect={() => p.onSelect?.(r)}>
                  {cols.map((c, i) => <td key={c.key} className={c.cls}>{i === 0 && <PeerMarks id={id} size={16} />}{c.render ? c.render(r) : c.text(r)}</td>)}
                </PeerRow>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** 一列：別人選了這一列時，左邊加一條他的顏色並掛小頭像（協作感知 F-38）。 */
function PeerRow({ id, className, selected, onSelect, children }: { id: string; className: string; selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  const peer = usePeerColor(id);
  return (
    <tr className={`${className}${peer ? " pz-on" : ""}`} style={peer ? ({ "--pz": peer } as React.CSSProperties) : undefined} aria-selected={selected} onClick={onSelect} tabIndex={0} onKeyDown={(k) => { if (k.key === "Enter") onSelect(); }}>
      {children}
    </tr>
  );
}
