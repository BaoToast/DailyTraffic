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
  /*
   * ⚠️ 2026-09-25：這裡**不再**寫 Number.isFinite 檢查。
   *   regex 的 capture 只可能是 \d，`Number("07")` 一定是有限數，
   *   所以那道檢查是**恆真的假檢查**——它讓讀者以為「非數字已經擋掉了」，
   *   而真正在擋的是下一行的範圍檢查。恆真的檢查比沒有檢查更糟：
   *   它會讓下一個人以為這裡已經安全。
   */
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

/** 完全沒有資料（連一格都沒有）→ 沿用既有的「—」。 */
const EMPTY_PEAK: PeakResult = { value: 0, label: "—", start: -1, spans: 0, rolling: false };

/*
 * ══════════════════════════════════════════════════════════════════════
 *  有資料、但湊不出整整一小時 → 標成「資料不足」（2026-09-25 第五輪複查）
 * ══════════════════════════════════════════════════════════════════════
 *
 * v20.84 的 J1 把「湊不滿一小時」改成不給值（正確），但**標籤沿用了「—」**，
 * 而「—」在這個系統裡本來就代表「這一格沒有資料」（手冊第 17 章就是這樣寫的）。
 * 於是同一個符號指兩件事：
 *   ・那一天／那個時段根本沒有調查資料
 *   ・有資料，但格距湊不出整整一小時
 * 使用者看到「—」會判成漏調查而回去翻原始檔，而原因其實在格距。
 *
 * ⚠️ 手冊、README 與更新說明**三份文件都寫著「那一欄會顯示『資料不足』」**，
 *   而那四個字從來沒有真的顯示出來（實測 `assets/index-*.js` 裡只有匯入警告
 *   那一句有它）。這一版把程式改成真的寫出來，三份文件才不是空話。
 *
 * ⚠️ 這裡刻意**只分兩種**，不再細分「45 分鐘」「格距混用」之類：
 *   細分的原因要靠「資料異常檢查」的專用類型去講（調查格距異常／混用），
 *   尖峰欄只要讓使用者知道「不是沒調查，是湊不出一小時」就夠了。
 */
const NOT_ENOUGH_PEAK: PeakResult = {
  value: 0,
  label: "資料不足",
  start: -1,
  spans: 0,
  rolling: false,
};

/**
 * 求尖峰小時流量。
 *
 * 每一格都可以當起點（＝ 15 分鐘步進的滾動搜尋，維持不變），
 * 往後把**首尾相接**的格子串起來，串到**剛好** windowMinutes（預設 60 分鐘）
 * 為止。視窗不會跨越資料的空隙（上午最後一格不會接上下午第一格）。
 * 某一段連續資料整段湊不滿一小時時，**回「資料不足」**（v20.84 的 J1，
 * 使用者 2026-09-24 裁示，與路口轉向對齊）。
 * ⚠️ 這一段原本寫「退而取該段的合計並標示實際時段（會寫成「輛/該時段（45 分鐘）」）」
 *   ——那是 J1 之前的行為，與下面 `minutes !== windowMinutes` 的實作**直接相反**
 *   （2026-09-25 更正）。`cellUnitFor` 仍然存在，但那是給「全調查時段」
 *   這類累計量標單位用的，不是給湊不滿一小時的尖峰視窗用的。
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠️ v20.83：判準由「數格數」改成「累計分鐘數」（使用者 2026-09-24 拍板）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 舊寫法是 `needed = 60 ÷ 眾數格長`，然後**數格數**。格長一致時
 * 數格數＝數分鐘，所以是對的；**格長混用時兩者就脫鉤了**：
 *
 *   ・眾數 60 → needed = 1，於是**任何一格**都被當成一個完整小時。
 *     實測：全日整點每格 100、只有 07–09 拆成 15 分鐘每格 50 的檔案，
 *     真尖峰是 07:00–08:00 的 200，舊版報 00:00–01:00 的 **100**
 *     （少報一半，而且時段完全錯）。
 *   ・眾數 15 → needed = 4，於是**四個整點格**會被串成一個「尖峰小時」。
 *     實測：07–10 每 15 分鐘 50、17–21 每小時 300 的檔案，
 *     真尖峰是 300，舊版報 17:00–21:00 的 **1200**（多報 300%）。
 *
 * 而總量是守恆的，所以任何以總量為基礎的檢查都抓不到。
 *
 * ⚠️ 舊版還有一個「時間格 ≥ 60 分鐘 → 取最大的那一格」的提前分支，
 *   **已經移除**：2 小時一格會讓那一格的 2 小時累計量被放進「尖峰小時」欄位。
 *   現在 2 小時一格串不出剛好 60 分鐘，整段得到「資料不足」——
 *   與姊妹專案路口轉向同一個處理方式（寧可說算不出來，不要給一個看起來正常的錯數字）。
 *
 * ── 為什麼正常資料一個數字都不會變（結構上的，不是碰巧）────────────
 *
 * 格長 d 能整除 60 時（15／20／30／60 都是），「數 60÷d 格」與
 * 「累加到剛好 60 分鐘」**選出來的候選視窗集合完全相同**——同一批候選、
 * 同一組值，取最大當然得到同一個答案，與值的分布無關。
 * 兩者只在 d 不能整除 60、d 超過 60、或格長混用時才不同，
 * 而那三種情形舊版都是錯的。
 * 實測使用者的 10 份真實量測檔（全日交通量 5 份 60 分鐘格、
 * 路口轉向 5 份 15 分鐘格）：**10 份數字全部相同、0 份不同**。
 *
 * ⚠️ 單格就湊滿一小時時，label **照抄原字串**、`rolling` 維持 false。
 *   改成 formatRange() 會把「07:00~08:00」重寫成「07:00～08:00」——
 *   那個字串會進畫面的「尖峰時段」欄與 Excel，看起來只是全形半形之差，
 *   但它是既有輸出的一部分，沒有理由動它。
 */
export function rollingPeak(entries: PeakEntry[], windowMinutes = 60): PeakResult {
  const parsed = entries
    .map((entry) => ({ ...entry, range: parseTimeRange(entry.hour) }))
    .filter((entry): entry is PeakEntry & { range: TimeRange } => Boolean(entry.range))
    .sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  if (!parsed.length) return EMPTY_PEAK;
  /*
   * 有格子進來了，所以「找不到視窗」一定是湊不出整整一小時
   * （45 分鐘一格、2 小時一格、或中間有斷點）——那要與「沒有資料」分開講。
   */
  const notEnough = NOT_ENOUGH_PEAK;

  let best = notEnough;
  for (let index = 0; index < parsed.length; index += 1) {
    let sum = 0;
    let count = 0;
    let minutes = 0;
    let cursor = index;
    // 只把「首尾相接」的時間格串起來，遇到空隙就停，
    // 這樣上午最後一格與下午第一格不會被錯誤地併成同一個小時。
    while (cursor < parsed.length && minutes < windowMinutes) {
      if (cursor > index && parsed[cursor].range.start !== parsed[cursor - 1].range.end) break;
      const length = parsed[cursor].range.end - parsed[cursor].range.start;
      if (length <= 0) break;
      /*
       * ⚠️ 「加下去會超過一小時」就**停在這裡**，不要加進去再整段丟掉。
       *
       *   第一版寫成「先加、加完發現超過就整段 continue」，結果 45 分鐘一格
       *   時每一個起點都會多吃一格（45＋45＝90 > 60）而被整段丟掉，
       *   只有**最後一格**（後面沒有東西可加）能存活——於是回報的「尖峰」
       *   其實是最後那一格，不是最大的那一格。各格量相同時看不出來，
       *   量不同時就是錯的。實測抓到的，不是推論。
       *
       *   ⚠️ 一格本身就超過一小時（2 小時一格）時，這裡連第一格都不會加，
       *   於是 count 是 0、整個起點被跳過 → 整段得到「資料不足」，
       *   而不是把 2 小時的累計量放進尖峰欄位。那是刻意的。
       */
      if (minutes + length > windowMinutes) break;
      minutes += length;
      sum += Number(parsed[cursor].value) || 0;
      count += 1;
      cursor += 1;
    }
    /*
     * ══════════════════════════════════════════════════════════════
     *  ⚠️ 2026-09-25：湊不滿 60 分鐘一律跳過（使用者裁示，與路口轉向對齊）
     * ══════════════════════════════════════════════════════════════
     *
     * 舊寫法是「湊滿的優先；一個都沒有時才退回不足一小時的區段」，
     * 於是同樣一筆只有 45 分鐘的連續區塊：
     *   ・全日交通量 → 給那 45 分鐘的合計（單位寫「輛/該時段（45 分鐘）」）
     *   ・路口轉向   → 回「資料不足」
     * 兩邊都沒有說謊，但「三支同一口徑」是使用者定下的規矩。
     *
     * 使用者 2026-09-24 原話：「口徑請對齊，以路口轉向那個保守作法為主。」
     * 所以這裡改成與路口轉向的 rollingPeak 相同：
     *   `if (minutes !== windowMinutes || !slice.length) continue;`
     *
     * ⚠️ 代價要說清楚：整份調查本來就只做 45 分鐘的使用者，
     *   從此在尖峰小時欄看到「資料不足」。這是使用者裁示的結果，
     *   **不要好心加回來**。
     *   ⚠️ 2 小時一格的資料本來就回「資料不足」（加第一格就超過 60 分鐘），
     *   這一次的改動不影響那個行為。
     */
    if (!count || minutes !== windowMinutes) continue;
    const start = parsed[index].range.start;
    const end = parsed[index + count - 1].range.end;
    if (best.spans === 0 || sum > best.value)
      best = {
        value: sum,
        /* 單格就湊滿時照抄原字串，理由見上面的說明。 */
        label: count === 1 ? parsed[index].hour : formatRange(start, end),
        start,
        spans: count,
        rolling: count > 1,
      };
  }
  return best;
}

/**
 * **指定的那一個視窗**裡有多少量——不是自己再挑一次尖峰。
 *
 * ⚠️ 這一支存在的理由：把一個尖峰小時拆成各方向時，每個方向都必須在
 *   **同一個視窗**裡取值，否則各方向加起來不等於那個尖峰小時的合計。
 *   v20.67 就是讓每個方向各自挑自己的尖峰，實測 2,792.5（方向A，17:00）
 *   ＋3,454（方向B，07:00）＝6,246.5，而合計那一格寫 6,164.5（07:00）——
 *   三個數字並排、標籤還寫「同時段」，讀的人一定會相加。
 *
 * 回傳型別與 rollingPeak 相同，呼叫端不必分兩種處理。
 */
export function valueInWindow(
  entries: PeakEntry[],
  startMinutes: number,
  windowMinutes = 60,
): PeakResult {
  return rollingPeakWithin(
    entries,
    startMinutes,
    startMinutes + windowMinutes,
    windowMinutes,
  );
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
 * 從「時段 → 數值」的分桶結果，求**每一個日別各自的**尖峰。
 *
 * 鍵可以是「07:00～08:00」，也可以是「平日|07:00～08:00」。
 * 滾動視窗不會跨越日別——平日的最後一格與假日的第一格不會被串成一小時。
 *
 * ⚠️ 之所以把「逐日別」抽出來，是因為畫面上有兩種需求：
 *   ・尖峰卡片要**平日與假日各一個數字**（與全日交通量、24小時PCU 一致）
 *   ・有些地方只要「最大的那一個」
 *   兩者一定要是同一套計算，否則「卡片上的平日尖峰」與
 *   「整體尖峰剛好是平日」會出現兩個不同的數字。
 */
export function peaksByDay(
  buckets: Iterable<readonly [string, number]>,
  windowMinutes = 60,
): {
  day: string;
  label: string;
  value: number;
  start: number;
  /** 有資料但湊不出整整一小時（說明見函式內的宣告）。 */
  notEnough?: true;
}[] {
  const byDay = new Map<string, PeakEntry[]>();
  for (const [key, value] of buckets) {
    const cut = key.indexOf("|");
    const day = cut >= 0 ? key.slice(0, cut) : "";
    const hour = cut >= 0 ? key.slice(cut + 1) : key;
    const list = byDay.get(day) ?? [];
    list.push({ hour, value: Number(value) || 0 });
    byDay.set(day, list);
  }
  const out: {
    day: string;
    label: string;
    value: number;
    start: number;
    /**
     * `true` ＝ 這個日別有資料，但湊不出整整一小時（45 分鐘一格、2 小時一格、
     * 或中間有斷點）。
     *
     * ⚠️ 2026-09-25 第六輪獨立複查抓到：原本這種日別直接 `continue` 掉，
     *   於是呼叫端只看得到「沒有這個日別」，一律落回「—」與 **0**。
     *   `rollingPeak()` 那一版把標籤分成「—」與「資料不足」，但**產品端
     *   在讀 label 之前就用 `start < 0` 把整筆丟掉了**——標籤等於沒有人讀。
     *   現在把它帶出來，呼叫端才分得出「沒調查」與「湊不出一小時」。
     */
    notEnough?: true;
  }[] = [];
  for (const [day, entries] of byDay) {
    const peak = rollingPeak(entries, windowMinutes);
    if (peak.start < 0) {
      /*
       * 有格子、只是湊不出整整一小時 → 要講出來，不可以靜靜消失。
       *
       * ⚠️ 判準是「這個日別**有沒有時間格**」，不是「有沒有量到車」。
       *   （2026-09-26 抓到：原本寫 `entries.some((entry) => value > 0)`。）
       *   45 分鐘一格、而且那幾格**都量到 0 輛**時，entries 有東西、
       *   卻沒有一格大於 0，於是這裡什麼都不推，呼叫端只好落回「—」；
       *   而「—」在這個系統裡代表「沒有這個日別的資料」。
       *   實際情況是資料在、只是格距湊不出一小時，該寫的是「資料不足」。
       *   兩者對使用者的意思完全不同：前者要去補調查，後者要去看原始檔的時間欄。
       *
       * ⚠️ 「entries 是空的」不會走到這裡：byDay 是從實際的分桶結果建的，
       *   一列都沒有的日別根本不會出現在 byDay 裡。所以用 `length > 0`
       *   不會把「完全沒調查」誤標成「資料不足」。
       * ⚠️ 量到 0 輛是**真實的測量值**，不是「沒有資料」——
       *   與報告草稿「讀不到寫『—』、真實 0 照樣寫 0」同一條原則。
       */
      if (entries.length > 0)
        out.push({ day, label: "資料不足", value: 0, start: -1, notEnough: true });
      continue;
    }
    /*
     * ⚠️ start（起始分鐘）一定要回傳出去。
     *
     * 各方向的量必須在**同一個視窗**裡取，才加得起來等於合計。
     * 只回 label 的話，呼叫端只能讓每個方向各自再挑一次尖峰——
     * 那正是 v20.67 的錯：方向A 挑到 17:00–18:00、方向B 挑到 07:00–08:00，
     * 兩個數字加起來不等於旁邊那一列「全部方向同時段合計」，
     * 而三者並排、標籤又寫「同時段」，讀的人一定會相加。
     */
    out.push({ day, label: peak.label, value: peak.value, start: peak.start });
  }
  return out;
}

/**
 * 從「時段 → 數值」的分桶結果求尖峰——**取最大的那一個日別**。
 *
 * 儀表板的尖峰卡片、明細表的各方向尖峰、歷季趨勢都走這裡。
 *
 * ⚠️ 2026-09-25 第六輪獨立複查更正：這裡原本寫「**全系統唯一**的尖峰計算入口…
 *   時段分析面板也走這裡」——**時段車種分析走的是 `app/period-analysis.ts`
 *   自己的 `peakWindow()`**，從來沒有 import 過這一支。那句話正是
 *   「同一個畫面兩個尖峰答案」這個缺陷長期沒被發現的掩護。
 *   兩邊現在都以「累計到剛好 60 分鐘」為準（`peakWindow` 已改成只有
 *   **整份都是 60 分鐘一格**時才走取單格那條路），但它們仍是兩份實作，
 *   由 `tests/peak-hour-contract.test.mjs` 與
 *   `tests/period-analysis.test.mjs` 的產品入口測試共同釘住。
 */
export function peakFromBuckets(
  buckets: Iterable<readonly [string, number]>,
  windowMinutes = 60,
): {
  label: string;
  value: number;
  /**
   * `"ok"` ＝ 真的算出一個尖峰小時；
   * `"not-enough"` ＝ 有資料但湊不出整整一小時（label 是「資料不足」）；
   * `"none"` ＝ 完全沒有資料（label 是「—」）。
   *
   * ⚠️ 呼叫端**必須**看這一欄再決定要不要把 `value` 當成數字用：
   *   `"not-enough"` 與 `"none"` 的 `value` 都是 0，而那個 0 不是「量到 0」。
   *   把它當數字寫進 Excel、折線圖或異常比較，就會憑空產生資料
   *   （第六輪抓到三處：可追溯明細寫 0、歷季趨勢多一個 0 的點、
   *     「尖峰時段位移」把它當成 00 時而噴出假警示）。
   */
  status: "ok" | "not-enough" | "none";
} {
  /*
   * ⚠️ 一定要走 peaksByDay()，不可以在這裡再寫一次分日與滾動視窗。
   *   兩份實作遲早會分岔，而分岔的症狀是「卡片上的尖峰」與
   *   「明細表的尖峰」對不起來——兩個數字各自都合理，合起來卻不是同一件事。
   */
  let best: { label: string; value: number; status: "ok" | "not-enough" | "none" } = {
    label: "—",
    value: 0,
    status: "none",
  };
  let notEnough = false;
  for (const peak of peaksByDay(buckets, windowMinutes)) {
    if (peak.notEnough) {
      notEnough = true;
      continue;
    }
    if (best.status !== "ok" || peak.value > best.value)
      best = {
        label: peak.day ? `${peak.day} ${peak.label}` : peak.label,
        value: peak.value,
        status: "ok",
      };
  }
  /*
   * 有任何一個日別算得出來就以它為準（那才是真的尖峰）；
   * 全部日別都湊不出一小時時，才回「資料不足」。
   */
  if (best.status !== "ok" && notEnough)
    return { label: "資料不足", value: 0, status: "not-enough" };
  return best;
}
