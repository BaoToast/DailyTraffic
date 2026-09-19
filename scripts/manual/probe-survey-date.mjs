/* 探針：可追溯明細表裡新增的「調查日」那一行。 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "../chrome-path.mjs";
import { TABS, gotoTab } from "../e2e-nav.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "github-pages", "dist");
const SAMPLES = join(here, "..", "..", ".samples");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8194, r));
const browser = await chromium.launch(launchOptions());
const page = await (await browser.newContext({ viewport: { width: 1536, height: 900 }, locale: "zh-TW" })).newPage();
page.on("dialog", (d) => d.accept(""));
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 160)));
await page.goto("http://localhost:8194/");
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("調查日探針");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);
for (const [name, quarter] of [["115T1-01_中山路.xlsx", "115Q1"], ["115T1-02_中正路口.xlsx", "115Q1"]]) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(quarter);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, name)),
  });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3000); }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!(await closer.count())) break;
    await closer.click(); await page.waitForTimeout(500);
  }
}
await gotoTab(page, TABS.output);
await page.waitForTimeout(800);
console.log(await page.evaluate(() => {
  const out = [];
  for (const t of document.querySelectorAll("#block-detail table, .table-wrap table")) {
    const rows = [...t.querySelectorAll("tbody tr")].slice(0, 3)
      .map((tr) => tr.children[0]?.innerText.replace(/\s+/g, " ").trim());
    if (rows.length) out.push(rows);
  }
  const dates = [...document.querySelectorAll("small.survey-date")].map((s) => s.textContent.trim());
  return JSON.stringify({ firstCells: out.slice(0, 2), dates: dates.slice(0, 5), count: dates.length }, null, 1);
}));
console.log("== localStorage 裡有幾筆帶 surveyDate ==");
console.log(await page.evaluate(() => {
  const out = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    let v; try { v = JSON.parse(localStorage.getItem(k)); } catch { continue; }
    const arr = Array.isArray(v) ? v : Array.isArray(v?.records) ? v.records : null;
    if (!arr || !arr.length || typeof arr[0] !== "object") continue;
    const withDate = arr.filter((r) => r && r.surveyDate).length;
    out.push(`${k}: ${arr.length} 筆，帶 surveyDate ${withDate} 筆，第一筆鍵：${Object.keys(arr[0]).slice(0, 14).join(",")}`);
  }
  return out.join("\n");
}));
const cell = page.locator("small.survey-date").first();
if (await cell.count()) await cell.locator("xpath=ancestor::td[1]").screenshot({ path: join(here, "survey-date.png") });
await browser.close();
server.close();
