/*
 * 圖旁邊的解讀說明。
 *
 * ── 這一支釘住的是什麼 ────────────────────────────────────────
 *
 * 這些文字會被照著念、被貼進報告，所以守的不是「有沒有字」，而是：
 *
 *   一、講的數字必須是圖上那一份資料算出來的，不是另外算的。
 *   二、沒有資料時要說沒有資料，不可以硬湊出一段像有講的話。
 *   三、會誤導的地方要主動講出來（只做了一種日別、調查不足 24 小時、
 *       排名高不等於有問題）。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、只驗「回傳的 lines 不是空的」不夠——印任何字都會過。
 *     要驗**特定的數字逐字出現**。
 * 二、只驗「有警告」不夠——永遠印同一句警告也會過。
 *     要同時驗「沒有問題時不會亂警告」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  compositionNote,
  dayCompareNote,
  hourlyNote,
  rankNote,
} from "../app/chart-notes.ts";

test("車種組成：講的佔比要與資料算出來的一致", () => {
  const note = compositionNote(
    [
      { label: "機車", count: 900 },
      { label: "小型車", count: 700 },
      { label: "大貨車", count: 60 },
      { label: "聯結車", count: 40 },
    ],
    1700,
    "全部調查點",
  );
  const body = note.lines.join("\n");
  assert.match(body, /1,700 輛/);
  /* 900 / 1700 = 52.9% */
  assert.match(body, /機車，900 輛（52\.9%）/);
  /* 大型車＋特種車＝大貨車 60 ＋ 聯結車 40 ＝ 100，佔 5.9% */
  assert.match(body, /合計 100 輛（5\.9%）/);
});

test("車種組成：沒有資料時要說沒有資料，不可以硬湊", () => {
  const note = compositionNote([], 0, "全部調查點");
  assert.equal(note.lines.length, 1);
  assert.match(note.lines[0], /沒有可統計/);
});

test("24 小時型態：尖峰、離峰與集中程度都要講對", () => {
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    value: hour === 8 ? 1000 : hour === 3 ? 100 : 400,
  }));
  const body = hourlyNote(points, "輛", "中山路").lines.join("\n");
  assert.match(body, /最忙的是 08:00，1,000 輛/);
  assert.match(body, /最閒的是 03:00，100 輛/);
  assert.match(body, /10\.0 倍/);
  /* 全日 = 1000 + 100 + 22×400 = 9,900；尖峰佔 10.1% */
  assert.match(body, /佔全日的 10\.1%/);
  /* 24 小時齊全時，不可以出現「調查不足 24 小時」那句警告。 */
  assert.ok(!/不是完整的 24 小時/.test(body));
});

test("24 小時型態：時段不足 24 小時要主動講出來", () => {
  const points = Array.from({ length: 12 }, (_, hour) => ({
    hour: `${String(hour + 6).padStart(2, "0")}:00`,
    value: 300 + hour,
  }));
  const body = hourlyNote(points, "輛", "中山路").lines.join("\n");
  assert.match(body, /只涵蓋 12 個小時/);
});

test("同季平假日：要明講兩根柱子不會相加", () => {
  const rows = [
    { name: "A 路段", weekday: 1000, holiday: 800 },
    { name: "B 路段", weekday: 500, holiday: 700 },
    { name: "C 路段", weekday: 400, holiday: null },
  ];
  const body = dayCompareNote(rows, "輛").lines.join("\n");
  assert.match(body, /不會相加/);
  /* 只算兩種日別都有的：平日 1500、假日 1500 */
  assert.match(body, /平日 1,500 輛、假日 1,500 輛/);
  /* B 路段假日比平日高，要被點名 */
  assert.match(body, /假日反而比平日高/);
  assert.match(body, /B 路段/);
  /* C 路段只有平日，要被算進「只做了一種日別」 */
  assert.match(body, /另有 1 個調查點只做了其中一種日別/);
});

test("同季平假日：沒有一個點同時有兩種日別時要說清楚", () => {
  const body = dayCompareNote(
    [{ name: "A", weekday: 100, holiday: null }],
    "輛",
  ).lines.join("\n");
  assert.match(body, /沒有任何一個調查點同時有平日與假日/);
  /* 不可以在沒有可比對象時還講「合計」。 */
  assert.ok(!/合計/.test(body));
});

test("路段排名：一定要提醒「排名高不等於有問題」", () => {
  const body = rankNote(
    [
      { name: "甲", value: 5000 },
      { name: "乙", value: 1000 },
    ],
    "輛",
  ).lines.join("\n");
  assert.match(body, /最忙的是甲，5,000 輛/);
  assert.match(body, /相差 5\.0 倍/);
  /*
   * ⚠️ 這一句是刻意的：排名是「量」的排序，不是「壅不壅塞」。
   * 少了這一句，看報告的人會把排名第一直接寫成「最嚴重的路段」。
   */
  assert.match(body, /排名高不等於有問題/);
});
