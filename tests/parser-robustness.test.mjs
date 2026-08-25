import assert from "node:assert/strict";
import test from "node:test";
import { parseTrafficSheetValues } from "../app/traffic-parser.ts";

/*
 * 這一支釘住兩件事：原始檔的小地方不一樣時，不可以「靜靜少算」。
 * 兩個問題都曾經真實存在，而且不會有任何錯誤訊息。
 */

const identity = {
  roadId: "T-01",
  roadName: "測試調查點",
  a: "往北",
  b: "往南",
};
const VEHICLES = ["機車", "小型車", "大型車", "特種車"];

test("時段寫成單位數小時或 en dash 時不會整列被丟掉", () => {
  // 真實原始檔常見「8:00～9:00」，以及被 Word 自動改成 en dash 的
  //「09:00–10:00」。舊版只認兩位數小時與三種分隔符，其餘整列丟掉且不提示：
  // 實測 5 列 550 輛只讀進 110 輛。
  const labels = [
    "07:00～08:00",
    "8:00～9:00",
    "09:00–10:00",
    "10:00—11:00",
    "11:00至12:00",
  ];
  const values = [
    ["時間", ...VEHICLES],
    ...labels.map((hour) => [hour, 10, 20, 30, 50]),
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q1", identity);
  assert.equal(rows.length, labels.length, `應讀到 ${labels.length} 列`);
  const total = rows.reduce(
    (sum, row) => sum + row.motorcycle + row.small + row.large + row.special,
    0,
  );
  assert.equal(total, labels.length * 110, "每一列 110 輛都要算進來");
});

test("合併儲存格造成的重複車種標題會被當成左／直／右三欄，不是三個車種", () => {
  // 路口格式的車種標題常在三個轉向欄都留下同樣的文字。舊版把每一欄當成
  // 獨立車種：vehicleCounts 是直接指派所以只留最後一欄（少 54%），
  // 而且轉向切片只切到一格，全部被歸成左轉。
  const repeated = VEHICLES.flatMap((v) => [v, v, v]);
  const values = [
    ["方向", "路口A", ...Array(11).fill("")],
    ["時間", ...repeated],
    ["", ...VEHICLES.flatMap(() => ["左轉", "直進", "右轉"])],
    ["07:00～08:00", 10, 20, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  ];
  const rows = parseTrafficSheetValues(values, "平日", "115Q1", identity);
  assert.equal(rows.length, 1, "一個方向、一個時段＝一列");
  const row = rows[0];
  const total = row.motorcycle + row.small + row.large + row.special;
  assert.equal(total, 105, "四車種 × 左直右 = 105 輛，不是只取最後一欄的 48");
  const turns = row.turnData ?? {};
  const summed = Object.values(turns).reduce(
    (acc, t) => ({
      left: acc.left + (t?.left ?? 0),
      through: acc.through + (t?.through ?? 0),
      right: acc.right + (t?.right ?? 0),
    }),
    { left: 0, through: 0, right: 0 },
  );
  assert.ok(
    summed.through > 0 && summed.right > 0,
    `直行與右轉都不該是 0，實際 ${JSON.stringify(summed)}`,
  );
  assert.equal(
    summed.left + summed.through + summed.right,
    105,
    "左直右合計要等於總量",
  );
});

test("一般（未重複）的路口標題行為不變", () => {
  // 上面的修正不可以動到原本就正確的格式。
  const values = [
    ["方向", "路口A", "", "", ""],
    ["時間", ...VEHICLES],
    ["07:00～08:00", 10, 20, 30, 50],
  ];
  // 這一份沒有左轉／直進／右轉標記，是路段格式。
  const rows = parseTrafficSheetValues(values, "平日", "115Q1", identity);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].motorcycle + rows[0].small + rows[0].large + rows[0].special,
    110,
  );
});
