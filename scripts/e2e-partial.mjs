import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".pdf": "application/pdf", ".docx": "application/octet-stream" };
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

await new Promise((r) => server.listen(8098, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW", acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|404 \(Not Found\)/.test(m.text())) errors.push(m.text()); });
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto("http://localhost:8098/");
await page.waitForTimeout(800);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("部分時段測試");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

async function importFile(name) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q2");
  await page.locator('.modal-backdrop .modal input[accept=".xls,.xlsx"]').setInputFiles({
    name, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(join(SAMPLES, name)),
  });
  await page.waitForTimeout(3000);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3500); }
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
  if (await apply.count()) { await apply.first().click(); await page.waitForTimeout(600); }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}

// ── 3 岔路口（一張工作表、支線並排）──────────────────────
await importFile("11017T1502岡山北路育才路口.xlsx");
const state1 = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("table tbody tr")];
  return { hasNote: !!document.querySelector(".partial-day-note"), rowCount: rows.length };
});
ok("匯入後出現「部分時段調查」提醒", state1.hasNote);
const noteText = await page.locator(".partial-day-note").first().innerText().catch(() => "");
console.log("   提醒內容：", noteText.replace(/\s+/g, " ").slice(0, 150));
ok("提醒指出實際調查時段與合計時數", /07:00～09:00、17:00～19:00/.test(noteText) && /合計 4 小時/.test(noteText), noteText.slice(0, 60));
ok("表頭改為「全日（輛/調查日）」", (await page.locator("th:has-text('全日（輛/調查日）')").count()) > 0);

// 版面：提醒方塊不可以超出所在面板的範圍
const overflow = await page.evaluate(() => {
  const note = document.querySelector(".partial-day-note");
  if (!note) return null;
  const panel = note.closest(".panel");
  const n = note.getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  const style = getComputedStyle(note);
  return {
    right: Math.round(p.right - n.right),
    left: Math.round(n.left - p.left),
    hasBox: style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.borderLeftWidth !== "0px",
  };
});
console.log("   提醒方塊邊距：", JSON.stringify(overflow));
ok("提醒方塊沒有超出面板（左右都有留邊）", overflow && overflow.right >= 8 && overflow.left >= 8, JSON.stringify(overflow));
ok("提醒方塊有底色與外框，不是裸文字", overflow && overflow.hasBox);

const peakCell = await page.evaluate(() => {
  const table = [...document.querySelectorAll("table")].find((t) =>
    [...t.querySelectorAll("th")].some((th) => th.textContent.includes("尖峰（PCU/小時）")));
  if (!table) return null;
  const heads = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim());
  const row = table.querySelector("tbody tr");
  const cells = [...row.querySelectorAll("td")].map((td) => td.textContent.trim());
  const i = heads.findIndex((h) => h.includes("全部") && h.includes("尖峰"));
  return { peak: cells[i], heads: heads.slice(0, 4) };
});
console.log("   路口尖峰欄：", JSON.stringify(peakCell));
ok("路口尖峰欄有數值", !!peakCell && peakCell.peak && peakCell.peak !== "0");

// 儀表板頂端的「尖峰小時當量交通量」卡片：必須是滾動一小時，不是單一 15 分鐘格
const peakCard = await page.evaluate(() => {
  const card = [...document.querySelectorAll("*")].find(
    (n) => n.children.length && [...n.children].some((c) => c.textContent.trim() === "尖峰小時當量交通量"),
  );
  if (!card) return null;
  const text = card.textContent.replace(/\s+/g, " ");
  return text.slice(0, 220);
});
console.log("   尖峰卡片：", peakCard);
ok(
  "尖峰小時卡片顯示滾動一小時（07:00～08:00），不是單一 15 分鐘格",
  /07:00～08:00/.test(peakCard || "") && !/07:00～07:15|07:30～07:45/.test((peakCard || "").split("全部方向同時段")[0]),
  (peakCard || "").slice(0, 90),
);
ok("尖峰小時當量交通量等於參考檔的 3,373", /3,373/.test(peakCard || ""), (peakCard || "").slice(0, 90));

// 時段分析面板：上午／下午尖峰要落在滾動視窗上
const period = await page.evaluate(() => {
  const panel = document.getElementById("periodAnalysis");
  if (!panel) return null;
  const rows = [...panel.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()));
  return rows.filter((r) => r.some((c) => /尖峰小時/.test(c))).slice(0, 6);
});
console.log("   時段分析（前幾列）：", JSON.stringify(period?.map((r) => r.slice(0, 4))));
const flat = JSON.stringify(period ?? []);
ok("上午尖峰時段為滾動視窗結果（07:00～08:00）", /07:00～08:00/.test(flat), flat.slice(0, 200));
ok("下午尖峰時段為滾動視窗結果（17:00～18:00）", /17:00～18:00/.test(flat));

// ── 7 岔路口（一支線一張工作表、往B～往G）──────────────
await importFile("11017T1501中山北路岡山路口七叉路口.xlsx");
const arms = await page.evaluate(() => {
  const ths = [...document.querySelectorAll("th")].map((th) => th.textContent);
  return ths.filter((t) => /路口[A-G]（輛\/日）/.test(t)).length;
});
ok("七叉路口的 7 條支線都被辨識", arms >= 7, `${arms} 條`);
const roadCount = await page.evaluate(() =>
  [...document.querySelectorAll("select")].some((s) => [...s.options].some((o) => /岡山/.test(o.textContent))));
ok("七叉路口已成為可分析的調查點", roadCount);

// ── 尖峰時段認定：以七叉路口實測檔驗證兩種模式 ────────────────
// 這個路口上午各支線的尖峰各不相同（A 是 07:00～08:00、B 是 07:30～08:30），
// 正是使用者回報「駛入路口A 合計 432.2、我算的是 422.4」的成因。
// 切到「駛入」視角才對得上參考檔「進入該路口交通量」。
await page.locator("select").first().waitFor();
await page.selectOption('select:has(option[value="destination"])', "destination").catch(() => {});
await page.locator("#periodViewSelect").selectOption("am");
await page.locator("#periodMetricSelect").selectOption("pcu");
await page.waitForTimeout(600);

const readPeriod = async () =>
  page.evaluate(() => {
    const panel = document.getElementById("periodAnalysis");
    if (!panel) return [];
    return [...panel.querySelectorAll("tbody tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()))
      // 只取七叉路口那一個調查點；另一個三叉路口的列不能混進來
      .filter((r) => /中山北/.test(r[0] ?? ""));
  });

await page.locator("#periodPeakScopeSelect").selectOption("point");
await page.waitForTimeout(600);
const pointRows = await readPeriod();
const num = (v) => Number(String(v ?? "").replace(/,/g, ""));
const armRow = (rows, name) => rows.find((r) => (r[1] ?? "").trim() === name);
console.log("   point 模式（前 3 列）：", JSON.stringify(pointRows.slice(0, 3).map((r) => [r[1], r[3], r.at(-1)])));

// 註：這裡不比對 422.4 這類絕對值。畫面上的轉向分類是依「路口幾何」的
// 預設角度自動判定的，與使用者實際設定的角度不同，PCU 自然不會一樣；
// 對參考檔數字的驗證由 tests/intersection-peak-window.test.mjs 負責
// （那裡用的是從參考檔反推出來的實際轉向對應）。
// 這支 E2E 要守的是「結構」：同一路口所有支線共用同一個尖峰視窗，且可相加。
const a = armRow(pointRows, "駛入路口A");
const b = armRow(pointRows, "駛入路口B");
const armRows = pointRows.filter((r) => /^駛入路口[A-G]$/.test((r[1] ?? "").trim()));
const totalRow = pointRows.find((r) => /合計/.test(r[1] ?? ""));
ok("七叉路口：駛入路口A 的上午尖峰時段為 07:15～08:15（整個路口的尖峰）",
  a?.[3] === "07:15～08:15", `${a?.[1]} → ${a?.[3]}`);
ok("七叉路口：7 條支線都被列出，且尖峰時段全部相同",
  armRows.length === 7 && new Set(armRows.map((r) => r[3])).size === 1,
  `${armRows.length} 條、時段 ${[...new Set(armRows.map((r) => r[3]))].join("/")}`);
const armSum = armRows.reduce((sum, r) => sum + num(r.at(-1)), 0);
ok("七叉路口：7 條支線相加等於合計那一列",
  Math.abs(armSum - num(totalRow?.at(-1))) < 0.6,
  `相加 ${armSum.toFixed(1)} vs 合計 ${totalRow?.at(-1)}`);

await page.locator("#periodPeakScopeSelect").selectOption("direction");
await page.waitForTimeout(600);
const dirRows = await readPeriod();
const a2 = armRow(dirRows, "駛入路口A");
const b2 = armRow(dirRows, "駛入路口B");
console.log("   direction 模式：", JSON.stringify([[a2?.[1], a2?.[3], a2?.at(-1)], [b2?.[1], b2?.[3], b2?.at(-1)]]));
ok("切成「各方向各自認定」後，各支線會退回自己的尖峰時段（A 為 07:00～08:00、B 為 07:30～08:30）",
  a2?.[3] === "07:00～08:00" && b2?.[3] === "07:30～08:30",
  `A=${a2?.[3]} / B=${b2?.[3]}`);
// 各自認定的值一定 ≥ 共用視窗的值（自己找的視窗至少不會比別人挑的差）
ok("各自認定模式下，A、B 的值都不小於共用視窗的值",
  num(a2?.at(-1)) >= num(a?.at(-1)) && num(b2?.at(-1)) >= num(b?.at(-1)),
  `A ${a?.at(-1)}→${a2?.at(-1)}、B ${b?.at(-1)}→${b2?.at(-1)}`);
const dirArmRows = dirRows.filter((r) => /^駛入路口[A-G]$/.test((r[1] ?? "").trim()));
ok("各自認定模式下，各支線相加會大於合計（所以那一欄不可相加）",
  dirArmRows.reduce((sum, r) => sum + num(r.at(-1)), 0) >
    num(dirRows.find((r) => /合計/.test(r[1] ?? ""))?.at(-1)),
  `相加 ${dirArmRows.reduce((sum, r) => sum + num(r.at(-1)), 0).toFixed(1)}`);
await page.locator("#periodPeakScopeSelect").selectOption("point");
await page.waitForTimeout(300);

// ── 這一區自己的「路口流量視角」：可單獨切換，也可兩者並列 ──────
await page.locator("#periodFlowViewSelect").selectOption("origin");
await page.waitForTimeout(600);
const originRows = await readPeriod();
ok("這一區可單獨切到「駛出路口」，不必動上方工具列",
  originRows.some((r) => /^駛出路口A$/.test((r[1] ?? "").trim())),
  originRows.slice(0, 3).map((r) => r[1]).join("、"));

await page.locator("#periodFlowViewSelect").selectOption("destination");
await page.waitForTimeout(600);
const destRows = await readPeriod();
ok("這一區可單獨切到「駛入路口」",
  destRows.some((r) => /^駛入路口A$/.test((r[1] ?? "").trim())),
  destRows.slice(0, 3).map((r) => r[1]).join("、"));

await page.locator("#periodFlowViewSelect").selectOption("both");
await page.waitForTimeout(700);
const bothRows = await readPeriod();
const hasOut = bothRows.some((r) => /^駛出路口A$/.test((r[1] ?? "").trim()));
const hasIn = bothRows.some((r) => /^駛入路口A$/.test((r[1] ?? "").trim()));
ok("選「駛出＋駛入並列」時，同一支線的兩種視角會同時出現",
  hasOut && hasIn, `駛出A=${hasOut}、駛入A=${hasIn}、共 ${bothRows.length} 列`);
const bothTotals = bothRows.filter((r) => /合計/.test(r[1] ?? ""));
ok("並列時兩列合計都有標明是哪一種視角",
  bothTotals.length === 2 &&
    bothTotals.some((r) => /駛出/.test(r[1])) &&
    bothTotals.some((r) => /駛入/.test(r[1])),
  bothTotals.map((r) => r[1]).join(" ｜ "));
// 兩種視角的總計必定相同（同一批車，只是換個角度數）
const totalOf = (row) => Number(String(row?.at(-1) ?? "").replace(/,/g, ""));
ok("並列時兩種視角的合計數值相同（同一批車）",
  bothTotals.length === 2 &&
    Math.abs(totalOf(bothTotals[0]) - totalOf(bothTotals[1])) < 0.6,
  bothTotals.map((r) => r.at(-1)).join(" vs "));
await page.locator("#periodFlowViewSelect").selectOption("follow");
await page.waitForTimeout(400);

ok("全程無 JS 錯誤", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(problems.length ? `\n未通過 ${problems.length} 項：\n- ${problems.join("\n- ")}` : "\n全部通過");
await browser.close();
server.close();
process.exit(problems.length ? 1 : 0);
