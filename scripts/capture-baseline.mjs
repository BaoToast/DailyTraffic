/*
 * ══════════════════════════════════════════════════════════════════════
 *  升級前後逐格比對用的「數字基準」（全日交通量）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 與另外兩支同一套做法。重點：
 *   ・存的是**每個數字在哪個元素裡**，位置對調也抓得到
 *   ・主工具列與篩選列本身要排除（它們每一頁都在，改條件當然會變）
 *   ・只遮**帶日期**的時間戳；「07:00~08:00」這種尖峰視窗**不可以遮**
 *
 * ⚠️ 測資用程式產生，內容固定：
 *   路段的平日尖峰刻意排在 17 時（往北）與 7 時（往南），假日在 10 時；
 *   路口的 A、C 支線尖峰錯開。這樣「尖峰時段認定」換一種算法時數字會不同，
 *   升級後才驗得出「沒改設定時數字一個都沒變」。
 *
 * 用法：node scripts/capture-baseline.mjs 升級前
 */
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const XLSX = require("xlsx");
const ROOT = join(here, "..", "github-pages", "dist");
const outDir = join(here, "..", "..", "baseline");
mkdirSync(outDir, { recursive: true });
const tag = process.argv[2] || "未命名";

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const pad = (value) => String(value).padStart(2, "0");
function roadSheet(level, peakNorth, peakSouth) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let hour = 0; hour < 24; hour += 1) {
    const cells = [];
    for (const [side, peak] of [
      [level, peakNorth],
      [level * 2, peakSouth],
    ])
      for (const vehicle of VEHICLES)
        cells.push(
          vehicle === "機車"
            ? hour === peak
              ? side * 3
              : side
            : Math.round(side / 4),
        );
    rows.push([`${pad(hour)}:00～${pad((hour + 1) % 24)}:00`, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function roadBook(name, level) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, roadSheet(level, 17, 7), "平日");
  XLSX.utils.book_append_sheet(
    book,
    roadSheet(Math.round(level * 0.5), 10, 10),
    "假日",
  );
  return { name, buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) };
}
function intersectionBook(name, bump) {
  const width = 14;
  const arms = ["A", "B", "C", "D"];
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const hours = Array.from(
    { length: 24 },
    (_unused, hour) => `${pad(hour)}:00~${pad((hour + 1) % 24)}:00`,
  );
  const rows = Array.from({ length: 6 + hours.length }, () =>
    Array(arms.length * width).fill(null),
  );
  arms.forEach((code, index) => {
    const cell = index * width;
    rows[0][cell] = "站號：A00T00-01";
    rows[1][cell] = "站名：基準測試路口";
    rows[2][cell] = "日期：115年04月15日（平日）";
    rows[3][cell] = `路口編號：路口${code}`;
    rows[4][cell] = "時段";
    vehicles.forEach((vehicle, vehicleIndex) => {
      for (let offset = 0; offset < 3; offset += 1)
        rows[4][cell + 1 + vehicleIndex * 3 + offset] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][cell + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    hours.forEach((_label, hourIndex) => {
      rows[6 + hourIndex][cell] = hours[hourIndex];
      vehicles.forEach((_vehicle, vehicleIndex) => {
        movements.forEach((_movement, movementIndex) => {
          /* A、C 支線傍晚忙，B、D 早上忙——兩種尖峰認定會給出不同答案。 */
          const peak = index % 2 === 0 ? 17 : 8;
          rows[6 + hourIndex][cell + 1 + vehicleIndex * 3 + movementIndex] =
            bump +
            5 +
            ((index + vehicleIndex + movementIndex + hourIndex) % 9) +
            (hourIndex === peak ? 40 : 0);
        });
      });
    });
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "平日");
  return { name, buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) };
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((request, response) => {
  let path = decodeURIComponent(request.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = join(ROOT, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
  });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(event.type() === "prompt" ? "N" : ""));
await page.goto(base);
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (
  !(await page.locator(".modal input").first().isVisible().catch(() => false))
)
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("基準比對用計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(1000);

async function importFiles(files, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(600);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles(
      files.map((file) => ({
        name: file.name,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: file.buffer,
      })),
    );
  await page.waitForTimeout(4000);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(4000);
  }
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(900);
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
}
await importFiles(
  [roadBook("115T7-01_甲路段_115Q1.xlsx", 100), intersectionBook("A00T00-01_基準測試路口_115Q1.xlsx", 0)],
  "115Q1",
);
await importFiles(
  [roadBook("115T7-01_甲路段_115Q2.xlsx", 150), intersectionBook("A00T00-01_基準測試路口_115Q2.xlsx", 7)],
  "115Q2",
);
await page.waitForTimeout(1500);

const zones = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav-group > button[data-goto]")].map(
    (button) => ({
      id: button.dataset.goto,
      label: (button.textContent || "").replace(/\s+/g, "").trim(),
    }),
  ),
);

const snapshot = { tag, capturedAt: new Date().toISOString(), pages: {} };
for (const zone of zones) {
  await page.evaluate((id) => {
    const button = [
      ...document.querySelectorAll(".side-nav-group > button[data-goto]"),
    ].find((node) => node.dataset.goto === id);
    if (button) button.click();
  }, zone.id);
  await page.waitForTimeout(1100);
  snapshot.pages[zone.label] = await page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [...host.querySelectorAll(".toolbar, .filters, .main-toolbar")];
    const inSkip = (element) => skip.some((node) => node.contains(element));
    const pathOf = (element) => {
      const parts = [];
      for (let node = element; node && node !== host; node = node.parentElement) {
        const parent = node.parentElement;
        const index = parent ? [...parent.children].indexOf(node) : 0;
        parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
      }
      return parts.join(">");
    };
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const out = [];
    let node;
    while ((node = walker.nextNode())) {
      const element = node.parentElement;
      if (!element || inSkip(element)) continue;
      const text = (node.nodeValue || "").trim();
      if (!text) continue;
      /* 只遮帶日期的時間戳；「07:00~08:00」這種尖峰視窗不可以遮。 */
      const looksLikeTime = /\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(text);
      const numbers = looksLikeTime
        ? ["<時間戳>"]
        : (text.match(/-?\d[\d,]*\.?\d*/g) || [])
            .map((value) => value.replace(/,/g, ""))
            .map((value) => (/^1[6-9]\d{11}$/.test(value) ? "<時間戳>" : value));
      if (!numbers.length) continue;
      out.push({ at: pathOf(element), text, numbers });
    }
    return out;
  });
}
snapshot.errors = errors;

const file = join(outDir, `n2064-${tag}.json`);
writeFileSync(file, JSON.stringify(snapshot, null, 1), "utf8");
const total = Object.values(snapshot.pages).reduce(
  (sum, list) => sum + list.reduce((n, cell) => n + cell.numbers.length, 0),
  0,
);
console.log(`已存下 ${Object.keys(snapshot.pages).length} 頁、${total} 個數字`);
for (const [label, list] of Object.entries(snapshot.pages))
  console.log(`  ${label}：${list.reduce((n, c) => n + c.numbers.length, 0)} 個`);
if (errors.length) console.log("⚠️ 期間有 JS 例外：", errors.slice(0, 3));
console.log("→", file);
await browser.close();
server.close();
