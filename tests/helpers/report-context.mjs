/*
 * 報表文字草稿測試共用的「欄位全滿」情境。
 *
 * ⚠️ 抽到這裡的理由：兩個測試檔各捏一份遲早會漂移，而**缺一個欄位**會讓
 *   段落產不出內容，看起來像功能壞了，實際上是測資不完整。
 *   全覆蓋盤點（report-draft-coverage）尤其吃這一點：它要能區分
 *   「段落接在空的地方」與「我的測資漏了欄位」。
 */
export function context(overrides = {}) {
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
