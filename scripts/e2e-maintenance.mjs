/**
 * ══════════════════════════════════════════════════════════════════════
 *  X-43／X-44／X-48／X-49：全日交通量的「資料維護」頁
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「全日交通量的品質與定稿分頁中似乎就是一個資料維護的半成品了，
 *     可以將此頁面與資料維護的內容做個融合。到時資料匯入的這個
 *     "品質與定稿"就能移除或是改名稱，點下去就是跳轉到資料維護分頁中」
 *   「資料異常檢查摘要、檢查結果 應該是建立在使用者手動點
 *     執行資料異常檢查功能 按鈕後，才產生資料的欄位」
 *   「使用者處理完後，重新按一次檢查，問題如果解決了，就要確實消失」
 *   「我建議在檢查結果表中，新增一欄"解決方式"」
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**不可以只驗「有這顆按鈕」**。按鈕可以是空殼：要驗按之前摘要是
 *     破折號、按之後才出現數字。
 * 二、**「解決方式」不可以只驗欄位存在**。空字串、或每一列同一句通用句
 *     照樣會過，而那等於沒寫。要驗每一列都有字、而且不同類型不同句。
 * 三、「前往某分頁」那顆要驗**真的換頁**，不是一顆裝飾。
 * 四、刪除單一季度要驗**那一季真的不見了**，而且**另一季還在**——
 *     一次刪光也算「不見了」，但那是功能壞掉。
 * 五、舊的「品質與定稿」視窗要驗**再也開不出來**（反面守門）。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";
import { TABS, gotoTab, gotoBlock } from "./e2e-nav.mjs";

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
await page.locator(".modal-backdrop .modal input").first().fill("資料維護守門");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);

/*
 * ⚠️ 兩季的內容**一定要不一樣**，否則一個異常都不會觸發，
 *   第四節與第六節整段變成恆真（我第一版就是這樣，實測抓到）。
 *
 *   做法：兩季都用**同一個檔名**（＝同一個調查點），但第二季塞的是
 *   另一份樣本的內容。同一個調查點在相鄰兩季的量差很多 → 全日量變動、
 *   PCU 變動等提醒就會出現，那正是這一支要驗的東西。
 */
const BASE_A = readFileSync(join(SAMPLES, "115T1-01_中山路.xlsx"));
const BASE_B = readFileSync(join(SAMPLES, "115T1-02_中正路口.xlsx"));
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const importQuarter = async (quarterKey, files) => {
  await gotoTab(page, TABS.import);
  await page.waitForTimeout(600);
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(500);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarterKey);
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles(files);
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
  for (let i = 0; i < 6 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(700);
};
await importQuarter("115Q1", [
  { name: "115T1-01_中山路.xlsx", mimeType: XLSX_MIME, buffer: BASE_A },
]);
/*
 * ⚠️ 第二季**不可以直接換一份別的樣本檔**（我第一版是這樣做的，實測 0 筆）。
 *   調查點是由檔案內容決定的，換一份樣本＝換一個調查點，
 *   兩季就配不成對，相鄰季比較一筆都不會產生。
 *
 *   正確做法：拿**同一份**檔案，把每一格數值乘上一個倍率再匯入。
 *   同一個調查點、量差 60%，相鄰兩季的變動提醒才會真的出現。
 */
const scaled = (buffer, factor) => {
  const book = XLSX.read(buffer, { type: "buffer" });
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address];
      if (cell && cell.t === "n" && Number.isFinite(cell.v))
        cell.v = Math.round(cell.v * factor);
    }
  }
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
};
await importQuarter("115Q2", [
  {
    name: "115T1-01_中山路.xlsx",
    mimeType: XLSX_MIME,
    buffer: scaled(BASE_A, 1.6),
  },
]);
void BASE_B;


/* ══ 一、舊落點不可以還留著 ══════════════════════════════════ */
console.log("\n══ 一、舊的「品質與定稿」視窗不可以還開得出來 ══");
await gotoBlock(page, "quality-summary");
await page.waitForTimeout(800);
const qualityButton = page.locator('.toolbar button:has-text("資料維護")');
ok(
  "⚠️ ① 工具列那顆已經改名叫「資料維護」（不再是「品質與定稿」）",
  (await qualityButton.count()) > 0 &&
    (await page.locator('.toolbar button:has-text("品質與定稿")').count()) === 0,
);
await qualityButton.first().click();
await page.waitForTimeout(1200);
ok(
  "⚠️ ① 按下去**不會開視窗**，而是跳到資料維護那一頁",
  (await page.locator(".modal-backdrop").count()) === 0 &&
    (await page.locator("#quality-summary").count()) === 1,
  `視窗 ${await page.locator(".modal-backdrop").count()} 個`,
);

/* ══ 二、四塊都要在，而且側欄列得出來 ════════════════════════ */
console.log("\n══ 二、資料維護頁上該有的東西 ══");
/*
 * ⚠️ X-63（2026-09-17）：這五塊**不在同一頁**了。
 *   使用者指定把「刪除單一季度」搬到「還原與備份」，
 *   其餘四塊留在「資料異常檢查」——所以要逐塊切過去。
 *   原本一次 gotoBlock 就全部量的寫法會有四塊找不到（它們在另一頁）。
 */
for (const [id, label] of [
  ["maintenance-delete-quarter", "刪除單一季度"],
  ["quality-run", "執行資料異常檢查"],
  ["quality-summary", "資料異常檢查摘要"],
  ["quality-thresholds", "異常提醒門檻"],
  ["quality-reasons", "檢查結果"],
]) {
  await gotoBlock(page, id);
  await page.waitForTimeout(600);
  ok(
    `② 「${label}」在畫面上（#${id}）`,
    (await page.locator(`#${id}`).count()) === 1,
  );
}
/*
 * ⚠️ X-73 起側欄是**手風琴**：小分頁只有目前那一頁才展開
 *   （使用者指名比照另外兩支）。所以「刪除單一季度」與其他三項
 *   **不在同一頁**，不可能同時列出來——一次抓完等於在守舊行為。
 *   改成：切到那一項所在的大分頁，再確認它列得出來。
 *   這也正是使用者實際會做的事。
 */
const navLabelsOn = async (pageId) => {
  await page
    .locator(`.side-nav button[data-goto-page="${pageId}"]`)
    .first()
    .click();
  await page.waitForTimeout(500);
  return page.evaluate(() =>
    [...document.querySelectorAll(".side-nav .side-nav-item")].map((node) =>
      (node.textContent || "").trim(),
    ),
  );
};
for (const [label, pageId] of [
  ["刪除單一季度", "page-backup"],
  ["季度改名", "page-backup"],
  ["資料異常檢查摘要", "page-check"],
  ["異常提醒門檻", "page-check"],
  ["檢查結果", "page-check"],
]) {
  const labels = await navLabelsOn(pageId);
  ok(
    `② 側欄列得出「${label}」`,
    labels.some((text) => text.includes(label)),
    labels.join("｜"),
  );
}
/* 量完之後切回資料異常檢查那一頁，後面幾段都以它為準。 */
await page
  .locator('.side-nav button[data-goto-page="page-check"]')
  .first()
  .click();
await page.waitForTimeout(600);

/* ══ 三、按了才跑 ════════════════════════════════════════════ */
console.log("\n══ 三、事後檢查要按了才跑 ══");
const summaryValues = () =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-testid="quality-summary-grid"] strong',
      ),
    ].map((node) => (node.textContent || "").trim()),
  );
/*
 * ⚠️ 先把門檻調到最敏感，這一份小測資才造得出異常。
 *
 *   不調的話這一支會拿到 0 筆——第四節（解決方式）與第六節（重按檢查）
 *   整段變成恆真，而畫面上看起來全綠（我第一版實測踩到）。
 *   調門檻**不會**改變任何計算，只改變「多少算異常」，
 *   這正是那幾個欄位存在的用途。
 */
for (const input of await page.locator("#quality-thresholds input").all()) {
  await input.fill("0.01");
  await page.waitForTimeout(150);
}
await page.waitForTimeout(600);
const beforeRun = await summaryValues();
ok(
  "⚠️ ③ 按之前，摘要一個數字都不給（給了等於說「已經檢查過而且是這樣」）",
  beforeRun.length > 0 && beforeRun.every((text) => text === "—"),
  beforeRun.join("／"),
);
ok(
  "③ 按之前，檢查結果那一塊寫「尚未檢查」",
  (await page.locator('[data-testid="quality-run-state"]').innerText()).includes(
    "尚未檢查",
  ),
);
/* ⚠️ X-63：那顆鈕在「資料異常檢查」那一個大分頁。 */
await gotoBlock(page, "quality-run");
await page.locator('[data-testid="quality-run"]').click();
await page.waitForTimeout(1500);
const afterRun = await summaryValues();
ok(
  "⚠️ ③ 按下去之後才出現數字（按鈕要真的做一件事，不能是空殼）",
  afterRun.length > 0 && afterRun.some((text) => text !== "—"),
  afterRun.join("／"),
);
ok(
  "③ 狀態列寫出這一次檢查的時間",
  (await page.locator('[data-testid="quality-run-state"]').innerText()).includes(
    "上次檢查",
  ),
  await page.locator('[data-testid="quality-run-state"]').innerText(),
);
/* 改了門檻＝資料的判準變了，結果要標成過期。 */
const thresholdInput = page.locator("#quality-thresholds input").first();
const oldThreshold = await thresholdInput.inputValue();
await thresholdInput.fill(String(Number(oldThreshold) + 1));
await page.waitForTimeout(1200);
ok(
  "⚠️ ③ 改了門檻之後，結果要標成「已過期」（安靜地留著舊數字更危險）",
  (await page.locator('[data-testid="quality-run-state"]').innerText()).includes(
    "過期",
  ),
  await page.locator('[data-testid="quality-run-state"]').innerText(),
);
await thresholdInput.fill(oldThreshold);
await page.waitForTimeout(800);
/* ⚠️ X-63：那顆鈕在「資料異常檢查」那一個大分頁。 */
await gotoBlock(page, "quality-run");
await page.locator('[data-testid="quality-run"]').click();
await page.waitForTimeout(1500);

/* ══ 四、解決方式 ════════════════════════════════════════════ */
console.log("\n══ 四、X-49：解決方式 ══");
const resolutions = await page.evaluate(() =>
  [...document.querySelectorAll("#quality-reasons tbody tr[data-anomaly-type]")].map(
    (row) => ({
      type: row.getAttribute("data-anomaly-type") || "",
      kind:
        row.querySelector('[data-testid="issue-resolution"]')?.getAttribute("data-kind") ||
        "",
      text:
        row.querySelector('[data-testid="issue-resolution"] span')?.textContent?.trim() ||
        "",
      goto:
        row.querySelector('[data-testid="issue-resolution"] .resolution-goto')
          ?.textContent?.trim() || "",
    }),
  ),
);
if (!resolutions.length) {
  stop("這一份測資沒有觸發任何異常，解決方式那一段會恆真");
} else {
  ok(
    "④ 檢查結果真的列出項目",
    resolutions.length > 0,
    `${resolutions.length} 列`,
  );
  ok(
    "⚠️ ④ 每一列都有解決方式，而且每一句都有實際內容",
    resolutions.every((item) => item.text.length >= 30),
    resolutions.map((item) => `${item.type}:${item.text.length}字`).join("、"),
  );
  ok(
    "⚠️ ④ 每一列都標出處理類別（重新匯入／人工確認／畫面修正）",
    resolutions.every((item) =>
      ["重新匯入", "人工確認", "畫面修正"].includes(item.kind),
    ),
    [...new Set(resolutions.map((item) => item.kind))].join("／"),
  );
  ok(
    "⚠️ ④ 標成「重新匯入」的那幾列，句子裡要真的寫出「重新匯入」",
    resolutions
      .filter((item) => item.kind === "重新匯入")
      .every((item) => item.text.includes("重新匯入")),
  );
  /* 不同「類型」不可以共用同一句；同一類型同一句是對的。 */
  const byText = new Map();
  for (const item of resolutions) {
    const seen = byText.get(item.text);
    if (seen && seen !== item.type) byText.set(item.text, seen + "／" + item.type);
    else if (!seen) byText.set(item.text, item.type);
  }
  const shared = [...byText.values()].filter((who) => who.includes("／"));
  ok(
    "⚠️ ④ 不同種類的異常不可以共用同一句解決方式（那等於沒寫）",
    shared.length === 0,
    shared.join("、") ||
      `${new Set(resolutions.map((item) => item.type)).size} 種異常各寫各的`,
  );
  const gotoIndex = resolutions.findIndex((item) => item.goto);
  ok("④ 至少有一列給了「前往某分頁」的按鈕", gotoIndex >= 0);
  if (gotoIndex >= 0) {
    const zoneBefore = await page.evaluate(
      () =>
        document.querySelector(".side-nav button.active")?.getAttribute("data-goto") ||
        "",
    );
    await page
      .locator("#quality-reasons tbody .resolution-goto")
      .nth(gotoIndex)
      .click();
    await page.waitForTimeout(1200);
    const zoneAfter = await page.evaluate(
      () =>
        document.querySelector(".side-nav button.active")?.getAttribute("data-goto") ||
        "",
    );
    const focused = await page.locator(".is-focused, .focused-block").count();
    ok(
      "⚠️ ④ 按「前往…」真的跳到那一塊（換頁或把那一塊框起來，不是按了沒反應）",
      zoneAfter !== zoneBefore || focused > 0,
      `${zoneBefore} → ${zoneAfter}；點名 ${focused} 塊`,
    );
    await gotoBlock(page, "maintenance-delete-quarter");
    await page.waitForTimeout(900);
  }
}

/* ══ 五、刪除單一季度 ════════════════════════════════════════ */
console.log("\n══ 五、刪除單一季度要真的刪得掉 ══");
const deleteOptions = await page.evaluate(() =>
  [
    ...(document.querySelector('[data-testid="maintenance-delete-quarter"]')?.options ??
      []),
  ].map((option) => option.value),
);
ok(
  "前置：有兩季可以刪（只有一季的話下面恆真）",
  deleteOptions.length >= 2,
  deleteOptions.join("、"),
);
if (deleteOptions.length >= 2) {
  ok(
    "⚠️ ⑤ 預設選的是**最早一季**（最新一季通常是正在處理的那一季，當刪除鈕的預設值太危險）",
    (await page.inputValue('[data-testid="maintenance-delete-quarter"]')) ===
      deleteOptions[0],
    `預設 ${await page.inputValue('[data-testid="maintenance-delete-quarter"]')}／最早 ${deleteOptions[0]}`,
  );
  const gone = deleteOptions[0];
  await page
    .locator('#maintenance-delete-quarter button:has-text("刪除這一季")')
    .click();
  await page.waitForTimeout(3000);
  const left = await page.evaluate(() =>
    [
      ...(document.querySelector('[data-testid="maintenance-delete-quarter"]')?.options ??
        []),
    ].map((option) => option.value),
  );
  ok(
    "⚠️ ⑤ 按下去之後那一季**真的不見了**（只驗鈕能按＝什麼都沒驗到）",
    !left.includes(gone),
    `${deleteOptions.join("、")} → ${left.join("、")}`,
  );
  ok(
    "⚠️ ⑤ 其餘季度還在（一次刪光也算「不見了」，但那是功能壞掉）",
    left.length === deleteOptions.length - 1,
    left.join("、"),
  );
  /* ── 六、處理完之後重按檢查，已解決的要消失 ── */
  console.log("\n══ 六、X-49：重按檢查，已解決的要消失 ══");
  const typesBefore = new Set(resolutions.map((item) => item.type));
  /* ⚠️ X-63：那顆鈕在「資料異常檢查」那一個大分頁。 */
  await gotoBlock(page, "quality-run");
  await page.locator('[data-testid="quality-run"]').click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("#quality-reasons tbody tr[data-anomaly-type]")].map(
      (row) => row.getAttribute("data-anomaly-type") || "",
    ),
  );
  ok(
    "⚠️ ⑥ 少掉一季之後重按檢查，項目數真的變少（檢查不可以吃快取）",
    after.length < resolutions.length,
    `${resolutions.length} 筆 → ${after.length} 筆`,
  );
  ok(
    "⑥ 剩下的項目種類仍然是原本那幾種（不可以冒出新的種類）",
    after.every((type) => typesBefore.has(type)),
    [...new Set(after)].join("、") || "(沒有剩下)",
  );
}

/* ══ 異常提醒門檻：看得出來哪裡可以輸入（使用者 2026-09-17 附圖回報）══
 *
 * 使用者原話：「全日交通量的異常門檻輸入數值的位置，和背景都是白色的，
 *   會看不出哪裡是可以輸入數字的地方」。
 *
 * ⚠️ 量三件事，缺一條都還是會被當成純文字：
 *   ① 有看得見的框線（框色與面板底色的對比要 ≥ 1.4:1，不是「有寫 border」就算——
 *      border 顏色設成白色也是有寫）
 *   ② 欄位底色與面板底色**不同**（同色的話框線再細也看不出是欄位）
 *   ③ 點下去有反應（focus 之後框色要變）
 *
 * ⚠️ 不可以用「有沒有 <input> 元素」代替。壞掉的版本也有 input，
 *   使用者看不出來的是**樣式**，不是元素。
 */
const thresholdFields = await page.evaluate(() => {
  const panel = document.querySelector("#quality-thresholds");
  if (!panel) return null;
  const input = panel.querySelector(".threshold-grid input");
  if (!input) return null;
  const parse = (value) => {
    const hit = String(value).match(/rgba?\(([^)]+)\)/);
    if (!hit) return null;
    const parts = hit[1].split(",").map((v) => Number(v.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) =>
    Number(
      ((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2),
    );
  const style = getComputedStyle(input);
  const panelStyle = getComputedStyle(panel);
  const ground = parse(panelStyle.backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
  /*
   * ⚠️ 透明（alpha 0）要當成「和底色相同」。
   *   `rgba(0,0,0,0)` 的三個色道是 0,0,0，數字上和白底不同，
   *   但**畫面上看到的就是底色**——照數字比的話，
   *   一個完全沒有底色的欄位會被判成「底色不同」而通過，
   *   那正是使用者回報的那個樣子。
   */
  const rawField = parse(style.backgroundColor);
  const field = rawField && rawField.a > 0 ? rawField : ground;
  const border = parse(style.borderTopColor) || ground;
  const before = style.borderTopColor;
  input.focus();
  const after = getComputedStyle(input).borderTopColor;
  input.blur();
  return {
    borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
    borderContrast: ratio(border, ground),
    fieldDiffers: field.r !== ground.r || field.g !== ground.g || field.b !== ground.b,
    focusChanges: before !== after,
    detail: `框 ${style.borderTopWidth} ${style.borderTopColor}／底 ${style.backgroundColor}／面板底 ${panelStyle.backgroundColor}`,
  };
});
ok(
  "前置：找得到異常提醒門檻的輸入框（找不到的話下面全部恆真）",
  thresholdFields !== null,
);
if (thresholdFields) {
  ok(
    "⚠️ 門檻輸入框要有看得見的框線（使用者：看不出哪裡可以輸入）",
    thresholdFields.borderWidth >= 1 && thresholdFields.borderContrast >= 1.4,
    `寬 ${thresholdFields.borderWidth}px、與面板底對比 ${thresholdFields.borderContrast}:1｜${thresholdFields.detail}`,
  );
  ok(
    "⚠️ 門檻輸入框的底色要與面板底色不同（同色＝看起來像純文字）",
    thresholdFields.fieldDiffers,
    thresholdFields.detail,
  );
  ok(
    "⚠️ 點下去要有反應（focus 之後框色要變）",
    thresholdFields.focusChanges,
  );
}

/* ══ 掃描式守門：面板裡不可以有「看不出是控制項」的欄位 ══════════
 *
 * 使用者 2026-09-17 連續回報兩處（異常提醒門檻的數字欄、資料狀態的下拉），
 * 兩處是同一個成因：樣式表把「輸入框長什麼樣」寫在 .filters 與 .modal 底下，
 * 面板裡直接寫的控制項一條都沒吃到，拿到的是瀏覽器預設：
 * **透明底、幾乎看不見的細框**，而面板本身是白底。
 *
 * ⚠️ 所以這一條不是守某一個欄位，而是**掃過這一頁的每一個控制項**——
 *   一個一個補樣式的話，下一個新欄位又會重演。
 * ⚠️ 透明（alpha 0）要當成「和底色相同」：rgba(0,0,0,0) 的數值和白底不同，
 *   但畫面上看到的就是底色。照數值比會讓沒有底色的欄位矇混過關。
 */
const unstyledFields = await page.evaluate(() => {
  const parse = (value) => {
    const hit = String(value).match(/rgba?\(([^)]+)\)/);
    if (!hit) return null;
    const parts = hit[1].split(",").map((v) => Number(v.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  };
  const bad = [];
  let seen = 0;
  for (const el of document.querySelectorAll(
    ".content input, .content select, .content textarea",
  )) {
    const type = (el.getAttribute("type") || "").toLowerCase();
    /* 勾選框與檔案鈕本來就長得不一樣，不在這一條的範圍。 */
    if (["checkbox", "radio", "file", "hidden"].includes(type)) continue;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (!el.getBoundingClientRect().width) continue;
    seen += 1;
    const width = Number.parseFloat(style.borderTopWidth) || 0;
    const bg = parse(style.backgroundColor);
    if (width >= 1 && bg && bg.a > 0) continue;
    bad.push(
      `${el.tagName.toLowerCase()}「${(el.closest("label")?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 18)}」（框 ${style.borderTopWidth}／底 ${style.backgroundColor}）`,
    );
  }
  return { bad, seen };
});
ok(
  "前置：這一頁真的有控制項可以掃（0 個的話下一條恆真）",
  unstyledFields.seen > 0,
  `${unstyledFields.seen} 個`,
);
ok(
  "⚠️ 面板裡不可以有「看不出是控制項」的欄位（沒有框線或底色透明）",
  unstyledFields.bad.length === 0,
  unstyledFields.bad.join("、") || `${unstyledFields.seen} 個都看得出來`,
);

/* ══ X-82：欄位不可以黏在它自己的說明文字上 ═══════════════════
 *
 * 使用者 2026-09-17（附圖）：「草稿欄位與上面文字幾乎黏在一起，請保持一定
 *   的間距」——「資料狀態（115Q3）」那一行的下拉直接貼著、甚至壓到「）」。
 *
 * ⚠️ 成因和上面那一條是**同一類**（面板裡的控制項沒有版面宣告，走 inline 流，
 *   中文字與 <select> 之間沒有空白字元就零間距），所以守門也一樣用**掃描**，
 *   不是只盯那一個欄位——下一個新欄位才不會重演。
 * ⚠️ 量的是「同一行、而且控制項在文字右邊」那一種。控制項換行到下一行的
 *   （grid 版面）不在這一條的範圍，那種的間距由 row-gap 決定。
 */
const tightFields = await page.evaluate(() => {
  const bad = [];
  let seen = 0;
  for (const label of document.querySelectorAll(".content label")) {
    const control = label.querySelector("select, input, textarea");
    if (!control) continue;
    const type = (control.getAttribute("type") || "").toLowerCase();
    if (["checkbox", "radio", "file", "hidden"].includes(type)) continue;
    const box = control.getBoundingClientRect();
    if (!box.width) continue;
    /* 控制項左邊、同一行的那一段文字。 */
    let text = null;
    for (const node of label.childNodes) {
      if (node === control || node.contains?.(control)) break;
      const rect =
        node.nodeType === 3
          ? (() => {
              const range = document.createRange();
              range.selectNodeContents(node);
              const r = range.getBoundingClientRect();
              range.detach?.();
              return r;
            })()
          : node.getBoundingClientRect?.();
      if (!rect || !rect.width || !(node.textContent || "").trim()) continue;
      text = rect;
    }
    if (!text) continue;
    /* 同一行才算（垂直上有重疊），而且文字在控制項左邊。 */
    const sameRow = text.bottom > box.top + 2 && text.top < box.bottom - 2;
    if (!sameRow || text.right > box.left + 1) continue;
    seen += 1;
    const gap = box.left - text.right;
    if (gap < 6)
      bad.push(
        `「${(label.textContent || "").replace(/\s+/g, " ").trim().slice(0, 16)}」只隔 ${gap.toFixed(1)}px`,
      );
  }
  return { bad, seen };
});
ok(
  "前置：這一頁真的有「文字＋同一行控制項」可以量（0 個的話下一條恆真）",
  tightFields.seen > 0,
  `${tightFields.seen} 個`,
);
ok(
  "⚠️ X-82 欄位與它左邊的說明文字至少隔 6px（不可以黏在一起或壓過去）",
  tightFields.bad.length === 0,
  tightFields.bad.join("、") || `${tightFields.seen} 個都有間距`,
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 資料維護：舊視窗收掉了、五塊都在、按了才跑、解決方式寫得出來、刪得掉季度");
