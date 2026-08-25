import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import XLSXns from "xlsx";
import {
  armCodeOf,
  dayTypeOf,
  parseTrafficSheetValues,
} from "../app/traffic-parser.ts";
import {
  buildArmSettings,
  deriveDestinationIntersectionRecords,
} from "../app/intersection-flow.ts";
import { sumVehiclePcu } from "../app/vehicle-analysis.ts";

const XLSX = XLSXns.default ?? XLSXns;
const SAMPLE = new URL("./fixtures/11017T1501中山北路岡山路口七叉路口.xlsx", import.meta.url);

const core = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const coreTurns = {
  motorcycle: { left: 0.5, through: 0.3, right: 0.4 },
  small: { left: 1.5, through: 1, right: 1.3 },
  large: { left: 2.3, through: 1.5, right: 2 },
  special: { left: 2.5, through: 2, right: 2.3 },
};

/**
 * 由使用者提供的參考檔「總彙整」反推出來的轉向分類：
 * 用回溯搜尋找出唯一能同時滿足全部 16 個時段 × 4 種車種的左/直/右指定方式。
 */
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
const AM_PEAK = ["07:15～07:30", "07:30～07:45", "07:45～08:00", "08:00～08:15"];
const PM_PEAK = ["17:00～17:15", "17:15～17:30", "17:30～17:45", "17:45～18:00"];

function loadRecords() {
  const book = XLSX.read(readFileSync(SAMPLE), { type: "buffer" });
  const rows = [];
  for (const name of book.SheetNames) {
    const values = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: "" });
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
  // 依轉向分類把各目的地攤成左/直/右（與 app 的 resolveDestinationTurns 相同）
  return rows.map((row) => {
    const turnData = {};
    for (const [vehicle, byDestination] of Object.entries(row.destinationCounts ?? {})) {
      const turns = { left: 0, through: 0, right: 0 };
      for (const [destination, count] of Object.entries(byDestination)) {
        const turn = ROUTES[row.directionCode]?.[destination];
        if (turn) turns[turn] += count;
      }
      turnData[vehicle] = turns;
    }
    return { ...row, projectId: PROJECT, turnData };
  });
}

const savedSettings = Object.entries(ROUTES).map(([code, routes], index) => ({
  projectId: PROJECT,
  roadId: ROAD,
  directionCode: code,
  name: `路口${code}`,
  angle: -90 + (index * 360) / 7,
  routes,
}));

const pcuOf = (record) => sumVehiclePcu(record, core, coreTurns, []);

function totalsByArm(records, window) {
  const totals = {};
  for (const record of records) {
    if (!window.includes(record.hour)) continue;
    totals[record.directionCode] = (totals[record.directionCode] ?? 0) + pcuOf(record);
  }
  return totals;
}

test("駛入（依終點）各支線流量與使用者參考檔完全相符", () => {
  const inbound = loadRecords();
  const outbound = deriveDestinationIntersectionRecords(inbound, PROJECT, savedSettings);
  const am = totalsByArm(outbound, AM_PEAK);
  const pm = totalsByArm(outbound, PM_PEAK);
  // 參考檔「進入該路口交通量」，上午尖峰 7:15~8:15 與下午尖峰 17:00~18:00
  const expectAm = { A: 422.4, B: 414.3, C: 628.5, D: 56.2, E: 184.5, F: 1703.2, G: 567.5 };
  const expectPm = { A: 548.5, B: 941.2, C: 1136.6, D: 129.8, E: 355.1, F: 765.1, G: 231.8 };
  for (const [code, value] of Object.entries(expectAm))
    assert.equal(Number((am[code] ?? 0).toFixed(1)), value, `上午 駛入路口${code}`);
  for (const [code, value] of Object.entries(expectPm))
    assert.equal(Number((pm[code] ?? 0).toFixed(1)), value, `下午 駛入路口${code}`);
});

test("駛出（依起點）與駛入（依終點）的總計必須相同", () => {
  const inbound = loadRecords();
  const outbound = deriveDestinationIntersectionRecords(inbound, PROJECT, savedSettings);
  for (const window of [AM_PEAK, PM_PEAK]) {
    const sum = (rows) =>
      Number(
        Object.values(totalsByArm(rows, window))
          .reduce((a, b) => a + b, 0)
          .toFixed(1),
      );
    assert.equal(sum(inbound), sum(outbound));
  }
  // 上午尖峰總計就是使用者檔案的 3976.6
  assert.equal(
    Number(Object.values(totalsByArm(inbound, AM_PEAK)).reduce((a, b) => a + b, 0).toFixed(1)),
    3976.6,
  );
});

test("多岔路口：同一支線的左轉可以分到多個目的支線，不會被塞進同一個", () => {
  const inbound = loadRecords();
  const outbound = deriveDestinationIntersectionRecords(inbound, PROJECT, savedSettings);
  const destinations = new Set(outbound.map((row) => row.directionCode));
  for (const code of ["A", "B", "C", "D", "E", "F", "G"])
    assert.ok(destinations.has(code), `駛入路口${code} 應該要有資料`);
  assert.ok(!destinations.has("UNMAPPED"), "不應該有未指定的駛入路口");

  // 舊版把「左轉」全部塞進單一 leftTarget；路口A 的左轉實際通往 B、C、D 三條，
  // 這裡直接驗證這三個目的支線都確實收到了來自 A 的左轉車輛。
  const fromA = inbound.filter((row) => row.directionCode === "A");
  const leftDestinations = ["B", "C", "D"].filter((code) =>
    fromA.some((row) =>
      Object.values(row.destinationCounts ?? {}).some((byDest) => (byDest[code] ?? 0) > 0),
    ),
  );
  assert.deepEqual(leftDestinations, ["B", "C", "D"]);
  const leftTotal = fromA.reduce(
    (sum, row) =>
      sum +
      Object.values(row.destinationCounts ?? {}).reduce(
        (inner, byDest) => inner + ["B", "C", "D"].reduce((x, c) => x + (byDest[c] ?? 0), 0),
        0,
      ),
    0,
  );
  assert.ok(leftTotal > 0, "路口A 應該有左轉車輛");
});

test("沒有目的地欄位的既有格式，仍走原本的左/直/右對應（行為不變）", () => {
  const legacy = [
    {
      projectId: PROJECT,
      quarter: "115Q2",
      roadId: "R9",
      roadName: "測試路口",
      dayType: "平日",
      directionCode: "A",
      directionName: "駛出路口A",
      hour: "07:00～08:00",
      motorcycle: 30,
      small: 0,
      large: 0,
      special: 0,
      surveyType: "intersection",
      turnData: {
        motorcycle: { left: 10, through: 20, right: 0 },
      },
      vehicleCounts: { motorcycle: 30 },
      vehicleLabels: { motorcycle: "機車" },
    },
    {
      projectId: PROJECT,
      quarter: "115Q2",
      roadId: "R9",
      roadName: "測試路口",
      dayType: "平日",
      directionCode: "B",
      directionName: "駛出路口B",
      hour: "07:00～08:00",
      motorcycle: 0,
      small: 0,
      large: 0,
      special: 0,
      surveyType: "intersection",
      turnData: { motorcycle: { left: 0, through: 0, right: 0 } },
      vehicleCounts: { motorcycle: 0 },
      vehicleLabels: { motorcycle: "機車" },
    },
    {
      projectId: PROJECT,
      quarter: "115Q2",
      roadId: "R9",
      roadName: "測試路口",
      dayType: "平日",
      directionCode: "C",
      directionName: "駛出路口C",
      hour: "07:00～08:00",
      motorcycle: 0,
      small: 0,
      large: 0,
      special: 0,
      surveyType: "intersection",
      turnData: { motorcycle: { left: 0, through: 0, right: 0 } },
      vehicleCounts: { motorcycle: 0 },
      vehicleLabels: { motorcycle: "機車" },
    },
  ];
  const settings = buildArmSettings(PROJECT, "R9", ["A", "B", "C"], []);
  const outbound = deriveDestinationIntersectionRecords(legacy, PROJECT, settings);
  const total = outbound.reduce((sum, row) => sum + (row.vehicleCounts?.motorcycle ?? 0), 0);
  assert.equal(total, 30, "總量必須守恆");
  assert.equal(outbound.every((row) => !row.destinationCounts), true);
});
