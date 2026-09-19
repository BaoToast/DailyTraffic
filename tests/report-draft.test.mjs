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
      periods: ["全調查時段", "上午尖峰小時"],
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
                  label: "全調查時段",
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
  assert.match(text, /全調查時段尖峰出現於 18:00～19:00，該時段當量交通量 7,200.5 PCU\/hr/);
  assert.match(text, /時段車種分析（分析時段：全調查時段、上午尖峰小時/);
  /* F-10／F-30：草稿不再寫「範圍內全部調查點合計」 */
  assert.match(text, /車種組成（依「全日」統計，全調查時段）：機車 52.1%/);
  assert.doesNotMatch(text, /全部調查點合計/);
  assert.match(text, /歷季趨勢（實際交通量，依「歷季分析」面板的 平日＋假日／全部路段合計）/);
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
  /*
   * ⚠️ v20.64 起這裡用的是 charts 與 composition 兩段。
   * 原本用的是 projects（跨計畫比較），該功能已隨使用者授權整個移除。
   * 換測資、不是刪測試——「勾了卻沒資料要明講、不可以靜靜消失」
   * 這條規則本身沒有變。
   */
  const text = buildReportDraft(
    context({ vehicles: [], charts: [] }),
    ["composition", "charts"],
  );
  assert.match(text, /車種組成與歷季比例：目前範圍沒有可敘述的資料。/);
  assert.match(text, /7張可編輯原生圖表：目前範圍沒有可敘述的資料。/);
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
    /・雙向合計｜全調查時段（24 小時）：車輛數 42,090 輛\/日、交通流量 31,160.5 PCU\/日；機車 52.1%、小型車 40.7%。/,
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
    { label: "全調查時段", hour: "24 小時", hasData: true, values: [], composition },
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
    { label: "全調查時段", hour: "24 小時", hasData: true, values: [], composition: [] },
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

test("歷季趨勢的平日＋假日要分列，且沿用所選指標與單位", () => {
  const text = buildReportDraft(
    context({
      trend: {
        mode: "平日＋假日",
        metricLabel: "大車比例",
        unit: "%",
        roadLabel: "全部路段合計",
        rows: [
          { quarter: "115Q1", value: 12.3 },
          { quarter: "115Q2", value: 13.4 },
        ],
        series: [
          {
            label: "平日",
            rows: [
              { quarter: "115Q1", value: 12.3 },
              { quarter: "115Q2", value: 13.4 },
            ],
          },
          {
            label: "假日",
            rows: [
              { quarter: "115Q1", value: 8.1 },
              { quarter: "115Q2", value: Number.NaN },
            ],
          },
        ],
      },
    }),
    ["history"],
  );
  assert.match(text, /歷季趨勢（大車比例，/);
  assert.match(text, /平日：115Q1 12\.3%、115Q2 13\.4%/);
  assert.match(text, /假日：115Q1 8\.1%、115Q2 —/);
  assert.doesNotMatch(text, /20\.4%|21\.5%/, "不可以把兩種日別加總");
  assert.doesNotMatch(text, /PCU/);
  assert.doesNotMatch(text, /—%/);
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

/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-30：多個調查點時，草稿的全日量**逐點敘述、不寫合計**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16 裁示：
 *   「逐點一句……我選擇這個，點位一多改為一個點位就一行」
 *
 * 舊版寫「全日實際交通量合計 115,873 輛」，而 115,873 ＝ 中山路 42,090 ＋
 * 中正路口 73,783——兩個不同地點的量相加，那個總和不對應任何一條路的實際流量。
 * **草稿是要抄進報告的東西**，所以這幾條比畫面上的更不能鬆。
 *
 * ⚠️ 刻意迴避的假通過：
 * 一、不可以只驗「有逐點的句子」。要**反面驗合計那個數字整個不出現**，
 *     否則「逐點寫完再補一句合計」照樣全綠——而那句合計正是要消滅的東西。
 * 二、兩個調查點的數值要**不一樣**，不然分行與相加看起來都像對的。
 * 三、超過上限那一條要驗**真的變成一行一句**（行數等於調查點數），
 *     不是只驗字串有沒有換行。
 */
const POINTS_TWO = [
  { roadName: "中山路", dayType: "平日", total: 42090, pcu24: 31160.5 },
  { roadName: "中正路口", dayType: "平日", total: 73783, pcu24: 54376.1 },
];

test("X-30 多個調查點：逐點敘述，而且「合計」那個數字整個不出現", () => {
  const text = buildReportDraft(
    context({ pointTotals: POINTS_TWO, pointLimit: 6 }),
    ["current"],
  );
  assert.match(text, /中山路全日實際交通量 42,090 輛/);
  assert.match(text, /中正路口全日實際交通量 73,783 輛/);
  /* ⚠️ 反面：相加出來的 115,873 一個字都不可以留下。 */
  assert.doesNotMatch(text, /115,873/);
  assert.doesNotMatch(text, /全日實際交通量合計/);
  /* 為什麼不給合計，要寫出來——不講的話看起來像漏了一句。 */
  assert.match(text, /不同調查點的交通量不可以相加/);
});

test("X-30 多個調查點：不再重複「交通量最高的調查點依序為」（逐點敘述已涵蓋）", () => {
  const text = buildReportDraft(
    context({ pointTotals: POINTS_TWO, pointLimit: 6 }),
    ["current"],
  );
  assert.doesNotMatch(text, /交通量最高的調查點依序為/);
});

test("X-30 點位數超過上限時，一個調查點一行", () => {
  const many = ["甲", "乙", "丙", "丁", "戊", "己", "庚"].map((name, index) => ({
    roadName: `${name}路`,
    dayType: "平日",
    total: 10000 + index * 111,
    pcu24: 7000 + index * 77,
  }));
  const text = buildReportDraft(
    context({ pointTotals: many, pointLimit: 6 }),
    ["current"],
  );
  const rows = text
    .split("\n")
    .filter((line) => /全日實際交通量 [\d,]+ 輛/.test(line));
  assert.equal(rows.length, many.length, "七個調查點就要七行");
  /* ⚠️ 一行一句：不可以把七句塞在同一行用分號串起來。 */
  assert.doesNotMatch(text, /；.*；.*；/);
});

test("X-30 只有一個調查點時，寫法與升級前完全相同", () => {
  const before = buildReportDraft(context(), ["current"]);
  const after = buildReportDraft(
    context({
      pointTotals: [
        { roadName: "中山路", dayType: "平日", total: 115873, pcu24: 85536.1 },
      ],
      pointLimit: 6,
    }),
    ["current"],
  );
  assert.equal(after, before, "單一調查點不可以因為這次改動而變樣");
  assert.match(after, /全日實際交通量合計 115,873 輛/);
});

test("X-30 平日＋假日：一個調查點兩個數字並列，不加總", () => {
  const text = buildReportDraft(
    context({
      dayType: "平日＋假日",
      pointTotals: [
        { roadName: "中山路", dayType: "平日", total: 42090, pcu24: 31160.5 },
        { roadName: "中山路", dayType: "假日", total: 32675, pcu24: 24124.5 },
        { roadName: "中正路口", dayType: "平日", total: 73783, pcu24: 54376.1 },
        { roadName: "中正路口", dayType: "假日", total: 59457, pcu24: 43757.4 },
      ],
      pointLimit: 6,
    }),
    ["current"],
  );
  assert.match(text, /中山路（平日）全日實際交通量 42,090 輛/);
  assert.match(text, /中山路（假日）全日實際交通量 32,675 輛/);
  /* 平日兩點相加 115,873、假日兩點相加 92,132，兩個都不可以出現。 */
  assert.doesNotMatch(text, /115,873/);
  assert.doesNotMatch(text, /92,132/);
  /* 同一個調查點的平日＋假日 74,765 也不可以出現（那同樣是一個不成立的合計）。 */
  assert.doesNotMatch(text, /74,765/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-31：時段車種分析那一段，多個調查點時也**逐點一句、不寫合計**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16 裁示：「逐點一句（和 X-30 同一套）」。
 *
 * 舊版在「全調查時段」時寫「實際車輛數合計 115,873 輛」，理由是
 * 「全調查時段是整段累計，相加有意義」——那只解決了時間對不對得上，
 * 沒有解決**地點加不加得起來**：兩個不同地點的量相加，數的是同一批車
 * 經過兩個斷面。與 X-28（畫面小卡）、X-30（草稿全日量）是同一個相加。
 *
 * ⚠️ 刻意迴避的假通過：
 * 一、要**反面驗那個相加的數字整個不出現**，不能只驗有逐點的句子。
 * 二、尖峰小時那一支（各點時段不同）除了逐點，還要**繼續講出時間也加不起來**
 *     ——那是另一件事，不可以因為改成逐點就把它吃掉。
 * 三、只有一個調查點時要維持原本的單句，不可以硬加上「不列合計」的說明。
 */
const HIGHLIGHT_SITES = [
  {
    roadName: "中山路",
    hour: "07:00～19:00",
    pcu: 31160.5,
    total: 42090,
    unit: "輛/日",
  },
  {
    roadName: "中正路口",
    hour: "07:00～19:00",
    pcu: 54376.1,
    total: 73783,
    unit: "輛/日",
  },
];

test("X-31 時段車種分析：多個調查點逐點一句，合計那個數字不出現", () => {
  const text = buildReportDraft(
    context({
      pointLimit: 6,
      periodHighlights: [
        {
          label: "全調查時段",
          hour: "07:00～19:00",
          pcu: 85536.6,
          total: 115873,
          summable: true,
          siteCount: 2,
          sites: HIGHLIGHT_SITES,
          highestPcu: 54376.1,
          highestTotal: 73783,
          highestHour: "07:00～19:00",
          unit: "輛/日",
        },
      ],
    }),
    ["period"],
  );
  assert.match(text, /中山路・07:00～19:00，當量交通量 31,160\.5 PCU\/日、實際車輛數 42,090 輛\/日/);
  assert.match(text, /中正路口・07:00～19:00，當量交通量 54,376\.1 PCU\/日、實際車輛數 73,783 輛\/日/);
  /* ⚠️ 反面：相加出來的 115,873 與 85,536.6 都不可以留下。 */
  assert.doesNotMatch(text, /115,873/);
  assert.doesNotMatch(text, /85,536\.6/);
  assert.doesNotMatch(text, /實際車輛數合計/);
  assert.match(text, /不同調查點的交通量不可以相加/);
});

test("X-31 尖峰小時各點時段不同時，除了逐點還要繼續講出時間也加不起來", () => {
  const text = buildReportDraft(
    context({
      pointLimit: 6,
      periodHighlights: [
        {
          label: "上午尖峰小時",
          hour: "各調查點不同（07:00～08:00、07:30～08:30）",
          pcu: 9000,
          total: 12000,
          summable: false,
          siteCount: 2,
          sites: [
            { roadName: "中山路", hour: "07:00～08:00", pcu: 4000, total: 5000, unit: "輛/hr" },
            { roadName: "中正路口", hour: "07:30～08:30", pcu: 5000, total: 7000, unit: "輛/hr" },
          ],
          highestPcu: 5000,
          highestTotal: 7000,
          highestHour: "07:30～08:30",
          unit: "輛/hr",
        },
      ],
    }),
    ["period"],
  );
  assert.match(text, /中山路・07:00～08:00/);
  assert.match(text, /中正路口・07:30～08:30/);
  assert.doesNotMatch(text, /12,000/);
  /* 地點加不起來、時間也加不起來，兩件事都要講。 */
  assert.match(text, /不同調查點的交通量不可以相加/);
  assert.match(text, /某一個特定小時/);
});

test("X-31 只有一個調查點時，不硬加「不列合計」的說明", () => {
  const text = buildReportDraft(
    context({
      pointLimit: 6,
      periodHighlights: [
        {
          label: "全調查時段",
          hour: "07:00～19:00",
          pcu: 31160.5,
          total: 42090,
          summable: true,
          siteCount: 1,
          sites: [HIGHLIGHT_SITES[0]],
          highestPcu: 31160.5,
          highestTotal: 42090,
          highestHour: "07:00～19:00",
          unit: "輛/日",
        },
      ],
    }),
    ["period"],
  );
  assert.match(text, /全調查時段：時段 07:00～19:00，當量交通量 31,160\.5 PCU\/日、實際車輛數 42,090 輛\/日。/);
  assert.doesNotMatch(text, /不列合計/);
});

test("X-31 調查點超過上限時，一個調查點一行", () => {
  const many = ["甲", "乙", "丙", "丁", "戊", "己", "庚"].map((name, index) => ({
    roadName: `${name}路`,
    hour: "07:00～19:00",
    pcu: 1000 + index * 11,
    total: 2000 + index * 22,
    unit: "輛/日",
  }));
  const text = buildReportDraft(
    context({
      pointLimit: 6,
      periodHighlights: [
        {
          label: "全調查時段",
          hour: "07:00～19:00",
          pcu: 7077,
          total: 14462,
          summable: true,
          siteCount: many.length,
          sites: many,
          highestPcu: 1066,
          highestTotal: 2132,
          highestHour: "07:00～19:00",
          unit: "輛/日",
        },
      ],
    }),
    ["period"],
  );
  const rows = text.split("\n").filter((line) => /^・.+實際車輛數 [\d,]+ 輛/.test(line));
  assert.equal(rows.length, many.length, "七個調查點就要七行");
  assert.doesNotMatch(text, /14,462/);
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-32：草稿**同一段落**不可以自己打自己
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-16 全面盤點查到的：X-30 讓草稿寫出「不同調查點的交通量不可以相加，
 * 所以不列合計」，而**下一句**（平假日比較）馬上印了一個跨調查點的合計；
 * 同時畫面上的尖峰卡已經明確不給數字，草稿的尖峰句卻照給。
 *
 * ⚠️ 刻意迴避的假通過：
 * 一、不可以只驗「有逐點的句子」。要**反面驗那兩個跨點相加的數字不出現**。
 * 二、變化率要**每個調查點各自算**——先把兩個地點加起來再算百分比，
 *     那個百分比不對應任何一條路。所以連百分比都要逐點驗。
 * 三、單一調查點時要維持原本的寫法，不可以因為這次改動而變樣。
 */
test("X-32 平假日比較：多個調查點逐點一句，跨點合計不出現", () => {
  const text = buildReportDraft(
    context({
      pointLimit: 6,
      dayCompare: { weekday: 100000, holiday: 90000 },
      dayComparePoints: [
        { roadName: "中山路", weekday: 42090, holiday: 32675 },
        { roadName: "中正路口", weekday: 73783, holiday: 59457 },
      ],
    }),
    ["current"],
  );
  assert.match(text, /中山路平日 42,090 輛、假日 32,675 輛/);
  assert.match(text, /中正路口平日 73,783 輛、假日 59,457 輛/);
  /* ⚠️ 反面：舊版那兩個跨點合計不可以留下。 */
  assert.doesNotMatch(text, /100,000/);
  assert.doesNotMatch(text, /90,000/);
  assert.match(text, /各調查點各自獨立，不列跨調查點的合計/);
});

test("X-32 只有一個調查點時，平假日比較維持原本寫法", () => {
  const text = buildReportDraft(
    context({
      pointLimit: 6,
      dayCompare: { weekday: 100000, holiday: 90000 },
      dayComparePoints: [
        { roadName: "中山路", weekday: 100000, holiday: 90000 },
      ],
    }),
    ["current"],
  );
  assert.match(text, /平日全日量 100,000 輛、假日 90,000 輛/);
  assert.doesNotMatch(text, /不列跨調查點的合計/);
});

test("X-32 多個調查點時，尖峰那一句要跟畫面一樣不給數字", () => {
  /*
   * 畫面上的尖峰卡在多調查點時印的是「這張卡不給數字」，
   * 草稿端的做法是不傳 peak（見 DashboardClient 的 reportDraftContext）。
   * 這裡驗的是「沒有 peak 時那一段不會憑空生出數字」。
   */
  const text = buildReportDraft(context({ peak: null }), ["hourly"]);
  assert.doesNotMatch(text, /全調查時段尖峰出現於/);
  assert.doesNotMatch(text, /7,200\.5/);
});
