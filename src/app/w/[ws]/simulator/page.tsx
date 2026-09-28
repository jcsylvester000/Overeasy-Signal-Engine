import { requireWorkspace } from "@/lib/tenancy";
import { publishedScoring } from "@/server/models";
import { Button, Card, Field, Notice, PageHeader } from "@/components/ui";
import { resetTestData, simulateLead } from "../actions";

export const metadata = { title: "Simulator" };

export default async function Simulator({ params, searchParams }: { params: Promise<{ ws: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { ws: wsId } = await params;
  const sp = await searchParams;
  const { ws, rank } = await requireWorkspace(wsId, 3);
  const scoring = await publishedScoring(ws.id);

  return (
    <>
      <PageHeader
        title="Simulator"
        description="Runs the real pipeline end to end — tag attribution, scoring, CRM sync, value ladder, signal jobs and platform payloads — with a simulated ad click. Simulated leads are flagged and can be hidden from reports or removed."
      />
      {sp.saved && <div className="mb-4"><Notice tone="green">{sp.saved}</Notice></div>}
      <Card title="1. Simulate an ad click and a form submission">
        <form action={simulateLead.bind(null, ws.id)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Ad platform">
              <select name="platform" defaultValue="both">
                <option value="google">Google Ads (gclid)</option>
                <option value="microsoft">Microsoft Ads (msclkid)</option>
                <option value="both">Both</option>
                <option value="none">No ad click (organic)</option>
              </select>
            </Field>
            <Field label="Campaign">
              <input name="campaign" defaultValue="Search – Sell Land" />
            </Field>
            <Field label="Click was … days ago">
              <input name="click_age_days" type="number" min="0" max="400" defaultValue="0" />
            </Field>
            <Field label="Email (optional)">
              <input name="email" type="email" placeholder="auto-generated" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(scoring?.model.fields ?? []).map((f) => (
              <Field key={f.key} label={f.label}>
                {f.type === "select" ? (
                  <select name={`a:${f.key}`} defaultValue="">
                    <option value="">(skipped)</option>
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input name={`a:${f.key}`} type={f.type === "number" ? "number" : "text"} />
                )}
              </Field>
            ))}
          </div>
          <Button>Submit simulated lead</Button>
        </form>
      </Card>
      <Card title="2. Then open the lead and move it through the stages" className="mt-6">
        <p className="text-sm text-muted">
          On the lead page, record Qualified → Opportunity → Contract → Funded and watch the value ladder produce increments for Google and Microsoft. Use “Age click” to push the click past 90 days and see the window guard block the upload while the value is kept for reporting.
        </p>
      </Card>
      {rank >= 4 && (
        <Card title="Reset" className="mt-6">
          <form action={resetTestData.bind(null, ws.id)}>
            <Button variant="danger">Delete all simulated leads in this workspace</Button>
          </form>
        </Card>
      )}
    </>
  );
}
