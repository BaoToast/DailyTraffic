/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一個視窗：①「取消／確認／關閉」始終看得見　②文字對比實測
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13：
 *   「我剛發現一個很實用的小細節，就是畫面右下角的**取消／關閉功能，
 *     請保持始終可見**，不要像這張圖片視窗一樣，我必須把內容滑到最底部，
 *     才能看到取消／關閉的功能鍵。請把這一個事項同步給 3 個程式。」
 *   「請**確實檢視每個有「取消、確認、關閉」的功能鍵**，
 *     這類功能鍵都能始終可見，而不用在視窗中要滑到最底才能選擇。」
 *
 * ⚠️ 以前只有匯入確認那一個視窗做了（.modal footer.sticky-actions），
 *   其餘十幾個視窗的動作列都是跟著內容一起捲走的。
 *
 * ── 這一支怎麼避開假通過 ────────────────────────────────────────
 *
 * 一、**只量畫面上打得開的那幾個視窗不夠**——沒被量到的視窗可以照樣是壞的。
 *     所以先做**原始碼盤點**：每一個 .modal-backdrop 區塊都必須有動作列
 *     （<footer 或 className="modal-actions"），一個都不能少。
 * 二、**只驗 CSS 有寫 sticky 不夠**——寫了但被別條蓋掉照樣沒效。
 *     所以要在瀏覽器裡讀**計算後**的 position。
 * 三、**只驗 position 是 sticky 還是不夠**——視窗捲不動時任何寫法都看得見。
 *     所以要有至少一個**真的長到需要捲**的視窗，在捲到最上面時量按鈕位置。
 * 四、每一顆按鈕都要量，不是量第一顆就算過（使用者指名「每個」）。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ② 文字對比：**逐一打開對話框，量算繪之後的真實顏色**（#2，2026-09-30）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼加在這一支裡，不另開一支：
 *   「逐一把每個對話框打開」是整件事**最麻煩也最容易壞**的部分
 *  （建計畫、匯入、按對按鈕、關掉前一個），而這一支已經做完了。
 *   另開一支就是把那兩百行複製一份，兩份遲早不同步——
 *   然後其中一份會開不到某個視窗，而它會**安靜地少量一個視窗**。
 *
 * ⚠️ 為什麼一定要在視窗**打開之後**量，而不是掃 CSS：
 *   使用者 2026-09-11 的原話：「參數設定 套用季別 全季別 和套用路段
 *   也全面是白色的，與背景色相融，**完全沒發現這裡可以設定**」。
 *   那一次 CSS 檔裡根本沒有那幾條規則，掃 CSS 掃不到「沒寫的東西」；
 *   而且視窗的底色是由好幾層祖先疊出來的，只有算繪之後才知道真正的底是什麼。
 *
 * ⚠️ 判準：一般文字 4.5:1、大字（≥24px 或 ≥18.66px 且粗體）3:1（WCAG AA）。
 *   停用中的控制項依 WCAG 1.4.3 排除（改亮會讓人以為還能按）。
 * ⚠️ 前置：塞一個**故意低對比**的元素進視窗，量測必須抓到它——
 *   抓不到的話，整段對比量測是恆綠的。
 */
import { chromium } from "playwright";
import * as XLSX from "xlsx";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");

const problems = [];
/*
 * ⚠️ detail 分兩種用途：有些是**佐證**（成功時也該印出來看），
 *   有些是**失敗原因**（成功時印出來會讓人以為出事了）。
 *   後者用 failOnly() 包起來，只在紅字時才顯示。
 */
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object" ? (condition ? "" : detail.failOnly) : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

/* ══════════════════════════════════════════════════════════════════
 * 一、原始碼盤點：每一個視窗都要有動作列
 * ══════════════════════════════════════════════════════════════════ */
const source = readFileSync(join(here, "..", "app", "DashboardClient.tsx"), "utf8");
const blocks = source.split('className="modal-backdrop"').slice(1);
ok(
  "前置：原始碼裡找得到視窗（否則下面整段是恆真）",
  blocks.length >= 10,
  `${blocks.length} 個視窗`,
);
const withoutActions = blocks
  .map((block, index) => ({
    index,
    /* 只看到下一個視窗為止，避免把別人的動作列算成自己的。 */
    head: block,
  }))
  .filter(({ head }) => !/<footer|className="modal-actions"/.test(head.slice(0, 40000)));
ok(
  "每一個視窗都有動作列（<footer 或 .modal-actions）",
  withoutActions.length === 0,
  withoutActions.map((item) => `第 ${item.index + 1} 個`).join("、"),
);

const css = readFileSync(join(here, "..", "app", "globals.css"), "utf8");
ok(
  "樣式表裡有「動作列一律黏住」這條規則",
  /\.modal footer,\s*\.modal \.modal-actions\s*\{[^}]*position:\s*sticky/.test(css),
);

/* ══════════════════════════════════════════════════════════════════
 * 二、瀏覽器實測
 * ══════════════════════════════════════════════════════════════════ */
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

/* 造一份夠長的路口資料，讓匯入預覽與路口設定兩個視窗都真的需要捲。 */
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
    rows[1][cell] = "站名：動作列測試路口";
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
            3 + ((index + vehicleIndex + movementIndex + hourIndex) % 9);
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
  /* ⚠️ 視窗刻意矮一點，才逼得出「內容比視窗長」的情形。 */
  viewport: { width: 1440, height: 720 },
  locale: "zh-TW",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (event) => errors.push(String(event.message)));
page.on("dialog", (event) => event.accept(event.type() === "prompt" ? "N" : ""));
await page.goto(base);
await page.waitForTimeout(1200);

const ACTION_WORDS = ["取消", "確認", "關閉", "儲存", "建立", "套用", "匯入", "刪除"];

/**
 * 量目前畫面上的視窗。
 *
 * ⚠️ 一定要先把視窗捲到**最上面**再量——捲到底當然看得見，那是使用者抱怨的原狀。
 */
async function measure(name) {
  const found = await page.evaluate((words) => {
    const modal = document.querySelector(".modal-backdrop .modal");
    if (!modal) return null;
    modal.scrollTop = 0;
    const bar =
      modal.querySelector(":scope > footer") ??
      modal.querySelector(":scope > .modal-actions") ??
      modal.querySelector("footer") ??
      modal.querySelector(".modal-actions");
    if (!bar) return { noBar: true };
    const style = getComputedStyle(bar);
    const buttons = [...bar.querySelectorAll("button")].map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        text: (button.textContent || "").replace(/\s+/g, " ").trim(),
        bottom: Math.round(rect.bottom),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      };
    });
    return {
      position: style.position,
      scrollable: modal.scrollHeight - modal.clientHeight,
      viewport: window.innerHeight,
      buttons,
      actionButtons: buttons.filter((button) =>
        words.some((word) => button.text.includes(word)),
      ),
    };
  }, ACTION_WORDS);

  if (!found) {
    ok(`「${name}」視窗打得開`, false, "畫面上找不到視窗");
    return null;
  }
  if (found.noBar) {
    ok(`「${name}」視窗有動作列`, false);
    return null;
  }
  ok(`「${name}」的動作列是 sticky`, found.position === "sticky", found.position);
  const offscreen = found.buttons.filter(
    (button) => button.bottom > found.viewport || button.width === 0,
  );
  ok(
    `「${name}」捲到最上面時，動作列裡的每一顆按鈕都在畫面內（共 ${found.buttons.length} 顆）`,
    offscreen.length === 0,
    offscreen
      .map((button) => `${button.text}(底=${button.bottom}>${found.viewport})`)
      .join("、"),
  );
  ok(
    `「${name}」的動作列裡確實有取消／確認／關閉類的按鈕`,
    found.actionButtons.length > 0,
    found.buttons.map((button) => button.text).join("｜"),
  );
  await measureContrast(name);
  return found;
}

/**
 * 量這個視窗裡每一段文字的對比（算繪之後的真實顏色）。
 *
 * ⚠️ 底色要**往上找**：元素自己多半是 transparent，真正的底在某個祖先上。
 *   拿 transparent 當白色去算，會得到一個好看但不存在的數字。
 * ⚠️ 半透明的底（rgba 的 a < 1）要**疊在它下面那一層上**再算，
 *   不可以直接當成不透明色。
 */
async function measureContrast(name) {
  const result = await page.evaluate(() => {
    const parse = (value) => {
      const match = String(value).match(
        /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/,
      );
      if (!match) return null;
      return {
        r: +match[1],
        g: +match[2],
        b: +match[3],
        a: match[4] === undefined ? 1 : +match[4],
      };
    };
    const over = (top, bottom) => ({
      r: top.a * top.r + (1 - top.a) * bottom.r,
      g: top.a * top.g + (1 - top.a) * bottom.g,
      b: top.a * top.b + (1 - top.a) * bottom.b,
      a: 1,
    });
    /** 這個元素背後真正的顏色（往上疊，直到湊出不透明的一層）。 */
    const groundOf = (element) => {
      let stack = [];
      for (let node = element; node; node = node.parentElement) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (!colour || colour.a === 0) continue;
        stack.push(colour);
        if (colour.a === 1) break;
      }
      /* 最後保險：都透明的話，以頁面底色當最後一層。 */
      const base =
        parse(getComputedStyle(document.body).backgroundColor) ??
        { r: 255, g: 255, b: 255, a: 1 };
      let ground = stack.length && stack[stack.length - 1].a === 1 ? stack.pop() : base;
      while (stack.length) ground = over(stack.pop(), ground);
      return ground;
    };
    const lin = (value) => {
      const channel = value / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    const modal = document.querySelector(".modal-backdrop .modal");
    if (!modal) return null;
    /*
     * 前置探針：故意塞一段低對比的字進去，量測必須抓到它。
     * ⚠️ 用 inline style，不依賴任何 class——class 可能被別的規則蓋掉，
     *   那樣探針本身就不可靠了。
     */
    const probe = document.createElement("p");
    probe.id = "zz-contrast-probe";
    probe.textContent = "對比探針";
    probe.style.color = "#f2f2f2";
    probe.style.background = "#ffffff";
    modal.appendChild(probe);

    const bad = [];
    let inspected = 0;
    let probeCaught = false;
    for (const node of modal.querySelectorAll("*")) {
      /* 只看真的有自己文字的元素（否則同一段字會被每一層祖先重複量）。 */
      const own = [...node.childNodes].some(
        (child) => child.nodeType === 3 && child.textContent.trim(),
      );
      if (!own) continue;
      if (!node.getClientRects().length) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.opacity === "0") continue;
      /* 停用中的控制項依 WCAG 1.4.3 排除。 */
      if (node.closest(":disabled") || node.disabled) continue;
      const colour = parse(style.color);
      if (!colour) continue;
      const fg = colour.a === 1 ? colour : over(colour, groundOf(node));
      const value = ratio(fg, groundOf(node));
      const size = parseFloat(style.fontSize) || 16;
      const weight = Number(style.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      inspected += 1;
      if (value < need) {
        if (node.id === "zz-contrast-probe") {
          probeCaught = true;
          continue;
        }
        const hex = (c) =>
          "#" +
          [c.r, c.g, c.b]
            .map((v) => Math.round(v).toString(16).padStart(2, "0"))
            .join("");
        bad.push(
          `<${node.tagName.toLowerCase()}${node.className && typeof node.className === "string" ? "." + node.className.split(" ")[0] : ""}>` +
            `「${(node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 18)}」` +
            ` ${hex(fg)} 配 ${hex(groundOf(node))} = ${value.toFixed(2)}:1（需 ${need}）`,
        );
      }
    }
    probe.remove();
    return { bad, inspected, probeCaught };
  });
  if (!result) return;
  ok(
    `「${name}」對比量測的探針有被抓到（否則這一段是恆綠的）`,
    result.probeCaught,
    failOnly("塞進去的低對比探針沒有被判不合格"),
  );
  ok(
    `「${name}」量到了足夠多段文字（共 ${result.inspected} 段）`,
    result.inspected >= 5,
    failOnly(`只量到 ${result.inspected} 段——選擇元素的方式是不是壞了？`),
  );
  ok(
    `「${name}」每一段文字都達 WCAG AA`,
    result.bad.length === 0,
    result.bad.length ? "\n     ・" + result.bad.join("\n     ・") : "",
  );
}

const measured = [];

/* ── 1. 建立計畫 ── */
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
measured.push(await measure("建立計畫"));
await page.locator(".modal-backdrop .modal input").first().fill("動作列守門用計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(900);

/* ── 2. 匯入資料 ── */
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
measured.push(await measure("匯入季度資料"));
await page
  .locator('.modal-backdrop .modal label:has-text("資料季度") input')
  .fill("115Q1");
await page
  .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
  .setInputFiles({
    name: "A00T00-01_動作列測試路口.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook(),
  });
await page.waitForTimeout(4000);

/* ── 3. 匯入預覽（最長的一個） ── */
measured.push(await measure("匯入檢核報告"));
const confirm = page.locator('.modal-backdrop button:has-text("確認")');
if (await confirm.count()) {
  await confirm.first().click();
  await page.waitForTimeout(4500);
}

/* ── 4. 車種設定 ── */
if (await page.locator(".vehicle-class-modal").count()) {
  measured.push(await measure("車種分析設定"));
  await page
    .locator('.vehicle-class-modal button:has-text("套用車種設定")')
    .first()
    .click();
  await page.waitForTimeout(1500);
}

/* ── 5. 路口設定（第二長的一個） ── */
if (await page.locator(".intersection-manager-modal").count()) {
  measured.push(await measure("路口角度與轉向判定"));
  await page
    .locator('.intersection-manager-modal button:has-text("儲存設定")')
    .first()
    .click();
  await page.waitForTimeout(1500);
}

/* ── 6. 其餘打得開的視窗（2026-09-30 #2：對比量測不可以只量得到四個） ──
 *
 * ⚠️ 原本這一支只走到第 5 步，於是十個視窗裡**只量到四個**，
 *   剩下六個的對比從來沒有人量過——而 #2 要的正是「逐一」。
 *   下面把不需要特殊資料就打得開的那幾個補上。
 *
 * ⚠️ 「需要您決定」那一個要有**判定不出來的資料**才會出現，
 *   一般樣本匯入不會觸發它。它由 scripts/e2e-intersection-prompt.mjs
 *   專門負責（那一支就是拿會觸發它的資料在跑），這裡照實記成
 *   「這一支不負責」，不是默默漏掉。
 */
/*
 * ⚠️ 每一個觸發鈕都要先**切到它所在的大分頁**。
 *   X-63 之後別的大分頁的內容**不在 DOM 裡**，不切頁的話四顆全部「找不到」——
 *   第一次跑就是這樣，四條全紅（而程式一點問題都沒有）。
 */
const EXTRA_MODALS = [
  ["路口轉向當量", "card-vehicle-class", 'button:has-text("路口轉向係數")', "取消"],
  ["動態車種管理", "card-vehicle-class", 'button:has-text("車種分類與新增當量")', "取消"],
  ["永久調查點主檔", "card-road-master", 'button:has-text("管理名稱")', "取消"],
  ["報表批次輸出中心", "block-chart-png", '[data-testid="open-export-center"]', "關閉"],
  /*
   * ⚠️ 選擇器要限定在那一塊裡面。`button:has-text("管理計畫")` 會先命中
   *   **側欄**那一顆「建立與管理計畫」（它的文字含有「管理計畫」四個字），
   *   於是點下去只是換頁、沒有視窗出現——第一次跑就是這樣紅的。
   */
  /*
   * ⚠️ 選擇器要限定範圍。`button:has-text("管理計畫")` 會先命中**側欄**那一顆
   *   「建立與管理計畫」（文字含有「管理計畫」四個字），點下去只是換頁；
   *   而它也**不在** #block-projects 裡面——那顆鈕在上方的 .toolbar 上。
   *   兩次都是選擇器選錯人，不是功能壞掉。
   */
  ["計畫管理（修改或刪除）", "block-projects", '.toolbar button:has-text("管理計畫")', "取消"],
];
for (const [name, anchor, opener, closer] of EXTRA_MODALS) {
  /* 先確定畫面上沒有殘留的視窗，否則點不到觸發鈕。 */
  for (let i = 0; i < 3 && (await page.locator(".modal-backdrop").count()); i += 1) {
    await page
      .locator('.modal-backdrop button:has-text("取消"), .modal-backdrop button:has-text("關閉")')
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(400);
  }
  await gotoBlock(page, anchor).catch(() => {});
  await page.waitForTimeout(500);
  const button = page.locator(opener).first();
  if (!(await button.count())) {
    ok(`「${name}」找得到開啟它的按鈕`, false, `找不到 ${opener}`);
    continue;
  }
  await button.click().catch(() => {});
  await page.waitForTimeout(900);
  if (!(await page.locator(".modal-backdrop .modal").count())) {
    ok(`「${name}」視窗打得開`, false, "按了但沒有視窗出現");
    continue;
  }
  measured.push(await measure(name));
  await page
    .locator(`.modal-backdrop button:has-text("${closer}")`)
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(700);
}

const real = measured.filter(Boolean);
/*
 * ⚠️ 這個下限是**照實數出來的**，不是隨手寫的 4。
 *   原始碼裡有 10 個視窗，其中「需要您決定」要**判定不出來的資料**才會出現
 *  （由 e2e-intersection-prompt.mjs 負責，那一支就是拿會觸發它的資料在跑），
 *   所以這一支應該量到 9 個。
 *   量到的數字掉下來就是有視窗打不開了——那要當成問題，不是「剛好沒量到」。
 */
ok("前置：真的量到了幾個視窗", real.length >= 9, `${real.length} 個（原始碼共 ${blocks.length} 個，其中「需要您決定」由另一支負責）`);
/*
 * ⚠️ 這一條是整支的關鍵前置：**至少一個視窗真的長到需要捲**。
 *   全部都捲不動的話，上面每一條都是恆真——修不修都綠。
 */
const scrollers = real.filter((item) => item.scrollable > 40);
ok(
  "前置：至少一個視窗真的長到需要捲（否則上面全部恆真）",
  scrollers.length > 0,
  real.map((item) => `可捲 ${item.scrollable}px`).join("、"),
);

ok("整段沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" | "));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const problem of problems) console.error("  ・" + problem);
  process.exit(1);
}
console.log("\n✅ 每一個視窗的取消／確認／關閉都在畫面內（捲到最上面時）");
