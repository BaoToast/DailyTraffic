/*
 * ══════════════════════════════════════════════════════════════════════
 *  這支程式不可以在開啟時往外連線
 * ══════════════════════════════════════════════════════════════════════
 *
 * 2026-09-13 使用者決定三支程式都不使用網路字型（路口轉向原本有一行
 * @import 去 Google 抓字型，實測會讓離線或公司網路擋掉時畫面靜靜地變樣）。
 * 這一支目前本來就沒有外部資源——**這條守的是「以後也不准加」**。
 *
 * ⚠️ 為什麼值得一支守門：它壞掉的時候完全沒有訊息。字型載不到就退回備援，
 *   畫面和驗過的不一樣，使用者與我都不會知道看的是哪一種。
 *
 * ⚠️ 只擋瀏覽器真的會去抓的那幾種寫法；函式庫裡的 XML 命名空間只是字串，
 *   寬鬆比對會全部誤判，然後人就會把這一條關掉，等於沒守。
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const FETCHERS = [
  [/@import\s+(?:url\(\s*)?["']?https?:\/\/[^"')]+/g, "CSS 的 @import"],
  [/url\(\s*["']?https?:\/\/[^"')]+/g, "CSS 的 url()"],
  [/(?:src|href)="https?:\/\/[^"]+"/g, "標籤的 src／href"],
];

const appDir = new URL("../app/", import.meta.url);
const names = (await readdir(appDir)).filter((n) => n.endsWith(".css"));

test("⚠️ 樣式表不可以向外部網站要字型或圖片", async () => {
  const hits = [];
  for (const name of names) {
    const css = await readFile(new URL(name, appDir), "utf8");
    for (const [pattern, what] of FETCHERS)
      for (const m of css.matchAll(pattern))
        hits.push(`${name} ${what}：${m[0].slice(0, 90)}`);
  }
  assert.deepEqual(hits, [], "又開始往外連了：\n" + hits.join("\n"));
});

test("前置：真的有掃到樣式表（掃不到的話上一條會變成恆真）", () => {
  assert.ok(names.length > 0, "app/ 底下找不到任何 .css");
});

test("這一條真的抓得到（反面檢查）", () => {
  const broken =
    '@import url("https://fonts.googleapis.com/css2?family=Noto+Sans+TC");';
  assert.ok(
    FETCHERS.some(([pattern]) => new RegExp(pattern.source).test(broken)),
    "把網路字型加回來時應該要被抓到",
  );
});
