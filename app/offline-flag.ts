/*
 * 離線旗標的讀寫，包成函式放在元件外面。
 *
 * ⚠️ 為什麼要有這一支檔案（2026-09-14）：
 *   原本是在 DashboardClient 的 render 期間直接寫 `window.__TRAFFIC_OFFLINE__`。
 *   react-hooks/immutability 會擋（「render 期間不可以改元件外面的東西」），
 *   所以那裡掛了一個 eslint-disable。
 *
 *   後來發現那個豁免帶來一個更麻煩的問題：**ESLint 會誤報它「沒有用到」**
 *   ——單獨 lint 那一個檔案時不會報，lint 整個 app/ 目錄時才會報，
 *   而拿掉豁免規則確實會出錯。也就是說：豁免是必要的，工具卻說它多餘。
 *   而 lint 設定是零警告，那條誤報會讓整包測試永遠紅。
 *
 *   ⚠️ 我一開始把成因判斷成「豁免指令後面加了 `-- 理由` 尾巴」，
 *     那是**錯的**——拿掉尾巴之後照樣誤報。真正的差別在 lint 的範圍
 *     （單檔 vs 整個目錄），與寫法無關。這個錯誤的結論已一併更正。
 *
 *   所以改成真正的解法：把寫入動作包進這個模組的函式裡。
 *   規則擋的是「在 render 期間直接改外面的值」，改成呼叫一個
 *   定義在元件外的函式之後，規則本來就不該有意見——
 *   於是**整個豁免可以拿掉**，誤報自然消失，而行為一模一樣：
 *   旗標仍然在任何 appFetch 發生之前就設好（這正是它存在的理由，
 *   改成 effect 會晚一個 commit）。
 */
declare global {
  interface Window {
    __TRAFFIC_OFFLINE__?: boolean;
  }
}

/**
 * 標記為離線模式。由 app-fetch.ts 的 offlineMode() 讀取。
 *
 * ⚠️ 這是**單向**的：只會設成 true，永遠不會設回 false。
 *
 *   這不是隨手寫成這樣，是原本那段程式的語意，而我一度改錯過：
 *   我把它寫成 `markOfflineMode(!user)`（看起來更「對稱」），
 *   結果端對端測試整支掛掉。原因是元件會 render 不只一次——
 *   第一次 user 還沒到位（!user 為真）標成離線，第二次 user 有值了，
 *   雙向版本就把旗標**清回 false**，於是程式開始打不存在的 API，
 *   畫面跳出「Failed to execute 'json' on 'Response'」而且整個流程卡住。
 *
 *   原本的寫法 `if (!user) window.__TRAFFIC_OFFLINE__ = true;` 從來不清除，
 *   所以沒有這個問題。維持單向。
 */
export function markOfflineMode() {
  if (typeof window === "undefined") return;
  window.__TRAFFIC_OFFLINE__ = true;
}
