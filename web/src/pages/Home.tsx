// 首頁：專案總覽儀表。各區塊點了之後前往對應的頁面（p.go）。
import { Dashboard } from "../Dashboard.tsx";
import { Scroll } from "../layout.tsx";
import type { PageProps } from "../workspace.ts";
import "./home.css";

export function HomePage(p: PageProps) {
  return <Scroll className="enter"><Dashboard id={p.id} view={p.view} go={p.go} /></Scroll>;
}
