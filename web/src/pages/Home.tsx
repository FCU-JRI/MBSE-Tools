// 首頁：專案總覽儀表。各區塊點了之後前往對應的頁面。
import { Dashboard } from "../Dashboard.tsx";
import { Scroll } from "../layout.tsx";
import type { PageProps, TableGroup } from "../workspace.ts";
import "./home.css";

/** 儀表沿用舊的頁面代號；這裡換成新的 6 個分頁。 */
export function HomePage(p: PageProps) {
  const go = (m: string, arg?: string) => {
    if (m === "gates" || m === "plan") return p.go("manage", arg);
    if (m === "deliver") return p.go("tables", (arg ?? "req") as TableGroup);
    if (m === "sim") return p.go("analysis");
    if (m === "source") return p.go("model", "source");
    p.go(m as never, arg);
  };
  return <Scroll className="enter"><Dashboard view={p.view} go={go} /></Scroll>;
}
