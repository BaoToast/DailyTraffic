/*
 * ══════════════════════════════════════════════════════════════════════
 *  W 區守門（全日交通量）：#14 複製說明／#44 逐塊量／W-0e 草稿下拉黏住
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29：
 *   ・#14「做」── 確認結果：「複製說明」只有 1 處（歷季趨勢）
 *   ・#44「做」── 確認結果：圖說版面守門只量第一塊
 *   ・「全日交通量 草稿按鍵和上方行黏在一起」（附圖）── 清單裡沒有，本輪新增
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(
  join(here, "..", "app", "DashboardClient.tsx"),
  "utf8",
);
const cssSource = readFileSync(join(here, "..", "app", "globals.css"), "utf8");
const figureNoteProbe = readFileSync(
  join(here, "..", "scripts", "e2e-figure-note-layout.mjs"),
  "utf8",
);

/* ══════════════════════════════════════════════════════════════════════
 *  #14 每一張圖的說明都要能複製
 * ══════════════════════════════════════════════════════════════════════ */

test("#14-1 複製按鈕做在共用的 ChartNote 裡，不是逐張圖各貼一顆", () => {
  /*
   * ⚠️ 這一條守的是「下一張新圖不會漏」。逐張貼的話，漏掉不會有任何症狀。
   */
  const start = dashboardSource.indexOf('<aside className="chart-note" data-chart-note>');
  assert.ok(start > 0, "前置：找不到共用的 ChartNote");
  const block = dashboardSource.slice(start - 2000, start + 800);
  assert.match(block, /data-testid="chart-note-copy"/, "共用元件裡沒有複製按鈕");
  assert.equal(
    (dashboardSource.match(/data-testid="chart-note-copy"/g) || []).length,
    1,
    "複製按鈕出現了不只一次——它應該只在共用元件裡寫一次",
  );
});

test("#14-2 複製出去的是純文字，不可以帶 ** 星號", () => {
  /*
   * 說明的原文用 ** 標粗體（boldParts 會把它轉成 <b>）。
   * 複製時沒有把星號拿掉的話，貼進簡報或 Word 會看到一堆星號。
   */
  const start = dashboardSource.indexOf("const plainText = [");
  assert.ok(start > 0, "前置：找不到 plainText");
  const block = dashboardSource.slice(start, start + 400);
  assert.match(block, /replace\(\/\\\*\\\*\/g, ""\)/, "沒有把 ** 粗體標記拿掉");
});

test("#14-3 剪貼簿不能用時要有退路，而且不可以寫成可選鏈短路的那種寫法", () => {
  /*
   * ⚠️ `navigator.clipboard?.writeText(text).catch(…)` 在 clipboard 是
   *   undefined 時整條短路成 undefined，**連 .catch 都不會跑**
   *   （2026-09-25 在 copyTrendScript 上實測過）。非安全內容（http 的區網
   *   網址）與舊瀏覽器都會這樣：按下去沒有複製、沒有下載、也沒有提示。
   */
  const start = dashboardSource.indexOf("const copyNote = () => {");
  assert.ok(start > 0, "前置：找不到 copyNote");
  /*
   * ⚠️ 要先把註解剝掉再掃：這段程式碼旁邊的警語裡**引用了**那個錯誤寫法
   *   （為了說明它為什麼錯），不剝的話會抓到自己的註解——假的紅。
   *   這一輪已經在路口轉向的 ** 粗體守門上踩過同一個坑。
   */
  const block = dashboardSource
    .slice(start, start + 1600)
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(block, /if \(!navigator\.clipboard\?\.writeText\)/, "沒有先明確判斷");
  assert.match(block, /downloadAsText/, "沒有下載成 .txt 的退路");
  assert.doesNotMatch(
    block,
    /navigator\.clipboard\?\.writeText\([^)]*\)\.catch/,
    "又寫成可選鏈短路的那種寫法了——clipboard 不存在時 .catch 一次都不會跑",
  );
});

test("#14-4 複製按鈕要放在 data-chart-note 裡面（跟著說明一起被排除在圖外）", () => {
  /*
   * `data-chart-note` 的用途是「匯出的圖片裡不可以有說明文字」。
   * 按鈕掛在 aside 外面的話，下載下來的 PNG 上會多一顆按鈕。
   */
  const asideAt = dashboardSource.indexOf('<aside className="chart-note" data-chart-note>');
  const buttonAt = dashboardSource.indexOf('data-testid="chart-note-copy"');
  const closeAt = dashboardSource.indexOf("</aside>", asideAt);
  assert.ok(asideAt > 0 && buttonAt > asideAt && buttonAt < closeAt, "複製按鈕不在 aside 裡面");
});

/* ══════════════════════════════════════════════════════════════════════
 *  #44 圖說版面守門要逐塊量
 * ══════════════════════════════════════════════════════════════════════ */

test("#44-1 跳轉落點要逐塊量，不可以只取第一個", () => {
  /*
   * ⚠️ 舊版 `document.querySelector('[id^="block-"]')` 只取第一個就下結論。
   *   側欄有十幾個落點，而 scroll-margin-top 是逐塊寫的——後面任何一塊
   *   漏掉都量不到，這一條照樣是綠的。「量了一個、當成量了全部」
   *   是最貴的那種假的綠：它讓人以為這一整類問題有人守著。
   */
  assert.match(
    figureNoteProbe,
    /querySelectorAll\('\[id\^="block-"\]'\)/,
    "跳轉落點還是只取第一個",
  );
  assert.doesNotMatch(
    figureNoteProbe,
    /const target = document\.querySelector\('\[id\^="block-"\]'\)/,
    "還留著只取第一個的舊寫法",
  );
});

test("#44-1b 要逐分區走一遍，不可以只停在一頁掃", () => {
  /*
   * ⚠️ 落點分布在五個分區裡，而每一個分區的內容是各自獨立的畫面
   *   （別的分區的區塊不在 DOM 裡）。只停在「圖表與比較」那一頁掃，
   *   永遠只會掃到 1 個——實測就是這樣（只有 block-composition）。
   *   那時候「逐塊」和「只量第一塊」沒有差別，等於沒改。
   */
  assert.match(
    figureNoteProbe,
    /for \(const \[tabName, tabId\] of Object\.entries\(TABS\)\)/,
    "沒有逐分區走——只停在一頁掃的話，永遠只會掃到一個落點",
  );
});

test("#44-2 要有「落點不只一個」的前置檢查", () => {
  /*
   * 只剩一個落點時，「逐塊」和「只量第一塊」沒有差別，這個修正就失效了，
   * 而且沒有任何症狀。選擇器改壞、區塊 id 改名都會落到這裡。
   */
  assert.match(
    figureNoteProbe,
    /落點不只一個/,
    "少了「落點不只一個」的前置檢查——選擇器改壞時這一條會安靜地變成恆真",
  );
});

test("#44-3 要先印每一塊的實測值再斷言", () => {
  assert.match(
    figureNoteProbe,
    /逐塊落點（先印再斷言）/,
    "沒有把逐塊的實測值印出來——紅的時候看不出是哪一塊",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  W-0e 「資料狀態」的草稿下拉不可以和上方數字卡黏在一起
 * ══════════════════════════════════════════════════════════════════════ */

test("W-0e-1 數字卡與下面那一列之間要有間距", () => {
  /*
   * 使用者 2026-09-29（附圖）：「全日交通量 草稿按鍵和上方行黏在一起」。
   *
   * ⚠️ 成因是 `.validation-grid` 的 gap 只管格子**之間**、`.two-col` 也沒有
   *   上外距——兩條規則各自看都沒問題，黏住的是它們**之間**。
   *   這種問題逐條看 CSS 看不出來，所以要用測試釘住那個「之間」。
   */
  const match = cssSource.match(
    /\.validation-grid\s*\+\s*\.two-col\s*\{[^}]*margin-top:\s*(\d+)px/,
  );
  assert.ok(match, "找不到 .validation-grid + .two-col 的間距規則");
  assert.ok(
    Number(match[1]) >= 10,
    `間距只有 ${match[1]}px，太小，畫面上仍然像黏在一起`,
  );
});

test("W-0e-2 不可以直接給 .two-col 加 margin-top（視窗裡的兩欄表單會多一段）", () => {
  /*
   * `.two-col` 也用在 .modal 裡，那邊的間距是 .modal 自己的 gap 給的。
   * 直接加在 .two-col 上會讓每一個視窗都多一段空白。
   */
  const bare = [
    ...cssSource.matchAll(/(^|[},])\s*\.two-col\s*\{([^}]*)\}/g),
  ].map((hit) => hit[2]);
  for (const body of bare)
    assert.doesNotMatch(
      body,
      /margin-top/,
      "margin-top 被加在 .two-col 自己身上了——視窗裡的兩欄表單會多一段空白",
    );
});

/* ══════════════════════════════════════════════════════════════════════
 *  #24-② 報告草稿也要印出季別×路段的覆寫
 * ══════════════════════════════════════════════════════════════════════ */

const reportDraftSource = readFileSync(
  join(here, "..", "app", "report-draft.ts"),
  "utf8",
);

test("#24-2-1 有覆寫時，開頭那句要改成「本計畫預設」而不是「本計畫採用」", () => {
  /*
   * ⚠️ 舊版永遠寫「本計畫採用的 PCU 當量係數：…」一組。有覆寫的時候那句話
   *   是**錯的**——數字是依覆寫算的，拿這幾個係數回推一定對不上，
   *   而讀報告的人會以為是計算錯誤。這正是使用者對 Excel 那一半描述的症狀。
   *
   * ⚠️ 反面同樣重要：**沒有覆寫時不可以寫「預設」**——那樣寫在暗示有覆寫。
   */
  assert.match(
    reportDraftSource,
    /scopes\.length \? "本計畫預設" : "本計畫採用"/,
    "開頭那句沒有跟著有沒有覆寫而變",
  );
});

test("#24-2-2 要寫出「那不是計算錯誤」", () => {
  assert.match(
    reportDraftSource,
    /那不是計算錯誤/,
    "沒有明講「拿計畫預設回推會對不上、但那不是計算錯誤」——使用者的原話就是怕這個",
  );
});

test("#24-2-3 覆寫只列與預設不同的車種", () => {
  /*
   * 與 Excel 的「PCU係數」工作表同一條規則：全部列出來反而看不出改了哪一個。
   */
  assert.match(
    dashboardSource,
    /CORE_VEHICLE_KEYS\.filter\(\s*\(key\) => scope\.factors\.core\[key\] !== pcuFactors\[key\],\s*\)/,
    "報告草稿的覆寫沒有只列與預設不同的車種",
  );
});

test("#24-2-4 適用範圍要用 pcuScopeLabel（畫面上那個一模一樣的字）", () => {
  /*
   * 自己再組一句「115Q2 的某路段」就是第二種寫法，兩邊一定會漂移，
   * 而使用者對不上他在「當量係數設定」看到的那一列。
   */
  const at = dashboardSource.indexOf("factorScopes: pcuScopes");
  assert.ok(at > 0, "前置：找不到報告草稿的 factorScopes");
  const block = dashboardSource.slice(at, at + 700);
  assert.match(block, /pcuScopeLabel\(/, "沒有用 pcuScopeLabel");
});
