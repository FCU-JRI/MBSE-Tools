/* JRI MBSE 元模型庫
 * 依 NASA-HDBK-1009A 的元模型（Figure 7-1、7-2）與 AEAS-EXB-REG-1001 v2.3 定義。
 * 專案模型以這裡的定義為型別，工具依型別把元素歸類到各節點的產出物。
 */
package JRI {
    private import ScalarValues::*;

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
    /* 效能量度 Measure of Effectiveness */
    requirement def MOE;
    /* 性能量度 Measure of Performance */
    requirement def MOP;
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

    /* 出處：這個項目來自哪一份文件的哪一節。文件清單在專案的 pm.json（docs）。
       用法：@Source { sourceDoc = "DOC-001"; sourceRef = "3.2"; } */
    metadata def Source {
        attribute sourceDoc : String;
        attribute sourceRef : String[0..1];
    }

    // ───────── 結構支柱 Structure ─────────

    part def System;
    part def Subsystem;
    part def Component;
    /* 系統脈絡中的外部對象 */
    part def ExternalEntity;

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

    // ───────── METHOD.md 實作：各期只改自己的區塊（docs/IMPL-PLAN.md）─────────
    // [P1 需求屬性與需求矩陣]
    /* 任務需求 Mission Requirement：整個任務要達成什麼、不能違反什麼（METHOD.md 2.1）。不寫階段、順序、轉換條件 */
    requirement def MissionRequirement;

    // 所有需求類別的共同屬性（METHOD.md 2.1、第 8 節）。同一個概念只留一種寫法：
    //   驗證方法：標準庫的 @VerificationMethod { kind = VerificationMethodKind::test; }（建立需求時就要填）
    //   理由：標準庫的 @Rationale { text = "…"; }
    //   其餘：@RequirementInfo { verificationLead = "…"; verificationLevel = VerificationLevelKind::system;
    //          responsible = "…"; reqStatus = RequirementStatusKind::checked; reqType = RequirementTypeKind::functional; }
    public import ModelingMetadata::Rationale;
    /* 驗證層級：這條需求在哪一層驗證 */
    enum def VerificationLevelKind { system; subsystem; component; }
    /* 需求狀態：pass＝略過、checked＝已檢查、tbc＝待確認 */
    enum def RequirementStatusKind { pass; checked; tbc; }
    /* 需求類型：功能、性能、環境、安全、型態、品質、介面、操作 */
    enum def RequirementTypeKind { functional; performance; environmental; safety; configuration; quality; interfacing; operational; }
    metadata def RequirementInfo {
        /* 驗證負責人 */
        attribute verificationLead : String[0..1];
        attribute verificationLevel : VerificationLevelKind[0..1];
        /* 負責人 */
        attribute responsible : String[0..1];
        attribute reqStatus : RequirementStatusKind[0..1];
        attribute reqType : RequirementTypeKind[0..1];
    }
    // [/P1]
    // [P2 分析圖骨架與中文化]
    // [/P2]
    // [P3 任務剖面、功能分配、MOE／MOP／TPM]
    /* 模式的種類（METHOD.md 2.2）：正常操作、失效、中止。標在模式（Mode）上：
       state '降落傘未開' : Mode { @ModeKind { kind = "failure"; } } */
    metadata def ModeKind {
        /* operational（正常操作）、failure（失效）、abort（中止） */
        attribute kind : String;
    }
    /* 三級成功判準（METHOD.md 2.1）：成功判準就是 MOE。標在 MOE 上，數字各一個：
       達到 full 是完全成功、達到 partial 是部分成功、都沒達到是不成功。
       better = "higher"（越大越好，預設）或 "lower"（越小越好）；actual 是飛行後的實際值。
       requirement '遠地點' : MOE { @SuccessLevels { full = 3000.0; partial = 2500.0; unit = "m"; } } */
    metadata def SuccessLevels {
        attribute full : Real;
        attribute partial : Real;
        attribute unit : String[0..1];
        attribute better : String[0..1];
        attribute actual : Real[0..1];
    }
    /* TPM 的追蹤（METHOD-NASA 第二部分第 6 點）：TPM 從 MOP 中挑出，每個審查節點記錄目前估計值。
       標在 MOP 上；節點名稱和工具的審查節點代號相同（proposal、mdr、pdr、cdr、trr、frr）。
       expected 是預期值，lower／upper 是允許範圍（可只寫一邊）。
       requirement '總衝量' : MOP { @TPMTrack { expected = 9000.0; lower = 8500.0; unit = "N*s"; mdr = 8800.0; pdr = 8950.0; } } */
    metadata def TPMTrack {
        attribute expected : Real[0..1];
        attribute lower : Real[0..1];
        attribute upper : Real[0..1];
        attribute unit : String[0..1];
        attribute proposal : Real[0..1];
        attribute mdr : Real[0..1];
        attribute pdr : Real[0..1];
        attribute cdr : Real[0..1];
        attribute trr : Real[0..1];
        attribute frr : Real[0..1];
    }
    // [/P3]
    // [P4 介面與 N² 矩陣]
    // [/P4]
    // [P5 FMEA、風險與圖表]
    // [/P5]
    // [P6 方案比較與模型內公式]
    // [/P6]
    // [P7 火箭外形與模擬圖]
    // [/P7]
}
