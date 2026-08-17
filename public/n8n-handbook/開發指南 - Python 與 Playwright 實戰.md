# 開發指南：Python 與 Playwright 實戰

*前提：已閱讀[[新手指南 - 第一次使用 n8n]]，了解 workflow、node、trigger 的基本概念。第一次操作 HTTP Request 節點呼叫 automation-api，建議先做過[[範例 - Excel 處理（取代 VBA）]]和[[範例 - Playwright 網頁登入]]這兩個逐步範例，這篇是熟悉之後的模式參考，步驟不會像範例那麼詳細。*

*⚠️ 版本異動：較新版 n8n（2.34.6）節點選單裡沒有「Execute Command」，這篇已經改成「HTTP Request 呼叫獨立的 automation-api 服務」的模式，Python/Playwright 腳本不再跑在 n8n 容器裡，而是跑在另一個叫 `automation-api` 的服務裡。*

---

## 核心概念：HTTP Request 呼叫 automation-api

Python 和 Playwright 邏輯，都寫在一個獨立跑的小型服務 **automation-api** 裡（跟 n8n 是分開的兩個 container），n8n 用 **HTTP Request** 節點呼叫它：

```
n8n 告訴 automation-api：「幫我處理這個」（打一個網址，帶上資料）
                        ↓
         automation-api 跑完，把結果回傳給 n8n
```

跟直接在 n8n 容器裡跑腳本的差異：

| | 舊模式（Execute Command，已停用） | 新模式（HTTP Request） |
|---|---|---|
| 腳本跑在哪 | n8n 容器裡 | 獨立的 automation-api 容器 |
| n8n 怎麼呼叫 | 執行一行 shell 指令 | 呼叫一個網址 |
| 資安角度 | n8n 能執行任意指令 | n8n 只能呼叫固定範圍的幾個端點 |

automation-api 的程式碼放在 `~/Documents/n8n/automation-api/`，裡面目前有：

```
automation-api/
├── server.py    ← FastAPI 服務本體，定義有哪些端點
└── login.js     ← Playwright 腳本，被 server.py 呼叫
```

新增功能時，在 `server.py` 加一個新的端點（例如 `/excel/another-report`），對應的邏輯寫成 Python 函式，需要 Playwright 就寫一支 `.js` 腳本讓 `server.py` 用 `subprocess` 呼叫（原因見下方「為什麼 Playwright 還是用 Node 寫」）。改完存檔，automation-api 有掛 `--reload`，會自動套用最新程式碼，不需要重啟。

---

## Part 1｜Python 處理 Excel

### 情境說明

流程目標：接收上傳的 Excel，整理後回傳處理結果。

```
[Form Trigger]（瀏覽器上傳檔案） ──→ [HTTP Request]（呼叫 automation-api）──→ [Read/Write Files from Disk]（存結果）
```

### automation-api 那邊：`server.py`

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

### n8n 這邊

1. **Form Trigger**：加一個 File 類型的欄位，接收上傳的 Excel
2. **HTTP Request**：
   - Method: `POST`
   - URL: `http://automation-api:8001/excel/process`
   - Body Content Type: Form-Data / Multipart，Parameter Name 填 `file`（要跟 `server.py` 的參數名稱一致）
3. **Read/Write Files from Disk**：把 HTTP Request 回傳的 binary 內容寫進 `/fileserver/output/`

詳細點擊步驟見[[範例 - Excel 處理（取代 VBA）]]。

---

## Part 2｜Playwright 瀏覽器自動化

### 情境說明

流程目標：呼叫 automation-api，讓它幫你登入一個網站、擷取頁面資料，回傳給 n8n。

```
[Manual Trigger] ──→ [HTTP Request]（呼叫 automation-api）──→ 直接拿到 JSON 結果
```

### 為什麼 Playwright 還是用 Node 寫

`server.py`（Python）本身也可以直接用 Playwright 的 Python 版套件，但目前 Alpine 內建的 Python 版本比 Playwright Python 套件支援的版本新，`pip install playwright` 會直接失敗（詳見[[自製 Docker Image（加入 Python + Playwright）]]第 10 節「踩過的坑」）。所以維持原本的分工：**Playwright 邏輯寫成 `.js` 用 Node 執行**，`server.py` 用 `subprocess` 呼叫它、把結果轉成 JSON 回傳，Excel 處理維持純 Python。

### automation-api 那邊

`login.js`（Playwright，Node）：

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/chromium-browser',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
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

`server.py` 裡負責轉呼叫的端點：

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

### n8n 這邊

只要一個 HTTP Request 節點，Method 選 `POST`，URL 填 `http://automation-api:8001/web/login-scrape`，執行完直接拿到：

```json
{ "success": true, "title": "Logged In Successfully" }
```

不用像以前那樣多加一個 Code 節點手動 `JSON.parse`——HTTP Request 節點會自動把 JSON 回應解析好。

詳細點擊步驟見[[範例 - Playwright 網頁登入]]。

---

## 完整流程範例

以下是一個「上傳 Excel → 呼叫 automation-api 整理 → 寫入結果 → 寄 Email」的完整骨架：

```
[Form Trigger]
    瀏覽器上傳 Excel
        │
        ▼
[HTTP Request]
    POST http://automation-api:8001/excel/process
    （automation-api 處理完直接回傳結果）
        │
        ▼
[Read/Write Files from Disk]
    寫入 /fileserver/output/
        │
        ▼
[Send Email]
    通知處理完成
```

如果流程裡同時要登入系統擷取資料再處理 Excel，就是多加一個呼叫 `/web/login-scrape` 的 HTTP Request 節點，串在前面即可，兩個端點互相獨立，可以任意組合。

---

## 重要觀念：automation-api 的程式碼放哪裡？

`automation-api/` 資料夾在 Mac Mini 上的路徑是 `~/Documents/n8n/automation-api/`，透過 docker-compose 的 volume 掛進 automation-api 這個 container 的 `/app`：

| automation-api（container 內路徑） | Mac Mini（實際路徑） |
|---|---|
| `/app/server.py` | `~/Documents/n8n/automation-api/server.py` |
| `/app/login.js` | `~/Documents/n8n/automation-api/login.js` |

開發時，在 Mac Mini 上修改 `server.py`，因為啟動指令有加 `--reload`，automation-api 會自動偵測變更、重新載入，不需要重啟 container。修改 `.js` 腳本則不用重載 automation-api 本身，因為它是每次被呼叫時才用 `subprocess` 執行一次，一定是讀最新內容。

新增 Python 套件（例如要用某個新的資料處理套件）才需要重新 build，這時需要管理員在 Dockerfile 的 `pip3 install` 那行加上套件名稱，重新 `docker compose build`。

---

## 除錯技巧

**流程跑失敗時，先看這幾個地方：**

1. **HTTP Request 節點的輸出**：如果整個節點顯示紅色錯誤，點開看狀態碼和錯誤內容，通常就知道是網址打錯還是 automation-api 那邊真的執行失敗
2. **automation-api 服務本身有沒有正常運行**（這一步需要管理員在 Mac Mini 上確認）：
   ```bash
   docker compose ps                    # 確認 automation-api 是 Up 狀態
   docker compose logs automation-api   # 看有沒有 Python 錯誤堆疊
   ```
3. **直接在 Mac Mini terminal 用 curl 測試 automation-api**（管理員操作，比在 n8n 裡除錯更快）：
   ```bash
   curl -X POST http://localhost:8001/web/login-scrape
   curl -X POST http://localhost:8001/excel/process -F "file=@report.xlsx"
   ```
   如果 curl 本身就報錯，代表問題出在 automation-api，跟 n8n workflow 怎麼寫無關

---

## 小提醒

- Playwright 腳本一定要加 `--no-sandbox` 參數，這是 Docker 環境的限制，不是安全問題
- HTTP Request 節點呼叫 `automation-api` 這個主機名稱，只有在 n8n 和 automation-api 兩個 container 都在同一個 docker-compose 專案裡才解析得到，不能拿去外部瀏覽器直接打
- 新增/修改 automation-api 的端點，都是管理員或熟悉 Python 的人負責，一般使用者只需要知道「呼叫哪個網址、要傳什麼、會拿到什麼」
