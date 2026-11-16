# 方案比較與模型內公式（P6）

狀態：草稿，2026-11-17，IMPL-PLAN 的 P6。依據 `METHOD.md` 第 5、6 節與圖 9、`METHOD-NASA.md` 第一部分第 7 點（NASA SE Handbook 6.8）。

## 1. 方案比較（圖 9）

### 1.1 模型的寫法

元模型在 `library/JRI.sysml` 的 P6 區塊。名稱刻意避開標準庫的 `TradeStudies::TradeStudy`（見 1.4 節）。

| 類別 | 用途 | 屬性 |
|---|---|---|
| `DecisionMatrix` 方案比較 | 一次方案比較；候選方案寫在它的主體裡 | `question` 要決定什麼、`decision` 結論 |
| `Criterion` 評比準則 | **專案統一**的準則與權重，放在 `TradeStudies` 套件 | `kind`：`must`（必須）或 `want`（加分）；`weight` 權重（加分準則）；`aspect` 面向（`performance`、`cost`、`schedule`、`safety`、`risk`、`mission`）；`measure` 怎麼量 |
| `Alternative` 候選方案 | 一個選項 | `status`：`candidate`、`selected`、`rejected`；`rationale` 理由 |
| `CriterionScore` 分數 | 寫在候選方案裡，名稱用準則的編號 | `score`、`basis` 依據 |

```sysml
item <'CRIT-001'> '推重比下限' : Criterion { :>> kind = "must"; :>> aspect = "performance"; :>> measure = "TWR >= 5"; }
item <'CRIT-002'> '技術風險' : Criterion { :>> kind = "want"; :>> weight = 2.0; :>> aspect = "risk"; }
#trace dependency from 'CRIT-001' to Requirements::'REQ-SYS-001';   // 準則追溯到需求、MOE 或 MOP

item <'TRD-001'> '推進方案比較' : DecisionMatrix {
    :>> question = "用哪一種引擎";
    item <'ALT-001'> '方案甲' : Alternative {
        :>> status = "selected";
        :>> rationale = "加權分數最高";
        item 'CRIT-001' : CriterionScore { :>> score = 1.0; }
        item 'CRIT-002' : CriterionScore { :>> score = 4.0; :>> basis = "已有飛行紀錄"; }
    }
}
#trace dependency from Structure::'SUB-001' to 'TRD-001'::'ALT-001';  // 選定方案成為設計
```

關係都用既有的 `#trace`：準則 → 需求／MOE／MOP；方案比較 → 準則（只用部分準則時；沒連就用全部）；設計元素 ↔ 選定方案。

### 1.2 計算規則（`web/src/method/trade.ts`，伺服器與網頁共用）

- **必須準則**：分數 1 = 通過、0 = 不通過。任何一項不通過，方案剔除、不計加權分數（NASA SE Handbook 6.8）。
- **加分準則**：分數 1 到 5。加權總分 = Σ 權重 × 分數；正規化分數 = 加權總分 ÷ Σ 權重（仍落在 1 到 5）。
- 名次只排「必須準則全過、加分準則分數齊全」的方案，同分同名次。
- **還缺什麼**（圖 9 上方與方案比較頁）：沒有準則、沒有必須準則、沒有風險準則（`aspect = risk`）、準則沒有追溯、權重不是正數、分數缺或超出範圍、只有一個方案、沒有選定或選了多個、選定的方案沒通過必須準則、選定的方案沒連到設計、選定的不是最高分又沒寫理由、否決的方案沒寫理由。
- **弱點**：選定方案在加分準則上 ≤ 2 分的項目列為弱點，應登記為風險（METHOD.md 第 6 節第 4 點；風險本身歸 P5）。

### 1.3 網站

- 「方案比較」分頁：專案統一的準則表（種類、權重與占比、面向、追溯）；每個方案比較一張矩陣（準則 × 方案，直接在格子裡打分）、加權總分、正規化分數、名次、還缺什麼；記錄決定（選定一個、其餘否決，各寫理由）；把選定方案連到設計元素。
- 新增準則、方案比較、候選方案沿用既有的新增元素 API；打分與決定是 P6 的路由：

| 路由 | 用途 |
|---|---|
| `GET /api/projects/:id/trades` | 全部方案比較的計算結果 |
| `POST /api/projects/:id/trades/score` | `{ alternative, criterion, score, basis }`：新增或修改一格分數 |
| `POST /api/projects/:id/trades/decide` | `{ matrix, selected, rationale: { 方案 id: 理由 }, decision }`：選定一個、其餘否決；否決沒有理由就擋下 |

### 1.4 沒有用標準庫 TradeStudies 的原因

SysML v2 標準庫有 `TradeStudies::TradeStudy`（以評估函式選出最大或最小的方案），也有 `variation`／`variant`。它們表達的是「一個評估函式」，沒有「必須／加分」、權重、逐格分數與否決理由，和 METHOD.md 第 6 節要的決策矩陣不同。本期用 JRI 自己的四個類別，記號仍是標準的 `item`、`#trace`。要不要再接標準庫的 `TradeStudy`，列為待決（第 4 節）。

## 2. 模型內公式

### 2.1 寫法

公式寫成 `calc def`，放在根套件下的 `Calculations` 套件（網站新增第一條公式時會建立這個套件與求值需要的匯入）。屬性用公式算：

```sysml
package Calculations {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import RealFunctions::*;          // sqrt
    private import OpenSysMLMathFunctions::*; // ln、exp（不是標準庫，見 3.2 節）
    calc def <'CALC-001'> TWR {
        doc /* 推重比 = 推力 / 重量。出處：… 假設：海平面重力 */
        in thrust : ForceValue;
        in mass : MassValue;
        return : Real = thrust / (mass * 9.80665 [m/s^2]);
    }
}
part def '火箭' :> System {
    attribute thrust : ForceValue default = 1200.0 [N];
    attribute mass : MassValue default = 20.0 [kg];
    attribute twr : Real = Calculations::TWR(thrust, mass);
    assert constraint '推重比下限' { twr >= 5.0 }
}
part rocket : '火箭' { attribute :>> mass = 30.0 [kg]; }
```

要讓使用處改寫的數字，定義裡要寫 `default =`；寫 `=` 是固定值，改寫會被解析器擋下（實測）。

### 2.2 網站

「公式」分頁：

- 公式表：編號、名稱、輸入、運算式、說明；可以新增與編輯（名稱、輸入「名稱 : 型別」、回傳型別、運算式、出處與假設）。存檔前由解析器檢查，有錯誤就不存、顯示診斷。
- 算出來的數字：每個寫了運算式的屬性（包括使用處從定義繼承來的），由解析器求值，帶單位。
- 過或不過：每個 `assert constraint` 對每個使用處判定一次；需求的限制（`satisfy`）沿用既有的判定。
- 試算：輸入任意運算式（例如 `Calculations::DeltaV(180.0, 20.0, 15.0)`）求值，不存檔。

| 路由 | 用途 |
|---|---|
| `GET /api/projects/:id/calcs` | 公式、算出來的數字、過或不過 |
| `POST /api/projects/:id/calcs` | 新增（沒有 `id`）或修改（有 `id`）一條公式 |
| `POST /api/projects/:id/calcs/eval` | `{ expression, context }`：求值，不存檔 |

運算式不能有分號、大括號、註解或換行，參數名稱與型別只收識別字，避免從表單寫進別的東西。

## 3. 解析器實測（@openmbee/opensysml 0.11.0，2026-11-17）

測試寫在 `server/p6.test.ts`，資料都是合成的。

### 3.1 結果

| 項目 | 結果 |
|---|---|
| `calc def` 求值（`model.calc`、`model.eval`） | 可以。`DeltaV(180.0, 20.0, 15.0)` = 507.8155… |
| 開根號 `sqrt` | 可以，在標準庫 `RealFunctions`（要匯入） |
| 次方 `**` | 可以，`2.0 ** 0.5` = 1.41421… |
| 自然對數 `ln`、`exp` | 可以，但**不在標準庫**：要匯入解析器自己的 `OpenSysMLMathFunctions`。`RealFunctions::ln` 解析不到 |
| 計算之間串接 | 可以，`Twice(a, b) = 2.0 * Hyp(a, b)`、`Hyp = sqrt(a*a + b*b)` → `Twice(3.0, 4.0)` = 10 |
| 單位 | 可以。`1200.0 [N] / (20.0 [kg] * 9.80665 [m/s^2])` 化成無因次的數；`10.0 [km] + 5.0 [m]` = 10.005 km。結果可能是分數（rational），工具換成小數 |
| 屬性用公式、改上游跟著變 | 可以。`rocket` 把質量從 20 kg 改成 30 kg，`rocket.twr` 從 6.118 變成 4.079 |
| 過或不過 | 可以。`verifyConstraint` 對使用處判定 `assert constraint`；上例 30 kg 時判定「不過」、20 kg 時「過」 |
| 錯誤 | 名稱解析不到、運算式語法錯，都回傳錯誤訊息，不會讓伺服器當掉 |
| 限定名稱 | `eval` 的運算式要從 `context` 套件往下寫（`rocket.twr`），寫 `Project::Structure::rocket` 這種完整路徑反而解析不到 |

### 3.2 限制

1. `ln`、`exp` 依賴 `OpenSysMLMathFunctions`。用到它們的模型，換到別的 SysML v2 工具可能解析不到。替代：(a) 接受，只在 JRI 工具內使用；(b) 公式改寫成不用 `ln` 的形式（例如給定質量比的查表）；(c) 等標準庫補上。**需要 Mars 決定**。
2. 解析器的標準庫套件 `TradeStudies` 有 `TradeStudy` 與 `runAnalysis`，本期沒有接（1.4 節）。
3. 本期只判定 `assert constraint` 與既有的需求 `satisfy`；TPM 的估計值回填歸 P3、模擬歸 P7。

## 4. AI 提公式、人審（流程說明）

工具**不呼叫任何 AI、不經手任何憑證**。AI 的部分是成員自己用自己的 Claude 方案做的，流程如下：

1. 成員把一條需求（例如「火箭應在離開發射軌時速度 ≥ 某值」）交給自己的 Claude，請它提出：用哪條公式、有哪些假設、出處（教科書或手冊的章節）、輸入與輸出的單位。
2. Claude 把公式寫成 `calc def`（含 `doc` 寫出處與假設），以 PR 提出，不直接改 main。
3. 審查者（組長）檢查公式、假設與出處；性能分析在核准前預跑。
4. 核准合併後，判定過不過的是解析器算出來的公式與後續的模擬；Claude 的意見寫在 PR 留言並標示「參考」，不計入驗證矩陣。

## 5. 待決

- `ln`／`exp` 用非標準套件（3.2 節第 1 點）。
- 要不要接標準庫的 `TradeStudies::TradeStudy`／`variation`（1.4 節）。
- 準則的面向清單（`aspect`）是否固定為六種；加分準則的分數尺度是否固定 1 到 5。
- 選定方案的弱點是否自動建立風險（目前只列出，風險由 P5 的頁面建立）。
