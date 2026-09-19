/**
 * 專門檢查匯出的 .xlsx 會不會讓 Excel 跳出「部分內容有問題／是否修復」。
 * 做法：實際跑一次完整匯出（含 9 張原生圖表），把產出的 zip 逐一拆開驗證：
 *  - 每個 XML 都必須能被嚴格的 XML parser 解析
 *  - [Content_Types].xml 必須涵蓋所有 part
 *  - 每個 .rels 指到的目標 part 都必須真的存在
 *  - drawing / chart 之間的 r:id 必須對得上
 * 這些正是 Excel 判定「需要修復」的主要原因。
 */
import { chromium } from "playwright";
import http from "node:http";
import {
  readFileSync,
  existsSync,
  statSync,
  mkdtempSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock, ensureToolbarOpen } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".docx": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8103, r));
const browser = await chromium.launch(launchOptions());
const downloads = mkdtempSync(join(tmpdir(), "traffic-xlsx-"));
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text()))
    errors.push(m.text());
});
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto("http://localhost:8103/");

/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */

await page.waitForTimeout(1200);

await ensureToolbarOpen(page);
await page.waitForTimeout(800);

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
await page.locator(".modal-backdrop .modal input").first().fill("匯出測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

async function importFile(name) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill("115Q1");
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, name)),
    });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3000);
  }
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(500);
  }
  const geo = page.locator(
    '.intersection-manager-modal button:has-text("關閉"), .intersection-manager-modal button:has-text("取消")',
  );
  if (await geo.count()) {
    await geo.first().click();
    await page.waitForTimeout(600);
  }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}
await importFile("115T1-01_中山路.xlsx");
await importFile("115T1-02_中正路口.xlsx");
/* 明確切到兩種日別並列，才能守住「平日＋假日不可相加」的裁示。 */
await page.locator('[data-testid="mt-day"]').selectOption("平日＋假日");
await page.waitForTimeout(900);

/*
 * 全部項目都勾（預設就是全勾），直接匯出完整 .xlsx。
 * ⚠️ 那顆「匯出完整 Excel」在「24小時型態」面板上，而該面板在
 *「圖表」分頁——v20.64 起別頁的元素不在 DOM 裡。
 */
/* ⚠️ X-63：「24小時型態」現在自己一個大分頁。 */
await gotoBlock(page, "block-hourly");
const dl = page.waitForEvent("download", { timeout: 120000 });
await page
  .locator('button.panel-export:has-text("匯出完整 Excel")')
  .first()
  .click();
const download = await dl;
const file = join(downloads, "export.xlsx");
await download.saveAs(file);
const bytes = readFileSync(file);
console.log("   匯出檔大小：", bytes.length, "bytes");
ok("匯出檔非空", bytes.length > 10000, `${bytes.length} bytes`);

// ── 依 ECMA-376 檢查（Excel 判定「需要修復」的規則）──────────
const { checkWorkbook } = await import("./ooxml-check.mjs");
const report = await checkWorkbook(bytes);
console.log("   part 數：", report.parts.length, "／圖表數：", report.charts.length);
/*
 * ⚠️ v20.64 從 9 張變 8 張：「跨計畫比較」那張隨功能移除
 *（使用者 2026-09-09 授權）。這是張數少了，不是圖產不出來。
 */
ok("7 張原生圖表都有產生", report.charts.length === 7, `${report.charts.length} 張`);
for (const issue of report.issues) console.log("   ⚠", issue);
ok(
  "Excel 開檔不會跳出修復提示（OOXML 結構全部合規）",
  report.issues.length === 0,
  report.issues.length ? `${report.issues.length} 項不合規` : "",
);

/*
 * 2026-09-19 使用者裁示：歷季組成圖表資料必須逐調查點、逐日別，
 * 不得把不同調查點或平日／假日先加在一起再算比例。
 * 這裡用兩個調查點 × 兩種日別，反面守住「只剩一個季度合併列」的舊錯。
 */
const parsed = XLSX.read(bytes, { type: "buffer" });
const compositionSheet = parsed.Sheets["歷季組成圖表資料"];
const compositionRows = compositionSheet
  ? XLSX.utils.sheet_to_json(compositionSheet, { defval: "" })
  : [];
const compositionHeaders = compositionSheet
  ? XLSX.utils.sheet_to_json(compositionSheet, { header: 1, defval: "" })[0] ?? []
  : [];
ok(
  "歷季組成圖表資料有調查點與日別維度",
  compositionHeaders.includes("調查點編號") &&
    compositionHeaders.includes("調查點") &&
    compositionHeaders.includes("日別"),
  compositionHeaders.join("｜"),
);
const pointDayKeys = new Set(
  compositionRows.map(
    (row) => `${row["調查點編號"]}｜${row["調查點"]}｜${row["日別"]}`,
  ),
);
ok(
  "平日＋假日匯出時，每個調查點的兩種日別各自成列，不跨點也不跨日相加",
  compositionRows.length === 4 && pointDayKeys.size === 4,
  `${compositionRows.length} 列／${pointDayKeys.size} 組：${[...pointDayKeys].join("、")}`,
);

// ── 只有路口格式的計畫：前兩張圖不能是空的 ────────────────────
// 「本季交通量及PCU」工作表只放路段格式；整季都是路口時它只有一列提示，
// 前兩張圖就會有座標軸卻一根柱子都沒有。v20.8 起改畫路口各支線。
// 把「路段／路口」篩選器切到只剩那個路口，這一季就只有路口格式了
/*
 * ⚠️ 這一段**壞了好幾版都沒有人知道**，因為這支腳本掉出了 npm run e2e。
 *
 * `#roadFilterSelect` 早就從 <select> 改成自訂的多選按鈕
 *（`<button class="multi-picker-btn">` ＋ 一張 .multi-picker-panel 勾選面板），
 * 而這裡還在用 selectOption()——Playwright 會等到逾時，整支腳本崩潰。
 * 那也表示**唯一一支會呼叫 ooxml-check.mjs 的腳本從此沒有再跑過**，
 * 而它守的正是「Excel 開檔會不會跳『部分內容有問題，是否修復』」。
 *
 * 改成操作多選面板本身。篩選列在分頁之外（五頁共用），停在哪一頁都按得到。
 */
await page.click("#roadFilterSelect");
await page.waitForTimeout(300);
const intersectionOption = await page.evaluate(() => {
  const labels = [...document.querySelectorAll(".multi-picker-panel label")];
  const hit = labels.find((el) => /中正路口/.test(el.textContent || ""));
  if (!hit) return "";
  hit.querySelector("input").click();
  return (hit.textContent || "").trim();
});
await page.keyboard.press("Escape");
await page.waitForTimeout(900);
ok("找得到路口格式的調查點可以單獨篩選", !!intersectionOption, intersectionOption || "找不到「中正路口」");
console.log("   已篩選為：", intersectionOption);

/* ⚠️ X-63：「24小時型態」現在自己一個大分頁。 */
await gotoBlock(page, "block-hourly");
const dl2 = page.waitForEvent("download", { timeout: 120000 });
await page
  .locator('button.panel-export:has-text("匯出完整 Excel")')
  .first()
  .click();
const download2 = await dl2;
const file2 = join(downloads, "intersection-only.xlsx");
await download2.saveAs(file2);
const bytes2 = readFileSync(file2);
const report2 = await checkWorkbook(bytes2);
for (const issue of report2.issues) console.log("   ⚠", issue);
ok("只有路口格式時，匯出檔結構仍然合規", report2.issues.length === 0,
  report2.issues.length ? `${report2.issues.length} 項不合規` : "");

const JSZip2 = (await import("jszip")).default;
const zip2 = await JSZip2.loadAsync(bytes2);
const chartText = async (n) => zip2.file(`xl/charts/chart${n}.xml`)?.async("string") ?? "";
const chart1 = await chartText(1);
const chart2 = await chartText(2);
const pointsIn = (xml) => (xml.match(/<c:pt idx="\d+"><c:v>/g) ?? []).length;
const refsIn = (xml) => [...xml.matchAll(/<c:f>([^<]*)<\/c:f>/g)].map((m) => m[1]);
console.log("   chart1 參照：", JSON.stringify(refsIn(chart1)), "資料點", pointsIn(chart1));
console.log("   chart2 參照：", JSON.stringify(refsIn(chart2)), "資料點", pointsIn(chart2));
ok("整季只有路口格式時，第 1 張圖改參照「路口…交通量」工作表",
  refsIn(chart1).every((f) => /路口.*交通量/.test(f)), refsIn(chart1).join(" ｜ "));
ok("整季只有路口格式時，第 2 張圖改參照「路口…交通量」工作表",
  refsIn(chart2).every((f) => /路口.*交通量/.test(f)), refsIn(chart2).join(" ｜ "));
ok("這兩張圖確實有資料點（不再是空白圖）",
  pointsIn(chart1) >= 2 && pointsIn(chart2) >= 2,
  `chart1 ${pointsIn(chart1)} 點、chart2 ${pointsIn(chart2)} 點`);

writeFileSync(join(downloads, "parts.txt"), report.parts.join("\n"));
console.log("   產出保留於：", downloads);
ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

await browser.close();
server.close();
console.log(problems.length ? "\n❌ 有問題：\n" + problems.join("\n") : "\n全部通過");
process.exit(problems.length ? 1 : 0);
