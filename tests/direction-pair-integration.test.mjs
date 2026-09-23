/*
 * ══════════════════════════════════════════════════════════════════════
 *  方向名稱不成對：要進異常檢查、可人工確認、確認不會因為又匯入一季而失效
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20 指定（三支同步）。
 *
 * ⚠️ 姊妹專案交通服務水準踩過的坑：「已確認」的指紋帶著會隨資料變動的文字，
 *   於是每匯入一季就失效、而且舊紀錄只進不出。這一支把本專案的對應情形釘住。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANOMALY_TYPES,
  ANOMALY_RESOLUTIONS,
  anomalyFingerprint,
  detectDirectionPairAlerts,
} from "../app/final-workflow.ts";
import {
  judgeDirectionPair,
  directionPairMessage,
} from "../app/direction-pair.ts";

/*
 * ⚠️ 前置檢查：測資真的同時含有「該報的」與「不該報的」。
 *   少了這一條，判定被改成「一律不報」時這一支會安靜地全部通過。
 */
const ROADS = [
  { roadId: "A00T00-01", roadLabel: "甲路(乙街～丙街)", directionA: "北上", directionB: "西行" },
  { roadId: "A00T00-02", roadLabel: "丁路(戊街～己街)", directionA: "北上", directionB: "南下" },
  { roadId: "A00T00-03", roadLabel: "庚路(辛街～壬街)", directionA: "往台北", directionB: "往高雄" },
];

test("這個類型有登記，而且可以人工確認（使用者堅持是對的時候要有出路）", () => {
  assert.ok(ANOMALY_TYPES.includes("方向名稱不成對"), "ANOMALY_TYPES 沒有登記這個類型");
  assert.equal(
    ANOMALY_RESOLUTIONS["方向名稱不成對"]?.kind,
    "人工確認",
    "不能人工確認的話，使用者堅持命名是對的時候就沒有出路了",
  );
  const text = ANOMALY_RESOLUTIONS["方向名稱不成對"].text;
  assert.ok(text.includes("不影響任何計算"), "解決方式沒有講清楚這一項不影響計算");
});

test("只報真的不成對的那一條，地名與正常命名都不可以誤報", () => {
  const alerts = detectDirectionPairAlerts(ROADS, judgeDirectionPair, directionPairMessage);
  assert.equal(alerts.length, 1, `應該只有 1 筆，實際 ${alerts.length} 筆`);
  assert.equal(alerts[0].roadId, "A00T00-01");
  assert.equal(alerts[0].type, "方向名稱不成對");
  /* ⚠️ 訊息要寫出原名稱與該是什麼，不可以只說「不成對」。 */
  for (const needle of ["北上", "西行", "南"])
    assert.ok(alerts[0].text.includes(needle), `訊息少了「${needle}」：${alerts[0].text}`);
  /* 調查點名稱要用顯示名稱，不是鍵值。 */
  assert.ok(alerts[0].text.includes("甲路(乙街～丙街)"), "沒有寫出調查點的顯示名稱");
});

test("⚠️ 確認不可以因為又匯入一季就失效（姊妹專案踩過的坑）", () => {
  const [alert] = detectDirectionPairAlerts(ROADS, judgeDirectionPair, directionPairMessage);
  const first = anomalyFingerprint(alert);
  /*
   * 「又匯入一季」對這一類**完全不會改變任何欄位**：它不是兩季之間的比較，
   * fromQuarter／toQuarter 都是空的、value 固定 0。
   * 這裡重算一次再比，確認指紋真的穩定。
   */
  const [again] = detectDirectionPairAlerts(ROADS, judgeDirectionPair, directionPairMessage);
  assert.equal(anomalyFingerprint(again), first, "同一份設定算兩次，指紋卻不一樣");
  assert.equal(alert.fromQuarter, "", "fromQuarter 不該有值——有值就會隨季度變動");
  assert.equal(alert.toQuarter, "", "toQuarter 不該有值");
  assert.equal(alert.value, 0, "value 不該有值——有值就會隨資料變動");
});

test("名稱真的改了，確認就要重新提醒（否則等於把新問題藏起來）", () => {
  const [before] = detectDirectionPairAlerts(ROADS, judgeDirectionPair, directionPairMessage);
  const [after] = detectDirectionPairAlerts(
    [{ ...ROADS[0], directionB: "東行" }],
    judgeDirectionPair,
    directionPairMessage,
  );
  assert.notEqual(
    anomalyFingerprint(after),
    anomalyFingerprint(before),
    "改成另一個錯的名稱，指紋卻沒變——舊的確認會把新問題一起消音",
  );
});

test("前置：測資同時含有該報與不該報的，否則上面幾條會變成恆真", () => {
  assert.equal(ROADS.length, 3);
  assert.equal(judgeDirectionPair("北上", "西行").kind, "mismatched", "該報的那一列不成立");
  assert.equal(judgeDirectionPair("北上", "南下").kind, "paired", "正常命名的那一列不成立");
  assert.equal(
    judgeDirectionPair("往台北", "往高雄").kind,
    "not-applicable",
    "地名那一列不成立——這一列是防誤報的",
  );
});
