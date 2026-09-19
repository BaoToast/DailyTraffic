/*
 * 備份必須帶走使用者自己設定的每一樣東西。
 *
 * 起因：使用者問「結論草稿的條件範本存好之後，換一台電腦還在嗎？」
 * 查證結果是**不在**——範本存在 localStorage 的
 * traffic-conclusion-templates-v1（依計畫分開），本機有存，
 * 但 exportBackup() **沒有收**。使用者在 A 電腦存了好幾組常用條件，
 * 匯出備份帶到 B 電腦還原之後一組都沒有，而畫面只說「還原完成」。
 *
 * 這一支的作法是「清單比對」：把使用者會自己調整、換電腦時應該一起帶走的
 * 東西列出來，逐一確認備份有收。日後新增設定卻忘了收進備份，這裡就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
/*
 * ⚠️ 掃原始碼的斷言一律比對**壓平空白之後**的字串。
 *
 * 2026-09-11 的教訓：我不小心對這個檔案跑了一次 `prettier --write`
 * （這個專案本來就不是 prettier 排版），行為一個字都沒變，
 * 但它把 `A && B` 折成兩行，於是四支守門測試同時紅字——
 * 而紅字的長相是「還原條件範本前必須先確認…」這種**聽起來像功能壞了**
 * 的訊息，非常容易被誤判成真的改壞。
 *
 * 換行位置不是行為。把空白壓平之後再比對，排版怎麼變都不影響，
 * 而斷言想守的那件事（條件判斷裡確實有這兩個檢查）完全不受影響。
 */
const flat = source.replace(/\s+/g, " ");

/*
 * ⚠️ 2026-09-11 起要掃的是 buildBackupPayload()，不是 exportBackup()。
 *
 * 那一天新增了「備份全部計畫」，於是把「一個計畫要打包哪些東西」抽成
 * buildBackupPayload()，讓「本計畫」與「全部計畫」兩個按鈕共用同一份組裝邏輯。
 * 抽出來本身正是為了這支測試在守的那件事——兩邊各寫一份的話，
 * 以後新增一個要備份的欄位一定會有一邊忘記加。
 */
function exportBlock() {
  const start = source.indexOf("function buildBackupPayload(");
  assert.notEqual(start, -1, "找不到 buildBackupPayload()");
  const end = source.indexOf("\n  function ", start + 30);
  return source.slice(start, end);
}

/** 每一項都是使用者自己設定的，換電腦時必須跟著走。 */
const MUST_TRAVEL = [
  "pcuFactors",
  "turnPcuFactors",
  "vehicleClassSettings",
  "roadAliases",
  "intersectionSettings",
  "workflow",
  "conclusionTemplates",
  "records",
];

test("匯出的備份收齊了使用者的設定", () => {
  const block = exportBlock();
  for (const key of MUST_TRAVEL)
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(block),
      `buildBackupPayload() 沒有收 ${key}——換一台電腦還原之後這一項會消失`,
    );
});

test("還原備份時會把條件範本寫回去", () => {
  assert.match(
    flat,
    /writeConclusionTemplates\(targetProjectId, merged\)/,
    "還原時沒有把條件範本寫回 localStorage",
  );
  assert.match(
    flat,
    /setConclusionTemplates\(merged\)/,
    "還原之後畫面上的範本清單沒有跟著更新",
  );
});

test("備份裡沒有條件範本時，不可以把這台電腦既有的範本清掉", () => {
  /*
   * 只有在備份裡「確實有而且不是空的」時才動它。舊版備份沒有這個欄位，
   * 無條件覆蓋會把使用者已經存好的範本抹掉——那比不還原更糟。
   * 而且是「併入」不是「取代」：這台電腦上原有的其他範本要留著。
   */
  assert.match(
    flat,
    /Array\.isArray\(payload\.conclusionTemplates\) && payload\.conclusionTemplates\.length/,
    "還原條件範本前必須先確認備份裡真的有這個欄位、而且不是空的",
  );
  assert.match(
    flat,
    /const existing = readConclusionTemplates\(targetProjectId\)/,
    "還原時要先讀出這台電腦既有的範本再併入，不能直接覆蓋",
  );
});

/*
 * ⚠️ 「備份全部計畫」不可以直接拿畫面上的 state 去包。
 *
 * records／roadAliases／workflow 這三樣都只載入**目前這一個計畫**
 * （見 DashboardClient 裡那幾個 useEffect）。直接包出去的話，其他計畫
 * 全部會是空的，而檔案大小看起來正常、還原也不會報錯——最難發現的那種錯。
 * 所以 exportAllBackup() 一定要自己去把每個計畫的資料抓回來。
 */
test("備份全部計畫時，每個計畫的資料是各自抓回來的，不是拿畫面上的 state", () => {
  const start = source.indexOf("async function exportAllBackup()");
  assert.notEqual(start, -1, "找不到 exportAllBackup()");
  const block = source.slice(start, source.indexOf("\n  function ", start + 30));
  assert.match(
    block,
    /api\/traffic\?projectIds=/,
    "沒有去抓各計畫的路口資料——其他計畫會是空的",
  );
  assert.match(
    block,
    /api\/roads\?projectId=/,
    "沒有去抓各計畫的路段別名",
  );
  assert.match(
    block,
    /loadWorkflow\(project\.id\)/,
    "沒有去抓各計畫的品質與定稿狀態",
  );
  assert.match(
    block,
    /readProjectPcuScopes\(project\.id\)/,
    "沒有帶各計畫的季別／路段係數覆寫",
  );
  assert.match(
    block,
    /buildBackupPayload\(/,
    "沒有共用 buildBackupPayload()——兩份組裝邏輯遲早會不一致",
  );
});

/*
 * ⚠️ 還原多個計畫時，共用的那兩份 localStorage 陣列要**累加**，
 *   而且累加器必須在迴圈外面。
 *
 * 實測踩過：迴圈裡每一輪都從閉包裡那份舊的 vehicleClassSettings 接新的，
 * setState 不會更新閉包變數，於是第二輪把第一輪加進去的整組蓋掉。
 * 筆數、季度、PCU 係數全部正確，只有車種分類默默不見，不會有任何訊息。
 */
test("還原多個計畫時，車種分類與路口幾何是累加的，不會互相覆蓋", () => {
  const start = source.indexOf("async function restoreAllProjects(");
  assert.notEqual(start, -1, "找不到 restoreAllProjects()");
  /*
   * ⚠️ 要先把註解拿掉再比對。
   *   這一段的註解裡**引用了錯誤寫法當例子**
   *   （「第一版是在迴圈裡寫 [...vehicleClassSettings, ...新的]」），
   *   不濾掉的話，下面那條「不可以再讀閉包舊值」會被自己的說明文字踩紅。
   */
  const block = source
    .slice(start, source.indexOf("\n  async function ", start + 30))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  assert.match(
    block,
    /let nextVehicleClass = vehicleClassSettings/,
    "累加器不在迴圈外面——後一個計畫會蓋掉前一個的車種分類設定",
  );
  assert.match(
    block,
    /let nextIntersection = intersectionSettings/,
    "累加器不在迴圈外面——後一個計畫會蓋掉前一個的路口幾何設定",
  );
  assert.ok(
    !/\[\s*\.\.\.vehicleClassSettings\s*,/.test(block),
    "迴圈裡還在讀 vehicleClassSettings（閉包裡的舊值），必須用累加器",
  );
});
