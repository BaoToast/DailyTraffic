import { coreVehicleLabels, type CoreVehicleKey, type TurnCounts, type TurnKey, type VehicleCounts, type VehicleLabels } from "./traffic-parser.ts";
import { resolveFactors, type FactorScope } from "./factor-scope.ts";

export const CORE_VEHICLE_KEYS: CoreVehicleKey[] = ["motorcycle", "small", "large", "special"];

export type VehicleClassSetting = {
  projectId: string;
  sourceKey: string;
  sourceLabel: string;
  targetKey: string;
  targetLabel: string;
  roadPcu: number;
  turnPcu: Record<TurnKey, number>;
  /*
   * ⚠️ 季別／路段覆寫（使用者 2026-09-30 裁示的 B2）。**兩個都是選填**：
   *   沒寫（undefined）或寫空字串都代表「這個計畫的預設歸類」，
   *   行為與改版前完全相同。解析順位見 settingFor() 上面那一段。
   *   舊存檔沒有這兩個欄位，讀進來是 undefined，所以不可以改成必填。
   */
  quarter?: string;
  roadId?: string;
};

export type VehicleRecordLike = {
  projectId?: string;
  /*
   * ⚠️ quarter 與 roadId 是「係數依季別／路段覆寫」用的。
   *   兩個都是**選填**：舊的呼叫端（測試裡的簡化物件）不帶也不會壞，
   *   讀不到就一律落回計畫預設係數——也就是改版前的行為。
   */
  quarter?: string;
  roadId?: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  surveyType?: "road" | "intersection";
  turnData?: TurnCounts;
  vehicleCounts?: VehicleCounts;
  vehicleLabels?: VehicleLabels;
};

/**
 * 依季別／路段覆寫的係數。
 *
 * ⚠️ **一律選填**。整個系統沒有任何一個地方「必須」傳它，
 *   沒傳就等於沒有覆寫，行為與改版前一模一樣。
 *   這一點由 tests/factor-scope-integration.test.mjs 的 A 段守著。
 */
export type PcuScopeFactors = {
  core: CorePcuFactors;
  coreTurns: CoreTurnPcuFactors;
};
export type PcuScopes = FactorScope<PcuScopeFactors>[];

/**
 * 這一筆紀錄實際要用的一般係數與轉向係數。
 *
 * ⚠️ 全系統只有這一支決定「哪一筆用哪一組」。分散判斷的話，
 *   遲早會出現「總量那一格」與「時段分析那一格」用了不同係數——
 *   那正是 v20.33 合併兩份 PCU 實作時修過的那一類問題。
 */
export function factorsForRecord(
  record: VehicleRecordLike,
  core: CorePcuFactors,
  coreTurns: CoreTurnPcuFactors,
  scopes?: PcuScopes | null,
): PcuScopeFactors {
  if (!scopes || !scopes.length) return { core, coreTurns };
  return resolveFactors(
    scopes,
    { core, coreTurns },
    record.quarter || "",
    record.roadId || "",
  );
}

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

/*
 * ══════════════════════════════════════════════════════════════════════
 *  歸類設定的解析順位：季別×路段 > 季別 > 路段 > 計畫預設
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 裁示：車種歸類可以依「季別×路段」覆寫。
 *
 * ⚠️ 兩道自保，與 B1（異常門檻覆寫）同一套，理由也同一個：
 *   ① `quarter`／`roadId` **一律選填**。沒有任何設定帶這兩個欄位時，
 *      走的是**完全相同**的那一行 `find()`，輸出逐位元不變。
 *      （黃金值由 tests/vehicle-scope-golden.test.mjs 釘住。）
 *   ② 空字串與 undefined **等義**：舊存檔沒有這兩個欄位，
 *      畫面上選「全季別／全路段」則是空字串。兩種都要落回計畫預設，
 *      不可以變成「找不到設定」而讓那個車種掉成未分類——
 *      掉成未分類不會報錯，只會讓某一類的數字安靜少掉一塊。
 *
 * ⚠️ 順位是**季別優先**（與 factor-scope.ts 的 resolveFactors 相同）。
 *   兩邊順位不一致的話，同一筆資料的「歸類」與「當量係數」會來自不同
 *   的覆寫組合——那種錯只會讓數字偏掉一點，沒有人看得出來。
 *
 * ⚠️ 這裡刻意**不引用 factor-scope 的 resolveFactors**：那一支解的是
 *   「一整組係數」，這裡解的是「一個車種對到哪一類」，鍵還多一個 sourceKey。
 *   硬套會讓兩邊互相牽制。順位規則以下面這張表為準，並由
 *   tests/vehicle-scope.test.mjs 逐條釘住。
 */
function scopeText(value: string | undefined | null) {
  return String(value ?? "").trim();
}
/** 這一筆設定適用於這一筆紀錄嗎（不看順位，只看適不適用）。 */
function scopeApplies(setting: VehicleClassSetting, record: VehicleRecordLike) {
  const quarter = scopeText(setting.quarter);
  const roadId = scopeText(setting.roadId);
  if (quarter && quarter !== scopeText(record.quarter)) return false;
  if (roadId && roadId !== scopeText(record.roadId)) return false;
  return true;
}
/** 愈具體分數愈高：季別×路段 3 ＞ 季別 2 ＞ 路段 1 ＞ 計畫預設 0。 */
function scopeRank(setting: VehicleClassSetting) {
  const quarter = scopeText(setting.quarter) ? 1 : 0;
  const roadId = scopeText(setting.roadId) ? 1 : 0;
  if (quarter && roadId) return 3;
  if (quarter) return 2;
  if (roadId) return 1;
  return 0;
}
/**
 * 從一批設定裡挑出這一筆紀錄該用的那一個。
 *
 * ⚠️ 同分時取**先出現**的那一個（`>` 不是 `>=`），與改版前 `find()`
 *   的行為一致——改版前同一個 sourceKey 有兩筆設定時取的就是第一筆。
 */
function mostSpecific(matches: VehicleClassSetting[]) {
  let best: VehicleClassSetting | undefined;
  let bestRank = -1;
  for (const setting of matches) {
    const rank = scopeRank(setting);
    if (rank > bestRank) {
      best = setting;
      bestRank = rank;
    }
  }
  return best;
}

export function settingFor(record: VehicleRecordLike, sourceKey: string, settings: VehicleClassSetting[]) {
  const projectId = String(record.projectId ?? "");
  return mostSpecific(
    settings.filter(
      setting =>
        setting.projectId === projectId &&
        setting.sourceKey === sourceKey &&
        scopeApplies(setting, record),
    ),
  );
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
  /*
   * ⚠️ 這裡查的鍵是 targetKey（不是 sourceKey），但**順位必須與 settingFor 一致**。
   *   不一致的後果很難看出來：同一筆資料的數字走季別覆寫那一組、
   *   顯示名稱卻走計畫預設那一組，圖上會出現「大客車」的標籤配著
   *   已經被歸到特種車的數字。
   */
  const projectId = String(record.projectId ?? "");
  const setting = mostSpecific(
    settings.filter(
      item => item.projectId === projectId && item.targetKey === targetKey && scopeApplies(item, record),
    ),
  );
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

/**
 * 一筆紀錄的 PCU，**依歸類後的車種分開列出**——全系統只有這一支。
 *
 * 規則（兩種原始檔格式各一條路徑）：
 * ・路口轉向格式（有 turnData）走**轉向係數**，左／直／右各自乘上自己的當量。
 * ・其餘（路段格式）走**一般係數**。
 * 歸類回四大類的車種，讀的是**外部的 PCU 係數**（core / coreTurns），
 * 不是建立設定當下的快照——否則使用者之後調整了係數，那幾列會停在舊值。
 * 自訂車種讀使用者自己給的設定；完全沒有設定時算成 0，
 * 並由 missingVehicleFactors() 在畫面上提醒「尚未設定」。
 *
 * ⚠️ 這支函式原本有**兩份實作**：這裡的 sumVehiclePcu()，以及
 * period-analysis.ts 的 vehiclePcuBreakdown()。兩份規則相同、各自維護。
 * 它們沒有出過錯，但一份改了另一份沒改，畫面上就會出現「總量那一格」與
 * 「時段分析那一格」對不起來——**而且只有自訂車種會不一樣**，
 * 是最不容易被發現的那種。v20.33 合併成這一支，
 * period-analysis 的 vehiclePcuBreakdown() 改為直接轉呼叫它。
 */
export function vehiclePcuByTarget(
  record: VehicleRecordLike,
  core: CorePcuFactors,
  coreTurns: CoreTurnPcuFactors,
  settings: VehicleClassSetting[],
  /*
   * ⚠️ 選填。不傳＝沒有任何範圍覆寫＝改版前的行為，一個數字都不會變。
   *   這是整個「依季別／路段設定」改版的相容性保證所在。
   */
  scopes?: PcuScopes | null,
): Record<string, number> {
  /*
   * ⚠️ 解析**一次**就好，而且是在迴圈外。
   *   放進迴圈的話每一個車種都會重算一次同一件事；更糟的是，
   *   如果哪天有人不小心把 sourceKey 混進解析條件，
   *   同一筆紀錄的不同車種就會用到不同組係數——那種錯無聲無息。
   */
  const applied = factorsForRecord(record, core, coreTurns, scopes);
  const counts = rawVehicleCounts(record);
  const byTurn = record.surveyType === "intersection" && Boolean(record.turnData);
  const result: Record<string, number> = {};
  for (const sourceKey of Object.keys(counts)) {
    const setting = settingFor(record, sourceKey, settings);
    const targetKey = setting?.targetKey || sourceKey;
    let value = 0;
    if (byTurn) {
      for (const turn of ["left", "through", "right"] as TurnKey[]) {
        const factor = turnFactorFor(record, sourceKey, turn, settings, applied.coreTurns);
        value += safeCount(record.turnData?.[sourceKey]?.[turn]) * (Number.isFinite(factor) ? Number(factor) : 0);
      }
    } else {
      const factor = factorFor(record, sourceKey, settings, applied.core);
      value = safeCount(counts[sourceKey]) * (Number.isFinite(factor) ? Number(factor) : 0);
    }
    result[targetKey] = (result[targetKey] ?? 0) + value;
  }
  return result;
}

export function sumVehiclePcu(
  record: VehicleRecordLike,
  core: CorePcuFactors,
  coreTurns: CoreTurnPcuFactors,
  settings: VehicleClassSetting[],
  scopes?: PcuScopes | null,
) {
  return Object.values(
    vehiclePcuByTarget(record, core, coreTurns, settings, scopes),
  ).reduce((sum, value) => sum + value, 0);
}

/**
 * 這一筆有沒有「任何一個車種的 PCU 貢獻不是 0」。
 *
 * ⚠️ 這是判斷「當量係數設定過沒有」的唯一正確證據，`sumVehiclePcu()` 不是。
 *   使用者可以把某個車種的係數設成**負數**（系統允許、也有人真的這樣用），
 *   於是同一筆裡 +X 與 −X 互相抵銷，合計變成 0 或負數，而係數其實設好了。
 *   拿合計去判斷會得到「係數全為 0」這個錯的結論，然後：
 *     ・「資料異常檢查」列出「PCU係數全為0」並把尖峰欄遮成「待設定 PCU 係數」
 *     ・「時段車種分析」那一端卻算得出正常的尖峰
 *   同一筆資料在同一個畫面上有兩個答案（2026-09-26 抓到）。
 *
 * ⚠️ 用 `!== 0` 不是 `> 0`：負係數是使用者刻意設的，一樣算「設定過」。
 * ⚠️ 先 `Number.isFinite` 擋掉 NaN／Infinity——那不是「設定過」的證據。
 */
export function hasNonZeroVehiclePcu(
  record: VehicleRecordLike,
  core: CorePcuFactors,
  coreTurns: CoreTurnPcuFactors,
  settings: VehicleClassSetting[],
  scopes?: PcuScopes | null,
) {
  return Object.values(
    vehiclePcuByTarget(record, core, coreTurns, settings, scopes),
  ).some((value) => Number.isFinite(value) && Number(value) !== 0);
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  歸類在比較區間內變過嗎——**圖上一定要標出來的那件事**
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-30 裁示做「車種歸類依季別×路段覆寫」時，同一句話裡就交代了：
 *   「**圖上當然也要明白標出來**」。
 *
 * ⚠️ 為什麼這件事非標不可（這是整個 B2 唯一真正的高風險）：
 *   115Q1 把小貨車歸到小型車、115Q2 歸到大型車，歷季趨勢圖上「大型車」
 *   就會暴增，**而實際車流一輛都沒變**——只是歸類換了。
 *   圖只畫數字，看不出來；使用者會把那個假的成長寫進報告。
 *
 * ⚠️ 判準是「**同一個原始車種在畫面上這批資料裡被歸到不同的分析類別**」，
 *   不是「有沒有設覆寫」。設了覆寫但兩季都歸到同一類，數字是可比的，
 *   標它只會變成雜訊——**恆亮的標註等於沒有標註**，第三次之後沒有人會看。
 *
 * ⚠️ 跨季別與跨路段都要分別講清楚：
 *   跨季別＝趨勢不可比；跨路段＝同一張圖上兩條路的同一類不是同一件事。
 */
export type ClassificationChange = {
  /** 原始車種的鍵與名稱（使用者在檔案裡看到的那個名字）。 */
  sourceKey: string;
  sourceLabel: string;
  /** 這個原始車種在這批資料裡被歸到的每一類，以及各自出現在哪些季別／路段。 */
  groups: {
    targetKey: string;
    targetLabel: string;
    quarters: string[];
    roadIds: string[];
  }[];
  /** 差異出現在季別之間嗎。 */
  acrossQuarters: boolean;
  /** 差異出現在路段之間嗎。 */
  acrossRoads: boolean;
};

/**
 * 畫面上這批紀錄裡，有哪些原始車種的歸類不一致。
 *
 * ⚠️ 純函式、不碰 DOM：三處呈現（畫面標註、圖旁說明、Excel 旁欄）
 *   全部從這一份結果長出來，才不會三處各寫一套而互相矛盾。
 */
export function classificationChangesAcross(
  records: VehicleRecordLike[],
  settings: VehicleClassSetting[],
): ClassificationChange[] {
  /* sourceKey → targetKey → { quarters, roadIds } */
  const seen = new Map<
    string,
    { label: string; targets: Map<string, { label: string; quarters: Set<string>; roadIds: Set<string> }> }
  >();
  for (const record of records ?? []) {
    const labels = rawVehicleLabels(record);
    for (const sourceKey of Object.keys(rawVehicleCounts(record))) {
      const setting = settingFor(record, sourceKey, settings);
      const targetKey = setting?.targetKey || sourceKey;
      const entry =
        seen.get(sourceKey) ??
        (() => {
          const fresh = {
            label:
              labels[sourceKey] ||
              coreVehicleLabels[sourceKey as CoreVehicleKey] ||
              sourceKey.replace(/^custom:/, ""),
            targets: new Map<string, { label: string; quarters: Set<string>; roadIds: Set<string> }>(),
          };
          seen.set(sourceKey, fresh);
          return fresh;
        })();
      const target =
        entry.targets.get(targetKey) ??
        (() => {
          const fresh = {
            label: effectiveVehicleLabel(record, targetKey, settings),
            quarters: new Set<string>(),
            roadIds: new Set<string>(),
          };
          entry.targets.set(targetKey, fresh);
          return fresh;
        })();
      const quarter = String(record.quarter ?? "").trim();
      const roadId = String(record.roadId ?? "").trim();
      if (quarter) target.quarters.add(quarter);
      if (roadId) target.roadIds.add(roadId);
    }
  }
  const changes: ClassificationChange[] = [];
  for (const [sourceKey, entry] of seen) {
    if (entry.targets.size < 2) continue;
    const groups = [...entry.targets].map(([targetKey, target]) => ({
      targetKey,
      targetLabel: target.label,
      quarters: [...target.quarters].sort(),
      roadIds: [...target.roadIds].sort(),
    }));
    /*
     * ⚠️ 「跨季別」的判準不是「兩組的季別集合不同」，而是
     *   **同一個季別有沒有出現在兩組以上**的反面：
     *   某一季只出現在 A 組、另一季只出現在 B 組 → 跨季別（趨勢不可比）。
     *   同一季同時出現在兩組 → 那是同一季內不同路段的差異，不是跨季別。
     */
    const quarterOwners = new Map<string, Set<string>>();
    const roadOwners = new Map<string, Set<string>>();
    for (const group of groups) {
      for (const quarter of group.quarters)
        (quarterOwners.get(quarter) ?? quarterOwners.set(quarter, new Set()).get(quarter)!).add(group.targetKey);
      for (const roadId of group.roadIds)
        (roadOwners.get(roadId) ?? roadOwners.set(roadId, new Set()).get(roadId)!).add(group.targetKey);
    }
    // 保留逐點／逐季關聯：兩點跨季互換時，集合完全相同仍不可比較。
    const targetsByRoad = new Map<string, { quarters: Set<string>; targets: Set<string> }>();
    const targetsByQuarter = new Map<string, { roads: Set<string>; targets: Set<string> }>();
    for (const record of records) {
      if (!Object.hasOwn(rawVehicleCounts(record), sourceKey)) continue;
      const road = String(record.roadId ?? "").trim();
      const quarter = String(record.quarter ?? "").trim();
      const target = settingFor(record, sourceKey, settings)?.targetKey || sourceKey;
      if (!road || !quarter) continue;
      const byRoad = targetsByRoad.get(road) ?? { quarters: new Set<string>(), targets: new Set<string>() };
      byRoad.quarters.add(quarter); byRoad.targets.add(target); targetsByRoad.set(road, byRoad);
      const byQuarter = targetsByQuarter.get(quarter) ?? { roads: new Set<string>(), targets: new Set<string>() };
      byQuarter.roads.add(road); byQuarter.targets.add(target); targetsByQuarter.set(quarter, byQuarter);
    }
    const roadChangedAcrossQuarters = [...targetsByRoad.values()].some(group => group.quarters.size > 1 && group.targets.size > 1);
    const quarterChangedAcrossRoads = [...targetsByQuarter.values()].some(group => group.roads.size > 1 && group.targets.size > 1);
    const acrossQuarters = Boolean(roadChangedAcrossQuarters) ||
      (quarterOwners.size > 1 && [...quarterOwners.values()].some(set => set.size === 1));
    const acrossRoads = Boolean(quarterChangedAcrossRoads) ||
      (roadOwners.size > 1 && [...roadOwners.values()].some(set => set.size === 1));
    changes.push({
      sourceKey,
      sourceLabel: entry.label,
      groups: groups.sort((a, b) => a.targetKey.localeCompare(b.targetKey)),
      acrossQuarters,
      acrossRoads,
    });
  }
  return changes.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey));
}

/**
 * 把上面那份結果寫成人看的句子。
 *
 * ⚠️ 三處呈現共用這一支，只差外面的容器：
 *   ・畫面上的圖 → 畫在**畫布外面**的標註（所以高解析圖檔天生乾淨）
 *   ・圖旁說明   → 多一行
 *   ・Excel      → 寫在**一旁的欄位**（使用者 2026-09-30 指定）
 *
 * ⚠️ 一定要寫出「數字不可比」這個後果。只說「歸類有變更」的話，
 *   使用者不會知道那代表趨勢圖上的成長可能是假的。
 */
export function classificationChangeLines(changes: ClassificationChange[]): string[] {
  const lines: string[] = [];
  for (const change of changes ?? []) {
    const parts = change.groups.map(group => {
      const where = [
        group.quarters.length ? group.quarters.join("、") : "",
        group.roadIds.length ? `路段 ${group.roadIds.join("、")}` : "",
      ]
        .filter(Boolean)
        .join("／");
      return `${group.targetLabel}（${where || "未標明期別"}）`;
    });
    const scope = [
      change.acrossQuarters ? "不同季別之間" : "",
      change.acrossRoads ? "不同路段之間" : "",
    ]
      .filter(Boolean)
      .join("與");
    lines.push(
      `原始車種「${change.sourceLabel}」在${scope || "這批資料裡"}被歸到不同的分析類別：` +
        `${parts.join("；")}。` +
        `這一類的數字在${change.acrossQuarters ? "歷季之間" : "這幾條路段之間"}不可以直接比較——` +
        `車流沒有變、只是歸類換了，圖上一樣會看到增減。`,
    );
  }
  return lines;
}
