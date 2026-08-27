import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
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
  await page.locator('.modal-backdrop .modal input[accept=".xls,.xlsx"]').setInputFiles({
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
await page.locator("#periodQuarterSelect").selectOption("115Q1").catch(() => {});
await page.waitForTimeout(900);
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
ok("草稿有 12 個可勾選段落，且預設全部勾起",
  draft.chips.length === 12 && draft.checked === 12,
  `${draft.chips.length} 段／勾選 ${draft.checked}`);
ok("草稿含「各調查點分項結果」段落",
  draft.chips.includes("各調查點分項結果"), draft.chips.join("｜"));
ok("匯出中心的 8 個勾選項目，草稿裡都有同名段落",
  ["本季交通量、PCU與平假日比較","歷季全日量與趨勢","車種組成與歷季比例","每小時實際量與PCU",
   "跨計畫比較","PCU、車種與路口設定","來源追溯、品質與版本紀錄","9張可編輯原生圖表"]
    .every((label) => draft.chips.includes(label)),
  draft.chips.join("｜"));
// 草稿裡的數字必須與同一份草稿其他段落一致——這是最容易出錯的地方：
// 時段車種分析原本只取第一個調查點，會寫出比總量小一半的數字。
const totalMatch = draft.text.match(/全日實際交通量合計 ([\d,]+) 輛/);
const periodMatch = draft.text.match(/全日時段：時段 [^，]+，當量交通量 [\d,.]+ PCU、實際車輛數 ([\d,]+) 輛/);
ok("時段車種分析的合計＝全範圍合計（不是只取第一個調查點）",
  !!totalMatch && !!periodMatch && totalMatch[1] === periodMatch[1],
  `${totalMatch?.[1]} vs ${periodMatch?.[1]}`);
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
  /・.+｜全日時段（[^）]+）：車輛數 [\d,]+ 輛\/日/.test(draft.text) &&
    !/｜全日時段（[^）]+）：車輛數 [\d,]+ 輛\/hr/.test(draft.text));
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
  const row = line.match(/^・(.+?)｜全日時段（[^）]+）：車輛數 ([\d,]+) 輛\/日/);
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
const wholeDay = (draft.text.match(/^全日實際交通量合計 ([\d,]+) 輛/m) || [])[1];
const summed = perRoadTotals.reduce((a, b) => a + (b.total ?? 0), 0);
ok("各調查點合計列相加＝整體總結的全日合計",
  !!wholeDay && summed === Number(wholeDay.replace(/,/g, "")),
  `分項合計 ${summed} vs 整體 ${wholeDay}`);
console.log("──── 草稿全文 ────");
console.log(draft.text);
await page.locator(".report-draft-box").screenshot({ path: "/tmp/draft.png" });
await page.locator('.modal-backdrop button:text-is("取消")').first().click();
await page.waitForTimeout(400);

// ── 異常提醒篩選 ───────────────────────────────────────────
await page.locator('button:has-text("品質與定稿")').first().click();
await page.waitForTimeout(700);
const anomaly = await page.evaluate(() => {
  const section = [...document.querySelectorAll("section")].find((s) =>
    s.textContent.includes("歷季異常提醒"),
  );
  if (!section) return null;
  return {
    heading: section.querySelector("strong")?.textContent,
    filters: [...section.querySelectorAll(".anomaly-filters label")].map((l) =>
      l.childNodes[0].textContent.trim(),
    ),
    chips: [...section.querySelectorAll(".anomaly-type-chips .chip-toggle")].map((b) => b.textContent),
    rows: section.querySelectorAll(".anomaly-table tbody tr").length,
  };
});
console.log("異常區塊：", JSON.stringify(anomaly, null, 1));
ok("異常提醒有季度區間、調查點、日別四個篩選",
  anomaly.filters.join("、") === "起始季度、結束季度、調查點、日別", anomaly.filters.join("、"));
ok("異常提醒有分類型的筆數統計與清除篩選",
  anomaly.chips.length === 6 && anomaly.chips.at(-1) === "清除篩選", anomaly.chips.join(" "));
ok("異常提醒改成表格呈現", anomaly.rows > 0, `${anomaly.rows} 列`);
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
await page.locator("section.workflow-warning, section.workflow-ok").last().screenshot({ path: "/tmp/anomaly.png" }).catch(() => {});
await browser.close();
server.close();
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n全部通過");
process.exit(problems.length ? 1 : 0);
