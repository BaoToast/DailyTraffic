/*
 * 圖說第 3、4 級：走三支共用的契約表。
 * ⚠️ 案例表在 tests/chart-levels-contract.mjs，三支逐位元相同——
 *   要改判斷規則就三支一起改，否則同一個數字在三支會被說成不同的狀況。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as levels from "../app/chart-levels.ts";
import { checkChartLevelsContract } from "./chart-levels-contract.mjs";

test("圖說第 3、4 級符合三支共用的契約", () => {
  const failures = [];
  checkChartLevelsContract(levels, (label, passed, detail) => {
    if (!passed) failures.push(`${label} — ${detail}`);
  });
  assert.deepEqual(failures, []);
});

test("⚠️ 共用模組的內容要與另外兩支逐位元相同（SHA-256 釘住）", async () => {
  /*
   * 這個雜湊是三支共用的那一份 chart-levels 的內容。
   * 改判斷規則時三支一起改，然後把三支的雜湊一起更新——
   * 只改一支的話這裡會紅，那正是它的用途。
   */
  const source = await readFile(new URL("../app/chart-levels.ts", import.meta.url));
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    "0f9a62f51479e6807c859157a61064a0f96d187261ced9e747f05bb79810aa4c",
    "chart-levels.ts 改過了，但另外兩支可能沒跟著改",
  );
});
