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
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import {
  roadNameFromFileName,
  roadNameMatchKey,
  surveyRoadIdFromFileName,
  isFallbackRoadName,
} from "../app/road-identity.ts";

/**
 * 從檔案**內容**讀「測站名稱：…」，讀不到回空字串。
 *
 * ⚠️ 判斷「兩份檔案是不是同一個測站」只能靠這個，不能靠檔名——
 *   檔名正是被測的那個東西，拿它當答案是循環論證。
 * ⚠️ 只掃前幾十列：測站名稱在表頭，掃全表對這件事沒有幫助而且很慢。
 * ⚠️ 讀不起來一律回空字串，讓呼叫端自己決定要不要退回別的判準
 *   （而且要把退回這件事印出來，不可以安靜放寬）。
 */
function stationNameFromContent(fileName) {
  const path = REAL_PATHS.get(fileName) || fileName;
  let book;
  try {
    book = XLSX.read(readFileSync(path), { type: "buffer" });
  } catch {
    return "";
  }
  for (const sheetName of book.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], {
      header: 1,
      blankrows: false,
      defval: "",
      range: 0,
    });
    for (const row of rows.slice(0, 30))
      for (const cell of row) {
        const text = String(cell ?? "");
        const hit = text.match(/測\s*站\s*名\s*稱\s*[：:]\s*(.+)$/);
        if (hit && hit[1].trim()) return hit[1].trim();
      }
  }
  return "";
}

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
/*
 * ⚠️ 真實調查檔的位置（A9，2026-09-23 重寫）。
 *
 * 舊版寫死成 `realdata/batch1`、`realdata/batch2`，而且要求至少 30 份。
 * 使用者現在給的是**另一批**（資料夾名稱不同、份數也不同），
 * 於是這一項在**有真實檔的機器上照樣 skip**——等於這個守門從來沒跑過。
 *
 * 使用者 2026-09-21 的原話：
 *   「我不是提供了一堆真實調查資料檔給你了嗎，這一點要修正什麼??」
 * 要修的是**測試程式**，不是他的資料：改成掃 `realdata/` 底下實際存在的
 * 試算表（遞迴、不看資料夾名稱、不看份數），有幾份就驗幾份。
 *
 * ⚠️ **交付包裡刻意沒有這些檔案**（真實調查資料不隨程式交付），
 *   所以在交付包裡這一項仍然會 skip，那是正確的。
 * ⚠️ 但 skip 的理由必須是「這台機器上沒有真實檔」，
 *   **不可以是「資料夾名稱剛好不叫 batch1」**。那是假的略過。
 */
function spreadsheetsUnder(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...spreadsheetsUnder(full));
    /* Excel 開檔時產生的暫存檔 ~$xxx.xlsx 不算。 */
    else if (/\.xlsx?$/i.test(entry.name) && !entry.name.startsWith("~$"))
      out.push(entry.name);
  }
  return out;
}

const REAL_ROOT = fileURLToPath(new URL("../../realdata", import.meta.url));
test("真實附件目錄使用原生路徑，不可因 Windows file URL 而錯誤略過", () => {
  assert.equal(REAL_ROOT, resolve(dirname(fileURLToPath(import.meta.url)), "../../realdata"));
});
const REAL_FILES = spreadsheetsUnder(REAL_ROOT);
/*
 * 檔名 → 實際路徑。
 *
 * ⚠️ `spreadsheetsUnder()` 回的是**檔名**（`entry.name`），不是路徑——
 *   `roadNameFromFileName()` 要的就是檔名。但要讀**內容**就得有路徑，
 *   所以另外建一份對照，不去動上面那一支的回傳值
 *  （動它會牽連每一個拿檔名去比對的地方）。
 * ⚠️ 我 2026-09-29 第一版直接把檔名丟去 readFileSync，於是每一份都「讀不到
 *   測站名稱」而安靜退回舊判準——測起來像是新判準沒生效。
 */
const REAL_PATHS = (() => {
  const map = new Map();
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (/\.xlsx?$/i.test(entry.name) && !entry.name.startsWith("~$"))
        map.set(entry.name, full);
    }
  };
  walk(REAL_ROOT);
  return map;
})();

test(
  "全部真實檔名：名稱剝得乾淨、不空白、不互撞、跨季全部對得上",
  {
    skip: REAL_FILES.length
      ? false
      : `這台機器上沒有真實調查檔（找過 ${REAL_ROOT}）`,
  },
  () => {
  const files = REAL_FILES;
  /*
   * ⚠️ 不再要求「至少 30 份」：份數是使用者那邊的事，寫死份數只會讓
   *   換一批資料就整項略過。改成「有就一定要驗到」，並把份數印出來，
   *   讓人看得出這一次到底驗了幾份（0 份會走上面的 skip，不會靜靜變綠）。
   */
  assert.ok(files.length > 0, "找到 0 份真實檔卻沒有走 skip，判斷式壞了");
  /*
   * ⚠️ **不可以把真實檔名印出來。** 委託案的站號與調查點名稱不得出現在
   *   原始碼或測試輸出裡（見 tests/dependency-manifest.test.mjs 的守門）。
   *   只報份數就夠了——0 份會走上面的 skip，不會靜靜變綠。
   */
  console.error(`  ↳ 這台機器上找到 ${files.length} 份真實調查檔，全部納入檢查`);

  /*
   * ══════════════════════════════════════════════════════════════════
   *  撞名要怎麼算才對（2026-09-26 修正：這一條原本一定會紅）
   * ══════════════════════════════════════════════════════════════════
   *
   * 原本寫的是「任何兩份真實檔的名稱比對鍵都不可以相同」。
   * 這一條與**同一支測試下半段**直接矛盾：下半段模擬下一季（場次號 +1），
   * 要求同一個調查點的**兩次調查必須算出同一個比對鍵**——跨調查輪次共用名稱
   * 正是歷季趨勢能串成一條線的前提（姊妹系統路口轉向的
   * `recordIntersectionKey()` 也是以路口名稱為鍵）。
   *
   * 於是只要使用者手上同時有兩輪的檔案（2026-09-26 實際發生：
   * 同一個路口的第 15 與第 16 場次各一份），這一條就**保證會紅**，
   * 而紅的理由是「系統照設計做對了」。
   *
   * 真正要抓的是**過度剝除**：兩個**不同的調查點**被收斂成同一個名稱
   * （那會讓兩個路口的資料混進同一條趨勢線）。
   * 所以判準改成以**調查點**為單位：`surveyRoadIdFromFileName()` 對同一個點的
   * 不同輪次會回同一個 id（以示範值表示：`999996T7-01-…` 與 `999996T8-01-…`
   * 都是 `999996-01`），名稱撞在一起時，只有**兩邊的調查點 id 不同**才是缺陷。
   *
   * ⚠️ 這一段刻意用示範站號寫例子：`tests/dependency-manifest.test.mjs`
   *   禁止原始碼出現實際站號，連註解也算。第一版我把使用者那兩份檔名寫進註解，
   *   當場被它抓到——那一支守門是對的。
   *
   * ⚠️ 前置檢查兩件，否則判準放寬之後這一段會安靜地變成恆真：
   *   ① 至少要真的算出兩個以上不同的調查點 id（全部收斂成一個就是 id 壞了）；
   *   ② 這一批裡真的出現過「同名不同輪次」時，要印出來，
   *      讓人看得出放行的是哪一種情形。
   */
  const seen = new Map();
  const points = new Set();
  let crossRoundPairs = 0;
  /** 名稱撞在一起、而序號在不同輪次之間被重新編號過的對數。 */
  let renumbered = 0;
  /** 讀不到測站名稱、退回序號判準的那幾份（一定要印出來）。 */
  const fellBack = [];
  /** 退回序號判準之後判定為「過度剝除」的那幾組（最後一起斷言）。 */
  const overStripped = [];
  for (const file of files) {
    const name = roadNameFromFileName(file);
    assert.ok(name.trim(), `「${file}」切出空白名稱`);
    assert.ok(
      !/^\d{4,}\s*T/i.test(name),
      `「${file}」的名稱「${name}」仍然帶著案號前綴`,
    );
    const key = roadNameMatchKey(file);
    const point = surveyRoadIdFromFileName(file);
    points.add(point);
    const previous = seen.get(key);
    if (previous) {
      /*
       * ⚠️ 2026-09-29 改判準：**以檔案裡的「測站名稱」為準，不以序號為準。**
       *
       *   舊寫法用 `surveyRoadIdFromFileName()`（＝案號＋**序號**）當「是不是
       *   同一個調查點」的依據，前提是「序號在不同輪次之間是穩定的」。
       *   拿到真實檔之後**那個前提不成立**：同一條路段在不同輪次會被
       *   **重新編號**（實測有一對的序號從 11 變成 06，而兩份檔案裡的
       *   「測站名稱：」完全相同、計畫編號也相同，只是監測日期差了兩年）。
       *   於是這一條在**正確的程式**上變紅——那是假的紅。
       *
       *   ⚠️ 程式的行為是對的：`resolveImportedRoad()` 以**名稱**比對
       *   （`nameMatches.length === 1` 就併到既有路段），所以同一條路的兩輪
       *   會落在同一條趨勢線上——那正是要的結果。
       *
       *   ⚠️ 真正要抓的還是**過度剝除**：兩個**真的不同**的測站被收斂成同一個
       *   名稱。判斷「真的不同」的依據只能是**檔案內容裡的測站名稱**，
       *   不能是檔名（檔名正是被測的那個東西，拿它當答案是循環論證）。
       *
       *   ⚠️ 讀不到測站名稱時**退回舊的序號判準，而且把退回這件事印出來**——
       *   安靜退回就等於這一條在那幾份檔案上偷偷變寬了。
       */
      const here = stationNameFromContent(file);
      const there = stationNameFromContent(previous.file);
      if (here && there) {
        assert.equal(
          roadNameMatchKey(here),
          roadNameMatchKey(there),
          `「${file}」與「${previous.file}」的名稱都收斂成「${key}」，`
            + `但檔案裡的測站名稱不同（「${here}」與「${there}」）`
            + "——兩個不同的測站被併成一個，資料會混進同一條趨勢線",
        );
        if (surveyRoadIdFromFileName(file) !== previous.point) renumbered += 1;
      } else {
        /*
         * ⚠️ 讀不到測站名稱時退回舊的序號判準，但**先記下來、最後才一起斷言**。
         *   我第一版是當場 assert，於是「退回了哪幾份」那段 console.log
         *   永遠印不出來（斷言先丟出去了）——等於退回這件事是隱形的。
         */
        fellBack.push(
          `${file}（測站名稱讀不到：本檔「${here || "—"}」、對照「${there || "—"}」）`,
        );
        if (point !== previous.point)
          overStripped.push(
            `「${file}」與「${previous.file}」是不同的調查點`
              + `（${point} 與 ${previous.point}），名稱卻都收斂成同一個「${key}」`
              + "——兩個點的資料會混進同一條趨勢線（此組是退回序號判準判定的）",
          );
      }
      crossRoundPairs += 1;
      continue;
    }
    seen.set(key, { file, point });
  }
  assert.ok(
    points.size >= 2,
    `這 ${files.length} 份真實檔只算出 ${points.size} 個調查點 id——`
      + "surveyRoadIdFromFileName() 壞了，撞名判準會變成恆真",
  );
  console.error(
    `  ↳ 共 ${points.size} 個調查點；其中 ${crossRoundPairs} 組名稱相同`
      + `（判準是檔案裡的「測站名稱」；其中 ${renumbered} 組的序號在不同輪次`
      + "之間被重新編號過——那是廠商會做的事，不是缺陷）",
  );
  /*
   * ⚠️ 退回舊判準的那幾份一定要印出來。安靜退回就等於這一條在那幾份檔案上
   *   偷偷變寬了，而沒有人看得出來。
   */
  if (fellBack.length)
    console.error(
      `  ⚠️ 有 ${fellBack.length} 組讀不到測站名稱，退回「序號」判準：\n`
        + fellBack.map((x) => `     - ${x}`).join("\n"),
    );
  assert.deepEqual(
    overStripped,
    [],
    "以下是退回序號判準之後判定的過度剝除：\n- " + overStripped.join("\n- "),
  );
  /*
   * ⚠️ 前置：**不可以整批都退回**。全部退回代表讀內容那一段壞了
   *   （例如檔名對照沒建起來），而這一條會安靜地變回舊判準。
   */
  if (crossRoundPairs > 0)
    assert.ok(
      fellBack.length < crossRoundPairs,
      `${crossRoundPairs} 組撞名全部退回序號判準——讀「測站名稱」那一段壞了嗎？`,
    );

  /*
   * 模擬下一季：場次號 +1。
   *
   * ⚠️ 檔名有**兩種**寫法，這一支要兩種都吃：
   *   ・黏在一起：`案號T801` → 後兩碼是點位，前面是場次（→ `案號T901`）
   *   ・用分隔符隔開：`案號T8-06` → 場次就是 T 後面那幾位，點位在分隔符後面
   *
   * ⚠️ 2026-09-29 修：舊寫法在「一位數場次 ＋ 分隔符」的檔名上會產生
   *   `案號T2undefined`——因為它假設點位一定黏在場次後面，於是
   *   `digits[1]` 是 undefined。拿到真實檔（`案號T1-01` 這種寫法）當場紅。
   *   ⚠️ 那次紅**紅得對**：它是這支測試助手自己的缺陷，不是程式的。
   *   分隔符那一種只把場次 +1，**後面原樣留著**。
   */
  const nextQuarter = (fileName) =>
    fileName.replace(/^(\d{4,}TS?)(\d+)/i, (_, prefix, digits) => {
      if (digits.length >= 3) {
        const run = digits.slice(0, -2);
        const point = digits.slice(-2);
        return `${prefix}${Number(run) + 1}${point}`;
      }
      return `${prefix}${Number(digits) + 1}`;
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
  },
);

/*
 * ══════════════════════════════════════════════════════════════════════
 *  A26：`T` 後面的 `S` 是選填的——四條規則要一致
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-23 修 A9（讓真實檔測試真的會跑）之後，當場在使用者現有的
 * 11 份真實檔上抓到的：`…TS15-01-…` 這種寫法剝不掉前綴，
 * 整個檔名原樣變成路段名稱，於是下一季匯入同一條路會被當成新路段，
 * 歷季趨勢斷成兩截，而且沒有任何提示。
 *
 * 成因：本檔剝前綴的規則有四條，**只有無分隔符那一條寫了 `S?`**。
 * 這是這個專案反覆犯的「該列 N 樣的地方只列了 1 樣」。
 */
test("⚠️ TS 與 T 兩種寫法都要剝得乾淨（四條規則一致）", () => {
  for (const [file, expected] of [
    ["999999T15-01-示範北路.xlsx", "示範北路"],
    ["999999TS15-01-示範北路.xlsx", "示範北路"],
    ["999999TS15-01示範北路.xlsx", "示範北路"],
    ["999999TS1501示範北路.xlsx", "示範北路"],
    ["999999T1501示範北路.xlsx", "示範北路"],
    ["999996T7-01-示範建國路.xlsx", "示範建國路"],
  ])
    assert.equal(roadNameFromFileName(file), expected, `「${file}」剝錯了`);
});

/*
 * ⚠️ **這一支守的是「既有資料的鍵不可以被重新編」。**
 *
 * normalizeRoadId() 的輸出是 roadId——**會存進檔案**。改剝前綴的規則時，
 * 只要不小心讓某一種既有寫法算出不同的 id，使用者既有的紀錄就會變成
 * 「另一條路」，歷季資料當場斷開，而畫面上只會說匯入成功。
 *
 * 下面這幾種是使用者手上**真的有**的寫法，它們的 id 必須維持原樣。
 */
test("⚠️ 既有檔名寫法算出來的 roadId 不可以改變", () => {
  for (const [file, expected] of [
    /* 使用者目前這一批的寫法（站號與路名一律以示範值表示） */
    ["999997T15-06-示範北路示範一路示範東路.xlsx", "999997-06"],
    ["999997T15-10-示範一路示範六路示範十路.xlsx", "999997-10"],
    /* 使用者較早那一批：無分隔符，走的是另一條規則，本來就不受 S? 影響 */
    ["999999TS601示範北路平日.xlsx", "999999TS601示範北路平日"],
    ["999999T1501示範北路示範一路口七叉路口.xlsx", "999999T1501示範北路示範一路口七叉路口"],
    /* 有分隔符的對照組 */
    ["999996T7-01-示範建國路.xlsx", "999996-01"],
  ])
    assert.equal(
      surveyRoadIdFromFileName(file),
      expected,
      `「${file}」的 roadId 變了——既有紀錄會被當成另一條路`,
    );
});
