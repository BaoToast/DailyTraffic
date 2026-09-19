/*
 * ══════════════════════════════════════════════════════════════════════
 *  「建立與管理計畫」每一列都能修改，而且改到的是**那一列**的計畫
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：「針對計畫，我們要可以手動編輯計畫名稱／計畫編號等資訊，
 * 但全日交通量似乎沒有作到這件事」。
 *
 * 查證結果：功能**本來就有**，在工具列的「管理計畫」——但它只能改
 * 「目前這一個」計畫；而使用者是在「建立與管理計畫」那一頁上看全部計畫的，
 * 那一頁上只有「切換到這個」與「刪除」，所以看起來像沒有這個功能。
 * 修法是每一列補一顆「修改」，並讓視窗認得「要改哪一個」。
 *
 * ⚠️ 這支測試真正要擋的是**改到／刪到錯的計畫**。
 *   刪除那條路徑踩過一模一樣的坑：先 setActiveProject(id) 再呼叫，
 *   而 setState 是非同步的，於是處理到的是切換**前**那一個，
 *   畫面上看起來卻一切正常。所以這裡一定要用**非目前**的那一列來測。
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
await new Promise((r) => server.listen(8193, r));

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
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8193/");
await page.waitForTimeout(900);

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
  await page.waitForTimeout(800);
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  視窗裡並排的欄位要對齊
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：「新建計畫，業主欄位跑掉，有點偏下，沒有與旁邊對齊」。
 *
 * 成因：.modal label 自己是 display:grid，而「計畫編號」底下多一行字數說明、
 * 「業主」沒有——兩欄在 .two-col 裡被拉成一樣高之後，列高被平均分掉，
 * 少一行的那一欄輸入框就被撐高、看起來往下掉。
 *
 * ⚠️ 驗的是**輸入框上緣的 y 座標相同**，不是「有沒有補說明文字」。
 *   補一行說明只是讓兩欄剛好一樣高，下次有人加一行字又會歪掉。
 */
console.log("\n══ 視窗裡並排欄位的對齊 ══");
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
await page.waitForTimeout(600);
const twoCol = await page.evaluate(() =>
  [...document.querySelectorAll(".modal .two-col")].map((row) =>
    [...row.querySelectorAll(":scope > label")].map((label) => {
      const input = label.querySelector("input, select");
      const box = input?.getBoundingClientRect();
      return {
        label: (label.childNodes[0]?.textContent || "").trim(),
        top: box ? Math.round(box.top) : -1,
        height: box ? Math.round(box.height) : -1,
      };
    }),
  ),
);
ok(
  "前置：視窗裡有並排的欄位可以量",
  twoCol.length > 0 && twoCol[0].length >= 2,
  twoCol.map((r) => r.map((c) => c.label).join("／")).join("｜"),
);
for (const [index, row] of twoCol.entries()) {
  const tops = row.map((c) => c.top);
  const heights = row.map((c) => c.height);
  ok(
    `第 ${index + 1} 排並排欄位的輸入框上緣齊平（${row.map((c) => c.label).join("／")}）`,
    Math.max(...tops) - Math.min(...tops) <= 1,
    row.map((c) => `${c.label} y=${c.top}`).join("、"),
  );
  ok(
    `第 ${index + 1} 排並排欄位的輸入框高度相同（沒有被格線拉長）`,
    Math.max(...heights) - Math.min(...heights) <= 1,
    row.map((c) => `${c.label} h=${c.height}`).join("、"),
  );
}
await page
  .locator('.modal-backdrop button:has-text("取消")')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(500);

/* 三個計畫；建立順序讓最後一個成為「目前計畫」。 */
await newProject("計畫甲");
await newProject("計畫乙");
await newProject("計畫丙");

await page
  .locator('.sidebar-heading-link[data-goto-item="建立與管理計畫"]')
  .first()
  .click();
await page.waitForTimeout(800);

const rows = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".portfolio-row")].map((row) => ({
      name: row.querySelector(".portfolio-main strong")?.textContent?.trim() || "",
      code: row.querySelector(".portfolio-code")?.textContent?.trim() || "",
      current: row.classList.contains("current"),
      buttons: [...row.querySelectorAll("button")].map((b) =>
        b.textContent.trim(),
      ),
    })),
  );

const before = await rows();
ok("前置：三個計畫都在清單上", before.length === 3, before.map((r) => r.name).join("、"));
ok(
  "每一列都有「修改」",
  before.length > 0 && before.every((r) => r.buttons.includes("修改")),
  before.map((r) => `${r.name}[${r.buttons.join("/")}]`).join("、"),
);

/*
 * ⚠️ 刻意挑**不是目前計畫**的那一列。
 *   目前計畫那一列就算程式寫錯（改到「目前這一個」）也會剛好正確，
 *   等於測不到東西。
 */
const target = before.find((r) => !r.current);
const currentBefore = before.find((r) => r.current);
ok(
  "前置：找得到一個不是「目前計畫」的列可以測",
  Boolean(target) && Boolean(currentBefore),
  `要改的「${target?.name}」／目前是「${currentBefore?.name}」`,
);

const rowLocator = page
  .locator(".portfolio-row")
  .filter({ hasText: target.name });
await rowLocator.locator('button:has-text("修改")').first().click();
await page.waitForTimeout(600);

const modal = await page.evaluate(() => {
  const form = document.querySelector(".modal-backdrop .modal");
  if (!form) return null;
  return {
    heading: form.querySelector("h3")?.textContent?.trim() || "",
    nameValue: form.querySelector("input")?.value || "",
  };
});
ok("視窗開得起來", Boolean(modal));
if (modal) {
  ok(
    "⚠️ 視窗的抬頭寫的是**按下那一列**的計畫，不是目前計畫",
    modal.heading.includes(target.name) &&
      !modal.heading.includes(currentBefore.name),
    `抬頭「${modal.heading}」，按的是「${target.name}」，目前是「${currentBefore.name}」`,
  );
  ok(
    "欄位帶入的是那一個計畫現有的名稱",
    modal.nameValue === target.name,
    `欄位「${modal.nameValue}」`,
  );
}

const NEW_NAME = "改過的計畫名稱";
const NEW_CODE = "Z-999";
await page.locator(".modal-backdrop .modal input").nth(0).fill(NEW_NAME);
await page.locator(".modal-backdrop .modal input").nth(1).fill(NEW_CODE);
await page
  .locator('.modal-backdrop .modal button:has-text("儲存修改")')
  .first()
  .click();
await page.waitForTimeout(1200);

const after = await rows();
ok(
  "⚠️ 改到的是那一列的計畫（名稱與編號都換了）",
  after.some((r) => r.name === NEW_NAME && r.code === NEW_CODE),
  after.map((r) => `${r.code}／${r.name}`).join("、"),
);
ok(
  "⚠️ 目前計畫**沒有**被改到（這正是舊路徑踩過的坑）",
  after.some((r) => r.current && r.name === currentBefore.name),
  `目前計畫現在是「${after.find((r) => r.current)?.name}」，原本是「${currentBefore.name}」`,
);
ok(
  "計畫數量沒有變（是修改，不是多建一個）",
  after.length === before.length,
  `${before.length} → ${after.length}`,
);
ok(
  "哪一個是「目前計畫」沒有被改動（修改不等於切換）",
  after.filter((r) => r.current).length === 1 &&
    after.find((r) => r.current)?.name === currentBefore.name,
  after.map((r) => `${r.name}${r.current ? "（目前）" : ""}`).join("、"),
);

/* 重新整理之後還在——不是只改了畫面上的 state。 */
await page.reload();
await page.waitForTimeout(1600);
await page
  .locator('.sidebar-heading-link[data-goto-item="建立與管理計畫"]')
  .first()
  .click();
await page.waitForTimeout(800);
const reloaded = await rows();
ok(
  "重新整理之後改動還在（真的存起來了）",
  reloaded.some((r) => r.name === NEW_NAME && r.code === NEW_CODE),
  reloaded.map((r) => `${r.code}／${r.name}`).join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 每一列都能修改，而且改到的是那一列的計畫");
