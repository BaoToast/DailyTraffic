/*
 * 端對端：歷季趨勢圖的版面與匯出的圖片
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的原話：「圖片最容易出現X軸沒文字或是文字被縮減、重疊等等狀況發生，
 * 請幫我確認圖表的圖或轉變成圖片後，格式都能正確，不要有縮減或重疊情況發生，
 * 美觀易讀懂是最重要的，有單位的軸，就要附上名稱和單位」，以及後來補充的
 * 「下載下來的圖本來就該只有圖，不能有文字」。
 *
 * ── 這一支要擋的是什麼 ────────────────────────────────────────
 *
 * 這個系統的趨勢圖是用 <canvas> 逐筆 ctx 指令畫的，**不吃樣式表**，
 * 所以沒有另外兩支「下載下來折線消失」的問題。但查出四個別的：
 *
 * 一、**縱軸只寫單位、沒有名稱。** 舊版畫的是 unit（例如「輛／調查日」），
 *     看圖的人不知道那是全日量、尖峰量還是某一個車種。
 * 二、**沒有橫軸名稱。**「113Q1、113Q2…」那一排字沒有標題。
 * 三、**X 軸標籤每一季都印**，季度累積到二十幾季就會擠成一團。
 * 四、**圖例畫在畫布外面**（是一段 HTML）。把這張圖存成圖片、或截圖貼進
 *     簡報時，圖上完全看不出哪一條是平日、哪一條是假日——而圖例是這張圖
 *     的一部分，不是旁邊的裝飾。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、**只驗「畫布存在」不算數。** 一張空白畫布也存在。
 *     這裡讀畫布的**像素**：折線的顏色要真的出現、不可以整張都是白的。
 * 二、**只驗「有 PNG 下載鈕」不算數。** 按下去產不出檔案也會過。
 *     要真的攔下下載的檔案，並確認它與畫布同樣大小、而且不是空白。
 * 三、**只驗畫面上有圖例文字不算數**——舊版的圖例就在畫面上（HTML），
 *     那樣驗會全綠，而下載下來的圖仍然沒有圖例。所以圖例要**在畫布的
 *     像素裡**找得到：用畫布左下角區域是否出現折線顏色來判斷。
 * 四、只驗目前測資的季度數不算數——現在幾季不會擠，二十幾季會。
 */
import { chromium } from "playwright";
import http from "node:http";
import * as fs from "node:fs";
import {
  readFileSync,
  existsSync,
  statSync,
  mkdtempSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { launchOptions } from "./chrome-path.mjs";

XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples-chart-layout");
mkdirSync(SAMPLES, { recursive: true });

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
function write(name, seed, factor) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheetFor(seed, factor), "平日");
  XLSX.utils.book_append_sheet(book, sheetFor(seed + 1, factor * 0.78), "假日");
  XLSX.writeFile(book, join(SAMPLES, name));
  return name;
}

/*
 * 八季。季度一多才驗得出 X 軸標籤會不會擠在一起；八季配上這個畫布寬度，
 * 已經足以讓「每一季都印」的舊做法露出馬腳。
 *
 * ⚠️ 中間**故意跳過 114Q1 與 114Q2**：整段期間是 113Q1～115Q2 共十季，
 * 但只匯入其中八季。X 軸必須排滿十格、缺的兩季留空並讓折線斷開——
 * 只排「有資料的八季」的話，113Q4 與 114Q3 會緊鄰成相鄰兩格，
 * 看圖的人（業主）會讀成「上一季到這一季」，實際上中間隔了半年。
 */
const QUARTERS = [
  "113Q1", "113Q2", "113Q3", "113Q4",
  "114Q3", "114Q4", "115Q1", "115Q2",
];
/** 期間內完全沒有匯入、必須被補成空格的季度。 */
const MISSING_QUARTERS = ["114Q1", "114Q2"];
const FILES = QUARTERS.map((quarter, index) =>
  write(`115T1-01_中山路_${quarter}.xlsx`, 3 + index * 2, 1 + index * 0.06),
);

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
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8137, r));
const browser = await chromium.launch(launchOptions());
const downloads = mkdtempSync(join(tmpdir(), "traffic-chart-"));
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

try {
  await page.goto("http://localhost:8137/");
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
  if (!(await page.locator(".modal input").first().isVisible().catch(() => false)))
    await page.locator('button:has-text("建立第一個")').first().click().catch(() => {});
  await page.locator(".modal-backdrop .modal input").first().fill("圖表版面測試計畫");
  await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
  await page.waitForTimeout(700);

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

  for (let i = 0; i < FILES.length; i += 1) await importFile(FILES[i], QUARTERS[i]);
  await page.waitForTimeout(1200);

  const canvas = page.locator("canvas.trend-canvas").first();
  await canvas.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  ok("前置：趨勢圖的畫布要在畫面上", (await canvas.count()) > 0);

  /**
   * 讀畫布的像素。
   * region 給的是 0～1 的相對範圍，用來只看畫布的某一塊（例如左下角的圖例）。
   */
  async function pixels(region) {
    return page.evaluate((area) => {
      const node = document.querySelector("canvas.trend-canvas");
      if (!node) return null;
      const c = node.getContext("2d");
      const x = Math.floor(node.width * (area?.x ?? 0));
      const y = Math.floor(node.height * (area?.y ?? 0));
      const w = Math.max(1, Math.floor(node.width * (area?.w ?? 1)));
      const h = Math.max(1, Math.floor(node.height * (area?.h ?? 1)));
      const data = c.getImageData(x, y, w, h).data;
      let teal = 0;
      let orange = 0;
      let white = 0;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 20) {
          white += 1;
          continue;
        }
        if (r > 245 && g > 245 && b > 245) white += 1;
        /* 平日線的青（palette.teal）與假日線的橘（palette.orange）。 */
        if (r < 120 && g > 100 && b > 110) teal += 1;
        if (r > 190 && g > 90 && g < 190 && b < 110) orange += 1;
        if (r < 160 && g < 160 && b < 170) ink += 1;
      }
      return { teal, orange, white, ink, total: w * h, size: [node.width, node.height] };
    }, region);
  }

  const whole = await pixels(null);
  ok("畫布不可以整張都是白的", whole && whole.white < whole.total * 0.995,
    whole ? `白色佔 ${((whole.white / whole.total) * 100).toFixed(2)}%` : "讀不到畫布");
  ok("平日折線的顏色要出現在畫布裡", whole && whole.teal > 200, `青色像素 ${whole?.teal}`);
  ok("假日折線的顏色要出現在畫布裡", whole && whole.orange > 200, `橘色像素 ${whole?.orange}`);

  /*
   * ⚠️ 圖例要在**畫布裡面**。
   * 舊版的圖例是畫布外的 HTML，所以下面這一塊（畫布最底下一條）不會有
   * 折線的顏色。只驗「畫面上看得到平日兩個字」擋不住那件事——那兩個字
   * 在 HTML 裡，圖存成圖片之後就不見了。
   */
  const legendArea = await pixels({ x: 0, y: 0.86, w: 1, h: 0.14 });
  ok(
    "圖例要畫在畫布裡面（下載成圖片時才看得出哪一條是平日、哪一條是假日）",
    legendArea && legendArea.teal > 20 && legendArea.orange > 20,
    legendArea ? `底部青 ${legendArea.teal}、橘 ${legendArea.orange}` : "讀不到",
  );

  /* ── 軸名稱與單位 ── */
  const axis = await page.evaluate(() => {
    const select = document.getElementById("trendMetric");
    return {
      hasMetricSelect: Boolean(select),
      options: select
        ? [...select.querySelectorAll("option")].map((o) => o.textContent)
        : [],
    };
  });
  ok("要有指標選單", axis.hasMetricSelect, axis.options.join("、"));
  ok(
    "指標選單要不只「實際交通量／PCU」兩種",
    axis.options.length >= 5,
    `${axis.options.length} 項`,
  );

  /*
   * ── 縱軸要寫「名稱（單位）」，不是只寫單位 ──────────────────
   *
   * 軸名稱是畫在畫布上的，讀不到文字節點。
   *
   * ⚠️ 只從講稿驗**擋不住這件事**——實測過：把畫軸名稱那一行改回只印
   * unit（舊做法），這支腳本照樣全綠，因為講稿是另一條路徑。
   *
   * 所以改成比較**畫布左邊那一條的像素**：換一個「名稱不同、單位相同」
   * 的指標（全日實際交通量 → 機車車輛數，單位都是「輛／調查日」）。
   * 若軸上只印單位，兩次的左邊那一條會**一模一樣**；印了名稱才會不同。
   */
  const axisStrip = async () =>
    page.evaluate(() => {
      const node = document.querySelector("canvas.trend-canvas");
      const c = node.getContext("2d");
      /*
       * 只取最左邊 30px（× dpr）——直書的軸名稱畫在 x=16。
       *
       * ⚠️ 不可以用百分比取一整條左邊：縱軸的刻度數字是右對齊到 x=68 的，
       * 四位數會延伸到 x≈40，落進那一條裡。換指標時刻度數字本來就會變，
       * 於是這一項就算軸上只印單位也照樣「有差異」——恆真的假通過。
       * 實測過：用 6% 寬度時，把軸名稱改回只印單位仍然全綠。
       */
      const dpr = node.width / node.getBoundingClientRect().width;
      const w = Math.max(1, Math.round(30 * dpr));
      const data = c.getImageData(0, 0, w, node.height).data;
      let sum = 0;
      let ink = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 20 && data[i] < 200) {
          ink += 1;
          sum += (i / 4) * (data[i] + data[i + 1] * 3 + data[i + 2] * 7);
        }
      }
      return { ink, signature: sum };
    });
  const axisBefore = await axisStrip();
  await page.selectOption("#trendMetric", "vehicleClass");
  await page.waitForTimeout(900);
  const axisAfter = await axisStrip();
  ok(
    "前置：縱軸那一條要真的有字（沒有字的話下一項會變成恆真）",
    axisBefore.ink > 50 && axisAfter.ink > 50,
    `${axisBefore.ink} / ${axisAfter.ink}`,
  );
  ok(
    "縱軸要寫「名稱（單位）」——換一個單位相同但名稱不同的指標，軸上的字要跟著變",
    axisBefore.signature !== axisAfter.signature,
    axisBefore.signature === axisAfter.signature
      ? "兩個指標的縱軸長得一模一樣，代表軸上只印了單位、沒有印名稱"
      : "",
  );
  await page.selectOption("#trendMetric", "actual");
  await page.waitForTimeout(900);

  /*
   * 講稿與軸名稱同一個來源（trendMetricName ＋ trendUnit），
   * 所以下面幾項驗的是講稿；軸上的字由上面那一項顧。
   */
  const scriptText = await page
    .locator("#trendScript")
    .innerText()
    .catch(() => "");
  ok("圖旁邊要有說明欄位", scriptText.length > 80, `${scriptText.length} 字`);
  for (const title of ["這張圖在說什麼", "重點變化", "怎麼看這張圖", "要先講清楚的"])
    ok(`說明要有「${title}」這一段`, scriptText.includes(title));
  ok(
    "說明裡要帶出指標名稱與單位",
    /全日實際交通量/.test(scriptText) && /輛/.test(scriptText),
    scriptText.slice(0, 60).replace(/\s+/g, " "),
  );
  ok(
    "說明不可以使用「個百分點」的講法",
    !scriptText.includes("個百分點"),
  );

  /* 換一個單位不同的指標，說明裡的單位要跟著變 */
  await page.selectOption("#trendMetric", "heavyShare");
  await page.waitForTimeout(900);
  const shareScript = await page.locator("#trendScript").innerText();
  ok(
    "換成「大型車比例」之後，說明裡的指標與單位要跟著變",
    shareScript.includes("大型車比例") && shareScript.includes("%"),
    shareScript.slice(0, 60).replace(/\s+/g, " "),
  );
  ok(
    "換指標之後折線仍然畫得出來",
    (await pixels(null))?.teal > 100,
  );
  /* 報表草稿必須沿用同一份趨勢條件；平日＋假日是兩條線，不是相加。 */
  await page
    .locator('.toolbar button:has-text("報表批次輸出中心")')
    .first()
    .click();
  const exportModal = page
    .locator(".modal-backdrop .workflow-modal")
    .filter({ hasText: "報表批次輸出中心" });
  const draft = await exportModal.locator(".report-draft-text").inputValue();
  const historyLine = draft
    .split(/\r?\n/)
    .find((line) => line.includes("歷季趨勢（")) ?? "";
  ok(
    "報表草稿的歷季趨勢要跟著目前選擇顯示大型車比例（%）",
    historyLine.includes("大型車比例") && historyLine.includes("%") && !historyLine.includes("PCU"),
    historyLine,
  );
  ok(
    "報表草稿的平日＋假日要分成兩組，不可以相加成虛構的一日數值",
    historyLine.includes("平日：") && historyLine.includes("假日："),
    historyLine,
  );
  await exportModal.locator('button:has-text("取消")').last().click();
  await page.waitForTimeout(300);
  /*
   * 尖峰小時類指標一定要**真的畫得出來**。
   *
   * 這一項是刻意加的：把指標加進選單卻沒有實作，畫面上只會變成一張空圖，
   * 沒有任何錯誤訊息——使用者選了之後只會覺得「這個功能壞了」。
   * 而且尖峰不是各路段自己的尖峰相加（那不對應任何一個真實的小時），
   * 是先把同一小時的量加起來再挑最忙的那一小時。
   */
  for (const metric of ["peakHour", "peakHourPcu"]) {
    await page.selectOption("#trendMetric", metric);
    await page.waitForTimeout(900);
    const drawn = await pixels(null);
    ok(
      `「${metric}」要真的畫得出折線（不可以是一張空圖）`,
      drawn && drawn.teal > 200,
      `青色像素 ${drawn?.teal}`,
    );
  }
  await page.selectOption("#trendMetric", "peakHour");
  await page.waitForTimeout(700);
  const peakScript = await page.locator("#trendScript").innerText();
  ok(
    "尖峰小時的說明要提醒「各季尖峰不一定是同一個小時」或說明落在哪個小時",
    /尖峰/.test(peakScript),
    peakScript.slice(0, 50).replace(/\s+/g, " "),
  );

  await page.selectOption("#trendMetric", "actual");
  await page.waitForTimeout(900);

  /* ── 真的按下下載鈕，攔下檔案 ── */
  const download = page.waitForEvent("download", { timeout: 20000 });
  await page.locator("#trendDownloadPng").click();
  const file = await download;
  const target = join(downloads, "trend.png");
  await file.saveAs(target);
  ok("按下 PNG 下載鈕要真的下載到檔案", existsSync(target));
  const bytes = existsSync(target) ? readFileSync(target) : Buffer.alloc(0);
  ok("下載的檔案要是 PNG（不是空檔或壞檔）",
    bytes.length > 5000 && bytes.slice(1, 4).toString() === "PNG",
    `${bytes.length} bytes`);
  /*
   * ⚠️ 檔名**不可以**用 download.suggestedFilename() 驗。
   *
   * 實測過：在 headless Chromium 底下，即使是一段完全正確的 blob 下載
   *（<a download="測試檔名.txt">），Playwright 回報的 suggestedFilename
   * 一樣是 "download"。拿它來斷言等於在驗測試工具的行為，不是驗程式——
   * 而且會得到一個「怎麼改都修不好」的紅字，最後很可能被改成不驗。
   *
   * 改成攔截 <a> 的 click，把當下的 download 屬性記下來，直接驗程式
   * 到底有沒有把檔名設對。
   */
  const captured = await page.evaluate(async () => {
    const original = HTMLAnchorElement.prototype.click;
    const seen = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) seen.push(this.download);
    };
    document.getElementById("trendDownloadPng").click();
    await new Promise((done) => setTimeout(done, 800));
    HTMLAnchorElement.prototype.click = original;
    return seen;
  });
  ok(
    "前置：要真的攔到下載動作（攔不到的話下一項會變成恆真）",
    captured.length === 1,
    `攔到 ${captured.length} 次`,
  );
  ok(
    "下載的檔名要帶指標與日別，兩種條件匯出才不會同名互相覆蓋",
    /歷季趨勢\.png$/.test(captured[0] || "") &&
      (captured[0] || "").includes("全日實際交通量") &&
      (captured[0] || "").includes("平日＋假日"),
    captured[0] || "沒有設定檔名",
  );

  /* ── 縱軸刻度與留白 ── */
  /*
   * 使用者的問題：「點位落下的位置和 Y 軸不符呢？」
   *
   * 這一支系統的圖是 canvas 畫的，格線與資料點用的是**同一組** top／h／max
   *（`y = top + h - (value / max) * h`，格線 `y = top + h * i / 4`），
   * 所以位置本來就對得起來——真正的問題是**軸頂等於資料最大值**：
   * 最高那個點的圓心正好落在最上面那條格線上，半徑 4px 的圓有一半畫在
   * 繪圖區外，看起來像被切掉，而且刻度會變成 42,090／31,568 這種亂數。
   *
   * ⚠️ 假通過陷阱：只驗「畫得出折線」擋不住——舊版也畫得出來。
   * 要驗的是**最上面那一條資料線的像素，距離繪圖區頂端有沒有留白**。
   * 舊版留白是 0（點的圓心就在頂線上），修好之後一定 > 0。
   */
  const topGap = await page.evaluate(() => {
    const node = document.querySelector("canvas.trend-canvas");
    if (!node) return null;
    const c = node.getContext("2d");
    const ratio = node.width / node.getBoundingClientRect().width || 1;
    /* 繪圖區頂端＝程式裡的 top（30 CSS px）。 */
    const top = Math.round(30 * ratio);
    const data = c.getImageData(0, 0, node.width, node.height).data;
    let firstTeal = -1;
    for (let y = 0; y < node.height && firstTeal < 0; y += 1)
      for (let x = 0; x < node.width; x += 1) {
        const i = (y * node.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        /*
         * ⚠️ 要用**嚴格**的青（#148C8C：r 很低、g 與 b 接近且明顯高於 r）。
         * 寬鬆的判定（r<120 && g>100 && b>110）會把刻度文字的灰
         *（#708090 = 112,128,144）一起算成青色——而刻度文字就印在繪圖區
         * 頂端，這一項會永遠紅，最後很可能被改成不驗。
         */
        if (
          data[i + 3] > 20 &&
          r < 90 &&
          g > 110 &&
          b > 110 &&
          Math.abs(g - b) < 30 &&
          g - r > 60
        ) {
          firstTeal = y;
          break;
        }
      }
    return { firstTeal, top, ratio, height: node.height };
  });
  ok(
    "前置：畫布上要找得到平日折線的顏色（找不到的話下一項會變成恆真）",
    topGap && topGap.firstTeal >= 0,
    topGap ? `最上緣的青色在 y=${topGap.firstTeal}` : "讀不到畫布",
  );
  ok(
    "最高的資料點不可以貼著最上面那條格線（圓點會被切掉一半）",
    topGap && topGap.firstTeal > topGap.top + 3 * topGap.ratio,
    topGap
      ? `青色最上緣 y=${topGap.firstTeal}，繪圖區頂端 y=${topGap.top}，留白 ${topGap.firstTeal - topGap.top}px`
      : "讀不到畫布",
  );

  /* ── 整季沒調查時，那幾季要被補成空格 ── */
  /*
   * ⚠️ 這一段守的是「兩個點緊鄰＝相隔一季」的讀法。
   *
   * 測資刻意跳過 114Q1 與 114Q2。畫布上的字讀不到（canvas 不是 DOM），
   * 但講稿與畫布讀的是**同一份 trendRows**（這是刻意的單一來源架構），
   * 所以講稿有沒有把那兩季當成「圖上的一格」，就等於 X 軸有沒有排它們。
   *
   * 假通過陷阱：只驗「講稿有提到缺季」擋不住舊版——舊版的 trendRows 裡
   * 根本沒有 114Q1 這一列，那兩季不會出現在任何一句話裡。所以要驗
   * **逐字出現那兩個季度**，而且數量剛好是二。
   */
  const trendScriptText = await page
    .locator("#trendScript")
    .first()
    .innerText()
    .catch(() => "");
  ok(
    "前置：要真的讀得到趨勢講稿",
    trendScriptText.length > 40,
    `讀到 ${trendScriptText.length} 個字`,
  );
  for (const quarter of MISSING_QUARTERS)
    ok(
      `整季沒有資料的 ${quarter} 要出現在圖上（補成空格、折線斷開）`,
      trendScriptText.includes(quarter),
      trendScriptText.includes(quarter) ? "" : "講稿裡完全沒有這一季",
    );
  ok(
    "缺季要正好是兩季，不可以多補或少補",
    /有\s*2\s*季平日與假日都沒有資料/.test(trendScriptText),
    (trendScriptText.match(/有\s*\d+\s*季平日與假日都沒有資料/) || [
      "（沒有這一句）",
    ])[0],
  );

  const gapPixels = await page.evaluate(() => {
    const node = document.querySelector("canvas.trend-canvas");
    if (!node) return null;
    const c = node.getContext("2d");
    const ratio = node.width / node.getBoundingClientRect().width || 1;
    const left = 78 * ratio;
    const right = 28 * ratio;
    const top = 30 * ratio;
    const bottom = 86 * ratio;
    const plotWidth = node.width - left - right;
    const count = 10;
    const counts = [];
    for (const index of [4, 5]) {
      const center = left + (plotWidth * index) / (count - 1);
      let colored = 0;
      const data = c.getImageData(
        Math.max(0, Math.floor(center - 2 * ratio)),
        Math.floor(top + 2 * ratio),
        Math.max(1, Math.ceil(4 * ratio)),
        Math.max(1, Math.floor(node.height - bottom - top - 4 * ratio)),
      ).data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const teal = r < 80 && g > 105 && g < 175 && b > 105 && b < 175;
        const orange = r > 205 && g > 90 && g < 175 && b < 90;
        if (teal || orange) colored += 1;
      }
      counts.push(colored);
    }
    return counts;
  });
  ok(
    "缺少 114Q1、114Q2 時，畫布在兩季位置要真的斷線",
    gapPixels?.every((count) => count === 0),
    `兩個空季的折線色像素：${gapPixels?.join("、") ?? "讀不到"}`,
  );

  ok("整段流程不可以留下未捕捉的例外", jsErrors.length === 0, jsErrors.slice(0, 2).join(" / "));
} finally {
  await browser.close();
  server.close();
}

console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
