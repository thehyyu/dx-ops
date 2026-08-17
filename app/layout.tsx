import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "DX Hub",
  description: "數位轉型組內部資源入口",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
