import * as XLSX from "xlsx";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".samples");
mkdirSync(dir, { recursive: true });
const out = (name) => join(dir, name);

const VEHICLES = ["機車", "小型車", "大貨車", "聯結車", "大客車"];
const hourLabel = (h) =>
  `${String(h).padStart(2, "0")}:00～${String((h + 1) % 24).padStart(2, "0")}:00`;

// 早尖峰 08 時、晚尖峰 18 時的日變化曲線
const SHAPE = [
  0.2, 0.12, 0.08, 0.07, 0.1, 0.25, 0.55, 0.9, 1.0, 0.8, 0.65, 0.6, 0.62, 0.6,
  0.58, 0.62, 0.75, 0.95, 1.15, 0.85, 0.6, 0.45, 0.35, 0.26,
];
const BASE = { 機車: 900, 小型車: 700, 大貨車: 60, 聯結車: 25, 大客車: 40 };

function seeded(n) {
  // 固定序列，讓每次產出的樣本檔完全一致，測試才可重現
  let x = n * 9301 + 49297;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280;
  };
}

function roadSheet(dayFactor, seed) {
  const rnd = seeded(seed);
  const rows = [
    ["OO縣道 全日交通量調查表"],
    ["方向", "往北", "", "", "", "", "往南", "", "", "", ""],
    ["時段", ...VEHICLES, ...VEHICLES],
  ];
  for (let h = 0; h < 24; h += 1) {
    const cells = [];
    for (let d = 0; d < 2; d += 1)
      for (const vehicle of VEHICLES)
        cells.push(
          Math.round(
            BASE[vehicle] * SHAPE[h] * dayFactor * (d ? 0.85 : 1) * (0.92 + rnd() * 0.16),
          ),
        );
    rows.push([hourLabel(h), ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

const roadBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(roadBook, roadSheet(1, 1), "平日");
XLSX.utils.book_append_sheet(roadBook, roadSheet(0.78, 2), "假日");
XLSX.writeFile(roadBook, out("115T1-01_中山路.xlsx"));

function intersectionSheet(dayFactor, seed) {
  const rnd = seeded(seed);
  const arms = ["A", "B", "C", "D"];
  const rows = [
    ["OO路口 全日轉向交通量調查表"],
    [
      "支線",
      ...arms.flatMap((arm) => [
        `駛出路口${arm}`,
        ...Array(VEHICLES.length * 3 - 1).fill(""),
      ]),
    ],
    ["時段", ...arms.flatMap(() => VEHICLES.flatMap((v) => [v, "", ""]))],
    ["", ...arms.flatMap(() => VEHICLES.flatMap(() => ["左轉", "直進", "右轉"]))],
  ];
  for (let h = 0; h < 24; h += 1) {
    const cells = [];
    for (let a = 0; a < arms.length; a += 1)
      for (const vehicle of VEHICLES) {
        const total =
          BASE[vehicle] * SHAPE[h] * dayFactor * (1 - a * 0.12) * (0.9 + rnd() * 0.2);
        cells.push(
          Math.round(total * 0.22),
          Math.round(total * 0.58),
          Math.round(total * 0.2),
        );
      }
    rows.push([hourLabel(h), ...cells]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

const crossBook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(crossBook, intersectionSheet(1, 3), "平日");
XLSX.utils.book_append_sheet(crossBook, intersectionSheet(0.8, 4), "假日");
XLSX.writeFile(crossBook, out("115T1-02_中正路口.xlsx"));

console.log("樣本檔已產生：.samples/115T1-01_中山路.xlsx、.samples/115T1-02_中正路口.xlsx");
