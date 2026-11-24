// 流程：上半是照框架檔 7 層的流程（要做什麼／怎麼做／還缺），下半是討論白板（3B）。
// 點步驟裡的項目會到模型頁並選取它；「到模型頁新增」會打開該類別的新增表單。
import { FrameworkView } from "../Process.tsx";
import { Scroll } from "../layout.tsx";
import { BoardSection } from "./Board.tsx";
import type { PageProps } from "../workspace.ts";
import "./process.css";

export function ProcessPage(p: PageProps) {
  return (
    <Scroll>
      <FrameworkView view={p.view} meta={p.meta} user={p.user} go={(page) => p.go(page)}
        onOpen={(eid) => { p.setSel({ type: "element", id: eid }); p.go("model"); }}
        onNew={(category) => { p.setSel({ type: "new", category, parentId: null }); p.go("model"); }} />
      <BoardSection {...p} />
    </Scroll>
  );
}
