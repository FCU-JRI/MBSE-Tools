export interface Element {
  id: string; kind: string; category: string | null; name: string; shortName: string | null; qualifiedName: string;
  owner: string | null; doc: string; types: string[]; typeIds: string[]; file: string; shared: boolean; attrs: Record<string, string>; tags: string[]; line: number | null;
  /** 註解（Comment）所說明的元素 */
  about?: string[];
  /** 關鍵字（part def、perform action…）、樹上的上層、是不是沒有名字的使用（F-71） */
  keyword?: string; parent?: string | null; unnamed?: true;
  /** CoSMA 專案才有（F-84）：purpose／operational／functional／logical／technical，或 library、addon、root */
  layer?: string;
}
/** 通用的關係（F-71）。to 是 null 時對象在標準庫或沒有列出來，名稱在 toName */
export interface Link { kind: "specialize" | "type" | "subset" | "redefine" | "reference" | "perform"; from: string; to: string | null; toName: string; file: string; line: number | null }
/** 匯入（階段 3b）。member：匯入單一成員（A::B）或命名空間的內容（A::*、A::**）；to 是 null 時對象在標準庫或沒有列出來，名稱在 toName */
export interface Import { from: string; to: string | null; toName: string; member: boolean; recursive: boolean; private: boolean; file: string; line: number | null }
/** form：追溯到利害關係人時用的內建寫法（需求的 stakeholder、使用案例的 actor）；用 #trace 相依的沒有這個欄位 */
export interface Relation { kind: string; from: string; to: string; line: number | null; form?: "stakeholder" | "actor" }
export interface Diagnostic { severity: string; message: string; file: string; line: number; column: number }
export interface Analysis { ok: boolean; diagnostics: Diagnostic[]; elements: Element[]; relations: Relation[]; satisfaction: { requirement: string; subject: string; status: string }[];
  /** 沒有名字但有意義的使用，與通用的關係（F-71）。模型有錯誤時是空的 */
  unnamed: Element[]; links: Link[];
  /** 匯入（階段 3b）；舊的伺服器沒有這個欄位 */
  imports?: Import[] }
export interface Check { id: string; label: string; hint: string; manual: boolean; pass: boolean; detail: string; missing: { id: string; name: string }[] }
export interface Gate { id: string; zh: string; en: string; deadline: string | null; approver: string; purpose: string; perSubsystem: boolean; checks: Check[]; done: number; total: number }
export interface Signoff { gate: string; subsystem: string | null; decision: "APPROVE" | "DENY"; by: string; role: string; comment: string; at: string; commit: string }
export interface Project { id: string; name: string; kind: "annual" | "small"; template?: "blank" | "sample" | "guided" | "cosma"; createdAt: string; gates: string[]; manual: Record<string, boolean>; signoffs: Signoff[];
  /** 唯讀、原封不動、參考專案的來源（F-72、F-73） */
  readOnly?: boolean; pristine?: boolean; reference?: { name: string; source: string; commit: string; license: string } }
export interface Doc { id: string; title: string; type: string; revision: string; url: string; note: string }
export interface Step {
  id: string; zh: string; nasa: string; question: string; why: string; example: string; categories: string[];
  link: { kind: string; to: string[]; zh: string; direction: "out" | "in" } | null; parent: string | null;
  state: "done" | "current" | "locked"; count: number; issues: { id: string | null; text: string }[];
}
/** 開啟的是分支時才有：分支名稱、相對 main 領先與落後的提交數、無法跟 GitHub 同步時的說明 */
export interface BranchState { name: string; ahead: number; behind: number; warning: string }
/** project.id 是專案參照：main 是「代號」，分支是「代號@分支」（斜線寫成 ~）。拿它呼叫 API 就會留在同一個分支。 */
export interface View { project: Project; analysis: Analysis; gates: Gate[];
  /** 模型裡有元素特化 CoSMA 套件的定義（F-83）；舊的伺服器沒有這個欄位 */
  cosma?: boolean; docs: Doc[]; milestones: Record<string, string>; process: Step[]; history?: { undo: boolean; redo: boolean }; branch?: BranchState | null;
  /** 和 GitHub 接不上時的說明（main 與分支都可能有） */
  warning?: string }
export const baseOf = (ref: string) => ref.split("@")[0];
export const refOf = (ref: string, branch: string) => `${baseOf(ref)}@${branch.replaceAll("/", "~")}`;
export interface Field { name: string; zh: string; type: "text" | "int" | "real" }
export interface Category { id: string; zh: string; en: string; pillar: string; prefix: string; pkg: string; keyword: string; help: string; example: string; fields?: Field[];
  /** CoSMA 的類別才有（F-84）：所在的層、必須放進哪一類元素裡、工具能不能新增 */
  layer?: string; parent?: string; creatable?: boolean }
export interface Meta {
  categories: Category[]; pillars: Record<string, string>; relations: Record<string, { zh: string; help: string }>;
  /** 表上可以建立的關係種類；CoSMA 專案才有（F-85） */
  relationKinds?: string[];
  /** CoSMA 專案用的類別與關係（F-84）；Workspace 依專案換成 categories／pillars／relations */
  cosma?: { categories: Category[]; layers: Record<string, string>; places: Record<string, string>; relations: Record<string, { zh: string; help: string }>; relationKinds: string[] };
  gates: { id: string; zh: string; en: string; deadline: string | null; approver: string; purpose: string; perSubsystem: boolean }[];
}

export class ApiError extends Error {
  diagnostics: Diagnostic[];
  constructor(message: string, diagnostics: Diagnostic[] = []) { super(message); this.diagnostics = diagnostics; }
}

export const getAuthor = () => { try { return localStorage.getItem("jri.author") ?? ""; } catch { return ""; } };
export const setAuthor = (v: string) => { try { localStorage.setItem("jri.author", v); } catch { /* 無法儲存時只在本次使用 */ } };

export async function api<T>(path: string, method = "GET", body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json; charset=utf-8" } : undefined,
    body: body ? JSON.stringify({ ...body, author: getAuthor() }) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const diags: Diagnostic[] = data.diagnostics ?? [];
    throw new ApiError(data.error ?? (diags.length ? `模型有 ${diags.length} 個錯誤，未儲存：${diags[0].message}（第 ${diags[0].line} 行）` : `請求失敗（${res.status}）`), diags);
  }
  return data as T;
}

/** 圖上的標註：註解、外框、文字。只是說明，不進模型。 */
export interface Annotation { id: string; type: "note" | "frame" | "text"; x: number; y: number; w: number; h: number; text: string }
export interface Diagrams { custom: { id: string; title: string; members: string[] }[]; notes: Record<string, Annotation[]> }
export type Layout = Record<string, Record<string, { x: number; y: number; w?: number; h?: number }>>;

export interface Me {
  kind: "local" | "member" | "viewer"; login: string; name: string; rank: string | null; rankZh: string; subsystems: string[]; project: string | null;
  caps: { edit: boolean; createProject: boolean; confirm: boolean; merge: boolean; admin: boolean };
}
export interface MeResponse { user: Me | null; githubLogin: boolean; public: boolean }

/** 依專案換成它用的類別（F-83）：CoSMA 專案用五層，其餘專案原封不動用 JRI 的類別。 */
export function projectMeta(meta: Meta, cosma: boolean): Meta {
  if (!cosma || !meta.cosma) return meta;
  return { ...meta, categories: meta.cosma.categories, pillars: meta.cosma.layers, relations: { ...meta.relations, ...meta.cosma.relations }, relationKinds: meta.cosma.relationKinds };
}
