// 框架定義（framework/jri.json）：JRI 的系統工程流程寫成資料，工具讀它執行卡點與檢查。
// 改流程改那份檔案，不改程式。這裡只負責讀檔與檢查檔案本身前後一致；接上流程頁與卡點是下一步。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FRAMEWORK_FILE = path.join(ROOT, "framework", "jri.json");

export interface Check { check: string; zh: string }
export interface Step {
  id: string; zh: string;
  produces?: string[]; metadata?: string[]; where?: string; owner?: string;
  done?: Check; decision?: boolean; holdPoint?: boolean; onNo?: string; onNoZh?: string;
  gate?: string | null; derivedFrom?: string[]; basisFrom?: string;
}
export interface Layer {
  id: string; order: number; zh: string; kind: "chain" | "loop"; subject: string; forEach?: boolean;
  steps?: Step[]; before?: Step[]; after?: Step[]; inputs?: string[];
  loopSteps?: string[]; loopProduces?: string[]; loopOwner?: string; extraMeets?: Check; outputsZh?: string;
  gate?: string | null; onGateFail?: string;
}
export interface Framework {
  version: number; name: string; source: string;
  principles: { id: string; zh: string }[];
  roles: { id: string; zh: string; defaultRank: string | null; note?: string }[];
  settings: { id: string; zh: string; type: string; default: unknown; note?: string }[];
  elementTypes: { id: string; zh?: string; status: "existing" | "planned" | "record"; sysml?: string; planned?: string; note?: string }[];
  metadata: { id: string; zh: string }[];
  designLoop: { id: string; zh: string; steps: Step[] };
  layers: Layer[];
  crossCutting: { id: string; zh: string; resolver?: string; blocks?: string; record?: string; produces?: string[] }[];
  open: string[];
}

export function loadFramework(file = FRAMEWORK_FILE): Framework {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Framework;
}

/** 這一層實際要走的所有步驟（含迴圈前、迴圈、迴圈後）。 */
export function stepsOf(f: Framework, layer: Layer): Step[] {
  if (layer.kind === "chain") return layer.steps ?? [];
  const loop = (layer.loopSteps ?? []).map((id) => f.designLoop.steps.find((s) => s.id === id)).filter((s): s is Step => !!s);
  return [...(layer.before ?? []), ...loop, ...(layer.after ?? [])];
}

export interface Known { categories: string[]; gates: string[]; ranks: string[] }

/** 檢查框架檔前後一致：引用的類別、節點、角色、步驟都存在，且「下一層需求要有兩個來源」等原則有寫進資料。回傳問題清單，空的就是沒問題。 */
export function validateFramework(f: Framework, known: Known): string[] {
  const problems: string[] = [];
  const types = new Set(f.elementTypes.map((t) => t.id));
  const roles = new Set(f.roles.map((r) => r.id));
  const meta = new Set(f.metadata.map((m) => m.id));
  const loopIds = new Set(f.designLoop.steps.map((s) => s.id));
  const gates = new Set(known.gates);
  const where = new Set(["model", "tables", "analysis", "manage", "auto"]);

  for (const t of f.elementTypes) if (t.status === "existing" && !known.categories.includes(t.id)) problems.push(`elementTypes：${t.id} 標為 existing，但元模型沒有這個類別`);
  for (const r of f.roles) if (r.defaultRank !== null && !known.ranks.includes(r.defaultRank)) problems.push(`roles：${r.id} 的 defaultRank ${r.defaultRank} 不是有效職級`);

  const checkStep = (s: Step, where_: string, owners: Set<string>) => {
    for (const p of [...(s.produces ?? []), ...(s.derivedFrom ?? [])]) if (!types.has(p)) problems.push(`${where_}：${s.id} 引用了未定義的元素類型 ${p}`);
    for (const m of s.metadata ?? []) if (!meta.has(m)) problems.push(`${where_}：${s.id} 引用了未定義的標記 ${m}`);
    if (s.owner && !owners.has(s.owner)) problems.push(`${where_}：${s.id} 的負責人 ${s.owner} 不存在`);
    if (s.where && !where.has(s.where)) problems.push(`${where_}：${s.id} 的位置 ${s.where} 不存在`);
    if (s.gate && !gates.has(s.gate)) problems.push(`${where_}：${s.id} 的節點 ${s.gate} 不存在`);
    if (!s.gate && !s.done && !s.decision && where_ !== "designLoop" && s.where !== "manage") problems.push(`${where_}：${s.id} 沒有完成條件`);
  };
  const loopOwners = new Set([...roles, "layerOwner"]);
  for (const s of f.designLoop.steps) {
    checkStep(s, "designLoop", loopOwners);
    if (s.onNo && !loopIds.has(s.onNo)) problems.push(`designLoop：${s.id} 答否時回到 ${s.onNo}，但迴圈沒有這一步`);
  }
  if (!f.designLoop.steps.some((s) => s.holdPoint)) problems.push("designLoop：沒有卡點（holdPoint）");

  const orders = f.layers.map((l) => l.order);
  if (orders.some((o, i) => o !== i + 1)) problems.push("layers：order 必須從 1 開始連續排列");
  const layerIds = new Set<string>();
  for (const l of f.layers) {
    for (const s of [...(l.steps ?? []), ...(l.before ?? []), ...(l.after ?? [])]) checkStep(s, `layers.${l.id}`, roles);
    for (const p of [...(l.inputs ?? []), ...(l.loopProduces ?? [])]) if (!types.has(p)) problems.push(`layers.${l.id}：引用了未定義的元素類型 ${p}`);
    if (l.gate && !gates.has(l.gate)) problems.push(`layers.${l.id}：節點 ${l.gate} 不存在`);
    if (l.kind === "loop") {
      if (!l.loopSteps?.length) problems.push(`layers.${l.id}：迴圈層沒有 loopSteps`);
      for (const id of l.loopSteps ?? []) if (!loopIds.has(id)) problems.push(`layers.${l.id}：loopSteps 的 ${id} 不在設計迴圈裡`);
      if (!(l.loopSteps ?? []).includes("outputs")) problems.push(`layers.${l.id}：迴圈沒有走到「產出設計限制」卡點`);
      if (l.loopOwner && !roles.has(l.loopOwner)) problems.push(`layers.${l.id}：loopOwner ${l.loopOwner} 不存在`);
      if (l.onGateFail && !(l.loopSteps ?? []).includes(l.onGateFail)) problems.push(`layers.${l.id}：節點未通過時回到 ${l.onGateFail}，但迴圈沒有這一步`);
    }
    // 原則「下一層需求有兩個來源」：第 3 層起，產生需求的步驟一定要寫 basisFrom，且指向更早、跑過設計迴圈的層
    if (l.order >= 3) {
      for (const s of [...(l.before ?? []), ...(l.after ?? []), ...(l.steps ?? [])]) {
        const makesReq = (s.produces ?? []).some((p) => /Requirement$/.test(p));
        if (!makesReq) continue;
        if (!s.basisFrom) { problems.push(`layers.${l.id}：${s.id} 產生需求，但沒有寫 basisFrom（設計產出來源）`); continue; }
        const from = f.layers.find((x) => x.id === s.basisFrom);
        if (!from) problems.push(`layers.${l.id}：${s.id} 的 basisFrom ${s.basisFrom} 不存在`);
        else if (from.kind !== "loop") problems.push(`layers.${l.id}：${s.id} 的 basisFrom ${s.basisFrom} 不是設計迴圈層`);
        else if (from.order > l.order) problems.push(`layers.${l.id}：${s.id} 的 basisFrom ${s.basisFrom} 在後面的層`);
      }
    }
    // 鏈狀層的「答否」只能回到同層的步驟或某個節點
    const own = new Set((l.steps ?? []).map((s) => s.id));
    for (const s of l.steps ?? []) if (s.onNo && !own.has(s.onNo) && !gates.has(s.onNo)) problems.push(`layers.${l.id}：${s.id} 答否時回到 ${s.onNo}，找不到`);
    layerIds.add(l.id);
  }
  for (const c of f.crossCutting) {
    if (c.resolver && !roles.has(c.resolver)) problems.push(`crossCutting：${c.id} 的裁決者 ${c.resolver} 不存在`);
    if (c.blocks && !loopIds.has(c.blocks)) problems.push(`crossCutting：${c.id} 擋的步驟 ${c.blocks} 不在設計迴圈裡`);
    if (c.record && !types.has(c.record)) problems.push(`crossCutting：${c.id} 的紀錄類型 ${c.record} 未定義`);
    for (const p of c.produces ?? []) if (!types.has(p)) problems.push(`crossCutting：${c.id} 引用了未定義的元素類型 ${p}`);
  }
  return problems;
}
