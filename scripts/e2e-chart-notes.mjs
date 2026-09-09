/*
 * ══════════════════════════════════════════════════════════════════
 *  v20.62 三件新事情的端對端守門
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者交代的三件事，這一支各配一組實測：
 *
 *  ① 「讓使用者一目了然知道資料匯入區、參數設定區、圖表區…各大功能區」
 *     → 五個區段標題存在；頂端導覽固定不動（跳到第五區之後還按得到）；
 *       按下去之後標題**不可以被導覽列蓋住**。
 *
 *  ② 「不管哪個程式，我希望圖旁邊都能有對應的解讀說明」
 *     → 四張圖旁邊各有一段說明；寬螢幕在右側、窄螢幕在下方；
 *       而且說明裡的數字要和畫面上的數字一致（文字與圖分岔最難發現）。
 *
 *  ③ 「檔案匯出不能在圖上留下說明文字」「網頁上說明文字顏色不能被底色遮掩」
 *     → 說明一律在畫布／圖本體之外（不與 canvas 相交）；
 *       全頁按鈕與新增元件的文字對比一律量到 ≥ 4.5:1（WCAG AA）。
 *
 * ⚠️ 每一項都是「量出來的數字」，不是「我看過了」。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

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

await new Promise((r) => server.listen(8112, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1050 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));
await page.goto("http://localhost:8112/");
await page.waitForTimeout(800);
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
await page.locator(".modal-backdrop .modal input").first().fill("說明文字量測");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(700);
for (const [name, quarter] of [
  ["115T1-01_中山路.xlsx", "115Q1"],
  ["115T1-02_中正路口.xlsx", "115Q1"],
]) {
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
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3000);
  }
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(500);
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
}
await page.waitForTimeout(600);

/* ════════════════════════════════════════════════════════════════
 * 一、五大功能區
 * ════════════════════════════════════════════════════════════════ */
console.log("\n══ 一、五大功能區 ══");

const zoneIds = await page.evaluate(() =>
  [...document.querySelectorAll(".zone-heading")].map((el) => el.id),
);
ok(
  "五個功能區標題都在",
  zoneIds.length === 5,
  `實測 ${zoneIds.length} 個：${zoneIds.join("／")}`,
);
const navCount = await page.locator(".section-nav button").count();
ok("頂端區段導覽有五顆按鈕", navCount === 5, `實測 ${navCount} 顆`);

/*
 * 使用者問過的那一題：「跳過去之後，如果我想跳到五，還能按到頂端固定的
 * 區段導覽嗎？」——捲到整頁最底下，導覽必須還黏在視窗上緣。
 */
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(500);
const navAtBottom = await page.evaluate(() => {
  const nav = document.querySelector(".section-nav");
  if (!nav) return null;
  const box = nav.getBoundingClientRect();
  return { top: Math.round(box.top), height: Math.round(box.height) };
});
ok(
  "捲到最底部時區段導覽仍固定在視窗上緣",
  navAtBottom !== null && navAtBottom.top >= -1 && navAtBottom.top <= 2,
  navAtBottom ? `導覽上緣 ${navAtBottom.top}px` : "找不到導覽",
);

/*
 * 每一區按下去之後，標題不可以被固定的導覽列蓋住。
 *
 * ★ 紅字證明（2026-09-08 實跑）：把 .zone-heading 的 scroll-margin-top
 *   拿掉、重新 build:pages 之後再跑同一支腳本，五個區段**全部**紅，
 *   標題上緣落在導覽下緣之上 53px（被整條導覽蓋住）。把 CSS 放回去
 *   重建再跑同一支腳本，五個區段全綠、間距 16～31px。
 *   使用者回報過的「按了畫面留在原地／看不到標題」正是這個。
 */
for (let index = 0; index < zoneIds.length; index += 1) {
  await page.locator(".section-nav button").nth(index).click();
  await page.waitForTimeout(900);
  const measured = await page.evaluate((id) => {
    const nav = document.querySelector(".section-nav");
    const heading = document.getElementById(id);
    if (!nav || !heading) return null;
    const navBox = nav.getBoundingClientRect();
    const headBox = heading.getBoundingClientRect();
    const active = document.querySelector(".section-nav button.active");
    return {
      gap: Math.round(headBox.top - navBox.bottom),
      scrollY: Math.round(window.scrollY),
      headingTop: Math.round(headBox.top),
      navTop: Math.round(navBox.top),
      navBottom: Math.round(navBox.bottom),
      inView: headBox.top >= 0 && headBox.bottom <= window.innerHeight,
      atBottom:
        Math.ceil(window.scrollY + window.innerHeight) >=
        document.documentElement.scrollHeight - 2,
      activeIndex: active
        ? [...document.querySelectorAll(".section-nav button")].indexOf(active)
        : -1,
    };
  }, zoneIds[index]);
  /*
   * 最後一區可能整頁已經捲到底、再也捲不下去，那時標題自然會被推高。
   * 那不是版面錯，所以 atBottom 時只要求「看得到」。
   */
  const passed = measured && (measured.atBottom ? measured.inView : measured.gap >= 0);
  ok(
    `按「${index + 1}」之後 ${zoneIds[index]} 沒有被導覽蓋住`,
    !!passed,
    measured
      ? `標題上緣距導覽下緣 ${measured.gap}px（scrollY=${measured.scrollY}、標題=${measured.headingTop}px、導覽=${measured.navTop}～${measured.navBottom}px）${measured.atBottom ? "（已捲到底）" : ""}`
      : "量不到",
  );
  if (!measured?.atBottom)
    ok(
      `按「${index + 1}」之後高亮跟著換到第 ${index + 1} 顆`,
      measured?.activeIndex === index,
      `實測高亮第 ${(measured?.activeIndex ?? -1) + 1} 顆`,
    );
}

/* ════════════════════════════════════════════════════════════════
 * 二、圖旁邊的說明文字
 * ════════════════════════════════════════════════════════════════ */
console.log("\n══ 二、圖旁邊的說明文字 ══");

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);

const notes = await page.evaluate(() =>
  [...document.querySelectorAll("[data-chart-note]")].map((note) => {
    const panel = note.closest(".panel");
    const heading = panel?.querySelector(".panel-title h3");
    return {
      panel: String(panel?.className || ""),
      heading: (heading?.textContent || "").trim().slice(0, 24),
      paragraphs: note.querySelectorAll("p").length,
      text: (note.textContent || "").replace(/\s+/g, " ").trim(),
    };
  }),
);
ok(
  "四張圖旁邊都有解讀說明",
  notes.length === 4,
  `實測 ${notes.length} 段：${notes.map((n) => n.heading).join("／")}`,
);
for (const note of notes)
  ok(
    `「${note.heading}」的說明有講出內容`,
    note.paragraphs >= 2 && note.text.length >= 40,
    `${note.paragraphs} 段、${note.text.length} 字`,
  );

/*
 * 說明裡的數字必須與畫面上那一份資料一致。
 * 文字與圖分岔的時候，被念出來、被抄進報告的是文字。
 */
const consistency = await page.evaluate(() => {
  const panel = document.querySelector(".panel.composition");
  if (!panel) return null;
  const items = [...panel.querySelectorAll(".composition-list > div")].map(
    (row) => ({
      label: (row.querySelector("span")?.textContent || "").trim(),
      count: Number(
        (row.querySelector("small")?.textContent || "").replace(/[^\d]/g, ""),
      ),
    }),
  );
  const top = items
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)[0];
  const total = Number(
    (panel.querySelector(".donut strong")?.textContent || "").replace(
      /[^\d]/g,
      "",
    ),
  );
  const note = (
    panel.querySelector("[data-chart-note]")?.textContent || ""
  ).replace(/\s+/g, " ");
  return { top, total, note };
});
if (consistency?.top) {
  const totalText = consistency.total.toLocaleString("zh-TW");
  const topText = consistency.top.count.toLocaleString("zh-TW");
  ok(
    "車種組成說明裡的「最多的是…」與畫面上最大的那一項相同",
    consistency.note.includes(consistency.top.label),
    `畫面最大：${consistency.top.label}`,
  );
  ok(
    "車種組成說明裡的輛數與畫面上的數字相同",
    consistency.note.includes(topText),
    `畫面 ${topText} 輛`,
  );
  ok(
    "車種組成說明裡的總量與圓心的數字相同",
    consistency.note.includes(totalText),
    `圓心 ${totalText}`,
  );
}

/* 寬螢幕在右側、窄螢幕自動移到下方——使用者指定的排法。 */
const geometryAt = async (width) => {
  await page.setViewportSize({ width, height: 1050 });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const rows = [];
    for (const wrap of document.querySelectorAll(".chart-with-note")) {
      const main = wrap.querySelector(".chart-with-note-main");
      const note = wrap.querySelector("[data-chart-note]");
      if (!main || !note) continue;
      const m = main.getBoundingClientRect();
      const n = note.getBoundingClientRect();
      if (m.height < 4 || n.height < 4) continue;
      rows.push({
        beside: n.left >= m.right - 2,
        below: n.top >= m.bottom - 2,
        overlapsMain: !(n.left >= m.right - 2 || n.top >= m.bottom - 2),
      });
    }
    return rows;
  });
};
const wide = await geometryAt(1600);
ok(
  "寬螢幕（1600px）四段說明都排在圖的右側",
  wide.length === 4 && wide.every((row) => row.beside),
  `右側 ${wide.filter((r) => r.beside).length}／${wide.length}`,
);
const narrow = await geometryAt(1000);
ok(
  "窄螢幕（1000px）四段說明都自動移到圖的下方",
  narrow.length === 4 && narrow.every((row) => row.below),
  `下方 ${narrow.filter((r) => r.below).length}／${narrow.length}`,
);
await page.setViewportSize({ width: 1500, height: 1050 });
await page.waitForTimeout(500);

/* ════════════════════════════════════════════════════════════════
 * 三、匯出的圖上不可以有說明文字
 * ════════════════════════════════════════════════════════════════ */
console.log("\n══ 三、匯出的圖上不可以有說明文字 ══");

/*
 * 匯出走的是 <canvas> 與 Excel 原生圖表，說明文字是 DOM 的一部分，
 * 本來就不會被帶進去。這裡把「本來就不會」變成量得出來的事實：
 * 任何一段說明都不可以落在畫布或圖本體的範圍內。
 * 有人哪天把說明搬進 .chart-with-note-main，這一項就會紅。
 */
const overlaps = await page.evaluate(() => {
  const hits = [];
  const boxes = [...document.querySelectorAll("canvas, svg.trend-svg")].map(
    (el) => ({ el, box: el.getBoundingClientRect() }),
  );
  for (const note of document.querySelectorAll("[data-chart-note]")) {
    const n = note.getBoundingClientRect();
    if (n.width < 2 || n.height < 2) continue;
    if (note.closest(".chart-with-note-main")) hits.push("說明被放進圖本體裡");
    for (const { box } of boxes) {
      if (box.width < 2 || box.height < 2) continue;
      const intersects =
        n.left < box.right &&
        n.right > box.left &&
        n.top < box.bottom &&
        n.bottom > box.top;
      if (intersects) hits.push(`說明與畫布重疊（${Math.round(box.width)}px）`);
    }
  }
  return hits;
});
ok(
  "說明文字全部落在圖本體與畫布之外",
  overlaps.length === 0,
  overlaps.slice(0, 3).join("；"),
);

/* ════════════════════════════════════════════════════════════════
 * 四、文字不可以被底色蓋住（WCAG AA 4.5:1）
 * ════════════════════════════════════════════════════════════════
 *
 * GPT 複查全日交通量時列出的待辦：「按鈕文字對比量測 ☐ 尚未量」。
 * 這一段就是那一項——量的是**算繪之後的實際顏色**，比對的是第一層
 * 不透明的祖先底色，不是原始碼裡寫了什麼。
 */
console.log("\n══ 四、文字對比（AA 4.5:1）══");

const contrast = await page.evaluate(() => {
  const channel = (value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const parse = (color) => {
    const m = String(color).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(",").map((n) => parseFloat(n));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lum = (c) =>
    0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const backgroundOf = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parse(getComputedStyle(node).backgroundColor);
      if (bg && bg.a >= 0.95) return bg;
      node = node.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  /*
   * 量**整頁**，不是只量這次新增的那幾個元件。GPT 的待辦寫的是
   * 「按鈕文字對比量測 ☐ 尚未量」，只量新元件等於沒回答那一題。
   */
  const targets = [
    ...document.querySelectorAll(".content *, .topbar *, .sidebar *"),
  ];
  const bad = [];
  let measured = 0;
  for (const el of targets) {
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    /* 只量真的有自己文字的節點，否則會量到純容器。 */
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join("");
    if (!own) continue;
    const fg = parse(style.color);
    if (!fg || fg.a < 0.95) continue;
    measured += 1;
    const value = ratio(fg, backgroundOf(el));
    if (value < 4.5)
      bad.push(
        `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 22)}「${own.slice(0, 12)}」${value.toFixed(2)}:1`,
      );
  }
  return { measured, bad };
});
/*
 * ⚠️ 這一項是「這個守門不是空跑」的證明。對比量測最典型的假綠就是
 * 選擇器抓到 0 個元素卻回報全部通過——服務水準那一支踩過一次。
 */
ok(
  "有量到足夠多的文字節點（不是空跑）",
  contrast.measured >= 300,
  `實測 ${contrast.measured} 個節點`,
);
ok(
  "所有量到的文字對比都 ≥ 4.5:1",
  contrast.bad.length === 0,
  contrast.bad.slice(0, 5).join("；"),
);

ok("沒有 JS 例外", errors.length === 0, errors.slice(0, 3).join(" / "));

await browser.close();
server.close();
console.log(
  problems.length
    ? `\n❌ 共 ${problems.length} 項需要處理：\n- ` + problems.join("\n- ")
    : "\n✅ 全部通過",
);
process.exit(problems.length ? 1 : 0);
