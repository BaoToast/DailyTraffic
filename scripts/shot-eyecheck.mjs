/*
 * 肉眼檢查用：把每一頁、每一張圖拍下來（全日交通量）。
 *
 * ⚠️ 這一支**不判斷對錯**，只把畫面拍清楚。自動守門看得到數字與 DOM，
 *   看不到「字被切掉」「標籤疊在一起」「長條與刻度對不上」——
 *   那些只有真的看一眼才會發現（使用者 2026-09-14 指名要肉眼確認）。
 * ⚠️ 前置的建測資與 e2e-main-toolbar.mjs／capture-baseline.mjs 同一份，
 *   三支要吃一模一樣的資料，改測資時一起改。
 *
 * 用法：node scripts/shot-eyecheck.mjs
 */
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
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





/* ══════════════════ 以下：逐頁截圖 ══════════════════ */
import { rmSync } from "node:fs";
import { TABS, gotoTab } from "./e2e-nav.mjs";

const OUT = join(here, ".shots");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const safe = (text) => text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, "_");

let index = 0;
for (const [key, zone] of Object.entries(TABS)) {
  index += 1;
  await gotoTab(page, zone);
  await page.waitForTimeout(1200);
  const label = await page.evaluate(
    (id) =>
      (
        document.querySelector(`.side-nav button[data-goto="${id}"]`)
          ?.textContent || id
      )
        .replace(/\s+/g, "")
        .trim(),
    zone,
  );
  const name = `${String(index).padStart(2, "0")}_${safe(label) || key}`;
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  const panels = await page.locator(`#${zone} .panel`).all();
  let panelIndex = 0;
  for (const panel of panels) {
    panelIndex += 1;
    if (panelIndex > 14) break;
    const box = await panel.boundingBox();
    if (!box || box.height < 80) continue;
    const title = (
      await panel.evaluate(
        (node) => node.querySelector("h2, h3, .panel-head h2, .panel-head h3")?.textContent || "",
      )
    )
      .replace(/\s+/g, "")
      .slice(0, 14);
    await panel
      .screenshot({
        path: join(
          OUT,
          `${name}--${String(panelIndex).padStart(2, "0")}_${safe(title) || "區塊"}.png`,
        ),
      })
      .catch(() => {});
  }
  console.log(`  ✔ ${name}（${panels.length} 個區塊）`);
}
await browser.close();
server.close();
console.log(`\n拍完了：${OUT}`);
