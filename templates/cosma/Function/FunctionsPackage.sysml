/* CoSMA 範本（第 C 期，F-86）：套件結構照 Airbus Apollo 11 參考模型，內容是合成的示範，不是真實設計參數。 */
package FunctionsPackage {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import ModelingMetadata::*;
    private import CoSMAPackage::*;
    private import JRIAddonPackage::*;
    private import OperationsPackage::*;

    item def VehicleStatus { doc /* 飛行器的狀態。 */ }

    action def ProvideThrust :> Function {
        in currentStatus : VehicleStatus;
        out boostedStatus : VehicleStatus;
        doc /* 提供把飛行器推離發射架的推力。 */
        #refinement dependency ProvideThrust to OperationsPackage::IgniteMotor;
    }
}
