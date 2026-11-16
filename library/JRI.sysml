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

    /* 風險：可能性（likelihood）與後果（severity）皆為 1–5（NASA 5 × 5 矩陣，METHOD.md 7.2）。
       可以掛在任何層級，威脅的需求、來源與緩解都用 #trace 相依表示（方向見 P5 區塊的說明）。
       舊模型把失效模式、影響、原因與偵測度寫在風險上，照樣保留可讀；新的失效模式改用 FailureMode。 */
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
        /* 來源：FMEA、方案比較、任務剖面或其他（METHOD.md 7.2） */
        attribute source : String;
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
    // 介面（METHOD.md 第 4 節）：連接埠帶它要管的物理量，介面把兩端接起來，兩端的數字用 assert constraint 檢查。
    //   port def 電源埠 :> InterfacePort { attribute voltage : Real; }
    //   interface def 電源介面 :> Interface { attribute :>> interfaceKind = InterfaceKind::electrical;
    //       end supply : 電源埠; end load : 電源埠; assert constraint 電壓相符 { supply.voltage == load.voltage } }
    //   part def 火箭 :> System { part 電池 : 電池組; part 航電 : 飛行電腦; interface 供電 : 電源介面 connect 電池.pwr to 航電.pwr; }
    /* 介面種類：機械、熱、電、流體、資料、人 */
    enum def InterfaceKind { enum mechanical; enum thermal; enum electrical; enum fluid; enum data; enum human; }
    /* 連接埠：具體的連接埠特化它，帶它要管的物理量 */
    port def InterfacePort;
    /* 介面：兩端各一個連接埠。具體的介面特化它，兩端依序重定義 endA、endB。
       負責人是兩端次系統的負責人，變更要兩人都同意才定案（同意紀錄在專案的 interfaces.json）。
       驗證欄位和 P1 的需求屬性同名：驗證方法用標準的 @VerificationMethod，理由用 @Rationale（ModelingMetadata），
       驗證負責人 verificationLead、驗證層級 verificationLevel（system／subsystem／component）。 */
    abstract interface def Interface {
        end port endA : InterfacePort;
        end port endB : InterfacePort;
        attribute interfaceKind : InterfaceKind;
        /* 成熟度：存在（MDR）、暫定（PDR）、凍結（CDR） */
        attribute maturity : String[0..1];
        attribute ownerA : String[0..1];
        attribute ownerB : String[0..1];
        attribute verificationLead : String[0..1];
        /* system／subsystem／component */
        attribute verificationLevel : String[0..1];
    }
    /* 外部提供的次系統：只管介面，規格是給定值；收到時要檢查並確認適用於這次的用途與環境（SE Handbook 5.1.1.2.2）。
       用法：#given part def 官方推進 :> Subsystem { ... } */
    metadata def <given> GivenSpec {
        attribute supplier : String[0..1];
    }
    // [/P4]
    // [P5 FMEA、風險與圖表]
    /* FMEA 的失效模式（METHOD.md 7.1）：一列是「次系統 × 功能」的一種潛在失效，名稱就是失效模式。
       格式照台灣盃火箭競賽附件 12：O、S、D 為 1–10，RPN = O × S × D；矯正後的 O、S、D 另記。
       S、D 沒填時工具給建議值（見 web/src/method/p5/core.ts），填了以人填的為準。
       連結（都用 #trace dependency）：
         失效模式 → 功能、失效模式 → 次系統（或元件）：這一列屬於哪個分配
         風險 → 需求：風險威脅的需求；風險 → 其他元素：風險掛在哪個層級；風險 → 失效模式：風險的來源
         需求 → 風險：因緩解這個風險而產生的需求；驗證事件 → 風險或失效模式：追加的驗證 */
    item def FailureMode {
        attribute effect : String;
        attribute cause : String;
        attribute control : String;
        attribute occurrenceRating : Integer;
        attribute severity : Integer;
        attribute detection : Integer;
        attribute correctiveAction : String;
        attribute owner : String;
        attribute due : String;
        attribute done : String;
        attribute occurrenceAfter : Integer;
        attribute severityAfter : Integer;
        attribute detectionAfter : Integer;
    }
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
