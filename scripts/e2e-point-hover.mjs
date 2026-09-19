/*
 * ══════════════════════════════════════════════════════════════════
 *  數值標籤：少量直接標、量多改成滑鼠移上去；匯出一律淨空
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者定案（路口轉向 2026-09-10，2026-09-11 指名三支同步）：
 *   「在資料數列少的時候做到不重疊沒有問題，但資料一多，其實還是改成
 *     滑鼠移上去才顯示數值就很夠用……匯出的圖則統一為乾淨版。」
 *   「不需要有跳轉功能，但要有測值。」
 *
 * ── 這一支在守什麼 ────────────────────────────────────────────
 *
 *   ① 資料少（標籤總數 ≤ 8）：不必移滑鼠就看得到數值
 *   ② 資料多：靜止時**一個標籤都沒有**
 *   ③ 資料多時滑鼠移到某一個點：**那一個點**的數值出現，而且數字正確
 *   ④ 滑鼠移開：標籤要消失
 *   ⑤ 匯出的 PNG 一律淨空
 *
 * ── ⚠️ 這一支刻意迴避的假通過 ────────────────────────────────
 *
 * 一、**只驗「hover 之後有字」不算數**：可能顯示的是別的點的值。
 *     這裡比對的是標籤上的 data-value 與它自己顯示的數字。
 * 二、**只驗「資料多時沒有標籤」不算數**：圖沒畫出來也會通過。
 *     所以先前置檢查「畫布真的畫了東西、而且點數超過門檻」。
 * 三、**匯出淨空不可以只看「畫布上沒有文字」**——本來就沒有。
 *     這一支驗的是**結構**：標籤是畫布上方的 HTML 層，
 *     而匯出讀的是畫布本身，所以匯出天生就不可能帶到標籤。
 *     驗法是：畫面上明明有標籤，畫布的像素卻與「沒有標籤時」逐格相同。
 */
import { chromium } from "playwright";
import http from "node:http";
import * as fs from "node:fs";
import { readFileSync, existsSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";
import { ensureToolbarOpen } from "./e2e-nav.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = mkdtempSync(join(tmpdir(), "point-hover-"));

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const BASE = { 機車: 900, 小型車: 700, 大貨車: 60, 聯結車: 25, 大客車: 40 };
const pad = (n) => String(n).padStart(2, "0");
function seeded(n) {
  let x = n * 9301 + 49297;
  return () => ((x = (x * 9301 + 49297) % 233280), x / 233280);
}
function sheetFor(seed, factor) {
  const rnd = seeded(seed);
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let hour = 0; hour < 24; hour += 1) {
    const label = `${pad(hour)}:00～${pad((hour + 1) % 24)}:00`;
    const cells = [];
    for (let d = 0; d < 2; d += 1)
      for (const vehicle of VEHICLES)
        cells.push(
          Math.round(BASE[vehicle] * factor * (d ? 0.85 : 1) * (0.9 + rnd() * 0.2)),
        );
    rows.push([label, ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}
/*
 * 平日與假日各一張表。
 *
 * ⚠️ 第一版只寫平日一張，結果趨勢圖的 rows 是空的、一個點都畫不出來
 *   （實測 console 印出 `rows=0`）——那條線需要兩種日別才組得出來。
 *   所以標籤數 ＝ 季數 × 2。
 */
function write(name, seed, factor) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(seed, factor), "平日");
  XLSX.utils.book_append_sheet(book, sheetFor(seed + 1, factor * 0.78), "假日");
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}

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
const errors = [];

/**
 * 開一個**乾淨的** context，匯入指定季數之後停在圖表分頁。
 *
 * ⚠️ 一定要各自開 context。這支程式會把資料搬進 IndexedDB，而 IndexedDB
 *   是整個 context 共用的；共用的話第二份測資會被第一份蓋過去，
 *   「資料多」那一段實際上量到的是「資料少」的畫面
 *  （姊妹專案的同名腳本就是這樣被前置檢查抓到的）。
 */
async function openWith(quarters) {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    locale: "zh-TW",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e.message)));
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
  await page.goto("http://localhost:8195/");
  /* ⚠️ X-78：主工具列預設收合，這一支要用到它的欄位，先展開。 */
  await page.waitForTimeout(1200);
  await ensureToolbarOpen(page);
  await page.waitForTimeout(900);
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
  await page.locator(".modal-backdrop .modal input").first().fill("標籤測試計畫");
  await page
    .locator('.modal-backdrop .modal button:has-text("建立")')
    .first()
    .click();
  await page.waitForTimeout(700);
  /*
   * ⚠️ 匯入的細節與 e2e-chart-layout 逐字相同，**不要自己簡化**。
   *   第一版把「套用車種設定」和「關閉／取消」混在同一個收尾迴圈裡，
   *   結果車種設定被按到取消，整批資料沒有寫進去——
   *   畫面上圖照畫（只有軸線與圖例），講稿寫「目前沒有任何一條線畫得出來」，
   *   而我的斷言只說「沒有標籤」，看起來像功能壞掉。
   */
  async function importFile(name, quarter) {
    await page.locator('.toolbar button:has-text("匯入資料")').first().click();
    await page.waitForTimeout(400);
    await page
      .locator('.modal-backdrop .modal label:has-text("資料季度") input')
      .fill(quarter);
    await page
      .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
      .setInputFiles({
        name,
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: readFileSync(join(SAMPLES, name)),
      });
    await page.waitForTimeout(2200);
    const confirm = page.locator('.modal-backdrop button:has-text("確認")');
    if (await confirm.count()) {
      await confirm.first().click();
      await page.waitForTimeout(2600);
    }
    const apply = page.locator(
      '.vehicle-class-modal button:has-text("套用車種設定")',
    );
    if (await apply.count()) {
      await apply.first().click();
      await page.waitForTimeout(500);
    }
    for (let i = 0; i < 4 && (await page.locator(".modal-backdrop").count()); i += 1) {
      const closer = page
        .locator(
          '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
        )
        .first();
      if (!(await closer.count())) break;
      await closer.click();
      await page.waitForTimeout(400);
    }
  }
  for (let i = 0; i < quarters.length; i += 1) {
    const name = write(`115T1-01_中山路_${quarters[i]}.xlsx`, 3 + i * 2, 1 + i * 0.06);
    await importFile(name, quarters[i]);
  }
  /*
   * ⚠️ 趨勢圖要切成「平日＋假日」才會有**兩條線**。
   *
   * 舊版沒有切，主工具列預設是「平日」，所以圖上只有一條線——
   * 2 季就只有 2 個標籤，「標籤之間沒有互相重疊」那一條**幾乎恆真**
   *（兩個離很遠的標籤怎麼擺都不會疊）。使用者 2026-09-15 回報
   * 「平假日的數字標籤在圖中重疊了」時，這支守門是綠的。
   */
  await page
    .locator('[data-testid="mt-day"]')
    .selectOption("平日＋假日")
    .catch(() => {});
  await page.waitForTimeout(600);
  /* ⚠️ X-63：歷季分析（trend-canvas）現在自己一個大分頁。 */
  await gotoBlock(page, "block-trend");
  await page.locator("canvas.trend-canvas").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(900);
  return page;
}

/** 目前看得見的數值標籤。 */
const labelsOf = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".chart-value-layer .point-value")].map((el) => ({
      text: (el.textContent || "").trim(),
      value: Number(el.getAttribute("data-value")),
    })),
  );

/* ══ 一、資料少也**不標**在圖上（X-46，2026-09-16 改規則）════ */
/*
 * ⚠️ 這一節原本驗的是**相反的事**：「資料少（標籤 ≤ 8）時不必移滑鼠
 *   就看得到數值」。使用者 2026-09-16 把規則改掉了：
 *
 *     「又再次出現標籤重疊的問題。如果一直出現這個問題，
 *       是否統一一律改為滑鼠移上去才顯示數字呢?」
 *     「折線／趨勢圖的數值標籤預設不畫在圖上……
 *       下載的 PNG 不標數字，保持淨空版……可編輯 Excel 標數字」
 *
 *   舊規則（少就直接標、多才 hover）本身就是重疊問題的來源：
 *   標籤比點的間距寬時，怎麼避讓都會有擠在一起的組合。
 *
 * ⚠️ 舊的那幾條（避讓、不可超出繪圖區、不可壓到縱軸刻度）**沒有作廢**，
 *   只是移到「hover 出現的那一個標籤」上驗——那一個標籤一樣可能
 *   被切掉或壓到刻度，而且發生在最左最右那一季時最明顯。
 */
console.log("\n══ 一、資料少也不標在圖上，hover 才顯示 ══");
const few = await openWith(["112Q4", "115Q1", "115Q2"]);
const fewPoints = await few.evaluate(
  () => document.querySelectorAll(".chart-value-layer .point-hit").length,
);
const fewLabels = await labelsOf(few);
ok(
  "前置：圖真的畫出來了（沒畫出來的話下面那條是恆真的）",
  fewPoints > 0 ||
    (await few.evaluate(
      () => !!document.querySelector(".trend-canvas"),
    )),
  `${fewPoints} 個可 hover 的點`,
);
ok(
  "⚠️ ① 資料少時**靜止畫面上一個數字標籤都沒有**（規則已統一成 hover 才顯示）",
  fewLabels.length === 0,
  `${fewLabels.length} 個：${fewLabels.map((l) => l.text).join("／")}`,
);

/*
 * hover 最左邊那一季的點：它的標籤最容易壓到縱軸刻度。
 * ⚠️ 這一段是舊規則那幾條「不可被切掉、不可壓到刻度」的新家，
 *   不是新加的檢查——規則改了，要守的東西沒有改。
 */
const edge = await few.evaluate(() => {
  const layer = document.querySelector(".chart-value-layer");
  const canvas = document.querySelector(".trend-canvas");
  if (!layer || !canvas) return null;
  const box = layer.getBoundingClientRect();
  return {
    boxX: box.left,
    boxY: box.top,
    width: box.width,
    height: box.height,
    scale: box.width / (canvas.width || box.width),
    plotLeft: Number(layer.dataset.plotLeft || 0),
    plotRight: Number(layer.dataset.plotRight || 0),
    axisTextRight: Number(layer.dataset.axisTextRight || 0),
  };
});
if (!edge) {
  ok("前置：量得到繪圖區的座標（量不到的話下面全部恆真）", false);
} else {
  const plotLeftPx = edge.boxX + edge.plotLeft * edge.scale;
  const plotRightPx = edge.boxX + edge.plotRight * edge.scale;
  const axisRightPx = edge.boxX + edge.axisTextRight * edge.scale;
  /* 沿著最左那一季的垂直線往下掃，找到會讓標籤出現的那個位置。 */
  let shown = [];
  for (let y = 30; y <= edge.height - 86; y += 4) {
    await few.mouse.move(plotLeftPx + 2, edge.boxY + y);
    shown = await labelsOf(few);
    if (shown.length) break;
  }
  ok(
    "⚠️ ① 滑鼠移到最左那一季的點上，標籤要出現（出不來的話等於沒有數值可看）",
    shown.length > 0,
    shown.map((l) => l.text).join("／") || "（沿著整條垂直線都沒有出現）",
  );
  if (shown.length) {
    /*
     * ⚠️ 18px：標籤就算剛好落在繪圖區左緣，離縱軸刻度也只有 10px，
     *   使用者看到的就是「快貼到了」（2026-09-11 回報過）。
     */
    const GAP = 18;
    const bad = await few.evaluate(
      ({ axisRightPx, plotRightPx, GAP }) =>
        [...document.querySelectorAll(".chart-value-layer .point-value")]
          .map((el) => ({
            text: (el.textContent || "").trim(),
            r: el.getBoundingClientRect(),
          }))
          .filter(
            (item) =>
              item.r.left < axisRightPx + GAP || item.r.right > plotRightPx + 0.5,
          )
          .map(
            (item) =>
              `${item.text}（${Math.round(item.r.left)}~${Math.round(item.r.right)}，` +
              `縱軸刻度右緣 ${Math.round(axisRightPx)}、需留 ${GAP}px，` +
              `繪圖區右緣 ${Math.round(plotRightPx)}）`,
          ),
      { axisRightPx, plotRightPx, GAP },
    );
    ok(
      "⚠️ ① hover 出來的標籤不可以壓到縱軸刻度，也不可以被右緣切掉",
      bad.length === 0,
      failOnly(`超出去的：${bad.join("、")}`),
    );
    ok(
      "⚠️ ① 一次只出現**一個**標籤（一次冒出好幾個就會回到重疊問題）",
      shown.length === 1,
      `出現 ${shown.length} 個：${shown.map((l) => l.text).join("／")}`,
    );
    const printed = Number(shown[0].text.replace(/[^\d.]/g, ""));
    ok(
      "⚠️ ① 標籤上印的數字與那個點自己記的值一致（不是印到別的點的值）",
      Number.isFinite(printed) &&
        Math.abs(printed - shown[0].value) <
          Math.max(1, Math.abs(shown[0].value) * 0.005),
      `印出 ${shown[0].text}｜點上記的值 ${shown[0].value}`,
    );
  }
  /* 移開之後要收掉，否則捲一捲整張圖都是字。 */
  await few.mouse.move(4, 4);
  await few.waitForTimeout(300);
  ok(
    "⚠️ ① 滑鼠移開之後標籤要消失",
    (await labelsOf(few)).length === 0,
    `還剩 ${(await labelsOf(few)).length} 個`,
  );
}

/* ══ 二、資料多：靜止沒有標籤，移上去才出現 ═══════════════════ */
console.log("\n══ 二、資料多：靜止沒有標籤，滑鼠移上去才顯示 ══");
const many = await openWith([
  "113Q1", "113Q2", "113Q3", "113Q4",
  "114Q1", "114Q2", "114Q3", "114Q4",
  "115Q1", "115Q2",
]);
const points = await many.evaluate(() => {
  const canvas = document.querySelector("canvas.trend-canvas");
  if (!canvas) return { error: "找不到畫布" };
  const c = canvas.getContext("2d");
  const data = c.getImageData(0, 0, canvas.width, canvas.height).data;
  let painted = 0;
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] > 0 && !(data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245))
      painted += 1;
  return { painted };
});
ok(
  "前置：畫布真的畫了東西（不是拿一張空白圖當通過）",
  !points.error && points.painted > 2000,
  points.error || `有顏色的像素 ${points.painted}`,
);
const idle = await labelsOf(many);
ok(
  "資料多時，靜止畫面上一個標籤都沒有",
  idle.length === 0,
  failOnly(`還留著 ${idle.length} 個：${idle.map((l) => l.text).join("／")}`),
);

/*
 * 滑鼠移到中間那一個資料點上。
 * ⚠️ 座標由畫面自己算（畫布左緣 ＋ 點的 x），不要自己推算版面，
 *   推錯的話「移上去沒反應」看起來像功能壞掉，其實是沒對準。
 */
const hoverTarget = await many.evaluate(() => {
  const canvas = document.querySelector("canvas.trend-canvas");
  const box = canvas.getBoundingClientRect();
  /* 版面常數與繪圖那一段一致：左 78、右 28、上 30、下 86 */
  const left = 78;
  const right = 28;
  const width = box.width;
  return { boxX: box.x, boxY: box.y, left, right, width, height: box.height };
});
/* 十季 → 取第 5 個點（索引 4）：不是頭也不是尾，邊界過不代表中間過。 */
const count = 10;
const index = 4;
const w = hoverTarget.width - hoverTarget.left - hoverTarget.right;
const px = hoverTarget.left + (w * index) / (count - 1);
/* y 不用算：沿著那一條垂直線由上往下掃，掃到有標籤出現就停。 */
let hovered = [];
for (let y = 30; y <= hoverTarget.height - 86; y += 4) {
  await many.mouse.move(hoverTarget.boxX + px, hoverTarget.boxY + y);
  hovered = await labelsOf(many);
  if (hovered.length) break;
}
ok(
  "滑鼠移到某一個資料點上時，數值出現",
  hovered.length > 0,
  hovered.map((l) => l.text).join("／") || "（沿著整條垂直線都沒有出現）",
);
ok(
  "只顯示滑鼠停的那一個，不是整排都亮起來",
  hovered.length === 1,
  `出現 ${hovered.length} 個`,
);
/*
 * ⚠️ 重點：顯示的數字要真的是那一個點的值。
 *   標籤上另外記了 data-value（原始值），這裡比對「印出來的字」與「原始值」。
 */
if (hovered.length === 1) {
  const printed = Number(hovered[0].text.replace(/[^\d.]/g, ""));
  ok(
    "印出來的數字就是那一個點的值",
    Math.abs(printed - hovered[0].value) < Math.max(1, hovered[0].value * 0.005),
    `印出 ${hovered[0].text}｜點上記的值 ${hovered[0].value}`,
  );
}

await many.mouse.move(hoverTarget.boxX + 5, hoverTarget.boxY + 5);
await many.waitForTimeout(300);
ok(
  "滑鼠移開之後標籤要消失",
  (await labelsOf(many)).length === 0,
  failOnly("移開之後標籤還在"),
);

/* ══ 三、匯出一律淨空 ═══════════════════════════════════════ */
console.log("\n══ 三、匯出的圖一律淨空 ══");
/*
 * 匯出讀的是畫布本身（canvas.toDataURL），而標籤是畫布**上方的 HTML**，
 * 所以匯出天生不可能帶到標籤。這裡把這個結構驗出來：
 * 在「有標籤」的那一頁，畫布像素與「把標籤整層藏起來」之後逐格相同。
 */
/*
 * ⚠️ X-46 之後標籤是 hover 才出現的，所以要**先把滑鼠移到一個點上**，
 *   畫面上才有標籤可以拿來證明「有沒有標籤，畫布都一樣」。
 *   不先 hover 的話 labelCount 是 0，前置那一條會紅，而紅的原因
 *   與這一節要驗的事情無關（2026-09-16 實測）。
 */
{
  const geo = await few.evaluate(() => {
    const layer = document.querySelector(".chart-value-layer");
    const canvas = document.querySelector(".trend-canvas");
    if (!layer || !canvas) return null;
    const box = layer.getBoundingClientRect();
    return {
      boxX: box.left,
      boxY: box.top,
      height: box.height,
      scale: box.width / (canvas.width || box.width),
      plotLeft: Number(layer.dataset.plotLeft || 0),
    };
  });
  if (geo)
    for (let y = 30; y <= geo.height - 86; y += 4) {
      await few.mouse.move(geo.boxX + geo.plotLeft * geo.scale + 2, geo.boxY + y);
      if ((await labelsOf(few)).length) break;
    }
}
const cleanProof = await few.evaluate(() => {
  const canvas = document.querySelector("canvas.trend-canvas");
  const layer = document.querySelector(".chart-value-layer");
  if (!canvas || !layer) return { error: "找不到畫布或標籤層" };
  const shot = () => canvas.toDataURL("image/png");
  const withLabels = shot();
  const labelCount = layer.querySelectorAll(".point-value").length;
  layer.style.display = "none";
  const withoutLabels = shot();
  layer.style.display = "";
  return { same: withLabels === withoutLabels, labelCount, length: withLabels.length };
});
ok(
  "前置：這一頁畫面上真的有標籤（否則下一條是恆真的）",
  !cleanProof.error && cleanProof.labelCount > 0,
  cleanProof.error || `${cleanProof.labelCount} 個標籤`,
);
ok(
  "畫布（＝匯出來源）不受標籤影響：藏不藏標籤，像素逐格相同",
  cleanProof.same === true,
  failOnly("畫布內容會跟著標籤變——代表標籤被畫進畫布了，匯出會帶出去"),
);
ok(
  "而且畫布不是空的",
  (cleanProof.length || 0) > 5000,
  `PNG 資料長度 ${cleanProof.length}`,
);

/* 留一張圖給人看（只在本機跑時有用，不影響判定）。 */
await few
  .locator(".trend-canvas-wrap")
  .first()
  .screenshot({ path: join(here, "manual", "point-labels-few.png") })
  .catch(() => {});

ok("過程中沒有 JS 例外", errors.length === 0, failOnly(errors.slice(0, 3).join(" / ")));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項未通過`);
  process.exit(1);
}
console.log("\n✅ 全部通過");
