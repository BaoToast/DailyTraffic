import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
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
const toasts = [];
const backdropCounts = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8147, r));
const browser = await chromium.launch(launchOptions());
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

await page.goto("http://localhost:8147/");
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
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
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
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

// 再匯入一份「數量放大 1.5 倍」的同一路段當作 115Q2，才會真的產生歷季異常。
{
  const source = XLSX.read(readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx")), { type: "buffer" });
  for (const name of source.SheetNames) {
    const sheet = source.Sheets[name];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address];
      if (cell.t === "n" && Number.isFinite(cell.v) && cell.v > 0) cell.v = Math.round(cell.v * 1.5);
    }
  }
  const buffer = XLSX.write(source, { bookType: "xlsx", type: "buffer" });
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q2");
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: "115T1-01_中山路.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(2500); }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:text-is("取消"), .vehicle-class-modal button:has-text("套用車種設定")').first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}

// ── 報告文字草稿 ───────────────────────────────────────────
await page.waitForTimeout(800);
// 切回 115Q1（兩個調查點都有資料），才驗得到跨調查點加總是否正確
/* 時段分析面板在「明細與產出」分頁上（v20.64 起是真的換頁）。 */
await gotoBlock(page, "periodAnalysis");
/*
 * ⚠️ 要換的是**主工具列**的季度，不是時段車種分析那一區自己的季度。
 *
 *   v20.74 起區塊上的 #periodQuarterSelect 只會讓**那一塊**脫離
 *  （使用者：「圖可以自己改，但只影響那一張」），主工具列不動。
 *   照舊寫法改它，草稿裡的「全日實際交通量合計」仍然讀主工具列的 115Q2、
 *   「時段車種分析合計」卻讀脫離後的 115Q1——同一份文件裡兩個不同季度的數字
 *  （2026-09-14 實測 115,873 vs 63,195）。
 *   規則因此定成：**圖可以為了看而脫離，交出去的文件一律吃主工具列**。
 *   下面另有一段反面守門，確認脫離不會滲進草稿。
 */
await page.locator('[data-testid="mt-quarter-to"]').selectOption("115Q1");
await page.waitForTimeout(1200);
await page.locator('button:has-text("報表批次輸出中心")').first().click();
await page.waitForTimeout(700);
const draft = await page.evaluate(() => {
  const box = document.querySelector(".report-draft-box");
  if (!box) return null;
  return {
    chips: [...box.querySelectorAll(".chip-check span")].map((s) => s.textContent),
    checked: [...box.querySelectorAll(".chip-check input")].filter((i) => i.checked).length,
    text: box.querySelector("textarea")?.value || "",
  };
});
/* ⚠️ v20.64 移除「跨計畫比較」（使用者授權），段落從 12 個變 11 個。 */
ok("草稿有 11 個可勾選段落，且預設全部勾起",
  draft.chips.length === 11 && draft.checked === 11,
  `${draft.chips.length} 段／勾選 ${draft.checked}`);
ok("草稿含「各調查點分項結果」段落",
  draft.chips.includes("各調查點分項結果"), draft.chips.join("｜"));
ok("匯出中心的 7 個勾選項目，草稿裡都有同名段落",
  ["本季交通量、PCU與平假日比較","歷季全日量與趨勢","車種組成與歷季比例","每小時實際量與PCU",
   "PCU、車種與路口設定","來源追溯、品質與版本紀錄","7張可編輯原生圖表"]
    .every((label) => draft.chips.includes(label)),
  draft.chips.join("｜"));
/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-30 之後：草稿裡**不再有**「全日實際交通量合計」那一句
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16 裁示：多個調查點時逐點敘述、不寫合計
 *（不同地點的交通量相加，那個總和不對應任何一條路的實際流量）。
 *
 * ⚠️ 下面幾條守的是「**同一份草稿裡兩個段落的口徑一致**」——那件事沒有變，
 *   變的只是基準數字要從哪裡讀。所以這裡把逐點的數字**在守門內部**加起來
 *   當基準，而不是把那一條刪掉（刪掉就等於把守門讓給了錯誤）。
 *
 * ⚠️ 這個和**只存在於守門裡**：畫面與草稿上一律不可以出現它。
 *   另有一條反面守門確認草稿文字裡沒有那個數字。
 */
const wholeDayTotalOf = (text) => {
  const single = text.match(/^全日實際交通量合計 ([\d,]+) 輛/m);
  if (single) return Number(single[1].replace(/,/g, ""));
  const each = [...text.matchAll(/全日實際交通量 ([\d,]+) 輛/g)].map((m) =>
    Number(m[1].replace(/,/g, "")),
  );
  return each.length ? each.reduce((a, b) => a + b, 0) : null;
};

// 草稿裡的數字必須與同一份草稿其他段落一致——這是最容易出錯的地方：
// 時段車種分析原本只取第一個調查點，會寫出比總量小一半的數字。
const draftWholeDay = wholeDayTotalOf(draft.text);
/*
 * ⚠️ 這個正規表示式**過期過一次**，而且是在這支腳本掉出 npm run e2e 之後
 * 才過期的——草稿後來加上了「合計」與「/日」，沒有人發現。
 * 現在寫成把「合計」與單位都當成可有可無，改文案不會再讓它假紅；
 * 真正要守的是**兩個數字相等**，不是那一句話長什麼樣。
 */
/*
 * X-31 之後：時段車種分析那一句在多個調查點時是**逐點敘述**，
 * 不再有「實際車輛數合計」。這裡把逐點的數字在守門內部加起來當基準
 *（與 wholeDayTotalOf 同一個道理——守的是兩段口徑一致，不是那一句長什麼樣）。
 *
 * ⚠️ 點位超過上限時是「標題行 ＋ 每點一行（・開頭）」，所以要把接在後面的
 *   ・那幾行一起收進來，不然多點位時會只抓到 0 筆而假紅。
 */
const periodTotalOf = (text) => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith("全調查時段："));
  if (start < 0) return null;
  const block = [lines[start]];
  for (let i = start + 1; i < lines.length && lines[i].startsWith("・"); i += 1)
    block.push(lines[i]);
  const values = [
    ...block.join("\n").matchAll(/實際車輛數(?:合計)? ([\d,]+) 輛/g),
  ].map((m) => Number(m[1].replace(/,/g, "")));
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};
const draftPeriodTotal = periodTotalOf(draft.text);
ok("時段車種分析涵蓋全範圍（不是只取第一個調查點）",
  draftWholeDay !== null && draftPeriodTotal !== null &&
    draftWholeDay === draftPeriodTotal,
  `全日逐點相加 ${draftWholeDay} vs 時段逐點相加 ${draftPeriodTotal}`);
/* ⚠️ X-31 反面：時段那一段也不可以再出現跨調查點的合計。 */
ok("⚠️ 時段車種分析不可以再出現「實際車輛數合計」",
  !/實際車輛數合計/.test(draft.text),
  (draft.text.match(/.{0,24}實際車輛數合計.{0,16}/) || [])[0] || "沒有出現");
ok("⚠️ 時段車種分析逐點列出每一個調查點",
  /全調查時段：.*中山路.*中正路口/.test(draft.text) ||
    /全調查時段：[\s\S]{0,400}?中正路口/.test(draft.text),
  (draft.text.split("\n").find((line) => line.startsWith("全調查時段：")) || "找不到那一行").slice(0, 90));
/* ⚠️ X-30 反面：那個相加出來的數字**不可以出現在草稿文字裡**。 */
ok("⚠️ 草稿裡不可以再出現跨調查點的「全日實際交通量合計」",
  !/全日實際交通量合計/.test(draft.text),
  (draft.text.match(/.{0,20}全日實際交通量合計.{0,20}/) || [])[0] || "沒有出現");
ok("⚠️ 多個調查點時，草稿逐點敘述並說明為什麼不給合計",
  /不同調查點的交通量不可以相加/.test(draft.text),
  (draft.text.match(/本範圍有 \d+ 個調查點[^\n]*/) || [])[0] || "找不到那一句");
ok("兩個調查點都被算進來", /本範圍共 2 個調查點/.test(draft.text), draft.text.split("\n")[2]);
// ── 各調查點分項結果：整體總結之外，每個調查點各自一段 ──────────
ok("分項結果有寫出條件（尖峰認定、流量視角、統計範圍、輸出數值）",
  /各調查點分項結果（尖峰時段認定：.+；路口流量視角：.+；統計範圍：.+；輸出數值：.+）：/.test(draft.text),
  (draft.text.match(/各調查點分項結果（[^）]*）[^）]*）：/) || [])[0] || "找不到");
const roadHeads = draft.text.match(/^【.+】$/gm) || [];
ok("每個調查點各有一段標題", roadHeads.length === 2, roadHeads.join("、"));
// 名稱沒有重複時不該被硬加上編號——舊版把「同一個點的多列」當成同名的多個點。
ok("名稱不重複時標題不會被硬加上調查點編號",
  roadHeads.every((head) => !/（\d{3}-\d{2}）/.test(head)), roadHeads.join("、"));
ok("分項結果逐時段列出，且全日的單位是「輛/日」不是「輛/hr」",
  /・.+｜全調查時段（[^）]+）：車輛數 [\d,]+ 輛\/日/.test(draft.text) &&
    !/｜全調查時段（[^）]+）：車輛數 [\d,]+ 輛\/hr/.test(draft.text));
ok("尖峰時段的單位是「輛/hr」",
  /・.+｜上午尖峰小時（[^）]+）：車輛數 [\d,]+ 輛\/hr/.test(draft.text));
ok("分項結果沒有出現 NaN／undefined", !/NaN|undefined|Infinity/.test(draft.text));
// 分項結果的數字必須跟整體總結對得起來——這是最容易分岔的地方。
// 每個調查點的區塊裡，第一列是合計（雙向合計／全部支線合計），
// 其後才是各方向／各支線；不能把兩者混在一起相加，否則會剛好變成兩倍。
const draftLines = draft.text.split("\n");
const roadBlocks = [];
for (const line of draftLines) {
  const head = line.match(/^【(.+)】$/);
  if (head) { roadBlocks.push({ name: head[1], rows: [] }); continue; }
  const row = line.match(/^・(.+?)｜全調查時段（[^）]+）：車輛數 ([\d,]+) 輛\/日/);
  if (row && roadBlocks.length)
    roadBlocks[roadBlocks.length - 1].rows.push({
      scope: row[1],
      value: Number(row[2].replace(/,/g, "")),
    });
}
const perRoadTotals = roadBlocks.map((block) => {
  const totalRow = block.rows.find((r) => /合計/.test(r.scope));
  const others = block.rows.filter((r) => r !== totalRow);
  return { name: block.name, total: totalRow?.value ?? null, others };
});
ok("每個調查點的合計列＝該點各方向／各支線之和",
  perRoadTotals.length > 0 && perRoadTotals.every((r) =>
    r.total !== null && (!r.others.length ||
      r.others.reduce((a, b) => a + b.value, 0) === r.total)),
  perRoadTotals.map((r) =>
    `${r.name} 合計 ${r.total} vs 分項 ${r.others.reduce((a, b) => a + b.value, 0)}`).join("；"));
const summed = perRoadTotals.reduce((a, b) => a + (b.total ?? 0), 0);
ok("各調查點分項的合計列，與逐點敘述的數字對得起來",
  draftWholeDay !== null && summed === draftWholeDay,
  `分項合計 ${summed} vs 逐點相加 ${draftWholeDay}`);

/*
 * ══════════════════════════════════════════════════════════════════════
 *  反面守門：某一塊為了看而「脫離」主工具列，**不可以滲進交出去的文件**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-14 實測到的真實情形：把時段車種分析那一區的季度改成 115Q1
 *（＝那一塊脫離），草稿裡的「全日實際交通量合計」仍讀主工具列的 115Q2、
 * 「時段車種分析合計」卻讀了脫離後的 115Q1，同一份文件裡出現
 *  115,873 與 63,195 兩個不同季度的數字，而文件上沒有任何一個字說明。
 *
 * 規則：圖可以脫離（使用者要的「圖自己的篩選只影響自己」），
 *       但匯出與草稿一律吃主工具列。
 *
 * ⚠️ 這一段要**先確認真的脫離了**再驗，否則「沒脫離」也會全綠（恆真）。
 */
await page.locator('.modal-backdrop button:text-is("取消")').first().click();
await page.waitForTimeout(500);
/* ⚠️ X-63：時段車種分析現在自己一個大分頁，要先切過去才碰得到它的下拉。 */
await gotoBlock(page, "periodAnalysis");
const quarters = await page.evaluate(() =>
  [...document.querySelectorAll("#periodQuarterSelect option")].map((o) => o.value),
);
const mainQuarter = await page.inputValue('[data-testid="mt-quarter-to"]');
const otherQuarter = quarters.find((q) => q !== mainQuarter);
ok("前置：有第二個季度可以拿來製造脫離", Boolean(otherQuarter), quarters.join("、"));
if (otherQuarter) {
  await page.locator("#periodQuarterSelect").selectOption(otherQuarter);
  await page.waitForTimeout(1000);
  ok(
    "前置：那一區真的脫離了（掛出「目前用本區塊自己的條件」）",
    (await page.locator('#periodAnalysis [data-testid="chart-detach-note"]').count()) === 1,
  );
  await page.locator('button:has-text("報表批次輸出中心")').first().click();
  await page.waitForTimeout(900);
  const detachedDraft = await page.evaluate(
    () => document.querySelector(".report-draft-box textarea")?.value || "",
  );
  const dTotal = wholeDayTotalOf(detachedDraft);
  const dPeriod = periodTotalOf(detachedDraft);
  ok(
    "某一塊脫離之後，草稿裡兩個段落的口徑仍然一致（脫離不可以滲進文件）",
    dTotal !== null && dPeriod !== null && dTotal === dPeriod,
    `全日逐點相加 ${dTotal} vs 時段 ${dPeriod}（那一塊脫離到 ${otherQuarter}，主工具列是 ${mainQuarter}）`,
  );
  await page.locator('.modal-backdrop button:text-is("取消")').first().click();
  await page.waitForTimeout(400);
  await page.locator('#periodAnalysis [data-testid="chart-detach-note"] button').first().click().catch(() => {});
  await page.waitForTimeout(600);
  await page.locator('button:has-text("報表批次輸出中心")').first().click();
  await page.waitForTimeout(900);
}

console.log("──── 草稿全文 ────");
console.log(draft.text);
await page.locator(".report-draft-box").screenshot({ path: "/tmp/draft.png" });
await page.locator('.modal-backdrop button:text-is("取消")').first().click();
await page.waitForTimeout(400);

// ── 檢查結果的篩選（X-43 之後在「資料維護」，不再是視窗）──────
/*
 * ⚠️ 2026-09-16 起「品質與定稿」視窗整塊移除，內容搬到
 *   「五　資料產出與維護」底下的資料維護四塊（X-43）。
 *   這一段原本是 `click('button:has-text("品質與定稿")')` 開視窗，
 *   現在改成換頁 ＋ 按「執行資料異常檢查」——那一顆按之前**不出數字**
 *   是刻意的（X-44：事前預防與事後檢查分開），不按的話這一段會拿到空表。
 */
await gotoBlock(page, "quality-run");
await page.waitForTimeout(900);
await page.locator('[data-testid="quality-run"]').click();
await page.waitForTimeout(1600);
const anomaly = await page.evaluate(() => {
  const section = document.getElementById("quality-reasons");
  if (!section) return null;
  return {
    heading: section.querySelector("h3")?.textContent,
    filters: [...section.querySelectorAll(".anomaly-filters label")].map((l) =>
      l.childNodes[0].textContent.trim(),
    ),
    chips: [...section.querySelectorAll(".anomaly-type-chips .chip-toggle")].map((b) => b.textContent),
    rows: section.querySelectorAll(".anomaly-table tbody tr").length,
    resolutionHeader: [...section.querySelectorAll("th")].some(
      (th) => th.textContent.trim() === "解決方式",
    ),
    resolutionCells: section.querySelectorAll(".resolution-cell").length,
  };
});
console.log("檢查結果區塊：", JSON.stringify(anomaly, null, 1));
ok("檢查結果在資料維護頁上找得到", anomaly !== null, String(anomaly));
ok("檢查結果有季度區間、調查點、日別四個篩選",
  anomaly.filters.join("、") === "起始季度、結束季度、調查點、日別", anomaly.filters.join("、"));
/*
 * ⚠️ 這一條原本寫死 `chips.length === 6`（那時是 5 種異常 ＋「清除篩選」）。
 *   2026-09-20 新增「方向名稱不成對」與「調查日期不只一個」兩種之後它變紅——
 *   但**要釘的不是「有幾顆」**，而是「每一種異常類型都有自己的標籤」：
 *   少一顆的話畫面上那一類篩不出來，使用者會以為系統沒有檢查這一項。
 *   所以改成逐一比對 ANOMALY_TYPES，數量只當下限。
 *   （姊妹專案交通服務水準踩過一模一樣的事：`types.length === 5`。）
 */
ok("檢查結果有分類型的筆數統計與清除篩選",
  anomaly.chips.length >= 6 && anomaly.chips.at(-1) === "清除篩選", anomaly.chips.join(" "));
{
  const { ANOMALY_TYPES } = await import("../app/final-workflow.ts");
  const missing = ANOMALY_TYPES.filter(
    (type) => !anomaly.chips.some((chip) => chip.startsWith(type)),
  );
  ok(
    "⚠️ 每一種異常類型都有自己的標籤（少一顆＝那一類篩不出來）",
    missing.length === 0,
    missing.length ? `少了：${missing.join("、")}` : `${ANOMALY_TYPES.length} 種都有`,
  );
}
ok("檢查結果改成表格呈現", anomaly.rows > 0, `${anomaly.rows} 列`);
/* X-49：每一列要寫得出「解決方式」。 */
ok("檢查結果有「解決方式」欄", anomaly.resolutionHeader === true);
ok("而且每一列都真的填了解決方式", anomaly.resolutionCells >= anomaly.rows,
  `${anomaly.resolutionCells} 格／${anomaly.rows} 列`);
const labelCheck = await page.evaluate(() => {
  const box = [...document.querySelectorAll("input[type=checkbox]")].find((i) =>
    i.closest("label")?.textContent.includes("已完成人工檢核"),
  );
  const note = [...document.querySelectorAll(".status-effect")].find((n) =>
    n.textContent.includes("純粹是紀錄"),
  );
  const before = box?.checked;
  note?.click();
  return {
    before,
    after: box?.checked,
    noteInsideLabel: !!note?.closest("label"),
    labelWidth: Math.round(box?.closest("label")?.getBoundingClientRect().width || 0),
  };
});
ok("點說明文字不會誤觸「已完成人工檢核」勾選框",
  labelCheck.before === labelCheck.after && !labelCheck.noteInsideLabel,
  JSON.stringify(labelCheck));
await page.locator("#quality-reasons").screenshot({ path: "/tmp/anomaly.png" }).catch(() => {});
await browser.close();
server.close();
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n全部通過");
process.exit(problems.length ? 1 : 0);
