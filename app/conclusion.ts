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
 * ・「全日」是一整天的加總，單位是 輛/日 或 PCU/日；
 *   部分時段調查是 輛/調查時段，兩者不可混談。
 * ・尖峰欄位是某一個小時的量（輛/hr、PCU/hr），是率不是量，
 *   不能跨調查點、跨季度相加。
 * ・單位一律由呼叫端用 cellUnitFor() 逐格算好傳進來，這裡只照抄。
 */

export type PeriodKey = "all" | "peak24" | "am" | "pm";

export const CONCLUSION_PERIOD_LABELS: Record<PeriodKey, string> = {
  all: "全日",
  peak24: "全日尖峰小時",
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
};

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
};

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

function pct(value: number | null | undefined, digits = 1) {
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
  if (scope.kind === "quarter") return scope.quarter;
  if (scope.kind === "year") return scope.year + " 年度";
  if (scope.kind === "range") return scope.from + "～" + scope.to;
  const quarters = Array.from(new Set(rows.map((r) => r.quarter))).sort(
    (a, b) => quarterKey(a) - quarterKey(b),
  );
  return quarters.length
    ? "全計畫（" + quarters[0] + "～" + quarters.at(-1) + "）"
    : "全計畫";
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
  const digits = condition.digits;
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
            `（佔 ${pct(cell.total ? (top.count / cell.total) * 100 : null)}）。`
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
                  `（${pct(cell.total ? (item.count / cell.total) * 100 : null)}）`,
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
                  `（${pct(cell.pcu ? (item.pcu / cell.pcu) * 100 : null)}）`,
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
          `由 ${first.quarter} 的 ${whole(first.cell.total)} ${first.cell.unitCount} ` +
          `變為 ${last.quarter} 的 ${whole(last.cell.total)} ${last.cell.unitCount}，` +
          (change === null
            ? "起始季為 0，變動幅度無法以百分比表示"
            : `${change >= 0 ? "增加" : "減少"} ${Math.abs(change).toFixed(1)}%`) +
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
        label: `${row.roadName}（${row.quarter}・${row.dayType}）`,
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
function describeDayCompare(rows: ConclusionRow[], periods: PeriodKey[]) {
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
        `　${weekday.roadName}（${weekday.quarter}）・${rowLabel(weekday)}・` +
          `${CONCLUSION_PERIOD_LABELS[period]}：平日 ${whole(a.total)} ${a.unitCount}、` +
          `假日 ${whole(b.total)} ${b.unitCount}，` +
          (change === null
            ? "平日為 0，無法以百分比表示差異"
            : `假日較平日${change >= 0 ? "多" : "少"} ${Math.abs(change).toFixed(1)}%`) +
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
  const chosen = selectRows(rows, condition);
  const periods = condition.periods.length
    ? condition.periods
    : (["all"] as PeriodKey[]);
  const digits = condition.digits;
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
    `統計範圍：${quarters.length} 個季度（${quarters.join("、")}）、` +
      `${roads.length} 個調查點、共 ${chosen.length} 列；` +
      `日別：${dayTypes.join("、")}；` +
      `時段：${periods.map((p) => CONCLUSION_PERIOD_LABELS[p]).join("、")}。`,
  );
  out.push(
    "說明：「全日」是一整天的加總（輛/日、PCU/日），尖峰欄位是某一小時的量" +
      "（輛/hr、PCU/hr），兩者不可混談；尖峰數值是率，不跨調查點、跨季度相加。" +
      "部分時段調查會標為「輛/調查時段」，與完整全日不可直接比較。",
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
        out.push(`　〔${row.quarter}・${row.dayType}・${rowLabel(row)}〕`);
        for (const period of periods) out.push(...describeCell(row, period, condition));
      }
      if (wants("growth")) out.push(...describeGrowth(group, periods));
      if (wants("dayCompare")) out.push(...describeDayCompare(group, periods));
    }
  } else if (condition.grouping === "byQuarter") {
    for (const quarter of quarters) {
      const group = body.filter((row) => row.quarter === quarter);
      if (!group.length) continue;
      heading(`${quarter}（共 ${group.length} 列）`);
      for (const row of group) {
        out.push(`　〔${row.roadName}・${row.dayType}・${rowLabel(row)}〕`);
        for (const period of periods) out.push(...describeCell(row, period, condition));
      }
      if (wants("extremes")) out.push(...describeExtremes(group, periods, digits));
      if (wants("dayCompare")) out.push(...describeDayCompare(group, periods));
    }
  } else {
    heading("整體結果");
    const first = body[0];
    out.push(
      `　代表列：${first.roadName}（${first.roadId}）・${first.quarter}・` +
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
    const lines = describeGrowth(body, periods);
    out.push(
      ...(lines.length
        ? lines
        : ["　範圍內沒有任何一列具備兩季以上的資料，未做季度比較。"]),
    );
  }
  if (wants("dayCompare") && condition.grouping === "overall") {
    heading("平日與假日對比");
    const lines = describeDayCompare(body, periods);
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
