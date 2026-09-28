import type { Metadata } from "next";
import "./globals.css";
import { brandCssVars, brandForHost } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await brandForHost();
  return {
    title: { default: brand.appName, template: `%s · ${brand.appName}` },
    description: "Lead scoring, CRM lifecycle tracking and value-based conversion signals for ad platforms.",
    robots: { index: false, follow: false },
    icons: brand.faviconUrl ? [{ url: brand.faviconUrl }] : undefined,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { brand } = await brandForHost();
  return (
    <html lang="en">
      <head>
        <style>{brandCssVars(brand)}</style>
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
