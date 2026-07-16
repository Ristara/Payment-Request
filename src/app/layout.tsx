import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import PwaInit from "@/components/PwaInit";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
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
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <PwaInit />
      </body>
    </html>
  );
}
