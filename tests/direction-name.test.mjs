import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  DIRECTION_PLACEHOLDER,
  isRealArmName,
  typedNameKey,
  isRealDirectionName,
  pickDirectionName,
} from "../app/road-identity.ts";

/*
 * 這一組測試守的是同一個缺陷：**「有沒有值」被當成「有沒有取過名字」**。
 *
 * 「方向A／方向B」是系統在拿不到方向名稱時補上去的佔位字串。它有長度、
 * 是真的字串，所以 `||`、`??`、`if (name)` 一律當它有值。結果就是使用者
 * 打好的「南下／北上」被這個預設值蓋掉，而且畫面上完全沒有提示。
 *
 * 交通服務水準系統的 Manager 比較踩過同一個坑（v2.20.7），這裡是全日交通量版本。
 *
 * ⚠️ 下面的原始碼檢查是刻意的：合併路段那段邏輯綁在 React 元件裡，
 * 沒辦法在 node --test 直接跑起來，但「有沒有把 target.directionA 直接送出去」
 * 這件事看原始碼就分辨得出來，而且對修正前的版本確實會紅字。
 */

/*
 * 註解要先拿掉再比對。不然「原本是 `?? "方向A"`」這種說明缺陷成因的註解
 * 本身就會被當成缺陷，測試變成「不准寫註解解釋你修了什麼」——那是反效果。
 */
function sourceWithoutComments(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const dashboard = sourceWithoutComments("../app/DashboardClient.tsx");
const appFetch = sourceWithoutComments("../app/app-fetch.ts");
/* 線上版的路段 API——「離線與線上一致」這件事要兩邊都讀才驗得到。 */
const roadsRoute = sourceWithoutComments("../app/api/roads/route.ts");

test("佔位值「方向A／方向B」不算使用者取過的名字", () => {
  assert.equal(isRealDirectionName("方向A", "A"), false);
  assert.equal(isRealDirectionName("方向B", "B"), false);
  assert.equal(isRealDirectionName("方向Ａ", "A"), false);
  assert.equal(isRealDirectionName("方向Ｂ", "B"), false);
  assert.equal(isRealDirectionName("", "A"), false);
  assert.equal(isRealDirectionName("   ", "A"), false);
  assert.equal(isRealDirectionName(undefined, "A"), false);
  assert.equal(isRealDirectionName("南下", "A"), true);
  assert.equal(isRealDirectionName("北上", "B"), true);
  // 「方向B」放在 A 欄位是使用者自己打的（雖然奇怪），不是 A 的佔位值
  assert.equal(isRealDirectionName("方向B", "A"), true);
});

test("挑名字：真的取過的名字優先，佔位值排最後", () => {
  // 合併路段的核心情境：目標路段沒取過名字，來源有——來源的名字要留著
  assert.equal(pickDirectionName("A", "方向A", "南下"), "南下");
  assert.equal(pickDirectionName("B", "方向B", "北上"), "北上");
  // 目標有取過名字就以目標為準
  assert.equal(pickDirectionName("A", "東行", "南下"), "東行");
  // 兩邊都沒取過 → 佔位值
  assert.equal(pickDirectionName("A", "方向A", "方向A"), "方向A");
  assert.equal(pickDirectionName("A", undefined, undefined), "方向A");
  assert.equal(pickDirectionName("B"), "方向B");
  // 空字串不是名字，也不該原封不動被寫回去
  assert.equal(pickDirectionName("A", "", ""), "方向A");
  assert.equal(pickDirectionName("A", "", "南下"), "南下");
  assert.equal(DIRECTION_PLACEHOLDER.A, "方向A");
  assert.equal(DIRECTION_PLACEHOLDER.B, "方向B");
  // 回傳值一定做 NFKC 並去過頭尾空白：前後端必須存成同一個字串
  assert.equal(pickDirectionName("A", "  南下  "), "南下");
  assert.equal(pickDirectionName("A", "  方向A  "), "方向A");
  assert.equal(pickDirectionName("A", "   "), "方向A");
  assert.equal(pickDirectionName("A", "方向Ａ", "南下（２）"), "南下(2)");
  assert.equal(pickDirectionName("B", "北上（２）"), "北上(2)");
});

test("合併時 A 與 B 必須取自同一條路段，不可以各挑各的", () => {
  /*
   * 反例（分開挑會出事）：
   *   目標 A＝方向A（沒取過）、B＝往南
   *   來源 A＝往南、B＝往北
   * 各挑各的 → A＝往南（來源）、B＝往南（目標）：兩個方向同名，
   * 篩選與 Excel 的 A／B 欄從此分不出來。舊版反而不會，因為它整組拿目標的。
   */
  assert.match(
    dashboard,
    /const namingRoad = targetNamed \|\| !sourceNamed \? target : source;/,
    "mergeRoad 沒有先決定「哪一條路段的名字整組沿用」",
  );
  assert.match(dashboard, /const mergedDirectionA = pickDirectionName\("A", namingRoad\.directionA\);/);
  assert.match(dashboard, /const mergedDirectionB = pickDirectionName\("B", namingRoad\.directionB\);/);
  // 分開從 target／source 兩個來源挑的寫法不可以再出現
  assert.doesNotMatch(dashboard, /pickDirectionName\(\s*"A",\s*target\.directionA,\s*source\.directionA/);
});

test("判斷佔位值全系統只有一套標準", () => {
  /*
   * normalizeProjectTrafficRecords 每次載入都會跑，原本自己用 /^方向[AB]$/
   * 判斷佔位值——不分 A／B、也不去頭尾空白，和 isRealDirectionName 會給出
   * 相反的答案。畫面上改好的名字因此會在下次重新整理被它改回去。
   */
  assert.doesNotMatch(
    dashboard,
    /\/\^方向\[AB\]\$\//,
    "normalizeProjectTrafficRecords 還在用自己那套佔位值判斷",
  );
  assert.match(dashboard, /isRealDirectionName\(r\.directionName, placeholderCode\)/);
  // `fallbackDirection ?? defaultDirection` 的 ?? 擋不住設定檔裡的空字串
  assert.doesNotMatch(dashboard, /fallbackDirection \?\? defaultDirection/);
  assert.match(dashboard, /metaDirection \|\| defaultDirection/);
});

test("型態不合的合併要在確認視窗之前就擋下來", () => {
  // 擋在確認之後的話，使用者會先看到「方向名稱將統一為…」再被退回，白按一次。
  const merge = dashboard.slice(dashboard.indexOf("async function mergeRoad()"));
  const guard = merge.indexOf("路段格式與路口格式不可互相合併");
  const confirm = merge.indexOf("window.confirm");
  assert.ok(guard > 0 && confirm > 0, "找不到型態檢查或確認視窗");
  assert.ok(guard < confirm, "型態檢查仍排在 window.confirm 之後");
});

test("合併路段不再把目標的預設名稱直接送出去", () => {
  // 修正前：directionA: target.directionA —— 目標沒取過名字時就是「方向A」，
  // 送到後端會無條件覆蓋來源那幾筆使用者打好的方向名稱。
  assert.doesNotMatch(
    dashboard,
    /directionA:\s*target\.directionA/,
    "mergeRoad 仍直接送出 target.directionA，目標若只有預設名稱會蓋掉來源的名字",
  );
  assert.doesNotMatch(dashboard, /directionB:\s*target\.directionB/);
  assert.match(dashboard, /const mergedDirectionA = pickDirectionName\(/);
  assert.match(dashboard, /const mergedDirectionB = pickDirectionName\(/);
  // 畫面上的確認視窗要先講清楚方向名稱會被統一成什麼
  assert.match(dashboard, /方向名稱將統一為/);
});

test("路段管理清單的方向名稱不再用 ?? 補預設值", () => {
  // `rows.find(...)?.directionName ?? "方向A"` 擋不住空字串，
  // 舊資料被清空過的方向名稱會在管理畫面顯示成一格空白。
  assert.doesNotMatch(dashboard, /\?\.directionName \?\? "方向A"/);
  assert.doesNotMatch(dashboard, /\?\.directionName \?\? "方向B"/);
  // 匯入比對路段時，已匯入資料上的「方向A」不該壓過設定檔裡真的取過的名字
  assert.doesNotMatch(dashboard, /existingA \?\? selectedMeta\?\.a/);
  assert.match(dashboard, /pickDirectionName\("A", existingA, selectedMeta\?\.a\)/);
});

test("離線 API 的方向名稱預設值與線上版一致", () => {
  // `?? "方向A"` 只擋 undefined／null；欄位被清空送過來會寫入空白，
  // 線上版（app/api/roads/route.ts）用的是 `|| "方向A"`。
  assert.doesNotMatch(
    appFetch,
    /body\.directionA \?\? "方向A"/,
    "離線 API 仍用 ?? 補預設值，空字串會被寫進 directionName",
  );
  assert.doesNotMatch(appFetch, /body\.directionB \?\? "方向B"/);
  /*
   * ⚠️ 2026-09-12 起「使用者打的名字」兩邊都用 cleanLabel()＝只去頭尾空白，
   *   **不做 NFKC**。
   *
   * 為什麼改：NFKC 會把全形括號「（）」換成半形「()」。實測輸入
   * 「中山路（改名後）」，存進去變成「中山路(改名後)」——使用者看得出來
   * 自己打的字被改掉了。依專案定過的分界（使用者原話）：
   * 「空格看不出來要吸收（排版雜訊），大小寫看得出來不吸收（內容）」，
   * 全半形括號屬於看得出來的內容。
   *
   * ⚠️ 比對完全不受影響：別名鍵與路段比對走 roadNameMatchKey()，
   *   那一支自己就做 NFKC。這是「顯示保留原樣、比對才正規化」。
   *
   * 這一條要守的**不變量沒有變**：離線版與線上版對同一個輸入要存成同一個字串。
   */
  const cleanLabelDef = /const cleanLabel = \(value: unknown\) => String\(value \?\? ""\)\.trim\(\);/;
  assert.match(appFetch, cleanLabelDef, "離線版沒有 cleanLabel()");
  assert.match(roadsRoute, cleanLabelDef, "線上版沒有 cleanLabel()");
  assert.match(appFetch, /directionA = cleanLabel\(body\.directionA\) \|\| "方向A"/);
  assert.match(appFetch, /directionB = cleanLabel\(body\.directionB\) \|\| "方向B"/);
  assert.match(appFetch, /targetRoadName = cleanLabel\(body\.targetRoadName\)/);
  assert.match(roadsRoute, /roadName = cleanLabel\(body\.roadName\)/);
  assert.match(roadsRoute, /targetRoadName = cleanLabel\(body\.targetRoadName\)/);
  /* 反面：名稱欄位不可以再走 NFKC。 */
  for (const [label, source] of [
    ["離線版", appFetch],
    ["線上版", roadsRoute],
  ]) {
    assert.doesNotMatch(
      source,
      /roadName = clean\(/,
      `${label}的路段名稱還在做 NFKC，使用者打的全形括號會被換成半形`,
    );
    assert.doesNotMatch(
      source,
      /aliasName = String\(body\.aliasName \?\? ""\)\.normalize\("NFKC"\)/,
      `${label}的別名名稱還在做 NFKC`,
    );
  }
});

test("離線 API 改名／合併路口時不會蓋掉支線名稱", () => {
  /*
   * 路口的 A～G 是支線，各有自己的名字。線上版與畫面上的即時更新都會在
   * surveyType === "intersection" 時保留 directionName，只有離線這條路徑
   * 會把支線A、支線B 換成「方向A／方向B」——而使用者的網站就是跑離線這條。
   */
  assert.match(appFetch, /const isIntersection = body\.surveyType === "intersection"/);
  assert.match(appFetch, /const renamedDirection = \(/);
  assert.match(appFetch, /if \(isIntersection\) return row\.directionName;/);
  // 兩條路徑都要改用 renamedDirection，不可再各寫一次三元判斷
  const inlineTernaries = appFetch.match(
    /directionName: r\.directionCode === "A" \?/g,
  );
  assert.equal(
    inlineTernaries,
    null,
    "rename／merge 仍有就地寫死的方向三元判斷，沒有走 renamedDirection",
  );
  assert.equal(
    (appFetch.match(/directionName: renamedDirection\(r, directionA, directionB\)/g) ?? [])
      .length,
    2,
    "rename 與 merge 兩條路徑都要走 renamedDirection",
  );
});


/*
 * ══════════════════════════════════════════════════════════════════
 *  路口支線名稱：中間的空格也要被吸收
 * ══════════════════════════════════════════════════════════════════
 *
 * 姊妹系統（路口轉向）2026-09-11 實測到的坑：自動命名產生的是
 * `"路口 " + code`（「路口」與代碼之間有半形空格），使用者手打的是
 * 「路口A」。兩者看起來一模一樣，字串卻不相等。
 *
 * 本系統的症狀比較輕（分組走的是 directionCode，數字不受影響），
 * 但方向標籤會變成「駛出路口A（路口 A）」——括號裡重複一次同一個名字。
 *
 * ⚠️ 只做 trim() 沒有用：問題出在**字串中間**的空格。
 */
test("isRealArmName：看起來等於佔位值的名字，一律不算「取過名字」", () => {
  for (const value of ["路口A", "路口 A", "路口　A", " 路口A ", "路口Ａ"])
    assert.equal(
      isRealArmName(value, "A"),
      false,
      `「${value}」看起來就是佔位值，不可以被當成使用者取的名字`,
    );
  /* 反面：真的取過名字要認得出來，不可以連這種也擋掉 */
  for (const value of ["神農路口", "岡山北路北側", "路口A側道"])
    assert.equal(isRealArmName(value, "A"), true, `「${value}」是真的名字`);
  /* 空值 */
  assert.equal(isRealArmName("", "A"), false);
  assert.equal(isRealArmName(undefined, "A"), false);
  /* 不同代碼互不干擾 */
  assert.equal(isRealArmName("路口 B", "B"), false);
  assert.equal(isRealArmName("路口 B", "A"), true);
});


/*
 * ══════════════════════════════════════════════════════════════════
 *  使用者自己打的名稱：吸收排版差異，不吸收內容差異
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11 定的分界：
 *   ・空格與全半形 ＝ **排版雜訊**（他自己看不出差別）→ 要吸收
 *   ・大小寫 ＝ **內容**（看得出來）→ 不吸收
 *     「我建議是判定是不同，因為這不是比對前『正規化』的意思。」
 *
 * ⚠️ 這一則同時擋兩個方向：正規化**不足**（空格沒吸收）與正規化**過頭**
 *   （把不同的名字併在一起）。只驗其中一邊都是不完整的。
 */
test("typedNameKey：吸收排版差異，不吸收大小寫", () => {
  assert.equal(typedNameKey("季報用"), typedNameKey("季報 用"), "中間的半形空格要吸收");
  assert.equal(typedNameKey("季報用"), typedNameKey("季報　用"), "全形空格要吸收");
  assert.equal(typedNameKey("季報用"), typedNameKey(" 季報用 "), "頭尾空白要吸收");
  assert.equal(typedNameKey("路口A"), typedNameKey("路口Ａ"), "全形 Ａ 要收斂成半形");
  assert.notEqual(typedNameKey("路口A"), typedNameKey("路口a"), "大小寫算不同");
  assert.notEqual(typedNameKey("季報用"), typedNameKey("月報用"), "不同的名字當然不同");
  assert.equal(typedNameKey(""), "");
  assert.equal(typedNameKey(undefined), "");
});
