/*
 * 方向名稱成對判定：與姊妹專案共用同一套規則。
 * ⚠️ app/direction-pair.ts 與路口轉向的 lib/direction-pair.ts **逐位元相同**，
 *   案例表 tests/direction-pair-contract.mjs 三支也逐位元相同。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  bearingOf,
  directionTextKey,
  judgeDirectionPair,
  directionPairMessage,
} from "../app/direction-pair.ts";
import { checkDirectionPairContract } from "./direction-pair-contract.mjs";

test("方向成對判定符合三支共用契約", () => {
  checkDirectionPairContract(judgeDirectionPair, (label, ok, detail) => {
    assert.ok(ok, `${label} — ${detail}`);
  });
});

test("bearingOf 只認整串像方位詞的名稱（地名不可以誤判）", () => {
  assert.equal(bearingOf("北上"), "北");
  assert.equal(bearingOf("東北"), "東北");
  assert.equal(bearingOf("往西"), "西");
  /* ⚠️ 這三條是防誤報的，拿掉的話「往台北／往高雄」會被報成異常。 */
  assert.equal(bearingOf("往台北"), null);
  assert.equal(bearingOf("北屯路"), null);
  assert.equal(bearingOf("南投端"), null);
});

test("訊息要寫出原名稱與期望的方位", () => {
  const message = directionPairMessage(
    "北上",
    "西行",
    judgeDirectionPair("北上", "西行"),
  );
  for (const needle of ["北上", "西行", "南"])
    assert.ok(message.includes(needle), `訊息少了「${needle}」：${message}`);
});

/* ══════════════════════════════════════════════════════════════════════
 *  directionTextKey()：方向顯示名稱的比對鍵（2026-09-29 新增，三支共用）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 起因：交通服務水準的「方向對應不一致」檢查原本拿**原始字串**比對，
 * 於是「北上」「北 上」「北－上」被算成三種寫法而報出假的異常，
 * 而那一項的出路寫著「回去修正原始檔並重新匯入」——
 * 一個排版雜訊造成的假異常，會把人導向去改廠商交來的原始檔。
 *
 * 判準放在三支共用的 direction-pair，三支同一套。
 * ⚠️ 兩邊都要驗：吸收雜訊（下面第一條）與**不**吸收內容（第二條）。
 *   少了第二條，把整個字串正規化成空字串也會綠——那是半個守門。
 */
test("directionTextKey 吸收排版雜訊：空白、全半形、破折號、頓號、斜線", () => {
  for (const [a, b] of [
    ["北上", "北 上"],
    ["北上", "北－上"],
    ["北上", "北-上"],
    ["北上", "北　上"],
    ["往台北", "往　台北"],
    ["甲街／乙街", "甲街/乙街"],
    ["A線", "A 線"],
  ])
    assert.equal(
      directionTextKey(a),
      directionTextKey(b),
      `「${a}」與「${b}」只差排版雜訊，比對鍵應該相同`,
    );
});

test("directionTextKey 不吸收內容：方位與大小寫都要分得出來", () => {
  for (const [a, b] of [
    ["北上", "南下"],
    ["往台北", "往竹科"],
    ["A線", "a線"],
    ["北上", "北下"],
  ])
    assert.notEqual(
      directionTextKey(a),
      directionTextKey(b),
      `「${a}」與「${b}」是真的不同（使用者 2026-09-11 裁示：` +
        "空格與全半形是排版雜訊，大小寫是內容)",
    );
});

test("directionTextKey 對空值與非字串不可以炸", () => {
  for (const input of [null, undefined, "", "   ", 0, {}])
    assert.equal(typeof directionTextKey(input), "string", String(input));
  assert.equal(directionTextKey(null), "");
  assert.equal(directionTextKey("  　 "), "");
});

test("bearingOf 走的就是 directionTextKey（不可以各自正規化一次）", () => {
  assert.equal(bearingOf("北 上"), "北");
  assert.equal(bearingOf("北－上"), "北");
  assert.equal(bearingOf("北上"), bearingOf("北 上"));
  /* 防誤報那三條不可以被放寬。 */
  assert.equal(bearingOf("往台北"), null);
  assert.equal(bearingOf("北屯路"), null);
  assert.equal(bearingOf("南投端"), null);
});
