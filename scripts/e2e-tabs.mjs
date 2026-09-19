/*
 * ══════════════════════════════════════════════════════════════════
 *  五個分頁：真的換頁，而且共用的東西不可以跟著換掉
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-09 指名的改版：
 *   「路口轉向那樣的方式，點一個頁面，如同換了一個分頁，
 *     **這個畫面獨屬於它**，我反而不喜歡全日交通量那樣，
 *     所有資訊都一直往下滾動下來察看」
 *
 * ── 這一支釘住四件事 ──────────────────────────────────────────
 *
 * 一、**每一頁的招牌內容真的在那一頁**（原本 rendered-html 那一串斷言搬到這裡）。
 * 二、**別頁的內容不在 DOM 裡**——這是「真的換頁」的反面證明。
 *     少了它，把 {view === ...} 改成永遠為真也會全部通過。
 * 三、**工具列與篩選列在五頁都看得到**，而且**在任何一頁改、其他頁跟著變**。
 *     這是使用者的設計本意（待修正事項第 13 項），換頁最容易踩壞的就是這個。
 * 四、**匯出與結論草稿讀的是資料層，不是畫面**。
 *     換頁之後別頁的面板沒有被渲染，如果有任何一處是從 DOM 撈數字的，
 *     匯出就會只剩當前頁的內容——而且**匯出檔看起來完全正常**，
 *     只是少了幾張表，這是最難發現的一種。
 *
 * ── ⚠️ 刻意迴避的假通過陷阱 ────────────────────────────────────
 *
 * ・只驗「按了按鈕會 active」不夠——那只證明按鈕會變色，沒證明畫面換了。
 * ・只驗「新頁看得到東西」不夠——舊的捲動式做法也全部看得到。
 *   一定要**同時**驗「別頁看不到」。
 * ・篩選連動只驗「改得動」不夠，要驗**換頁之後值還在、而且真的生效**。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, PAGES, gotoTab, gotoPage, gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".pdf": "application/pdf", ".docx": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
await new Promise((r) => server.listen(8121, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8121/");
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(800);

/* ── 建計畫並灌入兩份真實樣本 ─────────────────────────────── */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("分頁測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);
for (const [name, quarter] of [
  ["115T1-01_中山路.xlsx", "115Q1"],
  ["115T1-02_中正路口.xlsx", "115Q1"],
]) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(quarter);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, name)),
  });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3000); }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!(await closer.count())) break;
    await closer.click(); await page.waitForTimeout(500);
  }
}

console.log("\n══ 一、每一頁的招牌內容在自己那一頁，而且只在那一頁 ══");

/*
 * 每一頁一組「招牌字」。這幾個字原本在 tests/rendered-html.test.mjs 裡，
 * 改成真的換頁之後伺服器端只算得出第一頁，所以搬到這裡逐頁點過去驗。
 */
/*
 * 每一個大分頁**自己**那幾塊的 id（與 PAGE_ZONES 一致）。
 * ⚠️ 手寫的清單會漂移，所以下面那條 ⓪ 會拿側欄的 data-anchor 對一次帳——
 *   漏了一塊就會紅，不會默默失效。
 */
const PAGE_BLOCKS = {
  [PAGES.projects]: ["block-projects"],
  [PAGES.quarter]: ["block-quality"],
  [PAGES.settings]: ["card-road-master", "card-geometry", "card-vehicle-class", "block-pcu"],
  [PAGES.kpi]: ["card-kpi-daily", "card-kpi-pcu24", "card-kpi-peak"],
  [PAGES.composition]: ["block-composition"],
  [PAGES.hourly]: ["block-hourly"],
  [PAGES.trend]: ["block-trend"],
  [PAGES.comparison]: ["block-comparison"],
  [PAGES.detail]: ["block-detail"],
  [PAGES.period]: ["periodAnalysis"],
  [PAGES.delivery]: ["conclusionStudio"],
  [PAGES.batch]: ["block-chart-png"],
  [PAGES.check]: ["quality-run", "quality-summary", "quality-thresholds", "quality-reasons"],
  [PAGES.backup]: ["maintenance-delete-quarter", "backup-one", "backup-all", "backup-restore", "block-clear-local"],
};
/** 對每一頁而言，「別頁的那幾塊」是哪些。 */
const OTHER_BLOCKS = Object.fromEntries(
  Object.keys(PAGE_BLOCKS).map((id) => [
    id,
    Object.entries(PAGE_BLOCKS)
      .filter(([other]) => other !== id)
      .flatMap(([, ids]) => ids),
  ]),
);

/*
 * ⚠️ X-63（2026-09-17）：這一份原本是**逐分區**的。四與五（以及一）
 *   各自拆成好幾個大分頁之後，「一個分區的招牌字」已經不成立——
 *   同一區的四張圖現在分屬四頁，拿它們當同一組招牌字會直接紅。
 *
 *   改成**逐大分頁**：每一頁挑一句它自己才有的字。
 *   這比原本那一份更嚴：原本只要那一區任何一頁有那個字就算過，
 *   現在是「這一頁必須有、而且別頁不可以有」。
 */
const PAGE_MARKS = [
  /*
   * ⚠️ 招牌字要挑**這一頁上真的看得到**的字。
   *   「上傳調查資料」原本是分區 subtitle 裡的字，抬頭不再印 subtitle 之後
   *   它就不在畫面上了——改用這一塊自己的標題。
   */
  [PAGES.projects, "建立與管理計畫", ["建立與管理計畫"]],
  [PAGES.quarter, "本季總覽", ["本季總覽"]],
  [PAGES.settings, "參數設定", ["PCU 當量係數", "路段／路口主檔管理", "道路與流向管理", "車種分類與當量管理", "路口轉向係數", "Excel 相容性"]],
  [PAGES.kpi, "資料檢視", ["尖峰小時當量交通量", "24小時PCU", "全日實際交通量"]],
  [PAGES.composition, "車種組成", ["車種組成"]],
  [PAGES.hourly, "24小時型態", ["每小時實際交通量與PCU"]],
  [PAGES.trend, "歷季分析", ["歷季"]],
  [PAGES.comparison, "同季平假日", ["各路段平日與假日比較"]],
  [PAGES.detail, "可追溯明細", ["可追溯明細"]],
  /*
   * ⚠️ 2026-09-13：「全調查時段尖峰／上午尖峰小時／下午尖峰小時」這三個字
   *   **不能當招牌字**——主工具列新增了「調查時段」下拉，那三個字現在是
   *   全站共用的選項，每一頁都看得到。拿共用元件上的字當招牌字，
   *   會把「該頁獨有」驗成「到處都有」。
   */
  [PAGES.period, "時段車種分析", ["時段車種分析（獨立區塊）"]],
  [PAGES.delivery, "成果交付", ["結論草稿產生器"]],
  [PAGES.batch, "批次輸出", ["一鍵下載全部圖檔"]],
  [PAGES.check, "資料異常檢查", ["異常提醒門檻"]],
  [PAGES.backup, "還原與備份", ["備份全部計畫"]],
];

for (const [pageId, label, marks] of PAGE_MARKS) {
  await gotoPage(page, pageId);
  const text = await page.locator(".content").innerText();
  const missing = marks.filter((mark) => !text.includes(mark));
  ok(`「${label}」頁看得到自己的內容`, missing.length === 0,
    missing.length ? `少了：${missing.join("、")}` : `${marks.length} 項都在`);
}

console.log("\n══ 二、別頁的內容不可以還留在 DOM 裡（真的換頁的反面證明）══");

/**
 * 這一頁「內容」的文字，**不含指引性的說明句**。
 *
 * ⚠️ 為什麼要扣掉那幾種說明：它們的用途正是**指名別頁**
 *   （「這三張卡是整個調查點的合計……要看各支線的分佈請到『可追溯明細』」）。
 *   把它們算進來的話，一句正確而且必要的指引會被判成「別頁的內容洩漏過來」——
 *   而修法會變成「把那句話刪掉」或「把那個名字加進白名單」，
 *   前者是拿掉對使用者有用的東西，後者會讓真正的洩漏也一起漏掉。
 *   2026-09-16 實測：X-28 的「已選 N 個調查點，這張卡不給數字……
 *   或到『可追溯明細』逐調查點查看」就踩到這一條。
 */
const pageBodyText = () =>
  page.evaluate(() => {
    const root = document.querySelector(".content");
    if (!root) return "";
    const skip = [
      ...root.querySelectorAll(
        ".chart-inapplicable, .kpi-overflow-note, .chart-detach-note, .status-effect",
      ),
    ];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let text = "";
    let node;
    while ((node = walker.nextNode()))
      if (!skip.some((element) => element.contains(node.parentElement)))
        text += " " + node.nodeValue;
    return text;
  });

for (const [pageId, label] of PAGE_MARKS.map((row) => [row[0], row[1]])) {
  await gotoPage(page, pageId);
  const text = await pageBodyText();
  const leaked = PAGE_MARKS
    .filter((row) => row[0] !== pageId)
    .flatMap((row) => row[2].map((mark) => [row[1], mark]))
    /*
     * ⚠️ 有幾個字在別頁**合法地**出現，不能拿它們當洩漏證據，
     * 否則會是一條「永遠紅」的假斷言：
     *  ・「車種組成」是圖表頁的面板名，也是匯出勾選項的名字
     *  ・「全日實際交通量」是歷季趨勢的**指標名稱**（下拉選單裡的一項），
     *    同時也是關鍵數字頁的 KPI 名稱——同名不等於同一塊東西
     *  ・「歷季」「資料匯入」在導覽與說明文字裡到處都是
     *  ・「每小時實際交通量與PCU」是圖表頁的圖名，同時也是**產出頁**
     *    「一鍵下載全部圖檔」那份清單裡的項目名——清單列的是「要下載哪幾張圖」，
     *    出現在產出頁是它本來就該在的地方，不是洩漏。
     *    （2026-09-12 實測：這一條會讓 e2e-tabs 出現假紅，程式其實是對的。）
     */
    .filter(
      ([, mark]) =>
        ![
          "車種組成",
          "歷季",
          "資料匯入",
          "全日實際交通量",
          "每小時實際交通量與PCU",
          /*
           * ⚠️ X-63 之後追加的三個，全部是**合法的跨頁指引**，不是洩漏：
           *  ・「可追溯明細」：好幾塊的說明句都寫著「要看各支線的分佈請到
           *    『可追溯明細』或『時段車種分析』」——那是在告訴使用者
           *    該去哪裡，把它判成洩漏會逼人把有用的指引刪掉。
           *  ・「各路段平日與假日比較」：它同時是**批次輸出頁**那份
           *    「要下載哪幾張圖」清單裡的項目名。清單列的就是圖名，
           *    出現在那裡是它本來就該在的地方。
           *  ・「上傳調查資料」：已於 2026-09-17 從頁面抬頭拿掉
           *    （見 PageHeading 的註解），留在這裡是防止有人又把
           *    分區 subtitle 接回抬頭。
           */
          "可追溯明細",
          "各路段平日與假日比較",
          "上傳調查資料",
        ].includes(mark),
    )
    .filter(([, mark]) => text.includes(mark));
  ok(`停在「${label}」時看不到別頁的招牌內容`, leaked.length === 0,
    leaked.length ? `洩漏：${leaked.map(([p, m]) => `${p}的「${m}」`).join("、")}` : "乾淨");
  /*
   * ⚠️ 上面那一條是**字串**比對，所以一定要有白名單（合法的跨頁指引）。
   *   白名單愈長，它擋得住的東西就愈少。
   *   這一條改用**區塊 id**：別的大分頁那幾塊不可以在 DOM 裡。
   *   id 不會出現在說明句裡，所以不需要任何例外——
   *   真正的洩漏一定被這一條抓到。
   */
  const strays = await page.evaluate(
    (ids) => ids.filter((id) => !!document.getElementById(id)),
    OTHER_BLOCKS[pageId],
  );
  ok(
    `⚠️ 停在「${label}」時，別頁的區塊不在 DOM 裡`,
    strays.length === 0,
    strays.join("、"),
  );
}

console.log("\n══ 三、工具列與篩選列在五頁都在，而且五頁共用同一份條件 ══");

for (const [pageId, label] of PAGE_MARKS.map((row) => [row[0], row[1]])) {
  await gotoPage(page, pageId);
  const shared = await page.evaluate(() => ({
    toolbar: !!document.querySelector(".toolbar"),
    filters: !!document.querySelector(".filters"),
    /* ⚠️ 只數「分頁」那五顆（有 data-goto 的），不要把歸類底下的子項目
         也數進來——v20.64 起側欄每個歸類底下還會列出該頁的區塊。 */
    nav: document.querySelectorAll(".side-nav button[data-goto]").length,
    /*
     * ⚠️ X-73 起側欄是**手風琴**：小分頁只有目前那一頁才展開。
     *   所以要數的是**大分頁**（那一層一律列出），不是小分頁——
     *   數小分頁的話，每一頁的數字都不一樣，而那是刻意的行為。
     */
    pages: document.querySelectorAll(".side-nav button[data-goto-page]").length,
    items: document.querySelectorAll(".side-nav .side-nav-item").length,
  }));
  ok(`「${label}」頁仍有工具列與篩選列`,
    shared.toolbar && shared.filters && shared.nav === 5,
    `工具列=${shared.toolbar}／篩選列=${shared.filters}／分頁鈕=${shared.nav}`);
  /*
   * 使用者 2026-09-10：「只有歸類，看不出歸類下面有什麼資料」——
   * 那一句講的是**分區底下看不到大分頁**，所以大分頁那一層在每一頁都要看得到。
   * X-73（2026-09-17）之後小分頁改成只展開目前那一頁的，
   * 兩件事並不衝突，但這一條要改數大分頁。
   */
  ok(`「${label}」頁側欄看得到歸類底下的大分頁`,
    shared.pages >= 10,
    `大分頁 ${shared.pages} 個、目前展開的小分頁 ${shared.items} 個`);
}

/* 在「參數設定」頁把日別改成假日，換到「關鍵數字」頁必須跟著變。 */
await gotoTab(page, TABS.settings);
const dayPicker = page.locator('.filters label:has-text("日別") select');
await dayPicker.selectOption("假日");
await page.waitForTimeout(600);
await gotoTab(page, TABS.kpi);
const afterSwitch = await page.evaluate(() => {
  const select = document.querySelector(".filters select:nth-of-type(1)");
  void select;
  const labels = [...document.querySelectorAll(".filters label")];
  const day = labels.find((el) => el.textContent.startsWith("日別"));
  return {
    day: day?.querySelector("select")?.value ?? "",
    kpiNote: document.querySelector(".kpi small")?.textContent ?? "",
  };
});
ok("在一頁改日別，換頁之後條件還在", afterSwitch.day === "假日", `目前=${afterSwitch.day}`);
ok("換頁之後的數字真的跟著那個條件走（不是只有下拉變了）",
  afterSwitch.kpiNote.includes("假日"), `KPI 副標=${afterSwitch.kpiNote}`);
/* 改回平日，後面的匯出比對才是預設條件。 */
await gotoTab(page, TABS.settings);
await dayPicker.selectOption("平日");
await page.waitForTimeout(600);

console.log("\n══ 四、匯出與結論草稿讀的是資料層，不是目前這一頁 ══");

/*
 * ⚠️ 這一項是換頁改版**最危險**的地方。
 * 舊版所有面板都在 DOM 裡，只要有一處匯出是從畫面撈的，過去都不會出事；
 * 換頁之後那一處就會只匯出當前頁——而且匯出檔開得起來、看起來正常，
 * 只是少了幾張工作表。所以一定要**停在最不相干的那一頁**再匯出。
 */
await gotoTab(page, TABS.kpi);
await page.locator('.toolbar button:has-text("報表批次輸出中心")').first().click();
await page.waitForTimeout(700);
const download = page.waitForEvent("download", { timeout: 60000 });
await page.locator('.modal-backdrop button:has-text("匯出")').last().click();
const file = await download.catch(() => null);
ok("停在「關鍵數字」頁也匯得出 Excel", !!file, file ? await file.suggestedFilename() : "沒有下載事件");
if (file) {
  /*
   * ⚠️ 不可以用 download.path()，也不要先 saveAs 到 /tmp 再讀——
   * 兩種寫法實測都拿到 "Cannot access file"（暫存檔在事件回傳之後隨時會被清掉，
   * 而 saveAs 的完成時機又和後面的讀取競速）。
   * 直接把串流讀成 Buffer 最穩，完全不碰檔案系統。
   */
  const chunks = [];
  const stream = await file.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  const XLSX = await import("xlsx");
  const wb = XLSX.read(Buffer.concat(chunks), { type: "buffer" });
  const names = wb.SheetNames;
  /* 這三張分別屬於第二、四、五頁——都不是匯出當下停留的那一頁。 */
  for (const sheet of ["本季交通量及PCU", "歷季趨勢", "PCU係數"])
    ok(`匯出檔含「${sheet}」（它屬於別的分頁）`, names.includes(sheet), names.join("／"));
  ok("匯出的工作表數量不是只剩當前頁", names.length >= 8, `${names.length} 張`);
}
for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
  if (!(await closer.count())) break;
  await closer.click(); await page.waitForTimeout(400);
}

/* 結論草稿：它引用多個面板的數字，不可以因為那些面板沒被渲染而變空。 */
/* X-63：結論草稿現在在「成果交付」那個大分頁底下。 */
await gotoPage(page, PAGES.delivery);
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
const expand = page.locator('#conclusionStudio button:has-text("展開")');
if (await expand.count()) { await expand.first().click(); await page.waitForTimeout(1200); }
const draftText = await page.locator("#conclusionStudio").innerText();
ok("結論草稿有實際內容（不是因為別頁沒渲染而變空）",
  draftText.length > 200 && !/NaN|undefined/.test(draftText),
  `${draftText.length} 字`);

console.log("\n══ 五、換頁之後要回到頁首 ══");
/*
 * ⚠️ 這一節要驗的是「**第一次**進某一頁時從最上面開始」。
 *
 *   但 useViewScrollMemory 的設計是「回頭再進去接著上次看」——
 *   前面幾節已經進過資料檢視頁、而且捲動過，那個位置**被記下來了**，
 *   所以再進去時還原到 128px 是**正確行為**，不是缺陷。
 *   （2026-09-16 實測：單獨跑這一支會過、跟著整串跑會紅，
 *     紅的原因與這一節要驗的事情無關。）
 *
 *   捲動記憶刻意不寫 localStorage（重整＝我想重來一次），
 *   所以 reload 一次就等於清空記憶，之後每一頁都算第一次進來。
 */
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await gotoBlock(page, "block-quality");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(300);
await gotoTab(page, TABS.kpi);
/*
 * ⚠️ 2026-09-16：這一條原本是「換頁後等 250ms 就量」，**會偶爾紅**
 *   （連跑兩次，一次 scrollY=128、一次 0，程式沒有任何改動）。
 *   成因：捲動位置是由 useViewScrollMemory 在換頁後**非同步**還原的，
 *   機器慢一點時量到的是還原前的值。
 *
 * ⚠️ 修法是**等到它穩定**，不是把門檻放寬——放寬等於把這條守門作廢。
 *   偶爾紅的守門比沒有守門更糟：下一次真的壞掉時，
 *   看到紅字的人會先猜「又是那個抖動」。
 */
/*
 * ⚠️ 2026-09-16 再修一次：「連續兩次一樣就當作穩定」**還是會偶爾紅**
 *   （實測一次 128、下一次 0，程式沒改）。還原是非同步的，
 *   兩次取樣之間它可能剛好都還沒動，於是把「還沒開始還原」誤判成「穩定」。
 *
 * ⚠️ 修法仍然是**等得更確實**，不是放寬門檻：
 *   ① 先至少等 400ms（讓還原有機會發生）；
 *   ② 之後要**連續三次**取樣都一樣才算穩定。
 *   放寬成「小於某個數就算過」等於把這條守門作廢——它要守的正是
 *   「停在原本的捲動位置」這件事，而那個值本來就可能很小。
 */
const scrollY = await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 400));
  let last = window.scrollY;
  let same = 0;
  for (let i = 0; i < 30; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (window.scrollY === last) {
      same += 1;
      if (same >= 3) return last;
    } else {
      same = 0;
      last = window.scrollY;
    }
  }
  return last;
});
ok("從很長的頁切到很短的頁，畫面回到頂端（不是停在原本的捲動位置）",
  scrollY <= 4, `scrollY=${scrollY}`);

/*
 * ══════════════════════════════════════════════════════════════════
 *  六、同一頁上的側欄項目，點下去要「看得出有反應」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11 實測：「二 參數設定，下面三個分頁，我各點一下，
 * 畫面都沒反應，後來我才看出來，因為這三個的畫面是同一個，
 * 一開始以為是壞掉。」
 *
 * 這一段釘住三件事：
 *   ① 每一個項目指向**不同**的卡片（以前有兩個指向同一個錨點，點了當然一樣）
 *   ② 點下去那張卡片真的被點名（拿到 .is-focused）
 *   ③ 點下一個時，**上一張要放掉**——不然點過三次就三張全亮，等於沒標
 *
 * ⚠️ 刻意**不**驗顏色值。顏色會調，但「一次只有一張被點名」是行為。
 *
 * ── 2026-09-11 補強：要點的清單**從畫面上撈，不可以寫死** ──────────
 *
 * 使用者：「點本季總覽，對應的欄位邊框沒有像參數設定各分頁那樣有顯眼的提示，
 *          真的不知道本季總覽是要看什麼」。
 *
 * 這一段原本只列了「二 參數設定」與「三 資料檢視」兩頁的項目，**寫死在
 * 陣列裡**——「一 資料匯入」的「本季總覽」從頭到尾沒被點過，所以那個區塊
 * 根本沒掛 focusClass 也沒人發現。寫死清單的測試只保證「我想到的那幾個」
 * 正常，新加的項目永遠是漏網的那一個。
 *
 * 改成掃側欄上**全部**的錨點項目（有 .side-nav-mark 的是開視窗／直接下載，
 * 不屬於這一段）。以後再加項目，不用改這支測試就自動被納管。
 *
 * ⚠️ 另外要驗**外框真的畫得出來**（outline-width > 0），不能只驗
 *   class 掛上去了。這次的第二層原因就是 CSS 寫成
 *   `.kpi.is-focused, .pcu-settings.is-focused, …`——class 名稱在 CSS 裡
 *   找得到（類別覆蓋掃描器因此過關），但它綁在別的元素上，
 *   .quality-strip 掛了 is-focused 一樣什麼都不會發生。
 */
console.log("\n══ 六、同一頁上的側欄項目要看得出反應 ══");
const ZONE_IDS = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".side-nav-group > button[data-goto]")).map(
    (el) => el.getAttribute("data-goto"),
  ),
);
ok("前置：五個分區都在側欄上", ZONE_IDS.length === 5, ZONE_IDS.join("、"));
let anchorItemsChecked = 0;
for (const zone of ZONE_IDS) {
  await gotoTab(page, zone);
  /*
   * 這一頁有哪些「錨點」項目——由畫面決定，不是由這支測試決定。
   * 有 .side-nav-mark 的是開視窗（→）或直接下載（↓），不在這一段的範圍。
   */
  const items = await page.evaluate(
    (zoneId) =>
      Array.from(
        document.querySelectorAll(
          `.side-nav-group:has(button[data-goto="${zoneId}"]) .side-nav-item`,
        ),
      )
        .filter((el) => !el.querySelector(".side-nav-mark"))
        .map((el) => el.getAttribute("data-goto-item")),
    zone,
  );
  if (!items.length) {
    console.log(`  （${zone} 沒有錨點項目，略過）`);
    continue;
  }
  anchorItemsChecked += items.length;
  const focused = [];
  for (const label of items) {
    await page.locator(`.side-nav-item[data-goto-item="${label}"]`).first().click();
    await page.waitForTimeout(350);
    focused.push(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll(".is-focused"))
          .map((el) => {
            /* 掛上 class 不等於看得見——外框寬度 0 就是白做工。 */
            const width = parseFloat(
              getComputedStyle(el).outlineWidth || "0",
            );
            return width > 0 ? el.id || "(無id)" : `${el.id || "(無id)"}!無外框`;
          })
          .join("+"),
      ),
    );
  }
  ok(
    `${zone}：每一個項目點下去都有一張卡片被點名`,
    focused.every((id) => Boolean(id)),
    items.map((label, i) => `${label}→${focused[i] || "（沒有反應）"}`).join("；"),
  );
  ok(
    `${zone}：被點名的那一張**畫得出外框**（CSS 真的吃到）`,
    focused.every((id) => !id.includes("!無外框")),
    items.map((label, i) => `${label}→${focused[i]}`).join("；"),
  );
  ok(
    `${zone}：每一個項目點名的是**不同**的卡片`,
    new Set(focused).size === items.length,
    focused.join(" / "),
  );
  ok(
    `${zone}：同一時間只有一張被點名（點下一個時上一張要放掉）`,
    focused.every((id) => !id.includes("+")),
    focused.join(" / "),
  );
  /*
   * 側欄那一顆自己也要亮，否則使用者不知道被框起來的是不是他剛點的那一個。
   * ⚠️ 比對的是**剛剛點的最後一個**，不可以寫死某個標題——
   *   這段現在跑遍五個分區，寫死等於只有最後一頁會對。
   */
  const lastLabel = items[items.length - 1];
  const navCurrent = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".side-nav-item.current")).map((el) =>
      el.getAttribute("data-goto-item"),
    ),
  );
  ok(
    `${zone}：側欄上被點到的那一顆也會亮起來，而且只有一顆`,
    navCurrent.length === 1 && navCurrent[0] === lastLabel,
    `亮著：${navCurrent.join("、") || "（一顆都沒亮）"}，剛點的是「${lastLabel}」`,
  );
}
ok(
  "這一段真的掃過側欄上全部的錨點項目（不是寫死的那幾個）",
  anchorItemsChecked >= 9,
  `共點過 ${anchorItemsChecked} 個錨點項目`,
);

/*
 * ══════════════════════════════════════════════════════════════════
 *  七、換計畫不必滑到側欄，而且計畫變多不會把導覽擠掉
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「當管理的計畫變多時，上方計畫堆疊變的很長，有解決辦法嗎？」
 *   「我在 A 計劃看表格資料時，如果想切換到 B 計畫，上方的功能列是無法
 *     切換計畫的（交通服務水準的程式可以靠上方功能列切換計畫），
 *     我必須滑到管理計畫區，去點選想要看的計畫，這樣有點不便利。」
 *
 * ⚠️ 側欄清單那一項一定要驗「高度 > 0」。
 *   第一版我只寫了 max-height，結果在 flex 欄向的側欄裡被壓成
 *   **0 高度整個消失**（實測 7 個計畫：height=0、scrollHeight=581）。
 *   只驗「沒有超過上限」的話，消失了也會綠燈——那是最糟的假通過。
 */
console.log("\n══ 七、換計畫的便利性 ══");
const switcher = page.locator("#projectSwitch");
ok("工具列有「切換計畫」下拉（三支統一）", (await switcher.count()) > 0);
if (await switcher.count()) {
  /* 先多建幾個計畫，才量得出「計畫變多」時的行為 */
  for (let i = 1; i <= 6; i += 1) {
    await page.locator(".sidebar-heading .icon-button").first().click();
    await page.waitForTimeout(350);
    const inputs = page.locator(".modal-backdrop .modal input");
    await inputs.nth(0).fill(`側欄測試${i}`);
    if ((await inputs.count()) > 1) await inputs.nth(1).fill(`Z${900 + i}`);
    await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
    await page.waitForTimeout(450);
    for (let k = 0; k < 4 && (await page.locator(".modal-backdrop").count()); k += 1) {
      const c = page
        .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
        .first();
      if (!(await c.count())) break;
      await c.click();
      await page.waitForTimeout(250);
    }
  }
  const metrics = await page.evaluate(() => {
    const nav = document.querySelector(".side-nav");
    return {
      sidebarCards: document.querySelectorAll(".sidebar .project-card").length,
      navTop: Math.round(nav.getBoundingClientRect().top),
      options: document.querySelector("#projectSwitch").options.length,
    };
  });
  ok("前置：真的建了很多計畫（不然下面幾項量不到東西）", metrics.options >= 6, `${metrics.options} 個`);
  /*
   * ⚠️ 這一條是使用者 2026-09-11 指名的做法：
   *   「可以改成跟路口轉向程式一樣，計畫清單顯示在右側的計畫清單裡嗎？
   *     這樣點一下『建立與管理計畫』，就能在右側看到計劃清單，本身有滾動。」
   *   側欄只留**目前這一個**，導覽的位置從此與計畫數量無關。
   */
  ok(
    "側欄只留目前這一個計畫（不再堆疊）",
    metrics.sidebarCards === 1,
    `側欄有 ${metrics.sidebarCards} 張卡`,
  );
  ok(
    "計畫再多，分區導覽仍在畫面上方（位置與計畫數量無關）",
    metrics.navTop > 0 && metrics.navTop < 500,
    `導覽上緣 ${metrics.navTop}px`,
  );

  /* 「建立與管理計畫」那一頁：全部計畫都列得出來，而且清單自己會捲 */
  await page.locator('.sidebar-heading-link[data-goto-item="建立與管理計畫"]').first().click();
  await page.waitForTimeout(600);
  const portfolio = await page.evaluate(() => {
    const list = document.querySelector(".portfolio-list");
    if (!list) return null;
    return {
      rows: list.querySelectorAll(".portfolio-row").length,
      height: Math.round(list.getBoundingClientRect().height),
      scroll: list.scrollHeight,
      current: list.querySelectorAll(".portfolio-row.current").length,
      focused: document.querySelectorAll(".is-focused").length,
    };
  });
  ok("點「建立與管理計畫」會到那一頁，而且清單真的在", Boolean(portfolio), portfolio ? "" : "找不到 .portfolio-list");
  if (portfolio) {
    ok(
      "那一頁列出全部計畫（不是只有目前這一個）",
      portfolio.rows === metrics.options,
      `列出 ${portfolio.rows} 個 vs 下拉 ${metrics.options} 個`,
    );
    ok(
      "⚠️ 清單沒有被壓成 0 高度（flex 欄向 + overflow 的老坑）",
      portfolio.height > 100,
      `height=${portfolio.height}、scrollHeight=${portfolio.scroll}`,
    );
    ok(
      "清單有自己的捲動，不會把底下的區塊一路推下去",
      portfolio.height <= 440,
      `height=${portfolio.height}`,
    );
    ok(
      "只有一列標成「目前計畫」",
      portfolio.current === 1,
      `${portfolio.current} 列`,
    );
    ok("進到那一頁時該區塊會被點名", portfolio.focused === 1, `${portfolio.focused} 個 .is-focused`);
  }

  /* 用那一頁的「切換到這個」換人 */
  const before = (await page.locator(".project-title h2").innerText()).trim();
  const switchRow = page.locator('.portfolio-row:not(.current) button:has-text("切換到這個")').first();
  ok("非目前計畫的那幾列都有「切換到這個」", (await switchRow.count()) > 0);
  if (await switchRow.count()) {
    await switchRow.click();
    await page.waitForTimeout(700);
    const after = (await page.locator(".project-title h2").innerText()).trim();
    ok("在那一頁按「切換到這個」，標題真的換了", after !== before, `${before} → ${after}`);
  }

  /* 工具列下拉一樣換得動——兩個入口都要能用 */
  const beforeSelect = (await page.locator(".project-title h2").innerText()).trim();
  const values = await page.evaluate(() =>
    Array.from(document.querySelector("#projectSwitch").options).map((o) => o.value),
  );
  const current = await switcher.inputValue();
  const target = values.find((v) => v && v !== current);
  ok("前置：下拉裡有另一個可以切過去的計畫", Boolean(target), values.length + " 個選項");
  await switcher.selectOption(target);
  await page.waitForTimeout(700);
  const afterSelect = (await page.locator(".project-title h2").innerText()).trim();
  ok(
    "工具列下拉也換得動（新增「建立與管理計畫」頁不可以把它弄壞）",
    afterSelect !== beforeSelect,
    `${beforeSelect} → ${afterSelect}`,
  );
  ok(
    "換完之後側欄那張卡片顯示的是新的計畫",
    (await page.locator(".sidebar .project-card strong").innerText()).trim() === afterSelect,
    `側欄「${(await page.locator(".sidebar .project-card strong").innerText()).trim()}」vs 標題「${afterSelect}」`,
  );
}

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

await browser.close();
server.close();
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
