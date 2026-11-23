// 版本：由右上的版本按鈕開啟（原「版本」分頁）。
import { VersionsView } from "../Versions.tsx";
import { Scroll } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import "./versions.css";

export function VersionsPage(p: PageProps) {
  return (
    <Scroll>
      <VersionsView id={p.id} user={p.user} branch={p.view.branch ?? null} onOpen={p.onOpenRef} onChanged={p.setView} />
    </Scroll>
  );
}
