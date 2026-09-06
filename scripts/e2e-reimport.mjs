/*
 * 端對端：使用者以為沒匯入成功、又把同一批檔案匯一次，系統要擋得住。
 *
 * 起因是使用者的顧慮（原話）：
 *   「我怕如果使用者誤以為沒匯入到資料，然後重複匯入相同資料，
 *     系統卻沒有阻止，這樣才是異常。」
 *
 * 驗三件事：
 *  一、匯入期間畫面被遮罩擋住，底下的控制項按不到（不是只有文字提示）。
 *  二、同一批檔案匯第二次，紀錄數**不可以翻倍**。這是最關鍵的一項：
 *      翻倍代表同一份調查被算了兩次，而總量守恆的檢查抓不到
 *      （兩份都是合法資料，加起來也「合法」）。
 *  三、系統要有辦法讓使用者知道這批是既有資料，而不是靜靜覆蓋。
 *
 * ⚠️ 寫這一支時要小心兩種假通過：
 *  ・只看 .busy 遮罩存在 → 遮罩可能只是視覺，底下照樣點得到。
 *    所以要用 elementFromPoint 實際驗「那個點打到的是遮罩」。
 *  ・只數畫面上的列數 → 畫面可能有篩選或分頁。所以直接數 records 狀態。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
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
await new Promise((r) => server.listen(8149, r));

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const names = readdirSync(SAMPLES).filter((n) => /\.xlsx$/i.test(n));
if (!names.length) {
  console.log("❌ 找不到樣本檔，請先執行 node scripts/make-samples.mjs");
  server.close();
  process.exit(1);
}
const batch = names.map((name) => ({
  name,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(join(SAMPLES, name)),
}));

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1500, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8149/");
await page.waitForTimeout(900);

/* 建立計畫 */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("重複匯入測試計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);

/*
 * 匯入之後會連跳三個視窗：檢核報告 →（可能）車種設定 →（可能）道路與流向。
 *
 * ⚠️ 這裡踩過一次坑：本來用 `button:has-text("取消")` 當萬用關閉鍵，
 *    結果檢核報告上的「取消，資料不變」先被選中，等於每一次都把匯入取消掉，
 *    IndexedDB 一直是 0 筆——而「不可以翻倍」那一項照樣全綠（0→0）。
 *    那是典型的假通過，靠「第一次匯入之後確實有資料」這個前置檢查才抓到。
 *    所以推進鍵一律優先挑肯定語意的那一顆，否定語意的絕不當關閉鍵。
 */
const advanceModals = async () => {
  const report = { added: null, replaced: null, text: "" };
  for (let round = 0; round < 8; round += 1) {
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll(".modal-backdrop button")].map((b) =>
        b.textContent.trim(),
      ),
    );
    if (!buttons.length) break;
    const text = await page.evaluate(
      () => document.querySelector(".modal-backdrop")?.innerText || "",
    );
    /* 檢核報告上的「新增 N 筆／覆蓋 N 筆」就是要給使用者看的那組數字 */
    if (/匯入前資料檢核報告/.test(text)) {
      report.text = text;
      report.added = Number((text.match(/新增\s*\|?\s*([\d,]+)\s*筆/) || [])[1]?.replace(/,/g, "") ?? NaN);
      report.replaced = Number((text.match(/覆蓋\s*\|?\s*([\d,]+)\s*筆/) || [])[1]?.replace(/,/g, "") ?? NaN);
    }
    const advance =
      buttons.find((b) => /^確認追加$|^確認覆蓋$|^確認寫入$|^確認匯入$/.test(b)) ||
      buttons.find((b) => /^套用車種設定$|^儲存設定$/.test(b)) ||
      buttons.find((b) => /^確認$/.test(b));
    if (!advance) break;
    await page
      .locator(`.modal-backdrop button:text-is("${advance}")`)
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(1300);
  }
  /* 最後把還開著的視窗關掉（這時候關閉已經不會取消已寫入的資料） */
  for (let round = 0; round < 4; round += 1) {
    const closer = page.locator('.modal-backdrop button:text-is("取消")').first();
    if (!(await closer.count())) break;
    await closer.click().catch(() => {});
    await page.waitForTimeout(600);
  }
  return report;
};

const importOnce = async () => {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill("115Q1");
  /*
   * 一邊送檔一邊量遮罩：不只看遮罩在不在，還要驗畫面中央那個點
   * 實際打到的是不是遮罩——遮罩若只是視覺、沒有擋住指標事件，
   * 使用者照樣點得到底下的按鈕，那等於沒擋。
   */
  await page.evaluate(() => {
    window.__probe = { samples: 0, busy: 0, blocked: 0 };
    window.__timer = setInterval(() => {
      window.__probe.samples += 1;
      const el = document.querySelector(".busy");
      if (!el) return;
      window.__probe.busy += 1;
      const hit = document.elementFromPoint(
        Math.floor(window.innerWidth / 2),
        Math.floor(window.innerHeight / 2),
      );
      if (hit && (hit.closest(".busy") || hit.classList.contains("busy")))
        window.__probe.blocked += 1;
    }, 10);
  });
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles(batch);
  await page.waitForTimeout(9000);
  const probe = await page.evaluate(() => {
    clearInterval(window.__timer);
    return window.__probe;
  });
  const report = await advanceModals();
  return { ...probe, report };
};

/*
 * 紀錄存在 IndexedDB（github-pages 版的離線 shim），不是 localStorage。
 * 主鍵 _id 就是 recordIdentity(projectId|quarter|roadId|dayType|directionCode|hour)，
 * 所以「同一筆資料匯兩次」在儲存層是 put 同一個鍵——這一支就是要驗那件事
 * 真的成立，而不是只相信程式碼看起來會覆蓋。
 */
const countRecords = async () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open("traffic-analysis-github-pages", 2);
        request.onerror = () => resolve({ records: -1, roads: -1, error: "開不了 DB" });
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("records"))
            return resolve({ records: 0, roads: 0, error: "沒有 records 資料表" });
          const getAll = db
            .transaction("records", "readonly")
            .objectStore("records")
            .getAll();
          getAll.onsuccess = () => {
            const list = getAll.result || [];
            resolve({
              records: list.length,
              roads: new Set(list.map((r) => r.roadId ?? "")).size,
              ids: new Set(list.map((r) => r._id ?? "")).size,
            });
          };
          getAll.onerror = () => resolve({ records: -1, roads: -1, error: "讀不到" });
        };
      }),
  );

/* ── 第一次匯入 ── */
const first = await importOnce();
ok(
  "匯入期間畫面上有處理中遮罩",
  first.busy > 0,
  `取樣 ${first.samples} 次、遮罩出現 ${first.busy} 次`,
);
ok(
  "遮罩是真的擋住底下的操作（不是只有視覺）",
  first.busy > 0 && first.blocked === first.busy,
  `遮罩 ${first.busy} 次、其中真正擋住 ${first.blocked} 次`,
);

const afterFirst = await countRecords();
ok(
  "第一次匯入之後確實有資料",
  afterFirst.records > 0,
  `紀錄 ${afterFirst.records} 筆、調查點 ${afterFirst.roads} 個`,
);

ok(
  "第一次匯入的檢核報告寫的是「新增」，覆蓋 0 筆",
  first.report.added > 0 && first.report.replaced === 0,
  `新增 ${first.report.added} 筆、覆蓋 ${first.report.replaced} 筆`,
);

/* ── 第二次：一模一樣的檔案再匯一次 ── */
const second = await importOnce();
const afterSecond = await countRecords();
/*
 * 這一項才是使用者真正在意的：他怕的是「重複匯入而系統沒擋」。
 * 檢核報告在**寫入之前**就把「覆蓋 N 筆、新增 0 筆」攤出來，
 * 使用者按下確認之前就看得到自己在重覆匯入。
 */
ok(
  "第二次匯入的檢核報告要明講是「覆蓋」，而且新增 0 筆",
  second.report.replaced === first.report.added && second.report.added === 0,
  `新增 ${second.report.added} 筆、覆蓋 ${second.report.replaced} 筆（第一次寫入 ${first.report.added} 筆）`,
);
ok(
  "同一批檔案匯第二次，紀錄數不可以翻倍",
  afterSecond.records === afterFirst.records,
  `第一次 ${afterFirst.records} 筆 → 第二次 ${afterSecond.records} 筆`,
);
ok(
  "同一批檔案匯第二次，調查點數不可以增加",
  afterSecond.roads <= afterFirst.roads,
  `第一次 ${afterFirst.roads} 個 → 第二次 ${afterSecond.roads} 個`,
);
/*
 * 主鍵數必須等於筆數。兩者一旦不等，代表有紀錄拿到了重複的 _id，
 * 那正是「同一筆調查存成兩筆」的儲存層徵兆。
 */
ok(
  "每一筆紀錄的主鍵都是唯一的（沒有同一份調查存成兩筆）",
  afterSecond.ids === afterSecond.records,
  `紀錄 ${afterSecond.records} 筆、相異主鍵 ${afterSecond.ids} 個`,
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
