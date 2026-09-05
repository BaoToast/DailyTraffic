import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
const here=dirname(fileURLToPath(import.meta.url));
const ROOT=join(here,"..","github-pages","dist"), SAMPLES=join(here,"..",".samples");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png"};
const s=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split("?")[0]);if(p==="/")p="/index.html";const f=join(ROOT,p);if(!existsSync(f)||statSync(f).isDirectory())return void r.writeHead(404).end();r.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});r.end(readFileSync(f));});
await new Promise(r=>s.listen(8160,r));
const b=await chromium.launch(launchOptions());
const page=await (await b.newContext({viewport:{width:1500,height:1000},locale:"zh-TW"})).newPage();
page.on("dialog",d=>d.accept(""));
await page.goto("http://localhost:8160/");await page.waitForTimeout(1200);
await page.getByRole("button",{name:"＋"}).first().click().catch(()=>{});
if(!(await page.locator(".modal input").first().isVisible().catch(()=>false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(()=>{});
await page.locator(".modal-backdrop .modal input").first().fill("示範計畫");
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click();
await page.waitForTimeout(800);
for (const [f,q] of [["115T1-01_中山路.xlsx","115Q1"],["115T1-02_中正路口.xlsx","115Q1"]]) {
  await page.locator('.toolbar button:has-text("匯入資料")').first().click();await page.waitForTimeout(500);
  await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill(q);
  await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({name:f,mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",buffer:readFileSync(join(SAMPLES,f))});
  await page.waitForTimeout(3000);
  for (const t of ["確認","套用車種設定","關閉","取消"]) { const l=page.locator(`.modal-backdrop button:has-text("${t}")`); if(await l.count()){await l.first().click().catch(()=>{});await page.waitForTimeout(1600);} }
  for(let i=0;i<4&&await page.locator(".modal-backdrop").count();i++){const c=page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();if(!(await c.count()))break;await c.click().catch(()=>{});await page.waitForTimeout(400);}
}
await page.waitForTimeout(800);
for (const mode of ["平日","假日","平日＋假日"]) {
  const sel = page.locator('.table-panel:has(span:text("可追溯明細・路段格式")) select').nth(1);
  if (await sel.count()) {
    await sel.selectOption(mode).catch(()=>{});
    await page.waitForTimeout(900);
    const row = await page.evaluate(()=>{
      const panel=[...document.querySelectorAll(".table-panel")].find(p=>/路段格式/.test(p.textContent));
      if(!panel) return null;
      const ths=[...panel.querySelectorAll("thead th")].map(t=>t.textContent.trim());
      const tds=[...panel.querySelectorAll("tbody tr")].map(tr=>[...tr.children].map(td=>td.textContent.trim()));
      return {ths,tds};
    });
    console.log("日別="+mode, JSON.stringify(row&&row.ths.slice(0,8)), JSON.stringify(row&&row.tds.map(r=>r.slice(0,8))));
  }
}
const titles=await page.evaluate(()=>[...document.querySelectorAll(".table-panel .panel-title span")].map(x=>x.textContent.trim()));
console.log("明細表區塊：",JSON.stringify(titles));
const el=page.locator('.table-panel:has(span:text("可追溯明細・路段格式"))');
if (await el.count()) { await el.first().scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await el.first().screenshot({path:"/tmp/dt_detail.png"}); }
const el2=page.locator('.table-panel:has(span:text("可追溯明細・路口格式"))');
if (await el2.count()) { await el2.first().scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await el2.first().screenshot({path:"/tmp/dt_detail2.png"}); }
await b.close();s.close();
