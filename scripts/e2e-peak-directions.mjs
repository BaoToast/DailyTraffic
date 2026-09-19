/*
 * ══════════════════════════════════════════════════════════════════════
 *  尖峰卡片：各方向加起來，必須等於那個日別的合計
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12（附截圖）實測到的**真的算錯**：
 *   方向A 2,792.5（平日 17:00–18:00）
 *   方向B 3,454.0（平日 07:00–08:00）
 *   全部方向同時段合計 6,164.5（平日 07:00–08:00）
 *   2,792.5＋3,454＝6,246.5 ≠ 6,164.5
 *
 * 成因：舊版讓**每一個方向各自再挑一次自己的尖峰**，而合計是先把各方向
 * 同一小時相加再挑尖峰。兩者不是同一個視窗。三個數字並排、標籤還寫
 * 「同時段」，讀的人一定會相加——而相加得到的是一個現實中不存在的數字。
 *
 * ⚠️ 這個錯**只有在各方向的尖峰不同小時時才看得見**。
 *   兩個方向剛好同一小時（很常見）時，加起來剛好對，測試會全綠。
 *   所以這支測試刻意造一份「方向A 傍晚最忙、方向B 早上最忙」的資料——
 *   用一般資料測，這個洞一次都抓不到。
 *
 * 另外釘：平日與假日**各一組**（使用者：「下面的三個數字都是在講平日，
 * 不用列出假日嗎?」），以及卡片上要講清楚它不跟著車流方向篩選走。
 */
import { chromium } from "playwright";
import http from "node:http";
import fs, { readFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./e2e-nav.mjs";

XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples-peak-directions");
mkdirSync(SAMPLES, { recursive: true });

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const pad = (n) => String(n).padStart(2, "0");

/*
 * 兩個方向的尖峰刻意**錯開**：
 *   往北（方向A）→ 17:00 那一小時最大
 *   往南（方向B）→ 07:00 那一小時最大
 * 而兩個方向相加之後，最大的是 07:00（南向的峰比北向的峰高）。
 * 這正是使用者截圖裡的情形。
 */
function sheetFor(base) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let hour = 0; hour < 24; hour += 1) {
    const label = `${pad(hour)}:00～${pad((hour + 1) % 24)}:00`;
    const north = hour === 17 ? 900 : 100;
    const south = hour === 7 ? 1500 : 100;
    const cells = [];
    for (const level of [north, south])
      for (const vehicle of VEHICLES)
        cells.push(vehicle === "機車" ? Math.round(level * base) : 0);
    rows.push([label, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function writeBook(name) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(1), "平日");
  XLSX.utils.book_append_sheet(book, sheetFor(0.6), "假日");
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}
const FILE = writeBook("115T9-01_尖峰錯開測試路段_115Q1.xlsx");

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
await new Promise((r) => server.listen(8207, r));

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
await page.goto("http://localhost:8207/");
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(1300);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("尖峰方向測試");
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
await page.waitForTimeout(2400);
const confirm = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirm.count()) {
  await confirm.first().click();
  await page.waitForTimeout(2600);
}
const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
if (await apply.count()) {
  await apply.first().click();
  await page.waitForTimeout(600);
}
for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page
    .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
    .first();
  if (!(await closer.count())) break;
  await closer.click();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1000);

await page
  .locator('.side-nav-group > button:has-text("資料檢視")')
  .first()
  .click();
await page.waitForTimeout(900);

/*
 * ⚠️ 日別要切到「平日＋假日」。
 *   預設是「平日」，只會有一組——那樣就測不到「兩個日別各一組」，
 *   而使用者踩到的正是那個情況（抬頭兩個數字、下面只列平日）。
 */
await page
  .locator('.filters label:has-text("日別") select, .toolbar label:has-text("日別") select')
  .first()
  .selectOption({ label: "平日＋假日" })
  .catch(() => {});
await page.waitForTimeout(900);

const num = (text) => Number((text || "").replace(/[^\d.]/g, "")) || 0;
const card = await page.evaluate(() => {
  const el = document.getElementById("card-kpi-peak");
  if (!el) return null;
  return {
    note: (el.querySelector(".peak-direction-note")?.textContent || "")
      .replace(/\s+/g, " ")
      .trim(),
    headline: [...el.querySelectorAll(".kpi-day-values strong")].map((s) =>
      s.textContent.replace(/\s+/g, " ").trim(),
    ),
    groups: [...el.querySelectorAll(".peak-directions")].map((group) => ({
      head: (group.querySelector(".peak-directions-head")?.textContent || "").trim(),
      rows: [...group.querySelectorAll("span")].map((span) => ({
        name: (span.querySelector("b")?.textContent || "").trim(),
        value: (span.childNodes[1]?.textContent || "").trim(),
        note: (span.querySelector("em")?.textContent || "").trim(),
        total: span.classList.contains("peak-directions-total"),
      })),
    })),
  };
});
ok("前置：找得到尖峰卡片", Boolean(card));
if (!card) process.exit(1);

/* ── ① 平日與假日各一組 ── */
console.log("\n══ ① 平日與假日各一組 ══");
ok(
  "⚠️ 抬頭有兩個日別，下面就要有兩組（舊版只列一組，而抬頭寫著平日與假日）",
  card.groups.length === 2,
  `抬頭 ${card.headline.length} 個日別、下面 ${card.groups.length} 組`,
);
ok(
  "每一組都標出是哪一個日別的哪一個小時",
  card.groups.every((g) => /平日|假日/.test(g.head) && /\d{2}:\d{2}/.test(g.head)),
  card.groups.map((g) => g.head).join(" ｜ "),
);

/* ── ② 加起來要等於合計（這一支測試的核心） ── */
console.log("\n══ ② 各方向加起來 ＝ 合計 ══");
for (const group of card.groups) {
  const parts = group.rows.filter((r) => !r.total);
  const total = group.rows.find((r) => r.total);
  ok(
    `前置：「${group.head}」這一組有分方向的列可以加`,
    parts.length >= 2 && Boolean(total),
    `${parts.length} 個方向、${total ? "有" : "沒有"}合計`,
  );
  if (parts.length < 2 || !total) continue;
  const sum = parts.reduce((acc, r) => acc + num(r.value), 0);
  ok(
    `⚠️ 「${group.head}」各方向相加 ＝ 合計（舊版兩者差了一整個峰值）`,
    Math.abs(sum - num(total.value)) < 0.05,
    `${parts.map((r) => `${r.name} ${r.value}`).join(" ＋ ")} = ${sum.toFixed(1)}，合計 ${total.value}`,
  );
  /*
   * ⚠️ 算式要**整個寫出來**，不是只寫「相加正確」。
   *   使用者 2026-09-12：「計算我很難幫你驗算……能把你剛寫的換算式
   *   寫在最下方」。他要的是自己按計算機就能核對的東西——
   *   一句「相加正確」是要他相信程式，算式才是證據。
   */
  ok(
    `「${group.head}」合計那一列把算式整個寫出來（使用者要能自己按計算機核對）`,
    parts.every((r) => total.note.includes(r.value.replace(/[^\d.,]/g, ""))) &&
      total.note.includes("＋") &&
      total.note.includes("＝"),
    total.note,
  );
}

/* ── ③ 方向自己最忙的時段不同時，要講出來 ── */
console.log("\n══ ③ 方向自己最忙的時段 ══");
const weekday = card.groups.find((g) => g.head.includes("平日"));
ok(
  "⚠️ 尖峰不同小時的那個方向，要註明它自己最忙是哪一段（不然會被讀成那就是它的尖峰）",
  Boolean(weekday) &&
    weekday.rows.some((r) => !r.total && r.note.includes("自己最忙是")),
  weekday ? weekday.rows.map((r) => `${r.name}：${r.note}`).join(" ｜ ") : "找不到平日那一組",
);

/* ── ④ 卡片要講清楚它不跟著車流方向篩選走 ── */
console.log("\n══ ④ 說明 ══");
ok(
  "④ 卡片明講「不受車流方向篩選影響」",
  card.note.includes("不受") && card.note.includes("車流方向"),
  card.note.slice(0, 60) || "沒有這段說明",
);
ok(
  "④ 也寫出為什麼（要同一個小時才加得起來）",
  card.note.includes("同一個小時"),
  card.note.slice(0, 80),
);
ok(
  "④ 並且說明平日與假日各有自己的尖峰小時（使用者把「同一時段」誤讀成平假日同時段）",
  card.note.includes("各自"),
  card.note.slice(0, 120),
);

/* ── ⑤ 選了某個方向要高亮 ── */
console.log("\n══ ⑤ 選定方向要看得出來 ══");
await page
  .locator('.filters label:has-text("車流方向") button, .toolbar button:has-text("全部方向")')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(500);
const picked = await page.evaluate(() => {
  const options = [...document.querySelectorAll('input[type="checkbox"]')].filter(
    (el) => /方向/.test(el.closest("label")?.textContent || ""),
  );
  if (!options.length) return null;
  options[0].click();
  return (options[0].closest("label")?.textContent || "").trim();
});
await page.waitForTimeout(800);
const highlighted = await page.evaluate(
  () => document.querySelectorAll("#card-kpi-peak .peak-directions > span.picked").length,
);
ok(
  "⑤ 選了一個方向之後，那個方向在下面被標出來",
  picked === null || highlighted > 0,
  picked === null ? "這份資料沒有方向可選，略過" : `選了「${picked}」，標出 ${highlighted} 格`,
);

/*
 * ── ⑥ 「上午＋下午並列」要**兩組**尖峰 ─────────────────────────
 *
 * 使用者 2026-09-15（附圖）：「主工具列調查時段我選擇上/下午尖峰，
 *   尖峰小時當量交通量都有確實跳出數值來，但我選擇上下午尖峰並列時，
 *   卻只顯示 1 筆數值，沒有 2 筆數值（上下午並列），
 *   也沒看到任何不適用的說明」。
 *
 * ⚠️ 這一段要量的是「**時段組數**變成兩倍」，不是「數字有沒有變」。
 *   舊版把 AMPM 攤成 am，所以畫面上仍然有數字、也仍然有平日假日兩組——
 *   只驗「有沒有數字」「有沒有兩組」都會**假綠**。
 * ⚠️ 也要驗每一組的抬頭寫明自己是上午還是下午：兩個數字並排卻分不出
 *   誰是誰，等於沒有並列。
 */
console.log("\n══ ⑥ 上午＋下午並列要兩組 ══");
const groupsUnder = async (choice) => {
  await page.selectOption('[data-testid="mt-period"]', choice);
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const el = document.getElementById("card-kpi-peak");
    return {
      heads: [...el.querySelectorAll(".peak-directions-head")].map((b) =>
        b.textContent.replace(/\s+/g, " ").trim(),
      ),
      values: [...el.querySelectorAll(".kpi-day-values strong")].map((s) =>
        s.textContent.replace(/\s+/g, " ").trim(),
      ),
    };
  });
};
const amOnly = await groupsUnder("am");
const ampm = await groupsUnder("AMPM");
ok(
  "⚠️ 並列時的組數 ＝ 只選上午時的兩倍（舊版把並列攤成上午，組數一樣）",
  ampm.heads.length === amOnly.heads.length * 2 && ampm.heads.length > 0,
  `只選上午 ${amOnly.heads.length} 組、並列 ${ampm.heads.length} 組`,
);
ok(
  "⚠️ 並列時每一組都標出自己是上午還是下午",
  ampm.heads.some((h) => h.includes("上午")) &&
    ampm.heads.some((h) => h.includes("下午")),
  ampm.heads.join(" ｜ "),
);
ok(
  "⚠️ 並列時上面的大數字也要一組一筆（不是只有一筆）",
  ampm.values.length === amOnly.values.length * 2,
  `只選上午 ${amOnly.values.join("／")}；並列 ${ampm.values.join("／")}`,
);
/*
 * ⚠️ 上午與下午的尖峰小時本來就是不同的小時——如果兩組抬頭寫的時段
 *   一模一樣，代表兩組其實是同一段資料印兩次（另一種假綠）。
 */
ok(
  "⚠️ 上午那一組與下午那一組不是同一個時段（兩組不可以是同一批資料印兩次）",
  new Set(ampm.heads).size === ampm.heads.length,
  ampm.heads.join(" ｜ "),
);
await page.selectOption('[data-testid="mt-period"]', "all");
await page.waitForTimeout(500);

/*
 * ── ⑦ 「尖峰時段認定」這張卡必須真的吃 ───────────────────────
 *
 * 大檢查 2026-09-15 查到的錯：這張卡**完全沒有**吃主工具列的
 * 「尖峰時段認定」——底層的 peaksByDayOf() 連這個參數都沒有。
 * 於是切成「各方向各自認定自己的尖峰」時，卡片仍然用
 * 「整個調查點同一時段」算，而且還寫著「全部方向同一時段」，
 * **畫面在說一件與使用者的選擇相反的事**。
 *
 * ⚠️ 要驗的是三件**同時**成立，缺一都可能是假綠：
 *   ① 說明文字換成「各方向各自認定」那一套
 *   ② 逐方向的註記改成「自己最忙的 …」（＝真的換了取值的視窗）
 *   ③ **不再印「全部方向合計」**（不同小時的數字相加是不存在的量）
 */
console.log("\n══ ⑦ 尖峰時段認定要真的作用 ══");
const scopeState = async (value) => {
  await page.selectOption('[data-testid="mt-peak-scope"]', value);
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const el = document.getElementById("card-kpi-peak");
    return {
      note: (el.querySelector(".peak-direction-note")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim(),
      totals: el.querySelectorAll(".peak-directions-total").length,
      noTotals: el.querySelectorAll(".peak-no-total").length,
      rowNotes: [...el.querySelectorAll(".peak-directions > span em")].map((n) =>
        (n.textContent || "").replace(/\s+/g, " ").trim(),
      ),
    };
  });
};
const byPoint = await scopeState("point");
const byDirection = await scopeState("direction");
ok(
  "⚠️ 切成「各方向各自認定」之後，說明文字要跟著換（不可以還寫全部方向同一時段）",
  byDirection.note.includes("各方向各自認定") &&
    !byDirection.note.includes("固定用全部方向合計最大"),
  byDirection.note.slice(0, 80),
);
ok(
  "⚠️ 逐方向的註記要變成「自己最忙的…」（＝真的換了取值的視窗，不只換一句話）",
  byDirection.rowNotes.some((t) => t.includes("自己最忙的")) &&
    !byPoint.rowNotes.some((t) => t.includes("自己最忙的 ")),
  byDirection.rowNotes.slice(0, 2).join(" ｜ "),
);
ok(
  "⚠️ 各方向各自認定時**不印合計**（不同小時相加是一個不存在的數字）",
  byDirection.noTotals > 0 &&
    byPoint.noTotals === 0 &&
    byPoint.totals > 0,
  `同一時段：合計 ${byPoint.totals} 格；各自認定：改成說明 ${byDirection.noTotals} 格`,
);
await page.selectOption('[data-testid="mt-peak-scope"]', "point");
await page.waitForTimeout(500);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 各方向加起來等於合計，平日假日各一組");
