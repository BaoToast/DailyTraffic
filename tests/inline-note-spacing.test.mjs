/*
 * ══════════════════════════════════════════════════════════════════════
 *  className 寫了，樣式表卻一條規則都沒有
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-10-05（附線上 v20.97 截圖）：
 *   「這張截圖下方的文字"還沒有任何計畫"幾乎與邊緣方框處黏在一起了」
 *
 * ── 成因 ──────────────────────────────────────────────────────
 *
 * `.inline-note` 在 DashboardClient.tsx 用了五次，而**樣式表裡一條規則都沒有**
 * ——globals.css 0 處、建置後的 assets 也 0 處。Tailwind 的 preflight 會把
 * <p> 的預設 margin 歸零，於是這幾句話沒有內距也沒有外距，直接貼著容器的
 * 左邊線與下邊線。使用者截到的是其中一句，實際有四句（第五句另外掛了
 * .project-load-error，那個 class 有自己完整的規則，所以沒事）。
 *
 * ⚠️ 這一類錯和 button-class 那一支守的是同一種病：**不會壞、不會報錯、
 *   不會少功能**，文字看得到、意思也對，只是版面不成樣子。任何「這句話在
 *   不在」的測試都會過。全檔 288 個 class 裡只有這一個是真的出問題，
 *   靠肉眼逐個看是不可靠的。
 *
 * ⚠️ 這一支是**靜態**檢查（讀原始碼），刻意不去跑瀏覽器：很多 class 要
 *   特定資料或特定視窗才畫得出來，跑瀏覽器量不到的就等於沒驗。
 *   畫面上真正的間距由 scripts/e2e-class-coverage.mjs 的空狀態守門量。
 *
 * ⚠️ 解析一律走 TypeScript 的語法樹，**不用正規式**：2026-10-05 才踩過
 *   release-metadata 用正規式刪註解、被字串裡的 /* 騙掉一個 test() 的坑。
 *   CSS 那邊也不是 regex 刪註解，是一個會認字串的字元掃描器。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import postcss from "postcss";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const TSX = join(ROOT, "app", "DashboardClient.tsx");
const CSS = join(ROOT, "app", "globals.css");

/*
 * 這幾個 class 是**故意**沒有自己的規則的，每一筆都要寫出樣式從哪裡來。
 * ⚠️ 這份清單不是垃圾桶：判準③會檢查裡面每一個名稱都還真的在用，
 *   不然刪掉的 class 會一直留在這裡，清單會慢慢變成一張免死金牌。
 */
const INTENTIONALLY_UNSTYLED = new Map([
  ["geometry-legend", "SVG 的 <g>，純粹分組；看得見的樣式在子元素 .geometry-legend-text"],
  ["pending-quarter", "<label>，樣式來自元素選擇器 .modal label（display:grid;gap:4px）"],
  ["pending-quarter-changed", "<small>，間距來自父層 .modal label 的 grid gap"],
  ["from-content", "<small>，同上，間距來自父層 label 的 grid gap"],
  ["period-date-mixed", "<p>，樣式來自 .workflow-warning p；這個名字是給 data-testid 配對用的"],
]);

/* ── CSS：認字串的註解掃描器（不是 regex） ───────────────────── */
function stripCssComments(src, maskStrings = false) {
  let out = "";
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      out += maskStrings ? " " : c;
      if (c === "\\") { out += maskStrings ? " " : (src[i + 1] ?? ""); i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += maskStrings ? " " : c; i += 1; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const cssSource = readFileSync(CSS, "utf8");
const css = stripCssComments(cssSource);

/* CSS宣告值或屬性選擇器字串中的 .class 不是class規則。只讀實際rule的selector。 */
const selectorCache = new Map();
function selectorsIn(text) {
  if (!selectorCache.has(text)) {
    const selectors = [];
    postcss.parse(text).walkRules((rule) => selectors.push(stripCssComments(rule.selector, true)));
    selectorCache.set(text, selectors);
  }
  return selectorCache.get(text);
}
function hasRule(cls, text) {
  const needle = "." + cls;
  for (const selector of selectorsIn(text)) {
    let from = 0;
    for (;;) {
      const at = selector.indexOf(needle, from);
      if (at === -1) break;
      const next = selector[at + needle.length];
      if (next === undefined || !/[A-Za-z0-9_-]/.test(next)) return true;
      from = at + 1;
    }
  }
  return false;
}

function assertPanelSpacing(text, label) {
  const rules = [];
  postcss.parse(text).walkRules((rule) => rules.push(rule));
  const find = (selector) => rules.findIndex((rule) => rule.selector.replace(/\s+/g, "") === selector);
  const base = find(".inline-note");
  const panel = find(".panel>.inline-note");
  const error = find(".project-load-error");
  assert.ok(base !== -1 && panel !== -1 && error !== -1, `${label}：三條必要規則必須存在`);
  const padding = rules[panel].nodes.find((node) => node.type === "decl" && node.prop === "padding");
  assert.ok(padding, `${label}：.panel>.inline-note沒有padding`);
  const sides = padding.value.trim().split(/\s+/);
  assert.ok(sides.length === 3 || sides.length === 4, `${label}：padding須明列3或4個值`);
  for (const [side, value] of [["右", sides[1]], ["下", sides[2]], ["左", sides[3] ?? sides[1]]]) {
    assert.ok(/^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) >= 12,
      `${label}：${side}內距${value}不足12px或不是可驗證的px單位`);
  }
  assert.ok(base < error && panel < error, `${label}：間距規則須排在錯誤提示規則之前`);
}

/* ── TSX：用語法樹取出每一個 className 上的 class ─────────────── */
const tsxSource = readFileSync(TSX, "utf8");
const file = ts.createSourceFile(TSX, tsxSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
if (file.parseDiagnostics?.length) throw new Error(`DashboardClient.tsx 解析失敗（${file.parseDiagnostics.length} 筆）`);

const elements = []; /* 每個 className 屬性一筆：{ line, classes: [...] } */
function literalsIn(node, bag) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) bag.push(node.text);
  else if (ts.isTemplateExpression(node)) {
    bag.push(node.head.text);
    for (const span of node.templateSpans) bag.push(span.literal.text);
  }
  ts.forEachChild(node, (child) => literalsIn(child, bag));
}
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(file) === "className" && node.initializer) {
    const bag = [];
    literalsIn(node.initializer, bag);
    const classes = [];
    for (const piece of bag)
      for (const token of piece.split(/\s+/))
        if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) classes.push(token);
    if (classes.length)
      elements.push({
        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
        classes,
      });
  }
  ts.forEachChild(node, visit);
}
visit(file);

const allClasses = new Set(elements.flatMap((e) => e.classes));
const styledClasses = [...allClasses].filter((c) => hasRule(c, css));

test("前置：真的用語法樹掃到 className，而且大多數 class 在樣式表裡找得到規則", () => {
  assert.equal(hasRule("zz-probe", ':root{--fake:".zz-probe"}[data-x=".zz-probe"]{color:red}'), false);
  assert.equal(hasRule("zz-probe", '@media(min-width:1px){.zz-probe{color:red}}'), true);
  assert.ok(
    allClasses.size >= 200,
    `只掃到 ${allClasses.size} 個 class——className 的寫法改了，還是語法樹走錯了？`,
  );
  assert.ok(
    styledClasses.length >= 150,
    `只有 ${styledClasses.length} 個 class 在 globals.css 找得到規則——` +
      "樣式表的讀法壞了的話，下面兩項會變成恆紅，那和恆綠一樣沒用。",
  );
});

test("每一個元素的 className 裡至少要有一個 class 在樣式表裡有規則", () => {
  const bad = [];
  for (const el of elements) {
    if (el.classes.some((c) => hasRule(c, css))) continue;
    if (el.classes.every((c) => INTENTIONALLY_UNSTYLED.has(c))) continue;
    bad.push(`第 ${el.line} 行：className="${el.classes.join(" ")}"`);
  }
  assert.deepEqual(
    bad,
    [],
    "這些元素掛的 class 在 globals.css 裡一條規則都沒有——" +
      "Tailwind preflight 會把預設邊距歸零，於是它們會貼著容器的邊線。\n" +
      "確定是刻意不給樣式的話，寫進 INTENTIONALLY_UNSTYLED 並說明樣式從哪裡來：\n  " +
      bad.join("\n  "),
  );
});

test("INTENTIONALLY_UNSTYLED 裡的每一個名稱都要還在用，而且確實沒有規則", () => {
  const stale = [];
  for (const [cls, why] of INTENTIONALLY_UNSTYLED) {
    if (!allClasses.has(cls)) stale.push(`${cls}：已經沒有人用了，從清單移掉`);
    else if (hasRule(cls, css)) stale.push(`${cls}：現在樣式表裡有規則了，從清單移掉`);
    else if (!why || why.length < 10) stale.push(`${cls}：沒有寫清楚樣式從哪裡來`);
  }
  assert.deepEqual(stale, [], "免死金牌清單要跟著現況走：\n  " + stale.join("\n  "));
});

test("面板裡的 .inline-note 要有左右內距與下內距，而且 .project-load-error 不可以被它蓋掉", () => {
  assertPanelSpacing(css, "globals.css");
});

test("建置出來的樣式表也要有這兩條（改了原始碼卻沒重建資產一樣是壞的）", () => {
  const dir = join(ROOT, "assets");
  if (!existsSync(dir)) return; /* 原始碼包沒有建置產物時不適用 */
  const sheets = readdirSync(dir).filter((f) => f.endsWith(".css"));
  assert.ok(sheets.length >= 1, "assets/ 裡找不到任何 .css——建置產物不完整");
  const bad = [];
  for (const name of sheets) {
    const built = stripCssComments(readFileSync(join(dir, name), "utf8"));
    try { assertPanelSpacing(built, name); }
    catch (error) { bad.push(error.message); }
  }
  assert.deepEqual(bad, [], "線上吃的是這份建置產物，不是 globals.css：\n  " + bad.join("\n  "));
});
