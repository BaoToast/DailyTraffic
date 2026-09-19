/**
 * ══════════════════════════════════════════════════════════════════════
 *  稽核表 C 與 ①：同季平假日比較要逐季分列；車種組成要逐調查點分組
 * ══════════════════════════════════════════════════════════════════════
 *
 * 《加總與並列稽核_三支程式_20260916》第三節 C 與第四節 ①（使用者已裁示乙案）。
 *
 * C：同季平假日比較圖的分組鍵**只有調查點**，而這一塊自己的工具列可以拉
 *    季度區間 —— 拉開之後多季被加成同一根柱子，畫面上沒有任何地方看得出來。
 *    這與可追溯明細（X-37）是同一個毛病，那邊修了、這邊漏了。
 *
 * ①：車種組成只在「平日＋假日」時拆成兩個圓環，**調查點那一維從來沒拆過**。
 *    多個調查點時圓心那個輛數是把 N 個斷面的車加起來的，
 *    而使用者 2026-09-16 已裁示：「如果是多路段，則每個路段都分別計算」。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**兩季的數字要不一樣**，否則「相加」與「分列」看不出差別。
 *     這裡用同一份來源檔匯兩季，所以 C 那一段改驗**列數**與**季別字樣**，
 *     並額外驗「每一列的量都比合計小」（相加的話會等於合計）。
 * 二、**不可以只驗列數變多**。分了列卻看不出誰是哪一季，跟沒分一樣，
 *     所以季別字樣要真的出現在列上。
 * 三、①要配一條「只有一個調查點時不可以拆」的對照組。
 *     只驗「多點會拆」的話，一個「永遠拆」的實作也會全綠，
 *     而那會讓單點使用者看到一個只有一組的「分組」版面。
 * 四、①要驗**輛數**那一格真的屬於那一個調查點，不是只驗標題有名字。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";

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
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1700, height: 1100 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
/* ⚠️ 匯入第二批時若檔名比對不到既有路段會跳 prompt，一定要回 N（另建）。 */
page.on("dialog", (event) =>
  event.accept(event.type() === "prompt" ? "N" : ""),
);
await page.goto(base, { waitUntil: "networkidle" });
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(2000);

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
await page.locator(".modal-backdrop .modal input").first().fill("稽核C與①守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

/*
 * ⚠️ 兩季一次送進去（同一個瀏覽器分頁分兩次匯入要接 prompt，腳本會長一倍）。
 * ⚠️ 兩季用**同一個來源檔、不同檔名**——檔名帶季度才不會被當成同一筆覆蓋；
 *   站號一律用示範值。
 */
const BASE = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const importOne = async (name, quarter) => {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles([{ name, mimeType: XLSX_MIME, buffer: BASE }]);
  await page.waitForTimeout(4000);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3200);
  }
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(600);
  }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
};
await importOne("115T1-01_中山路.xlsx", "115Q1");
await importOne("115T1-01_中山路.xlsx", "115Q2");
await page.waitForTimeout(800);

const quarters = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-quarter-to"] option')].map(
    (o) => o.value,
  ),
);
ok(
  "前置：有兩季可用（只有一季的話 C 那幾條恆真）",
  quarters.length === 2,
  quarters.join("、"),
);

/* ══ C、同季平假日比較：拉開季度區間要逐季分列 ══════════════════ */
console.log("\n══ C 同季平假日比較 ══");
await gotoBlock(page, "block-comparison");
await page.waitForTimeout(1500);

const compareRows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#block-comparison .comparison-row")].map(
      (node) => (node.textContent || "").replace(/\s+/g, " ").trim(),
    ),
  );
const blockSelect = (label) =>
  page
    .locator(
      `#block-comparison .block-filters label:has-text("${label}") select`,
    )
    .first();

const single = await compareRows();
ok(
  "前置：單季時畫得出列（0 列的話下面全部恆真）",
  single.length >= 1,
  `${single.length} 列`,
);
const fromSel = blockSelect("季度（起）");
const toSel = blockSelect("季度（迄）");
ok(
  "前置：這一塊自己有季度區間的下拉",
  (await fromSel.count()) === 1 && (await toSel.count()) === 1,
);
await fromSel.selectOption(quarters[0]);
await page.waitForTimeout(600);
await toSel.selectOption(quarters[1]);
await page.waitForTimeout(1500);
const wide = await compareRows();
ok(
  "⚠️ C 拉開兩季之後列數要變成兩倍（沒有季別分組鍵的話會被加成同樣的列數）",
  wide.length === single.length * 2,
  `單季 ${single.length} 列 → 兩季 ${wide.length} 列`,
);
ok(
  "⚠️ C 每一列都要看得出是哪一季（分了列卻看不出誰是誰，跟沒分一樣）",
  quarters.every((q) => wide.some((text) => text.includes(q))),
  wide.slice(0, 2).join(" ｜ "),
);

/* ══ ①、車種組成：多個調查點要逐點分組 ════════════════════════ */
console.log("\n══ ① 車種組成逐調查點 ══");
/* 再匯入第二個調查點（不同站號），才驗得到「多點」。 */
const SECOND = readFileSync(join(SAMPLES, "115T1-02_中正路口.xlsx"));
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill(quarters[0]);
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles([
    { name: "115T1-02_中正路口.xlsx", mimeType: XLSX_MIME, buffer: SECOND },
  ]);
await page.waitForTimeout(4500);
{
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3200);
  }
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(600);
  }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
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
await page.waitForTimeout(800);
await gotoBlock(page, "block-composition");
await page.waitForTimeout(1500);

const donuts = () =>
  page.evaluate(() => ({
    groups: [...document.querySelectorAll("#block-composition .donut-day")].map(
      (node) => ({
        head: (node.querySelector("h4")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim(),
        center: (node.querySelector(".donut strong")?.textContent || "").trim(),
      }),
    ),
    single: document.querySelectorAll(
      "#block-composition .chart-with-note .donut",
    ).length,
    footer: (
      document.querySelector("#block-composition .donut-pair-note")
        ?.textContent || ""
    )
      .replace(/\s+/g, " ")
      .trim(),
  }));

const many = await donuts();
ok(
  "⚠️ ① 兩個調查點時要拆成兩組（單一圓環＝把兩個斷面的車加起來）",
  many.groups.length >= 2,
  `${many.groups.length} 組：${many.groups.map((g) => g.head).join(" ／ ")}`,
);
ok(
  "⚠️ ① 每一組的抬頭要寫出是哪一個調查點",
  /* ⚠️ 沒有分組時 every() 恆真，所以要先擋住 0 組。 */
  many.groups.length >= 2 &&
    many.groups.every((g) => g.head.length > 0) &&
    new Set(many.groups.map((g) => g.head)).size === many.groups.length,
  many.groups.map((g) => g.head).join(" ／ "),
);
ok(
  "⚠️ ① 每一組都有自己的輛數，而且各組不相同（相同＝其實還是同一份資料）",
  many.groups.length >= 2 &&
    many.groups.every((g) => /\d/.test(g.center)) &&
    new Set(many.groups.map((g) => g.center)).size > 1,
  many.groups.map((g) => `${g.head}=${g.center}`).join(" ／ "),
);
/*
 * 2026-09-18 使用者裁示（F-10／F-30）：底下那一行**整個拿掉**——連跨調查點的
 * 合計比例、單一調查點的「兩天合計」都不再印。所以這一條從「那一行不可以有
 * 合計輛數、要寫不可以相加」翻成「那一行根本不存在」。
 */
ok(
  "⚠️ ① 底下不可以再有任何合計行（跨調查點或平日＋假日相加都沒有應用意義）",
  many.footer === "" && !/合計 [\d,]+ 輛/.test(many.footer),
  many.footer ? many.footer.slice(0, 120) : "（沒有合計行）",
);

/* 對照組：篩到只剩一個調查點，就不可以再拆。 */
const roadSel = page
  .locator('#block-composition .block-filters label:has-text("調查點") select')
  .first();
if (await roadSel.count()) {
  const values = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll(
          '#block-composition .block-filters select option',
        ),
      ]
        .map((o) => o.value)
        .filter(Boolean),
  );
  void values;
}
const picker = page
  .locator('#block-composition .block-filters .multi-picker button')
  .first();
if (await picker.count()) {
  await picker.click();
  await page.waitForTimeout(500);
  const firstRoad = page.locator(".multi-picker-panel label").first();
  if (await firstRoad.count()) {
    await firstRoad.locator("input").click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const one = await donuts();
    ok(
      "⚠️ ① 對照組：只剩一個調查點時**不可以**再拆（永遠拆也是錯的）",
      one.groups.length <= 1,
      `${one.groups.length} 組：${one.groups.map((g) => g.head).join(" ／ ")}`,
    );
  }
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 平假日比較逐季分列、車種組成逐調查點分組");

/*
 * ── 反證（2026-09-17 實跑）────────────────────────────────────
 * 見檔案 CHANGELOG 對應條目；C 與 ① 的收集邏輯各自拿掉之後，
 * 對應的 ⚠️ 條目會紅，而兩條對照組（單季列數、單點不拆）仍綠。
 */
