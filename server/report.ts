// 審查報告：依節點把模型內容組成一份文件，輸出成 Word（.docx）或可列印成 PDF 的網頁。
import dagre from "@dagrejs/dagre";
import { AlignmentType, Document, HeadingLevel, Packer, PageBreak, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { Analysis } from "./engine.ts";
import type { Element } from "./extract.ts";
import type { GateStatus } from "./gates.ts";
import { CATEGORY } from "./metamodel.ts";
import type { Pm } from "./pm.ts";
import { PRIORITY_ZH } from "./pm.ts";
import type { Project } from "./projects.ts";
import type { SimFile } from "./sim.ts";
// 圖的資料與 SVG 繪製和前端共用同一份程式
import { buildGraph, diagramsOf, frameLabel } from "../web/src/model.ts";
import { toSvg } from "../web/src/exportSvg.ts";

interface Section { heading: string; level: 1 | 2; paragraphs: string[]; table?: { head: string[]; rows: string[][] }; svg?: string; breakBefore?: boolean }
export interface Report { title: string; subtitle: string; meta: [string, string][]; sections: Section[] }

const METHOD: Record<string, string> = { "Method::byTest": "測試", "Method::byAnalysis": "分析", "Method::byInspection": "檢查", "Method::byDemonstration": "展示" };
const STRUCTURAL = new Set(["System", "Subsystem", "Component", "ExternalEntity"]);

function diagramSvg(_title: string, a: Analysis, id: string): string | null {
  const def = diagramsOf(a as any).find((d) => d.id === id || d.kind === id);
  if (!def) return null;
  const g = buildGraph(def, a as any);
  if (g.nodes.length === 0) return null;
  const dg = new dagre.graphlib.Graph();
  dg.setGraph({ rankdir: g.direction, nodesep: 36, ranksep: 64 });
  dg.setDefaultEdgeLabel(() => ({}));
  for (const n of g.nodes) dg.setNode(n.id, { width: n.width, height: n.height });
  for (const e of g.edges) if (e.source !== e.target) dg.setEdge(e.source, e.target);
  dagre.layout(dg);
  const placed = g.nodes.map((n) => { const p = dg.node(n.id); return { g: n, x: p.x - n.width / 2, y: p.y - n.height / 2 }; });
  return toSvg(frameLabel(def), placed, g.edges);
}

export function buildReport(project: Project, a: Analysis, gates: GateStatus[], plan: Pm, sim: SimFile, gateId: string, commit: string): Report {
  const gate = gates.find((g) => g.id === gateId) ?? gates[0];
  const byId = new Map(a.elements.map((e) => [e.id, e]));
  const label = (id: string) => { const e = byId.get(id); return e ? (e.shortName ? `${e.shortName} ${e.name}` : e.name) : ""; };
  const of = (...cats: string[]) => a.elements.filter((e) => e.category !== null && cats.includes(e.category) && e.kind !== "ReferenceUsage" && (STRUCTURAL.has(e.category) ? e.kind === "PartDefinition" : /Usage$/.test(e.kind)));
  const outs = (e: Element, ...k: string[]) => a.relations.filter((r) => r.from === e.id && k.includes(r.kind)).map((r) => label(r.to)).join("；");
  const ins = (e: Element, ...k: string[]) => a.relations.filter((r) => r.to === e.id && k.includes(r.kind)).map((r) => label(r.from)).join("；");
  const zh = (e: Element) => CATEGORY.get(e.category ?? "")?.zh ?? "";
  const sat = new Map(a.satisfaction.map((s) => [s.requirement, s.status]));
  const verdict = (e: Element) => ({ holds: "滿足", fails: "不滿足", undecided: "未判定" } as Record<string, string>)[sat.get(e.qualifiedName) ?? ""] ?? "—";
  const S: Section[] = [];
  const add = (heading: string, paragraphs: string[], table?: Section["table"], extra: Partial<Section> = {}) => { if (!table || table.rows.length > 0) S.push({ heading, level: 2, paragraphs, table, ...extra }); };
  const chapter = (heading: string, paragraphs: string[] = []) => S.push({ heading, level: 1, paragraphs, breakBefore: true });

  chapter("1　審查摘要", [gate ? gate.purpose : "", gate ? `本節點共 ${gate.total} 項檢查，已完成 ${gate.done} 項。` : ""].filter(Boolean));
  if (gate) add("1.1　節點檢查", [], { head: ["檢查項目", "狀態", "說明", "尚缺項目"], rows: gate.checks.map((c) => [c.label, c.pass ? "完成" : "未完成", c.detail, c.missing.map((m) => m.name).join("；")]) });
  const so = project.signoffs.filter((s) => !gate || s.gate === gate.id);
  add("1.2　簽核紀錄", [], { head: ["決議", "次系統", "簽核人", "職級", "意見", "時間", "模型版本"], rows: so.map((s) => [s.decision, s.subsystem ?? "—", s.by, s.role, s.comment, s.at.slice(0, 16).replace("T", " "), s.commit]) });

  chapter("2　利害關係人與任務目標");
  add("2.1　利害關係人", [], { head: ["編號", "名稱", "角色與關注點", "相關期望"], rows: of("Stakeholder").map((e) => [e.shortName ?? "", e.name, e.attrs.role ?? "", ins(e, "trace")]) });
  add("2.2　期望、需要、目標、目的與效能量度", [], { head: ["編號", "類別", "名稱", "內容", "來源"], rows: of("Expectation", "Need", "Goal", "Objective", "MOE").map((e) => [e.shortName ?? "", zh(e), e.name, e.doc, outs(e, "derive", "refine", "trace")]) });
  add("2.3　使用案例", [], { head: ["編號", "名稱", "說明", "參與者"], rows: of("UseCase").map((e) => [e.shortName ?? "", e.name, e.doc, outs(e, "trace")]) }, { svg: diagramSvg(project.name, a, "uc") ?? undefined });

  chapter("3　系統架構");
  add("3.1　結構分解", [], { head: ["類別", "編號", "名稱", "說明", "屬性"], rows: of("System", "Subsystem", "Component", "ExternalEntity").map((e) => [zh(e), e.shortName ?? "", e.name, e.doc, a.elements.filter((x) => x.owner === e.id && x.kind === "AttributeUsage").map((x) => x.name + (x.tags.includes("TPM") ? "（TPM）" : "")).join("、")]) }, { svg: diagramSvg(project.name, a, "bdd") ?? undefined });
  add("3.2　任務階段與功能", [], { head: ["類別", "編號", "名稱", "下一步", "分配給"], rows: of("MissionPhase", "Function").map((e) => [zh(e), e.shortName ?? "", e.name, outs(e, "succession"), outs(e, "allocate")]) }, { svg: diagramSvg(project.name, a, "act") ?? undefined });
  const stm = diagramSvg(project.name, a, "stm");
  if (stm) S.push({ heading: "3.3　模式與狀態", level: 2, paragraphs: [], svg: stm });

  chapter("4　需求與驗證");
  const reqs = of("SystemRequirement", "SubsystemRequirement", "ComponentRequirement", "MOP");
  add("4.1　需求表", [], { head: ["編號", "層級", "名稱", "需求內容", "衍生自", "滿足者", "計算判定"], rows: reqs.map((e) => [e.shortName ?? "", zh(e), e.name, e.doc, outs(e, "derive", "refine", "trace"), ins(e, "satisfy"), verdict(e)]) }, { svg: diagramSvg(project.name, a, "req") ?? undefined });
  const rvm: string[][] = [];
  for (const r of reqs) {
    const ev = a.relations.filter((x) => x.kind === "verify" && x.to === r.id).map((x) => byId.get(x.from)).filter((x): x is Element => !!x);
    if (ev.length === 0) rvm.push([r.shortName ?? "", r.name, "—", "未規劃", "", ""]);
    for (const v of ev) rvm.push([r.shortName ?? "", r.name, v.shortName ?? "", v.name, METHOD[v.attrs.kind ?? ""] ?? "", v.doc]);
  }
  add("4.2　需求驗證矩陣", [], { head: ["需求編號", "需求", "驗證編號", "驗證事件", "方法", "說明"], rows: rvm });
  add("4.3　技術性能量度（TPM）", [], { head: ["所屬", "名稱", "型別"], rows: a.elements.filter((e) => e.tags.includes("TPM")).map((e) => [byId.get(e.owner ?? "")?.name ?? "", e.name, e.types.join("、")]) });
  if (sim.result) add("4.4　飛行模擬結果", [`${sim.result.engine}，執行於 ${sim.result.at.slice(0, 16).replace("T", " ")}，模型版本 ${sim.result.commit}，參數 ${sim.result.inputsHash}。標準大氣、無風。`, ...sim.result.warnings], { head: ["項目", "數值", "單位"], rows: sim.result.outputs.map((o) => [o.zh, String(o.value), o.unit]) });

  chapter("5　風險與安全");
  add("5.1　風險評估", [], { head: ["編號", "名稱", "失效模式", "影響", "原因", "嚴重度", "可能性", "風險值", "緩解措施", "負責人"], rows: of("Risk").map((e) => { const s = Number(e.attrs.severity) || 0, l = Number(e.attrs.likelihood) || 0; return [e.shortName ?? "", e.name, e.attrs.failureMode ?? "", e.attrs.effect ?? "", e.attrs.cause ?? "", String(s || ""), String(l || ""), String(s * l || ""), e.attrs.mitigation ?? "", e.attrs.owner ?? ""]; }) });
  const generic = (heading: string, cat: string) => { const c = CATEGORY.get(cat); if (c) add(heading, [], { head: ["編號", "名稱", ...(c.fields ?? []).map((f) => f.zh)], rows: of(cat).map((e) => [e.shortName ?? "", e.name, ...(c.fields ?? []).map((f) => e.attrs[f.name] ?? "")]) }); };
  generic("5.2　安全係數", "SafetyFactor");
  generic("5.3　標準作業程序", "SOP");
  generic("5.4　名冊", "RosterEntry");
  generic("5.5　異常報告", "Anomaly");
  generic("5.6　加工 QC 紀錄", "QCRecord");

  chapter("6　時程與成本");
  add("6.1　時程", [], { head: ["ID", "任務", "優先級", "責任工程師", "開始", "結束", "相依", "狀態"], rows: plan.tasks.map((t) => [t.id, t.title, `${t.priority} ${PRIORITY_ZH[t.priority]}`, t.re, t.start, t.end, t.deps.join("、"), t.done ? "完成" : t.end < new Date().toISOString().slice(0, 10) ? "逾期" : "進行中"]) });
  add("6.2　成本", [`預算合計 ${plan.costs.reduce((s, c) => s + c.planned, 0).toLocaleString("zh-TW")} 元，實支合計 ${plan.costs.reduce((s, c) => s + c.actual, 0).toLocaleString("zh-TW")} 元。`], { head: ["次系統", "項目", "預算", "實支", "狀態"], rows: plan.costs.map((c) => [c.subsystem, c.item, c.planned.toLocaleString("zh-TW"), c.actual.toLocaleString("zh-TW"), c.status]) });

  // 沒有任何小節的章不印
  const sections = S.filter((s, i) => s.level === 2 || s.paragraphs.length > 0 || S[i + 1]?.level === 2);
  return {
    title: project.name, subtitle: gate ? `${gate.zh} ${gate.en} 審查報告` : "審查報告",
    meta: [["產出時間", new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC"], ["模型版本", commit], ["團隊", "噴射推進研究社 JRI"], ["產出工具", "JRI MBSE（SysML v2；NASA-HDBK-1009A；AEAS-EXB-REG-1001）"]],
    sections,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 可列印的網頁。用瀏覽器的列印功能另存成 PDF。 */
export function renderHtml(r: Report): string {
  const body = r.sections.map((s) => `
<section class="${s.breakBefore ? "chapter" : ""}">
<h${s.level + 1}>${esc(s.heading)}</h${s.level + 1}>
${s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}
${s.svg ? `<figure>${s.svg}</figure>` : ""}
${s.table ? `<table><thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}
</section>`).join("");
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.title)} ${esc(r.subtitle)}</title>
<style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif; font-size: 10.5pt; line-height: 1.6; color: #111; background: #fff; margin: 0 auto; max-width: 190mm; padding: 16px; }
h1 { font-size: 24pt; margin: 30mm 0 4mm; } .sub { font-size: 14pt; margin: 0 0 12mm; }
h2 { font-size: 14pt; border-bottom: 1px solid #111; padding-bottom: 2mm; margin: 0 0 4mm; } h3 { font-size: 11.5pt; margin: 6mm 0 2mm; }
p { margin: 0 0 2mm; } dl { display: grid; grid-template-columns: 28mm 1fr; gap: 1mm 4mm; margin: 0; } dt { color: #555; } dd { margin: 0; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; margin: 2mm 0 4mm; } th, td { border: 0.5pt solid #777; padding: 1.2mm 1.6mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #eee; font-weight: 600; } thead { display: table-header-group; } tr { break-inside: avoid; }
figure { margin: 2mm 0 4mm; text-align: center; break-inside: avoid; } figure svg { max-width: 100%; height: auto; }
.chapter { break-before: page; } .bar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #ccc; padding: 8px 0; margin-bottom: 8px; }
.bar button { font: inherit; padding: 6px 16px; border: 1px solid #111; background: #111; color: #fff; cursor: pointer; }
@media print { .bar { display: none; } body { padding: 0; max-width: none; } }
</style></head><body>
<div class="bar"><button onclick="window.print()">列印／另存為 PDF</button></div>
<h1>${esc(r.title)}</h1><p class="sub">${esc(r.subtitle)}</p>
<dl>${r.meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
${body}
</body></html>`;
}

/** Word 檔。圖形不放進 Word（需另存成圖片），請用可列印的網頁版取得含圖的 PDF。 */
export async function renderDocx(r: Report): Promise<Buffer> {
  const font = "Microsoft JhengHei";
  const run = (text: string, opt: { bold?: boolean; size?: number; color?: string } = {}) => new TextRun({ text, font: { name: font, eastAsia: font }, bold: opt.bold, size: opt.size ?? 21, color: opt.color });
  const children: (Paragraph | Table)[] = [
    new Paragraph({ spacing: { before: 2400, after: 200 }, children: [run(r.title, { bold: true, size: 52 })] }),
    new Paragraph({ spacing: { after: 600 }, children: [run(r.subtitle, { size: 30 })] }),
    ...r.meta.map(([k, v]) => new Paragraph({ children: [run(`${k}　`, { color: "555555" }), run(v)] })),
  ];
  for (const s of r.sections) {
    if (s.breakBefore) children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ heading: s.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [run(s.heading, { bold: true, size: s.level === 1 ? 30 : 24 })] }));
    for (const p of s.paragraphs) children.push(new Paragraph({ spacing: { after: 80 }, children: [run(p)] }));
    if (s.svg) children.push(new Paragraph({ spacing: { after: 80 }, children: [run("（本節的圖請見網頁版或 PDF 版報告。）", { color: "777777", size: 18 })] }));
    if (s.table) {
      const cell = (text: string, head: boolean) => new TableCell({ shading: head ? { fill: "EEEEEE" } : undefined, margins: { top: 50, bottom: 50, left: 80, right: 80 }, children: (text || " ").split("\n").map((line) => new Paragraph({ alignment: AlignmentType.LEFT, children: [run(line, { bold: head, size: 18 })] })) });
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ tableHeader: true, children: s.table.head.map((h) => cell(h, true)) }), ...s.table.rows.map((row) => new TableRow({ children: row.map((c) => cell(c, false)) }))] }));
    }
  }
  const doc = new Document({ creator: "JRI MBSE", title: `${r.title} ${r.subtitle}`, styles: { default: { document: { run: { font, size: 21 } } } }, sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 900, right: 900 } } }, children }] });
  return Packer.toBuffer(doc);
}
