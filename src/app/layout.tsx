import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import BottomNav from "@/components/nav/BottomNav";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "GOBS Golf",
  description: "Good Ole Boys Golf League Tracker",
  manifest: "/manifest.json",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#1a3a2a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <header className="app-header">
          <Link href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>GOBS Golf</h1>
            <div className="subtitle">Semiahmoo Golf &amp; Country Club</div>
          </Link>
        </header>

        <main>{children}</main>

        <BottomNav />
      </body>
    </html>
  );
}