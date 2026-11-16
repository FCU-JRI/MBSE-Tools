# JRI MBSE 專案模型

這個儲存庫是一個 JRI 專案的系統模型，以 SysML v2 文字語法撰寫，由 JRI MBSE 網頁工具讀寫。

## 結構

- `model/*.sysml`：專案模型。根套件必須是 `Project`。
- `lib/JRI.sysml`：JRI 元模型庫（依 NASA-HDBK-1009A 與 AEAS-EXB-REG-1001）。不要修改；要改請到工具的儲存庫提出。
- `lib/shared-*.sysml`：跨專案的共用元件庫。不要在專案內修改。
- `project.json`、`pm.json`、`sim.json`、`layout.json`：節點與簽核、時程成本、模擬參數與結果、圖的版面。由工具維護，不要手動修改。

## 建模規則

- 元素以 `lib/JRI.sysml` 的定義為型別，工具依型別歸類。例如系統層需求寫成
  `requirement <'REQ-SYS-001'> '遠地點高度' : SystemRequirement { doc /* ... */ }`。
- 每個元素都要有編號（短名稱 `<'...'>`），前綴依類別：STK、EXP、NEED、GOAL、OBJ、MOE、REQ-SYS、REQ-SUB、REQ-CMP、MOP、UC、MODE、VER、VAL、RISK、FOS、SOP、ROS、ANM、QC。編號不可重複，也不要重編既有編號。
- 需求內容用繁體中文寫在 `doc` 裡，一條只寫一件事，用「應」字，必須能被驗證。能量化的條件另外寫成 `require constraint`，並帶單位。
- 追溯關係：
  - `#derivation connection { end #derive ::> 子; end #original ::> 母; }`　需求衍生（兩端都必須是需求類的項目）
  - `#refinement dependency from 量度 to 目的;`　細化
  - 期望是誰提的：寫在期望的主體內，`subject;` 之後接 `stakeholder :> 利害關係人;`
  - 誰參與使用案例：寫在使用案例的主體內，`subject;` 之後接 `actor :> 利害關係人;`；使用案例之間用 `include 另一個使用案例;`
  - `#trace dependency from 下層 to 上層;`　其他的一般追溯
  - `satisfy 需求 by 元件;`　滿足
  - 驗證寫在驗證事件內：`objective { verify 需求; }`，方法寫成 `@VerificationMethod { kind = VerificationMethodKind::test; }`（test、analyze、inspect、demo）
  - 衍生、細化、驗證方法用的是 SysML v2 標準庫的寫法。舊的 `#derive dependency`、`#refine dependency`、`@VVMethod` 工具會自動轉換，但請不要再寫
- 技術性能量度在屬性前加 `#tpm`。
- 中文名稱要用單引號包住。`analysis`、`test` 等是保留字，不能直接當名稱。

## 修改流程

1. 在自己的分支上修改，不要直接改 `main`。
2. 修改後確認模型能被解析且沒有錯誤（工具的「原始碼」分頁，或 OpenSysML 的 `sysml` 指令）。
3. 不要刪除或改寫你沒被要求處理的元素；只做局部修改，保留原有排版與註解。
4. 推送分支後，它會出現在工具的「版本」頁。工具會自動檢查模型能否解析，再由責任工程師或總工程師審查合併。
5. 模型有錯誤的分支不能合併；和 main 衝突時，先把 main 合併進自己的分支解決。
