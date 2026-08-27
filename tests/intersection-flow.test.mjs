/*
 * 七叉路口的「駛入」推導（依終點重新分組）。
 *
 * ⚠️ 2026-08-27 起改用**當場產生的匿名樣本**。
 * 這一支原本讀 tests/fixtures/ 底下使用者客戶的真實調查表，那份檔案
 * 因此被提交進公開的 repository、還能從 GitHub Pages 直接下載。
 * 測試需要的是「這種檔案長什麼樣」，不是「這一份實際調查到多少車」，
 * 所以改由 tests/helpers/intersection-sample.mjs 產生結構相同、數字自己編的檔案。
 *
 * 期望值也跟著變得更嚴格：以前是拿使用者參考檔的**彙總數字**來比，
 * 現在是拿樣本的**每一格真值**自己加總出來比，而且那個加總完全不經過
 * 被測試的程式。
 */
import assert from "node:assert/strict";
import test from "node:test";
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
import {
  AM_PEAK,
  ARM_CODES,
  ROUTES,
  SAMPLE_IDENTITY,
  PM_PEAK,
  buildIntersectionWorkbook,
  destinationsOf,
  expectedInboundPcu,
  expectedOutboundPcu,
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

function loadRecords() {
  const book = XLSX.read(buildIntersectionWorkbook("xlsx"), { type: "buffer" });
  const rows = [];
  for (const name of book.SheetNames) {
    const values = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, defval: "" });
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

test("樣本本身要有「各支線規模不同」的形狀，否則下面的測試驗不到東西", () => {
  const out = expectedOutboundPcu(AM_PEAK, coreTurns);
  const values = ARM_CODES.map((code) => out[code]);
  assert.ok(Math.max(...values) > Math.min(...values) * 5, "各支線流量太平均");
  assert.ok(values.every((value) => value > 0), "每一條支線都要有車");
});

test("駛入（依終點）各支線流量與樣本真值完全相符", () => {
  const inbound = loadRecords();
  const outbound = deriveDestinationIntersectionRecords(inbound, PROJECT, savedSettings);
  const am = totalsByArm(outbound, AM_PEAK);
  const pm = totalsByArm(outbound, PM_PEAK);
  const expectAm = expectedInboundPcu(AM_PEAK, coreTurns);
  const expectPm = expectedInboundPcu(PM_PEAK, coreTurns);
  for (const [code, value] of Object.entries(expectAm))
    assert.equal(Number((am[code] ?? 0).toFixed(1)), value, `上午 駛入路口${code}`);
  for (const [code, value] of Object.entries(expectPm))
    assert.equal(Number((pm[code] ?? 0).toFixed(1)), value, `下午 駛入路口${code}`);
});

test("駛出（依起點）也要與樣本真值相符，而且總計與駛入相同", () => {
  const inbound = loadRecords();
  const outbound = deriveDestinationIntersectionRecords(inbound, PROJECT, savedSettings);
  for (const window of [AM_PEAK, PM_PEAK]) {
    const expectOut = expectedOutboundPcu(window, coreTurns);
    const actualOut = totalsByArm(inbound, window);
    for (const [code, value] of Object.entries(expectOut))
      assert.equal(Number((actualOut[code] ?? 0).toFixed(1)), value, `駛出路口${code}`);
    const sum = (rows) =>
      Number(
        Object.values(totalsByArm(rows, window))
          .reduce((a, b) => a + b, 0)
          .toFixed(1),
      );
    assert.equal(sum(inbound), sum(outbound), "同一批車換個分組，總量不能變");
  }
});

test("多岔路口：同一支線的左轉可以分到多個目的支線，不會被塞進同一個", () => {
  const inbound = loadRecords();
  const outbound = deriveDestinationIntersectionRecords(inbound, PROJECT, savedSettings);
  const destinations = new Set(outbound.map((row) => row.directionCode));
  for (const code of ARM_CODES)
    assert.ok(destinations.has(code), `駛入路口${code} 應該要有資料`);
  assert.ok(!destinations.has("UNMAPPED"), "不應該有未指定的駛入路口");

  // 舊版把「左轉」全部塞進單一 leftTarget；路口A 的左轉實際通往多條支線，
  // 這裡直接驗證每一條左轉目的支線都確實收到了來自 A 的車。
  const leftTargets = destinationsOf("A").filter((code) => ROUTES.A[code] === "left");
  assert.ok(leftTargets.length > 1, "樣本要有「一個轉向對多個目的地」才驗得到");
  const fromA = inbound.filter((row) => row.directionCode === "A");
  const reached = leftTargets.filter((code) =>
    fromA.some((row) =>
      Object.values(row.destinationCounts ?? {}).some((byDest) => (byDest[code] ?? 0) > 0),
    ),
  );
  assert.deepEqual(reached, leftTargets);
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
