/*
 * ══════════════════════════════════════════════════════════════════════
 *  車種歸類的「季別×路段」覆寫：解析順位與變更標註（2026-09-30）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 裁示：B2 做。她同一句話裡交代的三件事：
 *   ①「圖上當然也要明白標出來」
 *   ②「匯出成 excel 時，可以改為說明行寫在一旁欄位上」
 *   ③「下載為高清晰圖檔時，維持圖版面淨空」
 *   以及「務必確認功能正常，且沒影響到其他功能」。
 *
 * 「沒影響到其他功能」那一半由 tests/vehicle-scope-golden.test.mjs 用黃金值守著。
 * 這一支守的是**新功能自己**：順位對不對、標註該亮的時候亮、不該亮的時候不亮。
 *
 * ⚠️ 站號與路段代號全部是假的（R1／R2／R3），不是真實站號。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classificationChangeLines,
  classificationChangesAcross,
  effectiveVehicleCounts,
  effectiveVehicleLabel,
  settingFor,
} from "../app/vehicle-analysis.ts";

/** 一筆最小的紀錄；車輛數只放一個自訂車種，方便看歸類結果。 */
function record(quarter, roadId, count = 10) {
  return {
    projectId: "P1",
    quarter,
    roadId,
    motorcycle: 0,
    small: 0,
    large: 0,
    special: 0,
    vehicleCounts: { "custom:小貨車": count },
    vehicleLabels: { "custom:小貨車": "小貨車" },
  };
}
/** 一筆歸類設定。quarter／roadId 省略＝計畫預設。 */
function setting(targetKey, targetLabel, quarter, roadId) {
  return {
    projectId: "P1",
    sourceKey: "custom:小貨車",
    sourceLabel: "小貨車",
    targetKey,
    targetLabel,
    roadPcu: 1,
    turnPcu: { left: 1, through: 1, right: 1 },
    ...(quarter === undefined ? {} : { quarter }),
    ...(roadId === undefined ? {} : { roadId }),
  };
}

test("順位：季別×路段 > 季別 > 路段 > 計畫預設", () => {
  const all = [
    setting("small", "小型車"),
    setting("large", "大型車", "", "R1"),
    setting("special", "特種車", "115Q2", ""),
    setting("custom:小貨車", "小貨車", "115Q2", "R1"),
  ];
  /* 四組都命中 → 取最具體的那一組 */
  assert.equal(settingFor(record("115Q2", "R1"), "custom:小貨車", all).targetKey, "custom:小貨車");
  /* 季別命中、路段不命中 → 季別那一組 */
  assert.equal(settingFor(record("115Q2", "R9"), "custom:小貨車", all).targetKey, "special");
  /* 路段命中、季別不命中 → 路段那一組 */
  assert.equal(settingFor(record("115Q1", "R1"), "custom:小貨車", all).targetKey, "large");
  /* 兩個都不命中 → 計畫預設 */
  assert.equal(settingFor(record("115Q1", "R9"), "custom:小貨車", all).targetKey, "small");
});

test("⚠️ 順位必須與 PCU 係數（factor-scope）一致：季別優先，不是路段優先", () => {
  /*
   * 兩邊順位不一致的後果很難看出來：同一筆資料的「歸類」走季別覆寫、
   * 「當量係數」走路段覆寫，數字只偏掉一點，沒有人會發現。
   */
  const all = [setting("special", "特種車", "115Q2", ""), setting("large", "大型車", "", "R1")];
  assert.equal(
    settingFor(record("115Q2", "R1"), "custom:小貨車", all).targetKey,
    "special",
    "季別必須贏過路段（與 factor-scope.ts 的 resolveFactors 相同）",
  );
});

test("空字串與沒有這個欄位等義（舊存檔讀進來是 undefined，畫面上選「全部」是空字串）", () => {
  const undefScope = [setting("small", "小型車")];
  const emptyScope = [setting("small", "小型車", "", "")];
  for (const settings of [undefScope, emptyScope]) {
    assert.equal(settingFor(record("115Q1", "R1"), "custom:小貨車", settings).targetKey, "small");
    assert.deepEqual(effectiveVehicleCounts(record("115Q1", "R1"), settings), { small: 10 });
  }
});

test("同分時取先出現的那一筆（與改版前 find() 的行為相同）", () => {
  const all = [setting("small", "小型車", "115Q1", ""), setting("large", "大型車", "115Q1", "")];
  assert.equal(settingFor(record("115Q1", "R1"), "custom:小貨車", all).targetKey, "small");
});

test("顯示名稱的順位必須與數字的順位相同", () => {
  /*
   * ⚠️ 不一致的症狀：圖上出現「大客車」的標籤，配著已經被歸到特種車的數字。
   */
  const all = [
    { ...setting("special", "特種車"), targetLabel: "特種車（計畫預設）" },
    { ...setting("special", "特種車", "115Q2", ""), targetLabel: "特種車（115Q2 專用名稱）" },
  ];
  assert.equal(
    effectiveVehicleLabel(record("115Q2", "R1"), "special", all),
    "特種車（115Q2 專用名稱）",
  );
  assert.equal(
    effectiveVehicleLabel(record("115Q1", "R1"), "special", all),
    "特種車（計畫預設）",
  );
});

/* ── 變更偵測：圖上該不該標 ────────────────────────────────────── */

test("兩路段跨季互換歸類：兩個維度都必須警告，不可只比較集合", () => {
  const records = [record("115Q1", "R1"), record("115Q1", "R2"), record("115Q2", "R1"), record("115Q2", "R2")];
  const settings = [setting("small", "小型車", "115Q1", "R1"), setting("large", "大型車", "115Q1", "R2"),
    setting("large", "大型車", "115Q2", "R1"), setting("small", "小型車", "115Q2", "R2")];
  const [change] = classificationChangesAcross(records, settings);
  assert.equal(change.acrossQuarters, true);
  assert.equal(change.acrossRoads, true);
  assert.match(classificationChangeLines([change])[0], /歷季之間不可以直接比較/);
});

test("★ 跨季別歸類不同時，偵測得出來，而且說得出「不可以直接比較」", () => {
  const records = [record("115Q1", "R1"), record("115Q2", "R1")];
  const settings = [setting("small", "小型車", "115Q1", ""), setting("large", "大型車", "115Q2", "")];
  const changes = classificationChangesAcross(records, settings);
  assert.equal(changes.length, 1, "應該偵測到一個原始車種的歸類不一致");
  assert.equal(changes[0].sourceLabel, "小貨車");
  assert.equal(changes[0].acrossQuarters, true, "這是跨季別的差異");
  assert.equal(changes[0].acrossRoads, false, "只有一條路段，不該說成跨路段");
  assert.deepEqual(
    changes[0].groups.map((g) => g.targetKey).sort(),
    ["large", "small"],
  );
  const lines = classificationChangeLines(changes);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /小貨車/);
  assert.match(lines[0], /不同季別之間/);
  assert.match(lines[0], /不可以直接比較/, "一定要寫出後果，不能只說「歸類有變更」");
  assert.match(lines[0], /車流沒有變/, "要講明白「數字會動但車流沒動」");
});

test("★ 同一季裡不同路段歸類不同時，說成跨路段，不可以說成跨季別", () => {
  const records = [record("115Q1", "R1"), record("115Q1", "R2")];
  const settings = [setting("small", "小型車", "", "R1"), setting("large", "大型車", "", "R2")];
  const changes = classificationChangesAcross(records, settings);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].acrossRoads, true);
  assert.equal(
    changes[0].acrossQuarters,
    false,
    "只有一個季別，說成跨季別會讓使用者去查一個不存在的問題",
  );
  assert.match(classificationChangeLines(changes)[0], /不同路段之間/);
});

test("⚠️ 反證一：歸類一致時**不可以**有任何標註（恆亮的標註等於沒有標註）", () => {
  const records = [record("115Q1", "R1"), record("115Q2", "R1"), record("115Q2", "R2")];
  /* 有設覆寫，但兩季都歸到同一類——數字可比，標它只是雜訊 */
  const settings = [
    setting("large", "大型車", "115Q1", ""),
    setting("large", "大型車", "115Q2", ""),
    setting("large", "大型車", "", "R2"),
  ];
  assert.deepEqual(classificationChangesAcross(records, settings), []);
  assert.deepEqual(classificationChangeLines(classificationChangesAcross(records, settings)), []);
});

test("⚠️ 反證二：完全沒有設定時也不可以標（沒有設定＝自成一類，不是歸類變更）", () => {
  const records = [record("115Q1", "R1"), record("115Q2", "R1")];
  assert.deepEqual(classificationChangesAcross(records, []), []);
});

test("⚠️ 反證三：只有一筆資料時不可以標", () => {
  assert.deepEqual(
    classificationChangesAcross([record("115Q1", "R1")], [setting("large", "大型車", "115Q1", "")]),
    [],
  );
});

test("兩個原始車種同時變過時，兩個都要列出來", () => {
  const twoSources = (quarter) => ({
    ...record(quarter, "R1"),
    vehicleCounts: { "custom:小貨車": 10, "custom:大客車": 5 },
    vehicleLabels: { "custom:小貨車": "小貨車", "custom:大客車": "大客車" },
  });
  const bus = (targetKey, targetLabel, quarter) => ({
    projectId: "P1",
    sourceKey: "custom:大客車",
    sourceLabel: "大客車",
    targetKey,
    targetLabel,
    roadPcu: 1,
    turnPcu: { left: 1, through: 1, right: 1 },
    quarter,
    roadId: "",
  });
  const changes = classificationChangesAcross(
    [twoSources("115Q1"), twoSources("115Q2")],
    [
      setting("small", "小型車", "115Q1", ""),
      setting("large", "大型車", "115Q2", ""),
      bus("large", "大型車", "115Q1"),
      bus("special", "特種車", "115Q2"),
    ],
  );
  assert.deepEqual(
    changes.map((c) => c.sourceLabel),
    ["custom:大客車", "custom:小貨車"].map((k) => (k === "custom:大客車" ? "大客車" : "小貨車")),
  );
  assert.equal(classificationChangeLines(changes).length, 2);
});
