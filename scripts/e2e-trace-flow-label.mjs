/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-15：可追溯明細（路口）的表頭要跟著**這一塊自己的**路口流量視角
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16（附三張圖）：
 *   「這三張圖，分別是 駛入、駛出、駛入+駛出，其中表頭都是顯示 "駛出"，
 *     另外當駛入+駛出並列時，卻顯示的是駛出的數值，很明顯是錯誤」
 *
 * 成因兩個，各自要守：
 *   ① 表頭讀的是**主工具列**那一份 intersectionFlowLabel。這一塊可以脫離，
 *     脫離成「駛入」時數字真的換了、表頭卻還寫駛出——看的人會把駛入的
 *     數字當成駛出抄進報告。
 *   ② 「駛出＋駛入並列」在這張表排不下，程式把它攤成駛出。攤是可以的，
 *     **不說就是錯**：使用者選了並列，看到的數字與駛出逐格相同。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、不可以只驗「表頭裡有『路口A』」——那三種視角都成立。
 *     要驗**字串真的換了**（駛出→駛入）。
 * 二、不可以只驗表頭。**數值也要真的換**，否則把表頭改成跟著選單走、
 *     資料卻沒換，照樣全綠（那比現在更糟：兩邊都說謊得很一致）。
 * 三、並列那一條要驗**有那一句不適用說明**，不是驗「資料等於駛出」——
 *     後者本來就成立，恆真。
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
const SAMPLES = join(here, "..", ".samples");
const base = `http://127.0.0.1:${server.address().port}/`;

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

const browser = await chromium.launch(launchOptions());
const page = await (
  await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: "zh-TW" })
).newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept());
await page.goto(base, { waitUntil: "networkidle" });
/* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
await page.waitForTimeout(1200);
await ensureToolbarOpen(page);
await page.waitForTimeout(2000);

/* ── 前置：建計畫 → 匯入一份**路口格式**的調查檔 ───────────── */
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
await page.locator(".modal-backdrop .modal input").first().fill("路口表頭守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);
/* ⚠️ 一定要用**路口格式**那一份：路段格式畫不出這張表，整支會恆真。 */
const sample = readFileSync(join(SAMPLES, "115T1-02_中正路口.xlsx"));
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q2");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "115T1-02_中正路口.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: sample,
  });
await page.waitForTimeout(2800);
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

await gotoBlock(page, "block-detail");
await page.waitForTimeout(1500);

const table = page.locator(".intersection-table");
ok("前置：畫面上有「可追溯明細・路口格式」那一張表", (await table.count()) === 1);
if ((await table.count()) !== 1) {
  console.error("找不到那張表，後面全部恆真，直接停。");
  await browser.close();
  server.close();
  process.exit(1);
}

/**
 * X-17：視角**只由主工具列決定**，這一塊自己已經沒有那一顆下拉了。
 *
 * 使用者 2026-09-16：「那是否統一駛入駛出由主工具列決定，這兩張表只控制車輛方向」
 */
const setMainFlow = (value) =>
  page.evaluate((wanted) => {
    const select = document.querySelector('[data-testid="mt-flow-view"]');
    if (!select) return false;
    select.value = wanted;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);

/** 表頭文字、第一列的前幾個數字，以及列數（一起比才擋得住各種假綠）。 */
const snapshot = () =>
  page.evaluate(() => {
    const block = document.querySelector(".intersection-table");
    const heads = [...block.querySelectorAll("thead th")].map((th) =>
      (th.textContent || "").replace(/\s+/g, ""),
    );
    const rows = [...block.querySelectorAll("tbody tr")];
    const cells = [...(rows[0]?.querySelectorAll("td") ?? [])]
      .slice(0, 6)
      .map((td) => (td.textContent || "").replace(/\s+/g, ""));
    return { heads, cells, rowCount: rows.length };
  });

ok(
  "⚠️ X-17：這一塊**不可以**再有自己的「路口流量視角」（視角統一由主工具列決定）",
  (await page.evaluate(() => {
    const block = document.querySelector(".intersection-table");
    return [...block.querySelectorAll("label")].some((node) =>
      (node.textContent || "").trim().startsWith("路口流量視角"),
    );
  })) === false,
);
ok("前置：主工具列有「路口流量視角」可以切", await setMainFlow("origin"));
await page.waitForTimeout(1300);
const outbound = await snapshot();
ok(
  "前置：表頭裡讀得到支線欄（讀不到的話下面全部恆真）",
  outbound.heads.some((text) => /路口[A-Z]/.test(text)),
  outbound.heads.slice(0, 5).join(" / "),
);

await setMainFlow("destination");
await page.waitForTimeout(1300);
const inbound = await snapshot();

ok(
  "⚠️ ① 主工具列切成「駛入路口」之後，**表頭真的改成駛入**",
  inbound.heads.some((text) => text.includes("駛入路口")) &&
    !inbound.heads.some((text) => /^駛出路口[A-Z]/.test(text)),
  inbound.heads.filter((t) => /路口[A-Z]/.test(t)).slice(0, 3).join(" / "),
);
ok(
  "⚠️ ① 而且**數值也真的換了**（只有表頭跟著換＝兩邊一起說謊）",
  JSON.stringify(inbound.cells) !== JSON.stringify(outbound.cells),
  `駛出 ${outbound.cells.join("｜")} → 駛入 ${inbound.cells.join("｜")}`,
);

/* ══ ② 並列＝**同一格上下兩行**（X-22，照路口轉向那張表）═══════ */
console.log("\n══ ② 駛出＋駛入並列：同一格上下兩行 ══");
await setMainFlow("both");
await page.waitForTimeout(1500);
const both = await snapshot();
/*
 * ⚠️ 不可以驗「列數變兩倍」——X-22 之後**列數不變**，
 *   並列是在同一格裡上下兩行。驗錯方向會把對的實作判成紅字。
 */
ok(
  "⚠️ ② 並列時列數**不變**（一列還是一個路口）",
  outbound.rowCount > 0 && both.rowCount === outbound.rowCount,
  `駛出 ${outbound.rowCount} 列 → 並列 ${both.rowCount} 列`,
);
ok(
  "⚠️ ② 表頭要寫成「駛出／駛入」（看得出這一欄同時有兩種）",
  both.heads.some((text) => /駛出／駛入路口[A-Z]/.test(text)),
  both.heads.filter((t) => /路口[A-Z]/.test(t)).slice(0, 3).join(" / "),
);
const stacked = await page.evaluate(() => {
  const block = document.querySelector(".intersection-table");
  const heads = [...block.querySelectorAll("thead th")].map((th) =>
    (th.textContent || "").replace(/\s+/g, ""),
  );
  const index = heads.findIndex((text) => /駛出／駛入路口[A-Z]/.test(text));
  if (index < 0) return null;
  const cell = block.querySelector("tbody tr")?.querySelectorAll("td")[index];
  if (!cell) return null;
  const lines = [...cell.querySelectorAll(".flow-line")].map((node) =>
    (node.textContent || "").replace(/\s+/g, ""),
  );
  return { lines, display: lines.length ? getComputedStyle(cell.querySelector(".flow-line")).display : "" };
});
ok(
  "⚠️ ② 同一格裡真的有**兩行**，而且各自標明駛出／駛入",
  Boolean(stacked) &&
    stacked.lines.length === 2 &&
    stacked.lines.some((line) => line.startsWith("駛出")) &&
    stacked.lines.some((line) => line.startsWith("駛入")),
  stacked ? stacked.lines.join(" ／ ") : "（讀不到那一格）",
);
ok(
  "⚠️ ② 兩行的數字**不一樣**（一樣就是又畫了同一份）",
  Boolean(stacked) &&
    stacked.lines.length === 2 &&
    stacked.lines[0].replace(/^駛.\s*/, "") !==
      stacked.lines[1].replace(/^駛.\s*/, ""),
  stacked ? stacked.lines.join(" ／ ") : "",
);
ok(
  "② 兩行真的上下排（display:block；inline 會擠成一行）",
  stacked?.display === "block",
  stacked?.display ?? "",
);
ok(
  "② 並列時要有一句說明「先在主工具列選視角、再在這裡選車流方向」",
  (await page.evaluate(() => {
    const block = document.querySelector(".intersection-table");
    return [...block.querySelectorAll("p")]
      .map((p) => (p.textContent || "").replace(/\s+/g, ""))
      .join(" ");
  })).includes("主工具列"),
);
await setMainFlow("origin");
await page.waitForTimeout(1300);
const backToSingle = await snapshot();
ok(
  "⚠️ ② 切回單一視角時，表頭**只寫那一種**（不可以還掛著「／」）",
  backToSingle.heads.some((text) => /^駛出路口[A-Z]/.test(text)) &&
    !backToSingle.heads.some((text) => text.includes("／駛入")),
  backToSingle.heads.filter((t) => /路口[A-Z]/.test(t)).slice(0, 2).join(" / "),
);

/* ══ ③ X-16：沒有可列的資料時**不可以整張消失** ══════════════
 *
 * 使用者 2026-09-16：「這張表忽然整張消失(因為沒資料)，我一度以為系統錯誤」
 *   「主工具列的回歸全部按鍵顯示共2筆使用自己工具列，展示是哪些表，
 *     結果是這兩張自己消失的表，且表的名字還一模一樣無法區分」
 *
 * ⚠️ 這份測資只有路口格式，所以「雙向路段交通量」那一張本來就沒有資料可列——
 *   正好是使用者遇到的情境。要驗的是**區塊還在、而且有說明**。
 */
console.log("\n══ ③ 沒有資料時要留著區塊並說明 ══");
const roadPanel = page.locator("#block-detail");
ok(
  "⚠️ ③ 路段格式那一張**沒有資料也要留在畫面上**（整張消失會被當成程式壞了）",
  (await roadPanel.count()) === 1,
);
const roadEmptyNote = await page.evaluate(() => {
  const block = document.getElementById("block-detail");
  if (!block) return "";
  const note = block.querySelector(".panel-empty-note");
  return note ? (note.textContent || "").replace(/\s+/g, "") : "";
});
ok(
  "⚠️ ③ 而且要寫出**為什麼沒有**（只留一張空表等於什麼都沒說）",
  roadEmptyNote.includes("路段格式") && roadEmptyNote.includes("不是壞掉"),
  roadEmptyNote.slice(0, 80) || "（一句都沒有）",
);
ok(
  "③ 這一塊自己的工具列也要還在（不然使用者改不回來）",
  (await page.locator("#block-detail .block-filters").count()) === 1,
);

/* ══ ④ X-16：小卡上兩張表的名字要分得出來 ══════════════════ */
console.log("\n══ ④ 小卡上兩張可追溯明細的名字要分得出來 ══");
await page.evaluate(() => {
  /*
   * 讓**兩張表都脫離**：各自把日別改一下。
   * ⚠️ 只讓一張脫離的話，下面那條「名字不一樣」恆真（一個項目當然不重複）。
   */
  const blocks = [
    document.getElementById("block-detail"),
    document.querySelector(".intersection-table"),
  ];
  for (const block of blocks) {
    const label = [...(block?.querySelectorAll("label") ?? [])].find((node) =>
      (node.textContent || "").trim().startsWith("日別"),
    );
    const select = label?.querySelector("select");
    if (select) {
      select.value = "平日";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
});
await page.waitForTimeout(1200);
const popLabels = await page.evaluate(async () => {
  const toggle = document.querySelector('[data-testid="mt-detached-toggle"]');
  if (!toggle) return [];
  toggle.click();
  await new Promise((r) => setTimeout(r, 400));
  return [
    ...document.querySelectorAll(
      '[data-testid="mt-detached-pop"] [data-detached-goto]',
    ),
  ].map((node) => node.textContent.trim());
});
ok(
  "前置：小卡上至少列出兩塊（少於兩塊的話下面那條恆真）",
  popLabels.length >= 2,
  popLabels.join("、"),
);
ok(
  "⚠️ ④ 兩張可追溯明細在小卡上**名字不一樣**（一模一樣就分不出要回歸哪一張）",
  new Set(popLabels).size === popLabels.length,
  popLabels.join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 可追溯明細（路口）：表頭跟著自己的視角換、數值也跟著換、並列有說明");
