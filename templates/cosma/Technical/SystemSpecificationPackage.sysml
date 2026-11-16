/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package SystemSpecificationPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import TechnicalRequirementsPackage::*;
    private import SystemPackage::*;

    requirement demoSystemSpecification {
        doc /* 示範任務系統包含的技術需求。 */
        subject demoMissionSystem : DemoMissionSystem;
        requirement 'clr-R001' : MotorImpulseRequirement;
        satisfy 'clr-R001' by demoMissionSystem.vehicle;
    }
}
