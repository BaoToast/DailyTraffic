import assert from "node:assert/strict";
import test from "node:test";
import initialData from "../app/traffic-data.json" with { type: "json" };
import {
  headerDateCells,
  parseTrafficSheetValues,
} from "../app/traffic-parser.ts";
import { findSurveyDate } from "../app/period-date.ts";

const identity = { roadId: "T-01", roadName: "測試調查點", a: "往北", b: "往南" };
const hours = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00～${String((hour + 1) % 24).padStart(2, "0")}:00`);

test("原雙向路段格式維持 A/B 方向與四車種", () => {
  const values = [
    ["時間", "機車", "小型車", "大型車", "特種車", "機車", "小型車", "大型車", "特種車"],
    ...hours.map(hour => [hour, 10, 20, 3, 1, 11, 21, 4, 2]),
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity);
  assert.equal(rows.length, 48);
  assert.deepEqual([...new Set(rows.map(row => row.directionCode))], ["A", "B"]);
  assert.equal(rows.filter(row => row.directionCode === "A").reduce((sum, row) => sum + row.motorcycle, 0), 240);
  assert.equal(rows.filter(row => row.directionCode === "B").reduce((sum, row) => sum + row.special, 0), 48);
  assert.deepEqual(rows[0].vehicleLabels, { motorcycle: "機車", small: "小型車", large: "大型車", special: "特種車" });
});

test("原11路段基準資料的平日總量與PCU維持不變", () => {
  const rows = initialData.records.filter((row) => row.dayType === "平日");
  const actual = rows.reduce((sum, row) => sum + row.motorcycle + row.small + row.large + row.special, 0);
  const pcu = rows.reduce((sum, row) => sum + row.motorcycle * 0.5 + row.small + row.large * 1.5 + row.special * 2.5, 0);
  assert.equal(actual, 688205);
  assert.equal(pcu, 530122);
});

test("五車種雙向路段會保留大貨車、大客車及聯結車為獨立原始車種", () => {
  const vehicles = ["機車", "小型車", "大貨車", "大客車", "聯結車"];
  const values = [
    ["時間", ...vehicles, ...vehicles],
    ...hours.map(hour => [hour, 10, 20, 3, 4, 5, 11, 21, 6, 7, 8]),
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity);
  assert.equal(rows.length, 48);
  assert.deepEqual([...new Set(rows.map(row => row.directionCode))], ["A", "B"]);
  assert.equal(rows[0].vehicleCounts["custom:大貨車"], 3);
  assert.equal(rows[0].vehicleCounts["custom:大客車"], 4);
  assert.equal(rows[0].vehicleCounts["custom:聯結車"], 5);
  assert.equal(rows[1].vehicleCounts["custom:聯結車"], 8);
  assert.equal(Object.values(rows[0].vehicleCounts).reduce((sum, value) => sum + value, 0), 42);
});

test("車種數量不固定，七車種也會全部保留而非只讀前五種", () => {
  const vehicles = ["機車", "小型車", "大貨車", "大客車", "聯結車", "計程車", "SUV"];
  const values = [
    ["時間", ...vehicles, ...vehicles],
    ...hours.map(hour => [hour, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]),
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity);
  assert.equal(rows.length, 48);
  assert.equal(Object.keys(rows[0].vehicleCounts).length, 7);
  assert.equal(rows[0].vehicleCounts["custom:計程車"], 6);
  assert.equal(rows[0].vehicleCounts["custom:SUV"], 7);
  assert.equal(rows[1].vehicleCounts["custom:SUV"], 14);
  assert.equal(Object.values(rows[0].vehicleCounts).reduce((sum, value) => sum + value, 0), 28);
});

test("路口格式會將每支線的左轉直進右轉加總並保留 A-D", () => {
  const header = ["時間"];
  const turnHeader = ["", "左轉", "直進", "右轉"];
  for (let direction = 0; direction < 4; direction += 1) {
    for (const vehicle of ["機車", "小型車", "大型車", "特種車"]) header.push(vehicle, "", "");
  }
  const values = [turnHeader, header, ...hours.map(hour => {
    const row = [hour];
    for (let direction = 0; direction < 4; direction += 1) for (let vehicle = 0; vehicle < 4; vehicle += 1) row.push(1 + direction, 2 + direction, 3 + direction);
    return row;
  })];
  const rows = parseTrafficSheetValues(values, "假日", "115Q2", identity);
  assert.equal(rows.length, 96);
  assert.deepEqual([...new Set(rows.map(row => row.directionCode))], ["A", "B", "C", "D"]);
  assert.equal(rows.find(row => row.directionCode === "A")?.motorcycle, 6);
  assert.equal(rows.find(row => row.directionCode === "D")?.special, 15);
  assert.equal(rows.find(row => row.directionCode === "A")?.turnData.motorcycle.left, 1);
  assert.equal(rows.find(row => row.directionCode === "A")?.turnData.motorcycle.through, 2);
  assert.equal(rows.find(row => row.directionCode === "A")?.turnData.motorcycle.right, 3);
  assert.equal(rows.find(row => row.directionCode === "D")?.directionName, "駛出路口D");
});

test("不規則多岔路格式可保留最多七個來源支線", () => {
  const header = ["時間"];
  for (let direction = 0; direction < 7; direction += 1) for (const vehicle of ["機車", "小型車", "大型車", "特種車"]) header.push(vehicle, "", "");
  const values = [["", "左轉", "直進", "右轉"], header, ...hours.map(hour => {
    const row = [hour];
    for (let direction = 0; direction < 7; direction += 1) for (let vehicle = 0; vehicle < 4; vehicle += 1) row.push(1, 2, 3);
    return row;
  })];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity);
  assert.equal(rows.length, 168);
  assert.deepEqual([...new Set(rows.map(row => row.directionCode))], ["A", "B", "C", "D", "E", "F", "G"]);
  assert.equal(rows.filter(row => row.directionCode === "G").reduce((sum, row) => sum + row.motorcycle, 0), 144);
});

test("目的支線分欄格式（往B、往C…）：一張工作表一條支線，支線數不限", () => {
  const values = [
    ["表1 路口轉向交通量調查表"],
    ["站號：A00T00-01", "", "", "", "", "", "", "日期：115年01月01日(平日)"],
    ["站名：示範北路/示範路口(七叉路口)"],
    ["路口編號：A"],
    ["時間", "機車", "", "", "小型車", "", "", "大型車", "", "", "特種車", "", ""],
    // prettier-ignore
    ["", "往B", "往C", "往D", "往B", "往C", "往D", "往B", "往C", "往D", "往B", "往C", "往D"],
    ["07:00～07:15", 12, 48, 12, 5, 18, 2, 1, 0, 0, 0, 0, 0],
    ["07:15～07:30", 10, 60, 11, 7, 31, 2, 0, 1, 0, 0, 0, 0],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity, {
    sheetName: "路口(A)",
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].directionCode, "A");
  assert.equal(rows[0].directionName, "駛出路口A");
  assert.equal(rows[0].surveyType, "intersection");
  assert.deepEqual(rows[0].destinationCounts.motorcycle, { B: 12, C: 48, D: 12 });
  assert.deepEqual(rows[0].destinationCounts.small, { B: 5, C: 18, D: 2 });
  // 車輛數＝該車種所有目的地的加總，與轉向分類無關
  assert.equal(rows[0].motorcycle, 72);
  assert.equal(rows[0].small, 25);
  assert.equal(rows[0].large, 1);
  assert.equal(rows[1].hour, "07:15～07:30");
});

test("車種標題因合併儲存格重複時，仍以目的支線的重複週期正確分組", () => {
  const values = [
    ["路口編號：路口C"],
    ["時間", "機車", "", "", "小型車", "", "小型車", "大型車", "", ""],
    ["", "往A", "往B", "往D", "往A", "往B", "往D", "往A", "往B", "往D"],
    ["08:00～08:15", 1, 2, 3, 4, 5, 6, 7, 8, 9],
  ];
  const rows = parseTrafficSheetValues(values, "假日", "115Q2", identity, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].directionCode, "C");
  assert.equal(rows[0].dayType, "假日");
  assert.deepEqual(rows[0].destinationCounts.motorcycle, { A: 1, B: 2, D: 3 });
  assert.deepEqual(rows[0].destinationCounts.small, { A: 4, B: 5, D: 6 });
  assert.deepEqual(rows[0].destinationCounts.large, { A: 7, B: 8, D: 9 });
});

test("「--」等非數值一律當成 0，不會讓整列變成 NaN", () => {
  const values = [
    ["路口編號：B"],
    ["時間", "機車", "", "小型車", "", "大型車", "", "特種車", ""],
    ["", "往A", "往C", "往A", "往C", "往A", "往C", "往A", "往C"],
    ["07:00～07:15", "--", 8, "－", 3, "--", "--", "--", "--"],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity, {});
  assert.deepEqual(rows[0].destinationCounts.motorcycle, { A: 0, C: 8 });
  assert.equal(rows[0].motorcycle, 8);
  assert.equal(rows[0].small, 3);
});

test("既有的左轉／直進／右轉格式不受影響，也不會產生 destinationCounts", () => {
  const values = [
    ["時間", "機車", "", "", "小型車", "", "", "大型車", "", "", "特種車", "", ""],
    // prettier-ignore
    ["", "左轉", "直進", "右轉", "左轉", "直進", "右轉", "左轉", "直進", "右轉", "左轉", "直進", "右轉"],
    ["07:00~08:00", 10, 20, 30, 1, 2, 3, 0, 0, 0, 0, 0, 0],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].surveyType, "intersection");
  assert.equal(rows[0].destinationCounts, undefined);
  assert.deepEqual(rows[0].turnData.motorcycle, { left: 10, through: 20, right: 30 });
});

/*
 * 目的支線分欄格式的時間欄容錯，必須和主路徑一致。
 *
 * 從 Word 貼過來的表格常見全形數字與全形冒號「０７：００～０８：００」，
 * 也有人打成「7 : 00～8 : 00」。舊版這條路徑用的是嚴格版正規表示式
 * （沒有 NFKC、不允許冒號旁空白），於是整張工作表讀成 0 筆——
 * 整體不會報錯，只是少了一條支線，匯入報告也不會提到。
 */
test("目的支線分欄格式：全形時間與冒號旁空白都要讀得到", () => {
  const header = [
    ["表1 路口轉向交通量調查表"],
    ["站號：A00T00-01", "", "", "", "", "", "", "日期：115年01月01日(平日)"],
    ["站名：示範北路/示範路口(七叉路口)"],
    ["路口編號：A"],
    ["時間", "機車", "", "", "小型車", "", "", "大型車", "", "", "特種車", "", ""],
    // prettier-ignore
    ["", "往B", "往C", "往D", "往B", "往C", "往D", "往B", "往C", "往D", "往B", "往C", "往D"],
  ];
  for (const [label, hour] of [
    ["半形（原本就支援）", "07:00～07:15"],
    ["全形數字與全形冒號", "０７：００～０７：１５"],
    ["冒號兩側有空白", "7 : 00～7 : 15"],
  ]) {
    const rows = parseTrafficSheetValues(
      [...header, [hour, 12, 48, 12, 5, 18, 2, 1, 0, 0, 0, 0, 0]],
      "平日",
      "115Q2",
      identity,
      { sheetName: "路口(A)" },
    );
    assert.equal(rows.length, 1, `${label}：整列被丟掉了`);
    assert.deepEqual(
      rows[0].destinationCounts.motorcycle,
      { B: 12, C: 48, D: 12 },
      label,
    );
  }
});

/*
 * ── 表頭日期候選：不看固定欄位位置（v20.34）──────────────────
 *
 * 全日交通量的格式最萬用，同一個資訊在不同廠商的報表裡欄號都不一樣。
 * headerDateCells 走的是和 armCodeOf／dayTypeOf 同一塊表頭（前 12 列），
 * 把所有非空儲存格連同 A1 位址交出去，由 period-date.ts 決定哪一格是調查日期。
 */
test("表頭日期不論放在哪一欄、哪一列都讀得到，而且位址正確", function () {
  const cases = [
    { row: 2, col: 5, address: "F3" },
    { row: 1, col: 27, address: "AB2" },
    { row: 0, col: 0, address: "A1" },
    { row: 11, col: 51, address: "AZ12" },
  ];
  for (const item of cases) {
    const values = Array.from({ length: 14 }, () => []);
    values[item.row][item.col] = "監測日期：115年01月25日(假日)";
    const found = findSurveyDate(headerDateCells(values, "假日"));
    assert.equal(found?.iso, "2026-01-25", JSON.stringify(item));
    assert.equal(found?.cell, item.address, JSON.stringify(item));
    assert.equal(found?.sheet, "假日");
    assert.equal(found?.labelled, true);
  }
});

test("第 13 列以後的日期不算表頭，不會被誤採", function () {
  const values = Array.from({ length: 20 }, () => []);
  values[15][3] = "監測日期：115年01月25日(假日)";
  assert.equal(findSurveyDate(headerDateCells(values, "假日")), null);
});

test("表頭有多個日期時，有「日期：」標示的那一格勝出", function () {
  const values = Array.from({ length: 14 }, () => []);
  values[0][0] = "115年01月20日";
  values[2][5] = "監測日期：115年01月25日(假日)";
  const found = findSurveyDate(headerDateCells(values, "假日"));
  assert.equal(found?.iso, "2026-01-25");
  assert.equal(found?.cell, "F3");
});

test("「製表日期」不是調查日期，不可以拿來比對期別", function () {
  const values = Array.from({ length: 14 }, () => []);
  values[0][0] = "製表日期：115年03月01日";
  assert.equal(findSurveyDate(headerDateCells(values, "統計表")), null);
});
