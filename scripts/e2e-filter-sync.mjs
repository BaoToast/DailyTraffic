import { gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";
/*
 * ══════════════════════════════════════════════════════════════════════
 *  圖表的功能列，和上方共同功能列是**同一份條件**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「圓形圖的功能列是自己一套，上面的共同功能列無法影響到它嗎? ……
 *     有些自己的功能列沒有與上面共同功能列同步，有些則是有同步，
 *     那到底是同步比較好，還是各自設定?」
 *   並在確認要修之後補一句（這一句是這支測試存在的理由）：
 *   「篩選錯誤和計算錯誤是一樣嚴重，因為我以為我篩的是A條件，
 *     結果卻是其他功能列B的條件，結果一樣嚴重。」
 *
 * 他是對的。舊版四張圖分成兩派：24小時型態與同季平假日跟著共同功能列，
 * 車種組成與歷季分析各有一份自己的 state。後果是在上面選了
 * 「某路段・某方向」往下捲，那兩張圖**還在講別的路段**，
 * 而畫面上沒有任何地方提醒你。這種錯不會壞掉，只會讓人看錯圖。
 *
 * 規矩（三支一致）：
 *   上方共同功能列**有**的條件（季度／日別／路段／方向）→ 圖表一律跟著它。
 *   圖表只在「上方沒有的條件」上才有自己的控制項
 *  （趨勢圖的起訖季度與指標就是這一類，因為上面沒有這種東西）。
 *
 * ⚠️ 這支測試**兩個方向都要驗**：
 *   ① 在上面改 → 每一張圖的抬頭與數字都要跟著變
 *   ② 在圖表自己的選擇器上改 → 上面也要跟著變
 *   只驗①的話，一份「單向複製」的實作會全綠，但使用者在圖上改完之後
 *   上面顯示的仍是舊條件——他一樣會以為自己篩的是 A。
 */
import { chromium } from "playwright";
import http from "node:http";
import fs, { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples-filter-sync");
mkdirSync(SAMPLES, { recursive: true });

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const pad = (n) => String(n).padStart(2, "0");
/*
 * 兩個路段的量刻意差很多（10 倍），這樣「有沒有真的換路段」
 * 用數字就看得出來——只比對標籤的話，一份「標籤換了、數字沒換」
 * 的實作會全綠，而那正是最危險的情況。
 */
function sheetFor(level) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let hour = 0; hour < 24; hour += 1) {
    const label = `${pad(hour)}:00～${pad((hour + 1) % 24)}:00`;
    const cells = [];
    for (const side of [level, level * 2])
      for (const vehicle of VEHICLES)
        cells.push(vehicle === "機車" ? side : 0);
    rows.push([label, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function writeBook(name, level) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(level), "平日");
  XLSX.utils.book_append_sheet(book, sheetFor(Math.round(level * 0.5)), "假日");
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}
const FILES = [
  { name: writeBook("115T7-01_甲路段_115Q1.xlsx", 100), label: "甲路段" },
  { name: writeBook("115T7-02_乙路段_115Q1.xlsx", 1000), label: "乙路段" },
];

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
await new Promise((r) => server.listen(8209, r));

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
await page.goto("http://localhost:8209/");
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(1300);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("篩選同步測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);

/*
 * ⚠️ 兩份檔案要**一次選進去**。
 *   分兩次呼叫匯入時，第二次會靜靜地沒有生效（實測 IndexedDB 只有一個
 *   files 紀錄、96 筆 records＝只有第一份），而畫面上看起來一切正常——
 *   前置檢查若只數「有沒有列」就會假通過，整支測試等於在測一個路段。
 */
async function importFiles(names) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(500);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill("115Q1");
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles(
      names.map((name) => ({
        name,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readFileSync(join(SAMPLES, name)),
      })),
    );
  await page.waitForTimeout(3200);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3200);
  }
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(700);
  }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}
await importFiles(FILES.map((file) => file.name));
await page.waitForTimeout(1000);

await gotoBlock(page, "block-composition");

/**
 * 每一張圖現在宣稱的條件，以及它畫出來的數字。
 *
 * ⚠️ X-63（2026-09-17）：四張圖各自一個大分頁，別頁的區塊**不在 DOM 裡**，
 *   所以這一份要逐頁走過去收集。停在一頁讀的話，另外三張的欄位全是空字串，
 *   前置檢查會紅、而後面的比對會恆真——一半紅一半假綠。
 */
const snapshot = async () => {
  const out = {};
  await gotoBlock(page, "block-composition");
  Object.assign(
    out,
    await page.evaluate(() => {
      const text = (selector) =>
        (document.querySelector(selector)?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      /*
       * ⚠️ 稽核表 ① 之後，多個調查點時面板裡有**好幾個**圓環。
       *   只取第一個的話，「兩個路段 → 只剩甲路段」這個動作前後
       *   讀到的都是甲路段那一組，數字當然不變——紅的會是量法，不是功能。
       *   改成把**全部圓環的中心數字**串起來當一份指紋：
       *   組數變了、任何一組的數字變了，指紋都會不一樣。
       */
      const centers = [
        ...document.querySelectorAll("#block-composition .donut strong"),
      ].map((node) => node.textContent.trim());
      return {
        compositionHead: text("#block-composition .panel-title h3"),
        compositionTotal: centers.join("｜"),
      };
    }),
  );
  await gotoBlock(page, "block-trend");
  Object.assign(
    out,
    await page.evaluate(() => {
      const text = (selector) =>
        (document.querySelector(selector)?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      return {
        trendHead: text("#block-trend .trend-pinned .panel-title h3"),
        /* 趨勢圖的講稿第一句會寫出它到底在畫哪一個路段／日別。 */
        trendScript: text("#block-trend .trend-script-item p"),
      };
    }),
  );
  await gotoBlock(page, "block-hourly");
  Object.assign(
    out,
    await page.evaluate(() => ({
      hourlyFilters: (
        document.querySelector("#block-hourly .block-filters")?.textContent || ""
      )
        .replace(/\s+/g, " ")
        .trim(),
    })),
  );
  await gotoBlock(page, "block-comparison");
  Object.assign(
    out,
    await page.evaluate(() => ({
      /* ⚠️ 一列裡有好幾個 <strong>（名稱與兩個數值），只取名稱那一個，
         否則 length 會把一列數成三列，前置檢查就會假通過。 */
      comparisonRows: [
        ...document.querySelectorAll("#block-comparison .comparison-row > div:first-child > strong"),
      ].map((el) => el.textContent.trim()),
    })),
  );
  return out;
};

/** 上方共同功能列現在顯示的條件。 */
const toolbar = () =>
  page.evaluate(() => {
    const label = (name) => {
      const field = [...document.querySelectorAll(".filters .filter-field")].find(
        (el) => (el.querySelector(".filter-field-label")?.textContent || "").includes(name),
      );
      return (field?.querySelector("button")?.textContent || "").replace(/\s+/g, " ").trim();
    };
    const day = [...document.querySelectorAll(".filters label")].find((el) =>
      (el.childNodes[0]?.textContent || "").includes("日別"),
    );
    return {
      road: label("路段"),
      direction: label("方向"),
      day: day?.querySelector("select")?.value || "",
    };
  });

const before = await snapshot();
ok(
  "前置：兩個路段都匯進來了，四張圖都畫得出來",
  before.comparisonRows.length >= 2 && before.compositionTotal.length > 0,
  `比較圖 ${before.comparisonRows.length} 列、圓環中心 ${before.compositionTotal}`,
);

/* ── ① 在上方共同功能列改路段 → 四張圖都要跟著變 ── */
console.log("\n══ ① 在上方改，圖要跟著變 ══");
await page
  .locator('.filters .filter-field:has-text("路段") button')
  .first()
  .click();
await page.waitForTimeout(400);
await page
  .locator('.multi-picker-panel label:has-text("甲路段"), .picker-panel label:has-text("甲路段")')
  .first()
  .click()
  .catch(async () => {
    await page.evaluate(() => {
      const target = [...document.querySelectorAll("label")].find((el) =>
        (el.textContent || "").includes("甲路段"),
      );
      target?.querySelector("input")?.click();
    });
  });
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
const afterRoad = await snapshot();
const bar = await toolbar();
ok(
  "前置：上方功能列確實只剩一個路段",
  bar.road.includes("甲路段"),
  `上方顯示「${bar.road}」`,
);
ok(
  "① 車種組成的抬頭跟著上方變了（舊版它有自己一份，完全不動）",
  afterRoad.compositionHead.includes("甲路段"),
  `抬頭「${afterRoad.compositionHead}」`,
);
/*
 * ⚠️ 一定要連**數字**一起驗。只比對標籤的話，一份「標籤換了、
 *   數字沒換」的實作會全綠——而那正是最危險的情況：
 *   使用者看到標籤寫甲路段，數字卻是兩段合計。
 */
ok(
  "⚠️ ① 車種組成的**數字**也跟著變（不是只換標籤）",
  afterRoad.compositionTotal !== before.compositionTotal,
  `${before.compositionTotal} → ${afterRoad.compositionTotal}`,
);
ok(
  "① 歷季分析的抬頭跟著上方變了（舊版它也有自己一份）",
  afterRoad.trendHead.includes("甲路段") ||
    afterRoad.trendScript.includes("甲路段"),
  `抬頭「${afterRoad.trendHead}」／講稿「${afterRoad.trendScript.slice(0, 40)}」`,
);
ok(
  "① 同季平假日只剩選到的那一個路段",
  afterRoad.comparisonRows.length === 1 &&
    afterRoad.comparisonRows[0].includes("甲路段"),
  afterRoad.comparisonRows.join("、"),
);

/* ── ② 在圖表自己的選擇器上改 → 上方也要跟著變 ── */
console.log("\n══ ② 在圖上改，上方也要跟著變 ══");
/*
 * ⚠️ 這個方向不可以省。只驗①的話，一份「單向複製」的實作會全綠，
 *   但使用者在圖上改完之後，上面顯示的仍是舊條件——他一樣會以為
 *   自己篩的是 A。
 */
/* ⚠️ X-63：歷季分析自己一個大分頁，要先切過去才點得到它的路段選單。 */
await gotoBlock(page, "block-trend");
await page
  .locator('#block-trend .trend-pinned .filter-field:has-text("路段") button')
  .first()
  .click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const target = [...document.querySelectorAll("label")].find((el) =>
    (el.textContent || "").includes("乙路段"),
  );
  target?.querySelector("input")?.click();
});
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
const bar2 = await toolbar();
ok(
  "⚠️ ② 在歷季分析的選擇器上加選，**上方共同功能列**也跟著變",
  bar2.road !== bar.road,
  `上方由「${bar.road}」變成「${bar2.road}」`,
);
const afterTrend = await snapshot();
ok(
  "② 而且其他圖也一起跟著變（＝真的是同一份條件）",
  afterTrend.comparisonRows.length === 2,
  afterTrend.comparisonRows.join("、"),
);

/* ── ③ 日別也要同步 ── */
console.log("\n══ ③ 日別 ══");
await page.evaluate(() => {
  const day = [...document.querySelectorAll(".filters label")].find((el) =>
    (el.childNodes[0]?.textContent || "").includes("日別"),
  );
  const select = day?.querySelector("select");
  if (select) {
    select.value = "假日";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
});
await page.waitForTimeout(900);
const afterDay = await snapshot();
ok(
  "③ 車種組成的日別跟著上方變成「假日」",
  afterDay.compositionHead.startsWith("假日"),
  `抬頭「${afterDay.compositionHead}」`,
);
ok(
  "③ 歷季分析的日別也跟著變（舊版它有自己的 trendMode）",
  afterDay.trendScript.includes("假日") || afterDay.trendHead.includes("假日"),
  `講稿「${afterDay.trendScript.slice(0, 50)}」`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 四張圖與共同功能列是同一份條件，兩個方向都同步");
