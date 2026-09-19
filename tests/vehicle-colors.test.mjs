/*
 * ══════════════════════════════════════════════════════════════════════
 *  車種顏色：相鄰兩個車種一定要分得出來（自己重算，不信任當初的挑色）
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-14（附圓環圖）：
 *   「機車 和 大型車 顏色過於接近，請將各車種（包含未來新增的車種）
 *     顏色之間的差異對比要明顯一點」
 *
 * ⚠️ 使用者那句話的重點在括號裡：「**包含未來新增的車種**」。
 *   所以這件事不能靠「這次挑了一組比較好的顏色」解決——
 *   要有一支測試，日後任何人動到那份色表、或往後面加顏色時，
 *   會自己重算一次並在不合格時變紅。
 *
 * ── 這裡算的是什麼 ────────────────────────────────────────────
 *
 * 把色碼轉成 OKLab（一個「數值距離 ≈ 肉眼感覺差異」的色彩空間），
 * 然後算兩件事：
 *   ①一般視覺下的色差
 *   ②**紅綠色盲（deuteranopia）模擬後**的色差
 * ②才是關鍵：舊的 機車 #148C8C ↔ 大型車 #5B8DB8 在一般視覺下看起來
 * 還有點差別，但紅綠色盲視角下色差只有 6.4——而台灣男性約 8% 有紅綠色弱。
 *
 * 另外算 ③每個顏色與白底的對比（太淺的顏色在白底上根本看不見，
 * 舊色表裡的 #D8E7F1 只有 1.23:1）。
 *
 * ⚠️ 誠實交代這支測試**不**檢查什麼：它只檢查**相鄰**的配對。
 *   十個類別要兩兩之間都分得開是做不到的（顏色空間就這麼大）。
 *   類別多到那個程度時，顏色撐不住識別，一定要有第二個線索——
 *   本系統是圓環圖旁邊一律列出「色塊＋車種名稱＋數量＋百分比」。
 *   所以下面有一條專門釘住「圖例不可以被拿掉」。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "app", "vehicle-colors.ts"), "utf8");

/*
 * ⚠️ 只能取 VEHICLE_COLORS 那一段，不可以掃整個檔案。
 *
 *   第一版寫成「掃全檔的 #XXXXXX」，後來同一個檔案裡多了 TURN_COLORS
 *  （轉向圖的三個顏色，刻意和車種色表共用同一個檔案好維護），
 *   掃描就把那三個也算進來，於是「色表沒有重複的顏色」當場變紅——
 *   而車種色表本身一個重複都沒有。**測試自己抓錯東西，比沒測試更浪費時間。**
 */
const block = source.slice(
  source.indexOf("export const VEHICLE_COLORS = ["),
  source.indexOf("] as const;"),
);
const colors = [...block.matchAll(/"(#[0-9A-Fa-f]{6})"/g)].map(
  (match) => match[1],
);

test("前置：讀得到色表（讀到 0 個就是恆真）", () => {
  assert.ok(colors.length >= 4, `只讀到 ${colors.length} 個顏色`);
});

/* ── 色彩換算（都是標準公式，沒有自訂的魔術數字） ───────────────── */

function toLinear(value) {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function rgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
/*
 * 色盲模擬：Machado, Oliveira & Fernandes (2009) 在「嚴重度 1.0」的轉換矩陣，
 * 作用在**線性** RGB 上。
 *
 * ⚠️ 這裡刻意用這一組矩陣，而不是我自己推的近似式。第一版我用了另一種
 *   常見的近似（Viénot-1999 型），算出來說「新配色比舊配色更糟」，
 *   和標準工具算出來的結論**完全相反**（標準工具：舊 6.4 → 新 19.2）。
 *   模擬模型不是實作細節，換一個模型就要重新校準門檻，
 *   所以門檻（8.0）與模型必須配成一套。自己推的算式不可信，已丟棄。
 */
const MACHADO_DEUTAN = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
function linOf(hex) {
  return rgb(hex).map(toLinear);
}
function oklabFromLin([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function simulateDeutan(hex) {
  const [r, g, b] = linOf(hex);
  const clamp = (value) => Math.max(0, Math.min(1, value));
  return MACHADO_DEUTAN.map((row) =>
    clamp(row[0] * r + row[1] * g + row[2] * b),
  );
}
/** OKLab 距離 ×100，和 dataviz 守則用的是同一個尺度。 */
function deltaE(a, b, cvd) {
  const x = oklabFromLin(cvd ? simulateDeutan(a) : linOf(a));
  const y = oklabFromLin(cvd ? simulateDeutan(b) : linOf(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
/** WCAG 相對亮度與對比。 */
function luminance(hex) {
  const [r, g, b] = rgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/*
 * ⚠️ 前置：先證明這套算式**真的抓得出**使用者回報的那一對。
 *   沒有這一條的話，算式寫錯（例如常數抄錯、恆回傳大數字）時，
 *   下面每一條都會輕鬆通過，而測試看起來一片綠。
 */
test("前置：算式真的抓得出使用者回報的舊配對（機車 #148C8C ↔ 大型車 #5B8DB8）", () => {
  const before = deltaE("#148C8C", "#5B8DB8", true);
  const after = deltaE("#008C80", "#2C4FA8", true);
  assert.ok(
    before < 8,
    `舊的那一對算出來是 ${before.toFixed(1)}，應該要低於門檻 8（使用者說「過於接近」）。` +
      "算出來很大就代表這套算式有問題，下面每一條都會變成恆真。",
  );
  assert.ok(
    after > before * 2,
    `修正後那一對是 ${after.toFixed(1)}、修正前是 ${before.toFixed(1)}——` +
      "沒有明顯拉開就代表這次的換色沒有解決使用者回報的問題。",
  );
});

/*
 * ⚠️ 這裡驗的是「**前 6 個兩兩之間**」，不是只驗相鄰。
 *
 *   第一版寫成只驗相鄰，反面測試（把第 3 個換回舊的 #5B8DB8）**照樣全綠**
 *   ——因為使用者回報的那一對是「第 1 個（機車）與第 3 個（大型車）」，
 *   它們根本不相鄰。也就是說，那一版的守門**擋不住當初害它誕生的那個 bug**。
 *   這是最糟的一種守門：看起來在守，其實對真正發生過的事免疫。
 *
 *   為什麼界線畫在 6：這份色表有 10 個位置，但十個類別要兩兩都分得開是
 *   做不到的（顏色空間就這麼大）。實務上車種是 4～6 種，所以前 6 個用最嚴的
 *   「兩兩之間」，第 7 個以後退回「相鄰」。這是有意識畫的界線，
 *   不是因為剛好通過才這樣寫。
 */
const STRICT = 6;
function pairsOf(list, strict) {
  const out = [];
  for (let i = 0; i < list.length; i += 1)
    for (let j = i + 1; j < list.length; j += 1)
      if (j <= strict - 1 || j === i + 1) out.push([i, j]);
  return out;
}

test("（僅記錄，不擋）紅綠色盲視角下的最差配對是多少", () => {
  /*
   * ⚠️ 這一條**故意不擋**，只把數字印出來，而且理由要寫清楚：
   *
   *   使用者 2026-09-14 的明確指示：
   *     「因為剛好大型車色塊很小，顏色很接近，**不需要考慮色盲分不分的出來**，
   *       各車種（含未來可能出現的各種車種）顏色差異性是否能明顯的，
   *       然後圖例一樣在圖旁」
   *
   *   我原本挑的是色盲友善的 Okabe–Ito 標準色盤，色盲最差 7.6、
   *   但一般視覺最差只有 15.6；改成以一般視覺最大化為目標之後，
   *   一般視覺最差提升到 18.2，色盲視角則變差。
   *   **這是使用者知情後的取捨**，所以這裡不擋，只留下數字，
   *   讓日後有人問「為什麼色盲分不出來」時看得到當初的決定與代價。
   *
   *   ⚠️ 不可以因為「反正不擋」就把這一條刪掉：刪掉之後這個取捨就
   *     消失在歷史裡，下一個人會以為是沒想過。
   */
  let worst = Infinity;
  let pair = "";
  for (const [i, j] of pairsOf(colors, STRICT)) {
    const value = deltaE(colors[i], colors[j], true);
    if (value < worst) {
      worst = value;
      pair = `${colors[i]}↔${colors[j]}`;
    }
  }
  console.log(`    （記錄）紅綠色盲視角最差配對 ${pair} ΔE ${worst.toFixed(1)}`);
  assert.ok(Number.isFinite(worst), "算不出色盲色差，代表算式壞了");
});

test("前 6 個車種兩兩之間、之後相鄰，一般視覺下也要有明顯差距（ΔE ≥ 15）", () => {
  const bad = [];
  for (const [i, j] of pairsOf(colors, STRICT)) {
    const value = deltaE(colors[i], colors[j]);
    if (value < 15)
      bad.push(
        `第 ${i + 1} 與第 ${j + 1} 個（${colors[i]}↔${colors[j]}）ΔE ${value.toFixed(1)}`,
      );
  }
  assert.deepEqual(bad, [], "一般視覺下太接近：\n" + bad.join("\n"));
});

test("每個車種顏色在白底上都要看得見（大面積色塊門檻 2:1）", () => {
  /*
   * ⚠️ 這裡用 2:1 而不是一般圖形元件的 3:1，而且這是**有意識的取捨**，
   *   不是為了讓測試變綠才放寬：
   *   實測把橘／紫紅／天藍調暗到 3:1 之後，色盲色差從 7.6 掉到 2.2～4.8
   *   ——兩件事不能同時滿足。對這張圖而言「色盲分得出來」比較重要，
   *   因為圓環的色塊是**大面積**，本來就看得見；3:1 那條規則是給細線與
   *   小圖示的。舊色表真正的問題是 #D8E7F1 只有 1.23:1，那是連大面積都看不清。
   *   代價由圖例補足（見最後一條測試），所以那一條不可以被拿掉。
   */
  const bad = [];
  for (const color of colors) {
    const value = contrast(color, "#FFFFFF");
    if (value < 2) bad.push(`${color} 對白底只有 ${value.toFixed(2)}:1`);
  }
  assert.deepEqual(
    bad,
    [],
    "有車種顏色在白底上幾乎看不見（舊色表的 #D8E7F1 只有 1.23:1）：\n" +
      bad.join("\n"),
  );
});

test("色表沒有重複的顏色（兩個車種同色＝永遠分不出來）", () => {
  const seen = new Map();
  const bad = [];
  colors.forEach((color, index) => {
    const key = color.toUpperCase();
    if (seen.has(key)) bad.push(`第 ${seen.get(key) + 1} 與第 ${index + 1} 個都是 ${color}`);
    else seen.set(key, index);
  });
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("顏色只有這一份（畫面與 Excel 不可以各抄一份）", () => {
  /*
   * ⚠️ 這一組顏色以前抄在三個地方（畫面圓環、Excel 填色、Excel 圖表數列）。
   *   改一邊忘了另一邊，畫面與交出去的 Excel 就會用不同顏色代表同一個車種，
   *   而且不會有任何錯誤訊息——交出去才會被發現。
   *
   * ⚠️ 這裡**不**能寫成「檔案裡不准出現任何 ARGB 色碼」：表頭底色、
   *   提醒欄位的黃底等等本來就有自己的色碼，那樣寫會把不相干的東西一起擋掉，
   *   然後人就會把這條整個關掉。只擋兩件具體的事：
   *     ①舊車種色表的色碼不可以再出現（那是這次要換掉的東西）
   *     ②兩個取用點都必須真的從共用來源拿
   */
  const client = readFileSync(
    join(here, "..", "app", "DashboardClient.tsx"),
    "utf8",
  );
  /*
   * ⚠️ 清單裡刻意**不含** E58A2B、5B8DB8、D8E7F1：那三個同時是這一支的
   *   品牌色（palette.orange／blue／pale，趨勢線、警示條、圓環沒有資料時的
   *   底色都在用），不是只屬於車種色表。把它們列進來會擋到不相干的地方，
   *   然後人就會把整條關掉——一條會誤判的守門，最後一定會被拔掉。
   *   留下的六個只被車種色表用過（實測現在檔案裡各出現 0 次），
   *   再出現就代表有人又抄了一份舊的。
   */
  const retired = ["7E6BC4", "D65F75", "6FA45D", "9B6A43", "4CA6C9", "A0A0A0"];
  const found = retired.filter((code) =>
    new RegExp(`["']#?(?:FF)?${code}["']`, "i").test(client),
  );
  assert.deepEqual(
    found,
    [],
    "舊車種色表的色碼又出現在 DashboardClient 裡：" + found.join("、") +
      "（應該一律從 app/vehicle-colors.ts 取）",
  );
  assert.match(
    client,
    /compositionColors = VEHICLE_COLORS_ARGB/,
    "Excel 的車種填色沒有用共用色表",
  );
  assert.match(
    client,
    /color: vehicleColor\(index\)/,
    "畫面圓環的車種顏色沒有用共用色表",
  );
  assert.match(
    client,
    /doughnutColors = VEHICLE_COLORS\.map/,
    "Excel 原生圓環圖的車種顏色沒有用共用色表（這是第三份抄本，最容易被漏掉）",
  );
});

test("圖例不可以拿掉——類別多的時候顏色撐不住識別", () => {
  /*
   * ⚠️ 這一條是上面那些檢查的前提。十個類別要兩兩都分得開是做不到的，
   *   所以顏色一定要有第二個線索。本系統的第二個線索就是圓環圖旁邊
   *   那份「色塊＋車種名稱＋數量＋百分比」的清單。
   *   哪天有人為了版面把它拿掉，上面每一條都還是綠的，但圖真的變成猜的。
   */
  const client = readFileSync(
    join(here, "..", "app", "DashboardClient.tsx"),
    "utf8",
  );
  assert.match(
    client,
    /className="composition-list"/,
    "找不到車種組成的圖例清單（.composition-list）。" +
      "圓環圖旁邊必須列出每個車種的名稱與數量，顏色才有第二個線索。",
  );
});
