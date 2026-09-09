/*
 * 端對端：三岔路口匯入後，「多支線角度、轉向圖與流向確認」要**預填**成
 * 從調查表反推出來的角度與流向，而且要明講那是反推值、請使用者確認。
 *
 * ── 起因（實測）────────────────────────────────────────────────
 *
 * 三岔路口的預設角度是 [-90, 0, 180]，用它推出來的缺口是
 *「A 沒有直進、B 沒有左轉、C 沒有右轉」；
 * 但三份真實三岔調查檔寫的是**完全相反的一組**
 *「A 沒有右轉、B 沒有直進、C 沒有左轉」。
 *
 * 於是 A 的直進車流沒有目的地，整批被歸到「未指定駛入路口」——
 * tests/three-arm-flow.test.mjs 量到某三岔路口 AM 5,831 輛裡有 3,612 輛、
 * 62% 掉進去。總量守恆，但 OD 歸屬是錯的，而且預設值本身就與檔案矛盾。
 *
 * ── ⚠️ 假通過陷阱（這支刻意迴避的）──────────────────────────────
 *
 * 一、只驗「視窗上的角度變成 90 度」不夠——把預設角度直接改成 90 也會過，
 *     但那只是換一組寫死的值，換一份形狀不同的檔案照樣錯。
 *     所以最後一項要驗**行為**：存檔之後畫面上不可以再出現
 *    「未指定駛入路口」。
 * 二、只驗「不出現未指定」也不夠——把 UNMAPPED 那一列藏起來也會過。
 *     所以要同時驗駛入各支線的車輛數合計等於駛出合計（車沒有被吃掉）。
 * 三、預填不可以變成自動套用：視窗一定要跳出來，而且要看得到反推的說明。
 *     使用者的原話是「預先填出系統認為正確的角度與流向是最好，
 *     但也要提醒使用者到『多支線角度、轉向圖與流向確認』調整、確認預設值是正確的」。
 * 四、不用真實調查檔（真實檔不得進交付包），用匿名活頁簿。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import http from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const TMP = join(here, "..", ".samples");
const PORT = 8099;

/*
 * 匿名三岔活頁簿，形狀與真實三岔調查檔相同：
 * 三個「路口編號：路口X」並排，A 無右轉、B 無直進、C 無左轉（整欄畫橫線）。
 */
function makeThreeArmWorkbook() {
  const width = 14;
  const arms = ["A", "B", "C"];
  const vehicles = ["機車", "小型車", "大型車", "特種車"];
  const movements = ["左轉", "直進", "右轉"];
  const absent = { A: "右轉", B: "直進", C: "左轉" };
  const hours = Array.from(
    { length: 24 },
    (_unused, hour) =>
      `${String(hour).padStart(2, "0")}:00~${String((hour + 1) % 24).padStart(2, "0")}:00`,
  );
  const rows = Array.from({ length: 6 + hours.length }, () =>
    Array(arms.length * width).fill(null),
  );
  arms.forEach((code, index) => {
    const base = index * width;
    rows[0][base] = "站號：A00T00-01";
    rows[1][base] = "站名：三岔示範路口";
    rows[2][base] = "日期：115年04月15日（平日）";
    rows[3][base] = `路口編號：路口${code}`;
    rows[4][base] = "時段";
    vehicles.forEach((vehicle, vehicleIndex) => {
      rows[4][base + 1 + vehicleIndex * 3] = vehicle;
      rows[4][base + 2 + vehicleIndex * 3] = vehicle;
      rows[4][base + 3 + vehicleIndex * 3] = vehicle;
      movements.forEach((movement, movementIndex) => {
        rows[5][base + 1 + vehicleIndex * 3 + movementIndex] = movement;
      });
    });
    hours.forEach((label, hourIndex) => {
      rows[6 + hourIndex][base] = label;
      vehicles.forEach((_unused, vehicleIndex) => {
        movements.forEach((movement, movementIndex) => {
          const column = base + 1 + vehicleIndex * 3 + movementIndex;
          rows[6 + hourIndex][column] =
            absent[code] === movement
              ? "--"
              : 3 + ((index + vehicleIndex + movementIndex + hourIndex) % 9);
        });
      });
    });
  });
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "平日");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

mkdirSync(TMP, { recursive: true });
const SAMPLE = join(TMP, "A00T00-01_三岔示範路口.xlsx");
writeFileSync(SAMPLE, makeThreeArmWorkbook());

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".docx": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let path = decodeURIComponent(req.url.split("?")[0]);
  if (path === "/") path = "/index.html";
  const file = join(ROOT, path);
  if (!existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((resolve) => server.listen(PORT, resolve));
const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(event.type() === "prompt" ? "N" : ""));

await page.goto(`http://localhost:${PORT}/`);
await page.waitForTimeout(900);

/* ── 建立計畫 ── */
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
await page.locator(".modal-backdrop .modal input").first().fill("三岔預填測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);

/* ── 匯入三岔檔 ── */
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "A00T00-01_三岔示範路口.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: readFileSync(SAMPLE),
  });
await page.waitForTimeout(3500);
const confirm = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirm.count()) {
  await confirm.first().click();
  await page.waitForTimeout(4000);
}
const applyVehicles = page.locator(
  '.vehicle-class-modal button:has-text("套用車種設定")',
);
if (await applyVehicles.count()) {
  await applyVehicles.first().click();
  await page.waitForTimeout(1200);
}

const GEOMETRY = ".intersection-manager-modal";
ok("匯入新的三岔路口時，幾何確認視窗要跳出來", (await page.locator(GEOMETRY).count()) > 0);

if (await page.locator(GEOMETRY).count()) {
  const text = (await page.locator(GEOMETRY).innerText()).replace(/\s+/g, " ");
  /* 三：預填一定要講出來，而且要講依據，不能只是安靜換一組數字。 */
  ok(
    "視窗要說明角度與流向是依調查表反推預填的",
    /預填/.test(text) && /反推/.test(text),
    text.slice(0, 140),
  );
  ok(
    "視窗要把調查表寫的缺口講出來（A 沒有右轉、B 沒有直進、C 沒有左轉）",
    /路口A 沒有右轉/.test(text) &&
      /路口B 沒有直進/.test(text) &&
      /路口C 沒有左轉/.test(text),
    text.slice(0, 200),
  );
  ok(
    "視窗要請使用者確認後按「儲存設定」，不是自動套用",
    /請確認無誤後按/.test(text) && /儲存設定/.test(text),
  );

  /* 預填的角度：C 應該是 90，而不是預設的 180。 */
  const angles = await page
    .locator(`${GEOMETRY} .arm-settings section input[type="number"]`)
    .evaluateAll((nodes) => nodes.map((node) => Number(node.value)));
  ok(
    "預填角度應為 A=-90、B=0、C=90（預設的 C=180 會讓 A 的直進沒有目的地）",
    angles.length === 3 && angles[2] === 90 && angles[2] !== 180,
    `實際角度 ${JSON.stringify(angles)}`,
  );

  await page.locator(`${GEOMETRY} button:has-text("儲存設定")`).first().click();
  await page.waitForTimeout(1500);
}

/* 存起來的設定要真的是反推值。 */
const stored = await page.evaluate(() => {
  try {
    return JSON.parse(
      localStorage.getItem("traffic-intersection-settings-v1") ?? "[]",
    );
  } catch {
    return [];
  }
});
ok(
  "按下「儲存設定」之後，三支支線的設定要真的存進瀏覽器",
  stored.length === 3,
  `存了 ${stored.length} 支`,
);
const armC = stored.find((setting) => setting.directionCode === "C");
ok(
  "存起來的路口C 角度是反推的 90 度",
  Number(armC?.angle) === 90,
  `實際 ${armC?.angle}`,
);

/* ── 行為驗證 ────────────────────────────────────────────────
 *
 * ⚠️ 一定要**先切到「駛入路口（依轉向推導）」視角**再檢查。
 *    「未指定駛入路口」只存在於駛入視角；停在預設的駛出視角去比對頁面文字，
 *    新舊版都會「找不到」而一律通過——那是假通過（第一次寫這支時就踩到了，
 *    對未修正的 v20.57 也是綠的）。
 */
async function selectFlowView(label) {
  const select = page.locator("select").filter({ hasText: label });
  if (!(await select.count())) return false;
  await select.first().selectOption({ label });
  await page.waitForTimeout(1500);
  return true;
}
const readTotal = async () => {
  const kpi = await page
    .locator(".kpi strong")
    .first()
    .innerText()
    .catch(() => "");
  return Number(kpi.replace(/[^\d]/g, "")) || 0;
};

ok("前置：找得到「駛出路口（起點）」視角", await selectFlowView("駛出路口（起點）"));
const outbound = await readTotal();
ok("前置：找得到「駛入路口（終點）」視角", await selectFlowView("駛入路口（終點）"));
const inbound = await readTotal();
const inboundText = await page.locator("body").innerText();
ok(
  "切到駛入視角後，不可以出現「未指定駛入路口」",
  !/未指定駛入路口/.test(inboundText),
  "仍有車流沒有目的地——支線幾何與調查表對不起來",
);
/*
 * 只驗「沒有未指定」會被「把那一列藏起來」騙過去，
 * 所以再驗總量：駛入視角的合計必須與駛出視角相同，車沒有被吃掉。
 */
ok(
  "駛入與駛出的總量必須相同（車不可以被吃掉，也不可以憑空多出來）",
  outbound > 0 && inbound > 0 && outbound === inbound,
  `駛出 ${outbound}／駛入 ${inbound}`,
);

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
