/*
 * 交付包要能在另一台電腦完整重建與驗證。
 *
 * 起因：外部檢查把原始碼包解壓到乾淨環境後，`npm test` 有 3 項失敗，
 * 而且端對端腳本與手冊產生器用到的套件根本沒有列進依賴——在這台機器上
 * 「剛好裝了」所以看不出來，換一台電腦就跑不起來。
 *
 * 這一支把兩件事釘住：
 *  1. tests/ 與 scripts/ 實際 import 的每一個外部套件，都必須列在
 *     package.json 的 dependencies 或 devDependencies 裡。
 *  2. 會讀建置產物（dist/）的測試，其測試指令必須先建置。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function sourceFiles() {
  const files = [];
  for (const dir of ["tests", "scripts", "scripts/manual"]) {
    let entries = [];
    try {
      entries = await readdir(new URL(dir + "/", root));
    } catch {
      continue;
    }
    for (const entry of entries)
      if (/\.(mjs|ts|tsx|js)$/.test(entry)) files.push(`${dir}/${entry}`);
  }
  return files;
}

/** 從一份原始碼裡抓出所有「外部套件」的名稱（排除相對路徑與 node: 內建）。 */
function externalImports(source) {
  const names = new Set();
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier.startsWith(".") || specifier.startsWith("/")) continue;
      if (specifier.startsWith("node:")) continue;
      /* @scope/name 取兩段，其餘取第一段 */
      const parts = specifier.split("/");
      names.add(specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
    }
  return names;
}

test("測試與腳本 import 的每一個套件都列在 package.json 裡", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const missing = new Map();
  for (const file of await sourceFiles()) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const name of externalImports(source))
      if (!declared.has(name))
        missing.set(name, [...(missing.get(name) ?? []), file]);
  }
  assert.deepEqual(
    [...missing.entries()].map(([name, files]) => `${name}（${files.join("、")}）`),
    [],
    "有套件沒有列進依賴，換一台電腦就裝不起來",
  );
});

test("建置、端對端測試與 GitHub 發布來源都完整", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  let needsBuild = false;
  for (const file of await sourceFiles()) {
    if (!file.startsWith("tests/")) continue;
    /* 跳過這一支自己——它的正規表示式裡就寫著 dist/，會自我命中。 */
    if (file.endsWith("dependency-manifest.test.mjs")) continue;
    const source = await readFile(new URL(file, root), "utf8");
    if (/["'`][^"'`]*\bdist\//.test(source)) needsBuild = true;
  }
  if (!needsBuild) return;
  assert.match(
    pkg.scripts.test,
    /(^|&&\s*)npm run build\b/,
    "有測試會讀 dist/，但 npm test 沒有先建置——乾淨環境下會直接失敗",
  );

  assert.match(
    pkg.scripts.e2e,
    /make-samples\.mjs[\s\S]*github-pages\/vite\.config\.ts[\s\S]*e2e-period\.mjs/,
    "端對端測試必須先產生測試樣本、再建置 GitHub Pages，最後才執行瀏覽器測試",
  );

  for (const required of [
    "github-pages/index.html",
    "github-pages/vite.config.ts",
    "github-pages/src/main.tsx",
    "build/sites-vite-plugin.ts",
    ".github/workflows/ci.yml",
    ".gitignore",
    ".nojekyll",
  ]) {
    await assert.doesNotReject(
      access(new URL(required, root)),
      `GitHub 發布或自動測試必要檔案遺失：${required}`,
    );
  }
});

test("lock 檔和 package.json 宣告的依賴一致", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  const declared = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
  const missing = declared.filter((name) => !lock.packages?.[`node_modules/${name}`]);
  assert.deepEqual(missing, [], "package-lock.json 沒有這些套件，npm ci 會失敗");
});

test("Node.js 最低版本足以直接載入測試使用的 TypeScript", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const declared = String(pkg.engines?.node ?? "");
  const match = declared.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, "engines.node 必須用 >=主版.次版.修訂版 明確宣告最低版本");
  const actual = match.slice(1).map(Number);
  const required = [22, 18, 0];
  const enough = actual.some(
    (value, index) =>
      value > required[index] &&
      actual.slice(0, index).every((earlier, i) => earlier === required[i]),
  ) || actual.every((value, index) => value === required[index]);
  assert.ok(
    enough,
    `測試會直接 import .ts；engines.node ${declared} 太舊，至少要 >=22.18.0`,
  );
});

test("正式 e2e 引用的每份活頁簿都能由匿名樣本產生器建立", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  const makeSamples = await readFile(
    new URL("scripts/make-samples.mjs", root),
    "utf8",
  );
  const scriptFiles = [
    ...String(pkg.scripts?.e2e ?? "").matchAll(/scripts\/(e2e-[\w-]+\.mjs)/g),
  ].map((match) => `scripts/${match[1]}`);
  const missing = [];
  for (const file of [...new Set(scriptFiles)]) {
    const source = await readFile(new URL(file, root), "utf8");
    for (const match of source.matchAll(/importFile\(["']([^"']+\.xlsx)["']/g)) {
      const filename = match[1];
      if (!makeSamples.includes(filename)) missing.push(`${file} → ${filename}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "正式 e2e 引用了 make-samples.mjs 不會產生的活頁簿，乾淨電腦會找不到檔案",
  );
});

/*
 * 測試讀得到的檔案，必須真的在交付包裡。
 *
 * 起因：有 5 項測試讀 `.samples/` 底下的參考調查檔，但 .samples 在
 * .gitignore 裡、不會進交付包，而且其中兩份是真實的參考檔、
 * `npm run samples` 也產不出來——解壓到另一台電腦就是 5 項失敗。
 * 現在那兩份放進 tests/fixtures/（會進包），這一支確保不會再有測試
 * 去讀包外的路徑。
 */
test("測試引用的固定檔案都在交付包裡（不是 .gitignore 掉的路徑）", async () => {
  const ignoreList = await readFile(new URL(".gitignore", root), "utf8").catch(
    () => "",
  );
  const ignored = ignoreList
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.replace(/^\/+|\/+$/g, ""));
  /*
   * 建置產物（dist、.next…）本來就不該進交付包——它們是 `npm run build`
   * 產生的，而「會讀 dist/ 的測試要先建置」已經由上一支測試把關。
   * 這裡要抓的是「產不出來、也沒放進包裡」的固定檔案。
   */
  const buildOutputs = new Set(["dist", ".next", "node_modules", "out", ".wrangler"]);
  const offenders = [];
  for (const file of await sourceFiles()) {
    if (!/\.test\.(mjs|ts)$/.test(file)) continue;
    if (file.endsWith("dependency-manifest.test.mjs")) continue;
    const source = await readFile(new URL(file, root), "utf8");
    for (const match of source.matchAll(/["'`](\.\.?\/[^"'`]+)["'`]/g)) {
      const target = match[1];
      for (const name of ignored.filter((entry) => !buildOutputs.has(entry)))
        if (new RegExp(`(^|/)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(/|$)`).test(target))
          offenders.push(`${file} → ${target}（${name} 不在交付包裡）`);
    }
  }
  assert.deepEqual([...new Set(offenders)], [], "測試讀的檔案不會進交付包");
});

/*
 * 交付包裡不可以有任何試算表檔案。
 *
 * 起因（2026-08-27 複查發現）：`tests/fixtures/` 底下放著使用者客戶的**真實
 * 調查表**（.xlsx 與 .xls 各一份），因此被提交進公開的 GitHub repository，
 * 而且可以直接從 GitHub Pages 下載。它是被兩支測試當成參考檔用的。
 *
 * 測試需要的是「這種檔案長什麼樣」，不是「這一份實際調查到多少車」，
 * 所以現在一律由 tests/helpers/intersection-sample.mjs 當場產生匿名樣本。
 * 這一支確保不會有人為了方便又把某一份實際檔案塞回來——**那種事一旦發生，
 * 所有測試仍然是綠的，沒有任何跡象**。
 */
test("交付包裡沒有任何試算表檔案（避免真實調查資料被提交）", async () => {
  const offenders = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
      /*
       * `.samples/` 與 `.samples-coverage/` 都是 `npm run samples`／`npm run e2e`
       * 當場產生的匿名測試樣本，兩個都在 .gitignore 裡、也不會進交付包，
       * 所以不算數。其餘一律要檢查。
       *
       * （這兩個名字要與 .gitignore 一致——先前只排除了 `.samples`，
       *   跑完 e2e 之後這一支就會對一個根本不會被提交的目錄紅字。）
       */
      if (
        [
          "node_modules",
          "dist",
          ".next",
          ".git",
          ".wrangler",
          ".samples",
          ".samples-coverage",
        ].includes(entry.name)
      )
        continue;
      const next = `${dir}${entry.name}${entry.isDirectory() ? "/" : ""}`;
      if (entry.isDirectory()) await walk(next);
      else if (/\.(xlsx|xlsm|xls|csv)$/i.test(entry.name)) offenders.push(next);
    }
  };
  await walk("./");
  assert.deepEqual(
    offenders,
    [],
    "包裡出現試算表檔案。測試樣本請用 tests/helpers/intersection-sample.mjs 或 " +
      "scripts/make-samples.mjs 當場產生，不要提交任何實際調查檔",
  );
});

/*
 * 原始碼裡不可以出現實際的站號或調查點名稱。
 *
 * 光是刪掉檔案不夠：若測試或註解仍寫著實際站號與調查點名稱，
 * 一樣會把委託案的調查點公開出去。示範資料一律用「示範」開頭的名稱
 * 與 A00T00-01 這種假站號。
 */
test("原始碼裡沒有實際的站號或調查點名稱", async () => {
  /* 真實站號的形狀：5 碼計畫編號 ＋ T ＋ 兩碼 ＋ 兩碼。示範站號以 A00 開頭。 */
  const stationPattern = /(?<![A-Za-z0-9])(?!A00)\d{5}T\d{2}-?\d{2}(?![0-9])/;
  const offenders = [];
  for (const file of await sourceFiles()) {
    const source = await readFile(new URL(file, root), "utf8");
    const match = source.match(stationPattern);
    if (match) offenders.push(`${file} → ${match[0]}`);
  }
  assert.deepEqual(
    offenders,
    [],
    "原始碼裡出現實際站號；示範資料請改用 A00T00-01 這類假站號",
  );
});

/*
 * `.gitattributes` 必須關掉換行轉換——理由寫在那個檔案裡。
 */
test("有 .gitattributes 且關閉了換行轉換", async () => {
  const text = await readFile(new URL(".gitattributes", root), "utf8").catch(
    () => "",
  );
  assert.match(
    text,
    /^\*\s+-text\s*$/m,
    ".gitattributes 缺少 `* -text`：在 Windows 上取出時 Git 會把建置產物轉成 CRLF，" +
      "備份包就無法與線上內容逐位元核對（2026-08-27 實際發生過）",
  );
});

test("被排除的產出目錄名稱與 .gitignore 一致", async () => {
  /*
   * 上一支測試手寫了一份「不用檢查的目錄」清單。清單漂移的話會出現兩種
   * 錯法：漏掉一個 gitignore 有的（跑完 e2e 就紅字，像先前的 .samples-coverage），
   * 或多排除一個 gitignore 沒有的（真的被提交的檔案就掃不到了，而且沒有跡象）。
   */
  const source = await readFile(new URL("dependency-manifest.test.mjs", import.meta.url), "utf8");
  const listed = [...source.matchAll(/"(\.samples(?:-coverage)?)"/g)].map((m) => m[1]);
  const ignore = await readFile(new URL(".gitignore", root), "utf8");
  for (const name of [...new Set(listed)])
    assert.ok(
      new RegExp(`^/?${name.replace(".", "\\.")}/?$`, "m").test(ignore),
      `${name} 被測試排除，但 .gitignore 裡沒有它——真的被提交的話掃不到`,
    );
  for (const name of [".samples", ".samples-coverage"])
    assert.ok(listed.includes(name), `.gitignore 有 ${name}，測試卻沒有排除它`);
});
