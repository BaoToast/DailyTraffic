import { coreVehicleLabels, type CoreVehicleKey, type TurnCounts, type TurnKey, type VehicleCounts, type VehicleLabels } from "./traffic-parser.ts";

export const CORE_VEHICLE_KEYS: CoreVehicleKey[] = ["motorcycle", "small", "large", "special"];

export type VehicleClassSetting = {
  projectId: string;
  sourceKey: string;
  sourceLabel: string;
  targetKey: string;
  targetLabel: string;
  roadPcu: number;
  turnPcu: Record<TurnKey, number>;
};

export type VehicleRecordLike = {
  projectId?: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  surveyType?: "road" | "intersection";
  turnData?: TurnCounts;
  vehicleCounts?: VehicleCounts;
  vehicleLabels?: VehicleLabels;
};

export type CorePcuFactors = Record<CoreVehicleKey, number>;
export type CoreTurnPcuFactors = Record<CoreVehicleKey, Record<TurnKey, number>>;
export type VehicleCatalogItem = { key: string; label: string };

/**
 * 一筆紀錄的「各車種原始車輛數」。
 *
 * 三個來源，依可信度排序：
 *
 * 1. `vehicleCounts`——目前版本匯入時寫入的，保有原始精度、也含自訂車種。
 * 2. `turnData` 的左＋直＋右——**舊版匯入的紀錄沒有 `vehicleCounts`**，
 *    而它的四大類欄位是**四捨五入後的整數**（實測：turnData 是
 *    0.36＋11＋1＝12.36，欄位卻寫 12）。轉向明細才是沒被動過的那一份。
 * 3. 四大類欄位——連轉向明細都沒有時才用。
 *
 * 為什麼一定要優先用轉向明細：舊版紀錄逐時逐支線各四捨五入一次，
 * 96 筆累積下來會偏掉好幾輛。實測某路口全日機車由 9,226 變成 9,228、
 * 特種車由 51 變成 48。更糟的是「駛入」視角會把
 * `四大類欄位 − 轉向明細` 的**正差額**補進「未指定駛入路口」
 * （負的不扣，只補正的），於是駛入合計比駛出合計多出 22 輛——
 * 同一批車，換個分組方式總量就變了。
 *
 * 只有在兩者「差距在 1 輛以內」時才採用轉向明細：那代表它們是同一批車、
 * 只差在四捨五入。差距超過 1 輛時，總量裡真的含有沒有轉向明細的車
 * （例如只記總量的舊格式），這時要維持用總量，讓下游把差額補成
 * 「未指定駛入路口」——那是它原本就該做的事。
 */
export function rawVehicleCounts(record: VehicleRecordLike): VehicleCounts {
  if (record.vehicleCounts && Object.keys(record.vehicleCounts).length) return record.vehicleCounts;
  const turnTotalOf = (key: CoreVehicleKey) => {
    const turns = record.turnData?.[key];
    if (!turns) return null;
    const total = (turns.left || 0) + (turns.through || 0) + (turns.right || 0);
    return total > 0 ? total : null;
  };
  const resolve = (key: CoreVehicleKey) => {
    const field = record[key] || 0;
    const fromTurns = turnTotalOf(key);
    return fromTurns !== null && Math.abs(fromTurns - field) < 1 ? fromTurns : field;
  };
  return {
    motorcycle: resolve("motorcycle"),
    small: resolve("small"),
    large: resolve("large"),
    special: resolve("special"),
  };
}

export function rawVehicleLabels(record: VehicleRecordLike): VehicleLabels {
  return { ...coreVehicleLabels, ...(record.vehicleLabels ?? {}) };
}

/**
 * 車輛數一律先經過這裡。
 * 資料可能來自 API 或備份檔，欄位有機會是字串（例如 "n/a"）；
 * `Number(count || 0)` 遇到 "n/a" 會得到 NaN，接著整欄合計、百分比都會壞掉，
 * 而且畫面上不同面板的防護不一致，會出現兩個互相矛盾的數字。
 */
function safeCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function settingFor(record: VehicleRecordLike, sourceKey: string, settings: VehicleClassSetting[]) {
  return settings.find(setting => setting.projectId === String(record.projectId ?? "") && setting.sourceKey === sourceKey);
}

export function effectiveVehicleCounts(record: VehicleRecordLike, settings: VehicleClassSetting[]) {
  const result: Record<string, number> = {};
  for (const [sourceKey, count] of Object.entries(rawVehicleCounts(record))) {
    const setting = settingFor(record, sourceKey, settings);
    const targetKey = setting?.targetKey || sourceKey;
    result[targetKey] = (result[targetKey] ?? 0) + safeCount(count);
  }
  return result;
}

export function effectiveVehicleLabel(record: VehicleRecordLike, targetKey: string, settings: VehicleClassSetting[]) {
  const setting = settings.find(item => item.projectId === String(record.projectId ?? "") && item.targetKey === targetKey);
  return setting?.targetLabel || rawVehicleLabels(record)[targetKey] || coreVehicleLabels[targetKey as CoreVehicleKey] || targetKey.replace(/^custom:/, "");
}

export function vehicleCatalog(records: VehicleRecordLike[], settings: VehicleClassSetting[], includeCore = true): VehicleCatalogItem[] {
  const labels = new Map<string, string>();
  if (includeCore) CORE_VEHICLE_KEYS.forEach(key => labels.set(key, coreVehicleLabels[key]));
  for (const record of records) {
    for (const key of Object.keys(effectiveVehicleCounts(record, settings))) labels.set(key, effectiveVehicleLabel(record, key, settings));
  }
  return [...labels].map(([key, label]) => ({ key, label })).sort((a, b) => {
    const ai = CORE_VEHICLE_KEYS.indexOf(a.key as CoreVehicleKey), bi = CORE_VEHICLE_KEYS.indexOf(b.key as CoreVehicleKey);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    return a.label.localeCompare(b.label, "zh-TW");
  });
}

/**
 * 讓「車種分類與新增當量」裡歸類到原四大類（機車／小型車／大型車／特種車）的列，
 * 永遠顯示外部「PCU 當量係數」目前的值。
 *
 * 這些列在介面上是鎖住不能改的，值本來是建立設定當下從係數複製過來的快照；
 * 使用者之後在外面把機車改成 0.42 並套用時，快照仍停在 0.5，就會出現
 * 「外面寫 0.42、裡面寫 0.5」的矛盾（實際計算一直是用外面的 0.42，
 * 因為 factorFor() 對四大類是直接讀 core 係數，不看快照）。
 * 這個函式把快照拉回與係數一致，讓顯示與計算是同一個來源。
 */
export function syncCoreVehicleSettings(
  settings: VehicleClassSetting[],
  core: CorePcuFactors,
  coreTurns: CoreTurnPcuFactors,
): VehicleClassSetting[] {
  return settings.map(setting => {
    if (!CORE_VEHICLE_KEYS.includes(setting.targetKey as CoreVehicleKey)) return setting;
    const key = setting.targetKey as CoreVehicleKey;
    const roadPcu = core[key];
    const turnPcu = { ...coreTurns[key] };
    if (
      setting.roadPcu === roadPcu &&
      (["left", "through", "right"] as TurnKey[]).every(turn => setting.turnPcu?.[turn] === turnPcu[turn])
    )
      return setting;
    return { ...setting, roadPcu, turnPcu };
  });
}

export function sumVehicleCounts(record: VehicleRecordLike) {
  return Object.values(rawVehicleCounts(record)).reduce((sum, count) => sum + safeCount(count), 0);
}

function factorFor(record: VehicleRecordLike, sourceKey: string, settings: VehicleClassSetting[], core: CorePcuFactors) {
  const setting = settingFor(record, sourceKey, settings);
  const targetKey = setting?.targetKey || sourceKey;
  if (CORE_VEHICLE_KEYS.includes(targetKey as CoreVehicleKey)) return core[targetKey as CoreVehicleKey];
  return setting?.roadPcu;
}

function turnFactorFor(record: VehicleRecordLike, sourceKey: string, turn: TurnKey, settings: VehicleClassSetting[], core: CoreTurnPcuFactors) {
  const setting = settingFor(record, sourceKey, settings);
  const targetKey = setting?.targetKey || sourceKey;
  if (CORE_VEHICLE_KEYS.includes(targetKey as CoreVehicleKey)) return core[targetKey as CoreVehicleKey][turn];
  return setting?.turnPcu?.[turn];
}

export function missingVehicleFactors(records: VehicleRecordLike[], settings: VehicleClassSetting[]) {
  const missing = new Map<string, string>();
  for (const record of records) {
    const labels = rawVehicleLabels(record);
    for (const [key, count] of Object.entries(rawVehicleCounts(record))) {
      if (!count || CORE_VEHICLE_KEYS.includes(key as CoreVehicleKey)) continue;
      const setting = settingFor(record, key, settings);
      // 係數允許 0 與負數（使用者可自訂，不設下限），所以這裡只檢查「有沒有設定」，
      // 不再要求 > 0；否則把四個係數都設成 0 的車種會被永遠標成「尚未設定」。
      const turnValues = Object.values(setting?.turnPcu ?? {});
      if (
        !setting ||
        !Number.isFinite(setting.roadPcu) ||
        turnValues.length < 3 ||
        !turnValues.every((value) => Number.isFinite(value))
      )
        missing.set(key, labels[key] || key.replace(/^custom:/, ""));
    }
  }
  return [...missing].map(([key, label]) => ({ key, label }));
}

export function sumVehiclePcu(record: VehicleRecordLike, core: CorePcuFactors, coreTurns: CoreTurnPcuFactors, settings: VehicleClassSetting[]) {
  const counts = rawVehicleCounts(record);
  if (record.surveyType === "intersection" && record.turnData) {
    return Object.keys(counts).reduce((total, sourceKey) => total + (["left", "through", "right"] as TurnKey[]).reduce((subtotal, turn) => {
      const factor = turnFactorFor(record, sourceKey, turn, settings, coreTurns);
      return subtotal + safeCount(record.turnData?.[sourceKey]?.[turn]) * (Number.isFinite(factor) ? Number(factor) : 0);
    }, 0), 0);
  }
  return Object.entries(counts).reduce((total, [sourceKey, count]) => {
    const factor = factorFor(record, sourceKey, settings, core);
    return total + safeCount(count) * (Number.isFinite(factor) ? Number(factor) : 0);
  }, 0);
}
