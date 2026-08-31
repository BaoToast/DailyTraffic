/**
 * 部分時段（上午 N 小時＋下午 N 小時）調查格式的共用計算。
 *
 * 一般的全日調查是「每小時一列、涵蓋 24 小時」，尖峰小時就是流量最大的那一列。
 * 但實務上很常只調查上午與下午各數小時，並且以 15 分鐘為一格記錄，例如
 * 07:00～09:00 與 17:00～19:00 各 8 格。這種資料的尖峰小時不能取「最大的
 * 那一格」（那是 15 分鐘流率，不是小時流量），必須改用連續 4 格＝1 小時的
 * 滾動視窗，每 15 分鐘推移一次，在上午區塊與下午區塊各自取最大值。
 *
 * 2022 年臺灣公路容量手冊只定義尖峰小時係數（式 2.10，PHF＝尖峰小時流率
 * ÷ 尖峰 15 分鐘流率×4）與設計小時流量係數，並未規定固定的尖峰時鐘區間，
 * 因此尖峰小時一律由實測資料滾動搜尋，這也是本模組採用的做法。
 *
 * 這個模組只在「偵測到不足一小時的時間格」時改變尖峰的算法；
 * 既有的每小時一列格式完全走原本的路徑，計算結果不受影響。
 */

/** 一天的分鐘數，用來處理跨午夜的時段。 */
const DAY_MINUTES = 24 * 60;

export type TimeRange = {
  /** 起始時間（自 00:00 起算的分鐘數） */
  start: number;
  /** 結束時間（分鐘數；跨午夜時會加上 1440） */
  end: number;
};

/** 解析「07:00～07:15」「7:00-8:00」等寫法；無法解析回傳 null。 */
export function parseTimeRange(hour: string): TimeRange | null {
  const text = String(hour ?? "").normalize("NFKC");
  const match = text.match(/(\d{1,2})\s*:\s*(\d{2})\s*[～~\-—–至到]\s*(\d{1,2})\s*:\s*(\d{2})/);
  if (!match) return null;
  const [h1, m1, h2, m2] = [+match[1], +match[2], +match[3], +match[4]];
  if ([h1, m1, h2, m2].some((v) => !Number.isFinite(v))) return null;
  if (h1 > 24 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const start = (h1 % 24) * 60 + m1;
  let end = (h2 % 24) * 60 + m2;
  // 24:00 與跨午夜（例如 23:45～00:00）都要往後推一天，才會是正的長度。
  if (h2 === 24) end = DAY_MINUTES;
  if (end <= start) end += DAY_MINUTES;
  return { start, end };
}

/** 兩位數補零的 HH:MM。 */
function clock(minutes: number) {
  const m = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function formatRange(start: number, end: number) {
  return `${clock(start)}～${clock(end)}`;
}

/**
 * 一組時段字串的「單格長度」。取眾數而不是最小值，
 * 避免檔案中偶爾出現一列合併時段就把整份資料判成小格。
 */
export function intervalMinutesOf(hours: Iterable<string>): number {
  const counts = new Map<number, number>();
  for (const hour of hours) {
    const range = parseTimeRange(hour);
    if (!range) continue;
    const length = range.end - range.start;
    if (length <= 0 || length > DAY_MINUTES) continue;
    counts.set(length, (counts.get(length) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [length, count] of counts)
    if (count > bestCount || (count === bestCount && length > best)) {
      best = length;
      bestCount = count;
    }
  return best;
}

export type CoverageBlock = { start: number; end: number };

export type SurveyCoverage = {
  /** 單格長度（分鐘）；無法判斷時為 0 */
  intervalMinutes: number;
  /** 實際有資料的總時間長度（分鐘） */
  coveredMinutes: number;
  /** 連續的調查區塊，例如上午一段、下午一段 */
  blocks: CoverageBlock[];
  /** 是否為「不足 24 小時」的部分時段調查 */
  partial: boolean;
  /** 是否為「小於一小時」的細格資料（尖峰要改用滾動視窗） */
  subHourly: boolean;
};

/** 統計一組時段字串涵蓋了哪些連續區塊、總共多少分鐘。 */
export function surveyCoverage(hours: Iterable<string>): SurveyCoverage {
  const ranges: TimeRange[] = [];
  for (const hour of hours) {
    const range = parseTimeRange(hour);
    if (range) ranges.push(range);
  }
  if (!ranges.length)
    return {
      intervalMinutes: 0,
      coveredMinutes: 0,
      blocks: [],
      partial: false,
      subHourly: false,
    };
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const blocks: CoverageBlock[] = [];
  for (const range of ranges) {
    const last = blocks.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else blocks.push({ start: range.start, end: range.end });
  }
  const coveredMinutes = blocks.reduce((sum, block) => sum + (block.end - block.start), 0);
  const intervalMinutes = intervalMinutesOf(hours);
  return {
    intervalMinutes,
    coveredMinutes,
    blocks,
    partial: coveredMinutes > 0 && coveredMinutes < DAY_MINUTES,
    subHourly: intervalMinutes > 0 && intervalMinutes < 60,
  };
}

/**
 * 一行以內的調查涵蓋標示，給「歷季」各表逐列使用。
 *
 * 歷季各表是跨季度的，一張表裡可能同時有完整 24 小時和只調查幾小時的季度，
 * 所以標題不能再帶時間範圍（「輛/日」對其中一半的列是錯的），
 * 改成中性單位＋這一欄逐列說明。
 *
 * 回傳值刻意做成可排序、可篩選的短字串，讓使用者能在 Excel 的自動篩選裡
 * 一眼把「不足 24 小時」的列挑出來。
 */
export function coverageLabelOf(coverage: SurveyCoverage): string {
  if (!coverage.coveredMinutes) return "無法判定";
  const hours = coverage.coveredMinutes / 60;
  const hoursText = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  if (!coverage.partial) return `完整24小時`;
  const blocks = coverage.blocks
    .map((block) => formatRange(block.start, block.end))
    .join("、");
  return `部分時段 ${hoursText} 小時（${blocks}）`;
}

/**
 * 判斷兩組調查涵蓋能不能直接做平假日差值與百分比。
 *
 * 只看總時數不夠：同樣 4 小時，07:00～09:00＋17:00～19:00 與
 * 08:00～10:00＋18:00～20:00 代表不同時段，直接相減仍會誤導。
 * 因此總分鐘數與每個連續區塊的起訖都必須一致；讀不到時段時不猜。
 */
export function sameSurveyCoverage(
  a: SurveyCoverage,
  b: SurveyCoverage,
): boolean {
  if (!a.coveredMinutes || !b.coveredMinutes) return false;
  if (a.coveredMinutes !== b.coveredMinutes || a.blocks.length !== b.blocks.length)
    return false;
  return a.blocks.every(
    (block, index) =>
      block.start === b.blocks[index]?.start && block.end === b.blocks[index]?.end,
  );
}

/** 以白話說明調查涵蓋範圍，放在「全日交通量」旁邊當備註。 */
export function coverageNote(coverage: SurveyCoverage): string {
  if (!coverage.coveredMinutes) return "";
  const hours = coverage.coveredMinutes / 60;
  const hoursText = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  const blocks = coverage.blocks
    .map((block) => formatRange(block.start, block.end))
    .join("、");
  if (!coverage.partial)
    return `本筆為完整 24 小時調查（${hoursText} 小時）。`;
  return (
    `本筆非 24 小時調查：實際只調查 ${blocks}，合計 ${hoursText} 小時。` +
    `「全日交通量」為上午與下午實際調查時段的加總，不是推估的 24 小時全日量，` +
    `不可直接與完整 24 小時調查的數值比較。`
  );
}

export type PeakEntry = { hour: string; value: number };

export type PeakResult = {
  /** 尖峰小時的流量（與輸入同單位） */
  value: number;
  /** 顯示用的時段字串 */
  label: string;
  /** 起始分鐘數；找不到時為 -1 */
  start: number;
  /** 這個尖峰是由幾個時間格組成 */
  spans: number;
  /** 是否以滾動視窗求得（true）或直接取單一時間格（false） */
  rolling: boolean;
};

const EMPTY_PEAK: PeakResult = { value: 0, label: "—", start: -1, spans: 0, rolling: false };

/**
 * 求尖峰小時流量。
 *
 * - 時間格 ≥ 60 分鐘：沿用原本做法，取流量最大的那一格。
 * - 時間格 < 60 分鐘：取連續、剛好湊滿 windowMinutes（預設 60 分鐘）的
 *   滾動視窗最大值；視窗不會跨越資料的空隙（上午與下午之間不會相連）。
 *   若某一段連續資料湊不滿一小時，則退而取該段的合計，並標示實際時段。
 */
export function rollingPeak(entries: PeakEntry[], windowMinutes = 60): PeakResult {
  const parsed = entries
    .map((entry) => ({ ...entry, range: parseTimeRange(entry.hour) }))
    .filter((entry): entry is PeakEntry & { range: TimeRange } => Boolean(entry.range))
    .sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  if (!parsed.length) return EMPTY_PEAK;

  const intervalMinutes = intervalMinutesOf(entries.map((entry) => entry.hour));
  if (!intervalMinutes || intervalMinutes >= windowMinutes) {
    let best = EMPTY_PEAK;
    for (const entry of parsed)
      if (entry.value > best.value)
        best = {
          value: entry.value,
          label: entry.hour,
          start: entry.range.start,
          spans: 1,
          rolling: false,
        };
    return best;
  }

  const needed = Math.round(windowMinutes / intervalMinutes);
  let best = EMPTY_PEAK;
  for (let index = 0; index < parsed.length; index += 1) {
    let sum = 0;
    let count = 0;
    let cursor = index;
    // 只把「首尾相接」的時間格串起來，遇到空隙就停，
    // 這樣上午最後一格與下午第一格不會被錯誤地併成同一個小時。
    while (cursor < parsed.length && count < needed) {
      if (cursor > index && parsed[cursor].range.start !== parsed[cursor - 1].range.end) break;
      sum += Number(parsed[cursor].value) || 0;
      count += 1;
      cursor += 1;
    }
    if (!count) continue;
    const start = parsed[index].range.start;
    const end = parsed[index + count - 1].range.end;
    const complete = count === needed;
    // 完整的一小時優先；沒有任何完整視窗時才拿不足一小時的區段當結果。
    const better =
      best.spans === 0 ||
      (complete && best.spans < needed) ||
      (complete === best.spans >= needed && sum > best.value);
    if (better)
      best = {
        value: sum,
        label: formatRange(start, end),
        start,
        spans: count,
        rolling: true,
      };
  }
  return best;
}

/** 只取指定時間範圍內的資料再求尖峰（用於上午／下午尖峰）。 */
export function rollingPeakWithin(
  entries: PeakEntry[],
  fromMinutes: number,
  toMinutes: number,
  windowMinutes = 60,
): PeakResult {
  /*
   * 視窗的**頭和尾都要落在範圍內**。
   *
   * 舊版只檢查每一格的起點，滾動視窗卻可以往後串到範圍外：
   * 上午 [05:00, 12:00) 會挑到 11:45 起算的 11:45–12:45，一個大半在下午的
   * 視窗被標成「上午尖峰」，而且和下午 [12:00, …) 挑到的 12:00–13:00
   * 重疊 45 分鐘——同一批車同時算進兩個尖峰。
   *
   * 這裡先把「起點在範圍內」的格子挑出來，再把**結尾超出上界**的格子
   * 也排除掉；rollingPeak 只會串連首尾相接的格子，所以剩下的視窗必然
   * 完整落在 [fromMinutes, toMinutes] 之內。
   */
  const inside = entries.filter((entry) => {
    const range = parseTimeRange(entry.hour);
    if (!range) return false;
    return range.start >= fromMinutes && range.end <= toMinutes;
  });
  return rollingPeak(inside, windowMinutes);
}

/**
 * 從「時段 → 數值」的分桶結果求尖峰。
 *
 * 鍵可以是「07:00～08:00」，也可以是「平日|07:00～08:00」（平日與假日一起看時）。
 * 不同日別各自求自己的尖峰再取大者，滾動視窗不會跨越日別。
 *
 * 這是全系統唯一的尖峰計算入口：儀表板的尖峰卡片、明細表的各方向尖峰、
 * 時段分析面板都走這裡，才不會有的地方算滾動小時、有的地方算單一時間格。
 */
export function peakFromBuckets(
  buckets: Iterable<readonly [string, number]>,
  windowMinutes = 60,
): { label: string; value: number } {
  const byDay = new Map<string, PeakEntry[]>();
  for (const [key, value] of buckets) {
    const cut = key.indexOf("|");
    const day = cut >= 0 ? key.slice(0, cut) : "";
    const hour = cut >= 0 ? key.slice(cut + 1) : key;
    const list = byDay.get(day) ?? [];
    list.push({ hour, value: Number(value) || 0 });
    byDay.set(day, list);
  }
  let best = { label: "—", value: 0 };
  for (const [day, entries] of byDay) {
    const peak = rollingPeak(entries, windowMinutes);
    if (peak.start < 0) continue;
    if (peak.value > best.value)
      best = { label: day ? `${day} ${peak.label}` : peak.label, value: peak.value };
  }
  return best;
}
