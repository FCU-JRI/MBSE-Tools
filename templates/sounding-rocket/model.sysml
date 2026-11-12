/* 探空火箭專案範本
 * 新專案由此複製。內容是示範用的最小模型，請依實際任務修改。
 */
package Project {
    private import ScalarValues::*;
    private import ISQ::*;
    private import SI::*;
    private import JRI::*;

    // ───────── 利害關係人與期望 ─────────
    package Stakeholders {
        part <'STK-001'> '競賽主辦方' : Stakeholder { :>> role = "外部審查與評分"; }
        part <'STK-002'> '指導老師' : Stakeholder { :>> role = "安全與最終核可"; }

        requirement <'EXP-001'> '安全發射與回收' : Expectation {
            doc /* 火箭的發射與回收全程不得危及人員與場地。 */
        }
        #trace dependency from '安全發射與回收' to '指導老師';
    }

    // ───────── 需要、目標、目的 ─────────
    package NGOs {
        requirement <'NEED-001'> '到達目標高度' : Need {
            doc /* 團隊需要一枚能把酬載送到目標高度並安全回收的探空火箭。 */
        }
        requirement <'GOAL-001'> '完成年度飛行任務' : Goal {
            doc /* 於本年度完成一次成功的飛行測試。 */
        }
        requirement <'OBJ-001'> '遠地點達 3000 m' : Objective {
            doc /* 火箭遠地點高度達到 3000 m。 */
        }
        #derive dependency from '完成年度飛行任務' to '到達目標高度';
        #derive dependency from '遠地點達 3000 m' to '完成年度飛行任務';

        requirement <'MOE-001'> '遠地點誤差' : MOE {
            doc /* 實際遠地點與目標高度的偏差百分比。 */
        }
        #refine dependency from '遠地點誤差' to '遠地點達 3000 m';
    }

    // ───────── 結構 ─────────
    package Structure {
        part def '火箭' :> System {
            attribute apogee : LengthValue;
            #tpm attribute dryMass : MassValue;
            part '推進' : '推進次系統';
            part '航電' : '航電次系統';
            part '回收' : '回收次系統';
        }
        part def '推進次系統' :> Subsystem {
            #tpm attribute totalImpulse : ImpulseValue;
        }
        part def '航電次系統' :> Subsystem;
        part def '回收次系統' :> Subsystem;

        part rocket : '火箭' {
            :>> apogee = 2900 [m];
            :>> dryMass = 18.5 [kg];
        }
    }

    // ───────── 行為 ─────────
    package Behavior {
        action '任務' : MissionPhase {
            action '發射' : MissionPhase;
            action '動力飛行' : MissionPhase;
            action '滑行' : MissionPhase;
            action '回收' : MissionPhase;
            first '發射' then '動力飛行';
            first '動力飛行' then '滑行';
            first '滑行' then '回收';
        }
    }

    // ───────── 需求 ─────────
    package Requirements {
        private import Structure::*;

        requirement <'REQ-SYS-001'> '遠地點高度' : SystemRequirement {
            doc /* 火箭應到達 3000 m ± 150 m 的遠地點高度。 */
            subject r : '火箭' = rocket;
            require constraint { r.apogee >= 2850 [m] and r.apogee <= 3150 [m] }
        }
        #derive dependency from '遠地點高度' to NGOs::'遠地點達 3000 m';
        satisfy '遠地點高度' by rocket;

        requirement <'REQ-PROP-001'> '總衝量' : SubsystemRequirement {
            doc /* 推進次系統應提供不低於 9000 N·s 的總衝量。 */
        }
        #derive dependency from '總衝量' to '遠地點高度';
    }

    // ───────── 驗證 ─────────
    package Verification {
        verification <'VER-001'> '飛行測試遠地點量測' : VerificationEvent {
            doc /* 以飛行電腦氣壓計紀錄遠地點高度。 */
            objective { verify Requirements::'遠地點高度'; }
            @VVMethod { kind = Method::byTest; }
        }
    }

    // ───────── AEAS 項目 ─────────
    package Risks {
        item <'RISK-001'> '降落傘未展開' : Risk {
            :>> failureMode = "降落傘未展開";
            :>> effect = "火箭高速墜落";
            :>> cause = "開傘藥量不足或航電未觸發";
            :>> severity = 5;
            :>> likelihood = 2;
            :>> mitigation = "雙重開傘觸發；地面開傘測試";
            :>> owner = "回收組";
        }
    }
}
