/* P5（FMEA、風險）測試用的合成模型。名稱與數值都是假的，不是任何真實設計。 */
package Project {
    private import ScalarValues::*;
    private import JRI::*;

    package Stakeholders {
        requirement <'EXP-801'> '甲方期望' : Expectation { doc /* 合成的期望。 */ }
    }

    package NGOs {
        requirement <'OBJ-801'> '目的甲' : Objective;
        requirement <'OBJ-802'> '目的乙' : Objective;
        requirement <'MOE-801'> '量度乙' : MOE;
        #refinement dependency from '量度乙' to '目的乙';
    }

    package Requirements {
        requirement <'REQ-SYS-801'> '需求甲' : SystemRequirement { doc /* 合成的系統需求甲。 */ }
        requirement <'REQ-SYS-802'> '安全需求' : SystemRequirement { doc /* 合成的安全需求：不得危及人員。 */ }
        requirement <'REQ-SYS-803'> '需求乙' : SystemRequirement;
        requirement <'REQ-SUB-801'> '子需求甲' : SubsystemRequirement;
        #derivation connection { end #derive ::> '需求甲'; end #original ::> NGOs::'目的甲'; }
        #derivation connection { end #derive ::> '需求乙'; end #original ::> NGOs::'量度乙'; }
        #derivation connection { end #derive ::> '子需求甲'; end #original ::> '需求甲'; }
    }

    package Structure {
        part def <'SYS-801'> '合成箭' :> System {
            part p : '次系統丙';
            part q : '次系統丁';
            connect p to q;
        }
        part def <'SUB-801'> '次系統丙' :> Subsystem {
            part c1 : '元件戊';
        }
        part def <'SUB-802'> '次系統丁' :> Subsystem;
        part def <'CMP-801'> '元件戊' :> Component;
        part ship : '合成箭';
    }

    package Behavior {
        action <'FN-801'> '功能一' : Function;
        action <'FN-802'> '功能二' : Function;
        action <'FN-803'> '功能三' : Function;
        allocate '功能一' to Structure::ship.p;
        allocate '功能二' to Structure::ship.q;
        allocate '功能三' to Structure::ship.p;
    }
    #trace dependency from Requirements::'需求甲' to Behavior::'功能一';
    #trace dependency from Requirements::'安全需求' to Behavior::'功能二';
    #trace dependency from Requirements::'需求乙' to Behavior::'功能三';

    package Verification {
        verification <'VER-801'> '地面測試甲' : VerificationEvent {
            objective { verify Requirements::'子需求甲'; }
            @VerificationMethod { kind = VerificationMethodKind::test; }
        }
        verification <'VER-802'> '飛行中遙測' : VerificationEvent {
            doc /* 以遙測下傳確認。 */
            objective { verify Requirements::'安全需求'; }
            @VerificationMethod { kind = VerificationMethodKind::analyze; }
        }
    }

    package FMEA {
        item <'FM-801'> '失效一' : FailureMode {
            :>> occurrenceRating = 3;
            :>> severity = 9;
        }
        item <'FM-802'> '失效二' : FailureMode {
            :>> occurrenceRating = 2;
            :>> correctiveAction = "合成的矯正";
            :>> done = "是";
            :>> occurrenceAfter = 1;
            :>> severityAfter = 6;
            :>> detectionAfter = 5;
        }
    }
    #trace dependency from FMEA::'失效一' to Behavior::'功能一';
    #trace dependency from FMEA::'失效一' to Structure::'次系統丙';
    #trace dependency from FMEA::'失效二' to Behavior::'功能二';
    #trace dependency from FMEA::'失效二' to Structure::'次系統丁';

    package Risks {
        item <'RISK-801'> '風險一' : Risk { :>> severity = 4; :>> likelihood = 4; :>> residualLikelihood = 2; :>> source = "FMEA"; }
        item <'RISK-802'> '風險二' : Risk { :>> severity = 2; :>> likelihood = 1; }
    }
    #trace dependency from Risks::'風險一' to Requirements::'需求甲';
    #trace dependency from Risks::'風險一' to Structure::'次系統丙';
    #trace dependency from Risks::'風險一' to FMEA::'失效一';
    #trace dependency from Requirements::'需求乙' to Risks::'風險一';
    #trace dependency from Verification::'地面測試甲' to Risks::'風險一';
}
