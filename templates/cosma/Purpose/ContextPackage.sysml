/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package ContextPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;

    part def LaunchRail :> System {
        doc /* 示範用的外部系統：發射架。 */
    }

    part def DemoContext :> Context {
        part launchRail : LaunchRail :> externalSystems;
    }
}
