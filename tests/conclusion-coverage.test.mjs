/*
 * ══════════════════════════════════════════════════════════════════════
 *  結論草稿產生器：全條件覆蓋盤點（使用者 2026-09-23 指定）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者的話（這一支存在的理由）：
 *   「因為圖表很多，使用者更多是依賴結論草稿產生器，所以針對結論草稿產生器
 *     以及報表草稿產生器，**功能正常運作等同於數值正確性一樣重要**」
 *   「只要程式查的到的數值，結論草稿產生器應該都能讓使用者勾選對應條件後，
 *     產出正確的數值，不要再出現如同我上次在路口轉向系統，找不到我要的結果」
 *
 * ── 這一支在防哪四種缺陷（都在姊妹專案上真的發生過）──────────────
 *
 *   ① **勾了卻什麼都沒寫**（時段接在空的地方，勾了永遠沒數字）
 *   ② **抬頭說有篩、內容沒篩**（篩選條件對某一個指標無效）
 *   ③ **根本勾不到**（某一個時段沒有對應的勾選框）
 *   ④ **單位跟著錯**（累計量被寫成一小時的流率，會被抄進報告）
 *
 * ── 為什麼要用「矩陣」而不是逐項寫測試 ──────────────────────────
 *
 *   這幾種缺陷都是**單獨勾都對、組合起來才出事**，而它們能活下來，
 *   正是因為測試是一項一項手寫的——沒有人會想到去寫那個組合。
 *   2026-09-21 的盤點結果：本支 19 項結論測試裡，
 *   「一次勾 3 項以上」的組合是 **0 項**。
 *   這裡改成把每一個指標 × 每一個時段跑一遍，由程式回報哪一格是空的。
 *
 * ⚠️ 判定一律用**該指標特有的字樣**，不是「草稿不是空的」——
 *   出事的草稿本來就不是空的。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
} from "../app/conclusion.ts";
import { PERIOD_KEYS } from "../app/period-analysis.ts";
import { CONCLUSION_META as META, row } from "./helpers/conclusion-row.mjs";

const cond = (over = {}) => ({ ...DEFAULT_CONDITION, ...over });
const KEYS = CONCLUSION_METRICS.map((metric) => metric.key);

/*
 * 每一個指標**特有**的字樣。
 *
 * ⚠️ 下面有一支測試釘住「新增指標時不可以忘記在這裡登記」——
 *   忘了登記的話，矩陣會安靜地少驗一格，而那正是這一支要防的事。
 */
const MARKS = {
  count: /[\d,]+ 輛\/(日|hr|調查時段)/,
  pcu: /[\d,.]+ PCU\/(日|hr|調查時段)/,
  /*
   * ⚠️ 2026-09-23 收緊。舊字樣 `/(\d{2}:\d{2}～\d{2}:\d{2}|24 小時)/` 裡的
   *   「24 小時」在**草稿的固定說明**裡本來就有
   *   （「完整 24 小時的調查標為輛/日…」），所以那一格四個時段全部恆真。
   *   現在一律要求前面帶著時段名稱與冒號，那才是這個指標真的印出來的形狀。
   */
  peakHour: /：(\d{2}:\d{2}～\d{2}:\d{2}|24 小時)/,
  composition: /車種組成：/,
  compositionPcu: /各車種當量：/,
  topVehicle: /最大宗車種為/,
  directionSplit: /・方向A〕/,
  dayCompare: /假日較平日(多|少)/,
  growth: /(增加|減少) [\d.]+%/,
  extremes: /(最高為|最低為)/,
};

test("MARKS 與 CONCLUSION_METRICS 一一對應（新增指標不可以漏登記）", () => {
  assert.deepEqual(
    [...KEYS].sort(),
    Object.keys(MARKS).sort(),
    "有指標沒有登記判定字樣——下面的矩陣會少驗一格而且不會有人發現",
  );
});

/** 兩季 × 兩個路段 × 平假日，跨季與對比指標才有得算。 */
function corpus() {
  return [
    row({ quarter: "115Q1", dayType: "平日" }),
    row({ quarter: "115Q2", dayType: "平日" }),
    row({ quarter: "115Q2", dayType: "假日" }),
    row({
      quarter: "115Q2",
      dayType: "平日",
      roadId: "R-02",
      roadName: "示範南路",
    }),
    row({
      quarter: "115Q2",
      dayType: "平日",
      scopeCode: "A",
      scopeName: "方向A",
    }),
  ];
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 每一個判定字樣都必須**分辨得出來**（對照組：一個指標都不勾）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 在姊妹專案交通服務水準上抓到：它的 12 格覆蓋矩陣**有 5 格恆真**
 * ——草稿的固定抬頭本來就含「旅行速率」「行駛速率」「服務水準」「速限」「筆」
 * 這幾個詞，所以那幾個指標壞成什麼樣都會是綠的。
 *
 * 這一支是同一種病的**通用疫苗**：把 metrics 設成空陣列（一個指標都不勾），
 * 這時候草稿裡不可以出現任何一個指標的判定字樣。出現了就代表那個字樣
 * 認的是固定文字，不是那個指標的輸出。
 *
 * ⚠️ 要放在矩陣**前面**：矩陣全綠但字樣是恆真的，比矩陣紅還糟。
 */
test("⚠️ 判定字樣必須分辨得出來：一個指標都不勾時，一個字樣都不可以命中", () => {
  const rows = corpus();
  const bogus = [];
  for (const grouping of ["byRoad", "overall"])
    for (const period of PERIOD_KEYS) {
      const blank = buildConclusion(
        rows,
        cond({
          scope: { kind: "project" },
          periods: [period],
          metrics: [],
          grouping,
        }),
        META,
      );
      for (const key of KEYS)
        if (MARKS[key].test(blank))
          bogus.push(`${key}（時段 ${period}／分組 ${grouping}）：${MARKS[key]}`);
    }
  const unique = [...new Set(bogus)];
  assert.deepEqual(
    unique,
    [],
    "這些判定字樣在「一個指標都不勾」時就已經命中——\n" +
      "它們認的是草稿的固定文字，不是那個指標的輸出，\n" +
      "所以矩陣裡對應的那幾格是**恆真**的，指標壞掉也不會紅：\n  " +
      unique.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ① 矩陣：每一個指標 × 每一個時段，都要真的寫得出東西
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 矩陣：每一個指標在四個時段底下都寫得出內容", () => {
  const rows = corpus();
  const holes = [];
  for (const period of PERIOD_KEYS)
    for (const key of KEYS) {
      const text = buildConclusion(
        rows,
        cond({
          scope: { kind: "project" },
          periods: [period],
          metrics: [key],
          grouping: key === "extremes" ? "overall" : "byRoad",
        }),
        META,
      );
      if (!MARKS[key].test(text))
        holes.push(
          `時段「${period}」＋指標「${key}」：勾了卻寫不出內容\n--- 草稿 ---\n${text}\n---`,
        );
    }
  assert.deepEqual(
    holes,
    [],
    `有 ${holes.length} 種勾選組合產不出內容：\n\n${holes.join("\n\n")}`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ② 篩選：宣稱有篩就要真的篩到
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 路段篩選：勾一個路段不可以寫出另一個路段", () => {
  const text = buildConclusion(
    corpus(),
    cond({
      scope: { kind: "project" },
      periods: ["all"],
      metrics: ["count"],
      roadIds: ["R-01"],
    }),
    META,
  );
  assert.match(text, /中山路/);
  assert.doesNotMatch(text, /示範南路/, "路段篩選沒有生效");
});

test("⚠️ 日別篩選：勾平日不可以寫出假日的數字", () => {
  const weekday = buildConclusion(
    corpus(),
    cond({
      scope: { kind: "project" },
      periods: ["all"],
      metrics: ["count"],
      dayTypes: ["平日"],
    }),
    META,
  );
  const holiday = buildConclusion(
    corpus(),
    cond({
      scope: { kind: "project" },
      periods: ["all"],
      metrics: ["count"],
      dayTypes: ["假日"],
    }),
    META,
  );
  assert.notEqual(weekday, holiday, "日別篩選沒有生效");
});

test("⚠️ 方向／支線篩選：勾不同的要寫出不同的字", () => {
  const all = buildConclusion(
    corpus(),
    cond({ scope: { kind: "project" }, periods: ["all"], metrics: ["count"] }),
    META,
  );
  const onlyA = buildConclusion(
    corpus(),
    cond({
      scope: { kind: "project" },
      periods: ["all"],
      metrics: ["count"],
      scopeCodes: ["A"],
    }),
    META,
  );
  assert.notEqual(all, onlyA, "方向／支線篩選沒有生效");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ③ 分組與範圍：每一種都要產得出東西
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 三種分組方式都產得出內容，而且輸出彼此不同", () => {
  const texts = ["byRoad", "byQuarter", "overall"].map((grouping) =>
    buildConclusion(
      corpus(),
      cond({
        scope: { kind: "project" },
        periods: ["all"],
        metrics: ["count", "pcu"],
        grouping,
      }),
      META,
    ),
  );
  for (const [index, text] of texts.entries())
    assert.match(text, /輛/, `第 ${index + 1} 種分組沒有寫出數字`);
  assert.equal(
    new Set(texts).size,
    3,
    "三種分組方式寫出一模一樣的字——選項等於沒有作用",
  );
});

test("⚠️ 四種統計範圍（單季／年度／區間／全計畫）都挑得到資料", () => {
  const rows = [
    row({ quarter: "114Q4" }),
    row({ quarter: "115Q1" }),
    row({ quarter: "115Q2" }),
  ];
  for (const scope of [
    { kind: "quarter", quarter: "115Q1" },
    { kind: "year", year: "115" },
    { kind: "range", from: "114Q4", to: "115Q1" },
    { kind: "project" },
  ]) {
    const text = buildConclusion(
      rows,
      cond({ scope, periods: ["all"], metrics: ["count"] }),
      META,
    );
    assert.match(
      text,
      /輛/,
      `範圍 ${JSON.stringify(scope)} 挑不到任何資料`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  ④ 全部一起勾：不可以互相吃掉
 * ══════════════════════════════════════════════════════════════════════
 */
test("⚠️ 四個時段 × 全部指標一起勾：每一個指標都還在", () => {
  const text = buildConclusion(
    corpus(),
    cond({
      scope: { kind: "project" },
      periods: [...PERIOD_KEYS],
      metrics: [...KEYS],
      grouping: "byRoad",
    }),
    META,
  );
  const missing = KEYS.filter((key) => !MARKS[key].test(text));
  assert.deepEqual(
    missing,
    [],
    `全部勾起來時，這些指標被其他指標吃掉了：${missing.join("、")}`,
  );
  for (const label of [
    "全調查時段",
    "上午尖峰小時",
    "下午尖峰小時",
    "全調查時段尖峰",
  ])
    assert.ok(text.includes(label), `草稿裡沒有「${label}」`);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  報表文字草稿：每一個可勾選的段落都要寫得出內容
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：「報表草稿產生器，功能正常運作等同於數值正確性一樣重要」。
 *
 * ⚠️ `buildReportDraft()` 在段落產不出內容時會退回一句
 *   「…：目前範圍沒有可敘述的資料。」——那是**誠實的**，不是 bug。
 *   但如果在一份**資料齊全**的情境下還退回那一句，就是這個段落接在空的地方
 *   （姊妹專案路口轉向的 A17 在結論草稿上就是這樣：勾了永遠沒數字）。
 *   所以這裡用欄位全滿的 context 去跑，**任何一段退回那句話就是紅**。
 */
import {
  DRAFT_SECTION_ORDER,
  DRAFT_SECTION_LABELS,
  buildReportDraft,
} from "../app/report-draft.ts";
import { context as reportContext } from "./helpers/report-context.mjs";

test("⚠️ 報表草稿：每一個段落單獨勾都要寫得出內容", () => {
  const ctx = reportContext();
  const holes = [];
  for (const key of DRAFT_SECTION_ORDER) {
    const text = buildReportDraft(ctx, [key]);
    if (text.includes(`${DRAFT_SECTION_LABELS[key]}：目前範圍沒有可敘述的資料。`))
      holes.push(
        `段落「${key}」（${DRAFT_SECTION_LABELS[key]}）在資料齊全時仍然寫不出內容`,
      );
  }
  assert.deepEqual(
    holes,
    [],
    `有 ${holes.length} 個段落接在空的地方：\n${holes.join("\n")}`,
  );
});

test("⚠️ 報表草稿：全部段落一起勾，每一段都還在", () => {
  const text = buildReportDraft(reportContext(), [...DRAFT_SECTION_ORDER]);
  assert.doesNotMatch(
    text,
    /目前範圍沒有可敘述的資料。/,
    "全部一起勾的時候有段落被吃掉了",
  );
  const blocks = text.split("\n\n").length;
  assert.ok(
    blocks >= DRAFT_SECTION_ORDER.length + 2,
    `只產出 ${blocks} 段，少於勾選的 ${DRAFT_SECTION_ORDER.length} 段`,
  );
});
