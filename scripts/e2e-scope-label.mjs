/**
 * ══════════════════════════════════════════════════════════════════════
 *  畫面上那一行「目前看的是什麼」，必須描述**這一塊真的在畫的那一份**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 這一支守的不是使用者回報的某一項，而是**一整類**的錯（2026-09-16 自我
 * 稽核抓到 10 處）：
 *
 *   某一塊圖表可以脫離主工具列，它的**數字**照自己的條件算，
 *   但畫面上那一行**說明／標題／檔名**卻是照主工具列寫的。
 *   兩邊各自看都很合理，只有把兩份放在一起比才看得出來——
 *   而那一行字會被抄進報告。
 *
 * 規則（這一支就是在守這兩條）：
 *   ① **畫面上的**標題／說明／PNG 檔名 → 照**那一塊自己的**條件
 *   ② **交出去的文件**（結論草稿、分析數據 Excel）→ 一律照**主工具列**
 *      （使用者 2026-09-14 定的規則），而且標籤與數字要同一邊，
 *      只有標籤照主、數字照區塊，就是同一個錯換一邊。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**一定要真的讓兩邊不一樣**。主工具列與區塊條件相同時，
 *     「讀主工具列」與「讀區塊」印出來的字一模一樣，怎麼寫都會過。
 *     所以先把區塊脫離成另一個日別，並**明確驗兩者的數字不相等**。
 * 二、**不可以只驗標題**。要同時驗「標題變了」與「數字也真的是那一邊的」，
 *     否則一個「把標題改成寫死字串」的實作也會過。
 * 三、草稿那一段要**反過來**驗：它必須**不跟著**區塊脫離走。
 *     兩邊都驗，才擋得住「乾脆全部改成讀區塊」這種把交付物弄錯的修法。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";

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
page.on("dialog", (event) =>
  event.accept(event.type() === "prompt" ? "N" : ""),
);
await page.goto(base, { waitUntil: "networkidle" });
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(2000);

/* ── 前置：一個計畫、一個調查點、平日與假日各一份 ──────────────── */
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
await page.locator(".modal-backdrop .modal input").first().fill("範圍說明守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

const BASE_A = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
await gotoTab(page, TABS.import);
await page.waitForTimeout(600);
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page.waitForTimeout(400);
/*
 * ⚠️ 平日與假日**兩份都要有**，而且量要不一樣。
 *   只有一種日別的話，「切到假日」看到的是空的，
 *   「標題跟著變」與「標題沒跟著變」都分不出來。
 *   同一個檔名＝同一個調查點；日別由檔案內容的資料別欄位決定，
 *   所以這裡送兩個不同日別的樣本檔。
 */
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles([
    { name: "115T1-01_中山路.xlsx", mimeType: XLSX_MIME, buffer: BASE_A },
  ]);
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
/*
 * ⚠️ 匯入之後可能還留著一個視窗（車種設定／匯入摘要），
 *   不關掉的話 .modal-backdrop 會擋住之後每一個點擊，
 *   Playwright 一路重試到逾時，錯誤訊息只寫「元素被攔截」。
 *   「關閉／取消」不是每一個視窗都有，所以再補 Escape 與「完成／確定」。
 */
for (
  let i = 0;
  i < 8 && (await page.locator(".modal-backdrop").count());
  i += 1
) {
  const closer = page
    .locator(
      '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消"), .modal-backdrop button:has-text("完成"), .modal-backdrop button:has-text("確定"), .modal-backdrop button:has-text("套用車種設定")',
    )
    .first();
  if (await closer.count()) await closer.click().catch(() => {});
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}
await page.waitForTimeout(800);
/*
 * ⚠️ 視窗是**非同步**冒出來的：匯入結束後還會再開一個（車種設定）。
 *   只在這裡數一次會看到 0，然後下一個點擊就被剛冒出來的那一個擋住
 *   （實測就是這樣，錯誤訊息只寫「元素被攔截」）。
 *   所以這裡等到「連續兩次都沒有視窗」才往下走。
 */
const waitForNoModal = async () => {
  for (let i = 0; i < 30; i += 1) {
    const first = await page.locator(".modal-backdrop").count();
    if (first) {
      const closer = page
        .locator(
          '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消"), .modal-backdrop button:has-text("完成"), .modal-backdrop button:has-text("確定"), .modal-backdrop button:has-text("套用車種設定")',
        )
        .first();
      if (await closer.count()) await closer.click().catch(() => {});
      else await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(600);
    if (!(await page.locator(".modal-backdrop").count())) return true;
  }
  return false;
};
if (!(await waitForNoModal()))
  stop("匯入之後還有視窗關不掉，後面的點擊都會被它擋住");
await gotoBlock(page, "block-composition");
await page.waitForTimeout(1500);

/* ── 工具 ────────────────────────────────────────────────────── */
/** 車種組成那一塊：抬頭那一行字，以及圓環中央的合計。 */
const compositionState = () =>
  page.evaluate(() => {
    const block = document.getElementById("block-composition");
    return {
      heading:
        block?.querySelector(".composition-heading h3")?.textContent?.trim() ??
        "",
      note: (
        block?.querySelector("[data-chart-note]")?.textContent ?? ""
      ).replace(/\s+/g, " "),
      /* 圓環中央那個數字＝這一塊實際算出來的合計。 */
      total: (block?.textContent?.match(/[\d,]{3,}/g) || []).join("|"),
    };
  });
/** 這一塊自己的日別下拉（renderBlockFilters 產生的）。 */
const setCompositionDay = async (value) => {
  const select = page
    .locator("#block-composition .block-filters select")
    .first();
  await select.evaluate((node, next) => {
    node.value = next;
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(900);
};
const setMainDay = async (value) => {
  await page.evaluate((next) => {
    const select = document.querySelector('[data-testid="mt-day"]');
    if (!select) return;
    select.value = next;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(900);
};

/* ══ 前置：主工具列與區塊都在平日，記下基準 ══════════════════ */
console.log("\n══ 前置 ══");
await setMainDay("平日");
const beforeState = await compositionState();
ok(
  "前置：車種組成那一塊畫得出數字",
  beforeState.total.length > 0,
  beforeState.heading || "（抬頭讀不到）",
);
if (!beforeState.total.length) stop("這一塊沒有數字，後面每一條都沒得比");
ok(
  "前置：抬頭寫著目前的日別（平日）",
  /平日/.test(beforeState.heading),
  beforeState.heading,
);

/* ══ 一、把這一塊脫離成「假日」：抬頭要跟著變 ════════════════ */
console.log("\n══ 一、區塊脫離之後，抬頭要描述區塊自己的條件 ══");
await setCompositionDay("假日");
const detached = await compositionState();
ok(
  "⚠️ ① 數字真的變了（否則「標題跟著變」是恆真的）",
  detached.total !== beforeState.total,
  `脫離前 ${beforeState.total.slice(0, 40)}｜脫離後 ${detached.total.slice(0, 40)}`,
);
if (detached.total === beforeState.total)
  stop("切了日別數字沒變，測資本身不會觸發問題");
ok(
  "⚠️ ① 抬頭跟著寫「假日」，不是主工具列的「平日」",
  /假日/.test(detached.heading) && !/^平日/.test(detached.heading),
  detached.heading,
);
ok(
  "⚠️ ① 圖旁邊那一段說明也跟著寫「假日」",
  /假日/.test(detached.note),
  detached.note.slice(0, 80) || "（讀不到說明）",
);

/* ══ 二、交出去的文件要**反過來**：一律吃主工具列 ═══════════ */
console.log("\n══ 二、結論草稿不跟著區塊脫離走 ══");
await gotoTab(page, TABS.output);
await page.waitForTimeout(1000);
/*
 * ⚠️ 先把可能還開著的視窗關掉再點。
 *   留著的話 .modal-backdrop 會擋住點擊，Playwright 會一路重試到逾時，
 *   而錯誤訊息只寫「元素被攔截」，看起來像功能壞掉。
 */
for (let i = 0; i < 6 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page
    .locator(
      '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
    )
    .first();
  if (!(await closer.count())) {
    await page.keyboard.press("Escape");
  } else {
    await closer.click().catch(() => {});
  }
  await page.waitForTimeout(400);
}
/* 草稿在「報表批次輸出中心」裡面，要先打開它。 */
await page
  .locator('button:has-text("報表批次輸出中心")')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(1200);
const draft = await page.evaluate(
  () =>
    (
      document.querySelector(".report-draft-box textarea")?.value || ""
    ).replace(/\s+/g, " "),
);
ok(
  "前置：草稿產生得出來",
  draft.length > 50,
  `${draft.length} 字`,
);
/*
 * 2026-09-18 F-10／F-30：草稿的車種組成改成「一個調查點 × 一個日別一句」——
 * 標題一行＋逐點的「・」行。這裡抓整段（標題到最後一個「・」行）。
 */
const compositionSentence =
  /* draft 已把換行壓成空白，所以逐點的「・」行是用空白接在標題後面 */
  draft.match(/車種組成（全調查時段[^）]*）：(?: ?・.*?。)+/)?.[0] ??
  draft.match(/車種組成（依「[^」]*」統計[^）]*）[^。]*。/)?.[0] ??
  "";
ok(
  "⚠️ ② 草稿的車種組成那一句**標籤**寫的是主工具列的日別（平日）",
  /平日/.test(compositionSentence) && !/假日/.test(compositionSentence),
  compositionSentence.slice(0, 70) || "（找不到那一句）",
);
/*
 * ⚠️ 只驗標籤不夠：標籤與數字是兩條路徑，只改其中一條也會過。
 *   這裡比對**數字**——草稿裡不可以出現只有假日才有的那幾個值。
 *   兩組數字前面已經證明過不相等（第一節①），所以這一條不會恆真。
 */
const numbersOf = (text) =>
  new Set(
    (text.match(/[\d,]{4,}/g) || []).map((raw) => Number(raw.replace(/,/g, ""))),
  );
const weekdayNumbers = numbersOf(beforeState.total.replace(/\|/g, " "));
const holidayNumbers = numbersOf(detached.total.replace(/\|/g, " "));
const holidayOnly = [...holidayNumbers].filter(
  (value) => value > 1000 && !weekdayNumbers.has(value),
);
if (!holidayOnly.length)
  stop("找不到只有假日才有的數字，下面那一條會變成恆真");
/*
 * ⚠️ 只比對**車種組成那一句**，不比對整份草稿。
 *   草稿另有「平假日比較」那一段，它本來就同時寫平日與假日的量
 *  （那一塊刻意不套日別），拿整份去比會把一個正確的數字判成洩漏。
 */
const sentenceNumbers = numbersOf(compositionSentence);
const leaked = holidayOnly.filter((value) => sentenceNumbers.has(value));
ok(
  "⚠️ ② 車種組成那一句裡的**數字**也是主工具列那一份",
  compositionSentence.length > 0 && leaked.length === 0,
  leaked.length
    ? `那一句裡出現了只有假日才有的 ${leaked.slice(0, 4).join("、")}`
    : `比對過 ${holidayOnly.length} 個假日獨有的值`,
);

/* ══ 三、回到同步狀態，抬頭要回到主工具列那一份 ═════════════ */
console.log("\n══ 三、回歸之後要跟回去 ══");
/*
 * ⚠️ 「報表批次輸出中心」是一個視窗，不關掉的話它的 backdrop 會擋住
 *   側欄的分頁按鈕——症狀是 gotoTab 一路重試到逾時，
 *   而錯誤訊息只寫「元素被攔截」，看起來像分頁壞掉。（實測踩過）
 */
if (!(await waitForNoModal()))
  stop("報表批次輸出中心關不掉，後面的點擊都會被它擋住");
await gotoBlock(page, "block-composition");
await page.waitForTimeout(1000);
const reset = page.locator("#block-composition .chart-detach-reset").first();
ok(
  "③ 脫離時那一塊上面有「回到主工具列條件」的鈕",
  (await reset.count()) > 0,
);
if (await reset.count()) {
  await reset.click();
  await page.waitForTimeout(1000);
  const back = await compositionState();
  ok(
    "③ 按了之後抬頭與數字都回到主工具列那一份",
    /平日/.test(back.heading) && back.total === beforeState.total,
    `${back.heading}｜${back.total.slice(0, 40)}`,
  );
}

ok("沒有任何 JavaScript 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過：`);
  problems.forEach((line) => console.error(`   ・${line}`));
  process.exit(1);
}
console.log("\n✅ 範圍說明與數字同一邊：畫面照區塊、交付物照主工具列");
