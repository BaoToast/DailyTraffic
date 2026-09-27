/*
 * ══════════════════════════════════════════════════════════════════════
 *  A1／A3：「顯示調查日期」要被保存，而且跟人走
 * ══════════════════════════════════════════════════════════════════════
 *
 * v20.81 以前它只是一個 `useState(true)`：關掉之後**重新整理就跳回開啟**，
 * 而且畫面上沒有任何提示。三支統一的口徑（以交通服務水準為準）是
 * 「這台電腦這個人的顯示偏好」——存在瀏覽器儲存，**不寫進單一計畫備份**。
 *
 * ⚠️ 這支測試守的是規則，不是實作細節：
 *   ・有一把自己的鍵，而且讀得回來
 *   ・讀不到時**預設開**（不是關）
 *   ・畫面只透過會保存的那一支改狀態
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

test("有一把專屬的儲存鍵，而且真的寫得進去", () => {
  assert.match(
    source,
    /const SHOW_SURVEY_DATE_KEY = "traffic-show-survey-date-v1";/,
    "顯示調查日期的偏好又變回不保存了",
  );
  assert.match(
    source,
    /localStorage\.setItem\(SHOW_SURVEY_DATE_KEY, JSON\.stringify\(next\)\)/,
    "只改了狀態沒有寫進儲存——重新整理就會跳回去，那正是 A1 那個 bug",
  );
});

test("⚠️ 讀不到設定時預設是「開」，不是「關」", () => {
  const start = source.indexOf("function readShowSurveyDate()");
  assert.notEqual(start, -1, "讀取函式不見了");
  const block = source.slice(start, start + 600);
  assert.match(
    block,
    /raw === null \? true :/,
    "沒存過時不再預設為開——那等於把一個本來常駐顯示的功能悄悄收回去",
  );
  assert.match(
    block,
    /catch \{[\s\S]*?return true;/,
    "讀取丟例外時（無痕視窗、封鎖網站資料）沒有退回預設的開",
  );
});

test("⚠️ 畫面只能透過會保存的那一支改狀態", () => {
  /*
   * 直接呼叫 setShowSurveyDateState 的話，狀態會變但**不會被保存**，
   * 看起來完全正常，直到使用者重新整理。
   */
  const ui = source.slice(source.indexOf("return (", source.indexOf("const setShowSurveyDate")));
  assert.doesNotMatch(
    ui,
    /setShowSurveyDateState\(/,
    "畫面上直接改了內部狀態，繞過保存",
  );
  assert.match(source, /setShowSurveyDate\(event\.target\.checked\)/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K45（2026-09-24）：這一項原本寫錯了方向，而且錯的是**測試**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 原本的斷言是「不可以寫進**任何**備份」。但三支逐位元相同的
 * `never-revert-contract.mjs` 第 22 條寫的是：
 *
 *   「顯示調查日期」跟人走（**瀏覽器儲存／個人全部計畫包**），
 *   不跟單一計畫備份走
 *
 * 也就是「個人全部計畫包要帶它」。交通服務水準與路口轉向早就這樣做了
 *（`app.js` 的 TLM_PORTFOLIO_PACKAGE、`traffic-app.tsx` 的
 *  `...(scoped ? null : { showSurveyDate })`），各自的註解都記著同一個坑：
 *
 *   使用者關掉開關 → 下載自己的全部計畫包 → 換電腦匯入 →
 *   **開關被翻回開，畫面沒有任何提示。**
 *
 * 只有這一支沒跟上，而且**這條測試把正確的修法擋成紅的**——
 * 兩份規範互相矛盾時，程式跟了錯的那一份。
 * 2026-09-24 的 F6 獨立複查抓到（那一關只拿到打包好的檔案與規則，
 * 不知道作者想做什麼）。
 *
 * ⚠️ 所以這裡改成**兩個方向都守**：
 *   ・單一計畫備份（buildBackupPayload）**不可以**有——那份是給別人的；
 *   ・個人全部計畫包（traffic-analysis-backup-all）**必須**有，還原路徑也要讀。
 * 只守一半的話，兩種錯法各有一種不會被抓到。
 */
test("⚠️ 單一計畫備份不可以帶這個偏好（那份是給別人的）", () => {
  const start = source.indexOf("function buildBackupPayload");
  assert.ok(start > 0, "找不到 buildBackupPayload——改名的話這一支要跟著改");
  /* 只看這一支函式的本體，不要掃到「備份全部計畫」那一段。 */
  const body = source.slice(start, source.indexOf("\n  }", start));
  assert.doesNotMatch(
    body,
    /showSurveyDate/,
    "單一計畫備份帶了個人偏好——併入別人的備份時會靜默翻掉對方的開關",
  );
});

test("⚠️ 個人全部計畫包必須帶這個偏好，而且還原要讀回來", () => {
  const start = source.indexOf('format: "traffic-analysis-backup-all"');
  assert.ok(start > 0, "找不到全部計畫備份的 payload");
  /*
   * 切到那一份 payload 的結尾為止（檔名那一行），不要用固定字數——
   * 中間有一大段說明註解，用 +400 會剛好切在註解裡而抓不到實際欄位，
   * 於是測試會紅但程式是對的。第一版我就是這樣寫錯的。
   */
  const end = source.indexOf("全部計畫_交通量完整備份", start);
  assert.ok(end > start, "找不到全部計畫備份的檔名——改名的話這一支要跟著改");
  /*
   * ⚠️ 一定要先把註解剝掉再比對。這一段 payload 上面就有一大段說明註解，
   *   裡面寫了好幾次 showSurveyDate——不剝的話，**把欄位整個刪掉測試照樣綠**。
   *   我第一版就是這樣寫的，反證跑出來是綠的才發現。
   *   （同一個陷阱在 backup-completeness 也踩過一次。）
   */
  const payload = source
    .slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert.match(
    payload,
    /(^|[\s{,])showSurveyDate\s*[,:]/,
    "全部計畫包沒帶偏好——換電腦還原之後開關會被翻回預設值，而且沒有提示",
  );
  assert.match(
    source,
    /typeof payload\.showSurveyDate === "boolean"[\s\S]{0,80}setShowSurveyDate\(/,
    "還原路徑沒有讀回偏好，或讀了卻沒有走會保存的那一支",
  );
});
