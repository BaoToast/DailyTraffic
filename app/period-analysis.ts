import {
  CORE_VEHICLE_KEYS,
  effectiveVehicleCounts,
  effectiveVehicleLabel,
  type CorePcuFactors,
  type CoreTurnPcuFactors,
  type VehicleClassSetting,
  type VehicleRecordLike,
} from "./vehicle-analysis.ts";
import type { CoreVehicleKey, TurnKey } from "./traffic-parser.ts";

/*
 * 時段車種分析（依 2022 年臺灣公路容量手冊之尖峰小時概念實作）
 *
 * 手冊 2.4.5／式(2.10) 只定義「尖峰小時係數 PHF＝尖峰小時流率÷尖峰15分鐘流率」，
 * 以及 K＝尖峰小時流量÷全日流量；手冊全書並未規定上午／下午尖峰的固定時鐘區間
 * （查遍 780 頁沒有 07:00–09:00 這類建議值），所以尖峰小時必須由實測資料自行認定。
 * 本模組採用的認定方式：
 *   全日     ＝ 24 小時全部加總
 *   全日尖峰 ＝ 24 小時中當量交通量(PCU/hr)最大的那一小時
 *   上午尖峰 ＝ 起始時間在中午 12:00 之前，當量交通量最大的那一小時
 *   下午尖峰 ＝ 起始時間在中午 12:00 之後（含 12:00），當量交通量最大的那一小時
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
  all: "全日時段",
  peak24: "全日尖峰小時",
  am: "上午尖峰小時",
  pm: "下午尖峰小時",
};

export const PERIOD_HINTS: Record<PeriodKey, string> = {
  all: "24 小時全部加總",
  peak24: "不分時段，當量交通量最高的 1 小時",
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

export function isMorningHour(hour: string) {
  const start = hourStartOf(hour);
  return start >= 0 && start < 12;
}

export function isAfternoonHour(hour: string) {
  const start = hourStartOf(hour);
  return start >= 12;
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
  /** 尖峰時段標籤；全日時段為「24 小時」 */
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
};

function emptyCell(hour: string): PeriodCell {
  return { vehicles: {}, vehiclePcu: {}, total: 0, pcu: 0, hour, hasData: false };
}

/** 單筆紀錄依車種歸類設定拆出「各車種 PCU」。路口格式會走轉向係數。 */
export function vehiclePcuBreakdown(record: PeriodRecord, factors: PeriodFactors) {
  const { core, coreTurns, settings } = factors;
  const result: Record<string, number> = {};
  const projectId = String(record.projectId ?? "");
  const counts =
    record.vehicleCounts && Object.keys(record.vehicleCounts).length
      ? record.vehicleCounts
      : {
          motorcycle: record.motorcycle || 0,
          small: record.small || 0,
          large: record.large || 0,
          special: record.special || 0,
        };
  for (const sourceKey of Object.keys(counts)) {
    const setting = settings.find(
      (item) => item.projectId === projectId && item.sourceKey === sourceKey,
    );
    const targetKey = setting?.targetKey || sourceKey;
    const isCore = CORE_VEHICLE_KEYS.includes(targetKey as CoreVehicleKey);
    let value = 0;
    if (record.surveyType === "intersection" && record.turnData) {
      for (const turn of ["left", "through", "right"] as TurnKey[]) {
        const factor = isCore
          ? coreTurns[targetKey as CoreVehicleKey][turn]
          : setting?.turnPcu?.[turn];
        value +=
          (record.turnData?.[sourceKey]?.[turn] ?? 0) *
          (Number.isFinite(factor) ? Number(factor) : 0);
      }
    } else {
      const factor = isCore ? core[targetKey as CoreVehicleKey] : setting?.roadPcu;
      // 手動塞進來的資料可能是字串（例如 "n/a"），Number() 會得到 NaN；
      // 讓它變成 0，避免整欄 PCU 變成 NaN 而寫出無效的 Excel 儲存格。
      const count = Number(counts[sourceKey]);
      value +=
        (Number.isFinite(count) ? count : 0) *
        (Number.isFinite(factor) ? Number(factor) : 0);
    }
    result[targetKey] = (result[targetKey] ?? 0) + value;
  }
  return result;
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

export type PeriodAnalysisOptions = {
  factors: PeriodFactors;
  /** 是否要把平日與假日視為不同時段（日別選「平日＋假日」時為 true） */
  separateDays?: boolean;
  /** 方向名稱覆寫（例如路口駛出視角改寫成「駛出路口A」） */
  scopeNameFor?: (record: PeriodRecord) => string;
  /** 尖峰時段以整個調查點為準，或各方向各自認定。預設 "point"。 */
  peakScope?: PeakScope;
};

/**
 * 依「調查點 × 方向 × 時段」計算各車種車輛數／百分比／交通流量。
 * 每個調查點都會產生一列「合計」（雙向合計或全部支線合計）＋每個方向各一列。
 */
export function buildPeriodRows(
  records: PeriodRecord[],
  options: PeriodAnalysisOptions,
): PeriodRow[] {
  const {
    factors,
    separateDays = false,
    scopeNameFor,
    peakScope = "point",
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
    hours: Map<string, HourBucket>;
  };
  const scopes = new Map<string, ScopeState>();

  const touch = (
    record: PeriodRecord,
    scopeCode: string,
    scopeName: string,
  ): ScopeState => {
    const id = `${record.roadId}||${scopeCode}`;
    let state = scopes.get(id);
    if (!state) {
      state = {
        roadId: record.roadId,
        roadName: record.roadName,
        surveyType: record.surveyType === "intersection" ? "intersection" : "road",
        scopeCode,
        scopeName,
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
    // 否則它會被算進全日、還可能贏得全日尖峰，卻不屬於上午也不屬於下午，
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

  /**
   * peakScope === "point" 時，先把每個調查點「合計」那一列的尖峰時段算出來，
   * 之後各方向一律沿用同一個視窗。
   *
   * 為什麼要這樣：各支線各自找自己的尖峰，會得到互不相同的時段（實測七叉
   * 路口為例，A 是 07:00～08:00、B 是 07:30～08:30），於是那一欄既不能相加、
   * 也對不上「進入該路口交通量」這類以路口整體尖峰小時編製的報表。
   */
  type WindowPick = { labels: Set<string>; label: string };
  const pointWindows = new Map<string, Partial<Record<PeriodKey, WindowPick>>>();
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
      pointWindows.set(state.roadId, {
        peak24: pick(buckets),
        am: pick(buckets.filter((bucket) => isMorningHour(bucket.hour))),
        pm: pick(buckets.filter((bucket) => isAfternoonHour(bucket.hour))),
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
    const shared = pointWindows.get(state.roadId);
    /*
     * point 模式的重點是「各方向相加＝合計」，所以就算某個方向在該視窗內
     * 完全沒有資料，也必須輸出這個視窗（值為 0），而不是退回去找自己的尖峰。
     * 退回去會讓那一列報出別的時段、金額也算進去，各方向相加就會大於合計，
     * 與下拉選項寫的「可相加」自相矛盾。
     */
    const applyShared = (key: PeriodKey, list: HourBucket[]) => {
      const pick = shared?.[key];
      if (!pick) return null;
      return {
        buckets: list.filter((bucket) => pick.labels.has(bucket.label)),
        label: pick.label,
      };
    };
    const scopeSubHourly = isSubHourly(state.roadId);
    const peak =
      applyShared("peak24", buckets) ?? peakWindow(buckets, scopeSubHourly);
    const amPeak =
      applyShared("am", morning) ?? peakWindow(morning, scopeSubHourly);
    const pmPeak =
      applyShared("pm", afternoon) ?? peakWindow(afternoon, scopeSubHourly);
    rows.push({
      roadId: state.roadId,
      roadName: state.roadName,
      surveyType: state.surveyType,
      scopeCode: state.scopeCode,
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

  return rows.sort((a, b) => {
    // 先用名稱排序，但同名時一定要再用 roadId 分開；否則同名的兩個調查點
    // 會交錯在一起，而且兩列都是合計時比較器會自相矛盾（兩邊都回 -1）。
    if (a.roadName !== b.roadName) return a.roadName.localeCompare(b.roadName, "zh-TW");
    if (a.roadId !== b.roadId) return a.roadId.localeCompare(b.roadId, "en");
    if (a.scopeCode === b.scopeCode) return 0;
    if (a.scopeCode === "ALL") return -1;
    if (b.scopeCode === "ALL") return 1;
    return a.scopeCode.localeCompare(b.scopeCode, "en");
  });
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
  const headerUnit = (metric: MetricKey, period: PeriodKey) => {
    const hours = Array.from(
      new Set(visibleRows.map((row) => row.periods[period]?.hour || "")),
    );
    if (hours.length === 1)
      return cellUnitFor(metric, period, hours[0], {
        separateDays: context.separateDays,
      });
    const units = Array.from(
      new Set(
        hours.map((hour) =>
          cellUnitFor(metric, period, hour, {
            separateDays: context.separateDays,
          }),
        ),
      ),
    );
    if (units.length === 1) return units[0];
    return `${metric === "pcu" ? "PCU" : "輛"}/各列時段，見「分析時段」欄`;
  };
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

  const baseHeaders = ["調查點編號", "調查點名稱", "資料格式", "方向／支線"];
  const baseValues = (row: PeriodRow) => [
    row.roadId,
    row.roadName,
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
