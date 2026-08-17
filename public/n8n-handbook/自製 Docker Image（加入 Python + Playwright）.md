# 自製 Docker Image（加入 Python + Playwright）

*本文件說明如何在現有 n8n Docker 環境中，加入 Python 與 Playwright 的執行能力，以支援「Playwright（網頁）＋ Python（Excel）＋ n8n 節點」三種技術混搭的自動化流程。*

---

## 0. 為什麼需要自製 Image？

目前的 n8n 使用官方提供的現成 image（`n8nio/n8n:latest`），裡面只有 n8n 能跑起來需要的最低限度工具。

實際進去 container 查過之後，結果如下：

| 工具 | 現況 |
|---|---|
| Node.js | ✅ 有（v24，n8n 核心需要） |
| Python | ❌ 沒有 |
| Playwright | ❌ 沒有 |

這代表如果要在容器裡跑 Python/Playwright，必須自己「加料」安裝，官方 image 本身沒有。

**自製 image 的概念**：以官方 n8n 為基底，在上面「加料」安裝 Python 和 Playwright，打包成我們自己的版本。n8n 功能完全不變，只是多了額外工具。

**⚠️ 版本異動**：這個 image 原本設計是給 n8n 的「Execute Command」節點直接呼叫 `python3`/`node`。較新版 n8n（我們現在用的 2.34.6）節點選單裡已經沒有這個節點了。好消息是**這個 image 本身完全不用重做**——同一個 image 現在多了一個用途：拿來跑一個獨立的 **automation-api** 服務（第 4、6 節），n8n 改用 HTTP Request 節點呼叫它。裝了什麼、怎麼裝對的（尤其是 Playwright 那幾個環境變數），完全沒變。

---

## 1. 什麼是 Dockerfile？

`Dockerfile` 是一份「食譜」，告訴 Docker 怎麼一步一步建造你的 image。

類比：
- 現成 image（`n8nio/n8n`）= 買來的空白筆記本
- Dockerfile = 你寫下「先拿那本筆記本，再加上便條紙、加上書籤、加上索引頁」的指示清單
- 建置後的 image = 你客製化完成的那本筆記本

每一行指令都是一個「層」（layer），Docker 會依序執行，最後打包成一個新的 image。

---

## 2. 專案目錄結構

在現有的 `~/Documents/n8n/` 資料夾裡，新增以下檔案：

```
~/Documents/n8n/
├── docker-compose.yml    ← 已存在，需修改
├── Dockerfile            ← 新增：image 食譜
├── .dockerignore         ← 新增：告訴 Docker build 時忽略哪些目錄
└── data/                 ← 已存在，n8n 資料
```

**`.dockerignore` 的作用：**
Docker build 時會把整個資料夾打包送給 Docker daemon。沒有 `.dockerignore` 的話，`data/`、`fileserver/` 等大型目錄也會被送進去（可能高達幾百 MB），拖慢 build 速度。`.dockerignore` 的語法和 `.gitignore` 相同：

```
.git
data/
fileserver/
*.md
```

---

## 3. Dockerfile 內容與逐行說明

> **為什麼不直接用 `n8nio/n8n:latest` 當基底？**
> n8n 新版採用「hardened image」，把套件管理器（`apk`）拔掉了，無法在上面追加安裝任何東西。因此改以標準 Node.js Alpine 作為基底，自己安裝 n8n，效果完全相同，只是起點不同。
> n8n 的資料存在 Docker volume（`n8n_data`）裡，和 image 完全分開，換基底不影響任何現有資料。

```dockerfile
# 以標準 Node.js 24 Alpine 作為基底（有 apk，可以自由安裝）
FROM node:24-alpine

# 切換為 root 才能安裝系統套件
USER root

# 安裝系統套件：Python、Chromium（Playwright 用）、tini（process 管理）
RUN apk add --no-cache \
    python3 \
    py3-pip \
    chromium \
    chromium-chromedriver \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    tini

# 安裝 n8n（透過 npm，和官方 image 內部的安裝方式相同）
RUN npm install -g n8n

# 安裝 Python 套件
# --break-system-packages 是 Alpine Linux 的新規定，允許 pip 安裝到系統層
# fastapi/uvicorn/python-multipart 是給 automation-api 服務用的（見第 6 節）
RUN pip3 install --break-system-packages \
    openpyxl \
    pandas \
    requests \
    fastapi \
    "uvicorn[standard]" \
    python-multipart

# 告訴 Playwright 使用系統裝好的 Chromium，不要自己再下載一個
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
# 注意：這裡故意不設 N8N_USER_FOLDER，原因見第 10 節「N8N_USER_FOLDER 設錯導致帳號消失」

# 建立 n8n 資料目錄，並設定好擁有者
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node

# 切回 node 使用者（安全慣例，不要用 root 跑服務）
USER node

EXPOSE 5678

# tini 是輕量的 init process，確保 container 結束時子程序正確清理
ENTRYPOINT ["tini", "--", "n8n"]
CMD ["start"]
```

**重點說明：**

- `FROM node:24-alpine`：標準 Node.js image，有完整的 `apk` 套件管理器
- `npm install -g n8n`：安裝 n8n 本體，和官方 image 的做法一致
- `USER root / USER node`：安裝套件需要 root 權限，裝完後換回普通使用者
- `apk add`：Alpine Linux 的套件管理器（等同 Ubuntu 的 `apt-get`）
- `tini`：container 的 1 號 process 管理器，確保 Ctrl+C 和停止訊號正確傳遞給 n8n

---

## 4. 修改 docker-compose.yml

原本的 `docker-compose.yml` 指向官方 image：

```yaml
image: n8nio/n8n:latest   ← 原本這樣
```

改成使用我們自己的 Dockerfile 來建置：

```yaml
build:
  context: .              ← 在目前資料夾找 Dockerfile
  dockerfile: Dockerfile
```

**完整的新版 docker-compose.yml**（含新增的 `automation-api` 服務，見第 6 節）：

```yaml
services:
  n8n:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: n8n
    restart: unless-stopped
    ports:
      - "5678:5678"
    environment:
      - GENERIC_TIMEZONE=Asia/Taipei
      - TZ=Asia/Taipei
      - WEBHOOK_URL=${WEBHOOK_URL}
      - N8N_SECURE_COOKIE=false
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=168
      - EXECUTIONS_DATA_PRUNE_MAX_COUNT=5000
      - N8N_RESTRICT_FILE_ACCESS_TO=/obsidian-inbox
      - N8N_PAYLOAD_SIZE_LIMIT=512
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    volumes:
      - n8n_data:/home/node/.n8n
      - /Users/thehyyu/Documents/Obsidian/LLM Wiki/Inbox:/obsidian-inbox
      - /Users/thehyyu/Documents/n8n/fileserver:/fileserver

  automation-api:
    build:
      context: .
      dockerfile: Dockerfile        # 跟 n8n 用同一個 image，只是啟動指令不同
    container_name: automation-api
    restart: unless-stopped
    entrypoint: ["python3", "-m", "uvicorn"]
    command: ["server:app", "--host", "0.0.0.0", "--port", "8001", "--app-dir", "/app", "--reload"]
    ports:
      - "8001:8001"
    volumes:
      - /Users/thehyyu/Documents/n8n/automation-api:/app

volumes:
  n8n_data:
    external: true
```

**重點**：`automation-api` 這個服務 `build` 的內容跟 `n8n`完全一樣（同一份 Dockerfile），差別只有 `entrypoint`／`command` 把預設會跑的 `n8n start` 蓋掉，改跑一個小型 HTTP 服務（uvicorn，Python 的 FastAPI 伺服器）。這就是為什麼不用重做 image——同一個 image，兩種跑法。

---

## 5. 建置與啟動流程

> 每次修改 Dockerfile 後都要重新走一次 build，改 docker-compose.yml 的其他設定則不用。

```bash
cd ~/Documents/n8n

# 第一步：停止舊的 container
docker compose down

# 第二步：建置新 image（第一次比較久，約 5~10 分鐘，因為要下載 Chromium）
# docker-compose.yml 裡 n8n 和 automation-api 用同一個 image，這一步兩個服務一起建好
docker compose build

# 第三步：用新 image 啟動所有服務（n8n + automation-api）
docker compose up -d

# 確認兩個服務都有起來
docker compose ps

# 確認 Python 和 Playwright 有沒有裝成功
docker exec n8n python3 --version
docker exec n8n node -e "require('playwright'); console.log('playwright ok')"

# 確認 automation-api 本身正常回應
curl http://localhost:8001/docs
```

---

## 6. automation-api：n8n 怎麼呼叫 Python/Playwright

較新版 n8n 節點選單裡沒有「Execute Command」，改用一支獨立的小型 API 服務 **automation-api**（用這篇裝好的 image 跑），n8n 用 **HTTP Request** 節點呼叫它，不直接執行指令。

程式放在 `~/Documents/n8n/automation-api/`：

```
automation-api/
├── server.py    ← FastAPI 服務本體，定義有哪些端點
└── login.js     ← Playwright 腳本範例，被 server.py 用 subprocess 呼叫
```

### server.py（處理 Excel 的端點）

```python
import io
import pandas as pd
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.post("/excel/process")
def process_excel(file: UploadFile = File(...)):
    df = pd.read_excel(file.file)
    df["處理狀態"] = "已處理"
    df.loc[df["金額"] < 0, "處理狀態"] = "異常"

    buffer = io.BytesIO()
    df.to_excel(buffer, index=False)
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=result.xlsx"},
    )
```

### login.js（Playwright 腳本，網頁自動化）

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-dev-shm-usage']  // 在 Docker 裡必須加這兩個
  });
  const page = await browser.newPage();
  await page.goto('https://practicetestautomation.com/practice-test-login/');
  await page.fill('#username', 'student');
  await page.fill('#password', 'Password123');
  await page.click('#submit');
  await page.waitForSelector('.post-title');
  const title = await page.textContent('.post-title');
  console.log(JSON.stringify({ success: true, title: title }));
  await browser.close();
})();
```

> `--no-sandbox` 是在 Docker container 裡跑 Chromium 的必要參數，不是安全漏洞，是 container 環境本身的限制決定的。

**為什麼 Playwright 還是用 Node 寫，不是 Python？** 見第 10 節「pip 版 Playwright 不支援 Python 3.14」——已經踩過這個坑，維持原本分工最省事。`server.py` 用 `subprocess` 呼叫 `login.js`：

```python
import json
import subprocess
from fastapi import HTTPException

@app.post("/web/login-scrape")
def login_scrape():
    result = subprocess.run(["node", "/app/login.js"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr.strip())
    return json.loads(result.stdout)
```

### n8n 這邊怎麼接

HTTP Request 節點，Method 選 `POST`，URL 填 `http://automation-api:8001/web/login-scrape`（或 `/excel/process`）。`automation-api` 這個主機名稱只有在跟 n8n 同一個 docker-compose 專案裡才解析得到，靠的是 Docker Compose 內建的服務間網路，不需要額外設定。詳細點擊步驟見[[範例 - Excel 處理（取代 VBA）]]、[[範例 - Playwright 網頁登入]]、[[開發指南 - Python 與 Playwright 實戰]]。

---

## 7. 隔離性說明

Docker container 的沙盒機制保證：

```
Mac Mini 主機（你的電腦）
├── 你自己的 Python 環境   ← container 完全看不到、碰不到
├── 你的瀏覽器             ← container 完全看不到、碰不到
├── 你的系統檔案           ← container 完全看不到、碰不到
│
└── Container（沙盒，n8n 和 automation-api 兩個 container 都用這個 image）
     ├── n8n
     ├── Python（container 專屬，跟主機的 Python 互不干擾）
     └── Playwright + Chromium（container 專屬）
         只能讀寫 volumes 掛進來的目錄：
         - n8n_data volume（n8n 自己的資料）
         - /obsidian-inbox（n8n container，Voice Transcribe 這類流程用）
         - /fileserver（n8n container，見第 9 節）
         - /app（automation-api container 專屬，對應 Mac Mini 的 automation-api/ 資料夾，見第 6 節）
```

同事連進來執行 workflow，所有操作都在 container 裡發生，不會影響 Mac Mini 上的任何東西。

---

## 8. 更新 n8n 版本的注意事項

以前用 `image: n8nio/n8n:latest`，更新只需要：

```bash
docker compose pull
docker compose up -d
```

**改用自製 image 之後**，更新流程多一個步驟：

```bash
# 重新 build（會自動拉最新的 n8nio/n8n:latest 作為基底）
docker compose build --no-cache

# 再重啟
docker compose up -d
```

`--no-cache` 讓 Docker 不用舊的快取，確保從最新版 n8n 重新建置。

---

## 9. 練習環境：模擬 File Server

### 背景說明

正式行內環境的共用資料夾是行內 File Server，與外部網路完全隔離。練習環境無法連進去，但可以用 Mac Mini 上的一個本機資料夾來模擬，架構概念完全相同：

```
真實環境                          練習環境
行內 File Server                  ~/Documents/n8n/fileserver/
（實際允許路徑依環境而定，          └── output/
 見[[範例 - 探測 n8n 主機環境]]）

n8n 寫 結果.xlsx 到行內允許的路徑    n8n 寫 /fileserver/output/結果.xlsx
```

路徑不同，邏輯 100% 相同。練好之後換成行內路徑即可。

**⚠️ 這裡的 `input/` 已經不用了**：早期設計是同事把 Excel 放進 `/fileserver/input/`，但同事實際上碰不到 Mac Mini 的檔案系統，這個做法行不通。目前的範例改用 n8n **Form Trigger** 從瀏覽器直接上傳（詳見[[範例 - Excel 處理（取代 VBA）]]），輸入端完全不經過 `/fileserver/`。

### 目前已掛載的目錄結構

`docker-compose.yml` 已加入：

```yaml
volumes:
  - /Users/thehyyu/Documents/n8n/fileserver:/fileserver
```

Mac Mini 上的實際路徑：

```
~/Documents/n8n/fileserver/
└── output/   ← n8n workflow 處理完存結果的地方，由 Read/Write Files from Disk 節點寫入
```

`input/` 資料夾雖然還在（沒特別去刪），但目前的範例不會用到它。

### Playwright 練習目標網站

正式環境的目標是行內內部系統（需登入），練習階段可以用這些公開練習網站代替，登入流程、取值方式完全一樣：

| 網站 | 用途 |
|---|---|
| `practicetestautomation.com/practice-test-login/` | 帳號密碼登入頁，練登入流程與 session |
| `the-internet.herokuapp.com` | 各種 UI 元素（表格、下拉、iframe），練取值 |
| `datatables.net/examples` | 資料表格，練爬表格後存 Excel |

這些網站不需要安裝任何東西，等 Playwright 腳本邏輯熟了，換成行內系統只需要改 URL 和帳號。

### 磁碟空間評估

| 項目 | 大小 |
|---|---|
| 加入 Python + Playwright 後的 n8n image | 約 +400MB（Chromium） |
| fileserver 資料夾本身 | 幾 KB（空資料夾） |
| 練習用 Excel 假資料 | 幾 KB |
| 公開練習網站 | 0（不在本機） |

唯一實質成本是 Chromium，這是 Playwright 本來就需要的，不是額外負擔。

---

## 10. 踩過的坑

### N8N_USER_FOLDER 設錯導致帳號消失

**症狀**：重建 image 並重啟後，進入 n8n 顯示「請建立帳號」，所有 workflow 和帳號全部消失。

**原因**：`N8N_USER_FOLDER` 是「家目錄」而不是「資料目錄」，n8n 會在它底下**自動附加 `.n8n/`** 作為實際存資料的地方。

```
如果設定：N8N_USER_FOLDER=/home/node/.n8n
n8n 實際去找：/home/node/.n8n/.n8n/  ← 建了新的空資料庫
舊資料實際在：/home/node/.n8n/        ← 被忽略了
```

所以 volume 掛在 `/home/node/.n8n`，但 n8n 跑去裡面再建一層，根本讀不到舊資料庫。

**解法**：不要設 `N8N_USER_FOLDER`，讓 n8n 用預設值。

預設行為：`N8N_USER_FOLDER` 未設定 → n8n 用 `~`（= `/home/node`）→ 資料存到 `/home/node/.n8n` → 剛好對應 volume 掛載位置。

```dockerfile
# ❌ 錯誤：會導致資料存到 /home/node/.n8n/.n8n/
ENV N8N_USER_FOLDER=/home/node/.n8n

# ✅ 正確：直接拿掉這行，讓 n8n 預設即可
```

**資料有沒有救**：有。資料其實沒有被刪，只是 n8n 去了錯誤的目錄。修正 Dockerfile 並重建後，n8n 就會回頭讀到正確的 `database.sqlite`，帳號和 workflow 全部回來。

---

### pip 版 Playwright 不支援 Python 3.14

**症狀**：build 時出現 `ERROR: No matching distribution found for playwright`。

**原因**：Alpine 3.22 內建 Python 3.14（很新），但 Playwright Python 套件目前只支援到 Python 3.13。

**解法**：Playwright 改用 **npm 版本**（Node.js），Python 只負責 Excel 處理。

```dockerfile
# ❌ 會失敗
RUN pip3 install playwright

# ✅ 改用 npm 版
RUN npm install -g n8n playwright
```

這樣分工也更合理：
- **Playwright → Node.js**（n8n 本身是 Node，生態系更完整）
- **Excel → Python**（openpyxl / pandas，這部分完全沒問題）

---

### 節點選單找不到 Execute Command

**症狀**：照舊文件說的搜尋 `execute command`，n8n 節點選單搜不到，行內的 n8n 環境也一樣搜不到。

**原因**：較新版 n8n（我們現在用的 2.34.6）把「可在 host 上執行任意指令」這類節點從節點選單收緊了——去 container 裡翻過，`ExecuteCommand` 的節點檔案其實還在，後端也還認得，但介面不給你手動加，應該是資安考量下的改變。

**解法**：不用等 n8n 開放這個節點，改用第 6 節的 automation-api 模式——Python/Playwright 邏輯包成一支獨立跑的 HTTP 服務，n8n 用 HTTP Request 節點呼叫。這個 image 本身完全不用重做，只是多開一個服務用同一個 image 跑而已。

---

## 11. 常見問題

**Q：build 很久是正常的嗎？**
A：是，第一次 build 需要下載 Chromium（約 150MB）和各種 Python 套件，5~10 分鐘很正常。之後重新 build 因為有 Docker layer 快取，沒改到的步驟會直接跳過，快很多。

**Q：Playwright 腳本一直說找不到瀏覽器怎麼辦？**
A：確認腳本裡有指定 `executable_path="/usr/bin/chromium-browser"`，以及有加 `--no-sandbox` 參數。

**Q：Python 套件想增加怎麼辦？**
A：在 Dockerfile 的 `pip3 install` 那行加上套件名稱，然後重新 `docker compose build` 和 `docker compose up -d`。

**Q：automation-api 的程式放哪裡才能讀到？**
A：放在 `~/Documents/n8n/automation-api/` 裡，這個目錄已經透過 `docker-compose.yml` 掛進 automation-api container 對應到 `/app`，改完 `server.py` 因為有開 `--reload` 會自動套用，不需要重啟。

**Q：Execute Command 節點還會回來嗎？要不要留著舊文件的做法？**
A：不確定，但不用等——第 6 節的 automation-api 模式對資安來說反而更好過關（n8n 只能打固定端點，不是能執行任意指令），就算之後 Execute Command 重新開放，也沒有理由改回去。
