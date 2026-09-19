import { chromium } from "playwright";
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions } from "../chrome-path.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "github-pages", "dist");
const MIME={".html":"text/html",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml",".png":"image/png"};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p==="/")p="/index.html";const f=join(ROOT,p);if(!existsSync(f)||statSync(f).isDirectory()){res.writeHead(404).end();return;}res.writeHead(200,{"content-type":MIME[extname(f)]??"application/octet-stream"});res.end(readFileSync(f));});
await new Promise(r=>server.listen(8197,r));
const b=await chromium.launch(launchOptions());
const page=await (await b.newContext({viewport:{width:1500,height:1000},locale:"zh-TW"})).newPage();
page.on("pageerror",e=>console.log("PAGEERROR",String(e.message).slice(0,200)));
await page.goto("http://localhost:8197/"); await page.waitForTimeout(1200);
console.log(await page.evaluate(() => {
  const js = [...document.querySelectorAll("script[src]")].map(s=>s.src).slice(0,2);
  return JSON.stringify({ js, hasWrapInHtml: document.documentElement.outerHTML.includes("trend-canvas-wrap") });
}));
const bundle = await page.evaluate(async () => {
  const src = [...document.querySelectorAll("script[src]")].map(s=>s.src)[0];
  const t = await (await fetch(src)).text();
  return { len: t.length, hasWrap: t.includes("trend-canvas-wrap"), hasLayer: t.includes("chart-value-layer") };
});
console.log(JSON.stringify(bundle));
await b.close(); server.close();
