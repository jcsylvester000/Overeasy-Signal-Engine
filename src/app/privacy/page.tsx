import Link from "next/link";
import { brandForHost } from "@/lib/brand";
import { legalIdentity } from "@/lib/legal";
import { PublicShell, Prose } from "@/components/public-shell";

export async function generateMetadata() {
  const { brand } = await brandForHost();
  return { title: `Privacy policy · ${brand.appName}` };
}

// DRAFT for counsel review. Structure follows Google OAuth verification requirements (Google user data + Limited Use),
// CCPA service-provider terms and GDPR Art. 13/28 topics. See 6 - Final Documentation/…Compliance Research….
export default async function Privacy() {
  const { brand } = await brandForHost();
  const L = legalIdentity(brand);
  const app = brand.appName;
  return (
    <PublicShell brand={brand}>
      <Prose>
        <h1>Privacy policy</h1>
        <p className="text-muted">Last updated {L.updated}</p>

        <p>
          This policy explains how {L.entity} (&quot;we&quot;) handles information in {app}, a service that helps advertisers measure which leads from their ads turn into business. It covers two groups: <strong>our customers&apos; users</strong> (the people who sign in to {app}), and <strong>our customers&apos; leads</strong> (people who submit forms on our customers&apos; websites).
        </p>

        <h2>Our role</h2>
        <p>
          For lead data, our customer (the advertiser) is the business / controller and decides why the data is collected. We act as their <strong>service provider / processor</strong> and process it only on their instructions and under our data processing agreement. If you submitted a form on one of our customers&apos; websites, please contact that business first; we will help them respond.
        </p>

        <h2>Information we process</h2>
        <ul>
          <li><strong>Account data</strong> for users of {app}: name, email address, organization, role, sign-in and audit records.</li>
          <li><strong>Ad-click data</strong> captured by our customers&apos; website tag: ad click identifiers (such as gclid, gbraid, wbraid, msclkid), campaign parameters, landing page (without query string), referrer, click time, and consent choices, including Global Privacy Control.</li>
          <li><strong>Lead data</strong> our customers collect through their forms: email, phone and name, and answers to the questions the customer configures. Email and phone are converted to one-way SHA-256 hashes on arrival. Raw contact details are optional, encrypted, and deleted automatically (30 days by default). Answers our customers mark as sensitive are used only to calculate a score and are then masked.</li>
          <li><strong>CRM and outcome data</strong>: pipeline stage changes (e.g. qualified, contract, funded) and deal values that our customers&apos; CRMs send to us.</li>
          <li><strong>Ad account data</strong>: campaign spend, clicks and impressions from the advertiser&apos;s own ad accounts, for reporting.</li>
        </ul>

        <h2>How we use it</h2>
        <ul>
          <li>To score leads, record their progress, and show our customer reports about which campaigns produce business.</li>
          <li>To upload conversion events with values to the customer&apos;s <em>own</em> Google Ads and Microsoft Advertising accounts, when the customer connects them and where consent and law allow.</li>
          <li>To write lead value and status back to the customer&apos;s own CRM.</li>
          <li>To secure, maintain and support the service.</li>
        </ul>
        <p>We do not sell personal information, do not share it for cross-context behavioural advertising on our own behalf, do not combine data across customers, and do not use it to train models for other customers.</p>

        <h2>Google user data</h2>
        <p>
          When a customer connects a Google account, {app} requests access to the Google Data Manager API and the Google Ads API only to (1) upload offline conversion events to that customer&apos;s own Google Ads account and (2) read campaign performance for that account&apos;s reports and to create the conversion actions the customer asks for. OAuth tokens are stored encrypted and used only for these actions. We do not use Google user data for advertising, do not sell it, do not transfer it to others except as needed to provide these features, comply with law, or protect security, and do not allow humans to read it except with the customer&apos;s consent, for security, or where required by law.
        </p>
        <p>
          <strong>{app}&apos;s use and transfer of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.</strong>
        </p>

        <h2>Sharing</h2>
        <p>
          We share data only with the customer&apos;s own ad accounts and CRM (at the customer&apos;s direction) and with our sub-processors, which are listed on our <Link href="/trust">trust page</Link>. We may disclose information if required by law.
        </p>

        <h2>Consent and opt-outs</h2>
        <p>
          The website tag reads the site&apos;s consent choices (Google Consent Mode) and the Global Privacy Control browser signal. When a person has opted out, their conversions are not uploaded to ad platforms, or are uploaded without contact data where the customer has chosen that setting. When the consent-required mode is on, the tag stores nothing until consent is given. Hashed contact data is never sent for customers in regulated categories such as health, legal or financial hardship.
        </p>

        <h2>Retention</h2>
        <ul>
          <li>Raw contact details: deleted after the customer&apos;s retention period (default 30 days).</li>
          <li>Lead, stage and upload records: kept for the customer&apos;s account lifetime for reporting (typically up to 25 months) and deleted at the end of the contract.</li>
          <li>Raw CRM webhook payloads: 30 days.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          Depending on where you live (for example California and other US states, the EU/UK, or the Philippines), you may have rights to access, correct, delete or obtain a copy of your information, and to opt out of the sale or sharing of personal information or targeted advertising. For lead data, send your request to the business whose form you completed; our customers can find and export or delete a person&apos;s records in {app}. You can also contact us at <a href={`mailto:${L.contact}`}>{L.contact}</a>, and we will pass the request on. We will not discriminate against you for exercising your rights.
        </p>

        <h2>Security</h2>
        <p>
          Data is encrypted in transit and at rest. Each customer&apos;s data is isolated with database row-level security, access is role-based, and changes are recorded in an audit log. OAuth tokens are held in an encrypted vault.
        </p>

        <h2>International transfers</h2>
        <p>Our service is hosted in the United States. Where the law requires it, we use appropriate safeguards such as standard contractual clauses.</p>

        <h2>Children</h2>
        <p>{app} is not directed to children, and our customers agree not to use it for forms directed at children under 13 (or 16 where applicable).</p>

        <h2>Changes and contact</h2>
        <p>
          We will post changes here and update the date above. Questions: <a href={`mailto:${L.contact}`}>{L.contact}</a>
          {L.address ? `, ${L.address}` : ""}.
        </p>
      </Prose>
    </PublicShell>
  );
}
