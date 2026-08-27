/*
 * 匿名的七叉路口調查表產生器（測試專用）。
 *
 * ── 為什麼要有這支 ─────────────────────────────────────────────────
 * `tests/intersection-flow.test.mjs` 與 `tests/intersection-peak-window.test.mjs`
 * 原本直接讀 `tests/fixtures/` 底下**使用者客戶的真實調查表**。那兩個檔案
 * 因此被提交進公開的 GitHub repository，並且可以從 GitHub Pages 直接下載
 *（2026-08-27 由複查發現）。測試需要的是「這種檔案長什麼樣子」，
 * 不是「這一份實際調查到多少車」——所以改成當場產生一份結構相同、
 * 數字自己編的活頁簿。
 *
 * ── 結構完全比照真實檔 ─────────────────────────────────────────────
 * 一條支線一張工作表；每張表的欄位是「車種 × 目的支線」：
 *
 *   第 1 列  表1 路口轉向交通量調查表
 *   第 2 列  站號：…            日期：…(平日)
 *   第 3 列  站名：…            天候：…
 *   第 4 列  路口編號：A        調查員：…
 *   第 5 列  時間 | 機車(欄1) | 小型車(欄7) | 大型車(欄13) | 大型車(欄15) |
 *                  特種車(欄19) | 大型車(欄21)
 *   第 6 列  往B 往C 往D 往E 往F 往G ×4 組
 *   第 7 列起 16 個 15 分鐘時段的數字
 *
 * 第 5 列那三個「大型車」是真實檔合併儲存格留下的殘影（大型車出現三次、
 * 位置還錯開），**刻意照抄**：解析器就是靠「目的支線的重複週期」而不是
 * 車種標題位置來切欄，這個怪異的標題正是那段邏輯要擋的東西。
 *
 * ── 數字是怎麼來的 ─────────────────────────────────────────────────
 * 用固定種子的線性同餘亂數產生，所以每次執行完全相同（測試不能有隨機性），
 * 但與任何真實調查無關。量級刻意做出差異：F、C 是主要方向，D 很小，
 * 這樣「各支線尖峰時段不同」「駛入與駛出分佈不同」這些情境才驗得到。
 *
 * 匯出的 `OD` 是這份檔案的**真值**：OD[起點][終點][車種][時段序] = 車輛數。
 * 測試用它獨立算出期望值，不經過被測試的程式——這比原本拿使用者參考檔
 * 的彙總數字來比更嚴格，因為連每一格都對得起來。
 */
import XLSXns from "xlsx";

const XLSX = XLSXns.default ?? XLSXns;

/** 支線代碼，順時針。 */
export const ARM_CODES = ["A", "B", "C", "D", "E", "F", "G"];

/**
 * 每一條支線往其他支線算左轉、直行還是右轉。
 * 七叉路口不能用「左轉只有一個目的地」的假設——A 的左轉同時通往 B、C、D。
 */
export const ROUTES = {
  A: { B: "left", C: "left", D: "left", E: "through", F: "right", G: "right" },
  B: { C: "left", D: "left", E: "left", F: "through", G: "right", A: "right" },
  C: { D: "left", E: "left", F: "left", G: "through", A: "right", B: "right" },
  D: { E: "left", F: "left", G: "left", A: "through", B: "right", C: "right" },
  E: { F: "left", G: "left", A: "left", B: "through", C: "right", D: "right" },
  F: { G: "left", A: "left", B: "left", C: "through", D: "right", E: "right" },
  G: { A: "left", B: "left", C: "left", D: "through", E: "right", F: "right" },
};

/** 目的支線的排列方式與真實檔相同：從自己的下一條開始繞一圈。 */
export function destinationsOf(code) {
  const start = ARM_CODES.indexOf(code);
  return Array.from({ length: 6 }, (_unused, step) =>
    ARM_CODES[(start + step + 1) % 7],
  );
}

export const VEHICLES = [
  { key: "motorcycle", label: "機車" },
  { key: "small", label: "小型車" },
  { key: "large", label: "大型車" },
  { key: "special", label: "特種車" },
];

/** 上午 8 段、下午 8 段，和真實檔一樣不是連續 24 小時。 */
export const PERIODS = [
  "07:00～07:15", "07:15～07:30", "07:30～07:45", "07:45～08:00",
  "08:00～08:15", "08:15～08:30", "08:30～08:45", "08:45～09:00",
  "17:00～17:15", "17:15～17:30", "17:30～17:45", "17:45～18:00",
  "18:00～18:15", "18:15～18:30", "18:30～18:45", "18:45～19:00",
];

export const AM_PEAK = PERIODS.slice(1, 5); // 07:15～08:15
export const PM_PEAK = PERIODS.slice(8, 12); // 17:00～18:00

/** 這份樣本的識別資料，全部是虛構的。 */
export const SAMPLE_IDENTITY = {
  station: "A00T00-01",
  name: "示範北路/示範路口(七叉路口)",
  date: "115年01月01日(平日)",
  weather: "晴",
  surveyor: "示範調查員",
};

/** 固定種子的線性同餘亂數，保證每次產生的檔案一模一樣。 */
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** 各支線的相對規模：F、C 大，D 很小，這樣尖峰時段才不會每一條都一樣。 */
const ARM_WEIGHT = { A: 1, B: 0.9, C: 1.6, D: 0.15, E: 0.5, F: 2.4, G: 0.8 };
/** 車種比例：機車最多，特種車偶爾才有一輛。 */
const VEHICLE_WEIGHT = { motorcycle: 1, small: 0.7, large: 0.12, special: 0.03 };

/**
 * 這份樣本的真值。OD[起點][終點][車種][時段序] = 車輛數。
 * 產生檔案與計算期望值都以它為準，所以兩邊必然一致。
 */
export const OD = (() => {
  const random = rng(20260827);
  const table = {};
  for (const from of ARM_CODES) {
    table[from] = {};
    for (const to of destinationsOf(from)) {
      table[from][to] = {};
      for (const vehicle of VEHICLES) {
        const base =
          26 * ARM_WEIGHT[from] * ARM_WEIGHT[to] * VEHICLE_WEIGHT[vehicle.key];
        table[from][to][vehicle.key] = PERIODS.map((_unused, index) => {
          // 下午比上午忙一些，而且忙的支線不同——用來驗「各支線尖峰不同」。
          const shift = index < 8 ? 1 : 1.25;
          const swing = from === "F" && index >= 8 ? 0.55 : 1;
          return Math.max(0, Math.round(base * shift * swing * (0.6 + random())));
        });
      }
    }
  }
  return table;
})();

/** 這一格的 PCU 當量（依起點到終點是左轉、直行還是右轉）。 */
export function turnOf(from, to) {
  return ROUTES[from]?.[to];
}

/**
 * 依「終點」統計的 PCU 合計——也就是「駛入路口X」。
 * 這裡是把真值直接加起來，完全不經過被測試的程式。
 */
export function expectedInboundPcu(window, turnFactors) {
  const totals = {};
  for (const to of ARM_CODES) {
    let sum = 0;
    for (const from of ARM_CODES) {
      if (!OD[from]?.[to]) continue;
      for (const vehicle of VEHICLES) {
        const factor = turnFactors[vehicle.key]?.[turnOf(from, to)] ?? 0;
        for (const label of window)
          sum += OD[from][to][vehicle.key][PERIODS.indexOf(label)] * factor;
      }
    }
    totals[to] = Number(sum.toFixed(1));
  }
  return totals;
}

/** 依「起點」統計的 PCU 合計——也就是「駛出路口X」。 */
export function expectedOutboundPcu(window, turnFactors) {
  const totals = {};
  for (const from of ARM_CODES) {
    let sum = 0;
    for (const to of destinationsOf(from))
      for (const vehicle of VEHICLES) {
        const factor = turnFactors[vehicle.key]?.[turnOf(from, to)] ?? 0;
        for (const label of window)
          sum += OD[from][to][vehicle.key][PERIODS.indexOf(label)] * factor;
      }
    totals[from] = Number(sum.toFixed(1));
  }
  return totals;
}

/** 一條支線的工作表內容（二維陣列）。 */
function sheetValues(code) {
  const destinations = destinationsOf(code);
  const width = 1 + destinations.length * VEHICLES.length;
  const blank = () => Array.from({ length: width }, () => "");

  const title = blank();
  title[0] = "           表1    路口轉向交通量調查表";

  const station = blank();
  station[0] = `站號：${SAMPLE_IDENTITY.station}`;
  station[7] = `日期：${SAMPLE_IDENTITY.date}`;

  const name = blank();
  name[0] = `站名：${SAMPLE_IDENTITY.name}`;
  name[7] = `天候：${SAMPLE_IDENTITY.weather}`;

  const armRow = blank();
  armRow[0] = `路口編號：${code}`;
  armRow[7] = `調查員：${SAMPLE_IDENTITY.surveyor}`;

  /* 合併儲存格留下的殘影，位置照抄真實檔（見檔頭說明）。 */
  const vehicleRow = blank();
  vehicleRow[0] = "時\r\n間";
  vehicleRow[1] = "機車";
  vehicleRow[7] = "小型車";
  vehicleRow[13] = "大型車";
  vehicleRow[15] = "大型車";
  vehicleRow[19] = "特種車";
  vehicleRow[21] = "大型車";

  const destinationRow = blank();
  VEHICLES.forEach((_unused, vehicleIndex) => {
    destinations.forEach((to, destinationIndex) => {
      destinationRow[1 + vehicleIndex * destinations.length + destinationIndex] =
        `往${to}`;
    });
  });

  const dataRows = PERIODS.map((label, periodIndex) => {
    const row = blank();
    row[0] = label;
    VEHICLES.forEach((vehicle, vehicleIndex) => {
      destinations.forEach((to, destinationIndex) => {
        row[1 + vehicleIndex * destinations.length + destinationIndex] =
          OD[code][to][vehicle.key][periodIndex];
      });
    });
    return row;
  });

  const note = blank();
  note[0] =
    "註：1.機車(含重機)。2.小型車(小客車、小貨車)。3.大型車(大客車、大貨車)。4.特種車(連結車、貨櫃車等)。";

  return [title, station, name, armRow, vehicleRow, destinationRow, ...dataRows, note];
}

/**
 * 產生整本活頁簿。
 * @param {"xlsx"|"biff8"} bookType xlsx 或舊格式 .xls（真實檔兩種都有）
 * @returns {Buffer}
 */
export function buildIntersectionWorkbook(bookType = "xlsx") {
  const book = XLSX.utils.book_new();
  ARM_CODES.forEach((code, index) => {
    const sheet = XLSX.utils.aoa_to_sheet(sheetValues(code));
    /* 第一張表的名字在真實檔裡是「路口(A)」，其餘是「路口B」——照抄。 */
    XLSX.utils.book_append_sheet(book, sheet, index === 0 ? "路口(A)" : `路口${code}`);
  });
  /* 非交通量的工作表也要有，測試才驗得到「這些會被略過」。 */
  for (const extra of ["監測日誌", "時相圖", "照片"]) {
    const sheet = XLSX.utils.aoa_to_sheet([[extra], ["（測試樣本，無內容）"]]);
    XLSX.utils.book_append_sheet(book, sheet, extra);
  }
  return XLSX.write(book, { type: "buffer", bookType });
}

/*
 * 以下是給「尖峰時段」測試用的獨立計算。
 *
 * 刻意在這裡自己實作一次滾動視窗的定義（連續 4 個 15 分鐘＝完整 60 分鐘、
 * 同值取較早的那一個），而不是呼叫被測試的 period-analysis——
 * 期望值如果是用被測程式算出來的，那個測試就等於什麼都沒驗。
 */

/** 每一條支線、每一個 15 分鐘時段的「駛入」PCU。 */
export function inboundPcuBySlot(turnFactors) {
  const table = {};
  for (const to of ARM_CODES) {
    table[to] = PERIODS.map(() => 0);
    for (const from of ARM_CODES) {
      if (!OD[from]?.[to]) continue;
      for (const vehicle of VEHICLES) {
        const factor = turnFactors[vehicle.key]?.[turnOf(from, to)] ?? 0;
        OD[from][to][vehicle.key].forEach((count, index) => {
          table[to][index] += count * factor;
        });
      }
    }
  }
  return table;
}

/**
 * 在指定的時段範圍內找出「連續 4 格」的最大值。
 * @returns {{hour: string, pcu: number}}
 */
export function rollingPeak(values, from, to) {
  let best = null;
  for (let start = from; start + 4 <= to; start += 1) {
    const sum = values.slice(start, start + 4).reduce((a, b) => a + b, 0);
    // 同值取較早的視窗，所以只有「嚴格大於」才換掉。
    if (!best || sum > best.sum + 1e-9)
      best = {
        sum,
        hour: `${PERIODS[start].split("～")[0]}～${PERIODS[start + 3].split("～")[1]}`,
      };
  }
  return { hour: best.hour, pcu: Number(best.sum.toFixed(1)) };
}

/** 上午的 8 個時段是索引 0–7，下午是 8–15。 */
export const AM_RANGE = [0, 8];
export const PM_RANGE = [8, 16];
