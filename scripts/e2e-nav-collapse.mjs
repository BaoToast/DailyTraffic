/*
 * ══════════════════════════════════════════════════════════════════════
 *  小分頁可以收合，而且不影響大分頁原本的換頁
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（三支同步）：
 *   「使用者點選了大分頁後，會展開下面的小分頁，那能否做個**可以讓使用者
 *     把小分頁收合**的功能? ……因為**目前點選大分頁是會有跳轉功能的**，
 *     所以如果要做可以收合小分頁的功能的話，可能要想一下怎麼做」
 *
 * ⚠️ 衝突點是使用者自己先指出來的，所以這一支**兩邊都要驗**：
 *   ① 收合鈕：按了小分頁收起來
 *   ② 大分頁的文字區：按了**只換頁、不收合**
 *   只驗①的話，把整列改成「按哪裡都收合」也會過——而那會把換頁弄丟。
 *
 * ⚠️ 另外三條容易被忽略的：
 *   ③ 收合之後大分頁**自己還在**
 *   ④ 重新整理之後收合狀態還記得
 *   ⑤ 沒有小分頁的大分頁**不顯示**收合鈕
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((request, response) => {
  let path = decodeURIComponent(request.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = join(ROOT, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
  });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base);
await page.waitForTimeout(1200);

/*
 * ══════════════════════════════════════════════════════════════════
 *  ⓪ 一載入就不可以有「看不見的空按鈕」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 在姊妹專案（交通服務水準）回報（附圖）：
 *   「左側分頁這個隱形按鈕是什麼，按了之後也沒任何反應，且直接消失」
 * 那一支是用 DOM 手動建按鈕、靠事後的 applyNavCollapse() 去藏，
 * 而那支函式在「這一頁沒有小分頁」時被提前 return 跳過了。
 *
 * 這一支是 React 條件渲染（zone.items.length > 0 才產生按鈕），
 * 結構上不會有那個毛病——但**結構上不會**不等於**永遠不會**，
 * 所以照樣量一次。
 */
{
  const ghosts = await page.evaluate(() =>
    [...document.querySelectorAll(".side-nav-collapse")]
      .filter((el) => {
        if (el.hidden) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        const box = el
          .closest(".side-nav-group")
          ?.querySelector(".side-nav-items");
        /* ⚠️ 同⑤：手風琴之後要數大分頁，不是小分頁（見⑤那一段的說明）。 */
        const hasPages = box && box.querySelectorAll(".side-nav-page").length > 0;
        return !hasPages || !(el.textContent || "").trim();
      })
      .map((el) =>
        (el.closest(".side-nav-group")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 10),
      ),
  );
  ok(
    "⓪ 剛載入時側欄不可以有看不見的空按鈕",
    ghosts.length === 0,
    ghosts.join("、"),
  );
  const total = await page.locator(".side-nav-collapse").count();
  ok("⓪ 前置：側欄真的產出了收合鈕（否則上一條恆真）", total > 0, `${total} 顆`);
}

/* 第一個分區（建立與匯入）一定有小分頁，不需要資料。 */
const ZONE = await page.evaluate(
  () => document.querySelector(".side-nav-group button[data-goto]")?.dataset.goto,
);
ok("前置：側欄有大分頁", !!ZONE, String(ZONE));

const group = page.locator(`.side-nav-group:has(button[data-goto="${ZONE}"])`);
const items = () => group.locator(".side-nav-items .side-nav-item:visible").count();
const before = await items();
ok("前置：這個大分頁真的有小分頁（否則整支恆真）", before >= 2, `${before} 個`);
if (before < 2) {
  await browser.close();
  server.close();
  console.error("\n❌ 沒有小分頁可驗，不當成通過");
  process.exit(1);
}

const toggle = group.locator(".side-nav-collapse");
ok("有小分頁的大分頁，右側看得到收合鈕", (await toggle.count()) === 1);

/*
 * ⚠️ 標籤要寫**按下去會發生什麼**，不是目前狀態。
 *   使用者 2026-09-14：「小標籤寫著『展開』……展開後文字就變成『收合』」。
 *   只驗「有字」不夠——寫成永遠是「收合」也會過，所以兩種狀態都要量。
 */
/*
 * ⚠️ 2026-09-15 改法：箭頭**永遠是 ▼**，收合狀態靠 **CSS 轉 -90 度**。
 *
 *   原本是展開印 ▾、收合印 ▸，而且寫成 \u25be／\u25b8 跳脫。那兩個字
 *   **不在 Big5**，微軟正黑體畫不出來，在某些電腦上是一片空白；
 *   跳脫寫法還讓字形守門看不到它們（守門已補上還原跳脫再掃）。
 *   使用者 2026-09-11 就回報過同一個坑（「向下箭頭已經看不到」）。
 *
 * ⚠️ 所以這裡量的是**實際轉了幾度**，不是字元。
 *   量字元的話，一個「兩種狀態都不轉」的實作照樣全綠——
 *   而使用者看到的是箭頭永遠朝下、按了沒反應。
 */
const caretAngle = async () =>
  toggle.evaluate((el) => {
    const caret = el.querySelector("i") || el;
    const t = getComputedStyle(caret).transform;
    if (!t || t === "none") return 0;
    const m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return 0;
    const [a, b] = m[1].split(",").map(Number);
    return Math.round((Math.atan2(b, a) * 180) / Math.PI);
  });
ok(
  "箭頭用的是 Big5 一定有的 ▼（不是畫不出來的 ▾／▸）",
  (await toggle.innerText()).trim() === "▼",
  (await toggle.innerText()).trim(),
);
ok(
  "展開狀態下箭頭朝下（沒有轉角度）",
  Math.abs(await caretAngle()) <= 1,
  `轉了 ${await caretAngle()} 度`,
);

/* ① */
await toggle.click();
await page.waitForTimeout(400);

ok("① 按收合鈕之後小分頁收起來", (await items()) === 0, `剩 ${await items()} 個`);
ok(
  "③ 大分頁本身還在",
  (await page.locator(`.side-nav-group button[data-goto="${ZONE}"]`).count()) === 1,
);
ok(
  "收合後 aria-expanded 要是 false",
  (await toggle.getAttribute("aria-expanded")) === "false",
);
ok(
  "收合狀態下箭頭改成朝右（轉 -90 度；字仍然是 ▼）",
  Math.abs((await caretAngle()) + 90) <= 1 &&
    (await toggle.innerText()).trim() === "▼",
  `轉了 ${await caretAngle()} 度、字是「${(await toggle.innerText()).trim()}」`,
);

/* ④ */
await page.reload();
await page.waitForTimeout(1400);
ok("④ 重新整理之後收合狀態還記得", (await items()) === 0, `剩 ${await items()} 個`);

/*
 * ④-2 **點分類標題就要展開回來**
 *
 * 使用者 2026-09-14：
 *   「全日交通量程式，我點選分類標題（例如二、參數設定）時，
 *     並未自動展開下方的大分頁和小分頁，請同步確認三份程式是否都能自動展開」
 *
 * ⚠️ 收合狀態是記在 localStorage 的，所以按過一次收合鈕之後那一區就
 *   **永遠**是收的；使用者去點分類標題（那正是最直覺的動作）什麼都不會發生，
 *   只有回去按那一顆小小的 ▸ 才展得開——看起來就是分頁壞了。
 *   「點它＝我要看這一區」，所以點下去就要展開。
 *
 * ⚠️ 這裡**目前是收合狀態**（④ 剛量完），所以這一條不是恆真的。
 */
await page.locator(`.side-nav-group button[data-goto="${ZONE}"]`).click();
await page.waitForTimeout(500);
ok(
  "④-2 收合中點分類標題，底下要自動展開",
  (await items()) === before,
  `${await items()} / ${before}`,
);

/* 收合鈕本身還是要能用（不可以為了自動展開就把收合做死）。 */
await group.locator(".side-nav-collapse").click();
await page.waitForTimeout(400);
ok("收合鈕仍然收得起來", (await items()) === 0, `剩 ${await items()} 個`);
await group.locator(".side-nav-collapse").click();
await page.waitForTimeout(400);
ok("再按一次展開回來", (await items()) === before, `${await items()} / ${before}`);

/*
 * ② 大分頁的文字區只換頁、不收合。
 *   先切到別的分區，再點回來——小分頁必須還在，而且真的換了頁。
 */
const others = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav-group button[data-goto]")].map(
    (button) => button.dataset.goto,
  ),
);
const other = others.find((id) => id !== ZONE);
await page.locator(`.side-nav-group button[data-goto="${other}"]`).click();
await page.waitForTimeout(600);
await page.locator(`.side-nav-group button[data-goto="${ZONE}"]`).click();
await page.waitForTimeout(600);
ok(
  "② 點大分頁的文字區只換頁、不收合",
  (await items()) === before,
  `${await items()} / ${before}`,
);
ok(
  "② 而且真的換過去了",
  (await page
    .locator(`.side-nav-group button[data-goto="${ZONE}"].active`)
    .count()) === 1,
);

/* ⑤ */
/*
 * ⚠️ X-73 起側欄是**手風琴**：小分頁只有目前那一頁才展開。
 *   所以「這一區有沒有東西可收」不能再看 `.side-nav-item`——
 *   非目前頁的那幾區一個 item 都沒有，會被誤判成「空的卻有收合鈕」。
 *   這一顆鈕收的是**這一區底下的大分頁**（`.side-nav-page`），
 *   所以要數的是大分頁，不是小分頁。
 */
const stray = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav-group")]
    .filter((groupEl) => {
      const box = groupEl.querySelector(".side-nav-items");
      const hasPages = box && box.querySelectorAll(".side-nav-page").length > 0;
      const toggleEl = groupEl.querySelector(".side-nav-collapse");
      return !hasPages && toggleEl;
    })
    .map((groupEl) => (groupEl.textContent || "").trim().slice(0, 12)),
);
ok("⑤ 沒有小分頁的大分頁不可以出現收合鈕", stray.length === 0, stray.join("、"));

/*
 * ── 側欄字級要**看得出層級**（使用者 2026-09-15 連問兩次）─────────
 *
 * 第一次：「分類標題與它下方的大分頁文字大小不要相同……請依此順序遞減」
 * 第二次（附圖）：「你說全日交通量側欄字級 16／14……但我看左側欄位怎感覺
 *   不像 16／14，感覺兩個文字一樣大?」
 *
 * ⚠️ 所以門檻**不可以只寫「大的要比小的大」**：16 對 14 完全符合那個條件，
 *   但實際上分不出來。這裡要求**至少差 3px**，並且最小一層與另外兩支
 *   的小分頁對齊（12px）。
 */
const navSizes = await page.evaluate(() => {
  const zone = document.querySelector(".side-nav-group > button");
  const item = document.querySelector(".side-nav-item");
  return {
    zone: zone ? Math.round(parseFloat(getComputedStyle(zone).fontSize)) : 0,
    item: item ? Math.round(parseFloat(getComputedStyle(item).fontSize)) : 0,
  };
});
ok(
  "前置：兩層的字級都量得到（量到 0 的話下面那條恆真）",
  navSizes.zone > 0 && navSizes.item > 0,
  `分類標題 ${navSizes.zone}px、項目 ${navSizes.item}px`,
);
ok(
  "⚠️ 側欄兩層的字級差要看得出來（至少 3px，不是「大於就好」）",
  navSizes.zone - navSizes.item >= 3,
  `分類標題 ${navSizes.zone}px、項目 ${navSizes.item}px，差 ${navSizes.zone - navSizes.item}px`,
);

/* ══ ⑥ 箭頭要真的置中（使用者 2026-09-17 附圖回報）══════════════
 *
 * 使用者三支各附一張圖：路口轉向偏左、全日交通量偏右、交通服務水準偏左。
 *
 * ⚠️ 量的是**關係不是像素**：箭頭字形的水平中心要對齊按鈕的水平中心。
 *   寫死「距離左邊界幾 px」的話，改個字級或按鈕寬度就會誤紅。
 *
 * ⚠️ 用 Range 量**字形本身**的框，不是量按鈕的框。
 *   量按鈕等於拿它自己跟自己比，永遠置中——那是恆真的守門。
 *
 * 反證（實跑）：把 flex 置中與 line-height:1 拿掉，實測橫向偏移 −7.99px，
 * 正是使用者附圖上看到的「偏一邊」。
 */
const carets = await page.evaluate((selector) => {
  const out = [];
  for (const button of document.querySelectorAll(selector)) {
    if (button.hidden) continue;
    const range = document.createRange();
    range.selectNodeContents(button);
    const glyph = range.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    if (glyph.width < 1 || box.width < 1) continue;
    out.push({
      text: (button.textContent || "").trim(),
      dx: +(glyph.left + glyph.width / 2 - (box.left + box.width / 2)).toFixed(2),
      dy: +(glyph.top + glyph.height / 2 - (box.top + box.height / 2)).toFixed(2),
    });
  }
  return out;
}, ".side-nav .side-nav-collapse");
ok(
  "前置：量得到收合鈕裡的箭頭（0 顆的話下一條恆真）",
  carets.length > 0,
  `${carets.length} 顆`,
);
const offCenter = carets.filter((c) => Math.abs(c.dx) > 1 || Math.abs(c.dy) > 1.5);
ok(
  "⚠️ ⑥ 箭頭在收合鈕裡要置中（使用者回報偏一邊）",
  carets.length > 0 && offCenter.length === 0,
  offCenter.length
    ? offCenter.map((c) => `「${c.text}」橫 ${c.dx}px／縱 ${c.dy}px`).join("、")
    : `最大偏移 橫 ${Math.max(...carets.map((c) => Math.abs(c.dx)))}px／縱 ${Math.max(...carets.map((c) => Math.abs(c.dy)))}px`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 小分頁可收合、可記住；大分頁的換頁一個字都沒改");
