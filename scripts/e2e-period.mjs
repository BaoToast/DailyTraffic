import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

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
const toasts = [];
const backdropCounts = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8099, r));
const browser = await chromium.launch(launchOptions());
const downloads = mkdtempSync(join(tmpdir(), "traffic-dl-"));
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text()); });
page.on("requestfailed", (r) => { if (!/favicon|og\.png/.test(r.url())) errors.push(`request failed ${r.url()}`); });
page.on("response", (r) => { if (r.status() === 404) console.log("   （404）", r.url()); });
// 匯入路段時系統可能詢問是否沿用既有路段；一律選擇另建
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto("http://localhost:8099/");
await page.waitForTimeout(800);

// ── 建立計畫 ───────────────────────────────────────────────
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false))) {
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
}
await page.locator(".modal-backdrop .modal input").first().fill("測試計畫A");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);
ok("建立計畫", (await page.locator(".toolbar h2").innerText()).includes("測試計畫A"));

// ── 匯入兩份樣本檔（路段 + 路口，各含5車種）─────────────────
async function importFile(name) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q1");
  // 以 buffer 形式送檔：直接給含中文的檔名，避免非 ASCII 路徑在 setInputFiles 靜默失敗
  await page.locator('.modal-backdrop .modal input[accept=".xls,.xlsx"]').setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, name)),
  });
  await page.waitForTimeout(2500);
  // 檢核報告一出現，匯入視窗就應該自己收掉，只剩一個對話框
  backdropCounts.push(await page.locator(".modal-backdrop").count());
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3000); }
  toasts.push(await page.locator(".toast").innerText().catch(() => ""));
  // 車種管理視窗會自動跳出 → 直接套用
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
  if (await apply.count()) { await apply.first().click(); await page.waitForTimeout(500); }
  // 路口幾何視窗
  const geo = page.locator('.intersection-manager-modal button:has-text("關閉"), .intersection-manager-modal button:has-text("取消")');
  if (await geo.count()) { await geo.first().click(); await page.waitForTimeout(600); }
  // 收掉還開著的匯入視窗
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}
await importFile("115T1-01_中山路.xlsx");
await importFile("115T1-02_中正路口.xlsx");

ok("檢核報告跳出時，原本的匯入視窗會自動關閉（只剩一個對話框）",
  backdropCounts.length > 0 && backdropCounts.every((n) => n === 1),
  "各次匯入時的對話框數量：" + backdropCounts.join("、"));
ok("匯入不再逐一詢問新車種當量，並提示新車種預設值為1",
  toasts.some((t) => t.includes("當量係數已預設為 1")),
  toasts.map((t) => t.replace(/\n/g, " ").slice(0, 80)).join(" ／ "));

// ── 需求4：新車種當量預設 1 ────────────────────────────────
await page.locator('button:has-text("車種分類與新增當量")').first().click();
await page.waitForTimeout(500);
const vehicleRows = await page.locator(".vehicle-class-table tbody tr").evaluateAll((rows) =>
  rows.map((row) => ({
    label: row.querySelector("strong")?.textContent?.trim(),
    kind: row.querySelector("small")?.textContent?.trim(),
    values: [...row.querySelectorAll("input")].map((i) => ({ v: i.value, disabled: i.disabled })),
  })),
);
console.log("   車種列：", JSON.stringify(vehicleRows.map((r) => [r.label, r.values.map((v) => v.v).join("/")])));
const newVehicles = vehicleRows.filter((r) => r.kind === "新增車種");
ok("偵測到 3 個新車種（大貨車／聯結車／大客車）", newVehicles.length === 3, newVehicles.map((r) => r.label).join("、"));
ok("新車種一般/直行/右轉/左轉PCU全部預設為1",
  newVehicles.every((r) => r.values.every((v) => Number(v.v) === 1 && !v.disabled)));
const coreRows = vehicleRows.filter((r) => r.kind === "原四大類");
ok("原四大類欄位維持鎖定不可編輯", coreRows.length > 0 && coreRows.every((r) => r.values.every((v) => v.disabled)));
const motorcycleBefore = coreRows.find((r) => r.label === "機車");
ok("修改前機車一般PCU顯示 0.5", Number(motorcycleBefore?.values[0].v) === 0.5, String(motorcycleBefore?.values[0].v));
await page.locator('.vehicle-class-modal button:has-text("取消")').first().click();
await page.waitForTimeout(300);

// ── 需求5：外面改 0.42 → 裡面同步顯示 0.42 ──────────────────
const motorcycleInput = page.locator(".factor-grid label", { hasText: "機車" }).locator("input").first();
await motorcycleInput.fill("0.42");
await page.locator('button:has-text("套用係數")').first().click();
await page.waitForTimeout(600);
await page.locator('button:has-text("車種分類與新增當量")').first().click();
await page.waitForTimeout(500);
const afterSync = await page.locator(".vehicle-class-table tbody tr").evaluateAll((rows) =>
  rows.map((row) => ({
    label: row.querySelector("strong")?.textContent?.trim(),
    roadPcu: row.querySelector("input")?.value,
  })),
);
const motorcycleAfter = afterSync.find((r) => r.label === "機車");
ok("外面改成 0.42 後，車種分類內的機車一般PCU同步顯示 0.42",
  Number(motorcycleAfter?.roadPcu) === 0.42, String(motorcycleAfter?.roadPcu));
await page.locator('.vehicle-class-modal button:has-text("套用車種設定")').first().click();
await page.waitForTimeout(600);
// 重新開啟確認持久化
await page.locator('button:has-text("車種分類與新增當量")').first().click();
await page.waitForTimeout(400);
const persisted = await page.locator(".vehicle-class-table tbody tr").evaluateAll(
  (rows) =>
    rows.find((row) => row.querySelector("strong")?.textContent?.trim() === "機車")
      ?.querySelector("input")?.value,
);
await page.locator('.vehicle-class-modal button:has-text("取消")').first().click();
await page.waitForTimeout(300);

// ── 需求1 & 3：獨立的時段車種分析面板 ───────────────────────
await page.locator("#periodAnalysis").scrollIntoViewIfNeeded();
await page.waitForTimeout(400);
const panelExists = await page.locator("#periodAnalysis").count();
ok("時段車種分析面板存在且獨立於其他表單", panelExists === 1);

const readTable = () =>
  page.locator("#periodAnalysis tbody tr").evaluateAll((rows) =>
    rows.map((row) => [...row.querySelectorAll("td")].map((td) => td.innerText.replace(/\n/g, "｜").trim())),
  );
const allPeriods = await readTable();
const periodsSeen = [...new Set(allPeriods.map((r) => r[2].split("｜")[0]))];
ok("四種時段全部呈現", ["全日時段", "全日尖峰小時", "上午尖峰小時", "下午尖峰小時"].every((p) => periodsSeen.includes(p)), periodsSeen.join("、"));
const scopesSeen = [...new Set(allPeriods.map((r) => r[1]))];
ok("路口四個支線與路段兩個方向都各自成列",
  ["駛出路口A", "駛出路口B", "駛出路口C", "駛出路口D", "方向A", "方向B", "雙向合計", "全部支線合計"].every((name) => scopesSeen.includes(name)),
  scopesSeen.join("、"));

const amRow = allPeriods.find((r) => r[2].startsWith("上午尖峰小時"));
const pmRow = allPeriods.find((r) => r[2].startsWith("下午尖峰小時"));
ok("上午尖峰落在 12:00 之前", Number(amRow?.[3].slice(0, 2)) < 12, amRow?.[3]);
ok("下午尖峰落在 12:00 之後", Number(pmRow?.[3].slice(0, 2)) >= 12, pmRow?.[3]);
console.log("   上午尖峰列：", JSON.stringify(amRow));
console.log("   下午尖峰列：", JSON.stringify(pmRow));

// 只顯示上午尖峰
await page.locator("#periodViewSelect").selectOption("am");
await page.waitForTimeout(400);
const amOnly = await readTable();
ok("可切換成僅顯示上午尖峰時段", amOnly.length > 0 && amOnly.every((r) => r[2].startsWith("上午尖峰小時")), `${amOnly.length} 列`);

// 切換顯示數值：百分比
await page.locator("#periodMetricSelect").selectOption("share");
await page.waitForTimeout(400);
const shareRows = await readTable();
const lastCell = shareRows[0].at(-1);
ok("百分比模式合計為 100.0%", lastCell === "100.0%", lastCell);
const shareValues = shareRows[0].slice(4, -1).map((v) => Number(v.replace("%", "")));
ok("各車種百分比加總為 100%", Math.abs(shareValues.reduce((a, b) => a + b, 0) - 100) < 0.35, shareValues.join("+"));

// 切換顯示數值：交通流量 PCU
await page.locator("#periodMetricSelect").selectOption("pcu");
await page.waitForTimeout(400);
const pcuRows = await readTable();
ok("可切換成交通流量（PCU/hr）", pcuRows[0].at(-1) !== "100.0%" && Number(pcuRows[0].at(-1).replace(/,/g, "")) > 0, pcuRows[0].at(-1));

// ── 尖峰時段認定：整個調查點同一時段 vs 各方向各自認定 ──────────
// 預設 point：同一個調查點的每一列（合計與各方向）尖峰時段必須一模一樣，
// 且各方向的 PCU 相加要等於合計那一列，否則那一欄不能拿來對報表。
await page.locator("#periodViewSelect").selectOption("am");
await page.locator("#periodMetricSelect").selectOption("pcu");
await page.locator("#periodPeakScopeSelect").selectOption("point");
await page.waitForTimeout(500);
const pointRows = await readTable();
const byPoint = new Map();
for (const row of pointRows) {
  const list = byPoint.get(row[0]) ?? [];
  list.push(row);
  byPoint.set(row[0], list);
}
let sameWindow = true;
let addsUp = true;
const addUpDetail = [];
for (const [point, list] of byPoint) {
  const windows = new Set(list.map((r) => r[3]));
  if (windows.size !== 1) sameWindow = false;
  const totalRow = list.find((r) => /合計/.test(r[1]));
  const parts = list.filter((r) => !/合計/.test(r[1]));
  if (!totalRow || !parts.length) continue;
  const num = (v) => Number(String(v).replace(/,/g, ""));
  const sum = parts.reduce((a, r) => a + num(r.at(-1)), 0);
  const total = num(totalRow.at(-1));
  if (Math.abs(sum - total) > 0.6) addsUp = false;
  addUpDetail.push(`${point.slice(0, 10)} 各方向相加 ${sum.toFixed(1)} vs 合計 ${total.toFixed(1)}`);
}
ok("預設模式下，同一調查點的各方向尖峰時段完全相同", sameWindow,
  [...byPoint].map(([p, l]) => `${p.slice(0, 8)}:${[...new Set(l.map((r) => r[3]))].join("/")}`).join(" ｜ "));
ok("預設模式下，各方向的 PCU 相加等於合計那一列", addsUp, addUpDetail.join(" ｜ "));

// 切成 direction 仍要正常渲染。（本檔的樣本各方向尖峰剛好同一小時，
// 分辨得出兩種模式差異的是七叉路口實測檔，由 e2e-partial.mjs 負責驗證。）
await page.locator("#periodPeakScopeSelect").selectOption("direction");
await page.waitForTimeout(500);
const dirRows = await readTable();
ok("切成「各方向各自認定」後表格仍正常渲染", dirRows.length === pointRows.length,
  `${dirRows.length} 列（point 模式為 ${pointRows.length} 列）`);
await page.locator("#periodPeakScopeSelect").selectOption("point");
await page.waitForTimeout(400);

// 方向篩選
await page.locator("#periodViewSelect").selectOption("ALL");
await page.locator("#periodMetricSelect").selectOption("count");
const chipLabels = await page.locator("#periodAnalysis .period-scope-chips .chip-toggle").allInnerTexts();
console.log("   方向選單：", JSON.stringify(chipLabels));
ok("方向選單同時列出路段方向與路口支線（代碼重疊時併列名稱）",
  chipLabels.some((t) => t.includes("方向A") && t.includes("駛出路口A")) &&
    chipLabels.some((t) => t.trim() === "駛出路口C") &&
    chipLabels.some((t) => t.trim() === "駛出路口D"),
  chipLabels.join(" / "));
const armChip = page.locator("#periodAnalysis .period-scope-chips .chip-toggle", { hasText: "駛出路口C" }).first();
await armChip.click();
await page.waitForTimeout(400);
const filteredRows = await readTable();
ok("可只顯示指定方向／支線",
  filteredRows.length === 4 && filteredRows.every((r) => r[1] === "駛出路口C"),
  `駛出路口C：${filteredRows.length} 列`);
await page.locator("#periodAnalysis .period-scope-chips .chip-toggle").first().click();
await page.waitForTimeout(300);

// ── 需求3：切換「駛出路口」視角後，面板跟著改成駛出 ───────────
const flowSelect = page.locator('.filters label:has-text("路口流量視角") select');
if (await flowSelect.count()) {
  await flowSelect.selectOption("destination");
  await page.waitForTimeout(800);
  await page.locator("#periodAnalysis").scrollIntoViewIfNeeded();
  const destinationScopes = [...new Set((await readTable()).map((r) => r[1]))];
  ok("切換到駛入路口視角後，時段分析改以駛入支線呈現",
    destinationScopes.some((t) => t.includes("駛入")) || destinationScopes.some((t) => t.includes("未指定駛入")),
    destinationScopes.join("、"));
  await flowSelect.selectOption("origin");
  await page.waitForTimeout(700);
} else {
  ok("切換到駛入路口視角後，時段分析改以駛入支線呈現", false, "找不到路口流量視角選單");
}

// ── 需求2：匯出中心自選項目 ────────────────────────────────
await page.locator('#periodAnalysis button:has-text("設定匯出項目")').click();
await page.waitForTimeout(500);
// 取消全部既有區塊，只留時段分析；時段只留上午/下午尖峰；數值只留車輛數與百分比
for (const label of ["本季交通量、PCU與平假日比較", "歷季全日量與趨勢", "車種組成與歷季比例", "每小時實際量與PCU", "跨計畫比較", "PCU、車種與路口設定", "來源追溯、品質與版本紀錄", "9張可編輯原生圖表"]) {
  const box = page.locator(".export-checks .check-row", { hasText: label }).locator("input");
  if (await box.isChecked()) await box.uncheck();
}
for (const chip of ["全日時段", "全日尖峰小時"]) {
  const btn = page.locator(".export-period-box .chip-toggle", { hasText: new RegExp(`^${chip}$`) }).first();
  if ((await btn.getAttribute("class")).includes("selected")) await btn.click();
}
for (const chip of ["上午尖峰小時", "下午尖峰小時"]) {
  const btn = page.locator(".export-period-box .chip-toggle", { hasText: new RegExp(`^${chip}$`) }).first();
  if (!(await btn.getAttribute("class")).includes("selected")) await btn.click();
}
const pcuChip = page.locator(".export-period-box .chip-toggle", { hasText: "交通流量" }).first();
if ((await pcuChip.getAttribute("class")).includes("selected")) await pcuChip.click();
await page.waitForTimeout(200);

// 存成報表範本
await page.locator(".report-template-box input").fill("A計畫－只要上下午尖峰車輛數與百分比");
await page.locator('.report-template-box button:has-text("儲存目前條件")').click();
await page.waitForTimeout(500);
ok("報表勾選可存成範本", await page.locator('.report-template-box .source-row:has-text("A計畫")').count() > 0);

const dl = page.waitForEvent("download");
await page.locator('.modal-backdrop button:has-text("匯出所選內容")').click();
const download = await dl;
const file = join(downloads, download.suggestedFilename());
await download.saveAs(file);
await page.waitForTimeout(500);

const book = XLSX.read(readFileSync(file), { type: "buffer" });
console.log("   匯出工作表：", book.SheetNames.join(" / "));
ok("匯出只包含勾選的兩張時段工作表",
  book.SheetNames.length === 2 &&
    book.SheetNames.includes("上午尖峰小時車種分析") &&
    book.SheetNames.includes("下午尖峰小時車種分析"),
  book.SheetNames.join("、"));
const sheet = XLSX.utils.sheet_to_json(book.Sheets["上午尖峰小時車種分析"], { header: 1 });
console.log("   欄位：", JSON.stringify(sheet[0]));
console.log("   首列：", JSON.stringify(sheet[1]));
ok("欄位只含車輛數與百分比、不含交通流量",
  sheet[0].some((h) => String(h).includes("車輛數")) &&
    sheet[0].some((h) => String(h).includes("百分比")) &&
    !sheet[0].some((h) => String(h).includes("交通流量")));
ok("匯出列數＝所有調查點×方向（含合計）", sheet.length - 1 === allPeriods.length / 4, `${sheet.length - 1} 列`);

// 套用範本還原勾選
await page.locator('button:has-text("報表批次輸出中心")').first().click();
await page.waitForTimeout(400);
const pcuChipState = await page.locator(".export-period-box .chip-toggle", { hasText: "交通流量" }).first().getAttribute("class");
await page.locator(".export-period-box .chip-toggle", { hasText: "交通流量" }).first().click();
await page.waitForTimeout(200);
await page.locator('.report-template-box .source-row:has-text("A計畫") button:has-text("套用")').click();
await page.waitForTimeout(600);
await page.locator('button:has-text("報表批次輸出中心")').first().click();
await page.waitForTimeout(400);
const restored = await page.locator(".export-period-box .chip-toggle").evaluateAll((els) =>
  els.filter((el) => el.className.includes("selected")).map((el) => el.textContent.trim()),
);
ok("套用範本後勾選完整還原",
  restored.includes("上午尖峰小時") && restored.includes("下午尖峰小時") &&
    !restored.includes("全日時段") && !restored.some((t) => t.includes("交通流量")),
  restored.join("、"));
await page.locator('.modal-backdrop button:text-is("取消")').first().click();

await page.locator('button:has-text("報表批次輸出中心")').first().click();
await page.waitForTimeout(500);
await page.locator(".modal-backdrop .modal").first().screenshot({ path: "/tmp/export-center.png" });
await page.locator('.modal-backdrop button:text-is("取消")').first().click();
await page.waitForTimeout(300);
await page.locator("#periodAnalysis").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator("#periodAnalysis").screenshot({ path: "/tmp/period-panel.png" });
await page.locator(".pcu-settings").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator(".pcu-settings").screenshot({ path: "/tmp/pcu.png" });
await page.locator(".panel.road-chart").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator(".panel.road-chart").screenshot({ path: "/tmp/block.png" });
await page.locator(".chart-grid").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator(".chart-grid").screenshot({ path: "/tmp/grid.png" });
await page.locator(".panel.table-panel").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await page.locator(".panel.table-panel").first().screenshot({ path: "/tmp/table.png" });

ok("重新開啟仍保存 0.42（已寫入 localStorage）", Number(persisted) === 0.42, String(persisted));

// ── 篩選條件必須真的生效（不能留下上一次的列）─────────────────────
// 曾經的 bug：「駛出＋駛入並列」對路段資料會把每一列輸出兩次（路段沒有
// 駛入／駛出之分），造成 React key 撞號；接著再換篩選條件時，舊的列不會被
// 移除，畫面看起來就像「不管怎麼切換，前幾行都不會變」。
const periodBody = async () =>
  page.evaluate(() =>
    [...document.querySelectorAll("#periodAnalysis tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].slice(0, 3).map((td) => td.textContent.trim()),
    ),
  );
await page.locator("#periodAnalysis").scrollIntoViewIfNeeded();
await page.locator("#periodViewSelect").selectOption("ALL");
await page.locator("#periodFlowViewSelect").selectOption("both");
await page.waitForTimeout(800);
const bothRows = await periodBody();
const bothKeys = bothRows.map((r) => r.join("|"));
ok("「駛出＋駛入並列」不會把路段資料重複輸出",
  new Set(bothKeys).size === bothKeys.length,
  `${bothKeys.length} 列、去重後 ${new Set(bothKeys).size} 列`);

await page.locator("#periodViewSelect").selectOption("am");
await page.waitForTimeout(800);
const amRows = await periodBody();
ok("切成「僅顯示上午尖峰」後，每一列都真的是上午尖峰（沒有殘留舊列）",
  amRows.length > 0 && amRows.every((r) => /上午尖峰小時/.test(r[2] ?? "")),
  amRows.map((r) => (r[2] ?? "").slice(0, 8)).join("、"));
const amKeys = amRows.map((r) => r.join("|"));
ok("切換後沒有重複的列", new Set(amKeys).size === amKeys.length,
  `${amKeys.length} 列、去重後 ${new Set(amKeys).size} 列`);

await page.locator("#periodFlowViewSelect").selectOption("follow");
await page.locator("#periodViewSelect").selectOption("ALL");
await page.waitForTimeout(600);

// ── 每個分析區塊都要有自己的篩選列 ───────────────────────────────
const blockChecks = [
  [".panel.road-chart", "路段排名"],
  [".panel.hourly", "每小時趨勢"],
  [".panel.comparison-panel", "平假日比較"],
  [".panel.project-compare", "跨計畫比較"],
  [".panel.table-panel", "明細表"],
];
for (const [selector, label] of blockChecks) {
  const count = await page.locator(`${selector} .block-filters`).count();
  ok(`「${label}」區塊有自己的篩選列`, count >= 1, `${count} 個`);
}
// 在區塊內改季度，最上方要同步（同一組狀態）
const topQuarter = page.locator(".filters select").first();
const blockQuarter = page.locator(".panel.road-chart .block-filters select").first();
const beforeQ = await topQuarter.inputValue();
ok("區塊內的季度與最上方一致", (await blockQuarter.inputValue()) === beforeQ,
  `${await blockQuarter.inputValue()} vs ${beforeQ}`);

// ── 區塊內的篩選列：不必捲回最上方就能換條件 ─────────────────────
await page.locator("#periodAnalysis").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
for (const id of ["#periodQuarterSelect", "#periodDaySelect", "#periodRoadSelect"])
  ok(`時段車種分析區塊內有「${id.replace("#period", "").replace("Select", "")}」篩選器`,
    await page.locator(`#periodAnalysis ${id}`).count() === 1);

// 在區塊內改日別，上方工具列要同步，表格也要跟著變
const topDay = page.locator('.filters select').nth(1);
await page.locator("#periodDaySelect").selectOption("假日");
await page.waitForTimeout(700);
ok("在區塊內改日別，最上方的日別會同步", (await topDay.inputValue()) === "假日",
  await topDay.inputValue());
await page.locator("#periodDaySelect").selectOption("平日");
await page.waitForTimeout(700);
ok("改回平日也同步", (await topDay.inputValue()) === "平日", await topDay.inputValue());

// 反向：在上方改，區塊內也要同步
await topDay.selectOption("假日");
await page.waitForTimeout(700);
ok("在最上方改日別，區塊內的日別也會同步",
  (await page.locator("#periodDaySelect").inputValue()) === "假日");
await topDay.selectOption("平日");
await page.waitForTimeout(700);

// ── 各計畫的 PCU 係數必須互相獨立 ──────────────────────────────
// v20.8 以前只存一組，所有計畫共用：在 B 計畫改成 0.42，切回 A 計畫也會變成
// 0.42，等於把別的計畫的標準套到這個計畫的數據上。
const motorcycleBox = () =>
  page.locator('.factor-grid input, .pcu-factors input').first();
const readMotorcycle = async () => Number(await motorcycleBox().inputValue());
const setMotorcycle = async (value) => {
  await motorcycleBox().fill(String(value));
  await page.locator('button:has-text("套用係數")').first().click();
  await page.waitForTimeout(600);
};
// 目前這個計畫（測試計畫A）先設成 0.5
await setMotorcycle(0.5);
ok("A 計畫設定機車當量 0.5", (await readMotorcycle()) === 0.5, String(await readMotorcycle()));

// 建立第二個計畫，設成 0.42
await page.locator('button[aria-label="建立新計畫"]').first().click();
await page.waitForTimeout(600);
await page.locator(".modal-backdrop .modal input").first().fill("測試計畫B");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(900);
await setMotorcycle(0.42);
ok("B 計畫設定機車當量 0.42", (await readMotorcycle()) === 0.42, String(await readMotorcycle()));

// 切回 A 計畫，必須還是 0.5
await page.locator('.project-list button:has-text("測試計畫A")').first().click();
await page.waitForTimeout(900);
const backToA = await readMotorcycle();
ok("切回 A 計畫時，機車當量仍是 A 自己的 0.5（不會被 B 的 0.42 蓋掉）",
  backToA === 0.5, String(backToA));

// 再切回 B，確認 B 也還在
await page.locator('.project-list button:has-text("測試計畫B")').first().click();
await page.waitForTimeout(900);
const backToB = await readMotorcycle();
ok("再切回 B 計畫時，機車當量仍是 B 自己的 0.42", backToB === 0.42, String(backToB));

// 轉向係數也要各自獨立
const turnStore = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("traffic-turn-pcu-factors-by-project-v1") || "{}"));
ok("轉向 PCU 係數也是每個計畫各存一組",
  Object.keys(turnStore).length >= 2, Object.keys(turnStore).join("、"));

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
