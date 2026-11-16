/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package MissionRequirementsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import CapabilitiesPackage::*;

    requirement def <'HLR-R001'> ReachTargetAltitude {
        doc /* 飛行器應到達目標遠地點高度。 */
        attribute apogee :> ISQ::length;
        attribute targetApogee :> ISQ::length = 1000 [m];
        require constraint { apogee >= targetApogee }
        #refinement dependency 'HLR-R001' to CapabilitiesPackage::SuborbitalLaunch;
    }

    #moe requirement def <'MOE-001'> ApogeeDeviation {
        doc /* 實際遠地點與目標高度的偏差。 */
        attribute deviation :> ISQ::length;
        attribute maxDeviation :> ISQ::length = 100 [m];
        require constraint { deviation <= maxDeviation }
        #refinement dependency 'MOE-001' to 'HLR-R001';
    }
}
