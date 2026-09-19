/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-80：24 小時型態要「一個調查點一張圖」，不加總
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：
 *   「車種組成，選擇多點的調查點位，已經能分別獨立顯示每個調查點位的圓環圖。
 *     想跟你確認 24 小時型態是否也要每個調查點位都會有獨立一張 24 小時
 *     趨勢圖?還是勾選多個調查點位，加總起來的 24 小時型態趨勢圖有他的意義在?」
 *
 * ⚠️ 加總沒有意義，而且與 X-28 的裁示衝突（不同調查點的交通量不可以相加）。
 *   更關鍵的是**尖峰時刻**：合起來那條線的最高點不一定是任何一個調查點
 *   自己的尖峰時刻。所以拆，不是加、也不是平均。
 *
 * ── ⚠️ 刻意迴避的假通過 ──────────────────────────────────────────
 * 一、**不可以只驗「有兩張圖」**。把合計拆成兩半畫出來也會有兩張。
 *     所以要驗：兩張圖各自的數字**就是**單選那一個調查點時的數字。
 * 二、**要反面驗「合計那個數字整個不出現」**——畫面與講稿都不可以有。
 * 三、測資一定要讓兩個調查點的量**不一樣**，否則「加」與「拆」都會過。
 * 四、只有一個調查點時**不可以**變成拆的版面（升級當天的畫面不可以無故改變）。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock, TABS, gotoTab, ensureToolbarOpen } from "./e2e-nav.mjs";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");
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
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] || "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

/* ── 測資：兩個調查點，量刻意差很多 ─────────────────────────── */
const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const pad = (v) => String(v).padStart(2, "0");
function roadSheet(level) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let hour = 0; hour < 24; hour += 1) {
    const cells = [];
    for (const side of [level, Math.round(level * 1.4)])
      for (const vehicle of VEHICLES)
        cells.push(vehicle === "機車" ? side : Math.round(side / 4));
    rows.push([`${pad(hour)}:00～${pad((hour + 1) % 24)}:00`, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function roadBook(level) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, roadSheet(level), "平日");
  XLSX.utils.book_append_sheet(book, roadSheet(Math.round(level * 0.6)), "假日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(event.type() === "prompt" ? "N" : ""));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
await ensureToolbarOpen(page);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("逐點24小時守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

await gotoTab(page, TABS.import);
await page.waitForTimeout(500);
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page.waitForTimeout(300);
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles([
    { name: "115T1-01_甲路段.xlsx", mimeType: XLSX_MIME, buffer: roadBook(200) },
    { name: "115T1-02_乙路段.xlsx", mimeType: XLSX_MIME, buffer: roadBook(730) },
  ]);
await page.waitForTimeout(5000);
const confirmButton = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirmButton.count()) {
  await confirmButton.first().click();
  await page.waitForTimeout(3500);
}
const applyButton = page.locator(
  '.vehicle-class-modal button:has-text("套用車種設定")',
);
if (await applyButton.count()) {
  await applyButton.first().click();
  await page.waitForTimeout(700);
}
for (let i = 0; i < 6 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page
    .locator(
      '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
    )
    .first();
  if (!(await closer.count())) break;
  await closer.click();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(700);

await gotoBlock(page, "block-hourly");
await page.waitForTimeout(1500);

/**
 * 這一塊自己的「路段／路口」多選：勾指定的幾個（take 為 null ＝ 全部清掉）。
 * ⚠️ 面板沒打開時整個不在 DOM 裡，不可以直接找 checkbox。
 */
const pickRoads = async (indexes) => {
  const opened = await page.evaluate(() => {
    const block = document.getElementById("block-hourly");
    if (!block) return false;
    const button = [...block.querySelectorAll(".multi-picker-btn")].find((b) =>
      (b.getAttribute("aria-label") || "").startsWith("路段／路口"),
    );
    if (!button) return false;
    if (button.getAttribute("aria-expanded") !== "true") button.click();
    return true;
  });
  if (!opened) return 0;
  await page.waitForTimeout(400);
  const on = await page.evaluate((want) => {
    const block = document.getElementById("block-hourly");
    const boxes = [
      ...block.querySelectorAll(
        '.multi-picker-panel .multi-picker-list input[type="checkbox"]',
      ),
    ];
    let picked = 0;
    boxes.forEach((box, index) => {
      const should = want.includes(index);
      if (box.checked !== should) box.click();
      if (should) picked += 1;
    });
    return picked;
  }, indexes);
  await page.evaluate(() => {
    const block = document.getElementById("block-hourly");
    const button = [...block.querySelectorAll(".multi-picker-btn")].find((b) =>
      (b.getAttribute("aria-label") || "").startsWith("路段／路口"),
    );
    if (button && button.getAttribute("aria-expanded") === "true")
      button.click();
  });
  await page.waitForTimeout(1500);
  return on;
};

/**
 * 這一塊講稿裡出現的所有數字（去掉千分位）。
 *
 * ⚠️ 第一版是量畫布**墨量**當指紋，但拆開之後每一張畫布的 CSS 寬高
 *   本來就會變（外面多包了一層 figure 與標題），墨量跟著差 2%——
 *   量到的是版面差異，不是資料差異。改成讀講稿裡的**數字**：
 *   講稿的每一個數字都是從圖上那一份資料算出來的，拆前拆後必須對得起來。
 */
const noteNumbers = () =>
  page.evaluate(() => {
    const block = document.getElementById("block-hourly");
    const text = block?.querySelector("[data-chart-note]")?.textContent || "";
    return [...text.matchAll(/[\d,]{3,}/g)]
      .map((m) => Number(m[0].replace(/,/g, "")))
      .filter((n) => Number.isFinite(n) && n > 99);
  });
const canvasCount = () =>
  page.evaluate(
    () =>
      document.getElementById("block-hourly")?.querySelectorAll("canvas")
        .length ?? 0,
  );

const blockText = () =>
  page.evaluate(
    () =>
      (document.getElementById("block-hourly")?.innerText || "").replace(
        /\s+/g,
        " ",
      ),
  );

/* ══ ① 只選一個調查點：版面不可以變成拆的 ═══════════════════ */
console.log("\n══ ① 單一調查點（升級當天的畫面不可以變）══");
const one = await pickRoads([0]);
if (one !== 1) stop(`前置失敗：只挑到 ${one} 個調查點`);
const splitWhenOne = await page.locator('[data-testid="hourly-split"]').count();
ok(
  "① 只有一個調查點時**不是**拆的版面（一張圖就是一張圖）",
  splitWhenOne === 0,
  `拆版面 ${splitWhenOne} 個`,
);
const numsA = await noteNumbers();
ok(
  "① 前置：單選第一個調查點時圖與講稿都出得來",
  (await canvasCount()) === 1 && numsA.length > 0,
  numsA.join("／"),
);

const two = await pickRoads([1]);
if (two !== 1) stop(`前置失敗：只挑到 ${two} 個調查點`);
const numsB = await noteNumbers();
ok(
  "① 前置：單選第二個調查點時圖與講稿都出得來",
  (await canvasCount()) === 1 && numsB.length > 0,
  numsB.join("／"),
);
/* 兩個調查點各自「只有自己有」的數字——拆開之後這些必須同時出現。 */
const onlyA = numsA.filter((n) => !numsB.includes(n));
const onlyB = numsB.filter((n) => !numsA.includes(n));
ok(
  "⚠️ ① 前置：兩個調查點的量**真的不一樣**（一樣的話「加」與「拆」都會過）",
  onlyA.length > 0 && onlyB.length > 0,
  `甲獨有 ${onlyA.slice(0, 3).join("／")}；乙獨有 ${onlyB.slice(0, 3).join("／")}`,
);

/* ══ ② 選兩個調查點：一個點一張圖 ═══════════════════════════ */
console.log("\n══ ② 兩個調查點（要拆，不加總）══");
const both = await pickRoads([0, 1]);
if (both !== 2) stop(`前置失敗：只挑到 ${both} 個調查點`);
const split = await page.locator('[data-testid="hourly-split"]').count();
ok("⚠️ ② 兩個調查點時改成拆的版面", split === 1);
const figures = await page.locator("#block-hourly .hourly-one").count();
ok("⚠️ ② 一個調查點一張圖（兩張）", figures === 2, `${figures} 張`);
const captions = await page.evaluate(() =>
  [...document.querySelectorAll("#block-hourly .hourly-one figcaption")].map(
    (el) => (el.textContent || "").trim(),
  ),
);
ok(
  "⚠️ ② 每一張圖都有自己的調查點名稱（沒有名稱的話兩張一樣的折線更容易看錯）",
  captions.length === 2 && captions.every((t) => t.length > 0) && captions[0] !== captions[1],
  captions.join("／"),
);
const numsBoth = await noteNumbers();
ok(
  "⚠️ ② 拆開之後講的**就是**單選時的那兩份（不是把合計拆成兩半）",
  onlyA.every((n) => numsBoth.includes(n)) &&
    onlyB.every((n) => numsBoth.includes(n)),
  `拆後 ${numsBoth.slice(0, 6).join("／")}`,
);
/* ⚠️ 反面：合計那個數字一個都不可以出現。 */
const sums = onlyA.flatMap((a) => onlyB.map((b) => a + b));
ok(
  "⚠️ ② 合計那個數字整個不出現（只驗正面的話「拆兩張＋再寫一句合計」也會過）",
  !numsBoth.some((n) => sums.includes(n)),
  `合計會是 ${sums.slice(0, 3).join("／")}`,
);
const text = await blockText();
/*
 * ⚠️ 使用者 2026-09-18：「圖上不需要寫明『不加總』與理由，這些可以納入
 *   新手使用手冊說明就好」。所以畫面只要交代**為什麼變成好幾張**，
 *   完整理由改驗在手冊裡（見 manual.html 的守門）。
 */
ok(
  "⚠️ ② 畫面上有一行交代為什麼變成好幾張（不然使用者不知道發生什麼事）",
  /一個調查點一張圖/.test(text),
);
ok(
  "⚠️ ② 但畫面上**不再**掛整段理由（使用者指定移到手冊）",
  !/不對應任何一條路的實際流量/.test(text),
);
ok(
  "⚠️ ② 講稿也跟著逐點分段，不可以還留著「N 個調查點合起來算」",
  !/個調查點\*\*合起來\*\*算/.test(text) && !/個調查點合起來算/.test(text),
  text.slice(0, 0) || "",
);

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 24 小時型態：一個調查點一張圖，不加總、不平均");
