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

test("renders complete traffic analysis dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of [
    "全日交通量及車種組成",
    "系統版本",
    SYSTEM_VERSION,
    "更新日期",
    SYSTEM_UPDATED_AT,
    "24小時PCU",
    "尖峰小時當量交通量",
    "平日＋假日",
    "PCU 當量係數",
    "Excel 相容性",
    "匯出備份",
    "管理季度",
    "管理計畫",
    "品質與定稿",
    "追溯與版本",
    "設定範本",
    "報表批次輸出中心",
    "路段與路口",
    "道路與流向管理",
    "車種分類與當量管理",
    "路口轉向係數",
    "新手使用手冊 PDF",
    "Word",
    // 時段車種分析（獨立區塊）
    "時段車種分析（獨立區塊）",
    "全日／上午尖峰／下午尖峰各車種車輛數、百分比與交通流量",
    "全日尖峰小時",
    "上午尖峰小時",
    "下午尖峰小時",
    "設定匯出項目",
  ])
    assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /LOS|服務水準/);
});

test("時段分析面板獨立於既有表單，且說明有引用公路容量手冊依據", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  // 面板本身
  assert.match(source, /id="periodAnalysis"/);
  assert.match(source, /className="panel period-panel"/);
  // 面板只保留重點提醒（依 2022 手冊、以 PCU 判定）；
  // 完整依據（式 2.10 尖峰小時係數、2.4.13 小客車單位量）改由新手手冊說明，
  // 這裡確保兩邊都還在，不會因為精簡文案而整個消失。
  assert.match(source, /2022 年臺灣公路容量手冊/);
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
  assert.match(periodSource, /全日尖峰 ＝ 24 小時中當量交通量\(PCU\/hr\)最大的那一小時/);
  // 新車種預設當量為 1
  assert.match(source, /const NEW_VEHICLE_DEFAULT_PCU = 1;/);
  // 匯入時不再用 window.prompt 逐一詢問當量
  assert.doesNotMatch(source, /請依序輸入 4 個數值/);
  // 匯出勾選不再被「原生圖表」條件包住
  assert.doesNotMatch(source, /if \(!exportSections\.charts\) \{\s*const groups/);
});

test("publishes the beginner manual in PDF and editable Word formats", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  for (const file of [
    `Traffic_Analysis_Beginner_Guide_${SYSTEM_VERSION}.pdf`,
    `Traffic_Analysis_Beginner_Guide_${SYSTEM_VERSION}.docx`,
  ]) {
    assert.match(source, new RegExp(file.replaceAll(".", "\\.")));
    await access(new URL(`../public/manuals/${file}`, import.meta.url));
  }
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
    "跨計畫比較",
    "PCU係數",
    "可編輯圖表",
    "Excel 2007",
    "hourlyExportRows",
    "projectComparisons",
    "compositionExportRows",
    "車種組成互動篩選",
    "平日,假日,平日＋假日",
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
    "compositionDirection",
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
  assert.doesNotMatch(source, /高雄捷運黃線交通調查（我的資料）/);
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
  assert.equal(normalizeRoadId("13545T7-01"), "13545-01");
  assert.equal(normalizeRoadId("13545T8-01"), "13545-01");
  assert.equal(surveyRoadIdFromFileName("13545T9-11-中正一路.xls"), "13545-11");
  assert.equal(
    roadNameFromFileName("13545T9-11-中正一路(福德二路~高速公路).xls"),
    "中正一路(福德二路~高速公路)",
  );
  assert.equal(
    roadNameFromFileName("13545Ｔ1－01－神農路（大同路～水管路）－11308.xls"),
    "神農路(大同路~水管路)",
  );
  assert.equal(
    roadNameFromFileName(
      "13545T1-01-神農路(大同路~水管路) 2024-08-10 修正版.xls",
    ),
    "神農路(大同路~水管路)",
  );
  assert.equal(
    roadNameMatchKey(" 神農路（大同路 ～ 水管路） "),
    roadNameMatchKey("神農路(大同路~水管路)-11308"),
  );
});
