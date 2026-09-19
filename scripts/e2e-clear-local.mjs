import { gotoBlock } from "./e2e-nav.mjs";
/*
 * ══════════════════════════════════════════════════════════════════════
 *  清除本機資料：問清楚代價、沒備份先攔一次、清得乾淨
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「請三個程式都要有~刪除本機資料+補的那三件事」。
 * 那三件事是：
 *   ① 確認視窗要寫出**代價**（幾個計畫、幾筆資料），不是只問「確定嗎」
 *   ② 沒下載過完整備份要先提醒一次（提醒，不是禁止）
 *   ③ 說明要講清楚它和「刪除計畫」差在哪
 *
 * ⚠️ ③ 不是文案潔癖。使用者原本問的就是「這個一鍵清除本機資料是否有需要
 *   作? 還是要拿掉?」——會這樣問，正是因為畫面上看不出它和刪計畫差在哪。
 *   功能講不清楚，等於不存在。
 *
 * ⚠️ 而且一定要驗**真的清乾淨**。只驗「按了會問」的話，一支
 *   「問完什麼都沒做」的程式照樣全綠。
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
await new Promise((r) => server.listen(8203, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));

/* 逐一記下每一個對話框問了什麼，並決定要不要按確定。 */
const dialogs = [];
let acceptAll = false;
page.on("dialog", async (d) => {
  dialogs.push(d.message());
  if (acceptAll) await d.accept();
  else await d.dismiss();
});

await page.goto("http://localhost:8203/");
await page.waitForTimeout(1400);

async function newProject(name) {
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
  await page.locator(".modal-backdrop .modal input").first().fill(name);
  await page
    .locator('.modal-backdrop .modal button:has-text("建立")')
    .first()
    .click();
  await page.waitForTimeout(900);
}
await newProject("清除測試甲");
await newProject("清除測試乙");

/*
 * ⚠️ X-63：「五　資料產出與維護」底下有六個大分頁，點分區標題只會落在
 *   第一個（可追溯明細）。清除本機資料在「還原與備份」那一頁，
 *   所以直接指名那一塊。
 */
const go = async (title) => {
  await page.locator(`.side-nav-group > button:has-text("${title}")`).first().click();
  await page.waitForTimeout(800);
};
await gotoBlock(page, "block-clear-local");

/* ── ③ 說明 ── */
console.log("\n══ ③ 說明講不講得清楚 ══");
ok(
  "有「清除本機資料」這一區",
  (await page.locator("#block-clear-local").count()) > 0,
);
const why = await page
  .locator("#block-clear-local .danger-zone-why")
  .first()
  .textContent()
  .catch(() => "");
ok(
  "③ 說明寫出它和「刪除計畫」差在哪",
  (why || "").includes("刪除計畫") || (why || "").includes("刪計畫"),
  (why || "沒有這段說明").replace(/\s+/g, " ").slice(0, 60),
);
ok(
  "③ 說明寫出什麼時候該用它",
  (why || "").includes("什麼時候"),
  (why || "").replace(/\s+/g, " ").slice(0, 60),
);
/*
 * ⚠️ 不可以寫成「刪計畫之後殘留的設定會默默改到你的資料」。
 *   查證過：當量、車種分類、路段與流向設定都是依計畫存的，刪計畫時一起刪。
 *   說得比實際嚴重，會逼使用者去做不必要的清除，也讓他不再相信其他說明。
 */
ok(
  "③ 沒有把殘留講成「會影響數字」（查證過：不會，說得比實際嚴重比不講更糟）",
  !/殘留.*數字|默默改|影響.*計算結果/.test(why || ""),
  (why || "").replace(/\s+/g, " ").slice(0, 60),
);

/* ── ② 沒備份先攔一次 ── */
console.log("\n══ ② 沒下載過備份 ══");
dialogs.length = 0;
acceptAll = false;
/* ⚠️ X-63：清除本機資料在「還原與備份」那一個大分頁。 */
await gotoBlock(page, "block-clear-local");
await page.locator("#clearLocalData").click();
await page.waitForTimeout(1200);
ok(
  "② 還沒備份過就按，會先被提醒一次",
  dialogs.length >= 1 && dialogs[0].includes("備份"),
  dialogs[0]?.replace(/\s+/g, " ").slice(0, 60) || "完全沒有問",
);
ok(
  "② 在提醒視窗按「取消」＝不清除（提醒是提醒，不是走完流程）",
  (await page.locator(".portfolio-row, .project-chip").count()) > 0 ||
    dialogs.length === 1,
  `之後又問了 ${dialogs.length - 1} 次`,
);

/* ── ① 確認視窗要寫出代價 ── */
console.log("\n══ ① 確認視窗寫不寫得出代價 ══");
dialogs.length = 0;
acceptAll = false;
/* 這一次讓第一個提醒過關，看第二個視窗（真正的確認）寫了什麼。 */
page.removeAllListeners("dialog");
const seen = [];
page.on("dialog", async (d) => {
  seen.push(d.message());
  /* 第一個（備份提醒）按確定、第二個（真正的確認）按取消。 */
  if (seen.length === 1) await d.accept();
  else await d.dismiss();
});
/* ⚠️ X-63：清除本機資料在「還原與備份」那一個大分頁。 */
await gotoBlock(page, "block-clear-local");
await page.locator("#clearLocalData").click();
await page.waitForTimeout(1500);
const confirmText = seen[seen.length - 1] || "";
ok(
  "① 確認視窗寫出會刪掉幾個計畫",
  /\d+\s*個計畫/.test(confirmText),
  confirmText.replace(/\s+/g, " ").slice(0, 80) || "沒有確認視窗",
);
ok(
  "① 確認視窗寫出會刪掉幾筆資料",
  /\d+\s*筆/.test(confirmText),
  confirmText.replace(/\s+/g, " ").slice(0, 80),
);
ok(
  "① 確認視窗寫明無法復原",
  confirmText.includes("無法復原"),
  confirmText.replace(/\s+/g, " ").slice(0, 80),
);

/* ── 真的清乾淨 ── */
console.log("\n══ 真的清乾淨 ══");
page.removeAllListeners("dialog");
page.on("dialog", async (d) => {
  await d.accept();
});
/* 前一段按過「取消」，畫面還在原地；保險起見再導一次。 */
await go("資料產出與維護");
const before = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith("traffic-")) keys.push(key);
  }
  return keys;
});
/* ⚠️ X-63：清除本機資料在「還原與備份」那一個大分頁。 */
await gotoBlock(page, "block-clear-local");
await page.locator("#clearLocalData").click();
await page.waitForTimeout(4000);
const after = await page.evaluate(() => {
  const keys = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith("traffic-")) keys.push(key);
  }
  return keys;
});
ok(
  "⚠️ traffic-* 的本機設定全部清光（只驗「有沒有問」的話，一支問完什麼都不做的程式也會全綠）",
  after.length === 0,
  `清除前 ${before.length} 個鍵、清除後剩 ${after.join("、") || "0 個"}`,
);
const projectsLeft = await page.evaluate(
  () => document.querySelectorAll(".portfolio-row").length,
);
ok("計畫全部不見了", projectsLeft === 0, `還有 ${projectsLeft} 個`);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 清除本機資料：問清楚代價、沒備份先攔、清得乾淨");
