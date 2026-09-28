import { requireWorkspace } from "@/lib/tenancy";
import { Button, Card, Field, Notice, PageHeader } from "@/components/ui";
import { saveSettings } from "../actions";
import { sendTestReport } from "../ops-actions";

export const metadata = { title: "Settings" };

export default async function Settings({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws } = await requireWorkspace(wsId, 4);
  const s = ws.settings as { storeRawPii?: boolean; piiRetentionDays?: number; phoneCountryCode?: string; slackWebhookUrl?: string; reportRecipients?: string };
  return (
    <>
      <PageHeader title="Workspace settings" />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      {sp.error && <div className="mb-4"><Notice tone="red">{sp.error}</Notice></div>}
      <form action={saveSettings.bind(null, ws.id)} className="space-y-6">
        <Card title="General">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name">
              <input name="name" defaultValue={ws.name} />
            </Field>
            <Field label="Timezone">
              <input name="timezone" defaultValue={ws.timezone} />
            </Field>
            <Field label="Currency">
              <input name="currency" defaultValue={ws.currency} maxLength={3} />
            </Field>
          </div>
        </Card>
        <Card title="Privacy" description="Email and phone are always hashed (SHA-256, normalised) at intake for matching and uploads. Raw values are optional, encrypted, and purged automatically.">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="storeRawPii" defaultChecked={s.storeRawPii !== false} /> Store raw contact details (encrypted) for CRM sync
            </label>
            <Field label="Delete raw contact details after (days)">
              <input name="piiRetentionDays" type="number" min="1" max="365" defaultValue={s.piiRetentionDays ?? 30} />
            </Field>
            <Field label="Default phone country code" hint="Used to normalise numbers without a + prefix (1 = US/CA, 63 = PH).">
              <input name="phoneCountryCode" defaultValue={s.phoneCountryCode ?? "1"} />
            </Field>
          </div>
        </Card>
        <Card title="Alerts">
          <Field label="Slack incoming webhook URL" hint="Warnings and critical alerts are posted here.">
            <input name="slackWebhookUrl" defaultValue={s.slackWebhookUrl ?? ""} placeholder="https://hooks.slack.com/services/…" className="w-full max-w-xl" />
          </Field>
          <div className="mt-3">
            <Field label="Weekly summary email recipients" hint="Comma-separated. Sent Mondays under your organization's brand (needs RESEND_API_KEY and a verified sender).">
              <input name="reportRecipients" defaultValue={s.reportRecipients ?? ""} className="w-full max-w-xl" />
            </Field>
          </div>
        </Card>
        <Button>Save settings</Button>
      </form>
      <form action={sendTestReport.bind(null, ws.id)} className="mt-4">
        <Button variant="secondary">Send this week&apos;s summary now</Button>
      </form>
    </>
  );
}
