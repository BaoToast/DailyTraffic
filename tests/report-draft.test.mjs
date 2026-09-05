import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  DRAFT_SECTION_LABELS,
  DRAFT_SECTION_ORDER,
  DRAFT_ONLY_SECTIONS,
  EXPORT_SECTIONS,
  buildReportDraft,
} from "../app/report-draft.ts";

function context(overrides = {}) {
  return {
    projectName: "測試計畫",
    quarter: "115Q1",
    dayType: "平日",
    roadLabel: "全部調查點",
    directionLabel: "全部方向",
    flowLabel: "駛出路口（起點）",
    coverageNote: "",
    roadCount: 2,
    intersectionCount: 1,
    recordCount: 96,
    total: 115873,
    pcu24: 85536.1,
    vehicles: [
      { label: "機車", count: 60368, share: 52.1 },
      { label: "小型車", count: 47109, share: 40.7 },
    ],
    peak: { hour: "18:00～19:00", pcu: 7200.5, unit: "PCU/hr" },
    topRoads: [
      { name: "中正路口", total: 73783, pcu: 54376.1 },
      { name: "中山路", total: 42090, pcu: 31160.5 },
    ],
    dayCompare: { weekday: 100000, holiday: 90000 },
    trend: {
      mode: "平日＋假日",
      metricLabel: "實際交通量",
      unit: "輛/日",
      roadLabel: "全部路段合計",
      rows: [
        { quarter: "114Q4", value: 100000 },
        { quarter: "115Q1", value: 115873 },
      ],
    },
    compositionMode: "全日",
    periodExport: {
      enabled: true,
      periods: ["全日時段", "上午尖峰小時"],
      scopes: ["A", "B"],
      metrics: ["車輛數", "交通流量"],
      peakScope: "整個調查點同一時段",
      flowView: "跟隨畫面",
      sheetPerPeriod: true,
    },
    periodHighlights: [
      {
        label: "上午尖峰小時",
        hour: "07:15～08:15",
        pcu: 3976.6,
        total: 5200,
        summable: true,
        siteCount: 2,
        highestPcu: 2200.1,
        highestTotal: 3000,
        highestHour: "07:15～08:15",
        unit: "輛/hr",
      },
    ],
    roadSummary: {
      note: "尖峰時段認定：整個調查點同一時段；路口流量視角：駛出路口（起點）；統計範圍：全部方向／支線",
      metrics: ["車輛數", "百分比", "交通流量"],
      roads: [
        {
          name: "示範北路（示範一路~示範二路）",
          scopes: [
            {
              name: "雙向合計",
              periods: [
                {
                  label: "全日時段",
                  hour: "24 小時",
                  hasData: true,
                  values: [
                    { label: "車輛數", value: 42090, unit: "輛/日", digits: 0 },
                    { label: "交通流量", value: 31160.5, unit: "PCU/日", digits: 1 },
                  ],
                  composition: [
                    { label: "機車", share: 52.1 },
                    { label: "小型車", share: 40.7 },
                  ],
                },
                {
                  label: "上午尖峰小時",
                  hour: "07:15～08:15",
                  hasData: true,
                  values: [
                    { label: "車輛數", value: 5200, unit: "輛/hr", digits: 0 },
                    { label: "交通流量", value: 3976.6, unit: "PCU/hr", digits: 1 },
                  ],
                  composition: [{ label: "機車", share: 55.3 }],
                },
                {
                  label: "下午尖峰小時",
                  hour: "—",
                  hasData: false,
                  values: [],
                  composition: [],
                },
              ],
            },
          ],
        },
      ],
      omitted: 0,
    },
    projectsCompare: [
      { name: "A計畫", total: 100, pcu: 80 },
      { name: "B計畫", total: 200, pcu: 160 },
    ],
    factors: [
      { label: "機車", value: "0.5" },
      { label: "小型車", value: "1" },
    ],
    intersectionNote: "路口幾何已設定 7 支支線。",
    sourceFileCount: 3,
    qualityIssueCount: 0,
    unmappedVehicles: 0,
    reviewNote: "本季狀態：已確認。",
    charts: ["全日交通量", "車種組成"],
    anomalies: [],
    ...overrides,
  };
}

const ALL_KEYS = DRAFT_SECTION_ORDER;

test("每一個匯出勾選項目都有對應的草稿段落，反之亦然", () => {
  // 這是這個功能最重要的一條測試。匯出中心的勾選清單與草稿段落若各自
  // 維護，日後新增一種匯出內容時很容易只加一邊，使用者就會遇到
  //「這個項目匯得出來，草稿裡卻永遠不會提到」。
  const exportKeys = EXPORT_SECTIONS.map((s) => s.key);
  const draftOnlyKeys = DRAFT_ONLY_SECTIONS.map((s) => s.key);
  for (const key of exportKeys)
    assert.ok(DRAFT_SECTION_ORDER.includes(key), `匯出項目 ${key} 沒有對應的草稿段落`);
  assert.deepEqual(
    [...DRAFT_SECTION_ORDER].sort(),
    [...exportKeys, ...draftOnlyKeys].sort(),
    "草稿段落與（匯出項目＋草稿專屬段落）必須一一對應",
  );
  for (const key of DRAFT_SECTION_ORDER)
    assert.ok(DRAFT_SECTION_LABELS[key], `段落 ${key} 缺少顯示名稱`);
});

test("匯出中心的勾選清單直接取用共用常數，不另外維護一份", async () => {
  const source = await readFile(new URL("../app/DashboardClient.tsx", import.meta.url), "utf8");
  assert.match(source, /EXPORT_SECTIONS/);
  // 舊版是在畫面裡直接寫死八組 [key, label]，這種寫法無法保證與草稿同步。
  assert.doesNotMatch(source, /\["current", "本季交通量、PCU與平假日比較"\]/);
});

test("全部勾選時，每一個段落都會出現在草稿裡", () => {
  const text = buildReportDraft(context(), ALL_KEYS);
  assert.match(text, /本次分析範圍：115Q1、平日、全部調查點、全部方向/);
  assert.match(text, /路口流量以「駛出路口（起點）」視角統計/);
  assert.match(text, /全日實際交通量合計 115,873 輛/);
  assert.match(text, /全日尖峰小時出現於 18:00～19:00，該時段當量交通量 7,200.5 PCU\/hr/);
  assert.match(text, /時段車種分析（分析時段：全日時段、上午尖峰小時/);
  assert.match(text, /車種組成（依「全日」統計）：機車 52.1%/);
  assert.match(text, /歷季趨勢（實際交通量，依「歷季分析」面板的 平日＋假日／全部路段合計）/);
  assert.match(text, /跨計畫比較：A計畫 100 輛/);
  assert.match(text, /歷季異常提醒：目前門檻下未發現異常。/);
  assert.match(text, /本計畫採用的 PCU 當量係數：機車 0.5、小型車 1。/);
  assert.match(text, /資料來源共 3 個原始檔；資料品質檢查未發現未滿 24 小時的方向。/);
  assert.match(text, /本次匯出附圖：全日交通量、車種組成/);
  assert.match(text, /正式引用前請核對原始調查檔/);
});

test("沒有勾選的段落不會出現", () => {
  const text = buildReportDraft(context(), ["scope"]);
  assert.match(text, /本次分析範圍/);
  assert.doesNotMatch(text, /全日實際交通量合計/);
  assert.doesNotMatch(text, /車種組成/);
});

test("勾選了但沒有資料的段落會明講，而不是靜靜消失", () => {
  const text = buildReportDraft(
    context({ projectsCompare: [], charts: [] }),
    ["projects", "charts"],
  );
  assert.match(text, /跨計畫比較：目前範圍沒有可敘述的資料。/);
  assert.match(text, /9張可編輯原生圖表：目前範圍沒有可敘述的資料。/);
});

test("平假日比較會算出正負向的變動", () => {
  const up = buildReportDraft(
    context({ dayCompare: { weekday: 100, holiday: 120 } }),
    ["current"],
  );
  assert.match(up, /假日較平日增加 20.0%（平假日比較一律同時統計兩種日別/);
  const down = buildReportDraft(
    context({ dayCompare: { weekday: 100, holiday: 80 } }),
    ["current"],
  );
  assert.match(down, /假日較平日減少 20.0%（平假日比較一律同時統計兩種日別/);
});

test("平日＋假日的整體總結分日敘述，不把兩天偽裝成一個日交通量", () => {
  const text = buildReportDraft(
    context({
      dayType: "平日＋假日",
      total: 74765,
      pcu24: 58000,
      dayTotals: [
        { dayType: "平日", total: 42090, pcu24: 31160.5 },
        { dayType: "假日", total: 32675, pcu24: 26839.5 },
      ],
    }),
    ["current"],
  );
  assert.match(text, /平日全日實際交通量 42,090 輛/);
  assert.match(text, /假日全日實際交通量 32,675 輛/);
  assert.doesNotMatch(text, /全日實際交通量合計 74,765 輛/);
});

test("部分時段調查的說明會寫進範圍段落", () => {
  const text = buildReportDraft(
    context({ coverageNote: "本筆非 24 小時調查：實際只調查 07:00～09:00，合計 2 小時。" }),
    ["scope"],
  );
  assert.match(text, /本筆非 24 小時調查/);
});

test("異常提醒超過 20 項時會截斷並說明還有幾項", () => {
  const many = Array.from({ length: 26 }, (_, i) => `異常 ${i + 1}`);
  const text = buildReportDraft(context({ anomalies: many }), ["anomaly"]);
  assert.match(text, /歷季異常提醒共 26 項/);
  assert.match(text, /其餘 6 項請見「品質與定稿」畫面/);
});

test("未指定駛入的「輛」不會被當成待確認的「項」相加", () => {
  const text = buildReportDraft(
    context({ qualityIssueCount: 1, unmappedVehicles: 10000 }),
    ["trace"],
  );
  assert.match(text, /列出 1 項未滿 24 小時的方向，另有未指定駛入 10,000 輛/);
  assert.doesNotMatch(text, /10,?001/);
});

test("各調查點分項結果會逐點、逐時段寫出，並帶著條件說明", () => {
  const text = buildReportDraft(context(), ["roads"]);
  assert.match(
    text,
    /各調查點分項結果（尖峰時段認定：整個調查點同一時段；路口流量視角：駛出路口（起點）；統計範圍：全部方向／支線；輸出數值：車輛數、百分比、交通流量）：/,
  );
  assert.match(text, /【示範北路（示範一路~示範二路）】/);
  assert.match(
    text,
    /・雙向合計｜全日時段（24 小時）：車輛數 42,090 輛\/日、交通流量 31,160.5 PCU\/日；機車 52.1%、小型車 40.7%。/,
  );
  assert.match(
    text,
    /・雙向合計｜上午尖峰小時（07:15～08:15）：車輛數 5,200 輛\/hr、交通流量 3,976.6 PCU\/hr；機車 55.3%。/,
  );
});

test("全日的單位是「輛/日」，不會被寫成每小時", () => {
  // 全日是一整天的加總，標成 /hr 會讓報告裡的單位整段是錯的。
  const text = buildReportDraft(context(), ["roads"]);
  assert.match(text, /42,090 輛\/日/);
  assert.doesNotMatch(text, /42,090 輛\/hr/);
});

test("沒有資料的時段會照樣列出並標示，不會靜靜跳過", () => {
  const text = buildReportDraft(context(), ["roads"]);
  assert.match(text, /・雙向合計｜下午尖峰小時（—）：此時段無資料。/);
});

test("車種超過五種時只列前五種，其餘併成一句", () => {
  const base = context();
  const composition = [
    { label: "機車", share: 40 },
    { label: "小型車", share: 25 },
    { label: "大型車", share: 15 },
    { label: "特種車", share: 10 },
    { label: "自行車", share: 5 },
    { label: "電動車", share: 3 },
    { label: "其他", share: 2 },
  ];
  base.roadSummary.roads[0].scopes[0].periods = [
    { label: "全日時段", hour: "24 小時", hasData: true, values: [], composition },
  ];
  const text = buildReportDraft(base, ["roads"]);
  assert.match(text, /其餘 2 種合計 5.0%/);
  assert.doesNotMatch(text, /電動車/);
});

test("整體總結與各調查點分項結果可以各自勾選，互不影響", () => {
  // 使用者要的是「新增逐點總結，但保留原本的整體總結」，
  // 所以兩段必須是獨立的段落，不是互相取代。
  const onlyOverall = buildReportDraft(context(), ["current"]);
  assert.match(onlyOverall, /全日實際交通量合計 115,873 輛/);
  assert.doesNotMatch(onlyOverall, /各調查點分項結果/);
  const both = buildReportDraft(context(), ["current", "roads"]);
  assert.match(both, /全日實際交通量合計 115,873 輛/);
  assert.match(both, /各調查點分項結果/);
});

test("沒有調查點資料時，勾了分項結果會明講", () => {
  const text = buildReportDraft(
    context({ roadSummary: { note: "", metrics: [], roads: [], omitted: 0 } }),
    ["roads"],
  );
  assert.match(text, /各調查點分項結果：目前範圍沒有可敘述的資料。/);
});

test("有資料但算不出數字時，不會謊稱「此時段無資料」，也不會叫使用者去勾已經勾了的選項", () => {
  // 只勾「百分比」而該時段車輛數全為 0 時，values 與 composition 都是空的。
  // 資料是在的，只是算不出數字——寫成「此時段無資料」是錯的，
  // 寫成「未勾選要輸出的數值」對已經勾了百分比的人也是錯的指示。
  const base = context();
  base.roadSummary.roads[0].scopes[0].periods = [
    { label: "全日時段", hour: "24 小時", hasData: true, values: [], composition: [] },
  ];
  const text = buildReportDraft(base, ["roads"]);
  assert.match(text, /此時段有紀錄，但目前勾選的輸出數值算不出數字/);
  assert.doesNotMatch(text, /此時段無資料/);
  assert.doesNotMatch(text, /未勾選要輸出的數值/);
});

test("分項結果會先說明「單位以本文為準」，避免與 Excel 欄名看起來矛盾", () => {
  // Excel 是一張工作表一個單位，草稿是逐調查點標各自的單位。
  // 兩份一起交付時，不先講清楚會讓人以為其中一份寫錯了。
  const text = buildReportDraft(context(), ["roads"]);
  assert.match(text, /Excel 工作表的欄名為整張表統一的單位/);
});

test("調查點超過上限時會說明還有幾個點未列出", () => {
  const base = context();
  base.roadSummary.omitted = 7;
  const text = buildReportDraft(base, ["roads"]);
  assert.match(text, /（另有 7 個調查點未逐點列出，完整數字請見各工作表。）/);
});

test("時段車種分析沒有啟用時，該段落會標示沒有資料", () => {
  const text = buildReportDraft(
    context({ periodExport: { ...context().periodExport, enabled: false } }),
    ["period"],
  );
  assert.match(text, /時段車種分析：目前範圍沒有可敘述的資料。/);
});

test("尖峰視窗不足一小時時，草稿不會標成 PCU/hr", () => {
  // 部分時段或 15 分鐘細格資料的滾動尖峰可能只有 45 分鐘。
  // 標成 PCU/hr 等於把 45 分鐘的量當成時率，低估 25%。
  const text = buildReportDraft(
    context({
      peak: {
        hour: "07:00～07:45",
        pcu: 3000,
        unit: "PCU/該時段（45 分鐘）",
      },
    }),
    ["hourly"],
  );
  assert.match(text, /3,000.0 PCU\/該時段（45 分鐘）/);
  assert.doesNotMatch(text, /3,000.0 PCU\/hr/);
});

/*
 * ── 變動幅度：基期為 0 或讀不到時，不可以寫成「增加 0.0%」 ──
 *
 * 「增加 0.0%」的意思是兩期持平。基期 0 實際上是「從無到有」，
 * 基期讀不到則是「那一期根本沒有數值」，兩者都不是持平，
 * 而這句話會被原封不動貼進正式報告。
 */
test("歷季趨勢：前一季為 0 時不寫「增加 0.0%」", () => {
  const text = buildReportDraft(
    context({
      trend: {
        mode: "平日",
        metricLabel: "實際交通量",
        unit: "輛/日",
        roadLabel: "全部路段合計",
        rows: [
          { quarter: "115Q1", value: 0 },
          { quarter: "115Q2", value: 8200 },
        ],
      },
    }),
    ["history"],
  );
  assert.doesNotMatch(text, /增加 0\.0%/, text);
  assert.match(text, /基期為 0，變動幅度無法以百分比表示/);
});

test("歷季趨勢：前一季讀不到時明講讀不到，不寫成持平", () => {
  const text = buildReportDraft(
    context({
      trend: {
        mode: "平日",
        metricLabel: "當量交通量",
        unit: "PCU/日",
        roadLabel: "全部路段合計",
        rows: [
          { quarter: "115Q1", value: Number.NaN },
          { quarter: "115Q2", value: 8200 },
        ],
      },
    }),
    ["history"],
  );
  assert.doesNotMatch(text, /增加 0\.0%/, text);
  assert.match(text, /讀不到數值/);
  assert.doesNotMatch(text, /NaN%/);
});

test("歷季趨勢那一行要寫明指標與單位", () => {
  const text = buildReportDraft(context(), ["history"]);
  assert.match(text, /歷季趨勢（實際交通量，/);
  assert.match(text, /115Q1 115,873\.0 輛\/日/);
});

test("平假日比較：平日為 0 時不寫「增加 0.0%」", () => {
  const text = buildReportDraft(
    context({ dayCompare: { weekday: 0, holiday: 5400 } }),
    ["current"],
  );
  assert.doesNotMatch(text, /增加 0\.0%/, text);
  assert.match(text, /基期為 0/);
});

test("平假日比較：平日讀不到時明講，不寫成持平", () => {
  const text = buildReportDraft(
    context({ dayCompare: { weekday: Number.NaN, holiday: 5400 } }),
    ["current"],
  );
  assert.doesNotMatch(text, /增加 0\.0%/, text);
  assert.match(text, /讀不到數值/);
});

/*
 * ── 時段車種分析：各調查點的尖峰小時不同時不可以加總 ──
 *
 * PCU/hr 是「某一個特定小時」的流率。A 點 07:00–08:00、B 點 07:30–08:30，
 * 兩者相加得到的數字不對應任何一個真實存在的小時。
 */
test("各調查點尖峰小時不同時，不寫合計而是寫最高者並說明原因", () => {
  const text = buildReportDraft(
    context({
      periodHighlights: [
        {
          label: "上午尖峰小時",
          hour: "各調查點不同（07:00～08:00、07:30～08:30）",
          pcu: 2864.1,
          total: 4100,
          summable: false,
          siteCount: 2,
          highestPcu: 1490,
          highestTotal: 2200,
          highestHour: "07:00～08:00",
          unit: "輛/hr",
        },
      ],
    }),
    ["period"],
  );
  assert.doesNotMatch(text, /2,864\.1/, text);
  assert.match(text, /最高者出現於 07:00～08:00/);
  assert.match(text, /1,490\.0 PCU\/hr/);
  assert.match(text, /只做比較不做加總/);
});

test("同一個尖峰時段時仍然寫合計，並標明單位", () => {
  const text = buildReportDraft(context(), ["period"]);
  assert.match(text, /當量交通量合計 3,976\.6 PCU\/hr/);
  assert.match(text, /實際車輛數合計 5,200 輛\/hr/);
});
