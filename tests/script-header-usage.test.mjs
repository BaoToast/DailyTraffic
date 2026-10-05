/*
 * ══════════════════════════════════════════════════════════════════════
 *  腳本檔頭的「用法」必須指向自己（2026-10-05・v20.97 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 起因：`scripts/probe-filter-matrix.mjs` 與 `scripts/e2e-filter-coverage.mjs`
 * 的檔頭**整段是 `scripts/capture-baseline.mjs` 的**——標題寫「升級前後逐格比對
 * 用的數字基準」、`用法` 也寫成 `node scripts/capture-baseline.mjs 升級前`。
 * 兩支檔案實際做的事完全不同（一支是手動探針、一支是掛在 e2e 鏈上的守門）。
 *
 * 為什麼這不是「只是註解」：
 *   這一組系統有一條硬規則「**檔頭註解寫的範圍要與實際一致**」，而它是踩雷才訂的——
 *   曾經有一支守門的檔頭寫「逐頁量」而實際只量一頁，把假的綠包裝成真的綠。
 *   檔頭說它是 A、其實是 B 的時候，下一個人會**照檔頭去跑錯腳本**，
 *   拿錯的輸出當基準，而且不會有任何東西變紅。
 *
 * ⚠️ 這一支刻意迴避的假通過陷阱 ──────────────────────────────
 *
 * 一、**不可以只檢查「有沒有寫用法」**。沒寫的檔很多（大部分腳本不需要），
 *     逼每一支都寫會製造一堆沒意義的樣板。這裡只驗「**寫了的那些要指對**」。
 * 二、**不可以只比檔名字串有沒有出現在檔頭裡**。`e2e-filter-coverage.mjs` 的
 *     用法行寫 `npm run e2e`（正確——它本來就是靠 npm script 跑的），
 *     檔頭裡並不會出現自己的檔名。所以判準是：
 *     **用法行裡如果點名了某一支 `scripts/*.mjs`，那一支必須是自己。**
 * 三、**前置檢查不可以省**。要先確認真的掃到了一定數量的用法行——
 *     正規式一改壞就會抓到 0 行，然後這一支安靜全綠（恆真）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../scripts/", import.meta.url));

/* 只看檔頭（前 60 行）——用法行一定在檔頭，正文裡提到別支腳本是正常的。 */
const HEAD_LINES = 60;

async function collect() {
  const out = [];
  const walk = async (sub) => {
    for (const entry of await readdir(dir + sub, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(sub + entry.name + "/");
        continue;
      }
      if (!entry.name.endsWith(".mjs")) continue;
      const rel = sub + entry.name;
      const text = await readFile(dir + rel, "utf8");
      const head = text.split("\n").slice(0, HEAD_LINES).join("\n");
      out.push({ rel, head });
    }
  };
  await walk("");
  return out;
}

const scripts = await collect();

test("前置：真的掃到腳本，而且其中有一定數量寫了「用法」", () => {
  assert.ok(
    scripts.length >= 40,
    `只掃到 ${scripts.length} 支 scripts/*.mjs——路徑或副檔名判斷改壞了嗎？`,
  );
  const withUsage = scripts.filter((s) => /用法[：:]/.test(s.head));
  assert.ok(
    withUsage.length >= 2,
    `只有 ${withUsage.length} 支檔頭寫了「用法」——正規式改壞了嗎？` +
      "（這一條在防：抓到 0 行之後下面那一支會安靜恆綠）",
  );
});

test("檔頭的「用法」如果點名某一支 scripts/*.mjs，那一支必須是自己", () => {
  const wrong = [];
  for (const { rel, head } of scripts) {
    for (const line of head.split("\n")) {
      if (!/用法[：:]/.test(line)) continue;
      /* 用法行裡點名的每一個 scripts/xxx.mjs */
      for (const m of line.matchAll(/scripts\/([A-Za-z0-9_./-]+\.mjs)/g)) {
        const named = m[1];
        if (named !== rel) {
          wrong.push(`scripts/${rel} 的用法行指向 scripts/${named}`);
        }
      }
    }
  }
  assert.deepEqual(
    wrong,
    [],
    "有腳本的檔頭「用法」指向別支腳本——照它跑會跑錯東西：\n  " +
      wrong.join("\n  "),
  );
});

test("檔頭的方框標題不可以與別支腳本一字不差地相同", () => {
  /*
   * 第二道：用法行改對了，但整段標題還是別人的（這一輪原本就是整段抄）。
   *
   * ⚠️ 取的是**方框標題**——這個專案的檔頭慣例是把標題夾在兩行 `═` 之間：
   *     ══════════…
   *      標題
   *     ══════════…
   *   第一版我取「檔頭第一個有中文的註解行」，結果抓到的是
   *   `e2e-period.mjs` 與 `e2e-report-draft.mjs` 共用的一句**操作備註**
   *   （「匯入路段時系統可能詢問是否沿用既有路段；一律選擇另建」）——
   *   那是兩支都真的需要寫的話，不是抄錯標題。**判準取錯對象就會變成假的紅。**
   */
  const titles = new Map();
  for (const { rel, head } of scripts) {
    const lines = head.split("\n").map((l) => l.replace(/^[\s*/]+/, "").replace(/[\s*/]+$/, ""));
    let title = null;
    for (let i = 1; i < lines.length - 1; i += 1) {
      if (/^═{10,}$/.test(lines[i - 1]) && /^═{10,}$/.test(lines[i + 1]) && lines[i]) {
        title = lines[i];
        break;
      }
    }
    if (!title) continue;
    if (!titles.has(title)) titles.set(title, []);
    titles.get(title).push(rel);
  }
  assert.ok(
    titles.size >= 10,
    `只抓到 ${titles.size} 個方框標題——取法改壞了嗎？（這一條在防恆綠）`,
  );
  const dup = [...titles.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([t, files]) => `「${t}」→ ${files.join("、")}`);
  assert.deepEqual(
    dup,
    [],
    "有兩支以上的腳本方框標題一字不差地相同——通常代表整段抄過去忘了改：\n  " +
      dup.join("\n  "),
  );
});
