import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elite B Tax Services — Admin Panel",
  description: "Client, document and content management for Elite B Tax Services.",
  icons: { icon: "/brand/ebt-mark.png", apple: "/brand/ebt-mark.png" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
