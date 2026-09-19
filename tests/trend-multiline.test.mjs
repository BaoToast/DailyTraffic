/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-34②：歷季趨勢「一個調查點一條線」——畫面以外的三個出口
 * ══════════════════════════════════════════════════════════════════════
 *
 * 畫面那一段由 `scripts/e2e-trend-multiline.mjs` 守（真的去 hover 圖）。
 * 這一支守的是**同一份資料的另外三個出口**：
 *   ① 匯出 Excel 的「歷季趨勢」工作表與它上面那張原生折線圖
 *   ② 結論草稿的歷季段落
 *   ③ 講稿（trend-script.ts，純函式，可以直接呼叫）
 *
 * ⚠️ 為什麼要另外守：畫面改對、匯出沒改，是這個專案踩過最多次的一種錯。
 *   兩邊各自看都很合理，只有把兩份放在一起比才看得出來——而使用者
 *   抄進報告的往往是匯出檔裡的那個數字。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTrendScript } from "../app/trend-script.ts";

const source = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
/** 去掉註解再比——註解裡合法地出現這些字串，不可以拿來當證據。 */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ── ① 匯出的「歷季趨勢」工作表 ───────────────────────────── */

test("「歷季趨勢」工作表的欄位要跟著實際幾條線走，不可以寫死平日／假日兩欄", () => {
  const block = code.slice(
    code.indexOf('const tr = wb.addWorksheet("歷季趨勢"'),
    code.indexOf('const ts = wb.addWorksheet("圖表說明"'),
  );
  assert.ok(block.length > 500, "找不到「歷季趨勢」那一段");
  assert.match(
    block,
    /const trendExcelSeries = trendLines\.length/,
    "匯出的欄位要先判斷有沒有逐點分列的線",
  );
  assert.match(
    block,
    /\.\.\.trendExcelSeries\.map\(\(series\) => series\.name\)/,
    "表頭要逐條線各給一欄",
  );
  assert.match(
    block,
    /\.\.\.trendExcelSeries\.map\(\(series\) => series\.values\[index\] \?\? null\)/,
    "資料列也要逐條線各給一格",
  );
  /*
   * ⚠️ 反面：這一段裡**不可以**還留著只寫兩欄的舊寫法。
   *   只驗「有沒有 trendExcelSeries」是不夠的——兩者並存時，
   *   多出來的欄位寫在後面、前兩欄還是合計，看起來完全正常。
   */
  assert.doesNotMatch(
    block,
    /r\.weekday \?\? null,\s*\n\s*r\.holiday \?\? null/,
    "資料列還在寫死平日／假日兩欄（那兩欄在多個調查點時是合計）",
  );
});

test("Excel 原生折線圖引用的欄位要跟著工作表算，不可以寫死 B、C 兩欄", () => {
  const block = code.slice(
    code.indexOf("歷季全日交通量趨勢（${trendUnit}）"),
    code.indexOf("車種組成（使用右側選單切換）"),
  );
  assert.ok(block.length > 200, "找不到歷季趨勢那張原生圖的定義");
  assert.match(
    block,
    /series: trendExcelSeries\.map\(/,
    "原生圖的序列要逐條線產生",
  );
  assert.match(
    block,
    /colName\(2 \+ index\)/,
    "欄位位置要跟著實際欄數算（寫死 B、C 的話第三個調查點以後畫不出來）",
  );
  assert.doesNotMatch(
    block,
    /\$B\$2:\$B\$|\$C\$2:\$C\$/,
    "原生圖還在寫死 B、C 兩欄",
  );
});

/* ── ② 結論草稿 ─────────────────────────────────────────────── */

test("結論草稿的歷季段落要用圖上那幾條線，不可以回頭讀合計", () => {
  const block = code.slice(
    code.indexOf("const trendSeries = "),
    code.indexOf("const periodPeriods = "),
  );
  assert.ok(block.length > 300, "找不到草稿的 trendSeries 那一段");
  assert.match(
    block,
    /const trendSeries = trendLines\.length/,
    "草稿要先判斷有沒有逐點分列的線",
  );
  assert.match(
    block,
    /label: line\.label/,
    "逐點分列時草稿的序列名稱要是調查點名稱",
  );
});

/* ── ③ 講稿（純函式，直接呼叫） ─────────────────────────────── */

const META = {
  label: "全日實際交通量",
  unit: "輛／調查日",
  digits: 0,
  meaning: "這是一整天通過調查斷面的車輛數。",
};
const CONTEXT = {
  scopeText: "2 個調查點（逐點分列，不合計）",
  dayText: "平日",
  quarterLabel: (quarter) => quarter,
};
const POINTS = [
  { quarter: "115Q1", weekday: 115873, holiday: null },
  { quarter: "115Q2", weekday: 172000, holiday: null },
];
const LINES = [
  { name: "中山路", values: [42090, 67344] },
  { name: "中正路口", values: [73783, 104656] },
];
const flatten = (sections) =>
  sections.flatMap((section) => section.lines).join("\n");

test("給了 seriesLines 時，講稿講的是那幾條線，合計的數字一個都不出現", () => {
  const text = flatten(buildTrendScript(POINTS, META, {
    ...CONTEXT,
    seriesLines: LINES,
  }));
  assert.match(text, /中山路/, "要逐條線各講一次");
  assert.match(text, /中正路口/);
  assert.match(text, /42,090/, "講的要是那條線自己的值");
  assert.match(text, /73,783/);
  /*
   * ⚠️ 這一條是這個測試的重點：115,873 ＝ 42,090 ＋ 73,783，
   *   正是使用者 X-28 指出的那個「不同調查點相加」的數字。
   *   它就放在 points 的 weekday 欄裡（畫面上那張圖的舊資料），
   *   所以講稿只要有一行忘了改，就會把它念出來。
   */
  assert.doesNotMatch(text, /115,873/, "講稿念出了跨調查點相加的數字");
  assert.doesNotMatch(text, /172,000/, "講稿念出了跨調查點相加的數字");
  assert.match(text, /不可以相加/, "要明說不同調查點不可以相加");
  assert.match(text, /不畫合計/);
});

test("沒給 seriesLines 時，輸出與升級前逐字相同（平日／假日兩條）", () => {
  const text = flatten(
    buildTrendScript(
      [
        { quarter: "115Q1", weekday: 42090, holiday: 31000 },
        { quarter: "115Q2", weekday: 67344, holiday: 35000 },
      ],
      META,
      CONTEXT,
    ),
  );
  assert.match(text, /圖上有兩條線：平日與假日分開畫。/);
  assert.match(text, /平日：從 115Q1 的 42,090/);
  assert.match(text, /假日：從 115Q1 的 31,000/);
  assert.doesNotMatch(text, /不畫合計/, "單一調查點時不該冒出逐點分列的說法");
});

test("逐點分列時，缺值的那幾季要照「哪幾條線缺」講，不是照平日／假日講", () => {
  const text = flatten(
    buildTrendScript(
      [
        { quarter: "115Q1", weekday: 115873, holiday: null },
        { quarter: "115Q2", weekday: 172000, holiday: null },
      ],
      META,
      {
        ...CONTEXT,
        seriesLines: [
          { name: "中山路", values: [42090, 67344] },
          { name: "中正路口", values: [null, 104656] },
        ],
      },
    ),
  );
  assert.match(text, /只有部分的線算得出來/);
  assert.match(text, /115Q1缺中正路口/);
  assert.doesNotMatch(
    text,
    /只做了其中一種日別的調查/,
    "逐點分列時不可以還用平日／假日的說法",
  );
});
