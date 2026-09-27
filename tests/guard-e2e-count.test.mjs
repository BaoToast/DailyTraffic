/*
 * ══════════════════════════════════════════════════════════════════════
 *  文件裡的 e2e 支數必須等於 package.json 真正掛了幾支（2026-09-25 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 * 2026-09-24 的複查抓到——實際有 57 支，而
 *   ・PROJECT_HANDOFF.md 寫「再依序跑 56 支」（那是給下一個人照著做的現行規範）
 *   ・VALIDATION_v2.20.71.md 第 174 行寫 57 支，
 *     但**同一份文件**的其他三處寫 56，自己跟自己矛盾
 *
 * 這正是大檢查規則裡「同一件事寫在兩個地方就會漂移，升版時測試項數要重新量過」
 * 那一條。照 56 支驗收的人會以為跑完 56 支就達標。
 *
 * ⚠️ 這一支**不是**掃「有沒有寫 57」這個字面——那樣下一次改版號又要手改。
 *   它是拿 package.json 現場數出來的數字去比對文件，數字自己會跟著走。
 *
 * ⚠️ 反證：把 PROJECT_HANDOFF.md 裡任何一處的 57 改成 56，這一支就會紅。
 *   已驗過（2026-09-25）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** package.json 的 e2e 鏈裡真正掛了幾支腳本。 */
const chained = (pkg.scripts.e2e.match(/node (?:--[\w=-]+ )*scripts\/e2e-[\w.-]+\.mjs/g) || []).length;

/** 磁碟上有幾支 e2e-*.mjs。 */
/*
 * ⚠️ 這一支程式的 e2e 腳本在 `scripts/` 底下，而且磁碟上有兩支**刻意不在
 *   正式 e2e 鏈上**的檔案，必須排除，否則前置檢查會永遠紅：
 *     ・`e2e-nav.mjs`          只匯出共用導覽函式，不是可單獨執行的測試
 *     ・`e2e-tryout-smoke.mjs` 掛在 `npm run e2e:tryout`，不在正式鏈上
 *   ⚠️ 排除清單寫死是刻意的：日後又多一支「不在鏈上」的腳本時，
 *     前置檢查會紅，逼人回答「它為什麼不在鏈上」——那正是要問的問題。
 */
const NOT_IN_CHAIN = new Set(["e2e-nav.mjs", "e2e-tryout-smoke.mjs"]);
const onDisk = readdirSync(join(ROOT, "scripts")).filter(
  (name) =>
    name.startsWith("e2e-") &&
    name.endsWith(".mjs") &&
    !NOT_IN_CHAIN.has(name) &&
    /* ⚠️ 排除 *.test.mjs：守門測試不是 e2e 腳本。
       這一支本來就叫 e2e-count-consistency.test.mjs，結果把自己數進去了
       （實測 57 變 58）——所以檔名改成 guard- 開頭，篩選也一併收緊。 */
    !name.endsWith(".test.mjs"),
).length;

/** 會寫到 e2e 支數的文件。 */
const DOCS = [
  "PROJECT_HANDOFF.md",
  "README.md",
  ...readdirSync(ROOT).filter(
    (name) => name.startsWith("VALIDATION_") && name.endsWith(".md"),
  ),
];

test("⚠️ 前置：e2e 鏈與磁碟上的腳本數要一致（有漏掛或有孤兒都算紅）", () => {
  assert.equal(
    chained,
    onDisk,
    `package.json 的 e2e 鏈掛了 ${chained} 支，磁碟上有 ${onDisk} 支——` +
      `有腳本沒掛進鏈裡（永遠不會跑），或鏈裡指到已經刪掉的檔`,
  );
  assert.ok(chained > 0, "e2e 鏈是空的，這一支就失去意義了");
});

test("文件裡寫的 e2e 支數必須等於 package.json 數出來的", () => {
  const wrong = [];
  for (const name of DOCS) {
    let text;
    try {
      text = readFileSync(join(ROOT, name), "utf8");
    } catch {
      continue; /* 文件不存在就跳過（例如還沒產生 README） */
    }
    /*
     * 抓「N 支」與「N／N」「N/N」三種寫法。
     * 只認緊鄰 e2e／Playwright 字樣的那些，避免誤抓別的數字。
     */
    const patterns = [
      /(\d+)\s*支\s*Playwright/g,
      /Playwright[^\n]{0,20}?(\d+)\s*支/g,
      /(\d+)\s*支依序/g,
      /全部\s*(\d+)\s*支通過/g,
      /E2E[^\n]{0,12}?(\d+)\s*[／/]\s*(\d+)/g,
    ];
    /*
     * ⚠️ 2026-09-26：歷史紀錄要放行，但**只放行標明是歷史的那一種寫法**。
     *
     *   VALIDATION 與 PROJECT_HANDOFF 都是逐版累積的，裡面有「v2.20.74 那一輪
     *   跑了 57 支全綠」這種紀錄——當時是對的。升版加了一支腳本之後，
     *   全檔比對會把那些**正確的歷史紀錄**判成矛盾，那就是一個會誤報的守門。
     *   而把數字改成今天的值等於**偽造當時的紀錄**（這個專案踩過一次）。
     *
     *   放行的條件是那個數字前面明確寫著「當時」：
     *     「當時 57 支全綠」  → 放行（自己講明是歷史）
     *     「57 支全綠」        → 仍然要等於現在的支數
     *   ⚠️ 下面有前置檢查：至少要**真的比對過一個**現行寫法的數字，
     *     否則有人把全部數字都冠上「當時」就等於把這一支關掉。
     */
    /*
     * ⚠️ 逐**行**判斷，而且只放行明確標著「當時」的那一行。
     *   （2026-09-26：原本是全檔比對，升版加一支腳本之後會把正確的歷史紀錄
     *   判成矛盾——那是會誤報的守門；而把歷史數字改成今天的值等於偽造紀錄。）
     * ⚠️ 下面有前置檢查：至少要真的比對過一行現行寫法，
     *   否則把每一行都冠上「當時」就等於把這一支關掉。
     */
    let checked = 0;
    for (const line of text.split("\n")) {
      if (line.includes("當時")) continue; /* 這一行自己講明是歷史紀錄 */
      for (const pattern of patterns)
        for (const m of line.matchAll(pattern))
          for (const raw of m.slice(1)) {
            if (raw === undefined) continue;
            checked += 1;
            if (Number(raw) !== chained)
              wrong.push(`${name}：寫「${raw}」，實際是 ${chained}`);
          }
    }
    if (name === "PROJECT_HANDOFF.md")
      assert.ok(
        checked > 0,
        "PROJECT_HANDOFF.md 裡一個現行寫法的 e2e 支數都沒有比對到——" +
          "是不是全部都被冠上「當時」了？那等於把這一支守門關掉",
      );
  }
  assert.deepEqual(
    wrong,
    [],
    "文件裡的 e2e 支數與 package.json 不一致：\n  " + wrong.join("\n  "),
  );
});

/*
 * ⚠️ 2026-09-25 第五輪獨立複查：這一支原本的樣式是
 *     /(\d+)\s*支(?:\s*Playwright|依序|腳本|通過)/
 *   也就是「支」後面一定要接那四種字。實際漏掉的寫法：
 *     「全套 e2e（**54 支**）與單元測試（251 條）全綠。」
 *   ——「支」後面接的是全角右括號，整條看不到。
 *
 * 修法**不是**把樣式放寬到全檔就好：VALIDATION 是逐版累積的，
 * 歷史小節裡的 54／56 當時都是對的，全檔比對會把正確的歷史紀錄判成矛盾
 * （那就是一個會誤報的守門，比沒有守門更糟）。
 *
 * 所以改成兩段：
 *   ① 只在**本版那一節**（第一個 `## v<本版版號>` 到下一個 `## v` 之間）
 *      用**寬鬆**樣式 `(\d+) 支`，任何寫法都抓得到；
 *   ② 全檔仍用原本的窄樣式做「跨節同時出現兩個數字」的檢查。
 */
test("⚠️ 同一份文件內部不可以自己矛盾（VALIDATION 曾經同時寫 56 與 57）", () => {
  for (const name of DOCS.filter((n) => n.startsWith("VALIDATION_"))) {
    const text = readFileSync(join(ROOT, name), "utf8");

    /*
     * ── ① 本版那一節：寬鬆樣式，但只看**講 e2e 的那幾行** ──
     *
     * ⚠️ 2026-09-26 修兩處：
     *   一、段落的結尾原本抓「下一個 `## v…`」，而中間的 `## ★ …` 小節標題
     *     不符合那個樣式，於是「本版那一節」會一路吃進下面好幾節。
     *     改成抓**下一個 `## ` 標題**（不管它後面接什麼）。
     *   二、寬鬆樣式原本抓整節的每一個「N 支」，於是單元測試的
     *     「383 支」與 e2e 的「57 支」會被判成自己矛盾——那兩個本來就是
     *     不同的東西。改成只看同一行裡提到 e2e／E2E／Playwright 的那幾行。
     * ⚠️ 標明「當時」的歷史紀錄放行（理由同上面那一支）。
     */
    const headings = [...text.matchAll(/^##\s*v[\d.]+/gm)];
    assert.ok(
      headings.length > 0,
      `${name} 裡抓不到任何 "## v…" 版本段落標題——這一支會變成恆真`,
    );
    const from = headings[0].index ?? 0;
    const nextHeading = [...text.matchAll(/^##\s/gm)].find(
      (m) => (m.index ?? 0) > from,
    );
    const to = nextHeading?.index ?? text.length;
    const section = text.slice(from, to);
    const loose = new Set();
    for (const line of section.split("\n")) {
      if (line.includes("當時")) continue;
      if (!/e2e|E2E|Playwright/.test(line)) continue;
      for (const m of line.matchAll(/(\d+)\s*支/g)) loose.add(m[1]);
    }
    assert.ok(
      loose.size <= 1,
      `${name} 的本版段落同時寫了 ${[...loose].join("、")} 支 e2e——` +
        `同一節自己矛盾，讀的人不知道該相信哪一個`,
    );
    for (const raw of loose)
      assert.equal(
        Number(raw),
        chained,
        `${name} 的本版段落寫「${raw} 支 e2e」，而 package.json 數出來是 ${chained}`,
      );

    /* ── ② 全檔：原本的窄樣式（標明「當時」的歷史節不誤傷） ── */
    const found = new Set();
    for (const line of text.split("\n")) {
      if (line.includes("當時")) continue;
      for (const m of line.matchAll(/(\d+)\s*支(?:\s*Playwright|依序|腳本|通過)/g))
        found.add(m[1]);
    }
    assert.ok(
      found.size <= 1,
      `${name} 同時寫了 ${[...found].join("、")} 支——` +
        `同一份文件自己矛盾，讀的人不知道該相信哪一個`,
    );
  }
});
