# v20.98 GPT獨立工程證據

正式Repository：BaoToast/DailyTraffic，正式本機工作區
`D:\Users\95108\Documents\Codex\DailyTraffic`。起始基準
`b381eec2a17a1be45b5f9dac2a36379ed5035c95`，前一正式程式v20.97。

本版為低風險UI間距／測試增量，但依交接規則執行完整必要驗證。
資料流、計算、保存、匯入、匯出、anyPcu及四個禁止變更檔未修改。
新靜態守門仍5項；未放寬豁免、間距或效能門檻。

## 反證對照

- css-string-false-green：原守門在CSS宣告字串冒充class時5pass、exit0。
- css-string-repaired-red：相同隔離案例修後4pass／1fail、exit1。
- remove-rules：移除間距規則，2pass／3fail、exit1。
- reverse-order：反轉規則顺序，4pass／1fail、exit1。
- styled-exemption：已有樣式的panel列入豁免，4pass／1fail、exit1。
- left-zero：四值padding左邊0px，4pass／1fail、exit1。
- built-small-original／fixed：建置CSS11px，原5pass／exit0，修後4pass／1fail／exit1。
- old-coverage-false-green：實際v20.97原class-coverage缺inline-note規則仍exit0。
- missing-css-e2e：新守門缺規則exit1、兩項紅，內距0px。
- small-padding-original／fixed-e2e：11px原量成12px而exit0，修後量成11px而exit1、一項紅。
- missing-empty-e2e：拿掉預期空狀態文字exit1、兩項紅，不能因不存在而跳過。

以上為故意破壞的隔離副本，沒有修改正式資料或把破壞產物納入發布。
錯誤提示樣式探針只驗CSS，不充當真實IndexedDB故障／持久化測試。
ui-states為兩尺寸×ready/loading/error六分支，目標面板內距均18px；
loading/error控制新context的IndexedDB入口，不冒稱真實資料驗收。

完整封關、發布commit、自身CI／Pages與線上逐檔SHA以
`VALIDATION_v20.98.md`及相應原始日誌為準。第一輪完整測試若紅保留原始日誌；
不能只用拆開的單项綠燈替代修後字面npm test與59支串行npm run e2e。
PostCSS使用既有8.5.28，GPT補直接開發依賴宣告，已解析套件樹未變。

使用者的截圖、35頁手冊渲染、Claude往返說明與完整下載ZIP放在有日期的
Downloads交付區；工程基準與可公開原始測試證據留在Repository及GitHub。
沒有交付tryout HTML；缺真實附件、Office未實開、WASM未實建必須與pass區分。
