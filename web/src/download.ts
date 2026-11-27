// 把產生的 SVG 存成檔案下載：SVG 原樣、PNG 以兩倍解析度轉出。模型頁的「匯出 ▾」用（MOD-12）。
function save(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function downloadSvg(svg: string, name: string): void {
  save(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${name}.svg`);
}

export async function downloadPng(svg: string, name: string): Promise<void> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("無法產生圖片。")); img.src = url; });
    const scale = 2;
    const c = document.createElement("canvas");
    c.width = img.width * scale; c.height = img.height * scale;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("瀏覽器不支援匯出圖片。");
    ctx.scale(scale, scale); ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
    if (!blob) throw new Error("無法產生圖片。");
    save(blob, `${name}.png`);
  } finally { URL.revokeObjectURL(url); }
}
