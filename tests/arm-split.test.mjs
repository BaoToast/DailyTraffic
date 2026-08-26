/*
 * 多個路口並排在同一張工作表時，要照「路口編號」切，不可以用猜的。
 *
 * 起因（使用者回報，2026-08-26）：一份四個路口的調查表匯入後
 * **只讀到路口A**，而且那一筆的車輛數是四個路口相加。
 *
 * 成因：舊寫法靠「車種標題重複的週期」推測每個路口佔幾欄。各路口的車種
 * 標題一模一樣時猜得對；但那份檔案的路口A、B 寫「大型車／特種車」，
 * 路口C、D 卻寫「大貨車／大客車」（調查表的筆誤），週期就不成立，
 * repeatedVehicleCount 退回「整列都是同一組」，於是四個路口的欄位被當成
 * 一個路口：只產生一筆紀錄，車輛數是四個相加。
 *
 * **最危險的是它不會報錯。** 匯入照樣顯示成功，數字看起來也合理
 *（實測 57＋4＋90＋4＝155 記在路口A 底下），畫面上完全看不出來。
 * 使用者是因為車種名稱剛好很怪才發現；如果不一致的地方比較細微
 *（例如某個路口把「大型車」打成「大車」），就沒有任何線索了。
 *
 * 所以這裡釘住兩件事：
 *   1. 各路口車種一致時，結果不能變（迴歸保護）。
 *   2. 各路口車種不一致時，仍然要切出正確的路口數與正確的數字。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseTrafficSheetValues } from "../app/traffic-parser.ts";

const IDENTITY = { roadId: "R1", roadName: "測試路口", a: "方向A", b: "方向B" };

/**
 * 組出一張「多路口並排」的工作表，格式與真實調查表相同：
 *   第 4 列：路口編號：路口A … 路口編號：路口B …
 *   第 5 列：時間 | 機車 |  |  | 小型車 |  |  | …（合併儲存格只在第一欄留字）
 *   第 6 列：      | 左轉 | 直進 | 右轉 | …
 *   第 7 列起：資料
 *
 * `arms` 的每一項是 { vehicles: string[], counts: number[][] }，
 * counts[車種][轉向]。每個路口之間留兩個空欄，和真實檔案一樣。
 */
function buildSheet(arms) {
  const markerRow = [];
  const vehicleRow = [];
  const turnRow = [];
  const dataRow = [];
  for (const arm of arms) {
    const start = markerRow.length;
    markerRow[start] = `路口編號：路口${arm.code}`;
    vehicleRow[start] = "時間";
    turnRow[start] = "";
    dataRow[start] = "00:00～01:00";
    arm.vehicles.forEach((label, vehicleIndex) => {
      const base = start + 1 + vehicleIndex * 3;
      /* 合併儲存格：車種名稱只出現在三欄的第一欄 */
      vehicleRow[base] = label;
      vehicleRow[base + 1] = "";
      vehicleRow[base + 2] = "";
      ["左轉", "直進", "右轉"].forEach((turn, turnIndex) => {
        turnRow[base + turnIndex] = turn;
        dataRow[base + turnIndex] = arm.counts[vehicleIndex][turnIndex];
      });
    });
    /* 路口之間的空白欄 */
    const end = start + 1 + arm.vehicles.length * 3;
    markerRow[end] = "";
    markerRow[end + 1] = "";
  }
  const width = markerRow.length;
  const fill = (row) =>
    Array.from({ length: width }, (_unused, index) => row[index] ?? "");
  return [
    fill([]),
    fill([]),
    fill([]),
    fill(markerRow),
    fill(vehicleRow),
    fill(turnRow),
    fill(dataRow),
  ];
}

const STANDARD = ["機車", "小型車", "大型車", "特種車"];
const counts = (base) =>
  STANDARD.map((_unused, index) => [base + index, base + index * 2, 0]);

test("各路口車種一致時，切出每一個路口且數字各自獨立", () => {
  const values = buildSheet([
    { code: "A", vehicles: STANDARD, counts: counts(10) },
    { code: "B", vehicles: STANDARD, counts: counts(20) },
    { code: "C", vehicles: STANDARD, counts: counts(30) },
  ]);
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", IDENTITY, {});
  assert.deepEqual(
    rows.map((row) => row.directionCode),
    ["A", "B", "C"],
  );
  /* 機車＝左＋直＋右，每個路口用自己的數字，不可以互相混到 */
  assert.deepEqual(
    rows.map((row) => row.motorcycle),
    [10 + 10, 20 + 20, 30 + 30],
  );
});

test("某個路口的車種名稱不一樣時，仍要切出全部路口、數字不可相加", () => {
  /*
   * 這正是使用者那一份檔案的形狀：A、B 用大型車／特種車，
   * C、D 用大貨車／大客車。舊版在這裡只會回傳一筆路口A，
   * 而且 motorcycle 是四個路口的總和。
   */
  const odd = ["機車", "小型車", "大貨車", "大客車"];
  const values = buildSheet([
    { code: "A", vehicles: STANDARD, counts: counts(10) },
    { code: "B", vehicles: STANDARD, counts: counts(20) },
    { code: "C", vehicles: odd, counts: counts(30) },
    { code: "D", vehicles: odd, counts: counts(40) },
  ]);
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", IDENTITY, {});

  assert.deepEqual(
    rows.map((row) => row.directionCode),
    ["A", "B", "C", "D"],
    "四個路口都要出現——舊版只會給一筆路口A",
  );
  assert.deepEqual(
    rows.map((row) => row.motorcycle),
    [20, 40, 60, 80],
    "每個路口用自己的機車數；舊版會把四個相加後全記在路口A",
  );
  /* 沒有任何一筆的數字等於四個路口的總和（那就是舊版的錯誤結果） */
  const total = 20 + 40 + 60 + 80;
  assert.ok(
    rows.every((row) => row.motorcycle !== total),
    "不可以出現「四個路口相加」的那個數字",
  );
});

test("不一樣的車種名稱保留原樣，不會被自動改成別的分類", () => {
  /*
   * 大貨車與大客車依檔案自己的註解都屬於「大型車」，但路口C、D 根本
   * 沒有特種車欄位——自動對應會把「沒有調查」寫成「特種車＝0」，
   * 那是憑空斷言。所以保留原名稱當自訂車種，由匯入流程請使用者確認。
   */
  const values = buildSheet([
    { code: "A", vehicles: STANDARD, counts: counts(10) },
    { code: "B", vehicles: ["機車", "小型車", "大貨車", "大客車"], counts: counts(20) },
  ]);
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", IDENTITY, {});
  const armB = rows.find((row) => row.directionCode === "B");
  const labels = Object.values(armB.vehicleLabels ?? {});
  assert.ok(labels.includes("大貨車"), "大貨車要保留原名稱");
  assert.ok(labels.includes("大客車"), "大客車要保留原名稱");
  assert.equal(armB.special, 0, "路口B 沒有特種車欄位，不應該憑空生出數字");
});

test("沒有「路口編號」標記的檔案，仍走原本的週期推測", () => {
  /* 舊格式（路段檔）沒有那個標記，行為必須完全不變。 */
  const values = [
    ["時間", "機車", "", "", "小型車", "", "", "機車", "", "", "小型車", "", ""],
    ["", "左轉", "直進", "右轉", "左轉", "直進", "右轉", "左轉", "直進", "右轉", "左轉", "直進", "右轉"],
    ["00:00～01:00", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", IDENTITY, {});
  assert.deepEqual(
    rows.map((row) => row.directionCode),
    ["A", "B"],
  );
  assert.deepEqual(
    rows.map((row) => row.motorcycle),
    [1 + 2 + 3, 7 + 8 + 9],
  );
});
