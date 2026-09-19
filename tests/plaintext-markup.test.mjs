/*
 * ══════════════════════════════════════════════════════════════════
 *  純文字介面裡不可以出現 Markdown 記號
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支在守什麼：
 *
 *   `**重點**` 只有在字串**真的會經過 boldParts()** 的時候才會變粗體。
 *   其他地方（window.confirm／alert、toast、title 提示、JSX 裡直接 {line}、
 *   複製到剪貼簿的純文字、塞進 Excel 儲存格的字）都是純文字，
 *   使用者看到的就是原封不動的星號：
 *
 *       ⚠️ 這是尖峰小時的比較，而**各季的尖峰不一定落在同一個小時**（…）
 *
 *   我在 2026-09-11 同時在兩支程式寫出這種字：路口轉向 10 處（confirm／toast），
 *   這一支 1 處（趨勢圖說明——而且它有三個去處：畫面、剪貼簿、Excel，
 *   三個都不吃 markdown）。
 *   這不是打錯字，是「寫說明時腦子裡在用 markdown」的慣性，會一犯再犯，
 *   所以該由測試擋，不該靠記得。
 *
 * ⚠️ 這支與路口轉向那一支的差別：
 *   這支**有** boldParts() 算繪器，chart-notes.ts 的 `**` 是刻意且正確的。
 *   所以這裡不能一律禁止，只能限定在「不會經過 boldParts() 的檔案」。
 *   白名單就是下面那一行 RENDERED，要加檔案進去之前，
 *   先確認那個檔案的字串**每一條**都是餵給 <ChartNoteBox> 或 boldParts()。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

/** 這些檔案的字串會經過 boldParts()，`**` 在裡面是對的。 */
const RENDERED = ["app/chart-notes.ts"];

/**
 * 這些檔案的字串是純文字（畫面直接印、剪貼簿、Excel、confirm／title）。
 *
 * ⚠️ 2026-09-18 大檢查（F-09）：原本只列三個檔，結果 DashboardClient.tsx 的
 *   confirm 訊息、renderInapplicable 的說明、車種組成頁的 JSX 文字、
 *   traffic-parser.ts 的匯入警告都帶著星號原樣印出來（試用版截圖看得到）。
 *   現在改成 **app/ 底下全部** .ts／.tsx，只排除白名單 RENDERED；
 *   DashboardClient.tsx 裡真的會經過 boldParts() 的那幾句列在
 *   DASHBOARD_BOLD_OK（逐句白名單，不是整檔放行）。
 */
const APP_DIR = new URL("../app/", import.meta.url);
const PLAIN = readdirSync(APP_DIR)
  .filter((name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"))
  .map((name) => "app/" + name)
  .filter((rel) => !RENDERED.includes(rel));

/**
 * DashboardClient.tsx 裡**確認過**會經過 boldParts() 的字串（子字串比對）。
 * 要加一句進來之前，先找到它的算繪處是 boldParts()／<ChartNoteBox>。
 *   ・"**"：boldParts() 自己的 split 記號
 *   ・不是預設值：derivedArmNotice → 21480 附近 `boldParts(derivedArmNotice[...])`
 *   ・不同調查點的每小時交通量不會相加／兩條線不會相加：24 小時型態圖的 ChartNote
 */
const DASHBOARD_BOLD_OK = [
  '"**"',
  "**不是預設值**",
  "**不同調查點的每小時交通量不會相加**",
  "**兩條線不會相加**",
];

function read(rel) {
  return readFileSync(new URL("../" + rel, import.meta.url), "utf8");
}

/**
 * 把註解拿掉之後，找出字串字面值裡的 `**`。
 * 刻意不寫成完整 JS 剖析器——做到「註解不算、字串算」就夠，看得懂比聰明重要。
 */
function markupInStrings(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const hits = [];
  const patterns = [/"([^"\\\n]|\\.)*"/g, /'([^'\\\n]|\\.)*'/g, /`([^`\\]|\\.)*`/g];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(stripped))) if (m[0].includes("**")) hits.push(m[0]);
  }
  return hits;
}

test("前置：這個掃描器真的抓得到違規字串（抓不到的話下一項會恆綠）", () => {
  const fake = [
    'notify("⚠️ 這裡會**變粗體**吧？");',
    "const t = `數字會**變**`;",
    "const u = '請按**確認**';",
  ].join("\n");
  assert.equal(markupInStrings(fake).length, 3, "三種引號都要抓到");
  const comment = [
    "/* 這是註解，裡面寫 **重點** 是刻意的 */",
    "// 這行也是註解，**不算**",
  ].join("\n");
  assert.deepEqual(markupInStrings(comment), []);
});

test("前置：白名單檔案真的在用 boldParts（不然白名單就是在放水）", () => {
  const dash = read("app/DashboardClient.tsx");
  assert.match(dash, /function boldParts\(/, "boldParts() 不見了，白名單的前提沒了");
  assert.match(
    dash,
    /note\.lines\.map\([\s\S]{0,200}?boldParts\(line\)/,
    "ChartNoteBox 不再用 boldParts()，chart-notes.ts 的 ** 會變成星號",
  );
  /* 白名單檔案裡真的有 **，這一項才有意義 */
  assert.ok(
    RENDERED.some((f) => markupInStrings(read(f)).length > 0),
    "白名單檔案裡一個 ** 都沒有，那就不需要白名單了——請把它拿掉",
  );
});

test("前置：純文字掃描範圍涵蓋 app/ 全部原始檔（不是挑幾個）", () => {
  assert.ok(PLAIN.includes("app/DashboardClient.tsx"), "DashboardClient.tsx 不在掃描範圍");
  assert.ok(PLAIN.includes("app/traffic-parser.ts"), "traffic-parser.ts 不在掃描範圍");
  assert.ok(PLAIN.includes("app/report-draft.ts"), "report-draft.ts 不在掃描範圍");
  assert.ok(PLAIN.length >= 20, `只掃到 ${PLAIN.length} 個檔，範圍不對`);
});

test("純文字去處的字串不可以留下 Markdown 粗體記號", () => {
  const bad = [];
  for (const file of PLAIN)
    for (const hit of markupInStrings(read(file))) {
      if (
        file === "app/DashboardClient.tsx" &&
        DASHBOARD_BOLD_OK.some((ok) => hit.includes(ok))
      )
        continue;
      bad.push(`${file}｜${hit}`);
    }
  assert.deepEqual(
    bad,
    [],
    "這些字串會原樣把星號印給使用者，請改用「」：\n" + bad.map((b) => "  " + b).join("\n"),
  );
});

test("畫面上直接印出來的字串（不經 boldParts）也不可以有粗體記號", () => {
  const dash = read("app/DashboardClient.tsx");
  /*
   * DashboardClient 同時有兩種：經過 boldParts 的（chart note、預填提示）
   * 與直接 {line} 印出來的（趨勢圖說明）。逐字串分不出來，
   * 所以改成守另一件可以證明的事：
   * 趨勢圖說明那一段**必須**是直接印的，而它的內容來自 trend-script.ts，
   * 上一項已經保證那支沒有 **。這裡只要確認兩者沒有被接錯即可。
   */
  assert.match(
    dash,
    /trendScriptSections\.map\(/,
    "趨勢圖說明的算繪方式變了，這一則守門要重看",
  );
  assert.match(
    dash,
    /buildTrendScript,/,
    "趨勢圖說明不再來自 trend-script.ts，上一則的保證就不成立了",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════
 *  倍率／百分比的句子一定要有主詞
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「『大約剩下原來的 65%』，『原來的』是什麼？正確說明應該是
 *     『假日是平日的 65%』……這類調查報告應該沒有所謂的原來值，
 *     除非是區分施工前、施工後，但最好還是要有主詞……
 *     『A 是 B 的幾 %』主詞要明確，不然會看不懂，是跟誰比才有這倍率。」
 *
 * 這種句子會被**整段複製進報告**，讀的人手上沒有畫面可以對照，
 * 主詞一定要自己帶著。
 *
 * ⚠️ 真正的保證是型別：describeChange()／timesText() 的標籤參數是**必填**，
 *   少給就編譯不過。這一支守的是另一件事：**不要有人在別處又寫一句
 *   「大約是原來的 N 倍」**——那種句子長得和正常的一模一樣，只是少了主詞。
 */
test("倍率句不可以寫成「原來的 N 倍／N%」（沒有主詞）", () => {
  const files = [
    "app/chart-notes.ts",
    "app/trend-script.ts",
    "app/DashboardClient.tsx",
    "app/conclusion.ts",
  ];
  const bad = [];
  for (const file of files) {
    let source;
    try {
      source = read(file);
    } catch {
      continue;
    }
    /* 註解裡引用舊寫法是刻意的（說明為什麼改掉），所以要先去掉註解 */
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const m of stripped.matchAll(/[^\n]{0,40}原來的[^\n]{0,40}/g))
      bad.push(`${file}｜${m[0].trim()}`);
  }
  assert.deepEqual(
    bad,
    [],
    "這些句子沒有主詞，讀的人不知道是跟誰比：\n" +
      bad.map((b) => "  " + b).join("\n"),
  );
});

test("前置：這條掃描抓得到沒有主詞的寫法（不然它是恆真的）", () => {
  const fake = 'const t = `整體上升 100 輛，大約是原來的 2 倍`;';
  const stripped = fake
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  assert.ok(
    [...stripped.matchAll(/原來的/g)].length === 1,
    "掃描抓不到「原來的」，上面那條等於沒做",
  );
});


/*
 * ══════════════════════════════════════════════════════════════════
 *  沒有主詞的比較基準用語，一律不准出現
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11：
 *   「A 比 B 降低／增加 X% 或 X 倍之類，不要寫『比原來』『比以前』
 *     之類不客觀的用詞，會分不清誰跟誰作比較。」
 *
 * 上面那一條只擋了「原來的」。這一條把同一類的說法一起擋掉：
 * 「以前」「先前」「原先」「原本」當**比較基準**時，讀的人手上沒有畫面，
 * 不知道那個基準是哪一季、哪一個路段、還是施工前——句子等於沒有意義。
 *
 * ⚠️ 真正的保證仍然是型別（describeChange()／timesText() 的標籤參數必填）。
 *   這一條守的是「有人在別處又手寫一句」——那種句子長得和正常的一模一樣，
 *   只是少了主詞，程式不會有任何抱怨。
 *
 * ⚠️ 註解裡引用舊寫法是刻意的（說明為什麼改掉），所以要先去掉註解再掃。
 */
const SUBJECTLESS = [
  "原來的",
  "以前的",
  "先前的",
  "原先的",
  "比以前",
  "比先前",
  "比原本",
  "較以前",
  "較先前",
  "較原本",
];

test("比較基準一定要有主詞（不可以寫「比以前」「比原來」這類）", () => {
  const files = [
    "app/chart-notes.ts",
    "app/trend-script.ts",
    "app/DashboardClient.tsx",
    "app/conclusion.ts",];
  const bad = [];
  for (const file of files) {
    let source;
    try {
      source = read(file);
    } catch {
      continue;
    }
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
    for (const word of SUBJECTLESS)
      for (const m of stripped.matchAll(
        new RegExp(`[^\n]{0,40}${word}[^\n]{0,40}`, "g"),
      ))
        bad.push(`${file}｜${word}｜${m[0].trim()}`);
  }
  assert.deepEqual(
    bad,
    [],
    "這些句子沒有主詞，讀的人不知道是跟誰比：\n" + bad.map((b) => "  " + b).join("\n"),
  );
});

test("前置：這條掃描抓得到沒有主詞的寫法（不然它是恆真的）", () => {
  const fake = "const t = `本季比以前少了 12%`;";
  assert.ok(
    SUBJECTLESS.some((word) => fake.includes(word)),
    "掃描字串抓不到「比以前」，上面那條等於沒做",
  );
});
