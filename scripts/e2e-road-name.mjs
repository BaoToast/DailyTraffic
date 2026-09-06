/*
 * 端對端：檔名沒有分隔符時，下一季匯入同一條路要自動接到既有路段。
 *
 * 為什麼要有這一支：單元測試只驗 roadNameFromFileName() 這一個函式的輸出，
 * 但使用者實際會遇到的是**整條匯入流程**——檔名切出來的名稱要一路傳到
 * resolveImportedRoad()，那裡才決定「這是既有路段還是新路段」。中間任何一段
 * 沒接上，單元測試都是綠的、使用者的畫面照樣多出一條路段。
 *
 * 修正前的行為（實測）：
 *   第一季匯入「999999T1501示範北路示範一路口.xlsx」→ 路段名稱＝整個檔名
 *   第二季匯入「999999T1601示範北路示範一路口.xlsx」（只有場次號 +1）
 *   → 名稱與編號都對不上 → 跳出 window.prompt 詢問視窗
 *   → 使用者若沒手動指定，就變成第二條路段，歷季趨勢斷成兩截
 *
 * ⚠️ 假通過陷阱三個，都已處理：
 *  一、**詢問視窗要真的被偵測到。** 其他 e2e 腳本一律 `d.accept("N")`，
 *      那會靜靜地把 prompt 吃掉、然後另建路段，測試看起來一切正常。
 *      這一支改成**記錄下來**，並且直接把「有沒有跳 prompt」當成判準。
 *  二、**要先確認第一季真的寫進去了。** 否則第二季「路段數沒有增加」
 *      會變成 0 → 0 的恆真檢查。
 *  三、**要確認兩個檔名真的不同。** 若兩季檔名一樣，「自動接得上」是廢話。
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
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/*
 * 樣本檔的內容沿用 make-samples.mjs 產生的那一份路段表；這一支只換檔名，
 * 因為要驗的就是「檔名怎麼切」。兩個檔名只差場次號 T15 → T16。
 */
const SOURCE = join(SAMPLES, "115T1-01_中山路.xlsx");
const Q1_NAME = "999999T1501示範北路示範一路口.xlsx";
const Q2_NAME = "999999T1601示範北路示範一路口.xlsx";

await new Promise((r) => server.listen(8107, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" });
const page = await ctx.newPage();
const errors = [];
const prompts = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
/*
 * 詢問視窗不吃掉、要記下來：它出現本身就是「系統認不出這是同一條路」的證據。
 * 回傳 null（等同按取消）會讓匯入中止，所以這裡回 "N"（另建路段）讓流程走完，
 * 但 prompts 陣列已經留下紀錄，判準看的是那個陣列。
 */
page.on("dialog", (d) => {
  if (d.type() === "prompt") prompts.push(d.message());
  d.accept(d.type() === "prompt" ? "N" : "");
});

await page.goto("http://localhost:8107/");
await page.waitForTimeout(800);

/* ── 建立計畫 ── */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("跨季路段名稱測試");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

const buffer = readFileSync(SOURCE);
async function importAs(fileName, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(quarter);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.waitForTimeout(2800);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(3000); }
  /* 樣本檔有三個新車種，車種管理視窗會自動跳出——直接套用預設值 */
  const apply = page.locator('.vehicle-class-modal button:has-text("套用車種設定")');
  if (await apply.count()) { await apply.first().click(); await page.waitForTimeout(600); }
  const geo = page.locator('.intersection-manager-modal button:has-text("關閉"), .intersection-manager-modal button:has-text("取消")');
  if (await geo.count()) { await geo.first().click(); await page.waitForTimeout(600); }
  for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")')
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
}

/* 從 IndexedDB 直接讀，畫面篩選不會影響判讀 */
const readRoads = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("traffic-analysis-github-pages");
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("records")) return resolve({ roads: [], rows: 0 });
          const all = db.transaction("records", "readonly").objectStore("records").getAll();
          all.onsuccess = () => {
            const rows = all.result || [];
            const roads = [...new Set(rows.map((r) => `${r.roadId}｜${r.roadName}`))];
            resolve({ roads, rows: rows.length, quarters: [...new Set(rows.map((r) => r.quarter))] });
          };
          all.onerror = () => resolve(null);
        };
      }),
  );

/* ── 前置：兩季檔名真的不同 ── */
ok("前置：兩季檔名確實不同（只差場次號）", Q1_NAME !== Q2_NAME, `${Q1_NAME} vs ${Q2_NAME}`);

/* ── 第一季 ── */
await importAs(Q1_NAME, "115Q1");
const first = await readRoads();
ok(
  "前置：第一季確實寫進去了",
  Boolean(first) && first.rows > 0 && first.roads.length === 1,
  `明細 ${first?.rows ?? "?"} 筆、路段 ${first?.roads.join("、") || "（無）"}`,
);
ok(
  "路段名稱不可以還帶著案號與場次前綴",
  Boolean(first) && first.roads.every((r) => !/｜\s*\d{4,}\s*T/i.test(r)),
  `路段 ${first?.roads.join("、")}`,
);

const promptsAfterFirst = prompts.length;

/* ── 第二季：同一條路，只有場次號 +1 ── */
await importAs(Q2_NAME, "115Q2");
const second = await readRoads();

ok(
  "第二季不可以跳出「無法確定是否屬於既有路段」的詢問視窗",
  prompts.length === promptsAfterFirst,
  prompts.length === promptsAfterFirst
    ? "沒有跳詢問"
    : `跳了 ${prompts.length - promptsAfterFirst} 次：${prompts.slice(promptsAfterFirst).join(" ｜ ").slice(0, 120)}`,
);
ok(
  "第二季要併進同一條路段，路段數不可以變成兩條",
  Boolean(second) && second.roads.length === 1,
  `路段 ${second?.roads.join("、") || "（無）"}`,
);
ok(
  "前置：第二季確實寫進去了（否則上一項是 1→1 的恆真檢查）",
  Boolean(second) && second.quarters.length === 2 && second.rows > first.rows,
  `季度 ${second?.quarters.join("、")}、明細 ${first?.rows} → ${second?.rows} 筆`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
