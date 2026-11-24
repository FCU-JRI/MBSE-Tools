// 模型頁左欄用的框架資料（MOD-02）：層的順序、名稱、每層會產生的類別都讀框架定義檔（framework/jri.json），程式裡不寫層名與類別。
// 進度、對象、警告一律用伺服器算好的 view.framework，這裡不另外判斷。
import raw from "../../../../framework/jri.json";

interface FStep { id: string; produces?: string[] }
interface FLayer { id: string; order: number; zh: string; kind: "chain" | "loop"; steps?: FStep[]; before?: FStep[]; after?: FStep[]; loopSteps?: string[]; loopProduces?: string[] }
interface FFile { layers: FLayer[]; designLoop: { steps: FStep[] } }

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
