/**
 * FILE: layout.tsx
 * LOCATION: /app/layout.tsx
 * PURPOSE: Root layout — metadata, fonts, global styles
 */

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
  title: {
    // Default title shown on pages that don't set their own
    default:  "YatraAI — Travel Safe Across Nepal",
    // Per-page titles will appear as "Dashboard — YatraAI"
    template: "%s — YatraAI",
  },
  description:
    "AI-powered travel safety scores, real-time hazard alerts, and personalised health advisories for every destination in Nepal.",
  keywords: ["Nepal travel", "travel safety", "hiking Nepal", "trekking safety", "YatraAI"],
  authors: [{ name: "YatraAI" }],

  // ── Favicon ────────────────────────────────────────────────────────────────
  // Uses an inline SVG so no image file is needed.
  // The mountain emoji ⛰️ is rendered as an SVG favicon — works in all
  // modern browsers. If you later want a custom PNG icon, drop it in /public
  // as favicon.ico and replace the icon entry below with just:
  //   icon: "/favicon.ico"
  icons: {
    icon: [
      {
        // SVG favicon — renders the ⛰️ mountain emoji as a browser tab icon
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛰️</text></svg>",
        type: "image/svg+xml",
      },
    ],
    // Apple touch icon — used when user adds site to iOS home screen
    // Drop a 180×180 PNG at /public/apple-touch-icon.png to enable this
    // apple: "/apple-touch-icon.png",
  },

  // ── Open Graph (social share previews) ────────────────────────────────────
  openGraph: {
    title:       "YatraAI — Travel Safe Across Nepal",
    description: "Live safety scores, hazard alerts and personalised travel advisories for Nepal.",
    url:         "https://yatraai.com",
    siteName:    "YatraAI",
    locale:      "en_US",
    type:        "website",
    // Drop a 1200×630 image at /public/og-image.png to enable the preview card
    // images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "YatraAI" }],
  },

  // ── Twitter card ──────────────────────────────────────────────────────────
  twitter: {
    card:        "summary_large_image",
    title:       "YatraAI — Travel Safe Across Nepal",
    description: "Live safety scores, hazard alerts and personalised travel advisories for Nepal.",
    // images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
