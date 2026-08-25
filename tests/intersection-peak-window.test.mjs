import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import XLSXns from "xlsx";
import {
  armCodeOf,
  dayTypeOf,
  parseTrafficSheetValues,
} from "../app/traffic-parser.ts";
import { deriveDestinationIntersectionRecords } from "../app/intersection-flow.ts";
import { buildPeriodRows } from "../app/period-analysis.ts";

const XLSX = XLSXns.default ?? XLSXns;
const SAMPLE = new URL(
  "./fixtures/11017T1501中山北路岡山路口七叉路口.xls",
  import.meta.url,
);

const core = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const coreTurns = {
  motorcycle: { left: 0.5, through: 0.3, right: 0.4 },
  small: { left: 1.5, through: 1, right: 1.3 },
  large: { left: 2.3, through: 1.5, right: 2 },
  special: { left: 2.5, through: 2, right: 2.3 },
};
const ROUTES = {
  A: { B: "left", C: "left", D: "left", E: "through", F: "right", G: "right" },
  B: { C: "left", E: "left", F: "through", A: "right", G: "right" },
  C: { D: "left", E: "left", F: "left", G: "through", A: "right", B: "right" },
  D: { F: "left", G: "left", A: "right", B: "right", C: "right" },
  E: { F: "left", G: "left", A: "through", B: "right", C: "right" },
  F: { A: "left", G: "left", B: "through", C: "right", D: "right", E: "right" },
  G: { A: "left", B: "left", C: "through", D: "right", E: "right", F: "right" },
};
const PROJECT = "P1";
const ROAD = "11017T15-01";

function inboundRecords() {
  const book = XLSX.read(readFileSync(SAMPLE), { type: "buffer" });
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
        roadName: "中山北路/岡山路口(七叉路口)",
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
// 使用者參考檔「進入該路口交通量」：上午尖峰 07:15~08:15、下午尖峰 17:00~18:00
const EXPECT_AM = { A: 422.4, B: 414.3, C: 628.5, D: 56.2, E: 184.5, F: 1703.2, G: 567.5 };
const EXPECT_PM = { A: 548.5, B: 941.2, C: 1136.6, D: 129.8, E: 355.1, F: 765.1, G: 231.8 };

test("時段車種分析：路口各支線一律用「整個路口的尖峰時段」，與參考檔完全相符", () => {
  const rows = buildPeriodRows(inboundRecords(), { factors });
  const at = (code) => rows.find((row) => row.scopeCode === code);

  // 整個路口的尖峰時段
  assert.equal(at("ALL").periods.am.hour, "07:15～08:15");
  assert.equal(at("ALL").periods.pm.hour, "17:00～18:00");
  assert.equal(Number(at("ALL").periods.am.pcu.toFixed(1)), 3976.6);
  assert.equal(Number(at("ALL").periods.pm.pcu.toFixed(1)), 4108.1);

  for (const [code, value] of Object.entries(EXPECT_AM)) {
    const row = at(code);
    assert.equal(row.periods.am.hour, "07:15～08:15", `駛入路口${code} 的上午時段`);
    assert.equal(Number(row.periods.am.pcu.toFixed(1)), value, `駛入路口${code} 上午`);
  }
  for (const [code, value] of Object.entries(EXPECT_PM)) {
    const row = at(code);
    assert.equal(row.periods.pm.hour, "17:00～18:00", `駛入路口${code} 的下午時段`);
    assert.equal(Number(row.periods.pm.pcu.toFixed(1)), value, `駛入路口${code} 下午`);
  }

  // 各支線相加必須等於合計，否則那一欄不能拿來對報表
  for (const period of ["am", "pm"]) {
    const sum = Object.keys(EXPECT_AM).reduce(
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
  // 這正是使用者回報畫面上看到的那兩個值（432.2 與 447.9）
  assert.equal(at("A").periods.am.hour, "07:00～08:00");
  assert.equal(Number(at("A").periods.am.pcu.toFixed(1)), 432.2);
  assert.equal(at("B").periods.am.hour, "07:30～08:30");
  assert.equal(Number(at("B").periods.am.pcu.toFixed(1)), 447.9);
  // 下午七條支線的尖峰剛好都在同一小時，所以兩種模式的下午結果相同
  for (const [code, value] of Object.entries(EXPECT_PM)) {
    assert.equal(at(code).periods.pm.hour, "17:00～18:00");
    assert.equal(Number(at(code).periods.pm.pcu.toFixed(1)), value);
  }
});
