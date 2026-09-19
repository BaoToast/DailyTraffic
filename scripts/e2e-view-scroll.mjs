/*
 * ══════════════════════════════════════════════════════════════════════
 *  換分頁的捲動位置：第一次從最上面，回頭接著上次看
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「我在各路口尖峰彙總滑動畫面查看到最底下後，繼續點流量核對工作台，
 *     右側的畫面不是從最上方開始讓我查看，而是從中間開始，以至於我沒發現
 *     上方還有資料。……這項功能請三個程式都要統一。」
 *
 * 三支同一套（app/view-scroll.ts 三份內容一致），所以三支都要有這支測試。
 *
 * ⚠️ 這個 bug 的可怕之處在於它**看起來很正常**：
 *   新的一頁從中間開始顯示，畫面上照樣有標題、有卡片，
 *   使用者不會意識到上面還有一整段沒看到。測試要**直接量 window.scrollY**。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
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
await new Promise((r) => server.listen(8195, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  /* 視窗刻意矮一點，比較容易讓每一頁都捲得動。 */
  viewport: { width: 1500, height: 720 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8195/");
await page.waitForTimeout(1400);

/*
 * ⚠️ X-63（2026-09-17）：側欄多了一層「大分頁」，而捲動記憶是**照大分頁記**的
 *   （一個大分頁＝一個畫面）。所以這裡要點的是大分頁那一顆，
 *   不是分區標題——點分區標題只會落在那一區的第一個大分頁上。
 */
const go = async (title) => {
  await page
    .locator(`.side-nav button[data-goto-page]:has-text("${title}")`)
    .first()
    .click();
  await page.waitForTimeout(700);
};
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
const scrollable = () =>
  page.evaluate(
    () =>
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight,
  );

/*
 * ⚠️ A 要挑一個**真的捲得動**的大分頁。
 *   X-63 把「圖表與比較」拆成四頁之後，每一頁只有一張圖、捲不到 200px，
 *   前置條件會紅——紅的是測資挑錯，不是功能。
 *   「參數設定」那一頁有四張卡，是這一支最穩的捲動場地。
 * ⚠️ C 一定要是這一支**從頭到尾沒去過**的頁（驗「沒去過的從最上面開始」）。
 */
/*
 * ⚠️ A **不可以寫死某一頁**（2026-09-17 的教訓）。
 *   X-68 把頁首那條 128px 的橫幅拿掉、X-78 把主工具列預設收合之後，
 *   「參數設定」那一頁整頁塞得進視窗、**一點都捲不動**，
 *   於是前置「捲得動」變紅——紅的是這裡挑錯場地，不是捲動記憶壞了。
 *   改成**當場挑最長的那一頁**：版面再怎麼改都還是挑得到最長的那一個。
 */
let A = "參數設定";
const B = "資料檢視";
const C = "可追溯明細";
{
  const pageIds = await page.evaluate(() =>
    [...document.querySelectorAll(".side-nav button[data-goto-page]")].map(
      (node) => ({
        id: node.getAttribute("data-goto-page"),
        label: (node.textContent || "").trim(),
      }),
    ),
  );
  let best = null;
  for (const item of pageIds) {
    if (item.label === B || item.label === C) continue;
    await page
      .locator(`.side-nav button[data-goto-page="${item.id}"]`)
      .first()
      .click();
    await page.waitForTimeout(400);
    const room = await scrollable();
    if (!best || room > best.room) best = { ...item, room };
  }
  if (best && best.room > 200) A = best.label;
  console.log(`（挑到最長的大分頁：${A}，可捲 ${best?.room ?? 0}px）`);
  /* 挑場地時每一頁都「去過」了，所以重新整理，讓下面的「第一次」成立。 */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
}

await go(A);
const roomA = await scrollable();
ok(`前置：「${A}」捲得動（不然這支測試測不到東西）`, roomA > 200, `可捲 ${roomA}px`);
const TARGET = Math.min(roomA, 700);
await page.evaluate((y) => window.scrollTo(0, y), TARGET);
await page.waitForTimeout(400);
const leftA = await scrollY();
ok(`前置：在「${A}」捲到 ${TARGET}px`, Math.abs(leftA - TARGET) <= 4, `實際 ${leftA}px`);

await go(B);
const firstB = await scrollY();
ok(
  `① 第一次點進「${B}」，從最上面開始（這正是使用者踩到的那一下）`,
  firstB === 0,
  `scrollY = ${firstB}px（前一頁停在 ${leftA}px）`,
);
const roomB = await scrollable();
const TARGET_B = Math.min(roomB, 300);
await page.evaluate((y) => window.scrollTo(0, y), TARGET_B);
await page.waitForTimeout(400);
const leftB = await scrollY();

await go(A);
const backA = await scrollY();
ok(
  `② 回到「${A}」，停在上次中斷的地方（不是回到最上面）`,
  Math.abs(backA - leftA) <= 8,
  `回來是 ${backA}px，離開時是 ${leftA}px`,
);

await go(B);
const backB = await scrollY();
ok(
  `③ 第二次進「${B}」也停在上次的位置（第二次就不算第一次了）`,
  Math.abs(backB - leftB) <= 8,
  `回來是 ${backB}px，離開時是 ${leftB}px`,
);

await go(A);
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(300);
await go(C);
const firstC = await scrollY();
ok(
  `④ 沒去過的「${C}」照樣從最上面開始（不是只有那兩頁被特別處理）`,
  firstC === 0,
  `scrollY = ${firstC}px`,
);

/* ══ ⑤ 每一個大分頁第一次進去都要在最上面（X-77）════════════════
 *
 * 使用者 2026-09-17（附兩張圖）：
 *   「我點選各分類 或 大分頁 小分頁時，右側跳轉的畫面，就要正確。
 *     明明第一次進入，畫面應該要在最上方，結果都出現在中間偏下的地方」
 *
 * ⚠️ 上面第④條只驗了**一頁**。使用者是在「各分類／各大分頁／各小分頁」
 *   都遇到，所以這裡**逐頁**走一遍——漏掉的那一頁才是會被回報的那一頁。
 *
 * ⚠️ 每一頁之前都先把畫面捲下去，否則「本來就在 0」與「真的捲回 0」
 *   分不出來，整段變成恆真。
 */
const allPages = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav button[data-goto-page]")].map(
    (node) => node.getAttribute("data-goto-page"),
  ),
);
ok(
  "前置：側欄列得出全部大分頁（0 個的話下一條恆真）",
  allPages.length >= 10,
  `${allPages.length} 個`,
);
/* 重新整理，讓每一頁都算「第一次進來」。 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const notAtTop = [];
for (const pageId of allPages) {
  /* 先捲下去，製造「上一頁停在很下面」的狀態。 */
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(150);
  await page
    .locator(`.side-nav button[data-goto-page="${pageId}"]`)
    .first()
    .click();
  await page.waitForTimeout(600);
  const y = await scrollY();
  if (y > 8) notAtTop.push(`${pageId}=${y}px`);
}
ok(
  "⚠️ ⑤ 每一個大分頁第一次進去都停在最上面",
  notAtTop.length === 0,
  notAtTop.join("、") || `${allPages.length} 頁都在最上面`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 第一次進分頁從最上面，回頭接著上次看");
