# v20.94 GPT 獨立驗證證據

工程正式紀錄隨 Repository／GitHub 保存；Downloads 的交付副本不是唯一保存位置。
版本、完整結果、條件式略過與發布證據以根目錄 `VALIDATION_v20.94.md` 為準。

本目錄保存最終命令日誌、實際反證的選定日誌，以及真正 Microsoft Excel 引擎
渲染的匿名測試圖。不得放入真實 Excel／CSV、公司附件、憑證或計畫備份。
原始 Windows 日誌保留 CRLF 與測試 runner 的空白行，不為 whitespace 檢查竄改原始輸出；
原始碼／文件的 diff whitespace 檢查與這些原始日誌分開核對。
所有工作簿與瀏覽器資料均由測試當場生成，工作簿本身不納入工程 Repository。

Node IPC 的最小重現取自官方問題的同型路徑：先寫有效序列化 diagnostic，
緊接非 ASCII 普通 stdout；本機 Node 22.23.3 退出碼 1。相同文字改送 stderr
退出碼 0。程式碼與官方說明：
https://github.com/nodejs/node/issues/65934 。本專案只調整測試的診斷管道，
不修改 Node runtime、效能門檻或正式產品計算。

圖表圖片用途是工程驗證，不是程式執行期資產。Office 原生圖修正後保留全部
數字、選單公式與圖例；趨勢線可見、比例軸為百分比、甜甜圈不擠扇區內文字。

`final-gate-e2e.log` 為正式 59 支串行全套退出碼 0 的紀錄。
`final-complete-test.log` 是文件守門補強後的最終字面 npm test：829／828／0／1，退出碼 0。
`final-gate-test.log` 是補強前的完整綠燈，不能取代最新結果；中途 probe 敘述紅燈亦保留。
`current-report-before/red/green.log` 為現行報告條數探針的漏查、擋住與還原通過。
`multiline-viewport.log` 與四張 trend PNG 是 1536×864／1366×768 多點圖及真實下載。
目視確認圖例在 X 軸下方、不重疊，線尾不放名稱。兩個 PNG 匯出相同，因為高解析
輸出採固定繪圖尺寸；畫面採各視窗尺寸。全頁長內容仍使用正常垂直捲動。
第一次臨時 probe 點了圖檔入口而不是單張下載鈕，故等待下載逾時；紀錄保留，
更正 probe 選擇器後通過，正式程式未為此改動。recipe.txt 是重現步驟備查，
原本在 ignored `_review_artifacts` 執行，不屬於正式掛鉤 E2E 清單或新增的第 60 支。

`program-online.log` 為程式 release commit 的 cache-busting 線上逐檔 SHA-256 與舊版 404。
`formal-npm-ci.log` 為正式 Documents 工作區更新到同一 commit 後的乾淨依賴重建。
`verify-pages-recipe.txt` 為可重現的線上核對步驟，使用實際執行的 Git HEAD 作參數。
GitHub 對應 commit 的 CI／Pages 紀錄及最後文件 HEAD，可由 main 歷史和 Actions 核對。
