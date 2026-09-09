/**
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢：可選指標、圖表講稿、跨計畫比較
 * ══════════════════════════════════════════════════════════════════
 *
 * 這一支是**純函式**，不碰 DOM，也不碰畫布——所以可以用單元測試釘住，
 * 而畫面、Excel、講稿一律讀它的輸出，不各自再算一次。
 *
 * ⚠️ 這一支**不新增任何交通量算法**。每一個指標的值都是由呼叫端把既有的
 * `sumVehicleCounts()`／`sumVehiclePcu()` 等函式算好之後傳進來的；這裡只做
 * 分組、加總、平均與敘述。在趨勢模組裡再算一次交通量就會有第二個來源，
 * 兩套遲早分岔，而分岔時沒有人會發現。
 */

/** 一季一列。算不出來一律 null，**絕對不可以用 0 代替**。 */
export type TrendPoint = {
  quarter: string;
  weekday: number | null;
  holiday: number | null;
};

export type TrendSeriesMeta = {
  /** 指標名稱（例如「全日實際交通量」「大型車比例」）。 */
  label: string;
  /** 單位（「輛/日」「PCU/日」「%」…）；沒有單位就給空字串。 */
  unit: string;
  digits: number;
  /** 一句話：這個指標是什麼、拿來回答什麼問題。 */
  meaning: string;
};

export type TrendScriptSection = { title: string; lines: string[] };

/* ── 指標目錄 ─────────────────────────────────────────────── */

export type TrendMetricId =
  | "actual"
  | "pcu"
  | "vehicleClass"
  | "vehicleShare"
  | "heavyShare"
  | "peakHour"
  | "peakHourPcu";

export type TrendMetricDef = {
  id: TrendMetricId;
  label: string;
  /** "count"＝跟著調查涵蓋走的輛數單位；"pcu"＝PCU 單位；"%"＝百分比。 */
  unit: "count" | "pcu" | "%";
  digits: number;
  /** 需要再選一個對象嗎？ */
  picker: null | "vehicle";
  meaning: string;
  /**
   * 這個指標是不是「尖峰小時」類。
   * 尖峰小時要特別提醒：各季的尖峰不一定落在同一個小時，跨季比較時
   * 比的是「各自最忙的那一小時」，不是同一個時段。
   */
  peakBased?: boolean;
};

export const TREND_METRICS: TrendMetricDef[] = [
  {
    id: "actual",
    label: "全日實際交通量",
    unit: "count",
    digits: 0,
    picker: null,
    meaning:
      "整個調查涵蓋時間內實際數到的車輛數（不做 PCU 換算）。這是最常放進報告的一條線，回答的是「這條路整體變忙還是變閒」。",
  },
  {
    id: "pcu",
    label: "全日 PCU",
    unit: "pcu",
    digits: 0,
    picker: null,
    meaning:
      "把各車種換算成小客車當量之後的總量。與「實際交通量」搭配著看，可以看出車種組成有沒有變——車輛數沒變但 PCU 上升，代表大型車變多。",
  },
  {
    id: "vehicleClass",
    label: "單一車種車輛數",
    unit: "count",
    digits: 0,
    picker: "vehicle",
    meaning:
      "指定車種實際數到的車輛數。用來回答「機車是不是變多了」「大型車有沒有增加」這類問題。",
  },
  {
    id: "vehicleShare",
    label: "單一車種佔比",
    unit: "%",
    digits: 1,
    picker: "vehicle",
    meaning:
      "指定車種佔全部車輛數的百分比。總量在成長時，佔比才看得出「組成」有沒有變化——總量與佔比可以一升一降。",
  },
  {
    id: "heavyShare",
    label: "大型車比例",
    unit: "%",
    digits: 1,
    picker: null,
    meaning:
      "大型車與特種車合計佔全部車輛數的百分比。這個比例直接關係到路面損壞、噪音與行車安全，是報告裡經常被單獨問到的一項。",
  },
  {
    id: "peakHour",
    label: "尖峰小時交通量",
    unit: "count",
    digits: 0,
    picker: null,
    peakBased: true,
    meaning:
      "一天之中最忙的那一小時實際數到的車輛數。全日總量沒變、但尖峰小時上升時，代表車流集中了，那通常才是要處理的問題。",
  },
  {
    id: "peakHourPcu",
    label: "尖峰小時 PCU",
    unit: "pcu",
    digits: 0,
    picker: null,
    peakBased: true,
    meaning:
      "尖峰小時換算成小客車當量之後的量。號誌時制與服務水準的檢討多半以這個數字為準。",
  },
];

export function trendMetricById(id: string): TrendMetricDef {
  return (
    TREND_METRICS.find((metric) => metric.id === id) || TREND_METRICS[0]
  );
}

/**
 * 指標完整名稱（含選到的車種）。
 * 圖標題、PNG 檔名、Excel 工作表與講稿都用這一支，避免同一張圖在四個地方
 * 出現四種寫法。
 */
export function trendMetricLabel(
  metric: TrendMetricDef,
  vehicleLabel?: string,
): string {
  if (metric.picker !== "vehicle") return metric.label;
  const name = vehicleLabel || "所選車種";
  return metric.id === "vehicleShare" ? `${name}佔比` : `${name}車輛數`;
}

/**
 * 縱軸要寫的字：**名稱（單位）**。
 *
 * 使用者的要求是「有單位的軸，就要附上名稱和單位」。舊版縱軸只寫單位
 *（例如「輛/日」），看圖的人不知道那是全日量、尖峰量還是某個車種。
 * 沒有單位的指標只寫名稱——掛一個空括號比不掛還糟。
 */
export function axisTitle(label: string, unit: string): string {
  const clean = String(unit || "").trim();
  return clean ? `${label}（${clean}）` : label;
}

/* ── 數字寫法 ─────────────────────────────────────────────── */

/** 數值加單位。百分比不空格，其餘空一格（「1,234 輛/日」「42.9%」）。 */
export function formatTrendValue(
  value: number | null,
  meta: Pick<TrendSeriesMeta, "unit" | "digits">,
): string {
  if (value === null || !Number.isFinite(value)) return "－";
  const text = value.toLocaleString("zh-TW", {
    minimumFractionDigits: meta.digits,
    maximumFractionDigits: meta.digits,
  });
  if (!meta.unit) return text;
  return meta.unit === "%" ? text + "%" : text + " " + meta.unit;
}

/**
 * 兩個值之間的變化怎麼講。
 *
 * 中文簡報不說「幾個百分點」。做法是**先把兩端都講出來**，再說變化量，
 * 聽的人自然知道那個數字是怎麼來的：
 *   「從 113Q3 的 14.3%，到 114Q2 的 42.9%，整體上升 28.6%，大約是原來的 3 倍」
 * 要講 28.6% 還是 3 倍由使用者自己決定，我們把最完整的結果都給他。
 */
export function describeChange(
  from: number | null,
  to: number | null,
  meta: Pick<TrendSeriesMeta, "unit" | "digits">,
): string {
  if (from === null || to === null) return "";
  const delta = to - from;
  if (delta === 0) return "持平";
  const direction = delta > 0 ? "上升" : "下降";
  const magnitude = formatTrendValue(Math.abs(delta), meta);
  const ratio = from !== 0 ? to / from : null;
  const times =
    ratio !== null && ratio > 0
      ? ratio >= 1
        ? `，大約是原來的 ${ratio.toFixed(ratio >= 10 ? 0 : 1)} 倍`
        : `，大約剩下原來的 ${(ratio * 100).toFixed(0)}%`
      : "";
  return `${direction} ${magnitude}${times}`;
}

/* ── 講稿 ─────────────────────────────────────────────────── */

type Line = { key: "weekday" | "holiday"; name: string };
const LINES: Line[] = [
  { key: "weekday", name: "平日" },
  { key: "holiday", name: "假日" },
];

/**
 * 這張圖的簡報講稿。
 *
 * 場景設定：使用者把這張圖貼進簡報，站在業主面前。他需要知道的是
 * 「這張圖在說什麼」「重點在哪」「怎麼看」「有什麼要先講清楚的」。
 *
 * ⚠️ 這裡**只讀 points**，不重新碰紀錄。講稿說的每一個數字都必須是圖上
 * 畫得出來的那一個，否則就會出現「圖上寫 A、講稿講 B」——而講稿是會被
 * 照著念出來的。
 */
export function buildTrendScript(
  points: TrendPoint[],
  meta: TrendSeriesMeta,
  context: {
    scopeText: string;
    dayText: string;
    quarterLabel: (quarter: string) => string;
    /** 尖峰小時類指標時，各季的尖峰時段（用來提醒不是同一個小時）。 */
    peakHours?: Record<string, string>;
    /** 各季調查涵蓋不一致時的說明（例如有的季度只調查了部分時段）。 */
    coverageNote?: string;
  },
): TrendScriptSection[] {
  const q = context.quarterLabel;
  const sections: TrendScriptSection[] = [];
  const shown = LINES.filter((line) =>
    points.some((point) => point[line.key] !== null),
  );

  /* ① 這張圖在說什麼 */
  sections.push({
    title: "這張圖在說什麼",
    lines: [
      `這是「${context.scopeText}」在 ${context.dayText} 的「${meta.label}」歷季變化。`,
      meta.meaning,
      shown.length === 2
        ? "圖上有兩條線：平日與假日分開畫。兩條線本來就不該相等，假日通常較低；要比較的是各自的趨勢，不是兩條線的高低。"
        : shown.length === 1
          ? `圖上只有「${shown[0].name}」一條線。`
          : "目前沒有任何一條線畫得出來。",
      `橫軸是季度，縱軸是${meta.label}${meta.unit ? `，單位是 ${meta.unit === "%" ? "百分比" : meta.unit}` : ""}。`,
    ].filter(Boolean),
  });

  /* ② 重點變化（每一條線各講一次） */
  const changeLines: string[] = [];
  for (const line of shown) {
    const valued = points.filter((point) => point[line.key] !== null);
    if (valued.length >= 2) {
      const first = valued[0];
      const last = valued[valued.length - 1];
      changeLines.push(
        `${line.name}：從 ${q(first.quarter)} 的 ${formatTrendValue(first[line.key], meta)}，` +
          `到 ${q(last.quarter)} 的 ${formatTrendValue(last[line.key], meta)}，` +
          `整體${describeChange(first[line.key], last[line.key], meta)}。`,
      );
      /* 相鄰兩季變化最大的那一次——業主最常問的就是「哪一季跳最多」。 */
      let biggest: { from: TrendPoint; to: TrendPoint; delta: number } | null =
        null;
      for (let i = 1; i < valued.length; i += 1) {
        const delta =
          (valued[i][line.key] as number) - (valued[i - 1][line.key] as number);
        if (!biggest || Math.abs(delta) > Math.abs(biggest.delta))
          biggest = { from: valued[i - 1], to: valued[i], delta };
      }
      if (biggest && biggest.delta !== 0)
        changeLines.push(
          `${line.name}變化最大的一次落在 ${q(biggest.from.quarter)} 到 ${q(biggest.to.quarter)}：` +
            `從 ${formatTrendValue(biggest.from[line.key], meta)} ` +
            `${describeChange(biggest.from[line.key], biggest.to[line.key], meta)}。` +
            `這一段通常要說明原因（工程施工、路網調整、鄰近設施開業，或調查條件不同）。`,
        );
    } else if (valued.length === 1) {
      changeLines.push(
        `${line.name}只有 ${q(valued[0].quarter)} 一季算得出來` +
          `（${formatTrendValue(valued[0][line.key], meta)}），一個點畫不出趨勢，` +
          `請不要在簡報上把它講成「上升」或「下降」。`,
      );
    }
  }
  if (!changeLines.length)
    changeLines.push("所選範圍內沒有任何一季算得出這個指標，圖上不會有折線。");
  sections.push({ title: "重點變化", lines: changeLines });

  /* ③ 怎麼看這張圖 */
  const how: string[] = [
    "折線斷開的地方代表那一季「沒有那一種日別的資料」，不是「交通量歸零」——系統不會把沒有的季度連過去，因為連過去等於宣稱中間有一個介於兩端之間的值。",
  ];
  if (meta.unit === "%")
    how.push(
      "佔比要和總量一起看：總量成長時，佔比下降不代表這個車種變少，只代表它成長得比其他車種慢。",
    );
  if (meta.unit === "PCU" || meta.unit.includes("PCU"))
    how.push(
      "PCU（小客車當量）不是車輛數。同樣 1,000 PCU，可能是 1,000 輛小客車，也可能是較少的大型車——要看車輛組成請切換到「單一車種佔比」或「大型車比例」。",
    );
  sections.push({ title: "怎麼看這張圖", lines: how });

  /* ④ 要先講清楚的（資料界線） */
  const caveats: string[] = [];
  const missing = points.filter(
    (point) => point.weekday === null || point.holiday === null,
  );
  if (missing.length) {
    const both = missing.filter(
      (point) => point.weekday === null && point.holiday === null,
    );
    const only = missing.filter(
      (point) => !(point.weekday === null && point.holiday === null),
    );
    if (both.length)
      caveats.push(
        `有 ${both.length} 季平日與假日都沒有資料（${both
          .map((point) => q(point.quarter))
          .join("、")}），圖上是斷開的，簡報時要主動說明，不要讓聽的人誤以為是下降。`,
      );
    if (only.length && shown.length === 2)
      caveats.push(
        `有 ${only.length} 季只做了其中一種日別的調查（${only
          .map(
            (point) =>
              `${q(point.quarter)}缺${point.weekday === null ? "平日" : "假日"}`,
          )
          .join("、")}），那一條線在那幾季會斷開。`,
      );
  }
  const valuedCount = points.filter(
    (point) => point.weekday !== null || point.holiday !== null,
  ).length;
  if (valuedCount && valuedCount < 3)
    caveats.push(
      `目前只有 ${valuedCount} 季有資料，樣本太少，看不出趨勢方向；建議至少累積 4 季再下「持續上升／下降」這種結論。`,
    );
  if (context.peakHours) {
    const hours = Array.from(
      new Set(Object.values(context.peakHours).filter(Boolean)),
    );
    if (hours.length > 1)
      caveats.push(
        `⚠️ 這是尖峰小時的比較，而**各季的尖峰不一定落在同一個小時**（本圖涵蓋的季度分別是 ${Object.entries(
          context.peakHours,
        )
          .map(([quarter, hour]) => `${q(quarter)} ${hour}`)
          .join("、")}）。比的是「各季各自最忙的那一小時」，不是同一個時段。`,
      );
    else if (hours.length === 1)
      caveats.push(
        `本圖涵蓋的季度尖峰都落在 ${hours[0]}，可以直接當成同一個時段來比較。`,
      );
  }
  if (context.coverageNote) caveats.push(context.coverageNote);
  if (!caveats.length)
    caveats.push(
      "所選範圍內每一季都有資料，折線沒有斷點，可以直接照著趨勢講。",
    );
  sections.push({ title: "要先講清楚的", lines: caveats });

  return sections;
}

/* ── 跨計畫比較 ──────────────────────────────────────────── */

/**
 * 跨計畫歷季趨勢。
 *
 * ⚠️ **絕對不可以比總量。** 每個計畫的路段數量本來就不一樣——A 計畫 12 條
 * 路段、B 計畫 3 條，總量畫在一起只會證明「A 比較大」，那是已知的，
 * 不是資訊。這裡一律換算成**每路段平均**，並把該季的路段數（N）帶在點上。
 *
 * 佔比類指標本來就是比例，改用**加權平均**：分子分母各自加總再相除，
 * 而不是把各路段的百分比再平均一次——後者會讓一條很短的路段和一條
 * 很長的路段有同樣的份量。
 */
export type CrossProjectInput = {
  projectId: string;
  projectName: string;
  /** 一季一筆；value 是該計畫該季**所有路段的合計**，count 是路段數。 */
  points: Array<{
    quarter: string;
    /** 佔比指標時放分子；其餘指標放合計值。算不出來給 null。 */
    total: number | null;
    /** 佔比指標時放分母；其餘指標不用。 */
    denominator?: number | null;
    /** 這一季有幾條路段算得出來。 */
    count: number;
    /** 這一季總共有幾條路段。 */
    size: number;
  }>;
};

export type CrossProjectPoint = {
  quarter: string;
  value: number | null;
  count: number;
  size: number;
};

export type CrossProjectTrend = {
  quarters: string[];
  series: Array<{
    projectId: string;
    projectName: string;
    points: CrossProjectPoint[];
  }>;
  meta: TrendSeriesMeta;
  basis: string;
};

export function buildCrossProjectTrend(
  inputs: CrossProjectInput[],
  meta: TrendSeriesMeta,
  compareQuarters: (a: string, b: string) => number,
): CrossProjectTrend {
  /*
   * 頭尾之間整季沒有資料的季度要補成空格，X 軸的間距才對應真實時間。
   * 補出來的季在每一個計畫底下都查不到點，值一律 null，折線會斷開。
   */
  const quarters = completeQuarterRange(
    Array.from(
      new Set(
        inputs.flatMap((item) => item.points.map((point) => point.quarter)),
      ),
    ).sort(compareQuarters),
  );
  const isShare = meta.unit === "%";
  const series = inputs.map((item) => {
    const byQuarter = new Map(item.points.map((point) => [point.quarter, point]));
    return {
      projectId: item.projectId,
      projectName: item.projectName,
      points: quarters.map(function (quarter): CrossProjectPoint {
        const point = byQuarter.get(quarter);
        if (!point || point.total === null || !point.count)
          return { quarter, value: null, count: point?.count ?? 0, size: point?.size ?? 0 };
        if (isShare) {
          const denominator = point.denominator ?? 0;
          /*
           * 分母為 0 時**不可以**回 0%——那會被讀成「這個車種一台都沒有」，
           * 而事實是「這一季沒有可以當分母的車輛數」。
           */
          return {
            quarter,
            value: denominator ? (point.total / denominator) * 100 : null,
            count: point.count,
            size: point.size,
          };
        }
        return {
          quarter,
          value: point.total / point.count,
          count: point.count,
          size: point.size,
        };
      }),
    };
  });
  return {
    quarters,
    series,
    meta,
    basis: isShare
      ? "各計畫的加權平均（分子分母各自加總再相除，不是把各路段的百分比再平均一次）"
      : "各計畫的每路段平均（合計除以該季算得出來的路段數）",
  };
}

export function buildCrossProjectScript(
  trend: CrossProjectTrend,
  quarterLabel: (quarter: string) => string,
): TrendScriptSection[] {
  const q = quarterLabel;
  const sections: TrendScriptSection[] = [];

  sections.push({
    title: "這張圖在說什麼",
    lines: [
      `這是各計畫在「${trend.meta.label}」上的歷季比較，每一條線是一個計畫。`,
      `⚠️ 每個計畫的路段數量不一樣，所以圖上畫的**不是總量**，而是${trend.basis}。` +
        `直接比總量只會證明「路段比較多的計畫比較大」，那是已知的，不是資訊。`,
      "每一個點旁邊的 N 是那一季實際算得出來的路段數。N 差很多時，兩條線的穩定度本來就不同——路段少的那一條，單一路段的變化就足以讓整條線跳動。",
    ],
  });

  const lines: string[] = [];
  for (const item of trend.series) {
    const valued = item.points.filter((point) => point.value !== null);
    if (valued.length >= 2) {
      const first = valued[0];
      const last = valued[valued.length - 1];
      lines.push(
        `${item.projectName}：從 ${q(first.quarter)} 的 ${formatTrendValue(first.value, trend.meta)}（N=${first.count}），` +
          `到 ${q(last.quarter)} 的 ${formatTrendValue(last.value, trend.meta)}（N=${last.count}），` +
          `${describeChange(first.value, last.value, trend.meta)}。`,
      );
    } else if (valued.length === 1) {
      lines.push(
        `${item.projectName}：只有 ${q(valued[0].quarter)} 一季有值（${formatTrendValue(
          valued[0].value,
          trend.meta,
        )}，N=${valued[0].count}），畫不出趨勢。`,
      );
    } else {
      lines.push(`${item.projectName}：所選範圍內沒有算得出來的季度。`);
    }
  }
  sections.push({ title: "各計畫的變化", lines });

  const caveats: string[] = [];
  const counts = trend.series.flatMap((item) =>
    item.points.filter((point) => point.value !== null).map((point) => point.count),
  );
  if (counts.length) {
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    if (min > 0 && max >= min * 3)
      caveats.push(
        `各計畫的路段數差距很大（最少 ${min} 條、最多 ${max} 條）。路段數少的計畫，平均值容易被單一路段帶著跑，兩條線的抖動幅度不能直接拿來相比。`,
      );
    if (min === 1)
      caveats.push(
        "有計畫在某一季只有 1 條路段算得出來——那一季的「平均」其實就是那一條路段本身，不具代表性。",
      );
  }
  const partial = trend.series.filter((item) =>
    item.points.some((point) => point.size > 0 && point.count < point.size),
  );
  if (partial.length)
    caveats.push(
      `有計畫的某些季度只有部分路段算得出來（${partial
        .map((item) => item.projectName)
        .join("、")}），平均是用算得出來的那幾條算的。`,
    );
  const sparse = trend.series.filter(
    (item) => item.points.filter((point) => point.value !== null).length < 2,
  );
  if (sparse.length)
    caveats.push(
      `${sparse
        .map((item) => item.projectName)
        .join("、")} 不足兩季，圖上不會有折線；這不是資料異常，只是還沒累積夠。`,
    );
  if (!caveats.length)
    caveats.push(
      "各計畫的路段數相當、每一季都算得出來，這幾條線可以直接互相比較。",
    );
  sections.push({ title: "要先講清楚的", lines: caveats });

  return sections;
}

/* ── X 軸標籤間隔 ────────────────────────────────────────── */

/**
 * X 軸標籤要間隔幾個才印一個。
 *
 * `measure` 是「量一段字實際多寬」的函式。畫布有 `ctx.measureText`，
 * 所以這裡可以**真的量**，不像 SVG 那邊只能估——估的話字型一換就失準。
 *
 * ⚠️ 不可以「反正現在季度不多」。季度會一路累積下去，二十幾季之後標籤
 * 就會擠成一團，而那時候使用者已經在簡報現場了。
 */
export function labelStride(
  labels: string[],
  available: number,
  measure: (text: string) => number,
): number {
  if (!labels.length) return 1;
  let widest = 0;
  for (const label of labels) {
    const width = measure(String(label ?? ""));
    if (width > widest) widest = width;
  }
  const slot = widest + widest * 0.5;
  const fits = Math.max(1, Math.floor(available / Math.max(1, slot)));
  return Math.max(1, Math.ceil(labels.length / fits));
}

/** 這一格 X 軸標籤要不要印（最後一季一定印，倒數幾個讓位）。 */
export function showXLabel(
  index: number,
  count: number,
  stride: number,
): boolean {
  if (index === count - 1) return true;
  if (index % stride !== 0) return false;
  /*
   * 門檻是整個 stride，不是一半。用一半的話，stride=2 時「倒數第二個」
   * 與「最後一個」只差 1 格就會同時印出來，兩個標籤直接疊在一起。
   */
  return stride === 1 || count - 1 - index >= stride;
}

/* ── 缺季補齊 ────────────────────────────────────────────────── */

/**
 * 把頭尾之間**真正沒有資料的整季**補進季度清單。
 *
 * ⚠️ 這不是美觀問題，是**看圖的人會讀錯**。假設只做了 113Q1 與 114Q1，
 * 不補的話 X 軸只有兩格，兩個點緊鄰，折線看起來像「上一季到這一季」的
 * 變化——實際上中間隔了整整一年、四季。補上 113Q2／113Q3／113Q4 三個
 * 空格之後，X 軸的間距才對應真實時間，缺的那三季也會因為值是 null
 * 而讓折線斷開（斷線＝「這幾季沒調查」，不是「這幾季是 0」）。
 *
 * 保守處理，寧可不補也不要猜：
 *  - 只要有一個季度不是 `<年>Q<1-4>`（例如自訂期別名稱）就整批原樣回傳。
 *  - 民國三碼與西元四碼**混用**時原樣回傳——補出來的那幾格必須挑一種
 *    寫法，挑錯會讓 X 軸上同時出現「113Q2」與「2024Q3」兩種格式。
 *  - 跨距離譜（超過 100 年）時原樣回傳，避免資料打錯字時補出上萬格。
 */
export function completeQuarterRange(quarters: string[]): string[] {
  if (quarters.length < 2) return quarters;
  let calendar: "roc" | "western" | null = null;
  const keys: number[] = [];
  for (const raw of quarters) {
    const match = /^(\d{2,4})Q([1-4])$/.exec(String(raw ?? "").trim());
    if (!match) return quarters;
    const digits = match[1].length;
    const currentCalendar = digits === 4 ? "western" : "roc";
    if (calendar === null) calendar = currentCalendar;
    else if (calendar !== currentCalendar) return quarters;
    keys.push(Number(match[1]) * 4 + Number(match[2]) - 1);
  }
  const from = Math.min(...keys);
  const to = Math.max(...keys);
  if (to - from > 400) return quarters;
  const out: string[] = [];
  for (let key = from; key <= to; key += 1)
    out.push(String(Math.floor(key / 4)) + "Q" + ((key % 4) + 1));
  return out;
}

/* ── 縱軸刻度 ────────────────────────────────────────────────── */

/**
 * 縱軸刻度要落在「好看的整數」上。
 *
 * 舊版的軸頂直接就是資料最大值，四等分之後刻度變成
 * 42,090／31,568／21,045／10,523／0 這種一排亂數——看圖的人得先在心裡
 * 換算才知道某一點大概是多少。而且軸頂等於資料最大值，代表最高的那個
 * 點會**貼著最上面那條格線**畫，圓點還會被切掉一半。
 *
 * ⚠️ 這裡是**先決定每一格的高度**，再回推軸頂（max = 每格 × 格數），
 * 不是先決定軸頂再均分。先定軸頂的話，軸頂雖然是整數，每一格卻可能
 * 變成 1,750 這種數字（7,000 ÷ 4），刻度照樣不好讀。
 *
 * 每一格只允許 1／1.5／2／2.5／3／4／5／6／8／10 的 10 的次方倍——
 * 這幾個乘上任何一個 10 的次方，讀起來都是「一眼就知道多少」的數。
 * 往上吸附，所以軸頂一定 ≥ 資料最大值，而且最多只高一階。
 *
 * 三支系統（全日交通量、路口轉向、交通服務水準）刻意用同一套規則。
 */
const NICE_STEPS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

export function niceAxisMax(
  hi: number,
  count: number,
): { max: number; digits: number } {
  const top = Number.isFinite(hi) && hi > 0 ? hi : 1;
  const rough = top / Math.max(1, count);
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const scaled = rough / power;
  const pick = NICE_STEPS.find((value) => scaled <= value + 1e-9) ?? 10;
  const gap = pick * power;
  const digits = Math.max(0, -Math.floor(Math.log10(gap)));
  return { max: Number((gap * count).toFixed(digits + 2)), digits };
}
