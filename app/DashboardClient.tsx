"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import initialData from "./traffic-data.json";
import {
  isFallbackRoadName,
  isRealDirectionName,
  normalizeRoadId,
  pickDirectionName,
  roadNameFromFileName,
  roadNameMatchKey,
  surveyRoadIdFromFileName,
} from "./road-identity";
import { appFetch, offlineMode } from "./app-fetch";
/* 版號與更新日期的單一來源，畫面與測試讀同一份 */
import { SYSTEM_VERSION, SYSTEM_UPDATED_AT } from "./system-release";
import {
  armCodeOf,
  assertNoPrototypePollution,
  coreVehicleLabels,
  dayTypeOf,
  parseTrafficSheetValues,
  prototypeFingerprint,
  SAFE_XLSX_READ_OPTIONS,
  type CoreVehicleKey,
  type DestinationCounts,
  type TurnCounts,
  type TurnKey,
  type VehicleCounts,
  type VehicleLabels,
} from "./traffic-parser";
import {
  CORE_VEHICLE_KEYS,
  effectiveVehicleCounts,
  effectiveVehicleLabel,
  missingVehicleFactors,
  rawVehicleCounts,
  rawVehicleLabels,
  sumVehicleCounts,
  sumVehiclePcu,
  syncCoreVehicleSettings,
  vehicleCatalog,
  type CorePcuFactors,
  type CoreTurnPcuFactors,
  type VehicleClassSetting,
} from "./vehicle-analysis";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_BASE_UNITS,
  metricUnitFor,
  PERIOD_KEYS,
  PERIOD_LABELS,
  hourStartOf,
  buildPeriodExportSheets,
  buildPeriodRows,
  defaultPeriodExportSelection,
  normalizePeriodExportSelection,
  periodCellValue,
  cellUnitFor,
  periodVehicleLabel,
  shareOf,
  type MetricKey,
  type PeakScope,
  type PeriodRow,
  type PeriodExportSelection,
  type PeriodKey,
} from "./period-analysis";
import {
  CONCLUSION_METRICS,
  CONCLUSION_PERIOD_LABELS,
  DEFAULT_CONDITION as DEFAULT_CONCLUSION_CONDITION,
  buildConclusion,
  selectRows as selectConclusionRows,
  quarterKey as conclusionQuarterKey,
  quarterYear as conclusionQuarterYear,
  type ConclusionCondition,
  type ConclusionMetricKey,
  type ConclusionRow,
  type ConclusionTemplate,
} from "./conclusion";
import {
  coverageNote,
  peakFromBuckets,
  surveyCoverage,
  type SurveyCoverage,
} from "./partial-day";
import {
  buildArmSettings,
  classifyMovement,
  completeArmTargets,
  deriveDestinationIntersectionRecords,
  normalizeAngle,
  targetField,
  type IntersectionArmSetting,
} from "./intersection-flow";
import {
  DRAFT_SECTION_LABELS,
  DRAFT_SECTION_ORDER,
  EXPORT_SECTIONS,
  buildReportDraft,
  type DraftSectionKey,
  type ReportDraftContext,
} from "./report-draft.ts";
import {
  anomalyTypeCounts,
  compareQuarters,
  completenessSummary,
  detectAnomalies,
  filterAnomalies,
  emptyWorkflowState,
  trafficIdentity,
  validateImport,
  type ComparisonReportTemplate,
  type ImportHistoryEntry,
  type ProjectTemplate,
  type ReviewStatus,
  type WorkflowState,
} from "./final-workflow";
import { deleteWorkflow, loadWorkflow, saveWorkflow } from "./workflow-store";
type User = {
  displayName: string;
  email: string;
} | null;
type DayType = "平日" | "假日";
type DayMode = DayType | "平日＋假日";
type Direction = "ALL" | string;
const DAY_MODES: DayMode[] = ["平日", "假日", "平日＋假日"];
type Metric = "actual" | "pcu";
type TrendMode = "平日＋假日" | DayType;
type CompositionMode = "平日＋假日" | DayType;
/**
 * 路口流量的兩種視角。
 *
 * 用「起點／終點」命名，不用 inbound/outbound——後者在中文語境裡剛好相反，
 * 是先前把畫面標成「駛入路口A」卻其實是「從 A 出發」的原因。
 *   origin      ＝ 調查表原本的樣子：以該支線為<起點>，車輛從這條支線開進路口 → 顯示為「駛出路口A」
 *   destination ＝ 依轉向推導：以該支線為<終點>，車輛穿過路口後開進這條支線 → 顯示為「駛入路口A」
 */
type IntersectionFlowMode = "origin" | "destination";
type TrafficRecord = {
  projectId?: string;
  quarter: string;
  roadId: string;
  roadName: string;
  dayType: DayType;
  directionCode: string;
  directionName: string;
  hour: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  surveyType?: "road" | "intersection";
  turnData?: TurnCounts;
  vehicleCounts?: VehicleCounts;
  vehicleLabels?: VehicleLabels;
  /** 目的支線分欄格式（往B、往C…）保留的原始各目的地車輛數 */
  destinationCounts?: DestinationCounts;
  sourceFileName?: string;
  sourceSheetName?: string;
  sourceRow?: number;
  sourceRange?: string;
};
type Project = {
  id: string;
  name: string;
  code?: string;
  clientName?: string;
  role: "owner" | "editor" | "viewer";
  quarter?: string;
  isDemo?: boolean;
};
type RoadAlias = { aliasKey: string; aliasName: string; roadId: string };
type RoadSummary = {
  roadId: string;
  roadName: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  vehicles: Record<string, number>;
  a: number;
  b: number;
  aPcu: number;
  bPcu: number;
  total: number;
  pcu24: number;
  peakPcu: number;
  peakHour: string;
  aPeakPcu: number;
  aPeakHour: string;
  bPeakPcu: number;
  bPeakHour: string;
  surveyType: "road" | "intersection";
  directions: DirectionSummary[];
};
type DirectionSummary = {
  code: string;
  name: string;
  actual: number;
  pcu: number;
  peakPcu: number;
  peakHour: string;
};
type TurnPcuFactors = CoreTurnPcuFactors;
type DayComparison = {
  roadId: string;
  roadName: string;
  weekdayActual: number;
  holidayActual: number;
  weekdayPcu: number;
  holidayPcu: number;
};
type TrendRow = {
  quarter: string;
  /* null＝被日別篩選掉、或那一季沒有這種日別的資料。不可以用 0 代替。 */
  weekday: number | null;
  holiday: number | null;
};
/**
 * 匯出檔名要能一眼看出「這是哪一個計畫、哪一季」。
 *
 * 舊版檔名只有季度，多計畫時 A 計畫與 B 計畫同季匯出的檔名一模一樣，
 * 放進同一個資料夾會直接覆蓋；而檔案內唯一寫著計畫名稱的地方（可編輯圖表
 * 工作表的 A1）還可以在匯出中心被取消勾選而整張移除。
 * 順便濾掉 Windows 不允許出現在檔名裡的字元。
 */
function exportFileName(projectName: string, quarter: string, ext: string) {
  const safe = (text: string) =>
    String(text || "")
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60);
  const project = safe(projectName) || "未命名計畫";
  return `全日交通量及車種組成_${project}_歷季彙整_${safe(quarter) || "全部季度"}.${ext}`;
}

const palette = {
  navy: "#17324D",
  teal: "#148C8C",
  orange: "#E58A2B",
  blue: "#5B8DB8",
  pale: "#D8E7F1",
};
/** 匯出檔內附的 9 張可編輯原生圖表，順序與工作表相同。 */
const EXPORT_CHART_TITLES = [
  "全日實際交通量",
  "全日當量交通量（PCU）",
  "平假日比較",
  "歷季全日量趨勢",
  "車種組成圓餅",
  "車種歷季比例",
  "每小時實際量",
  "每小時當量交通量",
  "跨計畫比較",
] as const;
/**
 * 「各調查點分項結果」最多逐點敘述幾個調查點。
 * 每個點會寫成一個標題加「方向 × 時段」數行，點一多整段就長到沒人看得完；
 * 超過的部分在段末說明還有幾個點。
 */
const ROAD_SUMMARY_LIMIT = 30;
/** 匯入偵測到預設四大類以外的車種時，先套用的當量係數（使用者事後可自行調整）。 */
const NEW_VEHICLE_DEFAULT_PCU = 1;
const PCU_FACTORS = {
  motorcycle: 0.5,
  small: 1,
  large: 1.5,
  special: 2.5,
} as const;
type PcuFactors = CorePcuFactors;
const TURN_PCU_FACTORS: TurnPcuFactors = {
  motorcycle: { through: 0.3, right: 0.4, left: 0.5 },
  small: { through: 1, right: 1.3, left: 1.5 },
  large: { through: 1.5, right: 2, left: 2.3 },
  special: { through: 2, right: 2.3, left: 2.5 },
};
/*
 * PCU 係數的每計畫儲存。
 *
 * 對照表：{ 計畫代碼: 係數 }。查不到這個計畫時，依序退回
 * 「舊版的單一設定」→「系統預設值」，所以升級前存的設定不會消失，
 * 也不會讓沒設定過的計畫變成空的。
 */
const PCU_BY_PROJECT_KEY = "traffic-pcu-factors-by-project-v1";
const TURN_PCU_BY_PROJECT_KEY = "traffic-turn-pcu-factors-by-project-v1";
const LEGACY_PCU_KEY = "traffic-pcu-factors-v1";
const LEGACY_TURN_PCU_KEY = "traffic-turn-pcu-factors-v1";

function isValidPcu(value: unknown): value is PcuFactors {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return CORE_VEHICLE_KEYS.every(
    (key) => typeof record[key] === "number" && Number.isFinite(record[key]),
  );
}
function isValidTurnPcu(value: unknown): value is TurnPcuFactors {
  if (!value || typeof value !== "object") return false;
  const values = Object.values(value as Record<string, unknown>).flatMap(
    (entry) =>
      entry && typeof entry === "object"
        ? Object.values(entry as Record<string, unknown>)
        : [null],
  );
  return (
    values.length === 12 &&
    values.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}
function readJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function readMap(key: string): Record<string, unknown> {
  const value = readJson(key);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/**
 * 一次性搬遷：把 v20.7 以前那組「所有計畫共用」的係數，明確寫進當時已經
 * 存在的每一個計畫，然後就不再有任何共用來源。
 *
 * 為什麼要寫進去、而不是留著當後援：留著後援的話，「還沒自己設定過的計畫」
 * 仍然會顯示別的計畫設定的數字，使用者一樣分不出那到底是不是自己設的。
 * 明確寫進去之後，每個計畫的係數都是它自己的，新建立的計畫則一律從系統
 * 預設值開始，畫面上也才能誠實標示「這個計畫尚未自行設定」。
 */
// 名稱刻意不帶版號：這是一次性旗標，改名會讓搬遷重跑一次。
const PCU_MIGRATION_FLAG = "traffic-pcu-factors-per-project-migrated";
function migrateLegacyPcuFactors(projectIds: string[]) {
  /*
   * 整段包在 try 裡：這支在載入時就會跑，無痕視窗或封鎖網站資料時
   * localStorage 的存取本身就會丟例外，讓它逃出去會讓整頁變空白。
   * 搬遷失敗不影響使用（讀不到就用系統預設係數），下次再試一次即可，
   * 所以**不寫旗標**。
   */
  try {
    if (localStorage.getItem(PCU_MIGRATION_FLAG)) return;
    const legacyPcu = readJson(LEGACY_PCU_KEY);
    const legacyTurn = readJson(LEGACY_TURN_PCU_KEY);
    if (isValidPcu(legacyPcu)) {
      const map = readMap(PCU_BY_PROJECT_KEY);
      for (const id of projectIds) if (id && !(id in map)) map[id] = legacyPcu;
      localStorage.setItem(PCU_BY_PROJECT_KEY, JSON.stringify(map));
    }
    if (isValidTurnPcu(legacyTurn)) {
      const map = readMap(TURN_PCU_BY_PROJECT_KEY);
      for (const id of projectIds) if (id && !(id in map)) map[id] = legacyTurn;
      localStorage.setItem(TURN_PCU_BY_PROJECT_KEY, JSON.stringify(map));
    }
    localStorage.setItem(PCU_MIGRATION_FLAG, new Date().toISOString());
  } catch {
    /* 下次載入再試一次；旗標沒寫，不會被誤認為已完成。 */
  }
}
/** 這個計畫有沒有自己設定過係數（用來在畫面上標示「使用系統預設」）。 */
function hasOwnPcuFactors(projectId: string) {
  return (
    isValidPcu(readMap(PCU_BY_PROJECT_KEY)[projectId]) ||
    isValidTurnPcu(readMap(TURN_PCU_BY_PROJECT_KEY)[projectId])
  );
}
function readProjectPcuFactors(projectId: string): PcuFactors {
  const own = readMap(PCU_BY_PROJECT_KEY)[projectId];
  // 沒有自己的設定就用系統預設，絕不沿用別的計畫的值。
  return isValidPcu(own) ? { ...own } : { ...PCU_FACTORS };
}
function readProjectTurnPcuFactors(projectId: string): TurnPcuFactors {
  const own = readMap(TURN_PCU_BY_PROJECT_KEY)[projectId];
  return isValidTurnPcu(own)
    ? structuredClone(own)
    : structuredClone(TURN_PCU_FACTORS);
}
/*
 * 寫入瀏覽器儲存可能失敗（空間滿了、無痕視窗、瀏覽器封鎖網站資料）。
 *
 * 舊版讓例外直接往外丟：呼叫端在寫入「之後」才 setToast，於是整個處理
 * 函式在設定完畫面狀態後中斷——欄位顯示新值、沒有任何錯誤訊息、
 * 重新整理之後值又變回去。使用者會以為自己設定成功了。
 * 這裡改成回傳成功與否，由呼叫端明確告知。
 */
function safeWrite(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
/*
 * 結論草稿的條件範本：依計畫分開存。
 *
 * 存在 localStorage 而不是併進 workflow（IndexedDB）是刻意的——範本只是
 * 一組勾選狀態，壞掉最多是要重設一次，不值得為它動到已經稽核過的
 * 工作流程還原路徑。讀取失敗一律回空陣列，畫面不會因此壞掉。
 */
const CONCLUSION_TEMPLATE_KEY = "traffic-conclusion-templates-v1";

function readConclusionTemplates(projectId: string): ConclusionTemplate[] {
  if (!projectId || typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(CONCLUSION_TEMPLATE_KEY) || "{}");
    const list = raw?.[projectId];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeConclusionTemplates(
  projectId: string,
  templates: ConclusionTemplate[],
) {
  if (!projectId || typeof localStorage === "undefined") return;
  let map: Record<string, ConclusionTemplate[]> = {};
  try {
    const raw = JSON.parse(localStorage.getItem(CONCLUSION_TEMPLATE_KEY) || "{}");
    if (raw && typeof raw === "object") map = raw;
  } catch {
    map = {};
  }
  map[projectId] = templates;
  safeWrite(CONCLUSION_TEMPLATE_KEY, map);
}

function writeProjectPcuFactors(projectId: string, factors: PcuFactors) {
  if (!projectId) return true;
  const map = readMap(PCU_BY_PROJECT_KEY);
  map[projectId] = factors;
  return safeWrite(PCU_BY_PROJECT_KEY, map);
}
function writeProjectTurnPcuFactors(
  projectId: string,
  factors: TurnPcuFactors,
) {
  if (!projectId) return true;
  const map = readMap(TURN_PCU_BY_PROJECT_KEY);
  map[projectId] = factors;
  return safeWrite(TURN_PCU_BY_PROJECT_KEY, map);
}

/**
 * Excel 的 dataValidation 清單是一個字串常數：逗號是分隔符、雙引號會提前結束字串，
 * 整串又不得超過 255 個字元。調查點名稱含這些字元（或名稱一多）就會讓清單爆掉，
 * 連帶讓依賴它的 SUMIFS 對不到資料。這裡把危險字元換成全形，並在超長時放棄清單。
 */
function excelListFormula(options: string[]): string | null {
  const safe = options.map((option) =>
    String(option ?? "")
      .replaceAll('"', "＂")
      .replaceAll(",", "，"),
  );
  const joined = safe.join(",");
  return joined.length <= 255 ? `"${joined}"` : null;
}

const roadMeta = initialData.roads as Record<
  string,
  {
    name: string;
    a: string;
    b: string;
  }
>;
const roadMetaByStableId = new Map(
  Object.entries(roadMeta).map(([id, meta]) => [normalizeRoadId(id), meta]),
);
const formatter = new Intl.NumberFormat("zh-TW");
const decimalFormatter = new Intl.NumberFormat("zh-TW", {
  maximumFractionDigits: 1,
});
function bearingLabel(value: number) {
  const labels = ["東", "東南", "南", "西南", "西", "西北", "北", "東北"];
  return labels[Math.round(normalizeAngle(value) / 45) % 8];
}
function resolveDestinationTurns(
  rows: TrafficRecord[],
  projectId: string,
  savedSettings: IntersectionArmSetting[],
): TrafficRecord[] {
  if (!rows.some((row) => row.destinationCounts)) return rows;
  const armsByRoad = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.destinationCounts) continue;
    const codes = armsByRoad.get(row.roadId) ?? [];
    if (!codes.includes(row.directionCode)) codes.push(row.directionCode);
    armsByRoad.set(row.roadId, codes);
  }
  const routesByRoad = new Map<string, Map<string, Record<string, TurnKey>>>();
  for (const [roadId, codes] of armsByRoad) {
    const settings = buildArmSettings(projectId, roadId, [...codes], savedSettings);
    routesByRoad.set(
      roadId,
      new Map(settings.map((setting) => [setting.directionCode, setting.routes])),
    );
  }
  return rows.map((row) => {
    if (!row.destinationCounts) return row;
    const routes = routesByRoad.get(row.roadId)?.get(row.directionCode) ?? {};
    const turnData: TurnCounts = {};
    for (const [vehicle, byDestination] of Object.entries(row.destinationCounts)) {
      const turns: Record<TurnKey, number> = { left: 0, through: 0, right: 0 };
      for (const [code, count] of Object.entries(byDestination)) {
        const turn: TurnKey = routes[code] ?? "through";
        turns[turn] += Number(count) || 0;
      }
      turnData[vehicle] = turns;
    }
    return { ...row, turnData };
  });
}

function sumVehicles(r: TrafficRecord) {
  return sumVehicleCounts(r);
}
function sumPcu(
  r: TrafficRecord,
  factors: PcuFactors = PCU_FACTORS,
  turnFactors: TurnPcuFactors = TURN_PCU_FACTORS,
  vehicleSettings: VehicleClassSetting[] = [],
) {
  return sumVehiclePcu(r, factors, turnFactors, vehicleSettings);
}
function pct(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}
function peakOf(
  records: TrafficRecord[],
  factors: PcuFactors = PCU_FACTORS,
  turnFactors: TurnPcuFactors = TURN_PCU_FACTORS,
  vehicleSettings: VehicleClassSetting[] = [],
  separateDays = false,
): [string, number] {
  const hourly = new Map<string, number>();
  records.forEach((r) => {
    const key = separateDays ? `${r.dayType}|${r.hour}` : r.hour;
    hourly.set(
      key,
      (hourly.get(key) ?? 0) + sumPcu(r, factors, turnFactors, vehicleSettings),
    );
  });
  // 尖峰一律透過共用的 peakFromBuckets 計算：
  // 每小時一列的資料取最大的那一列，15 分鐘等細格資料則取連續湊滿
  // 一小時的滾動視窗最大值。舊版在這裡直接取最大的分桶，
  // 遇到 15 分鐘一格的部分時段調查會把「最大的 15 分鐘流率」誤標成尖峰小時。
  const best = peakFromBuckets(hourly);
  return [best.label, best.value];
}
function projectRecords(records: TrafficRecord[], projectId: string) {
  return records.filter((r) => r.projectId === projectId);
}
function normalizeProjectTrafficRecords(records: TrafficRecord[]) {
  const normalized = records.map((r) => {
    const roadId = normalizeRoadId(r.roadId);
    const meta = roadMetaByStableId.get(roadId);
    const cleanedName = roadNameFromFileName(r.roadName);
    const roadName = isFallbackRoadName(cleanedName)
      ? (meta?.name ?? cleanedName)
      : cleanedName;
    const surveyType = r.surveyType ?? (r.turnData ? "intersection" : "road");
    const fallbackDirection =
      r.directionCode === "A"
        ? meta?.a
        : r.directionCode === "B"
          ? meta?.b
          : undefined;
    const defaultDirection =
      surveyType === "intersection"
        ? `駛出路口${r.directionCode}`
        : `方向${r.directionCode}`;
    /*
     * 判斷「這是不是佔位值」全系統只能有一套標準，否則會互相拆台：
     * 這裡原本用 /^方向[AB]$/（不分 A、B，也不去頭尾空白），
     * 而路段管理與合併用的是 isRealDirectionName()。兩邊對同一個字串
     * 給相反的答案時，畫面上改好的名字會在下次重新整理被這裡改回去。
     * 另外 `fallbackDirection ?? defaultDirection` 的 `??` 擋不住空字串——
     * 設定檔裡的方向名稱是空的時，整條路段的方向名稱會被寫成空白。
     */
    const placeholderCode =
      r.directionCode === "A" || r.directionCode === "B"
        ? r.directionCode
        : null;
    const hasOwnName = placeholderCode
      ? isRealDirectionName(r.directionName, placeholderCode)
      : !!String(r.directionName ?? "").trim();
    const metaDirection = String(fallbackDirection ?? "").trim();
    const directionName = hasOwnName
      ? r.directionName
      : metaDirection || defaultDirection;
    return { ...r, roadId, roadName, directionName, surveyType };
  });
  const preferredNames = new Map<string, string>();
  normalized.forEach((r) => {
    const current = preferredNames.get(r.roadId);
    const candidateScore =
      (isFallbackRoadName(r.roadName) ? 0 : 1000) + r.roadName.length;
    const currentScore = current
      ? (isFallbackRoadName(current) ? 0 : 1000) + current.length
      : -1;
    if (candidateScore > currentScore) preferredNames.set(r.roadId, r.roadName);
  });
  return normalized.map((r) => ({
    ...r,
    roadName: preferredNames.get(r.roadId) ?? r.roadName,
  }));
}
function xmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function colName(n: number) {
  let s = "";
  while (n) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
function ProfessionalLineChart({
  rows,
  unit,
}: {
  rows: TrendRow[];
  unit: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // 重畫的觸發條件除了資料以外，還要包含「畫布尺寸改變」。畫布是照實際
  // 尺寸以實體像素重畫的，只綁資料的話，改變視窗大小或切換版面之後畫面
  // 會維持舊解析度被拉伸，線條變糊、座標軸文字也跟著歪掉。
  const [canvasSize, setCanvasSize] = useState("");
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setCanvasSize(`${Math.round(box.width)}x${Math.round(box.height)}`);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const box = canvasContentBox(canvas);
    const dpr = window.devicePixelRatio || 1,
      width = box.width,
      height = box.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const c = canvas.getContext("2d");
    if (!c) return;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, width, height);
    const left = 70,
      right = 28,
      top = 28,
      bottom = 48,
      w = width - left - right,
      h = height - top - bottom;
    const max = Math.max(
      1,
      ...rows
        .flatMap((r) => [r.weekday, r.holiday])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    );
    c.font = "11px Microsoft JhengHei, sans-serif";
    c.textAlign = "right";
    c.fillStyle = "#708090";
    c.strokeStyle = "#E3EAEF";
    for (let i = 0; i <= 4; i++) {
      const y = top + (h * i) / 4;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(width - right, y);
      c.stroke();
      c.fillText(
        formatter.format(Math.round((max * (4 - i)) / 4)),
        left - 10,
        y + 4,
      );
    }
    c.save();
    c.translate(15, top + h / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = "center";
    c.fillText(unit, 0, 0);
    c.restore();
    const draw = (key: "weekday" | "holiday", color: string) => {
      /* 整條都沒有值就整條不畫（例如被日別篩選掉的那一條）。 */
      const hasAny = rows.some((r) => typeof r[key] === "number");
      if (!hasAny) return;
      c.beginPath();
      let started = false;
      rows.forEach((r, i) => {
        const value = r[key];
        /* 缺值要斷線，不是拉一條到 0 的線。 */
        if (typeof value !== "number" || !Number.isFinite(value)) {
          started = false;
          return;
        }
        const x =
          left + (rows.length === 1 ? w / 2 : (w * i) / (rows.length - 1));
        const y = top + h - (value / max) * h;
        if (started) c.lineTo(x, y);
        else c.moveTo(x, y);
        started = true;
      });
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.stroke();
      rows.forEach((r, i) => {
        const value = r[key];
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        const x =
          left + (rows.length === 1 ? w / 2 : (w * i) / (rows.length - 1));
        const y = top + h - (value / max) * h;
        c.beginPath();
        c.arc(x, y, 4, 0, Math.PI * 2);
        c.fillStyle = "#fff";
        c.fill();
        c.strokeStyle = color;
        c.lineWidth = 2.5;
        c.stroke();
      });
    };
    draw("weekday", palette.teal);
    draw("holiday", palette.orange);
    c.textAlign = "center";
    c.fillStyle = "#526170";
    rows.forEach((r, i) =>
      c.fillText(
        r.quarter,
        left + (rows.length === 1 ? w / 2 : (w * i) / (rows.length - 1)),
        height - 17,
      ),
    );
  }, [rows, unit, canvasSize]);
  return (
    <canvas
      ref={ref}
      className="trend-canvas"
      aria-label="歷季平日與假日趨勢圖"
    />
  );
}
function IntersectionGeometryDiagram({
  settings,
  sourceCode,
}: {
  settings: IntersectionArmSetting[];
  sourceCode: string;
}) {
  const center = 210,
    outer = 165,
    inner = 82;
  const point = (angle: number, radius: number) => {
    const radian = (normalizeAngle(angle) * Math.PI) / 180;
    return {
      x: center + Math.cos(radian) * radius,
      y: center + Math.sin(radian) * radius,
    };
  };
  const source = settings.find(
    (setting) => setting.directionCode === sourceCode,
  );
  const colors: Record<TurnKey, string> = {
    left: palette.orange,
    through: palette.teal,
    right: palette.blue,
  };
  return (
    <svg
      className="intersection-geometry-diagram"
      viewBox="0 0 420 420"
      role="img"
      aria-label="路口支線角度與轉向預覽"
    >
      <defs>
        {(["left", "through", "right"] as TurnKey[]).map((turn) => (
          <marker
            key={turn}
            id={`traffic-arrow-${turn}`}
            markerWidth="7"
            markerHeight="7"
            refX="6"
            refY="3.5"
            orient="auto"
          >
            <path d="M0 0 L7 3.5 L0 7 z" fill={colors[turn]} />
          </marker>
        ))}
      </defs>
      <circle cx={center} cy={center} r="54" className="geometry-junction" />
      {settings.map((setting) => {
        const start = point(setting.angle, 55),
          end = point(setting.angle, outer),
          label = point(setting.angle, 190);
        return (
          <g key={setting.directionCode}>
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              className={
                setting.directionCode === sourceCode
                  ? "geometry-arm selected"
                  : "geometry-arm"
              }
            />
            <circle
              cx={end.x}
              cy={end.y}
              r="18"
              className="geometry-arm-code"
            />
            <text
              x={end.x}
              y={end.y + 5}
              textAnchor="middle"
              className="geometry-code"
            >
              {setting.directionCode}
            </text>
            <text
              x={label.x}
              y={label.y}
              textAnchor="middle"
              className="geometry-label"
            >
              {setting.name}
            </text>
          </g>
        );
      })}
      {source &&
        settings
          .filter((target) => target.directionCode !== source.directionCode)
          .map((target) => {
            const movement =
              source.routes[target.directionCode] ??
              classifyMovement(source.angle, target.angle);
            const from = point(source.angle, inner),
              to = point(target.angle, inner);
            return (
              <path
                key={`${source.directionCode}-${target.directionCode}`}
                d={`M ${from.x} ${from.y} Q ${center} ${center} ${to.x} ${to.y}`}
                fill="none"
                stroke={colors[movement]}
                strokeWidth="3"
                opacity=".82"
                markerEnd={`url(#traffic-arrow-${movement})`}
              />
            );
          })}
      <text
        x={center}
        y={center - 5}
        textAnchor="middle"
        className="geometry-center"
      >
        {source ? `由 ${source.directionCode} 駛出` : "路口"}
      </text>
      <text
        x={center}
        y={center + 16}
        textAnchor="middle"
        className="geometry-center-sub"
      >
        {/* 全形空白是刻意的排版字元，包成字串才不會被 no-irregular-whitespace 誤判 */}
        {"綠：直行　橘：左轉　藍：右轉"}
      </text>
    </svg>
  );
}

/**
 * 取得 canvas 真正可以畫圖的區域（content box）。
 *
 * canvas 是 replaced element：點陣圖是被縮放進 content box，不是 border box。
 * 舊寫法用 clientWidth（含左右 padding）當點陣圖寬度、又把高度寫死成常數，
 * 結果整張圖被非等比壓縮——實測 24 小時圖被垂直壓到 87%、水平壓到 97%，
 * 旋轉的 Y 軸標籤肉眼就看得出變形。改成一律以 content box 為準。
 */
function canvasContentBox(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  const style = window.getComputedStyle(canvas);
  const trim = (a: string, b: string) =>
    (parseFloat(style.getPropertyValue(a)) || 0) +
    (parseFloat(style.getPropertyValue(b)) || 0);
  return {
    width: Math.max(1, rect.width - trim("padding-left", "padding-right")),
    height: Math.max(1, rect.height - trim("padding-top", "padding-bottom")),
  };
}

/**
 * 每小時 24 格的實際車輛數與 PCU。
 *
 * 呼叫端負責先把 records 篩成「單一日別」——這個函式只是把同一批紀錄
 * 依小時分組相加。跨日別相加沒有意義（見 HourlyCanvas 的說明）。
 * 沒有調查到的小時回 null 而不是 0：部分時段調查若把其餘 20 小時畫成 0，
 * 折線會貼著底軸拉成一直線，看起來像「白天完全沒有車」。
 */
function hourlySeriesOf(
  records: TrafficRecord[],
  factors: PcuFactors,
  turnFactors: TurnPcuFactors,
  vehicleSettings: VehicleClassSetting[],
) {
  return Array.from({ length: 24 }, (_, hour) => {
    const hit = records.filter((r) => hourStartOf(r.hour) === hour);
    return {
      hour,
      surveyed: hit.length > 0,
      actual: hit.length ? hit.reduce((s, r) => s + sumVehicles(r), 0) : null,
      pcu: hit.length
        ? hit.reduce(
            (s, r) => s + sumPcu(r, factors, turnFactors, vehicleSettings),
            0,
          )
        : null,
    };
  });
}

function HourlyCanvas({
  records,
  factors,
  turnFactors,
  vehicleSettings,
}: {
  records: TrafficRecord[];
  factors: PcuFactors;
  turnFactors: TurnPcuFactors;
  vehicleSettings: VehicleClassSetting[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  /*
   * 每小時的量必須「依日別分開」。
   *
   * 舊寫法只用小時篩選再全部相加，日別選「平日＋假日」時就把平日 18:00 的
   * 量和假日 18:00 的量加起來，卻標成「輛/小時」——那個數字既不是平日也不是
   * 假日的量（實測 2,779.5 + 2,134.0 = 4,913.5，比平日尖峰高 76.8%），
   * 而同一份 Excel 的另一張表寫的是 2,779.5，兩張表互相矛盾。
   *「平日＋假日」的意思是兩者一起呈現、可以互相對照，不是相加。
   * 歷季趨勢圖本來就是畫成平日、假日兩條線，這裡比照辦理。
   */
  const dayTypes = useMemo(() => {
    const seen: string[] = [];
    for (const record of records)
      if (record.dayType && !seen.includes(record.dayType))
        seen.push(record.dayType);
    return seen.length ? seen : [""];
  }, [records]);
  const seriesByDay = useMemo(
    () =>
      dayTypes.map((dayType) => ({
        dayType,
        points: hourlySeriesOf(
          records.filter((r) => !dayType || r.dayType === dayType),
          factors,
          turnFactors,
          vehicleSettings,
        ),
      })),
    [dayTypes, records, factors, turnFactors, vehicleSettings],
  );
  // 重畫的觸發條件除了資料以外，還要包含「畫布尺寸改變」。畫布是照實際
  // 尺寸以實體像素重畫的，只綁資料的話，改變視窗大小或切換版面之後畫面
  // 會維持舊解析度被拉伸，線條變糊、座標軸文字也跟著歪掉。
  const [canvasSize, setCanvasSize] = useState("");
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setCanvasSize(`${Math.round(box.width)}x${Math.round(box.height)}`);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const box = canvasContentBox(canvas);
    const dpr = window.devicePixelRatio || 1,
      width = box.width,
      height = box.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const c = canvas.getContext("2d");
    if (!c) return;
    c.scale(dpr, dpr);
    c.clearRect(0, 0, width, height);
    const left = 68,
      right = 24,
      top = 24,
      bottom = 44,
      w = width - left - right,
      h = height - top - bottom,
      max = Math.max(
        1,
        ...seriesByDay
          .flatMap((group) => group.points)
          .flatMap((v) => [v.actual, v.pcu])
          .filter((v): v is number => v != null),
      );
    c.font = "11px Microsoft JhengHei";
    c.fillStyle = "#708090";
    c.textAlign = "right";
    c.strokeStyle = "#E3EAEF";
    for (let i = 0; i <= 4; i++) {
      const y = top + (h * i) / 4;
      c.beginPath();
      c.moveTo(left, y);
      c.lineTo(width - right, y);
      c.stroke();
      c.fillText(
        formatter.format(Math.round((max * (4 - i)) / 4)),
        left - 9,
        y + 4,
      );
    }
    const draw = (
      points: { actual: number | null; pcu: number | null }[],
      key: "actual" | "pcu",
      color: string,
      dash: number[] = [],
      width: number = 3,
    ) => {
      c.beginPath();
      // 沒有資料的小時要斷線（重新起筆），不要把缺口兩端連成一條直線。
      let pen = false;
      points.forEach((v, i) => {
        const value = v[key];
        if (value == null) {
          pen = false;
          return;
        }
        const x = left + (w * i) / 23,
          y = top + h - (value / max) * h;
        if (pen) c.lineTo(x, y);
        else c.moveTo(x, y);
        pen = true;
      });
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.stroke();
      c.setLineDash([]);
    };
    /*
     * 一種日別畫一組線（實際量、PCU），彼此不相加。
     * 只有一種日別時就跟以前一模一樣；兩種並列時，第二種用較細的線，
     * 讓兩天的形狀可以直接疊起來比較。
     */
    seriesByDay.forEach((group, index) => {
      const lineWidth = index === 0 ? 3 : 2;
      draw(group.points, "actual", index === 0 ? palette.teal : "#7fb2c7", [], lineWidth);
      draw(
        group.points,
        "pcu",
        index === 0 ? palette.orange : "#e7b27a",
        [7, 4],
        lineWidth,
      );
    });
    c.textAlign = "center";
    c.fillStyle = "#526170";
    [0, 3, 6, 9, 12, 15, 18, 21, 23].forEach((i) =>
      c.fillText(
        `${String(i).padStart(2, "0")}:00`,
        left + (w * i) / 23,
        height - 15,
      ),
    );
    c.save();
    c.translate(14, top + h / 2);
    c.rotate(-Math.PI / 2);
    c.fillText("輛／小時、PCU／小時", 0, 0);
    c.restore();
    // 兩種日別並列時要標出哪條是哪一天，否則四條線看不出所以然。
    if (seriesByDay.length > 1) {
      c.textAlign = "left";
      c.font = "11px Microsoft JhengHei";
      seriesByDay.forEach((group, index) => {
        c.fillStyle = index === 0 ? palette.teal : "#7fb2c7";
        c.fillText(
          `${group.dayType || "全部"}${index === 0 ? "（粗線）" : "（細線）"}`,
          left + 6 + index * 110,
          top - 8,
        );
      });
    }
  }, [seriesByDay, canvasSize]);
  return (
    <canvas
      className="hourly-canvas"
      ref={ref}
      aria-label="每小時實際交通量與PCU趨勢圖"
    />
  );
}
function chartXml(
  title: string,
  categories: string,
  series: {
    name: string;
    formula: string;
    color: string;
    /** null ＝ 該點沒有資料，圖上要斷線（不可寫成 0，也不可寫進 XML） */
    cache: (number | null)[];
  }[],
  type: "bar" | "line" | "doughnut" = "bar",
) {
  const catCount = series[0]?.cache.length ?? 0;
  const doughnutColors = [
    "148C8C",
    "E58A2B",
    "5B8DB8",
    "D8E7F1",
    "7E6BC4",
    "D65F75",
    "6FA45D",
    "9B6A43",
    "4CA6C9",
    "A0A0A0",
  ];
  const ser = series
    .map(
      (s, i) =>
        `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xmlText(s.name)}</c:v></c:tx>${type === "doughnut" ? s.cache.map((_, point) => `<c:dPt><c:idx val="${point}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${doughnutColors[point % doughnutColors.length]}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join("") : `<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`}${type === "line" ? '<c:marker><c:symbol val="circle"/><c:size val="6"/></c:marker>' : ""}<c:cat><c:strRef><c:f>${xmlText(categories)}</c:f><c:strCache><c:ptCount val="${catCount}"/></c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${xmlText(s.formula)}</c:f><c:numCache><c:formatCode>#,##0.0</c:formatCode><c:ptCount val="${s.cache.length}"/>${s.cache.map((v, j) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "" : `<c:pt idx="${j}"><c:v>${Number(v)}</c:v></c:pt>`)).join("")}</c:numCache></c:numRef></c:val></c:ser>`,
    )
    .join("");
  const doughnutLabels = `<c:dLbls><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="zh-TW"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:separator>&#10;</c:separator><c:showLeaderLines val="1"/><c:leaderLines><c:spPr><a:ln w="12700"><a:solidFill><a:srgbClr val="8A98A6"/></a:solidFill></a:ln></c:spPr></c:leaderLines></c:dLbls>`;
  const plot =
    type === "bar"
      ? `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser}<c:gapWidth val="85"/><c:axId val="123456"/><c:axId val="123457"/></c:barChart>`
      : type === "line"
        ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser}<c:marker val="1"/><c:smooth val="0"/><c:axId val="123456"/><c:axId val="123457"/></c:lineChart>`
        : `<c:doughnutChart><c:varyColors val="1"/>${ser}${doughnutLabels}<c:firstSliceAng val="270"/><c:holeSize val="58"/></c:doughnutChart>`;
  const axes =
    type === "doughnut"
      ? ""
      : `<c:catAx><c:axId val="123456"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="123457"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="123457"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="#,##0.0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="123456"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:date1904 val="0"/><c:lang val="zh-TW"/><c:roundedCorners val="0"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="1"/></a:pPr><a:r><a:rPr lang="zh-TW"/><a:t>${xmlText(title)}</a:t></a:r></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart><c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>`;
}
async function addNativeCharts(
  buffer: ArrayBuffer,
  chartSheetIndex: number,
  specs: {
    title: string;
    categories: string;
    series: {
      name: string;
      formula: string;
      color: string;
      cache: (number | null)[];
    }[];
    type?: "bar" | "line" | "doughnut";
  }[],
) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml")!.async("string");
  const chartSheetTag = workbookXml.match(
    /<sheet[^>]*name="可編輯圖表"[^>]*>/,
  )?.[0];
  const detectedSheetIndex = Number(
    chartSheetTag?.match(/sheetId="(\d+)"/)?.[1],
  );
  if (detectedSheetIndex) chartSheetIndex = detectedSheetIndex;
  const sheetPath = `xl/worksheets/sheet${chartSheetIndex}.xml`;
  const sheetFile = zip.file(sheetPath);
  // 找不到圖表工作表時直接放棄注入，把原檔案還回去。
  // 硬套一個猜測的編號會把圖表畫到別張表上，或在 zip.file() 回傳 null 時整個崩掉。
  if (!sheetFile) return buffer;
  let sheet = await sheetFile.async("string");
  sheet = sheet.replace(
    "</worksheet>",
    '<drawing r:id="rIdNativeCharts"/></worksheet>',
  );
  zip.file(sheetPath, sheet);
  const relPath = `xl/worksheets/_rels/sheet${chartSheetIndex}.xml.rels`;
  let rel = zip.file(relPath)
    ? await zip.file(relPath)!.async("string")
    : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  rel = rel.replace(
    "</Relationships>",
    '<Relationship Id="rIdNativeCharts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
  );
  zip.file(relPath, rel);
  const anchors = specs
    .map((_, i) => {
      const row = i * 22;
      return `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>11</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 20}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
    })
    .join("");
  zip.file(
    "xl/drawings/drawing1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`,
  );
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("")}</Relationships>`,
  );
  specs.forEach((s, i) =>
    zip.file(
      `xl/charts/chart${i + 1}.xml`,
      chartXml(s.title, s.categories, s.series, s.type),
    ),
  );
  let types = await zip.file("[Content_Types].xml")!.async("string");
  types = types.replace(
    "</Types>",
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${specs.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("")}</Types>`,
  );
  zip.file("[Content_Types].xml", types);
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}
export default function DashboardClient({ user }: { user: User }) {
  /*
   * 沒有登入時就是離線模式，這個旗標由 app-fetch.ts 的 offlineMode() 讀取。
   *
   * 規則的顧慮是對的——在 render 期間寫入元件外的變數不是好習慣。這裡刻意
   * 保留原樣並就地豁免，理由是：改成 effect 會晚一個 commit 才設好旗標，
   * 而這個旗標的用途正是「在任何 appFetch 發生之前就決定要不要打 API」。
   * 要改的話應該連同 offlineMode() 一起改成由 props/context 傳遞，
   * 那是獨立的重構，不該夾在其他修正裡順手做。
   */
  /* eslint-disable react-hooks/immutability -- 理由見上面那段註解 */
  if (typeof window !== "undefined" && !user)
    (
      window as unknown as { __TRAFFIC_OFFLINE__?: boolean }
    ).__TRAFFIC_OFFLINE__ = true;
  /* eslint-enable react-hooks/immutability */
  const [projects, setProjects] = useState<Project[]>([]);
  const [offline, setOffline] = useState(!user);
  const [activeProject, setActiveProject] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [records, setRecords] = useState<TrafficRecord[]>([]);
  const [quarter, setQuarter] = useState("");
  const [dayType, setDayType] = useState<DayMode>("平日");
  const [direction, setDirection] = useState<Direction>("ALL");
  const [intersectionFlowMode, setIntersectionFlowMode] =
    useState<IntersectionFlowMode>("origin");
  // 尖峰時段以「整個調查點」為準（各方向相加＝合計，可與路口整體尖峰的報表對數字），
  // 或讓每個方向各自認定自己的尖峰小時。預設前者。
  const [periodPeakScope, setPeriodPeakScope] = useState<PeakScope>("point");
  /*
   * 這一區自己的「路口流量視角」。預設 follow ＝ 跟著上方工具列，
   * 但也可以在這一區直接指定，或選 both 把駛出與駛入兩種視角並列，
   * 不必為了看另一邊而去改上方的設定、影響其他所有表單。
   */
  const [periodFlowView, setPeriodFlowView] = useState<
    "follow" | IntersectionFlowMode | "both"
  >("follow");
  const [search, setSearch] = useState("");
  const [roadFilter, setRoadFilter] = useState("ALL");
  const [pcuFactors, setPcuFactors] = useState<PcuFactors>(PCU_FACTORS);
  const [pcuDraft, setPcuDraft] = useState<PcuFactors>(PCU_FACTORS);
  const [turnPcuFactors, setTurnPcuFactors] =
    useState<TurnPcuFactors>(TURN_PCU_FACTORS);
  const [turnPcuDraft, setTurnPcuDraft] =
    useState<TurnPcuFactors>(TURN_PCU_FACTORS);
  const [showTurnFactors, setShowTurnFactors] = useState(false);
  const [showVehicleManager, setShowVehicleManager] = useState(false);
  const [vehicleClassSettings, setVehicleClassSettings] = useState<
    VehicleClassSetting[]
  >([]);
  const [vehicleClassDraft, setVehicleClassDraft] = useState<
    VehicleClassSetting[]
  >([]);
  // 記住每個車種「獨立分析」時使用者自訂的當量，切去四大類再切回來時可以還原。
  const independentPcuMemory = useRef(
    new Map<string, { roadPcu: number; turnPcu: VehicleClassSetting["turnPcu"] }>(),
  );
  const [dayMetric, setDayMetric] = useState<Metric>("actual");
  const [trendMetric, setTrendMetric] = useState<Metric>("actual");
  const [trendMode, setTrendMode] = useState<TrendMode>("平日＋假日");
  const [trendRoad, setTrendRoad] = useState("ALL");
  const [compositionMode, setCompositionMode] =
    useState<CompositionMode>("平日");
  const [compositionRoad, setCompositionRoad] = useState("ALL");
  const [compositionDirection, setCompositionDirection] = useState("ALL");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showQuarterManager, setShowQuarterManager] = useState(false);
  const [showRoadManager, setShowRoadManager] = useState(false);
  const [showIntersectionManager, setShowIntersectionManager] = useState(false);
  const [intersectionManageRoad, setIntersectionManageRoad] = useState("");
  const [intersectionDiagramSource, setIntersectionDiagramSource] =
    useState("");
  const [intersectionSettings, setIntersectionSettings] = useState<
    IntersectionArmSetting[]
  >([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [roadAliases, setRoadAliases] = useState<RoadAlias[]>([]);
  const [roadManageId, setRoadManageId] = useState("");
  const [roadDraft, setRoadDraft] = useState({
    roadName: "",
    directionA: "方向A",
    directionB: "方向B",
    aliasName: "",
    mergeTarget: "",
  });
  const [quarterDraft, setQuarterDraft] = useState("2026Q2");
  const [newProject, setNewProject] = useState({
    name: "",
    code: "",
    clientName: "",
  });
  const [projectDraft, setProjectDraft] = useState({
    name: "",
    code: "",
    clientName: "",
  });
  const [share, setShare] = useState({
    email: "",
    role: "viewer" as "viewer" | "editor",
  });
  const [importQuarter, setImportQuarter] = useState("2026Q3");
  const [pendingImport, setPendingImport] = useState<{
    files: File[];
    records: TrafficRecord[];
    report: ReturnType<typeof validateImport>;
  } | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowState>(emptyWorkflowState());
  const [workflowReady, setWorkflowReady] = useState(false);
  const [showQualityCenter, setShowQualityCenter] = useState(false);
  const [showHistoryCenter, setShowHistoryCenter] = useState(false);
  const [showTemplateCenter, setShowTemplateCenter] = useState(false);
  const [showExportCenter, setShowExportCenter] = useState(false);
  /* 結論草稿產生器：預設收合，展開後才會去重算全部季度的分析列。 */
  const [conclusionOpen, setConclusionOpen] = useState(false);
  const [conclusionCondition, setConclusionCondition] =
    useState<ConclusionCondition>(DEFAULT_CONCLUSION_CONDITION);
  const [conclusionDraft, setConclusionDraft] = useState("");
  const [conclusionEdited, setConclusionEdited] = useState(false);
  const [conclusionTemplates, setConclusionTemplates] = useState<
    ConclusionTemplate[]
  >([]);
  const [conclusionTemplateName, setConclusionTemplateName] = useState("");
  /*
   * 換計畫時把範本換成該計畫自己的那一組，並把草稿與條件重設。
   * 不重設的話，會把 A 計畫的路段代碼帶到 B 計畫，篩出 0 列卻找不出原因。
   */
  useEffect(() => {
    setConclusionTemplates(readConclusionTemplates(activeProject));
    setConclusionCondition(DEFAULT_CONCLUSION_CONDITION);
    setConclusionDraft("");
    setConclusionEdited(false);
  }, [activeProject]);
  const [templateName, setTemplateName] = useState("");
  const [reportTemplateName, setReportTemplateName] = useState("");
  // 時段車種分析區塊的顯示設定（只影響畫面，不影響匯出勾選）
  const [periodView, setPeriodView] = useState<PeriodKey | "ALL">("ALL");
  const [periodMetric, setPeriodMetric] = useState<MetricKey>("count");
  const [periodScopeFilter, setPeriodScopeFilter] = useState<string[]>([]);
  // 時段車種分析的匯出勾選（會跟著報表範本一起存起來）
  const [periodExport, setPeriodExport] = useState<PeriodExportSelection>(
    defaultPeriodExportSelection(),
  );
  // 勾選項目一律由 app/report-draft.ts 的共用清單推導，畫面與報告草稿
  // 才不會各自維護一份而漏掉其中一邊（見 tests/report-draft.test.mjs）。
  // 報告文字草稿：勾選哪些段落、目前的文字、以及使用者是否手動改過。
  const [draftSections, setDraftSections] = useState<DraftSectionKey[]>(
    () => [...DRAFT_SECTION_ORDER],
  );
  const [reportDraft, setReportDraft] = useState("");
  const [draftEdited, setDraftEdited] = useState(false);
  /** 車種視窗關閉之後要接著打開的路口幾何視窗（兩個不可以同時開）。 */
  const [pendingIntersectionRoad, setPendingIntersectionRoad] = useState("");
  /** 關閉車種視窗；若匯入時同時需要設定路口幾何，接著把那個視窗打開。 */
  function closeVehicleManager() {
    setShowVehicleManager(false);
    if (pendingIntersectionRoad) {
      setIntersectionManageRoad(pendingIntersectionRoad);
      setPendingIntersectionRoad("");
      setShowIntersectionManager(true);
    }
  }
  const [exportSections, setExportSections] = useState<Record<string, boolean>>(
    () => Object.fromEntries(EXPORT_SECTIONS.map((item) => [item.key, true])),
  );
  /*
   * 換計畫時要把匯出勾選還原成預設。
   *
   * 這兩組勾選是元件狀態，不屬於任何計畫，也沒有存檔。舊版換到新建立的
   * 計畫時會沿用上一個計畫的勾選——實測在 A 計畫取消了兩個區塊之後，
   * 新建的 B 計畫一開啟就少了那兩張工作表，而畫面上完全看不出來。
   * 沒有做成「每個計畫各存一份」是因為它們也還沒有存檔機制；還原成預設
   * 至少是可預期的行為，不會把別的案子的設定帶過來。
   */
  const lastExportProject = useRef(activeProject);
  useEffect(() => {
    if (lastExportProject.current === activeProject) return;
    lastExportProject.current = activeProject;
    setExportSections(
      Object.fromEntries(EXPORT_SECTIONS.map((item) => [item.key, true])),
    );
    setPeriodExport(defaultPeriodExportSelection());
    setDraftSections([...DRAFT_SECTION_ORDER]);
    setDraftEdited(false);
  }, [activeProject]);
  useEffect(() => setOffline(offlineMode()), []);
  useEffect(() => {
    appFetch("/api/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.projects) {
          const available = d.projects as Project[];
          setProjects(available);
          if (available.length) {
            setActiveProject((current) =>
              available.some((p) => p.id === current)
                ? current
                : available[0].id,
            );
            setCompareIds((ids) =>
              ids.some((id) => available.some((p) => p.id === id))
                ? ids
                : [available[0].id],
            );
          }
        }
      })
      .catch(() => setToast("計畫資料讀取失敗"));
  }, []);
  useEffect(() => {
    const ids = compareIds;
    if (!ids.length) return;
    appFetch(`/api/traffic?projectIds=${encodeURIComponent(ids.join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.rows)
          setRecords((prev) => [
            ...prev.filter((r) => !ids.includes(String(r.projectId))),
            ...d.rows,
          ]);
      })
      .catch(() => setToast("部分跨計畫資料載入失敗"));
  }, [compareIds]);
  useEffect(() => {
    if (!activeProject) return;
    appFetch(`/api/traffic?projectIds=${encodeURIComponent(activeProject)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.rows) {
          setRecords((prev) => [
            ...prev.filter((r) => r.projectId !== activeProject),
            ...d.rows,
          ]);
          const latest = (d.rows as TrafficRecord[])
            .map((r) => r.quarter)
            .sort(compareQuarters)
            .at(-1);
          if (latest) setQuarter(latest);
        }
      })
      .catch(() => setToast("計畫資料載入失敗"));
  }, [activeProject]);
  useEffect(() => {
    if (!activeProject) {
      setRoadAliases([]);
      return;
    }
    appFetch(`/api/roads?projectId=${encodeURIComponent(activeProject)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.aliases) setRoadAliases(d.aliases);
      })
      .catch(() => setToast("路段別名載入失敗"));
  }, [activeProject]);
  useEffect(() => {
    let cancelled = false;
    setWorkflowReady(false);
    if (!activeProject) {
      setWorkflow(emptyWorkflowState());
      return;
    }
    loadWorkflow(activeProject).then((state) => {
      if (!cancelled) {
        setWorkflow(state);
        setWorkflowReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);
  useEffect(() => {
    if (activeProject && workflowReady)
      saveWorkflow(activeProject, workflow).catch(() =>
        setToast("品質與版本資料保存失敗"),
      );
  }, [activeProject, workflow, workflowReady]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    try {
      const settings = JSON.parse(
        localStorage.getItem("traffic-intersection-settings-v1") ?? "[]",
      );
      if (Array.isArray(settings)) setIntersectionSettings(settings);
      const vehicleSettings = JSON.parse(
        localStorage.getItem("traffic-vehicle-class-settings-v1") ?? "[]",
      );
      if (Array.isArray(vehicleSettings))
        setVehicleClassSettings(vehicleSettings);
    } catch {
      /* 舊版或損壞的設定就跳過，維持預設值 */
    }
  }, []);
  /*
   * PCU 係數是「每個計畫一組」。
   *
   * v20.10 以前只存一組（traffic-pcu-factors-v1），所有計畫共用：在 B 計畫把
   * 機車改成 0.42，切回 A 計畫也會變成 0.42，等於把別的計畫的標準套到這個
   * 計畫的數據上。現在改存成 {計畫代碼: 係數} 的對照表；
   * 升級時會把舊的那一組明確寫進當時已存在的每一個計畫（見
   * migrateLegacyPcuFactors），之後就完全沒有共用來源：沒有自己設定過的
   * 計畫一律使用系統預設值，畫面上也會標示出來。
   */
  const activeProjectFactorsLoaded = useRef("");
  const [projectHasOwnFactors, setProjectHasOwnFactors] = useState(false);
  useEffect(() => {
    if (!activeProject) return;
    if (activeProjectFactorsLoaded.current === activeProject) return;
    activeProjectFactorsLoaded.current = activeProject;
    // 搬遷只會真正執行一次，但要等計畫清單載入後才知道有哪些計畫
    migrateLegacyPcuFactors(projects.map((item) => item.id));
    const nextPcu = readProjectPcuFactors(activeProject);
    const nextTurn = readProjectTurnPcuFactors(activeProject);
    setPcuFactors(nextPcu);
    setPcuDraft(nextPcu);
    setTurnPcuFactors(nextTurn);
    setTurnPcuDraft(structuredClone(nextTurn));
    setProjectHasOwnFactors(hasOwnPcuFactors(activeProject));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProject, projects.length]);
  /**
   * 外部「PCU 當量係數」一改動，就把「車種分類與新增當量」裡歸類到原四大類的
   * 鎖定欄位一起改成同一組數字（含尚未開啟過的計畫），避免兩邊顯示不一致。
   * 實際計算本來就是以外部係數為準，這裡讓儲存下來的值也跟著一致。
   */
  const persistCoreVehicleSync = (
    core: PcuFactors,
    coreTurns: TurnPcuFactors,
  ) => {
    // 寫入 localStorage 是副作用，不能放在 setState 的更新函式裡
    // （React 嚴格模式會重複執行更新函式，會造成重複寫入）。
    const next = syncCoreVehicleSettings(
      vehicleClassSettings,
      core,
      coreTurns,
    );
    const changed =
      next.length !== vehicleClassSettings.length ||
      next.some((setting, index) => setting !== vehicleClassSettings[index]);
    if (changed) {
      setVehicleClassSettings(next);
      safeWrite("traffic-vehicle-class-settings-v1", next);
    }
    setVehicleClassDraft((previous) =>
      syncCoreVehicleSettings(previous, core, coreTurns),
    );
  };
  const applyPcuFactors = () => {
    if (
      !Object.values(pcuDraft).every((v) => Number.isFinite(v)) ||
      !Object.values(turnPcuDraft)
        .flatMap((value) => Object.values(value))
        .every((v) => Number.isFinite(v))
    ) {
      setToast("PCU係數必須是有效數字");
      return;
    }
    setPcuFactors({ ...pcuDraft });
    setTurnPcuFactors(structuredClone(turnPcuDraft));
    const savedRoad = writeProjectPcuFactors(activeProject, pcuDraft);
    const savedTurn = writeProjectTurnPcuFactors(activeProject, turnPcuDraft);
    setProjectHasOwnFactors(true);
    persistCoreVehicleSync(pcuDraft, turnPcuDraft);
    setToast(
      savedRoad && savedTurn
        ? "本計畫的路段與路口轉向PCU係數已套用（各計畫各自獨立，不會影響其他計畫）"
        : "係數已套用到目前畫面，但無法寫入瀏覽器儲存（可能空間已滿或瀏覽器封鎖網站資料），關閉後會失效——請先匯出備份並清理舊資料。",
    );
  };
  const resetPcuFactors = () => {
    setPcuDraft({ ...PCU_FACTORS });
    setPcuFactors({ ...PCU_FACTORS });
    setTurnPcuDraft(structuredClone(TURN_PCU_FACTORS));
    setTurnPcuFactors(structuredClone(TURN_PCU_FACTORS));
    writeProjectPcuFactors(activeProject, { ...PCU_FACTORS });
    writeProjectTurnPcuFactors(activeProject, structuredClone(TURN_PCU_FACTORS));
    setProjectHasOwnFactors(true);
    persistCoreVehicleSync(PCU_FACTORS, TURN_PCU_FACTORS);
    setToast("已恢復本計畫的路段與路口轉向預設PCU係數");
  };
  /**
   * 各分析區塊自己的篩選列。
   *
   * 這些控制項綁的就是最上方工具列的同一組狀態，所以在哪邊改都一樣、
   * 也不會產生第二套互相矛盾的條件；差別只在使用者不必為了換一個條件
   * 就把畫面捲回最上面再捲回來。每個區塊只列出它真正吃得到的條件。
   */
  const renderBlockFilters = (show: {
    quarter?: boolean;
    day?: boolean;
    road?: boolean;
    direction?: boolean;
    flow?: boolean;
  }) => (
    <div className="block-filters">
      {show.quarter && (
        <label>
          季度
          <select value={quarter} onChange={(e) => setQuarter(e.target.value)}>
            {quarters.map((q) => (
              <option key={q}>{q}</option>
            ))}
          </select>
        </label>
      )}
      {show.day && (
        <label>
          日別
          <select
            value={dayType}
            onChange={(e) => setDayType(e.target.value as DayMode)}
          >
            <option>平日</option>
            <option>假日</option>
            <option>平日＋假日</option>
          </select>
        </label>
      )}
      {show.road && (
        <label>
          路段／路口
          <select
            value={roadFilter}
            onChange={(e) => setRoadFilter(e.target.value)}
          >
            <option value="ALL">全部調查點</option>
            {roadOptions.map(([id, name]) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.flow && hasIntersectionRecords && (
        <label>
          路口流量視角
          <select
            value={intersectionFlowMode}
            onChange={(e) => {
              setIntersectionFlowMode(e.target.value as IntersectionFlowMode);
              setDirection("ALL");
              setCompositionDirection("ALL");
            }}
          >
            <option value="origin">駛出路口（起點）</option>
            <option value="destination">駛入路口（終點）</option>
          </select>
        </label>
      )}
      {show.direction && (
        <label>
          車流方向
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
          >
            <option value="ALL">全部方向</option>
            {directionOptions.map(([code, name]) => (
              <option value={code} key={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
  /** origin ＝ 從這條支線出發 → 駛出；destination ＝ 開進這條支線 → 駛入 */
  const intersectionFlowLabelOf = (mode: IntersectionFlowMode) =>
    mode === "destination" ? "駛入" : "駛出";
  const displayDirectionNameFor = (
    record: TrafficRecord,
    mode: IntersectionFlowMode,
  ) => {
    if (record.surveyType !== "intersection" && !record.turnData)
      return record.directionName || `方向${record.directionCode}`;
    if (record.directionCode === "UNMAPPED") return "未指定駛入路口";
    const setting = intersectionSettings.find(
      (item) =>
        item.projectId === activeProject &&
        item.roadId === record.roadId &&
        item.directionCode === record.directionCode,
    );
    const customName = setting?.name?.trim();
    const flowLabel = intersectionFlowLabelOf(mode);
    return `${flowLabel}路口${record.directionCode}${customName && customName !== `路口${record.directionCode}` ? `（${customName}）` : ""}`;
  };
  const displayDirectionName = (record: TrafficRecord) =>
    displayDirectionNameFor(record, intersectionFlowMode);
  const activeRecords = useMemo(
    () =>
      // 目的支線格式的轉向分類在這裡即時計算，
      // 使用者調整路口幾何後，所有分析會立刻跟著更新。
      resolveDestinationTurns(
        normalizeProjectTrafficRecords(projectRecords(records, activeProject)),
        activeProject,
        intersectionSettings,
      ),
    [records, activeProject, intersectionSettings],
  );
  const analysisRecords = useMemo(() => {
    const flowRecords =
      intersectionFlowMode === "destination"
        ? deriveDestinationIntersectionRecords(
            activeRecords,
            activeProject,
            intersectionSettings,
          )
        : activeRecords;
    return flowRecords.map((record) =>
      record.surveyType === "intersection" || record.turnData
        ? { ...record, directionName: displayDirectionName(record) }
        : record,
    );
  }, [
    activeRecords,
    intersectionSettings,
    activeProject,
    intersectionFlowMode,
  ]);
  const activeVehicleSourceCatalog = useMemo(() => {
    const labels = new Map<string, string>();
    activeRecords.forEach((record) =>
      Object.keys(rawVehicleCounts(record)).forEach((key) =>
        labels.set(
          key,
          rawVehicleLabels(record)[key] ?? key.replace(/^custom:/, ""),
        ),
      ),
    );
    return [...labels]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-TW"));
  }, [activeRecords]);
  const analysisVehicleCatalog = useMemo(
    () => vehicleCatalog(analysisRecords, vehicleClassSettings, false),
    [analysisRecords, vehicleClassSettings],
  );
  const missingFactors = useMemo(
    () => missingVehicleFactors(activeRecords, vehicleClassSettings),
    [activeRecords, vehicleClassSettings],
  );
  function openVehicleClassManager() {
    if (!activeVehicleSourceCatalog.length)
      return setToast("目前計畫尚未匯入車種資料");
    // 每次重新打開都從乾淨狀態開始：上次按「取消」而沒有套用的暫存值，
    // 不應該在這一次被還原回來。
    independentPcuMemory.current.clear();
    setVehicleClassDraft(
      syncCoreVehicleSettings(
        activeVehicleSourceCatalog.map(
          (item) =>
            vehicleClassSettings.find(
              (setting) =>
                setting.projectId === activeProject &&
                setting.sourceKey === item.key,
            ) ?? defaultVehicleSetting(activeProject, item.key, item.label),
        ),
        pcuFactors,
        turnPcuFactors,
      ),
    );
    setShowVehicleManager(true);
  }
  function updateVehicleClassDraft(
    sourceKey: string,
    patch: Partial<VehicleClassSetting>,
  ) {
    setVehicleClassDraft((previous) =>
      previous.map((setting) =>
        setting.sourceKey === sourceKey ? { ...setting, ...patch } : setting,
      ),
    );
  }
  function changeVehicleTarget(sourceKey: string, targetKey: string) {
    const source = vehicleClassDraft.find(
      (setting) => setting.sourceKey === sourceKey,
    );
    if (!source) return;
    if (targetKey === sourceKey) {
      // 從「併入四大類」切回「獨立車種」時，把使用者先前自訂的當量還原回來，
      // 不要留下四大類的數值讓人誤以為那是自己設定過的。
      const remembered = independentPcuMemory.current.get(
        `${activeProject}::${sourceKey}`,
      );
      updateVehicleClassDraft(sourceKey, {
        targetKey,
        targetLabel: source.sourceLabel,
        ...(remembered
          ? {
              roadPcu: remembered.roadPcu,
              turnPcu: { ...remembered.turnPcu },
            }
          : {}),
      });
      return;
    }
    if (source.targetKey === source.sourceKey)
      independentPcuMemory.current.set(`${activeProject}::${sourceKey}`, {
        roadPcu: source.roadPcu,
        turnPcu: { ...source.turnPcu },
      });
    const coreKey = targetKey as CoreVehicleKey;
    updateVehicleClassDraft(sourceKey, {
      targetKey: coreKey,
      targetLabel: coreVehicleLabels[coreKey],
      roadPcu: pcuFactors[coreKey],
      turnPcu: { ...turnPcuFactors[coreKey] },
    });
  }
  function saveVehicleClassSettings(e: React.FormEvent) {
    e.preventDefault();
    const invalid = vehicleClassDraft.find(
      (setting) =>
        !CORE_VEHICLE_KEYS.includes(setting.targetKey as CoreVehicleKey) &&
        (!Number.isFinite(setting.roadPcu) ||
          Object.values(setting.turnPcu).some(
            (value) => !Number.isFinite(value),
          )),
    );
    if (invalid)
      return setToast(
        `「${invalid.sourceLabel}」保留為獨立車種時，4 個PCU係數都必須是有效數字`,
      );
    // 係數不設下限（依需求由使用者自訂），但 0 或負數會讓該車種在 PCU 相關
    // 分析中被歸零，這種情況多半是打錯，存檔後主動提醒一次。
    const zeroFactors = vehicleClassDraft.filter(
      (setting) =>
        !CORE_VEHICLE_KEYS.includes(setting.targetKey as CoreVehicleKey) &&
        (setting.roadPcu <= 0 ||
          Object.values(setting.turnPcu).some((value) => value <= 0)),
    );
    // 本計畫在其他季度才會出現的車種，不能因為目前季度沒看到就把設定清掉。
    const draftKeys = new Set(
      vehicleClassDraft.map((setting) => setting.sourceKey),
    );
    const next = syncCoreVehicleSettings(
      [
        ...vehicleClassSettings.filter(
          (setting) =>
            setting.projectId !== activeProject ||
            !draftKeys.has(setting.sourceKey),
        ),
        ...vehicleClassDraft,
      ],
      pcuFactors,
      turnPcuFactors,
    );
    setVehicleClassSettings(next);
    /* 走 safeWrite：寫入失敗時要說出來，不能讓例外從事件處理逃出去。 */
    if (!safeWrite("traffic-vehicle-class-settings-v1", next))
      setToast("車種分類設定沒有存進瀏覽器（空間可能已滿），重新整理後會回到舊值");
    // 套用之後也要走同一條關閉路徑，接著開路口幾何視窗。
    closeVehicleManager();
    setToast(
      zeroFactors.length
        ? `車種歸類與獨立當量已套用；請注意「${zeroFactors.map((setting) => setting.sourceLabel).join("、")}」有 0 或負數的 PCU 係數，該車種在 PCU 相關分析中會被歸零`
        : "車種歸類與獨立當量已套用至全部分析及匯出檔",
    );
  }
  const quarters = useMemo(
    // 季度排序一律用 compareQuarters：民國三碼與西元四碼（匯入預設值就是
    // 2026Q3）並存時，字串比大小會把 2026Q1 排在 115Q4 之後，但那其實是
    // 民國 115Q1，比 115Q4 更早——整條趨勢線與「最新一季」都會是錯的。
    () => [...new Set(activeRecords.map((r) => r.quarter))].sort(compareQuarters),
    [activeRecords],
  );
  useEffect(() => {
    if (!quarters.length) {
      if (quarter) setQuarter("");
      return;
    }
    if (!quarters.includes(quarter)) setQuarter(quarters.at(-1) ?? "");
  }, [quarters, quarter, activeProject]);
  const directionOptions = useMemo(() => {
    const names = new Map<string, Set<string>>();
    analysisRecords
      .filter((record) => roadFilter === "ALL" || record.roadId === roadFilter)
      .forEach((record) =>
        names.set(
          record.directionCode,
          new Set([
            ...(names.get(record.directionCode) ?? []),
            displayDirectionName(record),
          ]),
        ),
      );
    return [...names]
      .map(([code, labels]) => {
        /*
         * 同一個方向代碼在不同調查點可能有不同名稱。選「全部調查點」時，
         * 舊寫法把**每一個調查點的名稱**用「／」全部串起來——14 個調查點都
         * 各自命名過之後，一個選項就變成上百字，把整條篩選列撐出畫面。
         * （CSS 那邊也做了寬度上限當保險，但真正的問題是這串字本身沒有意義：
         * 使用者要選的是「方向 A」，不是把 14 個名字讀完。）
         * 超過兩個就只列前兩個，其餘用「等 N 種」帶過。
         */
        const list = [...labels];
        const label =
          list.length <= 2
            ? list.join("／")
            : `${list[0]}／${list[1]} 等 ${list.length} 種`;
        return [code, label] as [string, string];
      })
      .sort((a, b) =>
        a[0] === "UNMAPPED"
          ? 1
          : b[0] === "UNMAPPED"
            ? -1
            : a[0].localeCompare(b[0]),
      );
  }, [
    analysisRecords,
    intersectionSettings,
    activeProject,
    intersectionFlowMode,
    roadFilter,
  ]);
  const scoped = useMemo(
    () =>
      analysisRecords.filter(
        (r) =>
          r.quarter === quarter &&
          (dayType === "平日＋假日" || r.dayType === dayType) &&
          (roadFilter === "ALL" || r.roadId === roadFilter) &&
          (r.roadName.includes(search) || r.roadId.includes(search)),
      ),
    [analysisRecords, quarter, dayType, roadFilter, search],
  );
  const filtered = useMemo(
    () =>
      scoped.filter(
        (r) => direction === "ALL" || r.directionCode === direction,
      ),
    [scoped, direction],
  );
  /**
   * 目前篩選條件下，這批資料實際涵蓋了哪些時段。
   * 上下午各 N 小時、每 15 分鐘一格的部分時段調查，會在這裡被辨識出來，
   * 供尖峰小時改用滾動視窗、以及在「全日」數值旁加註說明。
   */
  /*
   * 調查涵蓋範圍要「逐調查點」判斷。
   * 把畫面上所有調查點的時段混在一起算，只要有一個 24 小時調查點，
   * 合併後就會看起來像完整的 24 小時，於是部分時段的提醒整塊消失、
   * 欄位標題也退回「全日」，但那一列其實只調查了幾個小時。
   */
  const surveyScope: SurveyCoverage = useMemo(() => {
    const byRoad = new Map<string, string[]>();
    for (const record of filtered) {
      const list = byRoad.get(record.roadId) ?? [];
      list.push(record.hour ?? "");
      byRoad.set(record.roadId, list);
    }
    const coverages = [...byRoad.values()].map((hours) => surveyCoverage(hours));
    // 只要有任何一個調查點是部分時段，就以那一個為準顯示提醒；
    // 全部都是完整 24 小時時，才回報「完整」。
    return (
      coverages.find((coverage) => coverage.partial) ??
      coverages[0] ??
      surveyCoverage([])
    );
  }, [filtered]);
  const surveyScopeNote = useMemo(() => coverageNote(surveyScope), [surveyScope]);
  const partialDayNotice = surveyScope.partial ? (
    <div className="partial-day-note">
      <b>本季資料為部分時段調查（非 24 小時）</b>
      <p>{surveyScopeNote}</p>
      <small>
        尖峰小時已依實測資料以「連續{" "}
        {surveyScope.intervalMinutes
          ? `${Math.round(60 / surveyScope.intervalMinutes)} 個 ${surveyScope.intervalMinutes} 分鐘`
          : "1 小時"}{" "}
        區間＝1 小時」的滾動視窗搜尋，上午與下午各自認定，且不會跨越兩段調查之間的空檔（2022
        年臺灣公路容量手冊式 2.10 僅定義尖峰小時係數，未規定固定時鐘區間）。
      </small>
    </div>
  ) : null;

  const roadRows = useMemo(() => {
    type DirectionAccumulator = {
      name: string;
      actual: number;
      pcu: number;
      hp: Map<string, number>;
    };
    type SummaryAccumulator = Omit<RoadSummary, "directions"> & {
      hp: Map<string, number>;
      directionMap: Map<string, DirectionAccumulator>;
    };
    const map = new Map<string, SummaryAccumulator>();
    filtered.forEach((r) => {
      const x = map.get(r.roadId) ?? {
        roadId: r.roadId,
        roadName: r.roadName,
        motorcycle: 0,
        small: 0,
        large: 0,
        special: 0,
        vehicles: {} as Record<string, number>,
        a: 0,
        b: 0,
        aPcu: 0,
        bPcu: 0,
        total: 0,
        pcu24: 0,
        peakPcu: 0,
        peakHour: "—",
        aPeakPcu: 0,
        aPeakHour: "—",
        bPeakPcu: 0,
        bPeakHour: "—",
        surveyType: r.surveyType ?? (r.turnData ? "intersection" : "road"),
        hp: new Map(),
        directionMap: new Map(),
      };
      // surveyType 只在建立累加器時取第一筆的值；同一個調查點如果後面才出現
      // 轉向資料，這個調查點就會一直被當成路段，「方向A／方向B」兩欄照樣填
      // 數字，但那只是前兩條支線，跟全日總量對不起來。任何一筆是路口就升級。
      if (r.surveyType === "intersection" || r.turnData)
        x.surveyType = "intersection";
      const groups = effectiveVehicleCounts(r, vehicleClassSettings);
      Object.entries(groups).forEach(([vehicle, count]) => {
        x.vehicles[vehicle] = (x.vehicles[vehicle] ?? 0) + count;
      });
      x.motorcycle = x.vehicles.motorcycle ?? 0;
      x.small = x.vehicles.small ?? 0;
      x.large = x.vehicles.large ?? 0;
      x.special = x.vehicles.special ?? 0;
      const v = sumVehicles(r),
        p = sumPcu(r, pcuFactors, turnPcuFactors, vehicleClassSettings),
        peakKey = dayType === "平日＋假日" ? `${r.dayType}|${r.hour}` : r.hour;
      x.total += v;
      x.pcu24 += p;
      x.hp.set(peakKey, (x.hp.get(peakKey) ?? 0) + p);
      const d = x.directionMap.get(r.directionCode) ?? {
        name: displayDirectionName(r),
        actual: 0,
        pcu: 0,
        hp: new Map(),
      };
      d.actual += v;
      d.pcu += p;
      d.hp.set(peakKey, (d.hp.get(peakKey) ?? 0) + p);
      x.directionMap.set(r.directionCode, d);
      if (r.directionCode === "A") {
        x.a += v;
        x.aPcu += p;
      }
      if (r.directionCode === "B") {
        x.b += v;
        x.bPcu += p;
      }
      map.set(r.roadId, x);
    });
    return [...map.values()]
      .map((x) => {
        // 尖峰小時的求法要看資料的時間格：
        // 每小時一列 → 取最大的那一列（原本的做法，結果不變）；
        // 15 分鐘一格的部分時段調查 → 取連續 4 格＝1 小時的滾動視窗最大值。
        // 平日＋假日一起看時，兩種日別各自找自己的尖峰再取大者。
        const peakOfBuckets = (hp: Map<string, number>) => {
          const peak = peakFromBuckets(hp);
          return { peakPcu: peak.value, peakHour: peak.label };
        };
        const roadPeak = peakOfBuckets(x.hp);
        x.peakPcu = roadPeak.peakPcu;
        x.peakHour = roadPeak.peakHour;
        const directions = [...x.directionMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([code, d]) => {
            const { peakPcu, peakHour } = peakOfBuckets(d.hp);
            return {
              code,
              name: d.name,
              actual: d.actual,
              pcu: d.pcu,
              peakPcu,
              peakHour,
            };
          });
        const a = directions.find((d) => d.code === "A"),
          b = directions.find((d) => d.code === "B");
        x.aPeakPcu = a?.peakPcu ?? 0;
        x.aPeakHour = a?.peakHour ?? "—";
        x.bPeakPcu = b?.peakPcu ?? 0;
        x.bPeakHour = b?.peakHour ?? "—";
        const { hp: _hp, directionMap: _directionMap, ...summary } = x;
        return { ...summary, directions };
      })
      .sort((a, b) => b.total - a.total);
  }, [
    filtered,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    dayType,
    intersectionSettings,
    activeProject,
  ]);
  const roadOnlyRows = useMemo(
    () => roadRows.filter((row) => row.surveyType === "road"),
    [roadRows],
  );
  const intersectionOnlyRows = useMemo(
    () => roadRows.filter((row) => row.surveyType === "intersection"),
    [roadRows],
  );
  const intersectionDirectionCodes = useMemo(
    () =>
      [
        ...new Set(
          intersectionOnlyRows.flatMap((row) =>
            row.directions.map((item) => item.code),
          ),
        ),
      ].sort(),
    [intersectionOnlyRows],
  );
  const totals = useMemo(
    () =>
      roadRows.reduce(
        (a, r) => {
          Object.entries(r.vehicles).forEach(([vehicle, count]) => {
            a.vehicles[vehicle] = (a.vehicles[vehicle] ?? 0) + count;
          });
          a.total += r.total;
          a.pcu24 += r.pcu24;
          return a;
        },
        { vehicles: {} as Record<string, number>, total: 0, pcu24: 0 },
      ),
    [roadRows],
  );
  const directionPeaks = useMemo(
    () => ({
      combined: peakOf(
        scoped,
        pcuFactors,
        turnPcuFactors,
        vehicleClassSettings,
        dayType === "平日＋假日",
      ),
      /*
       * 每一個方向代碼可能同時對應到好幾個調查點：路段的「方向A」與路口的
       *「駛出路口A」都是代碼 A。這裡是把它們同一小時的量相加，得到的是
       *「這個代碼涵蓋的所有調查點在該小時的合計」，不是任何單一調查點的
       * 尖峰。舊版的標籤沒有講這件事，實測 1,490.0 與 1,374.1 兩個調查點
       * 被顯示成一個 2,864.1「方向A」的尖峰，讀者會以為那是一條路的量。
       * 現在把涵蓋幾個調查點一起帶出去，由畫面標示。
       */
      items: directionOptions.map(([code, name]) => {
        const rows = scoped.filter((r) => r.directionCode === code);
        return {
          code,
          name,
          roadCount: new Set(rows.map((r) => r.roadId)).size,
          peak: peakOf(
            rows,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            dayType === "平日＋假日",
          ),
        };
      }),
    }),
    [
      scoped,
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
      dayType,
      directionOptions,
    ],
  );
  const dayComparisons = useMemo(() => {
    const map = new Map<string, DayComparison>();
    analysisRecords
      .filter(
        (r) =>
          r.quarter === quarter &&
          (roadFilter === "ALL" || r.roadId === roadFilter) &&
          (r.roadName.includes(search) || r.roadId.includes(search)),
      )
      .forEach((r) => {
        const x = map.get(r.roadId) ?? {
          roadId: r.roadId,
          roadName: r.roadName,
          weekdayActual: 0,
          holidayActual: 0,
          weekdayPcu: 0,
          holidayPcu: 0,
        };
        if (r.dayType === "平日") {
          x.weekdayActual += sumVehicles(r);
          x.weekdayPcu += sumPcu(
            r,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
          );
        } else {
          x.holidayActual += sumVehicles(r);
          x.holidayPcu += sumPcu(
            r,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
          );
        }
        map.set(r.roadId, x);
      });
    return [...map.values()].sort(
      (a, b) =>
        Math.max(b.weekdayActual, b.holidayActual) -
        Math.max(a.weekdayActual, a.holidayActual),
    );
  }, [
    analysisRecords,
    quarter,
    roadFilter,
    search,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
  ]);
  const roadOptions = useMemo(
    () => [...new Map(activeRecords.map((r) => [r.roadId, r.roadName]))],
    [activeRecords],
  );
  const roadManagerRows = useMemo(
    () =>
      roadOptions.map(([roadId, roadName]) => {
        const rows = activeRecords.filter((r) => r.roadId === roadId);
        const directions = [
          ...new Map(rows.map((r) => [r.directionCode, r.directionName])),
        ].sort(([a], [b]) => a.localeCompare(b));
        const surveyType = rows.some(
          (r) => r.surveyType === "intersection" || r.turnData,
        )
          ? ("intersection" as const)
          : ("road" as const);
        return {
          roadId,
          roadName,
          rows: rows.length,
          quarters: [...new Set(rows.map((r) => r.quarter))].sort(compareQuarters),
          // 空字串也要退回佔位值：舊資料裡有人把方向名稱清空過，
          // `?? "方向A"` 擋不住空字串，管理畫面就會出現一格空白的方向名稱。
          directionA: pickDirectionName(
            "A",
            rows.find((r) => r.directionCode === "A")?.directionName,
          ),
          directionB: pickDirectionName(
            "B",
            rows.find((r) => r.directionCode === "B")?.directionName,
          ),
          directions,
          surveyType,
        };
      }),
    [activeRecords, roadOptions],
  );
  const intersectionManagerRows = useMemo(
    () => roadManagerRows.filter((r) => r.surveyType === "intersection"),
    [roadManagerRows],
  );
  const effectiveIntersectionSettings = useMemo(
    () =>
      intersectionManagerRows.flatMap((row) =>
        buildArmSettings(
          activeProject,
          row.roadId,
          row.directions.map(([directionCode]) => directionCode),
          intersectionSettings,
        ),
      ),
    [intersectionManagerRows, intersectionSettings, activeProject],
  );
  const managedRoad = roadManagerRows.find((r) => r.roadId === roadManageId);
  const managedIntersection = intersectionManagerRows.find(
    (r) => r.roadId === intersectionManageRoad,
  );
  const managedArmSettings = useMemo(() => {
    if (!managedIntersection) return [];
    return buildArmSettings(
      activeProject,
      managedIntersection.roadId,
      managedIntersection.directions.map(([directionCode]) => directionCode),
      intersectionSettings,
    );
  }, [managedIntersection, intersectionSettings, activeProject]);
  useEffect(() => {
    if (!intersectionManagerRows.length) {
      setIntersectionManageRoad("");
      return;
    }
    if (
      !intersectionManagerRows.some((r) => r.roadId === intersectionManageRoad)
    )
      setIntersectionManageRoad(intersectionManagerRows[0].roadId);
  }, [intersectionManagerRows, intersectionManageRoad]);
  useEffect(() => {
    if (!managedArmSettings.length) {
      setIntersectionDiagramSource("");
      return;
    }
    if (
      !managedArmSettings.some(
        (setting) => setting.directionCode === intersectionDiagramSource,
      )
    )
      setIntersectionDiagramSource(managedArmSettings[0].directionCode);
  }, [managedArmSettings, intersectionDiagramSource]);
  useEffect(() => {
    const current =
      roadManagerRows.find((r) => r.roadId === roadManageId) ??
      roadManagerRows[0];
    if (!current) return;
    if (current.roadId !== roadManageId) setRoadManageId(current.roadId);
    setRoadDraft((d) => ({
      roadName: current.roadName,
      directionA: current.directionA,
      directionB: current.directionB,
      aliasName: "",
      mergeTarget: d.mergeTarget === current.roadId ? "" : d.mergeTarget,
    }));
  }, [roadManageId, roadManagerRows]);
  useEffect(() => {
    if (roadFilter !== "ALL" && !roadOptions.some(([id]) => id === roadFilter))
      setRoadFilter("ALL");
    if (trendRoad !== "ALL" && !roadOptions.some(([id]) => id === trendRoad))
      setTrendRoad("ALL");
    if (
      compositionRoad !== "ALL" &&
      !roadOptions.some(([id]) => id === compositionRoad)
    )
      setCompositionRoad("ALL");
    if (
      direction !== "ALL" &&
      !directionOptions.some(([code]) => code === direction)
    )
      setDirection("ALL");
    if (
      compositionDirection !== "ALL" &&
      !directionOptions.some(([code]) => code === compositionDirection)
    )
      setCompositionDirection("ALL");
  }, [
    roadOptions,
    roadFilter,
    trendRoad,
    compositionRoad,
    directionOptions,
    direction,
    compositionDirection,
  ]);
  const trendRows = useMemo(() => {
    const map = new Map<string, TrendRow>();
    analysisRecords
      .filter((r) => trendRoad === "ALL" || r.roadId === trendRoad)
      .forEach((r) => {
        const x = map.get(r.quarter) ?? {
          quarter: r.quarter,
          /*
           * 預設 null 而不是 0：一個「只做了平日調查」的季度，假日應該是
           * 「沒有這種日別的資料」（斷線／空白），不是「假日交通量是 0」。
           */
          weekday: null as number | null,
          holiday: null as number | null,
        };
        const v =
          trendMetric === "actual"
            ? sumVehicles(r)
            : sumPcu(r, pcuFactors, turnPcuFactors, vehicleClassSettings);
        if (r.dayType === "平日") x.weekday = (x.weekday ?? 0) + v;
        else x.holiday = (x.holiday ?? 0) + v;
        map.set(r.quarter, x);
      });
    return [...map.values()]
      .sort((a, b) => compareQuarters(a.quarter, b.quarter))
      /*
       * 被篩掉的那一條要給 null（不畫），不能給 0。
       * 給 0 的話那條線不會消失，而是變成沿著 X 軸的一條水平直線、每一季
       * 都有一個實心圓點，圖例也還列著——看起來像「這幾季假日交通量真的是
       * 0」。同一批 trendRows 也會進 Excel 的折線圖，錯誤會一起交出去。
       */
      .map((r) => ({
        quarter: r.quarter,
        weekday: trendMode === "假日" ? null : r.weekday,
        holiday: trendMode === "平日" ? null : r.holiday,
      }));
  }, [
    analysisRecords,
    trendRoad,
    trendMetric,
    trendMode,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
  ]);
  const compositionRecords = useMemo(
    () =>
      analysisRecords.filter(
        (r) =>
          r.quarter === quarter &&
          (compositionMode === "平日＋假日" || r.dayType === compositionMode) &&
          (compositionRoad === "ALL" || r.roadId === compositionRoad) &&
          (compositionDirection === "ALL" ||
            r.directionCode === compositionDirection),
      ),
    [
      analysisRecords,
      quarter,
      compositionMode,
      compositionRoad,
      compositionDirection,
    ],
  );
  const compositionTotals = useMemo(
    () =>
      compositionRecords.reduce(
        (a, r) => {
          Object.entries(
            effectiveVehicleCounts(r, vehicleClassSettings),
          ).forEach(([vehicle, count]) => {
            a.vehicles[vehicle] = (a.vehicles[vehicle] ?? 0) + count;
          });
          a.total += sumVehicles(r);
          return a;
        },
        { vehicles: {} as Record<string, number>, total: 0 },
      ),
    [compositionRecords, vehicleClassSettings],
  );
  const compositionItems = useMemo(
    () =>
      analysisVehicleCatalog.map((vehicle, index) => ({
        ...vehicle,
        count: compositionTotals.vehicles[vehicle.key] ?? 0,
        color: [
          "#148C8C",
          "#E58A2B",
          "#5B8DB8",
          "#D8E7F1",
          "#7E6BC4",
          "#D65F75",
          "#6FA45D",
          "#9B6A43",
          "#4CA6C9",
          "#A0A0A0",
        ][index % 10],
      })),
    [analysisVehicleCatalog, compositionTotals],
  );
  const compositionGradient = useMemo(() => {
    if (!compositionTotals.total) return "#D8E7F1";
    let start = 0;
    return `conic-gradient(${compositionItems
      .map((item) => {
        const end = start + (item.count / compositionTotals.total) * 100;
        const segment = `${item.color} ${start}% ${end}%`;
        start = end;
        return segment;
      })
      .join(",")})`;
  }, [compositionItems, compositionTotals.total]);
  const compositionExportRows = useMemo(() => {
    const modes: CompositionMode[] = ["平日", "假日", "平日＋假日"];
    const roads: [string, string][] = [
      ["ALL", "全部路段／路口"],
      ...roadOptions,
    ];
    const directions: [string, string][] = [
      ["ALL", "全部方向"],
      ...directionOptions,
    ];
    return modes.flatMap((mode) =>
      roads.flatMap(([roadId, roadName]) =>
        directions.map(([directionCode, directionName]) => {
          const rows = analysisRecords.filter(
            (r) =>
              r.quarter === quarter &&
              (mode === "平日＋假日" || r.dayType === mode) &&
              (roadId === "ALL" || r.roadId === roadId) &&
              (directionCode === "ALL" || r.directionCode === directionCode),
          );
          return rows.reduce(
            (a, r) => {
              Object.entries(
                effectiveVehicleCounts(r, vehicleClassSettings),
              ).forEach(([vehicle, count]) => {
                a.vehicles[vehicle] = (a.vehicles[vehicle] ?? 0) + count;
              });
              return a;
            },
            {
              dayType: mode,
              roadName,
              directionName,
              vehicles: {} as Record<string, number>,
            },
          );
        }),
      ),
    );
  }, [
    analysisRecords,
    quarter,
    roadOptions,
    directionOptions,
    vehicleClassSettings,
  ]);
  const historicalDailyRows = useMemo(() => {
    const map = new Map<
      string,
      {
        quarter: string;
        dayType: DayType;
        roadId: string;
        roadName: string;
        a: number;
        b: number;
        aPcu: number;
        bPcu: number;
        motorcycle: number;
        small: number;
        large: number;
        special: number;
        vehicles: Record<string, number>;
        total: number;
        pcu24: number;
        isIntersection: boolean;
      }
    >();
    analysisRecords.forEach((r) => {
      const key = `${r.quarter}|${r.dayType}|${r.roadId}`;
      const x = map.get(key) ?? {
        quarter: r.quarter,
        dayType: r.dayType,
        roadId: r.roadId,
        roadName: r.roadName,
        // 路口有 A～G 支線，「方向A／方向B」這兩欄只適用雙向路段；
        // 路口列必須留白，否則 a+b 只含前兩條支線，與全日總量對不起來。
        isIntersection: false,
        a: 0,
        b: 0,
        aPcu: 0,
        bPcu: 0,
        motorcycle: 0,
        small: 0,
        large: 0,
        special: 0,
        total: 0,
        pcu24: 0,
        vehicles: {} as Record<string, number>,
      };
      const v = sumVehicles(r),
        p = sumPcu(r, pcuFactors, turnPcuFactors, vehicleClassSettings);
      if (r.surveyType === "intersection" || r.turnData) x.isIntersection = true;
      x.total += v;
      x.pcu24 += p;
      const groups = effectiveVehicleCounts(r, vehicleClassSettings);
      Object.entries(groups).forEach(([vehicle, count]) => {
        x.vehicles[vehicle] = (x.vehicles[vehicle] ?? 0) + count;
      });
      x.motorcycle = x.vehicles.motorcycle ?? 0;
      x.small = x.vehicles.small ?? 0;
      x.large = x.vehicles.large ?? 0;
      x.special = x.vehicles.special ?? 0;
      if (r.directionCode === "A") {
        x.a += v;
        x.aPcu += p;
      } else if (r.directionCode === "B") {
        x.b += v;
        x.bPcu += p;
      }
      map.set(key, x);
    });
    return [...map.values()].sort(
      (a, b) =>
        compareQuarters(a.quarter, b.quarter) ||
        a.roadId.localeCompare(b.roadId) ||
        a.dayType.localeCompare(b.dayType),
    );
  }, [analysisRecords, pcuFactors, turnPcuFactors, vehicleClassSettings]);
  const historicalCompositionRows = useMemo(
    () =>
      historicalDailyRows.map((r) => ({
        ...r,
        vehiclePct: Object.fromEntries(
          analysisVehicleCatalog.map((vehicle) => [
            vehicle.key,
            r.total ? (r.vehicles[vehicle.key] ?? 0) / r.total : 0,
          ]),
        ),
      })),
    [historicalDailyRows, analysisVehicleCatalog],
  );
  const compositionTrendRows = useMemo(() => {
    const map = new Map<
      string,
      {
        quarter: string;
        vehicles: Record<string, number>;
        total: number;
      }
    >();
    analysisRecords
      .filter(
        (r) =>
          (compositionMode === "平日＋假日" || r.dayType === compositionMode) &&
          (compositionRoad === "ALL" || r.roadId === compositionRoad),
      )
      .forEach((r) => {
        const x = map.get(r.quarter) ?? {
          quarter: r.quarter,
          vehicles: {} as Record<string, number>,
          total: 0,
        };
        Object.entries(effectiveVehicleCounts(r, vehicleClassSettings)).forEach(
          ([vehicle, count]) => {
            x.vehicles[vehicle] = (x.vehicles[vehicle] ?? 0) + count;
          },
        );
        x.total += sumVehicles(r);
        map.set(r.quarter, x);
      });
    return [...map.values()]
      .sort((a, b) => compareQuarters(a.quarter, b.quarter))
      .map((r) => ({
        quarter: r.quarter,
        vehicles: Object.fromEntries(
          analysisVehicleCatalog.map((vehicle) => [
            vehicle.key,
            r.total ? (r.vehicles[vehicle.key] ?? 0) / r.total : 0,
          ]),
        ),
      }));
  }, [
    analysisRecords,
    compositionMode,
    compositionRoad,
    vehicleClassSettings,
    analysisVehicleCatalog,
  ]);
  const projectComparisons = useMemo(
    () =>
      projects
        .filter((p) => compareIds.includes(p.id))
        .map((p) => {
          const rows = projectRecords(records, p.id).filter(
            (r) =>
              r.quarter === quarter &&
              (dayType === "平日＋假日" || r.dayType === dayType),
          );
          /*
           * 每個計畫要用**它自己的** PCU 係數，不是目前開著那個計畫的。
           * 舊寫法一律用 pcuFactors／turnPcuFactors（activeProject 的那一組），
           * 於是「跨計畫比較」裡 B 計畫的 PCU 是用 A 的係數算的；切到 B 再
           * 匯出一次，同一列數字會變。而套用係數時的提示還向使用者保證
           * 「各計畫各自獨立，不會影響其他計畫」。
           */
          const ownPcu = readProjectPcuFactors(p.id);
          const ownTurnPcu = readProjectTurnPcuFactors(p.id);
          return {
            ...p,
            actual: rows.reduce((s, r) => s + sumVehicles(r), 0),
            pcu: rows.reduce(
              (s, r) =>
                s + sumPcu(r, ownPcu, ownTurnPcu, vehicleClassSettings),
              0,
            ),
          };
        }),
    [
      projects,
      compareIds,
      records,
      quarter,
      dayType,
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
    ],
  );
  /*
   * 每小時趨勢的資料列。
   *
   * 一定要依日別分開。舊寫法只用小時篩選再相加，日別選「平日＋假日」時
   * 同一小時的兩天量會被加起來卻標成「輛/小時」，同一份 Excel 裡的
   *「本季交通量及PCU」寫 2,779.5、這張表寫 4,913.5，互相矛盾。
   * 兩種日別都在時改成「一天一組列」，時段標籤前面加上日別；
   * 只有一種日別時輸出與以前完全相同。
   */
  const hourlyExportDayTypes = useMemo(() => {
    const seen: string[] = [];
    for (const record of filtered)
      if (record.dayType && !seen.includes(record.dayType))
        seen.push(record.dayType);
    return seen.length ? seen : [""];
  }, [filtered]);
  const hourlyExportRows = useMemo(
    () =>
      hourlyExportDayTypes.flatMap((exportDay) =>
      Array.from({ length: 24 }, (_, hour) => {
        const rows = filtered.filter(
          (r) =>
            hourStartOf(r.hour) === hour &&
            (!exportDay || r.dayType === exportDay),
        );
        // 部分時段調查（例如只做 07-09、17-19）沒有調查到的小時要留空，
        // 不能寫 0——寫 0 的話折線圖會被拉到底，看起來像「白天完全沒有車」。
        // 圖表已指定 dispBlanksAs="gap"，留空就會自動斷線。
        const surveyed = rows.length > 0;
        const label = `${String(hour).padStart(2, "0")}:00～${String((hour + 1) % 24).padStart(2, "0")}:00`;
        return {
          // 兩種日別都在時，時段標籤要帶日別，否則同一張表會出現兩個
          // 「18:00～19:00」而看不出誰是誰。只有一種日別時維持原樣。
          hour:
            hourlyExportDayTypes.length > 1 && exportDay
              ? `${exportDay} ${label}`
              : label,
          actual: surveyed ? rows.reduce((s, r) => s + sumVehicles(r), 0) : null,
          pcu: surveyed
            ? rows.reduce(
                (s, r) =>
                  s + sumPcu(r, pcuFactors, turnPcuFactors, vehicleClassSettings),
                0,
              )
            : null,
        };
      }),
      ),
    [
      hourlyExportDayTypes,
      filtered,
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
    ],
  );
  /*
   * 時段車種分析：完全獨立於上面既有的表單與圖表，自己一個區塊。
   * 沿用目前的季度／日別／調查點／搜尋條件，但「不吃」上面的車流方向下拉選單——
   * 這一區本來就會把每個方向（路段的方向A／方向B、路口的駛入/駛出各支線）各列一列。
   */
  const computePeriodRows = useCallback((
    peakScope: PeakScope,
    flowView: "follow" | IntersectionFlowMode | "both",
  ): PeriodRow[] => {
    const factors = {
      core: pcuFactors,
      coreTurns: turnPcuFactors,
      settings: vehicleClassSettings,
    };
    const modes: IntersectionFlowMode[] =
      flowView === "both"
        ? ["origin", "destination"]
        : [flowView === "follow" ? intersectionFlowMode : flowView];
    // 與 scoped 相同的篩選條件，但要在「這一區自己的視角」下重算，
    // 所以不能直接用 scoped（它已經套上工具列的視角了）。
    const inScope = (r: TrafficRecord) =>
      r.quarter === quarter &&
      (dayType === "平日＋假日" || r.dayType === dayType) &&
      (roadFilter === "ALL" || r.roadId === roadFilter) &&
      (r.roadName.includes(search) || r.roadId.includes(search));
    // 註：search 會一併影響匯出（periodExportRows 也走這個函式）。
    // 匯出中心的畫面有明確標示這件事，見「本次匯出範圍」那一段。
    const out: PeriodRow[] = [];
    for (const mode of modes) {
      const flowRecords =
        mode === "destination"
          ? deriveDestinationIntersectionRecords(
              activeRecords,
              activeProject,
              intersectionSettings,
            )
          : activeRecords;
      const rows = buildPeriodRows(flowRecords.filter(inScope), {
        factors,
        separateDays: dayType === "平日＋假日",
        scopeNameFor: (record) =>
          displayDirectionNameFor(record as unknown as TrafficRecord, mode),
        peakScope,
      });
      const flowLabel = intersectionFlowLabelOf(mode);
      const firstMode = mode === modes[0];
      out.push(
        ...rows
          .filter(
            // 「駛出／駛入」只對路口有意義：路段就是方向A／方向B，兩種視角
            // 算出來一模一樣。並列時若不濾掉，同一列會被輸出兩次，不但畫面
            // 重複，React 的 key 也會撞在一起，接著換篩選條件時舊的列不會
            // 被移除，看起來就像「篩選完全沒作用」。
            (row) => firstMode || row.surveyType === "intersection",
          )
          .map((row) =>
            /*
             * 每一列都要帶著「自己是用哪一種視角算出來的」。
             *
             * 舊版只在並列（駛出＋駛入）時才寫 flowLabel，單一視角時留空，
             * 畫面就退回去用**工具列**的 intersectionFlowLabel。但這一區有
             * 自己的「路口流量視角」下拉，兩者可以不一樣——於是在這裡選
             * 「駛入路口」時，數字換成駛入的了，調查點欄卻還寫著「（駛出）」。
             * 使用者實際回報：不管選駛入還是駛出，名稱始終顯示（駛出）。
             *
             * 合計那一列的「駛出・全部支線合計」字樣仍然只在並列時加，
             * 單一視角下沒有兩列要區分，加了反而囉嗦。
             */
            row.surveyType === "intersection"
              ? {
                  ...row,
                  flowLabel,
                  scopeName:
                    modes.length > 1 && row.scopeCode === "ALL"
                      ? `${flowLabel}・全部支線合計`
                      : row.scopeName,
                }
              : row,
          ),
      );
    }
    if (modes.length > 1)
      out.sort(
        (a, b) =>
          a.roadName.localeCompare(b.roadName, "zh-TW") ||
          a.roadId.localeCompare(b.roadId, "en") ||
          (a.flowLabel ?? "").localeCompare(b.flowLabel ?? "", "zh-TW") ||
          // 兩列都是 ALL 時必須回 0。寫成 (a==="ALL" ? -1 : ...) 會讓
          // compare(x,y) 與 compare(y,x) 同時回 -1，是一個不自洽的比較器。
          (a.scopeCode === "ALL" && b.scopeCode === "ALL"
            ? 0
            : a.scopeCode === "ALL"
              ? -1
              : b.scopeCode === "ALL"
                ? 1
                : 0) ||
          a.scopeCode.localeCompare(b.scopeCode, "en"),
      );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeRecords,
    quarter,
    dayType,
    roadFilter,
    search,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    intersectionSettings,
    intersectionFlowMode,
    activeProject,
  ]);
  const periodRows = useMemo(
    () => computePeriodRows(periodPeakScope, periodFlowView),
    [computePeriodRows, periodPeakScope, periodFlowView],
  );
  /**
   * 匯出用的列：匯出中心可以指定自己的「尖峰時段認定」與「路口流量視角」，
   * 選 follow 才沿用畫面上目前的設定。這樣存成範本之後，匯出結果不會因為
   * 有人在畫面上改過而跟著變。
   */
  /** 匯出中心實際採用的路口流量視角文字（並列時每一列自己帶，這裡給非並列用） */
  const periodExportFlowLabel = useMemo(() => {
    const choice =
      periodExport.flowView === "follow" ? periodFlowView : periodExport.flowView;
    const mode = choice === "follow" ? intersectionFlowMode : choice;
    return mode === "both" ? "駛出／駛入" : intersectionFlowLabelOf(mode);
  }, [periodExport.flowView, periodFlowView, intersectionFlowMode]);
  const periodExportRows = useMemo(
    () =>
      computePeriodRows(
        periodExport.peakScope === "follow"
          ? periodPeakScope
          : periodExport.peakScope,
        periodExport.flowView === "follow"
          ? periodFlowView
          : periodExport.flowView,
      ),
    [
      computePeriodRows,
      periodExport.peakScope,
      periodExport.flowView,
      periodPeakScope,
      periodFlowView,
    ],
  );
  /*
   * ── 結論草稿產生器：把每一個「季度 × 日別」各自跑一次 buildPeriodRows ──
   *
   * 畫面上的 periodRows 只涵蓋工具列選定的那一個季度與日別；結論草稿要能跨
   * 季度、跨日別敘述，所以這裡逐組重跑。用的是**同一支 buildPeriodRows 與
   * 同一組當量係數**，單位也是同一支 cellUnitFor，草稿的數字才不可能和畫面
   * 或 Excel 分岔。
   *
   * 只在使用者展開這一區時才算（conclusionOpen），否則每次改任何設定都要
   * 把全部季度重算一遍，資料多的計畫會明顯卡頓。
   */
  const conclusionRows = useMemo((): ConclusionRow[] => {
    if (!conclusionOpen) return [];
    const factors = {
      core: pcuFactors,
      coreTurns: turnPcuFactors,
      settings: vehicleClassSettings,
    };
    const out: ConclusionRow[] = [];
    /*
     * 結論草稿要能同時選「駛出路口」與「駛入路口」，不必先到上方工具列切視角。
     *
     * 這一段以前只算一次，用的是 activeRecords（永遠是駛出的分組），
     * 卻拿上方工具列的 intersectionFlowMode 去**命名**——所以切到駛入視角時，
     * 清單會寫「駛入路口A」，底下的數字卻還是駛出路口A 的。
     * 名稱與數字對不上，和 v20.24 那個 bug 同一類，而畫面上看不出來。
     *
     * 現在兩種視角各算各的：駛入是由 deriveDestinationIntersectionRecords
     * 依終點**重新分組**得到的，不是改名。兩邊的合計必然相等（同一批車），
     * 所以駛入那一輪不再重複產生「合計」列，只保留各支線。
     * 駛入的 scopeCode 加上 IN: 前綴，才不會和駛出的 A／B／C 撞在一起；
     * 駛出維持原本的代碼，既有的條件範本（存的是 A、B…）照樣適用。
     */
    const hasIntersection = activeRecords.some(
      (record) => record.surveyType === "intersection" || record.turnData,
    );
    const passes: { mode: IntersectionFlowMode; records: typeof activeRecords }[] =
      [{ mode: "origin", records: activeRecords }];
    if (hasIntersection)
      passes.push({
        mode: "destination",
        records: deriveDestinationIntersectionRecords(
          activeRecords,
          activeProject,
          intersectionSettings,
        ),
      });
    for (const pass of passes) {
    const quarterList = [...new Set(pass.records.map((r) => r.quarter))];
    const dayList = [...new Set(pass.records.map((r) => r.dayType || ""))];
    for (const q of quarterList)
      for (const day of dayList) {
        const subset = pass.records.filter(
          (r) => r.quarter === q && (r.dayType || "") === day,
        );
        if (!subset.length) continue;
        const rows = buildPeriodRows(subset, {
          factors,
          separateDays: false,
          scopeNameFor: (record) =>
            displayDirectionNameFor(
              record as unknown as TrafficRecord,
              pass.mode,
            ),
          peakScope: periodPeakScope,
        });
        for (const row of rows) {
          const periods: ConclusionRow["periods"] = {};
          for (const key of PERIOD_KEYS) {
            const source = row.periods[key];
            if (!source) continue;
            const labels = new Map<string, { count: number; pcu: number }>();
            for (const [vehicleKey, count] of Object.entries(source.vehicles)) {
              const label = periodVehicleLabel(
                subset as unknown as Parameters<typeof periodVehicleLabel>[0],
                vehicleKey,
                vehicleClassSettings,
              );
              const bucket = labels.get(label) || { count: 0, pcu: 0 };
              bucket.count += Number(count) || 0;
              bucket.pcu += Number(source.vehiclePcu[vehicleKey]) || 0;
              labels.set(label, bucket);
            }
            periods[key] = {
              hour: source.hour,
              hasData: source.hasData,
              total: source.total,
              pcu: source.pcu,
              // 單位一律由 cellUnitFor 逐格算，和畫面上那一格標的完全一致。
              unitCount: cellUnitFor("count", key, source.hour),
              unitPcu: cellUnitFor("pcu", key, source.hour),
              vehicles: [...labels.entries()].map(([label, value]) => ({
                label,
                count: value.count,
                pcu: value.pcu,
              })),
            };
          }
          /*
           * 駛入那一輪只保留「路口的支線」：
           *  ・合計列兩邊總量相同，不重複列。
           *  ・路段只有方向A／方向B，沒有駛出／駛入之分，重複列出來
           *    會讓清單出現兩個一模一樣的「方向A」，使用者根本分不出差別。
           */
          if (
            pass.mode === "destination" &&
            (row.scopeCode === "ALL" || row.surveyType !== "intersection")
          )
            continue;
          out.push({
            quarter: q,
            dayType: day || "未標示",
            roadId: row.roadId,
            roadName: row.roadName,
            surveyType: row.surveyType,
            scopeCode:
              pass.mode === "destination"
                ? `IN:${row.scopeCode}`
                : row.scopeCode,
            scopeName: row.scopeName,
            flowLabel: row.flowLabel,
            periods,
          });
        }
      }
    }
    return out;
  }, [
    conclusionOpen,
    activeRecords,
    activeProject,
    intersectionSettings,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    periodPeakScope,
  ]);

  const periodScopeOptions = useMemo(() => {
    // 路段的方向代碼是 A／B，路口支線的代碼也是 A～G，同一個計畫裡兩種格式並存時
    // 代碼會重疊，所以每個代碼把它實際對應到的所有名稱都列出來（例如「方向A／駛入路口A」），
    // 使用者才知道勾這一個代碼會同時涵蓋哪些列。
    const names = new Map<string, Set<string>>();
    for (const row of periodRows)
      names.set(
        row.scopeCode,
        new Set([...(names.get(row.scopeCode) ?? []), row.scopeName]),
      );
    return [...names]
      .sort((a, b) =>
        a[0] === "ALL"
          ? -1
          : b[0] === "ALL"
            ? 1
            : String(a[0]).localeCompare(String(b[0]), "en"),
      )
      .map(([code, set]) => ({ code, name: [...set].join("／") }));
  }, [periodRows]);
  // 換計畫或換季度後，原本勾選的調查點代碼可能已經不存在；若不清掉，畫面與匯出
  // 都會變成「明明有資料卻一列都出不來」。這裡只移除已消失的代碼，其餘保留。
  //
  // 重要：只在「換計畫／換季度」時清理。搜尋關鍵字與調查點下拉也會讓可選代碼
  // 暫時變少，若一併清掉，使用者一打字就會永久失去先前的勾選（清空搜尋也回不來）。
  const periodScopeScopeKey = `${activeProject}|${quarter}`;
  const lastPeriodScopeKey = useRef(periodScopeScopeKey);
  useEffect(() => {
    if (lastPeriodScopeKey.current === periodScopeScopeKey) return;
    lastPeriodScopeKey.current = periodScopeScopeKey;
    if (!periodScopeOptions.length) return;
    const available = new Set(periodScopeOptions.map((option) => option.code));
    setPeriodScopeFilter((previous) => {
      const next = previous.filter((code) => available.has(code));
      return next.length === previous.length ? previous : next;
    });
    setPeriodExport((previous) => {
      const next = previous.scopes.filter((code) => available.has(code));
      return next.length === previous.scopes.length
        ? previous
        : { ...previous, scopes: next };
    });
  }, [periodScopeScopeKey, periodScopeOptions]);
  const visiblePeriodRows = useMemo(
    () =>
      periodRows.filter(
        (row) =>
          !periodScopeFilter.length || periodScopeFilter.includes(row.scopeCode),
      ),
    [periodRows, periodScopeFilter],
  );
  const shownPeriods = useMemo(
    () =>
      periodView === "ALL"
        ? PERIOD_KEYS
        : PERIOD_KEYS.filter((key) => key === periodView),
    [periodView],
  );
  const selectedProject = projects.find((p) => p.id === activeProject) ?? {
    id: "",
    name: "尚未建立計畫",
    role: "owner" as const,
  };
  const maxRoad = Math.max(1, ...roadRows.flatMap((r) => [r.total, r.pcu24]));
  const maxDay = Math.max(
    1,
    ...dayComparisons.flatMap((r) =>
      dayMetric === "actual"
        ? [r.weekdayActual, r.holidayActual]
        : [r.weekdayPcu, r.holidayPcu],
    ),
  );
  const maxProject = Math.max(1, ...projectComparisons.map((p) => p.actual));
  /*
   * 單位不能寫死成「／日」。
   *
   * 只調查部分時段的案件（例如 07:00–09:00 與 17:00–19:00，合計 4 小時），
   * 那個總量是「實測時段的合計」，不是全日量。實測同一份 Excel 裡，
   * 同一個 10,380 被 KPI 標成「PCU／日」、被時段車種分析標成「PCU／調查時段」，
   * 而畫面上方的提醒還寫著「不是推估的 24 小時全日量」——三者互相矛盾。
   * partial 時一律改標「調查時段」。
   */
  const partialScope = surveyScope.partial;
  const dailyActualUnit =
    dayType === "平日＋假日"
      ? partialScope
        ? "輛／平假日實測時段合計"
        : "輛／平假日合計"
      : partialScope
        ? "輛／調查時段"
        : "輛／調查日";
  const dailyPcuUnit =
    dayType === "平日＋假日"
      ? partialScope
        ? "PCU／平假日實測時段合計"
        : "PCU／平假日合計"
      : partialScope
        ? "PCU／調查時段"
        : "PCU／日";
  /*
   * 歷季趨勢有自己的日別選擇（trendMode），和上方分析範圍的 dayType 是
   * **兩個各自獨立的 state**，預設值還不一樣（dayType 預設「平日」、
   * trendMode 預設「平日＋假日」）。trendRows 走的是 trendMode，
   * 所以它的單位必須依 trendMode 算，用 dailyActualUnit 會在什麼都不動的
   * 預設狀態下就把兩天相加的量標成「輛／調查日」。
   */
  const trendActualUnit =
    trendMode === "平日＋假日"
      ? partialScope
        ? "輛／平假日實測時段合計"
        : "輛／平假日合計"
      : partialScope
        ? "輛／調查時段"
        : "輛／調查日";
  const trendPcuUnit =
    trendMode === "平日＋假日"
      ? partialScope
        ? "PCU／平假日實測時段合計"
        : "PCU／平假日合計"
      : partialScope
        ? "PCU／調查時段"
        : "PCU／日";
  const intersectionFlowLabel =
    intersectionFlowLabelOf(intersectionFlowMode);
  const hasIntersectionRecords = activeRecords.some(
    (record) => record.surveyType === "intersection" || record.turnData,
  );
  const outboundUnmappedTotal =
    intersectionFlowMode === "destination"
      ? scoped
          .filter((record) => record.directionCode === "UNMAPPED")
          .reduce((sum, record) => sum + sumVehicles(record), 0)
      : 0;
  const currentStatus: ReviewStatus = workflow.statuses[quarter] ?? "草稿";
  const qualitySummary = useMemo(
    () =>
      completenessSummary(
        activeRecords,
        quarter,
        [
          ...CORE_VEHICLE_KEYS,
          ...vehicleClassSettings
            .filter((setting) => setting.projectId === activeProject)
            .map((setting) => setting.sourceKey),
        ],
        intersectionSettings
          .filter((setting) => setting.projectId === activeProject)
          .map((setting) => setting.roadId),
        workflow.checkedQuarters.includes(quarter),
      ),
    [
      activeRecords,
      quarter,
      vehicleClassSettings,
      intersectionSettings,
      activeProject,
      workflow.checkedQuarters,
    ],
  );
  // 歷季異常提醒的篩選條件。季度累積之後清單會長到上百筆，
  // 沒有篩選就等於看不到重點（實測 8 季 11 個調查點就有 106 筆）。
  const [anomalyFilter, setAnomalyFilter] = useState<{
    fromQuarter: string;
    toQuarter: string;
    types: string[];
    roadId: string;
    dayType: string;
  }>({ fromQuarter: "", toQuarter: "", types: [], roadId: "ALL", dayType: "ALL" });
  const anomalyAlerts = useMemo(
    () =>
      detectAnomalies(
        activeRecords,
        workflow.thresholds,
        (record) =>
          sumPcu(record, pcuFactors, turnPcuFactors, vehicleClassSettings),
        /*
         * 提醒的文字會直接進報告文字草稿與 Excel 的品質檢核工作表，
         * 所以調查點、支線、車種都要換成使用者看得懂的名稱。
         * 分組與篩選用的鍵值不受影響。
         */
        {
          road: (roadId) =>
            roadOptions.find(([value]) => value === roadId)?.[1] || roadId,
          direction: (record) => displayDirectionName(record as TrafficRecord),
          vehicle: (vehicleKey, record) =>
            effectiveVehicleLabel(
              record as TrafficRecord,
              vehicleKey,
              vehicleClassSettings,
            ),
        },
      ),
    [
      activeRecords,
      workflow.thresholds,
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
      roadOptions,
      /*
       * displayDirectionName 每次 render 都是新的函式，列進來會讓這個 memo
       * 永遠重算。它讀的是 intersectionSettings，而 activeRecords 也是由
       * intersectionSettings 推出來的，所以支線改名時這個 memo 一樣會重算。
       * 本檔其他 memo（1739、1936、2116）也是同一個取捨。
       */
    ],
  );
  const filteredAnomalies = useMemo(
    () => filterAnomalies(anomalyAlerts, anomalyFilter),
    [anomalyAlerts, anomalyFilter],
  );
  const anomalyCounts = useMemo(
    () => anomalyTypeCounts(anomalyAlerts),
    [anomalyAlerts],
  );
  /** 提醒裡出現過的季度，供區間下拉使用（含比較的起訖兩端）。 */
  const anomalyQuarters = useMemo(
    () =>
      [
        ...new Set(
          anomalyAlerts.flatMap((item) => [item.fromQuarter, item.toQuarter]),
        ),
      ].sort((a, b) =>
        a.replace(/^(\d{2})Q/, "0$1Q").localeCompare(b.replace(/^(\d{2})Q/, "0$1Q")),
      ),
    [anomalyAlerts],
  );
  /**
   * 報告文字草稿要用的所有數字。
   *
   * 刻意集中在一個 memo 裡整理好再交給 app/report-draft.ts 組字：組字那一支
   * 是純函式、可以單元測試；這裡則只負責「從畫面現有的狀態取值」。
   * 取值來源一律與畫面上實際顯示的相同（同一組 memo），不另外重算，
   * 才不會出現「草稿寫的和畫面看到的不一樣」。
   */
  /*
   * 各調查點分項結果（報告文字草稿用）。
   *
   * 整體總結回答的是「這個範圍加起來多少」，但報告通常還要逐個路段交代
   * 「A 路段上午尖峰多少、下午尖峰多少」。這一段就是那個逐點版本。
   *
   * 三件事情刻意這樣做：
   * 1. 資料來源用 periodExportRows，也就是「時段車種分析」匯出的同一批列，
   *    因此尖峰時段認定（各方向各自認定／整個調查點同一時段）、路口流量
   *    視角、統計範圍勾選都會自動跟著走，草稿與 Excel 不會分岔。
   * 2. 單位交給 metricUnitFor 依時段決定：全日是一整天的加總（輛/日、
   *    PCU/日），尖峰欄位才是 輛/hr、PCU/hr；平假日合看與部分時段調查
   *    另有各自的標示。寫死成 /hr 會讓全日那一行的單位是錯的。
   * 3. 沒有資料的時段照樣列出並標「此時段無資料」，不靜靜跳過。
   */
  const roadDraftSummary = useMemo(() => {
    const periods = PERIOD_KEYS.filter((key) =>
      periodExport.periods.includes(key),
    );
    const scopeAllowed = (code: string) =>
      !periodExport.scopes.length || periodExport.scopes.includes(code);
    const rows = periodExportRows.filter((row) => scopeAllowed(row.scopeCode));
    const wantCount = periodExport.metrics.includes("count");
    const wantPcu = periodExport.metrics.includes("pcu");
    const wantShare = periodExport.metrics.includes("share");
    /*
     * 單位一律由「這一格自己的時段標籤」決定（cellUnitFor）。
     * 用整批的 partial 旗標會把 24 小時的調查點標成「輛/調查時段」，或反過來
     * 把 2 小時的調查點標成「輛/日」；而且 partial 是逐「調查點」的，
     * 連同一個調查點裡某個方向只調查了兩小時的情況都涵蓋不到。
     */
    const separateDays = dayType === "平日＋假日";
    type DraftRoads = ReportDraftContext["roadSummary"]["roads"];
    type DraftScope = DraftRoads[number]["scopes"][number];
    const byRoad = new Map<string, DraftRoads[number]>();
    // 同名不同編號的調查點確實存在，只印名稱會出現兩個一模一樣的區塊標題。
    // 計數一定要以「不重複的 roadId」為單位：同一個調查點本來就有多列
    //（合計列＋各方向列），照列數去數會讓每個名稱都超過 1，結果變成每個
    // 標題都被硬加上編號。
    const seenRoadIds = new Set<string>();
    const nameCounts = new Map<string, number>();
    for (const row of rows) {
      if (seenRoadIds.has(row.roadId)) continue;
      seenRoadIds.add(row.roadId);
      nameCounts.set(row.roadName, (nameCounts.get(row.roadName) ?? 0) + 1);
    }
    for (const row of rows) {
      const entry = byRoad.get(row.roadId) ?? {
        name:
          (nameCounts.get(row.roadName) ?? 0) > 1
            ? `${row.roadName}（${row.roadId}）`
            : row.roadName,
        scopes: [] as DraftScope[],
      };
      entry.scopes.push({
        name: row.scopeName,
        periods: periods.map((key) => {
          const cell = row.periods[key];
          const values: DraftScope["periods"][number]["values"] = [];
          if (cell?.hasData) {
            if (wantCount)
              values.push({
                label: METRIC_LABELS.count,
                value: cell.total,
                unit: cellUnitFor("count", key, cell.hour, { separateDays }),
                digits: 0,
              });
            if (wantPcu)
              values.push({
                label: METRIC_LABELS.pcu,
                value: cell.pcu,
                unit: cellUnitFor("pcu", key, cell.hour, { separateDays }),
                digits: 1,
              });
          }
          return {
            label: PERIOD_LABELS[key],
            hour: cell?.hour ?? "—",
            // hasData 要一起傳：只勾「百分比」而車輛數全為 0 時，values 與
            // composition 都會是空的，草稿分不出「沒有資料」與「沒有勾要輸出
            // 的數值」，會對有資料的時段寫出「此時段無資料」。
            hasData: Boolean(cell?.hasData),
            values,
            composition:
              wantShare && cell?.hasData
                ? analysisVehicleCatalog
                    .map((vehicle) => ({
                      label: vehicle.label,
                      share: shareOf(cell, vehicle.key),
                    }))
                    .filter((item) => item.share > 0)
                    .sort((a, b) => b.share - a.share)
                : [],
          };
        }),
      });
      byRoad.set(row.roadId, entry);
    }
    const peakScopeNote =
      (periodExport.peakScope === "follow"
        ? periodPeakScope
        : periodExport.peakScope) === "point"
        ? "整個調查點同一時段"
        : "各方向各自認定自己的尖峰";
    /*
     * 統計範圍要印使用者看得懂的名稱：ALL／A 是內部代碼，而且路段方向與
     * 路口支線的代碼會重疊，所以同一個代碼要把它涵蓋的名稱都列出來。
     *
     * 名稱一定要從 periodExportRows 取，不能用畫面的 periodScopeOptions：
     * 後者是依畫面的流量視角與搜尋關鍵字算的，匯出中心若指定了不同的視角，
     * 名稱就會與實際匯出的內容對不上；使用者在搜尋框打字也會讓它縮水。
     */
    const exportScopeNames = new Map<string, Set<string>>();
    for (const row of periodExportRows)
      exportScopeNames.set(
        row.scopeCode,
        new Set([...(exportScopeNames.get(row.scopeCode) ?? []), row.scopeName]),
      );
    const scopeNames = periodExport.scopes.map((code) => {
      const names = exportScopeNames.get(code);
      return names?.size ? [...names].join("／") : code;
    });
    const roads = [...byRoad.values()];
    const usable = periods.length > 0 && periodExport.metrics.length > 0;
    return {
      // 這兩個也給「時段車種分析」那一段用，兩段才不會對同一個設定給出
      // 兩種說法。
      peakScopeLabel: peakScopeNote,
      scopeNames,
      note: [
        `尖峰時段認定：${peakScopeNote}`,
        `路口流量視角：${periodExportFlowLabel}`,
        `統計範圍：${scopeNames.length ? scopeNames.join("、") : "全部方向／支線"}`,
      ].join("；"),
      metrics: periodExport.metrics.map((key) => METRIC_LABELS[key]),
      // 刻意不看 periodExport.enabled：那個勾選決定的是「Excel 裡要不要有
      // 時段車種分析工作表」，而分項結果是草稿自己的一段，有自己的勾選框。
      // 綁在一起的話，使用者只要不匯那張表，逐點總結就會莫名其妙消失。
      //
      // 但「一個分析時段都沒勾」時就真的沒有東西可寫：留著空的區塊標題只會
      // 讓人以為系統壞了，所以整段退回「沒有可敘述的資料」。
      // 一個分析時段都沒勾、或一種輸出數值都沒勾時，整段沒有東西可寫。
      // 留著空的區塊標題只會讓人以為系統壞了，而且 Excel 那邊也不會產生
      // 對應的工作表，段末「詳見各工作表」會指向不存在的東西。
      roads: usable ? (roads.slice(0, ROAD_SUMMARY_LIMIT) as DraftRoads) : ([] as DraftRoads),
      // 逐點敘述很佔篇幅，超過上限先截斷並在段末說明還有幾個點。
      omitted: usable ? Math.max(0, roads.length - ROAD_SUMMARY_LIMIT) : 0,
    };
  }, [
    periodExportRows,
    periodExport,
    periodPeakScope,
    periodExportFlowLabel,
    analysisVehicleCatalog,
    dayType,
  ]);
  const reportDraftContext = useMemo<ReportDraftContext>(() => {
    const sortedRoads = [...roadRows].sort((a, b) => b.total - a.total);
    // 直接沿用畫面「各路段平日與假日比較」面板的結果，定義才會一致。
    // 自己另外過濾一次的話會漏掉調查點與搜尋條件，出現「本段寫 42,090 輛、
    // 下一句卻寫 115,873 輛」這種自相矛盾。
    const weekday = dayComparisons.reduce(
      (sum, row) => sum + row.weekdayActual,
      0,
    );
    const holiday = dayComparisons.reduce(
      (sum, row) => sum + row.holidayActual,
      0,
    );
    const trendValues = trendRows.map((row) => ({
      quarter: row.quarter,
      /*
       * null 代表讀不到，往下游要保持 null（報告草稿會寫「—」並說明），
       * 不可以折成 0——折成 0 會讓草稿寫出「較前一季增加 0.0%」。
       */
      value:
        trendMode === "平日"
          ? (row.weekday ?? Number.NaN)
          : trendMode === "假日"
            ? (row.holiday ?? Number.NaN)
            : (row.weekday ?? 0) + (row.holiday ?? 0),
    }));
    const periodPeriods = periodExport.periods.map((key) => PERIOD_LABELS[key]);
    // buildPeriodRows 是「每個調查點各有一列 scopeCode === ALL」，
    // 沒有跨調查點的總合計列。只取第一列會寫出單一調查點的數字，卻讀起來
    // 像全範圍合計（實測草稿上一句寫 115,873 輛，下一句只有 42,090）。
    // 這裡把所有調查點的合計列加總，時段標籤各點不同時明講。
    const highlights = periodExport.enabled
      ? periodExport.periods.flatMap((period) => {
          /*
           * 每個調查點只能貢獻一次。兩件事會讓舊寫法重複計算：
           * 1. 路口流量視角選「駛出＋駛入並列」時，同一個路口會有兩列
           *    scopeCode === "ALL"（駛出合計與駛入合計），那是同一批車，
           *    相加剛好變成兩倍，而句子讀起來完全正常。
           * 2. 使用者在「方向／支線」只勾了某幾個方向時，合計列根本不在
           *    匯出範圍內，舊寫法卻仍然拿合計列去寫，與 Excel 對不起來。
           * 所以改成：每個調查點優先用它自己「有被勾到」的合計列；
           * 沒有合計列時，才把該點被勾到的各方向相加（方向之間不重疊）。
           */
          const allowed = periodExportRows.filter(
            (item) =>
              !periodExport.scopes.length ||
              periodExport.scopes.includes(item.scopeCode),
          );
          /*
           * 分組時把「流量視角」也放進 key。並列模式（駛出＋駛入）下，
           * 同一個路口的支線 A 會出現兩次——一次是駛出路口A、一次是駛入路口A，
           * 兩者是同一批車。只用 roadId 分組時，若使用者沒有勾合計列
           * （例如只勾 A、B、C），fallback 會把六列全部相加，實測 9,600 對
           * 正確值 5,760。所以先依視角分開，再取其中一個視角。
           */
          const byRoadFlow = new Map<string, PeriodRow[]>();
          for (const item of allowed) {
            const key = `${item.roadId}|${item.flowLabel ?? ""}`;
            byRoadFlow.set(key, [...(byRoadFlow.get(key) ?? []), item]);
          }
          const byRoad = new Map<string, PeriodRow[][]>();
          for (const [key, items] of byRoadFlow) {
            const roadId = key.slice(0, key.lastIndexOf("|"));
            byRoad.set(roadId, [...(byRoad.get(roadId) ?? []), items]);
          }
          const cells = [...byRoad.values()].flatMap((flowGroups) => {
            // 一個調查點只能貢獻一次，所以並列時只取第一個視角的那一組。
            const items = flowGroups[0];
            const totals = items.filter((item) => item.scopeCode === "ALL");
            const picked = totals.length ? [totals[0]] : items;
            return picked
              .map((item) => item.periods[period])
              .filter((cell) => cell && cell.hasData);
          });
          if (!cells.length) return [];
          const hours = [...new Set(cells.map((cell) => cell.hour))];
          /*
           * 可不可以把各調查點加起來，取決於這個時段是不是「同一段時間」。
           *
           * ・全日時段（all）＝整天的累計，各調查點相加是有意義的。
           * ・尖峰小時（am／pm／peak24）＝「某一個特定小時」的流率。
           *   各調查點的尖峰小時不一定相同（A 點 07:00–08:00、B 點
           *   07:30–08:30），相加出來的數字不對應任何一個真實存在的小時。
           *   舊寫法在 hours 不只一個時，只把「時段」那一欄改寫成
           *   「各調查點不同（…）」，pcu 與 total 卻照樣 reduce 相加，
           *   然後這句話會被原封不動寫進正式報告。
           */
          const summable = period === "all" || hours.length === 1;
          const highest = cells.reduce((best, cell) =>
            cell.pcu > best.pcu ? cell : best,
          );
          return [
            {
              label: PERIOD_LABELS[period],
              hour:
                hours.length === 1
                  ? hours[0]
                  : `各調查點不同（${hours.join("、")}）`,
              pcu: cells.reduce((sum, cell) => sum + cell.pcu, 0),
              total: cells.reduce((sum, cell) => sum + cell.total, 0),
              summable,
              siteCount: cells.length,
              highestPcu: highest.pcu,
              highestTotal: highest.total,
              highestHour: highest.hour,
              /*
               * 單位一律由 cellUnitFor 依「這個時段實際幾分鐘」決定，
               * 不寫死成 輛/hr——15 分鐘一格又有空檔時，尖峰視窗可能湊不滿
               * 一小時（例如 07:00～07:45），標成 /hr 會低估；2 小時一格
               * 則會高估一倍。
               */
              /*
               * 各點時段不同時，這一句寫的是「最高的那一個調查點」的值，
               * 所以單位要用**那一點自己的**時段標籤（highest.hour），不能
               * 傳空字串——傳空字串會讓 parseTimeRange 失敗而一律回 輛/hr，
               * 45 分鐘的視窗就被標成一小時的流率；全日時段則會漏掉
               * 「實測 N 小時（非 24 小時）」而標成 輛/日。
               */
              unit: cellUnitFor(
                "count",
                period,
                hours.length === 1 ? hours[0] : highest.hour,
              ),
            },
          ];
        })
      : [];
    return {
      projectName:
        projects.find((p) => p.id === activeProject)?.name ?? "（未命名計畫）",
      quarter,
      dayType,
      roadLabel:
        roadFilter === "ALL"
          ? "全部調查點"
          : (roadOptions.find(([id]) => id === roadFilter)?.[1] ?? roadFilter),
      directionLabel:
        direction === "ALL"
          ? "全部方向"
          : (directionOptions.find(([code]) => code === direction)?.[1] ??
            direction),
      flowLabel: hasIntersectionRecords ? intersectionFlowLabel : null,
      coverageNote: surveyScope.partial ? surveyScopeNote : "",
      roadCount: roadRows.length,
      intersectionCount: intersectionOnlyRows.length,
      // 用 filtered 而不是 scoped：scoped 還沒套「車流方向」，
      // 會出現「1 個調查點、144 筆」這種兩個數字基準不同的句子。
      recordCount: filtered.length,
      total: totals.total,
      pcu24: totals.pcu24,
      /*
       * 車種組成的數字必須跟它自己印出來的標籤同一個來源。
       *
       * 舊版數字取自 totals（工具列的日別／調查點／方向／搜尋），標籤卻寫
       * compositionMode（車種組成面板自己的日別）。工具列選平日、面板選假日時，
       * 草稿會寫「依『假日』統計：機車 51.9%（21,859 輛）」，而 21,859 是
       * 平日的數字——標籤與數字分屬兩個不同的篩選，兩邊都不會有人發現。
       * 這裡改成一律採用車種組成面板自己的範圍。
       */
      vehicles: (compositionTotals.total ? analysisVehicleCatalog : []).map(
        (vehicle) => ({
          label: vehicle.label,
          count: compositionTotals.vehicles[vehicle.key] ?? 0,
          share: compositionTotals.total
            ? ((compositionTotals.vehicles[vehicle.key] ?? 0) /
                compositionTotals.total) *
              100
            : 0,
        }),
      ),
      // peakOf 在空集合會回 ["—", 0]，字串「—」是 truthy，
      // 只判斷第一個欄位會寫出「尖峰小時出現於 —」。要看數值。
      peak:
        directionPeaks.combined[1] > 0 && directionPeaks.combined[0] !== "—"
          ? {
              hour: directionPeaks.combined[0],
              pcu: directionPeaks.combined[1],
              // 滾動尖峰在部分時段或細格資料下可能湊不滿一小時，那個數字
              // 是該時段的量而不是時率；標成 PCU/hr 會低估。
              unit: cellUnitFor("pcu", "am", directionPeaks.combined[0]),
            }
          : null,
      topRoads: sortedRoads.slice(0, 3).map((row) => ({
        name: row.roadName,
        total: row.total,
        pcu: row.pcu24,
      })),
      dayCompare: weekday && holiday ? { weekday, holiday } : null,
      trend: {
        mode: trendMode,
        metricLabel: trendMetric === "actual" ? "實際交通量" : "當量交通量",
        /* 一定要用 trendActualUnit／trendPcuUnit（依 trendMode），見上面說明。 */
        unit: trendMetric === "actual" ? trendActualUnit : trendPcuUnit,
        roadLabel:
          trendRoad === "ALL"
            ? "全部路段合計"
            : (roadOptions.find(([id]) => id === trendRoad)?.[1] ?? trendRoad),
        rows: trendValues,
      },
      compositionMode: [
        compositionMode,
        compositionRoad === "ALL"
          ? "全部調查點"
          : (roadOptions.find(([id]) => id === compositionRoad)?.[1] ??
            compositionRoad),
        compositionDirection === "ALL"
          ? "全部方向"
          : (directionOptions.find(([code]) => code === compositionDirection)?.[1] ??
            compositionDirection),
      ].join("、"),
      periodExport: {
        enabled: periodExport.enabled,
        periods: periodPeriods,
        // 這兩項要與「各調查點分項結果」講同一件事：一段寫「跟隨畫面設定」、
        // 另一段寫「整個調查點同一時段」，讀者會以為是兩種不同的設定；
        // 統計範圍印內部代碼（A、B）也對不上另一段印的名稱。
        scopes: roadDraftSummary.scopeNames,
        metrics: periodExport.metrics.map((key) => METRIC_LABELS[key]),
        peakScope: roadDraftSummary.peakScopeLabel,
        flowView: periodExportFlowLabel,
        sheetPerPeriod: periodExport.sheetPerPeriod,
      },
      periodHighlights: highlights,
      roadSummary: roadDraftSummary,
      projectsCompare: projectComparisons.map((p) => ({
        name: p.name,
        total: p.actual,
        pcu: p.pcu,
      })),
      // 四大類直接讀目前的核心係數；使用者自行新增的車種讀該計畫的設定值。
      factors: [
        ...CORE_VEHICLE_KEYS.map((key) => ({
          label: coreVehicleLabels[key],
          value: String(pcuFactors[key]),
        })),
        ...vehicleClassSettings
          .filter(
            (setting) =>
              setting.projectId === activeProject &&
              !CORE_VEHICLE_KEYS.includes(setting.targetKey as CoreVehicleKey),
          )
          .map((setting) => ({
            label: setting.sourceLabel || setting.sourceKey,
            value: String(setting.roadPcu ?? 1),
          })),
      ],
      intersectionNote: hasIntersectionRecords
        ? `本範圍含路口格式資料，路口幾何與轉向當量設定會影響 PCU 換算結果。`
        : "",
      sourceFileCount: new Set(
        activeRecords.map((record) => record.sourceFileName).filter(Boolean),
      ).size,
      // completenessSummary 的 unmapped 是「車輛數」不是「筆數」，
      // 直接相加會寫出「10001 項待確認事項」這種把輛當項的荒謬數字。
      qualityIssueCount: qualitySummary.incompleteGroups,
      unmappedVehicles: qualitySummary.unmapped,
      reviewNote: `本季狀態：${workflow.checkedQuarters.includes(quarter) ? "已完成人工檢核" : "尚未完成人工檢核"}。`,
      // 沒有勾「9張可編輯原生圖表」時，匯出檔裡就沒有圖表工作表，
      // 草稿也不該宣稱有附圖。
      charts: exportSections.charts ? [...EXPORT_CHART_TITLES] : [],
      // 用未篩選的全部：畫面上的篩選是「為了看清楚」的檢視動作，
      // 不該讓交付的文字少掉幾筆，也才會與匯出的「品質檢核」工作表一致。
      anomalies: anomalyAlerts.map((item) => item.text),
    };
  }, [
    projects,
    activeProject,
    quarter,
    dayType,
    roadFilter,
    roadOptions,
    direction,
    directionOptions,
    hasIntersectionRecords,
    intersectionFlowLabel,
    surveyScope,
    surveyScopeNote,
    roadRows,
    intersectionOnlyRows,
    filtered,
    totals,
    analysisVehicleCatalog,
    directionPeaks,
    dayComparisons,
    trendRows,
    trendMode,
    trendRoad,
    compositionMode,
    compositionRoad,
    compositionDirection,
    compositionTotals,
    periodExport,
    periodExportRows,
    periodExportFlowLabel,
    projectComparisons,
    pcuFactors,
    vehicleClassSettings,
    exportSections.charts,
    activeRecords,
    qualitySummary,
    workflow.checkedQuarters,
    anomalyAlerts,
    roadDraftSummary,
  ]);
  const generatedDraft = useMemo(
    () => buildReportDraft(reportDraftContext, draftSections),
    [reportDraftContext, draftSections],
  );
  useEffect(() => {
    // 使用者一旦自己動過文字就不再覆寫，否則辛苦寫好的段落會被無聲蓋掉。
    if (!draftEdited) setReportDraft(generatedDraft);
  }, [generatedDraft, draftEdited]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await appFetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(newProject),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setProjects((p) => [...p, d.project]);
      setActiveProject(d.project.id);
      setCompareIds((ids) => [...ids, d.project.id]);
      setShowProjectForm(false);
      setToast("計畫已建立");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }
  function openProjectManager() {
    if (!selectedProject.id) return setToast("請先建立計畫");
    setProjectDraft({
      name: selectedProject.name,
      code: selectedProject.code ?? "",
      clientName: selectedProject.clientName ?? "",
    });
    setShowProjectManager(true);
  }
  async function renameProject(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProject.id || !projectDraft.name.trim())
      return setToast("請輸入計畫名稱");
    setBusy(true);
    try {
      const response = await appFetch(
        `/api/projects/${encodeURIComponent(selectedProject.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(projectDraft),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      /*
       * 這裡以前呼叫的是 deleteWorkflow(selectedProject.id)——**改名會把整個
       * 計畫的工作流程狀態刪掉**：定稿狀態、人工檢核勾選、自訂異常門檻、
       * 設定範本、比較報表，以及 history（那是唯一的匯入還原點來源）。
       * 而畫面上寫的是「改名只會更新顯示名稱，不會影響既有季度與分析資料」。
       * 那一行顯然是要放在 deleteProject 的（見下方），改名不該動它。
       */
      setProjects((previous) =>
        previous.map((project) =>
          project.id === selectedProject.id
            ? { ...project, ...data.project }
            : project,
        ),
      );
      setShowProjectManager(false);
      setToast(`計畫已改名為「${data.project.name}」`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "計畫修改失敗");
    } finally {
      setBusy(false);
    }
  }
  async function deleteProject() {
    if (!selectedProject.id) return;
    if (
      !window.confirm(
        `確定刪除計畫「${selectedProject.name}」？\n\n此計畫的所有季度、交通量、路段別名及本機原始檔都會一併刪除，且無法復原。建議先匯出備份。`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await appFetch(
        `/api/projects/${encodeURIComponent(selectedProject.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const remaining = projects.filter(
        (project) => project.id !== selectedProject.id,
      );
      setProjects(remaining);
      setRecords((previous) =>
        previous.filter((record) => record.projectId !== selectedProject.id),
      );
      setCompareIds((previous) =>
        previous.filter((id) => id !== selectedProject.id),
      );
      // 先算好結果再一次寫入，setState 的更新函式維持純函式。
      const nextIntersection = intersectionSettings.filter(
        (setting) => setting.projectId !== selectedProject.id,
      );
      setIntersectionSettings(nextIntersection);
      safeWrite("traffic-intersection-settings-v1", nextIntersection);
      const nextVehicleClass = vehicleClassSettings.filter(
        (setting) => setting.projectId !== selectedProject.id,
      );
      setVehicleClassSettings(nextVehicleClass);
      safeWrite("traffic-vehicle-class-settings-v1", nextVehicleClass);
      /*
       * 計畫刪掉了，它在 IndexedDB 裡的工作流程狀態（定稿、檢核、門檻、
       * 範本、比較報表、匯入紀錄）也要一起清掉，否則會一直留著吃空間，
       * 而且下次建立同 id 的計畫會撿到上一個計畫的狀態。
       */
      await deleteWorkflow(selectedProject.id);
      setActiveProject(remaining[0]?.id ?? "");
      setQuarter("");
      setShowProjectManager(false);
      setToast(`計畫「${selectedProject.name}」已刪除`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "計畫刪除失敗");
    } finally {
      setBusy(false);
    }
  }
  async function ensurePersistentProject() {
    if (!activeProject)
      throw new Error("請先按左側＋建立並命名計畫，再匯入該計畫的季度資料");
    return activeProject;
  }
  function defaultVehicleSetting(
    projectId: string,
    sourceKey: string,
    sourceLabel: string,
  ): VehicleClassSetting {
    const coreKey = CORE_VEHICLE_KEYS.includes(sourceKey as CoreVehicleKey)
      ? (sourceKey as CoreVehicleKey)
      : undefined;
    return {
      projectId,
      sourceKey,
      sourceLabel,
      targetKey: sourceKey,
      targetLabel: coreKey ? coreVehicleLabels[coreKey] : sourceLabel,
      // 新增車種一律先給 1.0（＝與小客車等值），使用者再到「車種分類與新增當量」
      // 手動改成符合 2022 年公路容量手冊或計畫需求的數值。給 0 會讓該車種的 PCU
      // 直接消失，比先給 1 更容易被忽略。
      roadPcu: coreKey ? pcuFactors[coreKey] : NEW_VEHICLE_DEFAULT_PCU,
      turnPcu: coreKey
        ? { ...turnPcuFactors[coreKey] }
        : {
            through: NEW_VEHICLE_DEFAULT_PCU,
            right: NEW_VEHICLE_DEFAULT_PCU,
            left: NEW_VEHICLE_DEFAULT_PCU,
          },
    };
  }
  function ensureImportedVehicleSettings(
    rows: TrafficRecord[],
    projectId: string,
  ) {
    const next = [...vehicleClassSettings];
    const catalog = new Map<string, string>();
    rows.forEach((record) =>
      Object.entries(rawVehicleLabels(record)).forEach(([key, label]) => {
        if (Object.prototype.hasOwnProperty.call(rawVehicleCounts(record), key))
          catalog.set(key, label);
      }),
    );
    let addedCustom = false;
    // 匯入時不再逐一跳出視窗要求輸入當量係數。偵測到的新車種一律先保留為
    // 「獨立車種」並把一般／直行／右轉／左轉 PCU 全部預設為 1，匯入流程不中斷；
    // 使用者之後在「車種分類與新增當量」裡再依實際需求調整或歸類回四大類。
    const addedLabels: string[] = [];
    for (const [sourceKey, sourceLabel] of catalog) {
      if (
        next.some(
          (setting) =>
            setting.projectId === projectId && setting.sourceKey === sourceKey,
        )
      )
        continue;
      if (CORE_VEHICLE_KEYS.includes(sourceKey as CoreVehicleKey)) continue;
      next.push(defaultVehicleSetting(projectId, sourceKey, sourceLabel));
      addedLabels.push(sourceLabel);
      addedCustom = true;
    }
    // 這裡只計算結果，實際寫入要等匯入真的成功之後再做（見 commit），
    // 否則上傳失敗時會留下一批根本沒匯進來的車種設定。
    const commit = () => {
      if (!addedCustom) return;
      setVehicleClassSettings(next);
      safeWrite("traffic-vehicle-class-settings-v1", next);
    };
    return { settings: next, addedCustom, addedLabels, commit };
  }
  async function shareProject(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await appFetch(`/api/projects/${activeProject}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(share),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      setShowShare(false);
      setToast("分享權限已更新");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "分享失敗");
    } finally {
      setBusy(false);
    }
  }
  function resolveImportedRoad(fileName: string) {
    const proposedId = surveyRoadIdFromFileName(fileName);
    const meta = roadMetaByStableId.get(proposedId);
    const proposedName = meta?.name ?? roadNameFromFileName(fileName);
    const proposedKey = roadNameMatchKey(proposedName);
    const known = roadOptions.map(([roadId, roadName]) => ({
      roadId,
      roadName,
    }));
    const idMatch = known.find((r) => r.roadId === proposedId);
    const nameMatches = known.filter(
      (r) => roadNameMatchKey(r.roadName) === proposedKey,
    );
    const aliasMatch = roadAliases.find((a) => a.aliasKey === proposedKey);
    let selected = aliasMatch
      ? known.find((r) => r.roadId === aliasMatch.roadId)
      : nameMatches.length === 1
        ? nameMatches[0]
        : undefined;
    if (
      !selected &&
      idMatch &&
      (isFallbackRoadName(proposedName) ||
        roadNameMatchKey(idMatch.roadName) === proposedKey)
    )
      selected = idMatch;
    if (!selected && known.length) {
      const choices = [idMatch, ...known.filter((r) => r !== idMatch)]
        .filter((r): r is { roadId: string; roadName: string } => Boolean(r))
        .slice(0, 30);
      const list = choices
        .map((r, index) => `${index + 1}. ${r.roadName}（${r.roadId}）`)
        .join("\n");
      const answer = window.prompt(
        `無法確定「${fileName}」是否屬於既有路段。\n\n系統辨識名稱：${proposedName}\n\n請輸入既有路段編號：\n${list}\n\n輸入 N：另建路段\n按取消：停止本次匯入`,
        idMatch ? String(choices.indexOf(idMatch) + 1) : "",
      );
      if (answer === null) throw new Error("已取消匯入，資料未變更");
      if (!/^n(?:ew)?$/i.test(answer.trim())) {
        const index = Number(answer.trim()) - 1;
        if (!Number.isInteger(index) || !choices[index])
          throw new Error(`「${fileName}」的路段選擇無效，請重新匯入`);
        selected = choices[index];
      }
    }
    const roadId = selected?.roadId ?? proposedId;
    const roadName = selected?.roadName ?? proposedName;
    const existingA = activeRecords.find(
      (r) => r.roadId === roadId && r.directionCode === "A",
    )?.directionName;
    const existingB = activeRecords.find(
      (r) => r.roadId === roadId && r.directionCode === "B",
    )?.directionName;
    const selectedMeta = roadMetaByStableId.get(roadId);
    return {
      roadId,
      roadName,
      // 已匯入資料上的名稱優先，但那筆如果只是「方向A」這個預設值，
      // 就讓路段設定檔裡真的取過的名字勝出（原本 `??` 會讓預設值贏）。
      a: pickDirectionName("A", existingA, selectedMeta?.a),
      b: pickDirectionName("B", existingB, selectedMeta?.b),
    };
  }
  async function parseFiles(files: File[]) {
    const XLSX = await import("xlsx");
    const parsed: TrafficRecord[] = [];
    for (const file of files) {
      /*
       * xlsx 0.18.5 有一則上游原型污染警示，npm 沒有可以升的修正版。
       * 這裡用共用的安全解析選項（關掉公式／內嵌 HTML／VBA），並在解析
       * 後立刻比對 Object.prototype——被污染就中止這一次匯入，而不是
       * 只在說明文件裡寫一句「請匯入可信來源的檔案」。
       */
      const fingerprint = prototypeFingerprint();
      const book = XLSX.read(await file.arrayBuffer(), SAFE_XLSX_READ_OPTIONS);
      assertNoPrototypePollution(fingerprint, file.name);
      const identity = resolveImportedRoad(file.name);
      const readSheet = (name: string) =>
        XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], {
          header: 1,
          defval: "",
        });
      const dayNamedSheets = (["平日", "假日"] as DayType[])
        .map((dt) => ({ dt, name: book.SheetNames.find((n) => n.includes(dt)) }))
        .filter((item): item is { dt: DayType; name: string } => Boolean(item.name));
      if (dayNamedSheets.length) {
        for (const { dt, name } of dayNamedSheets)
          parsed.push(
            ...parseTrafficSheetValues(readSheet(name), dt, importQuarter, identity, {
              fileName: file.name,
              sheetName: name,
            }),
          );
        continue;
      }
      // 七叉路口這類檔案沒有「平日」「假日」工作表，而是一條支線一張工作表
      // （路口(A)、路口B…）。日別改從表頭的「日期：…(平日)」判讀，
      // 讀不到時再退回檔名。監測日誌、時相圖、照片等工作表會自動略過。
      for (const name of book.SheetNames) {
        const values = readSheet(name);
        if (!armCodeOf(values, name)) continue;
        const dt =
          (dayTypeOf(values) as DayType) ||
          (file.name.includes("假日") ? "假日" : "平日");
        parsed.push(
          ...parseTrafficSheetValues(values, dt, importQuarter, identity, {
            fileName: file.name,
            sheetName: name,
          }),
        );
      }
    }
    return resolveDestinationTurns(parsed, activeProject, intersectionSettings);
  }

  async function importSelectedFiles(files: File[]) {
    if (!files.length) return;
    const invalid = files.find((file) => !/\.xlsx?$/i.test(file.name));
    if (invalid) return setToast(`「${invalid.name}」不是支援的 Excel 檔案`);
    if (!activeProject) {
      setToast("請先建立並選擇計畫，再匯入季度資料");
      return;
    }
    setBusy(true);
    try {
      const parsedSource = await parseFiles(files);
      if (!parsedSource.length) throw new Error("找不到平日／假日交通量資料");
      if (!/^(?:\d{3}|\d{4})Q[1-4]$/.test(importQuarter))
        throw new Error("季度格式請輸入115Q2或2026Q2");
      const targetProjectId = await ensurePersistentProject();
      const parsed = parsedSource.map((r) => ({
        ...r,
        projectId: targetProjectId,
      }));
      const report = validateImport(parsed, activeRecords);
      if (!report.valid)
        throw new Error(report.invalidRows[0] ?? "匯入資料檢核失敗");
      /*
       * 定稿的季度一律擋下，不管是覆蓋既有列還是只追加新列。
       *
       * 舊寫法只在 replacedRows > 0 時擋。把另一個調查點匯進同一個已定稿的
       * 季度時 replacedRows 是 0，於是照樣寫進去，而下面又會無條件把狀態
       * 改回「草稿」——定稿等於自己解除了，畫面上沒有任何提示。
       */
      if ((workflow.statuses[importQuarter] ?? "草稿") === "定稿")
        throw new Error(
          `${importQuarter} 已定稿，系統已阻擋${report.replacedRows ? "覆蓋" : "追加"}。請先在「品質與定稿」將狀態改回草稿或待確認。`,
        );
      // 檢核報告一跳出來就把「匯入季度資料」視窗收掉。
      // 兩個視窗疊在一起時，後面的匯入視窗會蓋住檢核報告的按鈕，
      // 使用者會以為匯入沒成功、又重選一次檔案。
      setShowImport(false);
      setPendingImport({ files, records: parsed, report });
      setBusy(false);
      return;
    } catch (e) {
      setToast(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  async function confirmPendingImport() {
    if (!pendingImport) return;
    setBusy(true);
    try {
      const { files, records: parsed, report } = pendingImport;
      const targetProjectId = await ensurePersistentProject();
      const vehicleSetup = ensureImportedVehicleSettings(
        parsed,
        targetProjectId,
      );
      const incomingKeys = new Set(parsed.map(trafficIdentity));
      const keys = [] as string[];
      for (const file of files) {
        const form = new FormData();
        form.append("projectId", targetProjectId);
        form.append("quarter", importQuarter);
        form.append("file", file);
        const res = await appFetch("/api/files", {
          method: "POST",
          body: form,
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error);
        keys.push(d.key);
      }
      const res = await appFetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: targetProjectId,
          quarter: importQuarter,
          sourceObjectKeys: keys,
          records: parsed,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      vehicleSetup.commit();
      const beforeRecords = activeRecords.map((record) => ({ ...record }));
      const afterRecords = [
        ...beforeRecords.filter((r) => !incomingKeys.has(trafficIdentity(r))),
        ...parsed,
      ];
      setRecords((prev) => [
        ...prev.filter((r) => r.projectId !== targetProjectId),
        ...afterRecords,
      ]);
      const historyEntry: ImportHistoryEntry = {
        id: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
        operator: user?.displayName ?? "本機使用者",
        device: `${navigator.platform || "瀏覽器"}｜${navigator.userAgent.split(" ").slice(-2).join(" ")}`,
        quarter: importQuarter,
        files: files.map((file) => file.name),
        rowCount: parsed.length,
        addedRows: report.addedRows,
        replacedRows: report.replacedRows,
        roads: report.roads,
        vehicles: report.vehicles,
        beforeRecords,
        afterRecords,
      };
      setWorkflow((previous) => ({
        ...previous,
        statuses: { ...previous.statuses, [importQuarter]: "草稿" },
        checkedQuarters: previous.checkedQuarters.filter(
          (item) => item !== importQuarter,
        ),
        history: [historyEntry, ...previous.history].slice(0, 10),
      }));
      setQuarter(importQuarter);
      setShowImport(false);
      setPendingImport(null);
      /*
       * 兩個視窗不能同時開。
       *
       * 舊版匯入含新車種的路口檔時，會同時打開「路口幾何」與「車種分類」
       * 兩個 modal；後 render 的路口視窗蓋在上面，車種視窗的按鈕完全點不到
       *（實測 modal-backdrop 有兩層，車種視窗的 select 被攔截）。
       * 使用者只會看到最上面那個，而 toast 卻叫他去調整車種。
       * 改成先開車種（跟 toast 講的一致），關掉之後再自動開路口幾何。
       */
      const importedIntersection = parsed.find(
        (record) => record.surveyType === "intersection",
      );
      if (vehicleSetup.addedCustom) {
        setVehicleClassDraft(
          vehicleSetup.settings.filter(
            (setting) => setting.projectId === targetProjectId,
          ),
        );
        setShowVehicleManager(true);
        setPendingIntersectionRoad(importedIntersection?.roadId ?? "");
      } else if (importedIntersection) {
        setIntersectionManageRoad(importedIntersection.roadId);
        setShowIntersectionManager(true);
      }
      const importedMessage = report.replacedRows
        ? `已更新 ${formatter.format(report.replacedRows)} 筆並建立可復原版本`
        : `已追加匯入 ${formatter.format(parsed.length)} 筆並建立可復原版本`;
      setToast(
        vehicleSetup.addedCustom
          ? `${importedMessage}；新車種「${vehicleSetup.addedLabels.join("、")}」當量係數已預設為 ${NEW_VEHICLE_DEFAULT_PCU}，請於「車種分類與新增當量」調整`
          : importedMessage,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  async function importFiles(e: React.ChangeEvent<HTMLInputElement>) {
    await importSelectedFiles(Array.from(e.target.files ?? []));
  }
  async function dropImportFiles(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    await importSelectedFiles(Array.from(e.dataTransfer.files));
  }
  function exportBackup() {
    const payload = {
      format: "traffic-analysis-backup",
      version: 5,
      exportedAt: new Date().toISOString(),
      project: {
        name: selectedProject.name,
        code: selectedProject.code ?? "",
        clientName: selectedProject.clientName ?? "",
      },
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings: vehicleClassSettings
        .filter((setting) => setting.projectId === activeProject)
        .map(({ projectId: _projectId, ...setting }) => setting),
      roadAliases,
      intersectionSettings: intersectionSettings
        .filter((setting) => setting.projectId === activeProject)
        .map(({ projectId: _projectId, ...setting }) => setting),
      workflow,
      /*
       * 結論草稿的「條件範本」也要跟著備份走。
       *
       * 它存在 localStorage 的 traffic-conclusion-templates-v1（依計畫分開），
       * 而備份原本沒有收——使用者在 A 電腦存好幾組常用條件，匯出備份帶到
       * B 電腦還原之後，範本一個都不在，而畫面只會說「還原完成」。
       * 那些條件是使用者自己一項一項勾出來的，重建很花時間。
       */
      conclusionTemplates: readConclusionTemplates(activeProject),
      records: activeRecords.map(
        ({ projectId: _projectId, ...record }) => record,
      ),
    };
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `${selectedProject.name}_交通量完整備份_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setToast("已匯出可跨電腦還原的完整備份");
  }
  async function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const payload = JSON.parse(await file.text()) as {
        format?: string;
        /* 備份檔帶著來源計畫的名稱，換電腦還原時用得到。 */
        project?: { name?: string; code?: string; clientName?: string };
        records?: TrafficRecord[];
        pcuFactors?: PcuFactors;
        turnPcuFactors?: TurnPcuFactors;
        vehicleClassSettings?: Omit<VehicleClassSetting, "projectId">[];
        roadAliases?: RoadAlias[];
        intersectionSettings?: Omit<IntersectionArmSetting, "projectId">[];
        workflow?: WorkflowState;
        conclusionTemplates?: ConclusionTemplate[];
      };
      if (
        payload.format !== "traffic-analysis-backup" ||
        !Array.isArray(payload.records) ||
        !payload.records.length
      )
        throw new Error("這不是本系統的有效備份檔");
      /*
       * 每一筆都要通過欄位檢查才收。
       *
       * 舊版只檢查 format 與 quarter 格式，其餘欄位照單全收。少一個
       * roadName 就會讓後面的 roadNameFromFileName(undefined) 丟例外——
       * 而那時壞資料已經寫進資料庫，畫面變成全白，重新整理還是全白，
       * 使用者的全部資料就再也打不開了（整支程式沒有 error boundary）。
       * 寧可在這裡明確拒絕，也不要讓它進到資料庫。
       */
      const REQUIRED_TEXT: Array<keyof TrafficRecord> = [
        "quarter",
        "roadId",
        "roadName",
        "dayType",
        "directionCode",
        "hour",
      ];
      const badIndex = payload.records.findIndex((r) =>
        REQUIRED_TEXT.some(
          (field) =>
            typeof (r as Record<string, unknown>)[field] !== "string" ||
            !String((r as Record<string, unknown>)[field]).trim(),
        ),
      );
      if (badIndex >= 0)
        throw new Error(
          `備份檔第 ${badIndex + 1} 筆資料缺少必要欄位（${REQUIRED_TEXT.join("、")}），為避免損壞既有資料已停止還原`,
        );
      const source = payload.records
        .map((r) => ({
          ...r,
          quarter: String(r.quarter).toUpperCase(),
          roadId: normalizeRoadId(r.roadId),
        }))
        .filter((r) => /^(?:\d{3}|\d{4})Q[1-4]$/.test(r.quarter));
      if (!source.length) throw new Error("備份檔內沒有可匯入的季度資料");
      /*
       * 換一台電腦時，畫面上一個計畫都還沒有——而「還原完整備份」正是這時
       * 才會用到的功能。舊版在這裡直接擋下來，使用者必須自己先手動建一個
       * 計畫名稱才能還原，而備份檔裡本來就帶著計畫名稱（payload.project）。
       * 沒有計畫時就用備份檔裡的名稱自動建一個，直接還原進去。
       */
      let targetProject = activeProject;
      if (!targetProject) {
        const fromBackup = payload.project;
        const name = (fromBackup?.name || "").trim() || "還原的計畫";
        const created = await appFetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            code: (fromBackup?.code || "").trim(),
            clientName: (fromBackup?.clientName || "").trim(),
          }),
        });
        const createdData = await created.json();
        if (!created.ok)
          throw new Error(
            createdData.error || "備份檔要還原到一個計畫裡，但自動建立計畫失敗",
          );
        setProjects((list) => [...list, createdData.project]);
        setActiveProject(createdData.project.id);
        targetProject = createdData.project.id;
        setToast(`已依備份檔自動建立計畫「${name}」，正在還原資料…`);
      }
      const incomingQuarters = [...new Set(source.map((r) => r.quarter))];
      const overlaps = incomingQuarters.filter((q) => quarters.includes(q));
      /*
       * 匯入 Excel 的路徑會擋下已定稿的季度，還原備份的路徑以前不會——
       * 同一個鎖，一條路擋得住、另一條走得過去，等於沒有鎖。
       */
      const finalized = overlaps.filter(
        (q) => (workflow.statuses[q] ?? "草稿") === "定稿",
      );
      if (finalized.length)
        throw new Error(
          `${finalized.join("、")} 已定稿，系統已阻擋還原覆蓋。請先在「品質與定稿」將狀態改回草稿或待確認。`,
        );
      if (
        overlaps.length &&
        !window.confirm(
          `備份中的 ${overlaps.join("、")} 已存在。\n\n是否以備份內容完整覆蓋這些季度？不會重複累加。`,
        )
      )
        return;
      /*
       * 一定要用上面算出來的 targetProject，不能再呼叫
       * ensurePersistentProject()——setActiveProject 是 React 狀態更新，
       * 在同一個函式裡讀不到新值，剛自動建立的計畫會被當成「還沒選計畫」
       * 而再次丟錯。
       */
      const targetProjectId = targetProject;
      const restored = source.map((r) => ({
        ...r,
        projectId: targetProjectId,
      }));
      const restoredQuarters = [...new Set(restored.map((r) => r.quarter))];
      for (const restoredQuarter of restoredQuarters) {
        const rows = restored.filter((r) => r.quarter === restoredQuarter);
        const res = await appFetch("/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: targetProjectId,
            quarter: restoredQuarter,
            sourceObjectKeys: [],
            records: rows,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      for (const alias of payload.roadAliases ?? []) {
        const response = await appFetch("/api/roads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "alias",
            projectId: targetProjectId,
            roadId: alias.roadId,
            aliasName: alias.aliasName,
          }),
        });
        if (!response.ok)
          throw new Error((await response.json()).error ?? "路段別名還原失敗");
      }
      setRecords((prev) => [
        ...prev.filter(
          (r) =>
            !(
              r.projectId === targetProjectId &&
              restoredQuarters.includes(r.quarter)
            ),
        ),
        ...restored,
      ]);
      // 備份裡的四大類係數要一併寫回 localStorage，否則重新整理就會退回舊值，
      // 只有轉向係數與車種設定被還原，整份資料反而互相矛盾。
      // 同時比照載入時的檢查，避免壞掉的備份把係數全變成 undefined（PCU 會整欄變 0）。
      if (
        payload.pcuFactors &&
        CORE_VEHICLE_KEYS.every((key) =>
          Number.isFinite(Number((payload.pcuFactors as CorePcuFactors)[key])),
        )
      ) {
        const restored = { ...(payload.pcuFactors as CorePcuFactors) };
        setPcuFactors(restored);
        setPcuDraft(restored);
        writeProjectPcuFactors(activeProject, restored);
      }
      // 轉向係數比照載入時的檢查：4 車種 × 3 轉向共 12 個有效數字才採用。
      // 否則壞掉的備份會把 localStorage 汙染成載入時會被拒絕的內容，
      // 造成畫面上的值與儲存的值永久不一致。
      const restoredTurn = payload.turnPcuFactors as
        | TurnPcuFactors
        | undefined;
      const turnValues = restoredTurn
        ? Object.values(restoredTurn).flatMap((value) =>
            Object.values(value as Record<string, number>),
          )
        : [];
      if (
        restoredTurn &&
        turnValues.length === 12 &&
        turnValues.every((value) => Number.isFinite(Number(value)))
      ) {
        setTurnPcuFactors(restoredTurn);
        setTurnPcuDraft(restoredTurn);
        writeProjectTurnPcuFactors(activeProject, restoredTurn);
      } else if (payload.turnPcuFactors) {
        setToast(
          "備份中的轉向PCU係數不完整，已保留目前設定；請確認後於「PCU當量係數」重新輸入",
        );
      }
      if (payload.vehicleClassSettings) {
        const next = [
          ...vehicleClassSettings.filter(
            (setting) => setting.projectId !== targetProjectId,
          ),
          ...payload.vehicleClassSettings.map((setting) => ({
            ...setting,
            projectId: targetProjectId,
          })),
        ];
        setVehicleClassSettings(next);
        if (!safeWrite("traffic-vehicle-class-settings-v1", next))
          setToast("車種分類設定沒有存進瀏覽器（空間可能已滿）");
      }
      if (payload.intersectionSettings) {
        const next = [
          ...intersectionSettings.filter(
            (setting) => setting.projectId !== targetProjectId,
          ),
          ...payload.intersectionSettings.map((setting) => ({
            ...setting,
            projectId: targetProjectId,
          })),
        ];
        setIntersectionSettings(next);
        if (!safeWrite("traffic-intersection-settings-v1", next))
          setToast("路口設定沒有存進瀏覽器（空間可能已滿）");
      }
      if (payload.workflow) {
        /*
         * 只還原「這次備份實際包含的季度」的狀態，其餘保持原樣。
         *
         * 舊寫法是整份 WorkflowState 覆蓋，於是還原一份只含 115Q1 的舊備份，
         * 會把 115Q2 的「定稿」打回草稿、把已完成人工檢核的勾取消、把使用者
         * 調過的異常門檻改回預設——而畫面只說「已還原 1 個季度」。
         */
        const incoming = payload.workflow;
        const restoredSet = new Set(restoredQuarters);
        setWorkflow(function (current) {
          const base = current ?? emptyWorkflowState();
          const statuses = { ...base.statuses };
          for (const [key, value] of Object.entries(incoming.statuses ?? {}))
            if (restoredSet.has(key)) statuses[key] = value;
          const checkedQuarters = [
            // 不在還原範圍內的維持原狀
            ...base.checkedQuarters.filter((q) => !restoredSet.has(q)),
            // 還原範圍內的以備份為準
            ...(incoming.checkedQuarters ?? []).filter((q) =>
              restoredSet.has(q),
            ),
          ];
          return {
            ...base,
            statuses,
            checkedQuarters: [...new Set(checkedQuarters)],
            // 門檻與範本是「使用者目前的設定」，不屬於某一個季度，
            // 不該被一份舊備份改掉。
            /* 還原時 history 也要套用和其他寫入處一致的 10 筆上限：
       每一筆都含匯入前後兩份完整的計畫資料，無上限累加會讓
       IndexedDB 與匯出的備份檔等比膨脹。 */
      history: [...base.history, ...(incoming.history ?? [])].slice(0, 10),
          };
        });
      }
      /*
       * 條件範本：備份裡有就併進來（同名視為同一組，以備份為準）。
       * 用併入而不是覆蓋，因為使用者可能已經在這台電腦存過別的範本，
       * 還原一份舊備份不該把它們清掉。
       */
      if (Array.isArray(payload.conclusionTemplates) && payload.conclusionTemplates.length) {
        const existing = readConclusionTemplates(targetProjectId);
        const byName = new Map(existing.map((item) => [item.name, item]));
        for (const item of payload.conclusionTemplates)
          if (item && typeof item.name === "string") byName.set(item.name, item);
        const merged = [...byName.values()];
        writeConclusionTemplates(targetProjectId, merged);
        setConclusionTemplates(merged);
      }
      await refreshRoadAliases(targetProjectId);
      setQuarter(restoredQuarters.sort(compareQuarters).at(-1) ?? quarter);
      setShowImport(false);
      setToast(`已還原 ${restoredQuarters.length} 個季度，資料已永久保存`);
    } catch (error) {
      /*
       * JSON.parse 的訊息是英文的瀏覽器內部字串（例如
       * "Expected property name or '}' in JSON at position 1"），
       * 對使用者沒有意義。這種情況改成講人話。
       */
      const message =
        error instanceof Error ? error.message : "備份匯入失敗";
      setToast(
        /JSON|Unexpected token|Expected/i.test(message)
          ? "這個檔案不是有效的備份檔（內容格式無法解析）。原有資料未變動。"
          : message,
      );
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  async function renameQuarter(e: React.FormEvent) {
    e.preventDefault();
    const next = quarterDraft.trim().toUpperCase();
    if (!/^(?:\d{3}|\d{4})Q[1-4]$/.test(next))
      return setToast("季度格式請輸入115Q2或2026Q2");
    if (next === quarter) return setShowQuarterManager(false);
    if (quarters.includes(next))
      return setToast(`${next} 已存在，請先清除或改用其他名稱`);
    setBusy(true);
    try {
      const res = await appFetch("/api/quarters", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject,
          quarter,
          newQuarter: next,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRecords((prev) =>
        prev.map((r) =>
          r.projectId === activeProject && r.quarter === quarter
            ? { ...r, quarter: next }
            : r,
        ),
      );
      setWorkflow((previous) => {
        const statuses = { ...previous.statuses };
        if (statuses[quarter]) {
          statuses[next] = statuses[quarter];
          delete statuses[quarter];
        }
        return {
          ...previous,
          statuses,
          checkedQuarters: previous.checkedQuarters.map((item) =>
            item === quarter ? next : item,
          ),
        };
      });
      setQuarter(next);
      setShowQuarterManager(false);
      setToast(`季度已改為 ${next}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "季度修改失敗");
    } finally {
      setBusy(false);
    }
  }
  async function refreshRoadAliases(projectId = activeProject) {
    if (!projectId) return;
    const response = await appFetch(
      `/api/roads?projectId=${encodeURIComponent(projectId)}`,
    );
    const data = await response.json();
    if (response.ok && data.aliases) setRoadAliases(data.aliases);
  }
  function openRoadManager() {
    const first =
      roadFilter !== "ALL" ? roadFilter : roadManagerRows[0]?.roadId;
    if (!first) return setToast("目前計畫尚無可管理的路段");
    setRoadManageId(first);
    setShowRoadManager(true);
  }
  async function saveRoadSettings(e: React.FormEvent) {
    e.preventDefault();
    const current = roadManagerRows.find((r) => r.roadId === roadManageId);
    if (!current || !roadDraft.roadName.trim())
      return setToast("請輸入路段名稱");
    setBusy(true);
    try {
      const response = await appFetch("/api/roads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "rename",
          projectId: activeProject,
          roadId: roadManageId,
          roadName: roadDraft.roadName,
          directionA: roadDraft.directionA,
          directionB: roadDraft.directionB,
          aliasName: roadDraft.aliasName,
          surveyType: current.surveyType,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRecords((previous) =>
        previous.map((r) =>
          r.projectId === activeProject && r.roadId === roadManageId
            ? {
                ...r,
                roadName: data.roadName,
                directionName:
                  current.surveyType === "road"
                    ? r.directionCode === "A"
                      ? data.directionA
                      : r.directionCode === "B"
                        ? data.directionB
                        : r.directionName
                    : r.directionName,
              }
            : r,
        ),
      );
      await refreshRoadAliases();
      setRoadDraft((d) => ({ ...d, aliasName: "" }));
      setToast(`路段「${data.roadName}」已更新，歷季資料同步套用`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "路段更新失敗");
    } finally {
      setBusy(false);
    }
  }
  async function mergeRoad() {
    const source = roadManagerRows.find((r) => r.roadId === roadManageId),
      target = roadManagerRows.find((r) => r.roadId === roadDraft.mergeTarget);
    if (!source || !target || source.roadId === target.roadId)
      return setToast("請選擇另一個既有路段作為合併目標");
    if (source.surveyType !== target.surveyType)
      return setToast("路段格式與路口格式不可互相合併");
    /*
     * 合併會把方向名稱**統一**成一組，套用到來源與目標的每一筆資料。
     * 原本直接拿 target.directionA／directionB，而那兩個在目標路段還沒取過
     * 名字時只是「方向A／方向B」這個預設值——結果就是使用者在來源路段打好的
     * 「南下／北上」，在按下合併的瞬間被預設值蓋掉，而且沒有任何提示。
     *
     * ⚠️ A 與 B 一定要**取自同一條路段**，不可以各挑各的。
     * 分開挑的話，「目標只有 B 有名字＝往南、來源 A＝往南 B＝往北」這種組合
     * 會挑出 A＝往南（來源）、B＝往南（目標）——兩個方向同名，
     * 篩選與 Excel 的 A／B 欄從此分不出來。
     * 所以是「哪一條路段有取過名字」二選一，整組沿用。
     */
    const targetNamed =
      isRealDirectionName(target.directionA, "A") ||
      isRealDirectionName(target.directionB, "B");
    const sourceNamed =
      isRealDirectionName(source.directionA, "A") ||
      isRealDirectionName(source.directionB, "B");
    const namingRoad = targetNamed || !sourceNamed ? target : source;
    const mergedDirectionA = pickDirectionName("A", namingRoad.directionA);
    const mergedDirectionB = pickDirectionName("B", namingRoad.directionB);
    const directionNotice =
      target.surveyType === "road"
        ? `\n方向名稱將統一為：A＝${mergedDirectionA}、B＝${mergedDirectionB}`
        : "";
    const affected = `影響季度：${source.quarters.join("、") || "—"}\n影響資料：${formatter.format(source.rows)} 筆\n\n「${source.roadName}」將合併到「${target.roadName}」，原路段名稱會保留為辨識別名。${directionNotice}`;
    if (!window.confirm(`${affected}\n\n確定執行合併？`)) return;
    setBusy(true);
    try {
      // 型態不合的檢查已經移到 window.confirm 之前：本來擋在確認之後，
      // 使用者會先看到「方向名稱將統一為…」再被退回，白按一次。
      const response = await appFetch("/api/roads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "merge",
          projectId: activeProject,
          sourceRoadId: source.roadId,
          targetRoadId: target.roadId,
          targetRoadName: target.roadName,
          directionA: mergedDirectionA,
          directionB: mergedDirectionB,
          surveyType: target.surveyType,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRecords((previous) =>
        previous.map((r) =>
          r.projectId === activeProject &&
          (r.roadId === source.roadId || r.roadId === target.roadId)
            ? {
                ...r,
                roadId: target.roadId,
                roadName: target.roadName,
                directionName:
                  target.surveyType === "road"
                    ? r.directionCode === "A"
                      ? mergedDirectionA
                      : r.directionCode === "B"
                        ? mergedDirectionB
                        : r.directionName
                    : r.directionName,
              }
            : r,
        ),
      );
      if (roadFilter === source.roadId) setRoadFilter(target.roadId);
      if (compositionRoad === source.roadId) setCompositionRoad(target.roadId);
      if (trendRoad === source.roadId) setTrendRoad(target.roadId);
      setRoadManageId(target.roadId);
      await refreshRoadAliases();
      setToast(`已將「${source.roadName}」合併至「${target.roadName}」`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "路段合併失敗");
    } finally {
      setBusy(false);
    }
  }
  function openIntersectionManager() {
    if (!intersectionManagerRows.length)
      return setToast("目前計畫尚未匯入路口轉向格式資料");
    const first =
      roadFilter !== "ALL" &&
      intersectionManagerRows.some((r) => r.roadId === roadFilter)
        ? roadFilter
        : intersectionManagerRows[0].roadId;
    setIntersectionManageRoad(first);
    setShowIntersectionManager(true);
  }
  function updateArmSetting(
    directionCode: string,
    patch: Partial<IntersectionArmSetting>,
  ) {
    if (!managedIntersection) return;
    setIntersectionSettings((previous) => {
      const keyMatch = (setting: IntersectionArmSetting) =>
        setting.projectId === activeProject &&
        setting.roadId === managedIntersection.roadId &&
        setting.directionCode === directionCode;
      const current =
        previous.find(keyMatch) ??
        managedArmSettings.find(
          (setting) => setting.directionCode === directionCode,
        );
      if (!current) return previous;
      return [
        ...previous.filter((setting) => !keyMatch(setting)),
        { ...current, ...patch },
      ];
    });
  }
  function updateArmRoute(
    directionCode: string,
    targetCode: string,
    movement: TurnKey,
  ) {
    if (!managedIntersection) return;
    const routed = managedArmSettings.map((setting) =>
      setting.directionCode === directionCode
        ? { ...setting, routes: { ...setting.routes, [targetCode]: movement } }
        : setting,
    );
    const mapped = completeArmTargets(routed, true);
    setIntersectionSettings((previous) => [
      ...previous.filter(
        (setting) =>
          !(
            setting.projectId === activeProject &&
            setting.roadId === managedIntersection.roadId
          ),
      ),
      ...mapped,
    ]);
  }
  function updateArmAngle(directionCode: string, angle: number) {
    if (!managedIntersection || !Number.isFinite(angle)) return;
    const angled = managedArmSettings.map((setting) =>
      setting.directionCode === directionCode ? { ...setting, angle } : setting,
    );
    const routed = angled.map((setting) => ({
      ...setting,
      routes: Object.fromEntries(
        angled
          .filter((target) => target.directionCode !== setting.directionCode)
          .map((target) => [
            target.directionCode,
            classifyMovement(setting.angle, target.angle),
          ]),
      ) as Record<string, TurnKey>,
    }));
    const mapped = completeArmTargets(routed, true);
    setIntersectionSettings((previous) => [
      ...previous.filter(
        (setting) =>
          !(
            setting.projectId === activeProject &&
            setting.roadId === managedIntersection.roadId
          ),
      ),
      ...mapped,
    ]);
  }
  function autoMapIntersection() {
    if (!managedIntersection) return;
    const routed = managedArmSettings.map((setting) => {
      const routes = Object.fromEntries(
        managedArmSettings
          .filter((target) => target.directionCode !== setting.directionCode)
          .map((target) => [
            target.directionCode,
            classifyMovement(setting.angle, target.angle),
          ]),
      ) as Record<string, TurnKey>;
      return { ...setting, routes };
    });
    const mapped = completeArmTargets(routed, true);
    setIntersectionSettings((previous) => [
      ...previous.filter(
        (setting) =>
          !(
            setting.projectId === activeProject &&
            setting.roadId === managedIntersection.roadId
          ),
      ),
      ...mapped,
    ]);
    setToast("已依角度重新判定轉向及駛出目的支線；仍可逐筆人工修正");
  }
  function saveIntersectionSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!managedIntersection) return;
    if (managedArmSettings.some((setting) => !Number.isFinite(setting.angle)))
      return setToast("每一支線都必須輸入有效角度");
    const duplicateAngles = managedArmSettings.map((setting) =>
      normalizeAngle(setting.angle).toFixed(3),
    );
    if (new Set(duplicateAngles).size !== duplicateAngles.length)
      return setToast("不同支線不可使用完全相同的角度");
    const next = [
      ...intersectionSettings.filter(
        (setting) =>
          !(
            setting.projectId === activeProject &&
            setting.roadId === managedIntersection.roadId
          ),
      ),
      ...managedArmSettings,
    ];
    setIntersectionSettings(next);
    if (!safeWrite("traffic-intersection-settings-v1", next))
      setToast("路口設定沒有存進瀏覽器（空間可能已滿），重新整理後會回到舊值");
    setShowIntersectionManager(false);
    setToast("路口角度、轉向判定與駛出目的支線已儲存，駛入／駛出分析同步更新");
  }
  async function deleteQuarter() {
    if (
      !window.confirm(
        // 已定稿的季度要在提示裡點名，否則刪掉的是一份已經確認交付的成果，
        // 而確認視窗裡連「定稿」兩個字都沒出現。
        `確定清除「${selectedProject.name}」的 ${quarter} 分析資料？` +
          ((workflow.statuses[quarter] ?? "草稿") === "定稿"
            ? `\n\n⚠ ${quarter} 目前的狀態是「定稿」，清除後該季度的定稿紀錄也會一併消失。`
            : "") +
          "\n\n此動作無法復原；原始上傳檔仍會保留供追溯。",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await appFetch("/api/quarters", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: activeProject, quarter }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const oldQuarter = quarter,
        remaining = quarters.filter((q) => q !== oldQuarter);
      setRecords((prev) =>
        prev.filter(
          (r) => !(r.projectId === activeProject && r.quarter === oldQuarter),
        ),
      );
      setWorkflow((previous) => {
        const statuses = { ...previous.statuses };
        delete statuses[oldQuarter];
        return {
          ...previous,
          statuses,
          checkedQuarters: previous.checkedQuarters.filter(
            (item) => item !== oldQuarter,
          ),
        };
      });
      setQuarter(remaining.at(-1) ?? "");
      setShowQuarterManager(false);
      setToast(`${oldQuarter} 分析資料已清除`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "清除失敗");
    } finally {
      setBusy(false);
    }
  }
  async function replaceAllProjectRecords(nextRecords: TrafficRecord[]) {
    const targetProjectId = await ensurePersistentProject();
    const currentQuarters = [
      ...new Set(activeRecords.map((record) => record.quarter)),
    ];
    for (const existingQuarter of currentQuarters) {
      const response = await appFetch("/api/quarters", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: targetProjectId,
          quarter: existingQuarter,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error ?? `清除 ${existingQuarter} 失敗`,
        );
    }
    for (const nextQuarter of [
      ...new Set(nextRecords.map((record) => record.quarter)),
    ]) {
      const rows = nextRecords
        .filter((record) => record.quarter === nextQuarter)
        .map((record) => ({ ...record, projectId: targetProjectId }));
      if (!rows.length) continue;
      const response = await appFetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: targetProjectId,
          quarter: nextQuarter,
          sourceObjectKeys: [],
          records: rows,
        }),
      });
      if (!response.ok)
        throw new Error(
          (await response.json()).error ?? `還原 ${nextQuarter} 失敗`,
        );
    }
    setRecords((previous) => [
      ...previous.filter((record) => record.projectId !== targetProjectId),
      ...nextRecords.map((record) => ({
        ...record,
        projectId: targetProjectId,
      })),
    ]);
  }
  async function restoreHistory(entry: ImportHistoryEntry) {
    if (
      !window.confirm(
        `確定將計畫還原到 ${new Date(entry.importedAt).toLocaleString("zh-TW")} 匯入前？\n\n目前資料會先保留為一筆復原紀錄。`,
      )
    )
      return;
    setBusy(true);
    try {
      const reverse: ImportHistoryEntry = {
        id: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
        operator: user?.displayName ?? "本機使用者",
        device: navigator.platform || "瀏覽器",
        quarter: entry.quarter,
        files: ["版本還原"],
        rowCount: entry.beforeRecords.length,
        addedRows: 0,
        replacedRows: activeRecords.length,
        roads: [],
        vehicles: [],
        beforeRecords: activeRecords,
        afterRecords: entry.beforeRecords,
      };
      await replaceAllProjectRecords(entry.beforeRecords);
      setWorkflow((previous) => ({
        ...previous,
        history: [reverse, ...previous.history].slice(0, 10),
        statuses: { ...previous.statuses, [entry.quarter]: "草稿" },
      }));
      setShowHistoryCenter(false);
      setToast("已還原匯入前版本，並保留反向復原紀錄");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "版本還原失敗");
    } finally {
      setBusy(false);
    }
  }
  async function deleteSourceFile(sourceFileName: string) {
    const affected = activeRecords.filter(
      (record) => record.sourceFileName === sourceFileName,
    );
    if (!affected.length) return setToast("找不到此來源檔產生的資料");
    if (
      !window.confirm(
        `確定刪除來源檔「${sourceFileName}」產生的 ${formatter.format(affected.length)} 筆資料？\n\n系統會先建立可復原版本。`,
      )
    )
      return;
    setBusy(true);
    try {
      const next = activeRecords.filter(
        (record) => record.sourceFileName !== sourceFileName,
      );
      await replaceAllProjectRecords(next);
      const entry: ImportHistoryEntry = {
        id: crypto.randomUUID(),
        importedAt: new Date().toISOString(),
        operator: user?.displayName ?? "本機使用者",
        device: navigator.platform || "瀏覽器",
        quarter: [...new Set(affected.map((row) => row.quarter))].join("、"),
        files: [`刪除：${sourceFileName}`],
        rowCount: affected.length,
        addedRows: 0,
        replacedRows: affected.length,
        roads: [...new Set(affected.map((row) => row.roadName))],
        vehicles: [],
        beforeRecords: activeRecords,
        afterRecords: next,
      };
      setWorkflow((previous) => ({
        ...previous,
        history: [entry, ...previous.history].slice(0, 10),
      }));
      setToast(`已刪除「${sourceFileName}」產生的資料`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "來源資料刪除失敗");
    } finally {
      setBusy(false);
    }
  }
  function saveProjectTemplate() {
    const name = templateName.trim();
    if (!name) return setToast("請輸入範本名稱");
    const template: ProjectTemplate = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings: vehicleClassSettings
        .filter((setting) => setting.projectId === activeProject)
        .map(({ projectId: _id, ...setting }) => setting),
      intersectionSettings: intersectionSettings
        .filter((setting) => setting.projectId === activeProject)
        .map(({ projectId: _id, ...setting }) => setting),
      roadAliases,
      thresholds: workflow.thresholds,
    };
    setWorkflow((previous) => ({
      ...previous,
      templates: [template, ...previous.templates],
    }));
    setTemplateName("");
    setToast(`已儲存設定範本「${name}」`);
  }
  async function applyProjectTemplate(template: ProjectTemplate) {
    if (
      !window.confirm(
        `套用「${template.name}」會取代目前 PCU、車種分類、路口幾何與異常門檻設定，原始交通量不會改變。是否繼續？`,
      )
    )
      return;
    const nextPcu = template.pcuFactors as PcuFactors,
      nextTurn = template.turnPcuFactors as TurnPcuFactors;
    setPcuFactors(nextPcu);
    setPcuDraft(nextPcu);
    setTurnPcuFactors(nextTurn);
    setTurnPcuDraft(nextTurn);
    writeProjectPcuFactors(activeProject, nextPcu);
    writeProjectTurnPcuFactors(activeProject, nextTurn);
    const nextVehicleClass = [
      ...vehicleClassSettings.filter(
        (setting) => setting.projectId !== activeProject,
      ),
      ...(
        template.vehicleClassSettings as Omit<VehicleClassSetting, "projectId">[]
      ).map((setting) => ({ ...setting, projectId: activeProject })),
    ];
    setVehicleClassSettings(nextVehicleClass);
    safeWrite("traffic-vehicle-class-settings-v1", nextVehicleClass);
    const nextIntersection = [
      ...intersectionSettings.filter(
        (setting) => setting.projectId !== activeProject,
      ),
      ...(
        template.intersectionSettings as Omit<
          IntersectionArmSetting,
          "projectId"
        >[]
      ).map((setting) => ({ ...setting, projectId: activeProject })),
    ];
    setIntersectionSettings(nextIntersection);
    safeWrite("traffic-intersection-settings-v1", nextIntersection);
    for (const alias of template.roadAliases as {
      roadId: string;
      aliasName: string;
    }[]) {
      const response = await appFetch("/api/roads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "alias",
          projectId: activeProject,
          roadId: alias.roadId,
          aliasName: alias.aliasName,
        }),
      });
      if (!response.ok)
        return setToast(
          (await response.json()).error ?? `別名「${alias.aliasName}」套用失敗`,
        );
    }
    await refreshRoadAliases();
    setWorkflow((previous) => ({
      ...previous,
      thresholds: { ...template.thresholds },
    }));
    setShowTemplateCenter(false);
    setToast(`已套用設定範本「${template.name}」`);
  }
  function saveComparisonReport() {
    const name = reportTemplateName.trim();
    if (!name) return setToast("請輸入比較報表名稱");
    const report: ComparisonReportTemplate = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      compareProjectIds: [...compareIds],
      quarter,
      dayType,
      roadFilter,
      direction,
      metric: dayMetric,
      exportSections: { ...exportSections },
      periodExport: {
        ...periodExport,
        periods: [...periodExport.periods],
        scopes: [...periodExport.scopes],
        metrics: [...periodExport.metrics],
      },
    };
    setWorkflow((previous) => ({
      ...previous,
      comparisonReports: [report, ...(previous.comparisonReports ?? [])],
    }));
    setReportTemplateName("");
    setToast(`已儲存比較報表「${name}」`);
  }
  function applyComparisonReport(report: ComparisonReportTemplate) {
    // 範本存在瀏覽器儲存區，可能是舊版本或被手動改壞的資料，
    // 這裡只採用認得的欄位，其餘一律保留目前設定，避免整個畫面被污染。
    const savedIds = Array.isArray(report.compareProjectIds)
      ? report.compareProjectIds
      : [];
    const availableIds = savedIds.filter((id) =>
      projects.some((project) => project.id === id),
    );
    setCompareIds(availableIds);
    if (typeof report.quarter === "string" && report.quarter)
      setQuarter(report.quarter);
    if (DAY_MODES.includes(report.dayType as DayMode))
      setDayType(report.dayType as DayMode);
    if (typeof report.roadFilter === "string") setRoadFilter(report.roadFilter);
    if (typeof report.direction === "string") setDirection(report.direction);
    if (report.metric === "actual" || report.metric === "pcu")
      setDayMetric(report.metric);
    setExportSections((previous) => {
      const saved = (report.exportSections ?? {}) as Record<string, unknown>;
      const next = { ...previous };
      (Object.keys(previous) as (keyof typeof previous)[]).forEach((key) => {
        if (typeof saved[key as string] === "boolean")
          next[key] = saved[key as string] as boolean;
      });
      return next;
    });
    // 舊範本沒有這個欄位時會退回預設值，不會讓套用整個失敗。
    setPeriodExport(normalizePeriodExportSelection(report.periodExport));
    setShowExportCenter(false);
    setToast(
      `已套用比較報表「${report.name}」${availableIds.length !== savedIds.length ? "；部分不存在的計畫已略過" : ""}`,
    );
  }
  async function exportLegacy() {
    const XLSX = await import("xlsx");
    /*
     * 欄名的單位要跟畫面一致。部分時段調查的總量不是全日量，
     * 標成「輛/日」會讓人直接拿去跟完整 24 小時的季度比較。
     */
    const sheetActualUnit = surveyScope.partial ? "輛/調查時段" : "輛/日";
    const sheetPcuUnit = surveyScope.partial ? "PCU/調查時段" : "PCU/日";
    const roadDetails = roadOnlyRows.map((r) => ({
      季度: quarter,
      日別: dayType,
      調查點編號: r.roadId,
      調查點名稱: r.roadName,
      // roadOnlyRows 已經只留下路段（surveyType === "road"），
      // 這裡不需要、也不能再用 isIntersection——那是歷季趨勢列才有的欄位。
      [`方向A（${sheetActualUnit}・僅路段）`]: r.a,
      [`方向B（${sheetActualUnit}・僅路段）`]: r.b,
      [`方向A（${sheetPcuUnit}・僅路段）`]: r.aPcu,
      [`方向B（${sheetPcuUnit}・僅路段）`]: r.bPcu,
      [`全日（${sheetActualUnit}）`]: r.total,
      [`24小時（${sheetPcuUnit}）`]: r.pcu24,
      "雙向尖峰（PCU/小時）": r.peakPcu,
      雙向尖峰時段: r.peakHour,
    }));
    const intersectionDetails = intersectionOnlyRows.flatMap((r) =>
      r.directions.map((d) => ({
        季度: quarter,
        日別: dayType,
        流量視角: intersectionFlowLabel,
        路口編號: r.roadId,
        路口名稱: r.roadName,
        [`${intersectionFlowLabel}支線`]: d.name,
        [`${intersectionFlowLabel}交通量（${sheetActualUnit}）`]: d.actual,
        [`${intersectionFlowLabel}交通量（${sheetPcuUnit}）`]: d.pcu,
        [`${intersectionFlowLabel}尖峰（PCU/小時）`]: d.peakPcu,
        [`${intersectionFlowLabel}尖峰時段`]: d.peakHour,
        [`全日（${sheetActualUnit}）`]: r.total,
        [`24小時（${sheetPcuUnit}）`]: r.pcu24,
      })),
    );
    const historicalDailyExport = historicalDailyRows.map(
      ({
        vehicles: _vehicles,
        motorcycle: _motorcycle,
        small: _small,
        large: _large,
        special: _special,
        ...row
      }) => row,
    );
    const comp = historicalCompositionRows.map((r) =>
      Object.fromEntries([
        ["季度", r.quarter],
        ["日別", r.dayType],
        ["調查點編號", r.roadId],
        ["調查點名稱", r.roadName],
        ...analysisVehicleCatalog.flatMap((vehicle) => [
          [`${vehicle.label}（${sheetActualUnit}）`, r.vehicles[vehicle.key] ?? 0],
          [`${vehicle.label}（%）`, r.vehiclePct[vehicle.key] ?? 0],
        ]),
      ]),
    );
    const directionComp = compositionExportRows.map((r) => {
      const total = Object.values(r.vehicles).reduce(
        (sum, value) => sum + value,
        0,
      );
      return Object.fromEntries([
        ["日別", r.dayType],
        ["調查點", r.roadName],
        ["方向", r.directionName],
        ...analysisVehicleCatalog.flatMap((vehicle) => [
          [`${vehicle.label}（輛）`, r.vehicles[vehicle.key] ?? 0],
          [
            `${vehicle.label}（%）`,
            total ? (r.vehicles[vehicle.key] ?? 0) / total : 0,
          ],
        ]),
      ]);
    });
    const turnFactorRows = CORE_VEHICLE_KEYS.map((key) => ({
      車種: coreVehicleLabels[key],
      分析方式: "原四大類",
      直行: turnPcuFactors[key].through,
      右轉: turnPcuFactors[key].right,
      左轉: turnPcuFactors[key].left,
    })).concat(
      vehicleClassSettings
        .filter(
          (setting) =>
            setting.projectId === activeProject &&
            setting.targetKey === setting.sourceKey &&
            !CORE_VEHICLE_KEYS.includes(setting.sourceKey as CoreVehicleKey),
        )
        .map((setting) => ({
          車種: setting.sourceLabel,
          分析方式: "獨立車種",
          直行: setting.turnPcu.through,
          右轉: setting.turnPcu.right,
          左轉: setting.turnPcu.left,
        })),
    );
    const roadFactorRows = CORE_VEHICLE_KEYS.map((key) => ({
      車種: coreVehicleLabels[key],
      分析方式: "原四大類",
      PCU係數: pcuFactors[key],
    })).concat(
      vehicleClassSettings
        .filter(
          (setting) =>
            setting.projectId === activeProject &&
            setting.targetKey === setting.sourceKey &&
            !CORE_VEHICLE_KEYS.includes(setting.sourceKey as CoreVehicleKey),
        )
        .map((setting) => ({
          車種: setting.sourceLabel,
          分析方式: "獨立車種",
          PCU係數: setting.roadPcu,
        })),
    );
    const classRows = vehicleClassSettings
      .filter((setting) => setting.projectId === activeProject)
      .map((setting) => ({
        原始車種: setting.sourceLabel,
        分析歸類: setting.targetLabel,
        是否合併: setting.targetKey === setting.sourceKey ? "否" : "是",
      }));
    const flowSettingRows = effectiveIntersectionSettings.map((setting) => ({
      路口編號: setting.roadId,
      來源支線: `路口${setting.directionCode}`,
      支線名稱: setting.name,
      角度: normalizeAngle(setting.angle),
      左轉駛出: setting.leftTarget ? `路口${setting.leftTarget}` : "未指定",
      直行駛出: setting.throughTarget
        ? `路口${setting.throughTarget}`
        : "未指定",
      右轉駛出: setting.rightTarget ? `路口${setting.rightTarget}` : "未指定",
    }));
    const wb = XLSX.utils.book_new();
    // 舊版 .xls 也要遵守「匯出項目」勾選，否則新版與舊版格式的內容會不一致。
    const add = (
      section: keyof typeof exportSections,
      rows: unknown[],
      name: string,
    ) => {
      if (!exportSections[section] || !rows.length) return;
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.json_to_sheet(rows as Record<string, unknown>[]),
        name.slice(0, 31),
      );
    };
    add("current", roadDetails, "路段本季明細");
    add("current", intersectionDetails, `路口${intersectionFlowLabel}明細`);
    add("history", historicalDailyExport, "歷季全日交通量");
    add("composition", comp, "歷季車種組成");
    add("composition", directionComp, "方向別車種組成");
    add("current", dayComparisons, "平假日比較");
    add("settings", roadFactorRows, "路段PCU係數");
    add("settings", turnFactorRows, "路口轉向PCU係數");
    add("settings", classRows, "車種歸類設定");
    add("settings", flowSettingRows, "路口駛出對應");
    if (periodExport.enabled)
      for (const sheet of buildPeriodExportSheets(
        periodExportRows,
        analysisVehicleCatalog,
        periodExport,
        {
          flowLabel: periodExportFlowLabel,
          separateDays: dayType === "平日＋假日",
          partial: surveyScope.partial,
        },
      ))
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]),
          sheet.name.slice(0, 31),
        );
    if (!wb.SheetNames.length) {
      // 舊版 .xls 只涵蓋四類資料表；若使用者勾的全是這個格式沒有的項目，
      // 要說清楚是格式限制，而不是含糊地說「沒有資料」。
      const legacyCovered = (
        ["current", "history", "composition", "settings"] as const
      ).some((key) => exportSections[key]);
      setToast(
        legacyCovered
          ? "勾選的匯出項目在目前條件下沒有任何資料，請改變季度或勾選其他項目"
          : "舊版 .xls 只支援本季明細、歷季彙整、車種組成與參數設定四類；其餘項目請改用新版 .xlsx",
      );
      return;
    }
    XLSX.writeFile(
      wb,
      exportFileName(
        projects.find((p) => p.id === activeProject)?.name ?? "",
        quarter,
        "xls",
      ),
      {
        bookType: "biff8",
      },
    );
    setToast("舊版 .xls 已匯出，路段與路口明細會分表顯示");
  }
  async function exportWorkbook() {
    // 面板上的「下載此圖 Excel」不會經過批次輸出中心的按鈕停用條件，
    // 所以守門條件要放在函式裡，避免產生一張工作表都沒有的壞檔。
    const hasSection = Object.values(exportSections).some(Boolean);
    const hasPeriod =
      periodExport.enabled &&
      periodExport.periods.length > 0 &&
      periodExport.metrics.length > 0;
    if (!hasSection && !hasPeriod)
      return setToast("匯出項目全部取消勾選了，請至少保留一項再匯出");
    setBusy(true);
    try {
      /*
       * 部分時段調查（例如只做 07:00–09:00＋17:00–19:00）的合計**不是全日量**，
       * 標成「輛/日」「24小時PCU」會讓人直接拿去和完整 24 小時的季度相比，
       * 也會讓 4 小時的量被當成一整天。舊版 .xls 匯出（exportLegacy）早就依
       * surveyScope.partial 切過單位了，主要交付用的 .xlsx 這一支漏掉。
       */
      const sheetActualUnit = surveyScope.partial ? "輛/調查時段" : "輛/日";
      const sheetPcuUnit = surveyScope.partial ? "PCU/調查時段" : "PCU/日";
      const pcu24Label = surveyScope.partial
        ? `調查時段PCU（${sheetPcuUnit}）`
        : `24小時PCU（${sheetPcuUnit}）`;
      const totalLabel = surveyScope.partial
        ? `調查時段實際交通量（${sheetActualUnit}）`
        : `全日實際交通量（${sheetActualUnit}）`;
      const ExcelJS = (await import("exceljs")).default;
      /*
       * exceljs 是動態載入的，型別要在這裡就地宣告；只寫這裡真的會用到的
       * 那幾個樣式欄位，比 any 精確，也不必為了型別把整包 exceljs 靜態載進來。
       */
      type ExcelJsCell = {
        fill: unknown;
        font: unknown;
        alignment: unknown;
      };
      type ExcelJsRow = { eachCell: (visit: (cell: ExcelJsCell) => void) => void };
      const wb = new ExcelJS.Workbook();
      wb.creator = "全日交通量及車種組成";
      wb.calcProperties.fullCalcOnLoad = true;
      const header = (row: ExcelJsRow) =>
        row.eachCell((cell: ExcelJsCell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF148C8C" },
          };
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
          };
        });
      const data = wb.addWorksheet("本季交通量及PCU", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      const dataBaseHeaders = [
        "季度",
        "日別",
        "路段編號",
        "路段名稱",
        `方向A實際量（${sheetActualUnit}）`,
        `方向B實際量（${sheetActualUnit}）`,
        `方向A（${sheetPcuUnit}）`,
        `方向B（${sheetPcuUnit}）`,
        totalLabel,
        pcu24Label,
        "雙向合計尖峰（PCU/小時）",
        "雙向尖峰時段",
        "方向A尖峰（PCU/小時）",
        "方向A尖峰時段",
        "方向B尖峰（PCU/小時）",
        "方向B尖峰時段",
      ];
      data.addRow([
        ...dataBaseHeaders,
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（${sheetActualUnit}）`),
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}比例（%）`),
      ]);
      roadOnlyRows.forEach((r) =>
        data.addRow([
          quarter,
          dayType,
          r.roadId,
          r.roadName,
          r.a,
          r.b,
          r.aPcu,
          r.bPcu,
          r.total,
          r.pcu24,
          r.peakPcu,
          r.peakHour,
          r.aPeakPcu,
          r.aPeakHour,
          r.bPeakPcu,
          r.bPeakHour,
          ...analysisVehicleCatalog.map(
            (vehicle) => r.vehicles[vehicle.key] ?? 0,
          ),
          ...analysisVehicleCatalog.map((vehicle) =>
            r.total ? (r.vehicles[vehicle.key] ?? 0) / r.total : 0,
          ),
        ]),
      );
      if (!roadOnlyRows.length)
        data.addRow([
          quarter,
          dayType,
          "",
          `本季無路段格式資料；請查看「路口${intersectionFlowLabel}交通量」工作表`,
        ]);
      data.columns = [
        ...[12, 10, 16, 34, 20, 20, 17, 17, 23, 20, 23, 18, 21, 18, 21, 18],
        ...analysisVehicleCatalog.map(() => 17),
        ...analysisVehicleCatalog.map(() => 15),
      ].map((width) => ({ width }));
      header(data.getRow(1));
      [7, 8, 10, 11, 13, 15].forEach(
        (c) => (data.getColumn(c).numFmt = "#,##0.0"),
      );
      analysisVehicleCatalog.forEach(
        (_, index) =>
          (data.getColumn(17 + analysisVehicleCatalog.length + index).numFmt =
            "0.0%"),
      );
      data.autoFilter = {
        from: "A1",
        to: `${colName(dataBaseHeaders.length + analysisVehicleCatalog.length * 2)}${roadOnlyRows.length + 1}`,
      };
      if (intersectionOnlyRows.length) {
        const intersectionData = wb.addWorksheet(
          `路口${intersectionFlowLabel}交通量`,
          { views: [{ state: "frozen", ySplit: 1 }] },
        );
        intersectionData.addRow([
          "季度",
          "日別",
          "流量視角",
          "路口編號",
          "路口名稱",
          `${intersectionFlowLabel}支線`,
          `${intersectionFlowLabel}交通量（${sheetActualUnit}）`,
          `${intersectionFlowLabel}交通量（${sheetPcuUnit}）`,
          `${intersectionFlowLabel}尖峰（PCU/小時）`,
          "尖峰時段",
          totalLabel,
          pcu24Label,
        ]);
        intersectionOnlyRows.forEach((r) =>
          r.directions.forEach((d) =>
            intersectionData.addRow([
              quarter,
              dayType,
              intersectionFlowLabel,
              r.roadId,
              r.roadName,
              d.name,
              d.actual,
              d.pcu,
              d.peakPcu,
              d.peakHour,
              r.total,
              r.pcu24,
            ]),
          ),
        );
        intersectionData.columns = [
          12, 12, 12, 18, 36, 22, 24, 24, 26, 20, 26, 22,
        ].map((width) => ({ width }));
        header(intersectionData.getRow(1));
        [8, 9, 12].forEach(
          (column) => (intersectionData.getColumn(column).numFmt = "#,##0.0"),
        );
      }
      const turnFactorSheet = wb.addWorksheet("路口轉向PCU係數");
      turnFactorSheet.addRow([
        "原始車種",
        "分析歸類",
        "一般PCU",
        "直行",
        "右轉",
        "左轉",
      ]);
      CORE_VEHICLE_KEYS.forEach((key) =>
        turnFactorSheet.addRow([
          coreVehicleLabels[key],
          coreVehicleLabels[key],
          pcuFactors[key],
          turnPcuFactors[key].through,
          turnPcuFactors[key].right,
          turnPcuFactors[key].left,
        ]),
      );
      vehicleClassSettings
        .filter(
          (setting) =>
            setting.projectId === activeProject &&
            !CORE_VEHICLE_KEYS.includes(setting.sourceKey as CoreVehicleKey),
        )
        .forEach((setting) =>
          turnFactorSheet.addRow([
            setting.sourceLabel,
            setting.targetLabel,
            setting.targetKey === setting.sourceKey
              ? setting.roadPcu
              : `使用${setting.targetLabel}係數`,
            setting.targetKey === setting.sourceKey
              ? setting.turnPcu.through
              : `使用${setting.targetLabel}係數`,
            setting.targetKey === setting.sourceKey
              ? setting.turnPcu.right
              : `使用${setting.targetLabel}係數`,
            setting.targetKey === setting.sourceKey
              ? setting.turnPcu.left
              : `使用${setting.targetLabel}係數`,
          ]),
        );
      turnFactorSheet.columns = [18, 20, 18, 15, 15, 15].map((width) => ({
        width,
      }));
      header(turnFactorSheet.getRow(1));
      if (effectiveIntersectionSettings.length) {
        const flowSettings = wb.addWorksheet("路口駛出對應", {
          views: [{ state: "frozen", ySplit: 1 }],
        });
        flowSettings.addRow([
          "路口編號",
          "來源支線",
          "支線名稱",
          "角度（°）",
          "左轉駛出",
          "直行駛出",
          "右轉駛出",
        ]);
        effectiveIntersectionSettings.forEach((setting) =>
          flowSettings.addRow([
            setting.roadId,
            `路口${setting.directionCode}`,
            setting.name,
            normalizeAngle(setting.angle),
            setting.leftTarget ? `路口${setting.leftTarget}` : "未指定",
            setting.throughTarget ? `路口${setting.throughTarget}` : "未指定",
            setting.rightTarget ? `路口${setting.rightTarget}` : "未指定",
          ]),
        );
        flowSettings.columns = [18, 16, 28, 14, 18, 18, 18].map((width) => ({
          width,
        }));
        header(flowSettings.getRow(1));
      }
      const dc = wb.addWorksheet("平假日比較", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      dc.addRow([
        "調查點編號",
        "調查點名稱",
        `平日實際量（${sheetActualUnit}）`,
        `假日實際量（${sheetActualUnit}）`,
        `平日${pcu24Label}`,
        `假日${pcu24Label}`,
        `平假日差（${sheetActualUnit}）`,
        "假日相較平日（%）",
      ]);
      dayComparisons.forEach((r) =>
        dc.addRow([
          r.roadId,
          r.roadName,
          r.weekdayActual,
          r.holidayActual,
          r.weekdayPcu,
          r.holidayPcu,
          r.holidayActual - r.weekdayActual,
          r.weekdayActual ? r.holidayActual / r.weekdayActual - 1 : 0,
        ]),
      );
      dc.columns = [16, 36, 22, 22, 25, 25, 20, 20].map((width) => ({ width }));
      header(dc.getRow(1));
      dc.getColumn(8).numFmt = "0.0%";
      const tr = wb.addWorksheet("歷季趨勢", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      /* 歷季趨勢工作表的資料是 trendRows（依 trendMode），單位同樣要跟著它。 */
      const trendUnit = trendMetric === "actual" ? trendActualUnit : trendPcuUnit;
      tr.addRow(["季度", `平日（${trendUnit}）`, `假日（${trendUnit}）`]);
      /*
       * 缺值（含被日別篩選掉的那一條）寫成空白格，不是 0——
       * Excel 的折線圖會把 0 畫成一個真實的資料點，看起來像「那一季是 0」。
       */
      trendRows.forEach((r) =>
        tr.addRow([r.quarter, r.weekday ?? null, r.holiday ?? null]),
      );
      tr.columns = [16, 24, 24].map((width) => ({ width }));
      header(tr.getRow(1));
      const currentComp = wb.addWorksheet("目前車種組成", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      currentComp.addRow(["車種", "數量（輛）", "組成比例（%）"]);
      const compositionValues = analysisVehicleCatalog.map(
        (vehicle) => compositionTotals.vehicles[vehicle.key] ?? 0,
      );
      const compositionSourceEnd = compositionExportRows.length + 1;
      const compositionTotalEnd = 1 + analysisVehicleCatalog.length;
      analysisVehicleCatalog.forEach((vehicle, i) => {
        const sourceColumn = colName(11 + i);
        const row = currentComp.addRow([vehicle.label]);
        row.getCell(2).value = {
          formula: `SUMIFS($${sourceColumn}$2:$${sourceColumn}$${compositionSourceEnd},$H$2:$H$${compositionSourceEnd},$F$2,$I$2:$I$${compositionSourceEnd},$F$3,$J$2:$J$${compositionSourceEnd},$F$4)`,
          result: compositionValues[i],
        };
        row.getCell(3).value = {
          formula: `IFERROR(B${i + 2}/SUM($B$2:$B$${compositionTotalEnd}),0)`,
          result: compositionTotals.total
            ? Number(compositionValues[i]) / compositionTotals.total
            : 0,
        };
      });
      currentComp.getCell("E1").value = "篩選條件";
      currentComp.getCell("E2").value = "日別";
      currentComp.getCell("F2").value = compositionMode;
      currentComp.getCell("E3").value = "路段";
      currentComp.getCell("F3").value =
        compositionRoad === "ALL"
          ? "全部路段／路口"
          : roadOptions.find(([id]) => id === compositionRoad)?.[1];
      currentComp.getCell("E4").value = "方向";
      currentComp.getCell("F4").value =
        compositionDirection === "ALL"
          ? "全部方向"
          : (directionOptions.find(
              ([code]) => code === compositionDirection,
            )?.[1] ?? compositionDirection);
      currentComp.getCell("E5").value = "路口流量視角";
      currentComp.getCell("F5").value = intersectionFlowLabel;
      currentComp.getCell("E6").value = "操作說明";
      currentComp.getCell("F6").value =
        `本檔依網站目前的「${intersectionFlowLabel}」視角匯出；請使用F2～F4下拉選單切換日別、路段／路口及車流方向，圓環圖會即時更新。`;
      // 名稱可能含逗號／雙引號，或整串超過 Excel 的 255 字元上限；
      // 無法安全表示時就不要放下拉（欄位仍可手動輸入），也不要寫出壞掉的清單。
      const roadListFormula = excelListFormula([
        "全部路段／路口",
        ...roadOptions.map(([, name]) => name),
      ]);
      const directionListFormula = excelListFormula([
        "全部方向",
        ...directionOptions.map(([, name]) => name),
      ]);
      currentComp.getCell("F2").dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"平日,假日,平日＋假日"'],
      };
      if (roadListFormula)
        currentComp.getCell("F3").dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [roadListFormula],
        };
      if (directionListFormula)
        currentComp.getCell("F4").dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [directionListFormula],
        };
      currentComp.getCell("H1").value = "日別";
      currentComp.getCell("I1").value = "路段／路口";
      currentComp.getCell("J1").value = "方向";
      analysisVehicleCatalog.forEach(
        (vehicle, index) =>
          (currentComp.getCell(1, 11 + index).value = `${vehicle.label}（輛）`),
      );
      compositionExportRows.forEach((r, i) => {
        const row = currentComp.getRow(i + 2);
        row.getCell(8).value = r.dayType;
        row.getCell(9).value = r.roadName;
        row.getCell(10).value = r.directionName;
        analysisVehicleCatalog.forEach((vehicle, index) => {
          row.getCell(11 + index).value = r.vehicles[vehicle.key] ?? 0;
        });
      });
      currentComp.columns = [
        ...[
          { width: 18 },
          { width: 20 },
          { width: 20 },
          { width: 4 },
          { width: 14 },
          { width: 52 },
          { width: 4 },
          { width: 16 },
          { width: 36 },
          { width: 18 },
        ],
        ...analysisVehicleCatalog.map(() => ({ width: 16 })),
      ];
      header(currentComp.getRow(1));
      currentComp.getColumn(2).numFmt = "#,##0";
      currentComp.getColumn(3).numFmt = "0.0%";
      currentComp.getCell("F2").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" },
      };
      currentComp.getCell("F3").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" },
      };
      currentComp.getCell("F4").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFF2CC" },
      };
      currentComp.getCell("F5").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE7F3F3" },
      };
      currentComp.getCell("F2").font = {
        bold: true,
        color: { argb: "FF17324D" },
      };
      currentComp.getCell("F3").font = {
        bold: true,
        color: { argb: "FF17324D" },
      };
      currentComp.getCell("F4").font = {
        bold: true,
        color: { argb: "FF17324D" },
      };
      currentComp.getCell("F5").font = {
        bold: true,
        color: { argb: "FF17324D" },
      };
      currentComp.getCell("F6").alignment = { wrapText: true, vertical: "top" };
      const hd = wb.addWorksheet("歷季全日交通量", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      hd.addRow([
        "季度",
        "日別",
        "調查點編號",
        "調查點名稱",
        `方向A（${sheetActualUnit}・僅路段）`,
        `方向B（${sheetActualUnit}・僅路段）`,
        totalLabel,
        `方向A（${sheetPcuUnit}・僅路段）`,
        `方向B（${sheetPcuUnit}・僅路段）`,
        pcu24Label,
      ]);
      historicalDailyRows.forEach((r) =>
        hd.addRow([
          r.quarter,
          r.dayType,
          r.roadId,
          r.roadName,
          r.isIntersection ? "" : r.a,
          r.isIntersection ? "" : r.b,
          r.total,
          r.isIntersection ? "" : r.aPcu,
          r.isIntersection ? "" : r.bPcu,
          r.pcu24,
        ]),
      );
      hd.columns = [12, 10, 16, 36, 20, 20, 25, 20, 20, 22].map((width) => ({
        width,
      }));
      header(hd.getRow(1));
      [8, 9, 10].forEach((c) => (hd.getColumn(c).numFmt = "#,##0.0"));
      hd.autoFilter = { from: "A1", to: `J${historicalDailyRows.length + 1}` };
      const hc = wb.addWorksheet("歷季車種組成", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      hc.addRow([
        "季度",
        "日別",
        "調查點編號",
        "調查點名稱",
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（${sheetActualUnit}）`),
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（%）`),
      ]);
      historicalCompositionRows.forEach((r, i) => {
        const row = hc.addRow([
          r.quarter,
          r.dayType,
          r.roadId,
          r.roadName,
          ...analysisVehicleCatalog.map(
            (vehicle) => r.vehicles[vehicle.key] ?? 0,
          ),
        ]);
        const excelRow = i + 2,
          countStart = 5,
          countEnd = 4 + analysisVehicleCatalog.length,
          percentStart = countEnd + 1;
        analysisVehicleCatalog.forEach(
          (vehicle, j) =>
            (row.getCell(percentStart + j).value = {
              formula: `IFERROR(${colName(countStart + j)}${excelRow}/SUM($${colName(countStart)}${excelRow}:$${colName(countEnd)}${excelRow}),0)`,
              result: r.vehiclePct[vehicle.key] ?? 0,
            }),
        );
      });
      hc.columns = [
        ...[12, 10, 16, 36],
        ...analysisVehicleCatalog.map(() => 17),
        ...analysisVehicleCatalog.map(() => 14),
      ].map((width) => ({ width }));
      header(hc.getRow(1));
      analysisVehicleCatalog.forEach(
        (_, index) =>
          (hc.getColumn(5 + analysisVehicleCatalog.length + index).numFmt =
            "0.0%"),
      );
      hc.autoFilter = {
        from: "A1",
        to: `${colName(4 + analysisVehicleCatalog.length * 2)}${historicalCompositionRows.length + 1}`,
      };
      const hct = wb.addWorksheet("歷季組成圖表資料", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      hct.addRow([
        "季度",
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（%）`),
      ]);
      compositionTrendRows.forEach((r) =>
        hct.addRow([
          r.quarter,
          ...analysisVehicleCatalog.map(
            (vehicle) => r.vehicles[vehicle.key] ?? 0,
          ),
        ]),
      );
      hct.columns = [16, ...analysisVehicleCatalog.map(() => 16)].map(
        (width) => ({ width }),
      );
      header(hct.getRow(1));
      analysisVehicleCatalog.forEach(
        (_, index) => (hct.getColumn(2 + index).numFmt = "0.0%"),
      );
      const hourlySheet = wb.addWorksheet("每小時趨勢", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      hourlySheet.addRow([
        "時段",
        "實際交通量（輛/小時）",
        "當量交通量（PCU/小時）",
      ]);
      hourlyExportRows.forEach((r) =>
        hourlySheet.addRow([r.hour, r.actual, r.pcu]),
      );
      hourlySheet.columns = [{ width: 20 }, { width: 26 }, { width: 28 }];
      header(hourlySheet.getRow(1));
      hourlySheet.getColumn(3).numFmt = "#,##0.0";
      const projectSheet = wb.addWorksheet("跨計畫比較", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      projectSheet.addRow([
        "計畫名稱",
        "日別",
        "實際交通量（輛/調查日）",
        pcu24Label,
      ]);
      projectComparisons.forEach((r) =>
        projectSheet.addRow([r.name, dayType, r.actual, r.pcu]),
      );
      projectSheet.columns = [
        { width: 38 },
        { width: 16 },
        { width: 28 },
        { width: 25 },
      ];
      header(projectSheet.getRow(1));
      projectSheet.getColumn(4).numFmt = "#,##0.0";
      const factors = wb.addWorksheet("PCU係數");
      factors.addRow(["原始車種", "分析歸類", "目前套用一般PCU係數", "說明"]);
      CORE_VEHICLE_KEYS.forEach((key) =>
        factors.addRow([
          coreVehicleLabels[key],
          coreVehicleLabels[key],
          pcuFactors[key],
          "原四大類",
        ]),
      );
      vehicleClassSettings
        .filter(
          (setting) =>
            setting.projectId === activeProject &&
            !CORE_VEHICLE_KEYS.includes(setting.sourceKey as CoreVehicleKey),
        )
        .forEach((setting) =>
          factors.addRow([
            setting.sourceLabel,
            setting.targetLabel,
            setting.targetKey === setting.sourceKey
              ? setting.roadPcu
              : pcuFactors[setting.targetKey as CoreVehicleKey],
            setting.targetKey === setting.sourceKey
              ? "獨立分析"
              : `合併至${setting.targetLabel}`,
          ]),
        );
      factors.addRows([
        [
          "計算說明",
          "",
          "",
          `${pcu24Label.replace(/（.*/, "")}＝各車種該時段數量×PCU係數後加總；尖峰PCU單位為PCU/小時。`,
        ],
        [
          "相容性提示",
          "",
          "",
          ".xls 為舊版Excel數值相容檔；如需可編輯原生數據圖，請使用Excel 2007以上版本開啟本.xlsx檔。",
        ],
      ]);
      factors.columns = [
        { width: 18 },
        { width: 20 },
        { width: 24 },
        { width: 78 },
      ];
      header(factors.getRow(1));
      const charts = wb.addWorksheet("可編輯圖表");
      charts.getCell("A1").value =
        `${selectedProject.name}｜歷季與車種組成分析圖表`;
      charts.getCell("A1").font = {
        bold: true,
        size: 18,
        color: { argb: "FF17324D" },
      };
      charts.getCell("A2").value =
        "以下皆為 Excel 原生圖表。修改來源工作表的儲存格數值後，圖表會同步更新。";
      charts.getCell("A2").font = { color: { argb: "FF5F7080" }, size: 11 };
      charts.getCell("A3").value =
        "相容性提示：若舊版 Excel 無法顯示圖表，請改用 Excel 2007 以上版本開啟；.xls 僅提供數值相容表。";
      charts.getCell("A3").font = {
        color: { argb: "FFE58A2B" },
        bold: true,
        size: 10,
      };
      charts.columns = Array.from({ length: 12 }, () => ({ width: 13 }));
      charts.getColumn(26).width = 3;
      charts.getColumn(27).width = 18;
      charts.getColumn(28).width = 38;
      charts.getColumn(29).width = 14;
      charts.getCell("AA89").value = "車種組成互動篩選";
      charts.getCell("AA89").font = {
        bold: true,
        size: 13,
        color: { argb: "FF17324D" },
      };
      charts.getCell("AA90").value = "日別";
      charts.getCell("AB90").value = compositionMode;
      charts.getCell("AA91").value = "路段";
      charts.getCell("AB91").value =
        compositionRoad === "ALL"
          ? "全部路段／路口"
          : roadOptions.find(([id]) => id === compositionRoad)?.[1];
      charts.getCell("AA92").value = "方向";
      charts.getCell("AB92").value =
        compositionDirection === "ALL"
          ? "全部方向"
          : (directionOptions.find(
              ([code]) => code === compositionDirection,
            )?.[1] ?? compositionDirection);
      charts.getCell("AB90").dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"平日,假日,平日＋假日"'],
      };
      if (roadListFormula)
        charts.getCell("AB91").dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [roadListFormula],
        };
      if (directionListFormula)
        charts.getCell("AB92").dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: [directionListFormula],
        };
      ["AB90", "AB91", "AB92"].forEach((address) => {
        const cell = charts.getCell(address);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF2CC" },
        };
        cell.font = { bold: true, color: { argb: "FF17324D" } };
      });
      charts.getCell("AA93").value = "車種";
      charts.getCell("AB93").value = "數量（輛）";
      charts.getCell("AC93").value = "比例";
      ["AA93", "AB93", "AC93"].forEach((address) => {
        const cell = charts.getCell(address);
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF148C8C" },
        };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      });
      const compositionColors = [
        "FF148C8C",
        "FFE58A2B",
        "FF5B8DB8",
        "FFD8E7F1",
        "FF7E6BC4",
        "FFD65F75",
        "FF6FA45D",
        "FF9B6A43",
        "FF4CA6C9",
        "FFA0A0A0",
      ];
      const chartCompositionStart = 94,
        chartCompositionEnd =
          chartCompositionStart + analysisVehicleCatalog.length - 1;
      analysisVehicleCatalog.forEach((vehicle, i) => {
        const row = chartCompositionStart + i,
          sourceColumn = colName(11 + i);
        charts.getCell(`Z${row}`).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: compositionColors[i % compositionColors.length] },
        };
        charts.getCell(`AA${row}`).value = vehicle.label;
        // 只有在「目前車種組成」那張表會一起匯出時才用 SUMIFS 連動；
        // 否則寫成靜態數值——否則公式會變成 #REF!，Excel 開檔就會跳修復提示。
        charts.getCell(`AB${row}`).value = exportSections.composition
          ? {
              formula: `SUMIFS('目前車種組成'!$${sourceColumn}$2:$${sourceColumn}$${compositionSourceEnd},'目前車種組成'!$H$2:$H$${compositionSourceEnd},$AB$90,'目前車種組成'!$I$2:$I$${compositionSourceEnd},$AB$91,'目前車種組成'!$J$2:$J$${compositionSourceEnd},$AB$92)`,
              result: compositionValues[i],
            }
          : Number(compositionValues[i]) || 0;
        charts.getCell(`AB${row}`).numFmt = "#,##0";
        charts.getCell(`AC${row}`).value = {
          formula: `IFERROR(AB${row}/SUM($AB$${chartCompositionStart}:$AB$${chartCompositionEnd}),0)`,
          result: compositionTotals.total
            ? Number(compositionValues[i]) / compositionTotals.total
            : 0,
        };
        charts.getCell(`AC${row}`).numFmt = "0.0%";
      });
      const chartCompositionTotalRow = chartCompositionEnd + 2;
      charts.getCell(`AA${chartCompositionTotalRow}`).value = "合計";
      charts.getCell(`AB${chartCompositionTotalRow}`).value = {
        formula: `SUM($AB$${chartCompositionStart}:$AB$${chartCompositionEnd})`,
        result: compositionTotals.total,
      };
      charts.getCell(`AB${chartCompositionTotalRow}`).numFmt = "#,##0";
      charts.getCell(`AC${chartCompositionTotalRow}`).value = {
        formula: `SUM($AC$${chartCompositionStart}:$AC$${chartCompositionEnd})`,
        result: compositionTotals.total ? 1 : 0,
      };
      charts.getCell(`AC${chartCompositionTotalRow}`).numFmt = "0.0%";
      [
        `AA${chartCompositionTotalRow}`,
        `AB${chartCompositionTotalRow}`,
        `AC${chartCompositionTotalRow}`,
      ].forEach((address) => {
        const cell = charts.getCell(address);
        cell.font = { bold: true, color: { argb: "FF17324D" } };
        cell.border = { top: { style: "thin", color: { argb: "FFB9CBD8" } } };
      });
      const chartCompositionHelpRow = chartCompositionTotalRow + 2;
      charts.getCell(`AA${chartCompositionHelpRow}`).value =
        "操作：切換黃色儲存格的日別、路段／路口與方向，左側圓環圖及右側數量、比例會即時更新。";
      charts.getCell(`AA${chartCompositionHelpRow}`).font = {
        italic: true,
        color: { argb: "FF5F7080" },
        size: 10,
      };
      charts.mergeCells(
        `AA${chartCompositionHelpRow}:AC${chartCompositionHelpRow + 1}`,
      );
      charts.getCell(`AA${chartCompositionHelpRow}`).alignment = {
        wrapText: true,
        vertical: "top",
      };
      const traceSheet = wb.addWorksheet("原始來源追溯", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      traceSheet.addRow([
        "季度",
        "日別",
        "調查點編號",
        "調查點名稱",
        "方向／支線",
        "時段",
        "來源檔案",
        "工作表",
        "來源列",
        "來源範圍",
        "原始車種與數量",
        "PCU計算結果",
      ]);
      activeRecords.forEach((record) =>
        traceSheet.addRow([
          record.quarter,
          record.dayType,
          record.roadId,
          record.roadName,
          record.directionName,
          record.hour,
          record.sourceFileName || "舊資料未記錄",
          record.sourceSheetName || "—",
          record.sourceRow || "—",
          record.sourceRange || "—",
          Object.entries(rawVehicleCounts(record))
            .map(
              ([key, value]) =>
                `${rawVehicleLabels(record)[key] ?? key}=${value}`,
            )
            .join("；"),
          sumPcu(record, pcuFactors, turnPcuFactors, vehicleClassSettings),
        ]),
      );
      traceSheet.columns = [12, 10, 18, 34, 22, 18, 42, 18, 10, 20, 60, 18].map(
        (width) => ({ width }),
      );
      header(traceSheet.getRow(1));
      traceSheet.getColumn(12).numFmt = "#,##0.0";
      const historySheet = wb.addWorksheet("匯入與版本紀錄", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      historySheet.addRow([
        "匯入時間",
        "操作人員",
        "裝置",
        "季度",
        "來源檔案",
        "匯入筆數",
        "新增筆數",
        "覆蓋筆數",
        "調查點",
        "車種",
      ]);
      workflow.history.forEach((entry) =>
        historySheet.addRow([
          new Date(entry.importedAt).toLocaleString("zh-TW"),
          entry.operator,
          entry.device,
          entry.quarter,
          entry.files.join("、"),
          entry.rowCount,
          entry.addedRows,
          entry.replacedRows,
          entry.roads.join("、"),
          entry.vehicles.join("、"),
        ]),
      );
      historySheet.columns = [22, 18, 34, 14, 48, 14, 14, 14, 52, 36].map(
        (width) => ({ width }),
      );
      header(historySheet.getRow(1));
      const qualitySheet = wb.addWorksheet("品質檢核");
      qualitySheet.addRows([
        ["項目", "結果"],
        ["季度狀態", currentStatus],
        ["調查點數", qualitySummary.roads],
        ["平日調查點", qualitySummary.weekdayRoads],
        ["假日調查點", qualitySummary.holidayRoads],
        ["24小時完整組數", qualitySummary.completeGroups],
        ["24小時不完整組數", qualitySummary.incompleteGroups],
        ["偵測車種數", qualitySummary.vehicleTypes],
        ["車種設定完整", qualitySummary.vehiclesConfigured ? "是" : "否"],
        ["路口幾何完整", qualitySummary.geometryComplete ? "是" : "否"],
        ["未指定駛入量（輛）", qualitySummary.unmapped],
        ["人工檢核", qualitySummary.checked ? "已完成" : "待確認"],
        // 匯出一律輸出「全部」提醒，不受畫面上的篩選影響——
        // 篩選是給人看的工具，交付檔案不該因為畫面上剛好篩了什麼而少東西。
        ["異常提醒", anomalyAlerts.map((item) => item.text).join("\n") || "無"],
      ]);
      qualitySheet.columns = [{ width: 28 }, { width: 90 }];
      qualitySheet.getColumn(2).alignment = { wrapText: true, vertical: "top" };
      header(qualitySheet.getRow(1));
      // 時段車種分析：依使用者在匯出中心勾選的「時段×方向×指標」動態產生工作表。
      // 勾了幾個時段就出幾張表（或合併成一張），沒勾的完全不會出現。
      if (periodExport.enabled) {
        const periodSheets = buildPeriodExportSheets(
          periodExportRows,
          analysisVehicleCatalog,
          periodExport,
          {
          flowLabel: periodExportFlowLabel,
          separateDays: dayType === "平日＋假日",
          partial: surveyScope.partial,
        },
        );
        for (const sheet of periodSheets) {
          const ws = wb.addWorksheet(sheet.name.slice(0, 31));
          ws.addRow(sheet.headers);
          sheet.rows.forEach((row) => ws.addRow(row));
          ws.columns = sheet.headers.map((title, index) => ({
            width: index < 4 ? 20 : Math.max(12, String(title).length + 4),
          }));
          ws.views = [{ state: "frozen", ySplit: 1 }];
          ws.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: sheet.rows.length + 1, column: sheet.headers.length },
          };
          header(ws.getRow(1));
        }
      }
      // 使用者在匯出中心取消勾選的區塊一律移除。
      // 舊版把這段整個包在 if (!exportSections.charts) 裡面，只要「原生圖表」是勾的
      // （而它預設就是勾的），其他七個勾選就完全不會生效，等於每次都輸出全部工作表。
      // 現在改成永遠依勾選裁切，再把引用到已移除工作表的圖表一併略過，
      // 這樣「只匯出上午尖峰車輛數」這種需求才真的做得到。
      const removedSheets = new Set<string>();
      {
        const groups: Record<keyof typeof exportSections, string[]> = {
          current: [
            "本季交通量及PCU",
            `路口${intersectionFlowLabel}交通量`,
            "平假日比較",
          ],
          history: ["歷季趨勢", "歷季全日交通量"],
          composition: ["目前車種組成", "歷季車種組成", "歷季組成圖表資料"],
          hourly: ["每小時趨勢"],
          projects: ["跨計畫比較"],
          settings: ["路口轉向PCU係數", "路口駛出對應", "PCU係數"],
          trace: ["原始來源追溯", "匯入與版本紀錄", "品質檢核"],
          charts: ["可編輯圖表"],
        };
        (Object.keys(groups) as (keyof typeof exportSections)[]).forEach(
          (group) => {
            if (!exportSections[group])
              groups[group].forEach((name) => {
                const sheet = wb.getWorksheet(name);
                if (sheet) wb.removeWorksheet(sheet.id);
                removedSheets.add(name);
              });
          },
        );
      }
      // 註：取消勾選「車種組成」時不再連坐刪掉「可編輯圖表」。
      // 那張表裡的車種組成格已改為靜態數值（見上方 exportSections.composition
      // 判斷），不會產生 #REF!，9 張圖表因此都能保留。
      if (!wb.worksheets.length)
        throw new Error("勾選的匯出項目在目前條件下沒有任何資料，請至少保留一項");
      const raw = await wb.xlsx.writeBuffer();
      const n = Math.max(2, roadOnlyRows.length + 1),
        nd = dayComparisons.length + 1,
        nt = trendRows.length + 1,
        nct = compositionTrendRows.length + 1,
        nh = hourlyExportRows.length + 1,
        np = projectComparisons.length + 1;
      const compValues = analysisVehicleCatalog.map(
        (vehicle) => compositionTotals.vehicles[vehicle.key] ?? 0,
      );
      const trendVehicleSeries = analysisVehicleCatalog.map(
        (vehicle, index) => ({
          name: vehicle.label,
          formula: `'歷季組成圖表資料'!$${colName(2 + index)}$2:$${colName(2 + index)}$${nct}`,
          color: compositionColors[index % compositionColors.length].replace(
            /^FF/,
            "",
          ),
          cache: compositionTrendRows.map((r) => r.vehicles[vehicle.key] ?? 0),
        }),
      );
      /*
       * 前兩張圖原本固定畫「本季交通量及PCU」工作表的路段資料。
       * 若這一季全部都是路口格式（例如只調查了幾個路口），那張表只有一列
       * 「本季無路段格式資料」的提示，圖就會是空的——有座標軸、有標題、
       * 卻一根柱子都沒有。此時改畫「路口X交通量」工作表的各支線，
       * 圖才會有內容；兩種都有資料時仍以路段為準（維持原本行為）。
       */
      const intersectionChartRows = intersectionOnlyRows.flatMap((row) =>
        row.directions.map((direction) => ({
          name: direction.name,
          actual: direction.actual,
          pcu: direction.pcu,
        })),
      );
      const volumeFromIntersection =
        !roadOnlyRows.length && intersectionChartRows.length > 0;
      const volumeSheet = volumeFromIntersection
        ? `路口${intersectionFlowLabel}交通量`
        : "本季交通量及PCU";
      const volumeRowCount = volumeFromIntersection
        ? intersectionChartRows.length + 1
        : n;
      // 路口表：F＝支線、G＝交通量(輛/日)、H＝交通量(PCU/日)
      // 路段表：D＝路段名稱、I＝實際交通量、J＝24小時PCU
      const volumeCategoryColumn = volumeFromIntersection ? "F" : "D";
      const volumeActualColumn = volumeFromIntersection ? "G" : "I";
      const volumePcuColumn = volumeFromIntersection ? "H" : "J";
      const volumeUnitLabel = volumeFromIntersection ? "支線" : "路段";
      const chartSpecs: Parameters<typeof addNativeCharts>[2] = [
            {
              title: `${dayType}各${volumeUnitLabel}全日實際交通量（${dailyActualUnit}）`,
              categories: `'${volumeSheet}'!$${volumeCategoryColumn}$2:$${volumeCategoryColumn}$${volumeRowCount}`,
              series: [
                {
                  name: `實際交通量（${sheetActualUnit}）`,
                  formula: `'${volumeSheet}'!$${volumeActualColumn}$2:$${volumeActualColumn}$${volumeRowCount}`,
                  color: "148C8C",
                  cache: volumeFromIntersection
                    ? intersectionChartRows.map((r) => r.actual)
                    : roadOnlyRows.map((r) => r.total),
                },
              ],
            },
            {
              title: `${dayType}各${volumeUnitLabel}${pcu24Label}`,
              categories: `'${volumeSheet}'!$${volumeCategoryColumn}$2:$${volumeCategoryColumn}$${volumeRowCount}`,
              series: [
                {
                  name: pcu24Label,
                  formula: `'${volumeSheet}'!$${volumePcuColumn}$2:$${volumePcuColumn}$${volumeRowCount}`,
                  color: "E58A2B",
                  cache: volumeFromIntersection
                    ? intersectionChartRows.map((r) => r.pcu)
                    : roadOnlyRows.map((r) => r.pcu24),
                },
              ],
            },
            {
              title: `${quarter}平日與假日全日交通量比較（${dailyActualUnit}）`,
              categories: `'平假日比較'!$B$2:$B$${nd}`,
              series: [
                {
                  name: "平日",
                  formula: `'平假日比較'!$C$2:$C$${nd}`,
                  color: "148C8C",
                  cache: dayComparisons.map((r) => r.weekdayActual),
                },
                {
                  name: "假日",
                  formula: `'平假日比較'!$D$2:$D$${nd}`,
                  color: "E58A2B",
                  cache: dayComparisons.map((r) => r.holidayActual),
                },
              ],
            },
            {
              title: `歷季全日交通量趨勢（${trendUnit}）`,
              categories: `'歷季趨勢'!$A$2:$A$${nt}`,
              type: "line",
              series: [
                {
                  name: "平日",
                  formula: `'歷季趨勢'!$B$2:$B$${nt}`,
                  color: "148C8C",
                  cache: trendRows.map((r) => r.weekday),
                },
                {
                  name: "假日",
                  formula: `'歷季趨勢'!$C$2:$C$${nt}`,
                  color: "E58A2B",
                  cache: trendRows.map((r) => r.holiday),
                },
              ],
            },
            {
              title: "車種組成（使用右側選單切換）",
              categories: `'可編輯圖表'!$AA$${chartCompositionStart}:$AA$${chartCompositionEnd}`,
              type: "doughnut",
              series: [
                {
                  name: "車種組成（輛）",
                  formula: `'可編輯圖表'!$AB$${chartCompositionStart}:$AB$${chartCompositionEnd}`,
                  color: "148C8C",
                  cache: compValues,
                },
              ],
            },
            {
              title: "歷季各車種組成比例趨勢（%）",
              categories: `'歷季組成圖表資料'!$A$2:$A$${nct}`,
              type: "line",
              series: trendVehicleSeries,
            },
            {
              title: `每小時實際交通量與PCU（${dayType}）`,
              categories: `'每小時趨勢'!$A$2:$A$${nh}`,
              type: "line",
              series: [
                {
                  name: "實際交通量（輛/小時）",
                  formula: `'每小時趨勢'!$B$2:$B$${nh}`,
                  color: "148C8C",
                  cache: hourlyExportRows.map((r) => r.actual),
                },
                {
                  name: "當量交通量（PCU/小時）",
                  formula: `'每小時趨勢'!$C$2:$C$${nh}`,
                  color: "E58A2B",
                  cache: hourlyExportRows.map((r) => r.pcu),
                },
              ],
            },
            {
              title: `跨計畫實際交通量比較（${dayType}）`,
              categories: `'跨計畫比較'!$A$2:$A$${np}`,
              series: [
                {
                  name: "實際交通量（輛/調查日）",
                  formula: `'跨計畫比較'!$C$2:$C$${np}`,
                  color: "148C8C",
                  cache: projectComparisons.map((r) => r.actual),
                },
              ],
            },
            {
              title: `跨計畫${surveyScope.partial ? "調查時段PCU" : "24小時PCU"}比較（${dayType}）`,
              categories: `'跨計畫比較'!$A$2:$A$${np}`,
              series: [
                {
                  name: pcu24Label,
                  formula: `'跨計畫比較'!$D$2:$D$${np}`,
                  color: "E58A2B",
                  cache: projectComparisons.map((r) => r.pcu),
                },
              ],
            },
      ];
      // 圖表的公式指向工作表名稱，被裁掉的工作表對應的圖表要一起拿掉，
      // 否則 Excel 開啟時會出現「無法讀取內容」的修復提示。
      const usableCharts = chartSpecs.filter((spec) => {
        const references = [
          spec.categories,
          ...spec.series.map((item) => item.formula),
        ];
        return !references.some((reference) =>
          [...removedSheets].some((name) => reference.includes(`'${name}'!`)),
        );
      });
      const chartHostId = wb.getWorksheet("可編輯圖表")?.id;
      const finalBuffer =
        exportSections.charts && usableCharts.length && chartHostId
          ? await addNativeCharts(raw as ArrayBuffer, chartHostId, usableCharts)
          : raw;
      const blob = new Blob([finalBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(
        projects.find((p) => p.id === activeProject)?.name ?? "",
        quarter,
        "xlsx",
      );
      a.click();
      URL.revokeObjectURL(url);
      setToast(
        `已匯出 ${wb.worksheets.length} 張工作表` +
          (exportSections.charts && usableCharts.length && chartHostId
            ? `、${usableCharts.length} 張可編輯原生圖表`
            : ""),
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">TRAFFIC DATA INTELLIGENCE</span>
          <h1>全日交通量及車種組成</h1>
          <p>
            路段與路口全日實際交通量・24小時PCU・尖峰小時PCU・方向及車種組成
          </p>
          <span
            className="version-badge"
            title={`最後更新：${SYSTEM_UPDATED_AT}`}
          >
            系統版本 {SYSTEM_VERSION}｜更新日期 {SYSTEM_UPDATED_AT}
          </span>
        </div>
        <div className="user-chip">
          <span className="avatar">
            {(user?.displayName ?? "本").slice(0, 1)}
          </span>
          <div>
            <strong>{user?.displayName ?? "本機使用者"}</strong>
            <small>{user?.email ?? "免登入使用・資料自動保存在本機"}</small>
          </div>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <span>我的計畫</span>
              <strong>
                {projects.filter((p) => p.role === "owner").length}
              </strong>
            </div>
            <button
              className="icon-button"
              onClick={() => setShowProjectForm(true)}
              aria-label="建立新計畫"
            >
              ＋
            </button>
          </div>
          <div className="project-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className={`project-card ${p.id === activeProject ? "active" : ""}`}
                onClick={() => setActiveProject(p.id)}
              >
                <span className="project-mark">{p.name.slice(0, 1)}</span>
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.role === "owner"
                      ? "我擁有的計畫"
                      : `同事分享・${p.role === "editor" ? "可編輯" : "僅檢視"}`}
                  </small>
                </span>
              </button>
            ))}
            {!projects.length && (
              <p className="empty-project-list">尚無計畫，請按＋建立。</p>
            )}
          </div>
          <div className="side-section">
            <span className="side-label">跨計畫比較（最多20個）</span>
            {projects.map((p) => (
              <label className="check-row" key={p.id}>
                <input
                  type="checkbox"
                  checked={compareIds.includes(p.id)}
                  onChange={(e) =>
                    setCompareIds((ids) =>
                      e.target.checked
                        ? [...ids, p.id]
                        : ids.filter((id) => id !== p.id),
                    )
                  }
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
          <div className="side-note">
            <strong>分開控管、需要時合併比較</strong>
            <p>
              {/* 分享功能目前沒有任何入口（setShowShare(true) 不存在於程式裡），
                  所以不能寫「獲分享的計畫」，那會讓使用者去找一個找不到的按鈕。 */}
              每個計畫的資料各自獨立；勾選後可做整體比較，不會改動原始資料。
            </p>
          </div>
        </aside>
        <section className="content">
          <div className="toolbar">
            <div className="project-title">
              <span className={`status-dot status-${currentStatus}`} />
              <div>
                <small>
                  目前計畫・{quarter || "尚無季度"}・{currentStatus}
                </small>
                <h2>{selectedProject.name}</h2>
              </div>
            </div>
            <div className="actions">
              <div className="manual-menu" aria-label="新手使用說明手冊下載">
                <a
                  className="button secondary manual-download"
                  href="./manuals/Traffic_Analysis_Beginner_Guide_v20.32.pdf"
                  download
                >
                  新手使用手冊 PDF
                </a>
                <a
                  className="button secondary manual-download compact"
                  href="./manuals/Traffic_Analysis_Beginner_Guide_v20.32.docx"
                  download
                  title="可編輯的 Word 版本"
                >
                  Word
                </a>
              </div>
              <button
                className="button secondary"
                disabled={!activeProject || selectedProject.role !== "owner"}
                onClick={openProjectManager}
              >
                管理計畫
              </button>
              <button
                className="button secondary"
                disabled={!activeProject || !quarter}
                onClick={() => setShowQualityCenter(true)}
              >
                品質與定稿
              </button>
              <button
                className="button secondary"
                disabled={!activeProject}
                onClick={() => setShowHistoryCenter(true)}
              >
                追溯與版本
              </button>
              <button
                className="button secondary"
                disabled={!activeProject}
                onClick={() => setShowTemplateCenter(true)}
              >
                設定範本
              </button>
              <button
                className="button secondary"
                disabled={
                  !activeProject ||
                  !quarter ||
                  selectedProject.role === "viewer"
                }
                onClick={() => {
                  setQuarterDraft(quarter);
                  setShowQuarterManager(true);
                }}
              >
                管理季度
              </button>
              <button
                className="button secondary"
                disabled={!activeProject}
                onClick={exportBackup}
              >
                匯出備份
              </button>
              <button
                className="button secondary"
                /*
                 * 一個計畫都還沒有時，這顆按鈕也要能按。
                 *
                 * 「還原完整備份」就在這個視窗裡，而換一台電腦的時候畫面上
                 * 本來就一個計畫都沒有——舊版把按鈕停用，等於把還原備份的
                 * 唯一入口鎖在「必須先手動建一個計畫」後面，使用者在乾淨的
                 * B 電腦上完全找不到地方匯入 A 電腦的成果。
                 * 視窗裡的 Excel 匯入區塊仍然需要選定計畫（見該區說明）。
                 */
                disabled={
                  projects.length > 0 &&
                  (!activeProject || selectedProject.role === "viewer")
                }
                onClick={() => setShowImport(true)}
              >
                匯入資料
              </button>
              <div className="export-menu">
                <button
                  className="button primary"
                  onClick={() => setShowExportCenter(true)}
                  disabled={busy || !activeProject || !quarter}
                >
                  報表批次輸出中心
                </button>
                <button
                  className="button split"
                  disabled={busy || !activeProject || !quarter}
                  onClick={async () => {
                    // 舊版格式轉檔失敗時要有明確提示，不能整個畫面靜默無反應。
                    setBusy(true);
                    try {
                      await exportLegacy();
                    } catch (error) {
                      setToast(
                        `舊版 .xls 匯出失敗：${error instanceof Error ? error.message : "未知錯誤"}`,
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                  title="Excel 97–2003 數值相容格式"
                >
                  .xls
                </button>
              </div>
            </div>
          </div>
          {!activeProject && (
            <section className="empty-state">
              <strong>建立第一個交通調查計畫</strong>
              <p>
                按左側「＋」輸入計畫名稱，再匯入各季度
                Excel。每個計畫會獨立保存；需要比較時，在左側勾選多個計畫即可。
              </p>
              <button
                className="button primary"
                onClick={() => setShowProjectForm(true)}
              >
                ＋ 建立計畫
              </button>
            </section>
          )}
          {offline && (
            <p className="offline-note">
              <strong>免登入本機模式：</strong>
              資料會保存在目前瀏覽器，關閉或重新整理不會消失；換電腦請使用匯出／匯入備份。
            </p>
          )}
          <div className="manager-launch-grid">
            <div className="road-manager-launch">
              <div>
                <strong>路段／路口主檔管理</strong>
                <small>
                  路段才設定方向 A／B；路口只管理調查點名稱、別名與重複資料
                </small>
              </div>
              <button
                className="button secondary"
                disabled={
                  !activeProject ||
                  selectedProject.role === "viewer" ||
                  !roadManagerRows.length
                }
                onClick={openRoadManager}
              >
                管理名稱
              </button>
            </div>
            <div className="road-manager-launch intersection-launch">
              <div>
                <strong>道路與流向管理</strong>
                <small>
                  輸入 3～7 支線名稱與角度，自動繪圖及判定左轉、直行、右轉
                </small>
              </div>
              <button
                className="button secondary"
                disabled={
                  !activeProject ||
                  selectedProject.role === "viewer" ||
                  !intersectionManagerRows.length
                }
                onClick={openIntersectionManager}
              >
                管理路口幾何
              </button>
            </div>
            <div className="road-manager-launch vehicle-launch">
              <div>
                <strong>車種分類與當量管理</strong>
                <small>
                  保留原始車種獨立分析，或歸類至機車、小型車、大型車、特種車
                </small>
              </div>
              <button
                className="button secondary"
                disabled={
                  !activeProject ||
                  selectedProject.role === "viewer" ||
                  !activeVehicleSourceCatalog.length
                }
                onClick={openVehicleClassManager}
              >
                管理車種
              </button>
            </div>
          </div>
          {!!activeProject && !!quarter && (
            <section className="quality-strip">
              <div>
                <span>資料完整度</span>
                <strong>
                  {qualitySummary.roads} 個調查點・24小時完整{" "}
                  {qualitySummary.completeGroups} 組／不完整{" "}
                  {qualitySummary.incompleteGroups} 組
                </strong>
              </div>
              <div>
                <span>平日／假日</span>
                <strong>
                  {qualitySummary.weekdayRoads}／{qualitySummary.holidayRoads}{" "}
                  個調查點
                </strong>
              </div>
              <div>
                <span>檢核狀態</span>
                <strong>
                  {qualitySummary.checked ? "已人工確認" : "待人工確認"}・
                  {currentStatus}
                </strong>
              </div>
              <div>
                <span>異常提醒</span>
                <strong>
                  {anomalyAlerts.length} 項
                  {qualitySummary.unmapped
                    ? `・未指定駛入 ${formatter.format(qualitySummary.unmapped)} 輛`
                    : ""}
                </strong>
              </div>
              <button
                className="button secondary"
                onClick={() => setShowQualityCenter(true)}
              >
                開啟儀表板
              </button>
            </section>
          )}
          <div className="filters">
            <label>
              季度
              <select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
              >
                {quarters.map((q) => (
                  <option key={q}>{q}</option>
                ))}
              </select>
            </label>
            <label>
              日別
              <select
                value={dayType}
                onChange={(e) => setDayType(e.target.value as DayMode)}
              >
                <option>平日</option>
                <option>假日</option>
                <option>平日＋假日</option>
              </select>
            </label>
            <label>
              路段／路口
              <select
                id="roadFilterSelect"
                value={roadFilter}
                onChange={(e) => setRoadFilter(e.target.value)}
              >
                <option value="ALL">全部調查點</option>
                {roadOptions.map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {hasIntersectionRecords && (
              <label>
                路口流量視角
                <select
                  value={intersectionFlowMode}
                  onChange={(e) => {
                    setIntersectionFlowMode(
                      e.target.value as IntersectionFlowMode,
                    );
                    setDirection("ALL");
                    setCompositionDirection("ALL");
                  }}
                >
                  <option value="origin">駛出路口（以該支線為起點）</option>
                  <option value="destination">駛入路口（以該支線為終點）</option>
                </select>
                <small className="flow-mode-hint">
                  {intersectionFlowMode === "destination"
                    ? "駛入路口A＝車輛穿過路口後「開進」支線A的量（依終點統計）"
                    : "駛出路口A＝車輛「從」支線A開進路口的量（依起點統計）"}
                  ，兩種視角的總計相同、各支線分佈不同。
                </small>
              </label>
            )}
            <label>
              車流方向
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as Direction)}
              >
                <option value="ALL">全部方向</option>
                {directionOptions.map(([code, name]) => (
                  <option value={code} key={code}>
                    {name}（{code}）
                  </option>
                ))}
              </select>
            </label>
            <label className="search">
              搜尋調查點
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="道路、路口名稱或編號"
              />
            </label>
            <div className="compare-count">
              已選 {compareIds.length} 個計畫比較
            </div>
          </div>
          {!!outboundUnmappedTotal && (
            <div className="mapping-warning">
              <div>
                <strong>
                  有 {formatter.format(outboundUnmappedTotal)}{" "}
                  輛尚未指定駛入路口
                </strong>
                <span>
                  請到「管理路口幾何」確認各來源支線的左轉、直行、右轉目的支線；未指定量仍會保留在總量中。
                </span>
              </div>
              <button
                className="button secondary"
                onClick={openIntersectionManager}
              >
                立即設定
              </button>
            </div>
          )}
          {!!missingFactors.length && (
            <div className="mapping-warning factor-warning">
              <div>
                <strong>
                  有 {missingFactors.length} 個新車種尚未完成PCU係數設定
                </strong>
                <span>
                  {missingFactors.map((item) => item.label).join("、")}
                  ；實際車輛數仍完整保留，但PCU在設定前不會自行推估。
                </span>
              </div>
              <button
                className="button secondary"
                onClick={openVehicleClassManager}
              >
                設定車種
              </button>
            </div>
          )}
          <section className="pcu-settings">
            <div>
              <span>
                PCU 當量係數
                {selectedProject?.name ? `・計畫：${selectedProject.name}` : ""}
              </span>
              <strong>
                這一組係數只屬於本計畫，不會影響其他計畫
                {projectHasOwnFactors ? "" : "（本計畫尚未自行設定，目前使用系統預設值）"}
              </strong>
            </div>
            <div className="factor-grid">
              {(
                [
                  ["motorcycle", "機車"],
                  ["small", "小型車"],
                  ["large", "大型車"],
                  ["special", "特種車"],
                ] as [keyof PcuFactors, string][]
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    step="any"
                    value={pcuDraft[key]}
                    onChange={(e) =>
                      setPcuDraft({
                        ...pcuDraft,
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="factor-actions">
              <button
                className="button secondary"
                onClick={openVehicleClassManager}
              >
                車種分類與新增當量
              </button>
              <button
                className="button secondary"
                onClick={() => setShowTurnFactors(true)}
              >
                路口轉向係數
              </button>
              <button className="button primary" onClick={applyPcuFactors}>
                套用係數
              </button>
              <button className="button secondary" onClick={resetPcuFactors}>
                恢復預設
              </button>
            </div>
          </section>
          <p className="excel-compat-note">
            Excel 相容性：舊版 Excel 請下載 .xls
            數值表；若需可編輯原生數據圖，請下載 .xlsx 並使用 Excel 2007
            以上版本開啟。
          </p>
          <div className="kpi-grid">
            <article className="kpi">
              <span>全日實際交通量</span>
              <strong>{formatter.format(totals.total)}</strong>
              <small>
                {dailyActualUnit}・{dayType}・
                {direction === "ALL"
                  ? "全部方向"
                  : (directionOptions.find(
                      ([code]) => code === direction,
                    )?.[1] ?? direction)}
              </small>
            </article>
            <article className="kpi pcu">
              <span>{surveyScope.partial ? "調查時段PCU" : "24小時PCU"}</span>
              <strong>{decimalFormatter.format(totals.pcu24)}</strong>
              <small>{dailyPcuUnit}・依目前PCU係數</small>
            </article>
            <article className="kpi pcu peak-kpi">
              <span>尖峰小時當量交通量</span>
              <strong>
                {decimalFormatter.format(directionPeaks.combined[1])}
              </strong>
              <small>
                {cellUnitFor("pcu", "am", directionPeaks.combined[0]).replace(
                  "PCU/hr",
                  "PCU／小時",
                )}
                ・全部方向同一時段 {directionPeaks.combined[0]}
              </small>
              <div className="peak-directions">
                {directionPeaks.items.map((item) => (
                  <span key={item.code}>
                    <b>{item.name}</b>
                    {decimalFormatter.format(item.peak[1])} PCU／小時
                    <em>
                      {item.peak[0]}
                      {/* 同一個代碼涵蓋多個調查點時一定要講，否則會被當成
                          單一路段的尖峰量。 */}
                      {item.roadCount > 1 ? `・${item.roadCount} 個調查點合計` : ""}
                    </em>
                  </span>
                ))}
                <span>
                  <b>全部方向同時段合計</b>
                  {decimalFormatter.format(directionPeaks.combined[1])}{" "}
                  PCU／小時<em>{directionPeaks.combined[0]}</em>
                </span>
              </div>
            </article>
          </div>
          <div className="chart-grid">
            <article className="panel road-chart">
              <div className="panel-title">
                <div>
                  <span>路段排名</span>
                  <h3>
                    {surveyScope.partial
                      ? "調查時段實際交通量與PCU"
                      : "全日實際交通量與24小時PCU"}
                  </h3>
                </div>
                <small>{dailyActualUnit}・{dailyPcuUnit}</small>
              </div>
              {renderBlockFilters({ quarter: true, day: true, road: true, flow: true })}
              <div className="bar-list">
                {roadRows.map((r) => (
                  <div className="bar-row" key={r.roadId}>
                    <div className="bar-label">
                      <strong>{r.roadName}</strong>
                      <small>{r.roadId}</small>
                    </div>
                    <div className="bar-pair">
                      <div className="bar-track">
                        <span
                          style={{ width: `${(r.total / maxRoad) * 100}%` }}
                        />
                      </div>
                      <div className="bar-track pcu-track">
                        <span
                          style={{ width: `${(r.pcu24 / maxRoad) * 100}%` }}
                        />
                      </div>
                    </div>
                    <b>
                      {/* 單位一律跟著 dailyActualUnit／dailyPcuUnit，
                          部分時段調查時同一張卡片才不會上面標「調查時段」、
                          下面每一列卻標「輛/日」。 */}
                      <strong>{formatter.format(r.total)} {dailyActualUnit}</strong>
                      <small>{decimalFormatter.format(r.pcu24)} {dailyPcuUnit}</small>
                    </b>
                  </div>
                ))}
              </div>
              <div className="legend">
                <span>
                  <i />
                  實際交通量（{dailyActualUnit}）
                </span>
                <span>
                  <i className="pcu-legend" />
                  {surveyScope.partial ? "調查時段PCU" : "24小時PCU"}（{dailyPcuUnit}）
                </span>
              </div>
            </article>
            <article className="panel composition">
              <div className="panel-title composition-heading">
                <div>
                  <span>車種組成</span>
                  <h3>
                    {compositionMode}・
                    {compositionRoad === "ALL"
                      ? "全部調查點"
                      : roadOptions.find(([id]) => id === compositionRoad)?.[1]}
                    ・
                    {compositionDirection === "ALL"
                      ? "全部方向"
                      : (directionOptions.find(
                          ([code]) => code === compositionDirection,
                        )?.[1] ?? compositionDirection)}
                  </h3>
                </div>
                <small>%・輛數</small>
              </div>
              <div className="composition-controls">
                <select
                  value={compositionMode}
                  onChange={(e) =>
                    setCompositionMode(e.target.value as CompositionMode)
                  }
                >
                  <option>平日</option>
                  <option>假日</option>
                  <option>平日＋假日</option>
                </select>
                <select
                  value={compositionRoad}
                  onChange={(e) => setCompositionRoad(e.target.value)}
                >
                  <option value="ALL">全部調查點</option>
                  {roadOptions.map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={compositionDirection}
                  onChange={(e) => setCompositionDirection(e.target.value)}
                >
                  <option value="ALL">全部方向</option>
                  {directionOptions.map(([code, name]) => (
                    <option value={code} key={code}>
                      {name}（{code}）
                    </option>
                  ))}
                </select>
              </div>
              <div
                className="donut"
                style={{ background: compositionGradient }}
              >
                <div>
                  <strong>{formatter.format(compositionTotals.total)}</strong>
                  <small>
                    {compositionMode === "平日＋假日"
                      ? "輛・平假日合計"
                      : dailyActualUnit}
                  </small>
                </div>
              </div>
              <div className="composition-list">
                {compositionItems.map((item) => (
                  <div key={item.key}>
                    <span>
                      <i style={{ background: item.color }} />
                      {item.label}
                    </span>
                    <strong>{pct(item.count, compositionTotals.total)}</strong>
                    <small>{formatter.format(item.count)} 輛</small>
                  </div>
                ))}
              </div>
            </article>
            <article className="panel hourly">
              <div className="panel-title">
                <div>
                  <span>24小時型態</span>
                  <h3>每小時實際交通量與PCU</h3>
                </div>
                <div className="panel-actions">
                  <small>輛／小時・PCU／小時</small>
                  {/* 這顆按的其實是整份批次匯出（受匯出中心的勾選控制），
                      不是「只下載這一張圖」。名稱要對得上行為，否則使用者
                      取消勾選「每小時實際量與PCU」之後按它，會拿到一份
                      16 張工作表、卻剛好沒有這張圖的檔案。 */}
                  <button
                    className="panel-export"
                    onClick={exportWorkbook}
                    title="依「報表批次輸出中心」目前的勾選匯出完整 Excel（含本圖，需勾選「每小時實際量與PCU」）"
                  >
                    匯出完整 Excel
                  </button>
                </div>
              </div>
              {renderBlockFilters({
                quarter: true,
                day: true,
                road: true,
                flow: true,
                direction: true,
              })}
              <HourlyCanvas
                records={filtered}
                factors={pcuFactors}
                turnFactors={turnPcuFactors}
                vehicleSettings={vehicleClassSettings}
              />
              <div className="legend chart-legend">
                <span>
                  <i />
                  實際交通量
                </span>
                <span>
                  <i className="pcu-line" />
                  PCU
                </span>
              </div>
            </article>
          </div>
          <article className="panel comparison-panel">
            <div className="panel-title">
              <div>
                <span>同季平假日</span>
                <h3>各路段平日與假日比較</h3>
              </div>
              <div className="segmented">
                <button
                  className={dayMetric === "actual" ? "active" : ""}
                  onClick={() => setDayMetric("actual")}
                >
                  實際交通量
                </button>
                <button
                  className={dayMetric === "pcu" ? "active" : ""}
                  onClick={() => setDayMetric("pcu")}
                >
                  {surveyScope.partial ? "調查時段PCU" : "24小時PCU"}
                </button>
              </div>
            </div>
            {renderBlockFilters({ quarter: true, road: true, flow: true, direction: true })}
            <div className="comparison-list">
              {dayComparisons.map((r) => {
                const w =
                    dayMetric === "actual" ? r.weekdayActual : r.weekdayPcu,
                  h = dayMetric === "actual" ? r.holidayActual : r.holidayPcu,
                  u = dayMetric === "actual" ? "輛／日" : "PCU／日";
                return (
                  <div className="comparison-row" key={r.roadId}>
                    <div>
                      <strong>{r.roadName}</strong>
                      <small>{r.roadId}</small>
                    </div>
                    <div className="comparison-bars">
                      <span>
                        <b>平日</b>
                        <i>
                          <em style={{ width: `${(w / maxDay) * 100}%` }} />
                        </i>
                        <strong>
                          {decimalFormatter.format(w)} {u}
                        </strong>
                      </span>
                      <span>
                        <b>假日</b>
                        <i>
                          <em
                            className="holiday"
                            style={{ width: `${(h / maxDay) * 100}%` }}
                          />
                        </i>
                        <strong>
                          {decimalFormatter.format(h)} {u}
                        </strong>
                      </span>
                    </div>
                    <div className={h >= w ? "delta up" : "delta down"}>
                      {w ? pct(h - w, w) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
          <article className="panel trend-panel">
            <div className="panel-title">
              <div>
                <span>歷季分析</span>
                <h3>全日交通量平日／假日趨勢</h3>
              </div>
              <div className="trend-controls">
                <select
                  value={trendRoad}
                  onChange={(e) => setTrendRoad(e.target.value)}
                >
                  <option value="ALL">全部路段合計</option>
                  {roadOptions.map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  value={trendMode}
                  onChange={(e) => setTrendMode(e.target.value as TrendMode)}
                >
                  <option>平日＋假日</option>
                  <option>平日</option>
                  <option>假日</option>
                </select>
                <select
                  value={trendMetric}
                  onChange={(e) => setTrendMetric(e.target.value as Metric)}
                >
                  <option value="actual">實際交通量</option>
                  <option value="pcu">
                    {surveyScope.partial ? "調查時段PCU" : "24小時PCU"}
                  </option>
                </select>
              </div>
            </div>
            <ProfessionalLineChart
              rows={trendRows}
              /* 這張圖畫的是 trendRows（依 trendMode），單位要跟著它。 */
              unit={trendMetric === "actual" ? trendActualUnit : trendPcuUnit}
            />
            <div className="legend chart-legend">
              <span>
                <i />
                平日
              </span>
              <span>
                <i className="pcu-legend" />
                假日
              </span>
            </div>
          </article>
          <article className="panel compare-panel project-compare">
            <div className="panel-title">
              <div>
                <span>權限範圍內</span>
                <h3>跨計畫整體比較</h3>
              </div>
              <small>
                {quarter}・{dayType}・{dailyActualUnit}、{dailyPcuUnit}
              </small>
            </div>
            {renderBlockFilters({ quarter: true, day: true })}
            <div className="project-bars">
              {projectComparisons.map((p, i) => (
                <div key={p.id}>
                  <span className="compare-index">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.role === "owner" ? "我的計畫" : "同事分享"}
                    </small>
                  </div>
                  <div className="project-track">
                    <i style={{ width: `${(p.actual / maxProject) * 100}%` }} />
                  </div>
                  <b>
                    {formatter.format(p.actual)} {dailyActualUnit}
                    <small>{decimalFormatter.format(p.pcu)} {dailyPcuUnit}</small>
                  </b>
                </div>
              ))}
            </div>
          </article>
          {!!roadOnlyRows.length && (
            <article className="panel table-panel">
              <div className="panel-title">
                <div>
                  <span>可追溯明細・路段格式</span>
                  <h3>雙向路段交通量、PCU、尖峰時段與各車種占比</h3>
                </div>
                <small>{roadOnlyRows.length} 路段・維持方向 A／B 格式</small>
              </div>
              {renderBlockFilters({
                quarter: true,
                day: true,
                road: true,
                direction: true,
              })}
              {partialDayNotice}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>路段</th>
                      {/* 這四欄和右邊的「全日」欄是同一組數字
                          （方向A＋方向B＝全日），單位必須一致，
                          不能一邊寫「輛/日」一邊寫「輛/調查日」。 */}
                      <th>方向A（{dailyActualUnit}）</th>
                      <th>方向B（{dailyActualUnit}）</th>
                      <th>方向A（{dailyPcuUnit}）</th>
                      <th>方向B（{dailyPcuUnit}）</th>
                      <th>{surveyScope.partial ? "調查時段合計" : "全日"}（{dailyActualUnit}）</th>
                      <th>
                        {surveyScope.partial ? "調查時段合計" : "24小時"}（{dailyPcuUnit}）
                      </th>
                      <th>雙向尖峰（PCU/小時）</th>
                      <th>A尖峰（PCU/小時）</th>
                      <th>B尖峰（PCU/小時）</th>
                      {analysisVehicleCatalog.map((vehicle) => (
                        <th key={vehicle.key}>{vehicle.label}（%）</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roadOnlyRows.map((r) => (
                      <tr key={r.roadId}>
                        <td>
                          <strong>{r.roadName}</strong>
                          <small>{r.roadId}</small>
                        </td>
                        <td>{formatter.format(r.a)}</td>
                        <td>{formatter.format(r.b)}</td>
                        <td>{decimalFormatter.format(r.aPcu)}</td>
                        <td>{decimalFormatter.format(r.bPcu)}</td>
                        <td>{formatter.format(r.total)}</td>
                        <td>{decimalFormatter.format(r.pcu24)}</td>
                        <td>
                          {decimalFormatter.format(r.peakPcu)}
                          <small>{r.peakHour}</small>
                        </td>
                        <td>
                          {decimalFormatter.format(r.aPeakPcu)}
                          <small>{r.aPeakHour}</small>
                        </td>
                        <td>
                          {decimalFormatter.format(r.bPeakPcu)}
                          <small>{r.bPeakHour}</small>
                        </td>
                        {analysisVehicleCatalog.map((vehicle) => (
                          <td key={vehicle.key}>
                            {pct(r.vehicles[vehicle.key] ?? 0, r.total)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          {!!intersectionOnlyRows.length && (
            <article className="panel table-panel intersection-table">
              <div className="panel-title">
                <div>
                  <span>可追溯明細・路口格式</span>
                  <h3>
                    各支線{intersectionFlowLabel}
                    路口交通量、轉向PCU、尖峰與各車種占比
                  </h3>
                </div>
                <small>
                  {intersectionOnlyRows.length} 路口・目前顯示
                  {intersectionFlowLabel}視角
                </small>
              </div>
              {renderBlockFilters({
                quarter: true,
                day: true,
                road: true,
                flow: true,
                direction: true,
              })}
              {partialDayNotice}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>路口</th>
                      {intersectionDirectionCodes.flatMap((code) => [
                        <th key={`${code}-actual`}>
                          {code === "UNMAPPED"
                            ? "未指定駛入路口"
                            : `${intersectionFlowLabel}路口${code}`}
                          （{dailyActualUnit}）
                        </th>,
                        <th key={`${code}-pcu`}>
                          {code === "UNMAPPED"
                            ? "未指定駛入路口"
                            : `${intersectionFlowLabel}路口${code}`}
                          （{dailyPcuUnit}）
                        </th>,
                        <th key={`${code}-peak`}>
                          {code === "UNMAPPED"
                            ? "未指定駛入"
                            : `${intersectionFlowLabel}路口${code}`}
                          尖峰（PCU/小時）
                        </th>,
                      ])}
                      <th>{surveyScope.partial ? "調查時段合計" : "全日"}（{dailyActualUnit}）</th>
                      <th>
                        {surveyScope.partial ? "調查時段合計" : "24小時"}（{dailyPcuUnit}）
                      </th>
                      <th>全部{intersectionFlowLabel}尖峰（PCU/小時）</th>
                      {analysisVehicleCatalog.map((vehicle) => (
                        <th key={vehicle.key}>{vehicle.label}（%）</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {intersectionOnlyRows.map((r) => (
                      <tr key={r.roadId}>
                        <td>
                          <strong>{r.roadName}</strong>
                          <small>{r.roadId}</small>
                        </td>
                        {intersectionDirectionCodes.flatMap((code) => {
                          const d = r.directions.find(
                            (item) => item.code === code,
                          );
                          return [
                            <td key={`${code}-actual`}>
                              {d ? formatter.format(d.actual) : "—"}
                            </td>,
                            <td key={`${code}-pcu`}>
                              {d ? decimalFormatter.format(d.pcu) : "—"}
                            </td>,
                            <td key={`${code}-peak`}>
                              {d ? decimalFormatter.format(d.peakPcu) : "—"}
                              {d && <small>{d.peakHour}</small>}
                            </td>,
                          ];
                        })}
                        <td>{formatter.format(r.total)}</td>
                        <td>{decimalFormatter.format(r.pcu24)}</td>
                        <td>
                          {decimalFormatter.format(r.peakPcu)}
                          <small>{r.peakHour}</small>
                        </td>
                        {analysisVehicleCatalog.map((vehicle) => (
                          <td key={vehicle.key}>
                            {pct(r.vehicles[vehicle.key] ?? 0, r.total)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}
          <article className="panel period-panel" id="periodAnalysis">
            <div className="panel-title">
              <div>
                <span>時段車種分析（獨立區塊）</span>
                <h3>全日／上午尖峰／下午尖峰各車種車輛數、百分比與交通流量</h3>
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  className="button secondary panel-export"
                  onClick={() => setShowExportCenter(true)}
                >
                  設定匯出項目
                </button>
              </div>
            </div>
            <p className="help period-help">
              尖峰小時一律由實測資料認定（依 2022 年臺灣公路容量手冊，未規定固定時鐘區間），
              判定基準為 PCU；百分比以車輛數為分母。
              <strong>「尖峰時段認定」選「整個調查點同一時段」時各方向才可相加</strong>；
              切成「各方向各自認定」後不可相加。詳細說明請見新手使用手冊。
            </p>
            {/*
              這一區自己的篩選列：季度、日別、調查點與上方工具列共用同一組狀態，
              在哪邊改都一樣。放在這裡是因為這一區在頁面最下方，
              原本每換一個條件都要捲回最上面再捲回來。
            */}
            <div className="block-filters period-scope-filters">
              <label>
                季度
                <select
                  id="periodQuarterSelect"
                  value={quarter}
                  onChange={(e) => setQuarter(e.target.value)}
                >
                  {quarters.map((q) => (
                    <option key={q}>{q}</option>
                  ))}
                </select>
              </label>
              <label>
                日別
                <select
                  id="periodDaySelect"
                  value={dayType}
                  onChange={(e) => setDayType(e.target.value as DayMode)}
                >
                  <option>平日</option>
                  <option>假日</option>
                  <option>平日＋假日</option>
                </select>
              </label>
              <label>
                路段／路口
                <select
                  id="periodRoadSelect"
                  value={roadFilter}
                  onChange={(e) => setRoadFilter(e.target.value)}
                >
                  <option value="ALL">全部調查點</option>
                  {roadOptions.map(([id, name]) => (
                    <option value={id} key={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <small className="period-filter-hint">與最上方篩選器同步</small>
            </div>
            <div className="period-controls">
              <label>
                分析時段
                <select
                  id="periodViewSelect"
                  value={periodView}
                  onChange={(e) =>
                    setPeriodView(e.target.value as PeriodKey | "ALL")
                  }
                >
                  <option value="ALL">全部時段一起看</option>
                  {PERIOD_KEYS.map((key) => (
                    <option key={key} value={key}>
                      僅顯示{PERIOD_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                路口流量視角
                <select
                  id="periodFlowViewSelect"
                  value={periodFlowView}
                  onChange={(e) =>
                    setPeriodFlowView(
                      e.target.value as "follow" | IntersectionFlowMode | "both",
                    )
                  }
                >
                  <option value="follow">跟隨上方工具列</option>
                  <option value="origin">駛出路口（以該支線為起點）</option>
                  <option value="destination">駛入路口（以該支線為終點）</option>
                  <option value="both">駛出＋駛入並列</option>
                </select>
              </label>
              <label>
                尖峰時段認定
                <select
                  id="periodPeakScopeSelect"
                  value={periodPeakScope}
                  onChange={(e) =>
                    setPeriodPeakScope(e.target.value as PeakScope)
                  }
                >
                  <option value="point">整個調查點同一時段（可相加）</option>
                  <option value="direction">各方向各自認定自己的尖峰</option>
                </select>
              </label>
              <label>
                顯示數值
                <select
                  id="periodMetricSelect"
                  value={periodMetric}
                  onChange={(e) => setPeriodMetric(e.target.value as MetricKey)}
                >
                  {METRIC_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {METRIC_LABELS[key]}（
                      {periodView === "ALL"
                        ? METRIC_BASE_UNITS[key]
                        : metricUnitFor(key, periodView, {
                            separateDays: dayType === "平日＋假日",
                            partial: surveyScope.partial,
                          })}
                      ）
                    </option>
                  ))}
                </select>
              </label>
              <div className="period-scope-picker">
                <span>方向／支線</span>
                <div className="period-scope-chips">
                  <button
                    type="button"
                    className={`chip-toggle${periodScopeFilter.length ? "" : " selected"}`}
                    onClick={() => setPeriodScopeFilter([])}
                  >
                    全部顯示
                  </button>
                  {periodScopeOptions.map((option) => (
                    <button
                      type="button"
                      key={option.code}
                      className={`chip-toggle${periodScopeFilter.includes(option.code) ? " selected" : ""}`}
                      onClick={() =>
                        setPeriodScopeFilter((previous) =>
                          previous.includes(option.code)
                            ? previous.filter((code) => code !== option.code)
                            : [...previous, option.code],
                        )
                      }
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {visiblePeriodRows.length ? (
              <div className="table-wrap period-table">
                <table>
                  <thead>
                    <tr>
                      <th>調查點</th>
                      <th>方向／支線</th>
                      <th>分析時段</th>
                      <th>尖峰時段</th>
                      {analysisVehicleCatalog.map((vehicle) => (
                        <th key={vehicle.key}>
                          {vehicle.label}
                          <small>
                            {periodView === "ALL"
                              ? METRIC_LABELS[periodMetric]
                              : metricUnitFor(periodMetric, periodView, { separateDays: dayType === "平日＋假日", partial: surveyScope.partial })}
                          </small>
                        </th>
                      ))}
                      <th>
                        合計
                        <small>
                          {periodView === "ALL"
                            ? METRIC_LABELS[periodMetric]
                            : metricUnitFor(periodMetric, periodView, { separateDays: dayType === "平日＋假日", partial: surveyScope.partial })}
                        </small>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePeriodRows.flatMap((row, rowIndex) =>
                      shownPeriods.map((period) => {
                        const cell = row.periods[period];
                        return (
                          <tr
                            // key 帶上列序：萬一日後又出現兩列內容相同的情況，
                            // React 才不會因為 key 撞號而把舊的列留在畫面上
                            // （那會讓人以為篩選條件完全沒有作用）。
                            key={`${rowIndex}-${row.roadId}-${row.flowLabel ?? ""}-${row.scopeCode}-${period}`}
                            className={
                              row.scopeCode === "ALL" ? "period-total-row" : ""
                            }
                          >
                            <td>
                              <strong>{row.roadName}</strong>
                              <small>
                                {row.roadId}・
                                {/* 並列模式下每一列自己帶 flowLabel；用工具列的
                                    intersectionFlowLabel 會把「駛入」那幾列
                                    也標成「駛出」，與匯出的 Excel 不一致。 */}
                                {row.surveyType === "intersection"
                                  ? `路口（${row.flowLabel ?? intersectionFlowLabel}）`
                                  : "路段"}
                              </small>
                            </td>
                            <td>{row.scopeName}</td>
                            <td>
                              {PERIOD_LABELS[period]}
                              <small>
                                {/* 時段定義說明改收錄在新手使用手冊，這裡只留單位 */}
                                {periodMetric === "share"
                                  ? "單位：%"
                                  : `單位：${metricUnitFor(periodMetric, period, { separateDays: dayType === "平日＋假日", partial: surveyScope.partial })}`}
                              </small>
                            </td>
                            <td>{cell.hour}</td>
                            {analysisVehicleCatalog.map((vehicle) => {
                              const value = periodCellValue(
                                cell,
                                vehicle.key,
                                periodMetric,
                              );
                              return (
                                <td key={vehicle.key}>
                                  {!cell.hasData
                                    ? "—"
                                    : periodMetric === "count"
                                      ? formatter.format(Math.round(value))
                                      : periodMetric === "share"
                                        ? `${value.toFixed(1)}%`
                                        : decimalFormatter.format(value)}
                                </td>
                              );
                            })}
                            <td>
                              {!cell.hasData
                                ? "—"
                                : periodMetric === "count"
                                  ? formatter.format(Math.round(cell.total))
                                  : periodMetric === "share"
                                    ? cell.total
                                      ? "100.0%"
                                      : "0.0%"
                                    : decimalFormatter.format(cell.pcu)}
                            </td>
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="help period-empty">
                目前條件下沒有可分析的資料。請先匯入季度資料，或放寬上方的季度／日別／調查點條件。
              </p>
            )}
          </article>

          <article className="panel conclusion-panel" id="conclusionStudio">
            <div className="panel-title">
              <div>
                <span>結論草稿產生器</span>
                <h3>依自己勾選的條件，寫出可直接貼進報告的結論</h3>
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setConclusionOpen(!conclusionOpen)}
                >
                  {conclusionOpen ? "收合" : "展開"}
                </button>
              </div>
            </div>
            <p className="help">
              <strong>這一份是「您自己出題」</strong>：自己勾選統計範圍、時段、日別、路段與要寫哪些數字，
              系統照著條件寫出結論，和 Excel 匯出無關 —— 想只寫「115Q2 每個路段的全日交通量與車種百分比」
              可以，想寫「114 年度四季的變化」也可以。
              <br />
              要產生<strong>「這批 Excel 的說明文字」</strong>請用「報表批次輸出中心」裡的
              <strong>報告文字草稿</strong>，那一份的段落跟著勾選的匯出項目走，會和 Excel 一起交出去。
              兩邊的數字來源完全相同，都取自這個畫面用的同一組計算（buildPeriodRows 與同一組 PCU 係數），
              不會另外再算一次。
            </p>
            {!conclusionOpen ? (
              <p className="help">
                按「展開」開始設定條件。（展開後才會重算全部季度，資料多時請稍候一下。）
              </p>
            ) : !conclusionRows.length ? (
              <p className="help period-empty">
                這個計畫還沒有可分析的資料。請先匯入季度資料。
              </p>
            ) : (
              <ConclusionStudio
                rows={conclusionRows}
                projectName={selectedProject?.name || "未命名計畫"}
                systemVersion={SYSTEM_VERSION}
                condition={conclusionCondition}
                setCondition={setConclusionCondition}
                draft={conclusionDraft}
                setDraft={setConclusionDraft}
                edited={conclusionEdited}
                setEdited={setConclusionEdited}
                templates={conclusionTemplates}
                setTemplates={(next: ConclusionTemplate[]) => {
                  setConclusionTemplates(next);
                  writeConclusionTemplates(activeProject, next);
                }}
                templateName={conclusionTemplateName}
                setTemplateName={setConclusionTemplateName}
                notify={(message: string) => setToast(message)}
              />
            )}
          </article>
        </section>
      </div>
      {toast && <div className="toast">{toast}</div>}
      {busy && <div className="busy">正在處理資料…</div>}
      {pendingImport && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal">
            <div>
              <span>匯入前資料檢核報告</span>
              <h3>
                {pendingImport.report.mode} {pendingImport.report.totalRows}{" "}
                筆交通紀錄
              </h3>
            </div>
            <div className="validation-grid">
              <div>
                <small>來源檔案</small>
                <strong>{pendingImport.report.sourceFiles.length}</strong>
              </div>
              <div>
                <small>調查點</small>
                <strong>{pendingImport.report.roads.length}</strong>
              </div>
              <div>
                <small>新增</small>
                <strong>{pendingImport.report.addedRows} 筆</strong>
              </div>
              <div>
                <small>覆蓋</small>
                <strong>{pendingImport.report.replacedRows} 筆</strong>
              </div>
              <div>
                <small>車輛總數</small>
                <strong>
                  {formatter.format(pendingImport.report.totalVehicles)} 輛
                </strong>
              </div>
              <div>
                <small>日別</small>
                <strong>{pendingImport.report.dayTypes.join("＋")}</strong>
              </div>
            </div>
            <section className="workflow-list">
              <strong>辨識結果</strong>
              <p>{pendingImport.report.roads.join("、")}</p>
              <p>方向／支線：{pendingImport.report.directions.join("、")}</p>
              <p>
                車種：{pendingImport.report.vehicles.join("、") || "原四大類"}
              </p>
            </section>
            {pendingImport.report.warnings.length ? (
              <section className="workflow-warning">
                <strong>需注意</strong>
                {pendingImport.report.warnings.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                {pendingImport.report.incompleteGroups
                  .slice(0, 12)
                  .map((item) => (
                    <small key={item}>{item}</small>
                  ))}
              </section>
            ) : (
              <p className="workflow-ok">
                ✓ 未發現空白、非數字、負值、重複鍵值或24小時缺漏
              </p>
            )}
            <p className="help">
              確認後才會寫入資料庫；覆蓋只影響相同「季度＋調查點＋日別＋方向＋時段」的紀錄，並自動建立可復原版本。
            </p>
            <footer>
              <button
                className="button secondary"
                onClick={() => {
                  // 取消時把匯入視窗叫回來，使用者才不用重新從工具列點一次
                  setPendingImport(null);
                  setShowImport(true);
                }}
              >
                取消，資料不變
              </button>
              <button className="button primary" onClick={confirmPendingImport}>
                確認{pendingImport.report.mode}
              </button>
            </footer>
          </div>
        </div>
      )}
      {showQualityCenter && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal">
            <div>
              <span>資料完整度與異常管理</span>
              <h3>{quarter} 品質與定稿</h3>
            </div>
            <div className="validation-grid">
              <div>
                <small>調查點</small>
                <strong>{qualitySummary.roads}</strong>
              </div>
              <div>
                <small>平日／假日</small>
                <strong>
                  {qualitySummary.weekdayRoads}／{qualitySummary.holidayRoads}
                </strong>
              </div>
              <div>
                <small>24小時完整</small>
                <strong>{qualitySummary.completeGroups}</strong>
              </div>
              <div>
                <small>不完整</small>
                <strong>{qualitySummary.incompleteGroups}</strong>
              </div>
              <div>
                <small>車種</small>
                <strong>{qualitySummary.vehicleTypes}</strong>
              </div>
              <div>
                <small>未指定駛入</small>
                <strong>{formatter.format(qualitySummary.unmapped)} 輛</strong>
              </div>
            </div>
            <div className="two-col">
              <label>
                資料狀態
                <select
                  value={currentStatus}
                  onChange={(e) => {
                    const next = e.target.value as ReviewStatus;
                    if (
                      next === "定稿" &&
                      (qualitySummary.incompleteGroups ||
                        missingFactors.length ||
                        qualitySummary.unmapped)
                    )
                      return setToast(
                        "尚有24小時缺漏、未設定車種係數或未指定駛入量，暫不能定稿",
                      );
                    setWorkflow((previous) => ({
                      ...previous,
                      statuses: { ...previous.statuses, [quarter]: next },
                    }));
                  }}
                >
                  <option>草稿</option>
                  <option>待確認</option>
                  <option>已確認</option>
                  <option>定稿</option>
                </select>
                {/* 使用者反映「切換狀態畫面都沒變，不知道有沒有作用」。
                    實際上草稿／待確認／已確認三者只影響標示，只有「定稿」
                    會真的阻擋覆蓋——這件事以前只有等到下次匯入被擋才會發現。 */}
                <small className="status-effect">
                  {currentStatus === "定稿"
                    ? "已鎖定：再匯入同一季度時系統會擋下覆蓋，需先改回其他狀態。"
                    : "此狀態只用於標示進度，不會限制匯入；改成「定稿」才會鎖定、阻擋覆蓋。"}
                </small>
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={qualitySummary.checked}
                  onChange={(e) =>
                    setWorkflow((previous) => ({
                      ...previous,
                      checkedQuarters: e.target.checked
                        ? [...new Set([...previous.checkedQuarters, quarter])]
                        : previous.checkedQuarters.filter(
                            (item) => item !== quarter,
                          ),
                    }))
                  }
                />
                <span>已完成人工檢核</span>
              </label>
              {/* 說明不能放在 <label> 裡：label 內任何位置被點到都會切換勾選，
                  一段寫著「不影響任何計算」的說明反而變成開關；而且
                  .check-row 是 flex，small 會排到文字右邊把標籤擠成兩行。 */}
              <small className="status-effect">
                「已完成人工檢核」純粹是紀錄：只會顯示在工具列，並寫進匯出的「品質與版本紀錄」，不影響任何計算或限制。
              </small>
            </div>
            <div className="threshold-grid">
              <label>
                全日量變動警示（%）
                <input
                  type="number"
                  step="any"
                  value={workflow.thresholds.dailyChangePct}
                  onChange={(e) =>
                    setWorkflow((previous) => ({
                      ...previous,
                      thresholds: {
                        ...previous.thresholds,
                        dailyChangePct: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label>
                PCU變動警示（%）
                <input
                  type="number"
                  step="any"
                  value={workflow.thresholds.pcuChangePct}
                  onChange={(e) =>
                    setWorkflow((previous) => ({
                      ...previous,
                      thresholds: {
                        ...previous.thresholds,
                        pcuChangePct: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label>
                車種占比變動（百分點）
                <input
                  type="number"
                  step="any"
                  value={workflow.thresholds.vehicleShareChangePct}
                  onChange={(e) =>
                    setWorkflow((previous) => ({
                      ...previous,
                      thresholds: {
                        ...previous.thresholds,
                        vehicleShareChangePct: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label>
                尖峰位移（小時）
                <input
                  type="number"
                  step="any"
                  value={workflow.thresholds.peakShiftHours}
                  onChange={(e) =>
                    setWorkflow((previous) => ({
                      ...previous,
                      thresholds: {
                        ...previous.thresholds,
                        peakShiftHours: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label>
                零流量時段上限
                <input
                  type="number"
                  step="1"
                  value={workflow.thresholds.zeroHourLimit}
                  onChange={(e) =>
                    setWorkflow((previous) => ({
                      ...previous,
                      thresholds: {
                        ...previous.thresholds,
                        zeroHourLimit: Number(e.target.value),
                      },
                    }))
                  }
                />
              </label>
            </div>
            <section
              className={
                anomalyAlerts.length ? "workflow-warning" : "workflow-ok"
              }
            >
              <strong>
                歷季異常提醒（顯示 {filteredAnomalies.length} / 共{" "}
                {anomalyAlerts.length} 筆）
              </strong>
              {anomalyAlerts.length > 0 && (
                <>
                  <div className="anomaly-filters">
                    <label>
                      起始季度
                      <select
                        value={anomalyFilter.fromQuarter}
                        onChange={(e) =>
                          setAnomalyFilter((previous) => ({
                            ...previous,
                            fromQuarter: e.target.value,
                          }))
                        }
                      >
                        <option value="">不限</option>
                        {anomalyQuarters.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      結束季度
                      <select
                        value={anomalyFilter.toQuarter}
                        onChange={(e) =>
                          setAnomalyFilter((previous) => ({
                            ...previous,
                            toQuarter: e.target.value,
                          }))
                        }
                      >
                        <option value="">不限</option>
                        {anomalyQuarters.map((q) => (
                          <option key={q} value={q}>
                            {q}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      調查點
                      <select
                        value={anomalyFilter.roadId}
                        onChange={(e) =>
                          setAnomalyFilter((previous) => ({
                            ...previous,
                            roadId: e.target.value,
                          }))
                        }
                      >
                        <option value="ALL">全部</option>
                        {[...new Set(anomalyAlerts.map((a) => a.roadId))]
                          .sort()
                          .map((id) => (
                            <option key={id} value={id}>
                              {roadOptions.find(([value]) => value === id)?.[1] ??
                                id}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      日別
                      <select
                        value={anomalyFilter.dayType}
                        onChange={(e) =>
                          setAnomalyFilter((previous) => ({
                            ...previous,
                            dayType: e.target.value,
                          }))
                        }
                      >
                        <option value="ALL">全部</option>
                        {[...new Set(anomalyAlerts.map((a) => a.dayType))]
                          .sort()
                          .map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="anomaly-type-chips">
                    {anomalyCounts.map(({ type, count }) => (
                      <button
                        type="button"
                        key={type}
                        disabled={!count}
                        className={`chip-toggle${
                          anomalyFilter.types.includes(type) ? " selected" : ""
                        }`}
                        onClick={() =>
                          setAnomalyFilter((previous) => ({
                            ...previous,
                            types: previous.types.includes(type)
                              ? previous.types.filter((item) => item !== type)
                              : [...previous.types, type],
                          }))
                        }
                      >
                        {type}（{count}）
                      </button>
                    ))}
                    <button
                      type="button"
                      className="chip-toggle"
                      onClick={() =>
                        setAnomalyFilter({
                          fromQuarter: "",
                          toQuarter: "",
                          types: [],
                          roadId: "ALL",
                          dayType: "ALL",
                        })
                      }
                    >
                      清除篩選
                    </button>
                  </div>
                  <small className="anomaly-hint">
                    類型可以複選；不選任何類型代表全部顯示。季度區間是「比較區間有重疊就列出」，
                    例如選 114Q1～114Q4，113Q4→114Q1 這一筆也會出現，因為它跨進了這個範圍。
                  </small>
                  <div className="anomaly-table">
                    <table>
                      <thead>
                        <tr>
                          <th>季度</th>
                          <th>調查點</th>
                          <th>日別</th>
                          <th>方向</th>
                          <th>類型</th>
                          <th>數值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAnomalies.slice(0, 200).map((item, index) => (
                          <tr key={`${item.text}-${index}`}>
                            <td>
                              {item.fromQuarter === item.toQuarter
                                ? item.toQuarter
                                : `${item.fromQuarter}→${item.toQuarter}`}
                            </td>
                            <td>{item.roadLabel}</td>
                            <td>{item.dayType}</td>
                            <td>{item.directionLabel}</td>
                            <td>
                              {item.type}
                              {item.vehicleLabel
                                ? `（${item.vehicleLabel}）`
                                : ""}
                            </td>
                            <td>
                              {item.value.toFixed(
                                item.unit === "%" || item.unit === "個百分點"
                                  ? 1
                                  : 0,
                              )}{" "}
                              {item.unit}
                            </td>
                          </tr>
                        ))}
                        {!filteredAnomalies.length && (
                          <tr>
                            <td colSpan={6}>目前篩選條件下沒有異常提醒。</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  {filteredAnomalies.length > 200 && (
                    <small className="anomaly-hint">
                      僅顯示前 200 筆，請縮小季度區間或類型再查看。
                    </small>
                  )}
                </>
              )}
              {!anomalyAlerts.length && <p>目前門檻下未發現異常。</p>}
            </section>
            <p className="help">
              定稿後，系統預設阻擋重複匯入覆蓋；如需修訂，先將狀態改回草稿並保留版本紀錄。
            </p>
            <footer>
              <button
                className="button secondary"
                onClick={() => setShowQualityCenter(false)}
              >
                關閉
              </button>
            </footer>
          </div>
        </div>
      )}
      {showHistoryCenter && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal">
            <div>
              <span>來源追溯與版本復原</span>
              <h3>匯入紀錄</h3>
            </div>
            <section className="history-list">
              {workflow.history.length ? (
                workflow.history.map((entry) => (
                  <article key={entry.id}>
                    <div>
                      <strong>
                        {new Date(entry.importedAt).toLocaleString("zh-TW")}・
                        {entry.quarter}
                      </strong>
                      <small>
                        {entry.operator}・{entry.device}
                      </small>
                      <span>{entry.files.join("、")}</span>
                      <small>
                        共 {entry.rowCount} 筆｜新增 {entry.addedRows}｜覆蓋{" "}
                        {entry.replacedRows}
                      </small>
                    </div>
                    <div>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setShowHistoryCenter(false);
                          setShowImport(true);
                          setImportQuarter(
                            entry.quarter.match(
                              /^(?:\d{3}|\d{4})Q[1-4]$/,
                            )?.[0] ?? importQuarter,
                          );
                          setToast(
                            `已帶入季度 ${entry.quarter}，請重新選取檔案：${entry.files.join("、")}`,
                          );
                        }}
                      >
                        {/* 名稱要對得上行為：它只是把匯入視窗打開並帶好季度，
                            不會自己重新讀取任何檔案。叫「重新解析」會讓人
                            以為按下去就會重跑。 */}
                        重新匯入這一批
                      </button>
                      <button
                        className="button danger"
                        onClick={() => restoreHistory(entry)}
                      >
                        還原匯入前
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="help">
                  尚無新版匯入紀錄；下一次匯入會自動建立版本。
                </p>
              )}
            </section>
            <section className="workflow-list">
              <strong>依來源檔刪除</strong>
              {[
                ...new Set(
                  activeRecords
                    .map((record) => record.sourceFileName)
                    .filter(Boolean),
                ),
              ].map((name) => (
                <div className="source-row" key={name}>
                  <span>{name}</span>
                  <button
                    className="button danger"
                    onClick={() => deleteSourceFile(name!)}
                  >
                    刪除此檔資料
                  </button>
                </div>
              ))}
              {!activeRecords.some((record) => record.sourceFileName) && (
                <p>舊資料未保存來源檔欄位；重新匯入後即可逐檔管理。</p>
              )}
            </section>
            <section className="workflow-list">
              <strong>目前季度來源追溯（前100筆）</strong>
              <div className="trace-preview">
                {activeRecords
                  .filter((record) => record.quarter === quarter)
                  .slice(0, 100)
                  .map((record, index) => (
                    <div key={`${trafficIdentity(record)}-${index}`}>
                      <span>
                        {record.roadName}・{record.dayType}・
                        {record.directionName}・{record.hour}
                      </span>
                      <small>
                        {record.sourceFileName || "舊資料未記錄"}／
                        {record.sourceSheetName || "—"}／第
                        {record.sourceRow || "—"}列
                      </small>
                    </div>
                  ))}
              </div>
            </section>
            <footer>
              <button
                className="button secondary"
                onClick={() => setShowHistoryCenter(false)}
              >
                關閉
              </button>
            </footer>
          </div>
        </div>
      )}
      {showTemplateCenter && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal">
            <div>
              <span>計畫設定範本</span>
              <h3>保存並套用分析設定</h3>
            </div>
            <div className="template-create">
              <input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="例如：一般路段＋四岔路口標準設定"
              />
              <button className="button primary" onClick={saveProjectTemplate}>
                儲存目前設定
              </button>
            </div>
            <p className="help">
              範本包含PCU、轉向當量、車種歸類、路口幾何、路段別名與異常門檻，不包含交通量。
            </p>
            <section className="history-list">
              {workflow.templates.map((template) => (
                <article key={template.id}>
                  <div>
                    <strong>{template.name}</strong>
                    <small>
                      {new Date(template.createdAt).toLocaleString("zh-TW")}
                    </small>
                  </div>
                  <div>
                    <button
                      className="button secondary"
                      onClick={() => applyProjectTemplate(template)}
                    >
                      套用
                    </button>
                    <button
                      className="button danger"
                      onClick={() =>
                        setWorkflow((previous) => ({
                          ...previous,
                          templates: previous.templates.filter(
                            (item) => item.id !== template.id,
                          ),
                        }))
                      }
                    >
                      刪除
                    </button>
                  </div>
                </article>
              ))}
              {!workflow.templates.length && (
                <p className="help">尚無設定範本。</p>
              )}
            </section>
            <footer>
              <button
                className="button secondary"
                onClick={() => setShowTemplateCenter(false)}
              >
                關閉
              </button>
            </footer>
          </div>
        </div>
      )}
      {showExportCenter && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal">
            <div>
              <span>報表批次輸出中心</span>
              <h3>選擇本次 Excel 內容</h3>
            </div>
            {/*
              匯出的資料範圍。這些控制項綁的就是最上方工具列的同一組狀態，
              在這裡改也會同步到畫面——刻意不另外做一套，否則畫面與匯出會有
              兩份互相矛盾的條件，使用者也無從得知匯出的到底是哪一種。
            */}
            <div className="export-scope">
              <div className="export-scope-head">
                <strong>本次匯出的資料範圍</strong>
                <small>
                  在這裡改動會同步到畫面上的篩選器；下方各區塊都會依這個範圍輸出。
                </small>
                {/* 工具列的搜尋框也會縮小匯出範圍，但它不在這個視窗裡，
                    使用者不會想到。留著關鍵字直接匯出，工作表會無聲少掉幾張。 */}
                {search.trim() ? (
                  <strong className="export-scope-warning">
                    注意：上方工具列的「搜尋調查點」目前是「{search.trim()}
                    」，本次匯出只會包含名稱或編號含這個關鍵字的調查點。要匯出全部請先清空搜尋框。
                  </strong>
                ) : null}
              </div>
              {renderBlockFilters({
                quarter: true,
                day: true,
                road: true,
                flow: true,
                direction: true,
              })}
              <p className="export-scope-summary">
                目前將匯出：<b>{quarter}</b>・<b>{dayType}</b>・
                <b>
                  {roadFilter === "ALL"
                    ? "全部調查點"
                    : (roadOptions.find(([id]) => id === roadFilter)?.[1] ??
                      roadFilter)}
                </b>
                ・
                <b>
                  {direction === "ALL"
                    ? "全部方向"
                    : (directionOptions.find(([code]) => code === direction)?.[1] ??
                      direction)}
                </b>
                {hasIntersectionRecords ? (
                  <>
                    ・路口以<b>{intersectionFlowLabel}</b>視角統計
                  </>
                ) : null}
              </p>
              <p className="export-scope-note">
                下列兩項有自己的條件，不受上面的「日別」影響，請在對應面板調整：
                <b>歷季全日量與趨勢</b>依「歷季分析」面板的
                {trendMode}／
                {trendRoad === "ALL"
                  ? "全部路段合計"
                  : (roadOptions.find(([id]) => id === trendRoad)?.[1] ?? trendRoad)}
                ；<b>車種組成</b>依「車種組成」面板的{compositionMode}。
                「本季交通量、PCU與平假日比較」中的平假日比較一定同時含平日與假日，
                不受「日別」限制。
              </p>
            </div>
            <div className="export-checks">
              {EXPORT_SECTIONS.map(({ key, label }) => (
                <label className="check-row" key={key}>
                  <input
                    type="checkbox"
                    checked={exportSections[key]}
                    onChange={(e) =>
                      setExportSections((previous) => ({
                        ...previous,
                        [key]: e.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <section className="export-period-box">
              <strong>時段車種分析（可自由組合）</strong>
              <p className="help">
                勾什麼就匯出什麼：勾選的每個時段各產生一張工作表，列＝調查點×方向／支線，欄＝各車種的車輛數／百分比／交通流量。
                例如只勾「上午尖峰＋下午尖峰」與「車輛數、百分比」，就只會得到那兩張表的那兩種數值。
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={periodExport.enabled}
                  onChange={(e) =>
                    setPeriodExport((previous) => ({
                      ...previous,
                      enabled: e.target.checked,
                    }))
                  }
                />
                <span>本次匯出包含時段車種分析</span>
              </label>
              <div className="export-period-group">
                <span>分析時段</span>
                <div className="export-period-chips">
                  {PERIOD_KEYS.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={`chip-toggle${periodExport.periods.includes(key) ? " selected" : ""}`}
                      onClick={() =>
                        setPeriodExport((previous) => ({
                          ...previous,
                          periods: previous.periods.includes(key)
                            ? previous.periods.filter((item) => item !== key)
                            : PERIOD_KEYS.filter(
                                (item) =>
                                  item === key || previous.periods.includes(item),
                              ),
                        }))
                      }
                    >
                      {PERIOD_LABELS[key]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-period-group">
                <span>方向／支線（不勾＝全部含合計）</span>
                <div className="export-period-chips">
                  {periodScopeOptions.map((option) => (
                    <button
                      type="button"
                      key={option.code}
                      className={`chip-toggle${periodExport.scopes.includes(option.code) ? " selected" : ""}`}
                      onClick={() =>
                        setPeriodExport((previous) => ({
                          ...previous,
                          scopes: previous.scopes.includes(option.code)
                            ? previous.scopes.filter(
                                (item) => item !== option.code,
                              )
                            : [...previous.scopes, option.code],
                        }))
                      }
                    >
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-period-group">
                <span>要匯出的數值</span>
                <div className="export-period-chips">
                  {METRIC_KEYS.map((key) => (
                    <button
                      type="button"
                      key={key}
                      className={`chip-toggle${periodExport.metrics.includes(key) ? " selected" : ""}`}
                      onClick={() =>
                        setPeriodExport((previous) => ({
                          ...previous,
                          metrics: previous.metrics.includes(key)
                            ? previous.metrics.filter((item) => item !== key)
                            : METRIC_KEYS.filter(
                                (item) =>
                                  item === key || previous.metrics.includes(item),
                              ),
                        }))
                      }
                    >
                      {METRIC_LABELS[key]}（{METRIC_BASE_UNITS[key]}）
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-period-group">
                <span>尖峰時段認定</span>
                <div className="export-period-chips">
                  {(
                    [
                      ["follow", "跟隨畫面上的設定"],
                      ["point", "整個調查點同一時段（可相加）"],
                      ["direction", "各方向各自認定自己的尖峰"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={`chip-toggle${periodExport.peakScope === value ? " selected" : ""}`}
                      onClick={() =>
                        setPeriodExport((previous) => ({
                          ...previous,
                          peakScope: value,
                        }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="export-period-group">
                <span>路口流量視角</span>
                <div className="export-period-chips">
                  {(
                    [
                      ["follow", "跟隨畫面上的設定"],
                      ["origin", "駛出路口（以該支線為起點）"],
                      ["destination", "駛入路口（以該支線為終點）"],
                      ["both", "駛出＋駛入並列"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={`chip-toggle${periodExport.flowView === value ? " selected" : ""}`}
                      onClick={() =>
                        setPeriodExport((previous) => ({
                          ...previous,
                          flowView: value,
                        }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <small className="export-period-hint">
                  只有路口格式的調查點會受這一項影響；路段格式一律是方向 A／方向 B。
                </small>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={periodExport.sheetPerPeriod}
                  onChange={(e) =>
                    setPeriodExport((previous) => ({
                      ...previous,
                      sheetPerPeriod: e.target.checked,
                    }))
                  }
                />
                <span>每個時段各一張工作表（取消勾選則全部併成一張大表）</span>
              </label>
              {periodExport.enabled &&
                (!periodExport.periods.length || !periodExport.metrics.length) && (
                  <p className="help">
                    <strong>提醒：</strong>
                    時段與數值都至少要勾一項，否則這一區不會輸出任何工作表。
                  </p>
                )}
            </section>
            <section className="report-draft-box">
              <div className="report-draft-head">
                <div>
                  <strong>報告文字草稿</strong>
                  <p className="help">
                    <b>這一份是「這批 Excel 的說明文字」</b>：段落跟著上面勾選的匯出項目走，
                    勾了哪幾張工作表就寫哪幾段，會和 Excel 一起交出去。
                    要自己挑條件（只寫某一季、某幾個路段、只寫車輛數⋯）請改用畫面最下方的
                    <b>「結論草稿產生器」</b>。兩邊的數字來源完全相同。
                    <br />
                    依目前的匯出範圍自動寫成一段中文敘述，可直接複製進報告。
                    <b>上方每一個可勾選的匯出項目，草稿裡都有對應的一段</b>，
                    另外再加上「分析範圍」「時段車種分析」「各調查點分項結果」「歷季異常提醒」四段，共 12 段。
                    其中<b>「各調查點分項結果」是逐個路段／路口各寫一段</b>（每個方向、每個分析時段各一行），
                    條件跟著上方「時段車種分析」的設定走——分析時段、尖峰時段認定、路口流量視角、
                    方向／支線、要匯出的數值；整體的總結照舊保留在其他段落，兩者可以各自勾選。
                    要寫哪幾段請用<b>下面的段落勾選</b>控制（與上方的匯出勾選各自獨立，
                    只有「9張可編輯原生圖表」那一段會跟著匯出勾選一起消失，因為沒勾就真的沒有附圖）。
                    勾了但目前沒有資料的段落會明講「沒有可敘述的資料」，不會靜靜消失。
                  </p>
                </div>
                <div className="report-draft-actions">
                  <button
                    className="button secondary"
                    onClick={() => {
                      setDraftEdited(false);
                      setReportDraft(generatedDraft);
                      setToast("已依目前條件重新產生草稿");
                    }}
                  >
                    重新產生
                  </button>
                  <button
                    className="button secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(reportDraft);
                        setToast("草稿已複製到剪貼簿");
                      } catch {
                        setToast("瀏覽器不允許複製，請手動選取文字");
                      }
                    }}
                  >
                    複製全文
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => {
                      const blob = new Blob(["\uFEFF" + reportDraft], {
                        type: "text/plain;charset=utf-8",
                      });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement("a");
                      link.href = url;
                      /* 檔名要能看出是哪一個計畫，多計畫時才不會同名互相覆蓋。 */
    link.download = `${(projects.find((p) => p.id === activeProject)?.name ?? "未命名計畫").replace(/[\\/:*?"<>|]/g, "-")}_${quarter}_報告文字草稿.txt`;
                      link.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    下載 .txt
                  </button>
                </div>
              </div>
              <div className="draft-section-picker">
                <button
                  className="button secondary"
                  onClick={() => {
                    // 不能在這裡把 draftEdited 清掉。清掉之後下面那個
                    //「沒改過就自動更新」的 effect 會立刻把使用者手寫的
                    // 文字整段覆蓋——而畫面上才剛承諾「不會再自動覆寫」。
                    setDraftSections([...DRAFT_SECTION_ORDER]);
                  }}
                >
                  全選
                </button>
                <button
                  className="button secondary"
                  onClick={() => {
                    setDraftSections([]);
                  }}
                >
                  {/* 不要叫「全部取消」：同一個視窗底下還有一個「取消」是關閉
                      視窗用的，兩個放在一起容易誤按，也讓自動化測試選錯按鈕。 */}
                  全部不勾
                </button>
                {DRAFT_SECTION_ORDER.map((key) => (
                  <label className="chip-check" key={key}>
                    <input
                      type="checkbox"
                      checked={draftSections.includes(key)}
                      onChange={(e) => {
                        // 同上：勾選段落不等於放棄手改的內容。
                        setDraftSections((previous) =>
                          e.target.checked
                            ? DRAFT_SECTION_ORDER.filter(
                                (item) =>
                                  item === key || previous.includes(item),
                              )
                            : previous.filter((item) => item !== key),
                        );
                      }}
                    />
                    <span>{DRAFT_SECTION_LABELS[key]}</span>
                  </label>
                ))}
              </div>
              <textarea
                className="report-draft-text"
                rows={16}
                value={reportDraft}
                onChange={(e) => {
                  setReportDraft(e.target.value);
                  setDraftEdited(true);
                }}
              />
              {draftEdited && (
                <p className="help">
                  您已手動修改過這段文字，系統不會再自動覆寫（改條件、改段落勾選都不會蓋掉）。要回到自動產生的版本請按「重新產生」。
                </p>
              )}
            </section>
            <section className="report-template-box">
              <strong>自訂比較報表</strong>
              <p>
                保存目前的計畫勾選、季度、日別、調查點、方向、指標、輸出項目，以及上面「時段車種分析」的所有勾選。
                不同計畫要匯出的東西不一樣時，各存一組範本，之後按「套用」就會整組還原。
              </p>
              <div className="template-create">
                <input
                  value={reportTemplateName}
                  onChange={(e) => setReportTemplateName(e.target.value)}
                  placeholder="例如：每季主要路段平假日比較"
                />
                <button
                  className="button secondary"
                  onClick={saveComparisonReport}
                >
                  儲存目前條件
                </button>
              </div>
              {(workflow.comparisonReports ?? []).map((report) => (
                <div className="source-row" key={report.id}>
                  <span>
                    <strong>{report.name}</strong>
                    <small>
                      {report.quarter}・{report.dayType}・
                      {report.compareProjectIds.length} 個計畫
                    </small>
                  </span>
                  <span>
                    <button
                      className="button secondary"
                      onClick={() => applyComparisonReport(report)}
                    >
                      套用
                    </button>
                    <button
                      className="button danger"
                      onClick={() =>
                        setWorkflow((previous) => ({
                          ...previous,
                          comparisonReports: previous.comparisonReports.filter(
                            (item) => item.id !== report.id,
                          ),
                        }))
                      }
                    >
                      刪除
                    </button>
                  </span>
                </div>
              ))}
            </section>
            <p className="help">
              沒有勾選的區塊一律不會出現在檔案裡；若某張圖表所需要的資料表被取消勾選，該張圖表也會一併略過，避免
              Excel 開檔時出現修復提示。舊版 Excel 請改用右上角 .xls 數值相容檔。
            </p>
            <footer>
              <button
                className="button secondary"
                onClick={() => setShowExportCenter(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                disabled={
                  !Object.values(exportSections).some(Boolean) &&
                  !(
                    periodExport.enabled &&
                    periodExport.periods.length &&
                    periodExport.metrics.length
                  )
                }
                onClick={() => {
                  setShowExportCenter(false);
                  exportWorkbook();
                }}
              >
                匯出所選內容
              </button>
            </footer>
          </div>
        </div>
      )}
      {showProjectForm && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={createProject}>
            <div>
              <span>多計畫管理</span>
              <h3>建立新計畫</h3>
            </div>
            <label>
              計畫名稱
              <input
                value={newProject.name}
                onChange={(e) =>
                  setNewProject({ ...newProject, name: e.target.value })
                }
                required
              />
            </label>
            <div className="two-col">
              <label>
                計畫編號
                <input
                  value={newProject.code}
                  onChange={(e) =>
                    setNewProject({ ...newProject, code: e.target.value })
                  }
                />
              </label>
              <label>
                業主
                <input
                  value={newProject.clientName}
                  onChange={(e) =>
                    setNewProject({ ...newProject, clientName: e.target.value })
                  }
                />
              </label>
            </div>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowProjectForm(false)}
              >
                取消
              </button>
              <button className="button primary">建立</button>
            </footer>
          </form>
        </div>
      )}
      {showProjectManager && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={renameProject}>
            <div>
              <span>計畫管理</span>
              <h3>修改或刪除「{selectedProject.name}」</h3>
            </div>
            <label>
              計畫名稱
              <input
                value={projectDraft.name}
                onChange={(e) =>
                  setProjectDraft({ ...projectDraft, name: e.target.value })
                }
                required
              />
            </label>
            <div className="two-col">
              <label>
                計畫編號
                <input
                  value={projectDraft.code}
                  onChange={(e) =>
                    setProjectDraft({ ...projectDraft, code: e.target.value })
                  }
                />
              </label>
              <label>
                業主
                <input
                  value={projectDraft.clientName}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      clientName: e.target.value,
                    })
                  }
                />
              </label>
            </div>
            <p className="help">
              改名只會更新顯示名稱，不會影響既有季度與分析資料。刪除計畫會一併刪除全部資料，請先匯出備份。
            </p>
            <footer>
              <button
                type="button"
                className="button danger"
                onClick={deleteProject}
              >
                刪除整個計畫
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowProjectManager(false)}
              >
                取消
              </button>
              <button className="button primary">儲存修改</button>
            </footer>
          </form>
        </div>
      )}
      {showShare && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={shareProject}>
            <div>
              <span>協作權限</span>
              <h3>分享「{selectedProject.name}」</h3>
            </div>
            <label>
              同事電子郵件
              <input
                type="email"
                value={share.email}
                onChange={(e) => setShare({ ...share, email: e.target.value })}
                required
              />
            </label>
            <label>
              權限
              <select
                value={share.role}
                onChange={(e) =>
                  setShare({
                    ...share,
                    role: e.target.value as "viewer" | "editor",
                  })
                }
              >
                <option value="viewer">僅檢視與比較</option>
                <option value="editor">可匯入與編輯</option>
              </select>
            </label>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowShare(false)}
              >
                取消
              </button>
              <button className="button primary">更新權限</button>
            </footer>
          </form>
        </div>
      )}
      {showImport && (
        <div className="modal-backdrop">
          <div className="modal">
            <div>
              <span>季度交通量資料庫</span>
              <h3>匯入路段／路口交通量或完整備份</h3>
            </div>
            <label>
              資料季度
              <input
                value={importQuarter}
                onChange={(e) => setImportQuarter(e.target.value.toUpperCase())}
                pattern="(?:\d{3}|\d{4})Q[1-4]"
                placeholder="例如115Q2或2026Q2"
              />
            </label>
            <div
              className={`upload-zone drag-zone ${dragActive ? "drag-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ")
                  fileInputRef.current?.click();
              }}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setDragActive(false);
              }}
              onDrop={dropImportFiles}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xls,.xlsx"
                onChange={importFiles}
              />
              <strong>拖曳 Excel 檔案到這裡</strong>
              <span>
                或點一下選擇單筆／多筆檔案；只有相同調查點、日別、方向與時段才會詢問是否覆蓋
              </span>
            </div>
            {!activeProject && (
              <p className="help backup-first-hint">
                <b>目前還沒有任何計畫。</b>
                請直接用下方的「還原完整備份」選擇 A 電腦匯出的 JSON 檔——
                系統會依備份檔裡的計畫名稱自動建立計畫再還原。
                （上方的 Excel 匯入需要先有計畫與季度。）
              </p>
            )}
            <label className="upload-zone backup-zone">
              從其他電腦還原完整備份
              <input
                type="file"
                accept=".json,application/json"
                onChange={importBackup}
              />
              <span>支援由本網站「匯出備份」產生的 JSON 檔</span>
            </label>
            <p className="help">
              支援雙向路段及 3～7
              支線路口轉向全日調查格式。路口資料會保留各車種左轉、直行與右轉數值。
            </p>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowImport(false)}
              >
                關閉
              </button>
            </footer>
          </div>
        </div>
      )}
      {showTurnFactors && (
        <div className="modal-backdrop">
          <form
            className="modal turn-factor-modal"
            onSubmit={(e) => {
              e.preventDefault();
              applyPcuFactors();
              setShowTurnFactors(false);
            }}
          >
            <div>
              <span>路口轉向當量</span>
              <h3>各車種左轉、直行與右轉PCU係數</h3>
            </div>
            <p className="help">
              預設值依「交通流量教育訓練1060310」第15頁。路段格式仍使用上方一般PCU係數；路口格式依本表計算。所有當量值均由使用者自訂，不設最小值或固定增量。新增且維持獨立分析的車種，請至「車種分類與當量管理」設定。
            </p>
            <div className="turn-factor-table">
              <table>
                <thead>
                  <tr>
                    <th>車種</th>
                    <th>直行</th>
                    <th>右轉</th>
                    <th>左轉</th>
                  </tr>
                </thead>
                <tbody>
                  {CORE_VEHICLE_KEYS.map((vehicle) => (
                    <tr key={vehicle}>
                      <th>{coreVehicleLabels[vehicle]}</th>
                      {(["through", "right", "left"] as TurnKey[]).map(
                        (turn) => (
                          <td key={turn}>
                            <input
                              type="number"
                              step="any"
                              value={turnPcuDraft[vehicle][turn]}
                              onChange={(e) =>
                                setTurnPcuDraft((previous) => ({
                                  ...previous,
                                  [vehicle]: {
                                    ...previous[vehicle],
                                    [turn]: Number(e.target.value),
                                  },
                                }))
                              }
                            />
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  /*
                   * 「取消」必須把草稿還原。
                   *
                   * 舊版只關視窗，turnPcuDraft 裡放棄掉的數值原樣留著；
                   * 之後只要在主畫面按一次「套用係數」，那些被取消的值就會
                   * 被一起寫進去——實測把機車直行從 0.3 改成 9、按了取消，
                   * 之後所有路口 PCU 都是用 9 算的，而使用者以為自己取消了。
                   */
                  setTurnPcuDraft(structuredClone(turnPcuFactors));
                  setShowTurnFactors(false);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  setTurnPcuDraft(structuredClone(TURN_PCU_FACTORS))
                }
              >
                恢復轉向預設
              </button>
              <button className="button primary">套用轉向係數</button>
            </footer>
          </form>
        </div>
      )}
      {showVehicleManager && (
        <div className="modal-backdrop">
          <form
            className="modal vehicle-class-modal"
            onSubmit={saveVehicleClassSettings}
          >
            <div>
              <span>動態車種管理</span>
              <h3>原始車種、分析分類與PCU當量</h3>
            </div>
            <p className="help">
              系統會保留檔案中的原始車種。選擇「獨立分析」可在圖表、比例與匯出表中單獨顯示；選擇四大類之一則會合併計算。當量值由使用者自訂，不設最小值或固定增量。匯入時偵測到的新車種一律先預設為獨立車種、當量係數 1，請在此依實際需要修改。
            </p>
            <p className="help">
              灰底不能編輯的列代表這個車種是用原四大類（機車／小型車／大型車／特種車）的係數計算，欄位直接顯示外面「PCU
              當量係數」目前的數值：在外面把機車改成 0.42 並按「套用係數」，這裡就會同步變成
              0.42，兩邊永遠是同一個數字。要改這幾列請回到外面的 PCU 當量係數區塊。
            </p>
            <div className="vehicle-class-table table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>原始車種</th>
                    <th>分析方式</th>
                    <th>一般PCU</th>
                    <th>直行</th>
                    <th>右轉</th>
                    <th>左轉</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicleClassDraft.map((setting) => {
                    const independentCustom =
                      !CORE_VEHICLE_KEYS.includes(
                        setting.sourceKey as CoreVehicleKey,
                      ) && setting.targetKey === setting.sourceKey;
                    // 鎖定（歸類到原四大類）的列一律顯示外面「PCU 當量係數」目前的值，
                    // 不顯示建立設定當下複製下來的舊快照，兩邊數字才不會打架。
                    const lockedCoreKey = CORE_VEHICLE_KEYS.includes(
                      setting.targetKey as CoreVehicleKey,
                    )
                      ? (setting.targetKey as CoreVehicleKey)
                      : undefined;
                    const shownRoadPcu = lockedCoreKey
                      ? pcuFactors[lockedCoreKey]
                      : setting.roadPcu;
                    const shownTurnPcu = lockedCoreKey
                      ? turnPcuFactors[lockedCoreKey]
                      : setting.turnPcu;
                    return (
                      <tr key={setting.sourceKey}>
                        <td>
                          <strong>{setting.sourceLabel}</strong>
                          <small>
                            {setting.sourceKey.startsWith("custom:")
                              ? "新增車種"
                              : "原四大類"}
                          </small>
                        </td>
                        <td>
                          <select
                            value={
                              setting.targetKey === setting.sourceKey
                                ? "SELF"
                                : setting.targetKey
                            }
                            onChange={(e) =>
                              changeVehicleTarget(
                                setting.sourceKey,
                                e.target.value === "SELF"
                                  ? setting.sourceKey
                                  : e.target.value,
                              )
                            }
                          >
                            <option value="SELF">
                              獨立分析（{setting.sourceLabel}）
                            </option>
                            {CORE_VEHICLE_KEYS.filter(
                              (key) => key !== setting.sourceKey,
                            ).map((key) => (
                              <option value={key} key={key}>
                                歸類至{coreVehicleLabels[key]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            step="any"
                            disabled={!independentCustom}
                            value={shownRoadPcu ?? ""}
                            onChange={(e) =>
                              updateVehicleClassDraft(setting.sourceKey, {
                                roadPcu: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        {(["through", "right", "left"] as TurnKey[]).map(
                          (turn) => (
                            <td key={turn}>
                              <input
                                type="number"
                                step="any"
                                disabled={!independentCustom}
                                value={shownTurnPcu?.[turn] ?? ""}
                                onChange={(e) =>
                                  updateVehicleClassDraft(setting.sourceKey, {
                                    turnPcu: {
                                      ...setting.turnPcu,
                                      [turn]: Number(e.target.value),
                                    },
                                  })
                                }
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="help">
              若之後改變歸類方式，原始數量不會被改寫；網站會以同一份原始資料重新彙整，因此可隨時改回獨立車種。
            </p>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={closeVehicleManager}
              >
                取消
              </button>
              <button className="button primary">套用車種設定</button>
            </footer>
          </form>
        </div>
      )}
      {showIntersectionManager && (
        <div className="modal-backdrop">
          <form
            className="modal intersection-manager-modal"
            onSubmit={saveIntersectionSettings}
          >
            <div>
              <span>道路與流向管理</span>
              <h3>多支線角度、轉向圖與流向確認</h3>
            </div>
            <label>
              選擇路口
              <select
                value={intersectionManageRoad}
                onChange={(e) => setIntersectionManageRoad(e.target.value)}
              >
                {intersectionManagerRows.map((r) => (
                  <option key={r.roadId} value={r.roadId}>
                    {r.roadName}（{r.roadId}）
                  </option>
                ))}
              </select>
            </label>
            <p className="help">
              支援 3～7 支線及不規則角度。角度以正東 0°、正南 90°、正西
              180°、正北 270° 表示；系統以起點正對面 ±45°
              判定直行，對向一側判定左轉、另一側判定右轉，並可逐筆人工修正。
            </p>
            <div className="geometry-workspace">
              <div className="arm-settings">
                {managedArmSettings.map((setting) => (
                  <section key={setting.directionCode}>
                    <strong>路口{setting.directionCode}</strong>
                    <label>
                      支線名稱
                      <input
                        value={setting.name}
                        onChange={(e) =>
                          updateArmSetting(setting.directionCode, {
                            name: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      角度（°）
                      <input
                        type="number"
                        step="1"
                        value={setting.angle}
                        onChange={(e) =>
                          updateArmAngle(
                            setting.directionCode,
                            Number(e.target.value),
                          )
                        }
                      />
                      <small>{bearingLabel(setting.angle)}方（自動）</small>
                    </label>
                  </section>
                ))}
              </div>
              <div className="geometry-preview">
                <label>
                  預覽起點
                  <select
                    value={intersectionDiagramSource}
                    onChange={(e) =>
                      setIntersectionDiagramSource(e.target.value)
                    }
                  >
                    {managedArmSettings.map((setting) => (
                      <option
                        key={setting.directionCode}
                        value={setting.directionCode}
                      >
                        路口{setting.directionCode}－{setting.name}
                      </option>
                    ))}
                  </select>
                </label>
                <IntersectionGeometryDiagram
                  settings={managedArmSettings}
                  sourceCode={intersectionDiagramSource}
                />
              </div>
            </div>
            <div className="route-mapping">
              <h4>起點 → 終點轉向判定</h4>
              <p>
                調整角度後按「依角度重新判定」。如現場或報告定義不同，可在下表個別修改。
              </p>
              {managedArmSettings.map((source) => (
                <details
                  key={source.directionCode}
                  open={source.directionCode === intersectionDiagramSource}
                >
                  <summary>
                    由路口{source.directionCode}（{source.name}）駛出
                  </summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>終點支線</th>
                          <th>終點角度</th>
                          <th>判定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managedArmSettings
                          .filter(
                            (target) =>
                              target.directionCode !== source.directionCode,
                          )
                          .map((target) => (
                            <tr key={target.directionCode}>
                              <td>
                                路口{target.directionCode}－{target.name}
                              </td>
                              <td>
                                {normalizeAngle(target.angle).toFixed(0)}°
                              </td>
                              <td>
                                <select
                                  value={
                                    source.routes[target.directionCode] ??
                                    classifyMovement(source.angle, target.angle)
                                  }
                                  onChange={(e) =>
                                    updateArmRoute(
                                      source.directionCode,
                                      target.directionCode,
                                      e.target.value as TurnKey,
                                    )
                                  }
                                >
                                  <option value="left">左轉</option>
                                  <option value="through">直行</option>
                                  <option value="right">右轉</option>
                                </select>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
            <div className="route-mapping destination-mapping">
              <h4>駛出目的支線</h4>
              <p>
                指定每個來源支線的左轉、直行與右轉最後駛出哪一個路口。系統會先依角度帶入最合理的目的地；多岔路口請務必人工確認。
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>來源支線</th>
                      <th>左轉駛出</th>
                      <th>直行駛出</th>
                      <th>右轉駛出</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedArmSettings.map((source) => (
                      <tr key={source.directionCode}>
                        <td>
                          <strong>路口{source.directionCode}</strong>
                          <small>{source.name}</small>
                        </td>
                        {(["left", "through", "right"] as TurnKey[]).map(
                          (turn) => (
                            <td key={turn}>
                              <select
                                value={source[targetField(turn)] ?? ""}
                                onChange={(e) =>
                                  updateArmSetting(source.directionCode, {
                                    [targetField(turn)]: e.target.value,
                                  })
                                }
                              >
                                <option value="">未指定</option>
                                {managedArmSettings
                                  .filter(
                                    (target) =>
                                      target.directionCode !==
                                      source.directionCode,
                                  )
                                  .map((target) => (
                                    <option
                                      key={target.directionCode}
                                      value={target.directionCode}
                                    >
                                      路口{target.directionCode}－{target.name}
                                    </option>
                                  ))}
                              </select>
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="help">
              「駛出路口X」依原始報告的來源支線統計（以 X 為起點）；「駛入路口X」依上方目的支線重新彙整（以 X 為終點）。兩種視角均保留各車種、轉向PCU與每小時尖峰，總交通量應一致。
            </p>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowIntersectionManager(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={autoMapIntersection}
              >
                依角度重新判定
              </button>
              <button className="button primary">儲存設定</button>
            </footer>
          </form>
        </div>
      )}
      {showRoadManager && (
        <div className="modal-backdrop">
          <form
            className="modal road-manager-modal"
            onSubmit={saveRoadSettings}
          >
            <div>
              <span>永久調查點主檔</span>
              <h3>
                {managedRoad?.surveyType === "intersection"
                  ? "路口名稱管理"
                  : "路段名稱管理"}
              </h3>
            </div>
            <label>
              選擇調查點
              <select
                value={roadManageId}
                onChange={(e) => setRoadManageId(e.target.value)}
              >
                {roadManagerRows.map((r) => (
                  <option key={r.roadId} value={r.roadId}>
                    {r.roadName}（{r.roadId}）
                  </option>
                ))}
              </select>
            </label>
            <div className="road-impact">
              {managedRoad ? (
                <>
                  <strong>{managedRoad.rows} 筆交通紀錄</strong>
                  <span>
                    {managedRoad.quarters.length} 個季度：
                    {managedRoad.quarters.join("、")}
                  </span>
                </>
              ) : null}
            </div>
            <label>
              正式{managedRoad?.surveyType === "intersection" ? "路口" : "路段"}
              名稱
              <input
                value={roadDraft.roadName}
                onChange={(e) =>
                  setRoadDraft({ ...roadDraft, roadName: e.target.value })
                }
                required
              />
            </label>
            {managedRoad?.surveyType === "road" ? (
              <div className="two-col">
                <label>
                  方向 A 名稱
                  <input
                    value={roadDraft.directionA}
                    onChange={(e) =>
                      setRoadDraft({ ...roadDraft, directionA: e.target.value })
                    }
                  />
                </label>
                <label>
                  方向 B 名稱
                  <input
                    value={roadDraft.directionB}
                    onChange={(e) =>
                      setRoadDraft({ ...roadDraft, directionB: e.target.value })
                    }
                  />
                </label>
              </div>
            ) : (
              <p className="help">
                路口格式沒有方向 A／B 名稱；路口
                A、B、C…的支線名稱與角度請至「道路與流向管理」設定。
              </p>
            )}
            <label>
              新增檔名別名（選填）
              <input
                value={roadDraft.aliasName}
                onChange={(e) =>
                  setRoadDraft({ ...roadDraft, aliasName: e.target.value })
                }
                placeholder="例如：台1省道－計畫區道路口"
              />
            </label>
            <div className="alias-list">
              <strong>現有別名</strong>
              <span>
                {roadAliases
                  .filter((a) => a.roadId === roadManageId)
                  .map((a) => a.aliasName)
                  .join("、") || "尚無別名"}
              </span>
            </div>
            <section className="merge-box">
              <strong>合併重複調查點</strong>
              <p>
                只能合併相同調查格式；系統會先顯示影響季度與資料筆數，原名稱保留為辨識別名。
              </p>
              <div>
                <select
                  value={roadDraft.mergeTarget}
                  onChange={(e) =>
                    setRoadDraft({ ...roadDraft, mergeTarget: e.target.value })
                  }
                >
                  <option value="">選擇要合併到的既有調查點</option>
                  {roadManagerRows
                    .filter(
                      (r) =>
                        r.roadId !== roadManageId &&
                        r.surveyType === managedRoad?.surveyType,
                    )
                    .map((r) => (
                      <option key={r.roadId} value={r.roadId}>
                        {r.roadName}（{r.roadId}）
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="button danger"
                  onClick={mergeRoad}
                >
                  預覽並合併
                </button>
              </div>
            </section>
            <footer>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowRoadManager(false)}
              >
                關閉
              </button>
              <button className="button primary">儲存名稱設定</button>
            </footer>
          </form>
        </div>
      )}
      {showQuarterManager && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={renameQuarter}>
            <div>
              <span>季度資料管理</span>
              <h3>管理 {quarter}</h3>
            </div>
            <label>
              季度名稱
              <input
                /*
                 * 這是「新增季度」對話框開啟後的第一個輸入框，使用者按下按鈕
                 * 就是為了打字。自動聚焦在這裡是預期行為，不是干擾。
                 */
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={quarterDraft}
                onChange={(e) => setQuarterDraft(e.target.value.toUpperCase())}
                pattern="(?:\d{3}|\d{4})Q[1-4]"
                placeholder="例如115Q2或2026Q2"
                required
              />
            </label>
            <p className="help">
              重新命名會同步更新所有路段與歷季分析。清除只刪除網站分析資料，原始上傳檔仍保留。
            </p>
            <footer>
              <button
                type="button"
                className="button danger"
                onClick={deleteQuarter}
              >
                清除本季資料
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShowQuarterManager(false)}
              >
                取消
              </button>
              <button className="button primary">儲存新名稱</button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}

/**
 * 結論草稿產生器的條件面板與文字框。
 *
 * 刻意做成獨立元件、狀態由外面傳進來：收合再展開時條件與草稿都還在，
 * 使用者不會因為捲動或收合而丟掉剛設好的一整組條件。
 */
function ConclusionStudio(props: {
  rows: ConclusionRow[];
  projectName: string;
  systemVersion: string;
  condition: ConclusionCondition;
  setCondition: (value: ConclusionCondition) => void;
  draft: string;
  setDraft: (value: string) => void;
  edited: boolean;
  setEdited: (value: boolean) => void;
  templates: ConclusionTemplate[];
  setTemplates: (value: ConclusionTemplate[]) => void;
  templateName: string;
  setTemplateName: (value: string) => void;
  notify: (message: string) => void;
}) {
  const { condition, rows } = props;
  const quarters = useMemo(
    () =>
      [...new Set(rows.map((row) => row.quarter))].sort(
        (a, b) => conclusionQuarterKey(a) - conclusionQuarterKey(b),
      ),
    [rows],
  );
  const years = useMemo(
    () =>
      [
        ...new Set(rows.map((row) => conclusionQuarterYear(row.quarter)).filter(Boolean)),
      ].sort(),
    [rows],
  );
  const dayTypeList = useMemo(
    () => [...new Set(rows.map((row) => row.dayType))].sort(),
    [rows],
  );
  const roadList = useMemo(
    () =>
      [...new Map(rows.map((row) => [row.roadId, row.roadName])).entries()].sort(
        (a, b) => a[0].localeCompare(b[0], "en"),
      ),
    [rows],
  );
  /* 方向／支線清單跟著所選路段變動，否則清單會長到不能看。 */
  const scopeList = useMemo(() => {
    /*
     * 一個代碼可能對應多個名稱。
     *
     * 路段的方向代碼是 A／B，路口支線的代碼也是 A～G；同一個計畫裡兩種格式
     * 並存時代碼會重疊。舊寫法只留「先遇到的那一個名稱」，於是勾「A」時
     * 畫面只寫「方向A」，使用者不會知道那一勾同時涵蓋了「駛出路口A」。
     * 這裡把該代碼實際對應到的名稱全部列出來（和上方時段分析的
     * periodScopeOptions 用同一套作法）。
     */
    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      if (condition.roadIds.length && !condition.roadIds.includes(row.roadId))
        continue;
      const name =
        row.scopeCode === "ALL" ? "合計（雙向／全部支線）" : row.scopeName;
      map.set(row.scopeCode, new Set([...(map.get(row.scopeCode) ?? []), name]));
    }
    return [...map.entries()]
      .sort((a, b) =>
        a[0] === "ALL" ? -1 : b[0] === "ALL" ? 1 : a[0].localeCompare(b[0], "en"),
      )
      .map(([code, names]) => [code, [...names].join("／")] as [string, string]);
  }, [rows, condition.roadIds]);

  const matched = useMemo(
    () => selectConclusionRows(rows, condition).length,
    [rows, condition],
  );

  const patch = (next: Partial<ConclusionCondition>) =>
    props.setCondition({ ...condition, ...next });
  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  function generate() {
    if (
      props.edited &&
      !window.confirm("您已經手動修改過草稿。重新產生會覆蓋掉修改內容，確定要繼續嗎？")
    )
      return;
    const now = new Date();
    const stamp =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0") +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
    props.setDraft(
      buildConclusion(rows, condition, {
        projectName: props.projectName,
        systemVersion: props.systemVersion,
        generatedAt: stamp,
      }),
    );
    props.setEdited(false);
    props.notify("結論草稿已產生。");
  }

  const scope = condition.scope;

  return (
    <div className="conclusion-body">
      <div className="conclusion-head">
        <b className={matched ? "conclusion-count" : "conclusion-count zero"}>
          符合條件 {matched} 列
        </b>
        <button type="button" className="button primary" onClick={generate}>
          產生草稿
        </button>
      </div>

      <div className="conclusion-grid">
        <fieldset className="conclusion-field">
          <legend>一、統計範圍</legend>
          <div className="conclusion-radios">
            {(
              [
                ["quarter", "單一季度"],
                ["year", "某一年度"],
                ["range", "季度區間"],
                ["project", "整個計畫"],
              ] as const
            ).map((entry) => (
              <label key={entry[0]}>
                <input
                  type="radio"
                  name="traffic-conclusion-scope"
                  checked={scope.kind === entry[0]}
                  onChange={() => {
                    if (entry[0] === "quarter")
                      patch({
                        scope: { kind: "quarter", quarter: quarters.at(-1) || "" },
                      });
                    else if (entry[0] === "year")
                      patch({ scope: { kind: "year", year: years.at(-1) || "" } });
                    else if (entry[0] === "range")
                      patch({
                        scope: {
                          kind: "range",
                          from: quarters[0] || "",
                          to: quarters.at(-1) || "",
                        },
                      });
                    else patch({ scope: { kind: "project" } });
                  }}
                />
                {entry[1]}
              </label>
            ))}
          </div>
          {scope.kind === "quarter" && (
            <label className="conclusion-inline">
              季度
              <select
                value={scope.quarter}
                onChange={(e) =>
                  patch({ scope: { kind: "quarter", quarter: e.target.value } })
                }
              >
                {quarters.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
          )}
          {scope.kind === "year" && (
            <label className="conclusion-inline">
              年度
              <select
                value={scope.year}
                onChange={(e) => patch({ scope: { kind: "year", year: e.target.value } })}
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y} 年
                  </option>
                ))}
              </select>
            </label>
          )}
          {scope.kind === "range" && (
            <div className="conclusion-inline">
              <label>
                起
                <select
                  value={scope.from}
                  onChange={(e) =>
                    patch({
                      scope: { kind: "range", from: e.target.value, to: scope.to },
                    })
                  }
                >
                  {quarters.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                迄
                <select
                  value={scope.to}
                  onChange={(e) =>
                    patch({
                      scope: { kind: "range", from: scope.from, to: e.target.value },
                    })
                  }
                >
                  {quarters.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="conclusion-field">
          <legend>二、時段與日別</legend>
          <div className="conclusion-checks">
            {PERIOD_KEYS.map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={condition.periods.includes(key)}
                  onChange={() => {
                    const next = toggle(condition.periods, key);
                    patch({ periods: next.length ? next : condition.periods });
                  }}
                />
                {CONCLUSION_PERIOD_LABELS[key]}
              </label>
            ))}
          </div>
          <div className="conclusion-checks">
            {dayTypeList.map((day) => (
              <label key={day}>
                <input
                  type="checkbox"
                  checked={condition.dayTypes.includes(day)}
                  onChange={() => patch({ dayTypes: toggle(condition.dayTypes, day) })}
                />
                {day}
              </label>
            ))}
          </div>
          <p className="conclusion-hint">
            日別一個都不勾＝平日與假日都寫。
            {/*
              時段為什麼不能全部取消：這一區每一項數字（車輛數、當量、車種組成…）
              都是寫在「某一個時段」底下的，全部取消就一行都寫不出來。
              使用者常見的需求是「我只要全日的數字」——那不是取消全部，
              而是只勾「全日」，所以直接把作法寫出來。
            */}
            時段至少要留一個；<b>只想要全日的數字就只勾「全日」</b>。
          </p>
        </fieldset>

        <fieldset className="conclusion-field">
          <legend>三、要寫哪些路段／調查點</legend>
          <div className="conclusion-actions-row">
            <button
              type="button"
              className="button secondary"
              onClick={() => patch({ roadIds: [], scopeCodes: [] })}
            >
              全部路段
            </button>
          </div>
          <div className="conclusion-list">
            {roadList.map((entry) => (
              <label key={entry[0]}>
                <input
                  type="checkbox"
                  checked={condition.roadIds.includes(entry[0])}
                  onChange={() =>
                    patch({
                      roadIds: toggle(condition.roadIds, entry[0]),
                      scopeCodes: [],
                    })
                  }
                />
                {entry[1]}（{entry[0]}）
              </label>
            ))}
          </div>
          <p className="conclusion-hint">
            一個都不勾＝全部都寫（目前 {roadList.length} 個）。
          </p>
        </fieldset>

        <fieldset className="conclusion-field">
          <legend>四、要寫哪些方向／支線</legend>
          <div className="conclusion-list">
            {scopeList.map((entry) => (
              <label key={entry[0]}>
                <input
                  type="checkbox"
                  checked={condition.scopeCodes.includes(entry[0])}
                  onChange={() =>
                    patch({ scopeCodes: toggle(condition.scopeCodes, entry[0]) })
                  }
                />
                {entry[1]}
              </label>
            ))}
          </div>
          <p className="conclusion-hint">
            一個都不勾＝全部都寫。要真的逐方向敘述，還要在下面勾「各方向／支線分列」。
            <b>駛出與駛入都列在這裡</b>，不必到上方工具列切換視角。
          </p>
        </fieldset>

        <fieldset className="conclusion-field conclusion-field-wide">
          <legend>五、要寫哪些數字</legend>
          <div className="conclusion-metrics">
            {CONCLUSION_METRICS.map((metric) => {
              const key = metric.key as ConclusionMetricKey;
              return (
                <label
                  key={key}
                  className={condition.metrics.includes(key) ? "selected" : ""}
                >
                  <input
                    type="checkbox"
                    checked={condition.metrics.includes(key)}
                    onChange={() => patch({ metrics: toggle(condition.metrics, key) })}
                  />
                  {metric.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="conclusion-field conclusion-field-wide">
          <legend>六、敘述方式</legend>
          <div className="conclusion-radios">
            {(
              [
                ["byRoad", "依路段分段（每個調查點一段）"],
                ["byQuarter", "依季度分段（每一季一段）"],
                ["overall", "只寫整體結論"],
              ] as const
            ).map((entry) => (
              <label key={entry[0]}>
                <input
                  type="radio"
                  name="traffic-conclusion-grouping"
                  checked={condition.grouping === entry[0]}
                  onChange={() => patch({ grouping: entry[0] })}
                />
                {entry[1]}
              </label>
            ))}
          </div>
          <label className="conclusion-inline">
            小數位數
            <select
              value={String(condition.digits)}
              onChange={(e) => patch({ digits: Number(e.target.value) })}
            >
              {[0, 1, 2].map((d) => (
                <option key={d} value={d}>
                  {d} 位
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      </div>

      <div className="conclusion-templates">
        <strong>條件範本</strong>
        <div className="conclusion-actions-row">
          <input
            value={props.templateName}
            placeholder="例如：季報用、年報用"
            onChange={(e) => props.setTemplateName(e.target.value)}
          />
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              const name = props.templateName.trim();
              if (!name) return props.notify("請先輸入範本名稱。");
              props.setTemplates([
                {
                  id: "CT-" + Date.now(),
                  name,
                  condition,
                  savedAt: new Date().toISOString(),
                },
                ...props.templates.filter((item) => item.name !== name),
              ]);
              props.setTemplateName("");
              props.notify("已存成範本「" + name + "」。");
            }}
          >
            存成範本
          </button>
        </div>
        {props.templates.length ? (
          <div className="conclusion-template-list">
            {props.templates.map((template) => (
              <span key={template.id} className="conclusion-template">
                <button
                  type="button"
                  onClick={() => {
                    props.setCondition(template.condition);
                    props.notify("已套用範本「" + template.name + "」。");
                  }}
                >
                  {template.name}
                </button>
                <button
                  type="button"
                  className="danger"
                  aria-label={"刪除範本 " + template.name}
                  onClick={() =>
                    props.setTemplates(
                      props.templates.filter((item) => item.id !== template.id),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="conclusion-hint">
            還沒有存過範本。存起來之後，下次直接按一下就套用同一組條件。
          </p>
        )}
      </div>

      <div className="conclusion-output">
        <div className="conclusion-head">
          <strong>結論草稿</strong>
          <div className="conclusion-actions-row">
            <button type="button" className="button secondary" onClick={generate}>
              重新產生
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!props.draft}
              onClick={() => {
                navigator.clipboard
                  ?.writeText(props.draft)
                  .then(() => props.notify("已複製到剪貼簿。"))
                  .catch(() => props.notify("瀏覽器不允許複製，請手動全選複製。"));
              }}
            >
              複製全文
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!props.draft}
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([props.draft], { type: "text/plain;charset=utf-8" }),
                );
                const link = document.createElement("a");
                link.href = url;
                /* 檔名帶計畫名稱，多計畫時才不會同名互相覆蓋。 */
                link.download = `${props.projectName.replace(/[\\/:*?"<>|]/g, "-")}_結論草稿.txt`;
                link.click();
                URL.revokeObjectURL(url);
              }}
            >
              下載 .txt
            </button>
          </div>
        </div>
        <textarea
          aria-label="結論草稿"
          value={props.draft}
          placeholder="設定好上面的條件後，按「產生草稿」。"
          onChange={(e) => {
            props.setDraft(e.target.value);
            props.setEdited(true);
          }}
        />
        <p className="conclusion-hint">
          {props.edited
            ? "您已手動修改過這份草稿；按「重新產生」會先詢問再覆蓋。"
            : "這段文字可以直接修改，改過之後不會被自動覆蓋。"}
        </p>
      </div>
    </div>
  );
}
