import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
  quarterKey,
  quarterYear,
  selectRows,
} from "../app/conclusion.ts";

/* 樣本列與 meta 抽到 helpers，跨系統守門測試共用同一份形狀。 */
import {
  CONCLUSION_META as META,
  cell,
  row,
} from "./helpers/conclusion-row.mjs";



const cond = (over = {}) => ({ ...DEFAULT_CONDITION, ...over });

test("季度排序鍵可以混排民國兩碼、三碼與西元四碼", () => {
  assert.ok(quarterKey("99Q4") < quarterKey("100Q1"));
  assert.equal(quarterKey("2026Q1"), quarterKey("115Q1"));
  assert.equal(quarterYear("115Q2"), "115");
});

test("單季／年度／區間條件都會生效", () => {
  const rows = ["114Q3", "114Q4", "115Q1", "115Q2"].map((quarter) => row({ quarter }));
  assert.deepEqual(
    selectRows(rows, cond({ scope: { kind: "quarter", quarter: "115Q1" } })).map(
      (r) => r.quarter,
    ),
    ["115Q1"],
  );
  assert.deepEqual(
    selectRows(rows, cond({ scope: { kind: "year", year: "114" } })).map((r) => r.quarter),
    ["114Q3", "114Q4"],
  );
  assert.deepEqual(
    selectRows(
      rows,
      cond({ scope: { kind: "range", from: "115Q1", to: "114Q4" } }),
    ).map((r) => r.quarter),
    ["114Q4", "115Q1"],
    "起訖顛倒也要能用",
  );
});

test("路段、方向與日別條件都會生效", () => {
  const rows = [
    row({ roadId: "R-01", scopeCode: "ALL", dayType: "平日" }),
    row({ roadId: "R-01", scopeCode: "A", scopeName: "方向A", dayType: "平日" }),
    row({ roadId: "R-02", scopeCode: "ALL", dayType: "假日" }),
  ];
  assert.equal(selectRows(rows, cond({ roadIds: ["R-01"] })).length, 2);
  assert.equal(selectRows(rows, cond({ scopeCodes: ["A"] })).length, 1);
  assert.equal(selectRows(rows, cond({ dayTypes: ["假日"] })).length, 1);
});

test("只勾車輛數時不會寫出 PCU，反之亦然", () => {
  const onlyCount = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  // 標頭那段單位說明本來就會同時提到兩種單位，所以只看數值那一行。
  const valueLine = (text) => text.split("\n").find((line) => /全日：/.test(line)) || "";
  assert.match(onlyCount, /10,000 輛\/日/);
  assert.doesNotMatch(valueLine(onlyCount), /PCU/, valueLine(onlyCount));
  const onlyPcu = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["pcu"] }),
    META,
  );
  assert.match(onlyPcu, /8,000\.0 PCU\/日/);
  assert.doesNotMatch(valueLine(onlyPcu), /輛\/日/, valueLine(onlyPcu));
});

test("全日與尖峰的單位分開標示，不會把全日標成每小時", () => {
  const text = buildConclusion(
    [row()],
    cond({ periods: ["all", "am"], metrics: ["count", "peakHour"] }),
    META,
  );
  assert.match(text, /全日：24 小時、10,000 輛\/日/);
  assert.match(text, /上午尖峰小時：07:00～08:00、1,200 輛\/hr/);
});

test("車種組成的百分比以該格總量為分母", () => {
  const text = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["composition"] }),
    META,
  );
  assert.match(text, /機車 6,000 輛\/日（60\.0%）/);
  assert.match(text, /小型車 3,500 輛\/日（35\.0%）/);
});

test("最大宗車種挑的是車輛數最多的那一種", () => {
  const text = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["topVehicle"] }),
    META,
  );
  assert.match(text, /最大宗車種為機車，6,000 輛\/日（佔 60\.0%）/);
});

test("沒勾「各方向分列」時只寫合計那一列", () => {
  const rows = [
    row({ scopeCode: "ALL", scopeName: "雙向合計" }),
    row({ scopeCode: "A", scopeName: "方向A" }),
    row({ scopeCode: "B", scopeName: "方向B" }),
  ];
  const without = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  assert.doesNotMatch(without, /方向A/);
  const with_ = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "directionSplit"] }),
    META,
  );
  assert.match(with_, /方向A/);
  assert.match(with_, /方向B/);
});

test("單位不一致時拒絕比較，並說明原因", () => {
  const rows = [
    row({ quarter: "115Q1" }),
    row({
      quarter: "115Q2",
      periods: {
        all: cell({ hour: "實測 8 小時（非 24 小時）", unitCount: "輛/調查時段" }),
      },
    }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["growth"], grouping: "byRoad" }),
    META,
  );
  assert.match(text, /單位不一致/);
  assert.doesNotMatch(text, /增加 0\.0%/);
});

test("季度變動只在同一路段、同一方向、同一日別之間計算", () => {
  const rows = [
    row({ quarter: "114Q1", periods: { all: cell({ total: 10000 }) } }),
    row({ quarter: "114Q4", periods: { all: cell({ total: 12500 }) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ scope: { kind: "year", year: "114" }, periods: ["all"], metrics: ["growth"] }),
    META,
  );
  assert.match(text, /由 114Q1 的 10,000 輛\/日 變為 114Q4 的 12,500 輛\/日/);
  assert.match(text, /增加 25\.0%/);
});

test("起始為 0 時不寫出無限大的百分比", () => {
  const rows = [
    row({ quarter: "114Q1", periods: { all: cell({ total: 0 }) } }),
    row({ quarter: "114Q2", periods: { all: cell({ total: 500 }) } }),
  ];
  const text = buildConclusion(rows, cond({ periods: ["all"], metrics: ["growth"] }), META);
  assert.match(text, /起始季為 0/);
  assert.doesNotMatch(text, /Infinity|NaN/);
});

test("平日假日對比只比同一路段同一季，且單位不同時不比", () => {
  const rows = [
    row({ dayType: "平日", periods: { all: cell({ total: 10000 }) } }),
    row({ dayType: "假日", periods: { all: cell({ total: 8000 }) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["dayCompare"], grouping: "byRoad" }),
    META,
  );
  assert.match(text, /平日 10,000 輛\/日、假日 8,000 輛\/日/);
  assert.match(text, /假日較平日少 20\.0%/);
});

test("最大最小只比合計列，混單位時不比", () => {
  const rows = [
    row({ roadId: "R-01", roadName: "中山路", periods: { all: cell({ total: 10000 }) } }),
    row({ roadId: "R-02", roadName: "示範南路", periods: { all: cell({ total: 4000 }) } }),
    row({ roadId: "R-01", scopeCode: "A", scopeName: "方向A", periods: { all: cell({ total: 99999 }) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["extremes"], grouping: "overall" }),
    META,
  );
  assert.match(text, /最高為 中山路/);
  assert.match(text, /最低為 示範南路/);
  assert.doesNotMatch(text, /99,999/, "方向列不可以拿來跟整條路段比");
});

test("部分時段調查會在文末註明不可與完整全日比較", () => {
  const text = buildConclusion(
    [row({ periods: { all: cell({ unitCount: "輛/調查時段" }) } })],
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  assert.match(text, /部分時段調查/);
  assert.match(text, /不可與完整全日的「輛\/日」直接比較/);
});

test("沒有資料的格子會明講，不會寫成 0", () => {
  const text = buildConclusion(
    [row({ periods: { all: cell({ hasData: false }) } })],
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  assert.match(text, /這一列沒有資料/);
  assert.doesNotMatch(text, /0 輛/);
});

test("條件挑不到資料時給的是可行動的說明", () => {
  const text = buildConclusion(
    [row({ quarter: "115Q2" })],
    cond({ scope: { kind: "quarter", quarter: "113Q1" } }),
    META,
  );
  assert.match(text, /所選條件沒有對應的資料/);
  assert.match(text, /請放寬季度範圍/);
});

test("三種分段方式都寫得出東西", () => {
  const rows = [row({ quarter: "115Q1" }), row({ quarter: "115Q2" })];
  for (const grouping of ["byRoad", "byQuarter", "overall"]) {
    const text = buildConclusion(
      rows,
      cond({ periods: ["all"], metrics: ["count"], grouping }),
      META,
    );
    assert.match(text, /^1\. /m, `${grouping} 應該有第 1 段`);
    assert.ok(text.length > 150, `${grouping} 不應該幾乎空白`);
  }
});

test("每一個可勾選指標都真的會改變輸出（沒有死選項）", () => {
  const rows = [
    row({ quarter: "114Q1", dayType: "平日" }),
    row({ quarter: "114Q2", dayType: "平日" }),
    row({ quarter: "114Q2", dayType: "假日" }),
    row({ quarter: "114Q2", roadId: "R-02", roadName: "示範南路" }),
    row({ quarter: "114Q2", scopeCode: "A", scopeName: "方向A" }),
  ];
  const base = cond({ periods: ["all", "am"], metrics: [], grouping: "byRoad" });
  const empty = buildConclusion(rows, base, META);
  for (const metric of CONCLUSION_METRICS) {
    const text = buildConclusion(rows, { ...base, metrics: [metric.key] }, META);
    assert.notEqual(
      text,
      empty,
      `勾選「${metric.label}」之後輸出必須有變化，否則就是死選項`,
    );
  }
});

test("標頭一定寫明全日與尖峰的單位規則", () => {
  const text = buildConclusion([row()], cond(), META);
  assert.match(text, /「全日」是一整天的加總/);
  assert.match(text, /尖峰數值是率，不跨調查點、跨季度相加/);
});
