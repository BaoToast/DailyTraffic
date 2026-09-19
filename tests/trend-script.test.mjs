/*
 * 歷季趨勢的指標目錄與圖表講稿。
 *
 * ⚠️ v20.64 移除了跨計畫比較（使用者 2026-09-09 授權），相關斷言一併移除；
 *    「不可以比總量」那條規則隨功能一起消失，不是被放寬。
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
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、只驗「講稿有字」不夠——印任何字都會過。要驗講稿裡出現的數字
 *     **逐字等於** formatTrendValue 對同一份資料算出來的字串。
 * 二、只驗「有 caveat」不夠——永遠印同一句也會過。要驗**沒有問題時
 *     不會亂講**，以及有問題時講的是**那一個**問題。
 * 三、間隔印標籤只驗「有回傳數字」不夠——永遠回 1 也會過。
 *     要同時驗「寬度夠時回 1」與「寬度不夠時大於 1」兩個方向。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TREND_METRICS,
  axisTitle,
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

/*
 * ⚠️ 這一則 2026-09-11 改過，而且**舊版本身就是要擋的東西**。
 *
 * 舊斷言是 `/大約是原來的 3\.0 倍/`——「原來的」是什麼？
 * 使用者的原話：「『A 是 B 的幾 %』主詞要明確，不然會看不懂，
 * 是跟誰比才有這倍率。」所以 describeChange() 的 labels 改成**必填**，
 * 句子一定帶主詞。這一則跟著改成驗「主詞真的印出來了」。
 *
 * ⚠️ 不可以只驗「有 3.0 倍」——那樣把主詞拿掉照樣綠。
 */
const LABELS = { from: "115Q1", to: "115Q2" };

test("變化要先給變化量再給倍數，而且倍數句一定帶主詞", () => {
  const text = describeChange(14.3, 42.9, { unit: "%", digits: 1 }, LABELS);
  assert.match(text, /上升 28\.6%/);
  assert.match(text, /115Q2大約是115Q1的 3\.0 倍/);
  /* 反面：不可以再出現沒有主詞的舊寫法 */
  assert.doesNotMatch(text, /原來的/);
  assert.doesNotMatch(text, /百分點/);
  assert.equal(
    describeChange(10, 10, { unit: "%", digits: 1 }, LABELS),
    "持平",
  );
  assert.match(
    describeChange(100, 50, { unit: "輛/日", digits: 0 }, LABELS),
    /下降 50 輛\/日/,
  );
  /* 變小的時候用百分比，主詞同樣要在 */
  assert.match(
    describeChange(100, 50, { unit: "輛/日", digits: 0 }, LABELS),
    /115Q2大約是115Q1的 50%/,
  );
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


/* ── 四、X 軸標籤間隔 ────────────────────────────────────── */

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

/* ── 五、「平日＋假日」是同時顯示，不是加總 ───────────────── */

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
