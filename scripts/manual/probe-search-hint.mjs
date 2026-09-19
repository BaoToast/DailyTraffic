/* 探針：搜尋框下面那一行提示，實際長什麼樣、寫什麼字。 */
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
await new Promise((r) => server.listen(8189, r));

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1536, height: 712 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept(""));
page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message)));
await page.goto("http://localhost:8189/");
await page.waitForTimeout(900);
await page
  .getByRole("button", { name: "＋" })
  .first()
  .click()
  .catch(() => {});
if (
  !(await page
    .locator(".modal input")
    .first()
    .isVisible()
    .catch(() => false))
)
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("搜尋提示探針");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);
for (const [name, quarter] of [["115T1-01_中山路.xlsx", "115Q1"]]) {
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
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(500);
  }
}
await gotoTab(page, TABS.kpi);
const type = async (value) =>
  page.evaluate((v) => {
    const input = document.querySelector("label.search input");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
const read = () =>
  page.evaluate(() => {
    const el = document.querySelector(".search-hint");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { text: el.textContent, color: cs.color, size: cs.fontSize };
  });

for (const term of ["中山", "這個名字一定不存在"]) {
  await type(term);
  await page.waitForTimeout(400);
  console.log(JSON.stringify(term), JSON.stringify(await read()));
  await page.screenshot({
    path: join(here, `probe-search-${term === "中山" ? "hit" : "miss"}.png`),
    clip: { x: 260, y: 130, width: 1270, height: 200 },
  });
}
await browser.close();
server.close();
