/*
 * 端對端驗證：歷季各表的單位必須逐季標示。
 *
 * 這一支存在的理由，是原本的缺陷用單元測試證不完整——它牽涉到
 * 「畫面目前選的季度」與「匯出的是全部季度」兩件事的交互作用，
 * 只有真的匯入兩個性質不同的季度、真的按下匯出、真的打開產出的
 * Excel 來看，才能確定使用者拿到的檔案是對的。
 *
 * 情境：
 *   115Q1 ── 平日完整 24 小時、假日部分時段 4 小時
 *   115Q2 ── 平日部分時段 4 小時、假日完整 24 小時
 *
 * 舊版行為：畫面停在其中一季，「歷季全日交通量」整張表就會被標成那一季的
 * 單位——停在 115Q1 時，115Q2 那幾列會被標成「全日實際交通量（輛/日）」，
 * 就這樣和真正的全日量並排在同一欄。
 *
 * 期望行為：標題只用中性單位（輛／PCU），每一列各自帶著自己的「調查涵蓋」；
 * 歷季趨勢則把平日與假日的涵蓋分欄，不能混成一個值。
 */
import { chromium } from "playwright";
import http from "node:http";
import * as fs from "node:fs";
import { readFileSync, existsSync, statSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

// SheetJS 0.20.x 的 ESM 版本需要明確綁定 Node.js 檔案系統才能輸出樣本。
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples-coverage");
mkdirSync(SAMPLES, { recursive: true });

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const BASE = { 機車: 900, 小型車: 700, 大貨車: 60, 聯結車: 25, 大客車: 40 };
const pad = (n) => String(n).padStart(2, "0");

function seeded(n) {
  let x = n * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280), x / 233280);
}

/** blocks：[起始時, 結束時] 的清單；stepMinutes 為每格分鐘數。 */
function sheetFor(blocks, stepMinutes, seed, factor) {
  const rnd = seeded(seed);
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (const [from, to] of blocks)
    for (let m = from * 60; m < to * 60; m += stepMinutes) {
      const end = m + stepMinutes;
      const label =
        `${pad(Math.floor(m / 60))}:${pad(m % 60)}～` +
        `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
      const cells = [];
      for (let d = 0; d < 2; d += 1)
        for (const vehicle of VEHICLES)
          cells.push(
            Math.round(
              (BASE[vehicle] * factor * (d ? 0.85 : 1) * (0.92 + rnd() * 0.16) * stepMinutes) /
                60,
            ),
          );
      rows.push([label, ...cells]);
    }
  return XLSX.utils.aoa_to_sheet(rows);
}

function write(name, weekday, holiday) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    sheetFor(weekday.blocks, weekday.step, 1, 1),
    "平日",
  );
  XLSX.utils.book_append_sheet(
    book,
    sheetFor(holiday.blocks, holiday.step, 2, 0.78),
    "假日",
  );
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}

const FULL_DAY = { blocks: [[0, 24]], step: 60 };
const PARTIAL_DAY = { blocks: [[7, 9], [17, 19]], step: 15 };
/*
 * 同一季度的平日與假日刻意使用不同涵蓋範圍，才能抓到「歷季趨勢只有
 * 一個調查涵蓋欄」的歧義；兩季再互換，避免只測到固定欄位順序。
 */
const Q1 = write("115T1-01_中山路.xlsx", FULL_DAY, PARTIAL_DAY);
const Q2 = write("115T1-01_中山路_部分時段.xlsx", PARTIAL_DAY, FULL_DAY);

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
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8101, r));
const browser = await chromium.launch(launchOptions());
const downloads = mkdtempSync(join(tmpdir(), "traffic-cov-"));
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

try {
  await page.goto("http://localhost:8101/");
  await page.waitForTimeout(800);

  // ── 建立計畫（流程與 e2e-period.mjs 相同）──────────────────
  await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
  if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
    await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
  await page.locator(".modal-backdrop .modal input").first().fill("涵蓋測試計畫");
  await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
  await page.waitForTimeout(700);

  async function importFile(name, quarter) {
    await page.locator('.toolbar button:has-text("匯入資料")').first().click();
    await page.waitForTimeout(400);
    await page
      .locator('.modal-backdrop .modal label:has-text("資料季度") input')
      .fill(quarter);
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

  await importFile(Q1, "115Q1");
  await importFile(Q2, "115Q2");

  /*
   * 刻意把畫面停在「完整 24 小時」的那一季再匯出——這正是舊版會把
   * 另一季（只調查 4 小時）標成「輛/日」的情形。
   */
  const quarterSelect = page.locator('.filters label:has-text("季度") select').first();
  await quarterSelect.selectOption("115Q1");
  await page.waitForTimeout(1000);
  const shownQuarter = await quarterSelect.inputValue();
  ok("畫面停在完整 24 小時的 115Q1", shownQuarter === "115Q1", `實際「${shownQuarter}」`);

  await page.locator('#periodAnalysis button:has-text("設定匯出項目")').click();
  await page.waitForTimeout(500);
  const dl = page.waitForEvent("download");
  await page.locator('.modal-backdrop button:has-text("匯出所選內容")').click();
  const download = await dl;
  const file = join(downloads, download.suggestedFilename());
  await download.saveAs(file);
  await page.waitForTimeout(500);

  const book = XLSX.read(readFileSync(file), { type: "buffer" });
  console.log("   匯出工作表：", book.SheetNames.join(" / "));

  for (const name of ["歷季全日交通量", "歷季車種組成"]) {
    const sheet = book.Sheets[name];
    ok(`${name} 存在`, Boolean(sheet));
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const headers = rows[0].map((v) => String(v ?? ""));
    const bad = headers.filter((h) =>
      /輛\/日|輛\/調查時段|PCU\/日|PCU\/調查時段|全日實際交通量|調查時段實際交通量|輛／調查日|輛／平假日/.test(
        h,
      ),
    );
    ok(`${name} 的標題不帶時間範圍`, bad.length === 0, bad.join("、"));
    const covIndex = headers.indexOf("調查涵蓋");
    ok(`${name} 有「調查涵蓋」欄`, covIndex >= 0, headers.join(" | "));
    if (covIndex < 0) continue;

    const seen = new Map();
    for (const row of rows.slice(1))
      seen.set(
        `${String(row[0] ?? "")}|${String(row[1] ?? "")}`,
        String(row[covIndex] ?? ""),
      );
    ok(
      `${name}：115Q1 平日標成完整 24 小時`,
      seen.get("115Q1|平日") === "完整24小時",
      `實際「${seen.get("115Q1|平日")}」`,
    );
    ok(
      `${name}：115Q1 假日標成部分時段 4 小時`,
      /^部分時段 4 小時/.test(seen.get("115Q1|假日") ?? ""),
      `實際「${seen.get("115Q1|假日")}」`,
    );
    ok(
      `${name}：115Q2 平日標成部分時段 4 小時`,
      /^部分時段 4 小時/.test(seen.get("115Q2|平日") ?? ""),
      `實際「${seen.get("115Q2|平日")}」`,
    );
    ok(
      `${name}：115Q2 假日標成完整 24 小時`,
      seen.get("115Q2|假日") === "完整24小時",
      `實際「${seen.get("115Q2|假日")}」`,
    );
  }

  const trend = book.Sheets["歷季趨勢"];
  ok("歷季趨勢存在", Boolean(trend));
  if (trend) {
    const rows = XLSX.utils.sheet_to_json(trend, { header: 1, defval: "" });
    const headers = rows[0].map((v) => String(v ?? ""));
    const weekdayCoverage = headers.indexOf("平日調查涵蓋");
    const holidayCoverage = headers.indexOf("假日調查涵蓋");
    ok("歷季趨勢分列平日調查涵蓋", weekdayCoverage >= 0, headers.join(" | "));
    ok("歷季趨勢分列假日調查涵蓋", holidayCoverage >= 0, headers.join(" | "));
    const byQuarter = new Map(rows.slice(1).map((row) => [String(row[0]), row]));
    const q1 = byQuarter.get("115Q1") ?? [];
    const q2 = byQuarter.get("115Q2") ?? [];
    ok(
      "歷季趨勢：115Q1 平日完整、假日部分時段",
      q1[weekdayCoverage] === "完整24小時" &&
        /^部分時段 4 小時/.test(String(q1[holidayCoverage] ?? "")),
      `${q1[weekdayCoverage]} / ${q1[holidayCoverage]}`,
    );
    ok(
      "歷季趨勢：115Q2 平日部分時段、假日完整",
      /^部分時段 4 小時/.test(String(q2[weekdayCoverage] ?? "")) &&
        q2[holidayCoverage] === "完整24小時",
      `${q2[weekdayCoverage]} / ${q2[holidayCoverage]}`,
    );
  }

  /*
   * 同季平假日比較不能只看其中一個日別的涵蓋來標整列單位；兩邊調查
   * 時段不同時，也不能產生看似精確、實際上不可比的差值與百分比。
   */
  const dayComparison = book.Sheets["平假日比較"];
  ok("平假日比較存在", Boolean(dayComparison));
  if (dayComparison) {
    const rows = XLSX.utils.sheet_to_json(dayComparison, { header: 1, defval: "" });
    const headers = rows[0].map((v) => String(v ?? ""));
    const weekdayCoverage = headers.indexOf("平日調查涵蓋");
    const holidayCoverage = headers.indexOf("假日調查涵蓋");
    const difference = headers.indexOf("平假日差（輛）");
    const percentage = headers.indexOf("假日相較平日（%）");
    ok("平假日比較分列兩種日別的調查涵蓋", weekdayCoverage >= 0 && holidayCoverage >= 0, headers.join(" | "));
    ok("平假日比較使用中性數量單位", headers.includes("平日實際量（輛）") && headers.includes("假日實際量（輛）"), headers.join(" | "));
    const row = rows[1] ?? [];
    ok(
      "涵蓋不同時，各日別仍顯示自己的調查範圍",
      row[weekdayCoverage] === "完整24小時" &&
        /^部分時段 4 小時/.test(String(row[holidayCoverage] ?? "")),
      `${row[weekdayCoverage]} / ${row[holidayCoverage]}`,
    );
    ok(
      "涵蓋不同時，不計算平假日差與百分比",
      row[difference] === "" && row[percentage] === "",
      `差值=${row[difference]} / 百分比=${row[percentage]}`,
    );
  }

  /*
   * 反面確認：單季的工作表**應該**保留明確單位（它只有一季，標得出來），
   * 這次修正不得波及它們。少了這一條，把全系統的單位都拔掉也會「通過測試」。
   * 畫面停在完整 24 小時的 115Q1，所以這裡應該是「輛/日」。
   */
  const singleName = book.SheetNames.find((n) => /^本季|^全日交通量/.test(n));
  ok("找得到單季工作表", Boolean(singleName), book.SheetNames.join(" / "));
  if (singleName) {
    const headers = XLSX.utils
      .sheet_to_json(book.Sheets[singleName], { header: 1, defval: "" })[0]
      .map((v) => String(v ?? ""));
    ok(
      `單季工作表「${singleName}」仍標明「輛/日」`,
      headers.some((h) => /輛\/日/.test(h)) &&
        headers.some((h) => /全日實際交通量/.test(h)),
      headers.join(" | "),
    );
    ok(
      `單季工作表不得誤標成部分時段`,
      !headers.some((h) => /調查時段/.test(h)),
      headers.filter((h) => /調查時段/.test(h)).join("、"),
    );
  }

  ok("沒有 JavaScript 例外", jsErrors.length === 0, jsErrors.join(" / "));
} finally {
  await browser.close();
  server.close();
}

if (problems.length) {
  console.error(
    `\n❌ ${problems.length} 項未通過：\n` +
      problems.map((p) => "  - " + p).join("\n"),
  );
  process.exit(1);
}
console.log("\n✅ 歷季各表的單位逐季標示，單季工作表未受影響。");
