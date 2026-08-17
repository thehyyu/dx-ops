# 同事連線指南：Windows 連上 n8n

*本文件適用對象：第一次連線 n8n 的同事。跟著步驟做，約 10 分鐘完成。*

---

## 前置說明

我們的 n8n 架設在一台 Mac Mini 上，**不對外公開**，只有透過 Tailscale 私有網路才能連線。

你需要做的事只有兩件：
1. 在 Windows 筆電安裝 Tailscale 並加入我們的私有網路
2. 用瀏覽器開啟 n8n

---

## Step 1｜請管理員發送邀請

> 這步由**管理員**（thehyyu）操作，不是你做的。

管理員會到 Tailscale 後台，將你的 Email 加入網路，你會收到一封邀請信，主旨類似：

> *「You've been invited to join a Tailscale network」*

收到信之後再繼續 Step 2。

---

## Step 2｜下載並安裝 Tailscale

1. 開瀏覽器，前往：**https://tailscale.com/download/windows**
2. 點選 **Download Tailscale for Windows**，下載安裝檔
3. 執行安裝檔，一路點「Next」即可，不需要更改任何設定
4. 安裝完成後，右下角工作列會出現 Tailscale 圖示（鑰匙形狀）

---

## Step 3｜登入 Tailscale 並加入網路

1. 點一下右下角工作列的 **Tailscale 圖示**
2. 點選 **Log in**
3. 瀏覽器會開啟登入頁面
4. 用你**收到邀請信的 Email** 帳號登入（支援 Google、Microsoft 帳號）
5. 登入後會看到「Join network」的提示，點選確認

> 如果沒有跳出 Join network，請回到邀請信點信中的連結。

---

## Step 4｜確認連線成功

1. 右下角點一下 Tailscale 圖示
2. 確認狀態顯示 **Connected**（綠色圖示）
3. 確認清單中看得到 **Mac Mini** 的裝置（或 IP `100.87.135.94`）

---

## Step 5｜開啟 n8n

1. 開啟任意瀏覽器（Chrome 或 Edge 皆可）
2. 在網址列輸入：

   ```
   http://100.87.135.94:5678
   ```

3. 看到 n8n 登入畫面即代表連線成功

> **第一次進入**：管理員會提供帳號密碼，或由管理員幫你建立帳號。

---

## 常見問題

**Q：安裝完 Tailscale 但找不到圖示怎麼辦？**
A：點一下工作列右下角的「^」展開隱藏圖示，Tailscale 可能在裡面。

**Q：Tailscale 顯示 Connected，但 n8n 網頁打不開？**
A：確認網址輸入的是 `http://`（不是 `https://`），以及 Mac Mini 的 n8n 服務是否正常運行（通知管理員確認）。

**Q：每次開電腦都要重新連線嗎？**
A：不需要。Tailscale 安裝後會自動在開機時連線，狀態一直是 Connected。

**Q：下班後需要關閉 Tailscale 嗎？**
A：不需要，讓它保持連線即可。若有需要可以右鍵圖示選「Disconnect」暫時中斷。

---

## 管理員操作參考：如何邀請新成員

1. 前往 **https://login.tailscale.com/admin/users**
2. 點選右上角 **Invite users**
3. 輸入同事的 Email，點 **Send invite**
4. 對方收信後依上述步驟操作即可
