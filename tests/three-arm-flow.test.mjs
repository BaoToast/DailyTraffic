/*
 * 三岔路口的駛入／駛出推導：不可以憑空多出流向，也不可以把量到的車丟掉。
 *
 * 背景：路口轉向那一支在三岔路口上有「同一個目的路口重複列兩次」的問題
 * （9 條流向裡有 3 條是調查表上寫 `--`、根本不存在的轉向）。
 * 使用者要求三支系統都確認同一件事，所以這一支把本系統的行為釘住。
 *
 * 本系統的做法不一樣，**沒有那個症狀**：
 *   deriveDestinationIntersectionRecords() 的 addCount() 第一行就是
 *   `if (!count) return;`，數量為 0 的轉向根本不會產生任何目的地紀錄。
 *   所以「調查表寫 `--`」與「真的量到 0」在這裡的輸出完全相同（都是沒有），
 *   不會冒出重複的空列。
 *
 * 真正要盯的是另一件事：**支線角度沒設定好時，車流會掉進 UNMAPPED**。
 * 三支支線只有兩個去向，`completeArmTargets()` 給每一支恰好 2 個目標，
 * 剩下的那一個轉向如果有車，就會被歸到 UNMAPPED。
 * 用實測數字（某三岔路口 AM 5,831 輛）量到：
 *   ・角度用預設值（未設定）→ 3,612 輛（62%）掉進 UNMAPPED
 *   ・角度設成實際幾何       → 0 輛 UNMAPPED，逐支線都對得上
 * 兩種情況總量都守恆（5,831 → 5,831），所以不會多算也不會少算，
 * 但沒設定角度時的 OD 歸屬是錯的——這就是匯入時那個
 * 「多支線角度、轉向圖與流向確認」視窗存在的理由。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArmSettings,
  deriveDestinationIntersectionRecords,
} from "../app/intersection-flow.ts";

const PROJECT = "P-1";

/**
 * 一支支線的一個小時。左／直／右用真實三岔檔的數字
 *（取自一份真實三岔調查檔的 AM 尖峰，四車種合計；
 *  站號與路口名稱刻意不寫進原始碼，本專案有守門禁止——
 *  見 tests/dependency-manifest.test.mjs）。
 */
function arm(directionCode, left, through, right) {
  const total = left + through + right;
  return {
    projectId: PROJECT,
    quarter: "115Q2",
    roadId: "R-01",
    roadName: "三岔示範路口",
    dayType: "平日",
    directionCode,
    directionName: "路口" + directionCode,
    hour: "08",
    surveyType: "intersection",
    turnData: {
      motorcycle: { left, through, right },
      small: { left: 0, through: 0, right: 0 },
      large: { left: 0, through: 0, right: 0 },
      special: { left: 0, through: 0, right: 0 },
    },
    motorcycle: total,
    small: 0,
    large: 0,
    special: 0,
    vehicleCounts: { motorcycle: total },
    vehicleLabels: { motorcycle: "機車" },
  };
}

/*
 * 真實三岔檔的形狀：A 沒有右轉、B 沒有直進、C 沒有左轉
 *（那三欄在原始檔裡是 `--`，解析後一律是 0）。
 */
const ROWS = [arm("A", 582, 3018, 0), arm("B", 296, 0, 63), arm("C", 0, 1574, 298)];
const TOTAL = 5831;

/** 實際幾何：A 南 90°、B 西 180°、C 北 -90°。 */
const GEOMETRY = [
  { projectId: PROJECT, roadId: "R-01", directionCode: "A", name: "南側", angle: 90, routes: {} },
  { projectId: PROJECT, roadId: "R-01", directionCode: "B", name: "西側", angle: 180, routes: {} },
  { projectId: PROJECT, roadId: "R-01", directionCode: "C", name: "北側", angle: -90, routes: {} },
];

const sumOf = (records) =>
  records.reduce((sum, record) => sum + (Number(record.motorcycle) || 0), 0);

test("前置：樣本就是真實三岔檔的形狀與總量", () => {
  assert.equal(sumOf(ROWS), TOTAL);
  /* 三個「不存在的轉向」在原始檔是 `--`，解析後是 0 */
  assert.equal(ROWS[0].turnData.motorcycle.right, 0);
  assert.equal(ROWS[1].turnData.motorcycle.through, 0);
  assert.equal(ROWS[2].turnData.motorcycle.left, 0);
});

test("設定好支線角度之後，三岔路口不會有任何車掉進 UNMAPPED", () => {
  const out = deriveDestinationIntersectionRecords(ROWS, PROJECT, GEOMETRY);
  const unmapped = out.filter((record) => record.directionCode === "UNMAPPED");
  assert.deepEqual(
    unmapped.map((record) => record.motorcycle),
    [],
    "設定好角度之後不該有 UNMAPPED",
  );
  assert.equal(sumOf(out), TOTAL, "推導前後總量必須守恆");
});

test("三岔路口不會冒出重複或憑空的目的地紀錄", () => {
  const out = deriveDestinationIntersectionRecords(ROWS, PROJECT, GEOMETRY);
  /*
   * 三支支線 → 最多三筆（每支一筆）。
   * 這一項釘住「不會像路口轉向那樣多出空列」：
   * 數量為 0 的轉向不產生紀錄，所以 `--` 與真的 0 在這裡的輸出相同。
   */
  assert.ok(out.length <= 3, `不該多於三筆，實際 ${out.length} 筆`);
  const codes = out.map((record) => record.directionCode).sort();
  assert.deepEqual(new Set(codes).size, codes.length, "同一支線不該出現兩筆");
});

test("沒設定角度時，車流會掉進 UNMAPPED——這就是匯入時要跳確認視窗的理由", () => {
  /*
   * 這一項是**現況說明**，不是問題重現：它對修正前後都是綠的。
   * 留著是為了讓「為什麼要有那個確認視窗」有一份可執行的證據，
   * 日後有人想把視窗拿掉時，這裡會提醒他代價是什麼。
   */
  const settings = buildArmSettings(PROJECT, "R-01", ["A", "B", "C"], []);
  assert.equal(settings.length, 3);
  const out = deriveDestinationIntersectionRecords(ROWS, PROJECT, []);
  const unmapped = sumOf(out.filter((record) => record.directionCode === "UNMAPPED"));
  assert.ok(unmapped > 0, "未設定角度時預期會有 UNMAPPED");
  assert.equal(sumOf(out), TOTAL, "即使歸屬不對，總量仍必須守恆");
});
