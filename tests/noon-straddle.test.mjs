/*
 * ══════════════════════════════════════════════════════════════════════
 *  橫跨中午的尖峰小時：系統不自己決定，問使用者
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12 的定案（他一開始要「上午／下午可自行設定」，
 * 討論之後自己收回，理由寫在下面）：
 *   「我覺得回到固定 00:00~12:00，理由是留著 就算能調整，也沒有後續可以套用
 *     重新計算的功能，調整了＝沒調整，意義不大。」
 *   「不確定時，就是跳出視窗詢問使用者。」
 *   「如果有15分鐘滾動去計算1小時的當量時，其實也會遇到，真的有這個類型的
 *     時段發生時(11:15~12:15之類)，就跳出詢問視窗。」
 *
 * 要守的行為：
 *   ① 上午＝起始時間 < 12:00、下午＝起始時間 ≥ 12:00，**固定不可設定**。
 *   ② 15 分鐘細格資料若有一個橫跨中午、而且比上午與下午各自的尖峰都大的
 *      一小時，要**列成問題**——不可以安靜地漏掉它。
 *   ③ 使用者答了之後，那一邊的尖峰就是它；另一邊照原本規則算。
 *   ④ 沒有回答時，結果與 v20.67 以前**逐格相同**（不可以因為新增這個機制
 *      就改變任何既有數字）。
 *   ⑤ 跨中午但比兩邊都小的視窗**不要問**——問了也不會改變任何數字，
 *      只會讓真正需要注意的那一次被淹沒。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  NOON_MINUTES,
  buildPeriodAnalysis,
  buildPeriodRows,
  endMinutesOf,
  isAfternoonHour,
  isMorningHour,
  minutesToClock,
  noonStraddleKey,
  startMinutesOf,
  straddlesNoon,
} from "../app/period-analysis.ts";

const core = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const coreTurns = Object.fromEntries(
  Object.keys(core).map((key) => [
    key,
    { left: core[key], through: core[key], right: core[key] },
  ]),
);
const factors = { core, coreTurns, settings: [] };

function row(hour, small) {
  return {
    projectId: "P1",
    quarter: "2026Q1",
    roadId: "R1",
    roadName: "中山路",
    dayType: "平日",
    directionCode: "A",
    directionName: "往北",
    hour,
    surveyType: "road",
    motorcycle: 0,
    small,
    large: 0,
    special: 0,
    vehicleCounts: { small },
    vehicleLabels: { small: "小型車" },
  };
}

const pad = (n) => String(n).padStart(2, "0");
/** 產生一整天的 15 分鐘格；valueAt(分鐘) 決定每一格的小型車數（PCE 1，好手算）。 */
function quarterHourDay(valueAt) {
  const rows = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const to = minutes + 15;
    rows.push(
      row(
        `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}～${pad(Math.floor(to / 60) % 24)}:${pad(to % 60)}`,
        valueAt(minutes),
      ),
    );
  }
  return rows;
}

const combinedOf = (result) =>
  result.rows.find((item) => item.scopeCode === "ALL");

/* ══════════════════════════════════════════════════════════════════
 * ① 分界固定在中午，而且不接受任何設定
 * ════════════════════════════════════════════════════════════════ */

test("① 分界固定在 12:00", () => {
  assert.equal(NOON_MINUTES, 720);
  assert.equal(isMorningHour("11:45～12:00"), true);
  assert.equal(isAfternoonHour("11:45～12:00"), false);
  assert.equal(isMorningHour("12:00～12:15"), false);
  assert.equal(isAfternoonHour("12:00～12:15"), true);
});

test("① 逐分鐘窮舉：判定規則與 v20.67 以前完全相同", () => {
  /* 改版前的規則照抄：只看起始「小時」，< 12 算上午。 */
  const legacy = (hour) => {
    const match = String(hour).normalize("NFKC").match(/(\d{1,2})\s*:\s*(\d{2})/);
    if (!match) return -1;
    const value = Number(match[1]);
    return Number.isFinite(value) && value >= 0 && value <= 24 ? value % 24 : -1;
  };
  for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
    const label = `${minutesToClock(minutes)}～${minutesToClock(minutes + 15)}`;
    assert.equal(isMorningHour(label), legacy(label) >= 0 && legacy(label) < 12, label);
    assert.equal(isAfternoonHour(label), legacy(label) >= 12, label);
  }
});

test("① 起訖分鐘數解析與「這一格自己跨不跨中午」", () => {
  assert.equal(startMinutesOf("11:15～12:15"), 675);
  assert.equal(endMinutesOf("11:15～12:15"), 735);
  assert.equal(straddlesNoon("11:15～12:15"), true);
  assert.equal(straddlesNoon("11:30～12:30"), true);
  assert.equal(straddlesNoon("11:00～12:00"), false, "剛好收在 12:00 不算跨");
  assert.equal(straddlesNoon("12:00～13:00"), false);
  assert.equal(straddlesNoon("07:00"), false, "沒有結束時間就不要報");
  assert.equal(endMinutesOf("23:00～00:00"), 1440);
});

/* ══════════════════════════════════════════════════════════════════
 * ② 15 分鐘滾動：跨中午而且比兩邊都大 → 要問
 * ════════════════════════════════════════════════════════════════ */

/*
 * 刻意造一份「真正最忙的一小時橫跨中午」的資料。
 *
 * ⚠️ 這份測資是修過的，修的過程本身值得記下來：
 *   第一版把 11:15～12:15 四格都設成一樣大，結果「上午最忙的一小時」
 *   變成 11:00–12:00（它和那個跨中午的視窗共用三格），而不是我預期的
 *   07:00–08:00——**我的手算是錯的，程式是對的**。
 *   現在改成「尖峰幾乎都在中午之後、只往前多跨 15 分鐘」，這既是真實會
 *   發生的形狀，也讓上午／下午兩邊的比較對象乾淨分開。
 *
 *   每格的小型車數（PCE 1，所以輛數＝PCU）：
 *     11:45         → 100
 *     12:00／12:15／12:30 → 各 900
 *     07:00～08:00 四格 → 各 200
 *     17:00～18:00 四格 → 各 220
 *     其餘          → 5
 *
 *   手算：
 *     跨中午的 11:45–12:45 ＝ 100＋900＋900＋900 ＝ 2800
 *     上午最忙（整個視窗都在 12:00 以前）＝ 07:00–08:00 ＝ 200×4 ＝ 800
 *       （11:00–12:00 只有 5＋5＋5＋100 ＝ 115，贏不了）
 *     下午最忙（整個視窗都在 12:00 以後）＝ 12:00–13:00 ＝ 900×3＋5 ＝ 2705
 *   2800 > 2705 > 800，所以那個跨中午的視窗比兩邊都大，必須問。
 */
const straddleValueAt = (minutes) => {
  if (minutes === 11 * 60 + 45) return 100;
  if (minutes >= 12 * 60 && minutes < 12 * 60 + 45) return 900;
  if (minutes >= 7 * 60 && minutes < 8 * 60) return 200;
  if (minutes >= 17 * 60 && minutes < 18 * 60) return 220;
  return 5;
};
const straddleRecords = quarterHourDay(straddleValueAt);

test("⚠️ ② 跨中午而且比上午、下午都大的一小時，要被列成問題", () => {
  const result = buildPeriodAnalysis(straddleRecords, { factors });
  assert.equal(result.straddles.length, 1, JSON.stringify(result.straddles));
  const question = result.straddles[0];
  assert.equal(question.label, "11:45～12:45");
  // 手算：100＋900＋900＋900 ＝ 2800
  assert.equal(question.value, 2800);
  // 手算：上午整個視窗都在 12:00 以前，最高的是 07:00–08:00 的 200×4 ＝ 800
  assert.equal(question.amLabel, "07:00～08:00");
  assert.equal(question.amValue, 800);
  // 手算：下午整個視窗都在 12:00 以後，最高的是 12:00–13:00 的 900×3＋5 ＝ 2705
  assert.equal(question.pmLabel, "12:00～13:00");
  assert.equal(question.pmValue, 2705);
  assert.equal(question.key, noonStraddleKey("R1", ""));
});

test("⚠️ ② 沒有回答時，數字與 v20.67 以前逐格相同（新機制不可以改到既有結果）", () => {
  const combined = combinedOf(buildPeriodAnalysis(straddleRecords, { factors }));
  // 上午段只看 12:00 以前起算的格子 → 07:00–08:00，800
  assert.equal(combined.periods.am.hour, "07:00～08:00");
  assert.equal(combined.periods.am.pcu, 800);
  // 下午段只看 12:00 以後起算的格子 → 12:00–13:00，2705
  assert.equal(combined.periods.pm.hour, "12:00～13:00");
  assert.equal(combined.periods.pm.pcu, 2705);
  /*
   * ⚠️ 全調查時段尖峰**本來就抓得到**跨中午的那一小時（它沒有上午／下午的
   *   限制），所以它是 2000。這也正是「上午尖峰漏報了」最容易被看穿的地方：
   *   全時段尖峰 2800、上午 800、下午 2705，三個數字並排時就很奇怪。
   */
  assert.equal(combined.periods.peak24.pcu, 2800);
});

test("⚠️ ② 回答「算上午」之後，上午尖峰換成那個跨中午的視窗", () => {
  const answers = { [noonStraddleKey("R1", "")]: "am" };
  const combined = combinedOf(
    buildPeriodAnalysis(straddleRecords, { factors, noonAnswers: answers }),
  );
  assert.equal(combined.periods.am.hour, "11:45～12:45");
  assert.equal(combined.periods.am.pcu, 2800);
  /*
   * ⚠️ 下午尖峰會**跳開**那一小時，變成 17:00–18:00（220×4 ＝ 880），
   *   而不是 12:00–13:00 的 2705。
   *
   *   這是刻意的，而且是這個功能最重要的一條：使用者說 11:45–12:45 算上午，
   *   那 12:00～12:45 那三格的車就已經被算進上午尖峰了；下午尖峰若再挑
   *   12:00–13:00，同一批車會**同時出現在兩個尖峰裡**，兩個數字各自看都對，
   *   放在一起卻是重複計算。
   */
  assert.equal(combined.periods.pm.hour, "17:00～18:00");
  assert.equal(combined.periods.pm.pcu, 880);
});

test("⚠️ ② 回答「算下午」之後，換成下午尖峰；上午維持 07:00–08:00", () => {
  const answers = { [noonStraddleKey("R1", "")]: "pm" };
  const combined = combinedOf(
    buildPeriodAnalysis(straddleRecords, { factors, noonAnswers: answers }),
  );
  assert.equal(combined.periods.pm.hour, "11:45～12:45");
  assert.equal(combined.periods.pm.pcu, 2800);
  assert.equal(combined.periods.am.hour, "07:00～08:00");
  assert.equal(combined.periods.am.pcu, 800);
});

test("⚠️ ② 回答「忽略這個時段」＝照原本的 12:00 分界算（與沒回答同一個結果）", () => {
  /*
   * 使用者 2026-09-12 指定的第 2 個選項。
   *
   * ⚠️ 算出來的數字與「還沒回答」相同是**刻意**的，但兩者意思不同：
   *   沒回答＝還沒問過；ignore＝使用者看過、而且決定不要它。
   *   存成不同的值，日後回頭看才分得出那個高峰是被忽略還是被漏掉。
   */
  const ignored = combinedOf(
    buildPeriodAnalysis(straddleRecords, {
      factors,
      noonAnswers: { [noonStraddleKey("R1", "")]: "ignore" },
    }),
  );
  const none = combinedOf(buildPeriodAnalysis(straddleRecords, { factors }));
  assert.deepEqual(ignored.periods.am, none.periods.am);
  assert.deepEqual(ignored.periods.pm, none.periods.pm);
  assert.equal(ignored.periods.am.hour, "07:00～08:00");
  assert.equal(ignored.periods.pm.hour, "12:00～13:00");
});

test("② 全調查時段與全調查時段尖峰完全不受回答影響", () => {
  const none = combinedOf(buildPeriodAnalysis(straddleRecords, { factors }));
  for (const side of ["am", "pm", "ignore"]) {
    const answered = combinedOf(
      buildPeriodAnalysis(straddleRecords, {
        factors,
        noonAnswers: { [noonStraddleKey("R1", "")]: side },
      }),
    );
    assert.deepEqual(answered.periods.all, none.periods.all);
    assert.deepEqual(answered.periods.peak24, none.periods.peak24);
  }
});

/* ══════════════════════════════════════════════════════════════════
 * ⑤ 不該問的不要問
 * ════════════════════════════════════════════════════════════════ */

test("⚠️ ⑤ 跨中午但比兩邊都小 → 不要問（問了也不會改變任何數字）", () => {
  const records = quarterHourDay((minutes) => {
    if (minutes >= 11 * 60 + 15 && minutes < 12 * 60 + 15) return 100; // 400
    if (minutes >= 7 * 60 && minutes < 8 * 60) return 300; // 1200
    if (minutes >= 17 * 60 && minutes < 18 * 60) return 350; // 1400
    return 10;
  });
  const result = buildPeriodAnalysis(records, { factors });
  assert.equal(result.straddles.length, 0, JSON.stringify(result.straddles));
});

test("⑤ 每小時一格、整點對齊的資料不會產生問題（這是絕大多數真實檔）", () => {
  const records = [];
  for (let hour = 0; hour < 24; hour += 1)
    records.push(
      row(
        `${pad(hour)}:00～${pad((hour + 1) % 24)}:00`,
        hour === 8 ? 900 : hour === 17 ? 1000 : 50,
      ),
    );
  const result = buildPeriodAnalysis(records, { factors });
  assert.equal(result.straddles.length, 0);
  const combined = combinedOf(result);
  assert.equal(combined.periods.am.hour, "08:00～09:00");
  assert.equal(combined.periods.pm.hour, "17:00～18:00");
});

test("⑤ 原始檔本身就寫成跨中午的整點格（11:30～12:30）也抓得到", () => {
  /*
   * 這是另一種來源：不是滾動視窗湊出來的，而是原始檔的時間格本身錯開。
   * 那一格會整格算進上午（判定看起始時間），若它比兩邊都大就要問。
   */
  const records = [];
  for (let hour = 0; hour < 23; hour += 1) {
    const from = hour * 60 + 30;
    const to = from + 60;
    records.push(
      row(
        `${pad(Math.floor(from / 60))}:${pad(from % 60)}～${pad(Math.floor(to / 60) % 24)}:${pad(to % 60)}`,
        from === 11 * 60 + 30 ? 2000 : from === 7 * 60 + 30 ? 900 : from === 17 * 60 + 30 ? 800 : 50,
      ),
    );
  }
  const result = buildPeriodAnalysis(records, { factors });
  assert.equal(result.straddles.length, 1, JSON.stringify(result.straddles));
  assert.equal(result.straddles[0].label, "11:30～12:30");
  assert.equal(result.straddles[0].value, 2000);
});

/* ══════════════════════════════════════════════════════════════════
 * ⑥ 舊呼叫端不受影響
 * ════════════════════════════════════════════════════════════════ */

test("⑥ buildPeriodRows 仍然只回傳列，而且與 buildPeriodAnalysis 同一份", () => {
  const rows = buildPeriodRows(straddleRecords, { factors });
  const analysis = buildPeriodAnalysis(straddleRecords, { factors });
  assert.deepEqual(rows, analysis.rows);
});
