import { brandForHost } from "@/lib/brand";

export async function generateMetadata() {
  const { brand } = await brandForHost();
  return { title: `Trust & sub-processors · ${brand.appName}` };
}

const SUBPROCESSORS = [
  { name: "Supabase", purpose: "Database, authentication, encrypted secret storage", data: "Lead records, hashed contact data, encrypted raw contact data (time-limited), account data", location: "United States (project region)" },
  { name: "Netlify", purpose: "Application hosting and edge delivery", data: "Request data in transit; no persistent lead storage", location: "Global edge; United States" },
  { name: "Inngest", purpose: "Background job scheduling and retries", data: "Job identifiers (lead and workspace IDs); no raw contact data", location: "United States" },
  { name: "Resend", purpose: "Transactional and report email", data: "Recipient email addresses, report contents", location: "United States" },
  { name: "Google (Ads / Data Manager API)", purpose: "Conversion uploads to the customer's own Google Ads account", data: "Click identifiers, conversion values, hashed email/phone where permitted, consent flags", location: "Per Google terms" },
  { name: "Microsoft Advertising", purpose: "Conversion uploads to the customer's own Microsoft Advertising account", data: "Click identifiers, conversion values, hashed email/phone where permitted", location: "Per Microsoft terms" },
  { name: "CRM provider chosen by the customer (e.g. HighLevel)", purpose: "Lead sync to the customer's own CRM", data: "Contact details the customer collected, lead score, lead type", location: "Per the CRM's terms" },
];

export default async function Trust() {
  const { brand } = await brandForHost();
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Trust &amp; sub-processors</h1>
      <p className="mt-2 text-muted">How {brand.appName} handles the data our customers collect. Customers are the business (controller); we process on their instructions as a service provider.</p>

      <h2 className="mt-8 text-lg font-semibold">Security and privacy controls</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Email and phone are normalised and hashed (SHA-256) on arrival. Raw contact details are optional, encrypted (AES-256-GCM) and deleted automatically (30 days by default).</li>
        <li>Each customer&apos;s data is isolated by database row-level security; access is role-based and every configuration change is recorded in an append-only audit log.</li>
        <li>Platform sign-in tokens are stored in an encrypted vault, never in plain tables or logs. No personal data is placed in URLs.</li>
        <li>Consent signals (Google Consent Mode) and Global Privacy Control opt-outs are recorded per lead and respected before any upload. Regulated verticals upload click identifiers only.</li>
        <li>The website tag never reads password, payment-card or government-ID fields and ignores login forms.</li>
        <li>Data-subject access and deletion requests are supported per customer workspace.</li>
        <li>We do not sell data, combine data across customers, or use it to train cross-customer models.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Sub-processors</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-2 pr-3">Sub-processor</th>
              <th className="py-2 pr-3">Purpose</th>
              <th className="py-2 pr-3">Data</th>
              <th className="py-2">Location</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SUBPROCESSORS.map((s) => (
              <tr key={s.name}>
                <td className="py-2 pr-3 font-medium">{s.name}</td>
                <td className="py-2 pr-3">{s.purpose}</td>
                <td className="py-2 pr-3">{s.data}</td>
                <td className="py-2">{s.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">We give customers notice before adding a sub-processor. Contact {brand.supportEmail ?? "your account manager"} for our data processing agreement.</p>
    </main>
  );
}
