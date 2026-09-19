import { gotoBlock } from "./e2e-nav.mjs";
/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一張圖都要能下載高解析 PNG
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「目前全日交通量一共有車種分析圓環圖、每小時實際交通量與PCU（24小時型態）
 *     趨勢圖、全日交通量平日／假日趨勢（歷季分析）圖、各路段平日與假日比較圖，
 *     但只有歷季分析的趨勢圖有可以高清晰圖片下載的功能，能否三個程式各自
 *     所有的圖都能有個下載高清晰圖片的功能呢?」
 *
 * 這支釘五件事：
 *   ① 圖表頁上**每一張圖**旁邊都有一顆下載鈕（不是只有趨勢圖）
 *   ② 按下去真的下載得到檔案，而且**真的是 PNG**（不是 0 byte 或壞檔）
 *   ③ ⚠️ 解析度真的是高的——量 PNG 檔頭裡的寬高，必須是版面尺寸的 3 倍。
 *      「有按鈕、也下載得到」但輸出只有畫面那麼大的話，使用者拿到的
 *      仍然是一張貼進報告會糊掉的圖，而畫面上完全看不出差別。
 *   ④ 檔名帶得出條件（換個季度或日別再按一次不會同名互相覆蓋）
 *   ⑤ 「一鍵下載全部圖檔」的清單項目數 ＝ 畫面上的下載鈕數
 *      （新增一張圖卻忘了加進清單，這一條會紅）
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

/*
 * ⚠️ 這支測試一定要**先匯入真的資料**再驗。
 *
 * 空的計畫也畫得出「一張圖」——標題、圖例、座標軸全都在，
 * 檔頭讀到的寬高也照樣是 2880。用空資料驗的話，
 * 「圓環少畫了一塊」「長條全部畫在 0」這一類錯誤一項都抓不到，
 * 而測試會全綠。量錯東西比沒有測試更糟。
 */
const SAMPLES = join(here, "..", ".samples-chart-png");
mkdirSync(SAMPLES, { recursive: true });
const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const BASE = { 機車: 900, 小型車: 700, 大貨車: 60, 聯結車: 25, 大客車: 40 };
const pad = (n) => String(n).padStart(2, "0");
function seeded(n) {
  let x = n * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280), x / 233280);
}
function sheetFor(seed, factor) {
  const rnd = seeded(seed);
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let hour = 0; hour < 24; hour += 1) {
    const label = `${pad(hour)}:00～${pad((hour + 1) % 24)}:00`;
    const cells = [];
    for (let d = 0; d < 2; d += 1)
      for (const vehicle of VEHICLES)
        cells.push(
          Math.round(BASE[vehicle] * factor * (d ? 0.85 : 1) * (0.9 + rnd() * 0.2)),
        );
    rows.push([label, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function writeBook(name, seed, factor) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(seed, factor), "平日");
  XLSX.utils.book_append_sheet(book, sheetFor(seed + 1, factor * 0.78), "假日");
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}
/* 兩個路段 × 兩季：圓環有切片、比較圖有兩列、趨勢圖有兩個點。 */
const FILES = [
  { name: writeBook("115T1-01_中山路_115Q1.xlsx", 5, 1), quarter: "115Q1" },
  { name: writeBook("115T1-02_岡山路_115Q1.xlsx", 9, 0.7), quarter: "115Q1" },
  { name: writeBook("115T1-01_中山路_115Q2.xlsx", 13, 1.1), quarter: "115Q2" },
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
await new Promise((r) => server.listen(8197, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 讀 PNG 的色彩型態（IHDR 第 25 byte）。
 *   0=灰階 2=RGB 3=索引 4=灰階+Alpha 6=RGBA
 * 白底這件事**一定要驗**：匯出端先填白、繪圖函式若又 clearRect 一次，
 * 白底就被擦掉變成透明——而畫面上完全看不出來（畫面本來就是白底卡片），
 * 只有貼到深色投影片上時字才會消失。實測踩過。
 */
function pngColorType(buffer) {
  return buffer.readUInt8(25);
}

/** 從 PNG 檔頭讀寬高（IHDR 固定在第 16～24 byte）。 */
function pngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept());
const downloads = [];
page.on("download", (d) => downloads.push(d));
await page.goto("http://localhost:8197/");
await page.waitForTimeout(1200);

/* ── 前置：建計畫並匯入資料 ── */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("圖檔匯出測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

async function importFile(name, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, name)),
    });
  await page.waitForTimeout(2200);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(2600);
  }
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}
for (const file of FILES) await importFile(file.name, file.quarter);
await page.waitForTimeout(1200);

/*
 * ⚠️ X-63（2026-09-17）：四張圖各自一個大分頁，所以「每一張圖旁邊都有
 *   下載鈕」要**逐頁走過去**收集。停在一頁只收得到一顆，
 *   `buttons.length >= 4` 會直接紅——而紅的是收集方式，不是功能。
 */
const CHART_ANCHORS = [
  "block-composition",
  "block-hourly",
  "block-trend",
  "block-comparison",
];
const buttons = [];
for (const anchor of CHART_ANCHORS) {
  await gotoBlock(page, anchor);
  const found = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chart-png]")].map((el) => ({
      id: el.getAttribute("data-chart-png"),
      text: (el.textContent || "").trim().replace(/\s+/g, " "),
      visible: el.getBoundingClientRect().width > 0,
    })),
  );
  /* ⚠️ 記住它屬於哪一塊——下面每一顆都要先切回自己那一頁才按得到。 */
  buttons.push(...found.map((b) => ({ ...b, anchor })));
}
ok(
  "① 圖表頁上每一張圖旁邊都有下載鈕",
  buttons.length >= 4,
  buttons.map((b) => b.id).join("、") || "一顆都沒有",
);
ok(
  "① 四張圖都在（車種組成、24小時型態、歷季趨勢、平假日比較）",
  ["composition", "hourly", "trend", "comparison"].every((id) =>
    buttons.some((b) => b.id === id || b.id.startsWith(id + "-")),
  ),
  buttons.map((b) => b.id).join("、"),
);
ok(
  "① 每一顆都看得見（不是藏在收合裡）",
  buttons.every((b) => b.visible),
  buttons.filter((b) => !b.visible).map((b) => b.id).join("、") || "全部看得見",
);
ok(
  "① 每一顆都註明「只有圖，不含說明文字」（下載下來不應該有講稿）",
  buttons.every((b) => b.text.includes("只有圖")),
  buttons.map((b) => `${b.id}：${b.text}`).join(" ｜ "),
);

/* ── ②③④ 每一顆按下去 ── */
const EXPECTED_SCALE = 3;
for (const button of buttons) {
  downloads.length = 0;
  await gotoBlock(page, button.anchor);
  await page.locator(`[data-chart-png="${button.id}"]`).first().click();
  await page.waitForTimeout(2500);
  ok(`② ${button.id}：按下去真的下載得到檔案`, downloads.length === 1, `${downloads.length} 個`);
  if (downloads.length !== 1) continue;
  const file = await downloads[0].path();
  const bytes = readFileSync(file);
  const size = pngSize(bytes);
  ok(
    `② ${button.id}：下載的是真的 PNG（不是空檔或壞檔）`,
    Boolean(size) && bytes.length > 2000,
    `${bytes.length} bytes、${size ? `${size.width}×${size.height}` : "不是 PNG"}`,
  );
  /*
   * ⚠️ 這一條才是「高清」兩個字的實質內容。
   *   有按鈕、也下載得到，但輸出只有版面那麼大的話，使用者拿到的
   *   仍然是貼進報告會糊掉的圖——而畫面上完全看不出差別。
   *   版面寬 960（CHART_EXPORT_SIZE），3 倍就是 2880。
   */
  ok(
    `③ ${button.id}：解析度是版面的 ${EXPECTED_SCALE} 倍（不是把畫面放大）`,
    Boolean(size) && size.width === 960 * EXPECTED_SCALE,
    size ? `寬 ${size.width}px（期望 ${960 * EXPECTED_SCALE}px）` : "讀不到尺寸",
  );
  /*
   * ⚠️ 白底。透明底貼到深色投影片上，字會看不見。
   *   這裡直接讀四個角落的像素——只驗色彩型態不夠，
   *   RGBA 的圖也可以是整片不透明的白。
   */
  const corners = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const at = (x, y) => [...context.getImageData(x, y, 1, 1).data];
    return [
      at(2, 2),
      at(image.width - 3, 2),
      at(2, image.height - 3),
      at(image.width - 3, image.height - 3),
    ];
  }, "data:image/png;base64," + bytes.toString("base64"));
  ok(
    `③ ${button.id}：四個角落都是不透明的白（透明底貼進深色投影片會看不到字）`,
    corners.every(
      ([r, g, b, a]) => a === 255 && r > 250 && g > 250 && b > 250,
    ),
    corners.map((c) => c.join(",")).join(" ｜ ") +
      `（色彩型態 ${pngColorType(bytes)}）`,
  );
}

/*
 * ── ④ 檔名 ──────────────────────────────────────────────────────
 *
 * ⚠️ 檔名**不可以**用 download.suggestedFilename() 驗（這個坑
 *   e2e-chart-layout.mjs 已經踩過並記錄）：headless Chromium 底下，
 *   即使 <a download="檔名.png"> 完全正確，Playwright 回報的
 *   suggestedFilename 一樣是 "download"。拿它來斷言等於在驗測試工具，
 *   而且會得到一個「怎麼改都修不好」的紅字，最後很可能被改成不驗。
 *   改成攔 <a> 的 click，直接看程式到底把檔名設成什麼。
 */
console.log("\n══ ④ 檔名 ══");
/* ⚠️ X-63：四顆分屬四個大分頁，逐頁攔一次。 */
const captured = {};
for (const button of buttons) {
  await gotoBlock(page, button.anchor);
  const name = await page.evaluate(async (id) => {
    const original = HTMLAnchorElement.prototype.click;
    let seen = "";
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) seen = this.download;
    };
    document.querySelector(`[data-chart-png="${id}"]`)?.click();
    await new Promise((done) => setTimeout(done, 900));
    HTMLAnchorElement.prototype.click = original;
    return seen;
  }, button.id);
  captured[button.id] = name;
}
for (const button of buttons) {
  const name = captured[button.id] || "";
  ok(
    `④ ${button.id}：有設定檔名，而且帶得出目前的條件`,
    name.endsWith(".png") && name.length > 10,
    name || "沒有設定檔名",
  );
  ok(
    `④ ${button.id}：檔名沒有空掉的段落（例如「_・」這種缺字）`,
    !/_・|・・|^_|_\.png$/.test(name),
    name,
  );
}
ok(
  "④ 四張圖的檔名彼此不同（同名的話會互相覆蓋）",
  new Set(Object.values(captured)).size === buttons.length,
  Object.values(captured).join("、"),
);

/* ── ⑤ 一鍵下載全部圖檔 ── */
console.log("\n══ ⑤ 一鍵下載全部圖檔 ══");
/* ⚠️ X-63：「一鍵下載全部圖檔」在「批次輸出」那一個大分頁。 */
await gotoBlock(page, "block-chart-png");
const listed = await page.evaluate(
  () => document.querySelectorAll("#block-chart-png .chart-png-all-list label").length,
);
ok(
  "⚠️ 清單項目數 ＝ 圖表頁上的下載鈕數（新增一張圖卻忘了加進清單，這一條會紅）",
  listed === buttons.length,
  `清單 ${listed} 項、圖表頁 ${buttons.length} 顆`,
);
/*
 * ══════════════════════════════════════════════════════════════════
 *  多張圖要打包成**一個**壓縮檔
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「下載多張圖片時，瀏覽器有時會阻擋一次下載多張圖，如果使用者沒注意，
 *     會以為下載失敗，請改成……以壓縮包形式下載」
 *
 * ⚠️ 這一條原本驗的是「下載個數 ＝ 清單項數」。那個期待**現在是錯的**，
 *   而且正是使用者要求改掉的行為：一次發好幾個下載會被瀏覽器攔截，
 *   被攔掉時沒有任何訊息。改成驗：
 *     ①只發**一個**下載
 *     ②它是 .zip
 *     ③**解開來裡面真的有那幾張 PNG**（只驗「有下載到一個檔」的話，
 *       壓成一個空的壓縮檔也會過）
 */
downloads.length = 0;
/*
 * ⚠️ 不可以用 download.suggestedFilename() 來驗檔名。
 *   實測：這個測試環境下**單張 PNG 的下載也一樣回報 "download"**
 *  （blob: 連結在 Playwright 的攔截下拿不到 download 屬性），
 *   所以那個值不能拿來判斷對錯——用它會誤判成「檔名壞了」。
 *   真正的檔名在 <a download> 屬性上，下面直接去讀那一顆。
 */
await page.evaluate(() => {
  window.__lastDownloadName = "";
  const original = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download) window.__lastDownloadName = this.download;
    return original.call(this);
  };
});
/* ⚠️ X-63：「一鍵下載全部圖檔」在「批次輸出」那一個大分頁。 */
await gotoBlock(page, "block-chart-png");
await page.locator("#downloadAllChartPng").click();
await page.waitForTimeout(2500 + buttons.length * 1200);
ok(
  "⑤ 多張圖只發一個下載（不可以一次發好幾個，會被瀏覽器擋掉）",
  downloads.length === 1,
  `下載 ${downloads.length} 個`,
);
if (downloads.length === 1) {
  const name = await page.evaluate(() => window.__lastDownloadName || "");
  ok("⑤ 下載的是壓縮檔，而且檔名帶得出目前的條件", /\.zip$/i.test(name) && name.length > 10, name);
  const saved = join(here, ".e2e-bundle.zip");
  await downloads[0].saveAs(saved);
  const JSZip = (await import("jszip")).default;
  const bundle = await JSZip.loadAsync(fs.readFileSync(saved));
  const entries = Object.keys(bundle.files);
  ok(
    `⑤ 壓縮檔裡真的有 ${listed} 張圖（空壓縮檔也會「下載成功」）`,
    entries.length === listed,
    `${entries.length} 個：${entries.join("、")}`,
  );
  ok(
    "⑤ 裡面每一個都是 .png，而且不是 0 位元組",
    entries.every((entryName) => /\.png$/i.test(entryName)) &&
      (await Promise.all(
        entries.map(async (entryName) =>
          (await bundle.files[entryName].async("uint8array")).length,
        ),
      )).every((size) => size > 1000),
    entries.join("、"),
  );
  fs.unlinkSync(saved);
}


ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 每一張圖都下載得到高解析 PNG；多張圖打包成一個壓縮檔");
