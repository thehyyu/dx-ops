# Git 備份操作手冊

*本文件說明 n8n 環境的兩層備份策略：部署設定備份（git）與 Workflow 定義備份（JSON 匯出 + git）。*

---

## 0. 為什麼需要兩層備份？

n8n 的「程式碼」分成兩個完全不同的地方：

```
git repo（GitHub）               Docker volume（本機）
~/Documents/n8n/                 n8n_data volume
├── docker-compose.yml           └── database.sqlite
├── SETUP.md                          ├── 你寫的所有 workflow
└── workflows/（需自行建立）            ├── credentials
                                       └── 執行紀錄
```

- **git repo** 只備份「怎麼架這台機器」的設定檔
- **Docker volume** 存了你真正寫的所有 workflow，但 git 完全看不到它

所以如果 Docker volume 損毀（例如誤下 `docker volume rm n8n_data`），workflow 全部消失，git 救不了你。這就是為什麼需要**兩層**。

---

## 1. 兩層備份總覽

| 層 | 備份對象 | 方式 | 頻率 |
|---|---|---|---|
| 第一層 | 部署設定（docker-compose.yml、SETUP.md、Dockerfile） | git commit + push | 每次改設定後 |
| 第二層 | n8n Workflow 定義 | 從 n8n UI 匯出 JSON → 放進 git | 每次改完重要 workflow 後 |

---

## 2. 第一層：部署設定備份

### 什麼時候需要 commit？

改了以下任何一個檔案之後：
- `docker-compose.yml`（新增 volume、改環境變數等）
- `SETUP.md`（更新維護手冊）
- `Dockerfile`（修改自製 image 內容）
- `automation-api/`（`server.py`、`login.js` 等，n8n 用 HTTP Request 呼叫的服務原始碼，見[[開發指南 - Python 與 Playwright 實戰]]）——這個資料夾是真正的程式邏輯，跟 `fileserver/` 裡的練習用 Excel 檔案不一樣，**要**進版控

### 操作步驟

```bash
cd ~/Documents/n8n

# 查看哪些檔案有變動
git status

# 加入要備份的檔案（指定檔名，不要用 git add .）
git add docker-compose.yml

# 寫 commit 訊息，說明改了什麼
git commit -m "feat: 說明這次改了什麼"

# 推上 GitHub
git push
```

### Commit 訊息寫法慣例

```
feat: 新增功能       → 例如 feat: mount fileserver volume
docs: 更新文件       → 例如 docs: 補充 Playwright 安裝說明
fix: 修正問題        → 例如 fix: 修正 timezone 設定錯誤
```

---

## 3. 第二層：Workflow 定義備份

### 匯出 Workflow JSON（從 n8n UI 操作）

1. 開瀏覽器進入 `http://100.87.135.94:5678`
2. 打開要備份的 workflow
3. 右上角點選 **⋮**（三點選單）
4. 選擇 **Download**
5. 存到 `~/Documents/n8n/workflows/` 資料夾

### 建議的資料夾結構

```
~/Documents/n8n/
├── docker-compose.yml
├── SETUP.md
├── Dockerfile
└── workflows/                        ← 新增這個資料夾
    ├── 登入系統取值.json
    ├── Excel報表處理.json
    └── GlobalErrorHandler.json
```

### 把匯出的 JSON commit 進 git

```bash
cd ~/Documents/n8n

git add workflows/登入系統取值.json
git commit -m "feat: 新增登入系統取值 workflow"
git push
```

### 建立 workflows 資料夾（第一次）

```bash
mkdir -p ~/Documents/n8n/workflows
```

---

## 4. 從備份還原

### 還原部署設定（第一層）

```bash
# 在新機器或重裝後，把 repo clone 下來
git clone git@github.com:thehyyu/n8n.git ~/Documents/n8n

# 啟動
colima start
cd ~/Documents/n8n
docker compose up -d
```

### 還原 Workflow（第二層）

1. 開瀏覽器進入 n8n
2. 左上角選單 → **Workflows** → **Import from File**
3. 選擇 `workflows/` 資料夾裡對應的 `.json` 檔案
4. 儲存

---

## 5. 目前 git repo 狀態

- **遠端位置**：`git@github.com:thehyyu/n8n.git`
- **本機位置**：`~/Documents/n8n/`
- **主分支**：`main`

查看目前狀態：

```bash
cd ~/Documents/n8n
git log --oneline -5    # 看最近 5 次 commit
git status              # 看有沒有未 commit 的變動
```

---

## 6. 注意事項

**不要 commit 的東西：**
- `data/` 資料夾（SQLite 原始檔，大且會不斷變動，沒意義 commit）
- `fileserver/` 資料夾內的實際 Excel 檔案（練習資料，不是程式碼）
- 任何含有帳號密碼的設定檔

n8n 的 credentials（帳號密碼）存在 Docker volume 裡並加密，**不會**出現在 git repo，這是正確的設計，不用擔心。

**`.gitignore` 建議內容：**

```
data/
fileserver/
*.env
```
