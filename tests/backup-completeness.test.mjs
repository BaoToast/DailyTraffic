/*
 * 備份必須帶走使用者自己設定的每一樣東西。
 *
 * 起因：使用者問「結論草稿的條件範本存好之後，換一台電腦還在嗎？」
 * 查證結果是**不在**——範本存在 localStorage 的
 * traffic-conclusion-templates-v1（依計畫分開），本機有存，
 * 但 exportBackup() **沒有收**。使用者在 A 電腦存了好幾組常用條件，
 * 匯出備份帶到 B 電腦還原之後一組都沒有，而畫面只說「還原完成」。
 *
 * 這一支的作法是「清單比對」：把使用者會自己調整、換電腦時應該一起帶走的
 * 東西列出來，逐一確認備份有收。日後新增設定卻忘了收進備份，這裡就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
/*
 * ⚠️ 掃原始碼的斷言一律比對**壓平空白之後**的字串。
 *
 * 2026-09-11 的教訓：我不小心對這個檔案跑了一次 `prettier --write`
 * （這個專案本來就不是 prettier 排版），行為一個字都沒變，
 * 但它把 `A && B` 折成兩行，於是四支守門測試同時紅字——
 * 而紅字的長相是「還原條件範本前必須先確認…」這種**聽起來像功能壞了**
 * 的訊息，非常容易被誤判成真的改壞。
 *
 * 換行位置不是行為。把空白壓平之後再比對，排版怎麼變都不影響，
 * 而斷言想守的那件事（條件判斷裡確實有這兩個檢查）完全不受影響。
 */
const flat = source.replace(/\s+/g, " ");

/*
 * ⚠️ 2026-09-11 起要掃的是 buildBackupPayload()，不是 exportBackup()。
 *
 * 那一天新增了「備份全部計畫」，於是把「一個計畫要打包哪些東西」抽成
 * buildBackupPayload()，讓「本計畫」與「全部計畫」兩個按鈕共用同一份組裝邏輯。
 * 抽出來本身正是為了這支測試在守的那件事——兩邊各寫一份的話，
 * 以後新增一個要備份的欄位一定會有一邊忘記加。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ 2026-09-25 修正：抓的範圍太大，讓這一支變成一顆假的綠
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊寫法以「下一個 `\n  function `」當結尾。**實測抓到 150 行，
 * 而且含 clearLocalData()**。於是 `records`、`workflow` 等關鍵字
 * 即使從 buildBackupPayload() 的**回傳物件**裡被刪掉，只要它們出現在
 * 那 150 行的任何地方，這一支照樣綠——而它的自述是
 * 「日後新增設定卻忘了收進備份，這裡就會失敗」。
 *
 * 正解：只抓 `return {` 到對應的 `};`，也就是**真正被打包出去的那個物件**。
 * 用大括號配對而不是找下一個 function，範圍才不會被相鄰的程式污染。
 */
function exportBlock() {
  const start = source.indexOf("function buildBackupPayload(");
  assert.notEqual(start, -1, "找不到 buildBackupPayload()");
  const returnAt = source.indexOf("return {", start);
  assert.notEqual(
    returnAt,
    -1,
    "buildBackupPayload() 裡找不到 `return {`——它的形狀變了，請重新確認這一支抓的範圍",
  );
  let depth = 0;
  for (let i = source.indexOf("{", returnAt); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (!depth) {
        const block = source.slice(returnAt, i + 1);
        /*
         * ⚠️ 前置：抓出來的範圍必須合理。太大表示配對出錯（又變成假的綠），
         *   太小表示 return 物件被改寫成別的形狀。
         */
        const lines = block.split("\n").length;
        assert.ok(
          lines > 5 && lines < 90,
          `抓到 ${lines} 行——範圍不合理，這一支可能又變成假的綠`,
        );
        assert.ok(
          !block.includes("clearLocalData"),
          "抓到的範圍含 clearLocalData()，表示又抓超出 return 物件了",
        );
        /*
         * ══════════════════════════════════════════════════════════
         *  ⚠️ 一定要剝掉註解，而且要比對「`鍵:` 屬性」不是裸關鍵字
         * ══════════════════════════════════════════════════════════
         *
         * 反證時發現：把 `pcuScopes: …` 那一行從 return 物件裡刪掉之後，
         * 這一支**仍然是綠的**——因為同一段的註解裡寫著
         * 「（pcuScopes 本來就只有它的）」，裸字比對照樣命中。
         * 也就是「收斂抓取範圍」還不夠，關鍵字比對本身也是假的綠。
         *
         * 所以回傳的是**剝掉註解之後**的內容，呼叫端再比對 `鍵:`。
         */
        return block
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\s)\/\/[^\n]*/g, "$1");
      }
    }
  }
  assert.fail("buildBackupPayload() 的 return 物件括號不成對");
}

/** 每一項都是使用者自己設定的，換電腦時必須跟著走。 */
const MUST_TRAVEL = [
  "pcuFactors",
  "turnPcuFactors",
  /*
   * ⚠️ 2026-09-25 補上 pcuScopes。它是後來新增、使用者明確要求
   *   「要能被存檔匯出和匯入」的設定（依季別／路段的係數覆寫），
   *   卻一直不在這張清單裡——正是這一支要防的那種漏。
   */
  "pcuScopes",
  /*
   * ⚠️ 2026-10-03 補上 thresholdScopes。它和 pcuScopes 是**同一種東西**
   *   （依季別／路段的覆寫，使用者 09-30 裁示「做」），
   *   而我 v20.94 做完 B1 之後**沒有把它加進這張清單**——
   *   於是 `buildBackupPayload()` 整個函式裡它出現 0 次，
   *   使用者在 A 電腦設好、匯出備份、在 B 電腦還原之後**無聲消失**。
   *   是 GPT 2026-10-03 複查時抓到的，程式那一半他已經修好。
   *
   * ⚠️ **這一行補的是「判準只能有一份」。** GPT 另開了
   *   `tests/scoped-settings-dataflow.test.mjs` 守住行為（刪掉打包那一行會紅，
   *   已實測），但「哪些設定必須跟著備份走」因此有了兩個來源，
   *   而看起來最像權威清單的這一張是不完整的——
   *   下一個新增設定的人讀這裡，會以為門檻覆寫不必跟著走。
   */
  "thresholdScopes",
  "vehicleClassSettings",
  "roadAliases",
  "intersectionSettings",
  "workflow",
  "conclusionTemplates",
  "records",
];

test("匯出的備份收齊了使用者的設定", () => {
  const block = exportBlock();
  /*
   * ⚠️ 2026-09-25：比對的是「`鍵:` 這個屬性真的出現在 return 物件裡」，
   *   不是裸關鍵字。反證時實測過：只比裸字的話，把 `pcuScopes: …`
   *   那一行刪掉、而註解裡還提到它，這一支仍然是綠的。
   *   （exportBlock() 已經先剝掉註解，這裡再要求出現「鍵:」的形狀，兩道一起。）
   */
  const missing = MUST_TRAVEL.filter(
    (key) => !new RegExp(`(^|[\\s{,])${key}\\s*:`, "m").test(block),
  );
  assert.deepEqual(
    missing,
    [],
    `buildBackupPayload() 沒有收這幾項——換一台電腦還原之後它們會消失：${missing.join("、")}`,
  );
});

test("還原備份時會把條件範本寫回去", () => {
  assert.match(
    flat,
    /writeConclusionTemplates\(targetProjectId, merged\)/,
    "還原時沒有把條件範本寫回 localStorage",
  );
  assert.match(
    flat,
    /setConclusionTemplates\(merged\)/,
    "還原之後畫面上的範本清單沒有跟著更新",
  );
});

test("備份裡沒有條件範本時，不可以把這台電腦既有的範本清掉", () => {
  /*
   * 只有在備份裡「確實有而且不是空的」時才動它。舊版備份沒有這個欄位，
   * 無條件覆蓋會把使用者已經存好的範本抹掉——那比不還原更糟。
   * 而且是「併入」不是「取代」：這台電腦上原有的其他範本要留著。
   */
  assert.match(
    flat,
    /Array\.isArray\(payload\.conclusionTemplates\) && payload\.conclusionTemplates\.length/,
    "還原條件範本前必須先確認備份裡真的有這個欄位、而且不是空的",
  );
  assert.match(
    flat,
    /const existing = readConclusionTemplates\(targetProjectId\)/,
    "還原時要先讀出這台電腦既有的範本再併入，不能直接覆蓋",
  );
});

/*
 * ⚠️ 「備份全部計畫」不可以直接拿畫面上的 state 去包。
 *
 * records／roadAliases／workflow 這三樣都只載入**目前這一個計畫**
 * （見 DashboardClient 裡那幾個 useEffect）。直接包出去的話，其他計畫
 * 全部會是空的，而檔案大小看起來正常、還原也不會報錯——最難發現的那種錯。
 * 所以 exportAllBackup() 一定要自己去把每個計畫的資料抓回來。
 */
test("備份全部計畫時，每個計畫的資料是各自抓回來的，不是拿畫面上的 state", () => {
  const start = source.indexOf("async function exportAllBackup()");
  assert.notEqual(start, -1, "找不到 exportAllBackup()");
  const block = source.slice(start, source.indexOf("\n  function ", start + 30));
  assert.match(
    block,
    /api\/traffic\?projectIds=/,
    "沒有去抓各計畫的路口資料——其他計畫會是空的",
  );
  assert.match(
    block,
    /api\/roads\?projectId=/,
    "沒有去抓各計畫的路段別名",
  );
  assert.match(
    block,
    /loadWorkflow\(project\.id\)/,
    "沒有去抓各計畫的品質與定稿狀態",
  );
  assert.match(
    block,
    /readProjectPcuScopes\(project\.id\)/,
    "沒有帶各計畫的季別／路段係數覆寫",
  );
  /*
   * ⚠️ 2026-09-23 補：**PCU 係數本體**也要逐計畫讀。
   *
   *   這一條原本漏了，而漏掉的正好就是唯一出事的那一項：
   *   `buildBackupPayload()` 裡的 `pcuFactors`／`turnPcuFactors` 以前直接讀
   *   外層 state，而那兩個 state 是**逐計畫載入**的。於是「備份全部計畫」
   *   時每一份 bundle 拿到的都是**目前畫面上那個計畫**的係數；
   *   還原之後所有計畫的 PCU 變成同一組，而檔案大小正常、還原不報錯。
   *
   *   上面那幾條之所以抓不到，是因為它們檢查的是「有沒有逐計畫去抓」，
   *   而係數那一項根本沒有出現在這個區塊裡——**沒寫的東西不會被 match 到**。
   *   清單式守門一定要連「應該出現而沒出現」一起列。
   */
  assert.match(
    block,
    /readProjectPcuFactors\(project\.id\)/,
    "沒有逐計畫讀 PCU 係數——每個計畫的備份會寫成目前畫面上那個計畫的係數",
  );
  assert.match(
    block,
    /readProjectTurnPcuFactors\(project\.id\)/,
    "沒有逐計畫讀轉向 PCU 係數——同上",
  );
  assert.match(
    block,
    /buildBackupPayload\(/,
    "沒有共用 buildBackupPayload()——兩份組裝邏輯遲早會不一致",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  buildBackupPayload() 不可以從閉包讀「逐計畫」的 state
 * ══════════════════════════════════════════════════════════════════════
 *
 * 上面那一支看**呼叫端**有沒有去讀；這一支看**收款端**有沒有真的用傳進來的值。
 * 兩邊都要守，因為只守其中一邊都會留下同一個洞：
 *   ・只守呼叫端 → 讀回來了卻沒傳進去，一樣是舊值
 *   ・只守收款端 → 型別上收得到，但呼叫端沒給
 *
 * ⚠️ 判定刻意是「回傳物件裡那兩個鍵必須寫成 `input.xxx`」。
 *   寫成裸的 `pcuFactors,`（物件簡寫）就是從閉包讀，那正是原本的錯。
 */
test("buildBackupPayload() 的 PCU 係數一定是由 input 傳進來的", () => {
  const block = exportBlock();
  for (const key of ["pcuFactors", "turnPcuFactors"]) {
    assert.match(
      block,
      new RegExp(`${key}:\\s*input\\.${key}`),
      `buildBackupPayload() 的 ${key} 不是取自 input——` +
        "從閉包讀的話，備份全部計畫時每一份都會是目前那個計畫的係數",
    );
    assert.doesNotMatch(
      block,
      new RegExp(`^\\s+${key},\\s*$`, "m"),
      `buildBackupPayload() 仍有裸的 \`${key},\`（物件簡寫＝從閉包讀）`,
    );
  }
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  「還原本計畫」與「還原全部計畫」對 workflow 的處理必須一致
 * ══════════════════════════════════════════════════════════════════════
 *
 * `restoreAllProjects()` 走的是 `saveWorkflow(newId, bundle.workflow)`——
 * 整份存回去，所以 workflow 裡的每一樣都會回來。
 * `importBackup()` 走的是逐欄位合併，2026-09-23 之前只挑
 * statuses／checkedQuarters／history 三樣，於是**同一份備份檔**：
 *   ・走「還原全部計畫」→ 已人工確認、指定調查日期、比較報表範本都在
 *   ・走「還原本計畫」　→ 三樣全部不見，而畫面只寫「已還原 N 個季度」
 *
 * ⚠️ 門檻（thresholds）刻意**不**還原：它是「這台電腦目前的設定」，
 *   不屬於任何一個季度，不該被一份舊備份改掉。這是已定案的行為，
 *   下面那條反面斷言就是在守它不要被順手加回去。
 */
test("還原本計畫時，使用者親手按出來的東西也要跟著回來", () => {
  const start = source.indexOf("if (payload.workflow) {");
  assert.notEqual(start, -1, "找不到 importBackup() 裡的 workflow 還原區塊");
  /*
   * ⚠️ 只看**回傳的那個物件**，不是整個區塊。
   *   看整個區塊的話，把 key 算出來卻忘了放進回傳值（第一版就是這樣寫的），
   *   上面那幾個 const 宣告會讓斷言照樣綠——那就是一個假的綠。
   */
  const scope = source.slice(start, source.indexOf("\n      }", start));
  const returnAt = scope.lastIndexOf("return {");
  assert.notEqual(returnAt, -1, "workflow 還原區塊裡找不到 return {");
  const block = scope.slice(returnAt);
  for (const [key, why] of [
    ["ackedAnomalies", "按過的「已人工確認」會全部歸零，異常清單整批重新冒出來"],
    ["surveyDateOverrides", "所有「指定調查日期」的覆寫會消失，明細退回原始判讀"],
    ["comparisonReports", "存好的比較報表範本一個都不會回來"],
  ])
    assert.ok(
      new RegExp(`\\b${key}\\b`).test(block),
      `還原本計畫時沒有處理 ${key}——${why}（「還原全部計畫」那條路徑卻會回來）`,
    );
  assert.ok(
    !/\bthresholds\b/.test(block),
    "還原本計畫時動到了 thresholds——那是這台電腦目前的設定，" +
      "不屬於任何一個季度，不該被一份舊備份改掉（已定案，不要加回來）",
  );
});

/*
 * ⚠️ 還原多個計畫時，共用的那兩份 localStorage 陣列要**累加**，
 *   而且累加器必須在迴圈外面。
 *
 * 實測踩過：迴圈裡每一輪都從閉包裡那份舊的 vehicleClassSettings 接新的，
 * setState 不會更新閉包變數，於是第二輪把第一輪加進去的整組蓋掉。
 * 筆數、季度、PCU 係數全部正確，只有車種分類默默不見，不會有任何訊息。
 */
test("還原多個計畫時，車種分類與路口幾何是累加的，不會互相覆蓋", () => {
  const start = source.indexOf("async function restoreAllProjects(");
  assert.notEqual(start, -1, "找不到 restoreAllProjects()");
  /*
   * ⚠️ 要先把註解拿掉再比對。
   *   這一段的註解裡**引用了錯誤寫法當例子**
   *   （「第一版是在迴圈裡寫 [...vehicleClassSettings, ...新的]」），
   *   不濾掉的話，下面那條「不可以再讀閉包舊值」會被自己的說明文字踩紅。
   */
  const block = source
    .slice(start, source.indexOf("\n  async function ", start + 30))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  assert.match(
    block,
    /let nextVehicleClass = vehicleClassSettings/,
    "累加器不在迴圈外面——後一個計畫會蓋掉前一個的車種分類設定",
  );
  assert.match(
    block,
    /let nextIntersection = intersectionSettings/,
    "累加器不在迴圈外面——後一個計畫會蓋掉前一個的路口幾何設定",
  );
  assert.ok(
    !/\[\s*\.\.\.vehicleClassSettings\s*,/.test(block),
    "迴圈裡還在讀 vehicleClassSettings（閉包裡的舊值），必須用累加器",
  );
});
