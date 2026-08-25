import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "全日交通量及車種組成",
  description: "全日實際交通量、24小時PCU、尖峰PCU、平假日與歷季趨勢、跨計畫交通分析。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "全日交通量及車種組成",
    description: "交通量、PCU、車種組成、方向、平假日、歷季與跨計畫分析。",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "全日交通量及車種組成分析平台" }],
  },
  twitter: { card: "summary_large_image", title: "全日交通量及車種組成", description: "專業交通量與PCU分析平台", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
