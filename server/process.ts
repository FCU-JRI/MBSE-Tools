// 分析流程：依 NASA-HDBK-1009A 第 8 章的順序，從利害關係人開始逐步拆解。
// 每一步都有「要回答的問題」與「完成條件」；前一步沒完成，後面的步驟不開放。
// 同一份定義供網頁的引導流程、伺服器的順序檢查與給 AI 的 skill 使用。
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";
import { CATEGORIES } from "./metamodel.ts";

export interface StepDef {
  id: string;
  zh: string;
  nasa: string; // 手冊章節
  question: string; // 引導使用者回答的問題
  why: string; // 為什麼這一步在這裡
  categories: string[]; // 這一步建立哪些類別
  /** 新項目必須連到上一層的哪些類別，用哪種關係。direction: out＝新項目指向上層。 */
  link?: { kind: string; to: string[]; zh: string; direction: "out" | "in" };
  parent?: string; // 需要放在某個上層元素內（任務階段、狀態）
  example: string;
  /** 指南「要做什麼」：一句白話。 */
  todo: string;
  /** 指南「怎麼做」：照著點就會的步驟，寫新介面的位置（模型頁左欄類別、右欄新增與關係、圖上工具）。 */
  how: string[];
}

export const STEPS: StepDef[] = [
  { id: "stakeholders", zh: "利害關係人", nasa: "8.1", categories: ["Stakeholder"], question: "誰會影響這個專案，或被這個專案影響？",
    why: "一切從人開始。先知道為誰而做，後面的每一條需求才有根據。", example: "競賽主辦方、指導老師、場地管理單位、團隊自己",
    todo: "列出所有會影響這個專案、或被它影響的人或單位。",
    how: ["按下面「到模型頁做這一步」，右欄會打開「利害關係人」的新增表單；也可以在模型頁左欄「模型元素 › 需求」點「利害關係人」。", "填名稱（例如：競賽主辦方），在「角色與關注點」寫他在意什麼，按「新增」。", "每一位都新增一次；回到流程頁，這一步會打勾。"] },
  { id: "expectations", zh: "期望", nasa: "8.1", categories: ["Expectation"], question: "每一位利害關係人，希望看到什麼結果？",
    why: "用他們的話寫下來，不必是工程語言。每一項期望都要說得出是誰提的。", link: { kind: "trace", to: ["Stakeholder"], zh: "是誰的期望", direction: "out" },
    example: "火箭的發射與回收全程不得危及人員與場地。",
    todo: "替每一位利害關係人寫下他希望看到的結果，並標明是誰提的。",
    how: ["按「到模型頁做這一步」打開「期望」新增表單，用對方的話寫內容，按「新增」。", "新增完右欄會選到這項期望；在右欄「關係」選「追溯到」，對象選提出它的利害關係人，按「加入關係」。", "每一位利害關係人都至少要有一項期望。"] },
  { id: "needs", zh: "需要", nasa: "8.2", categories: ["Need"], question: "綜合這些期望，這個專案到底要解決什麼問題？",
    why: "把分散的期望收斂成一兩句話，這是專案存在的理由。", link: { kind: "trace", to: ["Expectation"], zh: "回應哪一項期望", direction: "out" },
    example: "團隊需要一枚能把酬載送到目標高度並安全回收的探空火箭。",
    todo: "把所有期望收斂成一兩句話：這個專案要解決什麼問題。",
    how: ["按「到模型頁做這一步」打開「需要」新增表單，寫一兩句話，按「新增」。", "在右欄「關係」選「追溯到」，對象選它回應的期望，按「加入關係」。"] },
  { id: "goals", zh: "目標", nasa: "8.2", categories: ["Goal"], question: "為了滿足這個需要，專案想達成哪些方向？",
    why: "目標是方向，可以是定性的。每個目標都從某個需要推導出來。", link: { kind: "derive", to: ["Need"], zh: "從哪個需要推導", direction: "out" },
    example: "於本年度完成一次成功的飛行測試。",
    todo: "替每一項需要訂出專案想達成的方向。",
    how: ["按「到模型頁做這一步」打開「目標」新增表單，寫方向（可以是定性的），按「新增」。", "在右欄「關係」選「衍生自」，對象選它來自的需要，按「加入關係」。", "每一項需要都至少要有一個目標。"] },
  { id: "objectives", zh: "目的", nasa: "8.2", categories: ["Objective"], question: "每個目標，要達到什麼可以衡量的具體結果才算成功？",
    why: "把方向變成量得出來的結果，後面的需求才能驗證。", link: { kind: "derive", to: ["Goal"], zh: "從哪個目標推導", direction: "out" },
    example: "火箭遠地點高度達到 3000 m。",
    todo: "把每個目標變成量得出來的成功結果。",
    how: ["按「到模型頁做這一步」打開「目的」新增表單，寫一個有數字的結果，按「新增」。", "在右欄「關係」選「衍生自」，對象選它來自的目標，按「加入關係」。", "每個目標都至少要有一個目的。"] },
  { id: "moes", zh: "效能量度", nasa: "8.12", categories: ["MOE"], question: "每個目的，用什麼指標衡量做得好不好？",
    why: "效能量度是從任務角度看的成敗指標，之後系統需求會對著它寫。", link: { kind: "refine", to: ["Objective"], zh: "衡量哪個目的", direction: "out" },
    example: "實際遠地點與目標高度的偏差百分比。",
    todo: "替每個目的訂一個衡量做得好不好的指標。",
    how: ["按「到模型頁做這一步」打開「效能量度」新增表單（左欄在「參數」底下），按「新增」。", "在右欄「關係」選「細化」，對象選它衡量的目的，按「加入關係」。", "每個目的都至少要有一項效能量度。"] },
  { id: "context", zh: "系統脈絡", nasa: "8.3–8.4", categories: ["System", "ExternalEntity"], question: "我們要做的系統是什麼？它會和外界哪些東西互動？",
    why: "先畫出系統的邊界：哪些歸我們做，哪些是外部條件。", example: "系統：探空火箭。外部：發射架、地面站、大氣環境。",
    todo: "寫下「我們要做的系統」和「會跟它互動的外界東西」。",
    how: ["按「到模型頁做這一步」打開「系統」新增表單，名稱填火箭，按「新增」。", "再到左欄「模型元素 › 結構」點「外部對象」，把發射架、地面站、大氣各新增一個。", "回到流程頁，這一步會打勾。"] },
  { id: "usecases", zh: "使用案例", nasa: "8.5", categories: ["UseCase"], question: "利害關係人會怎麼使用這個系統？",
    why: "從使用者的角度描述系統要做的事，是功能的來源。", link: { kind: "trace", to: ["Stakeholder"], zh: "誰參與", direction: "out" },
    example: "發射團隊執行發射程序；回收團隊尋回火箭。",
    todo: "從使用者的角度，寫下他們會怎麼使用這個系統。",
    how: ["按「到模型頁做這一步」打開「使用案例」新增表單（左欄在「行為」底下），按「新增」。", "在右欄「關係」選「追溯到」，對象選參與的利害關係人，按「加入關係」。也可以在圖「使用案例」上用連線工具從使用案例拉到利害關係人。"] },
  { id: "phases", zh: "任務階段", nasa: "8.6", categories: ["MissionPhase"], question: "任務從開始到結束，依序經過哪些階段？",
    why: "把使用案例展開成時間順序，才知道每個階段系統要做什麼。先建立一個總任務，再在它裡面加入各階段。", parent: "MissionPhase",
    example: "發射 → 動力飛行 → 滑行 → 開傘 → 回收",
    todo: "把任務從開始到結束，依先後排成幾個階段。",
    how: ["按「到模型頁做這一步」打開「任務階段」新增表單；第一個建立的是總任務（例如：飛行任務）。", "再按一次「到模型頁做這一步」，表單會寫「會加在『總任務』之內」，依序新增各階段（發射、動力飛行……）。", "左欄「圖 › 活動圖」會出現總任務的圖；用圖上的連線工具「先後」依順序把階段連起來。"] },
  { id: "sysreqs", zh: "系統層需求", nasa: "8.10–8.11", categories: ["SystemRequirement"], question: "為了達成每個目的與效能量度，整個系統「應」做到什麼？",
    why: "現在才寫需求：每一條都要追溯到目的或效能量度，否則就是沒有根據的需求。", link: { kind: "derive", to: ["Objective", "MOE"], zh: "從哪個目的或量度推導", direction: "out" },
    example: "火箭應到達 3000 m ± 150 m 的遠地點高度。",
    todo: "為每個目的與效能量度，寫出整個系統「應」做到什麼。",
    how: ["按「到模型頁做這一步」打開「系統層需求」新增表單，內容用「應」字、一條只寫一件事，按「新增」。", "在右欄「關係」選「衍生自」，對象選它來自的目的或效能量度，按「加入關係」；有文件出處的可以在新增時填「出處」。", "每個目的（或細化它的效能量度）都至少要有一條系統層需求。"] },
  { id: "structure", zh: "結構分解", nasa: "8.7–8.8", categories: ["Subsystem", "Component"], question: "系統由哪些次系統組成？",
    why: "有了系統需求，才決定怎麼把系統拆開來分工。", link: { kind: "compose", to: ["System", "Subsystem"], zh: "屬於哪個上層", direction: "in" },
    example: "推進、航電、回收、結構",
    todo: "決定系統由哪些次系統組成。",
    how: ["按「到模型頁做這一步」打開「次系統」新增表單，名稱填推進、航電等，按「新增」。", "到左欄「圖 › 一般檢視 › 結構分解」，用圖上的連線工具「組成」從系統拉線到每個次系統。"] },
  { id: "functions", zh: "功能分解與分配", nasa: "8.9", categories: ["Function"], question: "每個階段系統要執行哪些功能？由哪個次系統負責？",
    why: "把要做的事分配給剛拆出來的次系統，每個功能都要有人負責。", link: { kind: "allocate", to: ["Subsystem", "Component", "System"], zh: "分配給誰", direction: "out" }, parent: "MissionPhase",
    example: "偵測遠地點（航電）、觸發開傘（回收）",
    todo: "列出每個階段系統要執行的功能，並交給負責的次系統。",
    how: ["按「到模型頁做這一步」打開「功能」新增表單，會加在總任務之內；也可以在活動圖上用元素工具「功能」直接畫在某個階段裡。", "在右欄「關係」選「分配給」，對象選負責的次系統，按「加入關係」。"] },
  { id: "subreqs", zh: "次系統層需求", nasa: "8.10–8.11", categories: ["SubsystemRequirement", "ComponentRequirement"], question: "每條系統層需求，要分配給各次系統哪些需求？",
    why: "需求往下流：每條次系統需求都從某條系統需求衍生，並指定由誰滿足。", link: { kind: "derive", to: ["SystemRequirement", "SubsystemRequirement"], zh: "從哪條上層需求衍生", direction: "out" },
    example: "推進次系統應提供不低於 9000 N·s 的總衝量。",
    todo: "把每條系統層需求往下分給各次系統，並指定由誰做到。",
    how: ["按「到模型頁做這一步」打開「次系統層需求」新增表單，內容用「應」字，按「新增」。", "在右欄「關係」選「衍生自」，對象選它來自的系統層需求，按「加入關係」。", "再選負責的次系統，在它的右欄「關係」選「滿足」，對象選這條需求，按「加入關係」。"] },
  { id: "mops", zh: "性能量度", nasa: "8.12–8.13", categories: ["MOP"], question: "用哪些工程指標追蹤系統性能是否達標？",
    why: "性能量度把效能量度與需求變成可以持續追蹤的工程數值（TPM）。", link: { kind: "derive", to: ["MOE", "SystemRequirement", "SubsystemRequirement"], zh: "支撐哪個量度或需求", direction: "out" },
    example: "引擎總衝量（N·s）、起飛質量（kg）",
    todo: "訂出追蹤系統性能是否達標的工程數值。",
    how: ["按「到模型頁做這一步」打開「性能量度」新增表單（左欄在「參數」底下），按「新增」。", "在右欄「關係」選「衍生自」，對象選它支撐的效能量度或需求，按「加入關係」。"] },
  { id: "risks", zh: "風險", nasa: "—", categories: ["Risk"], question: "哪些地方可能出錯？後果多嚴重？怎麼降低？",
    why: "有了結構與功能，才能逐一檢視每個部分的失效方式。這一步來自 AEAS 與 FMEA 的要求，不在 NASA-HDBK-1009A 內。",
    example: "降落傘未展開；嚴重度 5、可能性 2；雙重觸發",
    todo: "列出可能出錯的地方，評估嚴重度與可能性，寫下怎麼降低。",
    how: ["按「到模型頁做這一步」打開「風險」新增表單（左欄在「風險與安全」底下）。", "填名稱、嚴重度、可能性（1–5）與緩解措施，按「新增」。缺任何一欄這一步都不會打勾。"] },
  { id: "verification", zh: "驗證", nasa: "8.14–8.20", categories: ["VerificationEvent"], question: "每一條需求，要怎麼證明有做到？",
    why: "需求寫完才規劃驗證。每條需求至少一個驗證事件，並指定方法：測試、分析、檢查或展示。", link: { kind: "verify", to: ["SystemRequirement", "SubsystemRequirement", "ComponentRequirement"], zh: "驗證哪條需求", direction: "out" },
    example: "以飛行電腦氣壓計紀錄遠地點高度（測試）。",
    todo: "替每一條需求規劃怎麼證明有做到。",
    how: ["按「到模型頁做這一步」打開「驗證事件」新增表單（左欄在「驗證與確認」底下）。", "在「要驗證的需求」選一條需求，「方法」選測試、分析、檢查或展示，按「新增」。", "每一條系統層與次系統層需求都至少要有一個驗證事件。"] },
  { id: "validation", zh: "確認", nasa: "8.21–8.22", categories: ["ValidationEvent"], question: "最後怎麼確認做出來的系統，真的是利害關係人要的？",
    why: "驗證是「做對」，確認是「做對的東西」。回到最開始的期望來檢查。", example: "飛行後與指導老師檢視任務是否達成目的。",
    todo: "規劃最後怎麼確認做出來的系統，真的是利害關係人要的。",
    how: ["按「到模型頁做這一步」打開「確認事件」新增表單（左欄在「驗證與確認」底下），寫怎麼回頭檢查期望，按「新增」。"] },
];

export interface StepStatus {
  id: string; zh: string; nasa: string; question: string; why: string; example: string; categories: string[];
  link: StepDef["link"] | null; parent: string | null;
  state: "done" | "current" | "locked";
  count: number;
  issues: Issue[]; // 還沒完成的原因（鎖定的步驟為空）
  /** 鎖定步驟本身還缺什麼；不強制順序的專案（空白、範本）指南用它即時顯示還缺。 */
  ahead: Issue[];
  todo: string; how: string[];
}

/** 還沒完成的原因。id 是有問題的元素；count 是「數量不足」類的條件。 */
export interface Issue { id: string | null; text: string; count?: { category: string; zh: string; have: number; min: number } }

const STRUCT = new Set(["System", "Subsystem", "Component", "ExternalEntity", "DesignAlternative"]);

export function evaluateProcess(a: Analysis): StepStatus[] {
  const of = (...cats: string[]) => a.elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" && !e.shared && (STRUCT.has(e.category) ? e.kind === "PartDefinition" : /Usage$/.test(e.kind)));
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const name = (e: Element) => (e.shortName ? `${e.shortName} ${e.name}` : e.name);
  const outTo = (e: Element, kinds: string[], cats: string[]) => a.relations.some((r) => r.from === e.id && kinds.includes(r.kind) && cats.includes(byId.get(r.to)?.category ?? ""));
  const inFrom = (e: Element, kinds: string[], cats: string[]) => a.relations.some((r) => r.to === e.id && kinds.includes(r.kind) && cats.includes(byId.get(r.from)?.category ?? ""));
  const LOOSE = ["trace", "derive", "refine"];

  // 數量不足的條件附上 count，指南的「還缺」顯示成「外部對象 0 個（至少 1 個）」
  const atLeast = (category: string, min: number, text: string): Issue[] => {
    const have = of(category).length;
    return have < min ? [{ id: null, text, count: { category, zh: CATEGORIES.find((c) => c.id === category)?.zh ?? category, have, min } }] : [];
  };

  const check: Record<string, () => Issue[]> = {
    stakeholders: () => atLeast("Stakeholder", 1, "至少列出一位利害關係人。"),
    expectations: () => [
      ...of("Stakeholder").filter((s) => !inFrom(s, LOOSE, ["Expectation"])).map((s) => ({ id: s.id, text: `${name(s)} 還沒有任何期望。` })),
      ...of("Expectation").filter((e) => !outTo(e, LOOSE, ["Stakeholder"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有指出是誰的期望。` })),
    ],
    needs: () => [
      ...atLeast("Need", 1, "至少寫出一項需要。"),
      ...of("Need").filter((e) => !outTo(e, LOOSE, ["Expectation"]) && !e.attrs.sourceDoc).map((e) => ({ id: e.id, text: `${name(e)} 沒有對應到任何期望。` })),
    ],
    goals: () => [
      ...of("Need").filter((n) => !inFrom(n, LOOSE, ["Goal"])).map((n) => ({ id: n.id, text: `需要「${n.name}」還沒有目標。` })),
      ...of("Goal").filter((e) => !outTo(e, LOOSE, ["Need"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有對應的需要。` })),
    ],
    objectives: () => [
      ...of("Goal").filter((g) => !inFrom(g, LOOSE, ["Objective"])).map((g) => ({ id: g.id, text: `目標「${g.name}」還沒有目的。` })),
      ...of("Objective").filter((e) => !outTo(e, LOOSE, ["Goal"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有對應的目標。` })),
    ],
    moes: () => [
      ...of("Objective").filter((o) => !inFrom(o, LOOSE, ["MOE"])).map((o) => ({ id: o.id, text: `目的「${o.name}」還沒有效能量度。` })),
      ...of("MOE").filter((e) => !outTo(e, LOOSE, ["Objective"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有對應的目的。` })),
    ],
    context: () => [
      ...atLeast("System", 1, "定義要開發的系統。"),
      ...atLeast("ExternalEntity", 1, "至少列出一個與系統互動的外部對象。"),
    ],
    usecases: () => [
      ...atLeast("UseCase", 1, "至少寫出一個使用案例。"),
      ...of("UseCase").filter((e) => !outTo(e, LOOSE, ["Stakeholder"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有指出誰參與。` })),
    ],
    phases: () => {
      const phases = of("MissionPhase");
      const kids = phases.filter((p) => byId.get(p.owner ?? "")?.category === "MissionPhase");
      const seq = a.relations.filter((r) => r.kind === "succession").length;
      return [
        ...(phases.length === 0 ? [{ id: null, text: "先建立一個總任務。", count: { category: "MissionPhase", zh: "總任務", have: 0, min: 1 } }]
          : kids.length < 2 ? [{ id: null, text: "在總任務裡加入至少兩個階段。", count: { category: "MissionPhase", zh: "總任務裡的階段", have: kids.length, min: 2 } }] : []),
        ...(kids.length >= 2 && seq < kids.length - 1 ? [{ id: null, text: "到活動圖把各階段依先後順序連起來。" }] : []),
      ];
    },
    sysreqs: () => [
      // 目的被涵蓋：有系統層需求直接衍生自它，或衍生自細化它的效能量度
      ...of("Objective").filter((o) => {
        const moes = of("MOE").filter((m) => a.relations.some((r) => r.from === m.id && r.to === o.id && LOOSE.includes(r.kind)));
        return !inFrom(o, LOOSE, ["SystemRequirement"]) && !moes.some((m) => inFrom(m, LOOSE, ["SystemRequirement"]));
      }).map((o) => ({ id: o.id, text: `目的「${o.name}」還沒有任何系統層需求。` })),
      ...of("SystemRequirement").filter((e) => !outTo(e, LOOSE, ["Objective", "MOE"]) && !e.attrs.sourceDoc).map((e) => ({ id: e.id, text: `${name(e)} 沒有來源（目的、效能量度或文件出處）。` })),
    ],
    structure: () => {
      const subs = of("Subsystem");
      const composed = (s: Element) => a.elements.some((u) => u.kind === "PartUsage" && u.typeIds.includes(s.id) && byId.get(u.owner ?? "")?.kind === "PartDefinition");
      return [
        ...atLeast("Subsystem", 1, "至少拆出一個次系統。"),
        ...subs.filter((s) => !composed(s)).map((s) => ({ id: s.id, text: `${s.name} 還沒有放進系統的結構（到結構分解圖從系統拉線到它）。` })),
      ];
    },
    functions: () => [
      ...atLeast("Function", 1, "至少定義一個功能。"),
      ...of("Function").filter((e) => !outTo(e, ["allocate"], ["Subsystem", "Component", "System"])).map((e) => ({ id: e.id, text: `${name(e)} 還沒有分配給次系統。` })),
    ],
    subreqs: () => [
      ...atLeast("SubsystemRequirement", 1, "至少寫出一條次系統層需求。"),
      ...of("SubsystemRequirement", "ComponentRequirement").filter((e) => !outTo(e, ["derive"], ["SystemRequirement", "SubsystemRequirement"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有從上層需求衍生。` })),
      ...of("SubsystemRequirement", "ComponentRequirement").filter((e) => !a.relations.some((r) => r.kind === "satisfy" && r.to === e.id)).map((e) => ({ id: e.id, text: `${name(e)} 還沒有指定由誰滿足。` })),
    ],
    mops: () => (of("MOP").length < 1 ? atLeast("MOP", 1, "至少定義一項性能量度。") : of("MOP").filter((e) => !outTo(e, LOOSE, ["MOE", "SystemRequirement", "SubsystemRequirement", "MOP"])).map((e) => ({ id: e.id, text: `${name(e)} 沒有支撐任何量度或需求。` }))),
    risks: () => [
      ...atLeast("Risk", 1, "至少評估一項風險。"),
      ...of("Risk").filter((e) => !(Number(e.attrs.severity) && Number(e.attrs.likelihood) && (e.attrs.mitigation ?? "").trim())).map((e) => ({ id: e.id, text: `${name(e)} 還缺嚴重度、可能性或緩解措施。` })),
    ],
    verification: () => [
      ...of("SystemRequirement", "SubsystemRequirement", "ComponentRequirement").filter((e) => !a.relations.some((r) => r.kind === "verify" && r.to === e.id)).map((e) => ({ id: e.id, text: `${name(e)} 還沒有驗證事件。` })),
      ...of("VerificationEvent").filter((e) => !e.attrs.kind).map((e) => ({ id: e.id, text: `${name(e)} 沒有指定驗證方法。` })),
    ],
    validation: () => atLeast("ValidationEvent", 1, "至少規劃一個確認事件。"),
  };

  let open = true;
  return STEPS.map((s) => {
    const issues = check[s.id]();
    const done = issues.length === 0;
    const state: StepStatus["state"] = !open ? "locked" : done ? "done" : "current";
    if (!done) open = false;
    return { id: s.id, zh: s.zh, nasa: s.nasa, question: s.question, why: s.why, example: s.example, categories: s.categories, link: s.link ?? null, parent: s.parent ?? null, todo: s.todo, how: s.how, state, count: of(...s.categories).length, issues: state === "locked" ? [] : issues.slice(0, 12), ahead: state === "locked" ? issues.slice(0, 12) : [] };
  });
}

/** 某個類別屬於哪一步；流程專案用來擋掉跳步驟的新增。 */
export function stepOfCategory(category: string): StepDef | undefined {
  return STEPS.find((s) => s.categories.includes(category));
}
