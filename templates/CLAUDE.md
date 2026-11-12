# JRI MBSE 專案模型

這個儲存庫是一個 JRI 專案的系統模型，以 SysML v2 文字語法撰寫，由 JRI MBSE 網頁工具讀寫。

## 結構

- `model/*.sysml`：專案模型。根套件必須是 `Project`。
- `lib/JRI.sysml`：JRI 元模型庫（依 NASA-HDBK-1009A 與 AEAS-EXB-REG-1001）。不要修改；要改請到工具的儲存庫提出。
- `project.json`：節點設定與簽核紀錄。由工具維護，不要手動修改。

## 建模規則

- 元素以 `lib/JRI.sysml` 的定義為型別，工具依型別歸類。例如系統層需求寫成
  `requirement <'REQ-SYS-001'> '遠地點高度' : SystemRequirement { doc /* ... */ }`。
- 每個元素都要有編號（短名稱 `<'...'>`），前綴依類別：STK、EXP、NEED、GOAL、OBJ、MOE、REQ-SYS、REQ-SUB、REQ-CMP、MOP、VER、VAL、RISK、FOS、SOP、ROS、ANM、QC。編號不可重複，也不要重編既有編號。
- 需求內容用繁體中文寫在 `doc` 裡，一條只寫一件事，用「應」字，必須能被驗證。能量化的條件另外寫成 `require constraint`，並帶單位。
- 追溯關係：
  - `#derive dependency from 子 to 母;`　需求衍生
  - `#refine dependency from 量度 to 目的;`　細化
  - `#trace dependency from 期望 to 利害關係人;`　一般追溯
  - `satisfy 需求 by 元件;`　滿足
  - 驗證寫在驗證事件內：`objective { verify 需求; }`
- 技術性能量度在屬性前加 `#tpm`。
- 中文名稱要用單引號包住。`analysis`、`test` 等是保留字，不能直接當名稱。

## 修改流程

1. 在自己的分支上修改，不要直接改 `main`。
2. 修改後確認模型能被解析且沒有錯誤（工具的「原始碼」分頁，或 OpenSysML 的 `sysml` 指令）。
3. 不要刪除或改寫你沒被要求處理的元素；只做局部修改，保留原有排版與註解。
4. 由責任工程師或總工程師審查後合併。
