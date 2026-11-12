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
  attrs: Record<string, string>;
  tags: string[]; // 標記（metadata），例如 TPM
  line: number | null;
  endLine: number | null;
}

export interface Relation {
  kind: "derive" | "trace" | "refine" | "satisfy" | "verify" | "allocate" | "succession" | "connect" | "transition";
  from: string;
  to: string;
  line: number | null;
  loc: Loc | null;
  file: string;
}

export interface Extracted {
  elements: Element[];
  relations: Relation[];
}

type Raw = Record<string, any>;

const LIB_PREFIX = "JRI::";
const LINK_KINDS: Record<string, Relation["kind"]> = {
  DeriveLink: "derive",
  TraceLink: "trace",
  RefineLink: "refine",
};

const locOf = (e: Raw | undefined): Loc | null =>
  e && e["sysx:sourceLine"] && e["sysx:sourceEndLine"]
    ? { line: e["sysx:sourceLine"], col: e["sysx:sourceColumn"] ?? 1, endLine: e["sysx:sourceEndLine"], endCol: e["sysx:sourceEndColumn"] ?? 1 }
    : null;

const ref = (v: any): string | null => (v && typeof v === "object" && "@id" in v ? v["@id"] : null);
const refs = (v: any): string[] =>
  Array.isArray(v) ? (v.map(ref).filter(Boolean) as string[]) : ref(v) ? [ref(v) as string] : [];

/** files：專案自己的模型檔；shared：共用元件庫的檔案。其餘（元模型庫、標準庫）不列入。 */
export function extract(raw: Raw[], files: Set<string>, shared: Set<string>): Extracted {
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
  const addTag = (target: string, metaId: string) => {
    const m = byId.get(metaId);
    if (m?.["@type"] !== "MetadataUsage") return;
    for (const t of refs(m.type)) {
      const name = qn(t).split("::").pop() ?? "";
      if (name) tagsOf.set(target, [...(tagsOf.get(target) ?? []), name]);
    }
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

  const NAMED = /(Definition|Usage|Package)$/;
  const elements: Element[] = [];
  for (const e of raw) {
    if (!e.declaredName || !NAMED.test(e["@type"]) || !inProject(e)) continue;
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
    // 內嵌的標記也可能帶值（例如 @VVMethod { kind = ... }）
    for (const m of refs(e.ownedMember)) {
      const meta = byId.get(m);
      if (meta?.["@type"] !== "MetadataUsage") continue;
      for (const f of refs(meta.ownedFeature)) {
        const name = byId.get(f)?.declaredName ?? (generals.get(f) ?? []).map((g) => byId.get(g)?.declaredName).find(Boolean);
        if (name && values.has(f)) attrs[name] = values.get(f) as string;
      }
    }
    elements.push({
      id,
      kind: e["@type"],
      category: categoryOf(id),
      name: e.declaredName,
      shortName: e.declaredShortName ?? null,
      qualifiedName: e["sysx:mappingQualifiedName"] ?? e.qualifiedName ?? e.declaredName,
      owner: ref(e.owner),
      doc: docs.get(id) ?? "",
      types: (generals.get(id) ?? []).map((g) => qn(g).split("::").pop() ?? "").filter(Boolean),
      typeIds: generals.get(id) ?? [],
      file: fileOf(e),
      shared: shared.has(fileOf(e)),
      loc: locOf(e),
      docLoc: docLocs.get(id) ?? null,
      attrLoc,
      attrs,
      tags: [...new Set(tagsOf.get(id) ?? [])],
      line: e["sysx:sourceLine"] ?? null,
      endLine: e["sysx:sourceEndLine"] ?? null,
    });
  }

  const known = new Set(elements.map((e) => e.id));
  const relations: Relation[] = [];
  const push = (kind: Relation["kind"], from: string | null, to: string | null, src: Raw | undefined) => {
    if (from && to && known.has(from) && known.has(to)) relations.push({ kind, from, to, line: src?.["sysx:sourceLine"] ?? null, loc: locOf(src), file: fileOf(src) });
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
      const ends = refs(e.connectorEnd).map((x) => (generals.get(x) ?? [])[0] ?? null);
      push("allocate", ends[0] ?? null, ends[1] ?? null, e);
    } else if (t === "ConnectionUsage" || t === "InterfaceUsage") {
      const ce = refs(e.relatedFeature);
      if (inProject(e)) push("connect", ce[0] ?? null, ce[1] ?? null, e);
    } else if (t === "TransitionUsage") {
      if (inProject(e)) push("transition", ref(e.source), ref(e.target), e);
    } else if (t === "SuccessionAsUsage") {
      push("succession", ref(e.sourceFeature), refs(e.targetFeature)[0] ?? null, e);
    }
  }
  return { elements, relations };
}
