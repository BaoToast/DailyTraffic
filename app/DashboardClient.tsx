"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import initialData from "./traffic-data.json";
import {
  isFallbackRoadName,
  isRealArmName,
  typedNameKey,
  isRealDirectionName,
  normalizeRoadId,
  pickDirectionName,
  roadNameFromFileName,
  roadNameMatchKey,
  surveyRoadIdFromFileName,
} from "./road-identity";
import { appFetch, offlineMode } from "./app-fetch";
import { useViewScrollMemory } from "./view-scroll";
import {
  DEFAULT_MAIN_FILTERS,
  filtersFor,
  isDetached,
  detachedIds,
  setChartFilter,
  resetChart,
  resetAllCharts,
  isFiltered,
  describeMain,
  inapplicableNote,
  metricBaseOf,
  metricShowsShare,
  PERIOD_CHOICE_LABELS,
  PEAK_SCOPE_CHOICE_LABELS,
  FLOW_CHOICE_LABELS,
  METRIC_CHOICE_LABELS,
} from "./main-filters";
import type {
  MainFilters,
  ChartOverrides,
  PeriodChoice,
  FlowChoice,
  MetricChoice,
  DayChoice,
  PeakScopeChoice,
} from "./main-filters";
import {
  downloadPaintedPng,
  downloadBlob,
  type ChartPngSink,
  drawDonutChart,
  drawGroupedBars,
} from "./chart-png";
import {
  type ChartNote,
  compositionNote,
  dayCompareNote,
  hourlyNote,
} from "./chart-notes";

/*
 * ══════════════════════════════════════════════════════════════════
 *  圖旁邊的解讀說明
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的要求：「不管哪個程式，我希望圖旁邊都能有對應的、解讀該張圖
 * 代表的意義的說明提供給使用者看。」
 *
 * 文字本身在 app/chart-notes.ts，是純函式、有單元測試釘住。這裡只負責
 * 把它畫出來。
 *
 * ⚠️ `data-chart-note` 這個屬性是給「匯出的圖片裡不可以有說明文字」的
 * 守門用的——使用者特別交代過：「檔案匯出不能在圖上留下說明文字」。
 * 說明是 DOM 的一部分、不是畫布的一部分，所以匯出（canvas / Excel 原生
 * 圖表）本來就不會帶到它；屬性存在是為了讓測試可以直接證明這件事，
 * 而不是靠「我看過了」。
 */
function boldParts(line: string) {
  /* chart-notes 用 **粗體** 標出「不可以誤讀」的那一句。 */
  return line
    .split("**")
    .map((piece, index) =>
      index % 2 === 1 ? (
        <strong key={index}>{piece}</strong>
      ) : (
        <span key={index}>{piece}</span>
      ),
    );
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  區段導覽（五大功能區）
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者的要求：「讓使用者一目了然知道資料匯入區、參數設定區、圖表區、
 * 多計畫比較區等等各大功能區。」
 *
 * 這一支是**單一長頁往下捲**的版面，所以分區有兩件事要做：
 *   ① 每一區前面放一條看得見的分隔標題（ZoneHeading）——不捲也知道
 *      自己在哪一區。
 *   ② 頂端一列固定的導覽（.section-nav，position:sticky）——跳過去
 *      之後導覽還在原位，所以可以再跳到別區。使用者特別問過這一點：
 *      「跳過去之後，如果我想跳到五，還能按到頂端固定的區段導覽嗎？」
 *
 * ⚠️ 捲動目標一定要配 scroll-margin-top，否則標題會被固定的導覽蓋住，
 * 看起來就像「按了沒反應」。使用者也回報過這個現象。
 */
/*
 * ⚠️ 分區名稱依使用者 2026-09-10 指定，與路口轉向的歸類邏輯一致：
 *   一 資料匯入／二 參數設定／三 資料檢視／四 圖表與比較／五 資料產出與維護
 * 「關鍵數字」與「明細與產出」是舊名，改掉是為了三支程式講同一套話。
 *
 * items 是側欄裡**歸類底下真正列出來的東西**。使用者的原話：
 *   「目前只有歸類，但看不出歸類下面有什麼資料
 *     （可以把表格的名稱做為歸類下面的名稱）」
 *
 * 兩種項目刻意分開，因為它們的行為不同，混在一起使用者會按錯：
 *   anchor ── 這一頁上的某一塊，點了換頁並捲到那一塊
 *   action ── 會開視窗的功能（匯入、品質與定稿、批次輸出…）
 * ⚠️ 不可以把 action 寫成 anchor：捲到一個不存在的錨點等於「按了沒反應」，
 *    那正是使用者最早抱怨過的現象。
 */
/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一塊對主工具列八個條件的「表態表」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「請針對三份程式逐一確認，是否每張圖表都有確實的出現不受某篩選條件
 *     影響的提醒文字……我目前看下來大多數都有提示，但偶爾會出現某張圖
 *     有出現提醒文字，卻對某一個篩選條件卻沒出現不受影響的提醒文字，
 *     因為我不能確實找出這類問題出來」。
 *
 * 他找不出來是對的——這種漏**看不出來**：畫面上有說明文字，只是少了
 * 其中一個條件的那一句，而少的那一句正好是你沒去試的那一個下拉。
 *
 * 所以改成**每一塊都要對八個條件逐一表態**，兩種之一：
 *   ・寫在這張表的 consumes 裡 ＝ 這一塊真的吃這個條件
 *   ・畫面上掛一句不適用說明（帶 data-inapplicable=條件名）＝ 有講
 * 守門（scripts/e2e-filter-coverage.mjs）驗的是
 *   **consumes ∪ 說明 ＝ 八個條件，一個都不能少**。
 *
 * ⚠️ 為什麼不能只驗「數字有沒有變」：有些條件在某一批資料上剛好算出
 *   一樣的數字（例如駛出與駛入的**總計**本來就相同），那不是漏，
 *   是資料的性質。只驗數字會把那種情形誤判成漏，然後有人為了消紅
 *   去掛一句錯的說明——畫面說謊比沒說更糟。
 *
 * ⚠️ 這張表是**宣告**，不是實作。改了某一塊真正吃的條件時要一起改這裡，
 *   否則守門會通過一個已經不成立的宣告。
 */
/*
 * ⚠️ 導出給守門用（scripts/e2e-filter-coverage.mjs 有一份同樣的清單）。
 *   兩邊要一致——條件增減時兩邊都要改，不然守門會少驗一項而且不會報錯。
 */
export const MAIN_CONDITIONS = [
  "quarterFrom",
  "day",
  "roads",
  "directions",
  "period",
  "flowView",
  "peakScope",
  "metric",
] as const;
/*
 * 前兩張總結小卡最多列幾行（X-28，使用者 2026-09-16 裁示）。
 * 行數 ＝ 季數 × 調查點數 × 日別數，很容易爆開；超過就收成一句說明，
 * 而且**一個合計數字都不給**——不同調查點的量相加是錯的，
 * 給一個「合計」等於把錯的數字換個說法留著。
 */
const KPI_LINE_LIMIT = 6;
const BLOCK_CONSUMES: Record<string, string> = {
  /* 全日實際交通量：整段調查的累計，不隨尖峰、視角、認定方式或顯示數值變。 */
  "card-kpi-daily": "quarterFrom day roads directions",
  /* 24 小時 PCU：同上，只是換成當量。 */
  "card-kpi-pcu24": "quarterFrom day roads directions",
  /* 尖峰小時當量交通量：吃時段與尖峰認定；固定 PCU、固定全部方向同一時段。 */
  "card-kpi-peak": "quarterFrom day roads period peakScope",
  /* 車種組成：吃到方向與時段；本身就是「輛數＋占比」，不隨顯示數值變。 */
  "block-composition": "quarterFrom day roads directions period",
  /* 24 小時型態：橫軸是 0～23 時，時段條件不適用（另有說明）。 */
  "block-hourly": "quarterFrom day roads directions flowView",
  /* 歷季趨勢：橫軸是季度；日別跟著主工具列（平日＋假日時兩條線）；指標由圖自己的下拉決定。 */
  "block-trend": "quarterFrom day roads",
  /* 同季平假日比較：兩根柱子就是平日與假日，日別不是篩選。 */
  "block-comparison": "quarterFrom roads directions flowView",
  /* 可追溯明細：一列一個調查點，逐列寫出各條件。 */
  "block-detail": "quarterFrom day roads directions flowView peakScope metric",
  /* 時段車種分析：整塊走自己的三態條件（脫離時會掛脫離提示）。 */
  periodAnalysis:
    "quarterFrom day roads directions period flowView peakScope metric",
};

/*
 * ══════════════════════════════════════════════════════════════════════
 *  一個大分頁＝一個獨立畫面（X-63，使用者 2026-09-17，三支同步）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者原話：
 *   「三個程式，是否能做到，一個大分頁本身就是一個界面，不要與其他大界面
 *     共用畫面呢？……點其中一個大分頁，右邊的畫面，就單純只有這個大分頁的內容，
 *     不要往下滾動畫面時，就會看到其它大分頁的內容。」
 *   「全日交通量的五、資料產出與維護，應該有6個大分頁……
 *     各大分頁右邊的畫面只顯示大分頁內容，不要穿插其它大分頁的東西。」
 *   「目前看來 路口轉向程式 是唯一 完美做到我說的這些格式的最佳範本」
 *
 * 所以這一份從**兩層**（分區 → 錨點）改成**三層**（分區 → 大分頁 → 小分頁），
 * 與路口轉向那一支逐一對應。
 *
 * ⚠️ 二（參數設定）與三（資料檢視）**刻意各自只有一個大分頁**。
 *   使用者 2026-09-17 親自裁示：「n2064 的二、三我建議不拆，我同意」。
 *   那兩區每一塊都很短、性質又相同（都是設定／都是同一季的同一組數字），
 *   屬於他說的「執行檢查按鈕＋摘要＋門檻＋結果是一體的」那種例外。
 *   硬拆會讓側欄多出七個只有一張卡的大分頁。
 *
 * ⚠️ 一個大分頁底下**只有一塊、而且名字和大分頁一樣**時，側欄不再列一次
 *   （見 SectionNav）。同一個字在側欄出現兩層不會幫任何人找到東西。
 */
const PAGE_ZONES = [
  {
    id: "zone-import",
    index: "一",
    short: "匯入",
    /*
     * ⚠️ 區名一併改成「建立與匯入」：建立計畫是這一區的第一件事，
     *   叫「資料匯入」會讓人以為要先有資料才能進來。三支用同一個區名。
     */
    title: "建立與匯入",
    subtitle: "建立與管理計畫・上傳調查資料・資料檢核",
    pages: [
      {
        id: "page-projects",
        /*
         * ⚠️ 名稱是**三支統一**的，不要各自改。
         *   使用者 2026-09-13：「三個程式建立計畫的分頁名稱應該都要統一為
         *   **建立與管理計畫**，這樣才知道所有的第一步都是從建立計畫開始，
         *   而且這裡也能管理計畫。」
         */
        label: "建立與管理計畫",
        items: [
          { label: "建立與管理計畫", anchor: "block-projects" },
          { label: "匯入調查資料", action: "import" },
        ],
      },
      {
        id: "page-quarter",
        /*
         * ⚠️ 2026-09-11 由「資料完整度總覽」改名為「本季總覽」。
         *
         * 使用者要三支程式都有一個一眼看得到的「當季總覽」，而且側欄要標出來。
         * 查過之後發現**這一支早就有了**——就是這一塊（調查點數、平日／假日、
         * 檢核狀態、異常提醒），它做的事和路口轉向那兩張卡完全一樣，而且更完整。
         *
         * ⚠️ X-63：它與「建立與管理計畫」是兩件事（一個是建計畫、一個是看
         *   這一季收到什麼程度），原本擠在同一頁，往下捲就會看到另一個。
         *   拆成兩個大分頁之後與路口轉向一致。
         */
        label: "本季總覽",
        items: [{ label: "本季總覽", anchor: "block-quality" }],
      },
    ],
  },
  {
    id: "zone-settings",
    index: "二",
    short: "設定",
    title: "參數設定",
    subtitle: "季度／日別／調查點篩選・PCU 當量・車種歸類",
    /*
     * ⚠️ 每一個項目要指向**自己那一張卡片**，不可以兩個指向同一個錨點。
     *
     * 使用者 2026-09-11 實測：「這三個分頁我各點一下，畫面都沒反應，
     * 後來我才看出來，因為這三個的畫面是同一個，一開始以為是壞掉。」
     *
     * 原因有兩層，兩層都要修：
     *   ① 「路段／路口主檔管理」與「道路與流向管理」以前**都指向
     *      block-managers**，點哪一個跑的是同一段程式。
     *   ② 這幾張卡片本來就在畫面上，而捲動規則是「已經看得到就完全不動」
     *      （那條規則是對的，畫面亂跳更惱人）——於是真的什麼都沒發生。
     *
     * 所以解法不能只靠捲動，要**視覺點名**：見下面的 focusedBlock。
     *
     * ⚠️ 另外補上「車種分類與當量管理」。那張卡片一直都在畫面上，
     *   卻從來沒有側欄項目指向它——側欄看起來像只有三件事可做。
     */
    pages: [
      {
        id: "page-settings",
        label: "參數設定",
        items: [
          { label: "路段／路口主檔管理", anchor: "card-road-master" },
          { label: "道路與流向管理", anchor: "card-geometry" },
          { label: "車種分類與當量管理", anchor: "card-vehicle-class" },
          { label: "PCU 當量係數", anchor: "block-pcu" },
        ],
      },
    ],
  },
  {
    id: "zone-kpi",
    index: "三",
    short: "檢視",
    title: "資料檢視",
    subtitle: "全日實際交通量・PCU・尖峰時段",
    /*
     * 使用者 2026-09-11：「三 資料檢視下方應該呈現的不是『關鍵數字』，
     * 而是全日實際交通量、24小時PCU、尖峰小時當量交通量。」
     *
     * ⚠️ 第二張卡片在「只有部分時段調查」時抬頭會變成「調查時段PCU」，
     *   側欄這裡刻意**固定寫 24小時PCU**——側欄是導覽，項目名稱跟著資料
     *   浮動的話，同一支程式在不同計畫會長出不同的側欄，反而更難找。
     */
    pages: [
      {
        id: "page-kpi",
        label: "資料檢視",
        items: [
          { label: "全日實際交通量", anchor: "card-kpi-daily" },
          { label: "24小時PCU", anchor: "card-kpi-pcu24" },
          { label: "尖峰小時當量交通量", anchor: "card-kpi-peak" },
        ],
      },
    ],
  },
  {
    id: "zone-charts",
    index: "四",
    short: "圖表",
    title: "圖表與比較",
    subtitle: "車種組成・24小時型態・歷季分析・同季平假日",
    /*
     * ⚠️ X-63：四張圖各自一個大分頁。使用者原話：
     *   「全日交通程式的 四、圖表與比較，有4個大分頁，
     *     車種組成/24小時型態/歷季分析/同季平假日，能否點其中一個大分頁，
     *     右邊的畫面，就單純只有這個大分頁的內容」
     * ⚠️ 順序照舊，不要重排——使用者是照這個順序在找圖的。
     */
    pages: [
      {
        id: "page-composition",
        label: "車種組成",
        items: [{ label: "車種組成", anchor: "block-composition" }],
      },
      {
        id: "page-hourly",
        label: "24小時型態",
        items: [{ label: "24小時型態", anchor: "block-hourly" }],
      },
      {
        id: "page-trend",
        label: "歷季分析",
        items: [{ label: "歷季分析", anchor: "block-trend" }],
      },
      {
        id: "page-comparison",
        label: "同季平假日",
        items: [{ label: "同季平假日", anchor: "block-comparison" }],
      },
    ],
  },
  {
    id: "zone-output",
    index: "五",
    short: "產出",
    title: "資料產出與維護",
    subtitle: "可追溯明細・時段車種分析・成果交付・批次輸出・異常檢查・備份",
    /*
     * ⚠️ X-63：使用者逐項指定了這一區要有六個大分頁：
     *   「可追溯明細/時段車種分析/結論草稿產生器/報表批次輸出中心/
     *     資料異常檢查(小分頁：檢查按鈕、檢查摘要、門檻、檢查結果)/
     *     還原與備份(小分頁：刪除單一季度/備份本計畫/備份全部計畫/還原計畫/清除本機資料)」
     *
     * ⚠️ 兩個名稱依 X-61 改成三支統一的講法：
     *   結論草稿產生器 → 「成果交付」、報表批次輸出中心 → 「批次輸出」。
     *   （使用者 2026-09-17 同意 X-61 的命名並要求三支同步；
     *     卡片本身的抬頭仍然叫「結論草稿產生器」，因為那是它做的事，
     *     所以它會以小分頁的身分列在「成果交付」底下。）
     *
     * ⚠️ 「刪除單一季度」搬到「還原與備份」底下——使用者指定的位置，
     *   而且他裁示「三支程式同步就好，你覺得放哪裡、邏輯清晰好理解就好」。
     *   X-48 要求三支的資料維護名稱逐字相同，三支一起照新分法排就仍然成立。
     */
    pages: [
      {
        id: "page-detail",
        label: "可追溯明細",
        items: [{ label: "可追溯明細", anchor: "block-detail" }],
      },
      {
        id: "page-period",
        label: "時段車種分析",
        items: [{ label: "時段車種分析", anchor: "periodAnalysis" }],
      },
      {
        id: "page-delivery",
        label: "成果交付",
        items: [{ label: "結論草稿產生器", anchor: "conclusionStudio" }],
      },
      {
        id: "page-batch",
        label: "批次輸出",
        items: [
          { label: "報表批次輸出中心", action: "exportCenter" },
          { label: "一鍵下載全部圖檔", anchor: "block-chart-png" },
        ],
      },
      {
        id: "page-check",
        /*
         * ── 資料異常檢查（X-43／X-48／X-59，三支同步）──────────────
         * 使用者 2026-09-16：「資料產出與維護，應該要三個程式互相同步：
         *   刪除單一季度、執行資料異常檢查按鈕(要能正常運作)、
         *   異常提醒門檻(如果該程式不適用就不用)、資料異常檢查摘要、檢查結果」
         * 名稱與交通服務水準、路口轉向**逐字相同**，三支才是同一件事。
         * ⚠️ 這四塊是使用者說的「一體的」那種例外：按了上面那顆鈕，
         *   下面三塊才有內容，所以它們**刻意同頁**。
         */
        label: "資料異常檢查",
        items: [
          { label: "執行資料異常檢查", anchor: "quality-run" },
          { label: "資料異常檢查摘要", anchor: "quality-summary" },
          { label: "異常提醒門檻", anchor: "quality-thresholds" },
          { label: "檢查結果", anchor: "quality-reasons" },
        ],
      },
      {
        id: "page-backup",
        label: "還原與備份",
        /*
         * ⚠️ 這三項是**錨點**，不是「按下去就產檔」。
         *
         * 舊版是一項 `{ label: "匯出備份", action: "backup", immediate: true }`，
         * 點一下當場打包下載。使用者 2026-09-11 的原話：
         *   「點一下立刻就下載 有點措手不及，希望像路口轉向程式，點進去後很直白
         *     的知道，我可以匯出單一計畫作備份、匯出這程式下面我全部計畫作備份，
         *     以及也能在這邊匯入備份檔作還原。」
         * 所以改成三個名稱各自指向一張卡片，點了只會捲過去並把那張卡框起來，
         * 真正的動作在卡片上，按之前看得到它會做什麼。
         *
         * ⚠️ 名稱要與卡片抬頭**一模一樣**，使用者才不用自己對應。
         */
        items: [
          /*
           * ⚠️ X-71（使用者 2026-09-17）：「管理季度」那個視窗整個移除，
           *   它和「刪除單一季度」做的是同一件事（清除一季的分析資料）。
           *   但那個視窗**另外還有「改名」**，而改名在別處沒有第二個入口——
           *   整個拿掉會把一個功能一起弄丟。所以改名獨立成這一塊。
           */
          { label: "季度改名", anchor: "maintenance-rename-quarter" },
          { label: "刪除單一季度", anchor: "maintenance-delete-quarter" },
          { label: "備份本計畫", anchor: "backup-one" },
          { label: "備份全部計畫", anchor: "backup-all" },
          { label: "還原計畫", anchor: "backup-restore" },
          { label: "清除本機資料", anchor: "block-clear-local" },
        ],
      },
    ],
  },
] as const;

/** 全部大分頁攤平成一份，供 view 狀態與守門使用。 */
const PAGES = PAGE_ZONES.flatMap((zone) =>
  zone.pages.map((page) => ({ ...page, zone })),
);
/** 第一個大分頁——開機、換計畫、找不到目前分頁時都回到它。 */
const FIRST_PAGE = PAGES[0].id as string;
/** 由大分頁 id 找回它自己與它所屬的分區。 */
function pageById(id: string) {
  return PAGES.find((page) => page.id === id) ?? PAGES[0];
}

/** 側欄項目按下之後要做的事，由 DashboardClient 提供。 */
export type SideNavAction =
  "import" | "quality" | "history" | "quarters" | "exportCenter" | "backup";

/**
 * 每一頁最上面那一條標題。
 *
 * ⚠️ X-63 之後**主角是大分頁的名字**，分區只是它的出身
 *   （「五　資料產出與維護」）。原本這裡印的是分區名，
 *   四張圖各自成頁之後，四頁會印出同一個「四　圖表與比較」——
 *   使用者點了四次看到同一個抬頭，分不出自己在哪一頁。
 * ⚠️ id 掛的是**大分頁的 id**：捲動記憶、守門與側欄都以它為準。
 */
function PageHeading({ pageId }: { pageId: string }) {
  const page = pageById(pageId);
  const zone = page.zone;
  return (
    <div className="zone-heading" id={page.id} data-zone={zone.index}>
      <b>{zone.index}</b>
      <div>
        <strong>{page.label}</strong>
        {/*
         * ⚠️ 這裡只寫**分區名**，不接分區的 subtitle。
         *   subtitle 列的是「這一區底下有哪些東西」——那些名字現在
         *   各自是一個大分頁，側欄已經逐一列出來了，再印一次是重複；
         *   更糟的是它會讓**別頁的名字出現在這一頁上**
         *   （e2e-tabs 的「別頁內容不可以洩漏過來」立刻抓到：
         *     停在「本季總覽」卻看得到「上傳調查資料」）。
         */}
        <small>{zone.title}</small>
      </div>
    </div>
  );
}

/*
 * 分頁導覽。
 *
 * ⚠️ v20.64 之前這裡是**捲動定位**：五個分區全部在同一頁，按鈕只是把畫面
 * 捲到對應的錨點。使用者明確要求改掉：
 *
 *   「路口轉向那樣的方式，點一個頁面，如同換了一個分頁，**這個畫面獨屬於它**，
 *     我反而不喜歡全日交通量那樣，所有資訊都一直往下滾動下來察看」
 *   「我希望全日交通量能變得跟路口轉向和交通服務水準程式那樣的呈現」
 *
 * 所以現在是**真的換頁**：一次只渲染一個分區。
 *
 * ⚠️ 隨之刪掉的那一整套 sticky／scroll-margin／捲動高亮的補償程式碼，
 * 是因為**問題本身不存在了**，不是因為改壞了忘記補回來。
 * 那段程式碼曾經修過三次（sticky 過渡位置、平滑捲動被中止、高亮落後一區），
 * 全部都是「同一頁捲動」這個做法自帶的麻煩。
 *
 * ⚠️ 換頁**不可以**變成每一頁各自為政：工具列與最上面那排篩選條件刻意留在
 * 分頁之外，五頁共用同一份 state。使用者的原話是「篩選條件要能在各分頁、
 * 各圖表旁就地設定」，指的是**同一組條件到處都能改**，不是每頁一組。
 */
/**
 * 把畫面捲到這一頁裡的某一塊。
 *
 * ⚠️ 換頁是 React 的狀態變更，那一塊要等這一輪 render 之後才存在，
 *    所以不可以在 onClick 裡直接 getElementById——一定是 null。
 *    這裡等到下一個動畫影格再找，找不到就只回到頁首，不做任何假動作。
 */
function scrollToBlock(anchor: string) {
  requestAnimationFrame(() => {
    const target = document.getElementById(anchor);
    if (!target) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    /*
     * ⚠️ X-19（使用者 2026-09-16，附圖）：**不可以**直接
     *   `scrollIntoView({block:"start"})`。
     *
     *   主工具列是 sticky、浮在內容上面，block:"start" 把這一塊的上緣對到
     *   視窗上緣＝**塞到工具列底下**，使用者看到的是被切掉一半的區塊，
     *   而且最上面那一行（區塊名稱）正好是被蓋掉的那一行。
     *
     * ⚠️ 要扣的高度只能從 `--sticky-top` 讀（它是全站唯一一份，
     *   定義在 globals.css，內容是 `calc(--main-toolbar-h + 12px)`）。
     *   在這裡自己再算一次，工具列高度一變就會漂移。
     *   讀不到時退回 0，最壞的情況就是回到舊行為，不會壞掉。
     */
    /*
     * ⚠️ 高度要**當場量**，不可以寫死：主工具列可以收合、窄視窗會換行，
     *   高度一直在變。也要先確認它真的是吸頂的；不是吸頂就不必扣，
     *   扣了反而少捲一段。（與交通服務水準的 focusBlock 同一套寫法。）
     */
    const stickyHeight = (selector: string) => {
      const node = document.querySelector(selector);
      return node && getComputedStyle(node).position === "sticky"
        ? node.getBoundingClientRect().height
        : 0;
    };
    const offset = stickyHeight(".filters") + stickyHeight(".topbar") + 12;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  });
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  L-2：「回歸全部」旁邊的浮動小卡——看得到是哪幾塊正在用自己的條件
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-15：
 *   「主工具列跳出全部回歸鈕時，上面會寫目前共 N 項要回歸，你覺得要提供
 *     使用者選擇哪幾個回歸嗎？還是為了主工具列簡化目的，一次性全部回歸
 *     才是最實用的方式？」
 *   → 定案：維持一次性全部回歸，但 N 要**看得到是哪幾塊**。
 *   「做成浮動小卡，不占版面很棒，但你提供了點一下清單裡的名稱，畫面會
 *     跳轉過去，那就要記得**浮動小卡也要跟著關掉**」
 *   「我怕展開時候，整個主工具列會被擠的超大」
 *
 * ⚠️ 清單**只看、不勾選**。要單獨回歸某一塊，那一塊自己旁邊就有
 *   「回到主工具列條件」——比在這裡找一個勾選清單直覺得多，
 *   而且主工具列要簡潔（使用者原則：「能不要就不要」）。
 */
type DetachedItem = { id: string; label: string; zone: string; anchor: string };

function DetachedPopover(props: {
  count: number;
  items: DetachedItem[];
  onGoto: (item: DetachedItem) => void;
  onResetAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement | null>(null);
  /*
   * ⚠️ 點外面與按 Esc 都要關掉。監聽器只在開著的時候掛，收起來就拆掉——
   *   否則每開一次就多留一個在文件上。
   */
  useEffect(
    function () {
      if (!open) return;
      const onDocumentClick = (event: MouseEvent) => {
        if (boxRef.current && boxRef.current.contains(event.target as Node)) return;
        setOpen(false);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setOpen(false);
      };
      document.addEventListener("click", onDocumentClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocumentClick);
        document.removeEventListener("keydown", onKey);
      };
    },
    [open],
  );
  return (
    <span className="mt-detached" ref={boxRef}>
      <button
        type="button"
        className="mt-reset-all"
        data-testid="mt-reset-all"
        onClick={() => {
          /* 回歸全部之後清單本身就沒有意義了，順手關掉。 */
          setOpen(false);
          props.onResetAll();
        }}
      >
        回歸全部（{props.count} 塊正在用自己的條件）
      </button>
      <button
        type="button"
        className="mt-detached-toggle"
        data-testid="mt-detached-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        看是哪幾塊
        {/* ⚠️ 箭頭只能用 ▼（U+25BC，Big5 A1B9）＋ CSS 轉角度；▸／▾ 不在 Big5。 */}
        <i aria-hidden="true">▼</i>
      </button>
      <div className="mt-detached-pop" data-testid="mt-detached-pop" hidden={!open}>
        <p className="mt-detached-lead">
          這幾塊正在用自己的條件。點名稱可以跳過去看；要單獨回歸，用那一塊自己的「回到主工具列條件」。
        </p>
        <ul className="mt-detached-list">
          {props.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="mt-detached-item"
                data-detached-goto={item.anchor || item.id}
                onClick={() => {
                  /*
                   * ⚠️ 先關再跳。換頁／捲動會重畫，順序反過來的話
                   *   小卡會被重新畫出來。
                   */
                  setOpen(false);
                  props.onGoto(item);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </span>
  );
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  小分頁可以收合
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-13（三支同步）：
 *   「使用者點選了大分頁後，會展開下面的小分頁，那能否做個**可以讓使用者
 *     把小分頁收合**的功能? ……因為**目前點選大分頁是會有跳轉功能的**，
 *     所以如果要做可以收合小分頁的功能的話，可能要想一下怎麼做」
 *
 * ⚠️ 衝突點是使用者自己先指出來的：大分頁那一列現在的點擊行為是「切到那一頁」。
 *   把它改成「切換收合」會把跳轉弄丟；兩個行為綁在同一個點擊上，
 *   使用者永遠猜不到這一下會發生什麼。
 *
 * 作法：大分頁那一列的**最右側**放一顆獨立的收合鈕（▾／▸），**只**負責收合。
 *   那一列其餘區域的行為一個字都沒改。
 * ⚠️ 按鈕不可以巢狀在按鈕裡（HTML 不合法、鍵盤行為也會壞），
 *   所以收合鈕是大分頁按鈕的**兄弟**，用一層 .side-nav-head 排在同一列。
 */
const NAV_COLLAPSE_KEY = "traffic-nav-collapsed-v1";

function readCollapsed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_COLLAPSE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function SectionNav({
  view,
  onChange,
  onAction,
  focusedBlock,
  onFocusBlock,
}: {
  view: string;
  onChange: (id: string) => void;
  onAction: (action: SideNavAction) => void;
  /** 目前被「點名」的卡片錨點；側欄那一顆也要跟著亮起來。 */
  focusedBlock: string;
  onFocusBlock: (anchor: string) => void;
}) {
  /*
   * ⚠️ 初始值直接從 localStorage 讀，不要用 useEffect 補——
   *   用 effect 的話第一個影格會是全部展開，看得到一次閃動。
   *   （這是 client component，讀 localStorage 沒有 SSR 問題；
   *     讀不到時 readCollapsed() 回空陣列。）
   */
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  return (
    <nav className="side-nav" aria-label="分頁導覽">
      {PAGE_ZONES.map((zone) => (
        <div className="side-nav-group" key={zone.id}>
          {/*
           * ⚠️ 收合鈕是分區按鈕的**直接兄弟**，不另外包一層。
           *   包一層的話 `.side-nav-group > button` 這個選擇器就打不到了，
           *   而**九支既有守門**都是那樣寫的——實測一次改動打掉四支。
           *   兩顆並排改由 .side-nav-group 的格線負責（見 globals.css）。
           */}
          <button
            type="button"
            /*
             * ⚠️ X-63：分區底下現在有好幾個大分頁，所以「目前在這一區」
             *   的判斷改成「view 是這一區底下任何一個大分頁」。
             *   還寫 `view === zone.id` 的話，分區標題永遠不會亮。
             */
            className={
              zone.pages.some((page) => page.id === view) ? "active" : ""
            }
            aria-current={
              zone.pages.some((page) => page.id === view) ? "page" : undefined
            }
            data-goto={zone.id}
            /*
             * ⚠️ 這裡**不可以**自己 window.scrollTo(0)。
             *
             * 捲動位置改由 useViewScrollMemory 統一管（三支同一套）：
             *   第一次進某一頁 → 最上面；回頭再進去 → 上次中斷的地方。
             * 在這裡先捲一次 0 會出兩個問題：
             *   ① 這一瞬間「目前分頁」還是**離開前那一頁**，記錄器會把 0
             *      記到舊分頁頭上——等於每次離開都把它的位置擦掉。
             *   ② 之後 hook 又會把畫面捲回記住的位置，變成跳兩次。
             */
            /*
             * ⚠️ **點分類標題＝要看這一區，所以它底下一定要展開。**
             *
             *   使用者 2026-09-14：「全日交通量程式，我點選分類標題
             *   （例如二、參數設定）時，並未自動展開下方的大分頁和小分頁，
             *   請同步確認三份程式是否都能自動展開」
             *
             *   舊版收合狀態是寫進 localStorage 的，所以只要按過一次收合鈕，
             *   那一區就**永遠**是收的——再怎麼點那顆分類標題都不會展開，
             *   只有回去按那一顆小小的 ▸ 才展得開。使用者當然會以為壞了。
             *
             *   收合鈕仍然照常可以收（停在這一區時把側欄收乾淨），
             *   但「切過去」這個動作本身要把它展開。
             *
             * ⚠️ X-63：點分區標題＝跳到**這一區的第一個大分頁**。
             *   分區本身已經不是一個畫面了，不可以再 onChange(zone.id)——
             *   那會讓右邊變成空白（沒有任何 view === zone.id 的分支）。
             */
            onClick={() => {
              setCollapsed((previous) => {
                if (!previous.includes(zone.id)) return previous;
                const next = previous.filter((id) => id !== zone.id);
                try {
                  localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify(next));
                } catch {
                  /* 存不進去只影響「下次還記得」，這一次照樣展開。 */
                }
                return next;
              });
              onChange(zone.pages[0].id);
            }}
          >
            <b>{zone.index}</b>
            {/*
             * ⚠️ 這裡要寫**全名**，不可以再用 zone.short。
             *   舊版顯示的是「三　數字」——分區代號加兩個字的縮寫，
             *   使用者 2026-09-10 的原話：「當初『三數字』，不是這個命名吧？
             *   使用者看不出這個分頁是在講什麼」。側欄有寬度，沒有理由縮寫。
             */}
            <span>{zone.title}</span>
          </button>
          {/*
           * ⚠️ 沒有大分頁的分區**不顯示**收合鈕——擺一顆按下去毫無反應的鈕，
           *   和按鈕壞掉沒有分別。
           */}
          {zone.pages.length > 0 && (
            <button
              type="button"
              className="side-nav-collapse"
              data-collapse-zone={zone.id}
              aria-expanded={!collapsed.includes(zone.id)}
              aria-label={`收合或展開「${zone.title}」底下的分頁`}
              onClick={(event) => {
                /* ⚠️ 擋下來，不然會冒泡成換頁。 */
                event.stopPropagation();
                setCollapsed((previous) => {
                  const next = previous.includes(zone.id)
                    ? previous.filter((id) => id !== zone.id)
                    : [...previous, zone.id];
                  try {
                    localStorage.setItem(
                      NAV_COLLAPSE_KEY,
                      JSON.stringify(next),
                    );
                  } catch {
                    /* 存不進去只影響「下次還記得」，這一次照樣收合。 */
                  }
                  return next;
                });
              }}
            >
              {/*
               * ⚠️ 用箭頭，不是文字。
               *
               * 使用者 2026-09-14 先提了「做成小標籤寫展開／收合」，
               * 看過這一支之後改口：「應該是交通服務水準做壞的原因，
               * 不然我看全日交通量左側分頁，**這樣顯眼的箭頭，也可以很好表達
               * 可以展開收合**。那可以同步和全日交通量一致作法，
               * 不用改成展開/收合的文字了」。
               *
               * 所以維持箭頭，但底色與外框要看得見（見 globals.css）——
               * 當初的問題是「太淺」，不是「用了箭頭」。
               */}
              {/*
               * ⚠️ 只能用 ▼（U+25BC，Big5 A1B9）＋ CSS 轉角度。
               *   原本寫 ▸／▾（▸／▾）——那兩個字**不在 Big5**，
               *   微軟正黑體畫不出來，某些電腦上會變成空白，
               *   看起來像這顆展開鈕壞掉（使用者 2026-09-11 就回報過同一個坑）。
               *
               * ⚠️ 而且**不可以寫成 \uXXXX 跳脫**：字形守門掃的是原始碼裡的
               *   字元，跳脫寫法它看不到——這兩顆就是這樣躲過守門的
               *  （2026-09-15 查到，守門已補上跳脫的還原）。
               */}
              <i aria-hidden="true" className="side-nav-caret">
                ▼
              </i>
            </button>
          )}
          <div className="side-nav-items" hidden={collapsed.includes(zone.id)}>
            {zone.pages.map((page) => {
              /*
               * ⚠️ X-63：一個大分頁底下**只有一塊、而且那一塊就叫這個大分頁
               *   的名字**時，不要再列一次小分頁——側欄會變成同一個字兩層
               *  （「車種組成 ＞ 車種組成」），那不會幫任何人找到東西。
               *
               *   這時候把那一塊的錨點**掛到大分頁那一顆鈕上**：
               *   點它就是「換到這一頁並且點名那一塊」，行為一個都沒少，
               *   而且既有守門用的 `.side-nav-item[data-goto-item="…"]`
               *   仍然選得到（那顆鈕同時掛著兩個 class）。
               */
              const only =
                page.items.length === 1 &&
                "anchor" in page.items[0] &&
                page.items[0].label === page.label
                  ? page.items[0]
                  : null;
              const anchorOfOnly = only ? (only.anchor as string) : "";
              return (
                <div className="side-nav-page-group" key={page.id}>
                  <button
                    type="button"
                    className={
                      (view === page.id ? "side-nav-page current" : "side-nav-page") +
                      (only ? " side-nav-item" : "") +
                      (only && focusedBlock === anchorOfOnly ? " current" : "")
                    }
                    data-goto-page={page.id}
                    data-goto-item={only ? page.label : undefined}
                    data-anchor={only ? anchorOfOnly : undefined}
                    aria-current={view === page.id ? "page" : undefined}
                    title={
                      only
                        ? `捲到本頁的「${page.label}」`
                        : `切換到「${page.label}」`
                    }
                    onClick={() => {
                      onChange(page.id);
                      /*
                       * ⚠️ 只「點名」，**不捲動**。
                       *   這一頁上就只有這一塊，捲過去沒有任何意義；
                       *   而且捲動會與「第一次進某一頁從最上面開始」那條規則
                       *   打架——實測（e2e-view-scroll ④）就是這樣紅的：
                       *   第一次點進「可追溯明細」卻停在 305px。
                       *   外框照樣亮，使用者仍然看得出「就是這一塊」。
                       */
                      if (only) onFocusBlock(anchorOfOnly);
                    }}
                  >
                    {page.label}
                  </button>
                  {/*
                   * ⚠️ X-73（使用者 2026-09-17）：
                   *   「當我點一項大分頁時，其它大分頁可以把他底下的小分頁收合起來嗎?
                   *     可以參考另外兩個程式的做法，點了某一大分頁，
                   *     其它展開的大分頁會自動收合」
                   *
                   *   舊版把**每一個**大分頁底下的小分頁一律展開，
                   *   第五分區一打開就是二十幾列，要找的那一頁埋在裡面。
                   *   改成只展開**目前這一頁**的小分頁，和另外兩支一致。
                   *
                   * ⚠️ 這與 2026-09-10 那句「目前只有歸類，但看不出歸類下面有什麼資料」
                   *   不衝突：那一句講的是**分區**底下看不到大分頁，
                   *   分區底下的大分頁仍然一律列出來，收起來的只有再下一層。
                   */
                  !only &&
                    view === page.id &&
                    page.items.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className={
                          "anchor" in item && focusedBlock === item.anchor
                            ? "side-nav-item current"
                            : "side-nav-item"
                        }
                        data-goto-item={item.label}
                        /*
                         * ⚠️ 錨點型項目要把它指向的 id 寫在 DOM 上。
                         *   盤點用的守門（scripts/e2e-nav-coverage.mjs）要比對
                         *   「畫面上有幾塊」與「側欄列了哪幾塊」，只有中文標籤比不了——
                         *   標籤和 id 不是一對一（例如「我的計畫」→ block-projects）。
                         *   寫在 DOM 上，守門才量得到；使用者看不到這個屬性。
                         */
                        data-anchor={"anchor" in item ? item.anchor : undefined}
                        /*
                         * 三種項目要**看得出來不一樣**：
                         *   ・錨點　→ 沒有記號，捲到本頁的某一塊
                         *   ・開視窗→「→」，還會再讓你決定一次
                         *   ・直接做→「↓」，按下去當場產檔
                         */
                        title={
                          "anchor" in item
                            ? `捲到本頁的「${item.label}」`
                            : "immediate" in item && item.immediate
                              ? "按下立即產生備份檔並下載，不會再問一次"
                              : "開啟「" + item.label + "」視窗"
                        }
                        onClick={() => {
                          onChange(page.id);
                          if ("anchor" in item) {
                            /*
                             * ⚠️ 順序：先「點名」再捲動。
                             *   點名是 React 狀態，卡片要等這一輪 render 之後才會
                             *   帶上外框；scrollToBlock 本來就是排在下一個動畫影格
                             *   才去找元素，兩件事剛好接得上。
                             */
                            onFocusBlock(item.anchor as string);
                            scrollToBlock(item.anchor as string);
                          } else onAction(item.action as SideNavAction);
                        }}
                      >
                        {"immediate" in item && item.immediate
                          ? `${item.label}（直接下載）`
                          : item.label}
                        {"action" in item ? (
                          <i
                            aria-hidden="true"
                            className={
                              "immediate" in item && item.immediate
                                ? "side-nav-mark side-nav-mark-download"
                                : "side-nav-mark"
                            }
                          >
                            {/*
                             * ⚠️ 只能用 ↓ ← → ↑（U+2190–2193）這一組箭頭。
                             *
                             * 使用者 2026-09-11：「匯出備份(直接下載) 名字旁邊的
                             * 向下箭頭已經看不到，會展開視窗的向右箭頭也看不到」。
                             * 原本寫的是「⤓」(U+2913) 與「▸」(U+25B8)——這兩個字
                             * **不在 Big5 字集裡**，而網頁字型是
                             * "Microsoft JhengHei"（微軟正黑體），它沒有這兩個字的
                             * 字形；瀏覽器又找不到替補字型時，畫出來就是空白，
                             * 不是豆腐框，所以看起來像「記號根本沒做」。
                             *
                             * ↑↓←→ 在 Big5 是 A1F6–A1F9，正黑體一定有。
                             * scripts/nav-glyph-guard.mjs 會擋下再用到罕見字的情況。
                             */}
                            {"immediate" in item && item.immediate ? "↓" : "→"}
                          </i>
                        ) : null}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * 每一張圖旁邊那一顆「下載高解析圖片（PNG）」。
 *
 * ⚠️ 做成共用元件而不是各自寫一顆：三支程式、十幾張圖，各寫一顆的話
 *   文案、副標與行為一定會分岔（有的寫「下載圖片」、有的忘了註明
 *   「只有圖」）。使用者 2026-09-12 指名三支「同樣方式作處理」。
 */
function ChartPngButton({
  onClick,
  label = "下載高解析圖片（PNG）",
  chartId,
}: {
  onClick: () => void;
  label?: string;
  /** 給守門測試認得出「這張圖有沒有下載鈕」。 */
  chartId: string;
}) {
  return (
    <button
      type="button"
      className="ghost chart-png-button"
      data-chart-png={chartId}
      onClick={onClick}
      title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
    >
      {label}
      <small>只有圖，不含說明文字</small>
    </button>
  );
}

/*
 * 需使用者確認的清單：逐筆列出 ＋ 類型標籤篩選 ＋ 每一類的筆數。
 *
 * 使用者 2026-09-13 指定的四件事（三支同步）：
 *   1. 逐筆列出（不可以靜默截斷）
 *   2. 每一筆帶類型
 *   3. 上方一排類型標籤，各自帶筆數；點了只留該類型，可多選
 *   4. 不點任何標籤＝全列；另有「清除篩選」
 *
 * ⚠️ 標籤上的筆數加總必須等於全列時的列數。兩者不一致的話，
 *   使用者會以為某一類被吃掉了——而他沒有辦法自己驗證。
 */
function ImportWarningList({
  items,
}: {
  items?: { type: string; text: string }[];
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const list = items ?? [];
  /* 依筆數由多到少排，最常發生的那一類排在最前面。 */
  const counts = new Map<string, number>();
  for (const item of list) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shown = picked.length
    ? list.filter((item) => picked.includes(item.type))
    : list;
  if (!list.length) return null;
  return (
    <div className="warning-items">
      <div className="anomaly-chips">
        {types.map(([type, count]) => (
          <button
            key={type}
            type="button"
            className={
              picked.includes(type) ? "anomaly-chip is-on" : "anomaly-chip"
            }
            aria-pressed={picked.includes(type)}
            onClick={() =>
              setPicked((previous) =>
                previous.includes(type)
                  ? previous.filter((x) => x !== type)
                  : [...previous, type],
              )
            }
          >
            {type}
            <b>{count}</b>
          </button>
        ))}
        {picked.length > 0 && (
          <button
            type="button"
            className="anomaly-chip is-clear"
            onClick={() => setPicked([])}
          >
            清除篩選
          </button>
        )}
      </div>
      <p className="warning-items-count">
        {picked.length
          ? `顯示 ${shown.length} / 共 ${list.length} 筆（已篩選：${picked.join("、")}）`
          : `共 ${list.length} 筆，全部列出`}
      </p>
      <ul className="warning-item-list">
        {shown.map((item, index) => (
          <li key={`${item.type}-${index}`}>
            <span className="warning-item-type">{item.type}</span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartNoteBox({ note }: { note: ChartNote }) {
  return (
    <aside className="chart-note" data-chart-note>
      <h4>{note.title}</h4>
      {note.lines.map((line, index) => (
        <p key={index}>{boldParts(line)}</p>
      ))}
    </aside>
  );
}

/*
 * 按下按鈕之後，把「剛長出來的結果」帶到看得見的地方。
 *
 * 使用者回報（交通服務水準）：「路段管理」按下『預覽修改影響』之後畫面停在原地，
 * 不知道預覽已經長在下面，會以為程式沒反應。三支都做了同一件事的實測，
 * 結論草稿產生器也有同樣狀況——「產生草稿」在條件面板的上方，草稿框在最下面。
 *
 * 規則刻意訂得保守，因為「畫面亂跳」比「不跳」更惱人：
 *   ・結果已經整個看得到 → **完全不動**。按了之後結果就在原地的按鈕不受影響。
 *   ・結果在視窗外       → 才捲動，而且只捲到剛好看得見。
 *   ・使用者的系統設定要求減少動態效果 → 直接跳過去，不做平滑捲動。
 *
 * 只在「按了才會出現結果」的按鈕呼叫；每次輸入都會重畫的地方不要用，
 * 那會變成打一個字畫面跳一次。
 */
/*
 * 可複選的篩選下拉（調查點、車流方向共用）。
 *
 * 為什麼不用 <select multiple>：那個原生控制項在中文環境很難用——
 * 要按住 Ctrl 才能複選、選了幾個看不出來、也放不下「全選／清除」。
 * 這裡做成「按鈕＋勾選清單」，和交通服務水準表頭的漏斗是同一種操作。
 *
 * 空陣列 = 不設限（全部），**不是全部排除**。這一點在每一個呼叫端都一樣，
 * 否則使用者把最後一個勾取消掉時，畫面會突然變成空的。
 */
/*
 * ⚠️ 這裡本來有一個 TOOLBAR_OPEN_KEY（記住主工具列是展開還是收起）。
 *   X-78 之後三支一律「每一次開啟都收合」，記住狀態反而做不到使用者要的事，
 *   所以整個鍵連同讀寫一起拿掉——留著會讓人以為那條路徑還在用。
 */

function MultiPicker(props: {
  label: string;
  allLabel: string;
  options: [string, string][];
  value: string[];
  onChange: (next: string[]) => void;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node))
        setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const picked = props.value;
  const summary =
    picked.length === 0
      ? props.allLabel
      : picked.length === 1
        ? (props.options.find(([id]) => id === picked[0])?.[1] ?? picked[0])
        : `已選 ${picked.length} 個`;
  return (
    <div className="multi-picker" ref={boxRef}>
      <button
        type="button"
        id={props.id}
        className={picked.length ? "multi-picker-btn on" : "multi-picker-btn"}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${props.label}：${summary}`}
        /* 可選項目數。端對端測試要在不打開面板的情況下數得出來
           （面板打開時會蓋住其他元素，而測試常常在有視窗開著的狀態下量）。 */
        data-count={props.options.length}
      >
        <span>{summary}</span>
        <i aria-hidden="true">▼</i>
      </button>
      {open && (
        <div className="multi-picker-panel">
          <div className="multi-picker-head">
            <button type="button" onClick={() => props.onChange([])}>
              {props.allLabel}
            </button>
            <button
              type="button"
              onClick={() => props.onChange(props.options.map(([id]) => id))}
            >
              全選
            </button>
          </div>
          <div className="multi-picker-list">
            {props.options.length ? (
              props.options.map(([id, name]) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={picked.includes(id)}
                    onChange={() =>
                      props.onChange(
                        picked.includes(id)
                          ? picked.filter((x) => x !== id)
                          : [...picked, id],
                      )
                    }
                  />
                  <span>{name}</span>
                </label>
              ))
            ) : (
              <p className="multi-picker-empty">沒有可選的項目</p>
            )}
          </div>
          <div className="multi-picker-foot">一個都不勾＝{props.allLabel}</div>
        </div>
      )}
    </div>
  );
}

export function revealResult(el: Element | null | undefined) {
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  const rect = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const fullyVisible = rect.top >= 0 && rect.bottom <= vh;
  const fillsViewport = rect.top <= 0 && rect.bottom >= vh;
  if (fullyVisible || fillsViewport) return;
  const reduce =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    el.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  } catch {
    /* 舊瀏覽器不接受設定物件時，退回最陽春的用法 */
    el.scrollIntoView();
  }
}

/* 版號與更新日期的單一來源，畫面與測試讀同一份 */
import { SYSTEM_VERSION, SYSTEM_UPDATED_AT } from "./system-release";
import { markOfflineMode } from "./offline-flag";
import {
  TURN_COLORS,
  VEHICLE_COLORS,
  VEHICLE_COLORS_ARGB,
  vehicleColor,
} from "./vehicle-colors";
import {
  armCodeOf,
  headerDateCells,
  assertNoPrototypePollution,
  coreVehicleLabels,
  dayTypeOf,
  parseTrafficSheetValues,
  prototypeFingerprint,
  SAFE_XLSX_READ_OPTIONS,
  trafficSheetNamesForDay,
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
  type PcuScopes,
  syncCoreVehicleSettings,
  vehicleCatalog,
  type CorePcuFactors,
  type CoreTurnPcuFactors,
  type VehicleClassSetting,
} from "./vehicle-analysis";
import {
  ANY as SCOPE_ANY,
  conflictsIn as scopeConflictsIn,
  ownScope as ownPcuScope,
  removeScope as removePcuScope,
  resolveFactors as resolvePcuFactors,
  scopeLabel as pcuScopeLabel,
  upsertScope as upsertPcuScope,
} from "./factor-scope";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  METRIC_BASE_UNITS,
  columnUnitFor,
  PERIOD_KEYS,
  PERIOD_LABELS,
  PEAK_SCOPE_HINTS,
  PERIOD_HINTS,
  isMorningHour,
  isAfternoonHour,
  hourStartOf,
  startMinutesOf,
  endMinutesOf,
  buildPeriodExportSheets,
  buildPeriodRows,
  defaultPeriodExportSelection,
  normalizePeriodExportSelection,
  periodCellValue,
  cellUnitFor,
  periodVehicleLabel,
  shareOf,
  buildPeriodAnalysis,
  noonStraddleKey,
  type MetricKey,
  type NoonAnswers,
  type NoonStraddle,
  type PeriodRecord,
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
  type ConclusionScope,
  type ConclusionTemplate,
} from "./conclusion";
import {
  coverageLabelOf,
  coverageNote,
  formatRange,
  peakFromBuckets,
  peaksByDay,
  sameSurveyCoverage,
  surveyCoverage,
  valueInWindow,
  type SurveyCoverage,
} from "./partial-day";
import {
  buildArmSettings,
  classifyMovement,
  deriveDestinationIntersectionRecords,
  intersectionTurnConflicts,
  armTurnConflicts,
  describeTurnConflict,
  normalizeAngle,
  reclassifyArmRoutes,
  turnTargets,
  type IntersectionArmSetting,
  unconfiguredIntersectionRoads,
  auditArmTurns,
  deriveArmRoutesFromSurvey,
  anglesMatchingRoutes,
  defaultArmAngle,
  TURN_LABELS,
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
  TREND_METRICS,
  axisTitle,
  buildTrendScript,
  completeQuarterRange,
  labelStride,
  niceAxisMax,
  showXLabel,
  trendMetricById,
  trendMetricLabel,
  type TrendMetricDef,
  type TrendScriptSection,
  type TrendMetricId,
} from "./trend-script.ts";
import {
  checkPeriodAgainstDate,
  findSurveyDate,
  periodDisplayLabel,
  surveyDateInYearStyle,
  quarterInYearStyle,
  YEAR_STYLE_LABELS,
  type YearStyle,
  normalizeSurveyPeriod,
  checkSurveyPeriodInput,
  surveyPeriodInputMessage,
  periodMismatchPrompt,
  periodUnknownNotice,
  PERIOD_DISPLAY_LABELS,
  type PeriodDateCheck,
  type PeriodDisplayMode,
} from "./period-date.ts";
import {
  ANOMALY_RESOLUTIONS,
  anomalyFingerprint,
  anomalyTypeCounts,
  compareQuarters,
  completenessSummary,
  detectAnomalies,
  filterAnomalies,
  emptyWorkflowState,
  trafficIdentity,
  validateImport,
  type AnomalyAlert,
  type ComparisonReportTemplate,
  type ImportHistoryEntry,
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
/**
 * 還原點（workflow.history）保留幾筆。
 *
 * ⚠️ 2026-09-16 由 10 降到 **8**，三支一致（路口轉向 9/15、交通服務水準 9/16）。
 *
 * 理由：畫面上那一塊已經移除（使用者：「使用者不須要從畫面查看」），
 *   這份紀錄現在是**純維護用**。而每一筆都含匯入前後**兩份完整的計畫資料**，
 *   會跟著 IndexedDB 與匯出的備份檔等比膨脹。
 *   使用者 2026-09-15：「不要明明只需要前 10 筆，你卻讓程式硬是留 100 筆
 *   來增加儲存空間的負荷」。
 *
 * ⚠️ 三個寫入處（匯入、還原、備份合併）一律用這個常數，不可以再寫死數字——
 *   寫死的話改一次要記得改三個地方，而漏掉的那一個不會有任何徵兆。
 */
const UNDO_KEEP = 8;
const DAY_MODES: DayMode[] = ["平日", "假日", "平日＋假日"];
/**
 * 匯出檔的車輛數／PCU 單位。
 *
 * 兩個維度都要看：
 *   ・調查涵蓋不滿 24 小時 → 那個總量是實測時段的合計，不是全日量
 * 「平日＋假日」會拆成各自的單日列，不會把兩天加成一個日交通量。
 */
function exportActualUnit(_day: DayMode, partial: boolean) {
  return partial ? "輛/調查時段" : "輛/日";
}
function exportPcuUnit(_day: DayMode, partial: boolean) {
  return partial ? "PCU/調查時段" : "PCU/日";
}
function dayQualifiedLabel(name: string, rowDay: string, mode: DayMode) {
  return mode === "平日＋假日" ? `${name}（${rowDay}）` : name;
}
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
  /*
   * 匯入當下，使用者對「這一天最忙的一小時橫跨中午」的決定。
   *
   *   "am"／"pm" ＝ 把那一小時算成上午／下午尖峰
   *   "ignore"   ＝ 照原本的 12:00 分界算，那一小時兩邊都不選
   *   沒有這個欄位 ＝ 匯入時沒有發生這種情況（絕大多數資料都是如此）
   *
   * ⚠️ 存在**紀錄上**而不是計畫設定上，理由有二：
   *   ① 使用者要求「每次匯入都重新問」，存在設定裡會變成沿用舊判斷。
   *   ② 日後回頭看這一筆資料時，看得出當初的決定是什麼——決定本身
   *      也是資料的一部分，不記下來就等於沒發生過。
   */
  noonSide?: "am" | "pm" | "ignore";
  sourceFileName?: string;
  sourceSheetName?: string;
  sourceRow?: number;
  sourceRange?: string;
  sourceWarnings?: string[];
  /** 表頭讀到的調查日期；只用於期別提示與畫面顯示。 */
  surveyDate?: string;
};
type Project = {
  id: string;
  name: string;
  code?: string;
  clientName?: string;
  /*
   * ⚠️ 這裡原本有一個 role: "owner" | "editor" | "viewer"，2026-09-11 移除。
   *
   *   它是「把計畫分享給同事」那套協作功能留下來的欄位，而那個功能
   *   **沒有任何入口**（見 shareProject 的移除說明），畫面上也沒有任何
   *   地方會把一個計畫設成非 owner。所以本機建立的每一個計畫都是 owner，
   *   六處「role === 'viewer' 就停用」的判斷恆為 false——
   *   是看起來有作用、實際上不會發生的死程式。
   *
   *   使用者 2026-09-11：「如果我要分享給同事，我就會把檔案匯出，
   *   拿去同事電腦中匯入，所以不需要唯讀檢視……可以移除。」
   *
   *   ⚠️ 伺服器端的 app/api/ 路由仍然有 role（那是原本 Next.js 版的東西，
   *     不會進到交付給使用者的單機版）。那些檔案這一輪刻意不動——
   *     它們與畫面無關，動它們只會擴大這次的改動範圍。
   */
  quarter?: string;
  isDemo?: boolean;
};
type RoadAlias = { aliasKey: string; aliasName: string; roadId: string };
type RoadSummary = {
  roadId: string;
  /**
   * 這一列是哪一季（X-37）。
   *
   * ⚠️ 空字串＝「這張表沒有依季分列」（例如 KPI 卡那一份，它自己另外逐季分行）。
   *   可追溯明細會傳 splitQuarter，每一季各成一列——那張表的名字就是
   *   「**可追溯**明細」，把多季加成一列等於把它的用途取消掉。
   */
  quarter: string;
  /*
   * 這一列是哪一種日別。
   *
   * 日別選「平日＋假日」時，同一個調查點會出現**兩列**（平日一列、假日一列），
   * 而不是把兩天相加成一列。相加出來的數字沒有工程意義：
   * 它不是 AADT、不是任何一天的日交通量、也不是設計小時交通量。
   * 實測中山路 115Q1：平日 42,090 輛、假日 32,675 輛，相加是 74,765 輛，
   * 卻被標成「輛／平假日合計」放在同一格裡。
   *
   * 同一個模式下的「尖峰」欄本來就已經是取兩天之中較大的那個、並標明是哪一天
   * （不是把 2,779.5 與 2,134 相加），所以這裡是把總量補齊成同一種作法。
   */
  dayType: string;
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
  /*
   * 這一列底下那幾筆紀錄的調查日期（ISO，已去重、已排序）。
   *
   * 使用者 2026-09-11：「請新增讓我在切換顯示調查月份時，也能看出
   *   哪一個路口／路段是在 X 月做的這項功能。」
   * 期別標籤只寫得出整季的合寫（「115年4、5月」），看不出**哪一筆**是哪個月。
   *
   * ⚠️ 是**陣列**不是單一值：同一個調查點的方向 A／B 可能分兩天做，
   *   硬取第一筆會寫出一個不完整的事實。有幾天就列幾天。
   *   讀不到日期的紀錄不會放進來（所以可能是空陣列）。
   */
  surveyDates: string[];
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
  /*
   * ⚠️ 稽核表 C：拉開季度區間時，**一季一列**。
   *   舊版的分組鍵只有 roadId，多季被加成同一根柱子，而表上沒有任何欄位
   *   看得出來——與可追溯明細（X-37）是同一個毛病，那邊修了、這邊沒有。
   *   只看一季時是空字串（維持舊行為，欄位也不出現）。
   */
  quarter: string;
  weekdayActual: number;
  holidayActual: number;
  weekdayPcu: number;
  holidayPcu: number;
  /*
   * 「這一季有沒有做這個日別的調查」與「做了、但量是 0」是兩件事。
   * 少了這兩個旗標，只做平日調查的季度會顯示「假日 0 輛／日、-100.0%」，
   * 讀起來像假日交通量真的掉到零。歷季趨勢那邊早就用 null 區分了
   * （見 TrendRow 的註解），平假日比較這條路徑漏掉。
   */
  weekdaySurveyed: boolean;
  holidaySurveyed: boolean;
  /** 各日別自己的調查涵蓋；不能拿目前工具列的單一日別代替。 */
  weekdayCoverage: SurveyCoverage;
  holidayCoverage: SurveyCoverage;
  /** 只有涵蓋時段完全相同，差值與百分比才有意義。 */
  coverageComparable: boolean;
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
/**
 * ══════════════════════════════════════════════════════════════════════
 *  歷季分析「一張圖多條線」時，每一條線的顏色
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：「目前反而缺少一張圖多條線……(這點三項程式都適用)」。
 *
 * ⚠️ 顏色**不是唯一的識別方式**：圖例會逐條列出「調查點・日別」，
 *   而且線尾也會直接標名稱。色盲讀者與列印成灰階的人靠的是那個名稱。
 * ⚠️ 這 8 個色都驗過與白底的對比 ≥ 3:1（圖形物件的門檻）。
 *   前兩個刻意沿用原本的 teal 與 orange，單一調查點時外觀完全不變。
 * ⚠️ 超過 8 條時**不自動生成新顏色**——生出來的一定有對比不足或
 *   兩條幾乎一樣的色。那時改成灰線，只靠名稱分辨（見 paintTrendChart）。
 */
const LINE_PALETTE = [
  "#148C8C",
  "#D55E00",
  "#0072B2",
  "#8C6D31",
  "#7A5195",
  "#B5608E",
  "#3B3B3B",
  "#1F7A8C",
];
/**
 * 線超過配色數之後的第二層識別：線型。
 *
 * ⚠️ 2026-09-18 使用者裁示（附圖，11 條線）：「不要變成深灰，而是一樣可以畫出
 *   多路段（不設置上限），讓觀看者辨認的方式可以靠顏色、線條的虛實線或其他方式，
 *   讓使用者對照圖例去區分出來就好」。所以第 9～16 條沿用同一組顏色改畫虛線、
 *   第 17～24 條點線、第 25～32 條一長一短，圖例的色塊畫同一種線型。
 *   線尾不再標名稱（同一次裁示：底下已有圖例，線尾名稱會互相重疊）。
 */
const LINE_DASHES: number[][] = [[], [9, 5], [2, 4], [10, 4, 2, 4]];
function lineStyleOf(index: number) {
  return {
    color: LINE_PALETTE[index % LINE_PALETTE.length],
    dash: LINE_DASHES[Math.floor(index / LINE_PALETTE.length) % LINE_DASHES.length],
  };
}
/** 一張圖多條線時的一條線。values 與 rows 等長、同順序。 */
export type TrendLine = {
  label: string;
  color: string;
  /** 虛實線型（setLineDash 的陣列；省略＝實線）。 */
  dash?: number[];
  values: (number | null)[];
};
/**
 * 匯出檔內附的 7 張可編輯原生圖表，順序與下面 chartSpecs 完全相同。
 *
 * ⚠️ 這份清單**必須逐張對應 chartSpecs**，不可以拿它當「系列名稱」用。
 *
 * v20.63 以前這裡有 9 個字串、chartSpecs 也剛好是 9 張，於是看起來一致——
 * 但那是**兩個錯誤剛好抵消**：
 *   ・「每小時實際量」與「每小時當量交通量」其實是**同一張圖的兩條線**，
 *     卻寫成兩個字串（多算 1 張）
 *   ・「跨計畫比較」是**一個字串對兩張圖**（少算 1 張）
 * 移除跨計畫比較之後抵消不掉了，清單變 8、實際只產生 7 張，
 * E2E 才把它抓出來。現在改成逐張對應，數字才有意義。
 *
 * ⚠️ 這個常數的長度是使用者看得到的數字（畫面上寫「N 張可編輯原生圖表」），
 * 改動時 report-draft.ts 的段落名稱、手冊與 E2E 的斷言都要一起改。
 */
const EXPORT_CHART_TITLES = [
  "全日實際交通量",
  "全日當量交通量（PCU）",
  "平假日比較",
  "歷季全日量趨勢",
  "車種組成圓餅",
  "車種歷季比例",
  "每小時實際量與PCU",
] as const;
/**
 * 「各調查點分項結果」最多逐點敘述幾個調查點。
 * 每個點會寫成一個標題加「方向 × 時段」數行，點一多整段就長到沒人看得完；
 * 超過的部分在段末說明還有幾個點。
 */
const ROAD_SUMMARY_LIMIT = 30;
/*
 * ── 計畫名稱與計畫編號的字數上限 ─────────────────────────────
 *
 * 使用者實測回報過兩次：
 *   ①「當我把計畫名稱故意設定很長的時候，左邊計畫名稱卡片明顯突破邊界，
 *      並沒有自動換行……針對長名稱的計畫，請讓名稱自動換行（三份程式都是）」
 *   ②「計畫名稱沒問題了，但忘記限制計畫編號（三個程式都是），
 *      當編號過長時會遮蓋到計畫名稱，請也一樣做調整（設上限或換行）」
 *
 * 定案是**上限與換行兩個都做**，不是二選一：
 *   ・上限擋得住**新輸入**的資料。
 *   ・換行擋得住**已經存在**的舊資料——上限只擋新輸入，
 *     既有超長的名稱或編號不可以被截斷、也不可以擋住編輯。
 *
 * ⚠️ 40 這個數字有實測依據：實際案名「高捷岡山路竹延伸線RKC02標」是 15 字，
 * 40 字留了很寬裕的空間，同時足以擋掉會撐破側欄的長度（實測 60 字的名稱
 * 讓卡片超出容器 265px）。編號比名稱短得多，20 字已經很寬鬆。
 *
 * ⚠️ 三支程式（全日交通量、路口轉向、交通服務水準）刻意用同一組數字。
 */
export const PROJECT_NAME_LIMIT = 40;
export const PROJECT_CODE_LIMIT = 20;
/**
 * 套用字數上限，但**絕對不截斷既有的超長內容**。
 *
 * ⚠️ 這裡不可以只寫 `next.slice(0, limit)`。使用者硬碟裡可能已經有一個
 * 60 字的計畫名稱（上限是這一版才加的）。他打開改名視窗、只想刪掉一個
 * 錯字，onChange 收到 59 字，`slice(0, 40)` 會當場把後面 19 個字吃掉，
 * 而畫面上不會有任何提示——這是**靜靜掉資料**，比不加上限還糟。
 *
 * 規則：允許的長度是「上限」與「原本就有的長度」之中**較大的那一個」。
 * 於是新輸入被擋在上限，既有的長內容可以原樣保留、也可以自由縮短，
 * 但不能再變得更長。
 */
export function capText(next: string, previous: string, limit: number): string {
  const allowed = Math.max(limit, previous.length);
  return next.length <= allowed ? next : next.slice(0, allowed);
}
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
/*
 * ── 依「季別 × 路段」覆寫的係數 ──────────────────────────────
 *
 * 使用者 2026-09-10：「初始的預設自然是設定一次，套用全季度＋全路段。
 * 有需求的使用者，就到當量係數設定畫面，去按自己的需求（不同季度）
 * （不同路段）套用不同的標準。」
 *
 * ⚠️ **上面那兩個鍵沒有改動**。它們存的就是「全季別 × 全路段」那一組，
 *   也就是解析順位裡最粗的那一層。所以：
 *   ・舊資料不需要轉檔，讀進來就是原本的行為
 *   ・沒有建立任何覆寫的使用者，一個數字都不會變
 *   ・舊版程式讀到新版的備份時，仍然讀得到那一組預設係數
 *   這是刻意的設計，不是偷懶——新增一個鍵去存預設值的話，
 *   上面每一條相容性都要自己另外做一次。
 */
const PCU_SCOPES_BY_PROJECT_KEY = "traffic-pcu-scopes-by-project-v1";

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
    const raw = JSON.parse(
      localStorage.getItem(CONCLUSION_TEMPLATE_KEY) || "{}",
    );
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
  if (!projectId || typeof localStorage === "undefined") return false;
  let map: Record<string, ConclusionTemplate[]> = {};
  try {
    const raw = JSON.parse(
      localStorage.getItem(CONCLUSION_TEMPLATE_KEY) || "{}",
    );
    if (raw && typeof raw === "object") map = raw;
  } catch {
    map = {};
  }
  map[projectId] = templates;
  return safeWrite(CONCLUSION_TEMPLATE_KEY, map);
}

/*
 * 沒有計畫 id 就寫不進去，必須回報 false。
 *
 * 舊版這兩個函式在 projectId 為空時回傳 true（＝「已寫入」），可是實際上
 * 一個位元組都沒寫。加上還原備份那條路徑誤用了 activeProject（在自動建立
 * 計畫的同一個函式裡，React 狀態還沒更新，它是空字串），結果是：
 * 換一台電腦、還沒有任何計畫時還原備份，畫面顯示還原完成、係數也確實
 * 變成備份裡的值，但 localStorage 是空的，重新整理後無聲退回預設值，
 * 所有 PCU 數字跟著改變而使用者不會收到任何警告。
 *
 * 「寫不進去卻回報成功」是這支程式裡最該杜絕的一類錯誤，因此這裡回傳
 * false，由呼叫端負責說明原因。
 */
function writeProjectPcuFactors(projectId: string, factors: PcuFactors) {
  if (!projectId) return false;
  const map = readMap(PCU_BY_PROJECT_KEY);
  map[projectId] = factors;
  return safeWrite(PCU_BY_PROJECT_KEY, map);
}
function writeProjectTurnPcuFactors(
  projectId: string,
  factors: TurnPcuFactors,
) {
  if (!projectId) return false;
  const map = readMap(TURN_PCU_BY_PROJECT_KEY);
  map[projectId] = factors;
  return safeWrite(TURN_PCU_BY_PROJECT_KEY, map);
}

/*
 * 依「季別 × 路段」的當量係數覆寫，也是依計畫存的。
 *
 * ⚠️ 2026-09-12 註：這一段（isValidScope／readProjectPcuScopes／
 *   writeProjectPcuScopes／PROJECT_SCOPED_KEYS／dropProjectScopedStorage）
 *   是我在移除「尖峰時段設定」時誤刪、再照編譯後的 bundle 逐行還原回來的。
 *   **行為與原本逐行相同**（已用單元測試與 e2e 驗證），但原本寫在這裡的
 *   說明註解沒有救回來，只剩下面這幾句。若日後有人覺得這裡的說明比別處薄，
 *   原因在此，不是因為它不重要。
 */
function isValidScope(value: unknown): value is PcuScopes[number] {
  if (!value || typeof value !== "object") return false;
  const raw = value as { quarter?: unknown; roadId?: unknown; factors?: unknown };
  if (typeof raw.quarter !== "string" || typeof raw.roadId !== "string")
    return false;
  const factors = raw.factors as
    | { core?: unknown; coreTurns?: unknown }
    | undefined;
  if (!factors || typeof factors !== "object") return false;
  return isValidPcu(factors.core) && isValidTurnPcu(factors.coreTurns);
}

function readProjectPcuScopes(projectId: string): PcuScopes {
  if (!projectId) return [];
  const raw = readMap(PCU_SCOPES_BY_PROJECT_KEY)[projectId];
  return Array.isArray(raw) ? (raw.filter(isValidScope) as PcuScopes) : [];
}

function writeProjectPcuScopes(projectId: string, scopes: PcuScopes) {
  if (!projectId) return false;
  const map = readMap(PCU_SCOPES_BY_PROJECT_KEY);
  // 空陣列＝沒有覆寫，直接把這個計畫的項目刪掉，不要留一個空陣列在儲存區。
  if (scopes.length) map[projectId] = scopes;
  else delete map[projectId];
  return safeWrite(PCU_SCOPES_BY_PROJECT_KEY, map);
}

/**
 * 刪除計畫時要一併清掉的「依計畫存放」儲存鍵。
 *
 * ⚠️ 日後新增一種依計畫存放的資料時只要加進 PROJECT_SCOPED_KEYS，刪除路徑
 * 就會自動跟上——分散寫的話，新增的那一個會被漏掉，而且不會有任何跡象
 *（殘留的設定會在下次建立同代碼的計畫時無聲生效）。
 */
const PROJECT_SCOPED_KEYS = [
  PCU_BY_PROJECT_KEY,
  TURN_PCU_BY_PROJECT_KEY,
  PCU_SCOPES_BY_PROJECT_KEY,
  CONCLUSION_TEMPLATE_KEY,
] as const;

function dropProjectScopedStorage(projectId: string) {
  if (!projectId || typeof localStorage === "undefined") return;
  for (const key of PROJECT_SCOPED_KEYS) {
    const map = readMap(key);
    if (!(projectId in map)) continue;
    delete map[projectId];
    safeWrite(key, map);
  }
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
    const settings = buildArmSettings(
      projectId,
      roadId,
      [...codes],
      savedSettings,
    );
    routesByRoad.set(
      roadId,
      new Map(
        settings.map((setting) => [setting.directionCode, setting.routes]),
      ),
    );
  }
  return rows.map((row) => {
    if (!row.destinationCounts) return row;
    const routes = routesByRoad.get(row.roadId)?.get(row.directionCode) ?? {};
    const turnData: TurnCounts = {};
    for (const [vehicle, byDestination] of Object.entries(
      row.destinationCounts,
    )) {
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
  /*
   * 依季別／路段的係數覆寫。
   * ⚠️ 沒有覆寫（undefined 或空陣列）時，這一支的結果與改版前**逐位元相同**——
   *   resolveFactors() 會原樣回傳傳進去的那一組。
   * ⚠️ 這個參數放在**最後**是刻意的：既有的呼叫端一個都不用改就仍然正確，
   *   要吃到覆寫的地方才明確加上去。漏加的後果是「用了計畫預設」，
   *   也就是舊行為，不會算出第三種數字。
   */
  scopes?: PcuScopes | null,
) {
  return sumVehiclePcu(r, factors, turnFactors, vehicleSettings, scopes);
}
function pct(value: number, total: number) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : "0.0%";
}
/**
 * 每一個日別各自的尖峰（平日一個、假日一個）。
 *
 * 使用者 2026-09-12：「為什麼全日實際交通量、24小時PCU都有分平日和假日，
 * 尖峰小時當量交通量沒有分平假日呢? …不是平日和假日各自當天的尖峰小時的
 * 交通量嗎?」——他是對的。
 *
 * 舊版的尖峰卡片只印**最大的那一個日別**（peakOf 回傳的就是最大值），
 * 所以平日尖峰比較大的時候，**假日尖峰整個不見**，而旁邊兩張卡片
 * 都好好地分成兩行。同一排卡片對「平日＋假日」給兩種口徑。
 *
 * ⚠️ 走的是與 peakOf 同一支 peaksByDay()，不是另外寫一套——
 *   否則「卡片上的平日尖峰」與「整體尖峰剛好是平日」會出現兩個不同的數字。
 */
function peaksByDayOf(
  records: TrafficRecord[],
  factors: PcuFactors = PCU_FACTORS,
  turnFactors: TurnPcuFactors = TURN_PCU_FACTORS,
  vehicleSettings: VehicleClassSetting[] = [],
  scopes?: PcuScopes | null,
): { day: string; label: string; value: number; start: number }[] {
  const hourly = new Map<string, number>();
  records.forEach((r) => {
    const key = `${r.dayType}|${r.hour}`;
    hourly.set(
      key,
      (hourly.get(key) ?? 0) +
        sumPcu(r, factors, turnFactors, vehicleSettings, scopes),
    );
  });
  return peaksByDay(hourly);
}
function peakOf(
  records: TrafficRecord[],
  factors: PcuFactors = PCU_FACTORS,
  turnFactors: TurnPcuFactors = TURN_PCU_FACTORS,
  vehicleSettings: VehicleClassSetting[] = [],
  separateDays = false,
  /*
   * ⚠️ 尖峰是**用 PCU 挑出來的**，所以係數覆寫會改變「尖峰是哪一小時」。
   *   這裡一定要跟著傳，否則會出現「尖峰時段用預設係數挑、
   *   尖峰的量用覆寫係數算」——兩個數字各自都合理，合起來卻不是同一件事。
   */
  scopes?: PcuScopes | null,
): [string, number] {
  const hourly = new Map<string, number>();
  records.forEach((r) => {
    const key = separateDays ? `${r.dayType}|${r.hour}` : r.hour;
    hourly.set(
      key,
      (hourly.get(key) ?? 0) +
        sumPcu(r, factors, turnFactors, vehicleSettings, scopes),
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
/**
 * 圖上一個資料點的畫面座標與數值。
 *
 * ⚠️ 這個型別刻意抽到元件外面。原本是在 effect 裡寫 `typeof pointGeom.points`，
 *   雖然只是型別位置、執行期完全沒有用到那個 state，
 *   react-hooks/exhaustive-deps 仍然把它算成相依項並要求列進 deps——
 *   照做的話就變成「effect 改 state → state 進 deps → effect 再跑」的迴圈。
 *   抽成獨立型別之後，effect 裡就沒有任何一處提到 pointGeom 了。
 */
type ChartPoint = {
  x: number;
  y: number;
  label: string;
  series: string;
  color: string;
  value: number;
};

/**
 * ══════════════════════════════════════════════════════════════════════
 *  歷季趨勢的逐季資料（畫面、匯出、講稿共用同一支）
 * ══════════════════════════════════════════════════════════════════════
 *
 * `records` 必須是**已經篩好調查點**的紀錄；要一個調查點一條線時，
 * 就一個調查點呼叫一次，並把 `quarters` 指定成同一條 X 軸。
 *
 * ⚠️ 這一支**不新增任何交通量算法**：每一種指標都是呼叫既有、已被測試釘住的
 *   函式（sumVehicles／sumPcu／effectiveVehicleCounts／peakFromBuckets）算出來的。
 */
export function buildTrendRows(
  records: TrafficRecord[],
  opts: {
    trendMetric: TrendMetricId;
    trendMode: string;
    activeTrendVehicle: string;
    pcuFactors: PcuFactors;
    turnPcuFactors: TurnPcuFactors;
    vehicleClassSettings: VehicleClassSetting[];
    pcuScopes?: PcuScopes | null;
    /** 指定 X 軸的季度順序；不給就照 records 自己的範圍補齊。 */
    quarters?: string[];
  },
): TrendRow[] {
  const {
    trendMetric,
    trendMode,
    activeTrendVehicle,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    pcuScopes,
  } = opts;
    const map = new Map<string, TrendRow>();
    /* 佔比類指標的分子分母（不能把百分比逐筆相加）。 */
    const share = new Map<
      string,
      {
        weekdayShare: { top: number; bottom: number; has: boolean };
        holidayShare: { top: number; bottom: number; has: boolean };
      }
    >();
    /*
     * 尖峰小時類指標要**先把同一季同一日別的紀錄湊在一起**再挑尖峰，
     * 不能逐筆算。
     *
     * ⚠️ 這一點是關鍵：選「全部路段合計」時，把各路段**各自的**尖峰小時
     * 加起來是一個不存在的數字——A 路段的尖峰在早上 8 點、B 在下午 6 點，
     * 兩者相加不對應任何一個真實的小時。正確的做法是先把各路段同一小時的
     * 量加起來，再從中挑最忙的那一小時（＝路網的尖峰小時）。
     * peakFromBuckets 也會處理 15 分鐘一格的滾動視窗。
     */
    const peakBuckets = new Map<
      string,
      { weekday: Map<string, number>; holiday: Map<string, number> }
    >();
    records.forEach((r) => {
        const x = map.get(r.quarter) ?? {
          quarter: r.quarter,
          /*
           * 預設 null 而不是 0：一個「只做了平日調查」的季度，假日應該是
           * 「沒有這種日別的資料」（斷線／空白），不是「假日交通量是 0」。
           */
          weekday: null as number | null,
          holiday: null as number | null,
        };
        /*
         * 指標的值。
         *
         * ⚠️ 這裡**沒有新增任何交通量算法**：每一種都是呼叫既有、已被測試
         * 釘住的函式（sumVehicles／sumPcu／effectiveVehicleCounts）算出來的。
         * 在趨勢圖裡再實作一次就會有第二個來源，兩套遲早分岔。
         *
         * 佔比類指標不能逐筆相加（把百分比加起來沒有意義），所以分子分母
         * 分開累計，最後再相除——見下面的 share 累計。
         */
        /*
         * ⚠️ 用**歸類後的類型**（effectiveVehicleCounts），不是原始車種。
         *   理由與 trendVehicleOptions 那一段相同：下拉列的是類型，
         *   這裡就必須用同一組鍵去取數字，否則選了「機車」卻只拿到原生機車，
         *   與「車種組成」那一塊差一個數字而沒有任何說明。
         *   （2026-09-15 修正；大車比例本來就已經是用這一份算的。）
         */
        const counts = effectiveVehicleCounts(r, vehicleClassSettings);
        const totalCount = sumVehicles(r);
        let v: number | null = null;
        let numerator: number | null = null;
        if (trendMetric === "actual") v = totalCount;
        else if (trendMetric === "pcu")
          v = sumPcu(
            r,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            pcuScopes,
          );
        else if (trendMetric === "vehicleClass")
          v = Number(counts[activeTrendVehicle] ?? 0);
        else if (trendMetric === "vehicleShare") {
          numerator = Number(counts[activeTrendVehicle] ?? 0);
          v = totalCount;
        } else if (trendMetric === "heavyShare") {
          /*
           * ── 大車 ＝ 非機車類型、非小型車類型的全部 ───────────────
           *   （使用者 2026-09-15 定案；與車種組成那一塊的說明同一個口徑）
           *
           * ⚠️ 兩件事都要做對，少一件就會算錯：
           *
           *   ① **用歸類後的數字**（effectiveVehicleCounts），不是 rawVehicleCounts。
           *      使用者把「電動機車」併進機車時，它就是機車類型、不算大車；
           *      用原始數字會把它算進大車。
           *   ② **扣掉機車與小型車就是大車**，不是「只加 large ＋ special」。
           *      舊版只加那兩類，於是大客車、大貨車、聯結車這些**自訂而未歸類**
           *      的車種整組被漏掉——同一批資料，這裡算 23.8%、
           *      車種組成那一塊算 42.7%（2026-09-15 實測）。
           */
          const typed = effectiveVehicleCounts(r, vehicleClassSettings);
          const light =
            Number(typed.motorcycle ?? 0) + Number(typed.small ?? 0);
          numerator = Math.max(0, totalCount - light);
          v = totalCount;
        } else if (
          trendMetric === "peakHour" ||
          trendMetric === "peakHourPcu"
        ) {
          /* 逐小時累計，等這一季收齊了再挑尖峰（見上面的說明）。 */
          const acc = peakBuckets.get(r.quarter) ?? {
            weekday: new Map<string, number>(),
            holiday: new Map<string, number>(),
          };
          const bucket = r.dayType === "平日" ? acc.weekday : acc.holiday;
          const amount =
            trendMetric === "peakHour"
              ? totalCount
              : sumPcu(
                  r,
                  pcuFactors,
                  turnPcuFactors,
                  vehicleClassSettings,
                  pcuScopes,
                );
          bucket.set(r.hour, (bucket.get(r.hour) ?? 0) + amount);
          peakBuckets.set(r.quarter, acc);
          v = null;
        }
        if (v !== null) {
          if (numerator === null) {
            if (r.dayType === "平日") x.weekday = (x.weekday ?? 0) + v;
            else x.holiday = (x.holiday ?? 0) + v;
          } else {
            /* 佔比：分子分母各自累計，最後一起相除。 */
            const bucket =
              r.dayType === "平日" ? "weekdayShare" : "holidayShare";
            const acc = share.get(r.quarter) ?? {
              weekdayShare: { top: 0, bottom: 0, has: false },
              holidayShare: { top: 0, bottom: 0, has: false },
            };
            acc[bucket].top += numerator;
            acc[bucket].bottom += v;
            acc[bucket].has = true;
            share.set(r.quarter, acc);
          }
        }
        map.set(r.quarter, x);
      });
    /*
     * 頭尾之間**整季沒有資料**的季度要補成空格。
     *
     * 不補的話 X 軸只排有資料的那幾季，113Q1 與 114Q1 會緊鄰成兩格，
     * 折線看起來像「上一季到這一季」的變化——實際上中間隔了整整一年。
     * 補出來的空季值一律 null，折線會在那裡斷開。
     */
    const ordered = [...map.values()].sort((a, b) =>
      compareQuarters(a.quarter, b.quarter),
    );
    /*
     * ⚠️ 指定 quarters 時**照著它排**，不可以自己再算一次季度範圍。
     *   「一個調查點一條線」時每一條線都要落在**同一條 X 軸**上——
     *   各自算的話，只做了兩季的那個點會被排到別人的位置去，
     *   而畫面上完全看不出來（線照樣畫得出來，只是對錯季）。
     */
    const filled = (
      opts.quarters ?? completeQuarterRange(ordered.map((r) => r.quarter))
    ).map(
      (quarter) =>
        map.get(quarter) ?? { quarter, weekday: null, holiday: null },
    );
    return (
      filled
        /*
         * 被篩掉的那一條要給 null（不畫），不能給 0。
         * 給 0 的話那條線不會消失，而是變成沿著 X 軸的一條水平直線、每一季
         * 都有一個實心圓點，圖例也還列著——看起來像「這幾季假日交通量真的是
         * 0」。同一批 trendRows 也會進 Excel 的折線圖，錯誤會一起交出去。
         */
        .map((r) => {
          /*
           * 佔比類指標到這裡才相除。
           *
           * ⚠️ 分母為 0 時**不可以**回 0%——那會被讀成「這個車種一台都沒有」，
           * 而事實是「這一季沒有可以當分母的車輛數」。回 null 讓折線斷開。
           */
          const acc = share.get(r.quarter);
          const ratio = (bucket: "weekdayShare" | "holidayShare") => {
            const item = acc?.[bucket];
            if (!item || !item.has) return null;
            return item.bottom ? (item.top / item.bottom) * 100 : null;
          };
          const isShare =
            trendMetric === "vehicleShare" || trendMetric === "heavyShare";
          const isPeak =
            trendMetric === "peakHour" || trendMetric === "peakHourPcu";
          const peak = peakBuckets.get(r.quarter);
          /* 完全沒有那一種日別的資料時要回 null（斷線），不是 0。 */
          const peakValue = (bucket?: Map<string, number>) => {
            if (!bucket || !bucket.size) return null;
            const best = peakFromBuckets(bucket);
            return Number.isFinite(best.value) ? best.value : null;
          };
          const weekday = isShare
            ? ratio("weekdayShare")
            : isPeak
              ? peakValue(peak?.weekday)
              : r.weekday;
          const holiday = isShare
            ? ratio("holidayShare")
            : isPeak
              ? peakValue(peak?.holiday)
              : r.holiday;
          return {
            quarter: r.quarter,
            weekday: trendMode === "假日" ? null : weekday,
            holiday: trendMode === "平日" ? null : holiday,
          };
        })
    );
}

function ProfessionalLineChart({
  rows,
  unit,
  yTitle,
  canvasRef,
  quarterLabels,
  lines,
}: {
  rows: TrendRow[];
  /**
   * 多個調查點時「一個調查點一條線」。給了就**不畫** rows 的平日／假日，
   * 因為那兩欄是跨調查點的合計——正是不可以出現的那個數字。
   */
  lines?: TrendLine[];
  unit: string;
  /**
   * 縱軸要寫的整串字：「名稱（單位）」。
   * 由上層依所選指標算好傳進來——圖表不自己再組一次，
   * 否則同一張圖的標題、軸名稱與匯出檔名會出現三種寫法。
   */
  yTitle: string;
  /** 讓上層拿得到畫布，才能把它存成 PNG。 */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  /**
   * X 軸每一季要印的字。由上層統一算好傳進來（季別或實際調查月份），
   * 圖表不自己再寫一套——同一個季別在下拉選單與 X 軸上必須是同一個字。
   * 查不到就原樣印季別。
   */
  quarterLabels?: Record<string, string>;
}) {
  const own = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? own;
  /*
   * ── 數值標籤：少量直接標、量多改成滑鼠移上去 ────────────────
   *
   * 使用者定案（路口轉向 2026-09-10，2026-09-11 指名三支同步）：
   *   「在資料數列少的時候做到不重疊沒有問題，但資料一多，其實還是改成
   *     滑鼠移上去才顯示數值就很夠用……匯出的圖則統一為乾淨版。」
   *
   * ⚠️ 標籤**不畫在畫布上**，改成畫布正上方的一層 HTML。
   *   理由是匯出：這張圖的 PNG 是 canvas.toDataURL 出來的，
   *   畫在畫布上就一定會跟著印出去，要「匯出淨空」就得在匯出前後各重畫
   *   一次——那等於同一張圖有兩條繪圖路徑，遲早分岔。
   *   放在 HTML 層的話，畫布本身**從頭到尾就是淨空版**，匯出不必做任何事。
   *   順帶一個好處：守門讀得到 DOM 節點，不必去畫布上認像素。
   *
   * 門檻與路口轉向一致：標籤總數（線數 × 有值的季數）≤ 8 才永遠顯示。
   */
  const [pointGeom, setPointGeom] = useState<{
    key: string;
    points: ChartPoint[];
    /*
     * 繪圖區的左右界（CSS px）。標籤要不要換對齊基準，看的是
     * **離繪圖區的邊**多遠，不是離畫布的邊多遠——畫布左邊那 78px
     * 是縱軸刻度文字的地盤，標籤壓進去就會和「600,000」疊在一起
     *（2026-09-11 使用者實測截圖就是這個症狀）。
     */
    plotLeft: number;
    /** 縱軸刻度數字的右緣（畫布座標）。靠左的標籤要離它夠遠。 */
    axisTextRight: number;
    plotRight: number;
  }>({ key: "", points: [], plotLeft: 0, plotRight: 0, axisTextRight: 0 });
  const [hoverIndex, setHoverIndex] = useState(-1);
  // 重畫的觸發條件除了資料以外，還要包含「畫布尺寸改變」。畫布是照實際
  // 尺寸以實體像素重畫的，只綁資料的話，改變視窗大小或切換版面之後畫面
  // 會維持舊解析度被拉伸，線條變糊、座標軸文字也跟著歪掉。
  const [canvasSize, setCanvasSize] = useState("");
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box)
        setCanvasSize(`${Math.round(box.width)}x${Math.round(box.height)}`);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [ref]);
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
    const geom = paintTrendChart(c, width, height, {
      rows,
      yTitle,
      quarterLabels,
      lines,
    });
    /*
     * 用內容當鍵：內容沒變就回傳同一個物件，React 會跳過這次更新，
     * 不會變成「effect 改 state → 重畫 → 再改 state」的無窮迴圈。
     */
    const geomKey = JSON.stringify([geom.points, geom.plotLeft, geom.plotRight]);
    setPointGeom((prev) => (prev.key === geomKey ? prev : { key: geomKey, ...geom }));
  }, [rows, unit, yTitle, canvasSize, quarterLabels, lines, ref]);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-46：數值標籤**一律改成滑鼠移上去才顯示**（使用者 2026-09-16 裁示）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者原話：
   *   「又再次出現標籤重疊的問題。如果一直出現這個問題，
   *     是否統一一律改為滑鼠移上去才顯示數字呢?」
   *
   * ⚠️ 舊版是「標籤總數 ≤ 8 就永遠顯示」。使用者截圖那張正好是
   *   2 條線 × 4 季 ＝ 8 個，剛好踩在門檻上，於是全部畫出來、疊成一團。
   *   把門檻調小只是把同一個問題往後推——每加一條線、每多一季就會再犯。
   *   **拿掉才是根治。**
   *
   * ⚠️ 底下那一整套「標籤避讓」的計算**刻意保留**：hover 時同一季的兩條線
   *   仍然可能重疊（值很接近時），那時照樣需要推開。
   * ⚠️ 下載的高解析 PNG 本來就是淨空版（標籤畫在 HTML 層，畫布不畫），
   *   使用者 2026-09-16 再次確認「PNG高清晰圖 要淨空版」——不用改。
   * ⚠️ 可編輯 Excel 走的是另一條路徑（原生圖表），數字照樣標。
   */
  const active = hoverIndex >= 0 ? [hoverIndex] : [];
  /*
   * ── 同一季的兩條線值太接近時，標籤會疊在一起 ────────────────────
   *
   * 使用者 2026-09-14（附圖）：「選擇平假日時，數字標籤重疊」。
   * 截圖上是「平日 56.8」與「假日 56.3」壓成一團，兩個數字都讀不出來。
   *
   * 成因：標籤是釘在資料點正上方的（left:x, top:y）。平日與假日在同一季
   * 是**同一個 x**，值只差 0.5 時 y 也幾乎相同，兩個標籤就重疊。
   * 這不是偶發：佔比類的指標平假日本來就常常很接近。
   *
   * 作法：同一個 x 的點由上而下排好，後一個若和前一個距離不足一行高，
   * 就往下推到剛好一行高。只推**標籤**，資料點與折線一個像素都沒動。
   *
   * ⚠️ 推的是「不夠遠的那些」，不是「全部都推」——值本來就差很遠時
   *   維持釘在自己的點上方，那樣才看得出哪個標籤屬於哪一條線。
   */
  const LABEL_LINE = 13;
  /*
   * ── 標籤避讓：同一欄**和相鄰欄**都要避 ────────────────────────
   *
   * ⚠️ 舊版只處理「同一個 x」（同一季的平日與假日上下排開），
   *   **相鄰兩季之間完全沒有處理**。
   *
   * 使用者 2026-09-15（附圖）：「平假日的數字標籤在圖中重疊了」——
   *   截圖上 115Q1 的「平日 32,262」和 115Q2 的「平日 31,847」黏在一起，
   *   兩個點的 x 差得夠遠，但**標籤比點的間距還寬**，所以疊在一起。
   *   只看同一個 x 的話，這種重疊一輩子都看不到。
   *
   * 改成真正的矩形避讓：依 x 由左至右、同 x 再由上至下放，
   * 每一個標籤與**已經放好的每一個**比對矩形；重疊就往下推一行，
   * 直到不重疊為止。只推標籤，資料點與折線一個像素都沒動。
   *
   * ⚠️ 寬度是**估**的（沒有 DOM 可量：這一段在 render 階段跑）。
   *   估法：中日文字寬約 12px、其餘約 7.2px，再加左右各 4px 的內距。
   *   寧可估寬一點——估窄會漏掉真正的重疊，那正是這一次的毛病。
   */
  const labelShift = (() => {
    const shift = new Map<number, number>();
    const widthOf = (text: string) => {
      let width = 8;
      for (const ch of text) width += /[\u3000-\u9fff]/.test(ch) ? 12 : 7.2;
      return width;
    };
    const multi = pointGeom.points.some(
      (other, _i, all) => other.series !== all[0]?.series,
    );
    const placed: { x1: number; x2: number; y1: number; y2: number }[] = [];
    const order = [...active].sort((a, b) => {
      const pa = pointGeom.points[a];
      const pb = pointGeom.points[b];
      if (!pa || !pb) return 0;
      return pa.x - pb.x || pa.y - pb.y;
    });
    for (const index of order) {
      const point = pointGeom.points[index];
      if (!point) continue;
      const text = `${multi ? `${point.series} ` : ""}${point.label}`;
      const width = widthOf(text);
      /* 對齊基準與畫面上那一層一致（start／end／置中）。 */
      const anchor =
        point.x <= pointGeom.plotLeft + 46
          ? "start"
          : point.x >= pointGeom.plotRight - 46
            ? "end"
            : "mid";
      const x1 =
        anchor === "start"
          ? point.x
          : anchor === "end"
            ? point.x - width
            : point.x - width / 2;
      const x2 = x1 + width;
      let y1 = point.y;
      let guard = 0;
      while (
        guard < 40 &&
        placed.some(
          (box) =>
            x1 < box.x2 &&
            x2 > box.x1 &&
            y1 < box.y2 &&
            y1 + LABEL_LINE > box.y1,
        )
      ) {
        y1 += LABEL_LINE;
        guard += 1;
      }
      if (y1 !== point.y) shift.set(index, y1 - point.y);
      placed.push({ x1, x2, y1, y2: y1 + LABEL_LINE });
    }
    return shift;
  })();

  /* 滑鼠位置換算成「離哪一個點最近」。感應半徑比看得見的點大一圈才好對準。 */
  const pickPoint = (event: React.MouseEvent<HTMLCanvasElement>) => {
    /* X-46：標籤一律 hover 才顯示，所以這裡不再有「永遠顯示就不必挑點」的捷徑。 */
    const box = event.currentTarget.getBoundingClientRect();
    const mx = event.clientX - box.left;
    const my = event.clientY - box.top;
    let best = -1;
    let bestDistance = 16; /* 超過 16px 就當成沒有停在任何點上 */
    pointGeom.points.forEach((point, index) => {
      const distance = Math.hypot(point.x - mx, point.y - my);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    setHoverIndex((prev) => (prev === best ? prev : best));
  };
  return (
    <div className="trend-canvas-wrap">
      <canvas
        ref={ref}
        className="trend-canvas"
        aria-label="歷季平日與假日趨勢圖"
        onMouseMove={pickPoint}
        onMouseLeave={() => setHoverIndex(-1)}
      />
      {/*
       * ⚠️ 這一層是**純顯示**，一定要 pointer-events: none。
       *   不然標籤本身會擋住底下的畫布，滑鼠一移到標籤上就等於離開資料點，
       *   標籤消失、然後又出現——閃爍到沒辦法看。
       */}
      {/*
       * ⚠️ 把繪圖區的左右界寫成 data-*，是給端對端測試量的，不是裝飾。
       *
       * 使用者 2026-09-11 回報「數字標籤與圖重疊」——最左邊那一季的標籤
       * 壓在縱軸刻度「600,000」上。當時測試是綠的，因為它量的是
       * .trend-canvas-wrap（整張畫布）的左右緣，而縱軸刻度**也在畫布裡面**，
       * 標籤壓到刻度並沒有超出畫布，所以量不出來。
       *
       * 正確的界線是**繪圖區**（縱軸刻度的右邊），而那個數字只有畫圖的
       * 程式知道。與其讓測試去猜邊界（猜錯就又是一次假通過），
       * 不如把真正用來定位的那兩個值直接標出來。
       */}
      <div
        className="chart-value-layer"
        aria-hidden="true"
        data-plot-left={pointGeom.plotLeft}
        data-plot-right={pointGeom.plotRight}
        data-axis-text-right={pointGeom.axisTextRight}
      >
        {active.map((index) => {
          const point = pointGeom.points[index];
          if (!point) return null;
          return (
            <span
              key={`${point.series}-${index}`}
              className={
                hoverIndex === index
                  ? "point-value point-value-hover"
                  : "point-value"
              }
              /*
               * ⚠️ 靠邊的標籤要換一個對齊基準。
               *   預設是以點為中心（translate(-50%)），最左與最右那一季的
               *   標籤會有一半跑到繪圖區外面，窄螢幕上直接被切掉。
               *   離邊 46px 以內就改成貼齊那一側。
               */
              data-anchor={
                point.x <= pointGeom.plotLeft + 46
                  ? "start"
                  : point.x >= pointGeom.plotRight - 46
                    ? "end"
                    : "mid"
              }
              /*
               * ⚠️ 文字顏色**不可以用系列色**。
               *   第一版直接套 palette.orange，實測對白底只有 2.62:1
               *   （AA 需 4.5:1），e2e-chart-notes 的全頁對比掃描當場紅。
               *   專案早就定過這條規則：「數值標籤一律用文字色」——
               *   顏色是給圖形用的，字一律用文字色。
               *   認哪一條線靠的是標籤自己寫的「平日／假日」，不是顏色。
               */
              style={{
                left: `${point.x}px`,
                top: `${point.y + (labelShift.get(index) ?? 0)}px`,
              }}
              data-value={point.value}
              data-series={point.series}
            >
              {/* 只有兩條線都在時才標平日／假日，單線時多寫沒有意義 */}
              {pointGeom.points.some((other) => other.series !== point.series)
                ? `${point.series} `
                : ""}
              {point.label}
            </span>
          );
        })}
      </div>
    </div>
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
  /*
   * ⚠️ 轉向顏色**不用品牌色**（palette.teal／orange／blue），用下面這三個。
   *
   *   2026-09-14 使用者在車種圓環上回報「機車和大型車顏色過於接近」，
   *   那兩個正是 palette.teal(#148C8C) 與 palette.blue(#5B8DB8)——
   *   一般視覺色差只有 9.0。**同一組顏色在這張圖上代表「直行」與「右轉」**，
   *   所以這裡有一模一樣的問題，只是還沒有人點到它。
   *   先改掉，不等使用者再回報一次。
   *
   *   換成綠／橘／藍三個明確分開的色系（與路口轉向那一支用同一組，
   *   兩支程式的轉向圖看起來才是同一套東西）：
   *     直行 #0F8A45 ↔ 右轉 #0072B2　一般視覺 ΔE 25.5（原本 9.0）
   */
  const colors: Record<TurnKey, string> = {
    left: TURN_COLORS.left,
    through: TURN_COLORS.through,
    right: TURN_COLORS.right,
  };
  /*
   * ⚠️ viewBox 四周留 45px 給支線名稱。
   *   使用者 2026-09-14（附圖）：支線名稱與代碼圓圈**疊在一起**。
   *   名稱要放到圓圈外面才不會疊，放出去就需要畫布邊界留白——
   *   viewBox 放大只是加留白，圖形座標一個都沒動（center／outer 不變）。
   */
  return (
    <svg
      className="intersection-geometry-diagram"
      viewBox="-45 -45 510 510"
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
          /*
           * ⚠️ 名稱要放在**代碼圓圈的外面**。
           *   舊版半徑 190、圓圈在半徑 165 且 r=18（外緣 183），
           *   名稱的中心只離圓圈邊 7px，字一長就疊上去（使用者截圖）。
           *   改成 outer + r + 16 ＝ 199，並依方向靠左／靠右對齊，
           *   字才會往外長、不會往圓圈裡長。
           */
          label = point(setting.angle, outer + 18 + 16);
        const radian = (normalizeAngle(setting.angle) * Math.PI) / 180;
        const cos = Math.cos(radian);
        const sin = Math.sin(radian);
        /* 左右兩側靠邊對齊；上下方（cos 接近 0）維持置中，並上下讓開。 */
        const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
        const labelX = label.x + (anchor === "start" ? 3 : anchor === "end" ? -3 : 0);
        const labelY =
          anchor === "middle" ? label.y + (sin >= 0 ? 14 : -6) : label.y + 5;
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
              x={labelX}
              y={labelY}
              textAnchor={anchor}
              className="geometry-label"
            >
              {armLabel(setting.directionCode, setting.name)}
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
      {/*
        * ── 「由 X 駛出」挪到左上角 ────────────────────────────────
        *
        * 使用者 2026-09-14（附圖）：
        *   「中間圓形處的『由X駛出』文字也可以移動到畫面左上或上方，
        *     這樣才不會有超出去圓形圖案的感覺」
        *
        * ⚠️ 中央那個圓的半徑是**固定的**，而這行字的長度會隨支線代碼變動；
        *   支線一多、代碼變長，字就一定撐出圓外——而且它還壓在車流曲線上，
        *   等於同時擋住兩樣東西。挪到畫布左上角就不再有「撐出去」這件事，
        *   而且那裡本來就是空白。
        * ⚠️ x 用 -30（viewBox 從 -45 開始），比支線名稱再往左一點，
        *   才不會和最左邊那一支的名稱黏在一起。
        */}
      <text x={-30} y={-18} textAnchor="start" className="geometry-center">
        {source ? `由 ${source.directionCode} 駛出` : "路口"}
      </text>
      {/*
        * ── 圖例挪到右下角 ────────────────────────────────────────
        *
        * 使用者 2026-09-14（附圖）：
        *   「中間的 綠色:直行.... 文字已超出原圈範圍，
        *     可以挪到畫面右下角，主要作為圖例說明而已」
        *
        * ⚠️ 原本這一行是塞在中央圓圈裡的第二行字。圓圈的半徑是固定的，
        *   而這一行有 14 個字，寬度必然超出圓圈——**它一直都是超出的**，
        *   只是支線少的時候旁邊沒有東西，看起來還不明顯。
        *   而且它壓在車流曲線上，等於同時擋住兩樣東西。
        *
        * ⚠️ 它本來就只是圖例，不是「這個路口的資訊」，
        *   所以不該跟「由 X 駛出」搶中央那個位置。
        *
        * 放在 viewBox 的右下角（viewBox 是 -45 -45 510 510，
        * 所以右下角約在 x=465、y=465），用色塊＋文字直排，
        * 一眼看得出哪個顏色代表哪個轉向。
        */}
      <g className="geometry-legend">
        {(
          [
            ["through", "直行"],
            ["left", "左轉"],
            ["right", "右轉"],
          ] as [TurnKey, string][]
        ).map(([key, label], index) => {
          const y = 410 + index * 18;
          return (
            <g key={key}>
              <line
                x1={372}
                y1={y}
                x2={394}
                y2={y}
                stroke={colors[key]}
                strokeWidth="3"
                strokeLinecap="round"
              />
              <text x={400} y={y + 4} className="geometry-legend-text">
                {label}
              </text>
            </g>
          );
        })}
      </g>
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
/*
 * ══════════════════════════════════════════════════════════════════════
 *  歷季趨勢圖的繪圖本體（畫面與匯出共用同一支）
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一段**故意**從元件裡抽出來成為一支純函式。
 *
 * 「下載高解析圖片」不是把畫面上那張畫布放大——放大是內插，線條與文字
 * 都會糊，那不叫高清。這裡是以 3 倍的實體像素**重新畫一次**：
 * 座標仍然用 CSS px 描述（由 context.scale 放大），所以 3 倍圖上的文字
 * 是 3 倍清晰的文字，不是放大 3 倍的馬賽克。
 *
 * ⚠️ 而重畫一定要用**同一支**繪圖程式。畫面一套、匯出一套的話，
 *   兩套遲早分岔，而分岔的症狀是「畫面正常、交出去的那一張壞掉」——
 *   v2.1.30 匯出 SVG 讀不到樣式表就是這樣爆的，那一次整片文字重疊。
 *
 * 回傳每一個資料點的畫面座標，給畫布上方那一層 HTML 數值標籤用。
 * 座標和畫圓點走同一份算式（draw() 裡順手記下來），不另寫第二份。
 */
export function paintTrendChart(
  c: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: {
    rows: TrendRow[];
    yTitle: string;
    quarterLabels?: Record<string, string>;
    /*
     * ⚠️ 有 lines 時就畫 lines，**不畫** rows 的 weekday／holiday。
     *   兩者同時畫的話同一份資料會出現兩次（一次逐調查點、一次合計），
     *   而那個「合計」正是使用者裁示不可以做的那個數字。
     */
    lines?: TrendLine[];
  },
) {
  const { rows, yTitle, quarterLabels } = opts;
  /*
   * 多條線時每一條的定義；沒有 lines 就退回原本的平日／假日兩條，
   * 底下一律走同一條路。**單一調查點時外觀與改版前完全一樣。**
   */
  const seriesList: TrendLine[] =
    opts.lines && opts.lines.length
      ? opts.lines
      : [
          {
            label: "平日",
            color: palette.teal,
            values: rows.map((row) => row.weekday),
          },
          {
            label: "假日",
            color: palette.orange,
            values: rows.map((row) => row.holiday),
          },
        ];
  /*
   * ⚠️ 這裡**不可以**再 clearRect。
   *   匯出端（paintToCanvas）在呼叫之前已經先填了白底——白底是必要的，
   *   透明底貼到深色投影片上字會看不見。在這裡清一次會把那層白底擦掉，
   *   而畫面上完全看不出來（畫面本來就是白底的卡片），
   *   只有下載下來那一張是透明的。畫面的清除由元件自己在呼叫前做。
   */
    /*
     * 版面：左邊要留給直書的「名稱（單位）」，下面要留給 X 軸標籤、
     * 橫軸名稱「季度」與圖例。舊版沒有橫軸名稱也沒有圖例（圖例是畫布外
     * 的 HTML），所以邊界比較窄；沿用舊邊界會讓它們壓在一起。
     */
    /*
     * ⚠️ 條數多的時候版面要**先算過再畫**，不可以沿用固定的邊界：
     *   ・圖例排不下就得換行，而多出來的那幾行要有地方放，
     *     否則會直接畫到畫布外面（畫面上看起來是「圖例不見了」）。
     *   ・線尾要直接標名稱（色盲讀者與灰階列印靠的是名稱，不是顏色），
     *     右邊沒留空間的話名稱會被切掉一半。
     */
    const multiLine = Boolean(opts.lines && opts.lines.length > 1);
    c.font = "11px Microsoft JhengHei, sans-serif";
    const legendNames = seriesList
      .filter((line) => line.values.some((value) => typeof value === "number"))
      .map((line) => line.label);
    /*
     * 2026-09-18 使用者裁示：條數不設上限、不再變深灰，第 9 條起換線型
     * （見 lineStyleOf）。原本「超過配色數」那一句提醒與線尾名稱一併取消。
     */
    const tooManyLines = false;
    const left = 78,
      top = 30;
    /*
     * ── 線尾要不要直接標名稱 ───────────────────────────────────
     *
     * X-79（使用者 2026-09-17，附圖）：「底下已經有圖例說明，畫面上不用再
     *   顯示路段了，避免會有標籤重疊的問題」——圖上三個線尾名稱疊成一團，
     *   最後一個還被截成「中山北路(大德一路~平和…」。
     *
     * ⚠️ 但**不可以無條件全部拿掉**：這一段當初存在的理由是
     *   「色盲讀者與灰階列印靠的是名稱、不是顏色」。使用者的理由是
     *   **「底下已經有圖例說明」**，而那句話只在圖例真的分得出來時成立——
     *   線多到 tooManyLines（超過配色數、全部畫成深灰）時，
     *   圖例的色塊也**全是同一個深灰**，那時線尾名稱是唯一的識別。
     *
     * 所以：照使用者的**理由**走，不照字面走——
     *   ・圖例分得出來（每條線各有顏色）→ 不畫線尾名稱，右邊也不留位，圖變寬
     *   ・圖例分不出來（tooManyLines）→ 照舊畫
     */
    /*
     * ⚠️ 2026-09-18 使用者裁示（附圖，11 條線）：「下方已經有圖例說明哪條線是路段，
     *   那就不需要有名稱標籤，會有彼此重疊問題」——X-79 留下的例外
     *   （超過配色數時保留線尾名稱）取消，**任何情況都不畫線尾名稱**。
     *   識別靠圖例與講稿；超過配色數時上方那一句提醒仍在（請縮小範圍）。
     *   守門 e2e-trend-end-labels 同步改成「三點與九點都不可以有線尾墨」。
     */
    const showEndLabels = false;
    void multiLine;
    /* 線尾名稱要佔的寬度（最長的那一個，上限 120px，太長就截斷）。 */
    const endLabelRoom = showEndLabels
      ? Math.min(
          120,
          Math.max(
            0,
            ...legendNames.map((name) => c.measureText(name).width + 12),
          ),
        )
      : 0;
    const right = 28 + endLabelRoom;
    const w = width - left - right;
    /* 線段拉長到 40px（原 18px），虛線／點線在圖例上才看得出來；文字位置不變。 */
    const legendSlot = Math.max(
      60,
      ...legendNames.map((name) => c.measureText(name).width + 62),
    );
    const legendPerRow = Math.max(1, Math.floor(w / legendSlot));
    const legendRows = Math.max(1, Math.ceil(legendNames.length / legendPerRow));
    const bottom = 86 + (legendRows - 1) * 16;
    const h = height - top - bottom;
    /*
     * 把繪圖區的邊界寫到 dataset 上。
     * ⚠️ 這是給守門量**像素**用的：畫布上讀不到文字，要判斷「線尾有沒有寫
     *   名稱」只能去數繪圖區右邊那一條有沒有墨——而繪圖區的右緣是算出來的
     *   （會隨線尾名稱的長度變動），測試自己猜會猜錯。
     * ⚠️ 這裡只寫**位置**，不寫「有沒有畫名稱」。寫後者的話守門就變成
     *   在問程式自己的說法，而不是在看畫面。
     */
    if (c.canvas instanceof HTMLCanvasElement) {
      c.canvas.dataset.plotLeft = String(Math.round(left));
      c.canvas.dataset.plotRight = String(Math.round(left + w));
      c.canvas.dataset.plotTop = String(Math.round(top));
      c.canvas.dataset.plotBottom = String(Math.round(top + h));
    }
    /*
     * 縱軸刻度吸附到好讀的整數。
     *
     * 舊版的軸頂**直接就是資料最大值**，四等分之後刻度變成
     * 42,090／31,568／21,045／10,523／0 這種一排亂數；而且最高的那個點
     * 會貼著最上面那條格線畫，圓點被切掉一半。niceAxisMax 先決定每一格
     * 的高度再回推軸頂，所以刻度好讀，而且軸頂一定高於資料最大值。
     */
    const dataMax = Math.max(
      1,
      ...seriesList
        .flatMap((line) => line.values)
        .filter(
          (value): value is number =>
            typeof value === "number" && Number.isFinite(value),
        ),
    );
    const axis = niceAxisMax(dataMax, 4);
    const max = axis.max;
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
        (max * (4 - i)) / 4 === 0
          ? "0"
          : ((max * (4 - i)) / 4).toLocaleString("zh-TW", {
              minimumFractionDigits: axis.digits,
              maximumFractionDigits: axis.digits,
            }),
        left - 10,
        y + 4,
      );
    }
    /*
     * 縱軸要寫**名稱＋單位**，不是只寫單位。
     *
     * 舊版只畫 unit（例如「輛/日」），看圖的人不知道那是全日量、尖峰量
     * 還是某一個車種——而使用者的要求正是「有單位的軸，就要附上名稱和
     * 單位」。名稱由上層依所選指標算好傳進來。
     */
    c.save();
    c.translate(16, top + h / 2);
    c.rotate(-Math.PI / 2);
    c.textAlign = "center";
    c.fillStyle = "#526170";
    c.font = "bold 11px Microsoft JhengHei, sans-serif";
    c.fillText(yTitle, 0, 0);
    c.restore();
    c.font = "11px Microsoft JhengHei, sans-serif";
    const draw = (line: TrendLine, collect?: ChartPoint[]) => {
      const color = line.color;
      /* 整條都沒有值就整條不畫（例如被日別篩選掉的那一條）。 */
      const hasAny = line.values.some((value) => typeof value === "number");
      if (!hasAny) return;
      c.beginPath();
      let started = false;
      rows.forEach((_r, i) => {
        const value = line.values[i];
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
      c.setLineDash(line.dash ?? []);
      c.stroke();
      c.setLineDash([]);
      rows.forEach((_r, i) => {
        const value = line.values[i];
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
        collect?.push({
          x,
          y,
          series: line.label,
          color,
          value,
          label: value.toLocaleString("zh-TW", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          }),
        });
      });
    };
    /*
     * 收集每一個資料點的畫面座標，給上面那一層 HTML 用。
     * ⚠️ 座標一定要和畫圓點的那一段**同一份算式**算出來——
     *   另外寫一份的話，標籤會標在離點幾像素的地方，而且只有在
     *   某些資料量下看得出來（這正是「點畫在駛入的高度、旁邊標駛出的
     *   數字」那一類錯誤的溫床）。所以直接在 draw() 裡順手記下來。
     */
    const collected: ChartPoint[] = [];
    seriesList.forEach((line) => draw(line, collected));
    /*
     * ── 線尾直接標名稱 ─────────────────────────────────────────
     *
     * ⚠️ 多條線時**識別不可以只靠顏色**：色盲讀者分不出來，
     *   列印成灰階之後所有線都一樣，而這些圖是會被貼進正式報告的。
     *   圖例有名稱，但圖例在圖下方，讀者得一條一條對顏色；
     *   名稱標在線尾就不用對。條數過多時全部畫成深灰，那時**只剩**
     *   這些名稱可以分辨。
     * ⚠️ 名稱會互相疊在一起（兩條線的末端很接近時），所以先依 y 排序，
     *   再由上往下推開，至少隔 13px。
     *
     * ⚠️ X-79 之後只有 tooManyLines（圖例分不出來）才走這裡，判斷在上面的
     *   showEndLabels，不要在這裡改回 multiLine。
     */
    if (showEndLabels) {
      const ends: Array<{ y: number; text: string; color: string }> = [];
      seriesList.forEach((line) => {
        let lastIndex = -1;
        line.values.forEach((value, index) => {
          if (typeof value === "number" && Number.isFinite(value))
            lastIndex = index;
        });
        if (lastIndex < 0) return;
        const value = line.values[lastIndex] as number;
        ends.push({
          y: top + h - (value / max) * h,
          text: line.label,
          color: line.color,
        });
      });
      ends.sort((a, b) => a.y - b.y);
      let previous = -Infinity;
      for (const end of ends) {
        const y = Math.max(end.y, previous + 13);
        previous = y;
        c.textAlign = "left";
        c.fillStyle = tooManyLines ? "#3B3B3B" : end.color;
        c.font = "11px Microsoft JhengHei, sans-serif";
        /* 超出畫布就截斷並補「…」，寧可短也不可以被邊緣切掉。 */
        let text = end.text;
        while (
          text.length > 1 &&
          c.measureText(text).width > Math.max(0, width - (left + w) - 8)
        )
          text = text.slice(0, -1);
        if (text !== end.text) text = `${text.slice(0, -1)}…`;
        c.fillText(text, left + w + 6, Math.min(y + 4, height - bottom));
      }
    }
    if (tooManyLines) {
      c.textAlign = "left";
      c.fillStyle = "#8A3E33";
      c.font = "11px Microsoft JhengHei, sans-serif";
      c.fillText(
        `共 ${seriesList.length} 條線，已超過看得清楚的數量（不另外配色）；請用調查點選單縮小範圍。`,
        left,
        top - 18,
      );
    }
    c.textAlign = "center";
    c.fillStyle = "#526170";
    /*
     * X 軸標籤要間隔印。
     *
     * 舊版每一季都印，季度累積到二十幾季就會擠成一團——而那時候使用者
     * 已經在簡報現場了。畫布有 measureText，所以這裡是**真的量**字寬，
     * 不是估的。最後一季一定印：業主最在意「現在到哪了」。
     */
    const texts = rows.map((r) => quarterLabels?.[r.quarter] || r.quarter);
    const stride = labelStride(texts, w, (text) => c.measureText(text).width);
    rows.forEach((r, i) => {
      if (!showXLabel(i, rows.length, stride)) return;
      /*
       * ⚠️ 2026-09-18 大檢查 F-26：刻度與橫軸名稱要**跟著繪圖區底部**排，
       *   不可以從畫布底部倒數固定距離。圖例換到兩行以上時 bottom 會變大、
       *   繪圖區往上縮，但 height-60／height-40 不動，結果「季度」壓在
       *   刻度「115Q2」與第一行圖例上（10 條線的 PNG 實測）。
       *   圖例一行時 top+h＝height-86，下面兩個位置與改動前逐像素相同。
       */
      c.fillText(
        texts[i],
        left + (rows.length === 1 ? w / 2 : (w * i) / (rows.length - 1)),
        top + h + 26,
      );
    });
    /* 橫軸名稱，不然「113Q1、113Q2…」那一排字沒有標題。 */
    c.font = "bold 11px Microsoft JhengHei, sans-serif";
    c.fillStyle = "#526170";
    c.fillText("季度", left + w / 2, top + h + 46);
    /*
     * 圖例畫在**畫布裡面**。
     *
     * 舊版的圖例是畫布外的一段 HTML，所以把這張圖存成圖片、或截圖貼進
     * 簡報時，圖上完全看不出哪一條是平日、哪一條是假日。圖例是這張圖的
     * 一部分，不是旁邊的裝飾。
     */
    c.font = "11px Microsoft JhengHei, sans-serif";
    const legend: Array<[string, string, number[]]> = seriesList
      .filter((line) => line.values.some((value) => typeof value === "number"))
      .map((line) => [line.label, line.color, line.dash ?? []] as [string, string, number[]]);
    if (legend.length) {
      /*
       * ⚠️ 條數多時圖例要**換行**，不可以一路往右排。
       *   一路排下去會直接畫出畫布外面，而畫面上看起來就是「圖例不見了」。
       *   間距也要跟著名稱長度走——「調查點・平日」比「平日」長得多。
       * ⚠️ 換行數與版面是**同一份**（上面算 bottom 時就用了 legendRows），
       *   兩邊各算一次的話，行數不一樣時圖例就會畫到畫布外面。
       */
      const perRow = legendPerRow;
      const gap = legend.length > 2 ? legendSlot : 112;
      /* 最後一行貼著畫布底部，往上長。 */
      const legendBaseY = height - 16 - (legendRows - 1) * 16;
      legend.forEach(([name, color, dash], i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const legendY = legendBaseY + row * 16;
        const countInRow = Math.min(perRow, legend.length - row * perRow);
        const startX = left + w / 2 - ((countInRow - 1) * gap) / 2;
        const x = startX + col * gap;
        c.beginPath();
        c.moveTo(x - 46, legendY - 4);
        c.lineTo(x - 6, legendY - 4);
        c.strokeStyle = color;
        c.lineWidth = 3;
        /* 圖例的線段要畫成與那條線同一種線型，不然虛線靠什麼對照。 */
        c.setLineDash(dash);
        c.stroke();
        c.setLineDash([]);
        c.beginPath();
        c.arc(x - 26, legendY - 4, 4, 0, Math.PI * 2);
        c.fillStyle = "#fff";
        c.fill();
        c.strokeStyle = color;
        c.lineWidth = 2.5;
        c.stroke();
        c.fillStyle = "#526170";
        c.textAlign = "left";
        c.fillText(name, x - 2, legendY);
      });
      c.textAlign = "center";
    }
  return {
    points: collected,
    plotLeft: left,
    plotRight: width - right,
    /* 縱軸刻度是右對齊畫在 left - 10，見上面畫格線那一段。 */
    axisTextRight: left - 10,
  };
}

/*
 * ══════════════════════════════════════════════════════════════════════
 *  24 小時型態圖的繪圖本體（畫面與匯出共用同一支）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 抽出來的理由同 paintTrendChart：匯出是以 3 倍實體像素**重新畫一次**，
 * 不是把畫面上那張放大（放大是內插，線條與文字都會糊）。
 * 而重畫一定要走**同一支**繪圖程式，畫面一套、匯出一套遲早分岔，
 * 症狀是「畫面正常、交出去的那一張壞掉」。
 */
export function paintHourlyChart(
  c: CanvasRenderingContext2D,
  width: number,
  height: number,
  seriesByDay: {
    dayType: string;
    points: ReturnType<typeof hourlySeriesOf>;
  }[],
  /**
   * 匯出成 PNG 時為 true：把圖例與橫軸名稱**畫進畫布**。
   * 畫面上不畫——畫面的圖例是畫布下方那一排 HTML，再畫一次會重複。
   * （F-24：下載下來的 PNG 原本沒有圖例，實線／虛線是哪一條看不出來，也沒有橫軸名稱。）
   */
  standalone = false,
) {
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
      draw(
        group.points,
        "actual",
        index === 0 ? palette.teal : "#7fb2c7",
        [],
        lineWidth,
      );
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
    if (standalone) {
      /* 圖例（靠右，與上面的日別標籤同一列、不重疊）與橫軸名稱。 */
      c.font = "11px Microsoft JhengHei";
      c.fillStyle = "#526170";
      c.textAlign = "right";
      const legendY = top - 8;
      const items: [string, string, number[]][] = [
        ["實際交通量（輛／小時）", palette.teal, []],
        ["PCU（PCU／小時）", palette.orange, [7, 4]],
      ];
      let x = width - right;
      for (const [label, color, dash] of [...items].reverse()) {
        c.fillStyle = "#526170";
        c.fillText(label, x, legendY);
        x -= c.measureText(label).width + 8;
        c.beginPath();
        c.moveTo(x - 26, legendY - 4);
        c.lineTo(x, legendY - 4);
        c.strokeStyle = color;
        c.lineWidth = 3;
        c.setLineDash(dash);
        c.stroke();
        c.setLineDash([]);
        x -= 26 + 14;
      }
      c.textAlign = "center";
      c.fillStyle = "#526170";
      c.fillText("時刻（每一小時的起點）", left + w / 2, height - 2);
    }
}

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
/**
 * 依日別分組的每小時序列。**畫面與匯出共用這一支**。
 *
 * ⚠️ 抽出來是為了讓「下載高解析圖片」不必自己再算一次。
 *   匯出端另外算一份的話，兩份的篩選條件遲早會分岔——而症狀是
 *   「畫面上的圖和下載下來的圖不一樣」，那種錯查起來非常痛苦。
 */
function hourlySeriesByDayOf(
  records: TrafficRecord[],
  factors: PcuFactors,
  turnFactors: TurnPcuFactors,
  vehicleSettings: VehicleClassSetting[],
  scopes?: PcuScopes | null,
) {
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
  const dayTypes: string[] = [];
  for (const record of records)
    if (record.dayType && !dayTypes.includes(record.dayType))
      dayTypes.push(record.dayType);
  return (dayTypes.length ? dayTypes : [""]).map((dayType) => ({
    dayType,
    points: hourlySeriesOf(
      records.filter((r) => !dayType || r.dayType === dayType),
      factors,
      turnFactors,
      vehicleSettings,
      scopes,
    ),
  }));
}

function hourlySeriesOf(
  records: TrafficRecord[],
  factors: PcuFactors,
  turnFactors: TurnPcuFactors,
  vehicleSettings: VehicleClassSetting[],
  scopes?: PcuScopes | null,
) {
  return Array.from({ length: 24 }, (_, hour) => {
    const hit = records.filter((r) => hourStartOf(r.hour) === hour);
    return {
      hour,
      surveyed: hit.length > 0,
      actual: hit.length ? hit.reduce((s, r) => s + sumVehicles(r), 0) : null,
      pcu: hit.length
        ? hit.reduce(
            (s, r) =>
              s + sumPcu(r, factors, turnFactors, vehicleSettings, scopes),
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
  scopes,
}: {
  records: TrafficRecord[];
  factors: PcuFactors;
  turnFactors: TurnPcuFactors;
  vehicleSettings: VehicleClassSetting[];
  scopes?: PcuScopes | null;
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
  const seriesByDay = useMemo(
    () =>
      hourlySeriesByDayOf(
        records,
        factors,
        turnFactors,
        vehicleSettings,
        scopes,
      ),
    [records, factors, turnFactors, vehicleSettings, scopes],
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
      if (box)
        setCanvasSize(`${Math.round(box.width)}x${Math.round(box.height)}`);
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
    paintHourlyChart(c, width, height, seriesByDay);
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
  /*
   * ⚠️ 這是車種顏色的**第三份**抄本（畫面圓環、Excel 儲存格填色，再加這裡的
   *   Excel 原生圓環圖）。2026-09-14 換配色時，前兩份改了、這一份差點被漏掉
   *   ——是 tests/vehicle-colors.test.mjs 掃到舊色碼才發現的。
   *   三份都改成從 app/vehicle-colors.ts 取，不可以再抄第四份。
   *   這裡的格式不帶 #，所以去掉開頭那個字元。
   */
  const doughnutColors = VEHICLE_COLORS.map((hex) => hex.slice(1).toUpperCase());
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
  /*
   * ⚠️ 這一行**不可以**加 `-- 理由…` 的說明尾巴。實測（2026-09-14）：
   *   ・沒有這一行 → react-hooks/immutability 在下面第 3 行報 error
   *   ・有這一行、不帶說明 → 錯誤被壓下，而且沒有任何警告
   *   ・有這一行、帶 `-- 說明` → 錯誤一樣被壓下，卻**多出**一條
   *     「Unused eslint-disable directive」的警告（工具自己判斷錯了）
   * 而 npm run lint 是 --max-warnings=0，那一條警告會讓整包測試變紅。
   * 理由寫在上面那段註解裡，不寫在指令尾巴。
   */
  /*
   * 沒有登入就是離線模式。**必須在 render 期間就設好**——它的用途正是
   * 「在任何 appFetch 發生之前就決定要不要打 API」，改成 effect 會晚一個
   * commit。寫入動作包在 app/offline-flag.ts 的函式裡（理由見該檔），
   * 所以這裡**不需要任何 eslint 豁免**。
   */
  if (!user) markOfflineMode();
  const [projects, setProjects] = useState<Project[]>([]);
  /*
   * 停用範圍要涵蓋到這一行：規則指的是「render 期間改了 window 上的旗標，
   * 之後又讀它」，而它回報的位置是**讀取端**（這裡的 useState(!user)），
   * 不是上面那個賦值。停用只框住賦值那幾行的話，規則會改在這裡報出來。
   */
  const [offline, setOffline] = useState(!user);
  const [activeProject, setActiveProject] = useState("");
  const [records, setRecords] = useState<TrafficRecord[]>([]);
  const [quarter, setQuarter] = useState("");
  /*
   * ⚠️ 季度改成**起訖區間**（使用者 2026-09-14：三支程式一律相同）。
   *   既有的 quarter 就是「迄」，下游幾十個地方讀它，一個字都不動；
   *   這裡只多一個「起」。預設起＝迄＝最新一季，等於單季，
   *   所以升級當天一個數字都不會變。
   */
  const [quarterFrom, setQuarterFrom] = useState("");
  /**
   * 使用者有沒有自己動過「季度（起）」。
   *
   * ⚠️ 沒動過之前，起一律**跟著迄走**（＝單季，升級前的行為）。
   *
   *   第一版只在「目前的值不在清單裡」時才更新，於是匯入 115Q1 時
   *   起被填成 115Q1，接著匯入 115Q2、迄跟著跳到 115Q2，
   *   起卻留在 115Q1——區間被**自動拉開**了，而使用者什麼都沒選過。
   *   實測抓到：四圖表與比較的數字變成兩季相加（22,548 → 37,548，
   *   剛好是 (100+150)/150 倍）。這種錯不會有任何症狀，只會安靜地錯。
   *
   * ⚠️ 他主動改過之後就不再自動跟隨，否則每匯入一季，
   *   自己設好的區間就被擦掉一次。
   */
  const [quarterFromTouched, setQuarterFromTouched] = useState(false);
  /** 每一塊自己的條件；沒有鍵＝那一塊還跟著主工具列（鏡子）。 */
  const [chartOverrides, setChartOverrides] = useState<ChartOverrides>({});
  /*
   * 期別要顯示成「季別」還是「實際調查月份」。
   * **只影響畫面上的文字**——分組、排序、鍵值、計算與匯出的數值一律仍以
   * 季別為準。一季分兩個月做完時，這個切換讓使用者一眼看出
   * 115Q1 實際是「115年2、3月」。
   */
  /*
   * 年份顯示成民國還是西元。**純顯示**，與資料怎麼存無關——
   * 季別一律以民國年寫法儲存，分組、排序、識別鍵全部走儲存值，
   * 所以怎麼切換都不會多出季度、也不會動到任何計算。
   * 匯出的 Excel 跟著一起換，避免畫面寫 2026Q1、交出去的報表寫 115Q1。
   */
  const [yearStyle, setYearStyle] = useState<YearStyle>("roc");
  const [periodDisplay, setPeriodDisplay] =
    useState<PeriodDisplayMode>("quarter");
  const [dayType, setDayType] = useState<DayMode>("平日");
  /* 車流方向。與調查點同理：空陣列＝不設限（全部），不是全部排除。 */
  const [directions, setDirections] = useState<string[]>([]);
  const matchesDirection = useCallback(
    (code: string) => directions.length === 0 || directions.includes(code),
    [directions],
  );
  /*
   * ⚠️ 主工具列的「路口流量視角」現在**多一個「駛出＋駛入並列」**
   *   （使用者 2026-09-14）。並列不是一種 IntersectionFlowMode——
   *   它的意思是「這一塊要同時呈現兩種視角」，是呈現方式不是篩選。
   *   所以狀態放寬成 FlowChoice，再往下攤成既有的 IntersectionFlowMode；
   *   沒有選並列時兩者完全相同，既有數字一個都不會變。
   */
  const [flowChoice, setFlowChoice] = useState<FlowChoice>("origin");
  const intersectionFlowMode: IntersectionFlowMode =
    flowChoice === "both" ? "origin" : flowChoice;

  // 尖峰時段以「整個調查點」為準（各方向相加＝合計，可與路口整體尖峰的報表對數字），
  // 或讓每個方向各自認定自己的尖峰小時。預設前者。
  const [periodPeakScope, setPeriodPeakScope] = useState<PeakScope>("point");
  const [search, setSearch] = useState("");
  /*
   * 調查點篩選。空陣列＝不設限（全部），不是全部排除。
   *
   * 這個值原本是單一字串，同時扮演**兩個角色**：
   *   (1) 分析篩選條件
   *   (2)「目前選定的那一條路段」——開啟「管理名稱」「管理路口幾何」時用它決定
   *       要管哪一條，合併路段之後還會被改寫成合併後的目標。
   * 改成可複選之前必須先把這兩件事拆開：角色 (2) 一次只能有一條，
   * 所以改用 soloRoadId（剛好只勾一條時才有值）。
   */
  const [roadFilters, setRoadFilters] = useState<string[]>([]);
  /** 目前條件下「唯一選定的那一條調查點」；沒有或選了多條時是 null。 */
  const soloRoadId = roadFilters.length === 1 ? roadFilters[0] : null;
  /** 這一筆紀錄是否通過調查點篩選。空陣列＝全部通過。 */
  const matchesRoad = useCallback(
    (id: string) => roadFilters.length === 0 || roadFilters.includes(id),
    [roadFilters],
  );
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
    new Map<
      string,
      { roadPcu: number; turnPcu: VehicleClassSetting["turnPcu"] }
    >(),
  );
  const [dayMetric, setDayMetric] = useState<Metric>("actual");
  /*
   * 趨勢圖的指標。v20.59 起不只 actual／pcu 兩種，指標目錄在
   * app/trend-script.ts（純函式，有單元測試釘住）。
   * 預設仍是 "actual" ＝ 舊版的那一條線，不動選單時行為與舊版相同。
   */
  const [trendMetric, setTrendMetric] = useState<TrendMetricId>("actual");
  /** 需要選車種的指標（單一車種車輛數／佔比）選到哪一個。 */
  const [trendVehicle, setTrendVehicle] = useState("");
  const trendCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  歷季分析也吃**共同功能列**的條件（v20.68）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-12：「有些自己的功能列沒有與上面共同功能列同步，
   * 有些則是有同步……如果有發現bug請修正」，並補一句
   * 「篩選錯誤和計算錯誤是一樣嚴重，因為我以為我篩的是A條件，
   *   結果卻是其他功能列B的條件」——完全正確，所以一律收斂成一份。
   *
   * ⚠️ 但**季度**不跟：趨勢圖本來就是跨季看的，套用上方的單一季度沒有意義。
   *   上方功能列沒有「起訖季度」這種東西，所以那一個仍然是趨勢圖自己的。
   *
   * ⚠️ 釘在標題列上的那一排選擇器**要留著**——那是使用者 2026-09-11
   *   指定的（「想換下一個路段，我又得一直往上滑到功能列」）。
   *   留著，只是讓它改的是共用那一份而不是自己一份。
   */
  /*
   * ⚠️ 車種組成**沒有**自己的日別／路段／方向 state（v20.68 移除）。
   *   它和 24小時型態、同季平假日一樣讀共同功能列的 dayType／roadFilters／
   *   directions。詳見 compositionRecords 那一段的說明。
   */
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  /*
   * 匯入大量檔案時的逐檔進度。
   *
   * 舊版遮罩只寫一句「正在處理資料…」，一動也不動——檔案多的時候
   * 使用者分不出「還在跑」和「當掉了」。改成同時顯示第幾份、共幾份、
   * 以及正在讀哪一個檔名。
   */
  const [busyProgress, setBusyProgress] = useState("");
  /*
   * 選檔期間的提示。
   *
   * 使用者回報「按下選擇檔案之後畫面什麼都沒有，等很久才跳出結果」。
   * 實測過原因：change 一送到畫面 0ms 就更新——那段等待完全發生在
   * 瀏覽器把檔案準備好之前，程式那時候還沒被叫到，
   * 所以沒辦法「等待中才開始顯示」，只能從按下去的那一刻就先顯示。
   *
   * 取消選取時不會有 change，靠視窗重新取得焦點當退路。
   */
  const [pickingFiles, setPickingFiles] = useState(false);
  useEffect(() => {
    if (!pickingFiles) return undefined;
    let timer = 0;
    const onFocus = () => {
      window.clearTimeout(timer);
      /* 有選檔時 change 很快就到；等一下再判斷，避免把正常情況誤判成取消 */
      timer = window.setTimeout(() => setPickingFiles(false), 1200);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [pickingFiles]);
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (!Array.from(event.dataTransfer?.types ?? []).includes("Files"))
        return;
      const target = event.target;
      if (target instanceof Element && target.closest(".drag-zone")) return;
      event.preventDefault();
      if (event.type === "dragover" && event.dataTransfer)
        event.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  /** 「管理計畫」視窗現在在改哪一個計畫；空字串＝目前這一個。 */
  const [managedProjectId, setManagedProjectId] = useState("");
  /*
   * 目前顯示哪一個分頁（v20.64 起是真的換頁，不是捲動錨點）。
   * 預設停在「資料匯入」——沒有資料時那一頁才有事可做。
   */
  const [view, setView] = useState<string>(FIRST_PAGE);
  /* 第一次進某一頁 → 從最上面；回頭再進去 → 接著上次中斷的地方。 */
  useViewScrollMemory(view);
  /*
   * ── 側欄點到哪一張卡片，那一張就被「點名」 ───────────────────
   *
   * 使用者 2026-09-11：「參數設定下面三個分頁，我各點一下，畫面都沒反應，
   * 一開始以為是壞掉……點一下道路與流向管理，那個功能欄位就變換顏色？
   * 但要注意文字不能被背景色遮蔽。」
   *
   * ⚠️ **刻意不換卡片底色**，用外框。
   *   這幾張卡片裡有白底輸入框、灰字說明、彩色徽章、深色數字——
   *   換底色等於一次動到五六種文字的對比，而他已經提醒過兩次
   *  「不要讓文字被背景色融合在一起」。外框（outline）畫在卡片**外面**，
   *   不覆蓋任何文字，所以「遮到字」這件事結構上不可能發生，
   *   也不需要為它再量一次對比。
   *
   * ⚠️ 點名會**一直留著**到點下一個，不是閃一下就沒。
   *   閃一下的話，使用者視線還沒移過去就結束了，等於沒有；
   *   留著還有一個作用——他隨時看得出「我現在在哪一張」。
   *
   * 空字串＝沒有任何卡片被點名（剛進來的狀態）。
   */
  const [focusedBlock, setFocusedBlock] = useState("");
  /** 這張卡片現在是不是被點名的那一張——給 className 用，避免每處重寫三元式。 */
  const focusClass = (anchor: string, base = "") =>
    focusedBlock === anchor
      ? base
        ? base + " is-focused"
        : "is-focused"
      : base;
  const [showImport, setShowImport] = useState(false);
  const [showRoadManager, setShowRoadManager] = useState(false);
  const [showIntersectionManager, setShowIntersectionManager] = useState(false);
  const [intersectionManageRoad, setIntersectionManageRoad] = useState("");
  /*
   * 由調查表反推出來的支線角度與流向「預填值」。
   *
   * ⚠️ 刻意**不寫進 intersectionSettings**：
   * unconfiguredIntersectionRoads() 是看 intersectionSettings 判斷「這個路口
   * 設定過了沒有」。預填值若直接寫進去，這個路口立刻算成已設定，
   * 下一季就不會再問——等於系統自己替使用者做了決定，而使用者根本沒看過。
   * 使用者的要求是「預填出系統認為正確的值，但也要提醒到那個視窗確認」，
   * 所以預填只在視窗裡當預設值出現，按下「儲存設定」才會真的存起來。
   */
  const [derivedArmPrefill, setDerivedArmPrefill] = useState<
    IntersectionArmSetting[]
  >([]);
  /** 哪些路口的預填值與預設角度不同——要在視窗上明講，請使用者確認。 */
  const [derivedArmNotice, setDerivedArmNotice] = useState<
    Record<string, string>
  >({});
  const [intersectionDiagramSource, setIntersectionDiagramSource] =
    useState("");
  const [intersectionSettings, setIntersectionSettings] = useState<
    IntersectionArmSetting[]
  >([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [roadAliases, setRoadAliases] = useState<RoadAlias[]>([]);
  /*
   * 這一次匯入過程中，使用者手動挑「併入既有路段」的檔名。
   * 鍵是檔名正規化後的比對鍵，值是要併進去的路段。
   * ⚠️ 用 ref 不用 state：它在 resolveImportedRoad（同步）裡寫入，
   * 而 state 的更新是非同步的，寫完馬上讀會讀到舊值。
   * 而且它不影響任何畫面，本來就不該引發重繪。
   */
  const pendingAliasRef = useRef(
    new Map<string, { roadId: string; aliasName: string }>(),
  );
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
  const [importQuarter, setImportQuarter] = useState("115Q3");
  /*
   * 寫進資料的季度一律用民國年寫法。
   *
   * 輸入框同時接受 115Q2 與 2026Q2（提示文字就是這樣寫的），但如果照打的字
   * 原樣存下去，同一季會因為寫法不同而變成兩個不同的鍵——季度清單是
   * `[...new Set(records.map(r => r.quarter))]`，115Q1 與 2026Q1 會並列成
   * 兩季、歷季趨勢被拆成兩段，而且永遠不會合併，因為它們字面上就是不同的字串
   *（兩者的排序鍵其實完全相同，所以會相鄰出現，更難聯想到是寫法問題）。
   * 正規化規則在三支共用的 period-date 模組裡。
   */
  const importQuarterKey = useMemo(
    () => normalizeSurveyPeriod(importQuarter),
    [importQuarter],
  );
  const [pendingImport, setPendingImport] = useState<{
    files: File[];
    records: TrafficRecord[];
    report: ReturnType<typeof validateImport>;
    /** 調查日期 × 期別的比對結果；只作提示，不影響寫入的任何數值。 */
    periodChecks: PeriodDateCheck[];
    /**
     * 解析當下選的季別。
     *
     * 使用者 2026-09-11：「如果我有 N 份檔案，只要有一個錯，我就得全部重選，
     * 會蠻辛苦的。」——所以確認視窗裡要能直接改季別，不必取消重來。
     *
     * ⚠️ 能這樣做的前提是查過的：季別在 `parseTrafficSheetValues()` 裡
     *   **只是被當成欄位存進每一列**（傳進去、原樣塞進物件），
     *   沒有參與任何計算。所以「改季別」等同「用新季別重新解析」，
     *   把每一列的 quarter 換掉就夠了，不必真的重讀檔案。
     *   ⚠️ 日後若有人讓解析邏輯讀 quarter（例如依季別套不同版型），
     *     這個前提就不成立了——tests/import-quarter-retag.test.mjs 會紅。
     */
    parsedQuarter: string;
    /**
     * 逐檔讀到的調查日期原始結果。
     * 留著才能在使用者改季別之後**重算**日期比對——
     * 只留算好的 periodChecks 的話，改完季別那段提示會停在舊季別，
     * 而那正是使用者會拿來判斷「我改對了沒」的依據。
     */
    dateChecks: Array<{
      file: string;
      sheet?: string;
      found: Parameters<typeof checkPeriodAgainstDate>[1];
    }>;
    /**
     * 逐檔提醒：讀出 0 列的檔案、日別退回檔名判定的檔案。
     * 只作提示、不影響任何數值；目的是不要讓「少匯了一個檔」這種事
     * 只反映在一個數字上。
     */
    fileWarnings: string[];
  } | null>(null);
  /**
   * 目前季別之下的日期比對結果。
   *
   * ⚠️ 一定要**依目前選的季別重算**，不可以直接用解析當下算好的那一份。
   *   使用者在確認視窗裡改了季別之後，舊的結果會說「日期和 114Q2 不符」，
   *   而他已經改成 114Q3 了——那段提示會變成錯的，
   *   而它正是使用者用來判斷「我改對了沒」的依據。
   *   畫面與寫入前的確認框都讀這一份，兩邊不可能分岔。
   */
  const livePeriodChecks = useMemo(() => {
    if (!pendingImport) return [];
    if (importQuarterKey === pendingImport.parsedQuarter)
      return pendingImport.periodChecks;
    return pendingImport.dateChecks.map((item) =>
      checkPeriodAgainstDate(
        importQuarterKey,
        item.found,
        item.sheet ? item.file + "【" + item.sheet.trim() + "】" : item.file,
      ),
    );
  }, [pendingImport, importQuarterKey]);
  /*
   * ── 一鍵「改用檔案日期的季別」 ───────────────────────────────
   *
   * 使用者 2026-09-11：「如果我有 N 份檔案 只要有一個錯 我就得全部重選
   * 會蠻辛苦的」。上面已經讓他可以在這個視窗裡直接改季別，但他還是得
   * 自己看提示、自己打字。既然系統已經從檔案日期算出是哪一季了，
   * 就該直接給一顆按鈕。
   *
   * ⚠️ 只有在**所有對不上的檔案都指向同一季**時才給這顆按鈕。
   *   指向好幾季的話，一顆按鈕沒辦法表達要改成哪一個；
   *   隨便挑一個預設值，使用者按下去才發現改錯了——那比沒有按鈕更糟。
   *   那種情況本來就該分批匯入（而且混批本來就會被擋住）。
   *
   * ⚠️ 這一段與路口轉向的 importDateSuggestedPeriod 是同一套判斷，
   *   兩支共用 period-date.ts 的 dateLabel（形如「114Q3」），
   *   所以不需要各自再解析一次日期。
   */
  const importDateSuggestedQuarter = useMemo(() => {
    const labels = Array.from(
      new Set(
        livePeriodChecks
          .filter((item) => item.status === "mismatch" && item.dateLabel)
          .map((item) => item.dateLabel),
      ),
    );
    return labels.length === 1 && labels[0] !== importQuarterKey
      ? labels[0]
      : "";
  }, [livePeriodChecks, importQuarterKey]);
  const [workflow, setWorkflow] = useState<WorkflowState>(emptyWorkflowState());
  /*
   * 不可以只用 boolean 表示「載入完成」。切換計畫的同一輪 effect 裡，
   * 舊的 true 仍可能被下一個存檔 effect 看見，進而把 A 計畫的 workflow
   * 寫進 B 計畫。記住實際完成載入的計畫 id，存檔時才能做身分核對。
   */
  const [workflowLoadedProject, setWorkflowLoadedProject] = useState("");
  /* ⚠️ 「品質與定稿」視窗已於 2026-09-16 整塊移除（X-43），
     所以這裡原本的 showQualityCenter 狀態也一併拿掉。 */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-44／X-48：資料維護頁自己的狀態（三支同步）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16：
   *   「資料異常檢查摘要、檢查結果 應該是建立在使用者手動點
   *     執行資料異常檢查功能 按鈕後，才產生資料的欄位……
   *     一個是事前預防，一個是事後檢查。」
   *   「所以使用者手動修正問題後，在按一次檢查，確認異常已消除。」
   *   「這一分頁所有功能都不會受到主工具列的影響」
   *
   * ⚠️ 按之前**不給任何數字**。給了就等於說「已經檢查過而且是這樣」，
   *   而那時根本還沒檢查。
   * ⚠️ 檢查完之後資料又動過，要標成「結果已過期」——不可以安靜地
   *   留著一組舊數字，那比沒有數字更危險。
   */
  const [qualityRunAt, setQualityRunAt] = useState<string>("");
  const [qualityRunStamp, setQualityRunStamp] = useState<string>("");
  /** 這一頁自己的季度（刪除單一季度用）；預設最早一季。 */
  const [maintenanceQuarter, setMaintenanceQuarter] = useState<string>("");
  /*
   * ⚠️ 檢查結果的季別篩選**不另外做一個**：這一塊本來就有自己的
   *   「起始季度／結束季度」兩個下拉（anomalyFilter），做的是同一件事。
   *   再加一個「季別」下拉會變成同一張表上兩組季度條件互相打架——
   *   那正是使用者在歷季趨勢頁剛回報過的毛病（X-53）。
   */
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
  const [reportTemplateName, setReportTemplateName] = useState("");
  /*
   * ══════════════════════════════════════════════════════════════════
   *  主工具列的「調查時段」——全站共用一份
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-13：
   *   「上方功能列，計畫、季別、路段、車流方向、**調查時段**
   *    （AM PM peak／全調查時段／全調查時段尖峰）等，可參考時段車種分析
   *    （獨立區塊），它是目前最完整的。……然後每張圖自己有自己的另一個
   *    工具列，工具列之間彼此同步。」
   *
   * ⚠️ 只有**一份**狀態，不可以每一塊各存各的。
   *   使用者 2026-09-12 已經因為「以為篩的是 A 條件、其實吃到 B 條件」
   *   踩過一次，那次的結論是「**篩選錯誤和計算錯誤是一樣嚴重**」。
   *   各塊要蓋掉主工具列時，是在自己那一層選「跟隨上方工具列」以外的值，
   *   而不是另外複製一份主工具列的狀態。
   *
   * ⚠️ 有兩張卡**不受它影響**（全日實際交通量、24小時PCU）——那兩個數字
   *   本來就是整段調查的量，不隨尖峰時段變。那時候要**在卡片上講出來**，
   *   不是默默不動、也不是顯示 0：使用者選了條件卻看到數字沒變，
   *   第一個念頭一定是「這個篩選壞了」。
   */
  /*
   * ⚠️ 主工具列的「調查時段」現在**多一個「上午＋下午並列」**
   *   （使用者 2026-09-14）。並列不是一種 PeriodKey，
   *   所以狀態放寬成 PeriodChoice，再往下攤成既有的 PeriodKey；
   *   沒有選並列時兩者完全相同，既有數字一個都不會變。
   */
  const [periodChoice, setPeriodChoice] = useState<PeriodChoice>("all");
  const mainPeriod: PeriodKey = periodChoice === "AMPM" ? "am" : periodChoice;
  const setMainPeriod = useCallback(
    (value: PeriodKey) => setPeriodChoice(value),
    [],
  );
  /** 主工具列目前選的是尖峰類的時段嗎（全日量與 24 小時 PCU 不適用）。 */
  const mainPeriodIsPeak = mainPeriod !== "all";
  // 時段車種分析區塊的顯示設定（只影響畫面，不影響匯出勾選）
  const [periodView, setPeriodView] = useState<PeriodKey | "ALL">("ALL");
  /*
   * ⚠️ 「顯示數值」從「時段車種分析」升到主工具列，而且**多兩個組合**
   *   （交通流量＋百分比、車輛數＋百分比；使用者 2026-09-14）。
   *
   *   組合選項在計算層**沒有**對應的 MetricKey——既有的匯出勾選與
   *   報表範本存的都是 count／share／pcu 這三個字串，不可以塞新值進去。
   *   所以狀態放寬成 MetricChoice，再往下攤成既有的 MetricKey，
   *   組合只是畫面上多寫一欄百分比。
   */
  const [metricChoice, setMetricChoice] = useState<MetricChoice>("count");
  /*
   * ⚠️ 這一支只是**主工具列自己**的值。時段車種分析那一張表要用的是
   *   `periodMetric`（定義在 periodFilters 之後），它吃的是
   *   filtersOf(CHART_PERIOD).metric——沒脫離時兩者相同，脫離時才分家。
   *
   *   踩過的雷（2026-09-14）：這裡原本直接 metricBaseOf(metricChoice)，
   *   於是區塊上那一顆「顯示數值」選成百分比，下拉看得到變了、
   *   表格卻整張還是車輛數——選了沒反應，而且沒有任何一個字說明為什麼。
   */
  const [periodScopeFilter, setPeriodScopeFilter] = useState<string[]>([]);
  // 時段車種分析的匯出勾選（會跟著報表範本一起存起來）
  const [periodExport, setPeriodExport] = useState<PeriodExportSelection>(
    defaultPeriodExportSelection(),
  );
  // 勾選項目一律由 app/report-draft.ts 的共用清單推導，畫面與報告草稿
  // 才不會各自維護一份而漏掉其中一邊（見 tests/report-draft.test.mjs）。
  // 報告文字草稿：勾選哪些段落、目前的文字、以及使用者是否手動改過。
  const [draftSections, setDraftSections] = useState<DraftSectionKey[]>(() => [
    ...DRAFT_SECTION_ORDER,
  ]);
  /*
   * 報表草稿的小數位數（使用者 2026-09-15 指名補上）。
   *
   * ⚠️ 舊版**每一處都寫死 1 位**，於是結論草稿改成 2 位之後，
   *   同一批數字在兩份文件裡以不同的位數出現，而兩份都沒有解釋。
   *   預設 1 位＝改版前的行為，升級當天一個字都不變。
   */
  const [reportDraftDigits, setReportDraftDigits] = useState(1);
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
          }
        }
      })
      .catch(() => setToast("計畫資料讀取失敗"));
  }, []);
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
    setWorkflowLoadedProject("");
    if (!activeProject) {
      setWorkflow(emptyWorkflowState());
      return;
    }
    loadWorkflow(activeProject).then((state) => {
      if (!cancelled) {
        setWorkflow(state);
        setWorkflowLoadedProject(activeProject);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeProject]);
  useEffect(() => {
    if (activeProject && workflowLoadedProject === activeProject)
      saveWorkflow(activeProject, workflow).catch(() =>
        setToast("品質與版本資料保存失敗"),
      );
  }, [activeProject, workflow, workflowLoadedProject]);
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
  /*
   * 依「季別 × 路段」的係數覆寫。
   *
   * ⚠️ 空陣列＝完全沒有覆寫＝這個改版對使用者完全無感。
   *   畫面上每一處「有沒有覆寫」的判斷都只看這個陣列的長度，
   *   不要另外再算一次。
   */
  const [pcuScopes, setPcuScopes] = useState<PcuScopes>([]);
  /* 編輯中的範圍（哪一季、哪一段）。預設就是「全季別 × 全路段」。 */
  const [scopeQuarter, setScopeQuarter] = useState<string>(SCOPE_ANY);
  const [scopeRoadId, setScopeRoadId] = useState<string>(SCOPE_ANY);
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
    setPcuScopes(readProjectPcuScopes(activeProject));
    /*
     * ⚠️ 換計畫時編輯中的範圍要**歸零回全季別×全路段**。
     *   不歸零的話，在 A 計畫選了「115Q2 × R-01」之後切到 B 計畫，
     *   畫面還停在那一格——而 B 計畫可能根本沒有 R-01 這條路段，
     *   使用者一按套用就會在 B 計畫建立一筆指向不存在路段的覆寫。
     */
    setScopeQuarter(SCOPE_ANY);
    setScopeRoadId(SCOPE_ANY);
    /*
     * ⚠️ 這個 disable 是**刻意**的，而且理由要寫下來（2026-09-11 補）：
     *   這是「換計畫時把係數從儲存區載進來」的一次性 effect，
     *   它 set 的那幾個 state（pcuFactors / turnPcuFactors / pcuScopes…）
     *   如果列進相依，就會變成「載入 → setState → 再載入」的無窮迴圈。
     *   真正的守門是上面那個 activeProjectFactorsLoaded ref。
     *
     *   ⚠️ 不可以把這一行拿去壓「計算用」的 useMemo／useCallback——
     *     那邊少一個相依的後果是「使用者按了套用、數字不會變、沒有錯誤」，
     *     而 disable 會讓 eslint 連吭都不吭一聲。這一支下面就有一個
     *     被這樣壓了很久的真 bug（見 computePeriodRows 的註解）。
     */
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
    const next = syncCoreVehicleSettings(vehicleClassSettings, core, coreTurns);
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
  /*
   * 換到另一個範圍時，把編輯欄位換成**那一格目前生效的值**。
   *
   * ⚠️ 顯示的是「目前生效的」而不是「這一格自己的」，是刻意的：
   *   使用者切到 (115Q2, A路段) 看到的應該是那一格現在算出來的係數，
   *   才知道自己要從哪裡開始改。若顯示空白或系統預設，
   *   他會以為那一格現在用的是那組值——而其實它繼承自別處。
   *   下方的「這一格是繼承來的／自己設定的」文字負責把差別講清楚。
   */
  useEffect(() => {
    if (!activeProject) return;
    const own = ownPcuScope(pcuScopes, scopeQuarter, scopeRoadId);
    if (scopeQuarter === SCOPE_ANY && scopeRoadId === SCOPE_ANY) {
      setPcuDraft({ ...pcuFactors });
      setTurnPcuDraft(structuredClone(turnPcuFactors));
      return;
    }
    const applied =
      own?.factors ||
      resolvePcuFactors(
        pcuScopes,
        { core: pcuFactors, coreTurns: turnPcuFactors },
        scopeQuarter,
        scopeRoadId,
      );
    setPcuDraft({ ...applied.core });
    setTurnPcuDraft(structuredClone(applied.coreTurns));
    /*
     * ⚠️ 這個 disable 也是刻意的：少列的是 pcuFactors / turnPcuFactors。
     *   它們列進去的話，使用者在「全季別 × 全路段」那一格打字改係數時，
     *   每打一個字都會觸發這個 effect 把草稿**重設回已儲存的值**，
     *   看起來就是「打了字又跳回去」。
     *   這個 effect 的職責只有一件事：**切換範圍時**把草稿換成那一格的值。
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeQuarter, scopeRoadId, activeProject, pcuScopes]);

  /*
   * 可以選的季別與路段，一律取自**這個計畫實際有資料的**那些。
   *
   * ⚠️ 不可以讓使用者對著不存在的季別或路段設定係數：那筆覆寫永遠不會命中，
   *   他卻會以為自己設定好了，然後回報「我設了怎麼沒有變」。
   * ⚠️ 用 records（本計畫全部），不是 filtered（目前篩選結果）——
   *   選單不該因為畫面上正篩著 115Q2 就少掉其他季別。
   */
  const scopeQuarterOptions = useMemo(
    () =>
      [...new Set(records.map((record) => record.quarter).filter(Boolean))]
        .sort()
        .reverse(),
    [records],
  );
  const scopeRoadOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const record of records)
      if (record.roadId && !map.has(record.roadId))
        map.set(record.roadId, record.roadName || record.roadId);
    return [...map]
      .map(([roadId, roadName]) => ({ roadId, roadName }))
      .sort((a, b) => a.roadId.localeCompare(b.roadId, "zh-Hant"));
  }, [records]);
  /*
   * 兩個維度打架的格子。
   * ⚠️ 只是**列出來**，不改變任何計算——解析順位由 lib 決定，
   *   這裡只負責讓使用者看得見「為什麼是這個值」。
   */
  const scopeConflicts = useMemo(
    () => scopeConflictsIn(pcuScopes),
    [pcuScopes],
  );

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
    /*
     * PCU 係數是「依計畫」儲存的，沒有選計畫就沒有地方可以存。
     * 先擋在這裡並說清楚，否則下面的失敗訊息會把原因誤說成「空間已滿」。
     */
    if (!activeProject) {
      setToast("PCU係數是依計畫各自儲存的，請先在左側建立或選擇一個計畫再套用");
      return;
    }
    /*
     * ── 這一次要寫到哪裡？ ──────────────────────────────────
     *
     * 選的是「全季別 × 全路段」→ 寫**計畫預設**（和改版前完全一樣的那條路徑）。
     * 選的是任何一個具體的季別或路段 → 寫成一筆**覆寫**，計畫預設不動。
     *
     * ⚠️ 這個分岔是整個功能的核心，寫錯的後果是相反方向的災難：
     *   ・該寫覆寫卻寫了預設 → 使用者只想改一段，結果全部路段都變了
     *   ・該寫預設卻寫了覆寫 → 使用者以為改了全部，其實只改了一格
     *   兩種都不會有錯誤訊息。tests/factor-scope-integration.test.mjs 的 B 段守這條。
     */
    const isProjectDefault =
      scopeQuarter === SCOPE_ANY && scopeRoadId === SCOPE_ANY;
    if (isProjectDefault) {
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
      return;
    }
    const nextScopes = upsertPcuScope(pcuScopes, {
      quarter: scopeQuarter,
      roadId: scopeRoadId,
      factors: {
        core: { ...pcuDraft },
        coreTurns: structuredClone(turnPcuDraft),
      },
    });
    setPcuScopes(nextScopes);
    const savedScopes = writeProjectPcuScopes(activeProject, nextScopes);
    /*
     * ⚠️ 覆寫**不做** persistCoreVehicleSync。
     *   那一支是把「車種分類」畫面裡歸類到四大類的鎖定欄位同步成目前係數，
     *   而那個畫面是計畫層級、沒有範圍概念。用某一季某一段的值去同步它，
     *   會讓那個畫面顯示一組不屬於任何範圍的數字。
     */
    setToast(
      savedScopes
        ? `已套用到「${pcuScopeLabel(quarterLabel(scopeQuarter), scopeRoadId, roadNameOf(scopeRoadId))}」，其他季別與路段不受影響`
        : "覆寫已套用到目前畫面，但無法寫入瀏覽器儲存（可能空間已滿或瀏覽器封鎖網站資料），關閉後會失效。",
    );
  };
  /** 路段代碼 → 顯示名稱（摘要與提示都用這一支，避免兩種寫法）。 */
  const roadNameOf = (roadId: string) =>
    roadId === SCOPE_ANY
      ? ""
      : records.find((record) => record.roadId === roadId)?.roadName || roadId;
  /** 把目前這一格的覆寫刪掉＝那一格還原成計畫預設。 */
  const clearPcuScope = (quarter: string, roadId: string) => {
    if (!activeProject) return;
    const nextScopes = removePcuScope(pcuScopes, quarter, roadId);
    setPcuScopes(nextScopes);
    const saved = writeProjectPcuScopes(activeProject, nextScopes);
    setToast(
      saved
        ? `「${pcuScopeLabel(quarterLabel(quarter), roadId, roadNameOf(roadId))}」已還原成計畫預設係數`
        : "已在畫面上還原，但無法寫入瀏覽器儲存，關閉後會失效。",
    );
  };
  const resetPcuFactors = () => {
    /* 同 applyPcuFactors：沒有計畫就沒有儲存位置，先說清楚再退出。 */
    if (!activeProject) {
      setToast("PCU係數是依計畫各自儲存的，請先在左側建立或選擇一個計畫");
      return;
    }
    setPcuDraft({ ...PCU_FACTORS });
    setPcuFactors({ ...PCU_FACTORS });
    setTurnPcuDraft(structuredClone(TURN_PCU_FACTORS));
    setTurnPcuFactors(structuredClone(TURN_PCU_FACTORS));
    const savedRoad = writeProjectPcuFactors(activeProject, {
      ...PCU_FACTORS,
    });
    const savedTurn = writeProjectTurnPcuFactors(
      activeProject,
      structuredClone(TURN_PCU_FACTORS),
    );
    setProjectHasOwnFactors(true);
    persistCoreVehicleSync(PCU_FACTORS, TURN_PCU_FACTORS);
    setToast(
      savedRoad && savedTurn
        ? "已恢復本計畫的路段與路口轉向預設PCU係數"
        : "預設係數已套用到目前畫面，但無法寫入瀏覽器儲存（可能空間已滿或瀏覽器封鎖網站資料），重新整理後會回到原本的值。",
    );
  };
  /**
   * 各分析區塊自己的篩選列。
   *
   * 這些控制項綁的就是最上方工具列的同一組狀態，所以在哪邊改都一樣、
   * 也不會產生第二套互相矛盾的條件；差別只在使用者不必為了換一個條件
   * 就把畫面捲回最上面再捲回來。每個區塊只列出它真正吃得到的條件。
   */
  /**
   * 「這個條件對本區塊不適用」的那一句。
   *
   * ⚠️ 「不適用」**不可以只是不做事**——使用者會以為篩選壞掉。
   *   而且只在真的篩了那個條件時才掛；沒篩時講一句沒有人問的話是另一種噪音。
   */
  /**
   * 「這一區用不到主工具列的這幾個條件」——一次講完。
   *
   * ⚠️ 只列**真的被篩了**的那幾個（沒篩卻講話是噪音，這是我們對
   *   「不適用說明」訂的規則）。全部都沒篩時回 null，整塊不出現。
   */
  const renderUnusedConditions = (
    fields: (keyof MainFilters)[],
    reason: string,
  ) => {
    const NAMES: Partial<Record<keyof MainFilters, string>> = {
      quarterFrom: "季度區間",
      roads: "路段／路口",
      directions: "車流方向",
      day: "日別",
      period: "調查時段",
      flowView: "路口流量視角",
      peakScope: "尖峰時段認定",
      metric: "顯示數值",
    };
    const hit = fields.filter((field) => isFiltered(mainFilters, field));
    if (!hit.length) return null;
    return (
      <p
        className="chart-inapplicable"
        data-testid="chart-inapplicable"
        /*
         * ⚠️ 這個屬性是給守門用的，使用者看不到，但它是
         *   「**哪一個條件**有被交代」唯一量得到的憑據。
         *
         * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，
         *   卻對某一個篩選條件卻沒出現不受影響的提醒文字」。
         *   只驗「這一塊有沒有說明」會**假綠**——它對季度講了一句，
         *   對顯示數值一個字都沒有，照樣算「有說明」。
         *   所以每一句不適用說明都要標出它交代的是哪幾個條件。
         */
        /*
         * ⚠️ 標的是這一句**涵蓋**的全部條件（fields），不是這次剛好被篩中的
         *   那幾個（hit）。句子本身講的就是這幾個條件都不適用；只標 hit 的話，
         *   守門在「只篩了其中一個」的情況下會誤判成其他幾個沒交代。
         *   顯示出來的名字仍然只列 hit——沒篩的條件不必對使用者念一遍。
         */
        data-inapplicable={fields.join(" ")}
      >
        本區不適用主工具列的「
        {hit.map((field) => NAMES[field] || String(field)).join("」「")}
        」：{reason}
      </p>
    );
  };
  /**
   * 單獨一句不適用說明。
   *
   * ⚠️ 第三個參數 `fields` 要寫出這一句**交代了哪幾個條件**（見上面的說明）。
   *   不寫的話守門看不到，這一塊在那個條件上仍然算「沒說」。
   */
  const renderInapplicable = (
    show: boolean,
    text: string,
    fields: (keyof MainFilters)[] = [],
  ) =>
    show ? (
      <p
        className="chart-inapplicable"
        data-testid="chart-inapplicable"
        data-inapplicable={fields.join(" ") || undefined}
      >
        {text}
      </p>
    ) : null;
  /**
   * 脫離中的區塊要掛的那一條說明＋回歸鈕。
   *
   * ⚠️ 2026-09-16 使用者回報：「這張圖我用自己的工具列篩選後，主工具列有正確
   *   跳出回歸，但**這張圖沒有跳出回歸主工具列的選項**」（歷季分析那一塊）。
   *
   *   成因：這一條原本**寫在 renderBlockFilters() 裡面**，而歷季分析
   *   自己手寫了一組工具列（它要釘在標題列上），沒有走那一支——
   *   於是脫離狀態是對的、主工具列的「回歸全部」也對，就是那一塊上面沒有鈕。
   *
   * ⚠️ 所以抽成獨立的一支：**凡是能脫離的區塊都要呼叫它**，
   *   不管那一塊的工具列是不是 renderBlockFilters 畫的。
   */
  const renderDetachNote = (chartId: string) =>
    isDetached(chartOverrides, chartId) ? (
      <p
        className="chart-detach-note"
        data-detached-chart={chartId}
        data-testid="chart-detach-note"
      >
        <span>
          {/* ⚠️ 一定要傳 showQuarter：這一句也是畫面上的季度顯示，
              切成西元年／調查月份時不可以還寫著民國年的季別。 */}
          目前用本區塊自己的條件（主工具列：
          {describeMain(mainFilters, showQuarter)}）
        </span>
        <button
          type="button"
          className="chart-detach-reset"
          data-testid="chart-detach-reset"
          onClick={() =>
            setChartOverrides((previous) => resetChart(previous, chartId))
          }
        >
          回到主工具列條件
        </button>
      </p>
    ) : null;
  /**
   * 每一塊自己的工具列。
   *
   * ⚠️ v20.74 起這一支**吃 chartId**：在這裡改一個條件，只有那一塊脫離
   *   （使用者 2026-09-14：「圖自己的篩選只影響自己，不會影響到其他圖表」）。
   *
   *   升級前它讀寫的是**全站共用的那一份 state**——在「24 小時型態」改一下
   *   日別，車種組成、平假日比較、可追溯明細全部跟著換，而那幾塊上沒有
   *   任何字告訴使用者是誰換的。那正是使用者說的
   *   「我以為我篩的是A條件，結果卻是其他功能列B的條件，結果一樣嚴重」。
   *
   * ⚠️ 沒有脫離時，這裡顯示的就是主工具列的值（鏡子）——
   *   主工具列一改，這一顆**看得到跟著變**。
   */
  const renderBlockFilters = (
    show: {
      quarter?: boolean;
      day?: boolean;
      road?: boolean;
      direction?: boolean;
      flow?: boolean;
      /** 主工具列的「調查時段」。只有主工具列要放，各塊自己那一層另外給。 */
      period?: boolean;
    },
    chartId: string,
  ) => {
    const own = filtersOf(chartId);
    return (
    <div className="block-filters">
      {show.quarter && (
        <label>
          季度（起）
          <select
            value={own.quarterFrom}
            onChange={(e) =>
              changeChartFilter(chartId, "quarterFrom", e.target.value)
            }
          >
            {quarters.map((q) => (
              <option key={q} value={q}>
                {quarterLabel(q)}
              </option>
            ))}
          </select>
        </label>
      )}
      {show.quarter && (
        <label>
          季度（迄）
          <select
            value={own.quarterTo}
            onChange={(e) =>
              changeChartFilter(chartId, "quarterTo", e.target.value)
            }
          >
            {quarters.map((q) => (
              <option key={q} value={q}>
                {quarterLabel(q)}
              </option>
            ))}
          </select>
        </label>
      )}
      {/*
       * ⚠️ 這兩顆一定要包在一起，不可以當成 grid 的獨立項目直接放。
       *
       * 使用者 2026-09-13：「期別顯示：季別 和 年份顯示：民國年，這兩個功能鍵
       * 不論是在哪個分頁，在三個程式裡，都顯得特別大顆」——量出來是真的：
       *   .block-filters 是 repeat(auto-fit, minmax(104px, 320px)) 的網格，
       *   按鈕當成格子項目時，**寬度被拉滿一整格 320px、高度被 stretch 成 49px**
       *   （同一排的下拉選單是 320×31），於是次要的顯示格式切換比真正常用的
       *   季度／日別／路段還搶眼。按鈕自己的 CSS（padding 5px 12px）很小，
       *   光讀樣式表看不出來——是外層網格撐大的。
       *
       * 包成一格之後：兩顆共用一個軌道、靠左、與下拉選單底部對齊，
       * 主從關係才跟使用頻率一致。
       */}
      {show.quarter && (
        <div className="block-filter-toggles">
          {periodDisplayToggle}
          {yearStyleToggle}
        </div>
      )}
      {show.day && (
        <label>
          日別
          <select
            value={own.day}
            onChange={(e) =>
              changeChartFilter(chartId, "day", e.target.value as DayChoice)
            }
          >
            <option>平日</option>
            <option>假日</option>
            <option>平日＋假日</option>
          </select>
        </label>
      )}
      {show.road && (
        <div className="filter-field">
          <span className="filter-field-label">路段／路口</span>
          <MultiPicker
            label="路段／路口"
            allLabel="全部調查點"
            options={roadOptions}
            value={own.roads}
            onChange={(value) => changeChartFilter(chartId, "roads", value)}
          />
        </div>
      )}
      {show.flow && hasIntersectionRecords && (
        <label>
          路口流量視角
          <select
            value={own.flowView}
            onChange={(e) => {
              changeChartFilter(
                chartId,
                "flowView",
                e.target.value as FlowChoice,
              );
              /* 換了視角，方向代碼整組換掉，舊條件留著只會篩不到東西 */
              changeChartFilter(chartId, "directions", []);
            }}
          >
            <option value="origin">駛出路口（起點）</option>
            <option value="destination">駛入路口（終點）</option>
            <option value="both">駛出＋駛入並列</option>
          </select>
        </label>
      )}
      {show.direction && (
        <div className="filter-field">
          <span className="filter-field-label">車流方向</span>
          <MultiPicker
            label="車流方向"
            allLabel="全部方向"
            options={directionOptions}
            value={own.directions}
            onChange={(value) =>
              changeChartFilter(chartId, "directions", value)
            }
          />
        </div>
      )}
      {show.period && (
        <label>
          調查時段
          <select
            id="mainPeriodSelect"
            value={own.period}
            onChange={(e) =>
              changeChartFilter(
                chartId,
                "period",
                e.target.value as PeriodChoice,
              )
            }
          >
            {(["all", "peak24", "am", "pm", "AMPM"] as PeriodChoice[]).map(
              (key) => (
                <option key={key} value={key}>
                  {PERIOD_CHOICE_LABELS[key]}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      {/*
       * 脫離中的區塊要說清楚「主工具列現在是什麼」，並給一顆回歸鈕。
       * ⚠️ 只寫「本區塊使用自訂條件」的話，使用者得自己捲回去對照才知道差在哪。
       * ⚠️ 實作在 renderDetachNote()——歷季分析那一塊的工具列是手寫的、
       *   不走這一支，所以那一條一定要能單獨呼叫（2026-09-16 的漏接就是這樣來的）。
       */}
      {renderDetachNote(chartId)}
    </div>
    );
  };
  /** origin ＝ 從這條支線出發 → 駛出；destination ＝ 開進這條支線 → 駛入 */
  const intersectionFlowLabelOf = (mode: IntersectionFlowMode) =>
    mode === "destination" ? "駛入" : "駛出";
  /*
   * ⚠️ 這兩支要用 useCallback 包起來。
   *
   * 它們被好幾個 useMemo 讀到，卻沒有出現在那些 useMemo 的相依陣列裡
   *（eslint 的 react-hooks/exhaustive-deps 一直在警告）。不包的話每次
   * render 都是新的函式，加進相依陣列會讓那些 useMemo 每次都重算；
   * 不加又是「相依漏列」——**漏列的後果是畫面換了設定，記憶體裡那份
   * 舊的算式還在，匯出去的數字沿用舊值**，而且不會有任何錯誤。
   * 包起來之後兩邊都成立：加得進相依陣列，也不會每次重算。
   */
  const displayDirectionNameFor = useCallback(
    (record: TrafficRecord, mode: IntersectionFlowMode) => {
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
      /*
       * ⚠️ 「有沒有取過名字」要走 isRealArmName()，不可以直接比字串。
       *   自動命名可能是「路口 A」（中間有半形空格），直接比的話會被當成
       *   使用者取的名字，標籤就變成「駛出路口A（路口 A）」——
       *   括號裡重複一次看起來一模一樣的名字。
       */
      return `${flowLabel}路口${record.directionCode}${
        isRealArmName(customName, record.directionCode)
          ? `（${customName}）`
          : ""
      }`;
    },
    [intersectionSettings, activeProject],
  );
  const displayDirectionName = useCallback(
    (record: TrafficRecord) =>
      displayDirectionNameFor(record, intersectionFlowMode),
    [displayDirectionNameFor, intersectionFlowMode],
  );
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
  /*
   * 把每一筆紀錄上存的決定（noonSide），收成 buildPeriodRows 吃的那張表。
   *
   * ⚠️ 逐筆從紀錄讀，不另外存一份：另外存一份就會有「紀錄說 A、設定說 B」
   *   的可能，而那種不一致沒有任何症狀，只會讓數字安靜地對不起來。
   *
   * ⚠️ 兩種鍵都要寫進去。日別選「平日＋假日」時分析會逐日別分開算（鍵帶
   *   日別），選單一日別時則不分（鍵的日別是空字串）——只寫其中一種的話，
   *   使用者一切換日別，他當初的決定就靜靜地失效了。
   */
  const noonAnswers = useMemo<NoonAnswers>(() => {
    const out: NoonAnswers = {};
    for (const record of activeRecords) {
      const side = record.noonSide;
      if (side !== "am" && side !== "pm" && side !== "ignore") continue;
      out[noonStraddleKey(record.roadId, String(record.dayType ?? ""))] = side;
      out[noonStraddleKey(record.roadId, "")] = side;
    }
    return out;
  }, [activeRecords]);
  /*
   * 目前的篩選（季別＋日別＋路段／路口＋關鍵字）到底命中幾個調查點。
   *
   * ⚠️ 這個數字要和表格用的**同一組條件**算出來，不可以另外寫一份簡化版——
   *   寫兩份的話會出現「這裡說符合 3 個、表格卻是空的」，比不寫更糟。
   *   條件與 computePeriodRows() 的 inScope 一致。
   */
  const searchMatchCount = useMemo(() => {
    const keyword = search.trim();
    if (!keyword) return 0;
    const ids = new Set<string>();
    for (const record of activeRecords) {
      if (record.quarter !== quarter) continue;
      if (dayType !== "平日＋假日" && record.dayType !== dayType) continue;
      if (!matchesRoad(record.roadId)) continue;
      if (
        !record.roadName.includes(keyword) &&
        !record.roadId.includes(keyword)
      )
        continue;
      ids.add(record.roadId);
    }
    return ids.size;
  }, [activeRecords, quarter, dayType, matchesRoad, search]);
  /*
   * 兩種路口流量視角各自的紀錄。
   *
   * ⚠️ v20.74 起各區塊可以有自己的視角（脫離主工具列），
   *   所以兩份都要先備好，由各區塊自己挑。
   *   兩份都用同一支 deriveDestinationIntersectionRecords，不另寫一套。
   */
  const recordsByFlowMode = useMemo(() => {
    const named = (list: TrafficRecord[]) =>
      list.map((record) =>
        record.surveyType === "intersection" || record.turnData
          ? { ...record, directionName: displayDirectionName(record) }
          : record,
      );
    return {
      origin: named(activeRecords),
      destination: named(
        deriveDestinationIntersectionRecords(
          activeRecords,
          activeProject,
          intersectionSettings,
        ),
      ),
    };
  }, [
    activeRecords,
    intersectionSettings,
    activeProject,
    displayDirectionName,
  ]);
  /** 主工具列那一份（KPI 區、匯出與歷季分析讀這一份）。 */
  const analysisRecords = useMemo(
    () =>
      intersectionFlowMode === "destination"
        ? recordsByFlowMode.destination
        : recordsByFlowMode.origin,
    [recordsByFlowMode, intersectionFlowMode],
  );
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
      setToast(
        "車種分類設定沒有存進瀏覽器（空間可能已滿），重新整理後會回到舊值",
      );
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
    () =>
      [...new Set(activeRecords.map((r) => r.quarter))].sort(compareQuarters),
    [activeRecords],
  );
  useEffect(() => {
    if (!quarters.length) {
      if (quarter) setQuarter("");
      return;
    }
    if (!quarters.includes(quarter)) setQuarter(quarters.at(-1) ?? "");
  }, [quarters, quarter, activeProject]);
  /*
   * 起始季度預設**跟著結束季度走**（起＝迄＝單季）。
   *
   * ⚠️ 使用者主動拉開之後就不再自動跟隨，否則他每改一次結束季度，
   *   自己設好的區間就被擦掉一次。清單裡沒有這一季（換計畫、刪季度）時
   *   也要拉回來，不然會停在一個不存在的季度上，篩出空的畫面。
   */
  useEffect(() => {
    if (!quarterFromTouched) {
      const next = quarter || quarters.at(-1) || "";
      if (quarterFrom !== next) setQuarterFrom(next);
      return;
    }
    if (!quarterFrom || !quarters.includes(quarterFrom))
      setQuarterFrom(quarter || quarters.at(-1) || "");
  }, [quarters, quarterFrom, quarter, quarterFromTouched]);
  /*
   * ── 主工具列目前的一整組條件 ────────────────────────────────
   *
   * ⚠️ 各塊要用的是 filtersOf(區塊 id)，不是直接讀這一份——
   *   直接讀就沒有「區塊可以自己改」那一態了。
   */
  const mainFilters: MainFilters = useMemo(
    () => ({
      ...DEFAULT_MAIN_FILTERS,
      quarterFrom: quarterFrom || quarter,
      quarterTo: quarter,
      roads: roadFilters,
      directions,
      day: dayType as DayChoice,
      period: periodChoice,
      flowView: flowChoice,
      peakScope: periodPeakScope,
      metric: metricChoice,
    }),
    [
      quarterFrom,
      quarter,
      roadFilters,
      directions,
      dayType,
      periodChoice,
      flowChoice,
      periodPeakScope,
      metricChoice,
    ],
  );
  /*
   * ── X-10：一鍵把主工具列的條件回到預設（使用者 2026-09-16）─────
   *
   * 使用者原話：「主工具列少了一個按鍵功能，就是恢復預設選項按鍵……
   *   讓使用者可以按下後，一鍵恢復主工具列各項篩選條件恢復到預設值」
   *
   * ⚠️ 這一顆與「回歸全部」是**兩件事**：
   *   ・這一顆改的是**主工具列自己的值**
   *   ・「回歸全部」是把**脫離的區塊**拉回來跟隨主工具列
   *   所以這裡一個字都不碰 chartOverrides。
   *
   * ⚠️ 條件本來就是預設值時**不出現**（主工具列要簡潔）。
   * ⚠️ quarterFromTouched 要一起放掉，否則上面那個 useEffect 認為
   *   「使用者自己拉過區間」而不肯把起季拉回來——按了看起來像沒反應。
   */
  const mainAtDefault =
    quarter === (quarters.at(-1) ?? "") &&
    quarterFrom === quarter &&
    roadFilters.length === 0 &&
    directions.length === 0 &&
    (dayType as string) === (DEFAULT_MAIN_FILTERS.day as string) &&
    (periodChoice as string) === (DEFAULT_MAIN_FILTERS.period as string) &&
    (flowChoice as string) === (DEFAULT_MAIN_FILTERS.flowView as string) &&
    (periodPeakScope as string) ===
      (DEFAULT_MAIN_FILTERS.peakScope as string) &&
    (metricChoice as string) === (DEFAULT_MAIN_FILTERS.metric as string);
  const resetMainFilters = useCallback(() => {
    setQuarterFromTouched(false);
    setQuarter(quarters.at(-1) ?? "");
    setRoadFilters([]);
    setDirections([]);
    setDayType(DEFAULT_MAIN_FILTERS.day as DayMode);
    setPeriodChoice(DEFAULT_MAIN_FILTERS.period as PeriodChoice);
    setFlowChoice(DEFAULT_MAIN_FILTERS.flowView as FlowChoice);
    setPeriodPeakScope(DEFAULT_MAIN_FILTERS.peakScope as PeakScope);
    setMetricChoice(DEFAULT_MAIN_FILTERS.metric as MetricChoice);
  }, [quarters]);
  /** 某一塊實際該用的條件（沒脫離時就是主工具列那一份）。 */
  const filtersOf = useCallback(
    (chartId: string) => filtersFor(mainFilters, chartOverrides, chartId),
    [mainFilters, chartOverrides],
  );
  /** 在某一塊上改一個條件——只有那一塊會變。 */
  const changeChartFilter = useCallback(
    function <K extends keyof MainFilters>(
      chartId: string,
      field: K,
      value: MainFilters[K],
    ) {
      setChartOverrides((previous) =>
        setChartFilter(previous, chartId, field, value),
      );
    },
    [],
  );
  const detachedCharts = useMemo(
    () => detachedIds(chartOverrides),
    [chartOverrides],
  );
  /*
   * ── L-2：浮動小卡要列的名稱與落點 ──────────────────────────
   *
   * ⚠️ 名稱抄的是**側欄那一份**（PAGE_ZONES 的 items），不是另外寫一份中文名：
   *   「同一件事寫在兩個地方就會漂移」是這個專案踩過好幾次的坑。
   *   這張表只負責把「圖的 id」對到「側欄項目的 anchor」。
   *
   * ⚠️ 對不到的**不可以默默丟掉**——那會讓小卡列的數量與
   *   「回歸全部（N）」對不起來。對不到就原樣列出 id，
   *   看起來突兀正好提醒要補對應。
   */
  const detachedItems = useMemo(
    function (): DetachedItem[] {
      const anchorOf: Record<string, string> = {
        composition: "block-composition",
        hourly: "block-hourly",
        trend: "block-trend",
        "day-compare": "block-comparison",
        trace: "block-detail",
        "trace-intersection": "block-detail",
        "period-vehicle": "periodAnalysis",
      };
      /* 側欄那一份：anchor → {label, zone}。 */
      const fromNav = new Map<string, { label: string; zone: string }>();
      for (const page of PAGES)
        for (const item of page.items)
          if ("anchor" in item)
            fromNav.set(item.anchor as string, {
              label: item.label,
              /* ⚠️ X-63：這裡要的是**大分頁**，不是分區——守門用它回頭找頁。 */
              zone: page.id as string,
            });
      /*
       * ⚠️ 兩張可追溯明細共用同一個側欄小分頁（block-detail），所以
       *   光靠 fromNav 兩張都叫「可追溯明細」——使用者 2026-09-16 實測回報：
       *   「表的名字還一模一樣無法區分」。
       *   這裡補上分得出來的那一段（與各自標題上的 eyebrow 同一組字）。
       * ⚠️ 只在**真的會撞名**的那幾個 id 上補，不做成一張全量對照表：
       *   名稱的來源仍然是側欄，改一次標題不必記得改兩個地方。
       */
      const suffixOf: Record<string, string> = {
        trace: "（路段格式）",
        "trace-intersection": "（路口格式）",
      };
      return detachedCharts.map(function (id) {
        const anchor = anchorOf[id] ?? "";
        const nav = anchor ? fromNav.get(anchor) : undefined;
        return {
          id,
          label: (nav ? nav.label : id) + (suffixOf[id] ?? ""),
          zone: nav ? nav.zone : "",
          anchor,
        };
      });
    },
    [detachedCharts],
  );
  /*
   * ── 每一塊的 id ────────────────────────────────────────────
   * 脫離／回歸都以這個字串為鍵，畫面上的 data-detached-chart 也是它。
   * ⚠️ 不要用中文標題當 id：標題改名過好幾次。
   */
  const CHART_COMPOSITION = "composition";
  const CHART_HOURLY = "hourly";
  const CHART_TREND = "trend";
  const CHART_DAY_COMPARE = "day-compare";
  const CHART_TRACE = "trace";
  const CHART_PERIOD = "period-vehicle";
  /*
   * ⚠️ 可追溯明細有**兩張表**（路段的與路口的），它們各有自己的工具列，
   *   所以是兩塊、兩個 id。共用一個 id 的話，在路段那張改一下，
   *   路口那張也跟著脫離——那不是使用者按的。
   */
  const CHART_TRACE_INTERSECTION = "trace-intersection";
  /** 不吃主工具列「調查時段」的區塊（見 recordsForChart 裡的說明）。 */
  const PERIOD_INAPPLICABLE_CHARTS = useMemo(
    /*
     * 車種組成也在這裡：它**吃**時段，但吃法是「挑出那個調查點的尖峰那一小時」
     *（見 compositionRecords），不是「留下上午所有小時」。所以 recordsForChart
     * 這一層先給它整段涵蓋，尖峰那一小時由它自己挑。
     */
    () => new Set([CHART_TRACE, CHART_TRACE_INTERSECTION, CHART_COMPOSITION]),
    [CHART_TRACE, CHART_TRACE_INTERSECTION, CHART_COMPOSITION],
  );
  /*
   * 報表批次輸出中心。使用者 2026-09-14 裁示它**維持獨立**，
   * 另加一顆「套用主工具列目前的條件」。
   */
  /*
   * ⚠️ v20.74 起歷季分析吃**自己那一組條件**（可以脫離主工具列）。
   *   沒脫離時 trendFilters 就是主工具列那一份，行為與升級前完全相同。
   */
  const trendFilters = filtersOf(CHART_TREND);
  const trendMode: TrendMode = trendFilters.day as TrendMode;
  const setTrendMode = useCallback(
    (value: TrendMode) => changeChartFilter(CHART_TREND, "day", value as DayChoice),
    [changeChartFilter, CHART_TREND],
  );
  /*
   * 時段車種分析那一區自己的條件。
   * ⚠️ 這一區本來就是「最完整」的那一塊（使用者的原話），
   *   所以它的每一顆條件都要能脫離；沒動過時顯示的就是主工具列的值。
   */
  /*
   * ── 主工具列的收合 ────────────────────────────────────────
   *
   * 使用者 2026-09-15：「你當初是說會將主工具列固定在上方隨時可見，
   * 只是會做著展開的按鈕，避免版面佔用過大」。
   *
   * ⚠️ 收起來的時候**不可以什麼都看不到**：收合列上永遠寫著目前的條件
   *   （describeMain），而且「回歸全部」也留在收合列上——那一顆的用途正是
   *   「有區塊脫離了、而它可能捲在很下面看不到」。
   * ⚠️ 預設**展開**，但記住使用者的選擇。
   */
  /*
   * ⚠️ X-78（使用者 2026-09-17）：「重新載入或第一次開網頁時，
   *   主工具列是否能預設為收合狀態。下方版面比較清楚」。
   *
   *   預設改成**收合**。收起來的那一列仍然寫著目前的條件（見 mt-summary），
   *   所以「現在依什麼在算」照樣一眼看得到——這一點不可以為了收合而犧牲，
   *   那是 2026-09-15 定下的規則。
   *
   * ⚠️ 不記進 localStorage：使用者說的是「重新載入或第一次開網頁時」，
   *   也就是每一次開啟都要是收合的。記住狀態反而做不到他要的事。
   */
  const [toolbarOpen, setToolbarOpen] = useState(false);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  把主工具列的**實際高度**寫進 CSS 變數 --main-toolbar-h
   * ══════════════════════════════════════════════════════════════════
   *
   * 為什麼一定要量、不能寫死：
   *   ・主工具列可以收合（收合約 44px、展開 95～110px）
   *   ・視窗窄的時候欄位會換行，高度再往上長
   *   ・「回歸全部（N 塊）」那一顆有時候在、有時候不在
   *
   * ⚠️ 2026-09-15 查到的既有缺陷：`.trend-pinned` 的 `top` 寫死 8px，
   *   那是**主工具列還沒加進來之前**算的，所以歷季趨勢圖捲動時
   *   上緣會被工具列切掉——與使用者先前回報的「標題文字消失」同一個症狀。
   *
   * ⚠️ ResizeObserver 讀不到（很舊的瀏覽器）時**不可以整支壞掉**：
   *   量不到就維持 0px，sticky 只是位置略高，不影響任何資料。
   */
  const mainToolbarRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = mainToolbarRef.current;
    if (!node) return;
    const write = () => {
      document.documentElement.style.setProperty(
        "--main-toolbar-h",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    write();
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(write);
      observer.observe(node);
    } catch {
      /* 沒有 ResizeObserver 就只靠 resize 事件，總比整支壞掉好。 */
    }
    globalThis.addEventListener("resize", write);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener("resize", write);
    };
    /*
     * ⚠️ 相依陣列要有 toolbarOpen：收合／展開會換掉 DOM 內容，
     *   ResizeObserver 雖然也會收到，但它是**非同步**的；
     *   這裡同步量一次，讓「剛切換完」那一瞬間的值也是對的。
     */
  }, [toolbarOpen]);
  const toggleToolbar = () => setToolbarOpen((previous) => !previous);
  const periodFilters = filtersOf(CHART_PERIOD);
  /*
   * ── 這一區自己的「路口流量視角」──────────────────────────────
   *
   * ⚠️ v20.75 起改成走**三態**（和這一區其他每一顆一樣），
   *   不再是一個獨立的 state、也不再有「跟隨上方工具列」這個選項。
   *
   * 使用者 2026-09-15（附圖）：「當上方工具列路口流量視角為駛入路口時……
   *   我使用該表單自己的工具列，選擇路口流量視角為『駛出路口』時，
   *   **並未跳出回歸上方工具列的按鈕**。你是要將這個表格設計成完全獨立，
   *   還是有要跟隨上方工具列呢?」
   *
   * 他問到的是一個**真的不一致**：同一排四顆，季度／日別／調查點／
   * 尖峰認定／顯示數值都走 `changeChartFilter`（動了就脫離、就跳回歸鈕），
   * 唯獨這一顆是自己的 state——動了不算脫離，所以沒有任何回歸鈕，
   * 而且「跟隨上方工具列」這個選項和三態的「沒動過就是跟著走」重複，
   * 等於同一件事有兩套做法。
   *
   * 現在：沒動過 → 顯示主工具列的值（鏡子）；動了 → 這一區脫離、
   * 跳出「回到主工具列條件」，主工具列上的「回歸全部」也會算進這一塊。
   */
  const periodFlowView = periodFilters.flowView;
  /**
   * 時段車種分析那一張表實際採用的「顯示數值」。
   *
   * ⚠️ 一定要從 periodFilters 攤開，不可以用主工具列的 metricChoice：
   *   區塊上那一顆下拉寫的是 periodFilters.metric，表格若讀另一份，
   *   選了就不會有反應（脫離時尤其明顯）。
   * ⚠️ 組合選項（pcuShare／countShare）在計算層沒有自己的 MetricKey，
   *   主值仍然是 pcu／count，百分比由 metricShowsShare() 另外加一欄。
   */
  const periodMetric: MetricKey = metricBaseOf(periodFilters.metric);

  /** 歷季分析自己的調查點篩選（空陣列＝全部）。 */
  const trendMatchesRoad = useCallback(
    (id: string) =>
      trendFilters.roads.length === 0 || trendFilters.roads.includes(id),
    [trendFilters],
  );
  /*
   * 每一個季別在畫面上要顯示成什麼。切到「調查月份」時，取那一季底下所有
   * 紀錄的調查日期，列出實際做調查的月份（例：「115年2、3月」）。
   * 那一季完全沒有日期（本版之前匯入的舊資料）就原樣顯示季別——不編、
   * 也不留空白，畫面上另有一行寫明重新匯入才會有月份。
   */
  const quarterLabels = useMemo(() => {
    const dates: Record<string, string[]> = {};
    for (const record of activeRecords)
      if (record.surveyDate)
        dates[record.quarter] = [
          ...(dates[record.quarter] ?? []),
          record.surveyDate,
        ];
    const labels: Record<string, string> = {};
    for (const key of quarters)
      labels[key] = periodDisplayLabel(
        key,
        dates[key] ?? [],
        periodDisplay,
        yearStyle,
      );
    return { labels, anyDate: Object.keys(dates).length > 0 };
  }, [activeRecords, quarters, periodDisplay, yearStyle]);
  const quarterLabel = (value: string) => quarterLabels.labels[value] || value;
  /*
   * 季度字串在畫面與匯出檔上要顯示成什麼樣子。
   * 只換文字：傳進來的 quarter 仍是分組、排序與識別鍵的依據。
   *
   * ⚠️ 這一支必須**同時**套上兩層：年份寫法（民國／西元）與期別寫法
   *   （季別／調查月份）。
   *
   * 使用者 2026-09-13（在交通服務水準上發現，並指定三支都要查）：
   *   「期別顯示調查月份 和西元年，但這裡的資料**只有成功變成西元年，
   *     沒有變成調查月份**。請確認月份和年的切換功能都有正常運作。」
   *   「三份程式都有，確認都有正常運作 調查月份 和 年 切換。」
   *
   * 舊版這裡只呼叫 quarterInYearStyle（**只換年份**），
   * 而畫面上二十幾個顯示季度的地方走的是這一支——於是年份會換、期別永遠不換。
   * 按鈕上寫著「調查月份」，欄位給的卻是季別，**畫面在說謊**。
   *
   * ⚠️ 不要在每個呼叫端各自補第二層：地方太多一定會漏，漏掉的不會有錯誤訊息。
   * ⚠️ 認得的季度才有月份可查；不在清單裡的（例如別的計畫的季度）
   *   仍然退回只換年份，不可以原樣吐回民國年。
   */
  /*
   * ⚠️ 包成 useCallback 不是為了效能：下面的 applyMainToConclusion 依賴它，
   *   每次 render 都換一個新函式的話，那個 useCallback 的相依每次都變，
   *   等於 memo 沒有作用，而且 lint 會要求貼 eslint-disable——
   *   那正是我們說好不要的貼紙。
   */
  const showQuarter = useCallback(
    (value: string) =>
      quarterLabels.labels[value] ?? quarterInYearStyle(value, yearStyle),
    [quarterLabels, yearStyle],
  );
  /*
   * ── 「套用主工具列目前的條件」（結論草稿產生器） ────────────────
   *
   * 使用者 2026-09-14：結論草稿與報表輸出**維持獨立**，另加這一顆。
   *
   * ⚠️ 三件事一定要做對，否則這一顆比沒有還糟：
   *   ① 「並列」與「全部」在這裡都要換成**空陣列或兩個都放**，
   *     不可以把 "AMPM"／"both" 這種值塞進條件——那不是任何一筆資料的值，
   *     條件看起來設好了卻會篩出 0 列。
   *   ② 「尖峰時段認定」與「顯示數值」不是結論草稿的條件（它有自己的
   *     「要寫哪些數字」），所以不套，並在訊息裡點名沒有套進去。
   *   ③ 要**說出套用了什麼**。
   */
  const applyMainToConclusion = useCallback((): string => {
    const from = mainFilters.quarterFrom;
    const to = mainFilters.quarterTo;
    const scope: ConclusionScope =
      from && to && from !== to
        ? { kind: "range", from, to }
        : { kind: "quarter", quarter: to || from };
    const periods: PeriodKey[] =
      mainFilters.period === "AMPM"
        ? ["am", "pm"]
        : ([mainFilters.period] as PeriodKey[]);
    const dayTypes =
      mainFilters.day === "平日＋假日" ? [] : [mainFilters.day];
    /*
     * ── 方向／支線的代碼要跟著「路口流量視角」換 ────────────────
     *
     * ⚠️ 這是 2026-09-15 大檢查查到的**篩選錯誤**：
     *   草稿的駛入那一輪把 scopeCode 存成 `IN:<代碼>`（不加前綴會和駛出的
     *   A／B／C 撞在一起），而主工具列的 directions 存的是**沒有前綴**的代碼。
     *   舊版原封不動抄過去，於是使用者在主工具列選「駛入路口」＋支線 A，
     *   按下這一顆之後草稿挑到的卻是**駛出**的支線 A——
     *   名稱對、數字錯，而畫面上完全看不出來。
     */
    const flowView: NonNullable<ConclusionCondition["flowView"]> =
      mainFilters.flowView === "origin"
        ? "origin"
        : mainFilters.flowView === "destination"
          ? "destination"
          : "both";
    const scopeCodes = mainFilters.directions.flatMap((code) =>
      flowView === "destination"
        ? [`IN:${code}`]
        : flowView === "origin"
          ? [code]
          : [code, `IN:${code}`],
    );
    setConclusionCondition({
      ...conclusionCondition,
      scope,
      periods,
      dayTypes,
      roadIds: [...mainFilters.roads],
      scopeCodes,
      flowView,
      /*
       * 尖峰時段認定現在**是**結論草稿的條件（2026-09-15 補上），
       * 所以這一顆也要把它帶過來——否則「套用主工具列」會漏掉一個
       * 會改變每一個尖峰數字的條件。
       */
      peakScope: mainFilters.peakScope,
    });
    const parts = [
      scope.kind === "range"
        ? `季度 ${showQuarter(from)}～${showQuarter(to)}`
        : `季度 ${showQuarter(to || from)}`,
      mainFilters.roads.length
        ? `調查點 ${mainFilters.roads.length} 個`
        : "全部調查點",
      dayTypes.length ? `日別 ${dayTypes.join("、")}` : "全部日別",
      mainFilters.directions.length
        ? `方向 ${mainFilters.directions.length} 個`
        : "全部方向",
      `時段 ${periods.join("、")}`,
      `路口流量視角 ${
        flowView === "origin" ? "駛出" : flowView === "destination" ? "駛入" : "駛出＋駛入"
      }`,
      `尖峰時段認定 ${PEAK_SCOPE_CHOICE_LABELS[mainFilters.peakScope]}`,
    ];
    return (
      "已套用主工具列：" +
      parts.join("、") +
      "。（「顯示數值」不是結論草稿的條件——這一頁用的是自己的「要寫哪些數字」，維持原設定）"
    );
  }, [mainFilters, conclusionCondition, showQuarter]);

  /* 期別顯示切換鈕。三支程式的外觀與文字一致。 */
  const periodDisplayToggle = (
    <button
      type="button"
      className={
        periodDisplay === "month"
          ? "period-display-toggle is-on"
          : "period-display-toggle"
      }
      data-testid="period-display-toggle"
      disabled={!quarterLabels.anyDate}
      title={
        quarterLabels.anyDate
          ? "切換期別顯示方式：季別（115Q1）／實際調查月份（115年2、3月）。只換顯示文字，不影響分組與計算。"
          : "目前的資料沒有調查日期可用，無法顯示調查月份。重新匯入原始檔之後就會有。"
      }
      onClick={() =>
        setPeriodDisplay(periodDisplay === "month" ? "quarter" : "month")
      }
    >
      期別顯示：{PERIOD_DISPLAY_LABELS[periodDisplay]}
    </button>
  );
  const yearStyleToggle = (
    <button
      type="button"
      className={
        yearStyle === "ad"
          ? "period-display-toggle is-on"
          : "period-display-toggle"
      }
      data-testid="year-style-toggle"
      title="切換年份顯示方式：民國年（115Q1）／西元年（2026Q1）。畫面與匯出的 Excel 會一起換；資料一律以民國年儲存，切換不影響分組、排序與計算。"
      onClick={() => setYearStyle(yearStyle === "ad" ? "roc" : "ad")}
    >
      年份顯示：{YEAR_STYLE_LABELS[yearStyle]}
    </button>
  );
  const directionOptions = useMemo(() => {
    const names = new Map<string, Set<string>>();
    analysisRecords
      .filter((record) => matchesRoad(record.roadId))
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
  }, [analysisRecords, matchesRoad, displayDirectionName]);
  /* 條件的文字描述，KPI 與匯出摘要共用一份，避免兩處各寫各的。 */
  const directionLabelText =
    directions.length === 0
      ? "全部方向"
      : directions.length === 1
        ? (directionOptions.find(([code]) => code === directions[0])?.[1] ??
          directions[0])
        : `${directions.length} 個方向`;
  const scoped = useMemo(
    () =>
      analysisRecords.filter(
        (r) =>
          r.quarter === quarter &&
          (dayType === "平日＋假日" || r.dayType === dayType) &&
          matchesRoad(r.roadId) &&
          (r.roadName.includes(search) || r.roadId.includes(search)),
      ),
    [analysisRecords, quarter, dayType, matchesRoad, search],
  );
  /*
   * ══════════════════════════════════════════════════════════════════
   *  主工具列「調查時段」真正吃到計算的地方
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ 這一段不可以只換標籤。使用者 2026-09-12 已經因為「以為篩的是 A、
   *   其實吃到 B」踩過一次，那次的結論是「**篩選錯誤和計算錯誤是一樣嚴重**」。
   *   我第一版只做了「兩張不受影響的卡自己講出來」，尖峰卡的數字**完全沒動**
   *   ——那等於工具列是假的，比沒有還糟。
   *
   * 語意（與「時段車種分析」那一塊同一套，見 period-analysis.ts 開頭）：
   *   all    ＝ 這份調查涵蓋的時段全部加總 → 不限制資料
   *   peak24 ＝ 在整段涵蓋裡最忙的一小時   → 不限制資料（由尖峰演算法自己挑）
   *   am     ＝ 只在**起始時間早於中午 12:00** 的時段裡挑尖峰
   *   pm     ＝ 只在**起始時間不早於 12:00** 的時段裡挑尖峰
   *
   * ⚠️ 已知界線，不要當成已驗證：橫跨中午的視窗（例如 11:15～12:15）
   *   兩邊都挑不到。那是刻意的——它該算上午還是下午沒有客觀答案，
   *   「時段車種分析」是**另外問使用者**（見 NoonStraddle）。
   *   這裡沿用同一條分界，所以結果會和那一塊一致；
   *   若之後要讓 KPI 卡也吃跨中午的答案，要連同 noonAnswers 一起接。
   */
  const periodScoped = useMemo(() => {
    if (mainPeriod === "am")
      return scoped.filter((r) => isMorningHour(r.hour ?? ""));
    if (mainPeriod === "pm")
      return scoped.filter((r) => isAfternoonHour(r.hour ?? ""));
    return scoped;
  }, [scoped, mainPeriod]);
  /*
   * 規則②（使用者 2026-09-13 確認）：這張圖**吃**這個條件、但篩完沒有資料時，
   * 要指名是哪一個條件把它篩空的，並給一顆只解除那一個條件的按鈕。
   * ⚠️ 與規則①（不適用 → 照常顯示＋一行說明）是**兩件事**，不可以用同一句話打發：
   *   講錯會讓使用者以為資料掉了，或以為數字有跟著變。
   */
  /*
   * ⚠️ 並列（AMPM）時要**兩段都空**才算被篩空。
   *   只看 periodScoped（＝攤平後的上午那一段）的話，
   *   「上午沒有資料、下午有」會被寫成「這個條件把資料篩空了」，
   *   而畫面右邊其實正印著下午那一組數字——自相矛盾。
   */
  const periodFilteredEmpty =
    scoped.length > 0 &&
    (periodChoice === "AMPM"
      ? !scoped.some((r) => isMorningHour(r.hour ?? "")) &&
        !scoped.some((r) => isAfternoonHour(r.hour ?? ""))
      : periodScoped.length === 0);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  每一塊自己的那一批紀錄
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ 這一支是升級的核心：各塊不再共用 `filtered`，而是拿**自己那一組條件**
   *   篩出來的資料。沒有脫離時算出來的與 `filtered` 完全相同
   *  （同一組條件、同一串判斷），所以升級當天一個數字都不會變。
   *
   * ⚠️ 「調查時段」也在這裡吃掉——這正是對照表記下的**缺口①**：
   *   升級前只有 KPI 卡吃它，車種組成、24 小時型態、可追溯明細
   *   一個都不吃。使用者在主工具列選了「上午尖峰小時」往下捲，
   *   看到的其實還是全調查時段的組成，而畫面上沒有任何地方說明。
   *
   * ⚠️ 「並列」（AMPM）在資料層**不篩掉任何東西**——它的意思是
   *   「這一塊要同時呈現兩個時段」，是呈現方式不是篩選。
   *   當成篩選的話，「全調查時段」與「並列」就變成同一件事。
   *
   * ⚠️ 季度：起＝迄＝單季（＝升級前的行為）；拉開才吃區間。
   */
  /**
   * 某一塊實際要用的紀錄。
   *
   * @param chartId  哪一塊
   * @param forceFlow 強制用某一種路口流量視角（X-17：可追溯明細那兩張表
   *   的視角一律由**主工具列**決定，區塊工具列不再有這一項；
   *   主工具列選「並列」時，呼叫端會分別要 origin 與 destination 兩份）。
   */
  const recordsForChart = useCallback(
    (chartId: string, forceFlow?: IntersectionFlowMode) => {
      const base = filtersFor(mainFilters, chartOverrides, chartId);
      const own = forceFlow ? { ...base, flowView: forceFlow } : base;
      /*
       * ⚠️ 路口流量視角要**在這裡就決定**，不可以沿用主工具列那一份
       *  （analysisRecords）。這一塊脫離成「駛入」時，如果資料還是駛出那一份，
       *   畫面上寫著駛入、數字是駛出——這種錯沒有任何症狀。
       * ⚠️ 「並列」這一層攤成駛出（origin）：畫得出並列的區塊自己另外處理，
       *   畫不出來的要掛「不適用」說明，不可以默默只畫駛出而不說。
       */
      const source =
        own.flowView === "destination"
          ? recordsByFlowMode.destination
          : recordsByFlowMode.origin;
      const from = own.quarterFrom || own.quarterTo;
      const to = own.quarterTo;
      const single = !from || !to || from === to;
      return source.filter((r) => {
        if (single) {
          if (r.quarter !== to) return false;
        } else if (
          compareQuarters(r.quarter, from) < 0 ||
          compareQuarters(r.quarter, to) > 0
        )
          return false;
        if (own.day !== "平日＋假日" && r.dayType !== own.day) return false;
        if (own.roads.length && !own.roads.includes(r.roadId)) return false;
        if (own.directions.length && !own.directions.includes(r.directionCode))
          return false;
        if (!(r.roadName.includes(search) || r.roadId.includes(search)))
          return false;
        /*
         * ⚠️ 2026-09-18 大檢查（F-14）：可追溯明細的兩張表**不吃「調查時段」**。
         *   那兩張表一列一個調查點、每一列本來就同時寫出全調查時段、上午尖峰與
         *   下午尖峰，畫面上也掛著「不適用調查時段」的說明。但這裡原本對 am／pm
         *   一律把紀錄限縮到「上午（或下午）所有小時」再交給 buildRoadRows 加總，
         *   實測：主工具列選「上午尖峰小時」→ 中山北路「全日」31,847 變成 11,737、
         *   表頭卻還寫「全日（輛／調查日）」——畫面說不適用，數字卻是半天的量。
         *   所以這兩張表跳過時段這一層；其餘區塊照舊。
         */
        if (!PERIOD_INAPPLICABLE_CHARTS.has(chartId)) {
          if (own.period === "am" && !isMorningHour(r.hour ?? "")) return false;
          if (own.period === "pm" && !isAfternoonHour(r.hour ?? "")) return false;
        }
        return true;
      });
    },
    [recordsByFlowMode, mainFilters, chartOverrides, search, PERIOD_INAPPLICABLE_CHARTS],
  );
  const filtered = useMemo(
    () => scoped.filter((r) => matchesDirection(r.directionCode)),
    [scoped, matchesDirection],
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
    const coverages = [...byRoad.values()].map((hours) =>
      surveyCoverage(hours),
    );
    // 只要有任何一個調查點是部分時段，就以那一個為準顯示提醒；
    // 全部都是完整 24 小時時，才回報「完整」。
    return (
      coverages.find((coverage) => coverage.partial) ??
      coverages[0] ??
      surveyCoverage([])
    );
  }, [filtered]);
  const surveyScopeNote = useMemo(
    () => coverageNote(surveyScope),
    [surveyScope],
  );
  /**
   * 報告文字草稿開頭那一句調查涵蓋說明。
   *
   * ⚠️ 2026-09-18 大檢查（F-22）：舊版直接用 surveyScopeNote（「本筆非 24 小時調查：
   *   實際只調查 07:00～09:00、17:00～19:00，合計 4 小時」）套在整份草稿上。
   *   範圍內同時有 24 小時路段與 4 小時路口時，這句話後面緊接著列出
   *   「全日實際交通量 31,847 輛」的 24 小時路段，讀者會以為那也是 4 小時的量。
   *   所以逐調查點判斷：全部部分時段 → 沿用原句；混合 → 寫明幾個是部分時段、
   *   幾個是完整 24 小時；全部完整 → 空字串（不寫）。
   */
  const draftCoverageNote = useMemo(() => {
    const byRoad = new Map<string, string[]>();
    for (const record of filtered)
      byRoad.set(record.roadId, [...(byRoad.get(record.roadId) ?? []), record.hour ?? ""]);
    const coverages = [...byRoad.values()].map((hours) => surveyCoverage(hours));
    const partial = coverages.filter((coverage) => coverage.partial);
    if (!partial.length) return "";
    if (partial.length === coverages.length) return surveyScopeNote;
    const blocks = partial[0].blocks
      .map((block) => formatRange(block.start, block.end))
      .join("、");
    const hours = partial[0].coveredMinutes / 60;
    return (
      `本範圍 ${coverages.length} 個調查點中有 ${partial.length} 個為部分時段調查` +
      `（實際只調查 ${blocks}，合計 ${Number.isInteger(hours) ? hours : hours.toFixed(1)} 小時），` +
      `其餘 ${coverages.length - partial.length} 個為完整 24 小時調查。` +
      `部分時段調查點的「全日交通量」是實際調查時段的加總，不是推估的 24 小時全日量，` +
      `不可直接與完整 24 小時調查的數值比較；下面各調查點的數字各自標明了自己的涵蓋。`
    );
  }, [filtered, surveyScopeNote]);
  /*
   * ⚠️ 這一段原本是一個寫死讀 surveyScope（主工具列）的常數。
   *   兩張可追溯明細**可以脫離**，讀主工具列那一份的結果是
   *   「表格列的是部分時段調查的量，卻一個字都沒提」。
   *   已收成 partialNoticeFor(scope)，由呼叫端傳自己那一份涵蓋進來。
   */

  /*
   * ⚠️ v20.74 起這一支收成「吃一批紀錄」的函式，而不是直接讀 `filtered`。
   *
   *   理由：可追溯明細有自己的工具列，可以脫離主工具列；而同一份 roadRows
   *   還餵給 KPI 區與匯出。共用一份的話，在明細表上改條件會連匯出一起改，
   *   那是使用者不會預期的。現在兩邊各算各的，公式只有這一份。
   */
  /**
   * 把紀錄收成「一列一個調查點」的彙總。
   *
   * @param options.splitQuarter 依季別分列（可追溯明細用；預設不分）
   * @param options.dayMode      用哪一個日別條件決定要不要依日別分列。
   *   ⚠️ **預設是主工具列的**，但有自己工具列的區塊一定要把自己那一個傳進來——
   *     不傳的話就是 X-37 那個缺陷：這一塊選「平日＋假日」而主工具列是「平日」時，
   *     兩天被加成一列，而且日別欄還填成主工具列那一個（**標籤在說謊**）。
   */
  const buildRoadRows = useCallback(
    (
      source: TrafficRecord[],
      options?: { splitQuarter?: boolean; dayMode?: string },
    ) => {
    const dayMode = options?.dayMode ?? dayType;
    const splitQuarter = options?.splitQuarter === true;
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
    /*
     * 「平日＋假日」時，同一個調查點的平日與假日各成一列，不相加。
     * 只用 roadId 當鍵就會把兩天併成一列，那正是這次要修掉的事。
     */
    const splitByDay = dayMode === "平日＋假日";
    const keyOf = (r: { roadId: string; dayType?: string; quarter?: string }) =>
      [
        r.roadId,
        splitByDay ? (r.dayType ?? "") : "",
        splitQuarter ? (r.quarter ?? "") : "",
      ].join("||");
    source.forEach((r) => {
      const x = map.get(keyOf(r)) ?? {
        roadId: r.roadId,
        quarter: splitQuarter ? (r.quarter ?? "") : "",
        dayType: splitByDay ? (r.dayType ?? "") : dayMode,
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
        surveyDates: [] as string[],
        hp: new Map(),
        directionMap: new Map(),
      };
      /* 同一列可能由好幾筆紀錄組成（方向 A／B），日期要收集全部再去重。 */
      if (r.surveyDate && !x.surveyDates.includes(r.surveyDate))
        x.surveyDates.push(r.surveyDate);
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
        p = sumPcu(
          r,
          pcuFactors,
          turnPcuFactors,
          vehicleClassSettings,
          pcuScopes,
        ),
        /*
         * 分列之後每個累加器只含一種日別，所以鍵用小時就夠，
         * 尖峰時段的標籤也不會再多出「平日 」這種前綴。
         */
        peakKey = r.hour;
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
      map.set(keyOf(r), x);
    });
    /*
     * 調查點之間的先後仍照流量大小，但排序基準要用「這個調查點的整體量」，
     * 否則平日列與假日列會被拆到表格的不同位置，失去對照的意義。
     * 這只是排序用的中間值，不會出現在畫面或匯出的任何一格。
     */
    const roadOrder = new Map<string, number>();
    for (const x of map.values())
      roadOrder.set(x.roadId, (roadOrder.get(x.roadId) ?? 0) + x.total);
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
        /* 日期照時間排，畫面上才不會出現「5/4、4/28」這種倒著寫的順序。 */
        x.surveyDates.sort();
        const { hp: _hp, directionMap: _directionMap, ...summary } = x;
        return { ...summary, directions };
      })
      .sort((a, b) =>
        splitByDay || splitQuarter
          ? /*
             * 分成好幾列的時候，同一個調查點的各季、各日別要相鄰才好對照；
             * 調查點之間仍照流量由大到小排。
             */
            (roadOrder.get(b.roadId) ?? 0) - (roadOrder.get(a.roadId) ?? 0) ||
            a.roadId.localeCompare(b.roadId) ||
            String(a.quarter).localeCompare(String(b.quarter)) ||
            String(a.dayType).localeCompare(String(b.dayType), "zh-Hant")
          : /* 只看一天時維持原本的排法：流量由大到小 */
            b.total - a.total,
      );
  },
  [
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    dayType,
    displayDirectionName,
    /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
    pcuScopes,
  ]);
  /** 主工具列那一份（KPI 區與匯出讀這一份）。 */
  const roadRows = useMemo(
    () => buildRoadRows(filtered),
    [buildRoadRows, filtered],
  );
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
  /*
   * 結論草稿要用的逐調查點全日量（X-30）。
   *
   * ⚠️ 直接取 roadRows：那一份本來就是「一列一個調查點（＋日別）」，
   *   中間不經過任何彙總。排序與畫面上的小卡一致，讀起來才對得上。
   */
  const draftPointTotals = useMemo(
    () =>
      [...roadRows]
        .sort(
          (a, b) =>
            a.roadName.localeCompare(b.roadName, "zh-Hant") ||
            ["平日", "假日"].indexOf(a.dayType) -
              ["平日", "假日"].indexOf(b.dayType),
        )
        .map((row) => ({
          roadName: row.roadName,
          dayType: row.dayType,
          total: row.total,
          pcu24: row.pcu24,
          /* F-23：逐點的全調查時段尖峰（與可追溯明細「雙向尖峰」同一份數字）。 */
          peakHour: row.peakHour,
          peakPcu: row.peakPcu,
        })),
    [roadRows],
  );
  const dailyTotals = useMemo(() => {
    const byDay = new Map<
      string,
      { dayType: string; total: number; pcu24: number }
    >();
    roadRows.forEach((row) => {
      const current = byDay.get(row.dayType) ?? {
        dayType: row.dayType,
        total: 0,
        pcu24: 0,
      };
      current.total += row.total;
      current.pcu24 += row.pcu24;
      byDay.set(row.dayType, current);
    });
    return [...byDay.values()].sort(
      (a, b) =>
        ["平日", "假日"].indexOf(a.dayType) -
        ["平日", "假日"].indexOf(b.dayType),
    );
  }, [roadRows]);
  /*
   * ── 前兩張卡：季度區間拉開時**逐季分行** ────────────────────────
   *
   * 使用者 2026-09-15：「如果我區間選擇 114Q1~114Q4 區間，那全日實際交通量
   *   和調查時段 PCU 就不能分別顯示 114Q1 數值多少、114Q2 數值多少……
   *   這樣分行顯示每一季的數值嗎? 為什麼只能一筆呢? 有什麼限制在嗎?」
   *   2026-09-15 裁示：「我同意你這項作法」——前兩張逐季分行，
   *   尖峰小時當量交通量維持單季（它底下還掛著逐方向明細與算式，
   *   乘上季數會變成幾十列）。
   *
   * **沒有技術限制**：資料本來就是逐季算好的，只有一筆是當初的版面決定。
   *
   * ⚠️ 每一季都要走**同一支** buildRoadRows，不可以另外寫一份加總——
   *   兩條路徑遲早分岔，而分岔出來的數字沒有任何症狀。
   * ⚠️ 起＝迄（沒有拉開區間）時回傳空陣列，畫面走原本那一條路：
   *   升級當天一個數字都不會變。
   */
  const quarterRange = useMemo(() => {
    const from = mainFilters.quarterFrom;
    const to = mainFilters.quarterTo;
    if (!from || !to || from === to) return [];
    return quarters.filter(
      (q) => compareQuarters(q, from) >= 0 && compareQuarters(q, to) <= 0,
    );
  }, [mainFilters.quarterFrom, mainFilters.quarterTo, quarters]);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-28：前兩張卡的每一行 ＝ 一季 × 一個調查點 × 一個日別，**絕不相加**
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16（附圖）：
   *   「全日實際交通量、24小時PCU、尖峰小時當量交通量，在選擇多項調查點位時，
   *     數值是相加，按照我們之前討論的，相加是錯誤的。」
   *   裁示：「依照你的建議執行　乙案：逐調查點位分行、不加總。」
   *
   * ⚠️ **為什麼相加是錯的**：兩個不同地點的全日交通量相加，數的是同一批車
   *   經過兩個斷面，那個總和不對應任何一條路的實際流量——用「加起來的數字
   *   在真實世界存在嗎」這一題判斷，答案是不存在。
   *
   * ⚠️ 舊版的毛病不只是算錯，是**畫面上一個字都沒說**：篩選列已經寫著
   *   「2 個調查點」，卡片卻只給一個數字、下方只寫「輛／調查日・平日・全部方向」。
   *
   * ⚠️ `buildRoadRows` 產出的一列本來就是「一個調查點（＋日別）」，
   *   所以這裡**直接逐列列出**，不再經過任何一層彙總——
   *   多一層彙總就是多一個會偷偷把不同地點加起來的地方。
   *
   * ⚠️ 單一調查點、單季、單日別時，行數與數值與升級前**逐格相同**
   *   （只有一列，label 是空字串，畫面完全沒變）。
   *
   * ⚠️ 超過上限時**一個合計數字都不給**：給了就等於把錯的數字換個說法留著。
   */
  /*
   * X-46/X-28：調查點超過上限時，小卡預設收起來，但給一顆「展開看全部」。
   *
   * 使用者 2026-09-16：
   *   「我同意這樣修正，只有超過6個才出現這一顆調查點按鈕」
   *
   * ⚠️ 舊版超過上限就**完全不給數字**。那些數字本身是對的
   *  （逐點、沒有相加），只是多——直接不給等於要使用者換個地方看。
   * ⚠️ 展開之後仍然**一個合計都不給**：不同調查點的量相加不成立，
   *   這一條不因為展開而改變。
   */
  const [kpiExpanded, setKpiExpanded] = useState(false);
  const kpiLines = useMemo(() => {
    const multiQuarter = quarterRange.length >= 2;
    const groups = multiQuarter
      ? quarterRange.map((q) => ({
          quarter: q,
          rows: buildRoadRows(
            analysisRecords.filter(
              (r) =>
                r.quarter === q &&
                (dayType === "平日＋假日" || r.dayType === dayType) &&
                matchesRoad(r.roadId) &&
                matchesDirection(r.directionCode) &&
                (r.roadName.includes(search) || r.roadId.includes(search)),
            ),
          ),
        }))
      : [{ quarter: "", rows: roadRows }];
    const pointIds = new Set<string>();
    groups.forEach((group) =>
      group.rows.forEach((row) => pointIds.add(row.roadId)),
    );
    const multiPoint = pointIds.size > 1;
    const splitDay = dayType === "平日＋假日";
    const lines: {
      key: string;
      label: string;
      total: number;
      pcu24: number;
    }[] = [];
    for (const group of groups) {
      const sorted = [...group.rows].sort(
        (a, b) =>
          a.roadName.localeCompare(b.roadName, "zh-Hant") ||
          ["平日", "假日"].indexOf(a.dayType) -
            ["平日", "假日"].indexOf(b.dayType),
      );
      for (const row of sorted) {
        /* 只有「真的分行的那個維度」才寫進標籤，否則單一調查點會憑空多出一行字。 */
        const parts: string[] = [];
        if (multiQuarter) parts.push(showQuarter(group.quarter));
        if (multiPoint) parts.push(row.roadName);
        if (splitDay) parts.push(row.dayType);
        lines.push({
          key: `${group.quarter}|${row.roadId}|${row.dayType}`,
          label: parts.join("・"),
          total: row.total,
          pcu24: row.pcu24,
        });
      }
    }
    return {
      lines,
      multiPoint,
      pointCount: pointIds.size,
      overflow: lines.length > KPI_LINE_LIMIT,
    };
  }, [
    quarterRange,
    buildRoadRows,
    analysisRecords,
    dayType,
    matchesRoad,
    matchesDirection,
    search,
    roadRows,
    showQuarter,
  ]);
  /*
   * ── 尖峰卡：把「算一組尖峰」抽成函式 ────────────────────────────
   *
   * ⚠️ 這裡**不可以**只吃 periodScoped 那一批。
   *
   * 使用者 2026-09-15（附圖）：「主工具列調查時段我選擇上/下午尖峰，
   *   尖峰小時當量交通量都有確實跳出數值來，但我選擇上下午尖峰並列時，
   *   卻只顯示 1 筆數值，沒有 2 筆數值（上下午並列），
   *   也沒看到任何不適用的說明」。
   *
   * 成因：`mainPeriod` 把 "AMPM" 攤成 "am"（見上方），於是 periodScoped
   * 只剩上午那一段，這張卡就只算得出一組——而卡上寫的還是「上午」，
   * 使用者選的是並列。**並列是呈現方式、不是篩選**（三支共同規則），
   * 所以這張卡在並列時要**各算一組**、兩組並排。
   *
   * 抽成函式之後，一組與兩組走的是同一支計算，不會出現「並列那一組
   * 用另一套算法」的分歧。
   */
  const peaksOf = useCallback(
    (rows: typeof periodScoped) => ({
      /*
       * ⚠️ 這裡吃的是**已經依時段切好的那一批**，不是 scoped。
       *   主工具列選「上午尖峰小時」時，尖峰要在**上午那一段裡**挑；
       *   吃 scoped 的話數字完全不會動，工具列就變成只換了標籤。
       */
      combined: peakOf(
        rows,
        pcuFactors,
        turnPcuFactors,
        vehicleClassSettings,
        dayType === "平日＋假日",
        pcuScopes,
      ),
      /*
       * 平日與假日各自的尖峰。與 combined 走同一支計算，
       * 差別只在「取最大的一個」還是「每個日別都留著」。
       */
      byDay: peaksByDayOf(
        rows,
        pcuFactors,
        turnPcuFactors,
        vehicleClassSettings,
        pcuScopes,
      ),
      /*
       * 每一個方向代碼可能同時對應到好幾個調查點：路段的「方向A」與路口的
       *「駛出路口A」都是代碼 A。這裡是把它們同一小時的量相加，得到的是
       *「這個代碼涵蓋的所有調查點在該小時的合計」，不是任何單一調查點的
       * 尖峰。舊版的標籤沒有講這件事，實測 1,490.0 與 1,374.1 兩個調查點
       * 被顯示成一個 2,864.1「方向A」的尖峰，讀者會以為那是一條路的量。
       * 現在把涵蓋幾個調查點一起帶出去，由畫面標示。
       */
      /*
       * ══════════════════════════════════════════════════════════════
       *  各方向的量：一律在**合計那一個視窗**裡取
       * ══════════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-12（附截圖）：「它寫全部方向同一時段，是什麼意思呢?
       * 像我這個路段 假日是17~18點，平日是7~8點 並沒有同一時段」。
       *
       * 查下去發現的是**真的算錯**，不只是文字問題：
       *   方向A 2,792.5（平日 17:00–18:00）
       *   方向B 3,454.0（平日 07:00–08:00）
       *   全部方向同時段合計 6,164.5（平日 07:00–08:00）
       * 2,792.5＋3,454＝6,246.5 ≠ 6,164.5。
       *
       * 成因：舊版讓**每一個方向各自再挑一次自己的尖峰**（peakOf(rows)），
       * 而合計是先把各方向同一小時相加再挑尖峰。兩者不是同一個視窗，
       * 於是三個數字並排、標籤還寫「同時段」，讀的人一定會相加——
       * 而相加得到的是一個現實中不存在的數字。
       *
       * 修法：合計先決定「是哪一個小時」（peaksByDay 現在會回傳 start），
       * 各方向再到**那一個小時**裡取值。這樣各方向加起來必然等於合計。
       *
       * ⚠️ 各方向自己最忙的時段仍然有用（方向A 傍晚最忙是真的），
       *   但那是**另一件事**，要另外標示，不可以放在「同時段」那一列旁邊。
       */
      items: directionOptions.map(([code, name]) => {
        /* ⚠️ 各方向也要同一段時間，否則「各方向相加＝合計」會不成立。 */
        const ownRows = rows.filter((r) => r.directionCode === code);
        return {
          code,
          name,
          roadCount: new Set(ownRows.map((r) => r.roadId)).size,
          /** 這個方向自己最忙的時段（可能和整體尖峰不同一小時）。 */
          ownPeak: peakOf(
            ownRows,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            dayType === "平日＋假日",
            pcuScopes,
          ),
          /** 逐日別：在「該日別整體尖峰的那一個視窗」裡，這個方向有多少。 */
          atPeak: (day: string, startMinutes: number) => {
            const entries = Array.from(
              ownRows
                .filter((r) => !day || r.dayType === day)
                .reduce((map, r) => {
                  map.set(
                    r.hour,
                    (map.get(r.hour) ?? 0) +
                      sumPcu(
                        r,
                        pcuFactors,
                        turnPcuFactors,
                        vehicleClassSettings,
                        pcuScopes,
                      ),
                  );
                  return map;
                }, new Map<string, number>()),
              ([hour, value]) => ({ hour, value }),
            );
            return valueInWindow(entries, startMinutes);
          },
        };
      }),
    }),
    [
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
      dayType,
      directionOptions,
      /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
      pcuScopes,
    ],
  );
  /*
   * ── 這張卡要畫幾組 ────────────────────────────────────────────
   *
   * 「上午＋下午並列」＝**兩組**（上午一組、下午一組），其餘一組。
   *
   * ⚠️ 每一組都要自己在**自己那一段時間裡**挑尖峰，不可以挑一次再切開：
   *   上午的尖峰小時和下午的尖峰小時本來就是兩個不同的小時。
   * ⚠️ 也不可以用「不適用」帶過——並列是使用者明確選的呈現方式，
   *   兩個時段都有資料可以算，不算出來才是漏掉。
   */
  const peakGroups = useMemo(() => {
    const keys: PeriodKey[] =
      periodChoice === "AMPM" ? ["am", "pm"] : [mainPeriod];
    return keys.map((key) => {
      const rows =
        key === "am"
          ? scoped.filter((r) => isMorningHour(r.hour ?? ""))
          : key === "pm"
            ? scoped.filter((r) => isAfternoonHour(r.hour ?? ""))
            : scoped;
      return { key, label: PERIOD_LABELS[key], rows, peaks: peaksOf(rows) };
    });
  }, [periodChoice, mainPeriod, scoped, peaksOf]);
  /*
   * 既有呼叫端（單位、報告草稿、匯出）取**第一組**：
   * 沒有並列時第一組就是唯一那一組，數字與升級前完全相同。
   */
  const directionPeaks = peakGroups[0].peaks;

  /*
   * 尖峰卡片的單位只算一次，抬頭與逐方向共用。
   *
   * 舊版抬頭走 cellUnitFor（會依實際時段長度給「PCU/該時段（45 分鐘）」），
   * 下面逐方向卻寫死「PCU／小時」——尖峰視窗湊不滿或超過 60 分鐘時，
   * 同一張卡片對同一個數字給兩種單位。單位只能有一個來源。
   */
  const peakCardUnit = useMemo(
    () =>
      cellUnitFor("pcu", "am", directionPeaks.combined[0]).replace(
        "PCU/hr",
        "PCU／小時",
      ),
    [directionPeaks],
  );
  /**
   * 「各路段平日與假日比較」的資料，依**傳進來的那一組條件**算。
   *
   * ⚠️ 畫面上那一份走區塊自己的條件（可脫離）；匯出的 Excel 與
   *   它上面那張原生長條圖走主工具列那一份——使用者 2026-09-14 的規則：
   *   「圖可以為了看而脫離，交出去的文件一律吃主工具列」。
   *   兩邊混用的症狀是：圖的標題寫「115年第1季」，每一根長條卻是 114Q4
   *   （2026-09-16 實測）。
   */
  const dayComparisonsFor = useCallback((own: MainFilters) => {
    type DayComparisonAccumulator = Omit<
      DayComparison,
      "weekdayCoverage" | "holidayCoverage" | "coverageComparable"
    > & {
      weekdayHours: Set<string>;
      holidayHours: Set<string>;
    };
    const map = new Map<string, DayComparisonAccumulator>();
    /*
     * ⚠️ v20.74 起這一塊吃**自己那一組條件**（季度區間、調查點、方向）。
     *   日別仍然刻意不套——它本來就要同時拿平日與假日來比。
     */
    const rangeFrom = own.quarterFrom || own.quarterTo;
    const rangeTo = own.quarterTo;
    const singleQuarter = !rangeFrom || !rangeTo || rangeFrom === rangeTo;
    const inRange = (value: string) =>
      singleQuarter
        ? value === rangeTo
        : compareQuarters(value, rangeFrom) >= 0 &&
          compareQuarters(value, rangeTo) <= 0;
    analysisRecords
      .filter(
        (r) =>
          inRange(r.quarter) &&
          (own.roads.length === 0 || own.roads.includes(r.roadId)) &&
          /*
           * ⚠️ 這一行 v20.64 才補上。使用者實測回報：
           *   「各路段平日與假日比較，選車流方向，長條圖不會變」
           * ——面板上印了方向複選（renderBlockFilters 的 direction: true），
           * 這裡卻讀未套方向篩選的 analysisRecords，勾什麼都沒反應。
           * 畫面上給了一個不會生效的控制項，比沒有這個功能更糟：
           * 使用者會以為自己篩過了，然後把那個數字當成單方向的量寫進報告。
           *
           * ⚠️ 兩件不可以順手改掉的事：
           * 1. 這裡**刻意不套 dayType**——它本來就要同時拿平日與假日來比，
           *    套了 dayType 整張圖就廢了。補方向時不要連日別一起加進來。
           * 2. 用的是全站共用的 directions state（空陣列＝全部方向），
           *    不可以另開一份 state。
           */
          (own.directions.length === 0 ||
            own.directions.includes(r.directionCode)) &&
          (r.roadName.includes(search) || r.roadId.includes(search)),
      )
      .forEach((r) => {
        /*
         * ⚠️ 稽核表 C：拉開區間時鍵要帶季別，否則多季被加成同一根柱子。
         *   只看一季時鍵維持原樣（季別是空字串），舊行為逐格不變。
         */
        const key = singleQuarter ? r.roadId : `${r.roadId}||${r.quarter}`;
        const x = map.get(key) ?? {
          roadId: r.roadId,
          roadName: r.roadName,
          quarter: singleQuarter ? "" : r.quarter,
          weekdayActual: 0,
          holidayActual: 0,
          weekdayPcu: 0,
          holidayPcu: 0,
          weekdaySurveyed: false,
          holidaySurveyed: false,
          weekdayHours: new Set<string>(),
          holidayHours: new Set<string>(),
        };
        if (r.dayType === "平日") {
          x.weekdaySurveyed = true;
          x.weekdayHours.add(r.hour);
        } else {
          x.holidaySurveyed = true;
          x.holidayHours.add(r.hour);
        }
        if (r.dayType === "平日") {
          x.weekdayActual += sumVehicles(r);
          x.weekdayPcu += sumPcu(
            r,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            pcuScopes,
          );
        } else {
          x.holidayActual += sumVehicles(r);
          x.holidayPcu += sumPcu(
            r,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            pcuScopes,
          );
        }
        map.set(key, x);
      });
    return [...map.values()]
      .map(({ weekdayHours, holidayHours, ...row }) => {
        const weekdayCoverage = surveyCoverage(weekdayHours);
        const holidayCoverage = surveyCoverage(holidayHours);
        return {
          ...row,
          weekdayCoverage,
          holidayCoverage,
          coverageComparable: sameSurveyCoverage(
            weekdayCoverage,
            holidayCoverage,
          ),
        };
      })
      .sort((a, b) => {
        /*
         * ⚠️ 拆季之後同一條路段會有多列，排序要讓它們**排在一起**，
         *   否則「A路段 115Q1」與「A路段 115Q2」會被別的路段隔開，
         *   使用者根本看不出這是同一條路的兩季。
         *   主鍵改成「這條路段跨季的最大值」，次鍵是季別由小到大；
         *   只看一季時每條路段只有一列，排序結果與舊版逐列相同。
         */
        const peak = (id: string) =>
          Math.max(
            ...[...map.values()]
              .filter((row) => row.roadId === id)
              .map((row) => Math.max(row.weekdayActual, row.holidayActual)),
          );
        const diff = peak(b.roadId) - peak(a.roadId);
        if (diff !== 0) return diff;
        if (a.roadId !== b.roadId) return a.roadId < b.roadId ? -1 : 1;
        return compareQuarters(a.quarter, b.quarter);
      });
  }, [
    analysisRecords,
    search,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
    pcuScopes,
  ]);
  /** 畫面上那一張圖用的（區塊自己的條件，可脫離）。 */
  const dayComparisons = useMemo(
    () => dayComparisonsFor(filtersFor(mainFilters, chartOverrides, CHART_DAY_COMPARE)),
    [dayComparisonsFor, mainFilters, chartOverrides, CHART_DAY_COMPARE],
  );
  /** 匯出的 Excel 與它上面那張原生圖用的（一律主工具列）。 */
  const dayComparisonsMain = useMemo(
    () => dayComparisonsFor(mainFilters),
    [dayComparisonsFor, mainFilters],
  );
  const roadOptions = useMemo(
    () => [...new Map(activeRecords.map((r) => [r.roadId, r.roadName]))],
    [activeRecords],
  );
  /*
   * 匯出檔的下拉選單與 SUMIFS 是用「名稱」對應到輔助列的，
   * 所以兩個調查點同名時會match到兩列、把兩者的量加在一起——
   * 選單裡也會看到兩個一模一樣的選項，分不出是哪一個。
   * 系統不強制名稱唯一（同一條路分段調查時本來就可能同名），
   * 因此這裡只在「真的重複」時補上編號，其餘維持原本的顯示。
   */
  const roadExportLabels = useMemo(() => {
    /*
     * ⚠️ 計數的鍵要用 roadNameMatchKey()，不可以用原始名稱。
     *   名稱有兩種來源：檔名剝出來的（自動）與路段管理改過的（手動），
     *   兩邊只保證去過頭尾空白。「中山 路」與「中山路」在畫面上幾乎看不出
     *   差別，用原字串計數的話兩個各算 1、誰都不補編號——匯出選單裡就出現
     *   兩個分不出來的同名項目，正是這一段本來要防的事。
     */
    const count = new Map<string, number>();
    for (const [, name] of roadOptions) {
      const key = roadNameMatchKey(name);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return new Map(
      roadOptions.map(([roadId, roadName]) => [
        roadId,
        (count.get(roadNameMatchKey(roadName)) ?? 0) > 1
          ? `${roadName}（${roadId}）`
          : roadName,
      ]),
    );
  }, [roadOptions]);
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
          quarters: [...new Set(rows.map((r) => r.quarter))].sort(
            compareQuarters,
          ),
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
  /*
   * ══════════════════════════════════════════════════════════════════
   *  這個路口的原始檔是「往B、往C…」格式嗎？
   * ══════════════════════════════════════════════════════════════════
   *
   * 只影響**要不要檢查轉向判定衝突**，不影響任何計算：
   *   ・往X 格式：目的地逐欄寫明，同一轉向對到多支是正常的（七岔就是），
   *     不可以報衝突，否則整片假紅字。
   *   ・左直右格式：調查員只寫一欄，代表該轉向只有一個去向，
   *     對到 0 支或 2 支以上都是判定失誤。
   *
   * ⚠️ 判準是**欄位格式**，不是路口幾岔——角度特殊的三岔也可能兩支同轉向。
   */
  /*
   * ⚠️ 這裡與下面的衝突偵測都必須讀 **activeRecords（原始匯入的列）**，
   *   不可以讀 analysisRecords：後者在「駛入」視角下已經是**推導後**的結果，
   *   directionCode 換成了終點支線、turnData 也重建過，
   *   拿它去回推「起點支線的左轉量」會得到另一個東西。
   */
  const intersectionHasDestinationColumns = useMemo(() => {
    if (!managedIntersection) return false;
    return activeRecords.some(
      (record) =>
        record.roadId === managedIntersection.roadId &&
        !!record.destinationCounts,
    );
  }, [activeRecords, managedIntersection]);

  const managedArmSettings = useMemo(() => {
    if (!managedIntersection) return [];
    /*
     * 真正存過的設定排在前面：buildArmSettings 用 find() 取第一筆，
     * 所以使用者存過的值一定蓋過反推的預填值，不會被系統覆寫。
     */
    return buildArmSettings(
      activeProject,
      managedIntersection.roadId,
      managedIntersection.directions.map(([directionCode]) => directionCode),
      [...intersectionSettings, ...derivedArmPrefill],
    );
  }, [
    managedIntersection,
    intersectionSettings,
    derivedArmPrefill,
    activeProject,
  ]);
  /**
   * 這個路口**當下的設定**與調查表對不上的轉向。
   *
   * 使用者 2026-09-13：
   *   「調查員不可能在左轉有兩個以上路口時，只有一個左轉欄位帶過，
   *     這事情絕對不可能發生。如果出現程式判讀有 2 支線落進同一個轉向，
   *     **一定是判讀失誤**，可以用醒目顏色提醒，或納入匯入異常事件給使用者看到。」
   *
   * ⚠️ 判斷邏輯不在這裡重寫一套，走 intersection-flow 的 armTurnConflicts()——
   *   匯入提醒走的是同一支，兩處不可能講出不一樣的話。
   *
   * ⚠️ 「往X 格式」的路口整個跳過：那種格式下同一轉向對到多支是正常的
   *   （七岔路口本來就這樣），套上去會整片假紅字。
   */
  const managedTurnConflicts = useMemo(() => {
    if (!managedIntersection || intersectionHasDestinationColumns) return [];
    return armTurnConflicts(
      managedArmSettings,
      activeRecords.filter(
        (record) => record.roadId === managedIntersection.roadId,
      ),
    );
  }, [
    managedArmSettings,
    managedIntersection,
    intersectionHasDestinationColumns,
    activeRecords,
  ]);

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
    /* 勾過的調查點若因為改名、合併或換季而不存在了就剔除，避免畫面莫名變空 */
    const alive = roadFilters.filter((id) =>
      roadOptions.some(([x]) => x === id),
    );
    if (alive.length !== roadFilters.length) setRoadFilters(alive);
    /* 勾過的方向若已不存在（換了流量視角、換季）就剔除 */
    const aliveDirections = directions.filter((code) =>
      directionOptions.some(([x]) => x === code),
    );
    if (aliveDirections.length !== directions.length)
      setDirections(aliveDirections);
  }, [roadOptions, roadFilters, directionOptions, directions]);
  /* ── 趨勢圖的指標、單位、軸名稱與講稿 ───────────────────── */
  const trendMetricDef: TrendMetricDef = trendMetricById(trendMetric);
  /**
   * 可選的**車種類型**清單。
   *
   * 以趨勢圖範圍內實際出現過的類型為準（含使用者自訂的），
   * 不是寫死四大類——調查表可以有電動車、自行車、任何自訂車種。
   *
   * ══ 2026-09-15 修正：這裡原本用的是「原始車種」，那是錯的 ══════════
   *
   * 使用者定義（原話）：「基本 4 個原車種類型，就是機車、小型車、大型車、
   *   特種車，剩下就是看使用者是要把新車種自動歸類成 1 個新類型，
   *   **或是要併入 4 個原車種類型裡**，所以大型車類型就是指原車種類型的
   *   大型車，以及任何把新車種併入到大型車裡面的車種……依此類推。」
   *
   * ⚠️ 舊版這裡用 rawVehicleCounts／rawVehicleLabels（**歸類前**的原始車種），
   *   而「車種組成」那一塊用的是 analysisVehicleCatalog（**歸類後**的類型）。
   *   同一個詞在兩塊是兩個意思，於是：
   *     使用者把「電動機車」併進機車 →
   *       ・車種組成的「機車」＝ 原生機車 ＋ 電動機車
   *       ・歷季趨勢選「機車」  ＝ 只有原生機車
   *     兩塊掛著同一個標籤、給出兩個不同的數字，而畫面上一個字都沒說。
   *   而且下拉裡還會出現「電動機車」——一個使用者已經宣告它不再獨立存在的類型。
   *
   * ⚠️ 需要**原始車種**的地方只有一個：「車種分類與當量管理」那張表
   *   （activeVehicleSourceCatalog）——它要問的正是「每一個原始車種歸到哪裡」。
   *   以及「原始來源追溯」那張 Excel，欄名本來就寫著「原始車種與數量」。
   *   分析用的圖表一律用**歸類後的類型**。
   */
  const trendVehicleOptions = useMemo(() => {
    const found = new Map<string, string>();
    for (const record of analysisRecords) {
      if (!trendMatchesRoad(record.roadId)) continue;
      for (const key of Object.keys(
        effectiveVehicleCounts(record, vehicleClassSettings),
      ))
        if (!found.has(key))
          found.set(
            key,
            effectiveVehicleLabel(record, key, vehicleClassSettings),
          );
    }
    return [...found.entries()];
  }, [analysisRecords, trendMatchesRoad, vehicleClassSettings]);
  const activeTrendVehicle = trendVehicleOptions.some(
    ([key]) => key === trendVehicle,
  )
    ? trendVehicle
    : trendVehicleOptions[0]?.[0] || "";
  const activeTrendVehicleLabel =
    trendVehicleOptions.find(([key]) => key === activeTrendVehicle)?.[1] || "";

  const trendRows = useMemo(
    () =>
      buildTrendRows(
        analysisRecords.filter((r) => trendMatchesRoad(r.roadId)),
        {
          trendMetric,
          trendMode,
          activeTrendVehicle,
          pcuFactors,
          turnPcuFactors,
          vehicleClassSettings,
          pcuScopes,
        },
      ),
    [
    analysisRecords,
    trendMatchesRoad,
    trendMetric,
    trendMode,
    activeTrendVehicle,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
    pcuScopes,
  ]);
  /*
   * 歷季趨勢是跨季度的，一樣不能沿用「目前季度」算出來的單位。
   * 這裡逐季（且逐調查點，理由同 surveyScope）算出各季自己的調查涵蓋，
   * 供匯出的「歷季趨勢」工作表多加一欄標示。
   *
   * 刻意另開一個 memo 而不是塞進 TrendRow：TrendRow 同時餵給畫面上的
   * 折線圖，動它的形狀會牽動到已經確認過的繪圖路徑。
   */
  const trendCoverageByQuarter = useMemo(() => {
    const byQuarter = new Map<string, Map<DayType, Map<string, string[]>>>();
    for (const record of analysisRecords) {
      if (!trendMatchesRoad(record.roadId)) continue;
      if (trendMode === "平日" && record.dayType !== "平日") continue;
      if (trendMode === "假日" && record.dayType !== "假日") continue;
      const byDay =
        byQuarter.get(record.quarter) ??
        new Map<DayType, Map<string, string[]>>();
      const byRoad = byDay.get(record.dayType) ?? new Map<string, string[]>();
      const list = byRoad.get(record.roadId) ?? [];
      list.push(record.hour ?? "");
      byRoad.set(record.roadId, list);
      byDay.set(record.dayType, byRoad);
      byQuarter.set(record.quarter, byDay);
    }
    const summarize = (byRoad?: Map<string, string[]>) => {
      if (!byRoad?.size) return "—";
      const unique = [
        ...new Set(
          [...byRoad.values()].map((hours) =>
            coverageLabelOf(surveyCoverage(hours)),
          ),
        ),
      ];
      return unique.length === 1
        ? unique[0]
        : `不同調查點涵蓋不同（${unique.join("；")}）`;
    };
    /*
     * ⚠️ 被目前日別篩掉的那一邊要寫「未選此日別」，**不可以寫「—」**。
     *
     *   v20.68 把歷季分析的日別收斂成跟著上方共同功能列走（使用者指定），
     *   於是預設「平日」時假日那一欄永遠是空的。原本寫「—」，而「—」在這
     *   整套程式裡一律代表「這一季沒有這種資料」——交出去的 Excel 就變成
     *   「假日調查涵蓋：—」，讀的人會以為根本沒做假日調查，實際上只是
     *   畫面上篩掉了。空白的原因不同，寫法就必須不同。
     *
     *   （e2e-historical-units.mjs 抓到這件事：它原本期待兩邊都有值。）
     */
    const excluded = "未選此日別（目前日別：" + trendMode + "）";
    const labels = new Map<string, { weekday: string; holiday: string }>();
    for (const [q, byDay] of byQuarter) {
      labels.set(q, {
        weekday: trendMode === "假日" ? excluded : summarize(byDay.get("平日")),
        holiday: trendMode === "平日" ? excluded : summarize(byDay.get("假日")),
      });
    }
    return labels;
  }, [analysisRecords, trendMatchesRoad, trendMode]);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  車種組成吃的是**共同功能列**的條件，不是自己一份
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-12：「圓形圖的功能列是自己一套，上面的共同功能列
   * 無法影響到它嗎? ……有些自己的功能列沒有與上面共同功能列同步，
   * 有些則是有同步，那到底是同步比較好，還是各自設定?」
   *
   * 查證結果：四張圖分成兩派——24小時型態與同季平假日是共同功能列的鏡子，
   * 車種組成與歷季分析各有一份自己的 state。**這不是設計，是兩種寫法
   * 混在一起。** 後果是：在上面選了「神農路・方向A」往下捲，
   * 車種組成還在講別的路段，而畫面上沒有任何地方提醒你。
   * 這種錯不會壞掉，只會讓人**看錯圖**。
   *
   * 立的規矩（三支一致）：**上方共同功能列有的條件（季度／日別／路段／
   * 方向），圖表一律跟著它走；圖表只在「上方沒有的條件」上才有自己的
   * 控制項**。所以這裡直接用 filtered——它已經套過季度、日別、路段、
   * 方向與搜尋，和 24小時型態那張圖讀的是同一份。
   */
  /*
   * ⚠️ 車種組成吃**自己那一組條件**（含調查時段——缺口①）。
   *   升級前這裡是 `= filtered`，於是主工具列的「調查時段」對它完全沒有作用。
   */
  /**
   * 車種組成這一塊**目前的時段**（跟著主工具列，或這一塊自己脫離後的值）。
   * "AMPM" 是並列：上午與下午各一個圓環。
   */
  const compositionPeriod = filtersOf(CHART_COMPOSITION).period;
  /**
   * 車種組成用的紀錄：**依時段挑出尖峰那一小時**。
   *
   * ⚠️ 2026-09-18 大檢查（F-15）：舊寫法 `recordsForChart(CHART_COMPOSITION)`
   *   對「上午尖峰小時」給的是**上午所有小時**（00:00～12:00）的紀錄，
   *   圓環算出 11,737 輛並標成「輛／調查日」；同一份資料在「時段車種分析」
   *   的上午尖峰小時是 3,328 輛（07:00～08:00）。「全調查時段尖峰」與
   *   「上午＋下午並列」則完全沒吃、也沒有說明。
   *   2026-09-13 的待修正紀錄早就寫明：「不是把 filtered 改指向 periodScoped
   *   就好——那只是把資料限縮到上午的所有時段，不是尖峰那一小時」。
   *
   * 做法：與「時段車種分析」走**同一支** buildPeriodRows（同一套滾動視窗、
   *   同一套 PCU 判定基準、整個調查點同一時段），取每一個「調查點 × 日別」
   *   合計列（scopeCode "ALL"）在該時段的尖峰視窗，只留視窗內的紀錄。
   *   之後的加總、圓環、說明文字、PNG 全部沿用原本的程式碼，
   *   所以「全調查時段」時與改動前**逐格相同**。
   *
   * 回傳依時段分組：全調查時段／單一尖峰只有一組；並列有上午、下午兩組。
   */
  const compositionPeriodGroups = useMemo(() => {
    const base = recordsForChart(CHART_COMPOSITION);
    const periods: PeriodKey[] =
      compositionPeriod === "AMPM"
        ? ["am", "pm"]
        : [compositionPeriod === "all" ? "all" : (compositionPeriod as PeriodKey)];
    if (periods.length === 1 && periods[0] === "all")
      return [{ period: "all" as PeriodKey, records: base, windows: new Map<string, string>() }];
    const factors = {
      core: pcuFactors,
      coreTurns: turnPcuFactors,
      scopes: pcuScopes,
      settings: vehicleClassSettings,
    };
    /* 依「調查點 × 日別」各自挑尖峰：平日與假日的尖峰小時常常不同。 */
    const groups = new Map<string, TrafficRecord[]>();
    for (const record of base) {
      const key = `${record.roadId}\u0000${record.dayType}`;
      groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    return periods.map((period) => {
      const kept: TrafficRecord[] = [];
      /** 每一個調查點（×日別）實際挑到的尖峰視窗，給說明與抬頭用。 */
      const windows = new Map<string, string>();
      for (const [key, records] of groups) {
        const rows = buildPeriodRows(records, {
          factors,
          separateDays: false,
          peakScope: "point",
          noonAnswers,
        });
        const cell = rows.find((row) => row.scopeCode === "ALL")?.periods[period];
        if (!cell || !cell.hasData) continue;
        const start = startMinutesOf(cell.hour);
        const end = endMinutesOf(cell.hour);
        if (!(start >= 0) || !(end > start)) continue;
        windows.set(key, cell.hour);
        for (const record of records) {
          const s0 = startMinutesOf(record.hour ?? "");
          const e0 = endMinutesOf(record.hour ?? "");
          if (s0 >= start && e0 <= end) kept.push(record);
        }
      }
      return { period, records: kept, windows };
    });
  }, [
    recordsForChart,
    CHART_COMPOSITION,
    compositionPeriod,
    pcuFactors,
    turnPcuFactors,
    pcuScopes,
    vehicleClassSettings,
    noonAnswers,
  ]);
  /** 單一時段（非並列）時，這一塊用的那一批紀錄；並列時是上午那一組（畫面另外逐組畫）。 */
  const compositionRecords = useMemo(
    () =>
      compositionPeriod === "AMPM"
        ? compositionPeriodGroups.flatMap((group) => group.records)
        : compositionPeriodGroups[0]?.records ?? [],
    [compositionPeriodGroups, compositionPeriod],
  );
  /*
   * ⚠️ 24 小時型態吃自己那一組條件。
   *   但**「調查時段」對它不適用**：它的橫軸就是 0～23 時，
   *   篩「上午尖峰小時」只會剩一根柱子——那不是篩選，是把圖毀了。
   *   所以這一塊拿掉時段那一層，改用「把選到的時段在圖上標示出來」
   *   （見圖旁的說明），而時段以外的條件照樣吃。
   */
  const hourlyRecords = useMemo(() => {
    const own = filtersFor(mainFilters, chartOverrides, CHART_HOURLY);
    const withoutPeriod = { ...own, period: "all" as const };
    const source =
      own.flowView === "destination"
        ? recordsByFlowMode.destination
        : recordsByFlowMode.origin;
    const from = withoutPeriod.quarterFrom || withoutPeriod.quarterTo;
    const to = withoutPeriod.quarterTo;
    const single = !from || !to || from === to;
    return source.filter((r) => {
      if (single) {
        if (r.quarter !== to) return false;
      } else if (
        compareQuarters(r.quarter, from) < 0 ||
        compareQuarters(r.quarter, to) > 0
      )
        return false;
      if (withoutPeriod.day !== "平日＋假日" && r.dayType !== withoutPeriod.day)
        return false;
      if (withoutPeriod.roads.length && !withoutPeriod.roads.includes(r.roadId))
        return false;
      if (
        withoutPeriod.directions.length &&
        !withoutPeriod.directions.includes(r.directionCode)
      )
        return false;
      if (!(r.roadName.includes(search) || r.roadId.includes(search)))
        return false;
      return true;
    });
  }, [
    recordsByFlowMode,
    mainFilters,
    chartOverrides,
    search,
    CHART_HOURLY,
  ]);
  /*
   * ══════════════════════════════════════════════════════════════════
   *  X-80：24 小時型態也要**一個調查點一張圖**
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-17：「車種組成，選擇多點的調查點位，已經能分別獨立顯示
   *   每個調查點位的圓環圖。想跟你確認 24 小時型態是否也要每個調查點位
   *   都會有獨立一張 24 小時趨勢圖?還是勾選多個調查點位，加總起來的
   *   24 小時型態趨勢圖有他的意義在?」
   *
   * ⚠️ 加總沒有意義，而且和已經定下來的規則衝突：X-28 已裁示
   *   **不同調查點的交通量不可以相加**（三張摘要卡、結論草稿、歷季趨勢圖
   *   都已改成逐點分列）。這張圖的縱軸是**絕對的交通量**，把兩個調查點加起來
   *   得到的曲線不對應任何一條路的實際流量。
   * ⚠️ 更糟的是**尖峰時刻**：合起來那條線的最高點，不一定是任何一個調查點
   *   自己的尖峰時刻（稽核 E 就是為了這件事才補說明的）。
   *   所以正確做法是拆，不是加、也不是平均。
   */
  const hourlyRoadIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const record of hourlyRecords)
      if (!seen.has(record.roadId)) seen.set(record.roadId, record.roadName);
    return [...seen.entries()];
  }, [hourlyRecords]);
  /** 可追溯明細（路段表）自己那一批。 */
  const traceRecords = useMemo(
    () => recordsForChart(CHART_TRACE),
    [recordsForChart, CHART_TRACE],
  );
  /** 可追溯明細（路口表）自己那一批。 */
  const traceIntersectionRecords = useMemo(
    () => recordsForChart(CHART_TRACE_INTERSECTION),
    [recordsForChart, CHART_TRACE_INTERSECTION],
  );
  /*
   * ⚠️ 可追溯明細的兩張表吃**自己那一組條件**（它有自己的工具列，可以脫離）。
   *   不可以沿用 roadOnlyRows／intersectionOnlyRows——那兩份是 KPI 區與匯出
   *   在用的（主工具列那一份）。共用的話，在明細表上改條件會連匯出一起改，
   *   那是使用者不會預期的。
   */
  /**
   * X-37：可追溯明細的兩張表要**依季別與日別分列**，而且日別讀的是
   * **這一塊自己的**工具列，不是主工具列。
   *
   * ⚠️ 舊版兩件事都錯：分組鍵沒有季度（拉開區間就把多季加成一列），
   *   日別讀主工具列（這一塊選「平日＋假日」而主工具列是「平日」時，
   *   兩天被加成一列，日別欄還填成主工具列那一個）。
   */
  const traceDayMode = filtersOf(CHART_TRACE).day;
  const traceIntersectionDayMode = filtersOf(CHART_TRACE_INTERSECTION).day;
  const traceRows = useMemo(
    () =>
      buildRoadRows(traceRecords, {
        splitQuarter: true,
        dayMode: traceDayMode,
      }),
    [buildRoadRows, traceRecords, traceDayMode],
  );
  const traceRoadRows = useMemo(
    () => traceRows.filter((row) => row.surveyType === "road"),
    [traceRows],
  );
  /*
   * ⚠️ 路口那張表有**自己的**工具列（它多一個「路口流量視角」），
   *   所以它吃的是自己那一批紀錄，不是路段表那一批。
   *   兩張共用一份的話，在路段表上改條件，路口表也跟著脫離——那不是使用者按的。
   */
  /*
   * ── X-15：這張表的表頭要跟著**這一塊自己的**路口流量視角 ────────
   *
   * 使用者 2026-09-16（附三張圖）：「這三張圖，分別是 駛入、駛出、駛入+駛出，
   *   其中表頭都是顯示 "駛出"，另外當駛入+駛出並列時，卻顯示的是駛出的數值，
   *   很明顯是錯誤」。
   *
   * 兩件事各自要修：
   *   ① 表頭原本讀 intersectionFlowLabel，那是**主工具列**那一份。
   *     這一塊可以脫離，脫離成「駛入」時數字真的換了、表頭卻還寫駛出——
   *     看的人會把駛入的數字當成駛出抄進報告。→ 改讀這一塊自己的。
   *   ② 「駛出＋駛入並列」這張表**排不下**（每一支線要再多三欄），
   *     recordsForChart 把它攤成駛出。攤是可以的，但**不可以不說**——
   *     不說就是現在這個症狀：選了並列，數字與駛出逐格相同。
   *     → 下面掛一條「不適用」說明，並且表頭照實寫「駛出」。
   */
  /*
   * ── X-17：視角**只由主工具列決定**，並列時一個調查點出兩列 ──────
   *
   * 使用者 2026-09-16（推翻 X-15 的第 1 點）：
   *   「那是否統一駛入駛出由主工具列決定，這兩張表只控制車輛方向……
   *     並附加一個說明文字，先從主工具列選擇"視角"，再由各表自己的工具列
   *     選擇車流方向」
   *   「當主工具列選擇駛入+駛出時，並沒有出現2筆數值(駛入一筆/駛出一筆)，
   *     如果出現2筆數值，表頭也要正確顯示 是駛入還是駛出」
   *
   * ⚠️ 為什麼這個裁示是對的（寫下來，免得日後有人又改回去）：
   *   「視角」決定的是**整份資料的口徑**（同一批車，以起點算還是以終點算），
   *   本來就該全站一致；「車流方向」才是這一張表要看哪幾支線。
   *   兩者放在同一層，才會出現 2026-09-16 那個症狀：表頭與數值各讀一份條件。
   *
   * ⚠️ 並列時**不可以**只畫一份再把標題改成「並列」——那正是先前的錯。
   *   這裡真的取兩份資料（origin 一份、destination 一份），
   *   每一列自己帶著「視角」欄，看的人一眼知道那一列是哪一種。
   */
  const traceFlowModes: IntersectionFlowMode[] =
    mainFilters.flowView === "both"
      ? ["origin", "destination"]
      : [mainFilters.flowView === "destination" ? "destination" : "origin"];
  const traceIntersectionGroups = useMemo(
    () =>
      traceFlowModes.map((mode) => ({
        mode,
        label: intersectionFlowLabelOf(mode),
        rows: buildRoadRows(recordsForChart(CHART_TRACE_INTERSECTION, mode), {
          splitQuarter: true,
          dayMode: traceIntersectionDayMode,
        }).filter((row) => row.surveyType === "intersection"),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      buildRoadRows,
      recordsForChart,
      CHART_TRACE_INTERSECTION,
      mainFilters.flowView,
      traceIntersectionDayMode,
    ],
  );
  /**
   * 支線欄名上要掛的視角字樣。
   * 單一視角＝「駛出」；並列＝「駛出／駛入」（X-22：照路口轉向那張表的寫法）。
   */
  const traceIntersectionFlowLabel = traceFlowModes
    .map((mode) => intersectionFlowLabelOf(mode))
    .join("／");
  /**
   * X-22（使用者 2026-09-16，指名照抄路口轉向的「各路口駛入／駛出流量」）：
   * **一列還是一個路口**，並列時在**同一格上下兩行**寫「駛出 X／駛入 Y」。
   *
   * ⚠️ 不可以改回「一個路口兩列」：使用者兩種都看過之後指名要這一種——
   *   同一格上下並排才看得出「這一支線進來多少、出去多少」，
   *   分成兩列要上下對照著看。
   */
  const traceIntersectionRows = useMemo(() => {
    const first = traceIntersectionGroups[0]?.rows ?? [];
    const others = traceIntersectionGroups.slice(1);
    return first.map((row) => ({
      row,
      /** 這一列在每一種視角下的那一筆（照 traceFlowModes 的順序）。 */
      perMode: traceIntersectionGroups.map((group) => ({
        label: group.label,
        row:
          group.rows === first
            ? row
            : group.rows.find(
                (other) =>
                  other.roadId === row.roadId &&
                  other.dayType === row.dayType &&
                  /*
                   * ⚠️ X-37 之後這張表**依季分列**，配對一定要帶上季別。
                   *   少了它，駛出／駛入並列時第二種視角會配到**別季**那一筆，
                   *   而同一列的兩行數字看起來都很正常——那是最難發現的錯。
                   */
                  other.quarter === row.quarter,
              ),
      })),
      hasOthers: others.length > 0,
    }));
  }, [traceIntersectionGroups]);
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
  /**
   * 車種組成合計的**主工具列版**——只給匯出的 Excel 與結論草稿用。
   *
   * ⚠️ 不可以拿畫面上那一份（compositionTotals）去填交付物。
   *   畫面那一份走的是車種組成自己的條件（可脫離）；匯出檔上寫的
   *   「篩選條件」與 SUMIFS 公式走的是主工具列。兩邊混用的後果是
   *   **檔案一打開，數字就自己變了**——快取寫的是脫離後的值，
   *   Excel 重算 SUMIFS 得到的是主工具列的值，而收到檔案的人
   *   看到的是重算後那一份，完全不知道發生過什麼。（2026-09-16 實測）
   */
  const compositionExportRows = useMemo(() => {
    /*
     * ⚠️ 2026-09-18 使用者裁示（F-10／F-30）：匯出檔不再提供「平日＋假日」
     *   （兩天相加沒有應用意義；並列＝各自一列）與「全部路段／路口」
     *   （跨調查點相加不對應任何一條路）這兩種合計列。
     */
    const modes: CompositionMode[] = ["平日", "假日"];
    /* 這裡的名稱就是 SUMIFS 的比對鍵，必須與下拉選單用同一組去重後的標籤。 */
    const roads: [string, string][] = [
      ...roadOptions.map(
        ([roadId, roadName]) =>
          [roadId, roadExportLabels.get(roadId) ?? roadName] as [
            string,
            string,
          ],
      ),
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
    roadExportLabels,
    directionOptions,
    vehicleClassSettings,
  ]);
  /*
   * ⚠️ 2026-09-18 使用者裁示（F-10／F-30）：這一份**不再是整批相加**。
   *   跨調查點相加不對應任何一條路；平日＋假日相加沒有應用意義。
   *   匯出檔的「目前車種組成」與可編輯圖表改成**一個調查點 × 一個日別**：
   *   日別＝主工具列（「平日＋假日」時取平日）、調查點＝主工具列只選一個就用它、
   *   否則取範圍內第一個；方向＝主工具列（多選時＝全部方向，同一個斷面內相加是成立的）。
   *   F2～F4 下拉可以在 Excel 裡切換到別的調查點；快取值由同一張明細表查出來，
   *   與 SUMIFS 重算結果一致。結論草稿則逐調查點×日別各寫一句（見 compositionMainGroups）。
   */
  const compositionMainSelection = useMemo(() => {
    const day = dayType === "平日＋假日" ? "平日" : dayType;
    const firstRoadInScope =
      roadOptions.find(([roadId]) => filtered.some((r) => r.roadId === roadId))?.[0] ??
      roadOptions[0]?.[0] ??
      "";
    const roadId = roadFilters.length === 1 ? roadFilters[0] : firstRoadInScope;
    const roadName =
      roadExportLabels.get(roadId) ??
      roadOptions.find(([id]) => id === roadId)?.[1] ??
      roadId;
    const directionName =
      directions.length === 1
        ? (directionOptions.find(([code]) => code === directions[0])?.[1] ?? directions[0])
        : "全部方向";
    return { day, roadId, roadName, directionName };
  }, [dayType, roadOptions, filtered, roadFilters, roadExportLabels, directions, directionOptions]);
  const compositionMainTotals = useMemo(() => {
    const hit = compositionExportRows.find(
      (row) =>
        row.dayType === compositionMainSelection.day &&
        row.roadName === compositionMainSelection.roadName &&
        row.directionName === compositionMainSelection.directionName,
    );
    const vehicles = hit ? { ...hit.vehicles } : ({} as Record<string, number>);
    return {
      vehicles,
      total: Object.values(vehicles).reduce((a, b) => a + b, 0),
    };
  }, [compositionExportRows, compositionMainSelection]);
  /** 結論草稿用：範圍內每一個調查點 × 日別各一組（不相加）。 */
  const compositionMainGroups = useMemo(() => {
    const days = dayType === "平日＋假日" ? ["平日", "假日"] : [dayType];
    const roadIds = roadOptions
      .map(([roadId]) => roadId)
      .filter((roadId) => filtered.some((r) => r.roadId === roadId));
    return roadIds.flatMap((roadId) => {
      const roadName =
        roadExportLabels.get(roadId) ?? roadOptions.find(([id]) => id === roadId)?.[1] ?? roadId;
      return days.flatMap((day) => {
        const hit = compositionExportRows.find(
          (row) =>
            row.dayType === day &&
            row.roadName === roadName &&
            row.directionName === compositionMainSelection.directionName,
        );
        const total = hit ? Object.values(hit.vehicles).reduce((a, b) => a + b, 0) : 0;
        if (!hit || !total) return [];
        return [{ label: `${roadName}・${day}`, vehicles: hit.vehicles, total }];
      });
    });
  }, [dayType, roadOptions, filtered, roadExportLabels, compositionExportRows, compositionMainSelection]);
  const compositionItems = useMemo(
    () =>
      analysisVehicleCatalog.map((vehicle, index) => ({
        ...vehicle,
        count: compositionTotals.vehicles[vehicle.key] ?? 0,
        /* 顏色的唯一來源在 app/vehicle-colors.ts，不可以在這裡另外抄一份。 */
        color: vehicleColor(index),
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
  /*
   * 圖旁邊的解讀說明。
   *
   * ⚠️ 一律**讀畫面上已經算好的那一份資料**（compositionItems、
   * compositionTotals…），不重算一次。文字與圖分岔的時候，被念出來、
   * 被抄進報告的是文字——那比圖畫錯還難發現。
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  歷季趨勢：多個調查點時**一個調查點一條線**，不畫合計
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-16：「我可以單選一個路段，就能看到一路段一張圖了，
   *   目前反而缺少一張圖多條線……(這點三項程式都適用)」。
   *
   * ⚠️ 這不只是「多一種看法」。X-28 已經裁示過同一件事：
   *   **不同調查點的全日交通量相加是錯的**——數的是同一批車經過兩個斷面，
   *   那個總和不對應真實世界任何一條路的流量。三張總結小卡與結論草稿
   *   都已經改成逐點分列，只有這張趨勢圖還在把它們加起來，
   *   而且加完之後畫面上只剩一條線，完全看不出來。
   *
   * 2026-09-19 使用者裁示：所有指標都要逐調查點呈現，包含單一車種佔比
   * 與大車比例。比例必須在每個調查點自己的資料子集內，以分子總和除以
   * 分母總和；不可把各點百分比平均，也不可先跨點合併後只留一個比例。
   */
  const TREND_PER_ROAD_METRICS: TrendMetricId[] = [
    "actual",
    "pcu",
    "vehicleClass",
    "vehicleShare",
    "heavyShare",
    "peakHour",
    "peakHourPcu",
  ];
  /**
   * 歷季趨勢目前實際有資料的調查點（依 roadOptions 的順序，顏色才不會
   * 因為資料多寡而每次換位子）。
   *
   * ⚠️ 用的是 trendMatchesRoad（＝這一塊自己的篩選），不是主工具列的
   *   roadFilters——這一塊脫離主工具列時兩者會不一樣。
   */
  const trendRoadIds = useMemo(() => {
    const present = new Set(
      analysisRecords
        .filter((r) => trendMatchesRoad(r.roadId))
        .map((r) => r.roadId),
    );
    return roadOptions.filter(([id]) => present.has(id)).map(([id]) => id);
  }, [analysisRecords, trendMatchesRoad, roadOptions]);
  const trendPerRoad =
    TREND_PER_ROAD_METRICS.includes(trendMetric) && trendRoadIds.length > 1;
  const trendLines = useMemo<TrendLine[]>(() => {
    if (!trendPerRoad) return [];
    /* 每一條線都釘在同一條 X 軸上——就是畫面上那張圖的季度順序。 */
    const quarters = trendRows.map((row) => row.quarter);
    const bothDays = trendMode === "平日＋假日";
    const built: Array<{ label: string; values: (number | null)[] }> = [];
    for (const id of trendRoadIds) {
      const rows = buildTrendRows(
        analysisRecords.filter((r) => r.roadId === id),
        {
          trendMetric,
          trendMode,
          activeTrendVehicle,
          pcuFactors,
          turnPcuFactors,
          vehicleClassSettings,
          pcuScopes,
          quarters,
        },
      );
      const name = roadOptions.find(([rid]) => rid === id)?.[1] ?? id;
      if (trendMode !== "假日")
        built.push({
          label: bothDays ? `${name}・平日` : name,
          values: rows.map((row) => row.weekday),
        });
      if (trendMode !== "平日")
        built.push({
          label: bothDays ? `${name}・假日` : name,
          values: rows.map((row) => row.holiday),
        });
    }
    /* 整條都沒有值的不列——圖例列一條畫不出來的線只會讓人去圖上找它。 */
    const alive = built.filter((line) =>
      line.values.some((value) => typeof value === "number"),
    );
    /*
     * ⚠️ 超過 8 條時**不自動生成新顏色**：生出來的一定有對比不足、
     *   或兩條幾乎一樣的色，而且 8 條以上本來就已經讀不動了。
     *   那時全部畫成同一個深灰，只靠線尾的名稱分辨，
     *   並在圖上寫一句請使用者縮小範圍（見 paintTrendChart）。
     */
    /* 2026-09-18 使用者裁示：不設上限、不變深灰——顏色循環＋線型分層。 */
    return alive.map((line, index) => ({
      ...line,
      ...lineStyleOf(index),
    }));
  }, [
    trendPerRoad,
    trendRows,
    trendRoadIds,
    analysisRecords,
    roadOptions,
    trendMetric,
    trendMode,
    activeTrendVehicle,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    pcuScopes,
  ]);
  /** 趨勢圖標題與講稿都用這一行，與這一塊自己的篩選同一份。 */
  const trendRoadLabel = (() => {
    /*
     * ⚠️ 讀 trendFilters.roads，不是主工具列的 roadFilters。
     *   這一塊脫離主工具列之後兩者會不一樣，讀錯的症狀是
     *   「圖畫的是 A 調查點、標題寫著 B」——而標題是會被抄進報告的。
     */
    const ids = trendFilters.roads;
    /* ⚠️ 字面沿用改版前（「全部路段」「N 個調查點」），與選單上的字一致。 */
    const base =
      ids.length === 0
        ? "全部路段"
        : ids.length === 1
          ? (roadOptions.find(([id]) => id === ids[0])?.[1] ?? ids[0])
          : `${ids.length} 個調查點`;
    if (ids.length === 1) return base;
    /*
     * 「合計」兩個字只有在真的算了合計時才可以出現。
     * 逐點分列時寫「合計」就是在說謊，而那正是 X-28 那個錯的名字。
     */
    return trendPerRoad ? `${base}（逐點分列，不合計）` : `${base}合計`;
  })();
  /**
   * ══════════════════════════════════════════════════════════════════
   *  「這一塊現在看的是什麼」——一定要用**那一塊自己的**條件算
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ 這一支存在的理由，就是不要再有人用主工具列的 state 去描述一個
   *   **可以脫離**的區塊。那種錯沒有任何症狀：圖畫的是 A，標題寫的是 B，
   *   兩邊各自都很合理，而標題會被抄進報告。
   *   （2026-09-16 實測抓到三處：車種組成的抬頭與草稿標籤、24 小時型態的
   *     說明、兩張圖下載的 PNG 檔名與圖上那行字。）
   *
   * ⚠️ 例外只有一個，而且是使用者定的規則：
   *   「圖可以為了看而脫離，**交出去的文件一律吃主工具列**」——
   *   所以匯出的 Excel 與結論草稿那幾段刻意讀主工具列，
   *   而且**連數字也一起讀主工具列**（只有標籤讀主、數字讀區塊，
   *    就是同一個錯換一邊）。
   */
  const scopeTextOf = useCallback(
    (own: { day: string; roads: string[]; directions: string[] }) => {
      const road =
        own.roads.length === 0
          ? "全部調查點"
          : own.roads.length === 1
            ? (roadOptions.find(([id]) => id === own.roads[0])?.[1] ??
              own.roads[0])
            : `${own.roads.length} 個調查點`;
      const direction =
        own.directions.length === 0
          ? "全部方向"
          : own.directions.length === 1
            ? (directionOptions.find(([code]) => code === own.directions[0])?.[1] ??
              own.directions[0])
            : `${own.directions.length} 個方向`;
      return `${own.day}・${road}・${direction}`;
    },
    [roadOptions, directionOptions],
  );
  /**
   * 車種組成那一塊**畫面上**的範圍說明。
   *
   * ⚠️ 讀的是 CHART_COMPOSITION 自己的條件，不是主工具列。
   *   這一塊掛著 renderBlockFilters({day, road, direction})，也就是它
   *   **可以脫離**；讀主工具列的話，脫離之後抬頭寫的是一組畫面上
   *   根本沒有在看的條件，而圓環上的數字是另一組。
   *   （2026-09-16 實測：主工具列平日、這一塊切假日 → 抬頭仍寫「平日」。
   *     更糟的是結論草稿的「車種組成（依「…」統計）」也是讀這一行。）
   */
  const compositionScopeText = useMemo(
    () => scopeTextOf(filtersOf(CHART_COMPOSITION)),
    [scopeTextOf, filtersOf],
  );
  /**
   * 同一句話，但**照主工具列**算——給匯出的 Excel 與結論草稿用。
   *
   * 使用者 2026-09-14 定的規則：「圖可以為了看而脫離，
   * 交出去的文件一律吃主工具列」。所以交付物那一側連**數字**也要照主工具列，
   * 見 compositionMainTotals。
   */
  const compositionMainScopeText = useMemo(
    () => scopeTextOf({ day: dayType, roads: roadFilters, directions }),
    [scopeTextOf, dayType, roadFilters, directions],
  );
  const compositionChartNote = useMemo(
    () =>
      compositionNote(
        /* ⚠️ key 一定要帶：「大車」是用歸類後的代碼判斷，不是用名稱猜。 */
        compositionItems.map((item) => ({
          key: item.key,
          label: item.label,
          count: item.count,
        })),
        compositionTotals.total,
        /*
         * F-15：挑尖峰那一小時時，說明裡要寫出是哪一個時段、哪一個視窗，
         *   否則「全部 3,328 輛」讀起來像整天只有三千多輛。
         */
        compositionPeriod === "all"
          ? compositionScopeText
          : `${compositionScopeText}・${PERIOD_LABELS[compositionPeriodGroups[0]?.period ?? "all"]}${
              compositionPeriodGroups[0]?.windows.size
                ? ` ${[...compositionPeriodGroups[0].windows.values()][0]}`
                : ""
            }`,
      ),
    [
      compositionItems,
      compositionTotals.total,
      compositionScopeText,
      compositionPeriod,
      compositionPeriodGroups,
    ],
  );
  /*
   * ── 「平日＋假日」畫兩個圓環，不是一個合併的 ──────────────────
   *
   * 使用者 2026-09-10 指名：「車種組成圓環『平＋假日』改成**兩個圓環**」。
   * 這是先前留著待問的那一題（(a) 一個合併／(b) 兩個並排／(c) 兩者都要）
   * 的答案，他選 (b)。
   *
   * ⚠️ **合併的那個數字不是錯的**，所以不要把它當成 bug 修掉。
   * 車種組成看的是**占比**，把兩天的車輛數合起來算比例是有意義的
   *（「這一季調查到的車輛裡機車佔幾成」）——這和 24 小時型態把兩天相加
   * 得到一個不存在的「日交通量」完全不同。改成兩個圓環是因為
   * **並排比較更有用**，不是因為原本算錯。
   * 合併的數字仍然留在匯出檔的「平日＋假日」那幾列，沒有消失。
   *
   * ⚠️ 說明文字一定要跟著拆成兩份。圖上畫兩天、旁邊的文字卻講合併的數字，
   * 就是這個檔案到處在防的「圖與文字分岔」——而被念出來、被抄進報告的是文字。
   */
  /**
   * 車種組成要不要拆成多個圓環，以及怎麼拆。
   *
   * ⚠️ 稽核表 ①（使用者 2026-09-16 裁示，乙案）：
   *   「如果是多路段，則每個路段都分別計算」「勾了 N 個調查點，
   *     要的是那 N 個**各自**的結果」。
   *   舊版只在「平日＋假日」時拆成兩個圓環，調查點那一維從來沒拆過——
   *   多個調查點時圓心那個輛數是把 N 個斷面的車加起來的，
   *   而那個總和不對應真實世界任何一條路（X-28 已裁示過同一件事）。
   *
   * 拆的維度有兩個，各自獨立成立，可以同時發生：
   *   ・日別：這一塊自己的日別選「平日＋假日」時拆成兩組。
   *   ・調查點：範圍內超過一個調查點時，一個調查點一組。
   * 兩者都不成立時回傳 null ＝ 維持單一圓環（舊行為，逐格不變）。
   */
  const compositionRoadIds = useMemo(() => {
    const seen = new Map<string, string>();
    for (const record of compositionRecords)
      if (!seen.has(record.roadId)) seen.set(record.roadId, record.roadName);
    return [...seen.entries()];
  }, [compositionRecords]);
  const compositionByDay = useMemo(() => {
    /*
     * ⚠️ 2026-09-16 使用者回報：「我僅篩選平日，圖卻顯示 平日＋假日同時出現」。
     *
     *   成因：這裡讀的是 **dayType（主工具列那一份）**，而這一塊自己可以脫離
     *   （renderBlockFilters 的日別）。在這一塊把日別改成「平日」之後，
     *   compositionRecords 確實只剩平日，但這一行仍然看主工具列＝平日＋假日，
     *   於是照樣畫兩個圓環——假日那一個是空的。
     *   **畫面說的和實際篩的不一樣**，屬於篩選錯誤那一類。
     *
     * ⚠️ 一律改讀**這一塊自己的**條件。凡是「要不要拆成兩份」這種問題，
     *   依據都必須和資料來源（compositionRecords）同一份條件，不可以各讀各的。
     */
    const splitDay = filtersOf(CHART_COMPOSITION).day === "平日＋假日";
    const splitRoad = compositionRoadIds.length > 1;
    /*
     * F-15：時段「上午＋下午並列」＝一個調查點兩個圓環（上午尖峰、下午尖峰），
     *   與平日＋假日並列同一種畫法。時段在最外層，日別其次，調查點最內層。
     */
    const splitPeriod = compositionPeriod === "AMPM";
    if (!splitDay && !splitRoad && !splitPeriod) return null;
    const days: string[] = splitDay ? ["平日", "假日"] : [""];
    const roads: [string, string][] = splitRoad
      ? compositionRoadIds
      : [["", ""]];
    return compositionPeriodGroups.flatMap((group) =>
      days.flatMap((day) =>
      roads.map(([roadId, roadName]) => {
      const records = group.records.filter(
        (r) => (!day || r.dayType === day) && (!roadId || r.roadId === roadId),
      );
      /* 這一組挑到的尖峰視窗（一個調查點×日別一個）。 */
      const windowLabel = (() => {
        if (group.period === "all") return "";
        const hit = [...group.windows.entries()].find(([key]) => {
          const [rid, dt] = key.split("\u0000");
          return (!roadId || rid === roadId) && (!day || dt === day) &&
            (roadId || records.some((r) => r.roadId === rid));
        });
        return hit ? `${PERIOD_LABELS[group.period]} ${hit[1]}` : `${PERIOD_LABELS[group.period]}（這一組沒有算得出來的尖峰）`;
      })();
      const totals = records.reduce(
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
      );
      const items = compositionItems.map((item) => ({
        ...item,
        count: totals.vehicles[item.key] ?? 0,
      }));
      let start = 0;
      const gradient = totals.total
        ? `conic-gradient(${items
            .map((item) => {
              const end = start + (item.count / totals.total) * 100;
              const segment = `${item.color} ${start}% ${end}%`;
              start = end;
              return segment;
            })
            .join(",")})`
        : "#D8E7F1";
      const periodTag = splitPeriod ? PERIOD_LABELS[group.period] : "";
      return {
        /** 這一組的識別字（PNG 檔名、React key、打包清單都用它）。 */
        key: [periodTag, day, roadName].filter(Boolean).join("｜") || "全部",
        /** 畫面上那一行抬頭。 */
        label:
          [day, roadName].filter(Boolean).join("・") +
          (windowLabel ? `${day || roadName ? "・" : ""}${windowLabel}` : "") || "全部",
        day,
        roadId,
        roadName,
        period: group.period,
        windowLabel,
        totals,
        items,
        gradient,
        /*
         * ⚠️ 2026-09-18 使用者裁示（F-27）：單位**逐點依各自的調查涵蓋**標——
         *   全調查時段：這一組是完整 24 小時→「輛／調查日」、部分時段→「輛／調查時段」；
         *   尖峰那一小時→「輛／小時」。原本整批看 partialScope，範圍內只要有一個
         *   部分時段調查點，五條完整 24 小時路段也被標成「輛／調查時段」。
         *   ⚠️ 只有選了單一調查點的圓環才逐點判斷；roadId 為空（多點合成一組）時
         *   沿用整批判斷，因為那一組本來就混了不同涵蓋。
         */
        unit:
          group.period !== "all"
            ? "輛／小時"
            : roadId
              ? surveyCoverage(records.map((r) => r.hour ?? "")).partial
                ? "輛／調查時段"
                : "輛／調查日"
              : surveyScope.partial
                ? "輛／調查時段"
                : "輛／調查日",
      };
      }),
      ),
    );
  }, [
    filtersOf,
    CHART_COMPOSITION,
    compositionPeriodGroups,
    compositionPeriod,
    compositionRoadIds,
    vehicleClassSettings,
    compositionItems,
    surveyScope.partial,
  ]);
  /*
   * 兩個圓環的說明文字：**逐日各算一份**，用的就是上面那一份 per-day 資料。
   * 這樣文字裡的每一個數字都是那一個圓環畫得出來的。
   */
  const compositionDayNotes = useMemo(() => {
    if (!compositionByDay) return null;
    return compositionByDay.map((entry) =>
      compositionNote(
        entry.items.map((item) => ({
          key: item.key,
          label: item.label,
          count: item.count,
        })),
        entry.totals.total,
        /*
         * ⚠️ 拆到哪一維，範圍字串就要把那一維換掉。
         *   直接把 entry.label 接在原本的範圍前面，會寫出
         *   「中山路・全部調查點・全部方向」這種自相矛盾的句子——
         *   這一組明明只有一個調查點，字面上卻寫著「全部調查點」。
         */
        [
          entry.day,
          entry.roadId ? entry.roadName : null,
          ...compositionScopeText
            .split("・")
            .slice(1)
            .filter((part, index) => !(entry.roadId && index === 0)),
          /* F-15：挑尖峰那一小時時，把時段與視窗也寫進範圍。 */
          entry.windowLabel || null,
        ]
          .filter(Boolean)
          .join("・"),
      ),
    );
  }, [compositionByDay, compositionScopeText]);
  /*
   * 每小時趨勢的資料列。
   * 歷季各表是「跨季度」的：一列一個（季度×日別×調查點）。
   *
   * 但單位標題（sheetActualUnit／pcu24Label／trendActualUnit）都是從
   * surveyScope 算出來的，而 surveyScope 只看目前選的那一季。於是一張混排
   * 多季的表，會被整張標成當季的單位——目前選 24 小時季時，只調查 4 小時的
   * 那一季會被標成「全日實際交通量（輛/日）」並排在真正的全日量旁邊；
   * 反過來選部分時段季時，真正的 24 小時資料會被標成「輛/調查時段」。
   *
   * 因此歷季各表改為：標題用不含時間範圍的中性單位（輛／PCU），
   * 每一列另外附上它自己的「調查涵蓋」，讓每一季的性質看得出來。
   * 涵蓋範圍必須逐（季度×日別×調查點）判斷，理由同 surveyScope 的註解：
   * 把不同調查點的時段混在一起算，只要有一個 24 小時的就會蓋掉其他的。
   */
  const historicalDailyRows = useMemo(() => {
    const map = new Map<
      string,
      {
        quarter: string;
        dayType: DayType;
        roadId: string;
        roadName: string;
        hours: string[];
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
        hours: [] as string[],
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
        p = sumPcu(
          r,
          pcuFactors,
          turnPcuFactors,
          vehicleClassSettings,
          pcuScopes,
        );
      if (r.surveyType === "intersection" || r.turnData)
        x.isIntersection = true;
      x.hours.push(r.hour ?? "");
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
    return [...map.values()]
      .map(({ hours, ...row }) => {
        const coverage = surveyCoverage(hours);
        return {
          ...row,
          coverage,
          /* 這一列自己的調查涵蓋，供歷季各表逐列標示，不受目前季度影響。 */
          coverageLabel: coverageLabelOf(coverage),
        };
      })
      .sort(
        (a, b) =>
          compareQuarters(a.quarter, b.quarter) ||
          a.roadId.localeCompare(b.roadId) ||
          a.dayType.localeCompare(b.dayType),
      );
    /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
  }, [
    analysisRecords,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    pcuScopes,
  ]);
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
        roadId: string;
        roadName: string;
        dayType: "平日" | "假日";
        vehicles: Record<string, number>;
        total: number;
      }
    >();
    analysisRecords
      /* 與車種組成面板同一組條件（共同功能列），不再自己一份。 */
      .filter(
        (r) =>
          (dayType === "平日＋假日" || r.dayType === dayType) &&
          matchesRoad(r.roadId),
      )
      .forEach((r) => {
        const key = `${r.quarter}\u0000${r.roadId}\u0000${r.dayType}`;
        const x = map.get(key) ?? {
          quarter: r.quarter,
          roadId: r.roadId,
          roadName: r.roadName,
          dayType: r.dayType,
          vehicles: {} as Record<string, number>,
          total: 0,
        };
        Object.entries(effectiveVehicleCounts(r, vehicleClassSettings)).forEach(
          ([vehicle, count]) => {
            x.vehicles[vehicle] = (x.vehicles[vehicle] ?? 0) + count;
          },
        );
        x.total += sumVehicles(r);
        map.set(key, x);
      });
    return [...map.values()]
      .sort(
        (a, b) =>
          compareQuarters(a.quarter, b.quarter) ||
          a.roadId.localeCompare(b.roadId, "zh-Hant") ||
          a.dayType.localeCompare(b.dayType, "zh-Hant"),
      )
      .map((r) => ({
        quarter: r.quarter,
        roadId: r.roadId,
        roadName: r.roadName,
        dayType: r.dayType,
        vehicles: Object.fromEntries(
          analysisVehicleCatalog.map((vehicle) => [
            vehicle.key,
            r.total ? (r.vehicles[vehicle.key] ?? 0) / r.total : 0,
          ]),
        ),
      }));
  }, [
    analysisRecords,
    dayType,
    matchesRoad,
    vehicleClassSettings,
    analysisVehicleCatalog,
  ]);

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
  /*
   * ⚠️ 稽核表 G：跨調查點不相加。
   *
   * 舊版把篩選範圍內的**全部調查點**同一小時相加寫成一格，
   * 而表頭沒有調查點欄，收到這份 Excel 的人根本看不出那是幾個點的合計。
   * 使用者 2026-09-16 已裁示：不同調查點的交通量不可以相加，一律逐點分列。
   * 所以改成：一列＝一個（調查點 × 日別 × 小時），並補上調查點欄。
   * 只有一個調查點時輸出與舊版**逐格相同**（那一欄寫它自己的名字）。
   */
  const hourlyExportPoints = useMemo(() => {
    const seen = new Map<string, string>();
    for (const record of filtered)
      if (!seen.has(record.roadId)) seen.set(record.roadId, record.roadName);
    return seen.size ? [...seen.entries()] : [["", ""] as [string, string]];
  }, [filtered]);
  const hourlyExportRows = useMemo(
    () =>
      hourlyExportPoints.flatMap(([pointId, pointName]) =>
      hourlyExportDayTypes.flatMap((exportDay) =>
        Array.from({ length: 24 }, (_, hour) => {
          const rows = filtered.filter(
            (r) =>
              hourStartOf(r.hour) === hour &&
              (!pointId || r.roadId === pointId) &&
              (!exportDay || r.dayType === exportDay),
          );
          // 部分時段調查（例如只做 07-09、17-19）沒有調查到的小時要留空，
          // 不能寫 0——寫 0 的話折線圖會被拉到底，看起來像「白天完全沒有車」。
          // 圖表已指定 dispBlanksAs="gap"，留空就會自動斷線。
          const surveyed = rows.length > 0;
          const label = `${String(hour).padStart(2, "0")}:00～${String((hour + 1) % 24).padStart(2, "0")}:00`;
          return {
            /* 調查點名稱自己一欄（稽核表 G）。 */
            point: pointName || pointId,
            // 兩種日別都在時，時段標籤要帶日別，否則同一張表會出現兩個
            // 「18:00～19:00」而看不出誰是誰。只有一種日別時維持原樣。
            hour:
              hourlyExportDayTypes.length > 1 && exportDay
                ? `${exportDay} ${label}`
                : label,
            actual: surveyed
              ? rows.reduce((s, r) => s + sumVehicles(r), 0)
              : null,
            pcu: surveyed
              ? rows.reduce(
                  (s, r) =>
                    s +
                    sumPcu(
                      r,
                      pcuFactors,
                      turnPcuFactors,
                      vehicleClassSettings,
                      pcuScopes,
                    ),
                  0,
                )
              : null,
          };
        }),
      ),
      ),
    [
      hourlyExportPoints,
      hourlyExportDayTypes,
      filtered,
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
      /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
      pcuScopes,
    ],
  );
  /*
   * 時段車種分析：完全獨立於上面既有的表單與圖表，自己一個區塊。
   * 沿用目前的季度／日別／調查點／搜尋條件，但「不吃」上面的車流方向下拉選單——
   * 這一區本來就會把每個方向（路段的方向A／方向B、路口的駛入/駛出各支線）各列一列。
   */
  const computePeriodRows = useCallback(
    (
      peakScope: PeakScope,
      flowView: "follow" | IntersectionFlowMode | "both",
      /*
       * ⚠️ 用哪一組季度／日別／調查點來篩。
       *
       *   畫面上的那一張表傳 periodFilters（＝這一區自己的條件，可以脫離）；
       *   **匯出與報告草稿一律傳 mainFilters**。
       *
       *   為什麼要分開：一份草稿裡同時有「全日實際交通量合計」與
       *   「時段車種分析合計」，前者讀主工具列、後者若讀脫離後的區塊條件，
       *   同一份文件裡的兩個數字就會是**兩個不同季度**的
       *  （2026-09-14 實測：63,195 vs 115,873）。圖可以為了看而脫離，
       *   交出去的文件不行——這也正是使用者裁示「結論草稿與成果交付維持獨立」
       *   的同一個道理。
       */
      filters: MainFilters,
    ): PeriodRow[] => {
      const factors = {
        core: pcuFactors,
        coreTurns: turnPcuFactors,
        /* ⚠️ 沒有覆寫時是空陣列，時段分析與改版前逐格相同。 */
        scopes: pcuScopes,
        settings: vehicleClassSettings,
      };
      const modes: IntersectionFlowMode[] =
        flowView === "both"
          ? ["origin", "destination"]
          : [flowView === "follow" ? intersectionFlowMode : flowView];
      // 與 scoped 相同的篩選條件，但要在「這一區自己的視角」下重算，
      // 所以不能直接用 scoped（它已經套上工具列的視角了）。
      /*
       * ⚠️ v20.74 起由呼叫端指定要吃哪一組條件（見上面 filters 的說明）：
       *   畫面上的表吃這一區自己的（可以脫離），匯出與草稿吃主工具列的。
       *   沒脫離時兩者相同，篩出來的與升級前一樣。
       */
      const inScope = (r: TrafficRecord) =>
        r.quarter === filters.quarterTo &&
        (filters.day === "平日＋假日" || r.dayType === filters.day) &&
        (filters.roads.length === 0 || filters.roads.includes(r.roadId)) &&
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
          separateDays: filters.day === "平日＋假日",
          scopeNameFor: (record) =>
            displayDirectionNameFor(record as unknown as TrafficRecord, mode),
          peakScope,
          noonAnswers,
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
    },
    /*
     * ⚠️ 這裡原本有一行 `// eslint-disable-next-line react-hooks/exhaustive-deps`，
     *   它壓住的其實是一個**真的 bug**：
     *
     *   這支 callback 讀了 `pcuScopes`（係數的「季別 × 路段」覆寫），
     *   但相依陣列裡沒有它。後果是：使用者在係數分頁按下「套用」之後，
     *   「時段車種分析」那張表、它匯出的 Excel、以及讀同一份列的結論草稿
     *   **通通不會重算**——數字停在舊值，而且沒有任何錯誤訊息。
     *   （2026-09-11 我為了這件事一口氣補了 9 個 useMemo 的相依，
     *     唯獨這一個因為有 disable 而查不出來：eslint 根本沒吭聲。）
     *
     *   兩個缺的相依都可以安全補上，所以 disable 整行拿掉，不要留著：
     *   ・`pcuScopes` 是 state
     *   ・`displayDirectionNameFor` 是 useCallback（參考穩定，不會每次重算）
     *
     *   ⚠️ 留下 disable 而只補其中一個是最糟的做法——下一個缺的相依
     *     又會被同一行壓住，而且下一次還是查不出來。
     */
    [
      activeRecords,
      search,
      pcuFactors,
      turnPcuFactors,
      pcuScopes,
      vehicleClassSettings,
      intersectionSettings,
      intersectionFlowMode,
      displayDirectionNameFor,
      activeProject,
      /* ⚠️ 使用者對「橫跨中午的尖峰」的決定改變時，這一整批列必須重算。 */
      noonAnswers,
    ],
  );
  /*
   * ⚠️ 尖峰時段認定吃**這一區自己的**那一份（periodFilters.peakScope）。
   *   它已經升到主工具列，所以沒脫離時就是主工具列的值——
   *   這正是使用者要的「主工具列一改，這一區跟著換」。
   */
  const periodRows = useMemo(
    () =>
      computePeriodRows(periodFilters.peakScope, periodFlowView, periodFilters),
    [computePeriodRows, periodFlowView, periodFilters],
  );
  /*
   * 目前這一區的結果裡，有沒有「路口格式」的調查點。
   *
   * 「駛出／駛入」只對路口有意義（車從哪條支線進、從哪條支線出）；
   * 路段只有方向A／方向B，換視角算出來一模一樣——這是正確行為，
   * computePeriodRows() 也刻意把並列時重複的路段列濾掉了。
   *
   * 但畫面上沒有講這件事：使用者把篩選縮到只剩一條路段時，
   * 三種視角切下去數字都不動，看起來就像篩選壞掉。實際回報過。
   * 匯出中心那邊本來就有一行說明，這一區卻沒有，兩邊不一致。
   */
  const periodHasIntersection = useMemo(
    () => periodRows.some((row) => row.surveyType === "intersection"),
    [periodRows],
  );
  /**
   * 匯出用的列：匯出中心可以指定自己的「尖峰時段認定」與「路口流量視角」，
   * 選 follow 才沿用畫面上目前的設定。這樣存成範本之後，匯出結果不會因為
   * 有人在畫面上改過而跟著變。
   */
  /** 匯出中心實際採用的路口流量視角文字（並列時每一列自己帶，這裡給非並列用） */
  const periodExportFlowLabel = useMemo(() => {
    /*
     * ⚠️ 「follow」＝跟著**主工具列**，不是跟著這一區。
     *   這一區可以為了看而脫離，但匯出的是一份文件——同一份裡的
     *   「全日實際交通量合計」讀主工具列、這一段若讀脫離後的區塊，
     *   兩個數字會來自兩組不同的條件（2026-09-14 已經在季度上發生過一次）。
     *   底下 periodExportRows 的 peakScope 本來就是這樣寫的，
     *   flowView 這一條之前漏了，一併對齊。
     */
    const choice =
      periodExport.flowView === "follow"
        ? mainFilters.flowView
        : periodExport.flowView;
    return choice === "both" ? "駛出／駛入" : intersectionFlowLabelOf(choice);
  }, [periodExport.flowView, mainFilters.flowView]);
  const periodExportRows = useMemo(
    () =>
      computePeriodRows(
        /*
         * ⚠️ 「follow」＝跟著**主工具列**，不是跟著時段車種分析那一塊。
         *
         *   那一塊可以脫離（使用者為了看某一季而改它自己的條件），
         *   但匯出的是一份文件：同一份裡的「全日實際交通量合計」讀主工具列、
         *   「時段車種分析合計」若讀脫離後的區塊，兩個數字會是兩個不同季度的
         *  （2026-09-14 實測 63,195 vs 115,873，由 e2e-report-draft 抓到）。
         *   要匯出別的條件，請用匯出中心自己的選項，或在主工具列上改。
         */
        periodExport.peakScope === "follow"
          ? mainFilters.peakScope
          : periodExport.peakScope,
        periodExport.flowView === "follow"
          ? mainFilters.flowView
          : periodExport.flowView,
        mainFilters,
      ),
    [
      computePeriodRows,
      periodExport.peakScope,
      periodExport.flowView,
      mainFilters,
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
      /* ⚠️ 沒有覆寫時是空陣列，時段分析與改版前逐格相同。 */
      scopes: pcuScopes,
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
    const passes: {
      mode: IntersectionFlowMode;
      records: typeof activeRecords;
    }[] = [{ mode: "origin", records: activeRecords }];
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
            /*
             * 尖峰時段認定。
             *
             * ⚠️ 舊版寫死吃主工具列，而這一頁的說明卻寫著「不受主工具列條件影響」——
             *   改一次主工具列的判定方式，草稿裡每一個尖峰數字都會跟著換，
             *   使用者完全不會知道。現在它是這一頁自己的條件：
             *   預設 "follow" ＝跟著主工具列（升級當天一個數字都不變），
             *   也可以自己指定，而且草稿會把採用的判定方式寫出來。
             */
            peakScope:
              conclusionCondition.peakScope && conclusionCondition.peakScope !== "follow"
                ? conclusionCondition.peakScope
                : mainFilters.peakScope,
            noonAnswers,
          });
          for (const row of rows) {
            const periods: ConclusionRow["periods"] = {};
            for (const key of PERIOD_KEYS) {
              const source = row.periods[key];
              if (!source) continue;
              const labels = new Map<string, { count: number; pcu: number }>();
              for (const [vehicleKey, count] of Object.entries(
                source.vehicles,
              )) {
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
    mainFilters.peakScope,
    /*
     * ⚠️ 這一項也要列進相依：判定方式一改，這一批列就要重算。
     *   少了它，畫面上選了「各方向各自認定」而數字停在上一種——
     *   而那份文字會被複製進正式報告。
     */
    conclusionCondition.peakScope,
    displayDirectionNameFor,
    /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
    pcuScopes,
    /* ⚠️ 同理：橫跨中午的決定改變時，結論草稿讀的這批列也要重算。 */
    noonAnswers,
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
          !periodScopeFilter.length ||
          periodScopeFilter.includes(row.scopeCode),
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
  };
  /*
   * 「管理計畫」視窗正在處理的那一個計畫。
   *
   * ⚠️ 視窗裡的抬頭與「刪除整個計畫」都要用它，**不可以用 selectedProject**。
   *   2026-09-11 起「我的計畫」每一列都能開這個視窗，要改的不一定是目前這一個；
   *   抬頭寫錯只是誤導，刪除鈕若還是刪「目前這一個」，就是按了「修改 A」
   *   結果刪掉 B——而且不可逆。
   */
  const managedProject =
    projects.find((p) => p.id === managedProjectId) ?? selectedProject;
  const maxDay = Math.max(
    1,
    ...dayComparisons.flatMap((r) =>
      dayMetric === "actual"
        ? [r.weekdayActual, r.holidayActual]
        : [r.weekdayPcu, r.holidayPcu],
    ),
  );
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
  /*
   * 「平日＋假日」不再相加，改成每個調查點出兩列（見 RoadSummary.dayType），
   * 所以每一格都是**單日**的量，單位就跟只看一天的時候一樣。
   */
  /* 只有「平日＋假日」才需要多一欄告訴使用者這一列是哪一天 */
  /*
   * ⚠️ 這裡原本有一個共用的 `showDayColumn = dayType === "平日＋假日"`，
   *   兩張可追溯明細都讀它——那正是 X-37 的缺陷之一（讀的是主工具列）。
   *   改成兩張表各自一個之後它就沒人用了，**直接移除**：
   *   留著沒人用的旗標，下一個人很容易又拿它去掛新的欄位。
   */
  /*
   * X-37：可追溯明細的兩張表**各自**判斷要不要顯示日別欄與季別欄，
   * 依據是**那一塊自己的**條件，不是主工具列。
   *
   * ⚠️ 舊版兩張表都用上面那個 showDayColumn（主工具列），所以
   *   這一塊選「平日＋假日」而主工具列是「平日」時，日別欄根本不出現，
   *   兩天被加成一列也看不出來。
   * ⚠️ 季別欄只在**真的拉開區間**時出現：沒拉開時每一列都是同一季，
   *   多一欄一模一樣的值是噪音。
   */
  const traceShowDay = traceDayMode === "平日＋假日";
  const traceShowQuarter =
    new Set(traceRows.map((row) => row.quarter).filter(Boolean)).size > 1;
  const traceIntersectionShowDay = traceIntersectionDayMode === "平日＋假日";
  const traceIntersectionShowQuarter =
    new Set(
      traceIntersectionGroups
        .flatMap((group) => group.rows)
        .map((row) => row.quarter)
        .filter(Boolean),
    ).size > 1;
  const dailyActualUnit = partialScope ? "輛／調查時段" : "輛／調查日";
  /** 車種組成單一圓環的單位：挑尖峰那一小時時是「輛／小時」（F-15）。 */
  const compositionUnit =
    compositionPeriod === "all" ? dailyActualUnit : "輛／小時";
  const dailyPcuUnit = partialScope ? "PCU／調查時段" : "PCU／日";
  /**
   * 某一份紀錄的調查涵蓋（整天還是部分時段）。
   *
   * ⚠️ 兩張「可追溯明細」吃的是**自己那一塊**的條件（可脫離），
   *   所以它們的欄位單位與「部分時段」那一段提醒也必須照自己那一份算。
   *   讀主工具列那一份（surveyScope）的症狀是：主工具列停在一個做滿 24 小時
   *   的調查點，表格脫離到另一個只做 07-09／17-19 的調查點，
   *   欄位卻仍寫著「輛／調查日」，而且那一段「本季資料為部分時段調查」
   *   完全不會出現——部分時段的量會被當成全日量讀走。（2026-09-16 實測）
   */
  const coverageOfRecords = useCallback((records: TrafficRecord[]) => {
    const byRoad = new Map<string, string[]>();
    for (const record of records) {
      const list = byRoad.get(record.roadId) ?? [];
      list.push(record.hour ?? "");
      byRoad.set(record.roadId, list);
    }
    const coverages = [...byRoad.values()].map((hours) =>
      surveyCoverage(hours),
    );
    /* 判準與 surveyScope 完全相同：有任何一個是部分時段就以它為準。 */
    return (
      coverages.find((coverage) => coverage.partial) ??
      coverages[0] ??
      surveyCoverage([])
    );
  }, []);
  /*
   * ⚠️ 2026-09-18 大檢查（F-28）：路段那張表的涵蓋判斷只看**路段格式**的紀錄，
   *   路口那張只看**路口格式**。同一季同時有 24 小時路段檔與 4 小時路口檔時，
   *   舊寫法把兩種混在一起判斷，路段表上方會掛「本季資料為部分時段調查
   *   （實際只調查 07:00～09:00、17:00～19:00）」、表頭也退成「調查時段合計」，
   *   而那張表裡每一列都是完整 24 小時——說明講的是另一張表的事。
   */
  const traceScope = useMemo(
    () =>
      coverageOfRecords(
        traceRecords.filter(
          (record) => record.surveyType !== "intersection" && !record.turnData,
        ),
      ),
    [coverageOfRecords, traceRecords],
  );
  const traceIntersectionScope = useMemo(
    () =>
      coverageOfRecords(
        traceIntersectionRecords.filter(
          (record) => record.surveyType === "intersection" || !!record.turnData,
        ),
      ),
    [coverageOfRecords, traceIntersectionRecords],
  );
  const traceUnits = {
    actual: traceScope.partial ? "輛／調查時段" : "輛／調查日",
    pcu: traceScope.partial ? "PCU／調查時段" : "PCU／日",
  };
  const traceIntersectionUnits = {
    actual: traceIntersectionScope.partial ? "輛／調查時段" : "輛／調查日",
    pcu: traceIntersectionScope.partial ? "PCU／調查時段" : "PCU／日",
  };
  const partialNoticeFor = (scope: SurveyCoverage) =>
    scope.partial ? (
      <div className="partial-day-note">
        <b>本季資料為部分時段調查（非 24 小時）</b>
        <p>{coverageNote(scope)}</p>
        <small>
          尖峰小時已依實測資料以「連續{" "}
          {scope.intervalMinutes
            ? `${Math.round(60 / scope.intervalMinutes)} 個 ${scope.intervalMinutes} 分鐘`
            : "1 小時"}{" "}
          區間＝1
          小時」的滾動視窗搜尋，上午與下午各自認定，且不會跨越兩段調查之間的空檔（2022
          年臺灣公路容量手冊式 2.10 僅定義尖峰小時係數，未規定固定時鐘區間）。
        </small>
      </div>
    ) : null;
  /*
   * ── 圖旁邊的解讀說明（24小時型態／同季平假日）─────────────
   *
   * 三個共同的規矩：
   *  ① 只讀畫面上那一份資料（filtered、dayComparisons、roadRows），不重算。
   *  ② 單位一律用畫面同一組單位變數，不寫死「／日」。
   *  ③ **平日與假日永遠不相加**——24小時型態是一個日別一段文字，
   *     同季平假日是並排比較。這是這支程式踩過的最大一個坑。
   */
  /**
   * 24 小時型態那一塊的範圍說明。
   *
   * ⚠️ 讀 CHART_HOURLY 自己的條件，不是主工具列。這一塊掛著
   *   renderBlockFilters（季度／日別／調查點／視角／方向），**可以脫離**；
   *   讀主工具列的話，脫離之後說明講的是另一組資料，
   *   而說明裡還帶著尖峰小時與最大值那幾個數字。
   */
  const blockScopeText = useMemo(() => {
    const own = filtersOf(CHART_HOURLY);
    const quarterKey = own.quarterTo || own.quarterFrom || quarter;
    const road =
      own.roads.length === 0
        ? "全部調查點"
        : own.roads.length === 1
          ? (roadOptions.find(([id]) => id === own.roads[0])?.[1] ?? own.roads[0])
          : `${own.roads.length} 個調查點`;
    /* 直接讀 quarterLabels.labels，不呼叫元件內的 quarterLabel()——
       那會讓相依陣列多掛一個每次都重建的函式，lint 也會不乾淨。 */
    return `${quarterLabels.labels[quarterKey] || quarterKey}・${road}`;
  }, [filtersOf, CHART_HOURLY, quarter, quarterLabels, roadOptions]);
  /*
   * 匯出高解析圖用的每小時序列。
   * ⚠️ 和畫面上那張圖走**同一支** hourlySeriesByDayOf、同一組篩選條件，
   *   匯出端不另外算一份——算兩份遲早分岔，而症狀是「畫面上的圖和
   *   下載下來的圖不一樣」。
   */
  const hourlyExportSeries = useMemo(
    () =>
      hourlySeriesByDayOf(
        /*
         * ⚠️ 一定要用 hourlyRecords（這一塊自己的條件），不是 filtered。
         *   下載的 PNG 是「畫面上那張圖的照片」，用主工具列那一份的話，
         *   這一塊只要脫離過，下載下來的圖就和畫面上看到的不是同一張——
         *   而那張圖會被貼進簡報。（2026-09-16 實測）
         */
        hourlyRecords,
        pcuFactors,
        turnPcuFactors,
        vehicleClassSettings,
        pcuScopes,
      ),
    [hourlyRecords, pcuFactors, turnPcuFactors, vehicleClassSettings, pcuScopes],
  );
  const hourlyChartNote = useMemo(() => {
    /* ⚠️ 說明講的每一個數字都要來自**圖上那一份**（hourlyRecords）。 */
    const dayTypes: string[] = [];
    for (const record of hourlyRecords)
      if (record.dayType && !dayTypes.includes(record.dayType))
        dayTypes.push(record.dayType);
    /*
     * ⚠️ X-80：圖已經改成**一個調查點一張**，講稿就必須跟著一個調查點一段。
     *   維持「一個日別一段、內容是跨點相加」的話，畫面上是逐點的圖、
     *   底下是合計的敘述——那是**說明在說謊**那一類，比原本的缺點更糟。
     * ⚠️ 逐點之後每一段的點數就是 1，hourlyNote 的「N 個調查點合起來算」
     *   那一句自然消失（不是把它關掉，是它本來就不再成立）。
     */
    const roadIds: [string, string][] = hourlyRoadIds.length
      ? hourlyRoadIds
      : [["", ""]];
    const splitRoad = roadIds.length > 1;
    const groups = (dayTypes.length ? dayTypes : [""]).flatMap((day) =>
      roadIds.map(([roadId, roadName]) => ({
        day,
        roadId,
        roadName,
        points: hourlySeriesOf(
          hourlyRecords.filter(
            (r) =>
              (!day || r.dayType === day) && (!roadId || r.roadId === roadId),
          ),
          pcuFactors,
          turnPcuFactors,
          vehicleClassSettings,
          pcuScopes,
        ),
      })),
    );
    const notes = groups.map((group) => {
      const where = [group.roadName || group.roadId, group.day]
        .filter(Boolean)
        .join("・");
      return {
        day: where || group.day,
        note: hourlyNote(
          group.points
            .filter((point) => point.surveyed && point.actual !== null)
            .map((point) => ({
              hour: `${String(point.hour).padStart(2, "0")}:00`,
              value: point.actual as number,
            })),
          "輛",
          where ? `${blockScopeText}・${where}` : blockScopeText,
          /*
           * 拆過之後每一段只含一個調查點，所以是 1；
           * 只有一個調查點、沒有拆的情況下才可能 > 1（那時本來就沒有跨點問題）。
           */
          splitRoad
            ? 1
            : new Set(
                hourlyRecords
                  .filter((r) => !group.day || r.dayType === group.day)
                  .map((record) => record.roadId),
              ).size,
        ),
      };
    });
    if (notes.length <= 1)
      return (
        notes[0]?.note ?? {
          title: "這張圖在說什麼",
          lines: ["目前的條件下沒有資料。"],
        }
      );
    /* 各段各講各的，中間放一句提醒，**絕對不把不同日別／不同調查點的量加起來**。 */
    return {
      title: "這張圖在說什麼",
      lines: [
        splitRoad
          ? `目前有 ${notes.length} 段，一個調查點（乘上日別）一段。**不同調查點的每小時交通量不會相加**（原因見手冊第 8 章）。`
          : `圖上有 ${notes.length} 條線，一個日別一條。**兩條線不會相加**——平日與假日是兩種不同的交通狀態，加起來的數字不對應任何一天。`,
        ...notes.flatMap((entry) => [
          `【${entry.day}】`,
          ...entry.note.lines.slice(1),
        ]),
      ],
    } satisfies ChartNote;
  }, [
    /* ⚠️ 說明讀的是圖上那一份（hourlyRecords），不是主工具列的 filtered。 */
    hourlyRecords,
    pcuFactors,
    turnPcuFactors,
    vehicleClassSettings,
    blockScopeText,
    hourlyRoadIds,
    /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
    pcuScopes,
  ]);
  const dayCompareChartNote = useMemo(
    () =>
      dayCompareNote(
        dayComparisons.map((row) => ({
          name: row.roadName,
          weekday: row.weekdaySurveyed
            ? dayMetric === "actual"
              ? row.weekdayActual
              : row.weekdayPcu
            : null,
          holiday: row.holidaySurveyed
            ? dayMetric === "actual"
              ? row.holidayActual
              : row.holidayPcu
            : null,
          /* 面板上每一列的單位是各自算的，說明文字要看得到這件事。 */
          partial: row.weekdayCoverage.partial || row.holidayCoverage.partial,
        })),
        dayMetric === "actual" ? dailyActualUnit : dailyPcuUnit,
      ),
    [dayComparisons, dayMetric, dailyActualUnit, dailyPcuUnit],
  );
  /*
   * 歷季趨勢有自己的日別選擇（trendMode），和上方分析範圍的 dayType 是
   * **兩個各自獨立的 state**，預設值還不一樣（dayType 預設「平日」、
   * trendMode 預設「平日＋假日」）。trendRows 走的是 trendMode，
   * 所以它的單位必須依 trendMode 算，用 dailyActualUnit 會在什麼都不動的
   * 預設狀態下就把兩天相加的量標成「輛／調查日」。
   */
  /*
   * 歷季趨勢的「平日＋假日」是**兩條線各自畫**（trendRows 一直把 weekday 與
   * holiday 分成兩個欄位，被篩掉的那一條給 null 而不是 0），從來沒有相加。
   * 但單位原本寫「輛／平假日合計」——而 trendMode 的預設值正是「平日＋假日」，
   * 所以什麼都不動的預設畫面上，兩條單日的線掛著一個「合計」的單位。
   * 每一個點都是某一天的量，單位就跟只看一天時一樣。
   */

  const trendActualUnit = partialScope ? "輛／調查時段" : "輛／調查日";
  const trendPcuUnit = partialScope ? "PCU／調查時段" : "PCU／日";
  /* ── 趨勢圖的單位、軸名稱 ─────────────────────────────── */
  /** 單位跟著指標走：輛數類用調查涵蓋的單位、PCU 類用 PCU 單位、佔比是 %。 */
  const trendUnit =
    trendMetricDef.unit === "%"
      ? "%"
      : trendMetricDef.unit === "pcu"
        ? trendMetricDef.peakBased
          ? "PCU／小時"
          : trendPcuUnit
        : trendMetricDef.peakBased
          ? "輛／小時"
          : trendActualUnit;
  const trendMetricName = trendMetricLabel(
    trendMetricDef,
    activeTrendVehicleLabel,
  );
  /*
   * 縱軸要寫「名稱（單位）」。舊版只寫單位，看圖的人不知道那是全日量、
   * 尖峰量還是某一個車種——而使用者的要求正是「有單位的軸，就要附上
   * 名稱和單位」。
   */
  const trendAxisTitle = axisTitle(trendMetricName, trendUnit);

  /*
   * 圖表說明（簡報講稿）。
   *
   * ⚠️ 只讀 trendRows——就是上面那張圖畫出來的同一份資料。
   * 圖與講稿分岔的時候，被念出來的是講稿，那比圖畫錯更難發現。
   */
  const trendScriptSections: TrendScriptSection[] = useMemo(
    () =>
      buildTrendScript(
        trendRows,
        {
          label: trendMetricName,
          unit: trendUnit,
          digits: trendMetricDef.digits,
          meaning: trendMetricDef.meaning,
        },
        {
          scopeText:
            trendRoadLabel,
          dayText: trendMode,
          quarterLabel: (quarter: string) =>
            quarterLabels.labels[quarter] || quarter,
          coverageNote: partialScope
            ? "本圖有季度的調查並未涵蓋完整 24 小時，單位是「每調查時段」而不是「每日」；跨季比較前請先確認各季的調查涵蓋是否一致。"
            : undefined,
          /*
           * ⚠️ 講稿講的必須是**圖上真的畫的那幾條線**。
           *   逐點分列時圖上沒有合計，講稿卻去念 trendRows 的平日／假日，
           *   念出來的就是那個「不同調查點相加」的數字（X-28 裁示不可出現），
           *   而且講稿是會被照著念給業主聽的。
           */
          seriesLines: trendLines.length
            ? trendLines.map((line) => ({
                name: line.label,
                values: line.values,
              }))
            : undefined,
        },
      ),
    [
      trendRows,
      trendLines,
      trendMetricName,
      trendUnit,
      trendMetricDef,
      trendRoadLabel,
      trendMode,
      quarterLabels,
      partialScope,
    ],
  );

  /**
   * 把趨勢圖存成兩倍解析度、白底的 PNG。**只有圖，沒有說明文字。**
   *
   * 使用者的原話：「下載下來的圖本來就該只有圖，不能有文字，否則貼到簡報上時，
   * 看到那些應該由簡報者說明的文字展示在上方這樣才奇怪。」說明是講的，
   * 不是印在投影片上的——所以講稿留在畫面上圖的旁邊，並且可以一鍵複製。
   *
   * 白底是必要的：透明底貼到深色投影片上，字會看不見。
   * 圖例已經畫在畫布裡面，所以這張圖自己就看得懂哪一條是平日、哪一條是假日。
   */
  /*
   * ══════════════════════════════════════════════════════════════════
   *  每一張圖都能下載高解析圖片（PNG）
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-12：「能否三個程式各自所有的圖都能有個下載高清晰圖片
   * 的功能呢?」「這個……我希望三個程式都同樣方式作處理。」
   *
   * 三條規矩（沿用歷季趨勢圖那一顆已經定案的行為，見 chart-png.ts）：
   *   ① 只有圖，沒有說明文字　② 白底　③ 圖例畫在圖裡
   *
   * ⚠️ 一律是**重新畫一次**，不是把畫面上那張畫布放大。
   *   放大是內插，線條與文字都會糊；那不叫高清。
   *
   * ⚠️ 匯出用的資料一律是畫面上那幾個 memo 的同一份，
   *   匯出端不可以自己再算一次——自己算就會出現「畫面 12.3%、
   *   下載的圖 12.4%」這種永遠查不出來的差異。
   */

  /** 匯出圖的版面尺寸（CSS px）。實際輸出是這個尺寸 × EXPORT_SCALE。 */
  const CHART_EXPORT_SIZE = { width: 960, height: 540 };

  /*
   * 圖檔標題與檔名共用的一行「目前條件」。
   *
   * ⚠️ 空的段落要**整段拿掉**，不可以留下分隔號。
   *   還沒選季度時 quarter 是空字串，直接串起來會變成
   *   「每小時實際交通量與PCU_・全部調查點.png」——開頭一個孤零零的
   *   「・」，看起來像檔名壞掉。實測抓到的。
   */
  const chartScopeText = [
    quarterLabels.labels[quarter] || quarter,
    roadFilters.length === 0
      ? "全部調查點"
      : roadFilters.length === 1
        ? (roadOptions.find(([id]) => id === roadFilters[0])?.[1] ??
          roadFilters[0])
        : `${roadFilters.length} 個調查點`,
  ]
    .filter(Boolean)
    .join("・");
  /**
   * 同一行字，但**照某一塊自己的條件**算——下載的圖檔要用這一支。
   *
   * ⚠️ 下載下來的 PNG 是「畫面上那張圖的照片」，所以檔名與圖上那一行字
   *   必須描述**圖上畫的那一份**。這一塊脫離主工具列之後還印主工具列的話，
   *   交出去的檔案會是「檔名寫 A、圖畫 B」——而那張圖會被貼進簡報，
   *   看的人只會讀到檔名與圖上那行字。（2026-09-16 實測抓到兩張。）
   * ⚠️ 這與「交出去的文件一律吃主工具列」不衝突：那條規則講的是
   *   結論草稿與分析數據 Excel（整份文件有一組條件），
   *   不是單張圖的自我描述。
   */
  const chartScopeTextOf = useCallback(
    (chartId: string) => {
      const own = filtersOf(chartId);
      const quarterKey = own.quarterTo || own.quarterFrom || quarter;
      return [
        quarterLabels.labels[quarterKey] || quarterKey,
        own.roads.length === 0
          ? "全部調查點"
          : own.roads.length === 1
            ? (roadOptions.find(([id]) => id === own.roads[0])?.[1] ??
              own.roads[0])
            : `${own.roads.length} 個調查點`,
      ]
        .filter(Boolean)
        .join("・");
    },
    [filtersOf, quarter, quarterLabels, roadOptions],
  );

  const downloadTrendPng = useCallback((sink?: ChartPngSink) => {
    return downloadPaintedPng(
      `${trendMetricName}_${trendMode}_歷季趨勢.png`,
      CHART_EXPORT_SIZE.width,
      CHART_EXPORT_SIZE.height,
      (context, width, height) => {
        paintTrendChart(context, width, height, {
          rows: trendRows,
          yTitle: trendAxisTitle,
          quarterLabels: quarterLabels.labels,
          /* ⚠️ 下載的圖與畫面必須是**同一份線**，不可以只有畫面逐點分列。 */
          lines: trendLines,
        });
      },
      undefined,
      sink,
    );
  }, [
    CHART_EXPORT_SIZE.width,
    CHART_EXPORT_SIZE.height,
    trendMetricName,
    trendMode,
    trendRows,
    trendLines,
    trendAxisTitle,
    quarterLabels,
  ]);

  /**
   * 24 小時型態的高解析 PNG。
   *
   * ⚠️ 2026-09-18 大檢查（F-24）：畫面在 X-80 之後是**一個調查點一張圖**，
   *   但這裡原本仍拿 hourlyExportSeries（全部調查點同一小時相加）畫一條線——
   *   實測下載出來 07:00 尖峰 45,848 輛／小時＝10 個調查點相加，正是 X-80
   *   說「不對應任何一條路」而從畫面拿掉的那張圖，卻還從匯出口出去。
   *   現在：多個調查點時**一個調查點出一張**（roadId 指定哪一個），
   *   與畫面上的每一張圖同一批紀錄、同一支繪圖函式；單一調查點時與改動前相同。
   */
  const downloadHourlyPng = useCallback(
    (roadId?: string, sink?: ChartPngSink) => {
      const records = roadId
        ? hourlyRecords.filter((record) => record.roadId === roadId)
        : hourlyRecords;
      const roadName = roadId
        ? (hourlyRoadIds.find(([id]) => id === roadId)?.[1] ?? roadId)
        : "";
      const series = roadId
        ? hourlySeriesByDayOf(
            records,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            pcuScopes,
          )
        : hourlyExportSeries;
      return downloadPaintedPng(
        /* ⚠️ 用這一塊自己的條件，不是主工具列（見 chartScopeTextOf）。 */
        `每小時實際交通量與PCU_${roadName ? `${roadName}_` : ""}${chartScopeTextOf(CHART_HOURLY)}.png`,
        CHART_EXPORT_SIZE.width,
        CHART_EXPORT_SIZE.height,
        (context, width, height) => {
          paintHourlyChart(context, width, height, series, true);
        },
        undefined,
        sink,
      );
    },
    [
      CHART_EXPORT_SIZE.width,
      CHART_EXPORT_SIZE.height,
      chartScopeTextOf,
      CHART_HOURLY,
      hourlyExportSeries,
      hourlyRecords,
      hourlyRoadIds,
      pcuFactors,
      turnPcuFactors,
      vehicleClassSettings,
      pcuScopes,
    ],
  );

  /**
   * 車種組成圓環。
   *
   * 「平日＋假日」時畫面上是**兩個**圓環，所以這裡也分開存兩張——
   * 合成一張的話，使用者要的是哪一天的組成就講不清楚了。
   */
  const downloadCompositionPng = useCallback(
    (day?: string, sink?: ChartPngSink) => {
      /* ⚠️ day 這個參數現在帶的是「這一組」的識別字（日別、調查點或兩者）。 */
      const source =
        day && compositionByDay
          ? compositionByDay.find((entry) => entry.key === day)
          : null;
      const items = source ? source.items : compositionItems;
      const total = source ? source.totals.total : compositionTotals.total;
      return downloadPaintedPng(
        `車種組成_${day ? day + "_" : ""}${chartScopeTextOf(CHART_COMPOSITION)}.png`,
        CHART_EXPORT_SIZE.width,
        CHART_EXPORT_SIZE.height,
        (context, width, height) => {
          drawDonutChart(context, width, height, {
            items: items.map((item) => ({
              label: item.label,
              count: item.count,
              color: item.color,
            })),
            total,
            centerValue: formatter.format(total),
            /* F-27：與畫面同一個逐點單位；單一圓環（沒有 source）沿用整批單位。 */
            centerUnit: source ? source.unit : compositionUnit,
            caption: `車種組成・${day ? day + "・" : ""}${chartScopeTextOf(CHART_COMPOSITION)}`,
          });
        },
        undefined,
        sink,
      );
    },
    [
      CHART_EXPORT_SIZE.width,
      CHART_EXPORT_SIZE.height,
      chartScopeTextOf,
      CHART_COMPOSITION,
      compositionByDay,
      compositionItems,
      compositionTotals,
      compositionUnit,
    ],
  );

  const downloadComparisonPng = useCallback((sink?: ChartPngSink) => {
    /*
     * ⚠️ 2026-09-18 大檢查 F-25：單位要跟畫面一樣**逐列看調查涵蓋**。
     *   原本整張圖只看 partialScope——範圍內只要有一個部分時段調查點，
     *   五條完整 24 小時路段在畫面上寫「輛／日」、PNG 卻寫「輛／調查時段」。
     *   全部完整→「／日」；全部部分時段→「／調查時段」；混合→兩種都寫明，
     *   部分時段的那幾列名稱後面加「※」對得起來。
     */
    const measure = dayMetric === "actual" ? "輛" : "PCU";
    const rowPartial = (row: (typeof dayComparisons)[number]) =>
      (row.weekdaySurveyed && row.weekdayCoverage.partial) ||
      (row.holidaySurveyed && row.holidayCoverage.partial);
    const partialRows = dayComparisons.filter(rowPartial).length;
    const mixedCoverage = partialRows > 0 && partialRows < dayComparisons.length;
    const unit = mixedCoverage
      ? `${measure}／日；名稱後有「※」的調查點為部分時段調查，單位為 ${measure}／調查時段`
      : partialRows > 0
        ? `${measure}／調查時段`
        : `${measure}／日`;
    return downloadPaintedPng(
      `各路段平日與假日比較_${dayMetric === "actual" ? "實際交通量" : "PCU"}_${chartScopeTextOf(CHART_DAY_COMPARE)}.png`,
      CHART_EXPORT_SIZE.width,
      Math.max(180, 96 + dayComparisons.length * 46),
      (context, width, height) => {
        drawGroupedBars(context, width, height, {
          /*
           * ⚠️ 「沒有做這一天的調查」要傳 null，不可以傳 0。
           *   長度 0 的長條和「做了、量是 0」長得一模一樣，
           *   而後者是資料、前者不是。畫面上也是這樣分的。
           */
          groups: dayComparisons.map((row) => ({
            /* ⚠️ 稽核表 C：拆季之後圖上也要看得出是哪一季，否則兩根柱子同名。 */
            label:
              (row.quarter
                ? `${row.roadName}（${showQuarter(row.quarter)}）`
                : row.roadName) + (mixedCoverage && rowPartial(row) ? "※" : ""),
            values: [
              row.weekdaySurveyed
                ? dayMetric === "actual"
                  ? row.weekdayActual
                  : row.weekdayPcu
                : null,
              row.holidaySurveyed
                ? dayMetric === "actual"
                  ? row.holidayActual
                  : row.holidayPcu
                : null,
            ],
          })),
          seriesNames: ["平日", "假日"],
          seriesColors: [palette.teal, palette.orange],
          caption: `各路段平日與假日比較・${chartScopeTextOf(CHART_DAY_COMPARE)}`,
          unit,
        });
      },
      undefined,
      sink,
    );
  }, [
    CHART_EXPORT_SIZE.width,
    chartScopeTextOf,
    CHART_DAY_COMPARE,
    dayComparisons,
    /* 圖上的柱子標籤現在會帶季別（稽核表 C），所以季別寫法變了要重畫。 */
    showQuarter,
    dayMetric,
  ]);

  /*
   * ── 一鍵下載全部圖檔 ────────────────────────────────────────
   *
   * ⚠️ 這一份清單就是「這支程式有幾張圖」的**唯一定義**。
   *   之後新增一張圖卻忘了加進來，守門測試會紅（它比對的是畫面上
   *   有幾顆 data-chart-png 按鈕 vs 這份清單有幾項）。
   *
   * ⚠️ 每一張都是**當場重新畫**，不是去抓畫面上的畫布。
   *   抓畫布的話，沒開過的那一頁抓不到（元件根本沒掛上去），
   *   而且會在「圖還沒畫完」時抓到半張——兩種都不會有錯誤訊息。
   */
  const chartPngJobs = useMemo(() => {
    const jobs: {
      id: string;
      label: string;
      fileName: string;
      /** 有給 sink 就把圖交出去（打包用），不給就直接下載（單張用）。 */
      run: (sink?: ChartPngSink) => void | Promise<unknown>;
    }[] = [];
    if (compositionByDay)
      for (const entry of compositionByDay)
        jobs.push({
          id: `composition-${entry.key}`,
          label: `車種組成圓環圖（${entry.label}）`,
          fileName: `車種組成_${entry.key}_${chartScopeTextOf(CHART_COMPOSITION)}.png`,
          run: (sink?: ChartPngSink) => downloadCompositionPng(entry.key, sink),
        });
    else
      jobs.push({
        id: "composition",
        label: "車種組成圓環圖",
        fileName: `車種組成_${chartScopeTextOf(CHART_COMPOSITION)}.png`,
        run: (sink?: ChartPngSink) => downloadCompositionPng(undefined, sink),
      });
    /* F-24：畫面上幾張，這裡就幾張——多個調查點時一個調查點一項。 */
    if (hourlyRoadIds.length > 1)
      for (const [roadId, roadName] of hourlyRoadIds)
        jobs.push({
          id: `hourly-${roadId}`,
          label: `每小時實際交通量與PCU（24小時型態・${roadName || roadId}）`,
          fileName: `每小時實際交通量與PCU_${roadName || roadId}_${chartScopeTextOf(CHART_HOURLY)}.png`,
          run: (sink?: ChartPngSink) => downloadHourlyPng(roadId, sink),
        });
    else
      jobs.push({
        id: "hourly",
        label: "每小時實際交通量與PCU（24小時型態）",
        fileName: `每小時實際交通量與PCU_${chartScopeTextOf(CHART_HOURLY)}.png`,
        run: (sink?: ChartPngSink) => downloadHourlyPng(undefined, sink),
      });
    jobs.push({
      id: "trend",
      label: "全日交通量平日／假日趨勢（歷季分析）",
      fileName: `${trendMetricName}_${trendMode}_歷季趨勢.png`,
      run: downloadTrendPng,
    });
    jobs.push({
      id: "comparison",
      label: "各路段平日與假日比較",
      fileName: `各路段平日與假日比較_${dayMetric === "actual" ? "實際交通量" : "PCU"}_${chartScopeTextOf(CHART_DAY_COMPARE)}.png`,
      run: downloadComparisonPng,
    });
    return jobs;
  }, [
    /* ⚠️ 檔名逐塊算（見 chartScopeTextOf），不可以整批套主工具列那一行。 */
    chartScopeTextOf,
    CHART_COMPOSITION,
    CHART_HOURLY,
    CHART_DAY_COMPARE,
    compositionByDay,
    dayMetric,
    downloadCompositionPng,
    downloadComparisonPng,
    downloadHourlyPng,
    downloadTrendPng,
    hourlyRoadIds,
    trendMetricName,
    trendMode,
  ]);

  const [chartPngPicked, setChartPngPicked] = useState<string[]>([]);
  const [chartPngBusy, setChartPngBusy] = useState(false);
  /*
   * 條件改變（例如換了日別，圓環從一個變成兩個）之後，清單的項目也會變。
   * 不同步的話，勾選狀態會殘留在已經不存在的項目上，畫面顯示「已勾 5 張」
   * 卻只下載得到 4 張——而且不會有任何錯誤。
   */
  useEffect(() => {
    const ids = chartPngJobs.map((job) => job.id);
    setChartPngPicked((prev) => {
      const next = prev.filter((id) => ids.includes(id));
      /* 第一次進來（還沒動過）預設全選，比較符合「一鍵下載全部」的名字。 */
      const initial = prev.length === 0 ? ids : next;
      return initial.length === prev.length &&
        initial.every((id, index) => id === prev[index])
        ? prev
        : initial;
    });
  }, [chartPngJobs]);

  const downloadAllChartPng = useCallback(async () => {
    const jobs = chartPngJobs.filter((job) => chartPngPicked.includes(job.id));
    if (!jobs.length) return;
    setChartPngBusy(true);
    try {
      /*
       * ══════════════════════════════════════════════════════════════
       *  多張圖 → 打包成**一個**壓縮檔
       * ══════════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-14：
       *   「下載多張圖片時，瀏覽器有時會阻擋一次下載多張圖，
       *     如果使用者沒注意，會以為下載失敗，請改成……以壓縮包形式下載」
       *
       * ⚠️ 他說的是對的，而且舊作法本質上是在賭：原本是「每張之間停 350ms」
       *   去閃避瀏覽器的多重下載攔截。不同瀏覽器、不同設定、使用者按過一次
       *   「封鎖」之後，結果都不一樣——**而且被擋掉時完全沒有訊息**，
       *   使用者只會拿到前一兩張，然後以為其餘的圖沒有這個功能。
       *
       *   改成打包之後，不管幾張圖都只發**一個**下載，攔截就無從發生。
       *
       * ⚠️ 只有一張時**不打包**：為了一張圖還要解壓縮是多餘的麻煩，
       *   而且單一下載本來就不會被攔截。
       */
      const files: { name: string; blob: Blob }[] = [];
      for (const job of jobs)
        await job.run(function (name: string, blob: Blob) {
          files.push({ name, blob });
        });

      if (!files.length) {
        setToast("這幾張圖目前畫不出來，沒有東西可以下載。");
        return;
      }

      if (files.length === 1) {
        downloadBlob(files[0].blob, files[0].name);
        setToast("已下載 1 張高解析圖片。");
        return;
      }

      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      /*
       * ⚠️ 同名的檔案在壓縮檔裡會互相覆蓋（而且不會報錯），
       *   所以重名時補流水號。檔名本來就帶條件，正常情況不會撞名，
       *   但「兩天的車種組成」這種成對的項目改過名之後就有可能。
       */
      const used = new Set<string>();
      for (const file of files) {
        let name = file.name;
        let n = 2;
        while (used.has(name)) {
          name = file.name.replace(/(\.png)$/i, `_${n}$1`);
          n += 1;
        }
        used.add(name);
        zip.file(name, file.blob);
      }
      const bundle = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
      });
      downloadBlob(bundle, `全日交通量_圖檔_${chartScopeText}.zip`);
      setToast(
        `已下載 1 個壓縮檔，裡面有 ${files.length} 張高解析圖片。`,
      );
    } finally {
      setChartPngBusy(false);
    }
  }, [chartPngJobs, chartPngPicked, chartScopeText]);

  const copyTrendScript = useCallback(() => {
    const text = trendScriptSections
      .map((section) => `【${section.title}】\n${section.lines.join("\n")}`)
      .join("\n\n");
    /* 沒有剪貼簿權限時不要靜靜失敗，改成下載成 .txt。 */
    navigator.clipboard?.writeText(text).catch(() => {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "歷季趨勢圖說明.txt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  }, [trendScriptSections]);

  const intersectionFlowLabel = intersectionFlowLabelOf(intersectionFlowMode);
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
  }>({
    fromQuarter: "",
    toQuarter: "",
    types: [],
    roadId: "ALL",
    dayType: "ALL",
  });
  /** 檢查結果要不要把已確認的那幾筆一起列出來。 */
  const [showAckedAnomalies, setShowAckedAnomalies] = useState(false);
  const anomalyAlerts = useMemo(
    () =>
      detectAnomalies(
        activeRecords,
        workflow.thresholds,
        (record) =>
          sumPcu(
            record,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            pcuScopes,
          ),
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
      displayDirectionName,
      /* ⚠️ 係數覆寫改變時這一格必須重算，否則畫面會停在舊的 PCU。 */
      pcuScopes,
    ],
  );
  /*
   * ══════════════════════════════════════════════════════════════════
   *  「已人工確認」（使用者 2026-09-17 命名）
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ 只有「人工確認」類可以確認。「重新匯入」是原始檔真的有錯，
   *   給它一顆按掉的鈕，等於提供一個把資料錯誤藏起來的開關。
   * ⚠️ 指紋帶著數值（見 anomalyFingerprint）：數值一變就重新出現。
   */
  const ackedAnomalies = workflow.ackedAnomalies || {};
  const anomalyCanAck = (item: AnomalyAlert) =>
    ANOMALY_RESOLUTIONS[item.type]?.kind === "人工確認";
  const anomalyAcked = (item: AnomalyAlert) =>
    anomalyCanAck(item) && Boolean(ackedAnomalies[anomalyFingerprint(item)]);
  const toggleAnomalyAck = (fingerprint: string, on: boolean) => {
    setWorkflow((previous) => {
      const own = { ...(previous.ackedAnomalies || {}) };
      if (on) own[fingerprint] = { at: new Date().toLocaleString("zh-TW") };
      else delete own[fingerprint];
      return { ...previous, ackedAnomalies: own };
    });
    setToast(
      on
        ? "已記錄為「已確認」，下次檢查不再提醒。"
        : "已取消確認，這一筆會重新提醒。",
    );
  };
  const ackedAnomalyCount = anomalyAlerts.filter(anomalyAcked).length;
  const filteredAnomalies = useMemo(
    () =>
      filterAnomalies(anomalyAlerts, anomalyFilter).filter(
        /*
         * ⚠️ 已確認的預設收起來，但**不是刪掉**：上方另有一顆
         *   「顯示已確認（N）」可以叫回來、也可以取消確認。
         *   整個藏掉的話，使用者按完就再也找不到自己按過什麼。
         */
        (item) => showAckedAnomalies || !anomalyAcked(item),
      ),
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    [anomalyAlerts, anomalyFilter, showAckedAnomalies, ackedAnomalies],
  );
  /*
   * 「這一次檢查看到的是哪一份資料」的指紋。
   *
   * ⚠️ 只記筆數是不夠的：改了門檻、改了車種歸類、刪一筆又補一筆，
   *   筆數都可能一樣而結果已經不同。所以把會改變結果的東西一起算進去。
   */
  const qualityDataStamp = useMemo(
    () =>
      [
        activeRecords.length,
        quarters.join(","),
        JSON.stringify(workflow.thresholds),
        anomalyAlerts.length,
      ].join("|"),
    [activeRecords.length, quarters, workflow.thresholds, anomalyAlerts.length],
  );
  /** 檢查完之後資料又動過了嗎？ */
  const qualityStale = Boolean(qualityRunAt) && qualityRunStamp !== qualityDataStamp;
  /*
   * 刪除單一季度的預設值＝**最早一季**。
   * ⚠️ 不可以預設成主工具列現在看的那一季：那通常是使用者正在處理的
   *   最新一季，把它當成刪除鈕的預設值太危險（三支同一條規則）。
   */
  const maintenanceDeleteTarget = quarters.includes(maintenanceQuarter)
    ? maintenanceQuarter
    : (quarters[0] ?? "");

  const runQualityCheck = useCallback(
    function () {
      setQualityRunAt(new Date().toLocaleString("zh-TW"));
      setQualityRunStamp(qualityDataStamp);
    },
    [qualityDataStamp],
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
        /*
         * 用 compareQuarters，不要另外寫一套補零字串排序。
         * 舊寫法只把兩碼年份補成三碼，遇到同一個計畫混用民國與西元標記時
         * 會排錯：2025Q1（＝民國114Q1）會被排到 114Q3 後面，因為它比的是
         * 字串「114…」與「2025…」。compareQuarters 已經處理過這件事
         * （四碼視為西元換算成民國），全系統只留這一套季度先後規則。
         */
      ].sort(compareQuarters),
    [anomalyAlerts],
  );
  /*
   * 檢查結果的篩選列（起訖季度／調查點／日別 ＋ 類型標籤）。
   *
   * ⚠️ 這一段是從「品質與定稿」視窗**原封不動搬過來**的，一個條件都沒有
   *   增減——搬家不是改判準的時機，兩件事混在一起就分不出是搬壞的還是
   *   本來就這樣。
   */
  const anomalyFilterControls = (
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
              {showQuarter(q)}
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
              {showQuarter(q)}
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
                {roadOptions.find(
                  ([value]) => value === id,
                )?.[1] ?? id}
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
      {/*
       * 「顯示已確認」只在真的有已確認的項目時才出現——
       * 一顆永遠寫著 0 的開關是噪音。
       */}
      {ackedAnomalyCount > 0 && (
        <button
          type="button"
          className={`chip-toggle ack-toggle${showAckedAnomalies ? " selected" : ""}`}
          aria-pressed={showAckedAnomalies}
          data-testid="issue-ack-toggle"
          onClick={() => setShowAckedAnomalies(!showAckedAnomalies)}
        >
          {showAckedAnomalies ? "隱藏已確認" : "顯示已確認"}（
          {ackedAnomalyCount}）
        </button>
      )}
    </div>
    <small className="anomaly-hint">
      類型可以複選；不選任何類型代表全部顯示。季度區間是「比較區間有重疊就列出」，
      例如選 114Q1～114Q4，113Q4→114Q1
      這一筆也會出現，因為它跨進了這個範圍。
    </small>
    </>
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
      /* 鍵用 roadNameMatchKey()，理由同 roadExportLabels：名稱有自動與手動
         兩種來源，只差一個空格的兩個名字在畫面上分不出來。 */
      const key = roadNameMatchKey(row.roadName);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    for (const row of rows) {
      const entry = byRoad.get(row.roadId) ?? {
        name:
          (nameCounts.get(roadNameMatchKey(row.roadName)) ?? 0) > 1
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
                digits: reportDraftDigits,
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
        ? mainFilters.peakScope
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
        new Set([
          ...(exportScopeNames.get(row.scopeCode) ?? []),
          row.scopeName,
        ]),
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
      roads: usable
        ? (roads.slice(0, ROAD_SUMMARY_LIMIT) as DraftRoads)
        : ([] as DraftRoads),
      // 逐點敘述很佔篇幅，超過上限先截斷並在段末說明還有幾個點。
      omitted: usable ? Math.max(0, roads.length - ROAD_SUMMARY_LIMIT) : 0,
    };
  }, [
    periodExportRows,
    periodExport,
    mainFilters.peakScope,
    periodExportFlowLabel,
    analysisVehicleCatalog,
    dayType,
    /* 位數一改，這一段的 values[].digits 就要重算，否則草稿停在舊位數。 */
    reportDraftDigits,
  ]);
  const reportDraftContext = useMemo<ReportDraftContext>(() => {
    const sortedRoads = [...roadRows].sort((a, b) => b.total - a.total);
    // 直接沿用畫面「各路段平日與假日比較」面板的結果，定義才會一致。
    // 自己另外過濾一次的話會漏掉調查點與搜尋條件，出現「本段寫 42,090 輛、
    // 下一句卻寫 115,873 輛」這種自相矛盾。
    /*
     * ══════════════════════════════════════════════════════════════
     *  X-32：平假日比較那一句，多個調查點時也**不可以相加**
     * ══════════════════════════════════════════════════════════════
     *
     * ⚠️ 這一句就緊接在 X-30 那句「不同調查點的交通量不可以相加，
     *   所以不列合計」後面——同一段落自己打自己，是這次盤點最不能忍的一項。
     *
     * 只有一個調查點時照舊（reduce 一筆＝那一筆本身，數字不變）；
     * 兩個以上時交給 `dayComparePoints` 逐點敘述，這兩個和就不會被印出來。
     */
    /*
     * ⚠️ 草稿是交付物 → 吃**主工具列**那一份（dayComparisonsMain）。
     *   讀畫面那一份的話，這一塊只要為了看而脫離過（例如切到 114Q4），
     *   草稿的開頭寫著主工具列的季別，下一句的數字卻是別季的。
     */
    const weekday = dayComparisonsMain.reduce(
      (sum, row) => sum + row.weekdayActual,
      0,
    );
    const holiday = dayComparisonsMain.reduce(
      (sum, row) => sum + row.holidayActual,
      0,
    );
    /*
     * 圖上平日與假日是兩條獨立序列，報告也必須使用同一份序列。
     * 平日＋假日不是同一天，不可把兩條線相加成一個虛構的日交通量。
     */
    /*
     * ⚠️ 多個調查點時圖上是「一個調查點一條線」，草稿也必須用**同一份線**。
     *   照舊讀 trendRows 的平日／假日，寫進草稿的就是跨調查點的合計——
     *   X-28 與 X-30 已經把畫面與草稿的其他落點都改掉了，只剩這裡。
     *   而且草稿是要被抄進正式報告的。
     */
    const trendSeries = trendLines.length
      ? trendLines.map((line) => ({
          label: line.label,
          rows: trendRows.map((row, index) => ({
            quarter: row.quarter,
            value: line.values[index] ?? Number.NaN,
          })),
        }))
      : [
          ...(trendMode === "假日"
            ? []
            : [
                {
                  label: "平日",
                  rows: trendRows.map((row) => ({
                    quarter: row.quarter,
                    value: row.weekday ?? Number.NaN,
                  })),
                },
              ]),
          ...(trendMode === "平日"
            ? []
            : [
                {
                  label: "假日",
                  rows: trendRows.map((row) => ({
                    quarter: row.quarter,
                    value: row.holiday ?? Number.NaN,
                  })),
                },
              ]),
        ];
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
          /*
           * X-31：每一格要記得**自己是哪一個調查點**。
           *
           * 使用者 2026-09-16 裁示：這一段改成逐點一句（與 X-30 同一套），
           * 所以不能只留下加起來的數字——得帶著調查點名稱一路傳到草稿。
           */
          const entries = [...byRoad.values()].flatMap((flowGroups) => {
            // 一個調查點只能貢獻一次，所以並列時只取第一個視角的那一組。
            const items = flowGroups[0];
            const totals = items.filter((item) => item.scopeCode === "ALL");
            const picked = totals.length ? [totals[0]] : items;
            return picked
              .map((item) => ({
                cell: item.periods[period],
                roadName: item.roadName,
                dayType: item.dayType,
              }))
              .filter((entry) => entry.cell && entry.cell.hasData);
          });
          const cells = entries.map((entry) => entry.cell);
          if (!cells.length) return [];
          const hours = [...new Set(cells.map((cell) => cell.hour))];
          /*
           * 可不可以把各調查點加起來，取決於這個時段是不是「同一段時間」。
           *
           * ・全調查時段（all）＝整段涵蓋的累計，各調查點相加是有意義的。
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
              /*
               * X-31：逐調查點的值。草稿改成逐點一句之後用的是這一份，
               * 上面那兩個 reduce 出來的 pcu／total 只留給舊呼叫端與對帳用，
               * **畫面與草稿都不可以再印它們**。
               */
              sites: entries.map((entry) => ({
                roadName: entry.roadName,
                dayType: entry.dayType,
                hour: entry.cell.hour,
                pcu: entry.cell.pcu,
                total: entry.cell.total,
                unit: cellUnitFor("count", period, entry.cell.hour),
              })),
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
               * 45 分鐘的視窗就被標成一小時的流率；全調查時段則會漏掉
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
        roadFilters.length === 0
          ? "全部調查點"
          : roadFilters.length === 1
            ? (roadOptions.find(([id]) => id === roadFilters[0])?.[1] ??
              roadFilters[0])
            : `${roadFilters.length} 個調查點`,
      directionLabel: directionLabelText,
      flowLabel: hasIntersectionRecords ? intersectionFlowLabel : null,
      coverageNote: draftCoverageNote,
      roadCount: new Set(roadRows.map((row) => row.roadId)).size,
      intersectionCount: new Set(intersectionOnlyRows.map((row) => row.roadId))
        .size,
      // 用 filtered 而不是 scoped：scoped 還沒套「車流方向」，
      // 會出現「1 個調查點、144 筆」這種兩個數字基準不同的句子。
      recordCount: filtered.length,
      total: totals.total,
      pcu24: totals.pcu24,
      dayTotals: dailyTotals,
      /*
       * X-30：多個調查點時，草稿的全日量改成**逐點敘述**，不再寫合計。
       * ⚠️ 與畫面上的小卡取同一份 roadRows（一列一個調查點＋日別），
       *   不另外算一遍——兩條路徑遲早分岔，而分岔出來的數字沒有症狀。
       */
      pointTotals: draftPointTotals,
      pointLimit: KPI_LINE_LIMIT,
      /*
       * 車種組成的數字必須跟它自己印出來的標籤同一個來源。
       *
       * 舊版數字取自 totals（工具列的日別／調查點／方向／搜尋），標籤卻寫
       * compositionMode（車種組成面板自己的日別）。工具列選平日、面板選假日時，
       * 草稿會寫「依『假日』統計：機車 51.9%（21,859 輛）」，而 21,859 是
       * 平日的數字——標籤與數字分屬兩個不同的篩選，兩邊都不會有人發現。
       *
       * ⚠️ 2026-09-16 再修一次，而且方向與上次相反。
       *   上次的修法是「數字改採車種組成面板自己的範圍」，但**標籤後來
       *   被換成讀主工具列的那一行**，於是同一個錯換一邊又長回來。
       *   這次照使用者 2026-09-14 的規則定案：
       *   **交出去的文件一律吃主工具列**——標籤與數字兩邊都照主工具列，
       *   畫面上那一塊照樣可以為了看而脫離。
       */
      vehicles: (compositionMainTotals.total ? analysisVehicleCatalog : []).map(
        (vehicle) => ({
          label: vehicle.label,
          count: compositionMainTotals.vehicles[vehicle.key] ?? 0,
          share: compositionMainTotals.total
            ? ((compositionMainTotals.vehicles[vehicle.key] ?? 0) /
                compositionMainTotals.total) *
              100
            : 0,
        }),
      ),
      // peakOf 在空集合會回 ["—", 0]，字串「—」是 truthy，
      // 只判斷第一個欄位會寫出「尖峰小時出現於 —」。要看數值。
      /*
       * ══════════════════════════════════════════════════════════════
       *  X-32：尖峰那一句要跟畫面上的尖峰卡走同一個判斷
       * ══════════════════════════════════════════════════════════════
       *
       * ⚠️ 畫面上的「尖峰小時當量交通量」在多個調查點時已經明確**不給數字**
       *（X-28），草稿卻照樣印那個跨點相加的尖峰——同一份資料，畫面拒絕給、
       *   文件照給，而文件是要抄進報告的。
       *
       * ⚠️ 判斷直接用 `kpiLines.multiPoint`，不另外寫一份條件：
       *   兩份條件遲早分岔，而分岔出來的不一致沒有症狀。
       */
      peak:
        !kpiLines.multiPoint &&
        directionPeaks.combined[1] > 0 &&
        directionPeaks.combined[0] !== "—"
          ? {
              hour: directionPeaks.combined[0],
              pcu: directionPeaks.combined[1],
              // 滾動尖峰在部分時段或細格資料下可能湊不滿一小時，那個數字
              // 是該時段的量而不是時率；標成 PCU/hr 會低估。
              unit: cellUnitFor("pcu", "am", directionPeaks.combined[0]),
            }
          : null,
      topRoads: sortedRoads.slice(0, 3).map((row) => ({
        name: dayQualifiedLabel(row.roadName, row.dayType, dayType),
        total: row.total,
        pcu: row.pcu24,
      })),
      dayCompare:
        dayComparisonsMain.some((row) => row.weekdaySurveyed) &&
        dayComparisonsMain.some((row) => row.holidaySurveyed)
          ? { weekday, holiday }
          : null,
      /* X-32：逐調查點的平假日值；有兩個以上時草稿改用這一份，不印上面那兩個和。 */
      dayComparePoints: dayComparisonsMain
        .filter((row) => row.weekdaySurveyed && row.holidaySurveyed)
        .map((row) => ({
          roadName: row.roadName,
          weekday: row.weekdayActual,
          holiday: row.holidayActual,
        })),
      trend: {
        mode: trendMode,
        metricLabel: trendMetricName,
        unit: trendUnit,
        roadLabel: trendRoadLabel,
        rows: trendSeries[0]?.rows ?? [],
        series: trendSeries,
      },
      /* 車種組成與共同功能列同一組條件，標籤直接用那一行。 */
      /* ⚠️ 草稿是交付物 → 標籤與數字都照主工具列（見上面 vehicles 的說明）。 */
      compositionMode: compositionMainScopeText.split("・").join("、"),
      /* F-10／F-30：草稿逐調查點×日別各寫一句，不跨點、不跨日別相加。 */
      compositionPoints: compositionMainGroups.map((group) => ({
        label: group.label,
        vehicles: analysisVehicleCatalog.map((vehicle) => ({
          label: vehicle.label,
          count: group.vehicles[vehicle.key] ?? 0,
          share: group.total ? ((group.vehicles[vehicle.key] ?? 0) / group.total) * 100 : 0,
        })),
      })),
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
      // 沒有勾「7張可編輯原生圖表」時，匯出檔裡就沒有圖表工作表，
      // 草稿也不該宣稱有附圖。
      digits: reportDraftDigits,
      /*
       * ⚠️ 「時段車種分析」那一段早就有這個標籤（roadDraftSummary.peakScopeLabel），
       *   但整份草稿的開頭一直沒有寫——於是「各方向各自認定」這種
       *   **不可相加**的口徑，只有翻到中段才看得到。改成開頭就講。
       *   兩處用的是**同一份**標籤，不另外算一次。
       */
      peakScopeLabel: roadDraftSummary.peakScopeLabel,
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
    roadOptions,
    hasIntersectionRecords,
    intersectionFlowLabel,
    roadRows,
    intersectionOnlyRows,
    filtered,
    totals,
    dailyTotals,
    draftPointTotals,
    kpiLines,
    analysisVehicleCatalog,
    directionPeaks,
    /* ⚠️ 草稿吃的是主工具列那一份（見上面的說明），不是畫面那一份。 */
    dayComparisonsMain,
    trendRows,
    trendLines,
    trendMode,
    trendRoadLabel,
    /* ⚠️ 草稿吃的是主工具列那一份（見上面的說明），不是畫面那一份。 */
    compositionMainTotals,
    compositionMainScopeText,
    compositionMainGroups,
    periodExport,
    periodExportRows,
    periodExportFlowLabel,
    pcuFactors,
    vehicleClassSettings,
    exportSections.charts,
    /* 小數位數一改，整段草稿都要重組——少了它草稿會停在舊位數。 */
    reportDraftDigits,
    activeRecords,
    qualitySummary,
    workflow.checkedQuarters,
    anomalyAlerts,
    roadDraftSummary,
    directionLabelText,
    roadFilters,
    trendMetricName,
    trendUnit,
    draftCoverageNote,
  ]);
  const generatedDraft = useMemo(
    () => buildReportDraft(reportDraftContext, draftSections),
    [reportDraftContext, draftSections],
  );
  useEffect(() => {
    // 使用者一旦自己動過文字就不再覆寫，否則辛苦寫好的段落會被無聲蓋掉。
    if (!draftEdited) setReportDraft(generatedDraft);
  }, [generatedDraft, draftEdited]);

  /*
   * 開啟「建立新計畫」表單。
   *
   * ⚠️ 一定要在這裡清空，不能只在建立成功後清。
   *    使用者 2026-09-10 回報：「新建新計畫時，前一個計畫名稱還留在裡面」。
   *    原因是 newProject 是長駐 state，建立完沒有還原，取消也沒有還原——
   *    只補「建立成功後清空」的話，**按取消再開一次照樣留著舊字**。
   */
  function openProjectForm() {
    setNewProject({ name: "", code: "", clientName: "" });
    setShowProjectForm(true);
  }
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
      setShowProjectForm(false);
      setNewProject({ name: "", code: "", clientName: "" });
      setToast("計畫已建立");
    } catch (e) {
      setToast(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }
  /*
   * 開啟「管理計畫」視窗。
   *
   * ⚠️ `target` 是 2026-09-11 加的，理由與 deleteProject 完全相同：
   *   「我的計畫」那一頁每一列都要能修改，要改的**不一定是目前這一個**。
   *
   *   絕對不可以在那一列先 setActiveProject(id) 再呼叫這一支——
   *   setState 是非同步的，這一支讀到的 selectedProject 仍然是切換**前**
   *   的那一個，結果會改到錯誤的計畫，而且畫面上看起來一切正常。
   *   （刪除那條路徑踩過一模一樣的坑，見 deleteProject 的註解。）
   */
  function openProjectManager(target?: {
    id: string;
    name: string;
    code?: string | null;
    clientName?: string | null;
  }) {
    const project = target ?? selectedProject;
    if (!project?.id) return setToast("請先建立計畫");
    setManagedProjectId(project.id);
    setProjectDraft({
      name: project.name,
      code: project.code ?? "",
      clientName: project.clientName ?? "",
    });
    setShowProjectManager(true);
  }
  async function renameProject(e: React.FormEvent) {
    e.preventDefault();
    /* 要改的是開視窗時指定的那一個，不是「目前這一個」。 */
    const targetId = managedProjectId || selectedProject.id;
    if (!targetId || !projectDraft.name.trim())
      return setToast("請輸入計畫名稱");
    setBusy(true);
    try {
      const response = await appFetch(
        `/api/projects/${encodeURIComponent(targetId)}`,
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
          project.id === targetId ? { ...project, ...data.project } : project,
        ),
      );
      setShowProjectManager(false);
      setManagedProjectId("");
      setToast(`計畫已改名為「${data.project.name}」`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "計畫修改失敗");
    } finally {
      setBusy(false);
    }
  }
  /*
   * 刪除一個計畫。
   *
   * ⚠️ `target` 是 2026-09-11 加的：「我的計畫」那一頁每一列都有刪除鈕，
   *   要刪的**不一定是目前這一個**。
   *
   *   本來想在那一列先 setActiveProject(id) 再呼叫這一支——那是錯的：
   *   setState 是非同步的，這一支讀到的 selectedProject 仍然是切換**前**
   *   的那一個，結果會刪掉錯誤的計畫，而且畫面上看起來一切正常。
   *   所以改成把要刪的那一個**直接傳進來**，只有一條刪除路徑。
   */
  async function deleteProject(target?: { id: string; name: string }) {
    const victim = target ?? { id: selectedProject.id, name: selectedProject.name };
    if (!victim.id) return;
    if (
      !window.confirm(
        `確定刪除計畫「${victim.name}」？\n\n此計畫的所有季度、交通量、路段別名及本機原始檔都會一併刪除，且無法復原。建議先匯出備份。`,
      )
    )
      return;
    setBusy(true);
    try {
      const response = await appFetch(
        `/api/projects/${encodeURIComponent(victim.id)}`,
        { method: "DELETE" },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const remaining = projects.filter(
        (project) => project.id !== victim.id,
      );
      setProjects(remaining);
      setRecords((previous) =>
        previous.filter((record) => record.projectId !== victim.id),
      );
      // 先算好結果再一次寫入，setState 的更新函式維持純函式。
      const nextIntersection = intersectionSettings.filter(
        (setting) => setting.projectId !== victim.id,
      );
      setIntersectionSettings(nextIntersection);
      safeWrite("traffic-intersection-settings-v1", nextIntersection);
      const nextVehicleClass = vehicleClassSettings.filter(
        (setting) => setting.projectId !== victim.id,
      );
      setVehicleClassSettings(nextVehicleClass);
      safeWrite("traffic-vehicle-class-settings-v1", nextVehicleClass);
      /*
       * 依計畫存放的 localStorage 內容也要一起清掉：PCU 係數、轉向 PCU
       * 係數與結論範本。計畫 id 是 crypto.randomUUID()，不會重複，
       * 所以留著不會被別的計畫撿去用，但會一直占著瀏覽器儲存空間，
       * 而這支程式的儲存空間本來就吃緊（滿了會導致係數存不進去）。
       */
      dropProjectScopedStorage(victim.id);
      /*
       * 計畫刪掉了，它在 IndexedDB 裡的工作流程狀態（定稿、檢核、門檻、
       * 範本、比較報表、匯入紀錄）也要一起清掉，否則會一直留著吃空間，
       * 而且下次建立同 id 的計畫會撿到上一個計畫的狀態。
       */
      await deleteWorkflow(victim.id);
      /*
       * ⚠️ 只有刪掉**目前這一個**時才需要換人並清季度。
       *   刪的是別的計畫時，使用者正在看的東西不該被動到——
       *   否則他在「我的計畫」頁刪掉一個舊案，畫面會莫名其妙跳到別的計畫。
       */
      if (victim.id === activeProject) {
        setActiveProject(remaining[0]?.id ?? "");
        setQuarter("");
      }
      setShowProjectManager(false);
      setToast(`計畫「${victim.name}」已刪除`);
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
  /*
   * ⚠️ 這裡原本有 shareProject()／showShare／share 三樣東西，2026-09-11 移除。
   *
   * 它們是「把計畫分享給同事」的協作功能，但**整支程式裡沒有任何地方
   * 打開過那個視窗**（`setShowShare(true)` 一次都沒有被呼叫），
   * 而且它打的是 `/api/projects/<id>/members` 這個伺服器端點——
   * 交付給使用者的是 GitHub Pages 單機版，根本沒有那個伺服器。
   * 也就是說它從頭到尾不可能成功，只是一段沒有入口的死程式。
   *
   * 使用者 2026-09-11 確認過他的做法：
   *「如果我要分享給同事，我就會把檔案匯出，拿去同事電腦中匯入，
   *  所以不需要唯讀檢視，那個分享視窗的程式碼自然也不用，可以移除。」
   *
   * ⚠️ 但 Project 的 `role` 欄位與幾顆按鈕上的 `role === "viewer"` 判斷
   *   **刻意保留**：它們現在恆為 false（本機建立的計畫一律是 owner），
   *   拿掉等於在驗收前動到六處按鈕的停用條件，風險不對稱。
   *   已記錄，下一輪再一起清。
   */
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
        /*
         * ── 手動併入 → 記成別名 ────────────────────────────────
         *
         * 使用者的原話：「我遇過同一個路段，結果好幾個檔案名稱不一樣，
         * 所以我**分別都做好了併入的動作**，系統就會自動記憶那就是別名，
         * 後來再出現一樣的名稱就會**自動併入**了。」
         *
         * ⚠️ 這一條路徑（匯入時手動挑）**才是常走的那一條**——
         * 調查廠商每一季的檔名寫法不同，同一個路段會以好幾種名字進來。
         * 原本只有「路段管理裡手動填別名」那一條（路徑 A）會記；
         * 這一條挑完就算了，於是**下一季同一個檔名還是會再問一次**。
         *
         * ⚠️ 這裡只**收集**，不在這裡送出：
         * resolveImportedRoad 是同步函式，而且此刻資料還沒寫入——
         * 使用者按「取消」的話這筆併入根本不該留下。
         * 真正寫進去是在 confirmPendingImport 成功之後。
         */
        if (proposedKey && selected.roadId)
          pendingAliasRef.current.set(proposedKey, {
            roadId: selected.roadId,
            aliasName: proposedName,
          });
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
    /* 每張工作表讀到的調查日期，寫入前拿去和使用者選的季度比對。 */
    const dateChecks: Array<{
      file: string;
      sheet: string;
      found: ReturnType<typeof findSurveyDate>;
    }> = [];
    /*
     * 逐檔診斷。舊版一次匯入五個檔、其中一個讀出 0 列時，流程照樣成功，
     * 少掉的那個只反映在檢核報告的「來源檔案 N」這個數字上，使用者要
     * 自己數才會發現。這裡記下每個檔讀出幾列、用了哪些工作表、略過哪些、
     * 日別是不是退回檔名判的，讓匯入前的檢核報告能指名道姓。
     */
    const fileNotes: Array<{
      file: string;
      rows: number;
      used: string[];
      skipped: string[];
      dayFromFileName: boolean;
    }> = [];
    let parsedCount = 0;
    /*
     * 每讀完一份就讓出主執行緒一個「巨集任務」的時間。
     * 只 await 一個已完成的 Promise 只會讓出微任務，瀏覽器不會重畫，
     * 進度數字會整批卡到最後才一次跳完。
     */
    const breathe = () => new Promise((done) => setTimeout(done, 0));
    /*
     * 第一次解析之前，要**確定畫面已經重繪過**。
     *
     * setTimeout(0) 只是讓出一個巨集任務，不保證瀏覽器有機會畫。
     * 實測（交通服務水準，6 份大檔）：狀態停在「已完成 0／6 份」，
     * 每 20ms 的心跳整段只跳了 1 次——單一檔案解析的過程主執行緒完全被佔住，
     * 畫面零重繪。使用者因此看不到提示，連作業系統檔案對話框關閉後的殘影
     * 都會留在畫面上。三支的解析流程一樣，所以一起處理。
     *
     * ⚠️ 分頁在背景時 requestAnimationFrame 不會觸發，一定要有時間退路，
     *    否則匯入會永遠停住。
     */
    const paint = () =>
      new Promise<void>((done) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          done();
        };
        const fallback = setTimeout(finish, 250);
        if (typeof requestAnimationFrame === "function")
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(fallback);
              finish();
            }),
          );
      });
    let firstFile = true;
    for (const file of files) {
      setBusyProgress(
        `第 ${parsedCount + 1}／${files.length} 份：${file.name}`,
      );
      /* 第一份要確定畫面畫出來了才開始，後面幾份沿用較便宜的讓步 */
      if (firstFile) {
        firstFile = false;
        await paint();
      } else {
        await breathe();
      }
      /*
       * SheetJS 0.20.3 已包含上游原型污染修正；這裡仍保留匯入前後的原型
       * 指紋檢查，作為解析第三方工作簿時的額外縱深防護。
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
      /*
       * 同一個日別可能有**多張**工作表，必須全部讀，不能只讀第一張。
       *
       * 舊寫法是 `SheetNames.find(n => n.includes(dt))`，只取第一個名稱含
       * 該日別字樣的工作表。實測兩種真實會發生的情況：
       *  ・工作表順序是「平日照片、平日」→ 選中「平日照片」，讀出 0 列，
       *    **整份平日資料靜靜消失**；多檔一起匯入時連錯誤都不會出現。
       *  ・同一日別拆成「平日-北向、平日-南向」→ 只讀北向，**一半資料不見**，
       *    而檢核報告還會顯示綠字「未發現 24 小時缺漏」，因為讀到的那張
       *    單方向確實是完整的 24 小時。
       * 照片、監測日誌、時相圖這類非資料工作表改用名稱排除。
       */
      const dayNamedSheets = (["平日", "假日"] as DayType[]).flatMap((dt) =>
        trafficSheetNamesForDay(book.SheetNames, dt).map((name) => ({
          dt,
          name,
        })),
      );
      /*
       * 表頭讀到的調查日期，附在每一列上。**只作顯示與期別檢查用**——
       * trafficIdentity 不含它，覆蓋判斷、加總、車種分類與任何計算都不受影響。
       * 一張工作表一個日期：同一個檔案的平日、假日各自比對自己那一天。
       */
      const dateOf = (values: unknown[][], sheetName: string) =>
        findSurveyDate(headerDateCells(values, sheetName));
      const stamp = (rows: TrafficRecord[], iso: string) =>
        iso ? rows.map((row) => ({ ...row, surveyDate: iso })) : rows;
      /* 這個檔案有沒有讀到任何一格日期——沒有就記一筆「讀不到」，但不阻擋。 */
      const before = dateChecks.length;
      const rowsBefore = parsed.length;
      const usedSheets: string[] = [];
      let dayFromFileName = false;
      if (dayNamedSheets.length) {
        for (const { dt, name } of dayNamedSheets) {
          const values = readSheet(name);
          const found = dateOf(values, name);
          /*
           * 每一張真正會匯入的工作表都要留一筆檢查結果。
           * 不能只留「有讀到日期」的那幾張：同一檔案若平日讀得到、
           * 假日讀不到，假日仍必須明確提醒使用者自行確認。
           */
          dateChecks.push({ file: file.name, sheet: name, found });
          usedSheets.push(name);
          parsed.push(
            ...stamp(
              parseTrafficSheetValues(values, dt, importQuarterKey, identity, {
                fileName: file.name,
                sheetName: name,
              }),
              found?.iso ?? "",
            ),
          );
        }
        if (dateChecks.length === before)
          dateChecks.push({ file: file.name, sheet: "", found: null });
        fileNotes.push({
          file: file.name,
          rows: parsed.length - rowsBefore,
          used: usedSheets,
          skipped: book.SheetNames.filter((n) => !usedSheets.includes(n)),
          dayFromFileName,
        });
        continue;
      }
      // 七叉路口這類檔案沒有「平日」「假日」工作表，而是一條支線一張工作表
      // （路口(A)、路口B…）。日別改從表頭的「日期：…(平日)」判讀，
      // 讀不到時再退回檔名。監測日誌、時相圖、照片等工作表會自動略過。
      for (const name of book.SheetNames) {
        const values = readSheet(name);
        if (!armCodeOf(values, name)) continue;
        /*
         * 日別是資料的身分鍵之一（見 trafficIdentity）。表頭讀不到時退回
         * 檔名是既有行為，但**必須說出來**：一份表頭沒寫日別、檔名也沒有
         * 「假日」二字的假日調查檔會被判成平日，若同路段同方向已有平日
         * 資料，寫入時會直接覆蓋，而報告只說「覆蓋 N 筆」。
         */
        const headerDay = dayTypeOf(values) as DayType | "";
        if (!headerDay) dayFromFileName = true;
        const dt = headerDay || (file.name.includes("假日") ? "假日" : "平日");
        const found = dateOf(values, name);
        dateChecks.push({ file: file.name, sheet: name, found });
        usedSheets.push(name);
        parsed.push(
          ...stamp(
            parseTrafficSheetValues(values, dt, importQuarterKey, identity, {
              fileName: file.name,
              sheetName: name,
            }),
            found?.iso ?? "",
          ),
        );
      }
      if (dateChecks.length === before)
        dateChecks.push({ file: file.name, sheet: "", found: null });
      fileNotes.push({
        file: file.name,
        rows: parsed.length - rowsBefore,
        used: usedSheets,
        skipped: book.SheetNames.filter((n) => !usedSheets.includes(n)),
        dayFromFileName,
      });
      parsedCount += 1;
      setBusyProgress(`已讀完 ${parsedCount}／${files.length} 份`);
      await breathe();
    }
    return {
      records: resolveDestinationTurns(
        parsed,
        activeProject,
        intersectionSettings,
      ),
      dateChecks,
      fileNotes,
    };
  }

  async function importSelectedFiles(files: File[]) {
    if (!files.length) return;
    /*
     * .xlsm（啟用巨集的活頁簿）也要收。三支系統以前不一致：路口轉向與
     * 交通服務水準的檔案選取框都收 .xlsm、交通服務水準的說明文字還明寫
     * 「支援 .xls、.xlsx、.xlsm」，只有本系統擋掉並回「不是支援的 Excel 檔案」。
     * SheetJS 讀 .xlsm 與 .xlsx 走同一條路徑，沒有額外風險。
     */
    const invalid = files.find((file) => !/\.(xlsx?|xlsm)$/i.test(file.name));
    if (invalid) return setToast(`「${invalid.name}」不是支援的 Excel 檔案`);
    if (!activeProject) {
      setToast("請先建立並選擇計畫，再匯入季度資料");
      return;
    }
    setBusy(true);
    /*
     * ⚠️ 每一次新的匯入都要把上一次殘留的併入紀錄清掉。
     * 使用者上一次在檢核報告按了「取消」時，那一批併入不該留著——
     * 不清的話，下一次匯入成功時會把**上一次取消掉的**併入一併記成別名。
     */
    pendingAliasRef.current = new Map();
    try {
      const {
        records: parsedSource,
        dateChecks,
        fileNotes,
      } = await parseFiles(files);
      /*
       * 說不出原因的錯誤訊息等於沒有訊息。
       * 舊版只丟一句「找不到平日／假日交通量資料」：不指名哪個檔、不說為什麼
       *（工作表沒有路口編號標記？表頭找不到車種欄？時段格式不合？）、
       * 也不給補救方向，使用者只能瞎猜。
       */
      if (!parsedSource.length)
        throw new Error(
          "沒有讀到任何交通量資料：\n" +
            fileNotes
              .map(
                (note) =>
                  `・${note.file}：讀出 0 列。` +
                  (note.skipped.length
                    ? `已略過的工作表：${note.skipped.join("、")}。`
                    : "") +
                  "請確認工作表名稱含「平日」或「假日」，或表頭有「路口編號」標記與逐時段的車種計數欄位。",
              )
              .join("\n"),
        );
      /*
       * 部分檔案讀出 0 列時也要指名。這種情況最危險：流程會照常成功，
       * 使用者以為五個檔都進去了，實際只進了四個。
       */
      const emptyFiles = fileNotes.filter((note) => note.rows === 0);
      const guessedDayFiles = fileNotes.filter(
        (note) => note.rows > 0 && note.dayFromFileName,
      );
      const sourceCellWarnings = [
        ...new Set(
          parsedSource.flatMap((record) =>
            (record.sourceWarnings ?? []).map(
              (warning) =>
                `「${record.sourceFileName ?? "未命名檔案"}」` +
                `${record.sourceSheetName ? `【${record.sourceSheetName}】` : ""}${warning}`,
            ),
          ),
        ),
      ];
      /*
       * 支線數與「沒有這個轉向」的數量做算術核對。
       *
       * 一支支線只能去（支線數 − 1）個地方，調查表卻固定印同樣幾個轉向欄，
       * 兩者的差就是應該畫橫線的數量：三岔每支剛好 1 個、四岔 0 個。
       * 這是純算術，不依賴任何調查廠商的編號習慣（實測 37 份實檔完全符合）。
       *
       * 對不上通常是「該畫橫線的欄位被留成空白」或「表頭欄位被讀錯」。
       * 以前這種檔案會安靜通過。這裡只示警，不改動任何數值。
       */
      const armAuditWarnings = [
        ...new Set(
          [
            ...new Set(
              parsedSource
                .filter((record) => record.surveyType === "intersection")
                .map((record) => record.roadId),
            ),
          ].flatMap((roadId) => {
            const audits = auditArmTurns(parsedSource, roadId);
            if (audits.length < 3) return [];
            const mismatched = audits.filter(
              (audit) => audit.absent.length !== audit.expectedAbsent,
            );
            if (!mismatched.length) return [];
            const roadName =
              parsedSource.find((record) => record.roadId === roadId)
                ?.roadName ?? roadId;
            const detail = mismatched
              .map(
                (audit) =>
                  `路口${audit.directionCode}（應為 ${audit.expectedAbsent} 個，實際 ${audit.absent.length} 個${
                    audit.absent.length
                      ? "：" +
                        audit.absent.map((turn) => TURN_LABELS[turn]).join("、")
                      : ""
                  }）`,
              )
              .join("；");
            return [
              `「${roadName}」是 ${audits.length} 岔路口，每一支支線只能去 ${audits[0].destinationCount} 個地方，` +
                `所以每支應該剛好有 ${audits[0].expectedAbsent} 個轉向整欄畫橫線（「--」），但數量對不起來：${detail}。` +
                "可能是該畫橫線的欄位被留成空白，也可能是表頭的「路口編號：」被讀錯而讓欄位算到隔壁支線，請核對原始檔。" +
                "（這則只是提醒，不會改動任何數值。）",
            ];
          }),
        ),
      ];
      /*
       * 形狀檢查不夠：normalizeSurveyPeriod 只在民國 90～200 這個窗口內換算，
       * 超出窗口的四碼年份會原樣通過（例如 2112Q3），於是同一季會存成兩個鍵。
       * 改用共用的 checkSurveyPeriodInput()，並分開講「格式不對」與「超出範圍」。
       */
      const periodCheck = checkSurveyPeriodInput(importQuarter);
      if (!periodCheck.ok)
        throw new Error(surveyPeriodInputMessage(periodCheck.reason));
      /*
       * 這個計畫如果已經有「同一季、但用另一種寫法」的資料，要先擋下來。
       *
       * v20.39 以前季度是照使用者打的字原樣存的，而匯入框的預設值曾經是
       * 西元寫法（2026Q3），所以既有資料裡可能已經有 2026Q3。現在一律存成
       * 民國年，若不擋，同一季就會同時存在 2026Q3 與 115Q3 兩個鍵——
       * 它們的排序鍵完全相同，會在季度清單裡相鄰出現，看起來只像
       * 「同一季出現兩次」，歷季趨勢卻已經被拆成兩段而且永遠不會合併。
       */
      const clashing = quarters.find(
        (q) =>
          q !== importQuarterKey &&
          normalizeSurveyPeriod(q) === importQuarterKey,
      );
      if (clashing)
        throw new Error(
          `這個計畫裡已經有「${clashing}」，和你要匯入的「${importQuarterKey}」是同一季，只是寫法不同（民國年與西元年）。` +
            `本版起季度一律以民國年記錄，若直接寫入會變成兩個分開的季度，歷季趨勢也會被拆成兩段。` +
            /* ⚠️ 2026-09-17 起側欄沒有「品質與定稿」了（整項移除），
                指路要指到現在真的到得了的地方，否則使用者會找不到那一頁。 */
            `請先到「資料產出與維護 → 刪除單一季度」把「${clashing}」整季刪除後重新匯入，或改匯入其他季度。`,
        );
      const targetProjectId = await ensurePersistentProject();
      const parsed = parsedSource.map((r) => ({
        ...r,
        projectId: targetProjectId,
      }));
      const report = validateImport(parsed, activeRecords);
      /*
       * ══════════════════════════════════════════════════════════════
       *  轉向判定衝突也要進「需注意」清單
       * ══════════════════════════════════════════════════════════════
       *
       * 使用者 2026-09-13：「如果出現程式判讀有 2 支線落進同一個轉向，
       *   一定是判讀失誤，可以用醒目顏色提醒，**或納入匯入異常事件給使用者看到**。」
       *
       * ⚠️ 不擋匯入：本系統是先匯入、才在「路口設定」調角度，
       *   擋掉的話使用者連資料都看不到，反而更難修。
       *   量會掛在「未指定駛入路口」，帳面上看得見，總量不變。
       */
      for (const conflict of intersectionTurnConflicts(
        parsed,
        targetProjectId,
        intersectionSettings,
      ))
        report.warningItems.push({
          type: "路口轉向判定",
          text: describeTurnConflict(conflict),
        });
      if (!report.valid)
        throw new Error(report.invalidRows[0] ?? "匯入資料檢核失敗");
      /*
       * 定稿的季度一律擋下，不管是覆蓋既有列還是只追加新列。
       *
       * 舊寫法只在 replacedRows > 0 時擋。把另一個調查點匯進同一個已定稿的
       * 季度時 replacedRows 是 0，於是照樣寫進去，而下面又會無條件把狀態
       * 改回「草稿」——定稿等於自己解除了，畫面上沒有任何提示。
       */
      if ((workflow.statuses[importQuarterKey] ?? "草稿") === "定稿")
        throw new Error(
          /* ⚠️ 同上：指到「資料產出與維護 → 資料異常檢查摘要」那一塊（狀態在那裡改）。 */
          `${importQuarterKey} 已定稿，系統已阻擋${report.replacedRows ? "覆蓋" : "追加"}。請先在「資料產出與維護 → 資料異常檢查摘要」將狀態改回草稿或待確認。`,
        );
      // 檢核報告一跳出來就把「匯入季度資料」視窗收掉。
      // 兩個視窗疊在一起時，後面的匯入視窗會蓋住檢核報告的按鈕，
      // 使用者會以為匯入沒成功、又重選一次檔案。
      /*
       * 調查日期 × 期別檢查。判斷邏輯在 period-date.ts（三支程式同一份）。
       * 這裡只算結果放進檢核報告，**不阻擋**——讀不到日期只是提醒，
       * 對不起來才在按「確認匯入」時多問一次。
       */
      const periodChecks = dateChecks.map((item) =>
        checkPeriodAgainstDate(
          /* 用正規化後的值，訊息裡顯示的季度才會和實際寫入的一致。 */
          importQuarterKey,
          item.found,
          item.sheet ? item.file + "【" + item.sheet.trim() + "】" : item.file,
        ),
      );
      setShowImport(false);
      setPendingImport({
        files,
        parsedQuarter: importQuarterKey,
        dateChecks,
        records: parsed,
        report,
        periodChecks,
        fileWarnings: [
          ...emptyFiles.map(
            (note) =>
              `「${note.file}」讀出 0 列，不會有任何資料寫入。` +
              (note.skipped.length
                ? `已略過的工作表：${note.skipped.join("、")}。`
                : "") +
              "請確認工作表名稱與表頭格式。",
          ),
          ...guessedDayFiles.map(
            (note) =>
              `「${note.file}」的表頭讀不到「日期：…(平日／假日)」，日別是依檔名判定為${
                note.file.includes("假日") ? "假日" : "平日"
              }。日別是資料的身分鍵之一，判錯會讓資料寫到另一個日別、甚至覆蓋既有資料，請確認無誤。`,
          ),
          ...sourceCellWarnings,
          ...armAuditWarnings,
        ],
      });
      setBusy(false);
      return;
    } catch (e) {
      setToast(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      setBusyProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  /*
   * ── 橫跨中午的尖峰：狀態與輔助 ────────────────────────────
   *
   * ⚠️ 答案**存在每一筆紀錄上**（record.noonSide），不是存在計畫設定裡。
   *   存在設定裡的話，下次匯入別的季度時會沿用上一次的判斷——而使用者
   *   明確要求「每次都要問」。存在紀錄上則是：這一筆當初怎麼判定就固定
   *   怎麼算，日後回頭看也知道當時的決定是什麼。
   */
  type NoonChoice = "skip" | "ignore" | "am" | "pm";
  const [noonQuestions, setNoonQuestions] = useState<{
    items: NoonStraddle[];
    answers: Record<string, NoonChoice>;
  } | null>(null);
  /** 這一批要寫入的資料裡，有哪些橫跨中午的尖峰需要問。 */
  const pendingNoonStraddles = useCallback(
    (pending: NonNullable<typeof pendingImport>) => {
      const records = pending.records as unknown as PeriodRecord[];
      if (!records.length) return [];
      return buildPeriodAnalysis(records, {
        factors: {
          core: pcuFactors,
          coreTurns: turnPcuFactors,
          settings: vehicleClassSettings,
          scopes: pcuScopes,
        },
        /*
         * ⚠️ 這裡一律用 separateDays: true。
         *   匯入的一批檔案通常同時含平日與假日，而「這一天最忙的一小時」
         *   必須逐日別各問一次——合在一起算的話，假日的那個跨中午高峰
         *   會被平日的數字蓋掉，於是該問的沒問到。
         */
        separateDays: true,
      }).straddles;
    },
    [pcuFactors, turnPcuFactors, vehicleClassSettings, pcuScopes],
  );
  async function confirmPendingImport(noonResolved = false) {
    if (!pendingImport) return;
    if (!importQuarterKey) return setToast("請先填寫資料季度（例如 115Q2）。");
    /*
     * ── 使用者在確認視窗裡把季別改掉了 ──────────────────────
     *
     * 季別在解析時只是欄位、不參與計算，所以改季別＝把每一列的 quarter
     * 換掉就好。但**一定要再問一次**：這是資料要寫進哪一季，
     * 寫錯了事後從畫面上看不出來。
     *
     * ⚠️ 確認框要把**兩個季別都寫出來**。只寫「確定嗎」的確認框沒有資訊，
     *   按的人只會一直按確定。
     */
    if (importQuarterKey !== pendingImport.parsedQuarter) {
      const confirmed = confirm(
        `這批 ${pendingImport.files.length} 個檔案原本是在「${pendingImport.parsedQuarter}」之下解析的，` +
          `現在要整批寫進「${importQuarterKey}」。\n\n` +
          `如果你是選完檔才發現季別填錯、剛改好，按確定就對了。`,
      );
      if (!confirmed) return;
    }
    /*
     * 調查日期與所選季度對不起來時，寫入前再問一次。
     * 讀不到日期不會走到這裡（那種是 unknown，只在報告裡提醒）。
     *
     * ⚠️ 用**目前**的季別重算，不可以用 pendingImport.periodChecks——
     *   那是解析當下算的。使用者改完季別之後，舊的比對結果會說
     *   「日期和 114Q2 不符」，而他已經改成 114Q3 了，訊息是錯的。
     */
    const prompt = periodMismatchPrompt(livePeriodChecks);
    if (prompt && !confirm(prompt)) return;
    /*
     * ── 橫跨中午的尖峰小時：寫入前先問 ──────────────────────
     *
     * 使用者 2026-09-12：「匯入 > 程式一發現 > 詢問 > 確認後 > 立刻按照分類
     *   算出正確的上下午尖峰 然後就固定。之後不能因為確認過1次分類以後就固定，
     *   而是每次都發現相同情況時都要做詢問。」
     *
     * ⚠️ 問題要在**寫入之前**問，不是寫完再補問。寫完再問的話，中間那段時間
     *   系統裡會躺著一筆「上午尖峰可能少報了」的資料，而畫面上看不出來。
     *
     * ⚠️ 而且**每一次匯入都重新問**，不沿用上一次的答案——使用者的理由是
     *   「也有可能是檔案數值誤植」，上次的判斷不必然適用這一次的檔案。
     */
    const straddles = pendingNoonStraddles(pendingImport);
    if (straddles.length && !noonResolved) {
      setNoonQuestions({
        items: straddles,
        answers: Object.fromEntries(
          straddles.map((item: NoonStraddle) => [item.key, "ignore" as NoonChoice]),
        ),
      });
      return;
    }
    setBusy(true);
    try {
      const { files, report } = pendingImport;
      /*
       * 改過季別就把每一列重新貼上新的季別。
       * ⚠️ 這一步漏掉的話，寫入的 API 參數是新季別、但每一列裡的
       *   quarter 欄位還是舊的——同一筆資料兩個季別，而且看不出來。
       */
      const requoted =
        importQuarterKey === pendingImport.parsedQuarter
          ? pendingImport.records
          : pendingImport.records.map((record) => ({
              ...record,
              quarter: importQuarterKey,
            }));
      /*
       * 把使用者對「橫跨中午的尖峰」的決定寫進每一筆紀錄。
       *
       * ⚠️ 選「取消不匯入」的那個調查點**整個不寫入**（含它的每一個方向、
       *   每一個時段）——只丟掉一部分的話會留下一筆殘缺的資料，而殘缺的
       *   那一半在畫面上看不出來。
       */
      const noonChoice = noonQuestions?.answers ?? {};
      const parsed = requoted
        .filter((record) => {
          const key = noonStraddleKey(record.roadId, String(record.dayType ?? ""));
          return noonChoice[key] !== "skip";
        })
        .map((record) => {
          const key = noonStraddleKey(record.roadId, String(record.dayType ?? ""));
          const answer = noonChoice[key];
          return answer === "am" || answer === "pm" || answer === "ignore"
            ? { ...record, noonSide: answer }
            : record;
        });
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
        form.append("quarter", importQuarterKey);
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
          quarter: importQuarterKey,
          sourceObjectKeys: keys,
          records: parsed,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      vehicleSetup.commit();
      /* 這一批問完了就清掉——下一次匯入會重新發現、重新問。 */
      setNoonQuestions(null);
      /*
       * ── 把這次手動併入的檔名記成別名 ─────────────────────────
       *
       * 資料已經確定寫進去了才記——使用者在檢核報告按「取消」時，
       * 這一批併入不該留下任何痕跡。
       *
       * ⚠️ 別名寫入失敗**不可以讓整個匯入失敗**：資料已經進去了，
       * 這時候拋例外會讓使用者以為匯入沒成功而重做一次。
       * 失敗就在 toast 上說一聲，下一季他再挑一次而已。
       */
      const aliasAdditions = [...pendingAliasRef.current.entries()];
      pendingAliasRef.current = new Map();
      let aliasFailed = 0;
      for (const [, alias] of aliasAdditions) {
        try {
          const aliasRes = await appFetch("/api/roads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "alias",
              projectId: targetProjectId,
              roadId: alias.roadId,
              aliasName: alias.aliasName,
            }),
          });
          if (!aliasRes.ok) aliasFailed += 1;
        } catch {
          aliasFailed += 1;
        }
      }
      if (aliasAdditions.length) await refreshRoadAliases(targetProjectId);
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
        quarter: importQuarterKey,
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
        statuses: { ...previous.statuses, [importQuarterKey]: "草稿" },
        checkedQuarters: previous.checkedQuarters.filter(
          (item) => item !== importQuarterKey,
        ),
        history: [historyEntry, ...previous.history].slice(0, UNDO_KEEP),
      }));
      setQuarter(importQuarterKey);
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
      /*
       * 只有「還沒設定過幾何」的路口才需要跳視窗。
       *
       * 舊版是 parsed.find(surveyType === "intersection")：只要這一批裡有
       * 任何一筆路口資料就無條件打開「多支線角度、轉向圖與流向確認」。
       * 但角度與流向設定是存成（計畫、路口、支線）三層、**與季度無關**的，
       * 第一季設好之後每一季都沿用同一份——於是使用者第二季以後每次匯入
       * 都被這個視窗攔一次，而裡面沒有任何一項需要改（實測回報）。
       *
       * 舊寫法還有第二個問題：它只取**第一筆**路口。一次匯入三個新路口時，
       * 只會問第一個，另外兩個直接套預設角度、不會問也不會提示。
       * 改成把整批裡沒設定過的路口都算出來，跳第一個、並在訊息裡講清楚
       * 還有幾個要設定。
       */
      const needsSetup = unconfiguredIntersectionRoads(
        parsed,
        targetProjectId,
        intersectionSettings,
      );
      const firstNeedingSetup = needsSetup[0] ?? "";
      /*
       * ── 用調查表的橫線位置反推支線角度與流向，預填進確認視窗 ──
       *
       * 為什麼要做（實測）：三岔路口的**預設角度**是 [-90, 0, 180]，
       * 用它推出來的缺口是「A 沒有直進、B 沒有左轉、C 沒有右轉」；
       * 但三份真實三岔調查檔寫的是**完全相反的一組**
       *「A 沒有右轉、B 沒有直進、C 沒有左轉」。
       * 兩者對不起來的後果是 A 的直進車流沒有目的地、整批被歸到
       *「未指定駛入路口」——實測某三岔路口 AM 5,831 輛裡有 3,612 輛、
       * 62% 掉進去（總量守恆，但 OD 歸屬是錯的）。
       *
       * 反推只用兩個條件：調查表畫橫線的位置，加上「轉向互為對稱」
       *（A 直進到 B ⇔ B 直進到 A；A 左轉到 B ⇔ B 右轉到 A）。
       * 三岔由這兩個條件就解成唯一解；解不出唯一解時一律不預填。
       *
       * ⚠️ 預填**不等於**自動套用：視窗照樣會跳出來，使用者按下
       *    「儲存設定」才會存。這是使用者的明確要求。
       */
      const prefill: IntersectionArmSetting[] = [];
      const prefillNotes: Record<string, string> = {};
      for (const roadId of needsSetup) {
        const audits = auditArmTurns(parsed, roadId);
        const derived = deriveArmRoutesFromSurvey(audits);
        if (!derived) continue;
        const angles = anglesMatchingRoutes(derived);
        const codes = audits.map((audit) => audit.directionCode);
        codes.forEach((code, index) => {
          prefill.push({
            projectId: targetProjectId,
            roadId,
            directionCode: code,
            name: `路口${code}`,
            angle: angles?.[code] ?? defaultArmAngle(index, codes.length),
            routes: derived[code] ?? {},
          });
        });
        const missing = audits
          .filter((audit) => audit.absent.length)
          .map(
            (audit) =>
              `路口${audit.directionCode} 沒有${audit.absent
                .map((turn) => TURN_LABELS[turn])
                .join("、")}`,
          )
          .join("、");
        prefillNotes[roadId] =
          `系統已依這份調查表預填角度與流向：${missing}。` +
          "這是從調查表畫橫線的位置反推出來的（三岔路口由「轉向互為對稱」可解成唯一解），" +
          "**不是預設值**——請確認無誤後按「儲存設定」。";
      }
      setDerivedArmPrefill(prefill);
      setDerivedArmNotice(prefillNotes);
      if (vehicleSetup.addedCustom) {
        setVehicleClassDraft(
          vehicleSetup.settings.filter(
            (setting) => setting.projectId === targetProjectId,
          ),
        );
        setShowVehicleManager(true);
        setPendingIntersectionRoad(firstNeedingSetup);
      } else if (firstNeedingSetup) {
        setIntersectionManageRoad(firstNeedingSetup);
        setShowIntersectionManager(true);
      }
      const importedMessage = report.replacedRows
        ? `已更新 ${formatter.format(report.replacedRows)} 筆並建立可復原版本`
        : `已追加匯入 ${formatter.format(parsed.length)} 筆並建立可復原版本`;
      /*
       * 還有幾個路口沒設定過幾何，要講出來。
       * 視窗一次只開一個，不講的話使用者不會知道還有別的等著設定。
       */
      const pendingIntersectionNote =
        needsSetup.length > 1
          ? `；這批還有 ${needsSetup.length} 個路口尚未設定支線角度與流向，設定完第一個之後可在「道路與流向管理」接著設定其餘 ${needsSetup.length - 1} 個`
          : "";
      /*
       * 有預填就一定要講出來。預填了卻不講，使用者會以為那是系統的預設值，
       * 而預設值本來就與這些檔案矛盾——這正是要修的問題。
       */
      const prefillNote = Object.keys(prefillNotes).length
        ? `；已依調查表的橫線位置預填 ${Object.keys(prefillNotes).length} 個路口的支線角度與流向，請在「多支線角度、轉向圖與流向確認」確認後按「儲存設定」`
        : "";
      /*
       * ⚠️ 別名的結果要**併進這一則 toast**，不可以另外 setToast——
       * 這個函式結尾一定會再叫一次 setToast，先設的那一則會被無聲蓋掉。
       * （第一版就是這樣寫的，訊息永遠不會被看到。）
       */
      const aliasNote = aliasAdditions.length
        ? aliasFailed
          ? `；已記住 ${aliasAdditions.length - aliasFailed} 個檔名別名，${aliasFailed} 個沒存起來（下次匯入同名檔案仍會再問一次）`
          : `；已記住 ${aliasAdditions.length} 個檔名別名，下次匯入同名檔案會自動併入`
        : "";
      setToast(
        (vehicleSetup.addedCustom
          ? `${importedMessage}；新車種「${vehicleSetup.addedLabels.join("、")}」當量係數已預設為 ${NEW_VEHICLE_DEFAULT_PCU}，請於「車種分類與新增當量」調整`
          : importedMessage) +
          pendingIntersectionNote +
          prefillNote +
          aliasNote,
      );
    } catch (e) {
      setToast(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(false);
      setBusyProgress("");
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
  /**
   * 把「一個計畫」打包成備份物件。
   *
   * ⚠️ 抽出來是為了讓「備份本計畫」與「備份全部計畫」用**同一份**組裝邏輯。
   *   兩邊各寫一份的話，以後新增一個要備份的欄位（例如當初補上的
   *   conclusionTemplates），一定會有一邊忘記加——而備份少帶東西
   *   要等到換電腦還原時才會發現，那時原始電腦可能已經清掉了。
   *
   * 目前畫面上的那個計畫，資料本來就都在 state 裡；
   * 其他計畫的資料要先抓回來再傳進來（見 collectProjectBackup）。
   */
  function buildBackupPayload(input: {
    project: { name: string; code?: string; clientName?: string };
    projectId: string;
    records: TrafficRecord[];
    pcuScopes: PcuScopes;
    roadAliases: RoadAlias[];
    workflow: WorkflowState;
  }) {
    return {
      format: "traffic-analysis-backup",
      version: 5,
      exportedAt: new Date().toISOString(),
      project: {
        name: input.project.name,
        code: input.project.code ?? "",
        clientName: input.project.clientName ?? "",
      },
      pcuFactors,
      turnPcuFactors,
      /*
       * ── 依季別／路段的係數覆寫 ──────────────────────────
       *
       * 使用者 2026-09-10：「**這份設定要能被存檔匯出和匯入**」
       * 「計畫和計畫之間不能彼此干擾」。
       *
       * ⚠️ 這裡只帶**目前這個計畫**的覆寫（pcuScopes 本來就只有它的）。
       *   帶整份對照表出去的話，還原到另一台電腦會把別的計畫的係數
       *   一起塞進去——而那台電腦上的計畫代碼可能剛好撞名。
       *
       * ⚠️ 上面的 pcuFactors／turnPcuFactors **照舊原樣寫出**。
       *   那兩個欄位就是「全季別 × 全路段」那一組，舊版程式讀得到，
       *   讀到的就是預設係數——不會因為新增了覆寫而讀出奇怪的值。
       */
      pcuScopes: input.pcuScopes,
      vehicleClassSettings: vehicleClassSettings
        .filter((setting) => setting.projectId === input.projectId)
        .map(({ projectId: _projectId, ...setting }) => setting),
      roadAliases: input.roadAliases,
      intersectionSettings: intersectionSettings
        .filter((setting) => setting.projectId === input.projectId)
        .map(({ projectId: _projectId, ...setting }) => setting),
      workflow: input.workflow,
      /*
       * 結論草稿的「條件範本」也要跟著備份走。
       *
       * 它存在 localStorage 的 traffic-conclusion-templates-v1（依計畫分開），
       * 而備份原本沒有收——使用者在 A 電腦存好幾組常用條件，匯出備份帶到
       * B 電腦還原之後，範本一個都不在，而畫面只會說「還原完成」。
       * 那些條件是使用者自己一項一項勾出來的，重建很花時間。
       */
      conclusionTemplates: readConclusionTemplates(input.projectId),
      records: input.records.map(
        ({ projectId: _projectId, ...record }) => record,
      ),
    };
  }
  /** 把物件變成下載檔。三個備份按鈕共用，檔名規則只寫一次。 */
  const [hasDownloadedBackup, setHasDownloadedBackup] = useState(false);

  /*
   * ── 清除本機資料 ────────────────────────────────────────────
   *
   * ⚠️ 刪除要走**和刪除單一計畫同一條路徑**（DELETE /api/projects/:id
   *   ＋ deleteWorkflow），不可以自己去砍 IndexedDB。
   *   自己砍的話，日後新增一種依計畫存放的資料時，刪除單一計畫那一條會
   *   被更新、這一條不會——而漏掉的殘留完全沒有跡象。
   *
   * ⚠️ 最後一定要重新整理。這支程式有十幾個 state 是開頁時一次讀進來的，
   *   清完只改 state 的話，畫面會停在一個「資料已經沒了、記憶體裡還有」
   *   的半清除狀態，而使用者看不出來。
   */
  async function clearLocalData() {
    /*
     * ② 沒下載過完整備份先提醒一次——只提醒，不禁止。
     *
     * ⚠️ 條件要看**計畫或資料**，不可以只看 records。
     *   一個剛建好、還沒匯入資料的計畫也是使用者花時間設定過的東西
     *  （計畫編號、業主、車種分類、當量），只看 records 的話這種情況
     *   完全不提醒就清掉了。
     */
    if ((projects.length || records.length) && !hasDownloadedBackup) {
      if (
        !window.confirm(
          "這次開啟程式之後還沒有下載過備份。\n\n" +
            "清除之後沒有任何方式可以救回來。\n" +
            "要先關掉這個視窗、去上面按「備份全部計畫」嗎？\n\n" +
            "（按「確定」＝我知道，繼續清除；按「取消」＝先去備份）",
        )
      ) {
        setToast("已取消，資料沒有變動。請先下載一份完整備份。");
        return;
      }
    }
    /* ① 確認視窗要寫出代價。 */
    /*
     * ⚠️ 只數得出**目前這個計畫**的定稿季度。
     *   其他計畫的工作流程狀態存在 IndexedDB 裡，要一個一個 await 才讀得到，
     *   而這裡是確認視窗前的同步路徑。所以文字要寫「目前計畫」，
     *   不可以寫成「全部」——講得比實際多，比不講更糟。
     */
    const finalizedCount = Object.values(workflow.statuses).filter(
      (state) => state === "定稿",
    ).length;
    if (
      !window.confirm(
        "確定清除這個瀏覽器裡的全日交通量資料？\n\n" +
          `將刪除 ${projects.length} 個計畫、${records.length} 筆交通量資料` +
          (finalizedCount
            ? `（目前這個計畫有 ${finalizedCount} 個季度已定稿）`
            : "") +
          "，\n以及 PCU 當量、車種分類、路段與流向設定、結論範本、" +
          "工作流程狀態與匯入紀錄。\n\n" +
          "此動作無法復原。",
      )
    )
      return;
    setBusy(true);
    try {
      for (const project of projects) {
        await appFetch(`/api/projects/${encodeURIComponent(project.id)}`, {
          method: "DELETE",
        }).catch(() => undefined);
        await deleteWorkflow(project.id).catch(() => undefined);
        dropProjectScopedStorage(project.id);
      }
      /*
       * 所有計畫共用的那幾個鍵。
       * ⚠️ 用前綴掃，不要逐一列舉——逐一列舉的話，日後新增一個
       *   traffic-* 的鍵而忘了加進來，它就會永遠留在這台電腦上，
       *   而且「全部清除」四個字明寫著它應該被清掉。
       */
      try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const key = localStorage.key(i);
          if (key && key.startsWith("traffic-")) keys.push(key);
        }
        for (const key of keys) localStorage.removeItem(key);
      } catch {
        /* 無痕視窗或封鎖網站資料時讀不到 localStorage，忽略即可。 */
      }
      window.location.reload();
    } catch (error) {
      setBusy(false);
      setToast(error instanceof Error ? error.message : "清除失敗");
    }
  }

  function downloadJson(payload: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(payload)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  function exportBackup() {
    downloadJson(
      buildBackupPayload({
        project: selectedProject,
        projectId: activeProject,
        records: activeRecords,
        pcuScopes,
        roadAliases,
        workflow,
      }),
      `${selectedProject.name}_交通量完整備份_${today()}.json`,
    );
    setToast("已匯出可跨電腦還原的完整備份");
  }
  /*
   * ══════════════════════════════════════════════════════════════════
   *  備份全部計畫
   * ══════════════════════════════════════════════════════════════════
   *
   * 使用者 2026-09-11：「我可以匯出單一計畫作備份、匯出這程式下面我全部
   * 計畫作備份，以及也能在這邊匯入備份檔作還原」——三支程式要一致，
   * 路口轉向早就有這三件事，這一支只有「本計畫」。
   *
   * ⚠️ 不可以直接拿畫面上的 state 來包。
   *   records／roadAliases／workflow 都是**只載入目前這個計畫**的
   *   （見上面那幾個 useEffect），直接包出去的話，其他計畫會全部是空的，
   *   而檔案看起來大小正常、還原也不會報錯——是最難發現的那種錯。
   *   所以這裡要一個一個把資料抓回來。
   *
   * ⚠️ intersectionSettings／vehicleClassSettings 是**全部計畫共用一份**
   *   localStorage 陣列（各自帶 projectId），buildBackupPayload 會依
   *   projectId 過濾，不必另外抓。
   */
  /*
   * 這次開啟程式之後有沒有下載過「全部計畫」的備份。
   *
   * ⚠️ 刻意**不寫進 localStorage**：寫進去的話，三個月前備份過一次
   *   就會讓提醒永遠不再出現——而那份備份早就過期了。這個旗標要問的是
   *   「你手上有沒有一份現在的備份」，所以每次重新開啟都從頭算。
   * ⚠️ 也刻意只認**全部計畫**的備份：清除是全機的，
   *   只備份了單一計畫不足以救回來。
   */
  async function exportAllBackup() {
    if (!projects.length) {
      setToast("目前沒有任何計畫可以備份");
      return;
    }
    setHasDownloadedBackup(true);
    setBusy(true);
    try {
      const ids = projects.map((p) => p.id);
      const trafficResponse = await appFetch(
        `/api/traffic?projectIds=${encodeURIComponent(ids.join(","))}`,
      );
      const trafficData = trafficResponse.ok
        ? await trafficResponse.json()
        : null;
      const allRows: TrafficRecord[] = Array.isArray(trafficData?.rows)
        ? trafficData.rows
        : [];
      const bundles = [];
      for (const project of projects) {
        const roadsResponse = await appFetch(
          `/api/roads?projectId=${encodeURIComponent(project.id)}`,
        );
        const roadsData = roadsResponse.ok ? await roadsResponse.json() : null;
        bundles.push(
          buildBackupPayload({
            project,
            projectId: project.id,
            records: allRows.filter((row) => row.projectId === project.id),
            pcuScopes: readProjectPcuScopes(project.id),
            roadAliases: Array.isArray(roadsData?.aliases)
              ? roadsData.aliases
              : [],
            workflow: await loadWorkflow(project.id),
          }),
        );
      }
      downloadJson(
        {
          format: "traffic-analysis-backup-all",
          version: 1,
          exportedAt: new Date().toISOString(),
          projectCount: bundles.length,
          projects: bundles,
        },
        `全部計畫_交通量完整備份_${today()}.json`,
      );
      setToast(`已匯出 ${bundles.length} 個計畫的完整備份`);
    } catch {
      setToast("備份全部計畫失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  }
  /**
   * 備份檔裡每一筆紀錄的欄位檢查。
   *
   * ⚠️ 單一計畫與全部計畫兩條還原路徑**一定要共用這一份**。
   *   兩邊各寫一份檢查，遲早會有一條路的檢查比較鬆——而壞資料一旦寫進
   *   資料庫，畫面會整片變白且重新整理也回不來（整支程式沒有 error boundary）。
   *   回傳的是「可以寫進去的紀錄」，季度寫法也在這裡統一成民國季。
   */
  function validateBackupRecords(
    records: unknown,
    where: string,
  ): TrafficRecord[] {
    if (!Array.isArray(records) || !records.length)
      throw new Error(`${where}沒有可匯入的季度資料`);
    const REQUIRED_TEXT: Array<keyof TrafficRecord> = [
      "quarter",
      "roadId",
      "roadName",
      "dayType",
      "directionCode",
      "hour",
    ];
    const badIndex = records.findIndex((r) =>
      REQUIRED_TEXT.some(
        (field) =>
          typeof (r as Record<string, unknown>)[field] !== "string" ||
          !String((r as Record<string, unknown>)[field]).trim(),
      ),
    );
    if (badIndex >= 0)
      throw new Error(
        `${where}第 ${badIndex + 1} 筆資料缺少必要欄位（${REQUIRED_TEXT.join("、")}），為避免損壞既有資料已停止還原`,
      );
    return (records as TrafficRecord[]).map((r, index) => {
      const check = checkSurveyPeriodInput(String(r.quarter));
      if (!check.ok)
        throw new Error(
          `${where}第 ${index + 1} 筆資料的季度「${r.quarter}」無法還原：` +
            surveyPeriodInputMessage(check.reason),
        );
      return {
        ...r,
        quarter: normalizeSurveyPeriod(String(r.quarter)),
        roadId: normalizeRoadId(r.roadId),
      };
    });
  }
  /*
   * ══════════════════════════════════════════════════════════════════
   *  還原「全部計畫」的備份
   * ══════════════════════════════════════════════════════════════════
   *
   * ⚠️ 這條路徑**只新增，不覆蓋任何既有計畫**。
   *
   *   這是刻意的取捨，不是偷懶：要「完整取代」就得先刪掉這台電腦上所有
   *   計畫，而一旦中途失敗（網路、儲存空間、備份檔某一筆壞掉），
   *   使用者會同時失去舊資料與新資料。備份的意義就是不要有那種可能。
   *   要換掉舊的，使用者自己刪除舊計畫即可——刪除有確認視窗，
   *   而且是他明確決定的動作。
   *
   * ⚠️ 還原完成後**重新整理頁面**。
   *   這一段寫的是「持久層」（資料庫＋localStorage），畫面上的 state
   *   只載入目前那一個計畫。不重新整理的話，畫面顯示的與存起來的會不一致，
   *   而使用者看到的是「還原完成」——那種不一致最難查。
   */
  async function restoreAllProjects(bundles: unknown[]) {
    const existingNames = new Set(projects.map((p) => p.name.trim()));
    let restoredCount = 0;
    /*
     * ⚠️ 這兩個累加器**一定要放在迴圈外面**，而且中途不可以讀
     *   vehicleClassSettings／intersectionSettings 這兩個 state 變數。
     *
     * 第一版是在迴圈裡寫 `[...vehicleClassSettings, ...新的]` 再
     * safeWrite——但 vehicleClassSettings 是這個 async 函式一開始就
     * 被閉包鎖住的舊值，setState 之後它不會變。於是還原第二個計畫時，
     * 又從「原始那一份」接一次，把第一個計畫剛加進去的設定整組蓋掉。
     *
     * 實測（e2e-backup-restore.mjs 第 ⑥ 段）：還原兩個計畫後，
     * 先還原的那一個 vehicleClassSettings 變成 []，後還原的正常——
     * 而筆數、季度、PCU 係數全部正確，只有車種分類默默不見了。
     * 這種錯不會報任何訊息，要到使用者發現車種歸類跑掉才會知道。
     */
    let nextVehicleClass = vehicleClassSettings;
    let nextIntersection = intersectionSettings;
    for (const raw of bundles) {
      const bundle = raw as {
        project?: { name?: string; code?: string; clientName?: string };
        records?: unknown;
        pcuFactors?: PcuFactors;
        turnPcuFactors?: TurnPcuFactors;
        pcuScopes?: unknown;
        vehicleClassSettings?: Omit<VehicleClassSetting, "projectId">[];
        roadAliases?: RoadAlias[];
        intersectionSettings?: Omit<IntersectionArmSetting, "projectId">[];
        workflow?: WorkflowState;
        conclusionTemplates?: ConclusionTemplate[];
      };
      const baseName = (bundle.project?.name || "").trim() || "還原的計畫";
      /*
       * 同名時加上還原日期，不要蓋掉也不要靜靜地合併。
       * 使用者一眼就能看出哪一個是剛還原進來的。
       */
      let name = baseName;
      if (existingNames.has(name)) name = `${baseName}（還原 ${today()}）`;
      let suffix = 2;
      while (existingNames.has(name)) {
        name = `${baseName}（還原 ${today()}-${suffix}）`;
        suffix += 1;
      }
      existingNames.add(name);
      const rows = validateBackupRecords(
        bundle.records,
        `備份檔中的計畫「${baseName}」`,
      );
      const created = await appFetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          code: (bundle.project?.code || "").trim(),
          clientName: (bundle.project?.clientName || "").trim(),
        }),
      });
      const createdData = await created.json();
      if (!created.ok)
        throw new Error(createdData.error || `建立計畫「${name}」失敗`);
      const newId: string = createdData.project.id;
      for (const quarter of [...new Set(rows.map((r) => r.quarter))]) {
        const response = await appFetch("/api/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: newId,
            quarter,
            sourceObjectKeys: [],
            records: rows
              .filter((r) => r.quarter === quarter)
              .map((r) => ({ ...r, projectId: newId })),
          }),
        });
        if (!response.ok)
          throw new Error(
            (await response.json()).error || `計畫「${name}」的 ${quarter} 還原失敗`,
          );
      }
      for (const alias of bundle.roadAliases ?? []) {
        await appFetch("/api/roads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "alias",
            projectId: newId,
            roadId: alias.roadId,
            aliasName: alias.aliasName,
          }),
        });
      }
      if (bundle.pcuFactors) writeProjectPcuFactors(newId, bundle.pcuFactors);
      if (bundle.turnPcuFactors)
        writeProjectTurnPcuFactors(newId, bundle.turnPcuFactors);
      writeProjectPcuScopes(
        newId,
        Array.isArray(bundle.pcuScopes)
          ? ((bundle.pcuScopes as unknown[]).filter(isValidScope) as PcuScopes)
          : [],
      );
      if (bundle.conclusionTemplates?.length)
        writeConclusionTemplates(newId, bundle.conclusionTemplates);
      if (bundle.workflow) await saveWorkflow(newId, bundle.workflow);
      /*
       * 車種設定與路口幾何是「全部計畫共用一份陣列、各自帶 projectId」，
       * 所以是**接上去**而不是取代——取代會把這台電腦上其他計畫的設定清掉。
       */
      if (bundle.vehicleClassSettings?.length)
        nextVehicleClass = [
          ...nextVehicleClass,
          ...bundle.vehicleClassSettings.map((setting) => ({
            ...setting,
            projectId: newId,
          })),
        ];
      if (bundle.intersectionSettings?.length)
        nextIntersection = [
          ...nextIntersection,
          ...bundle.intersectionSettings.map((setting) => ({
            ...setting,
            projectId: newId,
          })),
        ];
      restoredCount += 1;
    }
    /* 全部計畫都處理完之後才寫一次，累加的結果才不會互相覆蓋。 */
    if (nextVehicleClass !== vehicleClassSettings) {
      setVehicleClassSettings(nextVehicleClass);
      safeWrite("traffic-vehicle-class-settings-v1", nextVehicleClass);
    }
    if (nextIntersection !== intersectionSettings) {
      setIntersectionSettings(nextIntersection);
      safeWrite("traffic-intersection-settings-v1", nextIntersection);
    }
    return restoredCount;
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
        /* 依季別／路段的係數覆寫；舊備份沒有這個欄位。 */
        pcuScopes?: unknown;
        vehicleClassSettings?: Omit<VehicleClassSetting, "projectId">[];
        roadAliases?: RoadAlias[];
        intersectionSettings?: Omit<IntersectionArmSetting, "projectId">[];
        workflow?: WorkflowState;
        conclusionTemplates?: ConclusionTemplate[];
      };
      /*
       * ── 兩種備份檔 ────────────────────────────────────────────
       *   traffic-analysis-backup      = 一個計畫（舊有格式，不變）
       *   traffic-analysis-backup-all  = 全部計畫（2026-09-11 新增）
       * 使用者不必自己分辨拿到的是哪一種，系統自己看 format 走對應的路。
       */
      const allBundles = (payload as { projects?: unknown[] }).projects;
      if (payload.format === "traffic-analysis-backup-all") {
        if (!Array.isArray(allBundles) || !allBundles.length)
          throw new Error("這份「全部計畫」備份檔裡沒有任何計畫");
        if (
          !window.confirm(
            `這份備份含 ${allBundles.length} 個計畫。\n\n` +
              "還原會「新增」這些計畫，不會覆蓋或刪除這台電腦上原有的計畫；" +
              "名稱相同時會加上還原日期以便分辨。\n\n要繼續嗎？",
          )
        )
          return;
        const count = await restoreAllProjects(allBundles);
        setToast(`已還原 ${count} 個計畫，正在重新載入畫面…`);
        /*
         * ⚠️ 一定要重新整理。上面寫的是資料庫與 localStorage，
         *   而畫面上的 state 只載入目前那一個計畫；不重新整理的話，
         *   使用者會看到「還原完成」但畫面上什麼都沒變。
         */
        window.setTimeout(() => window.location.reload(), 900);
        return;
      }
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
      const badQuarterIndex = payload.records.findIndex(
        (r) => !checkSurveyPeriodInput(String(r.quarter)).ok,
      );
      if (badQuarterIndex >= 0) {
        const badQuarter = String(payload.records[badQuarterIndex].quarter);
        const check = checkSurveyPeriodInput(badQuarter);
        throw new Error(
          `備份檔第 ${badQuarterIndex + 1} 筆資料的季度「${badQuarter}」無法還原：` +
            (!check.ok
              ? surveyPeriodInputMessage(check.reason)
              : "季度格式不正確"),
        );
      }
      /*
       * 備份可能來自尚未統一儲存格式的舊版。合法的 2026Q1 必須在寫回前
       * 轉成 115Q1；不能只拿共用函式做 filter 後仍把原字串寫進資料庫。
       * 也不能靜靜濾掉壞季度，否則一份混有好壞資料的備份會只還原一部分，
       * 畫面卻回報成功。
       */
      const source = payload.records.map((r) => {
        const check = checkSurveyPeriodInput(String(r.quarter));
        return {
          ...r,
          quarter: check.ok ? check.key : String(r.quarter).toUpperCase(),
          roadId: normalizeRoadId(r.roadId),
        };
      });
      if (!source.length) throw new Error("備份檔內沒有可匯入的季度資料");
      /*
       * 還原過程可能同時遇到多個 localStorage 寫入失敗。不要在途中直接
       * setToast 後又被最後的「還原完成」蓋掉；先累積，最後一次說完整。
       */
      const restoreWarnings: string[] = [];
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
      const existingQuarterByKey = new Map(
        quarters.map((item) => [normalizeSurveyPeriod(item), item]),
      );
      const alternateWriting = incomingQuarters.find((item) => {
        const existing = existingQuarterByKey.get(item);
        return existing && existing !== item;
      });
      if (alternateWriting) {
        const existing = existingQuarterByKey.get(alternateWriting);
        throw new Error(
          `這個計畫裡已經有「${existing}」，和備份中的「${alternateWriting}」是同一季、但寫法不同。` +
            "為避免形成兩個季度，請先刪除既有季度或改用不含該季度的備份。",
        );
      }
      const overlaps = incomingQuarters.filter((q) =>
        existingQuarterByKey.has(q),
      );
      /*
       * 匯入 Excel 的路徑會擋下已定稿的季度，還原備份的路徑以前不會——
       * 同一個鎖，一條路擋得住、另一條走得過去，等於沒有鎖。
       */
      const finalized = overlaps.filter(
        (q) => (workflow.statuses[q] ?? "草稿") === "定稿",
      );
      if (finalized.length)
        throw new Error(
          /* ⚠️ 同上。 */
          `${finalized.join("、")} 已定稿，系統已阻擋還原覆蓋。請先在「資料產出與維護 → 資料異常檢查摘要」將狀態改回草稿或待確認。`,
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
        /* 還原進來的係數就是這個計畫自己的設定；不更新這個旗標的話，
           PCU 面板會一直寫著「本計畫尚未自行設定，目前使用系統預設值」，
           但畫面上的數字其實已經是備份裡的係數了。 */
        setProjectHasOwnFactors(true);
        /*
         * 一定要用 targetProjectId，不能用 activeProject——理由與上面
         * 4680 行那段註解相同：計畫可能是本函式剛剛自動建立的，
         * setActiveProject 還沒生效，activeProject 此時是空字串。
         */
        if (!writeProjectPcuFactors(targetProjectId, restored))
          restoreWarnings.push("路段PCU係數未存入瀏覽器，重新整理後會退回原值");
      }
      // 轉向係數比照載入時的檢查：4 車種 × 3 轉向共 12 個有效數字才採用。
      // 否則壞掉的備份會把 localStorage 汙染成載入時會被拒絕的內容，
      // 造成畫面上的值與儲存的值永久不一致。
      const restoredTurn = payload.turnPcuFactors as TurnPcuFactors | undefined;
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
        /* 同上，必須是 targetProjectId。 */
        if (!writeProjectTurnPcuFactors(targetProjectId, restoredTurn))
          restoreWarnings.push("轉向PCU係數未存入瀏覽器，重新整理後會退回原值");
      } else if (payload.turnPcuFactors) {
        restoreWarnings.push(
          "備份中的轉向PCU係數不完整，已保留目前設定；請確認後於「PCU當量係數」重新輸入",
        );
      }
      /*
       * ── 還原依季別／路段的覆寫 ──────────────────────────
       *
       * ⚠️ 三件事一定要同時成立：
       *   ① 寫到 **targetProjectId**，不是 activeProject（計畫可能是本函式
       *     剛建立的，React 狀態還沒更新，activeProject 此時是空字串）
       *   ② **逐筆驗證**：壞掉的覆寫會安靜地把某一季某一段的 PCU 變成
       *     另一個數字，比沒有覆寫危險得多
       *   ③ 舊備份**沒有**這個欄位——那時要留下空陣列，不是保留目前計畫的
       *     覆寫。保留的話，把 A 計畫的備份還原到 B 計畫上，B 的覆寫會殘留，
       *     而畫面會宣稱這些是還原進來的
       */
      const restoredScopes = Array.isArray(payload.pcuScopes)
        ? (payload.pcuScopes as unknown[]).filter(isValidScope)
        : [];
      const droppedScopes = Array.isArray(payload.pcuScopes)
        ? (payload.pcuScopes as unknown[]).length - restoredScopes.length
        : 0;
      setPcuScopes(restoredScopes);
      if (!writeProjectPcuScopes(targetProjectId, restoredScopes))
        restoreWarnings.push(
          "依季別／路段的係數設定未存入瀏覽器，重新整理後會退回原值",
        );
      if (droppedScopes)
        restoreWarnings.push(
          `備份中有 ${droppedScopes} 組依季別／路段的係數格式不正確，已略過（那些範圍會套用計畫預設係數）`,
        );
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
          restoreWarnings.push("車種分類設定未存入瀏覽器");
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
          restoreWarnings.push("路口設定未存入瀏覽器");
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
            /* 還原時 history 也要套用和其他寫入處一致的上限（UNDO_KEEP）：
       每一筆都含匯入前後兩份完整的計畫資料，無上限累加會讓
       IndexedDB 與匯出的備份檔等比膨脹。 */
            history: [...base.history, ...(incoming.history ?? [])].slice(
              0,
              UNDO_KEEP,
            ),
          };
        });
      }
      /*
       * 條件範本：備份裡有就併進來（同名視為同一組，以備份為準）。
       * 用併入而不是覆蓋，因為使用者可能已經在這台電腦存過別的範本，
       * 還原一份舊備份不該把它們清掉。
       */
      if (
        Array.isArray(payload.conclusionTemplates) &&
        payload.conclusionTemplates.length
      ) {
        const existing = readConclusionTemplates(targetProjectId);
        /* 還原備份時的同名合併，鍵同樣要過 typedNameKey()，理由同上。 */
        const byName = new Map(
          existing.map((item) => [typedNameKey(item.name), item]),
        );
        for (const item of payload.conclusionTemplates)
          if (item && typeof item.name === "string")
            byName.set(typedNameKey(item.name), item);
        const merged = [...byName.values()];
        if (!writeConclusionTemplates(targetProjectId, merged))
          restoreWarnings.push("結論條件範本未存入瀏覽器");
        setConclusionTemplates(merged);
      }
      await refreshRoadAliases(targetProjectId);
      setQuarter(restoredQuarters.sort(compareQuarters).at(-1) ?? quarter);
      setShowImport(false);
      setToast(
        restoreWarnings.length
          ? `已還原 ${restoredQuarters.length} 個季度，但有 ${restoreWarnings.length} 項瀏覽器設定未完整保存：${restoreWarnings.join("；")}。請先匯出備份並清理瀏覽器儲存空間。`
          : `已還原 ${restoredQuarters.length} 個季度，資料已永久保存`,
      );
    } catch (error) {
      /*
       * JSON.parse 的訊息是英文的瀏覽器內部字串（例如
       * "Expected property name or '}' in JSON at position 1"），
       * 對使用者沒有意義。這種情況改成講人話。
       */
      const message = error instanceof Error ? error.message : "備份匯入失敗";
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
    const rawNext = quarterDraft.trim().toUpperCase();
    const renameCheck = checkSurveyPeriodInput(rawNext);
    if (!renameCheck.ok)
      return setToast(surveyPeriodInputMessage(renameCheck.reason));
    const next = renameCheck.key;
    if (next === quarter) return setToast("季度名稱沒有變動。");
    const clashing = quarters.find(
      (item) => item !== quarter && normalizeSurveyPeriod(item) === next,
    );
    if (clashing)
      return setToast(
        `${showQuarter(clashing)} 已存在，請先清除或改用其他名稱`,
      );
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
      setToast(
        `季度已改為 ${showQuarter(next)}` +
          (rawNext !== next ? `（資料以民國年 ${next} 儲存）` : ""),
      );
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
      /* 剛好只勾一條時就管那一條；沒勾或勾了多條就用清單第一條 */
      soloRoadId ?? roadManagerRows[0]?.roadId;
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
      /* 被合併掉的調查點若正被勾著，改指向合併後的目標（去重） */
      setRoadFilters((prev) =>
        prev.includes(source.roadId)
          ? [
              ...new Set(
                prev.map((id) => (id === source.roadId ? target.roadId : id)),
              ),
            ]
          : prev,
      );
      /* 車種組成與歷季分析都改吃共同功能列，roadFilters 在上面一起換掉了。 */
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
      soloRoadId && intersectionManagerRows.some((r) => r.roadId === soloRoadId)
        ? soloRoadId
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
  /*
   * 使用者在表格裡改一格轉向。
   *
   * ⚠️ 同時把這一格記成 "manual"——這是「以使用者判定為主」的關鍵：
   *   沒有這一筆的話，下一次有人動任何一支的角度，這個修正就沒了。
   */
  function updateArmRoute(
    directionCode: string,
    targetCode: string,
    movement: TurnKey,
  ) {
    if (!managedIntersection) return;
    const mapped = managedArmSettings.map((setting) =>
      setting.directionCode === directionCode
        ? {
            ...setting,
            routes: { ...setting.routes, [targetCode]: movement },
            routeSources: {
              ...(setting.routeSources ?? {}),
              [targetCode]: "manual" as const,
            },
          }
        : setting,
    );
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
  /*
   * ⚠️ 舊版這裡把**整個路口所有支線的 routes 全部重建**，
   *   所以改一支的角度會把使用者在別支線做過的人工修正默默抹掉——
   *   與使用者要求的「以使用者判定為主」完全相反。
   *
   *   現在走 reclassifyArmRoutes()：只重算標成 "angle" 的格子。
   */
  function updateArmAngle(directionCode: string, angle: number) {
    if (!managedIntersection || !Number.isFinite(angle)) return;
    const angled = managedArmSettings.map((setting) =>
      setting.directionCode === directionCode ? { ...setting, angle } : setting,
    );
    const mapped = reclassifyArmRoutes(angled);
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
  /*
   * 「依角度重新判定」這顆鈕是使用者**明確要求重來一次**，
   * 所以 force=true，連人工修正過的格子也一起重算。
   * ⚠️ 提示文字要講明這件事，否則使用者會以為自己的修正還在。
   */
  function autoMapIntersection() {
    if (!managedIntersection) return;
    const mapped = reclassifyArmRoutes(managedArmSettings, true);
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
    setToast("已依角度重新判定全部轉向（含先前人工修正過的）；仍可逐筆再改");
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
    setToast("路口角度與轉向判定已儲存，駛入／駛出分析同步更新");
  }
  /**
   * 刪除**指定**的那一季。
   *
   * ⚠️ X-48（使用者 2026-09-16）：「資料維護這一分頁所有功能都不會受到
   *   主工具列的影響」。所以資料維護頁上的刪除要能挑季度，不可以只刪
   *   主工具列現在選的那一季——那正是使用者最怕的「我以為我篩的是 A，
   *   結果動到的是 B」。舊的 deleteQuarter() 留著給「管理季度」視窗用，
   *   兩邊走同一段程式，行為不會分岔。
   */
  async function deleteQuarterKey(target: string) {
    /*
     * ⚠️ 已定稿的季度**擋下來**，不是警告一下就放行。
     *
     * 使用者 2026-09-11 問「清除本季資料是否三支都有」，查證時發現
     * 這一支的定稿鎖有破口：匯入 Excel 會擋（6986 行）、還原備份會擋
     * （7870 行），**只有清除這一條路是警告完照刪**。
     *
     * 同一個鎖，兩條路擋得住、第三條走得過去，等於沒有鎖——而且最糟的是
     * 走得過去的那一條是**不可復原**的那一條。要清就先把狀態改回草稿，
     * 那是一個明確的決定，而不是在確認視窗裡多看一行小字。
     */
    if ((workflow.statuses[target] ?? "草稿") === "定稿") {
      setToast(
        `${showQuarter(target)} 已定稿，系統已阻擋清除。請先把「資料狀態」改回草稿或待確認。`,
      );
      return;
    }
    if (
      !window.confirm(
        `確定清除「${selectedProject.name}」的 ${showQuarter(target)} 分析資料？` +
          "\n\n此動作無法復原；原始上傳檔仍會保留供追溯。",
      )
    )
      return;
    setBusy(true);
    try {
      const res = await appFetch("/api/quarters", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: activeProject, quarter: target }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const oldQuarter = target,
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
      if (quarter === oldQuarter) setQuarter(remaining.at(-1) ?? "");

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
        history: [reverse, ...previous.history].slice(0, UNDO_KEEP),
        statuses: { ...previous.statuses, [entry.quarter]: "草稿" },
      }));
      setToast("已還原匯入前版本，並保留反向復原紀錄");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "版本還原失敗");
    } finally {
      setBusy(false);
    }
  }
  /*
   * ── 維護入口（畫面上已經沒有「版本差異與還原」）──────────────
   *
   * 使用者 2026-09-16：「如果你維護有用到，就隱藏在程式碼給你自己看就好」。
   *
   * ⚠️ 不可以把 restoreHistory 一起刪掉——刪掉就真的救不回來了。
   * ⚠️ deleteSourceFile（依來源檔刪除單筆／單檔）已依使用者裁示**整個移除**：
   *   「長期累積下來，這些會很長串，所以寧願捨棄，保留刪除單一季度功能就可以了」。
   */
  useEffect(() => {
    const host = globalThis as unknown as Record<string, unknown>;
    host.N2064UndoList = () =>
      workflow.history.map((entry) => ({
        id: entry.id,
        importedAt: entry.importedAt,
        quarter: entry.quarter,
        files: entry.files,
        rowCount: entry.rowCount,
      }));
    host.N2064UndoRestore = (id: string) => {
      const entry = workflow.history.find((item) => item.id === id);
      if (!entry) return "找不到這個還原點";
      return restoreHistory(entry);
    };
  });
  function saveComparisonReport() {
    const name = reportTemplateName.trim();
    if (!name) return setToast("請輸入比較報表名稱");
    const report: ComparisonReportTemplate = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      /* 跨計畫比較已移除，新範本不再寫 compareProjectIds。 */
      quarter,
      dayType,
      /* 範本存的是條件值。舊範本存的是單一字串 roadFilter，還原時會相容處理 */
      roadFilters: [...roadFilters],
      directions: [...directions],
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
    /*
     * ⚠️ 舊範本裡的 compareProjectIds 一律**忽略**（跨計畫比較已於 v20.64
     * 移除）。這裡刻意不報錯也不提示——那個功能已經不存在，跟使用者說
     * 「部分不存在的計畫已略過」只會讓他去找一個找不到的畫面。
     * 這一支**不是**跨計畫比較的一部分，只是剛好存過那個欄位；
     * 移除跨計畫時很容易誤判成一起刪掉，不可以。
     */
    if (typeof report.quarter === "string" && report.quarter)
      setQuarter(report.quarter);
    if (DAY_MODES.includes(report.dayType as DayMode))
      setDayType(report.dayType as DayMode);
    /*
     * 調查點條件目前存成陣列（可複選）。
     * 舊範本存的是單一字串（"ALL" 或一個 roadId），這裡照樣讀得進來，
     * 否則使用者存過的範本會在升版後靜靜失效。
     */
    if (Array.isArray(report.roadFilters))
      setRoadFilters(
        report.roadFilters.filter(
          (x: unknown): x is string => typeof x === "string",
        ),
      );
    else if (typeof report.roadFilter === "string")
      setRoadFilters(report.roadFilter === "ALL" ? [] : [report.roadFilter]);
    /* 方向條件目前存成陣列；舊範本的單一字串照樣讀得進來 */
    if (Array.isArray(report.directions))
      setDirections(
        report.directions.filter(
          (x: unknown): x is string => typeof x === "string",
        ),
      );
    else if (typeof report.direction === "string")
      setDirections(report.direction === "ALL" ? [] : [report.direction]);
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
    setToast(`已套用比較報表「${report.name}」`);
  }
  async function exportLegacy() {
    const XLSX = await import("xlsx");
    /*
     * 欄名的單位要跟畫面一致。部分時段調查的總量不是全日量，
     * 標成「輛/日」會讓人直接拿去跟完整 24 小時的季度比較。
     */
    /*
     * 單位要同時看「調查涵蓋」與「日別」。
     *
     * 只看 surveyScope.partial 的話，日別選「平日＋假日」時匯出的是兩天的
     * 加總，卻會被標成「輛/日」——實測 999998T601 一份檔案匯出 12,838 輛
     * 標成全日實際交通量，而那是平日 9,392 加假日 3,446 的合計，
     * 比真正的平日量高了 37%。畫面上的 KPI 早就標「輛／平假日合計」了，
     * 匯出檔卻沒有跟上，同一份檔案裡的另一張工作表也標成「平日＋假日全部時段」，
     * 三處互相矛盾。這裡與畫面共用同一套判斷。
     */
    /*
     * ⚠️ 這裡**不可以**再定義一個只換年份的 showQuarter。
     *   舊版在這一支裡遮蔽了外層那一個，於是匯出檔只換年份、
     *   期別（季別／調查月份）永遠不換——畫面寫「115年2、3月」、
     *   交出去的報表寫「115Q1」，同一份資料兩種說法。
     *   （使用者 2026-09-13 在另一支程式上發現同一個毛病，指定三支都要查。）
     *   直接用外層那一個：它兩層都套，而且與畫面同一份。
     */
    const sheetActualUnit = exportActualUnit(dayType, surveyScope.partial);
    const sheetPcuUnit = exportPcuUnit(dayType, surveyScope.partial);
    const roadDetails = roadOnlyRows.map((r) => ({
      季度: showQuarter(quarter),
      /*
       * 「平日＋假日」時每個調查點是兩列，日別要寫**這一列自己的**那一天，
       * 不能寫成「平日＋假日」——那會讓兩列看起來都是兩天的合計。
       */
      日別: r.dayType || dayType,
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
        季度: showQuarter(quarter),
        /* 與路段格式同理：寫這一列自己的那一天 */
        日別: r.dayType || dayType,
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
    /*
     * 歷季各表是跨季度的，不能沿用上面依「目前季度」算出來的
     * sheetActualUnit／sheetPcuUnit——同一張表裡可能同時有完整 24 小時
     * 和只調查幾小時的季度。標題改用不含時間範圍的中性單位，
     * 另外加一欄「調查涵蓋」逐列說明這一列到底調查了多久。
     */
    const historicalDailyExport = historicalDailyRows.map((r) => ({
      季度: showQuarter(r.quarter),
      日別: r.dayType,
      調查點編號: r.roadId,
      調查點名稱: r.roadName,
      調查涵蓋: r.coverageLabel,
      "方向A（輛・僅路段）": r.isIntersection ? "" : r.a,
      "方向B（輛・僅路段）": r.isIntersection ? "" : r.b,
      "合計（輛）": r.total,
      "方向A（PCU・僅路段）": r.isIntersection ? "" : r.aPcu,
      "方向B（PCU・僅路段）": r.isIntersection ? "" : r.bPcu,
      "合計（PCU）": r.pcu24,
    }));
    const comp = historicalCompositionRows.map((r) =>
      Object.fromEntries([
        ["季度", r.quarter],
        ["日別", r.dayType],
        ["調查點編號", r.roadId],
        ["調查點名稱", r.roadName],
        ["調查涵蓋", r.coverageLabel],
        ...analysisVehicleCatalog.flatMap((vehicle) => [
          [`${vehicle.label}（輛）`, r.vehicles[vehicle.key] ?? 0],
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
      左轉駛出: turnTargetLabel(setting, effectiveIntersectionSettings, "left"),
      直行駛出: turnTargetLabel(
        setting,
        effectiveIntersectionSettings,
        "through",
      ),
      右轉駛出: turnTargetLabel(setting, effectiveIntersectionSettings, "right"),
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
    /*
     * 這一張以前是把 dayComparisons 直接丟給 json_to_sheet，而它是 React
     * 狀態物件，欄名就是程式碼裡的屬性名——匯出的 .xls 標題列會是
     * roadId / roadName / weekdayActual…，而且沒有任何單位，
     * 「平假日差」與「假日相較平日（%）」兩欄也整個不見。
     * 其餘每一個 add() 傳的都是中文鍵的物件，只有這裡漏了。
     */
    /* ⚠️ 匯出一律吃主工具列（使用者 2026-09-14 的規則）。 */
    const dayComparisonRows = dayComparisonsMain.map((r) => ({
      調查點編號: r.roadId,
      調查點名稱: r.roadName,
      /*
       * ⚠️ 稽核表 C：拉開季度區間時一季一列，所以要有季別欄，
       *   否則 Excel 上同一個調查點出現兩列而分不出是哪一季。
       */
      季別: r.quarter ? showQuarter(r.quarter) : "",
      "平日實際量（輛）": r.weekdaySurveyed ? r.weekdayActual : null,
      "假日實際量（輛）": r.holidaySurveyed ? r.holidayActual : null,
      "平日PCU（PCU）": r.weekdaySurveyed ? r.weekdayPcu : null,
      "假日PCU（PCU）": r.holidaySurveyed ? r.holidayPcu : null,
      平日調查涵蓋: r.weekdaySurveyed
        ? coverageLabelOf(r.weekdayCoverage)
        : "本季未調查",
      假日調查涵蓋: r.holidaySurveyed
        ? coverageLabelOf(r.holidayCoverage)
        : "本季未調查",
      /* 沒有假日資料時寫空白，不是 0——0 會被 Excel 的加總與平均吃進去。 */
      "平假日差（輛）":
        r.weekdaySurveyed && r.holidaySurveyed && r.coverageComparable
          ? r.holidayActual - r.weekdayActual
          : null,
      "假日相較平日（%）":
        r.weekdaySurveyed &&
        r.holidaySurveyed &&
        r.coverageComparable &&
        r.weekdayActual
          ? r.holidayActual / r.weekdayActual - 1
          : null,
    }));
    add("current", dayComparisonRows, "平假日比較");
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
      /* 與 .xls 匯出共用同一套單位判斷，理由見 exportActualUnit 的說明。 */
      /*
       * ⚠️ 同上：不可以在這裡遮蔽外層的 showQuarter。
       *   外層那一個會同時套上年份與期別兩層，和畫面是同一份。
       */
      const sheetActualUnit = exportActualUnit(dayType, surveyScope.partial);
      const sheetPcuUnit = exportPcuUnit(dayType, surveyScope.partial);
      /*
       * 「平日＋假日」已經改成每個調查點出兩列（各自是單日的量），
       * 所以不再有「平假日合計」這種欄位；欄名只需要看調查涵蓋是否滿 24 小時。
       */
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
      type ExcelJsRow = {
        eachCell: (visit: (cell: ExcelJsCell) => void) => void;
      };
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
        ...analysisVehicleCatalog.map(
          (vehicle) => `${vehicle.label}（${sheetActualUnit}）`,
        ),
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}比例（%）`),
      ]);
      roadOnlyRows.forEach((r) =>
        data.addRow([
          showQuarter(quarter),
          r.dayType,
          r.roadId,
          dayQualifiedLabel(r.roadName, r.dayType, dayType),
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
        /* 只有真的會產生那張工作表時才叫使用者去看它（產生條件見下方的
           if (intersectionOnlyRows.length)）。舊版無條件寫這句，
           一個路口資料也沒有時，會指向一張根本不在檔案裡的工作表。 */
        data.addRow([
          showQuarter(quarter),
          dayType,
          "",
          intersectionOnlyRows.length
            ? `本季無路段格式資料；請查看「路口${intersectionFlowLabel}交通量」工作表`
            : "本季這個日別與篩選條件下沒有任何調查資料；請確認上方的季度、日別與調查點篩選。",
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
              showQuarter(quarter),
              r.dayType,
              intersectionFlowLabel,
              r.roadId,
              r.roadName,
              dayQualifiedLabel(`${r.roadName}－${d.name}`, r.dayType, dayType),
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
            turnTargetLabel(setting, effectiveIntersectionSettings, "left"),
            turnTargetLabel(setting, effectiveIntersectionSettings, "through"),
            turnTargetLabel(setting, effectiveIntersectionSettings, "right"),
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
        /* ⚠️ 稽核表 C：拉開區間時一季一列，沒有這一欄就分不出是哪一季。 */
        "季別",
        "平日實際量（輛）",
        "假日實際量（輛）",
        "平日PCU（PCU）",
        "假日PCU（PCU）",
        "平日調查涵蓋",
        "假日調查涵蓋",
        "平假日差（輛）",
        "假日相較平日（%）",
      ]);
      /*
       * 沒調查過的日別一律寫空白格，不是 0。
       * 0 會被 Excel 的加總與平均吃進去，而「假日相較平日 -100%」
       * 讀起來像那一季的假日流量真的歸零——實際上只是沒做假日調查。
       * 歷季趨勢那張表早就是這樣處理的，這裡沿用同一個原則。
       */
      /* ⚠️ 匯出一律吃主工具列；圖的標題也是照主工具列的季別寫的。 */
      dayComparisonsMain.forEach((r) =>
        dc.addRow([
          r.roadId,
          /*
           * ⚠️ 拆季之後名稱要帶季別：這一欄是原生圖表的類別軸（categories 指向 B 欄），
           *   不帶的話同一條路段的兩季在圖上會是兩個一模一樣的標籤。
           *   原始的編號與季別各自還有一欄，要拿來算的人不受影響。
           */
          r.quarter ? `${r.roadName}（${showQuarter(r.quarter)}）` : r.roadName,
          /*
           * ⚠️ 2026-09-18 大檢查 F-21：只看一季時列的 quarter 刻意是空字串
           *   （那是分組鍵的設計，見 dayComparisonsFor），但匯出的「季別」欄
           *   不可以因此整欄空白——讀的人會以為資料缺漏。單季時寫主工具列那一季。
           */
          showQuarter(r.quarter || mainFilters.quarterTo || quarter),
          r.weekdaySurveyed ? r.weekdayActual : null,
          r.holidaySurveyed ? r.holidayActual : null,
          r.weekdaySurveyed ? r.weekdayPcu : null,
          r.holidaySurveyed ? r.holidayPcu : null,
          r.weekdaySurveyed ? coverageLabelOf(r.weekdayCoverage) : "本季未調查",
          r.holidaySurveyed ? coverageLabelOf(r.holidayCoverage) : "本季未調查",
          r.weekdaySurveyed && r.holidaySurveyed && r.coverageComparable
            ? r.holidayActual - r.weekdayActual
            : null,
          r.weekdaySurveyed &&
          r.holidaySurveyed &&
          r.coverageComparable &&
          r.weekdayActual
            ? r.holidayActual / r.weekdayActual - 1
            : null,
        ]),
      );
      dc.columns = [16, 36, 14, 22, 22, 22, 22, 30, 30, 20, 20].map((width) => ({
        width,
      }));
      header(dc.getRow(1));
      /*
       * ⚠️ 2026-09-18 大檢查 F-29：加了「季別」欄之後百分比格式沒有跟著往右移，
       *   結果「平假日差（輛）」被套成 0.0%（-8216 輛顯示成 -821600.0%），
       *   真正的「假日相較平日（%）」反而是 -0.235 的小數。
       *   格式一律用欄名找，不寫死欄號，日後再插欄不會再錯位。
       */
      const dcPercentColumn =
        (dc.getRow(1).values as (string | undefined)[]).indexOf(
          "假日相較平日（%）",
        );
      dc.getColumn(dcPercentColumn).numFmt = "0.0%";
      const tr = wb.addWorksheet("歷季趨勢", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      /*
       * 歷季趨勢一樣是跨季度的表，標題不能帶「/日」或「/調查時段」——
       * 那是依「目前季度」算出來的，對表裡其他季度可能是錯的。
       * 單位改為中性的「輛」「PCU」，各季的平日／假日涵蓋分列於 D、E 欄。
       * 折線圖只引用 A（類別）、B、C 三欄，新增說明欄不會影響圖表。
       */
      /*
       * 這裡的單位刻意不帶「/日」或「/調查時段」（見上面說明），
       * 但**必須跟著所選指標走**——舊版寫死只分 actual／pcu 兩種，
       * v20.59 起指標有六個，佔比類的單位是 %。
       */
      const trendUnitLabel =
        trendMetricDef.unit === "%"
          ? "%"
          : trendMetricDef.unit === "pcu"
            ? "PCU"
            : "輛";
      /*
       * ⚠️ 多個調查點時這張表也要**一個調查點一欄**，不可以只有平日／假日
       *   兩欄。畫面上的圖已經逐點分列，匯出檔卻寫合計的話，
       *   使用者抄進報告的是匯出檔裡那個不成立的數字，
       *   而兩邊各自看都很合理——這種分岔沒有人會發現。
       */
      const trendExcelSeries = trendLines.length
        ? trendLines.map((line) => ({
            name: `${line.label} ${trendMetricName}（${trendUnitLabel}）`,
            values: line.values,
            color: line.color.replace(/^#/, ""),
          }))
        : [
            {
              name: `平日 ${trendMetricName}（${trendUnitLabel}）`,
              values: trendRows.map((r) => r.weekday),
              color: "148C8C",
            },
            {
              name: `假日 ${trendMetricName}（${trendUnitLabel}）`,
              values: trendRows.map((r) => r.holiday),
              color: "E58A2B",
            },
          ];
      tr.addRow([
        "季度",
        ...trendExcelSeries.map((series) => series.name),
        "平日調查涵蓋",
        "假日調查涵蓋",
      ]);
      /*
       * 缺值（含被日別篩選掉的那一條）寫成空白格，不是 0——
       * Excel 的折線圖會把 0 畫成一個真實的資料點，看起來像「那一季是 0」。
       */
      trendRows.forEach((r, index) =>
        tr.addRow([
          showQuarter(r.quarter),
          ...trendExcelSeries.map((series) => series.values[index] ?? null),
          trendCoverageByQuarter.get(r.quarter)?.weekday ?? "—",
          trendCoverageByQuarter.get(r.quarter)?.holiday ?? "—",
        ]),
      );
      tr.columns = [
        16,
        ...trendExcelSeries.map(() => 24),
        30,
        30,
      ].map((width) => ({ width }));
      header(tr.getRow(1));
      /*
       * 圖表說明放在**自己的工作表**，不印在圖上。
       *
       * 使用者的原話：「excel 裡面圖本身就是圖，文字說明可以放在 excel 其他
       * 欄位」「那些文字是要由簡報者口述的，不該出現在圖下方」。
       * 所以圖是乾淨的折線圖，話在這一張表裡，要用的人自己複製。
       *
       * ⚠️ 這幾句話與畫面上圖旁邊那一段是**同一份**（trendScriptSections），
       * 不是另外寫一次——寫兩次遲早會分岔，而分岔的時候沒有人會發現。
       */
      const ts = wb.addWorksheet("圖表說明", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      ts.addRow(["段落", "內容"]);
      ts.addRow([
        "使用方式",
        "以下文字是「歷季趨勢」那張圖代表的意義，供簡報時口述。刻意不印在圖上——圖給聽眾看，話由簡報者講。",
      ]);
      ts.addRow(["指標", `${trendMetricName}（${trendUnitLabel}）`]);
      trendScriptSections.forEach((section) =>
        section.lines.forEach((line) => ts.addRow([section.title, line])),
      );
      ts.columns = [18, 110].map((width) => ({ width }));
      ts.getColumn(2).alignment = { wrapText: true, vertical: "top" };
      header(ts.getRow(1));
      const currentComp = wb.addWorksheet("目前車種組成", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      currentComp.addRow(["車種", "數量（輛）", "組成比例（%）"]);
      /*
       * ⚠️ 快取值要與同一張表上的 SUMIFS **算同一件事**。
       *   F2／F3／F4 三格寫的是主工具列的條件，SUMIFS 也是照那三格篩，
       *   所以快取一定要用主工具列那一份（compositionMainTotals）。
       *   用畫面那一份（compositionTotals，走車種組成自己的條件）的話，
       *   這一塊只要脫離過，檔案一打開數字就自己變了。
       */
      const compositionValues = analysisVehicleCatalog.map(
        (vehicle) => compositionMainTotals.vehicles[vehicle.key] ?? 0,
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
          result: compositionMainTotals.total
            ? Number(compositionValues[i]) / compositionMainTotals.total
            : 0,
        };
      });
      currentComp.getCell("E1").value = "篩選條件";
      currentComp.getCell("E2").value = "日別";
      /*
       * ⚠️ 2026-09-16 更正：車種組成那一塊**可以脫離**主工具列
       *   （它掛著 renderBlockFilters 的日別／調查點／方向）。
       *   匯出檔一律吃主工具列（使用者 2026-09-14 的規則），所以這三格
       *   照主工具列寫是對的——但**數字也必須照主工具列算**，
       *   見上面 compositionValues 的說明。舊註解寫「和畫面那張圓環同一份」
       *   已經不成立，那正是這一輪修掉的錯。
       */
      /*
       * ⚠️ 2026-09-18 使用者裁示（F-10／F-30）：F2～F4 的預設值＝
       *   compositionMainSelection（一個調查點 × 一個日別），不再有
       *   「全部路段／路口」「平日＋假日」這兩種合計選項；快取值與 SUMIFS 同源。
       */
      currentComp.getCell("F2").value = compositionMainSelection.day;
      currentComp.getCell("E3").value = "路段";
      currentComp.getCell("F3").value = compositionMainSelection.roadName;
      currentComp.getCell("E4").value = "方向";
      currentComp.getCell("F4").value = compositionMainSelection.directionName;
      currentComp.getCell("E5").value = "路口流量視角";
      currentComp.getCell("F5").value = intersectionFlowLabel;
      currentComp.getCell("E6").value = "操作說明";
      currentComp.getCell("F6").value =
        `本檔依網站目前的「${intersectionFlowLabel}」視角匯出；請使用F2～F4下拉選單切換日別、路段／路口及車流方向，圓環圖會即時更新。` +
        `一次只看一個調查點與一個日別：不同調查點的車輛數不可以相加，平日與假日也不相加（「平日＋假日」指的是並列顯示）。` +
        (roadFilters.length !== 1
          ? `網站目前範圍內有多個調查點，這裡預設顯示「${compositionMainSelection.roadName}」。`
          : "") +
        (dayType === "平日＋假日" ? "網站目前為「平日＋假日」，這裡預設顯示平日。" : "");
      // 名稱可能含逗號／雙引號，或整串超過 Excel 的 255 字元上限；
      // 無法安全表示時就不要放下拉（欄位仍可手動輸入），也不要寫出壞掉的清單。
      const roadListFormula = excelListFormula([
        ...roadOptions.map(
          ([roadId, name]) => roadExportLabels.get(roadId) ?? name,
        ),
      ]);
      const directionListFormula = excelListFormula([
        "全部方向",
        ...directionOptions.map(([, name]) => name),
      ]);
      currentComp.getCell("F2").dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"平日,假日"'],
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
      /*
       * 歷季各表跨季度，標題不能帶時間範圍（見 historicalDailyRows 的註解）。
       * 這裡一律用中性單位「輛」「PCU」，改由第 5 欄「調查涵蓋」逐列說明；
       * 該欄也在自動篩選範圍內，使用者可以直接把不足 24 小時的列篩出來。
       */
      hd.addRow([
        "季度",
        "日別",
        "調查點編號",
        "調查點名稱",
        "調查涵蓋",
        "方向A（輛・僅路段）",
        "方向B（輛・僅路段）",
        "合計（輛）",
        "方向A（PCU・僅路段）",
        "方向B（PCU・僅路段）",
        "合計（PCU）",
      ]);
      historicalDailyRows.forEach((r) =>
        hd.addRow([
          showQuarter(r.quarter),
          r.dayType,
          r.roadId,
          r.roadName,
          r.coverageLabel,
          r.isIntersection ? "" : r.a,
          r.isIntersection ? "" : r.b,
          r.total,
          r.isIntersection ? "" : r.aPcu,
          r.isIntersection ? "" : r.bPcu,
          r.pcu24,
        ]),
      );
      hd.columns = [12, 10, 16, 36, 26, 20, 20, 25, 20, 20, 22].map(
        (width) => ({ width }),
      );
      header(hd.getRow(1));
      [9, 10, 11].forEach((c) => (hd.getColumn(c).numFmt = "#,##0.0"));
      hd.autoFilter = { from: "A1", to: `K${historicalDailyRows.length + 1}` };
      const hc = wb.addWorksheet("歷季車種組成", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      /*
       * 同「歷季全日交通量」：跨季度的表不能用當季單位，改中性的「輛」
       * 並加上「調查涵蓋」欄。這一欄插在第 5 欄，因此下面的車種數量欄
       * 從第 6 欄起算——LEAD_COLUMNS 就是為了讓欄位位置只有一個來源，
       * 避免標題、公式、欄寬與 numFmt 四個地方各自寫死而失去同步。
       */
      const HC_LEAD_COLUMNS = 5;
      hc.addRow([
        "季度",
        "日別",
        "調查點編號",
        "調查點名稱",
        "調查涵蓋",
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（輛）`),
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（%）`),
      ]);
      historicalCompositionRows.forEach((r, i) => {
        const row = hc.addRow([
          showQuarter(r.quarter),
          r.dayType,
          r.roadId,
          r.roadName,
          r.coverageLabel,
          ...analysisVehicleCatalog.map(
            (vehicle) => r.vehicles[vehicle.key] ?? 0,
          ),
        ]);
        const excelRow = i + 2,
          countStart = HC_LEAD_COLUMNS + 1,
          countEnd = HC_LEAD_COLUMNS + analysisVehicleCatalog.length,
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
        ...[12, 10, 16, 36, 26],
        ...analysisVehicleCatalog.map(() => 17),
        ...analysisVehicleCatalog.map(() => 14),
      ].map((width) => ({ width }));
      header(hc.getRow(1));
      analysisVehicleCatalog.forEach(
        (_, index) =>
          (hc.getColumn(
            HC_LEAD_COLUMNS + analysisVehicleCatalog.length + 1 + index,
          ).numFmt = "0.0%"),
      );
      hc.autoFilter = {
        from: "A1",
        to: `${colName(HC_LEAD_COLUMNS + analysisVehicleCatalog.length * 2)}${historicalCompositionRows.length + 1}`,
      };
      const hct = wb.addWorksheet("歷季組成圖表資料", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      hct.addRow([
        "期別標籤",
        "季度",
        "調查點編號",
        "調查點",
        "日別",
        ...analysisVehicleCatalog.map((vehicle) => `${vehicle.label}（%）`),
      ]);
      compositionTrendRows.forEach((r) =>
        hct.addRow([
          `${showQuarter(r.quarter)}・${r.roadName}・${r.dayType}`,
          showQuarter(r.quarter),
          r.roadId,
          r.roadName,
          r.dayType,
          ...analysisVehicleCatalog.map(
            (vehicle) => r.vehicles[vehicle.key] ?? 0,
          ),
        ]),
      );
      hct.columns = [34, 16, 16, 22, 10, ...analysisVehicleCatalog.map(() => 16)].map(
        (width) => ({ width }),
      );
      header(hct.getRow(1));
      analysisVehicleCatalog.forEach(
        (_, index) => (hct.getColumn(6 + index).numFmt = "0.0%"),
      );
      const hourlySheet = wb.addWorksheet("每小時趨勢", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      /*
       * ⚠️ 稽核表 G：要有調查點欄。
       *   舊版把全部調查點同一小時相加寫成一格，而表頭看不出來。
       *   現在一列＝一個（調查點 × 日別 × 小時）。
       *   原生折線圖的類別軸指向 A 欄，所以 A 欄得是能分辨得出來的標籤；
       *   調查點另外一欄，要拿來算的人照樣篩得動。
       */
      const hourlyManyPoints =
        new Set(hourlyExportRows.map((r) => r.point)).size > 1;
      hourlySheet.addRow([
        "時段",
        "調查點",
        "實際交通量（輛/小時）",
        "當量交通量（PCU/小時）",
      ]);
      hourlyExportRows.forEach((r) =>
        hourlySheet.addRow([
          hourlyManyPoints && r.point ? `${r.point} ${r.hour}` : r.hour,
          r.point,
          r.actual,
          r.pcu,
        ]),
      );
      hourlySheet.columns = [
        { width: 30 },
        { width: 24 },
        { width: 26 },
        { width: 28 },
      ];
      header(hourlySheet.getRow(1));
      hourlySheet.getColumn(4).numFmt = "#,##0.0";
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
      /* 條件一律取共同功能列，與畫面上那張圓環圖同一份（見 v20.68 說明）。 */
      /* F-10／F-30：與「目前車種組成」同一組預設（一個調查點 × 一個日別）。 */
      charts.getCell("AB90").value = compositionMainSelection.day;
      charts.getCell("AA91").value = "路段";
      charts.getCell("AB91").value = compositionMainSelection.roadName;
      charts.getCell("AA92").value = "方向";
      charts.getCell("AB92").value = compositionMainSelection.directionName;
      charts.getCell("AB90").dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"平日,假日"'],
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
      /*
       * ⚠️ 這裡以前抄了一份和畫面一樣的顏色。改一邊忘了另一邊，
       *   畫面與交出去的 Excel 就會用不同顏色代表同一個車種，
       *   而且不會有任何錯誤訊息。現在共用 app/vehicle-colors.ts。
       */
      const compositionColors = VEHICLE_COLORS_ARGB;
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
          result: compositionMainTotals.total
            ? Number(compositionValues[i]) / compositionMainTotals.total
            : 0,
        };
        charts.getCell(`AC${row}`).numFmt = "0.0%";
      });
      const chartCompositionTotalRow = chartCompositionEnd + 2;
      charts.getCell(`AA${chartCompositionTotalRow}`).value = "合計";
      charts.getCell(`AB${chartCompositionTotalRow}`).value = {
        formula: `SUM($AB$${chartCompositionStart}:$AB$${chartCompositionEnd})`,
        result: compositionMainTotals.total,
      };
      charts.getCell(`AB${chartCompositionTotalRow}`).numFmt = "#,##0";
      charts.getCell(`AC${chartCompositionTotalRow}`).value = {
        formula: `SUM($AC$${chartCompositionStart}:$AC$${chartCompositionEnd})`,
        result: compositionMainTotals.total ? 1 : 0,
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
          sumPcu(
            record,
            pcuFactors,
            turnPcuFactors,
            vehicleClassSettings,
            pcuScopes,
          ),
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
          /* v20.59 新增「圖表說明」：它是歷季趨勢那張圖的講稿，歸在同一組。 */
          history: ["歷季趨勢", "圖表說明", "歷季全日交通量"],
          composition: ["目前車種組成", "歷季車種組成", "歷季組成圖表資料"],
          hourly: ["每小時趨勢"],
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
      // 判斷），不會產生 #REF!，7 張圖表因此都能保留。
      if (!wb.worksheets.length)
        throw new Error(
          "勾選的匯出項目在目前條件下沒有任何資料，請至少保留一項",
        );
      /*
       * ⚠️ 2026-09-18 大檢查 F-20：PCU 是「車輛數 × 一位小數係數」一路加總出來的，
       *   二進位浮點會留下 12288.500000000002、456.99999999999994 這種尾巴；
       *   畫面用 Intl 格式化看不見，Excel 儲存格卻原樣帶著，拿去做公式或匯到別處
       *   就跟著跑。這裡在寫檔前把每一個純數值儲存格的浮點雜訊清掉
       *   （取到小數第 10 位再轉回數字），只動雜訊、不動真正的小數
       *   （0.25 這種自訂係數算出來的值不受影響，比例欄的有效位數也保留）。
       *   公式格與文字格不碰。
       */
      wb.eachSheet((sheet) => {
        sheet.eachRow((row) => {
          row.eachCell((cell) => {
            const value = cell.value;
            if (
              typeof value === "number" &&
              Number.isFinite(value) &&
              !Number.isInteger(value)
            ) {
              const tidy = Number(value.toFixed(10));
              if (tidy !== value) cell.value = tidy;
            }
          });
        });
      });
      const raw = await wb.xlsx.writeBuffer();
      const n = Math.max(2, roadOnlyRows.length + 1),
        nd = dayComparisonsMain.length + 1,
        nt = trendRows.length + 1,
        nct = compositionTrendRows.length + 1,
        nh = hourlyExportRows.length + 1;
      /* ⚠️ 同上：原生圖的快取也要照主工具列，不可以用畫面那一份。 */
      const compValues = analysisVehicleCatalog.map(
        (vehicle) => compositionMainTotals.vehicles[vehicle.key] ?? 0,
      );
      const trendVehicleSeries = analysisVehicleCatalog.map(
        (vehicle, index) => ({
          name: vehicle.label,
          formula: `'歷季組成圖表資料'!$${colName(6 + index)}$2:$${colName(6 + index)}$${nct}`,
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
          name: dayQualifiedLabel(
            `${row.roadName}－${direction.name}`,
            row.dayType,
            dayType,
          ),
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
          /*
           * ⚠️ 拆季時標題不可以再寫單一季，否則圖上明明有兩季、
           *   標題卻說只有一季——這是標題在說謊。
           */
          title: `${
            dayComparisonsMain.some((r) => r.quarter)
              ? `${showQuarter(mainFilters.quarterFrom || quarter)}～${showQuarter(mainFilters.quarterTo || quarter)}（一季一列，不合計）`
              : showQuarter(quarter)
          }平日與假日交通量比較（輛；調查涵蓋見資料表）`,
          categories: `'平假日比較'!$B$2:$B$${nd}`,
          series: [
            {
              name: "平日",
              /* ⚠️ 稽核表 C 插入「季別」欄之後，平日量從 C 欄移到 D 欄。 */
              formula: `'平假日比較'!$D$2:$D$${nd}`,
              color: "148C8C",
              /*
               * 沒做這個日別的調查要寫 null，不能寫 0。
               * 資料表那一格已經是空白了（M4），但圖表的 numCache 若寫 0，
               * 不重算 cache 的檢視器就會畫出一根 0 的長條——同一份檔案裡
               * 表是空白、圖是 0，正是 M4 要消滅的那種讀法。
               * chartXml 本來就會把 null 略過成缺口。
               */
              cache: dayComparisonsMain.map((r) =>
                r.weekdaySurveyed ? r.weekdayActual : null,
              ),
            },
            {
              name: "假日",
              /* 同上：假日量從 D 欄移到 E 欄。 */
              formula: `'平假日比較'!$E$2:$E$${nd}`,
              color: "E58A2B",
              cache: dayComparisonsMain.map((r) =>
                r.holidaySurveyed ? r.holidayActual : null,
              ),
            },
          ],
        },
        {
          title: `歷季全日交通量趨勢（${trendUnit}）`,
          categories: `'歷季趨勢'!$A$2:$A$${nt}`,
          type: "line",
          /*
           * ⚠️ 欄位位置要跟著「歷季趨勢」那張表**實際寫了幾欄**走。
           *   寫死 B、C 兩欄的話，逐點分列時圖只會畫到前兩個調查點，
           *   其餘的資料明明在表裡、圖上卻沒有——而圖看起來完全正常。
           */
          series: trendExcelSeries.map((line, index) => ({
            name: line.name,
            formula: `'歷季趨勢'!$${colName(2 + index)}$2:$${colName(2 + index)}$${nt}`,
            color: line.color,
            cache: line.values,
          })),
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
          title: "歷季各調查點、各日別車種組成比例趨勢（%）",
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
              /* ⚠️ 插入「調查點」欄之後，實際交通量從 B 欄移到 C 欄。 */
              formula: `'每小時趨勢'!$C$2:$C$${nh}`,
              color: "148C8C",
              cache: hourlyExportRows.map((r) => r.actual),
            },
            {
              name: "當量交通量（PCU/小時）",
              /* 同上：PCU 從 C 欄移到 D 欄。 */
              formula: `'每小時趨勢'!$D$2:$D$${nh}`,
              color: "E58A2B",
              cache: hourlyExportRows.map((r) => r.pcu),
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
      {/*
       * ══════════════════════════════════════════════════════════════
       *  ⚠️ 頁首那一條藍色橫幅整條拿掉（使用者 2026-09-17 附圖回報）
       * ══════════════════════════════════════════════════════════════
       *
       * 使用者原話：「為什麼全日交通量的頁首版面可以被滑動，而且占的位置蠻大的，
       *   能把全日交通量的畫面弄的和另外兩個程式一樣嗎?……我希望的畫面最上方
       *   是沒有藍色那塊區域的，那塊區域的資訊能用其他方式展現?或參考另外
       *   兩個程式的作法，固定在左上角?字體不要太大導致版面大量被占據」
       *
       * 舊版是一條 128px 高、滿版寬的 <header className="topbar">，而且
       * **會跟著內容捲走**——捲下去之後那 128px 就純粹是浪費過的空間，
       * 捲回頂端又要等它。另外兩支從來沒有這一條：它們把系統名稱與版號
       * 做成側欄左上角的一小塊（.brand），側欄本身是 sticky，永遠在。
       *
       * 改法：橫幅整條刪掉，內容分兩處收納，都不再占用主畫面：
       *   ・系統名稱、副標、版號 → 側欄左上角的 .brand（和另外兩支同一套）
       *   ・使用者身分 → 側欄最下面的 .side-foot（另外兩支也放在那裡）
       * 字級一律比照另外兩支（名稱 16px、副標 12px），不放大。
       */}
      <div className="workspace">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">DT</span>
            <div>
              <strong>全日交通量</strong>
              <small>車種組成・24小時PCU</small>
              <span
                className="brand-version"
                title={`最後更新：${SYSTEM_UPDATED_AT}`}
              >
                {SYSTEM_VERSION}・{SYSTEM_UPDATED_AT}
              </span>
            </div>
          </div>
          <div className="sidebar-heading">
            {/*
             * 這一行標題本身就是進「我的計畫」那一頁的入口。
             *
             * ⚠️ 一開始我在卡片底下另外放了一顆「我的計畫」按鈕，結果側欄上
             *   同一句話出現三次（標題、那顆按鈕、導覽裡的項目），是雜訊。
             *   標題本來就寫著「我的計畫 N」，使用者的視線也落在那裡，
             *   讓它可以按就夠了，不必再多一列。
             */}
            <button
              type="button"
              className="sidebar-heading-link"
              data-goto-item="建立與管理計畫"
              title="瀏覽與管理全部計畫"
              onClick={() => {
                setView(FIRST_PAGE);
                setFocusedBlock("block-projects");
                scrollToBlock("block-projects");
              }}
            >
              <span>建立與管理計畫</span>
              <strong>{projects.length}</strong>
            </button>
            <button
              className="icon-button"
              onClick={openProjectForm}
              aria-label="建立新計畫"
            >
              ＋
            </button>
          </div>
          {/*
           * ── 側欄只放「目前這一個」，全部計畫在專屬的一頁 ──────────
           *
           * 使用者 2026-09-11：
           *   「當管理的計畫變多時，上方計畫堆疊變的很長，有解決辦法嗎？」
           *   「可以改成跟路口轉向程式一樣，計畫清單顯示在右側的計畫清單裡嗎？
           *     這樣點一下『我的計畫』，就能在右側看到計劃清單，本身有滾動，
           *     也能瀏覽計畫。全日交通和交通服務水準可以同步這樣的格式。」
           *
           * 我第一版是把清單塞進一個有捲動的小框——那只是把問題縮小，
           * 側欄仍然要用捲的看計畫，而且卡片小到放不下委託單位與資料筆數。
           * 現在照他指定的做法：側欄只留**目前這一個**（一張卡的高度，
           * 導覽從此固定），全部計畫改在「我的計畫」那一頁上瀏覽。
           *
           * ⚠️ 這張卡刻意保留 .project-card 這個 class：
           *   它的字級、長名稱換行與對比都有測試釘著（text-contrast、
           *   project-name-limit），換個 class 等於把那些守門悄悄繞過。
           */}
          <div className="project-list" data-count={projects.length}>
            {activeProject ? (
              <div className="project-card active" data-current="1">
                <span className="project-mark">
                  {selectedProject.name.slice(0, 1)}
                </span>
                <span>
                  <strong>{selectedProject.name}</strong>
                  {/*
                   * 計畫編號要看得到。使用者 2026-09-10 回報「左側計畫看不到
                   * 計畫編號」——編號一直有存，只是側欄沒有顯示，於是同一個
                   * 業主的兩個標案在清單上長得一模一樣，分不出是哪一個。
                   */}
                  {selectedProject.code ? (
                    <em className="project-code">{selectedProject.code}</em>
                  ) : null}
                  <small>目前正在看這一個</small>
                </span>
              </div>
            ) : (
              <p className="empty-project-list">尚無計畫，請按＋建立。</p>
            )}
          </div>
          {/*
           * ⚠️ 分頁導覽放在側欄裡，不是內容區上方。
           *   使用者 2026-09-10 的原話：「往下滑後，標籤會跟著滑走，
           *   不能隨時切換下一個分頁」。側欄本身固定，捲多遠都在。
           *
           * ⚠️ 順序是「先計畫、後分頁」，而且我改過一次：
           *   一開始我把導覽放最上面，理由是「切分頁每分鐘都在做，
           *   換計畫一天只有幾次」。實機截圖之後發現那是錯的——
           *   五個歸類全部展開有 23 列，**計畫清單整個被推到畫面外**，
           *   1050px 高的螢幕根本看不到，等於換不了計畫。
           *   計畫是最上層的脈絡（底下每一頁都依它而變），放在最上面
           *   也符合閱讀順序；它只有幾列，不會把導覽推下去。
           */}
          <SectionNav
            view={view}
            onChange={setView}
            focusedBlock={focusedBlock}
            onFocusBlock={setFocusedBlock}
            onAction={(action) => {
              if (action === "import") setShowImport(true);
              /*
               * ⚠️ "quality" 這個動作已於 2026-09-17 連同側欄那一項一起移除
               *   （使用者：「這個分頁就可以拿掉了，不用備註顯現」）。
               *   型別上留著是為了讀得懂舊的畫面設定；真的收到時就跳到資料維護，
               *   而不是什麼都不做——什麼都不做的按鈕比不見的按鈕更讓人困惑。
               */
              else if (action === "quality") {
                /* X-63：「資料異常檢查摘要」現在在「資料異常檢查」這個大分頁底下。 */
                  setView("page-check");
                setFocusedBlock("quality-summary");
                scrollToBlock("quality-summary");
              }
              else if (action === "exportCenter") setShowExportCenter(true);
              else if (action === "backup") exportBackup();
            }}
          />
          {/* 使用者身分從頁首橫幅搬下來（和另外兩支一樣放在側欄最下面）。 */}
          <div className="side-foot">
            <i />
            <span>{user?.displayName ?? "本機使用者"}</span>
            <small>{user?.email ?? "免登入使用・資料自動保存在本機"}</small>
          </div>
          <div className="side-note">
            <strong>每個計畫各自獨立</strong>
            <p>
              {/* 分享功能目前沒有任何入口（setShowShare(true) 不存在於程式裡），
                  所以不能寫「獲分享的計畫」，那會讓使用者去找一個找不到的按鈕。
                  跨計畫比較已於 v20.64 移除（使用者 2026-09-09 授權），
                  這裡不可以再寫「勾選後可做整體比較」——那會讓使用者去找一個不存在的功能。 */}
              每個計畫的季度、路口、係數與匯出勾選都各自獨立，
              切換計畫不會改動另一個計畫的資料。
            </p>
          </div>
        </aside>
        <section className="content">
          <div className="toolbar">
            <div className="project-title">
              <span className={`status-dot status-${currentStatus}`} />
              <div>
                <small>
                  目前計畫・{quarter ? showQuarter(quarter) : "尚無季度"}・
                  {currentStatus}
                </small>
                <h2>{selectedProject.name}</h2>
              </div>
            </div>
            {/*
             * ── 在工具列就能換計畫 ──────────────────────────────
             *
             * 使用者 2026-09-11：「我在 A 計劃看表格資料時，如果想切換到
             * B 計畫，上方的功能列是無法切換計畫的（交通服務水準的程式可以
             * 靠上方功能列切換計畫），我必須滑到管理計畫區，去點選想要看的
             * 計畫，這樣有點不便利。」
             *
             * ⚠️ 三支統一：路口轉向的頁首本來就有一顆「計畫」下拉、
             *   交通服務水準的頁首中間也有一顆——**只有這一支沒有**。
             *   所以這不是新發明，是把落單的這一支補齊。
             *
             * ⚠️ 我一度在選項後面補過「（唯讀）」，2026-09-11 拿掉了：
             *   那個狀態來自「分享給同事」的角色設計，而那個功能**沒有入口**
             *   （見 shareProject 的移除說明），本機建立的計畫一律是擁有者，
             *   所以那個標示永遠不會出現——留著只會讓人以為有這回事。
             *
             * ⚠️ 這顆下拉與「我的計畫」那一頁**分工不同，兩個都要**：
             *   下拉是「不離開現在這一頁就換人」，那一頁是「瀏覽與管理全部計畫」。
             */}
            <label className="project-switch" title="切換目前計畫">
              <span>切換計畫</span>
              <select
                id="projectSwitch"
                value={activeProject}
                onChange={(e) => setActiveProject(e.target.value)}
                disabled={projects.length <= 1}
              >
                {!projects.length && <option value="">尚未建立計畫</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} · ` : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="actions">
              <div className="manual-menu" aria-label="新手使用說明手冊下載">
                <a
                  className="button secondary manual-download"
                  href="./manuals/全日交通流量程式手冊_v20.80.pdf"
                  /*
                   * ⚠️ download 一定要**帶檔名**，不可以只寫 `download`。
                   *   沒給值時瀏覽器是從網址推檔名的；單檔試用版把手冊嵌成
                   *   data: URI，那種網址裡沒有檔名，使用者拿到的就會是「下載」。
                   *   （使用者 2026-09-14 實際回報過。）
                   */
                  download="全日交通流量程式手冊_v20.80.pdf"
                >
                  下載新手手冊
                </a>
                {/*
                 * ⚠️ 這裡原本還有一顆「Word」按鈕（.docx），2026-09-11 移除。
                 *
                 *   使用者：「新手手冊只需要做 PDF 檔就好……三個程式都同步，
                 *   只需要 PDF 檔就好。」
                 *   路口轉向在 v2.1.64 就已經因為同一句話改成只出 PDF，
                 *   這一支是最後一個還在出 Word 的，現在對齊。
                 *
                 *   ⚠️ 產生器（scripts/manual/build-docx.mjs）與四份 .docx
                 *     一併刪除。只拿掉按鈕、留著檔案的話，包裡會一直帶著
                 *     一本沒人維護、內容遲早與 PDF 不一致的手冊。
                 *   ⚠️ tests/release-metadata.test.mjs 加了反面守門：
                 *     畫面上不可以再冒出 .docx 連結——只刪不守的話，
                 *     下次照舊樣板補回一顆按鈕就會連到不存在的檔案（404）。
                 */}
              </div>
              <button
                className="button secondary"
                disabled={!activeProject}
                /*
                 * ⚠️ 一定要包一層箭頭函式。直接寫 onClick={openProjectManager}
                 *   會把 MouseEvent 當成「要管理的計畫」傳進去——deleteProject
                 *   踩過一模一樣的坑（那次是把事件當成要刪的計畫）。
                 *   這一次是 tsc 擋下來的，不是實測；`npm test` 裡那道
                 *   typecheck 關卡就是為了這種錯（見 檢查規則.md ⑥-14）。
                 */
                onClick={() => openProjectManager()}
              >
                管理計畫
              </button>
              <button
                className="button secondary"
                disabled={!activeProject || !quarter}
                onClick={() => {
                  /* X-43：內容已搬到資料維護，這顆改成跳轉。 */
                  /* X-63：「資料異常檢查摘要」現在在「資料異常檢查」這個大分頁底下。 */
                  setView("page-check");
                  setFocusedBlock("quality-summary");
                  scrollToBlock("quality-summary");
                }}
              >
                資料維護
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
                disabled={projects.length > 0 && !activeProject}
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
          {/*
           * ⚠️ 工具列與這一排篩選條件**刻意放在分頁之外**。
           *
           * v20.64 把五個分區從「同一頁的錨點」改成「真的換頁」。如果篩選
           * 跟著跑進「參數設定」那一頁，使用者在「關鍵數字」頁想換一個季度
           * 就得先換頁、改完再換回來——而那一頁根本沒有篩選器，看起來就像
           * 這一頁的數字改不動。
           *
           * 使用者說的是「篩選條件要能在**各分頁、各圖表旁**就地設定」，
           * 意思是**同一組條件到處都能改**，不是每一頁各自一組。
           * 各面板自己的 renderBlockFilters() 讀寫的也是這同一份 state。
           */}
          <div
            /*
             * ⚠️ 這個 ref 是給「量主工具列高度」用的（見底下的 useEffect），
             *   不可以拿掉。吸頂的圖要靠 --main-toolbar-h 才知道要讓開多少。
             */
            ref={mainToolbarRef}
            className={
              toolbarOpen ? "filters" : "filters is-collapsed"
            }
            data-testid="main-toolbar"
            data-open={String(toolbarOpen)}
          >
            <div className="main-toolbar-bar">
              <button
                type="button"
                className="mt-toggle"
                data-testid="mt-toggle"
                aria-expanded={toolbarOpen}
                onClick={toggleToolbar}
              >
                {/*
                     * ⚠️ 收合箭頭只能用 ▼（U+25BC，Big5 A1B9），靠 CSS 轉 90 度
                     *   表示「收合」。**不可以用 ▾（U+25BE）或 ▸（U+25B8）**：
                     *   那兩個字不在 Big5 字集裡，而網頁字型是微軟正黑體，
                     *   它沒有那兩個字的字形，實機上畫出來是**空白**（不是豆腐框），
                     *   看起來像「箭頭根本沒做」。
                     *   使用者 2026-09-11 就回報過同一個坑（匯出備份旁邊的箭頭看不到）。
                     *   scripts/glyph-guard.mjs 會擋下再用到罕見字的情況。
                     */}
                <i aria-hidden="true" className={toolbarOpen ? "" : "is-collapsed"}>
                  ▼
                </i>
                主工具列收合
              </button>
              <span className="mt-summary" data-testid="mt-summary">
                {/* ⚠️ 收合起來時這一句是使用者唯一看得到的條件，
                    必須跟畫面其他地方用同一套季度寫法（民國／西元、季別／調查月份）。 */}
                {describeMain(mainFilters, showQuarter)}
              </span>
              {/*
               * X-10「恢復預設條件」（使用者 2026-09-16）。
               * ⚠️ 條件已是預設值時整顆不出現——按了不會有任何事的按鈕是噪音，
               *   而主工具列要簡潔（使用者原則：「能不要就不要」）。
               * ⚠️ 它**不會**動到脫離中的區塊，那是「回歸全部」的事。
               */}
              {!mainAtDefault && (
                <button
                  type="button"
                  className="mt-reset-main"
                  data-testid="mt-reset-main"
                  title="把季度、調查點、日別、方向、調查時段、路口視角、尖峰認定與顯示數值通通回到預設；不會動到正在用自己條件的區塊"
                  onClick={resetMainFilters}
                >
                  恢復預設條件
                </button>
              )}
              {detachedCharts.length > 0 && (
                <DetachedPopover
                  count={detachedCharts.length}
                  items={detachedItems}
                  onGoto={(item) => {
                    /* 與側欄點小分頁做同一件事：換頁 → 點名 → 捲過去。 */
                    if (item.zone) setView(item.zone);
                    if (item.anchor) {
                      setFocusedBlock(item.anchor);
                      scrollToBlock(item.anchor);
                    }
                  }}
                  onResetAll={() => setChartOverrides(resetAllCharts())}
                />
              )}
            </div>
            <div className="main-toolbar-row" hidden={!toolbarOpen}>
            {/*
             * ⚠️ 季度是**起訖區間**，預設起＝迄＝最新一季（＝單季）。
             *   使用者 2026-09-14：「當起和迄是同一時間的話 就等於單季……
             *   因為歷季趨勢圖我可能要找某一期間內的趨勢變化，
             *   不一定是從第一期看到最後一期」。
             */}
            <label>
              季度（起）
              <select
                data-testid="mt-quarter-from"
                value={quarterFrom}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuarterFromTouched(true);
                  setQuarterFrom(next);
                  /*
                   * 起 > 迄 是使用者做得到的動作（兩個下拉各自獨立）。
                   * 不修的話後面每一個吃區間的區塊都會篩出 0 筆，
                   * 而畫面上看起來條件是設好的。
                   */
                  if (compareQuarters(next, quarter) > 0) setQuarter(next);
                }}
              >
                {quarters.map((q) => (
                  <option key={q} value={q}>
                    {quarterLabel(q)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              季度（迄）
              <select
                data-testid="mt-quarter-to"
                value={quarter}
                onChange={(e) => {
                  const next = e.target.value;
                  setQuarter(next);
                  if (compareQuarters(quarterFrom, next) > 0)
                    setQuarterFrom(next);
                }}
              >
                {quarters.map((q) => (
                  <option key={q} value={q}>
                    {quarterLabel(q)}
                  </option>
                ))}
              </select>
            </label>
            {/*
             * ⚠️ 這裡**刻意不放**「區間已拉開…」那句說明。
             *   使用者 2026-09-15（附圖，紅框圈出那一句）：
             *   「這段說明文字因為在不會顯示的圖表，已經會有相同的提示了，
             *     在主工具列就不用這些提示，主工具列主要就是要簡潔」。
             *   真正需要提醒的是**那一塊自己**，那一句仍然掛在各區塊上，不是被拿掉。
             */}
            {periodDisplayToggle}
            {yearStyleToggle}
            <label>
              日別
              <select
                data-testid="mt-day"
                value={dayType}
                onChange={(e) => setDayType(e.target.value as DayMode)}
              >
                <option>平日</option>
                <option>假日</option>
                <option>平日＋假日</option>
              </select>
            </label>
            <div className="filter-field">
              <span className="filter-field-label">路段／路口</span>
              <MultiPicker
                id="roadFilterSelect"
                label="路段／路口"
                allLabel="全部調查點"
                options={roadOptions}
                value={roadFilters}
                onChange={setRoadFilters}
              />
            </div>
            {hasIntersectionRecords && (
              <label>
                路口流量視角
                <select
                  data-testid="mt-flow-view"
                  value={flowChoice}
                  onChange={(e) => {
                    setFlowChoice(e.target.value as FlowChoice);
                    /* 換了視角，方向代碼整組換掉，舊條件留著只會篩不到東西 */
                    setDirections([]);
                  }}
                >
                  <option value="origin">駛出路口（以該支線為起點）</option>
                  <option value="destination">
                    駛入路口（以該支線為終點）
                  </option>
                  {/*
                   * ⚠️ 並列不是一種視角，是「同時呈現兩種」。
                   *   畫不了並列的區塊要寫明不適用，不可以默默只畫駛出。
                   */}
                  <option value="both">駛出＋駛入並列</option>
                </select>
                <small className="flow-mode-hint">
                  {intersectionFlowMode === "destination"
                    ? "駛入路口A＝車輛穿過路口後「開進」支線A的量（依終點統計）"
                    : "駛出路口A＝車輛「從」支線A開進路口的量（依起點統計）"}
                  ，兩種視角的總計相同、各支線分佈不同。
                </small>
              </label>
            )}
            <div className="filter-field">
              <span className="filter-field-label">車流方向</span>
              <MultiPicker
                label="車流方向"
                allLabel="全部方向"
                options={directionOptions.map(
                  ([code, name]) =>
                    [code, `${name}（${code}）`] as [string, string],
                )}
                value={directions}
                onChange={setDirections}
              />
            </div>
            {/*
              * ── 調查時段（主工具列）────────────────────────────────
              *
              * 使用者 2026-09-13 指名要加在這裡：「上方功能列，計畫、季別、
              * 路段、車流方向、**調查時段**（AM PM peak／全調查時段／
              * 全調查時段尖峰）等」。
              *
              * ⚠️ 它與各區塊自己的那一層是**同一份狀態**（mainPeriod），
              *   在哪一邊改都一樣。各區塊要另外指定時，是在自己那一層
              *   選「跟隨上方工具列」以外的值，不是再複製一份主工具列。
              */}
            <label>
              調查時段
              <select
                id="mainPeriodSelectTop"
                data-testid="mt-period"
                value={periodChoice}
                onChange={(e) =>
                  setPeriodChoice(e.target.value as PeriodChoice)
                }
              >
                {(["all", "peak24", "am", "pm", "AMPM"] as PeriodChoice[]).map(
                  (key) => (
                    <option key={key} value={key}>
                      {PERIOD_CHOICE_LABELS[key]}
                    </option>
                  ),
                )}
              </select>
              <small className="flow-mode-hint">
                {mainPeriodIsPeak
                  ? "全日實際交通量與 24 小時 PCU 是整段調查的量，不隨尖峰時段變，那兩張卡會標示不受此條件影響。"
                  : "整段調查涵蓋的累計。要看尖峰請改選上午／下午尖峰或全調查時段尖峰。"}
              </small>
            </label>
            {/*
             * ── 尖峰時段認定（使用者 2026-09-14 指定升到主工具列）──────
             *
             * ⚠️ 這一項**會改變數字**，不是排版選項。
             *   「各方向各自認定」算出來的一定 ≥「同一時段」，
             *   而且各方向不可以相加。所以下面那一行說明是跟著選項變的。
             * ⚠️ 升級前它只在「時段車種分析」裡；升上來之後會開始影響別的區塊。
             *   預設仍是 point（＝現行行為），所以升級當天一個數字都不會變。
             */}
            <label>
              尖峰時段認定
              <select
                data-testid="mt-peak-scope"
                value={periodPeakScope}
                onChange={(e) =>
                  setPeriodPeakScope(e.target.value as PeakScope)
                }
              >
                {(["point", "direction"] as PeakScope[]).map((key) => (
                  <option key={key} value={key}>
                    {PEAK_SCOPE_CHOICE_LABELS[key]}
                  </option>
                ))}
              </select>
              <small className="flow-mode-hint" data-testid="mt-peak-scope-note">
                {periodPeakScope === "direction"
                  ? "各方向的尖峰不在同一小時，各方向的值不可以相加。"
                  : "整個調查點取同一時段，各方向可以相加。"}
              </small>
            </label>
            {/*
             * ── 顯示數值（使用者 2026-09-14 指定升到主工具列，並補兩個組合）──
             */}
            <label>
              顯示數值
              <select
                data-testid="mt-metric"
                value={metricChoice}
                onChange={(e) =>
                  setMetricChoice(e.target.value as MetricChoice)
                }
              >
                {(
                  [
                    "count",
                    "pcu",
                    "share",
                    "pcuShare",
                    "countShare",
                  ] as MetricChoice[]
                ).map((key) => (
                  <option key={key} value={key}>
                    {METRIC_CHOICE_LABELS[key]}
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
              {/*
               * ── 打了字要當場看得到結果 ──────────────────────────
               *
               * 使用者 2026-09-11：「紅框處的搜索功能似乎就沒用了？
               *   我輸入什麼路段名稱似乎都沒看到任何成果。」
               *
               * ⚠️ **搜尋是有作用的**（它會縮小畫面上的表，而且**連匯出一起縮**），
               *   看起來沒用是因為兩件事，兩件都要講出來：
               *   ① 他當時停在「資料匯入」那一頁，而那一頁根本沒有表格可以篩，
               *      所以打什麼字畫面都不會變。
               *   ② 他同時把上面的「路段／路口」選成另一條路，
               *      兩個條件是 AND，交集是空的——而畫面一聲都不吭。
               *
               * 所以這裡直接寫出「現在符合幾個調查點」，而且 0 個時說明原因。
               * ⚠️ 這一行不是裝飾：搜尋框會影響匯出，使用者如果不知道自己
               *   正在 0 個調查點的狀態下按匯出，會拿到一份空的成果檔。
               */}
              {search.trim() ? (
                <small
                  className={
                    searchMatchCount
                      ? "search-hint"
                      : "search-hint search-hint-empty"
                  }
                  data-count={searchMatchCount}
                >
                  {searchMatchCount
                    ? `符合 ${searchMatchCount} 個調查點`
                    : roadFilters.length
                      ? "沒有符合的調查點——「路段／路口」篩選目前有選定，兩個條件要同時成立"
                      : "沒有符合的調查點"}
                </small>
              ) : null}
            </label>
            </div>
          </div>
          {/*
           * ══════════════════════════════════════════════════════════
           *  X-63：「一　建立與匯入」拆成兩個大分頁
           * ══════════════════════════════════════════════════════════
           *
           * 使用者 2026-09-17 只點名了四與五，但這一區踩的是**同一條規則**：
           *   「建立與管理計畫」與「本季總覽」是兩件事（一個是建計畫、
           *     一個是看這一季收到什麼程度），原本擠在同一頁，
           *     往下捲就會看到另一個。
           * 路口轉向那一支（使用者指定的範本）本來就是兩個獨立的大分頁，
           * 三支同步就要一起改。這一項是我主動加的，已在交付說明裡寫明。
           *
           * ⚠️ 「沒有計畫時的提示」與「離線提醒」跟著**建立與管理計畫**那一頁：
           *   沒有計畫時該做的第一件事就是建一個，提示擺在那裡才接得上。
           */}
          {view === "page-projects" && (
            <>
              <PageHeading pageId="page-projects" />
              {!activeProject && (
                <section className="empty-state">
                  <strong>建立第一個交通調查計畫</strong>
                  <p>
                    按左側「＋」輸入計畫名稱，再匯入各季度
                    Excel。每個計畫會獨立保存；需要比較時，在左側勾選多個計畫即可。
                  </p>
                  <button className="button primary" onClick={openProjectForm}>
                    ＋ 建立計畫
                  </button>
                </section>
              )}
              {/*
               * ══════════════════════════════════════════════════════
               *  我的計畫（全部計畫都在這一頁瀏覽）
               * ══════════════════════════════════════════════════════
               *
               * 使用者 2026-09-11 指名照路口轉向的做法：
               * 「計畫清單顯示在右側的計畫清單裡……本身有滾動，也能瀏覽計畫。」
               *
               * ⚠️ 建立計畫**仍然走原本那個視窗**，這裡只放入口按鈕。
               *   在這一頁再做一份 inline 表單的話，全系統就會有兩條
               *   建立計畫的路徑——欄位驗證、字數上限、預設值都要維護兩次，
               *   而兩份遲早會分岔（這支程式的單位曾經就是這樣分岔的）。
               *
               * ⚠️ 每一列的「刪除」刪的是**那一列**，不是目前這一個。
               *   所以 deleteProject() 接受一個 target 參數；
               *   絕對不可以先 setActiveProject 再刪——setState 是非同步的，
               *   那樣會刪到切換前的那一個，而且畫面上看起來一切正常。
               */}
              <section
                className={focusClass("block-projects", "panel project-portfolio")}
                id="block-projects"
              >
                <div className="panel-title">
                  <div>
                    <span>PROJECTS</span>
                    <h3>建立與管理計畫</h3>
                    <small>
                      每個計畫的季度、調查點、係數與匯出勾選都各自獨立，
                      切換計畫不會改動另一個計畫的資料。
                    </small>
                  </div>
                  <button className="button primary" onClick={openProjectForm}>
                    ＋ 建立計畫
                  </button>
                </div>
                {projects.length ? (
                  <div className="portfolio-list" data-count={projects.length}>
                    {projects.map((p) => {
                      const rows = records.filter(
                        (record) => record.projectId === p.id,
                      );
                      const quarters = new Set(rows.map((record) => record.quarter));
                      return (
                        <div
                          key={p.id}
                          className={`portfolio-row${p.id === activeProject ? " current" : ""}`}
                        >
                          <b className="portfolio-code">{p.code || "未編號"}</b>
                          <div className="portfolio-main">
                            <strong>{p.name}</strong>
                            <small>
                              {p.clientName || "未填委託單位"}・
                              {quarters.size} 個季度・{rows.length} 筆資料
                            </small>
                          </div>
                          {p.id === activeProject ? (
                            <span className="portfolio-current">目前計畫</span>
                          ) : (
                            <button
                              className="button secondary"
                              onClick={() => {
                                setActiveProject(p.id);
                                setToast(`已切換到「${p.name}」`);
                              }}
                            >
                              切換到這個
                            </button>
                          )}
                          {/*
                           * ⚠️ 這顆「修改」是 2026-09-11 補的。
                           *   使用者：「針對計畫，我們要可以手動編輯計畫名稱／
                           *   計畫編號等資訊，但全日交通量似乎沒有作到這件事」。
                           *   查證後：功能**本來就有**，在工具列的「管理計畫」，
                           *   但只能改「目前這一個」；而使用者是在「我的計畫」
                           *   這一頁上看全部計畫的——那一頁上只有切換與刪除，
                           *   所以看起來像沒有。
                           *
                           *   ⚠️ 要改哪一個是**直接傳進去**的，不可以先
                           *   setActiveProject 再開視窗：setState 非同步，
                           *   視窗會帶到切換前那一個計畫的值，然後改錯人。
                           *   （刪除那條路徑踩過一模一樣的坑。）
                           */}
                          <button
                            className="button secondary"
                            onClick={() =>
                              openProjectManager({
                                id: p.id,
                                name: p.name,
                                code: p.code,
                                clientName: p.clientName,
                              })
                            }
                          >
                            修改
                          </button>
                          <button
                            className="button secondary portfolio-delete"
                            onClick={() => deleteProject({ id: p.id, name: p.name })}
                          >
                            刪除
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="inline-note">
                    還沒有任何計畫。按右上角「＋ 建立計畫」開始。
                  </p>
                )}
              </section>
              {offline && (
                <p className="offline-note">
                  <strong>免登入本機模式：</strong>
                  資料會保存在目前瀏覽器，關閉或重新整理不會消失；換電腦請使用匯出／匯入備份。
                </p>
              )}
            </>
          )}
          {view === "page-quarter" && (
            <>
              <PageHeading pageId="page-quarter" />
              {/*
               * ⚠️ 這一塊**不可以**在沒有資料時整個消失。
               *
               * 使用者 2026-09-12（附截圖）：「我按了本季總覽，畫面跳到第二張
               * 圖那樣，我完全看不出本季總覽是什麼用途?」
               *
               * 成因：條件原本是 `activeProject && quarter`。他當下切到的計畫
               * 是剛建好的（0 個季度、0 筆資料），所以 quarter 是空字串，
               * **整個區塊根本沒有被畫出來**。側欄那一項照樣點得下去、
               * 照樣變成「目前這一項」，但畫面上什麼都沒發生——
               * 他看到的是「按了沒反應」，而不是「這一季還沒有資料」。
               *
               * 這比壞掉更糟：功能看起來像故障，而使用者無從得知原因。
               * 側欄列得出來的東西，畫面上就必須找得到對應的一塊；
               * 沒有資料時要**說出為什麼沒有、以及下一步該做什麼**。
               */}
              {!!activeProject && !quarter && (
                <section
                  className={focusClass("block-quality", "quality-strip empty")}
                  id="block-quality"
                >
                  <header>
                    <span>一 資料匯入</span>
                    <strong>本季總覽</strong>
                    <small>
                      這一塊會顯示<b>選定季度</b>的資料收到什麼程度：
                      調查點數、平日／假日涵蓋、檢核狀態與異常件數。
                    </small>
                  </header>
                  <p className="quality-strip-empty">
                    <b>
                      「{projects.find((p) => p.id === activeProject)?.name ||
                        "目前計畫"}
                      」還沒有任何季度資料
                    </b>
                    ，所以現在沒有東西可以總覽。請先按上方工具列的
                    <b>「匯入資料」</b>
                    匯入一份調查檔；匯入完成後回到這裡，就會看到那一季的
                    調查點數、平日／假日涵蓋與異常提醒。
                  </p>
                </section>
              )}
              {!!activeProject && !!quarter && (
                <section
                  className={focusClass("block-quality", "quality-strip")}
                  id="block-quality"
                >
                  {/*
                   * ⚠️ 這個抬頭是使用者 2026-09-11 點名要的：
                   *   「點本季總覽，對應的欄位邊框沒有像參數設定各分頁那樣
                   *     有顯眼的提示，真的不知道本季總覽是要看什麼」。
                   *
                   * 兩件事都要補，缺一不可：
                   *   ① 外框（focusClass）——點了看得出是「這一塊」。
                   *   ② 抬頭與一句話說明——看得出這一塊在講什麼。
                   * 原本這一條只有四組數字、連標題都沒有，接在計畫清單下面，
                   * 讀起來像「我的計畫」的頁尾，難怪看不出是獨立的一塊。
                   */}
                  <header>
                    <span>一 資料匯入</span>
                    <strong>本季總覽</strong>
                    <small>
                      {/*
                       * ⚠️ 季度一律走 showQuarter()，不可以直接印 quarter。
                       *   quarter 存的是民國寫法（115Q1），而使用者可以把畫面
                       *   切成西元年顯示——直接印的話，整頁都改成 2026Q1 了，
                       *   只有這一句還寫著 115Q1。
                       *   （e2e-period-date 抓到的就是這一句。）
                       */}
                      {showQuarter(quarter)}{" "}
                      這一季的資料收到什麼程度：調查點數、平日／假日涵蓋、檢核狀態與異常件數。
                      要逐項看是哪幾筆，按「資料維護」。
                    </small>
                  </header>
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
                      {qualitySummary.weekdayRoads}／
                      {qualitySummary.holidayRoads} 個調查點
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
                  {/*
                   * ⚠️ 按鈕上的字要和側欄那一項**一模一樣**。
                   *
                   * 使用者 2026-09-12：「本季總覽右下角的按鈕『開啟儀表板』，
                   * 其實就是左側欄位的品質與定稿，那麼兩者是同一畫面，
                   * 名稱應該要一致，不然會以為是別的視窗。」
                   * 同一個東西兩個名字，使用者就得自己在腦裡對應一次——
                   * 而且會以為那是還沒看過的第三個畫面。
                   */}
                  <button
                    className="button secondary"
                    onClick={() => {
                      /* X-63：「資料異常檢查摘要」現在在「資料異常檢查」這個大分頁底下。 */
                  setView("page-check");
                      setFocusedBlock("quality-summary");
                      scrollToBlock("quality-summary");
                    }}
                  >
                    資料維護
                  </button>
                </section>
              )}
            </>
          )}
          {view === "page-settings" && (
            <>
              <PageHeading pageId="page-settings" />
              <div className="manager-launch-grid" id="block-managers">
                <div
                  className={focusClass(
                    "card-road-master",
                    "road-manager-launch",
                  )}
                  id="card-road-master"
                >
                  <div>
                    <strong>路段／路口主檔管理</strong>
                    <small>
                      路段才設定方向 A／B；路口只管理調查點名稱、別名與重複資料
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    disabled={!activeProject || !roadManagerRows.length}
                    onClick={openRoadManager}
                  >
                    管理名稱
                  </button>
                </div>
                <div
                  className={focusClass(
                    "card-geometry",
                    "road-manager-launch intersection-launch",
                  )}
                  id="card-geometry"
                >
                  <div>
                    <strong>道路與流向管理</strong>
                    <small>
                      輸入 3～7 支線名稱與角度，自動繪圖及判定左轉、直行、右轉
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    disabled={
                      !activeProject || !intersectionManagerRows.length
                    }
                    onClick={openIntersectionManager}
                  >
                    管理路口幾何
                  </button>
                </div>
                <div
                  className={focusClass(
                    "card-vehicle-class",
                    "road-manager-launch vehicle-launch",
                  )}
                  id="card-vehicle-class"
                >
                  <div>
                    <strong>車種分類與當量管理</strong>
                    <small>
                      保留原始車種獨立分析，或歸類至機車、小型車、大型車、特種車
                    </small>
                  </div>
                  <button
                    className="button secondary"
                    disabled={
                      !activeProject || !activeVehicleSourceCatalog.length
                    }
                    onClick={openVehicleClassManager}
                  >
                    管理車種
                  </button>
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
              <section
                className={focusClass("block-pcu", "pcu-settings")}
                id="block-pcu"
              >
                <div>
                  <span>
                    PCU 當量係數
                    {selectedProject?.name
                      ? `・計畫：${selectedProject.name}`
                      : ""}
                  </span>
                  <strong>
                    這一組係數只屬於本計畫，不會影響其他計畫
                    {projectHasOwnFactors
                      ? ""
                      : "（本計畫尚未自行設定，目前使用系統預設值）"}
                  </strong>
                </div>
                {/*
                 * ── 這一組係數要套用到哪裡？ ──────────────────────
                 *
                 * 使用者 2026-09-10：「初始的預設自然是設定一次，套用全季度＋全路段。
                 * 有需求的使用者，就到當量係數設定畫面，去按自己的需求
                 *（不同季度）（不同路段）套用不同的標準。」
                 *
                 * ⚠️ 預設停在「全季別 × 全路段」，也就是改版前的行為。
                 *   使用者不碰這兩個下拉，這個功能對他完全不存在。
                 */}
                <div className="factor-scope-picker" data-testid="factor-scope">
                  <label>
                    套用季別
                    <select
                      value={scopeQuarter}
                      onChange={(event) => setScopeQuarter(event.target.value)}
                      disabled={!activeProject}
                    >
                      <option value={SCOPE_ANY}>全季別</option>
                      {scopeQuarterOptions.map((quarter) => (
                        <option key={quarter} value={quarter}>
                          {/*
                           * ⚠️ 一定要走 quarterLabel()。使用者可以把年份切成西元年，
                           *   直接印 record.quarter 的話這個下拉會停在「115Q1」，
                           *   而同一頁其他地方寫的是「2026Q1」——同一個季度
                           *   在同一個畫面上有兩種寫法。
                           *  （路口轉向的 e2e-year-style 實測抓到過這個問題。）
                           */}
                          {quarterLabel(quarter)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    套用路段
                    <select
                      value={scopeRoadId}
                      onChange={(event) => setScopeRoadId(event.target.value)}
                      disabled={!activeProject}
                    >
                      <option value={SCOPE_ANY}>全路段</option>
                      {scopeRoadOptions.map((road) => (
                        <option key={road.roadId} value={road.roadId}>
                          {road.roadName || road.roadId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="factor-scope-state">
                    {scopeQuarter === SCOPE_ANY && scopeRoadId === SCOPE_ANY
                      ? "目前編輯的是全計畫預設值：所有季別、所有路段都套用這一組。"
                      : ownPcuScope(pcuScopes, scopeQuarter, scopeRoadId)
                        ? `「${pcuScopeLabel(quarterLabel(scopeQuarter), scopeRoadId, roadNameOf(scopeRoadId))}」有自己的專屬係數，與其他範圍不同。`
                        : `「${pcuScopeLabel(quarterLabel(scopeQuarter), scopeRoadId, roadNameOf(scopeRoadId))}」目前是沿用上層設定；下方欄位顯示的是它現在生效的值，改完按「套用係數」才會變成這一格的專屬設定。`}
                  </p>
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
                  <button
                    className="button secondary"
                    onClick={resetPcuFactors}
                  >
                    恢復預設
                  </button>
                </div>
                {/*
                 * ── 變更摘要 ──────────────────────────────────────
                 *
                 * 使用者 2026-09-10：「下面可以摘要，哪個路段在哪一季有修過
                 * 當量係數」「下方一樣有變更的摘要」。
                 *
                 * ⚠️ 這一段**永遠在**，沒有覆寫時也要寫一句「目前全部套用同一組」。
                 *   有覆寫才出現的話，使用者看不到就會以為自己沒設定過——
                 *   而係數是會改變每一個 PCU 的東西，「不確定現在用哪一組」
                 *   本身就是問題。
                 */}
                <div
                  className="factor-scope-summary"
                  data-testid="factor-scope-summary"
                >
                  <strong>係數套用範圍</strong>
                  {pcuScopes.length ? (
                    <>
                      <p>
                        除了全計畫預設之外，另有 {pcuScopes.length} 組專屬係數：
                      </p>
                      <ul>
                        {pcuScopes.map((scope) => (
                          <li key={`${scope.quarter}|${scope.roadId}`}>
                            <span>
                              {pcuScopeLabel(
                                quarterLabel(scope.quarter),
                                scope.roadId,
                                roadNameOf(scope.roadId),
                              )}
                            </span>
                            <small>
                              機車 {scope.factors.core.motorcycle}／小型車{" "}
                              {scope.factors.core.small}／大型車{" "}
                              {scope.factors.core.large}／特種車{" "}
                              {scope.factors.core.special}
                            </small>
                            <button
                              className="button secondary"
                              onClick={() =>
                                clearPcuScope(scope.quarter, scope.roadId)
                              }
                            >
                              還原成預設
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>目前全部季別、全部路段都套用同一組計畫預設係數。</p>
                  )}
                  {scopeConflicts.length ? (
                    <div className="factor-scope-conflict">
                      {/*
                       * ⚠️ 這一段是這個功能**最重要**的一塊。
                       *
                       * (全季別, A路段) 與 (115Q2, 全路段) 同時存在時，
                       * 115Q2 的 A 路段到底用哪一組？依順位是季別優先，
                       * 但**使用者不會知道**——而他看到的每一個 PCU 都受它影響。
                       * 看不見的優先順位，就是下一個「算出來的數字沒人解釋得了」。
                       */}
                      <strong>
                        ⚠️ 有 {scopeConflicts.length} 個範圍互相重疊
                      </strong>
                      <ul>
                        {scopeConflicts.map((conflict) => (
                          <li key={`${conflict.quarter}|${conflict.roadId}`}>
                            {quarterLabel(conflict.quarter)} 的「全路段」設定 與{" "}
                            {roadNameOf(conflict.roadId)} 的「全季別」設定重疊，
                            目前套用 {quarterLabel(conflict.quarter)}{" "}
                            的值（季別優先）。
                            <button
                              className="button secondary"
                              onClick={() => {
                                setScopeQuarter(conflict.quarter);
                                setScopeRoadId(conflict.roadId);
                              }}
                            >
                              為這一格建立明確設定
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </section>
              <p className="excel-compat-note">
                Excel 相容性：舊版 Excel 請下載 .xls
                數值表；若需可編輯原生數據圖，請下載 .xlsx 並使用 Excel 2007
                以上版本開啟。
              </p>
            </>
          )}
          {view === "page-kpi" && (
            <>
              <PageHeading pageId="page-kpi" />
              {/*
               * ⚠️ 這三張卡是**單一數字**：全日實際交通量、24 小時 PCU、
               *   尖峰小時當量交通量。它們不逐車種、不分左右轉，
               *   也不是「一批列」——所以顯示數值、尖峰時段認定
               *   在這裡按了不會有反應，要講出來。
               * ⚠️ 季度區間拉開時，卡片取**結束季度**那一季
               *   （一張卡只放得下一個數字），這也要講。
               */}
              {renderUnusedConditions(
                ["metric", "peakScope"],
                "這三張卡各是一個單一數字（全日實際交通量、24 小時 PCU、尖峰小時當量交通量），不逐車種也不分方向；要看逐車種與逐方向的數字請到「時段車種分析」。",
              )}
              {/*
               * ⚠️ 兩種路口流量視角的**總計相同**，只有各支線的分佈不同。
               *   這三張卡是合計，所以切視角數字不會變——這是正確行為，
               *   但一定要講：使用者切了沒反應，第一個念頭是「篩選壞了」。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView"),
                inapplicableNote(
                  "駛出與駛入兩種視角的總計相同，只有各支線的分佈不同；這三張卡是整個調查點的合計，所以切視角數字不會變。要看各支線的分佈請到「可追溯明細」或「時段車種分析」。",
                  "整個調查點的合計",
                ),
              )}
              {/*
               * ⚠️ X-75（使用者 2026-09-17）：這裡原本掛一句
               *   「季度區間已拉開……但**一張卡只放得下一個數字**，
               *     目前仍以結束季度那一季計算」。
               *
               *   那一句在 X-30／X-34 之後就**不成立了**：前兩張卡
               *  （全日實際交通量、24小時PCU）已經逐季逐點列出每一個數字，
               *   使用者自己看到的就是那樣——「但下面的小卡有確實的列出每一季的成果」。
               *
               *   只有第三張（尖峰小時當量交通量）仍然只算結束季度，
               *   而**那一張自己底下已經寫得清清楚楚**（見 card-kpi-peak 裡那一段，
               *   還說明了為什麼：它底下要列每一個方向的量與算式，逐季會變成幾十列）。
               *
               *   整區掛一句只對其中一張卡成立的話，就是**說明在說謊**——
               *   而使用者是照著說明去理解數字的。所以這一句整個拿掉，
               *   不另外改寫：改寫的話會和第三張卡自己那一段重複講同一件事。
               */}
              <div className="kpi-grid" id="block-kpi">
                <article
                  className={focusClass("card-kpi-daily", "kpi")}
                  id="card-kpi-daily"
                  data-consumes={BLOCK_CONSUMES["card-kpi-daily"]}
                >
                  <span>全日實際交通量</span>
                  {/*
                   * ⚠️ X-28：一行 ＝ 一季 × 一個調查點 × 一個日別，**不相加**。
                   *   行數超過上限時不給數字（見 kpiLines 上方的說明）。
                   */}
                  {kpiLines.overflow && !kpiExpanded ? (
                    <p className="kpi-overflow-note">
                      已選 {kpiLines.pointCount} 個調查點，逐調查點列出會有{" "}
                      {kpiLines.lines.length} 行。不同調查點的交通量
                      <b>不可以相加</b>（那個總和不對應任何一條路的實際流量），
                      所以這裡不給合計。
                      <button
                        type="button"
                        className="kpi-expand"
                        data-testid="kpi-expand"
                        onClick={() => setKpiExpanded(true)}
                      >
                        展開看全部 {kpiLines.pointCount} 個調查點
                      </button>
                    </p>
                  ) : (
                    <>
                      <div className="kpi-day-values kpi-by-quarter">
                        {kpiLines.lines.map((item) => (
                          <strong key={item.key}>
                            {item.label && <em>{item.label}</em>}
                            {formatter.format(item.total)}
                          </strong>
                        ))}
                      </div>
                      {kpiLines.overflow && (
                        <button
                          type="button"
                          className="kpi-expand"
                          data-testid="kpi-collapse"
                          onClick={() => setKpiExpanded(false)}
                        >
                          收起來
                        </button>
                      )}
                    </>
                  )}
                  {/*
                    * ⚠️ 主工具列選到尖峰類的時段時，**這張卡要自己講出來**
                    *   它不受影響——它算的是整段調查的量，本來就不隨尖峰變。
                    *
                    *   使用者 2026-09-12 指名要這一句：「當使用者選擇 AM PM peak
                    *   時，全日交通量卡和 24小時PCU卡 再顯示『這張不受統計範圍
                    *   影響』的提醒就好」。
                    *
                    *   ⚠️ 不可以改成「把卡片藏起來」或「顯示 0」：使用者選了條件
                    *   卻看到數字沒變，第一個念頭是「這個篩選壞了」；顯示 0 更糟，
                    *   那是一個錯的數字。講出來才是正確的處理。
                    */}
                  {mainPeriodIsPeak && (
                    <p
                      className="kpi-scope-note chart-inapplicable"
                      data-testid="chart-inapplicable"
                      /* ⚠️ 這個標記是給守門看的：少了它，這一塊在「調查時段」
                         這個條件上會被判成「既沒變也沒說」。 */
                      data-inapplicable="period"
                    >
                      {/* ⚠️ 要寫**使用者實際選的那一個**：選「上午＋下午並列」時
                          寫成「上午尖峰小時」的話，畫面在說一件他沒有選的事。 */}
                      這張不受「{PERIOD_CHOICE_LABELS[periodChoice]}」影響（整段調查的量）
                    </p>
                  )}
                  {/*
                   * 其餘三個條件也要各自交代（使用者 2026-09-15：
                   * 「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選條件
                   *   卻沒出現不受影響的提醒文字」）。
                   * 只在真的被篩時才出現——沒篩卻講話是另一種噪音。
                   */}
                  {renderUnusedConditions(
                    ["flowView", "peakScope", "metric"],
                    "這是整段調查的單一累計數字：駛出與駛入兩種視角的總計相同、不挑尖峰時段、也固定用本卡自己的單位。",
                  )}
                  <small>
                    {dailyActualUnit}・{dayType}・{directionLabelText}
                  </small>
                </article>
                <article
                  className={focusClass("card-kpi-pcu24", "kpi pcu")}
                  id="card-kpi-pcu24"
                  data-consumes={BLOCK_CONSUMES["card-kpi-pcu24"]}
                >
                  <span>
                    {surveyScope.partial ? "調查時段PCU" : "24小時PCU"}
                  </span>
                  {/* ⚠️ X-28：與全日實際交通量同一份 kpiLines，不另外算一遍。 */}
                  {/* ⚠️ 展開／收起與「全日實際交通量」那張卡**共用同一個狀態**：
                      兩張卡並排，一張展開一張收著會看起來像壞掉。 */}
                  {kpiLines.overflow && !kpiExpanded ? (
                    <p className="kpi-overflow-note">
                      已選 {kpiLines.pointCount} 個調查點，逐調查點列出會有{" "}
                      {kpiLines.lines.length} 行。不同調查點的當量交通量
                      <b>不可以相加</b>，所以這裡不給合計。
                      <button
                        type="button"
                        className="kpi-expand"
                        onClick={() => setKpiExpanded(true)}
                      >
                        展開看全部 {kpiLines.pointCount} 個調查點
                      </button>
                    </p>
                  ) : (
                    <>
                      <div className="kpi-day-values kpi-by-quarter">
                        {kpiLines.lines.map((item) => (
                          <strong key={item.key}>
                            {item.label && <em>{item.label}</em>}
                            {decimalFormatter.format(item.pcu24)}
                          </strong>
                        ))}
                      </div>
                      {kpiLines.overflow && (
                        <button
                          type="button"
                          className="kpi-expand"
                          onClick={() => setKpiExpanded(false)}
                        >
                          收起來
                        </button>
                      )}
                    </>
                  )}
                  {/*
                    * ⚠️ 主工具列選到尖峰類的時段時，**這張卡要自己講出來（24 小時 PCU 同理）**
                    *   它不受影響——它算的是整段調查的量，本來就不隨尖峰變。
                    *
                    *   使用者 2026-09-12 指名要這一句：「當使用者選擇 AM PM peak
                    *   時，全日交通量卡和 24小時PCU卡 再顯示『這張不受統計範圍
                    *   影響』的提醒就好」。
                    *
                    *   ⚠️ 不可以改成「把卡片藏起來」或「顯示 0」：使用者選了條件
                    *   卻看到數字沒變，第一個念頭是「這個篩選壞了」；顯示 0 更糟，
                    *   那是一個錯的數字。講出來才是正確的處理。
                    */}
                  {mainPeriodIsPeak && (
                    <p
                      className="kpi-scope-note chart-inapplicable"
                      data-testid="chart-inapplicable"
                      /* ⚠️ 這個標記是給守門看的：少了它，這一塊在「調查時段」
                         這個條件上會被判成「既沒變也沒說」。 */
                      data-inapplicable="period"
                    >
                      {/* ⚠️ 要寫**使用者實際選的那一個**：選「上午＋下午並列」時
                          寫成「上午尖峰小時」的話，畫面在說一件他沒有選的事。 */}
                      這張不受「{PERIOD_CHOICE_LABELS[periodChoice]}」影響（整段調查的量）
                    </p>
                  )}
                  {/*
                   * 其餘三個條件也要各自交代（使用者 2026-09-15：
                   * 「偶爾會出現某張圖有出現提醒文字，卻對某一個篩選條件
                   *   卻沒出現不受影響的提醒文字」）。
                   * 只在真的被篩時才出現——沒篩卻講話是另一種噪音。
                   */}
                  {renderUnusedConditions(
                    ["flowView", "peakScope", "metric"],
                    "這是整段調查的單一累計數字：駛出與駛入兩種視角的總計相同、不挑尖峰時段、也固定用本卡自己的單位。",
                  )}
                  <small>{dailyPcuUnit}・依目前PCU係數</small>
                </article>
                <article
                  className={focusClass("card-kpi-peak", "kpi pcu peak-kpi")}
                  id="card-kpi-peak"
                  data-consumes={BLOCK_CONSUMES["card-kpi-peak"]}
                >
                  <span>尖峰小時當量交通量</span>
                  {/*
                   * 規則②（使用者 2026-09-13 確認）：這張卡**吃**「調查時段」，
                   * 但這個條件把資料整個篩空時，要**指名是哪一個條件**，
                   * 並給一顆只解除那一個條件的按鈕（其餘條件不動）。
                   *
                   * ⚠️ 不可以只畫一個「沒有資料」。使用者看到空白的第一個念頭
                   *   是「資料掉了」，而真相是「這段調查沒有上午的時段」。
                   * ⚠️ 也不可以拿規則①那句「這張不受影響」來充數——
                   *   那是給**不吃**這個條件的卡片用的，兩件事。
                   */}
                  {periodFilteredEmpty && (
                    <p className="kpi-empty-note">
                      目前沒有數字，是因為<b>
                        「調查時段：{PERIOD_CHOICE_LABELS[periodChoice]}」
                      </b>
                      這個條件——{PERIOD_HINTS[mainPeriod]}
                      ，而這批資料在這個範圍內沒有時段。其他條件都還在。
                      <button
                        type="button"
                        className="kpi-empty-clear"
                        onClick={() => setMainPeriod("all")}
                      >
                        解除這個條件
                      </button>
                    </p>
                  )}
                  {/*
                   * ⚠️ 平日與假日要**各一個數字**，與左邊兩張卡片同一個口徑。
                   *
                   * 使用者 2026-09-12：「為什麼全日實際交通量、24小時PCU都有
                   * 分平日和假日，尖峰小時當量交通量沒有分平假日呢?」——他是對的。
                   * 舊版只印最大的那一個日別，平日尖峰比較大的時候
                   * **假日尖峰整個看不到**，而同一排的另外兩張卡都好好地分兩行。
                   *
                   * ⚠️ 兩個日別的尖峰**時段不一樣**（平日常在早上、假日常在下午），
                   *   所以時段要跟著各自那一行寫，不能在下面寫一個共用的。
                   */}
                  {/*
                   * ⚠️ 「上午＋下午並列」時要**兩組數字**（每組再依日別分行）。
                   *   使用者 2026-09-15：「我選擇上下午尖峰並列時，卻只顯示
                   *   1 筆數值，沒有 2 筆數值（上下午並列），也沒看到任何
                   *   不適用的說明」。並列是呈現方式，不是篩選。
                   */}
                  {/*
                   * ══════════════════════════════════════════════════
                   *  X-28：多個調查點時**不給數字**（使用者 2026-09-16 裁示）
                   * ══════════════════════════════════════════════════
                   *
                   * 前兩張卡改成逐調查點分行，這一張採另一個作法——使用者裁示：
                   *   「第三張卡底下掛著逐方向明細與算式，乘上點位數太長，
                   *     這一張我建議採甲案。」
                   *
                   * ⚠️ 為什麼這一張連「分行」都不行：它算的是**一個尖峰小時**，
                   *   而兩個調查點的尖峰小時常常不是同一個小時；把不同小時的量
                   *   疊在一起，比單純的空間相加更沒有意義。
                   * ⚠️ **不可以整塊消失**（X-17 的教訓：「這張表忽然整張消失，
                   *   我一度以為系統錯誤」）——所以留一段說明文字佔位。
                   */}
                  {kpiLines.multiPoint && (
                    <p className="kpi-overflow-note">
                      已選 {kpiLines.pointCount} 個調查點，這張卡<b>不給數字</b>。
                      尖峰小時當量交通量算的是<b>一個調查點在同一個小時</b>的量；
                      不同調查點的尖峰小時常常不是同一個小時，把它們加起來
                      得到的數字不對應任何一個真實時段。請只選一個調查點，
                      或到「可追溯明細」逐調查點查看。
                    </p>
                  )}
                  {!kpiLines.multiPoint && (
                  <div className="kpi-day-values">
                    {peakGroups.map((group) =>
                      (dayType === "平日＋假日"
                        ? group.peaks.byDay
                        : group.peaks.byDay.slice(0, 1)
                      ).map((item) => (
                        <strong key={`${group.key}-${item.day || "all"}`}>
                          {/* 並列時一定要標出這一筆是上午還是下午，
                              不然兩個數字並排看不出誰是誰。 */}
                          {(peakGroups.length > 1 ||
                            dayType === "平日＋假日") && (
                            <em>
                              {peakGroups.length > 1 ? group.label : ""}
                              {peakGroups.length > 1 &&
                              dayType === "平日＋假日"
                                ? "・"
                                : ""}
                              {dayType === "平日＋假日" ? item.day : ""}
                            </em>
                          )}
                          {decimalFormatter.format(item.value)}
                        </strong>
                      )),
                    )}
                  </div>
                  )}
                  {/*
                   * ⚠️ 「各方向各自認定」時，上面這個大數字仍然是
                   *   **整個調查點在同一小時**的量（它本來就是這張卡的定義），
                   *   而下面逐方向是各自最忙的小時——兩者口徑不同，
                   *   不講的話使用者會拿下面的幾個數字去加、發現加不出上面那個。
                   */}
                  {/*
                   * ⚠️ 前兩張卡逐季分行了，這一張**刻意維持單季**——
                   *   使用者 2026-09-15：「至於尖峰小時當量交通量只計算單一季
                   *   是合理的，因為光是一季，加上下面小卡的詳細計算，
                   *   數值畫面就很多了」。
                   *   同一排三張卡口徑不同，所以一定要寫出來。
                   */}
                  {quarterRange.length >= 2 && (
                    <p className="kpi-scope-note">
                      季度區間已拉開（
                      {showQuarter(mainFilters.quarterFrom)}～
                      {showQuarter(mainFilters.quarterTo)}）：「全日實際交通量」與
                      PCU 這兩項已經<b>逐季分行</b>，「尖峰小時當量交通量」仍然<b>只算結束季度（
                      {showQuarter(mainFilters.quarterTo)}）</b>——
                      它底下還要列出每一個方向在尖峰小時的量與算式，逐季會變成幾十列。
                    </p>
                  )}
                  {mainFilters.peakScope === "direction" && (
                    <p className="kpi-scope-note">
                      「尖峰小時當量交通量」是<b>整個調查點在同一小時</b>的量；
                      各方向那幾列是<b>各自最忙的小時</b>，兩者口徑不同，不要相加比對。
                    </p>
                  )}
                  {/*
                   * ⚠️ 一定要明講「這張卡不跟著車流方向篩選走」。
                   *
                   * 使用者 2026-09-12（附兩張截圖）：「同一條路段 不同車流方向
                   * 尖峰小時當量交通量數值都沒有變化，這是正確的嗎?」
                   *
                   * 數字是對的（2,070.5＋1,964＝4,034.5，三個都在同一個小時），
                   * 設計也是刻意的：**尖峰時段必須是同一個小時，各方向才加得
                   * 起來、也才比得出來**。各方向各用自己的尖峰的話，A＋B 會
                   * 變成一個現實中不存在的數字，而它會被抄進報告。
                   *
                   * ⚠️ 但毛病是真的：同一排三張卡，左邊兩張跟著方向變、
                   *   這一張不變，而卡片上只寫「全部方向同一時段」——
                   *   那句話對懂的人是提示，對第一次看的人看不出來。
                   *   一個看起來像壞掉的正確行為，和真的壞掉一樣糟。
                   */}
                  <small>
                    {peakCardUnit}・全部方向同一時段
                    {/* ⚠️ X-28：多個調查點時沒有數字，尖峰時段也不能列——
                        列了等於用某一個調查點的時段代表全部。 */}
                    {!kpiLines.multiPoint &&
                    peakGroups.flatMap((group) =>
                      (dayType === "平日＋假日"
                        ? group.peaks.byDay
                        : group.peaks.byDay.slice(0, 1)
                      ).map((item) => (
                      <span
                        key={`${group.key}-${item.day || "all"}`}
                        className="peak-hour-note"
                      >
                        {peakGroups.length > 1 ? `${group.label} ` : ""}
                        {dayType === "平日＋假日" ? `${item.day} ` : ""}
                        {item.label}
                      </span>
                      )),
                    )}
                  </small>
                  {/*
                   * ⚠️ 這一段說明一定要在。
                   *
                   * 使用者 2026-09-12 連問兩題，兩題都出在這張卡沒把話講白：
                   *  ①「不同車流方向，尖峰小時當量交通量數值都沒有變化，
                   *     這是正確的嗎?」——同一排三張卡，左邊兩張跟著方向變、
                   *     這一張不變，而卡上只寫「全部方向同一時段」。
                   *  ②「它寫全部方向同一時段，是什麼意思呢? 像我這個路段
                   *     假日是17~18點，平日是7~8點 並沒有同一時段」——
                   *     「同一時段」被讀成「平日和假日同一個時段」。
                   *     它的原意是「**同一個日別裡**，各方向取同一個小時」。
                   *
                   * 一個看起來像壞掉的正確行為，和真的壞掉一樣糟。
                   */}
                  <p
                    className="peak-direction-note chart-inapplicable"
                    data-testid="chart-inapplicable"
                    /* ⚠️ 這一句同時交代了三個條件，守門看的就是這個屬性。 */
                    data-inapplicable="directions flowView metric"
                    /* ⚠️ 這一句是**常駐**的（不是只在被篩時出現）：
                       「不受車流方向影響」本來就要一直講，不然使用者每次
                       切方向都會再問一次。反面守門要排除它。 */
                    data-inapplicable-always="1"
                  >
                    <b>這一張不受上方「車流方向」篩選影響。</b>
                    駛出與駛入兩種視角的<b>總計相同</b>，所以換視角這個數字也不會變；
                    這張卡固定以 PCU／小時計算，不隨「顯示數值」變。
                    <br />
                    {/*
                     * ⚠️ 這兩句要**跟著「尖峰時段認定」換**。
                     *
                     * 大檢查（2026-09-15）查到的錯：這張卡根本沒有吃
                     * 「尖峰時段認定」——底層的 peaksByDayOf() 連這個參數都沒有。
                     * 於是使用者切成「各方向各自認定自己的尖峰」時，
                     * 卡片仍然用「整個調查點同一時段」算，而且還寫著
                     * 「全部方向同一時段」——**畫面在說一件與他的選擇相反的事**。
                     *
                     * 現在：point ＝ 同一小時、可相加（原本的行為）；
                     * direction ＝ 各方向各取自己最忙的那一小時，**不可相加**，
                     * 所以下面不印「全部方向合計」那一列。
                     */}
                    {mainFilters.peakScope === "direction" ? (
                      <>
                        目前的「尖峰時段認定」是
                        <b>各方向各自認定自己的尖峰</b>：下面每一個方向取的是
                        <b>自己最忙的那一小時</b>（常常不是同一小時），
                        因此<b>各方向不可以相加</b>，也不會印合計。
                      </>
                    ) : (
                      <>
                        一個尖峰小時要能拆給各方向、再加回來，各方向就必須取
                        <b>同一個小時</b>——所以這裡固定用全部方向合計最大的那一個
                        小時，各方向在那個小時各有多少列在下面。
                      </>
                    )}
                    <br />
                    平日與假日<b>各自</b>有自己的尖峰小時（常常不同），所以是
                    一個日別一組。
                  </p>
                  {/* ⚠️ X-28：多個調查點時整張卡不給數字，逐方向明細與算式
                      也一併不列——那些數字的來源是同一份被加起來的資料。 */}
                  {!kpiLines.multiPoint &&
                  peakGroups.flatMap((group) =>
                    (dayType === "平日＋假日"
                    ? group.peaks.byDay
                    : group.peaks.byDay.slice(0, 1)
                  ).map((peak) => {
                    /*
                     * ⚠️ 「各方向各自認定自己的尖峰」時，每一個方向要取
                     *   **自己最忙的那一小時**，不是整體尖峰那一小時。
                     *   （大檢查 2026-09-15 查到這張卡完全沒吃這個條件。）
                     */
                    const ownScope = mainFilters.peakScope === "direction";
                    const rows = group.peaks.items
                      .map((item) => ({
                        item,
                        at: ownScope
                          ? {
                              /* ownPeak 回傳 [時段文字, 值]，沒有 start；
                                 這裡只拿來顯示，所以 start 給 0 讓它通過過濾。 */
                              start: item.ownPeak[1] > 0 ? 0 : -1,
                              value: item.ownPeak[1],
                              label: item.ownPeak[0],
                            }
                          : item.atPeak(peak.day, peak.start),
                      }))
                      .filter((row) => row.at.start >= 0);
                    return (
                      <div
                        className="peak-directions"
                        key={`${group.key}-${peak.day || "all"}`}
                      >
                        <b className="peak-directions-head">
                          {/* 並列時每一組都要自己寫明是上午還是下午的尖峰。 */}
                          {peakGroups.length > 1 ? `${group.label} ` : ""}
                          {peak.day ? `${peak.day} ` : ""}
                          {peak.label}
                        </b>
                        {rows.map(({ item, at }) => (
                          <span
                            key={item.code}
                            /* 你現在選的那一個方向要看得出來，不然還要自己對代碼。 */
                            className={
                              directions.includes(item.code)
                                ? "picked"
                                : undefined
                            }
                          >
                            <b>{item.name}</b>
                            {/*
                              單位要跟抬頭同一支算出來的走。舊版這裡寫死
                              「PCU／小時」，但抬頭是 cellUnitFor 算的；
                              尖峰視窗湊不滿或超過 60 分鐘時，抬頭會寫
                              「PCU/該時段（45 分鐘）」而這裡仍寫「PCU／小時」，
                              同一張卡片對同一個數字給兩種單位。
                            */}
                            {decimalFormatter.format(at.value)} {peakCardUnit}
                            <em>
                              {/* 同一個代碼涵蓋多個調查點時一定要講，
                                  否則會被當成單一路段的尖峰量。 */}
                              {mainFilters.peakScope === "direction"
                                ? `自己最忙的 ${at.label ?? ""}`
                                : item.roadCount > 1
                                  ? `${item.roadCount} 個調查點合計`
                                  : "在同一個尖峰小時"}
                              {/*
                               * ⚠️ 這個方向自己最忙的時段如果不是同一個小時，
                               *   一定要講出來——否則使用者會以為「方向A 最忙
                               *   就是早上」，而事實可能是傍晚。
                               *   但它**不是**上面那個數字的時段，所以措辭要
                               *   明確分開，不可以並排成一個「同時段」的清單。
                               */}
                              {mainFilters.peakScope !== "direction" &&
                              item.ownPeak[0] &&
                              item.ownPeak[0] !== "—" &&
                              !item.ownPeak[0].includes(peak.label)
                                ? `・自己最忙是 ${item.ownPeak[0]}（${decimalFormatter.format(item.ownPeak[1])}）`
                                : ""}
                            </em>
                          </span>
                        ))}
                        {/*
                         * ⚠️ 「各方向各自認定」時**不可以**印合計。
                         *   各方向取的是不同小時，加起來會是一個現實中
                         *   不存在的數字——而它會被抄進報告。
                         *   這裡改成印一句話，明白說為什麼沒有合計。
                         */}
                        {ownScope ? (
                          <span className="peak-directions-total peak-no-total">
                            <b>沒有合計</b>
                            各方向取的是各自最忙的小時（不同小時），
                            <b>相加會得到一個不存在的數字</b>。要可相加的合計，
                            請把「尖峰時段認定」切回「整個調查點同一時段」。
                          </span>
                        ) : (
                        <span className="peak-directions-total">
                          <b>全部方向合計</b>
                          {decimalFormatter.format(peak.value)} {peakCardUnit}
                          <em>
                            {/*
                             * ⚠️ 這一行是「加起來對不對」的自我檢查。
                             *   各方向既然都在同一個視窗裡取值，加起來就必須
                             *   等於這個合計；對不上代表有資料沒有被任何一個
                             *   方向代碼涵蓋到，那要說出來，不可以默默吃掉。
                             */}
                            {/*
                             * ⚠️ 這一行要把**算式整個寫出來**，不是只寫
                             *   「＝上面各方向相加」。
                             *
                             * 使用者 2026-09-12：「計算我很難幫你驗算，
                             * 請務必小心嚴謹檢查……能把你剛寫的換算式寫在最下方」。
                             * 他要的是**自己按計算機就能核對**的東西——
                             * 一句「相加正確」是要他相信程式，算式才是證據。
                             */}
                            {(() => {
                              const sum = rows.reduce(
                                (total, row) => total + row.at.value,
                                0,
                              );
                              const formula = rows
                                .map((row) => decimalFormatter.format(row.at.value))
                                .join(" ＋ ");
                              return Math.abs(sum - peak.value) < 0.05
                                ? `${formula} ＝ ${decimalFormatter.format(peak.value)}`
                                : `⚠️ ${formula} ＝ ${decimalFormatter.format(sum)}，與合計差 ${decimalFormatter.format(peak.value - sum)}（有資料沒有被任何方向代碼涵蓋到）`;
                            })()}
                          </em>
                        </span>
                        )}
                      </div>
                    );
                  }),
                  )}
                </article>
              </div>
              {/*
               * ── 圖表區的順序 ──────────────────────────────────────
               *
               * 使用者指定的順序：**車種 → 一天之內 → 跨季 → 同季平假日**。
               * 由「這一季的組成」往外走，捲下去的過程本身就是一條敘事線，
               * 而不是幾張圖的清單。
               *
               * ⚠️ 舊版把三張圖塞進 .chart-grid 的兩欄裡（車種組成與每小時
               * 擠在 0.8fr 的右欄），每小時那張 245px 高的畫布在窄欄裡被壓得
               * 很扁。改成一張一列、各自佔滿寬度。
               *
               * ⚠️ v20.64 移除了「路段排名」與「跨計畫整體比較」兩張圖
               *（使用者 2026-09-09 分別明確指名）。路段排名的資訊沒有消失——
               * 同一份 roadRows 仍然出現在下方「可追溯明細」與匯出的
               *「本季交通量及PCU」工作表，只是不再多畫一張長條圖。
               */}
            </>
          )}
          {/*
           * ══════════════════════════════════════════════════════════
           *  X-63：「四　圖表與比較」的四張圖各自一個大分頁
           * ══════════════════════════════════════════════════════════
           *
           * 使用者 2026-09-17：「有4個大分頁，車種組成/24小時型態/歷季分析/
           *   同季平假日，能否點其中一個大分頁，右邊的畫面，就單純只有這個
           *   大分頁的內容，不要往下滾動畫面時，就會看到其它大分頁的內容。」
           *
           * ⚠️ 四頁**共用**上面那幾句「這一區不適用的條件」——
           *   那是這四張圖共同的性質（都不吃顯示數值、都排不出駛出＋駛入並列）。
           *   每一頁各印一次是對的：使用者一次只看得到一頁，
           *   掛在別頁上的說明等於沒有（這是 2026-09-15 定下的規則：
           *   「請確保每個圖表都要有各自的不適用說明」）。
           * ⚠️ `.chart-stack` 這一層**保留**：它負責塊與塊之間的間距，
           *   拿掉之後單張圖的上下留白會與其他頁不一致。
           */}
          {view === "page-composition" && (
            <>
              <PageHeading pageId="page-composition" />
              {/*
               * ⚠️ 「顯示數值」對這一區不適用：每一張圖自己就決定畫什麼
               *  （車種組成是佔比、24 小時型態是實際量與 PCU 兩條、
               *    歷季分析有自己的「指標」選單）。
               *   硬套一個顯示數值只會讓圖與圖說對不起來。
               */}
              {renderUnusedConditions(
                ["metric"],
                "這一區每一張圖自己決定畫什麼（車種組成是佔比、24 小時型態同時畫實際量與 PCU、歷季分析有自己的「指標」選單）。",
              )}
              {/*
               * ⚠️ 「駛出＋駛入並列」這一區畫不出來：一張圓環／一條折線
               *   只能是一個視角。畫得出並列的是「時段車種分析」那一塊。
               */}
              {renderInapplicable(
                mainFilters.flowView === "both",
                inapplicableNote(
                  "本區的圓環圖與折線圖一次只畫得了一個視角，排不出「駛出＋駛入並列」；要並列請看「時段車種分析」那一塊。",
                  "駛出路口（起點）",
                ),
              )}
              {/*
               * ⚠️ 只有路口格式的調查點會受「路口流量視角」影響；
               *   目前結果全是路段時切了不會變，這要講出來，
               *   否則使用者會以為篩選壞掉（同樣的說明匯出中心早就有了）。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  !hasIntersectionRecords,
                inapplicableNote(
                  "「路口流量視角」只對路口格式的調查點有意義；目前的結果裡沒有路口格式，所以切了不會有變化。",
                  "方向 A／方向 B",
                ),
              )}
              {/*
               * ⚠️ 有路口資料時也要講：這一區的圖畫的是**合計**
               *  （車種組成是各車種佔整體的比例、24 小時型態是每小時總量），
               *   而兩種視角的總計本來就相同，只有各支線的分佈不同。
               *   不講的話，使用者切了沒反應會以為篩選壞掉。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  hasIntersectionRecords,
                inapplicableNote(
                  "駛出與駛入兩種視角的總計相同，只有各支線的分佈不同；這一區的圖畫的是合計（車種組成是各車種佔整體的比例、24 小時型態是每小時總量），所以切視角數字不會變。要看各支線的分佈請到「可追溯明細」或「時段車種分析」。",
                  "整個調查點的合計",
                ),
              )}
              {/*
               * ⚠️ 「尖峰時段認定」只改變**尖峰小時的挑法**。
               *   車種組成與同季平假日比較統計的是整段調查的量，不挑尖峰，
               *   所以它們不受影響——要講出來。
               */}
              {renderUnusedConditions(
                ["peakScope"],
                "同季平假日比較統計的是整段調查的量，不挑尖峰小時；車種組成挑尖峰那一小時時一律用「整個調查點同一時段」；「24 小時型態」畫的是每一個小時本身。要看依各方向各自認定的尖峰數字請到「時段車種分析」。",
              )}
              <div className="chart-stack">
                <article
                  className={focusClass("block-composition", "panel composition")}
                  id="block-composition"
                  data-consumes={BLOCK_CONSUMES["block-composition"]}
                >
                  {/*
                   * ⚠️ 每一塊都要**自己**交代不適用的條件。
                   *
                   * 使用者 2026-09-15：「偶爾會出現某張圖有出現提醒文字，
                   *   卻對某一個篩選條件卻沒出現不受影響的提醒文字」。
                   *
                   * 這一區原本把說明掛在**整個分區的最上面**（三張圖共用一句），
                   * 於是：① 說明離圖很遠，看圖的人不會把兩者連起來；
                   * ② 逐塊檢查時這一塊等於一句都沒有。說明要貼在它講的那張圖上。
                   */}
                  {renderUnusedConditions(
                    ["flowView", "peakScope", "metric"],
                    "這張圖畫的是整個調查點的合計占比：兩種路口視角的總計相同；主工具列選了尖峰時段時，這裡一律以「整個調查點同一時段」挑那一小時（不依各方向各自認定）；而且它本來就同時給輛數與百分比，不隨「顯示數值」變。",
                  )}
                  <div className="panel-title composition-heading">
                    <div>
                      <span>車種組成</span>
                      {/* 抬頭一律印共同功能列那一份，與下面的數字同一個來源。 */}
                      <h3>{compositionScopeText}</h3>
                    </div>
                    <div className="panel-actions">
                      <small>%・輛數</small>
                      {!compositionByDay && (
                        <ChartPngButton
                          chartId="composition"
                          onClick={() => downloadCompositionPng()}
                        />
                      )}
                    </div>
                  </div>
                  {/*
                   * ⚠️ 這一排選擇器改的是**共同功能列的那一份條件**，
                   *   不是自己一份（v20.68）。
                   *
                   * 使用者 2026-09-12：「圓形圖的功能列是自己一套，上面的
                   * 共同功能列無法影響到它嗎?」——原本確實是自己一套，
                   * 於是上面選了「神農路・方向A」往下捲，這張圖還在講別的
                   * 路段，而畫面上沒有任何地方提醒你。這種錯不會壞掉，
                   * 只會讓人**看錯圖**。
                   *
                   * ⚠️ 選擇器**留在原地**——使用者本來就是在這裡改的，
                   *   拿掉會逼他每次都捲回最上面。改的是同一份而已。
                   */}
                  {renderBlockFilters(
                    { day: true, road: true, direction: true },
                    CHART_COMPOSITION,
                  )}
                  {compositionByDay ? (
                    /*
                     * 「平日＋假日」：兩個圓環並排，各自一份明細與一份說明。
                     * 使用者 2026-09-10 指名（先前 (a)/(b)/(c) 那一題，他選 (b)）。
                     */
                    <div className="donut-pair">
                      {compositionByDay.map((entry, index) => (
                        <section className="donut-day" key={entry.key}>
                          <h4>
                            <span>
                              {entry.label}
                              <small>
                                {formatter.format(entry.totals.total)} 輛
                                {entry.totals.total
                                  ? ""
                                  : "・本季沒有這一種日別的調查"}
                              </small>
                            </span>
                            {/*
                             * ⚠️ 平日與假日**各存各的**，不合成一張。
                             *   合成一張的話，使用者要的是哪一天的組成
                             *   就講不清楚了；而這張圖是要貼進報告的。
                             */}
                            <ChartPngButton
                              chartId={`composition-${entry.key}`}
                              label={`下載${entry.label}高解析圖片`}
                              onClick={() => downloadCompositionPng(entry.key)}
                            />
                          </h4>
                          <div className="chart-with-note">
                            <div className="chart-with-note-main">
                              <div
                                className="donut"
                                style={{ background: entry.gradient }}
                              >
                                <div>
                                  <strong>
                                    {formatter.format(entry.totals.total)}
                                  </strong>
                                  <small>{entry.unit}</small>
                                </div>
                              </div>
                              <div className="composition-list">
                                {entry.items.map((item) => (
                                  <div key={item.key}>
                                    <span>
                                      <i style={{ background: item.color }} />
                                      {item.label}
                                    </span>
                                    <strong>
                                      {pct(item.count, entry.totals.total)}
                                    </strong>
                                    <small>
                                      {formatter.format(item.count)} 輛
                                    </small>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {compositionDayNotes?.[index] ? (
                              <ChartNoteBox note={compositionDayNotes[index]} />
                            ) : null}
                          </div>
                        </section>
                      ))}
                      {/*
                       * ⚠️ 2026-09-18 使用者裁示（F-10）：多個調查點時原本在這裡印一段
                       *   「合計組成比例（機車 57.1%、…）…比例是分子總和÷分母總和」——
                       *   那是跨調查點合併算的比例，與 09-16「多路段則每個路段都分別計算」
                       *   相衝，而且只列三類（加起來 99.3%）。裁示：**整段拿掉**。
                       *   單一調查點（平日＋假日兩個圓環）那一段照舊。
                       */}
                      {/*
                       * F-30（2026-09-18 使用者裁示 A）：單一調查點的「兩天合計 N 輛（…）」也拿掉——
                       *   平日＋假日相加沒有應用意義，「平日＋假日」指的是並列顯示。
                       */}
                    </div>
                  ) : (
                    <div className="chart-with-note">
                      <div className="chart-with-note-main">
                        <div
                          className="donut"
                          style={{ background: compositionGradient }}
                        >
                          <div>
                            <strong>
                              {formatter.format(compositionTotals.total)}
                            </strong>
                            <small>{compositionUnit}</small>
                          </div>
                        </div>
                        <div className="composition-list">
                          {compositionItems.map((item) => (
                            <div key={item.key}>
                              <span>
                                <i style={{ background: item.color }} />
                                {item.label}
                              </span>
                              <strong>
                                {pct(item.count, compositionTotals.total)}
                              </strong>
                              <small>{formatter.format(item.count)} 輛</small>
                            </div>
                          ))}
                        </div>
                      </div>
                      <ChartNoteBox note={compositionChartNote} />
                    </div>
                  )}
                </article>
              </div>
            </>
          )}
          {view === "page-hourly" && (
            <>
              <PageHeading pageId="page-hourly" />
              {/*
               * ⚠️ 「顯示數值」對這一區不適用：每一張圖自己就決定畫什麼
               *  （車種組成是佔比、24 小時型態是實際量與 PCU 兩條、
               *    歷季分析有自己的「指標」選單）。
               *   硬套一個顯示數值只會讓圖與圖說對不起來。
               */}
              {renderUnusedConditions(
                ["metric"],
                "這一區每一張圖自己決定畫什麼（車種組成是佔比、24 小時型態同時畫實際量與 PCU、歷季分析有自己的「指標」選單）。",
              )}
              {/*
               * ⚠️ 「駛出＋駛入並列」這一區畫不出來：一張圓環／一條折線
               *   只能是一個視角。畫得出並列的是「時段車種分析」那一塊。
               */}
              {renderInapplicable(
                mainFilters.flowView === "both",
                inapplicableNote(
                  "本區的圓環圖與折線圖一次只畫得了一個視角，排不出「駛出＋駛入並列」；要並列請看「時段車種分析」那一塊。",
                  "駛出路口（起點）",
                ),
              )}
              {/*
               * ⚠️ 只有路口格式的調查點會受「路口流量視角」影響；
               *   目前結果全是路段時切了不會變，這要講出來，
               *   否則使用者會以為篩選壞掉（同樣的說明匯出中心早就有了）。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  !hasIntersectionRecords,
                inapplicableNote(
                  "「路口流量視角」只對路口格式的調查點有意義；目前的結果裡沒有路口格式，所以切了不會有變化。",
                  "方向 A／方向 B",
                ),
              )}
              {/*
               * ⚠️ 有路口資料時也要講：這一區的圖畫的是**合計**
               *  （車種組成是各車種佔整體的比例、24 小時型態是每小時總量），
               *   而兩種視角的總計本來就相同，只有各支線的分佈不同。
               *   不講的話，使用者切了沒反應會以為篩選壞掉。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  hasIntersectionRecords,
                inapplicableNote(
                  "駛出與駛入兩種視角的總計相同，只有各支線的分佈不同；這一區的圖畫的是合計（車種組成是各車種佔整體的比例、24 小時型態是每小時總量），所以切視角數字不會變。要看各支線的分佈請到「可追溯明細」或「時段車種分析」。",
                  "整個調查點的合計",
                ),
              )}
              {/*
               * ⚠️ 「尖峰時段認定」只改變**尖峰小時的挑法**。
               *   車種組成與同季平假日比較統計的是整段調查的量，不挑尖峰，
               *   所以它們不受影響——要講出來。
               */}
              {renderUnusedConditions(
                ["peakScope"],
                "同季平假日比較統計的是整段調查的量，不挑尖峰小時；車種組成挑尖峰那一小時時一律用「整個調查點同一時段」；「24 小時型態」畫的是每一個小時本身。要看依各方向各自認定的尖峰數字請到「時段車種分析」。",
              )}
              <div className="chart-stack">
                <article
                  className={focusClass("block-hourly", "panel hourly")}
                  id="block-hourly"
                  data-consumes={BLOCK_CONSUMES["block-hourly"]}
                >
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
                      {hourlyRoadIds.length <= 1 && (
                        <ChartPngButton
                          chartId="hourly"
                          onClick={function () {
                            void downloadHourlyPng();
                          }}
                        />
                      )}
                    </div>
                  </div>
                  {renderBlockFilters(
                    {
                    quarter: true,
                    day: true,
                    road: true,
                    flow: true,
                    direction: true,
                    },
                    CHART_HOURLY,
                  )}
                  {/*
                   * ⚠️ 「調查時段」對這張圖**不適用**，但不可以什麼都不做。
                   *   它的橫軸就是 0～23 時，篩「上午尖峰小時」只會剩一根柱子
                   *  ——那不是篩選，是把圖毀了。
                   *   所以照樣畫整天，並在這裡寫明主工具列現在選的是什麼。
                   */}
                  {renderInapplicable(
                    isFiltered(
                      filtersFor(mainFilters, chartOverrides, CHART_HOURLY),
                      "period",
                    ),
                    inapplicableNote(
                      `主工具列的「調查時段」目前是「${
                        PERIOD_CHOICE_LABELS[
                          filtersFor(mainFilters, chartOverrides, CHART_HOURLY)
                            .period
                        ]
                      }」；本圖是逐時圖，縮成一根柱子就不是型態圖了，因此不套用這個條件。`,
                      "整段調查的每一個小時",
                    ),
                    ["period"],
                  )}
                  {/*
                   * 另外兩個條件也要交代（使用者 2026-09-15）：
                   * 這張圖畫的是每一個小時本身，不挑尖峰；兩條線的單位固定
                   * （一條輛數、一條 PCU），不隨「顯示數值」變。
                   */}
                  {renderUnusedConditions(
                    ["peakScope", "metric"],
                    "這張圖畫的是每一個小時本身，不挑尖峰小時；兩條線固定是「實際交通量（輛）」與「PCU」，不隨顯示數值變。",
                  )}
                  {/*
                   * X-80：兩個以上調查點時**一個調查點一張圖**，不加總。
                   * 理由見 hourlyRoadIds 那一段（絕對交通量不可以跨點相加，
                   * 而且合起來的最高點不一定是任何一點自己的尖峰時刻）。
                   */}
                  <div className="chart-with-note">
                    <div className="chart-with-note-main">
                      {hourlyRoadIds.length > 1 ? (
                        <div
                          className="hourly-split"
                          data-testid="hourly-split"
                          data-count={hourlyRoadIds.length}
                        >
                          {/*
                           * ⚠️ X-80 追記（使用者 2026-09-18）：
                           *   「圖上不需要寫明『不加總』與理由，這些可以納入
                           *     新手使用手冊說明就好」
                           *   所以這裡**不放整段理由**，只留一行讓人知道
                           *   「為什麼變成好幾張」——每一張圖有自己的調查點名稱，
                           *   那一行就夠了。完整理由寫在手冊第 9 章。
                           */}
                          <p className="kpi-scope-note hourly-split-note">
                            已選 {hourlyRoadIds.length} 個調查點，一個調查點一張圖。
                          </p>
                          {hourlyRoadIds.map(([roadId, roadName]) => (
                            <figure
                              key={roadId}
                              className="hourly-one"
                              data-road={roadId}
                            >
                              <figcaption>
                                <span>{roadName || roadId}</span>
                                {/* F-24：一張圖一顆下載鈕，下載的就是這一張（不是全部相加）。 */}
                                <ChartPngButton
                                  chartId={`hourly-${roadId}`}
                                  label={`下載${roadName || roadId}高解析圖片`}
                                  onClick={function () {
                                    void downloadHourlyPng(roadId);
                                  }}
                                />
                              </figcaption>
                              <HourlyCanvas
                                records={hourlyRecords.filter(
                                  (r) => r.roadId === roadId,
                                )}
                                factors={pcuFactors}
                                turnFactors={turnPcuFactors}
                                vehicleSettings={vehicleClassSettings}
                                scopes={pcuScopes}
                              />
                            </figure>
                          ))}
                        </div>
                      ) : (
                        <HourlyCanvas
                          records={hourlyRecords}
                          factors={pcuFactors}
                          turnFactors={turnPcuFactors}
                          vehicleSettings={vehicleClassSettings}
                          scopes={pcuScopes}
                        />
                      )}
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
                    </div>
                    <ChartNoteBox note={hourlyChartNote} />
                  </div>
                </article>
              </div>
            </>
          )}
          {view === "page-trend" && (
            <>
              <PageHeading pageId="page-trend" />
              {/*
               * ⚠️ 「顯示數值」對這一區不適用：每一張圖自己就決定畫什麼
               *  （車種組成是佔比、24 小時型態是實際量與 PCU 兩條、
               *    歷季分析有自己的「指標」選單）。
               *   硬套一個顯示數值只會讓圖與圖說對不起來。
               */}
              {renderUnusedConditions(
                ["metric"],
                "這一區每一張圖自己決定畫什麼（車種組成是佔比、24 小時型態同時畫實際量與 PCU、歷季分析有自己的「指標」選單）。",
              )}
              {/*
               * ⚠️ 「駛出＋駛入並列」這一區畫不出來：一張圓環／一條折線
               *   只能是一個視角。畫得出並列的是「時段車種分析」那一塊。
               */}
              {renderInapplicable(
                mainFilters.flowView === "both",
                inapplicableNote(
                  "本區的圓環圖與折線圖一次只畫得了一個視角，排不出「駛出＋駛入並列」；要並列請看「時段車種分析」那一塊。",
                  "駛出路口（起點）",
                ),
              )}
              {/*
               * ⚠️ 只有路口格式的調查點會受「路口流量視角」影響；
               *   目前結果全是路段時切了不會變，這要講出來，
               *   否則使用者會以為篩選壞掉（同樣的說明匯出中心早就有了）。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  !hasIntersectionRecords,
                inapplicableNote(
                  "「路口流量視角」只對路口格式的調查點有意義；目前的結果裡沒有路口格式，所以切了不會有變化。",
                  "方向 A／方向 B",
                ),
              )}
              {/*
               * ⚠️ 有路口資料時也要講：這一區的圖畫的是**合計**
               *  （車種組成是各車種佔整體的比例、24 小時型態是每小時總量），
               *   而兩種視角的總計本來就相同，只有各支線的分佈不同。
               *   不講的話，使用者切了沒反應會以為篩選壞掉。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  hasIntersectionRecords,
                inapplicableNote(
                  "駛出與駛入兩種視角的總計相同，只有各支線的分佈不同；這一區的圖畫的是合計（車種組成是各車種佔整體的比例、24 小時型態是每小時總量），所以切視角數字不會變。要看各支線的分佈請到「可追溯明細」或「時段車種分析」。",
                  "整個調查點的合計",
                ),
              )}
              {/*
               * ⚠️ 「尖峰時段認定」只改變**尖峰小時的挑法**。
               *   車種組成與同季平假日比較統計的是整段調查的量，不挑尖峰，
               *   所以它們不受影響——要講出來。
               */}
              {renderUnusedConditions(
                ["peakScope"],
                "同季平假日比較統計的是整段調查的量，不挑尖峰小時；車種組成挑尖峰那一小時時一律用「整個調查點同一時段」；「24 小時型態」畫的是每一個小時本身。要看依各方向各自認定的尖峰數字請到「時段車種分析」。",
              )}
              <div className="chart-stack">
                <article
                  className={focusClass("block-trend", "panel trend-panel")}
                  id="block-trend"
                  data-consumes={BLOCK_CONSUMES["block-trend"]}
                >
                  {/*
                   * ── 釘住區（sticky）────────────────────────────────────
                   *
                   * 使用者 2026-09-10 實測回報三件事，三個成因不同：
                   *  ①「圖標題和單位就消失在畫面了」
                   *     → 釘住的容器比視窗還高時，sticky 只保證上緣貼住，
                   *       被切掉的一定是最上面那幾行。修法是讓**圖跟著縮**，
                   *       不是讓容器溢出。
                   *  ②「我該如何解除圖片固定的效果?」
                   *     → **不需要按鈕**。sticky 只在包含區塊（這個 article）
                   *       裡黏住，捲出這一塊就自動放開。
                   *  ③「想換下一個路段，我又得一直往上滑到功能列」
                   *     → 標題那一列本來就帶著路段／日別選擇器，
                   *       一起釘住就解決了，不必另外做一份。
                   *
                   * ⚠️ 釘住的是「標題＋選擇器＋圖」，**說明講稿不釘**——
                   *    那一段本來就是要捲的東西。
                   */}
                  {/*
                   * ⚠️ 這張圖不吃**六個**主工具列條件，一句都不能少。
                   *
                   * 使用者 2026-09-15（附圖）：「全日交通量平日／假日趨勢圖
                   *   **不受什麼篩選條件影響，沒有列出來**」——他是對的，
                   *   這一塊原本一句不適用說明都沒有。
                   *
                   * 逐條件的理由（寫在同一句裡，不分成六句）：
                   *   ・日別　　→ 平日與假日是**兩條線**，不是篩掉一條
                   *   ・車流方向→ 這張畫的是整個調查點的合計
                   *   ・調查時段→ 它比的是「一整天的量」跨季怎麼變
                   *   ・路口視角→ 兩種視角的總計相同
                   *   ・尖峰認定→ 不挑尖峰小時
                   *   ・顯示數值→ 指標由圖右上角自己的下拉決定
                   */}
                  {/*
                   * ⚠️ 2026-09-18 大檢查（F-13）：「日別」**不在**這份清單裡。
                   *   這張圖的日別就是主工具列那一份（trendMode＝filtersOf(CHART_TREND).day，
                   *   可脫離），主工具列選「假日」它就只畫假日線。舊句子寫著
                   *   「平日與假日是兩條線（不是篩掉一條）」，實測改主工具列日別
                   *   線數與講稿數字都跟著變——那是舊行為的殘留說明（與 X-84 同類），
                   *   畫面在說謊。要並列兩天請把日別選成「平日＋假日」。
                   */}
                  {renderUnusedConditions(
                    ["directions", "period", "flowView", "peakScope", "metric"],
                    "這張圖畫的是整個調查點「一整天的量」逐季的變化：不分車流方向、兩種路口視角的總計相同、不挑尖峰小時，指標則由圖右上角自己的下拉決定。日別跟著主工具列走：選「平日＋假日」時平日與假日各一條線。",
                  )}
                  {/*
                   * ⚠️ 這一塊的工具列是**手寫的**（要釘在標題列上），沒有走
                   *   renderBlockFilters()，所以脫離時的那一條說明＋回歸鈕
                   *   要在這裡自己掛一次。
                   *   使用者 2026-09-16：「這張圖我用自己的工具列篩選後，
                   *   主工具列有正確跳出回歸，但這張圖沒有跳出回歸主工具列的選項」。
                   * ⚠️ 掛在圖**上面**：使用者要先知道「現在看到的是自己的條件」，
                   *   再看圖；掛在圖下面的話他已經先把數字讀進去了。
                   */}
                  {renderDetachNote(CHART_TREND)}
                  <div className="trend-pinned">
                    <div className="panel-title">
                      <div>
                        <span>歷季分析</span>
                        <h3>全日交通量平日／假日趨勢</h3>
                      </div>
                      <div className="trend-controls">
                        {/*
                         * ⚠️ 這裡改的是**共同功能列的那一份**路段條件
                         *   （v20.68），不是趨勢圖自己一份。
                         *   選擇器留在原地——使用者 2026-09-11 指定要能在
                         *   釘住的標題列上直接換路段，不必捲回最上面。
                         */}
                        <div className="filter-field">
                          <span className="filter-field-label">路段／路口</span>
                          <MultiPicker
                            label="路段／路口"
                            allLabel="全部路段"
                            options={roadOptions}
                            value={roadFilters}
                            onChange={setRoadFilters}
                          />
                        </div>
                        <select
                          value={trendMode}
                          onChange={(e) =>
                            setTrendMode(e.target.value as TrendMode)
                          }
                        >
                          <option>平日＋假日</option>
                          <option>平日</option>
                          <option>假日</option>
                        </select>
                        <select
                          id="trendMetric"
                          value={trendMetric}
                          onChange={(e) => {
                            setTrendMetric(e.target.value as TrendMetricId);
                            /* 換指標就把上一個指標選到的車種清掉，免得沿用到不相干的鍵。 */
                            setTrendVehicle("");
                          }}
                        >
                          {TREND_METRICS.map((metric) => (
                            <option value={metric.id} key={metric.id}>
                              {metric.id === "pcu" && surveyScope.partial
                                ? "調查時段 PCU"
                                : metric.label}
                            </option>
                          ))}
                        </select>
                        {trendMetricDef.picker === "vehicle" &&
                          trendVehicleOptions.length > 0 && (
                            <select
                              id="trendVehicle"
                              value={activeTrendVehicle}
                              onChange={(e) => setTrendVehicle(e.target.value)}
                            >
                              {trendVehicleOptions.map(([key, name]) => (
                                <option value={key} key={key}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          )}
                      </div>
                    </div>
                    {/*
                      * ⚠️ 逐點分列時**一定要講**。
                      *   圖從「一條線」變成「好幾條線」是使用者看得到的變化，
                      *   不講的話他會以為篩選壞了；更要緊的是要讓他知道
                      *   **舊版那一條線是錯的**（不同調查點相加），
                      *   否則他會拿新圖去對舊報告，然後懷疑新版算錯。
                      */}
                    {trendPerRoad && (
                      <p
                        className="kpi-scope-note trend-per-road-note"
                        data-testid="trend-per-road-note"
                      >
                        已選 {trendRoadIds.length} 個調查點，本圖改為
                        <strong>一個調查點一條線</strong>
                        ，不畫合計：
                        {trendMetric === "vehicleShare" || trendMetric === "heavyShare"
                          ? `每個調查點各用自己的分子總和除以分母總和計算${trendMetricDef.label}，不跨點合併，也不平均各點百分比。`
                          : `不同調查點的${trendMetricDef.label}相加不對應任何一條路的實際流量。`}
                        要看單一調查點的趨勢，
                        請在上方的「路段／路口」只選那一個。
                      </p>
                    )}
                    <ProfessionalLineChart
                      rows={trendRows}
                      /* 這張圖畫的是 trendRows（依 trendMode），單位要跟著它。 */
                      unit={trendUnit}
                      yTitle={trendAxisTitle}
                      canvasRef={trendCanvasRef}
                      quarterLabels={quarterLabels.labels}
                      lines={trendLines}
                    />
                  </div>
                  {/*
                   * 圖例已經畫在畫布裡面（見 ProfessionalLineChart）。
                   * 舊版的圖例是這裡的一段 HTML，把圖存成圖片或截圖貼進簡報時
                   * 完全看不出哪一條是平日、哪一條是假日——圖例是這張圖的一部分。
                   */}
                  <div className="trend-actions">
                    <button
                      type="button"
                      className="ghost chart-png-button"
                      id="trendDownloadPng"
                      data-chart-png="trend"
                      onClick={function () {
                        void downloadTrendPng();
                      }}
                      title="以 3 倍解析度重新繪製後下載；圖上只有圖，不含說明文字"
                    >
                      下載高解析圖片（PNG）
                      <small>只有圖，不含說明文字</small>
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      id="trendCopyScript"
                      onClick={copyTrendScript}
                    >
                      複製說明文字
                    </button>
                  </div>
                  {/*
                   * ── 圖表說明欄位（簡報講稿）────────────────────────
                   *
                   * 使用者的要求：把圖表放進簡報時，聽眾會想知道這張圖代表什麼
                   * 意義，所以旁邊要有一段可以照著念的說明。
                   *
                   * ⚠️ 這段文字**只讀上面那一份 trendRows**，不回頭重算。
                   * 圖與講稿分岔的時候，被念出來的是講稿——那比圖畫錯更難發現。
                   */}
                  {/*
                   * ⚠️ 這裡掛 data-chart-note 是刻意的，有兩個用途：
                   *
                   * 一、**它就是這張圖的「圖旁說明」**。使用者的要求是
                   *    「不管哪個程式，我希望圖旁邊都能有對應的、解讀該張圖代表的
                   *      意義的說明」——這一段講稿正是那個東西，而且比制式的
                   *      一段說明更完整（四個小節）。所以不再另外加一段制式說明：
                   *      同一張圖擺兩份解讀，讀的人只會困惑哪一份才算數。
                   * 二、**匯出的圖上不可以有說明文字**那條守門是靠這個屬性認人的。
                   *    講稿是 DOM 的一部分、不是畫布的一部分，掛上去之後
                   *    「匯出的 PNG／Excel 原生圖裡不可以出現這些字」才驗得到。
                   */}
                  <div
                    className="trend-script"
                    id="trendScript"
                    data-chart-note
                  >
                    {trendScriptSections.map((section) => (
                      <div className="trend-script-item" key={section.title}>
                        <h4>{section.title}</h4>
                        {section.lines.map((line, index) => (
                          <p
                            key={index}
                            className={
                              section.title === "要先講清楚的"
                                ? "trend-caveat"
                                : ""
                            }
                          >
                            {line}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </>
          )}
          {view === "page-comparison" && (
            <>
              <PageHeading pageId="page-comparison" />
              {/*
               * ⚠️ 「顯示數值」對這一區不適用：每一張圖自己就決定畫什麼
               *  （車種組成是佔比、24 小時型態是實際量與 PCU 兩條、
               *    歷季分析有自己的「指標」選單）。
               *   硬套一個顯示數值只會讓圖與圖說對不起來。
               */}
              {renderUnusedConditions(
                ["metric"],
                "這一區每一張圖自己決定畫什麼（車種組成是佔比、24 小時型態同時畫實際量與 PCU、歷季分析有自己的「指標」選單）。",
              )}
              {/*
               * ⚠️ 「駛出＋駛入並列」這一區畫不出來：一張圓環／一條折線
               *   只能是一個視角。畫得出並列的是「時段車種分析」那一塊。
               */}
              {renderInapplicable(
                mainFilters.flowView === "both",
                inapplicableNote(
                  "本區的圓環圖與折線圖一次只畫得了一個視角，排不出「駛出＋駛入並列」；要並列請看「時段車種分析」那一塊。",
                  "駛出路口（起點）",
                ),
              )}
              {/*
               * ⚠️ 只有路口格式的調查點會受「路口流量視角」影響；
               *   目前結果全是路段時切了不會變，這要講出來，
               *   否則使用者會以為篩選壞掉（同樣的說明匯出中心早就有了）。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  !hasIntersectionRecords,
                inapplicableNote(
                  "「路口流量視角」只對路口格式的調查點有意義；目前的結果裡沒有路口格式，所以切了不會有變化。",
                  "方向 A／方向 B",
                ),
              )}
              {/*
               * ⚠️ 有路口資料時也要講：這一區的圖畫的是**合計**
               *  （車種組成是各車種佔整體的比例、24 小時型態是每小時總量），
               *   而兩種視角的總計本來就相同，只有各支線的分佈不同。
               *   不講的話，使用者切了沒反應會以為篩選壞掉。
               */}
              {renderInapplicable(
                isFiltered(mainFilters, "flowView") &&
                  mainFilters.flowView !== "both" &&
                  hasIntersectionRecords,
                inapplicableNote(
                  "駛出與駛入兩種視角的總計相同，只有各支線的分佈不同；這一區的圖畫的是合計（車種組成是各車種佔整體的比例、24 小時型態是每小時總量），所以切視角數字不會變。要看各支線的分佈請到「可追溯明細」或「時段車種分析」。",
                  "整個調查點的合計",
                ),
              )}
              {/*
               * ⚠️ 「尖峰時段認定」只改變**尖峰小時的挑法**。
               *   車種組成與同季平假日比較統計的是整段調查的量，不挑尖峰，
               *   所以它們不受影響——要講出來。
               */}
              {renderUnusedConditions(
                ["peakScope"],
                "同季平假日比較統計的是整段調查的量，不挑尖峰小時；車種組成挑尖峰那一小時時一律用「整個調查點同一時段」；「24 小時型態」畫的是每一個小時本身。要看依各方向各自認定的尖峰數字請到「時段車種分析」。",
              )}
              <div className="chart-stack">
                <article
                  className={focusClass("block-comparison", "panel comparison-panel")}
                  id="block-comparison"
                  data-consumes={BLOCK_CONSUMES["block-comparison"]}
                >
                  {/*
                   * ⚠️ 這張圖不吃四個條件，每一個都要講（使用者 2026-09-15）。
                   *   ・日別　　→ 兩根柱子就是平日與假日，篩掉一種這張圖就沒有意義
                   *   ・調查時段→ 比的是整段調查的量
                   *   ・尖峰認定→ 不挑尖峰小時
                   *   ・顯示數值→ 兩根柱子固定同一個單位，由圖自己的下拉決定
                   */}
                  {renderUnusedConditions(
                    ["day", "period", "peakScope", "metric"],
                    "這張圖的兩根柱子就是平日與假日（所以日別不是篩選）；它比的是整段調查的量，不挑尖峰小時，單位由這張圖自己的下拉決定。",
                  )}
                  <div className="panel-title">
                    <div>
                      <span>同季平假日</span>
                      <h3>各路段平日與假日比較</h3>
                    </div>
                    <div className="panel-actions">
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
                          PCU
                        </button>
                      </div>
                      <ChartPngButton
                        chartId="comparison"
                        onClick={function () {
                          void downloadComparisonPng();
                        }}
                      />
                    </div>
                  </div>
                  {renderBlockFilters(
                    {
                    quarter: true,
                    road: true,
                    flow: true,
                    direction: true,
                    },
                    CHART_DAY_COMPARE,
                  )}
                  <div className="chart-with-note">
                    <div className="chart-with-note-main">
                      <div className="comparison-list">
                        {dayComparisons.map((r) => {
                          /*
                           * 單位要跟著調查涵蓋走。上面那顆切換鈕已經會在部分時段時
                           * 顯示「調查時段PCU」，這裡卻寫死「PCU／日」，同一個面板
                           * 上下兩行互相矛盾。
                           */
                          const w =
                              dayMetric === "actual"
                                ? r.weekdayActual
                                : r.weekdayPcu,
                            h =
                              dayMetric === "actual"
                                ? r.holidayActual
                                : r.holidayPcu,
                            unitOf = (coverage: SurveyCoverage) =>
                              dayMetric === "actual"
                                ? coverage.partial
                                  ? "輛／調查時段"
                                  : "輛／日"
                                : coverage.partial
                                  ? "PCU／調查時段"
                                  : "PCU／日",
                            wUnit = unitOf(r.weekdayCoverage),
                            hUnit = unitOf(r.holidayCoverage),
                            /* 沒做這個日別的調查，和「做了但量是 0」要分得開。 */
                            wDone = r.weekdaySurveyed,
                            hDone = r.holidaySurveyed;
                          return (
                            <div
                              className="comparison-row"
                              key={r.quarter ? `${r.roadId}||${r.quarter}` : r.roadId}
                            >
                              <div>
                                <strong>{r.roadName}</strong>
                                {/*
                                 * ⚠️ 稽核表 C：拆季之後同一條路段會有多列，
                                 *   不寫季別的話兩列長得一模一樣，使用者會以為畫重複了。
                                 *   只看一季時 r.quarter 是空字串，這一行不出現（舊畫面不變）。
                                 */}
                                <small>
                                  {r.roadId}
                                  {r.quarter ? `・${showQuarter(r.quarter)}` : ""}
                                </small>
                              </div>
                              <div className="comparison-bars">
                                <span>
                                  <b>平日</b>
                                  <i>
                                    <em
                                      style={{
                                        width: `${(w / maxDay) * 100}%`,
                                      }}
                                    />
                                  </i>
                                  <strong>
                                    {wDone
                                      ? `${decimalFormatter.format(w)} ${wUnit}`
                                      : "本季未調查"}
                                  </strong>
                                </span>
                                <span>
                                  <b>假日</b>
                                  <i>
                                    <em
                                      className="holiday"
                                      style={{
                                        width: `${(h / maxDay) * 100}%`,
                                      }}
                                    />
                                  </i>
                                  <strong>
                                    {hDone
                                      ? `${decimalFormatter.format(h)} ${hUnit}`
                                      : "本季未調查"}
                                  </strong>
                                </span>
                              </div>
                              {/*
                      兩個日別都調查過才算得出增減。少了這個判斷，只做平日的
                      季度會顯示「-100.0%」，讀起來像假日流量歸零。
                    */}
                              <div
                                className={
                                  hDone && r.coverageComparable && h >= w
                                    ? "delta up"
                                    : "delta down"
                                }
                                title={
                                  wDone && hDone && !r.coverageComparable
                                    ? "平日與假日的調查時段不同，不直接計算增減比例"
                                    : undefined
                                }
                              >
                                {wDone && hDone && r.coverageComparable && w
                                  ? pct(h - w, w)
                                  : wDone && hDone && !r.coverageComparable
                                    ? "涵蓋不同"
                                    : "—"}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <ChartNoteBox note={dayCompareChartNote} />
                  </div>
                </article>
              </div>
            </>
          )}
          {/*
           * ══════════════════════════════════════════════════════════
           *  X-63：「五　資料產出與維護」拆成六個大分頁
           * ══════════════════════════════════════════════════════════
           *
           * 使用者 2026-09-17 逐項指定：
           *   「應該有6個大分頁，分別是可追溯明細/時段車種分析/結論草稿產生器/
           *     報表批次輸出中心/資料異常檢查(小分頁：檢查按鈕、檢查摘要、門檻、
           *     檢查結果)/還原與備份(小分頁：刪除單一季度/備份本計畫/備份全部計畫/
           *     還原計畫/清除本機資料)，各大分頁右邊的畫面只顯示大分頁內容，
           *     不要穿插其它大分頁的東西。」
           *
           * ⚠️ 兩個名稱依 X-61 改成三支統一的講法（使用者同意並要求三支同步）：
           *     結論草稿產生器 → 大分頁叫「成果交付」
           *     報表批次輸出中心 → 大分頁叫「批次輸出」
           *   卡片本身的抬頭沒有改，所以它們仍以小分頁的身分列在底下。
           *
           * ⚠️ 「資料異常檢查」那四塊**刻意同頁**：使用者自己講的例外——
           *   「執行資料異常檢查按鈕與檢查摘要、檢查結果、門檻這些同一個畫面
           *     是 OK 的，他們是一體的」。沒按上面那顆鈕，下面三塊都是空的。
           */}
          {view === "page-detail" && (
            <>
              <PageHeading pageId="page-detail" />
              {/*
               * ⚠️ 「上午＋下午並列」這一區的表格排不出來：可追溯明細是
               *   一列一個調查點，並列會變成兩套欄位疊在一起。
               *   時段車種分析那一塊本來就一次列出全部時段，不受影響。
               */}
              {renderInapplicable(
                mainFilters.period === "AMPM",
                inapplicableNote(
                  "可追溯明細是一列一個調查點，排不出「上午＋下午並列」；下方「時段車種分析」本來就一次列出全部時段。",
                  "上午尖峰小時",
                ),
              )}
              {/*
               * ⚠️ X-17（2026-09-16）：原本這裡有一句「路口表排不出並列」。
               *   拿掉了——路口表**現在真的畫得出並列**（一個路口出兩列，
               *   每一列自己標明視角）。留著會變成「畫面上明明有並列、
               *   旁邊卻寫著排不出來」，那比沒有說明更糟。
               */}
              {/*
               * ⚠️ 沒有路段資料時**也要畫出來**，只是換成一句說明。
               *
               * 側欄列得出「可追溯明細」，畫面上就必須找得到對應的一塊。
               * 整個不渲染的話，使用者點了會覺得「按鈕壞了」——
               * 而那是錯的結論，他也不會再按第二次。
               * （同一個洞在「本季總覽」上被使用者 2026-09-12 實際踩到。）
               */}
              {/*
               * ⚠️ 2026-09-16 移除了原本掛在這裡的「空狀態卡片」。
               *
               *   它的用意是對的（「整個不渲染的話，使用者點了會覺得按鈕壞了」），
               *   但它與下面那一張**同時掛著 id="block-detail"**，而且判斷用的是
               *   主工具列的 roadOnlyRows、下面那一張用的是這一塊自己的 traceRoadRows——
               *   兩份條件不同步時會同時出現兩張、或兩張都不出現。
               *   現在下面那一張**一律渲染**並自己處理空狀態（而且帶著自己的工具列，
               *   使用者改得回來），所以這一張沒有存在的理由了。
               */}
              {(
                <article
                  className={focusClass("block-detail", "panel table-panel")}
                  id="block-detail"
                  data-consumes={BLOCK_CONSUMES["block-detail"]}
                >
                  {/*
                   * ⚠️ 「調查時段」對這張表不適用（使用者 2026-09-15）：
                   *   它是一列一個調查點，每一列本來就同時寫出全調查時段、
                   *   上午尖峰與下午尖峰三組數字，沒有可以篩掉的東西。
                   */}
                  {renderUnusedConditions(
                    ["period"],
                    "這張表一列一個調查點，每一列本來就同時寫出全調查時段、上午尖峰與下午尖峰，所以不需要（也沒辦法）再篩時段。",
                  )}
                  <div className="panel-title">
                    <div>
                      <span>可追溯明細・路段格式</span>
                      <h3>雙向路段交通量、PCU、尖峰時段與各車種占比</h3>
                    </div>
                    <small>
                      {traceRoadRows.length} 路段・維持方向 A／B 格式
                    </small>
                  </div>
                  {renderBlockFilters(
                    {
                    quarter: true,
                    day: true,
                    road: true,
                    direction: true,
                    },
                    CHART_TRACE,
                  )}
                  {/* ⚠️ 涵蓋提醒要照**這一塊自己的**資料算（見 coverageOfRecords）。 */}
                  {partialNoticeFor(traceScope)}
                  {/*
                   * ── X-16：沒有可列的資料時**不可以整張消失** ─────────
                   *
                   * 使用者 2026-09-16：「這張表忽然整張消失(因為沒資料)，
                   *   我一度以為系統錯誤」「主工具列的回歸全部按鍵顯示共2筆
                   *   使用自己工具列，展示是哪些表，結果是這兩張自己消失的表」。
                   *
                   * ⚠️ 整塊不渲染同時害死三件事：
                   *   ① 使用者不知道是「篩掉了」還是「壞了」
                   *   ② 這一塊自己的工具列不見了，改不回來
                   *   ③ 脫離提示與回歸鈕掛在這一塊裡，也跟著不見——
                   *      於是主工具列說「2 塊正在用自己的條件」，畫面上一顆都沒有。
                   * ⚠️ 專案既有規則就是「篩到一筆都不剩時**一定要說出來**」，
                   *   這兩張表漏了。
                   */}
                  {traceRoadRows.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>路段</th>
                          {/*
                            ⚠️ X-37：季別欄與日別欄依**這一塊自己的**條件顯示。
                              季別只在真的拉開區間時出現（沒拉開時每一列同一季，
                              多一欄一樣的值是噪音）；日別讀這一塊自己的工具列，
                              不是主工具列。
                          */}
                          {traceShowQuarter && <th>季別</th>}
                          {traceShowDay && <th>日別</th>}
                          {/* 這四欄和右邊的「全日」欄是同一組數字
                          （方向A＋方向B＝全日），單位必須一致，
                          不能一邊寫「輛/日」一邊寫「輛/調查日」。 */}
                          {/* ⚠️ 單位照這一塊自己的涵蓋算，不是主工具列。 */}
                          <th>方向A（{traceUnits.actual}）</th>
                          <th>方向B（{traceUnits.actual}）</th>
                          <th>方向A（{traceUnits.pcu}）</th>
                          <th>方向B（{traceUnits.pcu}）</th>
                          <th>
                            {traceScope.partial ? "調查時段合計" : "全日"}（
                            {traceUnits.actual}）
                          </th>
                          <th>
                            {traceScope.partial ? "調查時段合計" : "24小時"}（
                            {traceUnits.pcu}）
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
                        {traceRoadRows.map((r) => (
                          <tr key={`${r.roadId}|${r.dayType}`}>
                            <td>
                              <strong>{r.roadName}</strong>
                              <small>{r.roadId}</small>
                              {/*
                               * ── 這一筆是哪一天做的 ────────────────────
                               *
                               * 使用者 2026-09-11：「請新增讓我在切換顯示調查月份時，
                               *   也能看出哪一個路口／路段是在 X 月做的這項功能。」
                               *
                               * ⚠️ 期別標籤答不了這個問題：它寫的是**整季**的合寫
                               *   （「115年4、5月」），看不出哪一筆是 4 月、哪一筆是 5 月。
                               *
                               * ⚠️ 這一行**不受期別顯示開關控制，一直都在**。
                               *   做成「切到月份才出現」的話，使用者得先知道有那顆開關
                               *   才找得到這個資訊——那等於把功能藏起來。
                               *   年份寫法（民國／西元）則跟著上面那顆開關走。
                               *
                               * ⚠️ 同一列可能由方向 A／B 兩筆組成，分兩天做的話兩天都要寫。
                               */}
                              {r.surveyDates.length ? (
                                <small className="survey-date">
                                  調查日{" "}
                                  {r.surveyDates
                                    .map((iso) =>
                                      surveyDateInYearStyle(iso, yearStyle),
                                    )
                                    .join("、")}
                                </small>
                              ) : null}
                            </td>
                            {traceShowQuarter && <td>{showQuarter(r.quarter)}</td>}
                            {traceShowDay && <td>{r.dayType || "—"}</td>}
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
                  ) : (
                    <p className="panel-empty-note">
                      {traceRows.length ? (
                        <>
                          這一張只列<b>路段格式</b>的調查點（雙向 A／B）。
                          目前這一塊選到的調查點裡沒有路段格式的資料，
                          所以一列都列不出來——<b>不是壞掉，也不是資料不見了</b>。
                          路口格式的資料請看「各支線駛出／駛入路口交通量」那一張。
                        </>
                      ) : (
                        <>
                          這一塊會把<b>目前條件下的每一筆路段資料</b>
                          逐列攤開（調查點、日別、時段、各車種輛數與換算後 PCU），
                          用來回頭核對報表上的每一個數字是怎麼來的。
                          <b>目前的條件下一筆都沒有</b>
                          ——請先匯入調查檔，或把這一塊（或主工具列）的季度、
                          調查點、車流方向條件放寬。
                        </>
                      )}
                    </p>
                  )}
                </article>
              )}
              {(
                <article className="panel table-panel intersection-table">
                  <div className="panel-title">
                    <div>
                      <span>可追溯明細・路口格式</span>
                      <h3>
                        各支線{traceIntersectionFlowLabel}
                        路口交通量、轉向PCU、尖峰與各車種占比
                      </h3>
                    </div>
                    <small>
                      {traceIntersectionRows.length} 路口・目前顯示
                      {traceIntersectionFlowLabel}視角
                    </small>
                  </div>
                  {renderBlockFilters(
                    {
                    quarter: true,
                    day: true,
                    road: true,
                    /*
                     * ⚠️ X-17：這一塊**不再有自己的「路口流量視角」**。
                     *   視角一律由主工具列決定（見 traceFlowModes 的長註解）；
                     *   這一塊只選車流方向（路口 A／B／C…）。
                     */
                    direction: true,
                    },
                    CHART_TRACE_INTERSECTION,
                  )}
                  {/*
                   * ⚠️ X-17：先在主工具列選視角、再在這裡選車流方向——
                   *   這一句是使用者指名要加的，不可以拿掉。
                   */}
                  <p className="panel-empty-note">
                    <b>駛出／駛入</b>由上方主工具列的「路口流量視角」決定
                    （目前：
                    {traceFlowModes.map((mode) => intersectionFlowLabelOf(mode)).join("＋")}
                    ）；這一塊的工具列只選<b>車流方向</b>（路口 A／B／C…）。
                    選「駛出＋駛入並列」時，同一個路口會出現<b>兩列</b>，
                    每一列自己標明是哪一種視角。
                  </p>
                  {/* ⚠️ 涵蓋提醒要照**這一塊自己的**資料算（見 coverageOfRecords）。 */}
                  {partialNoticeFor(traceIntersectionScope)}
                  {/* ⚠️ X-16：與路段那一張同一條規則——沒有可列的資料時
                       **區塊要留著並說明**，不可以整張消失（使用者 2026-09-16）。 */}
                  {traceIntersectionRows.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>路口</th>
                          {/* ⚠️ X-37：同上，依這一塊自己的條件顯示。 */}
                          {traceIntersectionShowQuarter && <th>季別</th>}
                          {traceIntersectionShowDay && <th>日別</th>}
                          {/*
                           * ⚠️ X-22：並列時支線欄名寫「路口A 駛出／駛入（單位）」，
                           *   格子裡上下兩行各寫一種——照抄路口轉向那張表的作法
                           *   （使用者指名：「是最完美的一張表」）。
                           *   單一視角時就只寫那一種，不掛「／」。
                           */}
                          {intersectionDirectionCodes.flatMap((code) => [
                            <th key={`${code}-actual`}>
                              {code === "UNMAPPED"
                                ? "未指定駛入路口"
                                : `${traceIntersectionFlowLabel}路口${code}`}
                              （{traceIntersectionUnits.actual}）
                            </th>,
                            <th key={`${code}-pcu`}>
                              {code === "UNMAPPED"
                                ? "未指定駛入路口"
                                : `${traceIntersectionFlowLabel}路口${code}`}
                              （{traceIntersectionUnits.pcu}）
                            </th>,
                            <th key={`${code}-peak`}>
                              {code === "UNMAPPED"
                                ? "未指定駛入"
                                : `${traceIntersectionFlowLabel}路口${code}`}
                              尖峰（PCU/小時）
                            </th>,
                          ])}
                          {/* ⚠️ 單位照這一塊自己的涵蓋算，不是主工具列。 */}
                          <th>
                            {traceIntersectionScope.partial ? "調查時段合計" : "全日"}（
                            {traceIntersectionUnits.actual}）
                          </th>
                          <th>
                            {traceIntersectionScope.partial ? "調查時段合計" : "24小時"}（
                            {traceIntersectionUnits.pcu}）
                          </th>
                          <th>全部{traceIntersectionFlowLabel}尖峰（PCU/小時）</th>
                          {analysisVehicleCatalog.map((vehicle) => (
                            <th key={vehicle.key}>{vehicle.label}（%）</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {traceIntersectionRows.map(({ row: r, perMode, hasOthers }) => (
                          <tr key={`${r.roadId}|${r.dayType}`}>
                            <td>
                              <strong>{r.roadName}</strong>
                              <small>{r.roadId}</small>
                              {/*
                               * ── 這一筆是哪一天做的 ────────────────────
                               *
                               * 使用者 2026-09-11：「請新增讓我在切換顯示調查月份時，
                               *   也能看出哪一個路口／路段是在 X 月做的這項功能。」
                               *
                               * ⚠️ 期別標籤答不了這個問題：它寫的是**整季**的合寫
                               *   （「115年4、5月」），看不出哪一筆是 4 月、哪一筆是 5 月。
                               *
                               * ⚠️ 這一行**不受期別顯示開關控制，一直都在**。
                               *   做成「切到月份才出現」的話，使用者得先知道有那顆開關
                               *   才找得到這個資訊——那等於把功能藏起來。
                               *   年份寫法（民國／西元）則跟著上面那顆開關走。
                               *
                               * ⚠️ 同一列可能由方向 A／B 兩筆組成，分兩天做的話兩天都要寫。
                               */}
                              {r.surveyDates.length ? (
                                <small className="survey-date">
                                  調查日{" "}
                                  {r.surveyDates
                                    .map((iso) =>
                                      surveyDateInYearStyle(iso, yearStyle),
                                    )
                                    .join("、")}
                                </small>
                              ) : null}
                            </td>
                            {traceIntersectionShowQuarter && (
                              <td>{showQuarter(r.quarter)}</td>
                            )}
                            {traceIntersectionShowDay && (
                              <td>{r.dayType || "—"}</td>
                            )}
                            {intersectionDirectionCodes.flatMap((code) => {
                              /*
                               * ⚠️ X-22：並列時**同一格上下兩行**（駛出一行、駛入一行），
                               *   每一行前面寫出是哪一種——照抄路口轉向那張表。
                               *   單一視角時就只有一行，而且不寫前綴（表頭已經寫了）。
                               */
                              const cell = (
                                pick: (item: { actual: number; pcu: number; peakPcu: number; peakHour: string }) => string,
                                withHour = false,
                              ) =>
                                perMode.map(({ label, row: modeRow }) => {
                                  const d = modeRow?.directions.find(
                                    (item) => item.code === code,
                                  );
                                  return (
                                    <span className="flow-line" key={label}>
                                      {hasOthers ? `${label} ` : ""}
                                      {d ? pick(d) : "—"}
                                      {withHour && d ? <small>{d.peakHour}</small> : null}
                                    </span>
                                  );
                                });
                              return [
                                <td key={`${code}-actual`}>
                                  {cell((d) => formatter.format(d.actual))}
                                </td>,
                                <td key={`${code}-pcu`}>
                                  {cell((d) => decimalFormatter.format(d.pcu))}
                                </td>,
                                <td key={`${code}-peak`}>
                                  {cell((d) => decimalFormatter.format(d.peakPcu), true)}
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
                  ) : (
                    <p className="panel-empty-note">
                      {traceIntersectionRecords.length ? (
                        <>
                          這一張只列<b>路口格式</b>的調查點（各支線 A、B、C…）。
                          目前這一塊選到的調查點裡沒有路口格式的資料，
                          所以一列都列不出來——<b>不是壞掉，也不是資料不見了</b>。
                          路段格式的資料請看「雙向路段交通量」那一張。
                        </>
                      ) : (
                        <>
                          這一塊會把<b>目前條件下的每一筆路口資料</b>
                          逐列攤開（各支線的交通量、轉向 PCU、尖峰與車種占比）。
                          <b>目前的條件下一筆都沒有</b>
                          ——請先匯入路口格式的調查檔，或把這一塊（或主工具列）的
                          季度、調查點、車流方向條件放寬。
                        </>
                      )}
                    </p>
                  )}
                </article>
              )}
            </>
          )}
          {view === "page-period" && (
            <>
              <PageHeading pageId="page-period" />
              <article
                className={focusClass("periodAnalysis", "panel period-panel")}
                id="periodAnalysis"
                data-consumes={BLOCK_CONSUMES["periodAnalysis"]}
              >
                <div className="panel-title">
                  <div>
                    <span>時段車種分析（獨立區塊）</span>
                    <h3>
                      全調查時段／上午尖峰／下午尖峰各車種車輛數、百分比與交通流量
                    </h3>
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
                  尖峰小時一律由實測資料認定（依 2022
                  年臺灣公路容量手冊，未規定固定時鐘區間）， 判定基準為
                  PCU；百分比以車輛數為分母。
                  <strong>
                    「尖峰時段認定」選「整個調查點同一時段」時各方向才可相加
                  </strong>
                  ；
                  切成「各方向各自認定」後不可相加。詳細說明請見新手使用手冊。
                </p>
                {/*
              這一區自己的篩選列：季度、日別、調查點與上方工具列共用同一組狀態，
              在哪邊改都一樣。放在這裡是因為這一區在頁面最下方，
              原本每換一個條件都要捲回最上面再捲回來。
            */}
                {/*
                 * ⚠️ v20.74 起這三顆改成寫進**這一塊自己的條件**
                 *   （使用者 2026-09-14：「圖自己的篩選只影響自己」）。
                 *   沒動過時顯示的就是主工具列的值（鏡子）；
                 *   動了就只有這一塊脫離，旁邊會出現「回到主工具列條件」。
                 */}
                <div className="block-filters period-scope-filters">
                  <label>
                    季度
                    <select
                      id="periodQuarterSelect"
                      value={periodFilters.quarterTo}
                      onChange={(e) =>
                        changeChartFilter(
                          CHART_PERIOD,
                          "quarterTo",
                          e.target.value,
                        )
                      }
                    >
                      {quarters.map((q) => (
                        <option key={q} value={q}>
                          {quarterLabel(q)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    日別
                    <select
                      id="periodDaySelect"
                      value={periodFilters.day}
                      onChange={(e) =>
                        changeChartFilter(
                          CHART_PERIOD,
                          "day",
                          e.target.value as DayChoice,
                        )
                      }
                    >
                      <option>平日</option>
                      <option>假日</option>
                      <option>平日＋假日</option>
                    </select>
                  </label>
                  <div className="filter-field">
                    <span className="filter-field-label">路段／路口</span>
                    <MultiPicker
                      id="periodRoadSelect"
                      label="路段／路口"
                      allLabel="全部調查點"
                      options={roadOptions}
                      value={periodFilters.roads}
                      onChange={(value) =>
                        changeChartFilter(CHART_PERIOD, "roads", value)
                      }
                    />
                  </div>
                  <small className="period-filter-hint">
                    平常與最上方主工具列同步；在這裡改就只有這一區用自己的條件。
                  </small>
                  {isDetached(chartOverrides, CHART_PERIOD) && (
                    <p
                      className="chart-detach-note"
                      data-detached-chart={CHART_PERIOD}
                      data-testid="chart-detach-note"
                    >
                      <span>
                        目前用本區塊自己的條件（主工具列：
                        {describeMain(mainFilters, showQuarter)}）
                      </span>
                      <button
                        type="button"
                        className="chart-detach-reset"
                        data-testid="chart-detach-reset"
                        onClick={() =>
                          setChartOverrides((previous) =>
                            resetChart(previous, CHART_PERIOD),
                          )
                        }
                      >
                        回到主工具列條件
                      </button>
                    </p>
                  )}
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
                    {/*
                     * ⚠️ 這裡**沒有**「跟隨上方工具列」這個選項，而且不是漏掉的。
                     *   三態的規則是「沒動過就是跟著走」，所以「跟隨」等於
                     *   「回到主工具列條件」那一顆——同一件事留兩套做法，
                     *   使用者一定會問哪一個才算數。
                     */}
                    <select
                      id="periodFlowViewSelect"
                      value={periodFlowView}
                      disabled={!periodHasIntersection}
                      onChange={(e) =>
                        changeChartFilter(
                          CHART_PERIOD,
                          "flowView",
                          e.target.value as FlowChoice,
                        )
                      }
                    >
                      <option value="origin">駛出路口（以該支線為起點）</option>
                      <option value="destination">
                        駛入路口（以該支線為終點）
                      </option>
                      <option value="both">駛出＋駛入並列</option>
                    </select>
                    {/*
                  目前結果只有路段時，這個下拉切了也不會有變化。
                  與其讓使用者切三次、以為篩選壞掉，不如直接停用並說明。
                  選過的值刻意**不重設**：等篩選再放寬、結果裡又有路口時，
                  會回到他原本挑的視角。
                */}
                    <small
                      className="period-filter-hint"
                      id="periodFlowViewHint"
                      data-scope={
                        periodHasIntersection ? "has-intersection" : "road-only"
                      }
                    >
                      {periodHasIntersection
                        ? "只有路口格式的調查點會受這一項影響；路段格式一律是方向 A／方向 B。"
                        : "本次結果只有路段，駛入／駛出僅適用於路口，所以這一項暫時停用。"}
                    </small>
                  </label>
                  <label>
                    尖峰時段認定
                    <select
                      id="periodPeakScopeSelect"
                      value={periodFilters.peakScope}
                      onChange={(e) =>
                        changeChartFilter(
                          CHART_PERIOD,
                          "peakScope",
                          e.target.value as PeakScope,
                        )
                      }
                    >
                      <option value="point">
                        整個調查點同一時段（可相加）
                      </option>
                      <option value="direction">
                        各方向各自認定自己的尖峰
                      </option>
                    </select>
                    {/*
                     * 選項名稱後面括號寫「（可相加）」三個字不夠——使用者
                     * 2026-09-11 自己來問「可相加是什麼意思、依據什麼找出時段」。
                     * 這一行**跟著選項變**，把依據直接講出來，不必翻手冊。
                     * 字從 period-analysis.ts 來，和匯出中心、新手手冊同一份。
                     */}
                    <small
                      className="period-filter-hint"
                      id="periodPeakScopeHint"
                      /*
                       * ⚠️ 這一行要跟著**上面那一顆下拉**（periodFilters），
                       *   不可以讀主工具列的 periodPeakScope：這一區脫離之後
                       *   下拉寫「各方向各自認定」、說明卻還在講「可相加」，
                       *   而「可不可以相加」正是這一段最要緊的一句話。
                       */
                      data-scope={periodFilters.peakScope}
                    >
                      {PEAK_SCOPE_HINTS[periodFilters.peakScope]}
                    </small>
                  </label>
                  <label>
                    顯示數值
                    <select
                      id="periodMetricSelect"
                      value={periodFilters.metric}
                      onChange={(e) =>
                        changeChartFilter(
                          CHART_PERIOD,
                          "metric",
                          e.target.value as MetricChoice,
                        )
                      }
                    >
                      {(
                        [
                          "count",
                          "pcu",
                          "share",
                          "pcuShare",
                          "countShare",
                        ] as MetricChoice[]
                      ).map((choice) => {
                        const key = metricBaseOf(choice);
                        return (
                          <option key={choice} value={choice}>
                            {METRIC_CHOICE_LABELS[choice]}（
                            {periodView === "ALL"
                              ? METRIC_BASE_UNITS[key]
                              : columnUnitFor(
                                  key,
                                  periodView,
                                  visiblePeriodRows.map(
                                    (row) =>
                                      row.periods[periodView]?.hour || "",
                                  ),
                                  {
                                    separateDays:
                                      periodFilters.day === "平日＋假日",
                                  },
                                )}
                            ）
                          </option>
                        );
                      })}
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
                                ? previous.filter(
                                    (code) => code !== option.code,
                                  )
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
                                  : columnUnitFor(
                                      periodMetric,
                                      periodView,
                                      visiblePeriodRows.map(
                                        (row) =>
                                          row.periods[periodView]?.hour || "",
                                      ),
                                      {
                                        /*
                                         * ⚠️ 讀這一塊自己的日別（periodFilters.day），
                                         *   不是主工具列的 dayType。這張表的列是照
                                         *   periodFilters 算的，欄位單位卻照主工具列，
                                         *   脫離之後會出現「列是平＋假分開、
                                         *   欄位單位寫『輛/日』」這種自己打自己的表頭。
                                         */
                                        separateDays:
                                          periodFilters.day === "平日＋假日",
                                      },
                                    )}
                              </small>
                            </th>
                          ))}
                          <th>
                            合計
                            <small>
                              {periodView === "ALL"
                                ? METRIC_LABELS[periodMetric]
                                : columnUnitFor(
                                    periodMetric,
                                    periodView,
                                    visiblePeriodRows.map(
                                      (row) =>
                                        row.periods[periodView]?.hour || "",
                                    ),
                                    {
                                      /* ⚠️ 同上：欄位單位要跟著這一塊自己的日別。 */
                                      separateDays:
                                        periodFilters.day === "平日＋假日",
                                    },
                                  )}
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
                                  row.scopeCode === "ALL"
                                    ? "period-total-row"
                                    : ""
                                }
                              >
                                <td>
                                  <strong>{row.roadName}</strong>
                                  <small>
                                    {row.roadId}・
                                    {/*
                                     * ⚠️ X-18：平日＋假日時**一天一列**，
                                     *   所以每一列一定要寫出自己是哪一天——
                                     *   不寫的話兩列長得一模一樣，看的人只會
                                     *   以為同一筆資料被印了兩次。
                                     */}
                                    {row.dayType ? `${row.dayType}・` : ""}
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
                                      : `單位：${columnUnitFor(
                                          periodMetric,
                                          period,
                                          visiblePeriodRows.map(
                                            (row) =>
                                              row.periods[period]?.hour || "",
                                          ),
                                          {
                                            separateDays:
                                              periodFilters.day === "平日＋假日",
                                          },
                                        )}`}
                                  </small>
                                </td>
                                <td>{cell.hour}</td>
                                {analysisVehicleCatalog.map((vehicle) => {
                                  const value = periodCellValue(
                                    cell,
                                    vehicle.key,
                                    periodMetric,
                                  );
                                  /*
                                   * ⚠️ 「交通流量＋百分比」「車輛數＋百分比」
                                   *   這兩個組合在計算層沒有自己的 MetricKey——
                                   *   主值仍然是 pcu／count，百分比另外算一次
                                   *   （分母是這一格的車輛數合計，與「百分比」
                                   *    模式完全同一支 periodCellValue）。
                                   *   另寫一套分母的話，同一張表上兩種模式的
                                   *   百分比會對不起來。
                                   */
                                  const share = metricShowsShare(
                                    periodFilters.metric,
                                  )
                                    ? periodCellValue(cell, vehicle.key, "share")
                                    : null;
                                  return (
                                    <td key={vehicle.key}>
                                      {!cell.hasData
                                        ? "—"
                                        : periodMetric === "count"
                                          ? formatter.format(Math.round(value))
                                          : periodMetric === "share"
                                            ? `${value.toFixed(1)}%`
                                            : decimalFormatter.format(value)}
                                      {cell.hasData &&
                                        share !== null &&
                                        periodMetric !== "share" && (
                                          <small>{share.toFixed(1)}%</small>
                                        )}
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
            </>
          )}
          {view === "page-delivery" && (
            <>
              <PageHeading pageId="page-delivery" />
              <article
                className={focusClass("conclusionStudio", "panel conclusion-panel")}
                id="conclusionStudio"
              >
                {/*
                 * ⚠️ 這一句是**常駐**的（不是只在某個條件被篩時才出現）。
                 *   這一塊不吃**任何一個**主工具列條件，逐條件各跳一句會變成七、八句噪音；
                 *   一句話講完。data-inapplicable="all" 是給守門看的憑據（使用者看不到）。
                 *   使用者 2026-09-15：「如果有不受主工具列某一篩選條件影響時，
                 *   是否都能在該條件出現時，會有提醒文字出現?」
                 */}
                <p
                  className="chart-inapplicable"
                  data-testid="chart-inapplicable"
                  data-inapplicable="all"
                  data-inapplicable-always="1"
                >
                  這一塊的條件由下方自己決定，不會跟著上方主工具列變動——包含
                  <b>尖峰時段認定</b>與<b>路口流量視角</b>在內（2026-09-15 起，這兩項
                  在下方是看得到、選得到的條件；以前它們是悄悄跟著主工具列走的）。
                  要一次對齊主工具列，請按下方的「套用主工具列目前的條件」。
                </p>
                <div className="panel-title">
                  <div>
                    {/*
                     * ⚠️ X-19（使用者 2026-09-16，附圖）：名稱與說明的主從**原本是反的**。
                     *   這一塊原本把「結論草稿產生器」放在 9px 的 eyebrow、
                     *   把說明放在 h3，於是第一眼看到的是說明、不是名稱——
                     *   使用者原話：「不仔細看都不知道這個區塊是草稿產生器」。
                     *   其餘面板是「eyebrow ＝ 分類、h3 ＝ 名稱」，這一塊是唯一的例外。
                     * ⚠️ 側欄小分頁叫「結論草稿產生器」，這裡的 h3 要與它**逐字相同**，
                     *   否則點過去之後找不到同一個名字。
                     */}
                    <span>產出與維護</span>
                    <h3>結論草稿產生器</h3>
                    <small>依自己勾選的條件，寫出可直接貼進報告的結論</small>
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
                  <strong>這一份是「您自己出題」</strong>
                  ：自己勾選統計範圍、時段、日別、路段與要寫哪些數字，
                  系統照著條件寫出結論，和 Excel 匯出無關 —— 想只寫「115Q2
                  每個路段的全日交通量與車種百分比」 可以，想寫「114
                  年度四季的變化」也可以。
                  <br />
                  要產生<strong>「這批 Excel 的說明文字」</strong>
                  請用「報表批次輸出中心」裡的
                  <strong>報告文字草稿</strong>
                  ，那一份的段落跟著勾選的匯出項目走，會和 Excel 一起交出去。
                  兩邊的數字來源完全相同，都取自這個畫面用的同一組計算（buildPeriodRows
                  與同一組 PCU 係數）， 不會另外再算一次。
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
                    showQuarter={showQuarter}
                    applyMainFilters={applyMainToConclusion}
                    mainPeakScopeLabel={
                      PEAK_SCOPE_CHOICE_LABELS[mainFilters.peakScope]
                    }
                    mainPeakScope={mainFilters.peakScope}
                  />
                )}
              </article>
            </>
          )}
          {view === "page-batch" && (
            <>
              <PageHeading pageId="page-batch" />
              {/*
               * ══════════════════════════════════════════════════════
               *  一鍵下載全部圖檔
               * ══════════════════════════════════════════════════════
               *
               * 使用者 2026-09-12：「每張圖都應該要有能直接提供高清晰圖片
               * 下載的功能」，並接受「每張圖旁邊一顆＋這裡一次全部下載」
               * 兩個一起做。
               *
               * ⚠️ 這裡下載的圖**不需要先切到圖表那一頁**。
               *   圖是照目前的篩選條件（季度／日別／調查點／方向）
               *   當場重新畫的，資料來源就是圖表頁那幾個 memo——
               *   不是去抓畫面上的畫布（那樣沒開過的那一頁就抓不到，
               *   而且會在「圖還沒畫完」時抓到半張）。
               *
               * ⚠️ 目前的條件要寫在這一塊上。同一個計畫換個季度再按一次，
               *   拿到的是不同的圖卻可能同名；檔名有帶條件，這裡也要看得到。
               */}
              {/*
               * ⚠️ 這一塊一定要有 focusClass。
               *   側欄點下去會捲到這裡，但沒有外框的話使用者看不出
               *   「就是這一塊」——e2e-nav-target 抓到的。
               */}
              <section
                className={focusClass("block-chart-png", "panel chart-png-all")}
                id="block-chart-png"
              >
                {/*
                 * ⚠️ 這一句是**常駐**的（不是只在某個條件被篩時才出現）。
                 *   這一塊不吃**任何一個**主工具列條件，逐條件各跳一句會變成七、八句噪音；
                 *   一句話講完。data-inapplicable="all" 是給守門看的憑據（使用者看不到）。
                 *   使用者 2026-09-15：「如果有不受主工具列某一篩選條件影響時，
                 *   是否都能在該條件出現時，會有提醒文字出現?」
                 */}
                <p
                  className="chart-inapplicable"
                  data-testid="chart-inapplicable"
                  data-inapplicable="all"
                  data-inapplicable-always="1"
                >
                  這一塊不受主工具列的「調查時段」「路口流量視角」「尖峰時段認定」「顯示數值」影響：每一張圖各自照自己的規則畫，條件以各圖為準。
                </p>
                <div className="panel-title">
                  <div>
                    <span>圖檔輸出</span>
                    <h3>一鍵下載全部圖檔（高解析 PNG）</h3>
                  </div>
                  {/*
                    * ⚠️ 這裡**不可以**印主工具列那一行然後說「全部都照這個」。
                    *   每一張圖各自吃自己那一塊的條件（可以脫離），檔名也是
                    *   逐塊算的（chartScopeTextOf）。印一行主工具列的條件，
                    *   等於對七張圖做了一個對其中幾張不成立的宣告——
                    *   而使用者會照這一行去理解下載下來的檔案。
                    *   真正的條件寫在每一個項目自己的檔名上，下面就列著。
                    */}
                  <small>{chartPngJobs.length} 張圖</small>
                </div>
                <p className="chart-png-all-note">
                  每一張圖都依<b>那一塊自己目前的條件</b>重新繪製
                  （某一塊脫離主工具列時，它那一張就照它自己的條件畫，
                  檔名也會寫出來），不是擷取畫面，所以沒有先開過圖表那一頁
                  也照樣下載得到。每一張都是白底、
                  <b>只有圖、不含說明文字</b>——說明是簡報時用講的。
                </p>
                <div className="chart-png-all-list">
                  {chartPngJobs.map((job) => (
                    <label key={job.id}>
                      <input
                        type="checkbox"
                        checked={chartPngPicked.includes(job.id)}
                        onChange={(e) =>
                          setChartPngPicked((prev) =>
                            e.target.checked
                              ? [...prev, job.id]
                              : prev.filter((id) => id !== job.id),
                          )
                        }
                      />
                      <span>
                        {job.label}
                        <small>{job.fileName}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="chart-png-all-actions">
                  <button
                    type="button"
                    /*
                     * ⚠️ 一定要是 `button primary`，不可以只寫 `primary`。
                     *   使用者 2026-09-14（附圖）：「下載圖片的按鍵，顏色與取消
                     *   按鍵不同，乍一看之下，我只能取消，沒有地方可以按確認匯出」。
                     *   實測這顆的電腦計算樣式是：底色透明、外框 0px、圓角 0px、
                     *   內距 0px、字重 400——它**完全沒有按鈕的樣子**，
                     *   而旁邊的「全部取消」是正常的按鈕。畫面上最重要的那個動作
                     *   看起來像一行字，次要動作看起來才像按鈕。
                     *   成因：這一支的按鈕樣式掛在 `.button` 上（高度、內距、圓角、
                     *   字重），`.primary` 只負責顏色。全檔 18 顆 primary 按鈕裡
                     *   **只有這一顆**漏了 `button`。
                     *   tests/button-class.test.mjs 會擋下再犯。
                     */
                    className="button primary"
                    id="downloadAllChartPng"
                    disabled={chartPngPicked.length === 0 || chartPngBusy}
                    onClick={downloadAllChartPng}
                  >
                    {chartPngBusy
                      ? "產生中…"
                      : `下載勾選的 ${chartPngPicked.length} 張圖`}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() =>
                      setChartPngPicked(
                        chartPngPicked.length === chartPngJobs.length
                          ? []
                          : chartPngJobs.map((job) => job.id),
                      )
                    }
                  >
                    {chartPngPicked.length === chartPngJobs.length
                      ? "全部取消"
                      : "全部勾選"}
                  </button>
                </div>
              </section>
              {/*
               * ⚠️ X-63：「報表批次輸出中心」是一個視窗（側欄那一項會開它）。
               *   這一頁上要有一個**看得到、點得到**的入口，否則使用者切到
               *   「批次輸出」只會看到一鍵下載，而那個中心像是藏起來的。
               */}
              <section className="panel export-center-entry" id="block-export-center">
                <div className="panel-title">
                  <div>
                    <span>批次輸出</span>
                    <h3>報表批次輸出中心</h3>
                    <small>
                      一次勾選要交的分析項目與季度，產出 Excel、圖檔與說明文字。
                      按下去會開啟中心視窗，裡面還會再讓你確認一次。
                    </small>
                  </div>
                </div>
                <div className="panel-actions">
                  <button
                    type="button"
                    className="button primary"
                    data-testid="open-export-center"
                    onClick={() => setShowExportCenter(true)}
                  >
                    開啟報表批次輸出中心
                  </button>
                </div>
              </section>
            </>
          )}
          {view === "page-check" && (
            <>
              <PageHeading pageId="page-check" />
              {/*
               * ══════════════════════════════════════════════════════
               *  資料維護（X-43／X-44／X-48／X-49，三支同步）
               * ══════════════════════════════════════════════════════
               *
               * 使用者 2026-09-16（附圖）：
               *   「全日交通量的品質與定稿分頁中似乎就是一個資料維護的
               *     半成品了，可以將此頁面與資料維護的內容做個融合。」
               *   「資料產出與維護，應該要三個程式互相同步：刪除單一季度、
               *     執行資料異常檢查按鈕(要能正常運作)、異常提醒門檻、
               *     資料異常檢查摘要、檢查結果」
               *
               * ⚠️ 這一整段的內容是從「品質與定稿」視窗**搬過來**的，
               *   不是另外做一份。視窗那一份已經拆掉——同一件事留兩個
               *   入口，遲早會分岔成兩套數字。
               * ⚠️ 這一頁的每一塊都**不受主工具列影響**（使用者指定），
               *   所以每一塊都掛一句常駐說明。
               */}
              {/*
                 * ⚠️ 這一層只是版面容器，**刻意不給 id**：
                 *   側欄盤點的守門（scripts/e2e-nav-coverage.mjs）是照
                 *   「畫面上有幾個帶 id 的區塊」對「側欄列了幾項」，
                 *   給了 id 就會多出一個側欄永遠不會列的項目而紅。
                 *   真正的四塊各自有自己的 id。
                 */}
              <div className="maintenance-zone">
                <section
                  className={focusClass("quality-run", "panel maintenance-run")}
                  id="quality-run"
                >
                  <h3>執行資料異常檢查</h3>
                  {/*
                   * ⚠️ 事前預防（匯入當下的提醒）與事後檢查（這一顆）是兩件事。
                   *   使用者 2026-09-16 講得很清楚：
                   *   「一個是事前預防，一個是事後檢查」
                   *   「所以使用者手動修正問題後，在按一次檢查，確認異常已消除。」
                   */}
                  <p className="help">
                    掃這個計畫<b>全部季度</b>已匯入的資料，列出需要注意的項目。
                    處理完之後再按一次，已經解決的項目就會消失。
                  </p>
                  <button
                    className="button primary"
                    data-testid="quality-run"
                    disabled={!activeProject || !activeRecords.length}
                    onClick={runQualityCheck}
                  >
                    執行資料異常檢查
                  </button>
                  <p
                    className={
                      qualityStale
                        ? "maintenance-run-state stale"
                        : "maintenance-run-state"
                    }
                    data-testid="quality-run-state"
                  >
                    {!qualityRunAt
                      ? "尚未檢查。按「執行資料異常檢查」之後，「資料異常檢查摘要」與「檢查結果」才會有數字。"
                      : qualityStale
                        ? `上次檢查：${qualityRunAt}　⚠️ 之後資料又變動過，結果已過期，請重新檢查。`
                        : `上次檢查：${qualityRunAt}　共 ${anomalyAlerts.length} 項需要注意。`}
                  </p>
                </section>
                <section
                  className={focusClass("quality-summary", "panel")}
                  id="quality-summary"
                >
                  <h3>資料異常檢查摘要</h3>
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列條件影響：摘要一律算這個計畫的全部資料——被篩掉的地方有問題就永遠檢查不到。
                  </p>
                  <div className="validation-grid" data-testid="quality-summary-grid">
                    {[
                      ["調查點", String(qualitySummary.roads)],
                      [
                        "平日／假日",
                        `${qualitySummary.weekdayRoads}／${qualitySummary.holidayRoads}`,
                      ],
                      ["24小時完整", String(qualitySummary.completeGroups)],
                      ["不完整", String(qualitySummary.incompleteGroups)],
                      ["車種", String(qualitySummary.vehicleTypes)],
                      [
                        "未指定駛入",
                        `${formatter.format(qualitySummary.unmapped)} 輛`,
                      ],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <small>{label}</small>
                        {/* ⚠️ 沒檢查過就不給數字——給了等於說「已經檢查過而且是這樣」。 */}
                        <strong>{qualityRunAt ? value : "—"}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="two-col">
                    <label className="status-field">
                      <span>資料狀態（{showQuarter(quarter)}）</span>
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
                            statuses: {
                              ...previous.statuses,
                              [quarter]: next,
                            },
                          }));
                        }}
                      >
                        <option>草稿</option>
                        <option>待確認</option>
                        <option>已確認</option>
                        <option>定稿</option>
                      </select>
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
                              ? [
                                  ...new Set([
                                    ...previous.checkedQuarters,
                                    quarter,
                                  ]),
                                ]
                              : previous.checkedQuarters.filter(
                                  (item) => item !== quarter,
                                ),
                          }))
                        }
                      />
                      <span>已完成人工檢核</span>
                    </label>
                    {/* ⚠️ 說明不能放在 <label> 裡：label 內任何位置被點到都會切換勾選。 */}
                    <small className="status-effect">
                      「已完成人工檢核」純粹是紀錄：只會顯示在工具列，並寫進匯出的「品質與版本紀錄」，不影響任何計算或限制。
                    </small>
                    {/*
                     * ⚠️ 這兩個欄位是**跟著主工具列那一季走**的（資料狀態是
                     *   逐季的東西，本來就必須指定是哪一季）。這一頁其餘部分
                     *   不受主工具列影響，所以這一點一定要寫出來，
                     *   不然使用者會以為自己改到的是全部季度。
                     */}
                    <small className="status-effect">
                      ⚠️ 「資料狀態」與「已完成人工檢核」是<b>逐季</b>的設定，
                      改的是主工具列目前選的「{showQuarter(quarter)}」；
                      這一頁其餘部分不受主工具列影響。
                    </small>
                    {/* 這一句原本在「品質與定稿」視窗底部，跟著內容一起搬過來。 */}
                    <p className="help">
                      定稿後，系統預設阻擋重複匯入覆蓋；如需修訂，先將狀態改回草稿並保留版本紀錄。
                    </p>
                  </div>
                </section>
                <section
                  className={focusClass("quality-thresholds", "panel")}
                  id="quality-thresholds"
                >
                  <h3>異常提醒門檻</h3>
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列條件影響：門檻是整個計畫共用的設定，不屬於某一季或某一個調查點。
                  </p>
                  <p className="help">
                    改了門檻之後要重新按一次「執行資料異常檢查」，檢查結果才會跟著換。
                  </p>
                  <div className="threshold-grid">
                    {(
                      [
                        ["全日量變動警示（%）", "dailyChangePct", "any"],
                        ["PCU變動警示（%）", "pcuChangePct", "any"],
                        ["車種占比變動（百分點）", "vehicleShareChangePct", "any"],
                        ["尖峰位移（小時）", "peakShiftHours", "any"],
                        ["零流量時段上限", "zeroHourLimit", "1"],
                      ] as const
                    ).map(([label, key, step]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          step={step}
                          value={workflow.thresholds[key]}
                          onChange={(e) =>
                            setWorkflow((previous) => ({
                              ...previous,
                              thresholds: {
                                ...previous.thresholds,
                                [key]: Number(e.target.value),
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <section
                  className={focusClass("quality-reasons", "panel")}
                  id="quality-reasons"
                >
                  {/*
                   * ⚠️ **不要用 `.status-dot`**。在這一支程式裡它是一根
                   *   8px 寬的裝飾色條（`.status-dot{width:8px;height:32px}`），
                   *   不是文字徽章——把字塞進去會被壓成一條看不清的色塊，
                   *   對比只有 2.23:1（e2e-layout 的 AA 檢查抓到）。
                   *   路口轉向那一支的 `.status-dot` 才是文字徽章，兩支同名不同物。
                   */}
                  <div className="maintenance-head">
                    <h3>檢查結果（全部季度）</h3>
                    <span className="maintenance-count">
                      {!qualityRunAt
                        ? "尚未檢查"
                        : ackedAnomalyCount
                          ? `顯示 ${filteredAnomalies.length} / 共 ${anomalyAlerts.length} 筆（其中 ${ackedAnomalyCount} 筆已確認）`
                          : `顯示 ${filteredAnomalies.length} / 共 ${anomalyAlerts.length} 筆`}
                    </span>
                  </div>
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列條件影響：檢查一律掃這個計畫全部季度的資料。要縮小範圍，請用這一塊自己的「起始季度／結束季度」與類型標籤。
                  </p>
                  {!qualityRunAt ? (
                    <p className="help">
                      尚未檢查。按「執行資料異常檢查」之後，這一塊才會列出需要注意的項目。
                    </p>
                  ) : anomalyAlerts.length ? (
                    <>
                      {anomalyFilterControls}
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
                              <th>解決方式</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredAnomalies.slice(0, 200).map((item, index) => {
                              const resolution = ANOMALY_RESOLUTIONS[item.type];
                              return (
                                <tr
                                  key={`${item.text}-${index}`}
                                  data-anomaly-type={item.type}
                                  className={
                                    anomalyAcked(item)
                                      ? "issue-acked"
                                      : undefined
                                  }
                                >
                                  <td>
                                    {item.fromQuarter === item.toQuarter
                                      ? showQuarter(item.toQuarter)
                                      : `${showQuarter(item.fromQuarter)}→${showQuarter(item.toQuarter)}`}
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
                                      item.unit === "%" ||
                                        item.unit === "個百分點"
                                        ? 1
                                        : 0,
                                    )}{" "}
                                    {item.unit}
                                  </td>
                                  {/*
                                   * X-49：解決方式。類別的**字**一定要印出來，
                                   * 只靠顏色的話色弱的使用者與紙本都分不出來。
                                   */}
                                  <td
                                    className="resolution-cell"
                                    data-testid="issue-resolution"
                                    data-kind={resolution.kind}
                                  >
                                    <b
                                      className={
                                        "resolution-kind " +
                                        (resolution.kind === "重新匯入"
                                          ? "kind-reimport"
                                          : resolution.kind === "人工確認"
                                            ? "kind-confirm"
                                            : "kind-onscreen")
                                      }
                                    >
                                      {resolution.kind}
                                    </b>
                                    <span>{resolution.text}</span>
                                    {resolution.anchor && (
                                      <button
                                        type="button"
                                        className="resolution-goto"
                                        onClick={() => {
                                          const target = resolution.anchor;
                                          if (!target) return;
                                          /* X-63：跳到那一塊所屬的**大分頁**。 */
                                          const owner = PAGES.find((page) =>
                                            page.items.some(
                                              (entry) =>
                                                "anchor" in entry &&
                                                entry.anchor === target,
                                            ),
                                          );
                                          if (owner) setView(owner.id);
                                          setFocusedBlock(target);
                                          scrollToBlock(target);
                                        }}
                                      >
                                        前往「{resolution.anchorLabel}」
                                      </button>
                                    )}
                                    {/*
                                     * 「已確認」鈕（使用者 2026-09-17）。
                                     * ⚠️ 只有「人工確認」類有這顆——「重新匯入」
                                     *   是原始檔真的有錯，給它一顆按掉的鈕，
                                     *   等於提供一個把資料錯誤藏起來的開關。
                                     */}
                                    {anomalyCanAck(item) && (
                                      <button
                                        type="button"
                                        className={
                                          anomalyAcked(item)
                                            ? "resolution-ack on"
                                            : "resolution-ack"
                                        }
                                        data-testid="issue-ack"
                                        onClick={() =>
                                          toggleAnomalyAck(
                                            anomalyFingerprint(item),
                                            !anomalyAcked(item),
                                          )
                                        }
                                      >
                                        {anomalyAcked(item)
                                          ? "取消確認"
                                          : "已人工確認"}
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                            {!filteredAnomalies.length && (
                              <tr>
                                <td colSpan={7}>
                                  目前篩選條件下沒有異常提醒。
                                </td>
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
                  ) : (
                    <p className="help">
                      目前門檻下沒有發現異常。掃過的範圍是這個計畫的全部季度。
                    </p>
                  )}
                </section>
              </div>
            </>
          )}
          {view === "page-backup" && (
            <>
              <PageHeading pageId="page-backup" />
              {/*
               * ══════════════════════════════════════════════════════
               *  備份與還原：三件事、三張卡、各自說清楚
               * ══════════════════════════════════════════════════════
               *
               * 使用者 2026-09-11（同一件事講了三次，是明確的要求）：
               *   「向全日交通量 點一下立刻就下載 有點措手不及，希望像路口
               *     轉向程式，點進去後很直白的知道，我可以匯出單一計畫作備份、
               *     匯出這程式下面我全部計畫作備份，以及也能在這邊匯入備份檔
               *     作還原。」
               *   「在全日交通程式匯入資料時，我也有發現也能在那邊匯入備份
               *     還原檔案，但路口轉向就沒辦法…路口轉向統一歸類在同一處，
               *     相對清晰好懂。」
               *   「甚至在備分還原下方新增 這三個功能的名稱，使用者點哪個功能
               *     的名稱，那個功能的卡片邊框 也能像前面說的那樣 變顯眼。」
               *
               * ⚠️ 側欄那一項**不再是按下去就產檔**。舊版是
               *   `{ label: "匯出備份", action: "backup", immediate: true }`，
               *   點一下當場下載整包——使用者的原話是「有點措手不及」。
               *   現在側欄三個子項目都只是捲到對應的卡片並把它框起來。
               *
               * ⚠️ 卡片抬頭要與側欄項目**同一個詞**。一個寫「備份本計畫」、
               *   另一個寫「只備份目前這個計畫」的話，使用者還是得自己對應。
               */}
              {/*
               * ⚠️ X-63：「刪除單一季度」依使用者指定搬到這一頁。
               *   它仍然包在 .maintenance-zone 裡——那一層只負責版面
               *   （`.maintenance-zone > section` 的內距），沒有 id，
               *   拿掉的話這一塊會變成沒有內距、貼著邊框。
               */}
              <div className="maintenance-zone">
                {/*
                 * ⚠️ X-71（使用者 2026-09-17）：「管理季度」那個視窗整個移除——
                 *   它的「清除本季資料」和底下的「刪除單一季度」是同一件事，
                 *   使用者的原話是「相同的功能一個就夠了」。
                 *
                 *   但那個視窗**另外還有改名**，而改名在整個系統裡沒有第二個入口。
                 *   整個拿掉會把一個功能一起弄丟——那不是「移除重複」，是弄丟功能。
                 *   所以改名搬到這裡自成一塊，和刪除並排。
                 */}
                <section
                  className={focusClass(
                    "maintenance-rename-quarter",
                    "panel maintenance-delete",
                  )}
                  id="maintenance-rename-quarter"
                >
                  <h3>季度改名</h3>
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列條件影響：改的是「整個季度」的名稱，不是畫面上篩出來的那一份。
                  </p>
                  <p className="help">
                    改名會同步更新所有路段、歷季分析與資料狀態。改的是主工具列目前選到的那一季（
                    {quarter ? showQuarter(quarter) : "尚未選季度"}）。
                  </p>
                  <form
                    className="maintenance-delete-row"
                    onSubmit={renameQuarter}
                  >
                    <label>
                      新的季度名稱
                      <input
                        data-testid="maintenance-rename-quarter"
                        value={quarterDraft}
                        onChange={(e) =>
                          setQuarterDraft(e.target.value.toUpperCase())
                        }
                        placeholder="例如115Q2或2026Q2"
                        required
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={busy || !activeProject || !quarter}
                    >
                      儲存新名稱
                    </button>
                  </form>
                </section>
                <section
                  className={focusClass(
                    "maintenance-delete-quarter",
                    "panel maintenance-delete",
                  )}
                  id="maintenance-delete-quarter"
                >
                  <h3>刪除單一季度</h3>
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列條件影響：刪除的是「整個季度」的分析資料，不是畫面上篩出來的那一份。
                  </p>
                  <p className="help">
                    只刪除本站的分析資料，原始上傳檔仍保留供追溯。已定稿的季度會被擋下來，要刪請先把「資料狀態」改回草稿。
                  </p>
                  <div className="maintenance-delete-row">
                    <label>
                      選擇季度
                      <select
                        data-testid="maintenance-delete-quarter"
                        value={maintenanceDeleteTarget}
                        onChange={(e) => setMaintenanceQuarter(e.target.value)}
                      >
                        {quarters.map((item) => (
                          <option key={item} value={item}>
                            {showQuarter(item)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="button danger"
                      disabled={busy || !maintenanceDeleteTarget}
                      onClick={() => {
                        void deleteQuarterKey(maintenanceDeleteTarget);
                      }}
                    >
                      刪除這一季
                    </button>
                  </div>
                </section>
              </div>
              <section className="backup-grid" id="block-backup">
                <article
                  className={focusClass("backup-one", "panel backup-card")}
                  id="backup-one"
                >
                  {/*
                   * ⚠️ 這一句是**常駐**的（不是只在某個條件被篩時才出現）。
                   *   這一塊不吃**任何一個**主工具列條件，逐條件各跳一句會變成七、八句噪音；
                   *   一句話講完。data-inapplicable="all" 是給守門看的憑據（使用者看不到）。
                   *   使用者 2026-09-15：「如果有不受主工具列某一篩選條件影響時，
                   *   是否都能在該條件出現時，會有提醒文字出現?」
                   */}
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列任何條件影響：備份帶走的是整個計畫的原始資料，不是畫面上篩出來的那一份。
                  </p>
                  <span className="backup-step">01</span>
                  <h3>備份本計畫</h3>
                  <p>
                    {selectedProject
                      ? `只帶走「${selectedProject.name}」的季度資料、PCU 係數、車種分類、路口幾何、路段別名與結論草稿範本，其他計畫不會被寫進檔案。到另一台電腦用下面第 3 張卡片匯入即可接續。`
                      : "請先選一個計畫。"}
                  </p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!activeProject}
                    onClick={exportBackup}
                  >
                    下載本計畫備份（JSON）
                  </button>
                </article>
                <article
                  className={focusClass("backup-all", "panel backup-card")}
                  id="backup-all"
                >
                  {/*
                   * ⚠️ 這一句是**常駐**的（不是只在某個條件被篩時才出現）。
                   *   這一塊不吃**任何一個**主工具列條件，逐條件各跳一句會變成七、八句噪音；
                   *   一句話講完。data-inapplicable="all" 是給守門看的憑據（使用者看不到）。
                   *   使用者 2026-09-15：「如果有不受主工具列某一篩選條件影響時，
                   *   是否都能在該條件出現時，會有提醒文字出現?」
                   */}
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列任何條件影響：備份帶走的是全部計畫的原始資料，不是畫面上篩出來的那一份。
                  </p>
                  <span className="backup-step">02</span>
                  <h3>備份全部計畫</h3>
                  <p>
                    這台電腦上的 {projects.length}{" "}
                    個計畫一次全部帶走，每個計畫各自完整。
                    還原時是<b>新增</b>這些計畫，不會覆蓋或刪除目的電腦上原有的計畫。
                  </p>
                  <button
                    type="button"
                    className="button primary"
                    disabled={!projects.length}
                    onClick={exportAllBackup}
                  >
                    下載全部計畫備份（JSON）
                  </button>
                </article>
                <article
                  className={focusClass("backup-restore", "panel backup-card")}
                  id="backup-restore"
                >
                  {/*
                   * ⚠️ 這一句是**常駐**的（不是只在某個條件被篩時才出現）。
                   *   這一塊不吃**任何一個**主工具列條件，逐條件各跳一句會變成七、八句噪音；
                   *   一句話講完。data-inapplicable="all" 是給守門看的憑據（使用者看不到）。
                   *   使用者 2026-09-15：「如果有不受主工具列某一篩選條件影響時，
                   *   是否都能在該條件出現時，會有提醒文字出現?」
                   */}
                  <p
                    className="chart-inapplicable"
                    data-testid="chart-inapplicable"
                    data-inapplicable="all"
                    data-inapplicable-always="1"
                  >
                    這一塊不受主工具列任何條件影響：還原寫回的是備份檔裡的完整資料，與畫面上的篩選無關。
                  </p>
                  <span className="backup-step">03</span>
                  <h3>還原計畫</h3>
                  <p>
                    上面兩種備份檔都可以，系統會自己分辨。
                    <b>本計畫</b>的備份會還原進目前這個計畫（同季度會先問過再覆蓋）；
                    <b>全部計畫</b>的備份會新增成新的計畫，同名時加上還原日期。
                  </p>
                  <label className="upload-zone backup-zone">
                    選擇備份檔還原
                    {/*
                     * ⚠️ 檔案欄位藏起來，由整個 label 當按鈕（點 label 一樣會開
                     *   選檔視窗）。這不是美觀問題：<input type="file"> 有很大的
                     *   內建最小寬度（實測約 300px）而且**不會縮**，放在三欄卡片
                     *   裡會把格軌撐開，整頁跟著橫向溢出——e2e-layout 在 1024 與
                     *   1100 兩個寬度量到 39px／14px。路口轉向那一支本來就是
                     *   hidden，這裡改成一致。
                     */}
                    <input
                      hidden
                      type="file"
                      accept=".json,application/json"
                      onChange={importBackup}
                    />
                    <span>支援本網站「備份本計畫」與「備份全部計畫」產生的 JSON</span>
                  </label>
                </article>
              </section>
              {/*
               * ══════════════════════════════════════════════════════
               *  清除本機資料（危險區）
               * ══════════════════════════════════════════════════════
               *
               * 使用者 2026-09-12 指定三支程式都要有，並且要補三件事：
               *   ① 確認視窗要寫出**代價**（幾個計畫、幾筆資料）
               *   ② 沒下載過備份要先提醒一次
               *   ③ 說明要講清楚它和「刪除計畫」差在哪
               *
               * 為什麼需要它（查證過才寫）：刪計畫會連同那個計畫的 PCU 當量、
               * 車種分類、路口流向設定與工作流程狀態一起刪掉，所以
               * **不會影響下一個計畫算出來的數字**。留下來的是所有計畫共用的
               * 東西——結論範本的分組偏好、匯出中心的勾選等。它們不會改到
               * 數字，但會佔空間，也會讓下一個委託案沿用上一個案子的偏好。
               * 說明文字只能寫到這個程度，不可以寫成「會默默改到你的資料」
               * ——那是嚇人，而且不是事實。
               */}
              <section
                className={focusClass("block-clear-local", "panel danger-zone")}
                id="block-clear-local"
              >
                <div>
                  <b>清除本機資料</b>
                  <p>
                    會清除這個瀏覽器裡的<b>全部計畫、全部季度資料</b>
                    ，以及 PCU 當量、車種分類、路段與流向設定、結論範本、
                    工作流程狀態與匯入紀錄。<b>無法復原，請先下載完整備份。</b>
                  </p>
                  <p className="danger-zone-why">
                    <b>和「刪除計畫」差在哪？</b>
                    刪計畫會連同<b>那一個計畫</b>的 PCU 當量、車種分類、
                    路段與流向設定一起刪掉，所以
                    <b>不會影響你下一個計畫算出來的數字</b>。
                    留下來的是<b>所有計畫共用</b>的偏好與範本，
                    它們不會改到數字，但會一直佔空間。
                    <br />
                    <b>什麼時候用這裡：</b>換一個委託案要從乾淨的狀態開始、
                    要把這台電腦或這個瀏覽器交給別人、
                    或想從空白狀態重現一個問題。
                  </p>
                </div>
                <button
                  className="button danger"
                  id="clearLocalData"
                  disabled={busy}
                  onClick={clearLocalData}
                >
                  全部清除
                </button>
              </section>
            </>
          )}
        </section>
      </div>
      {toast && <div className="toast">{toast}</div>}
      {busy && (
        <div className="busy">
          <strong>正在處理資料…</strong>
          {/*
           * 進度那一行是使用者回報「上傳大量檔案後以為沒成功」之後補的。
           * 只寫「正在處理資料…」而且一動也不動時，檔案一多就分不出
           * 「還在跑」和「當掉了」。
           */}
          {busyProgress ? <small>{busyProgress}</small> : null}
        </div>
      )}
      {/*
        * ══════════════════════════════════════════════════════════
        *  橫跨中午的尖峰小時：寫入前請使用者決定
        * ══════════════════════════════════════════════════════════
        *
        * 使用者 2026-09-12 指定的四個選項（編號與順序照他寫的）：
        *   1. 取消不匯入
        *   2. 忽略中間這個時段，正常以 00~12／12~24 區分上下午尖峰
        *   3. 將此時段歸類為上午尖峰
        *   4. 將此時段歸類為下午尖峰
        *
        * ⚠️ 預設停在第 2 項（忽略）。預設不可以是第 3 或第 4——那等於替
        *   使用者做了會改變數字的決定；預設也不該是第 1（取消），那會讓
        *   一個手滑變成整批不匯入。
        *
        * ⚠️ 為什麼會有第 1 項：使用者的原話是「也有可能是檔案數值誤植，
        *   使用者可以取消 重新檢查檔案 再重新匯入」。一個橫跨中午的尖峰
        *   有時候不是真的車流，是某一格打錯數字。
        */}
      {noonQuestions && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal noon-modal" id="noonQuestions">
            <div>
              <span>需要您決定</span>
              <h3>
                有 {noonQuestions.items.length}{" "}
                筆資料，最忙的那一小時橫跨中午
              </h3>
              <p className="noon-intro">
                系統把上午尖峰定義為「中午 12:00 以前開始的那一小時」、下午
                尖峰為「12:00 以後開始的那一小時」。以下列出的調查點，最忙的一小時
                <b>剛好跨過中午</b>（15 分鐘資料滾動計算時，或原始檔的時間格
                本身錯開時會發生）。它要算上午還是下午<b>不是程式判斷得了的事</b>
                ，請您決定。
              </p>
            </div>
            <div className="noon-list">
              {noonQuestions.items.map((item) => (
                <article key={item.key} className="noon-item">
                  <div className="noon-where">
                    <b>{item.roadName}</b>
                    <span>
                      {item.day ? `${item.day}・` : ""}
                      {item.roadId}
                    </span>
                  </div>
                  <p className="noon-figures">
                    橫跨中午的一小時：<b>{item.label}</b>，{" "}
                    {decimalFormatter.format(item.value)} PCU
                    <br />
                    若不算它，上午尖峰會是{" "}
                    {item.amLabel || "（沒有資料）"}
                    {item.amLabel
                      ? `（${decimalFormatter.format(item.amValue)} PCU）`
                      : ""}
                    、下午尖峰會是 {item.pmLabel || "（沒有資料）"}
                    {item.pmLabel
                      ? `（${decimalFormatter.format(item.pmValue)} PCU）`
                      : ""}
                    。
                  </p>
                  <div className="noon-choices">
                    {(
                      [
                        ["skip", "1. 取消，這個調查點不要匯入（我要先檢查檔案）"],
                        ["ignore", "2. 忽略這個時段，照 00:00–12:00／12:00–24:00 分"],
                        ["am", "3. 這個時段算「上午尖峰」"],
                        ["pm", "4. 這個時段算「下午尖峰」"],
                      ] as [NoonChoice, string][]
                    ).map(([value, label]) => (
                      <label key={value}>
                        <input
                          type="radio"
                          name={`noon-${item.key}`}
                          value={value}
                          checked={noonQuestions.answers[item.key] === value}
                          onChange={() =>
                            setNoonQuestions((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    answers: {
                                      ...prev.answers,
                                      [item.key]: value,
                                    },
                                  }
                                : prev,
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button secondary"
                id="noonCancelAll"
                onClick={() => {
                  setNoonQuestions(null);
                  setToast("已取消，這批資料沒有寫入。請檢查原始檔後再匯入一次。");
                }}
              >
                全部取消，都不要匯入
              </button>
              <button
                type="button"
                className="button primary"
                id="noonConfirm"
                onClick={() => {
                  void confirmPendingImport(true);
                }}
              >
                依所選的歸屬寫入
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingImport && !noonQuestions && (
        <div className="modal-backdrop">
          <div className="modal workflow-modal">
            <div>
              <span>匯入前資料檢核報告</span>
              <h3>
                {pendingImport.report.mode} {pendingImport.report.totalRows}{" "}
                筆交通紀錄
              </h3>
            </div>
            {/*
             * ── 季別可以在這裡直接改 ────────────────────────────
             *
             * 使用者 2026-09-11：「如果我有 N 份檔案，只要有一個錯，
             * 我就得全部重選，會蠻辛苦的。」
             *
             * 舊版的季別欄位在「匯入季度資料」視窗裡，而那個視窗在解析完成
             * 的同時就關掉了——發現季別填錯只能取消、重打、重選全部檔案。
             * 現在直接放在這裡，改完按確認就會再問一次。
             *
             * ⚠️ 綁的是**同一個 importQuarter state**，不是另外複製一份，
             *   所以不可能出現「這裡顯示一個、實際寫入另一個」。
             */}
            <label className="pending-quarter">
              資料季度
              <input
                value={importQuarter}
                onChange={(e) => setImportQuarter(e.target.value.toUpperCase())}
                placeholder="例如115Q2或2026Q2"
              />
              {importQuarterKey &&
              importQuarterKey !== pendingImport.parsedQuarter ? (
                <small className="pending-quarter-changed">
                  已從「{pendingImport.parsedQuarter}」改成「{importQuarterKey}
                  」， 按「確認匯入」時會再問一次；這批{" "}
                  {pendingImport.files.length} 個檔案會整批寫進{" "}
                  {importQuarterKey}。
                </small>
              ) : importQuarterKey && importQuarterKey !== importQuarter ? (
                <small className="from-content">
                  將存成「{importQuarterKey}」（資料一律以民國年記錄）
                </small>
              ) : null}
            </label>
            {pendingImport.fileWarnings.length > 0 && (
              /*
               * 少匯了一個檔，不可以只反映在「來源檔案 N」這個數字上——
               * 那要使用者自己數才會發現。這裡直接把檔名與原因寫出來。
               */
              <div className="file-warnings">
                <b>⚠️ 有 {pendingImport.fileWarnings.length} 項需要確認</b>
                <ul>
                  {pendingImport.fileWarnings.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="validation-grid">
              <div>
                <small>來源檔案</small>
                <strong>
                  {pendingImport.report.sourceFiles.length}
                  {pendingImport.files.length !==
                    pendingImport.report.sourceFiles.length && (
                    <em className="of-total">
                      ／選取 {pendingImport.files.length}
                    </em>
                  )}
                </strong>
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
            {/*
              調查日期 × 期別。對不起來用紅底，按「確認匯入」時還會再問一次；
              讀不到日期只提醒，不阻擋。
            */}
            {livePeriodChecks.some((item) => item.status !== "match") && (
              <section
                className={
                  livePeriodChecks.some((item) => item.status === "mismatch")
                    ? "workflow-warning period-date-alert-bad"
                    : "workflow-warning"
                }
                data-testid="period-date-alert"
              >
                {livePeriodChecks.some(
                  (item) => item.status === "mismatch",
                ) && (
                  <>
                    <strong>
                      ⚠️ 調查日期與你選的「{importQuarterKey}」不一致
                    </strong>
                    {livePeriodChecks
                      .filter((item) => item.status === "mismatch")
                      .map((item) => (
                        <p key={item.file}>
                          <b>{item.file}</b>：檔案裡是 {item.date}（屬{" "}
                          {item.dateLabel}），你選的是 {item.periodLabel}。
                          <small>
                            來源 {item.source}「{item.raw}」
                          </small>
                        </p>
                      ))}
                    <small>
                      按「確認匯入」時會再問一次；確認無誤才會以你選的季度寫入。
                    </small>
                    {importDateSuggestedQuarter && (
                      <button
                        className="link-button"
                        data-testid="use-file-quarter"
                        onClick={() => {
                          setImportQuarter(importDateSuggestedQuarter);
                          setToast(
                            `資料季度已改成 ${importDateSuggestedQuarter}。按「確認匯入」時會再問一次，確認後這批資料就會寫進 ${importDateSuggestedQuarter}。`,
                          );
                        }}
                      >
                        改用檔案日期的季別（{importDateSuggestedQuarter}）
                      </button>
                    )}
                  </>
                )}
                {periodUnknownNotice(livePeriodChecks) && (
                  <small>{periodUnknownNotice(livePeriodChecks)}</small>
                )}
              </section>
            )}
            {/*
             * ── 異常清單：有異常才展開，沒有就只留一行 ─────────────
             *
             * 使用者的原話：「如果匯入沒有任何異常的話，異常清單也能直接
             * 變成收合，顯示一個『無任何異常事項』的提醒，使用者就知道
             * 可以安心按確認匯入。」
             *
             * ⚠️ 一律是「收合成一行」，不是「整段不見」。
             * 那一行本身就是使用者要的答案（＝我確認過沒有異常），
             * 拿掉的話他不知道系統到底檢查了沒有。
             */}
            {pendingImport.report.warnings.length ? (
              <section className="workflow-warning" id="importWarnings">
                <div className="warning-head">
                  <strong>
                    需注意（{pendingImport.report.warnings.length} 項）
                  </strong>
                  {/*
                   * 「跳到第一項」做成**按鈕**而不是自動捲動，是刻意的：
                   * 按了才動，不會和對話框高度、匯入筆數互相影響，也不會誤判。
                   * 自動捲動在路口轉向那一支就是這樣跳錯位置的。
                   */}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      document
                        .querySelector("#importWarnings p")
                        ?.scrollIntoView({ block: "center" });
                    }}
                  >
                    跳到第一項需注意
                  </button>
                </div>
                {pendingImport.report.warnings.map((item) => (
                  <p key={item}>{item}</p>
                ))}
                {/*
                 * ══════════════════════════════════════════════════════
                 *  逐筆清單 ＋ 類型標籤篩選
                 * ══════════════════════════════════════════════════════
                 *
                 * 使用者 2026-09-13（附兩張截圖）：
                 *   「有 22 筆提醒項目，但底下列出的並沒有這麼多，感覺只是
                 *     展示前幾筆而已……能像『歷季異常提醒』那樣，列表展示，
                 *     並且有篩選功能，可以明顯看到發生了 ABCD 四個類型資料異常，
                 *     點了 A 標籤就列出 A 異常的事件，如果都沒點任何標籤，
                 *     表格就全列出全部。」
                 *
                 * ⚠️ 舊版是 `incompleteGroups.slice(0, 12)`——**畫面上沒有一句話
                 *   說被截斷了**。使用者看到「N 項」和下面十幾列，會以為自己數錯，
                 *   不會以為程式藏了幾筆。
                 *   「只顯示前 N 筆」本身不是錯，**不講才是錯**。
                 *   現在一律全列（有標籤篩選就不怕多）。
                 */}
                <ImportWarningList items={pendingImport.report.warningItems} />
              </section>
            ) : (
              <p className="workflow-ok" id="importWarnings">
                <strong>未發現異常：</strong>
                本批次已檢查空白、非數字、負值、重複鍵值與24小時缺漏，都沒有問題。
              </p>
            )}
            <p className="help">
              確認後才會寫入資料庫；覆蓋只影響相同「季度＋調查點＋日別＋方向＋時段」的紀錄，並自動建立可復原版本。
            </p>
            {/*
             * ── 動作列 ────────────────────────────────────────────
             *
             * ⚠️ 位置與顯示方式是**兩件事**，使用者兩件都要求過：
             *  ・位置：排在異常區塊**之後**、靠右
             *    →「按下去代表上面都看過了」
             *  ・顯示：黏在**對話框底緣**（.modal footer 的 sticky）
             *    →「懶得看的使用者也能直接點確認（這很方便）」
             *      「我們總不能逼迫使用者非這樣做不可」
             *
             * ⚠️ 黏的是**對話框底緣**，不是視窗底緣。
             * 黏在視窗上等於在使用者還沒捲到異常區之前就把確認鈕推到眼前。
             */}
            <footer className="sticky-actions">
              <button
                className="button secondary"
                onClick={() => {
                  // 取消時把匯入視窗叫回來，使用者才不用重新從工具列點一次
                  setPendingImport(null);
                  setShowImport(true);
                  /* 取消＝這一批併入不算數，別名也不留。 */
                  pendingAliasRef.current = new Map();
                }}
              >
                取消，資料不變
              </button>
              <button
                className="button primary"
                onClick={() => {
                  void confirmPendingImport();
                }}
              >
                確認{pendingImport.report.mode}
              </button>
            </footer>
          </div>
        </div>
      )}
      {/*
        * ══════════════════════════════════════════════════════════════
        *  「品質與定稿」視窗整塊已於 2026-09-16 移除（X-43）
        * ══════════════════════════════════════════════════════════════
        *
        * 使用者 2026-09-16（附圖）：
        *   「全日交通量的品質與定稿分頁中似乎就是一個資料維護的半成品了，
        *     可以將此頁面與資料維護的內容做個融合。到時資料匯入的這個
        *     "品質與定稿"就能移除或是改名稱，點下去就是跳轉到資料維護分頁中」
        *
        * 裡面的四塊（完整度摘要＋資料狀態、異常提醒門檻、歷季異常提醒
        * 的篩選與表格）**整個搬到**「五　資料產出與維護」的資料維護，
        * 不是砍掉。原本的入口（側欄、工具列、本季總覽那顆）全部改成跳轉。
        *
        * ⚠️ 不要再把它加回來：同一件事留兩個入口，遲早會分岔成兩套數字。
        *   這正是使用者一路在要求收斂的那個毛病。
        */}
      {/*
        * ══════════════════════════════════════════════════════════════
        *  「版本差異與還原」整塊已於 2026-09-16 從畫面移除
        * ══════════════════════════════════════════════════════════════
        *
        * 使用者 2026-09-16：
        *   「全日交通量一樣有版本差異與還原，作法如同交通服務水準程式一樣辦理，
        *     如果你維護有用到，就隱藏在程式碼給你自己看就好，存留筆數由你自己決定，
        *     使用者不須要從畫面查看。我看全日交通量這項功能裡面唯一有用是
        *     **單一筆資料刪除**的功能，但長期累積下來，這些會很長串，
        *     所以寧願捨棄，**保留刪除單一季度功能就可以了**」
        *
        * 所以這一塊原本的三段各自的下場不同：
        *   ・匯入紀錄／還原匯入前 → **保留機制、移除畫面**（見維護入口）
        *   ・依來源檔刪除         → **整個拿掉**（使用者指名捨棄；
        *                            要刪就用「管理季度」的刪除單一季度）
        *   ・來源追溯預覽（前100筆）→ **整個拿掉**（與交通服務水準同一個裁示：
        *                            使用者用不到這類資訊）
        *
        * ⚠️ 還原點（workflow.history）**照常寫入**，而且照常跟著備份走。
        *   拿掉的只有畫面。維護時在主控台呼叫：
        *     globalThis.N2064UndoList()          // 列出還原點
        *     globalThis.N2064UndoRestore("<id>") // 還原到那一刻之前
        */}
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
              {/*
               * ── 2026-09-15 大檢查：這一排條件以前**是空的接線** ────────
               *
               *   舊版是 renderBlockFilters({...}, CHART_EXPORT)，它把值寫進
               *   chartOverrides["export-center"]，但**全程式沒有任何一處讀它**
               *  （比對：CHART_HOURLY、CHART_TRACE、CHART_PERIOD… 每一個都有
               *   filtersOf(...) 的讀取端，只有 CHART_EXPORT 沒有）。
               *   後果：使用者在這裡改季度或日別，畫面上的值真的變了、
               *   還會冒出「回到主工具列條件」，而**匯出的 Excel 與報表草稿
               *   一個字都沒變**——那是最糟的一種壞掉：看起來完全正常。
               *
               *   修法不是把它接到一份新的條件上（匯出與草稿的數字來自
               *   十幾個上游 memo，全部改接是一次大手術，風險遠大於效益），
               *   而是**讓它名副其實**：這一區的條件本來就宣告自己是主工具列的
               *   鏡子，那就讓它直接改主工具列——改了之後匯出與草稿必然跟著變，
               *   因為兩者讀的就是主工具列那一份。
               *
               * ⚠️ 起 > 迄 的自動對調要與主工具列**完全一致**，
               *   否則同一個動作在兩個地方會有兩種結果。
               */}
              <div className="block-filters" data-testid="export-scope-filters">
                <label>
                  季度（起）
                  <select
                    data-testid="export-quarter-from"
                    value={quarterFrom}
                    onChange={(e) => {
                      const next = e.target.value;
                      setQuarterFromTouched(true);
                      setQuarterFrom(next);
                      if (compareQuarters(next, quarter) > 0) setQuarter(next);
                    }}
                  >
                    {quarters.map((q) => (
                      <option key={q} value={q}>
                        {quarterLabel(q)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  季度（迄）
                  <select
                    data-testid="export-quarter-to"
                    value={quarter}
                    onChange={(e) => {
                      const next = e.target.value;
                      setQuarter(next);
                      if (compareQuarters(quarterFrom, next) > 0)
                        setQuarterFrom(next);
                    }}
                  >
                    {quarters.map((q) => (
                      <option key={q} value={q}>
                        {quarterLabel(q)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  日別
                  <select
                    data-testid="export-day"
                    value={dayType}
                    onChange={(e) => setDayType(e.target.value as DayMode)}
                  >
                    <option>平日</option>
                    <option>假日</option>
                    <option>平日＋假日</option>
                  </select>
                </label>
                {hasIntersectionRecords && (
                  <label>
                    路口流量視角
                    <select
                      data-testid="export-flow-view"
                      value={flowChoice}
                      onChange={(e) =>
                        setFlowChoice(e.target.value as FlowChoice)
                      }
                    >
                      {(["origin", "destination", "both"] as FlowChoice[]).map(
                        (choice) => (
                          <option key={choice} value={choice}>
                            {FLOW_CHOICE_LABELS[choice]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                <label>
                  尖峰時段認定
                  <select
                    data-testid="export-peak-scope"
                    value={periodPeakScope}
                    onChange={(e) =>
                      setPeriodPeakScope(e.target.value as PeakScope)
                    }
                  >
                    {(["point", "direction"] as PeakScopeChoice[]).map(
                      (choice) => (
                        <option key={choice} value={choice}>
                          {PEAK_SCOPE_CHOICE_LABELS[choice]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {/*
               * ⚠️ 這一區**不另外做一顆「套用主工具列目前的條件」**，
               *   因為上面那一排就是主工具列本身——在這裡改等於在主工具列改，
               *   匯出的 Excel 與報表草稿必然跟著變。
               *
               *   舊版在這裡宣稱「在這裡改就只有這一區用自己的條件」，
               *   那句話是假的：改了之後只有畫面上的值會變，
               *   匯出與草稿一個字都沒變（沒有任何一處讀 export-center 的覆寫）。
               *   宣稱一件做不到的事，比不宣稱更糟。
               */}
              <p className="export-scope-summary" data-testid="export-follows-main">
                這一排就是<b>主工具列的條件</b>：在這裡改，等於在主工具列改，
                匯出的 Excel 與下方的報表草稿都會跟著變（畫面上其他圖表也會）。
              </p>
              <p className="export-scope-summary">
                目前將匯出：<b>{showQuarter(quarter)}</b>・<b>{dayType}</b>・
                <b>
                  {roadFilters.length === 0
                    ? "全部調查點"
                    : roadFilters.length === 1
                      ? (roadOptions.find(
                          ([id]) => id === roadFilters[0],
                        )?.[1] ?? roadFilters[0])
                      : `${roadFilters.length} 個調查點`}
                </b>
                ・<b>{directionLabelText}</b>
                {hasIntersectionRecords ? (
                  <>
                    ・路口以<b>{intersectionFlowLabel}</b>視角統計
                  </>
                ) : null}
              </p>
              {/*
                這段以前寫「歷季全日量與趨勢」都依歷季分析面板的條件，
                但只有「歷季趨勢」是這樣；「歷季組成圖表資料」依主工具列的
                日別與調查點逐點逐日別輸出；
                「歷季全日交通量」與「歷季車種組成」走的是未經篩選的全部
                資料（所有季度、所有日別、所有調查點），刻意如此——那兩張
                是明細底稿。說明必須與實作一致，否則使用者會以為自己已經
                把範圍縮小了。
              */}
              <p className="export-scope-note">
                下列項目有自己的條件，不受主工具列的「日別」與「調查點」影響：
                <b>歷季趨勢</b>依「歷季分析」面板的
                {trendMode}／
                {trendRoadLabel}
                。<b>歷季組成圖表資料</b>依主工具列的{dayType}／
                {roadFilters.length === 0
                  ? "全部調查點"
                  : roadFilters.length === 1
                    ? (roadOptions.find(([id]) => id === roadFilters[0])?.[1] ??
                      roadFilters[0])
                    : `${roadFilters.length} 個調查點`}
                ，一列一個調查點 × 日別，不做跨點或跨日合併；
                <b>車種組成</b>依上方共同功能列的{compositionScopeText}。
                <b>歷季全日交通量</b>與<b>歷季車種組成</b>是明細底稿，
                一律輸出本計畫全部季度、全部日別、全部調查點，不受任何篩選影響，
                並在「調查涵蓋」欄逐列標示該季實際調查了多久。
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
                例如只勾「上午尖峰＋下午尖峰」與「車輛數、百分比」，就只會得到這兩個時段各一張工作表、每張各寫車輛數與百分比。
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
                                  item === key ||
                                  previous.periods.includes(item),
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
                                  item === key ||
                                  previous.metrics.includes(item),
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
                {/*
                 * 匯出中心也要有同一行說明——這裡選的東西會直接寫進交出去的
                 * Excel，比畫面上更不能猜。字與畫面同一份（period-analysis.ts），
                 * 不可以在這裡另外抄一段，兩份遲早會分岔。
                 */}
                <small className="export-period-hint">
                  {periodExport.peakScope === "follow"
                    ? `跟著主工具列目前的選擇走（現在是「${
                        mainFilters.peakScope === "point"
                          ? "整個調查點同一時段"
                          : "各方向各自認定自己的尖峰"
                      }」）。${PEAK_SCOPE_HINTS[mainFilters.peakScope]}`
                    : PEAK_SCOPE_HINTS[periodExport.peakScope]}
                </small>
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
                  只有路口格式的調查點會受這一項影響；路段格式一律是方向 A／方向
                  B。
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
                (!periodExport.periods.length ||
                  !periodExport.metrics.length) && (
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
                    <b>這一份是「這批 Excel 的說明文字」</b>
                    ：段落跟著上面勾選的匯出項目走，
                    勾了哪幾張工作表就寫哪幾段，會和 Excel 一起交出去。
                    要自己挑條件（只寫某一季、某幾個路段、只寫車輛數…）請改用畫面最下方的
                    <b>「結論草稿產生器」</b>。兩邊的數字來源完全相同。
                    <br />
                    依目前的匯出範圍自動寫成一段中文敘述，可直接複製進報告。
                    <b>上方每一個可勾選的匯出項目，草稿裡都有對應的一段</b>，
                    另外再加上「分析範圍」「時段車種分析」「各調查點分項結果」「歷季異常提醒」四段，共
                    12 段。 其中
                    <b>「各調查點分項結果」是逐個路段／路口各寫一段</b>
                    （每個方向、每個分析時段各一行），
                    條件跟著上方「時段車種分析」的設定走——分析時段、尖峰時段認定、路口流量視角、
                    方向／支線、要匯出的數值；整體的總結照舊保留在其他段落，兩者可以各自勾選。
                    要寫哪幾段請用<b>「段落勾選」</b>
                    控制（與上方的匯出勾選各自獨立，
                    只有「7張可編輯原生圖表」那一段會跟著匯出勾選一起消失，因為沒勾就真的沒有附圖）。
                    勾了但目前沒有資料的段落會明講「沒有可敘述的資料」，不會靜靜消失。
                  </p>
                </div>
                <div className="report-draft-actions">
                  {/*
                   * ⚠️ 小數位數要和結論草稿同一組選項（0／1／2），
                   *   否則同一批數字在兩份文件裡以不同位數出現，
                   *   而兩份都沒有一句話解釋為什麼。
                   *   車輛數（輛）仍然維持整數——「輛」本來就是整數。
                   */}
                  <label className="report-draft-digits">
                    小數位數
                    <select
                      data-testid="report-draft-digits"
                      value={String(reportDraftDigits)}
                      onChange={(e) => {
                        setReportDraftDigits(Number(e.target.value));
                        setDraftEdited(false);
                      }}
                    >
                      {[0, 1, 2].map((d) => (
                        <option key={d} value={d}>
                          {d} 位
                        </option>
                      ))}
                    </select>
                  </label>
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
                      {report.roadFilters?.length
                        ? `${report.roadFilters.length} 個調查點`
                        : "全部調查點"}
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
              Excel 開檔時出現修復提示。舊版 Excel 請改用右上角 .xls
              數值相容檔。
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
                maxLength={PROJECT_NAME_LIMIT}
                onChange={(e) =>
                  setNewProject({
                    ...newProject,
                    /* maxLength 擋鍵盤輸入，slice 擋貼上——兩個都要。 */
                    name: capText(
                      e.target.value,
                      newProject.name,
                      PROJECT_NAME_LIMIT,
                    ),
                  })
                }
                required
              />
              <small className="field-note">
                最多 {PROJECT_NAME_LIMIT} 字，太長會在清單與側欄擠不下 （目前{" "}
                {newProject.name.length} 字）
              </small>
            </label>
            <div className="two-col">
              <label>
                計畫編號
                <input
                  value={newProject.code}
                  maxLength={PROJECT_CODE_LIMIT}
                  onChange={(e) =>
                    setNewProject({
                      ...newProject,
                      code: capText(
                        e.target.value,
                        newProject.code,
                        PROJECT_CODE_LIMIT,
                      ),
                    })
                  }
                />
                <small className="field-note">
                  最多 {PROJECT_CODE_LIMIT} 字（目前 {newProject.code.length}{" "}
                  字）
                </small>
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
              {/*
               * ⚠️ 抬頭與刪除對象都要看 managedProject，不是 selectedProject。
               *   2026-09-11 起「我的計畫」那一頁每一列都能開這個視窗，
               *   而要改的**不一定是目前這一個**。
               *   抬頭寫錯只是誤導；刪除鈕若還是刪「目前這一個」，
               *   就是按了「修改 A」結果刪掉 B——不可逆。
               */}
              <h3>修改或刪除「{managedProject.name}」</h3>
            </div>
            <label>
              計畫名稱
              <input
                value={projectDraft.name}
                /* 既有的長名稱不可以被 maxLength 擋住編輯，見 capText 的說明。 */
                maxLength={Math.max(
                  PROJECT_NAME_LIMIT,
                  projectDraft.name.length,
                )}
                onChange={(e) =>
                  setProjectDraft({
                    ...projectDraft,
                    name: capText(
                      e.target.value,
                      projectDraft.name,
                      PROJECT_NAME_LIMIT,
                    ),
                  })
                }
                required
              />
              <small className="field-note">
                最多 {PROJECT_NAME_LIMIT} 字（目前 {projectDraft.name.length}{" "}
                字）
                {projectDraft.name.length > PROJECT_NAME_LIMIT
                  ? "　※ 這是既有的長名稱，系統不會替您截斷；要縮短請自行修改"
                  : ""}
              </small>
            </label>
            <div className="two-col">
              <label>
                計畫編號
                <input
                  value={projectDraft.code}
                  maxLength={Math.max(
                    PROJECT_CODE_LIMIT,
                    projectDraft.code.length,
                  )}
                  onChange={(e) =>
                    setProjectDraft({
                      ...projectDraft,
                      code: capText(
                        e.target.value,
                        projectDraft.code,
                        PROJECT_CODE_LIMIT,
                      ),
                    })
                  }
                />
                <small className="field-note">
                  最多 {PROJECT_CODE_LIMIT} 字（目前 {projectDraft.code.length}{" "}
                  字）
                </small>
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
                /*
                 * ⚠️ 不可以寫成 onClick={deleteProject}。
                 *   deleteProject 的第一個參數是「要刪哪一個計畫」，
                 *   直接當事件處理器的話 React 會把**滑鼠事件物件**傳進去，
                 *   於是 target.id 變成事件的 id（undefined），
                 *   刪除對象就不是使用者按的那一個了。
                 *   tsc 抓得到這個（TS2322），但 vite 建置不做型別檢查，
                 *   所以 npm test 一定要跑 `tsc --noEmit`。
                 */
                onClick={() =>
                  deleteProject({
                    id: managedProject.id,
                    name: managedProject.name,
                  })
                }
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
                placeholder="例如115Q2或2026Q2"
              />
              {/*
                打西元年時要當場告訴使用者實際會存成什麼。
                資料一律以民國年寫法存放（見 importQuarterKey 的說明），
                不講的話使用者會以為畫面上會看到 2026Q2，找不到就重打一次，
                結果同一季被匯入兩遍。
              */}
              {importQuarterKey && importQuarterKey !== importQuarter ? (
                <small className="from-content">
                  將存成「{importQuarterKey}」（資料一律以民國年記錄）
                </small>
              ) : null}
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
                accept=".xls,.xlsx,.xlsm"
                onClick={() => setPickingFiles(true)}
                onChange={(e) => {
                  setPickingFiles(false);
                  return importFiles(e);
                }}
              />
              <strong>拖曳 Excel 檔案到這裡</strong>
              <span>
                或點一下選擇單筆／多筆檔案；只有相同調查點、日別、方向與時段才會詢問是否覆蓋
              </span>
              {/*
                按下去到 change 之間完全是瀏覽器在讀檔，程式插不進去，
                所以提示只能從按下去那一刻開始顯示。取消時由 focus 那條退路收掉。
              */}
              {pickingFiles && (
                <p className="picking-files-hint" role="status">
                  正在讀取您選擇的檔案，請稍候…
                </p>
              )}
            </div>
            {/*
             * ⚠️ 這裡**刻意不再放「還原備份」**。
             *
             * 使用者 2026-09-11：「在全日交通程式匯入資料時，我也有發現也能在
             * 那邊匯入備份還原檔案，但路口轉向就沒辦法在匯入資料那邊，有匯入
             * 備份的功能，但路口轉向統一歸類在同一處，相對清晰好懂。」
             * 「我希望三個程式 在匯入檔案那邊，就是很乾淨的讓使用者匯入檔案用，
             * 不用兼具匯入還原檔案」。
             *
             * 同一件事有兩個入口，使用者要猜哪一個才對；而且兩個入口的行為
             * 一旦分岔（例如只有一邊擋定稿季度），那個鎖就等於沒有。
             * 還原一律走「五 資料產出與維護 → 還原計畫」那張卡片。
             */}
            {!activeProject && (
              <p className="help backup-first-hint">
                <b>目前還沒有任何計畫。</b>
                要從其他電腦的備份檔接續，請到「五 資料產出與維護」的
                <b>「還原計畫」</b>
                ——系統會依備份檔裡的計畫名稱自動建立計畫再還原。
                （這裡的 Excel 匯入需要先有計畫與季度。）
              </p>
            )}
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
              系統會保留檔案中的原始車種。選擇「獨立分析」可在圖表、比例與匯出表中單獨顯示；選擇四大類之一則會合併計算。當量值由使用者自訂，不設最小值或固定增量。匯入時偵測到的新車種一律先預設為獨立車種、當量係數
              1，請在此依實際需要修改。
            </p>
            <p className="help">
              灰底不能編輯的列代表這個車種是用原四大類（機車／小型車／大型車／特種車）的係數計算，欄位直接顯示外面「PCU
              當量係數」目前的數值：在外面把機車改成 0.42
              並按「套用係數」，這裡就會同步變成
              0.42，兩邊永遠是同一個數字。要改這幾列請回到外面的 PCU
              當量係數區塊。
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
                    const isNewVehicle =
                      setting.sourceKey.startsWith("custom:");
                    return (
                      <tr
                        key={setting.sourceKey}
                        /*
                         * ⚠️ 新車種整列標色，不是只有那個小字。
                         *
                         * 使用者 2026-09-11 在路口轉向實測漏看：畫面寫
                         * 「辨識到 4 個原始車種」，他以為就是系統內建的四大類
                         *（機車／小型車／大型車／特種車），沒注意到第四個是
                         * 「聯結車」——因為「新增車種」是灰色小字，和「原四大類」
                         * 長得幾乎一樣。他是看到當量係數是 1 才發現的。
                         *
                         * 三支程式同一套做法（他的要求：踩過的雷三支都不能再踩）。
                         */
                        className={isNewVehicle ? "vehicle-row-new" : undefined}
                      >
                        <td>
                          <strong>{setting.sourceLabel}</strong>
                          {isNewVehicle ? (
                            <span className="vehicle-badge-new">
                              新增車種・請確認歸類
                            </span>
                          ) : (
                            <small>原四大類</small>
                          )}
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
            {derivedArmNotice[intersectionManageRoad] && (
              /*
               * 預填了就一定要在視窗上講出來，而且要講依據。
               * 只在 toast 講不夠：toast 會消失，而使用者是在這個視窗裡按下
               *「儲存設定」的——決定的當下就要看得到這是反推值而不是預設值。
               */
              <p className="help prefill-note">
                {/*
                 * ⚠️ 這裡原本是 .replace(/\*\*​/g, "")——把粗體記號**刪掉**。
                 *   結果是：上面那段字刻意用 **不是預設值** 標出來的重點，
                 *   在畫面上和其他字長得一模一樣，等於沒標。
                 *   本檔已經有 boldParts()（chart-notes 在用），改成用它，
                 *   標記就真的變成粗體，而不是被清掉。
                 */}
                ⚠️ {boldParts(derivedArmNotice[intersectionManageRoad])}
              </p>
            )}
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
                        {armLabel(setting.directionCode, setting.name)}
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
              {/*
               * ══════════════════════════════════════════════════════════
               *  這是轉向歸屬的**唯一**依據（2026-09-13 使用者裁示）
               * ══════════════════════════════════════════════════════════
               *
               * 使用者：「『起點→終點轉向判定』當唯一依據，『駛出目的支線』整組拿掉。
               *   目前使用者就已經能協助系統正確判定左轉/直行/右轉分別進入哪個路口了，
               *   所以才給使用者手動修正設定的功能，**請不要只靠系統自動依照角度判定，
               *   有時會失真，而是以使用者判定為主**。預設是系統自動由角度判定，
               *   然後使用者手動修正做為複核，最後匯入資料。」
               *
               * ⚠️ 所以每一格都記得自己是誰決定的（routeSources）：
               *   改角度只重算「系統判定」的格子，人工修正過的原封不動。
               */}
              <p>
                預設由各支線角度自動判定，<b>您改過的格子會標成「已人工修正」，
                之後調整任何一支的角度都不會動到它</b>。
              </p>
              {managedTurnConflicts.length > 0 && (
                <div className="route-conflicts">
                  <p className="warn-text">
                    ⚠️ 有 {managedTurnConflicts.length} 個轉向的判定對不上這個路口的調查表，
                    這些車量目前掛在「未指定駛入路口」，請在下表修正：
                  </p>
                  <ul>
                    {managedTurnConflicts.map((conflict) => (
                      <li
                        key={`${conflict.directionCode}-${conflict.turn}`}
                        className="warn-text"
                      >
                        {describeTurnConflict(conflict)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {managedArmSettings.map((source) => (
                <details
                  key={source.directionCode}
                  open={source.directionCode === intersectionDiagramSource}
                >
                  <summary>
                    由{armLabel(source.directionCode, source.name)}駛出
                    {managedTurnConflicts.some(
                      (conflict) =>
                        conflict.directionCode === source.directionCode,
                    ) && <span className="route-conflict-flag">需修正</span>}
                  </summary>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>終點支線</th>
                          <th>終點角度</th>
                          <th>判定</th>
                          <th>由誰決定</th>
                        </tr>
                      </thead>
                      <tbody>
                        {managedArmSettings
                          .filter(
                            (target) =>
                              target.directionCode !== source.directionCode,
                          )
                          .map((target) => {
                            const movement =
                              source.routes[target.directionCode] ??
                              classifyMovement(source.angle, target.angle);
                            const manual =
                              source.routeSources?.[target.directionCode] ===
                              "manual";
                            /*
                             * ⚠️ 只標「這一格所屬的轉向有衝突」，不是整支線都標紅。
                             *   整支線標紅的話，使用者不知道要改哪一格。
                             */
                            const conflicted = managedTurnConflicts.some(
                              (conflict) =>
                                conflict.directionCode ===
                                  source.directionCode &&
                                conflict.turn === movement,
                            );
                            return (
                              <tr
                                key={target.directionCode}
                                className={
                                  conflicted ? "route-row-conflict" : undefined
                                }
                              >
                                <td>
                                  {armLabel(target.directionCode, target.name)}
                                </td>
                                <td>
                                  {normalizeAngle(target.angle).toFixed(0)}°
                                </td>
                                <td>
                                  <select
                                    value={movement}
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
                                <td>
                                  <span
                                    className={
                                      manual
                                        ? "route-source route-source-manual"
                                        : "route-source"
                                    }
                                  >
                                    {manual ? "已人工修正" : "系統依角度判定"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>
            <p className="help">
              「駛出路口X」依原始報告的來源支線統計（以 X
              為起點）；「駛入路口X」依上方目的支線重新彙整（以 X
              為終點）。兩種視角均保留各車種、轉向PCU與每小時尖峰，總交通量應一致。
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
    </main>
  );
}

/**
 * 結論草稿產生器的條件面板與文字框。
 *
 * 刻意做成獨立元件、狀態由外面傳進來：收合再展開時條件與草稿都還在，
 * 使用者不會因為捲動或收合而丟掉剛設好的一整組條件。
 */
/*
 * 年度是「115」這種光年份的字串，沒有 Qn，showQuarter() 認不得。
 * 借一個季度殼子換算完再把 Qn 去掉；換不成就原樣回傳。
 */
function showYearOnly(year: string, show: (value: string) => string) {
  const match = String(show(String(year) + "Q1")).match(/^(\d{2,4})Q1$/);
  return match ? match[1] : String(year);
}

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
  /*
   * 季度要顯示成民國年還是西元年。只換看到的字：下拉選單的 value、篩選、
   * 排序與分組一律走儲存的季度字串，切換不會挑到不同的資料。
   */
  showQuarter: (value: string) => string;
  /**
   * 「套用主工具列目前的條件」。回傳一段文字說明套用了什麼，由這裡 notify 出去。
   * ⚠️ 不可以默默改掉使用者設好的一整組條件——他會以為是自己剛才點錯了。
   */
  applyMainFilters?: () => string;
  /**
   * 「跟著主工具列」時，主工具列目前的尖峰時段認定是哪一種（畫面上的字）。
   * ⚠️ 草稿要把**實際採用**的那一種寫出來——寫「跟著主工具列」等於沒說，
   *   讀報告的人手上沒有那個主工具列。
   */
  mainPeakScopeLabel: string;
  /** 同上，但是原始值——草稿要靠它判斷「各方向各自認定＝不可相加」。 */
  mainPeakScope: "point" | "direction";
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
        ...new Set(
          rows.map((row) => conclusionQuarterYear(row.quarter)).filter(Boolean),
        ),
      ].sort(),
    [rows],
  );
  const dayTypeList = useMemo(
    () => [...new Set(rows.map((row) => row.dayType))].sort(),
    [rows],
  );
  const roadList = useMemo(
    () =>
      [
        ...new Map(rows.map((row) => [row.roadId, row.roadName])).entries(),
      ].sort((a, b) => a[0].localeCompare(b[0], "en")),
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
      map.set(
        row.scopeCode,
        new Set([...(map.get(row.scopeCode) ?? []), name]),
      );
    }
    return [...map.entries()]
      .sort((a, b) =>
        a[0] === "ALL"
          ? -1
          : b[0] === "ALL"
            ? 1
            : a[0].localeCompare(b[0], "en"),
      )
      .map(
        ([code, names]) => [code, [...names].join("／")] as [string, string],
      );
  }, [rows, condition.roadIds]);

  const matched = useMemo(
    () => selectConclusionRows(rows, condition).length,
    [rows, condition],
  );

  /* 「產生草稿」在條件面板的上方，草稿框在最下面；按完要把使用者帶過去。 */
  const draftBoxRef = useRef<HTMLDivElement | null>(null);

  const patch = (next: Partial<ConclusionCondition>) =>
    props.setCondition({ ...condition, ...next });
  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];

  function generate() {
    if (
      props.edited &&
      !window.confirm(
        "您已經手動修改過草稿。重新產生會覆蓋掉修改內容，確定要繼續嗎？",
      )
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
        /* 草稿上的季度跟著畫面的年份顯示切換走；篩選與排序仍走儲存值。 */
        showQuarter: props.showQuarter,
        generatedAt: stamp,
        peakScopeLabel:
          !condition.peakScope || condition.peakScope === "follow"
            ? `${props.mainPeakScopeLabel}（跟著主工具列）`
            : condition.peakScope === "point"
              ? "整個調查點同一時段（可相加）"
              : "各方向各自認定自己的尖峰",
        peakScopeResolved:
          !condition.peakScope || condition.peakScope === "follow"
            ? props.mainPeakScope
            : condition.peakScope,
      }),
    );
    props.setEdited(false);
    props.notify("結論草稿已產生。");
    /*
     * 唯一的「產生草稿」就在草稿框旁邊，所以正常情況下結果本來就在眼前，
     * revealResult() 會判斷「已經看得到」而完全不動。保留是為了少數例外
     * ——視窗特別矮、或草稿變長把框推出畫面外。
     * 等 React 把新草稿畫完再量位置，否則量到的是舊高度。
     */
    requestAnimationFrame(() => revealResult(draftBoxRef.current));
  }

  const scope = condition.scope;

  return (
    <div className="conclusion-body">
      {/*
       * 這裡原本另有一顆「產生草稿」，和草稿框旁邊那一顆呼叫同一個函式。
       * 使用者指出實際動線用不到它：條件與條件範本都在下方，
       *「哪怕條件沒變，為了確保資料正確，正常情況下仍會往下滑動確認條件」，
       * 所以每一條動線最後都停在草稿框旁邊。兩顆同名按鈕反而讓人以為有差別，
       * 也可能讓新手在還沒勾任何條件時就按下去，拿到一份用預設條件產生的草稿。
       */}
      <div className="conclusion-head">
        {/*
         * ⚠️ 使用者 2026-09-14 裁示：結論草稿**維持獨立**（不自動跟著主工具列跑），
         *   另加這一顆一鍵對齊。理由很實際：報告常常要寫一段和畫面上不同的範圍
         *  （畫面在看最新一季、報告要出全年）。
         */}
        {props.applyMainFilters && (
          <button
            type="button"
            className="button secondary"
            data-testid="conclusion-apply-main"
            onClick={() => props.notify(props.applyMainFilters!())}
          >
            套用主工具列目前的條件
          </button>
        )}
        <b className={matched ? "conclusion-count" : "conclusion-count zero"}>
          符合條件 {matched} 列
        </b>
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
                        scope: {
                          kind: "quarter",
                          quarter: quarters.at(-1) || "",
                        },
                      });
                    else if (entry[0] === "year")
                      patch({
                        scope: { kind: "year", year: years.at(-1) || "" },
                      });
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
                    {props.showQuarter(q)}
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
                onChange={(e) =>
                  patch({ scope: { kind: "year", year: e.target.value } })
                }
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {showYearOnly(y, props.showQuarter)} 年
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
                      scope: {
                        kind: "range",
                        from: e.target.value,
                        to: scope.to,
                      },
                    })
                  }
                >
                  {quarters.map((q) => (
                    <option key={q} value={q}>
                      {props.showQuarter(q)}
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
                      scope: {
                        kind: "range",
                        from: scope.from,
                        to: e.target.value,
                      },
                    })
                  }
                >
                  {quarters.map((q) => (
                    <option key={q} value={q}>
                      {props.showQuarter(q)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </fieldset>

        <fieldset className="conclusion-field">
          <legend>二、時段、日別與尖峰時段認定</legend>
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
                  onChange={() =>
                    patch({ dayTypes: toggle(condition.dayTypes, day) })
                  }
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
              使用者常見的需求是「我只要整段調查的數字」——那不是取消全部，
              而是只勾「全調查時段」，所以直接把作法寫出來。
            */}
            時段至少要留一個；
            <b>只想要整段調查的數字就只勾「全調查時段」</b>。
          </p>
          {/*
            ── 尖峰時段認定與路口流量視角（使用者 2026-09-15 指名補上）──

            ⚠️ 兩項都**本來就在影響草稿的數字**，只是沒有控制項：
              ・尖峰時段認定：conclusionRows 一直把主工具列的值傳進 buildPeriodRows。
              ・路口流量視角：草稿本來就同時產生駛出與駛入兩套列，
                只能靠「要寫哪些方向／支線」那一長串去挑，看不出那是視角。
            預設都是「跟著主工具列」「駛出＋駛入」，也就是**升級當天一個數字都不變**。
          */}
          <label className="conclusion-inline">
            尖峰時段認定
            <select
              value={condition.peakScope || "follow"}
              onChange={(e) =>
                patch({
                  peakScope: e.target
                    .value as NonNullable<ConclusionCondition["peakScope"]>,
                })
              }
            >
              <option value="follow">跟著主工具列</option>
              <option value="point">整個調查點同一時段（可相加）</option>
              <option value="direction">各方向各自認定自己的尖峰</option>
            </select>
          </label>
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
          <legend>四、方向／支線與路口流量視角</legend>
          <div className="conclusion-list">
            {scopeList.map((entry) => (
              <label key={entry[0]}>
                <input
                  type="checkbox"
                  checked={condition.scopeCodes.includes(entry[0])}
                  onChange={() =>
                    patch({
                      scopeCodes: toggle(condition.scopeCodes, entry[0]),
                    })
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
          <label className="conclusion-inline">
            路口流量視角
            <select
              value={condition.flowView || "both"}
              onChange={(e) =>
                patch({
                  flowView: e.target
                    .value as NonNullable<ConclusionCondition["flowView"]>,
                })
              }
            >
              <option value="both">駛出＋駛入都寫</option>
              <option value="origin">只寫駛出路口</option>
              <option value="destination">只寫駛入路口</option>
            </select>
          </label>
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
                    onChange={() =>
                      patch({ metrics: toggle(condition.metrics, key) })
                    }
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
          {/*
            這個選項舊版只影響當量交通量（PCU）：使用者勾
            「車輛數（輛）＋車種組成（輛數與百分比）」時，改它畫面上一個字
            都不會變（實測回報）。修正後百分比也跟著走；車輛數維持整數，
            因為「輛」本來就是整數，印成 6,000.00 輛沒有意義。
            標籤文字不動。
          */}
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
                /*
                 * ⚠️ 同名覆寫的比對要過 typedNameKey()。
                 *   範本名稱是使用者自己打的，「季報用」與「季報 用」在清單上
                 *   分不出來；用原字串比的話不會覆寫，而是多存一筆——
                 *   之後按錯就套到舊條件（例如還勾著去年的季度區間），
                 *   而畫面看不出差別。
                 */
                ...props.templates.filter(
                  (item) => typedNameKey(item.name) !== typedNameKey(name),
                ),
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
                  className="button danger"
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

      <div className="conclusion-output" ref={draftBoxRef}>
        <div className="conclusion-head">
          <strong>結論草稿</strong>
          <div className="conclusion-actions-row">
            <button type="button" className="button primary" onClick={generate}>
              產生草稿
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!props.draft}
              onClick={() => {
                navigator.clipboard
                  ?.writeText(props.draft)
                  .then(() => props.notify("已複製到剪貼簿。"))
                  .catch(() =>
                    props.notify("瀏覽器不允許複製，請手動全選複製。"),
                  );
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
          placeholder="條件勾選完成之後，按「產生草稿」。"
          onChange={(e) => {
            props.setDraft(e.target.value);
            props.setEdited(true);
          }}
        />
        <p className="conclusion-hint">
          {props.edited
            ? "您已手動修改過這份草稿；按「產生草稿」會先詢問再覆蓋。"
            : "這段文字可以直接修改，改過之後不會被自動覆蓋。"}
        </p>
      </div>
    </div>
  );
}

/*
 * ⚠️ 這個函式**刻意放在元件之後**。放在元件之前時，
 *   eslint 的 react-hooks/immutability 會改在別處報，
 *   讓元件裡那個有理由的 eslint-disable 變成「未使用的指示」而整支 lint 紅。
 *   函式宣告會提升，位置不影響行為。
 */
/**
 * 匯出用：這一支線的某個轉向通往**哪幾支**支線。
 *
 * ⚠️ 舊版這三欄讀的是 `leftTarget/throughTarget/rightTarget`，
 *   那一組已隨「駛出目的支線」面板整組移除（2026-09-13 使用者裁示）。
 *   現在一律由「起點 → 終點轉向判定」推導，而且**可能不只一支**——
 *   七岔路口的左轉本來就可能同時通往多支，硬寫成一支才是失真。
 */
function turnTargetLabel(
  setting: IntersectionArmSetting,
  all: IntersectionArmSetting[],
  turn: TurnKey,
) {
  const peers = all.filter(
    (other) =>
      other.projectId === setting.projectId && other.roadId === setting.roadId,
  );
  const targets = turnTargets(setting, peers, turn);
  return targets.length
    ? targets.map((code) => `路口${code}`).join("、")
    : "未指定";
}

/**
 * 支線在畫面上的稱呼。
 *
 * ⚠️ 使用者 2026-09-14（附圖）：
 *   「紅框處的預覽起點寫『路口A - 路口A』，和終點支線『路口B - 路口B』，
 *     為什麼**同樣名字會需要寫 2 次**呢? 是因為後面那個路口如果有去自定義名稱的話，
 *     就會同步顯示自定義名稱嗎? 例如 路口A-XXX（自定義名稱）?」
 *
 *   他猜對了：格式是「路口{代碼} － {名稱}」，而還沒取名字時系統給的預設名稱
 *   **就是**「路口A」，於是同一段字印兩次。
 *
 * ⚠️ 判斷「有沒有取過名字」一定要走 `isRealArmName()`，不可以直接比字串：
 *   自動命名可能是「路口 A」（中間有半形空格），直接比會被當成使用者取的名字。
 *   （「駛入路口X（名稱）」那一組標籤早就是這樣做的，這裡是漏掉的那幾處。）
 */
function armLabel(code: string, name?: string) {
  return isRealArmName(name, code) ? `路口${code}－${name}` : `路口${code}`;
}
