/*
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢圖：捲講稿時圖要看得到，而且**標題與單位不可以被切掉**
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-10 實測回報（三件事，成因各不相同）：
 *   ①「圖標題和單位就消失在畫面了」
 *   ②「我該如何解除圖片固定的效果?」
 *   ③「想換下一個路段的圖，我又得一直往上滑到功能列」
 *
 * 對應的修法：
 *   ① 釘住的東西要**小到放得進視窗**（圖跟著縮），不是讓容器溢出。
 *   ② **不需要按鈕**：sticky 只在包含區塊裡黏住，捲出去就自動放開。
 *   ③ 標題那一列本來就帶著路段／日別選擇器，一起釘住就解決了。
 *
 * ⚠️ 這一支與路口轉向的 e2e-trend-pin.mjs 是**兩支**，不要合併：
 *    兩支程式的趨勢區長相不同（那一支是左右兩欄、這一支是上下一欄），
 *    硬合成一支只會讓兩邊都變脆。
 *
 * ── ⚠️ 刻意迴避的假通過 ──────────────────────────────────────
 * 一、只驗「圖還看得到」會漏掉標題——那正是壞掉的那一項。
 * 二、只驗「有 position: sticky」不夠：容器比視窗高時它照樣是 sticky。
 *     要**實際捲到講稿底部再量座標**。
 * 三、只驗「還黏著」會讓「永遠黏著」也過，而永遠黏著正是使用者問
 *     「怎麼解除」的原因。要驗**包含區塊限制在這一塊**。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
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
await new Promise((r) => server.listen(8137, r));
const browser = await chromium.launch(launchOptions());
/* 視窗要夠高才啟用（矮螢幕刻意不啟用）。 */
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept("N"));

await page.goto("http://localhost:8137/");
await page.waitForTimeout(900);
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("釘住測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

const base = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
async function importAs(quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(quarter);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: "115T1-01_中山路.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: base,
  });
  await page.waitForTimeout(2800);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3000); }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!(await closer.count())) break;
    await closer.click(); await page.waitForTimeout(500);
  }
}
/* 至少兩季才畫得出趨勢線；只有一季的話下面全部變成恆真。 */
await importAs("115Q1");
await importAs("115Q2");
await gotoBlock(page, "block-trend");
await page.waitForTimeout(1200);

const geometry = async () =>
  page.evaluate(() => {
    const panel = document.querySelector(".trend-panel");
    const pinned = panel?.querySelector(".trend-pinned");
    const head = pinned?.querySelector(".panel-title");
    const unit = pinned?.querySelector(".panel-title small");
    const canvas = pinned?.querySelector(".trend-canvas");
    const script = document.querySelector("#trendScript");
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height) };
    };
    return {
      viewport: window.innerHeight,
      position: pinned ? getComputedStyle(pinned).position : "",
      panel: box(panel), pinned: box(pinned), head: box(head),
      unit: box(unit), canvas: box(canvas), script: box(script),
      scrollY: Math.round(window.scrollY),
    };
  });

console.log("══ 一、釘住區必須放得進視窗 ══");
const atTop = await geometry();
console.log("   ", JSON.stringify(atTop));
ok("前置：找得到釘住區", Boolean(atTop.pinned));
ok("前置：講稿在（沒有它就沒有「捲說明」這件事）", Boolean(atTop.script));
ok("釘住區是 sticky", atTop.position === "sticky", atTop.position);
ok(
  "⚠️ 釘住區的高度不可以超過視窗（超過就一定會切掉標題）",
  atTop.pinned && atTop.pinned.height <= atTop.viewport,
  `釘住區 ${atTop.pinned?.height}px／視窗 ${atTop.viewport}px`,
);

console.log("\n══ 二、捲到講稿底部時，標題仍然要在視窗內 ══");
await page.evaluate(() => {
  const script = document.querySelector("#trendScript");
  if (!script) return;
  const r = script.getBoundingClientRect();
  window.scrollTo({ top: window.scrollY + r.bottom - window.innerHeight + 40, behavior: "auto" });
});
await page.waitForTimeout(700);
const scrolled = await geometry();
console.log("   ", JSON.stringify(scrolled));
ok(
  "捲動真的發生了（沒捲的話下面全部是恆真）",
  scrolled.scrollY > atTop.scrollY + 100,
  `${atTop.scrollY} → ${scrolled.scrollY}`,
);
ok(
  "⚠️ 圖的**標題**仍然在視窗內（這就是使用者回報壞掉的那一項）",
  scrolled.head && scrolled.head.top >= -2 && scrolled.head.bottom <= scrolled.viewport,
  `標題 ${scrolled.head?.top}～${scrolled.head?.bottom}／視窗 0～${scrolled.viewport}`,
);
ok(
  "折線圖本身也整張在視窗內",
  scrolled.canvas && scrolled.canvas.top >= -2 && scrolled.canvas.bottom <= scrolled.viewport + 2,
  `圖 ${scrolled.canvas?.top}～${scrolled.canvas?.bottom}`,
);

console.log("\n══ 三、包含區塊限制在這一塊（＝捲出去自動放開）══");
await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" }));
await page.waitForTimeout(700);
const bottom = await geometry();
console.log("   ", JSON.stringify(bottom));
/*
 * ⚠️ 「捲到頁尾就會放開」不一定驗得到（頁面可能不夠長）。
 *   要驗的是機制：釘住區的下緣永遠不會超出 .trend-panel 的下緣。
 *   包含區塊若被設成整個內容區，圖會黏過這一整塊、跟到下一張圖旁邊。
 */
ok(
  "⚠️ 釘住區的下緣不會超出 .trend-panel（捲出去就自動放開，不需要按鈕）",
  bottom.pinned && bottom.panel && bottom.pinned.bottom <= bottom.panel.bottom + 2,
  `釘住區下緣 ${bottom.pinned?.bottom}／面板下緣 ${bottom.panel?.bottom}`,
);
ok(
  "沒有出現「取消固定」之類的按鈕（正確做法是修範圍，不是加按鈕）",
  (await page.locator('button:has-text("取消固定")').count()) === 0,
);

console.log("\n══ 四、釘住區裡就能換路段，不必捲回最上面 ══");
await page.evaluate(() => {
  const script = document.querySelector("#trendScript");
  if (!script) return;
  window.scrollTo({ top: window.scrollY + script.getBoundingClientRect().top - 60, behavior: "auto" });
});
await page.waitForTimeout(500);
const picker = page.locator(".trend-pinned .trend-controls select").first();
ok("釘住區裡有路段選擇器", (await picker.count()) > 0);
if (await picker.count()) {
  const before = await page.evaluate(() => Math.round(window.scrollY));
  const options = await picker.locator("option").allTextContents();
  ok("路段選擇器至少有兩個選項", options.length >= 2, options.join("／"));
  if (options.length >= 2) {
    await picker.selectOption({ label: options[1] });
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      headVisible: (() => {
        const head = document.querySelector(".trend-pinned .panel-title");
        if (!head) return false;
        const r = head.getBoundingClientRect();
        return r.top >= -2 && r.bottom <= window.innerHeight;
      })(),
    }));
    /*
     * ⚠️ 不可以要求「捲動位置完全不變」：換到資料較少的路段時整頁變短，
     *   瀏覽器一定會把捲動位置夾到新的最大值，那不是程式跳動。
     *   使用者要的是「不必捲回最上面」，所以驗的是「沒被彈回頁首」
     *   與「標題仍在視窗內」。
     */
    ok("⚠️ 換路段之後不會被彈回頁首", after.scrollY > 150, `${before} → ${after.scrollY}`);
    ok("換路段之後圖的標題仍然在視窗內", after.headVisible === true);
  }
}

console.log("\n══ 五、螢幕矮的時候不啟用 ══");
await page.setViewportSize({ width: 1500, height: 620 });
await page.waitForTimeout(500);
const short = await page.evaluate(() => ({
  position: getComputedStyle(document.querySelector(".trend-pinned")).position,
  innerHeight: window.innerHeight,
}));
ok(
  "視窗高度 620px 時不啟用 sticky（矮螢幕釘住只會把講稿擠到看不見）",
  short.position !== "sticky",
  JSON.stringify(short),
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));
await browser.close();
server.close();
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
