import Link from "next/link";
import type { Brand } from "@/lib/brand";
import { nowMs } from "@/lib/time";

/** Header/footer for public pages (homepage, privacy, terms, trust). White-label: everything comes from the brand. */
export function PublicShell({ brand, signedIn, children }: { brand: Brand; signedIn?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold text-brand">
            {brand.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logoUrl} alt="" className="h-7" />
            ) : (
              <span aria-hidden className="inline-block h-5 w-5 rounded bg-brand" />
            )}
            {brand.appName}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/docs" className="text-muted hover:text-ink">
              Docs
            </Link>
            <Link href="/trust" className="text-muted hover:text-ink">
              Trust
            </Link>
            <Link href={signedIn ? "/app" : "/login"} className="rounded-md bg-brand px-3 py-1.5 font-medium text-white hover:opacity-90">
              {signedIn ? "Open dashboard" : "Sign in"}
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted">
          <span>
            © {new Date(nowMs()).getFullYear()} {brand.appName}
          </span>
          <span className="flex gap-4">
            <Link href="/privacy" className="hover:text-ink">
              Privacy policy
            </Link>
            <Link href="/terms" className="hover:text-ink">
              Terms of service
            </Link>
            <Link href="/trust" className="hover:text-ink">
              Trust &amp; sub-processors
            </Link>
            {brand.supportEmail && (
              <a href={`mailto:${brand.supportEmail}`} className="hover:text-ink">
                {brand.supportEmail}
              </a>
            )}
          </span>
        </div>
      </footer>
    </div>
  );
}

export function Prose({ children }: { children: React.ReactNode }) {
  return <article className="mx-auto max-w-3xl px-4 py-10 text-sm leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">{children}</article>;
}
