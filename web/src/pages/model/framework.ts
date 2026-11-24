// 模型頁左欄用的框架資料（MOD-02）：層的順序、名稱、每層會產生的類別都讀框架定義檔（framework/jri.json），程式裡不寫層名與類別。
// 進度、對象、警告一律用伺服器算好的 view.framework，這裡不另外判斷。
import raw from "../../../../framework/jri.json";

interface FStep { id: string; produces?: string[]; done?: { check: string }; derivedFrom?: string[]; basisFrom?: string }
interface FLayer { id: string; order: number; zh: string; kind: "chain" | "loop"; subject: string; steps?: FStep[]; before?: FStep[]; after?: FStep[]; loopSteps?: string[]; loopProduces?: string[] }
interface FFile { layers: FLayer[]; designLoop: { steps: FStep[] }; elementTypes: { id: string; status: string }[] }

const file = raw as FFile;

/** 一層會產生的類別，依框架檔裡出現的順序、不重複：鏈狀步驟／迴圈前的步驟 → 迴圈本身的產出 → 迴圈各步 → 迴圈後的步驟。 */
export function layerProduces(layerId: string): string[] {
  const l = file.layers.find((x) => x.id === layerId);
  if (!l) return [];
  const loop = l.kind === "loop" ? file.designLoop.steps.filter((s) => (l.loopSteps ?? []).includes(s.id)) : [];
  const list = [...(l.steps ?? []), ...(l.before ?? [])].flatMap((s) => s.produces ?? [])
    .concat(l.loopProduces ?? [], loop.flatMap((s) => s.produces ?? []), (l.after ?? []).flatMap((s) => s.produces ?? []));
  return [...new Set(list)];
}

/** 框架檔的層（只給順序與名稱；view.framework 沒有時用） */
export const fileLayers = () => [...file.layers].sort((a, b) => a.order - b.order).map((l) => ({ id: l.id, order: l.order, zh: l.zh, kind: l.kind }));

/**
 * 框架的檢查要靠哪些關係才判得出來（檢查名稱是框架檔 done.check 的值）。
 * 步驟寫了 derivedFrom＝要「衍生」、basisFrom＝要「設計依據」，這兩個直接讀框架檔，不在這張表。
 */
const CHECK_LINKS: Record<string, string[]> = {
  expectationTracesStakeholder: ["trace"], stakeholderInUseCase: ["trace"], tracedAndVerifiable: ["derive", "trace"],
  functionAllocated: ["allocate"], twoSources: ["derive", "basis"], hasAlternative: ["trace"], tradeSelected: ["trace"],
  constraintsPassAndApproved: ["satisfy"],
};

/** 工具箱（MOD-14）：這一層的框架自動化需要哪些元素與關係。元素＝本層產生、且是模型元素的類型（elementTypes 裡不是 record）。 */
export function layerTools(layerId: string): { cats: string[]; links: string[] } {
  const l = file.layers.find((x) => x.id === layerId);
  if (!l) return { cats: [], links: [] };
  const record = new Set(file.elementTypes.filter((t) => t.status === "record").map((t) => t.id));
  const known = new Set(file.elementTypes.map((t) => t.id));
  const cats = layerProduces(layerId).filter((c) => known.has(c) && !record.has(c));
  const loop = l.kind === "loop" ? file.designLoop.steps.filter((s) => (l.loopSteps ?? []).includes(s.id)) : [];
  const links = new Set<string>();
  for (const s of [...(l.steps ?? []), ...(l.before ?? []), ...loop, ...(l.after ?? [])]) {
    if (s.derivedFrom?.length) links.add("derive");
    if (s.basisFrom) links.add("basis");
    for (const k of CHECK_LINKS[s.done?.check ?? ""] ?? []) links.add(k);
  }
  return { cats, links: [...links] };
}

/**
 * 這張圖在哪一層：
 * 1. 圖有對象（內部連接圖的系統、活動圖的任務、狀態機的模式）：對象類別是哪層迴圈的 subject 就是那層，否則是第一個產生這個類別的層；
 * 2. 沒有對象：看這張圖能顯示的類別由哪些層產生；目前所在的層也在其中就用它，否則用產生最多的那層（同數取前面的）；
 * 3. 都看不出來（自訂圖）：目前所在的層。
 */
export function diagramLayer(contextCategory: string | null, paletteCats: string[], current: string | null): string | null {
  const layers = [...file.layers].sort((a, b) => a.order - b.order);
  if (contextCategory) {
    const hit = layers.find((l) => l.kind === "loop" && l.subject === contextCategory) ?? layers.find((l) => layerProduces(l.id).includes(contextCategory));
    if (hit) return hit.id;
  }
  const scored = layers.map((l) => ({ id: l.id, n: layerProduces(l.id).filter((c) => paletteCats.includes(c)).length })).filter((x) => x.n > 0);
  if (!scored.length) return current;
  if (scored.some((x) => x.id === current)) return current;
  return scored.reduce((best, x) => (x.n > best.n ? x : best)).id;
}
