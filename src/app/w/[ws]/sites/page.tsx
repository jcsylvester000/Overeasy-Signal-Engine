import { headers } from "next/headers";
import { requireWorkspace } from "@/lib/tenancy";
import { nowMs } from "@/lib/time";
import { userClient } from "@/lib/supabase/server";
import { SecretForm } from "@/components/secret-form";
import { Badge, Button, Card, Field, Notice, PageHeader, Table, Td, when } from "@/components/ui";
import { addSite, checkSiteInstall, createApiKey, revokeApiKey, rotateWebhookSecret, updateOrigins } from "../actions";
import { CopyBlock, InstallGuide } from "@/components/install-guide";
import type { InstallCheck } from "@/server/install-check";
import { addWebhook, removeWebhook, testWebhook } from "../ops-actions";
import { OUTBOUND_EVENTS } from "@/server/outbound";

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
  const [{ data: hooks }, { data: deliveries }] =
    rank >= 4
      ? await Promise.all([
          sb.from("outbound_webhooks").select("id,url,events,last_status,last_at,failures").eq("workspace_id", ws.id).order("created_at"),
          sb.from("outbound_deliveries").select("id,event,status,response_code,error,attempts,created_at").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(15),
        ])
      : [{ data: [] as never[] }, { data: [] as never[] }];
  const selected = sites?.find((s) => s.id === sp.site) ?? sites?.[0];
  const { data: recentVisits } = selected ? await sb.from("visits").select("created_at,touch,gclid,gbraid,wbraid,msclkid,utm_source,utm_campaign,landing_url").eq("site_id", selected.id).order("created_at", { ascending: false }).limit(25) : { data: [] };
  const { data: recentLeads } = selected ? await sb.from("leads").select("id,created_at,form,score,lead_type,source,capture_via").eq("site_id", selected.id).order("created_at", { ascending: false }).limit(25) : { data: [] };
  const since = new Date(nowMs() - 30 * 86_400_000).toISOString();
  const [{ data: pages }, { data: leads30 }] = selected
    ? await Promise.all([
        sb.from("site_pages").select("path,forms,embeds,hits,last_seen_at,tag_version").eq("site_id", selected.id).order("last_seen_at", { ascending: false }).limit(40),
        sb.from("leads").select("form,capture_via").eq("site_id", selected.id).gte("created_at", since).limit(5000),
      ])
    : [{ data: [] }, { data: [] }];
  // Leads per form (30 days), and how they were confirmed.
  const perForm = new Map<string, { n: number; via: Record<string, number> }>();
  for (const l of leads30 ?? []) {
    const k = l.form ?? "—";
    const e = perForm.get(k) ?? { n: 0, via: {} };
    e.n++;
    const v = l.capture_via ?? "submit";
    e.via[v] = (e.via[v] ?? 0) + 1;
    perForm.set(k, e);
  }
  type PageForm = { n: string; k: string[]; e: boolean; t: boolean };

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
              {(() => {
                const check = s.last_check as InstallCheck | null;
                const snippet = `<script async src="${tagOrigin}/ose.js" data-site="${s.site_key}"></script>`;
                return (
                  <>
                    <div className="mb-4 grid gap-3 rounded border border-line p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="text-sm">
                        <div className="font-medium">
                          {fresh ? "Tag detected: live" : s.last_event_at ? "Tag installed, but quiet" : "Tag not detected yet"}
                        </div>
                        <div className="text-xs text-muted">
                          {fresh
                            ? `Last event ${when(s.last_event_at)} · tag ${s.tag_version ?? "—"}. Forms found are listed below.`
                            : s.last_event_at
                              ? `Last event ${when(s.last_event_at)}. Check that the snippet is still on the site.`
                              : "Install the snippet below, then open the site in a browser. This turns green within seconds."}
                        </div>
                        {check && (
                          <div className="mt-1 text-xs">
                            <Badge tone={check.status === "found" ? "green" : check.status === "via_tag_manager" ? "blue" : "amber"}>{check.status.replace(/_/g, " ")}</Badge>{" "}
                            <span className="text-muted">
                              Checked {when(check.at)}: {check.detail}
                            </span>
                          </div>
                        )}
                      </div>
                      <form action={checkSiteInstall.bind(null, ws.id, s.id)}>
                        <Button variant="secondary">Check install</Button>
                      </form>
                    </div>
                    <div className="text-xs font-medium">Install: pick where the site is built</div>
                    <div className="mt-2">
                      <InstallGuide snippet={snippet} />
                    </div>
                    <details className="mt-4 text-sm">
                      <summary className="cursor-pointer text-xs font-medium">Options: consent, confirmation, embedded forms, custom forms</summary>
                      <div className="mt-2 space-y-2 text-xs">
                        <p>Add any of these to the script tag:</p>
                        <ul className="list-disc space-y-1 pl-5">
                          <li><code>data-consent=&quot;required&quot;</code>: EU/UK/Swiss sites. Nothing is stored or sent until the consent banner grants <code>ad_storage</code>.</li>
                          <li><code>data-confirm=&quot;off&quot;</code>: count a lead as soon as the form is submitted. By default a lead counts only after a success message, the form hiding, or a page change, and is dropped if validation errors appear.</li>
                          <li><code>data-embed-params=&quot;on&quot;</code>: pass the visitor id and click ids into embedded forms (GoHighLevel, Typeform, JotForm, HubSpot…) so CRM hidden fields can carry them.</li>
                          <li><code>data-embed-origins=&quot;forms.client.com&quot;</code>: treat iframes from these hosts (for example a CRM&apos;s custom form domain) as embedded forms.</li>
                          <li><code>data-embeds=&quot;off&quot;</code>: ignore embedded third-party forms.</li>
                        </ul>
                        <CopyBlock
                          dark={false}
                          text={`<form data-ose-form="quote"> <input name="email" data-ose-field="email"> … </form>
<form data-ose-ignore> … never tracked … </form>
<div data-ose-success>Thanks!</div>   <!-- marks a custom success message -->

<script>
  // Custom/React forms: call after your own submit succeeds
  window.ose && ose.lead({ form: "quote", email, phone, answers: { service: "install" } })
</script>`}
                        />
                        <p className="text-muted">Never tracked: password and login forms, card, bank and ID-number fields, free-text messages.</p>
                      </div>
                    </details>
                  </>
                );
              })()}
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
          <Card title={`Forms found — ${selected.domain}`} description="Forms and embedded forms the tag has seen, per page (field names only, never values), with leads in the last 30 days.">
            <Table head={["Page", "Form", "Fields", "Leads (30 d)", "Confirmed by", "Last seen"]} empty="Nothing yet. Open a page with a form on the site (tag 1.1 or later).">
              {(pages ?? []).flatMap((pg) => {
                const forms = (pg.forms as PageForm[]) ?? [];
                const embeds = (pg.embeds as string[]) ?? [];
                const rows = [
                  ...forms.map((f) => ({ key: `${pg.path}|${f.n}`, name: f.n, fields: `${f.k.length} fields${f.e ? " · email" : ""}${f.t ? " · phone" : ""}`, stats: perForm.get(f.n) })),
                  ...embeds.map((v) => ({ key: `${pg.path}|embed:${v}`, name: `${v} (embedded)`, fields: "inside iframe", stats: perForm.get(`${v} form`) ?? perForm.get(`${v} booking`) })),
                ];
                if (!rows.length) rows.push({ key: `${pg.path}|none`, name: "—", fields: "no forms on this page", stats: undefined });
                return rows.map((r) => (
                  <tr key={r.key}>
                    <Td mono>{pg.path}</Td>
                    <Td>{r.name}</Td>
                    <Td className="text-xs">{r.fields}</Td>
                    <Td className="num">{r.stats?.n ?? 0}</Td>
                    <Td className="text-xs">{r.stats ? Object.entries(r.stats.via).map(([k, n]) => `${k} ${n}`).join(" · ") : "—"}</Td>
                    <Td>{when(pg.last_seen_at)}</Td>
                  </tr>
                ));
              })}
            </Table>
            <p className="mt-2 text-xs text-muted">
              Confirmed by: <b>success</b> = success message shown · <b>form-hidden</b> = form replaced by a thank-you · <b>navigated</b> = went to the next page · <b>timeout</b> = no errors after 8 s · <b>embed:…</b> = embedded form&apos;s own submit event.
            </p>
          </Card>
        )}

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
                    <Td>{l.capture_via ?? l.source}</Td>
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

            <Card title="Outbound webhooks" description="We POST signed events to your endpoints (see Developer docs → Outbound webhooks). Failed deliveries retry up to 6 times.">
              <Table head={["Endpoint", "Events", "Last response", "Failures", ""]} empty="No endpoints yet.">
                {(hooks ?? []).map((w) => (
                  <tr key={w.id}>
                    <Td mono>{w.url}</Td>
                    <Td className="text-xs">{(w.events as string[]).join(", ")}</Td>
                    <Td>{w.last_status ? `${w.last_status} · ${when(w.last_at)}` : "—"}</Td>
                    <Td className="num">{w.failures}</Td>
                    <Td>
                      <form action={removeWebhook.bind(null, ws.id, w.id)}>
                        <button className="text-xs text-red-700 hover:underline">Remove</button>
                      </form>
                    </Td>
                  </tr>
                ))}
              </Table>
              <div className="mt-4 border-t border-line pt-4">
                <SecretForm action={addWebhook.bind(null, ws.id)} button="Add endpoint" note="Signing secret — copy it now; it will not be shown again.">
                  <Field label="Endpoint URL (https)">
                    <input name="url" type="url" required placeholder="https://example.com/hooks/signal-engine" className="w-full max-w-lg" />
                  </Field>
                  <fieldset className="flex flex-wrap gap-3 text-sm">
                    <legend className="mb-1 text-xs font-medium">Events</legend>
                    {OUTBOUND_EVENTS.map((e) => (
                      <label key={e} className="flex items-center gap-1">
                        <input type="checkbox" name={`ev:${e}`} defaultChecked /> {e}
                      </label>
                    ))}
                  </fieldset>
                </SecretForm>
              </div>
              {!!hooks?.length && (
                <form action={testWebhook.bind(null, ws.id)} className="mt-3">
                  <Button variant="secondary">Send a test event</Button>
                </form>
              )}
              {!!deliveries?.length && (
                <div className="mt-4">
                  <div className="mb-1 text-xs font-medium">Recent deliveries</div>
                  <Table head={["When", "Event", "Status", "Code", "Attempts"]}>
                    {(deliveries ?? []).map((d) => (
                      <tr key={d.id}>
                        <Td>{when(d.created_at)}</Td>
                        <Td>{d.event}</Td>
                        <Td>{d.status}</Td>
                        <Td>{d.response_code ?? d.error ?? "—"}</Td>
                        <Td className="num">{d.attempts}</Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
