/**
 * 路口幾何與「駛入／駛出」流向換算。
 *
 * 從 DashboardClient 抽出來成為獨立模組，好處是這些純函式可以直接寫測試——
 * 「各支線的駛入量」牽涉到每一條支線的轉向分類，是最容易算錯又最難用眼睛
 * 看出來的部分，必須有測試守著。抽出時只搬移程式碼，沒有改變任何行為。
 */
import type {
  TurnCounts,
  TurnKey,
  VehicleKey,
} from "./traffic-parser.ts";
import { rawVehicleCounts, rawVehicleLabels } from "./vehicle-analysis.ts";

export type IntersectionArmSetting = {
  projectId: string;
  roadId: string;
  directionCode: string;
  name: string;
  angle: number;
  routes: Record<string, TurnKey>;
  position?: "北" | "東" | "南" | "西" | "自訂";
  leftTarget?: string;
  throughTarget?: string;
  rightTarget?: string;
};

/** 這個模組只需要用到紀錄的這幾個欄位。 */
export type FlowRecord = {
  projectId?: string;
  quarter: string;
  roadId: string;
  roadName: string;
  dayType: string;
  directionCode: string;
  directionName: string;
  hour: string;
  motorcycle: number;
  small: number;
  large: number;
  special: number;
  surveyType?: "road" | "intersection";
  turnData?: TurnCounts;
  vehicleCounts?: Record<string, number>;
  vehicleLabels?: Record<string, string>;
  destinationCounts?: Record<string, Record<string, number>>;
};

const CORE_VEHICLE_KEYS = ["motorcycle", "small", "large", "special"] as const;
type CoreVehicleKey = (typeof CORE_VEHICLE_KEYS)[number];

export function normalizeAngle(value: number) {
  return ((Number(value) % 360) + 360) % 360;
}

export function classifyMovement(fromAngle: number, toAngle: number): TurnKey {
  const opposite = fromAngle + 180;
  const difference = ((toAngle - opposite + 540) % 360) - 180;
  return Math.abs(difference) <= 45
    ? "through"
    : difference < 0
      ? "left"
      : "right";
}

export function emptyTurnCounts(): TurnCounts {
  return {
    motorcycle: { left: 0, through: 0, right: 0 },
    small: { left: 0, through: 0, right: 0 },
    large: { left: 0, through: 0, right: 0 },
    special: { left: 0, through: 0, right: 0 },
  };
}

export function targetField(
  turn: TurnKey,
): "leftTarget" | "throughTarget" | "rightTarget" {
  return turn === "left"
    ? "leftTarget"
    : turn === "through"
      ? "throughTarget"
      : "rightTarget";
}

export function signedOppositeDifference(fromAngle: number, toAngle: number) {
  return (
    ((normalizeAngle(toAngle) - normalizeAngle(fromAngle + 180) + 540) % 360) -
    180
  );
}
export function defaultArmAngle(index: number, count: number) {
  if (count === 3) return [-90, 0, 180][index] ?? 0;
  return -90 + (index * 360) / Math.max(1, count);
}

export function bestMovementTarget(
  source: IntersectionArmSetting,
  settings: IntersectionArmSetting[],
  turn: TurnKey,
) {
  const ideal = turn === "left" ? -90 : turn === "right" ? 90 : 0;
  return (
    settings
      .filter(
        (target) =>
          target.directionCode !== source.directionCode &&
          (source.routes[target.directionCode] ??
            classifyMovement(source.angle, target.angle)) === turn,
      )
      .map((target) => ({
        code: target.directionCode,
        score: Math.abs(
          signedOppositeDifference(source.angle, target.angle) - ideal,
        ),
      }))
      .sort((a, b) => a.score - b.score || a.code.localeCompare(b.code))[0]
      ?.code ?? ""
  );
}
export function completeArmTargets(
  settings: IntersectionArmSetting[],
  overwrite = false,
) {
  return settings.map((source) => {
    const next = { ...source };
    (["left", "through", "right"] as TurnKey[]).forEach((turn) => {
      const field = targetField(turn);
      const hasSavedTarget = Object.prototype.hasOwnProperty.call(
        source,
        field,
      );
      const current = source[field];
      next[field] =
        !overwrite && hasSavedTarget
          ? current &&
            settings.some(
              (target) =>
                target.directionCode === current &&
                target.directionCode !== source.directionCode,
            )
            ? current
            : ""
          : bestMovementTarget(source, settings, turn);
    });
    return next;
  });
}
export function buildArmSettings(
  projectId: string,
  roadId: string,
  directionCodes: string[],
  savedSettings: IntersectionArmSetting[],
) {
  const base = directionCodes.sort().map((directionCode, index) => {
    const saved = savedSettings.find(
      (setting) =>
        setting.projectId === projectId &&
        setting.roadId === roadId &&
        setting.directionCode === directionCode,
    );
    const angle = Number.isFinite(saved?.angle)
      ? Number(saved?.angle)
      : (legacyAngle(saved?.position) ??
        defaultArmAngle(index, directionCodes.length));
    const routes = { ...(saved?.routes ?? {}) };
    if (saved?.leftTarget) routes[saved.leftTarget] = "left";
    if (saved?.throughTarget) routes[saved.throughTarget] = "through";
    if (saved?.rightTarget) routes[saved.rightTarget] = "right";
    return {
      projectId,
      roadId,
      directionCode,
      name: saved?.name || `路口${directionCode}`,
      angle,
      routes,
      ...(saved && Object.prototype.hasOwnProperty.call(saved, "leftTarget")
        ? { leftTarget: saved.leftTarget }
        : {}),
      ...(saved && Object.prototype.hasOwnProperty.call(saved, "throughTarget")
        ? { throughTarget: saved.throughTarget }
        : {}),
      ...(saved && Object.prototype.hasOwnProperty.call(saved, "rightTarget")
        ? { rightTarget: saved.rightTarget }
        : {}),
    } satisfies IntersectionArmSetting;
  });
  base.forEach((source) =>
    base
      .filter((target) => target.directionCode !== source.directionCode)
      .forEach((target) => {
        if (!source.routes[target.directionCode])
          source.routes[target.directionCode] = classifyMovement(
            source.angle,
            target.angle,
          );
      }),
  );
  return completeArmTargets(base);
}
/**
 * 目的支線分欄格式（往B、往C…）的調查表沒有左轉／直進／右轉欄位，
 * 這裡依各支線的角度，把每一個目的地歸類成左轉、直行或右轉，
 * 之後所有分析、PCU 換算與匯出都與既有的路口格式完全一致。
 *
 * 分類結果不寫死在資料裡：使用者之後在「路口幾何」調整角度或駛出對應，
 * 下一次計算就會依新的幾何重新分類，不需要重新匯入。
 */

export function deriveDestinationIntersectionRecords<T extends FlowRecord>(
  records: T[],
  projectId: string,
  savedSettings: IntersectionArmSetting[],
): T[] {
  const roads = new Map<string, FlowRecord[]>();
  records
    .filter((record) => record.surveyType === "intersection" || record.turnData)
    .forEach((record) =>
      roads.set(record.roadId, [...(roads.get(record.roadId) ?? []), record]),
    );
  const armMaps = new Map<string, Map<string, IntersectionArmSetting>>();
  roads.forEach((rows, roadId) => {
    const codes = [...new Set(rows.map((record) => record.directionCode))];
    armMaps.set(
      roadId,
      new Map(
        buildArmSettings(projectId, roadId, codes, savedSettings).map(
          (setting) => [setting.directionCode, setting],
        ),
      ),
    );
  });
  const output = new Map<string, T>();
  records.forEach((record) => {
    if (record.surveyType !== "intersection" && !record.turnData) {
      const key = `road|${record.projectId ?? projectId}|${record.quarter}|${record.roadId}|${record.dayType}|${record.directionCode}|${record.hour}`;
      output.set(key, record);
      return;
    }
    const source = armMaps.get(record.roadId)?.get(record.directionCode);
    const turnData = record.turnData ?? emptyTurnCounts();
    const sourceVehicleCounts = rawVehicleCounts(record);
    const sourceVehicleLabels = rawVehicleLabels(record);
    const addCount = (
      vehicle: VehicleKey,
      turn: TurnKey,
      count: number,
      requestedTarget?: string,
    ) => {
      if (!count) return;
      const targetCode =
        requestedTarget && armMaps.get(record.roadId)?.has(requestedTarget)
          ? requestedTarget
          : "UNMAPPED";
      const target =
        targetCode === "UNMAPPED"
          ? undefined
          : armMaps.get(record.roadId)?.get(targetCode);
      const key = `intersection|${record.projectId ?? projectId}|${record.quarter}|${record.roadId}|${record.dayType}|${targetCode}|${record.hour}`;
      const current = output.get(key) ?? {
        ...record,
        directionCode: targetCode,
        directionName:
          targetCode === "UNMAPPED"
            ? "未指定駛入路口"
            : `駛入路口${targetCode}${target?.name && target.name !== `路口${targetCode}` ? `（${target.name}）` : ""}`,
        motorcycle: 0,
        small: 0,
        large: 0,
        special: 0,
        surveyType: "intersection" as const,
        turnData: emptyTurnCounts(),
        vehicleCounts: {},
        vehicleLabels: { ...sourceVehicleLabels },
      };
      current.vehicleCounts = current.vehicleCounts ?? {};
      current.vehicleCounts[vehicle] =
        (current.vehicleCounts[vehicle] ?? 0) + count;
      if (CORE_VEHICLE_KEYS.includes(vehicle as CoreVehicleKey))
        current[vehicle as CoreVehicleKey] += count;
      if (current.turnData) {
        current.turnData[vehicle] = current.turnData[vehicle] ?? {
          left: 0,
          through: 0,
          right: 0,
        };
        current.turnData[vehicle][turn] += count;
      }
      output.set(key, current);
    };
    // 原始檔若逐欄記錄了「往B、往C、往D…」，就照實際目的地分配。
    //
    // 舊版一律用「左轉→leftTarget、直行→throughTarget、右轉→rightTarget」，
    // 也就是每一種轉向只能有一個目的支線。三叉、十字路口成立，但五叉以上
    // 不成立：七叉路口的 A 左轉可能同時通往 B、C、D，全部被塞進同一個目的
    // 支線之後，各支線的駛入量就會嚴重失真（雖然總計仍然正確）。
    if (record.destinationCounts) {
      Object.entries(record.destinationCounts).forEach(([vehicle, byDestination]) => {
        Object.entries(byDestination ?? {}).forEach(([destination, count]) => {
          const turn: TurnKey = source?.routes?.[destination] ?? "through";
          addCount(vehicle, turn, Number(count) || 0, destination);
        });
      });
      return;
    }
    Object.keys(sourceVehicleCounts).forEach((vehicle) => {
      let distributed = 0;
      (["left", "through", "right"] as TurnKey[]).forEach((turn) => {
        const count = turnData[vehicle]?.[turn] ?? 0;
        distributed += count;
        addCount(vehicle, turn, count, source?.[targetField(turn)]);
      });
      /*
       * 總量比轉向明細多出來的部分＝「有這些車，但不知道它們往哪去」，
       * 補進「未指定駛入路口」。
       *
       * 但**不到 1 輛的差額是四捨五入的雜訊，不是車**。
       * 舊版匯入的紀錄，四大類欄位是四捨五入後的整數而轉向明細是原始值
       * （12 對 12.36），逐時逐支線都會產生這種零頭；而這裡是
       * `Math.max(0, …)`——只補正的、不扣負的，於是雜訊會**單向累積**。
       * 實測某路口因此讓「駛入」合計比「駛出」多出 22 輛：同一批車，
       * 換一種分組方式總量就變了，那不可能是對的。
       *
       * 真正「只記總量、沒有轉向明細」的資料，差額一定是整車數，
       * 不會卡在 0.45 這種地方，所以這道門檻擋不到它。
       */
      const undistributed = Math.max(
        0,
        (sourceVehicleCounts[vehicle] ?? 0) - distributed,
      );
      if (undistributed >= 1) addCount(vehicle, "through", undistributed);
    });
  });
  return [...output.values()];
}

export function legacyAngle(position?: IntersectionArmSetting["position"]) {
  return ({ 北: -90, 東: 0, 南: 90, 西: 180 } as Record<string, number>)[
    position ?? ""
  ];
}
