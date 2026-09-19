/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一個視窗的「取消／確認／關閉」都要始終看得見
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「我剛發現一個很實用的小細節，就是畫面右下角的**取消／關閉功能，
 *     請保持始終可見**，不要像這張圖片視窗一樣，我必須把內容滑到最底部，
 *     才能看到取消／關閉的功能鍵。請把這一個事項同步給 3 個程式。」
 *   「請**確實檢視每個有「取消、確認、關閉」的功能鍵**，
 *     這類功能鍵都能始終可見，而不用在視窗中要滑到最底才能選擇。」
 *
 * ⚠️ 以前只有匯入確認那一個視窗做了（.modal footer.sticky-actions），
 *   其餘十幾個視窗的動作列都是跟著內容一起捲走的。
 *
 * ── 這一支怎麼避開假通過 ────────────────────────────────────────
 *
 * 一、**只量畫面上打得開的那幾個視窗不夠**——沒被量到的視窗可以照樣是壞的。
 *     所以先做**原始碼盤點**：每一個 .modal-backdrop 區塊都必須有動作列
 *     （<footer 或 className="modal-actions"），一個都不能少。
 * 二、**只驗 CSS 有寫 sticky 不夠**——寫了但被別條蓋掉照樣沒效。
 *     所以要在瀏覽器裡讀**計算後**的 position。
 * 三、**只驗 position 是 sticky 還是不夠**——視窗捲不動時任何寫法都看得見。
 *     所以要有至少一個**真的長到需要捲**的視窗，在捲到最上面時量按鈕位置。
 * 四、每一顆按鈕都要量，不是量第一顆就算過（使用者指名「每個」）。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* ══════════════════════════════════════════════════════════════════
 * 一、原始碼盤點：每一個視窗都要有動作列
 * ══════════════════════════════════════════════════════════════════ */
const source = readFileSync(join(here, "..", "app", "DashboardClient.tsx"), "utf8");
const blocks = source.split('className="modal-backdrop"').slice(1);
ok(
  "前置：原始碼裡找得到視窗（否則下面整段是恆真）",
  blocks.length >= 10,
  `${blocks.length} 個視窗`,
);
const withoutActions = blocks
  .map((block, index) => ({
    index,
    /* 只看到下一個視窗為止，避免把別人的動作列算成自己的。 */
    head: block,
  }))
  .filter(({ head }) => !/<footer|className="modal-actions"/.test(head.slice(0, 40000)));
ok(
  "每一個視窗都有動作列（<footer 或 .modal-actions）",
  withoutActions.length === 0,
  withoutActions.map((item) => `第 ${item.index + 1} 個`).join("、"),
);

const css = readFileSync(join(here, "..", "app", "globals.css"), "utf8");
ok(
  "樣式表裡有「動作列一律黏住」這條規則",
  /\.modal footer,\s*\.modal \.modal-actions\s*\{[^}]*position:\s*sticky/.test(css),
);

/* ══════════════════════════════════════════════════════════════════
 * 二、瀏覽器實測
 * ══════════════════════════════════════════════════════════════════ */
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

/* 造一份夠長的路口資料，讓匯入預覽與路口設定兩個視窗都真的需要捲。 */
function workbook() {
  const width = 14;
  const arms = ["A", "B", "C", "D"];
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const hours = Array.from(
    { length: 24 },
    (_unused, hour) =>
      `${String(hour).padStart(2, "0")}:00~${String((hour + 1) % 24).padStart(2, "0")}:00`,
  );
  const rows = Array.from({ length: 6 + hours.length }, () =>
    Array(arms.length * width).fill(null),
  );
  arms.forEach((code, index) => {
    const cell = index * width;
    rows[0][cell] = "站號：A00T00-01";
    rows[1][cell] = "站名：動作列測試路口";
    rows[2][cell] = "日期：115年04月15日（平日）";
    rows[3][cell] = `路口編號：路口${code}`;
    rows[4][cell] = "時段";
    vehicles.forEach((vehicle, vehicleIndex) => {
      for (let offset = 0; offset < 3; offset += 1)
        rows[4][cell + 1 + vehicleIndex * 3 + offset] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][cell + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    hours.forEach((label, hourIndex) => {
      rows[6 + hourIndex][cell] = label;
      vehicles.forEach((_unused, vehicleIndex) => {
        movements.forEach((_movement, movementIndex) => {
          rows[6 + hourIndex][cell + 1 + vehicleIndex * 3 + movementIndex] =
            3 + ((index + vehicleIndex + movementIndex + hourIndex) % 9);
        });
      });
    });
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  /* ⚠️ 視窗刻意矮一點，才逼得出「內容比視窗長」的情形。 */
  viewport: { width: 1440, height: 720 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(event.type() === "prompt" ? "N" : ""));
await page.goto(base);
await page.waitForTimeout(1200);

const ACTION_WORDS = ["取消", "確認", "關閉", "儲存", "建立", "套用", "匯入", "刪除"];

/**
 * 量目前畫面上的視窗。
 *
 * ⚠️ 一定要先把視窗捲到**最上面**再量——捲到底當然看得見，那是使用者抱怨的原狀。
 */
async function measure(name) {
  const found = await page.evaluate((words) => {
    const modal = document.querySelector(".modal-backdrop .modal");
    if (!modal) return null;
    modal.scrollTop = 0;
    const bar =
      modal.querySelector(":scope > footer") ??
      modal.querySelector(":scope > .modal-actions") ??
      modal.querySelector("footer") ??
      modal.querySelector(".modal-actions");
    if (!bar) return { noBar: true };
    const style = getComputedStyle(bar);
    const buttons = [...bar.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: (button.textContent || "").replace(/\s+/g, " ").trim(),
        bottom: Math.round(rect.bottom),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      };
    });
    return {
      position: style.position,
      scrollable: modal.scrollHeight - modal.clientHeight,
      viewport: window.innerHeight,
      buttons,
      actionButtons: buttons.filter((button) =>
        words.some((word) => button.text.includes(word)),
      ),
    };
  }, ACTION_WORDS);

  if (!found) {
    ok(`「${name}」視窗打得開`, false, "畫面上找不到視窗");
    return null;
  }
  if (found.noBar) {
    ok(`「${name}」視窗有動作列`, false);
    return null;
  }
  ok(`「${name}」的動作列是 sticky`, found.position === "sticky", found.position);
  const offscreen = found.buttons.filter(
    (button) => button.bottom > found.viewport || button.width === 0,
  );
  ok(
    `「${name}」捲到最上面時，動作列裡的每一顆按鈕都在畫面內（共 ${found.buttons.length} 顆）`,
    offscreen.length === 0,
    offscreen
      .map((button) => `${button.text}(底=${button.bottom}>${found.viewport})`)
      .join("、"),
  );
  ok(
    `「${name}」的動作列裡確實有取消／確認／關閉類的按鈕`,
    found.actionButtons.length > 0,
    found.buttons.map((button) => button.text).join("｜"),
  );
  return found;
}

const measured = [];

/* ── 1. 建立計畫 ── */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
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
measured.push(await measure("建立計畫"));
await page.locator(".modal-backdrop .modal input").first().fill("動作列守門用計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(900);

/* ── 2. 匯入資料 ── */
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
measured.push(await measure("匯入季度資料"));
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "A00T00-01_動作列測試路口.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook(),
  });
await page.waitForTimeout(4000);

/* ── 3. 匯入預覽（最長的一個） ── */
measured.push(await measure("匯入檢核報告"));
const confirm = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirm.count()) {
  await confirm.first().click();
  await page.waitForTimeout(4500);
}

/* ── 4. 車種設定 ── */
if (await page.locator(".vehicle-class-modal").count()) {
  measured.push(await measure("車種分析設定"));
  await page
    .locator('.vehicle-class-modal button:has-text("套用車種設定")')
    .first()
    .click();
  await page.waitForTimeout(1500);
}

/* ── 5. 路口設定（第二長的一個） ── */
if (await page.locator(".intersection-manager-modal").count()) {
  measured.push(await measure("路口角度與轉向判定"));
  await page
    .locator('.intersection-manager-modal button:has-text("儲存設定")')
    .first()
    .click();
  await page.waitForTimeout(1500);
}

const real = measured.filter(Boolean);
ok("前置：真的量到了幾個視窗", real.length >= 4, `${real.length} 個`);
/*
 * ⚠️ 這一條是整支的關鍵前置：**至少一個視窗真的長到需要捲**。
 *   全部都捲不動的話，上面每一條都是恆真——修不修都綠。
 */
const scrollers = real.filter((item) => item.scrollable > 40);
ok(
  "前置：至少一個視窗真的長到需要捲（否則上面全部恆真）",
  scrollers.length > 0,
  real.map((item) => `可捲 ${item.scrollable}px`).join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一個視窗的取消／確認／關閉都在畫面內（捲到最上面時）");
