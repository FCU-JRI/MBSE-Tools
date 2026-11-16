/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package CapabilitiesPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import StakeholderNeedsPackage::*;

    part def SuborbitalLaunch :> Capability {
        doc /* 把飛行器安全送到目標高度的能力。 */
        #refinement dependency SuborbitalLaunch to 'SHN-N001';
    }
}
