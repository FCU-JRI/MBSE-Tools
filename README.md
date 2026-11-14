# JRI MBSE Tools

噴射推進研究社（JRI）的系統工程網頁工具。模型以 SysML v2 文字語法儲存，框架依 NASA-HDBK-1009A，流程與簽核依 AEAS-EXB-REG-1001。需求規格見 [docs/SPEC.md](docs/SPEC.md)。

## 功能

- **建模**：引導式新增／修改／刪除（附白話解說），或直接編輯完整 SysML v2 原始碼；有錯誤不會儲存。
- **圖**：結構分解（BDD）、內部連接（IBD）、需求追溯、使用案例、活動、狀態機。由模型自動產生，可拖拉版面、拉線建立關係，可匯出 PNG／SVG。
- **節點**：計畫提案、MDR、PDR、CDR、TRR、FRR、異常審查、計畫收束。每個節點列出要完成的事並自動檢查。
- **簽核**：簽核人與職級取自登入身分，權限依 AEAS Table 3；核可時打基線標籤。
- **追溯與判定**：需求的來源、滿足者、驗證事件一覽；數值條件帶單位自動判定。
- **模擬**：RocketPy 飛行模擬，結果可寫回模型屬性讓需求重新判定；OpenRocket `.ork` 幾何匯入與匯出。
- **時程**：甘特圖（AEAS 欄位，優先級 P0–P5 依職級限制）、成本、人員。
- **版本**：每次儲存自動提交並推送 GitHub；分支審查與合併；基線比較。
- **匯出**：Excel 表格、審查報告（可列印成 PDF 的網頁版與 Word）。
- **共用元件庫**：跨專案共用的元件（以航電為主）。

## 存取

| 來源 | 連接埠 | 身分 |
|---|---|---|
| 這台電腦本機 | 8787 | 管理員 |
| Tailscale 私人網路（`tailscale serve`） | 8787 | 設定檔中的 Tailscale 帳號為管理員；其餘依成員名單 |
| 公開網址（`tailscale funnel`） | 8788 | 必須用 GitHub 登入（需在成員名單內），或持有唯讀連結 |

公開埠不信任任何代理標頭。成員名單、唯讀連結、GitHub 登入設定都在「管理」頁。

## 開發

需要 Node.js 24 以上與 Git。模擬另需 Python 3.12。

```bash
npm install
npm run dev
```

```bash
npm test
```

模擬測試需要 `JRI_PYTHON` 指向裝有 RocketPy 的 Python，否則略過。

## 部署（Windows）

程式放在固定資料夾（例如 `D:\JRI MBSE Server`），資料放在 `JRI_HOME`（預設 `D:\JRI MBSE Data`）。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-python.ps1
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
```

`install-service.ps1` 註冊登入時自動啟動的排程工作，伺服器結束會自動重啟。更新版本用 `scripts\deploy.ps1`。紀錄在 `JRI_HOME\logs`。

## 結構

- `server/`：後端。`engine.ts` 呼叫 OpenSysML 解析，`extract.ts` 歸類元素，`gates.ts` 節點檢查，`edits.ts` 把操作轉成 SysML 文字，`auth.ts` 身分與權限，`versions.ts` 分支與基線，`pm.ts` 專案管理，`sim.ts` 模擬，`report.ts` 報告。
- `web/`：前端（React），介面依 Focus App Design System。
- `library/JRI.sysml`：JRI 元模型庫。
- `sim/run_sim.py`：RocketPy 模擬腳本。
- `templates/`：新專案的範本模型與給 Claude 的說明。

## 已知限制

- GitHub 登入需要管理員先建立 OAuth App 並在「管理」頁填入。
- 專案的 GitHub 儲存庫：在「管理 → 專案儲存庫」開啟自動建立後，新增專案時會用 GitHub CLI 建立 `擁有者/專案代號` 並設為推送目標。執行網站的帳號要先 `gh auth login`（登入該擁有者）並 `gh auth setup-git`；未開啟時要先手動建立，再到「版本」頁填網址。
- Word 報告不含圖；含圖請用網頁版列印成 PDF。
- `.ork` 匯入只讀幾何（鼻錐、箭體、梯形尾翼、降落傘），質量與引擎需手動填。匯出的 `.ork` 尚未在 OpenRocket 實際開啟驗證。
- 模擬為標準大氣、無風。
- 相依套件 `glob`／`minimatch` 有中度警告，來自解析器選用的下載驗證元件，沒有修正版；它們不處理使用者輸入。
- 排程工作在使用者登入後才啟動；電腦重開機後需登入 Windows。
