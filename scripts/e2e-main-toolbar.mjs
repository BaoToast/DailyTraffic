/*
 * ══════════════════════════════════════════════════════════════════════
 *  端對端：主工具列的三態（鏡子／脫離／回歸）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 下面**前半段**（到「主工具列的三態」那個標題為止）是**建測資**用的，
 *   與 scripts/capture-baseline.mjs 是同一份：用程式產生 Excel、開網頁匯入。
 *   會整段抄過來，是因為兩支要吃**一模一樣**的資料——基準比對量到的數字
 *   和這一支量到的數字若不是同一批，兩邊就對不起來。
 *   改測資時**兩支要一起改**。
 *
 *   測資內容固定：
 *     路段的平日尖峰刻意排在 17 時（往北）與 7 時（往南），假日在 10 時；
 *     路口的 A、C 支線尖峰錯開。這樣「尖峰時段認定」換一種算法時數字會不同。
 *
 * 用法：node scripts/e2e-main-toolbar.mjs
 */
import { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import http from "node:http";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./e2e-nav.mjs";

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
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);

/* ══ ⓪-2c 一開機時主工具列要是**收合**的（X-78）════════════════
 *
 * 使用者 2026-09-17：「重新載入或第一次開網頁時，主工具列是否能預設為
 *   收合狀態。下方版面比較清楚」——三支同步。
 *
 * ⚠️ 兩件事一起驗，缺一條都守不住：
 *   ① 那一排條件真的收起來了（量**實際高度**，不是只看 hidden 屬性——
 *      `display:flex` 的權重比瀏覽器內建的 `[hidden]{display:none}` 高，
 *      只驗屬性的話畫面明明還看得見也會全綠，這是 2026-09-15 實測過的坑）
 *   ② 收起來之後**仍然看得到目前的條件**。收合不可以把「現在依什麼在算」
 *      一起藏掉，那比佔版面更糟。
 *
 * ⚠️ 這裡只**量**，不判斷：ok() 在下面才宣告（const，用在宣告前會直接
 *   ReferenceError）。但量一定要在 ensureToolbarOpen() **之前**——
 *   展開之後再量，量到的是展開狀態，整條恆假／恆真都可能。
 *   判斷寫在 ok() 宣告之後，搜「⓪-2c」就找得到另一半。
 */
const startupToolbar = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="main-toolbar"]');
  const row = bar?.querySelector(".main-toolbar-row");
  const summary = bar?.querySelector('[data-testid="mt-summary"]');
  const toggle = bar?.querySelector('[data-testid="mt-toggle"]');
  return {
    found: Boolean(bar),
    expanded: toggle?.getAttribute("aria-expanded"),
    rowHeight: row ? Math.round(row.getBoundingClientRect().height) : -1,
    summary: (summary?.textContent || "").replace(/\s+/g, " ").trim(),
  };
});
await ensureToolbarOpen(page);
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




/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的三態：鏡子／脫離／回歸
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 裁示（三支程式共用同一套機制）：
 *   ①「圖可以自己改，但只影響那一張」
 *   ②「針對共同的篩選條件……圖表自身的工具列仍舊要與主工具列同步」
 *   ③「主工具列也多一個全部回歸鈕……避免有部分圖表忘記點選回歸」
 *
 * ── 這一支為什麼要這樣驗 ─────────────────────────────────────
 *
 * ⚠️ ①和②要**一起驗**。只驗①的話，一個「區塊上永遠顯示自己的預設值、
 *   根本不看主工具列」的實作也會全綠——而那正是升級前這一支的毛病：
 *   各區塊的工具列讀寫的是**同一份全域狀態**，在「24 小時型態」改一下日別，
 *   車種組成、平假日比較、可追溯明細全部跟著換，而那幾塊上沒有任何字說明。
 *
 * ⚠️ 驗「鏡子」不可以只比對下拉的 value。value 對了但畫面沒重算的話
 *   （圖還是舊的），使用者照樣會把錯的數字抄走。所以每一步都**連數字一起量**。
 */
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* ── ⓪-2c 的判斷（量在最上面 page.goto 之後，見 startupToolbar）── */
ok(
  "前置：主工具列在畫面上（不在的話下面兩條恆真）",
  startupToolbar.found,
);
ok(
  "⚠️ ⓪-2c 一開機時主工具列是收合的（條件那一排高度為 0）",
  startupToolbar.found &&
    startupToolbar.expanded === "false" &&
    startupToolbar.rowHeight <= 0,
  `aria-expanded=${startupToolbar.expanded}／條件列高 ${startupToolbar.rowHeight}px`,
);
ok(
  "⚠️ ⓪-2c 收合狀態下仍然看得到目前的條件（收合不可以把口徑一起藏掉）",
  startupToolbar.found && startupToolbar.summary.length >= 4,
  startupToolbar.summary || "（收合列上什麼都沒寫）",
);

const goZone = async (id) => {
  await page.evaluate((zoneId) => {
    const button = [
      ...document.querySelectorAll(".side-nav-group > button[data-goto]"),
    ].find((node) => node.dataset.goto === zoneId);
    if (button) button.click();
  }, id);
  await page.waitForTimeout(900);
};
/*
 * ⚠️ X-63（2026-09-17）：四張圖各自一個大分頁，所以「切到某一塊」
 *   已經不是「切到那一區」了。照側欄的 data-anchor 點過去。
 */
const goBlock = async (anchor) => {
  /*
   * ⚠️ X-73 起側欄是手風琴：只有目前那一頁的小分頁會列出來，
   *   要點的那一顆可能還不存在。找不到就**逐頁點過去找**，
   *   這也正是使用者自己會做的事。
   */
  const clicked = await page.evaluate((id) => {
    const node = document.querySelector(`.side-nav button[data-anchor="${id}"]`);
    if (!node) return false;
    node.click();
    return true;
  }, anchor);
  if (!clicked) {
    const pageIds = await page.evaluate(() =>
      [...document.querySelectorAll(".side-nav button[data-goto-page]")].map(
        (node) => node.getAttribute("data-goto-page"),
      ),
    );
    for (const pageId of pageIds) {
      await page.evaluate((id) => {
        document.querySelector(`.side-nav button[data-goto-page="${id}"]`)?.click();
      }, pageId);
      await page.waitForTimeout(220);
      const hit = await page.evaluate((id) => {
        const node = document.querySelector(`.side-nav button[data-anchor="${id}"]`);
        if (!node) return false;
        node.click();
        return true;
      }, anchor);
      if (hit) break;
    }
  }
  await page.waitForTimeout(900);
};
/** 內容區的數字指紋（排除工具列與提示）。 */
const numbers = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const skip = [
      ...host.querySelectorAll(
        ".toolbar, .filters, .main-toolbar, .block-filters, .period-scope-filters, .chart-detach-note, .chart-inapplicable",
      ),
    ];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return (text.match(/-?\d[\d,]*\.?\d*/g) || [])
      .map((v) => v.replace(/,/g, ""))
      .join("|");
  });
/** 某一塊自己的工具列上，某一個 label 的下拉目前是什麼。 */
const blockSelectValue = (blockId, labelText) =>
  page.evaluate(
    ([id, text]) => {
      const block = document.getElementById(id);
      if (!block) return null;
      const label = [...block.querySelectorAll("label")].find((node) =>
        (node.textContent || "").trim().startsWith(text),
      );
      return label?.querySelector("select")?.value ?? null;
    },
    [blockId, labelText],
  );
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

/* ══ ⓪ 主工具列在每一頁都看得到，而且條件都在 ══ */
const zones = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav-group > button[data-goto]")].map(
    (button) => button.dataset.goto,
  ),
);
const missing = [];
for (const zone of zones) {
  await goZone(zone);
  const shown = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="main-toolbar"]');
    if (!bar) return false;
    return bar.getBoundingClientRect().height > 0;
  });
  if (!shown) missing.push(zone);
}
ok("⓪ 主工具列在每一頁都看得到", missing.length === 0, missing.join("、"));
const CONTROLS = [
  ["mt-quarter-from", "季度（起）"],
  ["mt-quarter-to", "季度（迄）"],
  ["mt-day", "日別"],
  ["mt-flow-view", "路口流量視角"],
  ["mt-period", "調查時段"],
  ["mt-peak-scope", "尖峰時段認定"],
  ["mt-metric", "顯示數值"],
];
const absent = [];
for (const [id, label] of CONTROLS)
  if ((await page.locator(`[data-testid="${id}"]`).count()) === 0)
    absent.push(label);
ok(
  "⓪-2 使用者指定的每一個條件都在主工具列上（少一個就是掉功能）",
  absent.length === 0,
  absent.join("、"),
);
/* ⓪-3 調查時段五個、流量視角三個（含使用者追加的並列） */
const periodOptions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-period"] option')].map((o) =>
    o.textContent.trim(),
  ),
);
ok(
  "⓪-3 調查時段五個選項（含「上午＋下午並列」）",
  periodOptions.length === 5 && periodOptions.includes("上午＋下午並列"),
  periodOptions.join("／"),
);
const flowOptions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-flow-view"] option')].map(
    (o) => o.textContent.trim(),
  ),
);
ok(
  "⓪-4 路口流量視角三個選項（含「駛出＋駛入並列」）",
  flowOptions.length === 3 && flowOptions.some((t) => t.includes("並列")),
  flowOptions.join("／"),
);
const metricOptions = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-metric"] option')].map((o) =>
    o.textContent.trim(),
  ),
);
ok(
  "⓪-5 顯示數值五個選項（含兩個組合）",
  metricOptions.length === 5,
  metricOptions.join("／"),
);

/* ══ ① 鏡子：主工具列一改，區塊上那一顆與數字都跟著變 ══ */
/* ⚠️ X-63：這一節要量的是「24 小時型態」那一塊，它自己一個大分頁。 */
await goBlock("block-hourly");
const chartsBefore = await numbers();
ok("前置①：圖表區量得到數字", chartsBefore.length > 20);
await page.selectOption('[data-testid="mt-day"]', "假日");
await page.waitForTimeout(1200);
ok(
  "① 主工具列改成「假日」→ 圖表區的數字跟著變",
  (await numbers()) !== chartsBefore,
);
ok(
  "① 24 小時型態那一塊的「日別」跟著變成假日（鏡子）",
  (await blockSelectValue("block-hourly", "日別")) === "假日",
  String(await blockSelectValue("block-hourly", "日別")),
);
ok(
  "① 這時候**不該**出現「本區塊使用自己的條件」（它還跟著主工具列）",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);
await page.selectOption('[data-testid="mt-day"]', "平日");
await page.waitForTimeout(1200);

/* ══ ② 脫離：在 24 小時型態改它自己的日別，只有那一塊變 ══ */
/*
 * ⚠️ 脫離的那一塊要挑**畫面上有數字可以量**的。
 *   第一版挑「24 小時型態」，結果它是 <canvas>——整塊幾乎沒有文字數字，
 *   改了條件指紋當然不變，守門紅字寫著「數字沒變」，
 *   但那不是程式沒生效，是**量錯東西**。守門自己說謊比沒有守門更糟。
 *   車種組成那一塊底下有一份逐車種的數字清單，量得到。
 */
/* ⚠️ X-63：車種組成也自己一個大分頁，先切過去再量它的數字。 */
await goBlock("block-composition");
const beforeDetach = await numbers();
ok(
  "② 找得到車種組成那一塊自己的日別下拉",
  await setBlockSelect("block-composition", "日別", "假日"),
);
await page.waitForTimeout(1200);
ok("② 改了之後這一區的數字變了", (await numbers()) !== beforeDetach);
ok(
  "② 出現「目前用本區塊自己的條件」與回歸鈕",
  (await page.locator('[data-testid="chart-detach-note"]').count()) >= 1 &&
    (await page.locator('[data-testid="chart-detach-reset"]').count()) >= 1,
);
ok(
  "② 那一行要寫出**主工具列現在是什麼**",
  /主工具列：/.test(
    await page.locator('[data-testid="chart-detach-note"]').first().innerText(),
  ),
);
ok(
  "② **主工具列自己不可以被帶著跑**",
  (await page.inputValue('[data-testid="mt-day"]')) === "平日",
  await page.inputValue('[data-testid="mt-day"]'),
);
/* ⚠️ X-63：要回到 24 小時型態那一頁才量得到它的下拉。 */
await goBlock("block-hourly");
ok(
  "② **24 小時型態那一塊不受影響**（它是另一塊）",
  (await blockSelectValue("block-hourly", "日別")) === "平日",
  String(await blockSelectValue("block-hourly", "日別")),
);

/* ══ ③ 單塊回歸 ══ */
/* ⚠️ X-63：脫離的是車種組成那一塊，回歸鈕也掛在它自己那一頁上。 */
await goBlock("block-composition");
await page.locator('[data-testid="chart-detach-reset"]').first().click();
await page.waitForTimeout(1200);
ok(
  "③ 按「回到主工具列條件」之後，數字回到跟著主工具列的那一份",
  (await numbers()) === beforeDetach,
);
ok(
  "③ 回歸之後那一條提示要消失",
  (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);

/* ══ ④ 全部回歸 ══ */
ok(
  "④ 前置：沒有人脫離時，主工具列**不可以**出現「回歸全部」（按下去沒反應的鈕＝壞掉的鈕）",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0,
);
/* ⚠️ X-63：兩塊分屬兩個大分頁，各自切過去再改。 */
await goBlock("block-hourly");
await setBlockSelect("block-hourly", "日別", "假日");
await page.waitForTimeout(900);
await goBlock("block-composition");
await setBlockSelect("block-composition", "日別", "假日");
await page.waitForTimeout(900);
const resetAll = page.locator('[data-testid="mt-reset-all"]');
ok("④ 有區塊脫離之後，「回歸全部」才出現", (await resetAll.count()) === 1);
ok(
  "④ 而且要寫出**有幾塊**（使用者才知道按下去影響多少）",
  /\d+\s*塊/.test(await resetAll.innerText()),
  await resetAll.innerText(),
);
await resetAll.click();
await page.waitForTimeout(1200);
ok(
  "④ 按下去之後全部回到主工具列，那一顆鈕自己也收掉",
  (await page.locator('[data-testid="mt-reset-all"]').count()) === 0 &&
    (await page.locator('[data-testid="chart-detach-note"]').count()) === 0,
);
/* ⚠️ X-63：兩塊分屬兩個大分頁，各自切過去才量得到它的下拉。 */
await goBlock("block-hourly");
const hourlyBack = await blockSelectValue("block-hourly", "日別");
await goBlock("block-composition");
const compositionBack = await blockSelectValue("block-composition", "日別");
ok(
  "④ 而且兩塊的下拉都真的回到主工具列的值",
  hourlyBack === "平日" && compositionBack === "平日",
  `24小時型態=${hourlyBack}／車種組成=${compositionBack}`,
);

/* ══ ⑤ 「恢復預設條件」（X-10，使用者 2026-09-16）══════════════
 *
 * ⚠️ 正反兩面都要守：
 *   ・條件是預設 → 那一顆**不可以**出現（主工具列要簡潔）
 *   ・條件動過　 → 出現，按了之後每一格回到預設
 *   ・按了它**不可以**動到脫離中的區塊（那是「回歸全部」的事）
 *   只驗第二面的話，做成「永遠顯示」也會全綠。
 */
console.log("\n══ ⑤ 一鍵把主工具列的條件回到預設 ══");
ok(
  "⑤ 預設狀態下**不可以**出現「恢復預設條件」",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
);
await page.selectOption('[data-testid="mt-day"]', "假日");
await page.waitForTimeout(700);
await page.selectOption('[data-testid="mt-period"]', "am");
await page.waitForTimeout(700);
/* 順便讓一塊脫離，驗這一顆不會動到它。 */
await setBlockSelect("block-composition", "日別", "平日");
await page.waitForTimeout(900);
const detachedBefore = await page
  .locator('[data-testid="chart-detach-note"]')
  .count();
const resetMain = page.locator('[data-testid="mt-reset-main"]');
ok("⑤ 條件動過之後那一顆才出現", (await resetMain.count()) === 1);
await resetMain.click();
await page.waitForTimeout(1200);
ok(
  "⚠️ ⑤ 按下去之後每一格都回到預設（這裡驗日別與調查時段）",
  (await page.inputValue('[data-testid="mt-day"]')) === "平日" &&
    (await page.inputValue('[data-testid="mt-period"]')) === "all",
  `日別=${await page.inputValue('[data-testid="mt-day"]')}／調查時段=${await page.inputValue('[data-testid="mt-period"]')}`,
);
ok(
  "⚠️ ⑤ 而且**不可以**動到脫離中的區塊（那是「回歸全部」的事，兩顆不同事）",
  detachedBefore > 0 &&
    (await page.locator('[data-testid="chart-detach-note"]').count()) ===
      detachedBefore,
  `按之前 ${detachedBefore} 塊 → 按之後 ${await page.locator('[data-testid="chart-detach-note"]').count()} 塊`,
);
ok(
  "⑤ 回到預設之後那一顆又收起來",
  (await page.locator('[data-testid="mt-reset-main"]').count()) === 0,
);
await page.locator('[data-testid="mt-reset-all"]').click();
await page.waitForTimeout(1000);

/* ══ ⑦ 主工具列：固定在上方 ＋ 可收合（使用者 2026-09-15 指名） ══ */
{
  /*
   * 使用者的原話：「你當初是說會將主工具列固定在上方隨時可見，
   * 只是會做著展開的按鈕，避免版面佔用過大」。三件事都要驗：
   *   ① 固定在上方（position: sticky）
   *   ② 收得起來，而且**條件那一列真的不見了**
   *     ⚠️ 這一條最容易假通過：`display:flex` 的權重比瀏覽器內建的
   *       `[hidden]{display:none}` 高，所以只驗 hidden 屬性有沒有掛上的話，
   *       畫面明明還看得見也會全綠（2026-09-15 實測到的真實情況）。
   *       所以要量**實際高度**。
   *   ③ 收起來之後仍然看得到目前的條件（不然要確認「現在依什麼在算」就得先展開）
   */
  const sticky = await page.evaluate(() => {
    const node = document.querySelector('[data-testid="main-toolbar"]');
    return node ? getComputedStyle(node).position : "";
  });
  ok("⑦ 主工具列固定在上方（sticky）", sticky === "sticky", sticky);
  /*
   * ⚠️⚠️ 只驗 `position: sticky` 是**假綠**。
   *
   * 使用者 2026-09-15：「目前的檢查我大致確認完畢，因為主工具列
   *   **不能常駐在畫面上方**，要改變條件很不方便」——而這一支守門
   *   當時是綠的。CSS 寫了 sticky，不代表它真的黏得住：
   *   祖先只要有 overflow（hidden／auto／scroll）就會讓 sticky 失效，
   *   而且**沒有任何錯誤訊息**。
   *
   * 所以改成**真的捲下去再量**：捲到頁面很下面之後，
   * 主工具列必須仍然看得見，而且貼在視窗頂端附近。
   */
  /*
   * ⚠️ 要先確定**這一頁真的捲得動**，否則量到的「黏住」是假的
   *   （根本沒捲，當然還在原地）。內容不夠長時把視窗壓矮再量。
   */
  const viewportBefore = page.viewportSize();
  const canScroll = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  if (canScroll < 400)
    await page.setViewportSize({
      width: viewportBefore.width,
      height: 420,
    });
  await page.waitForTimeout(300);
  const stickTop = await page.evaluate(async () => {
    window.scrollTo(0, 2000);
    await new Promise((r) => setTimeout(r, 400));
    const node = document.querySelector('[data-testid="main-toolbar"]');
    if (!node) return { scrolled: window.scrollY, top: null };
    const rect = node.getBoundingClientRect();
    /* 被別的吸頂元素蓋住＝看不到，和沒有 sticky 一樣糟。 */
    const hit = document.elementFromPoint(
      Math.round(rect.left + rect.width / 2),
      Math.round(rect.top + 4),
    );
    return {
      scrolled: Math.round(window.scrollY),
      top: Math.round(rect.top),
      height: Math.round(rect.height),
      viewport: window.innerHeight,
      covered: !(hit && (node === hit || node.contains(hit))),
      coveredBy: hit ? hit.className || hit.tagName : "",
    };
  });
  ok(
    "⑦ 前置：頁面真的捲得動（捲不動的話下面那條恆真）",
    stickTop.scrolled > 300,
    `scrollY=${stickTop.scrolled}`,
  );
  ok(
    "⚠️ ⑦ 捲到下面之後，主工具列**仍然黏在視窗上緣**（只驗 CSS 是 sticky 會假綠）",
    stickTop.top !== null &&
      stickTop.top >= 0 &&
      stickTop.top <= 120 &&
      stickTop.top + stickTop.height <= stickTop.viewport,
    `捲到 ${stickTop.scrolled}px 時，工具列上緣在 ${stickTop.top}px（高 ${stickTop.height}px、視窗 ${stickTop.viewport}px）`,
  );
  ok(
    "⚠️ ⑦ 而且沒有被別的吸頂元素蓋住（蓋住等於看不到，和沒有 sticky 一樣）",
    stickTop.top !== null && !stickTop.covered,
    stickTop.covered ? `被「${stickTop.coveredBy}」蓋住` : "沒有被蓋住",
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize(viewportBefore);
  await page.waitForTimeout(300);

  const rowHeight = () =>
    page.evaluate(() => {
      const row = document.querySelector(".main-toolbar-row");
      return row ? Math.round(row.getBoundingClientRect().height) : -1;
    });
  const openHeight = await rowHeight();
  ok("⑦ 前置：展開時條件列有高度", openHeight > 20, `${openHeight}px`);

  await page.locator('[data-testid="mt-toggle"]').click();
  await page.waitForTimeout(500);
  const closedHeight = await rowHeight();
  ok(
    "⑦ 收起來之後條件列**實際上看不見了**（只驗 hidden 屬性會假通過）",
    closedHeight === 0,
    `${openHeight}px → ${closedHeight}px`,
  );
  const summary = await page
    .locator('[data-testid="mt-summary"]')
    .innerText()
    .catch(() => "");
  ok(
    "⑦ 收起來之後仍然看得到目前的條件",
    summary.trim().length > 0,
    summary.slice(0, 60),
  );
  await page.locator('[data-testid="mt-toggle"]').click();
  await page.waitForTimeout(500);
  ok(
    "⑦ 再按一次展開回來",
    (await rowHeight()) > 20,
    `${await rowHeight()}px`,
  );
}

/*
 * ── D-2：季度區間拉開時，前兩張 KPI 卡要**逐季分行** ───────────────
 *
 * 使用者 2026-09-15：「如果我區間選擇 114Q1~114Q4 區間，那全日實際交通量
 *   和調查時段 PCU 就不能分別顯示 114Q1 數值多少、114Q2 數值多少……
 *   為什麼只能一筆呢? 有什麼限制在嗎?」
 *   裁示：「我同意你這項作法」——前兩張逐季，尖峰卡維持單季並寫明原因。
 *
 * ⚠️ 要驗三件事：
 *   ① 拉開區間之後，前兩張卡的行數**變多**（而且每一行標出是哪一季）
 *   ② 尖峰卡**沒有**跟著變多（它刻意維持單季）
 *   ③ 尖峰卡上要**寫出為什麼**（口徑不同一定要講，否則同一排三張卡會互相打架）
 * ⚠️ 前置：真的有兩季以上可以拉開，否則下面全部恆真。
 */
{
  console.log("\n══ D-2 季度區間拉開時的 KPI 卡 ══");
  /* ⚠️ 三張卡在「資料檢視」那一區，先切過去——不切的話量到 0 行，全部恆真。 */
  await page.evaluate(() => {
    const button = [
      ...document.querySelectorAll(".side-nav-group > button[data-goto]"),
    ].find((node) => node.dataset.goto === "zone-kpi");
    if (button) button.click();
  });
  await page.waitForTimeout(900);
  const rowsOf = (id) =>
    page.evaluate(
      (blockId) =>
        [
          ...document.querySelectorAll(`#${blockId} .kpi-day-values strong`),
        ].map((el) => el.textContent.replace(/\s+/g, " ").trim()),
      id,
    );
  const quarterValues = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="mt-quarter-from"] option')].map(
      (o) => o.value,
    ),
  );
  ok(
    "D-2 前置：有兩季以上可以拉開區間（只有一季的話下面全部恆真）",
    quarterValues.length >= 2,
    quarterValues.join("／"),
  );
  if (quarterValues.length >= 2) {
    const beforeDaily = await rowsOf("card-kpi-daily");
    const beforePeak = await rowsOf("card-kpi-peak");
    await page
      .locator('[data-testid="mt-quarter-from"]')
      .selectOption(quarterValues[0]);
    await page.waitForTimeout(900);
    const afterDaily = await rowsOf("card-kpi-daily");
    const afterPcu = await rowsOf("card-kpi-pcu24");
    const afterPeak = await rowsOf("card-kpi-peak");
    ok(
      "⚠️ D-2 全日實際交通量**逐季分行**（行數變多，而且每一行標出季別）",
      afterDaily.length > beforeDaily.length &&
        afterDaily.some((text) => /Q\d/.test(text)),
      `拉開前 ${beforeDaily.length} 行 → 拉開後 ${afterDaily.length} 行：${afterDaily.join("／")}`,
    );
    ok(
      "⚠️ D-2 24 小時 PCU 也逐季分行",
      afterPcu.length === afterDaily.length && afterPcu.length > 1,
      `${afterPcu.length} 行：${afterPcu.join("／")}`,
    );
    ok(
      "⚠️ D-2 尖峰小時當量交通量**維持單季**（不跟著變多）",
      afterPeak.length === beforePeak.length,
      `拉開前 ${beforePeak.length} 行 → 拉開後 ${afterPeak.length} 行`,
    );
    const peakNote = await page.evaluate(
      () =>
        [...document.querySelectorAll("#card-kpi-peak .kpi-scope-note")]
          .map((el) => el.textContent)
          .join(" ")
          .replace(/\s+/g, " "),
    );
    ok(
      "⚠️ D-2 尖峰卡要**寫出為什麼只算一季**（三張卡口徑不同一定要講）",
      /只算結束季度/.test(peakNote) && /逐季分行/.test(peakNote),
      peakNote.slice(0, 90),
    );
    await page
      .locator('[data-testid="mt-quarter-from"]')
      .selectOption(quarterValues[quarterValues.length - 1]);
    await page.waitForTimeout(700);
    const restored = await rowsOf("card-kpi-daily");
    ok(
      "D-2 區間收回去之後回到原本的行數（升級當天一個數字都不會變）",
      restored.length === beforeDaily.length,
      `${restored.length} 行`,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 鏡子／脫離／回歸／全部回歸，四件事都對");
