/*
 * ── PCU 當量係數的黃金值鎖 ──
 *
 * 這些係數是全系統每一個 PCU 數字的基礎，但在此之前**沒有任何測試引用
 * DashboardClient.tsx 裡的那一份**。五支既有測試各自在自己的檔案裡另寫
 * 一份 `const core = { motorcycle: 0.5, ... }` 副本，所以把程式裡的 0.5
 * 改成 0.42，217 項測試會全數照樣通過，而系統每一筆 PCU 都會變。
 *
 * 這支測試直接從原始碼把常數宣告讀出來比對，讓畫面與測試讀的是同一份
 *（與 app/system-release.ts 把版號抽成單一來源的理由相同）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../app/DashboardClient.tsx", import.meta.url),
  "utf8",
);

/** 從原始碼取出一段 `const <name> = { ... };` 並求值。 */
function constObject(name) {
  const start = source.indexOf(`const ${name}`);
  assert.ok(start >= 0, `找不到常數 ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      const body = source.slice(open, i + 1);
      return new Function(`return (${body});`)();
    }
  }
  throw new Error(`${name} 的大括號不成對`);
}

test("四大類車種的 PCU 當量係數不得變動", () => {
  assert.deepEqual(constObject("PCU_FACTORS"), {
    motorcycle: 0.5,
    small: 1,
    large: 1.5,
    special: 2.5,
  });
});

test("逐轉向的 PCU 當量係數不得變動", () => {
  assert.deepEqual(constObject("TURN_PCU_FACTORS"), {
    motorcycle: { through: 0.3, right: 0.4, left: 0.5 },
    small: { through: 1, right: 1.3, left: 1.5 },
    large: { through: 1.5, right: 2, left: 2.3 },
    special: { through: 2, right: 2.3, left: 2.5 },
  });
});

test("新車種的預設當量維持 1", () => {
  const match = source.match(/const NEW_VEHICLE_DEFAULT_PCU = ([\d.]+)/);
  assert.ok(match, "找不到 NEW_VEHICLE_DEFAULT_PCU");
  assert.equal(Number(match[1]), 1);
});
