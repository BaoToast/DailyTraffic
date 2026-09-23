import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

test("方向名稱與多日期提醒接進統計、篩選、草稿、Excel 與結果表", () => {
  const start = source.indexOf("const ackedAnomalyCount");
  assert.notEqual(start, -1, "找不到合併後提醒的第一個消費端");
  const consumers = source.slice(start);

  assert.doesNotMatch(
    consumers,
    /\banomalyAlerts\b/,
    "合併 allAnomalyAlerts 之後仍有消費端讀取舊清單，新提醒會漏掉",
  );
  assert.match(consumers, /anomalyTypeCounts\(allAnomalyAlerts\)/);
  assert.match(consumers, /anomalies: allAnomalyAlerts\.map/);
  assert.match(consumers, /\["異常提醒", allAnomalyAlerts\.map/);
  assert.match(consumers, /\) : allAnomalyAlerts\.length \? \(/);
});
