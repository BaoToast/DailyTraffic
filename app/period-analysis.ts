import {
  effectiveVehicleCounts,
  effectiveVehicleLabel,
  vehiclePcuByTarget,
  type PcuScopes,
  type CorePcuFactors,
  type CoreTurnPcuFactors,
  type VehicleClassSetting,
  type VehicleRecordLike,
} from "./vehicle-analysis.ts";

/*
 * 時段車種分析（依 2022 年臺灣公路容量手冊之尖峰小時概念實作）
 *
 * 手冊 2.4.5／式(2.10) 只定義「尖峰小時係數 PHF＝尖峰小時流率÷尖峰15分鐘流率」，
 * 以及 K＝尖峰小時流量÷全日流量；手冊全書並未規定上午／下午尖峰的固定時鐘區間
 * （查遍 780 頁沒有 07:00–09:00 這類建議值），所以尖峰小時必須由實測資料自行認定。
 * 本模組採用的認定方式：
 *   全調查時段     ＝ 這份調查涵蓋的時段全部加總（24 小時的調查就是一整天）
 *   全調查時段尖峰 ＝ 在同一段涵蓋裡，當量交通量(PCU/hr)最大的那一小時
 *
 * ⚠️ 名稱在 2026-09-10 依使用者指定改過，三支程式一致（舊名：全日時段／全日尖峰小時）。
 *   改名不只是換字：舊名宣告的是「一整天」，所以不足 24 小時的調查一律不算；
 *   新名宣告的是「這份調查涵蓋的時段」，4 小時的調查算出「這 4 小時裡最忙的
 *   一小時」是誠實的。使用者的原話：「三份程式統一名稱後，原本不用計算的
 *   資料，現在都要計算了」。
 *   上午尖峰 ＝ 起始時間在中午 12:00 之前，當量交通量最大的那一小時
 *   下午尖峰 ＝ 起始時間在中午 12:00 之後（含 12:00），當量交通量最大的那一小時
 *   這條分界**固定在中午 12:00，不提供設定**；橫跨中午的視窗另外問使用者
 *   （見 NOON_MINUTES 那一段的說明）。
 * 尖峰以 PCU 判定（手冊 2.4.13：容量分析一律以小客車單位量 PCU 為共同尺規）。
 *
 * 尖峰時段的認定範圍（v20.7 起可選，預設 "point"）：
 *   point     ＝ 整個調查點取同一個尖峰小時，各方向／支線都報這同一個時段的量。
 *                各方向相加會等於合計那一列，可直接與「進入該路口交通量」這類
 *                以路口整體尖峰小時編製的報表對數字。
 *   direction ＝ 每個「調查點×方向」各自認定自己的尖峰小時（v20.6 以前的行為）。
 *                能看出單一支線自己最忙的時段，但各方向不可相加。
 */

export type PeriodKey = "all" | "peak24" | "am" | "pm";

export const PERIOD_KEYS: PeriodKey[] = ["all", "peak24", "am", "pm"];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  all: "全調查時段",
  peak24: "全調查時段尖峰",
  am: "上午尖峰小時",
  pm: "下午尖峰小時",
};

export const PERIOD_HINTS: Record<PeriodKey, string> = {
  all: "這份調查涵蓋的時段全部加總（24 小時的調查就是一整天）",
  peak24: "在調查涵蓋的時段內，當量交通量最高的 1 小時",
  am: "中午 12:00 之前，當量交通量最高的 1 小時",
  pm: "中午 12:00 之後，當量交通量最高的 1 小時",
};

export type MetricKey = "count" | "share" | "pcu";

export const METRIC_KEYS: MetricKey[] = ["count", "share", "pcu"];

export const METRIC_LABELS: Record<MetricKey, string> = {
  count: "車輛數",
  share: "百分比",
  pcu: "交通流量",
};

/**
 * 不帶時間基準的單位，只用在「還沒決定要看哪個時段」的地方（例如匯出項目
 * 的勾選清單）。舊版這裡把交通流量寫死成 PCU/hr，選「全日」時下拉選單仍
 * 顯示 PCU/hr，跟表格裡標的 PCU/日 互相矛盾。真正要顯示單位的地方一律改
 * 用 metricUnitFor()，由時段決定。
 */
export const METRIC_BASE_UNITS: Record<MetricKey, string> = {
  count: "輛",
  share: "%",
  pcu: "PCU",
};

/**
 * 單位要看時段：全日是一整天的加總，不能標成每小時。
 * 尖峰欄位是某一個小時的量，才是 輛/hr 與 PCU/hr。
 */
export function metricUnitFor(
  metric: MetricKey,
  period: PeriodKey,
  options?: { separateDays?: boolean; partial?: boolean },
) {
  if (metric === "share") return "%";
  if (period === "all") {
    // 平日＋假日是兩天的加總，不能標成「每日」；
    // 部分時段調查的全日只是實測時段合計，也不是完整一日。
    // 這兩件事是各自獨立的，不能像舊版那樣讓 separateDays 把 partial 吃掉——
    // 一旦日別切到「平日＋假日」，部分時段的警示就整個消失了。
    if (options?.separateDays)
      return options?.partial
        ? metric === "pcu"
          ? "PCU/調查時段（平＋假合計）"
          : "輛/調查時段（平＋假合計）"
        : metric === "pcu"
          ? "PCU"
          : "輛";
    if (options?.partial)
      return metric === "pcu" ? "PCU/調查時段" : "輛/調查時段";
    return metric === "pcu" ? "PCU/日" : "輛/日";
  }
  return metric === "pcu" ? "PCU/hr" : "輛/hr";
}

/**
 * 依「這一格自己的時段標籤」決定單位。
 *
 * 為什麼不看整批的 partial 旗標：
 * surveyScope 是整個畫面範圍的一個代表值（任何一個調查點是部分時段，整批
 * 就算部分時段），拿它標每一格會把 24 小時的調查點標成「輛/調查時段」，
 * 或反過來把 2 小時的調查點標成「輛/日」。而每一格的 hour 標籤本來就已經
 * 帶著真相（fullDayLabel 會寫「24 小時」或「實測 N 小時（非 24 小時）」），
 * 直接讀它就是逐調查點、逐方向都正確的答案。
 *
 * 尖峰欄位也一樣：滾動尖峰在部分時段或細格資料下可能湊不滿一小時
 * （例如只有 07:00～07:45），那個數字是該時段的量而不是時率，標成 /hr 會
 * 低估 25%；反過來，以 2 小時為一格的原始檔會得到 120 分鐘的視窗，標成
 * /hr 則是高估一倍。所以要比對「恰好 60 分鐘」，不是「小於 60 分鐘」。
 */
/**
 * 一整欄（或畫面上一個欄位標題）該標什麼單位。
 *
 * ⚠️ 畫面與匯出**必須共用這一支**。
 *
 * 舊版畫面走的是 metricUnitFor(metric, period, { partial: surveyScope.partial })
 * ——那個 partial 是整批的代表值（任何一個調查點是部分時段，整批就算部分
 * 時段），拿它標每一格，會把真正做滿 24 小時的調查點標成「輛/調查時段」；
 * 而匯出與報告草稿走的是 cellUnitFor（看每一列自己的時段標籤），標的是
 * 「輛/日」。同一個數字，畫面與 Excel 說兩種話。
 *
 * 實測 6 種情境有 3 種不一致：
 *   ・24 小時的調查點（畫面上另有部分時段調查點）→ 畫面「輛/調查時段」／匯出「輛/日」
 *   ・2 小時一格的尖峰視窗 → 畫面「輛/hr」／匯出「輛/該時段（120 分鐘）」
 *   ・湊不滿一小時的尖峰視窗 → 畫面「輛/hr」／匯出「輛/該時段（45 分鐘）」
 * 而真實資料裡本來就同時有 24 小時（999999T1506/1507）與 4 小時（999999T1501）
 * 的調查點，第一種情境現在就會發生。
 *
 * 規則：整欄的時段標籤都一樣就用那個時段的正確單位；長短不一時明講
 * 「見『分析時段』欄」，而不是挑一個代表值假裝整欄都適用。
 */
export function columnUnitFor(
  metric: MetricKey,
  period: PeriodKey,
  hours: string[],
  options?: { separateDays?: boolean },
): string {
  const distinct = Array.from(new Set(hours));
  if (distinct.length === 1)
    return cellUnitFor(metric, period, distinct[0], options);
  const units = Array.from(
    new Set(distinct.map((hour) => cellUnitFor(metric, period, hour, options))),
  );
  if (units.length === 1) return units[0];
  if (metric === "share") return "%";
  return `${metric === "pcu" ? "PCU" : "輛"}/各列時段，見「分析時段」欄`;
}

export function cellUnitFor(
  metric: MetricKey,
  period: PeriodKey,
  hour: string,
  options?: { separateDays?: boolean },
): string {
  if (metric === "share") return "%";
  const base = metric === "pcu" ? "PCU" : "輛";
  if (period === "all") {
    // 平日＋假日是兩天的加總，不能標成「每日」。
    if (options?.separateDays)
      return /各日實測/.test(hour) ? `${base}/調查時段（平＋假合計）` : base;
    return /非 24 小時|實測/.test(hour) ? `${base}/調查時段` : `${base}/日`;
  }
  const range = parseTimeRange(hour);
  if (!range) return `${base}/hr`;
  const minutes = range.end - range.start;
  if (minutes === 60) return `${base}/hr`;
  return `${base}/該時段（${minutes} 分鐘）`;
}

export type PeriodRecord = VehicleRecordLike & {
  quarter?: string;
  roadId: string;
  roadName: string;
  dayType?: string;
  directionCode: string;
  directionName: string;
  hour: string;
};

import {
  intervalMinutesOf,
  parseTimeRange,
  rollingPeak,
  surveyCoverage,
} from "./partial-day.ts";

export type PeriodFactors = {
  core: CorePcuFactors;
  coreTurns: CoreTurnPcuFactors;
  settings: VehicleClassSetting[];
  /*
   * 依季別／路段的係數覆寫。
   * ⚠️ **選填**：沒有覆寫時整個時段分析與改版前逐格相同。
   *   這一路都是把它原樣往下傳給 vehiclePcuByTarget()，
   *   由 lib 的 resolveFactors() 一處決定用哪一組——
   *   這裡刻意不自己判斷，兩處判斷遲早會分岔。
   */
  scopes?: PcuScopes | null;
};

/** 解析「07:00～08:00」「07:00-08:00」之類的時段字串，回傳起始小時（0–23）；無法解析回傳 -1。 */
export function hourStartOf(hour: string): number {
  const match = String(hour ?? "")
    .normalize("NFKC")
    .match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return -1;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 && value <= 24 ? value % 24 : -1;
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  上午／下午的分界：固定在中午 12:00，不做成可設定的選項
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12 的定案（他一開始要的是可設定，討論之後自己收回）：
 *   「如果根本不會有這種時段出現，那麼我們現在討論再多都是沒意義的。
 *     倒不如回歸以前作法，不確定時，就是跳出視窗詢問使用者。」
 *
 * 為什麼不做成可設定：實測他手上 37 份真實調查檔，全部都是整點對齊，
 * 而「只做早上、下午各三小時」的調查在固定中午分界下本來就會得到正確答案
 * （那半天根本沒有別的資料可挑）。多一個沒有人會去動的計算參數，壞掉之後
 * 不會有人回報——他的原話：「平常不太會有人去調整，所以這個功能要做確實，
 * 不然可能都不會有人發現異常。」不做，就沒有這個風險。
 *
 * ⚠️ 但有一種情況固定分界會**安靜地報錯的數字**，那才是真正要處理的：
 *
 *   15 分鐘細格資料用滾動視窗湊一小時時，真正最忙的那一小時可能
 *   **橫跨中午**（例如 11:15～12:15）。目前的作法是上午段只看 12:00 以前
 *   起算的格子，所以那個視窗根本不會被考慮——上午尖峰會報一個比較小的
 *   時段，而且完全看不出來少報了。使用者 2026-09-12 也自己指出這一點：
 *   「如果有15分鐘滾動去計算1小時的當量時，其實也會遇到。」
 *
 *   處理方式：**問使用者**，不自己決定。它算上午還是下午，牽涉的是報告
 *   要怎麼寫，不是程式能判斷的事。使用者答了之後，另一邊照原本的規則算
 *   （上午視窗必須整個在 12:00 之前、下午必須整個在 12:00 之後），
 *   所以「另一個尖峰是哪個時段」會自動推出來。
 */

/** 上午／下午的分界（當天的第幾分鐘）。固定值，不提供設定。 */
export const NOON_MINUTES = 12 * 60;

/**
 * 解析時段字串的**起始分鐘數**（0–1439）；無法解析回傳 -1。
 *
 * 和 hourStartOf() 的差別：那一支只回傳「第幾個小時」，15 分鐘格的
 * 07:15 與 07:45 在它眼裡都是 7。判斷視窗有沒有跨過中午必須看到分鐘。
 */
export function startMinutesOf(hour: string): number {
  const match = String(hour ?? "")
    .normalize("NFKC")
    .match(/(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return -1;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  if (h < 0 || h > 24 || m < 0 || m > 59) return -1;
  return (h % 24) * 60 + m;
}

/** 解析時段字串的**結束分鐘數**（1–1440）；只有一個時間或解析不出來回傳 -1。 */
export function endMinutesOf(hour: string): number {
  const times = [
    ...String(hour ?? "")
      .normalize("NFKC")
      .matchAll(/(\d{1,2})\s*:\s*(\d{2})/g),
  ];
  if (times.length < 2) return -1;
  const last = times[times.length - 1];
  const h = Number(last[1]);
  const m = Number(last[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return -1;
  if (h < 0 || h > 24 || m < 0 || m > 59) return -1;
  // 收尾位置的 24:00 與 00:00 都代表「一天的結束」。
  const clock = h * 60 + m;
  return clock === 0 ? 24 * 60 : clock;
}

/** 把「當天的第幾分鐘」寫成 HH:MM；1440 寫成 24:00。 */
export function minutesToClock(minutes: number): string {
  const value = Math.max(0, Math.min(24 * 60, Math.round(Number(minutes) || 0)));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/**
 * 這個時段自己有沒有橫跨中午（例如原始檔寫成 11:30～12:30 的單一格）。
 * 解析不出結束時間時回 false——寧可不報，也不要對著推測出來的時間報警。
 */
export function straddlesNoon(hour: string): boolean {
  const start = startMinutesOf(hour);
  const end = endMinutesOf(hour);
  if (start < 0 || end < 0 || end <= start) return false;
  return start < NOON_MINUTES && end > NOON_MINUTES;
}

export function isMorningHour(hour: string) {
  const start = startMinutesOf(hour);
  return start >= 0 && start < NOON_MINUTES;
}

export function isAfternoonHour(hour: string) {
  const start = startMinutesOf(hour);
  return start >= NOON_MINUTES;
}

/**
 * 一個「橫跨中午、而且比兩邊各自的尖峰都高」的候選視窗。
 *
 * 只有這種情況才需要問使用者：它沒有橫跨中午就不必問；橫跨了但比兩邊都小，
 * 問了也不會改變任何一個欄位的數字，問了只是打擾。
 */
export type NoonStraddle = {
  /** 問題的識別鍵：同一個調查點、同一個日別只問一次。 */
  key: string;
  roadId: string;
  roadName: string;
  /** 日別（平日／假日）；沒有分開統計時是空字串。 */
  day: string;
  /** 這個跨中午視窗的時段文字，例如「11:15～12:15」。 */
  label: string;
  /** 這個視窗的當量交通量（PCU）。 */
  value: number;
  /** 目前上午尖峰（只看 12:00 以前）的時段與值；沒有就是空字串／0。 */
  amLabel: string;
  amValue: number;
  /** 目前下午尖峰（只看 12:00 以後）的時段與值。 */
  pmLabel: string;
  pmValue: number;
};

/**
 * 使用者對「這個橫跨中午的一小時要怎麼算」的回答。
 *
 * 使用者 2026-09-12 指定的四個選項（畫面上的編號就是這個順序）：
 *   1. 取消不匯入   → 這一筆不寫進系統，使用者先去檢查原始檔
 *   2. 忽略這個時段 → "ignore"：照原本的 12:00 分界算，那個跨中午的視窗
 *                     兩邊都不選（＝改版前的行為）
 *   3. 歸為上午尖峰 → "am"
 *   4. 歸為下午尖峰 → "pm"
 *
 * ⚠️ 第 1 項不是一種「答案」，它是「不要寫入」——所以它不會出現在這個型別裡，
 *   由畫面那一層處理（整筆不寫入）。這裡只收真的要算下去的三種。
 *
 * ⚠️ "ignore" 必須是一個**明確存下來的答案**，不可以用「沒有回答」代替。
 *   兩者算出來的數字一樣，但意思完全不同：「沒有回答」代表還沒問過，
 *   「ignore」代表使用者看過、而且決定不要它。差別在於日後回頭看這筆資料時
 *   分不分得出來——分不出來的話，沒人知道那個高峰是被忽略還是被漏掉。
 */
export type NoonAnswer = "am" | "pm" | "ignore";
export type NoonAnswers = Record<string, NoonAnswer>;

/** 問題的識別鍵——調查點＋日別。同一個路段的平日與假日要分開問。 */
export function noonStraddleKey(roadId: string, day: string) {
  return `${roadId}|${day || ""}`;
}

export type PeriodCell = {
  /** 各車種車輛數（依車種歸類設定合併後的 key） */
  vehicles: Record<string, number>;
  /** 各車種當量交通量（PCU） */
  vehiclePcu: Record<string, number>;
  /** 全部車種車輛數合計 */
  total: number;
  /** 全部車種當量交通量合計 */
  pcu: number;
  /** 尖峰時段標籤；全調查時段寫實際涵蓋時數（24 小時的調查就是「24 小時」） */
  hour: string;
  /** 該格是否有資料 */
  hasData: boolean;
};

export type PeriodScope = {
  /** "ALL" 代表雙向合計／全部支線合計 */
  code: string;
  name: string;
};

export type PeriodRow = {
  roadId: string;
  roadName: string;
  surveyType: "road" | "intersection";
  scopeCode: string;
  scopeName: string;
  periods: Record<PeriodKey, PeriodCell>;
  /**
   * 這一列屬於哪一種路口流量視角（「駛出」或「駛入」）。
   * 只有在畫面上同時並列兩種視角時才會設定，用來區分同一支線的兩列。
   */
  flowLabel?: string;
  /**
   * X-18：這一列是哪一個日別。
   * 只有在「平日＋假日」時才會設定（那時候一天一列）；
   * 單一日別時是 undefined——沒有兩列要區分，寫了反而囉嗦。
   */
  dayType?: string;
};

function emptyCell(hour: string): PeriodCell {
  return { vehicles: {}, vehiclePcu: {}, total: 0, pcu: 0, hour, hasData: false };
}

/**
 * 單筆紀錄依車種歸類設定拆出「各車種 PCU」。
 *
 * ⚠️ 這裡**不再自己實作**。v20.33 以前這一支和 vehicle-analysis 的
 * sumVehiclePcu() 是兩份各自維護、規則相同的程式碼。它們沒有出過錯，
 * 但一份改了另一份沒改，畫面上就會出現「總量那一格」與「時段分析那一格」
 * 對不起來——而且**只有自訂車種會不一樣**，最不容易被發現。
 * 現在統一由 vehiclePcuByTarget() 計算，兩邊在結構上不可能分岔。
 */
export function vehiclePcuBreakdown(record: PeriodRecord, factors: PeriodFactors) {
  return vehiclePcuByTarget(
    record,
    factors.core,
    factors.coreTurns,
    factors.settings,
    factors.scopes,
  );
}

type HourBucket = {
  /** 分桶鍵：以起始小時（必要時加上日別）組成，不受原始字串寫法影響 */
  label: string;
  /** 日別（僅在平日與假日分開統計時有值），用來避免跨日別組成滾動視窗 */
  day: string;
  /** 這個時間格的起始分鐘數，供滾動視窗判斷是否首尾相接 */
  startMinutes: number;
  /** 顯示用的時段字串，沿用檔案原本的寫法，例如「09:00～10:00」 */
  display: string;
  vehicles: Record<string, number>;
  vehiclePcu: Record<string, number>;
  total: number;
  pcu: number;
  hour: string;
};

function accumulate(bucket: HourBucket, record: PeriodRecord, factors: PeriodFactors) {
  const counts = effectiveVehicleCounts(record, factors.settings);
  for (const [key, value] of Object.entries(counts)) {
    bucket.vehicles[key] = (bucket.vehicles[key] ?? 0) + Number(value || 0);
    bucket.total += Number(value || 0);
  }
  const pcu = vehiclePcuBreakdown(record, factors);
  for (const [key, value] of Object.entries(pcu)) {
    bucket.vehiclePcu[key] = (bucket.vehiclePcu[key] ?? 0) + value;
    bucket.pcu += value;
  }
}

/**
 * 「全日」欄位的時段標籤。
 *
 * 完整 24 小時才寫「24 小時」；不足的一律寫出實際調查時數，避免部分時段
 * 調查被誤讀成全日量。
 *
 * 時數一律用 surveyCoverage() 算，不要自己拿「格數 × 眾數格長」推估——
 * 同一個調查點若混用 15 分鐘與 60 分鐘的時間格，眾數代表不了所有格子，
 * 實測會把 6 小時算成 3 小時，跟畫面上方「部分時段調查」提醒自相矛盾。
 *
 * 平日＋假日並列時，兩天的時段會重複出現（各一份 07:00～08:00），所以要
 * 先去重再算「單日實測時數」，而且這一欄是兩天的加總，不能只寫時數。
 */
function fullDayLabel(buckets: HourBucket[], separateDays: boolean): string {
  const hourStrings = [...new Set(buckets.map((bucket) => bucket.display))];
  const hours = surveyCoverage(hourStrings).coveredMinutes / 60;
  const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  if (separateDays)
    return hours >= 24
      ? "平日＋假日全部時段"
      : `平日＋假日全部時段（各日實測 ${text} 小時）`;
  if (hours >= 24) return "24 小時";
  return `實測 ${text} 小時（非 24 小時）`;
}

function cellFromBuckets(buckets: HourBucket[], hourLabel: string): PeriodCell {
  const cell = emptyCell(hourLabel);
  for (const bucket of buckets) {
    for (const [key, value] of Object.entries(bucket.vehicles))
      cell.vehicles[key] = (cell.vehicles[key] ?? 0) + value;
    for (const [key, value] of Object.entries(bucket.vehiclePcu))
      cell.vehiclePcu[key] = (cell.vehiclePcu[key] ?? 0) + value;
    cell.total += bucket.total;
    cell.pcu += bucket.pcu;
  }
  cell.hasData = buckets.length > 0;
  return cell;
}

/**
 * 從候選時段中挑出尖峰：以 PCU 最大者為準，PCU 全為 0（例如當量係數還沒設定）
 * 時退而比較車輛數；兩者都是 0 代表這段時間沒有車，回傳 undefined 讓欄位顯示
 * 「—」，與 KPI 卡的處理一致，不會拿排序後的第一筆冒充尖峰。
 * 同值時取較早的時段，結果可重現。
 */
function peakBucket(buckets: HourBucket[]) {
  let best: HourBucket | undefined;
  for (const bucket of buckets) {
    if (bucket.pcu <= 0 && bucket.total <= 0) continue;
    if (!best) {
      best = bucket;
      continue;
    }
    if (bucket.pcu > best.pcu) best = bucket;
    else if (bucket.pcu === best.pcu && bucket.total > best.total) best = bucket;
  }
  return best;
}

/**
 * 求尖峰時段所涵蓋的時間格。
 *
 * 每小時一列的資料：就是流量最大的那一列（維持原本結果）。
 * 15 分鐘等細格資料：取連續、剛好湊滿一小時的滾動視窗，
 * 並回傳視窗內的所有格子，之後由 cellFromBuckets 加總成一格。
 * 視窗不會跨越資料空隙，也不會跨越不同日別。
 */
function peakWindow(buckets: HourBucket[], subHourly: boolean) {
  if (!subHourly) {
    const best = peakBucket(buckets);
    return best ? { buckets: [best], label: best.display } : null;
  }
  const byDay = new Map<string, HourBucket[]>();
  for (const bucket of buckets) {
    const list = byDay.get(bucket.day) ?? [];
    list.push(bucket);
    byDay.set(bucket.day, list);
  }
  // PCU 全為 0（例如當量係數尚未設定，或使用者刻意把係數設成 0）時，
  // 退而以車輛數決定尖峰——這與每小時路徑的 peakBucket() 行為一致。
  const anyPcu = buckets.some((bucket) => bucket.pcu > 0);
  const weightOf = (bucket: HourBucket) => (anyPcu ? bucket.pcu : bucket.total);
  let best: { buckets: HourBucket[]; label: string; value: number } | null = null;
  for (const [day, list] of byDay) {
    const sorted = [...list].sort((a, b) => a.startMinutes - b.startMinutes);
    const peak = rollingPeak(
      sorted.map((bucket) => ({ hour: bucket.hour, value: weightOf(bucket) })),
    );
    if (peak.start < 0 || !peak.spans) continue;
    const index = sorted.findIndex((bucket) => bucket.startMinutes === peak.start);
    if (index < 0) continue;
    const window = sorted.slice(index, index + peak.spans);
    if (!window.length) continue;
    const label = day ? `${day} ${peak.label}` : peak.label;
    if (!best || peak.value > best.value) best = { buckets: window, label, value: peak.value };
  }
  // 這段時間完全沒有車（PCU 與車輛數都是 0）就不要捏造一個時段出來，
  // 讓欄位顯示「—」，與每小時路徑及 KPI 卡的處理一致。
  if (
    best &&
    !best.buckets.some((bucket) => bucket.pcu > 0 || bucket.total > 0)
  )
    return null;
  return best ? { buckets: best.buckets, label: best.label } : null;
}

/**
 * 尖峰時段要以誰為準。
 *
 * "point"（預設）：整個調查點取同一個尖峰小時，各方向／支線都報這同一個
 *   時段的量。這樣各方向相加才會等於合計那一列，也才對得上實務上「一個
 *   路口一個尖峰小時」的報表寫法。
 * "direction"：每個方向／支線各自認定自己的尖峰小時（v20.6 以前的行為）。
 *   適合只想知道「這條支線自己最忙是什麼時候」，但各方向不可相加。
 */
export type PeakScope = "point" | "direction";

/**
 * 下拉選項底下那一行白話說明。
 *
 * 為什麼要有：使用者 2026-09-11 自己來問「我有點忘記『整個調查點同一時段』
 * 是什麼意思，定義是依據什麼而找出時段，可相加又是什麼意思」——
 * 這一題的答案在新手手冊裡有，但他在做事的當下不會去翻手冊。
 * 選項名稱後面括號寫「（可相加）」三個字顯然不夠，要把**依據**講出來。
 *
 * ⚠️ 放在這裡而不是寫在畫面上，是因為**同一組字有三個地方要用**：
 *   ①「時段車種分析」面板的下拉、②報表批次輸出中心的下拉、③新手手冊。
 *   寫在畫面上就會變成三份，改一份忘兩份——這支程式已經踩過那個坑
 *  （單位曾經一處寫 PCU/hr、另一處寫 PCU/日，同一個數字兩種單位）。
 */
export const PEAK_SCOPE_HINTS: Record<PeakScope, string> = {
  point: "各方向報雙向合計最忙的那一小時",
  direction: "各方向報各自最忙的那一小時，時段可能不同",
};

export type PeriodAnalysisOptions = {
  factors: PeriodFactors;
  /** 是否要把平日與假日視為不同時段（日別選「平日＋假日」時為 true） */
  separateDays?: boolean;
  /** 方向名稱覆寫（例如路口駛出視角改寫成「駛出路口A」） */
  scopeNameFor?: (record: PeriodRecord) => string;
  /** 尖峰時段以整個調查點為準，或各方向各自認定。預設 "point"。 */
  peakScope?: PeakScope;
  /**
   * 使用者對「橫跨中午的尖峰視窗算上午還是下午」的回答。
   *
   * ⚠️ **選填**：沒有任何回答時，行為與 v20.67 以前逐格相同
   *   （上午只看 12:00 以前起算、下午只看 12:00 以後起算，跨中午的視窗
   *   兩邊都挑不到）。有回答時才會把那個視窗指派到使用者說的那一邊。
   */
  noonAnswers?: NoonAnswers;
};

/**
 * 依「調查點 × 方向 × 時段」計算各車種車輛數／百分比／交通流量。
 * 每個調查點都會產生一列「合計」（雙向合計或全部支線合計）＋每個方向各一列。
 */
/**
 * 只要列，不要問題清單——絕大多數呼叫端用這一支。
 *
 * ⚠️ 刻意做成 buildPeriodAnalysis 的薄包裝，而不是另外寫一份。
 *   兩份各自維護的話，日後改了一邊沒改另一邊，畫面上的數字與問題清單
 *   就會對不起來——而那種錯不會壞掉，只會讓人看錯。
 */
export function buildPeriodRows(
  records: PeriodRecord[],
  options: PeriodAnalysisOptions,
): PeriodRow[] {
  return buildPeriodAnalysis(records, options).rows;
}

/**
 * 依「調查點 × 方向 × 時段」計算各車種車輛數／百分比／交通流量，
 * 並一併回報「有沒有橫跨中午、需要問使用者的尖峰視窗」。
 */
export function buildPeriodAnalysis(
  records: PeriodRecord[],
  options: PeriodAnalysisOptions,
): { rows: PeriodRow[]; straddles: NoonStraddle[] } {
  const {
    factors,
    separateDays = false,
    scopeNameFor,
    peakScope = "point",
    noonAnswers,
  } = options;
  /*
   * 每一個調查點各自判斷「時間格是不是不足一小時」。
   *
   * 這件事一定要逐調查點算：畫面預設是「全部調查點」，若拿整批資料取眾數，
   * 只要 24 小時調查點的筆數多過 15 分鐘調查點，後者就會被誤判成整點資料，
   * 尖峰改走每小時路徑（值變小），連「分析時段」欄都會印成 17:00～17:15
   * 這種 15 分鐘標籤卻裝著一小時的量。反之亦然。
   */
  const hoursByRoad = new Map<string, string[]>();
  for (const record of records) {
    const list = hoursByRoad.get(record.roadId) ?? [];
    list.push(record.hour ?? "");
    hoursByRoad.set(record.roadId, list);
  }
  const subHourlyByRoad = new Map<string, boolean>();
  for (const [roadId, hours] of hoursByRoad) {
    const minutes = intervalMinutesOf(hours);
    subHourlyByRoad.set(roadId, minutes > 0 && minutes < 60);
  }
  const isSubHourly = (roadId: string) => subHourlyByRoad.get(roadId) ?? false;
  type ScopeState = {
    roadId: string;
    roadName: string;
    surveyType: "road" | "intersection";
    scopeCode: string;
    scopeName: string;
    /** X-18：平日＋假日時這一列是哪一天；單一日別時是空字串。 */
    dayType: string;
    hours: Map<string, HourBucket>;
  };
  const scopes = new Map<string, ScopeState>();

  /*
   * ── X-18（使用者 2026-09-16）：平日＋假日要**一天一列**，不是併成一列 ──
   *
   * 使用者原話：「這張表僅有在平日+假日條件下，變成了數字加總或
   *   僅顯示某一天做為替代」——兩種症狀其實是同一個原因：
   *   列的鍵只有「調查點×方向」，**沒有日別**，於是兩天的時間格
   *   全部落進同一列：
   *     ・「全調查時段」欄把兩天的量**加起來**（得到一個不存在的量）
   *     ・「上午尖峰」欄在兩天的格子裡挑最大的那一個，
   *       所以看起來像**只顯示某一天**
   *   （separateDays 原本只作用在**時間格**的鍵上，不在列的鍵上。）
   *
   * ⚠️ 修法：separateDays 時把日別也放進列的鍵，並把 dayType 帶到列上。
   *   這符合專案的通則「A＋B 一律並列，不是加總、也不是取其中一個」。
   * ⚠️ 這**會改變平日＋假日模式下的數字**（從錯的變成對的），
   *   單一日別模式一個數字都不動——升級當天的差異只會出現在那一個模式。
   */
  const touch = (
    record: PeriodRecord,
    scopeCode: string,
    scopeName: string,
  ): ScopeState => {
    const day = separateDays ? String(record.dayType ?? "") : "";
    const id = `${record.roadId}||${scopeCode}||${day}`;
    let state = scopes.get(id);
    if (!state) {
      state = {
        roadId: record.roadId,
        roadName: record.roadName,
        surveyType: record.surveyType === "intersection" ? "intersection" : "road",
        scopeCode,
        scopeName,
        dayType: day,
        hours: new Map(),
      };
      scopes.set(id, state);
    }
    if (record.surveyType === "intersection") state.surveyType = "intersection";
    return state;
  };

  const bucketOf = (state: ScopeState, record: PeriodRecord) => {
    // 用「起始時間」當鍵，而不是原始字串。原始檔可能寫成 08:00～09:00、
    // 08:00~09:00 或 08:00-09:00，字串不同但其實是同一格；
    // 直接用字串當鍵會把同一格拆成好幾桶，尖峰就會被低估。
    //
    // 每小時一列的資料以「起始小時」分桶（維持原本行為）；
    // 15 分鐘一格的部分時段調查則必須保留每一格，之後才能用滾動視窗求尖峰，
    // 若也併成整點小時，就只會得到固定時鐘區間的結果而不是真正的尖峰小時。
    const subHourly = isSubHourly(record.roadId);
    const range = parseTimeRange(record.hour);
    const startMinutes = subHourly
      ? (range?.start ?? hourStartOf(record.hour) * 60)
      : hourStartOf(record.hour) * 60;
    const day = separateDays ? String(record.dayType ?? "") : "";
    const key = subHourly
      ? String(startMinutes).padStart(4, "0")
      : String(Math.floor(startMinutes / 60)).padStart(2, "0");
    const label = separateDays ? `${day}|${key}` : key;
    let bucket = state.hours.get(label);
    if (!bucket) {
      bucket = {
        label,
        day,
        startMinutes,
        display: separateDays
          ? `${record.dayType ?? ""} ${record.hour}`.trim()
          : record.hour,
        vehicles: {},
        vehiclePcu: {},
        total: 0,
        pcu: 0,
        hour: record.hour,
      };
      state.hours.set(label, bucket);
    }
    return bucket;
  };

  for (const record of records) {
    // 時段解析不出來的資料（例如手動塞進 API 的「全日」字樣）不納入。
    // 否則它會被算進全調查時段、還可能贏得全調查時段尖峰，卻不屬於上午也不屬於下午，
    // 三個欄位就對不起來。
    if (!record.hour || hourStartOf(record.hour) < 0) continue;
    const directionName =
      (scopeNameFor ? scopeNameFor(record) : record.directionName) ||
      record.directionCode;
    const combined = touch(record, "ALL", "");
    accumulate(bucketOf(combined, record), record, factors);
    // 方向代碼剛好也叫 ALL 時，它就是合計那一列，不能再累加一次。
    if (record.directionCode !== "ALL") {
      const scoped = touch(record, record.directionCode, directionName);
      scoped.scopeName = directionName;
      accumulate(bucketOf(scoped, record), record, factors);
    }
  }

  const sortedBucketsOf = (state: ScopeState) =>
    [...state.hours.values()].sort(
      (a, b) => a.day.localeCompare(b.day, "zh-TW") || a.startMinutes - b.startMinutes,
    );

  /*
   * 把使用者的回答換成兩件事：
   *   blocked.am ＝ 這些格子已經被指派給**下午**，上午就不可以再算它們；
   *   blocked.pm ＝ 反之。
   *
   * ⚠️ 這個排除是必要的，不是保險。少了它會出現**同一批車被算進兩個尖峰**：
   *   例如使用者說 11:45–12:45 算上午，而 12:00～12:45 那三格本來就落在下午段，
   *   下午尖峰照樣會挑到含有它們的 12:00–13:00——於是報告上「上午尖峰」與
   *   「下午尖峰」共用了 45 分鐘的車流，兩個數字都對，加起來卻不對。
   */
  const noonSides = (
    roadId: string,
    straddles: Map<string, { buckets: HourBucket[]; label: string; value: number }>,
    answers: NoonAnswers | undefined,
  ) => {
    const blocked = { am: new Set<string>(), pm: new Set<string>() };
    const assigned = new Map<
      NoonAnswer,
      { buckets: HourBucket[]; label: string; value: number }[]
    >([
      ["am", []],
      ["pm", []],
    ]);
    for (const [day, window] of straddles) {
      const answer = answers?.[noonStraddleKey(roadId, day)];
      // "ignore"（使用者選「忽略這個時段」）與「還沒回答」在計算上相同：
      // 什麼都不做，照原本的 12:00 分界算。
      if (answer !== "am" && answer !== "pm") continue;
      assigned.get(answer)?.push(window);
      // 指派給上午的，下午不可以再算；反之亦然。
      const other = answer === "am" ? "pm" : "am";
      for (const bucket of window.buckets) blocked[other].add(bucket.label);
    }
    return {
      blocked,
      /** 把「被指派到這一邊」的跨中午視窗拿去跟這一邊原本挑到的比大小。 */
      pickFor: (
        side: NoonAnswer,
        base: WindowPick | undefined,
        all: HourBucket[],
      ): WindowPick | undefined => {
        let best = base;
        let bestValue = base
          ? weightSum(all.filter((bucket) => base.labels.has(bucket.label)))
          : 0;
        for (const window of assigned.get(side) ?? []) {
          if (best && window.value <= bestValue) continue;
          best = {
            labels: new Set(window.buckets.map((bucket) => bucket.label)),
            label: window.label,
            crossesNoon: true,
          };
          bestValue = window.value;
        }
        return best;
      },
    };
  };

  /** 一批格子的權重合計：有 PCU 就比 PCU，全是 0 才退而比車輛數（與 peakWindow 一致）。 */
  const weightSum = (list: HourBucket[]) => {
    const pcu = list.reduce((sum, bucket) => sum + bucket.pcu, 0);
    return pcu > 0 ? pcu : list.reduce((sum, bucket) => sum + bucket.total, 0);
  };

  /*
   * 找出「**橫跨中午**、而且湊得滿一小時」的最佳視窗，逐日別各一個。
   *
   * 為什麼需要它：上午段只看 12:00 以前起算的格子、下午段只看 12:00 以後，
   * 所以 11:15～12:15 這種視窗**兩邊都挑不到**。若它其實是這一天最忙的一小時，
   * 目前的結果就會安靜地少報——上午尖峰報一個比較小的時段，而畫面上完全
   * 看不出來漏掉了什麼。使用者 2026-09-12 指出這一點：「如果有 15 分鐘滾動
   * 去計算 1 小時的當量時，其實也會遇到」。
   *
   * ⚠️ 這一支**只負責找出候選**，不決定它算上午還是下午——那是報告怎麼寫的
   *   問題，程式判斷不了，一律問使用者（見 NoonStraddle 與 noonAnswers）。
   */
  const straddleWindowsOf = (list: HourBucket[], subHourly: boolean) => {
    const out = new Map<
      string,
      { buckets: HourBucket[]; label: string; value: number }
    >();
    const byDay = new Map<string, HourBucket[]>();
    for (const bucket of list) {
      const arr = byDay.get(bucket.day) ?? [];
      arr.push(bucket);
      byDay.set(bucket.day, arr);
    }
    for (const [day, arr] of byDay) {
      const sorted = [...arr].sort((a, b) => a.startMinutes - b.startMinutes);
      const better = (value: number, buckets: HourBucket[], label: string) => {
        if (value <= 0) return;
        const prev = out.get(day);
        if (!prev || value > prev.value) out.set(day, { buckets, label, value });
      };
      if (!subHourly) {
        /*
         * 每小時一格的資料：視窗就是那一格本身。它會不會跨中午，取決於
         * 原始檔自己的寫法（例如整份檔寫成 11:30～12:30、12:30～13:30）。
         */
        for (const bucket of sorted)
          if (straddlesNoon(bucket.hour))
            better(weightSum([bucket]), [bucket], bucket.display);
        continue;
      }
      /*
       * 細格資料：從每一個「起點在 11:00 之後、12:00 之前」的格子往後串，
       * 串到剛好滿 60 分鐘且首尾相接為止。湊不滿就不算——不足一小時的量
       * 標成尖峰小時會低估，那是這支程式一路在避開的錯。
       */
      for (let index = 0; index < sorted.length; index += 1) {
        const start = sorted[index].startMinutes;
        if (start <= NOON_MINUTES - 60 || start >= NOON_MINUTES) continue;
        const window: HourBucket[] = [];
        let end = start;
        let cursor = index;
        while (cursor < sorted.length && end - start < 60) {
          const range = parseTimeRange(sorted[cursor].hour);
          if (!range) break;
          // 首尾相接才算同一個視窗；遇到資料空隙就停。
          if (window.length && range.start !== end) break;
          window.push(sorted[cursor]);
          end = range.end;
          cursor += 1;
        }
        if (end - start !== 60) continue;
        const label = `${minutesToClock(start)}～${minutesToClock(end)}`;
        better(weightSum(window), window, day ? `${day} ${label}` : label);
      }
    }
    return out;
  };

  /**
   * peakScope === "point" 時，先把每個調查點「合計」那一列的尖峰時段算出來，
   * 之後各方向一律沿用同一個視窗。
   *
   * 為什麼要這樣：各支線各自找自己的尖峰，會得到互不相同的時段（實測七叉
   * 路口為例，A 是 07:00～08:00、B 是 07:30～08:30），於是那一欄既不能相加、
   * 也對不上「進入該路口交通量」這類以路口整體尖峰小時編製的報表。
   */
  /*
   * crossesNoon ＝ 這個視窗是「使用者指派過來的跨中午視窗」。
   *
   * ⚠️ 這個旗標非有不可。applyShared 是拿「上午的格子清單」去比對標籤的，
   *   而跨中午的視窗有一半格子在下午——不標出來的話，各方向那幾列只會留下
   *   中午以前的那一兩格，數字直接砍掉一大半（實測：2800 變成 100）。
   */
  type WindowPick = { labels: Set<string>; label: string; crossesNoon?: boolean };
  const pointWindows = new Map<string, Partial<Record<PeriodKey, WindowPick>>>();
  /*
   * ⚠️ X-18：這張表的鍵**一定要含日別**。
   *
   *   平日＋假日模式下，同一個調查點會有兩個 ALL 列（平日一個、假日一個）。
   *   只用 roadId 當鍵的話，後寫入的那一天會蓋掉前一天，於是**兩天共用
   *   同一個尖峰視窗**——另一天的格子對不上那組標籤，值就變成 0。
   *   （實測：平日 08:00～09:00 的上午尖峰變成 0，標籤還寫著「假日 08:00～09:00」。）
   */
  const windowKeyOf = (state: { roadId: string; dayType: string }) =>
    `${state.roadId}||${state.dayType}`;
  if (peakScope === "point") {
    for (const state of scopes.values()) {
      if (state.scopeCode !== "ALL") continue;
      const buckets = sortedBucketsOf(state);
      const pick = (list: HourBucket[]): WindowPick | undefined => {
        const window = peakWindow(list, isSubHourly(state.roadId));
        if (!window) return undefined;
        return {
          labels: new Set(window.buckets.map((bucket) => bucket.label)),
          label: window.label,
        };
      };
      /*
       * 使用者說某個跨中午的視窗算上午（或下午）時，它就直接當那一邊的
       * 尖峰——前提是它比那一邊原本挑到的還大（不然指派過去反而把尖峰改小）。
       */
      const straddles = straddleWindowsOf(buckets, isSubHourly(state.roadId));
      const sides = noonSides(state.roadId, straddles, noonAnswers);
      pointWindows.set(windowKeyOf(state), {
        peak24: pick(buckets),
        am: sides.pickFor(
          "am",
          pick(
            buckets.filter(
              (bucket) =>
                isMorningHour(bucket.hour) && !sides.blocked.am.has(bucket.label),
            ),
          ),
          buckets,
        ),
        pm: sides.pickFor(
          "pm",
          pick(
            buckets.filter(
              (bucket) =>
                isAfternoonHour(bucket.hour) && !sides.blocked.pm.has(bucket.label),
            ),
          ),
          buckets,
        ),
      });
    }
  }

  const rows: PeriodRow[] = [];
  for (const state of scopes.values()) {
    const buckets = sortedBucketsOf(state);
    const morning = buckets.filter((bucket) => isMorningHour(bucket.hour));
    const afternoon = buckets.filter((bucket) => isAfternoonHour(bucket.hour));
    // 調查點層級的視窗（若有）優先；沒有的話退回這一列自己找。
    // 例如某支線在該視窗完全沒有資料，就不會硬湊出一個空格。
    const shared = pointWindows.get(windowKeyOf(state));
    /*
     * point 模式的重點是「各方向相加＝合計」，所以就算某個方向在該視窗內
     * 完全沒有資料，也必須輸出這個視窗（值為 0），而不是退回去找自己的尖峰。
     * 退回去會讓那一列報出別的時段、金額也算進去，各方向相加就會大於合計，
     * 與下拉選項寫的「可相加」自相矛盾。
     */
    const applyShared = (key: PeriodKey, list: HourBucket[]) => {
      const pick = shared?.[key];
      if (!pick) return null;
      // 跨中午的視窗要在**全部格子**裡比對，不能只在上午（或下午）那一半裡找。
      const source = pick.crossesNoon ? buckets : list;
      return {
        buckets: source.filter((bucket) => pick.labels.has(bucket.label)),
        label: pick.label,
      };
    };
    const scopeSubHourly = isSubHourly(state.roadId);
    const peak =
      applyShared("peak24", buckets) ?? peakWindow(buckets, scopeSubHourly);
    /*
     * ⚠️ 這一段在 point 模式下不會執行（applyShared 已經給了答案，而且那個
     *   答案是調查點層級算好、各方向共用的——各方向必須在同一個視窗裡取值，
     *   否則相加不等於合計，那是 v20.67 修過的錯）。
     *   只有 direction 模式（各方向各自認定）才會走到這裡自己套回答。
     */
    const ownStraddles = straddleWindowsOf(buckets, scopeSubHourly);
    const ownSides = noonSides(state.roadId, ownStraddles, noonAnswers);
    const applyAnswer = (
      base: { buckets: HourBucket[]; label: string } | null,
      side: NoonAnswer,
    ) => {
      let best = base;
      let bestValue = base ? weightSum(base.buckets) : 0;
      for (const [day, window] of ownStraddles) {
        // 同上："ignore" 不會等於 "am" 或 "pm"，所以自然什麼都不做。
        if (noonAnswers?.[noonStraddleKey(state.roadId, day)] !== side) continue;
        if (best && window.value <= bestValue) continue;
        best = { buckets: window.buckets, label: window.label };
        bestValue = window.value;
      }
      return best;
    };
    const amPeak =
      applyShared("am", morning) ??
      applyAnswer(
        peakWindow(
          morning.filter((bucket) => !ownSides.blocked.am.has(bucket.label)),
          scopeSubHourly,
        ),
        "am",
      );
    const pmPeak =
      applyShared("pm", afternoon) ??
      applyAnswer(
        peakWindow(
          afternoon.filter((bucket) => !ownSides.blocked.pm.has(bucket.label)),
          scopeSubHourly,
        ),
        "pm",
      );
    rows.push({
      roadId: state.roadId,
      roadName: state.roadName,
      surveyType: state.surveyType,
      scopeCode: state.scopeCode,
      /* X-18：平日＋假日時一天一列，這一欄說出是哪一天。 */
      dayType: state.dayType || undefined,
      scopeName:
        state.scopeCode === "ALL"
          ? state.surveyType === "intersection"
            ? "全部支線合計"
            : "雙向合計"
          : state.scopeName || state.scopeCode,
      periods: {
        // 日別選「平日＋假日」時，全日欄位是兩天的加總，標籤要講清楚。
        // 另外，這一欄過去無論實際調查幾小時都寫「24 小時」，只調查
        // 07:00~09:00、17:00~19:00 的部分時段案件也照樣標成 24 小時，
        // 使用者會誤以為那是完整的全日量並直接拿去跟別季比較。
        all: cellFromBuckets(buckets, fullDayLabel(buckets, separateDays)),
        peak24: peak ? cellFromBuckets(peak.buckets, peak.label) : emptyCell("—"),
        am: amPeak ? cellFromBuckets(amPeak.buckets, amPeak.label) : emptyCell("—"),
        pm: pmPeak ? cellFromBuckets(pmPeak.buckets, pmPeak.label) : emptyCell("—"),
      },
    });
  }

  /*
   * ── 要問使用者的跨中午視窗 ──────────────────────────────
   *
   * ⚠️ 只在「它比上午與下午各自的尖峰都大」時才問。
   *   沒有跨中午的不必問；跨了但比兩邊都小的話，問了也不會改變任何一個
   *   欄位的數字——問了只是打擾，而且會讓真正需要注意的那一次被淹沒。
   *
   * ⚠️ 一律以**調查點合計（ALL）**那一列判斷，不逐方向問。
   *   逐方向問會問出七、八次，而且各方向答不一樣時，「各方向相加＝合計」
   *   就破了（那是 v20.67 修過的錯）。
   */
  const straddles: NoonStraddle[] = [];
  for (const state of scopes.values()) {
    if (state.scopeCode !== "ALL") continue;
    const buckets = sortedBucketsOf(state);
    const subHourly = isSubHourly(state.roadId);
    const windows = straddleWindowsOf(buckets, subHourly);
    for (const [day, window] of windows) {
      const sameDay = (bucket: HourBucket) => bucket.day === day;
      const amBest = peakWindow(
        buckets.filter((bucket) => sameDay(bucket) && isMorningHour(bucket.hour)),
        subHourly,
      );
      const pmBest = peakWindow(
        buckets.filter((bucket) => sameDay(bucket) && isAfternoonHour(bucket.hour)),
        subHourly,
      );
      const amValue = amBest ? weightSum(amBest.buckets) : 0;
      const pmValue = pmBest ? weightSum(pmBest.buckets) : 0;
      /*
       * ⚠️ 觸發條件是「它是這一天最忙的那一小時」，不是「它比上午與下午
       *   各自的尖峰都大」。
       *
       *   兩者看起來很像，但差在一種真實會發生的情況：原始檔的時間格本身
       *   就寫成 11:30～12:30 時，那一格的起始時間在中午以前，所以它**本來
       *   就已經被選成上午尖峰**——用「比上午尖峰大」當條件的話永遠不成立
       *  （它就是上午尖峰），於是永遠不會問，而它究竟該算上午還是下午，
       *   正是唯一需要人來決定的地方。實測這一項會漏掉整種情況。
       *
       *   改用「是不是這一天最忙的一小時」就兩種來源都涵蓋：
       *   15 分鐘滾動湊出來的 11:45–12:45、以及原始檔自己寫的 11:30～12:30。
       */
      const dayBest = peakWindow(buckets.filter(sameDay), subHourly);
      const dayValue = dayBest ? weightSum(dayBest.buckets) : 0;
      if (window.value < dayValue - 1e-9) continue;
      straddles.push({
        key: noonStraddleKey(state.roadId, day),
        roadId: state.roadId,
        roadName: state.roadName,
        day,
        label: window.label,
        value: window.value,
        amLabel: amBest?.label ?? "",
        amValue,
        pmLabel: pmBest?.label ?? "",
        pmValue,
      });
    }
  }

  rows.sort((a, b) => {
    // 先用名稱排序，但同名時一定要再用 roadId 分開；否則同名的兩個調查點
    // 會交錯在一起，而且兩列都是合計時比較器會自相矛盾（兩邊都回 -1）。
    if (a.roadName !== b.roadName) return a.roadName.localeCompare(b.roadName, "zh-TW");
    if (a.roadId !== b.roadId) return a.roadId.localeCompare(b.roadId, "en");
    if (a.scopeCode === b.scopeCode) return 0;
    if (a.scopeCode === "ALL") return -1;
    if (b.scopeCode === "ALL") return 1;
    return a.scopeCode.localeCompare(b.scopeCode, "en");
  });
  straddles.sort(
    (a, b) =>
      a.roadName.localeCompare(b.roadName, "zh-TW") ||
      a.roadId.localeCompare(b.roadId, "en") ||
      a.day.localeCompare(b.day, "zh-TW"),
  );
  return { rows, straddles };
}

/** 百分比：某車種車輛數佔該格全部車種車輛數的比例（0–100）。 */
export function shareOf(cell: PeriodCell, vehicleKey: string) {
  if (!cell.total) return 0;
  return ((cell.vehicles[vehicleKey] ?? 0) / cell.total) * 100;
}

export function periodCellValue(
  cell: PeriodCell,
  vehicleKey: string,
  metric: MetricKey,
) {
  if (metric === "count") return cell.vehicles[vehicleKey] ?? 0;
  if (metric === "pcu") return cell.vehiclePcu[vehicleKey] ?? 0;
  return shareOf(cell, vehicleKey);
}

/** 匯出設定：使用者勾選哪些時段／方向／指標，就產生哪些工作表與欄位。 */
/** 路口流量視角；"follow" ＝ 沿用畫面上「時段車種分析」目前的設定 */
export type PeriodFlowChoice = "follow" | "origin" | "destination" | "both";

export type PeriodExportSelection = {
  enabled: boolean;
  periods: PeriodKey[];
  /** "ALL" 代表合計列；其餘為方向代碼 */
  scopes: string[];
  metrics: MetricKey[];
  /** 每個時段各一張工作表；false 則全部併成一張大表 */
  sheetPerPeriod: boolean;
  /**
   * 匯出時要用哪一種尖峰時段認定。"follow" ＝ 沿用畫面上目前的選擇。
   * 明確指定的話，匯出結果就不會因為畫面上改過而變動，存成範本也才有意義。
   */
  peakScope: "follow" | PeakScope;
  /** 匯出時要用哪一種路口流量視角。"follow" ＝ 沿用畫面上目前的選擇。 */
  flowView: PeriodFlowChoice;
};

export function defaultPeriodExportSelection(): PeriodExportSelection {
  return {
    enabled: true,
    periods: ["all", "am", "pm"],
    scopes: [],
    metrics: ["count", "share", "pcu"],
    sheetPerPeriod: true,
    peakScope: "follow",
    flowView: "follow",
  };
}

export function normalizePeriodExportSelection(
  value: unknown,
): PeriodExportSelection {
  const base = defaultPeriodExportSelection();
  if (!value || typeof value !== "object") return base;
  const raw = value as Partial<PeriodExportSelection>;
  const periods = Array.isArray(raw.periods)
    ? raw.periods.filter((key): key is PeriodKey => PERIOD_KEYS.includes(key as PeriodKey))
    : base.periods;
  const metrics = Array.isArray(raw.metrics)
    ? raw.metrics.filter((key): key is MetricKey => METRIC_KEYS.includes(key as MetricKey))
    : base.metrics;
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : base.enabled,
    periods: periods.length ? periods : base.periods,
    scopes: Array.isArray(raw.scopes) ? raw.scopes.map(String) : base.scopes,
    metrics: metrics.length ? metrics : base.metrics,
    sheetPerPeriod:
      typeof raw.sheetPerPeriod === "boolean" ? raw.sheetPerPeriod : base.sheetPerPeriod,
    peakScope:
      raw.peakScope === "point" || raw.peakScope === "direction"
        ? raw.peakScope
        : base.peakScope,
    flowView:
      raw.flowView === "origin" ||
      raw.flowView === "destination" ||
      raw.flowView === "both"
        ? raw.flowView
        : base.flowView,
  };
}

/** 依勾選組合展開成匯出用的工作表結構（欄位標題＋資料列）。 */
export function buildPeriodExportSheets(
  rows: PeriodRow[],
  catalog: { key: string; label: string }[],
  selection: PeriodExportSelection,
  context: { flowLabel: string; separateDays?: boolean; partial?: boolean },
) {
  const periods = PERIOD_KEYS.filter((key) => selection.periods.includes(key));
  const metrics = METRIC_KEYS.filter((key) => selection.metrics.includes(key));
  const scopeAllowed = (code: string) =>
    !selection.scopes.length || selection.scopes.includes(code);
  const visibleRows = rows.filter((row) => scopeAllowed(row.scopeCode));
  if (!periods.length || !metrics.length || !visibleRows.length) return [];

  /*
   * 欄名的單位要看「這個時段實際上是幾分鐘」，不能無條件標成 /hr。
   *
   * metricUnitFor 對所有尖峰時段一律回 輛/hr、PCU/hr；但滾動尖峰在
   * 15 分鐘細格＋中間有空檔時可能湊不滿一小時（例如 07:00～07:45，
   * 標成 /hr 會低估 25%），以 2 小時為一格的原始檔則會得到 120 分鐘的
   * 視窗（標成 /hr 高估一倍）。cellUnitFor 本來就是為了這件事而寫的，
   * 只是欄名這一支沒有用到它——結果同一份交付包裡，Excel 欄頭寫 輛/hr、
   * 報告草稿對同一個數字寫「輛/該時段（45 分鐘）」。
   *
   * 欄名要涵蓋整欄，所以先看這一欄的每一列時段是不是都一樣：
   * 都一樣就用那個時段的正確單位；長短不一時就明講要看「分析時段」欄。
   */
  const headerUnit = (metric: MetricKey, period: PeriodKey) =>
    columnUnitFor(
      metric,
      period,
      visibleRows.map((row) => row.periods[period]?.hour || ""),
      { separateDays: context.separateDays },
    );
  const metricHeaders = (period: PeriodKey) =>
    metrics.flatMap((metric) =>
      catalog.map(
        (item) =>
          `${periods.length > 1 && !selection.sheetPerPeriod ? `${PERIOD_LABELS[period]}・` : ""}${item.label}${METRIC_LABELS[metric]}（${
            metric === "share"
              ? metricUnitFor(metric, period, {
                  separateDays: context.separateDays,
                  partial: context.partial,
                })
              : headerUnit(metric, period)
          }）`,
      ),
    );
  const metricValues = (row: PeriodRow, period: PeriodKey) =>
    metrics.flatMap((metric) =>
      catalog.map((item) => {
        const value = periodCellValue(row.periods[period], item.key, metric);
        return metric === "share"
          ? Number(value.toFixed(2))
          : Number(value.toFixed(metric === "pcu" ? 1 : 0));
      }),
    );

  /*
   * ⚠️ X-18：平日＋假日時一天一列，匯出也要跟著多一欄「日別」——
   *   不加的話 Excel 裡同一個調查點會出現兩列一模一樣的抬頭，
   *   看的人分不出哪一列是平日。單一日別時不加這一欄（沒有兩列要分）。
   */
  const baseHeaders = context.separateDays
    ? ["調查點編號", "調查點名稱", "日別", "資料格式", "方向／支線"]
    : ["調查點編號", "調查點名稱", "資料格式", "方向／支線"];
  const baseValues = (row: PeriodRow) => [
    row.roadId,
    row.roadName,
    ...(context.separateDays ? [row.dayType ?? ""] : []),
    // 並列模式下每一列各自帶 flowLabel；否則才用整批的視角。
    // 用整批的會讓「駛入路口A」那一列被標成「路口（駛出）」，自相矛盾。
    row.surveyType === "intersection"
      ? `路口（${row.flowLabel ?? context.flowLabel}）`
      : "路段",
    row.scopeName,
  ];

  if (selection.sheetPerPeriod) {
    return periods.map((period) => ({
      name: `${PERIOD_LABELS[period]}車種分析`,
      period,
      headers: [...baseHeaders, "分析時段", ...metricHeaders(period)],
      rows: visibleRows.map((row) => [
        ...baseValues(row),
        row.periods[period].hour,
        ...metricValues(row, period),
      ]),
    }));
  }

  return [
    {
      name: "時段車種分析",
      period: periods[0],
      headers: [
        ...baseHeaders,
        ...periods.map((period) => `${PERIOD_LABELS[period]}・時段標籤`),
        ...periods.flatMap((period) => metricHeaders(period)),
      ],
      rows: visibleRows.map((row) => [
        ...baseValues(row),
        ...periods.map((period) => row.periods[period].hour),
        ...periods.flatMap((period) => metricValues(row, period)),
      ]),
    },
  ];
}

export function periodVehicleLabel(
  records: PeriodRecord[],
  key: string,
  settings: VehicleClassSetting[],
) {
  const record = records.find((item) => item);
  return record ? effectiveVehicleLabel(record, key, settings) : key;
}
