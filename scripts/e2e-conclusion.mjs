/*
 * 結論草稿產生器的端對端檢查（全日交通量及車種組成）。
 *
 * 單元測試已經驗過組字規則，這一支要驗的是「畫面接得對不對」：
 *  ・勾選條件之後草稿有沒有真的跟著變
 *  ・草稿寫的數字，和「時段車種分析」表格上同一格的數字是不是一樣
 *    （最重要的一項——報告寫錯數字比程式當掉嚴重）
 *  ・單位有沒有跟著時段走（全日是 輛/日，尖峰是 輛/hr）
 *  ・手改之後不會被無聲覆蓋；條件範本存得起來、重新整理後還在
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
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
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8101, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text()))
    errors.push(m.text());
});
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto("http://localhost:8101/");
await page.waitForTimeout(800);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("結論測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

async function importFile(name, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[accept=".xls,.xlsx"]')
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
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
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
      .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}
await importFile("115T1-01_中山路.xlsx", "115Q1");
await importFile("115T1-01_中山路.xlsx", "115Q2");

/*
 * 先把「時段車種分析」表格上的數字抄下來當標準答案。
 * 這個表格一次只顯示一種日別，所以平日與假日各抓一次——
 * 只抓平日的話，草稿裡的假日數字會被誤判成「表格上沒有」。
 */
const periodTable = { rows: [] };
for (const day of ["平日", "假日"]) {
  await page.locator("#periodAnalysis").scrollIntoViewIfNeeded();
  await page.locator("#periodDaySelect").selectOption(day);
  await page.waitForTimeout(900);
  const rows = await page.evaluate(() => {
    const panel = document.querySelector("#periodAnalysis");
    if (!panel) return [];
    const out = [];
    for (const tr of panel.querySelectorAll("tbody tr"))
      out.push(
        [...tr.querySelectorAll("th,td")].map((td) =>
          td.innerText.replace(/\s+/g, " ").trim(),
        ),
      );
    return out;
  });
  console.log(`── 時段車種分析・${day}（${rows.length} 列，前 2 列）──`);
  rows.slice(0, 2).forEach((r) => console.log("  ", r.join(" | ")));
  periodTable.rows.push(...rows);
}
await page.locator("#periodDaySelect").selectOption("平日");
await page.waitForTimeout(600);

/* ── 展開結論草稿產生器 ── */
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
ok("頁面上找得到結論草稿產生器", (await page.locator("#conclusionStudio").count()) === 1);
await page.locator('#conclusionStudio button:has-text("展開")').click();
await page.waitForTimeout(1200);

const draft = page.locator('#conclusionStudio textarea[aria-label="結論草稿"]');
ok("展開之後出現條件面板與草稿框", (await draft.count()) === 1);
ok("一開始是空的", (await draft.inputValue()) === "");

const count0 = await page.locator("#conclusionStudio .conclusion-count").innerText();
ok("符合條件列數有算出來", /符合條件 [1-9]\d* 列/.test(count0), count0);

/* 條件：單季 115Q1、只寫全日、只寫車輛數＋車種組成 */
await page.locator('#conclusionStudio input[name="traffic-conclusion-scope"]').first().check();
await page.waitForTimeout(300);
await page.locator("#conclusionStudio .conclusion-field select").first().selectOption("115Q1");
await page.waitForTimeout(300);
for (const label of await page.locator("#conclusionStudio .conclusion-field:has-text('時段與日別') .conclusion-checks").first().locator("label").all()) {
  const box = label.locator("input");
  const text = (await label.innerText()).trim();
  if (text === "全日") { if (!(await box.isChecked())) await box.check(); }
  else if (await box.isChecked()) await box.uncheck();
}
for (const label of await page.locator("#conclusionStudio .conclusion-metrics label").all()) {
  const box = label.locator("input");
  if (await box.isChecked()) await box.uncheck();
}
for (const want of ["車輛數（輛）", "車種組成（輛數與百分比）", "尖峰時段（起訖時間）"])
  await page.locator(`#conclusionStudio .conclusion-metrics label:has-text("${want}") input`).check();
await page.waitForTimeout(250);

await page.locator('#conclusionStudio button:has-text("產生草稿")').click();
await page.waitForTimeout(800);
const text1 = await draft.inputValue();
console.log("\n── 草稿前 1000 字 ──\n" + text1.slice(0, 1000) + "\n──────────────");

ok("草稿產生出來了", text1.length > 200, `${text1.length} 字`);
ok("標頭寫明範圍是 115Q1", /【結論草稿】115Q1/.test(text1), text1.split("\n")[0]);
ok("只寫全日，沒有寫尖峰段落", /全日：/.test(text1) && !/上午尖峰小時：/.test(text1));
ok("全日的單位是「輛/日」而不是「輛/hr」", /輛\/日/.test(text1) && !/全日：[^\n]*輛\/hr/.test(text1));
ok("有寫車種組成與百分比", /車種組成：.+（[\d.]+%）/.test(text1));
ok("沒勾 PCU 就不出現 PCU 數值", !/：[^\n]*[\d,]+\.\d PCU/.test(text1));
ok("沒有 NaN／undefined／Infinity", !/NaN|undefined|Infinity/.test(text1),
  text1.match(/NaN|undefined|Infinity/)?.[0] || "");
ok("標頭寫明全日與尖峰的單位規則", /「全日」是一整天的加總/.test(text1));

/* ── 對數字：草稿裡的全日車輛數要能在時段車種分析表格上找到 ── */
const drafted = [...text1.matchAll(/全日：[^\n]*?([\d,]{3,}) 輛\/日/g)].map((m) => m[1]);
ok("草稿有寫出全日車輛數", drafted.length >= 1, drafted.join("、"));
const tableText = JSON.stringify(periodTable.rows);
const missing = drafted.filter((value) => !tableText.includes(value));
ok(
  "草稿的全日車輛數都能在時段車種分析表格上找到同一個值",
  missing.length === 0,
  "找不到：" + missing.join("、") + "｜表格上共 " + periodTable.rows.length + " 列",
);

/* ── 加勾 PCU，草稿要變 ── */
await page.locator('#conclusionStudio .conclusion-metrics label:has-text("當量交通量（PCU）") input').check();
await page.locator('#conclusionStudio button:has-text("重新產生")').click();
await page.waitForTimeout(800);
const text2 = await draft.inputValue();
ok("加勾 PCU 之後草稿有變", text2 !== text1);
ok("PCU 的單位是 PCU/日", /PCU\/日/.test(text2));

/* ── 加勾尖峰時段，單位要變成 /hr ── */
for (const label of await page.locator("#conclusionStudio .conclusion-field:has-text('時段與日別') .conclusion-checks").first().locator("label").all()) {
  const text = (await label.innerText()).trim();
  if (text === "上午尖峰小時") await label.locator("input").check();
}
await page.locator('#conclusionStudio button:has-text("重新產生")').click();
await page.waitForTimeout(800);
const text3 = await draft.inputValue();
const amLine = text3.split("\n").find((line) => /上午尖峰小時：/.test(line)) || "";
ok("尖峰段落出現了", amLine.length > 0);
ok("尖峰的單位是 /hr 不是 /日", /輛\/hr/.test(amLine) && !/輛\/日/.test(amLine), amLine);

/* ── 季度區間 + 變動幅度 ── */
await page.locator('#conclusionStudio input[name="traffic-conclusion-scope"]').nth(2).check();
await page.waitForTimeout(400);
await page.locator('#conclusionStudio .conclusion-metrics label:has-text("季度之間的變動幅度") input').check();
await page.locator('#conclusionStudio button:has-text("重新產生")').click();
await page.waitForTimeout(800);
const text4 = await draft.inputValue();
ok("季度區間的標頭寫出起訖", /【結論草稿】\d+Q\d～\d+Q\d/.test(text4), text4.split("\n")[0]);
ok(
  "兩季相同資料時變動幅度是 0.0%，不是 NaN",
  !/NaN/.test(text4) && /(增加|減少) [\d.]+%|沒有任何一列具備兩季/.test(text4),
);

/* ── 手改保護 ── */
await draft.fill("我自己改的內容");
await page.waitForTimeout(250);
const hint = await page.locator("#conclusionStudio .conclusion-output .conclusion-hint").innerText();
ok("手改之後有提示會先詢問再覆蓋", /手動修改/.test(hint), hint);

/* ── 條件範本 ── */
await page.locator("#conclusionStudio .conclusion-templates input").fill("季報用");
await page.locator('#conclusionStudio button:has-text("存成範本")').click();
await page.waitForTimeout(400);
ok("範本存得起來", (await page.locator("#conclusionStudio .conclusion-template:has-text('季報用')").count()) === 1);

await page.reload();
await page.waitForTimeout(2500);
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
await page.locator('#conclusionStudio button:has-text("展開")').click();
await page.waitForTimeout(1200);
ok(
  "重新整理之後範本還在",
  (await page.locator("#conclusionStudio .conclusion-template:has-text('季報用')").count()) === 1,
);

/* ── 條件挑不到資料 ── */
await page.locator('#conclusionStudio input[name="traffic-conclusion-scope"]').nth(2).check();
await page.waitForTimeout(300);
const selects = page.locator("#conclusionStudio .conclusion-field:has-text('統計範圍') select");
await selects.first().selectOption({ index: 0 });
await selects.nth(1).selectOption({ index: 0 });
await page.locator("#conclusionStudio .conclusion-field:has-text('路段') input[type=checkbox]").last().check();
await page.waitForTimeout(300);
await page.locator('#conclusionStudio button:has-text("重新產生")').click();
await page.waitForTimeout(800);
const text5 = await draft.inputValue();
ok("挑不到資料時給的是說明而不是空白", text5.length > 60, text5.slice(0, 90));

/*
 * ── 第四區同時提供駛出與駛入（v20.29）─────────────────────────
 *
 * 舊版這一區只列出「上方工具列目前選的那個視角」的支線，使用者在結論草稿
 * 裡看不到駛入，得先跑到別處切換。更糟的是：切到駛入視角時清單會寫
 * 「駛入路口A」，底下的數字卻還是駛出路口A 的——名稱與數字對不上。
 */
/*
 * 這一支原本只匯入路段檔（方向A／方向B），驗不到路口的駛出／駛入。
 * 使用 make-samples.mjs 產生的匿名路口樣本，不依賴使用者的真實調查檔。
 */
await importFile("115T1-02_中正路口.xlsx", "115Q1");
await page.locator('button:has-text("結論草稿產生器")').first().click().catch(() => {});
await page.waitForTimeout(900);
const scopeBox = page.locator(
  '#conclusionStudio fieldset:has(legend:has-text("要寫哪些方向"))',
);
const scopeLabels = await scopeBox.locator("> .conclusion-list label").allTextContents();
ok(
  "第四區同時列出駛出路口與駛入路口",
  scopeLabels.some((t) => t.includes("駛出路口")) &&
    scopeLabels.some((t) => t.includes("駛入路口")),
  scopeLabels.join("｜").slice(0, 140),
);
ok(
  "路段的方向只出現一次（駛入只適用於路口支線）",
  scopeLabels.filter((t) => t.includes("方向A")).length === 1,
  scopeLabels.filter((t) => t.includes("方向A")).join("｜"),
);
ok(
  "代碼重疊時把兩個名稱都列出來，不會只寫其中一個",
  scopeLabels.some((t) => t.includes("方向A") && t.includes("駛出路口A")),
  scopeLabels.find((t) => t.includes("方向A")) ?? "(找不到)",
);
ok(
  "駛出與駛入的支線數量相同（同一批車只是換分組）",
  scopeLabels.filter((t) => t.includes("駛出路口")).length ===
    scopeLabels.filter((t) => t.includes("駛入路口")).length,
  `駛出 ${scopeLabels.filter((t) => t.includes("駛出路口")).length}／駛入 ${scopeLabels.filter((t) => t.includes("駛入路口")).length}`,
);

console.log("\n══ 主控台錯誤 ══");
ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 4).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
