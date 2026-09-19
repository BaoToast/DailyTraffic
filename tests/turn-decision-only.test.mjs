/*
 * ══════════════════════════════════════════════════════════════════════
 *  「起點 → 終點轉向判定」是唯一依據；「駛出目的支線」整組拿掉
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（兩則，後面那則把前面的前提推翻）：
 *
 *   「1.「起點→終點轉向判定」當唯一依據，「駛出目的支線」整組拿掉。我同意
 *     目前使用者就已經能協助系統正確判定左轉/直行/右轉分別進入哪個路口了，
 *     所以才給使用者手動修正設定的功能，**請不要只靠系統自動依照角度判定，
 *     有時會失真，而是以使用者判定為主**。預設是系統自動由角度判定，
 *     然後使用者手動修正做為複核，最後匯入資料。」
 *
 *   「如我所說，**調查員不可能在左轉有兩個以上路口時，只有一個左轉欄位帶過，
 *     這事情絕對不可能發生**。如果出現程式判讀有 2 支線落進同一個轉向，
 *     **一定是判讀失誤**，可以用醒目顏色提醒，或納入匯入異常事件給使用者看到。」
 *
 * ── 這一支釘住四件事 ────────────────────────────────────────────
 *
 *   一、改一支的角度**不會**抹掉別支線的人工修正（舊版會，而且無聲）。
 *   二、同一轉向對到 2 支以上 → 報異常，量進 UNMAPPED，**不可以自己挑一支**。
 *   三、某轉向有量卻 0 支對到 → 也要報異常（反面那一半，掉量更難發現）。
 *   四、「往X」格式的檔案**不可以**套這條規則（七岔本來就有多支同轉向）。
 *
 * ⚠️ 假通過陷阱：
 *   一、只驗「有回傳衝突清單」不夠——回傳固定內容也會過。
 *       所以每一條都要驗**是哪一支線的哪一個轉向**、以及量對不對。
 *   二、沒有車量的轉向不可以報。三岔路口本來就缺一個轉向（調查表寫 `--`），
 *       報了會變成整片假警告——這一條要有正面測資證明它不報。
 *   三、「角度重算不動人工格」若寫成「角度重算完全不做事」也會過，
 *       所以要同時驗**系統判定的格子真的跟著角度變了**。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  armTurnConflicts,
  buildArmSettings,
  classifyMovement,
  deriveDestinationIntersectionRecords,
  intersectionTurnConflicts,
  reclassifyArmRoutes,
  turnTargets,
} from "../app/intersection-flow.ts";

const PROJECT = "P1";
const ROAD = "R-01";
const ARMS = ["A", "B", "C", "D"];
const ANGLES = { A: -90, B: 0, C: 90, D: 180 };

function settingsFor(overrides = () => ({})) {
  return ARMS.map((code) => ({
    projectId: PROJECT,
    roadId: ROAD,
    directionCode: code,
    name: `路口${code}`,
    angle: ANGLES[code],
    routes: {},
    ...overrides(code),
  }));
}

/** 一支支線一個小時的紀錄（左直右格式）。 */
function record(code, { left = 0, through = 0, right = 0 } = {}) {
  const turns = { left, through, right };
  return {
    projectId: PROJECT,
    quarter: "115Q1",
    roadId: ROAD,
    roadName: "測試路口",
    dayType: "平日",
    directionCode: code,
    directionName: `駛出路口${code}`,
    hour: "07:00～08:00",
    motorcycle: left + through + right,
    small: 0,
    large: 0,
    special: 0,
    surveyType: "intersection",
    turnData: {
      motorcycle: turns,
      small: { left: 0, through: 0, right: 0 },
      large: { left: 0, through: 0, right: 0 },
      special: { left: 0, through: 0, right: 0 },
    },
    vehicleCounts: { motorcycle: left + through + right },
    vehicleLabels: { motorcycle: "機車" },
  };
}

/* ══════════════════════════════════════════════════════════════════
 * 一、以使用者判定為主：改角度不抹掉人工修正
 * ══════════════════════════════════════════════════════════════════ */

test("前置：預設是系統依角度判定，每一格都標成 angle", () => {
  const built = buildArmSettings(PROJECT, ROAD, ARMS, []);
  const a = built.find((s) => s.directionCode === "A");
  assert.deepEqual(
    Object.keys(a.routes).sort(),
    ["B", "C", "D"],
    "A 應該對其餘三支都有判定",
  );
  for (const code of ["B", "C", "D"])
    assert.equal(a.routeSources[code], "angle", `${code} 應該標成系統判定`);
  /* 而且判定值真的來自角度，不是寫死的 */
  assert.equal(a.routes.C, classifyMovement(ANGLES.A, ANGLES.C));
});

test("改 B 的角度，不會抹掉 A 身上人工修正過的格子", () => {
  /*
   * ⚠️ 舊版 updateArmAngle() 是把**整個路口所有支線**的 routes 全部重建，
   *   所以動 B 的角度會把 A→C 的人工修正一起清掉，而且畫面上沒有任何提示。
   */
  const manual = settingsFor((code) =>
    code === "A"
      ? {
          routes: { B: "left", C: "left", D: "right" },
          routeSources: { B: "angle", C: "manual", D: "angle" },
        }
      : {},
  );
  const moved = manual.map((s) =>
    s.directionCode === "B" ? { ...s, angle: 45 } : s,
  );
  const next = reclassifyArmRoutes(moved);
  const a = next.find((s) => s.directionCode === "A");

  assert.equal(a.routes.C, "left", "人工修正過的 A→C 必須原封不動");
  assert.equal(a.routeSources.C, "manual", "而且仍然標成人工");

  /*
   * ⚠️ 反面的另一半：若寫成「什麼都不重算」也會讓上面那一條變綠。
   *   所以要證明**系統判定的格子真的跟著角度走了**。
   */
  assert.equal(
    a.routes.B,
    classifyMovement(ANGLES.A, 45),
    "標成 angle 的 A→B 必須依新角度重算",
  );
  assert.notEqual(
    a.routes.B,
    manual.find((s) => s.directionCode === "A").routes.B,
    "測資要讓 A→B 的判定真的改變，否則這一條恆真",
  );
});

test("「依角度重新判定」按鈕（force）連人工格也一起重算", () => {
  const manual = settingsFor((code) =>
    code === "A"
      ? { routes: { C: "left" }, routeSources: { C: "manual" } }
      : {},
  );
  const next = reclassifyArmRoutes(manual, true);
  const a = next.find((s) => s.directionCode === "A");
  assert.equal(a.routes.C, classifyMovement(ANGLES.A, ANGLES.C));
  assert.equal(a.routeSources.C, "angle");
});

test("舊版「駛出目的支線」存過的值，會被當成人工判定併進轉向判定", () => {
  /*
   * 使用者問過「以前手動指定過的值會不再生效是什麼情況」。
   * 答案：那一格當年是使用者自己選的，所以併進來、標成 manual，
   * 不會被下一次角度重算蓋掉；但它不再是獨立的一層資料來源。
   */
  const built = buildArmSettings(PROJECT, ROAD, ARMS, [
    {
      projectId: PROJECT,
      roadId: ROAD,
      directionCode: "A",
      name: "路口A",
      angle: ANGLES.A,
      routes: {},
      leftTarget: "C",
    },
  ]);
  const a = built.find((s) => s.directionCode === "A");
  assert.equal(a.routes.C, "left", "舊的左轉駛出＝C 要變成 A→C 判定為左轉");
  assert.equal(a.routeSources.C, "manual");
  assert.ok(
    !("leftTarget" in a),
    "輸出裡不可以再帶著 legacy 欄位——那一層已經不存在了",
  );
});

/* ══════════════════════════════════════════════════════════════════
 * 二、同一轉向對到 2 支以上：報異常，不可以自己挑
 * ══════════════════════════════════════════════════════════════════ */

test("同一轉向對到兩支 → 報異常，而且指得出是哪一支線的哪一個轉向", () => {
  const settings = settingsFor((code) =>
    code === "A" ? { routes: { B: "left", C: "left", D: "right" } } : {},
  );
  const rows = [record("A", { left: 512, right: 100 })];
  const conflicts = armTurnConflicts(settings, rows);

  assert.equal(conflicts.length, 1, `應該只有一筆衝突，實得 ${conflicts.length}`);
  const [conflict] = conflicts;
  assert.equal(conflict.directionCode, "A");
  assert.equal(conflict.turn, "left");
  assert.equal(conflict.kind, "ambiguous");
  assert.deepEqual(conflict.targets.sort(), ["B", "C"]);
  assert.equal(conflict.volume, 512, "量要是該轉向整季的實際車量");
});

test("衝突的量全部進「未指定駛入路口」，不可以被系統挑給其中一支", () => {
  const settings = settingsFor((code) =>
    code === "A" ? { routes: { B: "left", C: "left", D: "right" } } : {},
  );
  const derived = deriveDestinationIntersectionRecords(
    [record("A", { left: 512 })],
    PROJECT,
    settings,
  );
  const unmapped = derived.filter((r) => r.directionCode === "UNMAPPED");
  assert.equal(unmapped.length, 1);
  assert.equal(unmapped[0].vehicleCounts.motorcycle, 512);
  assert.equal(
    derived.filter((r) => r.directionCode !== "UNMAPPED").length,
    0,
    "不可以有任何一筆落到 B 或 C——那代表系統又在自己挑",
  );
});

/* ══════════════════════════════════════════════════════════════════
 * 三、反面那一半：有量卻 0 支對到
 * ══════════════════════════════════════════════════════════════════ */

test("某轉向有車量、卻沒有任何支線被判成它 → 也要報異常", () => {
  const settings = settingsFor((code) =>
    code === "A" ? { routes: { B: "left", C: "left", D: "left" } } : {},
  );
  /* A 全部去向都判成左轉，於是「右轉」量到的 300 輛無處可去。 */
  const conflicts = armTurnConflicts(settings, [
    record("A", { left: 100, right: 300 }),
  ]);
  const unreachable = conflicts.filter((c) => c.kind === "unreachable");
  assert.equal(unreachable.length, 1);
  assert.equal(unreachable[0].turn, "right");
  assert.equal(unreachable[0].volume, 300);
  assert.deepEqual(unreachable[0].targets, []);
});

test("沒有車量的轉向不可以報異常（三岔路口本來就缺一個轉向）", () => {
  /*
   * ⚠️ 這一條是防假警告的**正面**測資。
   *   真實三岔調查表在不存在的那個轉向寫 `--`，量是 0；
   *   若把 0 也報出來，使用者每開一個三岔路口都會看到紅字。
   */
  const threeArm = ["A", "B", "C"].map((code) => ({
    projectId: PROJECT,
    roadId: ROAD,
    directionCode: code,
    name: `路口${code}`,
    angle: { A: -90, B: 0, C: 180 }[code],
    routes: {},
  }));
  const built = buildArmSettings(PROJECT, ROAD, ["A", "B", "C"], threeArm);
  /* A 只有左轉與直行有量，右轉是 0（調查表上的 `--`）。 */
  const conflicts = armTurnConflicts(built, [
    record("A", { left: 120, through: 80, right: 0 }),
  ]);
  const zeroVolume = conflicts.filter((c) => c.volume === 0);
  assert.deepEqual(zeroVolume, [], "量為 0 的轉向不可以出現在衝突清單裡");
});

/* ══════════════════════════════════════════════════════════════════
 * 四、「往X」格式不可以套這條規則
 * ══════════════════════════════════════════════════════════════════ */

test("目的地逐欄記錄（往B、往C…）的檔案，多支同轉向是正常的，不報異常", () => {
  /*
   * 使用者的七岔真實檔就是這個格式：A 的左轉同時通往 B、C，
   * 而且各自多少量檔案裡都寫明了——完全沒有歧義。
   * 套上這條規則的話，那個路口會整片假紅字。
   */
  const settings = settingsFor((code) =>
    code === "A" ? { routes: { B: "left", C: "left", D: "right" } } : {},
  );
  /*
   * ⚠️ 四支支線都要有紀錄：buildArmSettings() 的支線清單是從紀錄推出來的，
   *   只放一支的話整個路口會被當成「不足兩支」跳過，
   *   下面的前置檢查就會因為別的理由而綠——那是假通過。
   */
  const turnFormatRows = [
    record("A", { left: 512, right: 100 }),
    record("B", { left: 30, through: 40, right: 50 }),
    record("C", { left: 30, through: 40, right: 50 }),
    record("D", { left: 30, through: 40, right: 50 }),
  ];
  const destinationRows = turnFormatRows.map((row, index) => ({
    ...row,
    destinationCounts:
      index === 0
        ? { motorcycle: { B: 300, C: 212, D: 100 } }
        : { motorcycle: { A: 120 } },
  }));
  const conflicts = intersectionTurnConflicts(
    destinationRows,
    PROJECT,
    settings,
  );
  assert.deepEqual(conflicts, [], "往X 格式一筆衝突都不該報");

  /* ⚠️ 前置：同一組設定在左直右格式下**必須**報得出來，證明不是恆不報。 */
  const sameSettingsTurnFormat = intersectionTurnConflicts(
    turnFormatRows,
    PROJECT,
    settings,
  );
  assert.ok(
    sameSettingsTurnFormat.length > 0,
    "同一組設定在左直右格式下要報得出衝突，否則上面那一條是恆真",
  );
});

/* ══════════════════════════════════════════════════════════════════
 * 五、turnTargets 本身
 * ══════════════════════════════════════════════════════════════════ */

test("turnTargets 如實回報「有幾支」，不像舊版默默挑一支", () => {
  const settings = settingsFor((code) =>
    code === "A" ? { routes: { B: "left", C: "left", D: "right" } } : {},
  );
  const a = settings.find((s) => s.directionCode === "A");
  assert.equal(turnTargets(a, settings, "left").length, 2);
  assert.equal(turnTargets(a, settings, "right").length, 1);
  assert.equal(turnTargets(a, settings, "through").length, 0);
});
