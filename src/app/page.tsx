import Link from "next/link";
import { brandForHost } from "@/lib/brand";
import { env } from "@/lib/env";
import { userClient } from "@/lib/supabase/server";
import { PublicShell } from "@/components/public-shell";

/**
 * Public product homepage. Google OAuth verification requires a homepage on the verified domain that describes the app
 * (not only a login page) and links to the privacy policy.
 */
export async function generateMetadata() {
  const { brand } = await brandForHost();
  return { title: { absolute: `${brand.appName} — ad signals from real lead outcomes` }, description: "Score every lead, follow it through your CRM, and send stronger conversion values to Google Ads and Microsoft Advertising." };
}

const STEPS = [
  { n: "①", t: "Score every lead", d: "A small website tag and a server API capture the ad click behind each form fill. Every lead gets an instant value and lead type from rules you control, versioned and tested." },
  { n: "②", t: "Follow it through the CRM", d: "As your team moves the lead from qualified to contract to funded, each pipeline stage is recorded automatically and linked to the original ad click. No manual matching." },
  { n: "⑤", t: "Send better signals to ad platforms", d: "Each stage becomes a correctly ordered conversion value uploaded to your own Google Ads and Microsoft Advertising accounts, so bidding learns from leads that become revenue, not just form fills." },
];

export default async function Home() {
  const { brand } = await brandForHost();
  let signedIn = false;
  if (env.isConfigured()) {
    try {
      const sb = await userClient();
      signedIn = Boolean((await sb.auth.getUser()).data.user);
    } catch {
      signedIn = false;
    }
  }
  return (
    <PublicShell brand={brand} signedIn={signedIn}>
      <section className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">Teach Google and Microsoft what a good lead is.</h1>
        <p className="mt-4 max-w-2xl text-base text-muted">
          {brand.appName} connects your website, your CRM and your ad accounts. It scores each lead, follows it through your pipeline and sends each stage&apos;s value back to the ad platforms, so your campaigns optimise for leads that turn into revenue.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={signedIn ? "/app" : "/login"} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            {signedIn ? "Open dashboard" : "Sign in"}
          </Link>
          <Link href="/trust" className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:bg-gray-50">
            How we handle data
          </Link>
        </div>
      </section>
      <section className="border-t border-line bg-canvas">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-12 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.t} className="rounded-lg border border-line bg-white p-5">
              <div className="text-2xl text-brand">{s.n}</div>
              <h2 className="mt-2 font-semibold">{s.t}</h2>
              <p className="mt-2 text-sm text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto max-w-5xl px-4 py-12 text-sm">
        <h2 className="text-lg font-semibold">What access we ask for, and why</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
          <li>
            <strong className="text-ink">Google Ads / Google Data Manager:</strong> to upload offline conversions (click identifiers, conversion values, and hashed contact data where permitted) to the advertiser&apos;s own account, and to read campaign spend for reporting.
          </li>
          <li>
            <strong className="text-ink">Microsoft Advertising:</strong> to upload offline conversions to the advertiser&apos;s own account and read campaign spend.
          </li>
          <li>
            <strong className="text-ink">CRM (e.g. HighLevel):</strong> to read pipeline stage changes and write the lead value and status back to the contact.
          </li>
        </ul>
        <p className="mt-3 text-muted">
          We never sell data, never combine data across customers, and never use it for our own advertising. Read the <Link className="text-brand hover:underline" href="/privacy">privacy policy</Link>.
        </p>
      </section>
    </PublicShell>
  );
}
