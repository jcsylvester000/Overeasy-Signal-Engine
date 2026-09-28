import Link from "next/link";
import { brandForHost } from "@/lib/brand";
import { legalIdentity } from "@/lib/legal";
import { PublicShell, Prose } from "@/components/public-shell";

export async function generateMetadata() {
  const { brand } = await brandForHost();
  return { title: `Terms of service · ${brand.appName}` };
}

// DRAFT for counsel review. Pricing/subscription terms are placeholders until pricing is set.
export default async function Terms() {
  const { brand } = await brandForHost();
  const L = legalIdentity(brand);
  const app = brand.appName;
  return (
    <PublicShell brand={brand}>
      <Prose>
        <h1>Terms of service</h1>
        <p className="text-muted">Last updated {L.updated}</p>

        <p>
          These terms govern use of {app}, provided by {L.entity}. By creating or using an account you agree to them on behalf of your organization. If you have a signed agreement with us, that agreement takes priority.
        </p>

        <h2>1. The service</h2>
        <p>{app} scores leads, tracks their progress through your CRM, reports on campaign outcomes, and uploads conversion data to ad accounts you connect. Features may change, and beta or test features are provided as-is.</p>

        <h2>2. Accounts and access</h2>
        <ul>
          <li>Accounts are invitation-only. You are responsible for your users, their roles, and keeping sign-in details secure.</li>
          <li>Agencies that resell {app} are responsible for their clients&apos; accounts and must pass on terms at least as protective as these.</li>
        </ul>

        <h2>3. Your data and your responsibilities</h2>
        <ul>
          <li>You own your data. You instruct us to process it as described in our <Link href="/privacy">privacy policy</Link> and data processing agreement.</li>
          <li>You are responsible for having a lawful basis, the notices and consents required to collect lead data on your sites, and for sharing it with ad platforms. This includes disclosing that sharing in your privacy policy.</li>
          <li>You will not use {app} for forms directed at children, and will not collect health, criminal, or other sensitive data unless the workspace is set as a regulated vertical and the law allows it.</li>
          <li>You are responsible for complying with the Google Ads, Microsoft Advertising and CRM terms that apply to your accounts.</li>
        </ul>

        <h2>4. Acceptable use</h2>
        <p>Do not misuse the service. This includes attempting to access other customers&apos; data, interfering with the service, sending unlawful content, uploading data you are not allowed to process, or reverse-engineering the service except where the law permits it.</p>

        <h2>5. Third-party platforms</h2>
        <p>Connections to Google, Microsoft, CRMs and other platforms depend on those platforms. We are not responsible for their availability, policy changes, or decisions about your accounts, or for conversions a platform rejects or does not attribute.</p>

        <h2>6. Fees</h2>
        <p>Fees, billing periods and cancellation terms are set out in your order form or plan. Unless agreed otherwise, fees are non-refundable and you may cancel at the end of a billing period.</p>

        <h2>7. Intellectual property</h2>
        <p>{L.entity} owns the service, including its scoring and value methods, templates and software. Partner agencies may white-label the service as allowed by their partner agreement. Feedback may be used to improve the service.</p>

        <h2>8. Confidentiality and security</h2>
        <p>Each party will protect the other&apos;s confidential information. We maintain the security measures described on our <Link href="/trust">trust page</Link>.</p>

        <h2>9. Suspension and termination</h2>
        <p>We may suspend access for serious breaches or security risks. On termination, you may export your data for 30 days, after which we delete it, except where the law requires us to keep it.</p>

        <h2>10. Disclaimers and liability</h2>
        <p>The service is provided &quot;as is&quot;. We do not guarantee advertising results. To the extent the law allows, neither party is liable for indirect or consequential losses. Each party&apos;s total liability is limited to the fees paid in the 12 months before the claim. These limits do not apply to liability that cannot be limited by law.</p>

        <h2>11. General</h2>
        <p>
          These terms are governed by the laws of {L.governingLaw}. We may update them with notice. Contact: <a href={`mailto:${L.contact}`}>{L.contact}</a>.
        </p>
      </Prose>
    </PublicShell>
  );
}
