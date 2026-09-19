/*
 * ══════════════════════════════════════════════════════════════════════
 *  「期別顯示／年份顯示」兩顆鈕的份量，要和同排的控制項相稱
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「這個 期別顯示:季別 和 年份顯示:民國年，這兩個功能鍵不論是在哪個分頁，
 *     在三個程式裡，都顯得特別大顆，它的大小可以按照所在的分頁或區塊中，
 *     調整成適當的大小嗎?」
 *
 * ⚠️ 這一條**光讀樣式表看不出來**。按鈕自己的 CSS 一直都很小
 *   （padding 5px 12px、font-size 10px），撐大它的是外層版面：
 *   .block-filters 是 repeat(auto-fit, minmax(104px,320px)) 的網格，
 *   按鈕當成格子項目時寬度被拉滿 320px、高度被 stretch 到 49px，
 *   而同一排的下拉選單只有 320×31。**一定要量實際渲染尺寸。**
 *
 * 修正前實測（1600px 視窗）：
 *   .filters（主工具列）       選單 78×34   兩顆鈕 96×27 / 106×27   ← 本來就正常
 *   .block-filters（區塊篩選） 選單 320×31  兩顆鈕 320×49 / 320×49  ← 問題在這
 *
 * 這一支驗三件事，逐一量：
 *   ① 高度不得大於同一排的下拉選單
 *   ② 寬度必須「依文字收斂」——不得被外層拉寬（量自然寬度來比）
 *   ③ 文字不可以被裁（scrollWidth 不得超過 clientWidth）
 *
 * ⚠️ ② 不可以寫成「寬度不得大於同排下拉選單」。
 *   主工具列的季度選單只有 78px（因為「115Q1」很短），而
 *   「年份顯示：民國年」這幾個字本來就要 106px——用選單寬去卡它，
 *   只會逼出一個把文字裁掉的「修正」，而那正是使用者不要的。
 *   要驗的是「**有沒有被外層撐開**」：把同一顆鈕複製一份、設成
 *   width:max-content 量它的自然寬度，實際寬度超過就是被撐開了。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
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

const problems = [];
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(1600);

/*
 * ⚠️ 一定要匯入資料。沒有資料時圖表區塊不會長出來，
 *   出問題的 .block-filters 一個都量不到——那是最糟的假通過。
 */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("鈕尺寸守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "115T1-01_中山路.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx")),
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

let measured = 0;
for (const zone of ["zone-import", "zone-settings", "zone-kpi", "zone-charts", "zone-output"]) {
  await page.locator(`[data-goto="${zone}"]`).first().click();
  await page.waitForTimeout(800);
  const rows = await page.evaluate(() => {
    const out = [];
    for (const bar of document.querySelectorAll(".block-filters, .filters")) {
      const toggles = [...bar.querySelectorAll(".period-display-toggle")];
      if (!toggles.length) continue;
      const sel = bar.querySelector("select");
      if (!sel) continue;
      const s = sel.getBoundingClientRect();
      for (const t of toggles) {
        const r = t.getBoundingClientRect();
        /* 自然寬度：同一顆鈕在「不被外層拉扯」時該有多寬。 */
        const ghost = t.cloneNode(true);
        ghost.style.position = "absolute";
        ghost.style.left = "-9999px";
        ghost.style.top = "0";
        ghost.style.width = "max-content";
        ghost.style.visibility = "hidden";
        document.body.appendChild(ghost);
        const natural = Math.round(ghost.getBoundingClientRect().width);
        ghost.remove();
        out.push({
          bar: bar.className.split(" ")[0],
          text: (t.textContent || "").replace(/\s+/g, " ").trim(),
          w: Math.round(r.width),
          h: Math.round(r.height),
          natural,
          selW: Math.round(s.width),
          selH: Math.round(s.height),
          clipped: t.scrollWidth > t.clientWidth + 1,
        });
      }
    }
    return out;
  });
  for (const r of rows) {
    measured += 1;
    const where = `${zone} ／ .${r.bar} ／「${r.text}」`;
    console.log(
      `${where}  鈕 ${r.w}×${r.h}（自然寬 ${r.natural}）  選單 ${r.selW}×${r.selH}${r.clipped ? "  ⚠️文字被裁" : ""}`,
    );
    if (r.h > r.selH)
      problems.push(`${where}：高度 ${r.h}px 大於同排下拉選單 ${r.selH}px`);
    if (r.w > r.natural + 4)
      problems.push(
        `${where}：寬度 ${r.w}px 被外層撐開（依文字只需要 ${r.natural}px）`,
      );
    if (r.clipped) problems.push(`${where}：文字被裁掉`);
  }
}

/*
 * ⚠️ 前置檢查：真的量到東西了嗎。
 *   一個都沒量到時上面每一條都是恆真——那比紅還糟。
 *   目前畫面上至少有主工具列 1 組（2 顆）＋ 圖表／輸出區塊數組。
 */
if (measured < 6)
  problems.push(
    `只量到 ${measured} 顆鈕（預期 ≥ 6）。量不到的話上面每一條都變成恆真，先確認資料有匯入成功。`,
  );
if (errors.length) problems.push("有 JS 例外：" + errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log(
  `\n✅ 共量 ${measured} 顆：「期別顯示／年份顯示」都不比同排的下拉選單大，文字也沒被裁`,
);
