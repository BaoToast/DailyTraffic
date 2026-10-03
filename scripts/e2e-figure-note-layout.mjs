/**
 * ══════════════════════════════════════════════════════════════════════
 *  一圖一說明：放得下就左右並排、圖固定；放不下就上下排、圖不固定
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15 定案（三支同步）：
 *   「有些圖和說明文字本來就是左右並排了……那應該一開始就要做成左右並排，
 *     然後圖固定在左邊？這項一定要用肉眼確認，且同步到三份程式」
 *   「我不希望到時變成主工具列＋圖片被固定住，導致看說明文字只能靠到少少幾行字」
 *
 * 這一支守四塊 `.chart-with-note`（車種組成 ×2、24 小時型態、同季平假日）。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 *
 * 一、**只驗 CSS 字串不算數。** 這裡量的是 getBoundingClientRect 的實際座標。
 *     而且這一類改版真的踩過：`container-type` 下錯層時，
 *     `position:sticky`（後代）生效、版面卻沒換——**同一個 @container
 *     區塊只有一半會動**。所以並排與 sticky **兩件都要驗**。
 * 二、**只驗寬視窗不算數。** 永遠並排的實作在寬視窗會過，窄的時候說明會被
 *     壓成一條。所以寬窄都驗。
 * 三、**還要驗「改版前後行為一致」。** 這一次是把 @media 換成 @container，
 *     使用者的一般視窗寬度下**版面不應該改變**。所以斷點兩側都量。
 * 四、**前置要先確認圖真的畫得出來**，否則整支恆真。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab } from "./e2e-nav.mjs";

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
await new Promise((r) => server.listen(8197, r));
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

await page.goto("http://localhost:8197/");
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
await page.locator(".modal-backdrop .modal input").first().fill("圖說版面守門");
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
await gotoTab(page, TABS.charts);
await page.waitForTimeout(1400);

const survey = () =>
  page.evaluate(() => {
    const px = (value) => Number.parseFloat(value) || 0;
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    const expectedTop = Math.round(
      (bar && getComputedStyle(bar).position === "sticky"
        ? bar.getBoundingClientRect().height
        : 0) + 12,
    );
    return {
      expectedTop,
      blocks: [...document.querySelectorAll(".chart-with-note")].map((el) => {
        const main = el.querySelector(":scope > .chart-with-note-main");
        const note = el.querySelector(":scope > .chart-note");
        const block = el.closest("[id^=block-]");
        const f = main?.getBoundingClientRect();
        const n = note?.getBoundingClientRect();
        return {
          id: block?.id || "(找不到區塊 id)",
          width: Math.round(el.getBoundingClientRect().width),
          hasMain: Boolean(main),
          hasNote: Boolean(note),
          /* 說明若被包進圖裡，它會跟著圖一起釘住，等於整塊黏在畫面上。 */
          noteInsideMain: Boolean(main && main.querySelector(".chart-note")),
          mainWidth: Math.round(f?.width ?? -1),
          noteWidth: Math.round(n?.width ?? -1),
          sideBySide: Boolean(f && n && n.left >= f.right - 1),
          mainPosition: main ? getComputedStyle(main).position : "",
          mainTop: main ? px(getComputedStyle(main).top) : null,
        };
      }),
    };
  });

console.log("\n══ 一、寬視窗（1920px）：左右並排 ＋ 圖固定 ══");
let data = await survey();
ok(
  "前置：畫面上真的有「圖＋說明」的區塊（0 塊的話整支恆真）",
  data.blocks.length > 0,
  `${data.blocks.length} 塊：${data.blocks.map((b) => b.id).join("、")}`,
);
for (const block of data.blocks) {
  ok(
    `① ${block.id}：說明是圖的**兄弟**，不是被包在圖裡`,
    block.hasMain && block.hasNote && !block.noteInsideMain,
    block.noteInsideMain ? "說明被包進 .chart-with-note-main 了" : "兄弟關係正確",
  );
  ok(
    `② ${block.id}：說明真的在圖的右邊`,
    block.sideBySide,
    `整塊 ${block.width}px、圖 ${block.mainWidth}px、說明 ${block.noteWidth}px`,
  );
  ok(
    `② ${block.id}：圖是 sticky`,
    block.mainPosition === "sticky",
    block.mainPosition,
  );
  ok(
    `③ ${block.id}：sticky 的 top ＝ 主工具列＋留白（不是寫死的數字）`,
    block.mainTop != null && Math.abs(block.mainTop - data.expectedTop) <= 2,
    `實際 ${block.mainTop}px vs 應該 ${data.expectedTop}px`,
  );
}

/*
 * ④ 斷點兩側都要對。
 * ⚠️ 這一條守的是「改版沒有偷偷改掉既有行為」：
 *   舊版是 @media(max-width:1240px) 收成單欄，換成 @container 之後
 *   門檻改成量這一區的實際寬度 935px——那是照舊行為換算出來的。
 *   視窗 1280px 仍要並排、1240px 仍要單欄，和改版前一模一樣。
 */
console.log("\n══ 二、斷點兩側的行為要和改版前一致 ══");
for (const [viewport, shouldSide] of [
  [1280, true],
  [1240, false],
]) {
  await page.setViewportSize({ width: viewport, height: 1000 });
  await page.waitForTimeout(700);
  data = await survey();
  const first = data.blocks[0];
  ok(
    `④ 視窗 ${viewport}px：${shouldSide ? "仍然並排" : "收成單欄"}（與改版前相同）`,
    Boolean(first) && first.sideBySide === shouldSide,
    first
      ? `這一區寬 ${first.width}px、圖 ${first.mainWidth}px、說明 ${first.noteWidth}px`
      : "找不到區塊",
  );
}

console.log("\n══ 三、窄視窗（900px）：上下排，而且**不可以**釘住 ══");
/*
 * ⚠️ 上下排時圖若還釘著，往下捲圖會滑到說明上面——圖底下是不透明的面板色，
 *   說明的字會被整片蓋掉。那比不釘住更糟。
 */
await page.setViewportSize({ width: 900, height: 1000 });
await page.waitForTimeout(800);
data = await survey();
for (const block of data.blocks) {
  ok(
    `前置：${block.id} 在窄視窗真的窄了（沒窄的話下面兩條恆真）`,
    block.width < 935,
    `${block.width}px`,
  );
  ok(
    `⑤ ${block.id}：窄的時候不並排（說明在圖的下面）`,
    !block.sideBySide,
    `圖 ${block.mainWidth}px、說明 ${block.noteWidth}px`,
  );
  ok(
    `⑤ ${block.id}：窄的時候圖**不可以**釘住（會蓋住說明）`,
    block.mainPosition === "static",
    block.mainPosition,
  );
}
await page.setViewportSize({ width: 1920, height: 1000 });
await page.waitForTimeout(600);

/*
 * ⑥ 側欄跳轉的落點要讓開主工具列。
 * ⚠️ 這一條不是版面潔癖：主工具列 2026-09-15 起常駐在上方，
 *   而側欄的小分頁仍然會在同一頁裡捲到某一塊。沒有 scroll-margin-top 的話，
 *   捲過去之後那一塊的標題就落在工具列後面，使用者只看到「按了有動、
 *   但不知道停在哪」。另外兩支也踩過同一個坑。
 */
console.log("\n══ 四、側欄跳轉之後標題不可以被工具列遮住 ══");
/*
 * ⚠️ #44：舊版只取**第一個** `[id^="block-"]` 就下結論。
 *
 *   側欄的小分頁有十幾個落點，而 `scroll-margin-top` 是逐塊寫的——
 *   只量第一塊的話，後面任何一塊漏掉 scroll-margin-top 都量不到，
 *   而這一條照樣是綠的。「量了一個、當成量了全部」是最貴的那種假的綠：
 *   它讓人以為這一整類問題有人守著。
 *
 *   改成**逐塊**跳轉、逐塊量，並且把每一塊的結果都印出來。
 */
/*
 * ⚠️ 落點分布在**五個分區**裡（block-kpi／block-trend／block-pcu／
 *   block-export-center…共 14 個），而每一個分區的內容是各自獨立的畫面，
 *   別的分區的區塊**不在 DOM 裡**。所以只停在「圖表與比較」那一頁掃，
 *   永遠只會掃到 1 個——那正是第一版寫出來的結果（實測只有
 *   block-composition 一個），而「逐塊」在只有一塊時等於沒改。
 *
 *   改成**逐分區**走一遍，每一區把當下看得到的落點全部量完。
 */
const jumpResults = [];
for (const [tabName, tabId] of Object.entries(TABS)) {
  await gotoTab(page, tabId);
  await page.waitForTimeout(900);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('[id^="block-"]')]
      .filter((el) => el.getClientRects().length)
      .map((el) => el.id),
  );
  for (const id of ids) {
    const result = await page.evaluate((targetId) => {
      const target = document.getElementById(targetId);
      if (!target) return null;
      target.scrollIntoView({ block: "start", behavior: "auto" });
      const bar = document.querySelector('[data-testid="main-toolbar"]');
      return {
        id: targetId,
        top: Math.round(target.getBoundingClientRect().top),
        barBottom: Math.round(bar?.getBoundingClientRect().bottom ?? -1),
        margin: getComputedStyle(target).scrollMarginTop,
      };
    }, id);
    await page.waitForTimeout(120);
    if (result) jumpResults.push({ ...result, tab: tabName });
  }
}
await gotoTab(page, TABS.charts);
await page.waitForTimeout(700);
ok(
  "前置：找得到跳轉目標（找不到的話下面每一條都恆真）",
  jumpResults.length > 0,
  `共 ${jumpResults.length} 個落點`,
);
/*
 * ⚠️ 前置二：不可以只有一個。
 *   只剩一個的時候「逐塊」和「只量第一塊」沒有差別，這個修正就失效了，
 *   而且沒有任何症狀。選擇器改壞、區塊 id 改名、或走頁邏輯壞掉，
 *   都會落到這裡。
 */
ok(
  "前置：落點不只一個（只有一個的話「逐塊」等於沒改）",
  jumpResults.length >= 2,
  `共 ${jumpResults.length} 個落點：${jumpResults.map((x) => `${x.tab}/${x.id}`).join("、")}`,
);
console.log("── 逐塊落點（先印再斷言）──");
for (const item of jumpResults)
  console.log(
    `　${item.tab} #${item.id}：上緣 ${item.top}px、工具列下緣 ${item.barBottom}px、scroll-margin-top ${item.margin}`,
  );
const jumpBad = jumpResults.filter((item) => !(item.top >= item.barBottom - 1));
ok(
  "⑥ 每一塊跳轉落點的上緣都在主工具列下面（不是躲在它後面）",
  jumpBad.length === 0,
  jumpBad.length
    ? `這幾塊躲在工具列後面：${jumpBad
        .map((item) => (item ? `#${item.id}（上緣 ${item.top}px、工具列下緣 ${item.barBottom}px）` : "（讀不到）"))
        .join("；")}`
    : `${jumpResults.length} 塊全部讓開了`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 圖與說明左右並排、圖固定、斷點行為與改版前一致；窄的時候自動改上下排且不釘住",
);
