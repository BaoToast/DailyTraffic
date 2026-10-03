/*
 * ══════════════════════════════════════════════════════════════════════
 *  W-0：檔案編號是流水號；判定期別、判定「是不是同一份資料」一律看調查日期
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29（兩則，合起來才是完整的裁示）：
 *
 *  ①「那串數字記的是第幾季，不一定是指第幾季的……對使用者來說是流水編號，
 *     主要還是看資料裡面的日期，才能做為判定這是哪一季……檔案編號哪怕一樣，
 *     使用者都不會在意。這一點情況，三支程式都可能發生。」
 *
 *  ②「我比較擔心程式會因為檔案編號一樣，例如 115Q1 檔案編號 T15-01，
 *     115Q4 檔案編號也是 T15-01，後者資料卻覆蓋掉了前者，但明明檔案裡面
 *     顯示的是不同監測日期，只要裡面資料是不同監測日期，那麼檔案就是
 *     不一樣的。」
 *
 * ⚠️ 這一支刻意不用任何真實站號（與 tests/dependency-manifest.test.mjs
 *   同一條界線）：範例一律用 A00T00-01、999996～999999。
 *
 * 文案與交通服務水準的 overwrite-date-guard.test.mjs 守的是同一套字，
 * 三支的訊息必須逐字相同。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { overwriteDateConflictPrompt } from "../app/period-date.ts";
import { trafficIdentity } from "../app/final-workflow.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(
  join(here, "..", "app", "DashboardClient.tsx"),
  "utf8",
);

/* ══════════════════════════════════════════════════════════════════════
 *  A. 身分鍵含期別：兩季同號不覆蓋（她擔心的那個情境不會發生）
 * ══════════════════════════════════════════════════════════════════════ */

/** 一筆最小的可追溯紀錄；欄位值全部是範例編號，不是真實站號。 */
function record(quarter) {
  return {
    projectId: "P-TEST",
    quarter,
    roadId: "A00T00-01",
    dayType: "平日",
    directionCode: "D1",
    hour: 8,
  };
}

test("A-1 同一個編號、兩個不同期別 ⇒ 兩個不同的鍵（不覆蓋）", () => {
  /*
   * 這一條直接對應使用者舉的例子：115Q1 與 115Q4 都叫 A00T00-01。
   * 反證：把 record.quarter 從 trafficIdentity 拿掉，兩邊會相等，這一條紅。
   */
  assert.notEqual(
    trafficIdentity(record("115Q1")),
    trafficIdentity(record("115Q4")),
    "兩季同號算出同一個鍵——後匯入的那一季會蓋掉前一季",
  );
});

test("A-2 兩個不同編號、同一個期別、同一條路 ⇒ 由 roadId 決定，不受編號寫法影響", () => {
  /*
   * 另一個方向：廠商每一季重新編號（114Q1=10、Q2=11…）。
   * 系統拿來配對的是 roadId（案號剝除後的路段身分），不是檔名編號，
   * 所以同一條路換了編號照樣配得起來。
   *
   * 反證：若哪天有人把檔名編號塞進 trafficIdentity，這一條會紅。
   */
  const a = { ...record("115Q1"), roadId: "甲路（乙街～丙街）" };
  const b = { ...record("115Q1"), roadId: "甲路（乙街～丙街）" };
  assert.equal(trafficIdentity(a), trafficIdentity(b));
  assert.doesNotMatch(
    trafficIdentity(a),
    /999996|999997|999998|999999|A00T00/,
    "身分鍵裡混進了檔名編號——依使用者裁示，編號是流水號，不可以決定資料的身分",
  );
});

test("A-3 trafficIdentity 的欄位清單裡一定要有 quarter", () => {
  const source = readFileSync(join(here, "..", "app", "final-workflow.ts"), "utf8");
  const block = source.slice(
    source.indexOf("export function trafficIdentity"),
    source.indexOf("export function trafficIdentity") + 400,
  );
  assert.match(
    block,
    /record\.quarter/,
    "trafficIdentity 少了 quarter——兩季同號會撞成同一筆",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  B. 覆蓋前的日期把關
 * ══════════════════════════════════════════════════════════════════════ */

test("B-1 舊新日期不同才算衝突", () => {
  const message = overwriteDateConflictPrompt([
    { label: "115Q1・甲路・平日", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.match(message, /會蓋掉 1 筆/);
  assert.match(message, /原本是 2026-01-14，這一批是 2026-10-21/);
});

test("B-2 日期相同不算衝突——那是同一次調查的重匯，本來就該覆蓋", () => {
  /*
   * ⚠️ 反證：寫成「只要會覆蓋就問」的話，使用者每一次修正同一季重匯都被問，
   *   問到最後一定變成無腦按確定——那比不問更糟。
   */
  assert.equal(
    overwriteDateConflictPrompt([
      { label: "甲", oldDate: "2026-01-14", newDate: "2026-01-14" },
    ]),
    "",
  );
});

test("B-3 只有一邊讀得出日期不算衝突——沒有證據就擋是假的紅", () => {
  assert.equal(
    overwriteDateConflictPrompt([{ label: "甲", oldDate: "", newDate: "2026-10-21" }]),
    "",
  );
  assert.equal(
    overwriteDateConflictPrompt([{ label: "甲", oldDate: "2026-01-14", newDate: "" }]),
    "",
  );
});

test("B-4 訊息要說出「編號一樣不代表是同一份資料」", () => {
  const message = overwriteDateConflictPrompt([
    { label: "甲", oldDate: "2026-01-14", newDate: "2026-10-21" },
  ]);
  assert.match(message, /檔案編號一樣不代表是同一份資料/);
  assert.match(message, /判斷依據一律是檔案裡的調查日期/);
  assert.match(message, /兩次不同的調查/);
});

test("B-5 沒有衝突時回空字串", () => {
  assert.equal(overwriteDateConflictPrompt([]), "");
});

test("B-6 把關要擋在 setBusy(true) 與任何 API 上傳之前", () => {
  /*
   * ⚠️ 這一條守的是**順序**。這一支的寫入路徑會先把檔案 POST 到 /api/files，
   *   把關排在那之後的話，使用者按「取消」時檔案已經上傳進去了。
   *
   * ⚠️ 不可以用 indexOf("setBusy(true)") 的**第一個**：這個檔案兩萬多行，
   *   別的流程也在用 setBusy，第一個根本不在匯入這條路上。
   *   一樣不可以用 indexOf("overwriteDateConflictPrompt(") 的第一個——
   *   那是檔頭的 import。兩個都會讓這一條變成量錯地方的假的紅／假的綠。
   *   這裡改成：先錨在只出現一次的那一行，再往後找最近的一個。
   */
  const anchor = dashboardSource.indexOf(
    "const incoming = pendingImport.records.map(",
  );
  assert.ok(anchor > 0, "前置：找不到覆蓋把關那一段的錨點");
  assert.equal(
    dashboardSource.split("const incoming = pendingImport.records.map(").length - 1,
    1,
    "錨點不只一處，這一條會量到別的地方",
  );
  const guardAt = dashboardSource.indexOf("overwriteDateConflictPrompt(", anchor);
  const busyAt = dashboardSource.indexOf("setBusy(true)", anchor);
  const uploadAt = dashboardSource.indexOf('appFetch("/api/files"', anchor);
  assert.ok(guardAt > anchor, "前置：錨點之後找不到覆蓋把關的呼叫");
  assert.ok(busyAt > anchor, "前置：錨點之後找不到 setBusy(true)");
  assert.ok(uploadAt > anchor, "前置：錨點之後找不到 /api/files 的上傳");
  assert.ok(guardAt < busyAt, "覆蓋把關被排到 setBusy(true) 後面了");
  assert.ok(guardAt < uploadAt, "覆蓋把關被排到檔案上傳後面了——那時候已經寫進去了");
});

test("B-7 身分鍵要用「改過季別之後」的季別去算", () => {
  /*
   * ⚠️ 使用者可以在預覽之後才改季別。拿 pendingImport.parsedQuarter 去算鍵，
   *   撞不到任何既有資料，這一道就會安靜地永遠不觸發——一條看起來存在、
   *   實際上從來不會紅的守門，比沒有守門更糟。
   */
  const block = dashboardSource.slice(
    dashboardSource.indexOf("const existingByKey = new Map("),
    dashboardSource.indexOf("const existingByKey = new Map(") + 600,
  );
  const incoming = dashboardSource.slice(
    dashboardSource.indexOf("const incoming = pendingImport.records.map("),
    dashboardSource.indexOf("const incoming = pendingImport.records.map(") + 220,
  );
  assert.match(
    incoming,
    /quarter:\s*importQuarterKey/,
    "覆蓋比對用的是解析當下的季別，不是使用者改過之後的季別",
  );
  assert.ok(block.length > 0, "前置：找不到既有資料的索引");
});

test("B-8 復原說明要是這一支自己的（還原點），不可以抄別支的字", () => {
  /*
   * ⚠️ 一樣不可以用 indexOf 的第一個——那是檔頭的 import。
   */
  const anchor = dashboardSource.indexOf(
    "const incoming = pendingImport.records.map(",
  );
  assert.ok(anchor > 0, "前置：找不到覆蓋把關那一段的錨點");
  const callAt = dashboardSource.indexOf("overwriteDateConflictPrompt(", anchor);
  assert.ok(callAt > anchor, "前置：錨點之後找不到覆蓋把關的呼叫");
  const block = dashboardSource.slice(callAt, callAt + 400);
  assert.match(block, /還原點/, "這一支的復原機制是還原點，說明要照實寫");
  assert.doesNotMatch(
    block,
    /匯入紀錄/,
    "抄到交通服務水準的復原說明了——這一支沒有「匯入紀錄復原批次」這個功能，寫了就是說謊",
  );
});
