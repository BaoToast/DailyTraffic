/*
 * ══════════════════════════════════════════════════════════════════════
 *  「已人工確認」的紀錄不可以只進不出
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-20（在交通服務水準上提出，三支同步）：
 *   「那我看完後我要怎麼點選確認，讓之後不會一直出現? 不然資料會累積越來越多」
 *
 * ⚠️ 他擔心的是畫面上的清單，但真正會無限長大的是使用者看不到的
 *   workflow.ackedAnomalies：指紋帶著數值，數值一變舊紀錄就永遠是孤兒。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

test("前置：檔案讀得到而且有內容", () => {
  assert.ok(source.length > 50000, "DashboardClient.tsx 讀起來太短");
});

test("有清孤兒的函式，而且只在按下執行檢查時才清", () => {
  const at = source.indexOf("const pruneOrphanAcks = useCallback(");
  assert.notEqual(at, -1, "沒有清孤兒的函式，確認紀錄會只進不出");
  const run = source.indexOf("const runQualityCheck = useCallback(");
  assert.notEqual(run, -1);
  assert.ok(
    source.slice(run, run + 420).includes("pruneOrphanAcks()"),
    "執行資料異常檢查時沒有清孤兒",
  );
});

test("⚠️ 只清孤兒，不可以整批清掉", () => {
  const at = source.indexOf("const pruneOrphanAcks = useCallback(");
  const block = source.slice(at, at + 1600);
  assert.ok(
    block.includes("const live = new Set(allAnomalyAlerts.map(anomalyFingerprint));"),
    "沒有拿現存異常的指紋當白名單",
  );
  assert.ok(
    block.includes("if (live.has(key)) kept[key] = own[key];"),
    "沒有保留仍然對得上的那幾筆",
  );
});

test("⚠️ 沒有孤兒時不可以寫存檔（否則每按一次就製造一個空變更）", () => {
  const at = source.indexOf("const pruneOrphanAcks = useCallback(");
  const block = source.slice(at, at + 1600);
  assert.ok(
    block.includes("if (!keys.length) return previous;"),
    "一筆確認都沒有時仍然會寫一次",
  );
  assert.ok(
    block.includes("if (Object.keys(kept).length === keys.length) return previous;"),
    "沒有孤兒時仍然會寫一次",
  );
});

test("⚠️ 白名單要用**全部**的異常，不可以用畫面上篩過的那一份", () => {
  /*
   * 用篩過的那一份的話，被季度／類型篩掉的那幾筆確認會被當成孤兒清掉——
   * 使用者換一個篩選條件，先前按過的確認就無聲消失了。
   */
  const at = source.indexOf("const pruneOrphanAcks = useCallback(");
  const block = source.slice(at, at + 1600);
  assert.ok(
    !block.includes("filteredAnomalies"),
    "拿畫面上篩過的清單當白名單，換個篩選條件就會誤殺確認",
  );
});
