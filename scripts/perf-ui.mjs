/*
 * ══════════════════════════════════════════════════════════════════════
 *  畫面實測：使用者真的會等的那幾件事，各花多少毫秒
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-23：
 *   「請確保程式性能上不要有 Lag 情況發生……要能順暢跑每一筆資料」
 *   「如果效能上不會有延遲問題，沒做改變也是合理的」
 *
 * ── 這一支和 tests/perf-scaling.test.mjs 的分工 ────────────────
 *
 * `tests/perf-scaling.test.mjs` 守的是**演算法的成長形狀**（純函式，
 * 資料 ×10 時間不可以 ×100）。那一支跑在每一次 `npm test` 裡。
 *
 * 這一支不同：它開真的瀏覽器、走真的畫面，量的是**使用者會盯著等**的
 * 那幾個動作——切分頁、改篩選條件、產生草稿、畫圖。純函式再快，如果
 * React 每次按一下就把整棵樹重算一遍，使用者一樣會覺得卡。
 *
 * ⚠️ **這一支刻意不是測試、不掛進 `npm run e2e`。**
 *   它印的是絕對毫秒數，而絕對毫秒數在不同機器上差好幾倍
 *   （這個容器只有 2 顆 CPU、沒有 GPU）。把它做成會紅的測試，
 *   只會變成「有時候紅、重跑就綠」，最後被關掉。
 *   它的用途是**交付前跑一次、把數字寫進文件**，以及日後懷疑變慢時
 *   拿同一支再跑一次做比較。
 *
 * 用法：
 *   npm run build:pages && npm run samples && node scripts/perf-ui.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoTab, gotoBlock, TABS } from "./e2e-nav.mjs";

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
if (!existsSync(ROOT))
  throw new Error(`找不到 ${ROOT}——請先執行 npm run build:pages`);
if (!existsSync(SAMPLES))
  throw new Error(`找不到 ${SAMPLES}——請先執行 npm run samples`);

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
await new Promise((r) => server.listen(8199, r));

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

const rows = [];
/**
 * 量一個動作花多久。
 *
 * ⚠️ 量的是「按下去 → 畫面真的畫完」，不是「按下去就回來」。
 *   所以每一次都等兩個 requestAnimationFrame——React 更新完、瀏覽器
 *   也真的畫上去，才算數。只等 promise resolve 會量到一個漂亮但假的數字。
 */
async function timed(label, action) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const started = Date.now();
  await action();
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const ms = Date.now() - started;
  rows.push([label, ms]);
  console.log(`  ${String(ms).padStart(6)} ms  ${label}`);
  return ms;
}

await page.goto("http://localhost:8199/");
await page.waitForTimeout(800);
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("效能量測計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

/*
 * 灌資料：同一批樣本灌進**多個季度**，資料量才像累積了幾年的實務案。
 * 只灌一季的話，量出來的數字沒有意義——使用者抱怨卡，一定是累積之後。
 */
const QUARTERS = ["114Q1", "114Q2", "114Q3", "114Q4", "115Q1", "115Q2"];
const FILES = ["115T1-01_中山路.xlsx", "115T1-02_中正路口.xlsx"];
console.log("\n══ 匯入（每一季 2 個調查點，共 " + QUARTERS.length + " 季）══");
for (const quarter of QUARTERS)
  for (const name of FILES) {
    await page.locator('.toolbar button:has-text("匯入資料")').first().click();
    await page.waitForTimeout(300);
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
    await page.waitForTimeout(2200);
    const confirm = page.locator('.modal-backdrop button:has-text("確認")');
    if (await confirm.count()) {
      await confirm.first().click();
      await page.waitForTimeout(2500);
    }
    for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
      const closer = page
        .locator(
          '.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
        )
        .first();
      if (!(await closer.count())) break;
      await closer.click();
      await page.waitForTimeout(350);
    }
  }

const recordCount = await page.evaluate(() =>
  document.body.innerText.match(/共\s*([\d,]+)\s*列/)?.[1] ?? "?",
);
console.log(`\n灌進去的資料：${QUARTERS.length} 季 × ${FILES.length} 個調查點`);

console.log("\n══ 使用者會盯著等的動作 ══");
/*
 * ⚠️ 先量一個**什麼都不做**的基準線。
 *
 *   `timed()` 本身就有固定成本：兩次 requestAnimationFrame（等畫面真的
 *   畫完）＋ Playwright 與瀏覽器之間的來回。不先量這個的話，
 *   下面每一項的數字都看不出「哪些是真的在算、哪些只是這支腳本的開銷」——
 *   而那正是最容易讓人去優化一個不存在的問題的地方。
 */
await timed("（基準線：什麼都不做）", async () => {});
for (const [name, zoneId] of Object.entries(TABS))
  await timed(`切到分區「${name}」`, async () => {
    await gotoTab(page, zoneId);
  });

/*
 * ⚠️ 找不到控制項時要**大聲失敗**，不可以 `.catch(() => {})` 吞掉。
 *   第一版就是那樣寫的，結果 Playwright 在一個不存在的選擇器上等滿
 *   30 秒逾時，被吞掉之後這一項印出「30032 ms」——看起來像程式卡了
 *   30 秒，實際上是**量測腳本自己壞了**。
 *   一支會印出假數字的效能量測，比沒有量測更糟：它會讓人去「優化」
 *   一個不存在的問題，或反過來把真的變慢當成又是腳本壞了。
 */
/* ⚠️ X-78：主工具列預設是**收合**的，不先展開就量不到它的欄位。 */
await timed("展開主工具列", async () => {
  await page.locator('[data-testid="mt-toggle"]').first().click();
  await page.waitForTimeout(150);
});
const quarterFrom = page.locator('[data-testid="mt-quarter-from"]').first();
if (!(await quarterFrom.count()))
  throw new Error(
    '找不到「季度（起）」的下拉——主工具列的結構改了？請修這支腳本，不要讓它靜靜地量出假數字。',
  );
const quarterOptions = await quarterFrom.locator("option").count();
await timed(`改季度篩選（拉到最早那一季，共 ${quarterOptions} 個選項）`, async () => {
  await quarterFrom.selectOption({ index: quarterOptions - 1 });
});
await timed("改季度篩選（拉回最新那一季）", async () => {
  await quarterFrom.selectOption({ index: 0 });
});

await gotoBlock(page, "conclusionStudio");
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
const expand = page.locator('#conclusionStudio button:has-text("展開")');
if (await expand.count()) {
  await timed("展開結論草稿產生器", async () => {
    await expand.first().click();
    await page.waitForTimeout(100);
  });
}
const generate = page.locator('#conclusionStudio button:has-text("產生")');
if (await generate.count())
  await timed("產生結論草稿", async () => {
    await generate.first().click();
    await page.waitForTimeout(100);
  });

console.log("\n══ 結果 ══");
const worst = rows.reduce((a, b) => (b[1] > a[1] ? b : a), ["—", 0]);
console.log(`最慢的一項：${worst[0]} = ${worst[1]} ms`);
console.log(`資料列數（畫面自述）：${recordCount}`);
console.log(
  errors.length ? `⚠️ 有 ${errors.length} 個 JS 例外：${errors.slice(0, 3).join(" | ")}` : "沒有 JS 例外",
);
console.log(
  "\n⚠️ 判讀提醒：`gotoTab()` 內含一個**刻意的** 250ms 等待（等換頁捲動停下來），" +
    "所以「切到分區」那幾項的數字裡有 250ms 是等待、約 34ms 是這支腳本自己的開銷，" +
    "真正在算的大約只有剩下的幾十毫秒。不要把 330ms 讀成「換頁要跑 330ms」。",
);
console.log(
  "\n⚠️ 這些是**這台機器**（2 CPU、無 GPU 的 Linux 容器）的數字，" +
    "不等於使用者 Windows 筆電的體感。判讀時看的是「有沒有哪一項離群」，" +
    "以及與上一版同一支腳本的數字比較，不是拿絕對值去對一個標準。",
);

await browser.close();
server.close();
