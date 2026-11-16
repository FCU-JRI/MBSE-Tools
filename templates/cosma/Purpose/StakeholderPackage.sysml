/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package StakeholderPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import StakeholderNeedsPackage::*;

    part def Organizer :> Stakeholder;

    part competitionOrganizer : Organizer {
        doc /* 示範用的利害關係人。 */
        item safety : Concern :> concerns {
            doc /* 發射與回收全程不得危及人員與場地。 */
        }
        requirement safeOperations : SafeOperations :> needs;
    }

    part launchTeam : Stakeholder {
        doc /* 執行發射作業的團隊。 */
        item workload : Concern :> concerns {
            doc /* 發射程序要能在規定時間內完成。 */
        }
    }
}
