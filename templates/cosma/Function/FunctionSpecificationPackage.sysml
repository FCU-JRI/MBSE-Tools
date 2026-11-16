/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package FunctionSpecificationPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import FunctionalRequirementsPackage::*;
    private import FunctionsPackage::*;

    requirement demoFunctionSpecification {
        doc /* 示範任務的功能需求。 */
        subject provideThrust : ProvideThrust;
        requirement 'flr-R001' : ThrustRequirement;
        satisfy 'flr-R001' by provideThrust;
    }
}
