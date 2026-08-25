import test from "node:test";
import assert from "node:assert/strict";
import {
  anomalyTypeCounts,
  quarterOrderKey,
  completenessSummary,
  detectAnomalies,
  filterAnomalies,
  validateImport,
} from "../app/final-workflow.ts";

function row(overrides = {}) {
  return {
    projectId: "p",
    quarter: "115Q1",
    roadId: "R1",
    roadName: "測試路段",
    dayType: "平日",
    directionCode: "A",
    directionName: "方向A",
    hour: "00:00～01:00",
    motorcycle: 10,
    small: 20,
    large: 1,
    special: 0,
    vehicleCounts: { motorcycle: 10, small: 20, large: 1, special: 0 },
    vehicleLabels: {
      motorcycle: "機車",
      small: "小型車",
      large: "大型車",
      special: "特種車",
    },
    sourceFileName: "source.xls",
    sourceSheetName: "平日",
    sourceRow: 8,
    ...overrides,
  };
}

test("import validation reports append, overwrite and 24-hour completeness", () => {
  const complete = Array.from({ length: 24 }, (_, hour) =>
    row({
      hour: `${String(hour).padStart(2, "0")}:00～${String((hour + 1) % 24).padStart(2, "0")}:00`,
    }),
  );
  const report = validateImport(complete, [complete[0]]);
  assert.equal(report.valid, true);
  assert.equal(report.replacedRows, 1);
  assert.equal(report.addedRows, 23);
  assert.equal(report.incompleteGroups.length, 0);
  assert.equal(report.sourceFiles[0], "source.xls");
});

test("quality summary retains incomplete and unmapped quantities", () => {
  const rows = [
    row({
      surveyType: "intersection",
      directionCode: "UNMAPPED",
      directionName: "未指定駛入路口",
    }),
  ];
  const summary = completenessSummary(
    rows,
    "115Q1",
    ["motorcycle", "small", "large", "special"],
    [],
    false,
  );
  assert.equal(summary.incompleteGroups, 1);
  assert.equal(summary.unmapped, 31);
  assert.equal(summary.geometryComplete, false);
});

test("anomaly detector applies configurable quarter thresholds", () => {
  const records = [
    row(),
    row({
      quarter: "115Q2",
      motorcycle: 100,
      vehicleCounts: { motorcycle: 100, small: 20, large: 1, special: 0 },
      hour: "08:00～09:00",
    }),
  ];
  const alerts = detectAnomalies(
    records,
    {
      dailyChangePct: 10,
      pcuChangePct: 10,
      vehicleShareChangePct: 5,
      peakShiftHours: 3,
      zeroHourLimit: 3,
    },
    (record) =>
      Object.values(record.vehicleCounts).reduce(
        (sum, value) => sum + value,
        0,
      ),
  );
  // detectAnomalies 現在回傳結構化物件（為了做季度區間與類型篩選），
  // 但 text 欄位的字面必須與舊版完全一致，匯出的「異常提醒」才不會變。
  assert.ok(alerts.some((alert) => alert.text.includes("全日量變動")));
  assert.ok(alerts.some((alert) => alert.text.includes("占比變動")));
  assert.ok(alerts.every((alert) => alert.roadId && alert.type && alert.toQuarter));
  assert.ok(alerts.some((alert) => alert.type === "全日量變動"));
  assert.ok(alerts.some((alert) => alert.type === "車種占比變動"));
});

test("提醒敘述的分隔符號一律是全形斜線", () => {
  // 舊版用 replace（只換第一個），輸出會變成「調查點／平日|方向A」，
  // 前後兩個分隔符號不一致；車種占比那一類卻是三段都用斜線。
  const records = [
    row(),
    row({
      quarter: "115Q2",
      motorcycle: 100,
      vehicleCounts: { motorcycle: 100, small: 20, large: 1, special: 0 },
    }),
  ];
  const alerts = detectAnomalies(
    records,
    { dailyChangePct: 10, pcuChangePct: 10, vehicleShareChangePct: 5, peakShiftHours: 3, zeroHourLimit: 3 },
    (record) => Object.values(record.vehicleCounts).reduce((sum, value) => sum + value, 0),
  );
  assert.ok(alerts.length > 0);
  for (const alert of alerts) assert.doesNotMatch(alert.text, /\|/);
});

test("異常提醒可以依季度區間、類型、調查點與日別篩選", () => {
  const alerts = [
    { roadId: "R1", dayType: "平日", direction: "東", type: "全日量變動", fromQuarter: "113Q4", toQuarter: "114Q1", value: 21, unit: "%", text: "a" },
    { roadId: "R1", dayType: "假日", direction: "東", type: "PCU變動", fromQuarter: "114Q1", toQuarter: "114Q2", value: 22, unit: "%", text: "b" },
    { roadId: "R2", dayType: "平日", direction: "西", type: "尖峰時段位移", fromQuarter: "114Q3", toQuarter: "114Q4", value: 8, unit: "小時", text: "c" },
    { roadId: "R2", dayType: "平日", direction: "西", type: "零流量時段", fromQuarter: "99Q4", toQuarter: "99Q4", value: 5, unit: "個", text: "d" },
  ];
  // 區間是「有重疊就列出」：選 114Q1～114Q2，跨進來的 113Q4→114Q1 也要出現。
  assert.deepEqual(
    filterAnomalies(alerts, { fromQuarter: "114Q1", toQuarter: "114Q2" }).map((x) => x.text),
    ["a", "b"],
  );
  assert.deepEqual(
    filterAnomalies(alerts, { types: ["尖峰時段位移"] }).map((x) => x.text),
    ["c"],
  );
  assert.deepEqual(
    filterAnomalies(alerts, { roadId: "R1" }).map((x) => x.text),
    ["a", "b"],
  );
  assert.deepEqual(
    filterAnomalies(alerts, { dayType: "假日" }).map((x) => x.text),
    ["b"],
  );
  // 民國 99 年與 114 年的位數不同，字串排序會排錯，必須補零後再比。
  assert.deepEqual(
    filterAnomalies(alerts, { fromQuarter: "99Q1", toQuarter: "99Q4" }).map((x) => x.text),
    ["d"],
  );
  assert.equal(filterAnomalies(alerts, {}).length, 4);
});

test("季度排序同時支援民國三碼與西元四碼", () => {
  // 匯入驗證同時允許 115Q2 與 2026Q2，而 2026Q3 其實就是民國 115Q3。
  // 純字串排序會把「115Q4→2026Q3」當成相鄰的一組，比較方向剛好是反的。
  assert.ok(quarterOrderKey("2026Q3") < quarterOrderKey("115Q4"));
  assert.equal(quarterOrderKey("2026Q3"), quarterOrderKey("115Q3"));
  assert.ok(quarterOrderKey("99Q4") < quarterOrderKey("100Q1"));
  assert.equal(quarterOrderKey("亂寫"), Number.NEGATIVE_INFINITY);
});

test("方向名稱含有分隔符號時不會被截斷", () => {
  const records = [
    row({ directionName: "北向|往台北" }),
    row({
      quarter: "115Q2",
      directionName: "北向|往台北",
      vehicleCounts: { motorcycle: 100, small: 20, large: 1, special: 0 },
    }),
  ];
  const alerts = detectAnomalies(
    records,
    { dailyChangePct: 10, pcuChangePct: 10, vehicleShareChangePct: 5, peakShiftHours: 3, zeroHourLimit: 3 },
    (record) => Object.values(record.vehicleCounts).reduce((sum, value) => sum + value, 0),
  );
  assert.ok(alerts.length > 0);
  assert.ok(alerts.every((alert) => alert.direction === "北向|往台北"));
});

test("異常類型統計會列出全部類型，沒有的補 0", () => {
  const counts = anomalyTypeCounts([
    { type: "全日量變動" },
    { type: "全日量變動" },
    { type: "零流量時段" },
  ]);
  assert.deepEqual(counts, [
    { type: "全日量變動", count: 2 },
    { type: "PCU變動", count: 0 },
    { type: "尖峰時段位移", count: 0 },
    { type: "車種占比變動", count: 0 },
    { type: "零流量時段", count: 1 },
  ]);
});

test("「24 小時完整」以實際涵蓋時數判斷，不是資料列數", () => {
  // 兩個方向都曾經錯：30 分鐘一格的 06:00–18:00 剛好 24 個標籤（只有 12 小時）
  // 會被判定完整；完整 24 小時的 15 分鐘資料有 96 個標籤，反而被判定不完整，
  // 而且訊息會寫「96 小時」。
  const base = {
    quarter: "115Q1",
    roadId: "T-01",
    roadName: "測試",
    dayType: "平日",
    directionCode: "A",
    directionName: "往北",
    motorcycle: 1,
    small: 1,
    large: 0,
    special: 0,
  };
  const label = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const range = (startMin, endMin, step) => {
    const rows = [];
    for (let m = startMin; m < endMin; m += step)
      rows.push({ ...base, hour: `${label(m)}～${label(m + step)}` });
    return rows;
  };
  // 只有 12 小時，但剛好 24 個標籤
  const half = validateImport(range(360, 1080, 30), []);
  assert.ok(
    half.warnings.some((w) => w.includes("未滿 24 小時")),
    `12 小時的調查必須被判定為不完整，實際 warnings=${JSON.stringify(half.warnings)}`,
  );
  // 完整 24 小時，96 個標籤
  const full = validateImport(range(0, 1440, 15), []);
  assert.deepEqual(
    full.warnings.filter((w) => w.includes("未滿 24 小時")),
    [],
    "完整 24 小時的 15 分鐘資料不該被判定為不完整",
  );
  assert.ok(
    !JSON.stringify(full).includes("96 小時"),
    "不可以出現「96 小時」這種訊息",
  );
});
