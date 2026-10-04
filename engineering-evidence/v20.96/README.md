# v20.96 GPT 獨立工程驗證證據

起始正式 main：955ef6b5c75460439f81868bcd3168f340dbec83。
本目錄是可公開、版控的工程基準，不是私人附件或使用者交換文件。
發布記錄見根目錄 VALIDATION_v20.96.md 及該 HEAD 的 GitHub checks。
最終文件 commit 不在自己內容中記錄自己的 hash；其自身 CI／Pages 另於交付收據核對。

## 封關

- Node22.23.3／npm11.6.2／預設heap：乾淨npm ci exit0。
- 字面npm test exit0：830項／829pass／0fail／1缺真實附件conditional skip。
- 字面npm run e2e exit0：59/59正式腳本串行，1,438✅／0❌。
- Pages build成功，5個新資產與原包逐位元一致。
- 新WASM守門：原包紅、修後綠；隔離副本僅刪runtime亦紅。
- 原包1,089條必要依賴邊有2條缺失／錯誤版本，修後1,092條全部閉合。
- 原包npm10.9.9 ci報Missing；修後相同安裝器預檢成功。
- 初始npm launcher環境失敗不是產品測試失敗，仍保留原始日誌。
- 原包與修後在原生平台npm11.6.2 ci均成功；不宣稱已實際執行WASM建置。
- runtime-diff-proof／bundle-diff-proof／index-diff-proof記錄精確比較，
  不能只拿CSS相同推論所有产物皆相同。
- 保護檔案／黃金值、計畫隔離、逐點比例、平假日、尖峰anyPcu維持。
- 沒有真實公司附件；沒有本輪實際Office開啟；不執行試用版HTML。
- audit有剩餘告警、兩條exit1；不稱零漏洞，不擴大直接依賴或強制降版。

日誌保留原始換行、診斷與失敗輸出。可控紅燈是反證，不是封關失敗；
封關結果以完整命令退出碼與pass／fail／skip為準。其他版本證據留在各版本目錄。
