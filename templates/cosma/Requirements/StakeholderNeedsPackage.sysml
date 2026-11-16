/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package StakeholderNeedsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;

    requirement def <'SHN-N001'> SafeOperations :> StakeholderNeed {
        doc /* 任務應安全地完成，不危及人員與場地。 */
    }
}
