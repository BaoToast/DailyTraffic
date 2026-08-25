/*
 * 「駛出／駛入」這兩個視角的兩條鐵律。
 *
 * 起因：使用者回報同一個路口在兩個視角下的合計不一樣（駛入 28,011、
 * 駛出 27,987），而且不論選哪一個視角，調查點欄位都寫著「（駛出）」。
 *
 * 鐵律一：駛入只是把同一批車重新分組（依終點而不是起點），
 *         **總量不可以改變**。任何一種幾何設定都一樣。
 * 鐵律二：每一列都要帶著自己是用哪一種視角算出來的，
 *         不能讓畫面退回去用工具列的視角來標示。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { deriveDestinationIntersectionRecords } from "../app/intersection-flow.ts";
import { rawVehicleCounts } from "../app/vehicle-analysis.ts";

const ARMS = ["A", "B", "C", "D"];
const ANGLES = [-90, 0, 90, 180];

/** 造一個四叉路口、兩個小時、四車種的最小資料。 */
function makeRecords() {
  const rows = [];
  for (const [armIndex, code] of ARMS.entries()) {
    for (const hour of ["07:00～08:00", "08:00～09:00"]) {
      const base = (armIndex + 1) * 10 + (hour.startsWith("07") ? 0 : 5);
      const turnData = {
        motorcycle: { left: base + 0.36, through: base * 2, right: base / 3 },
        small: { left: base * 1.5, through: base * 3, right: base + 0.55 },
        large: { left: 0, through: base / 7, right: 0 },
        special: { left: 0, through: 0, right: 0 },
        "custom:聯結車": { left: 0.25, through: base / 11, right: 0 },
      };
      const vehicleCounts = {};
      for (const [key, turns] of Object.entries(turnData)) {
        const sum = turns.left + turns.through + turns.right;
        if (sum) vehicleCounts[key] = sum;
      }
      rows.push({
        projectId: "P1",
        quarter: "115Q2",
        roadId: "R-01",
        roadName: "測試路口",
        dayType: "平日",
        directionCode: code,
        directionName: `駛出路口${code}`,
        hour,
        motorcycle: vehicleCounts.motorcycle ?? 0,
        small: vehicleCounts.small ?? 0,
        large: vehicleCounts.large ?? 0,
        special: 0,
        surveyType: "intersection",
        turnData,
        vehicleCounts,
        vehicleLabels: { motorcycle: "機車", small: "小型車", large: "大型車", "custom:聯結車": "聯結車" },
      });
    }
  }
  return rows;
}

const sumAll = (records) =>
  records.reduce(
    (sum, record) =>
      sum + Object.values(record.vehicleCounts ?? {}).reduce((a, b) => a + b, 0),
    0,
  );

const armSettings = (extra = () => ({})) =>
  ARMS.map((code, index) => ({
    projectId: "P1",
    roadId: "R-01",
    directionCode: code,
    name: `路口${code}`,
    angle: ANGLES[index],
    routes: {},
    ...extra(code),
  }));

/*
 * 每一種情境的總量都必須完全相等。
 * 這裡刻意把「目的支線設定壞掉」的各種情況都列出來——那些情況會讓車流落到
 * 「未指定駛入路口」，那是可以接受的（畫面會提示），**但總量仍然不能變**。
 * 使用者回報的正是「駛入比駛出多 24 輛」，若哪天真的變成這樣，這一支會失敗。
 */
const SCENARIOS = [
  ["沒有任何已存幾何設定", []],
  ["三個目的支線都存成空字串", armSettings(() => ({ leftTarget: "", throughTarget: "", rightTarget: "" }))],
  ["只有 A 的左轉目的地是空的", armSettings((c) => (c === "A" ? { leftTarget: "" } : {}))],
  ["A 的左轉指向不存在的支線", armSettings((c) => (c === "A" ? { leftTarget: "Z" } : {}))],
  ["A 的左轉指向自己", armSettings((c) => (c === "A" ? { leftTarget: "A" } : {}))],
];

for (const [name, settings] of SCENARIOS)
  test(`駛入是重新分組不是重新計算：${name}`, () => {
    const records = makeRecords();
    const origin = sumAll(records);
    const destination = sumAll(
      deriveDestinationIntersectionRecords(records, "P1", settings),
    );
    assert.ok(
      Math.abs(destination - origin) < 1e-9,
      `駛入合計 ${destination} 與駛出合計 ${origin} 不相等，差 ${(destination - origin).toFixed(3)}`,
    );
  });

test("目的支線設定壞掉時，車流會落到「未指定駛入路口」而不是憑空消失", () => {
  const records = makeRecords();
  const derived = deriveDestinationIntersectionRecords(
    records,
    "P1",
    armSettings(() => ({ leftTarget: "", throughTarget: "", rightTarget: "" })),
  );
  const unmapped = derived.filter((r) => r.directionCode === "UNMAPPED");
  assert.ok(unmapped.length > 0, "應該要有『未指定駛入路口』的紀錄");
  assert.ok(
    Math.abs(sumAll(unmapped) - sumAll(records)) < 1e-9,
    "目的支線全部設定不出來時，全部車流都應該落在未指定，而不是部分消失",
  );
});

/*
 * ── 舊版匯入的紀錄 ──
 *
 * 使用者實際遇到的：舊版匯入時把四大類欄位四捨五入成整數存起來
 * （turnData 是 0.36＋11＋1＝12.36，欄位卻寫 12），而且沒有 vehicleCounts。
 * 於是（a）駛出合計用的是一堆四捨五入過的整數，全日機車 9,226 變成 9,228、
 * 特種車 51 變成 48；（b）駛入把「整數 − 精確值」的**正差額**補進
 * 「未指定駛入路口」，負的卻不扣，於是駛入比駛出多出 22 輛。
 */
function makeLegacyRecords() {
  return makeRecords().map((row) => {
    const legacy = { ...row };
    delete legacy.vehicleCounts;
    delete legacy.turnData["custom:聯結車"];
    for (const key of ["motorcycle", "small", "large", "special"]) {
      const turns = row.turnData[key];
      legacy[key] = Math.round(turns.left + turns.through + turns.right);
    }
    return legacy;
  });
}

test("舊版紀錄：車輛數取轉向明細的原始值，不是被四捨五入過的欄位", () => {
  const legacy = makeLegacyRecords();
  for (const record of legacy) {
    const counts = rawVehicleCounts(record);
    for (const key of ["motorcycle", "small", "large"]) {
      const exact =
        record.turnData[key].left +
        record.turnData[key].through +
        record.turnData[key].right;
      assert.ok(
        Math.abs(counts[key] - exact) < 1e-9,
        `${key} 應該取轉向明細的 ${exact}，卻拿到 ${counts[key]}（欄位是 ${record[key]}）`,
      );
    }
  }
});

test("舊版紀錄：駛入合計仍然等於駛出合計（不會被四捨五入的零頭灌水）", () => {
  const legacy = makeLegacyRecords();
  const origin = sumAll(legacy.map((r) => ({ ...r, vehicleCounts: rawVehicleCounts(r) })));
  const derived = deriveDestinationIntersectionRecords(legacy, "P1", []);
  const destination = sumAll(derived);
  assert.ok(
    Math.abs(destination - origin) < 1e-9,
    `駛入 ${destination.toFixed(3)} 與駛出 ${origin.toFixed(3)} 不相等，差 ${(destination - origin).toFixed(3)}`,
  );
  const unmapped = derived.filter((r) => r.directionCode === "UNMAPPED");
  assert.equal(
    unmapped.length,
    0,
    "轉向明細是完整的，不該因為四捨五入的零頭生出「未指定駛入路口」",
  );
});

test("真的只有總量、沒有轉向明細時，差額仍然要補進未指定", () => {
  /* 這是「未指定」原本就該處理的情況，門檻不可以把它一起擋掉。 */
  const rows = makeRecords().map((row) => ({
    ...row,
    vehicleCounts: { ...row.vehicleCounts, motorcycle: row.vehicleCounts.motorcycle + 30 },
  }));
  const derived = deriveDestinationIntersectionRecords(rows, "P1", []);
  const unmapped = derived.filter((r) => r.directionCode === "UNMAPPED");
  assert.ok(unmapped.length > 0, "少了轉向明細的 30 輛應該落到未指定");
  assert.ok(
    Math.abs(sumAll(derived) - sumAll(rows)) < 1e-9,
    "補進未指定之後總量仍然要守恆",
  );
});

test("每一列都要帶著自己的流量視角，不能退回去用工具列的視角", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  /*
   * 舊版寫成 `modes.length > 1 && row.surveyType === "intersection"`，
   * 也就是只有並列時才寫 flowLabel；單一視角時畫面會退回去用工具列的
   * intersectionFlowLabel。使用者回報：不論選駛入或駛出，名稱都寫（駛出）。
   */
  assert.doesNotMatch(
    source,
    /modes\.length > 1 && row\.surveyType === "intersection"\s*\?/,
    "flowLabel 不可以只在並列模式才設定",
  );
  assert.match(
    source,
    /row\.surveyType === "intersection"\s*\n?\s*\?\s*\{\s*\n?\s*\.\.\.row,\s*\n?\s*flowLabel,/,
    "每一列（不論單一或並列視角）都必須帶 flowLabel",
  );
});
