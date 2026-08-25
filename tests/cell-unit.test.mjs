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
