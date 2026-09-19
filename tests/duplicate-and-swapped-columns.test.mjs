/*
 * ══════════════════════════════════════════════════════════════════
 *  X-66：重複的車種欄、與轉向子標題對不上的欄序，都要出聲
 * ══════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-17：
 *   「另外兩支程式有這類問題嗎?三支程式是否都是讀取標籤，然後欄位如果有換位，
 *     都能讀到，如果有重複，也能指出異常讓使用者去確認的功能嗎?」
 *
 * 這一支查出來兩個完全安靜的洞：
 *
 * 一、**同一個方向裡同一個車種出現不只一次**，來源有兩種、症狀都很糟：
 *   ・調查員誤植（兩欄都寫「機車」）→ 車輛數累加、但轉向明細是**指派**，
 *     後一組蓋掉前一組，同一筆紀錄的總量與轉向明細互相矛盾。
 *   ・**只有其中一個方向的車種順序被調換** → 「車種標題重複的週期」找不到，
 *     兩個方向的欄位被當成同一個方向**相加**，少掉的那一筆整個消失，
 *     匯入照樣報成功（arm-split.test.mjs 記錄過同一類事故，
 *     但那一支只驗「切得對」，沒有驗「切不出來時會不會講」）。
 *
 * 二、**左／直／右完全靠欄位順序**，子標題的「左轉」「右轉」只被用來判斷
 *   「這是不是路口表」，從來沒有被用來決定哪一欄是左轉。
 *   子標題寫 `右轉|直進|左轉` 時，右轉的數字被記成左轉，零提示。
 *
 * ⚠️ 兩者都**不自動改讀法**——依欄名重排等於系統替調查資料做決定，
 *   而且會把合併儲存格那些版型改壞。只出聲，請使用者核對。
 *
 * ── ⚠️ 刻意迴避的假通過 ────────────────────────────────────────
 * 一、**每一條都配一份「正常檔案不可以叫」的對照**。只驗「壞檔案會叫」的話，
 *     一個「一律叫」的實作也會全綠，而那會讓使用者學會忽略所有警告。
 * 二、轉向那一條的正常對照**故意用合併儲存格版型**（車種名只寫在三欄的第一欄），
 *     因為真正的檔案就是那樣；守門若只看得懂「三欄都有車種名」那種版型，
 *     正常檔案會整批誤報。
 * 三、方向切割失敗那一條要驗**真的合併成一筆**（rows.length === 1），
 *     不然「有警告」可能只是碰巧，事故本身沒被釘住。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseTrafficSheetValues } from "../app/traffic-parser.ts";

const IDENTITY = { roadId: "R1", roadName: "測試路口", a: "北向", b: "南向" };
const STANDARD = ["機車", "小型車", "大型車", "特種車"];

/**
 * 組一張路口格式的工作表（合併儲存格版型：車種名只寫在三欄的第一欄）。
 * `arms[i] = { code?, vehicles, turns?, counts }`；turns 預設 ["左轉","直進","右轉"]。
 * `code` 給了才寫「路口編號：」——不給就走「靠週期猜方向」那條路。
 */
function buildSheet(arms) {
  const markerRow = [];
  const vehicleRow = [];
  const turnRow = [];
  const dataRow = [];
  for (const arm of arms) {
    const start = markerRow.length;
    if (arm.code) markerRow[start] = `路口編號：路口${arm.code}`;
    vehicleRow[start] = "時間";
    turnRow[start] = "";
    dataRow[start] = "00:00～01:00";
    arm.vehicles.forEach((label, vehicleIndex) => {
      const base = start + 1 + vehicleIndex * 3;
      vehicleRow[base] = label;
      vehicleRow[base + 1] = "";
      vehicleRow[base + 2] = "";
      (arm.turns ?? ["左轉", "直進", "右轉"]).forEach((turn, turnIndex) => {
        turnRow[base + turnIndex] = turn;
        dataRow[base + turnIndex] = arm.counts[vehicleIndex][turnIndex];
      });
    });
    const end = start + 1 + arm.vehicles.length * 3;
    markerRow[end] = "";
    markerRow[end + 1] = "";
  }
  const width = markerRow.length;
  const fill = (row) =>
    Array.from({ length: width }, (_unused, index) => row[index] ?? "");
  return [
    fill([]),
    fill([]),
    fill([]),
    fill(markerRow),
    fill(vehicleRow),
    fill(turnRow),
    fill(dataRow),
  ];
}

const counts = (base) =>
  STANDARD.map((_unused, index) => [base + index, base + index * 2, 0]);
const warningsOf = (rows) => rows.flatMap((row) => row.sourceWarnings ?? []);

/* ══ 前置：正常檔案一句都不可以叫 ══════════════════════════════ */
test("⚠️ 正常的合併儲存格版型，兩種警告一句都不可以出現", () => {
  const rows = parseTrafficSheetValues(
    buildSheet([
      { code: "A", vehicles: STANDARD, counts: counts(10) },
      { code: "B", vehicles: STANDARD, counts: counts(20) },
    ]),
    "平日",
    "115Q2",
    IDENTITY,
    {},
  );
  /* 前置：真的讀出兩筆，否則下面全部恆真。 */
  assert.equal(rows.length, 2, "測試用的正常檔案根本沒切出兩個方向");
  const warnings = warningsOf(rows);
  assert.equal(
    warnings.find((w) => /出現不只一次/.test(w)),
    undefined,
    `正常檔案誤報車種重複：${warnings.join(" ｜ ")}`,
  );
  assert.equal(
    warnings.find((w) => /子標題與欄位順序對不起來/.test(w)),
    undefined,
    `正常檔案誤報轉向欄序：${warnings.join(" ｜ ")}`,
  );
});

/* ══ 一、同一個方向裡車種標題重複（誤植）══════════════════════ */
test("⚠️ 同一個方向裡「機車」出現兩次要說出來", () => {
  const rows = parseTrafficSheetValues(
    buildSheet([
      {
        code: "A",
        /* 第二個車種被誤植成「機車」，而且不相鄰（中間隔著大型車就更明顯） */
        vehicles: ["機車", "大型車", "機車", "特種車"],
        counts: counts(10),
      },
      { code: "B", vehicles: STANDARD, counts: counts(20) },
    ]),
    "平日",
    "115Q2",
    IDENTITY,
    {},
  );
  const warning = warningsOf(rows).find((w) => /出現不只一次/.test(w));
  assert.ok(warning, `沒有警告：${warningsOf(rows).join(" ｜ ")}`);
  assert.match(warning, /機車/, "要說出是哪一個車種");
  assert.match(warning, /不會自行挑選/, "要說明系統不替調查資料做決定");
});

/* ══ 二、方向切割失敗（只有一個方向被調換車種順序）══════════════ */
test("⚠️ 只有一個方向的車種順序被調換，導致兩個方向被合併成一筆時要說出來", () => {
  const values = buildSheet([
    /* 沒有「路口編號：」→ 走靠週期猜方向那條路（路段格式的調查表就是這樣） */
    { vehicles: STANDARD, counts: counts(10) },
    { vehicles: ["小型車", "機車", "大型車", "特種車"], counts: counts(20) },
  ]);
  const rows = parseTrafficSheetValues(values, "平日", "115Q2", IDENTITY, {});
  /*
   * 先把事故本身釘住：週期找不到 → 八個車種欄被當成同一個方向 → 只剩一筆。
   * 這一條要是沒中，下面「有警告」就可能只是碰巧。
   */
  assert.equal(
    rows.length,
    1,
    "這個情境本來就該合併成一筆（合併行為本身沒改），不是 1 筆的話這條測錯了",
  );
  const warning = warningsOf(rows).find((w) => /出現不只一次/.test(w));
  assert.ok(warning, `合併成一筆卻一句話都沒說：${warningsOf(rows).join(" ｜ ")}`);
  assert.match(
    warning,
    /方向欄位的順序被調換|切不出方向/,
    "要講到「可能是方向切不出來」這個可能性，只說『表頭打錯字』會把人帶錯方向",
  );
  assert.match(warning, /相加/, "要說明後果");
});

/* ══ 三、轉向子標題與欄位順序對不上 ════════════════════════════ */
test("⚠️ 子標題寫「右轉｜直進｜左轉」時要說出來（數字會被記到錯的轉向）", () => {
  const rows = parseTrafficSheetValues(
    buildSheet([
      {
        code: "A",
        vehicles: STANDARD,
        turns: ["右轉", "直進", "左轉"],
        counts: counts(10),
      },
      { code: "B", vehicles: STANDARD, counts: counts(20) },
    ]),
    "平日",
    "115Q2",
    IDENTITY,
    {},
  );
  const warning = warningsOf(rows).find((w) =>
    /子標題與欄位順序對不起來/.test(w),
  );
  assert.ok(warning, `沒有警告：${warningsOf(rows).join(" ｜ ")}`);
  assert.match(warning, /右轉/, "要說出讀到的是什麼字");
  assert.match(warning, /不會自行依標題重排/, "要說明系統不替調查資料做決定");
});

test("⚠️ 沒寫轉向子標題的版型不可以被誤報（很多舊檔就是沒寫）", () => {
  const rows = parseTrafficSheetValues(
    buildSheet([
      { code: "A", vehicles: STANDARD, turns: ["", "", ""], counts: counts(10) },
      { code: "B", vehicles: STANDARD, turns: ["", "", ""], counts: counts(20) },
    ]),
    "平日",
    "115Q2",
    IDENTITY,
    {},
  );
  assert.equal(
    warningsOf(rows).find((w) => /子標題與欄位順序對不起來/.test(w)),
    undefined,
    "沒寫子標題不是矛盾，不可以報",
  );
});

/*
 * ── 反證（2026-09-17 實跑）────────────────────────────────────
 * 把 traffic-parser.ts 裡 headerWarnings 的兩段整組拿掉：
 *   ✔ 正常的合併儲存格版型，兩種警告一句都不可以出現
 *   ✖ 同一個方向裡「機車」出現兩次要說出來
 *   ✖ 只有一個方向的車種順序被調換，導致兩個方向被合併成一筆時要說出來
 *   ✖ 子標題寫「右轉｜直進｜左轉」時要說出來
 *   ✔ 沒寫轉向子標題的版型不可以被誤報
 * 三條該紅的紅、兩條對照組照舊綠，確定不是恆真。
 */
