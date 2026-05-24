import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "EDC Suite - VAG ECU Tuning Tool | Beta",
  description: "Free online EDC15P/EDC16 map editor and tuning suite for VAG diesel ECUs. Parse, edit, and tune ECU maps with launch control, checksum correction, and more.",
  keywords: "EDC15P, EDC16, VAG tuning, ECU editor, map editor, diesel tuning, launch control, checksum, free tuning tool",
  authors: [{ name: "EDC Suite" }],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
  openGraph: {
    title: "EDC Suite - VAG ECU Tuning Tool",
    description: "Free online EDC15P/EDC16 map editor and tuning suite for VAG diesel ECUs.",
    url: "https://edc.krstoff.com",
    siteName: "EDC Suite",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "EDC Suite - VAG ECU Tuning Tool",
    description: "Free online EDC15P/EDC16 map editor for VAG diesel ECUs.",
  },
  robots: "index, follow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
