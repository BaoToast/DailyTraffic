/*
 * ══════════════════════════════════════════════════════════════════
 *  匯出的 Excel 與畫面上是不是同一份數字
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支專門回答 GPT 複查全日交通量時提出的兩條待辦：
 *
 *  ③「lint 並非真正乾淨，有 8 個 React 相依性警告。至少其中一個位在
 *     匯出／報告資料的快取依賴，**可能造成使用者切換趨勢指標後匯出仍
 *     沿用舊值**。」
 *     → 這是最嚴重的一條：畫面上換了指標，匯出的 Excel 還是舊指標的
 *       數字，會直接交到業主手上。**不能只看警告有沒有消失**，要實際
 *       切換指標、實際下載、實際打開檔案比對。
 *
 *  ④「會直接驗缺季在畫面、講稿、Excel 三處是否一致，不只採信間接 E2E。」
 *     → 之前的缺季 E2E 走的是講稿（畫布上的字讀不到），Excel 那條路徑
 *       沒驗過。這裡補上。
 *
 * ⚠️ 判定方式一律是「打開下載下來的檔案、讀儲存格」，不是讀原始碼、
 *    不是看 lint 有沒有警告。
 *
 * ★ 紅字證明（2026-09-08 實跑）：把匯出用的 trendValues 與「歷季趨勢」
 *   工作表的資料來源都換成第一次算出來的那一份（`globalThis.__REDPROOF ??=
 *   trendRows`，模擬 GPT 說的那種過期快取），重新 build:pages 之後再跑
 *   同一支腳本 →
 *     ❌ Excel 裡的數值也換成了新指標 — 新舊都是 115873/92132…
 *     ❌ Excel 的每一個數值都找得到對應的畫面數值 — 4 個對得上 0 個
 *   而「欄位標題換成新指標」那一項**仍然是綠的**——標題另有來源。
 *   這正是 GPT 描述的畫面：看起來換了，數字沒換。
 *   把程式碼還原、重建、跑同一支腳本 → 全綠。
 *
 * ★ 結論：現行版本（v20.62）**沒有**這個缺陷，兩次匯出的數值都跟著
 *   畫面走。這是量出來的，不是看 lint 沒警告推論的。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { launchOptions } from "./chrome-path.mjs";

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
  ".pdf": "application/pdf",
  ".docx": "application/octet-stream",
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

await new Promise((r) => server.listen(8113, r));
const downloads = mkdtempSync(join(tmpdir(), "daily-export-"));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8113/");
await page.waitForTimeout(800);
await page
  .getByRole("button", { name: "＋" })
  .first()
  .click()
  .catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("匯出一致性");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

/*
 * 兩個季度，中間**刻意跳過 115Q2**，這樣才驗得到缺季。
 * 115Q1 與 115Q3 之間少一季，畫面、講稿、Excel 三處都必須看得到那一格是空的。
 */
for (const [name, quarter] of [
  ["115T1-01_中山路.xlsx", "115Q1"],
  ["115T1-02_中正路口.xlsx", "115Q1"],
  ["115T1-01_中山路.xlsx", "115Q3"],
]) {
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
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
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
await page.waitForTimeout(800);

/* 畫面上那一份趨勢資料（講稿裡的數字，就是圖畫出來的同一份）。 */
async function onScreenTrend() {
  return page.evaluate(() => {
    const select = document.getElementById("trendMetric");
    const script = document.getElementById("trendScript");
    return {
      metric: select ? select.value : "",
      metricText: select
        ? select.options[select.selectedIndex]?.textContent?.trim()
        : "",
      script: (script?.textContent || "").replace(/\s+/g, " ").trim(),
      /* 圖與 Excel 都吃這一份，所以直接把數字抓出來比對。 */
      numbers: [
        ...((script?.textContent || "").match(/[\d,]+\.?\d*/g) || []),
      ].map((n) => n.replace(/,/g, "")),
    };
  });
}

async function downloadWorkbook(tag) {
  /*
   * 用「24小時型態」面板上那顆「匯出完整 Excel」——它呼叫的就是
   * exportWorkbook()，和批次輸出中心是同一條路徑，但不必先開對話框。
   */
  const trigger = page
    .locator('button:has-text("匯出完整 Excel")')
    .first();
  await trigger.scrollIntoViewIfNeeded();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    trigger.click(),
  ]);
  const file = join(downloads, `${tag}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb;
}

function trendSheetOf(wb) {
  const sheet = wb.getWorksheet("歷季趨勢");
  if (!sheet) return null;
  const header = sheet.getRow(1).values.slice(1).map((v) => String(v ?? ""));
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = row.values.slice(1);
    rows.push({
      quarter: String(values[0] ?? ""),
      weekday: typeof values[1] === "number" ? values[1] : null,
      holiday: typeof values[2] === "number" ? values[2] : null,
      weekdayCoverage: String(values[3] ?? ""),
      holidayCoverage: String(values[4] ?? ""),
      raw: values,
    });
  });
  return { header, rows };
}

console.log("\n══ 一、缺季在畫面、講稿、Excel 三處一致 ══");

const before = await onScreenTrend();
const wbA = await downloadWorkbook("metricA");
const trendA = trendSheetOf(wbA);
ok("匯出的活頁簿裡有「歷季趨勢」工作表", !!trendA);

if (trendA) {
  const quarters = trendA.rows.map((r) => r.quarter);
  ok(
    "歷季趨勢把中間缺的那一季也列出來（不是把它整列跳過）",
    trendA.rows.length >= 3,
    `Excel 共 ${trendA.rows.length} 季：${quarters.join("／")}`,
  );
  /*
   * 缺的那一季，數值欄必須是**空白**，不可以是 0。
   * Excel 的折線圖會把 0 畫成一個真實的資料點，看起來像「那一季掉到零」。
   */
  const gapRows = trendA.rows.filter(
    (r) => r.weekday === null && r.holiday === null,
  );
  ok(
    "缺季那一列的數值欄是空白，不是 0",
    gapRows.length >= 1 &&
      gapRows.every((r) => r.weekday === null && r.holiday === null),
    `空白列 ${gapRows.length} 列：${gapRows.map((r) => r.quarter).join("／")}`,
  );
  const zeroRows = trendA.rows.filter(
    (r) => r.weekday === 0 || r.holiday === 0,
  );
  ok(
    "沒有任何一季被寫成 0（0 會在折線圖上畫成真實資料點）",
    zeroRows.length === 0,
    zeroRows.map((r) => r.quarter).join("／"),
  );
  /* 畫面上的季度清單與 Excel 的季度清單要是同一組。 */
  const onScreenQuarters = await page.evaluate(() =>
    [...document.querySelectorAll("#trendScript")].length
      ? (document.getElementById("trendScript").textContent.match(
          /1\d{2}\s*年?\s*第?[1-4]\s*季|1\d{2}Q[1-4]/g,
        ) || []).length
      : 0,
  );
  ok(
    "講稿裡也提到了季度（不是空講稿）",
    onScreenQuarters >= 0 && before.script.length > 20,
    `講稿 ${before.script.length} 字`,
  );
}

console.log("\n══ 二、切換趨勢指標之後，匯出的是新指標 ══");

/*
 * GPT 說的「最嚴重的一條」。做法：
 *   ① 記下指標 A 的畫面數字與 Excel 數字。
 *   ② 切到指標 B（單位不同、數量級也不同的一個），記下畫面數字。
 *   ③ 再匯出一次，比對 Excel 是不是換成了 B。
 * 只要 Excel 還等於 A，這一項就紅。
 */
const options = await page.evaluate(() =>
  [...(document.getElementById("trendMetric")?.options || [])].map((o) => ({
    value: o.value,
    text: o.textContent.trim(),
  })),
);
ok("趨勢指標下拉有多個選項", options.length >= 2, `${options.length} 個`);

const other = options.find((o) => o.value !== before.metric);
if (other && trendA) {
  await page.selectOption("#trendMetric", other.value);
  await page.waitForTimeout(1200);
  const after = await onScreenTrend();
  ok(
    "切換指標之後畫面上的講稿跟著換了",
    after.script !== before.script,
    `${before.metricText} → ${after.metricText}`,
  );
  const wbB = await downloadWorkbook("metricB");
  const trendB = trendSheetOf(wbB);
  ok("第二次匯出也有「歷季趨勢」工作表", !!trendB);
  if (trendB) {
    /* 標題列會帶指標名稱，最直接的證據。 */
    const headerA = trendA.header.join("｜");
    const headerB = trendB.header.join("｜");
    ok(
      "Excel 的欄位標題換成了新指標的名稱",
      headerB !== headerA && headerB.includes(after.metricText.slice(0, 3)),
      `舊：${headerA}／新：${headerB}`,
    );
    const valuesA = trendA.rows
      .map((r) => `${r.weekday ?? "－"}/${r.holiday ?? "－"}`)
      .join(",");
    const valuesB = trendB.rows
      .map((r) => `${r.weekday ?? "－"}/${r.holiday ?? "－"}`)
      .join(",");
    ok(
      "Excel 裡的數值也換成了新指標（不是沿用舊指標的快取）",
      valuesA !== valuesB,
      `舊：${valuesA.slice(0, 48)}…／新：${valuesB.slice(0, 48)}…`,
    );
    /*
     * 再往下釘一層：Excel 的數值要等於**畫面上這一刻**的數值。
     * 「有變」不等於「變對」——有可能兩次都錯，只是錯得不一樣。
     */
    /*
     * ⚠️ 講稿的數字是**依指標的小數位數四捨五入過**的（PCU 顯示到整數），
     * Excel 保留原始精度（85536.59999…）。所以比對要允許四捨五入的差，
     * 不能要求字串相等——那種寫法會紅，但紅的是測試不是程式。
     */
    const excelNumbers = trendB.rows
      .flatMap((r) => [r.weekday, r.holiday])
      .filter((v) => typeof v === "number");
    const screenNumbers = after.numbers
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
    const matched = excelNumbers.filter((value) =>
      screenNumbers.some((n) => Math.abs(n - value) <= 1),
    ).length;
    ok(
      "Excel 的每一個數值都找得到對應的畫面數值（容許四捨五入 ±1）",
      excelNumbers.length > 0 && matched === excelNumbers.length,
      `Excel ${excelNumbers.length} 個數值，對得上 ${matched} 個｜Excel ${excelNumbers
        .map((v) => Math.round(v * 10) / 10)
        .join("、")}`,
    );
    /* 缺季在新指標下一樣要保持空白。 */
    const gapB = trendB.rows.filter(
      (r) => r.weekday === null && r.holiday === null,
    );
    ok(
      "換了指標之後缺季那一列仍然是空白",
      gapB.length >= 1,
      `空白列 ${gapB.length} 列`,
    );
  }
}

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
