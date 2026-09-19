import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
/*
 * 版號與更新日期一律從程式裡取，不要在測試裡再寫死一份——
 * 寫死的話每次升版都得記得同步改這裡，忘了就是「測試失敗但程式其實是對的」。
 */
import { SYSTEM_VERSION, SYSTEM_UPDATED_AT } from "../app/system-release.ts";
import {
  normalizeRoadId,
  roadNameFromFileName,
  roadNameMatchKey,
  surveyRoadIdFromFileName,
} from "../app/road-identity.ts";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

/*
 * ⚠️ v20.64 起這一支只驗「**每一頁都看得到**的東西」。
 *
 * 五個分區從「同一頁的錨點」改成**真的換頁**（使用者 2026-09-09 指名），
 * 所以伺服器端算繪出來的只有預設那一頁（資料匯入）加上分頁之外的共用區塊。
 * 「尖峰小時當量交通量」「PCU 當量係數」這些在別的分頁上，這裡當然看不到。
 *
 * ⚠️ 這些斷言**不是被刪掉，是搬家**：改由 scripts/e2e-tabs.mjs 逐頁點過去
 * 實測（那支才問得到「切到第三頁之後看不看得到」）。
 * 只在這裡刪掉而不補 E2E，等於這幾項從此沒有人守。
 */
test("每一頁都看得到的共用區塊：品牌、版號、工具列、篩選列", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of [
    /*
     * ⚠️ X-68（使用者 2026-09-17）：頁首那條藍色橫幅整條拿掉，
     *   系統名稱與版號搬到側欄左上角的 .brand。所以這裡改驗新的位置：
     *   ・招牌上的名稱是「全日交通量」（副標另外一行，不再是完整長名）
     *   ・版號與更新日期仍然在畫面上（徽章），只是不再寫「系統版本／更新日期」
     *     那兩個字——那是舊橫幅的字樣。
     *   ⚠️ 不可以只把這幾行刪掉了事：刪掉等於「版號有沒有出現在畫面上」
     *     從此沒有人守，而那正是這一支測試存在的理由。
     */
    "brand-mark",
    "全日交通量",
    SYSTEM_VERSION,
    SYSTEM_UPDATED_AT,
    /* 工具列（分頁之外） */
    "匯出備份",
    /*
     * ⚠️ X-71：「管理季度」那顆鈕與那個視窗整個移除（與「刪除單一季度」重複）。
     *   改名功能沒有一起弄丟——它獨立成「季度改名」那一塊。
     *   ⚠️ 但**不能**在這裡驗「季度改名」：伺服器端只渲染預設那一頁，
     *   而那一塊在「還原與備份」頁上；X-73 之後小分頁也只展開目前這一頁的。
     *   這裡驗側欄上一定在的那顆大分頁鈕，那一塊的存在由
     *   tests/maintenance-page.test.mjs 與 e2e-maintenance 守。
     */
    "還原與備份",
    "管理計畫",
    /*
     * ⚠️ 2026-09-17：側欄的「品質與定稿（已移到資料維護）」整項移除
     *   （使用者：「這個分頁就可以拿掉了，不用備註顯現」）。
     *   內容一個都沒少，全部在「五　資料產出與維護」底下。
     *
     * ⚠️ X-73 之後側欄是**手風琴**：只有目前那一頁的小分頁會列出來，
     *   而伺服器端渲染的是預設頁，所以「資料異常檢查摘要／異常提醒門檻」
     *   這種小分頁名稱在這一份 HTML 裡本來就不會出現——
     *   繼續驗它們等於驗一個永遠不成立的條件。
     *   改成驗它們所屬的**大分頁**（那一層一律列出），
     *   小分頁本身由 tests/maintenance-page.test.mjs 與 e2e-maintenance 守。
     */
    "資料異常檢查",
    /* v20.64 移除「設定範本」（使用者 2026-09-09 授權），工具列從 9 顆變 8 顆。 */
    "報表批次輸出中心",
    /*
     * ⚠️ 這裡原本還有一項 "Word"。2026-09-11 起手冊只出 PDF
     *   （使用者：「新手手冊只需要做 PDF 檔就好」），那顆按鈕已移除。
     *   反面守門（畫面上不可以再冒出 .docx 連結）在 release-metadata。
     */
    "下載新手手冊",
    /* 篩選列（分頁之外，五頁共用） */
    "平日＋假日",
    "搜尋調查點",
    /* 分頁導覽本身 */
    "分頁導覽",
  ])
    assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /LOS|服務水準/);
  /*
   * ⚠️ 反面：「版本差異與還原」自 2026-09-16 起**不可以**出現在畫面上
   *   （使用者：「使用者不須要從畫面查看」）。還原點本身照常寫入——
   *   那一半由 scripts/e2e-restore-point 之類的實測守，不是這裡。
   *   只刪掉上面那一行而不補這一條的話，哪天有人加回去也不會紅。
   */
  assert.doesNotMatch(html, /版本差異與還原/);
});

test("分頁導覽要有五顆，而且預設停在第一頁", async () => {
  const response = await render();
  const html = await response.text();
  const buttons = html.match(/data-goto="zone-[a-z]+"/g) ?? [];
  assert.equal(buttons.length, 5, `分頁按鈕應該有 5 顆，實際 ${buttons.length}`);
  /* 預設是「資料匯入」——沒有資料時只有那一頁有事可做。 */
  assert.match(
    html,
    /aria-current="page"[^>]*data-goto="zone-import"|data-goto="zone-import"[^>]*aria-current="page"/,
  );
});

test("換頁之後，別頁的內容不可以還留在 DOM 裡（否則等於沒換頁）", async () => {
  /*
   * ⚠️ 這一項是「真的換頁」的反面證明。
   * 少了它，把 {view === ...} 改回永遠為真也一樣會通過所有其他測試，
   * 而使用者要的「這個畫面獨屬於它」就悄悄沒了。
   */
  const response = await render();
  const html = await response.text();
  /*
   * ⚠️ 要先把側欄導覽剪掉再比對。
   *   v20.64 起側欄會把**每一個歸類底下的區塊名稱**都列出來
   *  （使用者要求：「看不出歸類下面有什麼資料」），
   *   所以「PCU 當量係數」這種字串本來就會出現在側欄裡。
   *   不剪掉的話這一項會變成紅字，而它其實是導覽做對了。
   *   剪的是導覽，不是整個側欄——要驗的是**內容區**有沒有洩漏別頁。
   */
  const nav = /<nav class="side-nav"[\s\S]*?<\/nav>/.exec(html);
  assert.ok(nav, "找不到側欄導覽——選擇器改了就要同步改這裡，不可以讓它靜靜地不比對");
  const body = html.replace(nav[0], "");
  for (const otherPage of [
    "尖峰小時當量交通量", // 第三頁
    "PCU 當量係數", // 第二頁
    "時段車種分析（獨立區塊）", // 第五頁
  ])
    assert.doesNotMatch(
      body,
      new RegExp(otherPage),
      `「${otherPage}」不在第一頁，不該出現在預設算繪的 HTML 裡`,
    );
});

test("時段分析面板獨立於既有表單，且說明有引用公路容量手冊依據", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  // 面板本身
  assert.match(source, /id="periodAnalysis"/);
  /*
   * ⚠️ 2026-09-11 起 className 走 focusClass()——側欄點名要能把這張卡片
   *   框起來，所以不再是寫死的字串字面值。這裡改成只確認「類別還在」，
   *   不綁它是怎麼組出來的；類別名稱本身才是這條在守的東西。
   */
  assert.match(source, /"panel period-panel"/);
  // 面板只保留重點提醒（依 2022 手冊、以 PCU 判定）；
  // 完整依據（式 2.10 尖峰小時係數、2.4.13 小客車單位量）改由新手手冊說明，
  // 這裡確保兩邊都還在，不會因為精簡文案而整個消失。
  /*
   * ⚠️ `\s*` 不是可有可無的。
   *   2026-09-11 我不小心對 DashboardClient.tsx 跑了一次 prettier，
   *   它把 `2022 年臺灣公路容量手冊` 折成兩行（JSX 會把換行收成空白，
   *   畫面上一個字都沒變），這條就紅了，訊息看起來像「手冊依據被拿掉了」。
   *   畫面上的文字不該被原始碼的換行位置綁住。
   */
  assert.match(source, /2022\s*年臺灣公路容量手冊/);
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  assert.match(manual, /式\s*2\.10/);
  assert.match(manual, /2\.4\.13/);
  // 四種時段的定義說明
  const periodSource = await readFile(
    new URL("../app/period-analysis.ts", import.meta.url),
    "utf8",
  );
  assert.match(periodSource, /上午尖峰 ＝ 起始時間在中午 12:00 之前/);
  assert.match(periodSource, /下午尖峰 ＝ 起始時間在中午 12:00 之後（含 12:00）/);
  /*
   * ⚠️ 2026-09-12 加的兩條：分界**固定在中午、不提供設定**這件事要寫在
   *   原始碼裡，而且要寫出「橫跨中午的視窗另外問使用者」。
   *   這兩句是使用者拍板的結論（他一度要求可設定，討論後自己收回），
   *   少了它，日後有人又會把可設定的欄位加回來。
   */
  assert.match(periodSource, /固定在中午 12:00，不提供設定/);
  assert.match(periodSource, /export const NOON_MINUTES/);
  /*
   * ⚠️ v20.64 起這一句的內容變了，不只是換名字：
   *   舊：「全日尖峰 ＝ 24 小時中……最大的那一小時」
   *   新：「全調查時段尖峰 ＝ 在同一段涵蓋裡……最大的那一小時」
   *   要驗的是**認定方式有寫出來**，而且沒有再宣稱一定是 24 小時。
   */
  assert.match(
    periodSource,
    /全調查時段尖峰 ＝ 在同一段涵蓋裡，當量交通量\(PCU\/hr\)最大的那一小時/,
  );
  assert.doesNotMatch(
    periodSource,
    /全調查時段尖峰 ＝ 24 小時中/,
    "還寫著「24 小時中」——那是舊口徑，不足 24 小時的調查也算得出來了",
  );
  // 新車種預設當量為 1
  assert.match(source, /const NEW_VEHICLE_DEFAULT_PCU = 1;/);
  // 匯入時不再用 window.prompt 逐一詢問當量
  assert.doesNotMatch(source, /請依序輸入 4 個數值/);
  // 匯出勾選不再被「原生圖表」條件包住
  assert.doesNotMatch(source, /if \(!exportSections\.charts\) \{\s*const groups/);
});

test("新手手冊只出 PDF，而且畫面上的連結指向真的存在的那一份", async () => {
  /*
   * ⚠️ 這一支原本叫 "publishes the beginner manual in PDF and editable Word
   *   formats"，同時要求 .pdf 與 .docx 都存在。
   *
   *   使用者 2026-09-11：「新手手冊只需要做 PDF 檔就好……三個程式都同步，
   *   只需要 PDF 檔就好。」路口轉向在 v2.1.64 就已經因為同一句話改掉了，
   *   這一支是最後一個還在出 Word 的。
   *
   *   ⚠️ 反面那一條（不可以再冒出 .docx 連結）放在
   *     tests/release-metadata.test.mjs；這裡只守正面：
   *     連結指到的那個檔案要真的在。
   */
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  const file = `全日交通流量程式手冊_${SYSTEM_VERSION}.pdf`;
  assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
  await access(new URL(`../public/manuals/${file}`, import.meta.url));
});

test("keeps configurable factors, legacy Excel and all editable chart datasets", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  for (const token of [
    "type DayMode",
    "traffic-pcu-factors-v1",
    "套用係數",
    "恢復預設",
    'bookType: "biff8"',
    "addNativeCharts",
    "drawing1.xml",
    "xl/charts/chart",
    "每小時趨勢",
    "PCU係數",
    "可編輯圖表",
    "Excel 2007",
    "hourlyExportRows",
    "compositionExportRows",
    "車種組成互動篩選",
    /* F-30（2026-09-18）：下拉不再有「平日＋假日」合計選項 */
    "平日,假日",
    "比例",
    "D8E7F1",
    "analysisVehicleCatalog",
    "chartCompositionStart",
    "detectedSheetIndex",
  ])
    assert.match(
      source,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  for (const token of [
    "ensurePersistentProject",
    "traffic-analysis-backup",
    "importBackup",
    "/api/quarters",
    "資料會保存在目前瀏覽器",
  ])
    assert.match(source, new RegExp(token));
  for (const token of [
    "尚未建立計畫",
    "建立第一個交通調查計畫",
    "覆蓋只影響相同",
    "已追加匯入",
    "請先按左側＋建立並命名計畫",
  ])
    assert.match(source, new RegExp(token));
  for (const token of [
    "validateImport",
    "detectAnomalies",
    "completenessSummary",
    "原始來源追溯",
    "匯入與版本紀錄",
    "restoreHistory",
    "設定範本",
    "報表批次輸出中心",
    "comparisonReports",
    "定稿後",
  ])
    assert.match(source, new RegExp(token));
  for (const token of [
    "renameProject",
    "deleteProject",
    "管理計畫",
    "刪除整個計畫",
    /*
     * ⚠️ v20.68 起車種組成**沒有自己的方向 state**（compositionDirection
     *   已移除）——它和其他三張圖一樣讀共同功能列的 directions。
     *   使用者 2026-09-12：「我以為我篩的是A條件，結果卻是其他功能列B的
     *   條件，結果一樣嚴重」。所以這裡改成釘「面板上仍然有方向篩選」
     *   這件事本身，而不是釘一個已經不該存在的變數名。
     */
    /*
     * ⚠️ v20.74 起 renderBlockFilters 多吃一個 chartId（各區塊可以脫離
     *   主工具列），呼叫因此換行寫。守門要釘的仍然是
     *   「車種組成面板上有日別、調查點、方向三個篩選」這件事本身，
     *   不是它寫在同一行還是三行。
     */
    "\\{ day: true, road: true, direction: true \\},\\s*CHART_COMPOSITION,",
    "compositionScopeText",
    "全部方向",
  ])
    assert.match(source, new RegExp(token));
  for (const token of [
    "saveRoadSettings",
    "mergeRoad",
    "路口名稱管理",
    "路段名稱管理",
    "方向 A 名稱",
    "新增檔名別名",
    "預覽並合併",
    "影響季度",
    "roadAliases",
  ])
    assert.match(source, new RegExp(token));
  for (const token of [
    "turnPcuFactors",
    "traffic-turn-pcu-factors-v1",
    "openIntersectionManager",
    "autoMapIntersection",
    "classifyMovement",
    "IntersectionGeometryDiagram",
    "依角度重新判定",
    "駛出路口",
    "intersectionFlowMode",
    "deriveDestinationIntersectionRecords",
    "駛出目的支線",
    "路口駛出對應",
    "dropImportFiles",
    "拖曳 Excel 檔案",
  ])
    assert.match(source, new RegExp(token));
  for (const token of [
    "traffic-vehicle-class-settings-v1",
    "ensureImportedVehicleSettings",
    "openVehicleClassManager",
    "動態車種管理",
    "獨立分析",
    "歸類至",
    "原始數量不會被改寫",
  ])
    assert.match(source, new RegExp(token));
  assert.match(source, /type="number"\s+step="any"/);
  assert.doesNotMatch(source, /min="0\.01" step="0\.1"/);
  // 係數不設下限：不可出現任何「必須大於 0」之類的阻擋式驗證。
  // v20.4 起允許存檔後以提示文字提醒 0／負數的風險，但不會擋下存檔，
  // 因此這裡只禁止阻擋式訊息，不再禁止單純的比較運算。
  assert.doesNotMatch(
    source,
    /PCU係數都必須大於\s*0|PCU係數必須是大於\s*0|必須是大於 0 的數字/,
  );
  assert.match(source, /有 0 或負數的 PCU 係數/);
  assert.doesNotMatch(source, /const targetCode = setting/);
  assert.match(
    source,
    /if \(!quarters\.includes\(quarter\)\) setQuarter\(quarters\.at\(-1\)/,
  );
  /*
   * 這一行原本是 `assert.doesNotMatch(source, /privaterelay\.appleid\.com/i)`。
   *
   * 它是**恆真的假檢查**：整個倉庫（含 v20.52 與 v20.53）從來沒有出現過
   * 那個字串，DashboardClient.tsx 也不會有理由出現一個 Apple 的隱藏信箱網域，
   * 所以它不可能失敗，加了等於沒加。而它取代掉的是一項真的檢查——
   * 「畫面原始碼裡不可以寫死委託案的計畫名稱」。
   *
   * 內建示範資料已在 v20.53 匿名化，那個舊字串確實不會再出現；但正確的做法
   * 是把守門改成盯**現在該守的東西**，不是換成一個永遠不會紅的字串。
   * 這裡改成：畫面原始碼不可以寫死任何計畫名稱字面值——計畫名稱一律來自
   * 使用者建立的資料或 traffic-data.json，不該出現在元件裡。
   *
   * 實測：把 `const demo = "示範交通量調查";` 種進 DashboardClient.tsx → 紅字；
   *       移除 → 綠。
   */
  assert.doesNotMatch(source, /["'`]示範交通量調查["'`]/);
  assert.doesNotMatch(source, /["'`]高雄捷運黃線交通調查/);
  assert.doesNotMatch(source, /addImage\(/);
  for (const token of [
    "<c:dLbls>",
    'showCatName val="1"',
    'showPercent val="1"',
    'showLeaderLines val="1"',
  ])
    assert.match(
      source,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  // v20.10：甜甜圈圖不可帶 c:dLblPos——Excel 會判定檔案毀損並要求修復，
  // 修復後整份圖表會被丟掉，使用者看到的就是「只有數字、沒有圖」。
  assert.doesNotMatch(source, /dLblPos/);
  // CT_DoughnutChart 的順序：firstSliceAng 必須排在 holeSize 之前。
  assert.match(
    source,
    /<c:firstSliceAng val="270"\/><c:holeSize val="58"\/>/,
  );
  // 圖片框要有實際的位置與尺寸，不能是空的 <xdr:xfrm/>
  assert.doesNotMatch(source, /<xdr:xfrm\/>/);
});

test("normalizes the same road across quarterly survey batch codes", () => {
  assert.equal(normalizeRoadId("999996T7-01"), "999996-01");
  assert.equal(normalizeRoadId("999996T8-01"), "999996-01");
  assert.equal(surveyRoadIdFromFileName("999996T9-11-示範甲路.xls"), "999996-11");
  assert.equal(
    roadNameFromFileName("999996T9-11-示範甲路(示範乙路~示範丙路).xls"),
    "示範甲路(示範乙路~示範丙路)",
  );
  assert.equal(
    roadNameFromFileName("999996Ｔ1－01－示範丁路（示範戊路～示範己路）－11308.xls"),
    "示範丁路(示範戊路~示範己路)",
  );
  assert.equal(
    roadNameFromFileName(
      "999996T1-01-示範丁路(示範戊路~示範己路) 2024-08-10 修正版.xls",
    ),
    "示範丁路(示範戊路~示範己路)",
  );
  assert.equal(
    roadNameMatchKey(" 示範丁路（示範戊路 ～ 示範己路） "),
    roadNameMatchKey("示範丁路(示範戊路~示範己路)-11308"),
  );
});
