import type { Metadata, Viewport } from "next";
import { Doto } from "next/font/google";
import { APP_NAME, APP_TAGLINE } from "@/lib/config";
import "./globals.css";

// Dot-matrix display face, used for numerals and the wordmark. Body text uses the system face.
const doto = Doto({ variable: "--font-doto", subsets: ["latin"], weight: ["700", "800", "900"] });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s – ${APP_NAME}` },
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ececea" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${doto.variable} h-full`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
