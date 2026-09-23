/*
 * ══════════════════════════════════════════════════════════════════════
 *  同一張表讀到兩個調查日期：要進異常檢查、要能指定哪一個才對
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20：
 *   「同一張表若你判讀到 2 個日期，在資料匯入時就應該做為異常顯示提醒
 *     使用者，在異常資料檢查結果也要檢查出來，我在想的是你要如何讓使用者
 *     告訴你哪個才是正確的日期（因為有可能另一個不同的日期在該資料中有其
 *     意義存在，所以使用者不會修正資料）」
 *
 * ⚠️ 最後那一句是這一支測試的重心：**不可以叫使用者去改原始檔**，
 *   所以解法是「覆寫」而不是「改資料」，而且覆寫要跟著顯示走。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANOMALY_TYPES,
  ANOMALY_RESOLUTIONS,
  anomalyFingerprint,
  detectSurveyDateAlerts,
  effectiveSurveyDate,
  surveyDateScopeKey,
  emptyWorkflowState,
} from "../app/final-workflow.ts";

const base = {
  quarter: "115Q2",
  dayType: "平日",
  sourceFileName: "甲路.xlsx",
  sourceSheetName: "平日",
};

/*
 * ⚠️ 前置檢查：測資真的同時含有「該報的」與「不該報的」。
 *   少了這一條，判定被改成「一律不報」時這一支會安靜地全部通過。
 */
const RECORDS = [
  /* 該報：同一張表兩個日期 */
  {
    ...base,
    roadId: "A00T00-01",
    surveyDate: "2026-05-04",
    surveyDateCandidates: ["2026-05-04", "2026-05-05"],
  },
  /* 同一張表的第二筆：**不可以**因此報第二次 */
  {
    ...base,
    roadId: "A00T00-02",
    surveyDate: "2026-05-04",
    surveyDateCandidates: ["2026-05-04", "2026-05-05"],
  },
  /* 不該報：只有一個日期 */
  {
    ...base,
    sourceSheetName: "假日",
    roadId: "A00T00-01",
    surveyDate: "2026-05-05",
  },
  /* 不該報：一個日期都沒有（舊資料） */
  { ...base, sourceSheetName: "路口A", roadId: "A00T00-03" },
];

test("前置：測資同時含有該報與不該報的情形", () => {
  const withTwo = RECORDS.filter((r) => (r.surveyDateCandidates || []).length > 1);
  const withoutTwo = RECORDS.filter(
    (r) => (r.surveyDateCandidates || []).length <= 1,
  );
  assert.ok(withTwo.length >= 2, "沒有「同一張表兩個日期」的測資");
  assert.ok(withoutTwo.length >= 2, "沒有「不該報」的測資");
});

test("這個類型有登記，而且是人工確認（系統不可以自己挑）", () => {
  assert.ok(
    ANOMALY_TYPES.includes("調查日期不只一個"),
    "ANOMALY_TYPES 沒有登記這個類型",
  );
  const resolution = ANOMALY_RESOLUTIONS["調查日期不只一個"];
  assert.equal(resolution?.kind, "人工確認");
  /* ⚠️ 解決方式要講明「系統不會自己挑」，這是本系統的基本原則。 */
  assert.ok(
    resolution.text.includes("不會自己挑"),
    `解決方式沒有講明系統不自行挑選：${resolution.text}`,
  );
  assert.ok(
    resolution.text.includes("不影響任何交通量數值"),
    "解決方式沒有講明這一項不影響數值",
  );
});

test("一張表只報一筆，候選都列出來；只有一個日期或沒有日期的不報", () => {
  const alerts = detectSurveyDateAlerts(RECORDS);
  assert.equal(alerts.length, 1, `應該只有 1 筆，實際 ${alerts.length} 筆`);
  const [alert] = alerts;
  assert.equal(alert.type, "調查日期不只一個");
  assert.deepEqual(alert.choices, ["2026-05-04", "2026-05-05"]);
  assert.equal(alert.choiceScope, "115Q2|甲路.xlsx|平日");
  /* 訊息要寫出是哪一個檔案、哪一張工作表，否則使用者無從查起。 */
  for (const needle of ["甲路.xlsx", "平日"])
    assert.ok(alert.text.includes(needle), `訊息少了「${needle}」：${alert.text}`);
});

test("⚠️ 分組鍵是「季別｜檔名｜工作表」，不是調查點", () => {
  /*
   * 一張工作表可能產出好幾個調查點。用調查點分組的話，
   * 同一件事會被報好幾次，使用者要按好幾次確認。
   */
  const alerts = detectSurveyDateAlerts(RECORDS);
  assert.equal(alerts.length, 1);
  assert.equal(
    alerts[0].choiceScope,
    surveyDateScopeKey(RECORDS[0]),
    "alert 的 choiceScope 與 surveyDateScopeKey 算出來的不是同一把鑰匙",
  );
  assert.equal(surveyDateScopeKey(RECORDS[0]), surveyDateScopeKey(RECORDS[1]));
});

test("⚠️ 指紋要含候選清單：候選變了要重新提醒，候選沒變就不可以失效", () => {
  const [alert] = detectSurveyDateAlerts(RECORDS);
  const first = anomalyFingerprint(alert);
  /* 又匯入一季（文字會變、目前採用的日期也可能變）→ 指紋不可以變 */
  const [again] = detectSurveyDateAlerts(RECORDS, undefined, (iso) => `民國${iso}`);
  assert.equal(
    anomalyFingerprint(again),
    first,
    "只是顯示文字變了，確認就失效了——使用者每季都要重按一次",
  );
  /* 真的多出第三個候選 → 指紋必須變 */
  const worse = RECORDS.map((r) =>
    r.surveyDateCandidates
      ? { ...r, surveyDateCandidates: [...r.surveyDateCandidates, "2026-05-06"] }
      : r,
  );
  const [third] = detectSurveyDateAlerts(worse);
  assert.notEqual(
    anomalyFingerprint(third),
    first,
    "多出一個候選日期是新的狀況，必須重新提醒",
  );
});

test("⚠️ 舊的五種異常的指紋不可以因為多了 choices 欄位而改變", () => {
  /*
   * 無條件在指紋尾巴多加一格的話，使用者先前按過的「已人工確認」
   * 會全部失效、當場重新冒出來——這正是姊妹專案修掉的那個 bug。
   */
  const legacy = {
    type: "全日量變動",
    fromQuarter: "115Q1",
    toQuarter: "115Q2",
    roadId: "A00T00-01",
    dayType: "平日",
    direction: "方向A",
    vehicle: "",
    value: 22.3,
  };
  assert.equal(
    anomalyFingerprint(legacy),
    JSON.stringify([
      "全日量變動",
      "115Q1",
      "115Q2",
      "A00T00-01",
      "平日",
      "方向A",
      "",
      "22.3",
    ]),
    "舊類型的指紋長相變了，先前所有的人工確認都會失效",
  );
});

test("指定哪一個才對之後，顯示要跟著走；沒指定時用判讀到的", () => {
  const record = RECORDS[0];
  assert.equal(effectiveSurveyDate(record, {}), "2026-05-04", "沒指定時應該用判讀到的");
  assert.equal(
    effectiveSurveyDate(record, { "115Q2|甲路.xlsx|平日": "2026-05-05" }),
    "2026-05-05",
    "指定過的日期沒有被採用",
  );
  /* 同一張表的另一筆也要跟著改——覆寫是整張表的。 */
  assert.equal(
    effectiveSurveyDate(RECORDS[1], { "115Q2|甲路.xlsx|平日": "2026-05-05" }),
    "2026-05-05",
  );
  /* 別張表不受影響。 */
  assert.equal(
    effectiveSurveyDate(RECORDS[2], { "115Q2|甲路.xlsx|平日": "2026-05-05" }),
    "2026-05-05",
  );
});

test("⚠️ 覆寫值不在候選裡就不採用（備份被手改、或重新匯入後候選變了）", () => {
  assert.equal(
    effectiveSurveyDate(RECORDS[0], { "115Q2|甲路.xlsx|平日": "1999-01-01" }),
    "2026-05-04",
    "採用了一個原始檔上根本沒有的日期——使用者無從發現",
  );
});

test("⚠️ 重新匯入後候選清單消失時，舊覆寫不得繼續套用", () => {
  const reimported = {
    ...RECORDS[0],
    surveyDate: "2026-05-06",
  };
  delete reimported.surveyDateCandidates;
  assert.equal(
    effectiveSurveyDate(reimported, {
      "115Q2|甲路.xlsx|平日": "2026-05-05",
    }),
    "2026-05-06",
    "重新匯入後原始檔只剩一個日期，卻仍沿用已不在原始檔候選裡的舊覆寫",
  );
});

test("指定過之後，訊息要寫明「你指定的」，而且採用的就是那一個", () => {
  const overrides = { "115Q2|甲路.xlsx|平日": "2026-05-05" };
  const [alert] = detectSurveyDateAlerts(RECORDS, undefined, undefined, overrides);
  assert.ok(alert.text.includes("你指定的"), `訊息沒寫出是使用者指定的：${alert.text}`);
  assert.ok(alert.text.includes("2026-05-05"), "訊息裡採用的不是使用者指定的那一個");
});

test("新的工作流程狀態要帶著覆寫表，舊備份沒有這一欄也不可以壞掉", () => {
  assert.deepEqual(emptyWorkflowState().surveyDateOverrides, {});
  /* 舊備份：undefined。讀取端一律當成空的。 */
  assert.equal(effectiveSurveyDate(RECORDS[0], undefined), "2026-05-04");
});
