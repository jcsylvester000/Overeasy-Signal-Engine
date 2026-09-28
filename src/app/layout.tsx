import type { Metadata } from "next";
import "./globals.css";
import { brandCssVars, brandForHost } from "@/lib/brand";

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await brandForHost();
  return {
    title: { default: brand.appName, template: `%s · ${brand.appName}` },
    description: "Lead scoring, CRM lifecycle tracking and value-based conversion signals for ad platforms.",
    robots: { index: false, follow: false },
    icons: brand.faviconUrl
      ? { icon: [{ url: brand.faviconUrl, type: brand.faviconUrl.endsWith(".svg") ? "image/svg+xml" : undefined }], ...(brand.theme === "overeasy" ? { apple: "/brand/overeasy-apple-touch.png" } : {}) }
      : undefined,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { brand } = await brandForHost();
  return (
    <html lang="en">
      <head>
        {brand.theme === "overeasy" && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
            {/* eslint-disable-next-line @next/next/no-page-custom-font */}
            <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600;700&display=swap" />
          </>
        )}
        <style>{brandCssVars(brand)}</style>
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
