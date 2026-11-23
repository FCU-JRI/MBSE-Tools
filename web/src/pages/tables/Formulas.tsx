// 公式：模型裡的 constraint 與 calc，唯讀。點一列，右欄顯示所屬元素的屬性。
import { useEffect, useState } from "react";
import { api } from "../../api.ts";
import type { View } from "../../api.ts";
import { DataTable } from "./DataTable.tsx";
import type { Col } from "./DataTable.tsx";

interface Formula { id: string; kind: "constraint" | "calc"; def: boolean; name: string; owner: string; selectId: string | null; expr: string; inputs: string[]; status: string }

const KIND = (f: Formula) => `${f.kind}${f.def ? " def" : ""}`;
const RESULT = (f: Formula) => (f.status === "holds" ? "PASS" : f.status === "fails" ? "FAIL" : f.status === "definition" ? "定義" : "未判定");

export function Formulas({ view, selectedId, onSelect }: { view: View; selectedId: string | null; onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<Formula[] | null>(null);
  const [error, setError] = useState("");
  const ref = view.project.id;
  useEffect(() => {
    let live = true;
    setError("");
    api<{ formulas: Formula[] }>(`/projects/${ref}/formulas`).then((r) => live && setRows(r.formulas)).catch((e) => live && setError((e as Error).message));
    return () => { live = false; };
  }, [ref, view.analysis]);
  const owner = (f: Formula) => view.analysis.elements.find((e) => e.id === f.selectId);
  const cols: Col<Formula>[] = [
    { key: "kind", title: "種類", text: KIND, cls: "id" },
    { key: "name", title: "名稱", text: (f) => f.name || owner(f)?.name || "（未命名）", render: (f) => <>{f.name || owner(f)?.name || <span className="faint">（未命名）</span>}{!f.name && owner(f) && <div className="caption">寫在需求內</div>}</> },
    { key: "owner", title: "所屬", text: (f) => f.owner.replace(/^Project::/, ""), cls: "id" },
    { key: "expr", title: "算式", text: (f) => f.expr, render: (f) => <code className="expr">{f.expr}</code> },
    { key: "inputs", title: "輸入", text: (f) => f.inputs.join("、"), render: (f) => (f.inputs.length ? f.inputs.map((i) => <div key={i} className="id">{i}</div>) : <span className="faint">—</span>) },
    { key: "result", title: "結果／判定", text: RESULT, render: (f) => (f.status === "holds" ? <span className="tag done">PASS</span> : f.status === "fails" ? <span className="tag danger">FAIL</span> : <span className="faint">{RESULT(f)}</span>) },
  ];
  if (error) return <p className="msg"><span className="tag danger">ERR</span>{error}</p>;
  if (!rows) return <p className="body">讀取中…</p>;
  return (
    <DataTable name="公式" title="公式" book={{ id: ref, ok: view.analysis.ok }} rows={rows} cols={cols} rowId={(f) => f.id} selectedId={selectedId}
      onSelect={(f) => f.selectId && onSelect(f.selectId)} rowClass={(f) => (f.selectId ? undefined : "static")}
      hint="模型裡的 constraint 與 calc，唯讀。需求裡的 require constraint 由模擬引擎代入設計值判定；定義（def）只有算式，不判定。要修改請到「模型」頁開原始碼。"
      chips={[{ id: "constraint", label: "constraint", test: (f) => f.kind === "constraint" }, { id: "calc", label: "calc", test: (f) => f.kind === "calc" }, { id: "fail", label: "FAIL", test: (f) => f.status === "fails" }]}
      empty="模型裡還沒有 constraint 或 calc。在需求裡加 require constraint 後會列在這裡。" />
  );
}
