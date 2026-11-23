# Google 登入設定

公開埠（8788，經 Tailscale Funnel）的成員改用 Google 帳號登入。用的是 OpenID Connect 授權碼流程，只要 `openid`、`email`、`profile` 三個範圍，不讀 Gmail、雲端硬碟或任何其他資料。私人網路（Tailscale，8787）的免登入行為不變。

Client secret 只由管理員自己填進樹莓派，不經任何對話、PR 或檔案傳遞。

## 1. 在 Google Cloud Console 建立 OAuth 用戶端

1. 到 Google Cloud Console，選一個專案（沒有就新建一個，例如 `jri-mbse`）。
2. 「API 和服務 → OAuth 同意畫面」：
   - 使用者類型選「外部」。
   - 填應用程式名稱、支援 email、開發人員聯絡資訊。
   - 範圍只加 `openid`、`.../auth/userinfo.email`、`.../auth/userinfo.profile`，都是不需審查的基本範圍。
   - 發布狀態保持「測試」時只有列在「測試使用者」的帳號能登入；要讓成員自由登入，按「發布應用程式」改成「正式版」。只用基本範圍不需要 Google 審查。
3. 「API 和服務 → 憑證 → 建立憑證 → OAuth 用戶端 ID」：
   - 應用程式類型：網頁應用程式。
   - 已授權的重新導向 URI 填公開網址加上 `/auth/google/callback`，例如：
     `https://<主機名稱>.<tailnet>.ts.net:8443/auth/google/callback`
     （要和「管理 → 登入設定」頁上顯示的那一行完全相同，含連接埠，結尾不加斜線。）
   - 已授權的 JavaScript 來源不用填。
4. 建立後會拿到 Client ID 與 Client secret。

## 2. 填進樹莓派

兩種方式擇一：

- **管理頁**：從內部網址（Tailscale）以管理員身分開「管理 → 登入設定」，填公開網址、Google Client ID 與 Google Client secret，按「儲存設定」。secret 存檔後頁面只顯示「已儲存」，不會再顯示內容。
- **直接改檔**：編輯 `JRI_HOME/config.json`（預設為 `data/config.json`），加上：

  ```json
  "google": { "clientId": "<Client ID>", "clientSecret": "<Client secret>" }
  ```

  存檔後重新啟動網站服務。

`publicUrl` 也要設定（同一個檔案或管理頁），重新導向 URI 由它組出來。

## 3. 成員名單

- 名單以 Google 帳號的 email 為主鍵（不分大小寫）。GitHub 帳號選填，有填的成員也能用 GitHub 登入。
- 加人有兩種方式：
  - **手動**：「管理 → 成員」填 email、姓名、職級後儲存。
  - **加入申請**：名單外的人用 Google 登入後會被擋下並留下申請，出現在「管理 → 成員 → 加入申請」。按「核准」帶入表單、設定職級後儲存即加入；不認識的按「忽略」。
- 不限定網域，任何 email 已驗證的 Google 帳號都能送申請，但只有名單上的才能進來。
- 成員 email 只存在樹莓派的 `users.json`，不要寫進公開的 repository。

## 4. 驗證了什麼

伺服器用授權碼向 Google 換 id_token，並逐項檢查：

- 簽章：RS256，用 Google 公布的公鑰（JWKS，快取一小時，遇到不認得的金鑰會重抓）。
- `iss` 是 `https://accounts.google.com` 或 `accounts.google.com`。
- `aud` 是本站的 Client ID（多個 aud 時 `azp` 也要是本站）。
- `exp` 未過期、`iat` 不在未來（容許 60 秒時鐘誤差）。
- `nonce` 與登入時存在 cookie 的相同；`state` 也要相符。
- `email_verified` 必須是 `true`。

## 5. GitHub 登入（第二選項）

舊的 GitHub OAuth App 設定仍然有效，填了就會在登入頁多一個「改用 GitHub 登入」。callback URL 是公開網址加 `/auth/github/callback`。舊格式的 `users.json`（只有 GitHub 帳號 `login`）仍可讀，可以用 GitHub 登入；在管理頁修改該成員時要補上 email。
