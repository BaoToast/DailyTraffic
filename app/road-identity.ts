export function normalizeRoadId(value: string) {
  const stem = String(value ?? "").normalize("NFKC").trim().replace(/\.[^.]+$/, "");
  const match = stem.match(/(\d+)\s*T\s*\d+\s*[-_－]\s*(\d{1,2})(?!\d)/i);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : stem;
}

export function surveyRoadIdFromFileName(fileName: string) {
  const stem = fileName.normalize("NFKC").replace(/\.[^.]+$/, "");
  const match = stem.match(/\d+\s*T\s*\d+\s*[-_－]\s*\d{1,2}/i);
  return normalizeRoadId(match?.[0] ?? stem);
}

/*
 * 檔名開頭那串「案號＋場次＋點位」代號，有兩種寫法：
 *   有分隔符：999996T7-01-示範建國路.xlsx        → 示範建國路
 *   無分隔符：999999T1501示範北路示範一路口.xlsx → 示範北路示範一路口
 *
 * 這一條專責處理**無分隔符**的寫法。舊版只有上面那條需要分隔符的規則，
 * 切不到就整條跳過、整個檔名原樣變成路段名稱——實測使用者的 37 份真實檔
 * 全部沒有分隔符，於是畫面上顯示的是
 * 「999999T1506示範北路示範二路示範東路（999999T1506示範北路示範二路示範東路）」。
 *
 * 影響不只是難看。resolveImportedRoad() 判斷「這個檔是不是既有路段」是**先比
 * 名稱**（roadNameMatchKey）才比編號的，而代號裡的場次號會逐季遞增
 * （T15 → T16），名稱跟著變，於是下一季匯入同一條路時名稱與編號都對不上，
 * 系統會當成另一條新路段、跳出詢問視窗，歷季趨勢斷成兩截。
 * 實測：999999T1501示範北路… 與 999999T1601示範北路… 的名稱比對鍵不同；
 * 對照組 999996T7-01-示範建國路 與 999996T8-01-示範建國路 則同為「示範建國路」。
 *
 * 三支系統對同一個檔名的判斷要一致：路口轉向 normalizeIntersectionName()
 * 與交通服務水準 roadFromFile() 早就有剝這段前綴，只有本系統沒有。
 *
 * 兩點刻意的取捨：
 *  ・無分隔符的 T 代號只接受 3 或 4 碼（例如 T601、T1501）。不能使用 `\d{2,}`
 *    一路貪婪到第一個中文字，否則「T1501186縣道」會連路名開頭的 186 一起剝掉。
 *    調查點編號本身仍維持原樣不動。
 *  ・**不剝尾端的平日／假日字樣**。剝掉會讓同一路段的平日檔與假日檔收斂成同一
 *    個名稱，下次匯入時 nameMatches 會同時命中兩筆而落到詢問視窗，反而更糟；
 *    而平假日字樣不會逐季改變，留著不影響跨季比對。
 *  ・案號要求 4 碼以上（真實案號為 5 碼），與路口轉向同一個門檻，避免把
 *    「台1」「186」這類路名裡的數字誤判成案號。
 */
const UNSEPARATED_SURVEY_CODE = /^\s*\d{4,}\s*T\s*S?\s*(?:\d{4}|\d{3})\s*[-_－.]?\s*/i;

export function roadNameFromFileName(fileName: string) {
  const stem = fileName.normalize("NFKC").replace(/\.[^.]+$/, "").trim();
  let name = stem.replace(/^.*?\d+\s*T\s*\d+\s*[-_]\s*\d{1,2}\s*[-_]?\s*/i, "").trim();
  /* 有分隔符的規則沒剝到東西時，才輪到無分隔符的寫法，避免重複剝一次。 */
  if (name === stem) name = stem.replace(UNSEPARATED_SURVEY_CODE, "").trim();
  let previous = "";
  while (name && name !== previous) {
    previous = name;
    name = name
      .replace(/\s*[([]\s*\d{1,3}\s*[)\]]\s*$/i, "")
      .replace(/[\s_-]+\d{5,8}\s*$/i, "")
      .replace(/[\s_-]+(?:民國)?\d{2,4}[年./_-]\d{1,2}(?:[月./_-]\d{1,2}日?)?\s*$/i, "")
      .replace(/[\s_-]*(?:修正|更新|新版|最終|FINAL|報告|送審|測試用|定稿)(?:版|稿)?\s*$/i, "")
      .replace(/[\s_-]+$/g, "")
      .trim();
  }
  return name || surveyRoadIdFromFileName(fileName);
}

export function roadNameMatchKey(value: string) {
  return roadNameFromFileName(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(/[～~—–－-]/g, "~")
    .replace(/[\s　，,。．.、:：_]/g, "");
}

/*
 * 「這個名稱其實只是代號、不是真的路段名」。
 *
 * resolveImportedRoad() 用它決定「名稱比不上、但編號對得上」時可不可以直接
 * 認定是同一條路段。原本只認得有分隔符的代號（999996-01）；檔名沒有分隔符時
 * 退回的代號長 999999T1501 這樣，會被誤認成真的取過名字，於是那條救援規則
 * 對使用者的檔名永遠不成立。
 */
export function isFallbackRoadName(value: string) {
  const text = String(value ?? "").normalize("NFKC").trim();
  return (
    /^\d+(?:\s*T\s*\d+)?\s*[-_－]\s*\d{1,2}$/i.test(text) ||
    /^\d{4,}\s*T\s*S?\s*(?:\d{4}|\d{3})$/i.test(text)
  );
}

/*
 * 方向名稱：「有沒有值」不等於「有沒有取過名字」。
 *
 * 系統好幾個地方在拿不到方向名稱時會補上「方向A／方向B」這兩個**佔位字串**
 * （路段管理清單、匯入時的路段比對、離線 API 的預設值）。它看起來就是一個
 * 字串、有長度，`||` 與 `??` 都當它是真的有值——於是使用者明明打過的
 * 「南下／北上」會被這個預設值蓋掉，而且畫面上沒有任何提示。
 * 最典型的是合併路段：目標路段沒取過名字時，來源的名字會整批被洗掉。
 *
 * isFallbackRoadName 對路段名稱做的是同一件事，這裡是方向名稱版本。
 */
export const DIRECTION_PLACEHOLDER = { A: "方向A", B: "方向B" } as const;

export function isRealDirectionName(name: string | undefined, code: "A" | "B") {
  const normalized = String(name ?? "").normalize("NFKC").trim();
  return !!normalized && normalized !== DIRECTION_PLACEHOLDER[code];
}

/**
 * 依序挑第一個「真的取過的名字」；都沒有就退回佔位值。
 * 回傳值一定先做 NFKC 正規化並去過頭尾空白——寫回資料前後端
 * 都會做相同處理，畫面留著不同版本會讓兩邊看起來不一樣。
 */
export function pickDirectionName(code: "A" | "B", ...candidates: (string | undefined)[]) {
  const picked = candidates.find((candidate) => isRealDirectionName(candidate, code));
  return picked === undefined
    ? DIRECTION_PLACEHOLDER[code]
    : String(picked).normalize("NFKC").trim();
}
