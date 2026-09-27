/*
 * ══════════════════════════════════════════════════════════════════════
 *  四個核心統計範圍：名稱、意義與「不可回頭」的守門（A21／A22）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-21：「上午尖峰、下午尖峰、全調查時段和全調查時段尖峰，
 * 各有各的意義」「這 4 個名詞是我們交通調查的 4 個核心」
 * 「請確保日後不論哪個 AI 做維護……都能清楚知道這 4 個名詞，
 *   以及維護上所有大大小小踩過的雷，不要把修對的事情改回錯的」。
 *
 * 這一支守三件事：
 *   ① 四個顯示名稱一字不差（三支一致）
 *   ② `allPeak` **不可以**被加上「要有 24 小時資料」的限制
 *   ③ 說明文字不可以退回「全日」那一套舊講法
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  PERIOD_HINTS,
} from "../app/period-analysis.ts";
import { CONCLUSION_PERIOD_LABELS } from "../app/conclusion.ts";

const EXPECTED = {
  all: "全調查時段",
  allPeak: "全調查時段尖峰",
  am: "上午尖峰小時",
  pm: "下午尖峰小時",
};

test("四個核心名稱一字不差，而且一個都不能少", () => {
  assert.deepEqual([...PERIOD_KEYS].sort(), ["all", "allPeak", "am", "pm"]);
  assert.deepEqual(PERIOD_LABELS, EXPECTED);
  assert.deepEqual(
    CONCLUSION_PERIOD_LABELS,
    EXPECTED,
    "結論草稿與分析頁對同一個鍵給了不同的名字——同一份資料兩處講法不一樣",
  );
});

test("⚠️ 「全調查時段尖峰」的說明不可以要求 24 小時資料", () => {
  /*
   * 這是這個系統反覆被改錯的一件事：鍵名叫 allPeak，於是有人（含 AI）
   * 會「順手」補上一條「不足 24 小時就留空」。使用者 2026-09-21 明確否定：
   *   「你說的『資料不足 24 小時就整組留空』，反而是錯的」
   */
  assert.match(
    PERIOD_HINTS.allPeak,
    /在調查涵蓋的時段內/,
    "全調查時段尖峰的說明被改回「一整天」那一套了",
  );
  assert.doesNotMatch(
    PERIOD_HINTS.allPeak,
    /24\s*小時/,
    "說明文字又寫回「要 24 小時」——那個限制在 v20.x 早就拿掉了",
  );
  assert.doesNotMatch(
    PERIOD_HINTS.all,
    /^一整天/,
    "全調查時段被寫成「一整天」——它是調查實際涵蓋的那一段",
  );
});

test("⚠️ 舊範本的 peak24 要能讀回來（改名的配套遷移不可以拿掉）", async () => {
  /*
   * v20.83 把 peak24 改名為 allPeak。那個鍵**會被寫進使用者的範本存檔**，
   * 所以讀取端一定要認得舊名，否則既有範本套用之後
   * 「全調查時段尖峰」會安靜地消失。
   */
  const { migratePeriodKeys } = await import("../app/conclusion.ts");
  assert.deepEqual(migratePeriodKeys(["all", "peak24", "am"]), [
    "all",
    "allPeak",
    "am",
  ]);
  assert.deepEqual(migratePeriodKeys(["allPeak"]), ["allPeak"]);
  assert.deepEqual(
    migratePeriodKeys(["peak24", "allPeak"]),
    ["allPeak"],
    "舊名與新名同時存在時不可以出現兩筆",
  );
  assert.deepEqual(migratePeriodKeys(["不存在的鍵"]), [], "認不得的鍵要丟掉");
  assert.deepEqual(migratePeriodKeys(null), []);

  const dashboard = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    dashboard,
    /periods: migratePeriodKeys\(template\.condition\.periods\)/,
    "讀取範本時沒有走遷移——既有範本的「全調查時段尖峰」會安靜消失",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 這個鍵有**兩個讀取端**，兩個都要遷移
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那一支只驗了「結論草稿範本」。同一組鍵值也存在
 * **比較報表範本**裡（`comparisonReports[].periodExport.periods`），
 * 而它走的是另一支 `normalizePeriodExportSelection()`。
 *
 * 2026-09-23 的獨立複查發現那一支是直接 `PERIOD_KEYS.includes()` 過濾的：
 * 舊範本裡的 `"peak24"` 被**無聲丟掉**，而且因為陣列裡通常還有別的元素，
 * 連 `base.periods` 的退路都不會走到——使用者只會發現那一項不見了。
 *
 * 這正是本專案反覆出現的那種缺陷：**同一件事有兩條路，只修了一條**。
 */
test("⚠️ 比較報表範本的 peak24 也要讀得回來（第二個讀取端）", async () => {
  const { normalizePeriodExportSelection } = await import(
    "../app/period-analysis.ts"
  );
  assert.deepEqual(
    normalizePeriodExportSelection({
      enabled: true,
      periods: ["all", "peak24", "am"],
    }).periods,
    ["all", "allPeak", "am"],
    "比較報表範本沒有走遷移——舊範本的「全調查時段尖峰」會安靜消失",
  );
  /* 只有舊名一個的極端情況也要救得回來，不可以退回預設值。 */
  assert.deepEqual(
    normalizePeriodExportSelection({ periods: ["peak24"] }).periods,
    ["allPeak"],
  );
  /* 認不得的鍵全部丟掉之後，要退回預設值而不是給一個空的時段清單。 */
  assert.ok(
    normalizePeriodExportSelection({ periods: ["不存在的鍵"] }).periods.length >
      0,
    "全部認不得時要退回預設值",
  );

  /* 兩端必須**共用同一支**遷移函式，不可以各抄一份判斷。 */
  const periodAnalysis = await readFile(
    new URL("../app/period-analysis.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    periodAnalysis,
    /migratePeriodKeys\(raw\.periods\)/,
    "normalizePeriodExportSelection 沒有走共用的 migratePeriodKeys()",
  );
});

test("⚠️ 鍵名不可以再改回 peak24", async () => {
  const conclusion = await readFile(
    new URL("../app/conclusion.ts", import.meta.url),
    "utf8",
  );
  const analysis = await readFile(
    new URL("../app/period-analysis.ts", import.meta.url),
    "utf8",
  );
  for (const [name, source] of [
    ["app/conclusion.ts", conclusion],
    ["app/period-analysis.ts", analysis],
  ]) {
    assert.match(
      source,
      /export type PeriodKey = "all" \| "allPeak" \| "am" \| "pm";/,
      `${name} 的 PeriodKey 被改過`,
    );
    assert.match(
      source,
      /絕對不要求 24 小時的資料/,
      `${name} 少了「不要求 24 小時」的警語，下一個維護者會再誤會一次`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  分區名稱只能有一個來源（2026-09-24，F6 獨立複查抓到）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 病灶：「本季總覽」那一塊的抬頭寫死成 `<span>一 資料匯入</span>`，
 * 那是 2026-09-10 的舊區名；側欄同一區已經改成「一　建立與匯入」。
 * 結果是**同一個分區在同一個畫面上兩個名字**，使用者會以為是兩個地方。
 *
 * ⚠️ 連帶抓到的第二件事：`PAGE_ZONES` 裡五個 `short:` 兩字縮寫
 *   （匯入／設定／檢視／圖表／產出）**全檔沒有任何地方讀它們**，
 *   卻讓舊命名一直有地方可抄——手冊與更新說明的分頁清單就是從那裡抄來的。
 *   已刪除，這一支守它不要回來。
 *
 * 守法（三件，缺一不可）：
 *   一、畫面上不可以出現寫死的分區名字串；
 *   二、抬頭必須走 `zoneHeading()`，而它必須從 `PAGE_ZONES` 推；
 *   三、`PAGE_ZONES` 不可以再有沒人讀的 `short:` 欄位。
 */
{
  const dashboard = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  /* 先剝註解：註解裡本來就會寫到舊區名（那是在記錄病灶）。 */
  const code = dashboard
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

  test("分區名稱不可以在畫面上寫死（只能走 zoneHeading）", () => {
    /* 前置檢查：分區定義與抬頭函式都在，否則這一支等於沒在守。 */
    assert.match(code, /const PAGE_ZONES = \[/, "找不到 PAGE_ZONES");
    assert.match(
      code,
      /function zoneHeading\(zoneId: string\): string \{[\s\S]*?PAGE_ZONES\.find/,
      "zoneHeading 不見了，或它沒有從 PAGE_ZONES 推——那就又變成第二份名單了",
    );
    assert.match(
      code,
      /<span>\{zoneHeading\("zone-import"\)\}<\/span>/,
      "「本季總覽」的抬頭沒有走 zoneHeading",
    );

    /*
     * 寫死的分區名：`一 資料匯入`（舊名）與任何「代號＋空白＋區名」的字面值。
     * ⚠️ PAGE_ZONES 自己的 `title:` 不在這個範圍裡（它就是唯一來源）。
     */
    const literals = [
      ...code.matchAll(/<span>\s*([一二三四五])[ 　]*([^<{]{2,12})<\/span>/g),
    ].map((m) => m[0]);
    assert.deepEqual(
      literals,
      [],
      "畫面上有寫死的分區抬頭，請改走 zoneHeading()：\n  " + literals.join("\n  "),
    );
    assert.ok(
      !code.includes("一 資料匯入"),
      "「一 資料匯入」是 2026-09-10 的舊區名，現在叫「建立與匯入」",
    );
  });

  test("PAGE_ZONES 不可以再有沒人讀的 short 欄位", () => {
    const zones = code.slice(
      code.indexOf("const PAGE_ZONES = ["),
      code.indexOf("const PAGES = PAGE_ZONES"),
    );
    assert.ok(zones.length > 200, "抓不到 PAGE_ZONES 區塊——結構改了嗎？");
    assert.doesNotMatch(
      zones,
      /(^|[\s{,])short\s*:/,
      "short 欄位回來了。全檔沒有任何地方讀它，留著只會讓舊命名有地方可抄"
        + "（手冊與更新說明的分頁清單就是這樣過期的）",
    );
    /* 反過來也要守：真的沒有人讀它。 */
    assert.doesNotMatch(
      code,
      /zone\.short|\.short\b/,
      "有地方在讀 zone.short——那畫面上就會出現兩字縮寫，2026-09-10 已定案不用",
    );
  });
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  最上層五塊只能叫「分區」，「大分頁」是分區**裡面**的頁籤（F6 第四輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-25 F6 第四輪抓到：手冊把最上層五塊寫成「分頁」
 * （「篩選條件……五個分頁都看得到、也都吃得到」），
 * 但程式裡最上層叫 `PAGE_ZONES`（分區），`分區`**裡面**才是「大分頁」。
 * 同一個詞指兩層東西，讀的人無法判斷「四個大分頁」是四塊還是四個頁籤。
 *
 * 守兩件事：
 *   ① 手冊裡每一個「分頁」都必須是「大分頁」（也就是只准指分區裡的頁籤）；
 *   ② 手冊／README／交接文件都不可以出現「五個分頁」「5 個分頁」「五頁都」
 *      這種用「分頁」數最上層的寫法——數字從 `PAGE_ZONES` 推，不是寫死。
 *
 * ⚠️ 「關閉分頁」（瀏覽器頁籤）不在①的範圍：那一句只在交接文件裡，
 *   ①只掃手冊。README／交接文件走②的窄規則，避免假的紅。
 */
{
  const dashboard = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  const zoneBlock = dashboard.slice(
    dashboard.indexOf("const PAGE_ZONES = ["),
    dashboard.indexOf("const PAGES = PAGE_ZONES"),
  );
  const zoneCount = (zoneBlock.match(/\bid:\s*"zone-/g) || []).length;

  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const handoff = await readFile(
    new URL("../PROJECT_HANDOFF.md", import.meta.url),
    "utf8",
  );
  const notes = await readFile(
    new URL("../【更新說明】請先讀我.txt", import.meta.url),
    "utf8",
  );
  const { readdir } = await import("node:fs/promises");
  const rootFiles = await readdir(new URL("../", import.meta.url));
  const validationName = rootFiles.find((name) => /^VALIDATION_v[\d.]+\.md$/.test(name));
  assert.ok(validationName, "根目錄找不到 VALIDATION_v*.md——這一支靠它");
  const validation = await readFile(
    new URL(`../${validationName}`, import.meta.url),
    "utf8",
  );

  test("最上層五塊叫「分區」，手冊裡的「分頁」只能是「大分頁」", () => {
    /* 前置檢查：推得出分區數，否則這一支等於沒在守。 */
    assert.equal(
      zoneCount,
      5,
      `從 PAGE_ZONES 推出來的分區數是 ${zoneCount}，不是 5；`
        + "分區結構改了就要一起改這一支與手冊的用詞",
    );

    /*
     * ⚠️ 2026-09-25 第六輪獨立複查：這一條原本只掃手冊，而**畫面上的無障礙
     *   名稱**（`aria-label`）用的正是裸「分頁」那個詞（導覽那一個、
     *   以及收合鈕那一個）——
     *   螢幕閱讀器讀出來的就是那兩句，而它們指的是最上層五塊與分區裡的頁籤。
     *   `DashboardClient.tsx` 一起掃（只掃 `aria-label`，不掃註解：
     *   註解裡記錄歷史用詞是刻意的，掃了會產生假的紅）。
     */
    const bare = [...manual.matchAll(/(.?)分頁/g)]
      .filter((m) => m[1] !== "大")
      .map((m) => m[0]);
    assert.deepEqual(
      bare,
      [],
      "手冊裡有沒加「大」的「分頁」。最上層五塊要叫「分區」，"
        + "分區裡的頁籤才叫「大分頁」：\n  " + bare.join("\n  "),
    );

    const ariaBare = [...dashboard.matchAll(/aria-label=(?:"|\{`)([^"`]*)/g)]
      .map((m) => m[1])
      .filter((label) => /(?<!大)分頁/.test(label));
    assert.deepEqual(
      ariaBare,
      [],
      "畫面上的 aria-label 有沒加「大」的「分頁」（螢幕閱讀器會讀出來）："
        + "\n  " + ariaBare.join("\n  "),
    );

    const ZONE_NUM = ["零", "一", "兩", "三", "四", "五", "六", "七", "八", "九"];
    const word = ZONE_NUM[zoneCount];
    const bad = new RegExp(`(?:${word}|${zoneCount})\\s*個?\\s*分頁|${word}頁都`);
    /*
     * ⚠️ 2026-09-25 第五輪複查：範圍原本沒有 `【更新說明】` 與
     *   `VALIDATION_*`，而**現行的部署檢查清單**就寫在更新說明裡
     *   （「工具列與最上面那排篩選條件在五個分頁都看得到」），
     *   那不是歷史紀錄、是要照著做的步驟。兩份一起掃。
     * ⚠️ 歷史小節（v20.64 那一則、使用者原話）**刻意留原文**：
     *   那是當時的用詞與使用者自己的話，改掉等於偽造紀錄。
     *   所以這一條只擋「用分頁去數最上層」這個窄樣式，不擋「分頁」這個詞本身。
     */
    for (const [name, text] of [
      ["手冊", manual],
      ["README.md", readme],
      ["PROJECT_HANDOFF.md", handoff],
      ["【更新說明】請先讀我.txt", notes],
      ["VALIDATION", validation],
    ]) {
      const hit = text.match(bad);
      assert.equal(
        hit,
        null,
        `${name} 用「分頁」數最上層（${hit && hit[0]}）。`
          + `最上層有 ${zoneCount} 個**分區**，不是 ${zoneCount} 個分頁`,
      );
    }
  });
}
