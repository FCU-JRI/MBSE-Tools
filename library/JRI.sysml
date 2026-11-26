/* JRI MBSE 元模型庫
 * 依 NASA-HDBK-1009A 的元模型（Figure 7-1、7-2）與 AEAS-EXB-REG-1001 v2.3 定義。
 * 專案模型以這裡的定義為型別，工具依型別把元素歸類到各節點的產出物。
 */
package JRI {
    private import ScalarValues::*;
    private import MeasurementReferences::*;
    private import ISQ::*;
    private import SI::*;

    // ───────── 單位（SI 標準庫沒有帶的常用前綴單位） ─────────
    // 需求門檻可寫 3 [km]、300 [kPa]。用標準的 ConversionByPrefix 定義，換算由解析器做。
    attribute <km> kilometre : LengthUnit { :>> unitConversion : ConversionByPrefix { :>> prefix = kilo; :>> referenceUnit = m; } }
    attribute <kPa> kilopascal : PressureUnit { :>> unitConversion : ConversionByPrefix { :>> prefix = kilo; :>> referenceUnit = Pa; } }

    // ───────── 需求支柱 Requirements ─────────

    /* 利害關係人 Stakeholder */
    part def Stakeholder {
        attribute role : String;
    }

    /* 利害關係人期望 Stakeholder Expectation */
    requirement def Expectation;
    /* 需要 Need */
    requirement def Need;
    /* 目標 Goal */
    requirement def Goal;
    /* 目的 Objective */
    requirement def Objective;
    /* 效能量度 Measure of Effectiveness。successLevel：成功判準三級（最低、完全、額外） */
    requirement def MOE {
        attribute successLevel : String[0..1];
    }
    /* 性能量度 Measure of Performance */
    requirement def MOP;
    /* 任務需求：第 1 層的出口（來源：成功判準與來源文件的硬條件），第 2 層任務剖面的輸入 */
    requirement def MissionRequirement;
    /* 系統層需求 */
    requirement def SystemRequirement;
    /* 次系統層需求 */
    requirement def SubsystemRequirement;
    /* 元件層需求 */
    requirement def ComponentRequirement;
    /* 確認需求 Validation Requirement */
    requirement def ValidationRequirement;

    // 追溯關係。衍生與細化用 SysML v2 標準庫的寫法，別的工具才認得；在這裡轉出，專案模型匯入 JRI 就能直接使用：
    //   #derivation connection { end #derive ::> 子需求; end #original ::> 母需求; }
    //   #refinement dependency from 較具體的 to 較概略的;
    public import RequirementDerivation::derivation;
    public import RequirementDerivation::original;
    public import RequirementDerivation::derive;
    public import ModelingMetadata::refinement;
    // 一般追溯在標準庫沒有對應的標記，沿用自訂的：
    //   #trace dependency from 下層 to 上層;
    metadata def <trace> TraceLink;
    // 設計依據：下一層需求根據上一層設計迴圈的哪個產出（介面、邊界、配額、選定方案、決策）推出來
    //   #basis dependency from 下層需求 to 設計產出;
    metadata def <basis> BasisLink;

    /* 出處：這個項目來自哪一份文件的哪一節。文件清單在專案的 pm.json（docs）。
       用法：@Source { sourceDoc = "DOC-001"; sourceRef = "3.2"; } */
    metadata def Source {
        attribute sourceDoc : String;
        attribute sourceRef : String[0..1];
    }

    /* CAD 連結：設計迴圈第 5 步。模型只放連結與版本，不附檔。
       用法：@CadLink { cadUrl = "https://..."; cadVersion = "v3"; cadTool = "Onshape"; } */
    metadata def CadLink {
        attribute cadUrl : String;
        attribute cadVersion : String;
        attribute cadTool : String[0..1];
    }

    /* 層級：mission（任務）、system（系統）、subsystem（次系統）、component（元件）。推不出層級時才手填。
       用法：@LayerTag { layer = "subsystem"; } */
    metadata def LayerTag {
        attribute layer : String;
    }

    /* 說明：為什麼這樣定（why）、用什麼條件判定通過（judge）。任何元素都可以掛；缺了只出警告，不擋卡點。
       名稱避開標準庫 ModelingMetadata::Rationale，兩者可以同時匯入。
       用法：@DesignRationale { why = "掃描段 40 min 加備援後取整"; judge = "計算值 ≥ 60 min；飛測後以實測值取代"; } */
    metadata def DesignRationale {
        attribute why : String[0..1];
        attribute judge : String[0..1];
    }

    /* 修正：FixLink 從風險指向被回頭修正的元素（候選、零件、需求…），修正內容寫在風險的 fixNote。
       用法：#fix dependency from 'R-30' to '拉進式'; */
    metadata def <fix> FixLink;

    // ───────── 結構支柱 Structure ─────────

    part def System;
    part def Subsystem;
    part def Component;
    /* 系統脈絡中的外部對象 */
    part def ExternalEntity;

    /* 介面：兩個次系統之間的連接，屬於上一層（系統）的設計產出。
       kind：機械、熱、電、流體、資料、人。兩端的關鍵數字寫在介面上（名稱A、名稱B），用 assert constraint 檢查是否對得上。
       兩端各有一個同名的連接埠：port <'IF-001-A'> 'IF-001' : InterfacePort; */
    port def InterfacePort;
    interface def Interface {
        attribute kind : String;
        end a : InterfacePort;
        end b : InterfacePort;
    }
    /* 介面狀態：maturity＝exists（存在）、tentative（暫定）、frozen（凍結）；agreedA／agreedB：兩端負責人是否同意 */
    metadata def InterfaceStatus {
        attribute maturity : String;
        attribute agreedA : String[0..1];
        attribute agreedB : String[0..1];
    }

    /* 設計方案：用 SysML v2 的 variation／variant 列出候選，例如
       variation part def <'ALT-001'> '回收方案' :> DesignAlternative { variant part <'ALT-001-1'> '單段傘'; } */
    part def DesignAlternative;

    /* 方案評分：準則就是連到方案的需求。權重寫在需求上：@TradeWeight { weight = 3.0; }（沒寫當 1）。
       候選對準則的分數寫在候選上，一個準則一個值，名稱是 score_ 加需求編號（- 換成 _）：
       variant part <'ALT-001-1'> '單段傘' { attribute score_REQ_SYS_001 : TradeScore = 4.0; } */
    metadata def TradeWeight {
        attribute weight : Real;
    }
    attribute def TradeScore :> Real;
    /* 風險修正後的調整分數：名稱是 adjusted_ 加需求編號，寫在候選上，和 score_ 並列；沒有調整就不寫。
       variant part <'ALT-001-1'> '單段傘' { attribute adjusted_REQ_SYS_001 : TradeScore = 5.0; } */

    /* 被否決的候選為什麼被否決；選定的不用寫。
       用法（寫在 variant 裡）：@Rejection { rejectWhy = "重量超出配額"; } */
    metadata def Rejection {
        attribute rejectWhy : String;
    }

    /* 準則的評分標準：1／3／5 分各代表什麼，寫在當準則的需求上。
       用法：@CriterionScale { scale1 = "< 45 min"; scale3 = "約 60 min"; scale5 = "> 75 min"; } */
    metadata def CriterionScale {
        attribute scale1 : String[0..1];
        attribute scale3 : String[0..1];
        attribute scale5 : String[0..1];
    }

    /* 方案比較整體的權重敏感度說明，寫在設計方案（variation part def）上。
       用法：@TradeSensitivity { sensitivity = "航時權重 3→5 時排序不變"; } */
    metadata def TradeSensitivity {
        attribute sensitivity : String;
    }

    // ───────── 行為支柱 Behavior ─────────

    /* 任務階段 Mission Phase */
    action def MissionPhase;
    /* 功能 Function / Activity */
    action def Function;
    /* 使用案例 Use Case：利害關係人怎麼使用系統 */
    use case def UseCase;
    /* 模式與狀態 Mode / State */
    state def Mode;

    // ───────── 參數支柱 Parametrics ─────────

    /* 技術性能量度：標記在值屬性上 */
    metadata def <tpm> TPM {
        attribute target : String[0..1];
        attribute status : String[0..1];
    }
    /* TPM 在各審查節點的值（單位同所標記的屬性），寫在屬性的主體內。沒到的節點不寫。
       用法：#tpm attribute mtow : MassValue { @TpmTrend { atSRR = 7.9; atSDR = 7.6; atPDR = 7.2; } } */
    metadata def TpmTrend {
        attribute atSRR : Real[0..1];
        attribute atSDR : Real[0..1];
        attribute atMDR : Real[0..1];
        attribute atPDR : Real[0..1];
        attribute atCDR : Real[0..1];
        attribute atTRR : Real[0..1];
        attribute atFRR : Real[0..1];
    }

    // ───────── 驗證與確認 V&V ─────────

    /* 驗證事件：以 verification 使用，並在 objective 中 verify 需求 */
    verification def VerificationEvent;
    /* 確認事件 */
    verification def ValidationEvent;

    // 驗證方法用標準庫的 VerificationMethod，值是 test、analyze、inspect、demo：
    //   @VerificationMethod { kind = VerificationMethodKind::test; }
    public import VerificationCases::VerificationMethod;
    public import VerificationCases::VerificationMethodKind;

    // ───────── 風險與安全、作業與品質 ─────────

    /* 風險（FMEA）：嚴重度與可能性皆為 1–5 */
    item def Risk {
        attribute failureMode : String;
        attribute effect : String;
        attribute cause : String;
        attribute severity : Integer;
        attribute likelihood : Integer;
        attribute mitigation : String;
        attribute owner : String;
        /* 偵測度 1–5：越難在出事前發現，分數越高 */
        attribute detection : Integer;
        /* 緩解後的嚴重度與可能性 */
        attribute residualSeverity : Integer;
        attribute residualLikelihood : Integer;
        attribute status : String;
        /* 風險種類：技術、時程、預算、場地、人員（風險登錄用） */
        attribute riskKind : String[0..1];
        /* 回頭修正：為了這個風險改了模型哪裡。被修正的元素用 #fix dependency 指過去 */
        attribute fixNote : String[0..1];
    }

    /* 設計決策：方案選定、衝突裁決都留理由、裁決者與日期（TR-08） */
    item def DesignDecision {
        attribute rationale : String;
        attribute decidedBy : String;
        attribute decidedOn : String;
        /* 放行（ok）或喊卡（hold）；沒寫視為放行 */
        attribute releaseStatus : String[0..1];
        /* 喊卡原因與放行條件 */
        attribute holdReason : String[0..1];
    }

    /* 安全係數 Factor of Safety */
    item def SafetyFactor {
        attribute required : Real;
        attribute actual : Real;
        attribute basis : String;
    }

    /* 標準作業程序 */
    item def SOP {
        attribute documentRef : String;
        attribute revision : String;
    }

    /* 測試或飛行名冊中的一員 */
    item def RosterEntry {
        attribute person : String;
        attribute duty : String;
        attribute rank : String;
    }

    /* 異常報告與矯正措施 */
    item def Anomaly {
        attribute observed : String;
        attribute rootCause : String;
        attribute severity : Integer;
        attribute correction : String;
        attribute prevention : String;
        attribute status : String;
    }

    /* 加工 QC 紀錄（AEAS 6.2.3.2 的簽核順序） */
    item def QCRecord {
        attribute drawingRef : String;
        attribute designer : String;
        attribute preSignOff : String;
        attribute machinist : String;
        attribute postSignOff : String;
        attribute finalSignOff : String;
        attribute status : String;
    }
}
