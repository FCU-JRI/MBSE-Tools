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
    // [/P6]
    // [P7 火箭外形與模擬圖]
    /* 火箭幾何 Geometry：標在任何零件（次系統、元件、外形段）上，給出它沿箭軸的位置與尺寸。
       火箭外形（2D 側視圖）、重心、壓力中心與系統簡圖都讀這一份數字。
       座標：原點在鼻錐尖端，往尾端為正；單位是 m、kg，寫數字即可；套件有匯入 SI 時也可以寫 100 [mm]、500 [g]，工具會換算。
       geoKind：nose 鼻錐、body 箭體段、transition 過渡段、fins 尾翼組、mass 只有質量（裝在箭體內的東西）。
       用法：part '鼻錐' { @Geometry { geoKind = "nose"; geoPosition = 0; geoLength = 0.4; geoDiameter = 0.1; geoMass = 0.5; } } */
    metadata def Geometry {
        attribute geoKind : String;
        /* 前端（尾翼組是翼根前緣）到鼻錐尖端的距離 */
        attribute geoPosition : Real;
        attribute geoLength : Real[0..1];
        /* 外徑；鼻錐是底部外徑，過渡段是前端外徑 */
        attribute geoDiameter : Real[0..1];
        /* 過渡段的後端外徑 */
        attribute geoAftDiameter : Real[0..1];
        /* 鼻錐外形：conical、ogive、vonKarman、lvhaack、tangent、parabolic、elliptical */
        attribute geoShape : String[0..1];
        /* 尾翼組：片數、翼根弦長、翼尖弦長、翼展（單片高度）、後掠長度（翼根前緣到翼尖前緣） */
        attribute geoFinCount : Integer[0..1];
        attribute geoRootChord : Real[0..1];
        attribute geoTipChord : Real[0..1];
        attribute geoSpan : Real[0..1];
        attribute geoSweep : Real[0..1];
        /* 質量（含推進劑）與它自己的重心距本段前端的距離；沒寫重心就當作本段中點 */
        attribute geoMass : Real[0..1];
        attribute geoCg : Real[0..1];
        /* 推進劑質量：燃燒完會扣掉，用來算燃畢的重心與穩定裕度 */
        attribute geoPropellant : Real[0..1];
    }
    // [/P7]
}
