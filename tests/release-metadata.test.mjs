/*
 * 發布中繼資料的一致性檢查。
 *
 * 起因：外部檢查在姊妹專案裡發現同一個發布包有三種版本號
 * （package.json、package-lock.json、程式畫面各一個）。版本號是判斷
 * 「使用者手上是哪一版」的唯一依據，不一致會讓回報的問題對不到程式碼。
 * 這一支把它們釘在一起，改了其中一個而忘了其他的，測試就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const readJson = async (name) =>
  JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));

/*
 * 版號的唯一來源是 app/system-release.ts。這裡刻意用讀檔＋正規表示式
 * 而不是 import，因為這支測試要驗的正是「那個檔案裡寫的字面值」——
 * 用 import 的話，萬一有人把它改成從別處算出來的值，這個檢查就失去意義。
 */
const systemVersion = async () => {
  const source = await readFile(
    new URL("../app/system-release.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(/export const SYSTEM_VERSION = "(v[\d.]+)"/);
  assert.ok(match, "app/system-release.ts 裡找不到 SYSTEM_VERSION");
  return match[1];
};

/*
 * 畫面左下角印的更新日期。與上面同一個理由：讀字面值，不用 import。
 */
const systemUpdatedAt = async () => {
  const source = await readFile(
    new URL("../app/system-release.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /export const SYSTEM_UPDATED_AT = "(\d{4}-\d{2}-\d{2})"/,
  );
  assert.ok(match, "app/system-release.ts 裡找不到 SYSTEM_UPDATED_AT");
  return match[1];
};

test("package.json 與 package-lock.json 的版本號和程式顯示的一致", async () => {
  const version = await systemVersion();
  /* 畫面版本是 v20.21，npm 需要三段式，所以比對時補上 .0 */
  const expected = version.replace(/^v/, "") + ".0";
  const pkg = await readJson("package.json");
  const lock = await readJson("package-lock.json");
  assert.equal(pkg.version, expected, "package.json 版本號和程式不一致");
  assert.equal(lock.version, expected, "package-lock.json 版本號和程式不一致");
  assert.equal(lock.packages?.[""]?.version, expected, "lock packages[''] 不一致");
});

test("畫面上的手冊連結檔名帶著目前版本", async () => {
  const version = await systemVersion();
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.includes(`全日交通流量程式手冊_${version}.pdf`),
    "手冊 PDF 連結沒有跟著版本更新",
  );
  /*
   * 手冊自 v20.65 起**只出 PDF**。
   *
   * 使用者 2026-09-11：「新手手冊只需要做 PDF 檔就好……三個程式都同步，
   * 只需要 PDF 檔就好。」路口轉向在 v2.1.64 就已經因為同一句話改掉，
   * 這一支是最後一個還在出 Word 的。
   *
   * ⚠️ 這條反面守門不可以省。Word 版的產生器與檔案都刪掉了，
   *   只刪不守的話，下一次照舊版樣板補回一顆按鈕，就會連到一個
   *   **不存在的檔案**——而畫面上那顆按鈕看起來完全正常，
   *   使用者要按下去才會看到 404。
   */
  assert.doesNotMatch(
    source,
    /全日交通流量程式手冊_[^"'`]*\.docx/,
    "畫面上又出現 Word 手冊連結，但本專案不再產生 .docx，點下去會 404",
  );
});

/*
 * 手冊裡一定要有「本版」的更新說明。
 *
 * 這一支是踩到坑才補的：我升版時用字串取代把新的更新說明插進 manual.html，
 * 但比對的字串對不上（那個位置的 class 已經換過），replace 靜靜地什麼都沒做，
 * 而且沒有任何檢查會失敗。結果連續三版（v20.23／24／25）的更新說明
 * **完全沒有進到手冊裡**，手冊卻照樣產生、版號也照樣對得上。
 *
 * 所以這裡不只檢查「手冊裡有這個版號」（標題與版本戳記本來就有，
 * 那樣檢查等於沒檢查），而是檢查**更新說明區塊的標題**帶著目前版號。
 */
test("手冊裡有本版的更新說明區塊", async () => {
  const version = await systemVersion();
  const updatedAt = await systemUpdatedAt();
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  /*
   * v20.42 起，手冊不再收錄「每一版改了什麼」——那是維護紀錄不是操作說明，
   * 使用者明確表示新手不需要看（見 tests/manual-version-log.test.mjs 的說明）。
   * 這一支原本靠「本版（vX）更新內容」確認手冊真的重新產生過；
   * 改用封面戳記當錨點，同樣擋得住「只改檔名、內容還是舊版」。
   */
  const stamp = manual.match(/系統版本：(v[\d.]+)　更新日期：(\d{4}-\d{2}-\d{2})/);
  assert.ok(stamp, "manual.html 找不到「系統版本：vX　更新日期：YYYY-MM-DD」封面戳記");
  assert.equal(
    stamp[1],
    version,
    `manual.html 封面戳記寫 ${stamp[1]}，程式是 ${version}——升版時可能只改了檔名，忘了重新產生手冊。`,
  );
  /*
   * ⚠️ 日期也要比，而且比的是**畫面上真的印出來的那一個**
   *   （app/system-release.ts 的 SYSTEM_UPDATED_AT，見 DashboardClient
   *   左下角的 `{SYSTEM_VERSION}・{SYSTEM_UPDATED_AT}`）。
   *
   *   2026-09-20 大檢查實際抓到：v20.80 交付包的畫面寫
   *   `v20.80・2026-09-18`，手冊封面戳記卻寫 `2026-09-19`，
   *   PROJECT_HANDOFF 又說是 2026-09-19、發布摘要說 2026-09-20——
   *   同一件事四個地方三個答案。上面那一行**只比版號**，所以全綠。
   *
   *   PROJECT_HANDOFF 自己的「重複出現的缺陷類型」就列著
   *   「畫面版號與手冊／驗證檔名不同」，姊妹專案路口轉向在
   *   tests/release-structure.test.mjs 早就連日期一起釘了，這一支漏了。
   *
   *   使用者照手冊判斷「我手上這份是不是最新的」，兩個日期對不起來時
   *   他無從判斷該信哪一個——這正是這一類文件缺陷真正的代價。
   */
  assert.equal(
    stamp[2],
    updatedAt,
    `manual.html 封面戳記的更新日期是 ${stamp[2]}，但畫面上印的是 ${updatedAt}` +
      `（app/system-release.ts 的 SYSTEM_UPDATED_AT）——兩個日期必須是同一個。`,
  );
});

test("GitHub Pages 根目錄建置產物與目前版本一致", async () => {
  const version = await systemVersion();
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const match = index.match(/\.\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  assert.ok(match, "根目錄 index.html 找不到主程式資產");
  assert.ok(
    index.includes(`?v=${version.replace(/^v/, "")}`),
    "根目錄 index.html 的快取參數沒有跟著版本更新",
  );
  const asset = await readFile(
    new URL(`../assets/${match[1]}`, import.meta.url),
    "utf8",
  );
  assert.ok(
    asset.includes(version),
    `根目錄建置產物不含 ${version}，可能仍是舊版網站`,
  );
  assert.ok(
    asset.includes("period-display-toggle"),
    "根目錄建置產物不含本版的期別顯示切換功能",
  );

  /*
   * ══════════════════════════════════════════════════════════════════════
   *  標記字串：**不依賴 mtime**，在任何環境都有效（2026-09-25）
   * ══════════════════════════════════════════════════════════════════════
   *
   * ⚠️ 下面那一支「根目錄的建置產物不可以比原始碼舊」是靠 mtime 比的，
   *   而 `actions/checkout` 會把整棵樹的 mtime 設成同一刻，
   *   所以它在 **CI 裡永遠走「剛 checkout」那條跳過分支**——
   *   而 CI 正是唯一會自動跑的地方。那等於這條規則在最需要它的場合不存在。
   *   （2026-09-25 F6 第三輪抓到；`github-pages/dist` 不在交付包裡，
   *   所以沒辦法像姊妹系統路口轉向那樣「與最後一次建置逐位元比對」。）
   *
   * 作法：**正反兩面**都驗。
   *   ・本版新增的使用者可見字串**必須**在 bundle 裡；
   *   ・本版已經刪掉的舊字串**不可以**在 bundle 裡。
   * 反面那一半是關鍵：光驗「新字串在不在」，一個剛好也含那些字串的舊 bundle
   * 照樣會過（例如只改了其中一項就重建過一次）。
   *
   * ⚠️ 期望值寫在這裡是刻意的：它們是**這一版的指紋**，升版時要跟著換，
   *   換的時候就會被迫回答「這一版新增／刪掉了哪些使用者看得到的字」。
   *   不可以改成從原始碼自動抽——自動抽就永遠會相符，等於恆真。
   */
  const cssMatch = index.match(/\.\/assets\/(index-[A-Za-z0-9_-]+\.css)/);
  assert.ok(cssMatch, "根目錄 index.html 找不到樣式資產");
  const css = await readFile(
    new URL(`../assets/${cssMatch[1]}`, import.meta.url),
    "utf8",
  );
  const bundle = asset + "\n" + css;

  const MUST_HAVE = [
    /* v20.85：分區抬頭改成從 PAGE_ZONES 推出來的全名 */
    "建立與匯入",
    /* v20.84：K43 遮罩 */
    "待設定 PCU 係數",
    /* v20.84：K42／K44 新異常 */
    "平假日涵蓋不一致",
    "調查涵蓋無法判斷",
    /* v20.83：格距異常 */
    "調查格距混用",
  ];
  const MUST_NOT_HAVE = [
    /* v20.85 刪掉的舊區名（2026-09-10 的寫法） */
    "一 資料匯入",
  ];

  const missing = MUST_HAVE.filter((text) => !bundle.includes(text));
  assert.deepEqual(
    missing,
    [],
    "根目錄的建置產物少了本版該有的字串，代表它不是這一份程式建出來的：\n  " +
      missing.join("、") +
      "\n請執行 npm run build:pages 並把 github-pages/dist 同步到根目錄",
  );
  const leftover = MUST_NOT_HAVE.filter((text) => bundle.includes(text));
  assert.deepEqual(
    leftover,
    [],
    "根目錄的建置產物還含有本版已經刪掉的字串，代表它是舊的建置：\n  " +
      leftover.join("、"),
  );
  /* 前置檢查：bundle 真的讀到了，不是空字串讓上面兩條都恆真。 */
  assert.ok(bundle.length > 100_000, `bundle 只有 ${bundle.length} 字，讀錯檔了嗎？`);
});

test("驗證報告檔名與目前版本一致，不得殘留舊版", async () => {
  const version = await systemVersion();
  const expected = `VALIDATION_${version}.md`;
  const rootFiles = await readdir(new URL("../", import.meta.url));
  const reports = rootFiles.filter((name) => /^VALIDATION_v[\d.]+\.md$/.test(name));
  assert.deepEqual(reports, [expected]);
  const report = await readFile(new URL(`../${expected}`, import.meta.url), "utf8");
  assert.match(
    report,
    new RegExp(`^# 全日交通量及車種組成 ${version.replace(/\./g, "\\.")} 驗證報告`, "m"),
    "驗證報告檔名雖正確，但標題仍是舊版",
  );
  /*
   * 「前一正式版」是字面值，每次發布都要手改一次；忘了改就會指到兩版前，
   * 看報告的人會拿錯的基準去比對。這裡不寫死是哪一版，只要求：
   *   ・這一行必須存在
   *   ・它指的版本**不可以是本版自己**（那代表根本忘了改）
   *   ・必須帶 commit，否則沒辦法回頭核對
   */
  const prev = report.match(/前一正式版：(v[\d.]+)[^\n]*commit `([0-9a-f]{40})`/);
  assert.ok(prev, "驗證報告缺少「前一正式版：vX（commit …）」這一行");
  assert.notEqual(prev[1], version, "「前一正式版」還寫著本版版號——升版時忘了改");
});

/*
 * 「如何更新」段落必須跟著版本走。
 *
 * 這一支是踩到坑才補的：那一段從 v20.35 起就沒再改過，v20.36～v20.38
 * 三次發布都照原樣交出去。照那份說明操作的人會拿**錯的版號**去確認部署
 * 有沒有成功，而且列出的「本版網站資產」是三版前的檔名——依它刪檔會
 * 刪錯，依它保留會留下一堆已經不用的舊資產。
 */
test("更新說明的「如何更新」段落沒有殘留舊版號與舊資產檔名", async () => {
  const version = await systemVersion();
  const notes = await readFile(
    new URL("../【更新說明】請先讀我.txt", import.meta.url),
    "utf8",
  );
  const section = notes.slice(notes.indexOf("如何更新"));
  assert.notEqual(notes.indexOf("如何更新"), -1, "找不到「如何更新」段落");

  /*
   * 版號：只有本版、**前一正式版**，以及同一行明講「沒有發布」的那幾個。
   *
   * ⚠️ 2026-09-25 收緊（F6 第三輪抓到）：原本只要寫成「舊版 vX.Y 」就放行，
   *   於是 `舊版 v20.84` 通過了檢查——**而 v20.84 從來沒有發布**，
   *   線上還在的是 v20.81。結果這條守門祝福了一份會讓人得到「假通過」的
   *   部署驗證清單：去查三個從未上線的檔名，當然回 404。
   *   現在「上一版」必須就是驗證報告開頭那一行寫的前一正式版。
   */
  const report = await readFile(
    new URL(`../VALIDATION_${version}.md`, import.meta.url),
    "utf8",
  );
  const previous = report.match(/前一正式版：(v[\d.]+)/)?.[1];
  assert.ok(
    previous,
    `VALIDATION_${version}.md 開頭沒有寫「前一正式版：vX.Y」——` +
      "那一行是「上一版是哪一版」的唯一來源，這一支靠它判斷",
  );
  assert.notEqual(previous, version, "前一正式版不可以等於本版");
  assert.ok(
    section.includes(`・網站顯示 ${version}`),
    `「如何更新」必須要求確認網站顯示 ${version}，不可還寫前一版`,
  );

  /*
   * ⚠️ 例外：**明講「沒有發布」的那幾個版號可以出現**。
   *   這一段本來就該告訴使用者「v20.82～v20.84 都沒有發布過，線上不會有它們的檔案」，
   *   否則他會拿一個未發布的版號當部署驗證的基準。
   *   判準是**同一行裡有「沒有發布／未發布／從未發布」**，不是整段放行。
   */
  const neverReleased = new Set();
  for (const line of section.split("\n")) {
    if (!/沒有發布|未發布|從未發布/.test(line)) continue;
    for (const m of line.matchAll(/v(\d+\.\d+(?:\.\d+)?)/g)) neverReleased.add("v" + m[1]);
    /* 「v20.82～v20.84」這種區間寫法要把中間的也算進去。 */
    const range = /v(\d+)\.(\d+)\s*[～~\-到至]\s*v?(\d+)\.(\d+)/.exec(line);
    if (range && range[1] === range[3])
      for (let n = Number(range[2]); n <= Number(range[4]); n += 1)
        neverReleased.add(`v${range[1]}.${n}`);
  }

  const versions = [...new Set([...section.matchAll(/v(\d+\.\d+(?:\.\d+)?)/g)].map((m) => "v" + m[1]))];
  const unexpected = versions.filter(
    (v) => v !== version && v !== previous && !neverReleased.has(v),
  );
  assert.deepEqual(
    unexpected,
    [],
    `「如何更新」段落只能出現本版（${version}）、前一正式版（${previous}），` +
      "以及同一行明講「沒有發布」的那幾個；" +
      `多出來的是：${unexpected.join("、")}——` +
      "寫一個從未發布的版號當基準，照著驗會得到假通過",
  );

  /*
   * ⚠️ 上面那一條是「不可以出現別的版號」，但它擋不住
   *   「基準那一行寫了未發布的版號，而別的地方剛好也寫了『那幾版沒有發布』」
   *   ——那時候未發布的版號會被例外放行。所以再加一條**正面**斷言：
   *   「回傳 404」那幾行裡，必須真的出現前一正式版。
   *   部署驗證的基準只能是**線上目前還在的那一版**。
   */
  const notFoundLines = section
    .split("\n")
    .filter((line) => /404/.test(line))
    .join("\n");
  assert.ok(notFoundLines.length > 0, "「如何更新」段落裡找不到任何「回傳 404」的驗證項目");
  assert.ok(
    notFoundLines.includes(previous),
    `「回傳 404」那幾行沒有提到前一正式版（${previous}）——` +
      "部署驗證的基準必須是線上目前還在的那一版，" +
      "否則去查一個從未上線的檔名當然回 404，你會得到假通過",
  );

  /* 資產檔名：要與實際建置產物一致 */
  const listed = section
    .slice(section.indexOf("本版網站資產："))
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_.-]+\.(js|css)$/.test(line));
  /*
   * 讀根目錄的 assets/（那就是要部署上去的那一份，也是交付包裡有的），
   * 不能讀 github-pages/dist——它不在交付包裡。
   */
  const actual = (await readdir(new URL("../assets", import.meta.url))).sort();
  assert.ok(listed.length > 0, "「本版網站資產」清單是空的");
  assert.deepEqual(listed.sort(), actual, "列出的資產檔名與實際建置產物不一致");
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  更新說明裡寫出來的 SHA-256 必須真的是那個檔案的（2026-09-24）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-24 F6 獨立複查抓到：更新說明宣告手冊 SHA-256 是
 * `faf9d25c…`，實際檔案是 `44bec3c6…`。
 *
 * ⚠️ 上面那一支抓不到的原因：它只比對**檔名**，而且只認 `.js|.css`——
 *   雜湊值它從頭到尾沒有算過，手冊也不在它的比對範圍裡。
 *   雜湊寫錯的後果不是小事：它是使用者（與複查者）唯一能確認
 *   「我手上這一份就是你說的那一份」的依據。對不上時，正確的檔案
 *   會被當成被動過，而真的被動過的檔案反而沒人驗得出來。
 *
 * 守法：把更新說明裡每一行「檔名 ＋ 下一行 SHA-256 = …」抓出來，
 * 在包裡找到那個檔案，**實際重算**一次雜湊比對。
 */
test("更新說明裡寫出來的每一個 SHA-256 都要與實際檔案相符", async () => {
  const root = new URL("../", import.meta.url);
  const notes = await readFile(
    new URL("【更新說明】請先讀我.txt", root),
    "utf8",
  );
  /*
   * 「本版…資產：」或「本版手冊：」底下的：檔名一行、SHA-256 一行。
   *
   * ⚠️ 2026-09-25 第五輪獨立複查抓到：這一條的配對樣式原本是
   *   `SHA-256 = ([0-9a-f]{64})`——**只認小寫、而且只認恰好 64 碼**。
   *   雜湊寫成大寫、或少寫一碼，那一組就**根本不會被配成一對**，
   *   於是它不會被驗、也不會被報成錯，安靜地通過。
   *   而前置檢查（≥4 組、至少一組 .pdf）在剩下幾組還在的情況下照樣成立。
   *
   *   ⚠️ 更糟的是：`VALIDATION_v20.85.md` 當時已經寫了「已改成大小寫都認並
   *   統一小寫比對，另加格式檢查」——**而實際上沒有改**。那是假的證據。
   *
   *   現在的做法（兩層）：
   *     ① 配對樣式吃 `[0-9a-fA-F]+`（長度不限），比對前統一轉小寫；
   *     ② 另外加一條**格式檢查**：每一個 `SHA-256 = ` 後面都必須是
   *        恰好 64 個十六進位字元——寫錯長度會被指名，不是被略過。
   */
  const pairs = [
    ...notes.matchAll(
      /^[ \t]*([A-Za-z0-9_.一-鿿-]+\.(?:js|css|pdf))[ \t]*\n[ \t]*SHA-256[ \t]*=[ \t]*([0-9a-fA-F]+)[ \t]*$/gm,
    ),
  ].map((m) => ({ name: m[1], hash: m[2].toLowerCase() }));

  /* ② 格式檢查：任何一個 SHA-256 = 後面都必須是恰好 64 個十六進位字元。 */
  const badFormat = [
    ...notes.matchAll(/^[ \t]*SHA-256[ \t]*=[ \t]*(\S*)[ \t]*$/gm),
  ]
    .map((m) => m[1])
    .filter((value) => !/^[0-9a-fA-F]{64}$/.test(value));
  assert.deepEqual(
    badFormat,
    [],
    "更新說明裡有 SHA-256 不是「恰好 64 個十六進位字元」——"
      + "寫錯長度或夾雜其他字元時，配對樣式會整組略過而不報錯：\n  "
      + badFormat.join("\n  "),
  );

  /* 前置檢查：真的抓到了，否則格式一改這一支就安靜地變成恆真。 */
  assert.ok(
    pairs.length >= 4,
    `只抓到 ${pairs.length} 組「檔名＋SHA-256」——更新說明的寫法改了嗎？` +
      "這一支靠「檔名一行、SHA-256 = 一行」的格式認人",
  );
  assert.ok(
    pairs.some((pair) => pair.name.endsWith(".pdf")),
    "沒有抓到手冊那一組——手冊的雜湊正是 2026-09-24 寫錯的那一個",
  );

  /* 檔案可能在 assets/ 或 manuals/，兩處都找。 */
  const { createHash } = await import("node:crypto");
  const wrong = [];
  for (const { name, hash } of pairs) {
    let found = null;
    for (const dir of ["assets/", "manuals/", ""]) {
      const url = new URL(dir + name, root);
      try {
        found = await readFile(url);
        break;
      } catch {
        /* 換下一個目錄找 */
      }
    }
    if (!found) {
      wrong.push(`${name}：包裡找不到這個檔案`);
      continue;
    }
    const real = createHash("sha256").update(found).digest("hex");
    if (real !== hash)
      wrong.push(`${name}：更新說明寫 ${hash.slice(0, 8)}…，實際是 ${real.slice(0, 8)}…`);
  }
  assert.deepEqual(
    wrong,
    [],
    "更新說明宣告的 SHA-256 與實際檔案不符：\n  " + wrong.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  同一個版號不可以出現兩段（2026-09-24）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-24 F6 抓到：`【更新說明】` 與 `VALIDATION_*.md` 各有兩則都叫
 * v20.83（09-23 與 09-24，內容完全不同）。使用者拿到一包時無法判斷是哪一份。
 * 路口轉向已有同一條守門（tests/release-structure.test.mjs），這裡補上。
 *
 * ⚠️ 範圍刻意只收**標題裡帶日期**的段落（`v20.84（2026-09-24）…`）。
 *   這是 v20.79 起才定下來的寫法；更早的歷史用的是
 *   `v20.35-1`／`v20.35-2`（同一版分多則）與「（其二）」「另補一項」，
 *   那些是同一批的多則，不是兩份不同內容。把它們一起收進來只會迫使
 *   我去改寫歷史紀錄——而改寫歷史正是這一條守門要防的那件事的反面。
 *
 * ⚠️ 標題裡寫「續」或「發布後」的也排除：那是同一版的延續，或同一版
 *   **發布之後**的複查（例如 v20.81 有 09-20 的開發紀錄與 09-23 的發布後複查），
 *   兩者都不是「兩份不同內容的建置」。
 */
test("更新說明與驗證報告都不可以有兩段共用同一個版號", async () => {
  const version = await systemVersion();
  /*
   * ⚠️ 2026-09-25 修兩件（F6 第三輪）：
   *   ① 兩條正規式**形狀原本不對稱**：VALIDATION 那條允許版號與日期之間有字，
   *     更新說明那條要求日期**緊貼**版號。於是
   *     `■ v20.86 重點（2026-09-26）` 這種寫法在更新說明裡完全不被計次，
   *     而前置檢查因為還有 9 個舊標題而照樣通過 → 新撞號漏掉且不報。
   *     兩條現在同形狀。
   *   ② 原本**不含 `README.md`**，而 v20.85 的版號正名也沒套到 README，
   *     於是 `v20.83` 在同一個交付包裡又同時指兩件事。README 一併納入。
   */
  const dated = (prefix) =>
    new RegExp(
      "^" + prefix + "\\s*v([\\d.]+(?:-\\d+)?)[^（\\n]*（(\\d{4}-\\d{2}-\\d{2})）[^\\n]*",
      "gm",
    );
  const sources = [
    ["【更新說明】請先讀我.txt", dated("■")],
    [`VALIDATION_${version}.md`, dated("##\\s+")],
    ["README.md", dated("##\\s+")],
  ];
  for (const [name, pattern] of sources) {
    const text = await readFile(new URL("../" + name, import.meta.url), "utf8");
    /*
     * ⚠️ 2026-09-25 補正：第一版比的是「兩段的**標題字串**不同」，
     *   而標題只抓到版號＋日期括號，後面的敘述不在 match 裡——於是同一個
     *   版號＋同一個日期的兩段（內容完全不同）會被當成同一則，**一個都不會報**。
     *   姊妹系統交通服務水準就是這樣讓一組真的撞號漏過去的（F6 第三輪抓到）。
     *   現在改成**計次**，不比字串。
     */
    const seen = new Map();
    for (const match of text.matchAll(pattern)) {
      if (/續|發布後/.test(match[0])) continue;
      const key = match[1];
      seen.set(key, (seen.get(key) || 0) + 1);
    }
    const dup = [...seen]
      .filter(([, n]) => n > 1)
      .map(([version, n]) => `v${version}（${n} 段）`);
    /* 前置檢查：真的抓到了，否則標題寫法一改這一支就安靜變成恆真。 */
    assert.ok(
      seen.size >= 4,
      `${name} 只抓到 ${seen.size} 個帶日期的版本段落標題——標題寫法改了嗎？`,
    );
    assert.ok(
      seen.has(version.replace(/^v/, "")),
      `${name} 抓不到本版（${version}）的段落標題`,
    );
    assert.deepEqual(
      dup,
      [],
      `${name} 有兩段共用同一個版號：${dup.join("；")}——` +
        "同一個版號兩份不同內容，複查時分不出使用者手上是哪一包",
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  根目錄的建置產物不可以比原始碼舊（2026-09-24）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-24 的 F6 獨立複查抓到：交付包裡根目錄的 `assets/index-*.js`
 * 是 13:38 建的，而 `app/DashboardClient.tsx`、`app/final-workflow.ts`、
 * `app/period-analysis.ts` 是 15:10–15:29 才改的。
 * `.github/workflows/ci.yml` 自己寫著「**它直接把 repository 根目錄當成網站**」，
 * 所以線上那一份會是「版號寫 v20.84、但本版新功能一個都沒有」。
 *
 * ⚠️ 為什麼既有的測試抓不到：
 *   ・版號字串在舊 bundle 裡照樣有（它上一版就有了），所以比對版號會過；
 *   ・`npm run e2e` **每次都自己重新建置**才跑，所以 e2e 驗的一直是最新原始碼，
 *     根目錄那一份從頭到尾沒有人看。
 *   這就是為什麼一定要有 F6 那種「只拿打包好的檔案」的獨立複查。
 *
 * 守法：根目錄主資產的修改時間，必須**不早於**任何一個會進 bundle 的原始檔。
 */
test("根目錄的建置產物不可以比原始碼舊", async () => {
  /*
   * ⚠️ 2026-09-25 補正（這一支原本會在**正確的包**上紅）：
   *   把交付 zip 解開之後，整棵樹的 mtime 全部是解壓那一刻，而解壓是照 zip 裡的
   *   順序一個一個寫的，所以 `assets/` 先寫、`app/` 後寫，差幾十毫秒就紅。
   *   使用者或複查者在自己電腦上解開這一包跑 `npm test`，看到的就是那個紅。
   *   **在正確的包上會紅的守門比沒有守門更糟**：它會讓人開始忽略紅字。
   *
   *   作法：先判斷 mtime 在這個環境裡有沒有攜帶資訊——資產與全部原始碼的 mtime
   *   整體跨距小於 120 秒，就是剛解壓／剛 checkout 的樹，這時**跳過比較並明講**
   *   （不是安靜過去）。真要抓的那一種差距是數十分鐘到數小時
   *   （實際抓到那次是 1 小時 30 分），120 秒一個都不會放過。
   *
   *   ⚠️ 這一支沒有 mtime 之外的替代檢查：n82 的 `github-pages/dist` **不在交付包裡**
   *   （它被排除了），所以沒有「最後一次建置的產出」可以比。路口轉向的包裡有
   *   `github-pages-dist/`，那一支因此另外加了一條不依賴 mtime 的同步檢查。
   *   這個差異是刻意的，不是漏做。
   */
  const { stat, readdir } = await import("node:fs/promises");
  const root = new URL("../", import.meta.url);
  const index = await readFile(new URL("index.html", root), "utf8");
  const match = index.match(/\.\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  assert.ok(match, "根目錄 index.html 找不到主程式資產");
  const assetTime = (await stat(new URL(`assets/${match[1]}`, root))).mtimeMs;

  /*
   * 會被打包進去的原始碼。
   * ⚠️ 2026-09-25 補上三類（F6 第三輪抓到，原本只掃 app/ 的 .ts/.tsx）：
   *   ・`app/globals.css`（169 KB，由 app/layout.tsx 與 github-pages/src/main.tsx
   *     import，會編成 assets/index-*.css）——**CSS 產物的 mtime 原本從來沒被比過**；
   *   ・`app/traffic-data.json`（337 KB，由 DashboardClient.tsx import，直接進 JS bundle）；
   *   ・`github-pages/src/*.tsx`（Pages 版的進入點，原本完全不在掃描範圍）。
   *   只改這三類之一就忘了重建的話，這一支原本照樣綠，而線上樣式／進入點是舊的。
   */
  const sources = [];
  const dir = new URL("app/", root);
  for (const name of await readdir(dir)) {
    if (!/\.(ts|tsx|css|json)$/.test(name)) continue;
    const info = await stat(new URL(name, dir));
    if (info.isFile()) sources.push({ name: `app/${name}`, mtimeMs: info.mtimeMs });
  }
  const pagesDir = new URL("github-pages/src/", root);
  for (const name of await readdir(pagesDir)) {
    if (!/\.(ts|tsx|css)$/.test(name)) continue;
    const info = await stat(new URL(name, pagesDir));
    if (info.isFile())
      sources.push({ name: `github-pages/src/${name}`, mtimeMs: info.mtimeMs });
  }
  /* 前置檢查：三類都真的掃到了，否則目錄改名後這一支會安靜地少守一塊。 */
  assert.ok(sources.length >= 8, `只掃到 ${sources.length} 個原始碼檔——目錄結構改了嗎？`);
  for (const must of ["app/globals.css", "app/traffic-data.json"])
    assert.ok(
      sources.some((item) => item.name === must),
      `掃描範圍裡沒有 ${must}——它會進 bundle，漏掉它就等於少守一塊`,
    );
  assert.ok(
    sources.some((item) => item.name.startsWith("github-pages/src/")),
    "掃描範圍裡沒有 github-pages/src/——那是 Pages 版的進入點",
  );

  /* ⚠️ CSS 產物也要比：它與 JS 是兩個獨立的產物，可以一新一舊。 */
  const cssName = index.match(/\.\/assets\/(index-[A-Za-z0-9_-]+\.css)/)?.[1];
  assert.ok(cssName, "根目錄 index.html 找不到樣式資產");
  const cssTime = (await stat(new URL(`assets/${cssName}`, root))).mtimeMs;

  /*
   * ── 內容相同就不算過期（2026-09-26 新增）──────────────────────
   *
   * ⚠️ 2026-09-26 的複查踩到一次**假的紅**：改了一個 `.tsx` 之後 JS 產物換了
   *   新雜湊、CSS 產物的內容**與新建置逐位元相同**（因為它本來就沒變），
   *   但檔案時間還停在上一次交付那一天，於是 `oldestAsset` 取到舊的 CSS 時間，
   *   整支就紅了——而根目錄那一份其實是正確的。
   *   要讓它變綠只能把一個位元都沒變的檔案複製一次來更新時間，
   *   那是在**應付守門**，不是在修問題。
   *
   * ⚠️ 修法不是放寬比較，而是換一個帶資訊的判準：vite 的檔名帶內容雜湊，
   *   所以只要 `github-pages/dist/assets/` 裡有**同名**的檔案而且內容相同，
   *   根目錄那一份就一定是那一次建置的產出，時間戳只是複製順序的副產物。
   *   這時把那個產物排除在時間比較之外。
   * ⚠️ `github-pages/dist` **不在交付包裡**，所以拿不到證據時（目錄不存在、
   *   或同名檔案不存在）一律**回到原本的時間比較**，不可以因為「拿不到證據」
   *   就放行——那會把這一條變成恆真。
   * ⚠️ 刻意不改成「內容不同就紅」：那需要在測試裡重建一次，而重建的環境
   *   與 `npm run build:pages` 不一定一致，會製造另一種假訊號。
   */
  const { readFile: readBytes } = await import("node:fs/promises");
  const { existsSync: exists } = await import("node:fs");
  const sameAsLastBuild = async (name) => {
    const built = new URL(`github-pages/dist/assets/${name}`, root);
    if (!exists(built)) return false;
    try {
      const [a, b] = await Promise.all([
        readBytes(new URL(`assets/${name}`, root)),
        readBytes(built),
      ]);
      return a.equals(b);
    } catch {
      return false;
    }
  };
  const jsCurrent = await sameAsLastBuild(match[1]);
  const cssCurrent = await sameAsLastBuild(cssName);
  if (jsCurrent || cssCurrent)
    console.error(
      `  ℹ️ 與最後一次建置逐位元相同、時間戳不列入比較：` +
        [jsCurrent ? match[1] : null, cssCurrent ? cssName : null]
          .filter(Boolean)
          .join("、"),
    );
  const assetTimesInPlay = [
    jsCurrent ? null : assetTime,
    cssCurrent ? null : cssTime,
  ].filter((value) => value !== null);
  /*
   * 兩個產物都已證明是最後一次建置的產出 → 這一條沒有東西要比，
   * 而且**已經有比它更強的證據**（逐位元相同）。明講一聲再結束。
   */
  if (!assetTimesInPlay.length) {
    console.error(
      "  ℹ️ 主程式與樣式兩個產物都與最後一次建置逐位元相同，" +
        "不需要再比 mtime（逐位元相同是比時間更強的證據）。",
    );
    return;
  }
  const oldestInPlay = Math.min(...assetTimesInPlay);

  const times = [...assetTimesInPlay, ...sources.map((item) => item.mtimeMs)];
  const spreadMs = Math.max(...times) - Math.min(...times);
  if (spreadMs < 120_000) {
    /* ⚠️ 一定要印出來。安靜跳過就等於把這一條悄悄關掉。 */
    console.error(
      `  \u2139\ufe0f 整棵樹的 mtime 跨距只有 ${Math.round(spreadMs)} 毫秒，` +
        "判定為剛解壓／剛 checkout 的樹——mtime 在這裡不帶先後資訊，跳過新舊比較。",
    );
    return;
  }

  const stale = sources
    .filter((item) => item.mtimeMs > oldestInPlay)
    .map((item) => `${item.name}（${new Date(item.mtimeMs).toISOString()}）`);
  assert.deepEqual(
    stale,
    [],
    `這些原始碼比根目錄的建置產物（還在比較範圍內的那幾個裡較舊的一個，` +
      `${new Date(oldestInPlay).toISOString()}）新，` +
      `代表發布出去的網站不是目前這份程式。請執行 npm run build:pages，` +
      `把 github-pages/dist 的 index.html 與 assets 同步到根目錄（刪掉舊雜湊的檔案）、` +
      `補回 ?v= 快取參數，並更新「更新說明」的資產清單與 SHA-256：\n  ${stale.join("\n  ")}`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  未發布候選版的區間與數量必須自己算得出來（2026-09-25 第六輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 第六輪抓到：`【更新說明】` 與 `PROJECT_HANDOFF` 寫「v20.82～v20.86 **五個**
 * 候選都沒有發布」，而 `VALIDATION_v20.88.md` 開頭寫「v20.82～v20.85 **四個**」。
 * 同一件事三份文件兩個答案，而讀的人只會看到其中一份——
 * 而且 `VALIDATION` 正是複查者拿來當基準的那一份。
 * 姊妹系統交通服務水準同一天抓到一模一樣的一件。
 *
 * 這個數字**算得出來**：最後一個正式發布版是 v20.81，本版是 v20.87，
 * 所以未發布候選是 .82 ～（本版 patch − 1），數量＝該區間的長度。
 * 既然算得出來，就不可以讓它用手打。
 *
 * ⚠️ 兩條分工（姊妹系統的第一版只寫了前者，**反證沒有變紅**）：
 *   ① 每一句「.82～.N 共 M 個」自己要自洽——抓打錯；
 *   ② 三份「講現在是什麼狀態」的文件，各自都必須有一句把區間寫到**本版前一版**
 *      ——抓「整句停在舊版本」。①自洽而②不成立，正是這次那個缺陷的形狀。
 */
test("未發布候選版的區間與數量，三份現況文件都要寫到本版前一版", async () => {
  const { existsSync } = await import("node:fs");
  /*
   * ⚠️ 2026-09-27：**基準線動了**。GPT 已把 v20.88 正式發布上線。
   *   要分成兩個常數，不可以只改一個：
   *     RANGE_BASE    ——「v20.82～.N 共 M 個」這種**歷史句子**的算術基準，永遠是 81。
   *                      一起改掉會讓所有正確的歷史句子變紅。
   *     LAST_RELEASED ——**現在**最後一個真的發布出去的版本。現況敘述靠它。
   *   前一版就是正式發布版時，根本沒有未發布候選區間，
   *   這時要求的是「寫明前一正式版是哪一版」。
   */
  const RANGE_BASE = 81;
  /*
   * ⚠️ 2026-10-03：**基準線又動了**。GPT 已把 v20.94 正式發布上線
   *   （commit 1d385b4144b1bb3275f19017c22c16151da45faa，CI／Pages 皆 success），
   *   但 v20.94 那一包**沒有把這個常數跟著移**，還留在 89。
   *   後果正是這一支自己 2026-09-29 那段註解警告過的事：
   *   它會要求現況文件寫出「v20.90～.94 共 5 個候選未發布」——
   *   **而 .94 是真的發布了**，守門逼著文件去寫一句假話。
   *   這一條是 Claude 2026-10-03 第二次複查時抓到並移正的。
   */
  const LAST_RELEASED = 94;
  const CJK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const patch = Number(String(pkg.version).split(".")[1]);
  const wantTo = patch - 1;
  /*
   * ⚠️ 2026-09-29：現況句的區間要從 **LAST_RELEASED + 1** 起算，不是從 .82。
   *
   *   2026-09-27 那一版只拆了兩個常數，現況句卻還是要求
   *   「v20.82～.N 共 (N − 81) 個」。到了這一輪（LAST_RELEASED = 89、
   *   本版 .91、未發布的只有 .90 一個）那句話會變成
   *   「v20.82～.90 共 9 個候選未發布」——**而 .88 與 .89 是真的發布上線了**。
   *   守門逼著文件去寫一句假話，那比沒有守門更糟。
   *
   *   正確的算法：未發布候選＝(LAST_RELEASED + 1) ～ (本版 patch − 1)。
   *   RANGE_BASE 留著不動，它是**歷史句子**的算術基準，改它會讓正確的歷史句子變紅。
   */
  const currentFrom = LAST_RELEASED + 1;
  const wantCount = wantTo - LAST_RELEASED;
  /*
   * ⚠️ 2026-10-03：這一行**原本擺在這裡，而且斷言 wantCount >= 1**。
   *   那與下面「if (LAST_RELEASED >= wantTo)」那條分支互相矛盾——
   *   那條分支正是為了「前一版就是正式發布版、沒有未發布候選區間」而寫的
   *   （見上面 2026-09-27 的註解），而那個情況算出來的 wantCount 必然 <= 0。
   *   於是只要基準線追上本版的前一版（這一輪就是：LAST_RELEASED = 94、本版 .95），
   *   這一支會先死在這一行，**永遠走不到那條分支**。
   *   修法：把「版號解析壞了嗎」這個前置檢查往下移，只在真的有區間時才驗。
   *   ⚠️ 不可以改成 >= 0 就算了——那會讓「解析壞掉算出負數」靜靜通過。
   */

  const FILES = [
    "README.md",
    `VALIDATION_v20.${patch}.md`,
    "PROJECT_HANDOFF.md",
    "【更新說明】請先讀我.txt",
  ];
  const current = new Set();
  let seen = 0;
  for (const name of FILES) {
    const url = new URL(`../${name}`, import.meta.url);
    if (!existsSync(url)) continue;
    const text = await readFile(url, "utf8");
    for (const m of text.matchAll(
      /v20\.82\s*[～~]\s*(?:v20)?\.?(\d+)[^。\n]{0,10}?([0-9一二三四五六七八九十]+)\s*個候選/g,
    )) {
      const to = Number(m[1]);
      const count = CJK[m[2]] ?? Number(m[2]);
      seen += 1;
      assert.equal(
        count,
        to - RANGE_BASE,
        `${name} 寫「v20.82～.${to} ${m[2]}個候選」，該區間實際是 ${to - RANGE_BASE} 個`,
      );
      if (to === wantTo) current.add(name);
    }
  }
  /* 前置檢查：真的掃到句子，不是格式改掉之後安靜恆真。 */
  assert.ok(seen >= 2, `只抓到 ${seen} 句「v20.82～… N 個候選」——寫法改了嗎？`);

  if (LAST_RELEASED >= wantTo) {
    /*
     * 這條分支的前置檢查：基準線不可以**超過**本版的前一版。
     * 超過＝基準線寫到還沒發布的版本，或版號解析壞了，兩種都要紅。
     */
    assert.equal(
      LAST_RELEASED,
      wantTo,
      `LAST_RELEASED = ${LAST_RELEASED} 超過本版的前一版 ${wantTo}——` +
        "基準線寫到還沒發布的版本了嗎？",
    );
    /* ⚠️ 一定要印出來，安靜跳過就等於把這一條悄悄關掉。 */
    console.error(
      `  ℹ️ v20.${LAST_RELEASED} 已正式發布，本版直接建在它之上，` +
        "沒有「未發布候選區間」可寫——改成要求現況文件寫明前一正式版是哪一版。",
    );
    for (const name of ["PROJECT_HANDOFF.md", `VALIDATION_v20.${patch}.md`]) {
      const url = new URL(`../${name}`, import.meta.url);
      if (!existsSync(url)) continue;
      const text = await readFile(url, "utf8");
      assert.ok(
        new RegExp(`前一正式版[：:]\\s*\`?v20\\.${LAST_RELEASED}\`?`).test(text),
        `${name} 要寫明「前一正式版：v20.${LAST_RELEASED}」——` +
          "現況文件要講清楚這一包是建在哪一個已發布版本之上",
      );
    }
    return;
  }
  /*
   * ⚠️ 現況句的區間是 (LAST_RELEASED + 1) ～ (本版 patch − 1)。
   *   只有一個候選時區間退化成單一版號，所以兩種寫法都收：
   *   「v20.90～.90 共 1 個」與「v20.90 一個候選未發布」。
   *   逼人為了滿足守門去寫「.90～.90」這種怪句子，是本末倒置。
   */
  assert.ok(wantCount >= 1, `算出來的未發布候選數是 ${wantCount}，版號解析壞了嗎？`);
  const single = currentFrom === wantTo;
  const pattern = single
    ? new RegExp(`v20\\.${wantTo}[^。\n]{0,12}?([0-9一二三四五六七八九十]+)\\s*個候選`)
    : new RegExp(
        `v20\\.${currentFrom}\\s*[～~]\\s*(?:v20)?\\.?${wantTo}[^。\n]{0,10}?([0-9一二三四五六七八九十]+)\\s*個候選`,
      );
  for (const name of ["PROJECT_HANDOFF.md", `VALIDATION_v20.${patch}.md`]) {
    const url = new URL(`../${name}`, import.meta.url);
    if (!existsSync(url)) continue;
    const hit = (await readFile(url, "utf8")).match(pattern);
    const count = hit ? (CJK[hit[1]] ?? Number(hit[1])) : null;
    assert.ok(
      Boolean(hit),
      `${name} 沒有任何一句寫出現在真的未發布的候選` +
        `（v20.${currentFrom}${single ? "" : `～.${wantTo}`}，共 ${wantCount} 個）。` +
        "這一份講的是「目前狀態」，要寫出現在有哪幾個候選還沒發布",
    );
    assert.equal(
      count,
      wantCount,
      `${name} 寫 ${hit[1]} 個候選未發布，實際是 ${wantCount} 個`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  驗證報告寫的手冊頁數／字元數，在有 pdftotext 的環境裡當場重算
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 2026-09-25 第六輪新增（三支同一條）。姊妹系統交通服務水準的報告曾經寫過
 *   「27 頁 / 20,878 字元（NFKC 後）」，而那個字數**用任何一種算法都重現不出來**
 *   （raw 21,428、NFKC 21,442、NFKC 去空白 19,110）。
 *   **沒有人能重算的數字，寫了等於沒寫**，而讀的人會拿它當
 *   「我手上這一本是不是你說的那一本」的依據。
 *
 * ⚠️ 這一條**不可以在沒有 pdftotext 的環境裡變紅**：複查者的機器不一定有
 *   poppler-utils，而「在正確的包上變紅」比沒有守門更糟（這一組系統已經踩過三次）。
 *   缺工具時跳過並**印出為什麼跳過**——不是安靜過去。
 */
test("驗證報告寫的手冊頁數與字元數要與 PDF 相符（缺工具時跳過並說明）", async () => {
  const { execFileSync } = await import("node:child_process");
  const { readdirSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const patch = Number(String(pkg.version).split(".")[1]);
  const reportUrl = new URL(`../VALIDATION_v20.${patch}.md`, import.meta.url);
  assert.ok(existsSync(reportUrl), `找不到 VALIDATION_v20.${patch}.md`);
  const report = await readFile(reportUrl, "utf8");
  /*
   * ⚠️ 只看**本版那一節**（2026-09-27 抓到）。
   *
   *   原本是對整份報告做第一個 match。VALIDATION 是逐版累積的，本版那一節
   *   一旦沒寫「N 頁 / M 字元」，正規式就會往下抓到**歷史版本**那一列，
   *   然後拿舊版的頁數去比對新版的 PDF——實測：v20.88 的節裡只寫「34 頁」，
   *   於是抓到 v20.87 的「33 頁 / 26,099 字元」，紅在「報告寫 33 頁，實際 34 頁」。
   *   紅得對，但訊息把人帶往「PDF 錯了」，而真正的問題是「本版那一節沒寫」。
   */
  const sectionStart = report.search(
    new RegExp(`^##\\s*v20\\.${patch}(?![\\d.])`, "m"),
  );
  assert.ok(
    sectionStart >= 0,
    `VALIDATION_v20.${patch}.md 裡找不到「## v20.${patch}」這一節的標題`,
  );
  const after = report.slice(sectionStart + 3);
  const nextHeading = after.search(/^##\s+v[\d.]/m);
  const section =
    nextHeading >= 0 ? after.slice(0, nextHeading) : after;
  const claim = section.match(/\*\*(\d+) 頁 \/ ([\d,]+) 字元\*\*/);
  assert.ok(
    claim,
    `VALIDATION_v20.${patch}.md 的「## v20.${patch}」那一節裡找不到` +
      "「**N 頁 / M 字元**」——本版的手冊數字一定要寫在本版那一節，" +
      "寫在別節會被當成歷史紀錄，這一支就會拿舊數字去比對新 PDF",
  );
  const notes = await readFile(new URL("../【更新說明】請先讀我.txt", import.meta.url), "utf8");
  const manualStart = notes.lastIndexOf("本版手冊：");
  assert.ok(manualStart >= 0, "更新說明裡找不到本版手冊段落");
  const manualSection = notes.slice(manualStart, notes.indexOf("若採手動覆蓋方式更新", manualStart));
  assert.ok(
    manualSection.includes(`${claim[1]} 頁 / ${claim[2]} 字元`),
    `更新說明的本版手冊段落必須寫 ${claim[1]} 頁 / ${claim[2]} 字元，不可沿用歷史數字`,
  );

  const dir = fileURLToPath(new URL("../manuals/", import.meta.url));
  const pdf = readdirSync(dir).find((name) => name.endsWith(".pdf"));
  assert.ok(pdf, "manuals/ 底下找不到 PDF");
  const path = dir + pdf;

  let pages = null;
  let chars = null;
  try {
    pages = Number(
      execFileSync("pdfinfo", [path], { encoding: "utf8" }).match(
        /^Pages:\s+(\d+)/m,
      )?.[1],
    );
    const text = execFileSync("pdftotext", ["-enc", "UTF-8", path, "-"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    /*
     * ⚠️ 先把換行統一成 LF 再數（2026-09-27 加）。
     *   Windows 的 poppler 會輸出 CRLF，於是同一份 PDF 在 Windows 上
     *   會多出「行數」那麼多個字元（姊妹系統實測：16,388 vs 15,345，
     *   差值剛好是行數）。不正規化的話，這個數字換一台機器就對不上，
     *   而每一次對不上都會有人把數字改成自己那一台的值。
     */
    chars = [...text.replace(/\r\n?/g, "\n").normalize("NFKC")].length;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    console.error(
      "  ℹ️ 這台機器沒有 pdfinfo／pdftotext（poppler-utils），" +
        "跳過手冊頁數與字元數的重算比對——這不是失敗，是這個環境算不了。",
    );
    return;
  }
  assert.equal(pages, Number(claim[1]), `報告寫 ${claim[1]} 頁，實際 ${pages} 頁`);
  assert.equal(
    chars,
    Number(claim[2].replace(/,/g, "")),
    `報告寫 ${claim[2]} 字元，實際 ${chars}（換行統一為 LF、NFKC 後、含空白）`,
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  文件寫「某支測試 N 條／項」時，N 必須等於那支檔案裡 test() 的數量
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 2026-09-25 第六輪新增（三支同一條）。姊妹系統交通服務水準的兩份文件都寫
 *   「issue-ack-stability.test.mjs（8 條）」而實際 10 條；這一支自己也有好幾處。
 *   這種數字沒有人會回去數，但它是讀者判斷「守門夠不夠」的依據。
 *   既然數得出來，就不可以用手打。
 *
 * ⚠️ 兩種寫法都認：
 *   ・`xxx.test.mjs`（N 條）                → N 必須是**現在**的數量
 *   ・`xxx.test.mjs`（當時 N 條，現為 M 條） → **M** 必須是現在的數量
 *   第二種是刻意保留的：歷史段落寫的是「那一版新增時有幾條」，
 *   把它改成今天的數字等於**偽造當時的紀錄**。
 *   （第六輪的第一版只認第一種，於是我把兩處歷史數字改成了今天的值——
 *   那是竄改紀錄，已還原成第二種寫法。）
 */
test("文件寫的測試條數必須等於那支檔案裡 test() 的數量", async () => {
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { readFile: rf } = await import("node:fs/promises");
  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const CJK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const bad = [];
  let seen = 0;
  const version = await systemVersion();
  for (const doc of ["README.md",`VALIDATION_${version}.md`,"PROJECT_HANDOFF.md","【更新說明】請先讀我.txt"]) {
    const path = join(ROOT, doc);
    if (!existsSync(path)) continue;
    const text = await rf(path, "utf8");
    for (const m of text.matchAll(
      /([A-Za-z0-9-]+\.test\.(?:mjs|ts))`?）?（(?:當時\s*[0-9一二三四五六七八九十]+\s*[條項支][，,]\s*現為\s*)?([0-9一二三四五六七八九十]+)\s*[條項支]/g,
    )) {
      const [, file, raw] = m;
      const full = join(ROOT, "tests", file);
      if (!existsSync(full)) continue; /* 檔案不在包裡由另一支守門管 */
      seen += 1;
      const body = (await rf(full, "utf8"))
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^[ \t]*\/\/[^\n]*$/gm, " ");
      const real = (body.match(/^\s*test\(/gm) || []).length;
      const claimed = CJK[raw] ?? Number(raw);
      if (claimed !== real)
        bad.push(`${doc}：${file} 寫 ${raw}，實際 ${real}`);
    }
  }
  /* 前置檢查：真的掃到句子，格式改掉之後不可以安靜地變成恆真。 */
  assert.ok(seen >= 3, `只抓到 ${seen} 句「某支 .test.* （N 條）」——寫法改了嗎？`);
  assert.deepEqual(
    bad,
    [],
    "這些數字與實際條數不符。若那是歷史紀錄，請寫成「（當時 N 條，現為 M 條）」" +
      "而不是改掉原本的數字：\n  " +
      bad.join("\n  "),
  );
});
