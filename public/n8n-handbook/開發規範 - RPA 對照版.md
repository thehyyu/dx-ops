# 開發規範：RPA 對照版

*本文件定位：團隊 n8n 自動化開發規範草稿，尚無實際專案套用，供未來新專案陸續參照。架構對應《開發範本_優化版》（RPA/UiPath 版，存放於 RPA 練習資料夾，非本站文件）的設計精神，但機制改依 n8n 實際能力（PostgreSQL、Queue mode、Docker、內建 Execution History）重新設計，非逐字翻譯。文中標示「🔲待確認」的項目，是工具包尚未明講、需要團隊或首個實際專案決策後才能定案的部分，先列出選項而非武斷寫死。*

*設計原則提醒：RPA 版之所以需要控制清單/結果清單 CSV、原子寫入等一整套機制，是因為 UiPath 用本機 Task Scheduler 觸發，每次執行都是全新進程、狀態必須自己存進檔案。n8n 一次 execution 跑到完成或逾時為止，中途真的當機的機率遠低於 RPA 情境，因此本範本**預設走輕量的「冪等重跑」模式，只有在資料量大或單筆成本高的流程，才升級用第 3.3 節的進階斷點續跑資料表**——不是每支流程都要套完整機制，避免幫少數情境預先蓋一整套很少用到的基礎建設。*

---

## 0. 為什麼需要這份規範

n8n 跟 UiPath/RPA 最大的差異，在於「進度該存在哪裡」這件事，n8n 本身已經解決了大半：

- RPA 用本機 Task Scheduler 觸發，程式跑完進程就消失，進度必須自己寫進 CSV 檔案，還要處理「整份檔案寫一半當機」的原子寫入問題（《開發範本_優化版》第 3、5.3 節的 `SafeWriteCsv.xaml`）
- n8n 本身就有 PostgreSQL 資料庫、Queue mode（Redis）、Execution History，「這次執行到哪裡」「上次成功了沒」這類問題，多數情況下讓流程本身**冪等**（重跑一次不會壞事）就能解決，不需要額外維護一份進度狀態

但 n8n 也有 RPA 版本沒有的新問題需要規範：

- **20 支流程共用同一個 n8n 執行環境**（同一組 Docker 容器、同一個 Queue），一支流程寫的邏輯品質差（例如忘記設 Retry、Timeout 抓太鬆），可能拖垮其他流程的執行資源，不像 RPA 每支流程各自佔用一台機器
- **Workflow 存在資料庫裡而非檔案系統**，沒有版控意識的話，改壞了、被別人覆蓋了，比 RPA 的 `.xaml` 檔案更難追蹤是誰、何時、改了什麼
- **執行層混用 Playwright（網頁）＋ Python（Excel）＋ n8n 節點本身**，三種技術混搭，命名/資料夾/錯誤處理若沒有統一規範，10 支流程可能長出 10 種風格

這份規範的目標，是讓 20 支（或更多）n8n 流程共用一致的骨架、共用元件、共用資料表設計，改動時只需要改一處，而不是每支流程各自摸索——但同時也刻意**不**把 RPA 版整套斷點續跑機制無條件搬過來，避免簡單流程被迫背負不需要的複雜度。

---

## 1. 專案結構

### 1.1 Git 版控儲存庫（開發端，Windows 筆電操作）

n8n workflow 本體存在 PostgreSQL 裡，**不是檔案**，因此版控不是「存資料夾」而是「定期匯出 JSON 進 Git」（對應工具包架構圖的「Workflow 版控（Git）」）。建議儲存庫結構：

```
n8n-workflows/                       ← Git repo
├─ workflows/
│   └─ {流程名稱}/
│       ├─ {流程名稱}.json           ← 從 n8n 匯出的 workflow 定義（含節點、連線）
│       └─ SDD_{流程名稱}.md         ← 該流程的功能設計文件（含版本歷程，見第 10 節）
│
├─ automation-api/                   ← 共用 HTTP 服務，n8n 用 HTTP Request 節點呼叫（見第 2 節）
│   ├─ server.py                     ← FastAPI 本體，每支流程的邏輯各自掛一個端點
│   └─ scripts/
│       └─ {流程名稱}/
│           ├─ excel/                ← Python + openpyxl/pandas，取代 Excel VBA
│           └─ playwright/           ← 網頁自動化腳本（Node + Playwright，被 server.py 用 subprocess 呼叫）
│
├─ shared-workflows/                 ← 共用 Sub-workflow（見第 5 節），僅放真的需要共用邏輯的部分
│   └─ GlobalErrorHandler.json
│
└─ sql/                              ← 資料表 DDL（僅採用進階模式的流程才需要，見第 3、4、9 節）
    ├─ process_progress.sql
    ├─ process_log.sql
    └─ process_config.sql
```

*匯出/同步頻率、是否搭配 n8n 內建的 Source Control 功能（需 n8n 版本支援，通常為 Enterprise/Cloud 功能，自架 Docker 版視授權而定）🔲待確認，見第 11 節。*

### 1.2 Linux 伺服器實際執行路徑（檔案存取用）

跟 RPA 版不同，這裡**沒有固定的資料夾結構**——n8n 用 `N8N_RESTRICT_FILE_ACCESS_TO` 這個環境變數限制 Read/Write Files from Disk 節點只能碰哪個路徑，每個環境（自架/行內）允許的路徑可能不一樣，不能沿用 RPA 版的 `00_RawData/01_Output/...` 這套固定命名，直接寫死會跟實際環境對不上。

實際允許路徑**必須先探測才知道**，做法見[[範例 - 探測 n8n 主機環境]]。輸入端則優先用 n8n **Form Trigger** 從瀏覽器直接上傳（見[[範例 - Excel 處理（取代 VBA）]]），能避開「同事沒有伺服器檔案系統存取權」這個問題，不一定需要依賴固定的資料夾慣例。

異常截圖、失敗批次留存等 RPA 版原本放在 `XX_Error` 資料夾的內容，改成寫進第 4 節的 `process_log` 資料表（或依賴 Execution History），不用另外規劃資料夾。

---

## 2. 主 Workflow 骨架（預設：冪等重跑模式）

對應《開發範本_優化版》第 2 節的 Main.xaml 骨架，但 n8n 預設骨架**不含**斷點續跑狀態表——多數內部自動化流程一次執行幾分鐘到十幾分鐘可以跑完，失敗了整批重跑一次的成本並不高，只要確保「重跑不會產生重複副作用」（冪等）即可。若你的流程資料量大、單筆成本高，先讀第 3 節判斷是否要升級用進階模式，再回來套用。

```
[Schedule Trigger]  或  [Webhook/Manual Trigger]
        │
        ▼
① 初始作業
   ├─ Set：設定 timeStamp、processName
   ├─ Postgres：讀取 process_config 表，取得本流程參數（見第 9 節）
   └─ （若涉及桌面軟體自動化，非本工具包涵蓋範圍，見第 11 節🔲待確認）
        │
        ▼
② 讀取待處理清單（冪等的關鍵在這一步）
   └─ 直接對「來源系統」或「目的系統」查詢尚未處理的條件，例如：
       - 來源資料庫：WHERE 狀態欄位 <> '已處理'
       - 目的系統本身有 UPSERT/唯一鍵限制，重複寫入自然覆蓋而非重複新增
       - 沒有天然可查的條件時，才需要考慮第 3 節的進階狀態表
        │
        ▼
③ 主流程（Split In Batches / Loop Over Items，逐筆處理）
   ├─ assign processedCount = 0（consecutiveFailCount 熔斷計數器為可選項，見第 8 節）
   │
   ├─ Loop Over Items：
   │   ├─ 業務邏輯節點（HTTP Request 呼叫 automation-api 執行 Python/Playwright 邏輯，或直接用 n8n 內建節點）
   │   │   └─ 節點本身設定「Retry On Fail」（Max Tries / Wait Between Tries）
   │   │       ← 取代 RPA 版 Retry Scope，n8n 節點內建，不需額外包一層
   │   │
   │   ├─ IF（該筆成功／失敗分支）
   │   │   ├─ 成功分支：寫入目的系統（本身即冪等寫入，如 UPSERT）
   │   │   └─ 失敗分支：記錄失敗原因（存於該筆資料本身或簡短彙總陣列，供④結束作業彙整通知）
   │   │       （可選）若啟用熔斷機制，見第 8 節
   │   │
   │   └─ assign processedCount += 1
   │
   ▼
④ 結束作業
   ├─ 彙總本次處理筆數／成功／失敗清單
   └─ Email/Slack 節點：寄送通知，內容含「本次處理 X 筆，成功 Y 筆／失敗 Z 筆」，
       失敗清單需人工複查或等下次排程重跑（因整批重跑冪等，失敗筆會在下次執行自動重新嘗試）
```

**關鍵設計說明：**

- **Python/Playwright 邏輯用 HTTP Request 呼叫 automation-api，不用 Execute Command**：較新版 n8n（我們現在用的 2.34.6）節點選單裡已經沒有 Execute Command，改成把 Python/Playwright 邏輯包在一支獨立跑的 automation-api 服務裡，n8n 用 HTTP Request 節點呼叫它。對資安來說也比較好過關——n8n 只能打固定範圍的幾個端點，不是能執行任意指令，詳見[[開發指南 - Python 與 Playwright 實戰]]
- **Error Workflow 取代最外層 TryCatch**：n8n 在 Workflow Settings 中可指定「Error Workflow」，該 workflow 內任何節點出錯，都會自動觸發指定的 Error Workflow 並帶入錯誤內容——不需要像 RPA 版手動包一層 TryCatch，20 支流程只需指向同一支 `GlobalErrorHandler`（見第 5 節）
- **單筆重試是節點內建功能，不是額外包一層邏輯**：直接在該節點的設定面板勾選 Retry On Fail 即可
- **稽核日誌預設信任 n8n 內建 Execution History**：每次執行的每個節點輸入輸出、錯誤訊息，n8n 都會保留，不需要每支流程都額外開發一支 WriteLog 元件、逐筆呼叫寫表——這是否足夠、何時需要升級成獨立稽核表，見第 4 節判斷標準
- **本骨架沒有結果清單/控制清單資料表**，因為冪等設計下不需要——若你的流程不符合「重跑整批成本可接受」的前提，代表你需要的是第 3 節的進階模式，而不是硬套這份預設骨架

---

## 3. 何時需要進階斷點續跑機制

### 3.1 預設原則：先讓流程冪等，而不是先加狀態表

多數判斷失敗要不要「續跑」的需求，本質上是在問「重新整批跑一次，會不會產生副作用或浪費太多時間」。優先解法是讓②③④三步驟本身冪等（UPSERT、以來源系統狀態欄位為準、發信前先查是否已發過），而不是預設加一張進度表。狀態表本身也要維護、也可能跟實際資料不同步，是額外的複雜度成本，不是「有更保險」就該無條件加。

### 3.2 判斷標準：什麼情況才值得升級

以下任一條件明顯成立，才考慮採用 3.3 的進階資料表：

- **資料量大到單次執行可能跑不完**（例如需要好幾小時、或有 Timeout Workflow 逼近的風險），需要跨多次執行分批接續
- **單筆處理成本高**（例如每筆要操作 Playwright 跑完一整套網頁流程要 30 秒以上），整批重跑的時間成本明顯划不來
- **寫入目的系統本身無法冪等**（例如只能用 INSERT、沒有唯一鍵限制，重跑會產生重複資料），又無法在寫入前先做防重判斷

只符合以上其中一項、且該流程本身開發時就能確認，才在該流程的 SDD「流程大綱」節記載採用進階模式；否則預設用第 2 節骨架即可。

### 3.3 進階模式：process_progress 單表設計

若確認需要，用**單一資料表**同時記錄「進度」與「結果內容」（合併 RPA 版控制清單與結果清單），一列一次 UPSERT 完成，不需要像 RPA 版拆兩份檔案、也不需要額外的 Transaction 或 SafeUpsert 包裝：

```sql
CREATE TABLE process_progress (
    id              SERIAL PRIMARY KEY,
    process_name    VARCHAR(100) NOT NULL,
    identifier      VARCHAR(100) NOT NULL,   -- 例如客戶編號/統編，同一 process_name 下唯一
    status          VARCHAR(20) NOT NULL DEFAULT 'Pending',  -- Pending / Success / Failed
    attempt_count   INT NOT NULL DEFAULT 0,
    result_status   VARCHAR(20),      -- 例如 OK／ERROR／CHECK
    highlight_color VARCHAR(20),      -- 組裝 Excel 時儲存格底色
    error_reason    TEXT,
    -- 其他業務欄位依各流程實際輸出需求增列，於各流程 SDD 定義
    updated_at      TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (process_name, identifier)
);
```

②讀取待處理清單改為：`SELECT * FROM process_progress WHERE process_name = ... AND status <> 'Success'`（若查無記錄，代表第一次跑，用原始清單 INSERT 建立，全部設為 Pending）。

每筆處理完，用一句 UPSERT 同時寫入狀態與結果內容：

```sql
INSERT INTO process_progress (process_name, identifier, status, attempt_count, result_status, highlight_color, error_reason)
VALUES (:process_name, :identifier, :status, 1, :result_status, :highlight_color, :error_reason)
ON CONFLICT (process_name, identifier)
DO UPDATE SET status = EXCLUDED.status,
    attempt_count = process_progress.attempt_count + 1,
    result_status = EXCLUDED.result_status,
    highlight_color = EXCLUDED.highlight_color, error_reason = EXCLUDED.error_reason,
    updated_at = now();
```

單一語句本身就是原子操作，不會有「狀態改了但結果沒存到」的中間態，RPA 版第 3.3 節「先寫結果、後標記完成」的順序顧慮在這裡不存在，不需要額外設計寫入順序或包 Transaction。`attempt_count` 每次 UPSERT 自動 +1（首次 INSERT 為 1），確保它能真正反映累計嘗試次數，而不只是一個定義了卻沒有任何地方更新的欄位。

**成品 Excel 底稿**：不是斷點續跑依據，只是把 `process_progress` 目前累積的資料匯出成人看的格式，可安全重複執行，統一在④結束作業執行一次即可。

*`attempt_count`（跨多次排程累計失敗次數）與節點的 Retry On Fail 重試次數（同一次執行內）是不同概念，不要共用同一個欄位或變數，理由同 RPA 版第 3.1 節。*

---

## 4. 稽核日誌：何時需要獨立於 Execution History 之外

n8n 內建 Execution History 已經記錄每次執行、每個節點的輸入輸出與錯誤訊息，**多數流程不需要另外開發一張日誌表**。只有以下情況才考慮建立獨立的 `process_log` 資料表：

- 需要**非技術人員**（如業務單位）自行查詢處理歷程，而不透過 n8n UI
- Execution History 的保留策略（天數/筆數上限，依自架 n8n 設定與資料庫容量而定）與業務需要的稽核保留期限不同，需要獨立保留
- 需要跨多次執行、依識別碼（例如客戶編號）聚合查詢「這個對象過去發生過什麼事」，而 Execution History 是以「執行」為單位不便這樣查

若上述皆不成立，直接依賴 Execution History＋④結束作業的通知信摘要即可，不需要額外建表與寫入邏輯。

若確認需要，規格如下：

```sql
CREATE TABLE process_log (
    id              SERIAL PRIMARY KEY,
    log_timestamp   TIMESTAMP NOT NULL DEFAULT now(),
    process_name    VARCHAR(100) NOT NULL,
    transaction_id  VARCHAR(100),        -- 識別碼，可留空代表非單筆事件
    stage           VARCHAR(50),
    status          VARCHAR(30),         -- INFO / BUSINESS_EXCEPTION / SYSTEM_EXCEPTION
    message         TEXT,
    screenshot_path TEXT
);
```

寫入方式建議**在迴圈內直接放一個 Postgres 節點 Insert**，而不是每筆都用 Execute Workflow 呼叫獨立的 WriteLog sub-workflow——逐筆呼叫 sub-workflow 會產生等量的額外 sub-execution，拖慢速度、把 Execution History 洗得很雜；只有當寫入邏輯本身複雜到需要共用（例如同時要判斷是否觸發告警），才值得拆成 sub-workflow。

*Status 分類、個資遮罩原則沿用 RPA 版第 4 節：業務例外用 `BUSINESS_EXCEPTION`，系統例外用 `SYSTEM_EXCEPTION`；Message 避免帶身分證字號、帳號等個資，寫入前先遮罩。*

---

## 5. 共用 Sub-workflow 規格

只有真正需要跨流程共用、且邏輯有一定複雜度的部分才拆成 Sub-workflow（透過 Execute Workflow 節點呼叫），不是每個小動作都要包一層。

### 5.1 GlobalErrorHandler（Error Workflow）— 建議所有流程採用

在 n8n 的 Workflow Settings 中，每支流程的 Error Workflow 都指向這一支，取代 RPA 版寫在 Main.xaml 最外層 Catch 裡的邏輯。這是 n8n 原生機制的正確用法，值得統一，不算過度設計。

輸入：n8n Error Trigger 節點自動帶入的錯誤物件（含出錯的 workflow 名稱、節點、錯誤訊息）。

內部邏輯：
1. （可選）若採用第 4 節的 process_log，寫入一筆 `SYSTEM_EXCEPTION` 記錄；否則此步驟省略，依賴 Execution History
2. 若涉及 Playwright 操作失敗，截圖邏輯建議在業務節點的失敗分支就近處理，而非依賴 Error Workflow——Error Workflow 觸發時瀏覽器 context 可能已關閉，取不到畫面
3. Email/Slack 節點：告警通知 IT，主旨/內文帶入流程名稱、出錯節點、錯誤訊息

### 5.2 其他共用邏輯

WriteLog、SafeUpsert 等 RPA 版對應的 Helper 元件，在 n8n 預設骨架下**不需要獨立成 sub-workflow**：日誌直接用迴圈內的 Postgres 節點（見第 4 節），進度寫入是單一 UPSERT 語句（見第 3.3 節），複雜度不到需要另外包一層呼叫的程度。若未來實際開發中發現有其他邏輯被 3 支以上流程重複用到，再評估是否值得拆 sub-workflow，不預先設計。

---

## 6. 排程與執行設定規範

n8n 用 **Schedule Trigger 節點**取代 RPA 版的 Windows Task Scheduler，多數設定直接在 workflow 內完成，不需要外部排程工具。

**團隊固定設定（所有流程一致）**

| 設定項目 | 建議值 | 說明 |
|---|---|---|
| 觸發方式 | Schedule Trigger 節點（Cron 表達式） | 取代外部 Task Scheduler，排程定義跟著 workflow 一起版控 |
| Error Workflow | 統一指向 GlobalErrorHandler | Workflow Settings 內設定，取代 RPA 版最外層 Catch |
| Timeout Workflow | 需設定（對應 RPA 版逾時強制終止），具體時間依流程評估 | 避免卡住的 execution 長期佔用 Queue worker，取代 RPA 版 Kill Task 機制——n8n 由 Timeout 設定主動中止，不需要外部另跑一支 Kill Task 排程 |

**重複觸發防護的實作方式 🔲待確認**：RPA 版靠獨立的 Kill Task 排程強制清理殘留進程；n8n Queue mode 下，同一 workflow 被 Schedule Trigger 觸發時，若上一輪還沒跑完，行為取決於是否啟用 Workflow 層級的 Concurrency 控制，需要依實際 n8n 版本能力確認，先列為待確認項目，不預設寫死機制。

**各流程自行評估的設定（於各流程 SDD「排程設定」節填寫）**

- 觸發頻率／Cron 表達式
- Timeout Workflow 秒數
- 是否採用第 3 節的進階斷點續跑模式（依 3.2 判斷標準）
- Queue mode 下該流程是否需要獨立 worker（避免長時間任務如 Playwright 卡住其他 workflow 的資源）
- 心跳／存活通知（選填，適合完全無人值守、需主動確認排程本身有沒有故障的流程）

---

## 7. 與 RPA 版（《開發範本_優化版》）機制對照表

給熟悉 RPA 開發範本的人快速對照概念在 n8n 這邊對應到什麼機制：

| RPA 版機制 | n8n 對應機制 |
|---|---|
| Main.xaml Sequence + 最外層 TryCatch | Workflow + Error Workflow（Workflow Settings 指定） |
| ③主流程 For Each + Try/Catch | Loop Over Items（Split In Batches）+ IF 成功/失敗分支 |
| Retry Scope（單筆秒級重試） | 節點內建 Retry On Fail 設定 |
| 控制清單.csv / 結果清單.csv（每支流程預設都要有） | 預設**不需要**——靠②讀取待處理清單的冪等查詢設計；資料量大/單筆成本高才用 `process_progress` 單表（第 3 節，可選） |
| SafeWriteCsv.xaml（File.Replace 原子寫入） | 單一 UPSERT 語句本身即原子操作，不需要額外包裝（僅進階模式才用得到） |
| Logs/流程名稱_YYYYMM.csv（每支流程預設都要記） | 預設依賴 n8n 內建 Execution History；只有第 4 節判斷成立才另建 `process_log`（可選） |
| Helper/*.xaml 共用元件（WriteLog／SafeWriteCsv 等） | 多數情況直接用迴圈內節點處理，不預先拆 sub-workflow（第 5.2 節） |
| GlobalExceptionHandler.xaml | Error Workflow（GlobalErrorHandler，建議所有流程採用） |
| Windows Task Scheduler + Kill Task 排程 | Schedule Trigger 節點 + Timeout Workflow 設定 |
| 機器人設定檔.xlsx（帳密＋參數） | n8n Credentials（帳密）+ process_config 資料表（參數，見第 9 節） |
| 資料夾備份 + SDD 版本歷程 | Git（workflow JSON）+ SDD 版本歷程（見第 10 節） |

---

## 8. 例外重試與熔斷機制設計原則

**單筆重試**：節點設定 Retry On Fail（Max Tries / Wait Between Tries），對應 RPA 版 Retry Scope，處理偶發性失敗（網路瞬斷、頁面載入慢），建議所有流程都設定，成本極低。

**熔斷機制（可選）**：對應 RPA 版 `consecutiveFailCount`，處理「連續多筆都失敗，代表系統性問題」的情境，作法是迴圈內累加一個失敗計數器，達閾值時用 `Stop and Error` 節點主動中止本輪。

這一層**不是每支流程都必要**——值得加的情境，是單筆處理成本高（例如每筆 Playwright 流程跑 30 秒以上），系統性故障發生時讓它把整份清單重試到底會浪費大量時間；如果單筆處理是輕量 API 呼叫（幾秒內失敗），讓它自然跑完、失敗筆數在④結束作業的通知信裡一次呈現，通常已經夠用，不需要額外的熔斷邏輯。是否啟用，於各流程 SDD 記載並說明理由。

若失敗原因是流程邏輯或資料本身的問題（重試多少次結果都一樣），重試與熔斷都幫不上忙，需要回頭查根因。

**重試/熔斷參數需外部化**：`RetryCount`、`RetryIntervalSeconds`、`CircuitBreakerThreshold`（若採用）建議存於 `process_config` 資料表（見第 9 節），n8n 節點的 Retry On Fail 的 Max Tries／Wait Between Tries 支援用 Expression 帶入變數，因此依然可以做到外部化。

---

## 9. process_config 共用設定表規格

取代 RPA 版「共用機器人設定檔.xlsx」。**帳密與一般參數分開管理**，這是 n8n 相對 RPA 版的結構性優勢：

- **帳密**：一律用 n8n **Credentials** 功能管理（內建加密儲存、可設定存取權限），不落入資料表或明文設定檔，直接解決 RPA 版第 11 節「密碼明文存放於共用 Excel」的疑慮
- **一般參數**（路徑、批次控制、重試參數）：存於 `process_config` 資料表

```sql
CREATE TABLE process_config (
    process_name              VARCHAR(100) PRIMARY KEY,
    raw_data_path              TEXT,
    output_path                 TEXT,
    complete_path               TEXT,
    error_path                  TEXT,
    download_path                TEXT,
    retry_count                 INT,
    retry_interval_seconds      INT,
    circuit_breaker_threshold   INT,      -- 未啟用熔斷機制的流程可留空
    email_to                    TEXT,
    email_cc                    TEXT,
    updated_at                  TIMESTAMP NOT NULL DEFAULT now()
);
```

**存取權限**：`process_config` 影響所有流程，修改前建議走單一入口／單一負責人流程，避免多人同時改動互相覆蓋；資料表本身納入 Postgres 定期備份即可。

---

## 10. 版本控制規範

**Workflow JSON 匯出頻率與 Git 提交時機 🔲待確認**：n8n workflow 存在資料庫，需要定期（例如每次修改後、或排程性地）從 n8n UI 匯出 JSON 並提交 Git，才能與 SDD 版本歷程對應；若自架的 n8n 版本支援內建 Source Control（Git 整合，多為 Enterprise/Cloud 功能），可直接沿用該機制，屆時本節做法需再確認調整。

**版本歷程記錄於 SDD**，沿用 RPA 版第 10 節原則：改動記錄統一寫在各流程 SDD 的「版本歷程」表格，不另外維護 Excel 記錄檔。

**升版規則（三級制，沿用 RPA 版判斷標準）**

| 異動類型 | 判斷標準 | 版本號變化範例 |
|---|---|---|
| Patch | 小幅邏輯修正，不改變整體流程行為 | v1.0 → v1.0.1 |
| Minor | 新增功能，原有邏輯不受影響 | v1.0 → v1.1 |
| Major | 架構性改動，牽動主流程骨架，需要重新完整測試 | v1.x → v2.0（例如從預設骨架升級為第 3 節進階斷點續跑模式） |

**Workflow JSON 備份命名規則**：每次 Minor／Major 版本部署前，將當下 workflow JSON 另存一份於 `workflows/{流程名稱}/history/`，命名 `{流程名稱}_v{版本號}_{YYYYMMDD}.json`，對應 SDD 版本歷程表的版本號。Patch 等級直接覆蓋，不留備份。

---

## 11. 待確認事項

- [ ] 🔲 Workflow JSON 匯出/Git 提交的具體流程與頻率，以及自架 n8n 版本是否具備內建 Source Control 功能
- [ ] 🔲 Schedule Trigger 重複觸發防護的具體實作方式（n8n 內建並發控制設定 vs. 自行查詢執行中狀態），需依實際 n8n 版本能力確認
- [ ] 🔲 自架 n8n 的 Execution History 保留天數/筆數上限，以及社群版的查詢/搜尋能力是否足以取代獨立稽核表（影響第 4 節判斷）
- [ ] 🔲 `process_config` 存放的實際存取權限規劃（哪些人可改、是否需要 UI 介面或直接改資料庫）
- [ ] 🔲 首個實際專案的資料量與單筆處理耗時，用以驗證第 3.2 節「是否需要進階模式」的判斷標準是否合理、`RetryCount`／`RetryIntervalSeconds`／`CircuitBreakerThreshold` 的預設值
- [ ] 🔲 若流程涉及「本機/桌面軟體」自動化（工具包提及的混合型情境之一），Playwright 只能處理網頁，桌面軟體部分的自動化方案本規範尚未涵蓋，需另行補充或評估是否仍需搭配 RPA 版工具
- [ ] 🔲 SFTP／雲端同步資料夾／SMB 掛載三種取檔方式，各流程實際採用哪一種、對應的 Credentials 與連線設定，需逐專案依檔案來源機器的實際環境決定（見工具包第四節，本文件未重複展開）
- [ ] 🔲 Log 內容若涉及個資欄位，遮罩規則需跟業務單位確認（沿用 RPA 版提醒）
