/*
 * 結論草稿測試共用的樣本列。
 *
 * 原本只長在 conclusion.test.mjs 裡；跨系統守門測試也要拿同一份形狀來跑
 * 「換年份寫法只換字」的比對，兩邊各自手捏一份遲早會漂移（少一個欄位就
 * 變成組字函式直接丟例外，看起來像功能壞了，其實是測資不完整）。
 * 所以抽到這裡，兩邊都從這一份取。
 */

export const CONCLUSION_META = {
  projectName: "測試計畫",
  systemVersion: "v20.17",
  generatedAt: "2026-08-23 10:00",
};

export function cell(over = {}) {
  return {
    hour: "24 小時",
    hasData: true,
    total: 10000,
    pcu: 8000,
    unitCount: "輛/日",
    unitPcu: "PCU/日",
    vehicles: [
      { label: "機車", count: 6000, pcu: 3000 },
      { label: "小型車", count: 3500, pcu: 3500 },
      { label: "大型車", count: 500, pcu: 1500 },
    ],
    ...over,
  };
}

export function row(over = {}) {
  return {
    quarter: "115Q2",
    dayType: "平日",
    roadId: "R-01",
    roadName: "中山路",
    surveyType: "road",
    scopeCode: "ALL",
    scopeName: "雙向合計",
    periods: {
      all: cell(),
      am: cell({
        hour: "07:00～08:00",
        total: 1200,
        pcu: 900,
        unitCount: "輛/hr",
        unitPcu: "PCU/hr",
        vehicles: [
          { label: "機車", count: 800, pcu: 400 },
          { label: "小型車", count: 380, pcu: 380 },
          { label: "大型車", count: 20, pcu: 60 },
        ],
      }),
      pm: cell({
        hour: "17:00～18:00",
        total: 1400,
        pcu: 1050,
        unitCount: "輛/hr",
        unitPcu: "PCU/hr",
        vehicles: [{ label: "機車", count: 900, pcu: 450 }],
      }),
      /*
       * ⚠️ allPeak（全調查時段尖峰）**一定要有**（A18，2026-09-23）。
       *   舊測資只有 all／am／pm 三格，於是任何勾到第四個時段的測試
       *   都會拿到「這一筆沒有資料」而不是真的算錯——三個真實缺陷
       *   （路口轉向的 A14／A15／A17）就是躲在這個盲區裡活下來的。
       */
      allPeak: cell({
        hour: "17:15～18:15",
        total: 1500,
        pcu: 1120,
        unitCount: "輛/hr",
        unitPcu: "PCU/hr",
        vehicles: [
          { label: "機車", count: 950, pcu: 475 },
          { label: "小型車", count: 520, pcu: 520 },
          { label: "大型車", count: 30, pcu: 90 },
        ],
      }),
    },
    ...over,
  };
}
