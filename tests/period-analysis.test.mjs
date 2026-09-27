import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPeriodExportSheets,
  buildPeriodRows,
  defaultPeriodExportSelection,
  hourStartOf,
  metricUnitFor,
  noonStraddleKey,
  normalizePeriodExportSelection,
  periodCellValue,
  shareOf,
} from "../app/period-analysis.ts";

const core = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const coreTurns = Object.fromEntries(
  Object.keys(core).map((key) => [key, { left: core[key], through: core[key], right: core[key] }]),
);
const factors = { core, coreTurns, settings: [] };

function roadRow(hour, directionCode, counts) {
  return {
    projectId: "P1",
    quarter: "2026Q1",
    roadId: "R1",
    roadName: "中山路",
    dayType: "平日",
    directionCode,
    directionName: directionCode === "A" ? "往北" : "往南",
    hour,
    surveyType: "road",
    motorcycle: counts.motorcycle ?? 0,
    small: counts.small ?? 0,
    large: counts.large ?? 0,
    special: counts.special ?? 0,
    vehicleCounts: counts,
    vehicleLabels: {
      motorcycle: "機車",
      small: "小型車",
      large: "大型車",
      special: "特種車",
      "custom:聯結車": "聯結車",
    },
  };
}

test("時段字串可解析出起始小時", () => {
  assert.equal(hourStartOf("07:00～08:00"), 7);
  assert.equal(hourStartOf("07:00-08:00"), 7);
  assert.equal(hourStartOf("00:00～01:00"), 0);
  assert.equal(hourStartOf("23:00～00:00"), 23);
  assert.equal(hourStartOf("不是時間"), -1);
});

test("上午尖峰只看12點前、下午尖峰只看12點後，且以PCU判定", () => {
  const rows = buildPeriodRows(
    [
      // 08:00 機車多但 PCU 較低
      roadRow("08:00～09:00", "A", { motorcycle: 400, small: 100 }), // PCU 300
      roadRow("09:00～10:00", "A", { motorcycle: 100, small: 300 }), // PCU 350 ← 上午尖峰
      roadRow("13:00～14:00", "A", { motorcycle: 100, small: 100 }), // PCU 150
      roadRow("18:00～19:00", "A", { motorcycle: 200, small: 500 }), // PCU 600 ← 下午＋全調查時段尖峰
    ],
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.equal(combined.periods.am.hour, "09:00～10:00");
  assert.equal(combined.periods.am.pcu, 350);
  assert.equal(combined.periods.pm.hour, "18:00～19:00");
  assert.equal(combined.periods.pm.pcu, 600);
  assert.equal(combined.periods.allPeak.hour, "18:00～19:00");
  // 這份測資只有 4 個小時，「全日」欄位就必須說清楚是實測 4 小時，
  // 不能一律寫成 24 小時讓人誤以為是完整全日量。
  assert.equal(combined.periods.all.hour, "實測 4 小時（非 24 小時）");
  assert.equal(combined.periods.all.total, 400 + 100 + 100 + 300 + 100 + 100 + 200 + 500);
  assert.equal(combined.periods.all.pcu, 300 + 350 + 150 + 600);
});

test("混用 15 分鐘與 60 分鐘時間格時，全日欄位的時數要算對", () => {
  // 07:00~11:00 每小時一列（4 小時）＋ 17:00~19:00 每 15 分鐘一列（2 小時）＝ 6 小時。
  // 舊寫法用「格數 × 眾數格長」推估，會算成 12 格 × 15 分 = 3 小時。
  const hourly = [7, 8, 9, 10].map((h) =>
    roadRow(`${String(h).padStart(2, "0")}:00～${String(h + 1).padStart(2, "0")}:00`, "A", {
      small: 100,
    }),
  );
  const quarterly = [];
  for (let minute = 17 * 60; minute < 19 * 60; minute += 15) {
    const to = minute + 15;
    const label = (v) =>
      `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
    quarterly.push(roadRow(`${label(minute)}～${label(to)}`, "A", { small: 25 }));
  }
  const rows = buildPeriodRows([...hourly, ...quarterly], { factors });
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(combined.periods.all.hour, "實測 6 小時（非 24 小時）");
});

test("完整 24 小時調查的全日欄位仍標示為 24 小時", () => {
  const rows = buildPeriodRows(
    Array.from({ length: 24 }, (_, hour) =>
      roadRow(
        `${String(hour).padStart(2, "0")}:00～${String((hour + 1) % 24).padStart(2, "0")}:00`,
        "A",
        { small: 100 },
      ),
    ),
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(combined.periods.all.hour, "24 小時");
});

const SPLIT_PEAK_ROWS = [
  roadRow("07:00～08:00", "A", { small: 500 }),
  roadRow("10:00～11:00", "A", { small: 100 }),
  roadRow("07:00～08:00", "B", { small: 100 }),
  roadRow("10:00～11:00", "B", { small: 400 }),
];

test("預設：整個調查點取同一個尖峰時段，各方向相加等於合計", () => {
  const rows = buildPeriodRows(SPLIT_PEAK_ROWS, { factors });
  const a = rows.find((row) => row.scopeCode === "A");
  const b = rows.find((row) => row.scopeCode === "B");
  const all = rows.find((row) => row.scopeCode === "ALL");
  // 合計列：07 時合計 600 > 10 時合計 500，所以路口整體的上午尖峰是 07:00～08:00
  assert.equal(all.periods.am.hour, "07:00～08:00");
  assert.equal(all.periods.am.pcu, 600);
  // 兩個方向都必須報同一個時段，即使 B 自己最忙的是 10 時
  assert.equal(a.periods.am.hour, "07:00～08:00");
  assert.equal(b.periods.am.hour, "07:00～08:00");
  assert.equal(a.periods.am.pcu, 500);
  assert.equal(b.periods.am.pcu, 100);
  // 這才是重點：各方向相加要等於合計，否則那一欄不能拿來對報表
  assert.equal(a.periods.am.pcu + b.periods.am.pcu, all.periods.am.pcu);
  assert.equal(a.scopeName, "往北");
  assert.equal(all.scopeName, "雙向合計");
});

test("peakScope: \"direction\" 時，每個方向各自認定自己的尖峰小時", () => {
  const rows = buildPeriodRows(SPLIT_PEAK_ROWS, {
    factors,
    peakScope: "direction",
  });
  const a = rows.find((row) => row.scopeCode === "A");
  const b = rows.find((row) => row.scopeCode === "B");
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(a.periods.am.hour, "07:00～08:00");
  assert.equal(b.periods.am.hour, "10:00～11:00");
  assert.equal(all.periods.am.hour, "07:00～08:00");
  assert.equal(all.periods.am.pcu, 600);
  // 各自認定時，各方向相加會大於合計（500 + 400 > 600），所以不可相加
  assert.ok(a.periods.am.pcu + b.periods.am.pcu > all.periods.am.pcu);
});

test("百分比以車輛數為基準且四種車以外的新增車種一併計算", () => {
  const settings = [
    {
      projectId: "P1",
      sourceKey: "custom:聯結車",
      sourceLabel: "聯結車",
      targetKey: "custom:聯結車",
      targetLabel: "聯結車",
      roadPcu: 3,
      turnPcu: { left: 3, through: 3, right: 3 },
    },
  ];
  const rows = buildPeriodRows(
    [roadRow("08:00～09:00", "A", { motorcycle: 50, small: 30, "custom:聯結車": 20 })],
    { factors: { core, coreTurns, settings } },
  );
  const cell = rows.find((row) => row.scopeCode === "ALL").periods.all;
  assert.equal(cell.total, 100);
  assert.equal(shareOf(cell, "motorcycle"), 50);
  assert.equal(shareOf(cell, "custom:聯結車"), 20);
  assert.equal(cell.vehiclePcu["custom:聯結車"], 60);
  assert.equal(cell.pcu, 50 * 0.5 + 30 * 1 + 20 * 3);
  assert.equal(periodCellValue(cell, "small", "count"), 30);
  assert.equal(periodCellValue(cell, "small", "pcu"), 30);
  assert.equal(periodCellValue(cell, "small", "share"), 30);
});

test("路口格式以轉向係數計算各車種PCU", () => {
  const turnFactors = {
    core,
    coreTurns: {
      motorcycle: { left: 0.43, through: 0.42, right: 0.45 },
      small: { left: 1.05, through: 1, right: 1.08 },
      large: { left: 2, through: 1.8, right: 2.7 },
      special: { left: 2.5, through: 2.5, right: 2.5 },
    },
    settings: [],
  };
  const record = {
    projectId: "P1",
    roadId: "X1",
    roadName: "中正路口",
    dayType: "平日",
    directionCode: "A",
    directionName: "駛入路口A",
    hour: "08:00～09:00",
    surveyType: "intersection",
    motorcycle: 300,
    small: 100,
    large: 0,
    special: 0,
    vehicleCounts: { motorcycle: 300, small: 100 },
    vehicleLabels: { motorcycle: "機車", small: "小型車" },
    turnData: {
      motorcycle: { left: 100, through: 100, right: 100 },
      small: { left: 20, through: 60, right: 20 },
    },
  };
  const rows = buildPeriodRows([record], { factors: turnFactors });
  const cell = rows.find((row) => row.scopeCode === "A").periods.am;
  assert.equal(rows.find((row) => row.scopeCode === "A").scopeName, "駛入路口A");
  assert.equal(Number(cell.vehiclePcu.motorcycle.toFixed(2)), 130);
  assert.equal(Number(cell.vehiclePcu.small.toFixed(2)), 102.6);
  assert.equal(cell.total, 400);
});

test("沒有上午資料時上午尖峰為空白而不是誤抓下午", () => {
  const rows = buildPeriodRows([roadRow("15:00～16:00", "A", { small: 10 })], { factors });
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(all.periods.am.hour, "—");
  assert.equal(all.periods.am.hasData, false);
  assert.equal(all.periods.am.total, 0);
  assert.equal(all.periods.pm.hour, "15:00～16:00");
});

/*
 * ⚠️ 這一條 2026-09-16 **反轉**了（X-18）。
 *
 * 舊版斷言的是「兩天併成一列」的結果：
 *   ・all.periods.am.pcu === 400  → 在兩天的格子裡挑最大的那一個
 *     （看起來像**只顯示假日**）
 *   ・all.periods.all.pcu === 500 → 把兩天**加起來**
 *     （得到一個不存在的「日交通量」）
 * 使用者 2026-09-16 實測回報的就是這兩個症狀：
 *   「這張表僅有在平日+假日條件下，變成了數字加總或僅顯示某一天做為替代」。
 *
 * 專案通則（檢查規則.md「A＋B 一律並列」）：平日＋假日要**一天一列**。
 * ⚠️ 不可以把這一條改回去：改回去就是把使用者回報的那個錯又寫成規格。
 */
test("平日＋假日：一天一列，各自算自己的尖峰與全調查時段", () => {
  const weekday = roadRow("08:00～09:00", "A", { small: 100 });
  const holiday = { ...roadRow("08:00～09:00", "A", { small: 400 }), dayType: "假日" };
  const rows = buildPeriodRows([weekday, holiday], { factors, separateDays: true });
  const allRows = rows.filter((row) => row.scopeCode === "ALL");
  assert.equal(allRows.length, 2, "平日與假日要各成一列");
  const weekdayRow = allRows.find((row) => row.dayType === "平日");
  const holidayRow = allRows.find((row) => row.dayType === "假日");
  assert.ok(weekdayRow && holidayRow, "兩列都要帶著自己的日別");
  /* 各自算自己的：不加總、也不互相取代。 */
  assert.equal(weekdayRow.periods.am.pcu, 100);
  assert.equal(weekdayRow.periods.all.pcu, 100);
  assert.equal(holidayRow.periods.am.pcu, 400);
  assert.equal(holidayRow.periods.all.pcu, 400);
  /* 時段標籤仍要寫出是哪一天（同一張表上兩列的標籤不可以一模一樣）。 */
  assert.equal(weekdayRow.periods.am.hour, "平日 08:00～09:00");
  assert.equal(holidayRow.periods.am.hour, "假日 08:00～09:00");
});

/* 單一日別時**一個數字都不可以動**（升級當天的差異只能出現在平日＋假日）。 */
test("單一日別：行為與升級前逐格相同（一列、不帶日別）", () => {
  const rows = buildPeriodRows(
    [
      roadRow("08:00～09:00", "A", { small: 100 }),
      roadRow("18:00～19:00", "A", { small: 300 }),
    ],
    { factors },
  );
  const allRows = rows.filter((row) => row.scopeCode === "ALL");
  assert.equal(allRows.length, 1);
  assert.equal(allRows[0].dayType, undefined);
  assert.equal(allRows[0].periods.all.pcu, 400);
  assert.equal(allRows[0].periods.am.pcu, 100);
  assert.equal(allRows[0].periods.pm.pcu, 300);
});

test("匯出結構依勾選的時段／方向／指標動態產生", () => {
  const rows = buildPeriodRows(
    [
      roadRow("08:00～09:00", "A", { motorcycle: 100, small: 100 }),
      roadRow("18:00～19:00", "B", { motorcycle: 200, small: 100 }),
    ],
    { factors },
  );
  const catalog = [
    { key: "motorcycle", label: "機車" },
    { key: "small", label: "小型車" },
  ];
  const sheets = buildPeriodExportSheets(
    rows,
    catalog,
    {
      enabled: true,
      periods: ["am", "pm"],
      scopes: ["A", "B"],
      metrics: ["count", "share"],
      sheetPerPeriod: true,
    },
    { flowLabel: "駛入" },
  );
  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    ["上午尖峰小時車種分析", "下午尖峰小時車種分析"],
  );
  assert.deepEqual(sheets[0].headers, [
    "調查點編號",
    "調查點名稱",
    "資料格式",
    "方向／支線",
    "分析時段",
    "機車車輛數（輛/hr）",
    "小型車車輛數（輛/hr）",
    "機車百分比（%）",
    "小型車百分比（%）",
  ]);
  // 只勾 A、B 兩個方向，合計列不應出現
  assert.equal(sheets[0].rows.length, 2);
  assert.deepEqual(sheets[0].rows[0].slice(0, 5), ["R1", "中山路", "路段", "往北", "08:00～09:00"]);

  const single = buildPeriodExportSheets(
    rows,
    catalog,
    {
      enabled: true,
      periods: ["all"],
      scopes: [],
      metrics: ["pcu"],
      sheetPerPeriod: false,
    },
    { flowLabel: "駛入" },
  );
  assert.equal(single.length, 1);
  assert.equal(single[0].name, "時段車種分析");
  assert.equal(single[0].rows.length, 3); // 合計 + A + B
});

test("報表範本設定可安全還原舊版或損壞資料", () => {
  const fallback = normalizePeriodExportSelection(undefined);
  assert.deepEqual(fallback.periods, ["all", "am", "pm"]);
  assert.deepEqual(fallback.metrics, ["count", "share", "pcu"]);
  const restored = normalizePeriodExportSelection({
    enabled: false,
    periods: ["am", "壞資料"],
    metrics: [],
    scopes: ["A"],
    sheetPerPeriod: false,
  });
  assert.equal(restored.enabled, false);
  assert.deepEqual(restored.periods, ["am"]);
  assert.deepEqual(restored.metrics, ["count", "share", "pcu"]);
  assert.deepEqual(restored.scopes, ["A"]);
  assert.equal(restored.sheetPerPeriod, false);
});

test("全日欄位的單位是每日，尖峰欄位才是每小時", () => {
  assert.equal(metricUnitFor("pcu", "all"), "PCU/日");
  assert.equal(metricUnitFor("count", "all"), "輛/日");
  assert.equal(metricUnitFor("pcu", "am"), "PCU/hr");
  assert.equal(metricUnitFor("count", "allPeak"), "輛/hr");
  assert.equal(metricUnitFor("share", "all"), "%");
  const sheets = buildPeriodExportSheets(
    buildPeriodRows([roadRow("08:00～09:00", "A", { small: 100 })], { factors }),
    [{ key: "small", label: "小型車" }],
    { enabled: true, periods: ["all", "am"], scopes: [], metrics: ["pcu"], sheetPerPeriod: true },
    { flowLabel: "駛入" },
  );
  /*
   * 這個 fixture 只有 1 小時的資料，所以「全日」那一欄的正確單位是
   * PCU/調查時段，不是 PCU/日——1 小時的量不是一整天的量。
   * 舊版欄名用 metricUnitFor（只看整批的 partial 旗標），會把它標成 PCU/日；
   * 現在改用 cellUnitFor 逐欄依實際時段標籤決定。
   */
  assert.ok(
    sheets[0].headers.some((h) => h.includes("（PCU/調查時段）")),
    sheets[0].headers.join(","),
  );
  assert.ok(sheets[1].headers.some((h) => h.includes("（PCU/hr）")), sheets[1].headers.join(","));
});

test("完整 24 小時的資料，全日欄位才標成 PCU/日", () => {
  const hours = Array.from({ length: 24 }, (_, i) =>
    roadRow(
      `${String(i).padStart(2, "0")}:00～${String((i + 1) % 24).padStart(2, "0")}:00`,
      "A",
      { small: 100 },
    ),
  );
  const sheets = buildPeriodExportSheets(
    buildPeriodRows(hours, { factors }),
    [{ key: "small", label: "小型車" }],
    { enabled: true, periods: ["all", "am"], scopes: [], metrics: ["pcu"], sheetPerPeriod: true },
    { flowLabel: "駛入" },
  );
  assert.ok(
    sheets[0].headers.some((h) => h.includes("（PCU/日）")),
    sheets[0].headers.join(","),
  );
  assert.ok(
    sheets[1].headers.some((h) => h.includes("（PCU/hr）")),
    sheets[1].headers.join(","),
  );
});

test("同一小時用不同分隔符寫也算同一個時段", () => {
  const rows = buildPeriodRows(
    [
      roadRow("08:00～09:00", "A", { small: 100 }),
      { ...roadRow("08:00~09:00", "B", { small: 90 }), directionName: "往南" },
    ],
    { factors },
  );
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(all.periods.allPeak.pcu, 190, "兩份檔案的同一小時要合併計算");
});

test("時段字串無法解析的資料不納入分析", () => {
  const rows = buildPeriodRows(
    [
      { ...roadRow("07:00～08:00", "A", { small: 10 }), hour: "全日" },
      roadRow("07:00～08:00", "A", { small: 10 }),
    ],
    { factors },
  );
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(all.periods.all.total, 10);
  assert.equal(all.periods.allPeak.hour, "07:00～08:00");
});

test("完全沒有車流時不會拿第一筆冒充尖峰", () => {
  const rows = buildPeriodRows(
    [roadRow("07:00～08:00", "A", { small: 0 }), roadRow("13:00～14:00", "A", { small: 0 })],
    { factors },
  );
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(all.periods.allPeak.hour, "—");
  assert.equal(all.periods.am.hour, "—");
  assert.equal(all.periods.pm.hour, "—");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K43（2026-09-24）：PCU 全為 0 要先當成異常，確認後才退回車輛數
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者定下的通則：
 *   「針對這類假設情況，你首先要判定的是**這是否為異常**，只有使用者確認
 *     不是異常情形，才套用你建議的處理方式，這個邏輯請你一定要懂」
 *
 * 在此之前，PCU 全為 0 時系統會**安靜地**改用車輛數挑尖峰。那會改變
 * 「尖峰是哪一小時」（機車多的時段車輛數高、PCU 低，兩者常常不是同一小時），
 * 而畫面與資料異常檢查一個字都沒提——使用者只會看到一個看起來很正常的時段，
 * 而且可以直接抄進報告。
 *
 * ⚠️ 這一組兩項要一起看：退回車輛數這個**處理方式本身保留**（第二項在守），
 *   改的只是「什麼時候才可以套用它」。只留第二項，等於改版沒發生；
 *   只留第一項，等於把一個有用的處理方式整個拿掉。
 */
const ZERO_FACTORS = {
  core: { motorcycle: 0, small: 0, large: 0, special: 0 },
  coreTurns,
  settings: [],
};
const ZERO_ROWS = [
  roadRow("07:00～08:00", "A", { small: 10 }),
  roadRow("09:00～10:00", "A", { small: 90 }),
];

test("⚠️ K43 未確認時：PCU 全為 0 的尖峰格寫「待設定 PCU 係數」，不給時段", () => {
  const cell = buildPeriodRows(ZERO_ROWS, { factors: ZERO_FACTORS }).find(
    (row) => row.scopeCode === "ALL",
  ).periods.am;
  assert.equal(cell.hour, "待設定 PCU 係數");
  assert.equal(cell.hasData, false, "要當成「沒有可用數值」，不是 0");
  assert.equal(cell.pcuUnset, true);
});

test("⚠️ K43 未確認時：「全調查時段」那一格照樣寫得出車輛數（不可以連它一起遮）", () => {
  /*
   * 遮掉它會讓使用者連「這一季到底有沒有資料」都看不出來。
   * 全調查時段是累計量，車輛數本身是對的。
   */
  const cell = buildPeriodRows(ZERO_ROWS, { factors: ZERO_FACTORS }).find(
    (row) => row.scopeCode === "ALL",
  ).periods.all;
  assert.equal(cell.total, 100);
  assert.equal(cell.hasData, true);
  assert.equal(cell.pcuUnset, true, "旗標仍要是 true，異常檢查才列得出來");
});

test("⚠️ K43 已確認之後：才改以車輛數判定尖峰（原本的處理方式保留）", () => {
  /*
   * ⚠️ 鍵值與 noonAnswers 同一套（`調查點|日別`），而且有同一個陷阱：
   *   `separateDays` 為 false 時，列本身不帶日別（state.dayType 是空字串），
   *   所以要查的是**共用鍵** `R1|`；分日別時才是 `R1|平日`。
   *   畫面層（DashboardClient）對 noonAnswers 就是兩個鍵都寫，這裡沿用同一個契約。
   *   只驗一種的話，真正在用的那一種可能是壞的而測試照樣綠。
   */
  const acked = (key) =>
    buildPeriodRows(ZERO_ROWS, {
      factors: ZERO_FACTORS,
      separateDays: key.endsWith("平日"),
      pcuUnsetConfirmed: { [key]: true },
    }).find((row) => row.scopeCode === "ALL").periods.am;

  const shared = acked(noonStraddleKey("R1", ""));
  assert.equal(shared.hour, "09:00～10:00", "不分日別時要吃共用鍵 R1|");
  assert.equal(shared.hasData, true);

  const perDay = acked(noonStraddleKey("R1", "平日"));
  /* 分日別時標籤本來就會帶日別前綴（「平日 09:00～10:00」），這不是遮罩。 */
  assert.equal(perDay.hour, "平日 09:00～10:00", "分日別時要吃 R1|平日");
  assert.equal(perDay.hasData, true);
});

test("⚠️ K43 不可以誤傷：PCU 正常時尖峰照舊，pcuUnset 為 false", () => {
  const cell = buildPeriodRows(ZERO_ROWS, { factors }).find(
    (row) => row.scopeCode === "ALL",
  ).periods.am;
  assert.equal(cell.hour, "09:00～10:00");
  assert.equal(cell.pcuUnset, false);
});

test("負的自訂 PCU 係數不可誤報為『PCU 係數全為 0』", () => {
  const negativeFactors = { core: { ...core, small: -1 }, coreTurns, settings: [] };
  const cell = buildPeriodRows([roadRow("07:00～08:00", "A", { small: 10 })], {
    factors: negativeFactors,
  }).find((row) => row.scopeCode === "ALL").periods.all;
  assert.equal(cell.pcu, -10);
  assert.equal(cell.pcuUnset, false);
  const peak = buildPeriodRows([roadRow("07:00～08:00", "A", { small: 10 })], {
    factors: negativeFactors,
  }).find((row) => row.scopeCode === "ALL").periods.allPeak;
  assert.notEqual(peak.hour, "待設定 PCU 係數");
});

test("正負 PCU 抵銷為零也不可誤報為所有係數都零", () => {
  const mixedFactors = { core: { ...core, large: -1 }, coreTurns, settings: [] };
  const cell = buildPeriodRows(
    [roadRow("07:00～08:00", "A", { small: 10, large: 10 })],
    { factors: mixedFactors },
  ).find((row) => row.scopeCode === "ALL").periods.all;
  assert.equal(cell.pcu, 0);
  assert.equal(cell.pcuUnset, false);
  const peak = buildPeriodRows(
    [roadRow("07:00～08:00", "A", { small: 10, large: 10 })],
    { factors: mixedFactors },
  ).find((row) => row.scopeCode === "ALL").periods.allPeak;
  assert.notEqual(peak.hour, "待設定 PCU 係數");
});

test("同名調查點的列會各自成群，合計列緊接著自己的方向", () => {
  const make = (roadId, code) => ({ ...roadRow("08:00～09:00", code, { small: 10 }), roadId, roadName: "同名路" });
  const rows = buildPeriodRows([make("R3", "A"), make("R1", "B"), make("R2", "A"), make("R1", "A")], { factors });
  assert.deepEqual(
    rows.map((row) => row.roadId + "/" + row.scopeCode),
    ["R1/ALL", "R1/A", "R1/B", "R2/ALL", "R2/A", "R3/ALL", "R3/A"],
  );
});

test("方向代碼剛好叫 ALL 時不會被重複計算", () => {
  const rows = buildPeriodRows([roadRow("08:00～09:00", "ALL", { small: 100 })], { factors });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].periods.all.total, 100);
});

test("非數值的車輛數不會讓 PCU 變成 NaN", () => {
  const record = roadRow("08:00～09:00", "A", { small: 5 });
  record.vehicleCounts = { small: "n/a", large: 5 };
  const rows = buildPeriodRows([record], { factors });
  const cell = rows.find((row) => row.scopeCode === "ALL").periods.all;
  assert.equal(Number.isNaN(cell.pcu), false);
  assert.equal(cell.pcu, 5 * 1.5);
});

test("匯出設定會保存尖峰時段認定與路口流量視角，且能被還原", () => {
  const base = defaultPeriodExportSelection();
  // 預設是「跟隨畫面上的設定」，維持既有行為
  assert.equal(base.peakScope, "follow");
  assert.equal(base.flowView, "follow");

  // 使用者指定的組合要能原樣存回
  const saved = normalizePeriodExportSelection({
    ...base,
    peakScope: "direction",
    flowView: "both",
    metrics: ["count", "pcu"],
  });
  assert.equal(saved.peakScope, "direction");
  assert.equal(saved.flowView, "both");
  assert.deepEqual(saved.metrics, ["count", "pcu"]);

  // 壞掉或舊版的範本（沒有這兩個欄位）要退回 follow，不能變成 undefined
  const legacy = normalizePeriodExportSelection({
    enabled: true,
    periods: ["am"],
    scopes: [],
    metrics: ["pcu"],
    sheetPerPeriod: true,
  });
  assert.equal(legacy.peakScope, "follow");
  assert.equal(legacy.flowView, "follow");
  const bogus = normalizePeriodExportSelection({ peakScope: "亂寫", flowView: 123 });
  assert.equal(bogus.peakScope, "follow");
  assert.equal(bogus.flowView, "follow");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 產品路徑上的「資料不足」（2026-09-25 第五輪獨立複查）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第五輪抓到兩件事，兩件都是「契約測試綠、產品行為相反」：
 *
 *  ① `tests/peak-hour-contract.test.mjs` 驗的是 `rollingPeak()`，
 *     而 **2 小時一格根本走不到 rollingPeak**——`subHourly` 的判準是
 *     「格距 > 0 且 < 60」，120 分鐘是 false，於是走 `peakBucket()`
 *     直接取那一格，把 2 小時的量放進尖峰欄。
 *     手冊、README 與更新說明三份文件都寫著 2 小時一格會得到「資料不足」。
 *  ② 湊不出一小時時，欄位標籤原本是「—」，而「—」在這個系統裡代表
 *     「這一格沒有資料」（手冊第 17 章）。同一個符號指兩件事。
 *
 * 所以這一支**從產品入口**（buildPeriodRows）驗，不是驗底層函式。
 */
test("⚠️ 2 小時一格：尖峰欄要「資料不足」，全調查時段照樣算得出來", () => {
  const rows = buildPeriodRows(
    [
      roadRow("07:00～09:00", "A", { motorcycle: 100, small: 100 }),
      roadRow("09:00～11:00", "A", { motorcycle: 100, small: 200 }),
      roadRow("15:00～17:00", "A", { motorcycle: 100, small: 300 }),
    ],
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined, "抓不到合計那一列");
  for (const key of ["allPeak", "am", "pm"])
    assert.equal(
      combined.periods[key].hour,
      "資料不足",
      `${key} 那一格寫的是「${combined.periods[key].hour}」——`
        + "2 小時一格湊不出整整一小時，不可以把 2 小時的量放進尖峰欄",
    );
  /* 反過來：累計量本身是對的，不可以連它一起遮掉。 */
  assert.ok(
    combined.periods.all.total > 0,
    "「全調查時段」是累計量，車輛數本身是對的，不可以一起變成資料不足",
  );
});

test("⚠️ 前置：整點一格（剛好 60 分鐘）不可以被上一條連帶弄壞", () => {
  const rows = buildPeriodRows(
    [
      roadRow("07:00～08:00", "A", { motorcycle: 100, small: 100 }),
      roadRow("08:00～09:00", "A", { motorcycle: 100, small: 300 }),
      roadRow("15:00～16:00", "A", { motorcycle: 100, small: 500 }),
    ],
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.equal(combined.periods.am.hour, "08:00～09:00");
  assert.equal(combined.periods.pm.hour, "15:00～16:00");
});

test("⚠️ 45 分鐘一格：尖峰欄是「資料不足」，不是「—」", () => {
  const rows = buildPeriodRows(
    [
      roadRow("07:00～07:45", "A", { motorcycle: 100, small: 100 }),
      roadRow("07:45～08:30", "A", { motorcycle: 100, small: 200 }),
    ],
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.equal(
    combined.periods.allPeak.hour,
    "資料不足",
    "有資料、只是湊不出整整一小時——要與「沒有資料」分開講",
  );
});

test("45 分鐘零車流紀錄在時段分析仍是資料不足", () => {
  const rows = buildPeriodRows([roadRow("07:00～07:45", "A", { small: 0 })], { factors });
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.equal(combined.periods.allPeak.hour, "資料不足");
  assert.equal(combined.periods.am.hour, "資料不足");
  assert.equal(combined.periods.pm.hour, "—");
});

test("負 PCU 細格與零車流完整時段並存時，不可誤說資料不足", () => {
  const rows = [0, 15, 30, 45, 60, 75, 90, 105].map((minute) => {
    const start = 7 * 60 + minute;
    const end = start + 15;
    const stamp = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    return roadRow(`${stamp(start)}～${stamp(end)}`, "A", { small: minute < 60 ? 10 : 0 });
  });
  const negativeFactors = { core: { ...core, small: -1 }, coreTurns, settings: [] };
  const peak = buildPeriodRows(rows, { factors: negativeFactors })
    .find((row) => row.scopeCode === "ALL").periods.allPeak;
  assert.notEqual(peak.hour, "資料不足", "已有完整 60 分鐘且量到車，不能因零車流視窗權重較高就丟掉尖峰");
  assert.equal(peak.hasData, true);
});

test("⚠️ 反過來也要成立：那一段完全沒有資料時仍然是「—」", () => {
  /*
   * 只有上午有資料時，下午那一格是「沒有資料」，不是「湊不出一小時」。
   * 少了這一條，把「—」整個換成「資料不足」也會過。
   */
  const rows = buildPeriodRows(
    [
      roadRow("07:00～08:00", "A", { motorcycle: 100, small: 100 }),
      roadRow("08:00～09:00", "A", { motorcycle: 100, small: 300 }),
    ],
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.equal(combined.periods.pm.hour, "—", "下午完全沒有資料，要維持「—」");
});

test("⚠️ 格長混用（整點 ＋ 尖峰拆 15 分鐘）：尖峰要走累計分鐘數，不可以逐格比大小", () => {
  /*
   * ══════════════════════════════════════════════════════════════════
   *  第六輪獨立複查抓到的最嚴重一件
   * ══════════════════════════════════════════════════════════════════
   *
   * 舊判準是「眾數格長 < 60 才走滾動視窗」。這一份資料的眾數是 60
   * （整點格比 15 分鐘格多），所以走的是 `peakBucket()`——逐格比大小、
   * 完全不看格長，於是挑到整點那一格 100，而真尖峰是 07:00–08:00 的 200。
   * **少報一半、時段完全錯**，而這正是 v20.83 更新說明拿來當「已修」證據
   * 的同一個例子；同一份資料 KPI 尖峰卡走 rollingPeak 得到 200，
   * 同一個畫面上兩個答案差一倍。
   *
   * ⚠️ 反證：把判準改回「眾數 < 60」→ 這一支紅（實測 am 變成 00:00～01:00）。
   */
  const rows = [];
  /* 00:00～07:00 與 09:00～24:00 每格 100（整點）。 */
  for (const h of [0, 1, 2, 3, 4, 5, 6, 9, 10, 11]) {
    const two = String(h).padStart(2, "0");
    const next = String(h + 1).padStart(2, "0");
    rows.push(roadRow(`${two}:00～${next}:00`, "A", { small: 100 }));
  }
  /* 07:00～09:00 拆成 15 分鐘，每格 50（八格，合計 400；任一小時 200）。 */
  for (let i = 0; i < 8; i += 1) {
    const start = 7 * 60 + i * 15;
    const end = start + 15;
    const fmt = (m) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    rows.push(roadRow(`${fmt(start)}～${fmt(end)}`, "A", { small: 50 }));
  }
  const out = buildPeriodRows(rows, { factors });
  const combined = out.find((row) => row.scopeCode === "ALL");
  assert.ok(combined, "抓不到合計那一列");
  assert.equal(
    combined.periods.am.hour,
    "07:00～08:00",
    `上午尖峰寫的是「${combined.periods.am.hour}」——`
      + "格長混用時不可以逐格比大小（那會挑到整點那一格）",
  );
  assert.equal(
    combined.periods.am.total,
    200,
    "上午尖峰的量要是四格 15 分鐘的合計 200，不是單一整點格的 100",
  );
  assert.equal(
    combined.periods.allPeak.total,
    200,
    "全調查時段尖峰同理",
  );
});

test("⚠️ 混用了 2 小時格（眾數仍是 60）：那一格不可以被挑成尖峰", () => {
  /*
   * `oversized` 舊判準看的是**眾數**，所以「多數整點 ＋ 少數 2 小時」
   * 的調查點不會被擋，而那個 2 小時格的量大約兩倍，一定會被挑中，
   * 單位還會寫成「該時段（120 分鐘）」——手冊寫的是無條件的
   * 「2 小時一格會顯示資料不足」。
   */
  const rows = [];
  for (const h of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const two = String(h).padStart(2, "0");
    const next = String(h + 1).padStart(2, "0");
    rows.push(roadRow(`${two}:00～${next}:00`, "A", { small: 100 }));
  }
  /* 15:00～17:00 一格，量 500（>任何整點格）。 */
  rows.push(roadRow("15:00～17:00", "A", { small: 500 }));
  const out = buildPeriodRows(rows, { factors });
  const combined = out.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.notEqual(
    combined.periods.allPeak.hour,
    "15:00～17:00",
    "2 小時那一格被挑成尖峰了——它不是一小時的流率",
  );
  assert.equal(
    combined.periods.allPeak.total,
    100,
    "尖峰要落在某一個整點格（量 100），而不是那個 2 小時格",
  );
  assert.equal(
    combined.periods.pm.hour,
    "資料不足",
    "下午只有那一格 2 小時，湊不出整整一小時 → 要寫「資料不足」",
  );
});
