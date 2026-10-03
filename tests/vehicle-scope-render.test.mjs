/*
 * ══════════════════════════════════════════════════════════════════════
 *  B2 的三處呈現：畫面上標、Excel 寫在一旁欄位、圖檔一個字都不加
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 一句話裡定了三件互相不同的事：
 *   ①「圖上當然也要明白標出來」
 *   ②「匯出成 excel 時，可以改為說明行寫在一旁欄位上」
 *   ③「下載為高清晰圖檔時，維持圖版面淨空」
 *
 * ⚠️ 三件事互相矛盾是**刻意**的，所以特別容易被「順手統一」掉：
 *   下一個人看到畫面上有標註、圖檔沒有，很可能覺得是漏掉而補上去。
 *   這一支就是攔那一下。
 *
 * ⚠️ 這裡掃的是原始碼，不是跑瀏覽器——實際畫出來的樣子由
 *   scripts/e2e-chart-png.mjs 與 scripts/e2e-class-coverage.mjs 管。
 *   兩者分工：這一支擋「接線接錯」，e2e 擋「畫出來不對」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const chartPng = readFileSync(new URL("../app/chart-png.ts", import.meta.url), "utf8");
const reportDraft = readFileSync(
  new URL("../app/report-draft.ts", import.meta.url),
  "utf8",
);
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("前置：真的讀到那幾個檔（讀成空字串的話下面全部恆綠）", () => {
  assert.ok(dashboard.length > 100000, `DashboardClient 只讀到 ${dashboard.length} 個字元`);
  assert.ok(chartPng.length > 2000);
  assert.ok(reportDraft.length > 2000);
  assert.ok(css.length > 10000);
});

test("① 畫面：兩張受影響的圖都掛上標註（車種組成、歷季趨勢）", () => {
  /*
   * 為什麼只有這兩張：歸類只會動到「依車種分開的那些數字」。
   * 每小時型態圖畫的是全部車種的合計，歸類換了合計不變，標它是雜訊。
   */
  for (const chartId of ["composition", "trend"])
    assert.ok(
      new RegExp(
        `<ClassificationChangeBanner[\\s\\S]{0,200}chartId="${chartId}"`,
      ).test(dashboard),
      `「${chartId}」這張圖沒有掛上歸類變更標註`,
    );
  assert.equal(
    (dashboard.match(/<ClassificationChangeBanner/g) || []).length,
    2,
    "標註的數量變了——多掛在合計圖上是雜訊，少掛一張是漏標",
  );
});

test("① 標註的文字與計算來自同一份（不可以在畫面上自己寫一套）", () => {
  assert.ok(
    dashboard.includes("classificationChangeLines("),
    "畫面沒有走 classificationChangeLines()",
  );
  assert.ok(
    dashboard.includes("classificationChangesAcross("),
    "畫面沒有走 classificationChangesAcross()",
  );
});

test("① 沒有不一致時整塊不畫（恆亮的警告等於沒有警告）", () => {
  const at = dashboard.indexOf("function ClassificationChangeBanner");
  assert.notEqual(at, -1, "找不到 ClassificationChangeBanner");
  const body = dashboard.slice(at, at + 1200);
  assert.ok(
    /if \(!lines\.length\) return null;/.test(body),
    "沒有「沒有內容就不畫」那一行",
  );
});

test("② Excel：說明寫在一旁的欄位，而且沒有不一致時整欄不加", () => {
  assert.ok(
    dashboard.includes("車種歸類提醒: classificationNote"),
    "Excel 沒有加上「車種歸類提醒」這一欄",
  );
  /* 沒有不一致時要回傳原本那一份，不可以加一個空欄。 */
  const at = dashboard.indexOf("const withClassNote =");
  assert.notEqual(at, -1, "找不到 withClassNote");
  const body = dashboard.slice(at, at + 400);
  assert.ok(
    /classificationNote\s*\?/.test(body) && /:\s*rows/.test(body),
    "withClassNote 沒有「沒有不一致就原樣回傳」的那一支",
  );
  for (const sheet of ["comp", "directionComp"])
    assert.ok(
      dashboard.includes(`add("composition", withClassNote(${sheet})`),
      `「${sheet}」這張工作表沒有帶上說明欄`,
    );
});

test("② Excel：有覆寫時「車種歸類設定」要看得出套用季別與路段", () => {
  assert.ok(dashboard.includes("套用季別:"), "匯出的歸類設定沒有「套用季別」欄");
  assert.ok(dashboard.includes("套用路段:"), "匯出的歸類設定沒有「套用路段」欄");
  assert.ok(
    dashboard.includes("hasClassScope"),
    "沒有「沒有覆寫時不加這兩欄」的判斷——那會動到既有匯出檔",
  );
});

/**
 * 把一段 `const 名稱 = ...` 的函式主體抓出來（括號配對，不用固定字元數）。
 *
 * ⚠️ 原本這一條是「從呼叫點往後抓 4000 個字元」，第一次跑就自己抓錯位置
 *   （抓到一段**註解**裡的 paintToCanvas，然後把 4000 字元外的 JSX 也算進來）。
 *   固定字元數的窗口在大檔案上一定會跨界——那種守門不是恆綠就是恆紅。
 */
function bodyOf(source, name) {
  const at = source.indexOf(`const ${name} = `);
  assert.notEqual(at, -1, `找不到 ${name}`);
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${name} 的括號不成對`);
}

/** 四顆「下載高解析圖片」都在這裡，一個都不能漏掃。 */
const PNG_FUNCTIONS = [
  "downloadTrendPng",
  "downloadHourlyPng",
  "downloadCompositionPng",
  "downloadComparisonPng",
];

test("★③ 高解析圖檔：重畫圖檔的程式裡不可以有這段說明文字", () => {
  /*
   * ⚠️ 這是三條裡最容易被破壞的一條。圖檔是用 paintToCanvas() 重畫的，
   *   只要有人把標註寫進 paint() 的回呼裡，圖檔就會多出一段字，
   *   而使用者是把圖貼到簡報上才會發現——那時候已經交出去了。
   */
  for (const banned of [
    "classificationChangeLines",
    "chartClassificationLines",
    "車種歸類提醒",
    "歸類設定不一致",
  ])
    assert.ok(
      !chartPng.includes(banned),
      `chart-png.ts 裡出現「${banned}」——圖檔要維持版面淨空`,
    );
  for (const name of PNG_FUNCTIONS) {
    const body = bodyOf(dashboard, name);
    for (const banned of [
      "chartClassificationLines",
      "ClassificationChangeBanner",
      "車種歸類提醒",
    ])
      assert.ok(
        !body.includes(banned),
        `${name}() 裡出現「${banned}」——圖檔不可以有說明文字`,
      );
  }
});

test("★③ 前置：那四支真的抓到了，而且真的是在畫圖（否則上一條恆綠）", () => {
  for (const name of PNG_FUNCTIONS) {
    const body = bodyOf(dashboard, name);
    assert.ok(body.length > 120, `${name}() 只抓到 ${body.length} 個字元`);
    assert.ok(
      /paint(ToCanvas|edPngBlob)\(|downloadPaintedPng\(|drawDonutChart\(|drawGroupedBars\(/.test(
        body,
      ),
      `${name}() 裡找不到任何繪圖呼叫——抓到的不是那一支函式`,
    );
  }
});

test("④ 報告草稿：歸類不一致要寫進報告，而且空的時候一個字都不寫", () => {
  assert.ok(
    reportDraft.includes("classificationChanges"),
    "報告草稿沒有收歸類變更",
  );
  assert.ok(
    /for \(const line of c\.classificationChanges \?\? \[\]\)/.test(reportDraft),
    "報告草稿沒有逐條列出歸類變更（空陣列時自然不會寫）",
  );
  assert.ok(
    dashboard.includes("classificationChanges: chartClassificationLines"),
    "報告草稿收到的不是畫面上那一份——兩邊會說出不同的話",
  );
});

test("⑤ 標註有自己的樣式（寫了 class 卻沒有規則＝看不見的警告）", () => {
  for (const klass of ["classification-change-note", "vehicle-class-change-warn"])
    assert.ok(
      css.includes(`.${klass}{`),
      `.${klass} 在 globals.css 裡沒有任何規則——警告會變成一行沒有樣式的字`,
    );
});
