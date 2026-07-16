import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import PwaInit from "@/components/PwaInit";
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
  title: "Payment Requests · Ristara Foods",
  description: "Raise, approve, pay, and reconcile every vendor payment in one ticket.",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <PwaInit />
      </body>
    </html>
  );
}
