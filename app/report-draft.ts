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
  { key: "projects", label: "跨計畫比較" },
  { key: "settings", label: "PCU、車種與路口設定" },
  { key: "trace", label: "來源追溯、品質與版本紀錄" },
  { key: "charts", label: "9張可編輯原生圖表" },
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
  "projects",
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
  vehicles: { label: string; count: number; share: number }[];
  /** 尖峰小時；unit 由畫面端依實際視窗長度決定（可能不足 60 分鐘）。 */
  peak: { hour: string; pcu: number; unit: string } | null;
  topRoads: { name: string; total: number; pcu: number }[];
  dayCompare: { weekday: number; holiday: number } | null;
  trend: {
    /** 日別篩選（平日／假日／平日＋假日）。 */
    mode: string;
    /** 這條趨勢畫的是哪一個指標（實際交通量／當量交通量）。 */
    metricLabel: string;
    /** 該指標的單位，例如 輛/日 或 PCU/調查時段。每一行都要標。 */
    unit: string;
    roadLabel: string;
    rows: { quarter: string; value: number }[];
  };
  compositionMode: string;
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
    /** 各調查點可不可以相加：全日時段可以；尖峰小時只有在時段相同時才可以。 */
    summable: boolean;
    siteCount: number;
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
  projectsCompare: { name: string; total: number; pcu: number }[];
  factors: { label: string; value: string }[];
  intersectionNote: string;
  sourceFileCount: number;
  qualityIssueCount: number;
  /** 未指定駛入的車輛數（單位是輛，與上面的「項」不同，不可相加）。 */
  unmappedVehicles: number;
  reviewNote: string;
  charts: string[];
  anomalies: string[];
};

const nf = (value: number, digits = 0) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-TW", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";

const pct = (value: number) =>
  Number.isFinite(value)
    ? `${value >= 0 ? "增加" : "減少"} ${Math.abs(value).toFixed(1)}%`
    : "變動幅度無法計算";

/**
 * 兩個數字之間的變動幅度。
 *
 * 基期為 0 或讀不到時**不能回 0**——回 0 會讓草稿寫出「增加 0.0%」，
 * 而那句話的意思是「兩期持平」。實際上一個是「從無到有（無限倍）」、
 * 一個是「基期根本沒調查到」，兩者都不是持平，而且這句話會被直接貼進報告。
 * 回 null 代表「無法以百分比表示」，由呼叫端寫成文字。
 */
function changeText(current: number, base: number, unit: string) {
  if (!Number.isFinite(current) || !Number.isFinite(base))
    return "其中一期讀不到數值，變動幅度無法計算";
  if (base === 0)
    return current === 0
      ? "兩期皆為 0"
      : `基期為 0，變動幅度無法以百分比表示（由 0 ${unit} 增為 ${nf(current, 1)} ${unit}）`;
  return pct(((current - base) / base) * 100);
}

/** 單一段落的內容。回傳空陣列代表「這一段目前沒有資料可寫」。 */
function sectionLines(key: DraftSectionKey, c: ReportDraftContext): string[] {
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
      if (c.coverageNote) lines.push(c.coverageNote);
      return lines;
    }
    case "current": {
      if (!c.total && !c.pcu24) return [];
      const lines = [
        `全日實際交通量合計 ${nf(c.total)} 輛，換算當量交通量 ${nf(c.pcu24, 1)} PCU。`,
      ];
      if (c.topRoads.length)
        lines.push(
          `交通量最高的調查點依序為 ${c.topRoads
            .map((r) => `${r.name}（${nf(r.total)} 輛、${nf(r.pcu, 1)} PCU）`)
            .join("、")}。`,
        );
      if (c.dayCompare) {
        const base = c.dayCompare.weekday;
        // 平假日比較一定同時含平日與假日，不受畫面上「日別」篩選限制——
        // 這一點要寫出來，否則範圍寫「平日」卻又出現假日數字會讓人以為算錯。
        lines.push(
          `平日全日量 ${nf(c.dayCompare.weekday)} 輛、假日 ${nf(c.dayCompare.holiday)} 輛，假日較平日${changeText(c.dayCompare.holiday, base, "輛")}（平假日比較一律同時統計兩種日別，不受上述「日別」範圍限制）。`,
        );
      }
      return lines;
    }
    case "hourly": {
      if (!c.peak) return [];
      return [
        `全日尖峰小時出現於 ${c.peak.hour}，該時段當量交通量 ${nf(c.peak.pcu, 1)} ${c.peak.unit}。`,
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
        if (item.summable) {
          lines.push(
            `${item.label}：時段 ${item.hour}，當量交通量合計 ${nf(item.pcu, 1)} ${pcuUnit}、實際車輛數合計 ${nf(item.total)} ${unit}。`,
          );
        } else {
          /*
           * 各調查點的尖峰小時不同時**不可以相加**——PCU/hr 是「某一個特定
           * 小時」的流率，把 07:00–08:00 的 A 點和 07:30–08:30 的 B 點加起來，
           * 得到的數字不對應任何一個真實存在的小時。改成寫「最高的那一個點」
           * 並講明為什麼不加總。
           */
          lines.push(
            `${item.label}：${item.hour}，共 ${item.siteCount} 個調查點；` +
              `其中最高者出現於 ${item.highestHour}，當量交通量 ${nf(item.highestPcu, 1)} ${pcuUnit}、` +
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
                  .map((item) => `${item.label} ${item.share.toFixed(1)}%`)
                  .join("、") +
                (others.length ? `、其餘 ${others.length} 種合計 ${otherShare.toFixed(1)}%` : "")
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
      if (!c.vehicles.length) return [];
      return [
        `車種組成（依「${c.compositionMode}」統計）：${c.vehicles
          .map((v) => `${v.label} ${v.share.toFixed(1)}%（${nf(v.count)} 輛）`)
          .join("、")}。`,
      ];
    }
    case "history": {
      const rows = c.trend.rows;
      if (rows.length < 1) return [];
      /*
       * 這一行以前只寫了日別（mode），沒寫「畫的是哪一個指標」也沒有單位——
       * 切換實際交通量／當量交通量時，數字換了但這句話一字不變，
       * 讀者看到「115Q2 13,000.0」無從判斷是車輛數還是當量。
       */
      const unit = c.trend.unit ? ` ${c.trend.unit}` : "";
      const head = `歷季趨勢（${c.trend.metricLabel}，依「歷季分析」面板的 ${c.trend.mode}／${c.trend.roadLabel}）：${rows
        .map((r) => `${r.quarter} ${nf(r.value, 1)}${unit}`)
        .join("、")}。`;
      if (rows.length < 2) return [head];
      const last = rows[rows.length - 1];
      const previous = rows[rows.length - 2];
      return [
        head,
        `最新一季 ${last.quarter} 較前一季 ${previous.quarter}${changeText(last.value, previous.value, c.trend.unit || "")}。`,
      ];
    }
    case "projects": {
      if (c.projectsCompare.length < 2) return [];
      return [
        `跨計畫比較：${c.projectsCompare
          .map((p) => `${p.name} ${nf(p.total)} 輛（${nf(p.pcu, 1)} PCU）`)
          .join("、")}。`,
      ];
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
export function buildReportDraft(
  context: ReportDraftContext,
  enabled: DraftSectionKey[],
): string {
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
