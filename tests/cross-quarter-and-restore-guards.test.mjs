/*
 * ── v20.38 的四道守門 ──
 *
 * 這一支守住 v20.38 修掉的四件事。共同點和 silent-failure-guards 一樣：
 * 都不會丟出錯誤，只會給出一個看起來合理、實際上錯的結果。
 *
 *  H-1 還原備份時 PCU 係數寫到空字串計畫，畫面顯示成功、localStorage 是空的
 *  H-2 歷季（跨季度）各表用「目前季度」的調查涵蓋標單位
 *  M-1 匯出範圍說明宣稱歷季全日交通量會依歷季分析面板篩選，實際上不會
 *  M-2 anomalyQuarters 自己寫了一套季度排序，混用民國／西元時會排錯
 *  M-3 刪除計畫沒有清掉依計畫存放的 localStorage
 *
 * 這幾項都在 React 元件內部，沒辦法單獨 import，因此採用本專案既有的
 * 「取出該函式的原始碼區塊再比對」作法（見 backup-completeness.test.mjs）；
 * 能獨立驗證的純函式（coverageLabelOf、compareQuarters）則直接執行。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { coverageLabelOf, surveyCoverage } from "../app/partial-day.ts";
import { compareQuarters } from "../app/final-workflow.ts";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

/** 取出某個函式從宣告到下一個同層宣告之間的原始碼。 */
function blockFrom(marker, endMarker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `找不到 ${marker}`);
  const end = source.indexOf(endMarker, start + marker.length);
  assert.notEqual(end, -1, `找不到 ${marker} 之後的 ${endMarker}`);
  return source.slice(start, end);
}

/* ────────────────────────────────────────────────────────────
 * H-1：還原備份時，PCU 係數必須寫進「這次真正還原進去的那個計畫」
 * ──────────────────────────────────────────────────────────── */

test("還原備份時 PCU 係數要寫進 targetProjectId，不是 activeProject", () => {
  /*
   * importBackup 會在「一個計畫都還沒有」時自動依備份檔建立一個計畫
   * ——換一台電腦還原備份正是這個功能存在的理由。此時 activeProject
   * 還是空字串（setActiveProject 是 React 狀態更新，同一個函式裡讀不到
   * 新值，程式自己在 targetProjectId 上方就有這段註解），而
   * writeProjectPcuFactors("") 舊版直接 return true——畫面顯示還原成功、
   * 係數也確實變成備份裡的值，但 localStorage 一個位元組都沒寫，
   * 重新整理後無聲退回預設值 0.5，所有 PCU 數字跟著改變。
   * 實測同一份資料尖峰 PCU 由 144.7 變成 154.5（差 6.8%），無任何警告。
   */
  const block = blockFrom("async function importBackup(", "\n  async function ");
  const pcuWrites = [...block.matchAll(/writeProject(?:Turn)?PcuFactors\(\s*([A-Za-z]+)/g)];
  assert.equal(pcuWrites.length, 2, "importBackup 應該剛好寫入路段與轉向兩組係數");
  for (const [, argument] of pcuWrites)
    assert.equal(
      argument,
      "targetProjectId",
      `importBackup 用 ${argument} 寫 PCU 係數；自動建立計畫時它是空字串，係數會寫不進去`,
    );
  /* 同一個函式裡其他寫入都用 targetProjectId，不可以再出現 activeProject */
  assert.doesNotMatch(
    block,
    /writeProject(?:Turn)?PcuFactors\(activeProject/,
    "還原路徑不得使用 activeProject",
  );
});

test("寫不進去的時候不可以回報成功", () => {
  /*
   * 「寫入函式在沒有目標時回傳 true」是整個 H-1 之所以無聲的原因：
   * 呼叫端拿到 true，於是不會有任何提示。
   */
  const block = blockFrom(
    "function writeProjectPcuFactors(",
    "\n/**\n * 刪除計畫時",
  );
  assert.doesNotMatch(
    block,
    /if \(!projectId\) return true;/,
    "projectId 為空時回傳 true 等於謊報寫入成功",
  );
  assert.equal(
    (block.match(/if \(!projectId\) return false;/g) ?? []).length,
    2,
    "路段與轉向兩個寫入函式都要在沒有計畫時回報 false",
  );
});

test("PCU 係數寫入失敗時要保留警告到還原流程結束", () => {
  const block = blockFrom("async function importBackup(", "\n  async function ");
  assert.match(
    block,
    /if \(!writeProjectPcuFactors\(targetProjectId, restored\)\)\s*\n?\s*restoreWarnings\.push\(/,
    "路段 PCU 寫入失敗要有提示",
  );
  assert.match(
    block,
    /if \(!writeProjectTurnPcuFactors\(targetProjectId, restoredTurn\)\)\s*\n?\s*restoreWarnings\.push\(/,
    "轉向 PCU 寫入失敗要有提示",
  );
  assert.match(
    block,
    /restoreWarnings\.length\s*\?\s*`已還原/,
    "途中警告不能被最後固定的「還原完成」訊息蓋掉",
  );
});

test("恢復預設與套用範本不得用成功訊息蓋掉儲存失敗", () => {
  const reset = blockFrom("const resetPcuFactors = () => {", "\n  /**");
  assert.match(reset, /const savedRoad = writeProjectPcuFactors/);
  assert.match(reset, /const savedTurn = writeProjectTurnPcuFactors/);
  assert.match(reset, /savedRoad && savedTurn\s*\?\s*"已恢復/);

  const template = blockFrom(
    "async function applyProjectTemplate(",
    "\n  function saveComparisonReport",
  );
  assert.match(template, /if \(!activeProject\)/, "沒有計畫時要說清楚，不能誤報空間已滿");
  assert.match(template, /const templateWarnings: string\[\] = \[\]/);
  assert.match(
    template,
    /templateWarnings\.length\s*\?\s*`已套用設定範本/,
    "範本寫入失敗警告不能被函式末尾的成功訊息蓋掉",
  );
});

/* ────────────────────────────────────────────────────────────
 * H-2：歷季（跨季度）各表不得用「目前季度」的調查涵蓋標單位
 * ──────────────────────────────────────────────────────────── */

test("coverageLabelOf 逐列說出這一列調查了多久", () => {
  const fullDay = surveyCoverage(
    Array.from({ length: 24 }, (_, h) => {
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(h)}:00～${pad((h + 1) % 24)}:00`;
    }),
  );
  assert.equal(coverageLabelOf(fullDay), "完整24小時");

  const partial = surveyCoverage([
    "07:00～08:00",
    "08:00～09:00",
    "17:00～18:00",
    "18:00～19:00",
  ]);
  assert.equal(
    coverageLabelOf(partial),
    "部分時段 4 小時（07:00～09:00、17:00～19:00）",
  );

  /* 半小時也要看得出來，不能四捨五入成整數騙人 */
  assert.equal(
    coverageLabelOf(surveyCoverage(["07:00～07:30"])),
    "部分時段 0.5 小時（07:00～07:30）",
  );

  /* 時段完全讀不出來時要明說，不可以假裝是完整 24 小時 */
  assert.equal(coverageLabelOf(surveyCoverage([])), "無法判定");
  assert.equal(coverageLabelOf(surveyCoverage(["", "整天"])), "無法判定");
});

test("歷季各表的欄位標題不得帶「/日」或「/調查時段」", () => {
  /*
   * sheetActualUnit／sheetPcuUnit／pcu24Label／trendActualUnit 全都源自
   * surveyScope，而 surveyScope 只看目前選的那一季（scoped 有
   * r.quarter === quarter 這個條件）。歷季各表卻是把 analysisRecords
   * 全部季度混在一起排。於是：
   *  ・目前選 24 小時季 → 只調查 4 小時的那一季被標成「輛/日」
   *  ・目前選部分時段季 → 真正的 24 小時資料被標成「輛/調查時段」
   * 兩種情形都會被拿去和另一種直接比較。
   */
  const hd = blockFrom('wb.addWorksheet("歷季全日交通量"', 'wb.addWorksheet("歷季車種組成"');
  const hc = blockFrom('wb.addWorksheet("歷季車種組成"', 'wb.addWorksheet("歷季組成圖表資料"');
  const tr = blockFrom('wb.addWorksheet("歷季趨勢"', 'wb.addWorksheet("目前車種組成"');
  for (const [name, block] of [
    ["歷季全日交通量", hd],
    ["歷季車種組成", hc],
    ["歷季趨勢", tr],
  ]) {
    for (const banned of [
      "sheetActualUnit",
      "sheetPcuUnit",
      "pcu24Label",
      "totalLabel",
      "trendActualUnit",
      "trendPcuUnit",
    ])
      assert.ok(
        !block.includes(banned),
        `${name} 是跨季度的表，不可以用依目前季度算出來的 ${banned} 當單位`,
      );
    assert.match(
      block,
      /調查涵蓋/,
      `${name} 要有「調查涵蓋」欄，逐列說明該季實際調查了多久`,
    );
  }
});

test("歷季各列自己帶著調查涵蓋", () => {
  const block = blockFrom("const historicalDailyRows = useMemo(", "const historicalCompositionRows");
  assert.match(block, /x\.hours\.push\(r\.hour \?\? ""\)/, "要逐列收集時段字串");
  assert.match(block, /surveyCoverage\(hours\)/, "要逐列算涵蓋範圍");
  assert.match(block, /coverageLabel: coverageLabelOf\(coverage\)/);
});

test("歷季趨勢分開標示平日與假日的調查涵蓋", () => {
  const block = blockFrom(
    'wb.addWorksheet("歷季趨勢"',
    'wb.addWorksheet("目前車種組成"',
  );
  assert.match(block, /"平日調查涵蓋"/);
  assert.match(block, /"假日調查涵蓋"/);
  assert.match(block, /\.get\(r\.quarter\)\?\.weekday/);
  assert.match(block, /\.get\(r\.quarter\)\?\.holiday/);
});

test("舊版 .xls 匯出的歷季表也要跟著改", () => {
  const block = blockFrom("async function exportLegacy()", "\n  async function ");
  assert.match(block, /調查涵蓋: r\.coverageLabel/, "歷季全日交通量要有調查涵蓋欄");
  assert.match(block, /\["調查涵蓋", r\.coverageLabel\]/, "歷季車種組成要有調查涵蓋欄");
  /*
   * 舊版是 `...row` 直接展開，現在 row 上多了 coverage 這個物件，
   * 展開會把一個物件寫進儲存格。必須逐欄列出。
   */
  assert.doesNotMatch(
    block,
    /const historicalDailyExport = historicalDailyRows\.map\(\s*\(\{/,
    "不可以用解構後整個展開，會把 coverage 物件寫進儲存格",
  );
});

/* ────────────────────────────────────────────────────────────
 * M-1：匯出範圍說明必須與實作一致
 * ──────────────────────────────────────────────────────────── */

test("匯出範圍說明不得宣稱歷季全日交通量會被篩選", () => {
  /*
   * historicalDailyRows／historicalCompositionRows 走的是未經任何篩選的
   * analysisRecords（刻意如此，那兩張是明細底稿），只有「歷季趨勢」與
   * 「歷季組成圖表資料」才吃 trendMode／trendRoad。說明寫成
   * 「歷季全日量與趨勢依歷季分析面板的…」會讓使用者以為範圍已經縮小了。
   */
  const rows = blockFrom("const historicalDailyRows = useMemo(", "const historicalCompositionRows");
  assert.ok(
    !rows.includes("trendRoad") && !rows.includes("trendMode"),
    "historicalDailyRows 其實不吃歷季分析面板的條件——說明必須照這個事實寫",
  );
  const note = blockFrom('<p className="export-scope-note">', "</p>");
  assert.ok(
    !/歷季全日量與趨勢<\/b>依/.test(note) &&
      !note.includes("歷季全日量與趨勢"),
    "說明不得把「歷季全日量」和「趨勢」綁在一起宣稱都會被篩選",
  );
  assert.match(note, /全部季度、全部日別、全部調查點/, "要說清楚明細底稿不受篩選");
});

/* ────────────────────────────────────────────────────────────
 * M-2：季度先後只留一套規則
 * ──────────────────────────────────────────────────────────── */

test("anomalyQuarters 用 compareQuarters，不自己補零排序", () => {
  const block = blockFrom("const anomalyQuarters = useMemo(", "[anomalyAlerts],");
  assert.doesNotMatch(
    block,
    /replace\(\/\^\(\\d\{2\}\)Q\/, "0\$1Q"\)/,
    "自訂補零排序在混用民國與西元標記時會排錯",
  );
  assert.match(block, /\.sort\(compareQuarters\)/);
});

test("compareQuarters 在混用民國與西元時仍排得對", () => {
  /* 2025Q1 就是民國 114Q1，必須落在 113Q4 與 114Q3 之間 */
  assert.deepEqual(
    ["2025Q1", "114Q3", "113Q4"].sort(compareQuarters),
    ["113Q4", "2025Q1", "114Q3"],
  );
  /* 舊寫法會排成 113Q4、114Q3、2025Q1——2025Q1 被丟到最後 */
  const legacy = (a, b) =>
    a.replace(/^(\d{2})Q/, "0$1Q").localeCompare(b.replace(/^(\d{2})Q/, "0$1Q"));
  assert.notDeepEqual(
    ["2025Q1", "114Q3", "113Q4"].sort(legacy),
    ["113Q4", "2025Q1", "114Q3"],
    "這一行是在證明舊寫法真的會排錯；若它開始通過，代表上面的測試已失去意義",
  );
  /* 三碼與兩碼混用（99Q3 是民國 99 年）也要對 */
  assert.deepEqual(
    ["114Q1", "99Q3", "100Q1"].sort(compareQuarters),
    ["99Q3", "100Q1", "114Q1"],
  );
});

/* ────────────────────────────────────────────────────────────
 * M-3：刪除計畫要把依計畫存放的東西一起清掉
 * ──────────────────────────────────────────────────────────── */

test("刪除計畫會清掉依計畫存放的 localStorage", () => {
  const block = blockFrom("async function deleteProject()", "\n  async function ");
  assert.match(
    block,
    /dropProjectScopedStorage\(selectedProject\.id\)/,
    "刪掉計畫卻留著它的 PCU 係數與結論範本，會一直占用瀏覽器儲存空間",
  );
  const helper = blockFrom("const PROJECT_SCOPED_KEYS = [", "\n\n");
  for (const key of [
    "PCU_BY_PROJECT_KEY",
    "TURN_PCU_BY_PROJECT_KEY",
    "CONCLUSION_TEMPLATE_KEY",
  ])
    assert.ok(helper.includes(key), `PROJECT_SCOPED_KEYS 漏了 ${key}`);
});
