"use client";

import React from "react";

/*
 * 全站的錯誤邊界。
 *
 * 為什麼一定要有：這個系統把使用者的資料存在瀏覽器裡。只要有一筆資料的
 * 形狀不符合程式的預期（少一個欄位、來自舊版備份、手動改過的 JSON），
 * render 就會丟例外；沒有邊界的話 React 會把整棵樹卸載，畫面變成全白，
 * 而且重新整理之後同一筆資料還在，還是全白——使用者的全部資料就此打不開，
 * 螢幕上連一行字都沒有。
 *
 * 這個元件不解決資料問題，它只保證「使用者永遠有辦法把資料拿出來」。
 * 所以它刻意寫得極簡：不依賴任何 app 的狀態、樣式或工具函式。
 */

type Props = { children: React.ReactNode };
type State = { error: Error | null };

const CARD: React.CSSProperties = {
  maxWidth: 640,
  margin: "48px auto",
  padding: "28px 30px",
  background: "#fff",
  border: "1px solid #d9e3e6",
  borderLeft: "4px solid #c0563f",
  borderRadius: 12,
  fontFamily:
    '"Noto Sans TC","Microsoft JhengHei",system-ui,-apple-system,sans-serif',
  color: "#1d2a34",
  lineHeight: 1.85,
};

const BUTTON: React.CSSProperties = {
  border: 0,
  borderRadius: 8,
  padding: "11px 17px",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
  marginRight: 8,
};

/** 把瀏覽器裡存的原始資料原封不動存成檔案，不做任何解析。 */
function downloadRawState() {
  const dump: Record<string, string> = {};
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key) dump[key] = localStorage.getItem(key) ?? "";
    }
  } catch {
    /* 連讀都讀不到就給一個空的，至少按鈕不會沒反應 */
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "交通量分析_原始資料備份.json";
  link.click();
  URL.revokeObjectURL(url);
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    return (
      <div style={CARD}>
        <h1 style={{ fontSize: 21, margin: "0 0 14px" }}>畫面無法顯示</h1>
        <p style={{ margin: "0 0 12px" }}>
          程式在讀取這台電腦上的資料時遇到不認得的內容，因此停下來。
          <b>您的資料仍然完整保留在瀏覽器裡，沒有被刪除或覆蓋。</b>
        </p>
        <p
          style={{
            margin: "0 0 12px",
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fdf3f1",
            color: "#8d3f2c",
            fontSize: 13,
            wordBreak: "break-all",
          }}
        >
          錯誤訊息：{error.message}
        </p>
        <p style={{ margin: "0 0 16px" }}>
          請先按下面的按鈕把原始資料存成檔案（那是一份完整備份），再交給維護人員。
          <b>在下載完成之前，請不要清除瀏覽器資料或重新匯入。</b>
        </p>
        <div>
          <button
            style={{ ...BUTTON, background: "#0e7c75", color: "#fff" }}
            onClick={downloadRawState}
          >
            下載原始資料（先做這個）
          </button>
          <button
            style={{
              ...BUTTON,
              background: "#fff",
              color: "#1d2a34",
              border: "1px solid #cfdcdf",
            }}
            onClick={() => window.location.reload()}
          >
            重新載入試試
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
