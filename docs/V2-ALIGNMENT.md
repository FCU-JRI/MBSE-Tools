# SysML v2 標準對齊提案

狀態：提案。互通已確定是目標（見第 6 節的決定紀錄），時程與範圍待決定。本文件只列差異與建議，不含任何程式修改。

## 1. 結論

- 網站產生的模型是合法的 SysML v2 文字（解析器通過），圖的主要記法也和規範一致。
- 和標準對不上的地方有四類：(1) 用自訂標記取代標準庫已有的寫法；(2) 利害關係人與使用案例參與者沒有用語言內建的寫法；(3) 圖沒有存在模型裡；(4) 沒有規範要求的模型交換檔（`.kpar`）。
- 這些差異不影響網站自己的任何功能。只有在模型要交給別的 SysML v2 工具時才有影響：對方讀得懂語法，但不知道這些自訂標記代表衍生、細化或參與者，也看不到任何一張圖。
- 建議分四批處理（第 5 節），都排在 MDR 之後。互通已確定是目標，所以至少要做第一到三批；要宣稱是符合規範的工具，還要做第四批。

## 2. 依據與查證方式

- 規範：OMG Systems Modeling Language (SysML) Version 2.0, Part 1: Language Specification，文件編號 formal/2026-03-02。以下的章節編號都指這一份。
- 圖形記法（8.2.3 節）的線條樣式在規範裡是圖，逐頁看過原圖確認。
- 標準庫的寫法，用網站實際使用的解析器（OpenSysML 0.11.0）逐一試跑，結果列在附錄。
- 網站現況：對照 `library/JRI.sysml`、`templates/sounding-rocket/model.sysml`、`server/extract.ts`、`web/src/model.ts`、`web/src/shapes.ts`。

## 3. 規範對工具的要求

規範第 2 章（Conformance）把工具的符合程度分成五種，並規定每個宣稱符合的工具至少要做到「抽象語法」和「模型交換」兩種。

| 符合類別 | 規範的要求 | 網站現況 |
|---|---|---|
| 抽象語法 | 能建立、讀取、修改、刪除模型元素，並檢查模型是否合乎規則 | 有。靠解析器檢查，「原始碼」分頁可以寫任何合法的 v2 |
| 模型交換 | 能匯入或匯出專案交換檔，副檔名 `.kpar`，裡面的文字檔用 `.sysml` | **沒有** |
| 文字記法 | 支援規範的文字語法（8.2.2 節） | 有 |
| 圖形記法 | 支援規範的圖形記法（8.2.3 節），並支援八種標準視圖（9.2.20 節） | 部分，見第 4.3 節 |
| 語意 | 能依規範的語意解讀模型（例如判定需求是否滿足） | 部分。需求的數值條件會自動判定 |
| 領域庫 | 可以提供第 9 章的領域庫，非必要 | 解析器已內建，但網站的元模型沒有使用，見第 4.1 節 |

另外說明一點：SysML v2 還有一份獨立的 API 規範（Systems Modeling API and Services）。它不在這份語言規範的符合要求之內，所以沒有實作它不算和這份規範不符。

## 4. 差異清單

### 4.1 用自訂標記取代標準庫已有的寫法

| 編號 | 項目 | 網站現在的寫法 | 標準的寫法 | 依據 |
|---|---|---|---|---|
| A1 | 需求衍生 | 自訂 `metadata def <derive> DeriveLink`，寫成 `#derive dependency from 子 to 母;` | `#derivation connection { end #original ::> 母; end #derive ::> 子; }`，一條連結可以有多個子需求 | 9.6.2 節 Derivation；試跑通過 |
| A2 | 細化 | 自訂 `metadata def <refine> RefineLink`，寫成 `#refine dependency` | `#refinement dependency from 較具體 to 較概略;`，方向和網站現在的相同 | 9.3.2.2.3 節 Refinement；試跑通過 |
| A3 | 驗證方法 | 自訂 `VVMethod` 與列舉 `Method`（byTest、byAnalysis、byInspection、byDemonstration） | `@VerificationMethod { kind = VerificationMethodKind::test; }`，列舉值是 inspect、analyze、demo、test | 9.2.17.2.6、9.2.17.2.7 節；四個值都試跑通過 |
| A4 | MOE／MOP | 當成需求的一種（`requirement def MOE`、`MOP`） | 標準庫的 `#moe`、`#mop` 標記，貼在屬性上 | 9.3.4 節 Parameters of Interest Metadata；試跑通過 |
| A5 | 風險 | 自訂 `item def Risk`，欄位是 FMEA（失效模式、嚴重度、可能性、偵測度…） | 標準庫的 `@Risk`，內容是成本、時程、技術、整體四個面向的機率與衝擊 | 9.3.3 節 Risk Metadata；試跑通過 |

不算差異、建議維持現狀的：

- `#trace`：標準庫的 ModelingMetadata 裡沒有對應的元素（試跑確認 `Trace` 不存在）。自訂是合理的。
- `#tpm`：標準庫只有 `#moe`、`#mop`，沒有 TPM（試跑確認）。自訂是合理的。
- Expectation、Need、Goal、Objective 與三層需求做成 `requirement def` 的子類：這是 v2 允許的擴充方式。
- A5 的 FMEA 風險：標準的 `@Risk` 是另一種用途（機率等級），無法取代 FMEA 的欄位。建議保留現在的 `Risk`，需要時再另外加貼 `@Risk`。

### 4.2 利害關係人與參與者沒有用語言內建的寫法

| 編號 | 項目 | 網站現在的寫法 | 標準的寫法 | 依據 |
|---|---|---|---|---|
| B1 | 期望屬於哪位利害關係人 | 利害關係人是一般的 `part`（型別 `Stakeholder`），用 `#trace dependency` 從期望連過去 | 在需求裡寫 `stakeholder s :> 既有的利害關係人;`。也可以把期望寫成 `concern`，再由需求 `frame` 它 | 8.2.2.21、8.2.3.21 節；試跑通過 |
| B2 | 使用案例的參與者 | 用 `#trace dependency` 從使用案例連到利害關係人 | 在使用案例裡寫 `actor a :> 既有的利害關係人;` | 8.2.2.25、8.2.3.25 節；試跑通過 |
| B3 | 使用案例之間的包含 | 沒有對應的操作 | `include use case x :> 另一個使用案例;` | 8.2.3.25 節；試跑通過 |

試跑時發現一個限制：解析器要求 `subject` 必須寫在 `stakeholder` 和 `actor` 之前，沒寫 `subject` 會報錯。所以改用標準寫法時，期望和使用案例都要補上 `subject`（例如整枚火箭）。

好處是現有的利害關係人不用重建：`stakeholder s :> '指導老師';` 可以直接參照模型裡已經有的 `part`。

### 4.3 圖

已確認和規範一致的部分：

| 項目 | 規範 | 網站 |
|---|---|---|
| 定義方角、使用圓角，名稱隔間第一行是 «關鍵字» | 8.2.3.6 節 | 一致 |
| 相依：虛線、開放箭頭 | 8.2.3.3 節 | 一致 |
| 滿足：實線、開放箭頭、«satisfy» | 8.2.3.21 節 satisfy-edge | 一致 |
| 驗證：實線、開放箭頭、«verify» | 8.2.3.24 節 verify-relationship | 一致 |
| 分配：實線、開放箭頭、«allocate» | 8.2.3.15 節 allocate-relationship | 一致 |
| 使用案例：和其他元素一樣是方角或圓角的框，不是橢圓 | 8.2.3.25 節 | 一致 |
| 圖框標題：`«view» 名稱 : 視圖定義` | 8.2.3.26 節 view-frame-name-compartment | 格式一致 |

和規範不一致的部分：

| 編號 | 項目 | 規範 | 網站 |
|---|---|---|---|
| C1 | 視圖是不是模型的一部分 | 視圖用 `view` 寫在模型裡，以 `expose` 指定內容（8.2.2.26 節） | `.sysml` 裡沒有任何 `view`。六種圖由程式依規則產生；自訂圖的成員存在 `diagrams.json`。圖框上寫的 `«view» 結構分解 : GeneralView` 在模型裡並不存在 |
| C2 | 參與者與利害關係人的畫法 | 參與者畫成人形或 «actor» 圓角框，利害關係人畫成 «stakeholder» 圓角框，用實線（無箭頭）連到使用案例或需求（8.2.3.21 節） | 畫成 «part» 的框，用虛線 «trace» 連接。這是 B1、B2 的結果，改了 B1、B2 才能改這一項 |
| C3 | 標準視圖的涵蓋 | 宣稱符合圖形記法的工具要支援八種標準視圖：gv、iv、afv、stv、sv、gev、grv、bv（9.2.20 節表 34） | 有 gv、iv、afv、stv 四種。沒有循序視圖（sv）、幾何視圖（gev）；「表」分頁和左側的樹功能上接近格狀視圖（grv）和瀏覽視圖（bv），但沒有以視圖的形式宣告 |
| C4 | 相依線上的標籤 | 自訂標記換成標準庫的之後，標籤也要跟著換 | 現在顯示 «derive»、«refine»、«trace»。衍生改成連結後不再是相依線，畫法要重新對照 8.2.3.13 節，這一點還沒查 |

節點的位置（`layout.json`）不在規範的範圍內，規範沒有定義圖上座標的存放方式，維持現狀即可。

### 4.4 模型交換

| 編號 | 項目 | 規範 | 網站 |
|---|---|---|---|
| D1 | 專案交換檔 | 至少能匯入或匯出 `.kpar`（第 2 章第 4 點，格式定義在 KerML 規範第 10 章） | 沒有。現有的匯出是 Excel、審查報告、圖檔、`.ork` |

`.kpar` 的內部格式定義在另一份規範（KerML），這次沒有讀，工作量要讀過才能估。解析器的用戶端沒有現成的 `.kpar` 功能。

## 5. 建議的分批

工作量是粗估：小是一天內，中是一到三天，大是三天以上。每一批都包含元模型庫、三種範本、把操作轉成文字的程式、擷取關係的程式、測試，以及把現有專案的模型轉成新寫法。

| 批次 | 內容 | 涵蓋 | 工作量 | 風險 |
|---|---|---|---|---|
| 第一批 | 衍生、細化、驗證方法改用標準庫 | A1、A2、A3、C4 | 中 | 低。都是一對一的改寫，可以用程式自動轉換現有模型。衍生從「相依」變成「連結」，擷取與畫圖的程式要跟著改 |
| 第二批 | 利害關係人與參與者改用 `stakeholder`、`actor`，圖上改成標準畫法，加上使用案例的包含 | B1、B2、B3、C2 | 中到大 | 中。期望和使用案例都要補 `subject`，引導式的畫面要多一個步驟 |
| 第三批 | 每張圖在模型裡寫一個 `view`；自訂圖的成員改存成 `expose` | C1 | 中 | 中。`diagrams.json` 的資料要搬進模型，分支合併時視圖也會參與合併 |
| 第四批 | `.kpar` 匯出與匯入 | D1 | 未估 | 要先讀 KerML 第 10 章 |
| 視需要 | MOE／MOP 改用 `#moe`、`#mop`；補循序視圖；把「表」和樹宣告成標準視圖 | A4、C3 | 各自估 | A4 會改變 MOE／MOP 在追溯鏈裡的位置（從需求變成屬性），牽動節點檢查，要另外討論 |

建議的順序是第一批、第二批、第三批、第四批。第一批最便宜，而且衍生是需求追溯的主幹，對互通的幫助最大。

每一批都要保留讀取舊寫法的能力，直到所有專案都轉換完成，否則舊的提交和基線會無法比較。

## 6. 需要決定的事

決定紀錄：

- 2026-11-16，Mars：和別的 SysML v2 工具交換模型是這個網站的目標。因此第一到三批要做，第四批視要不要宣稱符合規範而定。

還沒決定的：

1. **互通的對象是哪個工具。** 這份提案是對照規範和網站自己的解析器查證的，沒有拿任何其他工具實測。動工前應該先拿一份改成標準寫法的範本模型，實際匯入對方的工具，確認衍生、利害關係人、視圖這幾項對方真的認得。
2. **時程。** 建議全部排在 MDR 之後。這些修改會動到元模型庫和現有專案的模型，不適合在審查前進行。
3. **MOE／MOP（A4）要不要改。** 這不只是換寫法，會改變它們在模型裡的角色。
4. **宣稱符合到哪一級。** 目前可以說「產生合法的 SysML v2 文字，圖的記法依規範 8.2.3 節」。要宣稱是符合規範的工具，依第 2 章至少要補上 `.kpar`（第四批）。

## 7. 這次沒有查證的

- `.kpar` 的格式（KerML 第 10 章）沒有讀。
- 衍生連結在圖上的畫法（8.2.3.13 節）沒有對照。
- 連接埠、介面、項目流的記法沒有對照。網站的引導式畫面沒有這些操作，只能在「原始碼」分頁手寫。
- 解析器 OpenSysML 0.11.0 對應規範的哪一個版本沒有查。試跑的結果代表這個解析器接受這些寫法，不能完全代表規範本身；兩者不一致時以規範為準。
- 各批的工作量是粗估，沒有拆成工作項目。

## 附錄：試跑結果

用網站的解析器（OpenSysML 0.11.0）逐段解析，「通過」表示沒有錯誤。

| 寫法 | 結果 |
|---|---|
| 對照組：匯入不存在的庫、使用不存在的型別 | 報錯（確認解析器會檢查名稱） |
| `#derivation connection { end #original ::> a; end #derive ::> b; }` | 通過 |
| 同一條衍生連結有兩個 `#derive` 端 | 通過 |
| `#refinement dependency from b to a;` | 通過 |
| `ModelingMetadata` 的 `Rationale`、`StatusInfo`、`Issue` | 通過 |
| `ModelingMetadata` 裡的 `Trace` | 不存在 |
| `@VerificationMethod { kind = VerificationMethodKind::test; }`，以及 inspect、analyze、demo | 通過 |
| `VerificationMethodKind` 的 inspection、analysis、demonstration | 不存在 |
| `#moe attribute`、`#mop attribute` | 通過 |
| `ParametersOfInterestMetadata` 裡的 `#tpm` | 不存在 |
| `@Risk { totalRisk = RiskLevelEnum::medium; }` | 通過 |
| `allocate f to s;`、`satisfy r by s;` | 通過 |
| 需求裡寫 `subject` 後再寫 `stakeholder s : Person;` | 通過 |
| 需求裡沒有 `subject` 就寫 `stakeholder` | 報錯：Subject must be first parameter |
| `stakeholder s :> 既有的 part;`，同一條需求兩位利害關係人 | 通過 |
| `concern def` 加 `stakeholder`；需求 `frame concern` | 通過 |
| 使用案例寫 `subject` 後再寫 `actor a :> 既有的 part;` | 通過 |
| 使用案例沒有 `subject` 就寫 `actor` | 報錯：Subject must be first parameter |
| `include use case x :> 另一個使用案例;` | 通過 |
| `view v : StandardViewDefinitions::GeneralView { expose …; }`，以及 InterconnectionView、ActionFlowView、StateTransitionView、SequenceView、GeometryView、GridView、BrowserView | 通過 |
| `StandardViewDefinitions::CaseView` | 不存在 |
| `view def` 加 `render asTreeDiagram;`；`viewpoint` 加 `frame concern`；`view` 滿足 `viewpoint`；`expose` 加 `filter` | 通過 |
| `library package L { … }` | 通過 |
