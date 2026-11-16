// METHOD.md 實作：各期新增的頁面登記在這裡，App.tsx 自動加上分頁（docs/IMPL-PLAN.md）。各期只改自己的區塊。
import type { ComponentType } from "react";
import type { Me, Meta, View } from "../api.ts";
// [P7 火箭外形與模擬圖]
import { RocketPage } from "./P7Rocket.tsx";
// [/P7]

export interface MethodPageProps {
  view: View;
  meta: Meta;
  user: Me;
  onChanged: (v: View) => void;
  /** 開啟某個元素（切到表並選取它） */
  onOpen: (elementId: string) => void;
}

export interface MethodPage {
  /** 唯一的代號，例如 "fmea" */
  id: string;
  /** 分頁上的中文名稱 */
  zh: string;
  Component: ComponentType<MethodPageProps>;
}

export const METHOD_PAGES: MethodPage[] = [
  // [P1 需求屬性與需求矩陣]
  // [/P1]
  // [P2 分析圖骨架與中文化]
  // [/P2]
  // [P3 任務剖面、功能分配、MOE／MOP／TPM]
  // [/P3]
  // [P4 介面與 N² 矩陣]
  // [/P4]
  // [P5 FMEA、風險與圖表]
  // [/P5]
  // [P6 方案比較與模型內公式]
  // [/P6]
  // [P7 火箭外形與模擬圖]
  { id: "rocket", zh: "火箭外形", Component: RocketPage },
  // [/P7]
];
