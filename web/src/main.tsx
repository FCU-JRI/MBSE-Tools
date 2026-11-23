import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// 共用樣式先載入，各頁自己的樣式接在後面
import "./style.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
