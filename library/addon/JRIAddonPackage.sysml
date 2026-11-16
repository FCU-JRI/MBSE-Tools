/* JRI 附加庫（第 C 期，F-87）
 * CoSMA 沒有、JRI 審查需要的標記。只有 CoSMA 專案載入（和 library/cosma/ 同一個條件）。
 * 第 D 期會把 JRI.sysml 縮減後的內容（驗證、風險、SOP、@Source、#tpm 等）併進這裡。
 *
 * MOE、MOP 的寫法（Mars 決定，2026-11-16）：各是一條獨立的需求定義，標上 #moe 或 #mop，
 * 用 #refinement dependency 細化到它量測的任務需求（MOE）或技術需求（MOP）；
 * 可量化的部分在這條需求定義裡寫屬性加 require constraint。
 */
library package JRIAddonPackage {
    /** 效能量度：從任務角度衡量「做得好不好」，細化一條任務需求。 */
    metadata def <moe> MeasureOfEffectiveness;
    /** 性能量度：從工程角度衡量系統性能，細化一條技術需求。 */
    metadata def <mop> MeasureOfPerformance;
}
