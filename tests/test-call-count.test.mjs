/* 計數反證涵蓋字串內的註解符號、假test文字，以及本輪實際三項守門。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {countTestCalls} from '../scripts/test-call-count.mjs';
test('字串中的scripts/*.mjs不可以吞掉真正test呼叫',()=>{
 const fixture='test("scripts/*.mjs",()=>{});\n/* normal comment */\ntest("two",()=>{});\ntest("three",()=>{});';
 assert.equal(countTestCalls(fixture),3);
});
test('字串、正規式、註解中的假test呼叫不計入',()=>{
 const fixture=String.raw`const fake="test('not real')"; const pattern=/test\(/;
/* test("fake") */
// test("fake")
test("real",()=>{});`;
 assert.equal(countTestCalls(fixture),1);
});
test('實際script-header-usage守門包含三項，不能誤數成二項',()=>{
 const source=readFileSync(new URL('./script-header-usage.test.mjs',import.meta.url),'utf8');
 assert.equal(countTestCalls(source),3);
});
