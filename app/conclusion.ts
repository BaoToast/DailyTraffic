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

export type PeriodKey = "all" | "peak24" | "am" | "pm";

export const CONCLUSION_PERIOD_LABELS: Record<PeriodKey, string> = {
  /*
   * ⚠️ 2026-09-10 依使用者指定改名，三支一致。
   *   使用者的原話：「在結論草稿產生器、報表草稿產生器或其他可勾選的
   *   篩選條件裡，如果還有全日調查量這類的用詞，都要記得統一名稱」。
   *   這裡是**時段名稱**，不是數量名稱——數量的分母另有規則（見 scopeUnit）。
   */
  all: "全調查時段",
  peak24: "全調查時段尖峰",
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
        if (flowView === "origin" && inbound) return false;
        if (flowView === "destination" && !inbound) return false;
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
  if (!cell || !cell.hasData)
    return [`　　${CONCLUSION_PERIOD_LABELS[period]}：這一列沒有資料。`];

  const parts: string[] = [];
  if (wants("peakHour") && cell.hour) parts.push(cell.hour);
  if (wants("count")) parts.push(`${whole(cell.total)} ${cell.unitCount}`);
  if (wants("pcu")) parts.push(`${num(cell.pcu, digits)} ${cell.unitPcu}`);

  const lines = [
    `　　${CONCLUSION_PERIOD_LABELS[period]}${parts.length ? "：" + parts.join("、") : "："}`,
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
      const units = new Set(points.map((point) => point.cell.unitCount));
      if (units.size > 1) {
        lines.push(
          `　${rowLabel(ordered[0])}・${CONCLUSION_PERIOD_LABELS[period]}：` +
            `各季的單位不一致（${[...units].join("、")}），無法直接比較變動幅度。` +
            "（通常代表其中某幾季是部分時段調查。）",
        );
        continue;
      }
      const change = first.cell.total
        ? (last.cell.total / first.cell.total - 1) * 100
        : null;
      lines.push(
        `　${rowLabel(ordered[0])}・${CONCLUSION_PERIOD_LABELS[period]}：` +
          `由 ${quarterText(first.quarter)} 的 ${whole(first.cell.total)} ${first.cell.unitCount} ` +
          `變為 ${quarterText(last.quarter)} 的 ${whole(last.cell.total)} ${last.cell.unitCount}，` +
          (change === null
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
    const units = new Set(points.map((point) => point.cell.unitCount));
    if (units.size > 1) {
      lines.push(
        `　${CONCLUSION_PERIOD_LABELS[period]}：範圍內同時有 ${[...units].join("、")} ` +
          "兩種以上單位（部分時段與完整全日混在一起），不做大小比較以免誤導。",
      );
      continue;
    }
    const sorted = points.slice().sort((a, b) => b.cell.total - a.cell.total);
    const mean =
      points.reduce((sum, point) => sum + point.cell.total, 0) / points.length;
    lines.push(
      `　${CONCLUSION_PERIOD_LABELS[period]}：最高為 ${sorted[0].label} ` +
        `${whole(sorted[0].cell.total)} ${sorted[0].cell.unitCount}，` +
        `最低為 ${sorted.at(-1)!.label} ${whole(sorted.at(-1)!.cell.total)} ` +
        `${sorted.at(-1)!.cell.unitCount}，${points.length} 筆平均 ` +
        `${num(mean, digits)} ${sorted[0].cell.unitCount}。` +
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
      if (a.unitCount !== b.unitCount) {
        lines.push(
          `　${weekday.roadName}・${rowLabel(weekday)}・${CONCLUSION_PERIOD_LABELS[period]}：` +
            `平日與假日的單位不一致（${a.unitCount} 對 ${b.unitCount}），不做比較。`,
        );
        continue;
      }
      const change = a.total ? (b.total / a.total - 1) * 100 : null;
      lines.push(
        `　${weekday.roadName}（${quarterText(weekday.quarter)}）・${rowLabel(weekday)}・` +
          `${CONCLUSION_PERIOD_LABELS[period]}：平日 ${whole(a.total)} ${a.unitCount}、` +
          `假日 ${whole(b.total)} ${b.unitCount}，` +
          (change === null
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
      if (wants("growth")) out.push(...describeGrowth(group, periods, digits));
      if (wants("dayCompare")) out.push(...describeDayCompare(group, periods, digits));
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
      if (wants("extremes")) out.push(...describeExtremes(group, periods, digits));
      if (wants("dayCompare")) out.push(...describeDayCompare(group, periods, digits));
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
    const lines = describeExtremes(chosen, periods, digits);
    out.push(
      ...(lines.length
        ? lines
        : ["　可比較的「合計」列不足兩筆，未做大小比較。"]),
    );
  }
  if (wants("growth") && condition.grouping !== "byRoad") {
    heading("季度之間的變動");
    const lines = describeGrowth(body, periods, digits);
    out.push(
      ...(lines.length
        ? lines
        : ["　範圍內沒有任何一列具備兩季以上的資料，未做季度比較。"]),
    );
  }
  if (wants("dayCompare") && condition.grouping === "overall") {
    heading("平日與假日對比");
    const lines = describeDayCompare(body, periods, digits);
    out.push(
      ...(lines.length
        ? lines
        : ["　範圍內沒有同一路段同時具備平日與假日的資料，未做對比。"]),
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
