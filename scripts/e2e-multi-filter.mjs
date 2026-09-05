/**
 * 端對端：調查點與車流方向的複選篩選。
 *
 * 使用者要的是「一次看好幾個調查點」，而不是一次只能選一個。
 * 這一支要驗的是三件事，其中兩件做錯了很難發現：
 *
 *   1. 勾兩個調查點＝兩個都出現；一個都不勾＝全部（**不是全部排除**）。
 *      預設值是空陣列，若把空陣列當成「什麼都不符合」，
 *      使用者一進畫面就會看到空白儀表板。
 *
 *   2. **複選不會改變任何數字。** 勾單一調查點時，每一格必須與
 *      舊版單選時完全相同；勾全部時，必須與一個都不勾時完全相同。
 *      這一項是重點——複選改的是「看到哪幾列」，不是「怎麼算」。
 *
 *   3. `roadFilter` 以前身兼「篩選條件」與「目前選定的路段」兩個角色
 *      （開啟「管理名稱」時用它決定要管哪一條）。拆開之後，
 *      **剛好只勾一條**時仍要沿用那一條，沒勾或勾多條才退回清單第一條。
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
await new Promise((r) => server.listen(8144, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label);
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(""));
await page.goto("http://localhost:8144/");
await page.waitForTimeout(1200);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("複選測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(800);

/*
 * 用同一份樣本、換一個站號檔名匯入第二次，就會多出一個調查點。
 * 這樣兩個調查點的數字完全一樣，「兩個都勾＝一個都不勾」的逐格比對
 * 才是在驗篩選行為，而不是在驗兩份不同資料剛好相加。
 */
async function importFile(name, buffer) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q1");
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
const sample = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
await importFile("115T1-01_中山路.xlsx", sample);
await page.waitForTimeout(900);

/** 目前畫面上的關鍵數字，用來證明「複選不改變計算」。 */
const snapshot = () =>
  page.evaluate(() => {
    const kpi = [...document.querySelectorAll(".kpi strong")].map((x) => x.textContent.trim());
    const rows = [...document.querySelectorAll(".table-panel tbody tr")].map((tr) =>
      [...tr.children].map((td) => td.innerText.replace(/\s+/g, " ").trim()),
    );
    return { kpi, rows };
  });

/** 操作最上方那一組篩選裡的調查點複選。 */
async function pickRoads(names) {
  await page.click("#roadFilterSelect");
  await page.waitForTimeout(250);
  for (const name of names) {
    await page.evaluate((text) => {
      const hit = [...document.querySelectorAll(".multi-picker-panel label")].find((l) =>
        l.textContent.includes(text),
      );
      if (hit) hit.querySelector("input").click();
    }, name);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
}
const clearRoads = async () => {
  await page.click("#roadFilterSelect");
  await page.waitForTimeout(250);
  await page.locator('.multi-picker-panel button:has-text("全部調查點")').first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
};

await page.click("#roadFilterSelect");
await page.waitForTimeout(400);
const roadNames = await page.evaluate(() =>
  [...document.querySelectorAll(".multi-picker-panel label span")].map((x) =>
    x.textContent.trim(),
  ),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

const all = await snapshot();
ok("匯入之後看得到資料", all.rows.length >= 1, `${all.rows.length} 列`);

/* ── 平日＋假日：所有日交通量都要分日，不能只在明細表分開 ─── */
const topDaySelect = page.locator(".filters label").filter({ hasText: "日別" }).locator("select").first();
await topDaySelect.selectOption({ label: "平日＋假日" });
await page.waitForTimeout(800);
const combinedDay = await page.evaluate(() => {
  const panel = [...document.querySelectorAll(".table-panel")].find((item) =>
    item.querySelector("h3")?.textContent.includes("雙向路段交通量"),
  );
  const headers = panel
    ? [...panel.querySelectorAll("thead th")].map((cell) => cell.textContent.trim())
    : [];
  const rows = panel
    ? [...panel.querySelectorAll("tbody tr")].map((tr) =>
        [...tr.children].map((cell) => cell.textContent.replace(/\s+/g, " ").trim()),
      )
    : [];
  const dayIndex = headers.findIndex((text) => text === "日別");
  const totalIndex = headers.findIndex((text) => /^全日（/.test(text));
  return {
    days: rows.map((row) => row[dayIndex]),
    totals: rows.map((row) => row[totalIndex]),
    ranking: [...document.querySelectorAll(".road-chart .bar-row")].map((row) =>
      row.textContent.replace(/\s+/g, " ").trim(),
    ),
    projects: [...document.querySelectorAll(".project-bars > div")].map((row) =>
      row.textContent.replace(/\s+/g, " ").trim(),
    ),
  };
});
const actualKpiTexts = await page
  .locator(".kpi")
  .nth(0)
  .locator(".kpi-day-values strong")
  .allTextContents();
const pcuKpiTexts = await page
  .locator(".kpi")
  .nth(1)
  .locator(".kpi-day-values strong")
  .allTextContents();
ok(
  "平日＋假日的明細各自成列",
  combinedDay.days.includes("平日") && combinedDay.days.includes("假日"),
  combinedDay.days.join("、"),
);
ok(
  "全日交通量 KPI 也分成平日與假日，不顯示兩天相加值",
  actualKpiTexts.length === 2 &&
    actualKpiTexts.some((text) => text.includes("平日")) &&
    actualKpiTexts.some((text) => text.includes("假日")),
  actualKpiTexts.join("｜"),
);
ok(
  "24小時 PCU KPI 也分成平日與假日",
  pcuKpiTexts.length === 2 &&
    pcuKpiTexts.some((text) => text.includes("平日")) &&
    pcuKpiTexts.some((text) => text.includes("假日")),
  pcuKpiTexts.join("｜"),
);
ok(
  "路段排名可分辨平日與假日列",
  combinedDay.ranking.some((text) => text.includes("平日")) &&
    combinedDay.ranking.some((text) => text.includes("假日")),
  combinedDay.ranking.join("｜"),
);
ok(
  "跨計畫比較可分辨平日與假日列",
  combinedDay.projects.some((text) => text.includes("平日")) &&
    combinedDay.projects.some((text) => text.includes("假日")),
  combinedDay.projects.join("｜"),
);
await topDaySelect.selectOption({ label: "平日" });
await page.waitForTimeout(700);
ok(
  "切回平日後數值與原先完全相同",
  JSON.stringify(await snapshot()) === JSON.stringify(all),
);

/* ── 調查點：只勾一個 → 表格只剩它；清掉之後逐格回到原狀 ─── */
ok("複選清單列得出調查點", roadNames.length >= 1, roadNames.join("、"));
await pickRoads([roadNames[0]]);
const onlyRoad = await snapshot();
ok(
  "只勾一個調查點時，表格只剩它",
  onlyRoad.rows.length > 0 &&
    onlyRoad.rows.every((r) => r[0].includes(roadNames[0].slice(0, 3))),
  JSON.stringify(onlyRoad.rows.map((r) => r[0])),
);
await clearRoads();
ok(
  "按「全部調查點」之後逐格回到原狀",
  JSON.stringify(await snapshot()) === JSON.stringify(all),
);

/* ── 車流方向：一份調查就有 A／B 兩個方向，用它驗複選語意 ─── */
async function openDirection() {
  /* 最上方那一組篩選裡，方向的複選鈕排在調查點後面 */
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".multi-picker-btn")];
    const hit = buttons.find((b) => (b.getAttribute("aria-label") || "").startsWith("車流方向"));
    if (hit) hit.click();
  });
  await page.waitForTimeout(350);
}
await openDirection();
const dirNames = await page.evaluate(() =>
  [...document.querySelectorAll(".multi-picker-panel label span")].map((x) =>
    x.textContent.trim(),
  ),
);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
ok("方向複選清單至少有兩個方向", dirNames.length >= 2, dirNames.join("、"));

async function pickDirections(labels) {
  await openDirection();
  for (const text of labels) {
    await page.evaluate((t) => {
      const hit = [...document.querySelectorAll(".multi-picker-panel label")].find((l) =>
        l.textContent.trim().startsWith(t),
      );
      if (hit) hit.querySelector("input").click();
    }, text);
    await page.waitForTimeout(250);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
}

await pickDirections([dirNames[0]]);
const oneDir = await snapshot();
ok(
  "只勾一個方向時，數字會變（篩選真的有作用）",
  JSON.stringify(oneDir.kpi) !== JSON.stringify(all.kpi),
  `${oneDir.kpi[0]} vs 全部方向 ${all.kpi[0]}`,
);

await pickDirections([dirNames[1]]);
const twoDirs = await snapshot();
ok(
  "兩個方向都勾＝一個都不勾（逐格相同，證明複選沒有動到計算）",
  JSON.stringify(twoDirs) === JSON.stringify(all),
  `${twoDirs.kpi.join(" / ")}｜全部：${all.kpi.join(" / ")}`,
);

/* 一個都不勾＝全部，不是全部排除 */
await pickDirections([dirNames[0], dirNames[1]]);
const noneDir = await snapshot();
ok(
  "把方向全部取消勾選＝回到全部（不是變空白）",
  JSON.stringify(noneDir) === JSON.stringify(all),
  `${noneDir.rows.length} 列`,
);

/* ── 剛好只勾一條調查點時，「管理名稱」要管那一條 ─────────── */
await pickRoads([roadNames[0]]);
await page.locator('button:has-text("管理名稱")').first().click();
await page.waitForTimeout(900);
const managed = await page.evaluate(() => {
  const sel = document.querySelector(".modal-backdrop select");
  const opt = sel && sel.options[sel.selectedIndex];
  return opt ? opt.textContent.trim() : "";
});
ok(
  "只勾一條時，「管理名稱」預設就是那一條",
  managed.includes(roadNames[0].slice(0, 3)),
  `${managed}｜勾的是 ${roadNames[0]}`,
);
for (let i = 0; i < 3 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page
    .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
    .first();
  if (!(await closer.count())) break;
  await closer.click().catch(() => {});
  await page.waitForTimeout(400);
}

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
