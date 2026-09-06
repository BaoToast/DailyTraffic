/*
 * 檔名沒有分隔符時，路段名稱要切得出來，而且要跨季認得同一條路。
 *
 * 起因：使用者實際的命名長這樣（以下一律以示範站號與示範路名表示）：
 * 「999999T1501示範北路示範一路口七叉路口.xlsx」——
 * 案號、場次、點位編號連在一起，中間沒有「-」或「_」。舊版的規則要求
 * 場次與點位之間必須有分隔符，切不到就整條跳過、整個檔名原樣當成路段名稱。
 *
 * 實測（修正前，37 份真實檔）：
 *   路段名稱 = 999999T1506示範北路示範二路示範東路（＝整個檔名）
 *   調查點編號 = 同一串（畫面上顯示成「名稱（編號）」時兩邊一模一樣）
 *   模擬下一季 T15 → T16：37/37 名稱比對鍵都對不上
 * 修正後：37/37 都對得上。
 *
 * 為什麼跨季對不上是問題：resolveImportedRoad() 判斷「這個檔屬不屬於既有
 * 路段」是**先比名稱**再比編號的，而代號裡的場次號逐季遞增，名稱跟著變，
 * 於是下一季匯入同一條路會被當成新路段，歷季趨勢斷成兩截。
 *
 * ⚠️ 假通過陷阱：只驗「名稱不等於檔名」是不夠的——只要剝掉任何一個字元就會
 *    通過。所以下面逐項驗**剝出來的字串究竟是什麼**，並且成對驗跨季。
 *
 * ⚠️ 這一支刻意**不驗調查點編號**：編號是 trafficIdentity（紀錄的鍵）的一部分，
 *    本次修正刻意不動它。下面反過來鎖住「編號沒有被改掉」，避免將來有人
 *    順手一起改而把既有資料重新編鍵。
 *
 * ⚠️ 站號與路名一律用示範值：案號用 999996～999999、路名用「示範…」。
 *    委託案的實際站號與調查點名稱不得出現在原始碼裡
 *    （見 tests/dependency-manifest.test.mjs 的同名守門）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, existsSync } from "node:fs";

import {
  roadNameFromFileName,
  roadNameMatchKey,
  surveyRoadIdFromFileName,
  isFallbackRoadName,
} from "../app/road-identity.ts";

test("無分隔符的檔名要切得出乾淨的路段名稱", () => {
  assert.equal(
    roadNameFromFileName("999999T1501示範北路示範一路口七叉路口.xlsx"),
    "示範北路示範一路口七叉路口",
  );
  assert.equal(
    roadNameFromFileName("999999T1506示範北路示範二路示範東路.xlsx"),
    "示範北路示範二路示範東路",
  );
  /* 場次只有一碼時（T601 → 場次 6、點位 01）一樣要剝掉整段 */
  assert.equal(roadNameFromFileName("999998T602示範林路平、假日.xlsx"), "示範林路平、假日");
  /* TS 開頭（路段調查）也是同一套 */
  assert.equal(
    roadNameFromFileName("999999TS1503示範道186示範三路_示範西路平日.xlsx"),
    "示範道186示範三路_示範西路平日",
  );
});

test("有分隔符的舊寫法維持原本行為，不可被新規則影響", () => {
  assert.equal(roadNameFromFileName("999996T7-01-示範建國路.xlsx"), "示範建國路");
  assert.equal(roadNameFromFileName("999996T9-11-示範中正路.xls"), "示範中正路");
});

test("路名裡的數字不可以被誤認成案號而剝掉", () => {
  /* 路名開頭或中間帶數字的寫法（示1、示17、186、1003 巷）在真實檔名裡都有 */
  assert.equal(roadNameFromFileName("999999T1505示1示28路口.xlsx"), "示1示28路口");
  assert.equal(roadNameFromFileName("999998T605示17示範中路平、假日.xlsx"), "示17示範中路平、假日");
  assert.equal(roadNameFromFileName("999999T1509示範道186示範才路示範工路.xlsx"), "示範道186示範才路示範工路");
  assert.equal(
    roadNameFromFileName("999999T1501186縣道示範路口.xlsx"),
    "186縣道示範路口",
    "無分隔代號後緊接數字路名時，不可把路名開頭的數字一起剝掉",
  );
  assert.equal(roadNameFromFileName("999997T1504示範楠路  1003巷路口.xls"), "示範楠路  1003巷路口");
  /* 沒有案號前綴的檔名不可以被動到 */
  assert.equal(roadNameFromFileName("示範建國路.xlsx"), "示範建國路");
  assert.equal(roadNameFromFileName("示1線示範一路口.xlsx"), "示1線示範一路口");
});

test("同一條路在下一季（場次號 +1）要被認成同一條", () => {
  const pairs = [
    ["999999T1501示範北路示範一路口七叉路口.xlsx", "999999T1601示範北路示範一路口七叉路口.xlsx"],
    ["999997T1502示範左路  示範昌路口.xls", "999997T1602示範左路  示範昌路口.xls"],
    ["999998T601示範南路平、假日.xlsx", "999998T701示範南路平、假日.xlsx"],
    ["999999TS1503示範道186示範三路_示範西路平日.xlsx", "999999TS1603示範道186示範三路_示範西路平日.xlsx"],
  ];
  for (const [a, b] of pairs)
    assert.equal(
      roadNameMatchKey(a),
      roadNameMatchKey(b),
      `${a} 與 ${b} 的名稱比對鍵應該相同`,
    );
});

test("平日與假日不可以收斂成同一個名稱", () => {
  /*
   * 剝掉尾端的平假日字樣是刻意不做的：兩份檔會變成同名，下次匯入時
   * nameMatches 會同時命中兩筆而落到詢問視窗，比現在更糟；而平假日字樣
   * 不會逐季改變，留著並不影響跨季比對（上一項已驗）。
   */
  assert.notEqual(
    roadNameMatchKey("999999TS1501示1示範中路示範昌路示範街路口平日.xlsx"),
    roadNameMatchKey("999999TS1501示1示範中路示範昌路示範街路口假日.xlsx"),
  );
});

test("調查點編號刻意維持原樣——它是紀錄的鍵，不得順手改掉", () => {
  /* 有分隔符時照舊收斂成跨季共用的編號 */
  assert.equal(surveyRoadIdFromFileName("999996T7-01-示範建國路.xlsx"), "999996-01");
  assert.equal(surveyRoadIdFromFileName("999996T8-01-示範建國路.xlsx"), "999996-01");
  /* 無分隔符時仍然退回整個檔名（本次修正不動它） */
  assert.equal(
    surveyRoadIdFromFileName("999999T1501示範北路示範一路口七叉路口.xlsx"),
    "999999T1501示範北路示範一路口七叉路口",
  );
});

test("只有代號、沒有路名的檔名要被認出是「還沒取名字」", () => {
  const name = roadNameFromFileName("999999T1501.xlsx");
  assert.ok(isFallbackRoadName(name), `「${name}」應該被視為代號而非真的路段名稱`);
  assert.ok(isFallbackRoadName("999996-01"));
  /* 真的路名不可以被誤判成代號 */
  assert.equal(isFallbackRoadName("示範北路示範一路口"), false);
  assert.equal(isFallbackRoadName("示1示28路口"), false);
});

/*
 * 真實檔案在測試環境才有，交付包不含它們（使用者明確要求）。
 * 有就跑全量、沒有就略過，不讓交付包的測試因缺檔而紅。
 */
const REAL_DIRS = [
  "/home/claude/work/dchk/realdata/batch1",
  "/home/claude/work/dchk/realdata/batch2",
].filter((dir) => existsSync(dir));

test("全部真實檔名：名稱剝得乾淨、不空白、不互撞、跨季全部對得上", { skip: !REAL_DIRS.length }, () => {
  const files = REAL_DIRS.flatMap((dir) =>
    readdirSync(dir).filter((n) => /\.xlsx?$/i.test(n)),
  );
  assert.ok(files.length >= 30, `真實檔案只找到 ${files.length} 份`);

  const seen = new Map();
  for (const file of files) {
    const name = roadNameFromFileName(file);
    assert.ok(name.trim(), `「${file}」切出空白名稱`);
    assert.ok(
      !/^\d{4,}\s*T/i.test(name),
      `「${file}」的名稱「${name}」仍然帶著案號前綴`,
    );
    const key = roadNameMatchKey(file);
    const previous = seen.get(key);
    assert.ok(
      !previous,
      `「${file}」與「${previous}」的名稱收斂成同一個「${key}」`,
    );
    seen.set(key, file);
  }

  /* 模擬下一季：場次號 +1（後兩碼為點位，與路口轉向 stationFromFilename 同慣例） */
  const nextQuarter = (fileName) =>
    fileName.replace(/^(\d{4,}TS?)(\d+)/i, (_, prefix, digits) => {
      const [run, point] =
        digits.length >= 3
          ? [digits.slice(0, -2), digits.slice(-2)]
          : [digits[0], digits[1]];
      return `${prefix}${Number(run) + 1}${point}`;
    });
  for (const file of files) {
    const next = nextQuarter(file);
    assert.notEqual(next, file, `「${file}」的下一季檔名沒有變化，這個模擬無效`);
    assert.equal(
      roadNameMatchKey(file),
      roadNameMatchKey(next),
      `「${file}」與下一季「${next}」的名稱比對鍵應該相同`,
    );
  }
});
