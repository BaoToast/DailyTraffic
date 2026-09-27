/*
 * ══════════════════════════════════════════════════════════════════════
 *  「前往…」按鈕的準則（A11，使用者 2026-09-21 指示）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 準則：**看說明文字有沒有真的叫使用者去那一頁「做一件事」。**
 *   有  → 保留按鈕
 *   沒有 → 移除（只是「去那邊看結果」，或那一頁根本沒提到）
 *
 * 三支共 27 顆按鈕全部盤過，**只有 1 顆不通過**，而且三支是同一種異常：
 *   路口轉向     調查日期不只一個 → 流量核對工作台
 *   交通服務水準 調查日期不只一個 → 尖峰明細
 *   全日交通量   調查日期不只一個 → 可追溯明細
 * 那一項的動作完全在那一列完成（「指定調查日期」選單），
 * 按鈕只會讓人以為還有一步沒做。使用者原話：
 *   「請把前往流量核對工作台拿掉」
 *
 * ⚠️ 其餘 24 顆一顆都不能動。這一支守的是**那一顆不要回來**，
 *   以及**其他的不要被順手清掉**。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/final-workflow.ts", import.meta.url),
  "utf8",
);

test("⚠️「調查日期不只一個」不可以有「前往…」按鈕", () => {
  const start = source.indexOf("  調查日期不只一個: {");
  assert.notEqual(start, -1, "找不到「調查日期不只一個」的 resolution");
  const block = source.slice(start, source.indexOf("\n  },", start));
  assert.doesNotMatch(
    block,
    /\banchor:/,
    "按鈕回來了——可追溯明細只是顯示結果，會讓人以為還有一步沒做",
  );
  assert.doesNotMatch(block, /\banchorLabel:/);
  assert.match(block, /指定調查日期/);
});

test("⚠️ 其餘的「前往…」按鈕不可以被順手清掉", () => {
  const count = (source.match(/\banchorLabel:/g) || []).length;
  assert.ok(count >= 5, `「前往…」按鈕只剩 ${count} 顆`);
});
