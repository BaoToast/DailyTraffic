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
 *  主工具列每一個條件 × 每一個分區：**要嘛真的算，要嘛寫明不適用**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14：
 *   「確保圖表在主工具列每種篩選條件下，能計算或繪製的話，
 *     都要確實去計算或繪製圖形，不要有遺漏。
 *     這方面我無法做檢查，只能靠你謹慎對待。」
 *   「當主工具列某個篩選條件不適用該圖表時，記得顯示提醒文字。」
 *
 * 對每一個條件、每一個**有資料的分區**，切下去之後只有兩種結果算合格：
 *   ① 那一區的數字真的變了（＝有算）
 *   ② 那一區掛出「不適用」的說明（＝有講）
 * 兩者都沒有就是「有遺漏」——使用者按了一個看起來有用的下拉，
 * 畫面一動也不動，而且沒有任何一個字告訴他為什麼。
 *
 * ⚠️ 指紋要**排除主工具列、各區塊工具列、脫離提示與不適用說明**。
 *   它們每一頁都在，改條件當然會變；算進去的話「數字變了」會假通過。
 *
 * ⚠️ 名單裡不放「一建立與匯入」「二參數設定」：那兩區是設定頁，
 *   本來就沒有分析數字可以篩，掛一句「不適用」反而是噪音。
 */
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * ⚠️ X-63（2026-09-17）：分區底下多了一層大分頁，而**一次只渲染一個大分頁**。
 *   原本這一份是「逐分區」量的，拆頁之後一個分區只量得到它的第一頁——
 *   同一區其他頁的圖從此沒有人守，而測試照樣全綠（那正是這一支
 *   自己的註解在警告的事）。所以名單改成**逐大分頁**。
 *
 * ⚠️ 只列「畫得出分析數字」的那幾頁。
 *   ・一（建立與匯入）與二（參數設定）是設定頁，本來就沒有數字可以篩。
 *   ・五底下的成果交付／批次輸出／資料異常檢查／還原與備份是**產出型**，
 *     它們掛的是常駐的「不受主工具列影響」說明（見下面 OUTPUT_BLOCKS），
 *     不逐條件講。
 */
const DATA_PAGES = [
  ["page-kpi", "資料檢視"],
  ["page-composition", "車種組成"],
  ["page-hourly", "24小時型態"],
  ["page-trend", "歷季分析"],
  ["page-comparison", "同季平假日"],
  ["page-detail", "可追溯明細"],
  ["page-period", "時段車種分析"],
];
const shown = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav button[data-goto-page]")].map(
    (button) => button.dataset.gotoPage,
  ),
);
const targets = DATA_PAGES.filter(([id]) => shown.includes(id)).map(
  ([id, label]) => ({ id, label }),
);
ok(
  "前置：名單上的大分頁都找得到",
  targets.length === DATA_PAGES.length,
  DATA_PAGES.filter(([id]) => !shown.includes(id))
    .map(([, label]) => label)
    .join("、"),
);

const goZone = async (id) => {
  await page.evaluate((pageId) => {
    document.querySelector(`.side-nav button[data-goto-page="${pageId}"]`)?.click();
  }, id);
  await page.waitForTimeout(900);
};
const snap = () =>
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
    return {
      numbers: (text.match(/-?\d[\d,]*\.?\d*/g) || [])
        .map((v) => v.replace(/,/g, ""))
        .join("|"),
      /*
       * ⚠️ 常駐的那幾句（data-inapplicable-always）不算——它們本來就一直在。
       *   反面守門要驗的是「沒篩卻跳出條件式的說明」。
       */
      notes: host.querySelectorAll(
        ".chart-inapplicable:not([data-inapplicable-always])",
      ).length,
    };
  });
/*
 * ══════════════════════════════════════════════════════════════════════
 *  逐「塊」量，不是逐「區」量
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選條件卻沒出現不受影響的
 *     提醒文字，因為我不能確實找出這類問題出來，所以請你針對三份程式逐一確認」
 *
 * ⚠️ 上面那一支 snap() 是**整個分區**一起量的，而一個分區裡有好幾塊。
 *   只要其中一塊的數字變了，整區就算「有算」——**另一塊既沒變也沒說**
 *   會被整個蓋過去。使用者看到的正是這個：同一頁上這張圖有提醒、那張沒有。
 *
 * 所以這一支改成**逐塊**量：塊的 id 與側欄小分頁的 anchor 是同一組
 *  （見 e2e-nav-coverage.mjs 的說明），最內層的那一個才算一塊。
 *
 * ⚠️ 判定「這一塊有交代」的條件有三種，缺一不可：
 *   ① 這一塊自己的數字變了（真的算了）
 *   ② 這一塊裡掛了 .chart-inapplicable（寫明不適用）
 *   ③ 這一塊裡掛了 .chart-detach-note（它正在用自己的條件，本來就不該跟著變）
 * ⚠️ 沒有任何數字的塊（純說明、純按鈕）要排除，否則它永遠「沒變也沒說」，
 *   會逼人去掛一句沒有人問的話。
 */
const blockSnap = () =>
  page.evaluate(() => {
    const host = document.querySelector(".content") || document.body;
    const candidates = [
      ...host.querySelectorAll(
        '[id^="block-"], [id^="card-"], [id="periodAnalysis"], [id="conclusionStudio"], [id^="backup-"]',
      ),
    ].filter((el) => el.getBoundingClientRect().height >= 20);
    const out = {};
    for (const el of candidates) {
      /* 只算最內層那一塊（容器不算），與 e2e-nav-coverage 同一條規則。 */
      if (candidates.some((other) => other !== el && el.contains(other)))
        continue;
      const skip = [
        ...el.querySelectorAll(
          ".toolbar, .filters, .main-toolbar, .block-filters, .period-scope-filters, .chart-detach-note, .chart-inapplicable",
        ),
      ];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let text = "";
      let node;
      while ((node = walker.nextNode()))
        if (!skip.some((element) => element.contains(node.parentElement)))
          text += " " + node.nodeValue;
      out[el.id] = {
        numbers: (text.match(/-?\d[\d,]*\.?\d*/g) || [])
          .map((v) => v.replace(/,/g, ""))
          .join("|"),
        /*
         * 這一塊交代過哪幾個條件。每一句不適用說明都會把它負責的條件名
         * 寫在 data-inapplicable 上（見 DashboardClient 的 renderInapplicable）。
         * 只數「有幾句說明」會假綠：對季度講了一句、對顯示數值一個字都沒有，
         * 照樣算「有說明」。
         */
        covered: [
          ...new Set(
            [...el.querySelectorAll("[data-inapplicable]")].flatMap((node) =>
              (node.getAttribute("data-inapplicable") || "").split(/\s+/),
            ),
          ),
        ].filter(Boolean),
        /*
         * ⚠️ 2026-09-18 大檢查：反向那一半要用的清單——只算**此刻真的顯示著**、
         *   而且不是常駐資訊句（data-inapplicable-always）的「不適用」宣告。
         */
        declared: [
          ...new Set(
            [
              ...el.querySelectorAll(
                "[data-inapplicable]:not([data-inapplicable-always])",
              ),
            ]
              .filter(
                (node) =>
                  node.offsetParent !== null || node.getClientRects().length > 0,
              )
              .flatMap((node) =>
                (node.getAttribute("data-inapplicable") || "").split(/\s+/),
              ),
          ),
        ].filter(Boolean),
        /* 正在用自己的條件（脫離）＝本來就不該跟著主工具列變。 */
        detached: el.querySelectorAll(".chart-detach-note").length > 0,
        /* 這一塊宣告自己真的吃哪幾個條件（見 DashboardClient 的 BLOCK_CONSUMES）。 */
        consumes: (el.getAttribute("data-consumes") || "")
          .split(/\s+/)
          .filter(Boolean),
        title: (el.querySelector("h2, h3")?.textContent || el.id)
          .replace(/\s+/g, "")
          .slice(0, 24),
      };
    }
    return out;
  });

const CASES = [
  ["B 日別", "mt-day", "假日", "平日", "day"],
  ["B2 平日＋假日", "mt-day", "平日＋假日", "平日", "day"],
  ["E 調查時段", "mt-period", "am", "all", "period"],
  ["E2 上午＋下午並列", "mt-period", "AMPM", "all", "period"],
  ["F 路口流量視角", "mt-flow-view", "destination", "origin", "flowView"],
  ["F2 駛出＋駛入並列", "mt-flow-view", "both", "origin", "flowView"],
  ["G 尖峰時段認定", "mt-peak-scope", "direction", "point", "peakScope"],
  ["H 顯示數值", "mt-metric", "share", "count", "metric"],
];
/*
 * ── 產出型的塊：不逐條件講，改成一句常駐說明 ──────────────────
 *
 * 備份、還原、一鍵下載圖檔、結論草稿產生器這幾塊**不吃任何**主工具列條件
 *（它們產出的是整包資料或整份文件）。每換一個條件就跳一句「不適用」
 * 會變成七、八句噪音——那是我們自己訂下的另一種錯。
 *
 * ⚠️ 但**不可以什麼都不說**：這幾塊各自掛一句常駐說明，
 *   由下面 OUTPUT_BLOCKS 那一段單獨驗（不是放過它們）。
 */
/** 主工具列的八個條件（與 DashboardClient 的 MAIN_CONDITIONS 同一組）。 */
const CONDITION_NAMES = [
  "quarterFrom",
  "day",
  "roads",
  "directions",
  "period",
  "flowView",
  "peakScope",
  "metric",
];
const OUTPUT_BLOCKS = [
  "block-chart-png",
  "conclusionStudio",
  "backup-one",
  "backup-all",
  "backup-restore",
];
for (const [label, testid, value, back, field] of CASES) {
  const before = {};
  const beforeBlocks = {};
  for (const zone of targets) {
    await goZone(zone.id);
    before[zone.id] = (await snap()).numbers;
    beforeBlocks[zone.id] = await blockSnap();
  }
  const control = page.locator(`[data-testid="${testid}"]`).first();
  if (!(await control.count())) {
    ok(`${label}：主工具列上找得到這個條件`, false, "找不到控制項");
    continue;
  }
  await control.selectOption(value);
  await page.waitForTimeout(900);
  const silent = [];
  const silentBlocks = [];
  const sameButDeclared = [];
  const lyingBlocks = [];
  for (const zone of targets) {
    await goZone(zone.id);
    const after = await snap();
    const afterBlocks = await blockSnap();
    /*
     * ⚠️ X-63：一頁常常只有一塊，所以「整頁沒變也沒說」與下面逐塊那一段
     *   要用**同一套規則**，否則兩條會對同一件事給出相反的結論。
     *   一塊只要 data-consumes 宣告了這個條件，就算「有說」——
     *   它真的吃了，只是這批資料算出來剛好相同。
     */
    const declaredOnPage = Object.values(afterBlocks).some(
      (block) => block.consumes && block.consumes.includes(field),
    );
    if (
      after.numbers === before[zone.id] &&
      after.notes === 0 &&
      !declaredOnPage
    )
      silent.push(zone.label);
    for (const [id, now] of Object.entries(afterBlocks)) {
      const was = beforeBlocks[zone.id][id];
      /* 這一塊在切換前後都要存在，而且**本來就要有數字**才算得上「沒變」。 */
      if (!was || !was.numbers) continue;
      if (OUTPUT_BLOCKS.includes(id)) continue;
      /*
       * ⚠️ 2026-09-18 大檢查（F-13／F-14／F-15 的教訓）：反向那一半。
       *   一塊**寫著**「不適用 X」、數字卻因為 X 變了——那句說明在說謊，
       *   比沒說更糟。同時宣告 consumes 與不適用也是自相矛盾。
       *   脫離中的塊不算（它的數字本來就不跟主工具列走）。
       */
      if (
        !now.detached &&
        now.declared.includes(field) &&
        (now.numbers !== was.numbers || now.consumes.includes(field))
      )
        lyingBlocks.push(
          `${now.title}（${id}${now.consumes.includes(field) ? "：同時宣告 consumes 與不適用" : ""}）`,
        );
      if (now.numbers !== was.numbers) continue;
      if (now.detached) continue;
      /*
       * ⚠️ 要驗的是「**這一個條件**有被交代」，不是「有沒有說明」。
       *   只數說明句數的話，一塊對季度講了一句、對顯示數值一個字都沒有，
       *   照樣全綠——那正是使用者 2026-09-15 回報的那種漏。
       */
      if (now.covered.includes(field)) continue;
      /*
       * 這一塊**宣告**自己吃這個條件，但這一批資料算出來剛好一樣
       *（例如駛出與駛入的總計本來就相同）。那不是漏——只印出來，不判紅。
       * ⚠️ 宣告的正確性由下面那一段「八個條件都要表態」與人工核對把關，
       *   不是靠這一行。
       */
      if (now.consumes.includes(field)) {
        sameButDeclared.push(`${now.title}（${field}）`);
        continue;
      }
      silentBlocks.push(`${now.title}（${id}）`);
    }
  }
  ok(
    `⚠️ ${label} → ${value}：寫著「不適用」的塊，數字不可以跟著變（說明不可以說謊）`,
    lyingBlocks.length === 0,
    lyingBlocks.length
      ? `這幾塊**寫不適用卻變了**：${[...new Set(lyingBlocks)].join("、")}`
      : "沒有說謊的說明",
  );
  ok(
    `${label} → ${value}：每一區不是真的算了，就是寫明不適用`,
    silent.length === 0,
    silent.length
      ? `這幾區**既沒變也沒說**：${silent.join("、")}`
      : "全部有交代",
  );
  ok(
    `⚠️ ${label} → ${value}：逐**塊**看，每一塊不是真的算了，就是寫明不適用`,
    silentBlocks.length === 0,
    silentBlocks.length
      ? `這幾塊**既沒變也沒說**：${[...new Set(silentBlocks)].join("、")}`
      : `全部有交代${
          sameButDeclared.length
            ? `（另有宣告吃這個條件但數字剛好相同：${[
                ...new Set(sameButDeclared),
              ].join("、")}）`
            : ""
        }`,
  );
  await control.selectOption(back);
  await page.waitForTimeout(900);
}

/* 季度區間另外量：把「起」拉到前一季（起＝迄是預設狀態，不算篩） */
{
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="mt-quarter-from"] option')].map(
      (o) => o.value,
    ),
  );
  ok("前置：季度有兩季以上可以拉開區間", options.length >= 2, String(options.length));
  const before = {};
  for (const zone of targets) {
    await goZone(zone.id);
    before[zone.id] = (await snap()).numbers;
  }
  await page
    .locator('[data-testid="mt-quarter-from"]')
    .selectOption(options[0]);
  await page.waitForTimeout(900);
  const silent = [];
  for (const zone of targets) {
    await goZone(zone.id);
    const after = await snap();
    /* ⚠️ X-63：與其他條件同一套規則——宣告吃這個條件的也算「有說」。 */
    const blocks = await blockSnap();
    const declaredOnPage = Object.values(blocks).some(
      (block) => block.consumes && block.consumes.includes("quarterFrom"),
    );
    if (
      after.numbers === before[zone.id] &&
      after.notes === 0 &&
      !declaredOnPage
    )
      silent.push(zone.label);
  }
  ok(
    `A 季度區間 → ${options[0]}：每一區不是真的算了，就是寫明不適用`,
    silent.length === 0,
    silent.length ? `這幾區**既沒變也沒說**：${silent.join("、")}` : "全部有交代",
  );
  await page
    .locator('[data-testid="mt-quarter-from"]')
    .selectOption(options[options.length - 1]);
  await page.waitForTimeout(900);
}

/*
 * ⚠️ 反面守門：全部回到預設之後，**不可以**還留著任何一句「不適用」。
 *   沒篩卻講一句沒有人問的話，是我們自己訂下的另一種錯。
 */
const leftovers = [];
for (const zone of targets) {
  await goZone(zone.id);
  if ((await snap()).notes > 0) leftovers.push(zone.label);
}
ok(
  "回到預設之後，不適用說明要全部收掉（沒篩卻講話是噪音）",
  leftovers.length === 0,
  leftovers.join("、"),
);

/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一塊都要對**八個條件逐一表態**（這一段是 E-0 的核心）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選條件
 *   卻沒出現不受影響的提醒文字，因為我不能確實找出這類問題出來」。
 *
 * 逐條件切下去只驗得到「當下這一批資料會不會變」；表態表驗的是**完整性**：
 * 每一塊的「宣告吃的條件」∪「畫面上講過不適用的條件」必須涵蓋八個，
 * 一個都不能少。少的那一個就是使用者遲早會踩到、而且看不出來的那一個。
 *
 * ⚠️ 要把八個條件**各自都篩一次**再量，不是只在預設狀態量：
 *   不適用說明的規則是「沒篩不講話」，預設狀態下一句都不會出現。
 */
{
  const ALL = [
    ["quarterFrom", "mt-quarter-from", null],
    ["day", "mt-day", "假日"],
    ["period", "mt-period", "am"],
    ["flowView", "mt-flow-view", "destination"],
    ["peakScope", "mt-peak-scope", "direction"],
    ["metric", "mt-metric", "share"],
  ];
  /* 先把每一個條件都篩起來，讓所有該出現的說明同時在場。 */
  const quarters = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="mt-quarter-from"] option')].map(
      (o) => o.value,
    ),
  );
  await page
    .locator('[data-testid="mt-quarter-from"]')
    .selectOption(quarters[0]);
  for (const [, testid, value] of ALL) {
    if (!value) continue;
    const control = page.locator(`[data-testid="${testid}"]`).first();
    if (await control.count()) await control.selectOption(value);
  }
  /* 路段與方向用點選面板，這裡改用程式化的方式跳過——它們兩個每一塊都吃。 */
  await page.waitForTimeout(1200);
  const gaps = [];
  for (const zone of targets) {
    await goZone(zone.id);
    const blocks = await blockSnap();
    for (const [id, info] of Object.entries(blocks)) {
      if (OUTPUT_BLOCKS.includes(id)) continue;
      if (info.covered.includes("all")) continue;
      /* 沒有宣告表的塊（純說明、純按鈕）不在這一段的範圍內。 */
      if (!info.consumes.length && !info.covered.length) continue;
      const said = new Set([...info.consumes, ...info.covered]);
      const missing = CONDITION_NAMES.filter((name) => !said.has(name));
      if (missing.length)
        gaps.push(`${info.title}（${id}）少：${missing.join("、")}`);
    }
  }
  ok(
    "⚠️ 每一塊都對八個條件表態（宣告吃 ∪ 講明不適用 ＝ 八個，一個都不能少）",
    gaps.length === 0,
    gaps.length ? gaps.join(" ｜ ") : "全部塊都表態完整",
  );
  /* 量完把條件放回預設，不影響後面的反面守門。 */
  await page
    .locator('[data-testid="mt-quarter-from"]')
    .selectOption(quarters[quarters.length - 1]);
  for (const [, testid, value] of ALL) {
    if (!value) continue;
    const back = { "mt-day": "平日", "mt-period": "all", "mt-flow-view": "origin", "mt-peak-scope": "point", "mt-metric": "count" }[testid];
    const control = page.locator(`[data-testid="${testid}"]`).first();
    if (back && (await control.count())) await control.selectOption(back);
  }
  await page.waitForTimeout(900);
}

/*
 * ── 產出型的塊：要有一句常駐說明 ─────────────────────────────
 *
 * 它們不逐條件講（見 OUTPUT_BLOCKS 上面的說明），但**不可以什麼都不說**：
 * 使用者在主工具列篩了一輪、捲到這裡，看到的數字一動也不動，
 * 而畫面上沒有任何一個字告訴他這一塊本來就不吃那些條件。
 */
{
  const missing = [];
  for (const zone of targets) {
    await goZone(zone.id);
    const blocks = await blockSnap();
    for (const id of OUTPUT_BLOCKS)
      if (blocks[id] && !blocks[id].covered.includes("all"))
        missing.push(`${blocks[id].title}（${id}）`);
  }
  ok(
    "⚠️ 產出型的塊各自掛著一句常駐說明（不吃主工具列條件）",
    missing.length === 0,
    missing.length ? `這幾塊沒有：${[...new Set(missing)].join("、")}` : "全部有",
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一個條件在每一區上，不是真的算了就是寫明不適用");
