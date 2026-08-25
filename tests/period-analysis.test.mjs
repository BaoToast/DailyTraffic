import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPeriodExportSheets,
  buildPeriodRows,
  defaultPeriodExportSelection,
  hourStartOf,
  metricUnitFor,
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
      roadRow("18:00～19:00", "A", { motorcycle: 200, small: 500 }), // PCU 600 ← 下午＋全日尖峰
    ],
    { factors },
  );
  const combined = rows.find((row) => row.scopeCode === "ALL");
  assert.ok(combined);
  assert.equal(combined.periods.am.hour, "09:00～10:00");
  assert.equal(combined.periods.am.pcu, 350);
  assert.equal(combined.periods.pm.hour, "18:00～19:00");
  assert.equal(combined.periods.pm.pcu, 600);
  assert.equal(combined.periods.peak24.hour, "18:00～19:00");
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

test("平日＋假日模式下平日與假日各自成一個時段", () => {
  const weekday = roadRow("08:00～09:00", "A", { small: 100 });
  const holiday = { ...roadRow("08:00～09:00", "A", { small: 400 }), dayType: "假日" };
  const rows = buildPeriodRows([weekday, holiday], { factors, separateDays: true });
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(all.periods.am.hour, "假日 08:00～09:00");
  assert.equal(all.periods.am.pcu, 400);
  assert.equal(all.periods.all.pcu, 500);
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
  assert.equal(metricUnitFor("count", "peak24"), "輛/hr");
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
  assert.equal(all.periods.peak24.pcu, 190, "兩份檔案的同一小時要合併計算");
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
  assert.equal(all.periods.peak24.hour, "07:00～08:00");
});

test("完全沒有車流時不會拿第一筆冒充尖峰", () => {
  const rows = buildPeriodRows(
    [roadRow("07:00～08:00", "A", { small: 0 }), roadRow("13:00～14:00", "A", { small: 0 })],
    { factors },
  );
  const all = rows.find((row) => row.scopeCode === "ALL");
  assert.equal(all.periods.peak24.hour, "—");
  assert.equal(all.periods.am.hour, "—");
  assert.equal(all.periods.pm.hour, "—");
});

test("當量係數尚未設定（PCU 全為 0）時改以車輛數判定尖峰", () => {
  const zero = { core: { motorcycle: 0, small: 0, large: 0, special: 0 }, coreTurns, settings: [] };
  const rows = buildPeriodRows(
    [roadRow("07:00～08:00", "A", { small: 10 }), roadRow("09:00～10:00", "A", { small: 90 })],
    { factors: zero },
  );
  assert.equal(rows.find((row) => row.scopeCode === "ALL").periods.am.hour, "09:00～10:00");
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
