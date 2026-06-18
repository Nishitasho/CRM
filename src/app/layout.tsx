import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SalesNest CRM",
    template: "%s | SalesNest CRM",
  },
  description: "営業チームの顧客・商談・活動を一つにまとめるCRM",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
