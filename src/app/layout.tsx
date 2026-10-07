import type { Metadata } from "next";
import { Be_Vietnam_Pro, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/messages/client";
import { getLocale, getMessages } from "@/messages/server";

const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
});
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages();
  return { title: t.app.name, description: t.app.tagline };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
