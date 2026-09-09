/*
 * 用調查表的橫線位置反推三岔路口的支線幾何。
 *
 * ── 為什麼要有這一支（實測出來的問題）─────────────────────────
 *
 * 三岔路口的**預設角度** defaultArmAngle(index, 3) 是 [-90, 0, 180]。
 * 用這組角度跑 bestMovementTarget()，缺口會落在
 *「A 沒有直進、B 沒有左轉、C 沒有右轉」。
 *
 * 但三份實際三岔調查檔寫的是**完全相反的一組**（測試只保留匿名結構）：
 *「A 沒有右轉、B 沒有直進、C 沒有左轉」。
 *
 * 對不起來的後果：A 的直進車流沒有目的地，整批被歸到 UNMAPPED
 *（畫面上的「未指定駛入路口」）。tests/three-arm-flow.test.mjs 量到的是
 * 某三岔路口 AM 5,831 輛裡有 3,612 輛、62% 掉進去——總量守恆，
 * 但 OD 歸屬是錯的。
 *
 * ── 這一支釘住什麼 ────────────────────────────────────────────
 *
 * 一、預設角度的缺口確實與真實調查檔相反（＝問題存在，不是我猜的）。
 * 二、反推得到的拓樸與真實調查檔一致，而且解是唯一的。
 * 三、用反推的角度與流向建支線設定後，**沒有任何轉向會掉進 UNMAPPED**。
 * 四、資訊不足時不可以硬給答案（回傳 null）。
 *
 * ⚠️ 假通過陷阱：
 *  一、只驗「反推得到某個結果」不夠——回傳一個固定字典也會過。
 *      所以第三項要實際跑 bestMovementTarget()，驗**行為**而不是資料長相。
 *  二、只驗三岔會過的話，可能寫成「無論如何都反推」。四岔沒有任何橫線時
 *      調查表提供不了額外資訊，解不只一組，一定要回 null。
 *  三、整欄空白不可以被當成「這個轉向存在」的證據——那是沒填，不是有。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  auditArmTurns,
  deriveArmRoutesFromSurvey,
  anglesMatchingRoutes,
  buildArmSettings,
  bestMovementTarget,
  defaultArmAngle,
} from "../app/intersection-flow.ts";

const TURNS = ["left", "through", "right"];

/** 一支支線的紀錄；absent 是整欄畫橫線的轉向，blank 是整欄空白的。 */
function arm(directionCode, { absent = null, blank = null } = {}) {
  const tally = {};
  for (const turn of TURNS)
    tally[turn] =
      turn === absent
        ? { numeric: 0, placeholder: 12 }
        : turn === blank
          ? { numeric: 0, placeholder: 0 }
          : { numeric: 12, placeholder: 0 };
  return {
    roadId: "R1",
    directionCode,
    surveyType: "intersection",
    turnTally: tally,
  };
}

/** 真實三岔形狀：A 無右轉、B 無直進、C 無左轉。 */
const realThreeArm = [
  arm("A", { absent: "right" }),
  arm("B", { absent: "through" }),
  arm("C", { absent: "left" }),
];

function missingTargets(settings) {
  return settings.flatMap((setting) =>
    TURNS.filter((turn) => !bestMovementTarget(setting, settings, turn)).map(
      (turn) => `${setting.directionCode}/${turn}`,
    ),
  );
}

test("預設角度推出來的缺口，與真實三岔調查檔相反（問題確實存在）", () => {
  const settings = buildArmSettings("P", "R1", ["A", "B", "C"], []);
  assert.deepEqual(
    settings.map((setting) => setting.angle),
    [defaultArmAngle(0, 3), defaultArmAngle(1, 3), defaultArmAngle(2, 3)],
  );
  /* 預設幾何認為缺的是 A 直進、B 左轉、C 右轉 */
  assert.deepEqual(missingTargets(settings).sort(), [
    "A/through",
    "B/left",
    "C/right",
  ]);
  /* 而調查表寫的缺口是 A 右轉、B 直進、C 左轉——兩組完全不同 */
  const audits = auditArmTurns(realThreeArm, "R1");
  assert.deepEqual(
    audits.map((audit) => `${audit.directionCode}/${audit.absent[0]}`),
    ["A/right", "B/through", "C/left"],
  );
});

test("三岔的算術盤點：每支印 3 欄、只能去 2 個地方、應缺 1 個", () => {
  for (const audit of auditArmTurns(realThreeArm, "R1")) {
    assert.equal(audit.movementCount, 3, audit.directionCode);
    assert.equal(audit.destinationCount, 2, audit.directionCode);
    assert.equal(audit.expectedAbsent, 1, audit.directionCode);
    assert.equal(audit.absent.length, 1, audit.directionCode);
  }
});

test("反推出來的拓樸與調查表一致，而且是唯一解", () => {
  const routes = deriveArmRoutesFromSurvey(auditArmTurns(realThreeArm, "R1"));
  assert.ok(routes, "三岔應該解得出來");
  assert.deepEqual(routes, {
    A: { B: "left", C: "through" },
    B: { C: "left", A: "right" },
    C: { A: "through", B: "right" },
  });
  /* 對稱性自我檢查：A 直進到 C ⇔ C 直進到 A；A 左轉到 B ⇔ B 右轉到 A */
  assert.equal(routes.A.C, "through");
  assert.equal(routes.C.A, "through");
  assert.equal(routes.A.B, "left");
  assert.equal(routes.B.A, "right");
});

test("反推的角度重現同一組轉向，而且與預設角度不同", () => {
  const routes = deriveArmRoutesFromSurvey(auditArmTurns(realThreeArm, "R1"));
  const angles = anglesMatchingRoutes(routes);
  assert.ok(angles, "應該找得到一組角度");
  /* 預設是 C=180，反推出來是 C=90——差別就在這裡 */
  assert.notEqual(angles.C, defaultArmAngle(2, 3));
});

test("套用反推結果之後，沒有任何轉向會掉進 UNMAPPED", () => {
  const audits = auditArmTurns(realThreeArm, "R1");
  const routes = deriveArmRoutesFromSurvey(audits);
  const angles = anglesMatchingRoutes(routes);
  const saved = ["A", "B", "C"].map((code) => ({
    projectId: "P",
    roadId: "R1",
    directionCode: code,
    name: `路口${code}`,
    angle: angles[code],
    routes: routes[code],
  }));
  const settings = buildArmSettings("P", "R1", ["A", "B", "C"], saved);
  /*
   * 這裡驗的是**行為**：真的存在的轉向（A 左轉、A 直進、B 左轉、B 右轉、
   * C 直進、C 右轉）每一個都要有目的地；沒有目的地的只能是調查表寫橫線的
   * 那三個。這樣就算日後有人把反推函式改成回傳固定字典也擋得住。
   */
  assert.deepEqual(missingTargets(settings).sort(), [
    "A/right",
    "B/through",
    "C/left",
  ]);
});

test("四岔沒有任何橫線時資訊不足，不可以硬給答案", () => {
  const fourArm = ["A", "B", "C", "D"].map((code) => arm(code));
  const audits = auditArmTurns(fourArm, "R1");
  for (const audit of audits) {
    assert.equal(audit.destinationCount, 3);
    assert.equal(audit.expectedAbsent, 0);
    assert.deepEqual(audit.absent, []);
  }
  assert.equal(
    deriveArmRoutesFromSurvey(audits),
    null,
    "四岔全部都有數字時無從反推，必須回 null",
  );
});

test("整欄空白不算成橫線，但算術仍指得出來時可以反推", () => {
  /*
   * A 的右轉是空白（沒填）而不是橫線。空白**不會**被記成 absent——
   * 這一點要先釘住，否則就等於把「沒填」當成「調查員說沒有」。
   *
   * 但反推仍然成立，而且成立的理由是算術而不是猜的：
   * A 的左轉與直進都有數字（＝確定存在），而 A 只能去 2 個地方，
   * 這 2 個去向已經被左轉與直進佔滿，右轉沒有地方可以去。
   * 這與姊妹系統「路口轉向」的 blankExplainedByArithmetic() 是同一條規則。
   */
  const withBlank = [
    arm("A", { blank: "right" }),
    arm("B", { absent: "through" }),
    arm("C", { absent: "left" }),
  ];
  const audits = auditArmTurns(withBlank, "R1");
  const armA = audits.find((audit) => audit.directionCode === "A");
  assert.deepEqual(armA.absent, [], "空白不可以被記成橫線");
  assert.deepEqual(armA.blank, ["right"]);
  assert.deepEqual(
    deriveArmRoutesFromSurvey(audits),
    {
      A: { B: "left", C: "through" },
      B: { C: "left", A: "right" },
      C: { A: "through", B: "right" },
    },
    "確定存在的轉向剛好佔滿所有去向時，剩下那個空白的就是不存在的",
  );
});

test("同一支支線有兩個轉向空白時資訊真的不足，必須回 null", () => {
  /*
   * A 只剩左轉有數字，直進與右轉都空白：兩個去向、只有一個確定存在的轉向，
   * 對應不完全。這時候硬給答案就是猜的。
   */
  const armA = {
    roadId: "R1",
    directionCode: "A",
    surveyType: "intersection",
    turnTally: {
      left: { numeric: 12, placeholder: 0 },
      through: { numeric: 0, placeholder: 0 },
      right: { numeric: 0, placeholder: 0 },
    },
  };
  const audits = auditArmTurns(
    [armA, arm("B", { absent: "through" }), arm("C", { absent: "left" })],
    "R1",
  );
  assert.equal(
    deriveArmRoutesFromSurvey(audits),
    null,
    "確定存在的轉向湊不滿去向數時不可以反推",
  );
});

test("真的整天量到 0 的轉向不可以被當成「不存在」", () => {
  /*
   * 四岔實檔各有 6～9 欄是真的整天量到 0。解析出來的數值與橫線一樣是 0，
   * 差別只在儲存格原本寫什麼——numeric 有計到就代表這個轉向存在。
   */
  const zeroButExists = {
    roadId: "R1",
    directionCode: "A",
    surveyType: "intersection",
    turnTally: {
      left: { numeric: 12, placeholder: 0 },
      through: { numeric: 12, placeholder: 0 },
      /* 整天量到 0：格子裡寫的是 0，不是橫線 */
      right: { numeric: 12, placeholder: 0 },
    },
  };
  const audits = auditArmTurns(
    [zeroButExists, arm("B"), arm("C"), arm("D")],
    "R1",
  );
  const armA = audits.find((audit) => audit.directionCode === "A");
  assert.deepEqual(armA.absent, [], "寫了數字（含 0）就代表這個轉向存在");
});
