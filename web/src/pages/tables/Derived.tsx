// 由模型資料即時算出的表：驗證矩陣（需求 × 驗證事件）、設計參數表（零件 × 屬性值）。
import type { Element } from "../../api.ts";
import { label, listOf } from "../../model.ts";
import { methodZh } from "../../Inspector.tsx";
import type { Props } from "../../Deliverables.tsx";
import { DataTable } from "./DataTable.tsx";
import type { Col } from "./DataTable.tsx";

const REQ = ["SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP"];

export function VerifyMatrix({ view, selectedId, onSelect }: Props) {
  const a = view.analysis;
  const reqs = listOf(a.elements, ...REQ);
  const events = listOf(a.elements, "VerificationEvent", "ValidationEvent");
  const sat = new Map(a.satisfaction.map((s) => [s.requirement, s.status]));
  const verifies = (ev: Element, r: Element) => a.relations.some((x) => x.kind === "verify" && ((x.from === ev.id && x.to === r.id) || (x.from === r.id && x.to === ev.id)));
  const has = (r: Element) => events.some((ev) => verifies(ev, r));
  const verdict = (r: Element) => sat.get(r.qualifiedName);
  const cols: Col<Element>[] = [
    { key: "id", title: "需求", text: (r) => `${r.shortName ?? ""} ${r.name}`.trim(), render: (r) => <><span className="id">{r.shortName ?? "—"}</span><div className="caption">{r.name}</div></> },
    ...events.map((ev): Col<Element> => ({ key: ev.id, title: ev.shortName ?? ev.name, text: (r) => (verifies(ev, r) ? "●" : ""), render: (r) => (verifies(ev, r) ? <span title={`${label(ev)}${ev.attrs.kind ? `　${methodZh(ev.attrs.kind)}` : ""}`}>●</span> : <span className="faint">·</span>), cls: "mark" })),
    { key: "verdict", title: "判定", text: (r) => (verdict(r) === "holds" ? "PASS" : verdict(r) === "fails" ? "FAIL" : ""), render: (r) => (verdict(r) === "holds" ? <span className="tag done">PASS</span> : verdict(r) === "fails" ? <span className="tag danger">FAIL</span> : <span className="faint">—</span>) },
    { key: "gap", title: "缺口", text: (r) => (has(r) ? "" : "缺驗證"), render: (r) => (has(r) ? <span className="faint">—</span> : <span className="tag danger">缺驗證</span>) },
  ];
  return (
    <DataTable name="驗證矩陣" title="驗證矩陣" book={{ id: view.project.id, ok: a.ok }} rows={reqs} cols={cols} rowId={(r) => r.id} selectedId={selectedId} onSelect={(r) => onSelect(r.id)}
      hint="橫列是需求，直欄是驗證與確認事件，● 表示該事件驗證該需求；滑過圓點看事件名稱與方法。"
      chips={[{ id: "gap", label: "缺驗證", test: (r) => !has(r) }, { id: "ok", label: "已有驗證", test: has }, { id: "fail", label: "FAIL", test: (r) => verdict(r) === "fails" }]}
      empty="還沒有需求。" />
  );
}

interface ParamRow { id: string; owner: Element; name: string; value: string }
export function Params({ view, meta, selectedId, onSelect }: Props) {
  const rows: ParamRow[] = view.analysis.elements.filter((e) => ["System", "Subsystem", "Component"].includes(e.category ?? "") && e.kind === "PartUsage").flatMap((e) => {
    const zh = new Map((meta.categories.find((c) => c.id === e.category)?.fields ?? []).map((f) => [f.name, f.zh]));
    return Object.entries(e.attrs).filter(([, v]) => v !== "").map(([k, v]) => ({ id: `${e.id}.${k}`, owner: e, name: zh.get(k) ?? k, value: v }));
  });
  const cols: Col<ParamRow>[] = [
    { key: "owner", title: "零件", text: (r) => r.owner.name, cls: "id" },
    { key: "cat", title: "層級", text: (r) => meta.categories.find((c) => c.id === r.owner.category)?.zh ?? "" },
    { key: "name", title: "參數", text: (r) => r.name },
    { key: "value", title: "值", text: (r) => r.value, cls: "id" },
  ];
  return (
    <DataTable name="設計參數表" title="設計參數表" book={{ id: view.project.id, ok: view.analysis.ok }} rows={rows} cols={cols} rowId={(r) => r.id} selectedId={selectedId} onSelect={(r) => onSelect(r.owner.id)}
      hint="系統、次系統、元件的實例（part usage）上已填的屬性值（質量、遠地點等），值與單位照模型原樣。"
      empty="系統、次系統、元件上還沒有數值屬性。" />
  );
}
