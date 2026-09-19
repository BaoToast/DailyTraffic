/*
 * ══════════════════════════════════════════════════════════════════
 *  畫面上每一個 class，樣式表裡都要真的寫過
 * ══════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 *   2026-09-11 一天之內踩到三次**同一種**錯誤：
 *     ・.ghost（本程式）→ 按鈕變成沒有邊框的純文字
 *     ・.ghost（路口轉向）→ 同上
 *     ・.factor-scope-picker／-state／-summary／-conflict（本程式）
 *       → 使用者原話：「參數設定 套用季別 全季別 和套用路段 也全面是白色的，
 *          與背景色相融，完全沒發現這裡可以設定 季別/路段」
 *
 *   三次都是：**JSX 寫了 class，CSS 從頭到尾沒有那一條規則**。
 *
 * ⚠️ 這種錯誤最惡毒的地方是它**不會有任何錯誤訊息**。
 *   TypeScript 不看 class 名稱，ESLint 不看，瀏覽器主控台也不會吭聲，
 *   畫面照樣畫得出來——只是畫成一行沒有樣式的字。
 *   而且本專案用 Tailwind preflight，沒有規則**不等於**用瀏覽器預設值：
 *   preflight 會把所有元素的框線寬度歸零、底色設成透明，
 *   所以「漏寫規則」的實際後果是**隱形**，比沒有樣式更糟。
 *   （實測：那兩個 <select> 算出來是 border-width: 0px、background: rgba(0,0,0,0)。）
 *
 * ── 為什麼用 E2E 而不是掃原始碼 ────────────────────────────────
 *
 *   掃 .tsx 找 className 要自己剖析 `focusClass(id, base)`、樣板字串、
 *   三元運算式……而且分不出「這是 class」和「這是傳給函式的 id」，
 *   假警報會多到沒人理它——沒人理的測試等於沒有測試。
 *   改成在**真的畫出來的畫面**上做：讀每個元素的 classList，
 *   再問 document.styleSheets 有沒有任何一條規則提到它。兩邊都是事實，
 *   不需要猜，也自動涵蓋 Tailwind 產生的工具類別。
 *
 * ── ⚠️ 刻意迴避的假通過陷阱 ────────────────────────────────────
 *
 *   一、**只看首頁不算。** 換頁之後別頁的 DOM 根本不存在，
 *       只驗一頁等於只驗五分之一。這裡逐頁走過五個分頁再聯集。
 *   二、**「有規則」不等於「規則有效」**——這一支只擋「完全沒寫」。
 *       顏色對不對是 e2e-chart-notes 的對比度那一段在管。
 *   三、前置檢查：先塞一個**故意不存在**的 class 進 DOM，
 *       確認這支抓得到它。抓不到的話，下面那條是恆綠的。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, ensureToolbarOpen } from "./e2e-nav.mjs";

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
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8188, r));

const problems = [];
/*
 * detail 分兩種用途：有些是**佐證**（成功時也該印出來看），
 * 有些是**失敗原因**（成功時印出來會讓人以為出事了）。
 * 後者用 failOnly() 包起來，只在紅字時才顯示。
 */
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object"
      ? condition
        ? ""
        : detail.failOnly
      : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

/*
 * 這些 class 是**刻意**沒有自己的樣式的，不是漏寫。
 * 要往這裡加東西之前，先問一句「它真的不需要樣式嗎」——
 * 三次事故都是在這一步自我說服「應該有吧」而放過去的。
 */
const INTENTIONAL = new Set([]);

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8188/");
/* X-78 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(900);

/* ── 建計畫並灌入樣本，讓各頁真的有內容可以畫 ─────────────── */
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
await page.locator(".modal-backdrop .modal input").first().fill("樣式覆蓋測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);
for (const [name, quarter] of [
  ["115T1-01_中山路.xlsx", "115Q1"],
  ["115T1-02_中正路口.xlsx", "115Q1"],
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
      buffer: readFileSync(join(SAMPLES, name)),
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

/**
 * 在目前畫面上找出「沒有任何 CSS 規則提到它」的 class。
 * 回傳 { klass: 第一個用到它的元素敘述 } 方便回頭找。
 */
const scanPage = () =>
  page.evaluate(() => {
    /* 1. 把所有樣式表裡出現過的 class 名稱收成一個集合 */
    const styled = new Set();
    const collect = (rules) => {
      for (const rule of rules) {
        if (rule.selectorText)
          /*
           * ⚠️ 這一條正規式很容易寫錯，而且**錯了會全綠或全紅**：
           *   字元類別如果放進「空白到 \uFFFF」的範圍，等於連小數點和空白
           *   都算進名稱，於是 `.severity.warning` 會被當成一個叫
           *   「severity.warning」的類別，`.warning` 就永遠找不到規則
           *  （路口轉向那一支實測噴出 40 幾個假警報，成因就是這個）。
           *   名稱只能是 CSS 識別字：字母／數字／底線／連字號（外加非 ASCII）。
           */
          for (const m of rule.selectorText.matchAll(
            /\.(-?[_a-zA-Z\u00a0-\uffff][\w\u00a0-\uffff-]*)/g,
          ))
            styled.add(m[1]);
        if (rule.cssRules) collect(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        collect(sheet.cssRules);
      } catch {
        /* 跨來源樣式表讀不到；本專案是內嵌的，不會走到這裡 */
      }
    }
    /* 2. 走訪畫面上每一個元素的 classList */
    const missing = {};
    for (const el of document.querySelectorAll("[class]")) {
      if (typeof el.className !== "string") continue; /* SVG 元素跳過 */
      for (const klass of el.classList)
        if (!styled.has(klass) && !(klass in missing))
          missing[klass] =
            `<${el.tagName.toLowerCase()} class="${el.className}">` +
            (el.textContent || "").trim().slice(0, 24);
    }
    return missing;
  });

console.log("\n══ 前置：這支掃描器真的抓得到沒有規則的 class ══");
await page.evaluate(() => {
  const probe = document.createElement("div");
  probe.className = "zz-probe-class-with-no-rule";
  document.body.appendChild(probe);
});
const probeScan = await scanPage();
ok(
  "塞一個不存在的 class 進去，掃描器抓得到",
  "zz-probe-class-with-no-rule" in probeScan,
  failOnly("抓不到的話，下面「每個 class 都有規則」那一條是恆綠的"),
);
await page.evaluate(() => {
  document.querySelector(".zz-probe-class-with-no-rule")?.remove();
});

console.log("\n══ 逐頁掃描（別頁的 DOM 不存在，只掃首頁等於只掃五分之一）══");
const missing = {};
let searchProbed = false;
for (const [zone, label] of [
  [TABS.import, "資料匯入"],
  [TABS.settings, "參數設定"],
  [TABS.kpi, "資料檢視"],
  [TABS.charts, "圖表"],
  [TABS.output, "資料產出與維護"],
]) {
  const found0 = {};
  await gotoTab(page, zone);
  await page.waitForTimeout(500);
  /*
   * ⚠️ 有些元素**只在某個狀態下才存在**（搜尋提示要打了字才出現）。
   *   「沒出現就掃不到」是這一支先天的限制，不是通過。
   *   所以凡是知道的狀態都要主動打開，不能只掃靜止畫面。
   */
  const searchBox = page.locator("label.search input");
  if (
    await searchBox
      .first()
      .isVisible()
      .catch(() => false)
  ) {
    for (const term of ["中山", "這個名字一定不存在", ""]) {
      /*
       * ⚠️ 用 fill() 會逾時：打完第一個字之後表格會重畫，
       *   Playwright 等「元素穩定」等不到。這裡直接改值再派發 input 事件，
       *   目的只是把狀態打開讓掃描器看得到，不是在驗輸入行為
       *  （輸入行為由 e2e-multi-filter 驗）。
       */
      const typed = await page.evaluate((value) => {
        const input = document.querySelector("label.search input");
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }, term);
      if (!typed) break;
      await page.waitForTimeout(350);
      Object.assign(found0, await scanPage());
    }
    searchProbed = true;
  }
  /*
   * ⚠️ 日別也要切過去掃一次。
   *
   * 使用者 2026-09-12 回報「平日假日和下面總結的文字，離邊緣非常近，
   * 幾乎是黏著的」——成因是 .donut-pair / .donut-day / .donut-pair-note
   * 這三個 class **完全沒有樣式**，而這支掃描器當時是綠的：
   * 那一段只有在日別切成「平日＋假日」時才會渲染，掃描器停在預設日別，
   * 於是那三個 class 從來沒有出現在畫面上、也就從來沒被掃到。
   *
   * 「沒出現就掃不到」是這支先天的限制，所以凡是知道的狀態都要主動打開。
   */
  /*
   * ⚠️ 一定要指名「日別」那一個下拉。
   *   .filters select 的**第一個是季度**——第一版就是這樣寫的，
   *   於是掃描器把季度掃了一輪、日別一次都沒切，
   *   而「平日＋假日」才會出現的那三個 class 照樣沒被掃到（實測證明過）。
   */
  /*
   * ⚠️ 每一個下拉的**每一個選項**都要掃過。
   *
   * 使用者 2026-09-12 回報「平日假日和下面總結的文字，離邊緣非常近，
   * 幾乎是黏著的」——成因是 .donut-pair / .donut-day / .donut-pair-note
   * 這三個 class **完全沒有樣式**，而這支掃描器當時是綠的：
   * 那一段只有在車種組成那張圖的日別切成「平日＋假日」時才會渲染，
   * 掃描器停在預設值，於是那三個 class 從來沒出現在畫面上、也就沒被掃到。
   *
   * ⚠️ 只掃**上方共同篩選列**是不夠的（第一版就是這樣，實測仍然抓不到）：
   *   車種組成、歷季分析這幾張圖有**自己的**下拉，狀態與上方那排無關。
   *   所以這裡掃的是「畫面上每一個 select」，不是特定那幾個。
   *
   * 「沒出現就掃不到」是這支先天的限制，凡是知道的狀態都要主動打開。
   */
  const selects = page.locator(".content select, .filters select");
  const selectCount = await selects.count();
  for (let i = 0; i < selectCount; i += 1) {
    const select = selects.nth(i);
    const options = await select
      .evaluate((el) => [...el.options].map((o) => o.value))
      .catch(() => []);
    if (options.length < 2) continue;
    const original = await select.inputValue().catch(() => "");
    for (const value of options) {
      await select.selectOption(value).catch(() => {});
      await page.waitForTimeout(320);
      Object.assign(found0, await scanPage());
    }
    await select.selectOption(original).catch(() => {});
    await page.waitForTimeout(250);
  }
  const found = Object.assign(found0, await scanPage());
  let count = 0;
  for (const [klass, where] of Object.entries(found)) {
    if (INTENTIONAL.has(klass)) continue;
    count += 1;
    if (!(klass in missing)) missing[klass] = `${label}｜${where}`;
  }
  console.log(`   ${label}：${count ? `${count} 個沒有規則` : "全部都有規則"}`);
}

console.log("\n══ 結果 ══");
ok(
  "畫面上每一個 class 在樣式表裡都找得到規則",
  Object.keys(missing).length === 0,
  Object.keys(missing).length
    ? "\n" +
      Object.entries(missing)
        .map(([k, v]) => `   .${k}　←　${v}`)
        .join("\n")
    : "",
);
ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));
/*
 * ⚠️ 這一條不是裝飾：搜尋提示 .search-hint 只在打了字之後才存在，
 *   如果搜尋框沒被碰到，上面那條就漏掃了它，卻仍然是綠的。
 */
ok(
  "有真的打字進搜尋框（否則 .search-hint 這類「只在某狀態下出現」的樣式沒被掃到）",
  searchProbed,
  failOnly("找不到可輸入的搜尋框——請確認 label.search input 還在"),
);

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
