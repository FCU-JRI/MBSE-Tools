// 專案工作區的共用型別：上方 6 個分頁、各頁之間的跳轉，以及各頁都拿得到的專案狀態。
import type { Me, Meta, View } from "./api.ts";
import type { Selection } from "./Inspector.tsx";

/** 上方分頁；versions 不是分頁，由右上的版本按鈕開啟。 */
export type Page = "home" | "process" | "model" | "tables" | "analysis" | "manage" | "versions";
export const PAGES: [Page, string][] = [["home", "首頁"], ["process", "流程"], ["model", "模型"], ["tables", "表格"], ["analysis", "分析"], ["manage", "專案管理"]];

/** 表格頁左欄選的是哪一張表。cat:類別代號 是模型元素清單裡的某個類別。 */
export type TableGroup = "req" | "verify" | "fmea" | "params" | "formula" | "docs" | "conflicts" | "trade" | "n2" | "decisions" | "tpm" | "variants" | "elements" | `cat:${string}`;

/** 切換分頁時要留住的位置：看到哪張圖、哪張表、哪個節點、原始碼抽屜開著沒。 */
export interface Spot { diagramId: string; table: TableGroup; gateId: string | null; source: boolean }

/** 各頁的參數。sel 為 null 時右欄不顯示。 */
export interface PageProps {
  id: string; view: View; meta: Meta; user: Me; readOnly: boolean;
  setView: (v: View) => void; reload: () => void; onNotice: (msg: string) => void;
  sel: Selection | null; setSel: (s: Selection | null) => void;
  spot: Spot; setSpot: (s: Partial<Spot>) => void;
  /** 前往某一頁；arg 依頁而定：manage 為節點代號、tables 為表、model 為 "source"（打開原始碼抽屜）。 */
  go: (page: Page, arg?: string) => void;
  onOpenRef: (ref: string) => void;
}
