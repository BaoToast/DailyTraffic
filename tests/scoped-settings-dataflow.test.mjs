import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Inspect complete function bodies: the legacy .xls branch cannot satisfy
// guards for the independently assembled, formal .xlsx workbook.
const source = ts.createSourceFile(
  "DashboardClient.tsx",
  readFileSync(new URL("../app/DashboardClient.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);
const functions = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name)
    functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, visit);
}
visit(source);
function body(name) {
  const value = functions.get(name);
  assert.ok(value?.length > 100, `Missing complete function ${name}`);
  return value;
}

test("classification coefficient warning must not claim negative PCU is zeroed", () => {
  assert.doesNotMatch(body("saveVehicleClassSettings"), /該車種在 PCU 相關分析中會被歸零/);
  assert.match(body("saveVehicleClassSettings"), /負值不會自動歸零/);
});

test("threshold scopes travel in both single and all-project backup exports", () => {
  assert.match(body("buildBackupPayload"), /thresholdScopes: input\.thresholdScopes/);
  assert.match(body("exportBackup"), /thresholdScopes,/);
  assert.match(body("exportAllBackup"), /thresholdScopes: readProjectThresholdScopes\(project\.id\)/);
});

test("both restore routes validate and restore threshold scopes to the destination", () => {
  assert.match(body("restoreAllProjects"), /writeProjectThresholdScopes\(newId,/);
  assert.match(body("importBackup"), /writeProjectThresholdScopes\(targetProjectId,/);
  assert.match(body("importBackup"), /setThresholdScopes\(restoredThresholdScopes\)/);
  for (const name of ["restoreAllProjects", "importBackup"])
    assert.match(body(name), /filter\(isValidThresholdScope\)/);
});

test("formal xlsx exports classification warnings and the scoped mapping table", () => {
  const workbook = body("exportWorkbook");
  assert.match(workbook, /車種歸類提醒/);
  assert.match(workbook, /addWorksheet\("車種歸類設定"\)/);
  assert.match(workbook, /addWorksheet\("方向別車種組成"\)/);
  assert.match(workbook, /套用季別/);
  assert.match(workbook, /套用路段/);
});

test("long intervals are blocked before confirmations or writes", () => {
  const confirm = body("confirmPendingImport");
  const guard = confirm.indexOf("if (longIntervalMessage)");
  assert.ok(guard >= 0, "disabled button alone does not guard the write function");
  assert.ok(guard < confirm.indexOf("const confirmed = confirm("));
  assert.ok(guard < confirm.indexOf("setBusy(true)"));
});

test("the import report uses the same long-interval rule as the write guard", () => {
  const importer = body("importSelectedFiles");
  assert.match(importer, /longIntervalBlock\(parsed\)/);
  assert.doesNotMatch(importer, /minutes <= 60 \|\| minutes > 24 \* 60/);
});
