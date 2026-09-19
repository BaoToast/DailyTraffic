/*
 * ══════════════════════════════════════════════════════════════════════
 *  X-43／X-44／X-48／X-49：資料維護頁
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-16：
 *   「全日交通量的品質與定稿分頁中似乎就是一個資料維護的半成品了，
 *     可以將此頁面與資料維護的內容做個融合。到時資料匯入的這個
 *     "品質與定稿"就能移除或是改名稱，點下去就是跳轉到資料維護分頁中」
 *   「資料產出與維護，應該要三個程式互相同步：刪除單一季度、
 *     執行資料異常檢查按鈕(要能正常運作)、異常提醒門檻、
 *     資料異常檢查摘要、檢查結果」
 *   「我建議在檢查結果表中，新增一欄"解決方式"」
 *
 * ⚠️ 這一支是**靜態**守門（掃原始碼），畫面上真的跑得起來由
 *   scripts/e2e-maintenance.mjs 負責。兩支缺一不可：
 *   靜態的抓得到「某一種異常忘了寫解決方式」（測資不一定觸發得到），
 *   e2e 抓得到「按鈕按下去沒反應」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../app/final-workflow.ts", import.meta.url),
  "utf8",
);

test("X-43：舊的「品質與定稿」視窗整塊不可以還留著", () => {
  /*
   * ⚠️ 註解裡提到這個名字是刻意的（說明它為什麼被拿掉），所以要先把
   *   註解剝掉再掃，否則這一項永遠紅，而紅的原因是那一段說明本身。
   */
  const code = app
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  assert.ok(
    !code.includes("showQualityCenter"),
    "showQualityCenter 還在——同一件事留兩個入口，遲早會分岔成兩套數字",
  );
  assert.ok(
    !/<h3>\{showQuarter\(quarter\)\} 品質與定稿<\/h3>/.test(app),
    "品質與定稿視窗的標題還在",
  );
});

test("X-43／X-48：資料維護的四塊都要有自己的 id，側欄才點得到", () => {
  for (const id of [
    "maintenance-delete-quarter",
    "quality-run",
    "quality-summary",
    "quality-thresholds",
    "quality-reasons",
  ])
    assert.ok(
      app.includes(`id="${id}"`),
      `資料維護少了「${id}」這一塊`,
    );
});

test("X-48：側欄要列出資料維護的四個小分頁，名稱與另外兩支逐字相同", () => {
  for (const label of [
    "刪除單一季度",
    "資料異常檢查摘要",
    "異常提醒門檻",
    "檢查結果",
  ])
    assert.ok(
      app.includes(`{ label: "${label}", anchor:`),
      `側欄少了「${label}」`,
    );
});

test("X-44：摘要與檢查結果要等按過檢查才給數字", () => {
  /*
   * ⚠️ 只驗「有這顆按鈕」是不夠的：按鈕可以是個空殼。這裡驗的是
   *   摘要那一格真的寫著「沒檢查過就給破折號」這個條件式。
   */
  assert.ok(
    app.includes('data-testid="quality-run"'),
    "沒有「執行資料異常檢查」按鈕",
  );
  assert.ok(
    /qualityRunAt \? value : "—"/.test(app),
    "摘要沒有做「沒檢查過就不給數字」的守衛",
  );
  assert.ok(
    app.includes("結果已過期"),
    "檢查完之後資料又動過時沒有標成過期",
  );
});

/** ANOMALY_RESOLUTIONS 裡每一筆的 kind 與 text。 */
function resolutionEntries() {
  const start = workflow.indexOf("export const ANOMALY_RESOLUTIONS");
  const end = workflow.indexOf("export function detectAnomalies");
  assert.ok(start >= 0 && end > start, "找不到 ANOMALY_RESOLUTIONS 的範圍");
  const body = workflow.slice(start, end);
  return [
    ...body.matchAll(
      /\n\s{4}kind:\s*"([^"]+)",\n\s{4}text:\s*"((?:[^"\\]|\\.)*)"/g,
    ),
  ].map((m) => ({ kind: m[1], text: m[2] }));
}

test("X-49：五種異常每一種都要有解決方式", () => {
  const types = workflow
    .slice(
      workflow.indexOf("export const ANOMALY_TYPES"),
      workflow.indexOf("export type AnomalyType"),
    )
    .match(/"[^"]+"/g);
  assert.equal(types.length, 5, `ANOMALY_TYPES 變成 ${types.length} 種了`);
  const entries = resolutionEntries();
  assert.equal(
    entries.length,
    types.length,
    `${types.length} 種異常卻只有 ${entries.length} 個解決方式`,
  );
});

test("X-49：每一句解決方式都要講得出使用者實際要做什麼", () => {
  for (const { text } of resolutionEntries())
    assert.ok(text.length > 60, `這一句太短、照不了做：${text}`);
});

test("X-49：不同種類的異常不可以共用同一句（那等於沒寫）", () => {
  const texts = resolutionEntries().map((item) => item.text);
  assert.equal(new Set(texts).size, texts.length, "有兩種異常共用同一句");
});

test("X-49：解決方式是純文字，不可以留下 Markdown 粗體記號", () => {
  const bad = resolutionEntries()
    .filter((item) => item.text.includes("**"))
    .map((item) => item.text);
  assert.deepEqual(bad, [], "星號會原樣印在檢查結果表裡，請改用「」");
});

test("X-49：處理類別只能是三種之一，標成重新匯入的要真的講出重匯", () => {
  for (const { kind, text } of resolutionEntries()) {
    assert.ok(
      ["重新匯入", "人工確認", "畫面修正"].includes(kind),
      `不認得的處理類別：${kind}`,
    );
    if (kind === "重新匯入")
      assert.ok(text.includes("重新匯入"), `標成重新匯入卻沒講出要重匯：${text}`);
  }
});

test("X-49：檢查結果表真的畫出「解決方式」欄，而且空列的欄位數跟著加一", () => {
  assert.ok(app.includes("<th>解決方式</th>"), "表頭沒有「解決方式」欄");
  assert.ok(
    app.includes("colSpan={7}"),
    "空狀態那一列還停在 6 欄，加了一欄之後會少一格",
  );
});

test("X-48：這一頁每一塊都要掛常駐的「不受主工具列影響」說明", () => {
  /*
   * ⚠️ 使用者指定「這一分頁所有功能都不會受到主工具列的影響」。
   *   既然如此就要**每一塊都講**——只在頁面上方講一次的話，
   *   捲到下面那幾塊的人看不到。
   */
  /*
   * ⚠️ X-63（2026-09-17）：這四塊已經**不在同一個 .maintenance-zone 裡**了。
   *   使用者指定把「刪除單一季度」搬到「還原與備份」那個大分頁，
   *   其餘三塊留在「資料異常檢查」。原本這一條是掃「那一個容器裡有幾句」，
   *   搬走之後只掃得到 3 塊而紅——**紅的是掃描方式，不是功能**。
   *
   *   改成**逐塊**驗：每一個 id 自己那一段裡要找得到常駐說明。
   *   這比原本那種「數總數」的寫法更嚴：舊寫法只要總數夠，
   *   一塊掛兩句、另一塊一句都沒有也會綠。
   */
  const WANTED = [
    "maintenance-delete-quarter",
    "quality-summary",
    "quality-thresholds",
    "quality-reasons",
  ];
  const missing = [];
  for (const id of WANTED) {
    const at = app.indexOf(`id="${id}"`);
    assert.ok(at > 0, `找不到 ${id}，掃描寫壞了`);
    /* 到下一塊的開頭為止；找不到下一塊就吃到檔尾。 */
    const rest = app.slice(at);
    const nextIds = WANTED.map((other) =>
      other === id ? -1 : rest.indexOf(`id="${other}"`),
    ).filter((index) => index > 0);
    const end = nextIds.length ? Math.min(...nextIds) : rest.length;
    if (!rest.slice(0, end).includes('data-inapplicable-always="1"'))
      missing.push(id);
  }
  assert.deepEqual(
    missing,
    [],
    `這幾塊少了常駐的「不受主工具列影響」說明，使用者會以為篩選壞了：${missing.join("、")}`,
  );
});
