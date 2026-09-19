/**
 * 報告文字草稿。
 *
 * 把「本次要交付的範圍與內容」寫成一段可以直接貼進報告的中文敘述。
 *
 * 這支檔案刻意寫成純函式：所有數字都由畫面端算好之後傳進來，這裡只負責
 * 組字。好處是可以用單元測試逐段驗證，不必開瀏覽器。
 *
 * ── 為什麼要有 EXPORT_SECTIONS 這個共用清單 ──────────────────────
 * 匯出中心的勾選清單、與草稿的段落清單，如果各自維護一份，日後新增一種
 * 匯出內容時很容易只加了其中一邊——使用者就會遇到「這個項目匯得出來，
 * 草稿裡卻永遠不會提到」，或反過來。所以兩邊都從這裡取用同一份清單，
 * 並用測試確保每一個匯出項目都有對應的草稿段落。
 */

/** 匯出中心可勾選的內容區塊。畫面上的勾選清單與草稿段落都以此為準。 */
export const EXPORT_SECTIONS = [
  { key: "current", label: "本季交通量、PCU與平假日比較" },
  { key: "history", label: "歷季全日量與趨勢" },
  { key: "composition", label: "車種組成與歷季比例" },
  { key: "hourly", label: "每小時實際量與PCU" },
  { key: "settings", label: "PCU、車種與路口設定" },
  { key: "trace", label: "來源追溯、品質與版本紀錄" },
  { key: "charts", label: "7張可編輯原生圖表" },
] as const;

export type ExportSectionKey = (typeof EXPORT_SECTIONS)[number]["key"];

/**
 * 草稿的段落。除了八個匯出區塊之外，另外三段沒有對應的工作表，
 * 但都是報告一定會寫到的內容，因此也開放勾選。
 */
export const DRAFT_ONLY_SECTIONS = [
  { key: "scope", label: "本次分析範圍（建議保留）" },
  { key: "period", label: "時段車種分析" },
  { key: "roads", label: "各調查點分項結果" },
  { key: "anomaly", label: "歷季異常提醒" },
] as const;

export type DraftSectionKey = ExportSectionKey | (typeof DRAFT_ONLY_SECTIONS)[number]["key"];

/** 草稿段落的完整順序。scope 放最前面，其餘依報告習慣的敘述順序。 */
export const DRAFT_SECTION_ORDER: DraftSectionKey[] = [
  "scope",
  "current",
  "hourly",
  "period",
  "roads",
  "composition",
  "history",
  "anomaly",
  "settings",
  "trace",
  "charts",
];

export const DRAFT_SECTION_LABELS: Record<DraftSectionKey, string> = {
  ...Object.fromEntries(EXPORT_SECTIONS.map((s) => [s.key, s.label])),
  ...Object.fromEntries(DRAFT_ONLY_SECTIONS.map((s) => [s.key, s.label])),
} as Record<DraftSectionKey, string>;

export type ReportDraftContext = {
  projectName: string;
  quarter: string;
  dayType: string;
  roadLabel: string;
  directionLabel: string;
  /** 路口流量視角（駛出／駛入）；沒有路口資料時給 null。 */
  flowLabel: string | null;
  /** 部分時段調查的說明；完整 24 小時時給空字串。 */
  coverageNote: string;
  roadCount: number;
  intersectionCount: number;
  recordCount: number;
  total: number;
  pcu24: number;
  /** 平日＋假日模式下，各日必須分列，不得合併成一個日交通量。 */
  dayTotals?: { dayType: string; total: number; pcu24: number }[];
  /**
   * 逐調查點（＋日別）的全日量，**一列一個調查點，沒有任何加總**。
   *
   * ⚠️ 有兩個以上調查點時，草稿的全日量那一段就改用這一份逐點敘述，
   *   不再寫「合計」——不同地點的交通量相加不成立（X-30）。
   */
  pointTotals?: {
    roadName: string;
    dayType: string;
    total: number;
    pcu24: number;
    /** F-23：逐點的全調查時段尖峰小時與該小時 PCU（多點時「每小時實際量與PCU」段用它逐點寫）。 */
    peakHour?: string;
    peakPcu?: number;
  }[];
  /** 逐點敘述串成一句的上限；超過就一個調查點一行。與畫面上的小卡共用同一個數字。 */
  pointLimit?: number;
  vehicles: { label: string; count: number; share: number }[];
  /** 尖峰小時；unit 由畫面端依實際視窗長度決定（可能不足 60 分鐘）。 */
  peak: { hour: string; pcu: number; unit: string } | null;
  topRoads: { name: string; total: number; pcu: number }[];
  dayCompare: { weekday: number; holiday: number } | null;
  /**
   * 逐調查點的平假日值（X-32）。
   *
   * ⚠️ 有兩個以上調查點時，平假日比較那一句改用這一份逐點敘述——
   *   舊版印的是跨調查點相加的兩個數字，而它就緊接在
   *   「不同調查點的交通量不可以相加，所以不列合計」後面。
   */
  dayComparePoints?: { roadName: string; weekday: number; holiday: number }[];
  trend: {
    /** 日別篩選（平日／假日／平日＋假日）。 */
    mode: string;
    /** 這條趨勢畫的是哪一個指標（實際交通量／當量交通量）。 */
    metricLabel: string;
    /** 該指標的單位，例如 輛/日 或 PCU/調查時段。每一行都要標。 */
    unit: string;
    roadLabel: string;
    rows: { quarter: string; value: number }[];
    /** 平日＋假日必須保留成兩條獨立序列，不得相加成虛構的一日總量。 */
    series?: {
      label: string;
      rows: { quarter: string; value: number }[];
    }[];
  };
  compositionMode: string;
  /** 逐調查點×日別的組成（F-10／F-30：不跨點、不跨日別相加）。 */
  compositionPoints?: { label: string; vehicles: { label: string; count: number; share: number }[] }[];
  periodExport: {
    enabled: boolean;
    periods: string[];
    scopes: string[];
    metrics: string[];
    peakScope: string;
    flowView: string;
    sheetPerPeriod: boolean;
  };
  periodHighlights: {
    label: string;
    hour: string;
    pcu: number;
    total: number;
    /**
     * 各調查點可不可以相加。
     *
     * ⚠️ X-31 之後這個欄位**只用來決定要不要講「尖峰小時各點不同」那件事**，
     *   不再決定要不要印一個合計——使用者 2026-09-16 裁示，
     *   多個調查點一律逐點一句，全調查時段也一樣
     *  （不同地點的量相加，那個總和不對應任何一條路的實際流量）。
     */
    summable: boolean;
    siteCount: number;
    /** 逐調查點的值（X-31：草稿改成逐點一句之後用的就是這一份）。 */
    sites?: {
      roadName: string;
      dayType?: string;
      hour: string;
      pcu: number;
      total: number;
      unit: string;
    }[];
    highestPcu: number;
    highestTotal: number;
    highestHour: string;
    /** 這個時段的正確單位（例如 PCU/hr、PCU/調查時段）。 */
    unit: string;
  }[];
  /**
   * 各調查點分項結果：整體總結之外，每個調查點（路段／路口）各自寫一段。
   *
   * 這裡收到的是已經算好的值，不在草稿裡再算一次——數值與單位一律沿用
   * 「時段車種分析」那張表的同一批計算（含尖峰時段認定、路口流量視角、
   * 統計範圍與顯示數值的勾選），報告文字才不會跟附表對不起來。
   */
  roadSummary: {
    /** 這些分項結果是在什麼條件下算出來的（尖峰認定、流量視角、統計範圍）。 */
    note: string;
    /** 使用者勾了哪些顯示數值（車輛數／百分比／交通流量）。 */
    metrics: string[];
    roads: {
      name: string;
      scopes: {
        name: string;
        periods: {
          label: string;
          /** 時段標籤，例如「07:15～08:15」或「24 小時」。 */
          hour: string;
          /**
           * 這個時段實際上有沒有資料。
           * 必須與 values 分開判斷：使用者可能只勾「百分比」而該時段的車輛數
           * 全為 0，這時 values 與 composition 都是空的，但資料是存在的，
           * 不能寫成「此時段無資料」。
           */
          hasData: boolean;
          /** 要寫出來的數值；單位由畫面端依時段決定後傳進來。 */
          values: { label: string; value: number; unit: string; digits: number }[];
          /** 車種占比；沒有勾「百分比」時為空陣列。 */
          composition: { label: string; share: number }[];
        }[];
      }[];
    }[];
    /** 因為筆數上限而沒有逐點寫出來的調查點數。 */
    omitted: number;
  };
  factors: { label: string; value: string }[];
  intersectionNote: string;
  sourceFileCount: number;
  qualityIssueCount: number;
  /** 未指定駛入的車輛數（單位是輛，與上面的「項」不同，不可相加）。 */
  unmappedVehicles: number;
  reviewNote: string;
  charts: string[];
  anomalies: string[];
  /*
   * ── 小數位數（使用者 2026-09-15 指名補上）────────────────────
   *
   * ⚠️ 舊版**每一個小數位都是寫死的字面值 1**（nf(x, 1)、toFixed(1)），
   *   所以結論草稿把位數改成 2 位之後，同一批數字在這兩份文件裡
   *   會以不同的位數出現，而兩份都沒有任何一句話解釋為什麼。
   *   這一欄由畫面端傳進來，草稿不再自己決定。
   * ⚠️ 車輛數（輛）仍然維持整數：「輛」本來就是整數，
   *   印成 6,000.00 輛沒有意義（與結論草稿的 whole() 同一個理由）。
   */
  digits?: number;
  /**
   * 尖峰時段認定**實際採用**的那一種，寫成使用者看得懂的字
   *（例如「整個調查點同一時段（可相加）」）。
   *
   * ⚠️ 草稿一定要寫出這一項：它決定各方向的尖峰數字**可不可以相加**。
   *   「各方向各自認定」時合計沒有意義，而合計看起來完全正常。
   */
  peakScopeLabel?: string;
};

const nf = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-TW", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";

/*
 * ⚠️ 百分比一定要把小數位數帶進來，而且**刻意不給預設值**——
 *   漏傳就是編譯錯誤。三支系統都踩過同一個雷：位數改成 2 位之後，
 *   只有前面的數值變了，百分比仍然寫死 1 位，而畫面上看不出哪裡不對。
 */
const pct = (value: number, digits: number) =>
  Number.isFinite(value)
    ? `${value >= 0 ? "增加" : "減少"} ${Math.abs(value).toFixed(digits)}%`
    : "變動幅度無法計算";

/**
 * 兩個數字之間的變動幅度。
 *
 * 基期為 0 或讀不到時**不能回 0**——回 0 會讓草稿寫出「增加 0.0%」，
 * 而那句話的意思是「兩期持平」。實際上一個是「從無到有（無限倍）」、
 * 一個是「基期根本沒調查到」，兩者都不是持平，而且這句話會被直接貼進報告。
 * 回 null 代表「無法以百分比表示」，由呼叫端寫成文字。
 */
function changeText(current: number, base: number, unit: string, digits: number) {
  if (!Number.isFinite(current) || !Number.isFinite(base))
    return "其中一期讀不到數值，變動幅度無法計算";
  if (base === 0)
    return current === 0
      ? "兩期皆為 0"
      : `基期為 0，變動幅度無法以百分比表示（由 0 ${unit} 增為 ${nf(current, digits)} ${unit}）`;
  return pct(((current - base) / base) * 100, digits);
}

/** 單一段落的內容。回傳空陣列代表「這一段目前沒有資料可寫」。 */
function sectionLines(
  key: DraftSectionKey,
  c: ReportDraftContext & { digits: number },
): string[] {
  switch (key) {
    case "scope": {
      const parts = [
        `本次分析範圍：${c.quarter}、${c.dayType}、${c.roadLabel}、${c.directionLabel}`,
      ];
      if (c.flowLabel) parts.push(`路口流量以「${c.flowLabel}」視角統計`);
      const head = parts.join("；") + "。";
      const scale =
        c.intersectionCount > 0
          ? `本範圍共 ${c.roadCount} 個調查點（其中 ${c.intersectionCount} 個為路口格式），${nf(c.recordCount)} 筆時段紀錄。`
          : `本範圍共 ${c.roadCount} 個調查點，${nf(c.recordCount)} 筆時段紀錄。`;
      const lines = [head, scale];
      /*
       * ── 條件與「不適用」一定要寫進草稿本身 ────────────────────
       *
       * 使用者 2026-09-15：「針對不適用某些篩選條件的結果，在產生草稿時，
       *   可以直接說**該數值不適用 XXX 條件**」。
       *
       * ⚠️ 尖峰時段認定尤其不能漏：「各方向各自認定」算出來的尖峰量
       *   是各方向自己的時段，**不是同一時刻的量、不可以相加**。
       *   這段文字會被複製進正式報告，而報告上看不到畫面——
       *   不寫的話，讀報告的人會把各方向加起來。
       */
      lines.push(
        `統計條件：尖峰時段認定＝${c.peakScopeLabel || "未指定"}；` +
          `路口流量視角＝${c.flowLabel || "不適用（本範圍沒有路口格式的調查點）"}；` +
          `數值小數 ${c.digits} 位（車輛數為整數）。`,
      );
      if ((c.peakScopeLabel || "").includes("各方向各自認定"))
        lines.push(
          "⚠️ 本數值不適用「相加」：各方向的尖峰小時各自認定，不同方向的尖峰量" +
            "並非同一時刻的量，合計沒有意義，請勿把各方向相加。",
        );
      if (!c.flowLabel)
        lines.push(
          "本數值不適用「路口流量視角」條件：本範圍沒有路口格式的調查點，" +
            "一般路段只有方向A／方向B，沒有駛出／駛入之分。",
        );
      lines.push(
        "本數值不適用「顯示數值」條件：草稿裡每一句各自標明自己的單位" +
          "（輛、PCU、%），不跟著主工具列的「顯示數值」切換。",
      );
      if (c.coverageNote) lines.push(c.coverageNote);
      return lines;
    }
    case "current": {
      const splitDays = c.dayType === "平日＋假日" ? (c.dayTotals ?? []) : [];
      const points = c.pointTotals ?? [];
      const pointNames = new Set(points.map((item) => item.roadName));
      if (!c.total && !c.pcu24 && !splitDays.length && !points.length)
        return [];
      /*
       * ══════════════════════════════════════════════════════════════
       *  X-30：多個調查點時**逐點敘述，絕不寫合計**
       * ══════════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-16 裁示：
       *   「逐點一句……我選擇這個，點位一多改為一個點位就一行」
       *
       * ⚠️ 舊版寫「全日實際交通量合計 N 輛」，而那個 N 是**把每一個調查點
       *   加起來**的數字。兩個不同地點的全日交通量相加，數的是同一批車
       *   經過兩個斷面——那個總和不對應任何一條路的實際流量。
       *   畫面上的小卡已於 X-28 改掉，草稿是同一個錯誤的第二個出口，
       *   而且**草稿是要抄進報告的**，比畫面上更嚴重。
       *
       * ⚠️ 「合計」兩個字本身就是問題：前面那句範圍雖然寫著「N 個調查點」，
       *   但「合計」會讓人以為那是一個成立的數字。
       *
       * ⚠️ 點位數不多時串成一句、多了就一個調查點一行——門檻與畫面上的
       *   小卡共用同一個數字（DashboardClient 的 KPI_LINE_LIMIT），
       *   否則同一份資料會在小卡收起來、草稿裡卻攤成一長串。
       */
      const multiPoint = pointNames.size > 1;
      const sentenceOf = (item: {
        roadName: string;
        dayType: string;
        total: number;
        pcu24: number;
      }) =>
        `${item.roadName}${
          c.dayType === "平日＋假日" && item.dayType ? `（${item.dayType}）` : ""
        }全日實際交通量 ${nf(item.total)} 輛，換算當量交通量 ${nf(item.pcu24, c.digits)} PCU`;
      const lines = multiPoint
        ? points.length > (c.pointLimit ?? 6)
          ? points.map((item) => `${sentenceOf(item)}。`)
          : [`${points.map(sentenceOf).join("；")}。`]
        : splitDays.length
          ? splitDays.map(
              (item) =>
                `${item.dayType}全日實際交通量 ${nf(item.total)} 輛，換算當量交通量 ${nf(item.pcu24, c.digits)} PCU。`,
            )
          : [
              `全日實際交通量合計 ${nf(c.total)} 輛，換算當量交通量 ${nf(c.pcu24, c.digits)} PCU。`,
            ];
      if (multiPoint)
        lines.push(
          `本範圍有 ${pointNames.size} 個調查點，上述數字各自獨立；不同調查點的交通量不可以相加，所以不列合計。`,
        );
      /*
       * ⚠️ 逐點敘述已經把每一個調查點都寫出來了，再寫一次「最高的幾個」
       *   等於同一批數字出現兩次，讀的人會以為那是另一組統計。
       *   所以多點時收掉這一句；只有一個調查點時維持原樣。
       */
      if (!multiPoint && c.topRoads.length)
        lines.push(
          `交通量最高的調查點依序為 ${c.topRoads
            .map((r) => `${r.name}（${nf(r.total)} 輛、${nf(r.pcu, c.digits)} PCU）`)
            .join("、")}。`,
        );
      const dayPoints = c.dayComparePoints ?? [];
      if (dayPoints.length > 1) {
        /*
         * X-32：多個調查點時逐點一句，與 X-30 同一套。
         * ⚠️ 「假日較平日±X%」是**每一個調查點各自算**——把兩個地點的量
         *   先加起來再算變化率，那個百分比不對應任何一條路。
         */
        const one = (item: { roadName: string; weekday: number; holiday: number }) =>
          `${item.roadName}平日 ${nf(item.weekday)} 輛、假日 ${nf(item.holiday)} 輛，假日較平日${changeText(item.holiday, item.weekday, "輛", c.digits)}`;
        if (dayPoints.length > (c.pointLimit ?? 6)) {
          lines.push(`平假日比較（共 ${dayPoints.length} 個調查點，逐點列出）——`);
          lines.push(...dayPoints.map((item) => `・${one(item)}。`));
        } else {
          lines.push(`${dayPoints.map(one).join("；")}。`);
        }
        lines.push(
          "（平假日比較一律同時統計兩種日別，不受上述「日別」範圍限制；各調查點各自獨立，不列跨調查點的合計。）",
        );
      } else if (c.dayCompare) {
        const base = c.dayCompare.weekday;
        // 平假日比較一定同時含平日與假日，不受畫面上「日別」篩選限制——
        // 這一點要寫出來，否則範圍寫「平日」卻又出現假日數字會讓人以為算錯。
        lines.push(
          `平日全日量 ${nf(c.dayCompare.weekday)} 輛、假日 ${nf(c.dayCompare.holiday)} 輛，假日較平日${changeText(c.dayCompare.holiday, base, "輛", c.digits)}（平假日比較一律同時統計兩種日別，不受上述「日別」範圍限制）。`,
        );
      }
      return lines;
    }
    case "hourly": {
      if (c.peak)
        return [
          `全調查時段尖峰出現於 ${c.peak.hour}，該時段當量交通量 ${nf(c.peak.pcu, c.digits)} ${c.peak.unit}。`,
        ];
      /*
       * F-23（2026-09-18 大檢查）：多個調查點時 KPI 卡不給合計尖峰（不同調查點的
       * 尖峰小時不同，相加不對應任何真實的小時），舊版草稿因此寫成
       * 「目前範圍沒有可敘述的資料」——其實每一點都有逐時資料。
       * 依 X-31「多點逐點一句」：一個調查點（×日別）一行，不列合計。
       */
      const points = (c.pointTotals ?? []).filter(
        (point) => point.peakHour && point.peakHour !== "—" && (point.peakPcu ?? 0) > 0,
      );
      if (!points.length) return [];
      return [
        `全調查時段尖峰逐調查點如下（各調查點的尖峰小時不同，不列合計）：`,
        ...points.map(
          (point) =>
            `・${point.roadName}${point.dayType ? `（${point.dayType}）` : ""}：尖峰出現於 ${point.peakHour}，該小時當量交通量 ${nf(point.peakPcu ?? 0, c.digits)} PCU/hr。`,
        ),
      ];
    }
    case "period": {
      if (!c.periodExport.enabled) return [];
      const setting = [
        `分析時段：${c.periodExport.periods.join("、") || "未選"}`,
        `統計範圍：${c.periodExport.scopes.length ? c.periodExport.scopes.join("、") : "全部方向／支線"}`,
        `輸出數值：${c.periodExport.metrics.join("、") || "未選"}`,
        `尖峰時段認定：${c.periodExport.peakScope}`,
        `路口流量視角：${c.periodExport.flowView}`,
        `工作表配置：${c.periodExport.sheetPerPeriod ? "每個時段各一張" : "全部併為一張"}`,
      ].join("；");
      const lines = [`時段車種分析（${setting}）。`];
      for (const item of c.periodHighlights) {
        const unit = item.unit || "";
        const pcuUnit = unit.replace(/^輛/, "PCU");
        const sites = item.sites ?? [];
        /*
         * ══════════════════════════════════════════════════════════════
         *  X-31：多個調查點一律**逐點一句**（使用者 2026-09-16 裁示）
         * ══════════════════════════════════════════════════════════════
         *
         * ⚠️ 舊版在「全調查時段」時寫「當量交通量合計 X PCU、
         *   實際車輛數合計 Y 輛」，而那個 Y 是把每一個調查點加起來——
         *   與 X-28（畫面小卡）、X-30（草稿全日量）是**同一個相加**。
         *   當時的理由是「全調查時段是整段累計，相加有意義」，
         *   但那只解決了「時間對不對得上」，沒有解決「地點加不加得起來」：
         *   兩個不同地點的量相加，數的是同一批車經過兩個斷面。
         *
         * ⚠️ `summable` 沒有刪掉，它仍然決定要不要多講一句
         *   「各調查點的尖峰小時不同」——那是另一件事（時間），也要講。
         */
        if (sites.length > 1) {
          const sentenceOf = (site: NonNullable<typeof item.sites>[number]) => {
            const siteUnit = site.unit || unit;
            const sitePcuUnit = siteUnit.replace(/^輛/, "PCU");
            /* ⚠️ 名稱與時段之間一定要有分隔：沒有的話會變成「中山路24 小時」，
               讀起來像路名帶了一個數字。 */
            return (
              `${site.roadName}${site.dayType ? `（${site.dayType}）` : ""}` +
              `・${site.hour}，當量交通量 ${nf(site.pcu, c.digits)} ${sitePcuUnit}、` +
              `實際車輛數 ${nf(site.total)} ${siteUnit}`
            );
          };
          /* 門檻與畫面小卡、X-30 共用同一個數字，三處呈現才不會各走各的。 */
          if (sites.length > (c.pointLimit ?? 6)) {
            lines.push(`${item.label}：共 ${sites.length} 個調查點，逐點列出——`);
            lines.push(...sites.map((site) => `・${sentenceOf(site)}。`));
          } else {
            lines.push(
              `${item.label}：${sites.map(sentenceOf).join("；")}。`,
            );
          }
          lines.push(
            `（上述數字各自獨立：不同調查點的交通量不可以相加，所以不列合計。` +
              (item.summable
                ? ""
                : `各調查點的尖峰小時不同，${pcuUnit} 是「某一個特定小時」的流率，` +
                  `相加也不對應任何一個真實存在的小時。`) +
              `）`,
          );
        } else if (sites.length === 1) {
          const site = sites[0];
          const siteUnit = site.unit || unit;
          lines.push(
            `${item.label}：時段 ${site.hour}，當量交通量 ${nf(site.pcu, c.digits)} ${siteUnit.replace(/^輛/, "PCU")}、實際車輛數 ${nf(site.total)} ${siteUnit}。`,
          );
        } else if (item.summable) {
          /* 舊呼叫端沒有傳 sites 時維持原樣，不讓沒帶資料的情形變成空白。 */
          lines.push(
            `${item.label}：時段 ${item.hour}，當量交通量合計 ${nf(item.pcu, c.digits)} ${pcuUnit}、實際車輛數合計 ${nf(item.total)} ${unit}。`,
          );
        } else {
          lines.push(
            `${item.label}：${item.hour}，共 ${item.siteCount} 個調查點；` +
              `其中最高者出現於 ${item.highestHour}，當量交通量 ${nf(item.highestPcu, c.digits)} ${pcuUnit}、` +
              `實際車輛數 ${nf(item.highestTotal)} ${unit}。` +
              `（各調查點的尖峰小時不同，${pcuUnit} 是「某一個特定小時」的流率，` +
              `相加不對應任何一個真實存在的小時，因此只做比較不做加總。）`,
          );
        }
      }
      return lines;
    }
    case "roads": {
      const summary = c.roadSummary;
      if (!summary.roads.length) return [];
      const lines = [
        `各調查點分項結果（${summary.note}；輸出數值：${
          summary.metrics.join("、") || "未選"
        }）：`,
        // Excel 的欄名是「一張工作表一個單位」，這裡是逐調查點標各自的單位。
        // 兩者都不是錯的，但擺在一起會讓人以為其中一份寫錯了，要先講清楚。
        "（下列單位依各調查點自己的實際調查時數標示；Excel 工作表的欄名為整張表統一的單位，兩者若不同以本文與各列的時段標籤為準。）",
      ];
      for (const road of summary.roads) {
        lines.push(`【${road.name}】`);
        for (const scope of road.scopes)
          for (const period of scope.periods) {
            const numbers = period.values
              .map((item) => `${item.label} ${nf(item.value, item.digits)} ${item.unit}`)
              .join("、");
            // 車種占比最多列 5 種，其餘併成一句，免得一個調查點就佔掉半頁。
            const shown = period.composition.slice(0, 5);
            const others = period.composition.slice(5);
            const otherShare = others.reduce((sum, item) => sum + item.share, 0);
            const composition = shown.length
              ? shown
                  .map((item) => `${item.label} ${item.share.toFixed(c.digits)}%`)
                  .join("、") +
                (others.length ? `、其餘 ${others.length} 種合計 ${otherShare.toFixed(c.digits)}%` : "")
              : "";
            const parts = [numbers, composition].filter(Boolean);
            const body = parts.length
              ? parts.join("；")
              : period.hasData
                ? // 有資料卻沒有任何數字可寫，只有兩種可能：一種都沒勾，
                  // 或勾了百分比但這一格的車輛數全是 0（百分比算不出來）。
                  // 舊寫法一律叫使用者去勾選項，對後者是錯的指示。
                  "此時段有紀錄，但目前勾選的輸出數值算不出數字（例如只勾了百分比而該時段車輛數為 0）"
                : "此時段無資料";
            lines.push(
              `・${scope.name}｜${period.label}（${period.hour}）：${body}。`,
            );
          }
      }
      if (summary.omitted > 0)
        lines.push(
          `（另有 ${summary.omitted} 個調查點未逐點列出，完整數字請見各工作表。）`,
        );
      return lines;
    }
    case "composition": {
      /*
       * 2026-09-18 使用者裁示（F-10／F-30）：不跨調查點、不跨日別相加——
       * 一個調查點 × 一個日別一句；沒有逐點資料時退回單一那一組（舊寫法）。
       */
      if (c.compositionPoints && c.compositionPoints.length)
        return [
          `車種組成（全調查時段，各調查點、各日別分別統計，不相加）：`,
          ...c.compositionPoints.map(
            (point) =>
              `・${point.label}：${point.vehicles
                .map((v) => `${v.label} ${v.share.toFixed(c.digits)}%（${nf(v.count)} 輛）`)
                .join("、")}。`,
          ),
        ];
      if (!c.vehicles.length) return [];
      return [
        `車種組成（依「${c.compositionMode}」統計，全調查時段）：${c.vehicles
          .map((v) => `${v.label} ${v.share.toFixed(c.digits)}%（${nf(v.count)} 輛）`)
          .join("、")}。`,
      ];
    }
    case "history": {
      const series = c.trend.series?.length
        ? c.trend.series
        : [{ label: c.trend.mode, rows: c.trend.rows }];
      if (!series.some((item) => item.rows.length)) return [];
      /*
       * 這一行以前只寫了日別（mode），沒寫「畫的是哪一個指標」也沒有單位——
       * 切換實際交通量／當量交通量時，數字換了但這句話一字不變，
       * 讀者看到「115Q2 13,000.0」無從判斷是車輛數還是當量。
       */
      const formatted = (value: number) => {
        const text = nf(value, c.digits);
        if (text === "—" || !c.trend.unit) return text;
        return c.trend.unit === "%" ? `${text}%` : `${text} ${c.trend.unit}`;
      };
      const head = `歷季趨勢（${c.trend.metricLabel}，依「歷季分析」面板的 ${c.trend.mode}／${c.trend.roadLabel}）：${series
        .map(
          (item) =>
            `${item.label}：${item.rows
              .map((row) => `${row.quarter} ${formatted(row.value)}`)
              .join("、")}`,
        )
        .join("；")}。`;
      const changes = series.flatMap((item) => {
        if (item.rows.length < 2) return [];
        const last = item.rows[item.rows.length - 1];
        const previous = item.rows[item.rows.length - 2];
        return [
          `${item.label}最新一季 ${last.quarter} 較前一季 ${previous.quarter}，${changeText(last.value, previous.value, c.trend.unit || "", c.digits)}。`,
        ];
      });
      return [head, ...changes];
    }
    case "settings": {
      const lines: string[] = [];
      if (c.factors.length)
        lines.push(
          `本計畫採用的 PCU 當量係數：${c.factors.map((f) => `${f.label} ${f.value}`).join("、")}。`,
        );
      if (c.intersectionNote) lines.push(c.intersectionNote);
      return lines;
    }
    case "trace": {
      const lines = [
        `資料來源共 ${c.sourceFileCount} 個原始檔；資料品質檢查${
          c.qualityIssueCount
            ? `列出 ${nf(c.qualityIssueCount)} 項未滿 24 小時的方向`
            : "未發現未滿 24 小時的方向"
        }${
          // 未指定駛入的單位是「輛」，與上面的「項」不同，必須分開講。
          c.unmappedVehicles ? `，另有未指定駛入 ${nf(c.unmappedVehicles)} 輛` : ""
        }。`,
      ];
      if (c.reviewNote) lines.push(c.reviewNote);
      return lines;
    }
    case "charts": {
      if (!c.charts.length) return [];
      return [`本次匯出附圖：${c.charts.join("、")}，均為 Excel 可編輯的原生圖表。`];
    }
    case "anomaly": {
      if (!c.anomalies.length)
        return ["歷季異常提醒：目前門檻下未發現異常。"];
      return [
        `歷季異常提醒共 ${c.anomalies.length} 項：`,
        ...c.anomalies.slice(0, 20).map((item) => `・${item}`),
        ...(c.anomalies.length > 20
          ? [`（其餘 ${c.anomalies.length - 20} 項請見「品質與定稿」畫面）`]
          : []),
      ];
    }
    default:
      return [];
  }
}

/**
 * 產生草稿全文。
 * enabled 沒有勾到的段落不會出現；勾了但沒有資料的段落會明確寫出來，
 * 而不是靜靜消失——不然使用者會以為系統漏寫。
 */
/**
 * 小數位數夾回安全範圍。
 *
 * ⚠️ 和結論草稿的 safeConclusionDigits 同一個理由：畫面上的下拉只給 0／1／2，
 *   危險的是**另一條路**——舊備份、舊範本、以及單元測試餵進來的舊形狀
 *   根本沒有這個欄位。`toFixed(undefined)` **不會拋錯，只會安靜輸出 0 位**，
 *   而 `nf(x, undefined)` 會印出「undefined 位」這種字。
 *   缺值一律回 1 位＝改版前的行為，舊呼叫端逐字相同。
 */
function safeReportDigits(value: unknown): number {
  const acceptable =
    typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "");
  if (!acceptable) return 1;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2 ? parsed : 1;
}

export function buildReportDraft(
  rawContext: ReportDraftContext,
  enabled: DraftSectionKey[],
): string {
  const context: ReportDraftContext & { digits: number } = {
    ...rawContext,
    digits: safeReportDigits(rawContext.digits),
  };
  const picked = new Set(enabled);
  const blocks: string[] = [
    `${context.projectName || "（未命名計畫）"} ${context.quarter} 交通量分析報告草稿`,
  ];
  for (const key of DRAFT_SECTION_ORDER) {
    if (!picked.has(key)) continue;
    const lines = sectionLines(key, context);
    blocks.push(
      lines.length
        ? lines.join("\n")
        : `${DRAFT_SECTION_LABELS[key]}：目前範圍沒有可敘述的資料。`,
    );
  }
  blocks.push(
    "本段文字由系統依目前畫面的分析結果自動產生，僅供撰寫報告時參考；正式引用前請核對原始調查檔、當量係數設定與現地情況。",
  );
  return blocks.join("\n\n");
}
