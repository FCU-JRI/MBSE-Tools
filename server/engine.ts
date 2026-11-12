// SysML v2 解析引擎（OpenSysML）。整個伺服器共用一條連線。
import { connect } from "@openmbee/opensysml";
import { createHash } from "node:crypto";
import { extract } from "./extract.ts";
import type { Extracted } from "./extract.ts";

export interface Diagnostic {
  severity: string;
  message: string;
  file: string;
  line: number;
  column: number;
}

export interface Satisfaction {
  requirement: string;
  subject: string;
  status: string; // holds | fails | undecided
}

export interface Analysis extends Extracted {
  ok: boolean;
  diagnostics: Diagnostic[];
  satisfaction: Satisfaction[];
}

export type Source = readonly [name: string, content: string];

export const ROOT_PACKAGE = "Project";
export const LIBRARY_FILE = "JRI.sysml";

let connection: Awaited<ReturnType<typeof connect>> | undefined;
async function conn() {
  connection ??= await connect();
  return connection;
}

export async function shutdown(): Promise<void> {
  await connection?.close();
  connection = undefined;
}

const cache = new Map<string, Analysis>();

/** 解析一組檔案；語法或語意錯誤會列在 diagnostics，不會丟例外。 */
export async function analyze(sources: readonly Source[], shared: readonly string[] = []): Promise<Analysis> {
  const key = createHash("sha256").update(JSON.stringify([sources, shared])).digest("hex");
  const hit = cache.get(key);
  if (hit) return hit;

  const c = await conn();
  const model = await c.parseSources(sources.map(([n, s]) => [n, s] as const));
  const diagnostics: Diagnostic[] = model.diagnostics.map((d: any) => ({
    severity: String(d.severity ?? "error"),
    message: String(d.message ?? ""),
    file: String(d.file ?? ""),
    line: Number(d.startLine ?? 0),
    column: Number(d.startColumn ?? 0),
  }));
  const ok = !diagnostics.some((d) => d.severity === "error");

  let extracted: Extracted = { elements: [], relations: [] };
  let satisfaction: Satisfaction[] = [];
  if (ok) {
    const json = await model.toApiJson();
    const raw = (JSON.parse(json.content) as any[]).map((e) => e.payload ?? e);
    const sharedSet = new Set(shared);
    extracted = extract(raw, new Set(sources.map(([n]) => n).filter((n) => n !== LIBRARY_FILE && !sharedSet.has(n))), sharedSet);
    try {
      const verdicts = await model.verifySatisfaction();
      satisfaction = verdicts.map((v: any) => ({
        requirement: String(v.verdict?.subject?.requirementId ?? ""),
        subject: String(v.verdict?.subject?.instanceTypeId ?? ""),
        status: String(v.verdict?.status ?? v.verdict?.kind ?? "undecided"),
      }));
    } catch {
      // 判定失敗不影響其餘結果；表格上顯示為未判定。
    }
  }
  const result: Analysis = { ok, diagnostics, satisfaction, ...extracted };
  if (cache.size > 50) cache.clear();
  cache.set(key, result);
  return result;
}
