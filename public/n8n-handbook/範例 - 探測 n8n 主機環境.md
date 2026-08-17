# 範例：探測 n8n 主機環境

*前提：已讀過[[新手指南 - 第一次使用 n8n]]，並做過[[範例 - Excel 處理（取代 VBA）]]或[[範例 - Playwright 網頁登入]]其中一篇，熟悉 HTTP Request、Read/Write Files from Disk 這類節點的基本操作。*

*適用情境：行內已經有獨立的 n8n 環境，你剛拿到操作權限，但不清楚這套環境實際的檔案掛載、網路連線範圍是什麼——這篇教你用 n8n workflow 本身當探測工具，直接看到 n8n 執行環境的真實狀況，比從外部猜測準確。*

*⚠️ 較新版 n8n（我們自己的 2.34.6、行內的 2.21.5）節點選單裡都沒有「Execute Command」，這篇完全不用它，全部改用一定找得到的核心節點（Code、Read/Write Files from Disk、HTTP Request）。*

---

## 為什麼用 workflow 探測，而不是問 IT 或用其他工具

不是不能問 IT，而是這篇的做法可以**當場自己驗證**，而且看到的結果就是 n8n 實際執行時能碰到的範圍——n8n 通常跑在容器裡，它能看到的檔案系統、能連到的網路，不一定等於這台主機本身的權限，用 workflow 裡的節點直接測，結果最準確。跟 IT 確認、跟這篇的探測結果，兩者可以互相對照。

---

## 名詞對照表

| n8n 英文介面 | 繁體中文 | 說明 |
|---|---|---|
| Manual Trigger | 手動觸發 | 用按按鈕的方式啟動流程 |
| Code | 程式碼節點 | 執行一段 JavaScript，這篇拿來試探能不能存取檔案系統 |
| Read/Write Files from Disk | 讀寫磁碟檔案 | 讀取或寫入伺服器上的檔案，這篇的主力探測工具 |
| File(s) Selector | 檔案選擇器 | Read 操作用來指定要讀哪個檔案，支援萬用字元（glob） |
| Binary | 二進位資料 | n8n 節點之間傳遞檔案內容的方式，Write 操作需要前一個節點提供 |
| Data Property Name | 資料欄位名稱 | 告訴 Write 操作要用哪個 binary 欄位的內容去寫檔 |
| HTTP Request | HTTP 請求 | 呼叫一個網址，這篇用來測試連線通不通 |

---

## Step 1｜建立 Workflow

1. 左側選單點 **Workflows**（工作流程列表），點 **+ New workflow**（新增工作流程）
2. 右上角命名為「工具 - 環境探測」
3. 點畫面中央 **「+ Add first step」**（新增第一步），搜尋 `manual`，選擇 **Manual Trigger**（手動觸發）

---

## Step 2｜方法 A：Code 節點試探檔案系統（最快，先試這個）

Code 節點是 n8n 最基礎的節點之一，一定找得到。它的 JavaScript 執行環境**有時候**允許存取 Node.js 內建模組，值得先試：

1. 點 Manual Trigger 節點右側的 **「+」**，搜尋 `code`，加入 **Code**（程式碼節點），語言選 **JavaScript**
2. 貼入（可直接複製）：

   ```javascript
   const fs = require('fs');
   return [{ json: { root: fs.readdirSync('/') } }];
   ```

3. 點左上角 **「▶ Test workflow」**（測試流程），看結果：
   - 回傳一堆目錄名稱 → 等於拿到 `ls -la /` 的等效結果，直接找掛載點，可以跳到 Step 4 驗證寫入
   - 報錯 `Module 'fs' is disallowed`（或 `Cannot find module 'fs'`）→ 代表這個環境把 Code 節點的檔案系統存取也鎖死了，這本身就是有用的資訊，改用 Step 3

> 我們實測：自己的 Mac Mini 沒試過鎖這個，但行內環境（n8n 2.21.5）明確回傳 `Module 'fs' is disallowed`，代表 Code 節點被平台層級的 sandbox 擋住，不是設定沒開對，直接跳下一步即可，不用再嘗試別的寫法。

---

## Step 3｜方法 B：Read/Write Files from Disk——連錯誤訊息都要看

這個方法的重點不是「成功了才有用」，**報錯的內容本身往往就直接洩漏答案**：

1. 點 Manual Trigger 節點右側 **「+」**，搜尋 `read/write`，加入 **Read/Write Files from Disk**（讀寫磁碟檔案）
2. **Operation** 選 **Read**（讀取）
3. **File(s) Selector**（檔案選擇器）填 `/*`（支援萬用字元）
4. 點 **Test workflow**，結果分三種情況：

   - **吃萬用字元**：輸出是根目錄底下所有項目各自一個 binary 結果，等於間接列出目錄內容，直接找掛載點
   - **報錯內容是「Access to the file is not allowed. Allowed paths: XXX」**：⭐ 中獎——代表這個環境設定了 n8n 內建的 `N8N_RESTRICT_FILE_ACCESS_TO` 環境變數，錯誤訊息裡的 `XXX` 就是這個環境真正允許讀寫的路徑，直接拿到答案，不用再猜任何路徑
   - **其他錯誤或沒反應**：這個節點的萬用字元語法可能不吃，縮小範圍猜測，例如 `/data/*`、`/files/*`，或改用 Step 8 的猜路徑法

> **我們實測的結果**：行內環境（n8n 2.21.5）用這個方法，`File(s) Selector` 隨便填一個路徑去 Read，直接回傳「`Access to the file is not allowed. Allowed paths: /root/.n8n-files`」，一次找到答案。跟我們自己 Mac Mini docker-compose 裡設的 `N8N_RESTRICT_FILE_ACCESS_TO=/obsidian-inbox` 是同一個機制，只是允許的路徑不同。

---

## Step 4｜驗證找到的路徑真的能寫入

Write 操作需要**前一個節點提供 binary 內容**才能寫，不能接在空的 Manual Trigger 後面直接測，否則會報 `input data to contain a binary file 'data', but none was found`。正確做法：

1. Manual Trigger 節點右側點 **「+」**，加一個 **Code** 節點（JavaScript），貼入：

   ```javascript
   return [{
     json: {},
     binary: {
       data: {
         data: Buffer.from('n8n write test').toString('base64'),
         mimeType: 'text/plain',
         fileName: 'test.txt'
       }
     }
   }];
   ```

   > 這段只是組一個 JS 物件、做 base64 編碼，不需要 `fs`、`child_process` 這類可能被鎖的模組，一定跑得動。

2. 這個 Code 節點後面接 **Read/Write Files from Disk**：
   - **Operation** 選 **Write**（寫入）
   - **File Name** 填 `{Step 3 找到的路徑}/test.txt`（例如 `/root/.n8n-files/test.txt`）
   - **Data Property Name** 填 `data`（跟上面 Code 節點的 binary 欄位名稱一致，通常是預設值）
3. 點 **Test workflow**，看結果：
   - **寫成功** → 這就是這個環境「檔案進出」的正確入口，之後 Excel 上傳/處理結果都可以放這裡
   - **報 `ENOENT: no such file or directory, realpath 'XXX'`** → 跟上一步「Allowed paths」的訊息不衝突，是不同層次的問題：`N8N_RESTRICT_FILE_ACCESS_TO` 只是設定「允許碰哪裡」，但那個路徑底下**實際的儲存空間還沒接上**（沒掛 volume、資料夾也沒建）。這不是你能自己解決的（沒有 Execute Command、Code 節點的 `fs` 通常也被鎖，沒辦法自己 `mkdir`），是可以直接帶回去給 IT 的具體問題：「`N8N_RESTRICT_FILE_ACCESS_TO` 設定的路徑 `XXX` 目前是空的，需要掛實際儲存空間上去」

> **我們實測的結果**：行內環境的 `/root/.n8n-files` 就是這個狀況——環境變數設定完成，但路徑本身 `ENOENT`，等於「插座已經預留、還沒接電」。

---

## Step 5｜測試能不能連到特定內部系統

如果之後要用 Playwright 登入某個內部系統，想先確認這台 n8n 主機連不連得到那台伺服器。**先看懂三種錯誤代表什麼，再照順序測**：

| 錯誤 | 代表什麼 |
|---|---|
| `ENOTFOUND` / `getaddrinfo ENOTFOUND` | DNS 解析失敗，這台主機的 DNS 根本查不到這個網域，還沒到「連不連得上」那一步 |
| `ECONNREFUSED` | DNS 查得到，網路也通，但對方那個埠號沒服務在聽 |
| 逾時（Timeout） | DNS 查得到，封包送出去沒人回應，通常是防火牆擋掉 |
| 正常回應 | 完全通了 |

**測試 1｜先測外部網站當基準**：

1. 加一個 **HTTP Request**（HTTP 請求）節點
2. **URL** 填一個外部公開網站（例如 `https://www.google.com`）
3. 點 **Test workflow**：
   - 也是 `ENOTFOUND` → 這台主機根本沒有能用的 DNS，是更根本的網路設定問題
   - 這個通、只有內部網域不通（見測試 2）→ 確認是「DNS 沒涵蓋到內部網域」，不是全面斷網

**測試 2｜測目標內部系統的網域**：

1. **URL** 換成目標系統的網址，例如 `http://某內部系統網域:某埠號`
2. 點 **Test workflow**，對照上面的錯誤對照表判斷

**測試 3（如果測試 2 是 `ENOTFOUND`，且你知道目標系統的 IP）｜用 IP 代替網域名稱**：

1. **URL** 換成 `http://IP位址:埠號`（跳過網域名稱，直接用數字 IP）
2. 點 **Test workflow**：
   - 不再是 `ENOTFOUND`（變成連得到、或至少是 Timeout/ECONNREFUSED）→ 證實問題單純出在 DNS 沒解析到，網路路由本身是通的，可以直接跟 IT 反映「DNS 沒有涵蓋到 XXX 網域」
   - 一樣連不到 → 代表除了 DNS，連基本的網路路由/防火牆都還沒開通，問題更大一層

> **我們實測的結果**：行內環境測試 2（內部系統的網域）回傳 `getaddrinfo ENOTFOUND`，代表這台 n8n 主機目前連不到那個內部網域，需要跟 IT 確認 DNS/網路路由有沒有涵蓋到內部系統所在的網段。

---

## Step 6（選用，順手測）｜Code 節點還有哪些模組可以用

`fs` 被鎖不代表全部都鎖，可以順便試探這個環境是「只鎖 fs」還是「白名單制、預設全鎖」：

```javascript
return [{ json: { os: require('os').platform(), path_ok: !!require('path') } }];
```

- 連 `require('os')` 都報錯 → 白名單制，預設全鎖，只開放明確允許的模組，資安設定得比較嚴，之後不用花時間嘗試其他繞路的模組
- `os`/`path` 能用但 `fs` 不行 → 是針對性地鎖檔案系統存取，其他用途（例如純運算、字串處理）不受影響

---

## Step 7（被動觀察，不用建 workflow）｜節點面板、Credentials 選單

花五分鐘瀏覽一次，不算測試但很有情報價值：

- **節點選單**：有沒有非官方標配的節點（例如特定資料庫、LDAP、內部系統專用連接器）——會告訴你行內原本規劃 n8n 要接什麼系統
- **Credentials 選單**：能新增哪些類型的憑證——同樣能反推出這台 n8n 預期要串接的對象

---

## Step 8（最後手段）｜方法 A、B 都不行，逐一猜路徑

改用 Read/Write Files from Disk 的 **Write** 操作（記得照 Step 4 先接一個產生 binary 的 Code 節點）一個一個試：**File Name** 填幾個你猜測的路徑（例如 `/data/test.txt`、`/home/test.txt`），能寫成功就代表那個路徑真的存在且可寫。比較笨，但保證能用——不過實務上很少走到這步，Step 3 的報錯訊息通常就夠了。

---

## 小提醒

- 這篇故意沒教怎麼看環境變數（`env`）之類的指令，因為容易連到帳密、API 金鑰等敏感資訊一起印出來，這篇的方法本來就不涉及這塊
- 探測結果拿去跟 IT/行內基礎架構團隊核對是最快的做法，這篇的目的是「讓你自己有辦法先驗證」，不是取代跟 IT 確認
- 探測完這支 workflow 建議直接刪除或停用，不要留著長期存在，避免之後有人誤觸

---

## 已知案例（持續更新）

| 環境 | n8n 版本 | Execute Command | Code 節點 fs | 允許讀寫路徑 | 路徑實際可寫？ | 內部系統網域連線 |
|---|---|---|---|---|---|---|
| 自己的 Mac Mini | 2.34.6 | 找不到 | 未測 | `/fileserver`（docker-compose 自行掛載） | 可以（自行掛的 volume） | 未測 |
| 行內環境 | 2.21.5 | 找不到 | 被鎖（`Module 'fs' is disallowed`） | `/root/.n8n-files`（`N8N_RESTRICT_FILE_ACCESS_TO`） | ❌ `ENOENT`，路徑存在設定裡但沒掛實際儲存空間 | ❌ `ENOTFOUND`，DNS 查不到，需跟 IT 確認網路/DNS 有沒有涵蓋內部網段 |

跑完後，把 Step 3、4、5 的結果整理一下，通常就能回答：這套 n8n 環境的檔案要怎麼進出、網路連線範圍到哪裡，回頭對照[[開發規範 - RPA 對照版]]第 1 節的專案結構、[[開發指南 - Python 與 Playwright 實戰]]的 automation-api 模式調整即可。行內環境目前兩項關鍵基礎建設（儲存空間、內部網域 DNS）都還沒接上，這兩點是可以直接整理成需求、提給 IT/基礎架構團隊的具體項目。
