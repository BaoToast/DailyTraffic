/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊不可以和系統講不同的話
 * ══════════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一支 ──
 *
 * 使用者定的規矩：「大檢查時：手冊與系統要逐項交叉比對。」
 * 2026-09-12 的稽核在**路口轉向**那一支實際抓到三句與現行行為完全相反的
 * 敘述（「只有調查滿 24 小時才算得出來」之類）。那三句在改名、拿掉 24 小時
 * 門檻之前是對的，改完之後沒有人回頭改手冊。
 *
 * 全日交通量這一支在同一輪改名裡把「全日時段／全日尖峰」改成
 * 「全調查時段／全調查時段尖峰」，踩到的是**同一顆雷**。稽核當下手冊是乾淨的，
 * 但乾淨不等於以後不會髒——這一支就是把當下的乾淨**釘住**。
 *
 * ⚠️ 後果比「文件過期」嚴重得多：使用者照手冊判斷，會把一個正確的數字
 *   當成系統壞掉，或反過來以為某一欄本來就該是空的而不去追究。
 *   手冊是使用者唯一的權威說明，它和系統互相矛盾時，兩邊都變得不可信。
 *
 * ── 這一支守什麼 ──
 *
 * 只守「已經證實會出事」的那一類：**改了計算口徑或名稱，卻忘了改手冊。**
 * 全面的畫面／手冊比對要跑瀏覽器，不在這裡。
 *
 * ⚠️ 期望值取自程式本身（PERIOD_LABELS），不要在測試裡再寫死一份名稱——
 *   寫死的話，下次改名會變成「測試綠、手冊錯」。
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PERIOD_LABELS } from "../app/period-analysis.ts";

const manual = await readFile(
  new URL("../scripts/manual/manual.html", import.meta.url),
  "utf8",
);

test("手冊不可以說「不足 24 小時就算不出尖峰」", () => {
  /*
   * 這一支程式從來沒有 24 小時的門檻（部分時段調查本來就算得出
   * 全調查時段尖峰，只是單位會標成「實測 N 小時」）。
   * 下面這幾種寫法只要出現，就是手冊在講另一支程式的舊行為。
   */
  for (const [pattern, why] of [
    [/只有調查滿\s*24\s*小時才算得出來/, "不足 24 小時也算得出來"],
    [/不足\s*24\s*小時就沒有[^。]*最忙的一小時/, "同上，這句話不成立"],
    [/不足\s*24\s*小時[^。]*算不出/, "同上"],
    [/尖峰[^。]*永遠是「－」/, "它不是永遠是「－」"],
  ])
    assert.doesNotMatch(manual, pattern, `手冊與系統相反：${why}`);
});

test("手冊用的時段名稱要和系統畫面上的一致", () => {
  for (const label of Object.values(PERIOD_LABELS))
    assert.ok(
      manual.includes(label),
      `手冊裡找不到系統在用的時段名稱「${label}」`,
    );
  /*
   * 舊名不可以再出現。改名的那一版（v2.1.x）如果要在手冊裡留一句
   * 「舊稱……」的沿革，請寫成「（v… 起…）」的括號，這裡會先剝掉再檢查。
   */
  const withoutHistory = manual.replace(/（v[0-9.]+\s*起[^）]*）/g, "");
  for (const stale of ["全日時段", "全日尖峰"])
    assert.ok(
      !withoutHistory.includes(stale),
      `手冊仍在用舊名「${stale}」，系統畫面上已經沒有這個詞`,
    );
});

test("手冊說明目前的計畫導覽，不可以沿用側欄列出全部計畫的舊介面", () => {
  /*
   * ⚠️ 2026-09-25：這兩條原本把**表格的欄位結構**寫進正規式
   *   （`左側欄</td><td>只顯示目前計畫…`）。那張表在同一輪從兩欄改成三欄
   *   （多了「在哪一頁」），這一支就紅了——紅的理由是「表格多一欄」，
   *   而不是「手冊講錯」。改成只看**那一列的內容**，不綁欄位數。
   */
  const row = /<tr><td class="k">左側欄<\/td>([\s\S]*?)<\/tr>/.exec(manual);
  assert.ok(row, "抓不到手冊「左側欄」那一列——表格結構改了嗎？");
  assert.ok(
    !/「我的計畫」清單與建立計畫的/.test(row[1]),
    "手冊仍說左側欄列出全部計畫，但目前側欄只保留目前計畫",
  );
  assert.match(
    row[1],
    /只顯示目前計畫/,
    "手冊沒有寫明側欄只顯示目前計畫",
  );
  assert.match(
    row[1],
    /「建立與管理計畫」頁/,
    "手冊沒有說明其他計畫應到「建立與管理計畫」頁瀏覽",
  );
});

test("這幾條真的抓得到（反面檢查，不然它們可能永遠是綠的）", () => {
  /*
   * ⚠️ 沒有這一段的話，上面兩條在正規式寫錯時會永遠通過，
   *   而我們會以為手冊被守著。
   */
  const broken =
    "全日尖峰小時：只有調查滿 24 小時才算得出來，不足 24 小時就沒有全天最忙的一小時可言。";
  assert.match(broken, /只有調查滿\s*24\s*小時才算得出來/);
  assert.match(broken, /不足\s*24\s*小時就沒有[^。]*最忙的一小時/);
  assert.match("不足 24 小時的資料算不出來", /不足\s*24\s*小時[^。]*算不出/);
  assert.match("全調查時段尖峰永遠是「－」", /尖峰[^。]*永遠是「－」/);
  assert.ok("這一版把全日時段改名".includes("全日時段"));
  /* 沿革括號要剝得掉，否則寫了沿革就永遠紅。 */
  assert.ok(
    !"（v2.1.40 起舊稱全日時段）".replace(/（v[0-9.]+\s*起[^）]*）/g, "").includes(
      "全日時段",
    ),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊不可以指到已經移除的入口（2026-09-25，F6 第三輪抓到）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 實際抓到的：手冊的工具列清單列了三顆**已經移除**的鈕
 * （2026-09-16 移除兩個視窗、09-17 移除一個），第 12 章**一整章**在講
 * 其中一個已移除的視窗，第 4 章的快速流程第一步就叫使用者去按它，
 * 另外還指到一個畫面上完全不存在的區塊名。
 *
 * ⚠️ 後果：新手照手冊走到第 4 章第一步就卡住。而既有守門一支都抓不到——
 *   它們守的是時段名稱與 24 小時門檻，沒有人在看「手冊提到的入口還在不在」。
 *
 * 守法：**已移除的名字**列成具名黑名單（每一個都寫上移除日期與出處），
 * 手冊裡出現任何一個就紅。
 * ⚠️ 黑名單方向在這裡是對的：這些字串**永遠**不該再出現在手冊裡。
 *   ⚠️ 2026-09-25 第五輪複查更正：這裡原本寫「白名單方向已經由
 *   core-scope-names 那一支在守」——**那是假的**，那一支只守四個核心時段名、
 *   `PAGE_ZONES` 的唯一來源與「分區 vs 大分頁」用詞，從來沒有把
 *   `PAGE_ZONES` 的項目名稱與手冊比對。所以手冊漏掉「季度改名」
 *   （它唯一的入口）一直沒有人抓到。白名單方向已在本檔下方補上。
 * ⚠️ 連「更正說明」裡也不可以原句引用——引用一次就等於留一個字串在手冊裡，
 *   讀者搜尋時照樣搜得到。要說明就用轉述（本輪三次踩到這件事，寫在這裡備忘）。
 */
test("手冊不可以提到已經從畫面移除的入口名稱", async () => {
  const REMOVED = [
    ["品質與定稿", "視窗於 2026-09-16 整塊移除（X-43）；狀態改到「資料異常檢查摘要」"],
    ["版本差異與還原", "於 2026-09-16 從畫面移除；入口改成「還原與備份」"],
    ["管理季度", "視窗於 2026-09-17 整個移除（X-71）；改用「刪除單一季度」"],
    ["資料完整度與異常管理", "畫面上從來沒有這個區塊名；門檻在「異常提醒門檻」"],
  ];
  const offenders = [];
  for (const [name, why] of REMOVED)
    if (manual.includes(name)) offenders.push(`${name}（${why}）`);
  assert.deepEqual(
    offenders,
    [],
    "手冊指到這些已經不存在的入口，使用者會照著去按一顆不存在的鈕：\n  " +
      offenders.join("\n  "),
  );

  /*
   * 前置檢查：這幾個名字在**程式**裡也真的只剩註解（否則黑名單就過期了，
   * 它們可能被重新加回畫面，那時候手冊反而該寫）。
   */
  const app = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  const code = app
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\/[^\n]*/g, "");
  const revived = REMOVED.filter(([name]) => code.includes(name)).map(([n]) => n);
  assert.deepEqual(
    revived,
    [],
    "這幾個名字又出現在程式（非註解）裡了——如果是刻意加回畫面，" +
      "請把它從這一支的黑名單移除並把手冊補回去：\n  " + revived.join("、"),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一種資料異常都要寫進手冊與 README（2026-09-25）
 * ══════════════════════════════════════════════════════════════════════
 *
 * F6 第三輪抓到：`ANOMALY_TYPES` 共 11 種，手冊只提到 2 種、
 * README 的功能清單只列 7 種（而 README 自己的版本紀錄正是在講新增那幾種）。
 * 其中「PCU係數全為0」會讓尖峰欄變成「待設定 PCU 係數」、
 * 「調查格距異常」會在匯入時提示——都是使用者一定會遇到、而且需要知道
 * 怎麼處理的項目，卻在兩份說明裡都找不到。
 *
 * ⚠️ 期望值取自程式（`ANOMALY_TYPES`），不在測試裡寫死一份名單：
 *   寫死的話，下次新增一種異常會變成「測試綠、文件缺」。
 */
test("ANOMALY_TYPES 的每一種都要出現在手冊與 README", async () => {
  const workflow = await readFile(
    new URL("../app/final-workflow.ts", import.meta.url),
    "utf8",
  );
  const block = /export const ANOMALY_TYPES[^=]*=\s*\[([\s\S]*?)\]\s*as const;/.exec(
    workflow,
  );
  assert.ok(block, "抓不到 ANOMALY_TYPES——改名或改寫法的話這一支要跟著改");
  const types = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  /* 前置檢查：真的抓到一整組，否則這一支會安靜地變成恆真。 */
  assert.ok(
    types.length >= 8,
    `只抓到 ${types.length} 種異常類型（${types.join("、")}）——寫法改了嗎？`,
  );

  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

  /*
   * ⚠️ 2026-09-25 補：**種類數也要釘住**。
   *   F6 第四輪抓到：`ANOMALY_TYPES` 實際 12 種，而手冊的小節標題與內文、
   *   README 的條目標題都寫「11 種」——而它們**自己底下就列了 12 項**。
   *   數字是從 9 加到 12 時只補到 11 留下的。使用者照「11 種」去數畫面上的
   *   異常類型會多出一種，第一反應是「程式多跑了一種不該有的檢查」。
   *   ⚠️ 期望值取自程式，所以下次再新增一種、文件沒跟上，這一條就會紅。
   */
  const counts = [];
  for (const [what, text] of [["手冊", manual], ["README", readme]])
    for (const m of text.matchAll(/(?:列出哪|共|會列出)\s*(\d+)\s*種/g))
      counts.push({ what, said: Number(m[1]) });
  assert.ok(
    counts.length >= 2,
    `抓不到「N 種」的寫法（只抓到 ${counts.length} 處）——文件的寫法改了嗎？`,
  );
  const wrongCount = counts
    .filter((item) => item.said !== types.length)
    .map((item) => `${item.what} 寫 ${item.said} 種`);
  assert.deepEqual(
    wrongCount,
    [],
    `ANOMALY_TYPES 實際 ${types.length} 種，但文件寫的不是這個數字：` +
      wrongCount.join("、"),
  );

  const missing = [];
  for (const type of types) {
    if (!manual.includes(type)) missing.push(`手冊缺「${type}」`);
    if (!readme.includes(type)) missing.push(`README 缺「${type}」`);
  }
  assert.deepEqual(
    missing,
    [],
    "這幾種資料異常沒有寫進使用者說明，使用者看到提醒卻找不到它是什麼、要怎麼處理：\n  " +
      missing.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  反過來：側欄每一個項目，手冊都要提到（2026-09-25 第五輪獨立複查）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 黑名單方向守的是「手冊不可以提到已移除的入口」，
 * 但它抓不到**相反的錯**：畫面上有一個功能，而手冊從頭到尾沒提。
 * 第五輪抓到的實例：「還原與備份」底下的 **季度改名**——
 * 它是季度改名的**唯一入口**（`DashboardClient` 的註解自己就寫著
 * 「改名在別處沒有第二個入口」），而全手冊 0 次提到它。
 *
 * ⚠️ 期望值取自程式（`PAGE_ZONES` 的 items label），不寫死一份名單。
 * ⚠️ 只比對**項目名稱**，不比對章節位置：位置本來就有很多合理寫法，
 *   比位置會變成一個會誤報的守門。
 */
test("PAGE_ZONES 的每一個項目名稱，手冊都要提到", async () => {
  const dashboard = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  const zones = dashboard.slice(
    dashboard.indexOf("const PAGE_ZONES = ["),
    dashboard.indexOf("const PAGES = PAGE_ZONES"),
  );
  assert.ok(zones.length > 200, "抓不到 PAGE_ZONES 區塊——結構改了嗎？");
  /* 剝註解：註解裡會寫到舊名（那是在記錄病灶）。 */
  const clean = zones.replace(/\/\*[\s\S]*?\*\//g, "");
  const labels = [
    ...new Set([...clean.matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1])),
  ];
  assert.ok(
    labels.length >= 15,
    `只抓到 ${labels.length} 個側欄項目名稱——結構改了嗎？這一支靠它當基準`,
  );
  /*
   * ⚠️ 比對前把**半角空白**去掉兩邊再比：側欄寫「24小時PCU」，
   *   而手冊全篇的排版慣例是中英文之間加一個空白（「24 小時 PCU」）。
   *   那是排版差異，不是「手冊沒提到這個功能」——不正規化就會產生假的紅。
   *   全角空白（　）不動：它在區名裡是有意義的分隔（「一　建立與匯入」）。
   */
  const squeeze = (text) => text.replace(/ /g, "");
  const flatManual = squeeze(manual);
  const missing = labels.filter((name) => !flatManual.includes(squeeze(name)));
  assert.deepEqual(
    missing,
    [],
    "側欄有這幾個項目，而手冊一次都沒提到——使用者不會知道有這個功能"
      + "（「季度改名」就是這樣漏掉的，而它是唯一入口）：\n  "
      + missing.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  反過來：手冊的異常對照表不可以列出程式沒有的類型（第五輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那一支守「ANOMALY_TYPES 每一種都要在文件裡」，
 * 但**反過來沒守**：文件多列一種不存在的類型不會紅
 * （數量檢查比的是文字「N 種」，不是表格列數）。
 * 姊妹專案路口轉向的手冊就真的列過一個不存在的類別「資料別待設定」。
 */
test("手冊異常對照表的每一列，都必須是 ANOMALY_TYPES 裡真的有的", async () => {
  const workflow = await readFile(
    new URL("../app/final-workflow.ts", import.meta.url),
    "utf8",
  );
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  const block = /export const ANOMALY_TYPES[^=]*=\s*\[([\s\S]*?)\]\s*as const;/.exec(
    workflow,
  );
  assert.ok(block, "抓不到 ANOMALY_TYPES");
  const types = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(types.length >= 10, `ANOMALY_TYPES 只抓到 ${types.length} 種`);

  /* 異常對照表：從「會列出哪 N 種」那一段之後的第一張表抓 <td class="k">。 */
  const at = manual.search(/(?:列出哪|會列出)\s*\d+\s*種/);
  assert.notEqual(at, -1, "抓不到異常對照表前面那一句——手冊寫法改了嗎？");
  const tableStart = manual.indexOf("<table", at);
  const tableEnd = manual.indexOf("</table>", tableStart);
  assert.ok(tableStart > 0 && tableEnd > tableStart, "抓不到異常對照表");
  const rows = [
    ...manual
      .slice(tableStart, tableEnd)
      .matchAll(/<td class="k">([^<]+)<\/td>/g),
  ].map((m) => m[1].trim());
  assert.ok(
    rows.length >= 10,
    `異常對照表只抓到 ${rows.length} 列——表格結構改了嗎？`,
  );
  const ghosts = rows.filter((name) => !types.includes(name));
  assert.deepEqual(
    ghosts,
    [],
    "手冊的異常對照表列了程式裡沒有的類型（使用者會照著去找一個不存在的異常）：\n  "
      + ghosts.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  手冊叫使用者按的按鈕，必須是**真正的按鈕文字**（2026-09-25 第六輪）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 三支同一條。姊妹系統路口轉向本輪抓到：手冊、畫面上的提示與程式註解三處都叫
 *   使用者「按一下『重新套用計算』」，而**全站沒有那一顆按鈕**。
 *   它之所以「在原始碼裡找得到」，是因為它出現在一段**說明文字**裡——
 *   而「說明文字提到一個不存在的按鈕」正是要抓的東西。
 *   判準因此不是「這串字在原始碼裡」，而是「它是某一顆按鈕的字」。
 *
 * ⚠️ 抽取有一個坑：**不可以**用 `/<button[^>]*>/` 找開始標籤——標籤裡有箭頭函式
 *   （`onClick={() => …}`），`[^>]*` 會在 `=>` 的那個 `>` 就停下來。
 *   作法：從 `</button>` 往回找最近的 `<button`，再跳過成對的大括號與字串。
 *
 * ⚠️ 允許「後面接括號補述」的前綴相符；只允許括號，不允許任意前綴。
 */
test("手冊叫使用者按的按鈕，必須是真正的按鈕文字", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  const squeeze = (text) => text.replace(/\s+/g, "");
  const buttons = new Set();
  let at = 0;
  for (;;) {
    const close = source.indexOf("</button>", at);
    if (close < 0) break;
    at = close + 9;
    const open = source.lastIndexOf("<button", close);
    if (open < 0) continue;
    let i = open + 7;
    let depth = 0;
    let quote = "";
    for (; i < close; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === "\\") i += 1;
        else if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "{") { depth += 1; continue; }
      if (ch === "}") { depth -= 1; continue; }
      if (ch === ">" && depth === 0) break;
    }
    const body = source.slice(i + 1, close);
    const text = squeeze(
      body.replace(/\{[\s\S]*?\}/g, " ").replace(/<[^>]*>/g, " "),
    );
    if (text) buttons.add(text);
    for (const lit of body.matchAll(/"([^"\n]{2,30})"/g))
      buttons.add(squeeze(lit[1]));
  }
  /* 前置檢查：真的抽到一批按鈕文字，否則這一支等於恆真。 */
  assert.ok(buttons.size >= 30, `只抽到 ${buttons.size} 個按鈕文字，抽取方式不對`);
  for (const must of ["套用係數", "已人工確認"])
    assert.ok(buttons.has(must), `按鈕文字清單裡沒有「${must}」，抽取方式不對`);

  const plain = manual.replace(/<[^>]+>/g, "");
  const cited = [
    ...new Set(
      [...plain.matchAll(/(?:按一下|按|點一下|點)「([^」]{2,16})」/g)].map((m) => m[1]),
    ),
  ];
  assert.ok(cited.length >= 2, `手冊裡只抓到 ${cited.length} 個「按「…」」`);
  const isReal = (name) => {
    const want = squeeze(name);
    for (const text of buttons) {
      if (text === want) return true;
      if (text.startsWith(want) && /^[（(]/.test(text.slice(want.length))) return true;
    }
    return false;
  };
  const missing = cited.filter((name) => !isReal(name));
  assert.deepEqual(
    missing,
    [],
    "手冊叫使用者按這幾顆按鈕，但它們**不是畫面上任何一顆按鈕的字**"
      + "（字串只出現在說明文字裡不算）：\n  "
      + missing.join("\n  "),
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  交接文件不可以把「混用格長只警告」寫成現行規則（2026-09-26 新增）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 為什麼要有這一支：
 *
 * 使用者 2026-09-24 拍板「尖峰小時改成逐格累計到剛好 60 分鐘、湊不滿寫
 *『資料不足』」，v20.87 已經照做。但 `PROJECT_HANDOFF.md` 到 2026-09-26
 * 還有**三處**把舊做法寫成現行規則，其中一處還是寫給下一個人的**紅線**
 *（「為混合時間格順手改尖峰挑選：目前規格只警告，改計算會造成未批准 regression」）。
 * 照它做的人會把 v20.87 的核心修正當成「未經授權的口徑變更」而要求還原。
 *
 * ⚠️ 路口轉向早在 2026-09-25 就有同一支守門（`tests/manual-matches-system.test.mjs`
 *   的「PROJECT_HANDOFF.md 不可以再說…」），**這一支程式當時沒有跟著加**，
 *   所以同樣的過期敘述在這裡活了下來。這正是「我們踩過的雷，三份程式都要
 *   確保不會再踩到」那一條——守門本身也要三支同步。
 *
 * ⚠️ 樣式是**概念級**的：同一句裡同時出現「混合／混用時間格（格距）」與
 *   任一種「不改計算」的說法就紅，正反語序都抓。只綁死「只警告」三個字
 *   的話，換成「只給提醒」「不動計算」「維持既有挑選」就全部漏掉
 *  （路口轉向那一支踩過兩次才收斂到這個寫法）。
 * ⚠️ 附帶正面斷言：現行規則必須寫在文件裡。少了它，把那幾句**整段刪掉**
 *   也會通過，而那會讓下一個人完全不知道現行口徑是什麼。
 */
test("PROJECT_HANDOFF.md 不可以把「混用格長只警告」寫成現行規則", async () => {
  const handoff = await readFile(
    new URL("../PROJECT_HANDOFF.md", import.meta.url),
    "utf8",
  );
  /* 前置檢查：真的讀到文件、而且抓得到那一節，否則這一支等於沒在守。 */
  assert.ok(handoff.length > 2000, `PROJECT_HANDOFF.md 只讀到 ${handoff.length} 字`);
  assert.match(handoff, /###\s*時段與部分日資料/, "抓不到「時段與部分日資料」那一節——文件結構改了嗎？");

  const SOFT =
    "(?:只警告|僅警告|只加警告|只提醒|僅提醒|只給提醒|只警示|僅警示" +
    "|不動計算|不改計算|不改既有挑選|不改挑選邏輯|維持既有挑選|不改變既有挑選)";
  const MIXED = "(?:混合|混用)(?:時間格|格長|格距)";
  for (const [pattern, why] of [
    [
      new RegExp(`${MIXED}[^。\n]{0,30}?${SOFT}`),
      "v20.87 起混用格長已改成逐格累計到剛好 60 分鐘（使用者 2026-09-24 拍板）",
    ],
    [
      new RegExp(`${SOFT}[^。\n]{0,30}?${MIXED}`),
      "同上（語序相反的寫法）",
    ],
  ])
    assert.doesNotMatch(
      handoff,
      pattern,
      `交接文件仍把舊做法寫成現行規則：${why}\n` +
        "（要保留歷史紀錄請**轉述**並指向現行規則那一節，不可以原句引用舊規則）",
    );

  /* 正面斷言：現行規則要寫在那裡。 */
  assert.match(
    handoff,
    /逐格累計實際長度到剛好\s*60\s*分鐘/,
    "交接文件沒有寫出現行規則——把舊敘述整段刪掉也會讓上面那幾條通過",
  );
  assert.match(
    handoff,
    /湊不滿就寫「資料不足」/,
    "沒有寫出「湊不滿要顯示什麼」——那是使用者裁示的另一半",
  );
});

/*
 * `npm test` 必須整條執行（2026-09-26 新增）
 *
 * Claude 在 2026-09-25 的封關驗證把 `npm test` 拆成 build／typecheck／
 * `node --test` 分開跑，**漏掉了第一步 `npm run lint`**，於是交付包帶著一個
 * lint error 出門，而驗證報告寫「全綠」。交接文件當時只寫「`npm test`：
 * lint、production build 及 Node 測試總流程」，沒有寫「不可以拆開跑」。
 *
 * ⚠️ 這一支守的是**文件有沒有把這條規則寫出來**，不是去跑 npm。
 *   跑不跑得動是 CI 與封關清單的事；文件沒寫，下一個人就會再拆一次。
 */
test("交接文件要寫明 npm test 必須整條執行、不可以拆開跑", async () => {
  const handoff = await readFile(
    new URL("../PROJECT_HANDOFF.md", import.meta.url),
    "utf8",
  );
  assert.match(
    handoff,
    /必須整條執行/,
    "交接文件沒有寫「npm test 必須整條執行」",
  );
  assert.match(
    handoff,
    /不可以拆成[^。\n]*分開下/,
    "沒有寫出「不可以拆開跑再把綠燈拼起來」——那正是實際出事的方式",
  );
  assert.match(
    handoff,
    /接了管線|PIPESTATUS|pipefail/,
    "沒有寫出「離開碼要抓那一條命令自己的」——接管線之後 $? 永遠是 0",
  );
});
