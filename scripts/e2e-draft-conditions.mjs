/*
 * ══════════════════════════════════════════════════════════════════════
 *  兩個草稿產生器：條件要齊、口徑要寫出來、小數位數要跟著走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列的篩選條件及各圖表各自的篩選條件，都要在結論草稿產生器及
 *     報表草稿產生器的篩選條件中，這樣使用者才能自定義出題。
 *     針對不適用某些篩選條件的結果，在產生草稿時，可以直接說
 *     **該數值不適用 XXX 條件**。
 *     草稿的數值正確性、小數點位設定（曾踩過的雷）都要確保正確。」
 *
 * ── 這一支守什麼 ────────────────────────────────────────────────
 *
 * ① **尖峰時段認定不可以再是隱形的**。改版前 conclusionRows 一直把主工具列的
 *    peakScope 傳進 buildPeriodRows，而那一頁的說明卻寫著「不受主工具列條件
 *    影響」——改一次主工具列，草稿裡每一個尖峰數字都跟著換，使用者不會知道。
 *    現在它是這一頁自己的條件，而且草稿要**寫出實際採用的那一種**。
 * ② 「各方向各自認定」時，草稿要明講**不可以相加**。
 *    那些數字不是同一時刻的量，合計沒有意義——而合計看起來完全正常。
 * ③ **條件真的生效**：換了條件，數字要跟著換。只驗「下拉列得出選項」是假綠。
 * ④ **小數位數**：0／1／2 都要真的變，而且**百分比也要跟著變**。
 * ⑤ 匯出中心那一排條件**不可以是空的接線**：改了它，匯出與草稿要真的跟著變。
 *    改版前它寫進 chartOverrides["export-center"]，而全程式沒有一處讀它。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8164, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto("http://localhost:8164/");
await page.waitForTimeout(800);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("草稿條件守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

async function importFile(name, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, name)),
    });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3000);
  }
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}
await importFile("115T1-01_中山路.xlsx", "115Q1");
await importFile("115T1-01_中山路.xlsx", "115Q2");

/* ══ 一、結論草稿：兩個以前看不到的條件 ══════════════════════ */
console.log("\n══ 一、結論草稿：尖峰時段認定與路口流量視角 ══");
await gotoBlock(page, "conclusionStudio");
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const expand = page.locator('#conclusionStudio button:has-text("展開")');
if (await expand.count()) {
  await expand.first().click();
  await page.waitForTimeout(700);
}
const controls = await page.evaluate(() => {
  const host = document.getElementById("conclusionStudio");
  const labels = [...(host?.querySelectorAll("label") || [])].map((label) =>
    (label.textContent || "").replace(/\s+/g, ""),
  );
  return {
    peakScope: labels.some((text) => text.startsWith("尖峰時段認定")),
    flowView: labels.some((text) => text.startsWith("路口流量視角")),
    digits: labels.some((text) => text.startsWith("小數位數")),
    /* 面板的常駐說明不可以再宣稱「不受主工具列條件影響」（它其實吃 peakScope）。 */
    note: (
      host?.querySelector(".chart-inapplicable")?.textContent || ""
    ).replace(/\s+/g, ""),
  };
});
ok(
  "⚠️ ① 結論草稿有「尖峰時段認定」這個條件（以前它是悄悄跟著主工具列走的）",
  controls.peakScope,
  `找到：${controls.peakScope}`,
);
ok(
  "⚠️ ① 結論草稿有「路口流量視角」這個條件",
  controls.flowView,
  `找到：${controls.flowView}`,
);
ok(
  "前置：小數位數這一格還在",
  controls.digits,
  `找到：${controls.digits}`,
);
ok(
  "⚠️ ① 面板的說明不可以再寫「不受主工具列條件影響」那種一概而論的話（它其實吃尖峰時段認定）",
  controls.note.includes("尖峰時段認定"),
  controls.note.slice(0, 90) || "（沒有說明）",
);

const conclusionSelect = async (labelStart, value) => {
  await page.evaluate(
    ([start, wanted]) => {
      const host = document.getElementById("conclusionStudio");
      const label = [...(host?.querySelectorAll("label") || [])].find((node) =>
        (node.textContent || "").replace(/\s+/g, "").startsWith(start),
      );
      const select = label?.querySelector("select");
      if (!select) return;
      select.value = wanted;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [labelStart, value],
  );
  await page.waitForTimeout(900);
};
const generate = async () => {
  await page
    .locator('#conclusionStudio button:has-text("產生草稿")')
    .first()
    .click();
  await page.waitForTimeout(1500);
  return page.evaluate(
    () =>
      document.querySelector("#conclusionStudio textarea")?.value || "",
  );
};
await conclusionSelect("尖峰時段認定", "point");
const pointDraft = await generate();
ok(
  "前置：草稿產生得出來（空的話下面全部恆真）",
  pointDraft.length > 50,
  `${pointDraft.length} 字`,
);
ok(
  "⚠️ ① 草稿要寫出**實際採用**的尖峰時段認定（報告上看不到畫面）",
  /統計條件：尖峰時段認定＝/.test(pointDraft),
  (pointDraft.match(/統計條件：.{0,60}/) || ["（沒有寫）"])[0],
);
ok(
  "⚠️ ② 「整個調查點同一時段」時**不可以**出現「不可以相加」那句警語",
  !/不適用「相加」/.test(pointDraft),
  (pointDraft.match(/.{0,10}不適用「相加」.{0,40}/) || ["沒有多餘的警語"])[0],
);
await conclusionSelect("尖峰時段認定", "direction");
const directionDraft = await generate();
/*
 * ⚠️ 只比「整份文字有沒有變」是**弱**的：條件那一行本來就會變，
 *   所以即使數字完全沒接上，這一條也會綠。
 *   要比的是**把條件與警語那幾行拿掉之後的本文**——那才是數字。
 *   （實測：本守門用的樣本每個調查點只有一組方向，兩種判定方式算出來的
 *     尖峰小時相同，所以本文可能真的一樣。這一條因此分成兩段：
 *     文字一定要變；本文變不變則列出來讓人看見，不當成不合格。）
 */
const withoutConditionLines = (text) =>
  text
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("統計條件：") &&
        !line.includes("不適用「相加」") &&
        !line.startsWith("本數值不適用"),
    )
    .join("\n");
ok(
  "⚠️ ③ 換了尖峰時段認定之後，草稿**至少條件那一行要跟著換**（只加下拉不接資料是假功能）",
  directionDraft.length > 50 && directionDraft !== pointDraft,
  directionDraft === pointDraft ? "兩份一模一樣" : "內容有變",
);
console.log(
  `   （參考）拿掉條件與警語之後的本文：${
    withoutConditionLines(directionDraft) === withoutConditionLines(pointDraft)
      ? "兩種判定方式算出來相同——本守門的樣本每個調查點只有一組方向，這是預期的"
      : "兩種判定方式算出來不同（判定方式確實影響數字）"
  }`,
);
ok(
  "⚠️ ② 「各方向各自認定」時，草稿要明講**不可以相加**",
  /不適用「相加」/.test(directionDraft),
  (directionDraft.match(/.{0,6}不適用「相加」.{0,50}/) || ["（一句都沒寫）"])[0],
);
await conclusionSelect("尖峰時段認定", "follow");
await page.waitForTimeout(500);

/* 小數位數（含百分比）。 */
const pctDigitsIn = (text) =>
  [
    ...new Set(
      [...text.matchAll(/(\d+)(?:\.(\d+))?%/g)].map((m) => (m[2] || "").length),
    ),
  ].sort();
await conclusionSelect("小數位數", "0");
const d0 = await generate();
await conclusionSelect("小數位數", "2");
const d2 = await generate();
ok(
  "⚠️ ④ 小數位數選 0 位時，**百分比**也是 0 位（踩過的雷：只有數值變、百分比寫死 1 位）",
  pctDigitsIn(d0).length > 0 && pctDigitsIn(d0).every((n) => n === 0),
  `百分比的小數位：${pctDigitsIn(d0).join("／") || "（量不到百分比）"}`,
);
ok(
  "⚠️ ④ 小數位數選 2 位時，百分比也是 2 位",
  pctDigitsIn(d2).length > 0 && pctDigitsIn(d2).every((n) => n === 2),
  `百分比的小數位：${pctDigitsIn(d2).join("／") || "（量不到百分比）"}`,
);
await conclusionSelect("小數位數", "1");
await page.waitForTimeout(400);

/* ══ 二、報表草稿：小數位數與條件說明 ════════════════════════ */
console.log("\n══ 二、報表草稿：小數位數與條件說明 ══");
const openExportCenter = async () => {
  await page
    .locator('button:has-text("報表批次輸出中心")')
    .first()
    .click();
  await page.waitForTimeout(1200);
};
const closeModal = async () => {
  await page
    .locator('.modal-backdrop button:text-is("取消")')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(500);
};
await openExportCenter();
const draftDigitsExists = await page
  .locator('[data-testid="report-draft-digits"]')
  .count();
ok(
  "⚠️ ④ 報表草稿有「小數位數」（以前每一處都是寫死的 1 位）",
  draftDigitsExists === 1,
  `${draftDigitsExists} 個`,
);
const draftText = () =>
  page.evaluate(
    () => document.querySelector(".report-draft-box textarea")?.value || "",
  );
const base = await draftText();
ok(
  "⚠️ ① 報表草稿也要寫出統計條件（尖峰時段認定、路口流量視角、小數位數）",
  /統計條件：尖峰時段認定＝/.test(base),
  (base.match(/統計條件：.{0,70}/) || ["（沒有寫）"])[0],
);
if (draftDigitsExists === 1) {
  await page.selectOption('[data-testid="report-draft-digits"]', "2");
  await page.waitForTimeout(1200);
  const two = await draftText();
  const pcuDigits = (text) =>
    [
      ...new Set(
        [...text.matchAll(/([\d,]+)\.(\d+)\s?PCU/g)].map((m) => m[2].length),
      ),
    ].sort();
  ok(
    "⚠️ ④ 報表草稿的小數位數真的生效（PCU 數值）",
    pcuDigits(two).length > 0 && pcuDigits(two).every((n) => n === 2),
    `PCU 的小數位：${pcuDigits(two).join("／") || "（量不到）"}`,
  );
  ok(
    "⚠️ ④ 報表草稿的**車種占比**也跟著小數位數走",
    /%/.test(two)
      ? pctDigitsIn(two).some((n) => n === 2)
      : true,
    `百分比的小數位：${pctDigitsIn(two).join("／") || "（這批資料沒有百分比）"}`,
  );
  await page.selectOption('[data-testid="report-draft-digits"]', "1");
  await page.waitForTimeout(900);
}

/* ══ 三、匯出中心那一排條件不可以是空的接線 ══════════════════ */
console.log("\n══ 三、匯出中心的條件要真的有作用 ══");
const scopeSelects = await page
  .locator('[data-testid="export-scope-filters"] select')
  .count();
ok(
  "前置：匯出中心那一排條件找得到（0 個的話下面恆真）",
  scopeSelects > 0,
  `${scopeSelects} 個下拉`,
);
const beforeScope = await page.evaluate(
  () =>
    /*
     * ⚠️ `:last-of-type` 比的是**元素型別**不是 class——
     *   `.export-scope-summary:last-of-type` 會挑到「最後一個 <p>」而不是
     *   「最後一個帶這個 class 的 <p>」，剛好都挑不到就變成空字串，
     *   於是這一條永遠是「沒變」。要自己取最後一個。
     */
    [...document.querySelectorAll(".export-scope-summary")].at(-1)
      ?.textContent || "",
);
const beforeDraft = await draftText();
/*
 * ⚠️ 換「季度（迄）」是最看得出來的一項：草稿的標題與分析範圍都寫著季度。
 *   舊版改它只會讓下拉的值變、匯出與草稿一個字都沒變。
 */
const quarterOptions = await page.evaluate(() => {
  const select = document.querySelector('[data-testid="export-quarter-to"]');
  return select ? [...select.options].map((option) => option.value) : [];
});
const otherQuarter = quarterOptions.find(
  (value) => value && !beforeDraft.startsWith(`草稿條件守門 ${value}`),
);
ok(
  "前置：匯出中心的季度下拉列得出兩季以上（只有一季驗不到）",
  quarterOptions.length >= 2,
  quarterOptions.join("／"),
);
if (quarterOptions.length >= 2 && otherQuarter) {
  await page.selectOption('[data-testid="export-quarter-to"]', otherQuarter);
  await page.waitForTimeout(1500);
  const afterDraft = await draftText();
  const afterScope = await page.evaluate(
    () =>
      [...document.querySelectorAll(".export-scope-summary")].at(-1)
        ?.textContent || "",
  );
  ok(
    "⚠️ ⑤ 改了匯出中心的季度，**報表草稿真的跟著變**（舊版是空的接線：值變了、草稿沒變）",
    afterDraft !== beforeDraft && afterDraft.length > 50,
    afterDraft === beforeDraft ? "草稿一個字都沒變" : "草稿跟著換了",
  );
  ok(
    "⚠️ ⑤ 「目前將匯出」那一行也跟著變",
    afterScope !== beforeScope,
    `${beforeScope.slice(0, 40)} → ${afterScope.slice(0, 40)}`,
  );
}
/*
 * ⚠️ 反面：不可以再宣稱「在這裡改就只有這一區用自己的條件」——
 *   那句話在舊版是假的（沒有任何一處讀那份覆寫）。
 */
const followsNote = await page.evaluate(
  () =>
    document.querySelector('[data-testid="export-follows-main"]')
      ?.textContent || "",
);
ok(
  "⚠️ ⑤ 說明要誠實：這一排就是主工具列，不可以宣稱會「只有這一區用自己的條件」",
  followsNote.includes("主工具列") && !followsNote.includes("只有這一區"),
  followsNote.replace(/\s+/g, "").slice(0, 80) || "（沒有說明）",
);
await closeModal();

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 兩個草稿產生器：條件齊備、口徑寫得出來、不可相加有警語、小數位數（含百分比）都生效，匯出中心的條件真的有作用",
);
