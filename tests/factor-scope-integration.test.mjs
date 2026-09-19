/*
 * ══════════════════════════════════════════════════════════════════
 *  係數覆寫接進計算之後：數字到底有沒有變、變在哪裡
 * ══════════════════════════════════════════════════════════════════
 *
 * tests/factor-scope.test.mjs 驗的是**解析函式本身**（純邏輯）。
 * 這一支驗的是**接上計算之後**：同一筆紀錄，餵不同的覆寫，
 * PCU 是不是真的照預期變化。
 *
 * 使用者 2026-09-10：「你說依路段/季別分別設定最龐大，那在計算上的驗證、
 * 驗算更要嚴謹並再三確認正確。」
 *
 * A 段是最重要的一段：**沒有覆寫時，每一個數字都必須與改版前逐位元相同。**
 * 這一條做不到，整個改版就是拿一個新的複雜度去換一個還沒人要用的彈性。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  sumVehiclePcu,
  vehiclePcuByTarget,
  factorsForRecord,
} from "../app/vehicle-analysis.ts";
import { ANY } from "../app/factor-scope.ts";

/* 系統預設值（與 DashboardClient 的常數相同；改了那邊這裡會紅，是刻意的）。 */
const CORE = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const TURNS = {
  motorcycle: { through: 0.3, right: 0.4, left: 0.5 },
  small: { through: 1, right: 1.3, left: 1.5 },
  large: { through: 1.5, right: 2, left: 2.3 },
  special: { through: 2, right: 2.3, left: 2.5 },
};

/** 一筆路段格式的模擬紀錄。⚠️ 模擬資料，不是任何真實調查檔。 */
const roadRecord = (quarter, roadId) => ({
  quarter,
  roadId,
  motorcycle: 100,
  small: 200,
  large: 40,
  special: 10,
  surveyType: "road",
});

/** 手算：100×0.5 + 200×1 + 40×1.5 + 10×2.5 = 50 + 200 + 60 + 25 = 335 */
const HAND_CALC_DEFAULT = 335;

/* ── A. 沒有覆寫＝完全沒變 ─────────────────────────────────── */

test("A1 ⚠️ 沒有覆寫時，PCU 必須等於手算的預設結果", () => {
  const record = roadRecord("115Q2", "R-01");
  for (const scopes of [undefined, null, []])
    assert.equal(
      sumVehiclePcu(record, CORE, TURNS, [], scopes),
      HAND_CALC_DEFAULT,
      `scopes=${JSON.stringify(scopes)} 時算出來不是 ${HAND_CALC_DEFAULT}`,
    );
});

test("A2 ⚠️ 不傳 scopes 與傳空陣列，結果必須完全相同", () => {
  /*
   * 既有的呼叫端有幾十處，改版時是「最後一個參數選填」。
   * 漏加的地方會走 undefined 這條路——它必須與空陣列一模一樣，
   * 否則畫面上會出現兩種 PCU，而且看起來都很合理。
   */
  const record = roadRecord("115Q2", "R-01");
  assert.deepEqual(
    vehiclePcuByTarget(record, CORE, TURNS, []),
    vehiclePcuByTarget(record, CORE, TURNS, [], []),
  );
});

test("A3 ⚠️ 覆寫存在、但**這一筆不在範圍內**時也不可以變", () => {
  const scopes = [
    {
      quarter: "114Q1",
      roadId: ANY,
      factors: { core: { ...CORE, motorcycle: 9 }, coreTurns: TURNS },
    },
  ];
  assert.equal(
    sumVehiclePcu(roadRecord("115Q2", "R-01"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT,
    "別的季別的覆寫汙染了這一筆",
  );
});

/* ── B. 覆寫真的要生效 ─────────────────────────────────────── */

test("B1 (這一季, 全路段) 的覆寫要吃到", () => {
  const scopes = [
    {
      quarter: "115Q2",
      roadId: ANY,
      /* 機車 0.5 → 1.0，其餘不變：100×1 = 100，比原本多 50。 */
      factors: { core: { ...CORE, motorcycle: 1 }, coreTurns: TURNS },
    },
  ];
  assert.equal(
    sumVehiclePcu(roadRecord("115Q2", "R-01"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT + 50,
  );
});

test("B2 (全季別, 這一段) 的覆寫要吃到，其他路段不受影響", () => {
  const scopes = [
    {
      quarter: ANY,
      roadId: "R-01",
      factors: { core: { ...CORE, small: 2 }, coreTurns: TURNS },
    },
  ];
  /* 小型車 1 → 2：200×2 = 400，比原本多 200。 */
  assert.equal(
    sumVehiclePcu(roadRecord("115Q2", "R-01"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT + 200,
  );
  assert.equal(
    sumVehiclePcu(roadRecord("115Q2", "R-02"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT,
    "R-02 被 R-01 的覆寫汙染了",
  );
});

test("B3 季別優先：(季,*) 蓋過 (*,段)", () => {
  const scopes = [
    {
      quarter: ANY,
      roadId: "R-01",
      factors: { core: { ...CORE, motorcycle: 2 }, coreTurns: TURNS },
    },
    {
      quarter: "115Q2",
      roadId: ANY,
      factors: { core: { ...CORE, motorcycle: 1 }, coreTurns: TURNS },
    },
  ];
  /* 用 1.0（季別那一組），不是 2.0：100×1 = 100。 */
  assert.equal(
    sumVehiclePcu(roadRecord("115Q2", "R-01"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT + 50,
  );
  /* 但別的季度的 R-01 仍然吃到 (*, R-01) 的 2.0：100×2 = 200，多 150。 */
  assert.equal(
    sumVehiclePcu(roadRecord("114Q1", "R-01"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT + 150,
  );
});

/* ── C. 轉向係數也要跟著範圍走 ─────────────────────────────── */

/** 一筆路口轉向格式的模擬紀錄。⚠️ 模擬資料。 */
const turnRecord = (quarter, roadId) => ({
  quarter,
  roadId,
  motorcycle: 0,
  small: 0,
  large: 0,
  special: 0,
  surveyType: "intersection",
  turnData: {
    motorcycle: { left: 10, through: 20, right: 30 },
  },
});

test("C1 路口格式讀的是轉向係數，覆寫要吃到轉向那一組", () => {
  /* 預設：10×0.5 + 20×0.3 + 30×0.4 = 5 + 6 + 12 = 23 */
  assert.equal(
    sumVehiclePcu(turnRecord("115Q2", "R-01"), CORE, TURNS, []),
    23,
  );
  const scopes = [
    {
      quarter: "115Q2",
      roadId: ANY,
      factors: {
        core: CORE,
        coreTurns: {
          ...TURNS,
          motorcycle: { through: 1, right: 1, left: 1 },
        },
      },
    },
  ];
  /* 覆寫後：10×1 + 20×1 + 30×1 = 60 */
  assert.equal(
    sumVehiclePcu(turnRecord("115Q2", "R-01"), CORE, TURNS, [], scopes),
    60,
  );
});

test("C2 ⚠️ 一般係數與轉向係數必須來自**同一組**覆寫", () => {
  /*
   * 拆開解析的話會出現「一般係數用這一季的、轉向係數用預設的」，
   * 兩個數字各自都合理，合起來卻不是任何一組標準。
   */
  const scopes = [
    {
      quarter: "115Q2",
      roadId: ANY,
      factors: {
        core: { ...CORE, motorcycle: 7 },
        coreTurns: { ...TURNS, motorcycle: { through: 7, right: 7, left: 7 } },
      },
    },
  ];
  const applied = factorsForRecord(
    roadRecord("115Q2", "R-01"),
    CORE,
    TURNS,
    scopes,
  );
  assert.equal(applied.core.motorcycle, 7);
  assert.equal(applied.coreTurns.motorcycle.through, 7);
});

/* ── D. 同一筆紀錄的所有車種必須用同一組係數 ───────────────── */

test("D1 ⚠️ 同一筆紀錄不可以出現「不同車種用了不同組係數」", () => {
  /*
   * 解析若被放進逐車種的迴圈裡，而且不小心把 sourceKey 混進條件，
   * 就會發生這件事。那種錯無聲無息：總量只是「有點不一樣」。
   *
   * 驗法：把覆寫的每一個車種都乘以同一個倍數，
   * 結果必須剛好是預設結果的同一個倍數。任何一個車種漏掉都對不上。
   */
  const K = 3;
  const scopes = [
    {
      quarter: "115Q2",
      roadId: ANY,
      factors: {
        core: Object.fromEntries(
          Object.entries(CORE).map(([key, value]) => [key, value * K]),
        ),
        coreTurns: TURNS,
      },
    },
  ];
  assert.equal(
    sumVehiclePcu(roadRecord("115Q2", "R-01"), CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT * K,
  );
});

/* ── E. 自訂車種不受範圍影響（目前的設計） ─────────────────── */

test("E1 自訂車種讀的仍是它自己的設定，不吃範圍覆寫", () => {
  /*
   * ⚠️ 這是**目前的設計**，寫下來是為了讓它變成有意識的選擇：
   *   覆寫的是「四大類的當量標準」，而自訂車種的係數是使用者在
   *   「車種分類與新增當量」裡逐一填的，本來就與四大類標準無關。
   *   日後若要讓自訂車種也能依範圍覆寫，這一條會紅——那時要一起想清楚
   *   摘要與衝突提示怎麼呈現，不要默默改掉。
   */
  const settings = [
    {
      projectId: "P-1",
      sourceKey: "custom:大貨車",
      sourceLabel: "大貨車",
      targetKey: "custom:大貨車",
      targetLabel: "大貨車",
      roadPcu: 2,
      turnPcu: { left: 2, through: 2, right: 2 },
    },
  ];
  const record = {
    /* ⚠️ 一定要帶 projectId：settingFor() 是用它比對的，
       漏了的話這一筆會找不到設定、算出 0，而測試會誤以為是覆寫沒生效。 */
    projectId: "P-1",
    quarter: "115Q2",
    roadId: "R-01",
    motorcycle: 0,
    small: 0,
    large: 0,
    special: 0,
    surveyType: "road",
    vehicleCounts: { "custom:大貨車": 50 },
  };
  const scopes = [
    {
      quarter: "115Q2",
      roadId: ANY,
      factors: { core: { ...CORE, motorcycle: 99 }, coreTurns: TURNS },
    },
  ];
  /* 50 × 2 = 100，不論有沒有覆寫。 */
  assert.equal(sumVehiclePcu(record, CORE, TURNS, settings), 100);
  assert.equal(sumVehiclePcu(record, CORE, TURNS, settings, scopes), 100);
});

/* ── F. 缺欄位時要安全落回預設 ─────────────────────────────── */

test("F1 ⚠️ 紀錄沒有 quarter／roadId 時要落回計畫預設，不可以誤命中", () => {
  /*
   * 舊備份、測試用的簡化物件都可能沒有這兩個欄位。
   * 若把 undefined 當成萬用字元去比對，那些紀錄會誤中任何一筆覆寫。
   */
  const record = {
    motorcycle: 100,
    small: 200,
    large: 40,
    special: 10,
    surveyType: "road",
  };
  const scopes = [
    {
      quarter: "115Q2",
      roadId: "R-01",
      factors: { core: { ...CORE, motorcycle: 99 }, coreTurns: TURNS },
    },
  ];
  assert.equal(
    sumVehiclePcu(record, CORE, TURNS, [], scopes),
    HAND_CALC_DEFAULT,
  );
});
