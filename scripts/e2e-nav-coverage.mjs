/*
 * ══════════════════════════════════════════════════════════════════════
 *  盤點：每一個大分頁底下「該有」幾個小分頁，實際列了幾個
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「大分頁下面有小分頁（例如各種圖的名稱作為小分頁
 * 名稱）……利用大小分頁讓人知道各種圖、功能分別在哪。」
 *
 * ⚠️ e2e-nav-target 驗的是「**列出來的**那一項，畫面上找得到、框得起來」。
 *   它驗不到「該列的有沒有漏列」——一頁有五塊、只列兩塊，照樣全綠。
 *   2026-09-13 用同樣的盤點在另外兩支各抓到一批漏列（路口轉向 4 頁、
 *   交通服務水準 7 頁），所以三支都要有這一道。
 *
 * 判定「一塊」：目前這一個分頁裡有自己標題（h2／h3）、而且畫得出高度的
 * 最外層卡片。純說明的小方塊不算。
 *
 * ⚠️ 這一支用**空資料**跑。有資料時每一塊都畫得出來，漏列反而不容易看出
 *   哪些是「真的沒有」；而且空資料是使用者第一次開啟時看到的畫面。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages", "dist");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = http.createServer((req, res) => {
  let path = join(
    root,
    decodeURIComponent(req.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (existsSync(path) && statSync(path).isDirectory())
    path = join(path, "index.html");
  if (!existsSync(path)) path = join(root, "index.html");
  res.writeHead(200, {
    "content-type": TYPES[extname(path)] || "application/octet-stream",
  });
  res.end(readFileSync(path));
});
await new Promise((ok) => server.listen(0, ok));

/*
 * 這幾個分頁畫面上沒有「有標題的獨立卡片」可列（整頁就是一張大表、
 * 或內容要有資料才長出來）。⚠️ 之後若長出卡片，下面會紅——
 * 那時要補小分頁，不是把名字加進這個名單。
 */
const NO_BLOCKS = new Set([]);

const problems = [];
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForTimeout(1600);

/*
 * ⚠️ 一定要先建一個計畫。完全沒有計畫時每一頁都是空的，
 *   「畫面上有幾塊」量到 0，這一支就變成恆真——那是最糟的假通過。
 *   用**空計畫**（0 季度、0 筆），與 e2e-nav-target 同一個情境：
 *   那也是使用者第一次開啟時看到的畫面。
 */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("盤點用空計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(1400);

const zones = await page.evaluate(() =>
  [...document.querySelectorAll("[data-goto]")].map((el) => ({
    id: el.getAttribute("data-goto"),
    label: (el.textContent || "").replace(/\s+/g, " ").trim(),
  })),
);

console.log(`${"大分頁".padEnd(20)}${"小分頁".padEnd(8)}${"畫面卡片".padEnd(10)}落差`);
console.log("─".repeat(72));
for (const zone of zones) {
  await page.locator(`[data-goto="${zone.id}"]`).first().click();
  await page.waitForTimeout(700);
  const info = await page.evaluate((zoneId) => {
    const group = document
      .querySelector(`[data-goto="${zoneId}"]`)
      ?.parentElement?.querySelector(".side-nav-items");
    /*
     * 只算「捲到本頁某一塊」那種項目。帶 → 記號的是開視窗的動作，
     * 不是這一頁上的一塊，不該拿來和卡片數對照。
     */
    const listed = group
      ? [...group.querySelectorAll(".side-nav-item")]
          .filter((el) => !el.querySelector(".side-nav-mark"))
          .map((el) => (el.textContent || "").replace(/\s+/g, " ").trim())
      : [];
    const blocks = [];
    /*
     * ⚠️ 這一支的「一塊」是 id 以 block-／card- 開頭的區塊（見 NAV 的 anchor），
     *   不是 .panel——有些塊根本沒有 .panel 類別（例如 block-quality 是
     *   .quality-strip）。用類別去抓會量到 0，而 0 會讓這一支變成恆真。
     */
    /*
     * ⚠️ 明講出來的豁免：純說明的區塊**刻意不列**成小分頁。
     *
     * 使用者 2026-09-13：「小分頁中，如果那個欄位是純粹的說明文字、
     *   沒有任何功用的話，不用特地做成小分頁在左側欄位，三個程式都是如此。」
     *
     * ⚠️ 這一支目前**一個都沒有**（這支的小分頁全部是資料或動作）。
     *   機制照樣放著，三支的規則才一致；以後真的加了純說明的區塊，
     *   標上去就會被跳過，而下面同時檢查標記名副其實——
     *   標了純說明卻有按鈕／輸入／表格，一樣要紅。
     */
    const mislabelled = [];
    for (const el of document.querySelectorAll("[data-nav-skip='explanation']")) {
      const interactive = el.querySelectorAll(
        "button, input, select, textarea, table, a[download]",
      ).length;
      if (interactive)
        mislabelled.push(
          `${(el.querySelector("h2, h3")?.textContent || el.id || "?").trim().slice(0, 20)}（有 ${interactive} 個可操作元素）`,
        );
    }
    const candidates = [
      ...document.querySelectorAll(
        '[id^="block-"], [id^="card-"], [id="periodAnalysis"], [id="conclusionStudio"], [id^="backup-"]',
      ),
    ].filter(
      (el) =>
        el.getBoundingClientRect().height >= 20 &&
        !el.closest("[data-nav-skip='explanation']"),
    );
    for (const el of candidates) {
      /*
       * ⚠️ 只算**最內層**的那一塊。
       *   有些 id 是外層的容器（block-kpi 包著三張 card-kpi-*、
       *   block-backup 包著四個 backup-*、block-managers 包著四張 card-*），
       *   側欄列的是裡面那幾張、不是容器本身——把容器也算成一塊的話，
       *   會報一個其實不存在的落差，然後有人為了讓它變綠去列一個
       *   沒有意義的「容器」小分頁。
       */
      if (candidates.some((other) => other !== el && el.contains(other))) continue;
      blocks.push(el.id);
    }
    const anchors = group
      ? [...group.querySelectorAll(".side-nav-item")]
          .filter((el) => !el.querySelector(".side-nav-mark"))
          .map((el) => el.getAttribute("data-anchor") || "")
      : [];
    return { listed, blocks: [...new Set(blocks)], anchors, mislabelled };
  }, zone.id);
  /* 側欄列的是中文標籤，畫面上的是 id——用 NAV 的對照表比。 */
  const missing = info.blocks.filter((id) => !info.anchors.includes(id));
  console.log(
    `${zone.label.padEnd(20)}${String(info.listed.length).padEnd(8)}${String(info.blocks.length).padEnd(10)}${
      missing.length ? "⚠️ 少 " + missing.length + "：" + missing.join("、").slice(0, 60) : ""
    }`,
  );
  for (const item of info.mislabelled ?? [])
    problems.push(
      `${zone.label}：「${item}」被標成「純說明」，但它有可操作的元素——標記名不副實`,
    );
  if (missing.length)
    problems.push(
      `${zone.label}：畫面上有「${missing.join("、")}」，側欄沒有列出來`,
    );
  if (NO_BLOCKS.has(zone.label) && info.blocks.length)
    problems.push(
      `${zone.label}：已列在「沒有可列卡片」的名單裡，畫面上卻有 ${info.blocks.length} 塊`,
    );
}

if (errors.length) problems.push("有 JS 例外：" + errors.slice(0, 2).join(" | "));
await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 每一個大分頁底下，畫面上有幾塊就列得出幾個小分頁");
