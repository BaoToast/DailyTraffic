/*
 * ══════════════════════════════════════════════════════════════════════
 *  效能：資料變多的時候，時間要跟著「線性」變多，不可以變成平方
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：
 *   「請確保程式性能上不要有 Lag 情況發生，隨著程式越來越完善，
 *     性能方面也很重要，要能順暢跑每一筆資料」
 *   「如果效能上不會有延遲問題，沒做改變也是合理的」
 *   「要注意別因為改善效能，而導致其他功能不能正常使用」
 *
 * ── 這一支守什麼、不守什麼 ──────────────────────────────────
 *
 * ⚠️ **這一支不可以和 `npm run e2e` 並行。**（2026-09-25 第六輪實測）
 *   這台機器只有兩顆 CPU。在 e2e 跑瀏覽器的同時跑這一支，整支會被
 *   node 的預設測試超時砍掉，在完整的 `node --test tests/*.test.mjs` 裡
 *   變成一筆 `not ok tests/perf-scaling.test.mjs`——而單獨跑它 20 秒就過。
 *   那是**假的紅**：它會讓人以為效能回歸了，然後去改一個沒壞的東西。
 *   規則與 e2e 同一條：**測試一次只跑一種，不並行。**
 *
 * ⚠️ **不守絕對毫秒數。** 測試跑在什麼機器上完全不受控（CI、容器、
 *   使用者的筆電、有沒有別的工作在搶 CPU），釘一個絕對秒數只會造成
 *   「有時候紅、重跑就綠」——而那種測試最後一定會被關掉或加 retry，
 *   等於這一支從此不存在。
 *
 * ✅ **守的是成長的形狀。** 資料量乘以 R 倍時，時間也應該大約乘以 R 倍
 *   （線性）。寫成「每一筆都重掃一次全表」的話會乘以 R²——
 *   10 倍資料變成 100 倍時間。這種缺陷在小資料上**完全看不出來**，
 *   要等使用者累積了好幾季、好幾十個調查點才會突然變慢。
 *
 * ⚠️ 最後那一支是**反證**：拿一個刻意寫成平方的函式餵給同一套量測，
 *   它必須變紅；同時拿一個正常的線性寫法，它必須通過（免得誤殺）。
 *   沒有這兩段的話，門檻訂錯也沒人知道。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CONCLUSION_METRICS, DEFAULT_CONDITION, buildConclusion } from "../app/conclusion.ts";
import { PERIOD_KEYS } from "../app/period-analysis.ts";
import { CONCLUSION_META as META, row } from "./helpers/conclusion-row.mjs";

/** 產生 n 列「長得像真的」的分析列（多季 × 多調查點 × 平假日）。 */
function corpus(n) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const year = 113 + Math.floor(i / 400);
    rows.push(
      row({
        quarter: `${year}Q${(i % 4) + 1}`,
        dayType: i % 2 ? "平日" : "假日",
        roadId: `R-${String(i % 40).padStart(2, "0")}`,
        roadName: `示範路段${i % 40}`,
      }),
    );
  }
  return rows;
}

/**
 * 反證用的輕量測資：只要一個「可以分組的鍵」，不需要整筆紀錄。
 *
 * ⚠️ 2026-09-26 複查抓到：反證原本用 `corpus()` 建整筆紀錄堆到 30 萬筆，
 *   預設 Node heap 會先耗盡（`FATAL ERROR: Reached heap limit`），
 *   於是**字面 `npm test` 在這一支就掛掉**。那量到的是測資物件有多大，
 *   不是演算法的成長階數。
 * ⚠️ 修法刻意**只換測資、不動門檻、不動筆數、不動迴圈**：
 *   RATIO 與 ALLOWED 一個字都沒改，30000／300000 也照舊，
 *   平方那一組仍是 1000／10000。放寬門檻或縮小筆數會讓這一支守不到東西。
 * ⚠️ 站號一律用假的（`A00T00-*`），真實站號會被
 *   `tests/dependency-manifest.test.mjs` 擋下來。
 */
function roadKeyCorpus(n) {
  return Array.from({ length: n }, (_, index) => `A00T00-${index % 40}`);
}

/** 跑幾次取中位數；先暖機，避免把 JIT 的第一次算進去。 */
function medianMs(run, times = 5) {
  run();
  run();
  const samples = [];
  for (let i = 0; i < times; i += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const RATIO = 10;
const ALLOWED = RATIO * 3; // 線性≈10、平方≈100；30 離兩邊都夠遠

function scaling(label, sizeSmall, make) {
  /*
   * ⚠️ 小的那一次如果快到 1ms 以內，量測雜訊會讓比值毫無意義
   *   （0.2ms → 3ms 也會算成 15 倍）。
   *
   *   第一版遇到這種情形是「直接視為通過」——結果三項裡有兩項落進這個
   *   分支，等於**那兩項根本沒驗到**，而測試是綠的。那正是這個專案反覆
   *   出現的「假的綠」。
   *
   *   現在改成**把樣本放大再量一次**（最多放大兩輪）。放大之後還是
   *   量不出來，代表那段程式快到在任何實務資料量下都不可能造成延遲，
   *   那時候才視為通過，而且訊息會寫明是「放大到 N 筆仍然量不出來」。
   */
  /*
   * ⚠️ 2026-09-25：小的那一次要求**至少 4ms**，不是 1ms。
   *
   *   1ms 太小：整批 npm test 一起跑時機器是忙的，實測「正常的線性寫法」
   *   量到 30000 筆 1.6ms → 300000 筆 46.9ms（30.2 倍）而**誤判成不合格**；
   *   同一支單獨跑則是 1.3ms → 12.9ms（9.8 倍）通過。
   *
   *   會間歇紅字的守門本身就是缺陷——它會訓練維護者忽略紅字，
   *   最後被整條刪掉。門檻拉到 4ms 之後基準值夠大，雜訊佔比小很多；
   *   達不到 4ms 就往上放大樣本（本來就有的機制），
   *   所以**不會因此變成假的綠**：放大到最後還量不出來時，
   *   訊息會明講「放大到 N 筆仍然量不出來」。
   */
  const MIN_BASELINE_MS = 4;
  let base = sizeSmall;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const small = medianMs(make(base));
    const big = medianMs(make(base * RATIO));
    if (small >= MIN_BASELINE_MS) {
      const factor = big / small;
      return {
        small,
        big,
        factor,
        ok: factor <= ALLOWED,
        why:
          `${label}：${base} 筆 ${small.toFixed(1)}ms → ` +
          `${base * RATIO} 筆 ${big.toFixed(1)}ms（${factor.toFixed(1)} 倍）`,
      };
    }
    if (attempt === 2)
      return {
        small,
        big,
        factor: big / small,
        ok: true,
        why:
          `${label}：放大到 ${base} 筆仍只花 ${small.toFixed(2)}ms` +
          `（${base * RATIO} 筆 ${big.toFixed(2)}ms）——` +
          "在任何實務資料量下都不可能造成延遲",
      };
    base *= 10;
  }
  throw new Error("unreachable");
}

test("⚠️ 結論草稿（四個時段 × 全部指標）：資料 ×10 時間不可以 ×100", () => {
  const condition = {
    ...DEFAULT_CONDITION,
    scope: { kind: "project" },
    periods: [...PERIOD_KEYS],
    metrics: CONCLUSION_METRICS.map((metric) => metric.key),
    grouping: "byRoad",
  };
  const result = scaling("結論草稿", 200, (size) => {
    const rows = corpus(size);
    return () => buildConclusion(rows, condition, META);
  });
  console.error("  " + result.why);
  assert.ok(
    result.ok,
    `${result.why}\n` +
      `成長倍數超過 ${ALLOWED}——資料量一大就會卡。\n` +
      "常見成因是「對每一筆再掃一次全表」（巢狀迴圈、在迴圈裡 filter／find／indexOf）。",
  );
});

test("⚠️ 結論草稿（只勾一個時段）：資料 ×10 時間不可以 ×100", () => {
  const condition = {
    ...DEFAULT_CONDITION,
    scope: { kind: "project" },
    periods: ["all"],
    metrics: ["count", "pcu", "composition"],
    grouping: "byQuarter",
  };
  const result = scaling("結論草稿（單一時段）", 200, (size) => {
    const rows = corpus(size);
    return () => buildConclusion(rows, condition, META);
  });
  console.error("  " + result.why);
  assert.ok(result.ok, `${result.why}\n成長倍數超過 ${ALLOWED}。`);
});

test("⚠️ 這一支真的抓得到平方成長（反證，不然門檻訂錯也沒人知道）", () => {
  const quadratic = (size) => {
    const keys = roadKeyCorpus(size);
    return () => {
      let hits = 0;
      for (const key of keys)
        for (const other of keys) if (other === key) hits += 1;
      return hits;
    };
  };
  const bad = scaling("刻意寫壞的平方寫法", 1000, quadratic);
  console.error("  （反證）" + bad.why);
  assert.ok(
    !bad.ok,
    `平方寫法竟然通過了（${bad.factor.toFixed(1)} 倍 ≤ ${ALLOWED}）——` +
      "門檻太鬆，這一支守不到任何東西",
  );

  const linear = (size) => {
    const keys = roadKeyCorpus(size);
    return () => {
      const byRoad = new Map();
      for (const key of keys) byRoad.set(key, (byRoad.get(key) || 0) + 1);
      return byRoad.size;
    };
  };
  /*
   * ⚠️ 基準刻意從 30000 提高到 300000：輕量測資在 30000 筆時只花 0.x 毫秒，
   *   `scaling()` 會判定「快到量不出來」而自己把基準乘十（30000→300000→3000000）。
   *   那個放大是**看機器速度決定的**，在更快的機器上會再放大一級到 3000 萬筆，
   *   又回到記憶體不足的老路。直接從 300000 起跑時實測 11.2ms ≥ 1ms，
   *   放大邏輯不會觸發，筆數固定在 300000／3000000。
   *   ⚠️ 門檻（RATIO=10、ALLOWED=30）與平方那一組的 1000／10000 都沒有動。
   */
  const good = scaling("正常的線性寫法", 300000, linear);
  console.error("  （反證）" + good.why);
  assert.ok(good.ok, `線性寫法被誤判成不合格：${good.why}`);
});
