/*
 * ══════════════════════════════════════════════════════════════════════
 *  試用版（單一 .html）真的打得開、真的能用
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 「建出來了」不等於「打得開」。試用版是用 file:// 直接開的，
 *   與端對端測試用的 http:// 不是同一個環境：
 *     ・任何沒內嵌乾淨的外部檔案，在 file:// 下會靜靜地載入失敗，
 *       畫面照樣長出來，只是某個功能默默沒反應
 *     ・部分瀏覽器 API 在 file:// 下行為不同
 *   所以一定要用**產出的那一個檔案**、用 file:// 開、真的操作一遍。
 *
 * 這支驗四件事：
 *   ① 打得開、沒有 JS 例外、沒有載入失敗的請求
 *   ② 版號就是這一版（不是拿到舊檔案還以為是新的）
 *   ③ 建得起計畫、匯得進 Excel、算得出數字（核心流程走得完）
 *   ④ 這一版新做的東西真的在（側欄三個備份項目、本季總覽會被框起來）
 */
import { chromium } from "playwright";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { SYSTEM_VERSION } from "../app/system-release.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(here, "..", ".samples");
const file = join(
  here,
  "..",
  "..",
  "out",
  `全日交通量_試用版_${SYSTEM_VERSION}.html`,
);
const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

ok(`前置：試用版檔案存在（${SYSTEM_VERSION}）`, existsSync(file), file);
if (!existsSync(file)) process.exit(1);

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
const failedRequests = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("requestfailed", (r) => {
  /* file:// 下瀏覽器自己會去要 favicon 之類的，只記我們自己的檔案。 */
  if (/\.(js|css|json)(\?|$)/.test(r.url())) failedRequests.push(r.url());
});
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto(pathToFileURL(file).href);
await page.waitForTimeout(2500);

/* ── ① 打得開 ── */
const shell = await page.evaluate(() => ({
  title: document.title,
  hasShell: Boolean(document.querySelector(".app-shell")),
  version: (document.body.textContent || "").includes("VERSION_PLACEHOLDER"),
  text: (document.body.textContent || "").slice(0, 200),
}));
ok("用 file:// 開得起來，主畫面有長出來", shell.hasShell, shell.title);
ok(
  "沒有任何 JS 例外",
  errors.length === 0,
  errors.slice(0, 3).join(" | "),
);
ok(
  "沒有載入失敗的 JS／CSS（＝內嵌是乾淨的）",
  failedRequests.length === 0,
  failedRequests.slice(0, 3).join(" | "),
);

/* ── ② 版號 ── */
const shown = await page.evaluate(() => document.body.textContent || "");
ok(
  `畫面上顯示的版號就是 ${SYSTEM_VERSION}`,
  shown.includes(SYSTEM_VERSION),
  shown.includes("v20.") ? `畫面上是 ${/v20\.\d+/.exec(shown)?.[0]}` : "找不到版號",
);

/* ── ③ 核心流程 ── */
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
await page.locator(".modal-backdrop .modal input").first().fill("試用版煙霧測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(900);
ok(
  "建得起計畫",
  (await page.locator(".project-title h2").innerText()).includes("試用版煙霧測試"),
);

await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "115T1-01_中山路.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx")),
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

/*
 * ⚠️ 一定要驗「算出來的數字不是 0」。
 *   匯入流程卡住時畫面照樣長出卡片，只是每一格都是 0 或「—」，
 *   只驗「有卡片」會全綠。
 */
await page.locator('.side-nav-group button[data-goto="zone-kpi"]').first().click();
await page.waitForTimeout(900);
const kpi = await page.evaluate(() =>
  [...document.querySelectorAll(".kpi strong")].map((el) =>
    (el.textContent || "").trim(),
  ),
);
const numbers = kpi
  .map((t) => Number(t.replace(/[^\d.]/g, "")))
  .filter((n) => Number.isFinite(n));
ok(
  "匯入之後算得出數字（不是一片 0）",
  numbers.some((n) => n > 0),
  kpi.slice(0, 3).join("／") || "（一個數字都沒有）",
);

/* ── ④ 這一版新做的東西 ── */
await page
  .locator('.side-nav-group button[data-goto="zone-output"]')
  .first()
  .click();
await page.waitForTimeout(700);
/*
 * ⚠️ v20.75 起「一個大分頁＝一個獨立畫面」：點分類只會到它的**第一個**大分頁，
 *   備份那三張卡在「還原與備份」那一頁，別頁的 DOM 裡根本不存在。
 *   舊寫法點完分類就直接數卡片，數到的當然是 0——那不是卡片不見了，
 *   是這支測試還停在拆頁之前的世界。改成先切到那一頁再數。
 *   （側欄項目照舊在點完分類就看得到，所以上面那一條不用動。）
 */
await page.locator('.side-nav button[data-goto-page="page-backup"]').first().click();
await page.waitForTimeout(700);
const backup = await page.evaluate(() => ({
  navItems: ["備份本計畫", "備份全部計畫", "還原計畫"].filter((label) =>
    document.querySelector(`.side-nav-item[data-goto-item="${label}"]`),
  ),
  cards: ["backup-one", "backup-all", "backup-restore"].filter((id) =>
    document.getElementById(id),
  ),
  marks: [...document.querySelectorAll(".side-nav-mark")].map((el) =>
    (el.textContent || "").trim(),
  ),
}));
ok(
  "側欄有備份的三個項目",
  backup.navItems.length === 3,
  backup.navItems.join("、"),
);
ok("三張備份卡片都在", backup.cards.length === 3, backup.cards.join("、"));
/*
 * ⚠️ X-73 起側欄是**手風琴**：只有目前那一頁的小分頁會列出來，
 *   而帶記號（→／↓）的是「開視窗／直接下載」那幾項，它們在**別的頁**上。
 *   停在「還原與備份」量記號會量到 0 個——那不是記號不見了，
 *   是這一頁本來就沒有。改成切到有記號的那一頁再量。
 */
const marks = await (async () => {
  for (const pageId of ["page-projects", "page-batch"]) {
    await page
      .locator(`.side-nav button[data-goto-page="${pageId}"]`)
      .first()
      .click();
    await page.waitForTimeout(500);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll(".side-nav-mark")].map((el) =>
        (el.textContent || "").trim(),
      ),
    );
    if (found.length) return found;
  }
  return [];
})();
backup.marks = marks;
ok(
  "側欄記號用的是 Big5 安全字（↓／→），不是實機看不到的那組",
  backup.marks.length > 0 && backup.marks.every((m) => m === "↓" || m === "→"),
  backup.marks.join("") || "（沒有記號）",
);

await page
  .locator('.side-nav-group button[data-goto="zone-import"]')
  .first()
  .click();
await page.waitForTimeout(600);
await page
  .locator('.side-nav-item[data-goto-item="本季總覽"]')
  .first()
  .click();
await page.waitForTimeout(700);
const focused = await page.evaluate(() => {
  const el = document.querySelector(".is-focused");
  if (!el) return null;
  return {
    id: el.id,
    outline: parseFloat(getComputedStyle(el).outlineWidth || "0"),
    heading: el.querySelector("header strong")?.textContent?.trim() || "",
  };
});
ok(
  "點「本季總覽」會把那一塊框起來，而且框真的畫得出來",
  Boolean(focused) && focused.id === "block-quality" && focused.outline > 0,
  focused
    ? `#${focused.id}「${focused.heading}」外框 ${focused.outline}px`
    : "沒有任何區塊被點名",
);

ok(
  "整段沒有累積 JS 例外",
  errors.length === 0,
  errors.slice(0, 3).join(" | "),
);

await browser.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log(`\n✅ 試用版 ${SYSTEM_VERSION} 用 file:// 開得起來，核心流程走得完`);
