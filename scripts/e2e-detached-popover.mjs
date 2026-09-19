/**
 * ══════════════════════════════════════════════════════════════════════
 *  L-2：「回歸全部」旁邊的浮動小卡——看得到是哪幾塊，點了會跳過去並關掉
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列跳出全部回歸鈕時，上面會寫目前共 N 項要回歸，你覺得要提供
 *     使用者選擇哪幾個回歸嗎？還是為了主工具列簡化目的，一次性全部回歸
 *     才是最實用的方式？」
 *   → 定案：維持一次性全部回歸，但 N 要**看得到是哪幾塊**。
 *
 *   「做成浮動小卡，不占版面很棒，但你提供了點一下清單裡的名稱，畫面會
 *     跳轉過去，那就要記得**浮動小卡也要跟著關掉**」
 *   「我怕展開時候，整個主工具列會被擠的超大」
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**「不佔版面」要真的量。** 只驗「有 position:absolute」不夠——
 *     可能被別的規則蓋過。這裡量**工具列在開小卡前後的高度**，必須一樣。
 * 二、**「點了會關掉」要真的點。** 而且要驗跳轉**也真的發生了**：
 *     只驗「小卡關掉了」的話，一顆什麼都不做的按鈕也會過。
 * 三、**名稱要是使用者看得懂的區塊名**，不是內部代號。
 * 四、**前置要先真的讓某一塊脫離**，否則整支恆真。
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
await new Promise((r) => server.listen(8199, r));
const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1920, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept("N"));

await page.goto("http://localhost:8199/");
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
await page.locator(".modal-backdrop .modal input").first().fill("浮動小卡守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

const base = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q2");
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
await gotoBlock(page, "block-composition");
await page.waitForTimeout(1400);

/* ══ 前置：讓某一塊脫離 ══════════════════════════════════════ */
console.log("\n══ 前置：讓一塊脫離主工具列 ══");
const setBlockSelect = (blockId, labelText, value) =>
  page.evaluate(
    ([id, text, wanted]) => {
      const block = document.getElementById(id);
      if (!block) return false;
      const label = [...block.querySelectorAll("label")].find((node) =>
        (node.textContent || "").trim().startsWith(text),
      );
      const select = label?.querySelector("select");
      if (!select) return false;
      select.value = wanted;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    [blockId, labelText, value],
  );
/* ⚠️ X-63：車種組成自己一個大分頁，先切過去。 */
await gotoBlock(page, "block-composition");
ok(
  "前置：找得到車種組成那一塊自己的日別下拉",
  await setBlockSelect("block-composition", "日別", "假日"),
);
await page.waitForTimeout(1200);
ok(
  "前置：真的有一塊脫離了（0 塊的話整支恆真）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) >= 1,
  `${await page.locator('[data-testid="chart-detach-note"]').count()} 塊`,
);
ok(
  "前置：「回歸全部」那一顆出現了",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 1,
);

/* ══ ⓪ 脫離幾塊，就要有幾條「回到主工具列條件」══════════════
 *
 * 使用者 2026-09-16（附圖）：「這張圖我用自己的工具列篩選後，主工具列有正確
 *   跳出回歸，但**這張圖沒有跳出回歸主工具列的選項**」——歷季分析那一塊。
 *
 * 成因：那一條說明原本寫死在 renderBlockFilters() 裡，而歷季分析的工具列
 * 是手寫的（要釘在標題列上），沒有走那一支。
 *
 * ⚠️ 只讓「車種組成」脫離是**假綠**：那一塊走 renderBlockFilters，永遠有鈕。
 *   這裡改成同一頁上**兩塊都脫離**，再比「小卡列幾項」與「畫面上有幾條回歸鈕」。
 */
console.log("\n══ ⓪ 脫離幾塊就要有幾條回歸鈕 ══");
/* ⚠️ X-63：歷季分析也自己一個大分頁。 */
await gotoBlock(page, "block-trend");
const trendDetached = await page.evaluate(() => {
  const block = document.getElementById("block-trend");
  if (!block) return false;
  /* 歷季分析的日別下拉沒有 <label> 包著（它在釘住的標題列上）。 */
  const select = [...block.querySelectorAll("select")].find((node) =>
    [...node.options].some((option) => option.value === "假日"),
  );
  if (!select) return false;
  select.value = "假日";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
await page.waitForTimeout(1200);
ok("前置：歷季分析那一塊也真的改得動日別", trendDetached);
ok(
  "⚠️ ⓪ 歷季分析脫離之後，**那一塊自己**要有「回到主工具列條件」",
  (await page
    .locator('#block-trend [data-testid="chart-detach-note"]')
    .count()) === 1,
  `${await page.locator('#block-trend [data-testid="chart-detach-note"]').count()} 條`,
);
/*
 * ⚠️ X-63（2026-09-17）這一條**換了量法**，要驗的東西沒有變。
 *
 *   原本是「這一頁上脫離幾塊，就有幾條回歸鈕」——那建立在
 *   「車種組成與歷季分析在同一頁」上。四張圖各自成一個大分頁之後
 *   兩塊本來就不同頁，數同一頁只會數到 1，而那不是漏接。
 *
 *   真正要擋的是使用者回報的那件事：**某一塊脫離了，它自己那一塊上
 *   卻沒有回歸鈕**。所以改成逐塊走過去、逐塊確認——
 *   這比原本那一條嚴：原本只比總數，兩塊各一條與一塊兩條分不出來。
 */
const missingReset = [];
for (const anchor of ["block-composition", "block-trend"]) {
  await gotoBlock(page, anchor);
  const own = await page
    .locator(`#${anchor} [data-testid="chart-detach-note"]`)
    .count();
  const onPage = await page
    .locator('[data-testid="chart-detach-note"]')
    .count();
  if (own !== 1 || onPage !== 1) missingReset.push(`${anchor}（自己 ${own} 條、整頁 ${onPage} 條）`);
}
ok(
  "⚠️ ⓪ 每一個脫離的區塊，自己那一塊上都要有一條「回到主工具列條件」",
  missingReset.length === 0,
  missingReset.join("、") || "兩塊各一條",
);

/* ══ 一、小卡不佔版面 ══════════════════════════════════════════ */
console.log("\n══ 一、開小卡不可以把工具列撐大 ══");
const barBefore = await page.evaluate(() =>
  Math.round(
    document
      .querySelector('[data-testid="main-toolbar"]')
      .getBoundingClientRect().height,
  ),
);
await page.locator('[data-testid="mt-detached-toggle"]').click();
await page.waitForTimeout(400);
const afterOpen = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="main-toolbar"]');
  const pop = document.querySelector('[data-testid="mt-detached-pop"]');
  return {
    barHeight: Math.round(bar.getBoundingClientRect().height),
    popVisible: Boolean(pop) && !pop.hidden,
    popPosition: pop ? getComputedStyle(pop).position : "",
    popHeight: pop ? Math.round(pop.getBoundingClientRect().height) : -1,
    items: pop ? pop.querySelectorAll("[data-detached-goto]").length : -1,
    labels: pop
      ? [...pop.querySelectorAll("[data-detached-goto]")].map((node) =>
          node.textContent.trim(),
        )
      : [],
  };
});
ok(
  "① 小卡打得開",
  afterOpen.popVisible && afterOpen.popHeight > 40,
  `高 ${afterOpen.popHeight}px`,
);
ok(
  "① 小卡是**浮起來**的（position: absolute）",
  afterOpen.popPosition === "absolute",
  afterOpen.popPosition,
);
ok(
  "⚠️ ① 開了小卡之後，主工具列的高度**完全不變**（使用者怕的就是被擠大）",
  afterOpen.barHeight === barBefore,
  `開之前 ${barBefore}px → 開之後 ${afterOpen.barHeight}px`,
);
ok(
  "② 清單列得出項目",
  afterOpen.items >= 1,
  `列了 ${afterOpen.items} 項：${afterOpen.labels.join("、")}`,
);
/*
 * ⚠️ 名稱必須是**使用者看得懂的區塊名**，不是 composition 這種內部代號。
 *   判準：要含中文，而且不可以整串長得像代號（全小寫英數與連字號）。
 */
ok(
  "② 列出來的是區塊名稱，不是內部代號",
  afterOpen.labels.length > 0 &&
    afterOpen.labels.every(
      (label) => /[\u4e00-\u9fff]/.test(label) && !/^[a-z0-9-]+$/.test(label),
    ),
  afterOpen.labels.join("、"),
);

/* ══ 二、點名稱：跳過去，而且小卡要關掉 ══════════════════════ */
console.log("\n══ 二、點名稱之後小卡要跟著關掉（使用者指名的那一條）══");
const firstLabel = afterOpen.labels[0];
await page.locator("[data-detached-goto]").first().click();
await page.waitForTimeout(1000);
const afterJump = await page.evaluate(() => {
  const pop = document.querySelector('[data-testid="mt-detached-pop"]');
  const toggle = document.querySelector('[data-testid="mt-detached-toggle"]');
  const focused = document.querySelector(".is-focused, [data-focused='1']");
  const block = document.getElementById("block-composition");
  const bar = document.querySelector('[data-testid="main-toolbar"]');
  return {
    popVisible: Boolean(pop) && !pop.hidden,
    ariaExpanded: toggle ? toggle.getAttribute("aria-expanded") : "(沒有鈕)",
    focusedId: focused ? focused.id : "",
    blockTop: block ? Math.round(block.getBoundingClientRect().top) : null,
    barBottom: bar ? Math.round(bar.getBoundingClientRect().bottom) : -1,
  };
});
ok(
  "⚠️ ③ 點了名稱之後，浮動小卡要**跟著關掉**（使用者指名要做的）",
  !afterJump.popVisible && afterJump.ariaExpanded === "false",
  `小卡還開著：${afterJump.popVisible}、aria-expanded=${afterJump.ariaExpanded}`,
);
/*
 * ⚠️ 只驗「關掉了」不夠——一顆什麼都不做、只負責關小卡的按鈕也會過。
 *   所以一起驗「那一塊真的捲到畫面上、而且沒有躲在主工具列後面」。
 */
ok(
  "③ 而且**真的跳過去了**：那一塊在畫面上，上緣沒有被主工具列蓋住",
  afterJump.blockTop !== null &&
    afterJump.blockTop >= afterJump.barBottom - 8 &&
    afterJump.blockTop < 1000,
  `#block-composition 上緣 ${afterJump.blockTop}px、工具列下緣 ${afterJump.barBottom}px（點的是「${firstLabel}」）`,
);

/* ══ 三、其他關閉方式 ══════════════════════════════════════════ */
console.log("\n══ 三、按 Esc、點外面、按回歸全部，都要關掉 ══");
const reopen = async () => {
  await page.locator('[data-testid="mt-detached-toggle"]').click();
  await page.waitForTimeout(350);
  return page.evaluate(
    () => !document.querySelector('[data-testid="mt-detached-pop"]').hidden,
  );
};
const isOpen = () =>
  page.evaluate(() => {
    const pop = document.querySelector('[data-testid="mt-detached-pop"]');
    return Boolean(pop) && !pop.hidden;
  });

ok("前置：小卡再打得開（打不開的話下面三條恆真）", await reopen());
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("④ 按 Esc 要關掉", !(await isOpen()));

ok("前置：小卡再打得開", await reopen());
await page.mouse.click(20, 600);
await page.waitForTimeout(300);
ok("④ 點小卡以外的地方要關掉", !(await isOpen()));

ok("前置：小卡再打得開", await reopen());
await page.locator('[data-testid="mt-reset-all"]').click();
await page.waitForTimeout(900);
ok("④ 按「回歸全部」之後要關掉（清單本身已經沒有意義了）", !(await isOpen()));
ok(
  "④ 而且真的全部回歸了（「回歸全部」那一顆要消失）",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 浮動小卡：不佔版面、列得出區塊名稱、點了跳過去並關掉");
