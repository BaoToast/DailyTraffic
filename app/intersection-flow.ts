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

/**
 * 這一批匯入的資料裡，有哪些路口是**還沒有設定過**幾何的。
 *
 * 為什麼需要：舊版只要匯入的資料裡有任何一筆路口，就無條件跳出
 * 「多支線角度、轉向圖與流向確認」。但角度與流向的設定是存成
 * （計畫、路口、支線）三層鍵值、**跟季度無關**的，第一季設好之後
 * 後面每一季都沿用同一份。使用者第二季、第三季再匯入時，那個視窗
 * 每次都跳出來，而裡面沒有任何一項需要改——實測回報就是這個情形。
 *
 * 判斷做在**支線**這一層而不是路口這一層：同一個路口日後多出一支新支線時
 * （例如原本三岔後來變四岔），那支新的沒有設定過，仍然要跳出來問，
 * 不可以無聲地套一個預設角度上去。
 *
 * 回傳「還沒設定過的路口 roadId」，依匯入順序，不重複。
 */
export function unconfiguredIntersectionRoads(
  records: FlowRecord[],
  projectId: string,
  savedSettings: IntersectionArmSetting[],
): string[] {
  const armsByRoad = new Map<string, Set<string>>();
  for (const record of records) {
    if (record.surveyType !== "intersection" && !record.turnData) continue;
    const arms = armsByRoad.get(record.roadId) ?? new Set<string>();
    arms.add(record.directionCode);
    armsByRoad.set(record.roadId, arms);
  }
  const out: string[] = [];
  for (const [roadId, arms] of armsByRoad) {
    const missing = [...arms].some(
      (directionCode) =>
        !savedSettings.some(
          (setting) =>
            setting.projectId === projectId &&
            setting.roadId === roadId &&
            setting.directionCode === directionCode,
        ),
    );
    if (missing) out.push(roadId);
  }
  return out;
}

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

/* ══════════════════════════════════════════════════════════════════
 * 用調查表的橫線位置反推路口幾何
 * ══════════════════════════════════════════════════════════════════
 *
 * ── 為什麼需要這一段（實測出來的問題）───────────────────────
 *
 * 三岔路口的預設角度是 defaultArmAngle(index, 3) ＝ [-90, 0, 180]。
 * 用這組角度跑 classifyMovement()／bestMovementTarget() 會得到：
 *
 *     路口A(-90°)：左轉→B　直進→**沒有目的地**　右轉→C
 *     路口B(  0°)：左轉→**沒有目的地**　直進→C　右轉→A
 *     路口C(180°)：左轉→A　直進→B　右轉→**沒有目的地**
 *
 * 也就是預設幾何認為「A 沒有直進、B 沒有左轉、C 沒有右轉」。
 *
 * 但三份實際三岔調查檔寫的是**完全相反的一組**：
 * 一致是「**A 沒有右轉、B 沒有直進、C 沒有左轉**」。交付原始碼只保留
 * 匿名化後的結構與測值，不保留客戶路名或原始檔。
 *
 * 兩者對不起來的後果：A 的直進車流沒有目的地，整批被歸到 UNMAPPED
 *（畫面上的「未指定駛入路口」）。實測某三岔路口 AM 5,831 輛中有
 * 3,612 輛、**62%** 掉進去。總量守恆（不會多算也不會少算），
 * 但 OD 歸屬是錯的。使用者必須自己到「多支線角度、轉向圖與流向確認」
 * 把角度改對，才會正確——而預設值本來就與檔案內容矛盾。
 *
 * ── 反推的依據 ─────────────────────────────────────────────
 *
 * 兩個條件就足以把三岔的拓樸解成**唯一解**：
 *
 *   (1) 調查表畫橫線的位置＝這個轉向不存在（`0` 是存在但沒車，不算）。
 *   (2) 轉向互為對稱：A 直進到 B ⇔ B 直進到 A；A 左轉到 B ⇔ B 右轉到 A。
 *       （標準路口幾何，左轉的反向一定是右轉。）
 *
 * 以真實形狀 A{左,直}、B{左,右}、C{直,右} 推：
 *   ・直進必須成對，只有 A 與 C 有直進 → A↔C 直進。
 *   ・A 剩下左轉 → A 左轉→B；由對稱得 B 右轉→A（B 有右轉 ✓）。
 *   ・C 剩下右轉 → C 右轉→B；由對稱得 B 左轉→C（B 有左轉 ✓）。
 * 完全自洽，沒有第二組解。
 *
 * ── 刻意的限制 ─────────────────────────────────────────────
 *
 * 只在**每一支支線的「存在的轉向數」剛好等於去向數**時才反推。
 *   ・三岔：2 個存在的轉向、2 個去向 → 可以反推（就是上面那個情形）。
 *   ・四岔而且沒有任何橫線：3 個轉向、3 個去向，但調查表沒有提供任何
 *     額外資訊，解不只一組 → **不反推**，維持原本的預設角度。
 *   ・五岔以上：轉向欄只有三個、去向卻有四個以上，本來就蓋不滿 → 不反推。
 * 解出來不唯一時一律回傳 null。**寧可不給，也不要給一個猜的幾何。**
 *
 * ⚠️ 反推的結果是**預填**，不是自動定案：匯入時仍然會跳出
 *    「多支線角度、轉向圖與流向確認」請使用者確認，這是使用者的明確要求。
 */

/** 一支支線的轉向盤點：哪些轉向不存在（畫橫線）、哪些整欄空白。 */
export type ArmTurnAudit = {
  directionCode: string;
  /** 調查表上這支支線印了幾個轉向欄。 */
  movementCount: number;
  /** 這支支線可以去幾個地方＝支線數 − 1。 */
  destinationCount: number;
  /** 依算術應該有幾個轉向不存在。 */
  expectedAbsent: number;
  /** 整欄畫橫線（調查員明寫「沒有這個轉向」）。 */
  absent: TurnKey[];
  /** 整欄空白（既沒數字也沒橫線，分不出來）。 */
  blank: TurnKey[];
};

const ALL_TURNS: TurnKey[] = ["left", "through", "right"];

/** 轉向的中文名稱，只用於畫面與提醒訊息。 */
export const TURN_LABELS: Record<TurnKey, string> = {
  left: "左轉",
  through: "直進",
  right: "右轉",
};

/** 轉向的反向：左轉的反向是右轉，直進的反向還是直進。 */
function oppositeTurn(turn: TurnKey): TurnKey {
  return turn === "left" ? "right" : turn === "right" ? "left" : "through";
}

/**
 * 從解析結果盤點每一支支線的轉向。
 *
 * 一個轉向要「整份調查一格數字都沒有」才算不存在——只要任何一個時段、
 * 任何一個車種寫了數字（含 0）就代表它存在。四岔與七岔的真實檔各有 6～9 欄
 * 是**真的整天量到 0**，只憑「全為 0」判斷會把真實資料刪掉。
 */
export function auditArmTurns(
  records: Array<{
    roadId: string;
    directionCode: string;
    surveyType?: string;
    turnTally?: Record<TurnKey, { numeric: number; placeholder: number }>;
  }>,
  roadId: string,
): ArmTurnAudit[] {
  const mine = records.filter(
    (record) =>
      record.roadId === roadId &&
      record.surveyType === "intersection" &&
      record.turnTally,
  );
  const codes = [...new Set(mine.map((record) => record.directionCode))].sort();
  const destinationCount = Math.max(0, codes.length - 1);
  return codes.map((directionCode) => {
    const rows = mine.filter((record) => record.directionCode === directionCode);
    const sum = (turn: TurnKey, field: "numeric" | "placeholder") =>
      rows.reduce(
        (total, record) => total + (record.turnTally?.[turn]?.[field] ?? 0),
        0,
      );
    /* 這支支線印了哪些轉向欄：出現過任何一格內容（數字或橫線）就算印了。 */
    const printed = ALL_TURNS.filter(
      (turn) => sum(turn, "numeric") + sum(turn, "placeholder") > 0,
    );
    return {
      directionCode,
      movementCount: printed.length,
      destinationCount,
      expectedAbsent: Math.max(0, printed.length - destinationCount),
      absent: printed.filter(
        (turn) => sum(turn, "numeric") === 0 && sum(turn, "placeholder") > 0,
      ),
      blank: ALL_TURNS.filter(
        (turn) => sum(turn, "numeric") === 0 && sum(turn, "placeholder") === 0,
      ),
    };
  });
}

/**
 * 由盤點結果反推「哪個轉向通往哪一支支線」。
 *
 * 回傳 routes：`{ 來源支線: { 目的支線: 轉向 } }`，
 * 也就是 IntersectionArmSetting.routes 需要的形狀。
 * 解不出唯一解時回傳 null（**不猜**）。
 */
export function deriveArmRoutesFromSurvey(
  audits: ArmTurnAudit[],
): Record<string, Record<string, TurnKey>> | null {
  const codes = audits.map((audit) => audit.directionCode);
  /* 支線太多時轉向欄蓋不滿，本來就無解；也順便擋住組合爆炸。 */
  if (codes.length < 3 || codes.length > 4) return null;
  const present = new Map<string, TurnKey[]>();
  for (const audit of audits) {
    const exists = ALL_TURNS.filter(
      (turn) =>
        !audit.absent.includes(turn) &&
        /* 整欄空白的當成「沒有資訊」，不能拿來當作存在的證據。 */
        !audit.blank.includes(turn),
    );
    /* 存在的轉向數必須剛好等於去向數，否則對應不完全，不反推。 */
    if (exists.length !== audit.destinationCount) return null;
    present.set(audit.directionCode, exists);
  }

  /** 每一支支線把自己「存在的轉向」排列到其他支線上的所有可能。 */
  const optionsFor = (code: string) => {
    const turns = present.get(code) ?? [];
    const targets = codes.filter((other) => other !== code);
    const results: Record<string, TurnKey>[] = [];
    const permute = (remaining: TurnKey[], pool: string[], acc: Record<string, TurnKey>) => {
      if (!remaining.length) {
        results.push({ ...acc });
        return;
      }
      const [turn, ...rest] = remaining;
      for (const target of pool)
        permute(rest, pool.filter((item) => item !== target), {
          ...acc,
          [target]: turn,
        });
    };
    permute(turns, targets, {});
    return results;
  };

  const solutions: Record<string, Record<string, TurnKey>>[] = [];
  const search = (index: number, acc: Record<string, Record<string, TurnKey>>) => {
    if (solutions.length > 1) return; /* 已經不唯一，不必再找 */
    if (index === codes.length) {
      solutions.push(acc);
      return;
    }
    const code = codes[index];
    for (const option of optionsFor(code)) {
      /* 對稱檢查：與已經決定的支線不可以矛盾。 */
      let consistent = true;
      for (const [target, turn] of Object.entries(option)) {
        const back = acc[target];
        if (!back) continue;
        const backTurn = back[code];
        if (backTurn === undefined) {
          /* 對方沒有指向我，但我指向對方 → 矛盾。 */
          consistent = false;
          break;
        }
        if (backTurn !== oppositeTurn(turn)) {
          consistent = false;
          break;
        }
      }
      if (!consistent) continue;
      /* 已決定的支線若指向我，我也一定要指回去。 */
      for (const decided of codes.slice(0, index)) {
        const theirs = acc[decided];
        if (theirs?.[code] !== undefined && option[decided] === undefined) {
          consistent = false;
          break;
        }
      }
      if (!consistent) continue;
      search(index + 1, { ...acc, [code]: option });
    }
  };
  search(0, {});
  return solutions.length === 1 ? solutions[0] : null;
}

/**
 * 找一組角度，讓 classifyMovement() 算出來的轉向與反推的拓樸一致。
 *
 * 為什麼還要算角度：routes 已經足以決定流向歸屬（buildArmSettings 會優先
 * 採用 routes），但**轉向圖是照角度畫的**。角度與流向對不起來的話，
 * 數字會對、圖卻畫錯，那是更難發現的錯。
 *
 * 從 90 度格點裡挑不重複的角度做排列（三岔 4P3 ＝ 24 種、四岔 4P4 ＝ 24 種），
 * 取第一組能完全重現 routes 的。找不到就回傳 null，由呼叫端沿用預設角度
 * ——routes 仍然會被寫進去，流向歸屬照樣是對的。
 */
export function anglesMatchingRoutes(
  routes: Record<string, Record<string, TurnKey>>,
): Record<string, number> | null {
  const codes = Object.keys(routes).sort();
  const grid = [-90, 0, 90, 180];
  if (codes.length > grid.length) return null;
  const permute = (pool: number[], depth: number, acc: number[]): number[][] => {
    if (depth === codes.length) return [acc];
    return pool.flatMap((angle, index) =>
      permute(
        pool.filter((_unused, other) => other !== index),
        depth + 1,
        [...acc, angle],
      ),
    );
  };
  for (const combination of permute(grid, 0, [])) {
    const angles: Record<string, number> = {};
    codes.forEach((code, index) => {
      angles[code] = combination[index];
    });
    const matches = codes.every((from) =>
      Object.entries(routes[from] ?? {}).every(
        ([to, turn]) => classifyMovement(angles[from], angles[to]) === turn,
      ),
    );
    if (matches) return angles;
  }
  return null;
}
