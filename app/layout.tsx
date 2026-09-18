import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "右側雷達｜五股日內價量分析",
  description:
    "同時監察五隻股票，以 VWAP、EMA、相對成交量與突破接受度判讀日內右側結構。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
