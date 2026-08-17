# DX Ops

數位轉型組的內部資源入口，跟個人部落格（EchoForge）完全分開，獨立網域、獨立 repo。

- 正式網址：https://dx-ops.vercel.app
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
   └──→ dx-ops（這個 repo）：public/n8n-handbook/ 是複製過去的一份
          proxy.ts 攔截 /n8n-handbook 底下所有請求，沒帶對的 cookie
          就導去 /n8n-handbook-login，密碼跟 process.env.N8N_HANDBOOK_PASSWORD 比對
```

`public/n8n-handbook/` 裡的內容**不會自動跟 Obsidian 源頭同步**，是手動複製過去的一份快照，改動源頭之後要照下面的流程更新。

---

## 文件更新流程

改完 Obsidian 資料夾裡的文件之後（Tailscale `:3000` 這步就已經生效了，不用再做什麼），要讓 `dx-ops` 這邊的公開版也跟上，執行：

```bash
cd ~/Documents/dx-ops
./scripts/sync-docs.sh
```

這支腳本會依序：

1. 把源頭資料夾的改動 `commit + push` 到 `n8n-handbook` repo（純備份）
2. 用 `rsync` 把最新內容複製到 `public/n8n-handbook/`
3. 這裡的改動 `commit + push` 到 `dx-ops` repo
4. **只有內容真的有變動**，才跑 `vercel --prod` 重新部署——沒有變動的話會在對應步驟自動跳過，不會每次都硬重新部署
5. 部署完，把 `dx-ops.vercel.app` 這個網址重新指向剛剛部署好的版本（見下方「已知問題」，這步不能省）

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
# 部署完一定要接著把網址指回來，見下方「已知問題」
vercel alias set <這次印出來的 deployment 網址> dx-ops.vercel.app
```

---

## 已知問題：`vercel --prod` 不會自動更新 dx-ops.vercel.app

這個專案原本叫 `dx-hub`，後來改名成 `dx-ops`（`vercel project rename`）。改名不會把 Vercel 自動配的 production 別名一起改過來——`vercel --prod` 每次還是會自動把舊名字（`dx-hub-six.vercel.app`）重新指到最新部署，`dx-ops.vercel.app` 是我們手動 `vercel alias set` 上去的，**不會自動跟著新部署走**。

`sync-docs.sh` 已經處理這件事（部署完會自動抓部署網址、重新 alias 一次），但如果用「手動部署」那條路（直接跑 `vercel --prod`），記得自己補一次 `vercel alias set`，不然網址會停在上一個版本。
