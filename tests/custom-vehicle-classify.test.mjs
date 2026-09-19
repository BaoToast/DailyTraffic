import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveVehicleCounts,
  missingVehicleFactors,
  sumVehicleCounts,
  sumVehiclePcu,
} from "../app/vehicle-analysis.ts";
import { vehiclePcuBreakdown } from "../app/period-analysis.ts";
import { readFileSync } from "node:fs";

/*
 * ── 自訂車種不論怎麼歸類，計算都要對 ──
 *
 * 起因：使用者的調查檔車種欄寫的是「聯結車」。它不在內建的四大車種表裡，
 * 會被當成自訂車種（custom:聯結車）匯入，當量係數預設為 1，
 * 由使用者在「車種分類與新增當量」自行決定：
 *
 *   (a) 歸類回「特種車」——多數人會這樣做
 *   (b) 保留成獨立車種，自己給一組係數——別的使用者可能這樣做
 *
 * 使用者要求：**兩種做法在計算上都不可以出問題。**
 * 這一組就是在守這件事，四個面向：
 *
 *   1. 歸類回特種車 ≡ 原始檔本來就寫「特種車」（PCU 與輛數都要相同）
 *   2. 保留成獨立車種時，用的是使用者自己給的係數，不是 0、也不是核心係數
 *   3. 不論哪一種，**車輛數合計都不變**（歸類只影響分組，不影響總量）
 *   4. 路段格式與路口轉向格式**兩條路徑都要**——路口格式走的是轉向係數，
 *      和路段格式是完全不同的分支
 *
 * 另外釘住一件事：算 PCU 的邏輯**只能有一份實作**。
 * v20.33 以前有兩份（vehicle-analysis 的 sumVehiclePcu、period-analysis 的
 * vehiclePcuBreakdown），規則相同但各自維護。它們沒有出過錯，但一份改了
 * 另一份沒改，畫面上就會出現「總量那一格」與「時段分析那一格」對不起來
 * ——而且只有自訂車種會不一樣，最不容易被發現。
 * 現在兩者都走 vehiclePcuByTarget()，下面最後一項守住它不會再被拆回兩份。
 */

const CORE = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const CORE_TURNS = {
  motorcycle: { through: 0.3, right: 0.4, left: 0.5 },
  small: { through: 1, right: 1.3, left: 1.5 },
  large: { through: 1.5, right: 2, left: 2.3 },
  special: { through: 2, right: 2.3, left: 2.5 },
};

/** 一筆路段紀錄：機車、小型車、大型車，外加「聯結車」這個自訂車種。 */
function roadRecord() {
  return {
    projectId: "P1",
    surveyType: "road",
    motorcycle: 100,
    small: 200,
    large: 30,
    special: 0,
    vehicleCounts: {
      motorcycle: 100,
      small: 200,
      large: 30,
      "custom:聯結車": 7,
    },
    vehicleLabels: {
      motorcycle: "機車",
      small: "小型車",
      large: "大型車",
      "custom:聯結車": "聯結車",
    },
  };
}

/** 同樣的量，但原始檔的車種欄直接寫「特種車」——本來就是內建四大類。 */
function roadRecordAsSpecial() {
  return {
    projectId: "P1",
    surveyType: "road",
    motorcycle: 100,
    small: 200,
    large: 30,
    special: 7,
    vehicleCounts: {
      motorcycle: 100,
      small: 200,
      large: 30,
      special: 7,
    },
  };
}

function intersectionRecord() {
  return {
    projectId: "P1",
    surveyType: "intersection",
    motorcycle: 60,
    small: 90,
    large: 12,
    special: 0,
    vehicleCounts: {
      motorcycle: 60,
      small: 90,
      large: 12,
      "custom:聯結車": 9,
    },
    vehicleLabels: { "custom:聯結車": "聯結車" },
    turnData: {
      motorcycle: { left: 10, through: 40, right: 10 },
      small: { left: 20, through: 50, right: 20 },
      large: { left: 2, through: 8, right: 2 },
      special: { left: 0, through: 0, right: 0 },
      "custom:聯結車": { left: 2, through: 5, right: 2 },
    },
  };
}

function intersectionRecordAsSpecial() {
  return {
    projectId: "P1",
    surveyType: "intersection",
    motorcycle: 60,
    small: 90,
    large: 12,
    special: 9,
    vehicleCounts: { motorcycle: 60, small: 90, large: 12, special: 9 },
    turnData: {
      motorcycle: { left: 10, through: 40, right: 10 },
      small: { left: 20, through: 50, right: 20 },
      large: { left: 2, through: 8, right: 2 },
      special: { left: 2, through: 5, right: 2 },
    },
  };
}

/** (a) 歸類回特種車。 */
const MERGED_TO_SPECIAL = [
  {
    projectId: "P1",
    sourceKey: "custom:聯結車",
    sourceLabel: "聯結車",
    targetKey: "special",
    targetLabel: "特種車",
    /*
     * 這兩個是建立設定當下複製過來的**快照**，而且刻意寫成錯的值。
     * 歸類回四大類的列，實際計算必須讀外部的核心係數（CORE / CORE_TURNS），
     * 不是讀這份快照——否則使用者之後調整了 PCU 係數，這一列會停在舊值。
     */
    roadPcu: 999,
    turnPcu: { left: 999, through: 999, right: 999 },
  },
];

/** (b) 保留成獨立車種，使用者自己給一組係數。 */
const INDEPENDENT = [
  {
    projectId: "P1",
    sourceKey: "custom:聯結車",
    sourceLabel: "聯結車",
    targetKey: "custom:聯結車",
    targetLabel: "聯結車",
    roadPcu: 3,
    turnPcu: { left: 3.2, through: 2.8, right: 3 },
  },
];

/** 兩份 PCU 實作必須給出同一個答案。 */
function bothImplementations(record, settings) {
  const a = sumVehiclePcu(record, CORE, CORE_TURNS, settings);
  const breakdown = vehiclePcuBreakdown(record, {
    core: CORE,
    coreTurns: CORE_TURNS,
    settings,
  });
  const b = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  assert.ok(
    Math.abs(a - b) < 1e-9,
    `sumVehiclePcu 與 vehiclePcuBreakdown 給出不同答案：${a} vs ${b}` +
      "——同一件事有兩份實作，其中一份漂掉了",
  );
  return { total: a, breakdown };
}

test("路段格式：歸類回特種車，等同於原始檔本來就寫特種車", () => {
  const merged = bothImplementations(roadRecord(), MERGED_TO_SPECIAL);
  const native = bothImplementations(roadRecordAsSpecial(), []);
  assert.equal(
    merged.total,
    native.total,
    "歸類之後的 PCU 必須和原本就是特種車完全相同",
  );
  /* 100×0.5 + 200×1 + 30×1.5 + 7×2.5 = 50 + 200 + 45 + 17.5 = 312.5 */
  assert.equal(merged.total, 312.5);
  /* 快照寫著 999，但實際計算讀的是外部係數 2.5——不可以吃到快照。 */
  assert.notEqual(merged.total, 100 * 0.5 + 200 + 30 * 1.5 + 7 * 999);
  /* 分組也要一樣：聯結車的量併進 special。 */
  assert.deepEqual(effectiveVehicleCounts(roadRecord(), MERGED_TO_SPECIAL), {
    motorcycle: 100,
    small: 200,
    large: 30,
    special: 7,
  });
});

test("路段格式：保留成獨立車種時，用的是使用者自己給的係數", () => {
  const { total, breakdown } = bothImplementations(roadRecord(), INDEPENDENT);
  /* 100×0.5 + 200×1 + 30×1.5 + 7×3 = 50 + 200 + 45 + 21 = 316 */
  assert.equal(total, 316);
  assert.equal(breakdown["custom:聯結車"], 21);
  /* 獨立車種不可以被併進四大類的任何一格。 */
  assert.equal(breakdown.special ?? 0, 0);
  assert.deepEqual(effectiveVehicleCounts(roadRecord(), INDEPENDENT), {
    motorcycle: 100,
    small: 200,
    large: 30,
    "custom:聯結車": 7,
  });
});

test("路口轉向格式：歸類回特種車，等同於原始檔本來就寫特種車", () => {
  const merged = bothImplementations(intersectionRecord(), MERGED_TO_SPECIAL);
  const native = bothImplementations(intersectionRecordAsSpecial(), []);
  assert.equal(
    merged.total,
    native.total,
    "路口格式走的是轉向係數，這條路徑也必須一致",
  );
  /*
   * 機車 10×0.5 + 40×0.3 + 10×0.4 = 5 + 12 + 4 = 21
   * 小型車 20×1.5 + 50×1 + 20×1.3 = 30 + 50 + 26 = 106
   * 大型車 2×2.3 + 8×1.5 + 2×2 = 4.6 + 12 + 4 = 20.6
   * 聯結車（＝特種車）2×2.5 + 5×2 + 2×2.3 = 5 + 10 + 4.6 = 19.6
   * 合計 167.2
   */
  assert.ok(Math.abs(merged.total - 167.2) < 1e-9, String(merged.total));
});

test("路口轉向格式：保留成獨立車種時，用的是使用者自己給的轉向係數", () => {
  const { total, breakdown } = bothImplementations(
    intersectionRecord(),
    INDEPENDENT,
  );
  /* 聯結車 2×3.2 + 5×2.8 + 2×3 = 6.4 + 14 + 6 = 26.4；其餘同上 21+106+20.6 */
  assert.ok(
    Math.abs(breakdown["custom:聯結車"] - 26.4) < 1e-9,
    String(breakdown["custom:聯結車"]),
  );
  assert.ok(Math.abs(total - (21 + 106 + 20.6 + 26.4)) < 1e-9, String(total));
});

test("不論怎麼歸類，車輛數合計都不變", () => {
  for (const record of [roadRecord(), intersectionRecord()]) {
    const raw = sumVehicleCounts(record);
    for (const settings of [MERGED_TO_SPECIAL, INDEPENDENT, []]) {
      const grouped = Object.values(
        effectiveVehicleCounts(record, settings),
      ).reduce((sum, value) => sum + value, 0);
      assert.equal(
        grouped,
        raw,
        "歸類只改變分組，不可以改變總輛數",
      );
    }
  }
});

test("完全沒有設定係數的自訂車種會被抓出來，不會靜靜當成 0", () => {
  /*
   * 沒有設定時 factorFor 回 undefined，PCU 會算成 0——那是「不知道」，
   * 不是「這種車不佔道路空間」。所以一定要有地方提醒使用者去設定。
   * 匯入流程本身會自動建立一筆預設係數 1 的設定並提示，
   * 這一項守的是「萬一那份設定不見了，畫面仍然說得出話」。
   */
  const missing = missingVehicleFactors([roadRecord()], []);
  assert.deepEqual(missing, [{ key: "custom:聯結車", label: "聯結車" }]);
  /* 設定齊全時就不該再提醒。 */
  assert.deepEqual(missingVehicleFactors([roadRecord()], INDEPENDENT), []);
  assert.deepEqual(missingVehicleFactors([roadRecord()], MERGED_TO_SPECIAL), []);
  /* 內建四大類永遠不需要使用者設定。 */
  assert.deepEqual(missingVehicleFactors([roadRecordAsSpecial()], []), []);
});

test("兩份 PCU 實作在每一種組合下都給出同一個答案", () => {
  /*
   * 這一項是總結：上面每個情境都已經呼叫 bothImplementations 比對過，
   * 這裡再把「沒有任何設定」與「係數為 0」兩個邊界補齊。
   */
  const zeroFactor = [
    {
      ...INDEPENDENT[0],
      roadPcu: 0,
      turnPcu: { left: 0, through: 0, right: 0 },
    },
  ];
  for (const record of [roadRecord(), intersectionRecord()])
    for (const settings of [[], zeroFactor, MERGED_TO_SPECIAL, INDEPENDENT])
      bothImplementations(record, settings);
});

test("算 PCU 只能有一份實作，period-analysis 不可以再自己寫一次", () => {
  /* 註解要先拿掉再比對，不然「說明舊版怎麼做」的註解本身會被當成缺陷。 */
  const source = readFileSync(
    new URL("../app/period-analysis.ts", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(
    source,
    /vehiclePcuByTarget/,
    "period-analysis 沒有走共用的 vehiclePcuByTarget",
  );
  /*
   * 舊版是就地跑一次「核心車種讀 coreTurns、自訂車種讀 setting.turnPcu」的迴圈。
   * 那一段一旦回來，兩份實作就又各走各的了。
   */
  assert.doesNotMatch(
    source,
    /coreTurns\[targetKey as CoreVehicleKey\]\[turn\]/,
    "period-analysis 又自己實作了一次轉向係數的取法",
  );
  assert.doesNotMatch(
    source,
    /setting\?\.turnPcu\?\.\[turn\]/,
    "period-analysis 又自己實作了一次自訂車種的取法",
  );
});

/*
 * ══════════════════════════════════════════════════════════════════════
 *  分析用的畫面一律用「歸類後的類型」，不可以用歸類前的原始車種
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15 定義（原話）：
 *   「基本 4 個原車種類型，就是機車、小型車、大型車、特種車，剩下就是看
 *     使用者是要把新車種自動歸類成 1 個新類型，**或是要併入 4 個原車種類型裡**，
 *     所以大型車類型就是指原車種類型的大型車，以及任何把新車種併入到大型車
 *     裡面的車種……依此類推。」
 *
 * ⚠️ 2026-09-15 大檢查查到的錯：歷季趨勢的「單一車種車輛數／佔比」
 *   用的是 rawVehicleCounts／rawVehicleLabels（**歸類前**），
 *   而「車種組成」那一塊用的是 analysisVehicleCatalog（**歸類後**）。後果：
 *
 *     使用者把「電動機車」併進機車 →
 *       ・車種組成的「機車」＝ 原生機車 ＋ 電動機車
 *       ・歷季趨勢選「機車」  ＝ **只有原生機車**
 *     兩塊掛著同一個標籤、給出兩個不同的數字，畫面上一個字都沒說；
 *     而且下拉裡還列得出「電動機車」——一個已經宣告不再獨立存在的類型。
 *
 * ⚠️ 為什麼用掃原始碼：這一段是寫在元件裡的 useMemo，沒有辦法單獨呼叫。
 *   端對端測得到數字，但測不到「下拉列的是哪一組鍵」——
 *   而那正是這個錯的源頭（選項與取值用了不同的鍵空間）。
 */
test("歷季趨勢的車種下拉與取值都要用歸類後的類型", () => {
  const source = readFileSync(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  /*
   * ⚠️ 這一段是**兩塊**程式：
   *   ・下拉選項：元件裡的 trendVehicleOptions
   *   ・逐季取值：模組層的 buildTrendRows（2026-09-16 為了「一個調查點
   *     一條線」抽出來的，一個調查點呼叫一次）
   *   兩塊要一起驗——只驗其中一塊的話，「下拉走一套、取值走另一套」
   *   這個錯（正是本項要守的東西）就會從另一塊溜過去。
   */
  const optionsBlock = source.slice(
    source.indexOf("const trendVehicleOptions = useMemo("),
    source.indexOf("const trendCoverageByQuarter = useMemo("),
  );
  const valuesBlock = source.slice(
    source.indexOf("export function buildTrendRows("),
    source.indexOf("function ProfessionalLineChart("),
  );
  assert.ok(
    optionsBlock.length > 500,
    "找不到歷季趨勢那一段（trendVehicleOptions ～ trendCoverageByQuarter）",
  );
  assert.ok(
    valuesBlock.length > 500,
    "找不到 buildTrendRows（歷季趨勢逐季取值那一支）",
  );
  const block = optionsBlock + valuesBlock;
  assert.match(
    block,
    /effectiveVehicleCounts\(record, vehicleClassSettings\)/,
    "車種下拉的選項要來自歸類後的類型",
  );
  assert.match(
    block,
    /effectiveVehicleLabel\(record, key, vehicleClassSettings\)/,
    "車種下拉的標籤要走 effectiveVehicleLabel（併入之後顯示的是目標類型的名稱）",
  );
  assert.match(
    block,
    /const counts = effectiveVehicleCounts\(r, vehicleClassSettings\)/,
    "取值要用歸類後的類型，否則選了「機車」只會拿到原生機車",
  );
  /*
   * ⚠️ 反面：這一段裡**一個** rawVehicleCounts／rawVehicleLabels 都不可以有。
   *   只驗「有沒有 effectiveVehicleCounts」是不夠的——兩者並存時，
   *   下拉走一套、取值走另一套，正是舊版的樣子。
   */
  assert.doesNotMatch(
    block,
    /rawVehicleCounts|rawVehicleLabels/,
    "歷季趨勢那一段還在用歸類前的原始車種",
  );
});

test("需要原始車種的地方仍然要用原始車種（不可以一起改掉）", () => {
  /*
   * ⚠️ 上面那一條改的是**分析用**的畫面。有兩個地方要的正好相反，
   *   把它們一起改掉會讓功能壞掉，而且壞得很安靜：
   *
   *   ・車種分類與當量管理（activeVehicleSourceCatalog）——它要問的正是
   *     「每一個**原始**車種歸到哪裡」。改成歸類後的話，已經併走的車種
   *     會從設定畫面消失，使用者再也改不回來。
   *   ・Excel 的「原始來源追溯」——欄名就叫「原始車種與數量」，
   *     它存在的理由就是追回原始檔。
   */
  const source = readFileSync(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const catalog = source.slice(
    source.indexOf("const activeVehicleSourceCatalog = useMemo("),
    source.indexOf("const analysisVehicleCatalog = useMemo("),
  );
  assert.ok(catalog.length > 200, "找不到 activeVehicleSourceCatalog 那一段");
  assert.match(
    catalog,
    /rawVehicleCounts\(record\)/,
    "車種分類設定畫面必須列出**原始**車種，否則已併走的車種會消失、改不回來",
  );
  assert.match(
    source,
    /"原始車種與數量"/,
    "Excel 的原始來源追溯欄名不見了",
  );
});
