/*
 * ══════════════════════════════════════════════════════════════════════
 *  時間格超過 1 小時 → 擋下匯入（使用者 2026-09-30 裁示）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 原話：「針對如果**時間格超過 1 小時的異常，跳出視窗後，請直接阻止檔案匯入**，
 * 視窗告知**本程式不支援超過 1 小時的時段**」。
 *
 * ⚠️ 2026-09-24 的舊裁示是「提醒、不阻擋」，2026-09-30 改成擋。
 *   這一支同時是 H32 的結案證據：超過 1 小時的資料進不來，
 *   「每小時趨勢」那張表就不可能遇到它（不會把 07:00～09:00 整個算進 07 時、
 *   也不會讓 08 時斷線）。
 *
 * ⚠️ **這是「本來進得來、以後進不來」的行為變更**，所以反證比正證重要：
 *   15／20／30／45／60 分鐘一格都是正常的調查（使用者手上的真實檔就有 45 分鐘的），
 *   擋錯的後果是他正常的檔案匯不進去。下面第 ② 組就是在守這件事。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { longIntervalBlock } from "../app/partial-day.ts";

const rec = (hour, file = "115T1-01_中山路.xlsx", sheet = "") => ({
  hour,
  sourceFileName: file,
  sourceSheetName: sheet,
});

test("① 超過 1 小時的格子要被擋下來，而且訊息寫得出是哪一個檔、幾小時、幾格", () => {
  const message = longIntervalBlock([
    rec("07:00~09:00"),
    rec("09:00~10:00"),
    rec("10:00~12:00"),
  ]);
  assert.ok(message, "有 2 小時的格子卻沒有擋");
  assert.match(message, /本程式不支援超過 1 小時的時段/, "沒有寫出使用者指定的那句話");
  assert.match(message, /一筆都沒有寫進去/, "沒有講清楚整批都沒進去");
  assert.match(message, /115T1-01_中山路\.xlsx/, "沒有寫出是哪一個檔");
  assert.match(message, /2 小時 × 2 格/, "沒有寫出幾小時、幾格");
  assert.match(message, /請回原始檔/, "沒有告訴使用者下一步要做什麼");
});

test("⚠️ ② 反證：正常的格距一個都不可以被擋（擋錯＝使用者的檔案匯不進去）", () => {
  /*
   * 15／20／30／45 分鐘與剛好 60 分鐘都是正常的調查格距。
   * 45 分鐘那一種**使用者手上的真實檔就有**（2026-09-24 的 I2 就是為它改的口徑）。
   */
  for (const hour of [
    "07:00~07:15",
    "07:00~07:20",
    "07:00~07:30",
    "07:00~07:45",
    "07:00~08:00",
    "23:00~24:00",
  ])
    assert.equal(
      longIntervalBlock([rec(hour)]),
      "",
      `「${hour}」是正常的格距，不可以被擋`,
    );
  /* 整批都是正常格距時當然也不擋。 */
  assert.equal(
    longIntervalBlock([rec("07:00~07:15"), rec("07:15~07:30"), rec("07:30~08:00")]),
    "",
  );
});

test("⚠️ ③ 48 格裡只有 1 格誤植成 2 小時，一樣要擋（不可以取眾數）", () => {
  /*
   * 取眾數的話這 1 格會被 47 格的 60 分鐘蓋掉——而那正是最需要被抓出來的那一格。
   */
  const rows = [];
  for (let i = 0; i < 47; i += 1) {
    const h = String(i % 24).padStart(2, "0");
    rows.push(rec(`${h}:00~${String((i % 24) + 1).padStart(2, "0")}:00`));
  }
  rows.push(rec("07:00~09:00"));
  const message = longIntervalBlock(rows);
  assert.ok(message, "48 格裡有 1 格 2 小時卻沒有擋");
  assert.match(message, /2 小時 × 1 格/);
});

test("④ 讀不出時間範圍的列不可以害整批被擋（也不可以當成通過的理由）", () => {
  assert.equal(longIntervalBlock([rec("全日"), rec("不明"), rec("")]), "");
  /* 但同一批裡真的有超時的話，照樣要擋。 */
  assert.ok(longIntervalBlock([rec("全日"), rec("07:00~09:30")]));
});

test("⑤ 多個檔案各自列出來，不要合成一句", () => {
  const message = longIntervalBlock([
    rec("07:00~09:00", "A.xlsx"),
    rec("08:00~11:00", "B.xlsx", "平日"),
  ]);
  assert.match(message, /A\.xlsx/);
  assert.match(message, /B\.xlsx【平日】/, "工作表名稱沒有帶出來");
  assert.equal(message.split("\n").filter((line) => line.startsWith("・")).length, 2);
});

/* ── 接線：畫面上真的擋得住 ────────────────────────────────── */

const dashboard = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

test("⑥ 確認鈕真的被停用，而且說得出原因", () => {
  assert.ok(dashboard.length > 100000, "DashboardClient 讀進來是空的");
  assert.ok(
    dashboard.includes("const longIntervalMessage = useMemo("),
    "畫面沒有算 longIntervalMessage",
  );
  assert.ok(
    /disabled=\{Boolean\(mixedPeriodMessage\) \|\| Boolean\(longIntervalMessage\)\}/.test(
      dashboard,
    ),
    "確認鈕沒有因為超時格距而停用——使用者按下去才知道不行，那顆鈕看起來是可以按的",
  );
  assert.ok(
    dashboard.includes('data-testid="long-interval-block"'),
    "視窗裡沒有那一段紅底說明",
  );
});

test("⚠️ ⑦ 舊的「這不會阻擋匯入」說法不可以留著（畫面說謊比沒寫更糟）", () => {
  const at = dashboard.indexOf("有時間格長度超過 1 小時");
  assert.notEqual(at, -1, "找不到逐檔說明那一段");
  const block = dashboard.slice(at, at + 700);
  assert.ok(
    !block.includes("這不會阻擋匯入"),
    "逐檔說明還寫著「這不會阻擋匯入」，與實際行為相反",
  );
  assert.ok(
    block.includes("會被擋下來"),
    "逐檔說明沒有講明這一批會被擋下來",
  );
});

test("⚠️ ⑧ 判準只能有一份（兩邊各寫一份遲早出現「畫面說擋、實際沒擋」）", () => {
  /*
   * 畫面上的阻擋與檢核報告的逐檔說明，都必須走 longIntervalBlock() 的同一條規則。
   * 這裡擋的是「有人在 DashboardClient 裡另外寫一次 > 60 的判斷」。
   */
  const code = dashboard
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.ok(code.length > 100000, "去註解之後只剩一點點，正規式吃掉了程式");
  const hits = [...code.matchAll(/minutes\s*<=\s*60/g)].length;
  assert.ok(
    hits <= 1,
    `DashboardClient 裡有 ${hits} 處自己寫「<= 60」的判斷——判準應該只在 partial-day.ts 一處`,
  );
});
