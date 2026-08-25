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
      .replace(/\s*[\(\[]\s*\d{1,3}\s*[\)\]]\s*$/i, "")
      .replace(/[\s_-]+\d{5,8}\s*$/i, "")
      .replace(/[\s_-]+(?:民國)?\d{2,4}[年.\/_-]\d{1,2}(?:[月.\/_-]\d{1,2}日?)?\s*$/i, "")
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
