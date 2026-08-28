export type ParserDayType = "平日" | "假日";

export type ParsedTrafficRow = {
  quarter: string;
  roadId: string;
  roadName: string;
  dayType: ParserDayType;
  directionCode: string;
  directionName: string;
  hour: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  surveyType: "road" | "intersection";
  turnData?: TurnCounts;
  vehicleCounts?: VehicleCounts;
  vehicleLabels?: VehicleLabels;
  /** 目的支線分欄格式才有：各車種往各支線的車輛數 */
  destinationCounts?: DestinationCounts;
  sourceFileName?: string;
  sourceSheetName?: string;
  sourceRow?: number;
  sourceRange?: string;
};

export type TurnKey = "left" | "through" | "right";
export type CoreVehicleKey = "motorcycle" | "small" | "large" | "special";
export type VehicleKey = string;
export type VehicleCounts = Record<VehicleKey, number>;
export type VehicleLabels = Record<VehicleKey, string>;
export type TurnCounts = Record<VehicleKey, Record<TurnKey, number>>;
/**
 * 「往B、往C…」這種以目的支線分欄的調查表，先原樣保存各目的地的車輛數。
 * 左轉／直進／右轉要靠路口幾何才判斷得出來，所以在匯入時再依各支線角度分類。
 */
export type DestinationCounts = Record<VehicleKey, Record<string, number>>;

type ParseIdentity = { roadId: string; roadName: string; a: string; b: string };

export const coreVehicleLabels: Record<CoreVehicleKey, string> = {
  motorcycle: "機車",
  small: "小型車",
  large: "大型車",
  special: "特種車",
};
const vehicleKeys: Record<string, CoreVehicleKey> = {
  機車: "motorcycle",
  小型車: "small",
  大型車: "large",
  特種車: "special",
};

function emptyTurns(): TurnCounts {
  return {
    motorcycle: { left: 0, through: 0, right: 0 },
    small: { left: 0, through: 0, right: 0 },
    large: { left: 0, through: 0, right: 0 },
    special: { left: 0, through: 0, right: 0 },
  };
}

/**
 * 從原始儲存格讀出一格車輛數——**全系統只有這一支**。
 *
 * 為什麼要四捨五入成整數（v20.33）：
 * 使用者的部分調查檔，儲存格裡存的是小數（0.36、5.5506、13.3431…），
 * 而 Excel 的儲存格格式把它顯示成整數。於是**報告上看到 0 與 6，
 * 程式拿去算的卻是 0.36 與 5.5506**——全日車輛數會算出「27,988.79 輛」
 * 這種不存在的車，PCU 也跟著帶小數。使用者決定以「畫面上看到的整數」為準。
 *
 * 放在這裡的理由：這是整個匯入流程唯一把儲存格變成數字的地方，
 * 之後的加總、尖峰滾動、PCU 換算、全日累計全部自動吃到整數，
 * 不必在下游各補一次（補在下游就會變成同一件事在 N 個地方各做各的）。
 *
 * 「--」「－」這類代表「該轉向不存在」的字串，Number() 會得到 NaN，一律當成 0
 * ——這是舊有行為，沒有改變。
 *
 * ⚠️ 姊妹系統「路口轉向」v2.1.30 已採同一條規則，兩套系統對同一份調查檔
 *    才會算出同一組數字（實測 15 項全部一致）。
 */
export function cellCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export function normalizeVehicleLabel(value: unknown): string {
  const label = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .trim();
  if (!label) return "";
  if (/^(?:機車|機踏車|機動車)$/.test(label)) return "機車";
  if (/^小型車/.test(label)) return "小型車";
  if (/^大型車/.test(label)) return "大型車";
  if (/^特種車/.test(label)) return "特種車";
  if (
    /(?:車|巴士)$/.test(label) &&
    !/^(?:車種|車流|車道|車輛|各車種|總車|交通量)$/.test(label)
  )
    return label;
  return "";
}

function normalizeVehicleHeaderCandidate(value: unknown): string {
  const known = normalizeVehicleLabel(value);
  if (known) return known;
  const label = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .trim();
  if (
    !label ||
    /^(?:時間|時段|方向|車種|車流|車道|車輛|各車種|總車|交通量|合計|總計|小計|左轉|右轉|直進|直行|駛入|駛出)$/.test(
      label,
    )
  )
    return "";
  if (/^\d{1,2}:\d{2}/.test(label) || /^方向[A-Z]$/i.test(label)) return "";
  // 未收錄但位於已確認車種表頭列的文字，先保留成原始車種；匯入流程會要求使用者確認分類與係數。
  return label;
}

export function vehicleKeyForLabel(label: string): VehicleKey {
  return vehicleKeys[label] ?? `custom:${label}`;
}

export function vehicleLabelForKey(
  key: VehicleKey,
  labels?: VehicleLabels,
): string {
  return (
    labels?.[key] ??
    coreVehicleLabels[key as CoreVehicleKey] ??
    key.replace(/^custom:/, "")
  );
}

/**
 * 從表頭區找出每一個「路口編號：路口X」所在的欄位。
 *
 * 為什麼需要這個：原始調查表常把好幾個路口**並排在同一張工作表**
 * （路口A 在 B 欄、路口B 在 Q 欄、路口C 在 AF 欄…）。
 * 舊寫法是靠「車種標題重複的週期」去猜每個路口佔幾欄——各路口的車種
 * 標題一模一樣時猜得對，但只要有一個路口用了不同的車種名稱
 * （實際遇到：路口A、B 寫「大型車／特種車」，路口C、D 卻寫「大貨車／大客車」），
 * 週期就不成立，`repeatedVehicleCount` 退回「整列都是同一組」，於是
 * **四個路口的欄位被當成一個路口**：只產生一筆紀錄，而且那一筆的車輛數是
 * 四個路口相加（實測 57＋4＋90＋4＝155 全部記在路口A 底下）。
 * 數字看起來合理，匯入照樣報成功，畫面上完全看不出來。
 *
 * 而「路口編號：路口X」本來就寫在檔案裡，是權威的分界線。
 * 有它就照它切，不要用猜的。
 */
function armMarkerColumns(
  values: unknown[][],
  headerIndex: number,
): { code: string; index: number }[] {
  const found: { code: string; index: number }[] = [];
  for (const row of values.slice(0, Math.max(headerIndex, 1))) {
    row.forEach((cell, index) => {
      const text = String(cell ?? "")
        .normalize("NFKC")
        .replace(/[\s\u3000]/g, "");
      const match = text.match(/^路口編號[:：](?:路口)?([A-Za-z])$/);
      if (match) found.push({ code: match[1].toUpperCase(), index });
    });
    if (found.length) break;
  }
  return found.sort((a, b) => a.index - b.index);
}

function repeatedVehicleCount(labels: string[]) {
  for (let size = 1; size <= Math.floor(labels.length / 2); size += 1) {
    if (labels.length % size) continue;
    const pattern = labels.slice(0, size);
    if (labels.every((label, index) => label === pattern[index % size]))
      return size;
  }
  return labels.length;
}

/** 「往B」「往路口B」「→B」等目的支線標題，取出支線代碼；不是的話回傳空字串。 */
export function destinationCodeOf(value: unknown): string {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "");
  const match = text.match(/^(?:往|→|->|至)(?:路口)?([A-Za-z])$/);
  return match ? match[1].toUpperCase() : "";
}

/** 從表頭區找出這張工作表屬於哪一條支線，例如「路口編號：A」「路口編號：路口C」。 */
export function armCodeOf(values: unknown[][], sheetName = ""): string {
  for (const row of values.slice(0, 12))
    for (const cell of row) {
      const text = String(cell ?? "")
        .normalize("NFKC")
        .replace(/[\s　]/g, "");
      const match = text.match(/^路口編號[:：](?:路口)?([A-Za-z])$/);
      if (match) return match[1].toUpperCase();
    }
  const fromName = String(sheetName ?? "")
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .match(/^路口[（(]?([A-Za-z])[)）]?$/);
  return fromName ? fromName[1].toUpperCase() : "";
}

/** 從表頭區找出日別；抓不到時回傳空字串。 */
export function dayTypeOf(values: unknown[][]): ParserDayType | "" {
  for (const row of values.slice(0, 12))
    for (const cell of row) {
      const text = String(cell ?? "");
      if (text.includes("假日")) return "假日";
      if (text.includes("平日")) return "平日";
    }
  return "";
}

export function parseTrafficSheetValues(
  values: unknown[][],
  dayType: ParserDayType,
  quarter: string,
  identity: ParseIdentity,
  source?: { fileName?: string; sheetName?: string },
): ParsedTrafficRow[] {
  const headerIndex = values.findIndex(
    (row) => row.filter((value) => normalizeVehicleLabel(value)).length >= 4,
  );
  if (headerIndex < 0) return [];
  const columns = values[headerIndex]
    .map((value, index) => ({
      label: normalizeVehicleHeaderCandidate(value),
      index,
    }))
    .filter((column): column is { label: string; index: number } =>
      Boolean(column.label),
    );
  const firstDataColumn = Math.min(...columns.map((column) => column.index));
  const nearbyHeaders = values
    .slice(Math.max(0, headerIndex - 5), headerIndex + 2)
    .flat()
    .map((value) => String(value).normalize("NFKC").replace(/\s+/g, ""));
  const isIntersection =
    ["左轉", "右轉"].every((marker) =>
      nearbyHeaders.some((value) => value.includes(marker)),
    ) && nearbyHeaders.some((value) => /直進|直行/.test(value));
  // ── 目的支線分欄格式（七叉路口常見）─────────────────────────
  // 表頭下一列寫的是「往B、往C、往D…」而不是「左轉、直進、右轉」，
  // 而且一張工作表只放一條支線。這種檔案要保留各目的地的車輛數，
  // 左轉／直進／右轉留到匯入時再依路口幾何分類。
  const subHeader = values[headerIndex + 1] ?? [];
  const destinationColumns = subHeader
    .map((value, index) => ({ code: destinationCodeOf(value), index }))
    .filter((item) => item.code);
  if (destinationColumns.length >= 2) {
    const armCode = armCodeOf(values, source?.sheetName);
    if (armCode)
      return parseDestinationSheet(values, {
        headerIndex,
        columns,
        destinationColumns,
        armCode,
        dayType,
        quarter,
        identity,
        source,
      });
  }

  /*
   * 先照檔案自己寫的「路口編號」切；沒有那個標記時才退回舊的週期推測。
   * 兩條路徑對「各路口車種一致」的檔案結果相同（已用回歸測試釘住）。
   */
  const markers = armMarkerColumns(values, headerIndex);
  let groups: { label: string; index: number }[][] = [];
  if (markers.length >= 2) {
    groups = markers.map((marker, order) => {
      const end = markers[order + 1]?.index ?? Number.POSITIVE_INFINITY;
      return columns.filter(
        (column) => column.index >= marker.index && column.index < end,
      );
    });
    /* 有標記卻切不出欄位的話不要硬幹，退回舊路徑比較安全。 */
    if (groups.some((group) => !group.length)) groups = [];
  }
  if (!groups.length) {
    const vehicleCount = repeatedVehicleCount(
      columns.map((column) => column.label),
    );
    const directionCount = Math.floor(columns.length / vehicleCount);
    if (
      !vehicleCount ||
      !directionCount ||
      vehicleCount * directionCount !== columns.length
    )
      return [];
    groups = Array.from({ length: directionCount }, (_unused, order) =>
      columns.slice(order * vehicleCount, order * vehicleCount + vehicleCount),
    );
  }
  const parsed: ParsedTrafficRow[] = [];

  for (
    let rowIndex = headerIndex + 1;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row = values[rowIndex];
    const hour =
      row
        .slice(0, firstDataColumn)
        .map(String)
        .find((value) =>
          /*
           * 時段格式要跟系統其他地方一樣寬鬆。
           *
           * 這裡原本只認兩位數小時與三種分隔符。真實原始檔常見
           * 「8:00～9:00」（單位數）與被 Word 自動改成 en dash 的
           * 「09:00–10:00」，兩者都會在這裡被判定成「不是時段」而
           * 整列丟掉——實測 5 列 550 輛只讀進 110 輛，而且匯入報告
           * 完全不會提到有資料被略過。
           * parseTimeRange 與 parseDestinationSheet 早就用寬鬆版了。
           */
          /^\d{1,2}\s*:\s*\d{2}\s*[～~\-—–至到]\s*\d{1,2}\s*:\s*\d{2}$/.test(
            value.trim().normalize("NFKC"),
          ),
        )
        ?.trim() ?? "";
    if (!hour) continue;
    for (
      let directionIndex = 0;
      directionIndex < groups.length;
      directionIndex += 1
    ) {
      const group = groups[directionIndex];
      const turnData = emptyTurns();
      const vehicleLabels: VehicleLabels = {};
      const vehicleCounts: VehicleCounts = {};
      /*
       * 合併儲存格造成的重複車種標題，必須當成「這一車種的左／直／右三欄」。
       *
       * 原始檔的車種標題常因合併儲存格而在三個轉向欄都留下同樣的文字
       *（機車｜機車｜機車｜小型車｜小型車｜小型車…）。舊寫法把每一欄都當成
       * 獨立的一個車種：nextColumn 變成緊鄰的下一欄，於是三格的轉向切片只切
       * 到一格——全部被記成左轉；而 vehicleCounts[key] 是直接指派不是累加，
       * 只留下最後一欄。實測 105 輛變成 48 輛（少 54%），且每一輛都被歸成
       * 左轉，連帶把轉向 PCU 與整個駛入推導全部算錯。
       * 這裡先把「連續同一車種」的欄位收成一組再處理。
       */
      const runs: { key: string; label: string; indexes: number[] }[] = [];
      group.forEach((column) => {
        const key = vehicleKeyForLabel(column.label);
        const last = runs[runs.length - 1];
        if (last && last.key === key) last.indexes.push(column.index);
        else runs.push({ key, label: column.label, indexes: [column.index] });
      });
      runs.forEach((run, runIndex) => {
        const key = run.key;
        vehicleLabels[key] = run.label;
        const nextColumn =
          runs[runIndex + 1]?.indexes[0] ??
          groups[directionIndex + 1]?.[0]?.index ??
          row.length;
        const firstIndex = run.indexes[0];
        let count = cellCount(row[firstIndex]);
        if (isIntersection) {
          // 同一車種佔了三欄＝那三欄就是左／直／右；只佔一欄的舊格式才
          // 沿用「從這一欄往後切三格」的推測。
          const turnValues =
            run.indexes.length >= 3
              ? run.indexes
                  .slice(0, 3)
                  .map((cellIndex) => cellCount(row[cellIndex]))
              : row
                  .slice(firstIndex, Math.min(firstIndex + 3, nextColumn))
                  .map((cell) => cellCount(cell));
          turnData[key] = {
            left: turnValues[0] || 0,
            through: turnValues[1] || 0,
            right: turnValues[2] || 0,
          };
          count = turnValues.reduce((sum, value) => sum + value, 0);
        } else if (run.indexes.length > 1) {
          // 路段格式若也出現重複標題，三欄要相加而不是只取最後一欄。
          count = run.indexes.reduce(
            (sum, cellIndex) => sum + cellCount(row[cellIndex]),
            0,
          );
        }
        vehicleCounts[key] = (vehicleCounts[key] || 0) + count;
      });
      const directionCode = String.fromCharCode(65 + directionIndex);
      parsed.push({
        quarter,
        roadId: identity.roadId,
        roadName: identity.roadName,
        dayType,
        directionCode,
        // 調查表記錄的是「從這條支線開進路口」的車流，也就是以該支線為起點，
        // 所以叫「駛出路口A」。以該支線為終點（別的支線開進 A）另有一個視角，
        // 由 intersection-flow 依轉向推導，顯示為「駛入路口A」。
        directionName: isIntersection
          ? `駛出路口${directionCode}`
          : directionIndex === 0
            ? identity.a
            : directionIndex === 1
              ? identity.b
              : // 路段檔通常只有兩個方向；欄位分成三組以上時，
                // 第三組之後沿用「方向C、方向D…」才不會全部叫同一個名字
                `方向${directionCode}`,
        hour,
        motorcycle: vehicleCounts.motorcycle || 0,
        small: vehicleCounts.small || 0,
        large: vehicleCounts.large || 0,
        special: vehicleCounts.special || 0,
        surveyType: isIntersection ? "intersection" : "road",
        turnData: isIntersection ? turnData : undefined,
        vehicleCounts,
        vehicleLabels,
        sourceFileName: source?.fileName,
        sourceSheetName: source?.sheetName,
        sourceRow: rowIndex + 1,
        sourceRange: `R${rowIndex + 1}C${firstDataColumn + 1}:R${rowIndex + 1}C${group.at(-1)!.index + (isIntersection ? 3 : 1)}`,
      });
    }
  }
  return parsed;
}

type DestinationParseOptions = {
  headerIndex: number;
  columns: { label: string; index: number }[];
  destinationColumns: { code: string; index: number }[];
  armCode: string;
  dayType: ParserDayType;
  quarter: string;
  identity: ParseIdentity;
  source?: { fileName?: string; sheetName?: string };
};

/**
 * 解析「一張工作表 = 一條支線，欄位是各目的支線」的路口轉向調查表。
 *
 * 版面長這樣（表頭兩列）：
 *   時間 | 機車                        | 小型車                      | …
 *        | 往B 往C 往D 往E 往F 往G     | 往B 往C 往D 往E 往F 往G     | …
 *
 * 每一種車種底下都重複同一組目的支線，所以以「車種標題所在欄」為界，
 * 把該區間內的目的支線欄位收進這個車種。支線數量不限，三叉到七叉都適用。
 */
function parseDestinationSheet(
  values: unknown[][],
  options: DestinationParseOptions,
): ParsedTrafficRow[] {
  const {
    headerIndex,
    columns,
    destinationColumns,
    armCode,
    dayType,
    quarter,
    identity,
    source,
  } = options;
  const firstDataColumn = Math.min(...columns.map((column) => column.index));
  // 用「目的支線的重複週期」切車種，而不是用車種標題的位置。
  // 實際檔案的車種標題常因合併儲存格而殘留重複文字（例如大型車出現三次），
  // 只靠標題位置切會把某個車種的欄位切成兩半、又蓋掉別的車種。
  const cycle: string[] = [];
  for (const destination of destinationColumns) {
    if (cycle.includes(destination.code)) break;
    cycle.push(destination.code);
  }
  const cycleSize = cycle.length || destinationColumns.length;
  const groups: {
    key: VehicleKey;
    label: string;
    destinations: { code: string; index: number }[];
  }[] = [];
  for (
    let offset = 0;
    offset + cycleSize <= destinationColumns.length;
    offset += cycleSize
  ) {
    const destinations = destinationColumns.slice(offset, offset + cycleSize);
    const from = destinations[0].index;
    const to = destinations.at(-1)!.index;
    const inside = columns.find(
      (column) => column.index >= from && column.index <= to,
    );
    const before = [...columns]
      .filter((column) => column.index <= from)
      .sort((a, b) => b.index - a.index)[0];
    const label =
      inside?.label || before?.label || `車種${groups.length + 1}`;
    groups.push({ key: vehicleKeyForLabel(label), label, destinations });
  }
  const parsed: ParsedTrafficRow[] = [];
  for (
    let rowIndex = headerIndex + 2;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const row = values[rowIndex];
    const hour =
      row
        .slice(0, firstDataColumn)
        .map(String)
        .find((value) =>
          /*
           * 和主路徑用同一個寬鬆版：要 NFKC 正規化（Word 貼過來的全形數字
           * 與全形冒號「０７：００」會被轉成半形），也要允許冒號兩側有空白
           * （「7 : 00～8 : 00」）。
           * 舊版這裡是嚴格版，於是七叉路口那種「一條支線一張工作表」的檔案，
           * 只要時間欄是全形就整張表讀成 0 筆，整體不會報錯，只是少了一條
           * 支線，匯入報告也不會提到——正是上面那段註解說要防的症狀。
           */
          /^\d{1,2}\s*:\s*\d{2}\s*[～~\-—–至到]\s*\d{1,2}\s*:\s*\d{2}$/.test(
            value.trim().normalize("NFKC"),
          ),
        )
        ?.trim() ?? "";
    if (!hour) continue;
    const destinationCounts: DestinationCounts = {};
    const vehicleCounts: VehicleCounts = {};
    const vehicleLabels: VehicleLabels = {};
    for (const group of groups) {
      if (!group.destinations.length) continue;
      vehicleLabels[group.key] = group.label;
      const perDestination: Record<string, number> = {};
      let total = 0;
      for (const destination of group.destinations) {
        // 「--」「－」等代表該轉向不存在，cellCount 會把 NaN 當成 0。
        const count = cellCount(row[destination.index]);
        perDestination[destination.code] =
          (perDestination[destination.code] ?? 0) + count;
        total += count;
      }
      destinationCounts[group.key] = perDestination;
      vehicleCounts[group.key] = (vehicleCounts[group.key] ?? 0) + total;
    }
    if (!Object.keys(vehicleCounts).length) continue;
    parsed.push({
      quarter,
      roadId: identity.roadId,
      roadName: identity.roadName,
      dayType,
      directionCode: armCode,
      directionName: `駛出路口${armCode}`,
      hour,
      motorcycle: vehicleCounts.motorcycle || 0,
      small: vehicleCounts.small || 0,
      large: vehicleCounts.large || 0,
      special: vehicleCounts.special || 0,
      surveyType: "intersection",
      vehicleCounts,
      vehicleLabels,
      destinationCounts,
      sourceFileName: source?.fileName,
      sourceSheetName: source?.sheetName,
      sourceRow: rowIndex + 1,
      sourceRange: `R${rowIndex + 1}C${firstDataColumn + 1}:R${rowIndex + 1}C${
        (destinationColumns.at(-1)?.index ?? firstDataColumn) + 1
      }`,
    });
  }
  return parsed;
}

/*
 * ────────────────────────────────────────────────────────────────
 *  對 xlsx（SheetJS 0.18.5）上游安全警示的實際處置
 * ────────────────────────────────────────────────────────────────
 *
 * npm 上的 xlsx 停在 0.18.5，那一版有一則原型污染的警示，而修正版只發在
 * SheetJS 自己的 CDN，npm 上沒有可以直接升上去的版本（`npm audit` 也回報
 * fixAvailable: false）。
 *
 * 「請只匯入可信來源的調查檔」本身沒錯，但那是把責任推回使用者，而這支
 * 程式的使用情境正好是「收別人給的調查檔」。所以在我們自己的邊界做兩件
 * 做得到的事：
 *
 *  1. 解析時關掉用不到的解析路徑。這支程式只讀儲存格的值，公式、內嵌
 *     HTML 與 VBA 巨集一個都不需要，關掉就少一片攻擊面。
 *  2. 解析前後各拍一次 Object.prototype 的自有屬性清單。攻擊要生效一定
 *     得先污染成功，污染成功就一定看得到差異：把多出來的屬性刪掉、中止
 *     這次匯入，並明講是哪一個檔案、多了什麼。安靜地清掉更危險——
 *     使用者會以為那個檔案沒問題。
 *
 * 這不能取代升級，但它把「無聲被污染」變成「當場中止並告知」。
 */
export const SAFE_XLSX_READ_OPTIONS = {
  type: "array",
  cellDates: true,
  cellFormula: false,
  cellHTML: false,
  bookVBA: false,
} as const;

/** 解析前先記下 Object.prototype 目前有哪些自有屬性。 */
export function prototypeFingerprint(): string[] {
  return Object.getOwnPropertyNames(Object.prototype);
}

/**
 * 解析後比對；多出來的屬性代表這個檔案動到了原型。
 * 回傳多出來的屬性名稱（已經刪掉），沒有就是空陣列。
 */
export function detectPrototypePollution(before: string[]): string[] {
  const known = new Set(before);
  const added = Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => !known.has(name),
  );
  for (const name of added) {
    try {
      delete (Object.prototype as unknown as Record<string, unknown>)[name];
    } catch {
      /* 刪不掉也要照樣往下報告，不能因此吞掉警告 */
    }
  }
  return added;
}

/** 解析後立刻呼叫；被污染就丟例外中止匯入。 */
export function assertNoPrototypePollution(
  before: string[],
  fileLabel: string,
): void {
  const added = detectPrototypePollution(before);
  if (!added.length) return;
  throw new Error(
    `「${fileLabel}」在解析過程中試圖修改瀏覽器的內建物件（${added.join(
      "、",
    )}），本次匯入已中止，系統資料沒有變動。請確認這個檔案的來源。`,
  );
}
