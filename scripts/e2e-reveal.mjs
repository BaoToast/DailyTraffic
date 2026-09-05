/**
 * 端對端：按下「產生草稿」之後，草稿框必須在使用者看得到的地方。
 *
 * 起因是使用者的實際回報（交通服務水準）：
 *   「路段管理的功能頁面中，修改正式名稱／合併重複路段，按下預覽修改影響之後，
 *     因為畫面停在原地，所以使用者不知道預覽畫面已經顯示在下方了，
 *     會誤以為程式沒任何反應。」
 *
 * 三支都量過，結論草稿產生器有同一個問題：「產生草稿」在條件面板的**上方**，
 * 草稿框在整個條件面板的**下方**。實測（視窗高 900px）草稿框頂端在 1155px，
 * 比視窗下緣還低 255px——按下去畫面完全沒動，看起來就像壞掉。
 *
 * 這一支釘住修好之後的行為：按下按鈕之後，草稿框的頂端必須在視窗內。
 * 視窗高度刻意用 768（常見筆電），比 900 更嚴格。
 *
 * 注意：`revealResult()` 只在結果看不到時才捲動。所以這一支不是在驗「一定要捲動」，
 * 是在驗「按完之後看得到」——結果本來就看得到時不捲動也算通過，那才是對的行為。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const VH = 768;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8143, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label);
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1440, height: VH }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(""));
await page.goto("http://localhost:8143/");
await page.waitForTimeout(1200);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("捲動守門計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(800);

await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "115T1-01_中山路.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx")),
  });
await page.waitForTimeout(3000);
for (const label of ["確認", "套用車種設定", "關閉", "取消"]) {
  const button = page.locator(`.modal-backdrop button:has-text("${label}")`);
  if (await button.count()) {
    await button.first().click().catch(() => {});
    await page.waitForTimeout(1800);
  }
}
for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page
    .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
    .first();
  if (!(await closer.count())) break;
  await closer.click().catch(() => {});
  await page.waitForTimeout(400);
}

/* 結論草稿產生器預設收合，展開之後「產生草稿」才會出現。 */
await page.locator('#conclusionStudio button:has-text("展開")').first().click();
await page.waitForTimeout(2500);
ok("結論草稿產生器展得開", (await page.locator(".conclusion-output").count()) === 1);

/*
 * 把條件面板頂到視窗最上緣，草稿框就落在視窗下方之外。
 *
 * ⚠️ 這裡**不能**用 Playwright 的 click()：它按之前會自己把元素捲進視窗，
 * 量到的就不是程式自己的行為。改成在頁面裡直接對按鈕發 click()。
 * 前置條件（按之前確實看不到）也要驗，否則版面一改這一項就變成恆真。
 */
await page.evaluate(() => {
  const el = document.querySelector(".conclusion-body");
  if (el) el.scrollIntoView({ block: "start" });
  /*
   * 條件面板頂到視窗上緣之後，草稿框還是會露出一小截（實測 75px）。
   * 再往上捲一點，讓它整個落到視窗下緣之外，前置條件才成立。
   * 用算的而不是寫死像素，版面改了也不會失準。
   */
  const out = document.querySelector(".conclusion-output");
  const gap = window.innerHeight + 20 - out.getBoundingClientRect().top;
  if (gap > 0) window.scrollBy(0, -gap);
});
await page.waitForTimeout(400);
const beforeVisible = await page.evaluate(() => {
  const r = document.querySelector(".conclusion-output").getBoundingClientRect();
  const vh = window.innerHeight;
  return Math.round(Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0)));
});
ok("前置：按之前草稿框確實看不到", beforeVisible < 40, `按之前可見 ${beforeVisible}px`);
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".conclusion-output button")].find(
    (b) => b.textContent.trim() === "產生草稿",
  );
  if (button) button.click();
});
await page.waitForTimeout(1200);

const m = await page.evaluate(() => {
  const el = document.querySelector(".conclusion-output");
  const ta = document.querySelector('textarea[aria-label="結論草稿"]');
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  return {
    top: Math.round(r.top),
    vh,
    height: Math.round(r.height),
    visible: Math.round(Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0))),
    drafted: ((ta && ta.value) || "").length,
  };
});
ok("草稿真的產生了", m.drafted > 0, `${m.drafted} 字`);

/*
 * 判準：光是「上緣在視窗內」不算看得到——上緣落在視窗下緣往上 60px 的地方，
 * 使用者只看得到一條邊，跟沒看到一樣。所以要求**實際可見高度**至少
 * 160px 或整個區塊的四分之一（取小者），這才是「按下去有看到結果」。
 */
ok("量到的草稿框不是 0 高度", m.height >= 24, `框高 ${m.height}px`);
const need = Math.min(160, Math.round(m.height / 4));
ok(
  "草稿框按完之後真的看得到",
  m.visible >= need,
  `可見 ${m.visible}px／需要 ${need}px（按之前 ${beforeVisible}px、top=${m.top}px、框高 ${m.height}px、視窗 ${m.vh}px）`,
);
/*
 * ── 另一半同樣重要：結果已經看得到時，畫面**不准**跳 ──
 *
 * 使用者交代過：「除非是按下確認鍵修正後，修正的畫面就是在原地，那才不用跳開。」
 * 他後來又補充結論草稿的實際用法——「使用者必須先決定產生哪些結論出來，
 * 會一路往下滑，勾選要產生的監測結果，最後在最底下才會點選『重新產生』，
 * 直接原地看到結果，不需要跳轉。」
 *
 * revealResult() 因此是有條件的。
 *
 * ⚠️ 這裡有一個量測上的陷阱：**直接捲到整頁最底下按，
 * 畫面本來就動不了**（已經到捲動極限），於是不管程式怎麼寫都會通過。
 * 實測把 revealResult() 改成無條件 `block: "start"`，這一項仍然是綠的——
 * 也就是說它當時擋不住任何東西。
 *
 * 改法：先在頁尾補一塊空白，讓「草稿框整個看得見」與「畫面還捲得動」同時成立，
 * 再把草稿框放到視窗中間；這時候只要程式擅自捲動就一定量得到。
 * 空白塊掛在 React 根節點外面，重畫不會把它清掉；量完就移除。
 */
await page.evaluate(() => {
  const spacer = document.createElement("div");
  spacer.id = "reveal-probe-spacer";
  spacer.style.height = "1500px";
  document.body.appendChild(spacer);
  document
    .querySelector(".conclusion-output")
    .scrollIntoView({ block: "center", behavior: "auto" });
});
await page.waitForTimeout(400);
const stayBefore = await page.evaluate(() => {
  const r = document.querySelector(".conclusion-output").getBoundingClientRect();
  const vh = window.innerHeight;
  const max = document.documentElement.scrollHeight - vh;
  return {
    y: Math.round(window.scrollY),
    fullyVisible: r.top >= 0 && r.bottom <= vh,
    canScroll: Math.round(window.scrollY) < Math.round(max) - 50,
  };
});
ok(
  "前置：草稿框整個看得見，而且畫面還捲得動",
  stayBefore.fullyVisible && stayBefore.canScroll,
  `整個看得見=${stayBefore.fullyVisible}、還捲得動=${stayBefore.canScroll}（scrollY=${stayBefore.y}）`,
);
const stayY0 = stayBefore.y;
await page.evaluate(() => {
  const button = [...document.querySelectorAll(".conclusion-output button")].find(
    (b) => b.textContent.trim() === "產生草稿",
  );
  if (button) button.click();
});
await page.waitForTimeout(900);
const stayY1 = await page.evaluate(() => Math.round(window.scrollY));
await page.evaluate(() => {
  document.getElementById("reveal-probe-spacer")?.remove();
});
ok(
  "草稿本來就看得到時，畫面不可以跳",
  stayY0 === stayY1,
  `捲動前 ${stayY0} → 捲動後 ${stayY1}`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
