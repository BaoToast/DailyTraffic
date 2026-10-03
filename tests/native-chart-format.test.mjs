import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("DashboardClient.tsx", readFileSync(new URL("../app/DashboardClient.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const chart = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "chartXml");
assert.ok(chart, "must exercise the actual production chart writer");
const code = ts.transpileModule(chart.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const chartXml = vm.runInNewContext(`${code}\nchartXml`, {
  VEHICLE_COLORS: ["#148C8C"],
  xmlText: value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;"),
});
const series = [{ name: "test", formula: "'test'!$B$2:$B$3", color: "148C8C", cache: [0.25, 0.5] }];

test("native ratio trend uses percent axis and cache formats, without changing values", () => {
  const xml = chartXml("test", "'test'!$A$2:$A$3", series, "line", "0.0%");
  assert.match(xml, /<c:numFmt formatCode="0\.0%" sourceLinked="0"/);
  assert.match(xml, /<c:formatCode>0\.0%<\/c:formatCode>/);
  assert.match(xml, /<c:v>0\.25<\/c:v>/);
  assert.match(xml, /<c:v>0\.5<\/c:v>/);
});
test("native line charts have visible connecting strokes, retaining blank-point gaps", () => {
  const xml = chartXml("test", "'test'!$A$2:$A$3", [{ ...series[0], cache: [1, null] }], "line");
  assert.match(xml, /<a:ln[^>]*><a:solidFill><a:srgbClr val="148C8C"/);
  assert.doesNotMatch(xml, /<a:ln[^>]*><a:noFill/);
  assert.match(xml, /<c:dispBlanksAs val="gap"/);
  assert.doesNotMatch(xml, /<c:pt idx="1">/);
});
test("native count bars preserve count formatting and borderless design", () => {
  const xml = chartXml("test", "'test'!$A$2:$A$3", series, "bar");
  assert.match(xml, /formatCode="#,##0\.0"/);
  assert.match(xml, /<a:ln><a:noFill/);
});

test("native doughnut uses legend and data table without cache-dependent inline labels", () => {
  const values = [52, 41, 4, 2, 1, 0];
  const xml = chartXml("test", "'test'!$A$2:$A$7", [{ ...series[0], cache: values }], "doughnut");
  assert.match(xml, /<c:showCatName val="0"/);
  assert.match(xml, /<c:showPercent val="0"/);
  assert.match(xml, /<c:showVal val="0"/);
  assert.doesNotMatch(xml, /<c:dLbl>/);
  assert.match(xml, /<c:legend>/);
  assert.doesNotMatch(xml, /dLblPos/);
  for (let index = 0; index < values.length; index += 1) {
    assert.ok(xml.includes(`<c:pt idx="${index}"><c:v>${values[index]}</c:v></c:pt>`));
  }
  const boundary = chartXml("test", "'test'!$A$2:$A$3", [{ ...series[0], cache: [5, 95] }], "doughnut");
  assert.match(boundary, /<c:showPercent val="0"/);
  assert.doesNotMatch(boundary, /<c:dLbl>/);
});
