import { headers } from "next/headers";
import { requireWorkspace } from "@/lib/tenancy";
import { nowMs } from "@/lib/time";
import { userClient } from "@/lib/supabase/server";
import { SecretForm } from "@/components/secret-form";
import { Badge, Button, Card, Field, Notice, PageHeader, Table, Td, when } from "@/components/ui";
import { addSite, createApiKey, revokeApiKey, rotateWebhookSecret, updateOrigins } from "../actions";

export const metadata = { title: "Sites & API" };

export default async function Sites({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string; site?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws, org, rank } = await requireWorkspace(wsId, 3);
  const sb = await userClient();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "app.example.com";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const tagOrigin = org.tag_domain ? `https://${org.tag_domain}` : `${proto}://${host}`;
  const apiOrigin = `${proto}://${host}`;

  const [{ data: sites }, { data: keys }] = await Promise.all([
    sb.from("sites").select("*").eq("workspace_id", ws.id).order("created_at"),
    rank >= 4 ? sb.from("api_keys").select("*").eq("workspace_id", ws.id).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as never[] }),
  ]);
  const selected = sites?.find((s) => s.id === sp.site) ?? sites?.[0];
  const { data: recentVisits } = selected ? await sb.from("visits").select("created_at,touch,gclid,gbraid,wbraid,msclkid,utm_source,utm_campaign,landing_url").eq("site_id", selected.id).order("created_at", { ascending: false }).limit(25) : { data: [] };
  const { data: recentLeads } = selected ? await sb.from("leads").select("id,created_at,form,score,lead_type,source").eq("site_id", selected.id).order("created_at", { ascending: false }).limit(25) : { data: [] };

  return (
    <>
      <PageHeader title="Sites & API" description="Install the tag on any website (any CMS or custom code), or send leads from a back end with the Ingest API." />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}

      <div className="space-y-6">
        {(sites ?? []).map((s) => {
          const fresh = s.last_event_at && nowMs() - new Date(s.last_event_at).getTime() < 24 * 3_600_000;
          return (
            <Card
              key={s.id}
              title={
                <span className="flex items-center gap-2">
                  {s.domain} {fresh ? <Badge tone="green">receiving events</Badge> : <Badge tone="amber">no events in 24 h</Badge>}
                </span>
              }
              description={`Last event ${when(s.last_event_at)} · tag ${s.tag_version ?? "—"}`}
            >
              <div className="text-xs font-medium">1. Paste before &lt;/head&gt; (or use Google Tag Manager → Custom HTML)</div>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{`<script async src="${tagOrigin}/ose.js" data-site="${s.site_key}"></script>`}</pre>
              <div className="mt-3 text-xs font-medium">2. Optional: name forms and fields explicitly, or send a lead from JavaScript</div>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-3 text-xs">{`<form data-ose-form="quote"> <input name="email" data-ose-field="email"> … </form>
<form data-ose-ignore> … never tracked … </form>

<script>
  // Custom/React forms: call after your own submit succeeds
  window.ose && ose.lead({ form: "quote", email, phone, answers: { service: "install" } })
</script>`}</pre>
              <p className="mt-2 text-xs text-muted">
                Checklist: forms submit with POST (no personal data in URLs) · one tag manager container · auto-tagging on in Google Ads and Microsoft Ads · privacy policy discloses sharing with ad platforms.
              </p>
              <form action={updateOrigins.bind(null, ws.id, s.id)} className="mt-3 flex flex-wrap items-end gap-2">
                <Field label="Allowed origins" hint="Only pages on these origins can send events with this site key.">
                  <input name="origins" defaultValue={(s.allowed_origins ?? []).join(" ")} className="w-[28rem] max-w-full" />
                </Field>
                <Button variant="secondary">Save origins</Button>
              </form>
            </Card>
          );
        })}

        <Card title="Add a website">
          <form action={addSite.bind(null, ws.id)} className="flex flex-wrap items-end gap-3">
            <Field label="Domain">
              <input name="domain" placeholder="example.com" required />
            </Field>
            <Field label="Allowed origins (optional)">
              <input name="origins" placeholder="https://example.com https://www.example.com" className="w-80" />
            </Field>
            <Button variant="secondary">Add site</Button>
          </form>
        </Card>

        {selected && (
          <Card title={`Live event debugger — ${selected.domain}`} description="Last 25 ad visits and leads received from this site.">
            <div className="grid gap-6 lg:grid-cols-2">
              <Table head={["When", "Touch", "Click ID", "Source / campaign"]} empty="No ad visits yet. Open the site with ?gclid=TEST123 to test.">
                {(recentVisits ?? []).map((v, i) => (
                  <tr key={i}>
                    <Td>{when(v.created_at)}</Td>
                    <Td>{v.touch}</Td>
                    <Td mono>{v.gclid ?? v.gbraid ?? v.wbraid ?? v.msclkid ?? "—"}</Td>
                    <Td>
                      {v.utm_source ?? "—"} / {v.utm_campaign ?? "—"}
                    </Td>
                  </tr>
                ))}
              </Table>
              <Table head={["When", "Form", "Score", "Type", "Via"]} empty="No leads yet.">
                {(recentLeads ?? []).map((l) => (
                  <tr key={l.id}>
                    <Td>{when(l.created_at)}</Td>
                    <Td>{l.form}</Td>
                    <Td className="num">{l.score}</Td>
                    <Td>{l.lead_type}</Td>
                    <Td>{l.source}</Td>
                  </tr>
                ))}
              </Table>
            </div>
          </Card>
        )}

        {rank >= 4 && (
          <>
            <Card title="Ingest API keys" description="For server-side lead ingest (POST /v1/leads) and reading lead status. Keys are stored hashed and shown once.">
              <Table head={["Name", "Key", "Scopes", "Last used", ""]} empty="No keys yet.">
                {(keys ?? []).map((k) => (
                  <tr key={k.id}>
                    <Td>{k.name}</Td>
                    <Td mono>ose_{k.prefix}_…</Td>
                    <Td>{(k.scopes as string[]).join(", ")}</Td>
                    <Td>{when(k.last_used_at)}</Td>
                    <Td>
                      {k.revoked_at ? (
                        <Badge tone="red">revoked</Badge>
                      ) : (
                        <form action={revokeApiKey.bind(null, ws.id, k.id)}>
                          <button className="text-xs text-red-700 hover:underline">Revoke</button>
                        </form>
                      )}
                    </Td>
                  </tr>
                ))}
              </Table>
              <div className="mt-4 border-t border-line pt-4">
                <SecretForm action={createApiKey.bind(null, ws.id)} button="Create key" note="Copy this key now. It will not be shown again.">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Name">
                      <input name="name" placeholder="Website back end" required />
                    </Field>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="scope:ingest" defaultChecked /> ingest
                    </label>
                    <label className="flex items-center gap-1">
                      <input type="checkbox" name="scope:read" /> read
                    </label>
                  </div>
                </SecretForm>
              </div>
              <pre className="mt-4 overflow-x-auto rounded bg-gray-50 p-3 text-xs">{`POST ${apiOrigin}/v1/leads
Authorization: Bearer ose_xxxxxxxx_…
Idempotency-Key: <your form submission id>
X-OSE-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(key, t + "." + body)>
Content-Type: application/json

{ "site_key": "${selected?.site_key ?? "site_…"}", "form": "quote", "visitor_id": "<ose_visitor hidden field>",
  "email": "…", "phone": "…", "answers": { … },
  "attribution": { "gclid": "…", "click_ts": "2026-09-28T14:02:11Z" } }
→ 201 { "lead_id": "…", "score": 82, "lead_type": "…", "score_version": 3 }`}</pre>
            </Card>

            <Card title="Generic CRM webhook" description="Any CRM or call tracker can move leads through stages with one signed HTTP call.">
              <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs">{`POST ${apiOrigin}/v1/webhooks/generic/${ws.id}
X-OSE-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>

{ "event_id": "crm-123", "lead_id": "…" | "email": "…" | "external_ref": "…",
  "stage": "qualified" | "pipeline_id": "…", "stage_id": "…",
  "occurred_at": "…", "actual_value": 15000, "lost_reason": "…" }`}</pre>
              <div className="mt-3">
                <SecretForm action={rotateWebhookSecret.bind(null, ws.id)} button="Generate new secret" note="Copy this secret now. The previous one stops working immediately." />
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
