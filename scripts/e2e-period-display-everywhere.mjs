/*
 * ══════════════════════════════════════════════════════════════════════
 *  「期別顯示」與「年份顯示」：每一個顯示期間的欄位都要跟著走
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（在交通服務水準上發現，並指定三支都要查）：
 *   「期別顯示調查月份 和西元年，但這裡的資料**只有成功變成西元年，
 *     沒有變成調查月份**。請確認月份和年的切換功能都有正常運作。」
 *   「三份程式都有，確認都有正常運作 調查月份 和 年 切換。」
 *
 * ⚠️ 既有的 e2e-period-date 驗的是「切換鈕會動、某幾個欄位會變」，
 *   **沒有逐頁掃過整個畫面**。而這兩顆鈕是兩層獨立的轉換：
 *   年份那一層到處都套上了，期別那一層只套在少數地方。
 *
 * 作法：切到「調查月份」之後掃過每一個分頁，找還有沒有殘留的季別寫法。
 * ⚠️ 四種組合都要驗——只驗一種正是這次漏掉的原因。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./e2e-nav.mjs";
import * as XLSX from "xlsx";

/*
 * ⚠️ 一定要用**帶有調查日期**的檔案。
 *   .samples 裡的樣本表頭沒有日期，期別切換鈕會被停用——
 *   那樣這一支會整個跑不動，或更糟：變成恆真。
 *   這裡沿用 e2e-period-date 同一套造檔方式（日期放在 F3，
 *   刻意不是固定位置，證明系統讀的是整塊表頭）。
 */
const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const hourLabel = (h) =>
  `${String(h).padStart(2, "0")}:00～${String((h + 1) % 24).padStart(2, "0")}:00`;
function datedWorkbook(dateText, base) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["", "", "", "", "", dateText, "", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let h = 0; h < 24; h += 1) {
    const cells = [];
    for (let d = 0; d < 2; d += 1)
      for (let v = 0; v < VEHICLES.length; v += 1)
        cells.push(base + h + v * 3 + d * 7);
    rows.push([hourLabel(h), ...cells]);
  }
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages", "dist");
const T = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = http.createServer((q, r) => {
  let p = join(
    root,
    decodeURIComponent(q.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) p = join(root, "index.html");
  r.writeHead(200, {
    "content-type": T[extname(p)] || "application/octet-stream",
  });
  r.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, ok));

const problems = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(1600);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("期別切換守門用計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);

for (const [name, quarter, dateText, base] of [
  ["A00T00-01_守門路段甲.xlsx", "115Q1", "監測日期：115年01月26日(平日)", 40],
  ["A00T00-02_守門路段乙.xlsx", "115Q2", "監測日期：115年05月12日(平日)", 70],
]) {
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
      buffer: datedWorkbook(dateText, base),
    });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3000);
  }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(500);
  }
}


/* ⚠️ 同一頁可能有好幾顆（主工具列＋各區塊），一律取第一顆。 */
const toggle = (id) => page.locator(`[data-testid="${id}"]`).first();
const monthOn = () =>
  toggle("period-display-toggle").textContent().then((t) => /調查月份/.test(t ?? ""));
const adOn = () =>
  toggle("year-style-toggle").textContent().then((t) => /西元/.test(t ?? ""));
const setMonth = async (want) => {
  if ((await monthOn()) !== want) {
    await toggle("period-display-toggle").click();
    await page.waitForTimeout(500);
  }
};
const setAd = async (want) => {
  if ((await adOn()) !== want) {
    await toggle("year-style-toggle").click();
    await page.waitForTimeout(500);
  }
};

const enabled = await toggle("period-display-toggle").isEnabled();
ok(
  "前置：這批資料有調查日期，期別鈕可以按（不能按的話整支變成恆真）",
  enabled,
);

const zones = await page.evaluate(() =>
  [...document.querySelectorAll("[data-goto]")].map((el) => ({
    id: el.getAttribute("data-goto"),
    label: (el.textContent || "").replace(/\s+/g, " ").trim(),
  })),
);

const scan = async () => {
  const out = [];
  for (const zone of zones) {
    await page.locator(`[data-goto="${zone.id}"]`).first().click();
    await page.waitForTimeout(500);
    const hits = await page.evaluate(() => {
      const found = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walk.nextNode())) {
        const text = (node.nodeValue || "").trim();
        /*
         * ⚠️ 「例如：115Q1」這種輸入格式範例、以及長句子裡拿季別當例子的說明，
         *   都不算漏網——那是散文，不是資料欄位。
         *   資料欄位一定很短，所以用長度分辨；門檻訂得保守（40 字），
         *   寧可多幾個假警報，也不要把真正漏掉的欄位濾掉。
         */
        if (/例如/.test(text)) continue;
        if (text.length > 40) continue;
        const m = text.match(/\b\d{3,4}Q[1-4]\b/);
        if (m) {
          const owner = node.parentElement;
          found.push(
            `${m[0]}（在 ${owner.tagName.toLowerCase()}${owner.id ? "#" + owner.id : ""}）`,
          );
        }
      }
      return [...new Set(found)].slice(0, 6);
    });
    if (hits.length) out.push(`${zone.label}：${hits.join("、")}`);
  }
  return out;
};

console.log("\n── 四種組合逐一驗");
for (const [month, ad, name] of [
  [false, false, "季別 × 民國年"],
  [false, true, "季別 × 西元年"],
  [true, false, "調查月份 × 民國年"],
  [true, true, "調查月份 × 西元年"],
]) {
  await setMonth(month);
  await setAd(ad);
  const leftovers = await scan();
  if (month)
    ok(
      `${name}：畫面上不應再有任何季別寫法`,
      leftovers.length === 0,
      leftovers.length ? leftovers.slice(0, 4).join(" ｜ ") : "全部都是月份寫法",
    );
  else
    ok(
      `${name}：畫面上應該**還有**季別寫法（前置檢查，證明掃描真的掃得到）`,
      leftovers.length > 0,
      `${leftovers.length} 頁有`,
    );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 期別與年份兩顆鈕，每一個期間欄位都跟著走");
