/* JRI 附加庫（第 C 期 F-87；第 D 期 F-90）
 * CoSMA 沒有、JRI 審查需要的東西。只有 CoSMA 專案載入（和 library/cosma/ 同一個條件），不出現在五層裡，另成一區。
 * 還沒轉換的專案（包括 rtc-2027）繼續用 library/JRI.sysml，那個檔不改；第 E 期轉換完才退場。
 *
 * MOE、MOP 的寫法（Mars 決定，2026-11-16）：各是一條獨立的需求定義，標上 #moe 或 #mop，
 * 用 #refinement dependency 細化到它量測的任務需求（MOE）或技術需求（MOP）；
 * 可量化的部分在這條需求定義裡寫屬性加 require constraint。
 *
 * 和 JRI.sysml 同名的定義（TPM、Source、VerificationEvent、Risk……）：一個套件只匯入其中一個庫。
 * 兩個都匯入時，#tpm、@Source 等名稱會有兩個來源，工具會回報並請改成只匯入 JRIAddonPackage（F-90）。
 */
library package JRIAddonPackage {
    private import ScalarValues::*;

    /** 效能量度：從任務角度衡量「做得好不好」，細化一條任務需求。 */
    metadata def <moe> MeasureOfEffectiveness;
    /** 性能量度：從工程角度衡量系統性能，細化一條技術需求。 */
    metadata def <mop> MeasureOfPerformance;

    /** 技術性能量度：標記在技術元件的值屬性上，表示這個屬性要被追蹤（CoSMA 用屬性表示性能參數，但沒有這個標記）。 */
    metadata def <tpm> TPM {
        attribute target : String[0..1];
        attribute status : String[0..1];
    }

    /** 出處：這個項目來自哪一份文件的哪一節。文件清單在專案的 pm.json（docs）。
        用法：@Source { sourceDoc = "DOC-001"; sourceRef = "3.2"; } */
    metadata def Source {
        attribute sourceDoc : String;
        attribute sourceRef : String[0..1];
    }

    // ───────── 驗證與確認：驗證的對象是 CoSMA 的需求定義 ─────────

    /** 驗證事件：以 verification 使用，並在 objective 中 verify 需求 */
    verification def VerificationEvent;
    /** 確認事件 */
    verification def ValidationEvent;
    // 驗證方法用標準庫的 VerificationMethod，值是 test、analyze、inspect、demo：
    //   @VerificationMethod { kind = VerificationMethodKind::test; }
    public import VerificationCases::VerificationMethod;
    public import VerificationCases::VerificationMethodKind;

    // ───────── 風險與安全：掛在技術元件或邏輯元件上 ─────────

    /** 風險（FMEA）：嚴重度與可能性皆為 1–5 */
    item def Risk {
        attribute failureMode : String;
        attribute effect : String;
        attribute cause : String;
        attribute severity : Integer;
        attribute likelihood : Integer;
        attribute mitigation : String;
        attribute owner : String;
        /** 偵測度 1–5：越難在出事前發現，分數越高 */
        attribute detection : Integer;
        /** 緩解後的嚴重度與可能性 */
        attribute residualSeverity : Integer;
        attribute residualLikelihood : Integer;
        attribute status : String;
    }

    /** 安全係數 Factor of Safety */
    item def SafetyFactor {
        attribute required : Real;
        attribute actual : Real;
        attribute basis : String;
    }

    // ───────── 作業與品質 ─────────

    /** 標準作業程序 */
    item def SOP {
        attribute documentRef : String;
        attribute revision : String;
    }

    /** 測試或飛行名冊中的一員 */
    item def RosterEntry {
        attribute person : String;
        attribute duty : String;
        attribute rank : String;
    }

    /** 異常報告與矯正措施 */
    item def Anomaly {
        attribute observed : String;
        attribute rootCause : String;
        attribute severity : Integer;
        attribute correction : String;
        attribute prevention : String;
        attribute status : String;
    }

    /** 加工 QC 紀錄（AEAS 6.2.3.2 的簽核順序） */
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
