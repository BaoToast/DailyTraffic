// Independent regression: scoped thresholds must survive every backup route.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import ExcelJS from "exceljs";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

const root = fileURLToPath(new URL("../github-pages/dist/", import.meta.url));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const file = join(root, decodeURIComponent(req.url.split("?")[0] === "/" ? "/index.html" : req.url.split("?")[0]));
  if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(8273, resolve));
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({ viewport: { width: 1536, height: 864 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
const problems = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => dialog.accept(dialog.type() === "prompt" ? "TEST" : ""));
function ok(label, condition, detail = "") {
  console.log(`${condition ? "✅" : "❌"} ${label}${condition ? "" : ` — ${detail}`}`);
  if (!condition) problems.push(label);
}
const scopesKey = "traffic-threshold-scopes-by-project-v1";
async function downloadJson(anchor, label) {
  await gotoBlock(page, anchor);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 120000 }),
    page.locator(`#${anchor} button`).filter({ hasText: label }).first().click(),
  ]);
  return JSON.parse(readFileSync(await download.path(), "utf8"));
}
async function restore(payload) {
  await gotoBlock(page, "backup-restore");
  await page.locator('#backup-restore input[type="file"]').setInputFiles({
    name: "scope-roundtrip.json", mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(payload)),
  });
  await page.waitForTimeout(3000);
}
try {
  await page.goto("http://localhost:8273/");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "＋ 建立計畫", exact: true }).first().click();
  await page.locator(".modal-backdrop .modal input").first().fill("門檻覆寫回歸");
  await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
  await page.waitForTimeout(900);
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.locator('.modal-backdrop label:has-text("資料季度") input').fill("115Q1");
  const sample = readFileSync(fileURLToPath(new URL("../.samples/115T1-01_中山路.xlsx", import.meta.url)));
  await page.locator('.modal-backdrop input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: "115T1-01_中山路.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: sample,
  });
  await page.waitForTimeout(2200);
  await page.locator('.modal-backdrop button:has-text("確認")').first().click();
  await page.waitForTimeout(2400);
  for (let i = 0; i < 5 && await page.locator(".modal-backdrop").count(); i++) {
    const close = page.locator('.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!await close.count()) break;
    await close.click(); await page.waitForTimeout(500);
  }
  await gotoBlock(page, "quality-thresholds");
  const picker = page.locator('[data-testid="threshold-scope"] select');
  const input = page.locator("#quality-thresholds .threshold-grid input").first();
  const defaultValue = await input.inputValue();
  await picker.nth(0).selectOption("115Q1");
  await input.fill("93"); await input.blur();
  const id = await page.locator("#projectSwitch").inputValue();
  const expected = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || "{}")[id], { key: scopesKey, id });
  ok("指定季別的門檻確實保存", expected?.[0]?.factors.dailyChangePct === 93);
  await picker.nth(0).selectOption("*");
  ok("計畫預設門檻未被專屬設定改動", await input.inputValue() === defaultValue);
  await page.reload(); await page.waitForTimeout(1300);
  await gotoBlock(page, "quality-thresholds");
  await page.locator('[data-testid="threshold-scope"] select').nth(0).selectOption("115Q1");
  ok("重新整理後專屬門檻仍是 93", await page.locator("#quality-thresholds .threshold-grid input").first().inputValue() === "93");

  const single = await downloadJson("backup-one", "下載本計畫備份");
  const all = await downloadJson("backup-all", "下載全部計畫備份");
  ok("單一計畫備份攜帶完整門檻覆寫", JSON.stringify(single.thresholdScopes) === JSON.stringify(expected));
  ok("全部計畫備份攜帶該計畫自己的門檻覆寫", JSON.stringify(all.projects?.[0]?.thresholdScopes) === JSON.stringify(expected));
  const oldBackup = { ...single }; delete oldBackup.thresholdScopes;
  await restore(oldBackup);
  const oldScopes = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || "{}")[id] ?? [], { key: scopesKey, id });
  ok("舊備份缺少門檻覆寫時清除目的計畫殘留", oldScopes.length === 0);
  // Feed a known field even when the original exporter is defective: both
  // restore assertions then independently detect the omitted restore wiring.
  await restore({ ...single, thresholdScopes: expected });
  const restored = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || "{}")[id] ?? [], { key: scopesKey, id });
  ok("單一計畫還原完整門檻覆寫", JSON.stringify(restored) === JSON.stringify(expected));
  const priorIds = await page.locator("#projectSwitch option").evaluateAll((options) => options.map((o) => o.value));
  await restore({ ...all, projects: all.projects.map((bundle) => ({ ...bundle, thresholdScopes: expected })) });
  const afterIds = await page.locator("#projectSwitch option").evaluateAll((options) => options.map((o) => o.value));
  const newId = afterIds.find((value) => !priorIds.includes(value));
  const copied = await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key) || "{}")[id] ?? [], { key: scopesKey, id: newId });
  ok("全部計畫還原寫到新計畫且完整保留門檻覆寫", Boolean(newId) && JSON.stringify(copied) === JSON.stringify(expected));

  // Actual parser-to-preview proof: modify one time cell in an anonymous file.
  const book = new ExcelJS.Workbook(); await book.xlsx.load(sample);
  let changed = false;
  for (const sheet of book.worksheets) sheet.eachRow((row) => row.eachCell((cell) => {
    if (!changed && typeof cell.value === "string" && /\d{1,2}:00\s*[~～－—–-]\s*\d{1,2}:00/.test(cell.value)) {
      cell.value = "07:00~09:00"; changed = true;
    }
  }));
  assert.ok(changed, "sample must contain an actual time-range cell");
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.locator('.modal-backdrop label:has-text("資料季度") input').fill("115Q1");
  await page.locator('.modal-backdrop input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: "115T1-01_中山路.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  });
  await page.waitForTimeout(2300);
  if (!await page.locator('[data-testid="long-interval-block"]').isVisible())
    console.log("Long-interval diagnostic:", (await page.locator("body").innerText()).slice(-4500));
  ok("兩小時格的匯入預覽有阻擋說明", await page.locator('[data-testid="long-interval-block"]').isVisible());
  ok("兩小時格的確認按鈕停用", await page.locator('.modal-backdrop button:has-text("確認")').first().isDisabled());
  ok("完整操作沒有 JavaScript 例外", errors.length === 0, errors.join(" / "));
  assert.deepEqual(problems, []);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
