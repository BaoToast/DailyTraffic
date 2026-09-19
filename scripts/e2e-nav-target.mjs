/*
 * ══════════════════════════════════════════════════════════════════════
 *  側欄列得出來的每一項，畫面上都要找得到對應的那一塊
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12（附截圖）：
 *   「我點選建立與管理計畫，所以中間『建立與管理計畫』變成顯眼。但我按了本季總覽，
 *     畫面跳到第二張圖那樣，我完全看不出本季總覽是什麼用途?」
 *
 * 成因：「本季總覽」那一塊的渲染條件是 `activeProject && quarter`。
 * 他當下切到的計畫是剛建好的（0 個季度、0 筆資料），quarter 是空字串，
 * **整個區塊根本沒有被畫出來**。側欄那一項照樣點得下去、照樣變成
 * 「目前這一項」，但畫面上什麼都沒發生。
 *
 * ⚠️ 這比壞掉更糟：**功能看起來像故障，而使用者無從得知原因**。
 *   沒有任何錯誤訊息、沒有任何提示，他只會覺得「這個按鈕壞了」或
 *   「我看不懂這個功能」——兩種結論都是錯的，而且他不會再按第二次。
 *
 * 所以這一支不是驗「有沒有這個按鈕」，是驗**空資料狀態下**
 * 每一個側欄錨點都還找得到對應的區塊、而且點下去真的被框起來。
 *
 * ⚠️ 一定要用**空的計畫**測。有資料時每一塊都畫得出來，
 *   這個洞一項都抓不到，而測試會全綠。
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
await new Promise((r) => server.listen(8205, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
await page.goto("http://localhost:8205/");
await page.waitForTimeout(1400);

/* 一個**完全空的**計畫——0 個季度、0 筆資料，就是使用者當下的情況。 */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("空計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(1000);

/*
 * 側欄上所有「錨點型」的子項目。
 * 開視窗型（action）的不算——那種本來就不是跳到頁面上的某一塊。
 * 這裡認的是 data-goto-item 有值、而且點下去會設定 focusedBlock 的那些。
 */
const zones = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav-group")].map((group) => ({
    title: (group.querySelector("button > span")?.textContent || "").trim(),
    items: [...group.querySelectorAll(".side-nav-item")].map((el) => ({
      label: el.getAttribute("data-goto-item") || "",
      /* 「捲到本頁的…」＝錨點型；「開啟…視窗」＝開視窗型。 */
      anchor: (el.getAttribute("title") || "").startsWith("捲到本頁"),
    })),
  })),
);
const anchors = zones.flatMap((zone) =>
  zone.items.filter((item) => item.anchor).map((item) => ({ zone: zone.title, ...item })),
);
ok(
  "前置：抓得到側欄的錨點型子項目",
  anchors.length >= 5,
  anchors.map((a) => a.label).join("、") || "一個都沒有",
);

console.log("\n══ 空計畫（0 季度、0 筆資料）下逐項點過去 ══");
for (const item of anchors) {
  /* 先進到那一個分區，子項目才會展開。 */
  await page
    .locator(`.side-nav-group > button:has-text("${item.zone}")`)
    .first()
    .click();
  await page.waitForTimeout(500);
  await page
    .locator(`.side-nav-item[data-goto-item="${item.label}"]`)
    .first()
    .click();
  await page.waitForTimeout(700);
  const landed = await page.evaluate(() => {
    const el = document.querySelector(".is-focused");
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return {
      id: el.id,
      outline: parseFloat(getComputedStyle(el).outlineWidth || "0"),
      height: Math.round(box.height),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      /*
       * X-58（使用者 2026-09-17，路口轉向那一支抓到的）：
       *   「『資料異常檢查摘要』這個標題在欄位中沒看到，請修正」
       * 側欄列得出來、點得到、框得起來——但那一塊上面沒有那個名字，
       * 使用者跳過去之後對不上自己剛剛點了什麼。
       * ⚠️ 用 innerText（不是 textContent）：要的是**看得到**的字。
       */
      /*
       * ⚠️ 這一支的「區塊名稱」不一定是 <h3>。
       *   這支的面板抬頭長這樣：
       *     <div class="panel-title"><div>
       *        <span>車種組成</span>          ← **名字在這裡**
       *        <h3>平日・全部調查點・全部方向</h3>  ← 這是條件，會跟著篩選變
       *     </div>…
       *   KPI 卡則是直接 `<span>全日實際交通量</span>`。
       *   所以要掃的是「抬頭區」：標題標籤 ＋ 抬頭用的 span，
       *   不是只有 h1~h4——只掃標題標籤會把一堆本來就寫對的區塊判成紅。
       *   還有第三、第四種寫法：`<strong>路段／路口主檔管理</strong>`、
       *   `<b>清除本機資料</b>`、以及包在 <div> 裡的 <span>（PCU 當量係數）。
       *   這一支沒有統一的抬頭元素，所以只能掃「短標籤類」的元素。
       * ⚠️ 但也不可以整塊掃 textContent：那樣內文裡剛好提到那四個字
       *   也會算過，等於沒驗。所以限定**40 字以內**——標題是短的，
       *   內文段落不會落進來。
       */
      headings: [
        ...el.querySelectorAll("h1,h2,h3,h4,summary,strong,b,span,.eyebrow"),
      ]
        .map((node) => (node.innerText || "").replace(/\s+/g, " ").trim())
        .filter((text) => text && text.length <= 40),
    };
  });
  /*
   * ⚠️ 三件事一起驗，缺一不可：
   *   ・找得到那一塊（不是整個沒被渲染）
   *   ・框畫得出來（使用者看得出是「這一塊」）
   *   ・裡面**真的有字**（空殼子和沒有一樣：他還是不知道這是什麼）
   */
  ok(
    `「${item.label}」點下去找得到對應的區塊並框起來`,
    Boolean(landed) && landed.outline > 0 && landed.height > 20,
    landed
      ? `#${landed.id} 外框 ${landed.outline}px、高 ${landed.height}px`
      : "畫面上完全沒有任何區塊被點名（＝那一塊沒有被畫出來）",
  );
  if (landed) {
    ok(
      `「${item.label}」那一塊沒有資料時也說得出它是什麼／為什麼是空的`,
      landed.text.length >= 6,
      landed.text || "整塊沒有任何文字",
    );
    /*
     * ⚠️ X-58：側欄那一項的名字，在它指到的那一塊上要**看得到**。
     *   只驗「有字」是不夠的——那一塊可能滿滿都是字，就是沒有它自己的標題
     *   （路口轉向的「資料異常檢查摘要」就是這樣：一句灰字加四張卡，
     *     整塊沒有任何標題）。
     * ⚠️ 用 includes 比對（不是完全相等）：有些標題後面帶副標，
     *   例如「可追溯明細・路段格式」——那仍然看得出是同一件事。
     */
    ok(
      `⚠️ 「${item.label}」那一塊上面看得到自己的標題`,
      landed.headings.some((text) => text.includes(item.label)),
      landed.headings.join("／") || "（整塊一個標題都沒有）",
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 空計畫下，側欄每一項都找得到對應的那一塊");
