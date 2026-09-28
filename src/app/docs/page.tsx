import { headers } from "next/headers";
import Link from "next/link";
import { brandForHost } from "@/lib/brand";
import { PublicShell, Prose } from "@/components/public-shell";
import { CANONICAL_STAGES, STAGE_LABEL } from "@/core/stages";

export async function generateMetadata() {
  const { brand } = await brandForHost();
  return { title: `Developer docs · ${brand.appName}` };
}

const TOC = [
  { id: "overview", label: "1. Overview" },
  { id: "tag", label: "2. Install the tag" },
  { id: "ingest", label: "3. Server Ingest API" },
  { id: "lead-status", label: "4. Lead status" },
  { id: "stage-changes", label: "5. Stage changes" },
  { id: "generic-webhook", label: "6. Generic CRM webhook" },
  { id: "ghl", label: "7. HighLevel app" },
  { id: "outbound-webhooks", label: "8. Outbound webhooks" },
  { id: "reports", label: "9. Reports API" },
  { id: "limits", label: "10. Rate limits & errors" },
  { id: "data-handling", label: "11. Data handling" },
] as const;

const GHL_FIELDS = [
  { key: "ose_lead_id", name: "OSE Lead ID", type: "Text" },
  { key: "leadvalue_initial", name: "Lead Value (initial)", type: "Monetary" },
  { key: "leadvalue_current", name: "Lead Value (current)", type: "Monetary" },
  { key: "lead_type", name: "Lead Type", type: "Text" },
  { key: "score_version", name: "Score Version", type: "Numerical" },
  { key: "ose_sync_status", name: "Ad Signal Status", type: "Large text" },
  { key: "window_expires_on", name: "Upload Window Expires", type: "Date" },
];

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
      <code>{children}</code>
    </pre>
  );
}

function C({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-gray-100 px-1 py-0.5 text-[0.8rem] text-ink">{children}</code>;
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mt-6 scroll-mt-20 font-semibold">
      {children}
    </h3>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} scope="col" className="py-2 pr-4 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              {r.map((c, j) => (
                <td key={j} className="py-2 pr-4">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DeveloperDocs() {
  const { brand } = await brandForHost();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const stages = CANONICAL_STAGES.join(" | ");

  const snippet = `<script async src="${origin}/ose.js" data-site="YOUR_SITE_KEY"></script>`;

  const consentSnippet = `<!-- Consent-required mode: nothing is stored or sent until ad_storage is granted -->
<script async src="${origin}/ose.js" data-site="YOUR_SITE_KEY" data-consent="required"></script>

<script>
  // Either let your CMP push Google Consent Mode updates to dataLayer ...
  gtag("consent", "update", { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
  // ... or tell the tag directly:
  window.ose && window.ose.consent({ ad_storage: "granted", ad_user_data: "granted", ad_personalization: "denied" });
</script>`;

  const configSnippet = `<script>
  // Alternative to data-* attributes (used by the GTM template, which cannot set data-site)
  window.oseConfig = { site: "YOUR_SITE_KEY", consentRequired: true };
</script>
<script async src="${origin}/ose.js?site=YOUR_SITE_KEY"></script>`;

  const queueSnippet = `<script>
  // Safe to call before ose.js has loaded: calls are queued in ose.q and replayed on load.
  window.ose = window.ose || { q: [] };
  window.ose.q = window.ose.q || [];
  window.ose.q.push(["consent", { ad_storage: "granted" }]);
</script>`;

  const formSnippet = `<form data-ose-form="refinance-quote">
  <input type="email" name="email" />
  <input type="tel" name="phone" />
  <select data-ose-field="loan_amount" name="q7">...</select>
  <input name="credit_band" />
  <textarea name="message"></textarea>   <!-- free text is never sent -->
</form>

<form data-ose-ignore>  <!-- the tag leaves this form alone -->
  ...
</form>`;

  const spaSnippet = `// React / Next.js / any SPA: call ose.lead from your submit handler.
async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  const result = await window.ose?.lead({
    form: "refinance-quote",
    email: String(f.get("email") ?? ""),
    phone: String(f.get("phone") ?? ""),
    name: String(f.get("name") ?? ""),
    geo: "TX",
    answers: { loan_amount: 350000, credit_band: "720-759" },
    // test: true,   // mark test leads so they are never uploaded to ad platforms
  });
  // result: { ok: true, lead_id, score, lead_type } (or null if the request failed)
  // Add data-ose-ignore to this <form> so the automatic binding does not send it twice.
}`;

  const debugSnippet = `window.ose.debug()
// { store: { v: "v_…", first: {…}, last: {…}, c: {…} }, events: [ …last 50 beacons… ] }
window.ose.version // "1.0.0"`;

  const ingestBody = `{
  "site_key": "site_abc123",
  "form": "refinance-quote",
  "visitor_id": "v_3f9c…",
  "external_ref": "crm-contact-8812",
  "email": "jane@example.com",
  "phone": "+1 512 555 0100",
  "name": "Jane Doe",
  "geo": "TX",
  "answers": { "loan_amount": 350000, "credit_band": "720-759" },
  "attribution": { "gclid": "Cj0KCQ…", "utm_source": "google", "utm_campaign": "refi-q3", "click_ts": "2026-09-27T14:03:11Z" },
  "consent": { "ad_user_data": "granted", "ad_personalization": "denied" },
  "test": false
}`;

  const curlSample = `API_KEY="ose_ab12cd34_xxxxxxxxxxxxxxxxxxxxxxxx"
BODY='{"form":"refinance-quote","email":"jane@example.com","answers":{"loan_amount":350000}}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$API_KEY" -hex | sed 's/^.* //')

curl -X POST "${origin}/v1/leads" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "X-OSE-Signature: t=$T,v1=$SIG" \\
  -H "Idempotency-Key: order-12345" \\
  --data "$BODY"`;

  const nodeSample = `import crypto from "node:crypto";

const API_KEY = process.env.LEADS_API_KEY; // ose_<prefix>_<secret>

export async function sendLead(lead) {
  const body = JSON.stringify(lead);          // sign exactly the bytes you send
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac("sha256", API_KEY).update(\`\${t}.\${body}\`).digest("hex");

  const res = await fetch("${origin}/v1/leads", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${API_KEY}\`,
      "Content-Type": "application/json",
      "X-OSE-Signature": \`t=\${t},v1=\${v1}\`,
      "Idempotency-Key": lead.external_ref ?? crypto.randomUUID(),
    },
    body,
  });
  if (!res.ok) throw new Error(\`\${res.status} \${await res.text()}\`);
  return res.json(); // { lead_id, score, lead_type, score_version }
}`;

  const phpSample = `<?php
$apiKey = getenv('LEADS_API_KEY'); // ose_<prefix>_<secret>
$body = json_encode([
  'form' => 'refinance-quote',
  'email' => 'jane@example.com',
  'answers' => ['loan_amount' => 350000],
]);
$t = time();
$v1 = hash_hmac('sha256', $t . '.' . $body, $apiKey);

$ch = curl_init('${origin}/v1/leads');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $body,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . $apiKey,
    'Content-Type: application/json',
    "X-OSE-Signature: t=$t,v1=$v1",
    'Idempotency-Key: order-12345',
  ],
]);
$response = json_decode(curl_exec($ch), true);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE); // 201 created, 200 replay`;

  const ingestResponse = `HTTP/1.1 201 Created
{
  "lead_id": "4f1c2a8e-8a1b-4a53-9d0e-2b7f6f0c9a11",
  "score": 78,
  "lead_type": "Standard",
  "score_version": 3
}`;

  const validationError = `HTTP/1.1 422 Unprocessable Entity
{
  "error": "Validation failed",
  "issues": [{ "path": "attribution.click_ts", "message": "Invalid datetime" }]
}`;

  const statusSample = `curl "${origin}/v1/leads/4f1c2a8e-8a1b-4a53-9d0e-2b7f6f0c9a11" \\
  -H "Authorization: Bearer $API_KEY"`;

  const statusResponse = `{
  "id": "4f1c2a8e-8a1b-4a53-9d0e-2b7f6f0c9a11",
  "created_at": "2026-09-27T14:05:40Z",
  "form": "refinance-quote",
  "score": 78,
  "score_version": 3,
  "lead_type": "Standard",
  "velocity_band": "fast",
  "canonical_stage": "qualified",
  "lost_reason": null,
  "value_current": 420,
  "currency": "USD",
  "click_ts": "2026-09-27T14:03:11Z",
  "window_expires_on": "2026-12-26",
  "is_test": false,
  "stages": [
    { "canonical_stage": "submitted", "occurred_at": "2026-09-27T14:05:40Z", "source": "api" },
    { "canonical_stage": "qualified", "occurred_at": "2026-09-28T09:12:00Z", "source": "ghl" }
  ],
  "signals": [
    { "platform": "google", "canonical_stage": "qualified", "mode": "live", "status": "sent",
      "value_increment": 300, "cumulative_after": 420, "sent_at": "2026-09-28T09:13:02Z", "error": null }
  ]
}`;

  const stageSample = `BODY='{"stage":"funded","occurred_at":"2026-10-14T16:00:00Z","actual_value":8250}'
T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$API_KEY" -hex | sed 's/^.* //')

curl -X POST "${origin}/v1/leads/4f1c2a8e-8a1b-4a53-9d0e-2b7f6f0c9a11/stage" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "X-OSE-Signature: t=$T,v1=$SIG" \\
  --data "$BODY"

# HTTP/1.1 202 Accepted
# { "lead_id": "4f1c2a8e-…", "canonical_stage": "funded" }`;

  const genericPayload = `{
  "event_id": "crm-evt-99812",          // dedupe key (recommended)
  "contact_id": "C-5521",               // lead matching: lead_id, contact_id, external_ref, email, phone
  "email": "jane@example.com",
  "pipeline_id": "sales",               // either a canonical "stage" ...
  "stage_id": "st_underwriting",        // ... or pipeline_id + stage_id mapped on the CRM stages screen
  "stage_name": "Underwriting",
  "occurred_at": "2026-10-02T10:30:00Z",
  "actual_value": 8250,
  "lost_reason": null
}`;

  const genericNode = `import crypto from "node:crypto";

const SECRET = process.env.WORKSPACE_WEBHOOK_SECRET;
const body = JSON.stringify({ event_id: "crm-evt-99812", email: "jane@example.com", stage: "contract" });
const t = Math.floor(Date.now() / 1000);
const v1 = crypto.createHmac("sha256", SECRET).update(\`\${t}.\${body}\`).digest("hex");

await fetch("${origin}/v1/webhooks/generic/YOUR_WORKSPACE_ID", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-OSE-Signature": \`t=\${t},v1=\${v1}\` },
  body,
});
// 202 { "ok": true, "duplicate": false }`;

  const envelope = `POST https://your-app.example.com/hooks/leads
Content-Type: application/json
X-OSE-Event: lead.stage_changed
X-OSE-Delivery: 0b6c1d0e-4f7a-4c1e-9b2a-6f3d2e1c8a90
X-OSE-Signature: t=1791196200,v1=5d41402abc4b2a76b9719d911017c592…

{
  "id": "evt_…",
  "type": "lead.stage_changed",
  "created_at": "2026-10-02T10:30:01Z",
  "workspace_id": "8d2e…",
  "data": {
    "lead_id": "4f1c2a8e-8a1b-4a53-9d0e-2b7f6f0c9a11",
    "stage": "contract",
    "occurred_at": "2026-10-02T10:30:00Z",
    "value_current": 2100
  }
}`;

  const verifyNode = `import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.WEBHOOK_ENDPOINT_SECRET; // shown when you add the endpoint
const app = express();

// Use the raw body: re-serialised JSON will not match the signature.
app.post("/hooks/leads", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  const header = req.get("X-OSE-Signature") ?? "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=")));
  const t = Number(parts.t);

  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return res.sendStatus(401);
  const expected = crypto.createHmac("sha256", SECRET).update(\`\${t}.\${raw}\`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(parts.v1 ?? ""), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);

  const event = JSON.parse(raw);
  // De-duplicate on the X-OSE-Delivery header / event.id: retries reuse them.
  res.sendStatus(204); // acknowledge fast (within 10 s), then process asynchronously
  queueMicrotask(() => handle(event));
});`;

  const reportSample = `curl "${origin}/v1/reports/funnel?days=30" -H "Authorization: Bearer $API_KEY"`;

  const reportResponse = `{
  "days": 30,
  "from": "2026-08-29",
  "funnel": [
    { "stage": "submitted", "count": 412 },
    { "stage": "qualified", "count": 188 },
    { "stage": "opportunity", "count": 96 },
    { "stage": "contract", "count": 41 },
    { "stage": "sold", "count": 23 },
    { "stage": "funded", "count": 19 }
  ],
  "lost": 77,
  "value_total": 156750,
  "currency": "USD",
  "by_lead_type": [
    { "key": "Standard", "leads": 120, "qualified": 84, "contract": 25, "funded": 13, "value": 108500 }
  ],
  "by_campaign": [
    { "key": "refi-q3", "leads": 210, "qualified": 101, "contract": 22, "funded": 11, "value": 90750 }
  ]
}`;

  return (
    <PublicShell brand={brand}>
      <div className="mx-auto flex max-w-6xl gap-8 px-4">
        <aside className="hidden w-56 shrink-0 lg:block">
          <nav aria-label="Table of contents" className="sticky top-4 py-10 text-sm">
            <p className="font-semibold text-ink">On this page</p>
            <ol className="mt-2 space-y-1.5">
              {TOC.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="text-muted hover:text-ink">
                    {t.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <Prose>
            <h1>Developer docs</h1>
            <p className="text-muted">
              Everything you need to send leads to {brand.appName}, move them through CRM stages, and receive events back. All endpoints live under <C>{origin}/v1/</C> and speak JSON.
            </p>

            <nav aria-label="Table of contents (mobile)" className="mt-4 rounded border border-line p-3 lg:hidden">
              <p className="font-semibold">On this page</p>
              <ol className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {TOC.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="text-brand hover:underline">
                      {t.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            {/* 1 ------------------------------------------------------------------ */}
            <h2 id="overview" className="scroll-mt-20">
              1. Overview
            </h2>
            <p>Data flows through {brand.appName} in five steps:</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                <strong>Capture.</strong> The website tag records ad click IDs (gclid, gbraid, wbraid, msclkid, fbclid), UTMs and click time as first and last touch, and sends form submissions as leads. Back ends can send leads directly with the Ingest API.
              </li>
              <li>
                <strong>Score.</strong> Each lead is scored and typed on arrival with the workspace&apos;s published scoring model. Email and phone are hashed on arrival.
              </li>
              <li>
                <strong>CRM stages.</strong> Your CRM (HighLevel app, generic webhook or the stage API) moves the lead along the canonical ladder: <C>{stages}</C>.
              </li>
              <li>
                <strong>Value.</strong> Each stage raises the lead&apos;s current value using the workspace&apos;s value model; leads never move down the ladder for value purposes, and <C>lost</C> is terminal.
              </li>
              <li>
                <strong>Uploads.</strong> Value increments are uploaded as offline conversions to the connected ad accounts within each platform&apos;s upload window, respecting consent.
              </li>
            </ol>
            <Table head={["Canonical stage", "Label"]} rows={CANONICAL_STAGES.map((s) => [<C key={s}>{s}</C>, STAGE_LABEL[s]])} />

            {/* 2 ------------------------------------------------------------------ */}
            <h2 id="tag" className="scroll-mt-20">
              2. Install the tag
            </h2>
            <p>
              Create a site under <strong>Sites &amp; API</strong> in your workspace to get its site key, then add this snippet to every page, ideally in <C>&lt;head&gt;</C>. It loads asynchronously, has no dependencies and never blocks rendering.
            </p>
            <Code>{snippet}</Code>
            <p>
              Use one install method per site. If the tag is loaded twice, the second copy exits because <C>window.ose.version</C> is already set. The tag can also read its site key from <C>window.oseConfig.site</C> or a <C>?site=</C> query parameter on the script URL:
            </p>
            <Code>{configSnippet}</Code>

            <H3 id="tag-gtm">Google Tag Manager template</H3>
            <p>
              Import the Custom Template into a web container and fill in the tag host (<C>{origin.replace(/^https?:\/\//, "")}</C>), the site key (format <C>site_</C> followed by 6-32 lowercase letters or digits) and, optionally, the Consent Mode mapping. Because GTM&apos;s <C>injectScript</C> cannot set <C>data-site</C>, the template sets <C>window.oseConfig</C> and injects <C>ose.js?site=…</C>.
            </p>

            <H3 id="tag-wordpress">WordPress plugin</H3>
            <p>
              Upload the plugin zip via <strong>Plugins → Add New → Upload Plugin</strong>, then enter the tag host and site key on its Settings page (requires the <C>manage_options</C> capability). The plugin enqueues the tag asynchronously in <C>&lt;head&gt;</C>, can skip the tag for logged-in administrators (on by default), and offers an <C>ose_should_load</C> filter to skip chosen pages. It makes no external requests from PHP. Contact Form 7, WPForms and Gravity Forms need no extra hooks: the tag binds their forms automatically.
            </p>

            <H3 id="tag-forms">Automatic form capture and field naming</H3>
            <p>
              The tag listens for <C>submit</C> on every form and also pre-fills hidden inputs (<C>ose_visitor</C>, <C>gclid</C>, <C>gbraid</C>, <C>wbraid</C>, <C>msclkid</C>, <C>utm_source</C>, <C>utm_campaign</C>, <C>ose_click_ts</C>) so your own handler or CRM form receives the click IDs too. A submission is sent only if it contains an email, a phone or at least one answer.
            </p>
            <ul>
              <li>
                <C>data-ose-form=&quot;name&quot;</C> names the form in reports (fallbacks: the form&apos;s <C>id</C>, its <C>name</C>, then the page path).
              </li>
              <li>
                <C>data-ose-field=&quot;key&quot;</C> overrides a field&apos;s key (fallbacks: <C>name</C>, then <C>id</C>). Keys are lowercased, non-alphanumerics become <C>_</C>, and keys are cut to 48 characters. Values are trimmed to 500 characters.
              </li>
              <li>
                <C>data-ose-ignore</C> on a <C>&lt;form&gt;</C> makes the tag skip it completely.
              </li>
              <li>
                Email is detected from <C>type=&quot;email&quot;</C> or a key containing &quot;email&quot;; phone from <C>type=&quot;tel&quot;</C> or keys containing phone/mobile/tel; name from <C>name</C>/<C>full_name</C> or first/last name pairs. Everything else becomes a scored answer, so give answer fields short, stable keys such as <C>loan_amount</C> or <C>timeline</C>.
              </li>
              <li>Unchecked checkboxes and radios, disabled fields and empty values are skipped.</li>
            </ul>
            <Code>{formSnippet}</Code>

            <H3 id="tag-spa">SPA and React usage</H3>
            <p>
              The tag re-captures click parameters on <C>pushState</C>, <C>replaceState</C> and <C>popstate</C>, so single-page apps keep attribution. If your form submits over <C>fetch</C> without a native submit event, or you want the score back, call <C>ose.lead</C> yourself. It resolves to <C>{"{ ok, lead_id, score, lead_type }"}</C>, which a thank-you tag can use as a transaction ID for a valued conversion.
            </p>
            <Code>{spaSnippet}</Code>
            <p>
              Calls made before the script loads can be queued on <C>window.ose.q</C> as <C>[method, ...args]</C> arrays; they are replayed once the tag starts.
            </p>
            <Code>{queueSnippet}</Code>
            <p>
              <C>window.ose.debug()</C> returns the stored visitor record and the last 50 events the tag sent, which helps when verifying an install:
            </p>
            <Code>{debugSnippet}</Code>

            <H3 id="tag-consent">Consent-required mode</H3>
            <p>
              For EU, UK and Swiss sites add <C>data-consent=&quot;required&quot;</C> (or <C>window.oseConfig.consentRequired = true</C>). The tag then stores nothing and sends nothing until <C>ad_storage</C> is granted, either through a Google Consent Mode <C>consent default</C>/<C>update</C> entry in <C>dataLayer</C> or through <C>ose.consent()</C>. It polls for a consent change once per second for up to 10 minutes, then sends the deferred visit. The <C>ad_user_data</C> and <C>ad_personalization</C> values are forwarded with every beacon and respected before any upload.
            </p>
            <Code>{consentSnippet}</Code>

            <H3 id="tag-gpc">Global Privacy Control</H3>
            <p>
              If the browser sends <C>navigator.globalPrivacyControl === true</C>, the tag adds <C>gpc: true</C> to the consent it sends. The opt-out is recorded per lead and applied server-side according to the workspace&apos;s policy.
            </p>

            <H3 id="tag-never">What the tag never captures</H3>
            <ul>
              <li>Password fields; forms that contain a password input (login and sign-up forms) are ignored entirely.</li>
              <li>
                Fields whose key or <C>autocomplete</C> looks like payment or government-ID data: pass/pwd, card, cc-, cvv/cvc, SSN/social, IBAN, account number, routing, tax ID, PIN.
              </li>
              <li>Free-text fields whose key contains message, comment or note.</li>
              <li>Query strings: the landing URL and referrer are stored without them, so personal data in URLs is never kept.</li>
              <li>Identity in the browser: email and phone are sent only with a lead and never stored in cookies or localStorage. The browser keeps only a random visitor ID and the ad touches (localStorage plus a 90-day first-party cookie holding the visitor ID).</li>
            </ul>

            {/* 3 ------------------------------------------------------------------ */}
            <h2 id="ingest" className="scroll-mt-20">
              3. Server Ingest API
            </h2>
            <p>
              <C>POST {origin}/v1/leads</C> sends a lead from your own back end, for example your form handler or a call-tracking system.
            </p>

            <H3 id="ingest-auth">Authentication</H3>
            <p>
              Create an API key under <strong>Sites &amp; API</strong>. Keys look like <C>ose_&lt;prefix&gt;_&lt;secret&gt;</C> (an 8-character lowercase prefix, then at least 20 characters) and carry scopes: <C>ingest</C> for writes, <C>read</C> for status and reports. The key is shown once; only its hash is stored. Send it as <C>Authorization: Bearer ose_…</C>.
            </p>

            <H3 id="ingest-signature">Request signature</H3>
            <p>
              Every write (<C>POST /v1/leads</C>, <C>POST /v1/leads/{"{id}"}/stage</C>) must also be signed with the same key:
            </p>
            <Code>{`X-OSE-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(api_key, "<t>.<raw body>")>`}</Code>
            <p>
              Sign the exact bytes you send. Timestamps more than 5 minutes (300 seconds) from server time are rejected, which blocks replays.
            </p>

            <H3 id="ingest-idempotency">Idempotency</H3>
            <p>
              Send an <C>Idempotency-Key</C> header (up to 200 characters, unique per lead in your system). A repeated key returns the original response with status <C>200</C> and an <C>Idempotent-Replay: true</C> header instead of creating a second lead.
            </p>

            <H3 id="ingest-body">Body</H3>
            <Table
              head={["Field", "Type", "Notes"]}
              rows={[
                [<C key="a">site_key</C>, "string ≤ 100", "Optional. Links the lead to a site so the visitor's recorded touches can be used."],
                [<C key="a">form</C>, "string ≤ 100", "Form name used in reports and scoring."],
                [<C key="a">visitor_id</C>, "string ≤ 100", "The tag's visitor ID (hidden input ose_visitor). With site_key, attribution is bound server-side from recorded visits."],
                [<C key="a">external_ref</C>, "string ≤ 200", "Your ID for the lead; also used to match later CRM events."],
                [<C key="a">email</C>, "string ≤ 320", "Normalised and hashed (SHA-256) on arrival."],
                [<C key="a">phone</C>, "string ≤ 40", "Normalised and hashed on arrival."],
                [<C key="a">name</C>, "string ≤ 200", ""],
                [<C key="a">geo</C>, "string ≤ 100", "Region, state or postcode used by scoring."],
                [<C key="a">answers</C>, "object", "Keys ≤ 48 chars; values string ≤ 500, number or null. Defaults to {}."],
                [
                  <C key="a">attribution</C>,
                  "object",
                  "Optional: gclid, gbraid, wbraid, msclkid, fbclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, campaign_id, adgroup_id, keyword, device, landing_url, referrer, click_ts (ISO 8601 with offset). Fills gaps only; server-recorded visits take precedence.",
                ],
                [<C key="a">consent</C>, "object", "Optional: ad_user_data and ad_personalization (granted | denied | unknown), gpc (boolean)."],
                [<C key="a">test</C>, "boolean", "Marks a test lead; test leads are never uploaded to ad platforms."],
              ]}
            />
            <Code>{ingestBody}</Code>

            <H3 id="ingest-examples">Examples</H3>
            <p>curl:</p>
            <Code>{curlSample}</Code>
            <p>Node.js (18+):</p>
            <Code>{nodeSample}</Code>
            <p>PHP:</p>
            <Code>{phpSample}</Code>

            <H3 id="ingest-response">Response</H3>
            <p>
              <C>201 Created</C> for a new lead, <C>200</C> for an idempotent replay or duplicate.
            </p>
            <Code>{ingestResponse}</Code>

            <H3 id="ingest-errors">Errors</H3>
            <Table
              head={["Status", "Meaning"]}
              rows={[
                ["400", "Body is not valid JSON."],
                ["401", "Missing, malformed, revoked or unknown API key, or an invalid or expired X-OSE-Signature."],
                ["403", 'The key lacks the "ingest" scope.'],
                ["413", "Body larger than 64 KB."],
                ["422", "Validation failed; the issues array lists each path and message."],
                ["429", "More than 600 requests per minute for this key; honour Retry-After (60 s)."],
              ]}
            />
            <Code>{validationError}</Code>

            {/* 4 ------------------------------------------------------------------ */}
            <h2 id="lead-status" className="scroll-mt-20">
              4. Lead status
            </h2>
            <p>
              <C>GET {origin}/v1/leads/{"{id}"}</C> returns a lead&apos;s status, value, stage history and ad uploads. It needs a key with the <C>read</C> scope; no signature is required because there is no body. Raw contact data is never returned. Unknown IDs, or IDs from another workspace, return <C>404</C>.
            </p>
            <Code>{statusSample}</Code>
            <Code>{statusResponse}</Code>
            <Table
              head={["Field", "Meaning"]}
              rows={[
                [<C key="a">score, score_version, lead_type, velocity_band</C>, "Scoring result and the model version that produced it."],
                [<C key="a">canonical_stage, lost_reason</C>, "Current stage on the canonical ladder."],
                [<C key="a">value_current, currency</C>, "Current modelled value of the lead."],
                [<C key="a">click_ts, window_expires_on</C>, "Ad click time and the last date conversions can still be uploaded."],
                [<C key="a">is_test</C>, "Test leads are never uploaded."],
                [<C key="a">stages[]</C>, "canonical_stage, occurred_at, source for each stage change."],
                [<C key="a">signals[]</C>, "platform, canonical_stage, mode, status, value_increment, cumulative_after, sent_at, error for each upload."],
              ]}
            />

            {/* 5 ------------------------------------------------------------------ */}
            <h2 id="stage-changes" className="scroll-mt-20">
              5. Stage changes
            </h2>
            <p>
              <C>POST {origin}/v1/leads/{"{id}"}/stage</C> lets any CRM move a lead with one call. It uses the same Bearer key (<C>ingest</C> scope) and <C>X-OSE-Signature</C> as the Ingest API.
            </p>
            <Table
              head={["Field", "Type", "Notes"]}
              rows={[
                [<C key="a">stage</C>, "enum, required", stages],
                [<C key="a">occurred_at</C>, "ISO 8601 with offset", "Optional. When the change happened in the CRM; defaults to now."],
                [<C key="a">actual_value</C>, "number ≥ 0", "Optional. Real deal value, for example at funded."],
                [<C key="a">lost_reason</C>, "string ≤ 200", "Optional, with stage lost."],
              ]}
            />
            <p>
              Returns <C>202 Accepted</C> with <C>{"{ lead_id, canonical_stage }"}</C>. Value recalculation and uploads happen in the background. A lead never moves down the ladder for value purposes: a lower stage after a higher one is recorded, but the current stage stays at the highest rung. Sending a rung after <C>lost</C> re-opens the lead. Errors: <C>400</C>, <C>401</C>, <C>403</C>, <C>404</C> (lead not found), <C>422</C>.
            </p>
            <Code>{stageSample}</Code>

            {/* 6 ------------------------------------------------------------------ */}
            <h2 id="generic-webhook" className="scroll-mt-20">
              6. Generic CRM webhook
            </h2>
            <p>
              <C>POST {origin}/v1/webhooks/generic/{"{workspaceId}"}</C> is for CRMs and call trackers that can send a webhook but cannot call the stage API with a lead ID. The URL and the workspace secret are on the <strong>Sites &amp; API</strong> screen. Generating a new secret invalidates the previous one immediately.
            </p>
            <p>
              Sign each request with the workspace secret (not an API key): <C>X-OSE-Signature: t=&lt;unix&gt;,v1=&lt;hex HMAC-SHA256(secret, &quot;t.body&quot;)&gt;</C>, with the same 5-minute tolerance. The endpoint stores the event and returns <C>202</C> with <C>{"{ ok: true, duplicate }"}</C>. Processing happens in the background.
            </p>
            <Code>{genericPayload}</Code>
            <ul>
              <li>
                <strong>Deduplication:</strong> <C>event_id</C> is the dedupe key; a repeated ID returns <C>duplicate: true</C> and is not processed again. If omitted, a SHA-256 hash of the raw body is used.
              </li>
              <li>
                <strong>Lead matching</strong>, in order: <C>lead_id</C>, <C>contact_id</C> (linked from an earlier event), <C>external_ref</C>, <C>email</C>, <C>phone</C> (both matched by hash; the most recent lead wins). When a <C>contact_id</C> is sent, it is linked to the matched lead so later events can match on it alone. Events that cannot be matched raise an alert in the workspace.
              </li>
              <li>
                <strong>Stage:</strong> send either a canonical <C>stage</C> (<C>{stages}</C>), or <C>pipeline_id</C> + <C>stage_id</C> (plus an optional <C>stage_name</C>) which are mapped to canonical stages on the <strong>CRM stages</strong> screen. Stages mapped to &quot;ignore&quot; or not yet mapped do not change the lead.
              </li>
              <li>
                <C>occurred_at</C>, <C>actual_value</C> and <C>lost_reason</C> behave as in the stage API.
              </li>
            </ul>
            <Code>{genericNode}</Code>

            {/* 7 ------------------------------------------------------------------ */}
            <h2 id="ghl" className="scroll-mt-20">
              7. HighLevel app
            </h2>
            <p>
              Connecting HighLevel from the workspace installs the marketplace app for one location. Its events arrive at <C>{origin}/v1/webhooks/ghl</C> and are handled as follows:
            </p>
            <Table
              head={["Event", "Effect"]}
              rows={[
                [<C key="a">ContactCreate, ContactUpdate</C>, "Links the HighLevel contact to a lead by contact ID, email or phone."],
                [<C key="a">OpportunityCreate, OpportunityStageUpdate</C>, "Links the opportunity and records the mapped canonical stage. At funded, the opportunity's monetary value is used as the actual value."],
                [<C key="a">OpportunityStatusUpdate</C>, "Status lost records the lead as lost."],
                [<C key="a">AppUninstall</C>, "Stops sync, wipes the stored tokens and raises an alert."],
              ]}
            />
            <p>
              Webhooks are verified with HighLevel&apos;s Ed25519 signature (<C>X-GHL-Signature</C>, base64, over the raw body). The legacy RSA <C>X-WH-Signature</C> is not accepted. Events are de-duplicated on <C>webhookId</C>, acknowledged fast, and processed in the background. Pipeline stages are mapped on the <strong>CRM stages</strong> screen.
            </p>
            <p>The app creates these contact custom fields in the location and keeps them up to date:</p>
            <Table head={["Field key", "Name", "Type"]} rows={GHL_FIELDS.map((f) => [<C key={f.key}>contact.{f.key}</C>, f.name, f.type])} />

            {/* 8 ------------------------------------------------------------------ */}
            <h2 id="outbound-webhooks" className="scroll-mt-20">
              8. Outbound webhooks
            </h2>
            <p>
              Workspace admins can add endpoint URLs under <strong>Sites &amp; API</strong> to receive events as they happen. Each endpoint has its own signing secret.
            </p>
            <Table
              head={["Event", "data fields"]}
              rows={[
                [<C key="a">lead.created</C>, "lead_id, created_at, score, lead_type, source, form"],
                [<C key="a">lead.stage_changed</C>, "lead_id, stage, occurred_at, value_current"],
                [<C key="a">signal.sent</C>, "lead_id, platform, stage, value_increment, cumulative_after, mode, sent_at"],
                [<C key="a">signal.failed</C>, "lead_id, platform, stage, error"],
                [<C key="a">alert.raised</C>, "type, severity, title"],
              ]}
            />
            <p>
              Every delivery is a JSON <C>POST</C> with the envelope <C>{"{ id, type, created_at, workspace_id, data }"}</C> and these headers:
            </p>
            <ul>
              <li>
                <C>X-OSE-Event</C>: the event type.
              </li>
              <li>
                <C>X-OSE-Delivery</C>: a UUID for this delivery; use it to de-duplicate.
              </li>
              <li>
                <C>X-OSE-Signature</C>: <C>t=&lt;unix&gt;,v1=&lt;hex HMAC-SHA256(endpoint secret, &quot;t.body&quot;)&gt;</C>.
              </li>
            </ul>
            <Code>{envelope}</Code>
            <p>
              Respond with any 2xx status within 10 seconds. Failed deliveries (non-2xx, timeout or connection error) are retried up to 6 times with backoff, so make your handler idempotent.
            </p>
            <Code>{verifyNode}</Code>

            {/* 9 ------------------------------------------------------------------ */}
            <h2 id="reports" className="scroll-mt-20">
              9. Reports API
            </h2>
            <p>
              <C>GET {origin}/v1/reports/funnel?days=30</C> returns funnel counts and value for the last <C>days</C> days. It needs a key with the <C>read</C> scope.
            </p>
            <Code>{reportSample}</Code>
            <Code>{reportResponse}</Code>
            <Table
              head={["Field", "Meaning"]}
              rows={[
                [<C key="a">days, from</C>, "Window length and its start date."],
                [<C key="a">funnel[]</C>, "{ stage, count } for each canonical rung."],
                [<C key="a">lost</C>, "Leads lost in the window."],
                [<C key="a">value_total, currency</C>, "Total current value of leads in the window."],
                [<C key="a">by_lead_type[], by_campaign[]</C>, "{ key, leads, qualified, contract, funded, value } per lead type or campaign."],
              ]}
            />

            {/* 10 ----------------------------------------------------------------- */}
            <h2 id="limits" className="scroll-mt-20">
              10. Rate limits &amp; errors
            </h2>
            <Table
              head={["Endpoint", "Limit"]}
              rows={[
                [<C key="a">POST /v1/collect</C>, "120 requests per minute per IP (also 3,000 per minute per site)"],
                [<C key="a">POST /v1/leads</C>, "600 requests per minute per API key"],
                [<C key="a">POST /v1/webhooks/generic/{"{workspaceId}"}</C>, "1,200 requests per minute per workspace"],
              ]}
            />
            <p>
              Over the limit you get <C>429</C>; wait for the next minute and retry with backoff. Errors are JSON of the form <C>{'{ "error": "message" }'}</C>; validation errors add an <C>issues</C> array. Responses are sent with <C>Cache-Control: no-store</C>.
            </p>
            <Table
              head={["Status", "Meaning"]}
              rows={[
                ["400", "Invalid JSON."],
                ["401", "Missing or invalid API key or signature."],
                ["403", "Key lacks the required scope, or the tag's Origin is not on the site's allow-list."],
                ["404", "Unknown lead, site or workspace."],
                ["413", "Body too large (tag beacons 32 KB, API and webhooks 64 KB)."],
                ["422", "Validation failed."],
                ["429", "Rate limit exceeded."],
                ["503", "Service not configured."],
              ]}
            />

            {/* 11 ----------------------------------------------------------------- */}
            <h2 id="data-handling" className="scroll-mt-20">
              11. Data handling
            </h2>
            <ul>
              <li>Email and phone are normalised and hashed (SHA-256) on arrival. Raw contact details are optional, encrypted and deleted automatically.</li>
              <li>The API never returns raw contact data; lead status responses contain scores, stages, values and upload results only.</li>
              <li>Consent signals and Global Privacy Control opt-outs are recorded per lead and respected before any upload.</li>
              <li>The tag never reads password, payment-card or government-ID fields, ignores login forms and never stores query strings.</li>
              <li>Each workspace&apos;s data is isolated; keys and secrets are stored hashed or encrypted.</li>
            </ul>
            <p>
              See the <Link href="/privacy" className="text-brand hover:underline">privacy policy</Link> and the <Link href="/trust" className="text-brand hover:underline">trust &amp; sub-processors</Link> page for details.
            </p>
          </Prose>
        </div>
      </div>
    </PublicShell>
  );
}
