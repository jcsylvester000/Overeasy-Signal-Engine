import { brandForHost } from "@/lib/brand";
import { env } from "@/lib/env";
import { Button, Field, Notice } from "@/components/ui";
import { signIn, sendMagicLink } from "./actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; next?: string }> }) {
  const sp = await searchParams;
  const { brand } = await brandForHost();
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/app";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          {brand.logoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt={brand.appName} className="mx-auto h-10 w-auto" />
              {brand.logoLabel && <div className="mt-2 text-sm font-semibold tracking-wide">{brand.logoLabel}</div>}
            </>
          ) : (
            <div className="text-lg font-semibold text-brand">{brand.appName}</div>
          )}
          <p className="mt-1 text-sm text-muted">Sign in to your workspace</p>
        </div>
        <div className="space-y-4 rounded-lg border border-line bg-panel p-5 shadow-sm">
          {!env.isConfigured() && <Notice tone="amber">Supabase is not configured yet. Set the environment variables from .env.example.</Notice>}
          {sp.error && <Notice tone="red">{sp.error}</Notice>}
          {sp.sent && <Notice tone="green">Check your email for a sign-in link.</Notice>}
          <form action={signIn} className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <Field label="Email">
              <input name="email" type="email" required autoComplete="email" />
            </Field>
            <Field label="Password">
              <input name="password" type="password" required autoComplete="current-password" />
            </Field>
            <Button className="w-full justify-center">Sign in</Button>
          </form>
          <form action={sendMagicLink} className="border-t border-line pt-3">
            <input type="hidden" name="next" value={next} />
            <div className="flex gap-2">
              <input name="email" type="email" required placeholder="you@company.com" className="flex-1" aria-label="Email for sign-in link" />
              <Button variant="secondary">Email link</Button>
            </div>
          </form>
        </div>
        <p className="mt-4 text-center text-xs text-muted">Access is by invitation from your agency or administrator.</p>
      </div>
    </main>
  );
}
