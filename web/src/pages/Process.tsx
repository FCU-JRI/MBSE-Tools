// 流程：上半是 16 步指南（要做什麼／怎麼做／還缺），下半是討論白板（3B）。
// 點步驟裡的項目會到模型頁並選取它；「到模型頁做這一步」會打開該類別的新增表單。
import { ProcessView } from "../Process.tsx";
import { Scroll } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import "./process.css";

export function ProcessPage(p: PageProps) {
  return (
    <Scroll>
      <ProcessView view={p.view} meta={p.meta} user={p.user} onChanged={p.setView}
        onOpen={(eid) => { p.setSel({ type: "element", id: eid }); p.go("model"); }}
        onNew={(category, parentId) => { p.setSel({ type: "new", category, parentId }); p.go("model"); }} />
      {/* 下半：討論白板（3B 在這裡加 <BoardSection {...p} />） */}
    </Scroll>
  );
}
