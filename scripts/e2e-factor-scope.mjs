/**
 * 端對端：係數「依季別／路段」分別設定。
 *
 * 使用者 2026-09-10：
 *   「是否能改成**預設全部路段都套用同一個係數**，然後在係數管理分頁裡，
 *     可以指定不同路段，手動設定不同係數？」
 *   「初始的預設自然是設定一次，套用**全季度＋全路段**。」
 *   「**計畫和計畫之間不能彼此干擾，路段和路段之間，季別和季別之間
 *     都不能互相干擾**，且**這份設定要能被存檔匯出和匯入**。」
 *   「你說依路段/季別分別設定最龐大，那在計算上的驗證、驗算更要嚴謹
 *     並再三確認正確。」
 *
 * 單元測試驗的是解析函式與計算核心。這一支驗的是**整個畫面**：
 * 使用者真的去點那兩個下拉、真的按套用之後，畫面上的數字有沒有照預期變，
 * 以及**沒被指定到的地方有沒有保持原樣**。
 *
 * 守門條目：
 *   ① 預設停在「全季別 × 全路段」——不碰它就等於改版前
 *   ② 選一個路段、改係數、套用 → 只有那一段變
 *   ③ ⚠️ **反面**：另一個路段的數字必須一格都沒動
 *   ④ 摘要要列出「哪一段在哪一季改過」，而且能還原
 *   ⑤ 還原之後數字要回到原值（不是回到某個中間值）
 *   ⑥ 重新整理之後設定還在（真的寫進瀏覽器儲存了）
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8166, r));

const problems = [];
/*
 * ⚠️ detail 分兩種用途：有些是**佐證**（成功時也該印出來看），
 *   有些是**失敗原因**（成功時印出來會讓人以為出事了）。
 *   後者用 failOnly() 包起來，只在紅字時才顯示。
 */
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object"
      ? condition
        ? ""
        : detail.failOnly
      : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
page.on("dialog", (d) => d.accept(""));
await page.goto("http://localhost:8166/");
await page.waitForTimeout(1200);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("係數範圍測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(800);

async function importFile(name, buffer, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(quarter);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.waitForTimeout(2600);
  for (const label of ["確認", "套用車種設定", "關閉", "取消"]) {
    const button = page.locator(`.modal-backdrop button:has-text("${label}")`);
    if (await button.count()) {
      await button.first().click().catch(() => {});
      await page.waitForTimeout(1600);
    }
  }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
      .first();
    if (!(await closer.count())) break;
    await closer.click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/*
 * 同一份樣本匯入**兩個季度**。
 *
 * ⚠️ 第一版我是「換檔名匯入兩次」想做出兩條路段，結果只有一條——
 *   路段名稱是從**檔案內容**讀的，不是從檔名；兩份內容一樣的檔案
 *   會被跨季比對機制認成同一條路（那正是它該做的事）。
 *   於是「其他路段沒變」那一條在只有一列的情況下**必然失敗**，
 *   看起來像功能壞了，其實是測資沒做出對照組。
 *
 * 改成用**季別**做對照組：季別是匯入時自己填的，一定分得開，
 * 而且季別正是使用者最在意的那個維度（「標準在某一季做了改變」）。
 */
const sample = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
await importFile("115T1-01_中山路.xlsx", sample, "115Q1");
await page.waitForTimeout(700);
await importFile("115T1-01_中山路.xlsx", sample, "115Q2");
await page.waitForTimeout(900);

/**
 * 切到某一季。
 *
 * ⚠️ 季度下拉**不在** .toolbar 底下（我第一版是這樣找的，結果找不到元素、
 *   切換整個沒發生，兩次快照其實是同一季的畫面——③ 就變成在比自己，
 *   而且會「通過」。假綠比沒有測試更糟，所以下面加了前置檢查。
 */
const switchQuarter = async (quarter) => {
  const applied = await page.evaluate((value) => {
    const select = [...document.querySelectorAll("select")].find(
      (s) =>
        (s.closest("label")?.textContent || "").includes("季度") &&
        [...s.options].some((o) => o.value === value),
    );
    if (!select) return "";
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return select.value;
  }, quarter);
  await page.waitForTimeout(1000);
  if (applied !== quarter)
    throw new Error(`切不到季度 ${quarter}（目前 ${applied || "找不到下拉"}）`);
};

/** 兩個季度各自的明細表內容，逐格比對用。 */
const pcuByRoad = async () => {
  const out = {};
  for (const quarter of ["115Q1", "115Q2"]) {
    await switchQuarter(quarter);
    await gotoTab(page, TABS.output);
    await page.waitForTimeout(700);
    const rows = await page.evaluate(() => {
      const list = [];
      for (const tr of document.querySelectorAll(".table-panel tbody tr")) {
        const cells = [...tr.querySelectorAll("td")].map((td) =>
          td.textContent.trim(),
        );
        if (cells.length > 2) list.push(cells.join("｜"));
      }
      return list;
    });
    rows.forEach((row, index) => {
      out[`${quarter}#${index}`] = row;
    });
  }
  return out;
};

const gotoFactors = async () => {
  await gotoTab(page, TABS.settings ?? TABS.output);
  await page.waitForTimeout(500);
  const block = page.locator("#block-pcu");
  if (await block.count()) await block.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
};

await gotoFactors();
ok(
  "前置：係數面板上找得到範圍選擇器",
  (await page.locator('[data-testid="factor-scope"]').count()) === 1,
);

/* ── ① 預設是全季別 × 全路段 ── */
const defaults = await page.evaluate(() => {
  const picker = document.querySelector('[data-testid="factor-scope"]');
  return [...(picker?.querySelectorAll("select") || [])].map((s) => s.value);
});
ok(
  "① 預設停在「全季別 × 全路段」（不碰它就等於改版前）",
  defaults.length === 2 && defaults.every((value) => value === "*"),
  defaults.join("／"),
);
ok(
  "① 摘要一開始寫「全部套用同一組」",
  (
    await page.locator('[data-testid="factor-scope-summary"]').innerText()
  ).includes("全部季別、全部路段都套用同一組"),
);

const before = await pcuByRoad();
const roadKeys = Object.keys(before);
ok(
  "前置：兩個季度都讀得到明細（沒有對照組的話 ③ 等於恆真）",
  roadKeys.some((key) => key.startsWith("115Q1")) &&
    roadKeys.some((key) => key.startsWith("115Q2")),
  `${roadKeys.length} 格：${roadKeys.slice(0, 4).join("、")}`,
);

/* ── ② 只改其中一條路段 ── */
await gotoFactors();
const quarterOptions = await page.evaluate(() => {
  const picker = document.querySelector('[data-testid="factor-scope"]');
  const select = picker?.querySelectorAll("select")[0];
  return [...(select?.options || [])].map((o) => ({
    value: o.value,
    label: o.textContent.trim(),
  }));
});
ok(
  "前置：季別下拉列出實際有資料的季別（不是空的、也不是憑空捏造的）",
  quarterOptions.length === 3 &&
    quarterOptions.some((o) => o.value === "115Q1") &&
    quarterOptions.some((o) => o.value === "115Q2"),
  quarterOptions.map((o) => o.label).join("、"),
);
const roadOptions = await page.evaluate(() => {
  const picker = document.querySelector('[data-testid="factor-scope"]');
  const select = picker?.querySelectorAll("select")[1];
  return [...(select?.options || [])].map((o) => ({ value: o.value, label: o.textContent.trim() }));
});
ok(
  "前置：路段下拉也列得出實際有資料的路段",
  roadOptions.length >= 2,
  roadOptions.map((o) => o.label).join("、"),
);
const targetQuarter = { value: "115Q1", label: "115Q1" };
await page.evaluate((value) => {
  const picker = document.querySelector('[data-testid="factor-scope"]');
  const select = picker.querySelectorAll("select")[0];
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}, targetQuarter.value);
await page.waitForTimeout(700);
ok(
  "② 選了具體路段之後，畫面要說明這一格目前是沿用上層設定",
  (await page.locator(".factor-scope-state").innerText()).includes("沿用上層設定"),
);

/* 機車 0.5 → 1.0（剛好兩倍，變化量好驗算）。 */
await page.evaluate(() => {
  const input = [...document.querySelectorAll("#block-pcu .factor-grid input")][0];
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  ).set;
  setter.call(input, "1");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(300);
await page.locator('#block-pcu button:has-text("套用係數")').click();
await page.waitForTimeout(1200);

const after = await pcuByRoad();
const changed = roadKeys.filter((key) => before[key] !== after[key]);
const unchanged = roadKeys.filter((key) => before[key] === after[key]);
ok(
  "② 指定的那一季，數字確實變了",
  changed.length >= 1,
  `變了 ${changed.length} 格`,
);
/* ── ③ 反面：另一季一格都不可以動 ── */
ok(
  "③ ⚠️ 沒被指定到的季別，數字必須一格都沒動",
  unchanged.length >= 1 && changed.length < roadKeys.length,
  `共 ${roadKeys.length} 格，變了 ${changed.length} 格、沒變 ${unchanged.length} 格`,
);
ok(
  "③ ⚠️ 變動的格子必須**全部**屬於被指定的那一季",
  changed.length > 0 && changed.every((key) => key.startsWith(targetQuarter.value)),
  changed.slice(0, 3).join(" ｜ "),
);
ok(
  "③ ⚠️ 另一季的每一格都與改動前逐字相同",
  Object.keys(before)
    .filter((key) => key.startsWith("115Q2"))
    .every((key) => before[key] === after[key]),
  failOnly("115Q2 被 115Q1 的設定汙染了"),
);

/* ── ④ 摘要 ── */
await gotoFactors();
const summaryText = await page
  .locator('[data-testid="factor-scope-summary"]')
  .innerText();
ok("④ 摘要列出這一組專屬係數", summaryText.includes("1 組專屬係數"), summaryText.slice(0, 120));
ok(
  "④ 摘要寫得出「哪一段、哪一季」",
  summaryText.includes(targetQuarter.value) && summaryText.includes("全路段"),
  summaryText.slice(0, 160),
);
ok(
  "④ 每一組都有「還原成預設」",
  (await page.locator('[data-testid="factor-scope-summary"] button:has-text("還原成預設")').count()) === 1,
);

/* ── ⑥ 重新整理之後還在 ── */
await page.reload();
await page.waitForTimeout(2200);
await gotoFactors();
ok(
  "⑥ ⚠️ 重新整理之後設定還在（真的寫進瀏覽器儲存了，不是只在畫面上）",
  (await page.locator('[data-testid="factor-scope-summary"]').innerText()).includes(
    "1 組專屬係數",
  ),
);
const afterReload = await pcuByRoad();
const reloadDrift = JSON.stringify(afterReload) !== JSON.stringify(after);
ok(
  "⑥ 重新整理之後數字與套用當下相同",
  !reloadDrift,
  reloadDrift ? "重新整理後數字跑掉了" : "",
);

/* ── ⑤ 還原 ── */
await gotoFactors();
await page
  .locator('[data-testid="factor-scope-summary"] button:has-text("還原成預設")')
  .first()
  .click();
await page.waitForTimeout(1200);
const restored = await pcuByRoad();
ok(
  "⑤ ⚠️ 還原之後每一格都回到原值（不是回到某個中間值）",
  JSON.stringify(restored) === JSON.stringify(before),
  Object.keys(before)
    .filter((key) => before[key] !== restored[key])
    .slice(0, 2)
    .map((key) => `${key}：原 ${before[key]} → 現 ${restored[key]}`)
    .join(" ｜ ") || "（無差異）",
);
await gotoFactors();
ok(
  "⑤ 還原之後摘要回到「全部套用同一組」",
  (
    await page.locator('[data-testid="factor-scope-summary"]').innerText()
  ).includes("全部季別、全部路段都套用同一組"),
);

console.log("\n══ 主控台 ══");
ok("整段流程沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" ｜ "));

console.log(
  problems.length
    ? `\n❌ 未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}`
    : "\n✅ 全部通過",
);
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
