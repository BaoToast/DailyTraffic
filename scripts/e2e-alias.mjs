/*
 * ══════════════════════════════════════════════════════════════════════
 *  檔名別名：改完名稱之後，下一季匯入同一份檔案要自動併入
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「路口轉向程式匯入檔案，針對路名有別名的設定嗎? 之前有說過三份程式
 *     都要有，這點我驗證不到，只能請你針對三份程式作一下驗證有別名的設定」
 *
 * 這一支驗的是**別名真正的用途**，不是「畫面上有這個欄位」：
 *   ① 改了正式名稱之後，系統自動記住「原始檔名的舊名 ＝ 新名」
 *   ② 清單上列得出來
 *   ③ ⚠️ **下一季匯入同一份檔案時，自動併到改名後那一筆**
 *      ——不會多長出一個調查點，也不會再問一次
 *   ④ 備份帶得走、還原回得來
 *
 * ⚠️ ③ 才是重點。只驗①②的話，別名就算完全沒被匯入流程用到也會全綠，
 *   而使用者實際會遇到的就是「每一季都要重新回答一次」。
 *
 * ⚠️ 這支跑的是 GitHub Pages 那份**離線建置**（app-fetch.ts 的 IndexedDB
 *   影子實作），不是後端資料庫版——使用者用的就是這一份。
 *   線上版與離線版是兩條路徑，只驗線上版等於沒驗到他手上那一支。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8195, r));

const problems = [];
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
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
const downloads = [];
page.on("download", (d) => downloads.push(d));

await page.goto("http://localhost:8195/");
await page.waitForTimeout(900);

const SAMPLE = "115T1-01_中山路.xlsx";

const closeAnyModal = async () => {
  /*
   * ⚠️ 先把還開著的視窗關掉再去點側欄。
   *   .modal-backdrop 蓋滿整個畫面，會攔截所有點擊——症狀是
   *   「等 30 秒然後說點不到側欄」，看起來像側欄壞了，其實是前一個視窗沒關。
   */
  for (let i = 0; i < 6; i += 1) {
    if (!(await page.locator(".modal-backdrop").count())) return;
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消"), .modal-backdrop button:has-text("套用車種設定")',
      )
      .first();
    if (!(await closer.count())) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      continue;
    }
    await closer.click().catch(() => {});
    await page.waitForTimeout(500);
  }
};

async function importSample(quarter) {
  await closeAnyModal();
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name: SAMPLE,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, SAMPLE)),
    });
  await page.waitForTimeout(2500);
  /*
   * ⚠️ 這裡要記下「系統有沒有問我要不要併入」。
   *   別名生效時就**不會問**——那正是第 ③ 條要驗的事。
   */
  const asked = await page.evaluate(() => {
    const modal = document.querySelector(".modal-backdrop .modal");
    return modal ? /併入|要不要合併|同一個調查點/.test(modal.textContent || "") : false;
  });
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3000);
  }
  for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(500);
  }
  return asked;
}

/*
 * 直接讀離線建置用的 IndexedDB。
 *
 * ⚠️ 不可以在頁面裡用 fetch("/api/roads")：那個 API 是
 *   app-fetch.ts 的**影子實作**，只有程式自己呼叫 appFetch() 時才會走到；
 *   從頁面直接 fetch 會打到靜態檔案伺服器，拿回 404，
 *   而 `data.aliases || []` 會把 404 變成「沒有別名」——
 *   於是「一開始沒有別名」恆綠、「改名後有別名」恆紅。第一版就是這樣。
 *   讀 IndexedDB 讀到的是真正存下去的東西，也與程式同一個來源。
 */
const readStore = (store) =>
  page.evaluate(
    (name) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("traffic-analysis-github-pages", 2);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(name)) return resolve([]);
          const request = db.transaction(name, "readonly").objectStore(name).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        };
      }),
    store,
  );

const currentProjectId = () =>
  page.evaluate(() => document.querySelector("#projectSwitch")?.value || "");

const aliasState = async () => {
  const projectId = await currentProjectId();
  const aliases = (await readStore("aliases")).filter(
    (a) => a.projectId === projectId,
  );
  return { projectId, aliases };
};

/* ── 建計畫並匯入第一季 ── */
await page
  .getByRole("button", { name: "＋" })
  .first()
  .click()
  .catch(() => {});
if (
  !(await page
    .locator(".modal input")
    .first()
    .isVisible()
    .catch(() => false))
)
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("別名測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);

await importSample("115Q1");
const start = await aliasState();
ok("前置：第一季匯進去了", Boolean(start.projectId), start.projectId);
ok(
  "前置：一開始沒有任何別名",
  start.aliases.length === 0,
  failOnly(`已經有 ${start.aliases.length} 筆`),
);

/* ── ① 改正式名稱 ── */
console.log("\n══ ① 改名之後自動記住舊名 ══");
/*
 * ⚠️ 入口在「二 參數設定」的「路段／路口主檔管理」卡片，不是工具列。
 *   工具列上沒有這一顆——第一版對著工具列找，等了 30 秒才超時。
 */
const openRoadManager = async () => {
  await closeAnyModal();
  await page
    .locator('.side-nav-group button[data-goto="zone-settings"]')
    .first()
    .click();
  await page.waitForTimeout(600);
  await page
    .locator('#card-road-master button:has-text("管理名稱")')
    .first()
    .click();
  await page.waitForTimeout(900);
};
await openRoadManager();
const nameInput = page
  .locator('.modal-backdrop .modal label:has-text("名稱") input')
  .first();
ok("路段管理視窗開得起來", (await nameInput.count()) > 0);
const oldName = await nameInput.inputValue();
const NEW_NAME = "中山路（改名後）";
await nameInput.fill(NEW_NAME);
await page
  .locator('.modal-backdrop button:has-text("儲存名稱設定")')
  .first()
  .click();
await page.waitForTimeout(2500);
/*
 * ⚠️ 別名是存進去之後才讀得到；第一版讀太早，量到 0 筆而後面第②段又看得到，
 *   那種前後矛盾的紅字最容易被誤判成「功能壞了」。改成重試幾次。
 */
let afterRename = await aliasState();
for (let i = 0; i < 8 && afterRename.aliases.length === 0; i += 1) {
  await page.waitForTimeout(600);
  afterRename = await aliasState();
}
ok(
  "① 改名之後自動記了一筆別名",
  afterRename.aliases.length === 1,
  afterRename.aliases.map((a) => `${a.aliasName}→${a.roadId}`).join("、") ||
    "一筆都沒有",
);
ok(
  "① 記的是改名前那個名字",
  afterRename.aliases[0]?.aliasName === oldName,
  `記到的是「${afterRename.aliases[0]?.aliasName}」，改名前是「${oldName}」`,
);

/* ── ② 清單上列得出來 ── */
console.log("\n══ ② 畫面上看得到 ══");
await openRoadManager();
const listed = await page.evaluate(() => {
  const list = document.querySelector(".alias-list");
  return list ? (list.textContent || "").replace(/\s+/g, "") : null;
});
ok("路段管理視窗裡有「現有別名」清單", listed !== null, failOnly("找不到 .alias-list"));
ok(
  "② 清單上寫得出剛剛那個舊名",
  Boolean(listed) && listed.includes(oldName.replace(/\s+/g, "")),
  `清單內容：${listed}`,
);
await closeAnyModal();

/* ── ③ 下一季匯入同一份檔案，要自動併入 ── */
console.log("\n══ ③ 下一季匯入同一份檔案（重點）══");
const askedAgain = await importSample("115Q2");
await page.waitForTimeout(1500);
const projectId = await currentProjectId();
const rows = (await readStore("records")).filter(
  (r) => r.projectId === projectId,
);
const byRoad = new Map();
for (const row of rows) {
  if (!byRoad.has(row.roadId))
    byRoad.set(row.roadId, { name: row.roadName, quarters: new Set() });
  byRoad.get(row.roadId).quarters.add(row.quarter);
}
const merged = [...byRoad.entries()].map(([roadId, info]) => ({
  roadId,
  name: info.name,
  quarters: [...info.quarters].sort(),
}));
/*
 * ⚠️ 這一條是整支測試的理由。
 *   別名沒有生效的話，第二季會變成**另一個調查點**（同樣的原始檔名、
 *   但對不上已改名的那一筆），於是清單上會有兩個路段，
 *   而使用者每一季都要再回答一次「要不要併入」。
 */
ok(
  "③ 兩季都併到**同一個**調查點（沒有多長出一個）",
  merged.length === 1,
  merged.map((m) => `${m.name}[${m.quarters.join(",")}]`).join("｜"),
);
ok(
  "③ 那一個調查點確實含兩季",
  merged[0]?.quarters.length === 2,
  merged[0] ? merged[0].quarters.join("、") : "沒有資料",
);
/*
 * ⚠️ 名字要**一字不差**，包含全形括號。
 *   實測（2026-09-12）舊版會把「中山路（改名後）」存成「中山路(改名後)」——
 *   後端與離線版都對名稱做了 NFKC，而 NFKC 會把全形括號換成半形。
 *   依專案定過的分界：看不出來的（空白）可以吸收，看得出來的（全半形括號）
 *   屬於內容、不可以被系統改掉。正規化只用在比對鍵（roadNameMatchKey）。
 */
ok(
  "③ 而且用的是改名後的名字，連全形括號都原樣保留",
  merged[0]?.name === NEW_NAME,
  `目前名稱「${merged[0]?.name}」，輸入的是「${NEW_NAME}」`,
);
ok(
  "③ 匯入時沒有再問一次「要不要併入」",
  askedAgain === false,
  failOnly("又跳出併入詢問——別名沒有生效"),
);

/* ── ④ 備份帶得走、還原回得來 ── */
console.log("\n══ ④ 備份 → 還原 ══");
/*
 * ⚠️ X-73 起側欄是手風琴：只有目前那一頁的小分頁會列出來，
 *   所以不可以直接點 `[data-anchor]`——那一顆可能還不存在。
 *   走 gotoBlock()，它會先切到那一塊所在的大分頁。
 */
await gotoBlock(page, "backup-one");
await page.waitForTimeout(700);
downloads.length = 0;
await page
  .locator('#backup-one button:has-text("下載本計畫備份")')
  .first()
  .click();
await page.waitForTimeout(3000);
ok("備份檔下載得下來", downloads.length === 1, `${downloads.length} 個檔案`);
if (downloads.length === 1) {
  const bundle = JSON.parse(readFileSync(await downloads[0].path(), "utf8"));
  ok(
    "④ 備份檔裡帶著別名",
    Array.isArray(bundle.roadAliases) &&
      bundle.roadAliases.some((a) => a.aliasName === oldName),
    JSON.stringify(bundle.roadAliases || []).slice(0, 160),
  );
}

ok(
  "整段沒有 JS 例外",
  errors.length === 0,
  failOnly(errors.slice(0, 3).join(" | ")),
);

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 別名會自動記住，而且下一季匯入同一份檔案真的自動併入");
