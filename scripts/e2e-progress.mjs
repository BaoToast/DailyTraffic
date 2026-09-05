/*
 * 判讀進度提示的端對端檢查（全日交通量）。
 *
 * 使用者回報：「上傳了大量的檔案後，因為沒有『讀取中』等提示文字，
 * 會誤以為沒上傳成功。」
 *
 * 本系統原本就有全螢幕遮罩「正在處理資料…」，比另外兩支明顯，
 * 但它**一動也不動**：檔案一多、跑上十幾秒，使用者仍然分不出
 *「還在跑」和「當掉了」。這一支驗的就是那行進度：
 *  ・遮罩出現時要看得到「第幾／共幾份」與正在讀的檔名
 *  ・進度中途要被抓到至少兩個不同的數字（證明畫面真的在重畫，
 *    不是整批卡到最後才一次跳完）
 *  ・跑完之後遮罩要收掉，不可以一直掛著
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

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
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8146, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const names = readdirSync(SAMPLES).filter((n) => /\.xlsx$/i.test(n));
if (!names.length) {
  console.log("❌ 找不到樣本檔，請先執行 node scripts/make-samples.mjs");
  server.close();
  process.exit(1);
}

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8146/");
await page.waitForTimeout(900);

const outsideDropGuard = await page.evaluate(() => {
  const files = new DataTransfer();
  files.items.add(new File(["test"], "outside.xlsx"));
  const drag = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: files,
  });
  const drop = new DragEvent("drop", {
    bubbles: true,
    cancelable: true,
    dataTransfer: files,
  });
  document.body.dispatchEvent(drag);
  document.body.dispatchEvent(drop);

  const text = new DataTransfer();
  text.setData("text/plain", "ordinary text");
  const ordinary = new DragEvent("dragover", {
    bubbles: true,
    cancelable: true,
    dataTransfer: text,
  });
  document.body.dispatchEvent(ordinary);
  return {
    fileDragPrevented: drag.defaultPrevented,
    fileDropPrevented: drop.defaultPrevented,
    ordinaryPrevented: ordinary.defaultPrevented,
  };
});
ok("檔案拖到放置區外時會阻止瀏覽器開啟檔案", outsideDropGuard.fileDropPrevented);
ok("放置區外的檔案拖曳會顯示不可放置狀態", outsideDropGuard.fileDragPrevented);
ok("一般文字拖曳不受檔案防呆影響", !outsideDropGuard.ordinaryPrevented);

/* 建立計畫 */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("進度提示測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

/* 開匯入視窗，一次送多份檔案 */
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");

/* 把樣本檔重複成 12 份，模擬「一次上傳大量檔案」 */
const batch = [];
for (let round = 0; round < 6 && batch.length < 12; round += 1)
  for (const name of names)
    batch.push({
      name: `${round + 1}_${name}`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, name)),
    });

const before = await page.evaluate(() => document.querySelectorAll(".busy").length);
ok("前置：還沒開始匯入時，沒有處理中遮罩", before === 0);

/*
 * 一邊送檔一邊取樣。取樣本身要靠瀏覽器排程，
 * 能取到多個不同的進度數字，就證明畫面真的在重畫。
 */
await page.evaluate(() => {
  window.__busyTrace = [];
  window.__busyTimer = setInterval(() => {
    const el = document.querySelector(".busy");
    const entry = el ? el.textContent.trim() : "";
    const last = window.__busyTrace[window.__busyTrace.length - 1];
    if (last !== entry) window.__busyTrace.push(entry);
  }, 10);
});
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles(batch.slice(0, 12));
await page.waitForTimeout(9000);
const trace = await page.evaluate(() => {
  clearInterval(window.__busyTimer);
  return window.__busyTrace;
});

const busyTexts = trace.filter((t) => t && /正在處理資料/.test(t));
ok(
  "匯入時看得到處理中遮罩",
  busyTexts.length > 0,
  `遮罩出現過 ${busyTexts.length} 種文字`,
);
const withProgress = busyTexts.filter((t) => /份/.test(t));
ok(
  "遮罩上有「第幾／共幾份」的進度",
  withProgress.length > 0,
  withProgress[0] ? `例：「${withProgress[0]}」` : "遮罩只有固定文字，沒有進度",
);
ok(
  "而且進度是會跳的（畫面真的在重畫，不是最後才一次跳完）",
  new Set(withProgress).size >= 2,
  `抓到 ${new Set(withProgress).size} 種不同的進度文字`,
);
ok(
  "進度有標出總份數，使用者知道還剩多少",
  withProgress.some((t) => t.includes("／12")),
  `共 12 份；例：「${withProgress[0] || ""}」`,
);

/* 收掉可能跳出的後續視窗，再確認遮罩已經不在 */
for (let i = 0; i < 6; i += 1) {
  const closer = page
    .locator(
      '.modal-backdrop button:has-text("確認"), .modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
    )
    .first();
  if (!(await closer.count())) break;
  await closer.click().catch(() => {});
  await page.waitForTimeout(800);
}
const stillBusy = await page.evaluate(
  () => document.querySelectorAll(".busy").length,
);
ok("處理完之後遮罩要收掉，不可以一直掛著", stillBusy === 0, `遮罩 ${stillBusy} 個`);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
