/*
 * ══════════════════════════════════════════════════════════════════════
 *  異常門檻的「季別×路段」覆寫：設定畫面與儲存（B1，2026-09-30）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 裁示：「可以做，但要記得**不要影響到數值正確性、
 * 各項功能正常的使用**」。
 *
 * 核心判斷（哪一筆用哪一組門檻）已由 tests/factor-scope.test.mjs 與
 * tests/final-workflow.test.mjs 守著。這一支守的是**接線與存檔**：
 *   ① 門檻真的被傳進 detectAnomalies（不傳＝畫面上設了完全沒作用）
 *   ② 儲存鍵有列進「刪計畫要一起清掉」的清單
 *      （漏掉的話，殘留設定會在下次建立同代碼的計畫時**無聲生效**）
 *   ③ 存檔驗證的欄位清單與 AnomalyThresholds 的欄位**完全一致**
 *   ④ 空陣列不可以留在儲存區
 *   ⑤ 全季別×全路段時走的是**改版前那一行**（改計畫預設），不是建立覆寫
 *
 * ⚠️ 這一支掃的是原始碼。畫面實際能不能用由 scripts/e2e-threshold-scope.mjs
 *   負責——兩者分工：這一支擋「接線接錯」，e2e 擋「畫出來不對」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../app/final-workflow.ts", import.meta.url),
  "utf8",
);

test("前置：真的讀到那兩個檔（讀成空字串的話下面全部恆綠）", () => {
  assert.ok(dashboard.length > 100000, `DashboardClient 只讀到 ${dashboard.length} 字元`);
  assert.ok(workflow.length > 20000);
});

test("① 門檻覆寫真的被傳進 detectAnomalies", () => {
  const at = dashboard.indexOf("const anomalyAlerts = useMemo");
  assert.notEqual(at, -1, "找不到 anomalyAlerts");
  const end = dashboard.indexOf("\n  );", at);
  const block = dashboard.slice(at, end);
  assert.ok(
    block.includes("detectAnomalies("),
    "anomalyAlerts 裡沒有呼叫 detectAnomalies",
  );
  assert.ok(
    block.includes("thresholdScopes,"),
    "detectAnomalies 沒有收到 thresholdScopes——畫面上設了會完全沒有作用",
  );
  assert.ok(
    /\bthresholdScopes\b/.test(block.slice(block.indexOf("    ["))),
    "thresholdScopes 沒有列進相依，覆寫改了畫面不會重算",
  );
});

test("② 儲存鍵有列進「刪計畫要一起清掉」的清單", () => {
  assert.ok(
    dashboard.includes('const THRESHOLD_SCOPES_BY_PROJECT_KEY = "traffic-threshold-scopes-by-project-v1"'),
    "找不到門檻覆寫的儲存鍵",
  );
  const at = dashboard.indexOf("const PROJECT_SCOPED_KEYS = [");
  assert.notEqual(at, -1, "找不到 PROJECT_SCOPED_KEYS");
  const block = dashboard.slice(at, dashboard.indexOf("] as const;", at));
  assert.ok(
    block.includes("THRESHOLD_SCOPES_BY_PROJECT_KEY"),
    "門檻覆寫沒有列進刪計畫的清理清單——殘留設定會在下次建立同代碼的計畫時無聲生效",
  );
});

test("③ 存檔驗證的欄位清單與 AnomalyThresholds 完全一致", () => {
  const typeAt = workflow.indexOf("export type AnomalyThresholds = {");
  assert.notEqual(typeAt, -1, "找不到 AnomalyThresholds");
  const typeBlock = workflow.slice(typeAt, workflow.indexOf("};", typeAt));
  const typeKeys = [...typeBlock.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort();
  const listAt = dashboard.indexOf("const THRESHOLD_KEYS = [");
  assert.notEqual(listAt, -1, "找不到 THRESHOLD_KEYS");
  const listBlock = dashboard.slice(listAt, dashboard.indexOf("] as const;", listAt));
  const listKeys = [...listBlock.matchAll(/"(\w+)"/g)].map((m) => m[1]).sort();
  assert.ok(typeKeys.length >= 5, `型別只抽到 ${typeKeys.length} 個欄位——抽取方式壞了`);
  assert.deepEqual(
    listKeys,
    typeKeys,
    "THRESHOLD_KEYS 與 AnomalyThresholds 不一致：型別多一個欄位而這裡沒跟上的話，存檔驗證會把新欄位當成不存在",
  );
});

test("④ 空陣列不可以留在儲存區", () => {
  const at = dashboard.indexOf("function writeProjectThresholdScopes");
  assert.notEqual(at, -1, "找不到 writeProjectThresholdScopes");
  const block = dashboard.slice(at, at + 600);
  assert.ok(
    /if \(scopes\.length\) map\[projectId\] = scopes;/.test(block) &&
      /else delete map\[projectId\];/.test(block),
    "沒有「空陣列就刪掉」那一段",
  );
});

test("⑤ 全季別×全路段時改的是計畫預設，不是建立一筆覆寫", () => {
  const at = dashboard.indexOf("function changeThreshold(");
  assert.notEqual(at, -1, "找不到 changeThreshold");
  const block = dashboard.slice(at, dashboard.indexOf("\n  }", at));
  assert.ok(
    block.includes("thresholdScopeQuarter === SCOPE_ANY") &&
      block.includes("thresholdScopeRoadId === SCOPE_ANY"),
    "沒有「全季別×全路段」那一條分支",
  );
  const branch = block.slice(0, block.indexOf("const next ="));
  assert.ok(
    branch.includes("setWorkflow(") && branch.includes("thresholds:"),
    "全季別×全路段時沒有改計畫預設",
  );
  assert.ok(
    !branch.includes("upsertPcuScope"),
    "全季別×全路段時竟然去建立覆寫——那會讓預設值變成一筆覆寫",
  );
});

test("⑥ 建立新的專屬門檻時要問「這一筆會新增哪些重疊」，不是問總數", () => {
  const at = dashboard.indexOf("function changeThreshold(");
  const block = dashboard.slice(at, dashboard.indexOf("\n  }", at));
  assert.ok(
    block.includes("newScopeConflictsAfter("),
    "沒有走 newConflictsAfter——拿總數去問的話，每改一次都會被同一個舊重疊問一次",
  );
  assert.ok(
    !block.includes("scopeConflictsIn("),
    "用了 conflictsIn（總數），那正是 B3 要避開的寫法",
  );
});

test("⑦ 有專屬門檻時要給得掉（移除按鈕）", () => {
  assert.ok(
    dashboard.includes('data-testid="threshold-scope-remove"'),
    "沒有移除專屬門檻的按鈕——設下去就拿不掉了",
  );
  assert.ok(
    dashboard.includes("function removeThresholdScope()"),
    "沒有 removeThresholdScope",
  );
});
