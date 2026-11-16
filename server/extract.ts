// 把 SysML v2 API JSON（解析器輸出）整理成工具使用的元素與關係。
// 歸類規則：元素的型別或一般化鏈上出現 JRI::X，就歸為類別 X。

/** 原始碼位置。欄位以 UTF-8 位元組計、從 1 起算，結尾不含。 */
export interface Loc { line: number; col: number; endLine: number; endCol: number }

export interface Element {
  id: string;
  kind: string; // SysML 元類別，例如 RequirementUsage
  category: string | null; // JRI 類別，例如 SystemRequirement
  name: string;
  shortName: string | null;
  qualifiedName: string;
  owner: string | null;
  doc: string;
  types: string[]; // 型別或一般化對象的名稱
  typeIds: string[];
  file: string; // 所在檔案
  shared: boolean; // 來自共用元件庫，專案內唯讀
  loc: Loc | null;
  docLoc: Loc | null;
  attrLoc: Record<string, Loc>;
  metaLoc: Record<string, Loc>; // 寫在主體內的標記（@Source 等）的位置
  attrs: Record<string, string>;
  tags: string[]; // 標記（metadata），例如 TPM
  about: string[]; // 註解（Comment）所說明的元素
  line: number | null;
  endLine: number | null;
  /** 主體裡有沒有寫 subject。stakeholder 與 actor 前面一定要先有 subject */
  hasSubject?: boolean;
  /** SysML v2 的關鍵字，例如 part def、perform action、snapshot（F-71） */
  keyword?: string;
  /** 樹上的上層：最近的、有列出來的擁有者；最上層是 null（F-71） */
  parent?: string | null;
  /** 沒有自己名字的使用（F-71）。name 取自被重定義的特徵，取不到就用原始碼的第一行 */
  unnamed?: true;
}

/**
 * 通用的關係（F-71）：特化、由誰定義、子集、重定義、參照、執行。和 Relation 分開，現有的畫面與檢查不讀這裡。
 * to：對象有列出來就是它的 id；對象在標準庫或沒有列出來時是 null，名稱在 toName。
 */
export interface Link {
  kind: "specialize" | "type" | "subset" | "redefine" | "reference" | "perform";
  from: string;
  to: string | null;
  toName: string;
  file: string;
  line: number | null;
}

export interface Relation {
  kind: "derive" | "trace" | "refine" | "satisfy" | "verify" | "allocate" | "succession" | "connect" | "transition" | "include";
  from: string;
  to: string;
  /** 追溯到利害關係人時，是不是用語言內建的寫法：需求裡的 stakeholder，或使用案例裡的 actor（F-37）。相依（#trace）沒有這個欄位 */
  form?: "stakeholder" | "actor";
  line: number | null;
  loc: Loc | null;
  /** 這條關係所在的整句原始碼；只有和其他關係共用一句時（一條衍生連結掛多個子需求）才和 loc 不同 */
  outer?: Loc | null;
  file: string;
}

export interface Extracted {
  elements: Element[];
  relations: Relation[];
  /** 沒有名字、但有意義的使用（重定義的零件與屬性、perform、require constraint 等）。不在 elements 裡 */
  unnamed: Element[];
  links: Link[];
}

type Raw = Record<string, any>;

const LIB_PREFIX = "JRI::";
// 相依（dependency）上的標記 → 關係種類。Refinement 是標準庫 ModelingMetadata 的；TraceLink 是 JRI 自訂的。
const LINK_KINDS: Record<string, Relation["kind"]> = {
  TraceLink: "trace",
  Refinement: "refine",
};
// 衍生用標準庫 RequirementDerivation 的連結：連結本身標 #derivation，兩端分別標 #original（母）與 #derive（子）
const DERIVATION = "DerivationMetadata", ORIGINAL = "OriginalRequirementMetadata", DERIVED = "DerivedRequirementMetadata";
// 標準庫標記的短名稱 → 定義名稱。標準庫的定義不在解析器的輸出裡，只能從原始碼上寫的名稱辨認
const STANDARD: Record<string, string> = { derivation: DERIVATION, original: ORIGINAL, derive: DERIVED, refinement: "Refinement" };
const NAME = "(?:[A-Za-z_]\\w*|'(?:[^'\\\\]|\\\\.)*')";
const TAG_TEXT = new RegExp(`^[#@]\\s*(${NAME}(?:::${NAME})*)`);
const FEATURE_TEXT = new RegExp(`^(?::>>\\s*)?(${NAME})`);

// ───────── 通用的資訊（F-71）─────────
// 元類別 → 關鍵字。沒列在這裡的由名稱推出：PartDefinition → part def、UseCaseUsage → use case
const KEYWORDS: Record<string, string> = {
  Package: "package", LibraryPackage: "library package", Comment: "comment",
  CalculationDefinition: "calc def", CalculationUsage: "calc", AnalysisCaseDefinition: "analysis def", AnalysisCaseUsage: "analysis",
  VerificationCaseDefinition: "verification def", VerificationCaseUsage: "verification", EnumerationDefinition: "enum def", EnumerationUsage: "enum",
  ConjugatedPortDefinition: "port def", PerformActionUsage: "perform action", ExhibitStateUsage: "exhibit state", AssertConstraintUsage: "assert constraint",
  AcceptActionUsage: "accept", SendActionUsage: "send", IncludeUseCaseUsage: "include use case", EventOccurrenceUsage: "event occurrence", ReferenceUsage: "ref",
};
/** 沒有名字也不列出來的使用：參數與標記是內部構造；滿足、先後、轉換、分配、包含已經是關係。 */
const NOT_LISTED = new Set(["ReferenceUsage", "MetadataUsage", "SatisfyRequirementUsage", "SuccessionAsUsage", "TransitionUsage", "AllocationUsage", "IncludeUseCaseUsage"]);
const LINK_TYPES: Record<string, Link["kind"]> = { Subclassification: "specialize", FeatureTyping: "type", ConjugatedPortTyping: "type", Subsetting: "subset", Redefinition: "redefine", ReferenceSubsetting: "reference" };
// 宣告上寫的對象：`:>> a`、`::> a`、`:> a, b`、`: A`，以及對應的關鍵字寫法。標準庫的元素不在輸出裡，名稱只能從這裡讀
const WRITTEN = new RegExp(`(?<!:)(:>>|::>|:>|:(?![:>])|\\b(?:specializes|subsets|redefines|references|defined\\s+by|typed\\s+by)\\b)\\s*(~?${NAME}(?:::${NAME})*(?:\\s*,\\s*~?${NAME}(?:::${NAME})*)*)`, "g");
const WRITTEN_KIND: Record<string, Link["kind"][]> = { ":>>": ["redefine"], redefines: ["redefine"], "::>": ["reference"], references: ["reference"], ":>": ["specialize", "subset"], specializes: ["specialize"], subsets: ["subset"], ":": ["type"], "defined by": ["type"], "typed by": ["type"] };
const lastName = (q: string) => q.split("::").pop() ?? "";

// 需求與案例的參數，關鍵字是它的角色（規範 8.2.2.21、8.2.2.22）
const ROLE_KEYWORD: Record<string, string> = { SubjectMembership: "subject", ActorMembership: "actor", StakeholderMembership: "stakeholder", ObjectiveMembership: "objective" };
function keywordOf(e: Raw, text: string, membership = ""): string {
  if (ROLE_KEYWORD[membership]) return ROLE_KEYWORD[membership];
  const t: string = e["@type"];
  let k = KEYWORDS[t] ?? t.replace(/(Usage|Definition)$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() + (t.endsWith("Definition") ? " def" : "");
  if (t === "OccurrenceUsage" && e.portionKind) k = String(e.portionKind);
  else if (t === "ConstraintUsage") k = /^\s*assume\b/.test(text) ? "assume constraint" : /^\s*require\b/.test(text) ? "require constraint" : k;
  else if (t === "PerformActionUsage" && !/^\s*perform\s+action\b/.test(text) && text.trim()) k = "perform";
  else if (t === "ReferenceUsage" && e.direction) return String(e.direction);
  // 前綴照文法的順序：方向、abstract、end、ref、individual
  if (e.isIndividual && !e.portionKind) k = `individual ${k}`;
  // ref 與 abstract 以原始碼上有沒有寫為準：列舉定義等在語意上是抽象的，但那不是使用者寫的
  const prefix = (word: string) => new RegExp(`^\\s*(?:(?:in|out|inout|private|protected|public|abstract|readonly|derived|end|variation)\\s+)*${word}\\b`).test(text);
  if (t.endsWith("Usage") && t !== "ReferenceUsage") {
    if (prefix("ref") || (!text.trim() && e.isReference)) k = `ref ${k}`;
    if (e.isEnd) k = `end ${k}`;
  }
  if (prefix("abstract")) k = `abstract ${k}`;
  if (t.endsWith("Usage") && t !== "ReferenceUsage" && e.direction) k = `${e.direction} ${k}`;
  return k;
}

const locOf = (e: Raw | undefined): Loc | null =>
  e && e["sysx:sourceLine"] && e["sysx:sourceEndLine"]
    ? { line: e["sysx:sourceLine"], col: e["sysx:sourceColumn"] ?? 1, endLine: e["sysx:sourceEndLine"], endCol: e["sysx:sourceEndColumn"] ?? 1 }
    : null;

const ref = (v: any): string | null => (v && typeof v === "object" && "@id" in v ? v["@id"] : null);
const refs = (v: any): string[] =>
  Array.isArray(v) ? (v.map(ref).filter(Boolean) as string[]) : ref(v) ? [ref(v) as string] : [];

/**
 * files：專案自己的模型檔；shared：共用元件庫的檔案。其餘（元模型庫、標準庫）不列入。
 * textOf：某個位置開始的那一行原始碼，用來讀標準庫標記的名稱。
 * only：整份輸出只來自一個檔案時的檔名。解析器只在有兩個以上的檔案時才標示每個套件來自哪個檔。
 */
export function extract(raw: Raw[], files: Set<string>, shared: Set<string>, textOf: (file: string, loc: Loc) => string = () => "", only = ""): Extracted {
  const byId = new Map<string, Raw>();
  for (const e of raw) byId.set(e["@id"], e);

  const qn = (id: string | null): string => {
    const e = id ? byId.get(id) : undefined;
    return e?.["sysx:mappingQualifiedName"] ?? e?.qualifiedName ?? "";
  };
  // 只有最上層套件帶檔名，其餘沿著 owner 往上找
  const fileCache = new Map<string, string>();
  const fileOf = (e: Raw | undefined): string => {
    const chain: string[] = [];
    let cur = e;
    let found = "";
    for (let i = 0; cur && i < 40; i++) {
      const id = cur["@id"];
      if (fileCache.has(id)) { found = fileCache.get(id) as string; break; }
      chain.push(id);
      if (cur["sysx:sourceDocument"]) { found = String(cur["sysx:sourceDocument"]); break; }
      cur = byId.get(ref(cur.owner) ?? ref(cur.owningRelatedElement) ?? "");
    }
    found ||= only;
    for (const id of chain) fileCache.set(id, found);
    return found;
  };
  const inProject = (e: Raw): boolean => { const f = fileOf(e); return files.has(f) || shared.has(f); };

  // 一般化：元素 → 它的型別、父定義、被重定義的特徵
  const generals = new Map<string, string[]>();
  for (const e of raw) {
    const t = e["@type"];
    if (t === "FeatureTyping" || t === "Subclassification" || t === "Redefinition" || t === "Subsetting" || t === "ReferenceSubsetting") {
      const s = ref(e.specific);
      const g = ref(e.general);
      if (s && g) generals.set(s, [...(generals.get(s) ?? []), g]);
    }
  }
  const categoryOf = (id: string): string | null => {
    const seen = new Set<string>();
    const queue = [...(generals.get(id) ?? [])];
    while (queue.length) {
      const g = queue.shift() as string;
      if (seen.has(g)) continue;
      seen.add(g);
      const q = qn(g);
      if (q.startsWith(LIB_PREFIX) && !q.slice(LIB_PREFIX.length).includes("::")) return q.slice(LIB_PREFIX.length);
      queue.push(...(generals.get(g) ?? []));
    }
    return null;
  };

  // 說明文字
  const docs = new Map<string, string>();
  const docLocs = new Map<string, Loc>();
  for (const e of raw) {
    if (e["@type"] === "Documentation") {
      const o = ref(e.owner);
      if (o) docs.set(o, [docs.get(o), String(e.body ?? "").trim()].filter(Boolean).join("\n"));
      const dl = locOf(e);
      if (o && dl && !docLocs.has(o)) docLocs.set(o, dl);
    }
  }

  // 特徵的值：FeatureValue → 運算式的原始文字
  const values = new Map<string, string>();
  for (const e of raw) {
    if (e["@type"] !== "FeatureValue") continue;
    const f = ref(e.featureWithValue);
    const v = byId.get(ref(e.value) ?? "");
    if (!f || !v) continue;
    const text = v["@type"] === "LiteralString" ? String(v.value) : String(v["sysx:sourceText"] ?? v.value ?? "").trim();
    values.set(f, text);
  }

  // 標記：Annotation 把 MetadataUsage 連到被標記的元素；直接寫在主體內的 @X 則以 owner 為對象
  const tagsOf = new Map<string, string[]>();
  /** 標記的定義名稱。專案或 JRI 庫定義的直接取名稱；標準庫的從原始碼讀（#derivation、@VerificationMethod）。 */
  const typeNames = (m: Raw): string[] => {
    const named = refs(m.type).map((t) => qn(t).split("::").pop() ?? "").filter(Boolean);
    if (named.length) return named;
    const l = locOf(m);
    const last = (l ? TAG_TEXT.exec(textOf(fileOf(m), l))?.[1] : undefined)?.split("::").pop() ?? "";
    return last ? [STANDARD[last] ?? last] : [];
  };
  const addTag = (target: string, metaId: string) => {
    const m = byId.get(metaId);
    if (m?.["@type"] !== "MetadataUsage") return;
    for (const name of typeNames(m)) tagsOf.set(target, [...(tagsOf.get(target) ?? []), name]);
  };
  for (const e of raw) {
    if (e["@type"] === "Annotation") {
      const target = ref(e.annotatedElement) ?? ref(e.owningRelatedElement);
      const meta = ref(e.annotatingElement) ?? refs(e.ownedRelatedElement)[0];
      if (target && meta) addTag(target, meta);
    } else if (e["@type"] === "MetadataUsage") {
      // 前綴標記（#tpm attribute ...）不一定有 Annotation，以 owner 為對象
      const o = ref(e.owner);
      if (o) addTag(o, e["@id"]);
    }
  }

  const withSubject = new Set(raw.filter((e) => e["@type"] === "SubjectMembership").map((e) => ref(e.owner) ?? ref(e.owningRelatedElement) ?? ""));
  const NAMED = /(Definition|Usage|Package|^Comment)$/;
  // 元素的原始碼：解析器只對一部分元素附上全文，其餘的從位置讀它開頭的那一行
  const textAt = (e: Raw | undefined): string => {
    if (!e) return "";
    if (e["sysx:sourceText"]) return String(e["sysx:sourceText"]);
    const l = locOf(e);
    return l ? textOf(fileOf(e), l) : "";
  };
  // 有列出來的元素：具名的，加上沒有名字但有意義的使用（F-71）
  const namedRaw = raw.filter((e) => e.declaredName && NAMED.test(e["@type"]) && inProject(e));
  // 需求衍生的連結、沒有名字的 stakeholder／actor／subject 參數也已經是關係，不重複列
  const unnamedRaw = raw.filter((e) => !e.declaredName && /Usage$/.test(e["@type"]) && !NOT_LISTED.has(e["@type"]) && inProject(e)
    && !(e["@type"] === "ConnectionUsage" && (tagsOf.get(e["@id"]) ?? []).includes(DERIVATION))
    && !ROLE_KEYWORD[byId.get(ref(e.owningMembership) ?? "")?.["@type"] ?? ""]);
  const listed = new Set([...namedRaw, ...unnamedRaw].map((e) => e["@id"] as string));
  const parentOf = (e: Raw): string | null => {
    let cur = byId.get(ref(e.owner) ?? ref(e.owningRelatedElement) ?? "");
    for (let i = 0; cur && i < 40; i++) {
      if (listed.has(cur["@id"])) return cur["@id"];
      cur = byId.get(ref(cur.owner) ?? ref(cur.owningRelatedElement) ?? "");
    }
    return null;
  };
  const build = (e: Raw, name: string): Element => {
    const id = e["@id"];
    const attrs: Record<string, string> = {};
    const attrLoc: Record<string, Loc> = {};
    for (const m of refs(e.ownedMember)) {
      const child = byId.get(m);
      // 重定義的值（:>> x = ...）在輸出中是 ReferenceUsage，只有推導出的 name
      if (!child || !/^(Attribute|Reference)Usage$/.test(child["@type"])) continue;
      const redefined = (generals.get(m) ?? []).map((g) => byId.get(g)?.declaredName).find(Boolean);
      const name = child.declaredName ?? child.name ?? redefined;
      if (name && values.has(m)) {
        attrs[name] = values.get(m) as string;
        const l = locOf(child);
        if (l) attrLoc[name] = l;
      }
    }
    // 內嵌的標記也可能帶值（例如 @VerificationMethod { kind = ... }）
    const metaLoc: Record<string, Loc> = {};
    for (const m of refs(e.ownedMember)) {
      const meta = byId.get(m);
      if (meta?.["@type"] !== "MetadataUsage") continue;
      const ml = locOf(meta);
      for (const tn of typeNames(meta)) if (ml) metaLoc[tn] = ml;
      for (const f of refs(meta.ownedFeature)) {
        // 標準庫標記的欄位（例如 VerificationMethod 的 kind）在輸出裡沒有名稱，從原始碼讀
        const fl = locOf(byId.get(f));
        const name = byId.get(f)?.declaredName ?? (generals.get(f) ?? []).map((g) => byId.get(g)?.declaredName).find(Boolean)
          ?? (fl ? FEATURE_TEXT.exec(textOf(fileOf(byId.get(f)), fl))?.[1] : undefined);
        if (name && values.has(f)) attrs[name] = values.get(f) as string;
      }
    }
    return {
      id,
      kind: e["@type"],
      category: categoryOf(id),
      name,
      shortName: e.declaredShortName ?? null,
      qualifiedName: e["sysx:mappingQualifiedName"] ?? e.qualifiedName ?? name,
      owner: ref(e.owner),
      doc: e["@type"] === "Comment" ? String(e.body ?? "").trim() : docs.get(id) ?? "",
      types: (generals.get(id) ?? []).map((g) => qn(g).split("::").pop() ?? "").filter(Boolean),
      typeIds: generals.get(id) ?? [],
      file: fileOf(e),
      shared: shared.has(fileOf(e)),
      loc: locOf(e),
      docLoc: docLocs.get(id) ?? null,
      attrLoc,
      metaLoc,
      attrs,
      tags: [...new Set(tagsOf.get(id) ?? [])],
      about: e["@type"] === "Comment" ? refs(e.annotatedElement) : [],
      line: e["sysx:sourceLine"] ?? null,
      endLine: e["sysx:sourceEndLine"] ?? null,
      ...(withSubject.has(id) ? { hasSubject: true } : {}),
    };
  };
  const general = (el: Element): Element => { const r = byId.get(el.id) as Raw; return { ...el, keyword: keywordOf(r, textAt(r), byId.get(ref(r.owningMembership) ?? "")?.["@type"]), parent: parentOf(r) }; };
  const elements: Element[] = namedRaw.map((e) => general(build(e, e.declaredName)));
  const unnamed: Element[] = unnamedRaw.map((e) => {
    // 名稱：被重定義的特徵（解析器已經推出來）→ 原始碼的第一行 → 關鍵字
    const first = textAt(e).trim().split("\n")[0].replace(/\s*[{;]\s*$/, "").slice(0, 80);
    return { ...general(build(e, String(e.name ?? (first || keywordOf(e, textAt(e)))))), unnamed: true as const };
  });

  // 通用的關係（F-71）
  const links: Link[] = [];
  const nameOf = (id: string): string => { const x = byId.get(id); return lastName(qn(id)) || String(x?.declaredName ?? x?.name ?? ""); };
  const writtenCache = new Map<string, Partial<Record<Link["kind"], string[]>>>();
  const written = (id: string): Partial<Record<Link["kind"], string[]>> => {
    let w = writtenCache.get(id);
    if (!w) {
      w = {};
      const head = textAt(byId.get(id)).split(/[{;=]/)[0];
      for (const m of head.matchAll(WRITTEN)) {
        const names = m[2].split(",").map((x) => lastName(x.trim().replace(/^~/, ""))).filter(Boolean);
        for (const k of WRITTEN_KIND[m[1].replace(/\s+/g, " ")] ?? []) w[k] = [...(w[k] ?? []), ...names];
      }
      writtenCache.set(id, w);
    }
    return w;
  };
  const nth = new Map<string, number>();
  for (const e of raw) {
    const kind = LINK_TYPES[e["@type"]];
    const from = ref(e.specific);
    if (!kind || e.isImplied || !from || !listed.has(from)) continue;
    const key = `${from} ${kind}`, i = nth.get(key) ?? 0;
    nth.set(key, i + 1);
    const g = ref(e.general);
    const src = byId.get(from);
    links.push({ kind, from, to: g && listed.has(g) ? g : null, toName: (g && byId.has(g) ? nameOf(g) : "") || written(from)[kind]?.[i] || "", file: fileOf(src), line: src?.["sysx:sourceLine"] ?? null });
  }
  // 執行：零件（或它的定義）執行某個動作。`perform a.b;` 指向別處的動作；`perform action x : X;` 執行的就是它自己
  for (const e of raw) {
    if (e["@type"] !== "PerformActionUsage" || !listed.has(e["@id"])) continue;
    const from = parentOf(e);
    if (!from) continue;
    const sub = byId.get(ref(e.ownedReferenceSubsetting) ?? "");
    const target = ref(sub?.referencedFeature) ?? ref(sub?.general) ?? e["@id"];
    links.push({ kind: "perform", from, to: listed.has(target) ? target : null, toName: nameOf(target), file: fileOf(e), line: e["sysx:sourceLine"] ?? null });
  }

  const known = new Set(elements.map((e) => e.id));
  const relations: Relation[] = [];
  const push = (kind: Relation["kind"], from: string | null, to: string | null, src: Raw | undefined, whole?: Raw, form?: Relation["form"]) => {
    if (from && to && known.has(from) && known.has(to)) relations.push({ kind, from, to, ...(form ? { form } : {}), line: src?.["sysx:sourceLine"] ?? null, loc: locOf(src), outer: whole ? locOf(whole) : null, file: fileOf(src) });
  };
  // 往上找到第一個已知的具名元素
  const namedOwner = (id: string | null): string | null => {
    let cur = id;
    for (let i = 0; cur && i < 20; i++) {
      if (known.has(cur)) return cur;
      cur = ref(byId.get(cur)?.owner);
    }
    return null;
  };

  for (const e of raw) {
    const t = e["@type"];
    if (t === "Dependency") {
      if (!inProject(e)) continue;
      const tags = tagsOf.get(e["@id"]) ?? [];
      const kind = tags.map((x) => LINK_KINDS[x]).find(Boolean) ?? "trace";
      for (const c of refs(e.client)) for (const s of refs(e.supplier)) push(kind, c, s, e);
    } else if (t === "StakeholderMembership" || t === "ActorMembership") {
      // 語言內建的寫法：需求裡的 stakeholder、使用案例裡的 actor。參數本身通常沒有名字，指向的利害關係人才是關係的對象
      const param = byId.get(ref(e.ownedMemberElement) ?? "");
      if (!param || !inProject(param)) continue;
      const target = (generals.get(param["@id"]) ?? []).find((g) => known.has(g)) ?? null;
      push("trace", namedOwner(ref(e.owner) ?? ref(e.owningRelatedElement)), target, param, undefined, t === "ActorMembership" ? "actor" : "stakeholder");
    } else if (t === "IncludeUseCaseUsage") {
      if (!inProject(e)) continue;
      const sub = byId.get(ref(e.ownedReferenceSubsetting) ?? "");
      push("include", namedOwner(ref(e.owner)), ref(sub?.referencedFeature) ?? ref(sub?.general) ?? null, e);
    } else if (t === "SatisfyRequirementUsage") {
      const req = ref(e.subsets) ?? (generals.get(e["@id"]) ?? [])[0] ?? null;
      // 寫在定義主體內的 satisfy 沒有明示滿足者，以所在的元素為準
      const by = ref(e.subject);
      push("satisfy", by && known.has(by) ? by : namedOwner(ref(e.owner)), req, e);
    } else if (t === "RequirementVerificationMembership") {
      const member = ref(e.ownedMemberElement) ?? ref(e.memberElement);
      const req = member ? (generals.get(member) ?? [])[0] ?? null : null;
      push("verify", namedOwner(ref(e.owningRelatedElement)), req, byId.get(member ?? ""));
    } else if (t === "AllocationUsage") {
      // 端點引用的可能是特徵鏈（mission.detect），取鏈上最後一個才是真正的對象
      const ends = refs(e.connectorEnd).map((x) => {
        const g = (generals.get(x) ?? [])[0] ?? null;
        const chain = g ? refs(byId.get(g)?.chainingFeature) : [];
        return chain.length ? chain[chain.length - 1] : g;
      });
      push("allocate", ends[0] ?? null, ends[1] ?? null, e);
    } else if (t === "ConnectionUsage" && (tagsOf.get(e["@id"]) ?? []).includes(DERIVATION)) {
      if (!inProject(e)) continue;
      const ends = refs(e.ownedFeature).map((f) => {
        const end = byId.get(f);
        const sub = byId.get(ref(end?.ownedReferenceSubsetting) ?? "");
        return { end, tags: tagsOf.get(f) ?? [], target: ref(sub?.referencedFeature) ?? ref(sub?.general) ?? null };
      });
      const original = ends.find((x) => x.tags.includes(ORIGINAL))?.target ?? null;
      const derived = ends.filter((x) => x.tags.includes(DERIVED));
      // 一條連結可以有多個子需求；刪除其中一條時只拿掉那一端，所以位置記在端點上
      for (const d of derived) push("derive", d.target, original, derived.length > 1 ? d.end : e, e);
    } else if (t === "ConnectionUsage" || t === "InterfaceUsage") {
      const ce = refs(e.relatedFeature);
      if (inProject(e)) push("connect", ce[0] ?? null, ce[1] ?? null, e);
    } else if (t === "TransitionUsage") {
      if (inProject(e)) push("transition", ref(e.source), ref(e.target), e);
    } else if (t === "SuccessionAsUsage") {
      push("succession", ref(e.sourceFeature), refs(e.targetFeature)[0] ?? null, e);
    }
  }
  return { elements, relations, unnamed, links };
}
