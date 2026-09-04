import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const expectedHash = "8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8";

test("SheetJS 套件固定使用收錄於專案的官方 0.20.3 檔案", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(pkg.dependencies.xlsx, "file:./vendor/xlsx-0.20.3.tgz");
});

test("SheetJS 官方壓縮檔雜湊不得被替換", async () => {
  const bytes = await readFile(new URL("vendor/xlsx-0.20.3.tgz", root));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
});

test("實際安裝的 SheetJS 版本是 0.20.3", async () => {
  const installed = JSON.parse(
    await readFile(new URL("node_modules/xlsx/package.json", root), "utf8"),
  );
  assert.equal(installed.version, "0.20.3");
});
