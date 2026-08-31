import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageNote,
  formatRange,
  intervalMinutesOf,
  parseTimeRange,
  rollingPeak,
  rollingPeakWithin,
  surveyCoverage,
} from "../app/partial-day.ts";

const quarterHours = (startHour, count) =>
  Array.from({ length: count }, (_, i) => {
    const from = startHour * 60 + i * 15;
    return formatRange(from, from + 15);
  });

test("解析各種時段寫法", () => {
  assert.deepEqual(parseTimeRange("07:00～07:15"), { start: 420, end: 435 });
  assert.deepEqual(parseTimeRange("7:00-8:00"), { start: 420, end: 480 });
  assert.deepEqual(parseTimeRange("０７：００～０８：００"), { start: 420, end: 480 });
  assert.deepEqual(parseTimeRange("23:00～24:00"), { start: 1380, end: 1440 });
  assert.deepEqual(parseTimeRange("23:45～00:00"), { start: 1425, end: 1440 });
  assert.equal(parseTimeRange("上午尖峰"), null);
});

test("單格長度取眾數，偶爾出現的合併列不影響判定", () => {
  assert.equal(intervalMinutesOf(quarterHours(7, 8)), 15);
  assert.equal(intervalMinutesOf([...quarterHours(7, 8), "07:00～09:00"]), 15);
  assert.equal(
    intervalMinutesOf(Array.from({ length: 24 }, (_, h) => formatRange(h * 60, h * 60 + 60))),
    60,
  );
});

test("完整 24 小時不會被判成部分時段", () => {
  const hours = Array.from({ length: 24 }, (_, h) => formatRange(h * 60, h * 60 + 60));
  const coverage = surveyCoverage(hours);
  assert.equal(coverage.partial, false);
  assert.equal(coverage.subHourly, false);
  assert.equal(coverage.coveredMinutes, 1440);
});

test("上下午各兩小時會被判成部分時段，且分成兩個區塊", () => {
  const hours = [...quarterHours(7, 8), ...quarterHours(17, 8)];
  const coverage = surveyCoverage(hours);
  assert.equal(coverage.partial, true);
  assert.equal(coverage.subHourly, true);
  assert.equal(coverage.intervalMinutes, 15);
  assert.equal(coverage.coveredMinutes, 240);
  assert.deepEqual(coverage.blocks, [
    { start: 420, end: 540 },
    { start: 1020, end: 1140 },
  ]);
  assert.match(coverageNote(coverage), /非 24 小時調查/);
  assert.match(coverageNote(coverage), /07:00～09:00、17:00～19:00/);
  assert.match(coverageNote(coverage), /合計 4 小時/);
});

test("每小時一列的資料沿用原本做法：取最大的那一列", () => {
  const entries = [
    { hour: "07:00～08:00", value: 100 },
    { hour: "08:00～09:00", value: 250 },
    { hour: "17:00～18:00", value: 180 },
  ];
  const peak = rollingPeak(entries);
  assert.equal(peak.value, 250);
  assert.equal(peak.label, "08:00～09:00");
  assert.equal(peak.rolling, false);
});

test("15 分鐘資料改用連續 4 格的滾動視窗（重現使用者回報的七叉路口上午尖峰）", () => {
  // 使用者檔案「總彙整」上半部的每 15 分鐘 PCU 合計
  const values = [791.5, 939.8, 1263.8, 952.8, 820.2, 636.8, 678.6, 546.8];
  const entries = quarterHours(7, 8).map((hour, i) => ({ hour, value: values[i] }));
  const peak = rollingPeak(entries);
  assert.equal(peak.rolling, true);
  assert.equal(peak.spans, 4);
  assert.equal(peak.label, "07:15～08:15");
  assert.equal(Number(peak.value.toFixed(1)), 3976.6);
});

test("下午尖峰同樣以滾動視窗求得（同一份調查的下午）", () => {
  const values = [1119.8, 1013.1, 1106.9, 868.3, 880.7, 692, 729.3, 591.9];
  const entries = quarterHours(17, 8).map((hour, i) => ({ hour, value: values[i] }));
  const peak = rollingPeak(entries);
  assert.equal(peak.label, "17:00～18:00");
  assert.equal(Number(peak.value.toFixed(1)), 4108.1);
});

test("滾動視窗不會跨越上午與下午之間的空隙", () => {
  const entries = [
    ...quarterHours(7, 8).map((hour) => ({ hour, value: 10 })),
    ...quarterHours(17, 8).map((hour) => ({ hour, value: 1000 })),
  ];
  const peak = rollingPeak(entries);
  // 若允許跨越空隙，08:45～17:15 這種荒謬的視窗會出現；正確結果應落在下午區塊內
  assert.equal(peak.value, 4000);
  assert.equal(peak.label, "17:00～18:00");
});

test("上午與下午尖峰可以各自求得", () => {
  const morning = [791.5, 939.8, 1263.8, 952.8, 820.2, 636.8, 678.6, 546.8];
  const afternoon = [1119.8, 1013.1, 1106.9, 868.3, 880.7, 692, 729.3, 591.9];
  const entries = [
    ...quarterHours(7, 8).map((hour, i) => ({ hour, value: morning[i] })),
    ...quarterHours(17, 8).map((hour, i) => ({ hour, value: afternoon[i] })),
  ];
  const am = rollingPeakWithin(entries, 0, 12 * 60);
  const pm = rollingPeakWithin(entries, 12 * 60, 24 * 60);
  assert.equal(am.label, "07:15～08:15");
  assert.equal(pm.label, "17:00～18:00");
  assert.equal(Number(am.value.toFixed(1)), 3976.6);
  assert.equal(Number(pm.value.toFixed(1)), 4108.1);
});

test("連續資料不足一小時時，取該段合計並標示實際時段", () => {
  const entries = quarterHours(7, 2).map((hour) => ({ hour, value: 50 }));
  const peak = rollingPeak(entries);
  assert.equal(peak.value, 100);
  assert.equal(peak.spans, 2);
  assert.equal(peak.label, "07:00～07:30");
});

test("空資料與無法解析的時段不會造成例外", () => {
  assert.equal(rollingPeak([]).label, "—");
  assert.equal(rollingPeak([{ hour: "上午尖峰", value: 5 }]).label, "—");
  assert.equal(surveyCoverage([]).coveredMinutes, 0);
  assert.equal(coverageNote(surveyCoverage([])), "");
});

test("平假日只有調查時段完全相同才可直接比較", async () => {
  const { sameSurveyCoverage } = await import("../app/partial-day.ts");
  const weekday = surveyCoverage(["07:00～09:00", "17:00～19:00"]);
  const same = surveyCoverage(["07:00～08:00", "08:00～09:00", "17:00～19:00"]);
  const shifted = surveyCoverage(["08:00～10:00", "18:00～20:00"]);
  const shorter = surveyCoverage(["07:00～09:00"]);
  assert.equal(sameSurveyCoverage(weekday, same), true, "同一批時段的分列方式不同仍可比較");
  assert.equal(sameSurveyCoverage(weekday, shifted), false, "總時數相同但時鐘區間不同不可比較");
  assert.equal(sameSurveyCoverage(weekday, shorter), false, "總時數不同不可比較");
  assert.equal(sameSurveyCoverage(surveyCoverage([]), surveyCoverage([])), false, "讀不到時段時不可猜測");
});

test("5 分鐘與 30 分鐘資料也能正確湊成一小時", () => {
  const five = Array.from({ length: 24 }, (_, i) => ({
    hour: formatRange(420 + i * 5, 425 + i * 5),
    value: i < 12 ? 1 : 10,
  }));
  const peak = rollingPeak(five);
  assert.equal(peak.spans, 12);
  assert.equal(peak.value, 120);
  const half = Array.from({ length: 4 }, (_, i) => ({
    hour: formatRange(420 + i * 30, 450 + i * 30),
    value: [10, 20, 30, 5][i],
  }));
  const peakHalf = rollingPeak(half);
  assert.equal(peakHalf.spans, 2);
  assert.equal(peakHalf.value, 50);
  assert.equal(peakHalf.label, "07:30～08:30");
});

test("peakFromBuckets：15 分鐘分桶要回傳滾動一小時，不是最大的那一格", async () => {
  const { peakFromBuckets } = await import("../app/partial-day.ts");
  // 使用者實測情境：最大的單一 15 分鐘格是 07:30～07:45（1263.8），
  // 但真正的尖峰小時是 07:15～08:15（3976.6）。舊版會顯示前者。
  const values = [791.5, 939.8, 1263.8, 952.8, 820.2, 636.8, 678.6, 546.8];
  const buckets = quarterHours(7, 8).map((hour, i) => [hour, values[i]]);
  const peak = peakFromBuckets(buckets);
  assert.equal(peak.label, "07:15～08:15");
  assert.equal(Number(peak.value.toFixed(1)), 3976.6);
  assert.notEqual(peak.label, "07:30～07:45");
});

test("peakFromBuckets：平日與假日分開的鍵不會被併成同一個滾動視窗", async () => {
  const { peakFromBuckets } = await import("../app/partial-day.ts");
  const buckets = [
    ...quarterHours(7, 4).map((hour) => [`平日|${hour}`, 100]),
    ...quarterHours(7, 4).map((hour) => [`假日|${hour}`, 250]),
  ];
  const peak = peakFromBuckets(buckets);
  assert.equal(peak.label, "假日 07:00～08:00");
  assert.equal(peak.value, 1000);
});

test("peakFromBuckets：每小時一列的資料維持原本行為", async () => {
  const { peakFromBuckets } = await import("../app/partial-day.ts");
  const buckets = Array.from({ length: 24 }, (_, h) => [
    formatRange(h * 60, h * 60 + 60),
    h === 8 ? 900 : 100,
  ]);
  const peak = peakFromBuckets(buckets);
  assert.equal(peak.label, "08:00～09:00");
  assert.equal(peak.value, 900);
});

/*
 * ── 尖峰視窗的頭和尾都要落在範圍內 ──
 *
 * 舊版只檢查起點，滾動視窗卻可以往後串到範圍外：
 * 上午 [05:00, 12:00) 會挑到 11:45 起算的 11:45–12:45——一個大半在下午的
 * 視窗被標成「上午尖峰」，而且和下午挑到的 12:00–13:00 重疊 45 分鐘，
 * 同一批車同時算進兩個尖峰。
 */
test("上午尖峰不會挑到跨越中午的視窗", () => {
  const entries = [];
  for (let m = 9 * 60; m < 13 * 60; m += 15) {
    const label = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}～${String(Math.floor((m + 15) / 60)).padStart(2, "0")}:${String((m + 15) % 60).padStart(2, "0")}`;
    /* 把量刻意堆在 11:45–12:45，誘使舊版挑到跨中午的視窗 */
    entries.push({ hour: label, value: m >= 11 * 60 + 45 && m < 12 * 60 + 45 ? 1000 : 10 });
  }
  const am = rollingPeakWithin(entries, 5 * 60, 12 * 60);
  const pm = rollingPeakWithin(entries, 12 * 60, 23 * 60);
  assert.ok(am.label, "上午應該還是挑得到視窗");
  /* 結尾正好是 12:00 是可以的；不可以的是跨過 12:00（例如 11:45～12:45）。 */
  const amEnd = am.label.split(/[～~]/)[1] ?? "";
  assert.ok(
    amEnd === "12:00" || amEnd < "12:00",
    `上午尖峰跨過中午了：${am.label}`,
  );
  assert.match(pm.label, /^12:00/, pm.label);
});

test("下午尖峰的視窗不會超過上界（23:00）", () => {
  const entries = [];
  for (let m = 21 * 60; m < 24 * 60; m += 15) {
    const label = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}～${String(Math.floor((m + 15) / 60) % 24).padStart(2, "0")}:${String((m + 15) % 60).padStart(2, "0")}`;
    entries.push({ hour: label, value: m >= 22 * 60 + 45 ? 900 : 10 });
  }
  const pm = rollingPeakWithin(entries, 12 * 60, 23 * 60);
  assert.ok(pm.label, "應該還是挑得到視窗");
  const pmEnd = pm.label.split(/[～~]/)[1] ?? "";
  assert.ok(pmEnd === "23:00" || pmEnd < "23:00", `視窗超出 23:00：${pm.label}`);
});
