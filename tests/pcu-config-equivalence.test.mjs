import assert from "node:assert/strict";
import test from "node:test";
import { buildPeriodRows } from "../app/period-analysis.ts";
import { hasNonZeroVehiclePcu } from "../app/vehicle-analysis.ts";

const ROAD_ID = "A00T00-01";
const QUARTER = "2026Q1";
const keys = ["motorcycle", "small", "large", "special"];
const turnsFor = (core) => Object.fromEntries(
  keys.map((key) => [key, { left: core[key], through: core[key], right: core[key] }]),
);
const base = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };

function record(hour, counts) {
  return {
    projectId: "P1",
    quarter: QUARTER,
    roadId: ROAD_ID,
    roadName: "匿名測試路段",
    dayType: "平日",
    directionCode: "A",
    directionName: "A 方向",
    hour,
    surveyType: "road",
    motorcycle: counts.motorcycle ?? 0,
    small: counts.small ?? 0,
    large: counts.large ?? 0,
    special: counts.special ?? 0,
    vehicleCounts: counts,
  };
}

function factors(core, scopes = []) {
  return { core, coreTurns: turnsFor(core), settings: [], scopes };
}

test("A27 同一格的係數設定狀態等於逐筆非零 PCU 的邏輯或（含範圍覆寫）", () => {
  const zero = { motorcycle: 0, small: 0, large: 0, special: 0 };
  const cancel = { ...base, small: 1, large: -1 };
  const negative = { ...base, small: -2 };
  const mixed = { ...zero, large: 2 };
  const scoped = { ...zero, small: 3 };
  const cases = [
    { name: "一般正係數", factors: factors(base), records: [record("07:00～08:00", { small: 5 })] },
    { name: "正負抵銷成零", factors: factors(cancel), records: [record("08:00～09:00", { small: 5, large: 5 })] },
    { name: "合計為負", factors: factors(negative), records: [record("09:00～10:00", { small: 5 })] },
    { name: "係數真的全零", factors: factors(zero), records: [record("10:00～11:00", { small: 5 })] },
    {
      name: "同格兩筆的邏輯或",
      factors: factors(mixed),
      records: [record("11:00～12:00", { small: 5 }), record("11:00～12:00", { large: 2 })],
    },
    {
      name: "季別與路段專屬覆寫",
      factors: factors(zero, [{
        quarter: QUARTER,
        roadId: ROAD_ID,
        factors: { core: scoped, coreTurns: turnsFor(scoped) },
      }]),
      records: [record("13:00～14:00", { small: 5 })],
    },
  ];

  let nonEmptyBuckets = 0;
  for (const entry of cases) {
    const { core, coreTurns, settings, scopes } = entry.factors;
    const recordOr = entry.records.some((item) =>
      hasNonZeroVehiclePcu(item, core, coreTurns, settings, scopes),
    );
    const row = buildPeriodRows(entry.records, { factors: entry.factors })
      .find((item) => item.scopeCode === "ALL");
    assert.ok(row, `${entry.name} 的 ${entry.records[0].hour} 沒有產生 ALL 列`);
    const bucket = row.periods.all;
    assert.equal(bucket.hasData, true, `${entry.name} 的 ${entry.records[0].hour} 沒有產生非空 bucket`);
    assert.ok(bucket.total > 0, `${entry.name} 的 ${entry.records[0].hour} 必須真的量到車`);
    nonEmptyBuckets += 1;
    const bucketConfigured = !bucket.pcuUnset;
    assert.equal(
      bucketConfigured,
      recordOr,
      `${entry.name}｜${entry.records[0].hour}：逐格 hasNonzeroPcu=${bucketConfigured}，` +
        `逐筆 hasNonZeroVehiclePcu 的邏輯或=${recordOr}（${entry.records.length} 筆）`,
    );
  }
  assert.ok(nonEmptyBuckets >= 5, `前置檢查：只驗到 ${nonEmptyBuckets} 個非空 bucket`);
});
