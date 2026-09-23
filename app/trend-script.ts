/*
 * 圖說第 3、4 級的判定（三支共用、逐位元相同）。
 * ⚠️ 不可以在這裡自己寫一套區間——自己寫的結果是同一個數字在三支
 *   被說成不同的狀況，而使用者會把三種說法都抄進同一份報告。
 */
import {
  LEVEL3_TITLE,
  LEVEL4_TITLE,
  trendChangeLevels,
} from "./chart-levels.ts";

/**
 * ══════════════════════════════════════════════════════════════════
 *  歷季趨勢：可選指標、圖表講稿
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
  /** 指標名稱（例如「全日實際交通量」「大車比例」）。 */
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
    /*
     * ── 「車種」在這裡一律指**歸類後的類型**（2026-09-15 定案）────────
     *   原生類型有四個：機車、小型車、大型車、特種車。
     *   自訂車種要嘛併入這四個之一、要嘛自成一個新類型。
     *   下拉裡列的是**類型**，不是調查表上的原始車種——
     *   使用者把「電動機車」併進機車之後，下拉裡就不再有「電動機車」，
     *   而「機車」這一條線包含它。與「車種組成」那一塊完全同一個口徑。
     */
    label: "單一車種車輛數",
    unit: "count",
    digits: 0,
    picker: "vehicle",
    meaning:
      "指定車種類型實際數到的車輛數（已併入該類型的自訂車種一起算）。用來回答「機車是不是變多了」「大型車有沒有增加」這類問題。",
  },
  {
    id: "vehicleShare",
    label: "單一車種佔比",
    unit: "%",
    digits: 1,
    picker: "vehicle",
    meaning:
      "指定車種類型佔全部車輛數的百分比（已併入該類型的自訂車種一起算）。總量在成長時，佔比才看得出「組成」有沒有變化——總量與佔比可以一升一降。",
  },
  {
    id: "heavyShare",
    /*
     * ⚠️ 名字叫「大車比例」不是「大型車比例」——使用者 2026-09-15 指名改名，
     *   理由是舊名讓人（包括我）誤以為只算內建的那一個「大型車」車種。
     *   這裡的大車是「非機車、非小型車」的全部，見下面的 meaning。
     */
    label: "大車比例",
    unit: "%",
    digits: 1,
    picker: null,
    meaning:
      /*
       * ── 大車的定義（使用者 2026-09-15 定案，與車種組成的說明同一套）──
       *   原生車種只有四類：機車、小型車、大型車、特種車。
       *   自訂車種要嘛併入這四類其中之一、要嘛自成一個新類型。
       *   **大車 ＝ 非機車類型、非小型車類型的全部**
       *  （大型車類型、特種車類型，以及沒有歸類、自成一類的自訂車種）。
       *
       * ⚠️ 舊版只算 counts.large + counts.special（而且用的是歸類**前**的
       *   數字），於是「大客車、大貨車、聯結車」這些沒有歸類的自訂車種
       *   整組被漏掉：同一批資料，這裡算 23.8%、車種組成那一塊算 42.7%。
       *   已改成同一個口徑。
       */
      "非機車、非小型車的車種合計佔全部車輛數的百分比（含大型車類型、特種車類型，以及自訂而未歸類的車種；已歸類到機車或小型車的自訂車種不算）。這個比例直接關係到路面損壞、噪音與行車安全，是報告裡經常被單獨問到的一項。",
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
  /*
   * ⚠️ 2026-09-11 新增這兩個標籤，一定要把**主詞寫出來**。
   *
   * 使用者回報：「『大約剩下原來的 65%』，『原來的』是什麼？
   *   正確說明應該是『假日是平日的 65%』……這類比較用的罐頭詞，
   *   主詞、誰是誰的幾倍或幾 %，要說明清楚。」
   *
   * 「原來的」在這一句裡指的是**起始那一季**，但句子裡沒有任何線索
   * 說明這件事。這種句子會被整段複製進報告，主詞一定要自己帶著。
   *
   * ⚠️ 只改字，不改算法：ratio 仍然是 to / from，數字一個都不變。
   *
   * ⚠️ 這個參數刻意設成**必填**，沒有「不給標籤」的退路。
   *   給了退路就一定會有呼叫端忘記給，而忘記的那一句長得和正常的一模一樣
   *   （只是少了主詞），沒有人會發現。使用者的原話：
   *  「這類調查報告應該沒有所謂的原來值……『A 是 B 的幾 %』主詞要明確，
   *    不然會看不懂，是跟誰比才有這倍率。」
   */
  labels: { from: string; to: string },
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
        ? `，${labels.to}大約是${labels.from}的 ${ratio.toFixed(ratio >= 10 ? 0 : 1)} 倍`
        : `，${labels.to}大約是${labels.from}的 ${(ratio * 100).toFixed(0)}%`
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
 * 講稿裡的一條線。`values` 與 `points` **等長、同順序**。
 *
 * 平常（單一調查點）不必給，講稿自己會從 points 的 weekday／holiday
 * 拆成兩條。多個調查點時由呼叫端傳進來——那時圖上是「一個調查點一條線」，
 * 講稿必須講**同樣那幾條**，不可以回頭去念 points 裡的合計。
 */
export type TrendScriptLine = { name: string; values: (number | null)[] };

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
    /**
     * 圖上實際畫的那幾條線（多個調查點時「一個調查點一條線」）。
     * 不給就退回平日／假日兩條，輸出與升級前**逐字相同**。
     */
    seriesLines?: TrendScriptLine[];
  },
): TrendScriptSection[] {
  const q = context.quarterLabel;
  const sections: TrendScriptSection[] = [];
  /*
   * ⚠️ 講稿的每一條線必須與**圖上畫的那幾條**一模一樣。
   *   多個調查點時圖畫的是逐點的線，講稿卻去念 points 的 weekday／holiday，
   *   念出來的就是那個「不同地點相加」的數字（X-28 已裁示不可以出現）。
   */
  const perRoad = Boolean(context.seriesLines?.length);
  const allLines: TrendScriptLine[] = perRoad
    ? (context.seriesLines as TrendScriptLine[])
    : LINES.map((line) => ({
        name: line.name,
        values: points.map((point) => point[line.key]),
      }));
  const shown = allLines.filter((line) =>
    line.values.some((value) => value !== null),
  );

  /* ① 這張圖在說什麼 */
  sections.push({
    title: "這張圖在說什麼",
    lines: [
      `這是「${context.scopeText}」在 ${context.dayText} 的「${meta.label}」歷季變化。`,
      meta.meaning,
      perRoad
        ? `圖上有 ${shown.length} 條線：一個調查點一條線（有平日也有假日時再各自分開）。` +
          `不同調查點的交通量不可以相加，所以這張圖不畫合計，也沒有任何一條線代表全部調查點。`
        : shown.length === 2
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
    const valued = points
      .map((point, index) => ({
        quarter: point.quarter,
        value: line.values[index],
      }))
      .filter((item) => item.value !== null);
    if (valued.length >= 2) {
      const first = valued[0];
      const last = valued[valued.length - 1];
      changeLines.push(
        `${line.name}：從 ${q(first.quarter)} 的 ${formatTrendValue(first.value, meta)}，` +
          `到 ${q(last.quarter)} 的 ${formatTrendValue(last.value, meta)}，` +
          `整體${describeChange(first.value, last.value, meta, {
            from: q(first.quarter),
            to: q(last.quarter),
          })}。`,
      );
      /* 相鄰兩季變化最大的那一次——業主最常問的就是「哪一季跳最多」。 */
      let biggest: {
        from: (typeof valued)[number];
        to: (typeof valued)[number];
        delta: number;
      } | null = null;
      for (let i = 1; i < valued.length; i += 1) {
        const delta = (valued[i].value as number) - (valued[i - 1].value as number);
        if (!biggest || Math.abs(delta) > Math.abs(biggest.delta))
          biggest = { from: valued[i - 1], to: valued[i], delta };
      }
      if (biggest && biggest.delta !== 0)
        changeLines.push(
          `${line.name}變化最大的一次落在 ${q(biggest.from.quarter)} 到 ${q(biggest.to.quarter)}：` +
            `從 ${formatTrendValue(biggest.from.value, meta)} ` +
            `${describeChange(biggest.from.value, biggest.to.value, meta, {
              from: q(biggest.from.quarter),
              to: q(biggest.to.quarter),
            })}。` +
            `這一段通常要說明原因（工程施工、路網調整、鄰近設施開業，或調查條件不同）。`,
        );
    } else if (valued.length === 1) {
      changeLines.push(
        `${line.name}只有 ${q(valued[0].quarter)} 一季算得出來` +
          `（${formatTrendValue(valued[0].value, meta)}），一個點畫不出趨勢，` +
          `請不要在簡報上把它講成「上升」或「下降」。`,
      );
    }
  }
  if (!changeLines.length)
    changeLines.push("所選範圍內沒有任何一季算得出這個指標，圖上不會有折線。");
  sections.push({ title: "重點變化", lines: changeLines });

  /*
   * ══════════════════════════════════════════════════════════════
   *  ②-b 第 3 級「代表什麼狀況」與第 4 級「要怎麼處理」
   * ══════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-20：「三支共通：圖旁說明文字升到第 3 級（代表什麼狀況）、
   * 第 4 級（要怎麼處理）」「第 4 級只在寫得出具體的時候才寫……不要盲猜」。
   *
   * ⚠️ 判定一律走 chart-levels（三支逐位元相同），**不可以在這裡自己寫區間**。
   * ⚠️ 一條線一段。多條線時不可以只講第一條，也不可以把幾條線的變化平均
   *   起來講——那等於把不同調查點的量混在一起，X-28 已經裁示過不可以。
   * ⚠️ 算不出變化（只有一季、或一季都沒有）時**整段不出現**，
   *   不可以留一個空標題，也不可以塞一句「請持續觀察」湊數。
   */
  const stateLines: string[] = [];
  const actionLines: string[] = [];
  for (const line of shown) {
    const valued = points
      .map((point, index) => ({
        quarter: point.quarter,
        value: line.values[index],
      }))
      .filter((item) => item.value !== null) as {
      quarter: string;
      value: number;
    }[];
    if (valued.length < 2) continue;
    const first = valued[0].value;
    const last = valued[valued.length - 1].value;
    if (!(first > 0)) continue;
    const judged = trendChangeLevels(
      ((last - first) / first) * 100,
      valued.length,
    );
    if (!judged) continue;
    const prefix = shown.length > 1 ? `${line.name}：` : "";
    stateLines.push(prefix + judged.state);
    if (judged.action) actionLines.push(prefix + judged.action);
  }
  if (stateLines.length)
    sections.push({ title: LEVEL3_TITLE, lines: stateLines });
  if (actionLines.length)
    sections.push({ title: LEVEL4_TITLE, lines: actionLines });

  /* ③ 怎麼看這張圖 */
  /*
   * ⚠️ 「折線斷開」那一句**只有在圖上真的有斷開時才講**。
   *
   * 使用者 2026-09-11：「圖中只有兩季資料，沒有所謂的斷開的地方，
   *   是不是沒有這一段、沒有結論，硬是亂找或模糊找了一句罐頭話套上？
   *   我們之前說過，如果沒有相關結論，那就可以不顯示，不要亂選句子使用。」
   *
   * 他是對的，而且這比「多一句廢話」嚴重：說明文字是要被**照著念給業主聽**的。
   * 講一句圖上找不到對應的話，聽的人會去圖上找那個斷點，找不到就開始懷疑
   * 這份資料到底對不對——**一句不適用的罐頭話，賠掉的是整張圖的可信度**。
   *
   * 判斷依據：目前畫得出來的那幾條線裡，有沒有哪一季是 null。
   * 沒有的話這一句就不成立，直接不放。
   */
  const hasGap = shown.some((line) =>
    line.values.some((value) => value === null),
  );
  const how: string[] = [];
  if (hasGap)
    how.push(
      "折線斷開的地方代表那一季「沒有那一種日別的資料」，不是「交通量歸零」——系統不會把沒有的季度連過去，因為連過去等於宣稱中間有一個介於兩端之間的值。",
    );
  if (meta.unit === "%")
    how.push(
      "佔比要和總量一起看：總量成長時，佔比下降不代表這個車種變少，只代表它成長得比其他車種慢。",
    );
  if (meta.unit === "PCU" || meta.unit.includes("PCU"))
    how.push(
      "PCU（小客車當量）不是車輛數。同樣 1,000 PCU，可能是 1,000 輛小客車，也可能是較少的大型車——要看車輛組成請切換到「單一車種佔比」或「大車比例」。",
    );
  /*
   * ⚠️ 一句都沒有的時候**整段不出現**，不可以放一個空的標題，
   *   也不可以為了湊滿而塞一句「這張圖很好懂」之類的話。
   *   沒有結論就不要有段落——這是使用者訂的規則。
   */
  if (how.length) sections.push({ title: "怎麼看這張圖", lines: how });

  /* ④ 要先講清楚的（資料界線） */
  const caveats: string[] = [];
  /*
   * 逐季看「畫得出來的那幾條線」各缺哪幾條。
   * ⚠️ 判斷依據一律是 shown（＝圖上真的有的線），不是固定的平日／假日兩欄——
   *   多個調查點時那兩欄根本不是圖上畫的東西。
   */
  const missingNamesAt = points.map((_point, index) =>
    shown.filter((line) => line.values[index] === null).map((line) => line.name),
  );
  const both = points
    .map((point, index) => ({ point, index }))
    .filter(
      ({ index }) =>
        shown.length > 0 && missingNamesAt[index].length === shown.length,
    );
  const only = points
    .map((point, index) => ({ point, index }))
    .filter(
      ({ index }) =>
        missingNamesAt[index].length > 0 &&
        missingNamesAt[index].length < shown.length,
    );
  if (both.length)
    caveats.push(
      `有 ${both.length} 季${perRoad ? "所有調查點" : "平日與假日"}都沒有資料（${both
        .map(({ point }) => q(point.quarter))
        .join("、")}），圖上是斷開的，簡報時要主動說明，不要讓聽的人誤以為是下降。`,
    );
  if (only.length && shown.length >= 2)
    caveats.push(
      perRoad
        ? `有 ${only.length} 季只有部分的線算得出來（${only
            .map(
              ({ point, index }) =>
                `${q(point.quarter)}缺${missingNamesAt[index].join("、")}`,
            )
            .join("；")}），那幾條線在那幾季會斷開。`
        : `有 ${only.length} 季只做了其中一種日別的調查（${only
            .map(
              ({ point, index }) =>
                `${q(point.quarter)}缺${missingNamesAt[index].join("、")}`,
            )
            .join("、")}），那一條線在那幾季會斷開。`,
    );
  const valuedCount = points.filter((_point, index) =>
    shown.some((line) => line.values[index] !== null),
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
        /*
         * ⚠️ 這一句原本寫成 `**各季的尖峰不一定落在同一個小時**`。
         *   chart-notes 那邊用 `**` 是對的——那些字會經過 boldParts() 變成
         *   <strong>。但這一份不會：趨勢圖說明有三個去處，
         *   ①畫面上是 `{line}` 直接印、②「複製說明」是純文字／.txt、
         *   ③匯出 Excel 是塞進儲存格，**三個都不吃 markdown**。
         *   所以使用者三個地方都會看到星號。改用「」。
         */
        `⚠️ 這是尖峰小時的比較，而「各季的尖峰不一定落在同一個小時」（本圖涵蓋的季度分別是 ${Object.entries(
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
