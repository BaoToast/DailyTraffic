/*
 * 同一版手冊在包裡的每一份副本，內容必須逐位元相同。
 *
 * ── 為什麼需要這一支 ──
 *
 * 手冊在包裡不只一份。以本包為例，同一個檔名同時存在於：
 *   ・建置來源（public/ 或 public/manuals/）——`build-pdf.mjs` 只寫這裡
 *   ・GitHub Pages 實際發布的位置（倉庫根目錄）——要另外複製過去
 *   ・建置產物（dist 與 github-pages 目錄）——建置時從來源複製
 *
 * 2026-09-03 清理手冊那一輪，實際發生的事情是：
 * 重新產生手冊只更新了 public/ 那一份，**根目錄那一份沒有跟著更新**，
 * 於是包裡同時存在新舊兩本手冊——而網站服務的是舊的那一本。
 * 當時根目錄的 PDF 還留著已經刪掉的「v2.1.0 已修正」等維護敘事，
 * 頁數也還停在清理前的數字。
 *
 * **原有的測試全部沒有抓到**：它們只確認 `public/` 底下檔案存在、
 * 檔名帶著本版版號、舊版號的檔案已刪除——每一項根目錄那份都通過，
 * 因為它的檔名一樣是本版版號，只是內容是舊的。
 * 「檔名對」不等於「內容對」，這一支補的就是這個缺口。
 *
 * ── 檢查方式 ──
 *
 * 掃出包裡所有符合本版檔名的手冊（自 2026-09-11 起只有 .pdf），
 * 逐一比對 SHA-256。只要有兩份不一樣就紅字，並印出各自的雜湊與位置。
 *
 * 注意：PDF 內嵌產生時間，所以「同樣的 HTML 產生兩次」也會得到不同位元組。
 * 這正是要求各副本必須來自**同一次產生**（用複製，不是各自重跑）的原因；
 * 各自重跑會踩紅這一支，那是刻意的——否則就分不出「重跑」與「忘了同步」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SYSTEM_VERSION } from "../app/system-release.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".git", ".next", ".turbo", ".wrangler"]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test("包裡每一份手冊副本都必須來自同一次產生", () => {
  /*
   * 檔名由版號的單一來源推導，不要寫死。
   * 寫死的話升版時得記得回來改這一支，忘了改就會變成
   *「找不到本版手冊」而不是「手冊沒同步」——訊息會把人帶往錯的方向。
   * basename() 而不是自己 split("/")：Windows 的路徑分隔是反斜線。
   */
  const base = `全日交通流量程式手冊_${SYSTEM_VERSION}`;
  const files = walk(ROOT).filter((f) => basename(f) === `${base}.pdf`);
  assert.ok(
    files.length > 0,
    "包裡找不到任何本版手冊——升版時可能忘了重新產生，或檔名對不上。",
  );

  /*
   * ── 份數與位置也要釘住（2026-09-25 第五輪獨立複查）──
   *
   * 原本只斷言「至少一份」與「所有副本雜湊相同」。少掉其中一份
   * （例如 `manuals/` 被漏掉，而網站正是從那裡取檔）這一支照樣綠。
   *
   * ⚠️⚠️ **必須存在的清單只能列「交付包裡本來就有的位置」。**
   *   第一版我把 `github-pages/dist/manuals/` 也列成必須——而 `pack.sh`
   *   **刻意排除 `github-pages/dist`**（那是建置產物），於是這一支在
   *   **正確的交付包上會紅**。當場被 F1 抓到。
   *   一個會誤報的守門比沒有守門更糟，所以改成兩層：
   *     ① 交付包一定有的兩個位置 → 無條件必須存在；
   *     ② 只有建置過才會有的位置（`github-pages/dist/`、`dist/client/`）
   *        → **存在才檢查**（目錄在就要有手冊），並印出為什麼跳過。
   *   兩層都靠上面的「全部同雜湊」兜底：只要那些副本出現，walk 就會掃到它們。
   */
  const found = new Set(files.map((f) => relative(ROOT, f).replace(/\\/g, "/")));
  for (const must of [`manuals/${base}.pdf`, `public/manuals/${base}.pdf`])
    assert.ok(
      found.has(must),
      `交付包裡少了這一份手冊：${must}\n`
        + `目前找到的是：\n  ${[...found].join("\n  ")}\n`
        + "（重新產生手冊之後，交付包裡的這兩個位置一定要一起換）",
    );
  for (const dir of ["github-pages/dist", "dist/client"]) {
    if (!existsSync(join(ROOT, dir))) {
      console.log(`（${dir}/ 不在這棵樹裡——那是建置產物，交付包刻意不含它，跳過）`);
      continue;
    }
    assert.ok(
      found.has(`${dir}/manuals/${base}.pdf`),
      `${dir}/ 存在，但底下沒有本版手冊：${dir}/manuals/${base}.pdf\n`
        + `目前找到的是：\n  ${[...found].join("\n  ")}`,
    );
  }

  const byHash = new Map();
  for (const f of files) {
    const hash = createHash("sha256").update(readFileSync(f)).digest("hex");
    const key = "pdf:" + hash;
    if (!byHash.has(key)) byHash.set(key, []);
    byHash.get(key).push(relative(ROOT, f));
  }

  /*
   * 同一種副檔名只能有一個雜湊。
   *
   * ⚠️ 2026-09-11 起只剩 PDF（使用者：「新手手冊只需要做 PDF 檔就好」），
   *   .docx 的產生器與檔案都已移除，所以這個迴圈只剩一種。
   *   保留迴圈的形狀是刻意的：哪天又多一種格式，加進這個陣列就好，
   *   不必重新想一次比對邏輯。
   */
  for (const kind of ["pdf"]) {
    const groups = [...byHash.entries()].filter(([k]) => k.startsWith(kind + ":"));
    assert.ok(groups.length > 0, `包裡缺少本版 ${kind} 手冊。`);
    if (groups.length <= 1) continue;
    const detail = groups
      .map(([k, list]) => `  ${k.slice(kind.length + 1, kind.length + 13)}…  ${list.join("、")}`)
      .join("\n");
    assert.fail(
      `包裡有 ${groups.length} 種不同內容的 ${kind} 手冊——代表某一份沒有跟著更新，\n` +
        `而網站服務的可能正是舊的那一份（檔名一樣，所以其他測試看不出來）。\n` +
        `重新產生手冊之後，請把 public/ 產出的那一份複製到其他每一個位置。\n` +
        detail,
    );
  }
});
