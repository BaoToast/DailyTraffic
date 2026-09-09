/*
 * 匯入時「多支線角度、轉向圖與流向確認」只該在**還沒設定過**時跳出來。
 *
 * 起因（使用者實測回報）：第一季匯入時把路口的支線角度與流向設好之後，
 * 後面每一季匯入同一批路口，這個視窗還是每次都跳出來，而裡面沒有任何
 * 一項需要改。原因是舊寫法只看「這批資料裡有沒有路口」：
 *
 *     const importedIntersection = parsed.find(
 *       (record) => record.surveyType === "intersection",
 *     );
 *
 * 而角度與流向設定是存成（計畫、路口、支線）三層、**與季度無關**的，
 * 第一季設好之後每一季都沿用同一份。
 *
 * 舊寫法還有第二個問題：它只取第一筆路口。一次匯入三個新路口時只會問
 * 第一個，另外兩個直接套預設角度、不問也不提示。
 *
 * ⚠️ 假通過陷阱：只驗「設定過就不跳」不夠——寫成永遠不跳也會過。
 *    所以同一支測試要同時釘住「沒設定過一定要跳」與「多出一支新支線也要跳」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { unconfiguredIntersectionRoads } from "../app/intersection-flow.ts";

const PROJECT = "P-1";

function record(roadId, directionCode, over = {}) {
  return {
    projectId: PROJECT,
    quarter: "115Q2",
    roadId,
    directionCode,
    dayType: "平日",
    hour: "08",
    surveyType: "intersection",
    ...over,
  };
}

function setting(roadId, directionCode) {
  return { projectId: PROJECT, roadId, directionCode, name: "路口" + directionCode, angle: 0, routes: {} };
}

test("沒設定過的路口一定要跳出來問", () => {
  const rows = [record("R-01", "A"), record("R-01", "B"), record("R-01", "C")];
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, []), ["R-01"]);
});

test("每一支支線都設定過之後就不要再問", () => {
  const rows = [record("R-01", "A"), record("R-01", "B"), record("R-01", "C")];
  const saved = ["A", "B", "C"].map((code) => setting("R-01", code));
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, saved), []);
});

test("同一個路口後來多出一支新支線，還是要問", () => {
  const rows = [
    record("R-01", "A"),
    record("R-01", "B"),
    record("R-01", "C"),
    record("R-01", "D"),
  ];
  const saved = ["A", "B", "C"].map((code) => setting("R-01", code));
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, saved), ["R-01"]);
});

test("一次匯入多個新路口時，全部都要算進去，不是只有第一個", () => {
  const rows = [
    record("R-01", "A"),
    record("R-02", "A"),
    record("R-03", "A"),
  ];
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, []), [
    "R-01",
    "R-02",
    "R-03",
  ]);
});

test("已設定的路口不會因為別的路口沒設定而被重複列出", () => {
  const rows = [record("R-01", "A"), record("R-02", "A")];
  const saved = [setting("R-01", "A")];
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, saved), ["R-02"]);
});

test("別的計畫的設定不算數", () => {
  const rows = [record("R-01", "A")];
  const saved = [{ ...setting("R-01", "A"), projectId: "P-2" }];
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, saved), ["R-01"]);
});

test("路段（非路口）資料不會觸發這個視窗", () => {
  const rows = [record("R-09", "A", { surveyType: "road" })];
  assert.deepEqual(unconfiguredIntersectionRoads(rows, PROJECT, []), []);
});

test("匯入時不再無條件跳視窗——條件要接到未設定清單上", async () => {
  /*
   * 這一項守的是**接線**，不是純函式。
   * unconfiguredIntersectionRoads 寫得再對，匯入處如果還留著舊的
   * `parsed.find((record) => record.surveyType === "intersection")`，
   * 使用者看到的行為就完全沒有變——這正是「修了一半」最典型的樣子。
   */
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const needsSetup = unconfiguredIntersectionRoads\(/,
    "匯入處沒有改用未設定清單",
  );
  assert.doesNotMatch(
    source,
    /const importedIntersection = parsed\.find\(/,
    "匯入處還留著舊的「有路口就跳」寫法",
  );
});
