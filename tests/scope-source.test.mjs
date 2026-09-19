/**
 * ══════════════════════════════════════════════════════════════════════
 *  標籤與數字必須來自**同一邊**（2026-09-16 自我稽核，共 10 處）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 畫面那一半由 `scripts/e2e-scope-label.mjs` 實際操作驗證。
 * 這一支守的是**畫面以外**的那幾條路徑——它們沒辦法用一次 e2e 走完：
 *   ・匯出的 Excel（條件欄、快取值、原生圖的標題與資料）
 *   ・下載的 PNG（檔名與圖上那一行字）
 *   ・表格的欄位單位與「部分時段」提醒
 *
 * 兩條規則：
 *   ① **畫面上的**標題／說明／PNG 檔名 → 照**那一塊自己的**條件
 *   ② **交出去的文件**（結論草稿、分析數據 Excel）→ 一律照**主工具列**
 *      （使用者 2026-09-14 定的規則）
 *
 * ⚠️ 最嚴重的一條是「Excel 的快取值與 SUMIFS 算的不是同一件事」：
 *   快取寫脫離後的值、公式照主工具列重算，**檔案一打開數字就自己變了**，
 *   而收到檔案的人看到的是重算後那一份，完全不知道發生過什麼。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
/** 去掉註解再比——註解裡合法地提到舊寫法（那是刻意留的說明）。 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");
const blockFrom = (start, end) => {
  const from = code.indexOf(start);
  const to = code.indexOf(end, from + 1);
  assert.ok(from >= 0, `找不到起點：${start}`);
  assert.ok(to > from, `找不到終點：${end}`);
  return code.slice(from, to);
};

/* ── ① 畫面：標題與 PNG 檔名照區塊自己的條件 ────────────────── */

test("車種組成的抬頭讀的是這一塊自己的條件，不是主工具列", () => {
  const block = blockFrom(
    "const compositionScopeText = useMemo(",
    "const compositionMainScopeText",
  );
  assert.match(
    block,
    /scopeTextOf\(filtersOf\(CHART_COMPOSITION\)\)/,
    "抬頭要照這一塊自己的條件算（它掛著 renderBlockFilters，可以脫離）",
  );
  /*
   * ⚠️ 反面：這一段裡不可以再出現主工具列那三個 state。
   *   只驗「有沒有 filtersOf」是不夠的——兩者並存時，
   *   抬頭照舊讀主工具列，而多出來的那一行沒人用。
   */
  assert.doesNotMatch(
    block,
    /roadFilters|dayType|directions/,
    "抬頭還在讀主工具列的 state",
  );
});

test("下載的 PNG 檔名逐塊算，不可以整批套主工具列那一行", () => {
  assert.match(
    code,
    /const chartScopeTextOf = useCallback\(/,
    "缺少逐塊算檔名的那一支",
  );
  for (const [name, chartId] of [
    ["每小時實際交通量與PCU", "CHART_HOURLY"],
    ["車種組成", "CHART_COMPOSITION"],
    ["各路段平日與假日比較", "CHART_DAY_COMPARE"],
  ])
    assert.ok(
      code.includes(`chartScopeTextOf(${chartId})`),
      `「${name}」的檔名還沒有改成逐塊算（${chartId}）`,
    );
  /*
   * ⚠️ 反面：那三張圖的檔名裡不可以再出現主工具列那一行（chartScopeText）。
   *   還留著一個就代表有一張圖的檔名仍然在說別人的條件。
   */
  const jobs = blockFrom("const chartPngJobs = useMemo(", "const downloadAllChartPng");
  assert.doesNotMatch(
    jobs,
    /\$\{chartScopeText\}/,
    "批次下載的檔名還在套主工具列那一行",
  );
});

test("24 小時型態的說明與匯出圖，讀的都是圖上那一份紀錄", () => {
  const exportSeries = blockFrom(
    "const hourlyExportSeries = useMemo(",
    "const hourlyChartNote = useMemo(",
  );
  assert.match(
    exportSeries,
    /hourlySeriesByDayOf\(\s*hourlyRecords,/,
    "下載的 PNG 還在用主工具列那一份（filtered），會和畫面上的圖不一樣",
  );
  const note = blockFrom("const hourlyChartNote = useMemo(", "const dayCompareChartNote");
  assert.match(note, /for \(const record of hourlyRecords\)/);
  assert.doesNotMatch(
    note,
    /\bfiltered\b/,
    "說明還在讀主工具列那一份，講出來的尖峰與最大值不是圖上那張的",
  );
});

/* ── ② 交付物：一律照主工具列，而且標籤與數字同一邊 ────────── */

test("匯出的「目前車種組成」快取值與 SUMIFS 算的是同一件事", () => {
  const block = blockFrom(
    'const currentComp = wb.addWorksheet("目前車種組成"',
    "currentComp.getCell(\"E5\")",
  );
  /*
   * 條件欄照主工具列——SUMIFS 就是照這三格篩的。
   * 2026-09-18 F-10／F-30：三格的值改由 compositionMainSelection 給
   *（一個調查點 × 一個日別，仍然是從主工具列推出來的），快取也從同一份查。
   */
  assert.match(block, /currentComp\.getCell\("F2"\)\.value = compositionMainSelection\.day;/);
  assert.match(block, /currentComp\.getCell\("F3"\)\.value = compositionMainSelection\.roadName;/);
  /* 快取值也必須照主工具列，否則檔案一打開數字就自己變了。 */
  assert.match(
    block,
    /compositionMainTotals\.vehicles\[vehicle\.key\]/,
    "快取值還在用畫面那一份（compositionTotals），與同一張表的 SUMIFS 不同源",
  );
  assert.doesNotMatch(
    block,
    /compositionTotals\.(total|vehicles)/,
    "這一段裡還留著畫面那一份的合計",
  );
});

test("結論草稿的車種組成與平假日比較，標籤與數字都照主工具列", () => {
  const draft = blockFrom("      projectName:", "      periodHighlights:");
  assert.match(
    draft,
    /compositionMainTotals\.vehicles\[vehicle\.key\]/,
    "草稿的車種組成數字還在讀畫面那一份（會跟著區塊脫離跑）",
  );
  assert.match(
    draft,
    /compositionMode: compositionMainScopeText/,
    "草稿的車種組成標籤要與它的數字同一邊",
  );
  assert.match(
    draft,
    /dayComparePoints: dayComparisonsMain/,
    "草稿的平假日比較還在讀畫面那一份",
  );
});

test("平假日比較：畫面與匯出各算一份，公式只有一支", () => {
  assert.match(
    code,
    /const dayComparisonsFor = useCallback\(/,
    "缺少共用的那一支算式",
  );
  assert.match(code, /const dayComparisons = useMemo\(\s*\(\) => dayComparisonsFor\(filtersFor\(/);
  assert.match(code, /const dayComparisonsMain = useMemo\(\s*\(\) => dayComparisonsFor\(mainFilters\)/);
  /* 匯出的三個落點（.xls 表、.xlsx 表、原生圖的快取）都要照主工具列。 */
  assert.match(code, /const dayComparisonRows = dayComparisonsMain\.map/);
  assert.match(code, /dayComparisonsMain\.forEach\(\(r\) =>/);
  assert.match(code, /cache: dayComparisonsMain\.map\(\(r\) =>/);
});

/* ── 表格的單位與「部分時段」提醒 ────────────────────────────── */

test("兩張可追溯明細的欄位單位與部分時段提醒，照自己那一塊的涵蓋算", () => {
  assert.match(
    code,
    /const coverageOfRecords = useCallback\(/,
    "缺少逐塊算調查涵蓋的那一支",
  );
  assert.match(code, /const traceScope = useMemo\(/);
  assert.match(code, /const traceIntersectionScope = useMemo\(/);
  assert.match(code, /partialNoticeFor\(traceScope\)/);
  assert.match(code, /partialNoticeFor\(traceIntersectionScope\)/);
  assert.match(code, /traceUnits\.actual/);
  assert.match(code, /traceIntersectionUnits\.actual/);
  /*
   * ⚠️ 反面：那一整段表格裡不可以再出現主工具列的 surveyScope.partial，
   *   否則欄名會寫「全日」而列的是部分時段調查的量。
   */
  const traceBlock = blockFrom(
    '<span>可追溯明細・路段格式</span>',
    'id="periodAnalysis"',
  );
  assert.doesNotMatch(
    traceBlock,
    /surveyScope\.partial/,
    "可追溯明細還在讀主工具列的調查涵蓋",
  );
});

test("時段車種分析的欄位單位跟著這一塊自己的日別", () => {
  const table = blockFrom("<th>分析時段</th>", "<tbody>");
  assert.match(
    table,
    /separateDays:\s*\n?\s*periodFilters\.day === "平日＋假日"/,
    "欄位單位還在讀主工具列的日別，會與這張表的列自己打自己",
  );
  assert.doesNotMatch(
    table,
    /separateDays: dayType === "平日＋假日"/,
    "欄位單位還在讀主工具列的 dayType",
  );
});
