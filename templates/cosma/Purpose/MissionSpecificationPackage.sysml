/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package MissionSpecificationPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import MissionRequirementsPackage::*;
    private import MissionPackage::*;

    requirement demoMissionSpecification {
        doc /* 示範任務包含的任務需求。 */
        subject demoMission : DemoMission;
        requirement 'hlr-R001' : ReachTargetAltitude;
    }
}
