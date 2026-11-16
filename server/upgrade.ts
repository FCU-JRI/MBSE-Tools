// 舊寫法 → SysML v2 標準庫的寫法（F-36）。
// 以前衍生、細化、驗證方法用的是 JRI 自訂的標記；現在改用標準庫（RequirementDerivation、ModelingMetadata、VerificationCases），
// 別的 SysML v2 工具才認得。元模型庫已經不再定義舊標記，所以舊文字要先轉換才能解析：
//   #derive dependency from 子 to 母;        → #derivation connection { end #derive ::> 子; end #original ::> 母; }
//   #refine dependency from 細 to 粗;        → #refinement dependency from 細 to 粗;
//   @VVMethod { kind = Method::byTest; }     → @VerificationMethod { kind = VerificationMethodKind::test; }
// 只改認得的寫法，其餘原樣保留；轉換過的文字再轉一次不會變（可以重複執行）。

const METHOD: Record<string, string> = { byTest: "test", byAnalysis: "analyze", byInspection: "inspect", byDemonstration: "demo" };
/** 介面與舊資料用的方法代號 → 標準庫 VerificationMethodKind 的值；已經是標準值就原樣回傳，不認得回傳 null。 */
export const methodKind = (v: string): string | null => METHOD[v] ?? (Object.values(METHOD).includes(v) ? v : null);

const LEGACY = /#derive\s+dependency|#refine\s+dependency|@VVMethod\b/;
const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);

/** 略過空白與註解，回傳下一個有內容的位置。 */
function skipSpace(s: string, i: number): number {
  for (;;) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s.startsWith("//", i)) { const n = s.indexOf("\n", i); i = n < 0 ? s.length : n; }
    else if (s.startsWith("/*", i)) { const n = s.indexOf("*/", i + 2); i = n < 0 ? s.length : n + 2; }
    else return i;
  }
}

/** 讀一個完整名稱（A::'b c'::d，也接受點號的特徵鏈）；讀不到回傳 null。 */
function readName(s: string, start: number): { text: string; end: number } | null {
  let i = start;
  for (;;) {
    if (s[i] === "'") {
      i++;
      while (i < s.length && s[i] !== "'") i += s[i] === "\\" ? 2 : 1;
      if (i >= s.length) return null;
      i++;
    } else if (/[A-Za-z_]/.test(s[i] ?? "")) {
      while (isWord(s[i])) i++;
    } else return null;
    if (s.startsWith("::", i) && s[i + 2] !== ">") i += 2;
    else if (s[i] === "." && (s[i + 1] === "'" || /[A-Za-z_]/.test(s[i + 1] ?? ""))) i += 1;
    else return { text: s.slice(start, i), end: i };
  }
}

/** 讀以逗號分隔的名稱清單。 */
function readNames(s: string, start: number): { names: string[]; end: number } | null {
  const names: string[] = [];
  let i = skipSpace(s, start);
  for (;;) {
    const n = readName(s, i);
    if (!n) return null;
    names.push(n.text);
    i = skipSpace(s, n.end);
    if (s[i] !== ",") return { names, end: i };
    i = skipSpace(s, i + 1);
  }
}

const keyword = (s: string, i: number, word: string) => (s.startsWith(word, i) && !isWord(s[i + word.length]) ? i + word.length : -1);

/** 從「#derive」開始讀一整句舊的衍生相依；不是預期的形狀就回傳 null（保留原文）。 */
function derivation(s: string, start: number, indent: string): { text: string; end: number } | null {
  let i = keyword(s, start, "#derive");
  if (i < 0) return null;
  i = keyword(s, skipSpace(s, i), "dependency");
  if (i < 0) return null;
  i = skipSpace(s, i);
  if (keyword(s, i, "from") < 0) return null; // 有名字的相依很少見，不猜
  const clients = readNames(s, i + 4);
  if (!clients) return null;
  i = keyword(s, clients.end, "to");
  if (i < 0) return null;
  const suppliers = readNames(s, i);
  if (!suppliers || s[suppliers.end] !== ";") return null;
  const lines: string[] = [];
  for (const c of clients.names) for (const p of suppliers.names) lines.push(`#derivation connection { end #derive ::> ${c}; end #original ::> ${p}; }`);
  return { text: lines.join(`\n${indent}`), end: suppliers.end + 1 };
}

export function upgradeText(text: string): string {
  if (!LEGACY.test(text)) return text;
  let out = "";
  let i = 0;
  let lineStart = 0; // 目前這一行在 text 裡的起點，用來取得縮排
  const copy = (to: number) => { out += text.slice(i, to); i = to; };
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") { copy(i + 1); lineStart = i; continue; }
    // 註解、字串、帶引號的名稱裡面的內容不動
    if (text.startsWith("//", i)) { const n = text.indexOf("\n", i); copy(n < 0 ? text.length : n); continue; }
    if (text.startsWith("/*", i)) { const n = text.indexOf("*/", i + 2); const end = n < 0 ? text.length : n + 2; const nl = text.lastIndexOf("\n", end - 1); copy(end); if (nl >= lineStart) lineStart = nl + 1; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      copy(Math.min(j + 1, text.length));
      continue;
    }
    if (c === "#" && keyword(text, i, "#derive") > 0) {
      const lead = text.slice(lineStart, i);
      const d = derivation(text, i, /^\s*$/.test(lead) ? lead : "");
      if (d) { out += d.text; i = d.end; continue; }
    }
    if (c === "#" && keyword(text, i, "#refine") > 0 && keyword(text, skipSpace(text, i + 7), "dependency") > 0) { out += "#refinement"; i += 7; continue; }
    if (c === "@" && keyword(text, i, "@VVMethod") > 0) {
      const m = /^@VVMethod\s*\{\s*kind\s*=\s*(?:JRI::)?Method::(byTest|byAnalysis|byInspection|byDemonstration)\s*;\s*\}/.exec(text.slice(i, i + 200));
      if (m) { out += `@VerificationMethod { kind = VerificationMethodKind::${METHOD[m[1]]}; }`; i += m[0].length; continue; }
    }
    copy(i + 1);
  }
  return out;
}
