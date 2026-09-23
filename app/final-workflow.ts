import {
  peakFromBuckets,
  surveyCoverage,
  parseTimeRange,
} from "./partial-day.ts";

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
  /**
   * 同一張工作表讀到**兩個以上不同的日期**時，全部的候選（ISO，已去重、
   * 已依「有標籤的排前面」排序）。只有一個或一個都沒有時**不寫這一欄**。
   *
   * 使用者 2026-09-20：「同一張表若你判讀到 2 個日期，在資料匯入時就應該
   * 做為異常顯示提醒使用者，在異常資料檢查結果也要檢查出來……因為有可能
   * 另一個不同的日期在該資料中有其意義存在，所以使用者不會修正資料」
   *
   * ⚠️ 一定要**存下來**，不能只在匯入當下提醒：原始檔匯完就不在手上了，
   *   事後到「資料維護 → 執行資料異常檢查」時沒有辦法再掃一次。
   * ⚠️ 與 surveyDate 一樣**不進 trafficIdentity**，不影響覆蓋判斷、加總、
   *   分類或任何計算。使用者指定了哪一個才對之後，改寫的是 surveyDate，
   *   這一欄**保留原樣**——留著才看得出當初到底有幾個候選。
   */
  surveyDateCandidates?: string[];
};

export type AnomalyThresholds = {
  dailyChangePct: number;
  pcuChangePct: number;
  vehicleShareChangePct: number;
  peakShiftHours: number;
  zeroHourLimit: number;
};

/**
 * @deprecated 設定範本已於 v20.64 移除（使用者 2026-09-09 授權：
 * 「套用後，為確保正確性還是會逐一確認，那跟逐一重新設定沒什麼不同了，
 *   所以設定範本功能沒有用處，請幫我移除」）。
 *
 * ⚠️ 型別與 WorkflowState.templates 欄位**刻意保留**。
 * 使用者硬碟裡已經存好的舊備份 JSON 一定帶著 templates 陣列；
 * 還原時如果因為「不認得的欄位」而失敗，他過去所有的備份就全部還原不了。
 * 做法：還原時**忽略內容、但不可以因為它存在而失敗**。
 * 由 tests/backup-completeness.test.mjs 釘住（拿含 templates 的舊備份還原必須成功）。
 */
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
  /**
   * @deprecated 跨計畫比較已於 v20.64 移除（使用者 2026-09-09 授權）。
   *
   * 這個欄位**只保留為選填**，因為使用者硬碟裡已經存好的舊範本一定帶著它。
   * 讀到要忽略、不可以炸掉；新存的範本不再寫入。
   * ⚠️ 不可以整個刪掉型別欄位——刪掉之後舊範本在 TypeScript 這一側就變成
   * 「多出來的欄位」，而畫面上讀 `report.compareProjectIds.length` 會直接
   * 拋 undefined。要留著、標記，並且讓所有讀取端都做存在性檢查。
   */
  compareProjectIds?: string[];
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
  /** @deprecated 見 ProjectTemplate；只為相容舊備份而保留，新資料一律空陣列。 */
  templates: ProjectTemplate[];
  comparisonReports: ComparisonReportTemplate[];
  history: ImportHistoryEntry[];
  /*
   * ══════════════════════════════════════════════════════════════════
   *  已經人工確認過、下次檢查不再提醒的異常（使用者 2026-09-17）
   * ══════════════════════════════════════════════════════════════════
   *
   * 「如果已經回報了，要怎麼按確認，來讓這項問題，在下次異常檢查時，
   *   不會再次回報異常呢?」
   *
   * ⚠️ 鍵是那一筆異常的**指紋**，而指紋必須包含它的數值。
   *   只用「季度＋調查點＋類型」當鍵的話，確認過「全日量變動 22%」之後，
   *   下一次變成 80% 也會被同一把鑰匙消音——那是把一個更嚴重的問題藏起來。
   *   數值變了 → 指紋變了 → 重新出現，這是刻意的。
   * ⚠️ 只有「人工確認」類可以確認。「重新匯入」是原始檔真的有錯，
   *   給它一顆按掉的鈕，等於提供一個把資料錯誤藏起來的開關。
   * ⚠️ 舊備份沒有這個欄位，讀進來是 undefined——所有讀取端都要當成空的。
   */
  ackedAnomalies?: Record<string, { at: string }>;
  /*
   * ══════════════════════════════════════════════════════════════════
   *  同一張表有兩個日期時，使用者指定的那一個（使用者 2026-09-20）
   * ══════════════════════════════════════════════════════════════════
   *
   * 鍵＝`季別|檔名|工作表名`，值＝使用者挑的 ISO 日期。
   *
   * ⚠️ 為什麼是**覆寫**而不是直接改資料：使用者原話是「有可能另一個不同
   *   的日期在該資料中有其意義存在，**所以使用者不會修正資料**」。
   *   同理，系統這一端也不該把原始判讀結果洗掉——留著才有辦法在使用者
   *   改變心意時換回來，也才看得出當初到底有幾個候選。
   * ⚠️ 只影響**顯示**（明細／彙總的調查日期）。不進 trafficIdentity，
   *   不影響覆蓋判斷、加總、分類或任何交通量數值。
   * ⚠️ 舊備份沒有這個欄位，讀進來是 undefined——所有讀取端都要當成空的。
   */
  surveyDateOverrides?: Record<string, string>;
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
    ackedAnomalies: {},
    surveyDateOverrides: {},
  };
}

/**
 * 一筆紀錄的調查日期歸屬鍵——`季別|檔名|工作表名`。
 *
 * ⚠️ 覆寫、候選、異常三邊**一定要用同一把鑰匙**，各寫各的就會出現
 *   「異常清單上挑了，明細卻沒變」這種對不起來的情形。
 */
export function surveyDateScopeKey(record: {
  quarter: string;
  sourceFileName?: string;
  sourceSheetName?: string;
}): string {
  return `${record.quarter}|${record.sourceFileName || ""}|${record.sourceSheetName || ""}`;
}

/**
 * 這一筆實際要顯示的調查日期：使用者指定過就用他指定的，否則用判讀到的。
 *
 * ⚠️ 覆寫值**必須是候選之一**才採用。備份檔被手改、或候選在重新匯入後
 *   變了之後，一個不在候選裡的覆寫會讓畫面顯示一個原始檔上根本沒有的
 *   日期——那比顯示錯的還糟，因為使用者無從發現。
 */
export function effectiveSurveyDate(
  record: { surveyDate?: string; surveyDateCandidates?: string[] } & {
    quarter: string;
    sourceFileName?: string;
    sourceSheetName?: string;
  },
  overrides?: Record<string, string>,
): string {
  const picked = overrides?.[surveyDateScopeKey(record)];
  if (!picked) return record.surveyDate || "";
  const candidates = record.surveyDateCandidates;
  if (!Array.isArray(candidates) || !candidates.includes(picked))
    return record.surveyDate || "";
  return picked;
}
/**
 * 一筆異常提醒的指紋——「已確認」記在這把鑰匙上。
 *
 * ⚠️ 一定要帶數值。它一變指紋就變，上一次的確認**自動失效**、
 *   這一筆會重新出現。少了它，確認過一次之後同一個調查點就再也不提醒。
 */
export function anomalyFingerprint(item: {
  type: string;
  fromQuarter: string;
  toQuarter: string;
  roadId: string;
  dayType: string;
  direction?: string;
  vehicle?: string;
  value: number;
  choices?: string[];
}): string {
  const parts = [
    item.type,
    item.fromQuarter,
    item.toQuarter,
    item.roadId,
    item.dayType,
    item.direction || "",
    item.vehicle || "",
    /* 小數點後一位就夠了；再細會因為浮點誤差讓指紋每次都不一樣。 */
    Number(item.value).toFixed(1),
  ];
  /*
   * ⚠️ choices 有值才加第 9 格，**不可以無條件加一格空的**：
   *   無條件加的話每一種舊異常的指紋字串都會變長，
   *   使用者先前按過的「已人工確認」會**全部失效、當場重新冒出來**。
   *   這正是姊妹專案交通服務水準 v2.20.67 修掉的那個 bug
   *   （「每季匯入又冒出來」），不要在這裡重演一次。
   *
   * ⚠️ 反過來，候選日期**必須**進指紋：本來只有兩個候選、
   *   重新匯入後變成三個，那是新的狀況，要重新提醒。
   */
  if (item.choices?.length) parts.push(item.choices.join("|"));
  return JSON.stringify(parts);
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
  /*
   * ══════════════════════════════════════════════════════════════════
   *  逐筆的「需注意」清單（帶類型），給畫面做標籤篩選用
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-13（附兩張截圖）：
   *   「全日交通量資料匯入了，有 22 筆提醒項目，但底下列出的並沒有這麼多，
   *     感覺只是展示前幾筆而已……能像『歷季異常提醒』那樣，列表展示當前匯入
   *     有異常的項目，並且有篩選功能，可以明顯看到發生了 ABCD 四個類型資料異常，
   *     點了 A 標籤就列出 A 異常的事件，如果都沒點任何標籤，表格就全列出全部。」
   *   「我可以很直觀知道異常有幾個種類，可以**選擇最重大的異常先挑出來看**哪幾筆，
   *     也不會因為筆數太多而沒注意到細節。」
   *
   * ⚠️ `warnings`（一句一種、把筆數寫在句子裡）**保留不動**——
   *   既有的匯出、草稿與測試都讀它。這裡另外給一份**逐筆展開**的，
   *   聚合型的訊息（「N 組方向未滿 24 小時」）在這裡是 N 列，不是 1 列。
   *   兩者的關係要成立：每一種類型的筆數加總 ＝ 畫面上列得出來的列數。
   */
  const warningItems: { type: string; text: string }[] = [];
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
        `這通常是原始調查表打錯字。確認無誤才按「確認匯入」；` +
        `系統會照原名稱匯入，不會自動把它們併成同一類。`,
    );
  }
  /*
   * 混合時間格：同一組資料裡有些時段是 15 分鐘一格、有些是整點一格。
   *
   * rollingPeak（partial-day.ts）用「眾數格長」算出 needed = 60 / 格長，
   * 然後**數格數**、不是累計分鐘數。眾數是 60 時 needed = 1，等於任何一列
   * 都被當成一個完整小時；「全日整點＋尖峰時段拆 15 分鐘」這種版型會讓
   * 尖峰那一小時只取到其中一格。實測：整點 100／15 分鐘格 50 的資料，
   * 真正的尖峰小時是 07 時的 200，系統卻報 00:00~01:00 的 100。
   * 總量守恆，所以任何以總量為基礎的檢查都抓不到。
   *
   * 這裡**只做偵測與提醒，不改計算**。修正挑選邏輯會變更計算口徑，
   * 那是使用者要拍板的決定，不是可以順手做掉的事。
   * 路口轉向已加同一類提醒，這一支補齊；判準（兩成門檻＋至少重複兩次）
   * 與 g2151f 的 `lib/traffic.ts` 相同。
   *
   * 判準要抓「兩種規律的格長」，不是「格長不完全一致」：每一種都要佔
   * 該組的兩成以上才算一個規律，否則調查中間的休息時段或零星異常格
   * 會一直誤報（路口轉向那邊實測過，只看『不一致』會誤報 19/55）。
   */
  const mixedIntervalGroups: string[] = [];
  for (const [group, hours] of hoursByGroup) {
    const lengths = new Map<number, number>();
    for (const hour of hours) {
      const range = parseTimeRange(hour);
      if (!range) continue;
      const length = range.end - range.start;
      if (length <= 0) continue;
      lengths.set(length, (lengths.get(length) ?? 0) + 1);
    }
    const total = [...lengths.values()].reduce((sum, n) => sum + n, 0);
    const regular = [...lengths.entries()]
      /*
       * 兩個條件都要：佔兩成以上，而且**至少重複兩次**。
       *
       * 少了「至少兩次」會誤報：短時段資料若只漏一列，相鄰間隔可能只有 4 個，
       * 那一個 30 分鐘的跳號就占 25%，於是全部都是 60 分鐘的資料被標成
       * 「混用 30／60 分鐘」。實測：06:00~07:00、07:00~08:00、08:00~08:30、
       * 08:30~09:30 這四列會誤報。一次性的跳號不是「另一種規律」。
       *
       * 路口轉向 v2.1.51-final 已採同一組判準；這一支補齊，兩支才真的一致
       * （本檔原本的註解寫「兩支行為一致」，但當時只有兩成門檻，並不一致）。
       */
      .filter(([, count]) => total > 0 && count >= 2 && count / total >= 0.2)
      .sort((a, b) => a[0] - b[0]);
    if (regular.length > 1)
      mixedIntervalGroups.push(
        `${group}（${regular.map(([len, n]) => `${len} 分鐘 × ${n} 格`).join("、")}）`,
      );
  }
  if (mixedIntervalGroups.length)
    warnings.push(
      `下列資料混用了不同長度的時間格：${mixedIntervalGroups.join("；")}。` +
        `系統推算尖峰小時時是以最常出現的格長為準，該值可能不是真正的一小時流量，` +
        `請人工核對尖峰時段的數字。（全日總量不受影響。）`,
    );
  if (duplicateKeys.size)
    warnings.push(`匯入檔內有 ${duplicateKeys.size} 組重複鍵值`);
  if (incompleteGroups.length)
    warnings.push(`${incompleteGroups.length} 組方向未滿 24 小時`);
  /*
   * ⚠️ 逐筆展開。聚合訊息說「N 組」，這裡就要有 N 列——
   *   否則使用者看到「22 項」卻只數得出十幾列，會以為自己看錯。
   */
  for (const key of duplicateKeys)
    warningItems.push({
      type: "重複鍵值",
      text: `${key.replaceAll("|", "／")}：這一組在匯入檔裡出現不只一次`,
    });
  for (const item of incompleteGroups)
    warningItems.push({ type: "未滿 24 小時", text: item });
  for (const { roadName, byShape } of shapesByRoad.values()) {
    if (byShape.size < 2) continue;
    for (const [shape, arms] of byShape)
      warningItems.push({
        type: "車種名稱不一致",
        text: `「${roadName}」的 ${[...new Set(arms)].sort().join("、")}：${shape}`,
      });
  }
  for (const item of mixedIntervalGroups)
    warningItems.push({ type: "混用時間格", text: item });
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
    warningItems,
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
   * 都顯示新名稱，只有異常提醒還印鍵值（999996-01、駛出路口A、custom:大貨車）。
   * 沒有傳 labels 進來時這三個欄位就等於鍵值，行為與舊版完全相同。
   */
  roadLabel: string;
  directionLabel: string;
  vehicleLabel?: string;
  /** 一行敘述，畫面、Excel 品質檢核與報告文字草稿共用。 */
  text: string;
  /**
   * 這一筆異常要使用者**從幾個選項裡挑一個**時的候選清單
   * （目前只有「調查日期不只一個」用得到，值是 ISO 日期）。
   *
   * ⚠️ 有 choices 的異常，畫面上除了「已人工確認」還會多一顆下拉：
   *   挑完＝同時寫回資料並記為已確認。只給「已確認」不給「指定哪一個」
   *   的話，使用者按掉之後系統仍然在用**它自己猜的**那一個日期。
   */
  choices?: string[];
  /**
   * 挑完之後要改寫哪一群紀錄——`季別|檔名|工作表名`。
   * ⚠️ 不可以用 roadId：同一張工作表可能產出好幾個調查點的資料，
   *   日期是**整張表**的屬性。
   */
  choiceScope?: string;
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
  /*
   * 使用者 2026-09-20 指定新增（三支同步）：
   *   「其中『北』對應『南』，『東』對應『西』，不管方向後面 + 了什麼字……
   *     如果出現不成對的話，請在異常檢查中檢查出來（匯入時也可以做異常提醒，
   *     但不阻擋匯入），由使用者手動去按確認（堅持是對的話），
   *     或自行修正資料後，重新匯入」
   *
   * ⚠️ 判定一律走 app/direction-pair.ts（三支共用、逐位元相同），
   *   **不可以在這裡或畫面層自己再寫一份**——自己寫一份的結果是
   *   同一個名稱在三支得到不同結論。
   */
  "方向名稱不成對",
  /*
   * 使用者 2026-09-20 指定新增（三支同步）：
   *   「同一張表若你判讀到 2 個日期，在資料匯入時就應該做為異常顯示提醒
   *     使用者，在異常資料檢查結果也要檢查出來，我在想的是你要如何讓
   *     使用者告訴你哪個才是正確的日期（因為有可能另一個不同的日期在該
   *     資料中有其意義存在，所以使用者不會修正資料）」
   *
   * ⚠️ 所以這一項的解法**不是**叫使用者去改原始檔，而是在畫面上
   *   直接讓他指定哪一個才是調查日期。
   */
  "調查日期不只一個",
] as const;
export type AnomalyType = (typeof ANOMALY_TYPES)[number];

/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-49：每一種異常的「解決方式」（使用者 2026-09-16）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「我建議在檢查結果表中，新增一欄"解決方式"(例如重新匯入檔案、
 *     指引前往某分頁進行人工確認等)」
 *   「如果這個異常狀況真的只能靠重新匯入解決，那就請在檢查結果表中，
 *     標註說明請重新匯入該筆檔案」
 *
 * ⚠️ `kind` 是給使用者的**期待管理**，不是分類標籤：
 *   ・畫面修正 → 程式裡真的有地方可以改，改完重按檢查**就會消失**
 *   ・重新匯入 → 錯在原始檔、畫面上沒有入口，一直按檢查也不會消失
 *   ・人工確認 → 不一定是錯，要有人看過並判定
 *   標成「畫面修正」卻其實改不掉，就是對使用者謊報。
 *
 * ⚠️ 這一支程式的五種異常**全部是趨勢類**（相鄰兩季變動超過門檻），
 *   本質上都是「提醒」而不是「錯」——所以多數是「人工確認」。
 *   把它們寫成「請修正資料」會逼使用者去改一份沒有錯的檔。
 *
 * ⚠️ 用 Record<AnomalyType, …> 宣告：新增一種異常卻忘了寫解決方式時，
 *   TypeScript 當場就會擋下來，不會等到畫面上出現空格子才發現。
 */
export type AnomalyResolution = {
  kind: "畫面修正" | "重新匯入" | "人工確認";
  /** 使用者實際要做的那件事，一句話講完。 */
  text: string;
  /** 可以直接跳過去的區塊錨點（對應 PAGE_ZONES 的 anchor）。 */
  anchor?: string;
  /** 那一塊在側欄上的名字，拿來寫按鈕文字。 */
  anchorLabel?: string;
};

export const ANOMALY_RESOLUTIONS: Record<AnomalyType, AnomalyResolution> = {
  全日量變動: {
    kind: "人工確認",
    text: "這是提醒，不是判定資料有錯。相鄰兩季的全日交通量變動超過門檻，可能是真的車流改變（道路改建、周邊開發、連假），也可能是這一季漏匯了部分時段。請到「可追溯明細」核對這兩季的調查時數與筆數：確實是現地變化就在報告中說明，這一項會一直列著；如果是漏匯或時段不全，補齊原始檔後重新匯入該季。覺得門檻太敏感可在「異常提醒門檻」調整。",
    anchor: "block-detail",
    anchorLabel: "可追溯明細",
  },
  PCU變動: {
    kind: "人工確認",
    text: "先看同一筆的「全日量變動」有沒有一起出現：兩個都變＝車流本身變了，只有 PCU 變＝多半是車種歸類或 PCU 當量改過。後者請到「PCU 當量係數」與「車種分類與當量管理」確認是不是刻意調整的——是的話這一項屬正常，在報告中說明即可；不是的話把設定改回來，重按檢查就會消失。",
    anchor: "block-pcu",
    anchorLabel: "PCU 當量係數",
  },
  尖峰時段位移: {
    kind: "人工確認",
    text: "尖峰小時的起點相對前一季移動超過門檻。真實原因常見的是學期、連假、施工改道；資料原因常見的是原始檔的時間欄位錯位或時間格混用。請到「24小時型態」比對這兩季的曲線形狀：形狀合理就在報告中說明；曲線明顯錯位才回原始檔更正時間欄位後重新匯入該季。",
    anchor: "block-hourly",
    anchorLabel: "24小時型態",
  },
  車種占比變動: {
    kind: "人工確認",
    text: "某一個車種的占比相對前一季變動超過門檻（單位是百分點，不是百分比）。最常見的原因是車種歸類改過——同一個原始車種這一季被歸到別的分析分類。請到「車種分類與當量管理」確認兩季的歸類是否一致：一致就代表是真的組成改變，在報告中說明即可；不一致請改回來，重按檢查就會消失。",
    anchor: "card-vehicle-class",
    anchorLabel: "車種分類與當量管理",
  },
  零流量時段: {
    kind: "重新匯入",
    text: "整段時間格的流量是 0，而且換算成實際涵蓋時數之後仍然超過上限。深夜本來就可能是 0，所以先確認原始檔那幾個時段是「量到 0」還是「根本沒填」：沒填的要補齊後重新匯入該季（本系統不提供逐格補值，也不會把空白當成 0）；現場確實整段沒有車流的話，把「異常提醒門檻」的「零流量時段上限」調高即可。",
    anchor: "quality-thresholds",
    anchorLabel: "異常提醒門檻",
  },
  方向名稱不成對: {
    kind: "人工確認",
    text: "一條路的兩個方向通常是相反的（北對南、東對西）。請到「路段名稱管理」核對這兩個名稱：打錯字就改過來；如果這條路確實不是這樣命名的（例如單行道配對、或依地標命名），按下「已人工確認」即可，下次檢查不再提醒。這一項不會阻擋任何操作，也不影響任何計算——方向的鍵值仍然是方向A／方向B。",
    anchor: "block-roads",
    anchorLabel: "路段名稱管理",
  },
  調查日期不只一個: {
    kind: "人工確認",
    text: "同一張工作表上找到兩個以上不同的日期，系統無從判斷哪一個才是調查日期（另一個可能是製表、複核或現場補測的日期，本來就該留在表上）。請用這一列的「指定調查日期」選單挑出正確的調查日期，挑完就會套用到那一張工作表的所有紀錄，並記為已確認。挑完之後明細與彙總顯示的調查日期就會是你指定的那一個。系統不會自己挑、也不會取平均——這一項不影響任何交通量數值。",
    anchor: "block-detail",
    anchorLabel: "可追溯明細",
  },
};

/**
 * 同一張工作表讀到兩個以上調查日期 → 包成「請使用者指定」的提醒。
 *
 * ⚠️ 分組鍵是 `季別|檔名|工作表名`，不是調查點：日期是**整張表**的屬性，
 *   一張表可能產出好幾個調查點。用調查點分組會把同一件事報好幾次。
 *
 * ⚠️ 與「方向名稱不成對」一樣**不是兩季之間的比較**，所以 fromQuarter
 *   填該季、toQuarter 相同、value 固定 0——指紋只會因為
 *   「候選日期真的變了」而變，不會因為又匯入一季就讓確認失效。
 */
export function detectSurveyDateAlerts(
  records: {
    quarter: string;
    roadId: string;
    dayType: string;
    sourceFileName?: string;
    sourceSheetName?: string;
    surveyDate?: string;
    surveyDateCandidates?: string[];
  }[],
  labels?: { road?: (roadId: string) => string },
  readable?: (iso: string) => string,
  overrides?: Record<string, string>,
): AnomalyAlert[] {
  const show = readable ?? ((iso: string) => iso);
  type Group = {
    quarter: string;
    file: string;
    sheet: string;
    roadId: string;
    dayType: string;
    candidates: string[];
    chosen: string;
  };
  const groups = new Map<string, Group>();
  for (const record of records) {
    const candidates = record.surveyDateCandidates;
    if (!Array.isArray(candidates) || candidates.length < 2) continue;
    const file = record.sourceFileName || "";
    const sheet = record.sourceSheetName || "";
    const key = `${record.quarter}|${file}|${sheet}`;
    const previous = groups.get(key);
    if (previous) {
      /* 同一張表的候選理論上一模一樣；真的不同就取聯集，寧可多問。 */
      for (const iso of candidates)
        if (!previous.candidates.includes(iso)) previous.candidates.push(iso);
      continue;
    }
    groups.set(key, {
      quarter: record.quarter,
      file,
      sheet,
      roadId: record.roadId,
      dayType: record.dayType,
      candidates: [...candidates],
      chosen: effectiveSurveyDate(record, overrides),
    });
  }
  const alerts: AnomalyAlert[] = [];
  for (const [key, group] of groups) {
    const where = [group.file, group.sheet].filter(Boolean).join(" → ") || "原始檔";
    const picked = overrides?.[key];
    alerts.push({
      roadId: group.roadId,
      dayType: group.dayType,
      direction: "",
      type: "調查日期不只一個",
      fromQuarter: group.quarter,
      toQuarter: group.quarter,
      value: 0,
      unit: "",
      roadLabel: labels?.road?.(group.roadId) ?? group.roadId,
      directionLabel: "",
      choices: group.candidates,
      choiceScope: key,
      text:
        `${where}：讀到 ${group.candidates.length} 個不同的日期（` +
        group.candidates.map((iso) => show(iso)).join("、") +
        `）。目前採用的是「${group.chosen ? show(group.chosen) : "無"}」` +
        (picked ? "（你指定的）" : "（系統依標籤判讀的，尚未指定）") +
        `。請用這一列的「指定調查日期」選單挑出哪一個才對。`,
    });
  }
  return alerts;
}

/**
 * 方向顯示名稱成不成對——判定走三支共用的 direction-pair，這裡只負責包成提醒。
 *
 * ⚠️ 這與「尖峰時段位移」那幾種不同：它**不是兩季之間的比較**，
 *   而是一個當下的設定問題，所以 fromQuarter／toQuarter 都留空、value 固定 0。
 *   指紋因此只會因為「名稱真的改了」而變——使用者按過的確認不會因為
 *   又匯入一季就失效（姊妹專案交通服務水準踩過這個坑，見該專案
 *   issue-ack-stability.test.mjs）。
 */
export function detectDirectionPairAlerts<Verdict extends { kind: string }>(
  roads: { roadId: string; roadLabel: string; directionA: string; directionB: string }[],
  judge: (a: string, b: string) => Verdict,
  message: (a: string, b: string, verdict: Verdict) => string,
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  for (const road of roads) {
    const verdict = judge(road.directionA, road.directionB);
    if (verdict.kind !== "mismatched") continue;
    alerts.push({
      roadId: road.roadId,
      dayType: "",
      direction: `${road.directionA}｜${road.directionB}`,
      type: "方向名稱不成對",
      fromQuarter: "",
      toQuarter: "",
      value: 0,
      unit: "",
      roadLabel: road.roadLabel,
      directionLabel: `${road.directionA}／${road.directionB}`,
      text: `${road.roadLabel}：${message(road.directionA, road.directionB, verdict)}`,
    });
  }
  return alerts;
}

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
 *「999996-01／假日|西行(往示範管路)」，前一個分隔是全形斜線、後一個卻還是直線；
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
   * 報告草稿裡冒出 `999996-01／平日／駛出路口A custom:大貨車占比變動`
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
