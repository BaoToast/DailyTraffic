import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
/*
 * ⚠️ 路徑一律由本檔位置推出來，**不寫死任何一台機器上的絕對路徑**。
 *   姊妹專案路口轉向的 `scripts/stress-drag.mjs` 就是因為寫死
 *   `/home/claude/work/turning/…`，換一台機器跑就直接讀不到檔而中斷
 *   （見該專案 CHANGELOG）。這一支原本犯的是同一個錯。
 *   ROOT 與樣本檔都可以用參數覆寫：
 *     node scripts/_shot.mjs <網站根目錄> <要匯入的 .xlsx>
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..");
const ROOT = process.argv[2] ?? join(PROJECT, "github-pages", "dist");
const SAMPLE =
  process.argv[3] ?? join(PROJECT, ".samples", "115T1-02_中正路口.xlsx");
if (!existsSync(ROOT))
  throw new Error(
    `找不到網站根目錄 ${ROOT}——請先執行 npm run build:pages，或用第一個參數指定。`,
  );
if (!existsSync(SAMPLE))
  throw new Error(
    `找不到樣本檔 ${SAMPLE}——請先執行 npm run samples，或用第二個參數指定。`,
  );
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/")p="/index.html";const f=join(ROOT,p);if(!existsSync(f)||statSync(f).isDirectory()){res.writeHead(404);res.end();return;}res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});res.end(readFileSync(f));});
await new Promise(r=>server.listen(8123,r));
const b=await chromium.launch(launchOptions());
const ctx=await b.newContext({viewport:{width:1500,height:1000},locale:"zh-TW"});
const page=await ctx.newPage();
page.on("dialog",d=>d.accept());
await page.goto("http://localhost:8123/");
await page.waitForTimeout(900);
await page.locator('button:has-text("建立第一個"), button[aria-label="建立新計畫"]').first().click().catch(()=>{});
await page.waitForTimeout(500);
await page.locator(".modal-backdrop .modal input").first().fill("版面檢查");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(700);
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(400);
await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q1");
await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({name:"115T1-02_中正路口.xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:readFileSync(SAMPLE)});
await page.waitForTimeout(2500);
const c=page.locator('.modal-backdrop button:has-text("確認")');
if(await c.count()){await c.first().click();await page.waitForTimeout(2500);}
for(let i=0;i<5&&(await page.locator(".modal-backdrop").count());i++){const x=page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消"), .modal-backdrop button:has-text("套用車種設定")').first();if(!(await x.count()))break;await x.click();await page.waitForTimeout(500);}
await page.locator(".pcu-settings").scrollIntoViewIfNeeded();
await page.locator(".pcu-settings").screenshot({path:"/tmp/pcu.png"});
/*
 * ⚠️ 2026-09-30 移除：原本這裡還會截 `.panel.road-chart` 到 /tmp/block.png，
 *   但那個元素**早就不存在了**（`DashboardClient.tsx` 0 處），版面改版之後
 *   「路段圖」不再是一個獨立的 .panel.road-chart 區塊。
 *
 *   留著的後果不是報錯，是 **scrollIntoViewIfNeeded() 一路等到逾時**——
 *   跑這一支的人只會看到它卡住，不會知道是選擇器過期了。
 *   這正是「探針指向不存在的東西」那一類問題：它不會變紅，只會安靜地壞掉。
 *
 *   `e2e-period.mjs:397` 的註解也記著同一件事（那邊已經先停用了）。
 */
await b.close();server.close();
console.log("ok");
