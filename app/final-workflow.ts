import { peakFromBuckets, surveyCoverage } from "./partial-day.ts";

export type ReviewStatus = "草稿" | "待確認" | "已確認" | "定稿";

export type TraceableTrafficRecord = {
  projectId?: string;
  quarter: string;
  roadId: string;
  roadName: string;
  dayType: "平日" | "假日";
  directionCode: string;
  directionName: string;
  hour: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  vehicleCounts?: Record<string, number>;
  vehicleLabels?: Record<string, string>;
  surveyType?: "road" | "intersection";
  sourceFileName?: string;
  sourceSheetName?: string;
  sourceRow?: number;
  sourceRange?: string;
  /**
   * 表頭讀到的調查日期（YYYY-MM-DD）。舊資料沒有這一欄。
   * **只作顯示與期別檢查用**——trafficIdentity 不含它，不影響覆蓋判斷、
   * 加總、分類或任何計算。
   */
  surveyDate?: string;
};

export type AnomalyThresholds = {
  dailyChangePct: number;
  pcuChangePct: number;
  vehicleShareChangePct: number;
  peakShiftHours: number;
  zeroHourLimit: number;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  createdAt: string;
  pcuFactors: unknown;
  turnPcuFactors: unknown;
  vehicleClassSettings: unknown[];
  intersectionSettings: unknown[];
  roadAliases: unknown[];
  thresholds: AnomalyThresholds;
};

export type ComparisonReportTemplate = {
  id: string;
  name: string;
  createdAt: string;
  compareProjectIds: string[];
  quarter: string;
  dayType: string;
  /**
   * 調查點條件。
   *
   * 現行格式改成可複選，存的是 roadFilters（空陣列＝全部）。
   * roadFilter 是 v20.43 以前的舊欄位（單一字串，"ALL" 代表全部），
   * 保留為選填只為了讓**已經存過的範本仍然載得進來**——載入時會轉成陣列，
   * 之後再存就只寫新欄位。兩個都不要當成必填。
   */
  roadFilters?: string[];
  /** @deprecated 舊版單選格式；只在載入舊範本時讀取。 */
  roadFilter?: string;
  /** 車流方向條件。現行格式可複選（空陣列＝全部）。 */
  directions?: string[];
  /** @deprecated 舊版單選格式；只在載入舊範本時讀取。 */
  direction?: string;
  metric: "actual" | "pcu";
  exportSections: Record<string, boolean>;
  /** 時段車種分析的匯出勾選；v19.1 以前存的範本沒有這個欄位，載入時會套用預設值。 */
  periodExport?: {
    enabled: boolean;
    periods: string[];
    scopes: string[];
    metrics: string[];
    sheetPerPeriod: boolean;
  };
};

export type ImportHistoryEntry = {
  id: string;
  importedAt: string;
  operator: string;
  device: string;
  quarter: string;
  files: string[];
  rowCount: number;
  addedRows: number;
  replacedRows: number;
  roads: string[];
  vehicles: string[];
  beforeRecords: TraceableTrafficRecord[];
  afterRecords: TraceableTrafficRecord[];
};

export type WorkflowState = {
  version: 1;
  statuses: Record<string, ReviewStatus>;
  checkedQuarters: string[];
  thresholds: AnomalyThresholds;
  templates: ProjectTemplate[];
  comparisonReports: ComparisonReportTemplate[];
  history: ImportHistoryEntry[];
};

export const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  dailyChangePct: 20,
  pcuChangePct: 20,
  vehicleShareChangePct: 10,
  peakShiftHours: 3,
  zeroHourLimit: 3,
};

export function emptyWorkflowState(): WorkflowState {
  return {
    version: 1,
    statuses: {},
    checkedQuarters: [],
    thresholds: { ...DEFAULT_THRESHOLDS },
    templates: [],
    comparisonReports: [],
    history: [],
  };
}

export function trafficIdentity(record: TraceableTrafficRecord) {
  return [
    record.projectId,
    record.quarter,
    record.roadId,
    record.dayType,
    record.directionCode,
    record.hour,
  ]
    .map((value) => String(value ?? ""))
    .join("|");
}

export function recordVehicles(record: TraceableTrafficRecord) {
  return (
    record.vehicleCounts ?? {
      motorcycle: record.motorcycle,
      small: record.small,
      large: record.large,
      special: record.special,
    }
  );
}

/*
 * 這一筆紀錄實際出現過的車種「名稱」（不是分類代號）。
 *
 * 要比對的是調查表上寫的字：「大型車」與「大貨車」會對應到同一個分類代號，
 * 但它們是不同的名稱，正是要提醒使用者的那種不一致。所以看 vehicleLabels，
 * 不看 recordVehicles 的鍵。舊版匯入的紀錄沒有 vehicleLabels，回傳空陣列，
 * 呼叫端會直接略過（沒有名稱可比，就不要亂報警告）。
 */
export function recordVehicleLabels(record: TraceableTrafficRecord) {
  return Object.values(record.vehicleLabels ?? {})
    .map((label) => String(label ?? "").trim())
    .filter(Boolean);
}

export function validateImport(
  records: TraceableTrafficRecord[],
  existing: TraceableTrafficRecord[],
) {
  const identities = new Set<string>();
  const existingKeys = new Set(existing.map(trafficIdentity));
  const duplicateKeys = new Set<string>();
  const invalidRows: string[] = [];
  const warnings: string[] = [];
  const hoursByGroup = new Map<string, Set<string>>();
  let totalVehicles = 0;
  records.forEach((record, index) => {
    const identity = trafficIdentity(record);
    if (identities.has(identity)) duplicateKeys.add(identity);
    identities.add(identity);
    const values = Object.values(recordVehicles(record));
    if (!record.roadId || !record.roadName || !record.hour)
      invalidRows.push(`第 ${index + 1} 筆缺少調查點或時段`);
    if (
      values.some(
        (value) => !Number.isFinite(Number(value)) || Number(value) < 0,
      )
    )
      invalidRows.push(`第 ${index + 1} 筆含空白、非數字或負值`);
    totalVehicles += values.reduce((sum, value) => sum + Number(value || 0), 0);
    const group = [record.roadId, record.dayType, record.directionCode].join(
      "|",
    );
    hoursByGroup.set(
      group,
      new Set([...(hoursByGroup.get(group) ?? []), record.hour]),
    );
  });
  /*
   * 「24 小時完整」要看實際涵蓋幾小時，不是資料列有幾列。
   *
   * 舊寫法用 hours.size === 24（不重複時間標籤的個數），兩個方向都會錯：
   * ・06:00–18:00 的 30 分鐘資料剛好 24 個標籤 → 只有 12 小時卻通過檢核；
   * ・完整 24 小時的 15 分鐘資料有 96 個標籤 → 被判定不完整，訊息還會寫
   *   「96 小時」，那個數字本身就荒謬。
   * surveyCoverage() 早就算得出正確時數，這裡直接用它。
   */
  const coveredHoursOf = (hours: Set<string>) =>
    surveyCoverage([...hours]).coveredMinutes / 60;
  const incompleteGroups = [...hoursByGroup]
    .filter(([, hours]) => coveredHoursOf(hours) < 24)
    .map(([group, hours]) => {
      const covered = coveredHoursOf(hours);
      const text = Number.isInteger(covered) ? String(covered) : covered.toFixed(1);
      return `${group.replaceAll("|", "／")}：${text} 小時`;
    });
  /*
   * 同一個調查點裡，各支線的車種名稱應該一致。
   *
   * 使用者回報過一份四個路口的調查表：路口A、B 寫「大型車／特種車」，
   * 路口C、D 卻寫「大貨車／大客車」（調查表的筆誤）。那份檔案匯入之後，
   * 解析器切不出路口、把四個路口的車全部加在一起記成一筆
   *（v20.29 已修正切法），但**名稱不一致這件事本身仍然值得先問過使用者**：
   * 它通常是打錯字，偶爾才是真的用了不同的分類。
   *
   * 這裡只提醒、不阻擋也不自動改名——自動歸類會把「這個支線沒有調查某車種」
   * 寫成「該車種＝0」，那是憑空斷言。使用者確認無誤後照原名稱匯入，
   * 匯入流程本來就會請他確認新車種要對應到哪一類。
   */
  const armLabels = new Map<
    string,
    { roadId: string; roadName: string; armName: string; labels: Set<string> }
  >();
  for (const record of records) {
    const key = [record.roadId, record.dayType, record.directionCode].join("|");
    const entry = armLabels.get(key) ?? {
      roadId: record.roadId,
      roadName: record.roadName || record.roadId,
      armName: [
        record.directionName || `方向${record.directionCode}`,
        record.dayType,
      ]
        .filter(Boolean)
        .join("・"),
      labels: new Set<string>(),
    };
    for (const label of recordVehicleLabels(record)) entry.labels.add(label);
    armLabels.set(key, entry);
  }
  const shapesByRoad = new Map<
    string,
    { roadName: string; byShape: Map<string, string[]> }
  >();
  for (const arm of armLabels.values()) {
    const shape = [...arm.labels].sort().join("、");
    if (!shape) continue;
    const road = shapesByRoad.get(arm.roadId) ?? {
      roadName: arm.roadName,
      byShape: new Map<string, string[]>(),
    };
    road.byShape.set(shape, [...(road.byShape.get(shape) ?? []), arm.armName]);
    shapesByRoad.set(arm.roadId, road);
  }
  for (const { roadName, byShape } of shapesByRoad.values()) {
    if (byShape.size < 2) continue;
    const detail = [...byShape.entries()]
      .map(([shape, arms]) => `${[...new Set(arms)].sort().join("、")}＝${shape}`)
      .join("；");
    warnings.push(
      `「${roadName}」各方向／支線的車種名稱不一致：${detail}。` +
        `這通常是原始調查表打錯字。確認無誤才按下面的確認鈕；` +
        `系統會照原名稱匯入，不會自動把它們併成同一類。`,
    );
  }
  if (duplicateKeys.size)
    warnings.push(`匯入檔內有 ${duplicateKeys.size} 組重複鍵值`);
  if (incompleteGroups.length)
    warnings.push(`${incompleteGroups.length} 組方向未滿 24 小時`);
  const replacedRows = records.filter((record) =>
    existingKeys.has(trafficIdentity(record)),
  ).length;
  const roads = [
    ...new Map(
      records.map((record) => [record.roadId, record.roadName]),
    ).entries(),
  ].map(([id, name]) => `${name}（${id}）`);
  const dayTypes = [...new Set(records.map((record) => record.dayType))];
  const directions = [
    ...new Set(
      records.map((record) => record.directionName || record.directionCode),
    ),
  ];
  const vehicles = [
    ...new Map(
      records.flatMap((record) =>
        Object.entries(record.vehicleLabels ?? {}).map(
          ([key, label]) => [key, label] as const,
        ),
      ),
    ).values(),
  ];
  const sourceFiles = [
    ...new Set(records.map((record) => record.sourceFileName).filter(Boolean)),
  ] as string[];
  return {
    valid: invalidRows.length === 0 && records.length > 0,
    invalidRows,
    warnings,
    incompleteGroups,
    replacedRows,
    addedRows: records.length - replacedRows,
    totalRows: records.length,
    totalVehicles,
    roads,
    dayTypes,
    directions,
    vehicles,
    sourceFiles,
    mode: replacedRows
      ? replacedRows === records.length
        ? "覆蓋"
        : "追加＋覆蓋"
      : "追加",
  };
}

function hourNumber(hour: string) {
  const match = hour.match(/(\d{1,2}):/);
  return match ? Number(match[1]) : 0;
}

/** 一筆歷季異常提醒。文字敘述與可篩選的欄位分開存，才能做區間與類型篩選。 */
export type AnomalyAlert = {
  /** 這一筆屬於哪個「調查點｜日別｜方向」群組。 */
  roadId: string;
  dayType: string;
  direction: string;
  type: AnomalyType;
  /** 比較的起訖季度。單季型（零流量）兩者相同。 */
  fromQuarter: string;
  toQuarter: string;
  /** 變動幅度或數量，供排序與篩選用。 */
  value: number;
  unit: string;
  /** 車種占比變動才有值（內部鍵值，例如 custom:大貨車）。 */
  vehicle?: string;
  /*
   * 顯示用的名稱。上面的 roadId／direction／vehicle 是鍵值，用來分組與篩選，
   * 不能拿去給人看——使用者替調查點、支線、車種改過名之後，畫面其他地方
   * 都顯示新名稱，只有異常提醒還印鍵值（13545-01、駛出路口A、custom:大貨車）。
   * 沒有傳 labels 進來時這三個欄位就等於鍵值，行為與舊版完全相同。
   */
  roadLabel: string;
  directionLabel: string;
  vehicleLabel?: string;
  /** 一行敘述，畫面、Excel 品質檢核與報告文字草稿共用。 */
  text: string;
};

/**
 * 把鍵值換成使用者看得懂的名稱。三個都是選填，沒給就用鍵值本身。
 * 這一層刻意由呼叫端提供：解析名稱要用到 intersectionSettings、
 * vehicleClassSettings 與調查點清單，那些都是畫面層的狀態。
 */
export type AnomalyLabels = {
  road?: (roadId: string) => string;
  direction?: (record: TraceableTrafficRecord) => string;
  vehicle?: (vehicleKey: string, record: TraceableTrafficRecord) => string;
};

/**
 * 季度的排序鍵。
 *
 * 季度允許民國三碼（115Q2）與西元四碼（2026Q2）並存（匯入時的驗證是
 * `^(?:\d{3}|\d{4})Q[1-4]$`），純字串排序會把「115Q4 → 2026Q3」排成一組
 * 相鄰季度，但 2026Q3 其實就是民國 115Q3，比 115Q4 還早，比較方向是反的。
 * 這裡一律換算成民國年再乘 4 加季別，排序、相鄰季比較、區間篩選全部共用。
 */
export function quarterOrderKey(quarter: string): number {
  const match = /^(\d{2,4})Q([1-4])$/.exec(String(quarter || "").trim());
  if (!match) return Number.NEGATIVE_INFINITY;
  const year = Number(match[1]);
  // 四碼一律視為西元，換算成民國；三碼以下視為民國。
  const roc = year >= 1000 ? year - 1911 : year;
  return roc * 4 + Number(match[2]);
}

/**
 * 兩個整點之間的距離（小時），會繞過午夜。
 * 直接相減的話 23:00 → 01:00 會算成 22 小時，其實只差 2 小時。
 */
function hourDistance(a: number, b: number) {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 - raw);
}

/** 依季度先後排序的比較器，可直接丟給 Array.prototype.sort。 */
export function compareQuarters(a: string, b: string) {
  return quarterOrderKey(a) - quarterOrderKey(b) || a.localeCompare(b);
}

export const ANOMALY_TYPES = [
  "全日量變動",
  "PCU變動",
  "尖峰時段位移",
  "車種占比變動",
  "零流量時段",
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

export function detectAnomalies(
  records: TraceableTrafficRecord[],
  thresholds: AnomalyThresholds,
  pcuValue: (record: TraceableTrafficRecord) => number,
  labels: AnomalyLabels = {},
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  const quarters = [...new Set(records.map((record) => record.quarter))].sort(
    (a, b) => quarterOrderKey(a) - quarterOrderKey(b),
  );
  const groups = new Map<string, TraceableTrafficRecord[]>();
  records.forEach((record) => {
    const key = [
      record.roadId,
      record.dayType,
      record.directionName || record.directionCode,
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });
  groups.forEach((rows, key) => {
    // 方向名稱理論上可能含有「|」，用 split 還原會被截斷，所以直接留著原值。
    const [groupRoadId, groupDayType, ...groupDirection] = key.split("|");
    /*
     * 分組鍵值一個字都沒有改，只是多帶一份顯示名稱。
     * 方向名稱要用整筆紀錄才解析得出來（路口的支線名稱存在路口幾何設定裡），
     * 所以拿這一組的第一筆當代表——同一組本來就是同一個調查點的同一個方向。
     */
    const sample = rows[0];
    const group = {
      roadId: groupRoadId,
      dayType: groupDayType,
      direction: groupDirection.join("|"),
      roadLabel: labels.road?.(groupRoadId) || groupRoadId,
      directionLabel:
        (sample && labels.direction?.(sample)) || groupDirection.join("|"),
      vehicleLabel: (vehicleKey: string) =>
        (sample && labels.vehicle?.(vehicleKey, sample)) || vehicleKey,
    };
    const byQuarter = quarters
      .map((quarter) => {
        const selected = rows.filter((row) => row.quarter === quarter);
        const actual = selected.reduce(
          (sum, row) =>
            sum +
            Object.values(recordVehicles(row)).reduce(
              (subtotal, value) => subtotal + Number(value || 0),
              0,
            ),
          0,
        );
        const pcu = selected.reduce((sum, row) => sum + pcuValue(row), 0);
        /*
         * 尖峰時段要用與全站相同的滾動視窗，不能取「整點小時的最大值」。
         *
         * 系統其他地方（KPI、時段車種分析、Excel）一律走 peakFromBuckets／
         * rollingPeak；這裡自己用整點分桶取最大，15 分鐘資料實測會得到
         * 07:00（232.5）而全站算出來的是 07:15–08:15（241.5）。
         * 兩套算法並存的結果是：異常提醒說「尖峰位移了」，但畫面上的尖峰欄
         * 根本沒有變，使用者無從查證。
         */
        const hourlyLabels = new Map<string, number>();
        selected.forEach((row) =>
          hourlyLabels.set(
            row.hour,
            (hourlyLabels.get(row.hour) ?? 0) + pcuValue(row),
          ),
        );
        const peakLabel = peakFromBuckets(hourlyLabels).label;
        const peak = hourNumber(peakLabel);
        /*
         * 「零流量時段」要數的是**整小時**，不是時間格。
         *
         * hourlyLabels 以原始時段標籤為鍵：15 分鐘一格的調查檔會有 96 個鍵，
         * 深夜零流量的 15 分鐘格輕易就超過預設門檻 3，於是每一季都跳警示。
         * 這正是同一個檔案裡 validateImport 已經修掉的同一種錯誤（見上方
         * surveyCoverage 的註解：「舊寫法用 hours.size === 24 …完整 24 小時
         * 的 15 分鐘資料有 96 個標籤 → 被判定不完整」），只是這一處沒跟著改。
         * 這裡改成把零流量的時間格換算成實際涵蓋時數再比門檻。
         */
        const zeroLabels = [...hourlyLabels.entries()]
          .filter(([, value]) => value === 0)
          .map(([label]) => label);
        const zeros = Math.round(
          surveyCoverage(zeroLabels).coveredMinutes / 60,
        );
        const vehicleTotals: Record<string, number> = {};
        selected.forEach((row) =>
          Object.entries(recordVehicles(row)).forEach(([vehicle, value]) => {
            vehicleTotals[vehicle] =
              (vehicleTotals[vehicle] ?? 0) + Number(value || 0);
          }),
        );
        const shares = Object.fromEntries(
          Object.entries(vehicleTotals).map(([vehicle, value]) => [
            vehicle,
            actual ? (value / actual) * 100 : 0,
          ]),
        );
        return { quarter, actual, pcu, peak, zeros, shares };
      })
      .filter((row) => row.actual || row.pcu);
    for (let index = 1; index < byQuarter.length; index += 1) {
      const previous = byQuarter[index - 1],
        current = byQuarter[index];
      const actualChange = previous.actual
        ? Math.abs(current.actual / previous.actual - 1) * 100
        : 0;
      const pcuChange = previous.pcu
        ? Math.abs(current.pcu / previous.pcu - 1) * 100
        : 0;
      if (actualChange > thresholds.dailyChangePct)
        alerts.push(
          alert(group, "全日量變動", previous.quarter, current.quarter, actualChange, "%"),
        );
      if (pcuChange > thresholds.pcuChangePct)
        alerts.push(
          alert(group, "PCU變動", previous.quarter, current.quarter, pcuChange, "%"),
        );
      if (hourDistance(current.peak, previous.peak) > thresholds.peakShiftHours)
        alerts.push(
          alert(
            group,
            "尖峰時段位移",
            previous.quarter,
            current.quarter,
            hourDistance(current.peak, previous.peak),
            "小時",
          ),
        );
      [
        ...new Set([
          ...Object.keys(previous.shares),
          ...Object.keys(current.shares),
        ]),
      ].forEach((vehicle) => {
        const change = Math.abs(
          (current.shares[vehicle] ?? 0) - (previous.shares[vehicle] ?? 0),
        );
        if (change > thresholds.vehicleShareChangePct)
          alerts.push(
            alert(
              group,
              "車種占比變動",
              previous.quarter,
              current.quarter,
              change,
              "個百分點",
              vehicle,
            ),
          );
      });
    }
    const latest = byQuarter.at(-1);
    if (latest && latest.zeros > thresholds.zeroHourLimit)
      alerts.push(
        alert(group, "零流量時段", latest.quarter, latest.quarter, latest.zeros, "個"),
      );
  });
  return alerts;
}

/**
 * 組出一筆提醒的完整敘述。
 *
 * 與舊版的差別只有一處：分隔符號統一成「／」。舊版是
 * `key.replace("|", "／")`——JavaScript 的 replace 只換第一個，所以輸出會變成
 *「13545-01／假日|西行(往水管路)」，前一個分隔是全形斜線、後一個卻還是直線；
 * 而車種占比那一類用的是 replaceAll，三段都是斜線。同一份清單出現兩種寫法。
 * 現在一律 replaceAll，數值與判定條件完全沒有改變。
 */
function alert(
  group: {
    roadId: string;
    dayType: string;
    direction: string;
    roadLabel: string;
    directionLabel: string;
    vehicleLabel: (vehicleKey: string) => string;
  },
  type: AnomalyType,
  fromQuarter: string,
  toQuarter: string,
  value: number,
  unit: string,
  vehicle?: string,
): AnomalyAlert {
  const { roadId, dayType, direction, roadLabel, directionLabel } = group;
  /*
   * 這一行字會出現在三個地方：畫面的異常提醒表、Excel 的「品質檢核」工作表、
   * 以及報告文字草稿。所以它必須寫使用者看得懂的名稱，不能寫鍵值——
   * 報告草稿裡冒出 `13545-01／平日／駛出路口A custom:大貨車占比變動`
   * 是直接會被寫進交付文件的。
   */
  const label = [roadLabel, dayType, directionLabel].join("／");
  const vehicleLabel = vehicle ? group.vehicleLabel(vehicle) : undefined;
  const text =
    type === "尖峰時段位移"
      ? `${label} 尖峰時段位移 ${value} 小時`
      : type === "零流量時段"
        ? `${label} ${toQuarter} 有 ${value} 個零流量時段`
        : type === "車種占比變動"
          ? `${label} ${vehicleLabel}占比變動 ${value.toFixed(1)} 個百分點`
          : `${label} ${fromQuarter}→${toQuarter} ${type} ${value.toFixed(1)}%`;
  return {
    roadId,
    dayType,
    direction,
    roadLabel,
    directionLabel,
    type,
    fromQuarter,
    toQuarter,
    value,
    unit,
    vehicle,
    vehicleLabel,
    text,
  };
}

/** 依季度區間、類型、調查點與日別篩選提醒。空陣列代表該項不限制。 */
export function filterAnomalies(
  alerts: AnomalyAlert[],
  filters: {
    fromQuarter?: string;
    toQuarter?: string;
    types?: string[];
    roadId?: string;
    dayType?: string;
  },
): AnomalyAlert[] {
  return alerts.filter((item) => {
    // 區間比對一律走 quarterOrderKey，才能同時處理民國三碼與西元四碼。
    if (
      filters.fromQuarter &&
      quarterOrderKey(item.toQuarter) < quarterOrderKey(filters.fromQuarter)
    )
      return false;
    if (
      filters.toQuarter &&
      quarterOrderKey(item.fromQuarter) > quarterOrderKey(filters.toQuarter)
    )
      return false;
    if (filters.types?.length && !filters.types.includes(item.type)) return false;
    if (filters.roadId && filters.roadId !== "ALL" && item.roadId !== filters.roadId)
      return false;
    if (filters.dayType && filters.dayType !== "ALL" && item.dayType !== filters.dayType)
      return false;
    return true;
  });
}

/** 依類型統計筆數，供畫面顯示「哪一種異常最多」。 */
export function anomalyTypeCounts(alerts: AnomalyAlert[]) {
  const counts = new Map<string, number>();
  for (const item of alerts) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  return ANOMALY_TYPES.map((type) => ({ type, count: counts.get(type) ?? 0 }));
}

export function completenessSummary(
  records: TraceableTrafficRecord[],
  quarter: string,
  configuredVehicles: string[],
  geometryRoadIds: string[],
  checked: boolean,
) {
  const selected = records.filter((record) => record.quarter === quarter);
  const roads = [...new Set(selected.map((record) => record.roadId))];
  const groups = new Map<string, Set<string>>();
  selected.forEach((record) => {
    const key = [record.roadId, record.dayType, record.directionCode].join("|");
    groups.set(key, new Set([...(groups.get(key) ?? []), record.hour]));
  });
  const labels = new Set(
    selected.flatMap((record) => Object.keys(recordVehicles(record))),
  );
  const intersectionRoads = [
    ...new Set(
      selected
        .filter((record) => record.surveyType === "intersection")
        .map((record) => record.roadId),
    ),
  ];
  const unmapped = selected
    .filter((record) => record.directionCode === "UNMAPPED")
    .reduce(
      (sum, record) =>
        sum +
        Object.values(recordVehicles(record)).reduce(
          (s, value) => s + Number(value || 0),
          0,
        ),
      0,
    );
  return {
    roads: roads.length,
    weekdayRoads: new Set(
      selected
        .filter((record) => record.dayType === "平日")
        .map((record) => record.roadId),
    ).size,
    holidayRoads: new Set(
      selected
        .filter((record) => record.dayType === "假日")
        .map((record) => record.roadId),
    ).size,
    // 同上：以實際涵蓋時數判斷，不是資料列數。
    completeGroups: [...groups.values()].filter(
      (hours) => surveyCoverage([...hours]).coveredMinutes >= 24 * 60,
    ).length,
    incompleteGroups: [...groups.values()].filter(
      (hours) => surveyCoverage([...hours]).coveredMinutes < 24 * 60,
    ).length,
    vehicleTypes: labels.size,
    vehiclesConfigured: [...labels].every((label) =>
      configuredVehicles.includes(label),
    ),
    geometryComplete: intersectionRoads.every((id) =>
      geometryRoadIds.includes(id),
    ),
    unmapped,
    checked,
  };
}
