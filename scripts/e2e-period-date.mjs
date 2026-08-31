/*
 * 端對端：調查日期 × 季度檢查，以及期別顯示切換（v20.34）。
 *
 * 驗四件事，全部用真的瀏覽器走完整條匯入路徑：
 *   A. 日期落在所選季度內   → 不打擾，直接匯入
 *   B. 日期不在所選季度內   → 檢核報告紅底提示；按「確認匯入」跳二次確認；
 *                             按「取消」不可以寫進去
 *   C. 表頭完全沒有日期     → **不阻擋**，只提醒使用者自行確認
 *   D. 期別顯示可以切成「實際調查月份」，而且切換不改變任何數字
 *
 * 對未修正的 v20.33 應該紅字——量的是畫面文字與寫入結果，
 * 不是「新函式在舊版不存在」那種假證明。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".pdf": "application/pdf", ".docx": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const hourLabel = (h) =>
  `${String(h).padStart(2, "0")}:00～${String((h + 1) % 24).padStart(2, "0")}:00`;

/*
 * 日期刻意放在第 3 列的第 6 欄（F3）——不是固定位置，就是要證明
 * 系統讀的是整塊表頭、不是某一格。dateText 空字串＝表頭沒有日期。
 */
function roadSheet(dateText, base) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["", "", "", "", "", dateText || "", "", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let h = 0; h < 24; h += 1) {
    const cells = [];
    for (let d = 0; d < 2; d += 1)
      for (let v = 0; v < VEHICLES.length; v += 1)
        cells.push(base + h + v * 3 + d * 7);
    rows.push([hourLabel(h), ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function makeFile(dateText, base) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, roadSheet(dateText, base), "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
function makePartiallyDatedFile(base) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    roadSheet("監測日期：115年01月26日(平日)", base),
    "平日",
  );
  XLSX.utils.book_append_sheet(book, roadSheet("", base + 100), "假日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

await new Promise((r) => server.listen(8103, r));
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
let dialogMode = "accept";
const dialogs = [];
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  if (dialogMode === "dismiss" && /調查日期與你選擇的期別不一致/.test(d.message()))
    await d.dismiss();
  else await d.accept(d.type() === "prompt" ? "N" : "");
});

await page.goto("http://localhost:8103/");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("期別檢查測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

const closeLeftovers = async () => {
  for (let i = 0; i < 6 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator('.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
};

/** 開匯入視窗、選季度、送檔，停在檢核報告（還沒按確認）。 */
async function openReportBuffer(name, buffer, quarterText = "115Q1") {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(quarterText);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.waitForTimeout(2600);
}
async function openReport(name, dateText, base, quarterText = "115Q1") {
  await openReportBuffer(name, makeFile(dateText, base), quarterText);
}
const reportAlert = async () => {
  const box = page.locator('[data-testid="period-date-alert"]');
  return (await box.count()) ? (await box.first().innerText()).replace(/\s+/g, " ") : "";
};
const confirmImport = async () => {
  const confirm = page.locator('.modal-backdrop button:has-text("確認")').first();
  if (await confirm.count()) { await confirm.click(); await page.waitForTimeout(2800); }
  await closeLeftovers();
};
/** 目前計畫已寫入幾個調查點——量畫面上的調查點下拉選項數。 */
const roadCount = async () => {
  await page.waitForTimeout(400);
  return page.locator('.filters label:has-text("調查點") select option').count();
};

/* ── A：日期落在所選季度內 ── */
await openReport("A_1月.xlsx", "監測日期：115年01月26日(平日)", 10);
ok("A 日期在季度內時檢核報告沒有期別提示", (await reportAlert()) === "", await reportAlert());
dialogs.length = 0;
await confirmImport();
ok(
  "A 日期在季度內時「確認匯入」不跳期別確認框",
  !dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 120),
);

/* ── B：日期不在所選季度內 ── */
await openReport("B_8月.xlsx", "監測日期：115年08月05日(平日)", 20);
const bAlert = await reportAlert();
ok("B 檢核報告顯眼標示日期與季度不一致", /不一致/.test(bAlert), bAlert.slice(0, 180));
ok("B 提示裡寫出檔案裡的日期", /2026-08-05/.test(bAlert), bAlert.slice(0, 180));
ok("B 提示裡寫出日期屬於哪一季", /115Q3/.test(bAlert), bAlert.slice(0, 180));
ok("B 提示裡寫出來源儲存格", /平日!F3/.test(bAlert), bAlert.slice(0, 180));

const beforeB = await roadCount();
dialogs.length = 0;
dialogMode = "dismiss";
await confirmImport();
ok(
  "B 按「確認匯入」會跳二次確認框",
  dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 160),
);
ok("B 二次確認按「取消」之後沒有寫進去", (await roadCount()) === beforeB, `${beforeB} 個調查點`);

dialogMode = "accept";
await openReport("B_8月.xlsx", "監測日期：115年08月05日(平日)", 20);
dialogs.length = 0;
await confirmImport();
ok("B 二次確認按「確定」之後才寫得進去", (await roadCount()) > beforeB, `${beforeB} → ?`);

/* ── C：表頭讀不到日期，不可以阻擋 ── */
await openReport("C_沒有日期.xlsx", "", 30);
const cAlert = await reportAlert();
ok(
  "C 讀不到日期時用使用者指定的字句提醒",
  /無法辨別日期，所以無法幫忙確認是否符合期別，請自行確認正確性/.test(cAlert),
  cAlert.slice(0, 200),
);
const beforeC = await roadCount();
dialogs.length = 0;
await confirmImport();
ok(
  "C 讀不到日期不跳期別確認框",
  !dialogs.some((m) => /調查日期與你選擇的期別不一致/.test(m)),
  dialogs.join(" | ").slice(0, 120),
);
ok("C 讀不到日期照樣匯得進去（不阻擋）", (await roadCount()) > beforeC, `${beforeC} → ?`);

/* ── C2：同一檔案只有其中一張工作表讀到日期 ── */
await openReportBuffer("C2_一張缺日期.xlsx", makePartiallyDatedFile(35));
const c2Alert = await reportAlert();
ok(
  "C2 平日有日期、假日無日期時，仍明確提醒假日無法辨別",
  /假日/.test(c2Alert) && /無法辨別日期/.test(c2Alert),
  c2Alert.slice(0, 220),
);
ok(
  "C2 部分工作表缺日期不得誤報為期別不一致",
  !/不一致/.test(c2Alert),
  c2Alert.slice(0, 220),
);
await closeLeftovers();

/* ── D：期別顯示切換 ── */
await openReport("D_3月.xlsx", "監測日期：115年03月09日(平日)", 40);
await confirmImport();

const toggle = page.locator('[data-testid="period-display-toggle"]');
const toggleText = async () =>
  (await toggle.count()) ? (await toggle.first().innerText()).trim() : "（沒有這顆按鈕）";
/*
 * 比對用的畫面文字。要排除 .toast——它是會自己消失的暫時訊息，
 * 兩次讀取之間剛好過期就會被誤判成「切換改變了畫面」。
 */
const pageText = async () =>
  (
    await page.evaluate(() => {
      const root = document.querySelector("main") || document.body;
      const clone = root.cloneNode(true);
      clone.querySelectorAll(".toast").forEach((node) => node.remove());
      return clone.innerText || clone.textContent || "";
    })
  ).replace(/\s+/g, " ");
const quarterSelect = async () =>
  (await page.locator('.filters label:has-text("季度") select').first().innerText())
    .replace(/\s+/g, " ")
    .trim();

ok("有期別顯示切換鈕", (await toggle.count()) > 0);
ok("預設顯示季別", /期別顯示：季別/.test(await toggleText()), await toggleText());
ok("季別模式下季度下拉顯示 115Q1", /115Q1/.test(await quarterSelect()), await quarterSelect());

const before = await pageText();
if (await toggle.count()) { await toggle.first().click(); await page.waitForTimeout(700); }
ok("切到「調查月份」", /期別顯示：調查月份/.test(await toggleText()), await toggleText());
const monthText = await quarterSelect();
/*
 * 這一季實際包含 1、3 月（正常匯入）與 8 月（B 那份刻意選錯季度、
 * 二次確認後仍以 115Q1 寫入的）。月份模式要把三個月都列出來——
 * 這正是它的用處：一眼看出這一季裡混進了不該在的月份。
 */
ok(
  "季度下拉改成實際調查月份，三個月都列出來",
  /115年1、3、8月/.test(monthText),
  monthText,
);
const after = await pageText();
/* 期別文字與切換鈕自己的字樣本來就會變，其餘一個字都不可以動。 */
const strip = (t) =>
  t
    .replace(/期別顯示：(季別|調查月份)/g, "§鈕")
    .replace(/115Q1/g, "§")
    .replace(/\d+年[\d、]+月/g, "§");
ok(
  "切換前後畫面上的數字完全相同（只有期別文字變了）",
  strip(before) === strip(after),
  (function () {
    const a = strip(before).split(" ");
    const b = strip(after).split(" ");
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1)
      if (a[i] !== b[i]) diff.push(`#${i} 「${a[i]}」→「${b[i]}」`);
    return diff.slice(0, 6).join("  ") || "（長度不同）";
  })(),
);

/* ── 民國年 ⇄ 西元年顯示切換（v20.39） ──────────────────────
 *
 * 和期別顯示是兩個獨立的開關：期別切「季別／調查月份」，年份切「民國／西元」。
 * 兩個都只換文字。這裡把年份切到西元之後再量一次同一份畫面：
 * 除了年份那幾個字，每一個數字都必須逐字相同。
 */
const yearToggle = page.locator('[data-testid="year-style-toggle"]');
ok("有年份顯示切換鈕", (await yearToggle.count()) > 0);
const yearToggleText = async () =>
  (await yearToggle.count()) ? (await yearToggle.first().innerText()).trim() : "（沒有這顆按鈕）";
ok("預設顯示民國年", /年份顯示：民國年/.test(await yearToggleText()), await yearToggleText());

/* 先切回季別，才量得到「季度字串本身」換了年份寫法。 */
if (await toggle.count()) {
  await toggle.first().click();
  await page.waitForTimeout(700);
}
const rocText = await pageText();
ok("民國年模式下季度下拉是 115Q1", /115Q1/.test(await quarterSelect()), await quarterSelect());

if (await yearToggle.count()) {
  await yearToggle.first().click();
  await page.waitForTimeout(700);
}
ok("切到「西元年」", /年份顯示：西元年/.test(await yearToggleText()), await yearToggleText());
const adQuarter = await quarterSelect();
ok(
  "季度下拉改成 2026Q1，而且不再出現民國年寫法",
  /2026Q1/.test(adQuarter) && !/115Q1/.test(adQuarter),
  adQuarter,
);
const adText = await pageText();
/*
 * 切換鈕自己的字樣本來就會變，季度字樣也是；其餘一個字都不可以動。
 * 這一條是整個切換最重要的保證：只換文字，不動任何數字。
 */
const stripYear = (t) =>
  t.replace(/年份顯示：(民國年|西元年)/g, "§鈕").replace(/(?:115Q1|2026Q1)/g, "§");
ok(
  "切換年份寫法前後畫面上的數字完全相同（只有年份文字變了）",
  stripYear(rocText) === stripYear(adText),
  (function () {
    const a = stripYear(rocText).split(" ");
    const b = stripYear(adText).split(" ");
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1)
      if (a[i] !== b[i]) diff.push(`#${i} 「${a[i]}」→「${b[i]}」`);
    return diff.slice(0, 6).join("  ") || "（長度不同）";
  })(),
);
ok("量到的畫面確實有內容（不是拿空白畫面當通過）", rocText.length > 400, `${rocText.length} 字`);
/*
 * 切成西元年之後，資料顯示的地方不可以再看到民國年寫法的季度。
 *
 * 兩類文字要先排除，否則會永遠紅字：
 *  ・說明文字（.help／.muted／.note）——它們是在**舉例**解釋功能怎麼用
 *   （「想只寫『115Q2 每個路段的全日交通量』」），不是在顯示這批資料的季度。
 *  ・「將存成 115Q1」這種提示——它講的就是「會存成什麼」，本來就該是民國年。
 */
const adDataText = (
  await page.evaluate(() => {
    const root = document.querySelector("main") || document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll(".toast, .help, .muted, .note").forEach((n) => n.remove());
    return clone.innerText || clone.textContent || "";
  })
).replace(/\s+/g, " ");
const leftover = adDataText
  .replace(/將存成[「 ]?\d{2,3}Q[1-4]」?/g, "〔說明文字〕")
  .match(/(?:^|[^0-9])(\d{2,3})Q[1-4](?![0-9])/);
ok(
  "切成西元年之後畫面上看不到民國年寫法的季度",
  !leftover,
  leftover
    ? `…${adDataText.slice(Math.max(0, leftover.index - 25), leftover.index + 25)}…`
    : "",
);

/* 切回民國年，畫面要完全回到原樣 */
if (await yearToggle.count()) {
  await yearToggle.first().click();
  await page.waitForTimeout(700);
}
ok("切回民國年後畫面與切換前逐字相同", (await pageText()) === rocText);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
