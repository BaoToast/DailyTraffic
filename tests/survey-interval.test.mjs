/*
 * ══════════════════════════════════════════════════════════════════════
 *  調查格距超過 1 小時 → 列為異常（使用者 2026-09-24 指定）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「如果出現 2 小時 1 格，那表示是異常，要讓使用者去確認是否誤植，
 *     交通量調查都是以 1 小時調查為主，最多以每 15 分鐘調查一筆資料……
 *     但不可能出現 2 小時以上類型的調查資料，那反而要列為異常，
 *     系統應該匯入時會提示，以及列入資料異常清單裡吧」
 *
 * ── 這一支特別要守的兩件事 ─────────────────────────────────
 *
 * ⚠️ ① **15 分鐘格不可以被判成異常。**
 *   2022 年臺灣公路容量手冊 4.5.1.3 明文要求「評估現況宜根據尖峰 15 分鐘之
 *   需求流率」，而 PHF（式 2.10）本身就是拿尖峰 15 分鐘流率當分母算的。
 *   15 分鐘格是手冊鼓勵的做法。把它判成異常會讓使用者去「修正」一份
 *   比整點資料更好的檔案。門檻因此是「**超過** 60 分鐘」，不是「不等於 60」。
 *
 * ⚠️ ② **逐格看，不取眾數。**
 *   `intervalMinutesOf()` 取的是眾數。48 格裡有 1 格誤植成 2 小時的話眾數
 *   仍然是 60，那一格會被蓋掉——而那正是最需要被抓出來的情形
 *   （整份都是 2 小時一格反而一眼就看得出來）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ANOMALY_TYPES,
  ANOMALY_RESOLUTIONS,
  anomalyTypeCounts,
  detectIntervalAlerts,
} from "../app/final-workflow.ts";

const TYPE = "調查格距異常";

function cell(hour, over = {}) {
  return {
    quarter: "115Q2",
    roadId: "A00T00-01",
    dayType: "平日",
    hour,
    sourceFileName: "示範檔.xlsx",
    sourceSheetName: "工作表1",
    ...over,
  };
}

/** 一整天 24 格整點。 */
const HOURLY = Array.from({ length: 24 }, (_, h) =>
  cell(`${String(h).padStart(2, "0")}:00～${String((h + 1) % 24).padStart(2, "0")}:00`),
);
/** 07:00–10:00 的 15 分鐘格，共 12 格。 */
const QUARTERLY = Array.from({ length: 12 }, (_, i) => {
  const start = 7 * 60 + i * 15;
  const clock = (m) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return cell(`${clock(start)}～${clock(start + 15)}`);
});

test("這個類型登記在 ANOMALY_TYPES，而且有解決方式", () => {
  assert.ok(ANOMALY_TYPES.includes(TYPE), "ANOMALY_TYPES 沒有登記這個類型");
  const resolution = ANOMALY_RESOLUTIONS[TYPE];
  assert.ok(resolution, "沒有寫解決方式，結果表那一欄會是空白");
  assert.equal(
    resolution.kind,
    "人工確認",
    "這一項不阻擋匯入、也不一定是錯，期待管理要寫「人工確認」",
  );
  /* 統計卡要列得出這個類型（0 筆也要在，否則使用者不知道系統有查這一項）。 */
  assert.ok(
    anomalyTypeCounts([]).some((item) => item.type === TYPE),
    "統計卡沒有這個類型",
  );
});

test("⚠️ 整點（60 分鐘）不可以判成異常", () => {
  assert.deepEqual(detectIntervalAlerts(HOURLY), []);
});

test("⚠️ 15 分鐘格不可以判成異常（手冊 4.5.1.3 鼓勵的做法）", () => {
  assert.deepEqual(detectIntervalAlerts(QUARTERLY), []);
});

test("⚠️ 20 與 30 分鐘格也不可以判成異常（README 寫著都支援）", () => {
  for (const [a, b] of [
    ["07:00～07:20", "07:20～07:40"],
    ["07:00～07:30", "07:30～08:00"],
  ])
    assert.deepEqual(detectIntervalAlerts([cell(a), cell(b)]), [], `${a} / ${b}`);
});

test("2 小時一格要報出來，而且寫出實際格距與格數", () => {
  const alerts = detectIntervalAlerts([
    cell("07:00～09:00"),
    cell("09:00～11:00"),
  ]);
  assert.equal(alerts.length, 1);
  const alert = alerts[0];
  assert.equal(alert.type, TYPE);
  assert.equal(alert.value, 120, "value 要放最長的那一格（分鐘），供排序用");
  assert.equal(alert.unit, "分鐘");
  assert.match(alert.text, /2 小時 × 2 格/, alert.text);
  assert.match(alert.text, /共 2 格/, alert.text);
  assert.match(alert.text, /示範檔\.xlsx → 工作表1/, "沒有寫出是哪一張表");
  assert.match(alert.text, /誤植/, "沒有講出最可能的原因");
});

test("⚠️ 48 格裡只有 1 格誤植也要抓出來（眾數會把它蓋掉）", () => {
  const rows = [...HOURLY, cell("07:00～09:00")];
  const alerts = detectIntervalAlerts(rows);
  assert.equal(alerts.length, 1, "被眾數蓋掉了——這正是最需要抓出來的情形");
  assert.match(alerts[0].text, /2 小時 × 1 格/, alerts[0].text);
  assert.match(alerts[0].text, /共 25 格/, "沒有寫出總格數，使用者看不出比例");
  assert.match(alerts[0].text, /07:00～09:00/, "沒有舉出是哪一格");
});

test("一張表報一筆，不是一格報一筆", () => {
  const rows = Array.from({ length: 10 }, () => cell("07:00～09:00"));
  assert.equal(detectIntervalAlerts(rows).length, 1);
});

test("不同工作表各報一筆（格距是整張表的屬性）", () => {
  const alerts = detectIntervalAlerts([
    cell("07:00～09:00", { sourceSheetName: "上午" }),
    cell("17:00～19:00", { sourceSheetName: "下午" }),
  ]);
  assert.equal(alerts.length, 2);
  assert.deepEqual(
    alerts.map((a) => a.text.includes("上午")).sort(),
    [false, true],
  );
});

test("讀不出時段的列不會讓它丟例外，也不會被當成異常", () => {
  assert.deepEqual(detectIntervalAlerts([cell(""), cell("全天"), cell(undefined)]), []);
});

test("⚠️ 指紋不含 text：同一張表不會因為又匯入一季就讓確認失效", async () => {
  const { anomalyFingerprint } = await import("../app/final-workflow.ts");
  const a = detectIntervalAlerts([cell("07:00～09:00")])[0];
  const b = detectIntervalAlerts([cell("07:00～09:00"), cell("09:00～11:00")])[0];
  /*
   * 兩次的 text 不同（格數不同），但同一張表的同一個問題應該是同一把鑰匙。
   * ⚠️ 這裡刻意驗「指紋不含 text」而不是「兩者相同」——value 是最長那一格，
   *   真的變了就該是新的一筆。
   */
  assert.notEqual(a.text, b.text);
  assert.equal(anomalyFingerprint(a), anomalyFingerprint(b));
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  格距混用也要列進資料異常清單（使用者 2026-09-24 的 I3）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 混用偵測本來只在匯入前檢核報告出現一次，關掉視窗就再也看不到。
 * 判準（佔兩成以上＋至少重複兩次）必須與匯入警告**同一份**——
 * 這個專案吃過好幾次「同一件事寫在兩個地方就會漂移」。
 */
test("⚠️ 混用整點與 15 分鐘格要列成異常，而且與匯入警告同一份判準", async () => {
  const { detectMixedIntervalAlerts, regularIntervalsOf, validateImport } =
    await import("../app/final-workflow.ts");
  const pad = (n) => String(n).padStart(2, "0");
  const mixedHours = Array.from({ length: 24 }, (_, h) =>
    h === 7 || h === 8
      ? Array.from({ length: 4 }, (_, q) =>
          `${pad(h)}:${pad(q * 15)}~${pad(q === 3 ? h + 1 : h)}:${pad(((q + 1) * 15) % 60)}`)
      : [`${pad(h)}:00~${pad(h + 1)}:00`],
  ).flat();
  const alerts = detectMixedIntervalAlerts(mixedHours.map((hour) => cell(hour)));
  assert.equal(alerts.length, 1, "混用整點＋15 分鐘格應該報一筆");
  assert.equal(alerts[0].type, "調查格距混用");
  assert.match(alerts[0].text, /15 分鐘 × 8 格/, alerts[0].text);
  assert.match(alerts[0].text, /60 分鐘 × 22 格/, alerts[0].text);
  assert.match(alerts[0].text, /不一定是錯/, "要講明這個版型本身可能是刻意的");

  /* 同一份判準：兩處看同一批資料必須得到同一個結論。 */
  const row = (hour) => ({
    projectId: "P", quarter: "115Q1", roadId: "R1", roadName: "測試路段",
    dayType: "平日", directionCode: "A", directionName: "方向A",
    hour, motorcycle: 10, small: 10, large: 0, special: 0,
  });
  const warned = (hours) =>
    (validateImport(hours.map(row), []).warnings ?? []).some((w) =>
      /混用了不同長度的時間格/.test(w),
    );
  for (const [name, hours] of [
    ["混用整點＋15 分鐘", mixedHours],
    ["全部整點", Array.from({ length: 24 }, (_, h) => `${pad(h)}:00~${pad(h + 1)}:00`)],
    ["全部 15 分鐘", Array.from({ length: 8 }, (_, i) => {
      const s = 7 * 60 + i * 15;
      return `${pad(Math.floor(s / 60))}:${pad(s % 60)}~${pad(Math.floor((s + 15) / 60))}:${pad((s + 15) % 60)}`;
    })],
  ]) {
    const byAlert = detectMixedIntervalAlerts(hours.map((h) => cell(h))).length > 0;
    assert.equal(
      byAlert,
      warned(hours),
      `${name}：異常清單與匯入警告的結論不一致——判準漂移了`,
    );
    /* 對照：規律格長的種類數要與兩邊的結論一致。 */
    assert.equal(byAlert, regularIntervalsOf(hours).length > 1, `${name}：判準函式本身不一致`);
  }
});

test("⚠️ 一次性的跳號不算「另一種規律」（不可以誤報）", async () => {
  const { detectMixedIntervalAlerts } = await import("../app/final-workflow.ts");
  /*
   * 短時段資料只漏一列時，相鄰間隔可能只有 4 個，那一個 30 分鐘的跳號
   * 就占 25%。舊判準只有「兩成門檻」會把全部整點的資料誤報成混用。
   */
  const hours = ["06:00~07:00", "07:00~08:00", "08:00~08:30", "08:30~09:30"];
  assert.deepEqual(detectMixedIntervalAlerts(hours.map((h) => cell(h))), []);
});

test("⚠️ 統計卡要列得出「調查格距混用」（0 筆也要在）", () => {
  assert.ok(
    anomalyTypeCounts([]).some((item) => item.type === "調查格距混用"),
    "統計卡沒有這個類型，使用者不知道系統有查這一項",
  );
  assert.ok(ANOMALY_TYPES.includes("調查格距混用"));
  assert.ok(ANOMALY_RESOLUTIONS["調查格距混用"], "沒有寫解決方式");
});
