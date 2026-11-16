/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package OperationsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import StakeholderPackage::*;
    private import ContextPackage::*;

    action def IgniteMotor :> Operation {
        doc /* 發射團隊在發射架上點燃馬達。 */
        ref part launchTeam :> StakeholderPackage::launchTeam;
        ref part launchRail : ContextPackage::LaunchRail;
    }
}
