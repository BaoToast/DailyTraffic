# v20.95 GPT 公開封關證據（2026-10-04）

以下為本輪獨立執行日誌，不是 Claude 的結果。正式對象為 BaoToast/DailyTraffic，
基準 main `fddfd16b983f611cab1f4e1cfb1f4a02947d7c6c`；來源與風險判定見
根目錄 `VALIDATION_v20.95.md`。日誌可能保留 Windows 換行、ANSI 與測試診斷空白，
不為了 whitespace 檢查改寫原始證據。未包含私人調查附件或臨時 xlsx／PNG。

- npm-ci.log：字面 npm ci，exit 0。
- build-pages.log：npm run build:pages，exit 0；五個資產與收到 ZIP 逐位元相同。
- complete-test.log：字面 npm test，exit 0，829／828 pass／0 fail／1 conditional skip。
  同一命令含 lint、TypeScript、字形守門、production build；Node 22.23.3／npm 11.6.2，
  NODE_OPTIONS 為空，未設定 heap 或測試並行捷徑。
- full-e2e.log：字面 npm run e2e，exit 0，59 支正式腳本串行，日誌 1,438 ✅／0 ❌。
  未與單元／效能 suite 並行，未產生或執行試用版 HTML。
- mutant-backup.log：移除 thresholdScopes 備份 return，6 pass／1 fail，exit 1。
- mutant-scoped.log：同一破壞，AST 接線守門 5 pass／1 fail，exit 1。
- mutant-old-list.log：同一破壞加舊 MUST_TRAVEL，7 pass／0 fail，exit 0（漏查反證）。
- mutant-preassert.log：復原錯置候選數斷言，選定案例 0 pass／1 fail，exit 1。
- mutant-future-base.log：超前發布基準 95，選定案例 0 pass／1 fail，exit 1。
- targeted.log：反證還原但尚未重建的第一次診斷，24 pass／1 fail；唯一失敗是資產 mtime。
  保留失敗，不用此結果當封關；已正常重建／同步，而非改時間戳或放寬守門。
- final-guards.log：最終文件／備份／AST／依賴隱私守門，37 pass／0 fail／0 skip，exit 0。
- identity-and-invariants.log：origin／基準與四個禁止檔案的 SHA-256，全部與正式基準相同。
- runtime-diff-proof.log：DashboardClient 與基準相比，僅兩個手冊版本檔名不同。
- production-audit.json：npm audit --omit=dev，exit 1；2 moderate、0 high／critical。
  安裝全樹為 21 high／8 moderate／1 low，不能寫成零漏洞。

所有反證破壞皆已還原。37 項定向守門不能替代上面的完整 829 項及 59 支 E2E。
真實調查附件略過與本輪未重做 Office 實開仍明確保留；歷史 Office 證據在累積報告中。

程式 release commit 1b21e1a8352b1221313de549c1325972d24578a0 的發布證據：

- program-actions.log：CI 37164410013／Pages 37164409563 均為此 HEAD 的 success。
- program-online.log：九個現行檔 HTTP 200、SHA-256 相符，五個退役 URL 404，FAILURES=0。
- remote-smoke-initial.log：追加瀏覽器檢查第一次 launch 因預設 headless shell 未安裝而 exit 1。
- remote-smoke-final.log：改用既有已安裝瀏覽器，exit 0；線上 v20.95、正確 PDF 連結、pageerror 為空。

最後文件 HEAD 自身的 CI／Pages 及線上雜湊另存使用者交付收據，不用程式 commit 的
成功替代該 HEAD 的驗證；不為了自我記錄雜湊而無限新增文件 commit。
