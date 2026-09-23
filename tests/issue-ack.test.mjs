/**
 * ══════════════════════════════════════════════════════════════════════
 *  「已人工確認」（使用者 2026-09-17 指名這個名稱）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 守這個功能最容易做錯的三件事（三支同一套）：
 *   ① 指紋不含數值 → 確認過「全日量變動 22%」之後，下一次變成 80%
 *      也被同一把鑰匙消音。那是把一個更嚴重的問題藏起來，
 *      **比沒有這個功能糟得多**。
 *   ② 「重新匯入」類也給按 → 等於提供一個把資料錯誤藏起來的開關。
 *   ③ 確認之後把總數直接變小 → 看不出還有幾筆、已處理幾筆。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const strip = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const workflow = strip(
  readFileSync(new URL("../app/final-workflow.ts", import.meta.url), "utf8"),
);
const dashboard = strip(
  readFileSync(new URL("../app/DashboardClient.tsx", import.meta.url), "utf8"),
);

test("① 指紋一定要包含那一筆的數值", () => {
  const block = workflow.slice(
    workflow.indexOf("export function anomalyFingerprint"),
    workflow.indexOf("export function anomalyFingerprint") + 900,
  );
  assert.ok(block.length > 100, "找不到 anomalyFingerprint");
  assert.match(
    block,
    /Number\(item\.value\)\.toFixed\(1\)/,
    "指紋沒有帶數值——確認過一次就永遠消音了",
  );
  assert.match(block, /item\.type/);
  assert.match(block, /item\.toQuarter/);
});

test("② 只有「人工確認」類可以按確認", () => {
  assert.match(
    dashboard,
    /const anomalyCanAck = \(item: AnomalyAlert\) =>\s*\n?\s*ANOMALY_RESOLUTIONS\[item\.type\]\?\.kind === "人工確認"/,
  );
  /* 按鈕本身要問過 anomalyCanAck，不可以無條件畫出來。 */
  assert.match(dashboard, /\{anomalyCanAck\(item\) && \(/);
  assert.match(dashboard, /data-testid="issue-ack"/);
});

test("③ 確認之後兩個數字都要寫出來，不是把總數變小", () => {
  assert.match(
    dashboard,
    /共 \$\{allAnomalyAlerts\.length\} 筆（其中 \$\{ackedAnomalyCount\} 筆已確認）/,
  );
});

test("已確認的要存進 workflow，重新整理不可以復活", () => {
  assert.match(workflow, /ackedAnomalies\?: Record<string, \{ at: string \}>;/);
  assert.match(workflow, /ackedAnomalies: \{\},/);
  assert.match(dashboard, /ackedAnomalies: own/);
});

test("⚠️ 那顆鈕的名字就是「已人工確認」（使用者 2026-09-17 指名）", () => {
  /*
   * 使用者原話：「按鈕名稱不要這麼長，改為『已人工確認』，系統就主動不再提醒」。
   * 守的是**名字**——改回長版本的話，按鈕文字在窄欄位會撐破邊界，
   * 那正是使用者點名要避免的三個雷之一。
   */
  assert.match(dashboard, /"已人工確認"/, "那顆鈕的名字要是「已人工確認」");
  assert.ok(
    !/已確認，不再提醒/.test(dashboard),
    "舊的長名字還留著——那一串在窄欄位會撐破按鈕",
  );
  assert.match(dashboard, /"取消確認"/, "取消那一顆要維持自己的名字");
});
