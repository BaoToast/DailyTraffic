/**
 * ══════════════════════════════════════════════════════════════════════
 *  吸頂的東西不可以被主工具列蓋住——而且要跟著它的實際高度走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支守的是 2026-09-15 查到的**既有缺陷**（三支同一個坑）：
 *   `.trend-pinned` 的 `top` 原本寫死 8px。那是**主工具列還沒加進來
 *   之前**算的，主工具列 2026-09-15 起常駐在上方，所以捲動時歷季趨勢圖
 *   的上緣會被工具列切掉——與使用者回報過的
 *   「圖標題和單位就消失在畫面了」是同一個症狀。
 *
 * ── 為什麼不能改寫死一個新數字 ──────────────────────────────────
 *
 * 主工具列的高度**會變**：可以收合、窄視窗時欄位換行會長高、
 * 「回歸全部（N 塊）」那一顆有時候在有時候不在。
 * 寫死的話：收合時留一大段空白、展開時又被切掉——兩種都錯。
 * 所以改成由 DashboardClient 量實際高度寫進 `--main-toolbar-h`，
 * 吸頂的東西一律用 `--sticky-top`。
 *
 * ⚠️ 這一支的 `--sticky-top` **沒有** `--topbar-h`：全日交通量的標題列
 *   不是 sticky（捲上去就不見了），與另外兩支不同，不要互相照抄。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**只驗 CSS 字串是 `var(--sticky-top)` 不算數。** 變數可能沒被寫、
 *     可能寫錯值、可能被更具體的規則蓋過。這裡**真的捲動**，再量座標。
 * 二、**只驗「圖的 top ≥ 0」不算數。** 被工具列蓋住時 top 仍然是正的
 *    （它只是躲在工具列後面）。要比的是**工具列的下緣**。
 * 三、**前置要先確認圖真的黏住了。** 沒有 sticky 的元素捲走之後 top 會變成
 *     負的，那時「top ≥ 工具列下緣」自然不成立——但紅的原因不是被蓋住。
 * 四、**要驗收合與展開兩種狀態。** 只驗一種的話，一個寫死數字的實作
 *     在那一種狀態下剛好會過。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";

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
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
await new Promise((r) => server.listen(8191, r));
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1500, height: 900 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept("N"));

await page.goto("http://localhost:8191/");
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(900);
await page
  .getByRole("button", { name: "＋" })
  .first()
  .click()
  .catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("吸頂守門用計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

const base = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
async function importAs(quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name: "115T1-01_中山路.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: base,
    });
  await page.waitForTimeout(2800);
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
/* 至少兩季才畫得出趨勢線；只有一季的話下面全部變成恆真。 */
await importAs("115Q1");
await importAs("115Q2");
/*
 * ⚠️ 先切到圖表頁再開始量。
 *   停在別的頁面可能**捲不動**（scrollY 永遠是 0），而 sticky 的 top
 *   要等到「捲到它要黏住」的時候才看得出來——在捲不動的頁面上量，
 *   等於量了一條恆真的假檢查。
 */
/* ⚠️ X-63：釘住區在「歷季分析」那一頁，而且那一頁才捲得動。 */
await gotoBlock(page, "block-trend");
await page.waitForTimeout(1200);

/* ══ 一、--main-toolbar-h 要等於主工具列的實際高度 ══════════════ */
console.log("\n══ 一、CSS 變數要跟著實際高度走 ══");

const measure = () =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    const root = getComputedStyle(document.documentElement);
    const box = bar?.getBoundingClientRect();
    return {
      varPx: Number.parseFloat(root.getPropertyValue("--main-toolbar-h")) || 0,
      height: Math.round(box?.height ?? -1),
      top: Math.round(box?.top ?? -1),
      bottom: Math.round(box?.bottom ?? -1),
      open: bar?.dataset.open,
    };
  });

const opened = await measure();
ok(
  "前置：主工具列真的畫得出來（高度 > 0，量不到的話下面全部恆真）",
  opened.height > 20,
  `高度 ${opened.height}px`,
);
ok(
  "① 展開時 --main-toolbar-h ＝ 實際高度",
  Math.abs(opened.varPx - opened.height) <= 1,
  `變數 ${opened.varPx}px vs 實際 ${opened.height}px`,
);
/*
 * ⚠️ 這一條**一定要先捲動再量**，不可以在頁首量。
 *   在頁首時主工具列還在它的自然位置，top 寫什麼量起來都一樣——
 *   那是一條恆真的假檢查。
 */
await page.evaluate(() => globalThis.scrollBy(0, 400));
await page.waitForTimeout(400);
const stuck = await measure();
const stuckScrollY = await page.evaluate(() => Math.round(globalThis.scrollY));
ok(
  "前置：真的捲到主工具列黏住了（沒捲的話下一條恆真）",
  stuckScrollY > 200,
  `scrollY=${stuckScrollY}`,
);
ok(
  "① 黏住之後，主工具列停在內容區上緣（這一支的標題列不是 sticky，所以是 0）",
  Math.abs(stuck.top) <= 1,
  `工具列上緣 ${stuck.top}px`,
);
await page.evaluate(() => globalThis.scrollTo(0, 0));
await page.waitForTimeout(400);

const toggle = async () => {
  await page.evaluate(() =>
    document.querySelector('[data-testid="mt-toggle"]')?.click(),
  );
  await page.waitForTimeout(500);
};

await toggle();
const collapsed = await measure();
ok(
  "② 收合之後高度真的變矮了（沒變的話收合鈕是壞的，下一條會假綠）",
  collapsed.height > 0 && collapsed.height < opened.height - 10,
  `展開 ${opened.height}px → 收合 ${collapsed.height}px`,
);
ok(
  "② 收合時 --main-toolbar-h 也跟著變",
  Math.abs(collapsed.varPx - collapsed.height) <= 1,
  `變數 ${collapsed.varPx}px vs 實際 ${collapsed.height}px`,
);
await toggle();

/* 視窗變窄 → 欄位換行 → 高度變高，變數也要跟著。 */
await page.setViewportSize({ width: 1000, height: 900 });
await page.waitForTimeout(800);
const narrow = await measure();
ok(
  "③ 視窗變窄（欄位換行）之後，變數仍等於實際高度",
  Math.abs(narrow.varPx - narrow.height) <= 1,
  `變數 ${narrow.varPx}px vs 實際 ${narrow.height}px（寬 1000px）`,
);
await page.setViewportSize({ width: 1500, height: 900 });
await page.waitForTimeout(800);

/* ══ 二、真的捲動，吸頂的圖不可以被工具列蓋住 ══════════════════ */
console.log("\n══ 二、捲動之後圖仍然完整看得到（不被工具列蓋住）══");

/**
 * 捲到「講稿還沒看完」的位置，再回報吸頂元素與工具列的實際座標。
 *
 * ⚠️ 捲的距離要**依這一塊還剩多少可以黏**來算，不可以寫死。
 *   捲過頭的話整塊都出去了，圖當然不在畫面上——那不是缺陷。
 */
const probe = async (label) => {
  await page.evaluate(() => {
    const panel = document.querySelector(".trend-panel");
    const pinned = panel?.querySelector(".trend-pinned");
    if (!panel || !pinned) return;
    panel.scrollIntoView({ block: "start" });
    /*
     * ⚠️ 捲的距離**不可以**直接用「這一塊比圖長多少」的一半。
     *   sticky 能黏的範圍是「這一塊比圖長的部分」再**扣掉 top 這個位移**：
     *   捲過頭的話，圖會被這一塊的下緣推上去（sticky 不能跑出包含區塊），
     *   量到的上緣就比 top 小——那會被誤判成「被工具列切掉」。
     *   2026-09-15 我第一版就是這樣寫的，全日交通量因此報了一個假紅。
     */
    const room =
      panel.getBoundingClientRect().height -
      pinned.getBoundingClientRect().height;
    const offset = Number.parseFloat(getComputedStyle(pinned).top) || 0;
    /*
     * ⚠️ scrollIntoView 之後這一塊的上緣已經在視窗 0，元素早就進入
     *   sticky 的區間了，所以**不要再把 offset 加回去**——加回去就會
     *   捲過頭，被下緣推上來。可捲的上限就是 usable 本身，取一半最穩。
     */
    const usable = room - offset;
    /*
     * ⚠️ X-63（2026-09-17）：原本捲 `usable / 2`。四張圖各自成一頁之後，
     *   「歷季分析」那一頁短了很多，捲一半**還沒到黏住的位置**——
     *   量到的是元素還在正常流裡的位置，於是展開 12px、收合 20px，
     *   兩者差 8px 而紅。**紅的是捲不夠，不是版面。**
     *
     *   改成捲到黏住區間的**尾端前 8px**：那個位置一定已經黏住了，
     *   而且還沒被區塊下緣推上去（超過 usable 才會）。
     * ⚠️ 還要扣掉「頁面本身捲得動多少」——頁面捲到底就停了，
     *   再要求也沒有用，而那正是這一次踩到的情況。
     */
    const pageRoom =
      document.documentElement.scrollHeight -
      document.documentElement.clientHeight -
      globalThis.scrollY;
    globalThis.scrollBy(
      0,
      Math.max(0, Math.min(Math.round(usable) - 8, Math.round(pageRoom))),
    );
  });
  await page.waitForTimeout(600);
  const result = await page.evaluate(() => {
    const pinned = document.querySelector(".trend-panel .trend-pinned");
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    if (!pinned || !bar) return null;
    const f = pinned.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    const panel = pinned.closest(".trend-panel");
    return {
      stickyRoom: Math.round(
        (panel?.getBoundingClientRect().height ?? 0) - f.height,
      ),
      /* 真正能黏的範圍＝這一塊比圖長的部分再扣掉 top 位移。 */
      usable: Math.round(
        (panel?.getBoundingClientRect().height ?? 0) -
          f.height -
          (Number.parseFloat(getComputedStyle(pinned).top) || 0),
      ),
      figureTop: Math.round(f.top),
      figureBottom: Math.round(f.bottom),
      barBottom: Math.round(b.bottom),
      viewport: globalThis.innerHeight,
      sticky: getComputedStyle(pinned).position,
      scrollY: Math.round(globalThis.scrollY),
    };
  });
  if (result) console.log(`   ${label}：`, JSON.stringify(result));
  return result;
};

const scrolled = await probe("展開狀態");
ok(
  "前置：釘住區找得到，而且真的設成 sticky",
  Boolean(scrolled) && scrolled.sticky === "sticky",
  scrolled ? `position: ${scrolled.sticky}` : "找不到釘住區",
);
ok(
  "前置：真的捲動了（沒捲的話下面幾條驗不到吸頂行為）",
  Boolean(scrolled) && scrolled.scrollY > 100,
  scrolled ? `scrollY=${scrolled.scrollY}` : "",
);
ok(
  "前置：扣掉 top 位移之後仍然有「可以黏」的範圍——沒有的話 sticky 本來就不會生效",
  Boolean(scrolled) && scrolled.usable > 150,
  scrolled
    ? `講稿比圖長 ${scrolled.stickyRoom}px、扣掉位移後可黏 ${scrolled.usable}px`
    : "",
);
ok(
  "前置：捲動之後圖還在畫面上（沒黏住的話會被捲出去，那時下一條紅的原因是別的事）",
  Boolean(scrolled) &&
    scrolled.figureBottom > 0 &&
    scrolled.figureTop < scrolled.viewport,
  scrolled ? `top=${scrolled.figureTop}、bottom=${scrolled.figureBottom}` : "",
);
ok(
  "⚠️ 捲動時圖的上緣在主工具列**下面**（不可以被它切掉）",
  Boolean(scrolled) && scrolled.figureTop >= scrolled.barBottom - 1,
  scrolled
    ? `圖上緣 ${scrolled.figureTop}px、工具列下緣 ${scrolled.barBottom}px（差 ${
        scrolled.figureTop - scrolled.barBottom
      }px）`
    : "",
);

/* 收合狀態也要對：寫死數字的實作在這一種狀態會留一大段空白或被切掉。 */
await toggle();
const scrolledCollapsed = await probe("收合狀態");
ok(
  "⚠️ 收合之後圖的上緣同樣在工具列下面，而且不會留一大段空白",
  Boolean(scrolledCollapsed) &&
    scrolledCollapsed.figureTop >= scrolledCollapsed.barBottom - 1 &&
    scrolledCollapsed.figureTop - scrolledCollapsed.barBottom <= 24,
  scrolledCollapsed
    ? `圖上緣 ${scrolledCollapsed.figureTop}px、工具列下緣 ${scrolledCollapsed.barBottom}px（差 ${
        scrolledCollapsed.figureTop - scrolledCollapsed.barBottom
      }px，要在 0～24 之間）`
    : "",
);
/*
 * ⚠️ X-63（2026-09-17）這一條**換了量法**，要驗的東西一個字都沒有變。
 *
 *   原本是「收合與展開兩種狀態下，圖上緣與工具列下緣的距離要一樣」。
 *   四張圖各自成一個大分頁之後，「歷季分析」那一頁短了很多——
 *   收合狀態下**整頁捲到底也還差 8px 才到黏住的位置**，
 *   量到的是元素還在正常流裡的座標，於是展開 12px、收合 20px 而紅。
 *   **紅的是捲不到，不是版面。**
 *   （縮小視窗也不行：視窗一矮，CSS 就把 sticky 關掉，position 變成 static。）
 *
 *   真正要擋的是「sticky 的 top 寫死一個數字」。那件事可以**直接量**：
 *   `top` 必須等於「表頭高＋主工具列高＋留白」，而且**兩種狀態各算一次**。
 *   寫死數字的話，收合之後工具列矮了、top 卻沒變，這一條立刻紅——
 *   而且不必倚賴頁面捲得動多少，不會再出現這種假紅。
 * ⚠️ 兩種狀態都要驗。只驗一種的話，寫死成「剛好等於展開時那個數字」也會綠。
 */
const topOf = () =>
  page.evaluate(() => {
    const pinned = document.querySelector(".trend-panel .trend-pinned");
    const header = document.querySelector(".topbar");
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    if (!pinned || !bar) return null;
    return {
      top: Number.parseFloat(getComputedStyle(pinned).top) || 0,
      header: Math.round(header?.getBoundingClientRect().height ?? 0),
      toolbar: Math.round(bar.getBoundingClientRect().height),
    };
  });
/* 目前是收合狀態（上一個 probe 切過去了），先量它，再切回展開量一次。 */
const collapsedTop = await topOf();
await toggle();
await page.waitForTimeout(500);
const expandedTop = await topOf();
for (const [label, m] of [
  ["展開", expandedTop],
  ["收合", collapsedTop],
]) {
  ok(
    `⚠️ ${label}狀態：sticky 的 top 是**當場量**主工具列算出來的，不是寫死的數字`,
    Boolean(m) && Math.abs(m.top - (m.toolbar + 12)) <= 2,
    m
      ? `top=${m.top}px、工具列 ${m.toolbar}px＋留白 12px = ${m.toolbar + 12}px（表頭 ${m.header}px 不算，它不是 sticky）`
      : "量不到",
  );
}
ok(
  "⚠️ 而且兩種狀態的 top **真的不一樣**（一樣的話上面那兩條可能是巧合）",
  Boolean(expandedTop) &&
    Boolean(collapsedTop) &&
    Math.abs(expandedTop.top - collapsedTop.top) >= 20,
  expandedTop && collapsedTop
    ? `展開 ${expandedTop.top}px、收合 ${collapsedTop.top}px`
    : "",
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 吸頂高度跟著主工具列走，捲動時圖不會被切掉");
