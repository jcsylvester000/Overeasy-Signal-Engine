import Link from "next/link";
import type { Brand } from "@/lib/brand";

export function TopBar({ brand, email, children }: { brand: Brand; email?: string | null; children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-panel/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-4 px-4">
        <Link href="/app" className="flex items-center gap-2 font-semibold text-brand">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.logoLabel ? brand.appName.replace(brand.logoLabel, "").trim() : ""} className="h-6 w-auto" />
          ) : (
            <span aria-hidden className="inline-block h-5 w-5 rounded bg-brand" />
          )}
          <span>{brand.logoUrl ? (brand.logoLabel ?? brand.appName) : brand.appName}</span>
        </Link>
        <div className="flex-1 text-sm">{children}</div>
        {email && (
          <div className="flex items-center gap-3 text-sm">
            <Link href="/app/account" className="hidden text-muted hover:text-ink sm:inline">
              {email}
            </Link>
            <form action="/auth/signout" method="post">
              <button className="text-muted hover:text-ink">Sign out</button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
