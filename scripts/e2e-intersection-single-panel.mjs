/*
 * ══════════════════════════════════════════════════════════════════════
 *  路口設定只剩「起點 → 終點轉向判定」一個面板；以使用者判定為主
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「1.「起點→終點轉向判定」當唯一依據，「駛出目的支線」整組拿掉。我同意
 *     ……**請不要只靠系統自動依照角度判定，有時會失真，而是以使用者判定為主**。
 *     預設是系統自動由角度判定，然後使用者手動修正做為複核，最後匯入資料。」
 *   「如果出現程式判讀有 2 支線落進同一個轉向，**一定是判讀失誤**，
 *     可以用醒目顏色提醒，或納入匯入異常事件給使用者看到。」
 *
 * ── 這一支釘住的五件事 ──────────────────────────────────────────
 *
 *   一、「駛出目的支線」整組不見了（畫面上、原始碼裡都不可以再有）。
 *   二、每一格看得出是「系統依角度判定」還是「已人工修正」。
 *   三、把兩支判成同一個轉向 → 立刻出現醒目提醒，而且**指得出是哪一個轉向**。
 *   四、人工修正過之後**再去改別支線的角度**，那一格仍在（舊版會被默默抹掉）。
 *   五、衝突的量進「未指定駛入路口」，**總量不變**。
 *
 * ⚠️ 假通過陷阱：
 *   一、只驗「畫面上沒有『駛出目的支線』」不夠——整個視窗打不開也會過。
 *       所以要先確認轉向判定那個面板**真的在**。
 *   二、只驗「出現提醒」不夠——固定顯示一段紅字也會過。
 *       所以要驗它指名的支線與轉向，並且**在修正之後消失**。
 *   三、第四項若寫成「角度完全不重算」也會過，所以要同時確認
 *       **沒被人工改過的那一格真的跟著角度變了**。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(
    `${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`,
  );
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

/* ── 原始碼層：那一組欄位不可以再被讀 ───────────────────────────── */
const source = readFileSync(
  join(here, "..", "app", "DashboardClient.tsx"),
  "utf8",
);
const flow = readFileSync(join(here, "..", "app", "intersection-flow.ts"), "utf8");
/*
 * ⚠️ 只禁「面板本身」，不禁註解裡提到它。
 *   那幾段註解記錄的正是「為什麼拿掉」，把它一起刪掉會讓下一個人
 *   看不出這是刻意移除的，而不是漏寫的。
 */
const cssSource = readFileSync(join(here, "..", "app", "globals.css"), "utf8");
ok(
  "畫面原始碼裡不再有「駛出目的支線」這個面板",
  !/<h4>[^<]*駛出目的支線/.test(source) &&
    !source.includes("destination-mapping"),
);
/*
 * ⚠️ 樣式表也要一起掃。
 *   第一版守門只掃了 .tsx，於是 .destination-mapping 的六條 CSS 規則
 *   還躺在樣式表裡、也跟著進了交付包——守門說「拿掉了」，包裡卻還有，
 *   下一個人看到那幾條會以為面板還在。
 */
ok(
  "樣式表裡也沒有殘留「駛出目的支線」面板的規則",
  !cssSource.includes("destination-mapping"),
);
ok(
  "不再有 targetField()（舊版靠它去讀 leftTarget/throughTarget/rightTarget）",
  !flow.includes("export function targetField") &&
    !source.includes("targetField("),
);
ok(
  "不再有 bestMovementTarget()（它在多個候選裡會默默挑一支）",
  !flow.includes("export function bestMovementTarget"),
);
ok(
  "legacy 欄位只在 buildArmSettings 裡被併進 routes，其他地方不讀",
  (flow.match(/saved\?\.(left|through|right)Target/g) ?? []).length === 3,
);

/* ── 瀏覽器層 ────────────────────────────────────────────────── */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((request, response) => {
  let path = decodeURIComponent(request.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = join(ROOT, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
  });
  response.end(readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

/** 四岔路口、左直右格式（＝會套用「一個轉向只能一個去向」那條規則的格式）。 */
function workbook() {
  const width = 14;
  const arms = ["A", "B", "C", "D"];
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const hours = Array.from(
    { length: 24 },
    (_unused, hour) =>
      `${String(hour).padStart(2, "0")}:00~${String((hour + 1) % 24).padStart(2, "0")}:00`,
  );
  const rows = Array.from({ length: 6 + hours.length }, () =>
    Array(arms.length * width).fill(null),
  );
  arms.forEach((code, index) => {
    const cell = index * width;
    rows[0][cell] = "站號：A00T00-01";
    rows[1][cell] = "站名：單一面板測試路口";
    rows[2][cell] = "日期：115年04月15日（平日）";
    rows[3][cell] = `路口編號：路口${code}`;
    rows[4][cell] = "時段";
    vehicles.forEach((vehicle, vehicleIndex) => {
      for (let offset = 0; offset < 3; offset += 1)
        rows[4][cell + 1 + vehicleIndex * 3 + offset] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][cell + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    hours.forEach((label, hourIndex) => {
      rows[6 + hourIndex][cell] = label;
      vehicles.forEach((_unused, vehicleIndex) => {
        movements.forEach((_movement, movementIndex) => {
          rows[6 + hourIndex][cell + 1 + vehicleIndex * 3 + movementIndex] =
            5 + ((index + vehicleIndex + movementIndex + hourIndex) % 9);
        });
      });
    });
  });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(event.type() === "prompt" ? "N" : ""));
await page.goto(base);
await page.waitForTimeout(1200);

await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
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
await page.locator(".modal-backdrop .modal input").first().fill("單一面板守門用計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(900);

await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "A00T00-01_單一面板測試路口.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook(),
  });
await page.waitForTimeout(4000);
const confirm = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirm.count()) {
  await confirm.first().click();
  await page.waitForTimeout(4500);
}
const applyVehicles = page.locator(
  '.vehicle-class-modal button:has-text("套用車種設定")',
);
if (await applyVehicles.count()) {
  await applyVehicles.first().click();
  await page.waitForTimeout(1500);
}

const PANEL = ".intersection-manager-modal";
ok("前置：路口設定視窗打得開", (await page.locator(PANEL).count()) > 0);
if (!(await page.locator(PANEL).count())) {
  await browser.close();
  server.close();
  console.error("\n❌ 視窗打不開，不當成通過");
  process.exit(1);
}

const text = () =>
  page.locator(PANEL).innerText().then((value) => value.replace(/\s+/g, " "));

ok("前置：「起點 → 終點轉向判定」面板在（否則下面都是恆真）", /起點 → 終點轉向判定/.test(await text()));
ok("「駛出目的支線」面板已經不在畫面上", !/駛出目的支線/.test(await text()));

/* 二、每一格都標示了來源 */
const sources = await page
  .locator(`${PANEL} .route-source`)
  .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
ok(
  "每一格都標出是系統判定還是人工修正",
  sources.length > 0 && sources.every((value) => /系統依角度判定|已人工修正/.test(value)),
  `${sources.length} 格：${[...new Set(sources)].join("、")}`,
);
ok(
  "剛匯入時應該全部是「系統依角度判定」",
  sources.every((value) => value === "系統依角度判定"),
);

/* 三、把兩支判成同一個轉向 → 醒目提醒 */
ok("前置：修正前沒有任何衝突提醒", (await page.locator(`${PANEL} .route-conflicts`).count()) === 0);

/*
 * 由路口A 駛出那一組：把 A→C 從「直行」改成「左轉」。
 * A→B 本來就是左轉，於是左轉同時對到 B 與 C ＝ 使用者說的「判讀失誤」。
 */
const groupA = page.locator(`${PANEL} .route-mapping details`).first();
await groupA.evaluate((node) => node.setAttribute("open", ""));
const rows = groupA.locator("tbody tr");
const rowTexts = await rows.evaluateAll((nodes) =>
  nodes.map((node) => node.textContent),
);
const targetIndex = rowTexts.findIndex((value) => value.includes("路口C"));
ok("前置：找得到「A → 路口C」那一列", targetIndex >= 0, rowTexts.join(" ｜ "));
await rows.nth(targetIndex).locator("select").selectOption("left");
await page.waitForTimeout(600);

const conflictCount = await page.locator(`${PANEL} .route-conflicts`).count();
ok("兩支判成同一個轉向之後，出現醒目提醒", conflictCount > 0);
const conflictText = conflictCount
  ? (await page.locator(`${PANEL} .route-conflicts`).innerText()).replace(/\s+/g, " ")
  : "";
ok(
  "提醒要指名是哪一支線的哪一個轉向、以及對到哪幾支",
  /路口A/.test(conflictText) &&
    /左轉/.test(conflictText) &&
    /路口B/.test(conflictText) &&
    /路口C/.test(conflictText),
  conflictText.slice(0, 160),
);
ok(
  "提醒要說出這些車現在在哪裡（未指定駛入路口）",
  /未指定駛入路口/.test(conflictText),
);
ok(
  "有衝突的那一列要標記出來",
  (await page.locator(`${PANEL} tr.route-row-conflict`).count()) > 0,
);
ok(
  "改過的那一格要標成「已人工修正」",
  (await rows.nth(targetIndex).locator(".route-source").innerText()).includes(
    "已人工修正",
  ),
);

/* 四、改別支線的角度，人工修正不可以被抹掉 */
const angleInputs = page.locator(
  `${PANEL} .arm-settings section input[type="number"]`,
);
const beforeAngles = await angleInputs.evaluateAll((nodes) =>
  nodes.map((node) => Number(node.value)),
);
ok("前置：量得到四支支線的角度", beforeAngles.length === 4, JSON.stringify(beforeAngles));
/* 動的是**路口B**的角度，人工修正在 A 身上。 */
await angleInputs.nth(1).fill("45");
await angleInputs.nth(1).dispatchEvent("change");
await page.waitForTimeout(700);

const afterRows = page
  .locator(`${PANEL} .route-mapping details`)
  .first()
  .locator("tbody tr");
const afterC = await afterRows.nth(targetIndex).locator("select").inputValue();
ok(
  "改了路口B 的角度之後，A → 路口C 的人工修正仍然是「左轉」",
  afterC === "left",
  `實得 ${afterC}`,
);
ok(
  "而且那一格仍標成「已人工修正」",
  (await afterRows.nth(targetIndex).locator(".route-source").innerText()).includes(
    "已人工修正",
  ),
);
/*
 * ⚠️ 反面的另一半：若程式改成「角度完全不重算」，上面兩條照樣綠。
 *   所以要證明**沒被人工改過的那一格真的跟著角度走了**。
 */
const bIndex = rowTexts.findIndex((value) => value.includes("路口B"));
const afterB = await afterRows.nth(bIndex).locator("select").inputValue();
ok(
  "沒被人工改過的 A → 路口B 要跟著新角度重算（證明重算本身仍然有效）",
  afterB !== "left",
  `A→B 判定為 ${afterB}（角度由 0 改成 45）`,
);

/* 五、修正之後提醒要消失 */
/*
 * ⚠️ 要把**路口B 的角度也還原**，不能只改 A 那兩格。
 *   B 改成 45° 之後，B 自己對 A 與對 D 也都變成直行（兩支同轉向），
 *   那是另一個真實的衝突——留著的話這一條會因為別的理由而紅，
 *   看起來像「提醒不會消失」，其實是測資自己又製造了一個新衝突。
 */
await angleInputs.nth(1).fill("0");
await angleInputs.nth(1).dispatchEvent("change");
await page.waitForTimeout(700);
const restored = page
  .locator(`${PANEL} .route-mapping details`)
  .first()
  .locator("tbody tr");
await restored.nth(targetIndex).locator("select").selectOption("through");
await page.waitForTimeout(600);
const leftConflict = await page.locator(`${PANEL} .route-conflicts`).count();
ok(
  "把判定改回唯一解之後，提醒消失（不是固定顯示的一段紅字）",
  leftConflict === 0,
  leftConflict
    ? (await page.locator(`${PANEL} .route-conflicts`).innerText())
        .replace(/\s+/g, " ")
        .slice(0, 200)
    : "",
);

/*
 * ══════════════════════════════════════════════════════════════════
 *  轉向圖：支線名稱不可以疊在代碼圓圈上
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（附圖）：「多支線角度、轉向圖與流向確認的路口**標籤有重疊**」
 *
 * 舊版名稱放在半徑 190，而圓圈在半徑 165、r=18（外緣 183）——
 * 名稱的**中心**只離圓圈邊 7px，字一長就疊上去。
 *
 * ⚠️ 量的是**畫出來的實際範圍**（getBBox），不是「我把半徑改成多少」。
 *   驗半徑只會驗到我自己寫的那個數字，字長一點照樣疊。
 */
{
  const overlap = await page.evaluate(() => {
    const svg = document.querySelector(".intersection-geometry-diagram");
    if (!svg) return { missing: true };
    const labels = [...svg.querySelectorAll("text.geometry-label")];
    const circles = [...svg.querySelectorAll("circle.geometry-arm-code")];
    const hits = [];
    for (const label of labels) {
      const box = label.getBBox();
      for (const circle of circles) {
        const cx = Number(circle.getAttribute("cx"));
        const cy = Number(circle.getAttribute("cy"));
        const r = Number(circle.getAttribute("r"));
        const nearestX = Math.max(box.x, Math.min(cx, box.x + box.width));
        const nearestY = Math.max(box.y, Math.min(cy, box.y + box.height));
        const distance = Math.hypot(cx - nearestX, cy - nearestY);
        if (distance < r)
          hits.push(
            label.textContent + " 疊到代碼圈（距離 " + distance.toFixed(1) + " < 半徑 " + r + "）",
          );
      }
    }
    return { labels: labels.length, circles: circles.length, hits };
  });
  ok(
    "前置：轉向圖畫得出支線名稱與代碼圈",
    !overlap.missing && overlap.labels > 0,
    JSON.stringify(overlap).slice(0, 120),
  );
  if (!overlap.missing)
    ok(
      "轉向圖的支線名稱沒有疊到代碼圈（" + overlap.labels + " 個名稱）",
      overlap.hits.length === 0,
      overlap.hits.slice(0, 4).join("、"),
    );
}

/*
 * ⚠️ 沒取過名字的支線只印一次「路口A」，不可以印成「路口A－路口A」。
 *   使用者 2026-09-14：「為什麼同樣名字會需要寫 2 次呢?」
 */
{
  const doubled = await page.evaluate(() => {
    const text = document.querySelector(".intersection-manager-modal").innerText;
    return [...text.matchAll(/路口([A-Z])\s*[\u2013\u2014\uFF0D-]\s*路口\1/g)].map(
      (m) => m[0],
    );
  });
  ok(
    "沒取過名字的支線只印一次「路口X」，不會變成「路口X－路口X」",
    doubled.length === 0,
    doubled.slice(0, 4).join("、"),
  );
}

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 只剩轉向判定一個面板；人工修正優先、衝突會醒目提醒");
