/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-79：歷季趨勢圖的線尾路段名稱
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17（附圖）：
 *   「全日交通量歷季趨勢圖，底下已經有圖例說明，畫面上不用再顯示路段了，
 *     避免會有標籤重疊的問題」
 *   圖上三個線尾名稱疊成一團，最後一個還被截成「中山北路(大德一路~平和…」。
 *
 * ⚠️ 修法不是「把線尾名稱整段刪掉」。使用者給的**理由**是
 *   「底下已經有圖例說明」，而那句話只在圖例真的分得出來時成立：
 *   線多到超過配色數時，每一條線與每一個圖例色塊**全都是同一個深灰**，
 *   那時線尾名稱是唯一的識別（色盲讀者與灰階列印同理）。
 *   所以這一支要**同時守正反兩面**：
 *     ① 圖例分得出來（線數在配色數以內）→ 線尾名稱不可以出現
 *     ② 圖例分不出來（線數超過配色數）→ 線尾名稱**必須**還在
 *   只守①的話，「無條件全部刪掉」也會全綠，而那會把識別完全弄丟。
 *
 * ── 怎麼量 ────────────────────────────────────────────────────
 * 畫布上讀不到文字，所以量**像素**：找出整張畫布最右邊還有墨的那一欄。
 *   ・沒有線尾名稱時，最右邊的墨是折線自己的端點記號，之後是右邊界留白
 *   ・有線尾名稱時，名稱會一路寫到接近畫布右緣
 * 兩種情況同一支裡都跑一次，除了各自的絕對門檻，還互相比對——
 * 只看絕對值的話，畫布寬度一改門檻就失準。
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

/* ── 測資：9 個調查點（要超過 8 種配色才問得出第②面）────────── */
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
/* 名稱刻意長短不一，線尾名稱在的話一定會佔到右邊界。 */
const NAMES = [
  "中山北路一段",
  "岡山路大德一路至平和東路",
  "河華路公園東路口",
  "民族路二段",
  "建國路三段",
  "復興南路",
  "光明路口",
  "自由街",
  "和平西路四段",
];
const files = (quarterIndex) =>
  NAMES.map((name, index) => ({
    name: `115T${quarterIndex}-${pad(index + 1)}_${name}.xlsx`,
    mimeType: XLSX_MIME,
    buffer: roadBook(120 + index * 37 + quarterIndex * 11),
  }));

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
await page.locator(".modal-backdrop .modal input").first().fill("線尾名稱守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

const importQuarter = async (quarterKey, payload) => {
  await gotoTab(page, TABS.import);
  await page.waitForTimeout(500);
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(500);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarterKey);
  await page.waitForTimeout(300);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles(payload);
  await page.waitForTimeout(8000);
  const confirmButton = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirmButton.count()) {
    await confirmButton.first().click();
    await page.waitForTimeout(5000);
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
};
await importQuarter("115Q1", files(1));
await importQuarter("115Q2", files(2));

await gotoBlock(page, "block-trend");
await page.waitForTimeout(1500);

/**
 * 整張畫布最右邊還有墨的那一欄（畫布座標，不是 CSS 像素）。
 * ⚠️ 背景是白的，所以「墨」＝ 不是白、而且不透明。
 *   單純比 alpha 會把白底也算成墨（白底 alpha 也是 255）。
 */
const rightmostInk = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".trend-canvas");
    if (!canvas) return null;
    /*
     * ⚠️ 只能量**繪圖區那幾列**，不可以掃整張畫布：
     *   圖例畫在畫布下緣、而且是滿版排開的，右邊一定有墨——
     *   掃整張的話兩種情況都量到 10～12px，整支恆真（第一版就是這樣）。
     * ⚠️ 繪圖區右緣是算出來的（會隨線尾名稱的長度變動），
     *   測試自己猜會猜錯，所以讀程式寫在 dataset 上的實際邊界。
     */
    const right = Number(canvas.dataset.plotRight);
    const top = Number(canvas.dataset.plotTop);
    const bottom = Number(canvas.dataset.plotBottom);
    if (!Number.isFinite(right) || !Number.isFinite(top)) return null;
    const c = canvas.getContext("2d");
    const { width, height } = canvas;
    const y0 = Math.max(0, top - 6);
    const y1 = Math.min(height, bottom + 6);
    const data = c.getImageData(0, y0, width, y1 - y0).data;
    const rowWidth = width;
    let last = -1;
    for (let x = width - 1; x >= 0 && last < 0; x -= 1)
      for (let y = 0; y < y1 - y0; y += 1) {
        const i = (y * rowWidth + x) * 4;
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a > 12 && (r < 235 || g < 235 || b < 235)) {
          last = x;
          break;
        }
      }
    /* 繪圖區右緣之外還剩多少乾淨的寬度（線尾名稱就寫在這一段裡）。 */
    return {
      width,
      height,
      right,
      last,
      beyond: Math.max(0, last - right),
      margin: width - 1 - last,
    };
  });

/**
 * 在歷季分析那一塊自己的「路段／路口」多選裡，剛好勾 count 個調查點。
 *
 * ⚠️ 多選面板**沒打開時整個不在 DOM 裡**，不可以直接找 checkbox。
 * ⚠️ 也不可以「一個都不勾＝全部」偷懶：那一條路走的是 roads=[] 分支，
 *   問不出「線數」這件事。要真的逐一勾。
 */
const selectPoints = async (count) => {
  const opened = await page.evaluate(() => {
    const block = document.getElementById("block-trend");
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
  const on = await page.evaluate((take) => {
    const block = document.getElementById("block-trend");
    const boxes = [
      ...block.querySelectorAll(
        '.multi-picker-panel .multi-picker-list input[type="checkbox"]',
      ),
    ];
    let picked = 0;
    for (const box of boxes) {
      const want = picked < take;
      if (box.checked !== want) box.click();
      if (want) picked += 1;
    }
    return picked;
  }, count);
  /* 面板收起來，免得它蓋住畫布（畫布是用 getImageData 讀的，不受遮擋影響，
     但收起來畫面才是使用者實際看到的樣子）。 */
  await page.evaluate(() => {
    const block = document.getElementById("block-trend");
    const button = [...block.querySelectorAll(".multi-picker-btn")].find((b) =>
      (b.getAttribute("aria-label") || "").startsWith("路段／路口"),
    );
    if (button && button.getAttribute("aria-expanded") === "true")
      button.click();
  });
  await page.waitForTimeout(1600);
  return on;
};

/* ══ ① 圖例分得出來時：線尾名稱不可以出現 ══════════════════ */
console.log("\n══ ① 三個調查點（圖例分得出來）══");
const few = await selectPoints(3);
if (few < 2) stop(`只挑到 ${few} 個調查點，畫不出多條線`);
const inkFew = await rightmostInk();
if (!inkFew) stop("找不到趨勢圖畫布");
else {
  console.log(
    `   畫布 ${inkFew.width}×${inkFew.height}，繪圖區右緣 ${inkFew.right}，最右邊的墨在 ${inkFew.last}（超出繪圖區 ${inkFew.beyond}px）`,
  );
  ok(
    "⚠️ ① 繪圖區右邊沒有任何字（線尾不再寫路段名稱）",
    inkFew.beyond <= 6,
    `超出繪圖區 ${inkFew.beyond}px`,
  );
}
/* ⚠️ 只驗「名稱不見了」不夠：識別不可以跟著不見。圖例要還在、而且有名字。 */
const legendNames = await page.evaluate(() => {
  const script = document.getElementById("trendScript");
  return (script?.textContent || "").length;
});
ok(
  "① 識別沒有跟著不見：底下的講稿／圖例仍然逐條寫出線名",
  legendNames > 20,
  `${legendNames} 個字`,
);

/* ══ ② 超過配色數（九條線）：線尾名稱不可以出現、而且不可以退成一色深灰 ══ */
/*
 * 2026-09-18 使用者裁示（附圖，11 條線）：
 *   「不要變成深灰，而是一樣可以畫出多路段（不設置上限），讓觀看者辨認的方式
 *     可以靠顏色、線條的虛實線或其他方式，讓使用者對照圖例去區分出來就好」
 *   「下方已經有圖例說明哪條線是路段，那就不需要有名稱標籤，會有彼此重疊問題」
 * 所以 X-79 的例外（超過配色數時保留線尾名稱、全部畫深灰）取消。
 * 這一段從「線尾名稱必須還在」翻成兩條：① 線尾沒有字；② 繪圖區裡的墨不是單一深灰
 *  （至少出現 4 種以上明顯不同的顏色）。
 *
 * ⚠️ 反面（e2e 之外做過）：改回舊寫法（tooMany → 全部 #3B3B3B ＋ 線尾名稱）重建，
 *   兩條都紅：線尾墨超出繪圖區 ≥20px、顏色只剩 1～2 種。
 */
console.log("\n══ ② 九個調查點（超過配色數）══");
const many = await selectPoints(9);
if (many < 9) stop(`只挑到 ${many} 個調查點，問不出「超過配色數」那一面`);
else {
  const inkMany = await rightmostInk();
  console.log(
    `   繪圖區右緣 ${inkMany.right}，最右邊的墨在 ${inkMany.last}（超出繪圖區 ${inkMany.beyond}px）`,
  );
  ok(
    "⚠️ ② 九條線時線尾也不可以有名稱（識別靠圖例：顏色＋線型）",
    inkMany.beyond <= 6,
    `超出繪圖區 ${inkMany.beyond}px`,
  );
  const hues = await page.evaluate(() => {
    const canvas = document.querySelector(".trend-canvas");
    if (!canvas) return 0;
    const c = canvas.getContext("2d");
    const left = Number(canvas.dataset.plotLeft), right = Number(canvas.dataset.plotRight);
    const top = Number(canvas.dataset.plotTop), bottom = Number(canvas.dataset.plotBottom);
    const data = c.getImageData(left, top, right - left, bottom - top).data;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
      if (a < 200) continue;
      /* 白底、格線、灰字都跳過：只數「有彩度」的像素（R/G/B 差距夠大） */
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue;
      seen.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
    return seen.size;
  });
  ok(
    "⚠️ ② 九條線不可以退成一色深灰：繪圖區裡至少有 4 種以上有彩度的顏色",
    hues >= 4,
    `量到 ${hues} 種`,
  );
}

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 線尾名稱：任何情況都不畫；超過配色數時靠顏色循環＋線型分辨，不退成深灰");
