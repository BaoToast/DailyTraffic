/*
 * 圖旁邊的解讀說明。
 *
 * ── 這一支釘住的是什麼 ────────────────────────────────────────
 *
 * 這些文字會被照著念、被貼進報告，所以守的不是「有沒有字」，而是：
 *
 *   一、講的數字必須是圖上那一份資料算出來的，不是另外算的。
 *   二、沒有資料時要說沒有資料，不可以硬湊出一段像有講的話。
 *   三、會誤導的地方要主動講出來（只做了一種日別、調查不足 24 小時、
 *       排名高不等於有問題）。
 *
 * ── ⚠️ 假通過陷阱（這一支刻意迴避的）────────────────────────
 *
 * 一、只驗「回傳的 lines 不是空的」不夠——印任何字都會過。
 *     要驗**特定的數字逐字出現**。
 * 二、只驗「有警告」不夠——永遠印同一句警告也會過。
 *     要同時驗「沒有問題時不會亂警告」。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  compositionNote,
  dayCompareNote,
  hourlyNote,
} from "../app/chart-notes.ts";

test("車種組成：講的佔比要與資料算出來的一致", () => {
  /*
   * ── 大車的定義（使用者 2026-09-15 定案）───────────────────
   *   原生車種只有四類：機車、小型車、大型車、特種車。
   *   自訂車種要嘛併入這四類其中之一、要嘛自成一類。
   *   **大車 ＝ 非機車類型、非小型車類型的全部。**
   *
   *   所以判斷要看**歸類後的 key**，不是名稱：
   *   ・沒有歸類的自訂車種（key 是 custom:*）→ 自成一類 → 算大車
   *   ・歸類到機車的自訂車種（key 變成 motorcycle）→ 不算大車
   */
  const note = compositionNote(
    [
      { key: "motorcycle", label: "機車", count: 900 },
      { key: "small", label: "小型車", count: 700 },
      { key: "custom:大貨車", label: "大貨車", count: 60 },
      { key: "custom:聯結車", label: "聯結車", count: 40 },
    ],
    1700,
    "全部調查點",
  );
  const body = note.lines.join("\n");
  assert.match(body, /1,700 輛/);
  /* 900 / 1700 = 52.9% */
  assert.match(body, /機車，900 輛（52\.9%）/);
  /* 手算：大車 ＝ 大貨車 60 ＋ 聯結車 40 ＝ 100，佔 100/1700 ＝ 5.9% */
  assert.match(body, /大車（非機車、非小型車）合計 100 輛（5\.9%）：大貨車、聯結車。/);
  /*
   * ⚠️ 句子裡點名的車種，必須就是加總進去的那幾種。
   *   這一批資料裡沒有「大型車」也沒有「特種車」，那兩個詞**不可以**出現——
   *   舊版寫死「大型車與特種車合計」，於是點名兩種、卻加總了五種
   *  （2026-09-14 實測寫成「大型車與特種車合計 18,375 輛」，那兩項其實只有 10,239 輛）。
   */
  assert.ok(!/大型車/.test(body), "資料裡沒有大型車，句子就不可以講大型車");
  assert.ok(!/特種車/.test(body), "資料裡沒有特種車，句子就不可以講特種車");
});

test("車種組成：歸類到機車的自訂車種**不算**大車（要看 key，不是看名稱）", () => {
  /*
   * 手算：使用者把「電動大貨車」歸類到機車（key 變成 motorcycle）。
   *   機車類型 ＝ 800 ＋ 200 ＝ 1,000；小型車 600；大型車 400。
   *   總量 2,000 → 大車只有大型車 400，佔 20.0%。
   *
   * ⚠️ 用名稱比對的舊寫法會把「電動大貨車」算進大車（名稱含「大貨」），
   *   得到 600／30.0% ——這正是這一條要擋的。
   */
  const body = compositionNote(
    [
      { key: "motorcycle", label: "機車", count: 800 },
      { key: "motorcycle", label: "電動大貨車", count: 200 },
      { key: "small", label: "小型車", count: 600 },
      { key: "large", label: "大型車", count: 400 },
    ],
    2000,
    "全部調查點",
  ).lines.join("\n");
  assert.match(body, /大車（非機車、非小型車）合計 400 輛（20\.0%）：大型車。/);
});

test("車種組成：沒有歸類的自訂車種自成一類，要算進大車", () => {
  /*
   * 手算：機車 500、小型車 300、大客車 150、電動車 50，總量 1,000。
   *   大車 ＝ 150 ＋ 50 ＝ 200，佔 20.0%。
   *   「電動車」名稱裡沒有任何「大」字，用名稱比對會漏掉它。
   */
  const body = compositionNote(
    [
      { key: "motorcycle", label: "機車", count: 500 },
      { key: "small", label: "小型車", count: 300 },
      { key: "custom:大客車", label: "大客車", count: 150 },
      { key: "custom:電動車", label: "電動車", count: 50 },
    ],
    1000,
    "全部調查點",
  ).lines.join("\n");
  assert.match(body, /大車（非機車、非小型車）合計 200 輛（20\.0%）：大客車、電動車。/);
});

test("車種組成：沒有資料時要說沒有資料，不可以硬湊", () => {
  const note = compositionNote([], 0, "全部調查點");
  assert.equal(note.lines.length, 1);
  assert.match(note.lines[0], /沒有可統計/);
});

test("24 小時型態：尖峰、離峰與集中程度都要講對", () => {
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    value: hour === 8 ? 1000 : hour === 3 ? 100 : 400,
  }));
  const body = hourlyNote(points, "輛", "中山路").lines.join("\n");
  assert.match(body, /最忙的是 08:00，1,000 輛/);
  assert.match(body, /最閒的是 03:00，100 輛/);
  assert.match(body, /10\.0 倍/);
  /* 全日 = 1000 + 100 + 22×400 = 9,900；尖峰佔 10.1% */
  assert.match(body, /佔全日的 10\.1%/);
  /* 24 小時齊全時，不可以出現「調查不足 24 小時」那句警告。 */
  assert.ok(!/不是完整的 24 小時/.test(body));
  /* 單一調查點時**不可以**掛那句「這是 N 點合起來算的」（沒篩卻講話＝噪音）。 */
  assert.ok(
    !/合起來/.test(body),
    `單一調查點卻講了跨點合計：${body}`,
  );
});

test("⚠️ 稽核表 E：多個調查點時，尖峰佔比要明講是合起來算的", () => {
  /*
   * 這個佔比的分子與分母都是把 N 個調查點加起來的。
   * 比值本身成立（同一個母體的一部分除以全體），所以不拆；
   * 但不寫清楚的話，讀的人會把它當成「某一條路的尖峰佔比」寫進報告——
   * 而 N 個點加起來的尖峰時刻不一定是任何一條路自己的尖峰時刻。
   *
   * ⚠️ 要配一條「單一調查點不可以叫」的對照（上面那一條），
   *   否則一個「永遠印這句話」的實作也會全綠。
   */
  const points = Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}:00`,
    value: hour === 8 ? 1000 : hour === 3 ? 100 : 400,
  }));
  const body = hourlyNote(points, "輛", "全部調查點", 3).lines.join("\n");
  assert.match(body, /佔全日的 10\.1%/, "數字本身不可以變");
  assert.match(body, /3 個調查點/, "要說出是幾個點");
  assert.match(body, /合起來/, "要說明是合計出來的");
  assert.match(body, /尖峰時刻不一定相同/, "要說明為什麼不能當單一路段的佔比");
});

test("24 小時型態：時段不足 24 小時要主動講出來", () => {
  const points = Array.from({ length: 12 }, (_, hour) => ({
    hour: `${String(hour + 6).padStart(2, "0")}:00`,
    value: 300 + hour,
  }));
  const body = hourlyNote(points, "輛", "中山路").lines.join("\n");
  assert.match(body, /只涵蓋 12 個小時/);
});

test("同季平假日：要明講兩根柱子不會相加", () => {
  const rows = [
    { name: "A 路段", weekday: 1000, holiday: 800 },
    { name: "B 路段", weekday: 500, holiday: 700 },
    { name: "C 路段", weekday: 400, holiday: null },
  ];
  const body = dayCompareNote(rows, "輛").lines.join("\n");
  assert.match(body, /不會相加/);
  /*
   * ⚠️ 稽核表 F：**跨調查點不可以報合計**（使用者 2026-09-16 裁示）。
   *   舊版在這裡印「2 個…調查點合計：平日 1,500 輛、假日 1,500 輛」——
   *   那個 1,500 是 A 路段與 B 路段加起來的，而這份講稿是要抄進報告的。
   */
  assert.ok(
    !/平日 1,500 輛/.test(body),
    `仍然在報跨調查點的合計：${body}`,
  );
  assert.match(body, /不可以相加/, "要說明為什麼不列合計");
  assert.match(body, /逐點看/, "要告訴使用者去哪裡看數字");
  /* B 路段假日比平日高，要被點名 */
  assert.match(body, /假日反而比平日高/);
  assert.match(body, /B 路段/);
  /* C 路段只有平日，要被算進「只做了一種日別」 */
  assert.match(body, /另有 1 個調查點只做了其中一種日別/);
});

test("同季平假日：沒有一個點同時有兩種日別時要說清楚", () => {
  const body = dayCompareNote(
    [{ name: "A", weekday: 100, holiday: null }],
    "輛",
  ).lines.join("\n");
  assert.match(body, /沒有任何一個調查點同時有平日與假日/);
  /* 不可以在沒有可比對象時還講「合計」。 */
  assert.ok(!/合計/.test(body));
});


test("⚠️ 稽核表 F：只有一個調查點時照樣寫得出它自己的兩個數字", () => {
  /*
   * 對照組。只驗「多點不可以報合計」的話，一個「永遠不講數字」的實作
   * 也會全綠——而那會把單點情況下本來就正確、也很有用的那句話一起拿掉。
   * 一個調查點的平日與假日不是「跨調查點相加」，它就是它自己的兩個數字。
   */
  const body = dayCompareNote(
    [{ name: "A 路段", weekday: 1000, holiday: 800 }],
    "輛",
  ).lines.join("\n");
  assert.match(body, /A 路段/);
  assert.match(body, /平日 1,000 輛、假日 800 輛/);
  assert.ok(!/不可以相加/.test(body), "單點不需要講這句（那是噪音）");
});
