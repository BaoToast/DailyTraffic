/**
 * ══════════════════════════════════════════════════════════════════
 *  圖旁邊的解讀說明
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的要求：「不管哪個程式，我希望圖旁邊都能有對應的、解讀該張圖
 * 代表的意義的說明提供給使用者看。」
 *
 * 這一支是**純函式**，不碰 DOM，所以可以用單元測試釘住。
 *
 * ⚠️ 兩個原則，違反任何一個這些文字就會變成負擔而不是幫助：
 *
 *  一、**只讀畫面上那一份資料，不回頭重算**。文字與圖分岔的時候，
 *      被念出來、被抄進報告的是文字——那比圖畫錯更難發現。
 *
 *  二、**講得出來才講**。沒有資料時就說沒有資料，不要為了湊滿四段而
 *      寫「本圖顯示各項數值之分布」這種等於沒說的話。
 */

import {
  type ChartLevels,
  heavyShareLevels,
  peakConcentrationLevels,
  dayCompareLevels,
  coverageLevels,
} from "./chart-levels.ts";

/**
 * 圖旁說明的一整份。
 *
 * ⚠️ 四級的分工（使用者 2026-09-20 定案，三支一致）：
 *   title + lines ＝ 第 1、2 級（這是什麼圖、圖上讀得出來的事實）
 *   levels.state  ＝ 第 3 級「代表什麼狀況」——**每張圖都要寫得出來**
 *   levels.action ＝ 第 4 級「要怎麼處理」——寫不出具體的就不給，
 *                    呼叫端看到沒有就**整段不畫**，不可以留一個空標題。
 *
 * ⚠️ 第 3、4 級的判定一律走 chart-levels（三支逐位元相同），
 *   **不可以在這裡自己寫一套區間**——自己寫的結果是同一個數字在三支
 *   被說成不同的狀況，而使用者會把三種說法都抄進同一份報告。
 */
export type ChartNote = {
  title: string;
  lines: string[];
  levels?: ChartLevels | null;
};

const nf = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-TW", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "－";

/**
 * 幾倍／幾成的白話寫法。中文簡報不說「幾個百分點」。
 *
 * ⚠️ 2026-09-11 改寫：一定要把**主詞寫出來**。
 *
 * 使用者回報：「『大約剩下原來的 65%』，『原來的』是什麼？
 *   正確說明應該是『假日是平日的 65%』……這類比較用的罐頭詞，
 *   主詞、誰是誰的幾倍或幾 %，要說明清楚。」
 *
 * 他是對的。「原來的」在這一句裡指的是**平日**，但句子裡沒有任何線索
 * 說明這件事——讀的人只能猜，而猜錯的方向剛好相反（會以為是比上一季）。
 * 這種句子會被整段複製進報告，所以主詞一定要自己帶著。
 *
 * ⚠️ 只改字，不改算法：ratio 仍然是 to / from，數字一個都不變。
 *
 * @param fromLabel 基準是誰（例如「平日」「115Q1」）
 * @param toLabel   被比較的是誰（例如「假日」「115Q2」）
 */
function timesText(
  from: number,
  to: number,
  fromLabel: string,
  toLabel: string,
): string {
  if (!(from > 0)) return "";
  const ratio = to / from;
  if (ratio >= 1.05)
    return `，${toLabel}大約是${fromLabel}的 ${ratio.toFixed(ratio >= 10 ? 0 : 1)} 倍`;
  if (ratio >= 1) return `，${toLabel}與${fromLabel}大約是同一個水準`;
  return `，${toLabel}大約是${fromLabel}的 ${(ratio * 100).toFixed(0)}%`;
}
/* ── 車種組成 ────────────────────────────────────────────── */

export function compositionNote(
  /*
   * ⚠️ `key` 是**歸類之後**的車種代碼（motorcycle／small／large／special，
   *   或使用者自訂而沒有歸類的 custom:*）。「大車」要靠它判斷，不可以用名稱猜。
   *   呼叫端傳的是 analysisVehicleCatalog（effectiveVehicleCounts 的結果），
   *   所以使用者把「電動機車」併進機車之後，這裡看到的就是機車。
   */
  items: { key?: string; label: string; count: number }[],
  total: number,
  scopeText: string,
): ChartNote {
  if (!total)
    return {
      title: "這張圖在說什麼",
      lines: ["目前的條件下沒有可統計的車輛數，所以畫不出組成。"],
    };
  const sorted = [...items]
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
  const top = sorted[0];
  const share = (value: number) => ((value / total) * 100).toFixed(1) + "%";
  const lines = [
    `這張圖是「${scopeText}」的車種組成：全部 ${nf(total)} 輛裡，各車種各佔多少。`,
  ];
  if (top)
    lines.push(
      `最多的是${top.label}，${nf(top.count)} 輛（${share(top.count)}）` +
        (sorted[1]
          ? `；其次是${sorted[1].label}，${share(sorted[1].count)}。`
          : "。"),
    );
  /*
   * 「大車比例」是報告裡最常被單獨問到的一項，主動算出來。
   *
   * ── 大車的定義（使用者 2026-09-15 定案，三支一致）─────────────
   *
   *   原生車種只有四類：機車、小型車、大型車、特種車。
   *   使用者新增的車種，要嘛**併入這四類其中之一**、要嘛**自成一個新類型**。
   *   所以：
   *     ・機車類型   ＝ 原生機車 ＋ 併入機車的自訂車種
   *     ・小型車類型 ＝ 原生小型車 ＋ 併入小型車的自訂車種
   *     ・大車       ＝ **非機車類型、非小型車類型的全部**
   *                   （大型車類型、特種車類型，以及沒有歸類、自成一類的自訂車種）
   *
   * ⚠️ 不可以用名稱比對（舊版寫 /大型|大客|大貨|聯結|特種/）。兩個方向都會錯：
   *     ・使用者把「電動機車」自成一類 → 名稱不含那些字，卻會被漏掉；
   *       用 key 判斷則會**正確地算進大車**（它不是機車類型）。
   *     ・使用者把「大貨車」併進機車（少見但做得到）→ 名稱有「大貨」會被算進大車，
   *       但它已經是機車類型，不該算。
   *   所以一律用歸類後的 key。
   *
   * ⚠️ 2026-09-14 還踩過一次：句子寫「大型車與特種車合計 18,375 輛」，
   *   但那兩項相加其實只有 10,239 輛——句子點名兩種、卻加了五種。
   *   現在名稱與數字同一個來源，並把實際算進去的車種逐一列出來。
   */
  const isLightKey = (item: { key?: string; label: string }) =>
    item.key
      ? item.key === "motorcycle" || item.key === "small"
      : item.label === "機車" || item.label === "小型車";
  const heavyItems = sorted.filter((item) => !isLightKey(item));
  const heavy = heavyItems.reduce((sum, item) => sum + item.count, 0);
  if (heavy > 0)
    lines.push(
      `大車（非機車、非小型車）合計 ${nf(heavy)} 輛（${share(heavy)}）：${heavyItems
        .map((item) => item.label)
        .join("、")}。這個比例直接關係到路面損壞與行車安全，通常要單獨提出來講。`,
    );
  if (sorted.length === 1)
    lines.push(
      "⚠️ 目前只有一個車種有數字，其餘都是 0——請先確認車種對應設定是不是漏掉了。",
    );
  /*
   * 第 3、4 級（使用者 2026-09-20）：車種組成這張圖最值得判讀的是**大車比例**，
   * 所以第 3 級就講它落在哪一個區間。
   * ⚠️ 一個車種都沒有大車時（heavy === 0）不硬寫——那時 heavyShareLevels
   *   會拿到 0，回的是「偏低」，句子成立；但如果連分母都沒有就不該叫它。
   */
  const levels = total > 0 ? heavyShareLevels((heavy / total) * 100) : null;
  return { title: "這張圖在說什麼", lines, levels };
}

/* ── 24 小時型態 ─────────────────────────────────────────── */

export function hourlyNote(
  points: { hour: string; value: number }[],
  unit: string,
  scopeText: string,
  /**
   * 這張圖目前涵蓋幾個調查點（稽核表 E）。
   * 沒傳就當成 1，舊呼叫端的輸出逐字不變。
   */
  pointCount = 1,
): ChartNote {
  const valued = points.filter((point) => Number.isFinite(point.value));
  if (valued.length < 2)
    return {
      title: "這張圖在說什麼",
      lines: ["目前的條件下不足兩個時段，看不出一天之內的分布。"],
    };
  const sorted = [...valued].sort((a, b) => b.value - a.value);
  const peak = sorted[0];
  const low = sorted[sorted.length - 1];
  const total = valued.reduce((sum, point) => sum + point.value, 0);
  const lines = [
    `這張圖是「${scopeText}」一天之內每一個小時的量，橫軸是時刻，縱軸是${unit}。回答的是「什麼時候最忙」。`,
    `最忙的是 ${peak.hour}，${nf(peak.value)} ${unit}；最閒的是 ${low.hour}，${nf(low.value)} ${unit}` +
      (low.value > 0 ? `，尖峰是離峰的 ${(peak.value / low.value).toFixed(1)} 倍。` : "。"),
  ];
  /*
   * ⚠️ 稽核表 E：這個佔比的分子與分母**都是跨調查點相加**出來的。
   *
   * 比值本身成立（同一個母體的一部分除以全體），所以不必拆；
   * 但沒寫清楚的話，讀的人會把它當成「某一條路的尖峰佔比」寫進報告——
   * 而 N 個調查點加起來的尖峰時刻不一定是任何一條路自己的尖峰時刻。
   * 所以多點時要**明講它是合起來算的**。
   */
  if (total > 0)
    lines.push(
      `尖峰那一小時佔全日的 ${((peak.value / total) * 100).toFixed(1)}%——這個比例越高，代表車流越集中，號誌與車道配置要處理的就是那一小時。` +
        (pointCount > 1
          ? `（⚠️ 這兩個數字是 ${pointCount} 個調查點**合起來**算的，不是任何單一一條路的尖峰佔比；各點的尖峰時刻不一定相同。）`
          : ""),
    );
  if (valued.length < 24)
    lines.push(
      `⚠️ 這一份調查只涵蓋 ${valued.length} 個小時，不是完整的 24 小時，所以「全日」相關的數字要小心引用。`,
    );
  /*
   * 第 3、4 級（使用者 2026-09-20）：24 小時型態這張圖最值得判讀的是
   * **尖峰集中度**（尖峰那一小時佔全日多少）。
   * ⚠️ 涵蓋不足時 peakConcentrationLevels 會自己改口說「分母不是全日」，
   *   所以這裡把實際涵蓋的時數傳進去，不要在這裡另外判斷一次——
   *   判斷寫兩處遲早會有一處沒跟著改。
   */
  const levels =
    total > 0
      ? peakConcentrationLevels((peak.value / total) * 100, valued.length)
      : coverageLevels(valued.length);
  return { title: "這張圖在說什麼", lines, levels };
}

/* ── 同季平假日 ──────────────────────────────────────────── */

export function dayCompareNote(
  rows: {
    name: string;
    weekday: number | null;
    holiday: number | null;
    /**
     * 這一列是不是「只調查了部分時段」。
     *
     * ⚠️ 為什麼要這一欄：面板上每一列的單位是**各自算**的（部分時段的
     * 調查點標「輛／調查時段」，全日的標「輛／日」）。說明文字如果把
     * 兩種單位的量加起來報一個合計，那個合計不對應任何真實的量。
     * 混到的時候要明說，不能默默相加。
     */
    partial?: boolean;
  }[],
  unit: string,
): ChartNote {
  const both = rows.filter(
    (row) => Number.isFinite(row.weekday) && Number.isFinite(row.holiday),
  ) as { name: string; weekday: number; holiday: number; partial?: boolean }[];
  if (!both.length)
    return {
      title: "這張圖在說什麼",
      lines: [
        "目前沒有任何一個調查點同時有平日與假日的資料，所以沒有可比較的對象。",
      ],
    };
  const weekday = both.reduce((sum, row) => sum + row.weekday, 0);
  const holiday = both.reduce((sum, row) => sum + row.holiday, 0);
  /* 單位混了就不報合計——相加出來的數字不對應任何真實的量。 */
  const mixedCoverage =
    both.some((row) => row.partial === true) &&
    both.some((row) => row.partial === false);
  /*
   * ⚠️ 稽核表 F：**跨調查點不報合計**。
   *
   * 舊版只擋單位混用（mixedCoverage），只要單位一致就把 N 個調查點
   * 相加成一個「合計」——而這份講稿是要拄進報告的。
   * 使用者 2026-09-16 已經裁示過：不同調查點的交通量**不可以相加**
   *（畫面上的小卡與結論草稿都已經改成逐點），這一句是漏掉的。
   * 只有**一個**調查點時才寫它自己的兩個數字（那不是合計）。
   */
  const lines = [
    `這張圖把同一季的平日與假日並排比較，一個調查點一組。**兩根柱子不會相加**——平日與假日是兩種不同的交通狀態，加起來的數字不對應任何一天。`,
    mixedCoverage
      ? `目前有 ${both.length} 個調查點同時有兩種日別。⚠️ 這些調查點裡**同時有全日調查與部分時段調查**，兩者單位不同，所以這裡不報合計數字，請逐點看圖上的數值。`
      : both.length === 1
        ? `「${both[0].name}」：平日 ${nf(weekday)} ${unit}、假日 ${nf(holiday)} ${unit}${timesText(weekday, holiday, "平日", "假日")}。`
        : `目前有 ${both.length} 個調查點同時有兩種日別。不同調查點的交通量**不可以相加**（它們數的是不同地點的車），所以這裡不列合計，請逐點看圖上的數值。`,
  ];
  /* 「假日反而比較高」是最值得被指出來的一種，通常是觀光型路段。 */
  const reversed = both.filter((row) => row.holiday > row.weekday);
  if (reversed.length)
    lines.push(
      `其中 ${reversed.length} 個調查點**假日反而比平日高**（${reversed
        .slice(0, 3)
        .map((row) => row.name)
        .join("、")}${reversed.length > 3 ? "…" : ""}），這通常是觀光或商業型路段，值得在報告裡單獨提。`,
    );
  const onlyOne = rows.length - both.length;
  if (onlyOne > 0)
    lines.push(
      `⚠️ 另有 ${onlyOne} 個調查點只做了其中一種日別，沒有進到「各路段平日與假日比較」裡。`,
    );
  /*
   * 第 3、4 級（使用者 2026-09-20）：平假日這張圖判讀的是**假日相對平日的比值**。
   *
   * ⚠️ 只有**一個**調查點時才用那一點自己的比值。多個調查點時不可以拿
   *   合計去算——那等於把不同地點的車加起來再比，正是 X-28 裁示過不可以做的事。
   *   多點時改用「假日比平日高的點數」來講狀況，講的是**點數**不是量。
   */
  let levels: ChartLevels | null = null;
  if (mixedCoverage) {
    levels = {
      state:
        `這一組調查點裡同時有全日調查與部分時段調查，兩者的單位不同；` +
        `圖上兩根柱子的高低可以比，但**不可以**把它們當成同一種量去算比例。`,
      action:
        `要讓這張圖可以整組比較，需要把部分時段的那幾個調查點補成完整 24 小時後重新匯入；` +
        `在那之前，報告中請逐點引用，不要寫整組的平假日比。`,
    };
  } else if (both.length === 1 && both[0].weekday > 0) {
    levels = dayCompareLevels(both[0].holiday / both[0].weekday);
  } else if (both.length > 1) {
    const share = (reversed.length / both.length) * 100;
    levels = {
      state:
        `${both.length} 個調查點之中有 ${reversed.length} 個（${share.toFixed(0)}%）假日高於平日；` +
        `比例越高，代表這一組路段越偏向非通勤性質。` +
        `不同調查點的量不可以相加，所以這裡講的是**點數**，不是總量。`,
      action:
        reversed.length > 0
          ? `假日較高的那幾個調查點建議在報告中單獨列出；` +
            `要判斷是不是常態，還需要連續數季的同一路段資料，本系統只有已匯入的季別。`
          : undefined,
    };
  }
  return { title: "這張圖在說什麼", lines, levels };
}
