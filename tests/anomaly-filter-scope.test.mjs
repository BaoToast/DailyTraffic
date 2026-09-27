/*
 * ══════════════════════════════════════════════════════════════════════
 *  A25：與某個維度無關的提醒，任何選擇都要看得到
 * ══════════════════════════════════════════════════════════════════════
 *
 * 「方向名稱不成對」講的是一個**當下的設定問題**，不是兩季之間的比較，
 * 所以它的 fromQuarter／toQuarter 是空的。
 *
 * v20.81 的 filterAnomalies 直接拿 quarterOrderKey("") 去比大小
 *（它回傳 -Infinity），於是只要使用者在檢查結果上選了「季度（起）」，
 * 這一類提醒就整批消失；而統計、類型標籤、草稿與 Excel 算的是全部，
 * 畫面因此會寫「顯示 1／共 2 筆」卻永遠找不到第 2 筆。
 *
 * ⚠️ 姊妹專案交通服務水準早就做對了（filterQualityIssues：`if (!span) return true;`）。
 *   三支要一致。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAnomalies,
  anomalyTypeCounts,
} from "../app/final-workflow.ts";

const pair = {
  roadId: "A00T00-01",
  dayType: "平日",
  direction: "",
  type: "方向名稱不成對",
  fromQuarter: "",
  toQuarter: "",
  value: 0,
  unit: "",
  roadLabel: "甲路",
  directionLabel: "",
  text: "北 與 東 不是一組相反方向",
};
const ranged = {
  roadId: "A00T00-01",
  dayType: "平日",
  direction: "",
  type: "全日量變動",
  fromQuarter: "115Q1",
  toQuarter: "115Q2",
  value: 12.5,
  unit: "%",
  roadLabel: "甲路",
  directionLabel: "",
  text: "全日量變動 12.5%",
};
const ALL = [pair, ranged];
const NONE = { fromQuarter: "", toQuarter: "", types: [], roadId: "ALL", dayType: "ALL" };

test("⚠️ 選了「季度（起）」不可以把沒有季度的提醒吃掉", () => {
  const kept = filterAnomalies(ALL, { ...NONE, fromQuarter: "115Q1" });
  assert.deepEqual(
    kept.map((item) => item.type),
    ["方向名稱不成對", "全日量變動"],
    "沒有季度的提醒被季度篩選吃掉了——而上面的「共 N 筆」還算著它",
  );
});

test("⚠️ 選了「季度（迄）」也一樣", () => {
  const kept = filterAnomalies(ALL, { ...NONE, toQuarter: "115Q2" });
  assert.equal(kept.length, 2);
});

test("⚠️ 前置檢查：季度篩選本身仍然有作用（不是一律不篩）", () => {
  /*
   * 少了這一條，把 filterAnomalies 改成「永遠回傳全部」也會讓上面兩支變綠。
   */
  const kept = filterAnomalies(ALL, { ...NONE, fromQuarter: "116Q1" });
  assert.deepEqual(
    kept.map((item) => item.type),
    ["方向名稱不成對"],
    "115Q1～115Q2 的提醒在 116Q1 以後的區間裡不該出現",
  );
});

test("篩出來的筆數與類型統計不可以互相矛盾", () => {
  /*
   * 這一支釘住使用者真正看到的那個矛盾：類型標籤寫著有一筆「方向名稱不成對」，
   * 表格卻列不出來。
   */
  const counts = anomalyTypeCounts(ALL);
  const pairCount =
    counts.find((row) => row.type === "方向名稱不成對")?.count ?? 0;
  const shown = filterAnomalies(ALL, { ...NONE, fromQuarter: "115Q1" }).filter(
    (item) => item.type === "方向名稱不成對",
  ).length;
  assert.equal(
    shown,
    pairCount,
    "類型標籤說有 N 筆，表格只列得出 M 筆——使用者會以為資料被吃掉",
  );
});

test("路段與日別同一套規則：欄位是空的就不參與篩選", () => {
  const noRoad = { ...pair, roadId: "", dayType: "" };
  assert.equal(
    filterAnomalies([noRoad], { ...NONE, roadId: "A00T00-01" }).length,
    1,
    "沒有路段欄位的提醒被路段篩選吃掉了",
  );
  assert.equal(
    filterAnomalies([noRoad], { ...NONE, dayType: "平日" }).length,
    1,
    "沒有日別欄位的提醒被日別篩選吃掉了",
  );
  /* 反面：有欄位的還是要照篩。 */
  assert.equal(
    filterAnomalies([pair], { ...NONE, roadId: "B00T00-01" }).length,
    0,
    "路段篩選整個失效了",
  );
});
