/*
 * ══════════════════════════════════════════════════════════════════
 *  「各路段平日與假日比較」的車流方向篩選必須真的生效
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者實測回報（2026-09-10）：
 *   「各路段平日與假日比較，選車流方向，長條圖不會變」
 *
 * 成因：dayComparisons 讀的是 analysisRecords（未套方向篩選的那一份），
 * 過濾條件只有季度、路段、搜尋字串，**完全沒有呼叫 matchesDirection()**。
 * 而同一個面板卻印出了方向複選——**畫面上給了一個不會生效的控制項**。
 * 這比「沒有這個功能」更糟：使用者會以為自己已經篩選過了，
 * 然後把那個數字當成單方向的量寫進報告。
 *
 * ── ⚠️ 這一支刻意迴避的假通過陷阱 ────────────────────────────
 *
 * 一、只驗「圖還畫得出來」是恆真——壞掉的版本也畫得出來。
 *     一定要驗**勾單一方向時值真的改變**。
 * 二、只驗「值改變」也不夠：可能是改壞成別的東西。
 *     所以要驗 **方向A ＋ 方向B ＝ 全部方向**，證明篩的是分組而不是重算。
 * 三、「一個都不勾＝全部方向」這個語意不可以被改壞。
 * 四、**匯出的 Excel 也要跟著篩**。畫面對了、交出去的檔案還是錯的，
 *     是最糟的一種——使用者不會再去核對一次。
 *
 * ⚠️ 另外要確認**沒有順手把 dayType 也加進去**：
 * dayComparisons 刻意不套日別（它本來就要同時拿平日與假日來比），
 * 套了整張圖就廢了。所以最後要驗「平日與假日兩欄都還在」。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".pdf": "application/pdf", ".docx": "application/octet-stream",
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
await new Promise((r) => server.listen(8123, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8123/");
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(800);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("方向篩選測試");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);
/* 路段格式（有方向 A／B）才驗得到方向篩選。 */
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q1");
await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
  name: "115T1-01_中山路.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx")),
});
await page.waitForTimeout(2500);
const confirm = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3000); }
for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page.locator('.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
  if (!(await closer.count())) break;
  await closer.click(); await page.waitForTimeout(500);
}

/* 「各路段平日與假日比較」在「圖表」分頁。 */
await gotoBlock(page, "block-comparison");
await page.locator(".panel.comparison-panel").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);

/**
 * 面板上**逐列**的平日／假日數值。
 *
 * ⚠️ 第一版是「把面板裡所有數字抓出來取最大值與總和」——那是錯的取樣方式，
 * 而且它**自己抓到了自己**：面板裡除了各列的量，還有雙向合計、百分比、
 * 座標寬度等等，加起來永遠對不上，於是「方向A ＋ 方向B ＝ 全部方向」
 * 這條斷言在程式完全正確的情況下也會紅。
 *
 * ⚠️ 守門測不準的時候，**假紅和真缺陷長得一模一樣**，比假綠更浪費時間。
 * 所以改成逐列讀 `.comparison-row`，每一列只取「平日」「假日」那兩個數字。
 */
const readPanel = async () =>
  page.evaluate(() => {
    const panel = document.querySelector(".panel.comparison-panel");
    if (!panel) return null;
    const rows = [...panel.querySelectorAll(".comparison-row")].map((row) => {
      const name = row.querySelector("strong")?.textContent?.trim() ?? "";
      const values = [...row.querySelectorAll(".comparison-bars > span")].map(
        (span) => {
          const text = span.querySelector("strong")?.textContent ?? "";
          if (/未調查/.test(text)) return null;
          const hit = /([\d,]+(?:\.\d+)?)/.exec(text);
          return hit ? Number(hit[1].replace(/,/g, "")) : null;
        },
      );
      return { name, weekday: values[0] ?? null, holiday: values[1] ?? null };
    });
    return {
      rows,
      /* 逐列的平日值加總——這才是可以拿來做「A＋B＝全部」的量。 */
      weekdaySum: rows.reduce((a, r) => a + (r.weekday ?? 0), 0),
      text: panel.innerText.replace(/\s+/g, " ").slice(0, 400),
    };
  });

/**
 * 操作最上面那排共用篩選裡的「車流方向」複選。
 *
 * ⚠️ 做法是「打開面板 → 讀目前每一項的勾選狀態 → 只點需要改變的那幾項」。
 * 第一版是「先按全部方向清空、關閉、再打開、再逐一勾」，
 * 中間的開關讓第二次呼叫有機會落在面板還沒重畫的狀態上——
 * 結果是**篩選根本沒套用**，而畫面看起來一切正常（顯示的就是全部方向的值）。
 * 那種失敗會被誤讀成「程式沒有篩」，實際上是腳本沒點到。
 */
async function pickDirections(names) {
  const button = page.locator('.filters .filter-field:has-text("車流方向") .multi-picker-btn');
  /*
   * ⚠️ 這顆按鈕是 **toggle**（`onClick={() => setOpen(!open)}`）。
   * 無條件 click 的話，面板本來就開著時反而會被關掉——
   * 接著的勾選就完全落空，而畫面看起來一切正常（顯示的還是全部方向）。
   * 前一步讀選項清單時就會把它打開，所以這裡一定要先看 aria-expanded。
   */
  if ((await button.getAttribute("aria-expanded")) !== "true") {
    await button.click();
    await page.waitForTimeout(400);
  }
  await page.evaluate((wanted) => {
    /*
     * ⚠️ 一定要**限定在最上面那一排篩選自己的那個面板**裡。
     * 畫面上同時存在好幾個 .multi-picker-panel（各分析區塊也有自己的篩選列），
     * 用 document.querySelectorAll 會一次點到別人的——實測按鈕計數變成 2，
     * 而那個 2 是「這個面板勾了 1 個、另一個面板也被勾了 1 個」。
     */
    const button = [...document.querySelectorAll(".filters .multi-picker-btn")].find(
      (el) => (el.getAttribute("aria-label") || "").includes("車流方向"),
    );
    const scope = button?.closest(".multi-picker");
    if (!scope) return;
    for (const label of scope.querySelectorAll("label")) {
      const input = label.querySelector("input");
      if (!input) continue;
      const text = label.textContent || "";
      const shouldCheck = wanted.some((name) => text.includes(name));
      if (input.checked !== shouldCheck) input.click();
    }
  }, names);
  await page.waitForTimeout(400);
  /*
   * ⚠️ 確認要在**關閉面板之前**做。面板是條件渲染的，Escape 之後 checkbox
   * 整批從 DOM 消失，這時去數會永遠得到 0——那是腳本在量一個已經不存在的東西。
   *
   * ⚠️ 也不可以讀按鈕的 `data-count`：那是**選項總數**（options.length），
   * 不是已勾選數。第一版誤用它，勾 1 個卻讀到 2。
   *
   * 這兩個錯都會拋出「方向複選沒有套用」，而那句話會被誤讀成「程式沒有篩」——
   * 守門自己看錯指標時，假錯誤和真缺陷長得一模一樣。
   */
  const checked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".filters .multi-picker-btn")].find(
      (el) => (el.getAttribute("aria-label") || "").includes("車流方向"),
    );
    const scope = btn?.closest(".multi-picker");
    return [...(scope?.querySelectorAll('input[type="checkbox"]') ?? [])].filter(
      (input) => input.checked,
    ).length;
  });
  if (checked !== names.length)
    throw new Error(
      `方向複選沒有套用：期望勾 ${names.length} 個，實際勾了 ${checked} 個`,
    );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900);
}

const directionCodes = await page.evaluate(async () => {
  const button = [...document.querySelectorAll(".filters .multi-picker-btn")].find((el) =>
    (el.getAttribute("aria-label") || "").includes("車流方向"),
  );
  button?.click();
  await new Promise((r) => setTimeout(r, 250));
  const scope = button?.closest(".multi-picker");
  const list = [...(scope?.querySelectorAll("label span") ?? [])].map((el) =>
    el.textContent.trim(),
  );
  document.body.click();
  return list;
});
ok("前置：方向複選裡至少有兩個方向", directionCodes.length >= 2, directionCodes.join("／"));

const all = await readPanel();
ok(
  "前置：全部方向時面板有逐列數字",
  all && all.rows.length >= 1 && all.weekdaySum > 0,
  all ? `${all.rows.length} 列、平日合計 ${all.weekdaySum}` : "讀不到面板",
);

await pickDirections([directionCodes[0]]);
const first = await readPanel();
ok(
  "勾單一方向時，平假日比較的數字必須改變（這就是壞掉的那一項）",
  first.weekdaySum > 0 && first.weekdaySum !== all.weekdaySum,
  `全部方向 ${all.weekdaySum}／只勾 ${directionCodes[0]} ${first.weekdaySum}`,
);

await pickDirections([directionCodes[1]]);
const second = await readPanel();
ok(
  "換一個方向，數字也要跟著換",
  second.weekdaySum > 0 && second.weekdaySum !== first.weekdaySum,
  `${directionCodes[0]} ${first.weekdaySum}／${directionCodes[1]} ${second.weekdaySum}`,
);

ok(
  "方向A ＋ 方向B ＝ 全部方向（證明篩的是分組，不是重新算了一套）",
  Math.abs(first.weekdaySum + second.weekdaySum - all.weekdaySum) <= 1,
  `${first.weekdaySum} + ${second.weekdaySum} = ${first.weekdaySum + second.weekdaySum}｜全部 ${all.weekdaySum}`,
);

await pickDirections([]);
const cleared = await readPanel();
ok(
  "一個都不勾 ＝ 全部方向（空陣列的語意不可以被改壞）",
  cleared.weekdaySum === all.weekdaySum,
  `不勾 ${cleared.weekdaySum}／全部 ${all.weekdaySum}`,
);

/*
 * ⚠️ 不可以順手把 dayType 也加進 dayComparisons 的過濾條件。
 * 這個面板本來就要同時拿平日與假日來比，套了日別整張圖就廢了。
 */
ok(
  "平日與假日兩邊都還在（沒有順手把日別也套進去）",
  /平日/.test(all.text) && /假日/.test(all.text),
  all.text.slice(0, 80),
);

/* ── 匯出的 Excel 也要跟著篩 ─────────────────────────────── */
await pickDirections([directionCodes[0]]);
/*
 * ⚠️ X-63：那顆「匯出完整 Excel」掛在**24小時型態**那一塊的標頭上，
 *   而它現在是自己一個大分頁。停在同季平假日那一頁按不到它。
 *   （按鈕本身呼叫的是 exportWorkbook，與停在哪一頁無關——
 *     這也正是下面要驗的：匯出讀的是資料層，不是畫面。）
 */
await gotoBlock(page, "block-hourly");
const dl = page.waitForEvent("download", { timeout: 120000 });
await page.locator('button.panel-export:has-text("匯出完整 Excel")').first().click();
const file = await dl;
const chunks = [];
for await (const chunk of await file.createReadStream()) chunks.push(chunk);
const XLSX = await import("xlsx");
const wb = XLSX.read(Buffer.concat(chunks), { type: "buffer" });
const sheet = wb.Sheets["平假日比較"];
ok("匯出檔有「平假日比較」工作表", Boolean(sheet));
if (sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  /*
   * 逐列讀「平日實際量（輛）」那一欄再加總，與畫面用同一種算法比對。
   * ⚠️ 不可以用「整張表最大的數字」——那會抓到 PCU 欄或百分比欄。
   */
  const header = rows[0].map((cell) => String(cell));
  const column = header.findIndex((name) => /平日實際量/.test(name));
  ok("匯出的平假日比較找得到「平日實際量」欄", column >= 0, header.join("｜"));
  if (column >= 0) {
    const sheetSum = rows
      .slice(1)
      .map((row) => row[column])
      .filter((cell) => typeof cell === "number")
      .reduce((a, b) => a + b, 0);
    ok(
      "匯出的平假日比較也套用了方向篩選（不是畫面對、檔案錯）",
      sheetSum > 0 && Math.abs(sheetSum - first.weekdaySum) <= 1,
      `Excel 合計 ${sheetSum}／畫面 ${first.weekdaySum}`,
    );
  }
}

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

await browser.close();
server.close();
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
