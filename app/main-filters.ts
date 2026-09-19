/*
 * ══════════════════════════════════════════════════════════════════════
 *  主工具列的條件模型（純資料，沒有 React，可以單獨寫測試）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一套三態機制**三支程式一律相同**（使用者 2026-09-14：
 *   「三個程式要統一的，包含主工具列的 全部回歸鍵 和 各自圖表的回歸鍵，
 *     以及你說的圖自己的篩選只影響自己，不會影響到其他圖表，
 *     這方面的規定應該是適用三項程式」）。
 *   路口轉向在 g2164/app/main-filters.ts、交通服務水準在 ts2028/main-filters.js，
 *   欄位不同、規則相同；改的時候三邊一起改。
 *
 * ── 三態，缺一不可 ────────────────────────────────────────────
 *
 *   ① 鏡子：區塊上那一顆下拉顯示的就是主工具列現在的值；主工具列一改，
 *          那一顆**看得到跟著變**，而且數字要真的重算。
 *   ② 脫離：使用者真的動了區塊上的條件 → **只有那一塊**改用自己的值，
 *          並寫明「目前用本區塊自己的條件（主工具列：…）」。
 *   ③ 回歸：每一塊脫離的區塊有一顆「回到主工具列條件」；
 *          主工具列上另有一顆「回歸全部（N 塊）」。
 *
 * ── 這一支程式的條件（見對照表_全日交通量） ──────────────────
 *
 *   A 季度       起訖區間（預設起＝迄＝最新一季，等於單季）
 *   B 日別       平日／假日／平日＋假日
 *   C 路段／路口 多選
 *   D 車流方向   多選
 *   E 調查時段   全調查時段／全調查時段尖峰／上午尖峰小時／下午尖峰小時／**上午＋下午並列**
 *   F 路口流量視角 駛出／駛入／**駛出＋駛入並列**
 *   G 尖峰時段認定 整個調查點同一時段（可相加）／各方向各自認定   ← 原本只在「時段車種分析」裡
 *   H 顯示數值   車輛數／交通流量／百分比／**交通流量＋百分比**／**車輛數＋百分比**
 */
import type { PeriodKey } from "./period-analysis";

/**
 * 調查時段。
 *
 * ⚠️ 比 PeriodKey 多一個 "AMPM"（上午＋下午並列）。
 *   並列不是一種 PeriodKey，是「這一塊要同時呈現兩個時段」，
 *   所以只活在主工具列這一層，往下傳給計算時一定要先攤開。
 */
export type PeriodChoice = PeriodKey | "AMPM";

/** 路口流量視角。"both" ＝ 駛出與駛入並列。 */
export type FlowChoice = "origin" | "destination" | "both";

/** 尖峰時段認定方式。兩種算出來的數字本來就不一樣。 */
export type PeakScopeChoice = "point" | "direction";

/** 日別。這一支程式本來就用中文字當值（與紀錄裡的 dayType 同一組字）。 */
export type DayChoice = "平日" | "假日" | "平日＋假日";

/**
 * 顯示數值。
 *
 * ⚠️ 前三個是既有的 MetricKey（count／share／pcu），值一個字都不能改——
 *   匯出勾選、報表範本都存著這幾個字串。
 *   後兩個是使用者 2026-09-14 指定補上的組合，只活在畫面這一層。
 */
export type MetricChoice = "count" | "share" | "pcu" | "pcuShare" | "countShare";

export type MainFilters = {
  /** 季度區間。起＝迄時就等於單季（使用者指定的預設狀態）。 */
  quarterFrom: string;
  quarterTo: string;
  /** 空陣列＝全部調查點。 */
  roads: string[];
  /** 空陣列＝全部方向。 */
  directions: string[];
  day: DayChoice;
  period: PeriodChoice;
  flowView: FlowChoice;
  peakScope: PeakScopeChoice;
  metric: MetricChoice;
};

export type MainFilterField = keyof MainFilters;

/**
 * 預設值。
 *
 * ⚠️ 這一份**必須等同升級前的行為**，否則升級當天所有既有數字都會變。
 *   對照升級前的實際狀態：
 *     day        "平日"    （useState<DayMode>("平日")）
 *     period     "all"     （mainPeriod，useState<PeriodKey>("all")）
 *     flowView   "origin"  （intersectionFlowMode 預設駛出）
 *     peakScope  "point"   （periodPeakScope 預設整個調查點同一時段）
 *     metric     "count"   （periodMetric 預設車輛數）
 *   季度區間的起迄由呼叫端填成「最新一季」，這裡留空字串。
 */
export const DEFAULT_MAIN_FILTERS: MainFilters = {
  quarterFrom: "",
  quarterTo: "",
  roads: [],
  directions: [],
  day: "平日",
  period: "all",
  flowView: "origin",
  peakScope: "point",
  metric: "count",
};

/** 每一塊自己的條件；沒有鍵＝那一塊還跟著主工具列（鏡子）。 */
export type ChartOverrides = Record<string, Partial<MainFilters>>;

export function filtersFor(
  main: MainFilters,
  overrides: ChartOverrides,
  chartId: string,
): MainFilters {
  const own = overrides[chartId];
  return own ? { ...main, ...own } : main;
}

export function isDetached(
  overrides: ChartOverrides,
  chartId: string,
): boolean {
  const own = overrides[chartId];
  return Boolean(own) && Object.keys(own as object).length > 0;
}

export function detachedIds(overrides: ChartOverrides): string[] {
  return Object.keys(overrides).filter((id) => isDetached(overrides, id));
}

/**
 * 在某一塊上改一個條件 → 只有那一塊脫離。
 * ⚠️ 回傳新的 overrides，不可以就地改——React 靠參考變化才會重畫。
 */
export function setChartFilter<K extends MainFilterField>(
  overrides: ChartOverrides,
  chartId: string,
  field: K,
  value: MainFilters[K],
): ChartOverrides {
  const own = { ...(overrides[chartId] || {}) };
  own[field] = value;
  return { ...overrides, [chartId]: own };
}

export function resetChart(
  overrides: ChartOverrides,
  chartId: string,
): ChartOverrides {
  if (!overrides[chartId]) return overrides;
  const next = { ...overrides };
  delete next[chartId];
  return next;
}

export function resetAllCharts(): ChartOverrides {
  return {};
}

/*
 * 「有沒有真的篩」——不適用的提醒只在這個為真時才出現。
 *
 * ⚠️ 沒篩的時候跳出來講一句沒有人問的話，是另一種噪音
 *   （使用者 2026-09-14 明確要求「只在真的篩了那個條件時出現」）。
 */
/**
 * 季度區間**有沒有被拉開**（起 ≠ 迄）。
 *
 * ⚠️ 這**不是**「有沒有篩季度」。起＝迄＝只有那一季，也是在篩。
 *   這個函式只回答一件事：**一張卡放不下的那種情形**——
 *   區間拉開時只能顯示其中一季，那時要跟使用者說一聲。
 */
export function isRangeWidened(filters: MainFilters): boolean {
  return Boolean(
    filters.quarterFrom &&
      filters.quarterTo &&
      filters.quarterFrom !== filters.quarterTo,
  );
}

export function isFiltered(
  filters: MainFilters,
  field: MainFilterField,
): boolean {
  switch (field) {
    case "roads":
      return filters.roads.length > 0;
    case "directions":
      return filters.directions.length > 0;
    /*
     * ⚠️⚠️ **季度不要用這個函式問**（2026-09-15 起）。
     *
     *   舊註解寫著「起＝迄不算篩」——那是 M-1 之前的語意。使用者定案之後
     *   剛好相反：**起＝迄＝只有那一季**，那當然是在篩。
     *   但這個函式看不到季度清單，答不出「有沒有比全部季度窄」。
     *
     *   要問「是不是拉開了（一張卡放不下）」請用 `isRangeWidened`——
     *   那才是這個分支實際在回答的事。
     *   tests/main-filters.test.mjs 有一條掃描擋著，呼叫端把
     *   quarterFrom／quarterTo 丟進 isFiltered 會紅。
     *   這裡仍然回答 isRangeWidened 的值，只為了不讓舊呼叫端整支壞掉。
     */
    case "quarterFrom":
    case "quarterTo":
      return isRangeWidened(filters);
    default:
      return filters[field] !== DEFAULT_MAIN_FILTERS[field];
  }
}

export const FIELD_LABELS: Record<MainFilterField, string> = {
  quarterFrom: "季度",
  quarterTo: "季度",
  roads: "路段／路口",
  directions: "車流方向",
  day: "日別",
  period: "調查時段",
  flowView: "路口流量視角",
  peakScope: "尖峰時段認定",
  metric: "顯示數值",
};

export const PERIOD_CHOICE_LABELS: Record<PeriodChoice, string> = {
  all: "全調查時段",
  peak24: "全調查時段尖峰",
  am: "上午尖峰小時",
  pm: "下午尖峰小時",
  AMPM: "上午＋下午並列",
};

export const FLOW_CHOICE_LABELS: Record<FlowChoice, string> = {
  origin: "駛出路口（起點）",
  destination: "駛入路口（終點）",
  both: "駛出＋駛入並列",
};

export const PEAK_SCOPE_CHOICE_LABELS: Record<PeakScopeChoice, string> = {
  point: "整個調查點同一時段（可相加）",
  direction: "各方向各自認定自己的尖峰",
};

export const METRIC_CHOICE_LABELS: Record<MetricChoice, string> = {
  count: "車輛數",
  pcu: "交通流量",
  share: "百分比",
  pcuShare: "交通流量＋百分比",
  countShare: "車輛數＋百分比",
};

/**
 * 把「顯示數值」攤成既有的 MetricKey。
 *
 * ⚠️ 兩個組合選項在計算層**沒有**對應的 MetricKey——既有的匯出勾選、
 *   報表範本存的都是 count／share／pcu 這三個字串，不可以塞新值進去。
 *   組合只是畫面上多寫一欄百分比，主值仍然是那三個之一。
 */
export function metricBaseOf(
  choice: MetricChoice,
): "count" | "share" | "pcu" {
  if (choice === "pcuShare") return "pcu";
  if (choice === "countShare") return "count";
  return choice;
}

/** 這個選項要不要另外寫一欄百分比。 */
export function metricShowsShare(choice: MetricChoice): boolean {
  return choice === "share" || choice === "pcuShare" || choice === "countShare";
}

export const DAY_CHOICES: DayChoice[] = ["平日", "假日", "平日＋假日"];

/**
 * 主工具列目前的條件，寫成一行給脫離的區塊標註用。
 *
 * ⚠️ 第二個參數 `showQuarter` **必須**傳進來（畫面上所有顯示季度的地方都要走它），
 *   否則這一行會是**唯一**還寫著「115Q1」的地方——使用者切到西元年／調查月份時，
 *   整頁都改了、只有這一句沒改，等於一頁兩種年份寫法。
 *   2026-09-15 `e2e-period-display` 就是這樣紅的：收合列的摘要是新加的，
 *   加的時候忘了套顯示設定。預設值只是為了不讓舊呼叫端壞掉，**不是可以省略**。
 */
export function describeMain(
  main: MainFilters,
  showQuarter: (value: string) => string = (value) => value,
): string {
  const parts: string[] = [];
  parts.push(
    main.quarterFrom && main.quarterTo
      ? main.quarterFrom === main.quarterTo
        ? showQuarter(main.quarterFrom)
        : `${showQuarter(main.quarterFrom)}～${showQuarter(main.quarterTo)}`
      : "全部季度",
  );
  parts.push(main.day);
  parts.push(main.roads.length ? `${main.roads.length} 個調查點` : "全部調查點");
  if (main.directions.length) parts.push(`${main.directions.length} 個方向`);
  parts.push(PERIOD_CHOICE_LABELS[main.period]);
  parts.push(FLOW_CHOICE_LABELS[main.flowView]);
  return parts.join("・");
}

/**
 * 不適用的說明文字。
 *
 * ⚠️ 「不適用」**不可以只是不做事**——使用者會以為篩選壞掉。
 *   每一句都要說**為什麼**，而且要說目前實際上是拿什麼在算。
 */
export function inapplicableNote(reason: string, actually: string): string {
  return `${reason}目前仍以${actually}計算。`;
}

/**
 * 尖峰數字旁邊一定要寫明用哪一種認定方式算的。
 *
 * ⚠️ 這不是排版，是可追溯性：兩種算法的數字本來就不同，
 *   「各方向各自認定」那一組**各方向不可以相加**。
 */
export function peakScopeNote(scope: PeakScopeChoice): string {
  return scope === "direction"
    ? "尖峰時段認定：各方向各自認定自己的尖峰——各方向的尖峰不在同一小時，不可以相加。"
    : "尖峰時段認定：整個調查點取同一時段，各方向可以相加。";
}
