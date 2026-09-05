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
import { readFile, readdir } from "node:fs/promises";

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

/*
 * 手冊裡一定要有「本版」的更新說明。
 *
 * 這一支是踩到坑才補的：我升版時用字串取代把新的更新說明插進 manual.html，
 * 但比對的字串對不上（那個位置的 class 已經換過），replace 靜靜地什麼都沒做，
 * 而且沒有任何檢查會失敗。結果連續三版（v20.23／24／25）的更新說明
 * **完全沒有進到手冊裡**，手冊卻照樣產生、版號也照樣對得上。
 *
 * 所以這裡不只檢查「手冊裡有這個版號」（標題與版本戳記本來就有，
 * 那樣檢查等於沒檢查），而是檢查**更新說明區塊的標題**帶著目前版號。
 */
test("手冊裡有本版的更新說明區塊", async () => {
  const version = await systemVersion();
  const manual = await readFile(
    new URL("../scripts/manual/manual.html", import.meta.url),
    "utf8",
  );
  /*
   * v20.42 起，手冊不再收錄「每一版改了什麼」——那是維護紀錄不是操作說明，
   * 使用者明確表示新手不需要看（見 tests/manual-version-log.test.mjs 的說明）。
   * 這一支原本靠「本版（vX）更新內容」確認手冊真的重新產生過；
   * 改用封面戳記當錨點，同樣擋得住「只改檔名、內容還是舊版」。
   */
  const stamp = manual.match(/系統版本：(v[\d.]+)　更新日期：(\d{4}-\d{2}-\d{2})/);
  assert.ok(stamp, "manual.html 找不到「系統版本：vX　更新日期：YYYY-MM-DD」封面戳記");
  assert.equal(
    stamp[1],
    version,
    `manual.html 封面戳記寫 ${stamp[1]}，程式是 ${version}——升版時可能只改了檔名，忘了重新產生手冊。`,
  );
});

test("GitHub Pages 根目錄建置產物與目前版本一致", async () => {
  const version = await systemVersion();
  const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const match = index.match(/\.\/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  assert.ok(match, "根目錄 index.html 找不到主程式資產");
  const asset = await readFile(
    new URL(`../assets/${match[1]}`, import.meta.url),
    "utf8",
  );
  assert.ok(
    asset.includes(version),
    `根目錄建置產物不含 ${version}，可能仍是舊版網站`,
  );
  assert.ok(
    asset.includes("period-display-toggle"),
    "根目錄建置產物不含本版的期別顯示切換功能",
  );
});

test("驗證報告檔名與目前版本一致，不得殘留舊版", async () => {
  const version = await systemVersion();
  const expected = `VALIDATION_${version}.md`;
  const rootFiles = await readdir(new URL("../", import.meta.url));
  const reports = rootFiles.filter((name) => /^VALIDATION_v[\d.]+\.md$/.test(name));
  assert.deepEqual(reports, [expected]);
  const report = await readFile(new URL(`../${expected}`, import.meta.url), "utf8");
  assert.match(
    report,
    new RegExp(`^# 全日交通量及車種組成 ${version.replace(/\./g, "\\.")} 驗證報告`, "m"),
    "驗證報告檔名雖正確，但標題仍是舊版",
  );
  /*
   * 「前一正式版」是字面值，每次發布都要手改一次；忘了改就會指到兩版前，
   * 看報告的人會拿錯的基準去比對。這裡不寫死是哪一版，只要求：
   *   ・這一行必須存在
   *   ・它指的版本**不可以是本版自己**（那代表根本忘了改）
   *   ・必須帶 commit，否則沒辦法回頭核對
   */
  const prev = report.match(/前一正式版：(v[\d.]+)[^\n]*commit `([0-9a-f]{40})`/);
  assert.ok(prev, "驗證報告缺少「前一正式版：vX（commit …）」這一行");
  assert.notEqual(prev[1], version, "「前一正式版」還寫著本版版號——升版時忘了改");
});

/*
 * 「如何更新」段落必須跟著版本走。
 *
 * 這一支是踩到坑才補的：那一段從 v20.35 起就沒再改過，v20.36～v20.38
 * 三次發布都照原樣交出去。照那份說明操作的人會拿**錯的版號**去確認部署
 * 有沒有成功，而且列出的「本版網站資產」是三版前的檔名——依它刪檔會
 * 刪錯，依它保留會留下一堆已經不用的舊資產。
 */
test("更新說明的「如何更新」段落沒有殘留舊版號與舊資產檔名", async () => {
  const version = await systemVersion();
  const notes = await readFile(
    new URL("../【更新說明】請先讀我.txt", import.meta.url),
    "utf8",
  );
  const section = notes.slice(notes.indexOf("如何更新"));
  assert.notEqual(notes.indexOf("如何更新"), -1, "找不到「如何更新」段落");

  /* 版號：只有本版與「上一版應回 404」那一句可以出現別的版號 */
  const versions = [...new Set([...section.matchAll(/v(\d+\.\d+(?:\.\d+)?)/g)].map((m) => "v" + m[1]))];
  const unexpected = versions.filter(
    (v) => v !== version && !new RegExp(`舊版 ${v.replace(/\./g, "\\.")} `).test(section),
  );
  assert.deepEqual(unexpected, [], "「如何更新」段落殘留了舊版號");

  /* 資產檔名：要與實際建置產物一致 */
  const listed = section
    .slice(section.indexOf("本版網站資產："))
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_.-]+\.(js|css)$/.test(line));
  /*
   * 讀根目錄的 assets/（那就是要部署上去的那一份，也是交付包裡有的），
   * 不能讀 github-pages/dist——它不在交付包裡。
   */
  const actual = (await readdir(new URL("../assets", import.meta.url))).sort();
  assert.ok(listed.length > 0, "「本版網站資產」清單是空的");
  assert.deepEqual(listed.sort(), actual, "列出的資產檔名與實際建置產物不一致");
});
