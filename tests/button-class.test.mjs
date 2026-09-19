/*
 * ══════════════════════════════════════════════════════════════════════
 *  按鈕的樣式修飾詞，一定要跟基底 class 一起用
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（附圖）：
 *   「下載圖片的按鍵，顏色與取消按鍵不同，乍一看之下，
 *     我只能取消，沒有地方可以按確認匯出」
 *
 * ── 成因 ──────────────────────────────────────────────────────
 *
 * 這一支的按鈕樣式是拆成兩層寫的：
 *   `.button`          → 高度、內距、圓角、字級、字重（**按鈕的樣子**）
 *   `.primary` 等      → 只負責顏色
 * 所以修飾詞必須和 `.button` 一起用。
 *
 * 「一鍵下載全部圖檔」那顆漏了 `button`，實測它的電腦計算樣式是
 * 底色透明、外框 0px、圓角 0px、內距 0px、字重 400——**完全沒有按鈕的樣子**。
 * 而它旁邊的「全部取消」是正常按鈕。結果畫面上最重要的那個動作看起來像
 * 一行字，次要動作看起來才像按鈕，使用者因此以為「沒有地方可以按確認」。
 *
 * ⚠️ 這一類錯最麻煩的地方：**它不會壞、不會報錯、不會少功能**，
 *   按鈕點得下去、功能一切正常，只是看起來不像按鈕。
 *   任何「有沒有這顆按鈕、點了有沒有反應」的測試都會過。
 *   全檔 18 顆 primary 按鈕裡只有 1 顆寫錯——靠肉眼逐顆看是不可靠的。
 *
 * ⚠️ 這一支是**靜態**檢查（讀原始碼），刻意不去跑瀏覽器：
 *   跑瀏覽器只量得到「當下畫得出來的那幾顆」，而很多按鈕要特定資料
 *   或特定視窗才會出現，量不到的就等於沒驗。讀原始碼是每一顆都讀得到。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, "..", "app", "DashboardClient.tsx"),
  "utf8",
);
const styles = readFileSync(join(here, "..", "app", "globals.css"), "utf8");

/*
 * 修飾詞清單不是我憑印象列的，是從樣式表裡「寫成 .button.X」的那些取出來——
 * 樣式表自己就宣告了「X 要和 button 一起用」。
 */
const modifiers = [
  ...new Set(
    [...styles.matchAll(/\.button\.([a-z][\w-]*)/g)].map((match) => match[1]),
  ),
];

test("前置：從樣式表讀得出「要和 button 一起用」的修飾詞（讀到 0 個就是恆真）", () => {
  assert.ok(
    modifiers.length >= 2,
    `只讀到 ${modifiers.length} 個修飾詞（${modifiers.join("、")}）。` +
      "樣式表的寫法變了，這支測試已經不再守著任何東西，必須先修好它。",
  );
});

/** 取出每一個 className="..." 的字面值（只看寫死的字串，樣板字串另案）。 */
const classNames = [...source.matchAll(/className="([^"]*)"/g)].map((match) =>
  match[1].trim().split(/\s+/),
);

test("前置：真的掃到 className（掃到 0 個就是恆真）", () => {
  assert.ok(classNames.length > 50, `只掃到 ${classNames.length} 個`);
});

test("凡是用了 button 的修飾詞，就一定要同時有 button 這個基底 class", () => {
  const bad = [];
  for (const list of classNames) {
    const used = modifiers.filter((name) => list.includes(name));
    if (used.length === 0) continue;
    if (list.includes("button")) continue;
    /*
     * ⚠️ 例外：這些修飾詞的名字也被別的元件借用（不是按鈕）。
     *   只在「這一串 class 裡完全沒有其他線索」時才判定為漏寫。
     *   目前沒有需要豁免的，若日後有，請在這裡具名列出並寫清楚理由,
     *   不可以改成「含有某某字就跳過」那種會愈放愈寬的寫法。
     */
    bad.push(`class="${list.join(" ")}"（用了 ${used.join("、")}）`);
  }
  assert.deepEqual(
    bad,
    [],
    "有 class 用了按鈕的修飾詞卻沒有基底 `button`。\n" +
      "那顆按鈕會失去高度、內距、圓角與字重——**看起來不像按鈕**，\n" +
      "但功能完全正常，所以任何「點得動嗎」的測試都抓不到。\n" +
      bad.join("\n"),
  );
});

test("而且那顆「下載勾選的 N 張圖」確實是 button primary（釘住這一次的修正）", () => {
  /*
   * ⚠️ 上面那條是通則，這一條是釘住使用者真的指出來的那一顆。
   *   通則哪天被改寬了，這一條還會擋著。
   */
  const at = source.indexOf('id="downloadAllChartPng"');
  assert.ok(at > 0, "找不到 downloadAllChartPng 這顆按鈕");
  const around = source.slice(Math.max(0, at - 600), at);
  assert.match(
    around,
    /className="button primary"/,
    "「下載勾選的 N 張圖」不是 `button primary`。" +
      "少了 button 它就沒有按鈕的樣子，使用者會找不到確認鍵。",
  );
});
