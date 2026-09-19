/*
 * 分頁導覽的共用助手。
 *
 * v20.64 把五個分區從「同一頁的錨點」改成**真的換頁**（使用者 2026-09-09 指名）。
 * 換頁之後，別頁的內容**不在 DOM 裡**，所以每一支 E2E 在碰某一頁的元素之前
 * 都必須先切到那一頁——否則 locator 會等到逾時，而錯誤訊息只會說
 *「找不到元素」，看不出真正的原因是「你在別頁」。
 *
 * ⚠️ 這裡刻意用 `data-goto` 屬性定位，不是用按鈕上的中文字。
 * 分頁名稱是會被改的（「多計畫管理」→「計畫管理」那次一口氣弄壞了 10 支腳本），
 * 而 zone id 是程式內部的識別碼，不會因為改文案而變。
 */

/** 五個**分區**的 id，順序與畫面上的一致。 */
export const TABS = {
  import: "zone-import",
  settings: "zone-settings",
  kpi: "zone-kpi",
  charts: "zone-charts",
  output: "zone-output",
};

/*
 * ══════════════════════════════════════════════════════════════════
 *  X-63：分區底下多了一層「大分頁」
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：「一個大分頁本身就是一個界面，不要與其他大界面共用畫面」。
 * 於是四與五（以及一）各自拆成好幾個大分頁，**別的大分頁的內容不在 DOM 裡**。
 *
 * ⚠️ 所以測試裡「切到某一區」已經不夠精確了——要切到**那一塊所在的大分頁**。
 *   gotoTab 仍然可用（它會落在那一區的第一個大分頁），但凡是要碰某一塊的，
 *   一律改用 gotoBlock()：它照 `data-anchor` 找側欄那一顆，
 *   不必在測試裡再維護一份「哪一塊在哪一頁」的對照表——
 *   那種表一定會漂移，而漂移的症狀是測試去了錯的頁、然後說功能壞了。
 */
/** 每一個分區的第一個大分頁（點分區標題就是去那裡）。 */
export const ZONE_FIRST_PAGE = {
  "zone-import": "page-projects",
  "zone-settings": "page-settings",
  "zone-kpi": "page-kpi",
  "zone-charts": "page-composition",
  "zone-output": "page-detail",
};

/** 大分頁的 id，給需要指名某一頁的測試用。 */
export const PAGES = {
  projects: "page-projects",
  quarter: "page-quarter",
  settings: "page-settings",
  kpi: "page-kpi",
  composition: "page-composition",
  hourly: "page-hourly",
  trend: "page-trend",
  comparison: "page-comparison",
  detail: "page-detail",
  period: "page-period",
  delivery: "page-delivery",
  batch: "page-batch",
  check: "page-check",
  backup: "page-backup",
};

/**
 * 切到指定分頁，並等它真的換過去。
 *
 * ⚠️ 不可以只 click 完就回傳。React 換頁是非同步的，緊接著下一行去找
 * 新頁的元素會有機率找不到——而那種失敗看起來像「功能壞了」，
 * 實際上只是還沒畫出來，是最浪費時間的一種假紅。
 */
export async function gotoTab(page, zoneId) {
  const button = page.locator(`.side-nav button[data-goto="${zoneId}"]`);
  if (!(await button.count()))
    throw new Error(`找不到分頁按鈕 ${zoneId}——分頁導覽是不是又改回捲動式了？`);
  await button.first().click();
  /*
   * ⚠️ X-63：點分區標題會落在**那一區的第一個大分頁**，
   *   所以要等的是那一頁的抬頭（id＝大分頁 id），不是分區 id——
   *   分區本身已經不是一個畫面，`getElementById("zone-charts")` 永遠是 null。
   */
  const first = ZONE_FIRST_PAGE[zoneId];
  if (!first) throw new Error(`不認得的分區 ${zoneId}`);
  await page.waitForFunction(
    ({ zone, page: pageId }) =>
      document
        .querySelector(`.side-nav button[data-goto="${zone}"]`)
        ?.classList.contains("active") && !!document.getElementById(pageId),
    { zone: zoneId, page: first },
    { timeout: 5000 },
  );
  /* 換頁會捲回頁首，等它停下來再讓呼叫端量座標。 */
  await page.waitForTimeout(250);
}

/**
 * 切到**某一塊所在的大分頁**。
 *
 * ⚠️ 照側欄的 `data-anchor` 找那一顆鈕——單一塊的大分頁會把錨點掛在
 *   大分頁按鈕自己身上（見 SectionNav 的 `only`），多塊的則在小分頁上，
 *   兩種都選得到。
 * ⚠️ 它會順便把那一塊「點名」（外框亮起來）並捲過去，與使用者真的用側欄
 *   點過去**完全一樣**——測試走的路徑和使用者走的是同一條。
 */
export async function gotoBlock(page, anchor) {
  /*
   * ⚠️ X-73 起側欄是**手風琴**：只有目前那一頁的小分頁會列出來
   *   （使用者指名比照另外兩支）。所以要點的那一顆可能**還不存在**——
   *   得先切到它所屬的大分頁，讓那一層展開，才選得到。
   *
   *   哪一頁擁有這個錨點？不能寫死對照表（一改就漂掉），
   *   改成**逐頁點過去找**：點一個大分頁 → 看看那一顆出現了沒。
   *   這正是使用者自己會做的事（在側欄上一頁一頁找），
   *   測試走的路徑因此仍然和使用者走的是同一條。
   */
  let button = page.locator(`.side-nav button[data-anchor="${anchor}"]`);
  if (!(await button.count())) {
    const pageIds = await page.evaluate(() =>
      [...document.querySelectorAll(".side-nav button[data-goto-page]")].map(
        (node) => node.getAttribute("data-goto-page"),
      ),
    );
    for (const pageId of pageIds) {
      await page
        .locator(`.side-nav button[data-goto-page="${pageId}"]`)
        .first()
        .click();
      await page.waitForTimeout(220);
      button = page.locator(`.side-nav button[data-anchor="${anchor}"]`);
      if (await button.count()) break;
    }
  }
  if (!(await button.count()))
    throw new Error(
      `側欄上找不到指向 ${anchor} 的項目——是不是漏了把它列進 PAGE_ZONES？`,
    );
  await button.first().click();
  await page.waitForFunction(
    (id) => !!document.getElementById(id),
    anchor,
    { timeout: 5000 },
  );
  await page.waitForTimeout(250);
}

/** 切到指定的大分頁（不點名任何一塊）。 */
export async function gotoPage(page, pageId) {
  const button = page.locator(`.side-nav button[data-goto-page="${pageId}"]`);
  if (!(await button.count()))
    throw new Error(`找不到大分頁按鈕 ${pageId}`);
  await button.first().click();
  await page.waitForFunction(
    (id) => !!document.getElementById(id),
    pageId,
    { timeout: 5000 },
  );
  await page.waitForTimeout(250);
}

/** 目前停在哪一個分頁（回傳 zone id）。 */
export async function currentTab(page) {
  return page.evaluate(
    () =>
      document
        .querySelector(".side-nav button.active")
        ?.getAttribute("data-goto") ?? "",
  );
}

/**
 * 確保主工具列是展開的。
 *
 * ⚠️ X-78（使用者 2026-09-17）：「重新載入或第一次開網頁時，
 *   主工具列是否能預設為收合狀態。下方版面比較清楚」——所以預設是**收合**。
 *   收合時那一排條件是 `hidden`，Playwright 會等它變成可見而逾時，
 *   看起來像「控制項不見了」，其實只是還沒展開。
 *
 * ⚠️ 要**看 aria-expanded 再決定按不按**，不可以無腦點一下：
 *   無腦點會在已經展開時把它收起來，下一行又逾時，
 *   而那種失敗最難查（同一支腳本時好時壞）。
 */
export async function ensureToolbarOpen(page) {
  const toggle = page.locator('[data-testid="mt-toggle"]');
  if (!(await toggle.count())) return;
  const open = await toggle.first().getAttribute("aria-expanded");
  if (open === "true") return;
  await toggle.first().click();
  await page.waitForTimeout(350);
}
