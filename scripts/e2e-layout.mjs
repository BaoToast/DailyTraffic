/*
 * 排版量測：把畫面灌上真實資料後，用瀏覽器實際量出來的座標判斷有沒有
 * 沾黏或溢出。量三件事：整頁橫向溢出、卡片標題貼邊、卡片內表格未對齊。
 * 只印數字與判定，不靠截圖目視。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, gotoBlock } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".docx": "application/octet-stream" };
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
await new Promise((r) => server.listen(8103, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 }, locale: "zh-TW" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8103/");
await page.waitForTimeout(800);
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("排版量測計畫");
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
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
  if (await apply.count()) { await apply.first().click(); await page.waitForTimeout(500); }
  const geo = page.locator('.intersection-manager-modal button:has-text("關閉"), .intersection-manager-modal button:has-text("取消")');
  if (await geo.count()) { await geo.first().click(); await page.waitForTimeout(600); }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!(await closer.count())) break;
    await closer.click(); await page.waitForTimeout(400);
  }
}
/* 展開結論草稿產生器，否則量不到那一區。它在「明細與產出」分頁上。 */
await gotoBlock(page, "conclusionStudio");
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
await page.locator('#conclusionStudio button:has-text("展開")').click();
await page.waitForTimeout(1200);

async function measure() {
  return page.evaluate(() => {
    const view = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - view;
    const content = document.querySelector(".content") || document.body;
    const wide = [];
    if (overflow > 1)
      for (const el of document.querySelectorAll("body *")) {
        const box = el.getBoundingClientRect();
        if (box.right > view + 1 && box.width > 0 && getComputedStyle(el).overflowX !== "auto")
          wide.push(el.tagName + "." + String(el.className).slice(0, 30) + "@" + Math.round(box.right));
      }
    /*
     * ── 按鈕文字被裁掉 ────────────────────────────────────────
     *
     * 使用者 2026-09-16：「不要再出現文字超過按鍵大小或被背景色遮蔽的狀況」。
     *
     * ⚠️ 既有的「橫向溢出」抓不到這一種：按鈕本身乖乖待在版面裡，
     *   溢出的是**按鈕裡面的字**。判準是 scrollWidth > clientWidth。
     * ⚠️ 沒畫出來的按鈕一律跳過，否則整支恆紅。
     *
     * ⚠️ X-81（2026-09-17）補：原本**只量 <button> 自己**，漏掉了
     *   「overflow:hidden 同時套在按鈕裡面那一層」的情形——字是在裡面那一層
     *   被裁的，button 自己量起來剛剛好，整條恆綠。使用者親眼看到
     *   「五　資料產出與維護」被裁成「…與維」，這支卻是全綠的。
     *   所以連按鈕**裡面**的元素一起量。
     */
    const clippedButtons = [];
    for (const el of document.querySelectorAll("button")) {
      if (!el.getClientRects().length) continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      for (const node of [el, ...el.querySelectorAll("*")]) {
        if (!node.getClientRects().length) continue;
        const inner = (node.textContent || "").trim();
        if (!inner) continue;
        /* 捲動容器是刻意的，不算被裁。 */
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") continue;
        const over = node.scrollWidth - node.clientWidth;
        if (over > 1) {
          clippedButtons.push(
            `「${text.slice(0, 16)}」多 ${Math.round(over)}px${
              node === el ? "" : `（裁在 <${node.tagName.toLowerCase()}> 這一層）`
            }`,
          );
          break;
        }
      }
    }
    const flushHeads = [];
    const misaligned = [];
    for (const card of content.querySelectorAll(".panel")) {
      const cardBox = card.getBoundingClientRect();
      if (cardBox.height < 8) continue;
      const heads = [...card.querySelectorAll(".panel-title h3, .panel-title span, legend")].filter((el) => el.closest(".panel") === card);
      if (!heads.length) continue;
      for (const head of heads) {
        const hb = head.getBoundingClientRect();
        if (hb.width > 0 && hb.left - cardBox.left < 6)
          flushHeads.push(String(card.className).slice(0, 24) + "「" + (head.textContent || "").trim().slice(0, 16) + "」" + Math.round(hb.left - cardBox.left) + "px");
      }
      const headLeft = Math.min(...heads.map((el) => el.getBoundingClientRect().left));
      for (const el of card.querySelectorAll("table th:first-child, table td:first-child")) {
        if (el.closest(".panel") !== card) continue;
        if (!(el.textContent || "").trim()) continue;
        const textLeft = el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).paddingLeft) || 0);
        if (textLeft - headLeft < -3) {
          misaligned.push(String(card.className).slice(0, 24) + "「" + (el.textContent || "").trim().slice(0, 12) + "」少 " + Math.round(headLeft - textLeft) + "px");
          break;
        }
      }
    }
    return { overflow, wide: wide.slice(0, 4), flushHeads: flushHeads.slice(0, 4), misaligned: misaligned.slice(0, 4), clippedButtons: clippedButtons.slice(0, 6) };
  });
}

/*
 * ⚠️ v20.64 改成分頁式之後，「量整頁」只會量到目前那一頁。
 * 使用者交代過：「**掃描要涵蓋每一個分頁，不是只掃有圖表的那幾頁**」。
 * 所以這裡是 **寬度 × 分頁** 的兩層迴圈——10 個寬度 × 5 頁 ＝ 50 次量測。
 *
 * ⚠️ 不可以只掃預設那一頁然後說「乾淨」。改版會讓每一頁的斷點重新洗牌，
 * 舊的量測結果一項都不能沿用。
 */
console.log("\n══ 多寬度 × 五個分頁掃描 ══");
const ZONES = [
  [TABS.import, "匯入"],
  [TABS.settings, "設定"],
  [TABS.kpi, "數字"],
  [TABS.charts, "圖表"],
  [TABS.output, "明細"],
];
for (const width of [640, 760, 900, 1024, 1100, 1280, 1440, 1500, 1680, 1920]) {
  await page.setViewportSize({ width, height: 1050 });
  await page.waitForTimeout(400);
  for (const [zoneId, zoneName] of ZONES) {
    await gotoTab(page, zoneId);
    await page.waitForTimeout(320);
    const m = await measure();
    const bad = [];
    if (m.overflow > 1) bad.push(`溢出 ${m.overflow}px（${m.wide[0] || ""}）`);
    if (m.flushHeads.length) bad.push(`標題貼邊 ${m.flushHeads.length} 處：${m.flushHeads[0]}`);
    if (m.misaligned.length) bad.push(`表格未對齊 ${m.misaligned.length} 處：${m.misaligned[0]}`);
    if (m.clippedButtons.length)
      bad.push(`按鈕文字被裁 ${m.clippedButtons.length} 處：${m.clippedButtons[0]}`);
    ok(`寬度 ${width}px・${zoneName}頁 乾淨`, bad.length === 0, bad.join("；"));
  }
}

/*
 * Claude 的 v20.79→v20.81 交付紀錄另指名兩組常見筆電／縮放後視窗：
 * 1536×864 與 1366×768。上面的寬度掃描高度固定為 1050px，不能取代這兩組
 * 實際可視高度；因此逐頁再量一次，避免矮視窗把文字、按鈕或圖表裁掉。
 */
for (const [width, height] of [[1536, 864], [1366, 768]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  for (const [zoneId, zoneName] of ZONES) {
    await gotoTab(page, zoneId);
    await page.waitForTimeout(320);
    const m = await measure();
    const bad = [];
    if (m.overflow > 1) bad.push(`溢出 ${m.overflow}px（${m.wide[0] || ""}）`);
    if (m.flushHeads.length) bad.push(`標題貼邊 ${m.flushHeads.length} 處：${m.flushHeads[0]}`);
    if (m.misaligned.length) bad.push(`表格未對齊 ${m.misaligned.length} 處：${m.misaligned[0]}`);
    if (m.clippedButtons.length)
      bad.push(`按鈕文字被裁 ${m.clippedButtons.length} 處：${m.clippedButtons[0]}`);
    ok(`${width}×${height}・${zoneName}頁 乾淨`, bad.length === 0, bad.join("；"));
  }
}
ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));
/*
 * ── 篩選列的下拉選單不可以被超長選項撐爆 ──
 *
 * 使用者實際遇到的情形：把每個調查點的車流方向都改成有意義的名稱之後，
 * 「全部調查點」下那個選項會把 14 個名稱用「／」串起來，<select> 就橫向
 * 撐滿整個畫面，右邊的搜尋框被推出視窗外。
 *
 * ⚠️ 篩選列在分頁之外（五頁共用），所以停在哪一頁都量得到；
 * 但視窗寬度剛剛被上面那個迴圈改成 1920，先設回一個會出事的寬度。
 */
{
  await page.setViewportSize({ width: 1100, height: 1050 });
  await page.waitForTimeout(400);
  const measured = await page.evaluate(() => {
    const target = [...document.querySelectorAll(".filters > label")].find((label) =>
      label.textContent.includes("車流方向"),
    );
    if (!target) return null;
    const select = target.querySelector("select");
    const option = document.createElement("option");
    option.value = "__LONG__";
    option.textContent =
      "西行(往示範路一)／東行(往示範路二)／北上(往示範路三)／南下(往示範路四)／東行(往示範路五)／西行(往示範路六)／北上(往示範路七)";
    select.appendChild(option);
    select.value = "__LONG__";
    const filters = document.querySelector(".filters");
    return {
      selectWidth: select.getBoundingClientRect().width,
      filtersWidth: filters.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  if (measured) {
    ok(
      "超長的車流方向選項不會撐爆篩選列",
      measured.selectWidth <= measured.filtersWidth + 1,
      `選單 ${Math.round(measured.selectWidth)}px／篩選列 ${Math.round(measured.filtersWidth)}px`,
    );
    ok(
      "超長的車流方向選項不會造成整頁橫向捲動",
      measured.overflow <= 2,
      `溢出 ${measured.overflow}px`,
    );
  }
}

await browser.close();
server.close();
console.log(problems.length ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ") : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
