// 流程：16 步指南。點步驟裡的項目會到模型頁並選取它。
import { ProcessView } from "../Process.tsx";
import { Scroll } from "../layout.tsx";
import { BoardSection } from "./Board.tsx";
import type { PageProps } from "../workspace.ts";
import "./process.css";

export function ProcessPage(p: PageProps) {
  return (
    <Scroll>
      <ProcessView view={p.view} meta={p.meta} user={p.user} onChanged={p.setView} onOpen={(eid) => { p.setSel({ type: "element", id: eid }); p.go("model"); }} />
      <BoardSection {...p} />
    </Scroll>
  );
}
