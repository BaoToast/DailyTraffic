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

function exportBlock() {
  const start = source.indexOf("function exportBackup()");
  assert.notEqual(start, -1, "找不到 exportBackup()");
  const end = source.indexOf("function ", start + 30);
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
      `exportBackup() 沒有收 ${key}——換一台電腦還原之後這一項會消失`,
    );
});

test("還原備份時會把條件範本寫回去", () => {
  assert.match(
    source,
    /writeConclusionTemplates\(targetProjectId, merged\)/,
    "還原時沒有把條件範本寫回 localStorage",
  );
  assert.match(
    source,
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
    source,
    /Array\.isArray\(payload\.conclusionTemplates\) && payload\.conclusionTemplates\.length/,
    "還原條件範本前必須先確認備份裡真的有這個欄位、而且不是空的",
  );
  assert.match(
    source,
    /const existing = readConclusionTemplates\(targetProjectId\)/,
    "還原時要先讀出這台電腦既有的範本再併入，不能直接覆蓋",
  );
});
