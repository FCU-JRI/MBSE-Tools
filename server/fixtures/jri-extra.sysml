/* 合成的 JRI 模型：補上範本沒有用到的類別與關係，給前後比對的測試用。數值都是假的。 */
package Project {
    private import ScalarValues::*;
    private import JRI::*;

    package Stakeholders {
        part <'STK-901'> '合成審查員' : Stakeholder { :>> role = "審查"; }
        requirement <'EXP-901'> '合成期望' : Expectation {
            doc /* 合成的期望。 */
            subject;
            stakeholder :> Project::Stakeholders::'合成審查員';
        }
        package '子套件' {
            part <'STK-902'> '合成操作員' : Stakeholder;
        }
    }

    package NGOs {
        requirement <'NEED-901'> '合成需要' : Need { doc /* 合成的需要。 */ }
        requirement <'OBJ-901'> '合成目的' : Objective;
        requirement <'MOE-901'> '合成量度' : MOE;
        #trace dependency from '合成需要' to Stakeholders::'合成期望';
        #refinement dependency from '合成量度' to '合成目的';
    }

    package Requirements {
        requirement <'REQ-SYS-901'> '合成系統需求' : SystemRequirement { doc /* 系統應做到合成的事。 */ }
        requirement <'REQ-SUB-901'> '合成次系統需求' : SubsystemRequirement;
        requirement <'REQ-SUB-902'> '合成次系統需求二' : SubsystemRequirement;
        #derivation connection { end #derive ::> '合成系統需求'; end #original ::> NGOs::'合成目的'; }
        #derivation connection { end #derive ::> '合成次系統需求'; end #derive ::> '合成次系統需求二'; end #original ::> '合成系統需求'; }
    }

    package Structure {
        part def <'SYS-901'> '合成系統' :> System {
            part a : '合成次系統甲';
            part b : '合成次系統乙';
            connect a to b;
        }
        part def <'SUB-901'> '合成次系統甲' :> Subsystem {
            #tpm attribute load : Real;
        }
        part def <'SUB-902'> '合成次系統乙' :> Subsystem;
        part def <'EXT-901'> '合成外部對象' :> ExternalEntity;
        part unit : '合成系統';
        satisfy Requirements::'合成系統需求' by unit;
    }

    package Behavior {
        action <'FN-901'> '合成功能' : Function;
        action <'FN-902'> '合成功能二' : Function;
        allocate '合成功能' to Structure::unit.a;
    }

    package UseCases {
        use case <'UC-901'> '合成使用案例' : UseCase {
            subject;
            actor :> Project::Stakeholders::'合成審查員';
            include '合成子案例';
        }
        use case <'UC-902'> '合成子案例' : UseCase;
    }

    package Risks {
        item <'RISK-901'> '合成風險' : Risk { :>> severity = 3; :>> likelihood = 2; :>> mitigation = "合成的緩解"; }
    }

    package Operations {
        item <'SOP-901'> '合成程序' : SOP { :>> documentRef = "DOC-0000"; }
    }

    comment '合成註解' about Requirements::'合成系統需求' /* 這是合成的註解。 */
}
