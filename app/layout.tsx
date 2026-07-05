/**
 * FILE: layout.tsx
 * LOCATION: /app/layout.tsx
 * PURPOSE: Root layout — metadata, fonts, global styles
 */

import type { Metadata } from "next";
import { DM_Sans, Geist_Mono, Playfair_Display } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/lib/components/error-boundary";
import "./globals.css";

const playfair = Playfair_Display({
  subsets: ["latin"],
  weight: ["700", "900"],
  variable: "--font-playfair",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-sans",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "YatraAI — Travel Safe Across Nepal",
    template: "%s — YatraAI",
  },
  description:
    "AI-powered travel safety scores, real-time hazard alerts, and personalised health advisories for every destination in Nepal.",
  keywords: ["Nepal travel", "travel safety", "hiking Nepal", "trekking safety", "YatraAI"],
  authors: [{ name: "YatraAI" }],
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛰️</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
  openGraph: {
    title: "YatraAI — Travel Safe Across Nepal",
    description: "Live safety scores, hazard alerts and personalised travel advisories for Nepal.",
    url: "https://yatraai.com",
    siteName: "YatraAI",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "YatraAI — Travel Safe Across Nepal",
    description: "Live safety scores, hazard alerts and personalised travel advisories for Nepal.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable} ${geistMono.variable}`}>
      <body className="antialiased">
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
