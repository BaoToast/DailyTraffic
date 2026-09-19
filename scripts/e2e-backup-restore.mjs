/*
 * ══════════════════════════════════════════════════════════════════════
 *  備份與還原：三件事各在哪、按了會發生什麼、資料有沒有原封不動回來
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-11（同一件事講了三次）：
 *   「向全日交通量 點一下立刻就下載 有點措手不及，希望像路口轉向程式，
 *     點進去後很直白的知道，我可以匯出單一計畫作備份、匯出這程式下面我
 *     全部計畫作備份，以及也能在這邊匯入備份檔作還原。」
 *   「我希望三個程式 在匯入檔案那邊，就是很乾淨的讓使用者匯入檔案用，
 *     不用兼具匯入還原檔案」
 *   「甚至在備分還原下方新增 這三個功能的名稱，使用者點哪個功能的名稱，
 *     那個功能的卡片邊框 也能像前面說的那樣 變顯眼」
 *
 * 這支釘住五件事：
 *   ① 側欄那三項點下去**不會產生任何下載**（舊版是點一下當場打包）
 *   ② 三張卡片都在，抬頭與側欄項目是同一個詞
 *   ③「匯入調查資料」視窗裡**沒有**還原備份的入口了
 *   ④「備份全部計畫」的檔案裡，每一個計畫的資料都是**該計畫自己的**
 *   ⑤ 把那份檔案還原回去，計畫數與每個計畫的紀錄筆數完全對得上
 *
 * ⚠️ ④⑤ 是這支真正的重點，不是版面。
 *   「備份全部計畫」是新寫的，而它最容易錯的地方是**只包到目前那個計畫
 *   的資料**——畫面上的 records／roadAliases／workflow 都只載入目前計畫。
 *   那種錯的檔案大小看起來正常、還原也不會報錯，要等到換電腦打開才發現
 *   別的計畫是空的。所以一定要建**兩個內容不同的計畫**再驗。
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
import { gotoBlock } from "./e2e-nav.mjs";

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
};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = join(ROOT, p);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[extname(f)] ?? "application/octet-stream",
  });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(8191, r));

const problems = [];
const failOnly = (text) => ({ failOnly: text });
const ok = (label, condition, detail = "") => {
  const text =
    detail && typeof detail === "object"
      ? condition
        ? ""
        : detail.failOnly
      : detail;
  console.log(`${condition ? "✅" : "❌"} ${label}${text ? ` — ${text}` : ""}`);
  if (!condition) problems.push(label + (text ? ` — ${text}` : ""));
};

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  locale: "zh-TW",
  acceptDownloads: true,
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
page.on("dialog", (d) => d.accept(d.type() === "prompt" ? "N" : ""));

/* 每一次下載都記下來——①要證明「沒有下載」，④要拿到檔案內容。 */
const downloads = [];
page.on("download", (d) => downloads.push(d));

await page.goto("http://localhost:8191/");
await page.waitForTimeout(900);

async function newProject(name) {
  await page
    .getByRole("button", { name: "＋" })
    .first()
    .click()
    .catch(() => {});
  if (
    !(await page
      .locator(".modal input")
      .first()
      .isVisible()
      .catch(() => false))
  )
    await page
      .locator('button:has-text("建立第一個")')
      .first()
      .click()
      .catch(() => {});
  await page.locator(".modal-backdrop .modal input").first().fill(name);
  await page
    .locator('.modal-backdrop .modal button:has-text("建立")')
    .first()
    .click();
  await page.waitForTimeout(800);
}

/*
 * ⚠️ 匯入流程照抄 e2e-chart-layout.mjs 的寫法，不要自己簡化。
 *   簡化版曾經在車種設定視窗按到「取消」，結果整份資料 0 筆，
 *   而測試還是綠的（它只檢查「沒有例外」）。
 */
async function importSample(name, quarter) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();
  await page.waitForTimeout(400);
  await page
    .locator('.modal-backdrop .modal label:has-text("資料季度") input')
    .fill(quarter);
  await page
    .locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]')
    .setInputFiles({
      name,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: readFileSync(join(SAMPLES, name)),
    });
  await page.waitForTimeout(2500);
  const confirm = page.locator('.modal-backdrop button:has-text("確認")');
  if (await confirm.count()) {
    await confirm.first().click();
    await page.waitForTimeout(3000);
  }
  for (
    let i = 0;
    i < 5 && (await page.locator(".modal-backdrop").count());
    i += 1
  ) {
    const closer = page
      .locator(
        '.modal-backdrop button:has-text("套用車種設定"), .modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")',
      )
      .first();
    if (!(await closer.count())) break;
    await closer.click();
    await page.waitForTimeout(500);
  }
}

/* ── 前置：兩個內容**不同**的計畫 ─────────────────────────── */
await newProject("備份測試甲");
await importSample("115T1-01_中山路.xlsx", "115Q1");
await newProject("備份測試乙");
await importSample("115T1-02_中正路口.xlsx", "115Q2");

/*
 * ══════════════════════════════════════════════════════════════════
 *  ③ 匯入調查資料的視窗裡不可以再有「還原備份」
 * ══════════════════════════════════════════════════════════════════
 */
console.log("\n══ ③ 匯入資料視窗只做匯入，不兼做還原 ══");
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
const importModal = await page.evaluate(() => {
  const modal = document.querySelector(".modal-backdrop .modal");
  if (!modal) return null;
  return {
    excelInputs: modal.querySelectorAll('input[accept*=".xlsx"]').length,
    jsonInputs: modal.querySelectorAll('input[accept*=".json"]').length,
    text: (modal.textContent || "").replace(/\s+/g, ""),
  };
});
ok("前置：匯入視窗開得起來", Boolean(importModal));
if (importModal) {
  ok(
    "還是收得了 Excel 調查檔（沒有把該有的功能一起拿掉）",
    importModal.excelInputs > 0,
    `${importModal.excelInputs} 個 Excel 選檔欄`,
  );
  ok(
    "視窗裡沒有任何還原備份的選檔欄了",
    importModal.jsonInputs === 0,
    failOnly(`還有 ${importModal.jsonInputs} 個 JSON 選檔欄`),
  );
  ok(
    "視窗裡也沒有「還原完整備份」這種字樣",
    !importModal.text.includes("還原完整備份"),
    failOnly("文字裡還留著「還原完整備份」"),
  );
}
await page
  .locator('.modal-backdrop button:has-text("關閉")')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(400);

/*
 * ══════════════════════════════════════════════════════════════════
 *  ① 側欄那三項點下去不可以產生下載
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 這一條是使用者原話的直譯：「點一下立刻就下載 有點措手不及」。
 *   驗的是**沒有發生什麼**，所以一定要先確認「這個測試抓得到下載」，
 *   否則整條是恆綠的——最後面第 ④ 段真的按下載鈕，就是那個反面證據。
 */
console.log("\n══ ① 側欄的備份項目點下去不會當場產檔 ══");
await gotoBlock(page, "backup-one");
downloads.length = 0;
for (const label of ["備份本計畫", "備份全部計畫", "還原計畫"]) {
  const item = page.locator(`.side-nav-item[data-goto-item="${label}"]`);
  ok(`側欄有「${label}」這一項`, (await item.count()) > 0);
  if (await item.count()) {
    await item.first().click();
    await page.waitForTimeout(600);
  }
}
ok(
  "點過三項之後，一個檔案都沒有被下載",
  downloads.length === 0,
  failOnly(`竟然下載了 ${downloads.length} 個檔案`),
);

/*
 * ══════════════════════════════════════════════════════════════════
 *  ② 三張卡片在，抬頭與側欄用同一個詞
 * ══════════════════════════════════════════════════════════════════
 */
console.log("\n══ ② 三張卡片與側欄用同一個詞 ══");
const cards = await page.evaluate(() =>
  ["backup-one", "backup-all", "backup-restore"].map((id) => {
    const el = document.getElementById(id);
    return {
      id,
      exists: Boolean(el),
      heading: el?.querySelector("h3")?.textContent?.trim() || "",
    };
  }),
);
for (const [index, label] of ["備份本計畫", "備份全部計畫", "還原計畫"].entries())
  ok(
    `卡片 #${cards[index].id} 的抬頭就是「${label}」`,
    cards[index].exists && cards[index].heading === label,
    `實際抬頭「${cards[index].heading}」`,
  );

/*
 * ══════════════════════════════════════════════════════════════════
 *  ④ 「備份全部計畫」的檔案裡，每個計畫帶的是自己的資料
 * ══════════════════════════════════════════════════════════════════
 */
console.log("\n══ ④ 全部計畫的備份檔內容 ══");
downloads.length = 0;
await page
  .locator('#backup-all button:has-text("下載全部計畫備份")')
  .first()
  .click();
await page.waitForTimeout(3500);
ok(
  "按「下載全部計畫備份」真的產生了檔案（也證明上面①抓得到下載）",
  downloads.length === 1,
  `${downloads.length} 個檔案`,
);
let bundle = null;
if (downloads.length === 1) {
  const path = await downloads[0].path();
  bundle = JSON.parse(readFileSync(path, "utf8"));
  ok(
    "檔案格式標成「全部計畫」",
    bundle.format === "traffic-analysis-backup-all",
    `format=${bundle.format}`,
  );
  ok(
    "兩個計畫都在檔案裡",
    Array.isArray(bundle.projects) && bundle.projects.length === 2,
    `${bundle.projects?.length} 個`,
  );
  if (bundle.projects?.length === 2) {
    const byName = Object.fromEntries(
      bundle.projects.map((p) => [p.project?.name, p]),
    );
    ok(
      "計畫名稱對得上",
      Boolean(byName["備份測試甲"] && byName["備份測試乙"]),
      Object.keys(byName).join("、"),
    );
    /*
     * ⚠️ 這一條才是這支測試存在的理由。
     *   畫面上的 records 只載入「目前這個計畫」——如果備份是直接拿畫面上的
     *   state 去包，非目前計畫那一份就會是 0 筆，或者兩份會一模一樣。
     *   兩種錯都不會噴例外，只有比對內容才抓得到。
     */
    const a = byName["備份測試甲"];
    const b = byName["備份測試乙"];
    ok(
      "每個計畫都有自己的紀錄（不是只有目前那一個有）",
      a?.records?.length > 0 && b?.records?.length > 0,
      `甲 ${a?.records?.length} 筆、乙 ${b?.records?.length} 筆`,
    );
    const quartersOf = (p) => [...new Set((p.records || []).map((r) => r.quarter))];
    ok(
      "兩個計畫帶的是各自的季度，沒有互相混到",
      JSON.stringify(quartersOf(a)) === JSON.stringify(["115Q1"]) &&
        JSON.stringify(quartersOf(b)) === JSON.stringify(["115Q2"]),
      `甲 ${quartersOf(a).join("、")}／乙 ${quartersOf(b).join("、")}`,
    );
    ok(
      "兩份內容不相同（相同就代表兩份都是同一個計畫的複本）",
      JSON.stringify(a.records) !== JSON.stringify(b.records),
      failOnly("兩個計畫的 records 一模一樣"),
    );
  }
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  ⑤ 還原回去，計畫數與筆數對得上
 * ══════════════════════════════════════════════════════════════════
 *
 * 還原是「新增」不是「取代」，所以還原之後應該有 2+2=4 個計畫，
 * 而新增的兩個名稱會帶上還原日期以便分辨。
 */
console.log("\n══ ⑤ 還原全部計畫 ══");
if (bundle) {
  const before = await page.evaluate(
    () => document.querySelectorAll("#projectSwitch option").length,
  );
  await page
    .locator('#backup-restore input[type="file"]')
    .setInputFiles({
      name: "全部計畫備份.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(bundle), "utf8"),
    });
  /* 還原完成後程式會重新整理畫面，等它回來 */
  await page.waitForTimeout(9000);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll("#projectSwitch option")].map((o) =>
      o.textContent.trim(),
    ),
  );
  ok(
    "還原是「新增」：原本的計畫一個都沒有不見",
    after.some((n) => n.includes("備份測試甲")) &&
      after.some((n) => n.includes("備份測試乙")),
    after.join("、"),
  );
  ok(
    `計畫數從 ${before} 變成 ${before + 2}（兩個計畫各新增一份）`,
    after.length === before + 2,
    `現在 ${after.length} 個：${after.join("、")}`,
  );
  ok(
    "同名的還原計畫有加上日期以便分辨",
    after.filter((n) => n.includes("還原")).length === 2,
    after.join("、"),
  );
}

/*
 * ══════════════════════════════════════════════════════════════════
 *  ⑥ 還原進去的資料要與原本**逐筆相同**
 * ══════════════════════════════════════════════════════════════════
 *
 * ⚠️ 第 ⑤ 段只證明「多了兩個計畫」，沒有證明「裡面的資料是對的」。
 *   計畫建起來了但一筆資料都沒寫進去，⑤ 一樣全綠——那正是備份功能
 *   最不能出的錯：使用者以為救回來了，其實是空的。
 *
 * 驗法是再匯出一次「全部計畫」，拿還原出來的那一份與原本那一份逐筆比對。
 * 這樣連「寫進去但值被改掉」也抓得到，而且不必知道內部怎麼存的。
 */
console.log("\n══ ⑥ 還原回來的資料要逐筆相同 ══");
if (bundle) {
  await gotoBlock(page, "backup-all");
  await page.waitForTimeout(600);
  downloads.length = 0;
  await page
    .locator('#backup-all button:has-text("下載全部計畫備份")')
    .first()
    .click();
  await page.waitForTimeout(4500);
  ok("重新匯出一次全部計畫", downloads.length === 1, `${downloads.length} 個檔案`);
  if (downloads.length === 1) {
    const again = JSON.parse(readFileSync(await downloads[0].path(), "utf8"));
    ok(
      "現在檔案裡有 4 個計畫",
      again.projects?.length === 4,
      `${again.projects?.length} 個`,
    );
    /* 只比資料本身，不比計畫名稱與匯出時間（那兩個本來就該不同）。 */
    const bodyOf = (p) =>
      JSON.stringify({
        records: p.records,
        pcuFactors: p.pcuFactors,
        turnPcuFactors: p.turnPcuFactors,
        pcuScopes: p.pcuScopes,
        roadAliases: (p.roadAliases || []).map((x) => [x.roadId, x.aliasName]),
        vehicleClassSettings: p.vehicleClassSettings,
        intersectionSettings: p.intersectionSettings,
      });
    for (const base of ["備份測試甲", "備份測試乙"]) {
      const original = again.projects?.find((p) => p.project?.name === base);
      const copy = again.projects?.find(
        (p) => p.project?.name?.startsWith(base) && p.project?.name !== base,
      );
      ok(
        `「${base}」與它的還原副本都找得到`,
        Boolean(original && copy),
        `原 ${original ? "有" : "無"}／副本 ${copy?.project?.name || "無"}`,
      );
      if (original && copy) {
        ok(
          `「${base}」的紀錄筆數還原後相同`,
          original.records?.length === copy.records?.length &&
            original.records?.length > 0,
          `原 ${original.records?.length} 筆、還原 ${copy.records?.length} 筆`,
        );
        ok(
          `「${base}」的資料內容還原後逐筆相同`,
          bodyOf(original) === bodyOf(copy),
          failOnly(
            "內容有差異——備份或還原其中一條路徑漏帶了東西：" +
              [
                "records",
                "pcuFactors",
                "turnPcuFactors",
                "pcuScopes",
                "roadAliases",
                "vehicleClassSettings",
                "intersectionSettings",
              ]
                .filter(
                  (k) =>
                    JSON.stringify(original[k]) !== JSON.stringify(copy[k]),
                )
                .map(
                  (k) =>
                    `${k}（原 ${JSON.stringify(original[k]).slice(0, 160)} ／ 還原 ${JSON.stringify(copy[k]).slice(0, 160)}）`,
                )
                .join("；"),
          ),
        );
      }
    }
  }
}

ok("整段沒有 JS 例外", errors.length === 0, failOnly(errors.join(" | ")));

await browser.close();
server.close();
if (problems.length) {
  console.error(`\n❌ ${problems.length} 項不合格：`);
  for (const p of problems) console.error("  ・" + p);
  process.exit(1);
}
console.log("\n✅ 備份與還原全部合格");
