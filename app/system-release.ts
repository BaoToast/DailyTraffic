/*
 * 系統版號與更新日期的單一來源。
 *
 * 以前這兩個值只寫在 DashboardClient.tsx 裡，測試就只好再抄一份字面值；
 * 每次升版都要記得同步改兩個地方，忘了改測試就會出現「測試失敗但程式是對的」
 * 這種最容易被草率處理掉的失敗。抽出來之後，畫面與測試讀的是同一份。
 */
export const SYSTEM_VERSION = "v20.39";
export const SYSTEM_UPDATED_AT = "2026-09-01";
