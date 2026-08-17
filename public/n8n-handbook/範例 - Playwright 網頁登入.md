# 範例：Playwright 網頁登入

*前提：已讀過[[新手指南 - 第一次使用 n8n]]，知道 workflow、node、trigger 是什麼。建議先做過[[範例 - 骨架練習（免外部環境）]]熟悉基本操作，這篇跟[[範例 - Excel 處理（取代 VBA）]]一樣要串到 automation-api 才能真的跑完，行內環境目前卡在網路連線（見[[範例 - 探測 n8n 主機環境]]），跑不完是預期中的事，不代表你操作錯了。*

*n8n 介面預設是英文，這篇每個用到的按鈕/節點名稱都附繁體中文對照，照著英文字找就對了。*

*⚠️ 版本異動：較新版的 n8n（我們現在用的 2.34.6）節點選單裡找不到「Execute Command」，這篇已經改成不依賴它的做法——Playwright 腳本包在一個獨立的小型 API 服務（automation-api）裡，n8n 用 **HTTP Request** 節點呼叫它就好。*

---

## 這個範例要做什麼

你用 RPA（例如 UiPath）做網頁自動化時，大概是這個流程：開瀏覽器 → 用 Selector 找到帳號欄位 → 打字 → 找密碼欄位 → 打字 → 找登入按鈕 → 點擊 → 抓畫面上的某段文字。

Playwright 做的是同一件事，只是用寫程式的方式描述「Selector」和「點擊」這兩個動作：

| RPA（UiPath）概念 | Playwright 對應寫法 |
|---|---|
| 開瀏覽器 | `chromium.launch()` |
| Selector（框選要操作的元件） | CSS selector，例如 `'#username'`（畫面上 id 是 username 的元件） |
| Type Into（打字） | `page.fill('#username', '文字')` |
| Click（點擊） | `page.click('#submit')` |
| Get Text（擷取文字） | `page.textContent('.post-title')` |

這段登入邏輯已經寫在 automation-api 裡（`login.js`），你不用碰程式碼，n8n 這邊只要學會「怎麼呼叫它、怎麼拿到結果」。

**這篇範例用一個公開的練習登入頁面**（`practicetestautomation.com`），帳密是網站本身公開提供的測試帳密，不涉及任何內部系統，可以放心練習。等熟悉整套流程後，再套用到真正要登入的內部系統時，只需要改 automation-api 裡的網址和 selector，n8n 這邊的呼叫方式完全不用變。

---

## 名詞對照表（這篇會用到的）

| n8n 英文介面 | 繁體中文 | 說明 |
|---|---|---|
| Manual Trigger | 手動觸發 | 用按按鈕的方式啟動流程 |
| HTTP Request | HTTP 請求 | 呼叫一個網址，這篇用來呼叫 automation-api，取代原本的 Execute Command |
| Method | 方法 | 這篇用 POST（送出請求並期待處理結果） |
| URL | 網址 | 要呼叫的目標網址 |
| Test workflow | 測試流程 | 手動跑一次流程看結果 |
| Selector | 選取器 | 網頁裡用來「指定是哪個元件」的寫法，概念等同 UiPath 的 Selector |

---

## Step 1｜在 n8n 建立 Workflow

1. 左側選單點 **Workflows**（工作流程列表），新增一個 workflow，命名「範例 - Playwright 登入」
2. 點 **「+ Add first step」**（新增第一步），搜尋 `manual`，選 **Manual Trigger**（手動觸發）
3. 點 Manual Trigger 右側 **「+」**，搜尋 `http request`，選 **HTTP Request**（HTTP 請求）
4. 設定：
   - **Method**：`POST`
   - **URL**：`http://automation-api:8001/web/login-scrape`
5. 點左上角 **「▶ Test workflow」**（測試流程）

就這樣，不需要再多加其他節點。

---

## Step 2｜看執行結果

點 HTTP Request 節點，右側輸出應該會直接顯示：

```json
{ "success": true, "title": "Logged In Successfully" }
```

如果看到這段內容，代表：n8n 呼叫了 automation-api → automation-api 開了瀏覽器 → 帳密真的填進去了 → 按鈕真的按下去了 → 登入成功後的畫面文字也真的抓到了 → 結果原樣傳回給 n8n。

**跟 Execute Command 時代的差異**：以前 stdout 是一串文字，還要多一個 Code 節點手動 `JSON.parse` 才能用；HTTP Request 節點會自動把 JSON 回應解析成 n8n 看得懂的資料，`title` 直接就是一個欄位，之後接的節點可以直接用 `{{ $json.title }}` 取用，少一道手續。

---

## automation-api 裡面在做什麼（不用改，看懂就好）

`server.py` 裡的這個端點，負責接住 n8n 打來的請求，幫你跑 `login.js`（跟原本 Execute Command 時代用的是同一支腳本，內容完全沒變）：

```python
@app.post("/web/login-scrape")
def login_scrape():
    result = subprocess.run(["node", "/app/login.js"], capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr.strip())
    return json.loads(result.stdout)
```

`login.js` 本身（Playwright 邏輯）完全沒變：

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

**怎麼知道要填什麼 selector？** 在瀏覽器打開目標網頁，按右鍵 → 檢查（Inspect），滑鼠移到要操作的欄位上，就能看到它的 `id` 或 `class`，這跟 UiPath 用 Selector 產生器框選元件是同一件事。

---

## 🔧 進階挑戰（非必要，做完基本版再嘗試）

加一個 **IF**（條件判斷）節點，接在 HTTP Request 節點後面：

- 條件設定：`{{ $json.title }}` **equals**（等於） `Logged In Successfully`
- True 分支：登入成功，接 **Send Email**（寄送 Email）通知完成
- False 分支：登入失敗（帳密錯、網頁改版找不到 selector 等），通知需要人工檢查

這一段對應 RPA 流程裡「登入失敗要有例外處理」的概念。

---

## 除錯：登入失敗、或抓不到資料

1. **先看 HTTP Request 節點的輸出**：如果整個節點顯示紅色錯誤且狀態碼是 500，代表 automation-api 那邊的 `login.js` 執行失敗，錯誤訊息會在回應內容裡
2. **常見錯誤是 selector 找不到元件**：如果錯誤訊息裡有 `waiting for selector` 之類的字樣，代表網頁改版了，這個 selector 已經找不到對應元件，需要請管理員回去檢查、更新 `login.js`
3. **automation-api 服務本身沒起來**：這一步需要管理員在 Mac Mini 上確認，執行 `docker compose ps` 看 `automation-api` 是不是 `Up` 狀態
4. **套用到真正的內部系統時**：把 `login.js` 裡 `page.goto()` 的網址、`#username`／`#password`／`#submit` 換成內部系統實際的欄位 selector；帳密不要寫死在腳本裡，改用環境變數或 n8n Credentials 讀取，避免明碼放在檔案裡——這部分需要請管理員協助修改 automation-api，你自己不用改程式碼

想看更多 HTTP Request、automation-api 的開發模式，可以接著看[[開發指南 - Python 與 Playwright 實戰]]。
