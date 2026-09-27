import assert from "node:assert/strict";
import test from "node:test";
import {
  CONCLUSION_METRICS,
  DEFAULT_CONDITION,
  buildConclusion,
  quarterKey,
  quarterYear,
  selectRows,
} from "../app/conclusion.ts";

/* 樣本列與 meta 抽到 helpers，跨系統守門測試共用同一份形狀。 */
import {
  CONCLUSION_META as META,
  cell,
  row,
} from "./helpers/conclusion-row.mjs";



const cond = (over = {}) => ({ ...DEFAULT_CONDITION, ...over });

test("季度排序鍵可以混排民國兩碼、三碼與西元四碼", () => {
  assert.ok(quarterKey("99Q4") < quarterKey("100Q1"));
  assert.equal(quarterKey("2026Q1"), quarterKey("115Q1"));
  assert.equal(quarterYear("115Q2"), "115");
});

test("單季／年度／區間條件都會生效", () => {
  const rows = ["114Q3", "114Q4", "115Q1", "115Q2"].map((quarter) => row({ quarter }));
  assert.deepEqual(
    selectRows(rows, cond({ scope: { kind: "quarter", quarter: "115Q1" } })).map(
      (r) => r.quarter,
    ),
    ["115Q1"],
  );
  assert.deepEqual(
    selectRows(rows, cond({ scope: { kind: "year", year: "114" } })).map((r) => r.quarter),
    ["114Q3", "114Q4"],
  );
  assert.deepEqual(
    selectRows(
      rows,
      cond({ scope: { kind: "range", from: "115Q1", to: "114Q4" } }),
    ).map((r) => r.quarter),
    ["114Q4", "115Q1"],
    "起訖顛倒也要能用",
  );
});

test("路段、方向與日別條件都會生效", () => {
  const rows = [
    row({ roadId: "R-01", scopeCode: "ALL", dayType: "平日" }),
    row({ roadId: "R-01", scopeCode: "A", scopeName: "方向A", dayType: "平日" }),
    row({ roadId: "R-02", scopeCode: "ALL", dayType: "假日" }),
  ];
  assert.equal(selectRows(rows, cond({ roadIds: ["R-01"] })).length, 2);
  assert.equal(selectRows(rows, cond({ scopeCodes: ["A"] })).length, 1);
  assert.equal(selectRows(rows, cond({ dayTypes: ["假日"] })).length, 1);
});

test("只勾車輛數時不會寫出 PCU，反之亦然", () => {
  const onlyCount = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  // 標頭那段單位說明本來就會同時提到兩種單位，所以只看數值那一行。
  const valueLine = (text) => text.split("\n").find((line) => /全日：/.test(line)) || "";
  assert.match(onlyCount, /10,000 輛\/日/);
  assert.doesNotMatch(valueLine(onlyCount), /PCU/, valueLine(onlyCount));
  const onlyPcu = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["pcu"] }),
    META,
  );
  assert.match(onlyPcu, /8,000\.0 PCU\/日/);
  assert.doesNotMatch(valueLine(onlyPcu), /輛\/日/, valueLine(onlyPcu));
});

test("全調查時段與尖峰的單位分開標示，不會把累計量標成每小時", () => {
  /*
   * ⚠️ 名稱在 v20.64 改為「全調查時段」（三支一致），但要驗的事情沒變：
   *   累計量與流率是兩種單位，不可以混。分母是「日」還是「調查時段」
   *   由該筆的實際涵蓋決定，這一份測資是 24 小時，所以是「輛/日」。
   */
  const text = buildConclusion(
    [row()],
    cond({ periods: ["all", "am"], metrics: ["count", "peakHour"] }),
    META,
  );
  assert.match(text, /全調查時段：24 小時、10,000 輛\/日/);
  assert.match(text, /上午尖峰小時：07:00～08:00、1,200 輛\/hr/);
  assert.doesNotMatch(
    text,
    /全調查時段：[^\n]*輛\/hr/,
    "把整段調查的累計量標成每小時流率了",
  );
});

test("車種組成的百分比以該格總量為分母", () => {
  const text = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["composition"] }),
    META,
  );
  assert.match(text, /機車 6,000 輛\/日（60\.0%）/);
  assert.match(text, /小型車 3,500 輛\/日（35\.0%）/);
});

test("最大宗車種挑的是車輛數最多的那一種", () => {
  const text = buildConclusion(
    [row()],
    cond({ periods: ["all"], metrics: ["topVehicle"] }),
    META,
  );
  assert.match(text, /最大宗車種為機車，6,000 輛\/日（佔 60\.0%）/);
});

test("沒勾「各方向分列」時只寫合計那一列", () => {
  const rows = [
    row({ scopeCode: "ALL", scopeName: "雙向合計" }),
    row({ scopeCode: "A", scopeName: "方向A" }),
    row({ scopeCode: "B", scopeName: "方向B" }),
  ];
  const without = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  assert.doesNotMatch(without, /方向A/);
  const with_ = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "directionSplit"] }),
    META,
  );
  assert.match(with_, /方向A/);
  assert.match(with_, /方向B/);
});

test("單位不一致時拒絕比較，並說明原因", () => {
  const rows = [
    row({ quarter: "115Q1" }),
    row({
      quarter: "115Q2",
      periods: {
        all: cell({ hour: "實測 8 小時（非 24 小時）", unitCount: "輛/調查時段" }),
      },
    }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["growth"], grouping: "byRoad" }),
    META,
  );
  assert.match(text, /單位不一致/);
  assert.doesNotMatch(text, /增加 0\.0%/);
});

test("季度變動只在同一路段、同一方向、同一日別之間計算", () => {
  const rows = [
    row({ quarter: "114Q1", periods: { all: cell({ total: 10000 }) } }),
    row({ quarter: "114Q4", periods: { all: cell({ total: 12500 }) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ scope: { kind: "year", year: "114" }, periods: ["all"], metrics: ["growth"] }),
    META,
  );
  assert.match(text, /由 114Q1 的 10,000 輛\/日 變為 114Q4 的 12,500 輛\/日/);
  assert.match(text, /增加 25\.0%/);
});

test("起始為 0 時不寫出無限大的百分比", () => {
  const rows = [
    row({ quarter: "114Q1", periods: { all: cell({ total: 0 }) } }),
    row({ quarter: "114Q2", periods: { all: cell({ total: 500 }) } }),
  ];
  const text = buildConclusion(rows, cond({ periods: ["all"], metrics: ["growth"] }), META);
  assert.match(text, /起始季為 0/);
  assert.doesNotMatch(text, /Infinity|NaN/);
});

test("平日假日對比只比同一路段同一季，且單位不同時不比", () => {
  const rows = [
    row({ dayType: "平日", periods: { all: cell({ total: 10000 }) } }),
    row({ dayType: "假日", periods: { all: cell({ total: 8000 }) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["dayCompare"], grouping: "byRoad" }),
    META,
  );
  assert.match(text, /平日 10,000 輛\/日、假日 8,000 輛\/日/);
  assert.match(text, /假日較平日少 20\.0%/);
});

test("最大最小只比合計列，混單位時不比", () => {
  const rows = [
    row({ roadId: "R-01", roadName: "中山路", periods: { all: cell({ total: 10000 }) } }),
    row({ roadId: "R-02", roadName: "示範南路", periods: { all: cell({ total: 4000 }) } }),
    row({ roadId: "R-01", scopeCode: "A", scopeName: "方向A", periods: { all: cell({ total: 999999 }) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["extremes"], grouping: "overall" }),
    META,
  );
  assert.match(text, /最高為 中山路/);
  assert.match(text, /最低為 示範南路/);
  assert.doesNotMatch(text, /99,999/, "方向列不可以拿來跟整條路段比");
});

test("部分時段調查會在文末註明不可與完整全日比較", () => {
  const text = buildConclusion(
    [row({ periods: { all: cell({ unitCount: "輛/調查時段" }) } })],
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  assert.match(text, /部分時段調查/);
  assert.match(text, /不可與完整全日的「輛\/日」直接比較/);
});

test("沒有資料的格子會明講，不會寫成 0", () => {
  const text = buildConclusion(
    [row({ periods: { all: cell({ hasData: false }) } })],
    cond({ periods: ["all"], metrics: ["count"] }),
    META,
  );
  assert.match(text, /這一列沒有資料/);
  assert.doesNotMatch(text, /0 輛/);
});

test("條件挑不到資料時給的是可行動的說明", () => {
  const text = buildConclusion(
    [row({ quarter: "115Q2" })],
    cond({ scope: { kind: "quarter", quarter: "113Q1" } }),
    META,
  );
  assert.match(text, /所選條件沒有對應的資料/);
  assert.match(text, /請放寬季度範圍/);
});

test("三種分段方式都寫得出東西", () => {
  const rows = [row({ quarter: "115Q1" }), row({ quarter: "115Q2" })];
  for (const grouping of ["byRoad", "byQuarter", "overall"]) {
    const text = buildConclusion(
      rows,
      cond({ periods: ["all"], metrics: ["count"], grouping }),
      META,
    );
    assert.match(text, /^1\. /m, `${grouping} 應該有第 1 段`);
    assert.ok(text.length > 150, `${grouping} 不應該幾乎空白`);
  }
});

test("每一個可勾選指標都真的會改變輸出（沒有死選項）", () => {
  const rows = [
    row({ quarter: "114Q1", dayType: "平日" }),
    row({ quarter: "114Q2", dayType: "平日" }),
    row({ quarter: "114Q2", dayType: "假日" }),
    row({ quarter: "114Q2", roadId: "R-02", roadName: "示範南路" }),
    row({ quarter: "114Q2", scopeCode: "A", scopeName: "方向A" }),
  ];
  const base = cond({ periods: ["all", "am"], metrics: [], grouping: "byRoad" });
  const empty = buildConclusion(rows, base, META);
  for (const metric of CONCLUSION_METRICS) {
    const text = buildConclusion(rows, { ...base, metrics: [metric.key] }, META);
    assert.notEqual(
      text,
      empty,
      `勾選「${metric.label}」之後輸出必須有變化，否則就是死選項`,
    );
  }
});

test("標頭一定寫明全調查時段與尖峰的單位規則", () => {
  const text = buildConclusion([row()], cond(), META);
  /*
   * ⚠️ v20.64 起這一句的內容也變了，不只是換名字：
   *   舊：「全日」是**一整天**的加總 → 對 4 小時的調查來說是錯的
   *   新：「全調查時段」是**這份調查涵蓋時段**的加總，並寫出兩種分母
   */
  assert.match(text, /「全調查時段」是這份調查涵蓋時段的加總/);
  assert.match(text, /24 小時的調查標為/);
  assert.match(text, /不足 24 小時的標為/);
  assert.match(text, /尖峰數值是率，不跨調查點、跨季度相加/);
  assert.doesNotMatch(
    text,
    /「全調查時段」是一整天的加總/,
    "還寫著「一整天」——4 小時的調查會被這句話誤導",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A18：混合勾選的組合測試（測試盲區）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-21 的盤點結果：本支的結論草稿有 19 項測試，
 * 其中「一次勾 3 項以上」的組合是 **0 項**，而且從來沒有一支勾滿四個時段。
 * 姊妹專案路口轉向的三個真實缺陷（時段接在空的地方、支線篩選對車種組成
 * 無效、單位寫錯）全部躲在同一個盲區裡。
 *
 * ⚠️ **只斷言「草稿不是空的」不算數**——出事的草稿本來就不是空的。
 *   這裡逐一斷言每一個勾起來的項目都真的寫出來了。
 */
test("⚠️ 四個時段全勾：每一個都要寫出來，而且單位各自正確", () => {
  const text = buildConclusion(
    [row()],
    cond({
      periods: ["all", "am", "pm", "allPeak"],
      metrics: ["count", "pcu", "peakHour"],
    }),
    META,
  );
  for (const label of [
    "全調查時段",
    "上午尖峰小時",
    "下午尖峰小時",
    "全調查時段尖峰",
  ])
    assert.ok(text.includes(label), `草稿裡沒有「${label}」`);
  /* 全調查時段是累計量、尖峰是流率，兩種單位都要出現。 */
  assert.match(text, /輛\/日|輛／日/, "全調查時段的單位不見了");
  assert.match(text, /輛\/hr/, "尖峰的單位不見了");
});

test("⚠️ 混合勾選：依附時段的與不依附時段的一起勾，兩邊都要寫出來", () => {
  const text = buildConclusion(
    [row()],
    cond({
      periods: ["all", "allPeak"],
      metrics: [
        "count",
        "pcu",
        "peakHour",
        "composition",
        "topVehicle",
        "directionSplit",
      ],
    }),
    META,
  );
  assert.match(text, /全調查時段/);
  assert.match(text, /全調查時段尖峰/);
  assert.match(text, /車種組成|機車/, "勾了車種組成卻沒有寫");
  assert.match(text, /8,000|1,120/, "勾了當量交通量卻沒有寫");
  assert.doesNotMatch(
    text,
    /沒有.*全調查時段尖峰.*資料/,
    "第四個時段接在空的地方——勾了卻永遠得不到數字",
  );
});

test("⚠️ 前置：測資真的有四個時段（少一格會讓上面兩支變成恆真）", () => {
  const sample = row();
  for (const key of ["all", "am", "pm", "allPeak"])
    assert.ok(sample.periods[key], `測資缺少 ${key}，上面的組合測試等於沒驗`);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「平日與假日對比」不吃日別條件（2026-09-23 反向對帳，B 類）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 缺陷：日別選「平日」之後，`selectRows` 先把假日濾掉，於是
 *   ・byRoad／byQuarter 分組 → 整段**一個字都沒有**
 *   ・overall 分組 → 印出「範圍內沒有…平日與假日的資料」，而**那句話是錯的**
 *                    ——資料存在，是被條件濾掉的
 * 而畫面與 Excel 的平假日比較刻意不套日別（那兩處的註解自己寫著理由），
 * 報表文字草稿也印著「平假日比較一律同時統計兩種日別」。三處一致，
 * 只有結論草稿這一支反過來——使用者出了題，表格查得到答案，草稿抓不出來。
 */
const dayPair = () => [
  row({ quarter: "115Q2", dayType: "平日", roadId: "R-01", roadName: "中山路" }),
  row({
    quarter: "115Q2",
    dayType: "假日",
    roadId: "R-01",
    roadName: "中山路",
    periods: {
      all: cell({ total: 8000, pcu: 6400 }),
      am: cell({ hour: "07:00～08:00", total: 900, pcu: 700, unitCount: "輛/hr", unitPcu: "PCU/hr" }),
      pm: cell({ hour: "17:00～18:00", total: 1100, pcu: 850, unitCount: "輛/hr", unitPcu: "PCU/hr" }),
      allPeak: cell({ hour: "17:15～18:15", total: 1150, pcu: 880, unitCount: "輛/hr", unitPcu: "PCU/hr" }),
    },
  }),
];

const DAY_COMPARE_COND = {
  periods: ["all"],
  metrics: ["count", "dayCompare"],
};

for (const grouping of ["byRoad", "byQuarter", "overall"]) {
  test(`⚠️ 日別選「平日」時，「平日與假日對比」仍然要寫出來（${grouping}）`, () => {
    const rows = dayPair();
    const text = buildConclusion(
      rows,
      cond({ ...DAY_COMPARE_COND, grouping, dayTypes: ["平日"] }),
      META,
    );
    assert.match(
      text,
      /平日 10,000 輛\/日、假日 8,000 輛\/日/,
      "日別條件把假日濾掉了——表格查得到的答案，草稿抓不出來",
    );
    assert.match(
      text,
      /假日較平日少 20\.0%/,
      "差異百分比沒算出來",
    );
    assert.match(
      text,
      /本段刻意不受上方「日別」條件限制/,
      "沒有講明這一段不吃日別條件，使用者會以為是自己的條件濾掉的",
    );
  });
}

test("⚠️ 反證：沒有假日資料時要寫出理由，不可以整段消失", () => {
  for (const grouping of ["byRoad", "byQuarter", "overall"]) {
    const text = buildConclusion(
      [dayPair()[0]],
      cond({ ...DAY_COMPARE_COND, grouping }),
      META,
    );
    assert.match(
      text,
      /同時具備平日與假日的資料，未做對比/,
      `${grouping}：沒得比的時候整段消失，使用者不知道為什麼`,
    );
    assert.doesNotMatch(
      text,
      /本段刻意不受上方「日別」條件限制/,
      `${grouping}：沒設日別條件時不該多印那一句`,
    );
  }
});

test("⚠️ 反證：沒設日別條件時，輸出與改版前逐字相同", () => {
  const rows = dayPair();
  for (const grouping of ["byRoad", "byQuarter", "overall"]) {
    const text = buildConclusion(rows, cond({ ...DAY_COMPARE_COND, grouping }), META);
    assert.match(text, /平日 10,000 輛\/日、假日 8,000 輛\/日/);
    assert.doesNotMatch(
      text,
      /本段刻意不受上方「日別」條件限制/,
      `${grouping}：沒設日別條件卻印了那一句`,
    );
  }
});

test("⚠️ 反證：日別條件對其餘各段仍然生效（別把日別整個改鬆了）", () => {
  const rows = dayPair();
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "dayCompare"], grouping: "byRoad", dayTypes: ["平日"] }),
    META,
  );
  assert.doesNotMatch(
    text,
    /〔115Q2・假日・/,
    "逐列那一段把假日也印出來了——日別條件被改鬆，這是真的改壞既有功能",
  );
  assert.match(text, /〔115Q2・平日・/, "逐列那一段連平日都沒印");
});

test("⚠️ 「依路段分段」的季度變動沒得比時也要寫出理由", () => {
  const text = buildConclusion(
    [dayPair()[0]],
    cond({ periods: ["all"], metrics: ["count", "growth"], grouping: "byRoad" }),
    META,
  );
  assert.match(
    text,
    /沒有任何一列具備兩季以上的資料，未做季度比較/,
    "整段消失，使用者不知道是資料不足還是功能壞了",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  可比性要比「實際涵蓋區間」，不可以比給人看的標籤
 *  （GPT 獨立複查 2026-09-24 在 v20.83 候選上抓到）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 平日調查 07:00–11:00、假日調查 17:00–21:00 —— 兩邊的 `hour` 標籤
 * **一模一樣**（都是「實測 4 小時（非 24 小時）」）。舊版拿 `hour` 去比，
 * 字串相同 → 檢查通過 → 草稿照樣印出「假日較平日少 X%」，
 * 而那兩段時間根本不是同一段。這句話會被抄進報告。
 *
 * 畫面與 Excel 用的 `sameSurveyCoverage()` 比的是**每一個連續區塊的起訖**，
 * 本來就擋住這一種，只有兩支草稿沒擋。
 */
const PARTIAL_LABEL = "實測 4 小時（非 24 小時）";
function partialCell(coverageKey, total) {
  return cell({
    hour: PARTIAL_LABEL,
    coverageKey,
    total,
    pcu: total * 0.8,
    unitCount: "輛/調查時段",
    unitPcu: "PCU/調查時段",
  });
}
/** 平日 07:00–11:00、假日 17:00–21:00：標籤相同、實際時段不同。 */
const WEEKDAY_KEY = "240m|07:00～11:00";
const HOLIDAY_KEY = "240m|17:00～21:00";

test("⚠️ 平假日對比：標籤相同但實際時段不同時，不可以算差異百分比", () => {
  const rows = [
    row({ dayType: "平日", periods: { all: partialCell(WEEKDAY_KEY, 10000) } }),
    row({ dayType: "假日", periods: { all: partialCell(HOLIDAY_KEY, 8000) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "dayCompare"], grouping: "overall" }),
    META,
  );
  assert.match(text, /調查涵蓋不同/, `沒擋住：\n${text}`);
  assert.doesNotMatch(
    text,
    /假日較平日[多少] 20\.0%/,
    `算出了一個不可比的百分比——那 20% 是時段的差，不是交通量的差：\n${text}`,
  );
});

test("⚠️ 反證：實際時段相同時要照樣算得出百分比（不可以誤殺）", () => {
  const rows = [
    row({ dayType: "平日", periods: { all: partialCell(WEEKDAY_KEY, 10000) } }),
    row({ dayType: "假日", periods: { all: partialCell(WEEKDAY_KEY, 8000) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "dayCompare"], grouping: "overall" }),
    META,
  );
  assert.match(text, /假日較平日少 20\.0%/, `同一段時段卻被擋掉了：\n${text}`);
  assert.doesNotMatch(text, /調查涵蓋不同/, text);
});

test("⚠️ 季度變動：標籤相同但實際時段不同時，不可以算變動幅度", () => {
  const rows = [
    row({ quarter: "115Q1", periods: { all: partialCell(WEEKDAY_KEY, 10000) } }),
    row({ quarter: "115Q2", periods: { all: partialCell(HOLIDAY_KEY, 30000) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "growth"], grouping: "overall" }),
    META,
  );
  assert.match(text, /各季的調查涵蓋不同/, `沒擋住：\n${text}`);
  assert.doesNotMatch(text, /增加 200\.0%/, `算出了一個不可比的百分比：\n${text}`);
  /* 訊息裡要印人看得懂的標籤，不是指紋。 */
  assert.match(text, /實測 4 小時（非 24 小時）/, "訊息應該印 hour 標籤");
  assert.doesNotMatch(text, /240m\|/, "指紋是內部鍵值，不可以印給使用者看");
});

test("⚠️ 反證：季度之間實際時段相同時要照樣算（不可以誤殺）", () => {
  const rows = [
    row({ quarter: "115Q1", periods: { all: partialCell(WEEKDAY_KEY, 10000) } }),
    row({ quarter: "115Q2", periods: { all: partialCell(WEEKDAY_KEY, 30000) } }),
  ];
  const text = buildConclusion(
    rows,
    cond({ periods: ["all"], metrics: ["count", "growth"], grouping: "overall" }),
    META,
  );
  assert.match(text, /增加 200\.0%/, `同一段時段卻被擋掉了：\n${text}`);
});

test("⚠️ 前置：coverageKeyOf() 與 sameSurveyCoverage() 必須等價", async () => {
  /*
   * 指紋字串相同 ⇔ sameSurveyCoverage() 為 true。
   * 少了這一條，指紋的組法哪天改了（例如漏掉區塊起訖）也不會有人知道，
   * 而上面那四支會安靜地變成恆真或恆假。
   */
  const { coverageKeyOf } = await import("../app/period-analysis.ts");
  const { surveyCoverage, sameSurveyCoverage } = await import("../app/partial-day.ts");
  const CASES = [
    ["07:00~11:00"],
    ["17:00~21:00"],
    ["07:00~09:00", "17:00~19:00"],
    ["08:00~10:00", "18:00~20:00"],
    Array.from({ length: 24 }, (_, h) =>
      `${String(h).padStart(2, "0")}:00~${String(h + 1).padStart(2, "0")}:00`),
  ];
  let bothTrue = 0;
  for (const a of CASES)
    for (const b of CASES) {
      const same = sameSurveyCoverage(surveyCoverage(a), surveyCoverage(b));
      const keyed = coverageKeyOf(a) === coverageKeyOf(b);
      assert.equal(
        keyed,
        same,
        `指紋與 sameSurveyCoverage 不一致：\n  ${a.join("、")}\n  ${b.join("、")}`,
      );
      if (same) bothTrue += 1;
    }
  /* 對照：至少要有相等（對角線 5 組）與不相等兩種結果，否則等價性沒驗到。 */
  assert.equal(bothTrue, CASES.length, "只有對角線應該相等");
  assert.ok(
    CASES.length * CASES.length > bothTrue,
    "全部都相等——這一支沒有驗到不相等的那一半",
  );
});
