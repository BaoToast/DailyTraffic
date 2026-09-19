/*
 * 探針（不是守門測試）：參數設定頁的「套用季別／套用路段」到底長什麼樣子。
 *
 * 使用者 2026-09-11：
 *   「參數設定 套用季別 全季別 和套用路段 也全面是白色的，與背景色相融
 *     完全沒發現這裡可以設定 季別/路段」
 *
 * 這支只做「量」，不做判定——量完把數字印出來，人看。
 *   ① 兩個 <select> 與它們的 <label> 文字的實際顏色／背景／框線
 *   ② .pcu-settings 五個子元素的實際座標（格線有沒有被排錯）
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "../chrome-path.mjs";
import { TABS, gotoTab } from "../e2e-nav.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "github-pages", "dist");
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
await new Promise((r) => server.listen(8177, r));

const browser = await chromium.launch(launchOptions());
const context = await browser.newContext({
  viewport: { width: 1536, height: 712 },
  locale: "zh-TW",
});
const page = await context.newPage();
page.on("dialog", (d) => d.accept(""));
await page.goto("http://localhost:8177/");
await page.waitForTimeout(1200);

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
await page
  .locator(".modal-backdrop .modal input")
  .first()
  .fill("CSS 探針計畫");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);

await gotoTab(page, TABS.settings);
await page.waitForTimeout(400);

const report = await page.evaluate(() => {
  const out = { picker: null, children: [], missingRules: [] };
  const picker = document.querySelector(".factor-scope-picker");
  if (picker) {
    const rect = picker.getBoundingClientRect();
    const cs = getComputedStyle(picker);
    const labels = [...picker.querySelectorAll("label")].map((l) => {
      const ls = getComputedStyle(l);
      const sel = l.querySelector("select");
      const ss = sel ? getComputedStyle(sel) : null;
      return {
        text: (l.childNodes[0]?.textContent || "").trim(),
        labelColor: ls.color,
        labelFont: ls.fontSize + "/" + ls.fontWeight,
        labelDisplay: ls.display,
        selectColor: ss?.color,
        selectBg: ss?.backgroundColor,
        selectBorder: ss?.borderTopWidth + " " + ss?.borderTopColor,
        selectAppearance: ss?.appearance,
        selectRect: sel
          ? (() => {
              const r = sel.getBoundingClientRect();
              return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
            })()
          : null,
      };
    });
    out.picker = {
      display: cs.display,
      rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      gridColumn: cs.gridColumnStart + "/" + cs.gridColumnEnd,
      labels,
    };
  }
  const panel = document.querySelector(".pcu-settings");
  if (panel) {
    const ps = getComputedStyle(panel);
    out.panelTemplate = ps.gridTemplateColumns;
    out.panelBg = ps.backgroundColor;
    out.children = [...panel.children].map((c) => {
      const r = c.getBoundingClientRect();
      return `${c.className || c.tagName} → ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
    });
  }
  /* 這些 class 有沒有任何一條 CSS 規則？ */
  const wanted = [
    "factor-scope-panel",
    "factor-scope-picker",
    "factor-scope-state",
    "factor-scope-summary",
    "factor-scope-conflict",
    "factor-scope-note",
    "search-hint",
    "search-hint-empty",
  ];
  const found = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.selectorText)
          for (const w of wanted)
            if (rule.selectorText.includes("." + w)) found.add(w);
        if (rule.cssRules) walk(rule.cssRules);
      }
    };
    walk(rules);
  }
  out.missingRules = wanted.filter((w) => !found.has(w));
  return out;
});

console.log(JSON.stringify(report, null, 2));
await page.screenshot({
  path: join(here, "probe-factor-scope.png"),
  fullPage: false,
});
await browser.close();
server.close();
