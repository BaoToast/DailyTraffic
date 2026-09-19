/*
 * ══════════════════════════════════════════════════════════════════════
 *  橫跨中午的尖峰：匯入前跳出視窗，選了什麼就算什麼
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「匯入 > 程式一發現 > 詢問 > 確認後 > 立刻按照分類算出正確的上下午尖峰
 *     然後就固定。」
 *   「可以變成讓使用者輸入數字 1.取消不匯入 2.忽略中間這個時段 正常以
 *     00~12 12~00 的方式區分上下午尖峰 3.將此時段歸類為上午尖峰
 *     4.將此時段歸類為下午尖峰」
 *
 * ⚠️ 單元測試守得住「算對不對」，守不住「那顆按鈕有沒有接到計算」。
 *   這一支從瀏覽器按下去，再讀畫面上印出來的時段字串。
 *
 * 測資（15 分鐘一格，只有小型車，PCE 1，所以輛數＝PCU）：
 *   11:45            → 100
 *   12:00/12:15/12:30 → 各 900
 *   07:00～08:00 四格 → 各 200
 *   17:00～18:00 四格 → 各 220
 *   其餘             → 5
 * 手算：
 *   跨中午的 11:45–12:45 ＝ 2800（全天最忙）
 *   上午（整個視窗在 12:00 以前）最忙 ＝ 07:00–08:00 ＝ 800
 *   下午（整個視窗在 12:00 以後）最忙 ＝ 12:00–13:00 ＝ 2705
 * 所以：
 *   選「忽略」→ 上午 07:00～08:00、下午 12:00～13:00
 *   選「上午」→ 上午 11:45～12:45；下午**跳開**它，變成 17:00～18:00
 *   選「下午」→ 下午 11:45～12:45；上午維持 07:00～08:00
 */
import { chromium } from "playwright";
import http from "node:http";
import fs, { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples-noon-straddle");
mkdirSync(SAMPLES, { recursive: true });

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const pad = (n) => String(n).padStart(2, "0");

const levelAt = (minutes) => {
  if (minutes === 11 * 60 + 45) return 100;
  if (minutes >= 12 * 60 && minutes < 12 * 60 + 45) return 900;
  if (minutes >= 7 * 60 && minutes < 8 * 60) return 200;
  if (minutes >= 17 * 60 && minutes < 18 * 60) return 220;
  return 5;
};

function sheetFor(scale) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const to = minutes + 15;
    const label = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}～${pad(Math.floor(to / 60) % 24)}:${pad(to % 60)}`;
    const cells = [];
    for (let direction = 0; direction < 2; direction += 1)
      for (const vehicle of VEHICLES)
        cells.push(
          vehicle === "小型車" ? Math.round(levelAt(minutes) * scale) : 0,
        );
    rows.push([label, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function writeBook(name) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(1), "平日");
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}
const FILE = writeBook("115T7-01_跨中午尖峰測試路段_115Q1.xlsx");

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
await new Promise((r) => server.listen(8213, r));

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
page.on("dialog", (d) => d.accept());

/** 走一次完整匯入，在跨中午視窗出現時選 choice；回傳上午／下午的時段字串。 */
async function importWithChoice(choice) {
  await ctx.clearCookies();
  await page.goto("http://localhost:8213/");
  await page.evaluate(async () => {
    localStorage.clear();
    for (const name of await indexedDB.databases?.() ?? [])
      if (name.name) indexedDB.deleteDatabase(name.name);
  });
  await page.reload();
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
  if (
    !(await page.locator(".modal input").first().isVisible().catch(() => false))
  )
    await page
      .locator('button:has-text("建立第一個")')
      .first()
      .click()
      .catch(() => {});
  await page.locator(".modal-backdrop .modal input").first().fill("跨中午測試");
  await page
    .locator('.modal-backdrop .modal button:has-text("建立")')
    .first()
    .click();
  await page.waitForTimeout(800);

  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill("115Q1");
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name: FILE,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, FILE)),
    });
  await page.waitForTimeout(2600);

  /* 匯入前檢核報告 → 按確認 */
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(1200);
  }

  /* 這裡應該跳出跨中午的詢問視窗 */
  const asked = (await page.locator("#noonQuestions").count()) > 0;
  if (choice === "__check__") return { asked };
  if (asked) {
    await page
      .locator(`#noonQuestions input[type="radio"][value="${choice}"]`)
      .first()
      .check();
    await page.waitForTimeout(300);
    await page.locator("#noonConfirm").click();
    await page.waitForTimeout(2600);
  }

  const applyVehicle = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await applyVehicle.count()) {
    await applyVehicle.first().click();
    await page.waitForTimeout(600);
  }
  for (
    let i = 0;
    i < 4 && (await page.locator(".modal-backdrop").count());
    i += 1
  ) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(900);

  await page
    .locator('.side-nav-group > button:has-text("資料產出")')
    .first()
    .click();
  await page.waitForTimeout(700);
  await page
    .locator('.side-nav-item:has-text("時段車種分析")')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(900);
  const table = await page.evaluate(() => {
    const el = document.querySelector("#periodAnalysis table");
    if (!el) return null;
    return [...el.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("th,td")].map((cell) =>
        (cell.textContent || "").replace(/\s+/g, " ").trim(),
      ),
    );
  });
  const hourFor = (label) => {
    for (const row of table ?? []) {
      if (!row.some((cell) => cell.includes(label))) continue;
      const hit = row.find((cell) => /^\d{1,2}:\d{2}/.test(cell));
      if (hit) return hit;
    }
    return "";
  };
  return {
    asked: true,
    am: hourFor("上午尖峰"),
    pm: hourFor("下午尖峰"),
    day: hourFor("全調查時段尖峰"),
  };
}

/* ── ① 會不會問 ──────────────────────────────────────────── */
console.log("\n══ ① 匯入時要跳出詢問視窗 ══");
const probe = await importWithChoice("__check__");
ok(
  "⚠️ ① 最忙的一小時橫跨中午時，匯入前會跳出詢問視窗",
  probe.asked,
  probe.asked ? "" : "完全沒有問，等於這個情況被安靜地略過了",
);
if (probe.asked) {
  const text = await page.locator("#noonQuestions").first().textContent();
  for (const option of [
    "取消",
    "忽略這個時段",
    "上午尖峰",
    "下午尖峰",
  ])
    ok(
      `① 視窗上有「${option}」這個選項`,
      (text || "").includes(option),
      (text || "").replace(/\s+/g, " ").slice(0, 100),
    );
  ok(
    "⚠️ ① 視窗上要寫出「不選它的話上午／下午會是什麼」",
    /07:00/.test(text || "") && /12:00/.test(text || ""),
    "只給四個選項而不給數字的話，使用者無從判斷",
  );
  ok(
    "① 預設停在「忽略」（不可以預設幫使用者改數字，也不可以預設取消）",
    await page
      .locator('#noonQuestions input[type="radio"][value="ignore"]')
      .first()
      .isChecked(),
  );
}

/* ── ② 三種選擇各自算出什麼 ─────────────────────────────── */
console.log("\n══ ② 選「忽略」 ══");
const ignored = await importWithChoice("ignore");
ok(
  "② 忽略：上午 07:00～08:00（＝改版前的行為）",
  ignored.am.startsWith("07:00"),
  `上午是「${ignored.am}」`,
);
ok(
  "② 忽略：下午 12:00～13:00",
  ignored.pm.startsWith("12:00"),
  `下午是「${ignored.pm}」`,
);

console.log("\n══ ③ 選「算上午」 ══");
const asAm = await importWithChoice("am");
ok(
  "⚠️ ③ 上午換成橫跨中午的 11:45～12:45",
  asAm.am.startsWith("11:45"),
  `上午是「${asAm.am}」`,
);
ok(
  "⚠️ ③ 下午**跳開**那一小時，變成 17:00～18:00（不可以重複計算同一批車）",
  asAm.pm.startsWith("17:00"),
  `下午是「${asAm.pm}」——若還是 12:00～13:00，代表 12:00～12:45 那三格被算了兩次`,
);

console.log("\n══ ④ 選「算下午」 ══");
const asPm = await importWithChoice("pm");
ok(
  "⚠️ ④ 下午換成 11:45～12:45",
  asPm.pm.startsWith("11:45"),
  `下午是「${asPm.pm}」`,
);
ok(
  "④ 上午維持 07:00～08:00",
  asPm.am.startsWith("07:00"),
  `上午是「${asPm.am}」`,
);

console.log("\n══ ⑤ 全調查時段尖峰不受任何選擇影響 ══");
for (const [name, result] of [
  ["忽略", ignored],
  ["算上午", asAm],
  ["算下午", asPm],
])
  ok(
    `⑤ ${name}：全調查時段尖峰仍是 11:45～12:45`,
    result.day.startsWith("11:45"),
    `是「${result.day}」`,
  );

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 橫跨中午的尖峰：會問、四個選項都在、選什麼就算什麼");
