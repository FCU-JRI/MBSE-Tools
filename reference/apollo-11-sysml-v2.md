# Apollo 11 SysML v2 Model（參考模型）

這個資料夾旁的 `apollo-11-sysml-v2/` 是第三方的模型，不是本儲存庫作者的作品。

| 項目 | 內容 |
|---|---|
| 來源 | https://github.com/airbus/apollo-11-sysml-v2 |
| 提交 | `0e8a7d6790cfa7e15b991eb745e9a38f9bed0474` |
| 版權 | Copyright (c) 2026 AIRBUS and its affiliates（見每個檔案開頭的聲明） |
| 授權 | Mozilla Public License 2.0，全文在 `apollo-11-sysml-v2/LICENSE.md` |
| 修改 | 沒有修改。28 個模型檔、`LICENSE.md`、`.project.json`、`.meta.json` 逐位元組和上述提交相同 |

沒有放進來的：原儲存庫的說明文件、`scripts/` 底下的程式、GitHub 工作流程與編輯器設定。

`apollo-11-sysml-v2.manifest.json` 記錄每個檔案的 SHA-256。自動測試會核對，建立參考專案時也會核對；不符就不建立。

用途：作為 CoSMA 框架的參考實作，以及本工具「能完整解析並顯示標準 SysML v2 模型」的驗收基準（`docs/COSMA-ADOPTION.md`）。工具把它載入成唯讀的專案，不修改任何檔案。

要更新到上游較新的版本：換掉資料夾的內容、重新產生清單、更新上表的提交，以 PR 提出。
