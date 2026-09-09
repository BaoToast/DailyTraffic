/*
 * 歷季趨勢的指標目錄、講稿與跨計畫比較。
 *
 * ── 這一支釘住的是什麼 ────────────────────────────────────────
 *
 * 趨勢圖是要給業主看的，所以守的不是「畫得出來」，而是三件會讓報告出錯
 * 的事：
 *
 *   一、沒有資料的季度必須是 null，**絕對不可以是 0**。
 *       0 會被畫成折線掉到零、被寫進講稿、被抄進報告；「－」不會。
 *   二、講稿講的每一個數字，必須就是圖上那一份 points 的值。
 *       圖與文字分岔的時候，被念出來的是文字。
 *   三、跨計畫比較**不可以比總量**。各計畫路段數本來就不同，
 *       比總量只會證明「路段多的計畫比較大」。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、只驗「講稿有字」不夠——印任何字都會過。要驗講稿裡出現的數字
 *     **逐字等於** formatTrendValue 對同一份資料算出來的字串。
 * 二、只驗「跨計畫有回傳」不夠——回傳總量也會過。要拿兩個路段數不同、
 *     但每路段平均相同的計畫，驗它們的值**相等**；若改回比總量，
 *     這一項會立刻紅（一個是另一個的三倍）。
 * 三、只驗「有 caveat」不夠——永遠印同一句也會過。要驗**沒有問題時
 *     不會亂講**，以及有問題時講的是**那一個**問題。
 * 四、間隔印標籤只驗「有回傳數字」不夠——永遠回 1 也會過。
 *     要同時驗「寬度夠時回 1」與「寬度不夠時大於 1」兩個方向。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TREND_METRICS,
  axisTitle,
  buildCrossProjectScript,
  buildCrossProjectTrend,
  buildTrendScript,
  completeQuarterRange,
  describeChange,
  formatTrendValue,
  labelStride,
  niceAxisMax,
  showXLabel,
  trendMetricById,
  trendMetricLabel,
} from "../app/trend-script.ts";

const label = (q) => q;
const META = {
  label: "全日實際交通量",
  unit: "輛/日",
  digits: 0,
  meaning: "整個調查涵蓋時間內實際數到的車輛數。",
};
const CTX = { scopeText: "全部路段", dayText: "平日＋假日", quarterLabel: label };

/* ── 一、指標目錄 ────────────────────────────────────────── */

test("每一個指標都要有意義說明，否則講稿第一段會開天窗", () => {
  for (const metric of TREND_METRICS) {
    assert.ok(metric.meaning && metric.meaning.length > 10, metric.id);
    assert.ok(metric.label, metric.id);
  }
  /* 認不得的 id 要退回第一個指標，不可以回 undefined 讓呼叫端爆掉。 */
  assert.equal(trendMetricById("不存在的指標").id, TREND_METRICS[0].id);
});

test("指標名稱要帶出選到的車種，圖標題、檔名與講稿才不會各寫各的", () => {
  assert.equal(
    trendMetricLabel(trendMetricById("vehicleShare"), "機車"),
    "機車佔比",
  );
  assert.equal(
    trendMetricLabel(trendMetricById("vehicleClass"), "大型車"),
    "大型車車輛數",
  );
  /* 不需要選車種的指標不可以被加上車種名稱。 */
  assert.equal(trendMetricLabel(trendMetricById("actual"), "機車"), "全日實際交通量");
});

test("縱軸一律寫成「名稱（單位）」，沒有單位就不掛空括號", () => {
  assert.equal(axisTitle("全日實際交通量", "輛/日"), "全日實際交通量（輛/日）");
  assert.equal(axisTitle("平均速限比", ""), "平均速限比");
  assert.equal(axisTitle("機車佔比", "%"), "機車佔比（%）");
});

/* ── 二、數字寫法 ────────────────────────────────────────── */

test("百分比不空格、其餘空一格；算不出來一律「－」", () => {
  assert.equal(formatTrendValue(42.85, { unit: "%", digits: 1 }), "42.9%");
  assert.equal(formatTrendValue(1234, { unit: "輛/日", digits: 0 }), "1,234 輛/日");
  assert.equal(formatTrendValue(null, { unit: "%", digits: 1 }), "－");
  /* 0 是真實的觀測值，不是「沒有資料」，要照樣印出來。 */
  assert.equal(formatTrendValue(0, { unit: "輛/日", digits: 0 }), "0 輛/日");
});

test("變化要先給變化量再給倍數，不使用「個百分點」的說法", () => {
  const text = describeChange(14.3, 42.9, { unit: "%", digits: 1 });
  assert.match(text, /上升 28\.6%/);
  assert.match(text, /大約是原來的 3\.0 倍/);
  assert.doesNotMatch(text, /百分點/);
  assert.equal(describeChange(10, 10, { unit: "%", digits: 1 }), "持平");
  assert.match(describeChange(100, 50, { unit: "輛/日", digits: 0 }), /下降 50 輛\/日/);
});

/* ── 三、講稿只讀 points ─────────────────────────────────── */

test("講稿裡的數字必須逐字等於 points 的值", () => {
  const points = [
    { quarter: "113Q1", weekday: 1000, holiday: 800 },
    { quarter: "113Q2", weekday: 1500, holiday: 900 },
  ];
  const body = buildTrendScript(points, META, CTX)
    .map((s) => s.lines.join(""))
    .join("");
  assert.ok(body.includes(formatTrendValue(1000, META)), "要出現平日起點");
  assert.ok(body.includes(formatTrendValue(1500, META)), "要出現平日終點");
  assert.ok(body.includes(formatTrendValue(800, META)), "要出現假日起點");
  assert.match(body, /整體上升/);
});

test("整季都沒有資料時，講稿要主動講出是哪一季", () => {
  const points = [
    { quarter: "113Q1", weekday: 1000, holiday: 800 },
    { quarter: "113Q2", weekday: null, holiday: null },
    { quarter: "113Q3", weekday: 1200, holiday: 900 },
  ];
  const caveats = buildTrendScript(points, META, CTX).find(
    (s) => s.title === "要先講清楚的",
  );
  const text = caveats.lines.join("");
  assert.match(text, /113Q2/);
  assert.match(text, /不要讓聽的人誤以為是下降|斷開/);
});

test("只做了平日的季度，要講出「那一條線會斷開」而不是講成假日歸零", () => {
  const points = [
    { quarter: "113Q1", weekday: 1000, holiday: 800 },
    { quarter: "113Q2", weekday: 1100, holiday: null },
    { quarter: "113Q3", weekday: 1200, holiday: 900 },
  ];
  const text = buildTrendScript(points, META, CTX)
    .find((s) => s.title === "要先講清楚的")
    .lines.join("");
  assert.match(text, /113Q2/);
  assert.match(text, /缺假日/);
  /* 不可以把它講成「假日交通量是 0」。 */
  assert.doesNotMatch(text, /假日.*0 輛/);
});

test("沒有問題時，注意事項不可以亂講一句", () => {
  const points = ["113Q1", "113Q2", "113Q3", "113Q4"].map((quarter, i) => ({
    quarter,
    weekday: 1000 + i * 10,
    holiday: 800 + i * 10,
  }));
  const text = buildTrendScript(points, META, CTX)
    .find((s) => s.title === "要先講清楚的")
    .lines.join("");
  assert.doesNotMatch(text, /沒有資料/);
  assert.doesNotMatch(text, /樣本太少/);
  assert.match(text, /每一季都有資料/);
});

test("尖峰小時指標一定要講出「各季尖峰不一定是同一個小時」", () => {
  const points = [
    { quarter: "113Q1", weekday: 500, holiday: 400 },
    { quarter: "113Q2", weekday: 560, holiday: 430 },
  ];
  const text = buildTrendScript(points, META, {
    ...CTX,
    peakHours: { "113Q1": "07:00–08:00", "113Q2": "17:30–18:30" },
  })
    .find((s) => s.title === "要先講清楚的")
    .lines.join("");
  assert.match(text, /不一定落在同一個小時/);
  assert.match(text, /07:00–08:00/);
  assert.match(text, /17:30–18:30/);
  /* 反面：全部同一個小時的時候，要說可以直接當同一個時段比較。 */
  const same = buildTrendScript(points, META, {
    ...CTX,
    peakHours: { "113Q1": "07:00–08:00", "113Q2": "07:00–08:00" },
  })
    .find((s) => s.title === "要先講清楚的")
    .lines.join("");
  assert.match(same, /都落在 07:00–08:00/);
  assert.doesNotMatch(same, /不一定落在同一個小時/);
});

test("只有一季有資料時，不可以講成「上升」或「下降」", () => {
  const text = buildTrendScript(
    [{ quarter: "113Q1", weekday: 1000, holiday: null }],
    META,
    CTX,
  )
    .map((s) => s.lines.join(""))
    .join("");
  assert.match(text, /一個點畫不出趨勢/);
});

/* ── 四、跨計畫一律比平均，不比總量 ─────────────────────── */

test("路段數不同但每路段平均相同的兩個計畫，跨計畫圖上要等高", () => {
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "p1",
        projectName: "一條路段的計畫",
        points: [{ quarter: "113Q1", total: 1000, count: 1, size: 1 }],
      },
      {
        projectId: "p3",
        projectName: "三條路段的計畫",
        points: [{ quarter: "113Q1", total: 3000, count: 3, size: 3 }],
      },
    ],
    META,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const a = trend.series[0].points[0];
  const b = trend.series[1].points[0];
  assert.equal(a.value, b.value, "比的是每路段平均；若改回比總量，這裡會變成 1:3");
  assert.equal(a.count, 1);
  assert.equal(b.count, 3, "N 要如實反映這一季有幾條路段");
});

test("跨計畫的佔比要用加權平均，不是把各路段的百分比再平均一次", () => {
  const shareMeta = { label: "機車佔比", unit: "%", digits: 1, meaning: "測試" };
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "p",
        projectName: "計畫",
        /* 分子 900、分母 1010（＝一條 900/1000 加一條 0/10）。 */
        points: [
          { quarter: "113Q1", total: 900, denominator: 1010, count: 2, size: 2 },
        ],
      },
    ],
    shareMeta,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const value = trend.series[0].points[0].value;
  assert.ok(Math.abs(value - (900 / 1010) * 100) < 1e-9, `實際 ${value}`);
  assert.ok(value > 80, "算術平均會得到 45%，那讓 10 輛與 1000 輛的路段同等份量");
  assert.match(trend.basis, /加權平均/);
});

test("佔比沒有分母時要回 null 而不是 0%", () => {
  const shareMeta = { label: "機車佔比", unit: "%", digits: 1, meaning: "測試" };
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "p",
        projectName: "計畫",
        points: [{ quarter: "113Q1", total: 0, denominator: 0, count: 1, size: 1 }],
      },
    ],
    shareMeta,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  assert.equal(
    trend.series[0].points[0].value,
    null,
    "0% 會被讀成「一台都沒有」，事實是「沒有分母」",
  );
});

test("某一季沒有資料時，跨計畫的那個點要是 null 而不是 0", () => {
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "p",
        projectName: "計畫",
        points: [
          { quarter: "113Q1", total: 1000, count: 2, size: 2 },
          { quarter: "113Q2", total: null, count: 0, size: 2 },
        ],
      },
    ],
    META,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  assert.equal(trend.series[0].points[0].value, 500);
  assert.equal(trend.series[0].points[1].value, null);
});

test("跨計畫講稿一定要講出各計畫路段數不同這件事", () => {
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "p1",
        projectName: "計畫一",
        points: [
          { quarter: "113Q1", total: 1000, count: 1, size: 1 },
          { quarter: "113Q2", total: 1100, count: 1, size: 1 },
        ],
      },
      {
        projectId: "p2",
        projectName: "計畫二",
        points: [
          { quarter: "113Q1", total: 6000, count: 6, size: 6 },
          { quarter: "113Q2", total: 6600, count: 6, size: 6 },
        ],
      },
    ],
    META,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  const text = buildCrossProjectScript(trend, label)
    .map((s) => s.lines.join(""))
    .join("");
  assert.match(text, /不是\*\*總量\*\*|不是總量/);
  assert.match(text, /N=/);
  assert.match(text, /路段數差距很大|不具代表性/);
});

/* ── 五、X 軸標籤間隔 ────────────────────────────────────── */

test("寬度夠時全部印、寬度不夠時要間隔印", () => {
  const measure = (text) => String(text).length * 8;
  const labels = ["113Q1", "113Q2", "113Q3", "113Q4"];
  /* 寬度很夠：每一個都印。 */
  assert.equal(labelStride(labels, 2000, measure), 1);
  /* 寬度只放得下一個：間隔要大於 1。 */
  assert.ok(labelStride(labels, 70, measure) > 1);
  /* 空清單不可以讓呼叫端除以 0。 */
  assert.equal(labelStride([], 100, measure), 1);
});

test("間隔印時最後一格一定要印，而且倒數幾格要讓位（不可以疊在一起）", () => {
  /* 24 格、間隔 2：最後一格印，倒數第二格（index 22）要讓位。 */
  assert.equal(showXLabel(23, 24, 2), true, "最後一格一定印");
  assert.equal(showXLabel(22, 24, 2), false, "離最後一格太近，要讓位");
  assert.equal(showXLabel(20, 24, 2), true);
  assert.equal(showXLabel(21, 24, 2), false, "不在間隔上");
  /* 間隔 1 時每一格都印，最後一格附近也不例外。 */
  assert.equal(showXLabel(22, 24, 1), true);
});

/* ── 六、「平日＋假日」是同時顯示，不是加總 ───────────────── */

test("平日與假日永遠是兩條各自的線，任何一季都不可以把兩者加起來", () => {
  /*
   * 這是使用者踩過的坑，原話：「平日+假日 這類條件，指的是同時顯示，
   * 因為這類計算，加總起來沒有應用的意義……把平日和假日的車輛數加總起來，
   * 是沒有意義的圖表」。
   *
   * TrendPoint 的形狀本身就把這件事釘死了：weekday 與 holiday 是兩個
   * 獨立欄位，沒有第三個「合計」欄位可以放。這一項驗的是講稿也照這個
   * 前提在講——不可以出現「平日＋假日合計」那種數字。
   */
  const points = [
    { quarter: "113Q1", weekday: 1000, holiday: 800 },
    { quarter: "113Q2", weekday: 1200, holiday: 900 },
  ];
  const body = buildTrendScript(points, META, CTX)
    .map((s) => s.lines.join(""))
    .join("");
  /* 兩條線各自的數字都要出現。 */
  assert.ok(body.includes(formatTrendValue(1000, META)));
  assert.ok(body.includes(formatTrendValue(800, META)));
  /* 合計（1800／2100）絕對不可以出現。 */
  assert.ok(
    !body.includes(formatTrendValue(1800, META)),
    "講稿不可以出現平日與假日的合計",
  );
  assert.ok(!body.includes(formatTrendValue(2100, META)));
  /* 而且要明講兩條線本來就不該相等。 */
  assert.match(body, /兩條線/);
});

test("跨計畫的平日與假日要拆成兩個數列，不可以合在一起算平均", () => {
  /*
   * 呼叫端會把「平日＋假日」拆成兩筆 input（計畫名（平日）／（假日）），
   * 這一項驗拆開之後兩者互不影響——把它們合成一筆的話，
   * 兩個平均會變成一個介於中間、不對應任何一天的數字。
   */
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "p|平日",
        projectName: "計畫（平日）",
        points: [{ quarter: "113Q1", total: 2000, count: 2, size: 2 }],
      },
      {
        projectId: "p|假日",
        projectName: "計畫（假日）",
        points: [{ quarter: "113Q1", total: 1000, count: 2, size: 2 }],
      },
    ],
    META,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  assert.equal(trend.series.length, 2, "兩種日別要是兩條線");
  assert.equal(trend.series[0].points[0].value, 1000);
  assert.equal(trend.series[1].points[0].value, 500);
  /* 合在一起的話會變成 (2000+1000)/4 = 750，那個數字不對應任何一天。 */
  assert.ok(
    !trend.series.some((item) => item.points[0].value === 750),
    "不可以把平日與假日合起來平均",
  );
});

/* ── 缺季補齊 ────────────────────────────────────────────── */

test("頭尾之間整季沒有資料時要補成空格，X 軸間距才對應真實時間", () => {
  /*
   * ⚠️ 這一項守的是「兩個點緊鄰＝相隔一季」的讀法。
   * 只做了 113Q1 與 114Q1 的話，不補的話 X 軸只有兩格，看圖的人會以為
   * 中間只隔一季，實際上隔了整整一年。
   */
  assert.deepEqual(completeQuarterRange(["113Q1", "114Q1"]), [
    "113Q1",
    "113Q2",
    "113Q3",
    "113Q4",
    "114Q1",
  ]);
  /* 沒有缺季時不可以動它。 */
  assert.deepEqual(completeQuarterRange(["113Q1", "113Q2"]), [
    "113Q1",
    "113Q2",
  ]);
  /* 一季、零季不補。 */
  assert.deepEqual(completeQuarterRange(["113Q1"]), ["113Q1"]);
  assert.deepEqual(completeQuarterRange([]), []);
});

test("看不懂的期別、民國與西元混用時寧可不補，不可以亂猜寫法", () => {
  /*
   * ⚠️ 假通過陷阱：只驗「有缺季時會補」的話，把不認得的期別也硬套進
   * `<年>Q<季>` 的迴圈一樣會過——那會把使用者自訂的期別名稱整批換掉。
   */
  assert.deepEqual(completeQuarterRange(["113Q1", "第二次調查"]), [
    "113Q1",
    "第二次調查",
  ]);
  /* 三碼民國與四碼西元混用時，補出來的格子必須挑一種寫法，挑錯會讓
     X 軸同時出現兩種格式——所以整批原樣回傳。 */
  assert.deepEqual(completeQuarterRange(["113Q1", "2025Q1"]), [
    "113Q1",
    "2025Q1",
  ]);
  /* 四碼西元自己成一組時要照四碼補回去。 */
  assert.deepEqual(completeQuarterRange(["2024Q3", "2025Q1"]), [
    "2024Q3",
    "2024Q4",
    "2025Q1",
  ]);
  /* 民國 99 年跨到 100 年時，位數會從二碼變三碼；仍是同一種曆法，
     不可以因此放棄補季。 */
  assert.deepEqual(completeQuarterRange(["99Q4", "100Q2"]), [
    "99Q4",
    "100Q1",
    "100Q2",
  ]);
});

test("補出來的空季在跨計畫圖上是斷線，不是 0，也不會被算進樣本數警告", () => {
  const trend = buildCrossProjectTrend(
    [
      {
        projectId: "a",
        projectName: "甲計畫",
        points: [
          { quarter: "113Q1", total: 2000, count: 2, size: 2 },
          { quarter: "114Q1", total: 2400, count: 2, size: 2 },
        ],
      },
    ],
    META,
    (a, b) => (a < b ? -1 : a > b ? 1 : 0),
  );
  assert.deepEqual(trend.quarters, [
    "113Q1",
    "113Q2",
    "113Q3",
    "113Q4",
    "114Q1",
  ]);
  const points = trend.series[0].points;
  assert.equal(points.length, 5);
  /* 中間三季必須是 null——給 0 的話折線會掉到零，看起來像交通量歸零。 */
  assert.equal(points[1].value, null);
  assert.equal(points[2].value, null);
  assert.equal(points[3].value, null);
  assert.notEqual(points[1].value, 0);
  /* 補出來的空季 N=0，不可以讓「最少 0 條」跑進小樣本警告。 */
  const body = buildCrossProjectScript(trend, (q) => q)
    .flatMap((section) => section.lines)
    .join("\n");
  assert.ok(!/最少 0 /.test(body), "空季不可以被當成樣本數最少的那一季");
});

/* ── 縱軸刻度 ────────────────────────────────────────────── */

test("縱軸每一格的間距要是好讀的整數，軸頂一定不低於資料最大值", () => {
  /*
   * ⚠️ 這一項守的是「看圖的人能不能直接讀出一個點大概多少」。
   * 舊版把資料最大值直接當軸頂再四等分，刻度會變成
   * 42,090／31,568／21,045／10,523／0——每一格都要在心裡換算。
   */
  const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const isNice = (gap) => {
    if (!(gap > 0)) return false;
    const power = Math.pow(10, Math.floor(Math.log10(gap)));
    const scaled = Number((gap / power).toFixed(6));
    return NICE.includes(scaled);
  };
  for (const hi of [
    1, 7, 42, 97, 420, 4210, 42090, 5371.3, 99999, 123456, 0.42, 0.07,
  ]) {
    const { max } = niceAxisMax(hi, 4);
    assert.ok(max >= hi, `軸頂 ${max} 不可以低於資料最大值 ${hi}`);
    assert.ok(isNice(max / 4), `${hi} → 每格 ${max / 4} 不是好讀的間距`);
    /* 不可以浪費太多空白：軸頂最多比資料高一階（這裡放寬到兩倍）。 */
    assert.ok(max <= hi * 2, `${hi} → 軸頂 ${max} 留白太多`);
  }
});

test("軸頂要嚴格高於資料最大值，最高的點才不會貼著頂線被切掉", () => {
  /*
   * 舊版 max 就等於資料最大值，最高那個點的圓心正好落在最上面那條格線
   * 上，半徑 4px 的圓有一半在繪圖區外。
   */
  for (const hi of [42090, 5371.3, 97, 4210]) {
    const { max } = niceAxisMax(hi, 4);
    assert.ok(max > hi, `${hi} → 軸頂 ${max} 沒有留白`);
  }
});

test("看不懂或非正的最大值不可以讓軸整個壞掉", () => {
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const { max } = niceAxisMax(bad, 4);
    assert.ok(Number.isFinite(max) && max > 0, `${bad} → ${max}`);
  }
});
