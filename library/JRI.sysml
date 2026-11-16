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
    // [/P1]
    // [P2 分析圖骨架與中文化]
    // [/P2]
    // [P3 任務剖面、功能分配、MOE／MOP／TPM]
    // [/P3]
    // [P4 介面與 N² 矩陣]
    // [/P4]
    // [P5 FMEA、風險與圖表]
    // [/P5]
    // [P6 方案比較與模型內公式]
    // 方案比較（METHOD.md 第 6 節、NASA SE Handbook 6.8）。名稱避開標準庫的 TradeStudies::TradeStudy。
    /* 決策矩陣 Decision Matrix：一次方案比較。候選方案寫在它的主體裡 */
    item def DecisionMatrix {
        /* 這次要決定什麼 */
        attribute question : String;
        /* 結論與理由 */
        attribute decision : String;
    }
    /* 評比準則 Criterion：專案統一定義，權重在這裡設一次。
       kind = "must"（必須：不通過就剔除，不計分）或 "want"（加分：分數 1 到 5 乘以權重）；
       aspect 是面向，例如 performance、cost、schedule、safety、risk（風險是評比準則之一）。
       每項準則要以 #trace 追溯到需求、MOE 或 MOP */
    item def Criterion {
        attribute kind : String;
        attribute weight : Real;
        attribute aspect : String;
        /* 怎麼量、單位或門檻（客觀可量測） */
        attribute measure : String;
    }
    /* 候選方案 Alternative：status = "candidate"（評估中）、"selected"（選定）、"rejected"（否決，要寫理由） */
    item def Alternative {
        attribute status : String;
        attribute rationale : String;
    }
    /* 候選方案在一項準則上的分數，寫在候選方案的主體裡，名稱用準則的編號。
       必須準則：1 = 通過、0 = 不通過；加分準則：1 到 5 */
    item def CriterionScore {
        attribute score : Real;
        attribute basis : String;
    }
    // [/P6]
    // [P7 火箭外形與模擬圖]
    // [/P7]
}
