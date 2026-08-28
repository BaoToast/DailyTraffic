import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { cellCount, parseTrafficSheetValues } from "../app/traffic-parser.ts";

/*
 * ── 每一格的車輛數先四捨五入成整數，再進入所有計算（v20.33）──
 *
 * 起因：使用者的部分調查檔，儲存格裡存的是小數（0.36、5.5506、13.3431…），
 * 而 Excel 的儲存格格式把它顯示成整數。於是**報告上看到 0 與 6，程式拿去算的
 * 卻是 0.36 與 5.5506**——全日車輛數會算出「27,988.79 輛」這種不存在的車，
 * PCU 也跟著帶小數。使用者決定以「畫面上看到的整數」為準。
 *
 * 這一組守的是兩件事：
 *   1. 匯入之後，任何一個車輛數欄位都不可以再出現小數
 *   2. 四捨五入只能做在 cellCount() 一個地方——散在下游各補一次，
 *      遲早會有一條路徑漏掉
 *
 * 姊妹系統「路口轉向」v2.1.30 已採同一條規則。兩套系統對同一份調查檔
 * 必須算出同一組數字（實測 15 項全部一致）。
 */

const identity = {
  roadId: "T-99",
  roadName: "四捨五入驗證點",
  a: "往北",
  b: "往南",
};
const hours = Array.from(
  { length: 24 },
  (_, hour) =>
    `${String(hour).padStart(2, "0")}:00～${String((hour + 1) % 24).padStart(2, "0")}:00`,
);

test("cellCount 把儲存格的小數四捨五入成整數", () => {
  assert.equal(cellCount(0.36), 0);
  assert.equal(cellCount(0.5), 1);
  assert.equal(cellCount(5.5506), 6);
  assert.equal(cellCount(13.3431), 13);
  assert.equal(cellCount(12), 12);
  /* 「--」「－」代表該轉向不存在，一律當成 0——這是舊有行為。 */
  assert.equal(cellCount("--"), 0);
  assert.equal(cellCount("－"), 0);
  assert.equal(cellCount(""), 0);
  assert.equal(cellCount(null), 0);
  assert.equal(cellCount(undefined), 0);
  /* 字串數字仍然讀得出來（有些檔案的數值欄是文字格式）。 */
  assert.equal(cellCount("7"), 7);
  assert.equal(cellCount("7.6"), 8);
});

test("路段格式：小數儲存格匯入後不再出現小數", () => {
  const values = [
    ["時間", "機車", "小型車", "大型車", "特種車"],
    ...hours.map((hour) => [hour, 0.36, 5.5506, 13.3431, 2.5]),
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity);
  assert.equal(rows.length, 24);
  for (const row of rows) {
    assert.equal(row.motorcycle, 0, "0.36 應該進位成 0");
    assert.equal(row.small, 6, "5.5506 應該進位成 6");
    assert.equal(row.large, 13, "13.3431 應該進位成 13");
    assert.equal(row.special, 3, "2.5 應該進位成 3");
  }
  /*
   * 全日加總必須是整數。舊版會得到 0.36×24 + 5.5506×24 + … 這種帶小數的量，
   * 也就是使用者看到的「27,988.79 輛」的來源。
   */
  const total = rows.reduce(
    (sum, row) => sum + row.motorcycle + row.small + row.large + row.special,
    0,
  );
  assert.ok(
    Number.isInteger(total),
    `全日車輛數出現小數：${total}——代表有一條路徑沒有走 cellCount`,
  );
  assert.equal(total, (0 + 6 + 13 + 3) * 24);
});

test("路口轉向格式（左直右三欄）：小數儲存格匯入後不再出現小數", () => {
  const values = [
    ["站號：A00T00-99", "", "", "", "", "", "", "日期：115年01月01日(平日)"],
    ["站名：示範北路/示範路口"],
    ["路口編號：A"],
    ["時間", "機車", "機車", "機車", "小型車", "小型車", "小型車"],
    ["", "左轉", "直進", "右轉", "左轉", "直進", "右轉"],
    ["07:00～07:15", 0.36, 5.5506, 1.4, 2.6, 0.49, 3.5],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity, {
    sheetName: "路口(A)",
  });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(row.turnData.motorcycle, { left: 0, through: 6, right: 1 });
  assert.deepEqual(row.turnData.small, { left: 3, through: 0, right: 4 });
  assert.equal(row.motorcycle, 7);
  assert.equal(row.small, 7);
  for (const [key, turns] of Object.entries(row.turnData))
    for (const [movement, value] of Object.entries(turns))
      assert.ok(
        Number.isInteger(value),
        `turnData.${key}.${movement} 出現小數：${value}`,
      );
});

test("OD（往B／往C）格式：小數儲存格匯入後不再出現小數", () => {
  const values = [
    ["站號：A00T00-99", "", "", "", "", "", "", "日期：115年01月01日(平日)"],
    ["站名：示範北路/示範路口(七叉路口)"],
    ["路口編號：A"],
    // 車種標題必須至少四個，parseTrafficSheetValues 才認得出表頭列
    // prettier-ignore
    ["時間", "機車", "", "", "小型車", "", "", "大型車", "", "", "特種車", "", ""],
    // prettier-ignore
    ["", "往B", "往C", "往D", "往B", "往C", "往D", "往B", "往C", "往D", "往B", "往C", "往D"],
    ["07:00～07:15", 12.4, 47.6, 0.36, 5.5506, 18.5, "--", 1.4, 0, 0, 0, 0, 0],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity, {
    sheetName: "路口(A)",
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].destinationCounts.motorcycle, {
    B: 12,
    C: 48,
    D: 0,
  });
  assert.deepEqual(rows[0].destinationCounts.small, { B: 6, C: 19, D: 0 });
  assert.equal(rows[0].motorcycle, 60);
  assert.equal(rows[0].small, 25);
  assert.equal(rows[0].large, 1, "1.4 應該進位成 1");
});

test("整數的調查檔完全不受影響", () => {
  /*
   * 絕大多數調查檔本來就是整數。四捨五入對它們必須是完全沒有作用的，
   * 否則這一版會動到既有的每一份資料。
   */
  const values = [
    ["時間", "機車", "小型車", "大型車", "特種車"],
    ...hours.map((hour) => [hour, 10, 20, 3, 1]),
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", identity);
  assert.equal(
    rows.reduce((sum, row) => sum + row.motorcycle, 0),
    240,
  );
  assert.equal(
    rows.reduce((sum, row) => sum + row.special, 0),
    24,
  );
});

/*
 * 原始碼檢查：四捨五入只能有一個地方。
 * 註解要先拿掉再比對，不然「說明舊版怎麼錯」的註解本身會被當成缺陷。
 */
function sourceWithoutComments(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

test("讀取原始儲存格只有 cellCount 一個入口", () => {
  const parser = sourceWithoutComments("../app/traffic-parser.ts");
  assert.match(parser, /export function cellCount\(value: unknown\): number/);
  /*
   * 舊版有五處各自寫 `Number(row[...]) || 0`。留著任何一處，那條路徑就會
   * 繼續吃小數，而且從畫面上完全看不出來——這正是這一版要修的症狀。
   */
  assert.doesNotMatch(
    parser,
    /Number\(row\[[^\]]+\]\)\s*\|\|\s*0/,
    "還有地方直接用 Number(row[...]) || 0 讀儲存格，沒有走 cellCount",
  );
  assert.doesNotMatch(
    parser,
    /\.map\(\(cell\) => Number\(cell\) \|\| 0\)/,
    "還有地方直接用 Number(cell) || 0 讀儲存格",
  );
  /* cellCount 本身一定要真的做四捨五入，不可以只是換個名字包一層。 */
  assert.match(parser, /Math\.round\(parsed\)/);
});
