import * as XLSX from "xlsx";
import * as fs from "node:fs";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// SheetJS 0.20.x 的 ESM 版本不會自行綁定 Node.js 檔案系統；測試樣本輸出前
// 必須明確提供 fs，否則 writeFileSync 會回報「cannot save file」。
XLSX.set_fs(fs);

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".samples");
/*
 * 每次完整 E2E 都必須從同一批樣本開始。其他端對端腳本會在 .samples 裡
 * 追加自己的暫存檔；前一次執行若中斷，這些 ignored 檔案會留到下一次，
 * 讓 e2e-reimport 誤把第 3 個調查點一起匯入（實測由 288 筆變成 360 筆）。
 * .samples 是可重建的測試輸出，不含使用者附件；先清空再產生兩個基準檔，
 * 才能讓本機重跑與乾淨 CI checkout 得到相同結果。
 */
rmSync(dir, { recursive: true, force: true });
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
