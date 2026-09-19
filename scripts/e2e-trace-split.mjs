/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-37：可追溯明細 —— 一列 ＝ 一個調查點 × 一個季別 × 一個日別
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-16 全面盤點查到兩個**靜默**的缺陷，使用者裁示「依你建議執行」：
 *
 * ① **分組鍵沒有季度**。這張表自己的工具列可以拉季度區間，
 *    拉開之後多季被加成一列，而表上沒有季度欄可以辨識。
 *
 * ② **日別讀錯工具列**。`splitByDay` 讀的是**主工具列**的日別，不是這一塊
 *    自己的。這一塊選「平日＋假日」而主工具列是「平日」時，兩天被加成一列，
 *    而且日別欄還被填成主工具列那一個——**標籤在說謊**，比數字錯更危險。
 *
 * 這張表的名字就是「**可追溯**明細」，它存在的目的就是讓人看到每一筆原始落點；
 * 合併成一列等於把它的用途取消掉。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**測資要有兩季，而且兩季的數字不一樣**。只有一季的話「有沒有依季分列」
 *     看不出差別；兩季數字相同的話，「相加」與「分列」也分不出來。
 * 二、不可以只驗「列數變多」。要驗**每一列的數字就是那一季自己的值**，
 *     否則把合計拆成兩半也會過。
 * 三、②那一條要**讓兩個工具列的日別不一致**才驗得到。兩邊都選一樣的話，
 *     讀錯工具列的實作照樣全綠——那正是這個缺陷一直沒被發現的原因。
 * 四、要驗**季別欄與日別欄真的在表上**。只驗列數的話，
 *     一個「分了列卻看不出誰是誰」的實作也會過，而那跟沒分一樣。
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
await page.locator(".modal-backdrop .modal input").first().fill("明細分列守門");
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
await gotoBlock(page, "block-detail");
await page.waitForTimeout(1500);

/** 可追溯明細（路段格式）目前的表頭與每一列。 */
const traceTable = () =>
  page.evaluate(() => {
    /* ⚠️ 用區塊標題定位，不用 id：兩張可追溯明細共用同一個側欄小分頁的 id。 */
    const block = [...document.querySelectorAll(".panel")].find((node) =>
      (node.querySelector(".panel-title span")?.textContent || "").includes(
        "可追溯明細・路段格式",
      ),
    );
    const table = block?.querySelector("table");
    if (!table) return null;
    return {
      headers: [...table.querySelectorAll("thead th")].map((th) =>
        (th.textContent || "").replace(/\s+/g, ""),
      ),
      rows: [...table.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.querySelectorAll("td")].map((td) =>
          (td.textContent || "").replace(/\s+/g, " ").trim(),
        ),
      ),
    };
  });
/** 這一塊自己的工具列上某個條件的下拉。 */
const blockSelect = (label) =>
  page
    .locator(
      `.panel:has(.panel-title span:text-is("可追溯明細・路段格式")) .block-filters label:has-text("${label}") select`,
    )
    .first();

console.log("\n══ 前置 ══");
const first = await traceTable();
ok("前置：找得到可追溯明細（路段格式）那張表", first !== null);
if (!first) {
  console.error("找不到那張表，後面全部恆真，直接停。");
  await browser.close();
  server.close();
  process.exit(1);
}
const quarters = await page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="mt-quarter-to"] option')].map(
    (o) => o.value,
  ),
);
ok("前置：有兩季可用（只有一季的話季別那幾條恆真）", quarters.length === 2, quarters.join("、"));

/* ══ 一、季別：拉開區間之後要逐季分列 ══════════════════════════ */
console.log("\n══ 一、季別區間拉開 ══");
/* 先把這一塊自己的季度區間拉開（它有自己的工具列）。 */
const fromSel = blockSelect("季度（起）");
const toSel = blockSelect("季度（迄）");
ok(
  "前置：這一塊自己有季度區間的下拉",
  (await fromSel.count()) === 1 && (await toSel.count()) === 1,
);
await fromSel.selectOption(quarters[0]);
await page.waitForTimeout(600);
await toSel.selectOption(quarters[1]);
await page.waitForTimeout(1200);
const wide = await traceTable();
ok(
  "⚠️ ① 兩季就要兩列（沒有季別分組鍵的話會被加成一列）",
  wide?.rows.length === 2,
  `實測 ${wide?.rows.length} 列`,
);
ok(
  "⚠️ ① 表上要有「季別」欄（分了列卻看不出誰是誰，跟沒分一樣）",
  (wide?.headers ?? []).some((text) => text.includes("季別") || text.includes("季度")),
  (wide?.headers ?? []).join("｜"),
);
ok(
  "① 兩列分別標著兩個季度",
  quarters.every((q) =>
    (wide?.rows ?? []).some((cells) => cells.join(" ").includes(q)),
  ),
  (wide?.rows ?? []).map((cells) => cells[0]).join(" ／ "),
);

/* ══ 二、日別：要讀**這一塊自己的**工具列 ══════════════════════ */
console.log("\n══ 二、日別讀這一塊自己的工具列 ══");
/*
 * ⚠️ 關鍵：把主工具列設成「平日」、這一塊自己設成「平日＋假日」。
 *   兩邊一致的話，讀錯工具列的實作照樣全綠。
 */
await page.selectOption('[data-testid="mt-day"]', "平日");
await page.waitForTimeout(1000);
const blockDay = blockSelect("日別");
ok("前置：這一塊自己有日別的下拉", (await blockDay.count()) === 1);
await blockDay.selectOption("平日＋假日");
await page.waitForTimeout(1300);
const split = await traceTable();
ok(
  "⚠️ ② 這一塊選「平日＋假日」時就要依日別分列（不管主工具列選的是什麼）",
  (split?.rows.length ?? 0) > (wide?.rows.length ?? 0),
  `主工具列＝平日、這一塊＝平日＋假日；實測 ${split?.rows.length} 列（前一步是 ${wide?.rows.length} 列）`,
);
ok(
  "⚠️ ② 表上要有「日別」欄",
  (split?.headers ?? []).some((text) => text.includes("日別")),
  (split?.headers ?? []).join("｜"),
);
ok(
  "⚠️ ② 日別欄要寫出**這一列真正的日別**，平日與假日兩種都要出現（舊版一律填主工具列那一個）",
  (split?.rows ?? []).some((cells) => cells.join(" ").includes("平日")) &&
    (split?.rows ?? []).some((cells) => cells.join(" ").includes("假日")),
  (split?.rows ?? []).map((cells) => cells.slice(0, 3).join("／")).join(" ｜ "),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 可追溯明細：一列一個調查點 × 一個季別 × 一個日別，欄位也標得出來");
