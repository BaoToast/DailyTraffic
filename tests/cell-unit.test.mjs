import assert from "node:assert/strict";
import test from "node:test";
import { cellUnitFor } from "../app/period-analysis.ts";

/*
 * 單位錯了，報告裡的數字就會被誤讀，而且是那種沒有人會發現的錯——
 * 「輛/hr」與「輛/該時段（45 分鐘）」印出來一樣長，數字也一樣。
 * 所以這一支把每一種時段標籤的組合都釘死。
 */

test("全日：完整 24 小時是「輛/日」「PCU/日」", () => {
  assert.equal(cellUnitFor("count", "all", "24 小時"), "輛/日");
  assert.equal(cellUnitFor("pcu", "all", "24 小時"), "PCU/日");
});

test("全日：部分時段調查不能標成「每日」", () => {
  // 這是最嚴重的一種：2 小時的實測量被標成 輛/日，會被直接拿去跨季比較。
  assert.equal(cellUnitFor("count", "all", "實測 2 小時（非 24 小時）"), "輛/調查時段");
  assert.equal(cellUnitFor("pcu", "all", "實測 6.5 小時（非 24 小時）"), "PCU/調查時段");
});

test("全日：同一批資料裡 24 小時與部分時段各標各的", () => {
  // 舊版用整批的 partial 旗標，只要有一個調查點是部分時段，24 小時的
  // 調查點也會被標成「輛/調查時段」；反過來也會發生。
  assert.equal(cellUnitFor("count", "all", "24 小時"), "輛/日");
  assert.equal(cellUnitFor("count", "all", "實測 2 小時（非 24 小時）"), "輛/調查時段");
});

test("平日＋假日：不能標成「每日」，因為那是兩天的加總", () => {
  assert.equal(
    cellUnitFor("count", "all", "平日＋假日全部時段", { separateDays: true }),
    "輛",
  );
  assert.equal(
    cellUnitFor("pcu", "all", "平日＋假日全部時段（各日實測 2 小時）", {
      separateDays: true,
    }),
    "PCU/調查時段（平＋假合計）",
  );
});

test("尖峰：剛好 60 分鐘才是「/hr」", () => {
  assert.equal(cellUnitFor("count", "am", "07:15～08:15"), "輛/hr");
  assert.equal(cellUnitFor("pcu", "pm", "18:00～19:00"), "PCU/hr");
  assert.equal(cellUnitFor("pcu", "peak24", "08:00～09:00"), "PCU/hr");
});

test("尖峰：湊不滿一小時的視窗要講出實際長度，不能當成時率", () => {
  // 部分時段或 15 分鐘細格資料的滾動尖峰可能只有 45 分鐘，
  // 標成 /hr 等於把 45 分鐘的量當成一小時的量，低估 25%。
  assert.equal(cellUnitFor("count", "am", "07:00～07:45"), "輛/該時段（45 分鐘）");
  assert.equal(cellUnitFor("pcu", "am", "07:00～07:15"), "PCU/該時段（15 分鐘）");
});

test("尖峰：以兩小時為一格的原始檔不能標成「/hr」", () => {
  // 這是相反方向的錯誤，會高估一倍。舊版的判斷是「小於 60 分鐘」，
  // 抓不到這一種。
  assert.equal(cellUnitFor("count", "am", "07:00～09:00"), "輛/該時段（120 分鐘）");
});

test("尖峰：跨午夜的視窗長度算得出來，不會變成負數", () => {
  assert.equal(cellUnitFor("count", "pm", "23:30～00:30"), "輛/hr");
});

test("時段標籤不是時間範圍時退回「/hr」，不會產生 NaN", () => {
  for (const label of ["—", "", "24 小時", "尚未調查"]) {
    const unit = cellUnitFor("count", "am", label);
    assert.doesNotMatch(unit, /NaN|undefined/, `標籤「${label}」`);
  }
});

test("百分比一律是「%」，不受時段影響", () => {
  assert.equal(cellUnitFor("share", "all", "24 小時"), "%");
  assert.equal(cellUnitFor("share", "am", "07:00～07:45"), "%");
});

/*
 * 畫面與匯出必須對同一欄說同一句話。
 *
 * 舊版畫面走 metricUnitFor(metric, period, { partial: surveyScope.partial })
 * ——那個 partial 是整批的代表值，於是真正做滿 24 小時的調查點，只因為畫面上
 * 另有部分時段調查點，就被標成「輛/調查時段」，而匯出標「輛/日」。
 *
 * 舊版的守門測試只驗 cellUnitFor 這支輔助函式，沒有驗任何一個消費端，
 * 所以真正還在用整批旗標的畫面路徑完全沒被守住，測試永遠是綠的。
 * 這一支改成驗「同一組時段標籤，兩邊算出來的欄位單位必須相同」。
 */
test("同一欄的單位，畫面與匯出必須一致", async () => {
  const { columnUnitFor, cellUnitFor } = await import("../app/period-analysis.ts");
  const cases = [
    { period: "all", hours: ["24 小時"] },
    { period: "all", hours: ["實測 2 小時（非 24 小時）"] },
    { period: "all", hours: ["24 小時", "實測 2 小時（非 24 小時）"] },
    { period: "am", hours: ["07:00～08:00"] },
    { period: "am", hours: ["07:00～07:45"] },
    { period: "peak24", hours: ["18:00～20:00"] },
    { period: "peak24", hours: ["07:00～08:00", "18:00～20:00"] },
  ];
  for (const metric of ["vehicles", "pcu"]) {
    for (const { period, hours } of cases) {
      const column = columnUnitFor(metric, period, hours, { separateDays: false });
      if (hours.length === 1) {
        /* 單一時段時，欄位單位就該等於該格的單位 */
        assert.equal(
          column,
          cellUnitFor(metric, period, hours[0], { separateDays: false }),
          `${metric}／${period}／${hours[0]}：欄位單位與該格單位不一致`,
        );
      } else {
        /* 混合時段時，不可以挑一個代表值假裝整欄都適用 */
        const perCell = new Set(
          hours.map((hour) => cellUnitFor(metric, period, hour, { separateDays: false })),
        );
        if (perCell.size > 1)
          assert.match(
            column,
            /各列時段/,
            `${metric}／${period}：各列單位不同（${[...perCell].join("、")}），欄名必須指向「分析時段」欄，實得「${column}」`,
          );
      }
    }
  }
});

/*
 * 混用時間格要出警告——而且不可以誤報。
 *
 * rollingPeak 用「眾數格長」算 needed = 60 / 格長，然後**數格數**、
 * 不是累計分鐘數。「全日整點＋尖峰拆 15 分鐘」的版型會讓尖峰那一小時
 * 只取到其中一格：實測整點 100／15 分鐘格 50 的資料，真尖峰是 07 時的 200，
 * 系統卻報 00:00~01:00 的 100。總量守恆，總量檢查抓不到。
 *
 * 本版只加提醒、不改挑選邏輯（改了會變更計算口徑）。
 * 判準必須是「兩種規律的格長」，不是「格長不完全一致」——後者會把
 * 調查中間的休息時段一起誤報（路口轉向那邊實測誤報 19/55）。
 */
test("混用時間格要出警告，但休息時段與單一格長不可誤報", async () => {
  const { validateImport } = await import("../app/final-workflow.ts");
  const pad = (n) => String(n).padStart(2, "0");
  const row = (hour) => ({
    projectId: "P", quarter: "115Q1", roadId: "R1", roadName: "測試路段",
    dayType: "平日", directionCode: "A", directionName: "方向A",
    hour, motorcycle: 10, small: 10, large: 0, special: 0,
  });
  const quarters = (from, to) => {
    const out = [];
    for (let h = from; h < to; h += 1)
      for (let m = 0; m < 60; m += 15)
        out.push(`${pad(h)}:${pad(m)}~${pad(m === 45 ? h + 1 : h)}:${pad((m + 15) % 60)}`);
    return out;
  };
  const hourly = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00~${pad(h + 1)}:00`);
  const mixed = Array.from({ length: 24 }, (_, h) =>
    h === 7 || h === 8 ? quarters(h, h + 1) : [`${pad(h)}:00~${pad(h + 1)}:00`],
  ).flat();
  const withBreak = [...quarters(7, 9), ...quarters(17, 19)];

  const warned = (hours) =>
    (validateImport(hours.map(row), []).warnings ?? []).some((w) =>
      /混用了不同長度的時間格/.test(w),
    );

  assert.equal(warned(hourly), false, "24 小時整點格不可誤報");
  assert.equal(warned(quarters(7, 9)), false, "全部 15 分鐘格不可誤報");
  assert.equal(warned(withBreak), false, "中間有休息時段不可誤報");
  assert.equal(warned(mixed), true, "真的混用整點＋15 分鐘格必須出警告");

  /*
   * 這一項專門釘住「兩成」那個門檻。
   *
   * 少了它，把門檻放寬成「只要出現過就算」也會全綠——上面四種情境剛好都
   * 測不到門檻（本支是以每一格的長度判斷，調查中間的休息時段不會產生
   * 第二種長度，所以不會踩到）。實測確認過：拿掉門檻，上面四項照樣通過。
   *
   * 一份 24 小時整點資料裡混進一格 30 分鐘（例如原始表打錯一格），
   * 那是單一異常格、不是第二種規律，不該因此對整份資料發警告。
   */
  const oneStray = [
    ...Array.from({ length: 23 }, (_, h) => `${pad(h)}:00~${pad(h + 1)}:00`),
    "23:00~23:30",
  ];
  assert.equal(
    warned(oneStray),
    false,
    "24 格裡只有 1 格長度不同，屬單一異常格，不該當成混用時間格",
  );

  /*
   * 這一項釘住「至少重複兩次」，而且是兩成門檻**擋不住**的情形。
   *
   * 短時段資料只漏一列時，相鄰格數可能只有 4 個，那一個 30 分鐘的跳號
   * 就占 25%——只看比例會把全部都是 60 分鐘的資料誤報成混用。
   * 路口轉向 v2.1.51-final 先加了這個條件，本支原本沒有，
   * 於是兩支對同一份資料一支報警、一支不報。
   */
  const shortWithGap = [
    "06:00~07:00",
    "07:00~08:00",
    "08:00~08:30",
    "08:30~09:30",
  ];
  assert.equal(
    warned(shortWithGap),
    false,
    "短時段只漏一列造成的單次跳號（占 25%）不該報混用時間格",
  );
});
