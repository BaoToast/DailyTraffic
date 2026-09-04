/*
 * xlsx（SheetJS 0.20.3）解析第三方工作簿時保留的縱深防護。
 *
 * 官方修正版已以專案內 vendor tarball 安裝；此外仍在自己的邊界做兩件事：
 * 關掉用不到的解析路徑、偵測到原型污染
 * 就中止這次匯入。這支測試把那兩件事釘住，順便釘住「匯入真的有走這條路」，
 * 免得日後有人在別的地方又寫回一組臨時的解析選項。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoPrototypePollution,
  detectPrototypePollution,
  prototypeFingerprint,
  SAFE_XLSX_READ_OPTIONS,
} from "../app/traffic-parser.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("解析選項關掉了公式、內嵌 HTML 與 VBA", () => {
  assert.equal(SAFE_XLSX_READ_OPTIONS.cellFormula, false);
  assert.equal(SAFE_XLSX_READ_OPTIONS.cellHTML, false);
  assert.equal(SAFE_XLSX_READ_OPTIONS.bookVBA, false);
  /* cellDates 一定要留著，不然時間欄會整批讀成序號 */
  assert.equal(SAFE_XLSX_READ_OPTIONS.cellDates, true);
});

test("匯入真的走的是那一組安全解析選項", () => {
  const source = readFileSync(
    join(here, "..", "app", "DashboardClient.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /XLSX\.read\(await file\.arrayBuffer\(\), SAFE_XLSX_READ_OPTIONS\)/,
    "匯入必須用 SAFE_XLSX_READ_OPTIONS，不能又寫一組臨時選項",
  );
  assert.match(
    source,
    /assertNoPrototypePollution\(fingerprint, file\.name\)/,
    "解析完必須立刻檢查原型有沒有被污染",
  );
  assert.equal(
    (source.match(/XLSX\.read\(/g) || []).length,
    1,
    "只能有一個 XLSX.read 進入點，多一個就會有一條沒被保護的路",
  );
});

test("原型被污染時會被抓出來、清乾淨並中止", () => {
  const before = prototypeFingerprint();
  Object.defineProperty(Object.prototype, "__trafficInjected", {
    value: 1,
    configurable: true,
    enumerable: false,
    writable: true,
  });
  assert.throws(
    () => assertNoPrototypePollution(before, "惡意檔案.xlsx"),
    /惡意檔案\.xlsx/,
  );
  assert.equal(Object.prototype.__trafficInjected, undefined);
  assert.deepEqual(prototypeFingerprint(), before);
});

test("沒有被污染時什麼都不做", () => {
  const before = prototypeFingerprint();
  assert.deepEqual(detectPrototypePollution(before), []);
  assert.doesNotThrow(() => assertNoPrototypePollution(before, "正常檔案.xlsx"));
});
