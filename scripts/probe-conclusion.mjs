import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "./chrome-path.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "github-pages", "dist");
const SAMPLES = join(here, "..", ".samples");
const VH = Number(process.env.PROBE_VH || 900);
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png"};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/")p="/index.html";const f=join(ROOT,p);if(!existsSync(f)||statSync(f).isDirectory())return void res.writeHead(404).end();res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});res.end(readFileSync(f));});
await new Promise(r=>server.listen(8139,r));
const b=await chromium.launch(launchOptions());
const page=await (await b.newContext({viewport:{width:1440,height:VH},locale:"zh-TW"})).newPage();
page.on("dialog",d=>d.accept(""));
await page.goto("http://localhost:8139/");await page.waitForTimeout(1200);
await page.getByRole("button",{name:"＋"}).first().click().catch(()=>{});
if(!(await page.locator(".modal input").first().isVisible().catch(()=>false)))
  await page.locator('button:has-text("建立第一個")').first().click().catch(()=>{});
await page.locator(".modal-backdrop .modal input").first().fill("探測計畫").catch(()=>{});
await page.locator('.modal-backdrop .modal button:has-text("建立")').first().click().catch(()=>{});
await page.waitForTimeout(900);
// 匯入一份樣本
await page.locator('.toolbar button:has-text("匯入資料")').first().click();
await page.waitForTimeout(500);
await page.locator('.modal-backdrop .modal label:has-text("資料季度") input').fill("115Q1");
await page.locator('.modal-backdrop .modal input[type="file"][accept*=".xlsx"]').setInputFiles({
  name:"115T1-01_中山路.xlsx",
  mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  buffer: readFileSync(join(SAMPLES,"115T1-01_中山路.xlsx")),
});
await page.waitForTimeout(3000);
for (const t of ["確認","套用車種設定","關閉","取消"]) {
  const l=page.locator(`.modal-backdrop button:has-text("${t}")`);
  if (await l.count()) { await l.first().click().catch(()=>{}); await page.waitForTimeout(1800); }
}
for(let i=0;i<4&&await page.locator(".modal-backdrop").count();i++){
  const c=page.locator('.modal-backdrop button:has-text("關閉"), .modal-backdrop button:has-text("取消")').first();
  if(!(await c.count()))break; await c.click().catch(()=>{}); await page.waitForTimeout(400);
}
await page.waitForTimeout(800);
await page.locator('#conclusionStudio button:has-text("展開")').first().click().catch(()=>{});
await page.waitForTimeout(2500);
console.log("目前按鈕:", await page.evaluate(()=>[...document.querySelectorAll("button")].map(x=>(x.textContent||"").trim()).filter(Boolean).slice(0,60).join(" | ")));
console.log("有無 conclusion-body:", await page.locator(".conclusion-body").count(), " 明細列數:", await page.evaluate(()=>document.querySelectorAll("tbody tr").length));
const gen = page.locator(`button:has-text("產生草稿")`);
console.log("找到「產生草稿」按鈕:", await gen.count());
if (await gen.count()) {
  await gen.first().scrollIntoViewIfNeeded();
  await page.evaluate(()=>{const el=document.querySelector(".conclusion-body");if(el)el.scrollIntoView({block:"start"});});
  await page.waitForTimeout(300);
  const y0=await page.evaluate(()=>window.scrollY);
  await gen.first().click();
  await page.waitForTimeout(900);
  const m=await page.evaluate(()=>{
    const ta=document.querySelector('textarea[aria-label="結論草稿"]');
    if(!ta) return null;
    const r=ta.getBoundingClientRect();
    return {top:Math.round(r.top),vh:window.innerHeight,scrollY:window.scrollY,len:(ta.value||"").length};
  });
  const y1=await page.evaluate(()=>window.scrollY);
  console.log(JSON.stringify({...m, 自動捲動: y1!==y0}));
  console.log(m && m.top>m.vh ? "❌ 草稿框在畫面外" : "✅ 草稿框看得到");
}
await b.close();server.close();
