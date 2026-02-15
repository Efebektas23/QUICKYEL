import type { Metadata, Viewport } from "next";
import { Outfit, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Use Space Grotesk for headings (similar style to Clash Display)
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-clash",
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuickYel | Expense Automation",
  description: "Expense automation platform for Canadian logistics companies",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "QuickYel",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#F59E0B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable}`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="font-sans antialiased bg-slate-950 text-white min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

