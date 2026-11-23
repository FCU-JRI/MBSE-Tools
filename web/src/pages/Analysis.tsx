// 分析：原「模擬」頁（外形、推力曲線、飛行模擬、寫回模型、.ork）。
import { SimView } from "../Sim.tsx";
import { Scroll } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import "./analysis.css";

export function AnalysisPage(p: PageProps) {
  return <Scroll><SimView view={p.view} user={p.user} onChanged={p.setView} /></Scroll>;
}
