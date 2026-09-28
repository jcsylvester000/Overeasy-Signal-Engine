import { brandForHost } from "@/lib/brand";
import { MfaChallenge } from "@/components/mfa";

export const metadata = { title: "Two-factor check" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const { brand } = await brandForHost();
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/app";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-5 shadow-sm">
        <div className="mb-4 text-center">
          <div className="text-lg font-semibold text-brand">{brand.appName}</div>
          <p className="mt-1 text-sm text-muted">Two-factor authentication</p>
        </div>
        <MfaChallenge next={next} />
      </div>
    </main>
  );
}
