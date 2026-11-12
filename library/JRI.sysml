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

    // 追溯關係：以 dependency 加上標記表示，例如
    //   #derive dependency from 子需求 to 母需求;
    metadata def <trace> TraceLink;
    metadata def <derive> DeriveLink;
    metadata def <refine> RefineLink;

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

    enum def Method {
        enum byTest;
        enum byAnalysis;
        enum byInspection;
        enum byDemonstration;
    }
    metadata def <method> VVMethod {
        attribute kind : Method;
    }

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
}
