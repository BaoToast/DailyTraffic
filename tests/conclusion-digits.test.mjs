/*
 * 結論草稿的「小數位數」必須真的管到它說要管的東西。
 *
 * 起因（使用者實測回報，v20.54 線上版）：勾「車輛數（輛）」與
 * 「車種組成（輛數與百分比）」、小數位數選 2 位，產生出來的百分比還是 1 位。
 *
 * 實測（同一支 buildConclusion，digits 帶 0／1／2）確認：
 *   當量交通量（PCU） 3,500 ／ 3,500.0 ／ 3,500.00   ← 只有這一項有作用
 *   車輛數（輛）      6,000 ／ 6,000   ／ 6,000
 *   百分比            60.0% ／ 60.0%  ／ 60.0%
 * 也就是說，使用者勾的那兩項**剛好都不受這個選項控制**，
 * 把它從 1 位改成 2 位，畫面上一個字都不會變。
 *
 * 修正方向：
 *   ・百分比跟著設定走（車種組成、各車種當量、最大宗車種佔比、
 *     季度變動幅度、平假日對比，五處都要）
 *   ・車輛數維持整數——「輛」本來就是整數，印成 6,000.00 輛沒有意義。
 *     這一點是刻意保留的行為，所以下面也寫成斷言釘住它。
 *
 * ⚠️ 假通過陷阱：只驗「digits=2 時字串裡有兩位小數」不夠——PCU 本來就有，
 *    整段字串一定會通過。所以下面**只取百分比那一段**來比對。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONDITION, buildConclusion } from "../app/conclusion.ts";
import { CONCLUSION_META as META, row } from "./helpers/conclusion-row.mjs";

const ROWS = [row({ quarter: "115Q2" })];

function draft(digits, metrics) {
  return buildConclusion(ROWS, { ...DEFAULT_CONDITION, digits, metrics }, META);
}

/** 只把括號裡的百分比抓出來，避免被 PCU 的小數位數混淆。 */
function percentages(text) {
  return [...text.matchAll(/(\d+(?:\.\d+)?)%/g)].map((match) => match[1]);
}

test("百分比要跟著「小數位數」走", () => {
  for (const digits of [0, 1, 2]) {
    const text = draft(digits, [
      "count",
      "pcu",
      "composition",
      "compositionPcu",
      "topVehicle",
    ]);
    const values = percentages(text);
    assert.ok(values.length > 0, `digits=${digits} 應該要有百分比可以檢查`);
    for (const value of values) {
      const decimals = value.includes(".") ? value.split(".")[1].length : 0;
      assert.equal(
        decimals,
        digits,
        `小數位數選 ${digits} 位，百分比卻印成 ${value}%`,
      );
    }
  }
});

test("季度變動幅度與平假日對比的百分比也要跟著走", () => {
  const rows = [
    row({ quarter: "114Q4", dayType: "平日" }),
    row({ quarter: "115Q2", dayType: "平日" }),
    row({ quarter: "115Q2", dayType: "假日" }),
  ];
  for (const digits of [0, 2]) {
    const text = buildConclusion(
      rows,
      {
        ...DEFAULT_CONDITION,
        digits,
        metrics: ["count", "growth", "dayCompare"],
        dayTypes: [],
      },
      META,
    );
    for (const value of percentages(text)) {
      const decimals = value.includes(".") ? value.split(".")[1].length : 0;
      assert.equal(
        decimals,
        digits,
        `小數位數選 ${digits} 位，變動幅度／平假日對比卻印成 ${value}%`,
      );
    }
  }
});

test("車輛數維持整數，不跟著小數位數跑", () => {
  /*
   * 這一項對未修正的版本也是綠的——它是「不許改壞」的鎖，不是問題重現。
   * 把 whole() 一併改成跟著 digits 的話，會冒出「6,000.00 輛/日」這種東西。
   */
  const text = draft(2, ["count"]);
  assert.match(text, /10,000 輛\/日/);
  assert.doesNotMatch(text, /10,000\.00 輛/);
});

/*
 * ── 舊範本／舊備份帶進來的小數位數 ────────────────────────────
 *
 * 畫面上的下拉只給 0、1、2，所以「使用者操作」那條路本來就安全。
 * 危險的是另一條路：套用條件範本時是
 *   props.setCondition(template.condition)
 * 把範本裡的值**原封不動**丟進來的，完全不經過畫面的下拉。
 * 範本是 JSON，欄位可能缺、可能是別的型別。
 *
 * 修正前用同一支 buildConclusion 實測到的行為：
 *   null／undefined → 百分比安靜變成 0 位（使用者設定的 1 位被吃掉）
 *   -1／"abc"       → 丟 RangeError，整個結論草稿掛掉
 *   100            → 印出 100 位小數
 *
 * 這個洞是姊妹系統「交通服務水準」在 v2.20.46 被獨立複查抓到的同一類問題，
 * 成因是一句寫錯的註解：以為 toFixed(undefined) 會拋錯——它不會，
 * 它會安靜輸出 0 位。三支同一種寫法，所以三支都查過；
 * 路口轉向本來就有夾範圍（normalizeCondition，0～4），只有本系統沒有。
 *
 * ⚠️ 假通過陷阱：只驗「不會丟例外」不夠——把 pct() 改成永遠回空字串也不會丟。
 *    所以每一種異常輸入都要驗**真的回到 1 位**，而且合法值 0／1／2
 *    的輸出必須與修正前完全相同（下面第一支測試已經釘住）。
 */
test("舊範本帶進非法的小數位數時，安全回到 1 位而且不丟例外", () => {
  const metrics = ["count", "pcu", "composition", "compositionPcu", "topVehicle"];
  for (const digits of [null, undefined, -1, 100, "abc", 1.5, true, {}, []]) {
    let text;
    assert.doesNotThrow(() => {
      text = draft(digits, metrics);
    }, `digits=${JSON.stringify(digits)} 不可以讓結論草稿掛掉`);
    const values = percentages(text);
    assert.ok(values.length > 0, `digits=${JSON.stringify(digits)} 應該還是產得出百分比`);
    for (const value of values) {
      const decimals = value.includes(".") ? value.split(".")[1].length : 0;
      assert.equal(
        decimals,
        1,
        `digits=${JSON.stringify(digits)} 應該安全回到 1 位，卻印成 ${value}%`,
      );
    }
  }
});

test("合法的數字字串仍然可以用（舊範本常把它存成字串）", () => {
  const metrics = ["count", "pcu", "composition"];
  for (const value of percentages(draft("2", metrics)))
    assert.equal(
      value.includes(".") ? value.split(".")[1].length : 0,
      2,
      `字串 "2" 應該當成 2 位，卻印成 ${value}%`,
    );
});
