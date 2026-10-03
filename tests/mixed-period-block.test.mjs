/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-48：混批（一批檔案的日期指向兩個以上期別）一律擋死
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29 裁示：「混入別季混批不擋，三支程式請同步」。
 *
 * 現況（2026-09-29 查證）：
 *   ・路口轉向 ── 本來就擋死（逐檔解析季別，預覽裡兩種以上就停用按鈕＋紅底）。
 *   ・這一支與交通服務水準 ── 原本**只有一個 confirm()**，按確定就寫進去。
 *
 * ⚠️ 附帶更正一句錯的註解：`DashboardClient.tsx` 的
 *   「那種情況本來就該分批匯入（**而且混批本來就會被擋住**）」
 *   在當時並不成立。錯的註解比沒有註解更糟——下一個人會相信它而不去查。
 *
 * ⚠️ 判準刻意**不是**「日期與所選期別對不上就擋」。季末跨月調查、
 *   廠商延後幾天補測都會對不上，那些是真的要匯進去的，擋死就是假的紅。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  mixedPeriodBlock,
  periodMismatchPrompt,
  checkPeriodAgainstDate,
} from "../app/period-date.ts";

const app = readFileSync(new URL("../app/DashboardClient.tsx", import.meta.url), "utf8");

/** 一份檔案的日期比對結果（只留這幾支真的會讀的欄位）。 */
function check(file, status, dateLabel) {
  return {
    file,
    status,
    dateLabel,
    periodInput: "115Q1",
    periodLabel: "115Q1",
    date: "2026-05-08",
    labelled: true,
    source: "表頭",
    raw: "115/05/08",
    headline: "",
    detail: `${file}：檔案裡屬 ${dateLabel}`,
  };
}

test("前置：checkPeriodAgainstDate 回的狀態字面值真的是 match／mismatch／unknown", () => {
  /*
   * ⚠️ 這一條防的是「測資寫錯字面值 → 底下幾條全部恆綠」。
   *   status 從 match 改名成別的，底下每一條都會安靜地變成空轉。
   */
  const matched = checkPeriodAgainstDate(
    "115Q1",
    { iso: "2026-01-26", labelled: true, raw: "115年01月26日", sheet: "工作表1", cell: "A1" },
    "甲.xlsx",
  );
  assert.equal(matched.status, "match");
  assert.equal(
    matched.dateLabel,
    "115Q1",
    "相符的那一份也要帶 dateLabel，否則它永遠計不到票",
  );
  const missed = checkPeriodAgainstDate(
    "115Q1",
    { iso: "2026-08-05", labelled: true, raw: "115年08月05日", sheet: "工作表1", cell: "A1" },
    "乙.xlsx",
  );
  assert.equal(missed.status, "mismatch");
  assert.equal(missed.dateLabel, "115Q3");
  assert.equal(checkPeriodAgainstDate("115Q1", null, "丙.xlsx").status, "unknown");
});

test("① 全部指向同一個別季 → 不擋（那是二次確認要處理的情形）", () => {
  const blocked = mixedPeriodBlock([
    check("甲路-平日.xlsx", "mismatch", "115Q2"),
    check("甲路-假日.xlsx", "mismatch", "115Q2"),
  ]);
  assert.equal(
    blocked,
    "",
    "兩份都指向 115Q2，使用者把季別改成 115Q2 就對了——這種不可以擋死",
  );
  assert.ok(
    periodMismatchPrompt([check("甲路-平日.xlsx", "mismatch", "115Q2")]),
    "同一個別季的二次確認必須還在（不可以連它一起拔掉）",
  );
});

test("② 指向兩個以上不同期別 → 一定要擋，訊息要指名哪一份屬哪一季", () => {
  const blocked = mixedPeriodBlock([
    check("甲路-平日.xlsx", "mismatch", "115Q1"),
    check("乙路-平日.xlsx", "mismatch", "115Q2"),
  ]);
  assert.ok(blocked, "指向兩個期別，一定要擋下來");
  for (const word of ["115Q1", "115Q2", "甲路-平日.xlsx", "乙路-平日.xlsx", "2 個不同的期別"])
    assert.ok(blocked.includes(word), `訊息要寫出「${word}」，實際：${blocked}`);
});

test("③ 最常見的混批：一部分相符、一部分指向別季 → 一定要擋", () => {
  /*
   * ⚠️ 只算 mismatch 的話只數到一個期別（115Q3），於是不擋——
   *   而這一批真的橫跨 115Q1 與 115Q3。判準要問的是
   *   「這一批一共指向幾個期別」，與使用者選了哪一個無關。
   */
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "match", "115Q1"),
    check("乙.xlsx", "match", "115Q1"),
    check("丙.xlsx", "mismatch", "115Q3"),
  ]);
  assert.ok(blocked, "一批裡有 115Q1 與 115Q3 兩種日期，一定要擋");
  assert.ok(blocked.includes("115Q1") && blocked.includes("115Q3"), blocked);
});

test("③-2 全部相符（同一個期別）→ 不擋", () => {
  assert.equal(
    mixedPeriodBlock([
      check("甲.xlsx", "match", "115Q1"),
      check("乙.xlsx", "match", "115Q1"),
    ]),
    "",
    "兩份都是 115Q1，擋了就是假的紅",
  );
});

test("④ 讀不到日期的（unknown）不參與計票", () => {
  assert.equal(
    mixedPeriodBlock([
      check("甲.xlsx", "mismatch", "115Q2"),
      check("乙.xlsx", "unknown", "115Q3"),
      check("丙.xlsx", "unknown", "115Q4"),
    ]),
    "",
    "拿 unknown 去湊「兩個以上」是假的擋",
  );
});

test("⑤ 沒有 dateLabel 的不參與計票；空陣列與非陣列不可以炸", () => {
  assert.equal(
    mixedPeriodBlock([
      { file: "甲.xlsx", status: "mismatch", dateLabel: "" },
      check("乙.xlsx", "mismatch", "115Q2"),
    ]),
    "",
  );
  for (const input of [[], null, undefined, 0, "x", {}])
    assert.equal(mixedPeriodBlock(input), "", `mixedPeriodBlock(${String(input)})`);
});

test("⑥ 訊息不可以留「確認無誤」這種出口，而且要給下一步", () => {
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "mismatch", "115Q1"),
    check("乙.xlsx", "mismatch", "115Q2"),
  ]);
  for (const word of ["仍要以這個期別匯入", "按「確定」"])
    assert.ok(!blocked.includes(word), `不該出現「${word}」：${blocked}`);
  assert.ok(blocked.includes("已阻擋"), blocked);
  assert.ok(blocked.includes("沒有「確認無誤」這個選項"), blocked);
  assert.ok(blocked.includes("分批匯入"), blocked);
});

test("⑦ 與交通服務水準的訊息逐字相同（三支同步的實證）", () => {
  /*
   * ⚠️ 這一條不是形式主義。使用者在兩支程式看到的必須是同一句話——
   *   兩邊各寫一句「意思差不多」的文字，就是漂移的起點。
   *   姊妹系統的那一份不在這個包裡，所以這裡釘住**本支的字面值**，
   *   兩邊同時改才改得動（另一支有對稱的一條）。
   */
  const blocked = mixedPeriodBlock([
    check("甲.xlsx", "mismatch", "115Q1"),
    check("乙.xlsx", "mismatch", "115Q2"),
  ]);
  assert.equal(
    blocked,
    "⚠️ 這一批檔案的調查日期指向 2 個不同的期別，系統已阻擋寫入。\n\n" +
      "　・115Q1：甲.xlsx\n" +
      "　・115Q2：乙.xlsx\n\n" +
      "無論寫進哪一個期別，都一定有一批是錯的，所以這裡沒有「確認無誤」這個選項。\n" +
      "請按「取消預覽」，把它們分成各自的期別分批匯入。",
  );
});

/* ────────────────────────────────────────────────────────────────────
 *  DashboardClient 的三處必須共用同一份計算
 * ──────────────────────────────────────────────────────────────────── */

test("⑧ 只算一次，而且畫面／按鈕／寫入路徑三處都讀那一份", () => {
  const defs = app.match(/const mixedPeriodMessage = useMemo\(/g) || [];
  assert.equal(defs.length, 1, `mixedPeriodMessage 應該只算一次，實際 ${defs.length} 份`);
  const uses = app.match(/mixedPeriodMessage/g) || [];
  assert.ok(
    uses.length >= 5,
    `三處都要讀它（畫面兩處、按鈕一處、寫入路徑一處，加定義本身），實際 ${uses.length} 次`,
  );
  /*
   * ⚠️ 要數的是**真的呼叫**，不是註解裡提到它的名字。
   *   先把區塊註解整段拿掉再數——不拿掉的話，上面那段說明裡的
   *   「period-date.ts 的 mixedPeriodBlock()」會被算成第二個呼叫點，
   *   於是這一條變成「寫註解就會紅」。
   */
  const code = app.replace(/\/\*[\s\S]*?\*\//g, "");
  const direct = code.match(/mixedPeriodBlock\(/g) || [];
  assert.equal(
    direct.length,
    1,
    `只能在 useMemo 裡呼叫一次 mixedPeriodBlock，實際 ${direct.length} 處——` +
      "多一處就是「各自算一次」的長相",
  );
});

test("⑨ 混批要擋在二次確認**之前**", () => {
  const blockAt = app.indexOf("if (mixedPeriodMessage) return setToast(mixedPeriodMessage);");
  const confirmAt = app.indexOf("const prompt = periodMismatchPrompt(livePeriodChecks);");
  assert.ok(blockAt > 0, "寫入路徑裡找不到混批阻擋");
  assert.ok(confirmAt > 0, "寫入路徑裡找不到二次確認");
  assert.ok(
    blockAt < confirmAt,
    "排在二次確認後面的話，使用者會先被問「確認無誤嗎」、按了確定才被擋下來",
  );
});

test("⑩ 確認鈕真的會停用，而且停用時說得出原因", () => {
  /*
   * ⚠️ 2026-09-30：這顆鈕現在有**兩個**停用理由（混批、時間格超過 1 小時），
   *   所以不可以再比對一整串固定的 `disabled={...}` 字面。
   *   改成「那一串停用條件裡必須含有 mixedPeriodMessage」——
   *   之後再多一個理由也不會誤紅，而真的把混批那一項拿掉時照樣會紅。
   */
  const at = app.indexOf("disabled={Boolean(mixedPeriodMessage)");
  assert.ok(at > 0, "確認鈕沒有帶混批的停用條件");
  const around = app.slice(at, at + 400);
  assert.ok(
    /title=\{/.test(around),
    "停用卻不說原因，使用者只會以為程式壞了",
  );
  assert.ok(
    /兩個以上的期別/.test(around),
    `title 要寫出真正的原因，實際：${around.slice(0, 200)}`,
  );
});

test("⑪ 混批時不可以再印「會再問一次」，也不可以給「改用檔案日期的季別」", () => {
  /*
   * 「改用檔案日期的季別」那顆按鈕在混批時**沒有正確答案可以填**
   * （指向好幾季，一顆按鈕表達不出要改成哪一個），所以要一起收掉。
   * 這與 importDateSuggestedQuarter 自己的註解是同一個理由。
   */
  assert.ok(
    app.includes("{!mixedPeriodMessage && importDateSuggestedQuarter && ("),
    "混批時還留著「改用檔案日期的季別」——那顆按鈕在混批時沒有正確答案可以填",
  );
  assert.ok(
    app.includes("{mixedPeriodMessage ? ("),
    "混批與單純對不上還在共用同一句說明",
  );
});

test("⑫ 那句錯的註解已經更正，而且留了向前指標", () => {
  /*
   * ⚠️ 使用者的規則：歷史段落要加向前指標，不是改掉。
   *   所以不是把那句話刪掉了事，而是留著並註明「當時並不成立、同一天補上了」。
   */
  assert.ok(
    !app.includes("那種情況本來就該分批匯入（而且混批本來就會被擋住）"),
    "那句不成立的註解還在",
  );
  assert.ok(
    app.includes("2026-09-29 更正：這裡原本寫「而且混批本來就會被擋住」"),
    "更正註記不見了——不留向前指標的話，下一個人會以為這裡從來沒錯過",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  交付包不可以夾帶探針／e2e 產生的截圖（2026-09-29，三支同步）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-28：本支的交付包夾帶了 `scripts/manual/point-labels-few.png`
 * （一張 e2e 截圖，沒有任何程式讀它），GPT 把它刪掉是對的。
 * 2026-09-29：姊妹系統路口轉向的包裡掃到**同一類的 6 個**
 * （`scripts/manual/` 底下的探針截圖）。
 * 一次是意外，兩次就該有守門，所以三支同步加這一條。
 *
 * ⚠️ 擋的是「**交付包裡**有這種檔」，不是「探針不可以產生截圖」。
 *   探針照樣會在本機寫出 .png（那是它證明事情的方式），
 *   只是那些檔案不該跟著交付包走。
 */
test("scripts/ 底下不可以有 .png（探針與 e2e 的輸出，不是交付內容）", async () => {
  const { readdirSync, statSync, existsSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { join } = await import("node:path");
  const root = fileURLToPath(new URL("../scripts", import.meta.url));
  if (!existsSync(root)) return;
  const found = [];
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.png$/i.test(name)) found.push(`${prefix}${name}`);
    }
  };
  walk(root, "scripts/");
  assert.deepEqual(
    found,
    [],
    "交付包裡夾帶了截圖：\n- " +
      found.join("\n- ") +
      "\n這些是探針或 e2e 寫出來的，沒有任何程式讀它們。打包前要清掉。",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 *  #24：Excel 的「PCU係數」表必須印出季別×路段的覆寫（2026-09-29）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-29 的判斷（原話）：「這問題是指如果使用者更動了係數，
 * 但 excel 顯示的卻是預設係數嗎? 如果是這樣，請你修正，
 * 不然使用者會以為這份 excel 是計算錯誤的」。
 *
 * 症狀正是這樣：表上的**數字**是拿覆寫算的（`pcuScopes` 有傳進計算），
 * 但「PCU係數」那張表只印 `pcuFactors`（計畫預設），標題還寫「目前套用」。
 * 使用者拿那張表回推就是對不起來，而他會得到一個錯的結論：**這份 Excel 算錯了**。
 *
 * ⚠️ 這是**原始碼守門**。要真的產一份 .xlsx 出來再讀回去，得跑整個匯出流程
 *   （exceljs ＋ 圖表 ＋ 圖片），成本遠高於它能多驗到的東西；
 *   而這一件的內容是「有沒有把那幾列寫出去」，看得出來。
 *   真正的數值正確性由 A27 的等價守門與 factor-scope 的測試釘住。
 */
test("#24 Excel 的 PCU係數表要印出季別×路段覆寫，而且有覆寫時不可以再說「目前套用」", async () => {
  const sheet = app.slice(
    app.indexOf('const factors = wb.addWorksheet("PCU係數");'),
    app.indexOf('const charts = wb.addWorksheet("可編輯圖表");'),
  );
  assert.ok(sheet.length > 500, "找不到 PCU係數 那張表的產生程式碼");

  /* ① 有覆寫時，標題不可以再寫「目前套用」——那時預設那一組不是目前套用的。 */
  assert.ok(
    /exportedScopes\.length\s*\?\s*"計畫預設一般PCU係數"\s*:\s*"目前套用一般PCU係數"/.test(sheet),
    "有覆寫時標題還寫「目前套用」，那句話本身就是錯的",
  );

  /* ② 有覆寫時要先給一句警告，講明「數字是依覆寫算的、拿預設回推會對不上」。 */
  assert.ok(
    /那不是計算錯誤/.test(sheet),
    "沒有講明「拿預設回推會對不上、那不是計算錯誤」——這正是使用者會誤判的那一句",
  );

  /* ③ 覆寫要逐組印出來，而且適用範圍要用畫面上同一個字（pcuScopeLabel）。 */
  assert.ok(
    /factors\.addRow\(\[\s*\n?\s*"季別×路段專屬覆寫"/.test(sheet),
    "沒有「季別×路段專屬覆寫」那一段",
  );
  assert.ok(
    /const label = pcuScopeLabel\(/.test(sheet),
    "適用範圍沒有走 pcuScopeLabel——自己組一句就是第二種寫法，兩邊一定會漂移",
  );

  /* ④ 只列與預設不同的車種（全部列出來反而看不出改了哪一個）。 */
  assert.ok(
    /scope\.factors\.core\[key\] !== pcuFactors\[key\]/.test(sheet),
    "沒有只列出與預設不同的車種",
  );

  /* ⑤ 每一列要寫出計畫預設是多少，使用者才對得出差在哪。 */
  assert.ok(
    /覆寫（計畫預設是 \$\{pcuFactors\[key\]\}）/.test(sheet),
    "覆寫那幾列沒有寫出計畫預設值，使用者對不出差在哪",
  );

  /* ⑥ 前置：這一段不可以動到任何數值——匯出的數字仍然來自同一組計算。 */
  assert.ok(
    !/pcuFactors\[key\]\s*=/.test(sheet) && !/scope\.factors\.core\[key\]\s*=/.test(sheet),
    "這一段只能印，不可以改任何係數",
  );
});
