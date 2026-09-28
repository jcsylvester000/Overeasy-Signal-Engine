import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { RUNGS, STAGE_LABEL } from "@/core/stages";
import { Badge, Button, Card, Field, Notice, PageHeader, Status, when } from "@/components/ui";
import { addConnection, reconnect, removeConnection, runGhlInstall, saveConnection, saveDestinations } from "../actions";

export const metadata = { title: "Connections" };

const PROVIDERS: Record<string, { name: string; account: string; login?: string; approval: string; oauthEnv: string }> = {
  google_ads: { name: "Google Ads", account: "Customer ID (123-456-7890)", login: "Manager (MCC) ID, if any", approval: "Google OAuth verification (Data Manager scope) + Google Ads API Basic access", oauthEnv: "GOOGLE_CLIENT_ID" },
  microsoft_ads: { name: "Microsoft Advertising", account: "Account ID", login: "Customer ID", approval: "Microsoft Advertising developer token + Entra app (msads.manage)", oauthEnv: "MICROSOFT_CLIENT_ID" },
  ghl: { name: "GoHighLevel", account: "Location (sub-account) ID", approval: "HighLevel Marketplace app approval (scopes lock once live)", oauthEnv: "GHL_CLIENT_ID" },
};

export default async function Connections({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws, rank } = await requireWorkspace(wsId, 3);
  const sb = await userClient();
  const [{ data: conns }, { data: dests }] = await Promise.all([
    sb.from("connections").select("*").eq("workspace_id", ws.id).order("provider"),
    sb.from("conversion_destinations").select("*").eq("workspace_id", ws.id),
  ]);
  const ceiling = env.connectorMode();
  const canEdit = rank >= 4;

  return (
    <>
      <PageHeader
        title="Connections"
        description="CRM and ad accounts. Every connection starts in dry run: payloads are built, validated and logged, but nothing is sent. Switch to test (Google validateOnly / Microsoft sandbox) and then live once platform access is approved."
      />
      <div className="mb-4 space-y-2">
        <Notice tone={ceiling === "live" ? "green" : "blue"}>
          Platform ceiling (CONNECTOR_MODE): <strong>{ceiling}</strong>. A connection can never run in a more live mode than this.
        </Notice>
        {sp.saved && <Notice tone="green">{sp.saved}</Notice>}
        {sp.error && <Notice tone="red">{sp.error}</Notice>}
      </div>

      <div className="space-y-6">
        {(conns ?? []).map((c) => {
          const p = PROVIDERS[c.provider] ?? { name: c.provider, account: "Account", approval: "", oauthEnv: "" };
          const oauthReady = Boolean(process.env[p.oauthEnv]);
          const d = (dests ?? []).filter((x) => x.connection_id === c.id);
          return (
            <Card
              key={c.id}
              title={
                <span className="flex items-center gap-2">
                  {c.display_name ?? p.name} <Status value={c.status} /> <Badge tone={c.mode === "live" ? "green" : c.mode === "test" ? "purple" : "blue"}>{c.mode}</Badge>
                </span>
              }
              description={`Last success: ${when(c.last_ok_at)}${c.error ? ` · ${c.error}` : ""}`}
              actions={
                canEdit &&
                (c.status === "disconnected" ? (
                  <form action={reconnect.bind(null, ws.id, c.id)}>
                    <Button variant="secondary">Enable</Button>
                  </form>
                ) : (
                  <form action={removeConnection.bind(null, ws.id, c.id)}>
                    <Button variant="secondary">Disconnect</Button>
                  </form>
                ))
              }
            >
              <form action={saveConnection.bind(null, ws.id, c.id)} className="grid gap-3 sm:grid-cols-4">
                <Field label="Name">
                  <input name="display_name" defaultValue={c.display_name ?? ""} disabled={!canEdit} />
                </Field>
                <Field label={p.account}>
                  <input name="external_account" defaultValue={c.external_account ?? ""} disabled={!canEdit} />
                </Field>
                {p.login ? (
                  <Field label={p.login}>
                    <input name="login_account" defaultValue={c.login_account ?? ""} disabled={!canEdit} />
                  </Field>
                ) : (
                  <div />
                )}
                <Field label="Mode">
                  <select name="mode" defaultValue={c.mode} disabled={!canEdit}>
                    <option value="dry_run">Dry run</option>
                    <option value="test">Test</option>
                    <option value="live">Live</option>
                  </select>
                </Field>
                {canEdit && (
                  <div className="sm:col-span-4">
                    <Button variant="secondary">Save</Button>
                  </div>
                )}
              </form>
              <div className="mt-3 rounded-md bg-gray-50 p-3 text-xs text-muted">
                <strong className="text-ink">Sign-in (OAuth):</strong>{" "}
                {oauthReady ? "App credentials present — the connect flow will be enabled once approval completes." : <>Awaiting approval: {p.approval}. Tokens will be stored in Supabase Vault, never in plain tables.</>}
              </div>

              {c.provider === "ghl" && canEdit && (
                <form action={runGhlInstall.bind(null, ws.id, c.id)} className="mt-3">
                  <Button variant="secondary">Create OSE custom fields in the CRM</Button>
                </form>
              )}

              {(c.provider === "google_ads" || c.provider === "microsoft_ads") && (
                <form action={saveDestinations.bind(null, ws.id, c.id)} className="mt-4 border-t border-line pt-4">
                  <div className="mb-2 text-sm font-medium">{c.provider === "google_ads" ? "Conversion action per stage" : "Offline conversion goal per stage"}</div>
                  <p className="mb-3 text-xs text-muted">
                    One per stage so each can be switched between primary and secondary on its own. Start as secondary (observation) for about 30 days.
                    {c.provider === "microsoft_ads" && " Wait 2 hours after creating a goal before the first upload."}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {RUNGS.map((r) => {
                      const cur = d.find((x) => x.canonical_stage === r);
                      return (
                        <div key={r} className="flex items-end gap-2">
                          <Field label={STAGE_LABEL[r]}>
                            <input name={`dest:${r}`} defaultValue={(c.provider === "google_ads" ? cur?.conversion_action_id : cur?.goal_name) ?? ""} placeholder={c.provider === "google_ads" ? "Action ID" : "Goal name"} disabled={!canEdit} />
                          </Field>
                          <select name={`role:${r}`} defaultValue={cur?.role ?? "secondary"} aria-label={`${STAGE_LABEL[r]} role`} disabled={!canEdit}>
                            <option value="secondary">secondary</option>
                            <option value="primary">primary</option>
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  {canEdit && <Button variant="secondary" className="mt-3">Save destinations</Button>}
                </form>
              )}
            </Card>
          );
        })}
      </div>

      {canEdit && (
        <Card title="Add a connection" className="mt-6">
          <form action={addConnection.bind(null, ws.id)} className="flex flex-wrap items-end gap-3">
            <Field label="Provider">
              <select name="provider">
                <option value="google_ads">Google Ads</option>
                <option value="microsoft_ads">Microsoft Advertising</option>
                <option value="ghl">GoHighLevel</option>
              </select>
            </Field>
            <Field label="Name">
              <input name="display_name" placeholder="e.g. Google – Brand account" />
            </Field>
            <Button variant="secondary">Add (dry run)</Button>
          </form>
        </Card>
      )}
    </>
  );
}
