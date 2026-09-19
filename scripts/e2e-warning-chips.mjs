/*
 * ══════════════════════════════════════════════════════════════════════
 *  匯入「需注意」：逐筆列出 ＋ 類型標籤篩選 ＋ 筆數對得上
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（附兩張截圖）：
 *   「全日交通量資料匯入了，有 22 筆提醒項目，但底下列出的並沒有這麼多，
 *     感覺只是展示前幾筆而已……能像『歷季異常提醒』那樣，列表展示當前匯入
 *     有異常的項目，並且有篩選功能，可以明顯看到發生了 ABCD 四個類型資料異常，
 *     點了 A 標籤就列出 A 異常的事件，如果都沒點任何標籤，表格就全列出全部。」
 *   「我可以很直觀知道異常有幾個種類，可以**選擇最重大的異常先挑出來看**哪幾筆，
 *     也不會因為筆數太多而沒注意到細節。」
 *
 * ⚠️ 舊版是 `incompleteGroups.slice(0, 12)`——**畫面上沒有一句話說被截斷了**。
 *   「只顯示前 N 筆」本身不是錯，**不講才是錯**。
 *
 * 這一支驗五件事：
 *   ① 標籤上的筆數**加總** ＝ 全列時的列數（不可以有被吃掉的類型）
 *   ② 列數 > 12（證明舊的截斷真的沒了；測資刻意造超過 12 筆）
 *   ③ 點一個標籤 → 只剩該類型
 *   ④ 再點第二個 → 兩類都在（可多選）
 *   ⑤ 清除篩選 → 全部回來
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "github-pages", "dist");
const T = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = http.createServer((q, r) => {
  let p = join(
    root,
    decodeURIComponent(q.url.split("?")[0]).replace(/^\//, "") || "index.html",
  );
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) p = join(root, "index.html");
  r.writeHead(200, { "content-type": T[extname(p)] || "application/octet-stream" });
  r.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, ok));

const problems = [];
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!cond) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * ⚠️ 測資要**刻意造出多種類型、而且總筆數超過 12**。
 *   只造幾筆的話，舊的 slice(0,12) 照樣全綠——那正是這個缺陷活了那麼久的原因。
 *
 * 這份檔案刻意做成：
 *   ・每個調查點只有 3 小時 → 每個「調查點×日別×方向」都會報「未滿 24 小時」
 *   ・8 個調查點 × 2 方向 ＝ 16 組 → 遠超過 12
 *   ・第一個調查點刻意重複一個時段 → 另一種類型（重複鍵值）
 */
const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
/*
 * ⚠️ 第二種類型用「同一個時段重複一列」造出來（＝重複鍵值）。
 *   只造一種類型的話，「可多選」那一條驗不到，
 *   而「多種類型才看得出輕重」正是使用者要這個功能的理由。
 */
function sheetFor(withDuplicate) {
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["", "", "", "", "", "監測日期：115年01月26日(平日)", "", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let h = 7; h < 10; h += 1) {
    const cells = [];
    for (let d = 0; d < 2; d += 1)
      for (let v = 0; v < 5; v += 1) cells.push(100 + h + v * 3 + d * 7);
    const label = `${String(h).padStart(2, "0")}:00～${String(h + 1).padStart(2, "0")}:00`;
    rows.push([label, ...cells]);
    if (withDuplicate && h === 8) rows.push([label, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
function workbookFor(withDuplicate) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(withDuplicate), "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const b = await chromium.launch(launchOptions());
const ctx = await b.newContext({
  viewport: { width: 1600, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForTimeout(1600);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("標籤篩選守門用計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(800);

await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles(
    Array.from({ length: 8 }, (_, i) => ({
      name: `A00T00-${String(i + 1).padStart(2, "0")}_守門路段${i + 1}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: workbookFor(i === 0),
    })),
  );
await page.waitForTimeout(4000);

const has = await page.locator("#importWarnings .warning-items").count();
ok("前置：匯入預覽出現「需注意」的逐筆清單", has > 0);
if (!has) {
  await b.close();
  server.close();
  console.error("\n❌ 沒有清單可驗（不當成通過）");
  process.exit(1);
}

const read = () =>
  page.evaluate(() => ({
    chips: [...document.querySelectorAll(".anomaly-chip")]
      .filter((el) => !el.classList.contains("is-clear"))
      .map((el) => ({
        type: (el.childNodes[0]?.textContent || "").trim(),
        count: Number(el.querySelector("b")?.textContent || 0),
        on: el.classList.contains("is-on"),
      })),
    rows: document.querySelectorAll(".warning-item-list li").length,
    countText: (
      document.querySelector(".warning-items-count")?.textContent || ""
    ).trim(),
  }));

const all = await read();
console.log(
  `\n類型：${all.chips.map((c) => `${c.type}×${c.count}`).join("、")}`,
);
const sum = all.chips.reduce((n, c) => n + c.count, 0);
ok("① 標籤筆數加總 ＝ 全列時的列數", sum === all.rows, `加總 ${sum}、列數 ${all.rows}`);
ok(
  "② 列數超過 12（證明舊的靜默截斷真的沒了）",
  all.rows > 12,
  `${all.rows} 列・${all.countText}`,
);
ok("② 有兩種以上的類型可以篩", all.chips.length >= 2, `${all.chips.length} 種`);

/* ③ 點第一個標籤 */
const first = all.chips[0];
await page.locator(".anomaly-chip").first().click();
await page.waitForTimeout(300);
const one = await read();
ok(
  `③ 點「${first.type}」之後只剩該類型`,
  one.rows === first.count,
  `${one.rows} 列（該類型 ${first.count} 筆）・${one.countText}`,
);
const onlyThatType = await page.evaluate(
  (type) =>
    [...document.querySelectorAll(".warning-item-type")].every(
      (el) => (el.textContent || "").trim() === type,
    ),
  first.type,
);
ok("③ 列出來的每一列都真的是那一個類型（不是只換了數字）", onlyThatType);

/* ④ 再點第二個 → 可多選 */
if (all.chips.length >= 2) {
  const second = all.chips[1];
  await page.locator(".anomaly-chip").nth(1).click();
  await page.waitForTimeout(300);
  const two = await read();
  ok(
    `④ 再點「${second.type}」之後兩類都在（可多選）`,
    two.rows === first.count + second.count,
    `${two.rows} 列（${first.count} ＋ ${second.count}）`,
  );
}

/* ⑤ 清除篩選 */
await page.locator(".anomaly-chip.is-clear").first().click();
await page.waitForTimeout(300);
const back = await read();
ok("⑤ 清除篩選之後全部回來", back.rows === all.rows, `${back.rows} / ${all.rows}`);
ok(
  "⑤ 清除之後沒有任何標籤還是按下的狀態",
  back.chips.every((c) => !c.on),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await b.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 需注意清單：逐筆列出、類型標籤可多選、筆數對得上");
