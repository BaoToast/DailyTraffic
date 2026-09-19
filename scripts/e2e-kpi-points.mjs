/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-28：資料檢視三張總結小卡，多個調查點時**絕不相加**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附圖）：
 *   「全日實際交通量、24小時PCU、尖峰小時當量交通量，在選擇多項調查點位時，
 *     數值是相加，按照我們之前討論的，相加是錯誤的。」
 *   裁示：「依照你的建議執行　乙案：逐調查點位分行、不加總……
 *     第三張卡底下掛著逐方向明細與算式，乘上點位數太長，這一張採甲案。」
 *
 * 兩個不同地點的全日交通量相加，數的是同一批車經過兩個斷面，
 * 那個總和不對應任何一條路的實際流量——用「加起來的數字在真實世界存在嗎」
 * 這一題判斷，答案是不存在。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**測資一定要讓兩個調查點的數值不一樣**。兩個一樣大的話，
 *     「分行」與「相加」看起來都像對的（相加＝2V、分行＝V／V，
 *     只驗「有兩行」照樣會過）。所以先分別單獨選一次，記下兩個值，
 *     而且**明確驗它們不相等**——不相等才有資格往下驗。
 * 二、**不可以只驗「有兩行」**。要驗那兩行的值**就是**單獨選時的那兩個值；
 *     否則把合計拆成兩半印出來也會過。
 * 三、**要反面驗「合計那個數字整個不出現」**。只驗正面的話，
 *     一個「兩行分開印、下面再補一列合計」的實作也會全綠——
 *     而那一列合計正是使用者指出的錯誤數字。
 * 四、尖峰卡那一條**不可以驗「卡片不見了」**。使用者的原則相反：
 *     整塊消失他會以為系統壞了（X-17）。要驗**卡片還在、說明在、數字沒有**。
 * 五、逐方向明細與算式也要一起收掉——那些數字的來源是同一份被加起來的資料。
 * 六、超過行數上限那一條要**真的把行數撐過上限**（四季 × 兩個調查點 ＝ 8 行），
 *     不是改小上限來湊。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, ensureToolbarOpen } from "./e2e-nav.mjs";

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
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] || "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};
const stop = (why) => {
  console.error(`\n❌ ${why}——後面的條件會變成恆真，直接停。`);
  problems.push(why);
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    locale: "zh-TW",
  })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
/*
 * ⚠️ 匯入第二個以後的檔案時，若檔名比對不到既有路段，程式會跳 `window.prompt`
 *   問「這個檔屬於哪一個既有路段？輸入 N 另建」。
 *   用 `event.accept()`（空字串）按確定＝輸入了一個無效編號，
 *   程式會丟「路段選擇無效，請重新匯入」，而那句話只在會自動消失的 toast 裡——
 *   看起來就像「選了檔卻毫無反應」。**一定要回 N**（另建路段）。
 */
page.on("dialog", (event) =>
  event.accept(event.type() === "prompt" ? "N" : ""),
);
await page.goto(base, { waitUntil: "networkidle" });
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(2000);

/* ── 前置：建計畫 → 兩個調查點 × 四個季度 ────────────────────── */
await page
  .getByRole("button", { name: "＋" })
  .first()
  .click()
  .catch(() => {});
if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
await page.locator(".modal-backdrop .modal input").first().fill("總結小卡守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

/*
 * ⚠️ 四個檔一次送進去（不是分四次匯入）。
 *
 *   分次匯入本身沒問題——但第二次以後會跳 `window.prompt` 問「這個檔屬於
 *   哪一個既有路段」，每一次都要接對話框，腳本會長一倍而且更脆。
 *   一次送多檔時第一批沒有既有路段可比對，不會跳那個問題。
 *
 * ⚠️ 兩個**內容相同、檔名不同**的檔是拿來把行數撐過上限用的
 *   （示範站號，不可以用真實站號）。真正要比數值的是前兩個——
 *   它們的內容不同，所以「分行」與「相加」才分得出來。
 */
const BASE_A = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
const BASE_B = readFileSync(join(SAMPLES, "115T1-02_中正路口.xlsx"));
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const FILES = [
  { name: "115T1-01_中山路.xlsx", mimeType: XLSX_MIME, buffer: BASE_A },
  { name: "115T1-02_中正路口.xlsx", mimeType: XLSX_MIME, buffer: BASE_B },
  { name: "A00T00-02_示範二路.xlsx", mimeType: XLSX_MIME, buffer: BASE_A },
  { name: "A00T00-03_示範三路.xlsx", mimeType: XLSX_MIME, buffer: BASE_A },
];
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles(FILES);
await page.waitForTimeout(4500);
const confirmButton = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirmButton.count()) {
  await confirmButton.first().click();
  await page.waitForTimeout(3500);
}
const applyButton = page.locator(
  '.vehicle-class-modal button:has-text("套用車種設定")',
);
if (await applyButton.count()) {
  await applyButton.first().click();
  await page.waitForTimeout(600);
}
for (let i = 0; i < 5 && (await page.locator(".modal-backdrop").count()); i += 1) {
  const closer = page
    .locator(
      '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
    )
    .first();
  if (!(await closer.count())) break;
  await closer.click();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(800);
await gotoTab(page, TABS.kpi);
await page.waitForTimeout(1500);

/* ── 工具 ────────────────────────────────────────────────────── */
const ROAD_PICKER = "#roadFilterSelect";
/** 主工具列的調查點清單（不打開面板也數得出來）。 */
const roadOptionNames = async () => {
  await page.locator(ROAD_PICKER).click();
  await page.waitForTimeout(500);
  const names = await page.evaluate(() =>
    [...document.querySelectorAll(".multi-picker-panel .multi-picker-list label span")].map(
      (node) => (node.textContent || "").trim(),
    ),
  );
  await page.mouse.click(4, 4);
  await page.waitForTimeout(400);
  return names;
};
/** 勾選指定的幾個調查點（names 是空陣列＝全部）。 */
const pickRoads = async (names) => {
  await page.locator(ROAD_PICKER).click();
  await page.waitForTimeout(500);
  await page
    .locator('.multi-picker-panel .multi-picker-head button:has-text("全部調查點")')
    .first()
    .click();
  await page.waitForTimeout(600);
  for (const name of names) {
    if (!(await page.locator(".multi-picker-panel").count())) {
      await page.locator(ROAD_PICKER).click();
      await page.waitForTimeout(500);
    }
    await page
      .locator(`.multi-picker-panel .multi-picker-list label:has-text("${name}")`)
      .first()
      .click();
    await page.waitForTimeout(600);
  }
  await page.mouse.click(4, 4);
  await page.waitForTimeout(900);
};
/** 一張卡目前印出來的每一行（標籤＋數值），以及有沒有改成「不給數字」。 */
const cardOf = (id) =>
  page.evaluate((cardId) => {
    const card = document.getElementById(cardId);
    if (!card) return null;
    const rows = [...card.querySelectorAll(".kpi-day-values strong")].map(
      (node) => {
        const em = node.querySelector("em");
        const label = (em?.textContent || "").replace(/\s+/g, "");
        const whole = (node.textContent || "").replace(/\s+/g, "");
        return { label, value: label ? whole.slice(label.length) : whole };
      },
    );
    return {
      rows,
      overflow: !!card.querySelector(".kpi-overflow-note"),
      note: (card.querySelector(".kpi-overflow-note")?.textContent || "")
        .replace(/\s+/g, "")
        .slice(0, 60),
      directionBlocks: card.querySelectorAll(".peak-directions").length,
      text: (card.textContent || "").replace(/\s+/g, ""),
      present: true,
    };
  }, id);
const num = (text) => Number(String(text).replace(/[^\d.-]/g, ""));

/* ══ 前置 ══════════════════════════════════════════════════════ */
console.log("\n══ 前置 ══");
const names = await roadOptionNames();
ok(
  "前置：主工具列列得出四個調查點（撐得過行數上限才驗得到第四節）",
  names.length >= 4,
  names.join("、"),
);
if (names.length < 2) {
  stop("只有一個調查點，「多選會不會相加」根本驗不到");
  await browser.close();
  server.close();
  process.exit(1);
}
const [NAME_A, NAME_B] = names;
/*
 * ⚠️ 日別固定成「平日＋假日」：這一支要驗的是**調查點**這個維度，
 *   而行數上限要靠「調查點 × 日別」才撐得過 6 行。
 *   日別本身是否分行另有 e2e 在守，這裡只是把它固定成一個已知值。
 */
await page.selectOption('[data-testid="mt-day"]', "平日＋假日");
await page.waitForTimeout(1000);

/* ══ 一、單獨選一個調查點：先取得兩個「正確答案」 ══════════════ */
console.log("\n══ 一、單獨選一個調查點（對照組） ══");
/** 這一批行裡「平日」那一行的數值（日別固定成平日＋假日，所以每組都有）。 */
const weekdayValue = (card) =>
  num(
    (card?.rows ?? []).find((row) => row.label.includes("平日"))?.value ?? "",
  );
await pickRoads([NAME_A]);
const onlyA = await cardOf("card-kpi-daily");
ok(
  "① 只選一個調查點時，行數就是日別數（平日、假日各一行）",
  onlyA?.rows.length === 2,
  JSON.stringify(onlyA?.rows),
);
ok(
  "① 只有一個調查點時，標籤**只寫日別、不寫調查點名稱**（畫面不可以無故多字）",
  (onlyA?.rows ?? []).every(
    (row) => row.label === "平日" || row.label === "假日",
  ),
  (onlyA?.rows ?? []).map((row) => row.label).join("／"),
);
await pickRoads([NAME_B]);
const onlyB = await cardOf("card-kpi-daily");
ok("① 換另一個調查點也是兩行", onlyB?.rows.length === 2, JSON.stringify(onlyB?.rows));
const VA = weekdayValue(onlyA);
const VB = weekdayValue(onlyB);
ok(
  "⚠️ ① 兩個調查點的數值**不相等**（相等的話「分行」與「相加」看起來都像對的）",
  Number.isFinite(VA) && Number.isFinite(VB) && VA > 0 && VB > 0 && VA !== VB,
  `${NAME_A}=${VA}／${NAME_B}=${VB}`,
);
if (!(VA > 0 && VB > 0 && VA !== VB)) {
  stop("兩個調查點的值相等或讀不到");
  await browser.close();
  server.close();
  process.exit(1);
}

/* ══ 二、同時選兩個調查點：分行，而且合計不可以出現 ══════════ */
console.log("\n══ 二、同時選兩個調查點 ══");
await pickRoads([NAME_A, NAME_B]);
const both = await cardOf("card-kpi-daily");
ok(
  "② 兩個調查點 × 平日／假日 ＝ 四行",
  both?.rows.length === 4,
  JSON.stringify(both?.rows),
);
/* ⚠️ 比的是**平日那兩行**：與第一節單獨選時取的是同一個口徑。 */
const weekdayShown = (both?.rows ?? [])
  .filter((row) => row.label.includes("平日"))
  .map((row) => num(row.value))
  .sort((a, b) => a - b);
ok(
  "⚠️ ② 平日那兩行就是單獨選時的那兩個值（不是把合計拆成兩半）",
  weekdayShown.length === 2 &&
    weekdayShown[0] === Math.min(VA, VB) &&
    weekdayShown[1] === Math.max(VA, VB),
  `畫面上 ${weekdayShown.join("／")}　應為 ${[VA, VB].sort((a, b) => a - b).join("／")}`,
);
ok(
  "② 每一行都標出是哪一個調查點",
  (both?.rows ?? []).every((row) => row.label.length > 0) &&
    (both?.rows ?? []).some((row) => row.label.includes(NAME_A)) &&
    (both?.rows ?? []).some((row) => row.label.includes(NAME_B)),
  (both?.rows ?? []).map((row) => row.label).join("／"),
);
/*
 * ⚠️ 反面：那個相加出來的數字**一個字都不可以出現在這張卡上**。
 *   只驗正面的話，「兩行分開印、底下再補一列合計」照樣全綠。
 */
const sumText = (VA + VB).toLocaleString("en-US");
ok(
  "⚠️ ② 相加出來的合計**整張卡都不出現**",
  !(both?.text ?? "").includes(sumText),
  `不可出現的數字：${sumText}`,
);
const bothPcu = await cardOf("card-kpi-pcu24");
ok(
  "② 24小時PCU 也要分行（不可以只修了第一張卡）",
  bothPcu?.rows.length === 4,
  JSON.stringify(bothPcu?.rows),
);

/* ══ 三、尖峰卡：不給數字，但不可以整塊消失 ══════════════════ */
console.log("\n══ 三、尖峰小時當量交通量（多個調查點時不給數字） ══");
const peak = await cardOf("card-kpi-peak");
ok("③ 卡片**還在**（整塊消失會讓人以為系統壞了）", peak?.present === true);
ok("⚠️ ③ 沒有任何數值行", peak?.rows.length === 0, JSON.stringify(peak?.rows));
ok("③ 有一段說明講出為什麼不給數字", peak?.overflow === true, peak?.note);
ok(
  "⚠️ ③ 逐方向明細與算式也要一起收掉（來源是同一份被加起來的資料）",
  peak?.directionBlocks === 0,
  `還留著 ${peak?.directionBlocks} 塊`,
);

/* ══ 四、行數超過上限：一個數字都不給 ══════════════════════════ */
console.log("\n══ 四、行數超過上限（四個調查點 × 平日／假日 ＝ 8 行） ══");
await pickRoads(names.slice(0, 4));
const wide = await cardOf("card-kpi-daily");
ok("④ 收成說明、不再逐行印", wide?.rows.length === 0, JSON.stringify(wide?.rows));
ok("④ 說明有出現", wide?.overflow === true, wide?.note);
ok(
  "⚠️ ④ **一個合計數字都不給**（給了就是把錯的數字換個說法留著）",
  !(wide?.text ?? "").includes(sumText),
  `不可出現的數字：${sumText}`,
);
/*
 * ⚠️ X-46（使用者 2026-09-16）：超過上限時**不是直接不給**，
 *   而是預設收起 ＋ 一顆「展開看全部」。展開之後仍然**一個合計都不給**。
 */
ok(
  "④ 超過上限時要有「展開看全部」那一顆",
  (await page.locator('[data-testid="kpi-expand"]').count()) === 1,
);
await page.locator('[data-testid="kpi-expand"]').click();
await page.waitForTimeout(900);
const expanded = await cardOf("card-kpi-daily");
ok(
  "⚠️ ④ 展開之後要列出全部（四個調查點 × 平日／假日 ＝ 8 行）",
  expanded?.rows.length === 8,
  `實測 ${expanded?.rows.length} 行`,
);
ok(
  "⚠️ ④ 展開之後**仍然**沒有合計（展開不是把規則放寬）",
  !(expanded?.text ?? "").includes(sumText),
  `不可出現的數字：${sumText}`,
);
ok(
  "④ 展開之後要能收回去",
  (await page.locator('[data-testid="kpi-collapse"]').count()) === 1,
);
await page.locator('[data-testid="kpi-collapse"]').click();
await page.waitForTimeout(800);
ok(
  "④ 收回去之後又變回「收起 ＋ 展開看全部」",
  (await page.locator('[data-testid="kpi-expand"]').count()) === 1,
);
/*
 * ⚠️ 這一段**一定要排在展開／收起之後**（2026-09-16 修正）。
 *   舊版在驗「展開看全部」之前就先 `pickRoads([NAME_A])` 切回一個調查點——
 *   一個調查點根本不會超過上限，那顆按鈕當然不存在，
 *   於是 locator.click 等到逾時，而紅的原因與要驗的事情無關。
 *
 * 回到一個調查點時要恢復逐行顯示——不可以一旦收起來就回不去。
 */
await pickRoads([NAME_A]);
await page.waitForTimeout(900);
const backSingle = await cardOf("card-kpi-daily");
ok(
  "④ 收回到一個調查點之後，逐行顯示要回來（平日／假日兩行）",
  backSingle?.rows.length === 2 && backSingle?.overflow === false,
  JSON.stringify(backSingle?.rows.map((row) => row.label)),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log(
  "\n✅ 總結小卡：多個調查點逐行列出、合計不出現、尖峰卡留說明不留數字",
);
