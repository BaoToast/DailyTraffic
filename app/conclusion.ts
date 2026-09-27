/*
 * 結論草稿產生器（自訂條件）——全日交通量及車種組成。
 *
 * 和 report-draft.ts 的分工：
 * ・report-draft.ts 寫的是「一份報告的固定章節」，段落與順序是排好的。
 * ・這一支寫的是「使用者自己挑條件」的結論——想只寫 115Q2 每個路段的
 *   全日交通量與車種百分比可以，想寫 114 年度四季的變化也可以。
 *
 * 這個檔案是**純文字產生器**：所有數字都由畫面端用 buildPeriodRows 先算好
 * 再傳進來。數字只能有一個來源，這裡不重算，草稿才不會和畫面、Excel 分岔。
 *
 * 單位規則（直接影響能不能相加）：
 * ・「全調查時段」是這份調查涵蓋時段的加總；24 小時的調查單位是 輛/日 或
 *   PCU/日，不足 24 小時的是 輛/調查時段 或 PCU/調查時段；
 *   部分時段調查是 輛/調查時段，兩者不可混談。
 * ・尖峰欄位是某一個小時的量（輛/hr、PCU/hr），是率不是量，
 *   不能跨調查點、跨季度相加。
 * ・單位一律由呼叫端用 cellUnitFor() 逐格算好傳進來，這裡只照抄。
 */

/**
 * ══════════════════════════════════════════════════════════════════════
 *  四個核心統計範圍（三支程式共用的定義，使用者 2026-09-21 定案）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者原話：「這 4 個名詞是我們交通調查的 4 個核心」。
 *
 *   鍵        顯示名稱          意義                              單位
 *   am        上午尖峰小時      12:00 前流率最高的 1 小時          輛/hr、PCU/hr
 *   pm        下午尖峰小時      12:00 後流率最高的 1 小時          輛/hr、PCU/hr
 *   all       全調查時段        調查涵蓋範圍內的**累計量**         輛／調查時段
 *   allPeak   全調查時段尖峰    調查涵蓋範圍內流率最高的 1 小時    輛/hr、PCU/hr
 *
 * ⚠️⚠️ **`allPeak` 絕對不要求 24 小時的資料。**
 *   只做了 4 小時的調查照樣算得出「那 4 小時裡最忙的一小時」，
 *   而且那個數字完全誠實。不要替它加上任何涵蓋時數的門檻。
 *
 * ── 這個鍵為什麼叫 allPeak（v20.83 改名紀錄）─────────────────────────
 *
 *   舊名是 `peak24`。名字裡的 24 是歷史包袱，而且**真的害人誤會過**：
 *   2026-09-21 有 AI 因為看到 24 就推論「不足 24 小時要整組留空」，
 *   差點把一個正確的設計改壞，是使用者當場擋下來的。
 *
 *   改名前查過兩件事：
 *     ① 它會被寫進結論草稿範本（`traffic-conclusion-templates-v1`
 *        → `condition.periods`），所以**改名必須配一段遷移**；
 *     ② 使用者 2026-09-23 確認**目前還沒有任何既存範本**。
 *   兩者都處理了：`migratePeriodKeys()` 在讀取範本時把舊的 `peak24`
 *   換成 `allPeak`，所以就算哪一台電腦上真的存過舊範本也讀得回來。
 *
 * ⚠️ **不要把遷移那一段拿掉**，也不要改回 `peak24`。
 * ⚠️ 「調查日」三個字只保留給**確認滿 24 小時**的資料。
 *   `all` 的分母在滿 24 小時時才寫「調查日」，否則寫「調查時段」。
 */
export type PeriodKey = "all" | "allPeak" | "am" | "pm";

/**
 * 舊範本的時段鍵值遷移（v20.83）。
 *
 * `peak24` 在 v20.83 改名為 `allPeak`（理由見上面那一段）。
 * 那個鍵**會被寫進使用者存的結論草稿範本**，所以讀取端一定要認得舊名，
 * 否則既有範本套用之後「全調查時段尖峰」那一項會安靜地消失——
 * 使用者只會發現草稿少了一段，不會知道為什麼。
 *
 * ⚠️ **只在讀取時換，不回寫舊名。** 寫出去的一律是新名。
 * ⚠️ 這一支**不可以拿掉**，即使確認過「目前沒有既存範本」——
 *   那句話只對「現在這一台電腦」成立。
 */
export function migratePeriodKeys(list: unknown): PeriodKey[] {
  if (!Array.isArray(list)) return [];
  const out: PeriodKey[] = [];
  for (const raw of list) {
    const key = raw === "peak24" ? "allPeak" : raw;
    if (
      (key === "all" || key === "allPeak" || key === "am" || key === "pm") &&
      !out.includes(key)
    )
      out.push(key);
  }
  return out;
}

export const CONCLUSION_PERIOD_LABELS: Record<PeriodKey, string> = {
  /*
   * ⚠️ 2026-09-10 依使用者指定改名，三支一致。
   *   使用者的原話：「在結論草稿產生器、報表草稿產生器或其他可勾選的
   *   篩選條件裡，如果還有全日調查量這類的用詞，都要記得統一名稱」。
   *   這裡是**時段名稱**，不是數量名稱——數量的分母另有規則（見 scopeUnit）。
   */
  all: "全調查時段",
  allPeak: "全調查時段尖峰",
  am: "上午尖峰小時",
  pm: "下午尖峰小時",
};

export const CONCLUSION_METRICS = [
  { key: "count", label: "車輛數（輛）" },
  { key: "pcu", label: "當量交通量（PCU）" },
  { key: "peakHour", label: "尖峰時段（起訖時間）" },
  { key: "composition", label: "車種組成（輛數與百分比）" },
  { key: "compositionPcu", label: "車種組成（當量交通量）" },
  { key: "topVehicle", label: "最大宗車種與其佔比" },
  { key: "directionSplit", label: "各方向／支線分列" },
  { key: "dayCompare", label: "平日與假日對比" },
  { key: "growth", label: "季度之間的變動幅度" },
  { key: "extremes", label: "範圍內的最大／最小路段" },
] as const;

export type ConclusionMetricKey = (typeof CONCLUSION_METRICS)[number]["key"];

export const DEFAULT_CONCLUSION_METRICS: ConclusionMetricKey[] = [
  "count",
  "pcu",
  "peakHour",
  "composition",
];

export type ConclusionScope =
  | { kind: "quarter"; quarter: string }
  | { kind: "year"; year: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "project" };

export type ConclusionGrouping = "byRoad" | "byQuarter" | "overall";

export type ConclusionCondition = {
  scope: ConclusionScope;
  periods: PeriodKey[];
  /** 空＝全部日別。 */
  dayTypes: string[];
  /** 空＝全部路段／調查點。 */
  roadIds: string[];
  /** 空＝全部方向／支線（含「雙向合計」那一列）。 */
  scopeCodes: string[];
  metrics: ConclusionMetricKey[];
  grouping: ConclusionGrouping;
  digits: number;
  /*
   * ── 尖峰時段認定（使用者 2026-09-15 指名補上）────────────────
   *
   * ⚠️ 這一項**本來就一直在影響草稿的每一個尖峰數字**，只是沒有控制項：
   *   conclusionRows 一直把主工具列的 peakScope 傳進 buildPeriodRows，
   *   而這一頁的說明卻寫著「不受主工具列條件影響」——畫面在說謊。
   *   現在把它變成看得到、選得到的條件。
   *
   * "follow"（預設）＝跟著主工具列，也就是**升級當天一個數字都不會變**。
   */
  peakScope?: "follow" | "point" | "direction";
  /*
   * ── 路口流量視角（同上）──────────────────────────────────
   *
   * 草稿的列本來就同時含駛出與駛入兩套（駛入的 scopeCode 帶 `IN:` 前綴），
   * 但只能靠「要寫哪些方向／支線」那一長串去挑，使用者看不出那是視角。
   *
   * "both"（預設）＝兩種都寫，與改版前完全相同。
   */
  flowView?: "both" | "origin" | "destination";
};

export const DEFAULT_CONDITION: ConclusionCondition = {
  scope: { kind: "project" },
  periods: ["all", "am", "pm"],
  dayTypes: [],
  roadIds: [],
  scopeCodes: [],
  metrics: DEFAULT_CONCLUSION_METRICS,
  grouping: "byRoad",
  digits: 1,
  peakScope: "follow",
  flowView: "both",
};

/**
 * 把條件裡的「小數位數」夾回安全範圍。
 *
 * ── 為什麼一定要有這一支（實測，不是推論）──────────────────────
 *
 * 畫面上的下拉只給 0、1、2，所以「使用者操作」這條路本來就安全。
 * 危險的是**另一條路**：套用舊的條件範本、或還原舊備份時，
 * `props.setCondition(template.condition)` 是把範本裡的值**原封不動**丟進來的，
 * 沒有經過任何正規化。範本是 JSON，欄位可能缺、可能是別的型別。
 *
 * 用本系統自己的測試資料實測 buildConclusion()，舊範本會造成三種結果：
 *
 *   digits = null／undefined → 百分比安靜變成 **0 位**
 *                              （使用者設定的 1 位被吃掉，畫面上沒有任何提示）
 *   digits = -1／"abc"       → **丟 RangeError，整個結論草稿掛掉**
 *   digits = 100             → 印出 100 位小數
 *
 * 這個洞是姊妹系統「交通服務水準」在 v2.20.46 被獨立複查抓到的同一類問題。
 * 當時的成因是一句寫錯的註解：以為 `toFixed(undefined)` 會拋錯，
 * 所以覺得漏傳一定會被發現——**實際上它不會拋錯，只會安靜輸出 0 位**。
 * 三支系統是同一個寫法，所以三支都要查；查下來路口轉向本來就有夾範圍
 *（`normalizeCondition()`，0～4），只有本系統沒有。
 *
 * ⚠️ 這裡只夾範圍，**不改變任何數值計算**：0、1、2 三個合法值的輸出
 *    與修正前逐字相同。
 */
export function safeConclusionDigits(value: unknown): number {
  /*
   * 先擋型別再轉數字，順序不能反。
   *
   * 只用「!== null && !== ''」擋不乾淨——Number() 對好幾種不是數字的東西
   * 都會給出落在 0～2 裡面的整數：
   *   Number([])   === 0     ← 空陣列會變成 0 位（實測踩到過）
   *   Number([2])  === 2
   *   Number(true) === 1
   *   Number(" ")  === 0
   * 所以只接受「數字」與「非空白的字串」這兩種型別，其餘一律回預設值。
   */
  const acceptable =
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "");
  if (!acceptable) return DEFAULT_CONDITION.digits;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2
    ? parsed
    : DEFAULT_CONDITION.digits;
}

export type ConclusionTemplate = {
  id: string;
  name: string;
  condition: ConclusionCondition;
  savedAt: string;
};

export type ConclusionVehicle = {
  label: string;
  count: number;
  pcu: number;
};

export type ConclusionCell = {
  /** 時段標籤，例如「07:00～08:00」或「24 小時」。 */
  hour: string;
  hasData: boolean;
  total: number;
  pcu: number;
  /**
   * 這一格的調查涵蓋指紋（`coverageKeyOf()`）。
   *
   * ⚠️ **比可比性一律用這一個，不可以用 `hour`。**
   *   GPT 獨立複查 2026-09-24 抓到：`hour` 是給人看的標籤，
   *   平日 07:00–11:00 與假日 17:00–21:00 的 `hour` 都是
   *   「實測 4 小時（非 24 小時）」——字串相同、檢查通過，
   *   於是草稿照樣算出差異百分比，而那兩段時間根本不是同一段。
   *   畫面與 Excel 用的 `sameSurveyCoverage()` 比的是每一個連續區塊的
   *   起訖，本來就擋住這一種，只有草稿沒擋。
   * ⚠️ 選填是為了讓舊測資與舊呼叫端不必全部改；**缺值時退回比 `hour`**
   *   ——那是改版前的行為，不會比原本更差。
   */
  coverageKey?: string;
  /** 由 cellUnitFor() 算好的單位，這裡只照抄。 */
  unitCount: string;
  unitPcu: string;
  vehicles: ConclusionVehicle[];
};

export type ConclusionRow = {
  quarter: string;
  dayType: string;
  roadId: string;
  roadName: string;
  surveyType: "road" | "intersection";
  scopeCode: string;
  scopeName: string;
  flowLabel?: string;
  periods: Partial<Record<PeriodKey, ConclusionCell>>;
};

export type ConclusionMeta = {
  projectName: string;
  systemVersion: string;
  generatedAt: string;
  /*
   * 季度在草稿上要寫成民國年還是西元年。
   *
   * **純顯示**的換字：篩選（row.quarter === scope.quarter）、排序（quarterKey）
   * 與分組一律走傳進來的儲存值，換寫法不會挑到不同的資料、也不會動到任何數字。
   * 不傳就照原樣輸出，舊呼叫端與單元測試的行為完全不變。
   */
  showQuarter?: (quarter: string) => string;
  /*
   * 尖峰時段認定**實際採用**的那一個，寫成使用者看得懂的字。
   *
   * ⚠️ 條件是 "follow"（跟著主工具列）時，這裡才知道最後到底用了哪一種——
   *   草稿上只寫「跟著主工具列」等於沒說：報告讀者手上沒有那個主工具列。
   *   呼叫端一定要把解析後的結果傳進來。
   */
  peakScopeLabel?: string;
  /**
   * 尖峰時段認定**解析後**的結果（"follow" 已經被換成實際的那一種）。
   *
   * ⚠️ 不可以只看 condition.peakScope：它是 "follow" 時，真正生效的是
   *   主工具列那一個。少了這一欄，「各方向各自認定 → 不可相加」那句警語
   *   在最常見的「跟著主工具列」情形下**永遠不會出現**——
   *   而那正是最需要它的時候。
   */
  peakScopeResolved?: "point" | "direction";
};

/*
 * 季度顯示用的換字（見 ConclusionMeta.showQuarter）。
 *
 * 用模組層變數而不是一路傳參數：組字的輔助函式有七、八個，全部加一個參數
 * 會讓每一個簽章都變髒。buildConclusion 是同步的，進入時設定、用完即可。
 */
let quarterText: (quarter: string) => string = (quarter) =>
  String(quarter ?? "");

function num(value: number | null | undefined, digits: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Number(value).toLocaleString("zh-TW", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function whole(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("zh-TW");
}

/*
 * 百分比一律要把「小數位數」帶進來。
 *
 * 舊版這個參數有預設值 1，而五個呼叫端**全部都沒有傳**，
 * 於是百分比永遠是 1 位，使用者把小數位數改成 2 位完全沒有反應。
 * 更難察覺的是：勾「車輛數（輛）」＋「車種組成（輛數與百分比）」時，
 * 輸出裡根本沒有任何 num() 產生的數字（車輛數走 whole()），
 * 等於整個選項一個字都影響不到——使用者實測回報的就是這個情形。
 * 所以這裡**刻意拿掉預設值**，漏傳就是編譯錯誤，不會再無聲失效。
 */
function pct(value: number | null | undefined, digits: number) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toFixed(digits) + "%";
}

export function quarterKey(quarter: string): number {
  const match = String(quarter || "").match(/^(\d{2,4})Q([1-4])$/);
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1]);
  const gregorian = match[1].length === 4 ? year : year + 1911;
  return gregorian * 4 + Number(match[2]);
}

export function quarterYear(quarter: string): string {
  const match = String(quarter || "").match(/^(\d{2,4})Q[1-4]$/);
  return match ? match[1] : "";
}

export function selectRows(
  rows: ConclusionRow[],
  condition: ConclusionCondition,
): ConclusionRow[] {
  const scope = condition.scope;
  return rows
    .filter(function (row) {
      if (scope.kind === "quarter" && row.quarter !== scope.quarter) return false;
      if (scope.kind === "year" && quarterYear(row.quarter) !== scope.year)
        return false;
      if (scope.kind === "range") {
        const key = quarterKey(row.quarter);
        const low = Math.min(quarterKey(scope.from), quarterKey(scope.to));
        const high = Math.max(quarterKey(scope.from), quarterKey(scope.to));
        // 看不懂的季度字樣一律保留，讓使用者自己看到，不要無聲濾掉。
        if (key !== Number.NEGATIVE_INFINITY && (key < low || key > high))
          return false;
      }
      if (condition.dayTypes.length && !condition.dayTypes.includes(row.dayType))
        return false;
      if (condition.roadIds.length && !condition.roadIds.includes(row.roadId))
        return false;
      if (
        condition.scopeCodes.length &&
        !condition.scopeCodes.includes(row.scopeCode)
      )
        return false;
      /*
       * 路口流量視角。
       *
       * ⚠️ 判準是 scopeCode 的 `IN:` 前綴——那是 conclusionRows 產生駛入那一輪時
       *   加上去的，用來和駛出的 A／B／C 區分（不加的話兩套會撞在一起）。
       *   這裡**不可以**改用別的欄位判斷：前綴是唯一的來源，
       *   兩處各判一套遲早會分岔，而分岔之後草稿會少寫或多寫一半的支線。
       * ⚠️ 舊條件（沒有 flowView 欄位）一律當成 "both"＝兩種都寫，
       *   與改版前完全相同。
       */
      const flowView = condition.flowView || "both";
      if (flowView !== "both") {
        const inbound = row.scopeCode.startsWith("IN:");
        /*
         * ⚠️ 2026-09-23 修正：這個條件原本**會把一般路段整批濾掉**。
         *
         *   `conclusionRows()` 的「駛入」那一輪刻意只產路口的支線
         *   （合計列與一般路段都被 `continue` 跳過，理由見那裡的註解）。
         *   所以一般路段與「全部方向合計」那幾列**永遠沒有 `IN:` 前綴**，
         *   於是 `flowView === "destination"` 時它們全部 return false。
         *
         *   實測（6 列：中山路 ALL/A/B、七叉路口 ALL/A/IN:A）：
         *     both 留 6 列、origin 留 5 列、**destination 只留 1 列**。
         *   而同一份草稿在下面印著
         *     「…上列視角只作用在路口的支線上，**路段各列不受影響**。」
         *   ——資料靜靜消失，草稿本身還給出相反的保證，
         *   連帶「範圍內的最大與最小」被寫成「可比較的合計列不足兩筆」，
         *   把「被條件濾光了」歸因成「資料不夠」。
         *
         *   修法：這個視角**只作用在路口的支線上**（那正是註解一直在講的），
         *   所以只有「本來就有駛出／駛入之分」的那些列才參與篩選。
         *   一般路段與合計列一律保留——與註解、與畫面上的行為一致。
         */
        const hasFlowDirection =
          row.surveyType === "intersection" && row.scopeCode !== "ALL";
        if (hasFlowDirection) {
          if (flowView === "origin" && inbound) return false;
          if (flowView === "destination" && !inbound) return false;
        }
      }
      return true;
    })
    .sort(function (a, b) {
      return (
        quarterKey(a.quarter) - quarterKey(b.quarter) ||
        a.roadId.localeCompare(b.roadId, "en") ||
        (a.flowLabel ?? "").localeCompare(b.flowLabel ?? "", "zh-TW") ||
        (a.scopeCode === "ALL" && b.scopeCode === "ALL"
          ? 0
          : a.scopeCode === "ALL"
            ? -1
            : b.scopeCode === "ALL"
              ? 1
              : 0) ||
        a.scopeCode.localeCompare(b.scopeCode, "en")
      );
    });
}

function scopeLabel(scope: ConclusionScope, rows: ConclusionRow[]) {
  if (scope.kind === "quarter") return quarterText(scope.quarter);
  if (scope.kind === "year") return yearText(scope.year) + " 年度";
  if (scope.kind === "range")
    return quarterText(scope.from) + "～" + quarterText(scope.to);
  const quarters = Array.from(new Set(rows.map((r) => r.quarter))).sort(
    (a, b) => quarterKey(a) - quarterKey(b),
  );
  return quarters.length
    ? "全計畫（" +
        quarterText(quarters[0]) +
        "～" +
        quarterText(quarters.at(-1) as string) +
        "）"
    : "全計畫";
}

/*
 * 年度是「115」這種光年份的字串，沒有 Qn，quarterText 認不得。
 * 借一個季度殼子換算完再把 Qn 去掉；換不成就原樣回傳。
 */
function yearText(year: string) {
  const match = String(quarterText(String(year) + "Q1")).match(/^(\d{2,4})Q1$/);
  return match ? match[1] : String(year);
}

function rowLabel(row: ConclusionRow) {
  const flow = row.flowLabel ? row.flowLabel + "・" : "";
  return row.scopeCode === "ALL"
    ? flow + (row.surveyType === "intersection" ? "全部支線合計" : "雙向合計")
    : flow + row.scopeName;
}

/** 一列、一個時段要寫出來的那一行。 */
function describeCell(
  row: ConclusionRow,
  period: PeriodKey,
  condition: ConclusionCondition,
): string[] {
  const cell = row.periods[period];
  const wants = (key: ConclusionMetricKey) => condition.metrics.includes(key);
  /* 這裡也要夾：describeCell 直接吃 condition，不經過 buildConclusion 的那一次。 */
  const digits = safeConclusionDigits(condition.digits);
  /*
   * ⚠️ 2026-09-25 第六輪獨立複查：這裡原本一律寫「這一列沒有資料」，
   *   而 `hasData: false` 有兩種來源——「真的沒有資料」與
   *   「有資料但時間格距湊不出整整一小時」（那一格的 `hour` 是「資料不足」）。
   *   寫成「沒有資料」會讓使用者回去翻原始檔找一個不存在的漏調查，
   *   那正是這一輪要消除的歧義。`hour` 已經寫明是哪一種，照它講。
   */
  if (!cell || !cell.hasData) {
    if (cell?.hour === "資料不足")
      return [
        `　　${CONCLUSION_PERIOD_LABELS[period]}：這一列的時間格距湊不出整整一小時，` +
          `因此不列尖峰值（原始資料本身有量，請看「資料異常檢查」的調查格距項目）。`,
      ];
    if (cell?.hour === "待設定 PCU 係數")
      return [
        `　　${CONCLUSION_PERIOD_LABELS[period]}：這一列的 PCU 當量係數尚未設定，` +
          `因此不列數值（到「參數設定」設定係數後會自動補上）。`,
      ];
    return [`　　${CONCLUSION_PERIOD_LABELS[period]}：這一列沒有資料。`];
  }

  const parts: string[] = [];
  if (wants("peakHour") && cell.hour) parts.push(cell.hour);
  if (wants("count")) parts.push(`${whole(cell.total)} ${cell.unitCount}`);
  if (wants("pcu")) parts.push(`${num(cell.pcu, digits)} ${cell.unitPcu}`);

  /*
   * ⚠️ 這一行後面什麼都沒有時，不可以只留一個冒號。
   *
   *   使用者只勾了「各方向／支線分列」或「平日與假日對比」這種**修飾項**、
   *   沒有勾任何數值項時，舊版會印出一排「全調查時段：」然後什麼都沒有——
   *   那是一個承諾了數字卻交不出數字的句子，使用者會以為程式壞了或資料沒有。
   *   實際情形是「他沒有勾任何數值項」，那要**講出來**。
   *
   *   ⚠️ 判斷用的是「這一行有沒有東西」，不是「有沒有勾某幾個鍵」——
   *   日後新增數值項時不必回來改這裡。
   */
  const hasRowValue =
    parts.length > 0 ||
    wants("topVehicle") ||
    wants("composition") ||
    wants("compositionPcu");
  const lines = [
    parts.length
      ? `　　${CONCLUSION_PERIOD_LABELS[period]}：${parts.join("、")}`
      : hasRowValue
        ? `　　${CONCLUSION_PERIOD_LABELS[period]}：`
        : `　　${CONCLUSION_PERIOD_LABELS[period]}：（未勾選任何數值項目；` +
          `「各方向／支線分列」與「平日與假日對比」是呈現方式，不是數值，` +
          `請另外勾「車輛數」或「當量交通量」。）`,
  ];

  if (wants("topVehicle")) {
    const top = cell.vehicles
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)[0];
    lines.push(
      top
        ? `　　　最大宗車種為${top.label}，${whole(top.count)} ${cell.unitCount}` +
            `（佔 ${pct(cell.total ? (top.count / cell.total) * 100 : null, digits)}）。`
        : "　　　沒有可判斷最大宗車種的車輛數。",
    );
  }
  if (wants("composition")) {
    const items = cell.vehicles.filter((item) => item.count > 0);
    lines.push(
      items.length
        ? "　　　車種組成：" +
            items
              .sort((a, b) => b.count - a.count)
              .map(
                (item) =>
                  `${item.label} ${whole(item.count)} ${cell.unitCount}` +
                  `（${pct(cell.total ? (item.count / cell.total) * 100 : null, digits)}）`,
              )
              .join("、") +
            "。"
        : "　　　車種組成：這一格沒有車輛數。",
    );
  }
  if (wants("compositionPcu")) {
    const items = cell.vehicles.filter((item) => item.pcu > 0);
    lines.push(
      items.length
        ? "　　　各車種當量：" +
            items
              .sort((a, b) => b.pcu - a.pcu)
              .map(
                (item) =>
                  `${item.label} ${num(item.pcu, digits)} ${cell.unitPcu}` +
                  `（${pct(cell.pcu ? (item.pcu / cell.pcu) * 100 : null, digits)}）`,
              )
              .join("、") +
            "。"
        : "　　　各車種當量：這一格沒有當量交通量。",
    );
  }
  return lines;
}

/** 同一路段、同一方向、同一日別、同一時段，跨季度才可以比。 */
function describeGrowth(
  rows: ConclusionRow[],
  periods: PeriodKey[],
  /* 變動幅度的百分比也要跟著使用者選的小數位數走。 */
  digits: number,
  /*
   * 要用車輛數還是 PCU 來比。
   *
   * ⚠️ 2026-09-23 修正：這一段（以及最大／最小、平假日對比）原本**永遠**
   *   讀 `cell.total`＝車輛數，`condition.metrics` 只決定「要不要印這一段」，
   *   不決定印什麼。於是使用者勾了「當量交通量（PCU）」、沒勾「車輛數」，
   *   拿到的仍然是一整段輛數——勾了等於沒勾。
   *
   * ⚠️ 判準刻意是「**只勾了 PCU、沒勾車輛數**才換」：
   *   兩個都勾（預設）或只勾車輛數時，輸出與改版前**逐字相同**。
   *   使用者 2026-09-23：「不要因為補功能而讓現有功能異常」——
   *   所以這裡不是「多印一段 PCU」，是「使用者明確只要 PCU 時才改用 PCU」。
   */
  usePcu: boolean,
) {
  const lines: string[] = [];
  const groups = new Map<string, ConclusionRow[]>();
  for (const row of rows) {
    const key = [row.roadId, row.scopeCode, row.flowLabel ?? "", row.dayType].join("|");
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  for (const [, group] of groups) {
    const ordered = group
      .slice()
      .sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
    if (ordered.length < 2) continue;
    for (const period of periods) {
      const points = ordered
        .map((row) => ({
          quarter: row.quarter,
          cell: row.periods[period],
        }))
        .filter((point) => point.cell?.hasData) as {
        quarter: string;
        cell: ConclusionCell;
      }[];
      if (points.length < 2) continue;
      const first = points[0];
      const last = points.at(-1)!;
      const valueOf = (cell: ConclusionCell) => (usePcu ? cell.pcu : cell.total);
      const unitOf = (cell: ConclusionCell) =>
        usePcu ? cell.unitPcu : cell.unitCount;
      const units = new Set(points.map((point) => unitOf(point.cell)));
      if (units.size > 1) {
        lines.push(
          `　${rowLabel(ordered[0])}・${CONCLUSION_PERIOD_LABELS[period]}：` +
            `各季的單位不一致（${[...units].join("、")}），無法直接比較變動幅度。` +
            "（通常代表其中某幾季是部分時段調查。）",
        );
        continue;
      }
      /*
       * ══════════════════════════════════════════════════════════════
       *  ⚠️ 單位相同**不代表可以比**——涵蓋時數也要一樣
       * ══════════════════════════════════════════════════════════════
       *
       * 2026-09-23 的反向對帳抓到：上面那一條只比 `unitCount`，而
       * 4 小時與 12 小時的部分時段調查**單位字串完全相同**（都是
       * 「輛/調查時段」），於是檢查通過，草稿印出「增加 200.0%」——
       * 那 200% 純粹是調查時數的差，而這句話會被抄進報告。
       *
       * 畫面與 Excel 都**擋住了**這一種：Excel「平假日比較」在涵蓋不同時
       * 把差值與百分比寫成空白格，畫面顯示「涵蓋不同」並附說明。
       * 只有兩支草稿沒擋。
       *
       * 判準用「全調查時段」那一格的時段標籤（`cell.hour`）——
       * 它就是涵蓋敘述（「24 小時」「實測 4 小時（非 24 小時）」）。
       * ⚠️ 只對 `all` 這個時段做：尖峰那三個本來就是某一個小時，
       *   時段標籤不同是正常的（尖峰出現在不同時刻），不是不可比。
       */
      if (period === "all") {
        /*
         * ⚠️ 2026-09-24（GPT 獨立複查抓到）：判準改成**涵蓋指紋**，
         *   不是給人看的 `hour` 標籤。07:00–11:00 與 17:00–21:00 的標籤
         *   都是「實測 4 小時（非 24 小時）」，比標籤等於沒擋。
         * ⚠️ 訊息裡仍然印 `hour`（那是人看得懂的敘述）；
         *   **判斷用指紋、顯示用標籤**，兩者不可以互換。
         */
        const keys = new Set(
          /*
           * ⚠️ 2026-09-25：不可以 `|| point.cell.hour`。
           *   指紋算不出來（空字串）時退回比顯示標籤，等於把
           *   「判斷不出來」當成「涵蓋相同」——正是上面那段註解禁止的事。
           *   改成把算不出來的一律當成各自獨立的一種涵蓋（用一個不可能
           *   與真指紋相同的記號），這樣 keys.size 會 > 1、走進「涵蓋不同
           *   所以不做比較」那一支，而訊息仍然印人看得懂的 hour。
           */
          points.map((point, index) =>
            point.cell.coverageKey === undefined
              ? point.cell.hour /* 沒有指紋：維持改版前的行為 */
              : point.cell.coverageKey || `#無法判斷-${index}`,
          ),
        );
        if (keys.size > 1) {
          const shown = [...new Set(points.map((point) => point.cell.hour))];
          lines.push(
            `　${rowLabel(ordered[0])}・${CONCLUSION_PERIOD_LABELS[period]}：` +
              `各季的調查涵蓋不同（${shown.join("、")}），不計算變動幅度` +
              "——那個百分比會是調查時數的差，不是交通量的變化。" +
              "（與 Excel 的歷季各表、畫面上的「涵蓋不同」是同一套判準。）",
          );
          continue;
        }
      }
      /*
       * ⚠️ 2026-09-25 修正：真值判斷擋不住 NaN。
       *   NaN 是 falsy，所以舊寫法會走進「起始季為 0」那一支，
       *   而同一句前面的 show() 會印「—」→
       *   「由 115Q1 的 — 輛/日 變為 …，起始季為 0」
       *   「是 0」與「讀不到」被講成同一件事，而這句會被抄進報告。
       *   app/report-draft.ts 的 changeText() 早就用 Number.isFinite 分開了，
       *   這一支沒跟上。
       */
      const firstValue = valueOf(first.cell);
      const lastValue = valueOf(last.cell);
      const readable =
        Number.isFinite(firstValue) && Number.isFinite(lastValue);
      const change = !readable
        ? undefined /* 讀不到：與「基期是 0」不同，下面分開寫 */
        : firstValue === 0
          ? null
          : (lastValue / firstValue - 1) * 100;
      const show = (cell: ConclusionCell) =>
        usePcu ? num(cell.pcu, digits) : whole(cell.total);
      lines.push(
        `　${rowLabel(ordered[0])}・${CONCLUSION_PERIOD_LABELS[period]}：` +
          `由 ${quarterText(first.quarter)} 的 ${show(first.cell)} ${unitOf(first.cell)} ` +
          `變為 ${quarterText(last.quarter)} 的 ${show(last.cell)} ${unitOf(last.cell)}，` +
          (change === undefined
            ? "其中一期讀不到數值，變動幅度無法計算"
            : change === null
              ? "起始季為 0，變動幅度無法以百分比表示"
              : `${change >= 0 ? "增加" : "減少"} ${pct(Math.abs(change), digits)}`) +
          "。",
      );
    }
  }
  return lines;
}

function describeExtremes(
  rows: ConclusionRow[],
  periods: PeriodKey[],
  digits: number,
  /** 見 describeGrowth 的同名參數：只有「勾了 PCU 且沒勾車輛數」時才是 true。 */
  usePcu: boolean,
) {
  const lines: string[] = [];
  for (const period of periods) {
    /* 只比「雙向合計／全部支線合計」那一列，否則等於拿方向去比整條路段。 */
    const points = rows
      .filter((row) => row.scopeCode === "ALL" && row.periods[period]?.hasData)
      .map((row) => ({
        label: `${row.roadName}（${quarterText(row.quarter)}・${row.dayType}）`,
        cell: row.periods[period]!,
      }));
    if (points.length < 2) continue;
    const valueOf = (cell: ConclusionCell) => (usePcu ? cell.pcu : cell.total);
    const unitOf = (cell: ConclusionCell) =>
      usePcu ? cell.unitPcu : cell.unitCount;
    const show = (cell: ConclusionCell) =>
      usePcu ? num(cell.pcu, digits) : whole(cell.total);
    const units = new Set(points.map((point) => unitOf(point.cell)));
    if (units.size > 1) {
      lines.push(
        `　${CONCLUSION_PERIOD_LABELS[period]}：範圍內同時有 ${[...units].join("、")} ` +
          "兩種以上單位（部分時段與完整全日混在一起），不做大小比較以免誤導。",
      );
      continue;
    }
    const sorted = points
      .slice()
      .sort((a, b) => valueOf(b.cell) - valueOf(a.cell));
    const mean =
      points.reduce((sum, point) => sum + valueOf(point.cell), 0) /
      points.length;
    lines.push(
      `　${CONCLUSION_PERIOD_LABELS[period]}：最高為 ${sorted[0].label} ` +
        `${show(sorted[0].cell)} ${unitOf(sorted[0].cell)}，` +
        `最低為 ${sorted.at(-1)!.label} ${show(sorted.at(-1)!.cell)} ` +
        `${unitOf(sorted.at(-1)!.cell)}，${points.length} 筆平均 ` +
        `${num(mean, digits)} ${unitOf(sorted[0].cell)}。` +
        (period === "all"
          ? ""
          : "（各調查點的尖峰小時不一定相同，此處僅比較大小，不做加總。）"),
    );
  }
  return lines;
}

/** 同一路段、同一方向、同一季，平日對假日。 */
function describeDayCompare(
  rows: ConclusionRow[],
  periods: PeriodKey[],
  /* 平假日差異的百分比也要跟著使用者選的小數位數走。 */
  digits: number,
  /** 見 describeGrowth 的同名參數：只有「勾了 PCU 且沒勾車輛數」時才是 true。 */
  usePcu: boolean,
) {
  const lines: string[] = [];
  const groups = new Map<string, ConclusionRow[]>();
  for (const row of rows) {
    const key = [row.quarter, row.roadId, row.scopeCode, row.flowLabel ?? ""].join("|");
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  for (const [, group] of groups) {
    const byDay = new Map(group.map((row) => [row.dayType, row]));
    if (byDay.size < 2) continue;
    const weekday = byDay.get("平日");
    const holiday = byDay.get("假日");
    if (!weekday || !holiday) continue;
    for (const period of periods) {
      const a = weekday.periods[period];
      const b = holiday.periods[period];
      if (!a?.hasData || !b?.hasData) continue;
      const unitOf = (cell: ConclusionCell) =>
        usePcu ? cell.unitPcu : cell.unitCount;
      const valueOf = (cell: ConclusionCell) => (usePcu ? cell.pcu : cell.total);
      const show = (cell: ConclusionCell) =>
        usePcu ? num(cell.pcu, digits) : whole(cell.total);
      if (unitOf(a) !== unitOf(b)) {
        lines.push(
          `　${weekday.roadName}・${rowLabel(weekday)}・${CONCLUSION_PERIOD_LABELS[period]}：` +
            `平日與假日的單位不一致（${unitOf(a)} 對 ${unitOf(b)}），不做比較。`,
        );
        continue;
      }
      /*
       * ⚠️ 單位相同**不代表可以比**——涵蓋時數也要一樣。
       *   理由與 describeGrowth 裡那一段完全相同：平日做 12 小時、
       *   假日做 4 小時時，兩邊都是「輛/調查時段」，舊版照樣算出
       *   「假日較平日少 75.0%」，而那 75% 是調查時數的差。
       *   Excel 的「平假日比較」在這種情形是把差值與百分比留白的
       *   （`coverageComparable` 為 false），畫面顯示「涵蓋不同」。
       */
      /*
       * ⚠️ 2026-09-24（GPT 獨立複查抓到）：改比**涵蓋指紋**。
       *   平日 07:00–11:00、假日 17:00–21:00 的 `hour` 都是
       *   「實測 4 小時（非 24 小時）」，比 `hour` 的話這一條完全擋不到，
       *   草稿會算出一個「假日較平日少 X%」，而那兩段時間不是同一段。
       */
      /*
       * ⚠️ 2026-09-25 修正：`|| cell.hour` 把守衛繞掉了。
       *
       * coverageKeyOf() 對無法解析的時段標籤回**空字串**（實測：
       * `coverageKeyOf(["07:00"])` 與 `coverageKeyOf(["全日"])` 都是 ""），
       * 而 period-analysis.ts 自己宣告「空字串要當成無法判斷可比性，
       * **不可以當成涵蓋相同**」。
       * 舊寫法的 `|| cell.hour` 剛好在那個時候退回去比 `hour`——
       * 也就是退回**比給人看的字串**，正是上面那段註解禁止的事。
       * 而 fullDayLabel 在 coveredMinutes=0 時對兩筆都產生同一句
       * 「實測 0 小時（非 24 小時）」→ 判定為可比 → 印出「假日較平日少 X%」。
       *
       * 可達性已確認：validateBackupRecords 對 hour 只要求「非空白字串」，
       * 所以只寫起點的標籤（"07:00"）從還原路徑進得來。
       *
       * 正解：指紋算不出來就是**無法判斷可比性**，回 null 讓呼叫端寫出理由。
       */
      /*
       * ⚠️ 三種狀態要分開，不可以一刀切：
       *
       *   ① coverageKey 是**非空字串** → 指紋算出來了，拿它比（最可靠）
       *   ② coverageKey 是**空字串**   → coverageKeyOf() 解析不出時段標籤，
       *      也就是**無從判斷**可比性 → 一律不比（回 null）
       *   ③ coverageKey 是 undefined  → 這一格**沒有人算過指紋**
       *      （v20.83 以前的資料、或不經 cellFromBuckets 的路徑）
       *      → 退回比 `hour`，維持改版前的行為
       *
       * 第一版我把 ② 和 ③ 合成一個（一律回 null），結果把「本來比得動的
       * 舊資料」也擋掉了——那是過度修正。
       */
      const coverageOf = (cell: ConclusionCell) =>
        cell.coverageKey === undefined
          ? cell.hour /* ③ 沒有指紋：維持舊行為 */
          : cell.coverageKey || null; /* ② 空字串：無從判斷 */
      /*
       * 指紋算不出來（任一邊是 null）＝無法判斷可比性，一律寫出理由，
       * 不可以當成「涵蓋相同」而繼續算百分比。
       */
      const keyA = coverageOf(a);
      const keyB = coverageOf(b);
      if (period === "all" && (!keyA || !keyB || keyA !== keyB)) {
        /*
         * ⚠️ 兩種原因要分開講：
         *   ・指紋算得出來但不一樣 → 涵蓋確實不同
         *   ・任一邊算不出指紋     → **無從判斷**是否可比（不可以說「不同」）
         */
        const reason =
          !keyA || !keyB
            ? "平日與假日的調查涵蓋無法判斷（時段標籤看不出起訖時間）"
            : "平日與假日的調查涵蓋不同";
        lines.push(
          `　${weekday.roadName}（${quarterText(weekday.quarter)}）・${rowLabel(weekday)}・` +
            `${CONCLUSION_PERIOD_LABELS[period]}：${reason}` +
            `（${a.hour} 對 ${b.hour}），不計算差異百分比` +
            "——那個百分比會是調查時數的差，不是交通量的差。" +
            `平日 ${show(a)} ${unitOf(a)}、假日 ${show(b)} ${unitOf(b)}，兩者不可直接相比。`,
        );
        continue;
      }
      /*
       * ⚠️ 2026-09-25 修正：與上面的成長描述同一個雷（NaN 是 falsy）。
       *   舊寫法會印出「平日 — 輛/日……平日為 0」——同一句話裡
       *   「讀不到」和「是 0」被講成同一件事。
       */
      const weekdayValue = valueOf(a);
      const holidayValue = valueOf(b);
      const bothReadable =
        Number.isFinite(weekdayValue) && Number.isFinite(holidayValue);
      const change = !bothReadable
        ? undefined
        : weekdayValue === 0
          ? null
          : (holidayValue / weekdayValue - 1) * 100;
      lines.push(
        `　${weekday.roadName}（${quarterText(weekday.quarter)}）・${rowLabel(weekday)}・` +
          `${CONCLUSION_PERIOD_LABELS[period]}：平日 ${show(a)} ${unitOf(a)}、` +
          `假日 ${show(b)} ${unitOf(b)}，` +
          (change === undefined
            ? "平日或假日有一邊讀不到數值，無法比較差異"
            : change === null
              ? "平日為 0，無法以百分比表示差異"
              : `假日較平日${change >= 0 ? "多" : "少"} ${pct(Math.abs(change), digits)}`) +
          "。",
      );
    }
  }
  return lines;
}

export function buildConclusion(
  rows: ConclusionRow[],
  condition: ConclusionCondition,
  meta: ConclusionMeta,
): string {
  quarterText =
    typeof meta.showQuarter === "function"
      ? meta.showQuarter
      : (quarter: string) => String(quarter ?? "");
  const chosen = selectRows(rows, condition);
  /*
   * ══════════════════════════════════════════════════════════════════════
   *  ⚠️ 「平日與假日對比」刻意**不吃日別條件**——它本來就要兩邊都拿到
   * ══════════════════════════════════════════════════════════════════════
   *
   * 2026-09-23 的反向對帳抓到：日別選「平日」之後，`selectRows` 先把假日
   * 濾掉，`describeDayCompare` 就再也找不到成對的平日／假日：
   *   ・byRoad／byQuarter 分組 → **一個字都沒有**
   *   ・overall 分組 → 印出「範圍內沒有同一路段同時具備平日與假日的資料」
   *     ——**這句話是錯的**，資料是存在的，是被條件濾掉的。
   *
   * 而畫面與 Excel 的平假日比較**刻意不套日別**（那兩處的註解自己寫著
   * 「日別仍然刻意不套——它本來就要同時拿平日與假日來比」），
   * 報表文字草稿也印著「平假日比較一律同時統計兩種日別，不受上述『日別』
   * 範圍限制」。三處一致，只有結論草稿這一支反過來。
   *
   * ⚠️ 只有「平日與假日對比」那一段用這一份，其餘每一段仍然用 `chosen`——
   *   日別條件對它們本來就該生效，動到那邊才是真的改壞既有功能。
   */
  const dayCompareRows = condition.dayTypes.length
    ? selectRows(rows, { ...condition, dayTypes: [] })
    : chosen;
  const periods = condition.periods.length
    ? condition.periods
    : (["all"] as PeriodKey[]);
  /*
   * 位數在這裡夾一次，而不是只在畫面上夾。
   * 舊範本與舊備份走的是 setCondition(template.condition) 這條路，
   * 完全不經過畫面的下拉——只夾畫面等於沒夾。詳見 safeConclusionDigits()。
   */
  const digits = safeConclusionDigits(condition.digits);
  const wants = (key: ConclusionMetricKey) => condition.metrics.includes(key);
  /*
   * 「季度之間的變動幅度」「範圍內的最大與最小」「平假日對比」這三段
   * 要用車輛數還是 PCU。
   *
   * ⚠️ 只有**勾了 PCU、而且沒勾車輛數**時才換成 PCU。
   *   兩個都勾（預設）或只勾車輛數時，輸出與改版前逐字相同——
   *   這是刻意的：使用者 2026-09-23 明講「不要因為補功能而讓現有功能異常」。
   *   在那之前，這三段**永遠**印車輛數，`metrics` 只決定要不要印這一段，
   *   於是「只勾 PCU」的使用者拿到一整段輛數，勾了等於沒勾。
   */
  const usePcuForSummary = wants("pcu") && !wants("count");
  const out: string[] = [];

  out.push(`【結論草稿】${scopeLabel(condition.scope, chosen)}`);
  out.push(
    `計畫：${meta.projectName}｜產生時間：${meta.generatedAt}｜系統版本：${meta.systemVersion}`,
  );

  if (!chosen.length) {
    out.push("");
    out.push(
      "所選條件沒有對應的資料。請放寬季度範圍、改選其他路段或日別後再產生一次。",
    );
    return out.join("\n");
  }

  const quarters = Array.from(new Set(chosen.map((r) => r.quarter))).sort(
    (a, b) => quarterKey(a) - quarterKey(b),
  );
  const roads = Array.from(new Set(chosen.map((r) => r.roadId)));
  const dayTypes = Array.from(new Set(chosen.map((r) => r.dayType)));
  out.push("");
  out.push(
    `統計範圍：${quarters.length} 個季度（${quarters.map(quarterText).join("、")}）、` +
      `${roads.length} 個調查點、共 ${chosen.length} 列；` +
      `日別：${dayTypes.join("、")}；` +
      `時段：${periods.map((p) => CONCLUSION_PERIOD_LABELS[p]).join("、")}。`,
  );
  out.push(
    "說明：「全調查時段」是這份調查涵蓋時段的加總——完整 24 小時的調查標為" +
      "輛/日、PCU/日，不足 24 小時的標為輛/調查時段、PCU/調查時段，兩者不可直接比較。" +
      "尖峰欄位是某一小時的量（輛/hr、PCU/hr），與累計量不可混談；" +
      "尖峰數值是率，不跨調查點、跨季度相加。",
  );
  /*
   * ── 這份草稿是在哪一組條件底下算出來的 ──────────────────────
   *
   * ⚠️ 尖峰時段認定與路口流量視角**一定要寫進草稿本身**。
   *   這段文字會被複製進正式報告，而報告上看不到畫面——
   *   「各方向各自認定」算出來的尖峰量是各方向自己的時段，**不可以相加**，
   *   不寫的話，讀報告的人會把它們加起來。
   */
  const peakScopeText =
    meta.peakScopeLabel ||
    (condition.peakScope === "point"
      ? "整個調查點同一時段（可相加）"
      : condition.peakScope === "direction"
        ? "各方向各自認定自己的尖峰"
        : "跟著主工具列");
  const flowViewText =
    condition.flowView === "origin"
      ? "只寫駛出路口"
      : condition.flowView === "destination"
        ? "只寫駛入路口"
        : "駛出＋駛入都寫";
  out.push(`統計條件：尖峰時段認定＝${peakScopeText}；路口流量視角＝${flowViewText}；數值小數 ${digits} 位。`);
  const peakScopeResolved =
    meta.peakScopeResolved ||
    (condition.peakScope === "point" || condition.peakScope === "direction"
      ? condition.peakScope
      : undefined);
  if (peakScopeResolved === "direction")
    out.push(
      "⚠️ 本數值不適用「相加」：各方向的尖峰小時各自認定，" +
        "不同方向的尖峰量並非同一時刻的量，合計沒有意義，請勿把各方向相加。",
    );
  /*
   * 「不適用」逐項寫出來（使用者 2026-09-15 指定的寫法）。
   * ⚠️ 只在使用者**確實設了**那個條件時才寫——沒設的條件寫一堆只是噪音。
   */
  if (condition.flowView && condition.flowView !== "both")
    out.push(
      "本數值不適用「路口流量視角」條件的部分：一般路段只有方向A／方向B，" +
        "沒有駛出／駛入之分，因此上列視角只作用在路口的支線上，路段各列不受影響。",
    );
  if (condition.roadIds.length)
    out.push(
      "本數值不適用「調查點」條件的部分：各段開頭的統計範圍是依上列條件算出來的，" +
        "沒有被選到的調查點完全不列入——包含最大／最小與平均在內。",
    );

  let section = 0;
  const heading = (text: string) => {
    section += 1;
    out.push("");
    out.push(`${section}. ${text}`);
  };

  /* 沒有勾「各方向／支線分列」時，只寫合計那一列。 */
  const visible = wants("directionSplit")
    ? chosen
    : chosen.filter((row) => row.scopeCode === "ALL");
  const body = visible.length ? visible : chosen;
  /*
   * ⚠️ 「平日與假日對比」在**分組模式**下用的那一份列。
   *
   *   分組（依路段／依季度）那兩處原本直接把 `group` 丟給
   *   `describeDayCompare`，而 `group` 是從 `body` 切出來的——`body` 已經
   *   吃過日別條件了。所以日別選「平日」時，那兩處連一個字都印不出來
   *   （`byDay.size < 2` 直接 continue），使用者看到的是**整段憑空消失**，
   *   連「為什麼沒有」都沒寫。
   *
   *   這一份走與 `body` **完全相同**的「各方向／支線分列」規則，
   *   差別只在它是從不吃日別條件的 `dayCompareRows` 切出來的。
   *   沒設日別條件時 `dayCompareRows === chosen`，這裡直接回傳 `body`
   *   本身——輸出與改版前逐字相同，不會動到既有行為。
   */
  const dayCompareBody = (() => {
    if (dayCompareRows === chosen) return body;
    const shown = wants("directionSplit")
      ? dayCompareRows
      : dayCompareRows.filter((row) => row.scopeCode === "ALL");
    return shown.length ? shown : dayCompareRows;
  })();
  /*
   * 分組模式下，`describeDayCompare` 沒有東西可寫時要**寫出理由**，
   * 不可以整段消失——使用者 2026-09-23：「不要讓使用者出了題卻抓不出答案」。
   * 有設日別條件時額外講明「這一段刻意不受日別限制」，否則使用者會以為
   * 是自己的條件把它濾掉了。
   */
  const dayCompareNote = condition.dayTypes.length
    ? "　（本段刻意不受上方「日別」條件限制——平假日對比本來就要同時拿到兩種日別。）"
    : "";
  const dayCompareLines = (group: ConclusionRow[], scopeText: string) => {
    const lines = describeDayCompare(group, periods, digits, usePcuForSummary);
    if (lines.length)
      return dayCompareNote ? [...lines, dayCompareNote] : lines;
    return [
      `　${scopeText}沒有同一季、同一路段、同一方向同時具備平日與假日的資料，未做對比。`,
      ...(dayCompareNote ? [dayCompareNote] : []),
    ];
  };

  if (condition.grouping === "byRoad") {
    const groups = new Map<string, ConclusionRow[]>();
    for (const row of body) {
      const bucket = groups.get(row.roadId);
      if (bucket) bucket.push(row);
      else groups.set(row.roadId, [row]);
    }
    for (const [, group] of groups) {
      heading(`${group[0].roadName}（${group[0].roadId}）`);
      for (const row of group) {
        out.push(`　〔${quarterText(row.quarter)}・${row.dayType}・${rowLabel(row)}〕`);
        for (const period of periods) out.push(...describeCell(row, period, condition));
      }
      if (wants("growth")) {
        /*
         * ⚠️ 沒得比的時候要**寫出理由**，不可以整段消失。
         *   「依路段分段」原本沒有這個 fallback，而 overall 分組有——
         *   同一個功能在兩種分組下一個講、一個不講，使用者會以為
         *   是自己少勾了什麼。
         */
        const lines = describeGrowth(group, periods, digits, usePcuForSummary);
        out.push(
          ...(lines.length
            ? lines
            : ["　本路段在範圍內沒有任何一列具備兩季以上的資料，未做季度比較。"]),
        );
      }
      if (wants("dayCompare"))
        out.push(
          ...dayCompareLines(
            /* ⚠️ 不吃日別條件，理由見 dayCompareBody 的說明。 */
            dayCompareBody.filter((row) => row.roadId === group[0].roadId),
            "本路段在範圍內",
          ),
        );
    }
  } else if (condition.grouping === "byQuarter") {
    for (const quarter of quarters) {
      const group = body.filter((row) => row.quarter === quarter);
      if (!group.length) continue;
      heading(`${quarterText(quarter)}（共 ${group.length} 列）`);
      for (const row of group) {
        out.push(`　〔${row.roadName}・${row.dayType}・${rowLabel(row)}〕`);
        for (const period of periods) out.push(...describeCell(row, period, condition));
      }
      if (wants("extremes")) {
        /*
         * ⚠️ 2026-09-25 修正：沒得比的時候要寫出理由，不可以整段消失。
         *   非 byQuarter 的那一條早就有 fallback
         *  （「可比較的『合計』列不足兩筆，未做大小比較。」），
         *   byQuarter 這一條沒有——於是勾了「範圍內的最大／最小路段」
         *   而可比列不足兩筆時，草稿裡**一個字都沒有**，
         *   使用者會以為是自己少勾了什麼。
         *   這與本檔自己寫的「同一個功能在兩種分組下一個講、一個不講，
         *   使用者會以為是自己少勾了什麼」一致。
         */
        const extremeLines = describeExtremes(
          group,
          periods,
          digits,
          usePcuForSummary,
        );
        out.push(
          ...(extremeLines.length
            ? extremeLines
            : ["　可比較的「合計」列不足兩筆，未做大小比較。"]),
        );
      }
      if (wants("dayCompare"))
        out.push(
          ...dayCompareLines(
            /* ⚠️ 不吃日別條件，理由見 dayCompareBody 的說明。 */
            dayCompareBody.filter((row) => row.quarter === quarter),
            "本季在範圍內",
          ),
        );
    }
  } else {
    heading("整體結果");
    const first = body[0];
    out.push(
      `　代表列：${first.roadName}（${first.roadId}）・${quarterText(first.quarter)}・` +
        `${first.dayType}・${rowLabel(first)}`,
    );
    for (const period of periods) out.push(...describeCell(first, period, condition));
    if (body.length > 1)
      out.push(
        `　（範圍內共 ${body.length} 列；車種組成這類不能跨調查點相加的數字，` +
          "僅以上列這一列為代表。要逐列寫出請改選「依路段分段」或「依季度分段」。)",
      );
  }

  if (wants("extremes") && condition.grouping !== "byQuarter") {
    heading("範圍內的最大與最小");
    const lines = describeExtremes(chosen, periods, digits, usePcuForSummary);
    out.push(
      ...(lines.length
        ? lines
        : ["　可比較的「合計」列不足兩筆，未做大小比較。"]),
    );
  }
  if (wants("growth") && condition.grouping !== "byRoad") {
    heading("季度之間的變動");
    const lines = describeGrowth(body, periods, digits, usePcuForSummary);
    out.push(
      ...(lines.length
        ? lines
        : ["　範圍內沒有任何一列具備兩季以上的資料，未做季度比較。"]),
    );
  }
  if (wants("dayCompare") && condition.grouping === "overall") {
    heading("平日與假日對比");
    out.push(
      ...dayCompareLines(
        /* ⚠️ 不吃日別條件，理由見 dayCompareRows 的說明。 */
        dayCompareRows,
        "範圍內",
      ),
    );
  }

  const partial = chosen.filter((row) =>
    Object.values(row.periods).some((cell) => /調查時段/.test(cell?.unitCount || "")),
  ).length;
  if (partial) {
    out.push("");
    out.push(
      `註：${partial} 列屬於部分時段調查（非完整 24 小時），其「全日」欄位是實測時段的合計，` +
        "單位標為「輛/調查時段」，不可與完整全日的「輛/日」直接比較。",
    );
  }

  return out.join("\n");
}
