import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { Button, Card, Field, Json, Notice, PageHeader, Status, Table, Td, when } from "@/components/ui";
import { addAutomation, removeAutomation, setAlertStatus } from "../actions";

export const metadata = { title: "Health" };

export default async function Health({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const sb = await userClient();
  const ws = { id: wsId };
  const [{ rank }, { data: alerts }, { data: conns }, { data: sites }, { data: autos }, { data: ops }, { data: inbox }] = await Promise.all([
    requireWorkspace(wsId),
    sb.from("alerts").select("*").eq("workspace_id", ws.id).neq("status", "resolved").order("created_at", { ascending: false }).limit(100),
    sb.from("connections").select("id,provider,display_name,mode,status,last_ok_at,error").eq("workspace_id", ws.id),
    sb.from("sites").select("id,domain,last_event_at").eq("workspace_id", ws.id),
    sb.from("automations").select("*").eq("workspace_id", ws.id).order("system"),
    sb.from("crm_ops").select("*").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(30),
    sb.from("webhook_inbox").select("id,provider,event_type,received_at,processed_at,error").eq("workspace_id", ws.id).order("received_at", { ascending: false }).limit(30),
  ]);

  return (
    <>
      <PageHeader title="Health" description="Nothing important runs in the background without visibility: connections, alerts, every automation, and every write to the CRM." />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      <div className="space-y-6">
        <Card title="Open alerts">
          <Table head={["Raised", "Severity", "Alert", "Status", ""]} empty="No open alerts.">
            {(alerts ?? []).map((a) => (
              <tr key={a.id}>
                <Td>{when(a.created_at)}</Td>
                <Td>
                  <Status value={a.severity} />
                </Td>
                <Td>{a.title}</Td>
                <Td>
                  <Status value={a.status} />
                </Td>
                <Td>
                  {rank >= 2 && (
                    <span className="flex gap-2">
                      {a.status === "open" && (
                        <form action={setAlertStatus.bind(null, ws.id, a.id, "acknowledged")}>
                          <button className="text-xs text-brand hover:underline">Acknowledge</button>
                        </form>
                      )}
                      <form action={setAlertStatus.bind(null, ws.id, a.id, "resolved")}>
                        <button className="text-xs text-brand hover:underline">Resolve</button>
                      </form>
                    </span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Connections">
            <Table head={["Connection", "Mode", "Status", "Last success"]}>
              {(conns ?? []).map((c) => (
                <tr key={c.id}>
                  <Td>{c.display_name ?? c.provider}</Td>
                  <Td>{c.mode}</Td>
                  <Td>
                    <Status value={c.status} />
                  </Td>
                  <Td>{when(c.last_ok_at)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Website tags">
            <Table head={["Site", "Last event"]} empty="No sites.">
              {(sites ?? []).map((s) => (
                <tr key={s.id}>
                  <Td>{s.domain}</Td>
                  <Td>{when(s.last_event_at)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <Card title="Automation registry" description="Every automation that touches leads — this system's jobs and any GHL workflow, Make or Zapier scenario — with owner, trigger, what it updates and what happens on failure.">
          <Table head={["Name", "System", "Owner", "Trigger", "Updates", "On failure", "Access", ""]}>
            {[
              { id: "ose-intake", name: "Lead intake & scoring", system: "this app", owner: "Platform", trigger: "Form submit / POST /v1/leads", updates: "Lead, score, CRM contact", on_failure: "Retried; alert", access: "Managers+", fixed: true },
              { id: "ose-stage", name: "Stage → value → upload", system: "this app", owner: "Platform", trigger: "CRM stage webhook", updates: "Signal jobs, CRM fields", on_failure: "Backoff ×8, then dead-letter + alert", access: "Managers+", fixed: true },
              { id: "ose-health", name: "Health & retention sweeps", system: "this app", owner: "Platform", trigger: "Hourly / daily", updates: "Alerts; purges expired PII", on_failure: "Logged", access: "—", fixed: true },
              ...(autos ?? []),
            ].map((a) => (
              <tr key={a.id}>
                <Td className="font-medium">{a.name}</Td>
                <Td>{a.system}</Td>
                <Td>{a.owner}</Td>
                <Td>{a.trigger}</Td>
                <Td>{a.updates}</Td>
                <Td>{a.on_failure}</Td>
                <Td>{a.access}</Td>
                <Td>
                  {!("fixed" in a) && rank >= 3 && (
                    <form action={removeAutomation.bind(null, ws.id, a.id)}>
                      <button className="text-xs text-red-700 hover:underline">Remove</button>
                    </form>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          {rank >= 3 && (
            <form action={addAutomation.bind(null, ws.id)} className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-4">
              <Field label="Name">
                <input name="name" required />
              </Field>
              <Field label="System">
                <select name="system">
                  {["ghl", "make", "zapier", "callrail", "google", "microsoft", "other"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Owner">
                <input name="owner" />
              </Field>
              <Field label="Trigger">
                <input name="trigger" />
              </Field>
              <Field label="What it updates">
                <input name="updates" />
              </Field>
              <Field label="On failure">
                <input name="on_failure" />
              </Field>
              <Field label="Who has access">
                <input name="access" />
              </Field>
              <div className="flex items-end">
                <Button variant="secondary">Register</Button>
              </div>
            </form>
          )}
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="CRM operations" description="Every contact upsert and field write-back (dry-run entries show what would be sent).">
            <Table head={["When", "Op", "Mode", "Status", "Detail"]} empty="None yet.">
              {(ops ?? []).map((o) => (
                <tr key={o.id}>
                  <Td>{when(o.created_at)}</Td>
                  <Td>{o.op}</Td>
                  <Td>{o.mode}</Td>
                  <Td>
                    <Status value={o.status} />
                  </Td>
                  <Td>{o.error ? <span className="text-xs text-red-700">{o.error}</span> : <Json value={o.request} />}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Incoming CRM webhooks">
            <Table head={["Received", "Provider", "Event", "Processed"]} empty="None yet.">
              {(inbox ?? []).map((w) => (
                <tr key={w.id}>
                  <Td>{when(w.received_at)}</Td>
                  <Td>{w.provider}</Td>
                  <Td>{w.event_type}</Td>
                  <Td>{w.error ? <span className="text-xs text-red-700">{w.error}</span> : when(w.processed_at)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
      </div>
    </>
  );
}
