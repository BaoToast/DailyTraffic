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

export type ChartNote = { title: string; lines: string[] };

const nf = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-TW", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "－";

/** 幾倍／幾成的白話寫法。中文簡報不說「幾個百分點」。 */
function timesText(from: number, to: number): string {
  if (!(from > 0)) return "";
  const ratio = to / from;
  if (ratio >= 1)
    return `，大約是${ratio >= 1.05 ? "" : "差不多"}${
      ratio >= 1.05 ? `原來的 ${ratio.toFixed(ratio >= 10 ? 0 : 1)} 倍` : "同一個水準"
    }`;
  return `，大約剩下原來的 ${(ratio * 100).toFixed(0)}%`;
}

/* ── 車種組成 ────────────────────────────────────────────── */

export function compositionNote(
  items: { label: string; count: number }[],
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
  /* 大型車比例是報告裡最常被單獨問到的一項，主動算出來。 */
  const heavy = sorted
    .filter((item) => /大型|大客|大貨|聯結|特種/.test(item.label))
    .reduce((sum, item) => sum + item.count, 0);
  if (heavy > 0)
    lines.push(
      `大型車與特種車合計 ${nf(heavy)} 輛（${share(heavy)}）。這個比例直接關係到路面損壞與行車安全，通常要單獨提出來講。`,
    );
  if (sorted.length === 1)
    lines.push(
      "⚠️ 目前只有一個車種有數字，其餘都是 0——請先確認車種對應設定是不是漏掉了。",
    );
  return { title: "這張圖在說什麼", lines };
}

/* ── 24 小時型態 ─────────────────────────────────────────── */

export function hourlyNote(
  points: { hour: string; value: number }[],
  unit: string,
  scopeText: string,
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
  if (total > 0)
    lines.push(
      `尖峰那一小時佔全日的 ${((peak.value / total) * 100).toFixed(1)}%——這個比例越高，代表車流越集中，號誌與車道配置要處理的就是那一小時。`,
    );
  if (valued.length < 24)
    lines.push(
      `⚠️ 這一份調查只涵蓋 ${valued.length} 個小時，不是完整的 24 小時，所以「全日」相關的數字要小心引用。`,
    );
  return { title: "這張圖在說什麼", lines };
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
  const lines = [
    `這張圖把同一季的平日與假日並排比較，一個調查點一組。**兩根柱子不會相加**——平日與假日是兩種不同的交通狀態，加起來的數字不對應任何一天。`,
    mixedCoverage
      ? `目前有 ${both.length} 個調查點同時有兩種日別。⚠️ 這些調查點裡**同時有全日調查與部分時段調查**，兩者單位不同，所以這裡不報合計數字，請逐點看圖上的數值。`
      : `${both.length} 個同時有兩種日別的調查點合計：平日 ${nf(weekday)} ${unit}、假日 ${nf(holiday)} ${unit}${timesText(weekday, holiday)}。`,
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
      `⚠️ 另有 ${onlyOne} 個調查點只做了其中一種日別，沒有進到上面的比較裡。`,
    );
  return { title: "這張圖在說什麼", lines };
}

/* ── 路段排名 ────────────────────────────────────────────── */

export function rankNote(
  rows: { name: string; value: number }[],
  unit: string,
): ChartNote {
  const valued = rows.filter((row) => Number.isFinite(row.value) && row.value > 0);
  if (!valued.length)
    return {
      title: "這張圖在說什麼",
      lines: ["目前的條件下沒有可排名的調查點。"],
    };
  const sorted = [...valued].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const lines = [
    `這張圖把這一季各調查點由多到少排開，回答的是「哪一個點最忙」。`,
    `最忙的是${top.name}，${nf(top.value)} ${unit}` +
      (sorted.length > 1
        ? `；最少的是${bottom.name}，${nf(bottom.value)} ${unit}，相差 ${(top.value / Math.max(bottom.value, 1)).toFixed(1)} 倍。`
        : "。"),
  ];
  lines.push(
    "⚠️ 不同調查點的量本來就會因為路型與位置而差很多，**排名高不等於有問題**；要判斷壅不壅塞請看服務水準或尖峰小時的集中程度。",
  );
  return { title: "這張圖在說什麼", lines };
}
