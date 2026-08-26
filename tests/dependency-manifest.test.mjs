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
