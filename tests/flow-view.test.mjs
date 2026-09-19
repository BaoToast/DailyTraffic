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
  /*
   * ⚠️ 2026-09-13：「駛出目的支線」（leftTarget/throughTarget/rightTarget）
   *   已整組移除，轉向歸屬只認 routes。原本這裡列的是那三個欄位壞掉的各種情況，
   *   現在改列**轉向判定**壞掉的各種情況——同一條鐵律，換成新的來源。
   */
  [
    "舊版存的駛出目的支線指向不存在的支線（legacy 欄位已不生效）",
    armSettings((c) => (c === "A" ? { leftTarget: "Z" } : {})),
  ],
  [
    "舊版存的駛出目的支線指向自己（legacy 欄位已不生效）",
    armSettings((c) => (c === "A" ? { leftTarget: "A" } : {})),
  ],
  [
    "A 的三個去向全被判成左轉（同一轉向對到 3 支）",
    armSettings((c) =>
      c === "A" ? { routes: { B: "left", C: "left", D: "left" } } : {},
    ),
  ],
  [
    "每一支線的每一個去向都被判成直行（每個轉向都對到 3 支）",
    armSettings(() => ({
      routes: Object.fromEntries(ARMS.map((code) => [code, "through"])),
    })),
  ],
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

/*
 * ⚠️ 這一條是新規則的**行為證明**，不是只驗總量。
 *
 * 使用者 2026-09-13：「如果出現程式判讀有 2 支線落進同一個轉向，
 *   一定是判讀失誤……」——所以系統**不可以自己挑一支**。
 * 舊版的 bestMovementTarget() 會默默挑角度最接近的那一支，
 * 於是這個情境下車流會被分配到某一支上，UNMAPPED 是空的。
 * 現在必須全部落在「未指定駛入路口」。
 */
test("每個轉向都對到多支時，車流全部落到「未指定駛入路口」而不是被系統挑一支", () => {
  const records = makeRecords();
  const derived = deriveDestinationIntersectionRecords(
    records,
    "P1",
    armSettings(() => ({
      routes: Object.fromEntries(ARMS.map((code) => [code, "through"])),
    })),
  );
  const unmapped = derived.filter((r) => r.directionCode === "UNMAPPED");
  assert.ok(unmapped.length > 0, "應該要有『未指定駛入路口』的紀錄");
  assert.ok(
    Math.abs(sumAll(unmapped) - sumAll(records)) < 1e-9,
    "每個轉向都對不出唯一目的地時，全部車流都應該落在未指定，而不是部分被系統挑走",
  );
  assert.equal(
    derived.filter((r) => r.directionCode !== "UNMAPPED").length,
    0,
    "不可以有任何一筆被分配到具體支線——那代表系統又在自己挑",
  );
});

/*
 * 反面：三支都判成左轉時，也不可以挑。
 * 這一條和上面那條的差別是「只有一支線壞掉」，其餘支線照常分配——
 * 證明壞掉的範圍不會外溢。
 */
test("只有一支線的轉向判定壞掉時，其餘支線照常分配，總量仍守恆", () => {
  const records = makeRecords();
  const derived = deriveDestinationIntersectionRecords(
    records,
    "P1",
    armSettings((c) =>
      c === "A" ? { routes: { B: "left", C: "left", D: "left" } } : {},
    ),
  );
  const unmapped = derived.filter((r) => r.directionCode === "UNMAPPED");
  assert.ok(unmapped.length > 0, "壞掉那一支的車流要落在未指定");
  assert.ok(
    sumAll(unmapped) < sumAll(records),
    "其餘支線應該照常分配，不可以整批落到未指定",
  );
  assert.ok(
    Math.abs(sumAll(derived) - sumAll(records)) < 1e-9,
    "總量仍然必須守恆",
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
