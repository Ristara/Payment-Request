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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    // iOS ignores manifest.json for launch screens — without an exact-size
    // image per device it shows plain white while the app boots. Regenerate
    // with: node scripts/generate-splash.mjs
    other: [
      { rel: "apple-touch-startup-image", media: "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-640x1136.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-1136x640.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-750x1334.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-1334x750.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1242x2208.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2208x1242.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1125x2436.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2436x1125.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-828x1792.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-1792x828.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1242x2688.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2688x1242.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1170x2532.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2532x1170.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1284x2778.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2778x1284.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1179x2556.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2556x1179.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1290x2796.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2796x1290.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1206x2622.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2622x1206.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)", url: "/splash/splash-1320x2868.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: landscape)", url: "/splash/splash-2868x1320.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-1536x2048.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-2048x1536.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-1620x2160.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 810px) and (device-height: 1080px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-2160x1620.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-1640x2360.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 820px) and (device-height: 1180px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-2360x1640.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-1668x2388.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-2388x1668.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)", url: "/splash/splash-2048x2732.png" },
      { rel: "apple-touch-startup-image", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2) and (orientation: landscape)", url: "/splash/splash-2732x2048.png" },
    ],
  },
  appleWebApp: {
    capable: true,
    title: "Payments",
    statusBarStyle: "black-translucent",
  },
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
        {/* Applies the saved sidebar state before first paint. In an effect it
            would render open and then snap shut on every navigation. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("pay-sidebar-collapsed")==="1")' +
              'document.documentElement.dataset.sidebar="collapsed"}catch(e){}',
          }}
        />
        {children}
        <PwaInit />
      </body>
    </html>
  );
}
