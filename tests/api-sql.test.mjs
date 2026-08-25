/*
 * API 路由裡「手寫 SQL」的一致性檢查。
 *
 * 起因：app/api/import/route.ts 的 INSERT 有 23 個欄位、bind() 給了 23 個值，
 * 但 VALUES 只寫了 22 個 `?`。D1 回「22 values for 23 columns: SQLITE_ERROR」，
 * **GPT Site 版本的匯入功能整個不能用**——任何檔案都寫不進去。
 *
 * 為什麼一直沒被抓到：所有既有測試與端對端腳本跑的都是 GitHub Pages 靜態版，
 * 那一版的資料只存在瀏覽器裡，根本不會走到 API 與 D1。同一份程式因此
 * 在 Pages 上完全正常、在 GPT Site 上全毀。
 *
 * 這一支用純文字分析把三個數字釘在一起：欄位數、佔位符數、bind() 引數數。
 * 不需要真的連上 D1，但足以擋掉這一類「數量對不上」的錯誤。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../app/api/", import.meta.url);

async function routeFiles(dir = root, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    if (entry.isDirectory()) await routeFiles(child, out);
    else if (/\.ts$/.test(entry.name)) out.push(child);
  }
  return out;
}

/** 以括號深度切出 .bind( ... ) 的頂層引數個數（字串內的逗號不算）。 */
function countBindArgs(source, fromIndex) {
  const start = source.indexOf(".bind(", fromIndex);
  if (start < 0) return null;
  let depth = 0;
  let count = 1;
  let quote = null;
  for (let i = start + ".bind(".length; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "`" || ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) {
      if (depth === 0) break;
      depth -= 1;
    } else if (ch === "," && depth === 0) count += 1;
  }
  return count;
}

test("每一條 INSERT ... VALUES 的欄位數與佔位符數相等", async () => {
  const problems = [];
  for (const file of await routeFiles()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /INSERT INTO (\w+)[\s\S]{0,400}?\(([^()]*)\)[\s\S]{0,600}?VALUES\s*\(([^()]*)\)/g,
    )) {
      const columns = match[2].split(",").map((x) => x.trim()).filter(Boolean);
      const marks = match[3].split(",").filter((x) => x.trim() === "?");
      /* INSERT ... SELECT 沒有 VALUES，不會走到這裡 */
      if (!marks.length) continue;
      if (columns.length !== marks.length)
        problems.push(
          `${file.pathname.split("/api/")[1]} → ${match[1]}：欄位 ${columns.length} 個、佔位符 ${marks.length} 個`,
        );
    }
  }
  assert.deepEqual(problems, [], "SQL 欄位數與佔位符數對不上，D1 會直接拒絕");
});

test("每一條 INSERT 的佔位符數與 bind() 引數數相等", async () => {
  const problems = [];
  for (const file of await routeFiles()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /INSERT INTO (\w+)[\s\S]{0,400}?\(([^()]*)\)[\s\S]{0,600}?VALUES\s*\(([^()]*)\)/g,
    )) {
      const marks = match[3].split(",").filter((x) => x.trim() === "?").length;
      if (!marks) continue;
      /* ON CONFLICT ... DO UPDATE 裡若還有 ?，也要一起算進去 */
      const tail = source.slice(match.index + match[0].length);
      const conflictMarks = (tail.slice(0, tail.indexOf(".bind(")).match(/\?/g) || []).length;
      const bound = countBindArgs(source, match.index);
      if (bound === null) continue;
      if (bound !== marks + conflictMarks)
        problems.push(
          `${file.pathname.split("/api/")[1]} → ${match[1]}：佔位符 ${marks + conflictMarks} 個、bind() 給了 ${bound} 個`,
        );
    }
  }
  assert.deepEqual(problems, [], "bind() 引數數與佔位符數對不上");
});

test("INSERT ... SELECT 的欄位數與 SELECT 的運算式數相等", async () => {
  const problems = [];
  for (const file of await routeFiles()) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(
      /INSERT INTO (\w+)\s*\n\s*\(([^()]*)\)\s*\n\s*SELECT ([\s\S]*?)\n\s*FROM /g,
    )) {
      const columns = match[2].split(",").map((x) => x.trim()).filter(Boolean);
      /* 以括號深度切出 SELECT 的頂層運算式（CASE WHEN 裡的逗號不算） */
      let depth = 0;
      let count = 1;
      for (const ch of match[3]) {
        if ("([".includes(ch)) depth += 1;
        else if (")]".includes(ch)) depth -= 1;
        else if (ch === "," && depth === 0) count += 1;
      }
      if (columns.length !== count)
        problems.push(
          `${file.pathname.split("/api/")[1]} → ${match[1]}：欄位 ${columns.length} 個、SELECT 運算式 ${count} 個`,
        );
    }
  }
  assert.deepEqual(problems, [], "INSERT ... SELECT 的欄位與運算式數量對不上");
});
