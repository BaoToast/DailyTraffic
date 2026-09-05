/*
 * ── v20.39 的守門測試 ──
 *
 * 本輪修正全部來自三支系統的跨系統徹查。
 *  H2 「平日＋假日」匯出把兩天的加總標成單日值
 *  H3 .xls 的平假日比較表用程式屬性名當欄名、少兩欄、無單位
 *  M1 三支共用的非調查日期清單漂移
 *  M4 沒做假日調查時顯示假日 0 與 −100%
 *  M8 跨計畫比較的單位寫死
 *  L1 同季平假日面板的單位寫死
 *  L2 還原備份後 PCU 面板仍說「使用系統預設值」
 *  L3 引導使用者去看一張不存在的工作表
 *  L4 兩個調查點同名時匯出的 SUMIFS 會重複計算
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isNonSurveyDateText } from "../app/period-date.ts";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

function blockFrom(marker, endMarker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `找不到 ${marker}`);
  const end = source.indexOf(endMarker, start + marker.length);
  assert.notEqual(end, -1, `找不到 ${marker} 之後的 ${endMarker}`);
  return source.slice(start, end);
}

/* ── M1：三支共用的非調查日期清單 ── */

test("非調查日期清單要涵蓋彙整、輸出、建檔、產製", () => {
  /*
   * 這份清單三支共用。v2.1.40 只在路口轉向加了這四個詞，全日交通量沒跟上。
   * 「彙整日期：115年6月30日」帶「日期：」標示，會被當成明確標示的調查日期
   * 直接採用，排在它後面的真正調查日期永遠讀不到——期別檢查因此拿錯的日期
   * 去比對，跳出假的「日期與期別不一致」。
   */
  for (const word of ["製表", "列印", "印製", "報告", "出圖", "填表", "核定",
                      "審查", "校核", "繪製", "修正", "更新",
                      "彙整", "輸出", "建檔", "產製"])
    assert.equal(isNonSurveyDateText(`${word}日期：115年3月1日`), true, `「${word}日期」應排除`);
  for (const word of ["調查", "監測"])
    assert.equal(isNonSurveyDateText(`${word}日期：115年3月1日`), false, `「${word}日期」不可排除`);
});

/* ── H2：匯出的單位要同時看調查涵蓋與日別 ── */

test("「平日＋假日」不得把兩天相加成一列", () => {
  /*
   * 這一條的歷史值得寫清楚，因為它被修過兩次，第一次只修了一半。
   *
   * 【原始問題（v20.39）】日別選「平日＋假日」時，同一個調查點的平日與假日
   * 被加成一列，卻標成「全日實際交通量（輛/日）」：14013T601 匯出 12,838 輛
   * （平日 9,392＋假日 3,446），比真正的平日量高 37%。
   * 當時的修法是**把標示改誠實**——改標「輛／平假日合計」。
   *
   * 【使用者指出的真正問題】標示誠實不代表數字有用：
   *   「平日+假日是把兩天的車輛/當量做加總計算，這樣的計算方式，
   *     是否沒有實質應用的價值? 通常平日+假日應該是指把這兩個時段的結果
   *     同時顯示出來吧?」
   * 他是對的。一個平日量加一個假日量，既不是 AADT、不是任何一天的日交通量、
   * 也不是設計小時交通量，沒有對應的工程意義。
   * 實測中山路 115Q1：平日 42,090 輛、假日 32,675 輛 → 相加 74,765 輛。
   *
   * 而且系統本來就已經自相矛盾：同一個模式下的**尖峰**欄早就是取兩天之中
   * 較大的那個、並標明是哪一天（不是把 2,779.5 與 2,134 相加），
   * 每小時趨勢也早就依日別分開。只有總量、各方向量還在相加。
   *
   * 【現在的規則】「平日＋假日」＝兩天各出一列，每一格都是單日的量。
   * 因此也就不再需要、也不可以出現「平假日合計」這種單位或欄名。
   */
  const block = blockFrom("const roadRows = useMemo", "const roadOnlyRows");
  assert.match(
    block,
    /const splitByDay = dayType === "平日＋假日"/,
    "roadRows 必須在「平日＋假日」時依日別分列",
  );
  assert.match(
    block,
    /splitByDay \? `\$\{r\.roadId\}\|\$\{r\.dayType \?\? ""\}` : r\.roadId/,
    "分組鍵要帶日別，否則兩天又會被併成一列",
  );
  assert.match(block, /map\.set\(keyOf\(r\), x\)/, "寫回 map 要用同一把鍵");

  /*
   * 分列之後，分析範圍這條路徑（明細表、KPI、匯出、趨勢圖）不可以再出現
   * 「平假日合計」。唯一的例外是**車種組成面板**：那一頁看的是占比，
   * 分母用兩天合起來算是有意義的，所以它標「輛・平假日兩天合計」，
   * 刻意用不同的字樣，才不會和已經取消的舊標示混在一起。
   */
  assert.doesNotMatch(
    source,
    /平假日實測時段合計/,
    "「平假日實測時段合計」是舊的加總標示，分列之後不該再出現",
  );
  /* [^"\n] 很重要：不加 \n 的話 [^"]* 會跨行吃掉一整段程式碼 */
  const combinedLabels =
    source.match(/"[^"\n]*平假日合計[^"\n]*"|`[^`\n]*平假日合計[^`\n]*`/g) ?? [];
  assert.deepEqual(
    combinedLabels,
    [],
    "還有地方把兩天標成「平假日合計」——分列之後每一格都是單日量：\n" +
      combinedLabels.join("、"),
  );
  assert.match(
    source,
    /輛・平假日兩天合計/,
    "車種組成面板的兩天合計要用專屬字樣標明，不可以省略單位",
  );

  /* 兩條匯出路徑仍然要共用同一套單位函式，不可以各寫一份 */
  assert.equal(
    (source.match(/exportActualUnit\(dayType, surveyScope\.partial\)/g) ?? []).length,
    2,
    ".xls 與 .xlsx 兩條匯出路徑都要用同一套單位判斷",
  );
  /* 匯出的每一列要寫「這一列自己的日別」，不是寫「平日＋假日」 */
  assert.equal(
    (source.match(/日別: r\.dayType \|\| dayType/g) ?? []).length,
    2,
    "路段格式與路口格式的匯出都要寫這一列自己的日別",
  );
  assert.match(
    source,
    /const dailyTotals = useMemo[\s\S]*?row\.dayType[\s\S]*?dayType: row\.dayType/,
    "KPI 的平假日數值要依每列自己的日別分組",
  );
  assert.match(
    source,
    /const projectComparisons = useMemo\([\s\S]*?\.flatMap\([\s\S]*?r\.dayType === selectedDay/,
    "跨計畫比較在平日＋假日模式也必須分日產生列",
  );
  assert.ok(
    (source.match(/dayQualifiedLabel\(/g) ?? []).length >= 7,
    "畫面與可編輯 Excel 的分類標籤要帶日別，避免兩天同名而無法辨識",
  );
});

test("歷季趨勢的單位不可寫成「合計」——它畫的是兩條各自單日的線", () => {
  /*
   * trendRows 一直把 weekday 與 holiday 分成兩個欄位（被篩掉的那一條給 null
   * 而不是 0，見它自己的註解），從來沒有相加。但單位原本寫「輛／平假日合計」，
   * 而 trendMode 的**預設值就是「平日＋假日」**——所以什麼都不動的預設畫面上，
   * 兩條單日的線掛著一個「合計」的單位。同一批 trendRows 也會進 Excel 折線圖。
   */
  const block = blockFrom("const trendActualUnit =", "const intersectionFlowLabel");
  assert.doesNotMatch(block, /合計/, "趨勢圖的單位不可以出現「合計」");
  assert.match(block, /輛／調查日/);
  assert.match(block, /PCU／日/);
});

/* ── H3：.xls 的平假日比較表 ── */

test("舊版 .xls 的平假日比較要有中文欄名、單位與完整欄位", () => {
  /*
   * 舊版把 dayComparisons（React 狀態物件）直接丟給 json_to_sheet，
   * 欄名就變成 roadId / roadName / weekdayActual…，而且沒有單位，
   * 「平假日差」與「假日相較平日（%）」兩欄整個不見。
   * 其餘每一個 add() 傳的都是中文鍵的物件，只有這裡漏了。
   */
  assert.doesNotMatch(
    source,
    /add\("current", dayComparisons, "平假日比較"\)/,
    "不可以把狀態物件直接丟給 json_to_sheet",
  );
  const block = blockFrom("const dayComparisonRows = dayComparisons.map", "add(\"current\", dayComparisonRows");
  for (const key of ["調查點編號", "調查點名稱", "平日實際量", "假日實際量",
                     "平日PCU", "假日PCU", "平假日差", "假日相較平日"])
    assert.ok(block.includes(key), `.xls 的平假日比較少了「${key}」欄`);
  assert.match(block, /平日實際量（輛）/, "數量欄要帶中性單位，逐日涵蓋另列");
  assert.match(block, /平日PCU（PCU）/, "PCU 欄要帶中性單位，逐日涵蓋另列");
  assert.match(block, /平日調查涵蓋/);
  assert.match(block, /假日調查涵蓋/);
  assert.match(block, /r\.coverageComparable/, "涵蓋不同時不得計算差值與百分比");
});

/* ── M4：沒調查過的日別 ── */

test("沒做過的日別要與「做了但量是 0」分開", () => {
  /*
   * 舊版把 holidayActual 初始化為 0 就再也不區分，於是只做平日調查的季度
   * 顯示「假日 0 輛／日、-100.0%」，讀起來像假日流量真的歸零。
   * 歷季趨勢那邊早就用 null 區分了，平假日比較這條路徑漏掉。
   */
  const type = blockFrom("type DayComparison = {", "};");
  assert.match(type, /weekdaySurveyed: boolean/);
  assert.match(type, /holidaySurveyed: boolean/);

  const memo = blockFrom("const dayComparisons = useMemo(", "const trendRows");
  assert.match(memo, /x\.weekdaySurveyed = true/);
  assert.match(memo, /x\.holidaySurveyed = true/);

  /* 匯出：沒調查過的一律寫 null（空白格），不是 0 */
  assert.doesNotMatch(
    source,
    /r\.holidayActual - r\.weekdayActual,\s*\n\s*r\.weekdayActual \? r\.holidayActual \/ r\.weekdayActual - 1 : 0,/,
    "匯出仍在把未調查寫成 0 與 -100%",
  );
  assert.match(source, /r\.weekdaySurveyed && r\.holidaySurveyed/);
  /* 畫面：兩個日別都調查過才算得出增減 */
  assert.match(source, /wDone && hDone && r\.coverageComparable && w/);
  assert.match(source, /涵蓋不同/);
  assert.match(source, /本季未調查/);
});

/* ── M8／L1：寫死的單位 ── */

test("跨計畫比較與同季平假日面板的單位不可寫死", () => {
  /* 只看真正的字串常值，註解裡提到這個舊字串是正常的。 */
  assert.doesNotMatch(
    source,
    /(name|\s):\s*"實際交通量（輛\/調查日）"/,
    "跨計畫比較的單位寫死了，旁邊的 PCU 欄卻是依調查涵蓋算的",
  );
  assert.equal(
    (source.match(/`實際交通量（\$\{sheetActualUnit\}）`/g) ?? []).length,
    3,
    "工作表標題與兩張原生圖表的系列名稱都要用同一個單位",
  );
  assert.doesNotMatch(
    source,
    /u = dayMetric === "actual" \? "輛／日" : "PCU／日"/,
    "同季平假日面板的單位寫死了，與同一面板上的切換鈕互相矛盾",
  );
  assert.match(source, /unitOf = \(coverage: SurveyCoverage\)/);
  assert.match(source, /coverage\.partial\s*\n?\s*\?\s*"輛／調查時段"/);
  assert.match(source, /r\.coverageComparable/, "平假日涵蓋不同時不得顯示百分比");
});

/* ── L2：還原備份後的係數旗標 ── */

test("還原備份後要把「本計畫已自訂係數」的旗標打開", () => {
  /*
   * 還原進來的係數就是這個計畫自己的設定，但 importBackup 沒有更新旗標，
   * PCU 面板會一直寫著「本計畫尚未自行設定，目前使用系統預設值」，
   * 而畫面上的數字其實已經是備份裡的係數。重新整理後才會恢復正常。
   */
  const block = blockFrom("async function importBackup(", "\n  async function ");
  assert.match(block, /setProjectHasOwnFactors\(true\)/);
});

/* ── L3：不要指向不存在的工作表 ── */

test("沒有路口資料時不可以叫使用者去看路口工作表", () => {
  /* 那張工作表只在 intersectionOnlyRows.length 時才產生。 */
  assert.match(
    source,
    /intersectionOnlyRows\.length\s*\n?\s*\?\s*`本季無路段格式資料/,
    "引導文字要依那張工作表是否存在而定",
  );
  assert.match(source, /沒有任何調查資料；請確認上方的季度、日別與調查點篩選/);
});

/* ── L4：同名調查點 ── */

test("兩個調查點同名時匯出的下拉與 SUMIFS 不可重複計算", () => {
  /*
   * 匯出檔的下拉選單與 SUMIFS 是用「名稱」對應到輔助列的，
   * 兩個 roadId 同名就會 match 到兩列、把兩者的量加在一起，
   * 選單裡也會出現兩個一模一樣的選項。系統不強制名稱唯一
   *（同一條路分段調查時本來就可能同名），所以只在真的重複時補上編號。
   */
  const block = blockFrom("const roadExportLabels = useMemo(", "}, [roadOptions]);");
  assert.match(block, /count\.get\(roadName\) \?\? 0\) > 1/, "只在名稱重複時才加註");
  assert.match(block, /`\$\{roadName\}（\$\{roadId\}）`/);
  /* 下拉清單與 SUMIFS 的輔助列必須用同一組標籤，否則會對不到 */
  assert.match(source, /roadExportLabels\.get\(roadId\) \?\? name/);
  assert.match(source, /roadExportLabels\.get\(roadId\) \?\? roadName/);
});

/* ── 季度：民國與西元都收，但一律存成民國年 ── */

test("季度一律以民國年寫法寫入", async () => {
  /*
   * 這個輸入框從以前就同時接受 115Q2 與 2026Q2（提示文字就是這樣寫的），
   * 但**照打的字原樣存下去**：季度清單是 `[...new Set(records.map(r => r.quarter))]`，
   * 於是 115Q1 與 2026Q1 會並列成兩季、歷季趨勢被拆成兩段，而且永遠不會
   * 合併——兩者的排序鍵完全相同（都是 461），所以會相鄰出現，
   * 看起來只像「同一季出現兩次」，很難聯想到是寫法問題。
   */
  const { normalizeSurveyPeriod } = await import("../app/period-date.ts");
  assert.equal(normalizeSurveyPeriod("2026Q1"), "115Q1");
  assert.equal(normalizeSurveyPeriod("115Q1"), "115Q1");
  assert.equal(normalizeSurveyPeriod("2025Q4"), "114Q4");
  assert.equal(normalizeSurveyPeriod("abc"), "abc", "認不得的原樣回傳，由格式驗證去擋");

  /* 所有消費端都要用正規化後的鍵，只有輸入框本身顯示使用者打的字 */
  assert.match(source, /const importQuarterKey = useMemo\(/);
  assert.match(source, /normalizeSurveyPeriod\(importQuarter\)/);
  for (const consumer of [
    "parseTrafficSheetValues(values, dt, importQuarterKey",
    'form.append("quarter", importQuarterKey)',
    "quarter: importQuarterKey",
    "setQuarter(importQuarterKey)",
    "workflow.statuses[importQuarterKey]",
  ])
    assert.ok(source.includes(consumer), `消費端仍在用未正規化的值：${consumer}`);
  /* 輸入框要當場告訴使用者會存成什麼 */
  assert.match(source, /將存成「\{importQuarterKey\}」/);
  /* 季度管理的重新命名也是寫入路徑，不能只修匯入對話框。 */
  const renameBlock = blockFrom(
    "async function renameQuarter(",
    "async function refreshRoadAliases",
  );
  /*
   * v20.40 起改走共用的 checkSurveyPeriodInput()——它比原本的
   * normalizeSurveyPeriod()＋形狀正規式多擋一件事：換算窗口外的四碼年份。
   * 這裡釘的是「改名一定要經過正規化後的鍵」，不釘實作用哪一支函式。
   */
  assert.match(renameBlock, /checkSurveyPeriodInput\(rawNext\)/);
  assert.match(renameBlock, /const next = renameCheck\.key/);
  assert.match(renameBlock, /newQuarter: next/);
  assert.match(renameBlock, /normalizeSurveyPeriod\(item\) === next/);
});

/* ── L5：.xlsm 三支一致 ── */

test("要接受 .xlsm（啟用巨集的活頁簿）", () => {
  /*
   * 路口轉向與交通服務水準的檔案選取框都收 .xlsm，交通服務水準的說明文字
   * 還明寫「支援 .xls、.xlsx、.xlsm」，只有本系統擋掉並回「不是支援的
   * Excel 檔案」。SheetJS 讀 .xlsm 與 .xlsx 走同一條路徑。
   */
  assert.doesNotMatch(
    source,
    /!\/\\\.xlsx\?\$\/i\.test\(file\.name\)/,
    "副檔名檢查仍會擋掉 .xlsm",
  );
  assert.match(source, /!\/\\\.\(xlsx\?\|xlsm\)\$\/i\.test\(file\.name\)/);
  assert.match(source, /accept="\.xls,\.xlsx,\.xlsm"/);
  assert.doesNotMatch(
    source,
    /accept="\.xls,\.xlsx"(?!,)/,
    "檔案選取框仍未開放 .xlsm",
  );
});

test("既有資料用另一種寫法存過同一季時，要擋下並說清楚", () => {
  /*
   * v20.39 以前季度是照使用者打的字原樣存的，而匯入框的預設值曾經是**西元
   * 寫法**（2026Q3），所以既有資料裡可能已經有 2026Q3。改成一律存民國年之後
   * 若不擋，同一季會同時存在 2026Q3 與 115Q3 兩個鍵——它們的排序鍵完全相同，
   * 會在季度清單裡相鄰出現，看起來只像「同一季出現兩次」，
   * 但歷季趨勢已經被拆成兩段而且永遠不會合併。
   */
  assert.match(source, /const clashing = quarters\.find\(/);
  assert.match(source, /normalizeSurveyPeriod\(q\) === importQuarterKey/);
  assert.match(source, /是同一季，只是寫法不同/);
  /* 預設值本身也要是民國年寫法，否則新使用者一開始就踩進去 */
  assert.doesNotMatch(
    source,
    /useState\("2026Q3"\)/,
    "匯入季度的預設值仍是西元寫法",
  );
  assert.match(source, /const \[importQuarter, setImportQuarter\] = useState\("115Q3"\)/);
});

/* ── 民國／西元顯示切換 ── */

test("quarterInYearStyle 兩種寫法可以互轉，且不動到認不得的字串", async () => {
  const { quarterInYearStyle } = await import("../app/period-date.ts");
  for (const [roc, ad] of [
    ["115Q1", "2026Q1"],
    ["114Q4", "2025Q4"],
    ["100Q3", "2011Q3"],
    ["113Q2", "2024Q2"],
  ]) {
    assert.equal(quarterInYearStyle(roc, "ad"), ad, `${roc} → 西元`);
    assert.equal(quarterInYearStyle(ad, "roc"), roc, `${ad} → 民國`);
    /* 來回一趟要回到原點，否則切兩次畫面就對不上了 */
    assert.equal(quarterInYearStyle(quarterInYearStyle(roc, "ad"), "roc"), roc);
  }
  for (const odd of ["", "115", "115Q5", "115年2、3月", "abc"])
    assert.equal(quarterInYearStyle(odd, "ad"), odd, `「${odd}」不可被改寫`);
});

test("periodDisplayLabel 的月份寫法也跟著年份切換，不傳就維持舊行為", async () => {
  const { periodDisplayLabel } = await import("../app/period-date.ts");
  const dates = ["2026-02-11", "2026-03-04"];
  assert.equal(periodDisplayLabel("115Q1", dates, "month", "roc"), "115年2、3月");
  assert.equal(periodDisplayLabel("115Q1", dates, "month", "ad"), "2026年2、3月");
  assert.equal(periodDisplayLabel("115Q1", [], "month", "ad"), "2026Q1");
  assert.equal(periodDisplayLabel("115Q1", dates, "month"), "115年2、3月");
  assert.equal(periodDisplayLabel("115Q1", [], "quarter"), "115Q1");
});

test("切換鈕存在，而且季度選單的值一律是儲存值", () => {
  assert.match(source, /data-testid="year-style-toggle"/, "要有年份顯示切換鈕");
  assert.match(source, /useState<YearStyle>\("roc"\)/, "預設是民國年");
  assert.match(
    source,
    /const showQuarter = \(value: string\) => quarterInYearStyle\(value, yearStyle\)/,
  );
  /*
   * <option> 的 value 一定要是儲存的季度。文字換成西元年、值也跟著換的話，
   * 結論草稿的單季條件（row.quarter === scope.quarter 是直接比字串的）
   * 立刻變成「所選條件沒有對應的資料」。
   */
  assert.equal(
    source.match(/<option key=\{q\}(?! value=\{q\})/g),
    null,
    "有季度選單沒有明寫 value={q}，切成西元年之後篩選會落空",
  );
  /* 沒有任何一處還把季度原樣印出來 */
  assert.doesNotMatch(
    source,
    /<option key=\{q\} value=\{q\}>\s*\n\s*\{q\}\s*\n/,
    "仍有季度選單直接印出儲存值，切換後與表格不一致",
  );
  /*
   * 反面也要擋：把顯示文字塞進 value 或 key 一樣會讓篩選落空。
   * 只檢查「value={q}」還不夠——寫成 value={showQuarter(q)} 就繞過去了。
   */
  assert.doesNotMatch(
    source,
    /<option[^>]*(?:key|value)=\{(?:props\.)?showQuarter\(/,
    "季度選單的 key／value 不可以是顯示文字",
  );
});

test("匯出的季度欄一律走 showQuarter，沒有一處漏掉", () => {
  /*
   * 這一項是自己抓出來的：v20.39 第一輪只改了歷季那一張表，
   * 同一支匯出函式裡的「路段明細」與「路口明細」兩張表仍寫 `季度: quarter`，
   * 於是同一個 .xlsx 裡三張工作表會出現兩種年份寫法。
   */
  assert.equal(
    (source.match(/季度: quarter,/g) ?? []).length,
    0,
    "仍有匯出表直接寫儲存的季度",
  );
  assert.ok(
    (source.match(/季度: showQuarter\(/g) ?? []).length >= 3,
    "三張匯出表的季度欄都要走 showQuarter",
  );
});

test("結論草稿的換字是可選的，不傳就維持舊輸出；篩選與數字完全不變", async () => {
  const src = await readFile(new URL("../app/conclusion.ts", import.meta.url), "utf8");
  assert.match(src, /showQuarter\?: \(quarter: string\) => string;/, "showQuarter 要是可選的");
  assert.match(src, /typeof meta\.showQuarter === "function"/);
  /* 篩選與排序絕對不可以改成顯示值 */
  assert.match(src, /quarterKey\(a\)\s*-\s*quarterKey\(b\)/);

  /*
   * 實際跑一遍。三種分段方式都要跑到：季度是從好幾條不同的路徑寫出來的
   *（scopeLabel、統計範圍、〔季度〕小標、季度分段標題、代表列、季度變動），
   * 只跑預設的分段會漏掉其中一半——漏掉的那幾條就會在畫面上出現
   *「2026Q1 的表、115Q1 的內文」這種前後不一致。
   */
  const { buildConclusion, DEFAULT_CONDITION } = await import("../app/conclusion.ts");
  const { row, CONCLUSION_META } = await import("./helpers/conclusion-row.mjs");
  const rows = [row({ quarter: "115Q1" }), row({ quarter: "114Q4" })];
  const show = (q) => (q === "115Q1" ? "2026Q1" : q === "114Q4" ? "2025Q4" : q);
  for (const grouping of ["byRoad", "byQuarter", "overall"])
    for (const scope of [
      { kind: "quarter", quarter: "115Q1" },
      { kind: "range", from: "114Q4", to: "115Q1" },
      { kind: "project" },
    ]) {
      const condition = {
        ...DEFAULT_CONDITION,
        grouping,
        scope,
        metrics: [...new Set([...DEFAULT_CONDITION.metrics, "growth", "extremes"])],
      };
      const roc = buildConclusion(rows, condition, CONCLUSION_META);
      const ad = buildConclusion(rows, condition, { ...CONCLUSION_META, showQuarter: show });
      const where = `${grouping}／${scope.kind}`;
      assert.doesNotMatch(roc, /所選條件沒有對應的資料/, `${where}：民國年寫法要挑得到資料`);
      assert.doesNotMatch(ad, /所選條件沒有對應的資料/, `${where}：換寫法仍要挑到同一批資料`);
      assert.ok(/11[45]Q[1-4]/.test(roc), `${where}：民國年版本本來就該出現季度字樣`);
      assert.doesNotMatch(ad, /11[45]Q[1-4]/, `${where}：草稿上不應再出現民國年寫法`);
      assert.match(ad, /20(?:25|26)Q[1-4]/, `${where}：草稿上要寫西元年`);
      assert.equal(
        ad.replaceAll("2026Q1", "115Q1").replaceAll("2025Q4", "114Q4"),
        roc,
        `${where}：換寫法之後除了季度字樣以外必須逐字相同（數字不可以有任何變化）`,
      );
    }
});

/* ── 季度輸入的最終把關（v20.40） ── */

test("超出換算範圍的四碼年份不得原樣存成季度鍵", async () => {
  /*
   * normalizeSurveyPeriod() 只在民國 90～200（西元 2001～2111）這個窗口內換算，
   * 窗口外的四碼年份會原樣回傳。舊版的寫入路徑只做形狀檢查
   * /^(?:\d{3}|\d{4})Q[1-4]$/，於是 2112Q3 通過並被原樣存入——它和 201Q3 是
   * 同一季，排序鍵還完全相同（實測都是 807），畫面上只看得出「同一季出現兩次」。
   */
  const { checkSurveyPeriodInput, normalizeSurveyPeriod } = await import(
    "../app/period-date.ts"
  );
  const { quarterOrderKey } = await import("../app/final-workflow.ts");

  for (const [roc, ad] of [["201Q3", "2112Q3"], ["89Q1", "2000Q1"], ["79Q2", "1990Q2"]]) {
    /* 先證明問題確實存在：兩者是同一季、排序鍵相同，但正規化併不起來 */
    assert.equal(quarterOrderKey(roc), quarterOrderKey(ad), `${roc} 與 ${ad} 是同一季`);
    assert.notEqual(normalizeSurveyPeriod(ad), roc, "正規化窗口外，併不起來");
    /* 所以寫入必須擋下來 */
    const check = checkSurveyPeriodInput(ad);
    assert.equal(check.ok, false, `${ad} 不可以寫入`);
    assert.equal(check.reason, "range");
    const rocCheck = checkSurveyPeriodInput(roc);
    assert.equal(rocCheck.ok, false, `${roc} 也在允許的民國年範圍外`);
    assert.equal(rocCheck.reason, "range");
  }
  for (const bad of ["201Q1", "999Q4", "00Q1"])
    assert.equal(checkSurveyPeriodInput(bad).ok, false, `${bad} 不可以只因長得像季度就通過`);
  /* 窗口內的一律放行並換成民國年 */
  for (const [roc, ad] of [["115Q1", "2026Q1"], ["114Q4", "2025Q4"], ["100Q3", "2011Q3"]]) {
    for (const input of [roc, ad]) {
      const check = checkSurveyPeriodInput(input);
      assert.equal(check.ok, true, `${input} 應放行`);
      assert.equal(check.key, roc, `${input} 應存成 ${roc}`);
    }
  }
});

test("民國兩碼年份是合法寫法，不得被輸入檢查擋掉", async () => {
  /*
   * 民國 99 年＝西元 2010。排序鍵、正規化與 Excel 排序一直都認得兩碼，
   * 只有寫入路徑的形狀檢查是 3～4 碼，於是有 99 年資料的人反而打不進去，
   * 舊備份裡的 99 年資料也會在還原時被靜靜濾掉。
   */
  const { checkSurveyPeriodInput } = await import("../app/period-date.ts");
  for (const q of ["99Q4", "99Q1", "90Q2"]) {
    const check = checkSurveyPeriodInput(q);
    assert.equal(check.ok, true, `${q} 應放行`);
    assert.equal(check.key, q);
  }
  assert.equal(checkSurveyPeriodInput("2010Q4").key, "99Q4", "西元 2010 應換成民國 99");
  /* 真正的壞格式仍要擋 */
  for (const bad of ["115Q5", "115", "abc", "", "115Q", "Q1"])
    assert.equal(checkSurveyPeriodInput(bad).ok, false, `「${bad}」應擋下`);
});

test("寫入路徑一律走共用檢查，不得再用形狀正規式", () => {
  assert.doesNotMatch(
    source,
    /\/\^\(\?:\\d\{3\}\|\\d\{4\}\)Q\[1-4\]\$\//,
    "仍有寫入路徑在用只看形狀的正規式（會放行 2112Q3、擋掉 99Q4）",
  );
  assert.match(source, /const periodCheck = checkSurveyPeriodInput\(importQuarter\)/);
  assert.match(source, /const renameCheck = checkSurveyPeriodInput\(rawNext\)/);
  assert.match(source, /const badQuarterIndex = payload\.records\.findIndex/);
});

test("平假日比較圖表的 cache 對「本季未調查」要寫 null，不可寫 0", () => {
  /*
   * 資料表那一格已經是空白（M4），但圖表的 numCache 若寫 0，
   * 不重算 cache 的檢視器會畫出一根 0 的長條——同一份檔案裡表是空白、圖是 0。
   */
  assert.match(source, /r\.weekdaySurveyed \? r\.weekdayActual : null/);
  assert.match(source, /r\.holidaySurveyed \? r\.holidayActual : null/);
  assert.doesNotMatch(
    source,
    /cache: dayComparisons\.map\(\(r\) => r\.(weekday|holiday)Actual\)/,
    "圖表 cache 仍直接寫值，未調查的日別會變成 0",
  );
  /* chartXml 必須把 null 略過（否則寫 null 反而壞掉） */
  assert.match(source, /v === null \|\| v === undefined \|\| !Number\.isFinite\(Number\(v\)\)/);
});

test("備份季度要正規化後才寫回，且壞季度不得被靜靜濾掉", () => {
  assert.match(source, /const badQuarterIndex = payload\.records\.findIndex/);
  assert.match(source, /備份檔第 \$\{badQuarterIndex \+ 1\} 筆資料的季度/);
  assert.match(source, /quarter: check\.ok \? check\.key/);
  assert.doesNotMatch(
    source,
    /\.filter\(\(r\) => checkSurveyPeriodInput\(r\.quarter\)\.ok\)/,
    "混有壞季度的備份不可只還原其中一部分",
  );
  assert.match(source, /const existingQuarterByKey = new Map/);
  assert.match(source, /和備份中的「\$\{alternateWriting\}」是同一季、但寫法不同/);
});

/* ── 三支共用的季度輸入行為契約 ── */

test("季度輸入把關必須完全符合三支共用的行為契約", async () => {
  /*
   * 上一輪三支的 checkSurveyPeriodInput() 被改成三種不同寫法，而三支的守門
   * 測試都只驗自己那一份，所以沒有任何一支看得到分歧。這裡改成跑共用契約：
   * 契約檔在三支裡逐位元相同，任何一支的實作漂掉，就是它自己的測試紅。
   */
  const { runContract, CASES } = await import("./period-input-contract.mjs");
  const { checkSurveyPeriodInput, normalizeSurveyPeriod } = await import(
    "../app/period-date.ts"
  );
  assert.ok(CASES.length >= 50, "契約案例數異常，檔案可能被截斷");
  const problems = runContract(checkSurveyPeriodInput, normalizeSurveyPeriod);
  assert.deepEqual(problems, [], "與共用行為契約不符：\n" + problems.join("\n"));
});

test("行為契約檔本身必須與另外兩支逐位元相同", async () => {
  /*
   * 三支各自釘同一個 SHA-256。只改一支的契約檔，那一支就會紅；
   * 要改行為就得三支的契約檔一起改、雜湊一起換——這正是我們要的。
   * 用雜湊而不是跨包引用檔案，交付包才能解壓後獨立執行。
   */
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(new URL("./period-input-contract.mjs", import.meta.url));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    "638f2b48ed3d7e24e7c605314eb2149f3cc5c07865f69a99d8c767a52945fe75",
    "行為契約檔與另外兩支不同步；三支必須是同一份檔案",
  );
});
