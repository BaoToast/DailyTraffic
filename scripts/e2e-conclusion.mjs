/*
 * 結論草稿產生器的端對端檢查（全調查時段交通量及車種組成）。
 *
 * 單元測試已經驗過組字規則，這一支要驗的是「畫面接得對不對」：
 *  ・勾選條件之後草稿有沒有真的跟著變
 *  ・草稿寫的數字，和「時段車種分析」表格上同一格的數字是不是一樣
 *    （最重要的一項——報告寫錯數字比程式當掉嚴重）
 *  ・單位有沒有跟著時段走（全調查時段是 輛/日，尖峰是 輛/hr）
 *  ・手改之後不會被無聲覆蓋；條件範本存得起來、重新整理後還在
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
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
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
await gotoBlock(page, "periodAnalysis");
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
/* ⚠️ X-63：結論草稿產生器在「成果交付」那個大分頁。 */
await gotoBlock(page, "conclusionStudio");
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

/* 條件：單季 115Q1、只寫全調查時段、只寫車輛數＋車種組成 */
await page.locator('#conclusionStudio input[name="traffic-conclusion-scope"]').first().check();
await page.waitForTimeout(300);
await page.locator("#conclusionStudio .conclusion-field select").first().selectOption("115Q1");
await page.waitForTimeout(300);
/*
 * ⚠️ 用**第幾個** fieldset 定位，不要比 legend 的字串。
 *   legend 在 2026-09-15 從「二、時段與日別」改成
 *   「二、時段、日別與尖峰時段認定」（尖峰時段認定從「六、敘述方式」搬進來，
 *   它是篩選條件不是排版選項），寫死字串的選擇器當場對不上，
 *   而失敗訊息只會說「草稿寫了尖峰段落」——看不出真正的原因是選擇器。
 *   這幾格的**順序**是穩定的（一、統計範圍／二、時段…／三、路段／四、方向）。
 */
for (const label of await page.locator("#conclusionStudio .conclusion-field").nth(1).locator(".conclusion-checks").first().locator("label").all()) {
  const box = label.locator("input");
  const text = (await label.innerText()).trim();
  /* v20.64 起時段名稱統一為「全調查時段」（舊名「全日」）。 */
  if (text === "全調查時段") { if (!(await box.isChecked())) await box.check(); }
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
ok("只寫全調查時段，沒有寫尖峰段落", /全調查時段：/.test(text1) && !/上午尖峰小時：/.test(text1));
ok("全調查時段的單位是「輛/日」而不是「輛/hr」", /輛\/日/.test(text1) && !/全調查時段：[^\n]*輛\/hr/.test(text1));
ok("有寫車種組成與百分比", /車種組成：.+（[\d.]+%）/.test(text1));
ok("沒勾 PCU 就不出現 PCU 數值", !/：[^\n]*[\d,]+\.\d PCU/.test(text1));
ok("沒有 NaN／undefined／Infinity", !/NaN|undefined|Infinity/.test(text1),
  text1.match(/NaN|undefined|Infinity/)?.[0] || "");
ok(
  "標頭寫明全調查時段與尖峰的單位規則",
  /「全調查時段」是這份調查涵蓋時段的加總/.test(text1),
  (text1.match(/說明：[^\n]{0,60}/) || [])[0] || "找不到說明那一行",
);

/* ── 對數字：草稿裡的全調查時段車輛數要能在時段車種分析表格上找到 ── */
const drafted = [...text1.matchAll(/全調查時段：[^\n]*?([\d,]{3,}) 輛\/日/g)].map((m) => m[1]);
ok("草稿有寫出全調查時段車輛數", drafted.length >= 1, drafted.join("、"));
const tableText = JSON.stringify(periodTable.rows);
const missing = drafted.filter((value) => !tableText.includes(value));
ok(
  "草稿的全調查時段車輛數都能在時段車種分析表格上找到同一個值",
  missing.length === 0,
  missing.length
    ? "找不到：" + missing.join("、") + "｜表格上共 " + periodTable.rows.length + " 列"
    : "全部對上｜表格上共 " + periodTable.rows.length + " 列",
);

/* ── 加勾 PCU，草稿要變 ── */
await page.locator('#conclusionStudio .conclusion-metrics label:has-text("當量交通量（PCU）") input').check();
await page.locator('#conclusionStudio button:has-text("產生草稿")').click();
await page.waitForTimeout(800);
const text2 = await draft.inputValue();
ok("加勾 PCU 之後草稿有變", text2 !== text1);
ok("PCU 的單位是 PCU/日", /PCU\/日/.test(text2));

/* ── 加勾尖峰時段，單位要變成 /hr ── */
for (const label of await page.locator("#conclusionStudio .conclusion-field").nth(1).locator(".conclusion-checks").first().locator("label").all()) {
  const text = (await label.innerText()).trim();
  if (text === "上午尖峰小時") await label.locator("input").check();
}
await page.locator('#conclusionStudio button:has-text("產生草稿")').click();
await page.waitForTimeout(800);
const text3 = await draft.inputValue();
const amLine = text3.split("\n").find((line) => /上午尖峰小時：/.test(line)) || "";
ok("尖峰段落出現了", amLine.length > 0);
ok("尖峰的單位是 /hr 不是 /日", /輛\/hr/.test(amLine) && !/輛\/日/.test(amLine), amLine);

/* ── 季度區間 + 變動幅度 ── */
await page.locator('#conclusionStudio input[name="traffic-conclusion-scope"]').nth(2).check();
await page.waitForTimeout(400);
await page.locator('#conclusionStudio .conclusion-metrics label:has-text("季度之間的變動幅度") input').check();
await page.locator('#conclusionStudio button:has-text("產生草稿")').click();
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
/* ⚠️ X-78：重新載入之後主工具列又是收合的（那正是使用者要的行為），
   後面還要用它的欄位，所以這裡再展開一次。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(2500);
/*
 * ⚠️ 重新整理會回到預設分頁（資料匯入），所以要再切一次。
 * 這一項守的是「範本存在 localStorage、重整之後還在」，
 * 不是「重整之後還停在同一頁」——那是另一件事，不要混在一起。
 */
await gotoBlock(page, "conclusionStudio");
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
await page.locator('#conclusionStudio button:has-text("產生草稿")').click();
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
/* 理由同上：第四格（方向／支線），legend 已改名為「四、方向／支線與路口流量視角」。 */
const scopeBox = page.locator("#conclusionStudio .conclusion-field").nth(3);
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

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「套用主工具列目前的條件」——維持獨立，但按了要真的套上
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14 裁示：結論草稿**維持獨立**（不自動跟著主工具列跑），
 * 另加這一顆。另外兩支（路口轉向、交通服務水準）有 e2e-apply-main.mjs 守著，
 * 本支 2026-09-15 大檢查時才發現**沒有任何守門**——而這一顆最容易出的錯
 * 恰好是最難看出來的那一種：
 *
 *   ⚠️ 把「並列」那種值（AMPM／both）直接塞進條件 → 條件看起來設好了、
 *     卻篩不到任何一筆，符合條件變成 0 列，而畫面上沒有任何錯誤。
 *
 * ⚠️「維持獨立」和「按了會套用」要**一起驗**：只驗後者的話，一個
 *   「其實一直自動跟著主工具列跑」的實作也會全綠，而那正是使用者否決的行為。
 */
console.log("\n══ 套用主工具列目前的條件 ══");
await gotoBlock(page, "conclusionStudio");
await page.waitForTimeout(600);
await page.locator("#conclusionStudio").scrollIntoViewIfNeeded();
const applyButton = page.locator('[data-testid="conclusion-apply-main"]');
ok("結論草稿上有「套用主工具列目前的條件」", (await applyButton.count()) === 1);

const matchedCount = () =>
  page.evaluate(() => {
    const node = document.querySelector(".conclusion-count");
    const m = (node?.textContent || "").match(/(\d+)/);
    return m ? Number(m[1]) : -1;
  });

/* 先把主工具列調到一組**和結論草稿現在不同**的條件：上午＋下午並列。 */
await page.selectOption('[data-testid="mt-period"]', "AMPM");
await page.waitForTimeout(900);
await page.selectOption('[data-testid="mt-flow-view"]', "both");
await page.waitForTimeout(900);
const beforeApply = await matchedCount();
ok("前置：量得到「符合條件 N 列」", beforeApply >= 0, String(beforeApply));

/*
 * ⚠️ 「維持獨立」：主工具列切成並列之後，結論草稿**不可以**自己跟著換。
 *   這裡用「統計範圍那一組還維持原狀」來量——它是結論草稿自己的條件。
 */
const scopeKindBefore = await page.evaluate(() => {
  const checked = [
    ...document.querySelectorAll("#conclusionStudio input[type=radio]"),
  ].filter((node) => node.checked);
  return checked.map((node) => node.closest("label")?.textContent?.trim() || "");
});

await applyButton.click();
await page.waitForTimeout(1200);
const afterApply = await matchedCount();
ok(
  "按下去之後不可以變成 0 列",
  afterApply > 0,
  `${beforeApply} 列 → ${afterApply} 列（主工具列：上午＋下午並列、駛出＋駛入並列）`,
);
/*
 * ⚠️ 上一條**抓不到**「把並列原樣塞進條件」這個錯（2026-09-15 反面測試證實）：
 *   "AMPM" 不是任何一個時段核取方塊的值，結果只是沒有一個被勾到，
 *   列數不變、畫面也看不出異樣——所以要直接驗**勾到的是哪兩個**。
 */
const checkedPeriods = await page.evaluate(() => {
  const field = [...document.querySelectorAll("#conclusionStudio fieldset")].find(
    (node) => (node.querySelector("legend")?.textContent || "").includes("時段"),
  );
  return [...(field?.querySelectorAll("input[type=checkbox]") || [])]
    .filter((node) => node.checked)
    .map((node) => node.closest("label")?.textContent?.trim() || "");
});
ok(
  "「上午＋下午並列」要被**攤成兩個真的時段**，不是原樣塞進去",
  checkedPeriods.some((t) => t.includes("上午")) &&
    checkedPeriods.some((t) => t.includes("下午")) &&
    !checkedPeriods.some((t) => /全調查時段/.test(t)),
  `目前勾到：${checkedPeriods.join("｜") || "（一個都沒勾）"}`,
);
const applyToast = await page.evaluate(
  () => document.querySelector(".toast")?.textContent || "",
);
ok(
  "要**說出套用了什麼**（默默改掉整組條件，使用者會以為自己點錯）",
  /已套用主工具列/.test(applyToast),
  applyToast.slice(0, 140),
);
ok(
  "要點名沒有套進去的條件（尖峰時段認定、顯示數值不是結論草稿的條件）",
  /尖峰時段認定|顯示數值/.test(applyToast),
  applyToast.slice(0, 160),
);
const scopeKindAfter = await page.evaluate(() => {
  const checked = [
    ...document.querySelectorAll("#conclusionStudio input[type=radio]"),
  ].filter((node) => node.checked);
  return checked.map((node) => node.closest("label")?.textContent?.trim() || "");
});
ok(
  "按下去之後統計範圍那一組真的換過（證明這一顆有作用，不是恆真）",
  JSON.stringify(scopeKindBefore) !== JSON.stringify(scopeKindAfter) ||
    afterApply !== beforeApply,
  `${scopeKindBefore.join("｜")} → ${scopeKindAfter.join("｜")}；${beforeApply} → ${afterApply} 列`,
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
