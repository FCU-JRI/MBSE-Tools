/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package TechnicalComponentsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import TechnicalPortsPackage::*;

    part def DemoMotor :> HardwareComponent {
        doc /* 示範用的固態馬達，數值是合成的。 */
        attribute :>> mass = 2 [kg];
        attribute totalImpulse :> ISQ::force;
    }

    part def DemoVehicle :> HardwareComponent {
        doc /* 示範用的飛行器。 */
        attribute :>> mass = 10 [kg];
        part motor : DemoMotor;
        port data : DataPort;
    }
}
