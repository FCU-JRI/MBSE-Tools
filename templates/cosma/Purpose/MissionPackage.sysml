/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package MissionPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import MissionPhasesPackage::*;
    private import SystemPackage::*;
    private import ContextPackage::*;

    part def DemoMission :> Mission {
        doc /* 示範用的飛行測試任務。 */
        part demoMissionSystem : DemoMissionSystem :> system;
        part demoContext : DemoContext :> context;

        requirement reachAltitude : Goal :> goals {
            doc /* 完成一次到達目標高度的飛行。 */
        }

        exhibit state demoPhases {
            state launch : LaunchPhase;
            state recovery : RecoveryPhase;
            transition first launch then recovery;
        }
    }
}
