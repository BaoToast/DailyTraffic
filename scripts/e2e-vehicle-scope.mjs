/**
 * 端對端：車種歸類「依季別／路段」覆寫（B2，使用者 2026-09-30 裁示）
 *
 * 她的原話裡有三件事，而且互相不同：
 *   ①「圖上當然也要明白標出來」
 *   ②「匯出成 excel 時，可以改為說明行寫在一旁欄位上」
 *   ③「下載為高清晰圖檔時，維持圖版面淨空」
 * 加上兩句驗收標準：
 *   「**務必確認功能正常，且沒影響到其他功能**」
 *   「車種歸類**沒使用上時 就照原本正常功能去走**」
 *
 * ⚠️ 單元測試與原始碼守門證明不了「畫面真的能用」。這一支是**真的去點**：
 *   選季別 → 改歸類 → 按套用 → 看標註 → 看另一季有沒有被動到。
 *
 * 守門條目：
 *   ⓪ 預設停在「全季別 × 全路段」，而且**沒有任何標註**（不碰它＝改版前）
 *   ① 只改 115Q2 的歸類 → 套用後兩張圖出現標註，字裡要有車種名與「不同季別之間」
 *   ② ⚠️ **反面**：115Q1 的數字必須一格都沒動
 *   ③ ★ 圖版面淨空的**直接證明**：把畫面上的標註整個移除，再下載一次圖檔，
 *      兩次的 PNG 必須**逐位元相同**——相同就代表標註從來沒進過繪圖路徑。
 *   ④ 重新整理之後覆寫還在（真的寫進瀏覽器儲存）
 *   ⑤ ⚠️ **反面**：把 115Q2 改回與計畫預設相同 → 標註必須整塊消失
 *      （恆亮的標註等於沒有標註）
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";
import ExcelJS from "exceljs";
import JSZip from "jszip";

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
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8271, r));

const problems = [];
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object" ? (condition ? "" : detail.failOnly) : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("dialog", (d) => d.accept());
const downloads = [];
page.on("download", (d) => downloads.push(d));
await page.goto("http://localhost:8271/");
await page.waitForTimeout(1200);

/* ── 前置：建計畫並把同一份樣本匯入兩個季度 ── */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("車種歸類範圍測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(800);

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
  await page.waitForTimeout(2600);
  for (const label of ["確認", "套用車種設定", "關閉", "取消"]) {
    const button = page.locator(`.modal-backdrop button:has-text("${label}")`);
    if (await button.count()) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(1400);
    }
  }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}
/*
 * ⚠️ 用**季別**做對照組，不是換檔名做兩條路段：
 *   路段名稱讀的是**檔案內容**，兩份內容相同的檔案會被認成同一條路
 *  （e2e-factor-scope 第一版就踩過這個坑）。季別是匯入時自己填的，一定分得開，
 *   而且季別正是 B2 最危險的那個維度（歷季趨勢會被歸類變更污染）。
 */
await importFile("115T1-01_中山路.xlsx", "115Q1");
await page.waitForTimeout(600);
await importFile("115T1-01_中山路.xlsx", "115Q2");
await page.waitForTimeout(900);

/**
 * 把主工具列的季度區間**起迄都設成同一季**。
 *
 * ⚠️ 第一版只設了一個下拉，結果車種組成那一塊算的是**兩季合計**
 *   （它吃的是 quarterFrom～quarterTo 這個區間）。於是「115Q1 沒被動到」
 *   那一條看到的是 2,916 輛＝兩季相加，改了 115Q2 當然也會變——
 *   我差點把那當成「Q2 的設定污染了 Q1」的缺陷回報出去。
 *   ⚠️ 教訓：**斷言之前要先確認畫面上那個數字的範圍是什麼**。
 */
const switchQuarter = async (quarter) => {
  const applied = await page.evaluate((value) => {
    const set = (testId) => {
      const select = document.querySelector(`[data-testid="${testId}"]`);
      if (!select || ![...select.options].some((o) => o.value === value)) return "";
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value;
    };
    /* ⚠️ 先設起始再設結束：結束季度會把起始季度往前帶（起＝迄＝單季的預設行為）。 */
    const from = set("mt-quarter-from");
    const to = set("mt-quarter-to");
    return from === value && to === value ? value : `${from || "?"}~${to || "?"}`;
  }, quarter);
  await page.waitForTimeout(900);
  if (applied !== quarter)
    throw new Error(`季度區間設不成單季 ${quarter}（目前 ${applied}）`);
};

/** 某一季的車種組成明細，逐格比對用。 */
const compositionOf = async (quarter) => {
  await switchQuarter(quarter);
  /*
   * ⚠️ 一定要走 gotoBlock：X-63 之後**別的大分頁的內容不在 DOM 裡**，
   *   停在錯的頁上讀到的是空陣列——那會讓「兩季相同」永遠成立。
   */
  await gotoBlock(page, "block-composition");
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const out = [];
    /*
     * ⚠️ 選擇器要對。第一版寫 `.donut-legend li, .composition-table tbody tr`，
     *   兩個都不存在，於是兩季都讀到 0 列——「兩季相同」就變成在比兩個空陣列，
     *   而那一條會**通過**。假綠比沒有測試更糟，所以下面加了「真的讀到東西」的前置。
     *   實際的容器是 .composition-list（旁邊那張圓環是 .donut）。
     */
    /*
     * ⚠️ 一列一個字串（不是逐個葉節點）。逐葉節點的話插入一列會讓整串位移，
     *   比對只會說「第一處差異在某個百分比」，看不出真正發生什麼事。
     *   實際的容器是 .composition-list（旁邊那張圓環是 .donut）。
     */
    for (const row of document.querySelectorAll(".composition-list > *")) {
      const text = (row.textContent || "").replace(/\s+/g, " ").trim();
      if (text) out.push(text);
    }
    return out;
  });
};

const bannerLines = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="classification-change-note"]')].map(
      (el) => ({
        chart: el.getAttribute("data-chart"),
        text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      }),
    ),
  );

/** 打開車種管理視窗。 */
const openManager = async () => {
  await gotoBlock(page, "card-vehicle-class");
  await page.waitForTimeout(500);
  await page
    .locator('button:has-text("車種分類與新增當量")')
    .first()
    .click();
  await page.waitForTimeout(700);
  return page.locator(".vehicle-class-modal");
};

console.log("\n══ ⓪ 預設：全季別 × 全路段，沒有任何標註 ══");
const beforeQ1 = await compositionOf("115Q1");
const beforeQ2 = await compositionOf("115Q2");
ok(
  "⓪ 前置：兩季都讀到車種組成（讀不到的話下面全部是在比空陣列）",
  beforeQ1.length > 0 && beforeQ2.length > 0,
  `115Q1 ${beforeQ1.length} 列／115Q2 ${beforeQ2.length} 列`,
);
ok("⓪ 還沒設任何覆寫時，圖上沒有標註", (await bannerLines()).length === 0);

const modal = await openManager();
ok("⓪ 管理視窗打得開", await modal.isVisible().catch(() => false));
const scopeState = await page
  .locator('[data-testid="vehicle-class-scope-state"]')
  .textContent()
  .catch(() => "");
ok(
  "⓪ 預設停在「全計畫預設」",
  /全計畫預設/.test(scopeState || ""),
  failOnly(`目前寫的是「${(scopeState || "").slice(0, 40)}」`),
);

console.log("\n══ ① 只改 115Q2 的歸類 ══");
/* 選 115Q2 這個範圍 */
const picked = await page.evaluate(() => {
  const box = document.querySelector('[data-testid="vehicle-class-scope"]');
  const select = box?.querySelector("select");
  const option = [...(select?.options || [])].find((o) => o.value !== "*");
  if (!select || !option) return "";
  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return option.value;
});
await page.waitForTimeout(600);
ok("① 選得到一個季別範圍", Boolean(picked), `選到「${picked}」`);
/* 把「大型車」改成歸類至特種車 */
const changed = await page.evaluate(() => {
  for (const row of document.querySelectorAll(".vehicle-class-modal tbody tr")) {
    const name = (row.querySelector("strong")?.textContent || "").trim();
    if (name !== "大貨車") continue;
    const select = row.querySelector("select");
    const option = [...(select?.options || [])].find((o) =>
      (o.textContent || "").includes("歸類至特種車"),
    );
    if (!select || !option) return "";
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  }
  return "";
});
await page.waitForTimeout(400);
ok("① 改得動「大貨車 → 歸類至特種車」", Boolean(changed), `選到 ${changed}`);
await page
  .locator('.vehicle-class-modal button[type="submit"], .vehicle-class-modal button:has-text("套用")')
  .first()
  .click();
await page.waitForTimeout(1200);

await switchQuarter("115Q2");
/*
 * ⚠️ 兩張圖在**不同的大分頁**上，同一個畫面看不到兩個標註
 *  （第一版我用 new Set(...).size >= 2 去驗，那在 X-63 之後必然失敗）。
 *   所以逐塊走過去各看一次。
 */
const notesPerChart = {};
for (const [anchor, chartId] of [
  ["block-composition", "composition"],
  ["block-trend", "trend"],
]) {
  await gotoBlock(page, anchor);
  await page.waitForTimeout(900);
  notesPerChart[chartId] = (await bannerLines()).filter((n) => n.chart === chartId);
  ok(
    `① 「${chartId}」這張圖出現標註`,
    notesPerChart[chartId].length === 1,
    failOnly(`找到 ${notesPerChart[chartId].length} 個`),
  );
}
const notes = [...notesPerChart.composition, ...notesPerChart.trend];
ok(
  "① 標註寫出是哪一個車種",
  notes.some((n) => n.text.includes("大貨車")),
  failOnly(notes[0]?.text?.slice(0, 80) || "沒有標註"),
);
ok(
  "① 標註寫出「不同季別之間」與「不可以直接比較」",
  notes.some((n) => n.text.includes("不同季別之間") && n.text.includes("不可以直接比較")),
  failOnly(notes[0]?.text?.slice(0, 120) || "沒有標註"),
);

console.log("\n══ ② 反面：115Q1 一格都沒動 ══");
const afterQ1 = await compositionOf("115Q1");
console.log("   改動前 115Q1：", JSON.stringify(beforeQ1));
console.log("   改動後 115Q1：", JSON.stringify(afterQ1));
/*
 * ⚠️ 判準分兩半，因為「完全一樣」太嚴格而「有差異就算了」太鬆：
 *
 *   ① **原有的每一列必須一字不差**——任何一個輛數或百分比變了就是缺陷。
 *   ② **新增的列只能是 0 輛**。
 *
 * 為什麼會多一列：車種清單（vehicleCatalog）是**整個計畫**的聯集，
 * 115Q2 把大貨車歸到特種車之後，「特種車」就成為這個計畫的一個類別，
 * 於是 115Q1 也會列出它、數值 0。這**不是新的行為**：
 * 原本只要某一季沒有某個車種（例如只有 Q2 有聯結車），那一季就已經是列 0。
 * 所以這裡放它過，但**釘住它只能是 0**——一旦那個 0 變成別的數字，
 * 就代表別季的設定真的污染了這一季。
 */
ok(
  "② 115Q1 原有的每一列一字不差（任何一個數字變了都算缺陷）",
  beforeQ1.every((row) => afterQ1.includes(row)),
  failOnly(
    "被改掉或不見的列：" +
      beforeQ1.filter((row) => !afterQ1.includes(row)).join(" ／ "),
  ),
);
const addedRows = afterQ1.filter((row) => !beforeQ1.includes(row));
ok(
  "② 多出來的列只能是 0 輛（多出一個有數字的類別＝別季的設定污染了這一季）",
  addedRows.every((row) => /(^|[^\d])0 輛$/.test(row)),
  failOnly(`多出來的列：${addedRows.join(" ／ ") || "（沒有）"}`),
);
const afterQ2 = await compositionOf("115Q2");
ok(
  "② 前置：115Q2 真的變了（沒變的話上面那一條證明不了任何事）",
  JSON.stringify(afterQ2) !== JSON.stringify(beforeQ2),
  failOnly("115Q2 的數字沒有變——覆寫根本沒生效"),
);

console.log("\n══ ★③ 圖版面淨空：移除畫面上的標註，圖檔要逐位元相同 ══");
await switchQuarter("115Q2");
await gotoBlock(page, "block-composition");
await page.waitForTimeout(800);
const pngBytes = async () => {
  downloads.length = 0;
  const button = page.locator('[data-chart-png="composition"]').first();
  if (!(await button.count())) return null;
  await button.click();
  for (let i = 0; i < 40 && !downloads.length; i += 1) await page.waitForTimeout(150);
  if (!downloads.length) return null;
  return readFileSync(await downloads[0].path());
};
const withBanner = await pngBytes();
ok("★③ 前置：標註還在畫面上，而且下載得到圖檔", Boolean(withBanner) && (await bannerLines()).length > 0);
await page.evaluate(() =>
  document
    .querySelectorAll('[data-testid="classification-change-note"]')
    .forEach((el) => el.remove()),
);
await page.waitForTimeout(400);
const withoutBanner = await pngBytes();
ok(
  "★③ 把標註整個移除之後，圖檔逐位元相同（＝標註從來沒進過繪圖路徑）",
  Boolean(withBanner) &&
    Boolean(withoutBanner) &&
    Buffer.compare(withBanner, withoutBanner) === 0,
  failOnly(
    withBanner && withoutBanner
      ? `兩次圖檔不一樣（${withBanner.length} vs ${withoutBanner.length} 位元組）——說明文字被畫進圖裡了`
      : "有一次下載不到圖檔",
  ),
);

console.log("\n══ ④ 重新整理之後覆寫還在 ══");
await page.reload();
await page.waitForTimeout(1600);
await switchQuarter("115Q2");
await gotoBlock(page, "block-composition");
await page.waitForTimeout(900);
ok("④ 重新整理後標註還在（設定真的寫進瀏覽器儲存）", (await bannerLines()).length === 1);

console.log("\n══ ⑤ 反面：改回一致之後標註要消失 ══");
// The normal downloadable workbook is assembled separately from legacy .xls.
// Read its actual cells; source checks in the legacy branch cannot prove this.
await gotoBlock(page, "block-hourly");
const [xlsxDownload] = await Promise.all([
  page.waitForEvent("download", { timeout: 120000 }),
  page.locator('button:has-text("匯出完整 Excel")').first().click(),
]);
const workbook = new ExcelJS.Workbook();
// Generated Office QA workbooks must stay outside the repository. The
// dependency-manifest guard intentionally rejects every in-repo spreadsheet.
const exportDir = join(tmpdir(), "dailytraffic-v2094-exports");
mkdirSync(exportDir, { recursive: true });
const exportedPath = join(exportDir, "vehicle-scope.xlsx");
await xlsxDownload.saveAs(exportedPath);
await workbook.xlsx.readFile(exportedPath);
for (const name of ["歷季車種組成", "方向別車種組成"]) {
  const sheet = workbook.getWorksheet(name);
  const noteColumn = sheet?.getRow(1).values.findIndex((v) => v === "車種歸類提醒") ?? -1;
  ok(`⑥ 正式 xlsx「${name}」有歸類提醒`, noteColumn > 0);
  ok(`⑥ 正式 xlsx「${name}」逐列寫出不可比較`,
    Boolean(sheet) && sheet.rowCount > 1 && noteColumn > 0 &&
      sheet.getRows(2, sheet.rowCount - 1).every((row) =>
        String(row.getCell(noteColumn).value).includes("不可以直接比較")));
}
const classSheet = workbook.getWorksheet("車種歸類設定");
const nativeZip = await JSZip.loadAsync(readFileSync(exportedPath));
const nativeCharts = await Promise.all(Object.keys(nativeZip.files)
  .filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name))
  .map(name => nativeZip.file(name).async("string")));
const ratioChart = nativeCharts.find(xml => xml.includes("車種組成比例趨勢"));
ok("⑥ 正式 xlsx 原生比例趨勢縱軸為百分比", Boolean(ratioChart) && /formatCode="0\.0%"/.test(ratioChart));
const lineCharts = nativeCharts.filter(xml => xml.includes("<c:lineChart>"));
ok("⑥ 正式 xlsx 原生趨勢具有可見連線", lineCharts.length >= 3 && lineCharts
  .every(xml => /<a:ln[^>]*><a:solidFill>/.test(xml) && !/<a:ln[^>]*><a:noFill/.test(xml)));
const doughnutChart = nativeCharts.find(xml => xml.includes("<c:doughnutChart>"));
ok("⑥ 正式 xlsx 甜甜圈使用圖例及旁表，沒有凍結選單切換前的標籤狀態",
  Boolean(doughnutChart) && /<c:showCatName val="0"/.test(doughnutChart) &&
  /<c:showPercent val="0"/.test(doughnutChart) && !/<c:dLbl>/.test(doughnutChart) &&
  doughnutChart.includes("<c:legend>") && doughnutChart.includes("'可編輯圖表'!$AB$"));
ok("⑥ 正式 xlsx 歸類設定包含季別與路段維度",
  Boolean(classSheet) && classSheet.getRow(1).values.includes("套用季別") &&
    classSheet.getRow(1).values.includes("套用路段"));
ok("⑥ 正式 xlsx 保留套用到特種車的季別設定",
  Boolean(classSheet) && classSheet.getRows(2, classSheet.rowCount - 1).some((row) =>
    row.getCell(1).value === "大貨車" && row.getCell(2).value === "特種車" &&
      String(row.getCell(4).value).includes(picked)));
await openManager();
await page.evaluate((value) => {
  const box = document.querySelector('[data-testid="vehicle-class-scope"]');
  const select = box?.querySelector("select");
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, picked);
await page.waitForTimeout(600);
await page.evaluate(() => {
  for (const row of document.querySelectorAll(".vehicle-class-modal tbody tr")) {
    const name = (row.querySelector("strong")?.textContent || "").trim();
    if (name !== "大貨車") continue;
    const select = row.querySelector("select");
    const option = [...(select?.options || [])].find((o) =>
      (o.textContent || "").includes("獨立分析"),
    );
    if (select && option) {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
});
await page.waitForTimeout(400);
await page
  .locator('.vehicle-class-modal button[type="submit"], .vehicle-class-modal button:has-text("套用")')
  .first()
  .click();
await page.waitForTimeout(1200);
await switchQuarter("115Q2");
await gotoBlock(page, "block-composition");
await page.waitForTimeout(900);
ok(
  "⑤ 歸類改回一致之後，標註整塊消失（恆亮的標註等於沒有標註）",
  (await bannerLines()).length === 0,
  failOnly("標註還在——它變成恆亮的了"),
);
const endQ1 = await compositionOf("115Q1");
ok(
  "⑤ 115Q1 從頭到尾一格都沒被動過",
  JSON.stringify(endQ1) === JSON.stringify(beforeQ1),
  failOnly("115Q1 在這一連串操作之後變了"),
);

ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
