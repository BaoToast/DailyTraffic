/* 手冊封面、檔名一致仍可能遺漏HTML／PDF內部標題；兩種標題分開守門。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const release=readFileSync(new URL('../app/system-release.ts',import.meta.url),'utf8');
const version=/SYSTEM_VERSION = "([^"]+)"/.exec(release)[1];
const expected=`全日交通量及車種組成 新手使用說明手冊 ${version}`;
test('手冊HTML title須為本版正式名稱及版號',()=>{
 const html=readFileSync(new URL('../scripts/manual/manual.html',import.meta.url),'utf8');
 assert.equal(/<title>([^<]+)<\/title>/.exec(html)[1],expected);
});
test('正式PDF內部Title須為本版正式名稱及版號',(t)=>{
 const pdf=fileURLToPath(new URL(`../manuals/全日交通流量程式手冊_${version}.pdf`,import.meta.url));
 const info=spawnSync('pdfinfo',[pdf],{encoding:'utf8'});
 if(info.error?.code==='ENOENT'){t.skip('缺pdfinfo；PDF內部Title未驗證，HTML仍另行守門');return;}
 assert.equal(info.status,0,info.stderr);
 assert.equal(/^Title:\s*(.+)$/m.exec(info.stdout)?.[1].trim(),expected);
});
