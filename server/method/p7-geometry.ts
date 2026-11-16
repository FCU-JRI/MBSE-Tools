// P7：從模型的 @Geometry 標記算出火箭外形、重心、壓力中心與穩定裕度，並和 OpenRocket .ork 互轉（docs/IMPL-PLAN.md）。
// 純計算，不讀檔、不碰網路；伺服器路由在 p7.ts。幾何的寫法定義在 library/JRI.sysml 的 [P7] 區塊。
//
// 座標：原點在鼻錐尖端，沿箭軸往尾端為正，單位 m、kg。
// 壓力中心用 Barrowman 法（次音速、小攻角）：只計鼻錐、過渡段與尾翼的法向力，箭體圓柱段不計。
import type { Element } from "../extract.ts";

export type GeoKind = "nose" | "body" | "transition" | "fins" | "mass";
export const GEO_KINDS: GeoKind[] = ["nose", "body", "transition", "fins", "mass"];
export const NOSE_SHAPES = ["conical", "ogive", "vonKarman", "lvhaack", "tangent", "parabolic", "elliptical"];
/** 標記上的欄位，順序也是寫回模型時的順序 */
export const GEO_FIELDS = ["geoKind", "geoPosition", "geoLength", "geoDiameter", "geoAftDiameter", "geoShape", "geoFinCount", "geoRootChord", "geoTipChord", "geoSpan", "geoSweep", "geoMass", "geoCg", "geoPropellant"] as const;
export type GeoField = (typeof GEO_FIELDS)[number];
const TEXT_FIELDS = new Set<GeoField>(["geoKind", "geoShape"]);

export interface Fin { n: number; rootChord: number; tipChord: number; span: number; sweep: number }
export interface Section {
  /** 模型元素的 id 與名稱 */
  id: string; name: string; qualifiedName: string; file: string;
  kind: GeoKind;
  /** 前端到鼻尖（尾翼組是翼根前緣） */
  position: number;
  length: number;
  /** 前端外徑；鼻錐是底部外徑 */
  diameter: number | null;
  aftDiameter: number | null;
  shape: string | null;
  fin: Fin | null;
  mass: number;
  /** 本身重心的絕對位置（從鼻尖量起） */
  cg: number;
  propellant: number;
  /** Barrowman 的法向力係數斜率（以參考面積正規化）與作用點；不產生升力的段是 0 與 null */
  cn: number;
  xcp: number | null;
  /** 這一段在箭體外面（會畫出外形） */
  external: boolean;
}
export interface MassState { mass: number; cg: number | null; margin: number | null }
export interface RocketGeometry {
  /** 分組的代號：最近的系統（System）元素 id；沒有歸屬時是空字串 */
  key: string;
  name: string;
  sections: Section[];
  /** 外形的全長（最後一段外形的尾端） */
  length: number;
  /** 參考直徑：外形的最大外徑 */
  refDiameter: number | null;
  cn: number;
  cp: number | null;
  /** 起飛（含推進劑） */
  liftoff: MassState;
  /** 燃畢（扣掉推進劑） */
  burnout: MassState;
  warnings: string[];
}

/** 讀數字：接受 0.55、0.55 [m]、550 [mm]、500 [g] 這幾種寫法，一律換成 m、kg。 */
export function geoNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(?:\[\s*'?([A-Za-z]+)'?\s*\])?$/);
  if (!m) return null;
  const scale: Record<string, number> = { m: 1, mm: 0.001, cm: 0.01, kg: 1, g: 0.001 };
  const k = m[2] ? scale[m[2]] : 1;
  if (k === undefined) return null;
  const n = Number(m[1]) * k;
  return Number.isFinite(n) ? n : null;
}
const geoText = (text: string | undefined) => (text === undefined ? null : String(text).trim().replace(/^"(.*)"$/, "$1"));

/** Barrowman：鼻錐壓力中心距鼻尖的比例（乘上鼻錐長度） */
const NOSE_CP: Record<string, number> = { conical: 2 / 3, ogive: 0.466, tangent: 0.466, vonKarman: 0.5, lvhaack: 0.5, parabolic: 0.5, elliptical: 1 / 3 };

/** 一條尾翼組的法向力係數斜率與作用點（Barrowman）。d 是參考直徑，r 是尾翼處的箭體半徑，x 是翼根前緣位置。 */
export function finCn(f: Fin, d: number, r: number, x: number): { cn: number; xcp: number } {
  const { n, rootChord: cr, tipChord: ct, span: s, sweep: xr } = f;
  const lf = Math.sqrt(s ** 2 + (xr + ct / 2 - cr / 2) ** 2);
  const interference = 1 + r / (s + r);
  const cn = interference * (4 * n * (s / d) ** 2) / (1 + Math.sqrt(1 + ((2 * lf) / (cr + ct)) ** 2));
  const xcp = x + (xr * (cr + 2 * ct)) / (3 * (cr + ct)) + ((cr + ct) - (cr * ct) / (cr + ct)) / 6;
  return { cn, xcp };
}

/** 往上找最近的系統（System）元素，當作這一段屬於哪一枚火箭。 */
function systemOf(el: Element, byId: Map<string, Element>): Element | null {
  let cur: Element | undefined = el;
  for (let i = 0; cur && i < 40; i++) {
    if (cur !== el && cur.category === "System") return cur;
    cur = cur.owner ? byId.get(cur.owner) : undefined;
  }
  return null;
}

/** 從模型元素讀出一段幾何；欄位不合法時回傳說明。 */
function readSection(el: Element): { section: Section | null; warning: string | null } {
  const a = el.attrs;
  const kind = geoText(a.geoKind) as GeoKind;
  const bad = (t: string) => ({ section: null, warning: `「${el.name}」${t}，這一段沒有算進去。` });
  if (!GEO_KINDS.includes(kind)) return bad(`的 geoKind 必須是 ${GEO_KINDS.join("、")} 其中之一`);
  const position = geoNumber(a.geoPosition);
  if (position === null) return bad("缺少 geoPosition（前端到鼻尖的距離，m）");
  const num = (k: GeoField) => geoNumber(a[k]);
  const fin = kind === "fins" ? {
    n: Math.round(num("geoFinCount") ?? 0), rootChord: num("geoRootChord") ?? 0, tipChord: num("geoTipChord") ?? 0, span: num("geoSpan") ?? 0, sweep: num("geoSweep") ?? 0,
  } : null;
  if (fin && (fin.n < 1 || fin.rootChord <= 0 || fin.span <= 0)) return bad("的尾翼片數、翼根弦長或翼展沒有填");
  const length = kind === "fins" ? fin!.rootChord : num("geoLength") ?? 0;
  if (length < 0) return bad("的長度是負的");
  const diameter = num("geoDiameter");
  if ((kind === "nose" || kind === "body" || kind === "transition") && !(diameter && diameter > 0)) return bad("缺少 geoDiameter（外徑，m）");
  if (kind === "transition" && !((num("geoAftDiameter") ?? 0) > 0)) return bad("缺少 geoAftDiameter（過渡段後端外徑，m）");
  if ((kind === "nose" || kind === "body" || kind === "transition") && !(length > 0)) return bad("缺少 geoLength（長度，m）");
  const shape = kind === "nose" ? (geoText(a.geoShape) ?? "ogive") : null;
  const mass = Math.max(num("geoMass") ?? 0, 0);
  const cgOffset = num("geoCg") ?? length / 2;
  return {
    section: {
      id: el.id, name: el.name, qualifiedName: el.qualifiedName, file: el.file, kind, position, length,
      diameter: kind === "fins" || kind === "mass" ? null : diameter, aftDiameter: kind === "transition" ? num("geoAftDiameter") : null,
      shape: shape && NOSE_SHAPES.includes(shape) ? shape : shape ? "ogive" : null, fin, mass, cg: position + cgOffset,
      propellant: Math.min(Math.max(num("geoPropellant") ?? 0, 0), mass), cn: 0, xcp: null, external: kind !== "mass",
    },
    warning: shape && !NOSE_SHAPES.includes(shape) ? `「${el.name}」的鼻錐外形 ${shape} 不認得，改用 ogive 計算。` : null,
  };
}

function massState(sections: Section[], cp: number | null, d: number | null, burnout: boolean): MassState {
  let m = 0, mx = 0;
  for (const s of sections) {
    const w = burnout ? s.mass - s.propellant : s.mass;
    m += w; mx += w * s.cg;
  }
  const cg = m > 0 ? mx / m : null;
  return { mass: m, cg, margin: cg !== null && cp !== null && d ? (cp - cg) / d : null };
}

/** 一枚火箭的幾何計算：sections 的 cn、xcp 會被填上。 */
export function computeRocket(key: string, name: string, sections: Section[], warnings: string[] = []): RocketGeometry {
  sections.sort((a, b) => a.position - b.position || GEO_KINDS.indexOf(a.kind) - GEO_KINDS.indexOf(b.kind));
  const outer = sections.filter((s) => s.kind === "nose" || s.kind === "body" || s.kind === "transition");
  const d = outer.length ? Math.max(...outer.map((s) => Math.max(s.diameter ?? 0, s.aftDiameter ?? 0))) : null;
  const length = outer.length ? Math.max(...outer.map((s) => s.position + s.length)) : Math.max(0, ...sections.map((s) => s.position + s.length));
  if (!outer.some((s) => s.kind === "nose")) warnings.push("沒有鼻錐（geoKind = \"nose\"），壓力中心少算了鼻錐。");
  // 外形要首尾相接
  for (let i = 1; i < outer.length; i++) {
    const gap = outer[i].position - (outer[i - 1].position + outer[i - 1].length);
    if (Math.abs(gap) > 1e-4) warnings.push(`「${outer[i - 1].name}」與「${outer[i].name}」之間${gap > 0 ? `有 ${(gap * 1000).toFixed(1)} mm 的空隙` : `重疊 ${(-gap * 1000).toFixed(1)} mm`}。`);
  }
  const outerAt = (x: number) => outer.find((s) => x >= s.position - 1e-9 && x <= s.position + s.length + 1e-9);
  if (d) {
    for (const s of sections) {
      if (s.kind === "nose") {
        s.cn = 2 * ((s.diameter as number) / d) ** 2;
        s.xcp = s.position + NOSE_CP[s.shape ?? "ogive"] * s.length;
      } else if (s.kind === "transition") {
        const d1 = s.diameter as number, d2 = s.aftDiameter as number;
        s.cn = 2 * ((d2 / d) ** 2 - (d1 / d) ** 2);
        const ratio = d1 / d2;
        s.xcp = s.position + (s.length / 3) * (1 + (Math.abs(1 - ratio * ratio) < 1e-12 ? 0.5 : (1 - ratio) / (1 - ratio * ratio)));
      } else if (s.kind === "fins" && s.fin) {
        const host = outerAt(s.position);
        const r = ((host?.kind === "transition" ? host.aftDiameter : host?.diameter) ?? d) / 2;
        if (!host) warnings.push(`「${s.name}」不在任何箭體段上，用參考直徑當作尾翼處的箭體直徑。`);
        const f = finCn(s.fin, d, r, s.position);
        s.cn = f.cn; s.xcp = f.xcp;
      }
    }
  }
  const lifting = sections.filter((s) => s.xcp !== null);
  const cn = lifting.reduce((t, s) => t + s.cn, 0);
  const cp = lifting.length && cn > 0 ? lifting.reduce((t, s) => t + s.cn * (s.xcp as number), 0) / cn : null;
  const liftoff = massState(sections, cp, d, false), burnout = massState(sections, cp, d, true);
  if (!sections.some((s) => s.mass > 0)) warnings.push("沒有任何一段寫了 geoMass，算不出重心。");
  if (liftoff.margin !== null && liftoff.margin < 1) warnings.push(`起飛時穩定裕度只有 ${liftoff.margin.toFixed(2)} 倍徑，低於一般建議的 1.5。`);
  else if (liftoff.margin !== null && liftoff.margin < 1.5) warnings.push(`起飛時穩定裕度 ${liftoff.margin.toFixed(2)} 倍徑，略低於一般建議的 1.5。`);
  return { key, name, sections, length, refDiameter: d, cn, cp, liftoff, burnout, warnings };
}

/** 模型裡所有標了 @Geometry 的元素，依所屬的系統分組，各算一枚火箭。 */
export function rocketsFromElements(elements: Element[]): RocketGeometry[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const groups = new Map<string, { name: string; sections: Section[]; warnings: string[] }>();
  for (const el of elements) {
    if (!el.tags.includes("Geometry")) continue;
    const sys = systemOf(el, byId);
    const key = sys?.id ?? "";
    const g = groups.get(key) ?? { name: sys?.name ?? "（未歸屬系統）", sections: [], warnings: [] };
    groups.set(key, g);
    const r = readSection(el);
    if (r.warning) g.warnings.push(r.warning);
    if (r.section) g.sections.push(r.section);
  }
  return [...groups.entries()].map(([key, g]) => computeRocket(key, g.name, g.sections, g.warnings));
}

// ───────── 寫回模型 ─────────

const fmt = (n: number) => String(Number(n.toPrecision(6)));

/** 產生一個 @Geometry 標記的原始碼（只寫有值的欄位）。 */
export function geometryText(values: Partial<Record<GeoField, string | number | null>>): string {
  const parts = GEO_FIELDS.filter((k) => values[k] !== undefined && values[k] !== null && values[k] !== "")
    .map((k) => `${k} = ${TEXT_FIELDS.has(k) ? JSON.stringify(String(values[k])) : typeof values[k] === "number" ? fmt(values[k] as number) : String(values[k])};`);
  return `@Geometry { ${parts.join(" ")} }`;
}

/** 元素目前的欄位原文（數字已換算成 m、kg） */
export function currentValues(el: Element): Partial<Record<GeoField, string | number>> {
  const out: Partial<Record<GeoField, string | number>> = {};
  for (const k of GEO_FIELDS) {
    if (el.attrs[k] === undefined) continue;
    out[k] = TEXT_FIELDS.has(k) ? (geoText(el.attrs[k]) as string) : geoNumber(el.attrs[k]) ?? el.attrs[k];
  }
  return out;
}

// ───────── OpenRocket .ork ─────────

const esc = (t: string) => t.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
const unesc = (t: string) => t.replace(/&(lt|gt|amp|quot|apos);/g, (_m, k: string) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[k] as string);
const POINT_LEN = 0.05;
const ORK_SHAPE: Record<string, [string, number]> = { conical: ["conical", 0], ogive: ["ogive", 1], tangent: ["ogive", 1], vonKarman: ["haack", 0], lvhaack: ["haack", 0.333], parabolic: ["parabolic", 1], elliptical: ["ellipsoid", 0] };

/**
 * 把一枚火箭寫成 OpenRocket 的 XML（rocket.ork 的內容）。
 * 每一段用模型元素的名稱命名，匯回時靠名稱對應；質量與重心以覆寫值（overridemass、overridecg）寫入，讓 OpenRocket 用模型的數字。
 */
export function orkXmlFor(projectName: string, g: RocketGeometry): { xml: string; warnings: string[] } {
  const warnings: string[] = [];
  const outer = g.sections.filter((s) => s.kind === "nose" || s.kind === "body" || s.kind === "transition");
  const inner = g.sections.filter((s) => s.kind === "fins" || s.kind === "mass");
  const tubes = outer.filter((s) => s.kind === "body");
  const hostOf = (s: Section) => tubes.find((t) => s.position >= t.position - 1e-9 && s.position < t.position + t.length - 1e-9) ?? tubes.find((t) => s.position >= t.position) ?? tubes[0];
  const children = new Map<string, Section[]>();
  for (const s of inner) {
    const t = hostOf(s);
    if (!t) { warnings.push(`「${s.name}」找不到可以裝進去的箭體段，沒有匯出。`); continue; }
    if (s.position < t.position || s.position > t.position + t.length) warnings.push(`「${s.name}」不在「${t.name}」的範圍內，匯出時仍放在它底下。`);
    children.set(t.id, [...(children.get(t.id) ?? []), s]);
  }
  const ov = (s: Section, ind: string) => s.mass > 0
    ? `${ind}<overridemass>${fmt(s.mass)}</overridemass>\n${ind}<overridesubcomponentsmass>false</overridesubcomponentsmass>\n${ind}<overridecg>${fmt(s.cg - s.position)}</overridecg>\n`
    : "";
  const parts: string[] = [];
  for (const s of outer) {
    const i = "          ";
    const name = `${i}  <name>${esc(s.name)}</name>\n`;
    if (s.kind === "nose") {
      const [shape, p] = ORK_SHAPE[s.shape ?? "ogive"];
      parts.push(`${i}<nosecone>\n${name}${ov(s, i + "  ")}${i}  <finish>normal</finish>\n${i}  <material type="bulk" density="1250.0">Fiberglass</material>\n${i}  <length>${fmt(s.length)}</length>\n${i}  <thickness>0.002</thickness>\n${i}  <shape>${shape}</shape>\n${i}  <shapeparameter>${p}</shapeparameter>\n${i}  <aftradius>${fmt((s.diameter as number) / 2)}</aftradius>\n${i}</nosecone>`);
    } else if (s.kind === "transition") {
      parts.push(`${i}<transition>\n${name}${ov(s, i + "  ")}${i}  <finish>normal</finish>\n${i}  <material type="bulk" density="1250.0">Fiberglass</material>\n${i}  <length>${fmt(s.length)}</length>\n${i}  <thickness>0.002</thickness>\n${i}  <shape>conical</shape>\n${i}  <shapeparameter>0.0</shapeparameter>\n${i}  <foreradius>${fmt((s.diameter as number) / 2)}</foreradius>\n${i}  <aftradius>${fmt((s.aftDiameter as number) / 2)}</aftradius>\n${i}</transition>`);
    } else {
      const sub = (children.get(s.id) ?? []).map((c) => {
        const j = i + "    ";
        const cn = `${j}  <name>${esc(c.name)}</name>\n`;
        const pos = `${j}  <position type="top">${fmt(c.position - s.position)}</position>\n`;
        if (c.kind === "fins" && c.fin) {
          return `${j}<trapezoidfinset>\n${cn}${ov(c, j + "  ")}${pos}${j}  <finish>normal</finish>\n${j}  <material type="bulk" density="1250.0">Fiberglass</material>\n${j}  <fincount>${c.fin.n}</fincount>\n${j}  <rotation>0.0</rotation>\n${j}  <thickness>0.003</thickness>\n${j}  <crosssection>square</crosssection>\n${j}  <cant>0.0</cant>\n${j}  <rootchord>${fmt(c.fin.rootChord)}</rootchord>\n${j}  <tipchord>${fmt(c.fin.tipChord)}</tipchord>\n${j}  <sweeplength>${fmt(c.fin.sweep)}</sweeplength>\n${j}  <height>${fmt(c.fin.span)}</height>\n${j}</trapezoidfinset>`;
        }
        // 沒有長度的質量項當作一個點：匯出成 5 cm 長、中心在重心的質量件，匯回時再換回來
        const len = c.length > 0 ? c.length : POINT_LEN;
        const mpos = c.length > 0 ? pos : `${j}  <position type="top">${fmt(c.cg - POINT_LEN / 2 - s.position)}</position>\n`;
        return `${j}<masscomponent>\n${cn}${mpos}${j}  <packedlength>${fmt(len)}</packedlength>\n${j}  <packedradius>${fmt((s.diameter as number) * 0.4)}</packedradius>\n${j}  <mass>${fmt(c.mass)}</mass>\n${j}  <masscomponenttype>masscomponent</masscomponenttype>\n${j}</masscomponent>`;
      });
      parts.push(`${i}<bodytube>\n${name}${ov(s, i + "  ")}${i}  <finish>normal</finish>\n${i}  <material type="bulk" density="1250.0">Fiberglass</material>\n${i}  <length>${fmt(s.length)}</length>\n${i}  <thickness>0.002</thickness>\n${i}  <radius>${fmt((s.diameter as number) / 2)}</radius>\n${sub.length ? `${i}  <subcomponents>\n${sub.join("\n")}\n${i}  </subcomponents>\n` : ""}${i}</bodytube>`);
    }
  }
  const xml = `<?xml version='1.0' encoding='utf-8'?>
<openrocket version="1.5" creator="JRI MBSE">
  <rocket>
    <name>${esc(projectName)}</name>
    <referencetype>maximum</referencetype>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
${parts.join("\n")}
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
  <simulations/>
</openrocket>
`;
  return { xml, warnings };
}

interface XNode { tag: string; attrs: Record<string, string>; children: XNode[]; text: string }

/** 很小的 XML 讀取器：只認元素、屬性與文字，夠讀 .ork。 */
export function parseXml(xml: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[6] !== undefined) { top.text += unesc(m[6]); continue; }
    if (!m[3]) continue;
    if (m[2] === "/") { if (stack.length > 1 && top.tag === m[3]) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of (m[4] ?? "").matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unesc(a[2] ?? a[3] ?? "");
    const node: XNode = { tag: m[3], attrs, children: [], text: "" };
    top.children.push(node);
    if (m[5] !== "/") stack.push(node);
  }
  return root;
}
const child = (n: XNode, tag: string) => n.children.find((c) => c.tag === tag);
const numIn = (n: XNode, tag: string): number | null => {
  const t = child(n, tag)?.text.trim().replace(/^auto\s*/, "");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

/** .ork 讀出的一個零件，位置已換成從鼻尖量起 */
export interface OrkPart { kind: GeoKind; name: string; values: Partial<Record<GeoField, string | number>> }

/** 讀 OpenRocket 的 XML：依序把外形零件接起來，算出每個零件從鼻尖量起的位置。只讀第一節（stage）。 */
export function readOrk(xml: string): { parts: OrkPart[]; skipped: string[] } {
  const root = parseXml(xml);
  const or = child(root, "openrocket");
  if (!or) throw new Error("這不是 OpenRocket 的檔案。");
  const stage = child(child(child(or, "rocket") ?? or, "subcomponents") ?? or, "stage");
  const list = child(stage ?? or, "subcomponents")?.children ?? [];
  const parts: OrkPart[] = [], skipped: string[] = [];
  let x = 0, lastRadius: number | null = null;
  const massOf = (n: XNode) => {
    const m = numIn(n, "overridemass") ?? numIn(n, "mass");
    return m === null ? {} : { geoMass: m, ...(numIn(n, "overridecg") !== null ? { geoCg: numIn(n, "overridecg") as number } : {}) };
  };
  const shapeOf = (n: XNode): string => {
    const s = (child(n, "shape")?.text ?? "").trim().toLowerCase(), p = numIn(n, "shapeparameter") ?? 0;
    if (s === "haack") return p > 0.2 ? "lvhaack" : "vonKarman";
    return ({ conical: "conical", ogive: "ogive", parabolic: "parabolic", ellipsoid: "elliptical", power: "parabolic" } as Record<string, string>)[s] ?? "ogive";
  };
  for (const n of list) {
    const name = child(n, "name")?.text.trim() ?? n.tag;
    const len = numIn(n, "length") ?? 0;
    if (n.tag === "nosecone") {
      const r: number | null = numIn(n, "aftradius") ?? lastRadius;
      parts.push({ kind: "nose", name, values: { geoKind: "nose", geoPosition: x, geoLength: len, ...(r ? { geoDiameter: 2 * r } : {}), geoShape: shapeOf(n), ...massOf(n) } });
      lastRadius = r;
    } else if (n.tag === "transition") {
      const r1: number | null = numIn(n, "foreradius") ?? lastRadius, r2: number | null = numIn(n, "aftradius") ?? r1;
      parts.push({ kind: "transition", name, values: { geoKind: "transition", geoPosition: x, geoLength: len, ...(r1 ? { geoDiameter: 2 * r1 } : {}), ...(r2 ? { geoAftDiameter: 2 * r2 } : {}), ...massOf(n) } });
      lastRadius = r2;
    } else if (n.tag === "bodytube") {
      const r: number | null = numIn(n, "radius") ?? numIn(n, "outerradius") ?? lastRadius;
      parts.push({ kind: "body", name, values: { geoKind: "body", geoPosition: x, geoLength: len, ...(r ? { geoDiameter: 2 * r } : {}), ...massOf(n) } });
      lastRadius = r;
      for (const c of child(n, "subcomponents")?.children ?? []) {
        const cname = child(c, "name")?.text.trim() ?? c.tag;
        const posNode = child(c, "position") ?? child(c, "axialoffset");
        const rel = Number(posNode?.text.trim() ?? 0) || 0;
        const method = posNode?.attrs.type ?? posNode?.attrs.method ?? "top";
        const own = c.tag === "trapezoidfinset" ? numIn(c, "rootchord") ?? 0 : numIn(c, "packedlength") ?? numIn(c, "length") ?? 0;
        const abs = Number(fmt(method === "absolute" ? rel : method === "bottom" ? x + len - own + rel : method === "middle" ? x + len / 2 - own / 2 + rel : x + rel));
        if (c.tag === "trapezoidfinset") {
          parts.push({ kind: "fins", name: cname, values: { geoKind: "fins", geoPosition: abs, geoFinCount: numIn(c, "fincount") ?? 3, geoRootChord: own, geoTipChord: numIn(c, "tipchord") ?? 0, geoSpan: numIn(c, "height") ?? 0, geoSweep: numIn(c, "sweeplength") ?? 0, ...massOf(c) } });
        } else if (c.tag === "masscomponent") {
          parts.push({ kind: "mass", name: cname, values: { geoKind: "mass", geoPosition: abs, geoLength: own, ...massOf(c) } });
        } else skipped.push(`${cname}（${c.tag}，不支援）`);
      }
    } else skipped.push(`${name}（${n.tag}，不支援）`);
    if (n.tag === "nosecone" || n.tag === "transition" || n.tag === "bodytube") x += len;
  }
  return { parts, skipped };
}

export interface OrkChange { id: string; name: string; field: GeoField; from: string | number | null; to: string | number }

/**
 * 把 .ork 讀出的零件對到模型的段：先比名稱，再依同種類的順序。回傳要改的欄位。
 * 只改模型裡已經有的段；.ork 多出來的零件列在 unmatched，不自動新增。
 */
export function diffOrk(g: RocketGeometry, elements: Element[], parts: OrkPart[]): { changes: OrkChange[]; unmatched: string[] } {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const used = new Set<string>();
  const changes: OrkChange[] = [], unmatched: string[] = [];
  const pick = (p: OrkPart): Section | undefined => {
    const free = g.sections.filter((s) => !used.has(s.id) && s.kind === p.kind);
    return free.find((s) => s.name === p.name) ?? free.find((s) => !parts.some((o) => o.name === s.name));
  };
  for (const p of parts) {
    const s = pick(p);
    if (!s) { unmatched.push(p.name); continue; }
    used.add(s.id);
    const cur = currentValues(byId.get(s.id) as Element);
    const values = { ...p.values };
    // 匯出時補上的預設值，匯回時不當成修改：沒寫的重心（本段中點）、當作點的質量項
    if (s.kind === "mass" && cur.geoLength === undefined && typeof values.geoLength === "number" && Math.abs(values.geoLength - POINT_LEN) < 1e-9) {
      values.geoPosition = (values.geoPosition as number) + POINT_LEN / 2;
      delete values.geoLength;
    }
    if (cur.geoCg === undefined && typeof values.geoCg === "number" && Math.abs(values.geoCg - (s.cg - s.position)) < 1e-6) delete values.geoCg;
    if (cur.geoMass === undefined && values.geoMass === 0) delete values.geoMass;
    if (values.geoShape === "ogive" && (cur.geoShape === "tangent" || cur.geoShape === undefined)) delete values.geoShape;
    for (const k of GEO_FIELDS) {
      const to = values[k];
      if (to === undefined) continue;
      const from = cur[k] ?? null;
      const same = typeof to === "number" && typeof from === "number" ? Math.abs(to - from) <= 1e-6 * Math.max(1, Math.abs(from)) : String(from) === String(to);
      if (!same) changes.push({ id: s.id, name: s.name, field: k, from, to: typeof to === "number" ? Number(fmt(to)) : to });
    }
  }
  return { changes, unmatched };
}
