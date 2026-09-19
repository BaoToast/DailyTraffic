/*
 * ══════════════════════════════════════════════════════════════════════
 *  每一張圖的「下載高解析圖片（PNG）」
 * ══════════════════════════════════════════════════════════════════════
 *
 * 使用者 2026-09-12：
 *   「目前全日交通量一共有車種分析圓環圖、每小時實際交通量與PCU（24小時型態）
 *     趨勢圖、全日交通量平日／假日趨勢（歷季分析）圖、各路段平日與假日比較圖，
 *     但只有歷季分析的趨勢圖有可以高清晰圖片下載的功能，能否三個程式各自
 *     所有的圖都能有個下載高清晰圖片的功能呢?」
 *   並且「三個程式都同樣方式作處理」。
 *
 * ── 三條規矩（沿用歷季趨勢圖那一顆已經定案的行為）─────────────────
 *   ① **只有圖，沒有說明文字。** 使用者原話：「下載下來的圖本來就該只有圖，
 *      不能有文字，否則貼到簡報上時，看到那些應該由簡報者說明的文字展示在
 *      上方這樣才奇怪。」講稿留在畫面上，不印進圖裡。
 *   ② **白底。** 透明底貼到深色投影片上，字會看不見。
 *   ③ **圖例畫在圖裡。** 這張圖離開程式之後要自己看得懂。
 *
 * ── 為什麼是「重畫」而不是「把畫面上那張放大」────────────────────
 *   把畫面上的畫布放大是**內插**，線條與文字都會糊；那不叫高解析。
 *   這裡一律以 EXPORT_SCALE 倍的實體像素**重新畫一次**，
 *   線寬與字級照樣以 CSS px 描述（context.scale 幫忙放大），
 *   所以 3 倍圖的文字是 3 倍清晰的文字，不是放大 3 倍的馬賽克。
 *
 * ⚠️ 檔名裡的字元要洗過。Windows 不接受 \ / : * ? " < > |，
 *   而路段名稱、季別標籤都可能帶括號或斜線；洗不掉的話，
 *   瀏覽器會把檔案存成沒有副檔名的「download」，使用者點兩下打不開。
 */

/** 匯出圖的放大倍率。3 倍在 A4 報告與投影片上都還算銳利。 */
export const EXPORT_SCALE = 3;

/**
 * Windows 檔名不接受的字元；連同控制字元一起換掉。
 *
 * ⚠️ 控制字元用 charCodeAt 篩，不寫進正規表示式。
 *   寫成 /[\u0000-\u001f]/ 會被 eslint 的 no-control-regex 擋下來
 *  （而且那條規則是對的：原始碼裡出現控制字元本身就容易被編輯器吃掉）。
 */
export function safeFileName(name: string) {
  return Array.from(name)
    .map((ch) =>
      ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? "_" : ch,
    )
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 把畫好的 canvas 存成 PNG。
 *
 * ⚠️ <a> 要**等一下再移除**，不可以在 click() 之後同步拿掉。
 *   下載是非同步啟動的，太早把節點移掉，瀏覽器可能來不及讀到 download
 *   屬性，檔案就會存成沒有副檔名的「download」——實測過。
 */
export function downloadCanvasPng(canvas: HTMLCanvasElement, fileName: string) {
  return new Promise<boolean>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = safeFileName(fileName.endsWith(".png") ? fileName : fileName + ".png");
      document.body.append(link);
      link.click();
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
      }, 1500);
      resolve(true);
    }, "image/png");
  });
}

/**
 * 開一張 scale 倍實體像素、白底的畫布，交給 paint 以 CSS px 座標作畫。
 *
 * paint 收到的寬高是**邏輯尺寸**（CSS px），跟畫面上那一版完全一樣，
 * 所以同一支繪圖程式可以同時服務畫面與匯出，不會分岔成兩套。
 */
export function paintToCanvas(
  width: number,
  height: number,
  scale: number,
  paint: (context: CanvasRenderingContext2D, width: number, height: number) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.scale(scale, scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  paint(context, width, height);
  return canvas;
}

/**
 * 一次做完「重畫 → 產生 PNG 的 Blob」，**不觸發下載**。
 *
 * ⚠️ 為什麼需要這一支（2026-09-14）：
 *   使用者：「下載多張圖片時，瀏覽器有時會阻擋一次下載多張圖，
 *     如果使用者沒注意，會以為下載失敗，請改成……以壓縮包形式下載」
 *
 *   他說的是對的，而且我們以前的處理方式並不可靠：原本是「每張之間停 350ms」
 *   去閃避瀏覽器的多重下載攔截。那是在賭瀏覽器的行為——不同瀏覽器、
 *   不同設定、使用者按過一次「封鎖」之後，結果都不一樣，**而且被擋掉時
 *   完全沒有訊息**，使用者只會拿到前一兩張。
 *
 *   正確的做法是：多張圖就只發**一個**下載（一個壓縮檔）。
 *   所以要能拿到 Blob 而不是直接存檔。
 */
export function paintedPngBlob(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  scale = EXPORT_SCALE,
): Promise<Blob | null> {
  const canvas = paintToCanvas(width, height, scale, paint);
  if (!canvas) return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * 「收下這一張圖」的回呼。有給的時候就不下載，交給呼叫端去打包。
 */
export type ChartPngSink = (fileName: string, blob: Blob) => void;

/** 把一個已經備好的 Blob 存成檔案（單一下載，不會被多重下載攔截擋到）。 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = safeFileName(fileName);
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 1500);
}

/**
 * 一次做完「重畫 → 存檔」。
 *
 * ⚠️ 多了一個 `sink`：有給的時候**不下載**，改成把畫好的 Blob 交出去。
 *   「一鍵下載全部圖檔」就是靠它把每一張收起來打包成一個壓縮檔，
 *   而不是連續發好幾個下載（會被瀏覽器擋，而且擋掉時沒有任何訊息）。
 *   單張下載的呼叫端不傳 sink，行為和以前一模一樣。
 */
export function downloadPaintedPng(
  fileName: string,
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D, width: number, height: number) => void,
  scale = EXPORT_SCALE,
  sink?: ChartPngSink,
) {
  if (sink)
    return paintedPngBlob(width, height, paint, scale).then((blob) => {
      if (!blob) return false;
      sink(safeFileName(fileName.endsWith(".png") ? fileName : fileName + ".png"), blob);
      return true;
    });
  const canvas = paintToCanvas(width, height, scale, paint);
  if (!canvas) return Promise.resolve(false);
  return downloadCanvasPng(canvas, fileName);
}

export type DonutSlice = { label: string; count: number; color: string };

/**
 * 圓環圖。畫面上那一顆是 CSS conic-gradient（DOM 元素，抓不成圖），
 * 所以匯出這一版是照同一組 items／同一組顏色重畫的。
 *
 * ⚠️ 這裡**不可以自己再算一次比例或合計**。數字一律由呼叫端把畫面上
 *   memo 算好的那一份傳進來；自己再算一次，就會出現「畫面 12.3%、
 *   下載的圖 12.4%」這種永遠查不出來的差異。
 */
export function drawDonutChart(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: {
    items: DonutSlice[];
    total: number;
    centerValue: string;
    centerUnit: string;
    /** 圖上方那一行字（哪一季、哪一個調查點、哪一個方向）。 */
    caption: string;
  },
) {
  const { items, total, centerValue, centerUnit, caption } = options;
  const shown = items.filter((item) => item.count > 0);
  context.textBaseline = "alphabetic";
  context.fillStyle = "#0F2733";
  context.font = "600 16px 'Microsoft JhengHei', sans-serif";
  context.textAlign = "left";
  context.fillText(caption, 28, 34);

  /*
   * 版面：左邊圓環、右邊圖例，兩塊各自**垂直置中**。
   *
   * ⚠️ 圓環不可以撐到滿版高度。撐滿的話圖例被擠到右上角一小條，
   *   而圓環右側留一大片白——實測第一版就是這樣，看起來像圖沒畫完。
   */
  const areaTop = 56;
  const areaHeight = height - areaTop - 28;
  const ringBox = Math.min(areaHeight, width * 0.4);
  const cx = 34 + ringBox / 2;
  const cy = areaTop + areaHeight / 2;
  const outer = ringBox / 2;
  const inner = outer * 0.58;

  let angle = -Math.PI / 2;
  if (!total || !shown.length) {
    context.beginPath();
    context.arc(cx, cy, outer, 0, Math.PI * 2);
    context.fillStyle = "#E3EAEF";
    context.fill();
  } else {
    shown.forEach((item) => {
      const sweep = (item.count / total) * Math.PI * 2;
      context.beginPath();
      context.moveTo(cx, cy);
      context.arc(cx, cy, outer, angle, angle + sweep);
      context.closePath();
      context.fillStyle = item.color;
      context.fill();
      /* 切片之間留一條白線，相鄰的深色才分得開。 */
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.stroke();
      angle += sweep;
    });
  }
  /* 挖洞：白色實心圓，邊界才會和畫面上的圓環一樣乾淨。 */
  context.beginPath();
  context.arc(cx, cy, inner, 0, Math.PI * 2);
  context.fillStyle = "#ffffff";
  context.fill();

  context.textAlign = "center";
  context.fillStyle = "#0F2733";
  context.font = "700 24px 'Microsoft JhengHei', sans-serif";
  context.fillText(centerValue, cx, cy + 2);
  context.font = "12px 'Microsoft JhengHei', sans-serif";
  context.fillStyle = "#708090";
  context.fillText(centerUnit, cx, cy + 24);

  /*
   * 圖例：離開程式之後也要看得懂哪一塊是哪一個車種。
   * 車輛數與百分比都印——只有百分比的話，這張圖回答不了「幾輛」。
   */
  context.textAlign = "left";
  const legendX = 34 + ringBox + 46;
  const legendWidth = width - legendX - 28;
  const rowHeight = Math.min(30, areaHeight / Math.max(1, items.length));
  const legendTop = cy - (items.length * rowHeight) / 2 + rowHeight / 2;
  const formatter = new Intl.NumberFormat("zh-TW");
  items.forEach((item, index) => {
    const y = legendTop + index * rowHeight;
    context.fillStyle = item.color;
    context.fillRect(legendX, y - 10, 12, 12);
    context.fillStyle = "#0F2733";
    context.font = "13px 'Microsoft JhengHei', sans-serif";
    context.textAlign = "left";
    context.fillText(item.label, legendX + 20, y);
    context.fillStyle = "#41545A";
    context.font = "13px 'Microsoft JhengHei', sans-serif";
    context.textAlign = "right";
    context.fillText(
      total
        ? `${formatter.format(Math.round(item.count))}　${((item.count / total) * 100).toFixed(1)}%`
        : "－",
      legendX + legendWidth,
      y,
    );
  });
  context.textAlign = "left";
}

export type BarGroup = {
  label: string;
  /** 與 seriesNames 同長度；null ＝ 沒有做這一種調查（留空，不畫成 0）。 */
  values: (number | null)[];
};

/**
 * 分組橫向長條圖（各路段平日／假日比較）。
 *
 * ⚠️ null 與 0 要分得開。「沒有做這一天的調查」畫成長度 0 的長條，
 *   看起來會和「做了、量是 0」一模一樣——後者是資料，前者不是。
 *   這裡 null 一律不畫長條，數值欄寫「－」。
 */
export function drawGroupedBars(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: {
    groups: BarGroup[];
    seriesNames: string[];
    seriesColors: string[];
    caption: string;
    unit: string;
  },
) {
  const { groups, seriesNames, seriesColors, caption, unit } = options;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#0F2733";
  context.font = "600 16px 'Microsoft JhengHei', sans-serif";
  context.textAlign = "left";
  context.fillText(caption, 28, 34);
  context.font = "12px 'Microsoft JhengHei', sans-serif";
  context.fillStyle = "#708090";
  context.fillText("單位：" + unit, 28, 54);

  /* 圖例 */
  let legendX = 28;
  seriesNames.forEach((name, index) => {
    context.fillStyle = seriesColors[index] || "#888";
    context.fillRect(legendX, 64, 12, 12);
    context.fillStyle = "#0F2733";
    context.font = "13px 'Microsoft JhengHei', sans-serif";
    context.fillText(name, legendX + 19, 74);
    legendX += 19 + context.measureText(name).width + 24;
  });

  /*
   * ⚠️ 2026-09-18 大檢查 F-25：左邊留白原本寫死 150px，
   *   「中山北路大德一路平和東路」「中山北路-岡山路口七叉路口」這種長名稱
   *   前面的字直接被裁掉（規則：文字不可以被截斷）。改成先量最長的名稱，
   *   留白跟著名稱走；上限一半畫布，免得極長名稱把長條擠沒。
   */
  context.font = "13px 'Microsoft JhengHei', sans-serif";
  const widestLabel = groups.reduce(
    (widest, group) => Math.max(widest, context.measureText(group.label).width),
    0,
  );
  const left = Math.min(
      Math.floor(width * 0.5),
      Math.max(150, Math.ceil(widestLabel) + 28),
    ),
    right = 96,
    top = 90;
  const plotWidth = Math.max(1, width - left - right);
  const max = Math.max(
    1,
    ...groups.flatMap((group) =>
      group.values.filter((value): value is number => value != null),
    ),
  );
  /*
   * ⚠️ 每一列的高度**固定**，不是「把剩下的高度平分」。
   *   平分的話，只有一兩個路段時長條會散在整張圖上、中間一大片空白，
   *   看起來像圖沒畫完（第一版實測就是這樣）。列高固定、由上往下排，
   *   剩下的空間留白在下面就好——呼叫端本來就會依列數決定畫布高度。
   */
  const rowHeight = 46;
  const barHeight = Math.min(
    14,
    (rowHeight - 12) / Math.max(1, seriesNames.length),
  );
  const plotHeight = rowHeight * groups.length;

  context.strokeStyle = "#E3EAEF";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(left, top - 8);
  context.lineTo(left, top + plotHeight);
  context.stroke();

  groups.forEach((group, index) => {
    const rowTop = top + index * rowHeight;
    context.fillStyle = "#0F2733";
    context.font = "13px 'Microsoft JhengHei', sans-serif";
    context.textAlign = "right";
    context.fillText(group.label, left - 10, rowTop + rowHeight / 2 + 4);
    context.textAlign = "left";
    const stackTop =
      rowTop + (rowHeight - (barHeight + 2) * seriesNames.length + 2) / 2;
    group.values.forEach((value, seriesIndex) => {
      const y = stackTop + seriesIndex * (barHeight + 2);
      if (value == null) {
        context.fillStyle = "#A9B6BF";
        context.font = "11.5px 'Microsoft JhengHei', sans-serif";
        context.fillText("－（未調查）", left + 5, y + barHeight - 1);
        return;
      }
      const barWidth = Math.max(1, (value / max) * plotWidth);
      context.fillStyle = seriesColors[seriesIndex] || "#888";
      context.fillRect(left, y, barWidth, barHeight);
      /*
       * ⚠️ 2026-09-18 使用者裁示（F-25）：高解析 PNG 一律**淨空**（不標數值），
       *   與折線圖 PNG 同一條規則——數字看 Excel；畫面上 hover 才顯示。
       *   原本這裡在長條末端印數值，已拿掉。「－（未調查）」不是數值標籤，保留。
       */
    });
  });
}
