/*
 * ══════════════════════════════════════════════════════════════════
 *  單位（C 段）：分母講的話必須和資料相符
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 定案的規則（三支一致）：
 *   ・整批都是 24 小時          → 輛／日、PCU／日
 *   ・整批都不是 24 小時        → 輛／調查時段、PCU／調查時段
 *   ・同一張表混合不同涵蓋      → 一律「調查時段」＋表下方註明
 *   ・尖峰欄位永遠是流率        → 輛／hr、PCU／hr，不受涵蓋影響
 *
 * ⚠️ 這一支要守的核心是：**單位是唯一會被讀者拿去做除法的東西**。
 *   4 小時的量標成「輛／日」，讀者就會拿它去跟 24 小時的季度相比，
 *   而那個比較看起來完全合理——錯得無聲無息。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { metricUnitFor, PERIOD_KEYS, PERIOD_LABELS } from "../app/period-analysis.ts";

test("C1 尖峰欄位永遠是流率，不受任何選項影響", () => {
  for (const period of ["peak24", "am", "pm"])
    for (const separateDays of [false, true])
      for (const partial of [false, true]) {
        assert.equal(
          metricUnitFor("count", period, { separateDays, partial }),
          "輛/hr",
          `${PERIOD_LABELS[period]}（separateDays=${separateDays}, partial=${partial}）`,
        );
        assert.equal(
          metricUnitFor("pcu", period, { separateDays, partial }),
          "PCU/hr",
        );
      }
});

test("C2 全調查時段：滿 24 小時寫「日」，不足寫「調查時段」", () => {
  assert.equal(metricUnitFor("count", "all"), "輛/日");
  assert.equal(metricUnitFor("pcu", "all"), "PCU/日");
  assert.equal(metricUnitFor("count", "all", { partial: true }), "輛/調查時段");
  assert.equal(metricUnitFor("pcu", "all", { partial: true }), "PCU/調查時段");
});

test("C3 「平日＋假日」是兩天的加總，不可以標成「每日」", () => {
  /*
   * 兩天相加之後除以「日」是錯的——那個數字不是任何一天的量。
   * 舊版在這裡標「輛/日」，會被直接拿去跟單日的季度比較。
   */
  assert.equal(metricUnitFor("count", "all", { separateDays: true }), "輛");
  assert.equal(metricUnitFor("pcu", "all", { separateDays: true }), "PCU");
});

test("C4 ⚠️ separateDays 不可以把 partial 吃掉（舊版真的發生過）", () => {
  /*
   * 兩件事是**各自獨立**的：
   *   ・separateDays：這一格是不是兩天相加
   *   ・partial：這份調查是不是不足 24 小時
   * 舊版寫成 if/else，日別一切到「平日＋假日」，部分時段的警示就整個消失。
   * 那正是最危險的組合：4 小時 × 兩天的量，標成一個看不出問題的「輛」。
   */
  assert.equal(
    metricUnitFor("count", "all", { separateDays: true, partial: true }),
    "輛/調查時段（平＋假合計）",
  );
  assert.equal(
    metricUnitFor("pcu", "all", { separateDays: true, partial: true }),
    "PCU/調查時段（平＋假合計）",
  );
});

test("C5 百分比永遠是 %，不跟時段走", () => {
  for (const period of PERIOD_KEYS)
    assert.equal(metricUnitFor("share", period, { partial: true }), "%");
});

test("C6 ⚠️ 不足 24 小時時，任何一個單位都不可以出現「/日」", () => {
  /*
   * 這是一條**掃描式**的反面守門：不是列舉幾個組合，而是把所有組合跑一遍，
   * 只要 partial 為真卻出現「/日」就紅。日後有人新增時段或指標，
   * 這一條自動涵蓋得到。
   */
  const offenders = [];
  for (const period of PERIOD_KEYS)
    for (const metric of ["count", "pcu", "share"])
      for (const separateDays of [false, true]) {
        const unit = metricUnitFor(metric, period, {
          separateDays,
          partial: true,
        });
        if (/\/日/.test(unit))
          offenders.push(
            `${PERIOD_LABELS[period]}／${metric}／separateDays=${separateDays} → ${unit}`,
          );
      }
  assert.deepEqual(
    offenders,
    [],
    `部分時段調查出現「/日」的單位：\n- ${offenders.join("\n- ")}`,
  );
});
