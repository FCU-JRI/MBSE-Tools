---
name: jri-mbse
description: JRI 的系統工程作業程序。在這個儲存庫裡建立或修改系統模型（需求、設計方案、介面、預算、驗證、風險）時使用；依框架檔 framework/jri.json 的 7 層與設計迴圈進行，卡點只警告，pass/fail 只由 constraint 與模擬決定。
---

# JRI MBSE 作業程序（AI 版）

這個儲存庫是以標準 SysML v2 撰寫的系統模型。協助使用者時，依下面的流程與規則進行。流程本身寫在 `framework/jri.json`（框架檔，工具讀它執行）；本文件是它的作業摘要，兩者不一致時以框架檔為準。

## 原則

1. **從利害關係人開始，一層一層往下。** 先有任務定義，再有任務剖面、系統、次系統、細部設計。
2. **需求與設計交替。** 每一層＝需求進來 → 設計迴圈 → 設計限制 → 推導下一層需求。**下一層需求不得直接從上一層需求拆出。**
3. **卡點只警告，不擋。** 該層設計迴圈還沒走到「是否符合需求＝是」就要往下一層寫時，照樣可以寫，但要先告訴使用者「這一層還沒收斂：缺什麼」，並在回覆與 PR 說明裡留下這個警告。不要自己判定可以略過。
4. **下一層需求有兩個來源：** 上一層需求（`#derivation`）＋上一層設計迴圈的產出（介面、邊界、方案選定、預算配額，用 `#basis` 連到它）。少一個來源就是不完整，要指出來。
5. **互卡交總工程師。** 介面、共用預算、整體性能、環境影響、時序牽連到別的次系統時，同層可以各自先做，但牽連的部分不要自己裁決：兩端數字或預算加總不合時，工具會從 constraint 算出「衝突」，交總工程師裁決，結果留成決策紀錄（DesignDecision）。你只提出衝突與建議，不替他決定。
6. **pass／fail 只由 constraint 與模擬決定。** 你對「符合不符合」的看法只能當意見，寫在送審說明或留言裡並標明「參考」，不能寫進驗證結果，也不能當成通過的依據。
7. **每一項都要說得出來源，一次只問一個問題，不知道就問。** 不要編造利害關係人、數值或需求；數值、單位、規範條文不確定時請使用者提供文件。
8. **只用標準 SysML v2。** 自訂資訊只用標準 metadata（`#layer`、`#cad`、`#basis`、`#interfaceStatus`）。每個次系統的模型放在自己的檔案。

## 7 層與設計迴圈

| # | 層 | 對象 | 說明 |
|---|---|---|---|
| 1 | 任務定義 | 任務 | 來源文件、利害關係人與期望、使用情境、需要、目標與目的、成功判準（MOE 三級） |
| 2 | 任務剖面 | 任務 | 階段與模式；產出任務剖面圖與功能清單。有設計迴圈 |
| 3 | 系統層級 | 系統 | 功能分配到系統、系統需求與 MOP；有設計迴圈；結束接 MDR |
| 4 | 次系統層級 | 次系統 | 分配到次系統、次系統需求（兩個來源）；有設計迴圈；結束接 PDR |
| 5 | 細部設計 | 元件 | 元件需求、製造設計與規劃；有設計迴圈；介面凍結；結束接 CDR |
| 6 | 製造、整合與測試 | 次系統 | 採購與加工、QC、組裝整合、驗證規劃 |
| 7 | 發射與收束 | 任務 | 發射前準備、FRR、任務執行與回收、對照 MOE |

**設計迴圈**（第 2～5 層，每個設計對象各走一次）：

1. 設計提案（DesignAlternative，標出要滿足哪些需求）
2. 方案分析（TradeStudy，至少 2 個候選；準則連回需求；有選定與否決理由，記為 DesignDecision。標準寫法用 `variation`／`variant`）
3. 本層 FMEA（Risk）
4. 是否被解決？本層沒有 S×O ≥ 專案門檻且未緩解的風險才算「是」；「否」回到方案分析
5. CAD 建模（只放連結與版本，`#cad`）
6. 計算與模擬（`calc`／`constraint`；RocketPy 由工具執行）
7. 是否符合需求？constraint 與模擬全部 PASS，且組長核准才算「是」；「否」回到方案分析
8. 產出設計限制（介面、預算配額、方案選定）→ 才推導下一層需求

各步由誰負責、各專案的門檻與預算餘裕，讀專案設定與框架檔，不要自己假設。

## 工作方式

1. 先讀 `model/*.sysml`、`framework/jri.json`（若專案帶有）、`reviews/` 內的送審紀錄與 `board.json` 討論白板，判斷目前在哪一層、設計迴圈走到哪一步。
2. 告訴使用者現在在哪、還缺什麼、有哪些卡點警告。
3. 一次問一個問題；把回答整理成項目，列給使用者確認後才寫入，並建立連到上一層需求與上一層設計產出的關係。
4. 寫完檢查該步的完成條件；沒完成就說明缺什麼，不要宣稱完成。

## 寫法

- 型別用 `lib/JRI.sysml` 的定義。根套件是 `Project`，各類別放在對應的子套件。
- 每個項目都要有編號 `<'前綴-流水號'>`：STK、EXP、NEED、GOAL、OBJ、MOE、SYS、SUB、CMP、EXT、UC、PH、FN、REQ-SYS、REQ-SUB、REQ-CMP、MOP、RISK、VER、VAL。不重複，也不重編既有編號。
- 內容用繁體中文寫在 `doc /* ... */`。需求用「應」字，一條只寫一件事，必須能被驗證。
- 中文名稱用單引號包住。

```sysml
part <'STK-001'> '競賽主辦方' : Stakeholder { :>> role = "規則與評分"; }

requirement <'EXP-001'> '安全發射與回收' : Expectation {
    doc /* 火箭的發射與回收全程不得危及人員與場地。 */
    subject;
    stakeholder :> '競賽主辦方';
}

requirement <'REQ-SYS-001'> '遠地點高度' : SystemRequirement {
    doc /* 火箭應到達 3000 m ± 150 m 的遠地點高度。 */
    @Source { sourceDoc = "DOC-001"; sourceRef = "3.2"; }
}
#derivation connection { end #derive ::> '遠地點高度'; end #original ::> NGOs::'遠地點達 3000 m'; }
```

關係的寫法：

| 關係 | 寫法 |
|---|---|
| 誰的期望 | 在期望的主體內 `subject;` 之後寫 `stakeholder :> 利害關係人;`（`subject;` 一定要在前面，只寫一次） |
| 誰參與使用案例 | 在使用案例的主體內 `subject;` 之後寫 `actor :> 利害關係人;` |
| 使用案例包含 | 在使用案例的主體內 `include 另一個使用案例;` |
| 其他追溯 | `#trace dependency from 下層 to 上層;` |
| 衍生 | `#derivation connection { end #derive ::> 下層; end #original ::> 上層; }` |
| 細化 | `#refinement dependency from 量度 to 目的;` |
| 滿足 | `satisfy 需求 by 元件;`，或寫在定義的主體內 `satisfy 需求;` |
| 分配 | `allocate 功能 to 次系統;` |
| 驗證 | 在驗證事件內 `objective { verify 需求; }`，並加 `@VerificationMethod { kind = VerificationMethodKind::test; }`（值是 test、analyze、inspect、demo） |
| 出處 | 在項目主體內 `@Source { sourceDoc = "DOC-001"; sourceRef = "章節"; }`，文件清單在 `pm.json` 的 `docs` |

### 說明性欄位（為什麼、判定條件、否決原因等）

每個項目都要寫「為什麼這樣定」和「用什麼條件判定通過」。沒寫只會出現提醒，不擋卡點，但模型頁的說明頁、表格和審查報告都會顯示這兩欄。

| 欄位 | 寫法 | 掛在 |
|---|---|---|
| 為什麼／判定條件 | `@DesignRationale { why = "…"; judge = "…"; }` | 任何項目 |
| 否決原因 | `@Rejection { rejectWhy = "…"; }` | 被否決的候選（`variant part`）；選定的不寫 |
| 評分標準 | `@CriterionScale { scale1 = "…"; scale3 = "…"; scale5 = "…"; }` | 當準則的需求 |
| 權重敏感度 | `@TradeSensitivity { sensitivity = "…"; }` | 設計方案（`variation part def`） |
| 調整後分數 | `attribute adjusted_<需求編號> : TradeScore = 5.0;`（和 `score_<需求編號>` 並列） | 候選 |
| 回頭修正 | `:>> fixNote = "…";`，再寫 `#fix dependency from 風險 to 被修正的元素;` | 風險（Risk） |
| 放行／喊卡 | `:>> releaseStatus = "ok";` 或 `"hold"`，喊卡時加 `:>> holdReason = "…";` | 設計決策（DesignDecision） |
| TPM 各節點的值 | 在 `#tpm` 屬性主體內 `@TpmTrend { atProposal = 7.9; atMDR = 7.6; atPDR = 7.2; }`，欄位是 atProposal、atMDR、atPDR、atCDR、atTRR、atFRR | `#tpm` 屬性 |

- 不要用 `@Rationale`（會和標準庫撞名），也沒有 `atSRR`、`atSDR`。
- 喊卡只是警告：下一層照常可以寫，但會顯示警告，不擋迴圈與卡點。
- 方案要用 `#trace` 連到它要滿足的本層需求；決策用 `#trace` 連到選定的候選。

```sysml
item <'DEC-001'> '動力決策' : DesignDecision {
    :>> decidedBy = "總工程師"; :>> decidedOn = "2027-02-10";
    :>> releaseStatus = "hold"; :>> holdReason = "待實秤，首批樣品 ≤ 1.9 kg 才放行";
    @DesignRationale { why = "比較表最高分且領先 5 分"; judge = "比較結論成立、無開啟中的高風險"; }
}
```

### 模型頁的圖

模型頁的圖從模型自動產生，固定區帶、不可拖拉，不需要也不能另外存版面。元素歸到哪一層看關係：需求看 `satisfy` 的滿足者，方案、風險、決策看它們連到的需求或零件，所以新增項目後要記得建立這些關係，否則它不會出現在層級圖上。

## 送審與審查

1. 在自己的分支上修改，不要直接改 `main`。只做局部修改，保留原有排版與註解；不要刪改沒被要求處理的項目。
2. 送審在工具的「版本」頁完成，不開 GitHub PR。送審時伺服器自動預跑 constraint 判定、衝突、框架檢查、質量預算（有 RocketPy 環境才跑模擬），結果附在 `reviews/<分支>.json`。
3. 送審說明寫：改了什麼、為什麼、哪些卡點警告還在、哪些衝突等總工程師裁決。你的 pass/fail 看法標「參考」。
4. 審查留言（核准、退回、意見）也存在同一份 `reviews/<分支>.json`，之後可以讀來了解為什麼這樣改。被退回就依留言修改再送審。
5. 核准與合併由專案設定的次系統負責人或總工程師以上在工具內操作；沒設定時是責任工程師以上。你不合併、不核准。模型無法解析的分支不能合併。

## 公開提醒

這個儲存庫（含這份文件、`model/`、`reviews/` 的送審說明與留言）可能公開。不要寫入不能公開的資料；需要引用文件時只寫文件編號。無法判斷能不能公開時，停下來問使用者。
