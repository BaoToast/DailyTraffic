/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-34②：歷季趨勢「一張圖多條線」——多個調查點時不可以相加
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「我可以單選一個路段，就能看到一路段一張圖了，目前反而缺少一張圖多條線
 *     ……(這點三項程式都適用)」
 *
 * ⚠️ 這不只是「多一種看法」。X-28 已經裁示過同一件事：
 *   **不同調查點的全日交通量相加是錯的**。三張總結小卡與結論草稿都已經
 *   改成逐點分列，只有這張趨勢圖還在加——加完只剩一條線，完全看不出來。
 *
 * ── ⚠️ 刻意迴避的假通過 ──────────────────────────────────────────
 * 一、**測資一定要讓兩個調查點的值不一樣**。一樣大的話「分列」與「相加」
 *     都會過（相加＝2V、分列＝V／V）。所以先各自單選一次記下值，
 *     而且明確驗兩者不相等——不相等才有資格往下驗。
 * 二、**不可以只驗「有兩條線」**。要驗那兩條線的值**就是**單選時的那兩個值。
 *     把合計拆成兩半畫出來也會有兩條線。
 * 三、**要反面驗「合計那個數字整個不出現」**（畫面、講稿都不可以有）。
 *     只驗正面的話，「畫兩條線、再多畫一條合計」也會全綠。
 * 四、線要真的**畫在畫布上**，不是只有講稿講。畫布上讀不到文字，
 *     所以用 hover 出來的標籤（帶 data-series／data-value）去認。
 * 五、2026-09-19 使用者裁示：佔比類指標也要逐調查點各自計算。
 *     每一點都必須用自己的「分子總和÷分母總和」，不可以把各點百分比平均，
 *     也不可以先合併各點流量再算一個會被大流量調查點主導的比例。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, gotoBlock } from "./e2e-nav.mjs";

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
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
/* 分次匯入時會問「這個檔屬於哪一個既有路段」，一定要回 N（另建）。 */
page.on("dialog", (event) =>
  event.accept(event.type() === "prompt" ? "N" : ""),
);
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

/* ── 前置：建計畫 → 兩個調查點 × 兩個季度 ────────────────────── */
await page
  .getByRole("button", { name: "＋" })
  .first()
  .click()
  .catch(() => {});
if (
  !(await page
    .locator(".modal input")
    .first()
    .isVisible()
    .catch(() => false))
)
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("歷季多線守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

const BASE_A = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
const BASE_B = readFileSync(join(SAMPLES, "115T1-02_中正路口.xlsx"));
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/*
 * 第二季不可以換一份別的樣本（換內容＝換調查點，兩季就配不成對）。
 * 拿同一份檔案把每一格數值乘一個倍率，調查點不變、量變了。
 */
const scaled = (buffer, factor) => {
  const book = XLSX.read(buffer, { type: "buffer" });
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address];
      if (cell && cell.t === "n" && Number.isFinite(cell.v))
        cell.v = Math.round(cell.v * factor);
    }
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};
const importQuarter = async (quarterKey, files) => {
  await gotoTab(page, TABS.import);
  await page.waitForTimeout(600);
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(500);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarterKey);
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles(files);
  await page.waitForTimeout(4500);
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
    await page.waitForTimeout(600);
  }
  for (
    let i = 0;
    i < 5 && (await page.locator(".modal-backdrop").count());
    i += 1
  ) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
};
await importQuarter("115Q1", [
  { name: "115T1-01_中山路.xlsx", mimeType: XLSX_MIME, buffer: BASE_A },
  { name: "115T1-02_中正路口.xlsx", mimeType: XLSX_MIME, buffer: BASE_B },
]);
await importQuarter("115Q2", [
  {
    name: "115T1-01_中山路.xlsx",
    mimeType: XLSX_MIME,
    buffer: scaled(BASE_A, 1.6),
  },
  {
    name: "115T1-02_中正路口.xlsx",
    mimeType: XLSX_MIME,
    buffer: scaled(BASE_B, 1.3),
  },
]);

/* ⚠️ X-63：歷季分析現在自己一個大分頁。 */
await gotoBlock(page, "block-trend");
await page.waitForTimeout(1500);

/* ── 工具 ────────────────────────────────────────────────────── */
const ROAD_PICKER = ".trend-pinned .multi-picker-btn";
const pickRoads = async (names) => {
  const opener = page.locator(ROAD_PICKER).first();
  await opener.click();
  await page.waitForTimeout(500);
  await page
    .locator(
      '.multi-picker-panel .multi-picker-head button:has-text("全部路段")',
    )
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(600);
  for (const name of names) {
    if (!(await page.locator(".multi-picker-panel").count())) {
      await opener.click();
      await page.waitForTimeout(500);
    }
    await page
      .locator(
        `.multi-picker-panel .multi-picker-list label:has-text("${name}")`,
      )
      .first()
      .click();
    await page.waitForTimeout(600);
  }
  await page.mouse.click(4, 4);
  await page.waitForTimeout(1000);
};
/** 講稿整段的純文字（畫面上圖旁邊那一段，與 Excel／複製出去的是同一份）。 */
const scriptText = () =>
  page.evaluate(
    () => document.getElementById("trendScript")?.textContent?.trim() ?? "",
  );
/**
 * 把畫布掃過一遍，收集 hover 標籤上的 data-series／data-value。
 *
 * ⚠️ 一定要真的去 hover。講稿是 DOM、圖是畫布，只驗講稿的話
 *   「講稿逐點分列、圖還是那一條合計」也會全綠——而使用者看的是圖。
 */
const seriesOnChart = async () => {
  const box = await page.locator(".trend-canvas").first().boundingBox();
  if (!box) return [];
  const found = new Map();
  for (let ix = 0; ix <= 16; ix += 1)
    for (let iy = 0; iy <= 24; iy += 1) {
      await page.mouse.move(
        box.x + (box.width * ix) / 16,
        box.y + (box.height * iy) / 24,
      );
      const hit = await page.evaluate(() => {
        const node = document.querySelector(".chart-value-layer .point-value");
        return node
          ? {
              series: node.getAttribute("data-series") || "",
              value: Number(node.getAttribute("data-value")),
            }
          : null;
      });
      if (hit && hit.series) {
        const list = found.get(hit.series) ?? new Set();
        list.add(hit.value);
        found.set(hit.series, list);
      }
    }
  return [...found.entries()].map(([series, values]) => ({
    series,
    values: [...values].sort((a, b) => a - b),
  }));
};
const numbersIn = (text) =>
  new Set(
    (text.match(/[\d,]+(?:\.\d+)?/g) || []).map((raw) =>
      Number(raw.replace(/,/g, "")),
    ),
  );

/* ══ 一、單選時各自的值（要不一樣，否則後面全部恆真）══════════ */
console.log("\n══ 一、兩個調查點單獨看時的值 ══");
await pickRoads(["中山路"]);
const soloA = await scriptText();
const valuesA = numbersIn(soloA);
await pickRoads(["中正路口"]);
const soloB = await scriptText();
const valuesB = numbersIn(soloB);
ok("① 單選中山路時講稿有數字", valuesA.size > 0, `${valuesA.size} 個`);
ok("① 單選中正路口時講稿有數字", valuesB.size > 0, `${valuesB.size} 個`);
const onlyA = [...valuesA].filter((v) => v > 1000 && !valuesB.has(v));
const onlyB = [...valuesB].filter((v) => v > 1000 && !valuesA.has(v));
if (!onlyA.length || !onlyB.length)
  stop(
    "兩個調查點的數字完全一樣，分列與相加分不出來（測資本身不會觸發問題）",
  );
ok(
  "⚠️ ① 兩個調查點的值不一樣（分列與相加才分得出來）",
  onlyA.length > 0 && onlyB.length > 0,
  `中山路獨有 ${onlyA.length} 個、中正路口獨有 ${onlyB.length} 個`,
);

/* ══ 二、兩個都選：畫布上要有兩條線，而且值就是單選時那兩個 ══ */
console.log("\n══ 二、兩個都選時，圖上是一個調查點一條線 ══");
await pickRoads([]);
await page.waitForTimeout(800);
/*
 * ⚠️ 不可以直接 .textContent()：沒有這一句時 Playwright 會等 30 秒才逾時，
 *   腳本整支爆掉，看起來像「測試壞了」而不是「功能沒做」。
 *   先數再讀，缺的時候給一句話講清楚。
 */
const note = page.locator('[data-testid="trend-per-road-note"]');
const noteText = (await note.count())
  ? (await note.first().textContent()) || ""
  : "";
ok(
  "② 畫面上有一句話說明「改成一個調查點一條線、不畫合計」",
  (await note.count()) === 1 &&
    /一條線/.test(noteText) &&
    /不畫合計|不合計/.test(noteText),
  noteText ? noteText.slice(0, 60) : "畫面上完全沒有這一句",
);
const drawn = await seriesOnChart();
const names = drawn.map((item) => item.series);
ok(
  "⚠️ ② 畫布上真的畫出兩個調查點各自的線（hover 標籤認得出來）",
  names.some((n) => n.includes("中山路")) &&
    names.some((n) => n.includes("中正路口")),
  `圖上的線：${names.join("、") || "（一條都認不出來）"}`,
);
const drawnValues = new Set(drawn.flatMap((item) => item.values));
ok(
  "⚠️ ② 畫出來的值就是單選時的那幾個（不是把合計拆成兩半）",
  onlyA.some((v) => drawnValues.has(v)) && onlyB.some((v) => drawnValues.has(v)),
  `圖上讀到 ${[...drawnValues].length} 個值`,
);

/* ══ 三、反面：合計那個數字一個字都不可以出現 ════════════════ */
console.log("\n══ 三、合計那個數字整個不可以出現 ══");
const bothText = await scriptText();
const bothNumbers = numbersIn(bothText);
const sums = [];
for (const a of onlyA)
  for (const b of onlyB) if (bothNumbers.has(a + b)) sums.push(`${a}＋${b}`);
ok(
  "⚠️ ③ 講稿裡找不到任何「A＋B」的合計數字",
  sums.length === 0,
  sums.length ? `出現了 ${sums.join("、")}` : "",
);
const drawnSums = [];
for (const a of onlyA)
  for (const b of onlyB) if (drawnValues.has(a + b)) drawnSums.push(`${a}＋${b}`);
ok(
  "⚠️ ③ 圖上也找不到任何「A＋B」的合計線",
  drawnSums.length === 0,
  drawnSums.length ? `出現了 ${drawnSums.join("、")}` : "",
);
ok(
  "③ 標題那一行不可以再寫「合計」",
  !/個調查點合計/.test(
    (await page
      .locator("#trendScript")
      .first()
      .textContent()
      .catch(() => "")) || "",
  ),
);

/* ══ 四、講稿講的是圖上那幾條線，不是平日／假日兩條 ══════════ */
console.log("\n══ 四、講稿與圖同一份 ══");
ok(
  "④ 講稿逐條線各講一次，而且線名就是調查點名稱",
  /中山路/.test(bothText) && /中正路口/.test(bothText),
);
ok(
  "⚠️ ④ 講稿明說「不可以相加、所以不畫合計」",
  /不可以相加/.test(bothText) && /不畫合計/.test(bothText),
);

/* ══ 五、佔比類指標也要逐調查點各自計算 ═════════════════════ */
console.log("\n══ 五、佔比逐調查點各自計算，不做跨點合併 ══");
await page
  .locator("#trendMetric")
  .selectOption("heavyShare")
  .catch(async () => {
    await page.evaluate(() => {
      const select = document.getElementById("trendMetric");
      if (!select) return;
      select.value = "heavyShare";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
await page.waitForTimeout(1200);
ok(
  "⚠️ ⑤ 切到「大車比例」時仍要顯示逐點分列、不合計",
  (await page.locator('[data-testid="trend-per-road-note"]').count()) === 1,
);
const shareSeries = await seriesOnChart();
ok(
  "⚠️ ⑤ 大車比例是一個調查點一條線，不是跨點合併的平日／假日線",
  shareSeries.some((item) => item.series.includes("中山路")) &&
    shareSeries.some((item) => item.series.includes("中正路口")) &&
    shareSeries.every((item) => !/^(平日|假日)$/.test(item.series)),
  shareSeries.map((item) => item.series).join("、"),
);
ok(
  "⑤ 大車比例每條線都有自己的有限百分比資料點",
  shareSeries.length >= 2 &&
    shareSeries.every(
      (item) =>
        item.values.length > 0 &&
        item.values.every((value) => Number.isFinite(value) && value >= 0 && value <= 100),
    ),
  shareSeries
    .map((item) => `${item.series}=${item.values.join("/")}`)
    .join("；"),
);

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過：`);
  problems.forEach((line) => console.error(`   ・${line}`));
  process.exit(1);
}
console.log("\n✅ 歷季趨勢「一個調查點一條線」全部通過");
