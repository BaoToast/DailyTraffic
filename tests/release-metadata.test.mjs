/*
 * 發布中繼資料的一致性檢查。
 *
 * 起因：外部檢查在姊妹專案裡發現同一個發布包有三種版本號
 * （package.json、package-lock.json、程式畫面各一個）。版本號是判斷
 * 「使用者手上是哪一版」的唯一依據，不一致會讓回報的問題對不到程式碼。
 * 這一支把它們釘在一起，改了其中一個而忘了其他的，測試就會失敗。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const readJson = async (name) =>
  JSON.parse(await readFile(new URL(`../${name}`, import.meta.url), "utf8"));

/*
 * 版號的唯一來源是 app/system-release.ts。這裡刻意用讀檔＋正規表示式
 * 而不是 import，因為這支測試要驗的正是「那個檔案裡寫的字面值」——
 * 用 import 的話，萬一有人把它改成從別處算出來的值，這個檢查就失去意義。
 */
const systemVersion = async () => {
  const source = await readFile(
    new URL("../app/system-release.ts", import.meta.url),
    "utf8",
  );
  const match = source.match(/export const SYSTEM_VERSION = "(v[\d.]+)"/);
  assert.ok(match, "app/system-release.ts 裡找不到 SYSTEM_VERSION");
  return match[1];
};

test("package.json 與 package-lock.json 的版本號和程式顯示的一致", async () => {
  const version = await systemVersion();
  /* 畫面版本是 v20.21，npm 需要三段式，所以比對時補上 .0 */
  const expected = version.replace(/^v/, "") + ".0";
  const pkg = await readJson("package.json");
  const lock = await readJson("package-lock.json");
  assert.equal(pkg.version, expected, "package.json 版本號和程式不一致");
  assert.equal(lock.version, expected, "package-lock.json 版本號和程式不一致");
  assert.equal(lock.packages?.[""]?.version, expected, "lock packages[''] 不一致");
});

test("畫面上的手冊連結檔名帶著目前版本", async () => {
  const version = await systemVersion();
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  for (const ext of ["pdf", "docx"])
    assert.ok(
      source.includes(`Traffic_Analysis_Beginner_Guide_${version}.${ext}`),
      `手冊 ${ext} 連結沒有跟著版本更新`,
    );
});
