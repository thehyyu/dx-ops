# 範例：Excel 處理（取代 VBA）

*前提：已讀過[[新手指南 - 第一次使用 n8n]]，知道 workflow、node、trigger 是什麼。這篇要串到 automation-api 才能真的跑完，如果行內環境的儲存空間/網路還沒接通（先看[[範例 - 探測 n8n 主機環境]]確認），會卡在最後寫入結果那一步——建議先做完全不依賴環境的[[範例 - 骨架練習（免外部環境）]]，熟悉基本操作後再回來做這篇。*

*n8n 介面預設是英文，這篇每個用到的按鈕/節點名稱都附繁體中文對照，照著英文字找就對了。*

*⚠️ 版本異動：較新版的 n8n（我們現在用的 2.34.6）節點選單裡找不到「Execute Command」，這篇已經改成不依賴它的做法——用一個獨立的小型 API 服務（automation-api）處理 Excel，n8n 用 **HTTP Request** 節點呼叫它。*

---

## 這個範例要做什麼

你以前用 VBA 巨集處理報表，可能長這樣：按下巨集按鈕 → 巨集幫每一列加一個「處理狀態」欄位 → 如果金額是負的，標記「異常」 → 另存新檔。

這個範例做一模一樣的事，但分成兩塊：

- **automation-api**：一個獨立跑的小型服務，裡面是 Python（pandas）寫的處理邏輯，管理員已經建好，你不用碰
- **n8n workflow**：你要建立的部分，負責「接收你上傳的檔案」「呼叫 automation-api」「把結果存起來」

| VBA 巨集會做的事 | 這裡對應的做法 |
|---|---|
| 按巨集按鈕啟動 | n8n 的 Form Trigger（表單觸發，瀏覽器上傳檔案） |
| 巨集裡的 VBA 程式碼 | automation-api 裡的 Python 邏輯（已經寫好） |
| 另存新檔 | n8n 收到處理結果後，寫進 `/fileserver/output/` |

最大差異：VBA 要 Excel 開著才能跑；這裡完全在瀏覽器操作，你不需要碰任何伺服器上的檔案，只要有瀏覽器和你電腦上的 Excel 檔就能跑完整個流程。

---

## 名詞對照表（這篇會用到的）

| n8n 英文介面 | 繁體中文 | 說明 |
|---|---|---|
| Workflow | 工作流程 | 一整串自動化流程 |
| Node | 節點 | 流程裡的一個步驟 |
| Form Trigger | 表單觸發 | 產生一個網頁表單當作流程起點，你在瀏覽器選檔案上傳，就會觸發流程 |
| Field Type: File | 欄位類型：檔案 | 讓表單欄位變成「選擇檔案上傳」 |
| HTTP Request | HTTP 請求 | 呼叫一個網址，把資料送過去、拿結果回來，這篇用來呼叫 automation-api |
| Body Content Type | 內文格式 | HTTP Request 節點裡，設定要用什麼格式送資料，這篇選 Form-Data / Multipart（跟網頁上傳檔案用的格式一樣） |
| Read/Write Files from Disk | 讀寫磁碟檔案 | 讀取或寫入伺服器上的檔案，這篇用來把結果存到 `/fileserver/output/` |
| Test workflow | 測試流程 | 手動跑一次流程看結果，不會影響正式排程 |
| Save | 儲存 | 存檔 |

---

## Step 1｜建立 Workflow 並加入 Form Trigger

1. 左側選單點 **Workflows**（工作流程列表），點 **+ New workflow**（新增工作流程）
2. 右上角命名為「範例 - Excel 處理」
3. 點畫面中央 **「+ Add first step」**（新增第一步）
4. 搜尋框輸入 `form`，選擇 **n8n Form Trigger**（表單觸發）
5. 右側設定面板：
   - **Form Title**（表單標題）填：`Excel 處理`
   - 點 **Add Form Field**（新增表單欄位）
     - **Field Label**（欄位名稱）填：`選擇 Excel 檔案`
     - **Field Type**（欄位類型）選：**File**（檔案）

---

## Step 2｜準備測試用 Excel

在你自己電腦上（不是 Mac Mini）用 Excel 建立一個檔案 `report.xlsx`，內容如下：

| 客戶編號 | 金額 |
|---|---|
| A001 | 1000 |
| A002 | -500 |
| A003 | 2000 |

存在你電腦桌面或任何你找得到的地方即可，等一下上傳用。

---

## Step 3｜加入 HTTP Request 節點，呼叫 automation-api

1. 點 Form Trigger 節點右側的 **「+」**
2. 搜尋框輸入 `http request`，選擇 **HTTP Request**（HTTP 請求）
3. 設定：
   - **Method**：`POST`
   - **URL**：`http://automation-api:8001/excel/process`
   - **Body Content Type**（內文格式）選 **Form-Data / Multipart**
   - 點 **Add Parameter**（新增參數），選擇 **Form Binary Data**（表單二進位資料）類型：
     - **Name**（名稱）填：`file`（這個名字要跟 automation-api 那邊寫死的欄位名稱一致，不能改）
     - **Input Data Field Name**（輸入資料欄位名稱）先留著，下一步測試完才知道要填什麼

---

## Step 4｜測試一次，找出正確的欄位名稱

1. 點左上角 **「▶ Test workflow」**（測試流程），n8n 會顯示一個 **Test URL**（測試網址）並進入等待狀態
2. 複製這個網址，在瀏覽器**開新分頁**貼上
3. 表單頁面出現「選擇 Excel 檔案」的上傳欄位，選擇你剛才準備的 `report.xlsx`，送出
4. 回到 n8n 分頁，點 **Form Trigger** 節點，看右側輸出的 `binary` 底下有一個欄位名稱（key），把它複製下來
5. 回到 **HTTP Request** 節點，把 **Input Data Field Name** 填成剛剛複製的名稱
6. 再點一次 **Test workflow**，重複第 2-3 步上傳同一個檔案

> 不同版本 n8n，Form Trigger 產生的欄位名稱可能不太一樣，不用死記，每次照第 4 步實際看輸出、複製貼上就不會錯。

---

## Step 5｜看結果，加入寫入磁碟的節點

先確認 HTTP Request 節點有沒有跑成功：點該節點看右側輸出，如果看到一串看起來像亂碼的二進位內容（`binary` 底下有東西），代表 automation-api 已經把處理好的 Excel 傳回來了。

接著把結果存起來：

1. 點 HTTP Request 節點右側 **「+」**
2. 搜尋框輸入 `read/write`，選擇 **Read/Write Files from Disk**（讀寫磁碟檔案）
3. **Operation**（操作）選 **Write**（寫入）
4. **File Name**（檔名）填：

   ```
   /fileserver/output/report_result.xlsx
   ```

5. **Data Property Name**（資料欄位名稱）填 HTTP Request 回傳的 binary 欄位名稱（通常叫 `data`，可以點上一個節點的輸出確認）
6. 點 **Test workflow** 重跑一次

---

## Step 6｜確認結果

打開 Mac Mini 的 `~/Documents/n8n/fileserver/output/`（這一步是**管理員**確認用，你自己不需要碰 Mac Mini），應該會看到 `report_result.xlsx`，內容變成：

| 客戶編號 | 金額 | 處理狀態 |
|---|---|---|
| A001 | 1000 | 已處理 |
| A002 | -500 | 異常 |
| A003 | 2000 | 已處理 |

A002 因為金額是負的，被標成「異常」——這就是 Python 版的「VBA 巨集邏輯」，只是換了個地方跑，而且你從頭到尾都只在瀏覽器裡操作。

### 記得存檔

右上角點 **Save**（儲存）。

---

## automation-api 裡面在做什麼（不用改，看懂就好）

```python
@app.post("/excel/process")
def process_excel(file: UploadFile = File(...)):
    df = pd.read_excel(file.file)

    df["處理狀態"] = "已處理"
    # 對應 VBA：If Cells(i,2).Value < 0 Then Cells(i,3).Value = "異常"
    df.loc[df["金額"] < 0, "處理狀態"] = "異常"

    # 處理完直接把 Excel 內容回傳，不用先存在伺服器上再讀
    ...
```

這支程式放在 `~/Documents/n8n/automation-api/server.py`，跟 n8n 是分開的兩個服務，n8n 完全不需要知道 Python 怎麼寫，只要知道「打這個網址、傳檔案過去、會收到處理好的檔案」。

---

## 🔧 進階挑戰（非必要，做完基本版再嘗試）

基本版沒有處理「萬一 automation-api 掛了或處理失敗怎麼辦」：

1. 在 HTTP Request 節點後面加一個 **IF** 節點（條件判斷）
2. 條件設定：`{{ $json.error }}` **does not exist**（HTTP Request 失敗時 n8n 會在輸出裡帶錯誤欄位，成功時不會有）

   > 實際欄位名稱以你測試時的輸出為準，如果不確定，也可以改用 HTTP Request 節點設定面板裡的 **「Continue On Fail」** 選項搭配輸出裡的狀態碼判斷

3. True 分支（失敗）：接 **Send Email**（寄送 Email）通知需要人工檢查
4. False 分支（成功）：接 Step 5 的寫入磁碟流程

這一段對應 VBA 巨集裡常見的 `On Error GoTo` 錯誤處理。

---

## 除錯：流程沒動、或結果不對

1. **先看 HTTP Request 節點的輸出**：如果整個節點顯示紅色錯誤，點開看錯誤訊息——常見是網址打錯（`automation-api` 這個主機名稱只有在 n8n 和 automation-api 兩個 container 都在同一個 docker-compose 專案裡才找得到）
2. **確認 automation-api 服務本身正常**：這一步需要管理員在 Mac Mini 上確認，執行 `docker compose ps` 看 `automation-api` 是不是 `Up` 狀態
3. **上傳的檔案欄位名稱對不上**：回到 Step 4，重新確認 Form Trigger 的 binary 欄位名稱跟 HTTP Request 的 Input Data Field Name 是否一致
4. **確認 `report.xlsx` 的欄位名稱**跟 automation-api 程式裡寫的（`金額`）完全一致，包含全形/半形空白都要一樣

想看更多 HTTP Request、automation-api 的開發模式（例如怎麼把多個處理步驟串成完整流程），可以接著看[[開發指南 - Python 與 Playwright 實戰]]。
