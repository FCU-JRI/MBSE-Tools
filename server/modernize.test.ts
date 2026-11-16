// 利害關係人與參與者改用內建寫法的轉換（F-37）。內容都是合成的。執行：npm test
import { after, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyze, shutdown } from "./engine.ts";
import { embeddable, embedStakeholders, sameRelations } from "./modernize.ts";

const lib = await fs.readFile(new URL("../library/JRI.sysml", import.meta.url), "utf8");
const parse = (model: string) => analyze([["JRI.sysml", lib], ["model.sysml", model]]);
after(() => shutdown());

const OLD = `package Project {
    private import JRI::*;
    package Stakeholders {
        part <'STK-001'> '主辦方' : Stakeholder;
        part <'STK-002'> '指導老師' : Stakeholder;
        requirement <'EXP-001'> '安全' : Expectation {
            doc /* 不得危及人員。 */
        }
        requirement <'EXP-002'> '準時' : Expectation;
        requirement <'EXP-003'> '同一行的主體' : Expectation { doc /* 主體和大括號在同一行。 */ }
        #trace dependency from '安全' to '指導老師';
        #trace dependency from '安全' to '主辦方';
        #trace dependency from '準時' to '主辦方';
        #trace dependency from '同一行的主體' to '指導老師';
    }
    package NGOs {
        requirement <'NEED-001'> '需要' : Need;
        #trace dependency from '需要' to Stakeholders::'安全';
    }
    package UseCases {
        use case <'UC-001'> '發射' : UseCase { doc /* 發射。 */ }
        use case <'UC-002'> '回收' : UseCase;
        #trace dependency from '發射' to Stakeholders::'指導老師';
    }
}
`;

test("期望與使用案例追溯到利害關係人的相依，改成內建的 stakeholder 與 actor；其他追溯不動", async () => {
  const a = await parse(OLD);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 2)));
  assert.equal(embeddable(a, ["model.sysml"]).length, 5);
  const next = embedStakeholders(new Map([["model.sysml", OLD]]), a).get("model.sysml") as string;
  const b = await parse(next);
  assert.equal(b.ok, true, JSON.stringify(b.diagnostics.slice(0, 2)) + "\n" + next);
  assert.ok(sameRelations(a, b), "關係一條不多、一條不少");

  const name = (id: string) => b.elements.find((e) => e.id === id)?.name;
  const forms = b.relations.filter((r) => r.kind === "trace").map((r) => `${name(r.from)}→${name(r.to)}:${r.form ?? "相依"}`).sort();
  assert.deepEqual(forms, ["同一行的主體→指導老師:stakeholder", "安全→主辦方:stakeholder", "安全→指導老師:stakeholder", "準時→主辦方:stakeholder", "發射→指導老師:actor", "需要→安全:相依"].sort());

  // 每個元素只補一次 subject，而且在 stakeholder／actor 前面
  assert.equal((next.match(/subject;/g) ?? []).length, 4);
  assert.match(next, /requirement <'EXP-001'> '安全' : Expectation \{\n\s+doc \/\* 不得危及人員。 \*\/\n\s+subject;\n\s+stakeholder :> Project::Stakeholders::'指導老師';\n\s+stakeholder :> Project::Stakeholders::'主辦方';\n\s+\}/);
  assert.match(next, /requirement <'EXP-002'> '準時' : Expectation \{\n\s+subject;\n\s+stakeholder :> Project::Stakeholders::'主辦方';\n\s+\}/);
  assert.match(next, /use case <'UC-001'> '發射' : UseCase \{ doc \/\* 發射。 \*\/\n\s+subject;\n\s+actor :> Project::Stakeholders::'指導老師';\n\s+\}/);
  assert.equal((next.match(/#trace dependency/g) ?? []).length, 1, "只剩需要 → 期望那一條");

  // 轉換過的不會再轉
  assert.equal(embeddable(b, ["model.sysml"]).length, 0);
  assert.equal(embedStakeholders(new Map([["model.sysml", next]]), b).size, 0);
});

test("已經有 subject 的元素不重複補；只能改專案自己的檔案", async () => {
  const model = OLD.replace("requirement <'EXP-002'> '準時' : Expectation;", "requirement <'EXP-002'> '準時' : Expectation { subject s; }");
  const a = await parse(model);
  assert.equal(a.ok, true, JSON.stringify(a.diagnostics.slice(0, 2)));
  const next = embedStakeholders(new Map([["model.sysml", model]]), a).get("model.sysml") as string;
  assert.match(next, /requirement <'EXP-002'> '準時' : Expectation \{ subject s;\n\s+stakeholder :> Project::Stakeholders::'主辦方';\n\s+\}/);
  assert.equal((await parse(next)).ok, true);
  assert.equal(embeddable(a, ["other.sysml"]).length, 0, "不在可修改清單裡的檔案不動");
});
