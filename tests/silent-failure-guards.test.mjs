/*
 * ── 判讀不出來時不可以自己編一個 ──
 *
 * 這組測試守住 v20.36 修掉的幾個「安靜失敗」。共同病癥都是：不報錯，
 * 給一個看起來合理的值繼續往下算，使用者永遠不知道出過事。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cellCount,
  isNonTrafficSheetName,
  isUnusableCount,
  parseTrafficSheetValues,
  trafficSheetNamesForDay,
} from "../app/traffic-parser.ts";

/* ── 一、日期／時間格式的儲存格不可以變成車輛數 ── */
test("日期格式的儲存格計為 0，不得變成 epoch 毫秒", () => {
  /*
   * SAFE_XLSX_READ_OPTIONS 帶 cellDates: true，日期格的 .v 是 Date 物件，
   * 而 Number(Date) 是**有限的** epoch 毫秒——`Number.isFinite()` 擋不住它。
   * 實測一格時間格會變成 1,788,073,200,000 輛，然後進尖峰判斷、PCU 換算
   * 與全日累計，而匯入檢核報告還會顯示綠字「未發現非數字」，
   * 因為它的判斷式也是 `!Number.isFinite()`。
   * Excel 對「7:00」這類輸入會自動套時間格式，是最常見的誤植。
   */
  assert.equal(cellCount(new Date("2026-08-30T07:00:00Z")), 0);
  assert.equal(cellCount(new Date("1899-12-30T07:00:00Z")), 0);
  const huge = cellCount(new Date("2026-08-30T07:00:00Z"));
  assert.ok(huge < 1000, `日期格不得產生大數字，實際 ${huge}`);
});

test("既有的數值行為完全不變", () => {
  /* 四捨五入口徑是 v20.33 定下的，不得因這次修改而變動 */
  assert.equal(cellCount(0.36), 0);
  assert.equal(cellCount(5.5506), 6);
  assert.equal(cellCount(13.3431), 13);
  assert.equal(cellCount(2.5), 3);
  assert.equal(cellCount("7"), 7);
  assert.equal(cellCount("--"), 0);
  assert.equal(cellCount("－"), 0);
  assert.equal(cellCount(""), 0);
  assert.equal(cellCount(null), 0);
  assert.equal(cellCount(undefined), 0);
});

test("isUnusableCount 只標記「有內容但不是數字」的格子", () => {
  assert.equal(isUnusableCount(new Date()), true);
  assert.equal(isUnusableCount("休"), true);
  assert.equal(isUnusableCount("N/A"), true);
  /* 不存在的轉向是合法記號，不可誤報成壞資料 */
  assert.equal(isUnusableCount("--"), false);
  assert.equal(isUnusableCount("－"), false);
  assert.equal(isUnusableCount("—"), false);
  /* 空白格是正常的，稀疏調查表本來就有 */
  assert.equal(isUnusableCount(""), false);
  assert.equal(isUnusableCount(null), false);
  assert.equal(isUnusableCount(undefined), false);
  assert.equal(isUnusableCount(12), false);
  assert.equal(isUnusableCount(" 12 "), false);
});

test("日期／非數字計數格會保留來源警告，合法占位符不會誤報", () => {
  const values = [
    ["時間", "機車", "小型車", "大型車", "特種車"],
    ["07:00～08:00", new Date("2026-08-30T07:00:00Z"), "--", 3, 1],
  ];
  const rows = parseTrafficSheetValues(
    values,
    "平日",
    "115Q3",
    { roadId: "T-01", roadName: "測試路段", a: "往北", b: "往南" },
    { fileName: "日期誤植.xlsx", sheetName: "平日" },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].motorcycle, 0);
  assert.equal(rows[0].small, 0);
  assert.deepEqual(rows[0].sourceWarnings, [
    "B2 是日期／時間格式，已按 0 輛處理，請確認原始檔。",
  ]);
});

/* ── 二、同一日別的多張工作表都要讀 ── */
const dashboard = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

test("同一日別有多張工作表時要全部讀，不能只讀第一張", () => {
  /*
   * 舊寫法 `SheetNames.find(n => n.includes(dt))` 只取第一張同名工作表：
   *  ・順序是「平日照片、平日」→ 選中照片頁、讀出 0 列，整份平日資料消失
   *  ・「平日-北向、平日-南向」→ 只讀北向，一半資料不見，而檢核報告還會
   *    顯示綠字「未發現 24 小時缺漏」，因為讀到的那張單方向確實完整
   */
  assert.doesNotMatch(
    dashboard,
    /SheetNames\.find\(\(n\) => n\.includes\(dt\)\)/,
    "不可以只取第一張同名工作表",
  );
  assert.deepEqual(
    trafficSheetNamesForDay(
      ["平日照片", "平日-北向", "平日-南向", "假日", "平日-號誌化路口"],
      "平日",
    ),
    ["平日-北向", "平日-南向", "平日-號誌化路口"],
  );
  assert.equal(isNonTrafficSheetName("照片(平日)"), true);
  assert.equal(isNonTrafficSheetName("平日-監測日誌1"), true);
  assert.equal(isNonTrafficSheetName("平日-號誌化路口"), false);
  assert.match(dashboard, /trafficSheetNamesForDay/, "畫面匯入流程要使用同一套篩選函式");
});

test("略過的工作表與讀出 0 列的檔案要被指名", () => {
  assert.match(dashboard, /const fileNotes: Array<\{/);
  assert.match(dashboard, /skipped: book\.SheetNames\.filter/);
  assert.match(dashboard, /讀出 0 列/);
  assert.match(dashboard, /已略過的工作表/);
  assert.match(dashboard, /fileWarnings/);
  assert.match(
    dashboard,
    /pendingImport\.files\.length !==/,
    "選取檔數與實際來源檔數不同時要在畫面上標出來",
  );
});

test("日別退回檔名判定時要提醒使用者", () => {
  assert.match(dashboard, /if \(!headerDay\) dayFromFileName = true;/);
  assert.match(dashboard, /日別是資料的身分鍵之一/);
});

test("匯入失敗訊息要逐檔說明原因", () => {
  assert.doesNotMatch(
    dashboard,
    /throw new Error\("找不到平日／假日交通量資料"\)/,
    "這句話不指名檔案、不說原因、不給補救方向",
  );
  assert.match(dashboard, /沒有讀到任何交通量資料/);
});
