/*
 * 端對端：設定過的路口，之後每一季匯入不可以再跳「多支線角度、轉向圖與流向確認」。
 *
 * 起因（使用者回報）：第一季匯入時把路口的支線角度與流向設好之後，
 * 後面每一季匯入同一批路口，這個視窗還是每次都跳出來，而裡面沒有任何一項需要改。
 * 成因是舊寫法只看「這批資料裡有沒有路口」：
 *
 *     const importedIntersection = parsed.find(
 *       (record) => record.surveyType === "intersection",
 *     );
 *
 * 而角度與流向設定是存成（計畫、路口、支線）三層、**與季度無關**的，
 * 第一季設好之後每一季都沿用同一份，所以第二季以後那個視窗跳出來一定是白跳的。
 *
 * ⚠️ 為什麼一定要做這一支端對端：
 *    v20.55／v20.56 只用「單元測試 ＋ 原始碼接線檢查」驗過這件事，
 *    沒有真的在瀏覽器裡跑完兩輪匯入。純函式寫得再對、接線看起來也對，
 *    都還不等於「使用者第二季匯入時真的不會看到那個視窗」——
 *    中間還隔著 saveIntersectionSettings 有沒有真的把設定存下來、
 *    存的鍵值跟讀的鍵值是不是同一組。這一支把那段空白補起來。
 *
 * ⚠️ 假通過陷阱：
 *  一、第一輪如果沒有**真的按下「儲存設定」**，第二輪當然還會跳——
 *      那時測到的是「沒存所以會問」，不是程式壞掉。所以第一輪一定要按儲存。
 *  二、只驗「第二輪不跳」不夠：把視窗改成永遠不跳也會過。
 *      所以第一輪一定要先驗**它有跳**，第三輪再驗**新路口仍然會跳**。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".docx": "application/octet-stream",
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});

const problems = [];
const ok = (label, condition, detail = "") => {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label + (detail ? ` — ${detail}` : ""));
};

await new Promise((r) => server.listen(8098, r));
const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

await page.goto("http://localhost:8098/");
await page.waitForTimeout(900);

/* ── 建立計畫 ── */
await page.getByRole("button", { name: "＋" }).first().click().catch(() => {});
if (
  !(await page
    .locator(".modal input")
    .first()
    .isVisible()
    .catch(() => false))
) {
  await page
    .locator('button:has-text("建立第一個")')
    .first()
    .click()
    .catch(() => {});
}
await page.locator(".modal-backdrop .modal input").first().fill("路口視窗測試");
await page
  .locator('.modal-backdrop .modal button:has-text("建立")')
  .first()
  .click();
await page.waitForTimeout(800);

const GEOMETRY_MODAL = ".intersection-manager-modal";

/**
 * 匯入一個路口檔到指定季度，回傳「幾何確認視窗有沒有跳出來」。
 *
 * fileName 給的是實體樣本檔；uploadName 是上傳時用的檔名——
 * 第三輪要用不同檔名模擬「另一個新路口」。
 */
async function importIntersection({ quarter, fileName, uploadName }) {
  await page
    .locator('.toolbar button:has-text("匯入資料")')
    .first()
    .click();
  await page.waitForTimeout(500);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name: uploadName ?? fileName,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, fileName)),
    });
  await page.waitForTimeout(3000);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3500);
  }
  /* 車種管理視窗會先跳（依設計，關掉之後才輪到路口幾何） */
  const apply = page.locator(
    '.vehicle-class-modal button:has-text("套用車種設定")',
  );
  if (await apply.count()) {
    await apply.first().click();
    await page.waitForTimeout(900);
  }
  return (await page.locator(GEOMETRY_MODAL).count()) > 0;
}

/** 把幾何視窗按「儲存設定」關掉——這才會真的把設定存下來。 */
async function saveGeometry() {
  const save = page.locator(`${GEOMETRY_MODAL} button:has-text("儲存設定")`);
  if (!(await save.count())) return false;
  await save.first().click();
  await page.waitForTimeout(1200);
  return true;
}

/** 收掉還開著的任何對話框，讓下一輪從乾淨的畫面開始。 */
async function closeAnyModal() {
  for (let i = 0; i < 6 && (await page.locator(".modal-backdrop").count()); i += 1) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(500);
  }
}

/* ── 第一輪：第一次匯入這個路口，視窗應該要跳 ── */
const firstRound = await importIntersection({
  quarter: "115Q1",
  fileName: "115T1-02_中正路口.xlsx",
});
ok("第一季匯入新路口時，幾何確認視窗要跳出來", firstRound);

const saved = await saveGeometry();
ok("視窗上有「儲存設定」可以按（按下去才會真的存起來）", saved);
await closeAnyModal();

/*
 * 設定真的存進瀏覽器了嗎。存不進去的話第二輪本來就會再問，
 * 那時紅字的原因會是「沒存」而不是「程式沒改」，要分得開。
 */
const storedArms = await page.evaluate(() => {
  try {
    const raw = localStorage.getItem("traffic-intersection-settings-v1");
    return raw ? JSON.parse(raw).length : 0;
  } catch {
    return -1;
  }
});
ok(
  "按下「儲存設定」之後，支線設定要真的存進瀏覽器",
  storedArms > 0,
  `存了 ${storedArms} 支支線`,
);

/* ── 第二輪：同一個路口、不同季度，視窗不可以再跳 ── */
const secondRound = await importIntersection({
  quarter: "115Q2",
  fileName: "115T1-02_中正路口.xlsx",
});
ok(
  "第二季匯入同一個路口時，幾何確認視窗**不可以**再跳",
  secondRound === false,
  secondRound ? "又跳出來了" : "沒有跳",
);
await closeAnyModal();

/* ── 第三輪：換一個沒設定過的路口，視窗仍然要跳 ── */
/*
 * 用不同的檔名讓系統認成另一個路口。
 * 這一項是防「把視窗改成永遠不跳」的假通過：
 * 沒設定過的路口一定還是要問，否則會無聲套一個預設角度上去。
 */
const thirdRound = await importIntersection({
  quarter: "115Q3",
  fileName: "115T1-02_中正路口.xlsx",
  uploadName: "115T1-09_另一個新路口.xlsx",
});
ok(
  "換一個沒設定過的路口，視窗仍然要跳（不可以改成永遠不跳）",
  thirdRound,
  thirdRound ? "有跳" : "沒跳——可能被改成無條件不顯示",
);
await closeAnyModal();

ok("整段流程不可以留下未捕捉的例外", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
server.close();
console.log(problems.length ? `\n❌ ${problems.length} 項未通過` : "\n✅ 全部通過");
process.exit(problems.length ? 1 : 0);
