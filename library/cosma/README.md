# CoSMA 基礎庫（第 C 期，F-82）

- 來源：<https://github.com/airbus/apollo-11-sysml-v2> 的 `CoSMA/` 資料夾，提交 `0e8a7d6790cfa7e15b991eb745e9a38f9bed0474`。
- 授權：Mozilla Public License 2.0（`LICENSE.md`，與每個 `.sysml` 開頭的版權聲明）。
- 三個 `.sysml` 檔原封不動，和 `reference/apollo-11-sysml-v2/CoSMA/` 逐位元組相同（`server/cosma.test.ts` 用參考模型的清單核對）。要改 CoSMA 的寫法，請另開附加庫，不要改這裡。
- 載入方式：模型檔裡提到 `CoSMAPackage` 的專案，工具會把這三個檔案當成共用元件庫載入（唯讀、不出現在專案的檔案清單），副本放在專案的 `lib/cosma/`。其他專案（包括 `rtc-2027`）不載入。
