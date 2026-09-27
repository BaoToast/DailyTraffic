import test from "node:test";
import assert from "node:assert/strict";
import {
  detectStateAnomalies,
  ANOMALY_RESOLUTIONS,
  anomalyTypeCounts,
  quarterOrderKey,
  completenessSummary,
  detectAnomalies,
  filterAnomalies,
  trafficIdentity,
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

test("調查日期只作顯示，不得改變覆蓋判斷的身分鍵", () => {
  const original = row();
  assert.equal(
    trafficIdentity({ ...original, surveyDate: "2026-01-25" }),
    trafficIdentity({ ...original, surveyDate: "2026-02-25" }),
  );
});

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
    (record) =>
      Object.values(record.vehicleCounts).some((value) => Number(value) !== 0),
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
    (record) =>
      Object.values(record.vehicleCounts).some((value) => Number(value) !== 0),
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
    (record) =>
      Object.values(record.vehicleCounts).some((value) => Number(value) !== 0),
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
    /* 2026-09-20 使用者指定新增的類型（三支同步）。 */
    { type: "方向名稱不成對", count: 0 },
    /*
     * 使用者 2026-09-20 新增：同一張表讀到兩個以上的調查日期。
     * ⚠️ 這一列是 0，因為這組測資沒有 surveyDateCandidates——
     *   重點是**每一種類型都要出現在統計裡**，沒有的補 0，
     *   不然畫面上的類型標籤會少一個，使用者以為系統沒有檢查這一項。
     */
    { type: "調查日期不只一個", count: 0 },
    /* 使用者 2026-09-24 新增：時間格長度超過 1 小時（同上，0 筆也要出現）。 */
    { type: "調查格距異常", count: 0 },
    /* 使用者 2026-09-24 新增：同一張表混用兩種以上格長。 */
    { type: "調查格距混用", count: 0 },
    /*
     * K42／K43／K44（2026-09-24）：使用者定下的通則——「針對這類假設情況，
     * 你首先要判定的是這是否為異常，只有使用者確認不是異常情形，才套用
     * 你建議的處理方式」。三種都是「程式已經做好處理、卻沒有把情況講出來」。
     * 同上：0 筆也要出現在統計裡，否則畫面的類型標籤會少一個。
     */
    { type: "平假日涵蓋不一致", count: 0 },
    { type: "PCU係數全為0", count: 0 },
    { type: "調查涵蓋無法判斷", count: 0 },
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

/*
 * 各支線車種名稱不一致要出警告（使用者要求，2026-08-26）。
 *
 * 那份四路口的調查表把路口C、D 的「大型車／特種車」寫成「大貨車／大客車」。
 * v20.29 修好切法之後，四個路口都會正確切出來、數字也對，但名稱不一致
 * 這件事仍然多半是打錯字——只是現在它完全不會被發現，因為匯入一切正常。
 * 所以在匯入預覽的「需注意」裡先講出來，由使用者按確認鈕決定要不要照樣匯入。
 *
 * 這裡釘住三件事：一致時不可以誤報、不一致時一定要報、而且警告只提醒不改名。
 */
test("各支線車種名稱不一致時要在匯入前提醒", () => {
  const odd = {
    motorcycle: "機車",
    small: "小型車",
    large: "大貨車",
    special: "大客車",
  };
  const mixed = [
    row({ directionCode: "A", directionName: "駛出路口A" }),
    row({ directionCode: "B", directionName: "駛出路口B" }),
    row({ directionCode: "C", directionName: "駛出路口C", vehicleLabels: odd }),
    row({ directionCode: "D", directionName: "駛出路口D", vehicleLabels: odd }),
  ];
  const report = validateImport(mixed, []);
  const warning = report.warnings.find((text) => text.includes("車種名稱不一致"));
  assert.ok(
    warning,
    `名稱不一致必須提醒，實際 warnings=${JSON.stringify(report.warnings)}`,
  );
  assert.ok(warning.includes("測試路段"), "警告要指出是哪一個調查點");
  assert.ok(
    warning.includes("駛出路口C") && warning.includes("大貨車"),
    "警告要指出是哪些支線、名稱差在哪裡",
  );
  assert.ok(
    warning.includes("不會自動把它們併成同一類"),
    "要講明系統保留原名稱，不自動歸類",
  );
  assert.equal(report.valid, true, "只提醒，不可以擋住匯入");
});

test("各支線車種名稱一致時不可以誤報", () => {
  const same = ["A", "B", "C", "D"].map((code) =>
    row({ directionCode: code, directionName: `駛出路口${code}` }),
  );
  assert.deepEqual(
    validateImport(same, []).warnings.filter((text) =>
      text.includes("車種名稱不一致"),
    ),
    [],
  );
  /* 沒有 vehicleLabels 的舊資料沒有名稱可比，也不可以報警告 */
  const legacy = ["A", "B"].map((code) =>
    row({ directionCode: code, vehicleLabels: undefined }),
  );
  assert.deepEqual(
    validateImport(legacy, []).warnings.filter((text) =>
      text.includes("車種名稱不一致"),
    ),
    [],
  );
});

test("不同調查點各自比較，不會互相誤報", () => {
  const other = {
    motorcycle: "機車",
    small: "小型車",
    large: "大貨車",
    special: "大客車",
  };
  const records = [
    row({ roadId: "R1", roadName: "路段甲", directionCode: "A" }),
    row({ roadId: "R1", roadName: "路段甲", directionCode: "B" }),
    row({
      roadId: "R2",
      roadName: "路段乙",
      directionCode: "A",
      vehicleLabels: other,
    }),
    row({
      roadId: "R2",
      roadName: "路段乙",
      directionCode: "B",
      vehicleLabels: other,
    }),
  ];
  assert.deepEqual(
    validateImport(records, []).warnings.filter((text) =>
      text.includes("車種名稱不一致"),
    ),
    [],
    "兩個調查點各自內部一致，就算彼此不同也不該報警告",
  );
});

/*
 * ── 異常提醒的顯示名稱（v20.31）──
 *
 * 提醒的那一行字會出現在三個地方：畫面的異常提醒表、Excel 的「品質檢核」
 * 工作表、以及**報告文字草稿**。原本它一律用鍵值組字，於是使用者改過名之後：
 *  ・車種：上面的表寫「大貨車」，提醒寫 custom:大貨車
 *  ・支線：其他地方寫「駛出路口A（東側）」，提醒寫 駛出路口A
 *  ・調查點：畫面表格轉成路段名稱，text 仍是 999996-01
 * 同一件事在同一頁上有兩種寫法，而錯的那一份會被抄進交付文件。
 */
const anomalyThresholds = {
  dailyChangePct: 10,
  pcuChangePct: 10,
  vehicleShareChangePct: 5,
  peakShiftHours: 3,
  zeroHourLimit: 3,
};
const anomalyPcu = (record) =>
  Object.values(record.vehicleCounts).reduce((sum, value) => sum + value, 0);
/* 逐車種證據：任何一個車種不是 0 就算「當量係數設定過」。 */
const anomalyAnyPcu = (record) =>
  Object.values(record.vehicleCounts).some((value) => Number(value) !== 0);
function anomalyRecords() {
  return [
    row({
      directionCode: "A",
      directionName: "駛出路口A",
      vehicleCounts: { motorcycle: 10, small: 20, "custom:大貨車": 1 },
      vehicleLabels: { motorcycle: "機車", small: "小型車" },
    }),
    row({
      quarter: "115Q2",
      directionCode: "A",
      directionName: "駛出路口A",
      hour: "08:00～09:00",
      vehicleCounts: { motorcycle: 100, small: 20, "custom:大貨車": 30 },
      vehicleLabels: { motorcycle: "機車", small: "小型車" },
    }),
  ];
}

test("異常提醒寫的是顯示名稱，不是內部鍵值", () => {
  const alerts = detectAnomalies(
    anomalyRecords(),
    anomalyThresholds,
    anomalyPcu,
    anomalyAnyPcu,
    {
      road: (roadId) => (roadId === "R1" ? "縣道123（起點～終點）" : roadId),
      direction: () => "駛出路口A（東側）",
      vehicle: (key) => (key === "custom:大貨車" ? "大貨車" : "機車"),
    },
  );
  assert.ok(alerts.length > 0, "應該要偵測到異常，否則這個測試沒驗到東西");
  for (const alert of alerts) {
    assert.ok(
      alert.text.includes("縣道123（起點～終點）"),
      `調查點應寫名稱：${alert.text}`,
    );
    assert.ok(
      alert.text.includes("駛出路口A（東側）"),
      `支線應寫名稱：${alert.text}`,
    );
    assert.ok(!alert.text.includes("R1／"), `不可出現調查點鍵值：${alert.text}`);
  }
  const share = alerts.find((alert) => alert.vehicle === "custom:大貨車");
  assert.ok(share, "應該要有 custom:大貨車 的占比變動");
  assert.ok(!share.text.includes("custom:"), `不可出現車種鍵值：${share.text}`);
  assert.match(share.text, /大貨車占比變動/);
  for (const alert of alerts)
    assert.ok(!/motorcycle|custom:/.test(alert.text), alert.text);
});

test("畫面表格用的三個顯示欄位也要有值", () => {
  const alerts = detectAnomalies(
    anomalyRecords(),
    anomalyThresholds,
    anomalyPcu,
    anomalyAnyPcu,
    {
      road: () => "縣道123（起點～終點）",
      direction: () => "駛出路口A（東側）",
      vehicle: (key) => (key === "custom:大貨車" ? "大貨車" : "機車"),
    },
  );
  for (const alert of alerts) {
    assert.equal(alert.roadLabel, "縣道123（起點～終點）");
    assert.equal(alert.directionLabel, "駛出路口A（東側）");
    // 鍵值必須原封不動保留，篩選與分組是靠它。
    assert.equal(alert.roadId, "R1");
  }
  const share = alerts.find((alert) => alert.vehicle === "custom:大貨車");
  assert.equal(share.vehicleLabel, "大貨車");
});

test("沒有傳 labels 時行為與舊版完全相同（向後相容）", () => {
  const without = detectAnomalies(
    anomalyRecords(),
    anomalyThresholds,
    anomalyPcu,
    anomalyAnyPcu,
  );
  assert.ok(without.length > 0);
  for (const alert of without) {
    assert.ok(alert.text.startsWith("R1／平日／駛出路口A"), alert.text);
    assert.equal(alert.roadLabel, "R1");
    assert.equal(alert.directionLabel, "駛出路口A");
  }
  const share = without.find((alert) => alert.vehicle === "custom:大貨車");
  assert.equal(share.vehicleLabel, "custom:大貨車");
  assert.match(share.text, /custom:大貨車占比變動/);
});

test("提醒的分組與篩選仍然用鍵值，改名不會讓篩選失效", () => {
  const alerts = detectAnomalies(
    anomalyRecords(),
    anomalyThresholds,
    anomalyPcu,
    anomalyAnyPcu,
    { road: () => "縣道123（起點～終點）", direction: () => "駛出路口A（東側）" },
  );
  assert.equal(filterAnomalies(alerts, { roadId: "R1" }).length, alerts.length);
  assert.equal(
    filterAnomalies(alerts, { roadId: "縣道123（起點～終點）" }).length,
    0,
    "用顯示名稱應該篩不到，代表鍵值沒有被顯示名稱取代",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K42／K43／K44：三種「已經做好處理、卻沒有把情況講出來」的異常
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-24 定下的通則：
 *   「針對這類假設情況，你首先要判定的是**這是否為異常**，只有使用者確認
 *     不是異常情形，才套用你建議的處理方式」
 *
 * 三項的共同病灶：系統給了一個對的答案，但隱瞞了前提。
 * 「靜靜出錯」是給錯答案；「靜靜處理」是給對答案但隱瞞前提——一樣不行。
 *
 * ⚠️ 每一項都附一個「不可以誤報」的反面，否則守門會變成「一律報異常」，
 *   那比不報更糟（真正的異常會被淹沒）。
 */
const stateRow = (over) => ({
  quarter: "115Q1",
  roadId: "R1",
  roadName: "中山路",
  dayType: "平日",
  directionCode: "A",
  directionName: "往北",
  hour: "07:00～08:00",
  surveyType: "road",
  motorcycle: 0,
  small: 10,
  large: 0,
  special: 0,
  sourceFileName: "x.xlsx",
  sourceSheetName: "平日",
  ...over,
});
/*
 * ⚠️ 第三個參數（逐車種是否有非 0 的 PCU 貢獻）是 2026-09-26 新增的**必填**參數。
 *   這裡的預設 `pcu(record) !== 0` 只是為了讓既有測試維持原本的語意；
 *   要驗「係數設好了但正負抵銷成 0」那一種，呼叫端必須**明確**傳
 *   `() => true` 與 `pcu: () => 0`——那正是下面兩支新測試在做的事。
 */
const typesOf = (
  records,
  pcu = () => 1,
  anyVehiclePcu = (record) => pcu(record) !== 0,
) => detectStateAnomalies(records, pcu, anyVehiclePcu).map((item) => item.type);

test("⚠️ K43：有車但 PCU 合計為 0 要列成「PCU係數全為0」", () => {
  assert.ok(typesOf([stateRow({})], () => 0).includes("PCU係數全為0"));
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  K43 的判準是「逐車種有沒有非 0 的貢獻」，不是「合計是不是 0」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-26 抓到：K43 原本寫 `group.total > 0 && group.pcu <= 0`。
 * 而合計為 0（或負數）有兩種完全不同的成因：
 *   ① 係數真的都是 0／沒設定        → 這才是要提醒的
 *   ② 使用者把某個車種設成**負係數**，＋X 與 −X 抵銷 → 係數設好了
 * 舊判準把②也報成「PCU係數全為0」，而「時段車種分析」那一端
 *（`app/period-analysis.ts` 的 anyPcu）算得出正常的尖峰——
 * 同一筆資料、同一個畫面，兩個入口各說各話。
 *
 * ⚠️ 兩支要**成對**看：只驗「抵銷時不報」的話，「永遠不報」也會通過，
 *   而那會把真正沒設定係數的情況整個藏掉。
 * ⚠️ 反證（2026-09-26 實測）：把 app/final-workflow.ts 的 K43 判準改回
 *   `group.pcu <= 0`，下面第一支就紅、第二支仍綠。
 */
test("⚠️ K43：係數設好但正負抵銷成 0 時，不可以報「PCU係數全為0」", () => {
  assert.ok(
    !typesOf(
      [stateRow({})],
      /* 合計剛好 0（例如大型車設 +2、機車設 −2 互相抵銷） */
      () => 0,
      /* 但逐車種確實有非 0 的貢獻 → 係數設定過 */
      () => true,
    ).includes("PCU係數全為0"),
    "係數設好、只是正負抵銷成 0，被誤報成「係數全為 0」——" +
      "而時段分析那一端算得出正常尖峰，兩個入口會各說各話",
  );
});

test("⚠️ K43：合計是負數時同樣不算「沒設定」（負係數是使用者刻意設的）", () => {
  assert.ok(
    !typesOf([stateRow({})], () => -12, () => true).includes("PCU係數全為0"),
    "合計為負數就報「係數全為 0」——負係數是系統允許、使用者刻意設的",
  );
});

test("⚠️ K43 的另一半：逐車種真的都是 0 時，一定要報出來", () => {
  assert.ok(
    typesOf([stateRow({})], () => 0, () => false).includes("PCU係數全為0"),
    "係數真的都沒設定卻不提醒——那尖峰會用車輛數挑而使用者不知道",
  );
});

test("⚠️ K43 不可以誤報：PCU 正常時不列", () => {
  assert.ok(!typesOf([stateRow({})], () => 5).includes("PCU係數全為0"));
});

test("⚠️ K43 不可以誤報：整組車輛數是 0（真的沒車）時不列", () => {
  /* 沒車的時段 PCU 當然是 0，那不是「係數沒設定」。 */
  assert.ok(
    !typesOf([stateRow({ small: 0 })], () => 0).includes("PCU係數全為0"),
  );
});

test("⚠️ K44：時段字串解析不出起訖時要列成「調查涵蓋無法判斷」", () => {
  assert.ok(
    typesOf([stateRow({ hour: "上午" })]).includes("調查涵蓋無法判斷"),
  );
});

test("⚠️ K44 不可以誤報：正常時段字串不列", () => {
  assert.ok(!typesOf([stateRow({})]).includes("調查涵蓋無法判斷"));
});

test("⚠️ K42：同一調查點平假日涵蓋不同要列成「平假日涵蓋不一致」", () => {
  const weekday = [stateRow({}), stateRow({ hour: "08:00～09:00" })];
  const holiday = [stateRow({ dayType: "假日" })];
  assert.ok(
    typesOf([...weekday, ...holiday]).includes("平假日涵蓋不一致"),
  );
});

test("⚠️ K42 不可以誤報：平假日涵蓋相同時不列", () => {
  const same = [stateRow({}), stateRow({ dayType: "假日" })];
  assert.ok(!typesOf(same).includes("平假日涵蓋不一致"));
});

test("⚠️ K42 不可以誤報：只有一種日別時不列", () => {
  assert.ok(!typesOf([stateRow({})]).includes("平假日涵蓋不一致"));
});

test("⚠️ K42 不可以誤報：其中一邊「解析不出來」不算涵蓋不一致", () => {
  /*
   * 「無法判斷」與「不一致」是兩件事。拿無法判斷當成不一致的證據，
   * 使用者會被叫去核對兩個時段哪裡不同，而真正的問題是時間欄位格式。
   */
  const mixed = [stateRow({}), stateRow({ dayType: "假日", hour: "上午" })];
  const types = typesOf(mixed);
  assert.ok(!types.includes("平假日涵蓋不一致"), "不可以報成不一致");
  assert.ok(types.includes("調查涵蓋無法判斷"), "應該報成無法判斷");
});

test("⚠️ 三種新異常都要有解決方式，而且說得出去哪一頁處理", () => {
  for (const type of ["平假日涵蓋不一致", "PCU係數全為0", "調查涵蓋無法判斷"]) {
    const resolution = ANOMALY_RESOLUTIONS[type];
    assert.ok(resolution, `${type} 沒有解決方式`);
    assert.ok(resolution.text.length > 40, `${type} 的解決方式太短，等於沒寫`);
    assert.ok(resolution.anchorLabel, `${type} 沒有寫「前往哪一頁」`);
  }
});
