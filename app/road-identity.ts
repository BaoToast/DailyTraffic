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

export function roadNameFromFileName(fileName: string) {
  const stem = fileName.normalize("NFKC").replace(/\.[^.]+$/, "").trim();
  let name = stem.replace(/^.*?\d+\s*T\s*\d+\s*[-_]\s*\d{1,2}\s*[-_]?\s*/i, "").trim();
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

export function isFallbackRoadName(value: string) {
  return /^\d+(?:\s*T\s*\d+)?\s*[-_－]\s*\d{1,2}$/i.test(String(value ?? "").normalize("NFKC").trim());
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
