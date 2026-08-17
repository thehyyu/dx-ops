# DX Hub

數位轉型組的內部資源入口，跟個人部落格（EchoForge）完全分開，獨立網域、獨立 repo。

- 正式網址：https://dx-hub-six.vercel.app
- 目前內容：`/n8n-handbook`（n8n 組內操作手冊，Docsify 靜態站）
- 存取方式：共用密碼閘門（不是 Google 帳號登入），密碼存在 Vercel 環境變數 `N8N_HANDBOOK_PASSWORD`

---

## 架構

```
Obsidian 資料夾（源頭，真正編輯文件的地方）
"/Users/thehyyu/Documents/Obsidian/LLM Wiki/Project/n8n組內操作手冊"
   │
   ├──→ Tailscale (:3000)：nginx 直接讀這個資料夾，存檔即生效
   │      （備份用的 git repo：git@github.com:thehyyu/n8n-handbook.git）
   │
   └──→ dx-hub（這個 repo）：public/n8n-handbook/ 是複製過去的一份
          proxy.ts 攔截 /n8n-handbook 底下所有請求，沒帶對的 cookie
          就導去 /n8n-handbook-login，密碼跟 process.env.N8N_HANDBOOK_PASSWORD 比對
```

`public/n8n-handbook/` 裡的內容**不會自動跟 Obsidian 源頭同步**，是手動複製過去的一份快照，改動源頭之後要照下面的流程更新。

---

## 文件更新流程

改完 Obsidian 資料夾裡的文件之後（Tailscale `:3000` 這步就已經生效了，不用再做什麼），要讓 `dx-hub` 這邊的公開版也跟上，執行：

```bash
cd ~/Documents/dx-hub
./scripts/sync-docs.sh
```

這支腳本會依序：

1. 把源頭資料夾的改動 `commit + push` 到 `n8n-handbook` repo（純備份）
2. 用 `rsync` 把最新內容複製到 `public/n8n-handbook/`
3. 這裡的改動 `commit + push` 到 `dx-hub` repo
4. **只有內容真的有變動**，才跑 `vercel --prod` 重新部署——沒有變動的話會在對應步驟自動跳過，不會每次都硬重新部署

想自訂 commit 訊息：

```bash
./scripts/sync-docs.sh "改了 Excel 範例的除錯段落"
```

不帶參數會用預設的時間戳記當 commit 訊息。

**這支腳本不會處理**：新增 `/n8n-handbook` 以外的其他頁面（例如以後要加別的 DX 工具），那種改動要直接改這個 repo 裡的程式碼，照一般 git 流程 commit/push，`vercel --prod` 手動部署（目前沒有接 GitHub → Vercel 自動部署，push 不會自動觸發）。

---

## 環境變數

| 變數 | 用途 | 設定位置 |
|---|---|---|
| `N8N_HANDBOOK_PASSWORD` | `/n8n-handbook` 的存取密碼，同時也是驗證成功後 cookie 的值 | Vercel Project Settings → Environment Variables（Production 已設定，Preview 因為 CLI 的問題目前沒設） |

本機開發要測密碼閘門，另外在專案根目錄建一份 `.env.local`：

```
N8N_HANDBOOK_PASSWORD=你的密碼
```

---

## 本機開發

```bash
npm install
npm run dev
```

## 手動部署（不透過 sync-docs.sh，例如改了程式碼本身）

```bash
vercel --prod
```
