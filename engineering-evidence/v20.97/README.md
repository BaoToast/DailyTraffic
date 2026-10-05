# v20.97 GPT獨立工程證據

起始正式main：f977e23e6e559a5b346ed6d7d0a801ed96a74ee1。
本目錄是可公開、版控的工程基準，不含私人附件；使用者與Claude往來說明另存Downloads。
正式完整結果見根目錄VALIDATION_v20.97.md，最終HEAD自身CI／Pages及封裝另見交付收據。

## 複查範圍

低風險註解／測試增量。未改交通計算、anyPcu、匯入保存、匯出、四個禁止變更檔。
原包來源與實際程式差異、三個JS發布中繼資料正規化後相同、依賴樹未變均獨立核對。
原包Pages9檔與source一致；本機乾淨Pages build五個程式資產相同。

## 發現、反證與邊界

- header-old-red：新版守門對正式舊版兩支腳本實跑1pass／2fail；header-green為修後相關守門。
- title／header／count相關targeted守門實跑通過，不取代完整字面npm test。
- manual-title-red：原包HTML／PDF内部標題v20.96，兩項守門0pass／2fail。
- pdf-title-proof：最終僅同長metadata一個位元組，xref／頁stream未變，35頁文字一致。
- pdf-render-proof：35頁重渲染PNG逐位元一致，全部頁面已目視核對；不是僅抽封面。
- complete-test-first-red：第一次完整835項／832pass／2fail／1skip。
  修後PDF SHA尚未同步及既有regex數錯三項為二項，皆修正，保留原始紅燈。
- test-count-red：隔離副本用舊regex計數器，實際三項header檔被數成二項，2pass／1fail。
- complete-test-lint-red：GPT測試fixture多餘跳脫，完整lint實際擋下；已修復並保留日誌。
- audit兩條exit1：完整樹16high／6moderate，production2moderate／0high／critical。
- 原生Windows npm11.6.2 npm ci成功；不將缺真實附件、Office未重開、WASM未實建稱pass。
- 原有tryout腳本保留，但本輪不執行、不產生、不交付試用版HTML。

修後字面npm test exit0：838項／837pass／0fail／1缺真實附件conditional skip。
效能平方反證96.6倍／正常線性6.4倍，門檻30未改；黃金值維持。
字面npm run e2e退出0：59/59正式腳本串行通過，1,438 ✅／0 ❌。
正式推送及線上發布仍待核對，不使用Claude封關宣稱代替實測。
日誌保留原始診斷、換行及失敗內容；不為git空白檢查改寫原始日誌。
