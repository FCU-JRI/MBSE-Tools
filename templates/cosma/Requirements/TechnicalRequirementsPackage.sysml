/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package TechnicalRequirementsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import FunctionalRequirementsPackage::*;

    requirement def <'CLR-R001'> MotorImpulseRequirement {
        doc /* 馬達應提供不低於規定值的總衝量。 */
        #refinement dependency 'CLR-R001' to FunctionalRequirementsPackage::'FLR-R001';
    }

    #mop requirement def <'MOP-001'> MotorTotalImpulse {
        doc /* 馬達的總衝量。 */
        attribute impulse :> ISQ::force;
        attribute minImpulse :> ISQ::force = 500 [N];
        require constraint { impulse >= minImpulse }
        #refinement dependency 'MOP-001' to 'CLR-R001';
    }
}
