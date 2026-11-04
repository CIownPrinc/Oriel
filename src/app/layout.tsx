import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { PALETTE } from "@/lib/palette";

/*
 * Two voices: Newsreader for Oriel's headlines and every line an interviewer speaks, Schibsted
 * Grotesk for your words and the interface, numbers included.
 */
// Self-hosted at build time (no request to a font service from visitors' browsers), Latin only,
// swap with metric-matched fallbacks. Roman only: Oriel sets nothing in italic.
const serif = Newsreader({ subsets: ["latin"], style: ["normal"], axes: ["opsz"], variable: "--font-newsreader", display: "swap" });
const sans = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", display: "swap" });

export const metadata: Metadata = {
  // Absolute URLs for the share image. Set ORIEL_SITE_URL to the deployed origin.
  metadataBase: new URL(process.env.ORIEL_SITE_URL ?? "http://localhost:3100"),
  title: { default: "Oriel: practice for the room before you're in it", template: "%s · Oriel" },
  description: "Mock interviews with an AI interviewer who listens, follows up and pushes back. Afterwards: your recording, the moments that mattered, and what to change.",
};

export const viewport: Viewport = { themeColor: PALETTE.bg, colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
