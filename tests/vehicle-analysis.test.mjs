import assert from "node:assert/strict";
import test from "node:test";
import { effectiveVehicleCounts, sumVehicleCounts, sumVehiclePcu, vehicleCatalog } from "../app/vehicle-analysis.ts";

const record = {
  projectId: "P1",
  motorcycle: 10,
  small: 20,
  large: 0,
  special: 0,
  surveyType: "road",
  vehicleCounts: {
    motorcycle: 10,
    small: 20,
    "custom:大貨車": 3,
    "custom:大客車": 4,
    "custom:聯結車": 5,
  },
  vehicleLabels: {
    motorcycle: "機車",
    small: "小型車",
    "custom:大貨車": "大貨車",
    "custom:大客車": "大客車",
    "custom:聯結車": "聯結車",
  },
};
const core = { motorcycle: 0.5, small: 1, large: 1.5, special: 2.5 };
const turns = Object.fromEntries(Object.keys(core).map(key => [key, { left: core[key], through: core[key], right: core[key] }]));
const independent = [
  ["大貨車", 2], ["大客車", 1.5], ["聯結車", 3],
].map(([label, factor]) => ({ projectId: "P1", sourceKey: `custom:${label}`, sourceLabel: label, targetKey: `custom:${label}`, targetLabel: label, roadPcu: factor, turnPcu: { left: factor, through: factor, right: factor } }));

test("五個原始車種可全部獨立分析且總量守恆", () => {
  assert.equal(sumVehicleCounts(record), 42);
  assert.deepEqual(vehicleCatalog([record], independent, false).map(item => item.label), ["機車", "小型車", "大客車", "大貨車", "聯結車"]);
  assert.equal(Object.values(effectiveVehicleCounts(record, independent)).reduce((sum, value) => sum + value, 0), 42);
  assert.equal(sumVehiclePcu(record, core, turns, independent), 52);
});

test("新增車種可合併回四大類且不改寫原始數量", () => {
  const merged = [
    { ...independent[0], targetKey: "special", targetLabel: "特種車" },
    { ...independent[1], targetKey: "large", targetLabel: "大型車" },
    { ...independent[2], targetKey: "special", targetLabel: "特種車" },
  ];
  assert.deepEqual(effectiveVehicleCounts(record, merged), { motorcycle: 10, small: 20, special: 8, large: 4 });
  assert.deepEqual(vehicleCatalog([record], merged, false).map(item => item.label), ["機車", "小型車", "大型車", "特種車"]);
  assert.equal(sumVehicleCounts(record), 42);
  assert.equal(sumVehiclePcu(record, core, turns, merged), 51);
});

test("外部PCU係數改動後，歸類到四大類的鎖定列會同步顯示同一數值", async () => {
  const { syncCoreVehicleSettings } = await import("../app/vehicle-analysis.ts");
  const settings = [
    // 原四大類：機車列。快照停在舊的 0.5
    { projectId: "P1", sourceKey: "motorcycle", sourceLabel: "機車", targetKey: "motorcycle", targetLabel: "機車", roadPcu: 0.5, turnPcu: { through: 0.3, right: 0.4, left: 0.5 } },
    // 新增車種但已歸類回小型車，同樣要跟著外部係數走
    { projectId: "P1", sourceKey: "custom:大貨車", sourceLabel: "大貨車", targetKey: "small", targetLabel: "小型車", roadPcu: 1, turnPcu: { through: 1, right: 1.3, left: 1.5 } },
    // 獨立車種：不可被覆蓋
    { projectId: "P1", sourceKey: "custom:聯結車", sourceLabel: "聯結車", targetKey: "custom:聯結車", targetLabel: "聯結車", roadPcu: 3, turnPcu: { through: 3, right: 3, left: 3 } },
  ];
  const nextCore = { motorcycle: 0.42, small: 1.1, large: 1.5, special: 2.5 };
  const nextTurns = {
    motorcycle: { through: 0.42, right: 0.45, left: 0.43 },
    small: { through: 1, right: 1.08, left: 1.05 },
    large: { through: 1.8, right: 2.7, left: 2 },
    special: { through: 2, right: 2.3, left: 2.5 },
  };
  const synced = syncCoreVehicleSettings(settings, nextCore, nextTurns);
  assert.equal(synced[0].roadPcu, 0.42);
  assert.deepEqual(synced[0].turnPcu, { through: 0.42, right: 0.45, left: 0.43 });
  assert.equal(synced[1].roadPcu, 1.1);
  assert.deepEqual(synced[1].turnPcu, { through: 1, right: 1.08, left: 1.05 });
  assert.equal(synced[2].roadPcu, 3);
  assert.equal(synced[2], settings[2], "沒變動的列要維持同一個物件參考，避免多餘重繪");
  // 計算結果與顯示值一致
  assert.equal(sumVehiclePcu({ projectId: "P1", motorcycle: 100, small: 0, large: 0, special: 0, surveyType: "road" }, nextCore, nextTurns, synced), 42);
});
