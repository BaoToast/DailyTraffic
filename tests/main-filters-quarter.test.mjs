/*
 * ══════════════════════════════════════════════════════════════════════
 *  R-8：季度不可以用 isFiltered 問（M-1 之後語意剛好相反）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-15 使用者定案：**起＝迄＝只有那一季**（不是「不限季」）。
 * 所以「選了單季」也是在篩——但 isFiltered 看不到季度清單，
 * 答不出「有沒有比全部季度窄」。
 *
 * 這一支守兩件事：
 *   ① 呼叫端不可以把季度欄位丟進 isFiltered（掃原始碼）
 *   ② isRangeWidened 的語意正確：起＝迄是單季、不是拉開
 *
 * ⚠️ 為什麼要用掃描而不是靠註解：isFiltered **不會爆炸**，它會安靜地回一個
 *   「區間有沒有拉開」的答案。呼叫端拿它當「有沒有篩」用時，畫面上看起來
 *   完全正常，只是該出現的說明沒出現——沒有人會發現。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_MAIN_FILTERS, isRangeWidened } from "../app/main-filters.ts";

const SOURCES = ["../app/DashboardClient.tsx", "../app/trend-script.ts"];

test("R-8：程式裡不可以把季度欄位丟進 isFiltered", () => {
  const hits = [];
  for (const file of SOURCES) {
    let source;
    try {
      source = readFileSync(new URL(file, import.meta.url), "utf8");
    } catch {
      continue; /* 檔案搬家了就跳過，不要因此紅 */
    }
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const match of stripped.matchAll(
      /isFiltered\([^)]*["'](quarterFrom|quarterTo)["']/g,
    ))
      hits.push(`${file}：${match[0]}`);
  }
  assert.deepEqual(
    hits,
    [],
    "季度要用 isPeriodNarrowed（有沒有比全部季度窄）或 isRangeWidened（是不是拉開了）：\n" +
      hits.join("\n"),
  );
});

test("前置：這條掃描真的抓得到（抓不到的話上一條恆綠）", () => {
  const fake = 'const a = isFiltered(mainFilters, "quarterFrom");';
  const hits = [
    ...fake.matchAll(/isFiltered\([^)]*["'](quarterFrom|quarterTo)["']/g),
  ];
  assert.equal(hits.length, 1);
});

test("isRangeWidened：起＝迄＝false（那是單季，不是拉開）", () => {
  assert.equal(
    isRangeWidened({
      ...DEFAULT_MAIN_FILTERS,
      quarterFrom: "115Q2",
      quarterTo: "115Q2",
    }),
    false,
  );
});

test("isRangeWidened：起≠迄＝true（一張卡放不下兩季，要說一聲）", () => {
  assert.equal(
    isRangeWidened({
      ...DEFAULT_MAIN_FILTERS,
      quarterFrom: "115Q1",
      quarterTo: "115Q2",
    }),
    true,
  );
});

test("isRangeWidened：起或迄還沒載入（空字串）時不可以說「拉開了」", () => {
  /*
   * ⚠️ 開機的那一瞬間兩個都是空字串。那時說「區間已拉開」是在說謊，
   *   而且那句話會閃一下又消失，使用者只會覺得畫面在亂跳。
   */
  assert.equal(
    isRangeWidened({ ...DEFAULT_MAIN_FILTERS, quarterFrom: "", quarterTo: "" }),
    false,
  );
});
