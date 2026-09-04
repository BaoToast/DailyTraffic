import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("季度輸入欄不得用瀏覽器 pattern 阻擋共用契約接受的全形與空白", async () => {
  const source = await readFile(
    new URL("../app/DashboardClient.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /pattern="\\d\{2,4\}Q\[1-4\]"/);
});
