# JRI MBSE Tools

噴射推進研究社（JRI）的系統工程網頁工具。模型以 SysML v2 文字語法儲存，框架依 NASA-HDBK-1009A，流程與簽核依 AEAS-EXB-REG-1001。需求規格見 [docs/SPEC.md](docs/SPEC.md)。

## 啟動

需要 Node.js 24 以上與 Git。

```bash
npm install
npm run build
npm start
```

開啟 http://127.0.0.1:8787 。開發時用 `npm run dev`（前端在 5173 埠，自動轉送 API）。

## 結構

- `server/`：後端（Express）。`engine.ts` 呼叫 OpenSysML 解析 SysML v2，`extract.ts` 把解析結果歸類，`gates.ts` 是各節點的檢查規則，`edits.ts` 把表單轉成 SysML 文字。
- `web/`：前端（React）。
- `library/JRI.sysml`：JRI 元模型庫。專案模型的元素以這裡的定義為型別。
- `templates/`：新專案的範本模型與給 Claude 的說明。
- `data/projects/<代號>/`：各專案的資料，每個專案是獨立的 git 儲存庫（不納入本儲存庫）。

## 進度

已完成：專案建立、SysML v2 解析與即時檢查、八個節點的完成度檢查、引導式新增／修改／刪除元素與關係、圖形檢視與編輯（BDD、IBD、需求圖、活動圖；拖拉版面、拉線建立關係）、需求追溯表、需求滿足的自動計算判定、原始碼編輯、簽核紀錄與基線標籤、Excel 匯出、每次儲存自動提交。介面依 Focus App Design System。

尚未完成：GitHub 登入與權限、外部唯讀連結、推送到 GitHub、使用案例圖與狀態機圖、圖形匯出 PNG／SVG、RocketPy／OpenRocket、時程／成本／人員、Tailscale 對外連線與開機自動啟動、自動化測試。
