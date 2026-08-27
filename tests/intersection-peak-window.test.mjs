/*
 * 路口尖峰時段的認定：整個路口一個尖峰，或各支線各自認定。
 *
 * ⚠️ 2026-08-27 起改用當場產生的匿名樣本（見 tests/helpers/intersection-sample.mjs）。
 * 這一支原本讀 tests/fixtures/ 底下使用者客戶的真實調查表；那份檔案因此被
 * 提交進公開的 repository。改用樣本之後，期望的尖峰時段與 PCU 都由樣本的
 * 每一格真值**自己算一次滾動視窗**得到，不經過被測試的 period-analysis——
 * 期望值如果是用被測程式算出來的，這個測試就等於什麼都沒驗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import XLSXns from "xlsx";
import {
  armCodeOf,
  dayTypeOf,
  parseTrafficSheetValues,
} from "../app/traffic-parser.ts";
import { deriveDestinationIntersectionRecords } from "../app/intersection-flow.ts";
import { buildPeriodRows } from "../app/period-analysis.ts";
import {
  AM_RANGE,
  ARM_CODES,
  PERIODS,
  PM_RANGE,
  ROUTES,
  SAMPLE_IDENTITY,
  buildIntersectionWorkbook,
  inboundPcuBySlot,
  rollingPeak,
} from "./helpers/intersection-sample.mjs";

const XLSX = XLSXns.default ?? XLSXns;

const core = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const coreTurns = {
  motorcycle: { left: 0.5, through: 0.3, right: 0.4 },
  small: { left: 1.5, through: 1, right: 1.3 },
  large: { left: 2.3, through: 1.5, right: 2 },
  special: { left: 2.5, through: 2, right: 2.3 },
};
const PROJECT = "P1";
const ROAD = SAMPLE_IDENTITY.station;

function inboundRecords() {
  const book = XLSX.read(buildIntersectionWorkbook("biff8"), { type: "buffer" });
  const rows = [];
  for (const name of book.SheetNames) {
    const values = XLSX.utils.sheet_to_json(book.Sheets[name], {
      header: 1,
      defval: "",
    });
    if (!armCodeOf(values, name)) continue;
    rows.push(
      ...parseTrafficSheetValues(values, dayTypeOf(values) || "平日", "115Q2", {
        roadId: ROAD,
        roadName: SAMPLE_IDENTITY.name,
        a: "方向A",
        b: "方向B",
      }, { sheetName: name }),
    );
  }
  const withTurns = rows.map((row) => {
    const turnData = {};
    for (const [vehicle, byDestination] of Object.entries(
      row.destinationCounts ?? {},
    )) {
      const turns = { left: 0, through: 0, right: 0 };
      for (const [destination, count] of Object.entries(byDestination)) {
        const turn = ROUTES[row.directionCode]?.[destination];
        if (turn) turns[turn] += count;
      }
      turnData[vehicle] = turns;
    }
    return { ...row, projectId: PROJECT, turnData };
  });
  const settings = Object.entries(ROUTES).map(([code, routes], index) => ({
    projectId: PROJECT,
    roadId: ROAD,
    directionCode: code,
    name: `路口${code}`,
    angle: -90 + (index * 360) / 7,
    routes,
  }));
  return deriveDestinationIntersectionRecords(withTurns, PROJECT, settings);
}

const factors = { core, coreTurns, settings: [] };

/* 由樣本真值獨立算出來的答案。 */
const slots = inboundPcuBySlot(coreTurns);
const allSlots = PERIODS.map((_unused, index) =>
  ARM_CODES.reduce((sum, code) => sum + slots[code][index], 0),
);
const OVERALL_AM = rollingPeak(allSlots, ...AM_RANGE);
const OVERALL_PM = rollingPeak(allSlots, ...PM_RANGE);
/** 用「整個路口的尖峰時段」去切每一條支線的量。 */
function armPcuInWindow(code, hour) {
  const start = PERIODS.findIndex((label) => label.startsWith(hour.split("～")[0]));
  return Number(
    slots[code].slice(start, start + 4).reduce((a, b) => a + b, 0).toFixed(1),
  );
}

test("樣本要有「各支線尖峰時段不同」的形狀，否則兩種模式驗不出差別", () => {
  const own = ARM_CODES.map((code) => rollingPeak(slots[code], ...AM_RANGE).hour);
  assert.ok(
    new Set(own).size > 1,
    `樣本裡每一條支線的上午尖峰都一樣（${own.join("、")}），驗不到「各方向各自認定」`,
  );
  assert.ok(
    own.some((hour) => hour !== OVERALL_AM.hour),
    "至少要有一條支線的尖峰和整個路口不同",
  );
});

test("時段車種分析：路口各支線一律用「整個路口的尖峰時段」", () => {
  const rows = buildPeriodRows(inboundRecords(), { factors });
  const at = (code) => rows.find((row) => row.scopeCode === code);

  assert.equal(at("ALL").periods.am.hour, OVERALL_AM.hour);
  assert.equal(at("ALL").periods.pm.hour, OVERALL_PM.hour);
  assert.equal(Number(at("ALL").periods.am.pcu.toFixed(1)), OVERALL_AM.pcu);
  assert.equal(Number(at("ALL").periods.pm.pcu.toFixed(1)), OVERALL_PM.pcu);

  for (const code of ARM_CODES) {
    const row = at(code);
    assert.equal(row.periods.am.hour, OVERALL_AM.hour, `駛入路口${code} 的上午時段`);
    assert.equal(
      Number(row.periods.am.pcu.toFixed(1)),
      armPcuInWindow(code, OVERALL_AM.hour),
      `駛入路口${code} 上午`,
    );
    assert.equal(row.periods.pm.hour, OVERALL_PM.hour, `駛入路口${code} 的下午時段`);
    assert.equal(
      Number(row.periods.pm.pcu.toFixed(1)),
      armPcuInWindow(code, OVERALL_PM.hour),
      `駛入路口${code} 下午`,
    );
  }

  // 各支線相加必須等於合計，否則那一欄不能拿來對報表
  for (const period of ["am", "pm"]) {
    const sum = ARM_CODES.reduce(
      (total, code) => total + at(code).periods[period].pcu,
      0,
    );
    assert.equal(
      Number(sum.toFixed(1)),
      Number(at("ALL").periods[period].pcu.toFixed(1)),
      `${period} 各支線相加應等於合計`,
    );
  }
});

test("切成「各方向各自認定」時，會回到各支線自己的尖峰時段", () => {
  const rows = buildPeriodRows(inboundRecords(), {
    factors,
    peakScope: "direction",
  });
  const at = (code) => rows.find((row) => row.scopeCode === code);
  let differed = 0;
  for (const code of ARM_CODES) {
    const own = rollingPeak(slots[code], ...AM_RANGE);
    assert.equal(at(code).periods.am.hour, own.hour, `路口${code} 自己的上午尖峰`);
    assert.equal(Number(at(code).periods.am.pcu.toFixed(1)), own.pcu, `路口${code} 上午`);
    if (own.hour !== OVERALL_AM.hour) differed += 1;
    const ownPm = rollingPeak(slots[code], ...PM_RANGE);
    assert.equal(at(code).periods.pm.hour, ownPm.hour, `路口${code} 自己的下午尖峰`);
    assert.equal(Number(at(code).periods.pm.pcu.toFixed(1)), ownPm.pcu, `路口${code} 下午`);
  }
  assert.ok(
    differed > 0,
    "兩種模式算出來完全一樣，代表這個測試沒有驗到差別",
  );
});
