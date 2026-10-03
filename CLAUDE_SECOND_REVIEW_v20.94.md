# v20.94：交給 Claude Opus High 的第二次獨立複查資料

本文件是本次發布的複查附件，不取代唯一正式工程交接基準 `PROJECT_HANDOFF.md`。
正式工作區：`D:\Users\95108\Documents\Codex\DailyTraffic`。
Repository：`https://github.com/BaoToast/DailyTraffic`；Pages：`https://baotoast.github.io/DailyTraffic/`。

## 來源與基準

- 前一正式版本 v20.89；基準 commit `d6e3efb1b49fd2edc6c5c180d9fd462ee1d619c3`。
- 使用者指定的 v20.94 專案 ZIP SHA-256：`510bb167f476d3b3367f81e7371ebb297c78d9d23db29cdae0e78b67600d71d1`。
- 說明 ZIP SHA-256：`7c70725c31ec71e2db7c2533e27cc26198843905e574903a238c80c07bd29fcd`。
- 原包日期 2026-09-30；本次 release commit 日期在落盤後核對，以台北時間 Git 日期為準。
- 原包包含 v20.90～.93 的累積候選；不能只按 v20.93 → .94 的一處修改判定風險。

## Claude 原始修改

A27 自訂係數等價守門、混批季度阻擋、覆寫前日期確認、PCU 範圍說明、
圖說與對話框版面、季別×調查點的車種歸類／異常門檻覆寫，以及新 Excel
匯入時超過 60 分鐘單格直接阻擋。使用者 09-30 的阻擋裁示取代 09-24 僅提醒。

## GPT 獨立發現及修正

| 缺陷／root cause | 修正與守門 |
| --- | --- |
| 門檻 scope 只接本機儲存，漏了備份／兩條還原 | 可選 schema 欄位、逐計畫讀寫、驗證、舊包清除目的計畫殘留、失敗提醒；真實瀏覽器操作 |
| 歸類警告接到舊 xls 而不是正式 ExcelJS | 正式 xlsx 的明細旁欄、方向表與範圍設定表；正式下載解析與 Office 開啟 |
| 長時間格只在預覽阻擋，確認寫入入口未重查 | 入口守門與統一 `longIntervalBlock()`；正常時長仍可匯入 |
| 門檻 memo 測試容許函式參數替代依賴 | 只驗真實依賴列，移除依賴實跑紅燈 |
| 跨季歸類互換時集合比較漏判不可比 | 逐點／逐季关联檢查；修前反證紅燈，不平均各點比例 |
| 儲存提示提到不存在的套用鈕 | 明說有效輸入自動保存 |
| Windows 真實附件 URL.pathname 錯路徑 | `fileURLToPath()` 與原生路徑案例；缺附件仍如實略過 |
| 負 PCU 係數提示稱會歸零 | 只修文字，負值不自動歸零，算法不動 |
| Office 原生折線的線條是 noFill | 實際 XML writer 改可見線，保留缺點斷線與資料 |
| 原生組成比例圖 0～1 顯示小數軸 | cache／axis 格式 `0.0%`，不乘錯數字 |
| Office 甜甜圈小比例車種文字重疊 | 統一圖例與旁表，不畫扇區內文字；不凍結選單切換前的 cache 遮罩 |
| 新 production brace-expansion 安全公告 | 僅相容 patch lock 更新，不強制 downgrade／override，乾淨 npm ci 再驗 |
| Node 22 中文 stdout 與測試 IPC 混流 | 實跑 stdout 紅／stderr 綠的最小重現，五檔改診斷管道，保留全部資訊與斷言 |
| 文件條數守門指向舊驗證報告 | 依 SYSTEM_VERSION 選擇現行報告；錯誤項數探針舊碼綠／補強後紅，保留歷史項數並標明現行數量 |

完整反證、原先紅燈與處置見 `VALIDATION_v20.94.md`；交付包提供日誌，不把
source guard 紅燈冒稱為瀏覽器反證。A27 的兩顆 mutation 均實際跑紅後還原。

## 不可改動與高風險複查重點

- `tests/never-revert-contract.mjs`、`tests/dependency-manifest.test.mjs`、
  `app/number-field.tsx`、`app/period-analysis.ts` 與正式基準逐位元一致。
- 預設黃金值 688,205 輛／日、530,122 PCU／日；尖峰 `anyPcu` 不動。
- 佔比逐點各自計算；平日／假日並列；不足 60 分鐘的尖峰是資料不足，不回退值。
- 檢查季別×調查點 > 季別 > 調查點 > 計畫預設的解析、計畫隔離、備份相容與 memo 更新。
- 檢查警告在 UI／草稿／正式 Excel 一致；PNG 的淨空設計不可拿掉。
- Excel 選單會變更圖表數字，不得依匯出時 cache 固定隱藏某個車種。
- H32 只確認新 Excel 入口阻擋，不代表既存資料或 JSON 還原全數結案。
- 真實調查附件缺少的 conditional skip 不等於通過；不能宣稱所有實際公司檔均測過。
- production audit 0 critical／0 high／2 moderate；整棵依賴樹仍有 21 high／8 moderate／1 low。

## 最終驗證與發布證據

完整 literal `npm test` 退出碼 0：829 項／828 通過／0 失敗／1 缺真實附件略過。
59/59 支串行 E2E 已通過；程式 release commit `1d385b4144b1bb3275f19017c22c16151da45faa`。
台北發布日期 2026-10-03；該 commit 的 CI `37111885873`、Pages `37111885393` 均 success。
線上 HTML、五個資產、手冊與報告 SHA-256 一致，前一版變動資產／手冊／報告均 404。
證據隨 Repository 保存在 `engineering-evidence/v20.94/`；最後文件 HEAD 的 CI／Pages
須再次驗證，最終 commit 與流程 ID 於交付收據記錄，也可由 GitHub main 的 Actions 核對。
不要採信 Claude 原包的「全綠」，也不要以舊 v20.89 的 deployment run 冒充本版證據。
