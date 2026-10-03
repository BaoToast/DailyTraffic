/*
 * ══════════════════════════════════════════════════════════════════
 *  係數適用範圍：解析順位與「不設定就完全無感」
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支守的是**每一個 PCU 數字的來源**。判斷錯一次，畫面、Excel、
 * 報告草稿、歷季趨勢會一起錯，而且錯得很安靜——數字看起來都很合理。
 *
 * A 段最重要：**沒有任何覆寫時，行為必須與改版前一模一樣。**
 * 使用者的原話是「初始的預設自然是設定一次，套用全季度＋全路段」，
 * 也就是說現有行為就是最粗的那一層。做不到這一點，就是拿一個全新的
 * 複雜度去換一個他還沒要用的彈性。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "app", "final-workflow.ts"),
  "utf8",
);
const dashboardSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "app", "DashboardClient.tsx"),
  "utf8",
);
import {
  ANY,
  conflictsIn,
  hasAnyScope,
  ownScope,
  pickProjects,
  removeScope,
  resolveFactors,
  resolveFactorsWithTier,
  scopeLabel,
  upsertScope,
  newConflictsAfter,
} from "../app/factor-scope.ts";

/* 用可辨識的假係數，看得出到底命中了哪一組。 */
const DEFAULT = { tag: "計畫預設" };
const Q_ROAD = { tag: "這一季這一段" };
const Q_ANY = { tag: "這一季全路段" };
const ANY_ROAD = { tag: "全季別這一段" };

const scope = (quarter, roadId, factors) => ({ quarter, roadId, factors });

/* ── A. 沒有覆寫時完全無感 ──────────────────────────────────── */

test("A1 ⚠️ 沒有任何覆寫時，回傳的必須是**同一個物件**，不是複製品", () => {
  /*
   * 複製的話，任何「這一筆是不是用預設係數」的比較（=== 或 JSON 簽章）
   * 都會變成 false，畫面會開始說「這一季有專屬係數」——而其實沒有。
   * Excel 的「共用到 N 組不同的當量矩陣」也會從 1 變成 N。
   */
  for (const empty of [null, undefined, []])
    assert.equal(
      resolveFactors(empty, DEFAULT, "115Q2", "R-01"),
      DEFAULT,
      `scopes=${JSON.stringify(empty)} 時沒有回傳原物件`,
    );
});

test("A2 沒有覆寫時，任何季別 × 任何路段都拿到同一組", () => {
  const seen = new Set();
  for (const quarter of ["111Q3", "113Q1", "115Q2", ""])
    for (const road of ["R-01", "R-99", ""])
      seen.add(resolveFactors([], DEFAULT, quarter, road));
  assert.equal(seen.size, 1);
  assert.equal([...seen][0], DEFAULT);
});

test("A3 hasAnyScope 要能分辨「完全沒設定」", () => {
  assert.equal(hasAnyScope(null), false);
  assert.equal(hasAnyScope([]), false);
  assert.equal(hasAnyScope([scope("115Q2", ANY, Q_ANY)]), true);
});

/* ── B. 解析順位 ────────────────────────────────────────────── */

test("B1 順位 1：(這一季, 這一段) 蓋過其他全部", () => {
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope("115Q2", ANY, Q_ANY),
    scope("115Q2", "R-01", Q_ROAD),
  ];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), Q_ROAD);
});

test("B2 順位 2：(這一季, 全路段) 蓋過 (全季別, 這一段)——**季別優先**", () => {
  /*
   * 這正是使用者的情境沒有涵蓋到、我選的那一條。
   * 理由：標準改版通常是外部規定，一改就是全部都改；
   * 而路段專屬值是使用者為了某一段自己調的，新標準下本來就該重做。
   * ⚠️ 但這種重疊一定要被 conflictsIn() 挑出來（見 D 段）。
   */
  const scopes = [scope(ANY, "R-01", ANY_ROAD), scope("115Q2", ANY, Q_ANY)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), Q_ANY);
});

test("B3 順位 3：只有 (全季別, 這一段) 時就用它", () => {
  const scopes = [scope(ANY, "R-01", ANY_ROAD)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), ANY_ROAD);
  /* 別的路段不受影響。 */
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-02"), DEFAULT);
});

test("B4 順位 4：都沒命中就回計畫預設", () => {
  const scopes = [scope("114Q1", "R-09", Q_ROAD)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), DEFAULT);
});

test("B5 命中的順位要講得出來（摘要與提示靠它）", () => {
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope("115Q2", ANY, Q_ANY),
    scope("115Q2", "R-01", Q_ROAD),
  ];
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "115Q2", "R-01").tier,
    "quarter-road",
  );
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "115Q2", "R-02").tier,
    "quarter-any",
  );
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "114Q1", "R-01").tier,
    "any-road",
  );
  assert.equal(
    resolveFactorsWithTier(scopes, DEFAULT, "114Q1", "R-02").tier,
    "project-default",
  );
});

/* ── C. 互不干擾 ────────────────────────────────────────────── */

test("C1 ⚠️ 季別之間不可以互相干擾", () => {
  const scopes = [scope("115Q2", ANY, Q_ANY)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), Q_ANY);
  for (const other of ["115Q1", "115Q3", "114Q4", "111Q3"])
    assert.equal(
      resolveFactors(scopes, DEFAULT, other, "R-01"),
      DEFAULT,
      `${other} 被 115Q2 的設定汙染了`,
    );
});

test("C2 ⚠️ 路段之間不可以互相干擾", () => {
  const scopes = [scope(ANY, "R-01", ANY_ROAD)];
  for (const other of ["R-02", "R-10", "R-011", "r-01"])
    assert.equal(
      resolveFactors(scopes, DEFAULT, "115Q2", other),
      DEFAULT,
      `${other} 被 R-01 的設定汙染了`,
    );
});

test("C3 ⚠️ 路段代碼是**完全比對**，不可以用前綴比對", () => {
  /*
   * 「R-1」若用 startsWith 去比，會連 R-10、R-11、R-12 一起吃掉。
   * 這種錯不會有人發現——那幾段路的 PCU 只是「有點不一樣」。
   */
  const scopes = [scope(ANY, "R-1", ANY_ROAD)];
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-1"), ANY_ROAD);
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-10"), DEFAULT);
});

test("C4 ⚠️ 計畫之間不可以互相干擾（匯出備份時）", () => {
  const byProject = {
    "P-1": [scope("115Q2", ANY, Q_ANY)],
    "P-2": [scope(ANY, "R-01", ANY_ROAD)],
  };
  const picked = pickProjects(byProject, ["P-1"]);
  assert.deepEqual(Object.keys(picked), ["P-1"]);
  /* 全部匯出時兩個都在。 */
  assert.deepEqual(Object.keys(pickProjects(byProject, null)).sort(), [
    "P-1",
    "P-2",
  ]);
});

/* ── D. 衝突要看得見 ────────────────────────────────────────── */

test("D1 兩個維度重疊時要被標成衝突", () => {
  const scopes = [scope(ANY, "R-01", ANY_ROAD), scope("115Q2", ANY, Q_ANY)];
  const found = conflictsIn(scopes);
  assert.equal(found.length, 1);
  assert.deepEqual(found[0], {
    quarter: "115Q2",
    roadId: "R-01",
    winner: "quarter-any",
    loser: "any-road",
  });
});

test("D2 ⚠️ 已經有明確設定的那一格**不算**衝突", () => {
  /* 使用者已經自己講清楚了，就沒有「不知道用哪一組」的問題。 */
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope("115Q2", ANY, Q_ANY),
    scope("115Q2", "R-01", Q_ROAD),
  ];
  assert.deepEqual(conflictsIn(scopes), []);
});

test("D3 沒有重疊就沒有衝突（不可以無中生有）", () => {
  assert.deepEqual(conflictsIn([]), []);
  assert.deepEqual(conflictsIn([scope("115Q2", ANY, Q_ANY)]), []);
  assert.deepEqual(conflictsIn([scope(ANY, "R-01", ANY_ROAD)]), []);
  assert.deepEqual(
    conflictsIn([scope("115Q2", "R-01", Q_ROAD)]),
    [],
    "明確設定單獨存在時不該算衝突",
  );
});

test("D4 多對多的重疊要全部列出來", () => {
  const scopes = [
    scope(ANY, "R-01", ANY_ROAD),
    scope(ANY, "R-02", ANY_ROAD),
    scope("115Q1", ANY, Q_ANY),
    scope("115Q2", ANY, Q_ANY),
  ];
  const found = conflictsIn(scopes);
  assert.equal(found.length, 4, "2 季 × 2 段 應該要有 4 格重疊");
});

/* ── E. 寫入與刪除 ──────────────────────────────────────────── */

test("E1 ⚠️ 同一格重複寫入是**取代**，不是累加", () => {
  /*
   * 累加的話同一格會有兩筆，摘要列出兩列一模一樣的範圍，
   * 使用者刪掉其中一列卻發現值沒變。
   */
  let scopes = [];
  scopes = upsertScope(scopes, scope("115Q2", "R-01", { tag: "第一次" }));
  scopes = upsertScope(scopes, scope("115Q2", "R-01", { tag: "第二次" }));
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].factors.tag, "第二次");
});

test("E2 不同格各自獨立", () => {
  let scopes = [];
  scopes = upsertScope(scopes, scope("115Q2", "R-01", Q_ROAD));
  scopes = upsertScope(scopes, scope("115Q2", "R-02", Q_ANY));
  scopes = upsertScope(scopes, scope(ANY, "R-01", ANY_ROAD));
  assert.equal(scopes.length, 3);
});

test("E3 刪除一格＝那一格還原成預設，其他格不受影響", () => {
  let scopes = [
    scope("115Q2", "R-01", Q_ROAD),
    scope("115Q2", "R-02", Q_ANY),
  ];
  scopes = removeScope(scopes, "115Q2", "R-01");
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-01"), DEFAULT);
  assert.equal(resolveFactors(scopes, DEFAULT, "115Q2", "R-02"), Q_ANY);
});

test("E4 ownScope 只回「這一格自己的」，不繼承", () => {
  const scopes = [scope("115Q2", ANY, Q_ANY)];
  /* 這一格有自己的設定。 */
  assert.equal(ownScope(scopes, "115Q2", ANY)?.factors, Q_ANY);
  /* 這一格是**繼承**來的，不是自己的——編輯畫面要顯示成「尚未設定」。 */
  assert.equal(ownScope(scopes, "115Q2", "R-01"), null);
});

test("E5 upsert／remove 不可以就地改動原陣列（React state 會不更新）", () => {
  const original = [scope("115Q2", "R-01", Q_ROAD)];
  const frozen = JSON.stringify(original);
  upsertScope(original, scope("114Q1", ANY, Q_ANY));
  removeScope(original, "115Q2", "R-01");
  assert.equal(JSON.stringify(original), frozen, "原陣列被就地改掉了");
});

/* ── F. 標籤 ────────────────────────────────────────────────── */

test("F1 範圍標籤要看得懂，而且全系統只有一種寫法", () => {
  assert.equal(scopeLabel(ANY, ANY), "全季別 × 全路段");
  assert.equal(scopeLabel("115Q2", ANY), "115Q2 × 全路段");
  assert.equal(scopeLabel(ANY, "R-01"), "全季別 × R-01");
  assert.equal(scopeLabel("115Q2", "R-01", "示範一路口"), "115Q2 × 示範一路口");
});

/* ══════════════════════════════════════════════════════════════════════
 *  B3：衝突要在「設定的當下」就問——而且只問**新增的**那幾筆
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30：「覆寫衝突請改成當下跳確認視窗。」
 */

test("B3-1 新設定造成新的重疊時，回報那幾筆", () => {
  const scopes = [
    { quarter: ANY, roadId: "R1", factors: { core: { car: 1 } } },
  ];
  const added = newConflictsAfter(scopes, {
    quarter: "115Q2",
    roadId: ANY,
    factors: { core: { car: 2 } },
  });
  assert.equal(added.length, 1);
  assert.equal(added[0].quarter, "115Q2");
  assert.equal(added[0].roadId, "R1");
});

test("B3-2 ★反面：已經存在的舊重疊**不可以**再問一次", () => {
  /*
   * ⚠️ 這一條是這個功能最重要的一塊。
   *   拿「現在一共有幾個重疊」去問的話，使用者每改一次設定
   *   都會被同一個舊重疊問一次——問到最後一定變成無腦按確定，
   *   那比不問更糟。
   */
  const scopes = [
    { quarter: ANY, roadId: "R1", factors: { core: { car: 1 } } },
    { quarter: "115Q2", roadId: ANY, factors: { core: { car: 2 } } },
  ];
  /* 這一筆和 R1 無關，不該把舊的 (115Q2, R1) 重疊再報一次 */
  const added = newConflictsAfter(scopes, {
    quarter: "115Q3",
    roadId: "R9",
    factors: { core: { car: 3 } },
  });
  assert.deepEqual(added, [], "把已經存在的舊重疊又報了一次");
});

test("B3-3 沒有造成重疊時回空陣列（呼叫端不必問）", () => {
  const added = newConflictsAfter([], {
    quarter: "115Q2",
    roadId: "R1",
    factors: { core: { car: 1 } },
  });
  assert.deepEqual(added, []);
});

test("B3-4 那一格已經有明確設定時不算重疊", () => {
  /*
   * (115Q2, R1) 自己有設定 → 使用者已經講清楚了，沒有「不知道用哪一組」的問題。
   */
  const scopes = [
    { quarter: ANY, roadId: "R1", factors: { core: { car: 1 } } },
    { quarter: "115Q2", roadId: "R1", factors: { core: { car: 9 } } },
  ];
  const added = newConflictsAfter(scopes, {
    quarter: "115Q2",
    roadId: ANY,
    factors: { core: { car: 2 } },
  });
  assert.deepEqual(added, [], "那一格已經有明確設定，不該算成重疊");
});

test("B3-5 摘要那一段**不可以**被移除（兩者用途不同）", () => {
  /*
   * 確認視窗管「你正在做的這一步」，摘要管「目前整體長什麼樣」。
   * 拿掉摘要的話，使用者按過確定之後就再也看不到自己有哪些重疊。
   */
  assert.match(
    dashboardSource,
    /factor-scope-conflict/,
    "「當下跳確認視窗」不是用來取代摘要的——摘要被拿掉了",
  );
  assert.match(
    dashboardSource,
    /scopeConflicts\.length \? \(/,
    "摘要的條件渲染不見了",
  );
});

test("B3-6 確認視窗要擋在真的寫入之前", () => {
  const at = dashboardSource.indexOf("const newConflicts = newScopeConflictsAfter(");
  const writeAt = dashboardSource.indexOf("const nextScopes = upsertPcuScope(pendingScope");
  const writeAt2 = dashboardSource.indexOf("const nextScopes = upsertPcuScope(pcuScopes, pendingScope)");
  assert.ok(at > 0, "前置：找不到新增衝突的判斷");
  const write = writeAt > 0 ? writeAt : writeAt2;
  assert.ok(write > at, "確認視窗被排到寫入之後了——那時候已經存進去了");
});

/* ══════════════════════════════════════════════════════════════════════
 *  B1：異常門檻的「季別 × 路段」覆寫
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 的界線：「可以做，但要記得**不要影響到數值正確性、
 * 各項功能正常的使用**。」
 *
 * 所以這一段**一半是反面**：證明沒有設覆寫時，行為與改版前一模一樣。
 */

test("B1-1 ★不變量：沒有設覆寫時，門檻物件是**同一個參考**", () => {
  /*
   * ⚠️ 這是使用者那句話的機械化版本。回傳同一個參考，
   *   代表下游的每一個比較都是逐位元相同的——不是「值一樣」，是「就是它」。
   *   改成回傳複製品的話這一條紅，而且畫面會開始說「這一季有專屬門檻」。
   */
  const defaults = { dailyChangePct: 20, pcuChangePct: 20 };
  assert.equal(resolveFactors(undefined, defaults, "115Q2", "R1"), defaults);
  assert.equal(resolveFactors(null, defaults, "115Q2", "R1"), defaults);
  assert.equal(resolveFactors([], defaults, "115Q2", "R1"), defaults);
});

test("B1-2 設了某一季某一路段，只有那一格變", () => {
  const defaults = { dailyChangePct: 20 };
  const loose = { dailyChangePct: 60 };
  const scopes = [{ quarter: "115Q2", roadId: "R1", factors: loose }];
  assert.equal(resolveFactors(scopes, defaults, "115Q2", "R1"), loose);
  /* 其他三格一律回原本那個參考 */
  assert.equal(resolveFactors(scopes, defaults, "115Q2", "R9"), defaults);
  assert.equal(resolveFactors(scopes, defaults, "115Q3", "R1"), defaults);
  assert.equal(resolveFactors(scopes, defaults, "115Q3", "R9"), defaults);
});

test("B1-3 detectAnomalies 的新參數是**可選、放在最後**", () => {
  /*
   * ⚠️ 既有呼叫端一個字都不用改——這一條守的就是那件事。
   *   把它改成必填、或插在中間，所有呼叫端都要跟著改，
   *   而漏改的那幾個會拿到錯位的引數（labels 被當成 scopes）。
   */
  const at = workflowSource.indexOf("export function detectAnomalies(");
  assert.ok(at > 0, "前置：找不到 detectAnomalies");
  const sig = workflowSource.slice(at, workflowSource.indexOf("): AnomalyAlert[] {", at));
  assert.match(sig, /thresholdScopes\?:/, "新參數不是可選的");
  assert.ok(
    sig.lastIndexOf("thresholdScopes") > sig.lastIndexOf("labels:"),
    "新參數沒有放在最後——插在中間會讓既有呼叫端錯位",
  );
});

test("B1-4 ★零流量那一條要用**它自己那一季**的門檻", () => {
  /*
   * ⚠️ 零流量的判斷在比較迴圈**外面**（它看的是最後一季自己，不是兩季相比）。
   *   沿用迴圈裡最後一次的 limits 是錯的——那是「最後一次比較」那一季的，
   *   不見得等於 latest 那一季。這種錯不會報錯，只會在某些季別用錯門檻。
   */
  assert.match(
    workflowSource,
    /const latestLimits = latest\s*\?\s*resolveFactors\(/,
    "零流量那一條沒有自己解析門檻",
  );
  assert.doesNotMatch(
    workflowSource,
    /latest\.zeros > limits\.zeroHourLimit/,
    "零流量還在沿用迴圈裡的 limits",
  );
});
