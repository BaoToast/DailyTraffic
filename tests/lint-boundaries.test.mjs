import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const config = await readFile(
  new URL("../eslint.config.mjs", import.meta.url),
  "utf8",
);

test("lint 不掃 GitHub Pages、試用版與本機複查產物", () => {
  for (const ignored of [
    '"github-pages/dist/**"',
    '"github-pages/.tryout/**"',
    '"_review_artifacts/**"',
  ]) {
    assert.ok(config.includes(ignored), `eslint 缺少忽略規則：${ignored}`);
  }
});
