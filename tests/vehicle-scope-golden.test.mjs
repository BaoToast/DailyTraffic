/*
 * ══════════════════════════════════════════════════════════════════════
 *  車種歸類支援「季別×路段」覆寫——**沒有覆寫時逐位元不變**的黃金值
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 裁示做 B2（車種歸類可以依季別／路段覆寫），
 * 並且交代：
 *   「務必確認功能正常，且**沒影響到其他功能**」
 *   「這功能**用到的情況很低，所以很難被回頭發現做錯**……
 *     所以更要確保功能和計算的正確性」
 *
 * ⚠️ 「極少用到」是**提高**驗證標準的理由，不是降低：
 *   沒有人會用到的路徑出錯時，沒有人會踩到、也沒有人會回報。
 *
 * ── 這一支是什麼 ──────────────────────────────────────────────
 *
 * 下面那一串期望值是**動手改 `settingFor()` 之前**，在同一份輸入上
 * 實際跑出來的輸出（2026-09-30 擷取，SHA-256 一起釘住）。
 * 也就是「舊行為的黃金值」。
 *
 * 只要**沒有任何一筆設定帶季別或路段**，新版的輸出就必須與這一串
 * **逐位元相同**——這是使用者那句「不要影響到數值正確性」的可驗證版本。
 *
 * ⚠️ 這串期望值**不可以因為測試變紅就改掉**。它紅了代表既有行為被動到，
 *   要改的是程式，不是期望值。真的要改口徑，先問使用者。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  effectiveVehicleCounts,
  effectiveVehicleLabel,
  missingVehicleFactors,
  settingFor,
  sumVehicleCounts,
  sumVehiclePcu,
  vehicleCatalog,
} from "../app/vehicle-analysis.ts";

const CORE = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const CORE_TURNS = {
  motorcycle: { through: 0.3, right: 0.4, left: 0.5 },
  small: { through: 1, right: 1.3, left: 1.5 },
  large: { through: 1.5, right: 2, left: 2.3 },
  special: { through: 2, right: 2.3, left: 2.5 },
};

/**
 * 三筆紀錄：兩季、兩條路段，其中一筆走路口轉向格式（轉向係數是另一條分支）。
 * ⚠️ 站號與路段代號都是假的（R1／R2），不是真實站號。
 */
function records() {
  return [
    {
      projectId: "P1",
      quarter: "115Q1",
      roadId: "R1",
      motorcycle: 100,
      small: 200,
      large: 30,
      special: 5,
      vehicleCounts: { "custom:聯結車": 7, "custom:大客車": 3 },
      vehicleLabels: { "custom:聯結車": "聯結車", "custom:大客車": "大客車" },
    },
    {
      projectId: "P1",
      quarter: "115Q2",
      roadId: "R1",
      motorcycle: 110,
      small: 190,
      large: 28,
      special: 4,
      vehicleCounts: { "custom:聯結車": 9 },
      vehicleLabels: { "custom:聯結車": "聯結車" },
    },
    {
      projectId: "P1",
      quarter: "115Q2",
      roadId: "R2",
      motorcycle: 50,
      small: 80,
      large: 12,
      special: 1,
      surveyType: "intersection",
      turnData: {
        motorcycle: { left: 10, through: 30, right: 10 },
        small: { left: 20, through: 40, right: 20 },
        large: { left: 2, through: 8, right: 2 },
        special: { left: 0, through: 1, right: 0 },
        "custom:聯結車": { left: 1, through: 2, right: 1 },
      },
      vehicleCounts: { "custom:聯結車": 4 },
      vehicleLabels: { "custom:聯結車": "聯結車" },
    },
  ];
}

/** 計畫層級的歸類設定：**沒有季別也沒有路段**（＝改版前唯一的寫法）。 */
function plainSettings() {
  return [
    {
      projectId: "P1",
      sourceKey: "custom:聯結車",
      sourceLabel: "聯結車",
      targetKey: "special",
      targetLabel: "特種車",
      roadPcu: 2.5,
      turnPcu: { left: 2.5, through: 2, right: 2.3 },
    },
    {
      projectId: "P1",
      sourceKey: "custom:大客車",
      sourceLabel: "大客車",
      targetKey: "custom:大客車",
      targetLabel: "大客車",
      roadPcu: 1.8,
      turnPcu: { left: 2.1, through: 1.8, right: 1.9 },
    },
  ];
}

/** 把所有下游的輸出串成一份可以逐位元比較的字串。 */
function snapshot(settings) {
  const out = [];
  for (const record of records()) {
    out.push(effectiveVehicleCounts(record, settings));
    out.push(sumVehicleCounts(record));
    out.push(sumVehiclePcu(record, CORE, CORE_TURNS, settings));
    out.push(effectiveVehicleLabel(record, "special", settings));
    out.push(settingFor(record, "custom:聯結車", settings)?.targetKey ?? null);
  }
  out.push(vehicleCatalog(records(), settings));
  out.push(missingVehicleFactors(records(), settings));
  out.push(missingVehicleFactors(records(), []));
  return JSON.stringify(out);
}

/* 2026-09-30 動手前擷取的黃金值（原文，不是重算的）。 */
const GOLDEN =
  '[{"special":7,"custom:大客車":3},10,22.9,"特種車","special",' +
  '{"special":9},9,22.5,"特種車","special",' +
  '{"special":4},4,8.8,"特種車","special",' +
  '[{"key":"motorcycle","label":"機車"},{"key":"small","label":"小型車"},' +
  '{"key":"large","label":"大型車"},{"key":"special","label":"特種車"},' +
  '{"key":"custom:大客車","label":"大客車"}],[],' +
  '[{"key":"custom:聯結車","label":"聯結車"},{"key":"custom:大客車","label":"大客車"}]]';
const GOLDEN_SHA = "3d9fac4294063e18c46e85c4a4a498e042418c31e49b9f8316e8700ba8521551";

test("⚠️ 黃金值自己沒有被改過（字串與雜湊必須相符）", () => {
  assert.equal(
    createHash("sha256").update(GOLDEN).digest("hex"),
    GOLDEN_SHA,
    "黃金值字串與雜湊不一致——有人改了期望值。期望值是 2026-09-30 動手前的實測輸出，不可以為了讓測試變綠而改它",
  );
});

test("沒有任何季別／路段覆寫時，所有下游輸出與改版前逐位元相同", () => {
  assert.equal(
    snapshot(plainSettings()),
    GOLDEN,
    "既有行為被動到了。B2 的界線是「沒有覆寫時走完全相同的路」",
  );
});

test("設定上的 quarter／roadId 是空字串或 undefined 時，等同於沒有寫", () => {
  /*
   * ⚠️ 這一條是為了存檔相容：舊的存檔沒有這兩個欄位，
   *   讀進來會是 undefined；使用者在畫面上選「全季別／全路段」則會是空字串。
   *   兩種都必須落回計畫預設，不可以變成「找不到設定」而讓車種掉成未分類。
   */
  const undef = plainSettings();
  const empty = plainSettings().map((item) => ({
    ...item,
    quarter: "",
    roadId: "",
  }));
  assert.equal(snapshot(undef), GOLDEN);
  assert.equal(snapshot(empty), GOLDEN, "空字串必須與沒有這個欄位一樣");
});

test("⚠️ 反證：黃金值比較真的在比（把一筆設定改掉就必須轉紅）", () => {
  /*
   * 沒有這一條的話，snapshot() 寫成 `return GOLDEN` 也會全綠。
   */
  const tampered = plainSettings().map((item) =>
    item.sourceKey === "custom:聯結車" ? { ...item, targetKey: "large" } : item,
  );
  assert.notEqual(
    snapshot(tampered),
    GOLDEN,
    "把聯結車改歸到大型車，輸出竟然沒變——那上面兩條是恆綠的",
  );
});
