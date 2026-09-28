import { requireWorkspace } from "@/lib/tenancy";
import { userClient } from "@/lib/supabase/server";
import { DsarForm } from "@/components/dsar-form";
import { Button, Card, Field, Json, Notice, PageHeader, Table, Td, when } from "@/components/ui";
import { runDsar, savePrivacy } from "../ops-actions";

export const metadata = { title: "Privacy" };

export default async function Privacy({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 4);
  const sb = await userClient();
  const { data: log } = await sb.from("dsar_requests").select("*").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(50);
  const s = ws.settings as { regulatedVertical?: boolean; optOutPolicy?: string };

  return (
    <>
      <PageHeader title="Privacy" description="Upload policy for opt-outs and regulated verticals, and data-subject requests (access / delete). Not legal advice — confirm settings with counsel." />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}

      <Card title="Upload policy" className="mb-6">
        <form action={savePrivacy.bind(null, ws.id)} className="space-y-4">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="regulatedVertical" defaultChecked={Boolean(s.regulatedVertical)} className="mt-0.5" />
            <span>
              <strong>Regulated vertical</strong> (health, legal, criminal, divorce, financial distress). Hashed email/phone are never uploaded; conversions use click IDs only. Google does not allow enhanced conversions for these categories.
            </span>
          </label>
          <Field label="When a lead carries an opt-out signal (Global Privacy Control or a recorded opt-out)">
            <select name="optOutPolicy" defaultValue={s.optOutPolicy ?? "skip_upload"} className="max-w-md">
              <option value="skip_upload">Do not upload it to ad platforms (recommended)</option>
              <option value="click_id_only">Upload with click ID only, personalization denied</option>
            </select>
          </Field>
          <Field label="Reason for change (kept in the audit log)">
            <input name="reason" className="max-w-md" />
          </Field>
          <Button>Save policy</Button>
        </form>
      </Card>

      <Card title="Data-subject request" description="Finds a person by the hash of their email or phone. Delete removes lead records, raw contact details, visits, stage history, upload records and CRM logs in this workspace, and lists uploads that must be retracted on the ad platforms. The client deletes the contact in their own CRM." className="mb-6">
        <DsarForm action={runDsar.bind(null, ws.id)} />
      </Card>

      <Card title="Request log">
        <Table head={["When", "Type", "Subject (hash)", "Records", "Follow-up"]} empty="No requests yet.">
          {(log ?? []).map((r) => (
            <tr key={r.id}>
              <Td>{when(r.created_at)}</Td>
              <Td>{r.kind}</Td>
              <Td mono>{String(r.subject_hash).slice(0, 12)}…</Td>
              <Td className="num">{r.matched_leads}</Td>
              <Td>
                <Json value={r.detail} />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
