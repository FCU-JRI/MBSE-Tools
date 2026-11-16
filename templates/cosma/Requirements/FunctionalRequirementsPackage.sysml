/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package FunctionalRequirementsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import MissionRequirementsPackage::*;

    requirement def <'FLR-R001'> ThrustRequirement {
        doc /* 推進功能應提供足以到達目標高度的推力。 */
        #refinement dependency 'FLR-R001' to MissionRequirementsPackage::'HLR-R001';
    }
}
