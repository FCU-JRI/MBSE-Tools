export interface Element {
  id: string; kind: string; category: string | null; name: string; shortName: string | null; qualifiedName: string;
  owner: string | null; doc: string; types: string[]; typeIds: string[]; attrs: Record<string, string>; tags: string[]; line: number | null;
}
export interface Relation { kind: string; from: string; to: string; line: number | null }
export interface Diagnostic { severity: string; message: string; file: string; line: number; column: number }
export interface Analysis { ok: boolean; diagnostics: Diagnostic[]; elements: Element[]; relations: Relation[]; satisfaction: { requirement: string; subject: string; status: string }[] }
export interface Check { id: string; label: string; hint: string; manual: boolean; pass: boolean; detail: string; missing: { id: string; name: string }[] }
export interface Gate { id: string; zh: string; en: string; deadline: string | null; approver: string; purpose: string; perSubsystem: boolean; checks: Check[]; done: number; total: number }
export interface Signoff { gate: string; subsystem: string | null; decision: "APPROVE" | "DENY"; by: string; role: string; comment: string; at: string; commit: string }
export interface Project { id: string; name: string; kind: "annual" | "small"; createdAt: string; gates: string[]; manual: Record<string, boolean>; signoffs: Signoff[] }
export interface View { project: Project; analysis: Analysis; gates: Gate[] }
export interface Field { name: string; zh: string; type: "text" | "int" | "real" }
export interface Category { id: string; zh: string; en: string; pillar: string; prefix: string; pkg: string; keyword: string; help: string; example: string; fields?: Field[] }
export interface Meta {
  categories: Category[]; pillars: Record<string, string>; relations: Record<string, { zh: string; help: string }>;
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

export type Layout = Record<string, Record<string, { x: number; y: number }>>;

export interface Me {
  kind: "local" | "member" | "viewer"; login: string; name: string; rank: string | null; rankZh: string; subsystems: string[]; project: string | null;
  caps: { edit: boolean; createProject: boolean; confirm: boolean; merge: boolean; admin: boolean };
}
export interface MeResponse { user: Me | null; githubLogin: boolean; public: boolean }
