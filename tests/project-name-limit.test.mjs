/*
 * ══════════════════════════════════════════════════════════════════
 *  計畫名稱與計畫編號的字數上限
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者實測回報兩次：
 *   ①「當我把計畫名稱故意設定很長的時候，左邊計畫名稱卡片明顯突破邊界，
 *      並沒有自動換行……針對長名稱的計畫，請讓名稱自動換行（三份程式都是）」
 *   ②「計畫名稱沒問題了，但忘記限制計畫編號（三個程式都是），
 *      當編號過長時會遮蓋到計畫名稱，請也一樣做調整（設上限或換行）」
 *
 * 定案是**上限與換行兩個都做**。這一支釘住「上限」那一半，
 * 「換行」那一半由版面量測腳本（harness/longname-3.mjs）實測。
 *
 * ── ⚠️ 這一支刻意迴避的假通過陷阱 ──────────────────────────────
 *
 * 一、只驗「超過上限會被切短」不夠。那樣的實作是 `next.slice(0, limit)`，
 *     而它會**吃掉既有的長內容**：使用者硬碟裡已經有一個 60 字的名稱
 *    （上限是這一版才加的），他打開改名視窗只想刪一個錯字，
 *     onChange 收到 59 字就被切成 40 字，畫面上沒有任何提示。
 *     所以一定要同時驗「既有的超長內容不可以被截斷」。
 * 二、只驗「既有內容原樣回傳」也不夠——那樣「什麼都不做」也會過。
 *     要同時驗「既有長內容不可以再變得更長」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

/*
 * ⚠️ 掃原始碼的斷言一律比對壓平空白之後的字串。
 *
 * 2026-09-11 的教訓：我不小心對 DashboardClient.tsx 跑了一次
 * `prettier --write`（這個專案本來就不是 prettier 排版）。行為一個字都沒變，
 * 但 `Math.max(A, B)` 被折成三行，於是這裡紅字，訊息寫著
 * 「改名框的 maxLength 要放寬到既有長度，否則游標進不去後半段」——
 * 聽起來像那個修正被刪掉了，其實只是換行位置變了。
 * 換行不是行為。
 */
const flat = source.replace(/\s+/g, " ");


/* capText 是純函式，直接把它從原始碼裡取出來跑，不必啟動整個元件。 */
const body = source.slice(
  source.indexOf("export function capText("),
  source.indexOf("\n}\n", source.indexOf("export function capText(")) + 3,
);
const capText = new Function(
  "next",
  "previous",
  "limit",
  body
    .replace("export function capText(next: string, previous: string, limit: number): string {", "")
    .replace(/\n}\n$/, ""),
);

const NAME_LIMIT = Number(
  /export const PROJECT_NAME_LIMIT = (\d+);/.exec(source)[1],
);
const CODE_LIMIT = Number(
  /export const PROJECT_CODE_LIMIT = (\d+);/.exec(source)[1],
);

test("上限本身要是實際案名放得下的長度", () => {
  /*
   * 實際案名「高捷岡山路竹延伸線RKC02標」是 15 字。上限訂得比它短，
   * 使用者連真正的案名都打不完——那不是保護，是障礙。
   */
  assert.ok(NAME_LIMIT >= 30, `計畫名稱上限 ${NAME_LIMIT} 太短`);
  assert.ok(NAME_LIMIT <= 60, `計畫名稱上限 ${NAME_LIMIT} 擋不住撐破側欄的長度`);
  assert.ok(CODE_LIMIT >= 12 && CODE_LIMIT <= 40, `計畫編號上限 ${CODE_LIMIT} 不合理`);
});

test("新輸入超過上限會被擋下來", () => {
  const long = "測".repeat(NAME_LIMIT + 20);
  assert.equal(capText(long, "", NAME_LIMIT).length, NAME_LIMIT);
  assert.equal(capText("A".repeat(CODE_LIMIT + 5), "", CODE_LIMIT).length, CODE_LIMIT);
});

test("上限以內的輸入一字不動", () => {
  assert.equal(capText("高捷岡山路竹延伸線RKC02標", "", NAME_LIMIT), "高捷岡山路竹延伸線RKC02標");
  assert.equal(capText("", "舊", NAME_LIMIT), "");
});

test("既有的超長內容不可以被截斷（這是會靜靜掉資料的那一項）", () => {
  const legacy = "測".repeat(60);
  /* 原樣載入：不可以變成 40 字。 */
  assert.equal(capText(legacy, legacy, NAME_LIMIT), legacy);
  /* 刪掉一個字：要留下 59 字，不是被砍成 40 字。 */
  const minusOne = legacy.slice(0, 59);
  assert.equal(capText(minusOne, legacy, NAME_LIMIT).length, 59);
  /* 一路刪到上限以內之後，就回到一般規則。 */
  assert.equal(capText("測".repeat(10), "測".repeat(11), NAME_LIMIT).length, 10);
});

test("既有的超長內容也不可以再變得更長", () => {
  /*
   * ⚠️ 少了這一項，「原樣回傳」就可以用「什麼都不做」通過，
   * 上限等於完全沒有作用。
   */
  const legacy = "測".repeat(60);
  assert.equal(capText(legacy + "再加十個字", legacy, NAME_LIMIT).length, 60);
});

test("輸入框同時掛上 maxLength 與 capText，且改名框的 maxLength 不擋既有長度", () => {
  /*
   * maxLength 擋鍵盤輸入、capText 擋貼上，兩個都要——只有 maxLength 的話
   * 直接貼上一長串仍然進得去。
   */
  assert.ok(
    (source.match(/capText\(/g) ?? []).length >= 5,
    "四個輸入框（新建的名稱／編號、改名的名稱／編號）都要走 capText",
  );
  assert.match(
    flat,
    /maxLength=\{Math\.max\( ?PROJECT_NAME_LIMIT, ?projectDraft\.name\.length,? ?\)\}/,
    "改名框的 maxLength 要放寬到既有長度，否則游標進不去後半段、改不動",
  );
  assert.match(
    flat,
    /maxLength=\{Math\.max\( ?PROJECT_CODE_LIMIT, ?projectDraft\.code\.length,? ?\)\}/,
    "計畫編號的改名框同理",
  );
  /* 旁邊要即時顯示字數，不然使用者不知道還剩幾字。 */
  assert.match(source, /最多 \{PROJECT_NAME_LIMIT\} 字/);
  assert.match(source, /最多 \{PROJECT_CODE_LIMIT\} 字/);
});

test("換行那一半：CSS 要同時處理彈性軌道與元素本身", async () => {
  /*
   * ⚠️ 這一條記錄的是**上一輪只修一半的錯**：
   * `minmax(0, 1fr)` 只救得了彈性軌道，救不了固定寬度軌道；
   * 固定軌道要靠元素自己 overflow-wrap 才不會溢出去壓到旁邊。
   * 兩者都要有，缺一個就會重演「名稱好了、編號還是蓋住名稱」。
   */
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.project-card\{[^}]*grid-template-columns:34px minmax\(0,1fr\)/,
    "計畫卡片的彈性軌道要用 minmax(0,1fr)，寫 1fr 會被中文長字串撐開",
  );
  assert.match(
    css,
    /\.project-card strong\{[^}]*overflow-wrap:anywhere/,
    "計畫名稱本身要能換行，否則既有的長名稱照樣溢出",
  );
  assert.match(
    css,
    /\.project-card strong\{[^}]*text-wrap:balance/,
    "分行要平均，不可以最後一行只剩兩三個字",
  );
  assert.match(css, /\.field-note \{/, "字數提示要有自己的樣式");
});
