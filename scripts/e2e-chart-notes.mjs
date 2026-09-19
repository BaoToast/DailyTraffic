/*
 * ══════════════════════════════════════════════════════════════════
 *  v20.62 三件新事情的端對端守門
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者交代的三件事，這一支各配一組實測：
 *
 *  ① 「讓使用者一目了然知道資料匯入區、參數設定區、圖表區…各大功能區」
 *     → 五個區段標題存在；頂端導覽固定不動（跳到第五區之後還按得到）；
 *       按下去之後標題**不可以被導覽列蓋住**。
 *
 *  ② 「不管哪個程式，我希望圖旁邊都能有對應的解讀說明」
 *     → 四張圖旁邊各有一段說明；寬螢幕在右側、窄螢幕在下方；
 *       而且說明裡的數字要和畫面上的數字一致（文字與圖分岔最難發現）。
 *
 *  ③ 「檔案匯出不能在圖上留下說明文字」「網頁上說明文字顏色不能被底色遮掩」
 *     → 說明一律在畫布／圖本體之外（不與 canvas 相交）；
 *       全頁按鈕與新增元件的文字對比一律量到 ≥ 4.5:1（WCAG AA）。
 *
 * ⚠️ 每一項都是「量出來的數字」，不是「我看過了」。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, PAGES, gotoPage, ZONE_FIRST_PAGE } from "./e2e-nav.mjs";

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
  ".pdf": "application/pdf",
  ".docx": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8112, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8112/");
await page.waitForTimeout(800);
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
await page.locator(".modal-backdrop .modal input").first().fill("說明文字量測");
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
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(500);
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
await page.waitForTimeout(600);

/* ════════════════════════════════════════════════════════════════
 * 一、五個分頁
 * ════════════════════════════════════════════════════════════════
 *
 * ⚠️ v20.64 把五個分區從「同一頁的錨點」改成**真的換頁**
 *（使用者 2026-09-09 指名）。原本這一節驗的是：
 *   ・五個 .zone-heading 同時都在 DOM 裡
 *   ・導覽 sticky 在視窗上緣
 *   ・按了之後標題不會被導覽蓋住（scroll-margin-top）
 *
 * 這三項**不是被放寬，是它們守的東西整個不存在了**：
 * 換頁之後一次只有一個 .zone-heading；導覽不再 sticky（換頁會回到頁首，
 * 導覽本來就在最上面）；標題也不會被蓋住（沒有東西浮在上面）。
 *
 * 換成守換頁本身該有的行為，且**每一項都要能紅**：
 *   ・分頁鈕五顆
 *   ・按第 N 顆，畫面上只出現第 N 個分區的標題（不是五個都在）
 *   ・高亮跟著換
 *   ・別頁的標題不可以還留著
 * 「別頁的標題不可以還留著」是關鍵那一條——少了它，把換頁改回
 * 「全部都渲染」也會全部通過。
 */
console.log("\n══ 一、五個分頁 ══");

/*
 * ⚠️ 只數有 data-goto 的那幾顆。v20.64 起側欄每個歸類底下還會列出
 *   該頁的區塊（使用者要求：「看不出歸類下面有什麼資料」），
 *   那些子項目也是 <button>，直接數 `.side-nav button` 會數到 23 顆。
 */
const navCount = await page.locator(".side-nav button[data-goto]").count();
ok("分頁導覽有五顆分頁按鈕", navCount === 5, `實測 ${navCount} 顆`);

const zoneIds = await page.evaluate(() =>
  [...document.querySelectorAll(".side-nav button[data-goto]")].map((el) =>
    el.getAttribute("data-goto"),
  ),
);
ok("五顆按鈕各自對應一個分區 id", new Set(zoneIds).size === 5, zoneIds.join("／"));
/*
 * 子項目也要在——收起來就等於沒解決使用者說的那句話。
 *
 * ⚠️ X-73（使用者 2026-09-17）之後側欄是**手風琴**：
 *   「點了某一大分頁，其它展開的大分頁會自動收合」。
 *   所以全站的小分頁**不會同時列出來**，寫死「≥15 個」等於在守舊行為。
 *   使用者當初那句「看不出歸類下面有什麼資料」講的是**分區底下看不到大分頁**，
 *   那一層仍然一律列出——所以這裡改驗：
 *     ① 大分頁一律列得出來（14 個）
 *     ② 目前這一頁的小分頁真的展開了（至少一個）
 *   ⚠️ 只驗①的話，一個「小分頁全部收起來、永遠不展開」的實作也會全綠。
 */
const pageCount = await page.locator(".side-nav button[data-goto-page]").count();
ok("側欄列得出全部大分頁", pageCount >= 10, `${pageCount} 個`);
const openItems = await page.evaluate(() => {
  const current = document.querySelector(".side-nav .side-nav-page.current");
  const group = current?.closest(".side-nav-page-group");
  return group
    ? group.querySelectorAll(".side-nav-item").length
    : 0;
});
ok(
  "目前這一頁的小分頁有展開（手風琴不可以連目前這一頁都收起來）",
  openItems >= 1,
  `${openItems} 個`,
);

for (let index = 0; index < zoneIds.length; index += 1) {
  await gotoTab(page, zoneIds[index]);
  const measured = await page.evaluate(() => {
    const headings = [...document.querySelectorAll(".zone-heading")].map((el) => el.id);
    const active = document.querySelector(".side-nav button.active");
    return {
      headings,
      /* 同上：只在「分頁按鈕」這一組裡算序號，不要把子項目算進去。 */
      activeIndex: active
        ? [...document.querySelectorAll(".side-nav button[data-goto]")].indexOf(
            active,
          )
        : -1,
      scrollY: Math.round(window.scrollY),
    };
  });
  /*
   * ⚠️ X-63（2026-09-17）：分區底下多了一層大分頁，
   *   而**抬頭印的是大分頁**（一個大分頁＝一個畫面），
   *   所以這裡要比對的是「那一區的第一個大分頁」，不是分區 id。
   *   驗的東西沒有變：畫面上**只有一個**抬頭（＝真的換頁，
   *   不是把全部都渲染出來）。
   */
  ok(
    `按「${index + 1}」之後畫面上只有一個分頁（${ZONE_FIRST_PAGE[zoneIds[index]]}）`,
    measured.headings.length === 1 &&
      measured.headings[0] === ZONE_FIRST_PAGE[zoneIds[index]],
    `實測 ${measured.headings.length} 個：${measured.headings.join("／")}`,
  );
  ok(
    `按「${index + 1}」之後高亮跟著換到第 ${index + 1} 顆`,
    measured.activeIndex === index,
    `實測高亮第 ${measured.activeIndex + 1} 顆`,
  );
  ok(
    `按「${index + 1}」之後回到頁首（不是停在上一頁的捲動位置）`,
    measured.scrollY <= 4,
    `scrollY=${measured.scrollY}`,
  );
}

/* ════════════════════════════════════════════════════════════════
 * 二、圖旁邊的說明文字
 * ════════════════════════════════════════════════════════════════ */
console.log("\n══ 二、圖旁邊的說明文字 ══");

/*
 * ⚠️ X-63：四張圖**已經各自一個大分頁**了，不再同頁。
 *   所以下面改成逐頁走過去，每一頁驗它自己那一張圖的說明。
 */
const CHART_PAGES = [
  [PAGES.composition, "車種組成"],
  [PAGES.hourly, "24小時型態"],
  [PAGES.trend, "歷季分析"],
  [PAGES.comparison, "同季平假日"],
];
const notes = [];
for (const [pageId, label] of CHART_PAGES) {
  await gotoPage(page, pageId);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const found = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chart-note]")].map((note) => {
      const panel = note.closest(".panel");
      const heading = panel?.querySelector(".panel-title h3");
      return {
        panel: String(panel?.className || ""),
        heading: (heading?.textContent || "").trim().slice(0, 24),
        paragraphs: note.querySelectorAll("p").length,
        text: (note.textContent || "").replace(/\s+/g, " ").trim(),
      };
    }),
  );
  /*
   * ⚠️ 一頁一張圖，所以這裡順便驗「**這一頁的說明都是這一頁的**」——
   *   多出來的那一段一定是別頁的內容洩漏過來了。
   *
   * ⚠️ 車種組成是例外，而且是刻意的（稽核表 ①，使用者 2026-09-16 裁示
   *   「如果是多路段，則每個路段都分別計算」）：多個調查點時一個調查點一組，
   *   **一組一段說明**，所以這一頁的段數等於組數。
   *   舊版寫死 `found.length === 1`，拆組之後就一直是紅的。
   *   這裡改成「等於畫面上真的有幾組」——寫死 1 或寫死 2 都是把答案抄進測試。
   */
  const expected =
    pageId === PAGES.composition
      ? Math.max(
          1,
          await page.evaluate(
            () => document.querySelectorAll("#block-composition .donut-day").length,
          ),
        )
      : 1;
  ok(
    `「${label}」這一頁上的解讀說明段數要等於圖的組數`,
    found.length === expected,
    `實測 ${found.length} 段、應為 ${expected} 段：${found.map((n) => n.heading).join("／")}`,
  );
  notes.push(...found);
}
/* 回到車種組成，下面幾段幾何檢查以它為準。 */
await gotoPage(page, PAGES.composition);
await page.waitForTimeout(400);
ok(
  "四張圖旁邊都有解讀說明（車種組成拆組時一組一段）",
  notes.length >= 4,
  `實測 ${notes.length} 段：${notes.map((n) => n.heading).join("／")}`,
);
for (const note of notes)
  ok(
    `「${note.heading}」的說明有講出內容`,
    note.paragraphs >= 2 && note.text.length >= 40,
    `${note.paragraphs} 段、${note.text.length} 字`,
  );

/*
 * 說明裡的數字必須與畫面上那一份資料一致。
 * 文字與圖分岔的時候，被念出來、被抄進報告的是文字。
 */
const consistency = await page.evaluate(() => {
  /*
   * ⚠️ 稽核表 ① 之後，多個調查點時面板裡有**好幾組**圓環，
   *   每一組有自己的明細、自己的圓心數字與自己的說明。
   *   量的時候要**鎖定同一組**——跨組拿數字比對，比出來的當然不一樣，
   *   而那不是「文字與圖分岔」，是測試自己在比兩件不同的事。
   */
  const panel =
    document.querySelector(".panel.composition .donut-day") ||
    document.querySelector(".panel.composition");
  if (!panel) return null;
  const items = [...panel.querySelectorAll(".composition-list > div")].map(
    (row) => ({
      label: (row.querySelector("span")?.textContent || "").trim(),
      count: Number(
        (row.querySelector("small")?.textContent || "").replace(/[^\d]/g, ""),
      ),
    }),
  );
  const top = items
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  const total = Number(
    (panel.querySelector(".donut strong")?.textContent || "").replace(
      /[^\d]/g,
      "",
    ),
  );
  const note = (
    panel.querySelector("[data-chart-note]")?.textContent || ""
  ).replace(/\s+/g, " ");
  return { top, total, note };
});
if (consistency?.top) {
  const totalText = consistency.total.toLocaleString("zh-TW");
  const topText = consistency.top.count.toLocaleString("zh-TW");
  ok(
    "車種組成說明裡的「最多的是…」與畫面上最大的那一項相同",
    consistency.note.includes(consistency.top.label),
    `畫面最大：${consistency.top.label}`,
  );
  ok(
    "車種組成說明裡的輛數與畫面上的數字相同",
    consistency.note.includes(topText),
    `畫面 ${topText} 輛`,
  );
  ok(
    "車種組成說明裡的總量與圓心的數字相同",
    consistency.note.includes(totalText),
    `圓心 ${totalText}`,
  );
}

/* 寬螢幕在右側、窄螢幕自動移到下方——使用者指定的排法。 */
const geometryAt = async (width) => {
  await page.setViewportSize({ width, height: 1050 });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const rows = [];
    for (const wrap of document.querySelectorAll(".chart-with-note")) {
      const main = wrap.querySelector(".chart-with-note-main");
      const note = wrap.querySelector("[data-chart-note]");
      if (!main || !note) continue;
      const m = main.getBoundingClientRect();
      const n = note.getBoundingClientRect();
      if (m.height < 4 || n.height < 4) continue;
      rows.push({
        beside: n.left >= m.right - 2,
        below: n.top >= m.bottom - 2,
        overlapsMain: !(n.left >= m.right - 2 || n.top >= m.bottom - 2),
      });
    }
    return rows;
  });
};
/*
 * ⚠️ 這裡量的是「**包在 .chart-with-note 裡的**說明」，目前是三段：
 * 車種組成、每小時型態、同季平假日。
 *
 * 歷季趨勢那一張的說明是**講稿**（.trend-script，四個小節、四百多字），
 * 它刻意**橫跨整個面板寬度放在圖的下方**，不是擠在圖的右邊——
 * 那麼長的一段放右欄會被壓成很窄的一條。所以它不在這個幾何檢查裡，
 * 而是由上面「四張圖旁邊都有解讀說明」那一項確認它存在且有內容。
 *
 * ⚠️ 這不是「少驗一段」：三段的排法要驗，第四段的**存在與內容**也要驗，
 * 只是兩者用不同的方式驗，因為它們本來就長得不一樣。
 */
/*
 * ⚠️ X-63：三段「包在 .chart-with-note 裡」的說明現在分屬三個大分頁
 *   （車種組成／24小時型態／同季平假日），所以要**逐頁**量。
 *   停在一頁量的話只量得到一段，`length === 3` 會直接紅——
 *   而紅的是量法，不是排版。
 */
const SIDE_NOTE_PAGES = [
  [PAGES.composition, "車種組成"],
  [PAGES.hourly, "24小時型態"],
  [PAGES.comparison, "同季平假日"],
];
const geometryAcross = async (width) => {
  const rows = [];
  for (const [pageId] of SIDE_NOTE_PAGES) {
    await gotoPage(page, pageId);
    rows.push(...(await geometryAt(width)));
  }
  return rows;
};
/*
 * ⚠️ 段數不可以寫死 3。稽核表 ① 之後，車種組成在多個調查點時
 *   **一組一段**，所以這裡是 2＋1＋1＝4。寫死數字的話，
 *   日後再多一個調查點又會紅，而紅的仍然是量法不是排版。
 *   改成「至少要量到三頁各一段」，重點是**每一段都排對**。
 */
const wide = await geometryAcross(1600);
ok(
  "寬螢幕（1600px）圖旁說明都排在圖的右側",
  wide.length >= 3 && wide.every((row) => row.beside),
  `右側 ${wide.filter((r) => r.beside).length}／${wide.length}`,
);
const narrow = await geometryAcross(1000);
ok(
  "窄螢幕（1000px）圖旁說明都自動移到圖的下方",
  narrow.length >= 3 && narrow.every((row) => row.below),
  `下方 ${narrow.filter((r) => r.below).length}／${narrow.length}`,
);
await page.setViewportSize({ width: 1500, height: 1050 });
await page.waitForTimeout(500);

/* ════════════════════════════════════════════════════════════════
 * 三、匯出的圖上不可以有說明文字
 * ════════════════════════════════════════════════════════════════ */
console.log("\n══ 三、匯出的圖上不可以有說明文字 ══");

/*
 * 匯出走的是 <canvas> 與 Excel 原生圖表，說明文字是 DOM 的一部分，
 * 本來就不會被帶進去。這裡把「本來就不會」變成量得出來的事實：
 * 任何一段說明都不可以落在畫布或圖本體的範圍內。
 * 有人哪天把說明搬進 .chart-with-note-main，這一項就會紅。
 */
const overlaps = await page.evaluate(() => {
  const hits = [];
  const boxes = [...document.querySelectorAll("canvas, svg.trend-svg")].map(
    (el) => ({ el, box: el.getBoundingClientRect() }),
  );
  for (const note of document.querySelectorAll("[data-chart-note]")) {
    const n = note.getBoundingClientRect();
    if (n.width < 2 || n.height < 2) continue;
    if (note.closest(".chart-with-note-main")) hits.push("說明被放進圖本體裡");
    for (const { box } of boxes) {
      if (box.width < 2 || box.height < 2) continue;
      const intersects =
        n.left < box.right &&
        n.right > box.left &&
        n.top < box.bottom &&
        n.bottom > box.top;
      if (intersects) hits.push(`說明與畫布重疊（${Math.round(box.width)}px）`);
    }
  }
  return hits;
});
ok(
  "說明文字全部落在圖本體與畫布之外",
  overlaps.length === 0,
  overlaps.slice(0, 3).join("；"),
);

/* ════════════════════════════════════════════════════════════════
 * 四、文字不可以被底色蓋住（WCAG AA 4.5:1）
 * ════════════════════════════════════════════════════════════════
 *
 * GPT 複查全日交通量時列出的待辦：「按鈕文字對比量測 ☐ 尚未量」。
 * 這一段就是那一項——量的是**算繪之後的實際顏色**，比對的是第一層
 * 不透明的祖先底色，不是原始碼裡寫了什麼。
 */
console.log("\n══ 四、文字對比（AA 4.5:1）══");

/*
 * ⚠️ 分頁式版面要**逐頁量**。只量目前這一頁，另外四頁的文字對比等於沒驗。
 * 下面把量測包成函式，再對五個分頁各跑一次、把結果合起來。
 */
const contrastOf = () =>
  page.evaluate(() => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const parse = (color) => {
    const m = String(color).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lum = (c) =>
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const backgroundOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a >= 0.95) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  /*
   * 量**整頁**，不是只量這次新增的那幾個元件。GPT 的待辦寫的是
   * 「按鈕文字對比量測 ☐ 尚未量」，只量新元件等於沒回答那一題。
   */
  const targets = [
    ...document.querySelectorAll(".content *, .topbar *, .sidebar *"),
  ];
  const bad = [];
  let measured = 0;
  for (const el of targets) {
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    /* 只量真的有自己文字的節點，否則會量到純容器。 */
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");
    if (!own) continue;
    const fg = parse(style.color);
    if (!fg || fg.a < 0.95) continue;
    measured += 1;
    const value = ratio(fg, backgroundOf(el));
    if (value < 4.5)
      bad.push(
        `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 22)}「${own.slice(0, 12)}」${value.toFixed(2)}:1`,
      );
  }
  return { measured, bad };
  });

/* 五個分頁各量一次，合起來才是整個系統的文字對比。 */
const contrast = { measured: 0, bad: [] };
for (const zone of [TABS.import, TABS.settings, TABS.kpi, TABS.charts, TABS.output]) {
  await gotoTab(page, zone);
  await page.waitForTimeout(300);
  const one = await contrastOf();
  contrast.measured += one.measured;
  contrast.bad.push(...one.bad.map((item) => `${zone}｜${item}`));
}
/*
 * ⚠️ 這一項是「這個守門不是空跑」的證明。對比量測最典型的假綠就是
 * 選擇器抓到 0 個元素卻回報全部通過——服務水準那一支踩過一次。
 *
 * ⚠️ v20.64 起這是**五個分頁的合計**。改成分頁式之後一次只有一頁在 DOM 裡，
 * 只量當前頁的話節點數只剩五分之一，門檻就得往下調——那才是放寬檢查。
 * 改成逐頁量再加總，涵蓋範圍反而比以前**大**（以前只量得到當時渲染的那一份），
 * 所以門檻可以維持在同一個量級。
 */
ok(
  "有量到足夠多的文字節點（不是空跑）",
  contrast.measured >= 400,
  `實測 ${contrast.measured} 個節點`,
);
ok(
  "所有量到的文字對比都 ≥ 4.5:1",
  contrast.bad.length === 0,
  contrast.bad.slice(0, 5).join("；"),
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
