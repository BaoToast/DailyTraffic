/*
 * ══════════════════════════════════════════════════════════════════════
 *  2026-09-25 修正的行為反證（全日交通量）
 * ══════════════════════════════════════════════════════════════════════
 *
 *   K14 還原備份的 PCU 檢查比載入時鬆 → 同一份資料給兩個不同的 PCU
 *   K16 匯入檢核寫「含空白」，但空白格永遠不會被指出
 *   K23 coverageKey 為空字串時退回比顯示標籤，把可比性守衛繞掉
 *   K31 NaN 被當成 0，草稿寫出「起始季為 0」「平日為 0」
 *   K32 surveyScope 只按 roadId 分組，把平日與假日的時段聯集
 *   J1  湊不滿一小時的口徑對齊路口轉向（保守作法）
 *
 * ⚠️ 每一條的反證做法寫在該段裡，全部實驗過（2026-09-25）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { surveyCoverage, rollingPeak } from "../app/partial-day.ts";
import { coverageKeyOf } from "../app/period-analysis.ts";

const DASHBOARD = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

/* ────────────────────────────────────────────────────────────────────
 *  K14 兩條還原路徑必須共用同一份檢查
 * ──────────────────────────────────────────────────────────────────── */
/** 把 DashboardClient 裡的 isValidPcu／isValidTurnPcu 切出來跑。 */
function extract(name) {
  const start = DASHBOARD.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `找不到 ${name}()——它被改名或刪掉了`);
  let depth = 0;
  for (let i = DASHBOARD.indexOf("{", start); i < DASHBOARD.length; i += 1) {
    if (DASHBOARD[i] === "{") depth += 1;
    else if (DASHBOARD[i] === "}") {
      depth -= 1;
      if (!depth)
        /*
         * ⚠️ 剝掉 TypeScript 的型別標註才能用 new Function 跑。
         *   `function isValidPcu(value: unknown): value is PcuFactors {`
         *   要變成 `function isValidPcu(value) {`——參數與回傳兩邊都要處理。
         */
        return DASHBOARD.slice(start, i + 1)
          .replace(/\(([A-Za-z_$][\w$]*): [^)]*\)/, "($1)")
          .replace(/\)\s*:\s*[^{]+\{/, ") {")
          .replace(/ as Record<string, unknown>/g, "")
          .replace(/ as [A-Za-z<>,[\]| ]+/g, "");
    }
  }
  assert.fail(`${name}() 括號不成對`);
}

const isValidPcu = new Function(
  'const CORE_VEHICLE_KEYS = ["motorcycle", "small", "large", "special"];\n' +
    extract("isValidPcu") +
    "\nreturn isValidPcu;",
)();

/** 載入時會被拒絕、還原時卻曾經被放行的那些值。 */
const LOOKS_LIKE_A_NUMBER_BUT_IS_NOT = [
  ["0.5", "數字字串——最惡劣的一種，看起來完全正常"],
  [null, "null"],
  [true, "布林 true（Number(true) 是 1）"],
  [false, "布林 false"],
  ["", "空字串"],
  [" ", "空白字串"],
  [[], "空陣列"],
];

test("K14 載入用的 isValidPcu() 會拒絕字串／null／布林（下游一律當 0）", () => {
  const good = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
  assert.equal(isValidPcu(good), true, "正常的係數要通過");
  for (const [bad, why] of LOOKS_LIKE_A_NUMBER_BUT_IS_NOT)
    assert.equal(
      isValidPcu({ ...good, motorcycle: bad }),
      false,
      `${why}（${JSON.stringify(bad)}）被 isValidPcu 放行了`,
    );
});

test("K14 ⚠️ 兩條還原路徑都必須呼叫 isValidPcu／isValidTurnPcu，不可以各寫一份", () => {
  /*
   * ⚠️ 實測過的後果：還原時用 `Number.isFinite(Number(x))`（會放行字串），
   *   而載入時用 `typeof x === "number"`（會拒絕）。
   *   機車係數是字串 "0.5" 時：還原後 PCU＝100（機車整欄變 0），
   *   **重新整理之後又跳回 150**——同一份資料兩個答案，全程沒有警告。
   *
   * 反證：把任一條路徑改回 `Number.isFinite(Number(...))`，這一條就會紅。
   */
  const loose = /Number\.isFinite\(\s*Number\(\s*\(?payload\.pcuFactors/;
  assert.ok(
    !loose.test(DASHBOARD),
    "單一計畫還原又改回了自己寫一份的寬鬆檢查（Number.isFinite(Number(...))）",
  );
  /* 單一計畫那條路 */
  assert.match(
    DASHBOARD,
    /if \(isValidPcu\(payload\.pcuFactors\)\)/,
    "單一計畫還原沒有走 isValidPcu()",
  );
  assert.match(
    DASHBOARD,
    /if \(isValidTurnPcu\(restoredTurn\)\)/,
    "單一計畫還原的轉向係數沒有走 isValidTurnPcu()",
  );
  /* 全部計畫那條路 */
  assert.match(
    DASHBOARD,
    /if \(isValidPcu\(bundle\.pcuFactors\)\)/,
    "「還原全部計畫」沒有檢查 PCU 係數——它原本一個檢查都沒有",
  );
  assert.match(
    DASHBOARD,
    /if \(isValidTurnPcu\(bundle\.turnPcuFactors\)\)/,
    "「還原全部計畫」沒有檢查轉向係數",
  );
});

test("K14 ⚠️ 被拒絕時一定要告訴使用者，不可以靜靜退回預設值", () => {
  /*
   * 靜靜略過的後果：使用者以為係數還原成功了，而畫面上其實是系統預設值
   * ——同一份備份在他和業主的電腦上會算出不同的 PCU。
   */
  assert.match(
    DASHBOARD,
    /備份中的路段PCU係數不是合法的數字/,
    "單一計畫還原被拒絕時沒有任何提示",
  );
  assert.match(
    DASHBOARD,
    /的路段PCU係數不是合法的數字，已略過/,
    "「還原全部計畫」被拒絕時沒有任何提示",
  );
  assert.match(
    DASHBOARD,
    /warnings\.length\s*\?\s*`，但有 \$\{warnings\.length\} 項被略過`/,
    "「還原全部計畫」的完成訊息沒有帶出被略過的項數",
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  K16 匯入檢核要真的抓到空白
 * ──────────────────────────────────────────────────────────────────── */
test("K16 匯入檢核要抓到空白格，而且不可以把空白累計成 0 輛", async () => {
  /*
   * ⚠️ 舊寫法是 `!Number.isFinite(Number(value)) || Number(value) < 0`，
   *   而 `Number("")`／`Number(" ")`／`Number(null)`／`Number([])`
   *   **全是 0 且 finite、又不小於 0** → 空白被當成「合法的 0 輛」，
   *   訊息永遠不出現，接著被累計成 0，**整筆少算而報告寫著沒問題**。
   *
   * 反證：把 hasCount 換回 `Number.isFinite(Number(value))`，這一條就會紅。
   */
  const { validateImport } = await import("../app/final-workflow.ts");
  const base = {
    projectId: "P",
    quarter: "115Q1",
    roadId: "R1",
    roadName: "測試路段",
    dayType: "平日",
    directionCode: "A",
    directionName: "方向A",
    hour: "07:00~08:00",
  };
  /* ⚠️ validateImport(records, existing) 收兩個參數，第二個是既有資料。 */
  const clean = validateImport(
    [{ ...base, motorcycle: 10, small: 20, large: 0, special: 0 }],
    [],
  );
  assert.equal(
    clean.invalidRows.length,
    0,
    `正常資料不該被指出問題：${JSON.stringify(clean.invalidRows)}`,
  );
  assert.equal(clean.totalVehicles, 30, "正常資料的合計要正確");

  for (const [blank, why] of [
    ["", "空字串"],
    [" ", "空白字串"],
    [null, "null"],
    [[], "空陣列"],
    [true, "布林 true（Number(true) 是 1，會憑空多一輛）"],
  ]) {
    const report = validateImport(
      [{ ...base, motorcycle: blank, small: 20, large: 0, special: 0 }],
      [],
    );
    assert.ok(
      report.invalidRows.length > 0,
      `機車欄是 ${why}（${JSON.stringify(blank)}）卻沒有被指出——` +
        `訊息寫著「含空白、非數字或負值」，那句話必須是真的`,
    );
    assert.equal(
      report.totalVehicles,
      20,
      `${why} 不可以被累計成一個數字（總計應該只有小型車的 20）`,
    );
  }
});

/* ────────────────────────────────────────────────────────────────────
 *  K23 涵蓋指紋的三種狀態
 * ──────────────────────────────────────────────────────────────────── */
test("K23 ⚠️ 前置：解析不出時段的標籤，coverageKeyOf() 回空字串", () => {
  assert.equal(coverageKeyOf(["07:00"]), "", "只寫起點的標籤應該算不出指紋");
  assert.equal(coverageKeyOf(["全日"]), "", "看不出起訖的標籤應該算不出指紋");
  assert.notEqual(
    coverageKeyOf(["07:00~08:00"]),
    "",
    "正常的區間要算得出指紋（0 的話下面幾條就恆真了）",
  );
});

test("K23 涵蓋指紋算不出來時，不可以退回比顯示標籤", () => {
  /*
   * ⚠️ period-analysis.ts 自己宣告「空字串要當成無法判斷可比性，
   *   不可以當成涵蓋相同」，而舊寫法的 `|| cell.hour` 剛好在那個時候
   *   退回去比 hour——也就是退回**比給人看的字串**。
   *   而 fullDayLabel 在 coveredMinutes=0 時對兩筆都產生同一句
   *   「實測 0 小時（非 24 小時）」→ 判定為可比 → 印出「假日較平日少 X%」。
   *
   * ⚠️ 三種狀態要分開（第一版我把後兩種合成一個，把本來比得動的舊資料
   *   也擋掉了，那是過度修正）：
   *     非空字串 → 用指紋比
   *     空字串   → 無從判斷，不比
   *     undefined→ 沒有人算過指紋（舊資料），退回比 hour＝改版前的行為
   *
   * 反證：把 coverageOf 改回 `cell.coverageKey || cell.hour`，這一條會紅。
   */
  const source = readFileSync(
    new URL("../app/conclusion.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    !/coverageKey \|\| cell\.hour/.test(source),
    "又改回 `coverageKey || cell.hour` 了——指紋算不出來時會退回比顯示標籤",
  );
  assert.ok(
    !/coverageKey \|\| point\.cell\.hour/.test(source),
    "成長描述那一處也改回退回比顯示標籤了",
  );
  assert.match(
    source,
    /cell\.coverageKey === undefined/,
    "沒有分辨「沒有人算過指紋（undefined）」與「算不出來（空字串）」",
  );
  assert.match(
    source,
    /平日與假日的調查涵蓋無法判斷/,
    "指紋算不出來時要寫「無法判斷」，不可以寫成「涵蓋不同」（那是另一件事）",
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  K31 NaN 不可以被講成 0
 * ──────────────────────────────────────────────────────────────────── */
test("K31 草稿不可以把讀不到的數值講成 0（成長與平假日對比兩處）", () => {
  const source = readFileSync(
    new URL("../app/conclusion.ts", import.meta.url),
    "utf8",
  );
  /*
   * ⚠️ 舊寫法是 `valueOf(cell) ? … : null`——NaN 是 falsy，
   *   於是走進「起始季為 0」／「平日為 0」那一支，
   *   而同一句前面的 show() 會印「—」。
   *   同一句話裡「讀不到」和「是 0」被講成同一件事，而這句會被抄進報告。
   *   app/report-draft.ts 的 changeText() 早就用 Number.isFinite 分開了。
   *
   * 反證：把任一處改回真值判斷，這一條就會紅。
   */
  assert.ok(
    !/const change = valueOf\(first\.cell\)\s*\n?\s*\?/.test(source),
    "成長描述又改回真值判斷了（NaN 會被講成「起始季為 0」）",
  );
  assert.ok(
    !/const change = valueOf\(a\) \? /.test(source),
    "平假日對比又改回真值判斷了（NaN 會被講成「平日為 0」）",
  );
  assert.match(
    source,
    /其中一期讀不到數值，變動幅度無法計算/,
    "成長描述沒有「讀不到」這一種說法",
  );
  assert.match(
    source,
    /平日或假日有一邊讀不到數值，無法比較差異/,
    "平假日對比沒有「讀不到」這一種說法",
  );
  /* 真的是 0 的那一種說法要保留，不可以修過頭 */
  assert.match(source, /起始季為 0/, "「真的是 0」那一種說法被刪掉了");
  assert.match(source, /平日為 0/, "「平日真的是 0」那一種說法被刪掉了");
});

/* ────────────────────────────────────────────────────────────────────
 *  K32 涵蓋判斷的分組粒度
 * ──────────────────────────────────────────────────────────────────── */
test("K32 ⚠️ 前置：平日與假日的時段聯集起來真的會變成「完整 24 小時」", () => {
  const hour = (a, b) =>
    `${String(a).padStart(2, "0")}:00~${String(b).padStart(2, "0")}:00`;
  const weekday = Array.from({ length: 12 }, (_, i) => hour(i, i + 1));
  const holiday = Array.from({ length: 12 }, (_, i) => hour(i + 12, i + 13));
  assert.equal(
    surveyCoverage(weekday).partial,
    true,
    "只做 00:00–12:00 應該是部分時段",
  );
  assert.equal(
    surveyCoverage(holiday).partial,
    true,
    "只做 12:00–24:00 應該是部分時段",
  );
  assert.equal(
    surveyCoverage([...weekday, ...holiday]).partial,
    false,
    "兩天聯集起來會變成完整 24 小時——這就是為什麼分組鍵一定要帶日別",
  );
});

test("K32 涵蓋判斷的分組鍵必須帶季別與日別（三處都要）", () => {
  /*
   * ⚠️ partial 變 false 之後的連鎖：欄位單位回到「輛／調查日」、
   *   Excel 欄名回到「輛/日」、而 draftCoverageNote 的
   *   `if (!partial.length) return "";` 讓**整句涵蓋警語消失**。
   *   正確的粒度就在同一個檔案裡：trendPartial 用 `季別|日別|調查點`。
   *
   * 反證：把任一處的鍵改回只有 roadId，這一條就會紅。
   */
  const keyed = [
    ...DASHBOARD.matchAll(
      /\$\{record\.quarter\}\|\$\{record\.dayType\}\|\$\{record\.roadId\}/g,
    ),
  ];
  assert.ok(
    keyed.length >= 3,
    `只有 ${keyed.length} 處用「季別|日別|調查點」當涵蓋分組鍵——` +
      `應該至少三處（surveyScope、draftCoverageNote、trendPartial）`,
  );
  assert.ok(
    !/const byRoad = new Map<string, string\[\]>\(\);\s*\n\s*for \(const record of filtered\)/.test(
      DASHBOARD,
    ),
    "還有地方只按 roadId 分組做涵蓋判斷（會把平日與假日的時段聯集）",
  );
  /* 圓環那一處（指定 roadId）也要逐季別×日別 */
  assert.match(
    DASHBOARD,
    /\$\{record\.quarter\}\|\$\{record\.dayType\}`/,
    "圓環逐點判斷涵蓋時沒有再按季別×日別分組",
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  J1 湊不滿一小時的口徑
 * ──────────────────────────────────────────────────────────────────── */
test("J1 湊不滿 60 分鐘一律回「資料不足」（與路口轉向同一口徑）", () => {
  const q = (h, n) =>
    Array.from({ length: n }, (_, i) => {
      const start = h * 60 + i * 15;
      const end = start + 15;
      const fmt = (m) =>
        `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      return { hour: `${fmt(start)}~${fmt(end)}`, value: 50 };
    });
  const short = rollingPeak(q(7, 3)); /* 45 分鐘 */
  assert.equal(short.value, 0, "45 分鐘不可以給一個數字");
  assert.equal(short.spans, 0);
  /*
   * ⚠️ 2026-09-25 第五輪複查：原本斷言「—」，而三份使用者文件與這條測試
   *   自己的名稱都寫「資料不足」。「—」在這個系統裡代表「沒有資料」，
   *   兩件事共用一個符號會讓使用者去翻原始檔找不存在的漏調查。
   */
  assert.equal(short.label, "資料不足", "有資料但湊不滿一小時要標「資料不足」");
  assert.equal(rollingPeak([]).label, "—", "完全沒有格子時仍然是「—」");

  const exact = rollingPeak(q(7, 4)); /* 剛好 60 分鐘 */
  assert.equal(exact.value, 200, "剛好 60 分鐘要算得出來（不可以修過頭）");
  assert.equal(exact.label, "07:00～08:00");

  const twoHour = rollingPeak([{ hour: "07:00~09:00", value: 400 }]);
  assert.equal(twoHour.value, 0, "2 小時一格本來就該回資料不足");
  assert.equal(twoHour.label, "資料不足");
});
